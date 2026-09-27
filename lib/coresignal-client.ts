import { providerSecret } from "@/lib/provider-runtime"
import { coresignalProgrammeQuery, providerEducationDateTo } from "@/lib/discovery-qualification"
import type { DirectoryFilters } from "@/lib/alumni-search"

export const CORESIGNAL_API_BASE = "https://api.coresignal.com"
export const CORESIGNAL_IIML_INSTITUTION_URL = "https://www.linkedin.com/school/indian-institute-of-management-lucknow"
export const CORESIGNAL_SEARCH_PATH = "/cdapi/v2/employee_base/search/filter/preview"
export const CORESIGNAL_COLLECT_PATH = "/cdapi/v2/employee_base/collect"

export type CoresignalFailureKind = "authentication" | "rate_limit" | "timeout" | "unavailable" | "invalid_request" | "invalid_response"

export class CoresignalProviderError extends Error {
  constructor(message: string, public readonly kind: CoresignalFailureKind, public readonly status: number, public readonly successfulOperationCredits = 0) { super(message) }
}

export function coresignalSearchContract(filters?: Pick<DirectoryFilters, "discoveryProgrammes" | "alumniStatus" | "batch">, now: Date = new Date()) {
  const programmeQuery = coresignalProgrammeQuery(filters?.discoveryProgrammes ?? [])
  return {
    method: "POST" as const,
    path: CORESIGNAL_SEARCH_PATH,
    body: {
      education_institution_professional_network_url: CORESIGNAL_IIML_INSTITUTION_URL,
      active_experience: true,
      ...(programmeQuery ? { education_program_name: programmeQuery } : {}),
      ...(filters?.batch ? { education_date_to: filters.batch } : filters?.alumniStatus === "Past alumni only" ? { education_date_to: providerEducationDateTo(now) } : {}),
    },
  }
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

async function request(path: string, init: RequestInit, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  const key = providerSecret("coresignal")
  if (!key) throw new CoresignalProviderError("Coresignal authentication is not configured.", "authentication", 401)
  const controller = new AbortController()
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
  } finally { clearTimeout(timeout) }
  if (!response.ok) throw failure(response.status)
  try { return await response.json() as unknown } catch { throw new CoresignalProviderError("Coresignal returned an unreadable response.", "invalid_response", 502) }
}

export function searchCoresignalIiml(options: { fetcher?: typeof fetch; timeoutMs?: number; filters?: DirectoryFilters; now?: Date } = {}) {
  const contract = coresignalSearchContract(options.filters, options.now)
  return request(contract.path, { method: contract.method, headers: { "content-type": "application/json" }, body: JSON.stringify(contract.body) }, options)
}

export function collectCoresignalEmployee(employeeId: string, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  if (!employeeId.trim()) throw new CoresignalProviderError("A stable Coresignal employee ID is required.", "invalid_request", 400)
  const contract = coresignalCollectContract(employeeId)
  return request(contract.path, { method: contract.method }, options)
}

export function safeCoresignalError(error: unknown) {
  if (error instanceof CoresignalProviderError) return { message: error.message, kind: error.kind, status: error.status, successfulOperationCredits: error.successfulOperationCredits }
  return { message: "Coresignal is temporarily unavailable.", kind: "unavailable" as const, status: 503, successfulOperationCredits: 0 }
}
