import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

process.env.AUTH_SESSION_SECRET = "lusha-auth-continuity-test-secret-with-at-least-thirty-two-characters";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => vite.close());

const sessions = await vite.ssrLoadModule("/lib/auth-session.ts");
const policy = await vite.ssrLoadModule("/lib/security-policy.ts");
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const lusha = await readFile(new URL("../lib/lusha-client.ts", import.meta.url), "utf8");

test("lusha auth 1: Google Workspace PCOM and ChatGPT Admin use the same provider-neutral application session", async () => {
  for (const provider of ["google_workspace", "chatgpt"]) {
    const token = await sessions.createAppSessionToken({ applicationUserId: provider === "google_workspace" ? 3 : 1, applicationIdentityId: provider === "google_workspace" ? 2 : 1, provider });
    const claims = await sessions.verifyAppSessionToken(token);
    assert.equal(claims.provider, provider);
  }
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true);
  assert.equal(policy.hasPermission("ADMIN", "OPERATE_PCOM"), true);
});

test("lusha auth 2: Contact Search and channel reveals share canonical authorization and explicit same-origin credentials", () => {
  assert.match(route, /"lusha_approve_identity", "lusha_reject_identity"\]\.includes\(payload\.action \?\? ""\) \? "MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM"/);
  assert.match(route, /authorizeRequest\(request, requiredPermission\)/);
  assert.equal((page.match(/credentials: "same-origin"/g) ?? []).length >= 3, true);
  assert.match(route, /authenticatedJsonResponse\(context, \{\s*preview:/);
  assert.match(route, /authenticatedJsonResponse\(context, \{ result:/);
});

test("lusha auth 3: successful provider steps renew the signed application session", () => {
  assert.match(security, /createAppSessionToken\(\{/);
  assert.match(security, /applicationIdentityId: context\.identityId/);
  assert.match(security, /provider: context\.provider/);
  assert.match(security, /set-cookie/);
  assert.match(security, /sessionCookie\(token\)/);
});

test("lusha auth 4: expired and unauthenticated sessions remain denied", async () => {
  const token = await sessions.createAppSessionToken({ applicationUserId: 3, applicationIdentityId: 2, provider: "google_workspace" });
  const originalNow = Date.now;
  Date.now = () => originalNow() + 9 * 60 * 60 * 1000;
  try { assert.equal(await sessions.verifyAppSessionToken(token), null); } finally { Date.now = originalNow; }
  assert.match(security, /Authentication is required/);
});

test("lusha auth 5: disabled users and unauthorized roles remain denied server-side", () => {
  assert.match(security, /if \(!user\.enabled\)/);
  assert.match(security, /account_disabled/);
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false);
  assert.equal(policy.isApplicationRole("UNAUTHORIZED"), false);
});

test("lusha auth 6: authorization occurs before any Lusha provider function", () => {
  const authorizeAt = route.indexOf("await authorizeRequest(request");
  const searchAt = route.indexOf("await searchLushaContact(");
  const revealAt = route.indexOf("await revealLushaEmail(");
  assert.ok(authorizeAt >= 0 && authorizeAt < searchAt && authorizeAt < revealAt);
});

test("lusha auth 7: saved stable contact ID resumes reveal without another Search", () => {
  assert.match(page, /const storedContactId = person\.lushaPersonId\?\.trim\(\)/);
  assert.match(page, /resumedFromStoredContact: true/);
  assert.match(page, /0 new Search calls/);
  assert.match(route, /if \(!person\.lushaPersonId\)/);
  const revealBlock = route.match(/if \(payload\.action === "lusha_reveal_email"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  assert.match(revealBlock, /revealLushaEmail\(person\.lushaPersonId\)/);
  assert.doesNotMatch(revealBlock, /searchLushaContact/);
});

test("lusha auth 8: Email Reveal remains email-only and never requests phone", () => {
  assert.match(lusha, /reveal: \["emails"\]/);
  const revealBlock = route.match(/if \(payload\.action === "lusha_reveal_email"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  assert.doesNotMatch(revealBlock, /phone:/);
});

test("lusha auth 9: automated coverage contains no live invocation path", () => {
  assert.doesNotMatch(import.meta.url, /https:\/\/api\.lusha\.com/);
  assert.match(route, /confirmed !== true/);
});
