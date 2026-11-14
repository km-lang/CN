import { and, eq, inArray } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { coresignalWebhookEvents, coresignalWebhookSubscriptions, securityAuditEvents } from "@/db/postgres/schema"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function validId(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null }

/** Review a retained notification and audit its decision in one local transaction. */
export async function postgresWebhookReview(body: { subscriptionId?: number; eventId?: number; outcome?: string }, actor: SecurityContext): Promise<Response> {
  const id = validId(body.subscriptionId)
  if (!id) throw new Error("A saved monitoring subscription is required.")
  const db = getPostgresDb()
  const [plan] = await db.select({ id: coresignalWebhookSubscriptions.id }).from(coresignalWebhookSubscriptions)
    .where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!plan) throw new Error("Monitoring subscription was not found.")
  const eventId = validId(body.eventId)
  if (!eventId || !["REVIEW_REQUIRED", "IGNORED"].includes(body.outcome ?? "")) throw new Error("A supported review outcome is required.")
  await db.transaction(async tx => {
    const [updated] = await tx.update(coresignalWebhookEvents).set({ status: body.outcome!, reviewOutcome: `${actor.displayName}: ${body.outcome}` })
      .where(and(eq(coresignalWebhookEvents.id, eventId), eq(coresignalWebhookEvents.subscriptionId, id),
        inArray(coresignalWebhookEvents.status, ["AWAITING_PROFILE_COLLECTION", "REVIEW_REQUIRED"])))
      .returning({ id: coresignalWebhookEvents.id })
    if (!updated) throw new Error("The notification is not available for review.")
    await tx.insert(securityAuditEvents).values({ actorUserId: actor.userId, actorIdentity: actor.externalIdentity,
      actorName: actor.displayName, actorRole: actor.role, action: "coresignal_webhook_event_reviewed",
      entityType: "coresignal_webhook_events", entityId: String(eventId),
      metadataJson: safeAuditMetadata({ outcome: body.outcome, canonicalMutations: 0 }), result: "success", source: "application" })
  })
  return Response.json({ eventId, status: body.outcome, canonicalMutations: 0 })
}
