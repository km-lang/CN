import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const contacts = await vite.ssrLoadModule("/lib/contact-enrichment.ts")
const engagement = await vite.ssrLoadModule("/lib/engagement-filters.ts")
const runtime = await vite.ssrLoadModule("/lib/runtime-readiness.ts")
const usage = await vite.ssrLoadModule("/lib/provider-usage.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const adminApi = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const enrichmentApi = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")

test.after(async () => vite.close())

function person(overrides = {}) {
  return { id: 1, name: "Priya Sharma", email: "priya@example.test", phone: "", emailVerification: "Verified", phoneVerification: "Unverified", ...overrides }
}

test("contact plan skips verified email and retrieves only missing phone", () => {
  const plan = contacts.contactEnrichmentPlan([person()], ["email", "phone"])
  assert.equal(plan.emailOperations, 0)
  assert.equal(plan.phoneOperations, 1)
  assert.deepEqual(plan.rows[0].skippedVerified, ["email"])
})

test("contact plan handles inverse, both missing, and both verified states", () => {
  assert.deepEqual(contacts.eligibleContactChannels(person({ email: "", phone: "+91000", emailVerification: "Unverified", phoneVerification: "Verified" }), ["email", "phone"]), ["email"])
  assert.deepEqual(contacts.eligibleContactChannels(person({ email: "", phone: "", emailVerification: "", phoneVerification: "" }), ["email", "phone"]), ["email", "phone"])
  assert.deepEqual(contacts.eligibleContactChannels(person({ phone: "+91000", phoneVerification: "Verified" }), ["email", "phone"]), [])
})

test("server independently filters channels and never applies a provider change object wholesale", () => {
  assert.match(enrichmentApi, /eligibleContactChannels\(person, requestedChannels\)/)
  assert.match(enrichmentApi, /Existing verified contact channels preserved; no provider call was made/)
  assert.doesNotMatch(enrichmentApi, /set\(\{ \.\.\.result\.changes/)
  assert.match(enrichmentApi, /Conflict — manual verification required/)
})

test("All dates is unrestricted while All upcoming excludes historical events", () => {
  const historical = { eventType: "Birthday", eventDate: "2026-01-01", status: "New", assignedTo: "", alumnus: { company: "Example", email: "a@example.test" } }
  const base = { queue: "Birthdays", company: "All companies", assignee: "All assignees", actionState: "All email states", currentUser: "Admin", today: "2026-09-26" }
  assert.equal(engagement.engagementMatches(historical, { ...base, period: "All dates" }), true)
  assert.equal(engagement.engagementMatches(historical, { ...base, period: "All upcoming" }), false)
})

test("engagement assignee filters compose and Assigned-to-Me queue owns its assignee rule", () => {
  const event = { eventType: "Birthday", eventDate: "2026-09-27", status: "New", assignedTo: "Local PCOM", alumnus: { company: "Example", email: "a@example.test" } }
  const base = { queue: "Birthdays", period: "All dates", company: "All companies", actionState: "All email states", currentUser: "Local PCOM", today: "2026-09-26" }
  assert.equal(engagement.engagementMatches(event, { ...base, assignee: "All assignees" }), true)
  assert.equal(engagement.engagementMatches(event, { ...base, assignee: "Assigned to me" }), true)
  assert.equal(engagement.engagementMatches(event, { ...base, assignee: "Named User" }), false)
  assert.equal(engagement.engagementMatches({ ...event, assignedTo: "" }, { ...base, assignee: "Unassigned" }), true)
  assert.equal(engagement.engagementMatches(event, { ...base, queue: "Assigned to Me", assignee: "Named User" }), true)
})

test("development badges cannot leak into production readiness states", () => {
  assert.equal(runtime.signalsPresentation({ development: true, liveEnabled: false, entitlement: "unknown", configured: false }).label, "Signals disabled in local development")
  assert.equal(runtime.signalsPresentation({ development: false, liveEnabled: true, entitlement: "confirmed", configured: true }).label, "Live")
  assert.equal(runtime.mailPresentation({ development: true, mode: "mock", configured: false }).label, "Mock mail · sending disabled")
  assert.equal(runtime.mailPresentation({ development: false, mode: "live", configured: true }).warning, false)
})

test("outreach, manual-entry and confirmation copy remain explicit", () => {
  assert.match(page, /All alumni/)
  assert.doesNotMatch(page, /setOutreachStatus\("All"\)/)
  assert.match(page, /manual-entry-icon"><UserPlus/)
  assert.match(page, /Check & Add Alumnus/)
  assert.match(page, /No PDL or Lusha call is made/)
  assert.match(page, /Confirm contact enrichment/)
})

test("mock usage is explicit and production missing usage remains reconciliation-required", () => {
  assert.deepEqual(usage.providerUsageLabel({ mode: "mock", creditsUsed: 1 }), { label: "1 simulated credit", detail: "Mock — no live credits consumed." })
  assert.equal(usage.providerUsageLabel({ mode: "live", usageState: "reconciliation_required" }).label, "Reconciliation required")
  assert.equal(usage.providerUsageLabel({ mode: "live", usageState: "provider_reported_zero", providerReportedCredits: 0 }).label, "0")
})

test("provider limits and history refresh are Admin-only on server and UI", () => {
  assert.match(enrichmentApi, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(enrichmentApi, /payload\.action === "refresh_history" \? "MANAGE_PROVIDER_SETTINGS"/)
  assert.match(enrichmentApi, /provider_history_refreshed/)
  assert.match(page, /session\.canAdminister && <Button variant="ghost" size="sm" onClick=\{\(\) => void refreshProviderHistory\(\)\}/)
})

test("PDL review has explicit keep-existing disposition", () => {
  assert.match(page, />Keep existing</)
  assert.match(enrichmentApi, /Reviewed — kept existing/)
})

test("administration safety rules are server enforced", () => {
  assert.match(adminApi, /googleAllowedDomain\(\)/)
  assert.match(adminApi, /GRANT ADMIN/)
  assert.match(adminApi, /DISABLE USER/)
  assert.match(adminApi, /count\(\*\) from application_users where role = 'ADMIN' and enabled = 1/)
  assert.match(adminApi, /At least one active Admin must remain/)
  assert.match(adminApi, /DEACTIVATE PROGRAMME/)
  assert.match(adminApi, /Type CLEANUP to confirm/)
  assert.match(adminApi, /Resolve the pending provider review/)
})

test("administration presents filters, friendly audit labels, and semantic programme icon", () => {
  assert.match(admin, /Search lifecycle alumni/)
  assert.match(admin, /All lifecycle states/)
  assert.match(admin, /All actors/)
  assert.match(admin, /friendlyAuditLabel/)
  assert.match(admin, /<BookPlus \/> Add programme/)
  assert.match(admin, /At least one active Admin must remain/)
})
