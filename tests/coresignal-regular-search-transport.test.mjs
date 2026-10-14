import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after, beforeEach } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const runtime = await vite.ssrLoadModule("/lib/coresignal-regular-search.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const providerRuntime = await vite.ssrLoadModule("/lib/provider-runtime.ts")

const original = {
  CORESIGNAL_API_KEY: process.env.CORESIGNAL_API_KEY,
  CORESIGNAL_LIVE_ENABLED: process.env.CORESIGNAL_LIVE_ENABLED,
  CORESIGNAL_SEARCH_ENABLED: process.env.CORESIGNAL_SEARCH_ENABLED,
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_DEV_AUTH_ENABLED: process.env.LOCAL_DEV_AUTH_ENABLED,
}

after(async () => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await vite.close()
})

beforeEach(() => {
  process.env.NODE_ENV = "test"
  delete process.env.LOCAL_DEV_AUTH_ENABLED
  process.env.CORESIGNAL_API_KEY = "test-secret-never-return"
  process.env.CORESIGNAL_LIVE_ENABLED = "true"
  process.env.CORESIGNAL_SEARCH_ENABLED = "true"
})

function filters() {
  return { ...search.defaultDiscoveryFilters(), graduationYear: "2013" }
}

function mappingStore(rows = []) {
  return { async findMappings(ids) { return structuredClone(rows.filter(row => ids.includes(row.employeeId))) } }
}

function response(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-total-results": "3", "x-total-pages": "1", ...headers } })
}

test("one ES-DSL request uses apikey auth, JSON headers, exact contract, and preserves documented response metadata", async () => {
  const calls = []
  const contract = client.coresignalExactYearEsDslSearchContract(filters(), { itemsPerPage: 3 })
  const result = await client.searchCoresignalEmployeeIds(contract.body, {
    itemsPerPage: 3,
    operationContext: "provider-free test",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init })
      return response([1696198, 289351894, 123456], { "x-credits-remaining": "4950" })
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://api.coresignal.com/cdapi/v2/employee_base/search/es_dsl?items_per_page=3")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.headers.apikey, "test-secret-never-return")
  assert.equal(calls[0].init.headers.accept, "application/json")
  assert.equal(calls[0].init.headers["content-type"], "application/json")
  assert.doesNotMatch(JSON.stringify(result), /test-secret-never-return/)
  assert.equal(result.providerCreditsRemaining, 4950)
  assert.deepEqual(result.body, [1696198, 289351894, 123456])
})

test("transport, parser, dedupe, and routing handle known and unknown IDs end to end", async () => {
  let calls = 0
  const result = await runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 3, operationContext: "routing test", confirmed: true }, {
    searchEnabled: () => true,
    transport: async () => {
      calls += 1
      return { body: [1696198, 289351894, 123456], headers: { "x-total-results": "3", "x-total-pages": "1", "x-next-page-after": null }, providerCreditsRemaining: 4950 }
    },
    store: mappingStore([
      { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://linkedin.com/in/a" },
      { employeeId: "123456", alumnusId: 12, linkedinUrl: "https://linkedin.com/in/b" },
    ]),
  })
  assert.equal(calls, 1)
  assert.deepEqual(result.routing.routes.map(route => [route.employeeId, route.routingState, route.profileFreshness, route.nextProviderAction]), [
    ["123456", "IDENTITY_RESOLVED", "NOT_EVALUATED", "NOT_NEEDED_FOR_IDENTITY"],
    ["1696198", "IDENTITY_RESOLVED", "NOT_EVALUATED", "NOT_NEEDED_FOR_IDENTITY"],
    ["289351894", "IDENTITY_RESOLUTION_REQUIRED", "NOT_EVALUATED", "UNDECIDED"],
  ])
  assert.equal(result.previewRequests, 0)
  assert.equal(result.collectRequests, 0)
  assert.equal(result.automaticPagination, false)
})

