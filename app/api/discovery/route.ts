import { env } from "cloudflare:workers"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, externalDiscoveryCandidateEvidence, externalDiscoveryResults, externalDiscoverySearches, fieldChangeHistory, providerResponseHistory, providerSettings, securityAuditEvents } from "@/db/schema"
import { FIXED_ALUMNI_SCHOOL, criteriaSummary, defaultDiscoveryFilters, matchesDiscoverySeniorities, normalizeDiscoveryFiltersInput, normalizeFunction, normalized, type DiscoveryFilters, type DiscoveryProfile, type MatchStatus } from "@/lib/alumni-search"
import { coresignalProvider } from "@/lib/coresignal-adapter"
import { CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, coresignalEmployeeEsDslGraduationYear, safeCoresignalError } from "@/lib/coresignal-client"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { validateDiscoveryCount } from "@/lib/discovery-limit"
import { PROFESSIONAL_DATA_PROVIDER, PROFESSIONAL_DATA_PROVIDER_LABEL } from "@/lib/professional-data"
import { coresignalExactYearPreviewEnabled, coresignalExactYearPreviewEntitlement, coresignalLiveSearchMaximum, coresignalRegularSearchEnabled, providerConfigured, type ProviderRuntimeEnvironment } from "@/lib/provider-runtime"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { accessErrorResponse, authorizeRequest, safeAuditMetadata, writeSecurityAudit } from "@/lib/security"
import { discoveryQualification, normalizeCoresignalProgramme, validateDiscoveryProgrammeSelections } from "@/lib/discovery-qualification"
import { discoveredAlumniYearValues } from "@/lib/alumni-education"
import { discoveryClassificationCounts, discoveryRunSummary, isActionableDiscoveryReview, persistedDiscoveryExecutionSummary, previousDiscoveryRuns, resultProviderIntegrity, selectActiveDiscoveryRun } from "@/lib/discovery-runs"
import { discoveryCoveragePlan } from "@/lib/discovery-coverage"
import { CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES } from "@/lib/discovery-provider-capabilities"
import { reconcileDiscoveryCandidate, reconcileDiscoveryCandidates, selectiveCollectSummary, type ReconciliationCandidate, type RejectedCandidateEvidence } from "@/lib/discovery-reconciliation"
import { persistedSearchConstraintEvidence, qualifyCollectedCandidate, qualifyPreviewCandidate, titleSeniority, type DiscoveryExecutionCandidate, type DiscoverySearchConstraintEvidence } from "@/lib/discovery-execution"
import { attachCoresignalIdentity, reconcileCoresignalIdentity } from "@/lib/coresignal-identity"
import { coresignalIdentityStore } from "@/lib/coresignal-identity-store"
import { executeCoresignalRegularSearch, prepareCoresignalRegularSearch, CORESIGNAL_REGULAR_SEARCH_MAX_REQUESTS } from "@/lib/coresignal-regular-search"
import { coresignalSearchIdLookupStore } from "@/lib/coresignal-search-id-store"
import { providerCompanyMappingStore } from "@/lib/provider-company-mapping-store"
import { resolveProviderCompanyMapping } from "@/lib/provider-company-mapping"
import { CoresignalSearchEvidencePersistenceError, createCoresignalSearchEvidence, executeAndPersistCoresignalSearchEvidence, presentProviderHistorySearchEvidence, serializeCoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { candidateEvidenceDecisions, candidateEvidenceOutcome, normalizeCandidateObservation, validateReviewerDecisions, type EvidenceDecisions } from "@/lib/discovery-candidate-evidence"
import { sha256Text, stableMutationPayload } from "@/lib/mutation-fingerprint"

const DEFAULT_APPLICATION_LIMIT = 25
const affiliationStatuses = new Set(["Confirmed degree alumnus", "Potential alumnus — review required", "Short-term / exchange affiliation"])
const providerRuntimeEnvironment = env as unknown as ProviderRuntimeEnvironment
let coresignalContinuationInFlight = false

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL" }
function providerLabel(provider: string) { return provider === PROFESSIONAL_DATA_PROVIDER ? PROFESSIONAL_DATA_PROVIDER_LABEL : provider.toLowerCase() === "pdl" ? "PDL" : provider }

export function normalizedDiscoveryFilters(value: unknown): DiscoveryFilters {
  return normalizeDiscoveryFiltersInput(value)
}

function storedDiscoveryFilters(value: string) {
  try { return normalizedDiscoveryFilters(JSON.parse(value)) } catch { return defaultDiscoveryFilters() }
}

function latestEvidence(rows: readonly (typeof externalDiscoveryCandidateEvidence.$inferSelect)[], resultId: number) {
  return rows.filter(row => row.resultId === resultId).at(-1) ?? null
}

function supportingHumanEvidence(row: typeof externalDiscoveryCandidateEvidence.$inferSelect | null, result: typeof externalDiscoveryResults.$inferSelect, now: Date) {
  if (!row || row.searchId !== result.searchId || row.provider !== result.provider || row.providerPersonId !== result.providerPersonId || row.reviewerDecision !== "SUPPORTS") return false
  const programme = normalizeCoresignalProgramme(row.programme)
  const year = row.graduationYear ?? row.educationEndYear
  return Boolean(programme.code && year && year < now.getUTCFullYear() && normalizeProfessionalProfileUrl(row.profileUrl))
}

function reviewedAlumnusValues(result: typeof externalDiscoveryResults.$inferSelect, evidence: typeof externalDiscoveryCandidateEvidence.$inferSelect, actor: string, now: string) {
  const programme = normalizeCoresignalProgramme(evidence.programme).code!
  const year = evidence.graduationYear ?? evidence.educationEndYear!
  const baseline = alumnusValues(result, actor, now)
  const designation = evidence.currentDesignation || "Not verified"
  const derivedSeniority = titleSeniority(evidence.currentDesignation)
  const decisions = JSON.parse(evidence.decisionsJson) as EvidenceDecisions
  return {
    ...baseline, ...discoveredAlumniYearValues(year), programme, education: evidence.observedInstitution,
    company: evidence.currentCompany || "Not verified", title: designation, rawTitle: evidence.currentDesignation,
    function: evidence.currentDesignation ? normalizeFunction("", evidence.currentDesignation) : "Other",
    seniority: derivedSeniority.ambiguous ? "Unknown/Unclassified" : derivedSeniority.bucket,
    location: evidence.location || "Not verified", linkedinUrl: normalizeProfessionalProfileUrl(evidence.profileUrl),
    coresignalEmployeeId: result.providerPersonId, iimlAffiliationStatus: "Confirmed degree alumnus",
    iimlEducationProgramme: evidence.programme, iimlEducationStartDate: evidence.educationStartYear ? String(evidence.educationStartYear) : "",
    iimlEducationEndDate: evidence.educationEndYear ? String(evidence.educationEndYear) : "",
    currentCompanyId: "", currentCompanyUrl: "", currentRoleStartDate: "", currentIndustry: "", currentRoleAmbiguous: false,
    profileMatch: "Confirmed", currentCompanyVerification: decisions.company === "MATCH" ? "Verified" : "Unverified",
    designationVerification: decisions.role === "MATCH" ? "Verified" : "Unverified",
    locationVerification: decisions.location === "MATCH" ? "Verified" : "Unverified",
    source: "Human-reviewed Coresignal discovery", verified: `Human-reviewed external candidate · ${now.slice(0, 10)}`,
    note: `IIM Lucknow affiliation and selected search criteria were reviewed in external discovery evidence #${evidence.id}. Placement context has not been assessed.`,
  }
}

function missingEvidenceTable(error: unknown) {
  return /no such table: external_discovery_candidate_evidence/i.test(String(error))
}

async function evidenceForResults(db: ReturnType<typeof getDb>, resultIds: number[]) {
  if (!resultIds.length) return { rows: [] as (typeof externalDiscoveryCandidateEvidence.$inferSelect)[], available: true }
  try {
    const rows = await db.select().from(externalDiscoveryCandidateEvidence).where(inArray(externalDiscoveryCandidateEvidence.resultId, resultIds)).orderBy(externalDiscoveryCandidateEvidence.id)
    return { rows, available: true }
  } catch (error) {
    if (missingEvidenceTable(error)) return { rows: [], available: false }
    throw error
  }
}

function qualificationForResult(result: typeof externalDiscoveryResults.$inferSelect, filters: DiscoveryFilters, now: Date) {
  if (result.provider !== PROFESSIONAL_DATA_PROVIDER) return {
    normalizedProgramme: result.educationProgramme,
    programmeStatus: result.educationProgramme ? "Programme matched" : "Programme requires review",
    alumniStatus: result.graduationYear > 0 && result.graduationYear < now.getUTCFullYear() ? "Past alumnus" : "Graduation status unknown — review required",
    programmeMatchesSelection: true,
    eligibleForAddition: result.affiliationStatus === "Confirmed degree alumnus",
  }
  const qualification = discoveryQualification(result.educationProgramme, result.educationEndDate, filters.discoveryProgrammes, now)
  const returnedFiltersMatch = (!filters.company || normalized(result.currentCompany) === normalized(filters.company))
    && (!filters.role || normalized(result.role).includes(normalized(filters.role)))
    && (filters.function === "All functions" || result.function === filters.function)
    && matchesDiscoverySeniorities(result.seniority, filters)
    && (!filters.location || normalized(result.location).includes(normalized(filters.location)))
    && (!filters.graduationYear || result.graduationYear === Number(filters.graduationYear))
  return { ...qualification, eligibleForAddition: qualification.eligibleForAddition && returnedFiltersMatch && !result.currentRoleAmbiguous }
}

function reconciliationPresentation(reconciliation?: ReturnType<typeof reconcileDiscoveryCandidate>) {
  return reconciliation ? {
    plannerClassification: reconciliation.classification,
    collectDecision: reconciliation.collectDecision,
    plannerReasonCode: reconciliation.reasonCode,
    plannerRationale: reconciliation.rationale,
    reconciledAlumnusId: reconciliation.linkedAlumnusId,
  } : {}
}

function presentResult(result: typeof externalDiscoveryResults.$inferSelect, filters: DiscoveryFilters, now: Date, search?: typeof externalDiscoverySearches.$inferSelect) {
  return {
    ...result,
    ...qualificationForResult(result, filters, now),
    searchProvider: search?.provider ?? "",
    searchMode: search?.mode ?? "",
    retrievedAt: result.createdAt,
    actionableReview: isActionableDiscoveryReview(result),
    providerIntegrity: search ? resultProviderIntegrity(search.provider, result.provider) : "search_missing",
  }
}

function profileCandidate(profile: DiscoveryProfile): ReconciliationCandidate {
  return {
    candidateKey: profile.providerResultId || profile.providerPersonId,
    providerEmployeeId: profile.providerPersonId,
    profileUrl: profile.linkedinUrl,
    name: profile.name,
    educationInstitution: profile.education,
    programme: profile.normalizedProgramme || profile.educationProgramme,
    graduationYear: profile.graduationYear,
    currentCompany: profile.currentCompany,
    currentTitle: profile.role,
  }
}

function storedCandidate(result: typeof externalDiscoveryResults.$inferSelect): ReconciliationCandidate {
  return {
    candidateKey: result.providerResultId || result.providerPersonId,
    providerEmployeeId: result.providerPersonId || result.providerResultId,
    profileUrl: result.linkedinUrl,
    name: result.name,
    educationInstitution: result.education,
    programme: result.educationProgramme,
    graduationYear: result.graduationYear,
    currentCompany: result.currentCompany,
    currentTitle: result.role,
  }
}

function rejectedEvidence(results: readonly (typeof externalDiscoveryResults.$inferSelect)[]): RejectedCandidateEvidence[] {
  return results.filter(result => result.reviewStatus === "Ignored").map(result => ({ ...storedCandidate(result), reviewStatus: result.reviewStatus, resultId: result.id }))
}

function classify(profile: DiscoveryProfile, people: (typeof alumni.$inferSelect)[], rejected: readonly RejectedCandidateEvidence[], execution?: DiscoveryExecutionCandidate) {
  const reconciliation = execution?.reconciliation ?? reconcileDiscoveryCandidate(profileCandidate(profile), people, rejected, CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  if (["KNOWN_PROVIDER_ID", "KNOWN_PROFILE_URL", "KNOWN_STRONG_IDENTITY"].includes(reconciliation.classification)) {
    return { matchStatus: "Already in database" as MatchStatus, linkedInternalAlumnusId: reconciliation.linkedAlumnusId, matchConfidence: Math.max(95, profile.matchConfidence), reconciliation }
  }
  if (reconciliation.classification === "NEW_CANDIDATE" && (!execution || execution.finalStatus === "QUALIFIED_FOR_REVIEW") && profile.affiliationStatus === "Confirmed degree alumnus" && !profile.currentRoleAmbiguous && profile.eligibleForAddition) {
    return { matchStatus: "New" as MatchStatus, linkedInternalAlumnusId: null, matchConfidence: profile.matchConfidence, reconciliation }
  }
  const possibleDuplicate = reconciliation.classification === "AMBIGUOUS" && reconciliation.reasonCode.includes("MATCH")
  return { matchStatus: (possibleDuplicate ? "Possible duplicate" : "Needs review") as MatchStatus, linkedInternalAlumnusId: reconciliation.linkedAlumnusId, matchConfidence: Math.min(84, profile.matchConfidence), reconciliation }
}

async function remainingApplicationUnits() {
  const db = getDb()
  await db.insert(providerSettings).values({ provider: PROFESSIONAL_DATA_PROVIDER, monthlyCreditLimit: DEFAULT_APPLICATION_LIMIT }).onConflictDoNothing()
  const [settings, usage] = await Promise.all([
    db.select().from(providerSettings).where(eq(providerSettings.provider, PROFESSIONAL_DATA_PROVIDER)).limit(1),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.provider, PROFESSIONAL_DATA_PROVIDER), sql`${providerResponseHistory.createdAt} >= ${monthStart()}`)),
  ])
  return Math.max(0, (settings[0]?.monthlyCreditLimit ?? DEFAULT_APPLICATION_LIMIT) - Number(usage[0]?.used ?? 0))
}

