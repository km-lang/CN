import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createServer } from "vite"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const profiles = await vite.ssrLoadModule("/lib/alumni-profile-update.ts")
const seniority = await vite.ssrLoadModule("/lib/seniority-classifier.ts")
const importer = await vite.ssrLoadModule("/lib/alumni-import.ts")
const exportFiles = await vite.ssrLoadModule("/lib/export-files.ts")

test.after(async () => vite.close())

const current = {
  name: "Test Alumnus", programme: "PGP", graduationYear: 2011, company: "Lincoln International", title: "Vice President", location: "Mumbai",
  email: "test@example.test", phone: "+91 9000000000", note: "Keep", seniority: "VP", currentCompanyVerification: "Unverified",
  designationVerification: "Unverified", locationVerification: "Unverified", emailVerification: "Unverified", phoneVerification: "Unverified",
}

test("profile PATCH planning preserves omitted/blank values and validates explicit clears", () => {
  assert.deepEqual(profiles.planProfileUpdate(current, { company: "", title: "" }, [], "PCOM"), { direct: {}, proposed: [], history: [] })
  const clear = profiles.planProfileUpdate(current, {}, ["phone"], "PCOM")
  assert.equal(clear.direct.phone, "")
  assert.throws(() => profiles.planProfileUpdate(current, {}, ["programme"], "ADMIN"), /cannot be cleared/)
  assert.throws(() => profiles.planProfileUpdate(current, { company: "Other" }, [], "DEVELOPER"), /cannot edit/)
})

test("protected fields become review proposals and direct titles reclassify without global Director/VP inference", () => {
  const protectedPlan = profiles.planProfileUpdate({ ...current, currentCompanyVerification: "Verified" }, { company: "Other" }, [], "PCOM")
  assert.equal(protectedPlan.proposed[0].field, "company"); assert.equal(protectedPlan.history.length, 0)
  const direct = profiles.planProfileUpdate(current, { title: "Director" }, [], "ADMIN")
  assert.equal(direct.direct.title, "Director"); assert.equal(direct.direct.seniority, "Director")
  assert.equal(seniority.classifyCurrentTitle("Director", "Lincoln International").source, "company_override")
  assert.equal(seniority.classifyCurrentTitle("Unusual Fellowship Lead", "Example").state, "UNCLASSIFIED")
})

test("update-only import accepts stable partial rows, preserves blanks and never creates an unmatched alumnus", () => {
  const existing = [{ id: 7, profileKey: "institutional:iiml:abc", name: "Existing", batch: 2011, graduationYear: 2011, programme: "PGP", company: "Old Co", title: "Director", function: "Finance", seniority: "Director", location: "Mumbai", email: "verified@example.test", phone: "123", linkedinUrl: "", previous: "", emailVerification: "Verified" }]
  const matched = importer.validateImport([{ canonical_alumni_id: "7", company: "New Co", title: "" }], existing, ["PGP"], { mode: "update_only" }).rows[0]
  assert.equal(matched.kind, "existing"); assert.deepEqual(matched.changedFields, ["company"])
  const missing = importer.validateImport([{ canonical_alumni_id: "99", company: "New Co" }], existing, ["PGP"], { mode: "update_only" }).rows[0]
  assert.equal(missing.kind, "error"); assert.match(missing.issues.join(" "), /does not exist|No existing alumnus/)
  assert.throws(() => importer.parseCsv("canonical_alumni_id,arbitrary_sql\n7,DROP TABLE alumni"), /Unsupported import column/)
  assert.equal(importer.templateCsv().split("\r\n")[0].split(",").length, importer.templateCsv().split("\r\n")[1].split(",").length)
})

test("business-facing partial-update headers map to canonical identity and profile fields", () => {
  const [record] = importer.parseCsv("alumni_id,current_company,current_title\r\n7,New Co,New Title")
  assert.deepEqual(record, { canonical_alumni_id: "7", company: "New Co", title: "New Title" })
})

