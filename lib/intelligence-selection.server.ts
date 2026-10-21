import { runDirectoryQuery } from "@/lib/directory-data"
import { normalizeDirectoryQuery } from "@/lib/directory-query"
import { parseCnSelectionContract, type CnSelectionContract } from "@/lib/cn-selection-contract"

export type CnSelectedMember = { cnAlumniId: number; placementRelevance: number | null; dataConfidence: number | null; reason: "CRITERIA_MATCH" | "MANUAL_INCLUDE"; monitoringEligibility: "IDENTITY_READY" | "PENDING_PROVIDER_MAPPING" }

async function allPages(input: Record<string, unknown>, query: typeof runDirectoryQuery) {
  const maximumRows = Array.isArray(input.alumniIds) ? 500 : 20_000
  const normalized = normalizeDirectoryQuery({ ...input, page: 1, pageSize: 50, sort: "name" })
  // Internal bounded query only: public Directory requests remain capped at 50 rows.
  const result = await query({ ...normalized, pageSize: maximumRows + 1 })
  if (result.total > maximumRows || result.items.length > maximumRows) throw new Error("Selection exceeds its bounded safety ceiling; narrow the criteria.")
  return result.items
}

export async function evaluateCnSelection(value: unknown, query: typeof runDirectoryQuery = runDirectoryQuery) {
  const contract: CnSelectionContract = parseCnSelectionContract(value)
  const c = contract.criteria
  const filters: Record<string, unknown> = {
    excludeProvisional: c.minPlacementRelevance !== undefined || c.minDataConfidence !== undefined,
    minRelevance: c.minPlacementRelevance ?? 0,
    minConfidence: c.minDataConfidence ?? 0,
    company: c.company ?? "All companies", companyPriority: c.companyPriority ?? "All priorities",
    role: c.role ?? "", function: c.function ?? "All functions", location: c.location ?? "",
    programme: "All programmes", programmes: c.programmes,
    seniorities: c.seniorities, seniorityMode: c.seniorityMode,
    graduationYearMode: c.graduationYearMode ?? "exact",
    batch: c.graduationYearMode === "exact" ? String(c.graduationYear) : "",
    graduationYearStart: c.graduationYearMode === "range" ? String(c.graduationYearStart) : "",
    graduationYearEnd: c.graduationYearMode === "range" ? String(c.graduationYearEnd) : "",
  }
  const matched = await allPages(filters, query)
  const excluded = new Set(contract.excludeCnAlumniIds)
  const members = new Map<number, CnSelectedMember>()
  const member = (item: (typeof matched)[number], reason: CnSelectedMember["reason"]): CnSelectedMember => ({
    cnAlumniId: item.id, placementRelevance: item.relevance, dataConfidence: item.intakeStatus === "PROVISIONAL" ? null : item.confidence,
    reason, monitoringEligibility: item.providerIdentityReady ? "IDENTITY_READY" : "PENDING_PROVIDER_MAPPING",
  })
  for (const item of matched) if (!excluded.has(item.id)) members.set(item.id, member(item, "CRITERIA_MATCH"))
  const missingManualIds: number[] = []
  for (let offset = 0; offset < contract.includeCnAlumniIds.length; offset += 500) {
    const ids = contract.includeCnAlumniIds.slice(offset, offset + 500)
    if (!ids.length) continue
    const included = await allPages({ alumniIds: ids }, query)
    const found = new Set(included.map(item => item.id))
    for (const id of ids) if (!found.has(id)) missingManualIds.push(id)
    for (const item of included) if (!excluded.has(item.id)) members.set(item.id, member(item, "MANUAL_INCLUDE"))
  }
  const selected = [...members.values()].sort((a, b) => a.cnAlumniId - b.cnAlumniId)
  return {
    version: contract.version, scoreVersion: contract.scoreVersion,
    matchedBeforeOverrides: matched.length, selectedCount: selected.length,
    manuallyIncluded: selected.filter(item => item.reason === "MANUAL_INCLUDE").length,
    manuallyExcluded: matched.filter(item => excluded.has(item.id)).length,
    missingManualIds,
    identityReady: selected.filter(item => item.monitoringEligibility === "IDENTITY_READY").length,
    pendingProviderMapping: selected.filter(item => item.monitoringEligibility === "PENDING_PROVIDER_MAPPING").length,
    members: selected,
  }
}
