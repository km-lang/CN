import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

export const BRIGHTDATA_OPERATION = "Known professional profile collection"
export const BRIGHTDATA_CONFIRMATION_TTL_MS = 5 * 60_000
export const BRIGHTDATA_MAX_LIVE_TARGETS = 1

export type NormalizedBrightProfile = {
  requestedUrl: string; returnedUrl: string; providerProfileId: string; fullName: string
  currentCompany: string; currentCompanyId: string; currentTitle: string; roleStartDate: string; location: string
  experience: Array<{ company: string; companyId: string; title: string; startDate: string; endDate: string; current: boolean }>
  education: Array<{ institution: string; degree: string; startYear: string; endYear: string }>
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
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || hostname !== "linkedin.com" || parts.length !== 2 || parts[0].toLowerCase() !== "in" || !/^[a-z0-9][a-z0-9-]{1,99}$/i.test(parts[1])) throw new Error("Only a public https://www.linkedin.com/in/<profile> target is supported.")
  return `https://www.linkedin.com/in/${parts[1]}`
}
export function targetFingerprint(profileUrl: string) { return createHash("sha256").update(normalizeBrightLinkedinUrl(profileUrl)).digest("hex") }

type Confirmation = { actorUserId: number; profileUrl: string; alumnusId: number | null; requestKey: string; issuedAt: number }
function encode(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url") }
function sign(payload: string, secret: string) { return createHmac("sha256", secret).update(payload).digest("base64url") }

export function createBrightConfirmation(input: { actorUserId: number; profileUrl: string; alumnusId?: number | null }, secret: string, now = Date.now()) {
  if (!secret.trim()) throw new Error("Server confirmation signing is unavailable.")
  const profileUrl = normalizeBrightLinkedinUrl(input.profileUrl)
  const confirmation: Confirmation = { actorUserId: input.actorUserId, profileUrl, alumnusId: input.alumnusId ?? null, requestKey: randomUUID(), issuedAt: now }
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
    return value
  } catch { return null }
}

export function normalizeBrightProfile(raw: Record<string, unknown>, requestedUrl: string): NormalizedBrightProfile {
  const experience = records(raw.experience ?? raw.experiences ?? raw.positions)
  const current = experience.find(item => item.is_current === true || item.is_current === 1 || item.current === true) ?? experience.find(item => !text(item, ["end_date", "date_to", "end"]))
  const currentCompany = raw.current_company && typeof raw.current_company === "object" && !Array.isArray(raw.current_company) ? raw.current_company as Record<string, unknown> : undefined
  const normalizedExperience = experience.map(item => ({ company: text(item, ["company", "company_name", "organization_name"]), companyId: text(item, ["company_id", "organization_id"]), title: text(item, ["title", "position"]), startDate: text(item, ["start_date", "date_from", "start"]), endDate: text(item, ["end_date", "date_to", "end"]), current: item.is_current === true || item.is_current === 1 || item.current === true || !text(item, ["end_date", "date_to", "end"]) })).filter(item => item.company || item.title)
  const education = records(raw.education ?? raw.educations).map(item => ({ institution: text(item, ["school", "school_name", "institution", "institution_name"]), degree: text(item, ["degree", "degree_name", "programme", "field_of_study"]), startYear: text(item, ["start_year", "date_from_year", "start_date"]), endYear: text(item, ["end_year", "date_to_year", "end_date"]) })).filter(item => item.institution || item.degree || item.startYear || item.endYear)
  return {
    requestedUrl, returnedUrl: text(raw, ["url", "linkedin_url", "profile_url", "input_url"]), providerProfileId: text(raw, ["id", "profile_id", "linkedin_id"]), fullName: text(raw, ["name", "full_name"]),
    currentCompany: text(current, ["company", "company_name", "organization_name"]) || text(currentCompany, ["name", "company_name", "title"]) || text(raw, ["current_company_name", "company_name"]),
    currentCompanyId: text(current, ["company_id", "organization_id"]) || text(currentCompany, ["company_id", "id"]) || text(raw, ["current_company_company_id", "current_company_id"]),
    currentTitle: text(current, ["title", "position"]) || text(raw, ["current_title", "title", "position"]), roleStartDate: text(current, ["start_date", "date_from", "start"]) || text(raw, ["current_role_start_date"]),
    location: text(raw, ["location_full", "location_name", "location", "city"]), experience: normalizedExperience, education,
  }
}

export function sanitizedBrightEvidence(profile: NormalizedBrightProfile) { return JSON.stringify({ schemaVersion: 1, provider: "brightdata", ...profile, education: profile.education.slice(0, 20) }).slice(0, 50_000) }
