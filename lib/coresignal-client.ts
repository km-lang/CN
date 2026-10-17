import { discoveryExperienceTitleQuery, type DiscoveryFilters } from "@/lib/alumni-search"
import { providerSecret } from "@/lib/provider-runtime"
import { coresignalProgrammeQuery, providerEducationDateTo } from "@/lib/discovery-qualification"

export const CORESIGNAL_API_BASE = "https://api.coresignal.com"
export const CORESIGNAL_IIML_INSTITUTION_URL = "https://www.linkedin.com/school/indian-institute-of-management-lucknow"
export const CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID = 25_919_228
export const CORESIGNAL_SEARCH_PATH = "/cdapi/v2/employee_base/search/filter/preview"
export const CORESIGNAL_ES_DSL_SEARCH_PATH = "/cdapi/v2/employee_base/search/es_dsl"
export const CORESIGNAL_COLLECT_PATH = "/cdapi/v2/employee_base/collect"
export const CORESIGNAL_ES_DSL_DEFAULT_ITEMS_PER_PAGE = 1
export const CORESIGNAL_ES_DSL_MAX_ITEMS_PER_PAGE = 1_000

export type CoresignalRegularSearchTransportResult = {
  body: unknown
  headers: Readonly<Record<"x-total-results" | "x-total-pages" | "x-next-page-after", string | null>>
  providerCreditsRemaining: number | null
  upstreamHttpStatus: number
}

export type CoresignalFailureKind = "authentication" | "rate_limit" | "timeout" | "unavailable" | "invalid_request" | "invalid_response"

export class CoresignalProviderError extends Error {
  constructor(message: string, public readonly kind: CoresignalFailureKind, public readonly status: number, public readonly successfulOperationCredits = 0) { super(message) }
}

export type CoresignalEducationEndNarrowing = {
  semantics: "PROVIDER_UPPER_BOUND"
  value: string
  exactGraduationYearRequested: string | null
}

export function coresignalEducationEndNarrowing(filters?: DiscoveryFilters, now: Date = new Date()): CoresignalEducationEndNarrowing | null {
  if (filters?.graduationYear) return { semantics: "PROVIDER_UPPER_BOUND", value: filters.graduationYear, exactGraduationYearRequested: filters.graduationYear }
  if (filters?.alumniStatus === "Past alumni only") return { semantics: "PROVIDER_UPPER_BOUND", value: providerEducationDateTo(now), exactGraduationYearRequested: null }
  return null
}

export function coresignalSearchContract(filters?: DiscoveryFilters, now: Date = new Date()) {
  const programmeQuery = coresignalProgrammeQuery(filters?.discoveryProgrammes ?? [])
  const experienceTitle = filters ? discoveryExperienceTitleQuery(filters) : ""
  const educationEndNarrowing = coresignalEducationEndNarrowing(filters, now)
  return {
    method: "POST" as const,
    path: CORESIGNAL_SEARCH_PATH,
    body: {
      education_institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL,
      active_experience: true,
      ...(programmeQuery ? { education_program_name: programmeQuery } : {}),
      ...(educationEndNarrowing ? { education_date_to: educationEndNarrowing.value } : {}),
      ...(filters?.company ? { experience_company_name: filters.company } : {}),
      ...(experienceTitle ? { experience_title: experienceTitle } : {}),
      ...(filters?.location ? { location: filters.location } : {}),
    },
  }
}

export type CoresignalEmployeeEsDslSearchMode = "INSTITUTION_ONLY" | "EXACT_GRADUATION_YEAR" | "CURRENT_COMPANY" | "CURRENT_COMPANY_EXACT_GRADUATION_YEAR"

export function coresignalEmployeeEsDslGraduationYear(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === "number" && Number.isInteger(value) && value >= 1_000 && value <= 9_999) return value
  if (typeof value === "string" && /^\d{4}$/.test(value)) return Number(value)
  throw new Error("When supplied, Coresignal ES-DSL graduation year must be an exact four-digit year.")
}

/**
 * Provider-free contract for Base Employee ID discovery by the live-verified
 * IIM Lucknow institution ID, with an optional exact education end year.
 *
 * This deliberately does not support company, role, function, seniority,
 * programme, location, or deleted-record clauses. Their Base Employee ES
 * semantics have not all been established well enough to add them safely.
 * Collect remains authoritative for final education and employment evidence.
 */
