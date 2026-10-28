import { MISSING_COMPANY_FILTER, missingProfessionalValue } from "@/lib/pcom-workflow";
import { matchesLinkedinProfileFilter, normalizeProfessionalProfileUrl } from "@/lib/professional-profile";
import { DEFAULT_DISCOVERY_PROGRAMMES, normalizeDiscoveryProgrammeSelections, type AlumniStatus, type AlumniStatusFilter, type ProgrammeStatus } from "@/lib/discovery-qualification";

export const FIXED_ALUMNI_SCHOOL = "Indian Institute of Management Lucknow";

export type DirectoryFilters = {
  profileStatus: "All profiles" | "Verified alumni" | "Provisional" | "Needs review";
  excludeProvisional: boolean;
  search: string;
  name: string;
  company: string;
  companyPriority: string;
  role: string;
  function: string;
  seniority: string;
  location: string;
  linkedinUrl: string;
  programme: string;
  programmes: string[];
  alumniIds: number[];
  batch: string;
  graduationYearMode: "exact" | "onOrBefore" | "range" | "multiple";
  graduationYearStart: string;
  graduationYearEnd: string;
  graduationYears: string;
  seniorityMode: "selected" | "minimum";
  seniorities: string[];
  previousCompany: string;
  minRelevance: number;
  maxRelevance: number;
  minConfidence: number;
  contactStatus: string;
  outreachStatus: string;
  relationship: string;
};

export type DiscoveryFilters = {
  alumniStatus: AlumniStatusFilter;
  discoveryProgrammes: string[];
  company: string;
  /** Internal saved-company selection key. Never a provider ID; resolved authoritatively by the server. */
  companySelectionKey: string;
  role: string;
  function: string;
  seniorities: string[];
  /** Legacy single-value representation retained for stored-search/API compatibility. */
  seniority: string;
  location: string;
  graduationYear: string;
};

export type SearchableAlumnus = {
  intakeStatus?: "VERIFIED" | "PROVISIONAL" | "REVIEW_REQUIRED";
  name: string;
  company: string;
  title: string;
  function: string;
  seniority: string;
  location: string;
  linkedinUrl?: string;
  programme: string;
  batch: number;
  graduationYear?: number;
  previous: string;
  confidence: number;
  status: string;
  assessment: { iimlRelationship: string };
};

export type DiscoveryProfile = {
  providerResultId: string;
  providerPersonId: string;
  name: string;
  education: string;
  currentCompany: string;
  currentCompanyEvidenceSource?: "ACTIVE_EXPERIENCE" | "GENERIC_SUMMARY" | "COLLECTED_CURRENT_ROLE" | "NONE";
  role: string;
  rawTitle: string;
  function: string;
  seniority: string;
  location: string;
  graduationYear: number;
  linkedinUrl: string;
  matchConfidence: number;
  affiliationStatus: "Confirmed degree alumnus" | "Potential alumnus — review required" | "Short-term / exchange affiliation";
  educationProgramme: string;
  normalizedProgramme: string;
  programmeStatus: ProgrammeStatus;
  alumniStatus: AlumniStatus;
  eligibleForAddition: boolean;
  educationStartDate: string;
  educationEndDate: string;
  institutionId: string;
  institutionUrl: string;
  currentCompanyId: string;
  currentCompanyUrl: string;
  currentRoleStartDate: string;
  currentIndustry: string;
  currentRoleAmbiguous: boolean;
  providerFreshnessAt: string;
  currentRoles?: DiscoveryCurrentRoleEvidence[];
  iimlEducationEvidence?: DiscoveryEducationEvidence[];
};

export type DiscoveryCurrentRoleEvidence = {
  company: string;
  title: string;
  seniority: string;
  startDate: string;
};

export type DiscoveryEducationEvidence = {
  institution: string;
  programme: string;
  normalizedProgramme: string;
  startDate: string;
  endDate: string;
  graduationYear: number;
};

export type MatchStatus = "New" | "Already in database" | "Possible duplicate" | "Needs review";

export function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeFunction(raw: string, title = "") {
  const value = normalized(`${raw} ${title}`);
  if (/human resources|\bhr\b|people|talent|recruit/.test(value)) return "HR";
  if (/finance|financial|account|treasury|bank|invest/.test(value)) return "Finance";
  if (/strategy|corporate development|business development/.test(value)) return "Strategy";
  if (/consult|advisory/.test(value)) return "Consulting";
  if (/product/.test(value)) return "Product";
  if (/operation|supply|procurement|category/.test(value)) return "Operations";
  if (/sales|commercial|revenue/.test(value)) return "Sales";
  if (/marketing|brand|growth/.test(value)) return "Marketing";
  if (/technology|engineering|software|data|digital|information/.test(value)) return "Technology";
  if (/general management|country head|chief|president/.test(value)) return "General Management";
  return clean(raw) || "Other";
}