test("partial-update aliases reject ambiguity and indexed identity collisions remain review-only", () => {
  assert.throws(() => importer.parseCsv("alumni_id,company,current_company\r\n7,One,Two"), /duplicate or equivalent column headers/)
  const duplicateTarget = importer.validateImport([
    { canonical_alumni_id: "7", company: "One" },
    { canonical_alumni_id: "7", company: "Two" },
  ], [{ ...current, id: 7, profileKey: "institutional:iiml:7" }], ["PGP"], { mode: "update_only" })
  assert.equal(duplicateTarget.rows[1].kind, "duplicate")
  const ambiguous = importer.validateImport([{ email: "shared@example.test", company: "New" }], [
    { ...current, id: 7, email: "shared@example.test", emailVerification: "Verified" },
    { ...current, id: 8, email: "shared@example.test", emailVerification: "Verified" },
  ], ["PGP"], { mode: "update_only" })
  assert.equal(ambiguous.rows[0].kind, "conflict")
  assert.match(ambiguous.rows[0].issues.join(" "), /Trusted identity signals/)
})

test("profile routes enforce role authorization and version-fenced writes before history", async () => {
  const route = await readFile(new URL("../app/api/alumni/[id]/route.ts", import.meta.url), "utf8")
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(route, /authorizeRequest\(request, "MANAGE_USERS"\)/)
  assert.match(route, /eq\(alumni\.recordVersion, current\.recordVersion\)/)
  assert.match(route, /mutationCommitGuards/)
  assert.match(route, /last_mutation_request_key/)
  assert.match(route, /db\.batch\(actions/)
  assert.match(route, /expectedRecordVersion: nextVersion/)
  assert.match(route, /STALE_PROPOSAL/)
  assert.match(route, /VERSION_CONFLICT/)
})

test("direct profile loading preserves protected proposals and employment evidence", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  assert.match(page, /employmentHistory: data\.employmentHistory \?\? \[\]/)
  assert.match(page, /profileProposals: data\.proposals \?\? \[\]/)
})

test("mixed direct and protected import changes fence proposals at the resulting version", async () => {
  const route = await readFile(new URL("../app/api/imports/route.ts", import.meta.url), "utf8")
  assert.match(route, /proposalRecordVersion = current\.recordVersion \+ \(plan\.history\.length \? 1 : 0\)/)
  assert.match(route, /expectedRecordVersion: proposalRecordVersion/)
})

test("Directory and export paths retain SQL-side filtering, counting and bounded paging", async () => {
  const source = await readFile(new URL("../lib/directory-data.ts", import.meta.url), "utf8")
  const exportsRoute = await readFile(new URL("../app/api/exports/route.ts", import.meta.url), "utf8")
  assert.match(source, /select\(\{ total: count\(\) \}\)/)
  assert.match(source, /\.limit\(query\.pageSize\)\.offset/)
  assert.match(source, /providerCompanyAliases/)
  assert.match(source, /runDirectoryExportQuery/)
  assert.match(exportsRoute, /runDirectoryExportQuery\(query, MAX_EXPORT_ROWS\)/)
  assert.doesNotMatch(exportsRoute, /runDirectoryQuery\(query\)/)
})

test("the additive migration retains evidence, aliases and versioned proposals without destructive SQL", async () => {
  const migration = await readFile(new URL("../drizzle/0015_lush_paibok.sql", import.meta.url), "utf8")
  assert.match(migration, /CREATE TABLE `alumni_employment_evidence`/)
  assert.match(migration, /CREATE TABLE `alumni_profile_change_proposals`/)
  assert.match(migration, /CREATE TABLE `provider_company_aliases`/)
  assert.match(migration, /ADD `record_version`/)
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE)\b/im)
})

test("import-compatible XLSX keeps alumni data on the first worksheet", () => {
  const bytes = exportFiles.datasetsXlsx([{ id: "alumni_import_compatible", label: "ALUMNI_IMPORT", columns: [{ key: "alumni_id", label: "alumni_id" }, { key: "current_company", label: "current_company" }], rows: [{ alumni_id: "24", current_company: "Fictional Company" }] }], { Generated: "test" }, { dataFirst: true })
  const parsed = importer.parseXlsx(bytes)
  assert.equal(parsed.sheetName, "ALUMNI_IMPORT")
  assert.deepEqual(parsed.records, [{ canonical_alumni_id: "24", company: "Fictional Company" }])
})
