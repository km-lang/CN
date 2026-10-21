import {
  FIXED_ALUMNI_SCHOOL,
  clean,
  defaultDiscoveryFilters,
  normalizeFunction,
  normalizeSeniority,
  normalized,
  type DiscoveryFilters,
  type DiscoveryProfile,
} from "@/lib/alumni-search"
import { collectCoresignalEmployee, coresignalDiscoveryEsDslPreviewContract, coresignalExactYearEsDslPreviewContract, CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, CORESIGNAL_IIML_INSTITUTION_URL, CoresignalProviderError, previewCoresignalEmployeesExactYear, searchCoresignalIiml } from "@/lib/coresignal-client"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { DEFAULT_DISCOVERY_PROGRAMMES, discoveryQualification, normalizeCoresignalProgramme } from "@/lib/discovery-qualification"
import { CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES } from "@/lib/discovery-provider-capabilities"
import { executeSelectiveDiscovery } from "@/lib/discovery-execution"
import { coresignalLiveSearchMaximum, providerConfigured, providerMode } from "@/lib/provider-runtime"
import {
  mockProviderUsage,
  PROFESSIONAL_DATA_PROVIDER,
  PROFESSIONAL_DATA_PROVIDER_LABEL,
  type InternalProfessionalPerson,
  type ProfessionalDataProvider,
  type ProfessionalRefreshResult,
  type ProfessionalSearchResult,
  type ProfessionalSearchOptions,
  unknownProviderUsage,
} from "@/lib/professional-data"

type Row = Record<string, unknown>
export type AffiliationStatus = DiscoveryProfile["affiliationStatus"]

function row(value: unknown): Row { return value && typeof value === "object" ? value as Row : {} }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as Row[] : [] }
function first(value: Row, keys: string[]) { for (const key of keys) { const found = clean(value[key]); if (found) return found } return "" }
function notDeleted(value: Row) { return value.deleted === undefined || value.deleted === null || value.deleted === 0 || value.deleted === "0" || value.deleted === false }
function isCurrent(value: Row) { return value.is_current === 1 || value.is_current === "1" || value.is_current === true }

export function validEducationRecords(profile: Row) {
  return rows(profile.education).filter(notDeleted)
}

function institutionName(education: Row) {
  const institution = row(education.institution ?? education.school)
  const scalarInstitution = typeof education.institution === "string" ? clean(education.institution) : ""
  const scalarSchool = typeof education.school === "string" ? clean(education.school) : ""
  return scalarInstitution || scalarSchool || first(education, ["institution_name", "school_name"]) || first(institution, ["name", "title"])
}

function institutionUrl(education: Row) {
  const institution = row(education.institution ?? education.school)
  return first(education, ["institution_professional_network_url", "institution_url", "school_url"]) || first(institution, ["professional_network_url", "linkedin_url", "url"])
}

export function iimlEducationRecords(profile: Row) {
  return validEducationRecords(profile).filter(education => Number(first(education, ["institution_id", "school_id"])) === CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID
    || institutionUrl(education) === CORESIGNAL_IIML_INSTITUTION_URL
    || normalized(institutionName(education)).includes("indian institute of management lucknow"))
}

export function validCurrentEmployment(profile: Row) {
  const source = rows(profile.experience).length ? rows(profile.experience) : rows(profile.active_experience)
  return source.filter(experience => notDeleted(experience) && isCurrent(experience))
}

export function classifyIimlAffiliation(education: Row | undefined): AffiliationStatus {
  if (!education) return "Potential alumnus — review required"
  const rawProgramme = first(education, ["degree", "degree_name", "program", "programme", "field_of_study", "subtitle"])
  const programme = normalized(rawProgramme)
  if (/exchange|visiting|short term|short-term|certificate|executive education|summer school/.test(programme)) return "Short-term / exchange affiliation"
  // Generic MBA/PGDM can support degree-level affiliation, but cannot by
  // itself identify the specific PGP, ABM, or SM programme.
  if (/^(?:mba|pgdm|master of business administration|post graduate diploma(?: in management)?)$/.test(programme)) return "Confirmed degree alumnus"
  if (normalizeCoresignalProgramme(rawProgramme).code) return "Confirmed degree alumnus"
  return "Potential alumnus — review required"
}

