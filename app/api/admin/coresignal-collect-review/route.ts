import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, providerResponseHistory } from "@/db/schema"
import { CORESIGNAL_COLLECT_OPERATION, deserializeCollectEvidence } from "@/lib/coresignal-collect-only"
import { attachCoresignalIdentity, reconcileCoresignalIdentity } from "@/lib/coresignal-identity"
import { coresignalIdentityStore } from "@/lib/coresignal-identity-store"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const input = await request.json() as { collectHistoryId?: number; alumnusId?: number; confirmed?: boolean; identityReviewed?: boolean; educationReviewed?: boolean }
    if (!Number.isSafeInteger(input.collectHistoryId) || !Number.isSafeInteger(input.alumnusId) || input.collectHistoryId! < 1 || input.alumnusId! < 1) return Response.json({ error: "A saved Collect response and alumnus are required." }, { status: 400 })
    const db = getDb()
    const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, input.collectHistoryId!)).limit(1)
    const [person] = await db.select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl, coresignalEmployeeId: alumni.coresignalEmployeeId, intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch }).from(alumni).where(eq(alumni.id, input.alumnusId!)).limit(1)
    if (!history || history.provider !== "coresignal" || history.operation !== CORESIGNAL_COLLECT_OPERATION || history.status !== "success" || !person) return Response.json({ error: "Reviewable Collect evidence or target alumnus was not found." }, { status: 404 })
    if (history.alumnusId && history.alumnusId !== person.id) return Response.json({ error: "This Collect evidence is already associated with another alumnus." }, { status: 409 })
    if (person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") return Response.json({ error: "Resolve the alumnus identity before association." }, { status: 409 })
    const retained = deserializeCollectEvidence(history.responseSummary)
    const evidence = retained?.evidence
    if (!evidence || evidence.targetEmployeeId !== evidence.returnedEmployeeId || !linkedinProfileIdentifier(evidence.identity.professionalProfileUrl) || linkedinProfileIdentifier(evidence.identity.professionalProfileUrl) !== linkedinProfileIdentifier(person.linkedinUrl)) return Response.json({ error: "The stored Employee ID or exact LinkedIn identity does not match this alumnus." }, { status: 409 })
    const people = await db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni)
    const decision = reconcileCoresignalIdentity({ coresignalEmployeeId: evidence.returnedEmployeeId, profileUrl: evidence.identity.professionalProfileUrl, expectedAlumnusId: person.id }, people)
    if (decision.alumnusId !== person.id || !["ATTACHED_PROVIDER_ID", "KNOWN_PROVIDER_ID"].includes(decision.outcome) || decision.evidenceReviewRequired) return Response.json({ error: decision.rationale, decision }, { status: 409 })
    if (input.confirmed !== true) return Response.json({ decision, evidence, providerCalls: 0, canonicalMutations: 0 })
    if (input.identityReviewed !== true || input.educationReviewed !== true) return Response.json({ error: "Confirm human review of identity and education evidence before association." }, { status: 400 })
    const attached = await attachCoresignalIdentity({ coresignalEmployeeId: evidence.returnedEmployeeId, profileUrl: evidence.identity.professionalProfileUrl, expectedAlumnusId: person.id, source: `coresignal_collect_review:${history.id}`, actor: context.displayName }, coresignalIdentityStore(db, context))
    if (attached.alumnusId !== person.id || !["ATTACHED_PROVIDER_ID", "KNOWN_PROVIDER_ID"].includes(attached.outcome) || attached.evidenceReviewRequired) return Response.json({ error: attached.rationale, decision: attached }, { status: 409 })
    const [updated] = await db.update(providerResponseHistory).set({ alumnusId: person.id, alumnusName: `Alumnus ${person.id}` }).where(and(eq(providerResponseHistory.id, history.id), eq(providerResponseHistory.status, "success"))).returning({ id: providerResponseHistory.id })
    if (!updated) return Response.json({ error: "The saved Collect record changed during review; inspect the history before retrying." }, { status: 409 })
    await db.update(alumniEmploymentEvidence).set({ alumnusId: person.id }).where(and(eq(alumniEmploymentEvidence.providerResponseId, history.id), eq(alumniEmploymentEvidence.providerEmployeeId, evidence.returnedEmployeeId)))
    await writeSecurityAudit(context, { action: "coresignal_collect_identity_approved", entityType: "provider_response_history", entityId: history.id, metadata: { alumnusId: person.id, employeeId: evidence.returnedEmployeeId, matchingMethod: attached.matchingMethod, identityWritten: attached.wroteIdentity, identityReviewed: true, educationReviewed: true, providerCalls: 0 } })
    return Response.json({ decision: attached, associatedAlumnusId: person.id, providerCalls: 0 })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Collect review failed." }, { status: 500 })
  }
}
