import assert from "node:assert/strict"
import test, { after } from "node:test"
import { createServer } from "vite"
import { DatabaseSync } from "node:sqlite"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const score = await vite.ssrLoadModule("/lib/placement-relevance.ts")
const selection = await vite.ssrLoadModule("/lib/cn-selection-contract.ts")
const sqlScore = await vite.ssrLoadModule("/lib/placement-relevance-sql.ts")
const evaluator = await vite.ssrLoadModule("/lib/intelligence-selection.server.ts")
const service = await vite.ssrLoadModule("/lib/intelligence-service.server.ts")
const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")

test("versioned CN placement score has the same declared components and does not score provisional intake", () => {
  const input = { hiringInfluence: "Strong hiring influence", seniority: "VP", company: "Example Co", companyPriority: "High Priority", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction", outreachStatus: "Contacted", events: [] }
  const result = score.calculatePlacementRelevance(input)
  assert.equal(result.version, "cn-placement-relevance-v1")
  assert.equal(result.score, Math.round(80 * .3 + 90 * .2 + 85 * .2 + 85 * .15 + 35 * .1 + 75 * .05))
  assert.equal(score.calculatePlacementRelevance({ ...input, intakeStatus: "PROVISIONAL" }).score, null)
  assert.equal(score.calculatePlacementRelevance({ ...input, company: "Lincoln International", seniority: "Director" }).items[1].score, 95)
})

test("CN selection contract keeps independent AND dimensions, OR lists and override safety", () => {
  const base = { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minPlacementRelevance: 75, minDataConfidence: 80, company: "Example Co", seniorities: ["VP", "Director"], programmes: ["PGP", "MBA"], graduationYearMode: "range", graduationYearStart: 2018, graduationYearEnd: 2022 }, includeCnAlumniIds: [1], excludeCnAlumniIds: [2] }
  const parsed = selection.parseCnSelectionContract(base)
  assert.deepEqual(parsed.criteria.seniorities, ["VP", "Director"])
  assert.deepEqual(parsed.criteria.programmes, ["PGP", "MBA"])
  assert.throws(() => selection.parseCnSelectionContract({ ...base, excludeCnAlumniIds: [1] }))
  assert.throws(() => selection.parseCnSelectionContract({ ...base, scoreVersion: "standalone-priority-v1" }))
  assert.throws(() => selection.parseCnSelectionContract({ ...base, criteria: { ...base.criteria, graduationYearStart: 2024 } }))
})

