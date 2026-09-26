import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile";

export const FIXED_ALUMNI_SCHOOL = "Indian Institute of Management Lucknow";

export type DirectoryFilters = {
  name: string;
  company: string;
  role: string;
  function: string;
  seniority: string;
  location: string;
  programme: string;
  batch: string;
  previousCompany: string;
  minRelevance: number;
  minConfidence: number;
  contactStatus: string;
  outreachStatus: string;
  relationship: string;
};

export type SearchableAlumnus = {
  name: string;
  company: string;
  title: string;
  function: string;
  seniority: string;
  location: string;
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
  const value = normalized(`${raw} ${title}`);
  if (/chief|\bcxo\b|c suite|country head|managing partner|managing director/.test(value)) return "CXO";
  if (/executive vice president|senior vice president|\bevp\b|\bsvp\b/.test(value)) return "EVP/SVP";
  if (/vice president|\bvp\b|partner/.test(value)) return "VP";
  if (/director/.test(value)) return "Director";
  if (/general manager|\bgm\b/.test(value)) return "GM";
  if (/senior manager/.test(value)) return "Senior Manager";
  if (/manager/.test(value)) return "Manager";
  if (/associate|consultant/.test(value)) return "Associate/Consultant";
  if (/analyst|junior|executive/.test(value)) return "Analyst/Junior";
  return clean(raw) || "Analyst/Junior";
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

export function matchesSeniority(actual: string, filter: string) {
  if (!filter || filter === "All levels") return true;
  const actualLevel = normalizeSeniority(actual, actual);
  if (filter.endsWith("+")) {
    const threshold = filter.slice(0, -1);
    return (seniorityRank[actualLevel] ?? 0) >= (seniorityRank[threshold] ?? 0);
  }
  return actualLevel === filter;
}

export function matchesInternalFilters(
  person: SearchableAlumnus,
  filters: DirectoryFilters,
  relevance: number,
  contactStatus: string,
) {
  const exactOrAll = (actual: string, expected: string, allLabel: string) => expected === allLabel || normalized(actual) === normalized(expected);
  const contains = (actual: string, expected: string) => !expected || normalized(actual).includes(normalized(expected));
  return contains(person.name, filters.name)
    && exactOrAll(person.company, filters.company, "All companies")
    && contains(person.title, filters.role)
    && exactOrAll(normalizeFunction(person.function, person.title), filters.function, "All functions")
    && matchesSeniority(person.seniority, filters.seniority)
    && contains(person.location, filters.location)
    && exactOrAll(person.programme, filters.programme, "All programmes")
    && (!filters.batch || (person.batch || person.graduationYear) === Number(filters.batch))
    && contains(person.previous, filters.previousCompany)
    && relevance >= filters.minRelevance
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

export function criteriaSummary(filters: DirectoryFilters) {
  const parts = [`Education: ${FIXED_ALUMNI_SCHOOL}`];
  if (filters.company !== "All companies") parts.push(`Company: ${filters.company}`);
  if (filters.role) parts.push(`Role: ${filters.role}`);
  if (filters.function !== "All functions") parts.push(`Function: ${filters.function}`);
  if (filters.seniority !== "All levels") parts.push(`Seniority: ${filters.seniority}`);
  if (filters.location) parts.push(`Location: ${filters.location}`);
  if (filters.batch) parts.push(`Graduation year: ${filters.batch}`);
  return parts.join(" · ");
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
    name: "",
    company: "All companies",
    role: "",
    function: "All functions",
    seniority: "All levels",
    location: "",
    programme: "All programmes",
    batch: "",
    previousCompany: "",
    minRelevance: 0,
    minConfidence: 0,
    contactStatus: "All contact states",
    outreachStatus: "All outreach states",
    relationship: "All relationships",
  };
}
