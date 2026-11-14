import { and, eq, ne, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, fieldChangeHistory, providerRefreshReviews, providerResponseHistory,
  securityAuditEvents } from "@/db/postgres/schema"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"
import { lushaIdentityApprovalEligible, parseLushaIdentityEvidence } from "@/lib/lusha-identity-review"
import { localLushaV3MockTransportEnabled } from "@/lib/local-development"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

class ApprovalConflict extends Error {}
const conflict = (error: string) => Response.json({ error }, { status: 409 })

/** Mirrors D1's four-write reviewed association batch, then its separate security audit. */
export async function postgresLushaIdentityApprove(reviewId: number | undefined, confirmed: boolean | undefined,
  context: SecurityContext): Promise<Response> {
  if (!Number.isSafeInteger(reviewId) || Number(reviewId) < 1 || confirmed !== true) return Response.json({
    error: "Choose a pending Lusha identity review and explicitly confirm the association." }, { status: 400 })
  const db = getPostgresDb()
  let outcome: { response?: Response; alumnusId?: number; reviewId?: number; historyId?: number; identityReason?: string }
  try {
    outcome = await db.transaction(async tx => {
      const [review] = await tx.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, reviewId!)).for("update").limit(1)
      if (!review || review.status !== "Pending identity review") return { response: conflict("This Lusha identity is not pending an approvable review.") }
      const [history] = await tx.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, review.providerResponseId)).for("update").limit(1)
      const [person] = await tx.select().from(alumni).where(eq(alumni.id, review.alumnusId)).for("update").limit(1)
      const evidence = parseLushaIdentityEvidence(review.proposedChangesJson)
      if (!history || !person || !evidence || history.provider !== "lusha" || history.operation !== "Contact Search Preview"
        || !(history.mode === "live" || history.mode === "mock" && localLushaV3MockTransportEnabled())
        || history.status !== "review_required" || history.resultCount !== 1 || history.alumnusId !== person.id
        || person.intakeStatus === "PROVISIONAL" || !lushaIdentityApprovalEligible(evidence, person.linkedinUrl,
          person.lushaPersonId, person.recordVersion)) {
        return { response: conflict("Stored provider identity and the current alumnus profile do not support this association.") }
      }
      const profileId = linkedinProfileIdentifier(person.linkedinUrl)
      const others = await tx.select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(ne(alumni.id, person.id))
      if (others.some(item => linkedinProfileIdentifier(item.linkedinUrl) === profileId)) {
        return { response: conflict("The professional profile is shared by another alumnus; resolve identity ambiguity before association.") }
      }
      // Serialize claims for the same provider contact ID, including claims for different alumni.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"lusha-identity:" + evidence.contactId}))`)
      const [linked] = await tx.select({ id: alumni.id }).from(alumni).where(and(eq(alumni.lushaPersonId, evidence.contactId),
        ne(alumni.id, person.id))).limit(1)
      const pending = await tx.select({ proposedChangesJson: providerRefreshReviews.proposedChangesJson })
        .from(providerRefreshReviews).where(eq(providerRefreshReviews.status, "Pending identity review"))
      const matchingClaims = pending.filter(item => parseLushaIdentityEvidence(item.proposedChangesJson)?.contactId === evidence.contactId)
      if (linked || matchingClaims.length !== 1) return { response: conflict("The identity review could not be applied uniquely; inspect the retained evidence before retrying.") }
      const now = new Date().toISOString()
      const key = `lusha-identity-review:${review.id}`
      const [attached] = await tx.update(alumni).set({ lushaPersonId: evidence.contactId,
        updatedBy: context.displayName, updatedAt: now, recordVersion: person.recordVersion + 1,
        lastMutationRequestKey: key }).where(and(eq(alumni.id, person.id), eq(alumni.lushaPersonId, ""),
          eq(alumni.linkedinUrl, person.linkedinUrl), eq(alumni.recordVersion, person.recordVersion)))
        .returning({ id: alumni.id })
      if (!attached) throw new ApprovalConflict()
      const [reviewed] = await tx.update(providerRefreshReviews).set({ status: "Approved identity",
        reviewedBy: context.displayName, reviewedAt: now }).where(and(eq(providerRefreshReviews.id, review.id),
          eq(providerRefreshReviews.status, "Pending identity review"))).returning({ id: providerRefreshReviews.id })
      if (!reviewed) throw new ApprovalConflict()
      const [completed] = await tx.update(providerResponseHistory).set({ status: "success",
        responseSummary: history.responseSummary + " Stable contact ID associated only after explicit Admin identity review." })
        .where(and(eq(providerResponseHistory.id, history.id), eq(providerResponseHistory.status, "review_required")))
        .returning({ id: providerResponseHistory.id })
      if (!completed) throw new ApprovalConflict()
      await tx.insert(fieldChangeHistory).values({ alumnusId: person.id, field: "lushaPersonId", oldValue: "",
        newValue: evidence.contactId, source: "Lusha", providerAction: "Admin identity review", creditsCharged: 0,
        initiatedBy: context.displayName, mutationRequestKey: key })
      return { alumnusId: person.id, reviewId: review.id, historyId: history.id, identityReason: evidence.identityReason }
    })
  } catch (error) {
    if (error instanceof ApprovalConflict) return conflict("The identity review could not be applied uniquely; inspect the retained evidence before retrying.")
    throw error
  }
  if (outcome.response) return outcome.response
  await db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
    actorName: context.displayName, actorRole: context.role, action: "lusha_identity_association_approved",
    entityType: "alumnus", entityId: String(outcome.alumnusId),
    metadataJson: safeAuditMetadata({ reviewId: outcome.reviewId, providerHistoryId: outcome.historyId,
      identityReason: outcome.identityReason, contactFieldsRevealed: 0, providerRequests: 0 }),
    result: "success", source: "application" })
  return Response.json({ approved: true, reviewId: outcome.reviewId, alumnusId: outcome.alumnusId })
}