export function normalizeSeniority(raw: string, title = "") {
  const titleValue = normalized(title);
  // A reporting relationship is not the office held by the person.
  if (isReportingRelationshipTitle(titleValue)) return "Analyst/Junior";
  if (/chief|\bcxo\b|c suite|country head|managing partner|managing director/.test(titleValue)) return "CXO";
  if (/executive vice president|senior vice president|\bevp\b|\bsvp\b/.test(titleValue)) return "EVP/SVP";
  if (/assistant vice president|vice president|\bavp\b|\bvp\b|partner/.test(titleValue)) return "VP";
  if (/\bhead of\b|\bdirector\b/.test(titleValue)) return "Director";
  if (/general manager|\bgm\b/.test(titleValue)) return "GM";
  if (/senior manager|\bsenior\b/.test(titleValue)) return "Senior Manager";
  if (/\bmanager\b/.test(titleValue)) return "Manager";
  if (/associate|consultant/.test(titleValue)) return "Associate/Consultant";
  if (/analyst|junior|executive/.test(titleValue)) return "Analyst/Junior";
  const value = normalized(raw);
  if (/chief|\bcxo\b|c suite|country head|managing partner|managing director/.test(value)) return "CXO";
  if (/executive vice president|senior vice president|\bevp\b|\bsvp\b/.test(value)) return "EVP/SVP";
  if (/assistant vice president|vice president|\bavp\b|\bvp\b|partner/.test(value)) return "VP";
  if (/\bhead of\b|director/.test(value)) return "Director";
  if (/general manager|\bgm\b/.test(value)) return "GM";
  if (/senior manager/.test(value)) return "Senior Manager";
  if (/manager/.test(value)) return "Manager";
  if (/associate|consultant/.test(value)) return "Associate/Consultant";
  if (/analyst|junior|executive/.test(value)) return "Analyst/Junior";
  return clean(raw) || "Unknown/Unclassified";
}

const seniorityRank: Record<string, number> = {
  "Analyst/Junior": 1,
  "Associate/Consultant": 2,
  Manager: 3,
  "Senior Manager": 4,
  GM: 5,
  Director: 6,
  VP: 7,
  "EVP/SVP": 8,
  CXO: 9,
};

export const DISCOVERY_SENIORITY_OPTIONS = [
  "Analyst/Junior",
  "Associate/Consultant",
  "Manager",
  "Senior Manager",
  "GM",
  "Director",
  "Director+",
  "VP",
  "VP+",
  "EVP/SVP",
  "CXO",
] as const;

function discoverySeniorityKey(value: unknown) {
  const text = String(value ?? "").trim();
  return `${normalized(text.replace(/\+$/, ""))}${text.endsWith("+") ? "+" : ""}`;
}

const discoverySeniorityByNormalizedValue = new Map(
  DISCOVERY_SENIORITY_OPTIONS.map(value => [discoverySeniorityKey(value), value]),
);

export function isReportingRelationshipTitle(title: string) {
  return /\b(?:assistant|advisor|chief of staff) to (?:the )?(?:(?:executive|senior) )?(?:vice president|director|chief executive officer|chief financial officer|ceo|cfo|evp|svp)\b/.test(normalized(title));
}

export function normalizeDiscoverySeniorities(values: unknown, legacyValue: unknown = "All levels"): string[] {
  const supplied = Array.isArray(values) && values.length ? values : [legacyValue];
  const selected = new Set<string>();
  for (const raw of supplied) {
    const canonical = discoverySeniorityByNormalizedValue.get(discoverySeniorityKey(raw));
    if (canonical) selected.add(canonical);
  }
  return DISCOVERY_SENIORITY_OPTIONS.filter(value => selected.has(value));
}

export function selectedDiscoverySeniorities(filters: Pick<DiscoveryFilters, "seniorities" | "seniority"> | Partial<Pick<DiscoveryFilters, "seniorities" | "seniority">>) {
  return normalizeDiscoverySeniorities(filters.seniorities, filters.seniority);
}

export function discoverySenioritySummary(filters: Partial<Pick<DiscoveryFilters, "seniorities" | "seniority">>) {
  const selected = selectedDiscoverySeniorities(filters);
  return selected.length ? selected.join(", ") : "All levels";
}

