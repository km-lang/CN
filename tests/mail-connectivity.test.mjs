import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const mail = await vite.ssrLoadModule("/lib/mail-service.ts")
const { hasPermission } = await vite.ssrLoadModule("/lib/security-policy.ts")
const route = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const panel = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const source = await readFile(new URL("../lib/mail-service.ts", import.meta.url), "utf8")

const keys = ["MAIL_PROVIDER", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "MAIL_MODE", "MAIL_LIVE_ENABLED"]
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
Object.assign(process.env, { MAIL_PROVIDER: "gmail", GMAIL_CLIENT_ID: "client", GMAIL_CLIENT_SECRET: "client-secret-value", GMAIL_REFRESH_TOKEN: "refresh-token-value", MAIL_MODE: "mock", MAIL_LIVE_ENABLED: "false" })
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("Gmail connectivity validates OAuth refresh and available send scope without sending", async () => {
  const calls = []
  const result = await mail.validateGmailConnectivity({ checkedAt: "2026-09-23T00:00:00.000Z", fetcher: async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: String(init.body) })
    return new Response(JSON.stringify({ access_token: "private-access-token", scope: "openid https://www.googleapis.com/auth/gmail.send" }), { status: 200 })
  } })
  assert.equal(result.status, "confirmed")
  assert.equal(result.scopeVerified, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token")
  assert.equal(calls[0].method, "POST")
  assert.doesNotMatch(JSON.stringify(result), /private-access-token|client-secret-value|refresh-token-value/)
  assert.doesNotMatch(calls[0].url, /gmail\.googleapis\.com|messages\/send/)
})

test("Gmail connectivity reports confirmed authentication when refresh omits scope metadata", async () => {
  const result = await mail.validateGmailConnectivity({ fetcher: async () => new Response(JSON.stringify({ access_token: "private-access-token" }), { status: 200 }) })
  assert.equal(result.status, "confirmed")
  assert.equal(result.scopeVerified, null)
  assert.equal(result.outcome, "oauth_authenticated_scope_unreported")
})

test("Gmail connectivity distinguishes rejected authorization, timeout, and malformed response", async () => {
  const revoked = await mail.validateGmailConnectivity({ fetcher: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) })
  const timeout = await mail.validateGmailConnectivity({ fetcher: async () => { throw new DOMException("timed out", "TimeoutError") } })
  const malformed = await mail.validateGmailConnectivity({ fetcher: async () => new Response("not json", { status: 200 }) })
  assert.deepEqual([revoked.status, timeout.status, malformed.status], ["failed", "unknown", "unknown"])
  assert.deepEqual([revoked.outcome, timeout.outcome, malformed.outcome], ["authorization_revoked", "timeout", "malformed_response"])
})

test("Gmail connectivity is Admin-only, audited, and exposed in Administration", () => {
  assert.equal(hasPermission("ADMIN", "MANAGE_USERS"), true)
  assert.equal(hasPermission("PCOM", "MANAGE_USERS"), false)
  assert.equal(hasPermission("DEVELOPER", "MANAGE_USERS"), false)
  const auth = route.indexOf('await authorizeRequest(request, "MANAGE_USERS")', route.indexOf("export async function POST"))
  const call = route.indexOf("await validateGmailConnectivity()")
  assert.ok(auth >= 0 && auth < call)
  assert.match(route, /action: "gmail_connectivity_validated"/)
  assert.match(route, /mailValidationReadiness/)
  assert.match(panel, /Validate Gmail Connectivity/)
  assert.match(panel, /No email is created or sent/)
})

test("Gmail connectivity validation cannot send mail or expose OAuth secrets", () => {
  const validator = source.match(/export async function validateGmailConnectivity[\s\S]*?\n}\n\nexport async function sendMail/)?.[0] ?? ""
  assert.doesNotMatch(validator, /messages\/send|gmail\.googleapis\.com/)
  assert.doesNotMatch(route, /accessToken|refresh_token|client_secret/)
  assert.doesNotMatch(panel, /GMAIL_CLIENT_SECRET|GMAIL_REFRESH_TOKEN|accessToken/)
  assert.doesNotMatch(route, /process\.env\.MAIL_|process\.env\.GMAIL_/)
})
