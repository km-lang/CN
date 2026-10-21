import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const clientModule = await vite.ssrLoadModule("/lib/brightdata-client.ts")
const collection = await vite.ssrLoadModule("/lib/brightdata-collection.ts")
const localDevelopment = await vite.ssrLoadModule("/lib/local-development.ts")

test("Bright Data client constructs the documented async trigger without exposing the token", async () => {
  const requests = []
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(JSON.stringify({ snapshot_id: "snapshot-1" }), { status: 200, headers: { "content-type": "application/json" } })
  }
  const client = new clientModule.BrightDataClient({ token: "server-only-test-token", datasetId: "dataset-1", fetcher })
  assert.equal(await client.triggerProfile("https://www.linkedin.com/in/example"), "snapshot-1")
  assert.equal(requests.length, 1)
  const request = requests[0]
  const url = new URL(request.url)
  assert.equal(`${url.origin}${url.pathname}`, "https://api.brightdata.com/datasets/v3/trigger")
  assert.equal(url.searchParams.get("dataset_id"), "dataset-1")
  assert.equal(url.searchParams.get("format"), "json")
  assert.equal(url.searchParams.get("uncompressed_webhook"), "true")
  assert.equal(url.searchParams.get("include_errors"), "true")
  assert.equal(request.init.method, "POST")
  assert.deepEqual(JSON.parse(request.init.body), [{ url: "https://www.linkedin.com/in/example" }])
  assert.equal(request.init.headers.authorization, "Bearer server-only-test-token")
  assert.doesNotMatch(request.url, /server-only-test-token/)
})

test("status and snapshot retrieval reuse the durable snapshot ID and never trigger", async () => {
  const urls = []
  const responses = [
    new Response(JSON.stringify({ status: "running" }), { status: 200 }),
    new Response(JSON.stringify({ status: "ready" }), { status: 200 }),
    new Response(JSON.stringify([{ id: "profile-1" }]), { status: 200 }),
  ]
  const client = new clientModule.BrightDataClient({ token: "token", datasetId: "dataset", fetcher: async url => { urls.push(String(url)); return responses.shift() } })
  assert.deepEqual(await client.progress("snapshot/one"), { status: "running" })
  assert.deepEqual(await client.progress("snapshot/one"), { status: "ready" })
  assert.deepEqual(await client.download("snapshot/one"), [{ id: "profile-1" }])
  assert.ok(urls[0].endsWith("/datasets/v3/progress/snapshot%2Fone"))
  assert.ok(urls[2].endsWith("/datasets/v3/snapshot/snapshot%2Fone?format=json"))
  assert.equal(urls.some(url => url.includes("/trigger")), false)
})

test("transport ambiguity and malformed responses fail closed without automatic retry", async () => {
  let calls = 0
  const ambiguous = new clientModule.BrightDataClient({ token: "token", datasetId: "dataset", fetcher: async () => { calls += 1; throw new Error("timeout") } })
  await assert.rejects(() => ambiguous.triggerProfile("https://www.linkedin.com/in/example"), error => error.category === "transport_ambiguous")
  assert.equal(calls, 1)
  const malformed = new clientModule.BrightDataClient({ token: "token", datasetId: "dataset", fetcher: async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }) })
  await assert.rejects(() => malformed.triggerProfile("https://www.linkedin.com/in/example"), error => error.category === "trigger_outcome_ambiguous")
})

