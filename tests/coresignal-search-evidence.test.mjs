import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const evidenceModule = await vite.ssrLoadModule("/lib/coresignal-search-evidence.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")

function execution(overrides = {}) {
  return {
    operation: "Base Employee ES-DSL Search",
    operationContext: "External Discovery · IIM Lucknow · exact graduation year 2011 · current company Lincoln International",
    requestAttempts: 1,
    previewRequests: 0,
    collectRequests: 0,
    automaticPagination: false,
    searchMode: "CURRENT_COMPANY_EXACT_GRADUATION_YEAR",
    companyMapping: { state: "VERIFIED", displayName: "Lincoln International", normalizedCompanyKey: "lincoln international", providerCompanyId: 8469989 },
    providerCreditsRemaining: 4950,
    upstreamHttpStatus: 200,
    routing: {
      providerSearch: { totalResults: 1, pageIdsReceived: 1, uniquePageIds: 1, totalPages: 1, nextPageAfter: "289351894" },
      routes: [{ employeeId: "289351894", routingState: "IDENTITY_RESOLUTION_REQUIRED", mappedAlumnusId: null, canonicalLinkedinUrl: null, identityResolutionRequired: true, nextProviderAction: "UNDECIDED", profileFreshness: "NOT_EVALUATED", reason: "No durable mapping." }],
      summary: { identityResolved: 0, identityResolutionRequired: 1, identityReviewRequired: 0, providerIdentityResolutionOperationsPotentiallyAvoidable: 0, profilesRequiringFurtherResolution: 1 },
    },
    ...overrides,
  }
}

function evidence(overrides = {}) {
  return evidenceModule.createCoresignalSearchEvidence({
    attemptId: "attempt-0001",
    filters: { ...search.defaultDiscoveryFilters(), company: "Lincoln International", graduationYear: "2011" },
    institutionId: 25919228,
    itemsPerPage: 1,
    requestedAt: "2026-10-15T08:00:00.000Z",
    completedAt: "2026-10-15T08:00:01.000Z",
    execution: execution(overrides),
  })
}

test("mocked Search evidence retains only bounded IDs, headers, routing, status, accounting, and audit metadata", () => {
  const retained = evidence()
  assert.deepEqual(retained.employeeIds, ["289351894"])
  assert.equal(retained.upstreamHttpStatus, 200)
  assert.equal(retained.totalResults, 1)
  assert.equal(retained.totalPages, 1)
  assert.equal(retained.nextPageAfter, "289351894")
  assert.equal(retained.creditsRemaining, 4950)
  assert.equal(retained.identityRoutes[0].routingState, "IDENTITY_RESOLUTION_REQUIRED")
  assert.equal(retained.profileFreshness, "NOT_EVALUATED")
  assert.deepEqual(retained.applicationAccounting, { applicationUnits: 1, providerRequestCost: "UNRESOLVED" })
  assert.deepEqual(retained.providerActions, { searchRequests: 1, previewRequests: 0, collectRequests: 0, automaticPagination: false, canonicalMutations: 0 })
  assert.equal(retained.searchParameters.institutionId, 25919228)
  assert.equal(retained.searchParameters.mappedCompanyId, 8469989)
})

test("serialized evidence round-trips through one Provider History response summary without sensitive or profile payload fields", () => {
  const summary = evidenceModule.serializeCoresignalSearchEvidence("One Search request succeeded.", evidence())
  const presented = evidenceModule.presentProviderHistorySearchEvidence({ provider: "coresignal", operation: "Base Employee ES-DSL Search", status: "success", responseSummary: summary })
  assert.equal(presented.responseSummary, "One Search request succeeded.")
  assert.equal(presented.searchEvidence.state, "RETAINED")
  assert.equal(presented.searchEvidence.evidence.employeeIds[0], "289351894")
  assert.doesNotMatch(summary, /apikey|authorization|secret|rawResponse|education|experience|profileUrl|linkedin/i)
})

