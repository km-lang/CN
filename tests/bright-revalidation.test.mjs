import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const { authenticateBrightRevalidation, revalidateBrightItems } = await vite.ssrLoadModule("/lib/bright-revalidation.ts")
const route = await readFile(new URL("../app/api/intelligence/bright-eligibility/revalidate/route.ts", import.meta.url), "utf8")

const secret = "service-only-test-secret"
const url = "https://www.linkedin.com/in/approved-person/"
const item = { sourceId: "cn:17", intelligenceAlumniId: "11111111-1111-4111-8111-111111111111", normalizedLinkedinUrl: url }
const current = overrides => ({ id: 17, linkedinUrl: url, profileMatch: "Confirmed", professionalDataStatus: "Verified", lifecycleStatus: "Active", ...overrides })

test("internal revalidation authentication requires the service bearer credential", () => {
  assert.equal(authenticateBrightRevalidation(new Request("http://local", { headers: { cookie: "role=ADMIN", "x-user-role": "ADMIN" } }), secret), false)
  assert.equal(authenticateBrightRevalidation(new Request("http://local", { headers: { cookie: "role=PCOM", "x-user-role": "PCOM" } }), secret), false)
  assert.equal(authenticateBrightRevalidation(new Request("http://local", { headers: { cookie: "role=DEVELOPER", "x-user-role": "DEVELOPER" } }), secret), false)
  assert.equal(authenticateBrightRevalidation(new Request("http://local", { headers: { authorization: "Bearer wrong" } }), secret), false)
  assert.equal(authenticateBrightRevalidation(new Request("http://local", { headers: { authorization: `Bearer ${secret}` } }), secret), true)
})

test("current CN state controls eligibility independent of record origin", () => {
  for (const origin of ["Manual", "CSV", "Coresignal"]) {
    const [result] = revalidateBrightItems([{ ...item, origin }], new Map([[17, current({ origin })]]))
    assert.equal(result.eligible, true)
    assert.equal(result.reason, "ELIGIBLE")
  }
})

test("malformed, missing, mismatched, inactive, unverified, and conflicted records fail closed", () => {
  assert.equal(revalidateBrightItems([{ ...item, sourceId: "cn:not-an-id" }], new Map())[0].reason, "INVALID_SOURCE_ID")
  assert.equal(revalidateBrightItems([item], new Map())[0].reason, "NOT_FOUND")
  assert.equal(revalidateBrightItems([item], new Map([[17, current({ linkedinUrl: "https://www.linkedin.com/in/changed/" })]]))[0].reason, "LINKEDIN_CHANGED")
  assert.equal(revalidateBrightItems([item], new Map([[17, current({ lifecycleStatus: "Inactive" })]]))[0].reason, "INACTIVE")
  assert.equal(revalidateBrightItems([item], new Map([[17, current({ profileMatch: "Unverified" })]]))[0].reason, "LINKEDIN_NOT_VERIFIED")
  assert.equal(revalidateBrightItems([item], new Map([[17, current({ professionalDataStatus: "Conflict — manual verification required" })]]))[0].reason, "IDENTITY_CONFLICT")
  assert.equal(revalidateBrightItems([{ ...item, sourceId: "cn:18" }], new Map([[18, current({ id: 18, linkedinUrl: "https://www.linkedin.com/in/different-person/" })]]))[0].reason, "LINKEDIN_CHANGED")
})

test("route is bounded, server-secret only, bulk-loaded, and returns no secret", () => {
  assert.match(route, /INTELLIGENCE_SERVICE_SECRET/)
  assert.match(route, /authenticateBrightRevalidation/)
  assert.match(route, /BRIGHT_REVALIDATION_BATCH_LIMIT/)
  assert.match(route, /inArray\(alumni\.id, ids\)/)
  assert.match(route, /cache-control.*no-store/)
  assert.doesNotMatch(route, /authorizeRequest|NEXT_PUBLIC|secret\s*:/)
})