function dateValue(value: unknown) {
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  const date = row(value)
  const year = clean(date.year)
  const month = clean(date.month)
  if (!year) return ""
  return month ? `${year}-${month.padStart(2, "0")}` : year
}

export function normalizedCurrentRoleEvidence(profile: Row) {
  const byIdentity = new Map<string, { company: string; title: string; seniority: string; startDate: string; source: Row }>()
  for (const experience of validCurrentEmployment(profile)) {
    const companyRecord = row(experience.company)
    const company = first(experience, ["company_name", "organization_name"]) || first(companyRecord, ["name"])
    const title = first(experience, ["title", "position", "role"])
    const startDate = dateValue(experience.date_from ?? experience.start_date)
    const key = `${normalized(company)}|${normalized(title)}`
    if (!key.replace("|", "")) continue
    const current = byIdentity.get(key)
    if (!current || (!current.startDate && startDate)) byIdentity.set(key, { company, title, seniority: normalizeSeniority(first(experience, ["seniority"]), title), startDate, source: experience })
  }
  return [...byIdentity.values()]
}

export function normalizedIimlEducationEvidence(profile: Row) {
  const byEducationPeriod = new Map<string, { institution: string; programme: string; normalizedProgramme: string; startDate: string; endDate: string; graduationYear: number; source: Row }>()
  for (const education of iimlEducationRecords(profile)) {
    const programme = first(education, ["degree", "degree_name", "program", "programme", "field_of_study", "subtitle"])
    const normalizedProgramme = normalizeCoresignalProgramme(programme).code ?? ""
    const startDate = dateValue(education.date_from) || dateValue(education.start_date) || dateValue(education.date_from_year) || dateValue(education.start_year)
    const endDate = dateValue(education.date_to) || dateValue(education.end_date) || dateValue(education.date_to_year) || dateValue(education.end_year)
    const graduationYear = Number(endDate.match(/\d{4}/)?.[0] ?? 0)
    const programmeKey = normalizedProgramme || normalized(programme) || "programme-not-returned"
    // Collapse literal duplicates without merging distinct periods for the
    // same programme. Exact-year qualification must be able to inspect every
    // distinct IIML education row and find a match within that same row.
    const educationKey = `${programmeKey}|${startDate}|${endDate}`
    const evidence = { institution: institutionName(education) || FIXED_ALUMNI_SCHOOL, programme, normalizedProgramme, startDate, endDate, graduationYear, source: education }
    const current = byEducationPeriod.get(educationKey)
    const evidenceScore = Number(Boolean(graduationYear)) * 4 + Number(Boolean(endDate)) * 2 + Number(Boolean(startDate)) + Number(Boolean(programme))
    const currentScore = current ? Number(Boolean(current.graduationYear)) * 4 + Number(Boolean(current.endDate)) * 2 + Number(Boolean(current.startDate)) + Number(Boolean(current.programme)) : -1
    if (!current || evidenceScore > currentScore) byEducationPeriod.set(educationKey, evidence)
  }
  const evidence = [...byEducationPeriod.values()]
  return evidence.filter(item => item.startDate || item.endDate || !evidence.some(other =>
    other !== item
    && (other.normalizedProgramme || normalized(other.programme) || "programme-not-returned") === (item.normalizedProgramme || normalized(item.programme) || "programme-not-returned")
    && Boolean(other.startDate || other.endDate),
  ))
}

