import { and, eq, gte, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, coresignalWebhookEvents, externalDiscoveryResults, externalDiscoverySearches, providerResponseHistory, providerSettings } from "@/db/postgres/schema"
import { candidateFromDiscoveryPreview, candidateFromKnownAlumnus, candidateFromSearchHistory, collectPreflight, collectSelectionPlan,
  CORESIGNAL_COLLECT_MAX_PROVIDER_CREDITS, CORESIGNAL_COLLECT_OPERATION, createCollectConfirmation, searchEvidenceAttemptId,
  type RetainedSearchCandidate } from "@/lib/coresignal-collect-only"
import { CORESIGNAL_COLLECT_ESTIMATED_CREDITS, webhookMockEnabled } from "@/lib/coresignal-webhooks"
import { safeCoresignalError } from "@/lib/coresignal-client"
import { coresignalCollectEnabled, coresignalCollectEntitlement, coresignalCollectMockTransportEnabled, providerConfigured, providerMode } from "@/lib/provider-runtime"

const REQUEST_SUMMARY_PREFIX = "Retained Search Collect-only"
function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function databaseFailure(error: unknown) { return Boolean(error && typeof error === "object" && ("query" in error || "code" in error || "cause" in error)) }

export async function postgresSelectedCollectCandidate(searchHistoryId: number, employeeId: string): Promise<{ candidate: RetainedSearchCandidate; searchAttemptId: string }> {
  const db = getPostgresDb()
  const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, searchHistoryId)).limit(1)
  if (!history) throw new Error("The retained Search History record was not found.")
  const [prior] = await db.select({ status: providerResponseHistory.status }).from(providerResponseHistory).where(and(
    eq(providerResponseHistory.provider, "coresignal"), eq(providerResponseHistory.operation, CORESIGNAL_COLLECT_OPERATION),
    eq(providerResponseHistory.requestSummary, `${REQUEST_SUMMARY_PREFIX} · Employee ID ${employeeId}`),
  )).limit(1)
  let candidate: RetainedSearchCandidate
  let searchAttemptId: string
  if (["Exact-year ES-DSL Preview", "Constrained ES-DSL Preview"].includes(history.operation)) {
    const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, history.searchId ?? -1)).limit(1)
    const [result] = search ? await db.select().from(externalDiscoveryResults).where(and(
      eq(externalDiscoveryResults.searchId, search.id), eq(externalDiscoveryResults.providerPersonId, employeeId),
    )).limit(1) : []
    if (!search || !result) throw new Error("This Employee ID is absent from the saved Preview results.")
    candidate = candidateFromDiscoveryPreview({ history, search, result, employeeId, priorCollectStatus: prior?.status ?? null })
    searchAttemptId = `preview-${history.id}-${result.id}`
  } else {
    candidate = candidateFromSearchHistory(history, employeeId, prior?.status ?? null)
    searchAttemptId = searchEvidenceAttemptId(history.responseSummary)
  }
  const [associated] = await db.select({ id: alumni.id }).from(alumni).where(eq(alumni.coresignalEmployeeId, candidate.employeeId)).limit(1)
  if (associated) throw new Error("This Coresignal Employee ID is already associated with a canonical alumnus.")
  return { candidate, searchAttemptId }
}

export async function postgresKnownCollectAlumnus(alumnusId: number, suppliedEmployeeId?: string, webhookEventId?: number) {
  if (!Number.isSafeInteger(alumnusId) || alumnusId < 1) throw new Error("A valid saved alumnus is required.")
  const db = getPostgresDb()
  const [person] = await db.select().from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
  if (!person || !person.coresignalEmployeeId) throw new Error("The alumnus has no saved Coresignal Employee ID.")
  if (suppliedEmployeeId && suppliedEmployeeId !== person.coresignalEmployeeId) throw new Error("The requested Employee ID differs from the saved alumnus identity.")
  if (webhookEventId) {
    if (person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") throw new Error("Identity review is required before collecting this notification.")
    const [event] = await db.select().from(coresignalWebhookEvents).where(and(eq(coresignalWebhookEvents.id, webhookEventId), eq(coresignalWebhookEvents.alumnusId, alumnusId))).limit(1)
    if (!event || event.employeeId !== person.coresignalEmployeeId || event.changeType !== "changed" || event.status !== "AWAITING_PROFILE_COLLECTION" || event.collectHistoryId) throw new Error("This notification is not eligible for profile collection.")
  }
  const [prior] = await db.select({ status: providerResponseHistory.status }).from(providerResponseHistory).where(and(
    eq(providerResponseHistory.provider, "coresignal"), eq(providerResponseHistory.operation, CORESIGNAL_COLLECT_OPERATION),
    eq(providerResponseHistory.requestSummary, webhookEventId
      ? `Webhook event #${webhookEventId} Collect-only · Employee ID ${person.coresignalEmployeeId}`
      : `${REQUEST_SUMMARY_PREFIX} · Employee ID ${person.coresignalEmployeeId}`),
  )).limit(1)
  const candidate: RetainedSearchCandidate = { ...candidateFromKnownAlumnus(person, prior?.status ?? null), ...(webhookEventId ? { sourceWebhookEventId: webhookEventId } : {}) }
  return { candidate, searchAttemptId: webhookEventId ? `known-alumnus-${person.id}-${candidate.employeeId}-event-${webhookEventId}` : `known-alumnus-${person.id}-${candidate.employeeId}` }
}

export async function postgresCollectRuntime() {
  const db = getPostgresDb()
  const [[setting], [usage]] = await Promise.all([
    db.select().from(providerSettings).where(eq(providerSettings.provider, "coresignal")).limit(1),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.provider, "coresignal"), gte(providerResponseHistory.createdAt, monthStart()))),
  ])
  const mockTransport = coresignalCollectMockTransportEnabled()
  return { configured: mockTransport || providerConfigured("coresignal"), providerLiveMode: providerMode("coresignal") === "live",
    transportMode: mockTransport ? "mock" as const : "live" as const, collectGateEnabled: coresignalCollectEnabled(),
    entitlement: coresignalCollectEntitlement(), applicationUnitsRemaining: Math.max(0, (setting?.monthlyCreditLimit ?? 25) - Number(usage?.used ?? 0)),
    maximumRequests: 1 as const }
}

