import { linkedinProfileIdentifier, normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { providerSecret } from "@/lib/provider-runtime"
import { localLushaV3MockTransportEnabled } from "@/lib/local-development"

const LUSHA_API_BASE = "https://api.lusha.com"

type Fetcher = typeof fetch

export type LushaAccountUsage = {
  used: number | null
  remaining: number | null
  limit: number | null
  creditType: "bulk_credits" | "general"
}

export type LushaContactSearchInput = {
  name: string
  company: string
  linkedinUrl: string
}

export type LushaContactPreview = {
  status: "success" | "no_match" | "review_required"
  returnedCount: number
  identityReason: "PROFILE_URL_MATCH" | "PROFILE_URL_CONFLICT" | "PROFILE_URL_MISSING" | "NO_TRUSTED_INPUT_URL" | "MULTIPLE_RESULTS" | "NO_MATCH"
  contactId: string
  fullName: string
  jobTitle: string
  company: string
  linkedinUrl: string
  emailAvailable: boolean | null
  phoneAvailable: boolean | null
  creditsUsed: number | null
  usageSource: "provider_response" | "unavailable"
}

export type LushaEmailReveal = {
  status: "success" | "no_match" | "review_required"
  email: string
  creditsUsed: number | null
  usageSource: "provider_response" | "unavailable"
}

export type LushaPhoneReveal = {
  status: "success" | "no_match" | "review_required"
  phone: string
  creditsUsed: number | null
  usageSource: "provider_response" | "unavailable"
}

export class LushaProviderError extends Error {
  constructor(message: string, readonly kind: "authentication" | "credit_limit" | "rate_limit" | "timeout" | "invalid_request" | "unavailable") {
    super(message)
    this.name = "LushaProviderError"
  }
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numericValue(value: unknown) {
  const result = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(result) && result >= 0 ? result : null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function responseRecords(body: Record<string, unknown>) {
  const candidates = [body.results, body.data, recordValue(body.data).results, body.contacts]
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate.map(recordValue)
  return []
}

function providerCredits(response: Response, body: Record<string, unknown>) {
  const documentedV3Charge = numericValue(recordValue(body.billing).creditsCharged)
  if (documentedV3Charge !== null && Number.isSafeInteger(documentedV3Charge)) return documentedV3Charge
  for (const name of ["x-credits-used", "x-credits-spent", "x-call-credits-spent", "x-credit-usage", "x-api-credits-used"]) {
    const value = numericValue(response.headers.get(name))
    if (value !== null && Number.isSafeInteger(value)) return value
  }
  const meta = recordValue(body.meta)
  const usage = recordValue(body.usage)
  for (const value of [body.creditsUsed, body.credits_used, meta.creditsUsed, meta.credits_used, usage.creditsUsed, usage.credits_used, usage.credits]) {
    const parsed = numericValue(value)
    if (parsed !== null && Number.isSafeInteger(parsed)) return parsed
  }
  return null
}

function providerMessage(body: Record<string, unknown>) {
  const error = recordValue(body.error)
  return textValue(error.message ?? body.message)
}

function providerError(status: number, body: Record<string, unknown>) {
  const detail = providerMessage(body)
  if (status === 401 || status === 403) return new LushaProviderError("Lusha authentication was rejected. Verify the server-side API key and plan access.", "authentication")
  if (status === 402) return new LushaProviderError("Lusha reported that the account credit limit was reached.", "credit_limit")
  if (status === 429) return new LushaProviderError("Lusha rate-limited the request. Try again later.", "rate_limit")
  if (status >= 400 && status < 500) return new LushaProviderError(detail || "Lusha rejected the request.", "invalid_request")
  return new LushaProviderError("Lusha is temporarily unavailable.", "unavailable")
}

const syntheticContacts = {
  "https://www.linkedin.com/in/ada-demo-only-901/": { id: "mock-v3-901", fullName: "Ada Demo-Only", email: "ada.demo-only@example.test", phone: "+1 202 555 0901" },
  "https://www.linkedin.com/in/bela-demo-only-902/": { id: "mock-v3-902", fullName: "Bela Demo-Only", email: "bela.demo-only@example.test", phone: "+1 202 555 0902" },
  "https://www.linkedin.com/in/mismatch-demo-only-903/": { id: "mock-v3-903", fullName: "Mismatch Demo-Only", email: "mismatch.demo-only@example.test", phone: "+1 202 555 0903" },
} as const

/** Fixed fictional observations; this function never invokes fetch. */
function mockV3Response(path: string, init: RequestInit) {
  const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>
  if (path === "/v3/contacts/search") {
    const input = Array.isArray(body.contacts) ? body.contacts[0] as Record<string, unknown> | undefined : undefined
    const url = textValue(input?.linkedinUrl)
    if (url === "https://www.linkedin.com/in/failure-demo-only-904/") return new Response(JSON.stringify({ error: { message: "Synthetic provider failure" } }), { status: 503 })
    const contact = syntheticContacts[url as keyof typeof syntheticContacts]
    return Response.json({ results: contact ? [{ id: contact.id, fullName: contact.fullName, jobTitle: { title: "Synthetic Manager" }, company: { name: "Fictional Systems" }, socialLinks: { linkedin: url.includes("mismatch-") ? "https://www.linkedin.com/in/unrelated-demo-only/" : url }, has: ["emails", "phones"] }] : [] })
  }
  if (path === "/v3/contacts/enrich") {
    const id = Array.isArray(body.ids) ? body.ids[0] : undefined
    const contact = Object.values(syntheticContacts).find(item => item.id === id)
    const reveal = Array.isArray(body.reveal) ? body.reveal : []
    if (body.waterfallEnabled !== false || reveal.length !== 1 || !["emails", "phones"].includes(String(reveal[0]))) return new Response("{}", { status: 400 })
    return Response.json({ results: contact ? [{ id: contact.id, ...(reveal[0] === "emails" ? { emails: [{ email: contact.email }] } : { phones: [{ number: contact.phone }] }) }] : [] })
  }
  return new Response("{}", { status: 404 })
}

async function lushaRequest(path: string, init: RequestInit, options: { fetcher?: Fetcher; timeoutMs?: number } = {}) {
  if (localLushaV3MockTransportEnabled()) {
    const response = mockV3Response(path, init)
    const body = await response.json() as Record<string, unknown>
    if (!response.ok) throw providerError(response.status, body)
    return { response, body }
  }
  const key = providerSecret("lusha")
  if (!key) throw new LushaProviderError("LUSHA_API_KEY is not configured.", "authentication")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000)
  try {
    const response = await (options.fetcher ?? fetch)(`${LUSHA_API_BASE}${path}`, {
      ...init,
      headers: { api_key: key, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw providerError(response.status, body)
    return { response, body }
  } catch (error) {
    if (error instanceof LushaProviderError) throw error
    if (error instanceof DOMException && error.name === "AbortError") throw new LushaProviderError("Lusha did not respond before the request timed out.", "timeout")
    throw new LushaProviderError("Lusha could not be reached.", "unavailable")
  } finally {
    clearTimeout(timer)
  }
}

export async function searchLushaContact(input: LushaContactSearchInput, options: { fetcher?: Fetcher } = {}): Promise<LushaContactPreview> {
  const linkedinUrl = normalizeProfessionalProfileUrl(input.linkedinUrl)
  const requestedLinkedinId = linkedinProfileIdentifier(linkedinUrl)
  const [firstName, ...surname] = input.name.trim().split(/\s+/)
  const identifier = requestedLinkedinId
    ? { linkedinUrl }
    : { firstName, lastName: surname.join(" "), companyName: input.company.trim() || undefined }
  const { response, body } = await lushaRequest("/v3/contacts/search", {
    method: "POST",
    body: JSON.stringify({ contacts: [identifier] }),
  }, options)
  const results = responseRecords(body)
  const first = results[0]
  const creditsUsed = providerCredits(response, body)
  if (!first) return { status: "no_match", returnedCount: 0, identityReason: "NO_MATCH", contactId: "", fullName: "", jobTitle: "", company: "", linkedinUrl: "", emailAvailable: null, phoneAvailable: null, creditsUsed, usageSource: creditsUsed === null ? "unavailable" : "provider_response" }
  const has = Array.isArray(first.has) ? first.has.map(textValue) : []
  const jobTitle = recordValue(first.jobTitle)
  const company = recordValue(first.company)
  const socialLinks = recordValue(first.socialLinks)
  const contactId = textValue(first.id ?? first.contactId)
  const providerLinkedinUrl = normalizeProfessionalProfileUrl(socialLinks.linkedin ?? first.linkedinUrl)
  const returnedLinkedinId = linkedinProfileIdentifier(providerLinkedinUrl)
  const identityReason = results.length > 1 ? "MULTIPLE_RESULTS"
    : !requestedLinkedinId ? "NO_TRUSTED_INPUT_URL"
    : !returnedLinkedinId ? "PROFILE_URL_MISSING"
    : returnedLinkedinId !== requestedLinkedinId ? "PROFILE_URL_CONFLICT"
    : "PROFILE_URL_MATCH"
  return {
    status: !contactId ? "no_match" : identityReason === "PROFILE_URL_MATCH" ? "success" : "review_required",
    returnedCount: results.length,
    identityReason: contactId ? identityReason : "NO_MATCH",
    contactId,
    fullName: textValue(first.fullName) || [textValue(first.firstName), textValue(first.lastName)].filter(Boolean).join(" "),
    jobTitle: textValue(jobTitle.title ?? first.title),
    company: textValue(company.name ?? first.companyName),
    linkedinUrl: providerLinkedinUrl,
    emailAvailable: has.length ? has.includes("emails") : typeof first.hasEmail === "boolean" ? first.hasEmail : null,
    phoneAvailable: has.length ? has.includes("phones") : typeof first.hasPhone === "boolean" ? first.hasPhone : null,
    creditsUsed,
    usageSource: creditsUsed === null ? "unavailable" : "provider_response",
  }
}

function firstEmail(record: Record<string, unknown>) {
  const emails = Array.isArray(record.emails) ? record.emails.map(recordValue) : []
  return textValue(emails[0]?.email ?? record.email)
}

function firstPhone(record: Record<string, unknown>) {
  const phones = Array.isArray(record.phones) ? record.phones.map(recordValue) : []
  const first = phones[0] ?? {}
  return textValue(first.number ?? first.phone ?? first.phoneNumber ?? first.internationalNumber ?? record.phone ?? record.phoneNumber)
}

export async function revealLushaEmail(contactId: string, options: { fetcher?: Fetcher } = {}): Promise<LushaEmailReveal> {
  if (!contactId.trim()) throw new LushaProviderError("A stable Lusha contact ID is required before email reveal.", "invalid_request")
  const { response, body } = await lushaRequest("/v3/contacts/enrich", {
    method: "POST",
    body: JSON.stringify({ ids: [contactId.trim()], reveal: ["emails"], waterfallEnabled: false }),
  }, options)
  const records = responseRecords(body)
  const first = records[0]
  const identityMatches = records.length === 1 && textValue(first?.id ?? first?.contactId) === contactId.trim()
  const email = identityMatches && first ? firstEmail(first) : ""
  const creditsUsed = providerCredits(response, body)
  return { status: first && !identityMatches ? "review_required" : email ? "success" : "no_match", email, creditsUsed, usageSource: creditsUsed === null ? "unavailable" : "provider_response" }
}

export async function revealLushaPhone(contactId: string, options: { fetcher?: Fetcher } = {}): Promise<LushaPhoneReveal> {
  if (!contactId.trim()) throw new LushaProviderError("A stable Lusha contact ID is required before phone reveal.", "invalid_request")
  const { response, body } = await lushaRequest("/v3/contacts/enrich", {
    method: "POST",
    body: JSON.stringify({ ids: [contactId.trim()], reveal: ["phones"], waterfallEnabled: false }),
  }, options)
  const records = responseRecords(body)
  const first = records[0]
  const identityMatches = records.length === 1 && textValue(first?.id ?? first?.contactId) === contactId.trim()
  const phone = identityMatches && first ? firstPhone(first) : ""
  const creditsUsed = providerCredits(response, body)
  return { status: first && !identityMatches ? "review_required" : phone ? "success" : "no_match", phone, creditsUsed, usageSource: creditsUsed === null ? "unavailable" : "provider_response" }
}

function firstMetric(body: Record<string, unknown>, keys: string[]) {
  const usage = recordValue(body.usage)
  const dataUsage = recordValue(recordValue(body.data).usage)
  const pools = [body, recordValue(body.data), usage, dataUsage, recordValue(usage.bulkCredits), recordValue(dataUsage.bulkCredits)]
  for (const pool of pools) {
    for (const key of keys) {
      const value = numericValue(pool[key])
      if (value !== null) return value
    }
  }
  return null
}

export async function getLushaAccountUsage(options: { fetcher?: Fetcher } = {}): Promise<LushaAccountUsage> {
  const { body } = await lushaRequest("/account/usage", { method: "GET" }, options)
  const usage = recordValue(body.usage)
  const dataUsage = recordValue(recordValue(body.data).usage)
  return {
    used: firstMetric(body, ["used", "creditsUsed", "credits_used"]),
    remaining: firstMetric(body, ["remaining", "creditsRemaining", "credits_remaining", "balance"]),
    limit: firstMetric(body, ["limit", "creditLimit", "credits_limit", "total"]),
    creditType: Object.keys(recordValue(usage.bulkCredits)).length || Object.keys(recordValue(dataUsage.bulkCredits)).length ? "bulk_credits" : "general",
  }
}
