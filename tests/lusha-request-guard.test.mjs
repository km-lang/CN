import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import * as guard from "../lib/lusha-request-guard.ts";

function isolatedDb(limit = 10) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE provider_settings(provider TEXT PRIMARY KEY,monthly_credit_limit INTEGER NOT NULL);
    CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY,provider TEXT,alumnus_id INTEGER,alumnus_name TEXT,operation TEXT,mode TEXT,status TEXT,credits_used INTEGER,application_units INTEGER,provider_reported_credits INTEGER,usage_state TEXT,result_count INTEGER,request_summary TEXT,response_summary TEXT,requested_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE alumni(id INTEGER PRIMARY KEY,lusha_person_id TEXT DEFAULT '',updated_by TEXT DEFAULT '',updated_at TEXT DEFAULT '',record_version INTEGER NOT NULL DEFAULT 1);`);
  db.prepare("INSERT INTO provider_settings VALUES('lusha',?)").run(limit);
  db.exec("INSERT INTO alumni(id) VALUES(1),(2),(3)");
  return db;
}

function claim(db, alumnusId, reservation = 6, operation = "Contact Search Preview") {
  return db.prepare(guard.LUSHA_REQUEST_CLAIM_SQL).get(alumnusId, `Synthetic #${alumnusId}`, operation, reservation,
    `One ${operation}`, "Synthetic Admin", alumnusId, operation, "2026-10-01T00:00:00Z", reservation, "2026-10-01T00:00:00Z");
}

test("live operation requires an explicit bounded internal reservation, distinct from provider debit", () => {
  assert.equal(guard.lushaApplicationReservation("Contact Search Preview", {}), null);
  assert.equal(guard.lushaApplicationReservation("Phone Reveal", { LUSHA_PHONE_MAX_APPLICATION_UNITS: "0" }), null);
  assert.equal(guard.lushaApplicationReservation("Phone Reveal", { LUSHA_PHONE_MAX_APPLICATION_UNITS: "101" }), null);
  assert.equal(guard.lushaApplicationReservation("Phone Reveal", { LUSHA_PHONE_MAX_APPLICATION_UNITS: "7" }), 7);
  assert.equal(guard.lushaReportedChargeExceedsReservation(null, 7), false);
  assert.equal(guard.lushaReportedChargeExceedsReservation(8, 7), true);
  assert.equal(guard.lushaContactEntitlement("Contact Search Preview", {}), false);
  assert.equal(guard.lushaContactEntitlement("Contact Search Preview", { LUSHA_SEARCH_ENTITLEMENT: "confirmed" }), false);
  const entitlement = { LUSHA_SEARCH_ENTITLEMENT: "confirmed", LUSHA_ENTITLEMENT_SOURCE: "account contract", LUSHA_ENTITLEMENT_VERIFIED_AT: "2026-10-22" };
  assert.equal(guard.lushaContactEntitlement("Contact Search Preview", entitlement), true);
  assert.equal(guard.lushaContactEntitlement("Email Reveal", entitlement), false, "one endpoint's entitlement does not authorize another");
  assert.equal(guard.lushaBalanceCoversReservation(null, 3), false);
  assert.equal(guard.lushaBalanceCoversReservation(2, 3), false);
  assert.equal(guard.lushaBalanceCoversReservation(3, 3), true);
});

test("one atomic claim fences duplicates, unknown debit and aggregate application allowance", () => {
  const db = isolatedDb();
  try {
    const first = claim(db, 1, 6);
    assert.ok(first?.id);
    db.exec("INSERT INTO provider_response_history(provider,alumnus_id,operation,mode,status,credits_used,application_units,usage_state) VALUES('lusha',3,'mock demonstration','mock','success',99,0,'not_applicable')");
    assert.equal(claim(db, 1, 6), undefined, "same operation cannot be triggered again");
    assert.equal(claim(db, 2, 4), undefined, "an unresolved provider debit blocks even another alumnus");
    db.prepare("UPDATE provider_response_history SET status='success',usage_state='provider_reported',provider_reported_credits=1,credits_used=1 WHERE id=?").run(first.id);
    assert.equal(claim(db, 2, 5), undefined, "5+6 exceeds the internal allowance even if actual debit was 1");
    assert.ok(claim(db, 2, 4)?.id, "4+6 fits; concurrent reservations are counted");
    assert.equal(claim(db, 3, 1), undefined, "the second unresolved claim blocks another request");
  } finally { db.close(); }
});

