import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

export const BRIGHTDATA_OPERATION = "Known professional profile collection"
export const BRIGHTDATA_CONFIRMATION_TTL_MS = 5 * 60_000
export const BRIGHTDATA_MAX_LIVE_TARGETS = 1
export const BRIGHTDATA_NORMALIZER_VERSION = 2
export const BRIGHTDATA_RAW_RETENTION_DAYS = 90
export const BRIGHTDATA_MAX_RAW_BYTES = 512_000
export const BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY = "brightdata:local-human-trial:one-request"
export const BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION = "brightdata_local_human_trial_attested"
export function humanTrialRequestKey(auditId: number) { return `brightdata:human-trial:${auditId}` }

export type NormalizedBrightProfile = {
  requestedUrl: string; returnedUrl: string; returnedUrlCanonical: string; identityUrlStatus: "MATCH" | "MISMATCH" | "UNVERIFIED"; providerProfileId: string; fullName: string; providerTimestamp: string
  currentCompany: string; currentCompanyId: string; currentTitle: string; roleStartDate: string; location: string
  experience: Array<{ company: string; companyId: string; title: string; startDate: string; endDate: string; current: boolean }>
  education: Array<{ institution: string; degree: string; programme: string; startDate: string; endDate: string; startYear: string; endYear: string }>
}

function text(record: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return ""
}
function records(value: unknown) { return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[] : [] }

export function normalizeBrightLinkedinUrl(value: string) {
  let parsed: URL
  try { parsed = new URL(value.trim()) } catch { throw new Error("Enter a valid HTTPS LinkedIn profile URL.") }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const parts = parsed.pathname.split("/").filter(Boolean)
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !/^(?:linkedin\.com|www\.linkedin\.com|[a-z]{2}\.linkedin\.com)$/.test(hostname) || parts.length !== 2 || parts[0].toLowerCase() !== "in" || !/^[a-z0-9][a-z0-9-]{1,99}$/i.test(parts[1])) throw new Error("Only a public LinkedIn /in/<profile> URL on the main or a two-letter regional host is supported.")
  return `https://www.linkedin.com/in/${parts[1].toLowerCase()}`
}
export function targetFingerprint(profileUrl: string) { return createHash("sha256").update(normalizeBrightLinkedinUrl(profileUrl)).digest("hex") }

export function compareBrightProfileUrls(requestedUrl: string, returnedUrl: string) {
  const canonicalRequestedUrl = normalizeBrightLinkedinUrl(requestedUrl)
  if (!returnedUrl.trim()) return { canonicalRequestedUrl, canonicalReturnedUrl: "", status: "UNVERIFIED" as const }
  try {
    const canonicalReturnedUrl = normalizeBrightLinkedinUrl(returnedUrl)
    return { canonicalRequestedUrl, canonicalReturnedUrl, status: canonicalReturnedUrl === canonicalRequestedUrl ? "MATCH" as const : "MISMATCH" as const }
  } catch { return { canonicalRequestedUrl, canonicalReturnedUrl: "", status: "UNVERIFIED" as const } }
}

export function prepareBrightRawEvidence(raw: Record<string, unknown>, snapshotId: string, datasetId: string, requestedUrl: string, requestedAt: string, retrievedAt: string, normalizedJson: string) {
  const rawJson = JSON.stringify(raw)
  if (Buffer.byteLength(rawJson, "utf8") > BRIGHTDATA_MAX_RAW_BYTES) throw new Error("The Bright Data response exceeds the bounded raw-evidence retention limit.")
  const returnedUrl = text(raw, ["url", "linkedin_url", "profile_url", "input_url"])
  const identity = compareBrightProfileUrls(requestedUrl, returnedUrl)
  const providerTimestampJson = raw.timestamp === undefined ? "" : JSON.stringify(raw.timestamp)
  const retentionUntil = new Date(Date.parse(retrievedAt) + BRIGHTDATA_RAW_RETENTION_DAYS * 86_400_000).toISOString()
  return { provider: "brightdata", snapshotId, datasetId, requestedUrl, returnedUrl, canonicalReturnedUrl: identity.canonicalReturnedUrl, identityUrlStatus: identity.status,
    requestedAt, retrievedAt, providerTimestampJson, normalizerVersion: BRIGHTDATA_NORMALIZER_VERSION, rawJson, rawSha256: createHash("sha256").update(rawJson).digest("hex"), normalizedJson, retentionUntil }
}

type Confirmation = { actorUserId: number; profileUrl: string; alumnusId: number | null; requestKey: string; issuedAt: number; humanTrialAuditId?: number }
function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url") }
function sign(payload: string, secret: string) { return createHmac("sha256", secret).update(payload).digest("base64url") }

