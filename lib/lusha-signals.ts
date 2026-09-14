import { providerSecret, signalsRuntimeStatus } from "@/lib/provider-runtime"

export const LUSHA_CONTACT_SIGNALS_ENDPOINT = "https://api.lusha.com/api/signals/contacts"
export const CONTACT_SIGNAL_TYPES = ["promotion", "companyChange"] as const

export type NormalizedProfessionalSignal = {
  eventKey: string
  alumnusId: number
  eventSubtype: "Promotion" | "Company Change"
  previousCompany: string
  previousRole: string
  newCompany: string
  newRole: string
  providerEventAt: string
  detectedAt: string
  sourceConfidence: string
  sourceStatus: string
  providerReferenceId: string
  title: string
  description: string
}

type SignalInput = { alumnusId: number; lushaPersonId: string }
type Fetcher = typeof fetch

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

export function defaultSignalsStartDate(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()))
  return start.toISOString().slice(0, 10)
}

export function providerReportedSignalCredits(body: Record<string, unknown>) {
  return typeof body.creditCharged === "number" && Number.isInteger(body.creditCharged) && body.creditCharged >= 0
    ? body.creditCharged
    : null
}

export function normalizeLushaSignals(alumnusId: number, body: Record<string, unknown>, detectedAt = new Date().toISOString(), lushaPersonId = "") {
  const contacts = record(body.contacts)
  const contact = record(lushaPersonId ? contacts[lushaPersonId] : Object.values(contacts)[0])
  const providerPersonId = text(contact.personId) || lushaPersonId
  const normalized: NormalizedProfessionalSignal[] = []
  const signalGroups: Array<{ subtype: "Promotion" | "Company Change"; values: unknown[] }> = [
    { subtype: "Promotion", values: array(contact.promotion) },
    { subtype: "Company Change", values: array(contact.companyChange) },
  ]

  for (const group of signalGroups) {
    for (const itemValue of group.values) {
      const item = record(itemValue)
      const providerReferenceId = text(item.id ?? item.signalId ?? item.eventId)
      const providerEventAt = text(item.signalDate ?? item.occurredAt ?? item.eventDate ?? item.timestamp ?? item.date)
      const previousCompany = text(item.previousCompanyName ?? item.previousCompany)
      const previousRole = text(item.previousTitle ?? item.previousRole)
      const newCompany = text(item.currentCompanyName ?? item.currentCompany)
      const newRole = text(item.currentTitle ?? item.newTitle ?? item.newRole)
      const stable = providerReferenceId || [providerPersonId, group.subtype, providerEventAt, previousCompany, previousRole, newCompany, newRole].join(":").toLowerCase()
      normalized.push({
        eventKey: `lusha-signal:${stable}`,
        alumnusId,
        eventSubtype: group.subtype,
        previousCompany,
        previousRole,
        newCompany,
        newRole,
        providerEventAt,
        detectedAt,
        sourceConfidence: text(item.confidence ?? item.confidenceStatus) || "Provider reported",
        sourceStatus: text(item.status) || "Detected",
        providerReferenceId: providerReferenceId || providerPersonId,
        title: group.subtype === "Promotion" ? "Professional promotion detected" : "Company change detected",
        description: [previousRole && previousCompany ? `${previousRole} at ${previousCompany}` : previousRole || previousCompany, newRole && newCompany ? `${newRole} at ${newCompany}` : newRole || newCompany].filter(Boolean).join(" → ") || "Professional change reported by Lusha Signals.",
      })
    }
  }
  return normalized
}

function providerError(status: number) {
  if (status === 401) return "Lusha rejected the API key for Professional Signals."
  if (status === 403) return "Professional Signals are not enabled for this Lusha account."
  if (status === 400 || status === 404 || status === 422) return "Lusha rejected the stored contact ID for Professional Signals."
  if (status === 429) return "Lusha Professional Signals rate limit reached. Do not retry immediately."
  if (status >= 500) return "Lusha Professional Signals is temporarily unavailable."
  return "Lusha Professional Signals could not be retrieved."
}

export async function fetchLushaContactSignals(inputs: SignalInput[], options: { fetcher?: Fetcher; startDate?: string } = {}) {
  const runtime = signalsRuntimeStatus()
  if (!runtime.liveEnabled || runtime.entitlement !== "confirmed") throw new Error("Lusha Signals is not enabled until account entitlement is manually confirmed.")
  const key = providerSecret("lusha")
  if (!key) throw new Error("Lusha is not configured.")
  if (inputs.length !== 1 || !inputs[0].lushaPersonId.trim()) throw new Error("Exactly one alumnus with a stable Lusha contact ID is required.")
  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(LUSHA_CONTACT_SIGNALS_ENDPOINT, {
      method: "POST",
      headers: { api_key: key, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ contacts: [{ id: inputs[0].lushaPersonId }], signals: [...CONTACT_SIGNAL_TYPES], startDate: options.startDate ?? defaultSignalsStartDate() }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new Error("Lusha Professional Signals request timed out.")
    throw new Error("Lusha Professional Signals is unavailable.")
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(providerError(response.status))
  if (!("contacts" in body) || !body.contacts || typeof body.contacts !== "object" || Array.isArray(body.contacts)) throw new Error("Lusha Professional Signals returned a malformed response.")
  return body
}
