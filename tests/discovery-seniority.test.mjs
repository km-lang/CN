import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const execution = await vite.ssrLoadModule("/lib/discovery-execution.ts")
const coverage = await vite.ssrLoadModule("/lib/discovery-coverage.ts")
const capabilities = await vite.ssrLoadModule("/lib/discovery-provider-capabilities.ts")
const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

const filters = overrides => ({
  ...search.defaultDiscoveryFilters(),
  discoveryProgrammes: [],
  company: "Lincoln International",
  graduationYear: "",
  ...overrides,
})

const preview = (id, title) => ({
  providerResultId: id,
  providerPersonId: id,
  name: `Candidate ${id}`,
  education: "Education not returned",
  currentCompany: "Lincoln International",
  role: title,
  rawTitle: title,
  function: "Finance",
  seniority: "",
  location: "Mumbai",
  graduationYear: 0,
  linkedinUrl: `https://www.linkedin.com/in/${id}`,
  matchConfidence: 70,
  affiliationStatus: "Potential alumnus — review required",
  educationProgramme: "",
  normalizedProgramme: "",
  programmeStatus: "Programme requires review",
  alumniStatus: "Graduation status unknown — review required",
  eligibleForAddition: false,
  educationStartDate: "",
  educationEndDate: "",
  institutionId: "",
  institutionUrl: "",
  currentCompanyId: "",
  currentCompanyUrl: "",
  currentRoleStartDate: "",
  currentIndustry: "Investment Banking",
  currentRoleAmbiguous: false,
  providerFreshnessAt: "",
})

test("multi-seniority normalization is canonical, deduplicated, safe, and backward compatible", () => {
  assert.deepEqual(search.normalizeDiscoverySeniorities(["VP", "VP", " Director ", "unsupported"]), ["Director", "VP"])
  assert.deepEqual(search.normalizeDiscoverySeniorities(undefined, "VP"), ["VP"])
  assert.deepEqual(search.normalizeDiscoverySeniorities([], "All levels"), [])
  assert.equal(search.discoverySenioritySummary({ seniorities: ["VP", "Director"], seniority: "All levels" }), "Director, VP")

  const legacy = search.normalizeDiscoveryFiltersInput({ seniority: "VP" })
  assert.deepEqual(legacy.seniorities, ["VP"])
  assert.equal(legacy.seniority, "VP")
  const modern = search.normalizeDiscoveryFiltersInput({ seniorities: ["VP", " Director ", "VP"] })
  assert.deepEqual(modern.seniorities, ["Director", "VP"])
  assert.equal(modern.seniority, "All levels")
})

test("multiple exact levels use OR semantics with human-readable rationale", () => {
  const requested = filters({ seniorities: ["CXO", "Director", "EVP/SVP", "VP"] })
  const cases = [
    ["Director, Technology Investment Banking", "MATCH", "Director"],
    ["Vice President", "MATCH", "VP"],
    ["Senior Vice President", "MATCH", "EVP/SVP"],
    ["Chief Financial Officer", "MATCH", "CXO"],
    ["Senior Manager", "MISMATCH", ""],
  ]
  for (const [title, result, selected] of cases) {
    const criterion = execution.qualifyPreviewCandidate(preview(title.replaceAll(" ", "-"), title), requested).seniority
    assert.equal(criterion.result, result, title)
    if (selected) assert.match(criterion.rationale, new RegExp(`matches selected ${selected.replace("/", "\\/")}`))
  }
})

test("exact and threshold selections preserve the existing rank semantics", () => {
  const requested = filters({ seniorities: ["VP+", "Manager"] })
  for (const title of ["Manager", "Vice President", "Senior Vice President", "Chief Executive Officer"]) {
    assert.equal(execution.qualifyPreviewCandidate(preview(title, title), requested).seniority.result, "MATCH", title)
  }
  for (const title of ["Senior Manager", "Director"]) {
    assert.equal(execution.qualifyPreviewCandidate(preview(title, title), requested).seniority.result, "MISMATCH", title)
  }
})

test("reporting-relationship titles remain insufficient rather than inheriting an executive's seniority", () => {
  const requested = filters({ seniorities: ["Director", "VP", "EVP/SVP", "CXO"] })
  for (const title of ["Assistant to the Vice President", "Assistant to Director", "Advisor to CEO", "Chief of Staff to EVP"]) {
    assert.deepEqual(execution.titleSeniority(title), { bucket: "", ambiguous: true })
    assert.equal(execution.qualifyPreviewCandidate(preview(title, title), requested).seniority.result, "INSUFFICIENT_EVIDENCE")
  }
})

test("legacy single seniority remains exact while All levels imposes no restriction", () => {
  const legacy = filters({ seniority: "VP" })
  assert.equal(execution.qualifyPreviewCandidate(preview("vp", "Vice President"), legacy).seniority.result, "MATCH")
  assert.equal(execution.qualifyPreviewCandidate(preview("director", "Director"), legacy).seniority.result, "MISMATCH")
  assert.equal(execution.qualifyPreviewCandidate(preview("analyst", "Analyst"), filters({ seniority: "All levels" })).seniority.result, "NOT_REQUESTED")
})

