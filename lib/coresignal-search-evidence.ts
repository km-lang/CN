import type { DiscoveryFilters } from "@/lib/alumni-search"
import { normalizeCoresignalSearchIdentityBatch } from "@/lib/coresignal-search-id-dedupe"
import type { CoresignalRegularSearchExecution } from "@/lib/coresignal-regular-search"

export const CORESIGNAL_SEARCH_EVIDENCE_MARKER = "\n\n[coresignal-search-evidence:v1]\n"
export const CORESIGNAL_SEARCH_EVIDENCE_VERSION = 1
export const CORESIGNAL_SEARCH_EVIDENCE_MAX_IDS = 20

type SearchMode = CoresignalRegularSearchExecution["searchMode"]
type RoutingState = CoresignalRegularSearchExecution["routing"]["routes"][number]["routingState"]

export type CoresignalSearchEvidence = {
  schemaVersion: 1
  provider: "coresignal"
  operation: "Base Employee ES-DSL Search"
  attemptId: string
  searchParameters: {
    institutionId: number
    company: string | null
    mappedCompanyId: number | null
    graduationYear: number | null
    itemsPerPage: number
    searchMode: SearchMode
  }
  upstreamHttpStatus: number
  employeeIds: readonly string[]
  returnedCount: number
  totalResults: number | null
  totalPages: number | null
  nextPageAfter: string | null
  creditsRemaining: number | null
  identityRoutes: readonly {
    employeeId: string
    routingState: RoutingState
    mappedAlumnusId: number | null
    profileFreshness: "NOT_EVALUATED"
  }[]
  profileFreshness: "NOT_EVALUATED"
  applicationAccounting: {
    applicationUnits: 1
    providerRequestCost: "UNRESOLVED"
  }
  providerActions: {
    searchRequests: 1
    previewRequests: 0
    collectRequests: 0
    automaticPagination: false
    canonicalMutations: 0
  }
  audit: {
    requestedAt: string
    completedAt: string
    provenance: "provider_response_history"
  }
}

export type PresentedCoresignalSearchEvidence =
  | { state: "RETAINED"; evidence: CoresignalSearchEvidence }
  | { state: "NOT_RETAINED"; reason: string }
  | { state: "UNAVAILABLE"; reason: string }

export class CoresignalSearchEvidencePersistenceError extends Error {
  readonly providerCallMade = true
  readonly applicationUnits = 1
  readonly retryAllowed = false

  constructor(public readonly upstreamHttpStatus: number | null, options?: ErrorOptions) {
    super("Coresignal Search succeeded upstream, but its sanitized evidence could not be persisted. Do not retry automatically; administrator reconciliation is required.", options)
    this.name = "CoresignalSearchEvidencePersistenceError"
  }
}

function boundedText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} is invalid.`)
  }
  return value.trim()
}

function nullableBoundedText(value: unknown, field: string, maximum: number) {
  return value === null ? null : boundedText(value, field, maximum)
}

function safeInteger(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${field} is invalid.`)
  return Number(value)
}

function nullableSafeInteger(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return value === null ? null : safeInteger(value, field, minimum, maximum)
}

function isoTimestamp(value: unknown, field: string) {
  const text = boundedText(value, field, 40)
  if (Number.isNaN(Date.parse(text))) throw new Error(`${field} is invalid.`)
  return text
}

function isSearchMode(value: unknown): value is SearchMode {
  return ["INSTITUTION_ONLY", "EXACT_GRADUATION_YEAR", "CURRENT_COMPANY", "CURRENT_COMPANY_EXACT_GRADUATION_YEAR"].includes(String(value))
}

function isRoutingState(value: unknown): value is RoutingState {
  return ["IDENTITY_RESOLVED", "IDENTITY_RESOLUTION_REQUIRED", "IDENTITY_REVIEW_REQUIRED"].includes(String(value))
}

