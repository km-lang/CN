import { DatabaseSync } from "node:sqlite"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { generateSyntheticAlumni, recordsToCsv, SYNTHETIC_SEED } from "./synthetic-alumni-generator.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const values = process.argv.slice(2)
function arg(name, fallback) { const index = values.indexOf(`--${name}`); return index >= 0 ? values[index + 1] : fallback }
const count = Number(arg("count", "1000")); const databasePath = resolve(arg("db", `/private/tmp/cn-import-${count}.sqlite`)); const reportPath = resolve(arg("report", `/private/tmp/cn-import-${count}-report.json`))
if (![1000, 10000].includes(count)) throw new Error("Scale validation supports exactly 1000 or 10000 rows.")
await mkdir(dirname(databasePath), { recursive: true })
const db = new DatabaseSync(databasePath)
db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
const migrations = (await readdir(resolve(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
for (const migration of migrations) db.exec((await readFile(resolve(root, "drizzle", migration), "utf8")).replaceAll("--> statement-breakpoint", ""))
db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)")
const recordMigration = db.prepare("INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)")
for (const migration of migrations) recordMigration.run(migration)
const addProgramme = db.prepare("INSERT OR IGNORE INTO programme_options(code,name,active,sort_order,updated_by) VALUES (?,?,?,?,?)")
for (const [index, code] of ["PGP", "ABM", "SM"].entries()) addProgramme.run(code, code, 1, index, "Synthetic validation")

const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const importer = await vite.ssrLoadModule("/lib/alumni-import.ts")
const records = generateSyntheticAlumni(count, SYNTHETIC_SEED); const csv = recordsToCsv(records)
const memoryBefore = process.memoryUsage().heapUsed
let started = performance.now(); const parsed = importer.parseCsv(csv); const parseMs = performance.now() - started
started = performance.now(); const review = importer.validateImport(parsed, [], ["PGP", "ABM", "SM"]); const validationMs = performance.now() - started
if (review.counts.valid !== count || review.counts.newRecords !== count) throw new Error(`Unexpected preview counts: ${JSON.stringify(review.counts)}`)
const insert = db.prepare(`INSERT OR IGNORE INTO alumni(profile_key,name,initials,batch,graduation_year,programme,education,company,title,raw_title,function,seniority,location,previous_companies,experience_years,confidence,email,phone,linkedin_url,verified_label,outreach_status,note,profile_match,current_company_verification,designation_verification,email_verification,phone_verification,location_verification,source,updated_by,discovery_source,discovery_date,current_industry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
started = performance.now(); db.exec("BEGIN IMMEDIATE")
try {
  for (const row of review.rows) {
    const record = row.record; const initials = record.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(); const year = Number(record.graduation_year); const source = `Institutional import · ${record.source_system}`
    insert.run(row.key, record.name, initials, year, year, record.programme, "Indian Institute of Management Lucknow", record.company, record.title || "Role not recorded", record.title || "", record.function || "Not assessed", record.seniority || "Not assessed", record.location || "Not recorded", record.previous_companies || "", Number(record.experience_years || 0), 50, record.email || "", record.phone || "", record.linkedin_url || "", "Imported claim · not independently verified", "Not contacted", record.note || "Synthetic validation record", "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", source, "Synthetic validation", source, record.source_date || "", record.industry || "")
  }
  db.exec("COMMIT")
} catch (error) { db.exec("ROLLBACK"); throw error }
const importMs = performance.now() - started
const persisted = db.prepare("SELECT count(*) AS count FROM alumni").get().count
const duplicateBefore = persisted; db.exec("BEGIN IMMEDIATE"); try { for (const row of review.rows) { const record = row.record; const year = Number(record.graduation_year); insert.run(row.key, record.name, "SA", year, year, record.programme, "Indian Institute of Management Lucknow", record.company, record.title || "Role not recorded", record.title || "", record.function || "Not assessed", record.seniority || "Not assessed", record.location || "Not recorded", record.previous_companies || "", Number(record.experience_years || 0), 50, record.email || "", "", record.linkedin_url || "", "Imported claim · not independently verified", "Not contacted", record.note || "", "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", `Institutional import · ${record.source_system}`, "Synthetic validation", `Institutional import · ${record.source_system}`, record.source_date || "", record.industry || "") } db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error }
const duplicateAfter = db.prepare("SELECT count(*) AS count FROM alumni").get().count

function timed(name, sql, params = []) { const samples = []; let rows = 0; for (let iteration = 0; iteration < 20; iteration += 1) { const begin = performance.now(); const result = db.prepare(sql).all(...params); samples.push(performance.now() - begin); rows = result.length } samples.sort((a, b) => a - b); return { name, rows, medianMs: Number(samples[9].toFixed(3)), p95Ms: Number(samples[18].toFixed(3)) } }
const queries = [
  timed("directory_initial", "SELECT id,name,programme,graduation_year,company,title,function,location FROM alumni ORDER BY name LIMIT 10"),
  timed("search_name", "SELECT id,name FROM alumni WHERE lower(name) LIKE ? ORDER BY name LIMIT 10", ["%synthetic alumnus 009%"]),
  timed("search_company", "SELECT id,name FROM alumni WHERE company = ? ORDER BY name LIMIT 10", ["Example Enterprise 001"]),
  timed("filter_function", "SELECT id,name FROM alumni WHERE function = ? ORDER BY name LIMIT 10", ["Strategy"]),
  timed("filter_year", "SELECT id,name FROM alumni WHERE graduation_year = ? ORDER BY name LIMIT 10", [2011]),
  timed("filter_programme", "SELECT id,name FROM alumni WHERE programme = ? ORDER BY name LIMIT 10", ["PGP"]),
  timed("combined_filters", "SELECT id,name FROM alumni WHERE programme = ? AND graduation_year BETWEEN ? AND ? AND company = ? ORDER BY name LIMIT 10", ["PGP", 2000, 2020, "Example Enterprise 001"]),
  timed("pagination", "SELECT id,name FROM alumni ORDER BY name LIMIT 10 OFFSET ?", [Math.max(0, count - 10)]),
  timed("company_associations", "SELECT company,count(*) AS alumni_count FROM alumni GROUP BY company ORDER BY alumni_count DESC,company LIMIT 10"),
  timed("profile_load", "SELECT * FROM alumni WHERE id = ? LIMIT 1", [Math.floor(count / 2)]),
]
const integrity = { alumni: persisted, distinctProfileKeys: db.prepare("SELECT count(DISTINCT profile_key) AS count FROM alumni").get().count, duplicateProfileKeys: db.prepare("SELECT count(*) AS count FROM (SELECT profile_key FROM alumni GROUP BY profile_key HAVING count(*) > 1)").get().count, foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length, idempotentCountBefore: duplicateBefore, idempotentCountAfter: duplicateAfter }
const report = { environment: { node: process.version, platform: process.platform, databasePath, migrations: migrations.length }, dataset: { count, seed: SYNTHETIC_SEED, csvBytes: Buffer.byteLength(csv), companies: new Set(records.map(row => row.company)).size, programmes: [...new Set(records.map(row => row.programme))] }, timings: { parseMs: Number(parseMs.toFixed(3)), validationMs: Number(validationMs.toFixed(3)), importMs: Number(importMs.toFixed(3)) }, memory: { heapBeforeBytes: memoryBefore, heapAfterBytes: process.memoryUsage().heapUsed, heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore }, preview: review.counts, integrity, queries, providerCalls: 0, canonicalProviderMutations: 0 }
await writeFile(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
await vite.close(); db.close()
