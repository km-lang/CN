import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const { validateLushaSignalsEntitlement } = await vite.ssrLoadModule("/lib/lusha-signals-entitlement.ts")
const { hasPermission } = await vite.ssrLoadModule("/lib/security-policy.ts")
const route = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const panel = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8")
const provider = await readFile(new URL("../lib/lusha-signals-entitlement.ts", import.meta.url), "utf8")

test("Admin validates only contact Signals metadata with the server-side key", async () => {
  const calls = []
  const result = await validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers })
    return new Response(JSON.stringify({ signalTypes: ["allSignals", "promotion", "companyChange"], billing: { creditsCharged: 0 } }), { status: 200 })
  } })
  assert.deepEqual(calls, [{ url: "https://api.lusha.com/v3/contacts/signals/types", method: "GET", headers: { api_key: "mock-secret", accept: "application/json" } }])
  assert.equal(result.entitlement, "confirmed")
  assert.equal(result.promotionAvailable, true)
  assert.equal(result.companyChangeAvailable, true)
  assert.equal(result.providerReportedCredits, 0)
  assert.deepEqual(result.signalTypes, ["allSignals", "promotion", "companyChange"])
  assert.doesNotMatch(JSON.stringify(result), /mock-secret/)
})

test("explicit 403 entitlement denial is distinct from ambiguous authentication and outages", async () => {
  const checked = async status => validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async () => new Response("secret provider payload", { status }) })
  assert.deepEqual([ (await checked(403)).entitlement, (await checked(401)).entitlement, (await checked(502)).entitlement ], ["not_entitled", "unknown", "unknown"])
  assert.equal((await checked(403)).outcome, "entitlement_denied")
  assert.doesNotMatch(JSON.stringify(await checked(502)), /secret provider payload/)
})

test("timeouts, malformed success, and missing capability remain unknown", async () => {
  const timeout = await validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async () => { throw new DOMException("timed out", "TimeoutError") } })
  const malformed = await validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async () => new Response("not json", { status: 200 }) })
  const partial = await validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async () => new Response(JSON.stringify({ signalTypes: ["promotion"] }), { status: 200 }) })
  assert.deepEqual([timeout.entitlement, malformed.entitlement, partial.entitlement], ["unknown", "unknown", "unknown"])
  assert.equal(timeout.outcome, "timeout")
  assert.equal(malformed.outcome, "malformed_response")
  assert.equal(partial.companyChangeAvailable, false)
})

test("missing usage is null, including on successful metadata checks", async () => {
  const result = await validateLushaSignalsEntitlement({ apiKey: "mock-secret", fetcher: async () => new Response(JSON.stringify({ signalTypes: ["promotion", "companyChange", "mock-secret"] }), { status: 200 }) })
  assert.equal(result.entitlement, "confirmed")
  assert.equal(result.providerReportedCredits, null)
  assert.doesNotMatch(JSON.stringify(result), /mock-secret/)
})

test("Admin-only authorization precedes the provider call and rejects other roles and disabled sessions", () => {
  assert.equal(hasPermission("ADMIN", "MANAGE_USERS"), true)
  assert.equal(hasPermission("PCOM", "MANAGE_USERS"), false)
  assert.equal(hasPermission("DEVELOPER", "MANAGE_USERS"), false)
  assert.match(security, /if \(!user\.enabled\)/)
  assert.match(security, /if \(!claims\) throw new AccessError\("Authentication is required\.", 401/)
  const auth = route.indexOf('await authorizeRequest(request, "MANAGE_USERS")', route.indexOf("export async function POST"))
  const call = route.indexOf("await validateLushaSignalsEntitlement()")
  assert.ok(auth >= 0 && auth < call)
  assert.match(route, /action: "lusha_signals_entitlement_validated"/)
  assert.match(panel, /Validate Signals Entitlement/)
})

test("validation never enables Signals, writes secrets, or performs a person-level request", () => {
  assert.doesNotMatch(provider, /\/v3\/contacts\/signals"|method: "POST"|\/v3\/contacts\/search|\/v3\/contacts\/enrich/)
  assert.doesNotMatch(route, /process\.env\.LUSHA_SIGNALS_\w+\s*=|db\.update\(providerSettings\)/)
  assert.doesNotMatch(panel, /setEnvironment|updateEnvironmentVariables/)
  assert.match(route, /writeSecurityAudit\(context/)
  assert.match(panel, /This validation changes none of these settings/)
})
