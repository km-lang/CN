import assert from "node:assert/strict"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())
const ledger = await vite.ssrLoadModule("/lib/provider-credit-ledger.ts")
const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")

function d1(db) {
  return { prepare(statement) { return { bind(...values) {
    const query = db.prepare(statement)
    return {
      first: async () => query.get(...values) ?? null,
      all: async () => ({ results: query.all(...values) }),
      raw: async () => { query.setReturnArrays(true); return query.all(...values) },
      run: async () => ({ meta: { changes: query.run(...values).changes } }),
    }
  } } } }
}

function observation(overrides = {}) {
  return {
    provider: "coresignal", category: "search", available: 100, consumed: null,
    unit: "search credits", observedAt: "2026-10-21T09:00:00.000Z", expiresAt: null,
    source: "authenticated_api", sourceDetail: "x-credits-remaining", warning: "",
    operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown", ...overrides,
  }
}

test("provider account observations remain distinct from internal spending controls", () => {
  const row = ledger.parseProviderCreditObservation(observation())
  assert.equal(row.available, 100)
  assert.equal(row.unit, "search credits")
  assert.equal("monthlyCreditLimit" in row, false)
  assert.equal("applicationUnits" in row, false)
})

test("search, collect, free-credit and currency observations stay separate", () => {
  const rows = [
    observation({ category: "search", available: 100 }),
    observation({ category: "collect", available: 10 }),
    observation({ provider: "brightdata", category: "currency", unit: "USD", available: 4.5 }),
    observation({ provider: "brightdata", category: "free_credits", unit: "free credits", available: 25 }),
  ].map(ledger.parseProviderCreditObservation)
  assert.equal(ledger.latestCreditObservations(rows).length, 4)
})

test("newer observation wins, while the earlier observation remains in history", () => {
  const old = ledger.parseProviderCreditObservation(observation())
  const next = ledger.parseProviderCreditObservation(observation({ available: 80, observedAt: "2026-10-21T10:00:00.000Z", source: "admin_dashboard_attestation" }))
  assert.equal(ledger.latestCreditObservations([old, next])[0].available, 80)
  assert.deepEqual(ledger.creditObservationHistory([old, next]).map(row => row.available), [80, 100])
})

test("stale or expired account balances never present as current", () => {
  const row = ledger.parseProviderCreditObservation(observation())
  assert.equal(ledger.creditObservationState(row, Date.parse("2026-10-21T10:00:00Z")), "current")
  assert.equal(ledger.creditObservationState(row, Date.parse("2026-10-23T10:00:00Z")), "stale")
  assert.equal(ledger.creditObservationState({ ...row, expiresAt: "2026-10-21T09:30:00Z" }, Date.parse("2026-10-21T10:00:00Z")), "stale")
})

test("manual observations reject absent values, negative balances and invalid provenance", () => {
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ available: null })), /At least one/)
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ available: -1 })), /non-negative/)
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ sourceDetail: "" })), /source detail/)
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ sourceDetail: "token=synthetic-secret" })), /provenance is invalid/)
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ source: "provider_verified" })), /source is invalid/)
})

test("priced operations require an explicit basis, operation and price unit", () => {
  assert.throws(() => ledger.parseProviderCreditObservation(observation({ operationCost: 1.5 })), /priced operation/)
  const priced = ledger.parseProviderCreditObservation(observation({ operation: "Collect", operationCost: 1.5, operationCostUnit: "USD", costBasis: "estimated" }))
  assert.equal(priced.costBasis, "estimated")
})

test("unauthenticated balance requests are denied before any provider operation", async () => {
  const route = await vite.ssrLoadModule("/app/api/admin/provider-credits/route.ts")
  const get = await route.GET(new Request("http://localhost/api/admin/provider-credits"))
  const post = await route.POST(new Request("http://localhost/api/admin/provider-credits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", provider: "lusha" }) }))
  assert.equal(get.status, 401)
  assert.equal(post.status, 401)
})

