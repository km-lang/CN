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
