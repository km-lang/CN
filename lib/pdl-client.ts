import { FIXED_ALUMNI_SCHOOL, clean } from "@/lib/alumni-search"
import { providerSecret } from "@/lib/provider-runtime"

export type PdlFailureKind = "authentication" | "credit_limit" | "rate_limit" | "timeout" | "unavailable" | "invalid_request" | "invalid_response"

export class PdlProviderError extends Error {
  constructor(message: string, public readonly kind: PdlFailureKind, public readonly status: number) {
    super(message)
  }
}

export type PdlResponse = {
  body: Record<string, unknown>
  creditsUsed: number
  creditType: string
  totalCreditsRemaining: number | null
  status: number
}

function numericHeader(response: Response, name: string) {
  const value = response.headers.get(name)
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function providerMessage(body: Record<string, unknown>) {
  const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : undefined
  return clean(error?.message ?? body.message)
}

function normalizedFailure(response: Response, body: Record<string, unknown>) {
  if (response.status === 401 || response.status === 403) return new PdlProviderError("PDL authentication failed.", "authentication", response.status)
  if (response.status === 402) return new PdlProviderError("The PDL account credit allowance has been reached.", "credit_limit", response.status)
  if (response.status === 429) return new PdlProviderError("PDL rate limit reached. Please retry after the provider window resets.", "rate_limit", response.status)
  if (response.status >= 500) return new PdlProviderError("PDL is temporarily unavailable.", "unavailable", response.status)
  return new PdlProviderError(providerMessage(body) || "PDL rejected the request.", "invalid_request", response.status)
}

export async function pdlGet(url: URL, options: { timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<PdlResponse> {
  const key = providerSecret("pdl")
  if (!key) throw new PdlProviderError("PDL authentication is not configured.", "authentication", 401)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(url.toString(), {
      headers: { "X-Api-Key": key, accept: "application/json" },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new PdlProviderError("PDL request timed out.", "timeout", 504)
    throw new PdlProviderError("PDL is temporarily unavailable.", "unavailable", 503)
  } finally {
    clearTimeout(timeout)
  }
  let body: Record<string, unknown>
  try {
    body = await response.json() as Record<string, unknown>
  } catch {
    throw new PdlProviderError("PDL returned an unreadable response.", "invalid_response", 502)
  }
  if (!response.ok && response.status !== 404) throw normalizedFailure(response, body)
  return {
    body,
    creditsUsed: numericHeader(response, "x-call-credits-spent") ?? 0,
    creditType: response.headers.get("x-call-credits-type") ?? "",
    totalCreditsRemaining: numericHeader(response, "x-totallimit-remaining"),
    status: response.status,
  }
}

export async function cleanIimLucknowSchool(options: { fetcher?: typeof fetch } = {}) {
  const url = new URL("https://api.peopledatalabs.com/v5/school/clean")
  url.searchParams.set("name", FIXED_ALUMNI_SCHOOL)
  const response = await pdlGet(url, { fetcher: options.fetcher })
  if (response.status === 404) throw new PdlProviderError("PDL could not resolve the IIM Lucknow school record.", "invalid_request", 404)
  const id = clean(response.body.id)
  const name = clean(response.body.name)
  if (!id || !name) throw new PdlProviderError("PDL school normalization did not return a canonical ID and name.", "invalid_response", 502)
  return {
    id,
    name,
    linkedinUrl: clean(response.body.linkedin_url),
    website: clean(response.body.website),
    creditsUsed: response.creditsUsed,
    creditType: response.creditType || "school_clean",
    totalCreditsRemaining: response.totalCreditsRemaining,
  }
}

export function safePdlError(error: unknown) {
  if (error instanceof PdlProviderError) return { message: error.message, kind: error.kind, status: error.status }
  return { message: "PDL is temporarily unavailable.", kind: "unavailable" as const, status: 503 }
}
