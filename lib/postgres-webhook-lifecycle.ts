import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { coresignalWebhookCoverage, coresignalWebhookOperations, coresignalWebhookSubscriptions, securityAuditEvents } from "@/db/postgres/schema"
import { renewalDue } from "@/lib/coresignal-webhooks"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

export function localMockAllowed() {
  return process.env.NODE_ENV === "development"
    && process.env.LOCAL_DEV_AUTH_ENABLED === "true"
    && process.env.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && process.env.CN_PG_LOCAL_TEST_ENABLED === "true"
    && process.env.CORESIGNAL_WEBHOOK_MOCK_TRANSPORT === "true"
}

const conflict = (error: string) => Response.json({ error }, { status: 409 })

/** Isolated mock lifecycle only. Neither action sends a provider request. */
export async function postgresWebhookLifecycle(body: { action?: string; subscriptionId?: number; confirmation?: string }, actor: SecurityContext): Promise<Response> {
  if (!localMockAllowed()) return conflict("Provider lifecycle requests are disabled until separately authorized and contract-verified.")
  const id = Number(body.subscriptionId)
  if (!Number.isSafeInteger(id) || id < 1) return conflict("A saved monitoring subscription is required.")
  const action = body.action
  if (action !== "renew" && action !== "stop") return conflict("Unsupported monitoring action.")
  return getPostgresDb().transaction(async tx => {
    const [plan] = await tx.select().from(coresignalWebhookSubscriptions)
      .where(eq(coresignalWebhookSubscriptions.id, id)).for("update").limit(1)
    if (!plan) return conflict("Monitoring subscription was not found.")
    if (plan.status !== "ACTIVE" || body.confirmation !== `${action.toUpperCase()} ${id}`) {
      return conflict("Active state and explicit confirmation are required.")
    }
    if (action === "renew" && !renewalDue(plan.activatedAt, plan.expiresAt)) {
      return conflict("Renewal is not due or would exceed the one-year ceiling.")
    }
    const nextExpiry = action === "renew" ? new Date(Date.parse(plan.expiresAt) + 91 * 86_400_000).toISOString() : plan.expiresAt
    const [updated] = await tx.update(coresignalWebhookSubscriptions)
      .set(action === "renew" ? { expiresAt: nextExpiry } : { status: "STOPPED" })
      .where(and(eq(coresignalWebhookSubscriptions.id, id), eq(coresignalWebhookSubscriptions.status, "ACTIVE")))
      .returning({ id: coresignalWebhookSubscriptions.id })
    if (!updated) return conflict("Active state and explicit confirmation are required.")
    if (action === "stop") await tx.update(coresignalWebhookCoverage).set({ status: "STOPPED" })
      .where(eq(coresignalWebhookCoverage.subscriptionId, id))
    await tx.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: action.toUpperCase(),
      requestKey: crypto.randomUUID(), actor: actor.displayName, status: "CONFIRMED",
      responseJson: JSON.stringify({ mode: "mock", expiresAt: nextExpiry }) })
    await tx.insert(securityAuditEvents).values({ actorUserId: actor.userId, actorIdentity: actor.externalIdentity,
      actorName: actor.displayName, actorRole: actor.role, action: `coresignal_webhook_mock_${action}`,
      entityType: "coresignal_webhook_subscriptions", entityId: String(id),
      metadataJson: safeAuditMetadata({ providerMode: "mock", creditsUsed: 0 }), result: "success", source: "application" })
    return Response.json({ id, status: action === "stop" ? "STOPPED" : "ACTIVE", expiresAt: nextExpiry, providerRequests: 0 })
  })
}