function mapProfile(record: Row, index: number, options: { now?: Date; selectedProgrammes?: readonly string[] } = {}): DiscoveryProfile | null {
  if (!notDeleted(record)) return null
  const employeeId = first(record, ["id", "employee_id", "employee_base_id"])
  const selectedProgrammes = options.selectedProgrammes ?? DEFAULT_DISCOVERY_PROGRAMMES
  const educationEvidence = normalizedIimlEducationEvidence(record)
  const selectedEducation = educationEvidence.find(candidate => candidate.normalizedProgramme && selectedProgrammes.includes(candidate.normalizedProgramme)) ?? educationEvidence[0]
  const education = selectedEducation?.source
  const currentRoles = normalizedCurrentRoleEvidence(record)
  const currentRoleAmbiguous = currentRoles.length > 1
  const currentRole = currentRoleAmbiguous ? undefined : currentRoles[0]
  const employment = currentRole?.source ?? {}
  const company = row(employment.company)
  const rawTitle = first(employment, ["title", "position", "role"]) || first(record, ["active_experience_title", "current_title", "headline"])
  const currentCompany = first(employment, ["company_name", "organization_name"]) || first(company, ["name"]) || first(record, ["active_experience_company_name", "current_company_name"])
  const programme = selectedEducation?.programme ?? ""
  const endDate = selectedEducation?.endDate ?? ""
  const graduationYear = selectedEducation?.graduationYear ?? 0
  const linkedinUrl = normalizeProfessionalProfileUrl(first(record, ["profile_url", "professional_network_url", "linkedin_url", "url"]))
  const qualification = discoveryQualification(programme, endDate, selectedProgrammes, options.now)
  return {
    providerResultId: employeeId || `coresignal-${index + 1}`,
    providerPersonId: employeeId,
    name: first(record, ["full_name", "name"]) || "Name unavailable",
    education: selectedEducation?.institution ?? FIXED_ALUMNI_SCHOOL,
    currentCompany: currentRoleAmbiguous ? "Multiple current roles — review required" : currentCompany || "Company unavailable",
    currentCompanyEvidenceSource: currentRoleAmbiguous ? "NONE" : currentCompany ? "COLLECTED_CURRENT_ROLE" : "NONE",
    role: currentRoleAmbiguous ? "Multiple current roles — review required" : rawTitle || "Role unavailable",
    rawTitle: currentRoleAmbiguous ? "" : rawTitle,
    function: currentRoleAmbiguous ? "Other" : normalizeFunction(first(employment, ["function", "department"]), rawTitle),
    seniority: currentRoleAmbiguous ? "Analyst/Junior" : normalizeSeniority(first(employment, ["seniority"]), rawTitle),
    location: first(record, ["location_full", "location", "location_name"]),
    graduationYear,
    linkedinUrl,
    matchConfidence: education ? 90 : 60,
    affiliationStatus: classifyIimlAffiliation(education),
    educationProgramme: programme,
    normalizedProgramme: qualification.normalizedProgramme,
    programmeStatus: qualification.programmeStatus,
    alumniStatus: qualification.alumniStatus,
    eligibleForAddition: qualification.eligibleForAddition,
    educationStartDate: selectedEducation?.startDate ?? "",
    educationEndDate: endDate,
    institutionId: education ? first(education, ["institution_id", "school_id"]) : "",
    institutionUrl: education ? institutionUrl(education) : CORESIGNAL_IIML_INSTITUTION_URL,
    currentCompanyId: currentRoleAmbiguous ? "" : first(employment, ["company_id", "organization_id"]) || first(company, ["id"]),
    currentCompanyUrl: currentRoleAmbiguous ? "" : first(employment, ["company_professional_network_url", "company_url"]) || first(company, ["professional_network_url", "linkedin_url", "url"]),
    currentRoleStartDate: currentRoleAmbiguous ? "" : dateValue(employment.date_from ?? employment.start_date),
    currentIndustry: currentRoleAmbiguous ? "" : first(employment, ["industry"]) || first(company, ["industry"]),
    currentRoleAmbiguous,
    providerFreshnessAt: first(record, ["last_updated", "updated_at", "last_refresh_at"]),
    currentRoles: currentRoles.map(({ company: roleCompany, title, seniority, startDate }) => ({ company: roleCompany, title, seniority, startDate })),
    iimlEducationEvidence: educationEvidence.map(({ institution, programme: evidenceProgramme, normalizedProgramme, startDate, endDate: evidenceEndDate, graduationYear: evidenceYear }) => ({ institution, programme: evidenceProgramme, normalizedProgramme, startDate, endDate: evidenceEndDate, graduationYear: evidenceYear })),
  }
}

