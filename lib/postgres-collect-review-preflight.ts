import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, providerResponseHistory } from "@/db/postgres/schema"
import { CORESIGNAL_COLLECT_OPERATION, deserializeCollectEvidence } from "@/lib/coresignal-collect-only"
import { reconcileCoresignalIdentity } from "@/lib/coresignal-identity"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"

/** Read retained Collect evidence; confirmed association remains D1-only. */
export async function postgresCollectReviewPreflight(collectHistoryId: number, alumnusId: number): Promise<Response> {
  const db = getPostgresDb()
  const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, collectHistoryId)).limit(1)
  const [person] = await db.select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl, coresignalEmployeeId: alumni.coresignalEmployeeId,
    intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
  if (!history || history.provider !== "coresignal" || history.operation !== CORESIGNAL_COLLECT_OPERATION || history.status !== "success" || !person) {
    return Response.json({ error: "Reviewable Collect evidence or target alumnus was not found." }, { status: 404 })
  }
  if (history.alumnusId && history.alumnusId !== person.id) return Response.json({ error: "This Collect evidence is already associated with another alumnus." }, { status: 409 })
  if (person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") return Response.json({ error: "Resolve the alumnus identity before association." }, { status: 409 })
  const retained = deserializeCollectEvidence(history.responseSummary)
  const evidence = retained?.evidence
  if (!evidence || evidence.targetEmployeeId !== evidence.returnedEmployeeId || !linkedinProfileIdentifier(evidence.identity.professionalProfileUrl) || linkedinProfileIdentifier(evidence.identity.professionalProfileUrl) !== linkedinProfileIdentifier(person.linkedinUrl)) {
    return Response.json({ error: "The stored Employee ID or exact LinkedIn identity does not match this alumnus." }, { status: 409 })
  }
  const people = await db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni)
  const decision = reconcileCoresignalIdentity({ coresignalEmployeeId: evidence.returnedEmployeeId,
    profileUrl: evidence.identity.professionalProfileUrl, expectedAlumnusId: person.id }, people)
  if (decision.alumnusId !== person.id || !["ATTACHED_PROVIDER_ID", "KNOWN_PROVIDER_ID"].includes(decision.outcome) || decision.evidenceReviewRequired) {
    return Response.json({ error: decision.rationale, decision }, { status: 409 })
  }
  return Response.json({ decision, evidence, providerCalls: 0, canonicalMutations: 0 })
}
