import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => vite.close());

const emailIdentity = await vite.ssrLoadModule("/lib/email-identity.ts");
const migration = await readFile(new URL("../drizzle/0007_colorful_the_hood.sql", import.meta.url), "utf8");
const cleanupMigration = await readFile(new URL("../drizzle/0008_application_user_pre_authorization_cleanup.sql", import.meta.url), "utf8");
const admin = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");

test("email identity 1: normalization trims, lowercases, and validates basic structure", () => {
  assert.equal(emailIdentity.normalizeEmail("  PGP41189@IIML.AC.IN  "), "pgp41189@iiml.ac.in");
  assert.throws(() => emailIdentity.normalizeEmail("not-an-email"), /valid email address/i);
  assert.equal(emailIdentity.tryNormalizeEmail("not-an-email"), "");
});

test("email identity 2: the database rejects duplicate normalized email addresses", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE application_users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);");
  db.exec(migration);
  db.prepare("INSERT INTO application_users (email) VALUES (?)").run("pgp41189@iiml.ac.in");
  assert.throws(() => db.prepare("INSERT INTO application_users (email) VALUES (?)").run("  PGP41189@IIML.AC.IN "), /UNIQUE constraint failed/);
  db.close();
});

test("email identity 3: a pgo versus pgp institutional typo warns conservatively", () => {
  assert.equal(emailIdentity.isLikelyInstitutionalEmailTypo("pgo41189@iiml.ac.in", "pgp41189@iiml.ac.in"), true);
  assert.equal(emailIdentity.isLikelyInstitutionalEmailTypo("pgo41189@another.edu", "pgp41189@iiml.ac.in"), false);
  assert.equal(emailIdentity.isLikelyInstitutionalEmailTypo("pgp41188@iiml.ac.in", "pgp41189@iiml.ac.in"), false);
  assert.match(admin, /possible_similar_user/);
  assert.match(admin, /confirmSimilarEmail !== true/);
});

test("email identity 4: existing Google provider-subject linking remains unchanged", () => {
  assert.match(security, /eq\(applicationIdentities\.provider, provider\)/);
  assert.match(security, /eq\(applicationIdentities\.providerSubjectId, providerSubjectId\)/);
  assert.match(security, /linkedIdentity\.applicationUserId !== user\.id/);
  const correction = admin.match(/if \(payload\.action === "correct_pre_authorization"[\s\S]*?if \(\(payload\.action === "change_role"/)?.[0] ?? "";
  assert.doesNotMatch(correction, /delete\(applicationIdentities\)|update\(applicationIdentities\)/);
});

test("email identity 5: correction is guarded, audited, and preserves historical audit rows", () => {
  assert.match(admin, /user_pre_authorization_corrected/);
  assert.match(admin, /Only a disabled, never-authenticated and unlinked pre-authorization/);
  assert.match(admin, /CORRECT USER \$\{duplicateId\}/);
  assert.match(admin, /db\.batch\(\[correctionEvent, deleteUser\]\)/);
  assert.doesNotMatch(admin, /delete\(securityAuditEvents\)/);
});

test("email identity 6: the guarded cleanup preserves identities and historical audit meaning", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE application_users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, enabled INTEGER NOT NULL, last_login_at TEXT NOT NULL);
    CREATE TABLE application_identities (id INTEGER PRIMARY KEY, application_user_id INTEGER NOT NULL REFERENCES application_users(id), provider TEXT NOT NULL);
    CREATE TABLE security_audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER REFERENCES application_users(id), actor_identity TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata_json TEXT NOT NULL, result TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO application_users VALUES (1, 'admin@example.com', 'ADMIN', 1, '2026-09-12T08:00:00Z');
    INSERT INTO application_users VALUES (2, 'pgo41189@iiml.ac.in', 'PCOM', 0, '');
    INSERT INTO application_users VALUES (3, 'pgp41189@iiml.ac.in', 'PCOM', 1, '2026-09-12T08:27:26Z');
    INSERT INTO application_identities VALUES (1, 1, 'chatgpt');
    INSERT INTO application_identities VALUES (2, 3, 'google_workspace');
    INSERT INTO security_audit_events (actor_user_id, actor_identity, actor_name, actor_role, action, entity_type, entity_id, metadata_json, result, source) VALUES (1, 'admin', 'Admin', 'ADMIN', 'user_authorized', 'application_user', '2', '{}', 'success', 'application');
    INSERT INTO security_audit_events (actor_user_id, actor_identity, actor_name, actor_role, action, entity_type, entity_id, metadata_json, result, source) VALUES (1, 'admin', 'Admin', 'ADMIN', 'user_disabled', 'application_user', '2', '{}', 'success', 'application');
  `);
  db.exec(cleanupMigration);
  assert.deepEqual(db.prepare("SELECT id FROM application_users ORDER BY id").all().map(row => Number(row.id)), [1, 3]);
  assert.deepEqual(db.prepare("SELECT id, application_user_id, provider FROM application_identities ORDER BY id").all().map(row => ({ id: Number(row.id), application_user_id: Number(row.application_user_id), provider: row.provider })), [
    { id: 1, application_user_id: 1, provider: "chatgpt" },
    { id: 2, application_user_id: 3, provider: "google_workspace" },
  ]);
  assert.deepEqual(db.prepare("SELECT action FROM security_audit_events WHERE entity_type = 'application_user' AND entity_id = '2' ORDER BY id").all().map(row => row.action), ["user_authorized", "user_disabled", "user_pre_authorization_corrected"]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
