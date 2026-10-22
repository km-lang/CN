import assert from "node:assert/strict"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const { savedHistoryFailure } = await vite.ssrLoadModule("/lib/saved-history-diagnostics.ts")

test("unexpected saved-history errors expose only a correlation ID and sanitized diagnostic fields", async () => {
  const original = console.error
  const logged = []
  console.error = (...args) => logged.push(args)
  try {
    const failure = Object.assign(new Error("secret-token person@example.test SELECT * FROM application_identities"), { code: "SQLITE_BUSY", sql: "SELECT sensitive_data" })
    const response = savedHistoryFailure(failure, "discovery", "candidate_evidence_lookup")
    const body = await response.json()
    assert.equal(response.status, 500)
    assert.match(body.requestId, /^[a-f0-9-]{36}$/)
    assert.equal(response.headers.get("x-cn-request-id"), body.requestId)
    assert.deepEqual(logged[0], ["Saved history request failed", { requestId: body.requestId, endpoint: "discovery", stage: "candidate_evidence_lookup", code: "SQLITE_BUSY", errorType: "Error", runtime: process.env.NODE_ENV === "production" ? "production" : "local" }])
    assert.doesNotMatch(JSON.stringify({ body, logged }), /secret-token|person@example\.test|SELECT sensitive_data|application_identities/)
  } finally { console.error = original }
})
