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
  assert.equal(collection.normalizeBrightLinkedinUrl("https://linkedin.com/in/Example/?trk=x#bio"), "https://www.linkedin.com/in/Example")
  for (const value of ["http://linkedin.com/in/example", "https://linkedin.com/company/example", "https://evil.test/in/example", "https://user:pass@linkedin.com/in/example", "https://linkedin.com:8443/in/example", "https://linkedin.com/in/a", "not-a-url"]) {
    assert.throws(() => collection.normalizeBrightLinkedinUrl(value))
  }
  assert.notEqual(collection.targetFingerprint("https://linkedin.com/in/person-a"), collection.targetFingerprint("https://linkedin.com/in/person-b"))
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

test("profile normalization selects current evidence and preserves history without canonical mutation", () => {
  const profile = collection.normalizeBrightProfile({ id: "p1", name: "Review Person", linkedin_url: "https://linkedin.com/in/review-person", location: "Delhi", experience: [{ company_name: "Earlier", title: "Vice President", end_date: "2024" }, { company_name: "Current", title: "Director", is_current: true, start_date: "2025" }] }, "https://www.linkedin.com/in/review-person")
  assert.equal(profile.currentCompany, "Current")
  assert.equal(profile.currentTitle, "Director")
  assert.equal(profile.experience.length, 2)
  assert.equal(profile.experience[0].current, false)
  assert.equal(profile.experience[1].current, true)
  assert.doesNotMatch(collection.sanitizedBrightEvidence(profile), /token|authorization|cookie/i)
})

test("local Bright live and mock transports are Admin, development and loopback only", () => {
  const base = { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "true", LOCAL_PROVIDER_LIVE_DEMO_HOST: "127.0.0.1", BRIGHTDATA_LIVE_ENABLED: "true", BRIGHTDATA_API_TOKEN: "configured", BRIGHTDATA_DATASET_ID: "configured" }
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled(base), true)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, NODE_ENV: "production" }), false)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, LOCAL_DEV_AUTH_ROLE: "PCOM" }), false)
  assert.equal(localDevelopment.localBrightDataLiveDemoEnabled({ ...base, LOCAL_PROVIDER_LIVE_DEMO_HOST: "0.0.0.0" }), false)
  assert.equal(localDevelopment.localBrightDataMockTransportEnabled({ ...base, BRIGHTDATA_MOCK_TRANSPORT: "true" }), true)
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

test("Admin route and UI retain explicit, review-only, provider-safe contracts", async () => {
  const [route, page, component, example] = await Promise.all([
    readFile(new URL("../app/api/admin/bright-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/brightdata-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ])
  assert.match(route, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(route, /TRIGGER_OUTCOME_UNKNOWN/)
  assert.match(route, /automaticRetries: 0/)
  assert.match(route, /canonicalMutations: 0/)
  assert.doesNotMatch(route, /update\(alumni\)/)
  assert.match(page, /session\.canAdminister && <BrightDataWorkflow/)
  assert.match(component, /Check collection status/)
  assert.match(component, /Retrieve completed result/)
  assert.match(component, /No automatic polling or paid retries/)
  assert.match(example, /BRIGHTDATA_API_TOKEN=\s*$/m)
  assert.doesNotMatch(example, /BRIGHTDATA_API_TOKEN=\S+/)
})
