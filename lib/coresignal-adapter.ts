import {
  FIXED_ALUMNI_SCHOOL,
  clean,
  normalizeFunction,
  normalizeSeniority,
  normalized,
  type DirectoryFilters,
  type DiscoveryProfile,
} from "@/lib/alumni-search"
import { collectCoresignalEmployee, CORESIGNAL_IIML_INSTITUTION_URL, CoresignalProviderError, searchCoresignalIiml } from "@/lib/coresignal-client"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { coresignalLiveSearchMaximum, providerConfigured, providerMode } from "@/lib/provider-runtime"
import {
  mockProviderUsage,
  PROFESSIONAL_DATA_PROVIDER,
  PROFESSIONAL_DATA_PROVIDER_LABEL,
  type InternalProfessionalPerson,
  type ProfessionalDataProvider,
  type ProfessionalRefreshResult,
  type ProfessionalSearchResult,
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
  return first(education, ["institution_name", "school_name"]) || first(institution, ["name", "title"])
}

function institutionUrl(education: Row) {
  const institution = row(education.institution ?? education.school)
  return first(education, ["institution_professional_network_url", "institution_url", "school_url"]) || first(institution, ["professional_network_url", "linkedin_url", "url"])
}

export function iimlEducationRecords(profile: Row) {
  return validEducationRecords(profile).filter(education => institutionUrl(education) === CORESIGNAL_IIML_INSTITUTION_URL
    || normalized(institutionName(education)).includes("indian institute of management lucknow"))
}

export function validCurrentEmployment(profile: Row) {
  const source = rows(profile.experience).length ? rows(profile.experience) : rows(profile.active_experience)
  return source.filter(experience => notDeleted(experience) && isCurrent(experience))
}

export function classifyIimlAffiliation(education: Row | undefined): AffiliationStatus {
  if (!education) return "Potential alumnus — review required"
  const programme = normalized(first(education, ["degree", "degree_name", "program", "programme", "field_of_study", "subtitle"]))
  if (/exchange|visiting|short term|short-term|certificate|executive education|summer school/.test(programme)) return "Short-term / exchange affiliation"
  if (/\bmba\b|\bpgdm\b|\bpgp\b|master|bachelor|doctor|\bphd\b|post graduate|postgraduate/.test(programme)) return "Confirmed degree alumnus"
  return "Potential alumnus — review required"
}

function dateValue(value: unknown) {
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  const date = row(value)
  const year = clean(date.year)
  const month = clean(date.month)
  return [year, month.padStart(2, "0")].filter(Boolean).join("-")
}

function mapProfile(record: Row, index: number): DiscoveryProfile | null {
  if (!notDeleted(record)) return null
  const employeeId = first(record, ["id", "employee_id", "employee_base_id"])
  const education = iimlEducationRecords(record)[0]
  const current = validCurrentEmployment(record)
  const currentRoleAmbiguous = current.length > 1
  const employment = currentRoleAmbiguous ? {} : current[0] ?? {}
  const company = row(employment.company)
  const rawTitle = first(employment, ["title", "position", "role"]) || first(record, ["active_experience_title", "current_title", "headline"])
  const currentCompany = first(employment, ["company_name", "organization_name"]) || first(company, ["name"]) || first(record, ["active_experience_company_name", "current_company_name"])
  const programme = education ? first(education, ["degree", "degree_name", "program", "programme", "field_of_study", "subtitle"]) : ""
  const endDate = education ? dateValue(education.date_to ?? education.end_date) : ""
  const graduationYear = Number(endDate.match(/\d{4}/)?.[0] ?? 0)
  const linkedinUrl = normalizeProfessionalProfileUrl(first(record, ["professional_network_url", "linkedin_url", "url"]))
  return {
    providerResultId: employeeId || `coresignal-${index + 1}`,
    providerPersonId: employeeId,
    name: first(record, ["full_name", "name"]) || "Name unavailable",
    education: education ? institutionName(education) || FIXED_ALUMNI_SCHOOL : FIXED_ALUMNI_SCHOOL,
    currentCompany: currentRoleAmbiguous ? "Multiple current roles — review required" : currentCompany || "Company unavailable",
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
    educationStartDate: education ? dateValue(education.date_from ?? education.start_date) : "",
    educationEndDate: endDate,
    institutionId: education ? first(education, ["institution_id", "school_id"]) : "",
    institutionUrl: education ? institutionUrl(education) : CORESIGNAL_IIML_INSTITUTION_URL,
    currentCompanyId: currentRoleAmbiguous ? "" : first(employment, ["company_id", "organization_id"]) || first(company, ["id"]),
    currentCompanyUrl: currentRoleAmbiguous ? "" : first(employment, ["company_professional_network_url", "company_url"]) || first(company, ["professional_network_url", "linkedin_url", "url"]),
    currentRoleStartDate: currentRoleAmbiguous ? "" : dateValue(employment.date_from ?? employment.start_date),
    currentIndustry: currentRoleAmbiguous ? "" : first(employment, ["industry"]) || first(company, ["industry"]),
    currentRoleAmbiguous,
    providerFreshnessAt: first(record, ["last_updated", "updated_at", "last_refresh_at"]),
  }
}

