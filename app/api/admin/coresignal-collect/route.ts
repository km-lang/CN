import { env } from "cloudflare:workers"
import { and, desc, eq, gte, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, providerResponseHistory, providerSettings } from "@/db/schema"
import { collectCoresignalEmployeeWithMetadata, safeCoresignalError } from "@/lib/coresignal-client"
import {
  CORESIGNAL_COLLECT_OPERATION,
  CORESIGNAL_COLLECT_CLAIM_SQL,
  candidateFromSearchHistory,
  collectPreflight,
  createCollectConfirmation,
  executeCollectOnce,
  searchEvidenceAttemptId,
  verifyCollectConfirmation,
  type CollectClaimStore,
  type RetainedSearchCandidate,
  type SearchEvidenceRow,
} from "@/lib/coresignal-collect-only"
import { coresignalCollectEnabled, coresignalCollectEntitlement, coresignalCollectMockTransportEnabled, providerConfigured, providerMode } from "@/lib/provider-runtime"
import { deserializeCoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { classifyCurrentTitle } from "@/lib/seniority-classifier"

const DEFAULT_APPLICATION_LIMIT = 25
const REQUEST_SUMMARY_PREFIX = "Retained Search Collect-only"

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function confirmationSecret() { return process.env.AUTH_SESSION_SECRET?.trim() ?? "" }
function requestSummary(candidate: RetainedSearchCandidate) { return `${REQUEST_SUMMARY_PREFIX} · Employee ID ${candidate.employeeId}` }
function mockCollectEvidence(employeeId: string) {
  return {
    body: {
      id: Number(employeeId), full_name: "Synthetic Collect Review Candidate", profile_url: "https://www.linkedin.com/in/synthetic-collect-review-candidate",
      location_full: "Chicago, United States", checked_at: "2026-10-17T00:00:00Z",
      education: [{ institution_id: 25919228, institution_name: "Indian Institute of Management Lucknow", degree_name: "PGP", date_to_year: 2011, deleted: 0 }],
      experience: [{ company_id: 8469989, company_name: "Lincoln International", title: "Director", is_current: 1, deleted: 0, date_from: "2024-01" }],
    },
    upstreamHttpStatus: 200 as const,
    providerCreditsRemaining: null,
  }
}
async function applicationCapacity() {
  const db = getDb()
  const [[setting], [usage]] = await Promise.all([
    db.select().from(providerSettings).where(eq(providerSettings.provider, "coresignal")).limit(1),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, "coresignal"), gte(providerResponseHistory.createdAt, monthStart()))),
  ])
  const limit = setting?.monthlyCreditLimit ?? DEFAULT_APPLICATION_LIMIT
  const used = Number(usage?.used ?? 0)
  return { used, limit, remaining: Math.max(0, limit - used) }
}

async function priorCollectStatus(searchHistoryId: number, employeeId: string) {
  const [row] = await getDb().select({ status: providerResponseHistory.status }).from(providerResponseHistory).where(and(
    eq(providerResponseHistory.provider, "coresignal"),
    eq(providerResponseHistory.operation, CORESIGNAL_COLLECT_OPERATION),
    eq(providerResponseHistory.requestSummary, `${REQUEST_SUMMARY_PREFIX} · Employee ID ${employeeId}`),
  )).limit(1)
  return row?.status ?? null
}

async function resolveCandidate(searchHistoryId: number, employeeId: string) {
  const db = getDb()
  const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, searchHistoryId)).limit(1)
  if (!history) throw new Error("The retained Search History record was not found.")
  const candidate = candidateFromSearchHistory(history as SearchEvidenceRow, employeeId, await priorCollectStatus(searchHistoryId, employeeId))
  const [associated] = await db.select({ id: alumni.id }).from(alumni).where(eq(alumni.coresignalEmployeeId, candidate.employeeId)).limit(1)
  if (associated) throw new Error("This Coresignal Employee ID is already associated with a canonical alumnus.")
  return { candidate, searchAttemptId: searchEvidenceAttemptId(history.responseSummary) }
}

async function runtimeState() {
  const capacity = await applicationCapacity()
  const mockTransport = coresignalCollectMockTransportEnabled()
  return {
    configured: mockTransport || providerConfigured("coresignal"),
    providerLiveMode: providerMode("coresignal") === "live",
    transportMode: mockTransport ? "mock" as const : "live" as const,
    collectGateEnabled: coresignalCollectEnabled(),
    entitlement: coresignalCollectEntitlement(),
    applicationUnitsRemaining: capacity.remaining,
    maximumRequests: 1 as const,
  }
}
async function eligibleCandidates() {
  const rows = await getDb().select().from(providerResponseHistory).where(and(
    eq(providerResponseHistory.provider, "coresignal"),
    eq(providerResponseHistory.operation, "Base Employee ES-DSL Search"),
    eq(providerResponseHistory.mode, "live"),
    eq(providerResponseHistory.status, "success"),
  )).orderBy(desc(providerResponseHistory.id)).limit(50)
  const candidates: RetainedSearchCandidate[] = []
  for (const row of rows) {
    try {
      const retained = deserializeCoresignalSearchEvidence(row.responseSummary)
      if (!retained) continue
      for (const employeeId of retained.evidence.employeeIds) candidates.push((await resolveCandidate(row.id, employeeId)).candidate)
    } catch { /* Historical or conflicting evidence is intentionally not offered. */ }
  }
  return candidates
}

