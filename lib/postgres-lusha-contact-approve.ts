import { and, eq, ne, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniPrivacyControls, communicationPreferences, fieldChangeHistory,
  providerRefreshReviews, providerResponseHistory, securityAuditEvents } from "@/db/postgres/schema"
import { contactEnrichmentPermission } from "@/lib/contact-enrichment"
import { lushaContactValueValid, parseLushaContactReview } from "@/lib/lusha-contact-review"
import { parseLushaIdentityEvidence } from "@/lib/lusha-identity-review"
import { localLushaV3MockTransportEnabled } from "@/lib/local-development"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { reviewId?: number; confirmed?: boolean; replaceExisting?: boolean }
const conflict = (error: string) => Response.json({ error }, { status: 409 })

/** The three D1 batch writes commit together; the security audit follows that batch. */
export async function postgresLushaContactApprove(payload: Input, context: SecurityContext): Promise<Response> {
  if (!Number.isSafeInteger(payload.reviewId) || Number(payload.reviewId) < 1 || payload.confirmed !== true) {
    return Response.json({ error: "Choose a pending contact review and explicitly confirm this decision." }, { status: 400 })
  }
  const db = getPostgresDb()
  const decided = await db.transaction(async tx => {
    const [review] = await tx.select().from(providerRefreshReviews)
      .where(eq(providerRefreshReviews.id, payload.reviewId!)).for("update").limit(1)
    const evidence = review ? parseLushaContactReview(review.proposedChangesJson) : null
    if (!review || !evidence || review.status !== "Pending contact review") {
      return { response: conflict("This Lusha contact evidence is not pending an eligible review.") }
    }
    const [history] = await tx.select().from(providerResponseHistory)
      .where(eq(providerResponseHistory.id, review.providerResponseId)).limit(1)
    if (!history || history.provider !== "lusha" || !(history.mode === "live" || history.mode === "mock" && localLushaV3MockTransportEnabled())
      || history.alumnusId !== review.alumnusId || history.operation !== (evidence.channel === "email" ? "Email Reveal" : "Phone Reveal")
      || history.status !== "review_required") return { response: conflict("The retained provider request does not match this contact review.") }
    if (history.usageState === "reconciliation_required" || history.providerReportedCredits !== null
      && history.providerReportedCredits > history.applicationUnits) return { response: conflict("Provider usage must be reconciled within the approved ceiling before contact approval.") }
    const [person] = await tx.select().from(alumni).where(eq(alumni.id, review.alumnusId)).for("update").limit(1)
    if (!person || person.intakeStatus === "PROVISIONAL" || person.lushaPersonId !== evidence.contactId
      || person.recordVersion !== evidence.alumnusRecordVersion
      || (evidence.channel === "email" ? person.email : person.phone) !== evidence.previousValue
      || (evidence.channel === "email" ? person.emailVerification : person.phoneVerification) === "Verified") {
      return { response: conflict("The alumni identity or contact field changed since the provider observation; review again before applying.") }
    }
    if (!lushaContactValueValid(evidence.channel, evidence.value)) return { response: conflict("The retained provider contact value is not valid for canonical use.") }
    if (evidence.previousValue && evidence.previousValue !== evidence.value && payload.replaceExisting !== true) {
      return { response: conflict("Replacing an existing contact value requires separate explicit confirmation.") }
    }
    const [privacy] = await tx.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1)
    const preferences = await tx.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id))
    const permission = contactEnrichmentPermission({ ...person, privacy }, preferences.map(item => item.status))
    if (!permission.allowed) return { response: conflict(permission.reason) }
    const duplicateColumn = evidence.channel === "email" ? alumni.email : alumni.phone
    // A target-value lock prevents two reviews for different alumni claiming the same contact concurrently.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${evidence.channel + ":" + evidence.value}))`)
    const [other] = await tx.select({ id: alumni.id }).from(alumni)
      .where(and(eq(duplicateColumn, evidence.value), ne(alumni.id, person.id))).limit(1)
    if (other) return { response: conflict("This contact value is already associated with another alumnus; resolve the identity conflict before approval.") }
    const approvedIdentities = await tx.select({ proposedChangesJson: providerRefreshReviews.proposedChangesJson })
      .from(providerRefreshReviews).where(and(eq(providerRefreshReviews.alumnusId, person.id),
        eq(providerRefreshReviews.status, "Approved identity")))
    if (!approvedIdentities.some(item => parseLushaIdentityEvidence(item.proposedChangesJson)?.contactId === person.lushaPersonId)) {
      return { response: conflict("The contact review could not be applied uniquely; inspect the retained evidence.") }
    }
    const now = new Date().toISOString()
    const mutationKey = `lusha-contact-review:${review.id}`
    const values = evidence.channel === "email"
      ? { email: evidence.value, emailVerification: "Unverified", emailSource: "Lusha", emailRetrievedAt: now }
      : { phone: evidence.value, phoneVerification: "Unverified", phoneSource: "Lusha", phoneRetrievedAt: now }
    const [updated] = await tx.update(alumni).set({ ...values, lastLushaEnrichment: now,
      updatedBy: context.displayName, updatedAt: now, recordVersion: person.recordVersion + 1,
      lastMutationRequestKey: mutationKey }).where(and(eq(alumni.id, person.id),
      eq(alumni.recordVersion, person.recordVersion), eq(alumni.lushaPersonId, evidence.contactId),
      eq(duplicateColumn, evidence.previousValue))).returning({ id: alumni.id })
    if (!updated) return { response: conflict("The contact review could not be applied uniquely; inspect the retained evidence.") }
    const [reviewed] = await tx.update(providerRefreshReviews).set({ status: "Applied",
      reviewedBy: context.displayName, reviewedAt: now }).where(and(eq(providerRefreshReviews.id, review.id),
        eq(providerRefreshReviews.status, "Pending contact review"))).returning({ id: providerRefreshReviews.id })
    if (!reviewed) throw new Error("Contact review transaction lost its claim.")
    await tx.insert(fieldChangeHistory).values({ alumnusId: person.id, field: evidence.channel,
      oldValue: evidence.previousValue, newValue: evidence.value, source: "Lusha",
      providerAction: evidence.channel === "email" ? "Email Reveal review" : "Phone Reveal review",
      creditsCharged: history.providerReportedCredits ?? history.reconciledCredits ?? 0,
      initiatedBy: context.displayName, mutationRequestKey: mutationKey })
    return { alumnusId: person.id, reviewId: review.id, historyId: history.id, channel: evidence.channel }
  })
  if ("response" in decided && decided.response) return decided.response
  await db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
    actorName: context.displayName, actorRole: context.role, action: "lusha_contact_evidence_approved",
    entityType: "alumnus", entityId: String(decided.alumnusId),
    metadataJson: safeAuditMetadata({ reviewId: decided.reviewId, providerHistoryId: decided.historyId,
      channel: decided.channel, providerRequests: 0 }), result: "success", source: "application" })
  return Response.json({ approved: true, reviewId: decided.reviewId, alumnusId: decided.alumnusId })
}