export function coresignalEmployeeEsDslSearchContract(
  options: { graduationYear?: unknown; itemsPerPage?: number } = {},
) {
  const graduationYear = coresignalEmployeeEsDslGraduationYear(options.graduationYear)
  const itemsPerPage = options.itemsPerPage ?? CORESIGNAL_ES_DSL_DEFAULT_ITEMS_PER_PAGE
  if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1 || itemsPerPage > CORESIGNAL_ES_DSL_MAX_ITEMS_PER_PAGE) {
    throw new Error(`Coresignal ES-DSL items_per_page must be between 1 and ${CORESIGNAL_ES_DSL_MAX_ITEMS_PER_PAGE}.`)
  }
  const educationFilters = [
    { term: { "education.institution_id": CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID } },
    ...(graduationYear === undefined ? [] : [{ term: { "education.date_to_year": graduationYear } }]),
  ]
  return {
    searchMode: (graduationYear === undefined ? "INSTITUTION_ONLY" : "EXACT_GRADUATION_YEAR") as CoresignalEmployeeEsDslSearchMode,
    method: "POST" as const,
    path: CORESIGNAL_ES_DSL_SEARCH_PATH,
    query: { items_per_page: itemsPerPage },
    body: {
      query: {
        bool: {
          filter: [
            { term: { is_parent: 1 } },
            {
              nested: {
                path: "education",
                query: {
                  bool: {
                    filter: educationFilters,
                  },
                },
              },
            },
          ],
        },
      },
      sort: ["id"],
    },
  }
}

export function coresignalProviderCompanyId(value: unknown) {
  const companyId = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("Coresignal company ID must be a positive safe integer.")
  }
  return companyId
}

/**
 * Provider-free builder for the live-verified current-company ES structure.
 * Product execution must supply companyId only from a VERIFIED server-side
 * provider-company mapping; browser input must never reach this helper.
 *
 * Controlled Collect evidence makes a same-row company ID + is_current=1 +
 * deleted=0 predicate the safest candidate. A null end date is deliberately
 * not used because non-current experience can also have date_to=null.
 */
export function coresignalCurrentCompanyEsDslDiagnosticContract(options: {
  companyId: unknown
  graduationYear?: unknown
  itemsPerPage?: number
}) {
  return coresignalVerifiedCompanyEsDslSearchContract(options)
}