export function mapCoresignalPreview(record: Row, index: number): DiscoveryProfile | null {
  if (!notDeleted(record)) return null
  const employeeId = first(record, ["id", "employee_id", "employee_base_id"])
  const rawTitle = first(record, ["active_experience_title", "title", "current_title", "headline"])
  const activeExperienceCompany = first(record, ["active_experience_company_name"])
  const summaryCompany = first(record, ["company_name", "current_company_name"])
  const company = activeExperienceCompany || summaryCompany
  const currentCompanyEvidenceSource = activeExperienceCompany ? "ACTIVE_EXPERIENCE" : summaryCompany ? "GENERIC_SUMMARY" : "NONE"
  const linkedinUrl = normalizeProfessionalProfileUrl(first(record, ["profile_url", "professional_network_url", "linkedin_url", "url"]))
  // The documented Preview response does not promise education fields. Keep
  // them optional, but preserve exact same-row IIML evidence if the provider
  // returns it instead of discarding it during normalization.
  const educationEvidence = normalizedIimlEducationEvidence(record)
  const displayedEducation = educationEvidence[0]
  return {
    providerResultId: employeeId || `coresignal-preview-${index + 1}`,
    providerPersonId: employeeId,
    name: first(record, ["full_name", "name"]) || "Name unavailable",
    education: displayedEducation?.institution ?? "Education not returned",
    currentCompany: company || "Company unavailable",
    currentCompanyEvidenceSource,
    role: rawTitle || "Role unavailable",
    rawTitle,
    function: normalizeFunction("", rawTitle),
    seniority: rawTitle ? normalizeSeniority("", rawTitle) : "Analyst/Junior",
    location: first(record, ["location_full", "experience_location", "location", "location_country", "country"]),
    graduationYear: displayedEducation?.graduationYear ?? 0,
    linkedinUrl,
    matchConfidence: [employeeId, linkedinUrl, company, rawTitle].filter(Boolean).length >= 3 ? 70 : 55,
    affiliationStatus: "Potential alumnus — review required",
    educationProgramme: displayedEducation?.programme ?? "",
    normalizedProgramme: displayedEducation?.normalizedProgramme ?? "",
    programmeStatus: "Programme requires review",
    alumniStatus: "Graduation status unknown — review required",
    eligibleForAddition: false,
    educationStartDate: displayedEducation?.startDate ?? "",
    educationEndDate: displayedEducation?.endDate ?? "",
    institutionId: displayedEducation ? first(displayedEducation.source, ["institution_id", "school_id"]) : "",
    institutionUrl: displayedEducation ? institutionUrl(displayedEducation.source) : "",
    currentCompanyId: first(record, ["company_id"]),
    currentCompanyUrl: first(record, ["active_experience_company_url", "active_experience_company_professional_network_url", "company_url", "company_professional_network_url", "company_linkedin_url"]),
    currentRoleStartDate: "",
    currentIndustry: first(record, ["company_industry"]),
    currentRoleAmbiguous: false,
    providerFreshnessAt: "",
    iimlEducationEvidence: educationEvidence.map(({ institution, programme, normalizedProgramme, startDate, endDate, graduationYear }) => ({ institution, programme, normalizedProgramme, startDate, endDate, graduationYear })),
  }
}

