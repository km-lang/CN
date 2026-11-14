import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

process.env.AUTH_SESSION_SECRET = "stage-2-5-test-secret-with-at-least-thirty-two-characters";
process.env.GOOGLE_CLIENT_ID = "corporate-network-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-only-client-secret";
process.env.GOOGLE_ALLOWED_DOMAIN = "iiml.ac.in";
process.env.APP_PUBLIC_URL = "https://network.teamsynapse.app";
process.env.APP_BASE_PATH = "/";
// Simulate a stale public value baked into an earlier build. Runtime APP_PUBLIC_URL must win.
process.env.NEXT_PUBLIC_APP_PUBLIC_URL = "https://iiml-alumni-intelligence.dokina-ramakrishna.chatgpt.site";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
after(async () => vite.close());

const sessions = await vite.ssrLoadModule("/lib/auth-session.ts");
const google = await vite.ssrLoadModule("/lib/google-oidc.ts");
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const loginEntry = await readFile(new URL("../lib/login-entry.ts", import.meta.url), "utf8");
const callback = await readFile(new URL("../app/auth/google/callback/route.ts", import.meta.url), "utf8");
const chatgpt = await readFile(new URL("../app/auth/chatgpt/session/route.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0006_application_identities.sql", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("institutional auth 1: Google authorization uses OIDC, PKCE, state, nonce and the institutional domain", async () => {
  const request = await google.createGoogleAuthorizationRequest("/");
  const url = new URL(request.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("hd"), "iiml.ac.in");
  assert.equal(url.searchParams.get("redirect_uri"), "https://network.teamsynapse.app/auth/google/callback");
  assert.ok(request.state.length > 20 && request.nonce.length > 20 && request.codeVerifier.length > 40);
});

test("institutional auth 1b: configured public URL never falls back to the retired Sites hostname", async () => {
  const request = await google.createGoogleAuthorizationRequest("/");
  const redirectUri = new URL(request.authorizationUrl).searchParams.get("redirect_uri");
  assert.equal(redirectUri, "https://network.teamsynapse.app/auth/google/callback");
  assert.notEqual(redirectUri, "https://iiml-alumni-intelligence.dokina-ramakrishna.chatgpt.site/auth/google/callback");
});

test("institutional auth 2: provider-neutral application sessions are signed and verifiable", async () => {
  const token = await sessions.createAppSessionToken({ applicationUserId: 7, applicationIdentityId: 11, provider: "google_workspace" });
  const claims = await sessions.verifyAppSessionToken(token);
  assert.equal(claims.applicationUserId, 7);
  assert.equal(claims.applicationIdentityId, 11);
  assert.equal(claims.provider, "google_workspace");
});

test("institutional auth 3: tampered application sessions are rejected", async () => {
  const token = await sessions.createAppSessionToken({ applicationUserId: 7, applicationIdentityId: 11, provider: "google_workspace" });
  const [payload, signature] = token.split(".");
  const replacement = signature[0] === "a" ? "b" : "a";
  assert.equal(await sessions.verifyAppSessionToken(`${payload}.${replacement}${signature.slice(1)}`), null);
});

test("institutional auth 4: expired application sessions are rejected", async () => {
  const token = await sessions.createAppSessionToken({ applicationUserId: 7, applicationIdentityId: 11, provider: "google_workspace" });
  const originalNow = Date.now;
  Date.now = () => originalNow() + 9 * 60 * 60 * 1000;
  try { assert.equal(await sessions.verifyAppSessionToken(token), null); } finally { Date.now = originalNow; }
});

test("institutional auth 5: valid Google Workspace ID tokens require signature, issuer, audience, nonce and verified domain", async () => {
  const fixture = await googleTokenFixture({ hd: "iiml.ac.in", email: "approved@iiml.ac.in", email_verified: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [fixture.publicJwk] });
  try {
    const identity = await google.verifyGoogleIdToken(fixture.token, "expected-nonce");
    assert.equal(identity.provider, "google_workspace");
    assert.equal(identity.email, "approved@iiml.ac.in");
    assert.equal(identity.providerSubjectId, "google-subject-123");
  } finally { globalThis.fetch = originalFetch; }
});

test("institutional auth 6: wrong-domain Google identities are rejected", async () => {
  const fixture = await googleTokenFixture({ hd: "example.com", email: "person@example.com", email_verified: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [fixture.publicJwk] });
  try { await assert.rejects(() => google.verifyGoogleIdToken(fixture.token, "expected-nonce"), error => error.code === "institutional_domain_required"); } finally { globalThis.fetch = originalFetch; }
});

test("institutional auth 7: unverified institutional email claims are rejected", async () => {
  const fixture = await googleTokenFixture({ hd: "iiml.ac.in", email: "approved@iiml.ac.in", email_verified: false });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [fixture.publicJwk] });
  try { await assert.rejects(() => google.verifyGoogleIdToken(fixture.token, "expected-nonce"), error => error.code === "email_not_verified"); } finally { globalThis.fetch = originalFetch; }
});

