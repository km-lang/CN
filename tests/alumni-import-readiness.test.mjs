import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { generateMalformedAlumni, generateSyntheticAlumni, recordsToCsv } from "../scripts/synthetic-alumni-generator.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const importer = await vite.ssrLoadModule("/lib/alumni-import.ts")
const route = await readFile(new URL("../app/api/imports/route.ts", import.meta.url), "utf8")
const workspace = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

test("synthetic generation is deterministic, fictional and spreadsheet-safe", () => {
  const first = generateSyntheticAlumni(1000, 20261016)
  const second = generateSyntheticAlumni(1000, 20261016)
  assert.deepEqual(first, second)
  assert.equal(first.length, 1000)
  assert.ok(first.every(row => row.name.startsWith("Synthetic Alumnus ")))
  assert.ok(first.filter(row => row.email).every(row => row.email.endsWith("@example.test")))
  assert.ok(recordsToCsv([{ source_alumni_id: "=1+1", name: "+unsafe" }]).includes("'=1+1"))
})

test("1,000 and 10,000 valid records preview without provider behavior", () => {
  for (const count of [1000, 10000]) {
    const parsed = importer.parseCsv(recordsToCsv(generateSyntheticAlumni(count)))
    const review = importer.validateImport(parsed, [], ["PGP", "ABM", "SM"])
    assert.equal(review.counts.detected, count)
    assert.equal(review.counts.valid, count)
    assert.equal(review.counts.newRecords, count)
    assert.equal(review.counts.rejected, 0)
  }
})

test("malformed rows report required fields, years, email, URLs, programme, consent and duplicates", () => {
  const review = importer.validateImport(generateMalformedAlumni(), [], ["PGP", "ABM", "SM"])
  const issues = review.rows.flatMap(row => row.issues).join(" | ")
  assert.match(issues, /Source alumni identifier is required/)
  assert.match(issues, /plausible four-digit year/)
  assert.match(issues, /Email is malformed/)
  assert.match(issues, /LinkedIn URL/)
  assert.match(issues, /not configured/)
  assert.match(issues, /unsupported/)
  assert.match(issues, /duplicate source identifier/)
})

test("CSV preserves quoted commas, quotes and embedded line breaks and rejects malformed quoting", () => {
  const csv = 'source_alumni_id,source_system,name,programme,graduation_year,company,note\nID-1,master,"Example, Person",PGP,2018,Example Co,"Line one\nLine ""two"""'
  const [record] = importer.parseCsv(csv)
  assert.equal(record.name, "Example, Person")
  assert.equal(record.note, 'Line one\nLine "two"')
  assert.throws(() => importer.parseCsv('name\n"unterminated'), /unterminated quoted field/)
})

test("identity hierarchy separates trusted matches, weak duplicates and conflicts", () => {
  const existing = [
    { id: 1, profileKey: "institutional:iiml-master:id-1", name: "Synthetic One", batch: 2018, graduationYear: 2018, programme: "PGP", company: "Example One", title: "Director", function: "Strategy", seniority: "Director", location: "Mumbai", email: "one@example.test", emailVerification: "Verified", phone: "", linkedinUrl: "https://www.linkedin.com/in/synthetic-one", updatedAt: "2026-01-01" },
    { id: 2, profileKey: "institutional:iiml-master:id-2", name: "Synthetic Two", batch: 2019, graduationYear: 2019, programme: "ABM", company: "Example Two", title: "Manager", function: "Finance", seniority: "Manager", location: "Delhi", email: "two@example.test", emailVerification: "Verified", phone: "", linkedinUrl: "https://www.linkedin.com/in/synthetic-two", updatedAt: "2026-01-01" },
  ]
  const base = { source_system: "iiml-master", programme: "PGP", graduation_year: "2018", company: "Example One" }
  assert.equal(importer.validateImport([{ ...base, source_alumni_id: "ID-1", name: "Synthetic One", title: "VP" }], existing, ["PGP", "ABM", "SM"]).rows[0].kind, "existing")
  assert.equal(importer.validateImport([{ ...base, source_alumni_id: "NEW", name: "Synthetic One" }], existing, ["PGP", "ABM", "SM"]).rows[0].kind, "likely_duplicate")
  const conflict = importer.validateImport([{ ...base, source_alumni_id: "ID-1", name: "Synthetic One", linkedin_url: "https://www.linkedin.com/in/synthetic-two" }], existing, ["PGP", "ABM", "SM"]).rows[0]
  assert.equal(conflict.kind, "conflict")
})

test("review report prevents spreadsheet formula injection", () => {
  const review = importer.validateImport([{ source_alumni_id: "SAFE-1", source_system: "master", name: "=cmd", programme: "PGP", graduation_year: "2018", company: "Example" }], [], ["PGP"])
  assert.match(importer.importReviewCsv(review), /'=cmd/)
})

test("server import is Admin-only, stale-preview checked and provider-free", () => {
  assert.match(route, /authorizeRequest\(request, "MANAGE_USERS"\)/)
  assert.match(route, /previewId !== previewId/)
  assert.match(route, /Explicit import confirmation is required/)
  assert.match(route, /providerCalls: 0/)
  assert.match(route, /db\.batch\(batch/)
  assert.match(route, /mutationRequestItems/)
  assert.match(route, /ownershipGuard/)
  assert.doesNotMatch(route, /values\(chunk\)/)
  assert.doesNotMatch(route, /coresignal|lusha|bright|socai|gmail/i)
  assert.match(workspace, /Administrator access is required for bulk alumni imports/)
  assert.match(page, /session\.canAdminister && <TabsTrigger value="data-import"/)
})

test("protected fields remain governed while blank values preserve and explicit clears are allowlisted", () => {
  assert.match(route, /current\.currentCompanyVerification === "Unverified"/)
  assert.match(route, /current\.designationVerification === "Unverified"/)
  assert.match(route, /current\.locationVerification === "Unverified"/)
  assert.match(route, /\(!next && !clearing\)/)
  assert.match(route, /allowedClears = new Set\(\["company", "title", "location", "email", "phone", "note"\]\)/)
  assert.match(route, /proposals\.push\(\{ field, oldValue: text\(currentValue\), proposedValue: next \}\)/)
  assert.match(route, /emailVerification: "Unverified"/)
  assert.match(route, /profileMatch: "Unverified"/)
  assert.match(route, /trustedAlumniIdentity = effectiveIntakeStatus\(current\) === "VERIFIED"/)
  assert.match(route, /apply\("name", "name", current\.name, record\.name, !trustedAlumniIdentity\)/)
  assert.match(route, /changes\.source = `Institutional import/)
  assert.match(route, /import_linkedin_identity:/)
  assert.match(route, /rtrim\(lower\(linkedin_url\), '\/'\)/)
})
