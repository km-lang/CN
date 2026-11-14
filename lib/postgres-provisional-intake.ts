import { and, eq, inArray, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, externalDiscoveryCandidateEvidence, externalDiscoveryResults, externalDiscoverySearches, provisionalAlumniIntakes, securityAuditEvents } from "@/db/postgres/schema"
import { resultProviderIntegrity } from "@/lib/discovery-runs"
import { assessProvisionalIntake, provisionalAlumnusValues, type IntakeCandidate } from "@/lib/provisional-intake"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

class IntakeIdentityConflict extends Error {}

function isIdentityConflict(error: unknown): boolean {
  if (error instanceof IntakeIdentityConflict) return true
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String(error.code) : ""
  return ["23505", "23503", "23502", "23514"].includes(code) || "cause" in error && isIdentityConflict(error.cause)
}

export async function postgresProvisionalIntake(context: SecurityContext, action: "preflight" | "execute", resultIds: number[]) {
  const db = getPostgresDb()
  const [results, knownAlumni, evidence] = await Promise.all([
    db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds)),
    db.select({ id: alumni.id, name: alumni.name, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni),
    db.select({ resultId: externalDiscoveryCandidateEvidence.resultId, reviewerDecision: externalDiscoveryCandidateEvidence.reviewerDecision, id: externalDiscoveryCandidateEvidence.id }).from(externalDiscoveryCandidateEvidence)
      .where(inArray(externalDiscoveryCandidateEvidence.resultId, resultIds)).orderBy(externalDiscoveryCandidateEvidence.id),
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
      latestEvidenceDecision: latestEvidence.get(id) }
  })
  const assessments = assessProvisionalIntake(candidates, knownAlumni)
  const eligible = assessments.filter(item => item.decision === "ELIGIBLE")
  const excluded = assessments.filter(item => item.decision !== "ELIGIBLE")
  const preflight = { selectedCount: resultIds.length, eligibleCount: eligible.length, excludedCount: excluded.length, assessments,
    consequences: "Eligible profiles enter the main Directory as PROVISIONAL. Education, programme, graduation year, employer, contact details and outreach consent remain unknown or unverified. No provider request or verified promotion occurs." }
  if (action === "preflight") return Response.json({ ...preflight, providerCalls: 0, databaseWrites: 0 })
  if (!eligible.length) return Response.json({ ...preflight, addedCount: 0, added: [], alreadyPresentCount: excluded.filter(item => item.decision === "ALREADY_PRESENT").length,
    providerCalls: 0, verifiedPromotions: 0 }, { status: excluded.every(item => item.decision === "ALREADY_PRESENT") ? 200 : 409 })

  const now = new Date().toISOString()
  const added: Array<{ resultId: number; alumnusId: number }> = []
  const executionExclusions = [...excluded]
  for (const item of eligible) {
    const result = resultById.get(item.resultId)!
    const search = searchById.get(result.searchId)!
    const provisionalValues = provisionalAlumnusValues(result, context.displayName, now)
    const observations = { providerResultId: result.providerResultId, name: result.name, education: result.education,
      educationProgramme: result.educationProgramme, graduationYear: result.graduationYear,
      educationStartDate: result.educationStartDate, educationEndDate: result.educationEndDate,
      institutionId: result.institutionId, institutionUrl: result.institutionUrl,
      currentCompany: result.currentCompany, currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl,
      currentRoleAmbiguous: result.currentRoleAmbiguous, role: result.role, rawTitle: result.rawTitle,
      function: result.function, seniority: result.seniority, location: result.location, providerFreshnessAt: result.providerFreshnessAt,
      affiliationStatus: result.affiliationStatus, matchStatus: result.matchStatus, reviewNote: result.reviewNote }
    try {
      const createdId = await db.transaction(async tx => {
        // D1's write batch serializes writers. The table lock covers identities
        // created by other PostgreSQL mutation paths that do not share a lock.
        await tx.execute(sql`lock table alumni in share row exclusive mode`)
        const [currentResult] = await tx.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, result.id)).for("update").limit(1)
        if (!currentResult || currentResult.reviewStatus !== "Pending review" || currentResult.linkedInternalAlumnusId !== null) throw new IntakeIdentityConflict()
        const [inserted] = await tx.insert(alumni).values(provisionalValues).returning({ id: alumni.id })
        const [identityCount] = await tx.select({ count: sql<number>`count(*)::integer` }).from(alumni)
          .where(sql`rtrim(lower(${alumni.linkedinUrl}), '/') = rtrim(lower(${provisionalValues.linkedinUrl}), '/')`)
        if (identityCount.count !== 1) throw new IntakeIdentityConflict()
        const [linked] = await tx.update(externalDiscoveryResults).set({ reviewStatus: "Added provisionally",
          linkedInternalAlumnusId: inserted.id, reviewedAt: now, reviewedBy: context.displayName })
          .where(and(eq(externalDiscoveryResults.id, result.id), eq(externalDiscoveryResults.reviewStatus, "Pending review"), sql`${externalDiscoveryResults.linkedInternalAlumnusId} is null`))
          .returning({ id: externalDiscoveryResults.id })
        if (!linked) throw new IntakeIdentityConflict()
        await tx.insert(provisionalAlumniIntakes).values({ alumnusId: inserted.id, discoveryResultId: result.id,
          searchId: result.searchId, provider: "coresignal", providerPersonId: item.providerPersonId,
          sourceProfileUrl: result.linkedinUrl, normalizedProfileKey: item.profileKey,
          providerObservationsJson: JSON.stringify(observations), queryConstraintsJson: search.filtersJson,
          verificationStateJson: JSON.stringify({ institution: "UNVERIFIED", graduationYear: "UNVERIFIED", programme: "UNVERIFIED",
            currentCompany: "UNVERIFIED", identity: "PROVIDER_ID_AND_PROFILE_URL_ONLY", queryMatched: true,
            reviewerEvidenceId: latestEvidenceId.get(result.id) ?? null, reviewerEvidenceDecision: latestEvidence.get(result.id) ?? null }),
          intakeActorUserId: context.userId, intakeActorName: context.displayName, createdAt: now })
        await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
          actorName: context.displayName, actorRole: context.role, action: "external_candidate_provisionally_added",
          entityType: "discovery_result", entityId: String(result.id),
          metadataJson: safeAuditMetadata({ searchId: result.searchId, providerPersonId: item.providerPersonId,
            alumniStatus: "PROVISIONAL", source: "provider_identity_only", providerCalls: 0 }),
          result: "success", source: "application" })
        return inserted.id
      })
      added.push({ resultId: result.id, alumnusId: createdId })
    } catch (error) {
      if (!isIdentityConflict(error)) throw error
      executionExclusions.push({ ...item, decision: "REVIEW_REQUIRED", reason: "Identity or result changed concurrently; review before retrying." })
    }
  }
  return Response.json({ ...preflight, addedCount: added.length, added, excludedCount: executionExclusions.length, excluded: executionExclusions,
    providerCalls: 0, verifiedPromotions: 0 }, { status: added.length ? 201 : 409 })
}
