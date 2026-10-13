import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, externalDiscoveryResults, externalDiscoverySearches, fieldChangeHistory, providerResponseHistory, providerSettings } from "@/db/schema"
import { FIXED_ALUMNI_SCHOOL, criteriaSummary, defaultDiscoveryFilters, matchesDiscoverySeniorities, normalizeDiscoveryFiltersInput, normalized, type DiscoveryFilters, type DiscoveryProfile, type MatchStatus } from "@/lib/alumni-search"
import { coresignalProvider } from "@/lib/coresignal-adapter"
import { safeCoresignalError } from "@/lib/coresignal-client"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { validateDiscoveryCount } from "@/lib/discovery-limit"
import { PROFESSIONAL_DATA_PROVIDER, PROFESSIONAL_DATA_PROVIDER_LABEL } from "@/lib/professional-data"
import { coresignalLiveSearchMaximum } from "@/lib/provider-runtime"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { discoveryQualification, normalizeCoresignalProgramme } from "@/lib/discovery-qualification"
import { discoveredAlumniYearValues } from "@/lib/alumni-education"
import { discoveryClassificationCounts, discoveryRunSummary, previousDiscoveryRuns, resultProviderIntegrity, selectActiveDiscoveryRun } from "@/lib/discovery-runs"
import { discoveryCoveragePlan } from "@/lib/discovery-coverage"
import { CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES } from "@/lib/discovery-provider-capabilities"
import { reconcileDiscoveryCandidate, reconcileDiscoveryCandidates, selectiveCollectSummary, type ReconciliationCandidate, type RejectedCandidateEvidence } from "@/lib/discovery-reconciliation"
import { qualifyCollectedCandidate, qualifyPreviewCandidate, type DiscoveryExecutionCandidate } from "@/lib/discovery-execution"

const DEFAULT_APPLICATION_LIMIT = 25
const affiliationStatuses = new Set(["Confirmed degree alumnus", "Potential alumnus — review required", "Short-term / exchange affiliation"])

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL" }
function providerLabel(provider: string) { return provider === PROFESSIONAL_DATA_PROVIDER ? PROFESSIONAL_DATA_PROVIDER_LABEL : provider.toLowerCase() === "pdl" ? "PDL" : provider }

export function normalizedDiscoveryFilters(value: unknown): DiscoveryFilters {
  return normalizeDiscoveryFiltersInput(value)
}