function filterProfiles(profiles: DiscoveryProfile[], filters: DirectoryFilters) {
  return profiles.filter(profile => {
    return (!filters.name || normalized(profile.name).includes(normalized(filters.name)))
      && (filters.company === "All companies" || normalized(profile.currentCompany) === normalized(filters.company))
      && (!filters.role || normalized(profile.role).includes(normalized(filters.role)))
      && (filters.function === "All functions" || profile.function === filters.function)
      && (!filters.location || normalized(profile.location).includes(normalized(filters.location)))
      && (!filters.batch || profile.graduationYear === Number(filters.batch))
      && (filters.seniority === "All levels" || profile.seniority === filters.seniority.replace(/\+$/, ""))
  })
}

function mockRows(filters: DirectoryFilters, internal: InternalProfessionalPerson[]) {
  const company = filters.company === "All companies" ? "Local Fixture Company" : filters.company
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

async function searchCandidates(filters: DirectoryFilters, internal: InternalProfessionalPerson[], limit: number): Promise<ProfessionalSearchResult> {
  if (providerMode("coresignal") === "mock") {
    const profiles = filterProfiles(mockRows(filters, internal).map(mapProfile).filter(Boolean) as DiscoveryProfile[], filters).slice(0, limit)
    return { profiles, totalAvailable: profiles.length, responseSummary: `${profiles.length} demonstration Coresignal profiles returned for qualification and review.`, usage: mockProviderUsage(profiles.length) }
  }
  const previewRows = responseRows(await searchCoresignalIiml())
  const candidateIds = previewRows.map(item => first(item, ["id", "employee_id", "employee_base_id"])).filter(Boolean)
  const collected: Row[] = []
  for (const employeeId of candidateIds.slice(0, Math.min(limit, coresignalLiveSearchMaximum()))) {
    try { collected.push(responseRow(await collectCoresignalEmployee(employeeId))) }
    catch (error) {
      if (error instanceof CoresignalProviderError) throw new CoresignalProviderError(error.message, error.kind, error.status, successfulCoresignalOperationCredits(true, collected.length))
      throw error
    }
  }
  const all = filterProfiles(collected.map(mapProfile).filter(Boolean) as DiscoveryProfile[], filters)
  const profiles = all.slice(0, Math.min(limit, coresignalLiveSearchMaximum()))
  return { profiles, totalAvailable: candidateIds.length, responseSummary: profiles.length ? `${profiles.length} Coresignal affiliation candidates returned for qualification and review.` : "No additional external affiliation candidates were found.", usage: unknownProviderUsage(successfulCoresignalOperationCredits(true, collected.length)) }
}

async function refreshProfile(person: InternalProfessionalPerson): Promise<ProfessionalRefreshResult> {
  if (providerMode("coresignal") === "mock") {
    const profile = mapProfile(mockRows({ name: "", company: "All companies", role: "", function: "All functions", seniority: "All levels", location: "", programme: "All programmes", batch: "", previousCompany: "", minRelevance: 0, minConfidence: 0, contactStatus: "All contact states", outreachStatus: "All outreach states", relationship: "All relationships" }, [person])[0], 0)
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
