import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, externalDiscoveryResults, externalDiscoverySearches, fieldChangeHistory, providerResponseHistory, providerSettings } from "@/db/schema"
import { FIXED_ALUMNI_SCHOOL, criteriaSummary, defaultDirectoryFilters, normalized, type DirectoryFilters, type DiscoveryProfile, type MatchStatus } from "@/lib/alumni-search"
import { coresignalProvider } from "@/lib/coresignal-adapter"
import { safeCoresignalError } from "@/lib/coresignal-client"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { validateDiscoveryCount } from "@/lib/discovery-limit"
import { PROFESSIONAL_DATA_PROVIDER, PROFESSIONAL_DATA_PROVIDER_LABEL } from "@/lib/professional-data"
import { coresignalLiveSearchMaximum } from "@/lib/provider-runtime"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

const DEFAULT_APPLICATION_LIMIT = 25
const affiliationStatuses = new Set(["Confirmed degree alumnus", "Potential alumnus — review required", "Short-term / exchange affiliation"])

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL" }
function providerLabel(provider: string) { return provider === PROFESSIONAL_DATA_PROVIDER ? PROFESSIONAL_DATA_PROVIDER_LABEL : provider.toLowerCase() === "pdl" ? "PDL" : provider }

function classify(profile: DiscoveryProfile, people: (typeof alumni.$inferSelect)[]) {
  const providerId = normalized(profile.providerPersonId)
  const linkedin = normalized(profile.linkedinUrl)
  const name = normalized(profile.name)
  const exact = people.find(person => (providerId && normalized(person.coresignalEmployeeId) === providerId)
    || (linkedin && normalized(person.linkedinUrl) === linkedin)
    || (name === normalized(person.name) && profile.graduationYear > 0 && (person.graduationYear || person.batch) === profile.graduationYear))
  if (exact) return { matchStatus: "Already in database" as MatchStatus, linkedInternalAlumnusId: exact.id, matchConfidence: Math.max(95, profile.matchConfidence) }
  const possible = people.find(person => name === normalized(person.name)
    || (normalized(person.name).split(" ").at(-1) === name.split(" ").at(-1) && normalized(person.company) === normalized(profile.currentCompany)))
  if (possible) return { matchStatus: "Possible duplicate" as MatchStatus, linkedInternalAlumnusId: possible.id, matchConfidence: Math.min(84, profile.matchConfidence) }
  if (profile.affiliationStatus !== "Confirmed degree alumnus" || profile.currentRoleAmbiguous) return { matchStatus: "Needs review" as MatchStatus, linkedInternalAlumnusId: null, matchConfidence: profile.matchConfidence }
  return { matchStatus: "New" as MatchStatus, linkedInternalAlumnusId: null, matchConfidence: profile.matchConfidence }
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

function resultValues(searchId: number, profile: DiscoveryProfile, match: ReturnType<typeof classify>) {
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
  }
}