/** Resolve only retained candidates; no reservation, token, provider call or write. */
export async function postgresCollectSelectionPreflight(selections: Array<{ searchHistoryId: number; employeeId: string }> | undefined): Promise<Response> {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 25 || selections.some(item => !item || !Number.isSafeInteger(item.searchHistoryId) || item.searchHistoryId < 1 || typeof item.employeeId !== "string")) {
    return Response.json({ error: "Select 1–25 retained Search candidates." }, { status: 400 })
  }
  const candidates: RetainedSearchCandidate[] = []
  for (const item of selections) {
    try { candidates.push((await postgresSelectedCollectCandidate(item.searchHistoryId, item.employeeId)).candidate) }
    catch (error) {
      if (databaseFailure(error)) throw error
      return Response.json({ error: error instanceof Error ? error.message : "Selected candidate is unavailable." }, { status: 409 })
    }
  }
  return Response.json({ plan: collectSelectionPlan(candidates, await postgresCollectRuntime()), providerCalls: 0, confirmationTokensIssued: 0 }, { headers: { "cache-control": "no-store" } })
}

/** Read-only single-target preflight; normal and live PostgreSQL execution remain closed. */
export async function postgresCollectSinglePreflight(payload: { searchHistoryId?: number; alumnusId?: number; employeeId?: string; webhookEventId?: number }): Promise<Response> {
  if (payload.webhookEventId && (!Number.isSafeInteger(payload.webhookEventId) || payload.webhookEventId < 1 || !Number.isSafeInteger(payload.alumnusId))) return Response.json({ error: "A saved notification and alumnus are required." }, { status: 400 })
  if (payload.webhookEventId && (!coresignalCollectMockTransportEnabled() || !webhookMockEnabled())) return Response.json({ error: "Event-triggered Collect requires isolated, Admin-only mock transport; live Collect is disabled." }, { status: 409 })
  if (!Number.isInteger(payload.alumnusId) && (!Number.isInteger(payload.searchHistoryId) || typeof payload.employeeId !== "string")) return Response.json({ error: "A saved alumnus or retained Search History record and Employee ID are required." }, { status: 400 })
  let resolved: { candidate: RetainedSearchCandidate; searchAttemptId: string }
  try { resolved = Number.isInteger(payload.alumnusId)
    ? await postgresKnownCollectAlumnus(payload.alumnusId!, payload.employeeId, payload.webhookEventId)
    : await postgresSelectedCollectCandidate(payload.searchHistoryId!, payload.employeeId!) }
  catch (error) {
    if (databaseFailure(error)) throw error
    const failure = safeCoresignalError(error)
    const message = error instanceof Error && /^(This notification is not eligible for profile collection\.|Identity review is required before collecting this notification\.)/.test(error.message) ? error.message : null
    return Response.json({ error: message ?? failure.message, failureOrigin: "local_processing", upstreamHttpStatus: null, providerRequestId: null }, { status: message ? 409 : failure.status || 409 })
  }
  const preflight = collectPreflight(resolved.candidate, await postgresCollectRuntime())
  if (payload.webhookEventId && preflight.runtime.applicationUnitsRemaining < CORESIGNAL_COLLECT_ESTIMATED_CREDITS) {
    preflight.allowed = false; preflight.blockers.push("The application budget cannot cover this full-record Collect.")
  }
  const token = preflight.allowed ? createCollectConfirmation({ searchHistoryId: resolved.candidate.searchHistoryId,
    employeeId: resolved.candidate.employeeId, searchAttemptId: resolved.searchAttemptId }, process.env.AUTH_SESSION_SECRET?.trim() ?? "") : null
  return Response.json({ preflight, confirmationToken: token, applicationReservationUnits: CORESIGNAL_COLLECT_ESTIMATED_CREDITS,
    maximumAuthorizedProviderCredits: CORESIGNAL_COLLECT_MAX_PROVIDER_CREDITS, providerBalanceKnown: false,
    providerDebitKnown: false, automaticCollect: false })
}
