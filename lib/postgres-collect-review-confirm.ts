import { and, eq, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniEmploymentEvidence, providerResponseHistory, securityAuditEvents } from "@/db/postgres/schema"
import { CORESIGNAL_COLLECT_OPERATION, deserializeCollectEvidence } from "@/lib/coresignal-collect-only"
import { attachCoresignalIdentity, reconcileCoresignalIdentity } from "@/lib/coresignal-identity"
import { postgresCoresignalIdentityStore } from "@/lib/postgres-coresignal-identity-store"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { collectHistoryId: number; alumnusId: number; identityReviewed?: boolean; educationReviewed?: boolean }
const response = (error: string, status: number) => Response.json({ error }, { status })

/** Confirm a saved Collect association; no provider request or credit claim occurs here. */
export async function postgresCollectReviewConfirm(input: Input, context: SecurityContext): Promise<Response> {
  return getPostgresDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7303107)`)
    const [history] = await tx.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, input.collectHistoryId)).for("update").limit(1)
    const [person] = await tx.select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl, coresignalEmployeeId: alumni.coresignalEmployeeId,
      intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch }).from(alumni).where(eq(alumni.id, input.alumnusId)).for("update").limit(1)
    if (!history || history.provider !== "coresignal" || history.operation !== CORESIGNAL_COLLECT_OPERATION || history.status !== "success" || !person) {
      return response("Reviewable Collect evidence or target alumnus was not found.", 404)
    }
    if (history.alumnusId && history.alumnusId !== person.id) return response("This Collect evidence is already associated with another alumnus.", 409)
    if (person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") return response("Resolve the alumnus identity before association.", 409)
    const evidence = deserializeCollectEvidence(history.responseSummary)?.evidence
    if (!evidence || evidence.targetEmployeeId !== evidence.returnedEmployeeId || !linkedinProfileIdentifier(evidence.identity.professionalProfileUrl)
      || linkedinProfileIdentifier(evidence.identity.professionalProfileUrl) !== linkedinProfileIdentifier(person.linkedinUrl)) {
      return response("The stored Employee ID or exact LinkedIn identity does not match this alumnus.", 409)
    }
    const people = await tx.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni)
    const decision = reconcileCoresignalIdentity({ coresignalEmployeeId: evidence.returnedEmployeeId,
      profileUrl: evidence.identity.professionalProfileUrl, expectedAlumnusId: person.id }, people)
    if (decision.alumnusId !== person.id || !["ATTACHED_PROVIDER_ID", "KNOWN_PROVIDER_ID"].includes(decision.outcome) || decision.evidenceReviewRequired) {
      return Response.json({ error: decision.rationale, decision }, { status: 409 })
    }
    if (input.identityReviewed !== true || input.educationReviewed !== true) return response("Confirm human review of identity and education evidence before association.", 400)
    const store = postgresCoresignalIdentityStore(tx, context)
    const attached = await attachCoresignalIdentity({ coresignalEmployeeId: evidence.returnedEmployeeId,
      profileUrl: evidence.identity.professionalProfileUrl, expectedAlumnusId: person.id,
      source: `coresignal_collect_review:${history.id}`, actor: context.displayName }, store)
    if (attached.alumnusId !== person.id || !["ATTACHED_PROVIDER_ID", "KNOWN_PROVIDER_ID"].includes(attached.outcome) || attached.evidenceReviewRequired) {
      return Response.json({ error: attached.rationale, decision: attached }, { status: 409 })
    }
    const [updatedHistory] = await tx.update(providerResponseHistory).set({ alumnusId: person.id, alumnusName: `Alumnus ${person.id}` })
      .where(and(eq(providerResponseHistory.id, history.id), eq(providerResponseHistory.status, "success"))).returning({ id: providerResponseHistory.id })
    if (!updatedHistory) return response("The saved Collect record changed during review; inspect the history before retrying.", 409)
    await tx.update(alumniEmploymentEvidence).set({ alumnusId: person.id }).where(and(
      eq(alumniEmploymentEvidence.providerResponseId, history.id), eq(alumniEmploymentEvidence.providerEmployeeId, evidence.returnedEmployeeId)))
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "coresignal_collect_identity_approved",
      entityType: "provider_response_history", entityId: String(history.id),
      metadataJson: safeAuditMetadata({ alumnusId: person.id, employeeId: evidence.returnedEmployeeId,
        matchingMethod: attached.matchingMethod, identityWritten: attached.wroteIdentity,
        identityReviewed: true, educationReviewed: true, providerCalls: 0 }), result: "success", source: "application" })
    return Response.json({ decision: attached, associatedAlumnusId: person.id, providerCalls: 0 })
  })
}
