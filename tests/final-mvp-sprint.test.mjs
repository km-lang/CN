import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const limits = await vite.ssrLoadModule("/lib/discovery-limit.ts")
const usage = await vite.ssrLoadModule("/lib/provider-usage.ts")
const signals = await vite.ssrLoadModule("/lib/lusha-signals.ts")
const mail = await vite.ssrLoadModule("/lib/mail-service.ts")
const policy = await vite.ssrLoadModule("/lib/security-policy.ts")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const signalsRoute = await readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8")
const engagementRoute = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")
const workspaceRoute = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")
const migration = await readFile(new URL("../drizzle/0009_shiny_stranger.sql", import.meta.url), "utf8")
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8")

for (const value of [1, 3, 7, 19]) {
  test(`final sprint PDL count accepts ${value}`, () => assert.equal(limits.validateDiscoveryCount(value, 19, 20).ok, true))
}

test("final sprint PDL count rejects above remaining allowance", () => {
  assert.deepEqual(limits.validateDiscoveryCount(20, 19, 20).reason, "remaining_allowance")
})

for (const value of [0, -1, 1.5, "7", Number.NaN]) {
  test(`final sprint PDL count rejects ${String(value)}`, () => assert.equal(limits.validateDiscoveryCount(value, 19, 20).ok, false))
}

test("final sprint PDL server independently validates bypass attempts", () => {
  assert.match(discoveryRoute, /validateDiscoveryCount\(requestedLimit, remaining, providerMaximum\)/)
  assert.match(discoveryRoute, /status: 400/)
})

test("final sprint persists requested separately from returned and provider usage", () => {
  assert.match(schema, /requestedCount: integer\("requested_count"\)/)
  assert.match(discoveryRoute, /requestedCount: limit/)
  assert.match(discoveryRoute, /returnedCount: response\.profiles\.length/)
  assert.match(discoveryRoute, /creditsUsed: response\.creditsUsed/)
})

test("final sprint PDL confirmation lists active filters and actual-usage warning", () => {
  for (const label of ["Education", "Company", "Role", "Function", "Seniority", "Location", "Graduation year", "Profiles requested", "Application credits remaining", "Maximum potential result usage"]) assert.match(page, new RegExp(label))
  assert.match(page, /Actual provider usage and the number of profiles returned/)
})

test("final sprint usage state records exact provider usage", () => assert.equal(usage.providerUsageState(3), "provider_reported"))
test("final sprint usage state records genuine provider zero", () => assert.equal(usage.providerUsageState(0), "provider_reported_zero"))
test("final sprint usage state requires reconciliation when absent", () => assert.equal(usage.providerUsageState(null), "reconciliation_required"))
test("final sprint usage state supports not applicable", () => assert.equal(usage.providerUsageState(null, false), "not_applicable"))

test("final sprint UI never presents missing successful Lusha usage as zero", () => {
  const label = usage.providerUsageLabel({ provider: "lusha", status: "success", creditsUsed: 0, responseSummary: "Per-call usage was not returned; reconcile against Lusha account usage." })
  assert.equal(label.label, "Reconciliation required")
})

test("final sprint reconciled account usage is distinguished from provider metadata", () => {
  const label = usage.providerUsageLabel({ usageState: "reconciled_account_usage", reconciledCredits: 2 })
  assert.equal(label.label, "2")
  assert.match(label.detail, /Observed account-usage delta/)
})

test("final sprint reconciliation is Admin-only and centrally audited", () => {
  assert.match(enrichmentRoute, /payload\.action === "reconcile_usage" \? "MANAGE_PROVIDER_SETTINGS"/)
  assert.match(enrichmentRoute, /provider_usage_reconciled/)
  assert.equal(policy.hasPermission("PCOM", "MANAGE_PROVIDER_SETTINGS"), false)
})

test("final sprint promotion signal normalization is individual and review-first", () => {
  const result = signals.normalizeLushaSignals(15, { results: [{ id: "s1", type: "promotion", previous: { company: "A", title: "Manager" }, current: { company: "A", title: "Director" }, occurredAt: "2026-09-10" }] }, "2026-09-14T00:00:00Z")
  assert.equal(result[0].eventSubtype, "Promotion")
  assert.equal(result[0].alumnusId, 15)
  assert.equal(result[0].newRole, "Director")
})

