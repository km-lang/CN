import { coresignalProviderCompanyId } from "@/lib/coresignal-client"

export const PROVIDER_COMPANY_MAPPING_STATUSES = ["VERIFIED", "UNVERIFIED", "CONFLICT"] as const
export type ProviderCompanyMappingStatus = typeof PROVIDER_COMPANY_MAPPING_STATUSES[number]
export type ProviderCompanyResolutionState = ProviderCompanyMappingStatus | "MISSING"

export type ProviderCompanyMappingRecord = {
  id: number
  normalizedCompanyKey: string
  displayName: string
  provider: string
  providerCompanyId: string
  status: string
  mappingSource: string
  evidenceReference: string
  providerSourceId: string
  providerCompanyUrl: string
  verifiedBy: string
  verifiedAt: string
  createdAt: string
  updatedAt: string
}

export type ProviderCompanyMappingStore = {
  findByCompany(provider: string, normalizedCompanyKey: string): Promise<ProviderCompanyMappingRecord[]>
  findBySelectionId?(provider: string, mappingId: number): Promise<ProviderCompanyMappingRecord[]>
}

export type ProviderCompanyResolution = {
  state: ProviderCompanyResolutionState
  provider: string
  normalizedCompanyKey: string
  displayName: string
  providerCompanyId: number | null
  mapping: ProviderCompanyMappingRecord | null
  reason: string
}

export function normalizeCompanyDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

export function normalizeCompanyKey(value: unknown) {
  return normalizeCompanyDisplayName(value).toLowerCase()
}

export function normalizeProviderKey(value: unknown) {
  return normalizeCompanyDisplayName(value).toLowerCase()
}

function unresolved(
  state: ProviderCompanyResolutionState,
  provider: string,
  normalizedCompanyKey: string,
  displayName: string,
  reason: string,
  mapping: ProviderCompanyMappingRecord | null = null,
): ProviderCompanyResolution {
  return { state, provider, normalizedCompanyKey, displayName, providerCompanyId: null, mapping, reason }
}

export async function resolveProviderCompanyMapping(
  companyName: unknown,
  providerName: unknown,
  store: ProviderCompanyMappingStore,
): Promise<ProviderCompanyResolution> {
  const displayName = normalizeCompanyDisplayName(companyName)
  const normalizedCompanyKey = normalizeCompanyKey(displayName)
  const provider = normalizeProviderKey(providerName)
  if (!displayName || !provider) return unresolved("MISSING", provider, normalizedCompanyKey, displayName, "No provider-company mapping was selected.")
  const rows = await store.findByCompany(provider, normalizedCompanyKey)
  if (rows.length === 0) return unresolved("MISSING", provider, normalizedCompanyKey, displayName, `No ${providerName} mapping exists for ${displayName}.`)
  if (rows.length !== 1) return unresolved("CONFLICT", provider, normalizedCompanyKey, displayName, `Multiple ${providerName} mappings exist for ${displayName}.`)
  const mapping = rows[0]
  if (mapping.status === "UNVERIFIED") return unresolved("UNVERIFIED", provider, normalizedCompanyKey, mapping.displayName, `${mapping.displayName} has not been verified for ${providerName}.`, mapping)
  if (mapping.status === "CONFLICT") return unresolved("CONFLICT", provider, normalizedCompanyKey, mapping.displayName, `${mapping.displayName} has conflicting ${providerName} identity evidence.`, mapping)
  if (mapping.status !== "VERIFIED") return unresolved("CONFLICT", provider, normalizedCompanyKey, mapping.displayName, `${mapping.displayName} has an unsupported mapping status.`, mapping)
  try {
    const providerCompanyId = provider === "coresignal"
      ? coresignalProviderCompanyId(mapping.providerCompanyId)
      : null
    if (providerCompanyId === null) return unresolved("CONFLICT", provider, normalizedCompanyKey, mapping.displayName, `No provider-ID validator is available for ${providerName}.`, mapping)
    if (!mapping.verifiedBy.trim() || !mapping.verifiedAt.trim()) return unresolved("CONFLICT", provider, normalizedCompanyKey, mapping.displayName, `${mapping.displayName} is missing verification metadata.`, mapping)
    return { state: "VERIFIED", provider, normalizedCompanyKey, displayName: mapping.displayName, providerCompanyId, mapping, reason: "Verified provider-company mapping." }
  } catch {
    return unresolved("CONFLICT", provider, normalizedCompanyKey, mapping.displayName, `${mapping.displayName} has an invalid ${providerName} company ID.`, mapping)
  }
}

