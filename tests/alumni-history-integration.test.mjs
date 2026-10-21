import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { join } from "node:path"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const history = await vite.ssrLoadModule("/lib/alumni-history.ts")
const route = await readFile(new URL("../app/api/alumni/[id]/history/route.ts", import.meta.url), "utf8")
const previewRoute = await readFile(new URL("../app/api/intelligence/refresh/preview/route.ts", import.meta.url), "utf8")
const policyRoute = await readFile(new URL("../app/api/intelligence/refresh/jobs/route.ts", import.meta.url), "utf8")
const refreshUi = await readFile(new URL("../components/intelligence/refresh-center.tsx", import.meta.url), "utf8")

test("retained observations compare known values without treating absent evidence as a change to null", () => {
  const old = { key: "old", source: "coresignal", verification: "unverified", observed: { company: "Old Co", title: "Analyst" } }
  const current = { key: "new", source: "coresignal", verification: "unverified", observed: { company: "New Co", location: "Mumbai" } }
  const compared = history.compareRetainedObservations(current, old, { company: "Canonical Co", location: "Mumbai" })
  assert.deepEqual(compared.map(item => [item.field, item.previousObserved, item.newObserved, item.currentCanonical, item.changedFromPrevious]), [
    ["company", "Old Co", "New Co", "Canonical Co", true],
    ["location", null, "Mumbai", "Mumbai", false],
  ])
  assert.deepEqual(history.retainedProfessionalFields({ company: "Unknown", title: "Not returned", seniority: "Unknown/Unclassified", location: "Mumbai", graduationYear: 0 }), { location: "Mumbai" })
  assert.equal(compared[0].snapshotKey, "new")
  assert.equal(compared[0].previousSnapshotKey, "old")
})

test("history API is paginated, authorization-gated and provider-free", () => {
  assert.match(route, /authorizeRequest\(request, "VIEW_ALUMNI"\)/)
  assert.match(route, /limit \$\{pageSize \+ 1\} offset \$\{offset\}/)
  assert.match(route, /provisional_alumni_intakes/)
  assert.match(route, /provider_response_history/)
  assert.match(route, /alumni_employment_evidence/)
  assert.match(route, /field_change_history/)
  assert.match(route, /No complete response snapshot retained here|no complete response snapshot retained here/)
  assert.match(route, /source === "intelligence"/)
  assert.match(route, /lag\(row_kind\) over/)
  assert.match(route, /previousSnapshotKey|previous_kind/)
  assert.match(route, /alumni_source_observations/)
  assert.match(route, /coresignal_webhook_events/)
  assert.match(route, /WEBHOOK_NOTIFICATION/)
  assert.match(route, /intelligenceRequest<RetainedIntelligenceSnapshotPage>/)
  assert.match(route, /return intelligenceErrorResponse\(error\)/)
  assert.match(route, /remote\.sourceId !== `cn:\$\{alumnusId\}`/)
  assert.doesNotMatch(route, /previewCoresignal|fetch\(/)
})

test("standalone snapshots retain only scoped observations and never become canonical facts", () => {
  const entry = history.intelligenceSnapshotEntry({ id: "snapshot-1", provider: "BRIGHT_DATA", fetchedAt: "2026-10-20T00:00:00.000Z", extractionStatus: "SUCCESS", runId: "run-1", company: "Observed Co", title: "Director", location: null,
    experience: [{ company: "Observed Co", title: "Director", startDate: "2024-01", endDate: null, current: true }], education: [] }, "cn:7")
  assert.equal(entry.kind, "PROVIDER_SNAPSHOT")
  assert.equal(entry.observed.company, "Observed Co")
  assert.equal(entry.observed.employmentStartDate, "2024-01")
  assert.match(entry.verification, /not a Corporate Network canonical update/)
  assert.equal(entry.experience.length, 1)
})

test("exact D1 observation IDs carry the predecessor across a 20-row page boundary", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
    for (const name of migrations) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("INSERT INTO alumni (id,profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) VALUES (1,'synthetic:history','Synthetic History','SH',2024,'PGP','Example','Director','Finance','Director','Delhi')")
    const insert = db.prepare("INSERT INTO alumni_source_observations (alumnus_id,mutation_request_key,source_row_key,filename,source_system,observed_json,imported_by,created_at) VALUES (1,?,?,?,?,?,?,?)")
    for (let i = 1; i <= 25; i += 1) insert.run(`request-${i}`, `row-${i}`, "synthetic.xlsx", "synthetic", JSON.stringify({ company: `Company ${i}` }), "Admin", `2027-01-01T00:${String(i).padStart(2, "0")}:00Z`)
    const extracted = route.match(/db\.all<IndexRow>\(sql`([\s\S]*?)`\)/)?.[1]
    assert.ok(extracted)
    const query = (offset) => extracted.replaceAll("${alumnusId}", "1").replaceAll("${pageSize + 1}", "21").replaceAll("${offset}", String(offset))
    const first = db.prepare(query(0)).all().slice(0, 20)
    const second = db.prepare(query(20)).all().slice(0, 20)
    assert.equal(first.length, 20)
    assert.equal(first[19].previous_kind, "SOURCE_OBSERVATION")
    assert.equal(first[19].previous_id, second[0].row_id)
    assert.notEqual(first[19].row_id, first[19].previous_id)
    assert.equal(second.filter(row => row.row_kind === "SOURCE_BASELINE").length, 1)
  } finally { db.close() }
})