function alumnusValues(result: typeof externalDiscoveryResults.$inferSelect, actor: string, now: string, suffix = "") {
  const label = providerLabel(result.provider)
  const isCoresignal = result.provider === PROFESSIONAL_DATA_PROVIDER
  return {
    profileKey: result.providerPersonId ? `${result.provider}:${normalized(result.providerPersonId)}` : `${result.provider}-reviewed:${result.id}`,
    name: result.name, initials: initials(result.name), batch: 0, graduationYear: result.graduationYear,
    programme: result.educationProgramme || "Not confirmed", education: result.education || FIXED_ALUMNI_SCHOOL,
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
    const db = getDb(); const view = new URL(request.url).searchParams.get("view") === "pending" ? "pending" : "summary"
    const recentSearches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10)
    const pendingResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.reviewStatus, DISCOVERY_REVIEW_STATUS.pending)).orderBy(desc(externalDiscoveryResults.searchId), externalDiscoveryResults.id)
    const common = { pendingCount: pendingResults.length, mode: coresignalProvider.mode(), searches: recentSearches, configured: coresignalProvider.configured(), canonicalInstitutionConfigured: true, liveMaximum: coresignalLiveSearchMaximum(), provider: PROFESSIONAL_DATA_PROVIDER }
    if (view === "summary") return Response.json(common)
    const searchIds = [...new Set(pendingResults.map(result => result.searchId))]
    const searches = searchIds.length ? await db.select().from(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, searchIds)) : []
    const latest = searches.sort((a, b) => b.id - a.id)[0] ?? null
    let filters = defaultDirectoryFilters()
    try { if (latest) filters = { ...filters, ...JSON.parse(latest.filtersJson) } } catch { /* historical metadata may be malformed */ }
    const counts = { existing: pendingResults.filter(r => r.matchStatus === "Already in database").length, new: pendingResults.filter(r => r.matchStatus === "New").length, possibleDuplicate: pendingResults.filter(r => r.matchStatus === "Possible duplicate").length, needsReview: pendingResults.filter(r => r.matchStatus === "Needs review").length }
    return Response.json({ ...common, results: pendingResults, counts, filters, creditsUsed: 0, retrieval: "stored", source: latest ? { provider: latest.provider, mode: latest.mode, searchId: latest.id, createdAt: latest.createdAt } : null })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to load discovery history." }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; filters?: Partial<DirectoryFilters>; limit?: number; resultIds?: number[]; resultId?: number; fields?: string[]; reason?: string; affiliationStatus?: string }
    const context = await authorizeRequest(request, "OPERATE_PCOM"); const db = getDb(); const actor = context.displayName; const now = new Date().toISOString()

    if (payload.action === "search") {
      const filters = { ...defaultDirectoryFilters(), ...payload.filters } as DirectoryFilters
      const remaining = await remainingApplicationUnits()
      const searchOperationReserve = coresignalProvider.mode() === "live" ? 1 : 0
      if (remaining <= searchOperationReserve) return Response.json({ error: "External search was not run because the Coresignal application limit cannot cover a Search and at least one Collect operation.", blocked: true, reason: "application_limit", filters, effectiveLimit: 0 }, { status: 429 })
      const maximum = coresignalProvider.mode() === "live" ? coresignalLiveSearchMaximum() : 100
      const validation = validateDiscoveryCount(payload.limit, remaining, maximum, searchOperationReserve)
      if (!validation.ok) return Response.json({ error: validation.message, blocked: true, reason: validation.reason, filters, effectiveLimit: 0, maximumAllowed: validation.maximumAllowed }, { status: 400 })
      const people = await db.select().from(alumni).orderBy(alumni.name)
      let response
      try { response = await coresignalProvider.searchCandidates(filters, people, validation.requested) }
      catch (error) {
        const failure = safeCoresignalError(error)
        await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", operation: "Education affiliation search", mode: coresignalProvider.mode(), status: "error", applicationUnits: failure.successfulOperationCredits, providerReportedCredits: null, usageState: failure.successfulOperationCredits ? "reconciliation_required" : "not_applicable", requestSummary: `${criteriaSummary(filters)} · Maximum requested: ${validation.requested}`, responseSummary: failure.message, errorMessage: failure.message, requestedBy: actor })
        return Response.json({ error: failure.message, failureType: failure.kind, blocked: true, reason: "provider_error", filters, effectiveLimit: validation.requested }, { status: failure.status === 429 ? 429 : 502 })
      }
      const [search] = await db.insert(externalDiscoverySearches).values({ provider: PROFESSIONAL_DATA_PROVIDER, filtersJson: JSON.stringify(filters), criteriaSummary: criteriaSummary(filters), requestedCount: validation.requested, resultCount: response.profiles.length, creditsUsed: 0, mode: coresignalProvider.mode(), initiatedBy: actor }).returning()
      const reconciled = response.profiles.map(profile => ({ profile, ...classify(profile, people) }))
      for (const item of reconciled) await db.insert(externalDiscoveryResults).values(resultValues(search.id, item.profile, item))
      const counts = { existing: reconciled.filter(i => i.matchStatus === "Already in database").length, new: reconciled.filter(i => i.matchStatus === "New").length, possibleDuplicate: reconciled.filter(i => i.matchStatus === "Possible duplicate").length, needsReview: reconciled.filter(i => i.matchStatus === "Needs review").length }
      await db.update(externalDiscoverySearches).set({ existingCount: counts.existing, newCount: counts.new, duplicateCount: counts.possibleDuplicate }).where(eq(externalDiscoverySearches.id, search.id))
      await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusName: "External alumni discovery", searchId: search.id, operation: "Education affiliation search", mode: coresignalProvider.mode(), status: "success", creditsUsed: response.usage.providerReportedUsage ?? 0, applicationUnits: response.usage.applicationUnits, providerReportedCredits: response.usage.providerReportedUsage, usageState: response.usage.usageState, resultCount: response.profiles.length, requestSummary: `${criteriaSummary(filters)} · Maximum requested: ${validation.requested}`, responseSummary: response.responseSummary, requestedBy: actor })
      const storedResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id)
      await writeSecurityAudit(context, { action: "coresignal_discovery_run", entityType: "discovery_search", entityId: search.id, metadata: { resultCount: response.profiles.length, applicationUnits: response.usage.applicationUnits, providerUsageKnown: response.usage.providerReportedUsage !== null, mode: coresignalProvider.mode() } })
      return Response.json({ searchId: search.id, results: storedResults, counts, requestedCount: validation.requested, returnedCount: response.profiles.length, creditsUsed: response.usage.providerReportedUsage, applicationUnits: response.usage.applicationUnits, totalAvailable: response.totalAvailable, effectiveLimit: validation.requested, filters })
    }

    if (payload.action === "qualify" && Number.isInteger(payload.resultId) && affiliationStatuses.has(String(payload.affiliationStatus))) {
      const affiliationStatus = String(payload.affiliationStatus)
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1)
      if (!result || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a pending candidate can be qualified." }, { status: 409 })
      const matchStatus = affiliationStatus === "Confirmed degree alumnus" && !result.currentRoleAmbiguous && !result.linkedInternalAlumnusId ? "New" : result.matchStatus === "New" ? "Needs review" : result.matchStatus
      await db.update(externalDiscoveryResults).set({ affiliationStatus, matchStatus, reviewNote: `Affiliation classified by ${actor}.` }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "education_affiliation_qualified", entityType: "discovery_result", entityId: result.id, metadata: { affiliationStatus, provider: result.provider } })
      return Response.json({ qualified: true, affiliationStatus, matchStatus })
    }

    if (payload.action === "approve") {
      const resultIds = [...new Set(payload.resultIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
      if (!resultIds.length) return Response.json({ error: "Select at least one confirmed degree alumnus." }, { status: 400 })
      const results = await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds))
      if (results.some(result => result.matchStatus !== "New" || result.affiliationStatus !== "Confirmed degree alumnus" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending)) return Response.json({ error: "Only confirmed degree alumni that are clearly new and pending review can be added in a batch." }, { status: 409 })
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
      if (!result || result.matchStatus !== "Possible duplicate" || result.affiliationStatus !== "Confirmed degree alumnus" || result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return Response.json({ error: "Only a confirmed pending possible duplicate can be kept as a separate record." }, { status: 409 })
      const [created] = await db.insert(alumni).values(alumnusValues(result, actor, now, " after duplicate review")).returning()
      await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id))
      await writeSecurityAudit(context, { action: "possible_duplicate_kept_separate", entityType: "alumnus", entityId: created.id, metadata: { provider: PROFESSIONAL_DATA_PROVIDER, discoveryResultId: result.id } })
      return Response.json({ alumnusId: created.id }, { status: 201 })
    }

    if (payload.action === "ignore" && Number.isInteger(payload.resultId)) {
      const allowed = new Set(["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"]); const reason = allowed.has(String(payload.reason)) ? String(payload.reason) : "Other"
      await db.update(externalDiscoveryResults).set({ reviewStatus: "Ignored", reviewNote: reason, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, payload.resultId!))
      await writeSecurityAudit(context, { action: "coresignal_result_ignored", entityType: "discovery_result", entityId: payload.resultId, metadata: { reason } })
      return Response.json({ ignored: true, reason })
    }
    return Response.json({ error: "Unsupported discovery action." }, { status: 400 })
  } catch (error) { const denied = accessErrorResponse(error); if (denied) return denied; return Response.json({ error: error instanceof Error ? error.message : "Unable to complete external alumni discovery." }, { status: 500 }) }
}
