import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, externalDiscoveryCandidateEvidence, externalDiscoveryResults, externalDiscoverySearches, provisionalAlumniIntakes, securityAuditEvents } from "@/db/schema"
import { resultProviderIntegrity } from "@/lib/discovery-runs"
import { assessProvisionalIntake, provisionalAlumnusValues, type IntakeCandidate } from "@/lib/provisional-intake"
import { accessErrorResponse, authorizeRequest, safeAuditMetadata } from "@/lib/security"

function selectedIds(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 25 || value.some(id => !Number.isSafeInteger(id) || id <= 0)) return null
  return [...new Set(value as number[])]
}

function isIdentityConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed|NOT NULL constraint failed|FOREIGN KEY constraint failed|SQLITE_CONSTRAINT/i.test(message)
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const payload = await request.json() as { action?: string; resultIds?: unknown; confirmed?: boolean }
    if (payload.action !== "preflight" && payload.action !== "execute") return Response.json({ error: "Unsupported provisional intake action." }, { status: 400 })
    const resultIds = selectedIds(payload.resultIds)
    if (!resultIds) return Response.json({ error: "Select 1–25 discovery results for provisional intake." }, { status: 400 })
    if (payload.action === "execute" && payload.confirmed !== true) return Response.json({ error: "Confirm provisional intake after reviewing eligible and excluded counts." }, { status: 400 })

    const db = getDb()
    const [results, knownAlumni, evidence] = await Promise.all([
      db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds)),
      db.select({ id: alumni.id, name: alumni.name, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni),
      db.select({ resultId: externalDiscoveryCandidateEvidence.resultId, reviewerDecision: externalDiscoveryCandidateEvidence.reviewerDecision, id: externalDiscoveryCandidateEvidence.id }).from(externalDiscoveryCandidateEvidence).where(inArray(externalDiscoveryCandidateEvidence.resultId, resultIds)).orderBy(externalDiscoveryCandidateEvidence.id),
    ])
    const searchIds = [...new Set(results.map(result => result.searchId))]
    const searches = searchIds.length ? await db.select().from(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, searchIds)) : []
    const searchById = new Map(searches.map(search => [search.id, search]))
    const latestEvidence = new Map(evidence.map(row => [row.resultId, row.reviewerDecision as IntakeCandidate["latestEvidenceDecision"]]))
    const latestEvidenceId = new Map(evidence.map(row => [row.resultId, row.id]))
    const resultById = new Map(results.map(result => [result.id, result]))
    const candidates: IntakeCandidate[] = resultIds.map(id => {
      const result = resultById.get(id)
      if (!result) return { id, searchId: 0, provider: "", providerPersonId: "", name: "", linkedinUrl: "", reviewStatus: "Missing", providerIntegrity: "search_missing" }
      const search = searchById.get(result.searchId)
      return { id, searchId: result.searchId, provider: result.provider, providerPersonId: result.providerPersonId, name: result.name,
        linkedinUrl: result.linkedinUrl, reviewStatus: result.reviewStatus, matchStatus: result.matchStatus, reviewNote: result.reviewNote,
        linkedInternalAlumnusId: result.linkedInternalAlumnusId, providerIntegrity: search ? resultProviderIntegrity(search.provider, result.provider) : "search_missing",
        latestEvidenceDecision: latestEvidence.get(id),
      }
    })
    const assessments = assessProvisionalIntake(candidates, knownAlumni)
    const eligible = assessments.filter(item => item.decision === "ELIGIBLE")
    const excluded = assessments.filter(item => item.decision !== "ELIGIBLE")
    const preflight = { selectedCount: resultIds.length, eligibleCount: eligible.length, excludedCount: excluded.length, assessments,
      consequences: "Eligible profiles enter the main Directory as PROVISIONAL. Education, programme, graduation year, employer, contact details and outreach consent remain unknown or unverified. No provider request or verified promotion occurs." }
    if (payload.action === "preflight") return Response.json({ ...preflight, providerCalls: 0, databaseWrites: 0 })
    if (!eligible.length) return Response.json({ ...preflight, addedCount: 0, added: [], alreadyPresentCount: excluded.filter(item => item.decision === "ALREADY_PRESENT").length,
      providerCalls: 0, verifiedPromotions: 0 }, { status: excluded.every(item => item.decision === "ALREADY_PRESENT") ? 200 : 409 })

    const now = new Date().toISOString()
    const added: Array<{ resultId: number; alumnusId: number }> = []
    const executionExclusions = [...excluded]
    for (const item of eligible) {
      const result = resultById.get(item.resultId)!
      const search = searchById.get(result.searchId)!
      const profileKey = `coresignal:${item.providerPersonId}`
      const provisionalValues = provisionalAlumnusValues(result, context.displayName, now)
      const observations = {
        providerResultId: result.providerResultId, name: result.name, education: result.education, educationProgramme: result.educationProgramme,
        graduationYear: result.graduationYear, educationStartDate: result.educationStartDate, educationEndDate: result.educationEndDate,
        institutionId: result.institutionId, institutionUrl: result.institutionUrl,
        currentCompany: result.currentCompany, currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl,
        currentRoleAmbiguous: result.currentRoleAmbiguous, role: result.role, rawTitle: result.rawTitle,
        function: result.function, seniority: result.seniority, location: result.location, providerFreshnessAt: result.providerFreshnessAt,
        affiliationStatus: result.affiliationStatus, matchStatus: result.matchStatus, reviewNote: result.reviewNote,
      }
      try {
        const [inserted, linked] = await db.batch([
          db.insert(alumni).values(provisionalValues).returning({ id: alumni.id }),
          db.update(externalDiscoveryResults).set({ reviewStatus: "Added provisionally", linkedInternalAlumnusId: sql<number>`(select id from alumni where profile_key = ${profileKey})`, reviewedAt: now, reviewedBy: context.displayName })
            .where(and(eq(externalDiscoveryResults.id, result.id), eq(externalDiscoveryResults.reviewStatus, "Pending review"), sql`${externalDiscoveryResults.linkedInternalAlumnusId} is null`)).returning({ id: externalDiscoveryResults.id }),
          db.insert(provisionalAlumniIntakes).values({
            alumnusId: sql<number>`(select id from alumni where profile_key = ${profileKey})`,
            // A concurrent review/ignore makes this NULL and aborts the entire
            // D1 batch, including the alumnus insert, via NOT NULL + FK.
            discoveryResultId: sql<number>`(select id from external_discovery_results where id = ${result.id} and review_status = 'Added provisionally' and linked_internal_alumnus_id = (select id from alumni where profile_key = ${profileKey}) and (select count(*) from alumni where rtrim(lower(linkedin_url), '/') = rtrim(lower(${provisionalValues.linkedinUrl}), '/')) = 1)`,
            searchId: result.searchId,
            provider: "coresignal", providerPersonId: item.providerPersonId, sourceProfileUrl: result.linkedinUrl, normalizedProfileKey: item.profileKey,
            providerObservationsJson: JSON.stringify(observations), queryConstraintsJson: search.filtersJson,
            verificationStateJson: JSON.stringify({ institution: "UNVERIFIED", graduationYear: "UNVERIFIED", programme: "UNVERIFIED", currentCompany: "UNVERIFIED", identity: "PROVIDER_ID_AND_PROFILE_URL_ONLY", queryMatched: true, reviewerEvidenceId: latestEvidenceId.get(result.id) ?? null, reviewerEvidenceDecision: latestEvidence.get(result.id) ?? null }),
            intakeActorUserId: context.userId, intakeActorName: context.displayName, createdAt: now,
          }),
          db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
            actorRole: context.role, action: "external_candidate_provisionally_added", entityType: "discovery_result", entityId: String(result.id),
            metadataJson: safeAuditMetadata({ searchId: result.searchId, providerPersonId: item.providerPersonId, alumniStatus: "PROVISIONAL", source: "provider_identity_only", providerCalls: 0 }),
            result: "success", source: "application" }),
        ])
        if (inserted.length !== 1 || linked.length !== 1) throw new Error("Provisional intake changed concurrently; no additional candidate was approved.")
        added.push({ resultId: result.id, alumnusId: inserted[0].id })
      } catch (error) {
        if (!isIdentityConflict(error)) throw error
        executionExclusions.push({ ...item, decision: "REVIEW_REQUIRED", reason: "Identity or result changed concurrently; review before retrying." })
      }
    }
    return Response.json({ ...preflight, addedCount: added.length, added, excludedCount: executionExclusions.length, excluded: executionExclusions,
      providerCalls: 0, verifiedPromotions: 0 }, { status: added.length ? 201 : 409 })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Provisional intake failed." }, { status: 500 })
  }
}
