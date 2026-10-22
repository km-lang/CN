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
const qualification = await vite.ssrLoadModule("/lib/discovery-qualification.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const alumniEducation = await vite.ssrLoadModule("/lib/alumni-education.ts")
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
  const filters = { ...search.defaultDiscoveryFilters(), discoveryProgrammes: [], alumniStatus: "All graduation statuses" }
  const result = await adapter.coresignalProvider.searchCandidates(filters, [{ id: 15, name: "Sahil Bansal", batch: 2015, company: "Google", title: "Product Leader", function: "Product", seniority: "Director", location: "Bengaluru", linkedinUrl: "https://linkedin.com/in/sahilb" }], 3)
  assert.equal(result.profiles.length, 3)
  assert.equal(result.usage.applicationUnits, 0)
  assert.equal(result.execution.metrics.collectExecuted, 0)
  assert.equal(result.execution.metrics.collectSkippedKnown, 1)
  assert.equal(result.usage.providerReportedUsage, null)
  assert.equal(limits.validateDiscoveryCount(4, 3, 20).ok, false)
})

test("successful Search and Collect operations each cost one direct API operation credit", () => {
  assert.equal(adapter.successfulCoresignalOperationCredits(true, 0), 1)
  assert.equal(adapter.successfulCoresignalOperationCredits(true, 3), 4)
  assert.equal(adapter.successfulCoresignalOperationCredits(false, 0), 0)
  assert.equal(adapter.successfulCoresignalOperationCredits(false, 3), 3)
})

test("live discovery preflight reserves one Search unit plus one Collect unit per requested profile", () => {
  assert.equal(limits.discoveryApplicationUnits(5, 1), 6)
  assert.equal(limits.maximumDiscoveryCount(19, 20, 1), 18)
  assert.equal(limits.validateDiscoveryCount(18, 19, 20, 1).ok, true)
  assert.deepEqual(limits.validateDiscoveryCount(19, 19, 20, 1).reason, "remaining_allowance")
})

test("documented Base Employee fields retain profile URL and scalar IIML education evidence", () => {
  const mapped = adapter.mapCoresignalProfile(employee({
    professional_network_url: undefined,
    profile_url: "https://www.linkedin.com/in/teginder-kaleka",
    education: [{ institution: "Indian Institute of Management Lucknow", program: "PGDM", date_from: null, date_from_year: 2007, date_to: null, date_to_year: 2009, deleted: 0 }],
  }), 0)
  assert.equal(mapped.linkedinUrl, "https://www.linkedin.com/in/teginder-kaleka")
  assert.equal(mapped.educationProgramme, "PGDM")
  assert.equal(mapped.educationStartDate, "2007")
  assert.equal(mapped.educationEndDate, "2009")
  assert.equal(mapped.graduationYear, 2009)
  assert.equal(mapped.affiliationStatus, "Confirmed degree alumnus")
  assert.equal(mapped.normalizedProgramme, "PGDM")
  assert.equal(mapped.alumniStatus, "Past alumnus")
  assert.equal(mapped.eligibleForAddition, true)
})

