export type DiscoveryRunSearch = {
  id: number
  provider: string
  mode: string
  initiatedBy: string
  createdAt: string
  filtersJson: string
  criteriaSummary: string
  requestedCount: number
  resultCount: number
  existingCount: number
  newCount: number
  duplicateCount: number
  creditsUsed: number
}

export type DiscoveryRunResult = {
  searchId: number
  provider: string
  matchStatus: string
  reviewStatus: string
  reviewNote?: string | null
}

export type DiscoveryRunHistory = {
  id: number
  applicationUnits: number
  providerReportedCredits: number | null
}

export function discoveryClassificationCounts(results: readonly DiscoveryRunResult[]) {
  return {
    existing: results.filter(result => result.matchStatus === "Already in database").length,
    new: results.filter(result => result.matchStatus === "New").length,
    possibleDuplicate: results.filter(result => result.matchStatus === "Possible duplicate").length,
    needsReview: results.filter(result => result.matchStatus === "Needs review").length,
  }
}

export function recordedRequestedCount(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null
}

export function resultProviderIntegrity(searchProvider: string, resultProvider: string) {
  return searchProvider.trim().toLowerCase() === resultProvider.trim().toLowerCase()
    ? "consistent" as const
    : "provider_mismatch" as const
}

export function isActionableDiscoveryReview(result: DiscoveryRunResult) {
  return result.reviewStatus === "Pending review"
    && !String(result.reviewNote ?? "").startsWith("SKIPPED_FILTER_MISMATCH:")
}

export function discoveryRunSummary(
  search: DiscoveryRunSearch,
  results: readonly DiscoveryRunResult[],
  history: readonly DiscoveryRunHistory[] = [],
) {
  const scopedResults = results.filter(result => result.searchId === search.id)
  const scopedHistory = history
  return {
    searchId: search.id,
    provider: search.provider,
    mode: search.mode,
    initiatedBy: search.initiatedBy,
    createdAt: search.createdAt,
    criteriaSummary: search.criteriaSummary,
    requestedCount: recordedRequestedCount(search.requestedCount),
    providerResultCount: search.resultCount,
    storedResultCount: scopedResults.length,
    pendingCount: scopedResults.filter(isActionableDiscoveryReview).length,
    counts: discoveryClassificationCounts(scopedResults),
    creditsUsed: search.creditsUsed,
    applicationUnits: scopedHistory.length
      ? scopedHistory.reduce((total, item) => total + Math.max(0, Number(item.applicationUnits) || 0), 0)
      : null,
    providerReportedCredits: scopedHistory.some(item => item.providerReportedCredits !== null)
      ? scopedHistory.reduce((total, item) => total + Math.max(0, Number(item.providerReportedCredits) || 0), 0)
      : null,
  }
}

export function selectActiveDiscoveryRun(
  searches: readonly DiscoveryRunSearch[],
  results: readonly DiscoveryRunResult[],
  requestedSearchId?: number | null,
) {
  const sorted = [...searches].sort((left, right) => right.id - left.id)
  if (requestedSearchId != null) return sorted.find(search => search.id === requestedSearchId) ?? null
  const pendingSearchIds = new Set(results.filter(isActionableDiscoveryReview).map(result => result.searchId))
  return sorted.find(search => pendingSearchIds.has(search.id)) ?? sorted[0] ?? null
}

export function previousDiscoveryRuns(
  searches: readonly DiscoveryRunSearch[],
  results: readonly DiscoveryRunResult[],
  activeSearchId: number | null,
) {
  return [...searches]
    .filter(search => search.id !== activeSearchId)
    .sort((left, right) => right.id - left.id)
    .map(search => discoveryRunSummary(search, results))
}
