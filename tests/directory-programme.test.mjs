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
const limits = await vite.ssrLoadModule("/lib/discovery-limit.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
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

test("Clear resets all directory and discovery state without a provider request", () => {
  const match = page.match(/function clearDirectoryFilters\(\) \{([\s\S]*?)\n  \}/)
  assert.ok(match)
  assert.match(match[1], /setFilters\(defaultDirectoryFilters\(\)\)/)
  assert.match(match[1], /setDiscoveryResults\(\[\]\)/)
  assert.match(match[1], /setPendingDiscoveryFilters\(null\)/)
  assert.doesNotMatch(match[1], /fetch\(|runDiscovery|discoverMoreAlumni/)
})

test("Directory copy separates internal filtering from explicit external discovery", () => {
  assert.match(page, /Internal alumni directory/i)
  assert.match(page, /Need more alumni\?/)
  assert.match(page, /Internal directory filters never call a provider/)
  assert.match(page, /Any Data Confidence/)
  assert.match(page, /Any Placement Relevance/)
  assert.match(page, /Hide advanced filters/)
})

test("external discovery has independent multi-programme and past-alumni controls", () => {
  const defaults = search.defaultDirectoryFilters()
  assert.deepEqual(defaults.discoveryProgrammes, ["PGP", "ABM", "SM"])
  assert.equal(defaults.alumniStatus, "Past alumni only")
  assert.match(page, /External discovery alumni status/)
  assert.match(page, /programme-multiselect/)
  assert.match(page, /activeProgrammeChoices\.map/)
  assert.match(page, /All graduation statuses \(review only\)/)
  assert.match(page, /Select at least one programme for external discovery/)
})

test("directory and external programme controls are labelled as independent scopes", () => {
  assert.match(page, />Directory programme</)
  assert.match(page, /Applies only to existing Corporate Network records\. It does not affect external provider discovery\./)
  assert.match(page, />IIML programmes to discover</)
  assert.match(page, /Used only for external Coresignal discovery\. Directory filters above do not affect provider searches\./)
  assert.match(page, /value=\{filters\.programme\} onValueChange=\{value => updateFilter\("programme", value\)\}/)
  assert.match(page, /checked=\{filters\.discoveryProgrammes\.includes\(option\.value\)\}/)
  assert.match(page, /pendingDiscoveryFilters\?\.discoveryProgrammes\.join\(", "\)/)
  assert.doesNotMatch(page, /discoveryProgrammes:\s*\[?filters\.programme/)
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
