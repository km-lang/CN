import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"
import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const review = await vite.ssrLoadModule("/lib/lusha-identity-review.ts")
const client = await vite.ssrLoadModule("/lib/lusha-client.ts")
const previousKey = process.env.LUSHA_API_KEY
process.env.LUSHA_API_KEY = "synthetic-lusha-test-key-never-sent"
after(async () => { if (previousKey === undefined) delete process.env.LUSHA_API_KEY; else process.env.LUSHA_API_KEY = previousKey; await vite.close() })

const profile = "https://www.linkedin.com/in/synthetic-alumnus/"

function isolatedDb(filename = ":memory:") {
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE alumni(id INTEGER PRIMARY KEY,linkedin_url TEXT NOT NULL,lusha_person_id TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',record_version INTEGER NOT NULL DEFAULT 1,last_mutation_request_key TEXT NOT NULL DEFAULT '');
    CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY,provider TEXT NOT NULL,alumnus_id INTEGER,operation TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,result_count INTEGER NOT NULL,response_summary TEXT NOT NULL DEFAULT '',credits_used INTEGER NOT NULL DEFAULT 0,application_units INTEGER NOT NULL DEFAULT 0,provider_reported_credits INTEGER,usage_state TEXT NOT NULL DEFAULT 'not_applicable');
    CREATE TABLE provider_refresh_reviews(id INTEGER PRIMARY KEY,provider_response_id INTEGER NOT NULL REFERENCES provider_response_history(id),alumnus_id INTEGER NOT NULL REFERENCES alumni(id),proposed_changes_json TEXT NOT NULL,status TEXT NOT NULL,requested_by TEXT NOT NULL,reviewed_by TEXT NOT NULL DEFAULT '',reviewed_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE field_change_history(id INTEGER PRIMARY KEY,alumnus_id INTEGER NOT NULL,field TEXT NOT NULL,old_value TEXT NOT NULL,new_value TEXT NOT NULL,source TEXT NOT NULL,provider_action TEXT NOT NULL,credits_charged INTEGER NOT NULL,initiated_by TEXT NOT NULL,mutation_request_key TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_field_change_mutation_field ON field_change_history(mutation_request_key,field) WHERE mutation_request_key != '';
    INSERT INTO alumni(id,linkedin_url) VALUES(1,'${profile}'),(2,'https://www.linkedin.com/in/other-synthetic/');`)
  return db
}

function evidence(overrides = {}) {
  return review.lushaIdentityEvidence({ returnedCount: 1, alumnusRecordVersion: 1, contactId: "lusha-synthetic-1", requestedProfileUrl: profile, returnedProfileUrl: profile, returnedName: "Synthetic Alumnus", returnedCompany: "Example", returnedTitle: "Manager", emailAvailable: true, phoneAvailable: false, identityReason: "PROFILE_URL_MATCH", providerStatus: "success", providerReportedCredits: 2, ...overrides })
}

function pending(db, proposal = evidence(), alumnusId = 1, status = "Pending identity review") {
  const history = db.prepare("INSERT INTO provider_response_history(provider,alumnus_id,operation,mode,status,result_count,response_summary,credits_used,application_units,provider_reported_credits,usage_state) VALUES('lusha',?,'Contact Search Preview','live','review_required',?,'Provider observation retained',2,3,2,'provider_reported') RETURNING id").get(alumnusId, proposal.returnedCount)
  const row = db.prepare("INSERT INTO provider_refresh_reviews(provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES(?,?,?,?,?) RETURNING id").get(history.id, alumnusId, JSON.stringify(proposal), status, "Synthetic PCOM")
  return { historyId: history.id, reviewId: row.id }
}

function approve(db, ids, proposal = evidence(), savedProfile = profile, recordVersion = 1) {
  if (!review.lushaIdentityApprovalEligible(proposal, savedProfile, "", recordVersion)) return false
  const key = `lusha-identity-review:${ids.reviewId}`
  db.exec("BEGIN IMMEDIATE")
  try {
    const attached = db.prepare(review.LUSHA_REVIEWED_ATTACH_ID_SQL).get(proposal.contactId, "Synthetic Admin", "2026-10-22T00:00:00Z", key, 1, savedProfile, recordVersion, ids.reviewId, proposal.contactId, proposal.requestedProfileUrl, proposal.returnedProfileUrl, ids.historyId, proposal.contactId, proposal.contactId)
    if (!attached) { db.exec("ROLLBACK"); return false }
    assert.ok(db.prepare(review.LUSHA_APPROVE_REVIEW_SQL).get("Synthetic Admin", "2026-10-22T00:00:00Z", ids.reviewId, 1, proposal.contactId, key))
    assert.ok(db.prepare(review.LUSHA_COMPLETE_REVIEWED_HISTORY_SQL).get(ids.historyId, ids.reviewId))
    assert.ok(db.prepare(review.LUSHA_RECORD_IDENTITY_CHANGE_SQL).get(1, proposal.contactId, "Synthetic Admin", key, ids.reviewId))
    db.exec("COMMIT")
    return true
  } catch (error) { db.exec("ROLLBACK"); throw error }
}

test("mock V3 exact match stores a pending provider proposal without any canonical or contact change", async () => {
  let requests = 0
  const result = await client.searchLushaContact({ name: "Synthetic Alumnus", company: "Example", linkedinUrl: profile }, { fetcher: async (url, init) => {
    requests++
    assert.equal(url, "https://api.lusha.com/v3/contacts/search")
    assert.deepEqual(JSON.parse(init.body), { contacts: [{ linkedinUrl: profile }] })
    return new Response(JSON.stringify({ results: [{ id: "lusha-synthetic-1", fullName: "Synthetic Alumnus", socialLinks: { linkedin: profile }, has: ["emails"] }], billing: { creditsCharged: 2 } }), { status: 200 })
  } })
  const db = isolatedDb()
  try {
    assert.equal(requests, 1)
    assert.equal(result.returnedCount, 1)
    assert.equal(result.creditsUsed, 2)
    const ids = pending(db, evidence({ contactId: result.contactId, returnedProfileUrl: result.linkedinUrl, providerReportedCredits: result.creditsUsed }))
    assert.ok(ids.reviewId)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
    assert.equal(db.prepare("SELECT status,application_units,provider_reported_credits FROM provider_response_history WHERE id=?").get(ids.historyId).application_units, 3)
    assert.equal(db.prepare("SELECT status FROM provider_refresh_reviews WHERE id=?").get(ids.reviewId).status, "Pending identity review")
    assert.equal(JSON.stringify(evidence()).includes("@"), false, "no email or phone value is retained")
  } finally { db.close() }
})

test("ambiguous, mismatched, missing ID and changed saved profile cannot be approved", () => {
  for (const item of [evidence({ returnedCount: 2, identityReason: "MULTIPLE_RESULTS", providerStatus: "review_required" }), evidence({ returnedProfileUrl: "https://www.linkedin.com/in/other-synthetic/", identityReason: "PROFILE_URL_CONFLICT", providerStatus: "review_required" }), evidence({ contactId: "" }), evidence({ providerStatus: "review_required" })]) {
    assert.equal(review.lushaIdentityApprovalEligible(item, profile, "", 1), false)
  }
  assert.equal(review.lushaIdentityApprovalEligible(evidence(), "https://www.linkedin.com/in/changed/", "", 1), false)
  assert.equal(review.lushaIdentityApprovalEligible(evidence(), profile, "", 2), false)
  const db = isolatedDb()
  try {
    const ids = pending(db)
    db.exec("UPDATE alumni SET linkedin_url='https://www.linkedin.com/in/changed/',record_version=2 WHERE id=1")
    assert.equal(approve(db, ids, evidence(), profile, 1), false)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
  } finally { db.close() }
})

test("a canonical edit invalidates a pending proposal even if its LinkedIn URL is restored", () => {
  const db = isolatedDb()
  try {
    const ids = pending(db)
    db.prepare("UPDATE alumni SET record_version=2 WHERE id=1").run()
    assert.equal(approve(db, ids, evidence(), profile, 2), false)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
  } finally { db.close() }
})

test("explicit reviewed approval associates only the exact contact ID once and retains billing", () => {
  const db = isolatedDb()
  try {
    const ids = pending(db)
    assert.equal(approve(db, ids), true)
    assert.equal(db.prepare("SELECT lusha_person_id,record_version FROM alumni WHERE id=1").get().lusha_person_id, "lusha-synthetic-1")
    assert.equal(db.prepare("SELECT status,reviewed_by FROM provider_refresh_reviews WHERE id=?").get(ids.reviewId).status, "Approved identity")
    assert.equal(db.prepare("SELECT credits_used,application_units,provider_reported_credits FROM provider_response_history WHERE id=?").get(ids.historyId).application_units, 3)
    assert.equal(db.prepare("SELECT count(*) AS n FROM field_change_history").get().n, 1)
    assert.equal(approve(db, ids), false)
    assert.equal(db.prepare("SELECT count(*) AS n FROM field_change_history").get().n, 1)
  } finally { db.close() }
})

test("cross-alumnus contact reuse and conflicting pending proposals block approval", () => {
  const db = isolatedDb()
  try {
    const ids = pending(db)
    db.exec("UPDATE alumni SET lusha_person_id='lusha-synthetic-1' WHERE id=2")
    assert.equal(approve(db, ids), false)
    db.exec("UPDATE alumni SET lusha_person_id='' WHERE id=2")
    pending(db, evidence({ requestedProfileUrl: "https://www.linkedin.com/in/other-synthetic/", returnedProfileUrl: "https://www.linkedin.com/in/other-synthetic/" }), 2)
    assert.equal(approve(db, ids), false, "two pending claims for one contact ID cannot be approved")
  } finally { db.close() }
})

test("duplicate saved LinkedIn identity blocks association in the atomic update", () => {
  const db = isolatedDb()
  try {
    const ids = pending(db)
    db.prepare("UPDATE alumni SET linkedin_url=? WHERE id=2").run(profile.toUpperCase())
    assert.equal(approve(db, ids), false)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
  } finally { db.close() }
})

test("Admin rejection records a decision without changing canonical identity", () => {
  const db = isolatedDb()
  try {
    const ids = pending(db)
    assert.ok(db.prepare(review.LUSHA_REJECT_REVIEW_SQL).get("Synthetic Admin", "2026-10-22T00:00:00Z", ids.reviewId))
    assert.equal(db.prepare(review.LUSHA_REJECT_REVIEW_SQL).get("Synthetic Admin", "2026-10-22T00:00:00Z", ids.reviewId), undefined)
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
    assert.equal(db.prepare("SELECT status FROM provider_refresh_reviews WHERE id=?").get(ids.reviewId).status, "Rejected identity")
    assert.equal(approve(db, ids), false)
  } finally { db.close() }
})

test("provider evidence and decisions survive an isolated database reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "cn-lusha-review-"))
  const filename = join(directory, "isolated.sqlite")
  try {
    const db = isolatedDb(filename)
    const ids = pending(db)
    db.close()
    const reopened = new DatabaseSync(filename)
    try {
      const retained = reopened.prepare("SELECT proposed_changes_json,status FROM provider_refresh_reviews WHERE id=?").get(ids.reviewId)
      assert.equal(review.parseLushaIdentityEvidence(retained.proposed_changes_json).contactId, "lusha-synthetic-1")
      assert.equal(retained.status, "Pending identity review")
      assert.equal(reopened.prepare("SELECT lusha_person_id FROM alumni WHERE id=1").get().lusha_person_id, "")
    } finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("concurrent approvals cannot both mutate the alumnus or repeat the decision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cn-lusha-concurrent-"))
  const filename = join(directory, "isolated.sqlite")
  try {
    const db = isolatedDb(filename)
    const ids = pending(db)
    db.close()
    const workerSource = `const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(workerData.filename,{timeout:1000}); try { const row=db.prepare(workerData.sql).get(...workerData.bind); parentPort.postMessage(Boolean(row)); } catch(error) { parentPort.postMessage(false); } finally { db.close(); }`
    const bind = ["lusha-synthetic-1", "Synthetic Admin", "2026-10-22", `lusha-identity-review:${ids.reviewId}`, 1, profile, 1, ids.reviewId, "lusha-synthetic-1", profile, profile, ids.historyId, "lusha-synthetic-1", "lusha-synthetic-1"]
    const run = () => new Promise((resolve, reject) => { const worker = new Worker(workerSource, { eval: true, workerData: { filename, sql: review.LUSHA_REVIEWED_ATTACH_ID_SQL, bind } }); worker.once("message", resolve); worker.once("error", reject) })
    const outcomes = await Promise.all([run(), run()])
    assert.equal(outcomes.filter(Boolean).length, 1)
    const reopened = new DatabaseSync(filename)
    try { assert.equal(reopened.prepare("SELECT record_version FROM alumni WHERE id=1").get().record_version, 2) } finally { reopened.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("route enforces Admin decision permission, preserves Search/reveal gates and legacy review JSON", () => {
  const route = readFileSync(join(root, "app/api/enrichment/route.ts"), "utf8")
  const page = readFileSync(join(root, "app/page.tsx"), "utf8")
  assert.match(route, /"lusha_approve_identity", "lusha_reject_identity"/)
  assert.match(route, /MANAGE_PROVIDER_SETTINGS/)
  assert.match(route, /payload\.action === "lusha_search_contact"[\s\S]*?!lushaV3Available\(\)/)
  assert.match(route, /payload\.action === "lusha_reveal_email"[\s\S]*?!lushaV3Available\(\)/)
  assert.match(route, /LUSHA_REVIEWED_ATTACH_ID_SQL/)
  assert.doesNotMatch(route.match(/if \(payload\.action === "lusha_search_contact"\)[\s\S]*?if \(payload\.action === "lusha_approve_identity"\)/)?.[0] ?? "", /UPDATE alumni|db\.update\(alumni\)|LUSHA_ATTACH_ID_SQL/)
  assert.match(page, /onApproveLushaIdentity/)
  assert.match(page, /onRejectLushaIdentity/)
  assert.equal(review.parseLushaIdentityEvidence('[{"field":"company","newValue":"Example"}]'), null)
})
