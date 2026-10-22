import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const review = await vite.ssrLoadModule("/lib/lusha-contact-review.ts")
const route = readFileSync(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8")
const historyRoute = readFileSync(new URL("../app/api/alumni/[id]/history/route.ts", import.meta.url), "utf8")
after(async () => { await vite.close() })

function fixture(path = ":memory:") {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE alumni(id INTEGER PRIMARY KEY,lusha_person_id TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',email_verification TEXT NOT NULL DEFAULT 'Unverified',phone_verification TEXT NOT NULL DEFAULT 'Unverified',email_source TEXT NOT NULL DEFAULT '',phone_source TEXT NOT NULL DEFAULT '',email_retrieved_at TEXT NOT NULL DEFAULT '',phone_retrieved_at TEXT NOT NULL DEFAULT '',last_lusha_enrichment TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',record_version INTEGER NOT NULL DEFAULT 1,last_mutation_request_key TEXT NOT NULL DEFAULT '',intake_status TEXT NOT NULL DEFAULT 'VERIFIED');
    CREATE UNIQUE INDEX alumni_email_unique ON alumni(email) WHERE email!='';
    CREATE TABLE alumni_privacy_controls(alumnus_id INTEGER NOT NULL,general_contact_status TEXT NOT NULL DEFAULT 'Unknown');
    CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY,provider TEXT NOT NULL,alumnus_id INTEGER,operation TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,provider_reported_credits INTEGER,application_units INTEGER NOT NULL DEFAULT 1,usage_state TEXT NOT NULL DEFAULT 'provider_reported');
    CREATE TABLE provider_refresh_reviews(id INTEGER PRIMARY KEY,provider_response_id INTEGER NOT NULL REFERENCES provider_response_history(id),alumnus_id INTEGER NOT NULL REFERENCES alumni(id),proposed_changes_json TEXT NOT NULL,status TEXT NOT NULL,requested_by TEXT NOT NULL,reviewed_by TEXT NOT NULL DEFAULT '',reviewed_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE field_change_history(id INTEGER PRIMARY KEY,alumnus_id INTEGER NOT NULL,field TEXT NOT NULL,old_value TEXT NOT NULL,new_value TEXT NOT NULL,source TEXT NOT NULL,provider_action TEXT NOT NULL,credits_charged INTEGER NOT NULL,initiated_by TEXT NOT NULL,mutation_request_key TEXT NOT NULL);
    CREATE UNIQUE INDEX change_once ON field_change_history(mutation_request_key,field);
    INSERT INTO alumni(id,lusha_person_id) VALUES(1,'contact-1'),(2,'contact-2');
    INSERT INTO provider_response_history(id,provider,alumnus_id,operation,mode,status) VALUES(100,'lusha',1,'Contact Search Preview','live','success');
    INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES(100,100,1,'{"kind":"LUSHA_CONTACT_IDENTITY","contactId":"contact-1"}','Approved identity','Synthetic Admin');`)
  return db
}

function pending(db, channel, value, previousValue = "") {
  const operation = channel === "email" ? "Email Reveal" : "Phone Reveal"
  const { id: historyId } = db.prepare("INSERT INTO provider_response_history(provider,alumnus_id,operation,mode,status,provider_reported_credits) VALUES('lusha',1,?,'live','review_required',1) RETURNING id").get(operation)
  const evidence = { kind: "LUSHA_CONTACT_FIELD", version: 1, channel, contactId: "contact-1", value, previousValue, alumnusRecordVersion: 1 }
  const { id: reviewId } = db.prepare("INSERT INTO provider_refresh_reviews(provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES(?,1,?,'Pending contact review','Synthetic PCOM') RETURNING id").get(historyId, JSON.stringify(evidence))
  return { historyId, reviewId, evidence }
}

function approve(db, proposal) {
  const { evidence, reviewId } = proposal
  const key = `lusha-contact-review:${reviewId}`
  const now = "2026-10-22T00:00:00Z"
  db.exec("BEGIN IMMEDIATE")
  try {
    const updated = db.prepare(review.lushaContactApprovalSql(evidence.channel)).get(evidence.value, now, now, "Synthetic Admin", now, key, 1, evidence.contactId, evidence.alumnusRecordVersion, evidence.previousValue, evidence.value, reviewId, evidence.value)
    if (!updated) { db.exec("ROLLBACK"); return false }
    assert.ok(db.prepare(review.LUSHA_APPROVE_CONTACT_REVIEW_SQL).get("Synthetic Admin", now, reviewId, 1, key))
    db.prepare("INSERT INTO field_change_history(alumnus_id,field,old_value,new_value,source,provider_action,credits_charged,initiated_by,mutation_request_key) VALUES(1,?,?,?,'Lusha',?,1,'Synthetic Admin',?)").run(evidence.channel, evidence.previousValue, evidence.value, `${evidence.channel} review`, key)
    db.exec("COMMIT")
    return true
  } catch (error) { db.exec("ROLLBACK"); throw error }
}

test("email and phone proposals survive reload and never change canonical fields before Admin review", () => {
  const folder = mkdtempSync(join(tmpdir(), "lusha-contact-review-"))
  const path = join(folder, "isolated.sqlite")
  try {
    const db = fixture(path)
    const email = pending(db, "email", "synthetic@example.org")
    const phone = pending(db, "phone", "+1 202 555 0100")
    assert.deepEqual({ ...db.prepare("SELECT email,phone FROM alumni WHERE id=1").get() }, { email: "", phone: "" })
    db.close()
    const reopened = new DatabaseSync(path)
    assert.equal(review.parseLushaContactReview(reopened.prepare("SELECT proposed_changes_json FROM provider_refresh_reviews WHERE id=?").get(email.reviewId).proposed_changes_json).value, "synthetic@example.org")
    assert.equal(approve(reopened, email), true)
    assert.equal(reopened.prepare("SELECT email FROM alumni WHERE id=1").get().email, "synthetic@example.org")
    assert.equal(approve(reopened, email), false, "replay cannot approve again")
    assert.equal(approve(reopened, phone), false, "a concurrent canonical version change makes the phone proposal stale")
    assert.equal(reopened.prepare("SELECT phone FROM alumni WHERE id=1").get().phone, "")
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM field_change_history").get().n, 1)
    reopened.close()
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test("phone approval and rejection are separate, idempotent, and preserve charge attribution", () => {
  const db = fixture()
  try {
    const phone = pending(db, "phone", "+1 202 555 0100")
    assert.equal(approve(db, phone), true)
    assert.equal(db.prepare("SELECT phone,phone_verification,phone_source FROM alumni WHERE id=1").get().phone, "+1 202 555 0100")
    assert.equal(db.prepare("SELECT provider_reported_credits FROM provider_response_history WHERE id=?").get(phone.historyId).provider_reported_credits, 1)
    assert.equal(approve(db, phone), false)
    const rejected = pending(db, "email", "reject@example.org")
    assert.ok(db.prepare(review.LUSHA_REJECT_CONTACT_REVIEW_SQL).get("Synthetic Admin", "2026-10-22", rejected.reviewId))
    assert.equal(db.prepare(review.LUSHA_REJECT_CONTACT_REVIEW_SQL).get("Synthetic Admin", "2026-10-22", rejected.reviewId), undefined)
    assert.equal(db.prepare("SELECT email FROM alumni WHERE id=1").get().email, "")
  } finally { db.close() }
})

test("stale identity, mismatched provider request, DNC, verified and conflicting contact block approval", () => {
  for (const mutate of [
    db => db.exec("UPDATE alumni SET lusha_person_id='other' WHERE id=1"),
    db => db.exec("UPDATE alumni SET record_version=2 WHERE id=1"),
    db => db.exec("UPDATE alumni SET email='changed@example.org' WHERE id=1"),
    db => db.exec("UPDATE alumni SET email_verification='Verified' WHERE id=1"),
    db => db.exec("INSERT INTO alumni_privacy_controls(alumnus_id,general_contact_status) VALUES(1,'Do not contact')"),
    (db, proposal) => db.prepare("UPDATE provider_response_history SET alumnus_id=2 WHERE id=?").run(proposal.historyId),
    (db, proposal) => db.prepare("UPDATE provider_response_history SET operation='Phone Reveal' WHERE id=?").run(proposal.historyId),
    db => db.exec("UPDATE alumni SET email='synthetic@example.org' WHERE id=2"),
    db => db.exec("DELETE FROM provider_refresh_reviews WHERE id=100"),
  ]) {
    const db = fixture()
    try { const proposal = pending(db, "email", "synthetic@example.org"); mutate(db, proposal); assert.equal(approve(db, proposal), false) } finally { db.close() }
  }
})

test("route and UI enforce Admin review, restricted evidence, distinct reservations and no automatic canonical mutation", () => {
  assert.match(route, /lusha_approve_contact", "lusha_reject_contact"\]\.includes/)
  assert.match(route, /context\.role === "ADMIN" && lushaHistoryIds\.length/)
  assert.match(route, /contactEvidence: parseLushaContactReview/)
  assert.match(route, /lushaReservations: \{ search:/)
  assert.match(route, /replaceExisting !== true/)
  assert.match(route, /retainLushaContactResult\(\{ claimId: claim\.id/)
  const reveal = route.match(/if \(payload\.action === "lusha_reveal_email"\)[\s\S]*?if \(payload\.action === "apply_refresh"/)[0]
  assert.doesNotMatch(reveal, /db\.update\(alumni\)/)
  assert.match(page, /Lusha \{item\.lushaReview\.contactEvidence\.channel\} evidence — Admin review/)
  assert.match(historyRoute, /source: `Lusha \$\{contactEvidence\.channel\} evidence`/)
  assert.doesNotMatch(historyRoute, /contactEvidence\.value/)
  assert.match(route, /providerReportedCredits: result\.creditsUsed/)
})