test("LinkedIn target validation is narrow and SSRF-safe", () => {
  assert.equal(collection.normalizeBrightLinkedinUrl("https://linkedin.com/in/Example/?trk=x#bio"), "https://www.linkedin.com/in/example")
  assert.deepEqual(collection.compareBrightProfileUrls("https://www.linkedin.com/in/Example/", "https://ro.linkedin.com/in/example"), { canonicalRequestedUrl: "https://www.linkedin.com/in/example", canonicalReturnedUrl: "https://www.linkedin.com/in/example", status: "MATCH" })
  assert.equal(collection.compareBrightProfileUrls("https://www.linkedin.com/in/example", "https://ro.linkedin.com/in/different-person").status, "MISMATCH")
  assert.equal(collection.compareBrightProfileUrls("https://www.linkedin.com/in/example", "https://evil.test/in/example").status, "UNVERIFIED")
  for (const value of ["http://linkedin.com/in/example", "https://linkedin.com/company/example", "https://evil.test/in/example", "https://evil.linkedin.com/in/example", "https://ro.linkedin.com.evil.test/in/example", "https://user:pass@linkedin.com/in/example", "https://linkedin.com:8443/in/example", "https://linkedin.com/in/a", "not-a-url"]) {
    assert.throws(() => collection.normalizeBrightLinkedinUrl(value))
  }
  assert.notEqual(collection.targetFingerprint("https://linkedin.com/in/person-a"), collection.targetFingerprint("https://linkedin.com/in/person-b"))
  assert.equal(collection.targetFingerprint("https://ro.linkedin.com/in/EXAMPLE"), collection.targetFingerprint("https://www.linkedin.com/in/example"))
})

test("observed education title shape retains institution without inventing degree or graduation", () => {
  const raw = { id: "synthetic-person", name: "Synthetic Person", url: "https://ro.linkedin.com/in/synthetic-person", current_company: { name: "Unverified employer label" }, position: null,
    experience: [], education: [{ title: "Synthetic Institute", start_year: "2025-06", end_year: "2027-05", description: null }, { title: null, start_year: "2018", end_year: "2022" }], timestamp: "2026-10-20T19:00:00Z" }
  const profile = collection.normalizeBrightProfile(raw, "https://www.linkedin.com/in/synthetic-person")
  assert.equal(profile.identityUrlStatus, "MATCH")
  assert.equal(profile.returnedUrl, raw.url)
  assert.equal(profile.education[0].institution, "Synthetic Institute")
  assert.equal(profile.education[0].degree, "")
  assert.equal(profile.education[0].programme, "")
  assert.equal(profile.education[0].startDate, "2025-06")
  assert.equal(profile.education[0].endDate, "2027-05")
  assert.equal(profile.education[1].institution, "")
  assert.equal(profile.currentTitle, "")
  assert.deepEqual(profile.experience, [])
  const normalized = collection.sanitizedBrightEvidence(profile)
  const retained = collection.prepareBrightRawEvidence(raw, "synthetic-snapshot", "synthetic-dataset", profile.requestedUrl, "2026-10-20T18:00:00Z", "2026-10-20T20:00:00Z", normalized)
  assert.deepEqual(JSON.parse(retained.rawJson), raw)
  assert.equal(retained.providerTimestampJson, JSON.stringify(raw.timestamp))
  assert.equal(retained.identityUrlStatus, "MATCH")
  assert.equal(retained.normalizerVersion, 2)
  assert.equal(retained.retentionUntil, "2027-01-18T20:00:00.000Z")
  assert.equal(JSON.parse(retained.normalizedJson).education[0].institution, "Synthetic Institute")
  assert.equal(retained.rawSha256.length, 64)
  assert.equal(JSON.parse(collection.sanitizedBrightEvidence({ ...profile, location: "x".repeat(60_000) })).location.length, 60_000)
})

test("confirmation binds actor, normalized target, alumnus and one request key", () => {
  const secret = "synthetic-test-secret-at-least-32-characters"
  const issued = collection.createBrightConfirmation({ actorUserId: 1, alumnusId: 15, profileUrl: "https://linkedin.com/in/example/" }, secret, 1000)
  const value = collection.verifyBrightConfirmation(issued.token, 1, secret, 2000)
  assert.equal(value.alumnusId, 15)
  assert.equal(value.profileUrl, "https://www.linkedin.com/in/example")
  assert.equal(collection.verifyBrightConfirmation(issued.token, 2, secret, 2000), null)
  assert.equal(collection.verifyBrightConfirmation(`${issued.token}x`, 1, secret, 2000), null)
  assert.equal(collection.verifyBrightConfirmation(issued.token, 1, secret, 1000 + collection.BRIGHTDATA_CONFIRMATION_TTL_MS + 1), null)
})

