import { env } from "cloudflare:workers"
import { and, desc, eq, gte, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, coresignalWebhookEvents, providerResponseHistory, providerSettings } from "@/db/schema"
import { collectCoresignalEmployeeWithMetadata, safeCoresignalError } from "@/lib/coresignal-client"
import {
  CORESIGNAL_COLLECT_OPERATION,
  CORESIGNAL_COLLECT_CLAIM_SQL,
  CORESIGNAL_KNOWN_COLLECT_CLAIM_SQL,
  candidateFromKnownAlumnus,
  candidateFromSearchHistory,
  collectPreflight,
  createCollectConfirmation,
  executeCollectOnce,
  knownAlumnusCollectChanges,
  searchEvidenceAttemptId,
  serializeCollectEvidence,
  verifyCollectConfirmation,
  type CollectClaimStore,
  type RetainedSearchCandidate,
  type SearchEvidenceRow,
} from "@/lib/coresignal-collect-only"
import { coresignalCollectEnabled, coresignalCollectEntitlement, coresignalCollectMockTransportEnabled, providerConfigured, providerMode } from "@/lib/provider-runtime"
import { deserializeCoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { classifyCurrentTitle } from "@/lib/seniority-classifier"
import { CORESIGNAL_COLLECT_ESTIMATED_CREDITS, webhookMockEnabled } from "@/lib/coresignal-webhooks"

const DEFAULT_APPLICATION_LIMIT = 25
const REQUEST_SUMMARY_PREFIX = "Retained Search Collect-only"
const WEBHOOK_COLLECT_CLAIM_SQL = `
  INSERT INTO provider_response_history
    (provider, alumnus_id, alumnus_name, operation, mode, status, credits_used, application_units, provider_reported_credits, usage_state, result_count, request_summary, response_summary, error_message, requested_by)
  SELECT 'coresignal', ?, ?, ?, 'mock', 'in_progress', 0, ?, NULL, 'reconciliation_required', 0, ?, ?, '', ?
  WHERE NOT EXISTS (SELECT 1 FROM provider_response_history WHERE provider='coresignal' AND operation=? AND request_summary=?)
    AND ? + coalesce((SELECT sum(application_units) FROM provider_response_history WHERE provider='coresignal' AND datetime(created_at)>=datetime(?)),0)
      <= coalesce((SELECT monthly_credit_limit FROM provider_settings WHERE provider='coresignal'),25)
  RETURNING id
`

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function confirmationSecret() { return process.env.AUTH_SESSION_SECRET?.trim() ?? "" }
function requestSummary(candidate: RetainedSearchCandidate) { return candidate.sourceWebhookEventId ? `Webhook event #${candidate.sourceWebhookEventId} Collect-only · Employee ID ${candidate.employeeId}` : `${REQUEST_SUMMARY_PREFIX} · Employee ID ${candidate.employeeId}` }
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

async function priorCollectStatus(searchHistoryId: number, employeeId: string, webhookEventId?: number) {
  const [row] = await getDb().select({ status: providerResponseHistory.status }).from(providerResponseHistory).where(and(
    eq(providerResponseHistory.provider, "coresignal"),
    eq(providerResponseHistory.operation, CORESIGNAL_COLLECT_OPERATION),
    eq(providerResponseHistory.requestSummary, webhookEventId ? `Webhook event #${webhookEventId} Collect-only · Employee ID ${employeeId}` : `${REQUEST_SUMMARY_PREFIX} · Employee ID ${employeeId}`),
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

async function resolveKnownAlumnus(alumnusId: number, suppliedEmployeeId?: string, webhookEventId?: number) {
  if (!Number.isSafeInteger(alumnusId) || alumnusId < 1) throw new Error("A valid saved alumnus is required.")
  const [person] = await getDb().select().from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
  if (!person || !person.coresignalEmployeeId) throw new Error("The alumnus has no saved Coresignal Employee ID.")
  if (suppliedEmployeeId && suppliedEmployeeId !== person.coresignalEmployeeId) throw new Error("The requested Employee ID differs from the saved alumnus identity.")
  if (webhookEventId) {
    if (person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") throw new Error("Identity review is required before collecting this notification.")
    const [event] = await getDb().select().from(coresignalWebhookEvents).where(and(eq(coresignalWebhookEvents.id, webhookEventId), eq(coresignalWebhookEvents.alumnusId, alumnusId))).limit(1)
    if (!event || event.employeeId !== person.coresignalEmployeeId || event.changeType !== "changed" || event.status !== "AWAITING_PROFILE_COLLECTION" || event.collectHistoryId) throw new Error("This notification is not eligible for profile collection.")
  }
  const candidate: RetainedSearchCandidate = { ...candidateFromKnownAlumnus(person, await priorCollectStatus(0, person.coresignalEmployeeId, webhookEventId)), ...(webhookEventId ? { sourceWebhookEventId: webhookEventId } : {}) }
  return { candidate, searchAttemptId: webhookEventId ? `known-alumnus-${person.id}-${candidate.employeeId}-event-${webhookEventId}` : `known-alumnus-${person.id}-${candidate.employeeId}` }
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
    const row = candidate.sourceWebhookEventId
      ? await env.DB.prepare(WEBHOOK_COLLECT_CLAIM_SQL).bind(candidate.sourceAlumnusId, `Alumnus ${candidate.sourceAlumnusId}`, CORESIGNAL_COLLECT_OPERATION, CORESIGNAL_COLLECT_ESTIMATED_CREDITS, summary, `Webhook event #${candidate.sourceWebhookEventId} mock Collect claimed; no provider response retained yet.`, actor, CORESIGNAL_COLLECT_OPERATION, summary, CORESIGNAL_COLLECT_ESTIMATED_CREDITS, monthStart()).first<{ id: number }>()
      : candidate.sourceAlumnusId
      ? await env.DB.prepare(CORESIGNAL_KNOWN_COLLECT_CLAIM_SQL).bind(candidate.sourceAlumnusId, `Alumnus ${candidate.sourceAlumnusId}`, CORESIGNAL_COLLECT_OPERATION, transportMode, summary, `Collect attempt ${attemptId} claimed; no provider response retained yet.`, actor, CORESIGNAL_COLLECT_OPERATION, summary).first<{ id: number }>()
      : await env.DB.prepare(CORESIGNAL_COLLECT_CLAIM_SQL).bind(candidate.searchHistoryId, CORESIGNAL_COLLECT_OPERATION, transportMode, summary, `Collect attempt ${attemptId} claimed; no provider response retained yet.`, actor, CORESIGNAL_COLLECT_OPERATION, summary).first<{ id: number }>()
    if (row && candidate.sourceWebhookEventId) {
      const approved = await env.DB.prepare("UPDATE coresignal_webhook_events SET status='PROFILE_COLLECTION_APPROVED',collect_history_id=? WHERE id=? AND alumnus_id=? AND employee_id=? AND status='AWAITING_PROFILE_COLLECTION' RETURNING id").bind(row.id, candidate.sourceWebhookEventId, candidate.sourceAlumnusId, candidate.employeeId).first()
      if (!approved) {
        await env.DB.prepare("UPDATE provider_response_history SET status='error',application_units=0,error_message='Notification was no longer eligible before mock Collect; no provider request made.' WHERE id=? AND status='in_progress'").bind(row.id).run()
        return { acquired: false as const }
      }
    }
    return row ? { acquired: true as const, claimId: row.id } : { acquired: false as const }
  },
  async complete({ claimId, candidate, evidence, responseSummary }) {
    const result = await env.DB.prepare(`UPDATE provider_response_history SET status='success', application_units=?, result_count=1, response_summary=?, usage_state='reconciliation_required', provider_reported_credits=NULL WHERE id=? AND status='in_progress'`).bind(candidate.sourceWebhookEventId ? CORESIGNAL_COLLECT_ESTIMATED_CREDITS : 1, responseSummary, claimId).run() as { meta: { changes?: number } }
    return result.meta.changes === 1 && evidence.providerActions.collectRequests === 1
  },
  async fail({ claimId, candidate, status, message }) {
    const result = await env.DB.prepare(`UPDATE provider_response_history SET status=?, error_message=?, response_summary='One bounded Collect attempt ended without reviewable evidence. No retry was made.', application_units=?, usage_state=? WHERE id=? AND status='in_progress'`).bind(status, message.slice(0, 500), status === "ambiguous" ? candidate.sourceWebhookEventId ? CORESIGNAL_COLLECT_ESTIMATED_CREDITS : 1 : 0, status === "ambiguous" ? "reconciliation_required" : "not_applicable", claimId).run() as { meta: { changes?: number } }
    if (candidate.sourceWebhookEventId) await env.DB.prepare("UPDATE coresignal_webhook_events SET status='REVIEW_REQUIRED',error_state=?,review_outcome='Collect attempt requires reconciliation' WHERE id=? AND collect_history_id=? AND status='PROFILE_COLLECTION_APPROVED'").bind(status === "ambiguous" ? "COLLECT_OUTCOME_AMBIGUOUS" : "COLLECT_FAILED", candidate.sourceWebhookEventId, claimId).run()
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
    const payload = await request.json() as { action?: "preflight" | "execute"; searchHistoryId?: number; alumnusId?: number; employeeId?: string; webhookEventId?: number; confirmed?: boolean; confirmationToken?: string }
    if (payload.webhookEventId && (!Number.isSafeInteger(payload.webhookEventId) || payload.webhookEventId < 1 || !Number.isSafeInteger(payload.alumnusId))) return Response.json({ error: "A saved notification and alumnus are required." }, { status: 400 })
    if (payload.webhookEventId && (!coresignalCollectMockTransportEnabled() || !webhookMockEnabled())) return Response.json({ error: "Event-triggered Collect requires isolated, Admin-only mock transport; live Collect is disabled." }, { status: 409 })
    if (!Number.isInteger(payload.alumnusId) && (!Number.isInteger(payload.searchHistoryId) || typeof payload.employeeId !== "string")) return Response.json({ error: "A saved alumnus or retained Search History record and Employee ID are required." }, { status: 400 })
    const resolved = Number.isInteger(payload.alumnusId)
      ? await resolveKnownAlumnus(payload.alumnusId!, payload.employeeId, payload.webhookEventId)
      : await resolveCandidate(payload.searchHistoryId!, payload.employeeId!)
    const preflight = collectPreflight(resolved.candidate, await runtimeState())
    if (payload.webhookEventId && preflight.runtime.applicationUnitsRemaining < CORESIGNAL_COLLECT_ESTIMATED_CREDITS) { preflight.allowed = false; preflight.blockers.push("The application budget has fewer than 10 remaining estimated credits.") }
    if (payload.action === "preflight") {
      const token = preflight.allowed ? createCollectConfirmation({ searchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId, searchAttemptId: resolved.searchAttemptId }, confirmationSecret()) : null
      return Response.json({ preflight, confirmationToken: token, documentedCollectCredits: payload.webhookEventId ? CORESIGNAL_COLLECT_ESTIMATED_CREDITS : 1, providerBalanceKnown: false, automaticCollect: false })
    }
    if (payload.action !== "execute" || payload.confirmed !== true || typeof payload.confirmationToken !== "string") return Response.json({ error: "Explicit Collect confirmation is required." }, { status: 400 })
    const confirmationValid = verifyCollectConfirmation(payload.confirmationToken, { searchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId, searchAttemptId: resolved.searchAttemptId }, confirmationSecret())
    const result = await executeCollectOnce({
      preflight, confirmationValid, actor: context.displayName, store: claimStore,
      transport: coresignalCollectMockTransportEnabled() ? async employeeId => mockCollectEvidence(employeeId) : employeeId => collectCoresignalEmployeeWithMetadata(employeeId),
    })
    if (result.state === "DUPLICATE_BLOCKED") return Response.json({ error: "A Collect attempt already exists for this retained candidate. No provider request was made.", state: result.state }, { status: 409 })
    let comparisonOutcome = "IDENTITY_RESOLUTION_REQUIRED"
    if (result.state === "REVIEW_REQUIRED" && result.evidence && result.claimId) {
      const db = getDb()
      const writes: Array<Parameters<typeof db.batch>[0][number]> = []
      if (resolved.candidate.sourceAlumnusId) {
        const [person] = await db.select().from(alumni).where(eq(alumni.id, resolved.candidate.sourceAlumnusId)).limit(1)
        if (person && person.coresignalEmployeeId === result.evidence.returnedEmployeeId) {
          const comparison = knownAlumnusCollectChanges(person, result.evidence)
          comparisonOutcome = comparison.outcome
          writes.push(...comparison.changes.map(item => db.insert(alumniProfileChangeProposals).values({
            alumnusId: person.id, ...item, source: `Coresignal Collect #${result.claimId}`, expectedRecordVersion: person.recordVersion,
            proposedBy: context.displayName, mutationRequestKey: `coresignal-collect:${result.claimId}`,
          }).onConflictDoNothing()))
        } else comparisonOutcome = "IDENTITY_CONFLICT"
        if (comparisonOutcome === "NO_CHANGE") result.evidence.reviewState = "NO_CHANGE"
        writes.push(db.update(providerResponseHistory).set({ responseSummary: serializeCollectEvidence(`One Base Employee Collect request succeeded. Known-alumnus comparison: ${comparisonOutcome}. No canonical update.`, result.evidence) }).where(and(eq(providerResponseHistory.id, result.claimId), eq(providerResponseHistory.status, "success"))))
      }
      writes.push(...result.evidence.employment.map(position => {
        const classification = classifyCurrentTitle(position.title, position.company)
        return db.insert(alumniEmploymentEvidence).values({
          alumnusId: comparisonOutcome === "IDENTITY_CONFLICT" ? null : resolved.candidate.sourceAlumnusId ?? null, evidenceSource: "Coresignal Base Employee Collect", providerEmployeeId: result.evidence!.returnedEmployeeId,
          providerResponseId: result.claimId, stableCompanyId: position.companyId, originalCompanyName: position.company,
          originalJobTitle: position.title, normalizedJobTitle: classification.state === "CLASSIFIED" ? classification.level : classification.state,
          startDate: position.startDate, endDate: position.endDate, isCurrent: position.current, isDeleted: false,
          observedAt: result.evidence!.freshness.checkedAt || result.evidence!.audit.completedAt,
          evidenceVersion: String(result.evidence!.schemaVersion), verificationStatus: "UNVERIFIED", reviewerStatus: "PENDING",
        }).onConflictDoNothing()
      }))
      if (resolved.candidate.sourceWebhookEventId) writes.push(db.update(coresignalWebhookEvents).set({ collectHistoryId: result.claimId, status: comparisonOutcome === "NO_CHANGE" ? "NO_MATERIAL_CHANGE" : "PROFILE_COLLECTED", reviewOutcome: comparisonOutcome }).where(and(eq(coresignalWebhookEvents.id, resolved.candidate.sourceWebhookEventId), eq(coresignalWebhookEvents.status, "PROFILE_COLLECTION_APPROVED"))))
      if (writes.length) await db.batch(writes as unknown as Parameters<typeof db.batch>[0])
    }
    await writeSecurityAudit(context, { action: "coresignal_collect_only_executed", entityType: "provider_response_history", entityId: result.claimId, metadata: { sourceSearchHistoryId: resolved.candidate.searchHistoryId, sourceAlumnusId: resolved.candidate.sourceAlumnusId ?? null, sourceWebhookEventId: resolved.candidate.sourceWebhookEventId ?? null, employeeId: resolved.candidate.employeeId, comparisonOutcome, providerCalls: coresignalCollectMockTransportEnabled() ? 0 : 1, canonicalMutations: 0, identityAttachments: 0 } })
    return Response.json({ state: comparisonOutcome === "NO_CHANGE" ? "EVIDENCE_STORED" : result.state, comparisonOutcome, evidence: result.evidence })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    const failure = safeCoresignalError(error)
    const safeWorkflowMessage = error instanceof Error && /^(The Collect execution confirmation is invalid or expired\.|Collect preflight is blocked\.|A Collect attempt already exists|This notification is not eligible for profile collection\.|Identity review is required before collecting this notification\.|The application budget has fewer than 10 remaining estimated credits\.|Coresignal server authentication is not configured\.|Coresignal live mode is disabled\.|The independent Collect execution gate is disabled\.|The account-specific Base Employee Collect entitlement is unknown\.|The configured account is not entitled to Base Employee Collect\.|The Coresignal application-unit allowance is exhausted\.)/.test(error.message)
      ? error.message
      : null
    return Response.json({ error: safeWorkflowMessage ?? failure.message }, { status: safeWorkflowMessage ? 409 : failure.status || 409 })
  }
}
