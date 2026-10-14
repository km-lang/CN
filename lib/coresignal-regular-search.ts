import type { DiscoveryFilters } from "@/lib/alumni-search"
import {
  CoresignalProviderError,
  coresignalEmployeeEsDslSearchContract,
  searchCoresignalEmployeeIds,
  type CoresignalRegularSearchTransportResult,
} from "@/lib/coresignal-client"
import type { CoresignalSearchIdLookupStore } from "@/lib/coresignal-search-id-dedupe"
import { planCoresignalRegularSearchRouting } from "@/lib/coresignal-search-routing"
import { coresignalRegularSearchEnabled } from "@/lib/provider-runtime"

export const CORESIGNAL_REGULAR_SEARCH_MAX_REQUESTS = 1

export type CoresignalRegularSearchExecution = {
  operation: "Base Employee ES-DSL Search"
  operationContext: string
  requestAttempts: 1
  previewRequests: 0
  collectRequests: 0
  automaticPagination: false
  searchMode: "INSTITUTION_ONLY" | "EXACT_GRADUATION_YEAR"
  providerCreditsRemaining: number | null
  routing: Awaited<ReturnType<typeof planCoresignalRegularSearchRouting>>
}

type Transport = (
  esDslBody: unknown,
  options: { itemsPerPage: number; operationContext: string; signal?: AbortSignal },
) => Promise<CoresignalRegularSearchTransportResult>

export async function executeCoresignalRegularSearch(
  input: {
    filters: DiscoveryFilters
    itemsPerPage: number
    operationContext: string
    confirmed: boolean
    signal?: AbortSignal
  },
  dependencies: {
    store: CoresignalSearchIdLookupStore
    transport?: Transport
    searchEnabled?: () => boolean
  },
): Promise<CoresignalRegularSearchExecution> {
  if (!input.confirmed) throw new CoresignalProviderError("Explicit confirmation is required before Coresignal Search.", "invalid_request", 400)
  if (!(dependencies.searchEnabled ?? coresignalRegularSearchEnabled)()) {
    throw new CoresignalProviderError("Coresignal regular Search is disabled.", "invalid_request", 403)
  }
  const transport = dependencies.transport ?? searchCoresignalEmployeeIds
  const contract = coresignalEmployeeEsDslSearchContract({
    graduationYear: input.filters.graduationYear || undefined,
    itemsPerPage: input.itemsPerPage,
  })
  const response = await transport(contract.body, {
    itemsPerPage: input.itemsPerPage,
    operationContext: input.operationContext,
    signal: input.signal,
  })
  const routing = await planCoresignalRegularSearchRouting(response.body, response.headers, dependencies.store)
  return {
    operation: "Base Employee ES-DSL Search",
    operationContext: input.operationContext,
    requestAttempts: 1,
    previewRequests: 0,
    collectRequests: 0,
    automaticPagination: false,
    searchMode: contract.searchMode,
    providerCreditsRemaining: response.providerCreditsRemaining,
    routing,
  }
}
