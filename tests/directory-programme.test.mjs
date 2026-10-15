import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const programmes = await vite.ssrLoadModule("/lib/programme-options.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const coresignal = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const limits = await vite.ssrLoadModule("/lib/discovery-limit.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const adminApi = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const workspaceApi = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const migration = await readFile(new URL("../drizzle/0010_clean_revanche.sql", import.meta.url), "utf8")

test("programme configuration includes active options and keeps historical values readable", () => {
  const result = programmes.programmeFilterOptions([
    { id: 1, code: "PGP", name: "Post Graduate Programme", active: true, sortOrder: 10 },
    { id: 2, code: "ABM", name: "ABM", active: false, sortOrder: 20 },
  ], ["PGP", "ABM", "Legacy Diploma"])
  assert.deepEqual(result, [
    { value: "PGP", label: "Post Graduate Programme", active: true, historical: false },
    { value: "ABM", label: "ABM (inactive)", active: false, historical: false },
    { value: "Legacy Diploma", label: "Legacy Diploma (historical)", active: false, historical: true },
  ])
})

test("programme is an internal filter and never invokes discovery", () => {
  const filters = search.defaultDirectoryFilters()
  filters.programme = "PGP"
  const person = { name: "Sahil Bansal", company: "Example", title: "Director", function: "Strategy", seniority: "Director", location: "India", previous: "", programme: "PGP", batch: 2012, confidence: 80, status: "Not contacted", assessment: { iimlRelationship: "Strong" } }
  assert.equal(search.matchesInternalFilters(person, filters, 70, "Contact-ready"), true)
  assert.equal(search.matchesInternalFilters({ ...person, programme: "ABM" }, filters, 70, "Contact-ready"), false)
  assert.match(page, /const filtered = useMemo\(\(\) => alumni\.filter/)
  assert.doesNotMatch(workspaceApi, /People Data Labs|pdl-discovery/)
})

test("directory presents one preset/custom count control with actual validation", () => {
  assert.match(page, /\["1", "5", "10", "20"\]\.includes\(discoveryLimit\)/)
  assert.match(page, /<SelectItem value="custom">Custom<\/SelectItem>/)
  assert.match(page, /discoveryCountPreset === "custom"/)
  assert.doesNotMatch(page, /className="result-presets"/)
  assert.equal(limits.validateDiscoveryCount(0, 100, 100).ok, false)
  assert.equal(limits.validateDiscoveryCount(-1, 100, 100).ok, false)
  assert.equal(limits.validateDiscoveryCount(Number.NaN, 100, 100).ok, false)
  assert.equal(limits.validateDiscoveryCount(101, 100, 100).ok, false)
  assert.equal(limits.validateDiscoveryCount(20, 100, 100).ok, true)
})

test("Clear resets only directory state without mutating discovery or making a provider request", () => {
  const match = page.match(/function clearDirectoryFilters\(\) \{([\s\S]*?)\n  \}/)
  assert.ok(match)
  assert.match(match[1], /setFilters\(defaultDirectoryFilters\(\)\)/)
  assert.doesNotMatch(match[1], /setDiscoveryFilters|setDiscoveryResults|setPendingDiscoveryFilters/)
  assert.doesNotMatch(match[1], /fetch\(|runDiscovery|discoverMoreAlumni/)
})

test("Directory copy separates internal filtering from explicit external discovery", () => {
  assert.match(page, /Internal alumni directory/i)
  assert.match(page, /Need more alumni\?/)
  assert.match(page, /Internal directory filters never call or constrain a provider/)
  assert.match(page, /Any Data Confidence/)
  assert.match(page, /Any Placement Relevance/)
  assert.match(page, /Hide advanced filters/)
})

test("external discovery has independent multi-programme and past-alumni controls", () => {
  const defaults = search.defaultDiscoveryFilters()
  assert.deepEqual(defaults.discoveryProgrammes, ["PGP", "ABM", "SM"])
  assert.equal(defaults.alumniStatus, "Past alumni only")
  assert.match(page, /External discovery alumni status/)
  assert.match(page, /programme-multiselect-trigger/)
  assert.match(page, /PopoverContent className="programme-multiselect-content"/)
  assert.match(page, /activeProgrammeChoices\.map/)
  assert.match(page, /All graduation statuses \(review only\)/)
  assert.match(page, /Select at least one programme for external discovery/)
})

test("directory and external programme controls are labelled as independent scopes", () => {
  assert.match(page, />Directory programme</)
  assert.match(page, /Applies only to existing Corporate Network records\. It does not affect external provider discovery\./)
  assert.match(page, />IIML programmes to discover</)
  assert.match(page, /Used only for external Coresignal discovery\. Directory filters above do not affect provider searches\./)
  assert.match(page, /value=\{filters\.programme\} onValueChange=\{value => updateDirectoryFilter\("programme", value\)\}/)
  assert.match(page, /checked=\{discoveryFilters\.discoveryProgrammes\.includes\(option\.value\)\}/)
  assert.match(page, /pendingDiscoveryFilters\?\.discoveryProgrammes\.join\(", "\)/)
  assert.doesNotMatch(page, /discoveryProgrammes:\s*\[?filters\.programme/)
})

test("directory and discovery filter state are structurally independent", () => {
  assert.match(page, /useState<DirectoryFilters>\(defaultDirectoryFilters\)/)
  assert.match(page, /useState<DiscoveryFilters>\(defaultDiscoveryFilters\)/)
  const directoryUpdate = page.match(/function updateDirectoryFilter[\s\S]*?\n  \}/)?.[0] ?? ""
  const discoveryUpdate = page.match(/function updateDiscoveryFilter[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.match(directoryUpdate, /setFilters/)
  assert.doesNotMatch(directoryUpdate, /setDiscoveryFilters|runDiscovery|fetch\(/)
  assert.match(discoveryUpdate, /setDiscoveryFilters/)
  assert.doesNotMatch(discoveryUpdate, /setFilters\(/)
  for (const field of ["company", "role", "graduationYear", "discoveryProgrammes"]) assert.ok(field in search.defaultDiscoveryFilters())
  for (const field of ["company", "role", "batch", "programme"]) assert.ok(field in search.defaultDirectoryFilters())
  assert.equal("discoveryProgrammes" in search.defaultDirectoryFilters(), false)
  assert.equal("programme" in search.defaultDiscoveryFilters(), false)
})

test("internal company, role, graduation year and programme changes cannot alter the provider query", () => {
  const discovery = { ...search.defaultDiscoveryFilters(), company: "Innovaccer", role: "Manager", graduationYear: "2024", discoveryProgrammes: ["PGP"] }
  const before = coresignal.coresignalSearchContract(discovery).body
  const directory = { ...search.defaultDirectoryFilters(), company: "Google", role: "Director", batch: "2003", programme: "ABM" }
  assert.deepEqual(coresignal.coresignalSearchContract(discovery).body, before)
  assert.equal(directory.company, "Google")
  assert.equal(directory.role, "Director")
  assert.equal(directory.batch, "2003")
  assert.equal(directory.programme, "ABM")
  assert.match(page, /function discoverMoreAlumni\(searchFilters: DiscoveryFilters = discoveryFilters\)/)
  assert.doesNotMatch(page, /discoverMoreAlumni\(searchFilters: DiscoveryFilters = filters\)/)
})

test("External Discovery owns every provider-search control", () => {
  for (const label of ["Alumni status", "IIML programmes to discover", "Company", "Role / designation", "Function", "Seniority", "Location", "Graduation year", "Results to retrieve"]) assert.match(page, new RegExp(`>${label}<`))
  assert.match(page, /value=\{discoveryFilters\.company\}/)
  assert.match(page, /value=\{discoveryFilters\.role\}/)
  assert.match(page, /value=\{discoveryFilters\.graduationYear\}/)
})

test("ID-only Search preparation clearly confirms institution, year, and verified-company constraints", () => {
  assert.match(page, /Graduation year is optional/)
  assert.match(page, /selected company is sent only after the server resolves an Admin-verified provider-company mapping/)
  assert.match(page, /missing, unverified, conflicting, or invalid mappings block before any provider request/)
  assert.match(page, />Search mode<\/span><strong>\{regularSearchPreparation\?\.searchMode\.replaceAll\("_", " "\)\}</)
  assert.match(page, />Graduation year<\/span><strong>\{regularSearchPreparation\?\.graduationYear\}<\/strong>/)
  assert.match(page, />Company<\/span><strong>\{regularSearchPreparation\?\.company\}<\/strong>/)
  assert.match(page, />Company mapping<\/span><strong>\{regularSearchPreparation\?\.companyMapping\}<\/strong>/)
  assert.match(page, />Programme<\/span><strong>Not constrained<\/strong>/)
  assert.match(page, />Seniority<\/span><strong>\{regularSearchPreparation\?\.seniority\}<\/strong>/)
  assert.match(page, />Page size \/ result bound<\/span><strong>\{regularSearchPreparation\?\.pageSize\}<\/strong>/)
  assert.match(page, />Maximum Search requests<\/span><strong>\{regularSearchPreparation\?\.maximumSearchRequests\}<\/strong>/)
  assert.match(page, />Automatic Collect<\/span><strong>\{regularSearchPreparation\?\.automaticCollect \? "On" : "Off"\}<\/strong>/)
  assert.match(page, />Automatic canonical update<\/span><strong>\{regularSearchPreparation\?\.automaticCanonicalUpdate \? "On" : "Off"\}<\/strong>/)
  assert.doesNotMatch(page, /Requires an exact graduation year/)
  assert.match(page, /Boolean\(discoveryFilters\.graduationYear && !\/\^\\d\{4\}\$\/\.test\(discoveryFilters\.graduationYear\)\)/)
})

test("Search confirmation remains usable at 390px and 360px breakpoints", () => {
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\[data-slot="dialog-content"\] \{ max-width: calc\(100vw - 1rem\) !important; max-height: calc\(100dvh - 1rem\); overflow-y: auto; \}/)
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*?\.refresh-confirm-summary \{ grid-template-columns: 1fr; \}/)
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*?\.refresh-confirm-dialog[\s\S]*?\{ padding: 1rem; \}/)
})

test("active Programme Reference Data supplies the scalable discovery multi-select", () => {
  const options = programmes.programmeFilterOptions([
    { id: 1, code: "PGP", name: "PGP", active: true, sortOrder: 10 },
    { id: 2, code: "IPMX", name: "IPMX", active: true, sortOrder: 20 },
    { id: 3, code: "PGPWE", name: "PGPWE", active: false, sortOrder: 30 },
  ], [])
  assert.deepEqual(options.filter(option => option.active).map(option => option.value), ["PGP", "IPMX"])
  assert.equal(programmes.programmeSelectionSummary(["PGP"]), "PGP")
  assert.equal(programmes.programmeSelectionSummary(["PGP", "ABM"]), "PGP, ABM")
  assert.equal(programmes.programmeSelectionSummary(["PGP", "ABM", "SM", "IPMX"]), "4 programmes selected")
  assert.match(page, /activeProgrammeChoices\.map/)
  assert.match(page, /current\.discoveryProgrammes\.filter\(code => activeCodes\.has\(code\)\)/)
})

test("Rajat acceptance filters produce the provider request and confirmation model without executing it", () => {
  const filters = { ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP"], company: "Innovaccer", graduationYear: "2024" }
  const contract = coresignal.coresignalSearchContract(filters, new Date("2026-09-27T12:00:00Z"))
  assert.equal(contract.body.education_institution_professional_network_url, coresignal.CORESIGNAL_IIML_INSTITUTION_URL)
  assert.equal(contract.body.experience_company_name, "Innovaccer")
  assert.equal(contract.body.education_date_to, "2024")
  assert.match(contract.body.education_program_name, /PGP/)
  assert.equal(limits.discoveryApplicationUnits(3, 1), 4)
  assert.match(search.criteriaSummary(filters), /Alumni status: Past alumni only/)
  assert.match(search.criteriaSummary(filters), /Programmes: PGP/)
  assert.match(search.criteriaSummary(filters), /Company: Innovaccer/)
  assert.match(search.criteriaSummary(filters), /Graduation year: 2024/)
  for (const value of ["pendingDiscoveryFilters?.company", "pendingDiscoveryFilters?.graduationYear", "pendingDiscoveryFilters?.discoveryProgrammes.join", "discoveryMaximumApplicationUsage"]) assert.match(page, new RegExp(value.replace(/[?.]/g, match => `\\${match}`)))
})

test("programme maintenance is additive, Admin-only, and code-stable", () => {
  assert.match(migration, /CREATE TABLE `programme_options`/)
  assert.match(migration, /\('PGP', 'PGP'/)
  assert.match(migration, /\('ABM', 'ABM'/)
  assert.match(migration, /\('SM', 'SM'/)
  assert.match(adminApi, /authorizeRequest\(request, "MANAGE_USERS"\)/)
  assert.match(adminApi, /payload\.action === "add_programme"/)
  assert.match(adminApi, /payload\.action === "rename_programme"/)
  assert.match(adminApi, /payload\.action === "set_programme_status"/)
  assert.doesNotMatch(adminApi, /db\.update\(alumni\).*programme/s)
  assert.match(admin, /Programme reference data/)
  assert.match(admin, /Deactivate/)
  assert.match(page, /activeProgrammeChoices\.some\(option => option\.value === current\.programme\)/)
})
