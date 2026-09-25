import assert from "node:assert/strict"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const metrics = await vite.ssrLoadModule("/lib/alumni-metrics.ts")

test("contact readiness uses one complete verification rule", () => {
  const ready = { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Likely", email: "Verified", phone: "Unverified" }
  assert.equal(metrics.contactReadiness(ready), "Contact-ready")
  assert.equal(metrics.contactReadiness({ ...ready, currentCompany: "Likely" }), "Partially verified")
  assert.equal(metrics.contactReadiness({ ...ready, email: "Unverified" }), "Partially verified")
  assert.equal(metrics.contactReadiness({ ...ready, profileMatch: "Mismatch" }), "Mismatch")
})

test("active outreach includes only progressed pipeline states", () => {
  assert.equal(metrics.isActiveOutreach("Not contacted"), false)
  for (const status of ["Contacted", "Responded", "Meeting set"]) assert.equal(metrics.isActiveOutreach(status), true)
})
