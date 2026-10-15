import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const mapping = await vite.ssrLoadModule("/lib/provider-company-mapping.ts")

function record(overrides = {}) {
  return {
    id: 1,
    normalizedCompanyKey: "lincoln international",
    displayName: "Lincoln International",
    provider: "coresignal",
    providerCompanyId: "8469989",
    status: "VERIFIED",
    mappingSource: "controlled live evidence",
    evidenceReference: "IIML 2011 + Lincoln diagnostic",
    providerSourceId: "22432",
    providerCompanyUrl: "https://www.linkedin.com/company/lincoln-international",
    verifiedBy: "Admin",
    verifiedAt: "2026-10-15T00:00:00.000Z",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...overrides,
  }
}

function store(rows) {
  return { async findByCompany() { return structuredClone(rows) } }
}

test("company normalization is conservative, case-insensitive, and whitespace-stable", () => {
  assert.equal(mapping.normalizeCompanyDisplayName("  Lincoln   International  "), "Lincoln International")
  assert.equal(mapping.normalizeCompanyKey("  LINCOLN   International  "), "lincoln international")
  assert.notEqual(mapping.normalizeCompanyKey("Lincoln-International"), mapping.normalizeCompanyKey("Lincoln International"))
  assert.notEqual(mapping.normalizeCompanyKey("Lincoln International Ltd."), mapping.normalizeCompanyKey("Lincoln International"))
})

test("resolver returns verified identity only for one valid verified mapping", async () => {
  const result = await mapping.resolveProviderCompanyMapping(" LINCOLN  INTERNATIONAL ", "Coresignal", store([record()]))
  assert.equal(result.state, "VERIFIED")
  assert.equal(result.providerCompanyId, 8469989)
  assert.equal(result.displayName, "Lincoln International")
})

test("resolver explicitly fails closed for missing, unverified, conflict, duplicate, and invalid IDs", async () => {
  assert.equal((await mapping.resolveProviderCompanyMapping("Missing Co", "Coresignal", store([]))).state, "MISSING")
  assert.equal((await mapping.resolveProviderCompanyMapping("Lincoln International", "Coresignal", store([record({ status: "UNVERIFIED", verifiedBy: "", verifiedAt: "" })]))).state, "UNVERIFIED")
  assert.equal((await mapping.resolveProviderCompanyMapping("Lincoln International", "Coresignal", store([record({ status: "CONFLICT" })]))).state, "CONFLICT")
  assert.equal((await mapping.resolveProviderCompanyMapping("Lincoln International", "Coresignal", store([record(), record({ id: 2 })]))).state, "CONFLICT")
  assert.equal((await mapping.resolveProviderCompanyMapping("Lincoln International", "Coresignal", store([record({ providerCompanyId: "invalid" })]))).state, "CONFLICT")
})

test("mapping input requires verified provider identity and supplies server verification metadata", () => {
  assert.throws(() => mapping.validateProviderCompanyMappingInput({ displayName: "Lincoln International", provider: "coresignal", providerCompanyId: "", status: "VERIFIED" }, "Admin", "now"), /requires a provider company ID/)
  assert.throws(() => mapping.validateProviderCompanyMappingInput({ displayName: "Lincoln International", provider: "coresignal", providerCompanyId: "company", status: "VERIFIED" }, "Admin", "now"), /positive safe integer/)
  const result = mapping.validateProviderCompanyMappingInput({ displayName: " Lincoln  International ", provider: "Coresignal", providerCompanyId: "8469989", status: "VERIFIED" }, "Admin User", "2026-10-15T00:00:00.000Z")
  assert.equal(result.normalizedCompanyKey, "lincoln international")
  assert.equal(result.verifiedBy, "Admin User")
  assert.equal(result.verifiedAt, "2026-10-15T00:00:00.000Z")
})

test("migration enforces mapping uniqueness and verified integrity without seeding data", async () => {
  const sql = await readFile(new URL("../drizzle/0013_cultured_james_howlett.sql", import.meta.url), "utf8")
  assert.match(sql, /CREATE TABLE `provider_company_mappings`/)
  assert.match(sql, /UNIQUE INDEX `idx_provider_company_mapping_company_provider`/)
  assert.match(sql, /UNIQUE INDEX `idx_provider_company_mapping_provider_id`[\s\S]*WHERE [^;]*provider_company_id[^;]*!= ''/)
  assert.match(sql, /provider_company_mapping_verified_check/)
  assert.match(sql, /verified_by/)
  assert.match(sql, /verified_at/)
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE [^_]|DELETE FROM|DROP TABLE)\b|Lincoln|8469989/i)
})

test("database constraints reject duplicate identities, duplicate provider IDs, and incomplete verification", async () => {
  const sql = await readFile(new URL("../drizzle/0013_cultured_james_howlett.sql", import.meta.url), "utf8")
  const db = new DatabaseSync(":memory:")
  try {
    for (const statement of sql.split("--> statement-breakpoint").map(item => item.trim()).filter(Boolean)) db.exec(statement)
    const insert = db.prepare(`
      insert into provider_company_mappings
        (normalized_company_key, display_name, provider, provider_company_id, status, mapping_source, evidence_reference, verified_by, verified_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run("lincoln international", "Lincoln International", "coresignal", "8469989", "VERIFIED", "controlled evidence", "diagnostic", "Admin", "2026-10-15T00:00:00.000Z")
    assert.throws(() => insert.run("lincoln international", "Lincoln International", "coresignal", "999", "VERIFIED", "controlled evidence", "diagnostic", "Admin", "2026-10-15T00:00:00.000Z"), /UNIQUE constraint failed/)
    assert.throws(() => insert.run("another company", "Another Company", "coresignal", "8469989", "VERIFIED", "controlled evidence", "diagnostic", "Admin", "2026-10-15T00:00:00.000Z"), /UNIQUE constraint failed/)
    assert.throws(() => insert.run("unverified evidence", "Unverified Evidence", "coresignal", "123", "VERIFIED", "", "", "", ""), /CHECK constraint failed/)
  } finally {
    db.close()
  }
})

test("Admin workflow is server-authorized and records meaningful before/after audit", async () => {
  const route = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
  const panel = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
  assert.match(route, /action === "upsert_provider_company_mapping"[\s\S]*authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(route, /provider_company_mapping_changed/)
  assert.match(route, /before, after/)
  assert.match(route, /provider_id_changed/)
  assert.match(route, /verification_performed/)
  assert.match(route, /mapping_invalidated/)
  assert.match(panel, /Provider company mappings/)
  assert.match(panel, /Name-only and fuzzy matching are not used/)
  assert.match(panel, /PCOM users cannot manage these mappings/)
})

test("normal product requests contain company names but never authoritative provider company IDs", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
  assert.match(page, /filters: \{ \.\.\.searchFilters/)
  assert.doesNotMatch(page, /providerCompanyId|companyId: 8469989/)
  assert.doesNotMatch(route, /payload\.(providerCompanyId|companyId)/)
  assert.match(route, /providerCompanyMappingStore\(db\)/)
  assert.match(route, /regular_search_preflight/)
})