function mockRows(filters: DiscoveryFilters, internal: InternalProfessionalPerson[]) {
  const company = filters.company || "Local Fixture Company"
  const mapped = internal.slice(0, 2).map((person, index) => ({
    id: `cs-mapped-${person.id}`, full_name: person.name, professional_network_url: person.linkedinUrl,
    location_full: person.location, deleted: 0, last_updated: "2026-09-26T00:00:00.000Z",
    education: [{ institution_name: FIXED_ALUMNI_SCHOOL, institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL, degree_name: index ? "PGDM" : "MBA", date_from: "2018", date_to: String(person.batch), deleted: 0 }],
    experience: [{ company_name: person.company, title: person.title, is_current: 1, deleted: 0 }],
  }))
  return [...mapped,
    { id: "cs-degree-1", full_name: "Demo Degree Alumnus", professional_network_url: "https://www.linkedin.com/in/demo-degree-alumnus", location_full: "Bengaluru, India", deleted: 0, education: [{ institution_name: FIXED_ALUMNI_SCHOOL, institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL, degree_name: "MBA", date_from: "2019", date_to: "2021", deleted: 0 }], experience: [{ company_name: company, title: "Director, Strategy", is_current: 1, deleted: 0 }, { company_name: "Deleted Employer", title: "Wrong current role", is_current: 1, deleted: 1 }] },
    { id: "cs-exchange-1", full_name: "Demo Exchange Candidate", professional_network_url: "https://www.linkedin.com/in/demo-exchange-candidate", location_full: "Paris, France", deleted: 0, education: [{ institution_name: FIXED_ALUMNI_SCHOOL, institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL, degree_name: "Exchange programme", date_from: "2024-09", date_to: "2024-12", deleted: 0 }], experience: [{ company_name: company, title: "Product Manager", is_current: 1, deleted: 0 }] },
    { id: "cs-review-1", full_name: "Demo Affiliation Review", professional_network_url: "https://www.linkedin.com/in/demo-affiliation-review", location_full: "Mumbai, India", deleted: 0, education: [{ institution_name: FIXED_ALUMNI_SCHOOL, institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL, degree_name: "Marketing", date_from: "2022", date_to: "2023", deleted: 0 }, { institution_name: FIXED_ALUMNI_SCHOOL, degree_name: "Deleted MBA", deleted: 1 }], experience: [{ company_name: "Company A", title: "Director", is_current: 1, deleted: 0 }, { company_name: "Company B", title: "Advisor", is_current: 1, deleted: 0 }] },
  ]
}

function responseRows(body: unknown) {
  if (Array.isArray(body)) return rows(body)
  const value = row(body)
  return rows(value.data).length ? rows(value.data) : rows(value.results).length ? rows(value.results) : rows(value.employees)
}

function responseRow(body: unknown) {
  const value = row(body)
  return Object.keys(row(value.data)).length ? row(value.data) : Object.keys(row(value.employee)).length ? row(value.employee) : value
}

export function successfulCoresignalOperationCredits(searchSucceeded: boolean, successfulCollects: number) {
  return (searchSucceeded ? 1 : 0) + Math.max(0, Math.trunc(successfulCollects))
}