export function matchesSeniority(actual: string, filter: string) {
  if (!filter || filter === "All levels") return true;
  const actualLevel = normalizeSeniority(actual, actual);
  if (filter.endsWith("+")) {
    const threshold = filter.slice(0, -1);
    return (seniorityRank[actualLevel] ?? 0) >= (seniorityRank[threshold] ?? 0);
  }
  return actualLevel === filter;
}

export function matchesDiscoverySeniorities(actual: string, filters: Partial<Pick<DiscoveryFilters, "seniorities" | "seniority">>) {
  const selected = selectedDiscoverySeniorities(filters);
  return !selected.length || selected.some(filter => matchesSeniority(actual, filter));
}

export function normalizeDiscoveryFiltersInput(value: unknown): DiscoveryFilters {
  const defaults = defaultDiscoveryFilters();
  const candidate = value && typeof value === "object"
    ? value as Omit<Partial<DiscoveryFilters>, "seniorities"> & { batch?: string; seniorities?: unknown }
    : {};
  const seniorities = normalizeDiscoverySeniorities(candidate.seniorities, candidate.seniority);
  return {
    ...defaults,
    ...candidate,
    discoveryProgrammes: Array.isArray(candidate.discoveryProgrammes)
      ? normalizeDiscoveryProgrammeSelections(candidate.discoveryProgrammes)
      : defaults.discoveryProgrammes,
    alumniStatus: candidate.alumniStatus === "All graduation statuses" ? candidate.alumniStatus : defaults.alumniStatus,
    company: candidate.company === "All companies" ? "" : String(candidate.company ?? defaults.company).trim(),
    companySelectionKey: String(candidate.companySelectionKey ?? defaults.companySelectionKey).trim(),
    role: String(candidate.role ?? defaults.role).trim(),
    function: String(candidate.function ?? defaults.function).trim() || defaults.function,
    seniorities,
    seniority: seniorities.length === 1 ? seniorities[0] : defaults.seniority,
    location: String(candidate.location ?? defaults.location).trim(),
    graduationYear: String(candidate.graduationYear ?? candidate.batch ?? defaults.graduationYear).trim(),
  };
}

export function matchesInternalFilters(
  person: SearchableAlumnus,
  filters: DirectoryFilters,
  relevance: number,
  contactStatus: string,
) {
  const exactOrAll = (actual: string, expected: string, allLabel: string) => expected === allLabel || normalized(actual) === normalized(expected);
  const contains = (actual: string, expected: string) => !expected || normalized(actual).includes(normalized(expected));
  const graduationYear = person.graduationYear || person.batch || 0;
  const graduationYearMode = filters.graduationYearMode ?? "exact";
  const selectedYears = String(filters.graduationYears ?? "").split(",").map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0);
  const matchesGraduationYear = !filters.batch && !filters.graduationYearStart && !filters.graduationYearEnd && !selectedYears.length
    ? true
    : graduationYearMode === "onOrBefore"
      ? graduationYear > 0 && graduationYear <= Number(filters.batch)
      : graduationYearMode === "range"
        ? graduationYear > 0 && graduationYear >= Number(filters.graduationYearStart) && graduationYear <= Number(filters.graduationYearEnd)
        : graduationYearMode === "multiple"
          ? selectedYears.includes(graduationYear)
          : graduationYear > 0 && graduationYear === Number(filters.batch);
  const selectedSeniorities = filters.seniorities?.length ? filters.seniorities : filters.seniority !== "All levels" ? [filters.seniority] : [];
  const matchesSelectedSeniority = !selectedSeniorities.length || (filters.seniorityMode === "minimum"
    ? matchesSeniority(person.seniority, `${selectedSeniorities[0].replace(/\+$/, "")}+`)
    : selectedSeniorities.some(level => matchesSeniority(person.seniority, level)));
  return contains(person.name, filters.name)
    && (filters.company === MISSING_COMPANY_FILTER ? missingProfessionalValue(person.company) : exactOrAll(person.company, filters.company, "All companies"))
    && contains(person.title, filters.role)
    && exactOrAll(normalizeFunction(person.function, person.title), filters.function, "All functions")
    && matchesSelectedSeniority
    && contains(person.location, filters.location)
    && matchesLinkedinProfileFilter(person.linkedinUrl, filters.linkedinUrl)
    && (filters.programmes.length ? filters.programmes.some(value => normalized(person.programme) === normalized(value)) : exactOrAll(person.programme, filters.programme, "All programmes"))
    && matchesGraduationYear
    && contains(person.previous, filters.previousCompany)
    && relevance >= filters.minRelevance
    && relevance <= filters.maxRelevance
    && person.confidence >= filters.minConfidence
    && exactOrAll(contactStatus, filters.contactStatus, "All contact states")
    && exactOrAll(person.status, filters.outreachStatus, "All outreach states")
    && exactOrAll(person.assessment.iimlRelationship, filters.relationship, "All relationships");
}

