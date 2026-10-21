import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { providerResponseHistory, providerSettings, securityAuditEvents } from "@/db/schema"
import { deserializeCoresignalSearchEvidence } from "@/lib/coresignal-search-evidence"
import { deserializeCollectEvidence } from "@/lib/coresignal-collect-only"
import { getLushaAccountUsage, LushaProviderError } from "@/lib/lusha-client"
import { brightDataRuntimeStatus, brightDataSecret, brightDataDatasetId, coresignalCollectEnabled, coresignalCollectEntitlement, coresignalExactYearPreviewEnabled, coresignalExactYearPreviewEntitlement, providerConfigured, providerMode, signalsRuntimeStatus } from "@/lib/provider-runtime"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { creditObservationHistory, creditObservationState, latestCreditObservations, parseProviderCreditObservation, PROVIDER_CREDIT_AUDIT_ACTION, type CreditProvider, type ProviderCreditObservation } from "@/lib/provider-credit-ledger"

function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() }
function apiObservation(provider: CreditProvider, category: ProviderCreditObservation["category"], available: number | null, consumed: number | null, unit: string, sourceDetail: string): ProviderCreditObservation {
  return parseProviderCreditObservation({ provider, category, available, consumed, unit, observedAt: new Date().toISOString(), expiresAt: null, source: "authenticated_api", sourceDetail, warning: "", operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown" })
}

function auditTimestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toISOString()
}

async function observations() {
  const db = getDb()
  const [audits, searchHistory] = await Promise.all([
    db.select({ action: securityAuditEvents.action, metadataJson: securityAuditEvents.metadataJson, createdAt: securityAuditEvents.createdAt }).from(securityAuditEvents).where(inArray(securityAuditEvents.action, [PROVIDER_CREDIT_AUDIT_ACTION, "coresignal_discovery_run", "coresignal_discovery_continuation"])).orderBy(desc(securityAuditEvents.id)).limit(500),
    db.select({ operation: providerResponseHistory.operation, responseSummary: providerResponseHistory.responseSummary, createdAt: providerResponseHistory.createdAt })
      .from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, "coresignal"), eq(providerResponseHistory.mode, "live"), eq(providerResponseHistory.status, "success"))).orderBy(desc(providerResponseHistory.id)).limit(100),
  ])
  const found: ProviderCreditObservation[] = []
  for (const audit of audits) {
    try {
      const metadata = JSON.parse(audit.metadataJson) as Record<string, unknown>
      if (audit.action === PROVIDER_CREDIT_AUDIT_ACTION) found.push(parseProviderCreditObservation(metadata))
      else if (typeof metadata.providerCreditsRemaining === "number" && metadata.mode === "live") found.push(parseProviderCreditObservation({ provider: "coresignal", category: "search", available: metadata.providerCreditsRemaining, consumed: null, unit: "search credits", observedAt: auditTimestamp(audit.createdAt), expiresAt: null, source: "authenticated_api", sourceDetail: "x-credits-remaining · ES-DSL Preview", warning: "", operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown" }))
    } catch { /* An invalid historical audit cannot become a balance. */ }
  }
  for (const history of searchHistory) {
    try {
      const retained = history.operation === "Base Employee ES-DSL Search" ? deserializeCoresignalSearchEvidence(history.responseSummary)?.evidence : null
      if (retained?.creditsRemaining !== null && retained?.creditsRemaining !== undefined) found.push(parseProviderCreditObservation({ provider: "coresignal", category: "search", available: retained.creditsRemaining, consumed: null, unit: "search credits", observedAt: retained.audit.completedAt, expiresAt: null, source: "authenticated_api", sourceDetail: "x-credits-remaining · Base Employee Search", warning: "", operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown" }))
      const collected = deserializeCollectEvidence(history.responseSummary)?.evidence
      if (collected?.providerCreditsRemaining !== null && collected?.providerCreditsRemaining !== undefined) found.push(parseProviderCreditObservation({ provider: "coresignal", category: "collect", available: collected.providerCreditsRemaining, consumed: null, unit: "collect credits", observedAt: collected.audit.completedAt, expiresAt: null, source: "authenticated_api", sourceDetail: "x-credits-remaining · Base Employee Collect", warning: "", operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown" }))
    } catch { /* Malformed legacy evidence never becomes a balance. */ }
  }
  return creditObservationHistory(found).map(item => ({ ...item, state: creditObservationState(item) }))
}

async function snapshot() {
  const db = getDb()
  const [settings, usage, balances, operations] = await Promise.all([
    db.select().from(providerSettings),
    db.select({ provider: providerResponseHistory.provider, applicationUnits: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}),0)`, recordedCredits: sql<number>`coalesce(sum(${providerResponseHistory.creditsUsed}),0)` }).from(providerResponseHistory).where(sql`datetime(${providerResponseHistory.createdAt}) >= datetime(${monthStart()})`).groupBy(providerResponseHistory.provider),
    observations(),
    db.select({ provider: providerResponseHistory.provider, createdAt: providerResponseHistory.createdAt }).from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.status, "success"), eq(providerResponseHistory.mode, "live"))).orderBy(desc(providerResponseHistory.id)).limit(100),
  ])
  const latest = latestCreditObservations(balances)
  const perProvider = (provider: CreditProvider) => {
    const entries = latest.filter(item => item.provider === provider).map(item => ({ ...item, state: creditObservationState(item) }))
    const history = balances.filter(item => item.provider === provider)
    const bright = brightDataRuntimeStatus()
    const signals = signalsRuntimeStatus()
    const readiness = provider === "coresignal"
      ? [{ operation: "Search Preview", entitlement: coresignalExactYearPreviewEntitlement(), gateEnabled: coresignalExactYearPreviewEnabled() }, { operation: "Base Employee Collect", entitlement: coresignalCollectEntitlement(), gateEnabled: coresignalCollectEnabled() }]
      : provider === "brightdata" ? [{ operation: "LinkedIn profile Trigger", entitlement: bright.entitlement, gateEnabled: bright.mode === "live" && bright.executionGateEnabled }]
        : [{ operation: "Lusha live enrichment", entitlement: signals.entitlement, gateEnabled: providerMode("lusha") === "live" && signals.liveEnabled }]
    return {
      provider,
      connected: provider === "brightdata" ? Boolean(brightDataSecret() && brightDataDatasetId()) : providerConfigured(provider),
      observations: entries,
      history: history.slice(0, 30),
      historyLimited: history.length > 30,
      state: entries.length ? entries.every(item => item.state === "stale") ? "stale" : "available" : "unavailable",
      lastVerifiedAt: history.filter(item => item.source === "authenticated_api").map(item => item.observedAt).sort().at(-1) ?? null,
      lastSuccessfulOperationAt: operations.find(item => item.provider === provider)?.createdAt ?? null,
      readiness,
    }
  }
  return {
    providers: [perProvider("coresignal"), perProvider("brightdata"), perProvider("lusha")],
    internalControls: ["coresignal", "lusha"].map(provider => { const limit = settings.find(item => item.provider === provider)?.monthlyCreditLimit ?? (provider === "coresignal" ? 25 : 100); const row = usage.find(item => item.provider === provider); const used = Number(provider === "coresignal" ? row?.applicationUnits ?? 0 : row?.recordedCredits ?? 0); return { provider, used, limit, remaining: Math.max(0, limit - used), unit: provider === "coresignal" ? "application units" : "application credits" } }),
  }
}

export async function GET(request: Request) {
  try { await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS"); return Response.json(await snapshot(), { headers: { "cache-control": "no-store" } }) }
  catch (error) { return accessErrorResponse(error) ?? Response.json({ error: "Unable to load provider balances." }, { status: 500 }) }
}

export async function POST(request: Request) {
  let refreshActor: Awaited<ReturnType<typeof authorizeRequest>> | null = null
  let refreshProvider: CreditProvider | null = null
  try {
    const actor = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const body = await request.json() as { action?: string; provider?: CreditProvider; observation?: unknown; confirmed?: boolean }
    if (body.action === "attest") {
      if (!body.confirmed) return Response.json({ error: "Explicit Admin attestation is required." }, { status: 400 })
      let observation: ProviderCreditObservation
      try { observation = parseProviderCreditObservation({ ...(body.observation && typeof body.observation === "object" && !Array.isArray(body.observation) ? body.observation : {}), source: "admin_dashboard_attestation" }) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Balance observation is invalid." }, { status: 400 }) }
      await writeSecurityAudit(actor, { action: PROVIDER_CREDIT_AUDIT_ACTION, entityType: "provider_balance", entityId: observation.provider, metadata: observation, result: "admin_attested", source: "authenticated_dashboard_observation" })
      return Response.json(await snapshot())
    }
    if (body.action !== "refresh" || !["brightdata", "lusha"].includes(body.provider ?? "")) return Response.json({ error: "Only supported read-only balance APIs can be refreshed." }, { status: 400 })
    refreshActor = actor
    refreshProvider = body.provider!
    const previous = (await observations()).find(item => item.provider === body.provider && item.source === "authenticated_api")
    if (previous && Date.now() - Date.parse(previous.observedAt) < 5 * 60_000) return Response.json({ ...await snapshot(), refreshState: "cached" })
    let observation: ProviderCreditObservation
    if (body.provider === "lusha") {
      if (!providerConfigured("lusha")) return Response.json({ error: "Lusha API key is not configured in this runtime.", code: "unavailable" }, { status: 409 })
      const result = await getLushaAccountUsage()
      if (result.remaining === null && result.used === null) return Response.json({ error: "Lusha returned no recognizable balance or usage fields.", code: "unavailable" }, { status: 502 })
      observation = apiObservation("lusha", result.creditType, result.remaining, result.used, result.creditType === "bulk_credits" ? "bulk credits" : "credits", "Lusha account usage API")
    } else {
      const token = brightDataSecret()
      if (!token) return Response.json({ error: "Bright Data account credential is not configured in this runtime.", code: "unavailable" }, { status: 409 })
      const response = await fetch("https://api.brightdata.com/customer/balance", { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) })
      if (response.status === 401 || response.status === 403) {
        await writeSecurityAudit(actor, { action: "provider_credit_balance_refresh_failed", entityType: "provider_balance", entityId: "brightdata", metadata: { reason: "authentication_error" }, result: "failure", source: "authenticated_provider_api" })
        return Response.json({ error: "Bright Data balance API rejected this credential; dataset access and free credits are not inferred.", code: "authentication_error" }, { status: 502 })
      }
      if (!response.ok) return Response.json({ error: `Bright Data balance API returned HTTP ${response.status}.`, code: "unavailable" }, { status: 502 })
      const result = await response.json() as { balance?: unknown }
      if (typeof result.balance !== "number" || !Number.isFinite(result.balance) || result.balance < 0) return Response.json({ error: "Bright Data returned no valid account balance.", code: "unavailable" }, { status: 502 })
      observation = apiObservation("brightdata", "currency", result.balance, null, "account currency (unspecified)", "Bright Data GET /customer/balance")
    }
    await writeSecurityAudit(actor, { action: PROVIDER_CREDIT_AUDIT_ACTION, entityType: "provider_balance", entityId: observation.provider, metadata: observation, result: "api_verified", source: "authenticated_provider_api" })
    return Response.json({ ...await snapshot(), refreshState: "verified" })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    if (refreshActor && refreshProvider) {
      try { await writeSecurityAudit(refreshActor, { action: "provider_credit_balance_refresh_failed", entityType: "provider_balance", entityId: refreshProvider, metadata: { reason: error instanceof Error && /authentication|credential|403|401/i.test(error.message) ? "authentication_error" : "unavailable" }, result: "failure", source: "authenticated_provider_api" }) }
      catch { /* Preserve the original refresh error without exposing provider data. */ }
    }
    const authenticationError = error instanceof LushaProviderError && error.kind === "authentication"
    return Response.json({ error: authenticationError ? "Lusha account usage API rejected this credential." : error instanceof Error && /Balance|observation|provenance|date|unit|source|amount/i.test(error.message) ? error.message : "Provider balance verification failed.", code: authenticationError ? "authentication_error" : "unavailable" }, { status: 502 })
  }
}
