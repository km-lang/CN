import { and, desc, eq } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { externalDiscoveryCandidateEvidence, externalDiscoveryResults, externalDiscoverySearches, securityAuditEvents } from "@/db/postgres/schema"
import { normalizeDiscoveryFiltersInput } from "@/lib/alumni-search"
import { candidateEvidenceDecisions, candidateEvidenceOutcome, normalizeCandidateObservation, validateReviewerDecisions } from "@/lib/discovery-candidate-evidence"
import { resultProviderIntegrity } from "@/lib/discovery-runs"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { sha256Text, stableMutationPayload } from "@/lib/mutation-fingerprint"
import { PROFESSIONAL_DATA_PROVIDER } from "@/lib/professional-data"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function storedFilters(value: string) {
  try { return normalizeDiscoveryFiltersInput(JSON.parse(value)) } catch { return normalizeDiscoveryFiltersInput({}) }
}

function databaseCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  if ("code" in error && typeof error.code === "string") return error.code
  return "cause" in error ? databaseCode(error.cause) : ""
}

/** Serialize evidence revisions for one result; commit evidence and audit together. */
export async function recordPostgresDiscoveryEvidence(payload: { resultId?: number; observation?: unknown; decisions?: unknown }, context: SecurityContext, nowDate: Date): Promise<Response> {
  if (!Number.isInteger(payload.resultId) || Number(payload.resultId) <= 0) return Response.json({ error: "A discovery result ID is required." }, { status: 400 })
  const resultId = payload.resultId!
  const db = getPostgresDb()
  let fingerprint = ""
  try {
    return await db.transaction(async tx => {
      const [result] = await tx.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, resultId)).for("update").limit(1)
      const [search] = result ? await tx.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      if (result && result.provider !== PROFESSIONAL_DATA_PROVIDER) return Response.json({ error: "Historical provider evidence is read-only." }, { status: 409 })
      if (!result || !search || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || resultProviderIntegrity(search.provider, result.provider) !== "consistent" || !result.providerPersonId) return Response.json({ error: "Only a pending result with consistent provider identity can receive review evidence." }, { status: 409 })
      let observation: ReturnType<typeof normalizeCandidateObservation>
      let decisions: ReturnType<typeof validateReviewerDecisions>
      try {
        observation = normalizeCandidateObservation(payload.observation)
        decisions = validateReviewerDecisions(payload.decisions, candidateEvidenceDecisions(observation, storedFilters(search.filtersJson), result.linkedinUrl, nowDate))
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Unable to complete external alumni discovery." }, { status: 500 })
      }
      const reviewerDecision = candidateEvidenceOutcome(decisions)
      const decisionsJson = stableMutationPayload(decisions)
      fingerprint = await sha256Text(stableMutationPayload({ resultId: result.id, observation, decisions }))
      const [exactReplay] = await tx.select().from(externalDiscoveryCandidateEvidence).where(and(eq(externalDiscoveryCandidateEvidence.resultId, result.id), eq(externalDiscoveryCandidateEvidence.requestKey, fingerprint))).limit(1)
      if (exactReplay) return Response.json({ saved: false, duplicate: true, evidence: exactReplay })
      const [previous] = await tx.select().from(externalDiscoveryCandidateEvidence).where(eq(externalDiscoveryCandidateEvidence.resultId, result.id)).orderBy(desc(externalDiscoveryCandidateEvidence.id)).limit(1)
      if (previous && previous.reviewerDecision !== reviewerDecision && observation.verificationReason.length < 30) return Response.json({ error: `This decision conflicts with saved evidence #${previous.id}. Explain the changed conclusion in at least 30 characters; prior evidence remains visible.` }, { status: 409 })
      const [saved] = await tx.insert(externalDiscoveryCandidateEvidence).values({
        searchId: search.id, resultId: result.id, provider: result.provider, providerPersonId: result.providerPersonId,
        ...observation, sourceProvenance: previous && previous.reviewerDecision !== reviewerDecision ? `HUMAN_ENTERED_REVIEW_REVISION_OF:${previous.id}` : "HUMAN_ENTERED",
        decisionsJson, reviewerDecision, reviewerUserId: context.userId, reviewerName: context.displayName,
        requestKey: fingerprint, reviewedAt: nowDate.toISOString(),
      }).returning()
      await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
        actorName: context.displayName, actorRole: context.role, action: "external_candidate_evidence_recorded",
        entityType: "discovery_result", entityId: String(result.id),
        metadataJson: safeAuditMetadata({ reviewerDecision, sourceType: observation.sourceType, provider: result.provider, requestKey: fingerprint }),
        result: "success", source: "application" })
      return Response.json({ saved: true, duplicate: false, evidence: saved }, { status: 201 })
    })
  } catch (error) {
    if (fingerprint && databaseCode(error) === "23505") {
      const [existing] = await db.select().from(externalDiscoveryCandidateEvidence).where(and(eq(externalDiscoveryCandidateEvidence.resultId, resultId), eq(externalDiscoveryCandidateEvidence.requestKey, fingerprint))).limit(1)
      if (existing) return Response.json({ saved: false, duplicate: true, evidence: existing })
    }
    throw error
  }
}