test("two simultaneous SQLite connections cannot overbook the monthly allowance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cn-lusha-guard-"));
  const filename = join(directory, "isolated.sqlite");
  const db = new DatabaseSync(filename);
  try {
    db.exec(`CREATE TABLE provider_settings(provider TEXT PRIMARY KEY,monthly_credit_limit INTEGER NOT NULL);
      CREATE TABLE provider_response_history(id INTEGER PRIMARY KEY,provider TEXT,alumnus_id INTEGER,alumnus_name TEXT,operation TEXT,mode TEXT,status TEXT,credits_used INTEGER,application_units INTEGER,provider_reported_credits INTEGER,usage_state TEXT,result_count INTEGER,request_summary TEXT,response_summary TEXT,requested_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO provider_settings VALUES('lusha',10);`);
    const workerSource = `const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.filename, { timeout: 1000 });
      try { const row = db.prepare(workerData.sql).get(workerData.person, 'Synthetic', 'Contact Search Preview', 6, 'One request', 'Reviewer', workerData.person, 'Contact Search Preview', '2026-10-01T00:00:00Z', 6, '2026-10-01T00:00:00Z'); parentPort.postMessage(Boolean(row)); }
      catch (error) { parentPort.postMessage({ error: error.code || error.message }); }
      finally { db.close(); }`;
    const run = person => new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, { eval: true, workerData: { filename, sql: guard.LUSHA_REQUEST_CLAIM_SQL, person } });
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    const outcomes = await Promise.all([run(1), run(2)]);
    assert.ok(outcomes.filter(value => value === true).length <= 1, "at most one six-unit claim can fit a ten-unit allowance");
    assert.equal(db.prepare("SELECT count(*) AS count FROM provider_response_history").get().count, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("unknown completed debit stays reserved until audited reconciliation", () => {
  const db = isolatedDb();
  try {
    const first = claim(db, 1, 6);
    db.prepare("UPDATE provider_response_history SET status='success' WHERE id=?").run(first.id);
    assert.equal(claim(db, 2, 1), undefined);
    db.prepare("UPDATE provider_response_history SET usage_state='reconciled_account_usage',application_units=max(application_units,2),credits_used=2 WHERE id=?").run(first.id);
    assert.equal(db.prepare("SELECT application_units FROM provider_response_history WHERE id=?").get(first.id).application_units, 6, "account reconciliation cannot refund reserved application units");
    assert.ok(claim(db, 2, 1)?.id);
  } finally { db.close(); }
});

test("SQLite month accounting includes both CURRENT_TIMESTAMP and ISO timestamps on the boundary", () => {
  const db = isolatedDb();
  try {
    db.exec("INSERT INTO provider_response_history(provider,alumnus_id,operation,mode,status,credits_used,application_units,usage_state,created_at) VALUES('lusha',1,'legacy','live','success',2,0,'provider_reported','2026-10-01 00:00:00'),('lusha',2,'current','live','success',0,6,'provider_reported','2026-10-01T00:00:00Z'),('lusha',3,'old','live','success',7,0,'provider_reported','2026-09-30 23:59:59')");
    const row = db.prepare("SELECT sum(CASE WHEN application_units>0 THEN application_units ELSE credits_used END) AS used FROM provider_response_history WHERE datetime(created_at)>=datetime(?)").get("2026-10-01T00:00:00Z");
    assert.equal(row.used, 8);
  } finally { db.close(); }
});

test("atomic identity attachment refuses a cross-alumnus reuse or replacement", () => {
  const db = isolatedDb();
  try {
    const attach = db.prepare(guard.LUSHA_ATTACH_ID_SQL);
    assert.ok(attach.get("contact-1", "Reviewer", "2026-10-22", 1, "contact-1", 1, "contact-1")?.id);
    assert.equal(attach.get("contact-1", "Reviewer", "2026-10-22", 2, "contact-1", 2, "contact-1"), undefined);
    assert.equal(attach.get("contact-2", "Reviewer", "2026-10-22", 1, "contact-2", 1, "contact-2"), undefined);
    assert.equal(db.prepare("SELECT lusha_person_id FROM alumni WHERE id=2").get().lusha_person_id, "");
    assert.equal(db.prepare("SELECT record_version FROM alumni WHERE id=1").get().record_version, 2);
  } finally { db.close(); }
});