export async function resolveProviderCompanySelection(
  companyName: unknown,
  selectionKey: unknown,
  providerName: unknown,
  store: ProviderCompanyMappingStore,
): Promise<ProviderCompanyResolution> {
  const provider = normalizeProviderKey(providerName)
  const key = normalizeCompanyDisplayName(selectionKey)
  if (!key) return resolveProviderCompanyMapping(companyName, providerName, store)
  const match = key.match(/^([a-z0-9_-]+):(\d+)$/)
  if (!match || match[1] !== provider || !store.findBySelectionId) {
    return unresolved("CONFLICT", provider, normalizeCompanyKey(companyName), normalizeCompanyDisplayName(companyName), "The selected company identity is invalid or cannot be resolved server-side.")
  }
  const mappingId = Number(match[2])
  if (!Number.isSafeInteger(mappingId) || mappingId <= 0) {
    return unresolved("CONFLICT", provider, normalizeCompanyKey(companyName), normalizeCompanyDisplayName(companyName), "The selected company identity is invalid.")
  }
  const rows = await store.findBySelectionId(provider, mappingId)
  if (rows.length !== 1) {
    return unresolved(rows.length ? "CONFLICT" : "MISSING", provider, normalizeCompanyKey(companyName), normalizeCompanyDisplayName(companyName), "The selected company identity no longer resolves to one saved company.")
  }
  const mapping = rows[0]
  return resolveProviderCompanyMapping(mapping.displayName, providerName, { findByCompany: async () => [mapping] })
}

export function validateProviderCompanyMappingInput(input: {
  displayName?: unknown
  provider?: unknown
  providerCompanyId?: unknown
  status?: unknown
  mappingSource?: unknown
  evidenceReference?: unknown
  providerSourceId?: unknown
  providerCompanyUrl?: unknown
}, actor: string, now: string) {
  const displayName = normalizeCompanyDisplayName(input.displayName)
  const normalizedCompanyKey = normalizeCompanyKey(displayName)
  const provider = normalizeProviderKey(input.provider)
  const status = typeof input.status === "string" && PROVIDER_COMPANY_MAPPING_STATUSES.includes(input.status as ProviderCompanyMappingStatus)
    ? input.status as ProviderCompanyMappingStatus
    : null
  const providerCompanyId = normalizeCompanyDisplayName(input.providerCompanyId)
  if (!displayName) throw new Error("Company display name is required.")
  if (!provider) throw new Error("Provider is required.")
  if (!status) throw new Error("Mapping status must be VERIFIED, UNVERIFIED, or CONFLICT.")
  if (provider === "coresignal" && providerCompanyId) coresignalProviderCompanyId(providerCompanyId)
  if (status === "VERIFIED" && !providerCompanyId) throw new Error("A verified mapping requires a provider company ID.")
  return {
    normalizedCompanyKey,
    displayName,
    provider,
    providerCompanyId,
    status,
    mappingSource: normalizeCompanyDisplayName(input.mappingSource),
    evidenceReference: normalizeCompanyDisplayName(input.evidenceReference),
    providerSourceId: normalizeCompanyDisplayName(input.providerSourceId),
    providerCompanyUrl: normalizeCompanyDisplayName(input.providerCompanyUrl),
    verifiedBy: status === "VERIFIED" ? actor : "",
    verifiedAt: status === "VERIFIED" ? now : "",
    updatedAt: now,
  }
}