function resultValues(searchId: number, profile: DiscoveryProfile, match: ReturnType<typeof classify>, execution?: DiscoveryExecutionCandidate) {
  return {
    searchId, provider: PROFESSIONAL_DATA_PROVIDER, providerResultId: profile.providerResultId, providerPersonId: profile.providerPersonId,
    name: profile.name, education: profile.education, currentCompany: profile.currentCompany, role: profile.role, rawTitle: profile.rawTitle,
    function: profile.function, seniority: profile.seniority, location: profile.location, graduationYear: profile.graduationYear,
    linkedinUrl: normalizeProfessionalProfileUrl(profile.linkedinUrl), matchStatus: match.matchStatus, matchConfidence: match.matchConfidence,
    linkedInternalAlumnusId: match.linkedInternalAlumnusId, affiliationStatus: profile.affiliationStatus,
    educationProgramme: profile.educationProgramme, educationStartDate: profile.educationStartDate, educationEndDate: profile.educationEndDate,
    institutionId: profile.institutionId, institutionUrl: profile.institutionUrl, currentCompanyId: profile.currentCompanyId,
    currentCompanyUrl: profile.currentCompanyUrl, currentRoleStartDate: profile.currentRoleStartDate, currentIndustry: profile.currentIndustry,
    currentRoleAmbiguous: profile.currentRoleAmbiguous, providerFreshnessAt: profile.providerFreshnessAt,
    reviewNote: execution ? `${execution.collectionState}: ${execution.collectionRationale}` : "",
  }
}

function executionPresentation(execution?: DiscoveryExecutionCandidate) {
  return execution ? {
    qualification: execution.qualification,
    collectionState: execution.collectionState,
    collectionRationale: execution.collectionRationale,
    finalDiscoveryStatus: execution.finalStatus,
  } : {}
}

const collectionStates = new Set(["COLLECT_PERFORMED", "SKIPPED_ALREADY_KNOWN", "SKIPPED_FILTER_MISMATCH", "SKIPPED_PREVIOUSLY_REJECTED", "REVIEW_BEFORE_COLLECT", "SKIPPED_COLLECT_LIMIT"])

function storedQualificationPresentation(result: typeof externalDiscoveryResults.$inferSelect, filters: DiscoveryFilters, searchConstraint?: DiscoverySearchConstraintEvidence) {
  const collectionState = result.reviewNote.split(":", 1)[0]
  if (!collectionStates.has(collectionState)) return {}
  const profile: DiscoveryProfile = {
    providerResultId: result.providerResultId, providerPersonId: result.providerPersonId, name: result.name, education: result.education,
    currentCompany: result.currentCompany, role: result.role, rawTitle: result.rawTitle, function: result.function, seniority: result.seniority,
    location: result.location, graduationYear: result.graduationYear, linkedinUrl: result.linkedinUrl, matchConfidence: result.matchConfidence,
    affiliationStatus: result.affiliationStatus as DiscoveryProfile["affiliationStatus"], educationProgramme: result.educationProgramme,
    normalizedProgramme: normalizeCoresignalProgramme(result.educationProgramme).code ?? "", programmeStatus: normalizeCoresignalProgramme(result.educationProgramme).status,
    alumniStatus: qualificationForResult(result, filters, new Date()).alumniStatus as DiscoveryProfile["alumniStatus"], eligibleForAddition: false,
    educationStartDate: result.educationStartDate, educationEndDate: result.educationEndDate, institutionId: result.institutionId, institutionUrl: result.institutionUrl,
    currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl, currentRoleStartDate: result.currentRoleStartDate,
    currentIndustry: result.currentIndustry, currentRoleAmbiguous: result.currentRoleAmbiguous, providerFreshnessAt: result.providerFreshnessAt,
  }
  const qualification = collectionState === "COLLECT_PERFORMED" ? qualifyCollectedCandidate(profile, filters) : qualifyPreviewCandidate(profile, filters, searchConstraint)
  return { qualification, collectionState, collectionRationale: result.reviewNote.slice(collectionState.length + 1).trim() }
}