const functionTerms: Record<string, string[]> = {
  HR: ["human resources", "people", "talent", "recruiting"],
  Finance: ["finance", "financial", "treasury"],
  Strategy: ["strategy", "corporate development"],
  Consulting: ["consulting", "advisory"],
  Product: ["product"],
  Operations: ["operations", "supply chain", "category"],
  Sales: ["sales", "commercial"],
  Marketing: ["marketing", "brand", "growth"],
  Technology: ["technology", "engineering", "software", "data"],
  "General Management": ["country head", "general management", "chief"],
};

const seniorityTerms: Record<string, string[]> = {
  CXO: ["chief", "country head", "managing partner", "managing director"],
  "EVP/SVP": ["executive vice president", "senior vice president", "evp", "svp"],
  VP: ["vice president", "partner"],
  Director: ["director"],
  GM: ["general manager"],
  "Senior Manager": ["senior manager"],
  Manager: ["manager"],
  "Associate/Consultant": ["associate", "consultant"],
  "Analyst/Junior": ["analyst", "junior", "executive"],
};

function phrase(field: string, value: string) {
  return { match_phrase: { [field]: normalized(value) } };
}

export function buildPdlQuery(filters: DirectoryFilters, canonicalSchoolId = "") {
  const must: Record<string, unknown>[] = [canonicalSchoolId
    ? { term: { "education.school.id": canonicalSchoolId } }
    : phrase("education.school.name", FIXED_ALUMNI_SCHOOL)];
  if (filters.name) must.push(phrase("full_name", filters.name));
  if (filters.company !== "All companies") must.push(phrase("job_company_name", filters.company));
  if (filters.role) must.push({ match: { job_title: normalized(filters.role) } });
  if (filters.location) must.push({ match: { location_name: normalized(filters.location) } });
  if (filters.batch) must.push({ match_phrase: { "education.end_date": String(filters.batch) } });
  if (filters.previousCompany) must.push(phrase("experience.company.name", filters.previousCompany));
  if (filters.function !== "All functions") {
    const terms = functionTerms[filters.function] ?? [filters.function];
    must.push({ bool: { minimum_should_match: 1, should: terms.map(term => phrase("job_title", term)) } });
  }
  if (filters.seniority !== "All levels") {
    const base = filters.seniority.endsWith("+") ? filters.seniority.slice(0, -1) : filters.seniority;
    const threshold = seniorityRank[base] ?? 0;
    const levels = filters.seniority.endsWith("+")
      ? Object.keys(seniorityRank).filter(level => seniorityRank[level] >= threshold)
      : [base];
    const terms = levels.flatMap(level => seniorityTerms[level] ?? [level]);
    must.push({ bool: { minimum_should_match: 1, should: terms.map(term => phrase("job_title", term)) } });
  }
  return { query: { bool: { must } } };
}

export function criteriaSummary(filters: DiscoveryFilters) {
  const parts = [`Education: ${FIXED_ALUMNI_SCHOOL}`];
  parts.push(`Alumni status: ${filters.alumniStatus}`);
  if (filters.discoveryProgrammes.length) parts.push(`Programmes: ${filters.discoveryProgrammes.join(", ")}`);
  if (filters.company) parts.push(`Company: ${filters.company}`);
  if (filters.role) parts.push(`Role: ${filters.role}`);
  if (filters.function !== "All functions") parts.push(`Function: ${filters.function}`);
  const seniorities = selectedDiscoverySeniorities(filters);
  if (seniorities.length) parts.push(`Seniority: ${seniorities.join(", ")}`);
  if (filters.location) parts.push(`Location: ${filters.location}`);
  if (filters.graduationYear) parts.push(`Graduation year: ${filters.graduationYear}`);
  return parts.join(" · ");
}

function queryGroup(values: string[]) {
  return values.map(value => `(${value})`).join(" OR ");
}

export function discoveryExperienceTitleQuery(filters: Pick<DiscoveryFilters, "role" | "function">) {
  const clauses: string[] = [];
  if (filters.role.trim()) clauses.push(`(${filters.role.trim()})`);
  if (filters.function !== "All functions") clauses.push(`(${queryGroup(functionTerms[filters.function] ?? [filters.function])})`);
  return clauses.join(" AND ");
}