test("institutional auth 8: authentication links only to a pre-authorized user and preserves deny-by-default", () => {
  assert.match(security, /eq\(applicationUsers\.email, email\)/);
  assert.match(security, /if \(!user \|\| !isApplicationRole\(user\.role\)\)/);
  assert.match(security, /not_authorized/);
  assert.match(security, /identity_linked/);
  assert.doesNotMatch(security, /provider === "google_workspace"[\s\S]{0,500}insert\(applicationUsers\)/);
});

test("institutional auth 9: disabled and missing-role users are rejected on every session-backed request", () => {
  assert.match(security, /resolveSessionIdentity/);
  assert.match(security, /!isApplicationRole\(user\.role\)/);
  assert.match(security, /if \(!user\.enabled\)/);
  assert.match(security, /account_disabled/);
});

test("institutional auth 10: roles are absent from signed claims and reloaded from application_users", () => {
  assert.doesNotMatch(String(sessions.createAppSessionToken), /role/);
  assert.match(security, /from\(applicationUsers\).*claims\.applicationUserId/);
  assert.match(security, /role: user\.role as ApplicationRole/);
});

test("institutional auth 11: OAuth replay controls bind and clear the transient state cookie", () => {
  assert.match(callback, /state !== transient\.state/);
  assert.match(callback, /transient\.codeVerifier/);
  assert.match(callback, /transient\.nonce/);
  assert.match(callback, /clearGoogleOAuthCookie/);
});

test("institutional auth 12: ChatGPT remains a recovery identity through the same application session", () => {
  assert.match(layout, /Admin sign in/);
  assert.match(loginEntry, /Admin recovery with ChatGPT/);
  assert.match(chatgpt, /resolveAuthorizedIdentity\(identity\)/);
  assert.match(chatgpt, /createAppSessionToken/);
  assert.match(security, /provider === "chatgpt"/);
});

test("institutional auth 13: the identity migration is additive and Admin data lists linked providers", () => {
  assert.match(schema, /applicationIdentities = sqliteTable\("application_identities"/);
  assert.match(migration, /CREATE TABLE `application_identities`/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE .* DROP/i);
  assert.match(admin, /identities: identities\.filter/);
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_PUBLIC_URL", "APP_BASE_PATH", "GOOGLE_ALLOWED_DOMAIN", "AUTH_SESSION_SECRET"]) assert.match(envExample, new RegExp(key));
});

test("institutional auth 14: wrong-audience Google tokens are rejected", async () => {
  const fixture = await googleTokenFixture({ aud: "another-client.apps.googleusercontent.com", hd: "iiml.ac.in", email: "approved@iiml.ac.in", email_verified: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [fixture.publicJwk] });
  try { await assert.rejects(() => google.verifyGoogleIdToken(fixture.token, "expected-nonce"), error => error.code === "invalid_audience"); } finally { globalThis.fetch = originalFetch; }
});

test("institutional auth 15: invalid Google token signatures are rejected", async () => {
  const fixture = await googleTokenFixture({ hd: "iiml.ac.in", email: "approved@iiml.ac.in", email_verified: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [fixture.publicJwk] });
  const parts = fixture.token.split(".");
  const replacement = parts[2][0] === "a" ? "b" : "a";
  const tampered = `${parts[0]}.${parts[1]}.${replacement}${parts[2].slice(1)}`;
  try { await assert.rejects(() => google.verifyGoogleIdToken(tampered, "expected-nonce"), error => error.code === "invalid_id_token_signature"); } finally { globalThis.fetch = originalFetch; }
});

test("institutional auth 16: provider subjects are unique while one user may link multiple providers", () => {
  assert.match(migration, /UNIQUE INDEX `idx_application_identities_provider_subject`.*`provider`,`provider_subject_id`/s);
  assert.doesNotMatch(migration, /UNIQUE INDEX[^\n]*application_user_id/);
  assert.match(security, /onConflictDoNothing\(\)/);
  assert.match(security, /linkedIdentity\.applicationUserId !== user\.id/);
});

async function googleTokenFixture(overrides) {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const payload = encodeJson({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: "google-subject-123", name: "Approved User", nonce: "expected-nonce", iat: now - 5, exp: now + 300, ...overrides });
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(signingInput)));
  return { publicJwk, token: `${signingInput}.${encodeBytes(signature)}` };
}

function encodeJson(value) { return encodeBytes(new TextEncoder().encode(JSON.stringify(value))); }
function encodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
