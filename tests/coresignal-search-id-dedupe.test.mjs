import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const dedupe = await vite.ssrLoadModule("/lib/coresignal-search-id-dedupe.ts")
const lookup = await vite.ssrLoadModule("/lib/coresignal-search-id-store.ts")

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

test("classifies a mixed Search ID batch with deterministic known and unknown results", async () => {
  const store = fakeStore([
    { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://www.linkedin.com/in/alumnus-a" },
    { employeeId: "123456", alumnusId: 12, linkedinUrl: "https://www.linkedin.com/in/alumnus-b" },
  ])
  const result = await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198, 289351894, 123456] }, store)

  assert.deepEqual(result.classifications.map(item => [item.employeeId, item.mappingState]), [
    ["123456", "KNOWN_PROVIDER_ID"],
    ["1696198", "KNOWN_PROVIDER_ID"],
    ["289351894", "UNKNOWN_PROVIDER_ID"],
  ])
  assert.equal(result.classifications[0].mappedAlumnusId, 12)
  assert.equal(result.classifications[0].canonicalLinkedinUrl, "https://www.linkedin.com/in/alumnus-b")
  assert.deepEqual(result.summary, {
    rawIdsReceived: 3,
    uniqueValidIds: 3,
    knownProviderIds: 2,
    unknownProviderIds: 1,
    identityReviewRequired: 0,
    potentialDownstreamIdentityOperationsAvoided: 2,
    profilesRequiringFurtherResolution: 1,
  })
  assert.equal(store.calls.length, 1)
})

test("deduplicates numeric and canonical decimal-string IDs before one bulk lookup", async () => {
  const store = fakeStore()
  const result = await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198, "1696198", 289351894] }, store)
  assert.equal(result.summary.rawIdsReceived, 3)
  assert.equal(result.summary.uniqueValidIds, 2)
  assert.deepEqual(store.calls, [["1696198", "289351894"]])
  assert.deepEqual(result.classifications.map(item => item.employeeId), ["1696198", "289351894"])
})

test("empty input returns a safe empty result without querying the database", async () => {
  const store = fakeStore()
  const result = await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [] }, store)
  assert.equal(store.calls.length, 0)
  assert.deepEqual(result.classifications, [])
  assert.equal(result.summary.uniqueValidIds, 0)
})

test("invalid IDs fail the whole batch before any database query", async () => {
  const invalid = [0, -1, Number.NaN, "", " ", "garbage", "1e3", " 123", Number.MAX_SAFE_INTEGER + 1]
  for (const employeeId of invalid) {
    const store = fakeStore()
    await assert.rejects(
      dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198, employeeId] }, store),
      error => error.name === "CoresignalSearchIdValidationError" && error.invalidIndexes.includes(1),
    )
    assert.equal(store.calls.length, 0)
  }
})

test("the raw batch bound is enforced before database access", async () => {
  const store = fakeStore()
  await assert.rejects(
    dedupe.deduplicateCoresignalSearchIds({ employeeIds: Array.from({ length: dedupe.MAX_CORESIGNAL_SEARCH_IDS + 1 }, (_, index) => index + 1) }, store),
    /limited to 1000 raw IDs/,
  )
  assert.equal(store.calls.length, 0)
})

test("known identity explicitly leaves profile freshness unevaluated", async () => {
  const store = fakeStore([{ employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://linkedin.com/in/alumnus-a" }])
  const result = await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198] }, store)
  assert.equal(result.classifications[0].mappingState, "KNOWN_PROVIDER_ID")
  assert.equal(result.classifications[0].identityResolutionRequired, false)
  assert.equal(result.classifications[0].identityProviderOperationsAvoided, 1)
  assert.equal(result.classifications[0].profileFreshness, "NOT_EVALUATED")
  assert.doesNotMatch(JSON.stringify(result), /PROFILE_CURRENT|NO_REFRESH_NEEDED/)
})

test("classification cannot mutate canonical fields, stored identity, or other provider IDs", async () => {
  const alumnus = {
    employeeId: "1696198",
    alumnusId: 11,
    linkedinUrl: "https://linkedin.com/in/alumnus-a",
    name: "Alumnus A",
    company: "Existing Company",
    title: "Existing Title",
    graduationYear: 2012,
    programme: "PGP",
    pdlPersonId: "pdl-11",
    lushaPersonId: "lusha-11",
  }
  const before = structuredClone(alumnus)
  const store = fakeStore([alumnus])

  await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198] }, store)

  assert.deepEqual(alumnus, before)
})

test("unexpected duplicate persisted mappings are isolated for identity review", async () => {
  const store = fakeStore([
    { employeeId: "1696198", alumnusId: 11, linkedinUrl: "https://linkedin.com/in/alumnus-a" },
    { employeeId: "1696198", alumnusId: 12, linkedinUrl: "https://linkedin.com/in/alumnus-b" },
  ])
  const result = await dedupe.deduplicateCoresignalSearchIds({ employeeIds: [1696198] }, store)
  assert.equal(result.classifications[0].mappingState, "IDENTITY_REVIEW_REQUIRED")
  assert.equal(result.classifications[0].mappedAlumnusId, null)
  assert.equal(result.summary.potentialDownstreamIdentityOperationsAvoided, 0)
  assert.equal(result.summary.profilesRequiringFurtherResolution, 1)
})

test("chunked lookup uses deterministic bounded bulk queries rather than one query per ID", async () => {
  const calls = []
  const store = lookup.createChunkedCoresignalSearchIdLookupStore(async employeeIds => {
    calls.push([...employeeIds])
    return employeeIds.map(employeeId => ({ employeeId, alumnusId: Number(employeeId), linkedinUrl: "" }))
  }, 2)
  const rows = await store.findMappings(["1", "2", "3", "4", "5"])
  assert.deepEqual(calls, [["1", "2"], ["3", "4"], ["5"]])
  assert.equal(rows.length, 5)
})

test("dedupe implementation is read-only and isolated from providers and runtime routing", async () => {
  const service = await readFile(new URL("../lib/coresignal-search-id-dedupe.ts", import.meta.url), "utf8")
  const store = await readFile(new URL("../lib/coresignal-search-id-store.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
  const dormantBuilder = "coresignalExactYearEsDslSearchContract"
  for (const source of [service, store]) {
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|providerResponseHistory|fieldChangeHistory|writeSecurityAudit/)
    assert.doesNotMatch(source, /Bright|PDL|Lusha|collectCoresignal|fetch\(|webhook/i)
  }
  assert.match(store, /inArray\(alumni\.coresignalEmployeeId/)
  assert.doesNotMatch(route, /coresignal-search-id-dedupe|coresignal-search-id-store/)
  assert.doesNotMatch(route, new RegExp(dormantBuilder))
})
