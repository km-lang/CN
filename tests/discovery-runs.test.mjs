import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const {
  discoveryRunSummary,
  previousDiscoveryRuns,
  recordedRequestedCount,
  resultProviderIntegrity,
  selectActiveDiscoveryRun,
} = await import("../lib/discovery-runs.ts")

const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

function search(overrides = {}) {
  return {
    id: 42,
    provider: "coresignal",
    mode: "live",
    initiatedBy: "PCOM Admin",
    createdAt: "2026-10-08T10:00:00.000Z",
    filtersJson: JSON.stringify({ company: "Innovaccer", discoveryProgrammes: ["PGP"], graduationYear: "2024" }),
    criteriaSummary: "IIM Lucknow · PGP · Innovaccer · 2024",
    requestedCount: 5,
    resultCount: 11,
    existingCount: 0,
    newCount: 2,
    duplicateCount: 0,
    creditsUsed: 0,
    ...overrides,
  }
}

function result(overrides = {}) {
  return {
    searchId: 42,
    provider: "coresignal",
    matchStatus: "Needs review",
    reviewStatus: "Pending review",
    ...overrides,
  }
}

test("the newest search with pending results is the default active run", () => {
  const searches = [search({ id: 41, provider: "pdl" }), search({ id: 42 }), search({ id: 43 })]
  const results = [result({ searchId: 41, provider: "pdl" }), result({ searchId: 42 })]
  assert.equal(selectActiveDiscoveryRun(searches, results)?.id, 42)
})

test("selecting a previous run resolves that exact search", () => {
  const searches = [search({ id: 41, provider: "pdl" }), search({ id: 42 })]
  assert.equal(selectActiveDiscoveryRun(searches, [result()], 41)?.id, 41)
  assert.equal(selectActiveDiscoveryRun(searches, [result()], 99), null)
})

test("run summaries scope results, counts, pending state, and usage to one search", () => {
  const summary = discoveryRunSummary(
    search(),
    [
      result({ matchStatus: "New" }),
      result({ matchStatus: "Needs review", reviewStatus: "Ignored" }),
      result({ searchId: 41, provider: "pdl", matchStatus: "Already in database" }),
    ],
    [
      { id: 1, applicationUnits: 1, providerReportedCredits: null },
      { id: 2, applicationUnits: 5, providerReportedCredits: null },
    ],
  )
  assert.equal(summary.searchId, 42)
  assert.equal(summary.storedResultCount, 2)
  assert.equal(summary.pendingCount, 1)
  assert.deepEqual(summary.counts, { existing: 0, new: 1, possibleDuplicate: 0, needsReview: 1 })
  assert.equal(summary.applicationUnits, 6)
  assert.equal(summary.providerReportedCredits, null)
})

test("historical requested count is unavailable when it was not recorded", () => {
  assert.equal(recordedRequestedCount(0), null)
  assert.equal(recordedRequestedCount(-1), null)
  assert.equal(recordedRequestedCount(5), 5)
  assert.equal(discoveryRunSummary(search({ requestedCount: 0 }), []).requestedCount, null)
})

test("previous runs remain separate and retain provider identity", () => {
  const previous = previousDiscoveryRuns(
    [search({ id: 40, provider: "pdl" }), search({ id: 41, provider: "pdl" }), search({ id: 42 })],
    [result({ searchId: 40, provider: "pdl" }), result({ searchId: 41, provider: "pdl" }), result()],
    42,
  )
  assert.deepEqual(previous.map(item => [item.searchId, item.provider]), [[41, "pdl"], [40, "pdl"]])
})

test("result provenance distinguishes consistent Coresignal and historical PDL data", () => {
  assert.equal(resultProviderIntegrity("coresignal", "coresignal"), "consistent")
  assert.equal(resultProviderIntegrity("PDL", "pdl"), "consistent")
  assert.equal(resultProviderIntegrity("coresignal", "pdl"), "provider_mismatch")
})

test("reopening stored results is a GET-only operation scoped by searchId", () => {
  assert.match(page, /new URLSearchParams\(\{ view: "pending", \.\.\.\(searchId \? \{ searchId: String\(searchId\) \} : \{\}\) \}\)/)
  assert.match(page, /fetch\(`\$\{API_ROUTES\.discovery\}\?\$\{query\}`, \{ cache: "no-store" \}\)/)
  assert.match(page, /No provider call was made and 0 credits were used/)
})

test("the active run renders its stored filters instead of the current selector state", () => {
  assert.match(discoveryRoute, /storedDiscoveryFilters\(activeSearch\.filtersJson\)/)
  assert.match(page, /setLastDiscoveryFilters\(data\.filters \?\? null\)/)
  assert.match(page, /activeDiscoveryRun\?\.requestedCount \?\? "Unavailable for this historical run"/)
})

test("provider history and result rows are scoped to the active search", () => {
  assert.match(discoveryRoute, /providerResponseHistory\.searchId, activeSearch\.id/)
  assert.match(discoveryRoute, /historyResults\.filter\(result => result\.searchId === activeSearch\.id\)/)
  assert.match(discoveryRoute, /presentResult\(result, filters, new Date\(\), activeSearch\)/)
})

test("provider mismatches are visible and block review actions", () => {
  assert.match(page, /Provider mismatch — review actions blocked/)
  assert.match(page, /const canAdd = provenanceConsistent/)
  assert.match(discoveryRoute, /Discovery result provider provenance does not match its search run/)
})

test("Run again is explicitly a new search and does not replace historical provenance", () => {
  assert.match(page, /<strong>Run again<\/strong><small>These controls create a separate discovery run\.<\/small>/)
  assert.match(page, /discoveryCountControl\("Run new search", "outline"\)/)
  assert.match(discoveryRoute, /previousDiscoveryRuns\(recentSearches, recentResults, search\.id\)/)
})

test("review operations resolve the owning search before changing a result", () => {
  assert.match(discoveryRoute, /externalDiscoverySearches\.id, result\.searchId/)
  assert.match(discoveryRoute, /resultProviderIntegrity\(search\.provider, result\.provider\)/)
  assert.match(discoveryRoute, /Only provenance-consistent past alumni/)
})
