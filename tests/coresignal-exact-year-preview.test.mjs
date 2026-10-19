import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const adapter = await vite.ssrLoadModule("/lib/coresignal-adapter.ts")
const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const execution = await vite.ssrLoadModule("/lib/discovery-execution.ts")
const qualification = await vite.ssrLoadModule("/lib/discovery-qualification.ts")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8")
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8")
const providerDocs = await readFile(new URL("../docs/providers.md", import.meta.url), "utf8")
const operationalEvidence = await readFile(new URL("../docs/provider-evidence/coresignal-es-dsl-preview-2026-10-19.md", import.meta.url), "utf8")

const original = {
  NODE_ENV: process.env.NODE_ENV,
  CORESIGNAL_API_KEY: process.env.CORESIGNAL_API_KEY,
  CORESIGNAL_LIVE_ENABLED: process.env.CORESIGNAL_LIVE_ENABLED,
  CORESIGNAL_SEARCH_ENABLED: process.env.CORESIGNAL_SEARCH_ENABLED,
  CORESIGNAL_ES_DSL_PREVIEW_ENABLED: process.env.CORESIGNAL_ES_DSL_PREVIEW_ENABLED,
  CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: process.env.CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT,
  fetch: globalThis.fetch,
}

after(async () => {
  for (const [key, value] of Object.entries(original)) {
    if (key === "fetch") continue
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = original.fetch
  await vite.close()
})

function exactFilters(overrides = {}) {
  return {
    ...search.defaultDiscoveryFilters(),
    company: "Google",
    graduationYear: "2011",
    seniority: "VP+",
    seniorities: ["VP", "VP+"],
    discoveryProgrammes: [],
    ...overrides,
  }
}

test("exact-year Preview builder correlates institution/year and current/non-deleted company rows", () => {
  const contract = client.coresignalExactYearEsDslPreviewContract({ graduationYear: "2011", companyId: 12345 })
  assert.equal(contract.path, "/cdapi/v2/employee_base/search/es_dsl/preview")
  assert.equal(contract.maximumResults, 20)
  assert.equal("sort" in contract.body, false)
  const filters = contract.body.query.bool.filter
  const education = filters.find(item => item.nested?.path === "education").nested.query.bool.filter
  const experience = filters.find(item => item.nested?.path === "experience").nested.query.bool.filter
  assert.deepEqual(education, [
    { term: { "education.institution_id": 25919228 } },
    { term: { "education.date_to_year": 2011 } },
  ])
  assert.deepEqual(experience, [
    { term: { "experience.company_id": 12345 } },
    { term: { "experience.is_current": 1 } },
    { term: { "experience.deleted": 0 } },
  ])
})

test("unmapped company Preview uses exact company name in one current non-deleted experience row", () => {
  const contract = client.coresignalExactYearEsDslPreviewContract({ graduationYear: "2011", companyName: "  Google  " })
  assert.equal(contract.companyConstraintMode, "EXACT_NAME")
  const nested = contract.body.query.bool.filter.filter(item => item.nested).map(item => item.nested)
  assert.deepEqual(nested.find(item => item.path === "education").query.bool.filter, [
    { term: { "education.institution_id": 25919228 } },
    { term: { "education.date_to_year": 2011 } },
  ])
  assert.deepEqual(nested.find(item => item.path === "experience").query.bool.filter, [
    { term: { "experience.company_name.exact": "Google" } },
    { term: { "experience.is_current": 1 } },
    { term: { "experience.deleted": 0 } },
  ])
  assert.throws(() => client.coresignalExactYearEsDslPreviewContract({ graduationYear: 2011, companyId: 97124966, companyName: "Google" }), /either a verified company ID or an exact company name/)
  assert.doesNotMatch(JSON.stringify(contract), /97124966|education_date_to|filter\/preview/)
})

test("programme predicates use Base education.program with OR semantics in the same education row", () => {
  const contract = client.coresignalDiscoveryEsDslPreviewContract({ graduationYear: "2011", programmes: ["PGP", "MBA", "PGDM", "ABM", "PGP-SM", "IPMX", "Fellow Programme in Management"] })
  const education = contract.body.query.bool.filter.find(item => item.nested?.path === "education").nested.query.bool.filter
  assert.deepEqual(education.slice(0, 2), [
    { term: { "education.institution_id": client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID } },
    { term: { "education.date_to_year": 2011 } },
  ])
  const programme = education[2].bool
  assert.equal(programme.minimum_should_match, 1)
  const serialized = JSON.stringify(programme.should)
  assert.match(serialized, /education\.program/)
  assert.match(serialized, /PGP/)
  assert.match(serialized, /Agribusiness Management/)
  assert.match(serialized, /Sustainable Management/)
  assert.match(serialized, /Master of Business Administration/)
  assert.match(serialized, /Post Graduate Diploma in Management/)
  assert.match(serialized, /Executive MBA/)
  assert.match(serialized, /Fellow Programme in Management/)
  assert.equal(client.coresignalDiscoveryEsDslPreviewContract({ programmes: [] }).body.query.bool.filter.length, 2)
})

test("programme categories remain precise and request validation bounds custom labels", () => {
  assert.deepEqual(qualification.DISCOVERY_PROGRAMME_OPTIONS.map(option => option.value), ["PGP", "MBA", "PGDM", "ABM", "PGP-SM", "IPMX"])
  assert.equal(qualification.discoveryQualification("MBA", "2011", ["PGP"]).programmeMatchesSelection, false)
  assert.equal(qualification.discoveryQualification("MBA", "2011", ["MBA"]).eligibleForAddition, true)
  assert.equal(qualification.discoveryQualification("PGDM", "2011", ["PGP"]).programmeMatchesSelection, false)
  assert.equal(qualification.discoveryQualification("PGP-SM", "2011", ["PGP-SM"]).programmeMatchesSelection, true)
  assert.equal(qualification.discoveryQualification("Executive MBA", "2011", ["IPMX"]).eligibleForAddition, false)
  assert.deepEqual(qualification.normalizeDiscoveryProgrammeSelections(["sm", "Executive MBA", "MBA", "mba"]), ["PGP-SM", "IPMX", "MBA"])
  assert.equal(qualification.validateDiscoveryProgrammeSelections(["Fellow Programme in Management"]).ok, true)
  assert.equal(qualification.validateDiscoveryProgrammeSelections(["bad\nlabel"]).ok, false)
})

test("company and selected seniority narrow the same current non-deleted experience row", () => {
  const contract = client.coresignalDiscoveryEsDslPreviewContract({ companyName: "Google", seniorities: ["VP+", "Director"] })
  const experience = contract.body.query.bool.filter.find(item => item.nested?.path === "experience").nested.query.bool.filter
  assert.deepEqual(experience.filter(item => item.term), [
    { term: { "experience.company_name.exact": "Google" } },
    { term: { "experience.is_current": 1 } },
    { term: { "experience.deleted": 0 } },
  ])
  const titles = JSON.stringify(experience.find(item => item.bool).bool.should)
  assert.match(titles, /experience\.title/)
  assert.match(titles, /vice president/)
  assert.match(titles, /director/)
  assert.doesNotMatch(titles, /account executive/i)
})

test("ES-DSL discovery composes programme-only, seniority-only, combined, all, and omitted filters", () => {
  const paths = contract => contract.body.query.bool.filter.filter(item => item.nested).map(item => item.nested.path)
  const programmeOnly = client.coresignalDiscoveryEsDslPreviewContract({ programmes: ["PGP"] })
  assert.deepEqual(paths(programmeOnly), ["education"])
  assert.match(JSON.stringify(programmeOnly.body), /education\.program/)

  const seniorityOnly = client.coresignalDiscoveryEsDslPreviewContract({ seniorities: ["Director", "VP"] })
  assert.deepEqual(paths(seniorityOnly), ["education", "experience"])
  assert.doesNotMatch(JSON.stringify(seniorityOnly.body), /education\.program/)

  const yearProgramme = client.coresignalDiscoveryEsDslPreviewContract({ graduationYear: 2011, programmes: ["ABM"] })
  assert.match(JSON.stringify(yearProgramme.body), /education\.date_to_year/)
  assert.match(JSON.stringify(yearProgramme.body), /education\.program/)

  const all = client.coresignalDiscoveryEsDslPreviewContract({ graduationYear: 2011, programmes: ["PGP", "ABM", "SM"], companyName: "Google", seniorities: ["VP+"] })
  assert.deepEqual(paths(all), ["education", "experience"])
  assert.match(JSON.stringify(all.body), /education\.date_to_year/)
  assert.match(JSON.stringify(all.body), /education\.program/)
  assert.match(JSON.stringify(all.body), /experience\.company_name\.exact/)
  assert.match(JSON.stringify(all.body), /experience\.title/)

  const omitted = client.coresignalDiscoveryEsDslPreviewContract({ programmes: [], seniorities: [] })
  assert.deepEqual(paths(omitted), ["education"])
  assert.doesNotMatch(JSON.stringify(omitted.body), /education\.program|experience\.title/)
})

test("Preview page contract is bounded and sends an explicit page only for continuation", async () => {
  process.env.CORESIGNAL_API_KEY = "test-key"
  const urls = []
  const fetcher = async url => {
    urls.push(String(url))
    return new Response("[]", { status: 200, headers: { "content-type": "application/json", "x-total-results": "40" } })
  }
  const first = await client.previewCoresignalEmployeesExactYear({ query: {} }, { operationContext: "first", page: 1, fetcher })
  const second = await client.previewCoresignalEmployeesExactYear({ query: {} }, { operationContext: "next", page: 2, fetcher })
  assert.equal(first.page, 1)
  assert.equal(second.page, 2)
  assert.equal(urls[0], `${client.CORESIGNAL_API_BASE}${client.CORESIGNAL_ES_DSL_PREVIEW_PATH}`)
  assert.equal(urls[1], `${client.CORESIGNAL_API_BASE}${client.CORESIGNAL_ES_DSL_PREVIEW_PATH}?page=2`)
  assert.throws(() => client.coresignalDiscoveryEsDslPreviewContract({ page: 51 }), /between 1 and 50/)
})

test("exact-year Preview transport makes one bounded apikey request with no Bearer auth", async () => {
  process.env.CORESIGNAL_API_KEY = "test-only-key-never-sent"
  const calls = []
  const body = client.coresignalExactYearEsDslPreviewContract({ graduationYear: 2011 }).body
  const result = await client.previewCoresignalEmployeesExactYear(body, {
    operationContext: "test exact year",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify([{ id: 1, full_name: "Candidate" }]), { status: 200, headers: { "x-total-results": "927", "x-credits-remaining": "4950" } })
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://api.coresignal.com/cdapi/v2/employee_base/search/es_dsl/preview")
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get("apikey"), process.env.CORESIGNAL_API_KEY)
  assert.equal(headers.has("authorization"), false)
  assert.deepEqual(JSON.parse(calls[0].init.body), body)
  assert.equal(result.totalResults, 927)
  assert.equal(result.providerCreditsRemaining, 4950)
  await assert.rejects(() => client.previewCoresignalEmployeesExactYear(body, {
    operationContext: "over limit",
    fetcher: async () => new Response(JSON.stringify(Array.from({ length: 21 }, (_, id) => ({ id }))), { status: 200 }),
  }), /over-limit response/)
})

test("exact-year Preview gate is fail-closed unless gate and account entitlement are both confirmed", () => {
  const base = { NODE_ENV: "production", CORESIGNAL_LIVE_ENABLED: "true", CORESIGNAL_SEARCH_ENABLED: "true", CORESIGNAL_ES_DSL_PREVIEW_ENABLED: "true" }
  assert.equal(runtime.coresignalExactYearPreviewEnabled({ ...base, CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "unknown" }), false)
  assert.equal(runtime.coresignalExactYearPreviewEnabled({ ...base, CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "not_entitled" }), false)
  assert.equal(runtime.coresignalExactYearPreviewEnabled({ ...base, CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "confirmed" }), true)
  assert.equal(runtime.coresignalExactYearPreviewEnabled({ ...base, CORESIGNAL_ES_DSL_PREVIEW_ENABLED: "false", CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "confirmed" }), false)
})

test("route and UI preserve Admin, explicit-confirmation, entitlement, and no-fallback boundaries", () => {
  assert.match(discoveryRoute, /context\.role !== "ADMIN"/)
  assert.match(discoveryRoute, /payload\.confirmed !== true/)
  assert.match(discoveryRoute, /coresignalExactYearPreviewEnabled/)
  assert.match(discoveryRoute, /exact_year_preview_entitlement_unconfirmed/)
  assert.match(discoveryRoute, /maximumCollects: exactYearPreview \? 0/)
  assert.match(discoveryRoute, /mapping\.state === "VERIFIED"/)
  assert.match(discoveryRoute, /companyName = filters\.company/)
  assert.match(discoveryRoute, /companyIdentityMode = "EXACT_NAME"/)
  assert.match(discoveryRoute, /mapping\.state === "CONFLICT"/)
  assert.match(page, /Same-row nested education/)
  assert.match(page, /exact company_name\.exact=/)
  assert.match(page, /Exact-name fallback does not establish a verified provider company ID/)
  assert.match(page, /1 Preview · 0 Collect/)
  assert.match(page, /Constrained Search Blocked/)
  assert.match(envExample, /CORESIGNAL_ES_DSL_PREVIEW_ENABLED=false/)
  assert.match(envExample, /CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT=unknown/)
  assert.doesNotMatch(envExample, /CORESIGNAL_API_KEY=\S+/)
  assert.match(viteConfig, /CORESIGNAL_ES_DSL_PREVIEW_ENABLED/)
  assert.match(viteConfig, /CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT/)
  assert.match(packageJson, /CORESIGNAL_ES_DSL_PREVIEW_ENABLED=false/)
})

test("manual continuation is sequential, confirmed, budgeted, deduplicated, and provenance-scoped", () => {
  assert.match(discoveryRoute, /payload\.action === "continue_search"/)
  assert.match(discoveryRoute, /Explicit confirmation is required for every Preview page request/)
  assert.match(discoveryRoute, /Number\(payload\.page\) !== nextPage/)
  assert.match(discoveryRoute, /remainingApplicationUnits\(\) < 1/)
  assert.match(discoveryRoute, /coresignalContinuationInFlight/)
  assert.match(discoveryRoute, /continuation_in_progress/)
  assert.match(discoveryRoute, /existingKeys\.has\(key\)/)
  assert.match(discoveryRoute, /operation: "ES-DSL Preview continuation"/)
  assert.match(discoveryRoute, /page=\$\{nextPage\}/)
  assert.match(discoveryRoute, /automaticPagination: false, automaticRetry: false/)
  assert.match(page, /Review Preview Page/)
  assert.match(page, /Confirm One Page Request/)
  assert.match(page, /20 search credits for this Preview page/)
})

test("the verified endpoint has a deliberate Admin-loopback launch path and sanitized evidence", () => {
  const scripts = JSON.parse(packageJson).scripts
  const launch = scripts["dev:local:coresignal-exact-year-live"]
  assert.match(launch, /NODE_ENV=development/)
  assert.match(launch, /LOCAL_DEV_AUTH_ROLE=ADMIN/)
  assert.match(launch, /LOCAL_CORESIGNAL_LIVE_DEMO_HOST=127\.0\.0\.1/)
  assert.match(launch, /CORESIGNAL_ES_DSL_PREVIEW_ENABLED=true/)
  assert.match(launch, /CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT=confirmed/)
  assert.match(launch, /CORESIGNAL_COLLECT_ENABLED=false/)
  assert.match(launch, /CORESIGNAL_LIVE_SEARCH_MAX_RESULTS=1/)
  assert.match(launch, /vite --host 127\.0\.0\.1/)
  assert.match(providerDocs, /Operational access is now verified for the configured local key/)
  assert.match(operationalEvidence, /HTTP status: `200`/)
  assert.match(operationalEvidence, /Preview records returned: `20`/)
  assert.match(operationalEvidence, /`x-total-results`: `927`/)
  assert.match(operationalEvidence, /`x-credits-remaining`: `4930`/)
  assert.doesNotMatch(operationalEvidence, /apikey|API key value|full_name|profile_url/)
})

test("one Preview page is fully qualified before requested result count and never fans out to Collect", async () => {
  process.env.NODE_ENV = "production"
  process.env.CORESIGNAL_API_KEY = "test-only-key-never-sent"
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  let calls = 0
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    id: 1000 + index,
    full_name: `Candidate ${index + 1}`,
    professional_network_url: `https://www.linkedin.com/in/exact-${index + 1}`,
    company_name: index === 14 || index === 4 || index === 9 ? "Google" : "Other Company",
    active_experience_company_name: index === 14 || index === 4 || index === 9 ? "Google" : undefined,
    active_experience_title: index === 14 ? "Vice President" : index === 4 ? "Director" : index === 9 ? "India Site Lead for Privacy, Safety and Security" : "Manager",
    location_full: "India",
  }))
  globalThis.fetch = async url => {
    calls += 1
    assert.match(String(url), /employee_base\/search\/es_dsl\/preview$/)
    return new Response(JSON.stringify(candidates), { status: 200, headers: { "x-total-results": "20" } })
  }
  const result = await adapter.coresignalProvider.searchCandidates(exactFilters(), [], 1, {
    maximumCollects: 0,
    exactYearPreview: { companyId: 12345, operationContext: "controlled test" },
  })
  assert.equal(calls, 1)
  assert.equal(result.execution.metrics.previewCountReturned, 20)
  assert.equal(result.execution.metrics.previewCountConsidered, 20)
  assert.equal(result.execution.metrics.collectExecuted, 0)
  assert.equal(result.profiles.length, 1)
  assert.equal(result.profiles[0].providerPersonId, "1014")
  assert.equal(result.execution.selectedCandidates[0].qualification.graduationYear.result, "EXACT_YEAR_QUERY_MATCH")
  assert.equal(result.execution.candidates[4].qualification.seniority.result, "MISMATCH")
  assert.equal(result.execution.candidates[9].qualification.seniority.result, "INSUFFICIENT_EVIDENCE")
  assert.equal(result.usage.applicationUnits, 1)
  assert.equal(result.usage.providerReportedUsage, null)
})

