import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => vite.close());

const policy = await vite.ssrLoadModule("/lib/security-policy.ts");
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8");
const engagement = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0005_security_access_controls.sql", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const routes = await Promise.all([
  "workspace", "enrichment", "discovery", "engagements", "outreach-route", "admin",
].map(name => readFile(new URL(`../app/api/${name}/route.ts`, import.meta.url), "utf8")));

test("security 1: role values are explicit and deny-by-default is visible", () => {
  assert.equal(policy.isApplicationRole("ADMIN"), true);
  assert.equal(policy.isApplicationRole("PCOM"), true);
  assert.equal(policy.isApplicationRole("DEVELOPER"), true);
  assert.equal(policy.isApplicationRole("GUEST"), false);
  assert.match(security, /not authorized to access Corporate Network/);
});

test("security 2: unauthenticated visitors receive only the sign-in page", () => {
  assert.match(layout, /if \(!user\)/);
  assert.match(layout, /Sign in to Corporate Network/);
  assert.match(layout, /Authentication is required before any alumni/);
  assert.match(layout, /chatGPTSignInPath\(returnTo\)/);
});

test("security 3: PCOM can operate but cannot administer users or provider settings", () => {
  assert.equal(policy.hasPermission("PCOM", "VIEW_ALUMNI"), true);
  assert.equal(policy.hasPermission("PCOM", "VIEW_CONTACTS"), true);
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true);
  assert.equal(policy.hasPermission("PCOM", "MANAGE_USERS"), false);
  assert.equal(policy.hasPermission("PCOM", "MANAGE_PROVIDER_SETTINGS"), false);
});

test("security 4: Developer is read-only and cannot consume provider credits", () => {
  assert.equal(policy.hasPermission("DEVELOPER", "VIEW_ALUMNI"), true);
  assert.equal(policy.hasPermission("DEVELOPER", "VIEW_PROVIDER_STATUS"), true);
  assert.equal(policy.hasPermission("DEVELOPER", "VIEW_CONTACTS"), false);
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false);
  assert.equal(policy.hasPermission("DEVELOPER", "MANAGE_USERS"), false);
});

test("security 5: Admin has operational and administrative permissions", () => {
  for (const permission of ["VIEW_ALUMNI", "VIEW_CONTACTS", "OPERATE_PCOM", "MANAGE_USERS", "MANAGE_PROVIDER_SETTINGS", "VIEW_AUDIT", "MANAGE_PRIVACY", "MANAGE_LIFECYCLE", "VIEW_PROVIDER_STATUS"]) {
    assert.equal(policy.hasPermission("ADMIN", permission), true, permission);
  }
});

test("security 6: a disabled account is rejected without deleting its history", () => {
  assert.match(security, /if \(!user\.enabled\)/);
  assert.match(security, /account_disabled/);
  assert.doesNotMatch(admin, /delete\(applicationUsers\)/);
  assert.match(schema, /actorName: text\("actor_name"\)/);
});

test("security 7: Developer contact masking happens in the server response", () => {
  assert.equal(policy.maskEmail("alumnus@microsoft.com"), "a•••••@microsoft.com");
  assert.equal(policy.maskPhone("+91 98765 43482"), "+91 ••••• ••482");
  assert.match(workspace, /contactsAllowed \? row\.email : maskEmail\(row\.email\)/);
  assert.match(workspace, /contactsAllowed \? row\.phone : maskPhone\(row\.phone\)/);
  assert.match(page, /were never sent to this browser in full/);
});

test("security 8: private PCOM notes and assessments are restricted for Developer", () => {
  assert.match(workspace, /Restricted for Developer role/);
  assert.match(workspace, /operationalDetailsAllowed \? row\.note/);
  assert.match(workspace, /operationalDetailsAllowed \? row\.iimlRelationship/);
});

test("security 9: every sensitive API route performs server authorization", () => {
  for (const source of routes) assert.match(source, /authorizeRequest\(request,/);
});

test("security 10: provider limits and user management are Admin-only", () => {
  assert.match(routes[1], /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/);
  assert.match(admin, /authorizeRequest\(request, "MANAGE_USERS"\)/);
  assert.match(page, /disabled=\{!session\.canAdminister\}/);
});

test("security 11: do-not-contact is checked server-side before a send", () => {
  assert.match(engagement, /privacy\?\.generalContactStatus === "Do not contact"/);
  assert.match(engagement, /Engagement blocked because this alumnus is marked Do not contact/);
  assert.match(page, /do-not-contact-banner/);
});

test("security 12: normal birthday responses expose day and month only", () => {
  assert.match(engagement, /birthMonthDay: birthdayByAlumnus/);
  assert.doesNotMatch(engagement.match(/birthday: birthdayByAlumnus[\s\S]*?preference:/)?.[0] ?? "", /fullBirthDate|birthYear/);
});

test("security 13: privacy, lifecycle, users and central audit use additive tables", () => {
  for (const table of ["application_users", "security_audit_events", "alumni_privacy_controls", "alumni_data_lifecycle"]) assert.equal(migration.includes("CREATE TABLE `" + table + "`"), true);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE .* DROP/i);
});

test("security 14: anonymization is protected and audited instead of hard deletion", () => {
  assert.match(admin, /ANONYMIZE \$\{payload\.alumnusId\}/);
  assert.match(admin, /alumnus_anonymized/);
  assert.doesNotMatch(admin, /delete\(alumni\)/);
});

test("security 15: sensitive state changes write central audit events", () => {
  for (const action of ["alumnus_manual_created", "relationship_assessment_changed", "pdl_profile_refresh", "user_role_changed", "do_not_contact_changed", "data_lifecycle_changed", "alumnus_anonymized"]) {
    assert.match(routes.join("\n"), new RegExp(action));
  }
  assert.match(engagement, /writeSecurityAudit\(context/);
  assert.match(engagement, /audit\(event\.id, context, "email_sent"/);
});

test("security 16: audit metadata masks contacts and redacts secrets", () => {
  const sanitized = JSON.parse(policy.safeAuditMetadata({ email: "alumnus@example.com", phone: "+91 98765 43482", apiKey: "secret-value", nested: { accessToken: "token-value" } }));
  assert.equal(sanitized.email, "a•••••@example.com");
  assert.equal(sanitized.phone, "+91 ••••• ••482");
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.nested.accessToken, "[REDACTED]");
});

test("security 17: future live integrations require two server-side gates", () => {
  assert.match(envExample, /PROVIDER_LIVE_ENABLED=false/);
  assert.match(envExample, /MAIL_LIVE_ENABLED=false/);
  assert.match(routes[1], /OPERATE_PCOM/);
});

test("security 18: bootstrap Admin uses authenticated identity and a server allowlist", () => {
  assert.match(security, /BOOTSTRAP_ADMIN_EMAILS/);
  assert.match(security, /identity\.externalIdentity/);
  assert.doesNotMatch(security + layout, /password/i);
});

test("security 19: standard security headers are configured", () => {
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /Referrer-Policy/);
  assert.match(nextConfig, /Permissions-Policy/);
});

test("security 20: frontend no longer supports spoofable demo identities", () => {
  assert.doesNotMatch(page + routes.join("\n"), /x-demo-user/);
  assert.match(page, /session\.displayName/);
});
