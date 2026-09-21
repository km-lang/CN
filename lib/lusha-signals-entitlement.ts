import { providerSecret } from "@/lib/provider-runtime"

export const LUSHA_CONTACT_SIGNAL_TYPES_ENDPOINT = "https://api.lusha.com/v3/contacts/signals/types"

export type SignalsEntitlementResult = {
  entitlement: "confirmed" | "not_entitled" | "unknown"
  outcome: "authorized" | "entitlement_denied" | "authentication_error" | "provider_error" | "timeout" | "malformed_response" | "key_missing"
  httpStatus: number | null
  signalTypes: string[]
  promotionAvailable: boolean
  companyChangeAvailable: boolean
  providerReportedCredits: number | null
  checkedAt: string
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function credits(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function reportedCredits(response: Response, body: Record<string, unknown>): number | null {
  for (const header of ["x-credits-used", "x-credits-spent", "x-call-credits-spent", "x-credit-usage", "x-api-credits-used"]) {
    const value = credits(response.headers.get(header))
    if (value !== null) return value
  }
  const billing = object(body.billing)
  const usage = object(body.usage)
  for (const value of [billing.creditsCharged, body.creditsUsed, body.credits_used, usage.creditsUsed, usage.credits_used]) {
    const parsed = credits(value)
    if (parsed !== null) return parsed
  }
  return null
}

export async function validateLushaSignalsEntitlement(options: { fetcher?: typeof fetch; apiKey?: string } = {}): Promise<SignalsEntitlementResult> {
  const checkedAt = new Date().toISOString()
  const base: SignalsEntitlementResult = {
    entitlement: "unknown", outcome: "provider_error", httpStatus: null,
    signalTypes: [], promotionAvailable: false, companyChangeAvailable: false,
    providerReportedCredits: null, checkedAt,
  }
  const key = options.apiKey ?? providerSecret("lusha")
  if (!key?.trim()) return { ...base, outcome: "key_missing" }

  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(LUSHA_CONTACT_SIGNAL_TYPES_ENDPOINT, {
      method: "GET",
      headers: { api_key: key, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    return { ...base, outcome: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "provider_error" }
  }

  // Never echo provider error bodies: they can contain arbitrary text or credentials.
  if (!response.ok) return {
    ...base, httpStatus: response.status,
    entitlement: response.status === 403 ? "not_entitled" : "unknown",
    outcome: response.status === 403 ? "entitlement_denied" : response.status === 401 ? "authentication_error" : "provider_error",
  }
  let body: Record<string, unknown>
  try {
    body = object(await response.json())
  } catch {
    return { ...base, httpStatus: response.status, outcome: "malformed_response" }
  }
  const providerReportedCredits = reportedCredits(response, body)
  if (!Array.isArray(body.signalTypes) || !body.signalTypes.length || !body.signalTypes.every(type => typeof type === "string")) {
    return { ...base, httpStatus: response.status, outcome: "malformed_response", providerReportedCredits }
  }
  // Expose only the documented contact type names, never arbitrary provider text.
  const signalTypes = body.signalTypes.filter(type => type === "allSignals" || type === "promotion" || type === "companyChange")
  const promotionAvailable = signalTypes.includes("promotion")
  const companyChangeAvailable = signalTypes.includes("companyChange")
  return {
    ...base, httpStatus: response.status, signalTypes, promotionAvailable, companyChangeAvailable, providerReportedCredits,
    entitlement: promotionAvailable && companyChangeAvailable ? "confirmed" : "unknown",
    outcome: promotionAvailable && companyChangeAvailable ? "authorized" : "malformed_response",
  }
}
