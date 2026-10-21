import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { unzipSync, strFromU8 } from "fflate"
import { createServer } from "vite"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const query = await vite.ssrLoadModule("/lib/directory-query.ts")
const files = await vite.ssrLoadModule("/lib/export-files.ts")

test.after(async () => vite.close())

const person = (overrides = {}) => ({
  id: 1, name: "Śhruti Chaturvedi", company: "Lincoln International", title: "Director", function: "Finance", seniority: "Director", location: "Mumbai",
  linkedinUrl: "https://linkedin.com/in/shruti", programme: "PGP", batch: 2011, graduationYear: 2011, previous: "Legacy Bank", confidence: 90, status: "Not contacted",
  assessment: { iimlRelationship: "Strong" }, ...overrides,
})

function normalized(filters = {}) { return query.normalizeDirectoryQuery({ ...search.defaultDirectoryFilters(), ...filters }) }
function matches(filters, value = person()) { return query.directoryMatches(value, normalized(filters), 80, "Contact-ready") }

test("name search normalizes case, spaces, punctuation and diacritics without fuzzy identity merging", () => {
  assert.equal(matches({ name: "shruti   chaturvedi" }), true)
  assert.equal(matches({ name: "Chaturvedi" }), true)
  assert.equal(matches({ name: "Shruti-Chaturvedi" }), true)
  assert.equal(matches({ name: "Shruti Other" }), false)
})

test("graduation filters implement exact, on-or-before, inclusive range and selected-year OR semantics", () => {
  assert.equal(matches({ graduationYearMode: "exact", batch: "2011" }), true)
  assert.equal(matches({ graduationYearMode: "exact", batch: "2012" }), false)
  assert.equal(matches({ graduationYearMode: "onOrBefore", batch: "2011" }), true)
  assert.equal(matches({ graduationYearMode: "onOrBefore", batch: "2010" }), false)
  assert.equal(matches({ graduationYearMode: "range", graduationYearStart: "2009", graduationYearEnd: "2011" }), true)
  assert.equal(matches({ graduationYearMode: "range", graduationYearStart: "2012", graduationYearEnd: "2015" }), false)
  assert.equal(matches({ graduationYearMode: "multiple", graduationYears: "2009, 2011, 2011, 2013" }), true)
  assert.equal(matches({ graduationYearMode: "multiple", graduationYears: "2009, 2013" }), false)
})

test("invalid year filters fail closed", () => {
  assert.throws(() => normalized({ graduationYearMode: "range", graduationYearStart: "2015", graduationYearEnd: "2010" }), /Start year/)
  assert.throws(() => normalized({ graduationYearMode: "multiple", graduationYears: "" }), /at least one/)
  assert.throws(() => normalized({ graduationYearMode: "exact", batch: "not-a-year" }), /valid year/)
  assert.throws(() => normalized({ graduationYearMode: "arbitrary" }), /unsupported/)
  assert.throws(() => normalized({ seniorityMode: "arbitrary" }), /unsupported/)
  assert.throws(() => query.normalizeDirectoryQuery({ pageSize: 10_000 }), /Page size/)
  assert.throws(() => query.normalizeDirectoryQuery({ sort: "raw_sql" }), /sort is unsupported/)
})

