import type { DiscoveryFilters, DiscoveryProfile } from "@/lib/alumni-search"
import type { DiscoveryExecutionResult } from "@/lib/discovery-execution"
import type { RejectedCandidateEvidence } from "@/lib/discovery-reconciliation"

export const PROFESSIONAL_DATA_PROVIDER = "coresignal" as const
export const PROFESSIONAL_DATA_PROVIDER_LABEL = "Coresignal" as const

export type ProfessionalDataMode = "mock" | "live"
export type ProviderUsage = {
  applicationUnits: number
  providerReportedUsage: number | null
  usageState: "provider_reported" | "reconciliation_required" | "not_applicable"
}

export type ProfessionalSearchResult = {
  profiles: DiscoveryProfile[]
  totalAvailable: number
  responseSummary: string
  usage: ProviderUsage
  execution?: DiscoveryExecutionResult
}

export type ProfessionalRefreshResult = {
  status: "success" | "no_match" | "error"
  changes: Record<string, string | number | boolean>
  responseSummary: string
  errorMessage?: string
  usage: ProviderUsage
}

export type InternalProfessionalPerson = {
  id: number
  name: string
  batch: number
  company: string
  title: string
  function: string
  seniority: string
  location: string
  linkedinUrl?: string
  coresignalEmployeeId?: string
  education?: string
  programme?: string
  graduationYear?: number
}

export type ProfessionalSearchOptions = {
  rejectedCandidates?: readonly RejectedCandidateEvidence[]
  maximumCollects?: number
  exactYearPreview?: {
    companyId?: number
    companyName?: string
    companyIdentityMode?: "VERIFIED_ID" | "EXACT_NAME"
    expectedCompanyUrl?: string
    operationContext: string
    page?: number
  }
}

export interface ProfessionalDataProvider {
  readonly name: typeof PROFESSIONAL_DATA_PROVIDER
  readonly label: typeof PROFESSIONAL_DATA_PROVIDER_LABEL
  mode(): ProfessionalDataMode
  configured(): boolean
  searchCandidates(filters: DiscoveryFilters, internal: InternalProfessionalPerson[], limit: number, options?: ProfessionalSearchOptions): Promise<ProfessionalSearchResult>
  refreshProfile(person: InternalProfessionalPerson): Promise<ProfessionalRefreshResult>
}

export const unknownProviderUsage = (applicationUnits: number): ProviderUsage => ({
  applicationUnits,
  providerReportedUsage: null,
  usageState: "reconciliation_required",
})

export const mockProviderUsage = (applicationUnits: number): ProviderUsage => ({
  applicationUnits,
  providerReportedUsage: null,
  usageState: "not_applicable",
})