async function searchCandidates(filters: DiscoveryFilters, internal: InternalProfessionalPerson[], limit: number, options: ProfessionalSearchOptions = {}): Promise<ProfessionalSearchResult> {
  const now = new Date()
  const selectedProgrammes = filters.discoveryProgrammes ?? DEFAULT_DISCOVERY_PROGRAMMES
  const safeLimit = Math.min(Math.max(0, Math.trunc(limit)), coresignalLiveSearchMaximum())
  if (providerMode("coresignal") === "mock") {
    const source = mockRows(filters, internal)
    const fullById = new Map(source.map((record, index) => [first(record, ["id"]), mapProfile(record, index, { now, selectedProgrammes })] as const))
    const previewProfiles = source.map((record, index) => {
      if (filters.graduationYear) return mapCoresignalPreview(record, index)
      const full = fullById.get(first(record, ["id"]))
      return full ? mapCoresignalPreview({ id: full.providerPersonId, full_name: full.name, profile_url: full.linkedinUrl, company_name: full.currentRoleAmbiguous ? "" : full.currentCompany, title: full.currentRoleAmbiguous ? "" : full.rawTitle, location: full.location }, index) : null
    }).filter(Boolean) as DiscoveryProfile[]
    const exactYear = filters.graduationYear ? Number(filters.graduationYear) : null
    const execution = await executeSelectiveDiscovery({
      previewProfiles,
      filters,
      alumni: internal,
      rejectedCandidates: options.rejectedCandidates ?? [],
      capabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
      requestedCount: safeLimit,
      maximumCollects: exactYear === null ? Math.min(options.maximumCollects ?? safeLimit, safeLimit) : 0,
      ...(exactYear === null ? {} : { searchConstraint: {
        institutionId: CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID,
        exactGraduationYear: exactYear,
        providerCompanyId: options.exactYearPreview?.companyId ?? null,
        exactCompanyName: options.exactYearPreview?.companyName ?? null,
        companyIdentityMode: options.exactYearPreview?.companyIdentityMode ?? null,
        expectedCompanyUrl: options.exactYearPreview?.expectedCompanyUrl ?? null,
        semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW" as const,
      } }),
      collect: async employeeId => fullById.get(employeeId) ?? null,
    })
    execution.metrics.previewCountReturned = previewProfiles.length
    return { profiles: execution.selectedCandidates.map(item => item.profile), totalAvailable: previewProfiles.length, responseSummary: `${execution.metrics.previewCountConsidered} demonstration Preview candidates considered; ${execution.metrics.collectExecuted} mock Collect operations selected.`, usage: mockProviderUsage(execution.metrics.collectExecuted), execution }
  }
  if (options.exactYearPreview) {
    const contract = filters.graduationYear ? coresignalExactYearEsDslPreviewContract({
      graduationYear: filters.graduationYear,
      programmes: filters.discoveryProgrammes,
      seniorities: filters.seniorities,
      seniority: filters.seniority,
      companyId: options.exactYearPreview.companyId,
      companyName: options.exactYearPreview.companyName,
      page: options.exactYearPreview.page,
    }) : coresignalDiscoveryEsDslPreviewContract({
      programmes: filters.discoveryProgrammes,
      seniorities: filters.seniorities,
      seniority: filters.seniority,
      companyId: options.exactYearPreview.companyId,
      companyName: options.exactYearPreview.companyName,
      page: options.exactYearPreview.page,
    })
    const providerResponse = await previewCoresignalEmployeesExactYear(contract.body, {
      operationContext: options.exactYearPreview.operationContext,
      page: options.exactYearPreview.page,
    })
    const previewRows = responseRows(providerResponse.body)
    const previewProfiles = previewRows.map((record, index) => mapCoresignalPreview(record, index)).filter(Boolean) as DiscoveryProfile[]
    const execution = await executeSelectiveDiscovery({
      previewProfiles,
      filters,
      alumni: internal,
      rejectedCandidates: options.rejectedCandidates ?? [],
      capabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
      requestedCount: safeLimit,
      maximumCollects: 0,
      searchConstraint: {
        institutionId: CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID,
        exactGraduationYear: filters.graduationYear ? Number(filters.graduationYear) : 0,
        providerCompanyId: options.exactYearPreview.companyId ?? null,
        exactCompanyName: options.exactYearPreview.companyName ?? null,
        companyIdentityMode: options.exactYearPreview.companyIdentityMode ?? null,
        expectedCompanyUrl: options.exactYearPreview.expectedCompanyUrl ?? null,
        semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW",
      },
      collect: async () => null,
    })
    execution.metrics.previewCountReturned = previewProfiles.length
    const profiles = execution.selectedCandidates.map(item => item.profile)
    return {
      profiles,
      totalAvailable: providerResponse.totalResults ?? previewProfiles.length,
      responseSummary: `${previewProfiles.length} ES-DSL Preview candidates returned from page ${providerResponse.page}; ${execution.metrics.previewCountConsidered} considered; 0 Collect operations; provider request cost remains unresolved.`,
      usage: unknownProviderUsage(1),
      providerCreditsRemaining: providerResponse.providerCreditsRemaining,
      execution,
    }
  }
  const previewRows = responseRows(await searchCoresignalIiml({ filters, now }))
  const previewProfiles = previewRows.map((record, index) => mapCoresignalPreview(record, index)).filter(Boolean) as DiscoveryProfile[]
  let successfulCollects = 0
  let execution
  try {
    execution = await executeSelectiveDiscovery({
      previewProfiles,
      filters,
      alumni: internal,
      rejectedCandidates: options.rejectedCandidates ?? [],
      capabilities: CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
      requestedCount: safeLimit,
      maximumCollects: Math.min(options.maximumCollects ?? safeLimit, safeLimit),
      collect: async (employeeId, index) => {
        const record = responseRow(await collectCoresignalEmployee(employeeId))
        successfulCollects += 1
        return mapProfile(record, index, { now, selectedProgrammes })
      },
    })
  } catch (error) {
    if (error instanceof CoresignalProviderError) throw new CoresignalProviderError(error.message, error.kind, error.status, successfulCoresignalOperationCredits(true, successfulCollects))
    throw error
  }
  const profiles = execution.selectedCandidates.map(item => item.profile)
  execution.metrics.previewCountReturned = previewProfiles.length
  const metrics = execution.metrics
  return { profiles, totalAvailable: previewProfiles.length, responseSummary: profiles.length ? `${metrics.previewCountReturned} Preview candidates returned; ${metrics.previewCountConsidered} considered; ${metrics.collectExecuted} collected; ${metrics.potentialCollectionsAvoided} potential collections avoided.` : "No additional external affiliation candidates were found.", usage: unknownProviderUsage(successfulCoresignalOperationCredits(true, successfulCollects)), execution }
}