test("multi-programme selection omits the unverified provider OR expression and keeps the past-alumni cutoff", () => {
  const filters = { ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP", "ABM"], alumniStatus: "Past alumni only" }
  const contract = client.coresignalSearchContract(filters, new Date("2026-09-27T12:00:00Z"))
  assert.equal("education_program_name" in contract.body, false)
  assert.equal(contract.body.education_date_to, "September 2026")
  assert.doesNotMatch(JSON.stringify(contract.body), /2026-01-01|hard-coded/i)
})

test("live provider query applies explicit role/function, company, and location without adding seniority", () => {
  const filters = { ...search.defaultDiscoveryFilters(), company: "Innovaccer", role: "Growth Strategy", function: "Marketing", seniority: "Manager", location: "Bengaluru" }
  const body = client.coresignalSearchContract(filters).body
  assert.equal(body.experience_company_name, "Innovaccer")
  assert.match(body.experience_title, /Growth Strategy/)
  assert.match(body.experience_title, /growth/)
  assert.doesNotMatch(body.experience_title, /manager/)
  assert.equal(body.location, "Bengaluru")
})

test("optional provider filters are emitted only when selected and combine without hidden constraints", () => {
  const base = {
    ...search.defaultDiscoveryFilters(),
    alumniStatus: "All graduation statuses",
    discoveryProgrammes: [],
    company: "",
    role: "",
    function: "All functions",
    seniorities: [],
    seniority: "All levels",
    location: "",
    graduationYear: "",
  }
  const institutionOnly = client.coresignalSearchContract(base).body
  for (const key of ["education_date_to", "education_program_name", "experience_company_name", "experience_title", "location"]) {
    assert.equal(key in institutionOnly, false, `${key} must be omitted when its UI dimension is omitted`)
  }

  const combinations = [
    [{ company: "Google" }, ["experience_company_name"]],
    [{ role: "Vice President" }, ["experience_title"]],
    [{ function: "Finance" }, ["experience_title"]],
    [{ location: "Mumbai" }, ["location"]],
    [{ graduationYear: "2011" }, ["education_date_to"]],
    [{ discoveryProgrammes: ["PGP"] }, ["education_program_name"]],
    [{ company: "Google", role: "Vice President", function: "Finance", location: "Mumbai", graduationYear: "2011", discoveryProgrammes: ["PGP"] }, ["experience_company_name", "experience_title", "location", "education_date_to", "education_program_name"]],
  ]
  for (const [overrides, expected] of combinations) {
    const body = client.coresignalSearchContract({ ...base, ...overrides }).body
    for (const key of expected) assert.equal(key in body, true, `${key} missing for ${JSON.stringify(overrides)}`)
  }
})

test("multi-selected programmes retain OR semantics through local qualification instead of an invented provider predicate", () => {
  const body = client.coresignalSearchContract({ ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP", "ABM"] }).body
  assert.equal("education_program_name" in body, false)
})

test("seniority alone never becomes a provider experience-title query", () => {
  for (const seniority of ["VP", "Director+"]) {
    const body = client.coresignalSearchContract({ ...search.defaultDiscoveryFilters(), seniority }).body
    assert.equal("experience_title" in body, false)
  }
})

test("an explicit Role remains eligible for the existing provider title query", () => {
  const body = client.coresignalSearchContract({ ...search.defaultDiscoveryFilters(), role: "Vice President", seniority: "VP" }).body
  assert.equal(body.experience_title, "(Vice President)")
})

test("all active programmes omit provider programme restriction", () => {
  const body = client.coresignalSearchContract({ ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP", "ABM", "SM"] }).body
  assert.equal("education_program_name" in body, false)
})

test("Lincoln International 2013 VP validation contract keeps company and year only", () => {
  const body = client.coresignalSearchContract({
    ...search.defaultDiscoveryFilters(),
    company: "Lincoln International",
    graduationYear: "2013",
    seniority: "VP",
    discoveryProgrammes: ["PGP", "ABM", "SM"],
  }).body
  assert.deepEqual(body, {
    education_institution_professional_network_url: client.CORESIGNAL_IIML_INSTITUTION_URL,
    active_experience: true,
    education_date_to: "2013",
    experience_company_name: "Lincoln International",
  })
})

test("education_date_to is explicitly an upper-bound provider narrowing, never exact-year proof", () => {
  const explicitYear = { ...search.defaultDiscoveryFilters(), graduationYear: "2013" }
  assert.deepEqual(client.coresignalEducationEndNarrowing(explicitYear), {
    semantics: "PROVIDER_UPPER_BOUND",
    value: "2013",
    exactGraduationYearRequested: "2013",
  })
  assert.equal(client.coresignalSearchContract(explicitYear).body.education_date_to, "2013")

  const pastAlumni = { ...search.defaultDiscoveryFilters(), graduationYear: "", alumniStatus: "Past alumni only" }
  assert.deepEqual(client.coresignalEducationEndNarrowing(pastAlumni, new Date("2026-10-13T12:00:00Z")), {
    semantics: "PROVIDER_UPPER_BOUND",
    value: "October 2026",
    exactGraduationYearRequested: null,
  })
})

test("local seniority qualification remains authoritative and guards reporting relationships", () => {
  assert.equal(search.normalizeSeniority("", "Vice President"), "VP")
  assert.equal(search.normalizeSeniority("", "Assistant to the Vice President"), "Analyst/Junior")
})

test("single-programme selection reaches the provider query and is re-enforced after Collect", async () => {
  const previousFetch = globalThis.fetch
  const previousLive = process.env.CORESIGNAL_LIVE_ENABLED
  const bodies = []
  const collected = {
    pgp: employee({ id: "pgp", education: [iiml({ degree_name: "PGP", date_to: "2020" })] }),
    abm: employee({ id: "abm", education: [iiml({ degree_name: "PGP-ABM", date_to: "2020" })] }),
    executive: employee({ id: "executive", education: [iiml({ degree_name: "Executive MBA", date_to: "2020" })] }),
  }
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/search/")) {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify(["pgp", "abm", "executive"].map(id => ({ id, full_name: id, profile_url: `https://linkedin.com/in/${id}`, company_name: "Example", title: "Director" }))), { status: 200 })
    }
    const id = String(url).split("/").at(-1)
    return new Response(JSON.stringify(collected[id]), { status: 200 })
  }
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  try {
    const filters = { ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["ABM"], alumniStatus: "Past alumni only" }
    const result = await adapter.coresignalProvider.searchCandidates(filters, [], 3)
    assert.match(bodies[0].education_program_name, /ABM/)
    assert.equal(result.profiles.length, 1)
    const abm = result.profiles.find(profile => profile.providerPersonId === "abm")
    assert.equal(abm.normalizedProgramme, "ABM")
    assert.equal(abm.eligibleForAddition, true)
    assert.equal(result.execution.candidates.find(item => item.profile.providerPersonId === "executive").finalStatus, "FILTER_MISMATCH")
    assert.equal(result.usage.applicationUnits, 4)
  } finally {
    globalThis.fetch = previousFetch
    if (previousLive === undefined) delete process.env.CORESIGNAL_LIVE_ENABLED
    else process.env.CORESIGNAL_LIVE_ENABLED = previousLive
  }
})

test("programme normalization is explicit and keeps executive or unknown study review-only", () => {
  for (const value of ["PGP", "Post Graduate Programme", "Post Graduate Programme in Management"]) assert.equal(qualification.normalizeCoresignalProgramme(value).code, "PGP")
  for (const value of ["MBA", "Master of Business Administration"]) assert.deepEqual(qualification.normalizeCoresignalProgramme(value), { code: "MBA", status: "Programme matched" })
  assert.deepEqual(qualification.normalizeCoresignalProgramme("PGDM"), { code: "PGDM", status: "Programme matched" })
  for (const value of ["ABM", "PGP-ABM", "Post Graduate Programme in Agribusiness Management", "MBA in Agribusiness Management"]) assert.equal(qualification.normalizeCoresignalProgramme(value).code, "ABM")
  for (const value of ["SM", "PGP-SM", "Post Graduate Programme in Sustainable Management", "MBA in Sustainable Management"]) assert.equal(qualification.normalizeCoresignalProgramme(value).code, "SM")
  assert.deepEqual(qualification.normalizeCoresignalProgramme("Executive MBA"), { code: "IPMX", status: "Executive/non-regular programme" })
  for (const value of ["General Management Programme for Executives", "MBA for Working Managers"]) {
    const mapped = qualification.normalizeCoresignalProgramme(value)
    assert.equal(mapped.code, null)
    assert.equal(mapped.status, "Executive/non-regular programme")
  }
  assert.deepEqual(qualification.normalizeCoresignalProgramme("Advanced leadership programme"), { code: null, status: "Programme requires review" })
})

test("graduation status uses only the matched IIML record and a testable current date", () => {
  const now = new Date("2026-09-27T12:00:00Z")
  assert.equal(qualification.alumniStatusFromEducationEnd("2009", now), "Past alumnus")
  assert.equal(qualification.alumniStatusFromEducationEnd("2028", now), "Current student")
  assert.equal(qualification.alumniStatusFromEducationEnd("", now), "Graduation status unknown — review required")
  assert.equal(qualification.alumniStatusFromEducationEnd("2026", now), "Graduation status unknown — review required")
  assert.equal(qualification.alumniStatusFromEducationEnd("2026-09-27", now), "Past alumnus")
  assert.equal(qualification.alumniStatusFromEducationEnd("2026-09-28", now), "Current student")
})

test("Yash-type future IIML education is a current student and cannot be added", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "MBA", date_to: "2028" })] }), 0, { now: new Date("2026-09-27T12:00:00Z"), selectedProgrammes: ["PGP"] })
  assert.equal(mapped.alumniStatus, "Current student")
  assert.equal(mapped.eligibleForAddition, false)
})