test("SQL Directory score equals UI score on synthetic verified and provisional rows", async () => {
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core")
  const dialect = new SQLiteSyncDialect()
  const compiled = dialect.sqlToQuery(sqlScore.placementRelevanceSql())
  // Directory selects the score and repeats it for the minimum-score filter.
  // Keep fixed scoring options out of the binding count for D1 execution.
  assert.ok(compiled.params.length * 2 + 10 < 100)
  const db = new DatabaseSync(":memory:")
  try {
    const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
    for (const name of migrations) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.prepare("insert into alumni (profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location,hiring_influence,iiml_relationship,warm_intro_potential,outreach_status,intake_status) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("synthetic:score", "Synthetic Person", "SP", 2020, "PGP", "Example Co", "VP", "Finance", "VP", "India", "Strong hiring influence", "Strong", "Can credibly provide introduction", "Contacted", "VERIFIED")
    db.prepare("insert into company_priorities (company,priority) values (?,?)").run("Example Co", "High Priority")
    const verified = db.prepare(`select ${compiled.sql} as value from alumni left join company_priorities on company_priorities.company = alumni.company where alumni.profile_key = ?`).get(...compiled.params, "synthetic:score")
    const pure = score.calculatePlacementRelevance({ hiringInfluence: "Strong hiring influence", seniority: "VP", company: "Example Co", companyPriority: "High Priority", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction", outreachStatus: "Contacted", events: [] })
    assert.equal(verified.value, pure.score)
    db.prepare("update alumni set intake_status='PROVISIONAL' where profile_key=?").run("synthetic:score")
    const provisional = db.prepare(`select ${compiled.sql} as value from alumni left join company_priorities on company_priorities.company = alumni.company where alumni.profile_key = ?`).get(...compiled.params, "synthetic:score")
    assert.equal(provisional.value, null)
  } finally { db.close() }
})

test("authoritative dynamic reevaluation updates membership and preserves overrides, identity state and deduplication", async () => {
  const rows = [
    { id: 1, relevance: 82, confidence: 90, intakeStatus: "VERIFIED", providerIdentityReady: true },
    { id: 2, relevance: 77, confidence: 84, intakeStatus: "VERIFIED", providerIdentityReady: false },
    { id: 3, relevance: null, confidence: 0, intakeStatus: "PROVISIONAL", providerIdentityReady: false },
  ]
  const pageSizes = []
  const query = async normalized => {
    pageSizes.push(normalized.pageSize)
    const f = normalized.filters
    const filtered = f.alumniIds.length ? rows.filter(row => f.alumniIds.includes(row.id)) : rows.filter(row => !f.excludeProvisional || row.intakeStatus !== "PROVISIONAL").filter(row => row.relevance !== null && row.relevance >= f.minRelevance)
    return { items: filtered, total: filtered.length, pageCount: 1 }
  }
  const contract = { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minPlacementRelevance: 75 }, includeCnAlumniIds: [2, 3], excludeCnAlumniIds: [1] }
  const first = await evaluator.evaluateCnSelection(contract, query)
  assert.deepEqual(first.members.map(row => row.cnAlumniId), [2, 3])
  assert.equal(first.identityReady, 0)
  assert.equal(first.pendingProviderMapping, 2)
  assert.equal(first.manuallyExcluded, 1)
  assert.equal(first.members.find(row => row.cnAlumniId === 3).placementRelevance, null)
  rows[1].relevance = 65
  const second = await evaluator.evaluateCnSelection(contract, query)
  assert.deepEqual(second.members.map(row => row.cnAlumniId), [2, 3])
  assert.equal(second.matchedBeforeOverrides, 1)
  assert.equal(second.manuallyIncluded, 2)
  assert.equal(new Set(second.members.map(row => row.cnAlumniId)).size, 2)
  assert.deepEqual(pageSizes, [20_001, 501, 20_001, 501])
})

test("unavailable cross-system configuration fails explicitly without a stale selection fallback", async () => {
  const oldUrl = process.env.INTELLIGENCE_SERVICE_URL
  const oldSecret = process.env.INTELLIGENCE_SERVICE_SECRET
  process.env.INTELLIGENCE_SERVICE_URL = ""
  process.env.INTELLIGENCE_SERVICE_SECRET = ""
  try {
    await assert.rejects(service.intelligenceRequest({ userId: 1, role: "ADMIN" }, "/v1/refresh/jobs"), /not configured/)
  } finally {
    if (oldUrl === undefined) delete process.env.INTELLIGENCE_SERVICE_URL
    else process.env.INTELLIGENCE_SERVICE_URL = oldUrl
    if (oldSecret === undefined) delete process.env.INTELLIGENCE_SERVICE_SECRET
    else process.env.INTELLIGENCE_SERVICE_SECRET = oldSecret
  }
})

test("isolated SQLite-backed D1 reevaluation uses current CN score, confidence and programme evidence", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
    for (const name of migrations) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    const insert = db.prepare("insert into alumni (profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location,confidence,hiring_influence,iiml_relationship,warm_intro_potential,intake_status) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    insert.run("synthetic:d1:1", "Synthetic One", "SO", 2020, 2020, "PGP", "Example Co", "VP", "Finance", "VP", "India", 90, "Direct hiring decision-maker", "Very strong", "Is the relevant decision-maker", "VERIFIED")
    insert.run("synthetic:d1:2", "Synthetic Two", "ST", 2021, 2021, "MBA", "Example Co", "Director", "Finance", "Director", "India", 90, "Direct hiring decision-maker", "Very strong", "Is the relevant decision-maker", "VERIFIED")
    db.prepare("insert into company_priorities (company,priority) values (?,?)").run("Example Co", "Tier 1 Strategic Target")
    cloudflare.env.DB = { prepare(statement) { return { bind(...values) { const query = db.prepare(statement); return { raw: async () => query.all(...values).map(Object.values), all: async () => ({ results: query.all(...values) }) } } } } }
    const contract = { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minPlacementRelevance: 75, minDataConfidence: 80, company: "Example Co", programmes: ["PGP", "MBA"], seniorities: ["VP", "Director"], graduationYearMode: "range", graduationYearStart: 2020, graduationYearEnd: 2021 } }
    const first = await evaluator.evaluateCnSelection(contract)
    assert.equal(first.selectedCount, 2)
    assert.equal(first.pendingProviderMapping, 2)
    db.prepare("update alumni set hiring_influence=?, iiml_relationship=?, warm_intro_potential=?, confidence=? where profile_key=?").run("No known hiring influence", "Minimal / record only", "No known route", 40, "synthetic:d1:2")
    const second = await evaluator.evaluateCnSelection(contract)
    assert.equal(second.selectedCount, 1)
    assert.equal(second.members[0].cnAlumniId, first.members[0].cnAlumniId)
  } finally { cloudflare.env.DB = undefined; db.close() }
})
