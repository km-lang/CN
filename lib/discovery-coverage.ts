import { FIXED_ALUMNI_SCHOOL, defaultDiscoveryFilters, normalized, type DiscoveryFilters } from "@/lib/alumni-search"

export type DiscoveryCoverageState = "NEVER_SEARCHED" | "RECENTLY_SEARCHED" | "STALE_SEARCH"
export type DiscoveryCoverageOverallState = DiscoveryCoverageState | "PARTIALLY_COVERED"

export type DiscoverySearchHistory = {
  id: number
  provider: string
  mode: string
  filtersJson: string
  createdAt: string
}

export type DiscoveryCoveragePolicy = {
  recentSearchWindowDays: number
}

export const DEFAULT_DISCOVERY_COVERAGE_POLICY: DiscoveryCoveragePolicy = Object.freeze({
  recentSearchWindowDays: 30,
})

export type DiscoveryCoverageSegment = {
  graduationYear: number | null
  state: DiscoveryCoverageState
  lastSearchId: number | null
  lastSearchedAt: string | null
  daysSinceLastSearch: number | null
  provider: string | null
  mode: string | null
}

function normalizedValue(value: unknown) {
  return normalized(value)
}

export function normalizeDiscoveryCoverageFilters(value: Partial<DiscoveryFilters> = {}) {
  const defaults = defaultDiscoveryFilters()
  const programmes = Array.isArray(value.discoveryProgrammes)
    ? [...new Set(value.discoveryProgrammes.map(item => normalizedValue(item)).filter(Boolean))].sort()
    : [...defaults.discoveryProgrammes].map(normalizedValue).sort()
  const rawYear = String(value.graduationYear ?? defaults.graduationYear).trim()
  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null
  return {
    institution: normalizedValue(FIXED_ALUMNI_SCHOOL),
    alumniStatus: normalizedValue(value.alumniStatus ?? defaults.alumniStatus),
    discoveryProgrammes: programmes,
    company: normalizedValue(value.company === "All companies" ? "" : value.company ?? defaults.company),
    role: normalizedValue(value.role ?? defaults.role),
    function: normalizedValue(value.function ?? defaults.function),
    seniority: normalizedValue(value.seniority ?? defaults.seniority),
    location: normalizedValue(value.location ?? defaults.location),
    graduationYear: year,
  }
}

function parseStoredFilters(filtersJson: string) {
  try {
    const value = JSON.parse(filtersJson) as Partial<DiscoveryFilters>
    return normalizeDiscoveryCoverageFilters(value)
  } catch {
    return null
  }
}

function sameBaseFilters(left: ReturnType<typeof normalizeDiscoveryCoverageFilters>, right: ReturnType<typeof normalizeDiscoveryCoverageFilters>) {
  return left.institution === right.institution
    && left.alumniStatus === right.alumniStatus
    && left.company === right.company
    && left.role === right.role
    && left.function === right.function
    && left.seniority === right.seniority
    && left.location === right.location
    && left.discoveryProgrammes.join("|") === right.discoveryProgrammes.join("|")
}

function ageInDays(createdAt: string, now: Date) {
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000))
}

export function discoveryCoveragePlan(
  requestedFilters: Partial<DiscoveryFilters>,
  history: readonly DiscoverySearchHistory[],
  options: {
    now?: Date
    provider?: string
    mode?: string
    graduationYears?: readonly number[]
    policy?: DiscoveryCoveragePolicy
  } = {},
) {
  const now = options.now ?? new Date()
  const provider = normalizedValue(options.provider ?? "coresignal")
  const mode = normalizedValue(options.mode ?? "live")
  const policy = options.policy ?? DEFAULT_DISCOVERY_COVERAGE_POLICY
  const normalizedFilters = normalizeDiscoveryCoverageFilters(requestedFilters)
  const years = options.graduationYears?.length
    ? [...new Set(options.graduationYears.filter(year => Number.isInteger(year) && year >= 1900 && year <= 2200))].sort()
    : [normalizedFilters.graduationYear]

  const normalizedHistory = history.flatMap(search => {
    const filters = parseStoredFilters(search.filtersJson)
    return filters ? [{ search, filters }] : []
  })

  const segments: DiscoveryCoverageSegment[] = years.map(graduationYear => {
    const matches = normalizedHistory
      .filter(item => normalizedValue(item.search.provider) === provider
        && normalizedValue(item.search.mode) === mode
        && sameBaseFilters(normalizedFilters, item.filters)
        && item.filters.graduationYear === graduationYear)
      .map(item => ({ ...item, age: ageInDays(item.search.createdAt, now) }))
      .filter(item => item.age !== null)
      .sort((left, right) => Date.parse(right.search.createdAt) - Date.parse(left.search.createdAt))
    const latest = matches[0]
    if (!latest) return { graduationYear, state: "NEVER_SEARCHED", lastSearchId: null, lastSearchedAt: null, daysSinceLastSearch: null, provider: null, mode: null }
    return {
      graduationYear,
      state: latest.age! <= policy.recentSearchWindowDays ? "RECENTLY_SEARCHED" : "STALE_SEARCH",
      lastSearchId: latest.search.id,
      lastSearchedAt: latest.search.createdAt,
      daysSinceLastSearch: latest.age,
      provider: latest.search.provider,
      mode: latest.search.mode,
    }
  })

  const counts = {
    requested: segments.length,
    recentlySearched: segments.filter(segment => segment.state === "RECENTLY_SEARCHED").length,
    stale: segments.filter(segment => segment.state === "STALE_SEARCH").length,
    neverSearched: segments.filter(segment => segment.state === "NEVER_SEARCHED").length,
  }
  const distinctStates = new Set(segments.map(segment => segment.state))
  const overallState: DiscoveryCoverageOverallState = distinctStates.size > 1 ? "PARTIALLY_COVERED" : segments[0]?.state ?? "NEVER_SEARCHED"
  return {
    overallState,
    normalizedFilters,
    policy: { ...policy, advisoryOnly: true },
    segments,
    counts,
    searchSegmentsRequiringProviderQuery: counts.stale + counts.neverSearched,
    lastEquivalentSearch: segments.length === 1 ? segments[0] : null,
  }
}
