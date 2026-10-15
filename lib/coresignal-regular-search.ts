import type { DiscoveryFilters } from "@/lib/alumni-search"
import {
  CoresignalProviderError,
  coresignalEmployeeEsDslSearchContract,
  coresignalVerifiedCompanyEsDslSearchContract,
  searchCoresignalEmployeeIds,
  type CoresignalRegularSearchTransportResult,
} from "@/lib/coresignal-client"
import { resolveProviderCompanyMapping, type ProviderCompanyMappingStore, type ProviderCompanyResolution } from "@/lib/provider-company-mapping"
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
  searchMode: "INSTITUTION_ONLY" | "EXACT_GRADUATION_YEAR" | "CURRENT_COMPANY" | "CURRENT_COMPANY_EXACT_GRADUATION_YEAR"
  companyMapping: Pick<ProviderCompanyResolution, "state" | "displayName" | "normalizedCompanyKey" | "providerCompanyId">
  providerCreditsRemaining: number | null
  upstreamHttpStatus: number
  routing: Awaited<ReturnType<typeof planCoresignalRegularSearchRouting>>
}

type Transport = (
  esDslBody: unknown,
  options: { itemsPerPage: number; operationContext: string; signal?: AbortSignal },
) => Promise<CoresignalRegularSearchTransportResult>

export async function prepareCoresignalRegularSearch(
  input: { filters: DiscoveryFilters; itemsPerPage: number },
  dependencies: { companyMappingStore?: ProviderCompanyMappingStore },
) {
  const companyName = input.filters.company.trim()
  if (!companyName) {
    const contract = coresignalEmployeeEsDslSearchContract({
      graduationYear: input.filters.graduationYear || undefined,
      itemsPerPage: input.itemsPerPage,
    })
    return {
      contract,
      companyMapping: { state: "MISSING" as const, displayName: "", normalizedCompanyKey: "", providerCompanyId: null },
      companyMappingRequired: false,
    }
  }
  if (!dependencies.companyMappingStore) {
    throw new CoresignalProviderError("Company Search is blocked because provider-company mapping resolution is unavailable.", "invalid_request", 409)
  }
  const companyMapping = await resolveProviderCompanyMapping(companyName, "Coresignal", dependencies.companyMappingStore)
  if (companyMapping.state !== "VERIFIED" || companyMapping.providerCompanyId === null) {
    throw new CoresignalProviderError(`Company Search blocked: ${companyMapping.reason}`, "invalid_request", 409)
  }
  const contract = coresignalVerifiedCompanyEsDslSearchContract({
    companyId: companyMapping.providerCompanyId,
    graduationYear: input.filters.graduationYear || undefined,
    itemsPerPage: input.itemsPerPage,
  })
  return {
    contract,
    companyMapping: {
      state: companyMapping.state,
      displayName: companyMapping.displayName,
      normalizedCompanyKey: companyMapping.normalizedCompanyKey,
      providerCompanyId: companyMapping.providerCompanyId,
    },
    companyMappingRequired: true,
  }
}

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
    companyMappingStore?: ProviderCompanyMappingStore
    transport?: Transport
    searchEnabled?: () => boolean
  },
): Promise<CoresignalRegularSearchExecution> {
  if (!input.confirmed) throw new CoresignalProviderError("Explicit confirmation is required before Coresignal Search.", "invalid_request", 400)
  const prepared = await prepareCoresignalRegularSearch(
    { filters: input.filters, itemsPerPage: input.itemsPerPage },
    { companyMappingStore: dependencies.companyMappingStore },
  )
  if (!(dependencies.searchEnabled ?? coresignalRegularSearchEnabled)()) {
    throw new CoresignalProviderError("Coresignal regular Search is disabled.", "invalid_request", 403)
  }
  const transport = dependencies.transport ?? searchCoresignalEmployeeIds
  const contract = prepared.contract
  const response = await transport(contract.body, {
    itemsPerPage: input.itemsPerPage,
    operationContext: input.operationContext,
    signal: input.signal,
  })
  if (!Array.isArray(response.body) || response.body.length > input.itemsPerPage) {
    throw new CoresignalProviderError("Coresignal Search returned more Employee IDs than the authorized page-size bound.", "invalid_response", 502)
  }
  const routing = await planCoresignalRegularSearchRouting(response.body, response.headers, dependencies.store)
  return {
    operation: "Base Employee ES-DSL Search",
    operationContext: input.operationContext,
    requestAttempts: 1,
    previewRequests: 0,
    collectRequests: 0,
    automaticPagination: false,
    searchMode: contract.searchMode,
    companyMapping: prepared.companyMapping,
    providerCreditsRemaining: response.providerCreditsRemaining,
    upstreamHttpStatus: response.upstreamHttpStatus,
    routing,
  }
}
