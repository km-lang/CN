import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, externalDiscoveryResults, externalDiscoverySearches, providerResponseHistory, providerSettings } from "@/db/postgres/schema"
import { candidateFromDiscoveryPreview, candidateFromSearchHistory, CORESIGNAL_COLLECT_OPERATION, type RetainedSearchCandidate } from "@/lib/coresignal-collect-only"
import { deserializeCoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { coresignalCollectEnabled, coresignalCollectEntitlement, coresignalCollectMockTransportEnabled, providerConfigured, providerMode } from "@/lib/provider-runtime"

const DEFAULT_APPLICATION_LIMIT = 25
const REQUEST_SUMMARY_PREFIX = "Retained Search Collect-only"
function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function databaseFailure(error: unknown) { return Boolean(error && typeof error === "object" && ("query" in error || "code" in error)) }

export async function postgresCoresignalCollectOverview() {
  const db = getPostgresDb()
  const [[setting], [usage], rows] = await Promise.all([
    db.select().from(providerSettings).where(eq(providerSettings.provider, "coresignal")).limit(1),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.provider, "coresignal"), gte(providerResponseHistory.createdAt, monthStart()))),
    db.select().from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, "coresignal"),
      inArray(providerResponseHistory.operation, ["Base Employee ES-DSL Search", "Exact-year ES-DSL Preview", "Constrained ES-DSL Preview"]),
      eq(providerResponseHistory.mode, "live"), eq(providerResponseHistory.status, "success")))
      .orderBy(desc(providerResponseHistory.id)).limit(50),
  ])
  const candidates: RetainedSearchCandidate[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    let employeeIds: readonly string[] = []
    try {
      if (row.operation === "Base Employee ES-DSL Search") employeeIds = deserializeCoresignalSearchEvidence(row.responseSummary)?.evidence.employeeIds ?? []
      else if (row.searchId) employeeIds = (await db.select({ employeeId: externalDiscoveryResults.providerPersonId }).from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, row.searchId))).map(item => item.employeeId)
    } catch (error) { if (databaseFailure(error)) throw error; continue }
    for (const employeeId of employeeIds) {
      if (seen.has(employeeId)) continue
      try {
        const [prior] = await db.select({ status: providerResponseHistory.status }).from(providerResponseHistory).where(and(
          eq(providerResponseHistory.provider, "coresignal"), eq(providerResponseHistory.operation, CORESIGNAL_COLLECT_OPERATION),
          eq(providerResponseHistory.requestSummary, `${REQUEST_SUMMARY_PREFIX} · Employee ID ${employeeId}`),
        )).limit(1)
        let candidate: RetainedSearchCandidate
        if (["Exact-year ES-DSL Preview", "Constrained ES-DSL Preview"].includes(row.operation)) {
          const [search] = await db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, row.searchId ?? -1)).limit(1)
          const [result] = search ? await db.select().from(externalDiscoveryResults).where(and(eq(externalDiscoveryResults.searchId, search.id), eq(externalDiscoveryResults.providerPersonId, employeeId))).limit(1) : []
          if (!search || !result) continue
          candidate = candidateFromDiscoveryPreview({ history: row, search, result, employeeId, priorCollectStatus: prior?.status ?? null })
        } else candidate = candidateFromSearchHistory(row, employeeId, prior?.status ?? null)
        const [associated] = await db.select({ id: alumni.id }).from(alumni).where(eq(alumni.coresignalEmployeeId, candidate.employeeId)).limit(1)
        if (associated) continue
        candidates.push(candidate)
        seen.add(employeeId)
      } catch (error) { if (databaseFailure(error)) throw error /* Conflicting historical evidence is omitted. */ }
    }
  }
  const limit = setting?.monthlyCreditLimit ?? DEFAULT_APPLICATION_LIMIT
  const used = Number(usage?.used ?? 0)
  const mockTransport = coresignalCollectMockTransportEnabled()
  return { candidates, runtime: {
    configured: mockTransport || providerConfigured("coresignal"), providerLiveMode: providerMode("coresignal") === "live",
    transportMode: mockTransport ? "mock" as const : "live" as const, collectGateEnabled: coresignalCollectEnabled(),
    entitlement: coresignalCollectEntitlement(), applicationUnitsRemaining: Math.max(0, limit - used), maximumRequests: 1 as const,
  } }
}