test("fixed policies remain inactive and CN dynamic policies use authoritative D1 selection", () => {
  assert.match(policyRoute, /cohortType !== "FIXED_COHORT"/)
  assert.match(policyRoute, /timingType === "RUN_NOW"/)
  assert.match(policyRoute, /enabled: false/)
  assert.match(previewRoute, /evaluateCnSelection/)
  assert.match(policyRoute, /evaluateCnSelection/)
  assert.match(refreshUi, /Save inactive policy/)
  assert.match(refreshUi, /Loaded matches only/)
})

test("retained webhook signal appears in exact alumnus history without invented employment facts", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
    for (const name of migrations) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("INSERT INTO alumni (id,profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) VALUES (1,'synthetic:webhook-history','Synthetic History','SH',2024,'PGP','Canonical Co','Director','Finance','Director','Delhi')")
    db.exec("INSERT INTO coresignal_webhook_subscriptions (id,name,cohort_type,selection_json,selection_version,membership_json,created_by) VALUES (1,'Synthetic','FIXED_IDS','[1]','fixed-cn-ids-v1','[]','Admin')")
    db.exec("INSERT INTO coresignal_webhook_events (subscription_id,alumnus_id,employee_id,change_type,changed_fields_json,received_at,payload_digest,dedupe_window,status) VALUES (1,1,'111','changed','[\"experience\"]','2027-01-01T00:00:00Z','synthetic-digest','provider-event-id','AWAITING_PROFILE_COLLECTION')")
    const extracted = route.match(/db\.all<IndexRow>\(sql`([\s\S]*?)`\)/)?.[1]
    assert.ok(extracted)
    const query = extracted.replaceAll("${alumnusId}", "1").replaceAll("${pageSize + 1}", "21").replaceAll("${offset}", "0")
    const indexed = db.prepare(query).all()
    assert.equal(indexed.filter(row => row.row_kind === "WEBHOOK_NOTIFICATION").length, 1)
    assert.equal(db.prepare("select company,title from alumni where id=1").get().company, "Canonical Co")
    assert.match(JSON.stringify(db.prepare("explain query plan select id from coresignal_webhook_events where alumnus_id=1 order by received_at desc limit 21").all()), /idx_csw_event_alumnus_date/)
  } finally { db.close() }
})

test("indexed history lookup remains bounded with 20,000 synthetic alumni", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
    for (const name of migrations) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("begin")
    const insert = db.prepare("insert into alumni (profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) values (?,?,?,?,?,?,?,?,?,?)")
    for (let id = 1; id <= 20_000; id++) insert.run(`synthetic:${id}`, `Synthetic Person ${id}`, "SP", 2020, "PGP", "Example Co", "Analyst", "Finance", "Associate", "India")
    db.exec("commit")
    const target = db.prepare("select id from alumni where profile_key='synthetic:20000'").get().id
    const start = performance.now()
    const baseline = db.prepare("select id,created_at from alumni where id=? limit 21").all(target)
    const attempts = db.prepare("select id,created_at from provider_response_history where alumnus_id=? order by created_at desc limit 21").all(target)
    const discoveries = db.prepare("select id,created_at from external_discovery_results where linked_internal_alumnus_id=? order by created_at desc limit 21").all(target)
    const brightAttempts = db.prepare("select id,created_at from provider_collection_attempts where alumnus_id=? order by created_at desc limit 21").all(target)
    const elapsedMs = performance.now() - start
    assert.equal(baseline.length, 1)
    assert.equal(attempts.length, 0)
    assert.equal(discoveries.length, 0)
    assert.equal(brightAttempts.length, 0)
    assert.equal(db.prepare("select count(*) as n from alumni").get().n, 20_000)
    assert.match(JSON.stringify(db.prepare("explain query plan select id from provider_response_history where alumnus_id=? order by created_at desc limit 21").all(target)), /idx_provider_response_history_alumnus_date/)
    assert.match(JSON.stringify(db.prepare("explain query plan select id from external_discovery_results where linked_internal_alumnus_id=? order by created_at desc limit 21").all(target)), /idx_external_result_linked_alumnus_date/)
    assert.match(JSON.stringify(db.prepare("explain query plan select id from provider_collection_attempts where alumnus_id=? order by created_at desc limit 21").all(target)), /idx_provider_collection_alumnus_date/)
    assert.equal(db.prepare("pragma integrity_check").get().integrity_check, "ok")
    console.log(`20,000-profile synthetic indexed lookup: ${elapsedMs.toFixed(2)} ms (three source queries; in-memory SQLite)`)
  } finally { db.close() }
})
