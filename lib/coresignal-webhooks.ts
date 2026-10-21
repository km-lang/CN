import { isLoopbackHost, localDevelopmentAuthEnabled } from "@/lib/local-development"

export const CORESIGNAL_EXPERIENCE_IDS_PATH = "/cdapi/v2/subscriptions/experience_changes/employee_base/ids"
export const CORESIGNAL_SUBSCRIPTIONS_PATH = "/cdapi/v2/subscriptions"
// The current account dashboard prices a full Employee record at 20 credits.
// Reserve the full-record ceiling because the Collect request selects no bundles.
export const CORESIGNAL_COLLECT_ESTIMATED_CREDITS = 20
export const WEBHOOK_BATCH_LIMIT = 100
export const WEBHOOK_BODY_LIMIT = 64 * 1024
export type WebhookChangeType = "changed" | "started_matching_query" | "stopped_matching_query"
export type WebhookIdentityRow = { id: number; coresignalEmployeeId: string; intakeStatus: string; profileMatch: string; linkedinUrl: string }
export type IdentityAttestation = { alumnusId: number; employeeId: string; namespace: string; status: string }
export type CoverageRow = { alumnusId: number; employeeId: string }

export function webhookMockEnabled(values: NodeJS.ProcessEnv = process.env) {
  return localDevelopmentAuthEnabled(values)
    && values.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && isLoopbackHost(values.LOCAL_CORESIGNAL_LIVE_DEMO_HOST)
    && Boolean(values.LOCAL_DEV_D1_PERSIST_PATH?.trim())
    && values.CORESIGNAL_WEBHOOK_MOCK_TRANSPORT === "true"
}

export function classifyWebhookMembers(ids: number[], people: WebhookIdentityRow[], attestations: IdentityAttestation[], covered: CoverageRow[]) {
  const byId = new Map(people.map(person => [person.id, person]))
  const byAttestation = new Map(attestations.map(row => [row.alumnusId, row]))
  const coveredIds = new Set(covered.map(row => row.employeeId))
  return [...new Set(ids)].map(alumnusId => {
    const person = byId.get(alumnusId)
    const attestation = byAttestation.get(alumnusId)
    const employeeId = person?.coresignalEmployeeId.trim() ?? ""
    let status: "ELIGIBLE" | "PENDING_PROVIDER_MAPPING" | "IDENTITY_REVIEW_REQUIRED" | "ALREADY_COVERED"
    if (!person || person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") status = "IDENTITY_REVIEW_REQUIRED"
    else if (!/^\d{1,18}$/.test(employeeId) || !attestation) status = "PENDING_PROVIDER_MAPPING"
    else if (attestation.employeeId !== employeeId || attestation.namespace !== "employee_base" || attestation.status !== "VERIFIED") status = "IDENTITY_REVIEW_REQUIRED"
    else status = coveredIds.has(employeeId) ? "ALREADY_COVERED" : "ELIGIBLE"
    return { alumnusId, employeeId, status }
  })
}

export function coverageReconciliation(intended: string[], current: string[]) {
  const wanted = new Set(intended)
  const existing = new Set(current)
  return {
    add: [...wanted].filter(id => !existing.has(id)).sort(),
    remove: [...existing].filter(id => !wanted.has(id)).sort(),
    unchanged: [...wanted].filter(id => existing.has(id)).sort(),
  }
}

export type WebhookNotice = { employeeId: string; changeType: WebhookChangeType; changedFields: string[]; providerAt: string; eventId: string }
export function parseWebhookNotices(value: unknown): WebhookNotice[] {
  const records = Array.isArray(value) ? value : [value]
  if (!records.length || records.length > WEBHOOK_BATCH_LIMIT) throw new Error("Webhook batch size is invalid.")
  return records.map(record => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Webhook event must be an object.")
    const item = record as Record<string, unknown>
    const employeeId = String(item.member_id ?? "")
    const changeType = item.change_type ?? item.status
    if (!/^\d{1,18}$/.test(employeeId) || !["changed", "started_matching_query", "stopped_matching_query"].includes(String(changeType))) throw new Error("Unsupported webhook event identity or type.")
    const changedFields = item.changed_fields === undefined ? [] : item.changed_fields
    if (!Array.isArray(changedFields) || changedFields.length > 50 || changedFields.some(field => typeof field !== "string" || field.length > 120)) throw new Error("Invalid changed_fields list.")
    const providerAt = typeof item.event_at === "string" && !Number.isNaN(Date.parse(item.event_at)) ? item.event_at.slice(0, 50) : ""
    const eventId = typeof item.event_id === "string" && item.event_id.length <= 128 ? item.event_id : ""
    return { employeeId, changeType: changeType as WebhookChangeType, changedFields, providerAt, eventId }
  })
}

function toHex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("") }
export async function sha256(value: string) { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))) }

export async function callbackToken(subscriptionId: number, secret: string) {
  if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 1 || secret.length < 32) throw new Error("Webhook callback secret is not configured securely.")
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`coresignal-experience-v1:${subscriptionId}`)))
}

export async function callbackAuthorized(subscriptionId: number, provided: string, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false
  const expected = await callbackToken(subscriptionId, secret)
  let difference = 0
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index)
  return difference === 0
}

export function renewalDue(createdAt: string, expiresAt: string, now = new Date()) {
  const created = Date.parse(createdAt)
  const expires = Date.parse(expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return false
  const oneYear = new Date(created); oneYear.setUTCFullYear(oneYear.getUTCFullYear() + 1)
  return expires > now.getTime() && expires - now.getTime() <= 30 * 86_400_000 && expires + 91 * 86_400_000 <= oneYear.getTime()
}

export function effectiveSubscriptionStatus(status: string, activatedAt: string, expiresAt: string, now = new Date()) {
  if (status !== "ACTIVE") return status
  const expiry = Date.parse(expiresAt)
  if (Number.isFinite(expiry) && expiry <= now.getTime()) return "EXPIRED"
  return renewalDue(activatedAt, expiresAt, now) ? "RENEWAL_DUE" : status
}