test("one-time human trial confirmation binds audit, actor, exact target and no alumnus", () => {
  const secret = "synthetic-test-secret-at-least-32-characters"
  const target = "https://www.linkedin.com/in/human-trial-example"
  const first = collection.createBrightConfirmation({ actorUserId: 7, profileUrl: target, alumnusId: null, humanTrialAuditId: 31 }, secret, 1000)
  const second = collection.createBrightConfirmation({ actorUserId: 7, profileUrl: target, alumnusId: null, humanTrialAuditId: 31 }, secret, 1100)
  assert.equal(first.confirmation.requestKey, collection.humanTrialRequestKey(31))
  assert.equal(second.confirmation.requestKey, first.confirmation.requestKey)
  assert.equal(collection.verifyBrightConfirmation(first.token, 7, secret, 1200).humanTrialAuditId, 31)
  assert.equal(collection.verifyBrightConfirmation(first.token, 8, secret, 1200), null)
  assert.equal(collection.verifyBrightConfirmation(first.token, 7, secret, 1000 + collection.BRIGHTDATA_CONFIRMATION_TTL_MS + 1), null)
  assert.throws(() => collection.createBrightConfirmation({ actorUserId: 7, profileUrl: target, alumnusId: 9, humanTrialAuditId: 31 }, secret))
  assert.throws(() => collection.createBrightConfirmation({ actorUserId: 7, profileUrl: target, alumnusId: null, humanTrialAuditId: 0 }, secret))
})

test("profile normalization selects current evidence and preserves history without canonical mutation", () => {
  const profile = collection.normalizeBrightProfile({ id: "p1", name: "Review Person", linkedin_url: "https://linkedin.com/in/review-person", location: "Delhi", experience: [{ company_name: "Earlier", title: "Vice President", end_date: "2024" }, { company_name: "Current", title: "Director", is_current: true, start_date: "2025" }] }, "https://www.linkedin.com/in/review-person")
  assert.equal(profile.currentCompany, "Current")
  assert.equal(profile.currentTitle, "Director")
  assert.equal(profile.experience.length, 2)
  assert.equal(profile.experience[0].current, false)
  assert.equal(profile.experience[1].current, true)
  assert.doesNotMatch(collection.sanitizedBrightEvidence(profile), /token|authorization|cookie/i)
})

test("unchanged or omitted Bright fields retain evidence without creating review proposals", () => {
  const profile = collection.normalizeBrightProfile({ url: "https://www.linkedin.com/in/example", experience: [{ company_name: "Current", title: "Director", is_current: true }], location: "Delhi" }, "https://www.linkedin.com/in/example")
  assert.deepEqual(collection.brightProfileChanges(profile, { company: "Current", title: "Director", location: "Delhi" }), [])
  assert.deepEqual(collection.brightProfileChanges({ ...profile, currentTitle: "", location: "" }, { company: "Current", title: "Director", location: "Delhi" }), [])
  assert.deepEqual(collection.brightProfileChanges({ ...profile, currentCompany: "Changed" }, { company: "Current", title: "Director", location: "Delhi" }).map(item => item.field), ["company"])
})