test("institution-only runtime makes one mocked Search with no year predicate", async () => {
  let calls = 0
  let requestBody
  const institutionOnly = { ...search.defaultDiscoveryFilters(), graduationYear: "" }
  const result = await runtime.executeCoresignalRegularSearch({ filters: institutionOnly, itemsPerPage: 1, operationContext: "institution-only test", confirmed: true }, {
    searchEnabled: () => true,
    transport: async body => {
      calls += 1
      requestBody = body
      return { body: [1696198], headers: { "x-total-results": "1", "x-total-pages": "1", "x-next-page-after": null }, providerCreditsRemaining: null }
    },
    store: mappingStore(),
  })
  assert.equal(calls, 1)
  assert.equal(result.searchMode, "INSTITUTION_ONLY")
  assert.doesNotMatch(JSON.stringify(requestBody), /education\.date_to_year/)
  assert.match(JSON.stringify(requestBody), /education\.institution_url/)
  assert.equal(result.previewRequests, 0)
  assert.equal(result.collectRequests, 0)
})

test("exact-year runtime includes the year predicate in the mocked Search request", async () => {
  let requestBody
  const result = await runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 1, operationContext: "exact-year test", confirmed: true }, {
    searchEnabled: () => true,
    transport: async body => {
      requestBody = body
      return { body: [], headers: { "x-total-results": "0", "x-total-pages": "0", "x-next-page-after": null }, providerCreditsRemaining: null }
    },
    store: mappingStore(),
  })
  assert.equal(result.searchMode, "EXACT_GRADUATION_YEAR")
  assert.match(JSON.stringify(requestBody), /education\.date_to_year/)
  assert.match(JSON.stringify(requestBody), /2013/)
})

test("an observed-shape empty 200 response is valid and has no follow-on action", async () => {
  const result = await runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 1, operationContext: "empty test", confirmed: true }, {
    searchEnabled: () => true,
    transport: async () => ({ body: [], headers: { "x-total-results": "0", "x-total-pages": "0", "x-next-page-after": null }, providerCreditsRemaining: 4950 }),
    store: mappingStore(),
  })
  assert.deepEqual(result.routing.routes, [])
  assert.equal(result.routing.providerSearch.totalResults, 0)
  assert.equal(result.previewRequests + result.collectRequests, 0)
})

test("400, 401, 402, 403, 429, 500, and network failures make one attempt with zero retry", async () => {
  for (const status of [400, 401, 402, 403, 429, 500]) {
    let calls = 0
    const contract = client.coresignalExactYearEsDslSearchContract(filters())
    await assert.rejects(client.searchCoresignalEmployeeIds(contract.body, {
      itemsPerPage: 1,
      operationContext: `failure ${status}`,
      fetcher: async () => { calls += 1; return new Response("{}", { status }) },
    }), error => error instanceof client.CoresignalProviderError && !error.message.includes("test-secret-never-return"))
    assert.equal(calls, 1, `HTTP ${status}`)
  }
  let networkCalls = 0
  const contract = client.coresignalExactYearEsDslSearchContract(filters())
  await assert.rejects(client.searchCoresignalEmployeeIds(contract.body, {
    itemsPerPage: 1,
    operationContext: "network failure",
    fetcher: async () => { networkCalls += 1; throw new Error("contains test-secret-never-return") },
  }), error => error.kind === "unavailable" && !error.message.includes("test-secret-never-return"))
  assert.equal(networkCalls, 1)
})

test("disabled gate and missing confirmation stop before transport", async () => {
  let calls = 0
  const dependencies = { searchEnabled: () => false, transport: async () => { calls += 1; throw new Error("must not run") }, store: mappingStore() }
  await assert.rejects(runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 1, operationContext: "disabled", confirmed: true }, dependencies), /disabled/)
  assert.equal(calls, 0)
  await assert.rejects(runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 1, operationContext: "unconfirmed", confirmed: false }, { ...dependencies, searchEnabled: () => true }), /confirmation/)
  assert.equal(calls, 0)
})

