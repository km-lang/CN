import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const routing = await vite.ssrLoadModule("/lib/coresignal-search-routing.ts")

function headers(overrides = {}) {
  return { "x-total-results": "3", "x-total-pages": "1", ...overrides }
}

function fakeStore(rows = []) {
  const calls = []
  return {
    calls,
    async findMappings(employeeIds) {
      calls.push([...employeeIds])
      return structuredClone(rows.filter(row => employeeIds.includes(row.employeeId)))
    },
  }
}

test("documented regular Search ID page routes known and unknown identities", async () => {
  const store = fakeStore([
    { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://www.linkedin.com/in/alumnus-a" },
    { employeeId: "123456", alumnusId: 12, linkedinUrl: "https://www.linkedin.com/in/alumnus-b" },
  ])
  const plan = await routing.planCoresignalRegularSearchRouting([1696198, 289351894, 123456], headers(), store)

  assert.deepEqual(plan.routes.map(route => [route.employeeId, route.routingState]), [
    ["123456", "IDENTITY_RESOLVED"],
    ["1696198", "IDENTITY_RESOLVED"],
    ["289351894", "IDENTITY_RESOLUTION_REQUIRED"],
  ])
  assert.deepEqual(plan.summary, {
    identityResolved: 2,
    identityResolutionRequired: 1,
    identityReviewRequired: 0,
    providerIdentityResolutionOperationsPotentiallyAvoidable: 2,
    profilesRequiringFurtherResolution: 1,
  })
})

test("duplicate provider IDs retain raw page count but create one route per identity", async () => {
  const store = fakeStore([{ employeeId: "1696198", alumnusId: 11, linkedinUrl: "" }])
  const plan = await routing.planCoresignalRegularSearchRouting([1696198, 1696198, 289351894], headers(), store)
  assert.equal(plan.providerSearch.pageIdsReceived, 3)
  assert.equal(plan.providerSearch.uniquePageIds, 2)
  assert.equal(plan.routes.length, 2)
  assert.deepEqual(store.calls, [["1696198", "289351894"]])
})

test("malformed body IDs and response shapes fail before database lookup", async () => {
  for (const body of [[1696198, "garbage"], { ids: [1696198] }, null]) {
    const store = fakeStore()
    await assert.rejects(
      routing.planCoresignalRegularSearchRouting(body, headers(), store),
      error => error.name === "CoresignalRegularSearchResponseError",
    )
    assert.equal(store.calls.length, 0)
  }
})

test("malformed supplied total and pagination headers fail before database lookup", async () => {
  const invalidHeaders = [
    null,
    { "x-total-results": "three", "x-total-pages": "1" },
    { "x-total-results": "1", "x-total-pages": "-1" },
    { "x-total-results": "1", "x-total-pages": "0" },
    { "x-total-results": "1", "x-total-pages": "1", "x-next-page-after": "" },
  ]
  for (const responseHeaders of invalidHeaders) {
    const store = fakeStore()
    await assert.rejects(routing.planCoresignalRegularSearchRouting([1696198], responseHeaders, store), /Coresignal regular Search/)
    assert.equal(store.calls.length, 0)
  }
})

test("missing optional provider headers remain distinct from numeric zero", async () => {
  const missing = await routing.planCoresignalRegularSearchRouting([], {}, fakeStore())
  assert.equal(missing.providerSearch.totalResults, null)
  assert.equal(missing.providerSearch.totalPages, null)
  assert.equal(missing.providerSearch.nextPageAfter, null)
  const zero = await routing.planCoresignalRegularSearchRouting([], { "x-total-results": "0", "x-total-pages": "0" }, fakeStore())
  assert.equal(zero.providerSearch.totalResults, 0)
  assert.equal(zero.providerSearch.totalPages, 0)
})

test("documented empty page produces a valid empty plan and zero database operations", async () => {
  const store = fakeStore()
  const plan = await routing.planCoresignalRegularSearchRouting([], headers({ "x-total-results": "0", "x-total-pages": "0" }), store)
  assert.deepEqual(plan.routes, [])
  assert.equal(plan.providerSearch.pageIdsReceived, 0)
  assert.equal(plan.providerSearch.uniquePageIds, 0)
  assert.equal(plan.summary.identityResolved, 0)
  assert.equal(plan.summary.identityResolutionRequired, 0)
  assert.equal(store.calls.length, 0)
})

test("total provider matches remain distinct from current-page identities", async () => {
  const ids = Array.from({ length: 20 }, (_, index) => index + 1)
  const plan = await routing.planCoresignalRegularSearchRouting(ids, headers({
    "x-total-results": "500",
    "x-total-pages": "25",
    "x-next-page-after": '"2026-10-13",20',
  }), fakeStore())
  assert.equal(plan.providerSearch.totalResults, 500)
  assert.equal(plan.providerSearch.pageIdsReceived, 20)
  assert.equal(plan.providerSearch.uniquePageIds, 20)
  assert.equal(plan.routes.length, 20)
  assert.equal(plan.providerSearch.totalPages, 25)
  assert.equal(plan.providerSearch.nextPageAfter, '"2026-10-13",20')
})

test("known identity never claims profile freshness or skips all provider work", async () => {
  const plan = await routing.planCoresignalRegularSearchRouting([1696198], headers({ "x-total-results": "1" }), fakeStore([
    { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://linkedin.com/in/alumnus-a" },
  ]))
  const route = plan.routes[0]
  assert.equal(route.routingState, "IDENTITY_RESOLVED")
  assert.equal(route.identityResolutionRequired, false)
  assert.equal(route.nextProviderAction, "NOT_NEEDED_FOR_IDENTITY")
  assert.equal(route.profileFreshness, "NOT_EVALUATED")
  assert.doesNotMatch(JSON.stringify(route), /PROFILE_CURRENT|NO_REFRESH_NEEDED|SKIP_ALL_PROVIDER_WORK/)
})

test("unknown identity is unresolved with provider action undecided, never a new alumnus", async () => {
  const plan = await routing.planCoresignalRegularSearchRouting([289351894], headers({ "x-total-results": "1" }), fakeStore())
  const route = plan.routes[0]
  assert.equal(route.routingState, "IDENTITY_RESOLUTION_REQUIRED")
  assert.equal(route.nextProviderAction, "UNDECIDED")
  assert.equal(route.profileFreshness, "NOT_EVALUATED")
  assert.doesNotMatch(JSON.stringify(route), /NEW_CANDIDATE|CREATE_ALUMNUS|COLLECT_REQUIRED|PREVIEW_REQUIRED/)
})

test("routing is read-only, provider-free, and used only through the gated regular Search runtime", async () => {
  const responseParser = await readFile(new URL("../lib/coresignal-regular-search-response.ts", import.meta.url), "utf8")
  const planner = await readFile(new URL("../lib/coresignal-search-routing.ts", import.meta.url), "utf8")
  const runtime = await readFile(new URL("../lib/coresignal-regular-search.ts", import.meta.url), "utf8")
  const alumnus = { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://linkedin.com/in/a", name: "A", company: "Existing", title: "Director", pdlPersonId: "pdl", lushaPersonId: "lusha" }
  const before = structuredClone(alumnus)
  await routing.planCoresignalRegularSearchRouting([1696198], headers({ "x-total-results": "1" }), fakeStore([alumnus]))
  assert.deepEqual(alumnus, before)
  for (const source of [responseParser, planner]) {
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|fetch\(|attachCoresignalIdentity|providerResponseHistory|fieldChangeHistory|writeSecurityAudit/)
    assert.doesNotMatch(source, /\b(?:Bright|PDL|Lusha|Socai|Signals|Gmail|webhook)\b/i)
  }
  assert.match(runtime, /planCoresignalRegularSearchRouting/)
  assert.doesNotMatch(runtime, /\.insert\(|\.update\(|\.delete\(|attachCoresignalIdentity|fieldChangeHistory|writeSecurityAudit/)
})
