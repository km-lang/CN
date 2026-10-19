import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const alumniCombobox = await vite.ssrLoadModule("/components/alumnus-combobox.tsx")
const companyCombobox = await vite.ssrLoadModule("/components/company-combobox.tsx")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const engagement = await vite.ssrLoadModule("/lib/engagement-presentation.ts")
const manual = await vite.ssrLoadModule("/lib/manual-alumnus.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const workspaceApi = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const engagementApi = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")

const alumni = [
  { id: 24, name: "Rama Krishna Dokina", title: "Finance Intern", company: "Larsen & Toubro" },
  { id: 25, name: "Another Person", title: "Director", company: "Example Company" },
]

test("Overview alumnus search is exact, partial, tokenized, case-insensitive, and has a no-match state", () => {
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "Rama Krishna").map(person => person.id), [24])
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "krishna dok").map(person => person.id), [24])
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "RAMA").map(person => person.id), [24])
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "missing alumnus"), [])
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "", "Example Company").map(person => person.id), [25])
  assert.deepEqual(alumniCombobox.filterAlumnusOptions(alumni, "Rama", "Example Company").map(person => person.id), [24])
  assert.match(page, /routeEligibleAlumni = useMemo\(\(\) => selectorPool\.filter\(person => \(person\.lifecycle \?\? "Active"\) === "Active"\)/)
})

test("Overview company choices normalize current values and support search plus All companies", () => {
  assert.deepEqual(companyCombobox.normalizeCompanyOptions([" Innovaccer ", "innovaccer", "Larsen  &  Toubro", ""]), ["Innovaccer", "Larsen & Toubro"])
  assert.deepEqual(companyCombobox.filterCompanyOptions(["Innovaccer", "Larsen & Toubro"], "nova"), ["Innovaccer"])
  assert.deepEqual(companyCombobox.filterCompanyOptions(["Innovaccer"], "missing"), [])
  assert.match(page, /<CompanyCombobox options=\{companies\}/)
  assert.match(page, /preferredCompany=\{overviewCompany\}/)
})

const person = overrides => ({ name: "Example", company: "Innovaccer", title: "Director", function: "Strategy", seniority: "Director", location: "India", linkedinUrl: "https://www.linkedin.com/in/person-a/", programme: "PGP", batch: 2020, previous: "", confidence: 80, status: "Not contacted", assessment: { iimlRelationship: "Strong" }, ...overrides })

test("Directory LinkedIn filtering handles exact variants, partial identifiers, composition, and Clear", () => {
  const base = search.defaultDirectoryFilters()
  assert.equal(search.matchesInternalFilters(person(), { ...base, linkedinUrl: "https://linkedin.com/in/person-a" }, 80, "Contact-ready"), true)
  assert.equal(search.matchesInternalFilters(person(), { ...base, linkedinUrl: "/in/person-a/" }, 80, "Contact-ready"), true)
  assert.equal(search.matchesInternalFilters(person(), { ...base, linkedinUrl: "person-a" }, 80, "Contact-ready"), true)
  assert.equal(search.matchesInternalFilters(person(), { ...base, linkedinUrl: "https://www.linkedin.com/in/person-b" }, 80, "Contact-ready"), false)
  assert.equal(search.matchesInternalFilters(person(), { ...base, linkedinUrl: "person-a", company: "Other" }, 80, "Contact-ready"), false)
  assert.equal(search.defaultDirectoryFilters().linkedinUrl, "")
  assert.match(page, /value=\{filters\.linkedinUrl\}/)
})

test("External Discovery makes result exposure visible without coupling render or changes to a provider call", () => {
  assert.match(page, /target for confirmed filter matches, not a promise of availability/)
  assert.match(page, /className="discovery-count-field"/)
  assert.match(styles, /\.discovery-count-field \[role="combobox"\]/)
  const block = page.match(/function discoveryCountControl[\s\S]*?\n  }/)?.[0] ?? ""
  assert.doesNotMatch(block, /fetch\(|runDiscovery\(/)
  assert.match(block, /value=\{discoveryCountPreset\}/)
  assert.match(block, /validateDiscoveryCount|discoveryCountValidation/)
})

test("distinct engagements group by alumnus without losing action identities", () => {
  const events = [{ id: 1, alumnusId: 24 }, { id: 2, alumnusId: 24 }, { id: 3, alumnusId: 25 }]
  const groups = engagement.groupEngagementsByAlumnus(events)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].events.map(event => event.id), [1, 2])
  assert.deepEqual(groups.flatMap(group => group.events).map(event => event.id), [1, 2, 3])
  assert.match(page, /distinct engagement/)
  assert.match(page, /group\.events\.map\(event =>/)
})

test("engagement ownership resolves names in memory and retains stable audit identity", () => {
  const users = [{ id: 7, displayName: "PCOM Member", email: "member@example.test", enabled: true, role: "PCOM" }]
  assert.deepEqual(engagement.resolveEngagementOwner("7", users), { userId: 7, displayName: "PCOM Member", storedIdentity: "7", available: true })
  assert.equal(engagement.resolveEngagementOwner("999", users).displayName, "Unknown user (ID 999)")
  assert.equal(engagement.resolveEngagementOwner("Former PCOM", users).displayName, "Former PCOM")
  assert.match(engagementApi, /db\.select\(\{ id: applicationUsers\.id, displayName: applicationUsers\.displayName/)
  assert.match(engagementApi, /owner: resolveEngagementOwner\(event\.assignedTo, assignees\)/)
})

test("manual-entry UI and server share the actual required-field contract", () => {
  assert.equal(manual.validateManualAlumnusInput({ name: "" }).valid, false)
  assert.equal(manual.validateManualAlumnusInput({ name: "Example", email: "person@example.test" }).valid, true)
  assert.equal(manual.validateManualAlumnusInput({ name: "Example", linkedinUrl: "https://www.linkedin.com/in/example/" }).valid, true)
  assert.equal(manual.validateManualAlumnusInput({ name: "Example", company: "Example Co", batch: "2020" }).valid, true)
  assert.equal(manual.validateManualAlumnusInput({ name: "Example", phone: "+91000", title: "Director" }).valid, false)
  assert.equal(manual.validateManualAlumnusInput({ name: "Example", email: "bad" }).valid, false)
  assert.match(workspaceApi, /validateManualAlumnusInput\(record\)/)
  assert.match(page, /validateManualAlumnusInput\(manualForm\)/)
  assert.match(page, /aria-required="true"/)
  assert.match(page, /disabled=\{manualLoading \|\| !manualValidation\.valid\}/)
})

test("discovery comparison renders every identity field that can be preselected", () => {
  assert.match(page, /field: "linkedinUrl", label: "Professional profile URL"/)
  assert.match(page, /field: "pdlPersonId", label: "PDL person ID"/)
  assert.match(page, /field: "coresignalEmployeeId", label: "Coresignal employee ID"/)
  assert.match(page, /selectedComparisonFields\.includes\(row\.field\)/)
})

test("Phase 1 interactions remain provider-free until existing explicit confirmations", () => {
  for (const block of [
    page.match(/const filtered = useMemo[\s\S]*?\[alumni, companyPriorities, engagements, filters\]\)/)?.[0] ?? "",
    page.match(/const routeEligibleAlumni = useMemo[\s\S]*?\[alumni\]\)/)?.[0] ?? "",
  ]) assert.doesNotMatch(block, /fetch\(|coresignal|lusha|signals|gmail/i)
})
