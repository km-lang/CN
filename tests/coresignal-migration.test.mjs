import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const originalEnvironment = { CORESIGNAL_API_KEY: process.env.CORESIGNAL_API_KEY, CORESIGNAL_LIVE_ENABLED: process.env.CORESIGNAL_LIVE_ENABLED }
process.env.CORESIGNAL_API_KEY = "test-coresignal-key-never-sent-to-a-real-provider"
process.env.CORESIGNAL_LIVE_ENABLED = "false"

after(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await vite.close()
})

const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const adapter = await vite.ssrLoadModule("/lib/coresignal-adapter.ts")
const limits = await vite.ssrLoadModule("/lib/discovery-limit.ts")
const usage = await vite.ssrLoadModule("/lib/provider-usage.ts")
const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")

const iiml = (overrides = {}) => ({
  institution_name: "Indian Institute of Management Lucknow",
  institution_professional_network_url: client.CORESIGNAL_IIML_INSTITUTION_URL,
  degree_name: "MBA",
  date_from: "2019",
  date_to: "2021",
  deleted: 0,
  ...overrides,
})

const employee = (overrides = {}) => ({
  id: "421745303",
  full_name: "Hemant Singh",
  professional_network_url: "https://www.linkedin.com/in/hemant-singh",
  deleted: 0,
  education: [iiml()],
  experience: [{ company_name: "Ultrahuman", title: "Lead - Marketplace Growth", is_current: 1, deleted: 0 }],
  ...overrides,
})

test("Coresignal search contract uses the canonical IIML URL and only the validated active-experience filter", () => {
  assert.deepEqual(client.coresignalSearchContract(), {
    method: "POST",
    path: "/cdapi/v2/employee_base/search/filter/preview",
    body: { education_institution_professional_network_url: "https://www.linkedin.com/school/indian-institute-of-management-lucknow", active_experience: true },
  })
})

test("Coresignal collect contract uses the stable employee ID", () => {
  assert.deepEqual(client.coresignalCollectContract("421745303"), { method: "GET", path: "/cdapi/v2/employee_base/collect/421745303" })
  const mapped = adapter.mapCoresignalProfile(employee(), 0)
  assert.equal(mapped.providerPersonId, "421745303")
})

test("Search and Collect send the server-side apikey header and never use Bearer authorization", async () => {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) })
    return new Response(JSON.stringify(String(url).includes("/collect/") ? employee() : []), { status: 200, headers: { "content-type": "application/json" } })
  }
  await client.searchCoresignalIiml({ fetcher })
  await client.collectCoresignalEmployee("421745303", { fetcher })
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.headers.get("apikey"), process.env.CORESIGNAL_API_KEY)
    assert.equal(call.headers.has("authorization"), false)
  }
})

test("Coresignal errors never return or log the secret value", async () => {
  await assert.rejects(
    () => client.searchCoresignalIiml({ fetcher: async () => new Response("secret provider payload", { status: 401 }) }),
    error => !error.message.includes(process.env.CORESIGNAL_API_KEY) && !error.message.includes("secret provider payload"),
  )
  assert.doesNotMatch(discoveryRoute, /CORESIGNAL_API_KEY|provider payload/)
})

test("multiple mock search results are bounded by the application result limit", async () => {
  const filters = { name: "", company: "All companies", role: "", function: "All functions", seniority: "All levels", location: "", programme: "All programmes", batch: "", previousCompany: "", minRelevance: 0, minConfidence: 0, contactStatus: "All contact states", outreachStatus: "All outreach states", relationship: "All relationships" }
  const result = await adapter.coresignalProvider.searchCandidates(filters, [{ id: 15, name: "Sahil Bansal", batch: 2015, company: "Google", title: "Product Leader", function: "Product", seniority: "Director", location: "Bengaluru", linkedinUrl: "https://linkedin.com/in/sahilb" }], 3)
  assert.equal(result.profiles.length, 3)
  assert.equal(result.usage.applicationUnits, 3)
  assert.equal(result.usage.providerReportedUsage, null)
  assert.equal(limits.validateDiscoveryCount(4, 3, 20).ok, false)
})

test("successful Search and Collect operations each cost one direct API operation credit", () => {
  assert.equal(adapter.successfulCoresignalOperationCredits(true, 0), 1)
  assert.equal(adapter.successfulCoresignalOperationCredits(true, 3), 4)
  assert.equal(adapter.successfulCoresignalOperationCredits(false, 0), 0)
  assert.equal(adapter.successfulCoresignalOperationCredits(false, 3), 3)
})

test("failed non-200 requests are not recorded as successful operation credits", async () => {
  await assert.rejects(
    () => client.collectCoresignalEmployee("421745303", { fetcher: async () => new Response("unavailable", { status: 503 }) }),
    error => error.successfulOperationCredits === 0,
  )
  assert.match(discoveryRoute, /applicationUnits: failure\.successfulOperationCredits/)
})