test("local Bright live and mock transports are Admin, development and loopback only", () => {
  const base = { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "true", LOCAL_PROVIDER_LIVE_DEMO_HOST: "127.0.0.1", BRIGHTDATA_LIVE_ENABLED: "true", BRIGHTDATA_API_TOKEN: "configured", BRIGHTDATA_DATASET_ID: "configured" }
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled(base), true)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, NODE_ENV: "production" }), false)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, LOCAL_DEV_AUTH_ROLE: "PCOM" }), false)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, LOCAL_PROVIDER_LIVE_DEMO_HOST: "0.0.0.0" }), false)
  assert.equal(localDevelopment.localBrightDataMockTransportEnabled({ ...base, BRIGHTDATA_MOCK_TRANSPORT: "true" }), true)
  const trial = { ...base, BRIGHTDATA_HUMAN_TRIAL_ENABLED: "true", BRIGHTDATA_HUMAN_TRIAL_TARGET: "https://www.linkedin.com/in/human-trial-example", LOCAL_DEV_D1_PERSIST_PATH: "/private/tmp/cn-isolated-demo", CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", BRIGHTDATA_MOCK_TRANSPORT: "false" }
  assert.equal(localDevelopment.localBrightDataHumanTrialEnabled(trial), true)
  for (const bad of [{ NODE_ENV: "production" }, { LOCAL_DEV_AUTH_ROLE: "PCOM" }, { LOCAL_PROVIDER_LIVE_DEMO_HOST: "0.0.0.0" }, { LOCAL_DEV_D1_PERSIST_PATH: "/workspace/original-d1" }, { CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "false" }, { BRIGHTDATA_MOCK_TRANSPORT: "true" }, { BRIGHTDATA_HUMAN_TRIAL_ENABLED: "false" }, { BRIGHTDATA_HUMAN_TRIAL_TARGET: "" }]) {
    assert.equal(localDevelopment.localBrightDataHumanTrialEnabled({ ...trial, ...bad }), false)
  }
})

test("one-time human attestation and matching attempt keys are durable uniqueness fences", () => {
  const db = new DatabaseSync(":memory:")
  db.exec("CREATE TABLE security_audit_events(id INTEGER PRIMARY KEY, mutation_request_key TEXT NOT NULL); CREATE UNIQUE INDEX idx_security_audit_mutation ON security_audit_events(mutation_request_key) WHERE mutation_request_key != ''; CREATE TABLE provider_collection_attempts(id INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE);")
  const audit = db.prepare("INSERT INTO security_audit_events(mutation_request_key) VALUES(?)")
  audit.run(collection.BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY)
  assert.throws(() => audit.run(collection.BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY), /UNIQUE/)
  const attempt = db.prepare("INSERT INTO provider_collection_attempts(request_key) VALUES(?)")
  attempt.run(collection.humanTrialRequestKey(1))
  assert.throws(() => attempt.run(collection.humanTrialRequestKey(1)), /UNIQUE/)
  db.close()
})

test("migration enforces request, job and simultaneous-target uniqueness", async () => {
  const migration = await readFile(new URL("../drizzle/0017_bright_data_collection_attempts.sql", import.meta.url), "utf8")
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE application_users(id INTEGER PRIMARY KEY); CREATE TABLE alumni(id INTEGER PRIMARY KEY); CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY);")
  db.exec(migration.replaceAll("--> statement-breakpoint", ""))
  db.exec("INSERT INTO application_users(id) VALUES(1)")
  const insert = db.prepare("INSERT INTO provider_collection_attempts(provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,status) VALUES('brightdata','Known professional profile collection',1,'https://www.linkedin.com/in/example','fingerprint','request-1',?)")
  insert.run("CLAIMED")
  assert.throws(() => insert.run("CLAIMED"), /UNIQUE/)
  assert.throws(() => db.prepare("INSERT INTO provider_collection_attempts(provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,status) VALUES('brightdata','Known professional profile collection',1,'https://www.linkedin.com/in/example','fingerprint','request-2','SNAPSHOT_PENDING')").run(), /UNIQUE/)
  db.exec("UPDATE provider_collection_attempts SET status='REVIEW_REQUIRED' WHERE request_key='request-1'")
  db.prepare("INSERT INTO provider_collection_attempts(provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,status) VALUES('brightdata','Known professional profile collection',1,'https://www.linkedin.com/in/example','fingerprint','request-2','CLAIMED')").run()
  const stale = db.prepare("UPDATE provider_collection_attempts SET status='SNAPSHOT_READY' WHERE request_key='request-2' AND generation=2 AND status='CLAIMED'").run()
  assert.equal(stale.changes, 0)
  db.close()
})

