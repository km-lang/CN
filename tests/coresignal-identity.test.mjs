import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const identity = await vite.ssrLoadModule("/lib/coresignal-identity.ts")
const reconciliation = await vite.ssrLoadModule("/lib/discovery-reconciliation.ts")
const capabilities = await vite.ssrLoadModule("/lib/discovery-provider-capabilities.ts")

function fakeStore(initial, options = {}) {
  const rows = structuredClone(initial)
  const evidence = []
  let writes = 0
  return {
    rows,
    evidence,
    get writes() { return writes },
    async loadAlumni() { return structuredClone(rows) },
    async attachIfUnassigned(alumnusId, providerId) {
      if (options.uniqueConflict) {
        options.onConflict?.(rows)
        throw new Error("UNIQUE constraint failed: alumni.coresignal_employee_id")
      }
      const row = rows.find(person => person.id === alumnusId)
      if (!row || row.coresignalEmployeeId) return false
      row.coresignalEmployeeId = providerId
      writes += 1
      return true
    },
    async recordEvidence(value) { evidence.push(value) },
    isUniqueConflict(error) { return /unique constraint failed/i.test(String(error)) },
  }
}

const input = (overrides = {}) => ({
  coresignalEmployeeId: "1696198",
  profileUrl: "https://www.linkedin.com/in/alumnus-a/?trk=provider",
  source: "external_discovery:42",
  actor: "Test operator",
  discoveryResultId: 101,
  ...overrides,
})

test("known provider ID returns KNOWN_PROVIDER_ID without a duplicate write", async () => {
  const store = fakeStore([{ id: 1, coresignalEmployeeId: "1696198", linkedinUrl: "https://linkedin.com/in/alumnus-a" }])
  const result = await identity.attachCoresignalIdentity(input({ expectedAlumnusId: 1 }), store)
  assert.equal(result.outcome, "KNOWN_PROVIDER_ID")
  assert.equal(result.wroteIdentity, false)
  assert.equal(store.writes, 0)
})