test("runtime never follows continuation metadata or performs automatic pagination", async () => {
  let calls = 0
  const result = await runtime.executeCoresignalRegularSearch({ filters: filters(), itemsPerPage: 1, operationContext: "page cap", confirmed: true }, {
    searchEnabled: () => true,
    transport: async () => {
      calls += 1
      return { body: [1696198], headers: { "x-total-results": "500", "x-total-pages": "20", "x-next-page-after": "opaque-cursor" }, providerCreditsRemaining: null }
    },
    store: mappingStore(),
  })
  assert.equal(calls, 1)
  assert.equal(result.requestAttempts, 1)
  assert.equal(result.routing.providerSearch.totalPages, 20)
  assert.equal(result.routing.providerSearch.nextPageAfter, "opaque-cursor")
  assert.equal(result.automaticPagination, false)
})

test("server gate is fail-closed and normal local development explicitly keeps Search off", async () => {
  delete process.env.CORESIGNAL_SEARCH_ENABLED
  assert.equal(providerRuntime.coresignalRegularSearchEnabled(), false)
  process.env.CORESIGNAL_SEARCH_ENABLED = "false"
  assert.equal(providerRuntime.coresignalRegularSearchEnabled(), false)
  process.env.CORESIGNAL_SEARCH_ENABLED = "true"
  assert.equal(providerRuntime.coresignalRegularSearchEnabled(), true)
  process.env.CORESIGNAL_LIVE_ENABLED = "false"
  assert.equal(providerRuntime.coresignalRegularSearchEnabled(), false)

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8")
  assert.match(packageJson.scripts["dev:local"], /CORESIGNAL_SEARCH_ENABLED=false/)
  assert.match(envExample, /^CORESIGNAL_SEARCH_ENABLED=false$/m)
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_CORESIGNAL_SEARCH/)
})

test("runtime and UI integration preserve canonical immutability and explicit operation boundaries", async () => {
  const orchestration = await readFile(new URL("../lib/coresignal-regular-search.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(orchestration, /\.insert\(|\.update\(|\.delete\(|attachCoresignalIdentity|fieldChangeHistory/)
  assert.match(route, /action === "regular_search"/)
  assert.match(route, /operation: "Base Employee ES-DSL Search"/)
  assert.match(route, /invalid_graduation_year/)
  assert.doesNotMatch(route, /exact_year_required/)
  assert.match(page, /Confirm One Search Request/)
  assert.match(page, /All years — not constrained/)
  assert.match(page, /<span>Search mode<\/span><strong>\{pendingRegularSearchFilters\?\.graduationYear \? "Exact graduation year" : "Institution only"\}<\/strong>/)
  assert.match(page, /<span>Company<\/span><strong>Not constrained<\/strong>/)
  assert.match(page, /<span>Programme<\/span><strong>Not constrained<\/strong>/)
  assert.match(page, /<span>Seniority<\/span><strong>Not constrained by provider Search<\/strong>/)
  assert.match(page, /IIM Lucknow institution only/)
  assert.match(page, /IIM Lucknow \+ exact education end year/)
  assert.match(page, /<span>Page size<\/span><strong>\{discoveryLimit\}<\/strong>/)
  assert.match(page, /No downstream provider action is automatic/)
  assert.match(page, /graduationYear: searchFilters\.graduationYear \|\| undefined/)
  assert.match(page, /Filter Preview requests[\s\S]*>0</)
  assert.match(page, /Collect requests[\s\S]*>0</)
  assert.doesNotMatch(page, /CORESIGNAL_API_KEY|apikey/)
})

test("Cancel closes the Search confirmation without transport or accounting work", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  const cancel = page.match(/<Button variant="outline" onClick=\{\(\) => setPendingRegularSearchFilters\(null\)\}>Cancel — No Provider Call<\/Button>/)?.[0] ?? ""
  assert.match(cancel, /setPendingRegularSearchFilters\(null\)/)
  assert.doesNotMatch(cancel, /runRegularSearch|fetch\(|providerResponseHistory|applicationUnits/)
})