test("additive raw-evidence migration is one snapshot per attempt and preserves immutable source fields", async () => {
  const [attempts, snapshot] = await Promise.all([
    readFile(new URL("../drizzle/0017_bright_data_collection_attempts.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0026_green_ben_parker.sql", import.meta.url), "utf8"),
  ])
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE application_users(id INTEGER PRIMARY KEY); CREATE TABLE alumni(id INTEGER PRIMARY KEY); CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY);")
  db.exec(attempts.replaceAll("--> statement-breakpoint", ""))
  db.exec(snapshot.replaceAll("--> statement-breakpoint", ""))
  db.exec("INSERT INTO application_users(id) VALUES(1)")
  db.exec("INSERT INTO provider_collection_attempts(provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,status) VALUES('brightdata','Known professional profile collection',1,'https://www.linkedin.com/in/example','fingerprint','request-1','EVIDENCE_STORED')")
  const insert = db.prepare("INSERT INTO brightdata_snapshot_evidence(attempt_id,snapshot_id,dataset_id,requested_url,requested_at,retrieved_at,normalizer_version,raw_json,raw_sha256,normalized_json,retention_until) VALUES(1,'snapshot-1','dataset-1','https://www.linkedin.com/in/example','2026-10-20','2026-10-21',2,'{\"education\":[]}','digest','{\"education\":[]}','2027-01-19')")
  insert.run()
  assert.throws(() => insert.run(), /UNIQUE/)
  assert.equal(db.prepare("SELECT count(*) FROM provider_collection_attempts").get()["count(*)"], 1)
  assert.equal(db.prepare("SELECT raw_json FROM brightdata_snapshot_evidence WHERE attempt_id=1").get().raw_json, '{"education":[]}')
  db.close()
})

test("Admin route and UI retain explicit, review-only, provider-safe contracts", async () => {
  const [route, page, component, example] = await Promise.all([
    readFile(new URL("../app/api/admin/bright-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/brightdata-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ])
  assert.match(route, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(route, /attest_human_trial/)
  assert.match(route, /eligibleHumanTrial\(context, confirmation\.profileUrl, confirmation\.humanTrialAuditId\)/)
  assert.match(route, /HUMAN_ATTESTED_PROVIDER_UNVERIFIED/)
  assert.match(route, /TRIGGER_OUTCOME_UNKNOWN/)
  assert.match(route, /recover_evidence/)
  assert.match(route, /payload\.snapshotId !== attempt\.providerJobId/)
  assert.match(route, /attempt\.alumnusId !== null/)
  assert.match(route, /prepareBrightRawEvidence/)
  assert.match(route, /rawEvidenceStored: Boolean\(snapshot\)/)
  assert.doesNotMatch(route.slice(route.indexOf("function publicAttempt"), route.indexOf("async function snapshotMetadata")), /rawJson/)
  assert.match(route, /automaticRetries: 0/)
  assert.match(route, /canonicalMutations: 0/)
  assert.doesNotMatch(route, /update\(alumni\)/)
  assert.match(page, /session\.canAdminister && <BrightDataWorkflow/)
  assert.match(component, /Check collection status/)
  assert.match(component, /Retrieve completed result/)
  assert.match(component, /No automatic polling or paid retries/)
  assert.match(component, /Original response retained for Admin audit/)
  assert.match(component, /Review retained provider evidence/)
  assert.match(component, /Canonical alumnus association/)
  assert.match(component, /Education observations/)
  assert.match(component, /No employment rows returned; a top-level company is not proof of current employment/)
  assert.match(example, /BRIGHTDATA_API_TOKEN=\s*$/m)
  assert.doesNotMatch(example, /BRIGHTDATA_API_TOKEN=\S+/)
})
