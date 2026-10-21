export const CORESIGNAL_COMPANY_LOOKUP_CAPABILITIES = Object.freeze({
  implementationStatus: "DORMANT_PROVIDER_FREE_ADAPTER" as const,
  liveEnabled: false as const,
  accountEntitlement: "UNKNOWN" as const,
  documentedSearchEndpoint: "/cdapi/v2/company_multi_source/search/es_dsl" as const,
  documentedPreviewEndpoint: "/cdapi/v2/company_multi_source/search/es_dsl/preview" as const,
  verifiedQueryFields: ["company_name"] as const,
  previewResponseFields: ["id", "company_name", "professional_network_url", "website", "unique_domain", "size_range", "employees_count", "industry", "hq_country", "company_logo", "_score"] as const,
  searchRateLimit: "18 requests/second (documented service ceiling; not an application budget)" as const,
  billing: "Provider documentation states Company Search consumes search credits; account-specific pricing and entitlement are unverified." as const,
  employeeCompanyIdCompatibility: "UNVERIFIED" as const,
  cacheAndLicensing: "UNVERIFIED" as const,
})

export type CoresignalCompanyLookupResult = {
  providerCompanyId: number
  companyName: string
  professionalNetworkUrl: string
  website: string
  industry: string
  headquartersCountry: string
}

export interface CoresignalCompanyLookupAdapter {
  previewByName(query: string): Promise<readonly CoresignalCompanyLookupResult[]>
}

export function normalizeMockedCoresignalCompanyPreview(value: unknown): CoresignalCompanyLookupResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const providerCompanyId = Number(row.id)
    const companyName = typeof row.company_name === "string" ? row.company_name.trim() : ""
    if (!Number.isSafeInteger(providerCompanyId) || providerCompanyId <= 0 || !companyName) return []
    const text = (field: string) => typeof row[field] === "string" ? String(row[field]).trim() : ""
    return [{ providerCompanyId, companyName, professionalNetworkUrl: text("professional_network_url"), website: text("website"), industry: text("industry"), headquartersCountry: text("hq_country") }]
  })
}

export const disabledCoresignalCompanyLookup: CoresignalCompanyLookupAdapter = {
  async previewByName() {
    throw new Error("Coresignal Company lookup is not enabled. Account entitlement, billing, licensing, and Employee company-ID compatibility require separate Admin-authorized validation.")
  },
}