test("Kushal-type executive study never normalizes to regular PGP", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "Executive MBA", date_to: "2024" })] }), 0, { now: new Date("2026-09-27T12:00:00Z"), selectedProgrammes: ["PGP"] })
  assert.equal(mapped.normalizedProgramme, "IPMX")
  assert.equal(mapped.programmeStatus, "Executive/non-regular programme")
  assert.equal(mapped.eligibleForAddition, false)
})

test("generic PGDM remains programme-ambiguous and is not automatically addable as PGP", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "PGDM", date_from: "2007", date_to: "2009" })] }), 0, { now: new Date("2026-09-27T12:00:00Z"), selectedProgrammes: ["PGP"] })
  assert.equal(mapped.normalizedProgramme, "PGDM")
  assert.equal(mapped.alumniStatus, "Past alumnus")
  assert.equal(mapped.eligibleForAddition, false)
})

test("externally discovered graduation evidence persists and renders consistently", () => {
  assert.deepEqual(alumniEducation.discoveredAlumniYearValues(2003), { batch: 2003, graduationYear: 2003 })
  assert.equal(alumniEducation.alumniEducationLabel({ programme: "PGP", batch: 2003, graduationYear: 2003 }), "PGP · 2003")
  assert.equal(alumniEducation.alumniEducationLabel({ programme: "PGP", batch: 0, graduationYear: 2003 }), "PGP · 2003")
  assert.match(discoveryRoute, /discoveredAlumniYearValues\(result\.graduationYear\)/)
  assert.match(page, /alumniEducationLabel\(person\)/)
})