function storedDiscoveryFilters(value: string) {
  try { return normalizedDiscoveryFilters(JSON.parse(value)) } catch { return defaultDiscoveryFilters() }
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

function storedQualificationPresentation(result: typeof externalDiscoveryResults.$inferSelect, filters: DiscoveryFilters) {
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
  const qualification = collectionState === "COLLECT_PERFORMED" ? qualifyCollectedCandidate(profile, filters) : qualifyPreviewCandidate(profile, filters)
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
    ...(isCoresignal ? { coresignalEmployeeId: result.providerPersonId, lastProfessionalDataRefresh: now } : { pdlPersonId: result.providerPersonId, lastPdlRefresh: now }),
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
    await authorizeRequest(request, "OPERATE_PCOM")
    const db = getDb(); const url = new URL(request.url); const view = url.searchParams.get("view") === "pending" ? "pending" : "summary"
    const requestedSearchIdValue = url.searchParams.get("searchId")
    const requestedSearchId = requestedSearchIdValue === null ? null : Number(requestedSearchIdValue)
    if (requestedSearchIdValue !== null && (!Number.isInteger(requestedSearchId) || requestedSearchId! <= 0)) return Response.json({ error: "A valid discovery search ID is required." }, { status: 400 })
    const recentSearches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10)
    const pendingResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending)).orderBy(desc(externalDiscoveryResults.searchId), externalDiscoveryResults.id)
    const candidateSearchId = requestedSearchId ?? pendingResults[0]?.searchId ?? recentSearches[0]?.id ?? null
    const candidateOutsideRecent = candidateSearchId !== null && !recentSearches.some(search => search.id === candidateSearchId)
      ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, candidateSearchId)).limit(1)
      : []
    const searchPool = [...candidateOutsideRecent, ...recentSearches]
    const activeSearch = selectActiveDiscoveryRun(searchPool, pendingResults, requestedSearchId)
    if (requestedSearchId && !activeSearch) return Response.json({ error: "The requested discovery search was not found." }, { status: 404 })
    const historySearchIds = [...new Set(searchPool.map(search => search.id))]
    const historyResults = historySearchIds.length ? await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId, historySearchIds)).orderBy(desc(externalDiscoveryResults.searchId), externalDiscoveryResults.id) : []
    const activeResults = activeSearch ? historyResults.filter(result => result.searchId === activeSearch.id) : []
    const activeProviderHistory = activeSearch ? await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.searchId, activeSearch.id)).orderBy(providerResponseHistory.id) : []
    const activeSearchSummary = activeSearch ? discoveryRunSummary(activeSearch, activeResults, activeProviderHistory) : null
    const previousSearches = previousDiscoveryRuns(recentSearches, historyResults, activeSearch?.id ?? null)
    const common = { pendingCount: pendingResults.length, mode: coresignalProvider.mode(), searches: recentSearches, previousSearches, configured: coresignalProvider.configured(), canonicalInstitutionConfigured: true, liveMaximum: coresignalLiveSearchMaximum(), provider: PROFESSIONAL_DATA_PROVIDER, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES }
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
    const presentedResults = activeResults.map(result => ({ ...presentResult(result, filters, new Date(), activeSearch), ...reconciliationPresentation(reconciliationByKey.get(storedCandidate(result).candidateKey)), ...storedQualificationPresentation(result, filters) }))
    const counts = discoveryClassificationCounts(activeResults)
    return Response.json({ ...common, activeSearch: activeSearchSummary, results: presentedResults, counts, reconciliationSummary: reconciliations.length ? selectiveCollectSummary(reconciliations) : null, filters, providerHistory: activeProviderHistory, creditsUsed: activeSearch.creditsUsed, retrieval: "stored", source: { provider: activeSearch.provider, mode: activeSearch.mode, searchId: activeSearch.id, createdAt: activeSearch.createdAt } })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to load discovery history." }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; filters?: Partial<DiscoveryFilters>; graduationYears?: number[]; limit?: number; resultIds?: number[]; resultId?: number; fields?: string[]; reason?: string; affiliationStatus?: string }
    const context = await authorizeRequest(request, "OPERATE_PCOM"); const db = getDb(); const actor = context.displayName; const nowDate = new Date(); const now = nowDate.toISOString()

    if (payload.action === "plan") {
      const filters = normalizedDiscoveryFilters(payload.filters)
      const history = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.provider, PROFESSIONAL_DATA_PROVIDER)).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id))
      const coverage = discoveryCoveragePlan(filters, history, { now: nowDate, provider: PROFESSIONAL_DATA_PROVIDER, mode: coresignalProvider.mode(), graduationYears: payload.graduationYears })
      return Response.json({ provider: PROFESSIONAL_DATA_PROVIDER, mode: coresignalProvider.mode(), coverage, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, providerCallMade: false, applicationUnits: 0 })
    }

    if (payload.action === "search") {
      const filters = normalizedDiscoveryFilters(payload.filters)
      if (!filters.discoveryProgrammes.length) return Response.json({ error: "Select at least one configured programme before external discovery.", blocked: true, reason: "programme_required", filters, effectiveLimit: 0 }, { status: 400 })
      const remaining = await remainingApplicationUnits()
      const searchOperationReserve = coresignalProvider.mode() === "live" ? 1 : 0
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
      try { response = await coresignalProvider.searchCandidates(filters, people, validation.requested, { rejectedCandidates: rejected, maximumCollects: validation.requested }) }
      catch (error) {
        const failure = safeCoresignalError(error)
        await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", operation: "Education affiliation search", mode: coresignalProvider.mode(), status: "error", applicationUnits: failure.successfulOperationCredits, providerReportedCredits: null, usageState: failure.successfulOperationCredits ? "reconciliation_required" : "not_applicable", requestSummary: `${criteriaSummary(filters)} · Maximum requested: ${validation.requested}`, responseSummary: failure.message, errorMessage: failure.message, requestedBy: actor })
        return Response.json({ error: failure.message, failureType: failure.kind, blocked: true, reason: "provider_error", filters, effectiveLimit: validation.requested }, { status: failure.status === 429 ? 429 : 502 })
      }
      const [search] = await db.insert(externalDiscoverySearches).values({ provider: PROFESSIONAL_DATA_PROVIDER, filtersJson: JSON.stringify(filters), criteriaSummary: criteriaSummary(filters), requestedCount: validation.requested, resultCount: response.totalAvailable, creditsUsed: 0, mode: coresignalProvider.mode(), initiatedBy: actor }).returning()
      const executionByKey = new Map((response.execution?.candidates ?? []).map(item => [item.profile.providerResultId || item.profile.providerPersonId, item]))
      const reconciled = response.profiles.map(profile => {
        const execution = executionByKey.get(profile.providerResultId || profile.providerPersonId)
        return { profile, execution, ...classify(profile, people, rejected, execution) }
      })
      for (const item of reconciled) await db.insert(externalDiscoveryResults).values(resultValues(search.id, item.profile, item, item.execution))
      const counts = { existing: reconciled.filter(i => i.matchStatus === "Already in database").length, new: reconciled.filter(i => i.matchStatus === "New").length, possibleDuplicate: reconciled.filter(i => i.matchStatus === "Possible duplicate").length, needsReview: reconciled.filter(i => i.matchStatus === "Needs review").length }
      await db.update(externalDiscoverySearches).set({ existingCount: counts.existing, newCount: counts.new, duplicateCount: counts.possibleDuplicate }).where(eq(externalDiscoverySearches.id, search.id))
      const executionAudit = response.execution?.metrics ? ` · Selective execution ${JSON.stringify(response.execution.metrics)}` : ""
      const [history] = await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", searchId: search.id, operation: "Education affiliation search", mode: coresignalProvider.mode(), status: "success", creditsUsed: response.usage.providerReportedUsage ?? 0, applicationUnits: response.usage.applicationUnits, providerReportedCredits: response.usage.providerReportedUsage, usageState: response.usage.usageState, resultCount: response.totalAvailable, requestSummary: `${criteriaSummary(filters)} · Maximum requested: ${validation.requested}`, responseSummary: `${response.responseSummary}${executionAudit}`, requestedBy: actor }).returning()
      const storedRows = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id)
      const reconciliationByKey = new Map(reconciled.map(item => [item.reconciliation.candidateKey, item.reconciliation]))
      const storedResults = storedRows.map(result => {
        const execution = executionByKey.get(storedCandidate(result).candidateKey)
        return ({ ...presentResult(result, filters, nowDate, search), ...reconciliationPresentation(reconciliationByKey.get(storedCandidate(result).candidateKey)), ...executionPresentation(execution) })
      })
      const recentSearches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10)
      const recentSearchIds = recentSearches.map(item => item.id)
      const recentResults = recentSearchIds.length ? await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId, recentSearchIds)) : []
      const previousSearches = previousDiscoveryRuns(recentSearches, recentResults, search.id)
      await writeSecurityAudit(context, { action: "coresignal_discovery_run", entityType: "discovery_search", entityId: search.id, metadata: { resultCount: response.totalAvailable, storedResultCount: response.profiles.length, applicationUnits: response.usage.applicationUnits, providerUsageKnown: response.usage.providerReportedUsage !== null, mode: coresignalProvider.mode(), selectiveExecution: response.execution?.metrics ?? null } })
      return Response.json({ searchId: search.id, activeSearch: discoveryRunSummary(search, storedRows, [history]), previousSearches, providerHistory: [history], results: storedResults, counts, reconciliationSummary: selectiveCollectSummary(reconciled.map(item => item.reconciliation)), executionSummary: response.execution?.metrics ?? null, previewCapabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, requestedCount: validation.requested, returnedCount: response.totalAvailable, storedResultCount: response.profiles.length, creditsUsed: response.usage.providerReportedUsage, applicationUnits: response.usage.applicationUnits, totalAvailable: response.totalAvailable, effectiveLimit: validation.requested, filters })
    }

    if (payload.action === "qualify" && Number.isInteger(payload.resultId) && affiliationStatuses.has(String(payload.affiliationStatus))) {
      const affiliationStatus = String(payload.affiliationStatus)
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      if (!result || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending candidate can be qualified." }, { status: 409 })
      const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1)
      if (!search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      const filters = search ? storedDiscoveryFilters(search.filtersJson) : defaultDiscoveryFilters()
      const qualification = qualificationForResult(result, filters, nowDate)
      const matchStatus = affiliationStatus === "Confirmed degree alumnus" && qualification.eligibleForAddition && !result.currentRoleAmbiguous && !result.linkedInternalAlumnusId ? "New" : result.matchStatus === "New" ? "Needs review" : result.matchStatus
      await db.update(externalDiscoveryResults).set({ affiliationStatus, matchStatus, reviewNote: `Affiliation classified by ${actor}.` }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "education_affiliation_qualified", entityType: "discovery_result", entityId: result.id, metadata: { affiliationStatus, provider: result.provider } })
      return Response.json({ qualified: true, affiliationStatus, matchStatus })
    }

    if (payload.action === "approve") {
      const resultIds = [...new Set(payload.resultIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
      if (!resultIds.length) return Response.json({ error: "Select at least one confirmed degree alumnus." }, { status: 400 })
      const results = await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds))
      const searchIds = [...new Set(results.map(result => result.searchId))]
      const searches = searchIds.length ? await db.select().from(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, searchIds)) : []
      const filtersBySearch = new Map(searches.map(search => [search.id, storedDiscoveryFilters(search.filtersJson)]))
      const searchesById = new Map(searches.map(search => [search.id, search] as const))
      if (results.length !== resultIds.length || results.some(result => !searchesById.get(result.searchId) || resultProviderIntegrity(searchesById.get(result.searchId)!.provider, result.provider) !== "consistent" || result.matchStatus !== "New" || result.affiliationStatus !== "Confirmed degree alumnus" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || !qualificationForResult(result, filtersBySearch.get(result.searchId) ?? defaultDiscoveryFilters(), nowDate).eligibleForAddition)) return Response.json({ error: "Only provenance-consistent past alumni with a confirmed selected programme that are clearly new and pending review can be added in a batch." }, { status: 409 })
      const added = []
      for (const result of results) {
        const [created] = await db.insert(alumni).values(alumnusValues(result, actor, now)).returning()
        added.push({ resultId: result.id, alumnusId: created.id })
        await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.added, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      }
      await writeSecurityAudit(context, { action: "coresignal_results_approved", entityType: "alumni_batch", metadata: { addedCount: added.length, resultIds } })
      return Response.json({ addedCount: added.length, added }, { status: 201 })
    }

    if (payload.action === "apply_updates" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      if (!result?.linkedInternalAlumnusId) return Response.json({ error: "No internal alumnus is linked to this result." }, { status: 409 })
      const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1)
      if (!search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      const [person] = await db.select().from(alumni).where(eq(alumni.id, result.linkedInternalAlumnusId)).limit(1)
      if (!person) return Response.json({ error: "The linked internal alumnus could not be found." }, { status: 404 })
      const label = providerLabel(result.provider)
      const isCoresignal = result.provider === PROFESSIONAL_DATA_PROVIDER
      const candidates: Record<string, string | number | boolean> = { company: result.currentCompany, title: result.role, rawTitle: result.rawTitle, function: result.function, seniority: result.seniority, location: result.location, linkedinUrl: normalizeProfessionalProfileUrl(result.linkedinUrl), graduationYear: result.graduationYear, [isCoresignal ? "coresignalEmployeeId" : "pdlPersonId"]: result.providerPersonId, ...(isCoresignal ? { iimlAffiliationStatus: result.affiliationStatus, iimlEducationProgramme: result.educationProgramme, iimlEducationStartDate: result.educationStartDate, iimlEducationEndDate: result.educationEndDate, iimlInstitutionId: result.institutionId, iimlInstitutionUrl: result.institutionUrl, currentCompanyId: result.currentCompanyId, currentCompanyUrl: result.currentCompanyUrl, currentRoleStartDate: result.currentRoleStartDate, currentIndustry: result.currentIndustry, currentRoleAmbiguous: result.currentRoleAmbiguous, providerFreshnessAt: result.providerFreshnessAt } : {}) }
      const requested = [...new Set(payload.fields ?? [])].filter(field => field in candidates && !["email", "phone"].includes(field))
      const updates: Partial<typeof alumni.$inferInsert> = { ...(isCoresignal ? { lastProfessionalDataRefresh: now } : { lastPdlRefresh: now }), professionalDataProvider: label, source: label, updatedBy: actor, updatedAt: now, verified: `Professional profile refreshed via ${label}` }
      const changedFields: string[] = []
      for (const field of requested) { const oldValue = String(person[field as keyof typeof person] ?? ""); const newValue = String(candidates[field] ?? ""); if (!newValue || oldValue === newValue) continue; (updates as Record<string, unknown>)[field] = candidates[field]; changedFields.push(field); await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field, oldValue, newValue, source: label, providerAction: "Compare & Refresh", initiatedBy: actor }) }
      await db.update(alumni).set(updates).where(eq(alumni.id, person.id))
      await db.update(externalDiscoveryResults).set({ reviewStatus: changedFields.length ? "Updates applied" : "Reviewed — kept existing", reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { provider: result.provider, changedFields } })
      return Response.json({ alumnusId: person.id, changedFields })
    }

    if (payload.action === "keep_separate" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      const filters = search ? storedDiscoveryFilters(search.filtersJson) : defaultDiscoveryFilters()
      if (!result || !search || resultProviderIntegrity(search.provider, result.provider) !== "consistent" || result.matchStatus !== "Possible duplicate" || result.affiliationStatus !== "Confirmed degree alumnus" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending || !qualificationForResult(result, filters, nowDate).eligibleForAddition) return Response.json({ error: "Only a provenance-consistent past alumnus with a confirmed selected programme and pending possible-duplicate review can be kept as a separate record." }, { status: 409 })
      const [created] = await db.insert(alumni).values(alumnusValues(result, actor, now, " after duplicate review")).returning()
      await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "possible_duplicate_kept_separate", entityType: "alumnus", entityId: created.id, metadata: { provider: PROFESSIONAL_DATA_PROVIDER, discoveryResultId: result.id } })
      return Response.json({ alumnusId: created.id }, { status: 201 })
    }

    if (payload.action === "ignore" && Number.isInteger(payload.resultId)) {
      const allowed = new Set(["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"]); const reason = allowed.has(String(payload.reason)) ? String(payload.reason) : "Other"
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      const [search] = result ? await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
      if (!result || !search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") return Response.json({ error: "Discovery result provider provenance does not match its search run." }, { status: 409 })
      await db.update(externalDiscoveryResults).set({ reviewStatus: "Ignored", reviewNote: reason, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "coresignal_result_ignored", entityType: "discovery_result", entityId: payload.resultId, metadata: { reason } })
      return Response.json({ ignored: true, reason })
    }
    return Response.json({ error: "Unsupported discovery action." }, { status: 400 })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to complete external alumni discovery." }, { status: 500 }) }
}