test("coverage identity is set-based while distinct sets and thresholds remain distinct", () => {
  const firstFilters = filters({ seniorities: ["VP", "Director"] })
  const reorderedFilters = filters({ seniorities: ["Director", "VP"] })
  const first = coverage.normalizeDiscoveryCoverageFilters(firstFilters)
  const reordered = coverage.normalizeDiscoveryCoverageFilters(reorderedFilters)
  const vpOnly = coverage.normalizeDiscoveryCoverageFilters(filters({ seniorities: ["VP"] }))
  const directorPlus = coverage.normalizeDiscoveryCoverageFilters(filters({ seniorities: ["Director+"] }))
  assert.deepEqual(first, reordered)
  assert.deepEqual(execution.qualifyPreviewCandidate(preview("order", "Vice President"), firstFilters), execution.qualifyPreviewCandidate(preview("order", "Vice President"), reorderedFilters))
  assert.equal(search.criteriaSummary(firstFilters), search.criteriaSummary(reorderedFilters))
  assert.notDeepEqual(first, vpOnly)
  assert.notDeepEqual(first, directorPlus)

  const history = [{ id: 1, provider: "coresignal", mode: "live", filtersJson: JSON.stringify({ ...filters({ seniority: "VP" }), seniorities: undefined }), createdAt: "2026-10-12T00:00:00.000Z" }]
  const plan = coverage.discoveryCoveragePlan(filters({ seniorities: ["VP"] }), history, { now: new Date("2026-10-13T00:00:00.000Z") })
  assert.equal(plan.overallState, "RECENTLY_SEARCHED")
})

test("seniority never becomes experience_title while an explicit Role remains provider-side", () => {
  const body = client.coresignalSearchContract(filters({
    company: "Lincoln International",
    graduationYear: "2013",
    discoveryProgrammes: ["PGP", "ABM", "SM"],
    seniorities: ["VP", "Director"],
  })).body
  assert.deepEqual(body, {
    education_institution_professional_network_url: client.CORESIGNAL_IIML_INSTITUTION_URL,
    active_experience: true,
    education_date_to: "2013",
    experience_company_name: "Lincoln International",
  })

  const roleBody = client.coresignalSearchContract(filters({ role: "Vice President", seniorities: ["Director", "VP"] })).body
  assert.equal(roleBody.experience_title, "(Vice President)")
})

test("selective execution collects only the four Director-or-VP previews", async () => {
  const titles = ["Director", "Director", "Vice President", "Vice President", "Chief Financial Officer", "Senior Manager", "Senior Manager", "Analyst"]
  let calls = 0
  const result = await execution.executeSelectiveDiscovery({
    previewProfiles: titles.map((title, index) => preview(`candidate-${index}`, title)),
    filters: filters({ seniorities: ["Director", "VP"] }),
    alumni: [],
    rejectedCandidates: [],
    capabilities: capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
    requestedCount: 8,
    maximumCollects: 8,
    collect: async (id, index) => {
      calls += 1
      return { ...preview(id, titles[index]), education: "Indian Institute of Management Lucknow", currentRoles: [{ company: "Lincoln International", title: titles[index], seniority: "", startDate: "2020" }] }
    },
  })
  assert.equal(calls, 4)
  assert.equal(result.metrics.collectExecuted, 4)
  assert.equal(result.metrics.collectSkippedFilter, 4)
  assert.equal(result.metrics.seniorityMismatches, 4)
})

test("multiple current roles can match without resolving role ambiguity or mutating the profile", () => {
  const profile = {
    ...preview("multiple", "Multiple current roles — review required"),
    currentRoleAmbiguous: true,
    currentRoles: [
      { company: "Lincoln International", title: "Vice President", seniority: "VP", startDate: "2021" },
      { company: "Another Company", title: "Advisor", seniority: "Associate/Consultant", startDate: "2022" },
    ],
  }
  const before = structuredClone(profile)
  const qualified = execution.qualifyCollectedCandidate(profile, filters({ seniorities: ["VP"] }))
  assert.equal(qualified.seniority.result, "VERIFIED_MATCH")
  assert.equal(profile.currentRoleAmbiguous, true)
  assert.deepEqual(profile, before)
})

test("the External Discovery UI uses an explicit checkbox multi-select and readable summaries", () => {
  assert.match(page, /role="combobox"[^>]*aria-label="Discovery seniority"/)
  assert.match(page, /type="checkbox" checked=\{!selectedDiscoverySeniorities\(discoveryFilters\)\.length\}/)
  assert.match(page, /Matches any selected level locally from the returned Preview title\./)
  assert.match(page, /discoverySenioritySummary\(lastDiscoveryFilters\)/)
  assert.match(page, /discoverySenioritySummary\(pendingDiscoveryFilters\)/)
})
