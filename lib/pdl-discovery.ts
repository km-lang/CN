import {
  FIXED_ALUMNI_SCHOOL,
  buildPdlQuery,
  clean,
  normalizeFunction,
  normalizeSeniority,
  normalized,
  toDiscoveryProfile,
  type DirectoryFilters,
  type DiscoveryProfile,
} from "@/lib/alumni-search";

type InternalPerson = {
  id: number;
  name: string;
  batch: number;
  company: string;
  title: string;
  function: string;
  seniority: string;
  location: string;
};

export type DiscoveryResponse = {
  profiles: DiscoveryProfile[];
  creditsUsed: number;
  totalAvailable: number;
  responseSummary: string;
};

type RuntimeEnv = { PDL_API_KEY?: string; ENRICHMENT_MODE?: string };

function mode() {
  return (process.env as RuntimeEnv).ENRICHMENT_MODE?.toLowerCase() === "live" ? "live" : "mock";
}

function titleFor(filters: DirectoryFilters, index: number) {
  if (filters.role) return filters.role;
  if (filters.function === "HR") return ["Director, Talent Acquisition", "Vice President, People", "Senior Manager, HR"][index % 3];
  if (filters.function === "Product") return ["Director of Product", "Group Product Manager", "Vice President, Product"][index % 3];
  if (filters.function === "Finance") return ["Finance Director", "Vice President, Finance", "Senior Finance Manager"][index % 3];
  return ["Director, Strategy", "Vice President, Operations", "Senior Manager, Business Development"][index % 3];
}

function mockProfile(
  id: string,
  name: string,
  filters: DirectoryFilters,
  index: number,
  overrides: Partial<DiscoveryProfile> = {},
): DiscoveryProfile {
  const rawTitle = titleFor(filters, index);
  const location = filters.location || ["Bengaluru, India", "Gurugram, India", "Mumbai, India"][index % 3];
  return {
    providerResultId: id,
    providerPersonId: id,
    name,
    education: FIXED_ALUMNI_SCHOOL,
    currentCompany: filters.company === "All companies" ? ["Microsoft", "Google", "Amazon"][index % 3] : filters.company,
    role: rawTitle,
    rawTitle,
    function: filters.function === "All functions" ? normalizeFunction("", rawTitle) : filters.function,
    seniority: filters.seniority === "All levels" ? normalizeSeniority("", rawTitle) : filters.seniority.replace(/\+$/, ""),
    location,
    graduationYear: filters.batch ? Number(filters.batch) : 2010 + index,
    linkedinUrl: "https://www.linkedin.com/",
    matchConfidence: 88 + (index % 9),
    ...overrides,
  };
}

function mockSearch(filters: DirectoryFilters, internal: InternalPerson[], limit: number): DiscoveryResponse {
  if (/no results|nonexistent/i.test(filters.role)) {
    return { profiles: [], creditsUsed: 0, totalAvailable: 0, responseSummary: "No additional external alumni were found in the demonstration provider." };
  }
  if (filters.name) {
    const person = internal.find(item => normalized(item.name) === normalized(filters.name));
    if (person) {
      const changed = person.id % 2 === 0;
      const refreshedTitle = changed && !/director/i.test(person.title)
        ? `Director, ${person.title.replace(/^Senior\s+/i, "")}`
        : person.title;
      const profile = mockProfile(`mapped-${person.id}`, person.name, filters, 0, {
        graduationYear: person.batch,
        linkedinUrl: "",
        matchConfidence: 98,
        currentCompany: changed ? filters.company === "All companies" ? person.company : filters.company : person.company,
        role: refreshedTitle,
        rawTitle: refreshedTitle,
        function: person.function,
        seniority: changed ? normalizeSeniority("", refreshedTitle) : person.seniority,
        location: person.location,
      });
      return { profiles: [profile], creditsUsed: 1, totalAvailable: 1, responseSummary: "1 demonstration PDL profile returned for comparison." };
    }
  }
  const mapped = [...internal].slice(0, 3).map((person, index) => mockProfile(
    `mapped-${person.id}`,
    person.name,
    filters,
    index,
    {
      graduationYear: person.batch,
      linkedinUrl: "",
      matchConfidence: 96,
      role: index === 0 ? titleFor(filters, index) : person.title,
      rawTitle: index === 0 ? titleFor(filters, index) : person.title,
    },
  ));
  const newPeople = ["Isha Malhotra", "Devansh Kulkarni"].map((name, index) => mockProfile(`new-${index + 1}`, name, filters, index + 5));
  const possible = internal.slice(5, 6).map((person, index) => mockProfile(
    `possible-${person.id}`,
    person.name,
    filters,
    index + 8,
    { graduationYear: person.batch + 1, linkedinUrl: "", matchConfidence: 71 },
  ));
  const needsReview = mockProfile("needs-review-1", "Samir Khanna", filters, 9, { education: "Education not confirmed", matchConfidence: 52 });
  const profiles = [...mapped, ...newPeople, ...possible, needsReview].slice(0, limit);
  return {
    profiles,
    creditsUsed: profiles.length,
    totalAvailable: profiles.length,
    responseSummary: `${profiles.length} demonstration PDL profiles returned for review.`,
  };
}

export async function searchExternalAlumni(
  filters: DirectoryFilters,
  internal: InternalPerson[],
  limit: number,
): Promise<DiscoveryResponse> {
  if (mode() === "mock") return mockSearch(filters, internal, limit);
  const key = (process.env as RuntimeEnv).PDL_API_KEY;
  if (!key) throw new Error("PDL is not configured for live discovery.");
  const url = new URL("https://api.peopledatalabs.com/v5/person/search");
  url.searchParams.set("query", JSON.stringify(buildPdlQuery(filters).query));
  url.searchParams.set("size", String(limit));
  url.searchParams.set("titlecase", "true");
  url.searchParams.set("data_include", [
    "id", "full_name", "education", "job_company_name", "job_title", "job_title_role",
    "job_title_sub_role", "job_title_levels", "location_name", "linkedin_url",
  ].join(","));
  const response = await fetch(url.toString(), { headers: { "X-Api-Key": key, accept: "application/json" } });
  const body = await response.json() as Record<string, unknown>;
  if (response.status === 404) return { profiles: [], creditsUsed: 0, totalAvailable: 0, responseSummary: "No additional external alumni were found." };
  if (!response.ok) {
    const providerMessage = clean((body.error as Record<string, unknown> | undefined)?.message ?? body.message);
    throw new Error(providerMessage || "PDL discovery is temporarily unavailable.");
  }
  const data = Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
  const creditsUsed = Number(response.headers.get("x-call-credits-spent") ?? data.length);
  return {
    profiles: data.map(toDiscoveryProfile),
    creditsUsed,
    totalAvailable: Number(body.total ?? data.length),
    responseSummary: `${data.length} PDL profiles returned for review.`,
  };
}

export function discoveryMode() {
  return mode();
}
