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
const signalsRuntimeModule = await vite.ssrLoadModule("/lib/provider-runtime.ts")
const mail = await vite.ssrLoadModule("/lib/mail-service.ts")
const policy = await vite.ssrLoadModule("/lib/security-policy.ts")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const signalsRoute = await readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8")
const engagementRoute = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")
const adminRoute = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const adminPanel = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
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
  const searchInsert = discoveryRoute.match(/db\.insert\(externalDiscoverySearches\)\.values\(\{([\s\S]*?)\}\)\.returning\(\)/)?.[1] ?? ""
  const providerHistoryInsert = discoveryRoute.match(/db\.insert\(providerResponseHistory\)\.values\(\{\s*provider: "pdl",\s*alumnusName: "External alumni discovery",\s*searchId: search\.id,([\s\S]*?)\}\)/)?.[1] ?? ""
  assert.match(searchInsert, /requestedCount: limit/)
  assert.match(searchInsert, /resultCount: response\.profiles\.length/)
  assert.doesNotMatch(searchInsert, /providerReportedCredits|usageState/)
  assert.match(providerHistoryInsert, /providerReportedCredits: response\.creditsUsed/)
  assert.match(providerHistoryInsert, /usageState: providerUsageState\(response\.creditsUsed\)/)
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

test("final sprint Signals uses the documented contact endpoint and contract with the stable ID", async () => {
  const previous = Object.fromEntries(["LUSHA_API_KEY", "LUSHA_SIGNALS_LIVE_ENABLED", "LUSHA_SIGNALS_ENTITLEMENT"].map(key => [key, process.env[key]]))
  Object.assign(process.env, { LUSHA_API_KEY: "mock-key", LUSHA_SIGNALS_LIVE_ENABLED: "true", LUSHA_SIGNALS_ENTITLEMENT: "confirmed" })
  const calls = []
  try {
    await signals.fetchLushaContactSignals([{ alumnusId: 15, lushaPersonId: "stable-115889" }], { startDate: "2026-03-14", fetcher: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ contacts: { "stable-115889": { personId: "115889", promotion: [], companyChange: [] } }, creditCharged: 1 }), { status: 200, headers: { "content-type": "application/json" } })
    } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://api.lusha.com/api/signals/contacts")
    assert.deepEqual(calls[0].body, { contacts: [{ id: "stable-115889" }], signals: ["promotion", "companyChange"], startDate: "2026-03-14" })
    assert.doesNotMatch(calls[0].url, /\/v3\/contacts\/signals|\/contacts\/search/)
    assert.doesNotMatch(JSON.stringify(calls[0].body), /job_change|allSignals/)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("final sprint nested contact Signals normalize multiple promotion and company-change events", () => {
  const body = { contacts: { "stable-115889": { personId: "115889", promotion: [
    { id: "p1", previousCompanyName: "A", previousTitle: "Manager", currentCompanyName: "A", currentTitle: "Director", signalDate: "2026-09-10" },
    { id: "p2", currentCompanyName: "A", currentTitle: "VP", signalDate: "2026-09-12" },
  ], companyChange: [
    { id: "c1", previousCompanyName: "Google", previousTitle: "Lead", currentCompanyName: "Magnite", currentTitle: "Country Manager", signalDate: "2026-08-01" },
    { id: "c2", previousCompanyName: "Magnite", currentCompanyName: "Example", signalDate: "2026-09-01" },
  ], hiring: [{ id: "excluded" }] } }, creditCharged: 1 }
  const result = signals.normalizeLushaSignals(15, body, "2026-09-14T00:00:00Z", "stable-115889")
  assert.equal(result.length, 4)
  assert.deepEqual(result.map(item => item.eventSubtype), ["Promotion", "Promotion", "Company Change", "Company Change"])
  assert.equal(result[0].newRole, "Director")
  assert.equal(result[2].previousCompany, "Google")
  assert.equal(result[2].newCompany, "Magnite")
  assert.equal(new Set(result.map(item => item.eventKey)).size, 4)
})

test("final sprint empty contact Signals response creates no fake events", () => {
  assert.deepEqual(signals.normalizeLushaSignals(15, { contacts: { "stable-115889": { personId: "115889", promotion: [], companyChange: [] } } }, undefined, "stable-115889"), [])
})

test("final sprint Signals captures provider creditCharged without fabricating missing usage", () => {
  assert.equal(signals.providerReportedSignalCredits({ creditCharged: 1 }), 1)
  assert.equal(signals.providerReportedSignalCredits({ creditCharged: 0 }), 0)
  assert.equal(signals.providerReportedSignalCredits({}), null)
  assert.match(signalsRoute, /providerUsageState\(providerReportedCredits\)/)
  assert.match(signalsRoute, /Provider usage was not returned and requires reconciliation/)
})

test("final sprint Signals sync is disabled before entitlement without a provider call", () => {
  assert.match(signalsRoute, /runtime\.entitlement !== "confirmed"/)
  assert.match(signalsRoute, /No provider call was made/)
  assert.match(envExample, /LUSHA_SIGNALS_LIVE_ENABLED=false/)
  assert.match(envExample, /LUSHA_SIGNALS_ENTITLEMENT=unknown/)
})

test("final sprint signals never silently overwrite alumni", () => {
  assert.doesNotMatch(signalsRoute, /db\.update\(alumni\)/)
  assert.match(signalsRoute, /status: "New"/)
  assert.match(engagementRoute, /signal_marked_incorrect/)
  assert.doesNotMatch(engagementRoute, /delete\(engagementEvents\)/)
})

test("final sprint Signals duplicate, empty-result, and workflow behavior remains review-first", () => {
  assert.match(signalsRoute, /onConflictDoNothing\(\)/)
  assert.match(signalsRoute, /No new professional signals found for the selected period/)
  assert.match(page, /Mark Signal Incorrect/)
  for (const status of ["New", "Viewed", "Acknowledged", "Action Planned", "Action Taken", "Response Received", "Follow-up Due", "Closed", "Skipped"]) assert.match(`${page}\n${engagementRoute}`, new RegExp(status))
  assert.match(engagementRoute, /event\.status === "New" \? "Viewed" : event\.status/)
})

test("final sprint one-contact confirmation is explicit, gated, and opening it makes no provider request", () => {
  assert.match(page, /Check Professional Signals/)
  assert.match(page, /Confirm One-Contact Signals Test/)
  assert.match(page, /Cancel — No Provider Call/)
  assert.match(page, /Opening this review does not call the provider/)
  assert.match(page, /setSignalsConfirmOpen\(true\)/)
  assert.match(page, /alumniIds: \[signalsTarget\.id\], confirmed: true/)
  assert.match(signalsRoute, /ids\.length !== 1/)
})

test("final sprint Signals RBAC is enforced server-side", () => {
  assert.match(signalsRoute, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("ADMIN", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false)
})

test("final readiness Signals gate and all entitlement states remain independent", () => {
  const previous = Object.fromEntries(["LUSHA_LIVE_ENABLED", "LUSHA_SIGNALS_LIVE_ENABLED", "LUSHA_SIGNALS_ENTITLEMENT"].map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, { LUSHA_LIVE_ENABLED: "true", LUSHA_SIGNALS_LIVE_ENABLED: "false", LUSHA_SIGNALS_ENTITLEMENT: "unknown" })
    assert.equal(signalsRuntime().liveEnabled, false)
    assert.equal(signalsRuntime().entitlement, "unknown")
    process.env.LUSHA_SIGNALS_ENTITLEMENT = "confirmed"
    assert.equal(signalsRuntime().entitlement, "confirmed")
    process.env.LUSHA_SIGNALS_ENTITLEMENT = "not_entitled"
    assert.equal(signalsRuntime().entitlement, "not_entitled")
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

function signalsRuntime() {
  return signalsRuntimeModule.signalsRuntimeStatus()
}

test("final readiness supports any selected alumnus and reports missing stable identity", () => {
  assert.match(page, /Select approved alumnus/)
  assert.match(page, /Stable Lusha ID available/)
  assert.match(page, /Lusha contact identity required before Professional Signals can be checked/)
  assert.doesNotMatch(page, /person\.name === "Sahil Bansal"/)
  assert.match(page, /signalsActive && <Button/)
})

test("final readiness Admin alone sees component-level operational status", () => {
  for (const label of ["People Data Labs", "Lusha Contacts", "Lusha Professional Signals", "Institutional Mail", "Gmail send permission", "Last connectivity validation"]) assert.match(adminPanel, new RegExp(label))
  assert.match(adminRoute, /authorizeRequest\(request, "MANAGE_USERS"\)/)
  assert.match(adminRoute, /operationalReadiness/)
  assert.doesNotMatch(page, /GMAIL_CLIENT_SECRET|GMAIL_REFRESH_TOKEN/)
})

test("final readiness mail confirmation is editable and makes no call until final approval", () => {
  assert.match(page, /setMailPreview\(\{ \.\.\.mailPreview, subject:/)
  assert.match(page, /setMailPreview\(\{ \.\.\.mailPreview, body:/)
  assert.match(page, /Opening this confirmation makes zero mail calls/)
  for (const label of ["From", "To", "Subject", "Purpose / event", "Communication status", "Duplicate-send status", "Mail provider", "Mode"]) assert.match(page, new RegExp(label))
  assert.match(engagementRoute, /duplicateStatus: "No duplicate send found"/)
})

test("final readiness mail rejects invalid recipient before any transport", async () => {
  let calls = 0
  await assert.rejects(() => mail.sendMail({ recipient: "invalid", subject: "Subject", body: "Body" }, { fetcher: async () => { calls += 1; return new Response() } }), /valid recipient/)
  assert.equal(calls, 0)
})

test("final readiness mail distinguishes disabled live gate", async () => {
  const previous = { mode: process.env.MAIL_MODE, gate: process.env.MAIL_LIVE_ENABLED }
  Object.assign(process.env, { MAIL_MODE: "live", MAIL_LIVE_ENABLED: "false" })
  try { await assert.rejects(() => mail.sendMail({ recipient: "a@example.org", subject: "Subject", body: "Body" }), /Live institutional mail is disabled/) }
  finally {
    if (previous.mode === undefined) delete process.env.MAIL_MODE
    else process.env.MAIL_MODE = previous.mode
    if (previous.gate === undefined) delete process.env.MAIL_LIVE_ENABLED
    else process.env.MAIL_LIVE_ENABLED = previous.gate
  }
})

test("final readiness mail maps revoked OAuth and insufficient Gmail scope", async () => {
  const keys = ["MAIL_MODE", "MAIL_LIVE_ENABLED", "MAIL_PROVIDER", "MAIL_SENDER_EMAIL", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SEND_SCOPE_CONFIRMED"]
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  Object.assign(process.env, { MAIL_MODE: "live", MAIL_LIVE_ENABLED: "true", MAIL_PROVIDER: "gmail", MAIL_SENDER_EMAIL: "pcom@example.edu", GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "refresh", GMAIL_SEND_SCOPE_CONFIRMED: "true" })
  try {
    await assert.rejects(() => mail.sendMail({ recipient: "a@example.org", subject: "Subject", body: "Body" }, { fetcher: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }), /expired or been revoked/)
    let call = 0
    await assert.rejects(() => mail.sendMail({ recipient: "a@example.org", subject: "Subject", body: "Body" }, { fetcher: async () => ++call === 1 ? new Response(JSON.stringify({ access_token: "mock" }), { status: 200 }) : new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }) }), /insufficient Gmail send scope/)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("final sprint Gmail adapter is independently gated and server-only", () => {
  assert.match(envExample, /MAIL_LIVE_ENABLED=false/)
  assert.match(envExample, /GMAIL_REFRESH_TOKEN=/)
  assert.doesNotMatch(page, /GMAIL_CLIENT_SECRET|GMAIL_REFRESH_TOKEN/)
})

test("final sprint Gmail adapter sends only through injected mock transport", async () => {
  const previous = Object.fromEntries(["MAIL_MODE", "MAIL_LIVE_ENABLED", "MAIL_PROVIDER", "MAIL_SENDER_EMAIL", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SEND_SCOPE_CONFIRMED"].map(key => [key, process.env[key]]))
  Object.assign(process.env, { MAIL_MODE: "live", MAIL_LIVE_ENABLED: "true", MAIL_PROVIDER: "gmail", MAIL_SENDER_EMAIL: "pcom@example.edu", GMAIL_CLIENT_ID: "test-id", GMAIL_CLIENT_SECRET: "test-secret", GMAIL_REFRESH_TOKEN: "test-refresh", GMAIL_SEND_SCOPE_CONFIRMED: "true" })
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
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test("final sprint mail requires human approval and stores approval provenance", () => {
  assert.match(engagementRoute, /Human approval is required after preview and before sending/)
  assert.match(page, /Continue to Final Confirmation/)
  assert.match(page, /Approve and Send One Email/)
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