test("exact-name Google discovery evaluates all 20 and selects a later current VP provisionally", async () => {
  process.env.NODE_ENV = "production"
  process.env.CORESIGNAL_API_KEY = "test-only-key-never-sent"
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  const candidates = Array.from({ length: 20 }, (_, index) => ({
    id: 2000 + index,
    full_name: `Google Candidate ${index + 1}`,
    professional_network_url: `https://www.linkedin.com/in/google-${index + 1}`,
    company_name: index === 14 ? "Google" : "Other Company",
    active_experience_company_name: index === 14 ? "Google" : "Other Company",
    company_url: index === 14 ? "https://www.linkedin.com/company/google" : "https://www.linkedin.com/company/other-company",
    active_experience_title: index === 14 ? "Vice President" : "Director",
  }))
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls += 1
    const body = JSON.parse(init.body)
    assert.match(JSON.stringify(body), /experience\.company_name\.exact/)
    assert.doesNotMatch(JSON.stringify(body), /experience\.company_id|education_date_to/)
    return new Response(JSON.stringify(candidates), { status: 200, headers: { "x-total-results": "927" } })
  }
  const result = await adapter.coresignalProvider.searchCandidates(exactFilters(), [], 1, {
    maximumCollects: 0,
    exactYearPreview: { companyName: "Google", companyIdentityMode: "EXACT_NAME", operationContext: "controlled exact-name test" },
  })
  assert.equal(calls, 1)
  assert.equal(result.execution.metrics.previewCountReturned, 20)
  assert.equal(result.execution.metrics.previewCountConsidered, 20)
  assert.equal(result.execution.metrics.collectExecuted, 0)
  assert.equal(result.profiles.length, 1)
  assert.equal(result.profiles[0].providerPersonId, "2014")
  assert.equal(result.execution.selectedCandidates[0].qualification.company.result, "NAME_MATCH_IDENTITY_UNVERIFIED")
  assert.equal(result.execution.selectedCandidates[0].finalStatus, "QUALIFIED_FOR_REVIEW")
})

