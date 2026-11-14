import { and, eq, inArray, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { providerRefreshReviews, providerResponseHistory, securityAuditEvents } from "@/db/postgres/schema"
import { parseLushaContactReview } from "@/lib/lusha-contact-review"
import { parseLushaIdentityEvidence } from "@/lib/lusha-identity-review"
import { localLushaV3MockTransportEnabled } from "@/lib/local-development"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

export async function postgresLushaReviewReject(action: "lusha_reject_identity" | "lusha_reject_contact",
  reviewId: number | undefined, confirmed: boolean | undefined, context: SecurityContext): Promise<Response> {
  const identity = action === "lusha_reject_identity"
  if (!Number.isSafeInteger(reviewId) || Number(reviewId) < 1 || confirmed !== true) {
    return Response.json({ error: identity
      ? "Choose a Lusha identity review and explicitly confirm rejection."
      : "Choose a pending contact review and explicitly confirm this decision." }, { status: 400 })
  }
  const db = getPostgresDb()
  const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, reviewId!)).limit(1)
  const identityEvidence = review && identity ? parseLushaIdentityEvidence(review.proposedChangesJson) : null
  const contactEvidence = review && !identity ? parseLushaContactReview(review.proposedChangesJson) : null
  const allowed = identity ? ["Pending identity review", "Identity exception"] : ["Pending contact review", "Contact exception"]
  if (!review || !allowed.includes(review.status) || !(identity ? identityEvidence : contactEvidence)) return Response.json({ error: identity
    ? "This Lusha identity review cannot be rejected again."
    : "This Lusha contact evidence is not pending an eligible review." }, { status: 409 })
  const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, review.providerResponseId)).limit(1)
  if (!history || history.provider !== "lusha" || history.alumnusId !== review.alumnusId ||
    (identity ? history.operation !== "Contact Search Preview" : history.operation !== (contactEvidence!.channel === "email" ? "Email Reveal" : "Phone Reveal")) ||
    (!identity && (history.status !== "review_required" || !(history.mode === "live" || history.mode === "mock" && localLushaV3MockTransportEnabled())))) {
    return Response.json({ error: identity
      ? "The retained Lusha provider request does not match this review."
      : "The retained provider request does not match this contact review." }, { status: 409 })
  }
  const [updated] = await db.update(providerRefreshReviews).set({ status: identity ? "Rejected identity" : "Rejected contact",
    reviewedBy: context.displayName, reviewedAt: new Date().toISOString() })
    .where(and(eq(providerRefreshReviews.id, review.id), inArray(providerRefreshReviews.status, allowed),
      sql`case when pg_input_is_valid(${providerRefreshReviews.proposedChangesJson}, 'jsonb') then ${providerRefreshReviews.proposedChangesJson}::jsonb->>'kind' end = ${identity ? "LUSHA_CONTACT_IDENTITY" : "LUSHA_CONTACT_FIELD"}`))
    .returning({ id: providerRefreshReviews.id })
  if (!updated) return Response.json({ error: identity
    ? "The review decision changed concurrently; reload before deciding."
    : "The review changed concurrently; reload before deciding." }, { status: 409 })
  await db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
    actorName: context.displayName, actorRole: context.role,
    action: identity ? "lusha_identity_association_rejected" : "lusha_contact_evidence_rejected",
    entityType: "alumnus", entityId: String(review.alumnusId), metadataJson: safeAuditMetadata(identity
      ? { reviewId: review.id, providerHistoryId: history.id, providerRequests: 0, canonicalMutations: 0 }
      : { reviewId: review.id, providerHistoryId: history.id,
        channel: contactEvidence!.channel, canonicalMutations: 0 }),
    result: "success", source: "application" })
  return Response.json({ rejected: true, reviewId: review.id })
}