test("final sprint company-change signal normalization preserves before and after", () => {
  const result = signals.normalizeLushaSignals(15, { data: [{ signalId: "s2", signalType: "job_change", from: { company: "Google", role: "Lead" }, to: { company: "Magnite", role: "Country Manager" }, eventDate: "2026-08-01" }] })
  assert.equal(result[0].eventSubtype, "Company Change")
  assert.equal(result[0].previousCompany, "Google")
  assert.equal(result[0].newCompany, "Magnite")
})

test("final sprint unsupported company-level signals are ignored", () => {
  assert.deepEqual(signals.normalizeLushaSignals(15, { results: [{ id: "x", type: "hiring_surge" }] }), [])
})

test("final sprint Signals sync is disabled before entitlement without a provider call", () => {
  assert.match(signalsRoute, /runtime\.entitlement !== "confirmed"/)
  assert.match(signalsRoute, /No provider call was made/)
  assert.match(envExample, /LUSHA_SIGNALS_LIVE_ENABLED=false/)
  assert.match(envExample, /LUSHA_SIGNALS_ENTITLEMENT=unverified/)
})

test("final sprint signals never silently overwrite alumni", () => {
  assert.doesNotMatch(signalsRoute, /db\.update\(alumni\)/)
  assert.match(signalsRoute, /status: "New"/)
  assert.match(engagementRoute, /signal_marked_incorrect/)
  assert.doesNotMatch(engagementRoute, /delete\(engagementEvents\)/)
})

test("final sprint Gmail adapter is independently gated and server-only", () => {
  assert.match(envExample, /MAIL_LIVE_ENABLED=false/)
  assert.match(envExample, /GMAIL_REFRESH_TOKEN=/)
  assert.doesNotMatch(page, /GMAIL_CLIENT_SECRET|GMAIL_REFRESH_TOKEN/)
})

test("final sprint Gmail adapter sends only through injected mock transport", async () => {
  const previous = Object.fromEntries(["MAIL_MODE", "MAIL_LIVE_ENABLED", "MAIL_PROVIDER", "MAIL_SENDER_EMAIL", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"].map(key => [key, process.env[key]]))
  Object.assign(process.env, { MAIL_MODE: "live", MAIL_LIVE_ENABLED: "true", MAIL_PROVIDER: "gmail", MAIL_SENDER_EMAIL: "pcom@example.edu", GMAIL_CLIENT_ID: "test-id", GMAIL_CLIENT_SECRET: "test-secret", GMAIL_REFRESH_TOKEN: "test-refresh" })
  const calls = []
  try {
    const result = await mail.sendMail({ recipient: "alumnus@example.org", subject: "Approved", body: "Hello" }, { fetcher: async (url, init) => {
      calls.push({ url: String(url), init })
      return calls.length === 1
        ? new Response(JSON.stringify({ access_token: "mock-access-token" }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ id: "gmail-message-1" }), { status: 200, headers: { "content-type": "application/json" } })
    } })
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
    assert.equal(result.messageId, "gmail-message-1")
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
})

test("final sprint mail requires human approval and stores approval provenance", () => {
  assert.match(engagementRoute, /Human approval is required after preview and before sending/)
  assert.match(page, /Approve & Send/)
  for (const field of ["sender", "recipient", "purpose", "templateVersion", "approvedBy", "approvedAt"]) assert.match(schema, new RegExp(field))
})

test("final sprint mail rejects Unknown preference as consent", () => {
  assert.match(engagementRoute, /Unknown is not consent/)
  assert.match(engagementRoute, /explicitProfessionalPermission/)
  assert.match(engagementRoute, /explicitBirthdayPermission/)
})

test("final sprint professional conflict is represented without profile overwrite", () => {
  assert.match(schema, /professionalDataStatus/)
  assert.match(workspaceRoute, /Conflict — manual verification required/)
  assert.match(enrichmentRoute, /No profile field was overwritten/)
  assert.match(page, /Provider success does not prove freshness/)
})

test("final sprint migration is additive", () => {
  assert.match(migration, /ADD `requested_count`/)
  assert.match(migration, /ADD `usage_state`/)
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|DROP COLUMN/i)
})

test("final sprint RBAC preserves PCOM operations and Admin-only controls", () => {
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("PCOM", "MANAGE_PROVIDER_SETTINGS"), false)
  assert.equal(policy.hasPermission("ADMIN", "MANAGE_PROVIDER_SETTINGS"), true)
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false)
})
