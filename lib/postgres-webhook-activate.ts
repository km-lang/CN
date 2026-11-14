import { and, eq, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { coresignalWebhookCoverage, coresignalWebhookOperations, coresignalWebhookSubscriptions } from "@/db/postgres/schema"
import { localMockAllowed } from "@/lib/postgres-webhook-lifecycle"
import { postgresWebhookSelectionPlan, type SelectionInput } from "@/lib/postgres-webhook-selection"
import { type SecurityContext, writeSecurityAudit } from "@/lib/security"

const MAX_PREPARED = 100
const conflict = (error: string) => Response.json({ error }, { status: 409 })
const validId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null

/** Mock-only two-phase activation; no provider subscription request is made. */
export async function postgresWebhookActivate(body: { subscriptionId?: number; confirmation?: string }, actor: SecurityContext): Promise<Response> {
  if (!localMockAllowed()) return conflict("Live Base Employee subscription creation is disabled pending exact provider contract and separate authorization.")
  const id = validId(body.subscriptionId)
  if (!id) return conflict("A saved monitoring subscription is required.")
  const db = getPostgresDb()
  const [plan] = await db.select().from(coresignalWebhookSubscriptions).where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!plan) return conflict("Monitoring subscription was not found.")
  if (plan.status !== "DRAFT") return conflict("Only a draft can be activated; ambiguous states require reconciliation.")
  const members = JSON.parse(plan.membershipJson) as Array<{ alumnusId: number; employeeId: string }>
  if (!members.length || members.length > MAX_PREPARED || body.confirmation !== `ACTIVATE ${id} ${members.length}`) {
    return conflict("Explicit exact-batch activation confirmation is required.")
  }
  const [active] = await db.select({ count: sql<number>`count(*)::integer` }).from(coresignalWebhookSubscriptions)
    .where(eq(coresignalWebhookSubscriptions.status, "ACTIVE"))
  if (Number(active?.count ?? 0) >= 500) return conflict("The documented 500-subscription account ceiling has been reached.")
  const selection = await postgresWebhookSelectionPlan({ cohortType: plan.cohortType as SelectionInput["cohortType"],
    selection: plan.cohortType === "DYNAMIC_FILTER" ? JSON.parse(plan.selectionJson) : undefined,
    ids: plan.cohortType === "FIXED_IDS" ? JSON.parse(plan.selectionJson) : undefined })
  const eligible = new Set(selection.eligible.map(item => `${item.alumnusId}:${item.employeeId}`))
  if (members.some(item => !eligible.has(`${item.alumnusId}:${item.employeeId}`)) || selection.selectionVersion !== plan.selectionVersion) {
    return conflict("Cohort membership or verified identity changed after preparation; prepare a new batch.")
  }
  const [claimed] = await db.update(coresignalWebhookSubscriptions).set({ status: "PENDING_ACTIVATION" })
    .where(and(eq(coresignalWebhookSubscriptions.id, id), eq(coresignalWebhookSubscriptions.status, "DRAFT")))
    .returning({ id: coresignalWebhookSubscriptions.id })
  if (!claimed) return conflict("Activation was already claimed; reconcile before any retry.")
  const requestKey = crypto.randomUUID()
  await db.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: "CREATE_IDS", requestKey,
    actor: actor.displayName, status: "CLAIMED",
    requestJson: JSON.stringify({ employeeIds: members.map(item => item.employeeId), selectionVersion: plan.selectionVersion }) })
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 91 * 86_400_000).toISOString()
  const providerSubscriptionId = `mock-base-experience-${crypto.randomUUID()}`
  try {
    await db.transaction(async tx => {
      const [updated] = await tx.update(coresignalWebhookSubscriptions).set({ providerSubscriptionId,
        status: "ACTIVE", activatedAt: now.toISOString(), expiresAt, lastError: "" })
        .where(and(eq(coresignalWebhookSubscriptions.id, id), eq(coresignalWebhookSubscriptions.status, "PENDING_ACTIVATION")))
        .returning({ id: coresignalWebhookSubscriptions.id })
      if (!updated) throw new Error("Activation claim changed before persistence.")
      await tx.insert(coresignalWebhookCoverage).values(members.map(item => ({ subscriptionId: id,
        alumnusId: item.alumnusId, employeeId: item.employeeId, status: "ACTIVE" })))
      await tx.update(coresignalWebhookOperations).set({ status: "CONFIRMED",
        responseJson: JSON.stringify({ providerSubscriptionId, expiresAt, mode: "mock" }), updatedAt: now.toISOString() })
        .where(eq(coresignalWebhookOperations.requestKey, requestKey))
    })
  } catch {
    await db.update(coresignalWebhookSubscriptions).set({ status: "ERROR",
      lastError: "Mock activation was not fully persisted; inspect coverage before retry." }).where(eq(coresignalWebhookSubscriptions.id, id))
    return conflict("Activation persistence failed; no live provider request occurred.")
  }
  await writeSecurityAudit(actor, { action: "coresignal_webhook_mock_activated",
    entityType: "coresignal_webhook_subscriptions", entityId: id,
    metadata: { memberCount: members.length, providerMode: "mock", creditsUsed: 0 } })
  return Response.json({ id, status: "ACTIVE", providerSubscriptionId, expiresAt, providerRequests: 0, creditsUsed: 0 })
}
