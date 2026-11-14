import { and, eq } from "drizzle-orm"

import { POST as receiveWebhook } from "@/app/api/webhooks/coresignal/[subscriptionId]/[token]/route"
import { getPostgresDb } from "@/db/postgres/adapter"
import { coresignalWebhookCoverage, coresignalWebhookSubscriptions } from "@/db/postgres/schema"
import { callbackToken } from "@/lib/coresignal-webhooks"
import { localMockAllowed } from "@/lib/postgres-webhook-lifecycle"
import { type SecurityContext, writeSecurityAudit } from "@/lib/security"

const conflict = (error: string) => Response.json({ error }, { status: 409 })
const validId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null

/** Isolated mock callback through the authenticated receiver; no provider transport. */
export async function postgresWebhookSimulate(body: { subscriptionId?: number; alumnusId?: number; confirmation?: string }, actor: SecurityContext): Promise<Response> {
  if (!localMockAllowed() || process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED !== "true") {
    return conflict("Isolated mock transport and callback receiver must both be enabled for simulation.")
  }
  const id = validId(body.subscriptionId)
  if (!id) return conflict("A saved monitoring subscription is required.")
  const [plan] = await getPostgresDb().select().from(coresignalWebhookSubscriptions)
    .where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!plan) return conflict("Monitoring subscription was not found.")
  const alumnusId = validId(body.alumnusId)
  if (plan.status !== "ACTIVE" || !alumnusId || body.confirmation !== `SIMULATE ${id} ${alumnusId}`) {
    return conflict("An active mock subscription, covered alumnus, and exact confirmation are required.")
  }
  const [covered] = await getPostgresDb().select().from(coresignalWebhookCoverage).where(and(
    eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.alumnusId, alumnusId),
    eq(coresignalWebhookCoverage.status, "ACTIVE"))).limit(1)
  if (!covered) return conflict("The alumnus is not covered by this subscription.")
  const secret = process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET?.trim() ?? ""
  const token = await callbackToken(id, secret)
  const response = await receiveWebhook(new Request(`http://127.0.0.1/api/webhooks/coresignal/${id}/${token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ member_id: covered.employeeId, status: "changed", changed_fields: ["experience"],
      event_id: `mock-${crypto.randomUUID()}` }]),
  }), { params: Promise.resolve({ subscriptionId: String(id), token }) })
  if (!response.ok) return conflict("Mock callback was not persisted; inspect receiver configuration.")
  const result = await response.json() as { stored: number; duplicates: number }
  await writeSecurityAudit(actor, { action: "coresignal_webhook_mock_simulated", entityType: "coresignal_webhook_subscriptions",
    entityId: id, metadata: { alumnusId, stored: result.stored, providerRequests: 0, canonicalMutations: 0 } })
  return Response.json({ ...result, providerRequests: 0, creditsUsed: 0, canonicalMutations: 0 })
}