test("deleted people and deleted education are ignored while surviving education is retained", () => {
  assert.equal(adapter.mapCoresignalProfile(employee({ deleted: 1 }), 0), null)
  const mapped = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "Deleted MBA", deleted: 1 }), iiml({ degree_name: "PGDM Marketing Finance" })] }), 0)
  assert.equal(mapped.educationProgramme, "PGDM Marketing Finance")
  assert.equal(mapped.affiliationStatus, "Confirmed degree alumnus")
})

test("current employment requires deleted=0 and is_current=1", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ experience: [
    { company_name: "Deleted Employer", title: "Wrong role", is_current: 1, deleted: 1 },
    { company_name: "Historical Employer", title: "Old role", is_current: 0, deleted: 0 },
    { company_name: "Amazon", title: "Head of Product", is_current: 1, deleted: 0 },
  ] }), 0)
  assert.equal(mapped.currentCompany, "Amazon")
  assert.equal(mapped.role, "Head of Product")
})

test("multiple surviving current roles are explicit and never guessed", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ experience: [
    { company_name: "Company A", title: "Director", is_current: 1, deleted: 0 },
    { company_name: "Company B", title: "Advisor", is_current: 1, deleted: 0 },
  ] }), 0)
  assert.equal(mapped.currentRoleAmbiguous, true)
  assert.equal(mapped.currentCompanyId, "")
  assert.match(mapped.currentCompany, /Multiple current roles/)
})

test("affiliation classification distinguishes degrees, exchanges, and uncertain evidence without a duration threshold", () => {
  assert.equal(adapter.classifyIimlAffiliation(iiml({ degree_name: "MBA" })), "Confirmed degree alumnus")
  assert.equal(adapter.classifyIimlAffiliation(iiml({ degree_name: "Exchange programme" })), "Short-term / exchange affiliation")
  assert.equal(adapter.classifyIimlAffiliation(iiml({ degree_name: "Marketing" })), "Potential alumnus — review required")
  assert.doesNotMatch((adapter.classifyIimlAffiliation).toString(), /duration|month|day/)
})

test("zero results and provider failures remain explicit", async () => {
  const filters = { name: "No such person", company: "All companies", role: "", function: "All functions", seniority: "All levels", location: "", programme: "All programmes", batch: "", previousCompany: "", minRelevance: 0, minConfidence: 0, contactStatus: "All contact states", outreachStatus: "All outreach states", relationship: "All relationships" }
  const result = await adapter.coresignalProvider.searchCandidates(filters, [], 5)
  assert.equal(result.profiles.length, 0)
  assert.equal(result.usage.applicationUnits, 0)
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  await assert.rejects(() => client.searchCoresignalIiml({ fetcher: async () => new Response("rate limited", { status: 429 }) }), error => error.kind === "rate_limit" && error.status === 429)
  process.env.CORESIGNAL_LIVE_ENABLED = "false"
})

test("review-before-add, Keep Existing, and selected-field apply remain enforced", () => {
  assert.match(discoveryRoute, /affiliationStatus !== "Confirmed degree alumnus"/)
  assert.match(discoveryRoute, /action === "qualify"/)
  assert.match(enrichmentRoute, /status: applied\.length \? "Applied" : "Reviewed — kept existing"/)
  assert.match(page, /Apply Selected Updates/)
  assert.match(page, /Keep existing/)
})

test("new operations use Coresignal while historical PDL provenance stays readable", () => {
  assert.match(discoveryRoute, /provider: PROFESSIONAL_DATA_PROVIDER/)
  assert.match(enrichmentRoute, /coresignal_profile_refresh/)
  assert.match(schema, /pdlPersonId: text\("pdl_person_id"\)/)
  assert.match(page, /"PDL sourced", "Coresignal sourced"/)
  assert.match(admin, /Historical PDL evidence remains readable/)
})

test("Coresignal never owns email or phone and Lusha contact/signals remain separate", () => {
  const adapterSource = adapter.coresignalProvider.refreshProfile.toString()
  assert.doesNotMatch(adapterSource, /email|phone/i)
  assert.doesNotMatch(discoveryRoute, /emailSource:\s*PROFESSIONAL_DATA_PROVIDER_LABEL|phoneSource:\s*PROFESSIONAL_DATA_PROVIDER_LABEL/)
  assert.match(enrichmentRoute, /emailSource: "Lusha"/)
  assert.match(page, /Lusha Professional Signals/)
})

test("mock/disabled readiness and unknown provider usage are represented safely", () => {
  assert.equal(runtime.providerMode("coresignal"), "mock")
  assert.equal(runtime.providerConfigured("coresignal"), true)
  assert.equal(usage.providerUsageLabel({ provider: "coresignal", mode: "live", usageState: "reconciliation_required", providerReportedCredits: null, creditsUsed: 0 }).label, "Reconciliation required")
  assert.match(admin, /Coresignal/)
  assert.doesNotMatch(page, /Validate PDL connection/)
})