function alumnusValues(result: typeof externalDiscoveryResults.$inferSelect, actor: string, now: string, suffix = "") {
  const label = providerLabel(result.provider)
  const isCoresignal = result.provider === PROFESSIONAL_DATA_PROVIDER
  return {
    profileKey: result.providerPersonId ? `${result.provider}:${normalized(result.providerPersonId)}` : `${result.provider}-reviewed:${result.id}`,
    name: result.name, initials: initials(result.name), ...discoveredAlumniYearValues(result.graduationYear),
    programme: isCoresignal ? normalizeCoresignalProgramme(result.educationProgramme).code || "Not confirmed" : result.educationProgramme || "Not confirmed", education: result.education || FIXED_ALUMNI_SCHOOL,
    company: result.currentCompany, title: result.role, rawTitle: result.rawTitle, function: result.function, seniority: result.seniority,
    location: result.location, confidence: result.affiliationStatus === "Confirmed degree alumnus" ? 70 : 55,
    linkedinUrl: normalizeProfessionalProfileUrl(result.linkedinUrl),
    ...(isCoresignal ? { lastProfessionalDataRefresh: now } : { pdlPersonId: result.providerPersonId, lastPdlRefresh: now }),
    discoverySource: label, discoveryDate: now, professionalDataProvider: label, providerFreshnessAt: result.providerFreshnessAt,
    iimlAffiliationStatus: result.affiliationStatus, iimlEducationProgramme: result.educationProgramme,
    iimlEducationStartDate: result.educationStartDate, iimlEducationEndDate: result.educationEndDate,
    iimlInstitutionId: result.institutionId, iimlInstitutionUrl: result.institutionUrl,
    currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl,
    currentRoleStartDate: result.currentRoleStartDate, currentIndustry: result.currentIndustry, currentRoleAmbiguous: result.currentRoleAmbiguous,
    verified: `Professional profile sourced via ${label}${suffix} · ${now.slice(0, 10)}`, status: "Not contacted",
    note: `${label} established IIML education affiliation. Qualification: ${result.affiliationStatus}. Placement context has not been assessed.`,
    source: label, updatedBy: actor, updatedAt: now,
  }
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const db = getDb(); const url = new URL(request.url); const view = url.searchParams.get("view") === "pending" ? "pending" : "summary"
    const requestedSearchIdValue = url.searchParams.get("searchId")
    const requestedSearchId = requestedSearchIdValue === null ? null : Number(requestedSearchIdValue)
    if (requestedSearchIdValue !== null && (!Number.isInteger(requestedSearchId) || requestedSearchId! <= 0)) return Response.json({ error: "A valid discovery search ID is required." }, { status: 400 })
    const recentSearches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10)
    const pendingResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending)).orderBy(desc(externalDiscoveryResults.searchId), externalDiscoveryResults.id)
    const actionablePendingResults = pendingResults.filter(isActionableDiscoveryReview)
    const candidateSearchId = requestedSearchId ?? actionablePendingResults[0]?.searchId ?? recentSearches[0]?.id ?? null
    const candidateOutsideRecent = candidateSearchId !== null && !recentSearches.some(search => search.id === candidateSearchId)
      ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, candidateSearchId)).limit(1)
      : []
    const searchPool = [...candidateOutsideRecent, ...recentSearches]
    const activeSearch = selectActiveDiscoveryRun(searchPool, pendingResults, requestedSearchId)
    if (requestedSearchId && !activeSearch) return Response.json({ error: "The requested discovery search was not found." }, { status: 404 })
    const historySearchIds = [...new Set(searchPool.map(search => search.id))]
    const historyResults = historySearchIds.length ? await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId, historySearchIds)).orderBy(desc(externalDiscoveryResults.searchId), externalDiscoveryResults.id) : []
    const activeResults = activeSearch ? historyResults.filter(result => result.searchId === activeSearch.id) : []
    const candidateEvidence = await evidenceForResults(db, activeResults.map(result => result.id))
    const evidenceByResult = new Map<number, (typeof candidateEvidence.rows)>()
    for (const row of candidateEvidence.rows) evidenceByResult.set(row.resultId, [...(evidenceByResult.get(row.resultId) ?? []), row])
    const activeProviderHistoryRows = activeSearch ? await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.searchId, activeSearch.id)).orderBy(providerResponseHistory.id) : []
    const activeProviderHistory = activeProviderHistoryRows.map(presentProviderHistorySearchEvidence)
    const activeSearchSummary = activeSearch ? discoveryRunSummary(activeSearch, activeResults, activeProviderHistory) : null
    const previousSearches = previousDiscoveryRuns(recentSearches, historyResults, activeSearch?.id ?? null)
    const history = previousDiscoveryRuns(recentSearches, historyResults, null)
    const common = { pendingCount: actionablePendingResults.length, mode: coresignalProvider.mode(), searches: recentSearches, history, previousSearches, configured: coresignalProvider.configured(), canonicalInstitutionConfigured: true, liveMaximum: coresignalLiveSearchMaximum(), provider: PROFESSIONAL_DATA_PROVIDER, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, exactYearPreview: { enabled: coresignalExactYearPreviewEnabled(providerRuntimeEnvironment), entitlement: coresignalExactYearPreviewEntitlement(providerRuntimeEnvironment), endpoint: "/cdapi/v2/employee_base/search/es_dsl/preview", maximumRequests: 1, maximumPreviewResults: 20, maximumPages: 50, automaticPagination: false, automaticCollect: false, providerCost: "20 search credits per requested Preview page (vendor workbook); account debit remains reconciled separately" }, regularSearch: { enabled: coresignalRegularSearchEnabled(providerRuntimeEnvironment), configured: providerConfigured("coresignal", providerRuntimeEnvironment), maxRequests: CORESIGNAL_REGULAR_SEARCH_MAX_REQUESTS, automaticPagination: false } }
    if (view === "summary") return Response.json(common)
    if (!activeSearch) return Response.json({ ...common, activeSearch: null, results: [], counts: discoveryClassificationCounts([]), filters: defaultDiscoveryFilters(), providerHistory: [], retrieval: "stored", source: null })
    const filters = storedDiscoveryFilters(activeSearch.filtersJson)
    const [people, ignoredResults] = activeSearch.provider === PROFESSIONAL_DATA_PROVIDER ? await Promise.all([
      db.select().from(alumni).orderBy(alumni.id),
      db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, "Ignored")),
    ]) : [[], []]
    const reconciliations = activeSearch.provider === PROFESSIONAL_DATA_PROVIDER
      ? reconcileDiscoveryCandidates(activeResults.map(storedCandidate), people, rejectedEvidence(ignoredResults), CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
      : []
    const reconciliationByKey = new Map(reconciliations.map(item => [item.candidateKey, item]))
    const searchConstraint = persistedSearchConstraintEvidence(filters, activeProviderHistoryRows)
    const presentedResults = activeResults.map(result => {
      const humanEvidence = evidenceByResult.get(result.id) ?? []
      const latest = latestEvidence(candidateEvidence.rows, result.id)
      const reviewedIdentity = latest && activeSearch.provider === PROFESSIONAL_DATA_PROVIDER
        ? reconcileDiscoveryCandidate({ ...storedCandidate(result), profileUrl: latest.profileUrl, programme: latest.programme, graduationYear: latest.graduationYear ?? latest.educationEndYear ?? 0, educationInstitution: latest.observedInstitution }, people, rejectedEvidence(ignoredResults), CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
        : null
      const humanQualified = supportingHumanEvidence(latest, result, new Date()) && reviewedIdentity?.classification === "NEW_CANDIDATE"
      return { ...presentResult(result, filters, new Date(), activeSearch), ...reconciliationPresentation(reconciliationByKey.get(storedCandidate(result).candidateKey)), ...storedQualificationPresentation(result, filters, searchConstraint), humanEvidence, humanEvidenceAvailable: candidateEvidence.available, humanQualified, reviewedIdentity: reviewedIdentity?.classification ?? null, reviewedAlumnusId: reviewedIdentity?.linkedAlumnusId ?? null }
    })
    const counts = discoveryClassificationCounts(activeResults)
    const storedExecution = persistedDiscoveryExecutionSummary(activeProviderHistoryRows)
    const executionSummary = storedExecution ? {
      ...storedExecution,
      seniorityInsufficientEvidence: presentedResults.filter(result => result.qualification?.seniority.result === "INSUFFICIENT_EVIDENCE").length,
      confirmedFilterMatches: presentedResults.filter(result => result.qualification
        && ["MATCH", "NAME_MATCH_IDENTITY_UNVERIFIED", "NOT_REQUESTED"].includes(result.qualification.company.result)
        && ["MATCH", "NOT_REQUESTED"].includes(result.qualification.seniority.result)
        && ["EXACT_YEAR_VERIFIED", "EXACT_YEAR_QUERY_MATCH"].includes(result.qualification.graduationYear.result)).length,
      reviewBeforeCollect: presentedResults.filter(result => result.reviewStatus === "Pending review"
        && String(result.reviewNote ?? "").startsWith("REVIEW_BEFORE_COLLECT:")).length,
    } : null
    return Response.json({ ...common, activeSearch: activeSearchSummary, results: presentedResults, counts, reconciliationSummary: reconciliations.length ? selectiveCollectSummary(reconciliations) : null, executionSummary, filters, providerHistory: context.role === "ADMIN" ? activeProviderHistory : [], historyRestricted: context.role !== "ADMIN", creditsUsed: activeSearch.creditsUsed, retrieval: "stored", source: { provider: activeSearch.provider, mode: activeSearch.mode, searchId: activeSearch.id, createdAt: activeSearch.createdAt } })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to load discovery history." }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; filters?: Partial<DiscoveryFilters>; graduationYears?: number[]; limit?: number; confirmed?: boolean; searchId?: number; page?: number; resultIds?: number[]; resultId?: number; fields?: string[]; reason?: string; affiliationStatus?: string; observation?: unknown; decisions?: unknown }
    const context = await authorizeRequest(request, "OPERATE_PCOM"); const db = getDb(); const actor = context.displayName; const nowDate = new Date(); const now = nowDate.toISOString()

    if (payload.action === "record_evidence") {
      if (!Number.isInteger(payload.resultId) || Number(payload.resultId) <= 0) return Response.json({ error: "A discovery result ID is required." }, { status: 400 })
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      if (!result || !search || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || resultProviderIntegrity(search.provider, result.provider) !== "consistent" || !result.providerPersonId) return Response.json({ error: "Only a pending result with consistent provider identity can receive review evidence." }, { status: 409 })
      const observation = normalizeCandidateObservation(payload.observation)
      const decisions = validateReviewerDecisions(payload.decisions, candidateEvidenceDecisions(observation, storedDiscoveryFilters(search.filtersJson), result.linkedinUrl, nowDate))
      const reviewerDecision = candidateEvidenceOutcome(decisions)
      const decisionsJson = stableMutationPayload(decisions)
      const fingerprint = await sha256Text(stableMutationPayload({ resultId: result.id, observation, decisions }))
      try {
        const [exactReplay] = await db.select().from(externalDiscoveryCandidateEvidence).where(and(eq(externalDiscoveryCandidateEvidence.resultId, result.id), eq(externalDiscoveryCandidateEvidence.requestKey, fingerprint))).limit(1)
        if (exactReplay) return Response.json({ saved: false, duplicate: true, evidence: exactReplay })
        const [previous] = await db.select().from(externalDiscoveryCandidateEvidence).where(eq(externalDiscoveryCandidateEvidence.resultId, result.id)).orderBy(desc(externalDiscoveryCandidateEvidence.id)).limit(1)
        if (previous && previous.reviewerDecision !== reviewerDecision && observation.verificationReason.length < 30) return Response.json({ error: `This decision conflicts with saved evidence #${previous.id}. Explain the changed conclusion in at least 30 characters; prior evidence remains visible.` }, { status: 409 })
        const insertEvidence = db.insert(externalDiscoveryCandidateEvidence).values({
          searchId: search.id, resultId: result.id, provider: result.provider, providerPersonId: result.providerPersonId,
          ...observation, sourceProvenance: previous && previous.reviewerDecision !== reviewerDecision ? `HUMAN_ENTERED_REVIEW_REVISION_OF:${previous.id}` : "HUMAN_ENTERED", decisionsJson, reviewerDecision,
          reviewerUserId: context.userId, reviewerName: actor, requestKey: fingerprint, reviewedAt: now,
        }).returning()
        const audit = db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: actor, actorRole: context.role, action: "external_candidate_evidence_recorded", entityType: "discovery_result", entityId: String(result.id), metadataJson: safeAuditMetadata({ reviewerDecision, sourceType: observation.sourceType, provider: result.provider, requestKey: fingerprint }), result: "success", source: "application" })
        const [inserted] = await db.batch([insertEvidence, audit])
        const saved = inserted[0]
        return Response.json({ saved: true, duplicate: false, evidence: saved }, { status: 201 })
      } catch (error) {
        if (missingEvidenceTable(error)) return Response.json({ error: "Candidate evidence storage is not installed in this local database. Migration 0018 must be applied to an approved database first." }, { status: 503 })
        if (/unique constraint failed:\s*external_discovery_candidate_evidence\.(?:result_id|request_key)|idx_external_candidate_evidence_request/i.test(String(error))) {
          const [existing] = await db.select().from(externalDiscoveryCandidateEvidence).where(and(eq(externalDiscoveryCandidateEvidence.resultId, result.id), eq(externalDiscoveryCandidateEvidence.requestKey, fingerprint))).limit(1)
          if (existing) return Response.json({ saved: false, duplicate: true, evidence: existing })
        }
        throw error
      }
    }

    if (payload.action === "plan") {
      const filters = normalizedDiscoveryFilters(payload.filters)
      const history = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.provider, PROFESSIONAL_DATA_PROVIDER)).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id))
      const coverage = discoveryCoveragePlan(filters, history, { now: nowDate, provider: PROFESSIONAL_DATA_PROVIDER, mode: coresignalProvider.mode(), graduationYears: payload.graduationYears })
      return Response.json({ provider: PROFESSIONAL_DATA_PROVIDER, mode: coresignalProvider.mode(), coverage, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, providerCallMade: false, applicationUnits: 0 })
    }

    if (payload.action === "continue_search") {
      if (context.role !== "ADMIN") return Response.json({ error: "ES-DSL Preview continuation is Admin-only.", blocked: true, reason: "admin_required", providerCallMade: false }, { status: 403 })
      if (payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required for every Preview page request.", blocked: true, reason: "confirmation_required", providerCallMade: false }, { status: 400 })
      if (!Number.isInteger(payload.searchId) || Number(payload.searchId) <= 0 || !Number.isInteger(payload.page) || Number(payload.page) < 2 || Number(payload.page) > 50) return Response.json({ error: "A valid search ID and next Preview page from 2 to 50 are required.", blocked: true, reason: "invalid_continuation", providerCallMade: false }, { status: 400 })
      if (!coresignalExactYearPreviewEnabled(providerRuntimeEnvironment) || !providerConfigured("coresignal", providerRuntimeEnvironment)) return Response.json({ error: "Coresignal ES-DSL Preview is not enabled and configured.", blocked: true, reason: "preview_unavailable", providerCallMade: false }, { status: 403 })
      if (coresignalContinuationInFlight) return Response.json({ error: "Another Preview continuation is already in progress. No provider request was made.", blocked: true, reason: "continuation_in_progress", providerCallMade: false }, { status: 409 })
      coresignalContinuationInFlight = true
      try {
      const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, Number(payload.searchId))).limit(1)
      if (!search || search.provider !== PROFESSIONAL_DATA_PROVIDER || search.mode !== "live") return Response.json({ error: "Only a saved live Coresignal discovery run can be continued.", blocked: true, reason: "search_not_continuable", providerCallMade: false }, { status: 409 })
      const historyRows = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.searchId, search.id)).orderBy(providerResponseHistory.id)
      const previewRows = historyRows.filter(item => item.status === "success" && /ES-DSL Preview/.test(item.operation))
      if (!previewRows.length) return Response.json({ error: "This run has no successful ES-DSL Preview page to continue.", blocked: true, reason: "search_not_continuable", providerCallMade: false }, { status: 409 })
      const recordedPages = previewRows.map(item => Number(item.requestSummary.match(/\bpage=(\d+)\b/)?.[1] ?? 1))
      const nextPage = Math.max(...recordedPages) + 1
      if (Number(payload.page) !== nextPage) return Response.json({ error: `The next manually retrievable page is ${nextPage}.`, blocked: true, reason: "non_sequential_page", providerCallMade: false }, { status: 409 })
      if ((previewRows.at(-1)?.resultCount ?? 20) < 20) return Response.json({ error: "The preceding Preview page was not full, so no further page is available.", blocked: true, reason: "no_next_page", providerCallMade: false }, { status: 409 })
      if (await remainingApplicationUnits() < 1) return Response.json({ error: "The next Preview page was not requested because the application operation limit has been reached.", blocked: true, reason: "application_limit", providerCallMade: false }, { status: 429 })
      const filters = storedDiscoveryFilters(search.filtersJson)
      let companyId: number | undefined
      let companyName: string | undefined
      let companyIdentityMode: "VERIFIED_ID" | "EXACT_NAME" | undefined
      let expectedCompanyUrl: string | undefined
      if (filters.company) {
        const mapping = await resolveProviderCompanyMapping(filters.company, "Coresignal", providerCompanyMappingStore(db))
        if (mapping.state === "CONFLICT") return Response.json({ error: `Preview continuation blocked: ${mapping.reason}`, blocked: true, reason: "company_mapping_conflict", providerCallMade: false }, { status: 409 })
        if (mapping.state === "VERIFIED" && mapping.providerCompanyId !== null) {
          companyId = mapping.providerCompanyId; companyIdentityMode = "VERIFIED_ID"; expectedCompanyUrl = mapping.mapping?.providerCompanyUrl || undefined
        } else { companyName = filters.company; companyIdentityMode = "EXACT_NAME" }
      }
      const [people, ignoredResults, existingResults] = await Promise.all([
        db.select().from(alumni).orderBy(alumni.name),
        db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, "Ignored")),
        db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id),
      ])
      const rejected = rejectedEvidence(ignoredResults)
      const operationContext = `External Discovery continuation · Search #${search.id} · page ${nextPage}`
      let response
      try {
        response = await coresignalProvider.searchCandidates(filters, people, search.requestedCount, { rejectedCandidates: rejected, maximumCollects: 0, exactYearPreview: { companyId, companyName, companyIdentityMode, expectedCompanyUrl, operationContext, page: nextPage } })
      } catch (error) {
        const failure = safeCoresignalError(error)
        await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", searchId: search.id, operation: "ES-DSL Preview continuation", mode: "live", status: "error", applicationUnits: failure.successfulOperationCredits, providerReportedCredits: null, usageState: failure.successfulOperationCredits ? "reconciliation_required" : "not_applicable", requestSummary: `${criteriaSummary(filters)} · page=${nextPage} · explicit confirmation`, responseSummary: failure.message, errorMessage: failure.message, requestedBy: actor })
        return Response.json({ error: failure.message, blocked: true, reason: "provider_error", providerCallMade: true, applicationUnits: failure.successfulOperationCredits }, { status: failure.status === 429 ? 429 : 502 })
      }
      const existingKeys = new Set(existingResults.flatMap(result => [result.providerResultId, result.providerPersonId]).filter(Boolean))
      const uniqueProfiles = response.profiles.filter(profile => {
        const keys = [profile.providerResultId, profile.providerPersonId].filter(Boolean)
        if (keys.some(key => existingKeys.has(key))) return false
        keys.forEach(key => existingKeys.add(key))
        return true
      })
      const executionByKey = new Map((response.execution?.candidates ?? []).map(item => [item.profile.providerResultId || item.profile.providerPersonId, item]))
      for (const profile of uniqueProfiles) {
        const execution = executionByKey.get(profile.providerResultId || profile.providerPersonId)
        const classified = { profile, execution, ...classify(profile, people, rejected, execution) }
        await db.insert(externalDiscoveryResults).values(resultValues(search.id, profile, classified, execution))
      }
      const allResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id)
      const counts = discoveryClassificationCounts(allResults)
      const providerCandidatesReturned = response.execution?.metrics.previewCountReturned ?? response.totalAvailable
      await db.update(externalDiscoverySearches).set({ resultCount: search.resultCount + providerCandidatesReturned, existingCount: counts.existing, newCount: counts.new, duplicateCount: counts.possibleDuplicate }).where(eq(externalDiscoverySearches.id, search.id))
      const executionAudit = response.execution?.metrics ? ` · Selective execution ${JSON.stringify(response.execution.metrics)}` : ""
      const [history] = await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", searchId: search.id, operation: "ES-DSL Preview continuation", mode: "live", status: "success", creditsUsed: 0, applicationUnits: 1, providerReportedCredits: null, usageState: "reconciliation_required", resultCount: providerCandidatesReturned, requestSummary: `${criteriaSummary(filters)} · page=${nextPage} · explicit confirmation · same-row nested education and current-employment constraints · no retry · no automatic pagination · no Collect`, responseSummary: `${response.responseSummary} ${uniqueProfiles.length} new unique candidates persisted; ${response.profiles.length - uniqueProfiles.length} duplicates omitted.${executionAudit}`, requestedBy: actor }).returning()
      await writeSecurityAudit(context, { action: "coresignal_discovery_continuation", entityType: "discovery_search", entityId: search.id, metadata: { page: nextPage, providerCandidatesReturned, uniqueCandidatesPersisted: uniqueProfiles.length, duplicatesOmitted: response.profiles.length - uniqueProfiles.length, applicationUnits: 1 } })
      return Response.json({ continued: true, searchId: search.id, page: nextPage, returnedCount: providerCandidatesReturned, uniqueCandidatesStored: uniqueProfiles.length, duplicatesOmitted: response.profiles.length - uniqueProfiles.length, applicationUnits: 1, providerReportedCredits: null, providerHistoryId: history.id, automaticPagination: false, automaticRetry: false })
      } finally {
        coresignalContinuationInFlight = false
      }
    }

    if (payload.action === "regular_search_preflight" || payload.action === "regular_search") {
      const rawGraduationYear = payload.filters && Object.prototype.hasOwnProperty.call(payload.filters, "graduationYear")
        ? payload.filters.graduationYear
        : undefined
      try { coresignalEmployeeEsDslGraduationYear(rawGraduationYear) } catch {
        return Response.json({ error: "When supplied, graduation year must be an exact four-digit year.", blocked: true, reason: "invalid_graduation_year" }, { status: 400 })
      }
      const filters = normalizedDiscoveryFilters(payload.filters)
      const staticValidation = validateDiscoveryCount(payload.limit, Number.MAX_SAFE_INTEGER, coresignalLiveSearchMaximum(), 0)
      if (!staticValidation.ok) return Response.json({ error: staticValidation.message, blocked: true, reason: staticValidation.reason, maximumAllowed: staticValidation.maximumAllowed }, { status: 400 })
      let preparation
      try {
        preparation = await prepareCoresignalRegularSearch(
          { filters, itemsPerPage: staticValidation.requested },
          { companyMappingStore: providerCompanyMappingStore(db) },
        )
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Company Search is blocked.", blocked: true, reason: "company_mapping_blocked", providerCallMade: false, applicationUnits: 0 }, { status: 409 })
      }
      const preparationSummary = {
        provider: PROFESSIONAL_DATA_PROVIDER_LABEL,
        operation: "Base Employee ES-DSL Search",
        institution: FIXED_ALUMNI_SCHOOL,
        company: preparation.companyMappingRequired ? preparation.companyMapping.displayName : "Not constrained",
        companyMapping: preparation.companyMappingRequired ? "Verified" : "Not required",
        graduationYear: filters.graduationYear || "All years",
        seniority: "Not constrained by provider Search; applied locally later",
        pageSize: staticValidation.requested,
        maximumSearchRequests: 1,
        automaticPagination: false,
        automaticCollect: false,
        automaticCanonicalUpdate: false,
        searchMode: preparation.contract.searchMode,
      }
      if (payload.action === "regular_search_preflight") {
        return Response.json({ allowed: true, providerCallMade: false, applicationUnits: 0, filters, preparation: preparationSummary })
      }
      if (payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before Coresignal Search.", blocked: true, reason: "confirmation_required", providerCallMade: false, applicationUnits: 0 }, { status: 400 })
      if (!coresignalRegularSearchEnabled(providerRuntimeEnvironment)) return Response.json({ error: "Coresignal regular Search is disabled.", blocked: true, reason: "search_gate_disabled", providerCallMade: false, applicationUnits: 0 }, { status: 403 })
      if (!providerConfigured("coresignal", providerRuntimeEnvironment)) return Response.json({ error: "Coresignal authentication is not configured.", blocked: true, reason: "provider_not_configured", providerCallMade: false, applicationUnits: 0 }, { status: 409 })
      const remaining = await remainingApplicationUnits()
      if (remaining < 1) return Response.json({ error: "Coresignal Search was not run because the application operation limit has been reached.", blocked: true, reason: "application_limit" }, { status: 429 })
      const validation = validateDiscoveryCount(payload.limit, remaining, coresignalLiveSearchMaximum(), 0)
      if (!validation.ok) return Response.json({ error: validation.message, blocked: true, reason: validation.reason, maximumAllowed: validation.maximumAllowed }, { status: 400 })
      const queryMode = preparation.contract.searchMode.toLowerCase().replaceAll("_", "-")
      const operationContext = `External Discovery · IIM Lucknow${filters.graduationYear ? ` · exact graduation year ${filters.graduationYear}` : " · all years"}${preparation.companyMappingRequired ? ` · current company ${preparation.companyMapping.displayName}` : ""}`
      const requestSummary = `${operationContext} · institution_match=provider_institution_id · provider_institution_id=${CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID} · company_mapping=${preparation.companyMappingRequired ? "verified" : "not_required"} · is_parent=1 · items_per_page=${validation.requested} · Preview 0 · Collect 0`
      const attemptId = crypto.randomUUID()
      const requestedAt = new Date().toISOString()
      try {
        const completed = await executeAndPersistCoresignalSearchEvidence({
          execute: () => executeCoresignalRegularSearch({ filters, itemsPerPage: validation.requested, operationContext, confirmed: true }, { store: coresignalSearchIdLookupStore(db), companyMappingStore: providerCompanyMappingStore(db), searchEnabled: () => coresignalRegularSearchEnabled(providerRuntimeEnvironment) }),
          createEvidence: execution => createCoresignalSearchEvidence({
            attemptId,
            filters,
            institutionId: CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID,
            itemsPerPage: validation.requested,
            requestedAt,
            completedAt: new Date().toISOString(),
            execution,
          }),
          persist: async (execution, evidence) => {
            const remainingSummary = execution.providerCreditsRemaining === null ? "Provider remaining credits were not reported." : `Provider reported ${execution.providerCreditsRemaining} credits remaining.`
            const totalSummary = execution.routing.providerSearch.totalResults === null ? "the total result header was not supplied" : `${execution.routing.providerSearch.totalResults} total results reported`
            const summary = `One Search request succeeded. ${execution.routing.providerSearch.pageIdsReceived} IDs returned on this page; ${totalSummary}. ${remainingSummary} No Preview or Collect request was made.`
            const [history] = await db.insert(providerResponseHistory).values({
              provider: PROFESSIONAL_DATA_PROVIDER,
              alumnusName: "External alumni discovery",
              operation: execution.operation,
              mode: "live",
              status: "success",
              creditsUsed: 0,
              applicationUnits: 1,
              providerReportedCredits: null,
              usageState: "not_applicable",
              resultCount: execution.routing.providerSearch.totalResults ?? execution.routing.providerSearch.pageIdsReceived,
              requestSummary,
              responseSummary: serializeCoresignalSearchEvidence(summary, evidence),
              requestedBy: actor,
            }).returning()
            return history
          },
        })
        return Response.json({ ...completed.execution, filters, queryMode, itemsPerPage: validation.requested, preparation: preparationSummary, providerCallMade: true, applicationUnits: 1, ...(context.role === "ADMIN" ? { historyId: completed.persisted.id, searchEvidence: completed.evidence } : {}) })
      } catch (error) {
        if (error instanceof CoresignalSearchEvidencePersistenceError) {
          return Response.json({ error: error.message, blocked: true, reason: "evidence_persistence_failed", providerCallMade: true, upstreamHttpStatus: error.upstreamHttpStatus, applicationUnits: error.applicationUnits, retryAllowed: error.retryAllowed, accountingState: "RECONCILIATION_REQUIRED" }, { status: 500 })
        }
        const failure = safeCoresignalError(error)
        const outcome = failure.kind === "timeout" ? "AMBIGUOUS" : "FAILED"
        await db.insert(providerResponseHistory).values({
          provider: PROFESSIONAL_DATA_PROVIDER,
          alumnusName: "External alumni discovery",
          operation: "Base Employee ES-DSL Search",
          mode: "live",
          status: "error",
          creditsUsed: 0,
          applicationUnits: 0,
          providerReportedCredits: null,
          usageState: "not_applicable",
          requestSummary,
          responseSummary: `One Search request ${outcome === "AMBIGUOUS" ? "ended with an ambiguous timeout outcome" : "failed"}. ${failure.message} No retry, Preview, or Collect request was made.`,
          errorMessage: failure.message,
          requestedBy: actor,
        })
        return Response.json({ error: failure.message, failureType: failure.kind, outcome, blocked: true, reason: "provider_error", providerCallMade: true, applicationUnits: 0, automaticRetry: false }, { status: failure.status === 429 ? 429 : 502 })
      }
    }

    if (payload.action === "search") {
      const programmeValidation = validateDiscoveryProgrammeSelections(payload.filters && typeof payload.filters === "object" ? (payload.filters as { discoveryProgrammes?: unknown }).discoveryProgrammes ?? [] : [])
      if (!programmeValidation.ok) return Response.json({ error: programmeValidation.message, blocked: true, reason: "invalid_programme_selection", providerCallMade: false, applicationUnits: 0 }, { status: 400 })
      const filters = normalizedDiscoveryFilters(payload.filters)
      let exactYearPreview: { companyId?: number; companyName?: string; companyIdentityMode?: "VERIFIED_ID" | "EXACT_NAME"; expectedCompanyUrl?: string; operationContext: string } | undefined
      const constrainedPreview = coresignalProvider.mode() === "live" && Boolean(filters.graduationYear || filters.discoveryProgrammes.length || filters.seniorities.length)
      const previewOperation = filters.graduationYear ? "Exact-year ES-DSL Preview" : "Constrained ES-DSL Preview"
      if (constrainedPreview) {
        if (context.role !== "ADMIN") return Response.json({ error: "Constrained ES-DSL Preview is Admin-only.", blocked: true, reason: "admin_required", filters, effectiveLimit: 0 }, { status: 403 })
        if (payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before ES-DSL Preview.", blocked: true, reason: "confirmation_required", filters, effectiveLimit: 0 }, { status: 400 })
        const entitlement = coresignalExactYearPreviewEntitlement(providerRuntimeEnvironment)
        if (!coresignalExactYearPreviewEnabled(providerRuntimeEnvironment)) return Response.json({ error: entitlement === "confirmed" ? "Exact-year ES-DSL Preview is disabled by its independent server gate." : "Exact-year ES-DSL Preview is blocked until account access and billing are confirmed.", blocked: true, reason: entitlement === "confirmed" ? "exact_year_preview_gate_disabled" : "exact_year_preview_entitlement_unconfirmed", entitlement, filters, effectiveLimit: 0, providerCallMade: false, applicationUnits: 0 }, { status: 403 })
        let companyId: number | undefined
        let companyName: string | undefined
        let companyIdentityMode: "VERIFIED_ID" | "EXACT_NAME" | undefined
        let expectedCompanyUrl: string | undefined
        if (filters.company) {
          const mapping = await resolveProviderCompanyMapping(filters.company, "Coresignal", providerCompanyMappingStore(db))
          if (mapping.state === "CONFLICT") return Response.json({ error: `Exact-year Preview blocked: ${mapping.reason}`, blocked: true, reason: "company_mapping_conflict", filters, effectiveLimit: 0, providerCallMade: false, applicationUnits: 0 }, { status: 409 })
          if (mapping.state === "VERIFIED" && mapping.providerCompanyId !== null) {
            companyId = mapping.providerCompanyId
            companyIdentityMode = "VERIFIED_ID"
            expectedCompanyUrl = mapping.mapping?.providerCompanyUrl || undefined
          } else {
            companyName = filters.company
            companyIdentityMode = "EXACT_NAME"
          }
        }
        exactYearPreview = { companyId, companyName, companyIdentityMode, expectedCompanyUrl, operationContext: `External Discovery · IIM Lucknow${filters.graduationYear ? ` · exact graduation year ${filters.graduationYear}` : ""}${filters.discoveryProgrammes.length ? ` · programmes ${filters.discoveryProgrammes.join(" OR ")}` : ""}${filters.seniorities.length ? ` · seniority ${filters.seniorities.join(" OR ")}` : ""}${filters.company ? ` · current company ${filters.company} (${companyIdentityMode === "VERIFIED_ID" ? "verified provider ID" : "exact name; identity unverified"})` : ""}` }
      }
      const remaining = await remainingApplicationUnits()
      const searchOperationReserve = coresignalProvider.mode() === "live" && !constrainedPreview ? 1 : 0
      if (remaining <= searchOperationReserve) return Response.json({ error: "External search was not run because the Coresignal application limit cannot cover a Search and at least one Collect operation.", blocked: true, reason: "application_limit", filters, effectiveLimit: 0 }, { status: 429 })
      const maximum = coresignalProvider.mode() === "live" ? coresignalLiveSearchMaximum() : 100
      const validation = validateDiscoveryCount(payload.limit, remaining, maximum, searchOperationReserve)
      if (!validation.ok) return Response.json({ error: validation.message, blocked: true, reason: validation.reason, filters, effectiveLimit: 0, maximumAllowed: validation.maximumAllowed }, { status: 400 })
      const [people, ignoredResults] = await Promise.all([
        db.select().from(alumni).orderBy(alumni.name),
        db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, "Ignored")),
      ])
      const rejected = rejectedEvidence(ignoredResults)
      let response
      try { response = await coresignalProvider.searchCandidates(filters, people, validation.requested, { rejectedCandidates: rejected, maximumCollects: exactYearPreview ? 0 : validation.requested, exactYearPreview }) }
      catch (error) {
        const failure = safeCoresignalError(error)
        await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", operation: exactYearPreview ? previewOperation : "Education affiliation search", mode: coresignalProvider.mode(), status: "error", applicationUnits: failure.successfulOperationCredits, providerReportedCredits: null, usageState: failure.successfulOperationCredits ? "reconciliation_required" : "not_applicable", requestSummary: `${criteriaSummary(filters)} · Maximum requested: ${validation.requested}`, responseSummary: failure.message, errorMessage: failure.message, requestedBy: actor })
        return Response.json({ error: failure.message, failureType: failure.kind, blocked: true, reason: "provider_error", filters, effectiveLimit: validation.requested }, { status: failure.status === 429 ? 429 : 502 })
      }
      const providerCandidatesReturned = response.execution?.metrics.previewCountReturned ?? response.totalAvailable
      const [search] = await db.insert(externalDiscoverySearches).values({ provider: PROFESSIONAL_DATA_PROVIDER, filtersJson: JSON.stringify(filters), criteriaSummary: criteriaSummary(filters), requestedCount: validation.requested, resultCount: providerCandidatesReturned, creditsUsed: 0, mode: coresignalProvider.mode(), initiatedBy: actor }).returning()
      const executionByKey = new Map((response.execution?.candidates ?? []).map(item => [item.profile.providerResultId || item.profile.providerPersonId, item]))
      const reconciled = response.profiles.map(profile => {
        const execution = executionByKey.get(profile.providerResultId || profile.providerPersonId)
        return { profile, execution, ...classify(profile, people, rejected, execution) }
      })
      for (const item of reconciled) await db.insert(externalDiscoveryResults).values(resultValues(search.id, item.profile, item, item.execution))
      const counts = { existing: reconciled.filter(i => i.matchStatus === "Already in database").length, new: reconciled.filter(i => i.matchStatus === "New").length, possibleDuplicate: reconciled.filter(i => i.matchStatus === "Possible duplicate").length, needsReview: reconciled.filter(i => i.matchStatus === "Needs review").length }
      await db.update(externalDiscoverySearches).set({ existingCount: counts.existing, newCount: counts.new, duplicateCount: counts.possibleDuplicate }).where(eq(externalDiscoverySearches.id, search.id))
      const executionAudit = response.execution?.metrics ? ` · Selective execution ${JSON.stringify(response.execution.metrics)}` : ""
      const [history] = await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", searchId: search.id, operation: exactYearPreview ? previewOperation : "Education affiliation search", mode: coresignalProvider.mode(), status: "success", creditsUsed: response.usage.providerReportedUsage ?? 0, applicationUnits: response.usage.applicationUnits, providerReportedCredits: response.usage.providerReportedUsage, usageState: response.usage.usageState, resultCount: providerCandidatesReturned, requestSummary: `${criteriaSummary(filters)} · Qualified target: ${validation.requested}${exactYearPreview ? ` · page=1 · same-row nested education and current-employment constraints · no automatic Collect` : ""}`, responseSummary: `${response.responseSummary}${executionAudit}`, requestedBy: actor }).returning()
      const storedRows = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id)
      const reconciliationByKey = new Map(reconciled.map(item => [item.reconciliation.candidateKey, item.reconciliation]))
      const newEvidenceState = await evidenceForResults(db, storedRows.map(result => result.id))
      const storedResults = storedRows.map(result => {
        const execution = executionByKey.get(storedCandidate(result).candidateKey)
        return ({ ...presentResult(result, filters, nowDate, search), ...reconciliationPresentation(reconciliationByKey.get(storedCandidate(result).candidateKey)), ...executionPresentation(execution), humanEvidence: [], humanEvidenceAvailable: newEvidenceState.available, humanQualified: false })
      })
      const recentSearches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10)
      const recentSearchIds = recentSearches.map(item => item.id)
      const recentResults = recentSearchIds.length ? await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId, recentSearchIds)) : []
      const previousSearches = previousDiscoveryRuns(recentSearches, recentResults, search.id)
      await writeSecurityAudit(context, { action: "coresignal_discovery_run", entityType: "discovery_search", entityId: search.id, metadata: { resultCount: response.totalAvailable, storedResultCount: response.profiles.length, applicationUnits: response.usage.applicationUnits, providerUsageKnown: response.usage.providerReportedUsage !== null, mode: coresignalProvider.mode(), selectiveExecution: response.execution?.metrics ?? null } })
      return Response.json({ searchId: search.id, activeSearch: discoveryRunSummary(search, storedRows, [history]), previousSearches, providerHistory: context.role === "ADMIN" ? [history] : [], historyRestricted: context.role !== "ADMIN", results: storedResults, counts, reconciliationSummary: selectiveCollectSummary(reconciled.map(item => item.reconciliation)), executionSummary: response.execution?.metrics ?? null, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, requestedCount: validation.requested, returnedCount: providerCandidatesReturned, storedResultCount: response.profiles.length, creditsUsed: response.usage.providerReportedUsage, applicationUnits: response.usage.applicationUnits, totalAvailable: response.totalAvailable, effectiveLimit: validation.requested, filters })
    }

    if (payload.action === "qualify" && Number.isInteger(payload.resultId) && affiliationStatuses.has(String(payload.affiliationStatus))) {
      const affiliationStatus = String(payload.affiliationStatus)
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      if (!result || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending candidate can be qualified." }, { status: 409 })
      const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1)
      if (!search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      if (result.provider === PROFESSIONAL_DATA_PROVIDER && affiliationStatus === "Confirmed degree alumnus") {
        const evidenceRows = await evidenceForResults(db, [result.id])
        if (!supportingHumanEvidence(latestEvidence(evidenceRows.rows, result.id), result, nowDate)) return Response.json({ error: "Confirmed affiliation requires current independent reviewer evidence." }, { status: 409 })
      }
      const filters = search ? storedDiscoveryFilters(search.filtersJson) : defaultDiscoveryFilters()
      const qualification = qualificationForResult(result, filters, nowDate)
      const matchStatus = affiliationStatus === "Confirmed degree alumnus" && qualification.eligibleForAddition && !result.currentRoleAmbiguous && !result.linkedInternalAlumnusId ? "New" : result.matchStatus === "New" ? "Needs review" : result.matchStatus
      await db.update(externalDiscoveryResults).set({ affiliationStatus, matchStatus, reviewNote: `Affiliation classified by ${actor}.` }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "education_affiliation_qualified", entityType: "discovery_result", entityId: result.id, metadata: { affiliationStatus, provider: result.provider } })
      return Response.json({ qualified: true, affiliationStatus, matchStatus })
    }

    if (payload.action === "link_existing" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      if (!result || !search || result.provider !== PROFESSIONAL_DATA_PROVIDER || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Only a pending provenance-consistent Coresignal result can be linked." }, { status: 409 })
      const evidenceRows = await evidenceForResults(db, [result.id])
      const evidence = latestEvidence(evidenceRows.rows, result.id)
      if (!supportingHumanEvidence(evidence, result, nowDate)) return Response.json({ error: "Independent evidence must support the selected criteria before identity linking." }, { status: 409 })
      const current = await db.select().from(alumni).orderBy(alumni.id)
      const identity = reconcileDiscoveryCandidate({ ...storedCandidate(result), profileUrl: evidence!.profileUrl, programme: evidence!.programme, graduationYear: evidence!.graduationYear ?? evidence!.educationEndYear ?? 0, educationInstitution: evidence!.observedInstitution }, current, [], CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
      if (!(["KNOWN_PROVIDER_ID", "KNOWN_PROFILE_URL"].includes(identity.classification) && identity.linkedAlumnusId)) return Response.json({ error: "Only one exact provider ID or LinkedIn profile match can be linked. Name-only and ambiguous matches remain pending." }, { status: 409 })
      const attached = await attachCoresignalIdentity({ coresignalEmployeeId: result.providerPersonId, profileUrl: evidence!.profileUrl, expectedAlumnusId: identity.linkedAlumnusId, source: `external_discovery:${result.searchId}`, actor, discoveryResultId: result.id }, coresignalIdentityStore(db, context))
      if (!["KNOWN_PROVIDER_ID", "ATTACHED_PROVIDER_ID"].includes(attached.outcome)) return Response.json({ error: attached.rationale }, { status: 409 })
      const update = db.update(externalDiscoveryResults).set({ linkedInternalAlumnusId: identity.linkedAlumnusId, matchStatus: "Already in database", reviewedAt: now, reviewedBy: actor }).where(and(eq(externalDiscoveryResults.id, result.id), eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending), sql`${externalDiscoveryResults.linkedInternalAlumnusId} is null`)).returning({ id: externalDiscoveryResults.id })
      // changes() belongs to the immediately preceding compare-and-set UPDATE.
      // A losing concurrent link must not emit a false success audit row.
      const audit = db.insert(securityAuditEvents).select(db.select({
        id: sql<number | null>`null`.as("id"),
        actorUserId: sql<number>`${context.userId}`.as("actor_user_id"),
        actorIdentity: sql<string>`${context.externalIdentity}`.as("actor_identity"),
        actorName: sql<string>`${actor}`.as("actor_name"),
        actorRole: sql<string>`${context.role}`.as("actor_role"),
        action: sql<string>`'external_candidate_identity_linked'`.as("action"),
        entityType: sql<string>`'discovery_result'`.as("entity_type"),
        entityId: sql<string>`${String(result.id)}`.as("entity_id"),
        metadataJson: sql<string>`${safeAuditMetadata({ alumnusId: identity.linkedAlumnusId, evidenceId: evidence!.id, matchingMethod: identity.classification })}`.as("metadata_json"),
        result: sql<string>`'success'`.as("result"),
        source: sql<string>`'application'`.as("source"),
        mutationRequestKey: sql<string>`''`.as("mutation_request_key"),
        createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
      }).from(externalDiscoveryResults).where(and(eq(externalDiscoveryResults.id, result.id), sql`changes() = 1`)))
      const [linked] = await db.batch([update, audit])
      if (!linked.length) return Response.json({ error: "This discovery result was already linked or changed concurrently." }, { status: 409 })
      return Response.json({ alumnusId: identity.linkedAlumnusId, identityOutcome: attached.outcome })
    }

    if (payload.action === "approve") {
      const resultIds = [...new Set(payload.resultIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
      if (!resultIds.length) return Response.json({ error: "Select at least one confirmed degree alumnus." }, { status: 400 })
      const results = await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds))
      const searchIds = [...new Set(results.map(result => result.searchId))]
      const searches = searchIds.length ? await db.select().from(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, searchIds)) : []
      const filtersBySearch = new Map(searches.map(search => [search.id, storedDiscoveryFilters(search.filtersJson)]))
      const searchesById = new Map(searches.map(search => [search.id, search] as const))
      const candidateEvidence = await evidenceForResults(db, resultIds)
      if (!candidateEvidence.available && results.some(result => result.provider === PROFESSIONAL_DATA_PROVIDER)) return Response.json({ error: "Candidate evidence storage is not installed. Migration 0018 is required before reviewed Coresignal onboarding." }, { status: 503 })
      const currentAlumni = results.some(result => result.provider === PROFESSIONAL_DATA_PROVIDER) ? await db.select().from(alumni).orderBy(alumni.id) : []
      const ignored = results.some(result => result.provider === PROFESSIONAL_DATA_PROVIDER) ? await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, "Ignored")) : []
      if (results.length !== resultIds.length || results.some(result => {
        const search = searchesById.get(result.searchId)
        if (!search || resultProviderIntegrity(search.provider, result.provider) !== "consistent" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || result.linkedInternalAlumnusId) return true
        if (result.provider !== PROFESSIONAL_DATA_PROVIDER) return result.matchStatus !== "New" || result.affiliationStatus !== "Confirmed degree alumnus" || !qualificationForResult(result, filtersBySearch.get(result.searchId) ?? defaultDiscoveryFilters(), nowDate).eligibleForAddition
        const evidence = latestEvidence(candidateEvidence.rows, result.id)
        if (!supportingHumanEvidence(evidence, result, nowDate) || result.matchStatus === "Already in database") return true
        const identity = reconcileDiscoveryCandidate({ ...storedCandidate(result), profileUrl: evidence!.profileUrl, programme: evidence!.programme, graduationYear: evidence!.graduationYear ?? evidence!.educationEndYear ?? 0, educationInstitution: evidence!.observedInstitution }, currentAlumni, rejectedEvidence(ignored), CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
        return identity.classification !== "NEW_CANDIDATE"
      })) return Response.json({ error: "Approval requires a pending result, independently supported search criteria, a verified LinkedIn profile, and a new stable identity. Existing or ambiguous identities must remain in review." }, { status: 409 })
      const added = []
      for (const result of results) {
        if (result.provider === PROFESSIONAL_DATA_PROVIDER) {
          const evidence = latestEvidence(candidateEvidence.rows, result.id)!
          const profileKey = `${result.provider}:${normalized(result.providerPersonId)}`
          const insertPerson = db.insert(alumni).values(reviewedAlumnusValues(result, evidence, actor, now)).returning({ id: alumni.id })
          const updateResult = db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.added, linkedInternalAlumnusId: sql<number>`(select id from alumni where profile_key = ${profileKey})`, reviewedAt: now, reviewedBy: actor }).where(and(eq(externalDiscoveryResults.id, result.id), eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending))).returning({ id: externalDiscoveryResults.id })
          const audit = db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: actor, actorRole: context.role, action: "external_candidate_approved", entityType: "discovery_result", entityId: String(result.id), metadataJson: safeAuditMetadata({ searchId: result.searchId, evidenceId: evidence.id, providerPersonId: result.providerPersonId, identityMethod: "NEW_PROVIDER_ID_AND_REVIEWED_LINKEDIN" }), result: "success", source: "application" })
          const [inserted, updated] = await db.batch([insertPerson, updateResult, audit])
          if (inserted.length !== 1 || updated.length !== 1) throw new Error("Candidate approval did not persist atomically.")
          added.push({ resultId: result.id, alumnusId: inserted[0].id, identityOutcome: "NEW_VERIFIED_CANDIDATE" })
          continue
        }
        const [created] = await db.insert(alumni).values(alumnusValues(result, actor, now)).returning()
        const identity = result.provider === PROFESSIONAL_DATA_PROVIDER
          ? await attachCoresignalIdentity({ coresignalEmployeeId: result.providerPersonId, profileUrl: result.linkedinUrl, expectedAlumnusId: created.id, source: `external_discovery:${result.searchId}`, actor, discoveryResultId: result.id }, coresignalIdentityStore(db, context))
          : null
        added.push({ resultId: result.id, alumnusId: created.id, identityOutcome: identity?.outcome ?? null })
        await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.added, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      }
      await writeSecurityAudit(context, { action: "coresignal_results_approved", entityType: "alumni_batch", metadata: { addedCount: added.length, resultIds } })
      return Response.json({ addedCount: added.length, added }, { status: 201 })
    }

    if (payload.action === "apply_updates" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      if (!result?.linkedInternalAlumnusId || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending result linked to an internal alumnus can be compared." }, { status: 409 })
      const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1)
      if (!search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      const [person] = await db.select().from(alumni).where(eq(alumni.id, result.linkedInternalAlumnusId)).limit(1)
      if (!person) return Response.json({ error: "The linked internal alumnus could not be found." }, { status: 404 })
      const label = providerLabel(result.provider)
      const isCoresignal = result.provider === PROFESSIONAL_DATA_PROVIDER
      let evidence: typeof externalDiscoveryCandidateEvidence.$inferSelect | null = null
      if (isCoresignal) {
        const evidenceRows = await evidenceForResults(db, [result.id])
        evidence = latestEvidence(evidenceRows.rows, result.id)
        if (!supportingHumanEvidence(evidence, result, nowDate)) return Response.json({ error: "Current reviewer evidence must support the selected search criteria before applying professional updates." }, { status: 409 })
      }
      const candidates: Record<string, string | number | boolean> = { company: result.currentCompany, title: result.role, rawTitle: result.rawTitle, function: result.function, seniority: result.seniority, location: result.location, linkedinUrl: normalizeProfessionalProfileUrl(result.linkedinUrl), graduationYear: result.graduationYear, [isCoresignal ? "coresignalEmployeeId" : "pdlPersonId"]: result.providerPersonId, ...(isCoresignal ? { iimlAffiliationStatus: result.affiliationStatus, iimlEducationProgramme: result.educationProgramme, iimlEducationStartDate: result.educationStartDate, iimlEducationEndDate: result.educationEndDate, iimlInstitutionId: result.institutionId, iimlInstitutionUrl: result.institutionUrl, currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl, currentRoleStartDate: result.currentRoleStartDate, currentIndustry: result.currentIndustry, currentRoleAmbiguous: result.currentRoleAmbiguous, providerFreshnessAt: result.providerFreshnessAt } : {}) }
      const requested = [...new Set(payload.fields ?? [])].filter(field => field in candidates && !["email", "phone"].includes(field))
      let identityAttached = false
      if (isCoresignal && evidence) {
        const verified = JSON.parse(evidence.decisionsJson) as EvidenceDecisions
        const fieldDecision: Record<string, keyof EvidenceDecisions> = { company: "company", title: "role", rawTitle: "role", function: "function", seniority: "seniority", location: "location", linkedinUrl: "identity", graduationYear: "graduationYear", coresignalEmployeeId: "identity" }
        if (requested.some(field => !fieldDecision[field] || verified[fieldDecision[field]] !== "MATCH")) return Response.json({ error: "Only independently verified selected fields can be applied to an existing alumnus. Provider-only values remain review evidence." }, { status: 409 })
        Object.assign(candidates, {
          company: evidence.currentCompany, title: evidence.currentDesignation, rawTitle: evidence.currentDesignation,
          function: evidence.currentDesignation ? normalizeFunction("", evidence.currentDesignation) : "",
          seniority: titleSeniority(evidence.currentDesignation).bucket, location: evidence.location,
          linkedinUrl: normalizeProfessionalProfileUrl(evidence.profileUrl), graduationYear: evidence.graduationYear ?? evidence.educationEndYear ?? 0,
        })
        const linkedIdentity = await attachCoresignalIdentity({ coresignalEmployeeId: result.providerPersonId, profileUrl: evidence.profileUrl, expectedAlumnusId: person.id, source: `external_discovery:${result.searchId}`, actor, discoveryResultId: result.id }, coresignalIdentityStore(db, context))
        if (!["KNOWN_PROVIDER_ID", "ATTACHED_PROVIDER_ID"].includes(linkedIdentity.outcome)) return Response.json({ error: linkedIdentity.rationale }, { status: 409 })
        identityAttached = linkedIdentity.wroteIdentity
      }
      const ordinaryRequested = requested.filter(field => field !== "coresignalEmployeeId")
      const updates: Partial<typeof alumni.$inferInsert> = { ...(isCoresignal ? { lastProfessionalDataRefresh: now } : { lastPdlRefresh: now }), professionalDataProvider: label, source: label, updatedBy: actor, updatedAt: now, verified: `Professional profile refreshed via ${label}` }
      const changedFields: string[] = identityAttached ? ["coresignalEmployeeId"] : []
      for (const field of ordinaryRequested) { const oldValue = String(person[field as keyof typeof person] ?? ""); const newValue = String(candidates[field] ?? ""); if (!newValue || oldValue === newValue) continue; (updates as Record<string, unknown>)[field] = candidates[field]; changedFields.push(field); await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field, oldValue, newValue, source: label, providerAction: "Compare & Refresh", initiatedBy: actor }) }
      if (changedFields.length) await db.update(alumni).set(updates).where(eq(alumni.id, person.id))
      await db.update(externalDiscoveryResults).set({ reviewStatus: changedFields.length ? "Updates applied" : "Reviewed — kept existing", reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { provider: result.provider, changedFields } })
      return Response.json({ alumnusId: person.id, changedFields })
    }

    if (payload.action === "keep_separate" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      const filters = search ? storedDiscoveryFilters(search.filtersJson) : defaultDiscoveryFilters()
      if (!result || !search || resultProviderIntegrity(search.provider, result.provider) !== "consistent" || result.matchStatus !== "Possible duplicate" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending provenance-consistent possible duplicate can be kept separate." }, { status: 409 })
      if (result.provider === PROFESSIONAL_DATA_PROVIDER) {
        const evidenceRows = await evidenceForResults(db, [result.id])
        const evidence = latestEvidence(evidenceRows.rows, result.id)
        if (!supportingHumanEvidence(evidence, result, nowDate)) return Response.json({ error: "Independent reviewer evidence must qualify the candidate before keeping a same-name profile separate." }, { status: 409 })
        const current = await db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni).orderBy(alumni.id)
        const identity = reconcileCoresignalIdentity({ coresignalEmployeeId: result.providerPersonId, profileUrl: evidence!.profileUrl }, current)
        if (identity.outcome !== "NEW_CANDIDATE") return Response.json({ error: `${identity.rationale} Keep the result pending for identity resolution.` }, { status: 409 })
        const profileKey = `${result.provider}:${normalized(result.providerPersonId)}`
        const insertPerson = db.insert(alumni).values(reviewedAlumnusValues(result, evidence!, actor, now)).returning({ id: alumni.id })
        const updateResult = db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate, linkedInternalAlumnusId: sql<number>`(select id from alumni where profile_key = ${profileKey})`, reviewedAt: now, reviewedBy: actor }).where(and(eq(externalDiscoveryResults.id, result.id), eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending))).returning({ id: externalDiscoveryResults.id })
        const audit = db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: actor, actorRole: context.role, action: "possible_duplicate_kept_separate", entityType: "discovery_result", entityId: String(result.id), metadataJson: safeAuditMetadata({ evidenceId: evidence!.id, identityMethod: "NEW_PROVIDER_ID_AND_REVIEWED_LINKEDIN" }), result: "success", source: "application" })
        const [inserted, updated] = await db.batch([insertPerson, updateResult, audit])
        if (inserted.length !== 1 || updated.length !== 1) throw new Error("Separate candidate approval did not persist atomically.")
        return Response.json({ alumnusId: inserted[0].id }, { status: 201 })
      }
      if (result.affiliationStatus !== "Confirmed degree alumnus" || !qualificationForResult(result, filters, nowDate).eligibleForAddition) return Response.json({ error: "Only a qualified past alumnus can be kept separate." }, { status: 409 })
      const [created] = await db.insert(alumni).values(alumnusValues(result, actor, now, " after duplicate review")).returning()
      if (result.provider === PROFESSIONAL_DATA_PROVIDER) await attachCoresignalIdentity({ coresignalEmployeeId: result.providerPersonId, profileUrl: result.linkedinUrl, expectedAlumnusId: created.id, source: `external_discovery:${result.searchId}`, actor, discoveryResultId: result.id }, coresignalIdentityStore(db, context))
      await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "possible_duplicate_kept_separate", entityType: "alumnus", entityId: created.id, metadata: { provider: PROFESSIONAL_DATA_PROVIDER, discoveryResultId: result.id } })
      return Response.json({ alumnusId: created.id }, { status: 201 })
    }

    if (payload.action === "ignore" && Number.isInteger(payload.resultId)) {
      const allowed = new Set(["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"]); const reason = allowed.has(String(payload.reason)) ? String(payload.reason) : "Other"
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      if (!result || !search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      if (result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending discovery result can be ignored." }, { status: 409 })
      await db.update(externalDiscoveryResults).set({ reviewStatus: "Ignored", reviewNote: reason, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "coresignal_result_ignored", entityType: "discovery_result", entityId: payload.resultId, metadata: { reason } })
      return Response.json({ ignored: true, reason })
    }
    return Response.json({ error: "Unsupported discovery action." }, { status: 400 })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to complete external alumni discovery." }, { status: 500 }) }
}