export function createCoresignalSearchEvidence(input: {
  attemptId: string
  filters: DiscoveryFilters
  institutionId: number
  itemsPerPage: number
  requestedAt: string
  completedAt: string
  execution: CoresignalRegularSearchExecution
}): CoresignalSearchEvidence {
  const itemsPerPage = safeInteger(input.itemsPerPage, "itemsPerPage", 1, CORESIGNAL_SEARCH_EVIDENCE_MAX_IDS)
  const employeeIds = normalizeCoresignalSearchIdentityBatch({ employeeIds: input.execution.routing.routes.map(route => route.employeeId) })
  const returnedCount = safeInteger(input.execution.routing.providerSearch.pageIdsReceived, "returnedCount", 0, itemsPerPage)
  if (employeeIds.length > itemsPerPage) throw new Error("Employee ID evidence exceeds the authorized Search page-size bound.")
  const attemptId = boundedText(input.attemptId, "attemptId", 128)
  if (!/^[A-Za-z0-9._:-]+$/.test(attemptId)) throw new Error("attemptId is invalid.")
  const upstreamHttpStatus = safeInteger(input.execution.upstreamHttpStatus, "upstreamHttpStatus", 100, 599)
  const graduationYear = input.filters.graduationYear ? safeInteger(Number(input.filters.graduationYear), "graduationYear", 1_000, 9_999) : null
  const company = input.filters.company.trim() ? boundedText(input.filters.company, "company", 160) : null
  const mappedCompanyId = nullableSafeInteger(input.execution.companyMapping.providerCompanyId, "mappedCompanyId", 1)
  const totalResults = nullableSafeInteger(input.execution.routing.providerSearch.totalResults, "totalResults")
  const totalPages = nullableSafeInteger(input.execution.routing.providerSearch.totalPages, "totalPages")
  const nextPageAfter = nullableBoundedText(input.execution.routing.providerSearch.nextPageAfter, "nextPageAfter", 256)
  const creditsRemaining = nullableSafeInteger(input.execution.providerCreditsRemaining, "creditsRemaining")
  const identityRoutes = input.execution.routing.routes.map(route => {
    if (!employeeIds.includes(route.employeeId) || !isRoutingState(route.routingState) || route.profileFreshness !== "NOT_EVALUATED") {
      throw new Error("Identity routing evidence is invalid.")
    }
    return {
      employeeId: route.employeeId,
      routingState: route.routingState,
      mappedAlumnusId: nullableSafeInteger(route.mappedAlumnusId, "mappedAlumnusId", 1),
      profileFreshness: "NOT_EVALUATED" as const,
    }
  })
  if (identityRoutes.length !== employeeIds.length || new Set(identityRoutes.map(route => route.employeeId)).size !== identityRoutes.length) {
    throw new Error("Identity routing evidence must contain exactly one route per retained Employee ID.")
  }

  return {
    schemaVersion: CORESIGNAL_SEARCH_EVIDENCE_VERSION,
    provider: "coresignal",
    operation: "Base Employee ES-DSL Search",
    attemptId,
    searchParameters: {
      institutionId: safeInteger(input.institutionId, "institutionId", 1),
      company,
      mappedCompanyId,
      graduationYear,
      itemsPerPage,
      searchMode: input.execution.searchMode,
    },
    upstreamHttpStatus,
    employeeIds,
    returnedCount,
    totalResults,
    totalPages,
    nextPageAfter,
    creditsRemaining,
    identityRoutes,
    profileFreshness: "NOT_EVALUATED",
    applicationAccounting: { applicationUnits: 1, providerRequestCost: "UNRESOLVED" },
    providerActions: { searchRequests: 1, previewRequests: 0, collectRequests: 0, automaticPagination: false, canonicalMutations: 0 },
    audit: {
      requestedAt: isoTimestamp(input.requestedAt, "requestedAt"),
      completedAt: isoTimestamp(input.completedAt, "completedAt"),
      provenance: "provider_response_history",
    },
  }
}

export function serializeCoresignalSearchEvidence(summary: string, evidence: CoresignalSearchEvidence) {
  if (summary.includes(CORESIGNAL_SEARCH_EVIDENCE_MARKER)) throw new Error("Search response summary already contains an evidence envelope.")
  return `${summary.trim()}${CORESIGNAL_SEARCH_EVIDENCE_MARKER}${JSON.stringify(evidence)}`
}