const claimStore: CollectClaimStore = {
  async acquire({ candidate, attemptId, actor, transportMode }) {
    const summary = requestSummary(candidate)
    const row = await env.DB.prepare(CORESIGNAL_COLLECT_CLAIM_SQL).bind(candidate.searchHistoryId, CORESIGNAL_COLLECT_OPERATION, transportMode, summary, `Collect attempt ${attemptId} claimed; no provider response retained yet.`, actor, CORESIGNAL_COLLECT_OPERATION, summary).first<{ id: number }>()
    return row ? { acquired: true as const, claimId: row.id } : { acquired: false as const }
  },
  async complete({ claimId, evidence, responseSummary }) {
    const result = await env.DB.prepare(`UPDATE provider_response_history SET status='success', application_units=1, result_count=1, response_summary=?, usage_state='reconciliation_required', provider_reported_credits=NULL WHERE id=? AND status='in_progress'`).bind(responseSummary, claimId).run() as { meta: { changes?: number } }
    return result.meta.changes === 1 && evidence.providerActions.collectRequests === 1
  },
  async fail({ claimId, status, message }) {
    const result = await env.DB.prepare(`UPDATE provider_response_history SET status=?, error_message=?, response_summary='One bounded Collect attempt ended without reviewable evidence. No retry was made.', application_units=?, usage_state=? WHERE id=? AND status='in_progress'`).bind(status, message.slice(0, 500), status === "ambiguous" ? 1 : 0, status === "ambiguous" ? "reconciliation_required" : "not_applicable", claimId).run() as { meta: { changes?: number } }
    return result.meta.changes === 1
  },
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    return Response.json({ candidates: await eligibleCandidates(), runtime: await runtimeState() })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load retained Coresignal candidates." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const payload = await request.json() as { action?: "preflight" | "execute"; searchHistoryId?: number; employeeId?: string; confirmed?: boolean; confirmationToken?: string }
    if (!Number.isInteger(payload.searchHistoryId) || typeof payload.employeeId !== "string") return Response.json({ error: "A retained Search History record and Employee ID are required." }, { status: 400 })
    const resolved = await resolveCandidate(payload.searchHistoryId!, payload.employeeId)
    const preflight = collectPreflight(resolved.candidate, await runtimeState())
    if (payload.action === "preflight") {
      const token = preflight.allowed ? createCollectConfirmation({ searchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId, searchAttemptId: resolved.searchAttemptId }, confirmationSecret()) : null
      return Response.json({ preflight, confirmationToken: token, documentedCollectCredits: 1, providerBalanceKnown: false })
    }
    if (payload.action !== "execute" || payload.confirmed !== true || typeof payload.confirmationToken !== "string") return Response.json({ error: "Explicit Collect confirmation is required." }, { status: 400 })
    const confirmationValid = verifyCollectConfirmation(payload.confirmationToken, { searchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId, searchAttemptId: resolved.searchAttemptId }, confirmationSecret())
    const result = await executeCollectOnce({
      preflight, confirmationValid, actor: context.displayName, store: claimStore,
      transport: coresignalCollectMockTransportEnabled() ? async employeeId => mockCollectEvidence(employeeId) : employeeId => collectCoresignalEmployeeWithMetadata(employeeId),
    })
    if (result.state === "DUPLICATE_BLOCKED") return Response.json({ error: "A Collect attempt already exists for this retained candidate. No provider request was made.", state: result.state }, { status: 409 })
    if (result.state === "REVIEW_REQUIRED" && result.evidence && result.claimId) {
      const positions = result.evidence.employment.map(position => {
        const classification = classifyCurrentTitle(position.title, position.company)
        return getDb().insert(alumniEmploymentEvidence).values({
          evidenceSource: "Coresignal Base Employee Collect", providerEmployeeId: result.evidence!.returnedEmployeeId,
          providerResponseId: result.claimId, stableCompanyId: position.companyId, originalCompanyName: position.company,
          originalJobTitle: position.title, normalizedJobTitle: classification.state === "CLASSIFIED" ? classification.level : classification.state,
          startDate: position.startDate, endDate: position.endDate, isCurrent: position.current, isDeleted: false,
          observedAt: result.evidence!.freshness.checkedAt || result.evidence!.audit.completedAt,
          evidenceVersion: String(result.evidence!.schemaVersion), verificationStatus: "UNVERIFIED", reviewerStatus: "PENDING",
        }).onConflictDoNothing()
      })
      if (positions.length) await getDb().batch(positions as unknown as Parameters<ReturnType<typeof getDb>["batch"]>[0])
    }
    await writeSecurityAudit(context, { action: "coresignal_collect_only_executed", entityType: "provider_response_history", entityId: result.claimId, metadata: { sourceSearchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId, providerCalls: 1, canonicalMutations: 0, identityAttachments: 0 } })
    return Response.json({ state: result.state, evidence: result.evidence })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    const failure = safeCoresignalError(error)
    const safeWorkflowMessage = error instanceof Error && /^(The Collect execution confirmation is invalid or expired\.|Collect preflight is blocked\.|A Collect attempt already exists|Coresignal server authentication is not configured\.|Coresignal live mode is disabled\.|The independent Collect execution gate is disabled\.|The account-specific Base Employee Collect entitlement is unknown\.|The configured account is not entitled to Base Employee Collect\.|The Coresignal application-unit allowance is exhausted\.)/.test(error.message)
      ? error.message
      : null
    return Response.json({ error: safeWorkflowMessage ?? failure.message }, { status: safeWorkflowMessage ? 409 : failure.status || 409 })
  }
}