test("new provider ID attaches only to one exact normalized LinkedIn match", async () => {
  const original = { id: 1, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/alumnus-a", name: "Alumnus A", company: "Existing Co", title: "Existing title", graduationYear: 2012 }
  const store = fakeStore([original])
  const result = await identity.attachCoresignalIdentity(input({ expectedAlumnusId: 1 }), store)
  assert.equal(result.outcome, "ATTACHED_PROVIDER_ID")
  assert.equal(result.wroteIdentity, true)
  assert.equal(store.rows[0].coresignalEmployeeId, "1696198")
  assert.deepEqual({ ...store.rows[0], coresignalEmployeeId: "" }, original)
  assert.equal(store.evidence[0].matchingMethod, "LINKEDIN_URL")
})

test("known ID and URL pointing to another alumnus returns CONFLICT without mutation", async () => {
  const rows = [
    { id: 1, coresignalEmployeeId: "1696198", linkedinUrl: "https://linkedin.com/in/alumnus-a" },
    { id: 2, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/alumnus-b" },
  ]
  const store = fakeStore(rows)
  const result = await identity.attachCoresignalIdentity(input({ profileUrl: rows[1].linkedinUrl, expectedAlumnusId: 1 }), store)
  assert.equal(result.outcome, "CONFLICT")
  assert.equal(store.writes, 0)
  assert.match(result.rationale, /different alumni/)
})

test("known ID retains identity when URL changes and records review evidence", async () => {
  const store = fakeStore([{ id: 1, coresignalEmployeeId: "1696198", linkedinUrl: "https://linkedin.com/in/old-url" }])
  const result = await identity.attachCoresignalIdentity(input({ profileUrl: "https://linkedin.com/in/new-url", expectedAlumnusId: 1 }), store)
  assert.equal(result.outcome, "KNOWN_PROVIDER_ID")
  assert.equal(result.evidenceReviewRequired, true)
  assert.equal(store.rows[0].linkedinUrl, "https://linkedin.com/in/old-url")
  assert.equal(store.writes, 0)
  assert.equal(store.evidence[0].profileUrl, "https://linkedin.com/in/new-url")
})

test("unknown ID and unknown URL remains NEW_CANDIDATE and never creates an alumnus", async () => {
  const store = fakeStore([{ id: 1, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/someone-else" }])
  const result = await identity.attachCoresignalIdentity(input({ profileUrl: "https://linkedin.com/in/unknown" }), store)
  assert.equal(result.outcome, "NEW_CANDIDATE")
  assert.equal(store.rows.length, 1)
  assert.equal(store.writes, 0)
})

test("ambiguous normalized URL requires identity review", async () => {
  const store = fakeStore([
    { id: 1, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/shared" },
    { id: 2, coresignalEmployeeId: "", linkedinUrl: "https://www.linkedin.com/in/shared/?trk=duplicate" },
  ])
  const result = await identity.attachCoresignalIdentity(input({ profileUrl: "https://linkedin.com/in/shared" }), store)
  assert.equal(result.outcome, "IDENTITY_REVIEW_REQUIRED")
  assert.equal(store.writes, 0)
})

test("name-only evidence never attaches a provider identity", async () => {
  const store = fakeStore([{ id: 1, name: "Same Name", coresignalEmployeeId: "", linkedinUrl: "" }])
  const result = await identity.attachCoresignalIdentity(input({ profileUrl: "", name: "Same Name" }), store)
  assert.equal(result.outcome, "NEW_CANDIDATE")
  assert.equal(store.writes, 0)
})

test("unique-index races become a controlled conflict instead of a raw database error", async () => {
  const store = fakeStore([{ id: 1, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/alumnus-a" }, { id: 2, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/alumnus-b" }], {
    uniqueConflict: true,
    onConflict(rows) { rows[1].coresignalEmployeeId = "1696198" },
  })
  const result = await identity.attachCoresignalIdentity(input({ expectedAlumnusId: 1 }), store)
  assert.equal(result.outcome, "CONFLICT")
  assert.equal(store.writes, 0)
  assert.equal(store.evidence.at(-1).outcome, "CONFLICT")
})

test("discovery reconciliation does not hide a provider-ID/profile-URL conflict", () => {
  const result = reconciliation.reconcileDiscoveryCandidate({ candidateKey: "candidate", providerEmployeeId: "1696198", profileUrl: "https://linkedin.com/in/alumnus-b" }, [
    { id: 1, coresignalEmployeeId: "1696198", linkedinUrl: "https://linkedin.com/in/alumnus-a", name: "A" },
    { id: 2, coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/alumnus-b", name: "B" },
  ], [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.equal(result.classification, "AMBIGUOUS")
  assert.equal(result.reasonCode, "PROVIDER_ID_PROFILE_CONFLICT")
})

test("migration enforces one non-empty ID while retaining empty-string unassigned rows", async () => {
  const migration = await readFile(new URL("../drizzle/0012_superb_wildside.sql", import.meta.url), "utf8")
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("CREATE TABLE alumni (id INTEGER PRIMARY KEY, coresignal_employee_id TEXT NOT NULL DEFAULT '')")
    db.exec(migration)
    db.exec("INSERT INTO alumni (id) VALUES (1), (2)")
    db.exec("INSERT INTO alumni (id, coresignal_employee_id) VALUES (3, '1696198'), (4, 'other-id')")
    assert.throws(() => db.exec("INSERT INTO alumni (id, coresignal_employee_id) VALUES (5, '1696198')"), /UNIQUE constraint failed/)
    assert.equal(db.prepare("SELECT count(*) AS count FROM alumni WHERE coresignal_employee_id = ''").get().count, 2)
    assert.equal(db.prepare("SELECT count(*) AS count FROM alumni WHERE coresignal_employee_id != ''").get().count, 2)
  } finally {
    db.close()
  }
})

test("runtime Coresignal identity writes are routed through the shared boundary", async () => {
  const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
  const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
  const adminRoute = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
  const store = await readFile(new URL("../lib/coresignal-identity-store.ts", import.meta.url), "utf8")
  assert.doesNotMatch(discoveryRoute, /\.\.\.\(isCoresignal\s*\?\s*\{\s*coresignalEmployeeId/)
  assert.match(discoveryRoute, /attachCoresignalIdentity/)
  assert.match(enrichmentRoute, /attachCoresignalIdentity/)
  assert.match(adminRoute, /coresignalEmployeeId:\s*""/)
  assert.match(store, /db\.batch\(\[updateIdentity, insertHistory\]\)/)
  assert.match(store, /eq\(alumni\.coresignalEmployeeId, ""\)/)
  assert.match(store, /changes\(\) = 1/)
  assert.match(store, /fieldChangeHistory/)
  assert.match(store, /writeSecurityAudit/)
})