function parseEvidence(value: unknown): CoresignalSearchEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence must be an object.")
  const source = value as Record<string, unknown>
  const parameters = source.searchParameters as Record<string, unknown>
  const accounting = source.applicationAccounting as Record<string, unknown>
  const actions = source.providerActions as Record<string, unknown>
  const audit = source.audit as Record<string, unknown>
  if (source.schemaVersion !== 1 || source.provider !== "coresignal" || source.operation !== "Base Employee ES-DSL Search") throw new Error("Evidence contract is invalid.")
  if (!parameters || !accounting || !actions || !audit || !isSearchMode(parameters.searchMode)) throw new Error("Evidence metadata is invalid.")
  const itemsPerPage = safeInteger(parameters.itemsPerPage, "itemsPerPage", 1, CORESIGNAL_SEARCH_EVIDENCE_MAX_IDS)
  const employeeIds = normalizeCoresignalSearchIdentityBatch({ employeeIds: source.employeeIds as readonly unknown[] })
  if (employeeIds.length > itemsPerPage) throw new Error("Employee ID evidence exceeds its authorized bound.")
  const rawRoutes = source.identityRoutes
  if (!Array.isArray(rawRoutes)) throw new Error("Identity routing evidence is invalid.")
  const identityRoutes = rawRoutes.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Identity routing evidence is invalid.")
    const route = item as Record<string, unknown>
    const routeEmployeeId = normalizeCoresignalSearchIdentityBatch({ employeeIds: [route.employeeId] })[0]
    if (!isRoutingState(route.routingState) || route.profileFreshness !== "NOT_EVALUATED") throw new Error("Identity routing evidence is invalid.")
    return { employeeId: routeEmployeeId, routingState: route.routingState, mappedAlumnusId: nullableSafeInteger(route.mappedAlumnusId, "mappedAlumnusId", 1), profileFreshness: "NOT_EVALUATED" as const }
  })
  if (identityRoutes.length !== employeeIds.length || new Set(identityRoutes.map(route => route.employeeId)).size !== identityRoutes.length || identityRoutes.some(route => !employeeIds.includes(route.employeeId))) {
    throw new Error("Identity routing evidence does not match retained Employee IDs.")
  }
  if (accounting.applicationUnits !== 1 || accounting.providerRequestCost !== "UNRESOLVED") throw new Error("Application accounting evidence is invalid.")
  if (actions.searchRequests !== 1 || actions.previewRequests !== 0 || actions.collectRequests !== 0 || actions.automaticPagination !== false || actions.canonicalMutations !== 0) throw new Error("Provider action evidence is invalid.")
  if (source.profileFreshness !== "NOT_EVALUATED" || audit.provenance !== "provider_response_history") throw new Error("Evidence authority metadata is invalid.")
  return {
    schemaVersion: 1,
    provider: "coresignal",
    operation: "Base Employee ES-DSL Search",
    attemptId: boundedText(source.attemptId, "attemptId", 128),
    searchParameters: {
      institutionId: safeInteger(parameters.institutionId, "institutionId", 1),
      company: nullableBoundedText(parameters.company, "company", 160),
      mappedCompanyId: nullableSafeInteger(parameters.mappedCompanyId, "mappedCompanyId", 1),
      graduationYear: nullableSafeInteger(parameters.graduationYear, "graduationYear", 1_000, 9_999),
      itemsPerPage,
      searchMode: parameters.searchMode,
    },
    upstreamHttpStatus: safeInteger(source.upstreamHttpStatus, "upstreamHttpStatus", 100, 599),
    employeeIds,
    returnedCount: safeInteger(source.returnedCount, "returnedCount", 0, itemsPerPage),
    totalResults: nullableSafeInteger(source.totalResults, "totalResults"),
    totalPages: nullableSafeInteger(source.totalPages, "totalPages"),
    nextPageAfter: nullableBoundedText(source.nextPageAfter, "nextPageAfter", 256),
    creditsRemaining: nullableSafeInteger(source.creditsRemaining, "creditsRemaining"),
    identityRoutes,
    profileFreshness: "NOT_EVALUATED",
    applicationAccounting: { applicationUnits: 1, providerRequestCost: "UNRESOLVED" },
    providerActions: { searchRequests: 1, previewRequests: 0, collectRequests: 0, automaticPagination: false, canonicalMutations: 0 },
    audit: { requestedAt: isoTimestamp(audit.requestedAt, "requestedAt"), completedAt: isoTimestamp(audit.completedAt, "completedAt"), provenance: "provider_response_history" },
  }
}

export function deserializeCoresignalSearchEvidence(responseSummary: string) {
  const markerIndex = responseSummary.lastIndexOf(CORESIGNAL_SEARCH_EVIDENCE_MARKER)
  if (markerIndex < 0) return null
  const summary = responseSummary.slice(0, markerIndex).trim()
  const rawEvidence = responseSummary.slice(markerIndex + CORESIGNAL_SEARCH_EVIDENCE_MARKER.length)
  return { summary, evidence: parseEvidence(JSON.parse(rawEvidence) as unknown) }
}

export function presentProviderHistorySearchEvidence<T extends { provider: string; operation: string; status: string; responseSummary: string }>(row: T): T & { searchEvidence?: PresentedCoresignalSearchEvidence } {
  if (row.provider !== "coresignal" || row.operation !== "Base Employee ES-DSL Search") return row
  try {
    const retained = deserializeCoresignalSearchEvidence(row.responseSummary)
    if (retained) return { ...row, responseSummary: retained.summary, searchEvidence: { state: "RETAINED", evidence: retained.evidence } }
  } catch {
    return { ...row, responseSummary: row.responseSummary.split(CORESIGNAL_SEARCH_EVIDENCE_MARKER)[0].trim(), searchEvidence: { state: "UNAVAILABLE", reason: "Stored Search evidence could not be validated." } }
  }
  if (row.status === "success") return { ...row, searchEvidence: { state: "NOT_RETAINED", reason: "Employee ID and pagination evidence was not retained for this historical Search." } }
  return row
}

export async function executeAndPersistCoresignalSearchEvidence<TExecution extends { upstreamHttpStatus: number }, TEvidence, TPersisted>(input: {
  execute: () => Promise<TExecution>
  createEvidence: (execution: TExecution) => TEvidence
  persist: (execution: TExecution, evidence: TEvidence) => Promise<TPersisted>
}) {
  const execution = await input.execute()
  try {
    const evidence = input.createEvidence(execution)
    const persisted = await input.persist(execution, evidence)
    return { execution, evidence, persisted }
  } catch (error) {
    throw new CoresignalSearchEvidencePersistenceError(execution.upstreamHttpStatus, { cause: error })
  }
}