test("isolated D1 records Admin observations durably, keeps history, separates budgets and rejects PCOM", async () => {
  const db = new DatabaseSync(":memory:")
  const oldSecret = process.env.AUTH_SESSION_SECRET
  const oldLushaKey = process.env.LUSHA_API_KEY
  const oldBrightToken = process.env.BRIGHTDATA_API_TOKEN
  const oldFetch = globalThis.fetch
  try {
    db.exec("pragma foreign_keys=on")
    for (const name of (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("insert into application_users (id,display_name,email,role) values (1,'Synthetic Admin','admin@example.test','ADMIN'),(2,'Synthetic PCOM','pcom@example.test','PCOM')")
    db.exec("insert into application_identities (id,application_user_id,provider,provider_subject_id,verified_email,email_verified) values (1,1,'chatgpt','synthetic-admin','admin@example.test',1),(2,2,'chatgpt','synthetic-pcom','pcom@example.test',1)")
    db.exec("insert into provider_settings (provider,monthly_credit_limit) values ('coresignal',25)")
    db.exec("insert into provider_response_history (provider,alumnus_name,operation,mode,status,application_units) values ('coresignal','Synthetic','Mock Preview','mock','success',16)")
    process.env.AUTH_SESSION_SECRET = "synthetic-session-secret-at-least-thirty-two"
    delete process.env.LUSHA_API_KEY
    globalThis.fetch = async () => { throw new Error("An external request was not permitted in this test.") }
    cloudflare.env.DB = d1(db)
    const auth = await vite.ssrLoadModule("/lib/auth-session.ts")
    const route = await vite.ssrLoadModule("/app/api/admin/provider-credits/route.ts")
    const adminToken = await auth.createAppSessionToken({ applicationUserId: 1, applicationIdentityId: 1, provider: "chatgpt" })
    const pcomToken = await auth.createAppSessionToken({ applicationUserId: 2, applicationIdentityId: 2, provider: "chatgpt" })
    const send = (token, body) => route.POST(new Request("http://localhost/api/admin/provider-credits", { method: "POST", headers: { "content-type": "application/json", cookie: `corporate_network_session=${token}` }, body: JSON.stringify(body) }))
    const base = observation({ provider: "lusha", category: "general", unit: "credits", source: "admin_dashboard_attestation", sourceDetail: "Lusha dashboard", observedAt: "2026-10-21T09:00:00Z" })
    assert.equal((await send(pcomToken, { action: "attest", confirmed: true, observation: base })).status, 403)
    assert.equal((await send(adminToken, { action: "attest", confirmed: false, observation: base })).status, 400)
    assert.equal((await send(adminToken, { action: "attest", confirmed: true, observation: { ...base, available: -1 } })).status, 400)
    assert.equal((await send(adminToken, { action: "attest", confirmed: true, observation: base })).status, 200)
    assert.equal((await send(adminToken, { action: "attest", confirmed: true, observation: { ...base, available: 80, observedAt: "2026-10-21T10:00:00Z" } })).status, 200)
    assert.equal(db.prepare("select count(*) as n from security_audit_events where action='provider_credit_balance_observed'").get().n, 2)
    const response = await route.GET(new Request("http://localhost/api/admin/provider-credits", { headers: { cookie: `corporate_network_session=${adminToken}` } }))
    assert.equal(response.status, 200)
    const data = await response.json()
    const lusha = data.providers.find(row => row.provider === "lusha")
    assert.equal(lusha.observations[0].available, 80)
    assert.deepEqual(lusha.history.map(row => row.available), [80, 100])
    assert.equal(lusha.lastVerifiedAt, null)
    assert.equal(data.internalControls.find(row => row.provider === "coresignal").limit, 25)
    assert.equal(data.internalControls.find(row => row.provider === "coresignal").used, 16)
    assert.equal(data.internalControls.find(row => row.provider === "coresignal").remaining, 9)
    assert.equal(data.providers.find(row => row.provider === "coresignal").observations.length, 0)
    const searchEvidence = await vite.ssrLoadModule("/lib/coresignal-search-evidence.ts")
    const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
    const retained = searchEvidence.createCoresignalSearchEvidence({
      attemptId: "synthetic-search-attempt", filters: search.defaultDiscoveryFilters(), institutionId: 25919228,
      itemsPerPage: 1, requestedAt: "2026-10-21T10:00:00Z", completedAt: "2026-10-21T10:00:01Z",
      execution: { upstreamHttpStatus: 200, searchMode: "INSTITUTION_ONLY", companyMapping: { displayName: "", providerCompanyId: null }, providerCreditsRemaining: 4950,
        routing: { providerSearch: { totalResults: 1, pageIdsReceived: 1, totalPages: 1, nextPageAfter: null }, routes: [{ employeeId: "123456789", routingState: "IDENTITY_RESOLUTION_REQUIRED", mappedAlumnusId: null, profileFreshness: "NOT_EVALUATED" }] } },
    })
    db.prepare("insert into provider_response_history (provider,alumnus_name,operation,mode,status,response_summary) values (?,?,?,?,?,?)")
      .run("coresignal", "Synthetic", "Base Employee ES-DSL Search", "live", "success", searchEvidence.serializeCoresignalSearchEvidence("One synthetic response", retained))
    const withHeader = await (await route.GET(new Request("http://localhost/api/admin/provider-credits", { headers: { cookie: `corporate_network_session=${adminToken}` } }))).json()
    assert.equal(withHeader.providers.find(row => row.provider === "coresignal").observations[0].available, 4950)
    assert.equal(withHeader.providers.find(row => row.provider === "coresignal").observations[0].source, "authenticated_api")
    assert.equal((await route.GET(new Request("http://localhost/api/admin/provider-credits", { headers: { cookie: `corporate_network_session=${pcomToken}` } }))).status, 403)
    assert.equal((await send(adminToken, { action: "refresh", provider: "lusha" })).status, 409)
    process.env.LUSHA_API_KEY = "synthetic-account-test-key"
    let usageCalls = 0
    globalThis.fetch = async url => {
      usageCalls += 1
      assert.equal(String(url), "https://api.lusha.com/account/usage")
      return new Response(JSON.stringify({ usage: { bulkCredits: { total: 33, used: 4, remaining: 29 } } }), { status: 200 })
    }
    const refreshed = await send(adminToken, { action: "refresh", provider: "lusha" })
    assert.equal(refreshed.status, 200)
    assert.equal((await refreshed.json()).refreshState, "verified")
    assert.equal(usageCalls, 1)
    assert.equal((await (await send(adminToken, { action: "refresh", provider: "lusha" })).json()).refreshState, "cached")
    assert.equal(usageCalls, 1)
    const latest = await (await route.GET(new Request("http://localhost/api/admin/provider-credits", { headers: { cookie: `corporate_network_session=${adminToken}` } }))).json()
    const verified = latest.providers.find(row => row.provider === "lusha")
    assert.equal(verified.observations[0].source, "authenticated_api")
    assert.equal(verified.observations[0].available, 29)
    assert.equal(verified.history.length, 3)
    assert.equal(db.prepare("select count(*) as n from security_audit_events where action='provider_credit_balance_observed'").get().n, 3)
    process.env.BRIGHTDATA_API_TOKEN = "synthetic-account-test-token"
    globalThis.fetch = async url => { assert.equal(String(url), "https://api.brightdata.com/customer/balance"); return new Response("{}", { status: 403 }) }
    const denied = await send(adminToken, { action: "refresh", provider: "brightdata" })
    assert.equal(denied.status, 502)
    assert.equal((await denied.json()).code, "authentication_error")
    assert.equal(db.prepare("select count(*) as n from security_audit_events where action='provider_credit_balance_refresh_failed'").get().n, 1)
  } finally {
    cloudflare.env.DB = undefined
    globalThis.fetch = oldFetch
    if (oldSecret === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = oldSecret
    if (oldLushaKey === undefined) delete process.env.LUSHA_API_KEY; else process.env.LUSHA_API_KEY = oldLushaKey
    if (oldBrightToken === undefined) delete process.env.BRIGHTDATA_API_TOKEN; else process.env.BRIGHTDATA_API_TOKEN = oldBrightToken
    db.close()
  }
})