test("default relevance ordering reuses its selected alias within D1 expression limits", async () => {
  const source = await readFile(new URL("../lib/directory-data.ts", import.meta.url), "utf8")
  assert.match(source, /relevance: relevance\.as\("relevance"\)/)
  assert.match(source, /desc\(sql`relevance`\)/)
  assert.doesNotMatch(source, /\[desc\(relevance\), asc\(alumni\.name\)/)
})

test("selected seniorities use OR while minimum seniority uses the configured rank", () => {
  assert.equal(matches({ seniorityMode: "selected", seniorities: ["VP", "Director"] }), true)
  assert.equal(matches({ seniorityMode: "selected", seniorities: ["VP"] }), false)
  assert.equal(matches({ seniorityMode: "minimum", seniorities: ["VP"] }), false)
  assert.equal(matches({ seniorityMode: "minimum", seniorities: ["Director"] }), true)
  assert.equal(matches({ seniorityMode: "minimum", seniorities: ["VP"] }, person({ seniority: "CXO" })), true)
  assert.equal(matches({ seniorityMode: "minimum", seniorities: ["VP"] }, person({ seniority: "Associate/Consultant" })), false)
  assert.equal(matches({ seniorityMode: "selected", seniorities: ["Analyst/Junior"] }, person({ seniority: "", title: "" })), false)
  assert.equal(matches({ seniorityMode: "minimum", seniorities: ["Analyst/Junior"] }, person({ seniority: "", title: "" })), false)
})

test("top-level dimensions use AND and unknown graduation remains excluded from an explicit year", () => {
  assert.equal(matches({ name: "Shruti", company: "Lincoln International", graduationYearMode: "exact", batch: "2011", seniorityMode: "minimum", seniorities: ["Director"] }), true)
  assert.equal(matches({ name: "Shruti", company: "Other", graduationYearMode: "exact", batch: "2011", seniorityMode: "minimum", seniorities: ["Director"] }), false)
  assert.equal(matches({ graduationYearMode: "exact", batch: "2011" }, person({ batch: 0, graduationYear: 0 })), false)
})

test("latest-role resolver preserves history, excludes deleted evidence and never promotes history", () => {
  const result = query.resolveLatestValidPosition([
    { companyId: "8469989", company: "Lincoln International", title: "Vice President", startDate: "2018", endDate: "2021", current: false },
    { companyId: "8469989", company: "Lincoln International", title: "Director", startDate: "2022", current: true },
    { companyId: "8469989", company: "Lincoln International", title: "Invalid", startDate: "2024", current: true, deleted: true },
  ], { id: "8469989" })
  assert.equal(result.state, "RESOLVED"); assert.equal(result.current.title, "Director"); assert.deepEqual(result.historical.map(item => item.title), ["Vice President"])
  assert.equal(query.resolveLatestValidPosition([{ company: "Lincoln International", title: "VP", current: false }]).state, "UNKNOWN")
})

test("conflicting equally current roles require review", () => {
  const result = query.resolveLatestValidPosition([{ company: "Lincoln International", title: "Director", startDate: "2024", current: true }, { company: "Lincoln International", title: "VP", startDate: "2024", current: true }])
  assert.equal(result.state, "REVIEW_REQUIRED"); assert.equal(result.current, null)
})

test("pagination is applied after filtering and deterministic sorting", () => {
  const items = Array.from({ length: 30 }, (_, index) => person({ id: index + 1, name: `Person ${String(index + 1).padStart(2, "0")}`, graduationYear: index % 2 ? 2011 : 2012, batch: index % 2 ? 2011 : 2012 }))
  const result = query.applyDirectoryQuery(items, query.normalizeDirectoryQuery({ ...search.defaultDirectoryFilters(), graduationYearMode: "exact", batch: "2011", page: 2, pageSize: 10, sort: "name" }), () => 50, () => "Contact-ready")
  assert.equal(result.total, 15); assert.equal(result.items.length, 5); assert.equal(result.items[0].name, "Person 22")
})

test("CSV handles commas, quotes, line breaks and formula injection", () => {
  const csv = files.datasetCsv({ id: "test", label: "Test", columns: [{ key: "name", label: "Name" }], rows: [{ name: '=CMD("x")' }, { name: 'A, "quoted"\nvalue' }] })
  assert.match(csv, /"'=CMD\(""x""\)"/); assert.match(csv, /"A, ""quoted""\nvalue"/)
})

test("XLSX contains safe worksheets, frozen headers and literal untrusted text", () => {
  const bytes = files.datasetsXlsx([{ id: "alumni", label: "ALUMNI", columns: [{ key: "id", label: "ID" }, { key: "name", label: "Name" }], rows: [{ id: 1, name: "+SUM(1,1)" }] }], { Generated: "test" })
  const zip = unzipSync(bytes)
  assert.ok(zip["xl/workbook.xml"]); assert.ok(zip["xl/worksheets/sheet2.xml"])
  const sheet = strFromU8(zip["xl/worksheets/sheet2.xml"])
  assert.match(sheet, /state="frozen"/); assert.match(sheet, /&apos;\+SUM\(1,1\)/); assert.doesNotMatch(sheet, /<f>/)
})

test("export endpoints are server-authorized and own their dataset allowlist", async () => {
  const route = await readFile(new URL("../app/api/exports/route.ts", import.meta.url), "utf8")
  assert.match(route, /payload\.scope === "admin" \? "MANAGE_USERS" : "EXPORT_DIRECTORY"/)
  const policy = await readFile(new URL("../lib/security-policy.ts", import.meta.url), "utf8")
  assert.match(policy, /ADMIN: new Set\(\[[^\]]*"EXPORT_DIRECTORY"/)
  assert.match(policy, /PCOM: new Set\(\[[^\]]*"EXPORT_DIRECTORY"/)
  assert.doesNotMatch(policy, /DEVELOPER: new Set\(\[[^\]]*"EXPORT_DIRECTORY"/)
  assert.match(route, /new Set\(\["alumni", "companies", "company_mappings", "priorities", "engagements", "opportunities", "opportunity_history", "professional_reviews", "programmes"\]\)/)
  assert.match(route, /payload\.scope !== "directory" && payload\.scope !== "admin"/)
  assert.match(route, /payload\.format !== "csv" && payload\.format !== "xlsx"/)
  assert.match(route, /private, no-store/); assert.doesNotMatch(route, /providerResponseHistory|securityAuditEvents|applicationIdentities/)
})

test("Directory UI exposes explicit year/seniority modes and governed export without coupling discovery", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  assert.match(page, /Graduation Year \(Passing-out Batch\)/); assert.match(page, /Exact batch/); assert.match(page, /On or before/); assert.match(page, /Year range/); assert.match(page, /Multiple batches/)
  assert.match(page, /Minimum seniority/); assert.match(page, /All matching records/); assert.match(page, /API_ROUTES\.exports/)
  assert.match(page, /Internal directory filters never call or constrain a provider/)
  assert.match(page, /API_ROUTES\.directory/); assert.match(page, /pageSize: String\(directoryPageSize\)/)
})
