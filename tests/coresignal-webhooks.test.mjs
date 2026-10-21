import assert from "node:assert/strict"
import test, { after } from "node:test"
import { createServer } from "vite"
import { DatabaseSync } from "node:sqlite"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const webhook = await vite.ssrLoadModule("/lib/coresignal-webhooks.ts")
const receiver = await vite.ssrLoadModule("/app/api/webhooks/coresignal/[subscriptionId]/[token]/route.ts")
const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")

async function isolatedDb() {
  const db = new DatabaseSync(":memory:")
  db.exec("pragma foreign_keys=on")
  for (const name of (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
  return db
}
function d1(db) {
  const binding = {
    prepare(statement) {
      return { bind(...values) {
        const query = db.prepare(statement)
        return {
          first: async () => query.get(...values) ?? null,
          all: async () => ({ results: query.all(...values) }),
          raw: async () => { query.setReturnArrays(true); return query.all(...values) },
          run: async () => ({ meta: { changes: query.run(...values).changes } }),
        }
      } }
    },
    batch: async queries => {
      const results = []
      for (const query of queries) results.push(await query.run())
      return results
    },
  }
  return binding
}

test("mapping classification excludes provisional, missing, conflicting and already covered IDs", () => {
  const people = [
    { id: 1, coresignalEmployeeId: "111", intakeStatus: "VERIFIED", profileMatch: "Match", linkedinUrl: "" },
    { id: 2, coresignalEmployeeId: "222", intakeStatus: "VERIFIED", profileMatch: "Match", linkedinUrl: "" },
    { id: 3, coresignalEmployeeId: "333", intakeStatus: "PROVISIONAL", profileMatch: "Match", linkedinUrl: "" },
    { id: 4, coresignalEmployeeId: "444", intakeStatus: "VERIFIED", profileMatch: "Mismatch", linkedinUrl: "" },
    { id: 5, coresignalEmployeeId: "555", intakeStatus: "VERIFIED", profileMatch: "Match", linkedinUrl: "" },
  ]
  const attestations = [
    { alumnusId: 1, employeeId: "111", namespace: "employee_base", status: "VERIFIED" },
    { alumnusId: 3, employeeId: "333", namespace: "employee_base", status: "VERIFIED" },
    { alumnusId: 4, employeeId: "444", namespace: "employee_base", status: "VERIFIED" },
    { alumnusId: 5, employeeId: "different", namespace: "employee_base", status: "VERIFIED" },
  ]
  const result = webhook.classifyWebhookMembers([1, 2, 3, 4, 5, 1, 99], people, attestations, [{ alumnusId: 1, employeeId: "111" }])
  assert.deepEqual(result.map(item => item.status), ["ALREADY_COVERED", "PENDING_PROVIDER_MAPPING", "IDENTITY_REVIEW_REQUIRED", "IDENTITY_REVIEW_REQUIRED", "IDENTITY_REVIEW_REQUIRED", "IDENTITY_REVIEW_REQUIRED"])
  assert.deepEqual(webhook.classifyWebhookMembers([1], people, attestations, [])[0].status, "ELIGIBLE")
})

test("reconciliation retains current overlap and reports only additions/removals", () => {
  assert.deepEqual(webhook.coverageReconciliation(["111", "333", "111"], ["111", "222"]), { add: ["333"], remove: ["222"], unchanged: ["111"] })
  const now = new Date("2026-10-20T00:00:00Z")
  assert.equal(webhook.effectiveSubscriptionStatus("ACTIVE", "2026-07-31T00:00:00Z", "2026-10-30T00:00:00Z", now), "RENEWAL_DUE")
  assert.equal(webhook.effectiveSubscriptionStatus("ACTIVE", "2026-07-31T00:00:00Z", "2026-10-01T00:00:00Z", now), "EXPIRED")
  assert.equal(webhook.effectiveSubscriptionStatus("STOPPED", "", "", now), "STOPPED")
})

test("strict callback notice parsing and HMAC authentication reject forgery", async () => {
  const secret = "synthetic-secret-at-least-thirty-two-characters"
  const token = await webhook.callbackToken(17, secret)
  assert.equal(await webhook.callbackAuthorized(17, token, secret), true)
  assert.equal(await webhook.callbackAuthorized(18, token, secret), false)
  assert.equal(await webhook.callbackAuthorized(17, "0".repeat(64), secret), false)
  assert.deepEqual(webhook.parseWebhookNotices([{ member_id: 123456789, status: "changed", changed_fields: ["experience"], event_id: "synthetic-1" }]), [{ employeeId: "123456789", changeType: "changed", changedFields: ["experience"], providerAt: "", eventId: "synthetic-1" }])
  assert.throws(() => webhook.parseWebhookNotices([{ member_id: "bad", status: "changed" }]))
  assert.throws(() => webhook.parseWebhookNotices([{ member_id: 1, status: "promoted", company: "False proof" }]))
  assert.throws(() => webhook.parseWebhookNotices(Array.from({ length: 101 }, () => ({ member_id: 1, status: "changed" }))))
})

test("mock transport requires explicit isolated Admin loopback gates", () => {
  const allowed = { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1", LOCAL_DEV_D1_PERSIST_PATH: "/tmp/synthetic-webhook-d1", CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true" }
  assert.equal(webhook.webhookMockEnabled(allowed), true)
  assert.equal(webhook.webhookMockEnabled({ ...allowed, LOCAL_DEV_D1_PERSIST_PATH: "" }), false)
  assert.equal(webhook.webhookMockEnabled({ ...allowed, LOCAL_DEV_AUTH_ROLE: "PCOM" }), false)
  assert.equal(webhook.webhookMockEnabled({ ...allowed, CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "false" }), false)
})

test("local Cloudflare binding forwards mock flags only with outside-repository persistence and loopback", async () => {
  const config = await readFile(join(root, "vite.config.ts"), "utf8")
  assert.match(config, /localWebhookMock[\s\S]*absolutePersistPath[\s\S]*!absolutePersistPath\.startsWith/)
  assert.match(config, /realpathSync\(localPersistPath\)/)
  assert.match(config, /temporaryRoots\.some\(root => absolutePersistPath\.startsWith/)
  assert.match(config, /LOCAL_DEV_D1_PERSIST_PATH: localWebhookMock \? absolutePersistPath : ""/)
  assert.match(config, /CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: localWebhookMock \? "true" : "false"/)
  assert.match(config, /host: localCoresignalDemo \|\| localBrightDataDemo \|\| localWebhookMock \? "127\.0\.0\.1"/)
})

test("receiver is disabled by default before any body or database access", async () => {
  const before = process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED
  try {
    delete process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED
    const response = await receiver.POST(new Request("https://example.test/api/webhooks/coresignal/1/invalid", { method: "POST", body: "{}" }), { params: Promise.resolve({ subscriptionId: "1", token: "invalid" }) })
    assert.equal(response.status, 503)
  } finally { if (before === undefined) delete process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED; else process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED = before }
})

test("isolated migrations persist subscriptions, coverage and event dedupe without original D1", async () => {
  const db = await isolatedDb()
  try {
    db.prepare("insert into alumni (profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location,intake_status,coresignal_employee_id) values (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("synthetic:webhook", "Synthetic Alumna", "SA", 2019, "PGP", "Example Co", "Director", "Finance", "Director", "India", "VERIFIED", "111")
    const alumnusId = db.prepare("select id from alumni where profile_key='synthetic:webhook'").get().id
    db.prepare("insert into coresignal_webhook_identities (alumnus_id,employee_id,evidence_reference,verified_by) values (?,?,?,?)").run(alumnusId, "111", "Synthetic ID attestation", "Synthetic Admin")
    db.prepare("insert into coresignal_webhook_subscriptions (name,cohort_type,selection_json,selection_version,membership_json,created_by,status,provider_subscription_id) values (?,?,?,?,?,?,?,?)")
      .run("Synthetic priority", "FIXED_IDS", `[${alumnusId}]`, "fixed-cn-ids-v1", `[{\"alumnusId\":${alumnusId},\"employeeId\":\"111\"}]`, "Synthetic Admin", "ACTIVE", "mock-1")
    const planId = db.prepare("select id from coresignal_webhook_subscriptions where provider_subscription_id='mock-1'").get().id
    db.prepare("insert into coresignal_webhook_coverage (subscription_id,alumnus_id,employee_id) values (?,?,?)").run(planId, alumnusId, "111")
    assert.throws(() => db.prepare("insert into coresignal_webhook_coverage (subscription_id,alumnus_id,employee_id) values (?,?,?)").run(planId, alumnusId, "111"))
    db.prepare("insert into coresignal_webhook_subscriptions (name,cohort_type,selection_json,selection_version,membership_json,created_by) values (?,?,?,?,?,?)")
      .run("Second synthetic cohort", "FIXED_IDS", `[${alumnusId}]`, "fixed-cn-ids-v1", "[]", "Synthetic Admin")
    const otherPlanId = db.prepare("select id from coresignal_webhook_subscriptions where name='Second synthetic cohort'").get().id
    assert.throws(() => db.prepare("insert into coresignal_webhook_coverage (subscription_id,alumnus_id,employee_id) values (?,?,?)").run(otherPlanId, alumnusId, "111"))
    const event = db.prepare("insert or ignore into coresignal_webhook_events (subscription_id,alumnus_id,employee_id,change_type,payload_digest,dedupe_window,status) values (?,?,?,?,?,?,?)")
    event.run(planId, alumnusId, "111", "changed", "digest-1", "provider-event-id", "AWAITING_PROFILE_COLLECTION")
    event.run(planId, alumnusId, "111", "changed", "digest-1", "provider-event-id", "AWAITING_PROFILE_COLLECTION")
    assert.equal(db.prepare("select count(*) as count from coresignal_webhook_events").get().count, 1)
    assert.deepEqual(db.prepare("pragma foreign_key_check").all(), [])
  } finally { db.close() }
})

test("event-scoped Collect claim reserves the 10-credit estimate atomically and fences replay", async () => {
  const db = await isolatedDb()
  try {
    const route = await readFile(join(root, "app/api/admin/coresignal-collect/route.ts"), "utf8")
    const statement = route.match(/const WEBHOOK_COLLECT_CLAIM_SQL = `([\s\S]*?)`/)?.[1]
    assert.ok(statement)
    db.exec("insert into alumni (id,profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) values (1,'synthetic:claim','Synthetic Alumna','SA',2020,'PGP','Example Co','Director','Finance','Director','India')")
    db.exec("insert into provider_settings (provider,monthly_credit_limit) values ('coresignal',25)")
    const claim = eventId => db.prepare(statement).get(1, "Alumnus 1", "Base Employee Collect-only", 10, `Webhook event #${eventId} Collect-only · Employee ID 111`, "Synthetic claim", "Synthetic Admin", "Base Employee Collect-only", `Webhook event #${eventId} Collect-only · Employee ID 111`, 10, "2000-01-01T00:00:00Z")
    assert.ok(claim(1)?.id)
    assert.equal(claim(1), undefined)
    assert.ok(claim(2)?.id)
    assert.equal(claim(3), undefined)
    assert.equal(db.prepare("select sum(application_units) as units from provider_response_history").get().units, 20)
  } finally { db.close() }
})

test("authenticated mocked receiver stores a signal once, quarantines unknown IDs and never collects", async () => {
  const db = await isolatedDb()
  const oldEnabled = process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED
  const oldSecret = process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET
  try {
    process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED = "true"
    process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET = "synthetic-secret-at-least-thirty-two-characters"
    cloudflare.env.DB = d1(db)
    db.prepare("insert into alumni (profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location,intake_status,coresignal_employee_id) values (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("synthetic:receiver", "Synthetic Alumna", "SA", 2019, "PGP", "Example Co", "Director", "Finance", "Director", "India", "VERIFIED", "111")
    const alumnusId = db.prepare("select id from alumni where profile_key='synthetic:receiver'").get().id
    db.prepare("insert into coresignal_webhook_identities (alumnus_id,employee_id,evidence_reference,verified_by) values (?,?,?,?)").run(alumnusId, "111", "Synthetic exact-ID attestation", "Synthetic Admin")
    db.prepare("insert into coresignal_webhook_subscriptions (name,cohort_type,selection_json,selection_version,membership_json,created_by,status,provider_subscription_id,expires_at) values (?,?,?,?,?,?,?,?,?)")
      .run("Synthetic priority", "FIXED_IDS", `[${alumnusId}]`, "fixed-cn-ids-v1", "[]", "Synthetic Admin", "ACTIVE", "mock-1", "2099-01-01T00:00:00.000Z")
    const planId = db.prepare("select id from coresignal_webhook_subscriptions where provider_subscription_id='mock-1'").get().id
    db.prepare("insert into coresignal_webhook_coverage (subscription_id,alumnus_id,employee_id) values (?,?,?)").run(planId, alumnusId, "111")
    const token = await webhook.callbackToken(planId, process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET)
    const endpoint = `https://example.test/api/webhooks/coresignal/${planId}/${token}`
    const body = JSON.stringify([{ member_id: 111, status: "changed", changed_fields: ["experience"], event_id: "event-1", event_at: "2026-10-19T00:00:00Z" }, { member_id: 999, status: "changed", event_id: "event-unknown" }])
    const invoke = (url, data = body) => receiver.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: data }), { params: Promise.resolve({ subscriptionId: String(planId), token: url.split("/").at(-1) }) })
    assert.equal((await invoke(endpoint.replace(token, "0".repeat(64)))).status, 401)
    const first = await invoke(endpoint)
    assert.equal(first.status, 202)
    assert.deepEqual(await first.json(), { stored: 2, duplicates: 0, providerRequests: 0, canonicalMutations: 0 })
    const replay = await invoke(endpoint)
    assert.deepEqual(await replay.json(), { stored: 0, duplicates: 2, providerRequests: 0, canonicalMutations: 0 })
    const older = await invoke(endpoint, JSON.stringify([{ member_id: 111, status: "changed", event_id: "event-older", event_at: "2026-10-18T00:00:00Z" }]))
    assert.equal(older.status, 202)
    assert.deepEqual(db.prepare("select status from coresignal_webhook_events order by id").all().map(row => row.status), ["AWAITING_PROFILE_COLLECTION", "QUARANTINED_UNKNOWN_ID", "REVIEW_REQUIRED"])
    assert.equal((await invoke(endpoint, JSON.stringify([{ member_id: "invalid", status: "changed" }]))).status, 400)
    db.prepare("update alumni set coresignal_employee_id='222' where id=?").run(alumnusId)
    const stale = await invoke(endpoint, JSON.stringify([{ member_id: 111, status: "changed", event_id: "event-stale-mapping" }]))
    assert.equal(stale.status, 202)
    const quarantined = db.prepare("select alumnus_id,status from coresignal_webhook_events order by id desc limit 1").get()
    assert.equal(quarantined.alumnus_id, null)
    assert.equal(quarantined.status, "QUARANTINED_IDENTITY_CONFLICT")
    assert.equal(db.prepare("select count(*) as count from provider_response_history").get().count, 0)
    assert.equal(db.prepare("select company from alumni where id=?").get(alumnusId).company, "Example Co")
  } finally {
    cloudflare.env.DB = undefined
    if (oldEnabled === undefined) delete process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED; else process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED = oldEnabled
    if (oldSecret === undefined) delete process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET; else process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET = oldSecret
    db.close()
  }
})

test("isolated Admin journey prepares, mock-activates, simulates and explicitly Collects once", async () => {
  const db = await isolatedDb()
  const keys = ["AUTH_SESSION_SECRET", "NODE_ENV", "LOCAL_DEV_AUTH_ENABLED", "LOCAL_DEV_AUTH_ROLE", "LOCAL_CORESIGNAL_LIVE_DEMO_HOST", "LOCAL_DEV_D1_PERSIST_PATH", "CORESIGNAL_WEBHOOK_MOCK_TRANSPORT", "CORESIGNAL_WEBHOOK_RECEIVE_ENABLED", "CORESIGNAL_WEBHOOK_CALLBACK_SECRET", "CORESIGNAL_COLLECT_MOCK_TRANSPORT", "CORESIGNAL_COLLECT_ENABLED", "CORESIGNAL_COLLECT_ENTITLEMENT", "CORESIGNAL_LIVE_ENABLED"]
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, { AUTH_SESSION_SECRET: "synthetic-session-secret-at-least-thirty-two", NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1", LOCAL_DEV_D1_PERSIST_PATH: "/tmp/synthetic-isolated-webhook-d1", CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", CORESIGNAL_WEBHOOK_RECEIVE_ENABLED: "true", CORESIGNAL_WEBHOOK_CALLBACK_SECRET: "synthetic-callback-secret-at-least-thirty-two", CORESIGNAL_COLLECT_MOCK_TRANSPORT: "true", CORESIGNAL_COLLECT_ENABLED: "true", CORESIGNAL_COLLECT_ENTITLEMENT: "confirmed", CORESIGNAL_LIVE_ENABLED: "false" })
    cloudflare.env.DB = d1(db)
    db.exec("insert into application_users (id,display_name,email,role) values (1,'Synthetic Admin','admin@example.test','ADMIN')")
    db.exec("insert into application_identities (id,application_user_id,provider,provider_subject_id,verified_email,email_verified) values (1,1,'chatgpt','synthetic-admin','admin@example.test',1)")
    db.exec("insert into alumni (id,profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location,intake_status,coresignal_employee_id) values (1,'synthetic:journey','Synthetic Alumna','SA',2020,'PGP','Example Co','Director','Finance','Director','India','VERIFIED','111')")
    const auth = await vite.ssrLoadModule("/lib/auth-session.ts")
    const adminToken = await auth.createAppSessionToken({ applicationUserId: 1, applicationIdentityId: 1, provider: "chatgpt" })
    const planRoute = await vite.ssrLoadModule("/app/api/intelligence/webhooks/route.ts")
    const collectRoute = await vite.ssrLoadModule("/app/api/admin/coresignal-collect/route.ts")
    const send = async (route, body, token = adminToken) => {
      const response = await route.POST(new Request("http://127.0.0.1/api/intelligence/webhooks", { method: "POST", headers: { "content-type": "application/json", cookie: `corporate_network_session=${token}` }, body: JSON.stringify(body) }))
      return { status: response.status, body: await response.json() }
    }
    const selection = { cohortType: "FIXED_IDS", ids: [1] }
    const before = await send(planRoute, { action: "preview", ...selection })
    assert.equal(before.status, 200)
    assert.equal(before.body.counts.PENDING_PROVIDER_MAPPING, 1)
    assert.equal((await send(planRoute, { action: "attest", alumnusId: 1, evidenceReference: "Synthetic exact-ID evidence", confirmation: "VERIFY_BASE_EMPLOYEE_ID" })).status, 200)
    const ready = await send(planRoute, { action: "preview", ...selection })
    assert.equal(ready.body.counts.ELIGIBLE, 1)
    const prepared = await send(planRoute, { action: "prepare", name: "Synthetic fixed cohort", ...selection })
    assert.equal(prepared.status, 200)
    const planId = prepared.body.id
    const activated = await send(planRoute, { action: "activate", subscriptionId: planId, confirmation: `ACTIVATE ${planId} 1` })
    assert.equal(activated.status, 200)
    assert.equal(activated.body.providerRequests, 0)
    assert.equal((await send(planRoute, { action: "activate", subscriptionId: planId, confirmation: `ACTIVATE ${planId} 1` })).status, 409)
    const reconciled = await send(planRoute, { action: "reconcile", subscriptionId: planId })
    assert.equal(reconciled.status, 200)
    assert.deepEqual(reconciled.body.changes, { add: [], remove: [], unchanged: ["111"] })
    assert.equal((await send(planRoute, { action: "renew", subscriptionId: planId, confirmation: `RENEW ${planId}` })).status, 409)
    const simulated = await send(planRoute, { action: "simulate", subscriptionId: planId, alumnusId: 1, confirmation: `SIMULATE ${planId} 1` })
    assert.equal(simulated.status, 200)
    assert.equal(simulated.body.stored, 1)
    const event = db.prepare("select id,status from coresignal_webhook_events where subscription_id=?").get(planId)
    assert.equal(event.status, "AWAITING_PROFILE_COLLECTION")
    assert.equal(db.prepare("select count(*) as count from provider_response_history").get().count, 0)
    const preflight = await send(collectRoute, { action: "preflight", alumnusId: 1, webhookEventId: event.id })
    assert.equal(preflight.status, 200)
    assert.equal(preflight.body.applicationReservationUnits, 20)
    assert.equal(preflight.body.providerDebitKnown, false)
    assert.equal(preflight.body.preflight.allowed, true)
    const collected = await send(collectRoute, { action: "execute", alumnusId: 1, webhookEventId: event.id, confirmationToken: preflight.body.confirmationToken, confirmed: true })
    assert.equal(collected.status, 200)
    assert.equal(collected.body.evidence.applicationAccounting.maximumAuthorizedProviderCredits, 20)
    assert.equal(db.prepare("select status from coresignal_webhook_events where id=?").get(event.id).status, "PROFILE_COLLECTED")
    assert.equal(db.prepare("select application_units from provider_response_history").get().application_units, 20)
    assert.equal(db.prepare("select company from alumni where id=1").get().company, "Example Co")
    assert.ok(db.prepare("select count(*) as count from alumni_profile_change_proposals").get().count > 0)
    assert.equal((await send(collectRoute, { action: "execute", alumnusId: 1, webhookEventId: event.id, confirmationToken: preflight.body.confirmationToken, confirmed: true })).status, 409)
    db.exec("insert into application_users (id,display_name,email,role) values (2,'Synthetic PCOM','pcom@example.test','PCOM')")
    db.exec("insert into application_identities (id,application_user_id,provider,provider_subject_id,verified_email,email_verified) values (2,2,'chatgpt','synthetic-pcom','pcom@example.test',1)")
    const pcomToken = await auth.createAppSessionToken({ applicationUserId: 2, applicationIdentityId: 2, provider: "chatgpt" })
    assert.equal((await send(planRoute, { action: "prepare", name: "Unauthorized", ...selection }, pcomToken)).status, 403)
    const pcomGet = await planRoute.GET(new Request("http://127.0.0.1/api/intelligence/webhooks", { headers: { cookie: `corporate_network_session=${pcomToken}` } }))
    assert.equal(pcomGet.status, 200)
    assert.equal((await pcomGet.json()).events[0].employeeId, "[redacted]")
    assert.equal((await send(planRoute, { action: "stop", subscriptionId: planId, confirmation: `STOP ${planId}` })).status, 200)
    assert.equal(db.prepare("select status from coresignal_webhook_coverage where subscription_id=?").get(planId).status, "STOPPED")
  } finally {
    cloudflare.env.DB = undefined
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
    db.close()
  }
})