async function refreshProfile(person: InternalProfessionalPerson): Promise<ProfessionalRefreshResult> {
  if (providerMode("coresignal") === "mock") {
    const profile = mapProfile(mockRows(defaultDiscoveryFilters(), [person])[0], 0)
    return profile ? { status: "success", changes: changesFrom(profile), responseSummary: "Demonstration Coresignal profile collected for review.", usage: mockProviderUsage(1) } : { status: "no_match", changes: {}, responseSummary: "No matching professional profile found.", usage: mockProviderUsage(1) }
  }
  if (!person.coresignalEmployeeId) return { status: "no_match", changes: {}, responseSummary: "No stable Coresignal employee ID is stored for this alumnus.", usage: unknownProviderUsage(0) }
  const profile = mapProfile(responseRow(await collectCoresignalEmployee(person.coresignalEmployeeId)), 0)
  if (!profile) return { status: "no_match", changes: {}, responseSummary: "Coresignal returned no active employee profile.", usage: unknownProviderUsage(1) }
  return { status: "success", changes: changesFrom(profile), responseSummary: profile.currentRoleAmbiguous ? "Coresignal profile collected. Multiple surviving current roles require human review; no current role was selected automatically." : "Coresignal profile collected for review.", usage: unknownProviderUsage(1) }
}

function changesFrom(profile: DiscoveryProfile) {
  return {
    coresignalEmployeeId: profile.providerPersonId, linkedinUrl: profile.linkedinUrl, location: profile.location,
    ...(profile.currentRoleAmbiguous ? {} : { company: profile.currentCompany, title: profile.role, rawTitle: profile.rawTitle, function: profile.function, seniority: profile.seniority }),
    graduationYear: profile.graduationYear, iimlAffiliationStatus: profile.affiliationStatus,
    iimlEducationProgramme: profile.educationProgramme, iimlEducationStartDate: profile.educationStartDate, iimlEducationEndDate: profile.educationEndDate,
    iimlInstitutionId: profile.institutionId, iimlInstitutionUrl: profile.institutionUrl, currentCompanyId: profile.currentCompanyId,
    currentCompanyUrl: profile.currentCompanyUrl, currentRoleStartDate: profile.currentRoleStartDate, currentIndustry: profile.currentIndustry,
    currentRoleAmbiguous: profile.currentRoleAmbiguous, providerFreshnessAt: profile.providerFreshnessAt,
  }
}

export const coresignalProvider: ProfessionalDataProvider = {
  name: PROFESSIONAL_DATA_PROVIDER,
  label: PROFESSIONAL_DATA_PROVIDER_LABEL,
  mode: () => providerMode("coresignal"),
  configured: () => providerConfigured("coresignal"),
  searchCandidates,
  refreshProfile,
}

export { mapProfile as mapCoresignalProfile }