test("missing provider headers remain null while zero remains zero", () => {
  const missing = evidence({ providerCreditsRemaining: null, routing: { ...execution().routing, providerSearch: { ...execution().routing.providerSearch, totalResults: null, totalPages: null, nextPageAfter: null } } })
  assert.equal(missing.totalResults, null)
  assert.equal(missing.totalPages, null)
  assert.equal(missing.creditsRemaining, null)
  const zero = evidence({ routing: { ...execution().routing, providerSearch: { ...execution().routing.providerSearch, totalResults: 0, pageIdsReceived: 0, uniquePageIds: 0, totalPages: 0, nextPageAfter: null }, routes: [] } })
  assert.equal(zero.totalResults, 0)
  assert.equal(zero.totalPages, 0)
  assert.equal(zero.returnedCount, 0)
})

test("evidence rejects returned IDs beyond the authorized page-size bound", () => {
  assert.throws(() => evidence({ routing: { ...execution().routing, providerSearch: { ...execution().routing.providerSearch, totalResults: 2, pageIdsReceived: 2, uniquePageIds: 2 }, routes: [
    execution().routing.routes[0],
    { ...execution().routing.routes[0], employeeId: "1696198" },
  ] } }), /returnedCount is invalid|authorized Search page-size bound/)
})

test("historical successful Search without an envelope is explicitly not retained and never backfilled", () => {
  const row = evidenceModule.presentProviderHistorySearchEvidence({ provider: "coresignal", operation: "Base Employee ES-DSL Search", status: "success", responseSummary: "One Search request succeeded. 1 IDs returned." })
  assert.deepEqual(row.searchEvidence, { state: "NOT_RETAINED", reason: "Employee ID and pagination evidence was not retained for this historical Search." })
  assert.doesNotMatch(JSON.stringify(row), /289351894/)
})

test("evidence persistence failure is explicit and never re-executes the provider operation", async () => {
  let providerCalls = 0
  let persistenceCalls = 0
  await assert.rejects(evidenceModule.executeAndPersistCoresignalSearchEvidence({
    execute: async () => { providerCalls += 1; return execution() },
    createEvidence: result => ({ status: result.upstreamHttpStatus }),
    persist: async () => { persistenceCalls += 1; throw new Error("synthetic storage failure") },
  }), error => error.name === "CoresignalSearchEvidencePersistenceError" && error.providerCallMade === true && error.applicationUnits === 1 && error.retryAllowed === false && !error.message.includes("synthetic storage failure"))
  assert.equal(providerCalls, 1)
  assert.equal(persistenceCalls, 1)
})

test("Search evidence remains behind Admin RBAC with no Collect or canonical mutation path", async () => {
  const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
  const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
  assert.match(discoveryRoute, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(enrichmentRoute, /context\.role === "ADMIN" \? history\.map\(presentProviderHistorySearchEvidence\)\.map\(presentProviderHistoryCollectEvidence\)\.map\(item =>/)
  assert.match(enrichmentRoute, /\}\) : \[\],\s*historyRestricted: context\.role !== "ADMIN"/)
  assert.match(page, /session\.canAdminister \? <section className="panel history-panel"/)
  assert.match(page, /<ProviderHistoryAudit items=\{providerHistoryPagination\.items\}/)
  assert.match(page, /item\.searchEvidence\?\.state === "RETAINED"/)
  assert.match(page, /View returned Employee IDs/)
  assert.match(page, /Search 1 · Preview 0 · Collect 0/)
  assert.match(page, /No pagination or canonical mutation/)
  assert.match(discoveryRoute, /failure\.kind === "timeout" \? "AMBIGUOUS" : "FAILED"/)
  assert.match(discoveryRoute, /reason: "evidence_persistence_failed"[\s\S]*?applicationUnits: error\.applicationUnits[\s\S]*?retryAllowed: error\.retryAllowed/)
  assert.match(discoveryRoute, /applicationUnits: 1,[\s\S]*?responseSummary: serializeCoresignalSearchEvidence/)
  assert.match(styles, /\.search-evidence-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.search-evidence-grid \{ grid-template-columns: 1fr; \}/)
  assert.doesNotMatch(await readFile(new URL("../lib/coresignal-search-evidence.ts", import.meta.url), "utf8"), /fetch\(|attachCoresignalIdentity|\.insert\(|\.update\(|\.delete\(/)
})