test("manual and imported alumni retain their existing batch fallback", () => {
  assert.equal(alumniEducation.alumniEducationLabel({ programme: "PGP", batch: 2012, graduationYear: 2012 }), "PGP · 2012")
  assert.equal(alumniEducation.alumniEducationLabel({ programme: "ABM", batch: 2015 }), "ABM · 2015")
})

test("another university's completion cannot hide an ongoing IIML programme", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ education: [
    { institution: "Another University", program: "MBA", date_to: "2020", deleted: 0 },
    { institution: "Indian Institute of Management Lucknow", program: "PGP", date_to: "2028", deleted: 0 },
  ] }), 0, { now: new Date("2026-09-27T12:00:00Z"), selectedProgrammes: ["PGP"] })
  assert.equal(mapped.graduationYear, 2028)
  assert.equal(mapped.alumniStatus, "Current student")
  assert.equal(mapped.eligibleForAddition, false)
})

test("missing or deleted IIML graduation evidence never becomes automatically addable", () => {
  const now = new Date("2026-09-27T12:00:00Z")
  const missingEnd = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "PGP", date_to: null })] }), 0, { now, selectedProgrammes: ["PGP"] })
  assert.equal(missingEnd.alumniStatus, "Graduation status unknown — review required")
  assert.equal(missingEnd.eligibleForAddition, false)
  const deletedIiml = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "PGP", date_to: "2020", deleted: 1 })] }), 0, { now, selectedProgrammes: ["PGP"] })
  assert.equal(deletedIiml.affiliationStatus, "Potential alumnus — review required")
  assert.equal(deletedIiml.eligibleForAddition, false)
})

