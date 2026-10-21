import { normalizeCompanyDisplayName, normalizeCompanyKey } from "@/lib/provider-company-mapping"

export type CompanyDirectoryVerificationStatus = "VERIFIED" | "UNVERIFIED" | "CONFLICT"

export type CompanyDirectoryOption = {
  selectionKey: string
  canonicalName: string
  aliases: string[]
  provider: string
  providerCompanyId: string
  providerExactName: string
  linkedinOrganizationUrl: string
  source: string
  verificationStatus: CompanyDirectoryVerificationStatus
  verifiedBy: string
  verifiedAt: string
  lastCheckedAt: string
}

type MappingRow = {
  id: number
  normalizedCompanyKey: string
  displayName: string
  provider: string
  providerCompanyId: string
  status: string
  mappingSource: string
  providerCompanyUrl: string
  verifiedBy: string
  verifiedAt: string
  updatedAt: string
}

type AliasRow = { mappingId: number; displayAlias: string; status: string }

function status(value: string): CompanyDirectoryVerificationStatus {
  return value === "VERIFIED" || value === "CONFLICT" ? value : "UNVERIFIED"
}

export function buildCompanyDirectory(input: {
  mappings: readonly MappingRow[]
  aliases: readonly AliasRow[]
  organizationNames: readonly string[]
  priorityNames?: readonly string[]
}) {
  const aliasesByMapping = new Map<number, string[]>()
  for (const alias of input.aliases) {
    if (alias.status !== "VERIFIED") continue
    const displayAlias = normalizeCompanyDisplayName(alias.displayAlias)
    if (!displayAlias) continue
    aliasesByMapping.set(alias.mappingId, [...(aliasesByMapping.get(alias.mappingId) ?? []), displayAlias])
  }

  const options: CompanyDirectoryOption[] = input.mappings.map(mapping => ({
    selectionKey: `${mapping.provider.toLowerCase()}:${mapping.id}`,
    canonicalName: normalizeCompanyDisplayName(mapping.displayName),
    aliases: [...new Map((aliasesByMapping.get(mapping.id) ?? []).map(alias => [normalizeCompanyKey(alias), alias])).values()],
    provider: mapping.provider.toLowerCase(),
    providerCompanyId: mapping.providerCompanyId,
    providerExactName: normalizeCompanyDisplayName(mapping.displayName),
    linkedinOrganizationUrl: mapping.providerCompanyUrl,
    source: mapping.mappingSource || "Admin-maintained provider mapping",
    verificationStatus: status(mapping.status),
    verifiedBy: mapping.verifiedBy,
    verifiedAt: mapping.verifiedAt,
    lastCheckedAt: mapping.updatedAt,
  })).filter(option => option.canonicalName)

  const represented = new Set(options.flatMap(option => [option.canonicalName, ...option.aliases].map(normalizeCompanyKey)))
  const localNames = [...input.organizationNames, ...(input.priorityNames ?? [])]
  for (const rawName of localNames) {
    const canonicalName = normalizeCompanyDisplayName(rawName)
    const key = normalizeCompanyKey(canonicalName)
    if (!canonicalName || represented.has(key)) continue
    represented.add(key)
    options.push({
      selectionKey: "",
      canonicalName,
      aliases: [],
      provider: "coresignal",
      providerCompanyId: "",
      providerExactName: canonicalName,
      linkedinOrganizationUrl: "",
      source: "Corporate Network organization data",
      verificationStatus: "UNVERIFIED",
      verifiedBy: "",
      verifiedAt: "",
      lastCheckedAt: "",
    })
  }
  return options.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName) || left.selectionKey.localeCompare(right.selectionKey))
}

export function filterCompanyDirectory(options: readonly CompanyDirectoryOption[], query: string) {
  const tokens = normalizeCompanyKey(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return [...options]
  return options.filter(option => {
    const searchable = [option.canonicalName, ...option.aliases].map(normalizeCompanyKey).join(" ")
    return tokens.every(token => searchable.includes(token))
  })
}