test("exact-name company qualification rejects conflicting identity and keeps missing URL unverified", () => {
  const constraint = { institutionId: 25919228, exactGraduationYear: 2011, providerCompanyId: null, exactCompanyName: "Google", companyIdentityMode: "EXACT_NAME", expectedCompanyUrl: "https://www.linkedin.com/company/google", semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW" }
  const profile = overrides => adapter.mapCoresignalPreview({ id: overrides.id, full_name: overrides.id, company_name: "Google", active_experience_company_name: "Google", active_experience_title: "Vice President", ...overrides }, 0)
  const missingUrl = execution.qualifyPreviewCandidate(profile({ id: "missing-url" }), exactFilters(), constraint)
  const canonicalUrl = execution.qualifyPreviewCandidate(profile({ id: "canonical-url", company_url: "https://www.linkedin.com/company/google" }), exactFilters(), constraint)
  const alphabet = execution.qualifyPreviewCandidate(profile({ id: "alphabet", company_url: "https://www.linkedin.com/company/alphabetgoogle" }), exactFilters(), constraint)
  assert.equal(missingUrl.company.result, "NAME_MATCH_IDENTITY_UNVERIFIED")
  assert.match(missingUrl.company.rationale, /human review/)
  assert.equal(canonicalUrl.company.result, "NAME_MATCH_IDENTITY_UNVERIFIED")
  assert.equal(alphabet.company.result, "MISMATCH")
  assert.match(alphabet.company.rationale, /conflicts with the verified expected company URL/)
})

test("Preview current-company normalization prefers active experience and records its provenance", () => {
  const mapped = adapter.mapCoresignalPreview({
    id: "active-priority",
    company_name: "Historical Summary Company",
    active_experience_company_name: "Google",
    company_url: "https://www.linkedin.com/company/historical-summary",
    active_experience_company_url: "https://www.linkedin.com/company/google",
    active_experience_title: "Vice President",
  }, 0)
  assert.equal(mapped.currentCompany, "Google")
  assert.equal(mapped.currentCompanyEvidenceSource, "ACTIVE_EXPERIENCE")
  assert.equal(mapped.currentCompanyUrl, "https://www.linkedin.com/company/google")
})

test("exact-name query keeps conflicting generic company summary pending but rejects active-experience contradiction", async () => {
  const constraint = { institutionId: 25919228, exactGraduationYear: 2011, providerCompanyId: null, exactCompanyName: "Google", companyIdentityMode: "EXACT_NAME", expectedCompanyUrl: null, semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW" }
  const matchingSummaryOnly = adapter.mapCoresignalPreview({ id: "matching-summary-only", company_name: "Google", active_experience_title: "Vice President" }, 0)
  const summaryOnly = adapter.mapCoresignalPreview({ id: "summary-only", company_name: "Summary Holdings", active_experience_title: "Vice President" }, 0)
  const activeMismatch = adapter.mapCoresignalPreview({ id: "active-mismatch", company_name: "Google", active_experience_company_name: "Confirmed Other Employer", active_experience_title: "Vice President" }, 0)
  const missingCompany = adapter.mapCoresignalPreview({ id: "missing-company", active_experience_title: "Vice President" }, 0)
  const matchingSummaryQualification = execution.qualifyPreviewCandidate(matchingSummaryOnly, exactFilters(), constraint)
  const summaryQualification = execution.qualifyPreviewCandidate(summaryOnly, exactFilters(), constraint)
  const activeQualification = execution.qualifyPreviewCandidate(activeMismatch, exactFilters(), constraint)
  const missingQualification = execution.qualifyPreviewCandidate(missingCompany, exactFilters(), constraint)
  assert.equal(matchingSummaryQualification.company.result, "INSUFFICIENT_EVIDENCE")
  assert.match(matchingSummaryQualification.company.rationale, /does not independently establish current employment/)
  assert.equal(summaryQualification.company.result, "INSUFFICIENT_EVIDENCE")
  assert.match(summaryQualification.company.evidence, /generic Preview company summary/)
  assert.equal(activeQualification.company.result, "MISMATCH")
  assert.match(activeQualification.company.evidence, /active_experience_company_name/)
  assert.equal(missingQualification.company.result, "INSUFFICIENT_EVIDENCE")
  assert.equal(missingQualification.company.evidence, "")
})

test("Search #10-shaped Preview retains one bounded pending candidate without Collect", async () => {
  const constraint = { institutionId: 25919228, exactGraduationYear: 2026, providerCompanyId: null, exactCompanyName: "McKinsey & Company", companyIdentityMode: "EXACT_NAME", expectedCompanyUrl: null, semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW" }
  const filters = exactFilters({ company: "McKinsey & Company", graduationYear: "2026", discoveryProgrammes: ["MBA", "PGP"], seniority: "All levels", seniorities: [] })
  const previewProfiles = Array.from({ length: 11 }, (_, index) => adapter.mapCoresignalPreview({
    id: `search-10-${index + 1}`,
    professional_network_url: `https://www.linkedin.com/in/search-10-${index + 1}`,
    company_name: "Conflicting Generic Summary",
    active_experience_title: "Role unavailable",
  }, index))
  let collectCalls = 0
  const result = await execution.executeSelectiveDiscovery({
    previewProfiles,
    filters,
    alumni: [],
    rejectedCandidates: [],
    capabilities: (await vite.ssrLoadModule("/lib/discovery-provider-capabilities.ts")).CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
    requestedCount: 1,
    maximumCollects: 0,
    searchConstraint: constraint,
    collect: async () => { collectCalls += 1; return null },
  })
  assert.equal(collectCalls, 0)
  assert.equal(result.metrics.previewCountReturned, 11)
  assert.equal(result.metrics.previewCountConsidered, 11)
  assert.equal(result.metrics.companyMismatches, 0)
  assert.equal(result.metrics.pendingVerification, 11)
  assert.equal(result.metrics.savedReviewCandidates, 1)
  assert.equal(result.selectedCandidates.length, 1)
  assert.equal(result.selectedCandidates[0].finalStatus, "IDENTITY_REVIEW_REQUIRED")
  assert.equal(result.selectedCandidates[0].qualification.programme.result, "SEARCH_CONSTRAINED_NOT_VERIFIED")
  assert.match(result.selectedCandidates[0].collectionRationale, /pending human review/)
  assert.match(discoveryRoute, /response\.profiles\.map/)
  assert.match(discoveryRoute, /db\.insert\(externalDiscoveryResults\)/)
  assert.match(discoveryRoute, /\[company-source=\$\{companySource\}\]/)
  assert.match(discoveryRoute, /currentCompanyEvidenceSource: storedCompanyEvidenceSource\(result\.reviewNote\)/)
})

test("official Preview fields normalize without fabricating education or freshness", () => {
  const mapped = adapter.mapCoresignalPreview({
    id: 99,
    full_name: "Official Shape",
    professional_network_url: "https://www.linkedin.com/in/official-shape",
    company_name: "Google",
    active_experience_title: "Senior Vice President",
    location_full: "Bengaluru, India",
  }, 0)
  assert.equal(mapped.role, "Senior Vice President")
  assert.equal(mapped.currentCompany, "Google")
  assert.equal(mapped.location, "Bengaluru, India")
  assert.equal(mapped.education, "Education not returned")
  assert.equal(mapped.graduationYear, 0)
  assert.equal(mapped.providerFreshnessAt, "")
})

test("current-title seniority is conservative for VP+, former titles do not override it", () => {
  const constraint = { institutionId: 25919228, exactGraduationYear: 2011, providerCompanyId: 12345, semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW" }
  const qualify = activeTitle => execution.qualifyPreviewCandidate(adapter.mapCoresignalPreview({
    id: activeTitle,
    full_name: activeTitle,
    professional_network_url: `https://www.linkedin.com/in/${activeTitle.toLowerCase().replaceAll(" ", "-")}`,
    company_name: "Google",
    active_experience_title: activeTitle,
    experience: [{ company_name: "Google", title: "Vice President", is_current: 0, deleted: 0 }],
  }, 0), exactFilters(), constraint)
  assert.equal(qualify("Vice President").seniority.result, "MATCH")
  assert.equal(qualify("Senior Vice President").seniority.result, "MATCH")
  assert.equal(qualify("Director").seniority.result, "MISMATCH")
  assert.equal(qualify("India Site Lead for Privacy, Safety and Security").seniority.result, "INSUFFICIENT_EVIDENCE")
  assert.equal(qualify("Director").graduationYear.result, "EXACT_YEAR_QUERY_MATCH")
})
