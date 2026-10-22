import { createHmac, timingSafeEqual } from "node:crypto"

import { deserializeCoresignalSearchEvidence, type CoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"
import { CORESIGNAL_COLLECT_ESTIMATED_CREDITS } from "@/lib/coresignal-webhooks"
import type { CoresignalCollectEntitlement } from "@/lib/provider-runtime"

export const CORESIGNAL_COLLECT_OPERATION = "Base Employee Collect-only"
export const CORESIGNAL_COLLECT_EVIDENCE_MARKER = "\n\n[coresignal-collect-evidence:v1]\n"
export const CORESIGNAL_COLLECT_EVIDENCE_VERSION = 1
export const CORESIGNAL_COLLECT_CONFIRMATION_TTL_MS = 5 * 60_000

/** A response may have been billed even when its body or persistence cannot be used. */
export function collectFailureRequiresReconciliation(error: unknown, providerResponseReceived: boolean) {
  if (providerResponseReceived) return true
  const failure = error && typeof error === "object" ? error as { status?: unknown; kind?: unknown } : null
  return !(typeof failure?.status === "number"
    && [400, 401, 402, 403, 404, 422, 429].includes(failure.status)
    && ["authentication", "insufficient_credits", "invalid_request", "rate_limit"].includes(String(failure.kind)))
}
export const CORESIGNAL_COLLECT_CLAIM_SQL = `
  INSERT INTO provider_response_history
    (provider, alumnus_name, search_id, operation, mode, status, credits_used, application_units, provider_reported_credits, usage_state, result_count, request_summary, response_summary, error_message, requested_by)
  SELECT 'coresignal', 'Unresolved Coresignal candidate', ?, ?, ?, 'in_progress', 0, ?, NULL, 'reconciliation_required', 0, ?, ?, '', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_response_history
    WHERE provider = 'coresignal' AND operation = ? AND request_summary = ?
  )
    AND ? + coalesce((SELECT sum(application_units) FROM provider_response_history WHERE provider='coresignal' AND datetime(created_at)>=datetime(?)),0)
      <= coalesce((SELECT monthly_credit_limit FROM provider_settings WHERE provider='coresignal'),25)
  RETURNING id
`
export const CORESIGNAL_KNOWN_COLLECT_CLAIM_SQL = `
  INSERT INTO provider_response_history
    (provider, alumnus_id, alumnus_name, operation, mode, status, credits_used, application_units, provider_reported_credits, usage_state, result_count, request_summary, response_summary, error_message, requested_by)
  SELECT 'coresignal', ?, ?, ?, ?, 'in_progress', 0, ?, NULL, 'reconciliation_required', 0, ?, ?, '', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_response_history
    WHERE provider = 'coresignal' AND operation = ? AND request_summary = ?
  )
    AND ? + coalesce((SELECT sum(application_units) FROM provider_response_history WHERE provider='coresignal' AND datetime(created_at)>=datetime(?)),0)
      <= coalesce((SELECT monthly_credit_limit FROM provider_settings WHERE provider='coresignal'),25)
  RETURNING id
`

export type CollectQuality = "PRESENT_AND_PLAUSIBLE" | "PRESENT_BUT_CONFLICTING" | "MISSING" | "UNSUPPORTED" | "NOT_INDEPENDENTLY_VERIFIED"

export type RetainedSearchCandidate = {
  searchHistoryId: number
  searchOperation: "Base Employee ES-DSL Search" | "Known alumnus identity"
  searchTimestamp: string
  employeeId: string
  identityResolutionStatus: "IDENTITY_RESOLUTION_REQUIRED" | "KNOWN_ALUMNUS"
  sourceAlumnusId?: number
  sourceWebhookEventId?: number
  institutionId: number
  graduationYear: number | null
  company: string | null
  mappedCompanyId: number | null
  priorCollectStatus: string | null
}

export type CollectRuntimeState = {
  configured: boolean
  providerLiveMode: boolean
  transportMode: "live" | "mock"
  collectGateEnabled: boolean
  entitlement: CoresignalCollectEntitlement
  applicationUnitsRemaining: number
  maximumRequests: 1
}

export type CollectPreflight = {
  candidate: RetainedSearchCandidate
  runtime: CollectRuntimeState
  allowed: boolean
  blockers: string[]
  safeguards: {
    searchRequests: 0
    previewRequests: 0
    collectRequestMaximum: 1
    retries: 0
    pagination: false
    automaticIdentityAttachment: false
    automaticCanonicalUpdate: false
  }
}

export type SanitizedCollectEvidence = {
  schemaVersion: 1
  sourceSearchHistoryId: number
  targetEmployeeId: string
  attemptId: string
  upstreamHttpStatus: 200
  returnedEmployeeId: string
  identity: { name: string; professionalProfileUrl: string; quality: CollectQuality }
  education: readonly { institutionId: string; institution: string; programme: string; startYear: number | null; endYear: number | null }[]
  employment: readonly { companyId: string; company: string; title: string; startDate: string; endDate: string; current: boolean }[]
  location: string
  freshness: { checkedAt: string; updatedAt: string; quality: CollectQuality }
  quality: {
    identity: CollectQuality
    education: CollectQuality
    graduationYear: CollectQuality
    currentEmployer: CollectQuality
    currentDesignation: CollectQuality
    employmentHistory: CollectQuality
    location: CollectQuality
    freshnessEvidence: CollectQuality
  }
  reviewState: "REVIEW_REQUIRED" | "NO_CHANGE"
  applicationAccounting: { applicationUnits: number; maximumAuthorizedProviderCredits: number; confirmedDebit: null }
  providerCreditsRemaining: number | null
  providerActions: { searchRequests: 0; previewRequests: 0; collectRequests: 1; retries: 0; pagination: false; canonicalMutations: 0; identityAttachments: 0 }
  audit: { requestedAt: string; completedAt: string; durationMs: number; provenance: "provider_response_history" }
}

export type PresentedCoresignalCollectEvidence =
  | { state: "RETAINED"; evidence: SanitizedCollectEvidence }
  | { state: "UNAVAILABLE"; reason: string }

export function candidateFromSearchHistory(row: { id: number; provider: string; operation: string; mode: string; status: string; responseSummary: string; createdAt: string }, employeeId: string, priorCollectStatus: string | null): RetainedSearchCandidate {
  if (row.provider !== "coresignal" || row.operation !== "Base Employee ES-DSL Search" || row.mode !== "live" || row.status !== "success") throw new Error("The source operation is not an eligible successful live Coresignal Search.")
  const retained = deserializeCoresignalSearchEvidence(row.responseSummary)
  if (!retained) throw new Error("The source Search does not contain supported retained Employee ID evidence.")
  const normalizedId = normalizeEmployeeId(employeeId)
  const route = retained.evidence.identityRoutes.find(item => item.employeeId === normalizedId)
  if (!retained.evidence.employeeIds.includes(normalizedId) || !route) throw new Error("The requested Employee ID is absent from the retained Search evidence.")
  if (route.routingState !== "IDENTITY_RESOLUTION_REQUIRED" || route.mappedAlumnusId !== null) throw new Error("The retained Employee ID is already resolved or has conflicting identity evidence.")
  return {
    searchHistoryId: row.id,
    searchOperation: "Base Employee ES-DSL Search",
    searchTimestamp: row.createdAt,
    employeeId: normalizedId,
    identityResolutionStatus: "IDENTITY_RESOLUTION_REQUIRED",
    institutionId: retained.evidence.searchParameters.institutionId,
    graduationYear: retained.evidence.searchParameters.graduationYear,
    company: retained.evidence.searchParameters.company,
    mappedCompanyId: retained.evidence.searchParameters.mappedCompanyId,
    priorCollectStatus,
  }
}

export function candidateFromKnownAlumnus(person: { id: number; coresignalEmployeeId: string; createdAt: string }, priorCollectStatus: string | null): RetainedSearchCandidate {
  if (!Number.isSafeInteger(person.id) || person.id < 1) throw new Error("A saved alumnus is required.")
  return {
    searchHistoryId: 0,
    searchOperation: "Known alumnus identity",
    searchTimestamp: person.createdAt,
    employeeId: normalizeEmployeeId(person.coresignalEmployeeId),
    identityResolutionStatus: "KNOWN_ALUMNUS",
    sourceAlumnusId: person.id,
    institutionId: 0,
    graduationYear: null,
    company: null,
    mappedCompanyId: null,
    priorCollectStatus,
  }
}

export function knownAlumnusCollectChanges(person: { coresignalEmployeeId: string; linkedinUrl: string; company: string; title: string; location: string }, evidence: SanitizedCollectEvidence) {
  if (person.coresignalEmployeeId !== evidence.returnedEmployeeId) return { outcome: "IDENTITY_CONFLICT" as const, changes: [] }
  const storedUrlId = linkedinProfileIdentifier(person.linkedinUrl)
  const returnedUrlId = linkedinProfileIdentifier(evidence.identity.professionalProfileUrl)
  if (storedUrlId && returnedUrlId && storedUrlId !== returnedUrlId) return { outcome: "IDENTITY_CONFLICT" as const, changes: [] }
  const current = evidence.employment.filter(position => position.current)
  if (current.length !== 1 || !current[0].company || !current[0].title) return { outcome: "INSUFFICIENT_CURRENT_ROLE" as const, changes: [] }
  const fields = current.length === 1 ? [
    { field: "company", oldValue: person.company, proposedValue: current[0].company },
    { field: "title", oldValue: person.title, proposedValue: current[0].title },
  ] : []
  fields.push({ field: "location", oldValue: person.location, proposedValue: evidence.location })
  const changes = fields.filter(item => item.proposedValue && item.proposedValue !== item.oldValue)
  return { outcome: changes.length ? "CHANGES_PROPOSED" as const : "NO_CHANGE" as const, changes }
}

export function collectPreflight(candidate: RetainedSearchCandidate, runtime: CollectRuntimeState): CollectPreflight {
  const blockers: string[] = []
  if (candidate.priorCollectStatus) blockers.push(`A Collect attempt already exists for this retained candidate (${candidate.priorCollectStatus}).`)
  if (!runtime.configured) blockers.push("Coresignal server authentication is not configured.")
  if (runtime.transportMode === "live" && !runtime.providerLiveMode) blockers.push("Coresignal live mode is disabled.")
  if (!runtime.collectGateEnabled) blockers.push("The independent Collect execution gate is disabled.")
  if (runtime.entitlement === "unknown") blockers.push("The account-specific Base Employee Collect entitlement is unknown.")
  if (runtime.entitlement === "not_entitled") blockers.push("The configured account is not entitled to Base Employee Collect.")
  if (runtime.applicationUnitsRemaining < CORESIGNAL_COLLECT_ESTIMATED_CREDITS) blockers.push(`The Coresignal application allowance has fewer than ${CORESIGNAL_COLLECT_ESTIMATED_CREDITS} units available for this full-record Collect.`)
  return {
    candidate,
    runtime,
    allowed: blockers.length === 0,
    blockers,
    safeguards: { searchRequests: 0, previewRequests: 0, collectRequestMaximum: 1, retries: 0, pagination: false, automaticIdentityAttachment: false, automaticCanonicalUpdate: false },
  }
}

export function createCollectConfirmation(input: { searchHistoryId: number; employeeId: string; searchAttemptId: string; now?: number; nonce?: string }, secret: string) {
  if (!secret.trim()) throw new Error("A server-side confirmation secret is required.")
  const expiresAt = (input.now ?? Date.now()) + CORESIGNAL_COLLECT_CONFIRMATION_TTL_MS
  const payload = [input.searchHistoryId, normalizeEmployeeId(input.employeeId), input.searchAttemptId, input.nonce ?? crypto.randomUUID(), expiresAt].join(":")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${Buffer.from(payload).toString("base64url")}.${signature}`
}

export function verifyCollectConfirmation(token: string, expected: { searchHistoryId: number; employeeId: string; searchAttemptId: string; now?: number }, secret: string) {
  const [encoded, supplied] = token.split(".")
  if (!encoded || !supplied || !secret.trim()) return false
  let payload = ""
  try { payload = Buffer.from(encoded, "base64url").toString("utf8") } catch { return false }
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url")
  const left = Buffer.from(supplied); const right = Buffer.from(expectedSignature)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false
  const [searchHistoryId, employeeId, attemptId, nonce, expiresAt] = payload.split(":")
  return Number(searchHistoryId) === expected.searchHistoryId
    && employeeId === normalizeEmployeeId(expected.employeeId)
    && attemptId === expected.searchAttemptId
    && Boolean(nonce)
    && Number(expiresAt) >= (expected.now ?? Date.now())
}

export function sanitizeCollectResponse(input: { body: unknown; candidate: RetainedSearchCandidate; attemptId: string; requestedAt: string; completedAt: string; upstreamHttpStatus: number; providerCreditsRemaining: number | null }): SanitizedCollectEvidence {
  if (input.upstreamHttpStatus !== 200) throw new Error("Only a successful Base Employee Collect response can become review evidence.")
  const profile = unwrapProfile(input.body)
  const returnedEmployeeId = normalizeEmployeeId(first(profile, ["id", "employee_id"]))
  if (returnedEmployeeId !== input.candidate.employeeId) throw new Error("Coresignal Collect returned a different Employee ID than the authorized target.")
  const education = rows(profile.education).filter(activeRow).slice(0, 12).map(item => ({
    institutionId: text(firstValue(item, ["institution_id", "school_id"]), 64),
    institution: text(firstValue(item, ["institution_name", "school_name", "title"]), 200),
    programme: text(firstValue(item, ["degree_name", "program_name", "field_of_study", "subtitle"]), 200),
    startYear: year(firstValue(item, ["date_from_year", "start_year", "date_from"])),
    endYear: year(firstValue(item, ["date_to_year", "end_year", "date_to"])),
  }))
  const employment = rows(profile.experience).filter(activeRow).slice(0, 20).map(item => ({
    companyId: text(firstValue(item, ["company_id"]), 64),
    company: text(firstValue(item, ["company_name", "company", "title"]), 200),
    title: text(firstValue(item, ["title", "position", "role"]), 200),
    startDate: text(firstValue(item, ["date_from", "start_date"]), 40),
    endDate: text(firstValue(item, ["date_to", "end_date"]), 40),
    current: currentExperience(item),
  }))
  const matchingEducation = education.filter(item => item.institutionId === String(input.candidate.institutionId))
  const currentRoles = employment.filter(item => item.current)
  const matchingCompany = input.candidate.mappedCompanyId === null ? currentRoles : currentRoles.filter(item => item.companyId === String(input.candidate.mappedCompanyId))
  const name = text(firstValue(profile, ["full_name", "name"]), 200)
  const professionalProfileUrl = safeProfileUrl(firstValue(profile, ["profile_url", "linkedin_url", "url"]))
  const location = text(firstValue(profile, ["location_full", "location", "country"]), 200)
  const checkedAt = text(firstValue(profile, ["checked_at", "last_checked_at"]), 64)
  const updatedAt = text(firstValue(profile, ["updated_at", "last_updated_at", "last_updated_ux"]), 64)
  const educationQuality = matchingEducation.length ? "PRESENT_AND_PLAUSIBLE" : education.length ? "PRESENT_BUT_CONFLICTING" : "MISSING"
  const graduationQuality = input.candidate.graduationYear === null ? "NOT_INDEPENDENTLY_VERIFIED" : matchingEducation.some(item => item.endYear === input.candidate.graduationYear) ? "PRESENT_AND_PLAUSIBLE" : matchingEducation.some(item => item.endYear !== null) ? "PRESENT_BUT_CONFLICTING" : "MISSING"
  const employerQuality = matchingCompany.length ? "PRESENT_AND_PLAUSIBLE" : currentRoles.length ? "PRESENT_BUT_CONFLICTING" : "MISSING"
  const durationMs = Math.max(0, Date.parse(input.completedAt) - Date.parse(input.requestedAt))
  return {
    schemaVersion: 1,
    sourceSearchHistoryId: input.candidate.searchHistoryId,
    targetEmployeeId: input.candidate.employeeId,
    attemptId: bounded(input.attemptId, 128),
    upstreamHttpStatus: 200,
    returnedEmployeeId,
    identity: { name, professionalProfileUrl, quality: name || professionalProfileUrl ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING" },
    education,
    employment,
    location,
    freshness: { checkedAt, updatedAt, quality: checkedAt || updatedAt ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING" },
    quality: {
      identity: name || professionalProfileUrl ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING",
      education: educationQuality,
      graduationYear: graduationQuality,
      currentEmployer: employerQuality,
      currentDesignation: matchingCompany.some(item => item.title) ? "PRESENT_AND_PLAUSIBLE" : "MISSING",
      employmentHistory: employment.length ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING",
      location: location ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING",
      freshnessEvidence: checkedAt || updatedAt ? "NOT_INDEPENDENTLY_VERIFIED" : "MISSING",
    },
    reviewState: "REVIEW_REQUIRED",
    applicationAccounting: { applicationUnits: CORESIGNAL_COLLECT_ESTIMATED_CREDITS, maximumAuthorizedProviderCredits: CORESIGNAL_COLLECT_ESTIMATED_CREDITS, confirmedDebit: null },
    providerCreditsRemaining: input.providerCreditsRemaining,
    providerActions: { searchRequests: 0, previewRequests: 0, collectRequests: 1, retries: 0, pagination: false, canonicalMutations: 0, identityAttachments: 0 },
    audit: { requestedAt: input.requestedAt, completedAt: input.completedAt, durationMs, provenance: "provider_response_history" },
  }
}

export function serializeCollectEvidence(summary: string, evidence: SanitizedCollectEvidence) {
  return `${summary.trim()}${CORESIGNAL_COLLECT_EVIDENCE_MARKER}${JSON.stringify(evidence)}`
}

export function deserializeCollectEvidence(summary: string) {
  const index = summary.lastIndexOf(CORESIGNAL_COLLECT_EVIDENCE_MARKER)
  if (index < 0) return null
  const evidence = JSON.parse(summary.slice(index + CORESIGNAL_COLLECT_EVIDENCE_MARKER.length)) as SanitizedCollectEvidence
  if (evidence.schemaVersion !== 1 || !["REVIEW_REQUIRED", "NO_CHANGE"].includes(evidence.reviewState) || evidence.providerActions.collectRequests !== 1 || evidence.providerActions.searchRequests !== 0 || evidence.providerActions.canonicalMutations !== 0 || evidence.providerActions.identityAttachments !== 0) throw new Error("Stored Collect evidence is invalid.")
  return { summary: summary.slice(0, index).trim(), evidence }
}

export function presentProviderHistoryCollectEvidence<T extends { provider: string; operation: string; responseSummary: string }>(row: T): T & { collectEvidence?: PresentedCoresignalCollectEvidence } {
  if (row.provider !== "coresignal" || row.operation !== CORESIGNAL_COLLECT_OPERATION) return row
  try {
    const retained = deserializeCollectEvidence(row.responseSummary)
    if (retained) return { ...row, responseSummary: retained.summary, collectEvidence: { state: "RETAINED", evidence: retained.evidence } }
  } catch {
    return { ...row, responseSummary: row.responseSummary.split(CORESIGNAL_COLLECT_EVIDENCE_MARKER)[0].trim(), collectEvidence: { state: "UNAVAILABLE", reason: "Stored Collect evidence could not be validated." } }
  }
  return row
}

export function searchEvidenceAttemptId(responseSummary: string) {
  const retained = deserializeCoresignalSearchEvidence(responseSummary)
  if (!retained) throw new Error("The source Search does not contain supported retained evidence.")
  return retained.evidence.attemptId
}

function normalizeEmployeeId(value: unknown) {
  const id = String(value ?? "").trim()
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw new Error("A valid Coresignal Employee ID is required.")
  return id
}
function row(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(row).filter(item => Object.keys(item).length) : [] }
function unwrapProfile(value: unknown) { const source = row(value); const data = row(source.data); const employee = row(source.employee); return Object.keys(data).length ? data : Object.keys(employee).length ? employee : source }
function firstValue(source: Record<string, unknown>, names: string[]) { for (const name of names) if (source[name] !== null && source[name] !== undefined) return source[name]; return "" }
function first(source: Record<string, unknown>, names: string[]) { return String(firstValue(source, names) ?? "") }
function text(value: unknown, maximum: number) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) }
function bounded(value: string, maximum: number) { const result = text(value, maximum); if (!result) throw new Error("Required evidence text is missing."); return result }
function truthy(value: unknown) { return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true" }
function currentExperience(value: Record<string, unknown>) {
  const explicit = value.is_current
  if (explicit !== null && explicit !== undefined && explicit !== "") return truthy(explicit)
  return !text(firstValue(value, ["date_to", "end_date"]), 40)
}
function activeRow(value: Record<string, unknown>) { return !truthy(value.deleted) }
function year(value: unknown) { const match = String(value ?? "").match(/(?:19|20)\d{2}/); return match ? Number(match[0]) : null }
function safeProfileUrl(value: unknown) { const textValue = text(value, 500); if (!textValue) return ""; try { const url = new URL(textValue); return /(^|\.)linkedin\.com$/i.test(url.hostname) && url.pathname.startsWith("/in/") ? `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}` : "" } catch { return "" } }

export type SearchEvidenceRow = Parameters<typeof candidateFromSearchHistory>[0]
export type SearchEvidence = CoresignalSearchEvidence

export type CollectClaimStore = {
  acquire(input: { candidate: RetainedSearchCandidate; attemptId: string; actor: string; transportMode: "live" | "mock" }): Promise<{ acquired: true; claimId: number } | { acquired: false }>
  complete(input: { claimId: number; candidate: RetainedSearchCandidate; evidence: SanitizedCollectEvidence; responseSummary: string }): Promise<boolean>
  fail(input: { claimId: number; candidate: RetainedSearchCandidate; status: "error" | "ambiguous"; message: string }): Promise<boolean>
}

export async function executeCollectOnce(input: {
  preflight: CollectPreflight
  confirmationValid: boolean
  actor: string
  now?: () => Date
  uuid?: () => string
  store: CollectClaimStore
  transport: (employeeId: string) => Promise<{ body: unknown; upstreamHttpStatus: number; providerCreditsRemaining: number | null }>
}) {
  if (!input.preflight.allowed) throw new Error(input.preflight.blockers[0] ?? "Collect preflight is blocked.")
  if (!input.confirmationValid) throw new Error("The Collect execution confirmation is invalid or expired.")
  const attemptId = (input.uuid ?? (() => crypto.randomUUID()))()
  const claim = await input.store.acquire({ candidate: input.preflight.candidate, attemptId, actor: input.actor, transportMode: input.preflight.runtime.transportMode })
  if (!claim.acquired) return { state: "DUPLICATE_BLOCKED" as const, providerCalls: 0 }
  const now = input.now ?? (() => new Date())
  const requestedAt = now().toISOString()
  let providerResponseReceived = false
  try {
    const response = await input.transport(input.preflight.candidate.employeeId)
    providerResponseReceived = true
    const completedAt = now().toISOString()
    const evidence = sanitizeCollectResponse({ ...response, candidate: input.preflight.candidate, attemptId, requestedAt, completedAt })
    const summary = "One Base Employee Collect request succeeded. Structured professional evidence requires human review; no identity or canonical record was changed."
    if (!await input.store.complete({ claimId: claim.claimId, candidate: input.preflight.candidate, evidence, responseSummary: serializeCollectEvidence(summary, evidence) })) {
      throw new Error("Collect evidence could not be finalized. The request must not be retried automatically.")
    }
    return { state: "REVIEW_REQUIRED" as const, providerCalls: 1, claimId: claim.claimId, evidence }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Coresignal Collect failed."
    const ambiguous = collectFailureRequiresReconciliation(error, providerResponseReceived)
    await input.store.fail({ claimId: claim.claimId, candidate: input.preflight.candidate, status: ambiguous ? "ambiguous" : "error", message })
    throw error
  }
}