export function coresignalVerifiedCompanyEsDslSearchContract(options: {
  companyId: unknown
  graduationYear?: unknown
  itemsPerPage?: number
}) {
  const companyId = coresignalProviderCompanyId(options.companyId)
  const base = coresignalEmployeeEsDslSearchContract({
    graduationYear: options.graduationYear,
    itemsPerPage: options.itemsPerPage,
  })
  return {
    searchMode: (options.graduationYear === undefined || options.graduationYear === ""
      ? "CURRENT_COMPANY"
      : "CURRENT_COMPANY_EXACT_GRADUATION_YEAR") as CoresignalEmployeeEsDslSearchMode,
    method: base.method,
    path: base.path,
    query: base.query,
    body: {
      query: {
        bool: {
          filter: [
            ...base.body.query.bool.filter,
            {
              nested: {
                path: "experience",
                query: {
                  bool: {
                    filter: [
                      { term: { "experience.company_id": companyId } },
                      { term: { "experience.is_current": 1 } },
                      { term: { "experience.deleted": 0 } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      sort: base.body.sort,
    },
  }
}

/** Compatibility wrapper for callers that require an exact graduation year. */
export function coresignalExactYearEsDslSearchContract(
  filters: DiscoveryFilters,
  options: { itemsPerPage?: number } = {},
) {
  if (!/^\d{4}$/.test(filters.graduationYear)) throw new Error("An exact four-digit graduation year is required for Coresignal ES-DSL search.")
  const contract = coresignalEmployeeEsDslSearchContract({
    graduationYear: filters.graduationYear,
    itemsPerPage: options.itemsPerPage,
  })
  return { method: contract.method, path: contract.path, query: contract.query, body: contract.body }
}

export function coresignalCollectContract(employeeId: string) {
  return { method: "GET" as const, path: `${CORESIGNAL_COLLECT_PATH}/${encodeURIComponent(employeeId)}` }
}

function failure(status: number) {
  if (status === 401 || status === 403) return new CoresignalProviderError("Coresignal authentication failed.", "authentication", status)
  if (status === 429) return new CoresignalProviderError("Coresignal rate limit reached.", "rate_limit", status)
  if (status >= 500) return new CoresignalProviderError("Coresignal is temporarily unavailable.", "unavailable", status)
  return new CoresignalProviderError("Coresignal rejected the request.", "invalid_request", status)
}

type RequestOptions = { fetcher?: typeof fetch; timeoutMs?: number; signal?: AbortSignal }

async function response(path: string, init: RequestInit, options: RequestOptions = {}) {
  const key = providerSecret("coresignal")
  if (!key) throw new CoresignalProviderError("Coresignal authentication is not configured.", "authentication", 401)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(`${CORESIGNAL_API_BASE}${path}`, {
      ...init,
      headers: { apikey: key, accept: "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new CoresignalProviderError("Coresignal request timed out.", "timeout", 504)
    throw new CoresignalProviderError("Coresignal is temporarily unavailable.", "unavailable", 503)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
  if (!response.ok) throw failure(response.status)
  return response
}

async function request(path: string, init: RequestInit, options: RequestOptions = {}) {
  const providerResponse = await response(path, init, options)
  try { return await providerResponse.json() as unknown } catch { throw new CoresignalProviderError("Coresignal returned an unreadable response.", "invalid_response", 502) }
}

export function searchCoresignalIiml(options: { fetcher?: typeof fetch; timeoutMs?: number; filters?: DiscoveryFilters; now?: Date } = {}) {
  const contract = coresignalSearchContract(options.filters, options.now)
  return request(contract.path, { method: contract.method, headers: { "content-type": "application/json" }, body: JSON.stringify(contract.body) }, options)
}

export function collectCoresignalEmployee(employeeId: string, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  if (!employeeId.trim()) throw new CoresignalProviderError("A stable Coresignal employee ID is required.", "invalid_request", 400)
  const contract = coresignalCollectContract(employeeId)
  return request(contract.path, { method: contract.method }, options)
}

export async function collectCoresignalEmployeeWithMetadata(employeeId: string, options: RequestOptions = {}) {
  if (!employeeId.trim()) throw new CoresignalProviderError("A stable Coresignal employee ID is required.", "invalid_request", 400)
  const contract = coresignalCollectContract(employeeId)
  const providerResponse = await response(contract.path, { method: contract.method, redirect: "error" }, options)
  let body: unknown
  try { body = await providerResponse.json() as unknown } catch { throw new CoresignalProviderError("Coresignal returned an unreadable response.", "invalid_response", 502) }
  return {
    body,
    upstreamHttpStatus: providerResponse.status,
    providerCreditsRemaining: optionalNonNegativeIntegerHeader(providerResponse.headers, "x-credits-remaining"),
  }
}

function optionalNonNegativeIntegerHeader(headers: Headers, name: string) {
  const raw = headers.get(name)
  if (raw === null || !/^(0|[1-9][0-9]*)$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Performs exactly one Base Employee ES-DSL Search request. It never retries,
 * follows continuation headers, calls Preview/Collect, or interprets returned
 * Employee IDs. The IIM Lucknow institution predicate and its 2011 exact-year
 * combination are live verified; this transport does not imply support for
 * arbitrary caller-supplied ES fields such as the diagnostic experience terms.
 */
export async function searchCoresignalEmployeeIds(
  esDslBody: unknown,
  options: RequestOptions & { itemsPerPage?: number; operationContext: string },
): Promise<CoresignalRegularSearchTransportResult> {
  if (!options.operationContext.trim()) throw new CoresignalProviderError("A Coresignal Search operation context is required.", "invalid_request", 400)
  if (!esDslBody || typeof esDslBody !== "object" || Array.isArray(esDslBody)) throw new CoresignalProviderError("A Coresignal ES-DSL request body is required.", "invalid_request", 400)
  const itemsPerPage = options.itemsPerPage ?? CORESIGNAL_ES_DSL_DEFAULT_ITEMS_PER_PAGE
  if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1 || itemsPerPage > CORESIGNAL_ES_DSL_MAX_ITEMS_PER_PAGE) {
    throw new CoresignalProviderError(`Coresignal ES-DSL items_per_page must be between 1 and ${CORESIGNAL_ES_DSL_MAX_ITEMS_PER_PAGE}.`, "invalid_request", 400)
  }
  const query = new URLSearchParams({ items_per_page: String(itemsPerPage) })
  const providerResponse = await response(`${CORESIGNAL_ES_DSL_SEARCH_PATH}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(esDslBody),
  }, options)
  let body: unknown
  try { body = await providerResponse.json() as unknown } catch { throw new CoresignalProviderError("Coresignal returned an unreadable response.", "invalid_response", 502) }
  return {
    body,
    headers: {
      "x-total-results": providerResponse.headers.get("x-total-results"),
      "x-total-pages": providerResponse.headers.get("x-total-pages"),
      "x-next-page-after": providerResponse.headers.get("x-next-page-after"),
    },
    providerCreditsRemaining: optionalNonNegativeIntegerHeader(providerResponse.headers, "x-credits-remaining"),
    upstreamHttpStatus: providerResponse.status,
  }
}

export function safeCoresignalError(error: unknown) {
  if (error instanceof CoresignalProviderError) return { message: error.message, kind: error.kind, status: error.status, successfulOperationCredits: error.successfulOperationCredits }
  return { message: "Coresignal is temporarily unavailable.", kind: "unavailable" as const, status: 503, successfulOperationCredits: 0 }
}
