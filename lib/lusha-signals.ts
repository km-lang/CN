import { providerSecret, signalsRuntimeStatus } from "@/lib/provider-runtime"

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

export function normalizeLushaSignals(alumnusId: number, body: Record<string, unknown>, detectedAt = new Date().toISOString()) {
  const containers = [body.results, body.data, record(body.data).results, body.signals]
  const raw = containers.find(Array.isArray) ?? []
  const normalized: NormalizedProfessionalSignal[] = []
  for (const itemValue of array(raw)) {
    const item = record(itemValue)
    const type = text(item.type ?? item.signalType ?? item.eventType).toLowerCase()
    const subtype = /promot/.test(type) ? "Promotion" : /job|company|move|change/.test(type) ? "Company Change" : null
    if (!subtype) continue
    const previous = record(item.previous ?? item.from)
    const next = record(item.current ?? item.new ?? item.to)
    const providerReferenceId = text(item.id ?? item.signalId ?? item.eventId)
    const providerEventAt = text(item.occurredAt ?? item.eventDate ?? item.timestamp ?? item.date)
    const previousCompany = text(previous.company ?? item.previousCompany)
    const previousRole = text(previous.title ?? previous.role ?? item.previousRole)
    const newCompany = text(next.company ?? item.newCompany)
    const newRole = text(next.title ?? next.role ?? item.newRole)
    const stable = providerReferenceId || [alumnusId, subtype, providerEventAt, newCompany, newRole].join(":").toLowerCase()
    normalized.push({
      eventKey: `lusha-signal:${stable}`,
      alumnusId,
      eventSubtype: subtype,
      previousCompany,
      previousRole,
      newCompany,
      newRole,
      providerEventAt,
      detectedAt,
      sourceConfidence: text(item.confidence ?? item.confidenceStatus) || "Provider reported",
      sourceStatus: text(item.status) || "Detected",
      providerReferenceId,
      title: subtype === "Promotion" ? "Professional promotion detected" : "Company change detected",
      description: [previousRole && previousCompany ? `${previousRole} at ${previousCompany}` : previousRole || previousCompany, newRole && newCompany ? `${newRole} at ${newCompany}` : newRole || newCompany].filter(Boolean).join(" → ") || "Professional change reported by Lusha Signals.",
    })
  }
  return normalized
}

export async function fetchLushaContactSignals(inputs: SignalInput[], options: { fetcher?: Fetcher } = {}) {
  const runtime = signalsRuntimeStatus()
  if (!runtime.liveEnabled || runtime.entitlement !== "confirmed") throw new Error("Lusha Signals is not enabled until account entitlement is manually confirmed.")
  const key = providerSecret("lusha")
  if (!key) throw new Error("Lusha is not configured.")
  const response = await (options.fetcher ?? fetch)("https://api.lusha.com/v3/contacts/signals", {
    method: "POST",
    headers: { api_key: key, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ contacts: inputs.map(item => ({ id: item.lushaPersonId })), signalTypes: ["promotion", "job_change"] }),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Lusha Signals entitlement or authentication was rejected." : "Lusha Signals could not be retrieved.")
  return body
}