function findIimlEducation(education: unknown, canonicalSchoolId = "") {
  if (!Array.isArray(education)) return undefined;
  return education.find(item => {
    if (!item || typeof item !== "object") return false;
    const school = (item as Record<string, unknown>).school as Record<string, unknown> | undefined;
    return (canonicalSchoolId && clean(school?.id) === canonicalSchoolId)
      || normalized(school?.name ?? school?.raw).includes("indian institute of management lucknow");
  }) as Record<string, unknown> | undefined;
}

export function findEducationYear(education: unknown, canonicalSchoolId = "") {
  const iiml = findIimlEducation(education, canonicalSchoolId);
  if (!iiml || typeof iiml !== "object") return 0;
  const year = clean(iiml?.end_date).match(/\d{4}/)?.[0];
  return year ? Number(year) : 0;
}

export function toDiscoveryProfile(record: Record<string, unknown>, index: number, canonicalSchoolId = ""): DiscoveryProfile {
  const rawTitle = clean(record.job_title ?? (record.job as Record<string, unknown> | undefined)?.title);
  const company = clean(record.job_company_name ?? (record.job as Record<string, unknown> | undefined)?.company_name);
  const iimlEducation = findIimlEducation(record.education, canonicalSchoolId);
  const school = iimlEducation && typeof iimlEducation === "object"
    ? iimlEducation.school as Record<string, unknown> | undefined
    : undefined;
  const education = clean(school?.name ?? school?.raw) || "Education not returned";
  const functionValue = normalizeFunction(clean(record.job_title_role ?? record.job_title_sub_role), rawTitle);
  const seniorityValue = normalizeSeniority(clean(record.job_title_levels), rawTitle);
  const completeness = [record.id, record.full_name, education !== "Education not returned", company, rawTitle, record.linkedin_url].filter(Boolean).length;
  return {
    providerResultId: clean(record.id) || `legacy-provider-${index + 1}`,
    providerPersonId: clean(record.id),
    name: clean(record.full_name ?? record.name) || "Name unavailable",
    education,
    currentCompany: company || "Company unavailable",
    role: rawTitle || "Role unavailable",
    rawTitle,
    function: functionValue,
    seniority: seniorityValue,
    location: clean(record.location_name ?? record.location) || "Location unavailable",
    graduationYear: findEducationYear(record.education, canonicalSchoolId),
    linkedinUrl: normalizeProfessionalProfileUrl(record.linkedin_url),
    matchConfidence: Math.min(95, 65 + completeness * 5),
    affiliationStatus: "Potential alumnus — review required",
    educationProgramme: "",
    normalizedProgramme: "",
    programmeStatus: "Programme requires review",
    alumniStatus: "Graduation status unknown — review required",
    eligibleForAddition: false,
    educationStartDate: "",
    educationEndDate: "",
    institutionId: clean(school?.id),
    institutionUrl: "",
    currentCompanyId: "",
    currentCompanyUrl: "",
    currentRoleStartDate: "",
    currentIndustry: "",
    currentRoleAmbiguous: false,
    providerFreshnessAt: "",
  };
}

export function defaultDirectoryFilters(): DirectoryFilters {
  return {
    profileStatus: "All profiles",
    excludeProvisional: false,
    search: "",
    name: "",
    company: "All companies",
    companyPriority: "All priorities",
    role: "",
    function: "All functions",
    seniority: "All levels",
    location: "",
    linkedinUrl: "",
    programme: "All programmes",
    programmes: [],
    alumniIds: [],
    batch: "",
    graduationYearMode: "exact",
    graduationYearStart: "",
    graduationYearEnd: "",
    graduationYears: "",
    seniorityMode: "selected",
    seniorities: [],
    previousCompany: "",
    minRelevance: 0,
    maxRelevance: 100,
    minConfidence: 0,
    contactStatus: "All contact states",
    outreachStatus: "All outreach states",
    relationship: "All relationships",
  };
}

export function defaultDiscoveryFilters(): DiscoveryFilters {
  return {
    alumniStatus: "Past alumni only",
    discoveryProgrammes: [...DEFAULT_DISCOVERY_PROGRAMMES],
    company: "",
    companySelectionKey: "",
    role: "",
    function: "All functions",
    seniorities: [],
    seniority: "All levels",
    location: "",
    graduationYear: "",
  };
}