export function createBrightConfirmation(input: { actorUserId: number; profileUrl: string; alumnusId?: number | null; humanTrialAuditId?: number }, secret: string, now = Date.now()) {
  if (!secret.trim()) throw new Error("Server confirmation signing is unavailable.")
  const profileUrl = normalizeBrightLinkedinUrl(input.profileUrl)
  if (input.humanTrialAuditId !== undefined && (!Number.isSafeInteger(input.humanTrialAuditId) || input.humanTrialAuditId < 1 || input.alumnusId != null)) throw new Error("Invalid human-trial confirmation target.")
  const confirmation: Confirmation = { actorUserId: input.actorUserId, profileUrl, alumnusId: input.alumnusId ?? null, requestKey: input.humanTrialAuditId ? humanTrialRequestKey(input.humanTrialAuditId) : randomUUID(), issuedAt: now, ...(input.humanTrialAuditId ? { humanTrialAuditId: input.humanTrialAuditId } : {}) }
  const payload = encode(confirmation)
  return { token: `${payload}.${sign(payload, secret)}`, confirmation }
}

export function verifyBrightConfirmation(token: string, expectedActorUserId: number, secret: string, now = Date.now()): Confirmation | null {
  const [payload, supplied] = token.split(".")
  if (!payload || !supplied || !secret.trim()) return null
  const expected = sign(payload, secret)
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Confirmation
    if (value.actorUserId !== expectedActorUserId || now - value.issuedAt > BRIGHTDATA_CONFIRMATION_TTL_MS || now < value.issuedAt) return null
    if (normalizeBrightLinkedinUrl(value.profileUrl) !== value.profileUrl || !value.requestKey) return null
    if (value.humanTrialAuditId !== undefined && (!Number.isSafeInteger(value.humanTrialAuditId) || value.humanTrialAuditId < 1 || value.alumnusId !== null || value.requestKey !== humanTrialRequestKey(value.humanTrialAuditId))) return null
    return value
  } catch { return null }
}

export function normalizeBrightProfile(raw: Record<string, unknown>, requestedUrl: string): NormalizedBrightProfile {
  const experience = records(raw.experience ?? raw.experiences ?? raw.positions)
  const current = experience.find(item => item.is_current === true || item.is_current === 1 || item.current === true) ?? experience.find(item => !text(item, ["end_date", "date_to", "end"]))
  const currentCompany = raw.current_company && typeof raw.current_company === "object" && !Array.isArray(raw.current_company) ? raw.current_company as Record<string, unknown> : undefined
  const normalizedExperience = experience.map(item => ({ company: text(item, ["company", "company_name", "organization_name"]), companyId: text(item, ["company_id", "organization_id"]), title: text(item, ["title", "position"]), startDate: text(item, ["start_date", "date_from", "start"]), endDate: text(item, ["end_date", "date_to", "end"]), current: item.is_current === true || item.is_current === 1 || item.current === true || !text(item, ["end_date", "date_to", "end"]) })).filter(item => item.company || item.title)
  const education = records(raw.education ?? raw.educations).map(item => {
    const startDate = text(item, ["start_date", "date_from", "start_year", "date_from_year"])
    const endDate = text(item, ["end_date", "date_to", "end_year", "date_to_year"])
    return { institution: text(item, ["school", "school_name", "institution", "institution_name", "title"]), degree: text(item, ["degree", "degree_name"]), programme: text(item, ["programme", "program", "field_of_study"]), startDate, endDate,
      startYear: text(item, ["start_year", "date_from_year"]), endYear: text(item, ["end_year", "date_to_year"]) }
  }).filter(item => item.institution || item.degree || item.programme || item.startDate || item.endDate)
  const returnedUrl = text(raw, ["url", "linkedin_url", "profile_url", "input_url"])
  const identity = compareBrightProfileUrls(requestedUrl, returnedUrl)
  return {
    requestedUrl, returnedUrl, returnedUrlCanonical: identity.canonicalReturnedUrl, identityUrlStatus: identity.status, providerProfileId: text(raw, ["id", "profile_id", "linkedin_id"]), fullName: text(raw, ["name", "full_name"]), providerTimestamp: text(raw, ["timestamp"]),
    currentCompany: text(current, ["company", "company_name", "organization_name"]) || text(currentCompany, ["name", "company_name", "title"]) || text(raw, ["current_company_name", "company_name"]),
    currentCompanyId: text(current, ["company_id", "organization_id"]) || text(currentCompany, ["company_id", "id"]) || text(raw, ["current_company_company_id", "current_company_id"]),
    currentTitle: text(current, ["title", "position"]) || text(raw, ["current_title", "title", "position"]), roleStartDate: text(current, ["start_date", "date_from", "start"]) || text(raw, ["current_role_start_date"]),
    location: text(raw, ["location_full", "location_name", "location", "city"]), experience: normalizedExperience, education,
  }
}

export function sanitizedBrightEvidence(profile: NormalizedBrightProfile) {
  const json = JSON.stringify({ schemaVersion: 2, provider: "brightdata", ...profile, education: profile.education.slice(0, 20) })
  if (Buffer.byteLength(json, "utf8") > BRIGHTDATA_MAX_RAW_BYTES) throw new Error("The normalized Bright Data evidence exceeds the bounded retention limit.")
  return json
}

export function brightProfileChanges(profile: NormalizedBrightProfile, canonical: { company: string; title: string; location: string }) {
  return ([
    { field: "company", oldValue: canonical.company, proposedValue: profile.currentCompany },
    { field: "title", oldValue: canonical.title, proposedValue: profile.currentTitle },
    { field: "location", oldValue: canonical.location, proposedValue: profile.location },
  ] as const).filter(item => item.proposedValue && item.proposedValue !== item.oldValue)
}