test("seniority normalization prefers strong designation evidence over a bad provider fallback", () => {
  const cases = new Map([
    ["Head of Product", "Director"], ["Senior Data Scientist", "Senior Manager"], ["Assistant Vice President", "VP"],
    ["Vice President", "VP"], ["Director", "Director"], ["Senior Manager", "Senior Manager"],
    ["Manager", "Manager"], ["Analyst", "Analyst/Junior"], ["Associate", "Associate/Consultant"],
  ])
  for (const [title, expected] of cases) assert.equal(search.normalizeSeniority("Analyst", title), expected, title)
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
  const mapped = adapter.mapCoresignalProfile(employee({ education: [iiml({ degree_name: "Deleted MBA", deleted: 1 }), iiml({ degree_name: "PGDM" })] }), 0)
  assert.equal(mapped.educationProgramme, "PGDM")
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

test("Shruti evidence excludes deleted and historical rows without inventing current VP evidence", () => {
  const mapped = adapter.mapCoresignalProfile(employee({
    id: "289351894",
    full_name: "Shruti Chaturvedi",
    education: [
      iiml({ degree_name: "PGDM, Finance & Marketing", date_from: "2009", date_from_year: 2009, date_to: "2011", date_to_year: 2011, deleted: 0 }),
      iiml({ degree_name: "PGP", date_from: "2011", date_to: "2013", deleted: 1 }),
      iiml({ degree_name: "PGP", date_from: "2011", date_to: "2013", deleted: 1 }),
    ],
    experience: [
      { company_name: "Lincoln International", title: "Director", date_from: "April 2022", date_to: null, is_current: 1, deleted: 0 },
      { company_name: "Lincoln International", title: "Vice President", date_from: "February 2016", date_to: "May 2022", is_current: 0, deleted: 0 },
      { company_name: "Lincoln International", title: "Vice President", date_from: "May 2022", date_to: null, is_current: 0, deleted: 0 },
      { company_name: "Lincoln International", title: "Vice President", date_to: null, is_current: 1, deleted: 1 },
    ],
  }), 0, { selectedProgrammes: ["PGP", "ABM", "SM"] })

  assert.equal(mapped.graduationYear, 2011)
  assert.equal(mapped.educationStartDate, "2009")
  assert.equal(mapped.educationEndDate, "2011")
  assert.equal(mapped.educationProgramme, "PGDM, Finance & Marketing")
  assert.equal(mapped.normalizedProgramme, "")
  assert.equal(mapped.programmeStatus, "Programme requires review")
  assert.deepEqual(mapped.currentRoles.map(role => [role.company, role.title, role.seniority]), [["Lincoln International", "Director", "Director"]])
  assert.equal(mapped.currentCompany, "Lincoln International")
  assert.equal(mapped.role, "Director")
  assert.equal(mapped.seniority, "Director")
})

test("deleted IIML evidence cannot establish year, programme, or affiliation", () => {
  const mapped = adapter.mapCoresignalProfile(employee({ education: [
    iiml({ degree_name: "PGP", date_from: "2011", date_to: "2013", deleted: 1 }),
  ] }), 0, { selectedProgrammes: ["PGP"] })
  assert.equal(mapped.graduationYear, 0)
  assert.equal(mapped.educationProgramme, "")
  assert.equal(mapped.normalizedProgramme, "")
  assert.equal(mapped.affiliationStatus, "Potential alumnus — review required")
  assert.equal(mapped.eligibleForAddition, false)
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
  const filters = { ...search.defaultDiscoveryFilters(), location: "No such location" }
  const result = await adapter.coresignalProvider.searchCandidates(filters, [], 5)
  assert.equal(result.profiles.length, 0)
  assert.equal(result.usage.applicationUnits, 0)
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  await assert.rejects(() => client.searchCoresignalIiml({ fetcher: async () => new Response("rate limited", { status: 429 }) }), error => error.kind === "rate_limit" && error.status === 429)
  process.env.CORESIGNAL_LIVE_ENABLED = "false"
})

test("review-before-add, Keep Existing, and selected-field apply remain enforced", () => {
  assert.match(discoveryRoute, /affiliationStatus !== "Confirmed degree alumnus"/)
  assert.match(discoveryRoute, /qualificationForResult[\s\S]*eligibleForAddition/)
  assert.match(discoveryRoute, /Approval requires a pending result, independently supported search criteria, a verified LinkedIn profile, and a new stable identity/)
  assert.doesNotMatch(discoveryRoute, /action === "qualify"/)
  assert.match(enrichmentRoute, /status: applied\.length \? "Applied" : "Reviewed — kept existing"/)
  assert.match(page, /Apply Selected Updates/)
  assert.match(page, /Keep existing/)
})

test("PDL is historical-only while active discovery and intake use Coresignal", () => {
  assert.match(discoveryRoute, /provider: PROFESSIONAL_DATA_PROVIDER/)
  assert.match(enrichmentRoute, /coresignal_profile_refresh/)
  assert.match(schema, /pdlPersonId: text\("pdl_person_id"\)/)
  assert.match(page, /Historical PDL/)
  assert.match(page, /const canAdd = [^\n]*result\.provider === "coresignal"/)
  assert.doesNotMatch(page, /qualifyDiscoveryResult\(result,/)
  assert.match(page, /result\.provider === "pdl" \? "View historical evidence"/)
  assert.match(discoveryRoute, /actionableReview: isActionableDiscoveryReview\(result\)/)
  assert.match(discoveryRoute, /Historical provider results are read-only\./)
  assert.match(discoveryRoute, /Historical provider results cannot be added to the active alumni workflow\./)
  assert.doesNotMatch(enrichmentRoute, /pdl|PDL/i)
  assert.match(admin, /Historical PDL evidence remains readable/)
})

test("Coresignal never owns email or phone and Lusha contact/signals remain separate", () => {
  const adapterSource = adapter.coresignalProvider.refreshProfile.toString()
  assert.doesNotMatch(adapterSource, /email|phone/i)
  assert.doesNotMatch(discoveryRoute, /emailSource:\s*PROFESSIONAL_DATA_PROVIDER_LABEL|phoneSource:\s*PROFESSIONAL_DATA_PROVIDER_LABEL/)
  assert.match(enrichmentRoute, /safeChanges\.emailSource = "Lusha"/)
  assert.match(enrichmentRoute, /lushaContactApprovalSql\(evidence\.channel, history\.mode === "mock" \? "mock" : "live"\)/)
  assert.match(page, /Lusha Professional Signals/)
})

test("mock/disabled readiness and unknown provider usage are represented safely", () => {
  assert.equal(runtime.providerMode("coresignal"), "mock")
  assert.equal(runtime.providerConfigured("coresignal"), true)
  assert.equal(usage.providerUsageLabel({ provider: "coresignal", mode: "live", usageState: "reconciliation_required", providerReportedCredits: null, creditsUsed: 0 }).label, "Reconciliation required")
  assert.match(admin, /Coresignal/)
  assert.doesNotMatch(page, /Validate PDL connection/)
})
