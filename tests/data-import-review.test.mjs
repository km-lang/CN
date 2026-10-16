import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { strToU8, zipSync } from "fflate"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const importer = await vite.ssrLoadModule("/lib/alumni-import.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const api = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")

test("CSV and aliases enter the same record shape", () => {
  const [record] = importer.parseCsv("source_id,source,name,graduation_year,programme,company,designation,professional_profile_url,data_confidence,outreach_status\nIIML-1,iiml-master,Asha Test,2018,PGP,Example Industries,Director,https://www.linkedin.com/in/asha-test,72,Not contacted")
  assert.equal(record.title, "Director")
  assert.equal(record.linkedin_url, "https://www.linkedin.com/in/asha-test")
  assert.equal(record.confidence, "72")
  assert.equal(record.status, "Not contacted")
})

test("XLSX reads cached cell values from the first worksheet", () => {
  const workbook = '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Alumni" sheetId="1" r:id="rId1"/></sheets></workbook>'
  const relationships = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
  const sheet = '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>batch</t></is></c><c r="C1" t="inlineStr"><is><t>company</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Excel Alumnus</t></is></c><c r="B2"><v>2019</v></c><c r="C2" t="inlineStr"><is><t>Example Industries</t></is></c></row></sheetData></worksheet>'
  const bytes = zipSync({ "xl/workbook.xml": strToU8(workbook), "xl/_rels/workbook.xml.rels": strToU8(relationships), "xl/worksheets/sheet1.xml": strToU8(sheet) })
  const result = importer.parseXlsx(bytes)
  assert.equal(result.sheetName, "Alumni")
  assert.deepEqual(result.records, [{ name: "Excel Alumnus", graduation_year: "2019", company: "Example Industries" }])
})

test("published XLSX template is readable by the production parser", async () => {
  const bytes = await readFile(new URL("../docs/import/Corporate Network Alumni Import Template.xlsx", import.meta.url))
  const result = importer.parseXlsx(bytes)
  assert.equal(result.sheetName, "Alumni Import")
  assert.ok(result.records.length >= 1)
  assert.equal(result.records[0].source_alumni_id, "IIML-TEST-0001")
  assert.equal(result.records[0].source_system, "iiml-master")
  assert.equal(result.records[0].programme, "PGP")
  assert.equal(result.records[0].source_date, "2026-10-01")
})

test("encrypted Excel files fail with an actionable error", () => {
  const bytes = zipSync({ EncryptionInfo: strToU8("encrypted"), EncryptedPackage: strToU8("payload") })
  assert.throws(() => importer.parseXlsx(bytes), /encrypted Excel workbooks are not supported/i)
})

test("validation classifies new, existing, invalid and in-file duplicate rows before mutation", () => {
  const existing = [{ id: 15, profileKey: "institutional:iiml-master:iiml-15", name: "Sahil Bansal", batch: 2012, programme: "PGP", company: "Local Fixture Company", title: "Director", function: "Strategy", seniority: "Director", location: "India", email: "sahil.bansal@example.test", emailVerification: "Verified", phone: "" }]
  const result = importer.validateImport([
    { source_alumni_id: "IIML-20", source_system: "iiml-master", name: "New Person", graduation_year: "2020", programme: "PGP", company: "Example Industries" },
    { source_alumni_id: "IIML-15", source_system: "iiml-master", name: "Sahil Bansal", graduation_year: "2012", programme: "PGP", company: "Local Fixture Company", title: "Vice President" },
    { source_alumni_id: "IIML-20", source_system: "iiml-master", name: "New Person", graduation_year: "2020", programme: "PGP", company: "Example Industries" },
    { source_alumni_id: "", source_system: "iiml-master", name: "", graduation_year: "1900", programme: "Unknown", company: "" },
  ], existing, ["PGP", "ABM", "SM"])
  assert.deepEqual(result.rows.map(row => row.kind), ["new", "existing", "duplicate", "error"])
  assert.equal(result.blocking, false)
  assert.equal(result.counts.duplicates, 1)
  assert.equal(result.counts.valid, 2)
})

test("UI hides the native file control and requires validate then review then import", () => {
  assert.match(page, /accept="\.csv,text\/csv,\.xlsx/)
  assert.match(page, /Preview dry run<\/Button>/)
  assert.match(page, /Import reviewed records/)
  assert.match(page, /Apply safe changes; preserve verified fields/)
  assert.match(styles, /input\.file-input\s*\{[^}]*opacity:\s*0[^}]*appearance:\s*none/s)
})

test("server never treats imported contacts as verified or overwrites protected fields", () => {
  assert.match(api, /Administrator access is required for bulk alumni imports/)
  assert.match(api, /phoneVerification: "Unverified"/)
  assert.match(api, /"Excel import" : "CSV import"/)
  assert.match(api, /existing\.currentCompanyVerification === "Unverified"/)
  assert.match(api, /protectedFields \+= 1/)
  assert.doesNotMatch(api, /onConflictDoUpdate\(\{\s*target: alumni\.profileKey,\s*set: record/s)
})

test("manual add explains duplicate evidence and blocks exact duplicates", () => {
  assert.match(page, /Check & Add Alumnus/)
  assert.match(page, /No Coresignal or Lusha call is made/)
  assert.match(page, /Matched by \{match\.reasons\.join/)
  assert.match(api, /matches\.some\(match => match\.exact\)/)
  assert.match(api, /Use the existing record instead of creating a duplicate/)
  assert.match(page, /function: "Not assessed"/)
})
