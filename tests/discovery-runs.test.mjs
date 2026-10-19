import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const {
  discoveryRunSummary,
  isActionableDiscoveryReview,
  persistedDiscoveryExecutionSummary,
  previousDiscoveryRuns,
  recordedRequestedCount,
  resultProviderIntegrity,
  selectActiveDiscoveryRun,
} = await import("../lib/discovery-runs.ts")

const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")

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

test("filter mismatches remain stored history without becoming actionable review work", () => {
  const filterMismatch = result({ reviewNote: "SKIPPED_FILTER_MISMATCH: Derived seniority does not match selected VP." })
  assert.equal(isActionableDiscoveryReview(filterMismatch), false)
  assert.equal(discoveryRunSummary(search(), [filterMismatch]).storedResultCount, 1)
  assert.equal(discoveryRunSummary(search(), [filterMismatch]).pendingCount, 0)
  assert.equal(selectActiveDiscoveryRun([search({ id: 42 }), search({ id: 43 })], [filterMismatch])?.id, 43)
})

test("ordinary pending results remain actionable", () => {
  assert.equal(isActionableDiscoveryReview(result({ reviewNote: "REVIEW_BEFORE_COLLECT: Identity evidence requires review." })), true)
})

test("persisted execution metrics do not infer missing qualification categories", () => {
  const summary = persistedDiscoveryExecutionSummary([{ id: 17, applicationUnits: 1, providerReportedCredits: null, responseSummary: '4 exact-year candidates returned · Selective execution {"previewCountReturned":4,"previewCountConsidered":4,"seniorityMismatches":3,"collectExecuted":0,"collectSkippedKnown":0,"collectSkippedFilter":3,"collectSkippedLimit":0,"previouslyRejected":0,"potentialCollectionsAvoided":4}' }])
  assert.equal(summary.previewCountReturned, 4)
  assert.equal(summary.previewCountConsidered, 4)
  assert.equal(summary.seniorityMismatches, 3)
  assert.equal(summary.seniorityInsufficientEvidence, 0)
  assert.equal(summary.reviewBeforeCollect, 0)
  assert.equal(summary.confirmedFilterMatches, 0)
})

test("persisted execution metrics retain evaluated mismatches and saved pending counts", () => {
  const summary = persistedDiscoveryExecutionSummary([{ id: 18, applicationUnits: 1, providerReportedCredits: null, responseSummary: `Selective execution ${JSON.stringify({ previewCountReturned: 11, previewCountConsidered: 11, companyMismatches: 11, pendingVerification: 0, confirmedMismatches: 11, savedReviewCandidates: 0 })}` }])
  assert.equal(summary.previewCountConsidered, 11)
  assert.equal(summary.companyMismatches, 11)
  assert.equal(summary.confirmedMismatches, 11)
  assert.equal(summary.pendingVerification, 0)
  assert.equal(summary.savedReviewCandidates, 0)
})

test("manually confirmed Preview pages accumulate qualification metrics", () => {
  const first = { id: 1, applicationUnits: 1, providerReportedCredits: null, responseSummary: `page 1 · Selective execution ${JSON.stringify({ previewCountReturned: 20, previewCountConsidered: 20, companyMismatches: 4, confirmedFilterMatches: 3 })}` }
  const second = { id: 2, applicationUnits: 1, providerReportedCredits: null, responseSummary: `page 2 · Selective execution ${JSON.stringify({ previewCountReturned: 20, previewCountConsidered: 20, companyMismatches: 2, confirmedFilterMatches: 5 })}` }
  const summary = persistedDiscoveryExecutionSummary([first, second])
  assert.equal(summary.previewCountReturned, 40)
  assert.equal(summary.previewCountConsidered, 40)
  assert.equal(summary.companyMismatches, 6)
  assert.equal(summary.confirmedFilterMatches, 8)
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

test("the complete persisted history includes the active run and is newest first", () => {
  const history = previousDiscoveryRuns(
    [search({ id: 7 }), search({ id: 9 }), search({ id: 8, mode: "mock" })],
    [result({ searchId: 9 }), result({ searchId: 8 })],
    null,
  )
  assert.deepEqual(history.map(item => [item.searchId, item.mode]), [[9, "live"], [8, "mock"], [7, "live"]])
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

test("persisted discovery history loads independently on initial page load", () => {
  assert.match(discoveryRoute, /const history = previousDiscoveryRuns\(recentSearches, historyResults, null\)/)
  assert.match(discoveryRoute, /searches: recentSearches, history, previousSearches/)
  assert.match(page, /setDiscoveryRunHistory\(data\.history \?\? \[\]\)/)
  assert.match(page, /Previous discovery runs/)
  assert.match(page, /Loading saved discovery runs/)
  assert.match(page, /No saved discovery runs yet/)
  assert.match(page, /Retry history/)
  assert.ok(page.indexOf('id="discovery-history-heading"') < page.indexOf('(discoveryState !== "idle"'))
})

test("opening history preserves active search inputs and uses only the stored GET path", () => {
  const reopen = page.match(/async function reviewPendingDiscoveryResults[\s\S]*?async function runDiscovery/)?.[0] ?? ""
  assert.match(reopen, /setLastDiscoveryFilters\(data\.filters \?\? null\)/)
  assert.match(reopen, /setDiscoveryRunHistory\(data\.history/)
  assert.doesNotMatch(reopen, /setDiscoveryFilters/)
  assert.doesNotMatch(reopen, /method:\s*"POST"/)
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
  assert.match(discoveryRoute, /persistedSearchConstraintEvidence\(filters, activeProviderHistoryRows\)/)
  assert.match(discoveryRoute, /persistedDiscoveryExecutionSummary\(activeProviderHistoryRows\)/)
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

test("discovery labels distinguish identity-new, qualified-new, stored history, and actionable review", () => {
  assert.match(page, /qualified new/)
  assert.match(page, /new identity candidates/)
  assert.match(page, /Discovery results stored/)
  assert.match(page, /actionable review candidate/)
  assert.match(page, /Stored history — filter mismatch/)
  assert.match(page, /status === "Needs review" \? "Filter mismatch"/)
  assert.match(page, /Provider query evidence: \{result\.qualification\.graduationYear\.evidence\}/)
  assert.match(page, /Underlying education record was not included in Preview/)
  assert.match(page, /confirmed filter-qualified candidates/)
})

test("review operations resolve the owning search before changing a result", () => {
  assert.match(discoveryRoute, /externalDiscoverySearches\.id, result\.searchId/)
  assert.match(discoveryRoute, /resultProviderIntegrity\(search\.provider, result\.provider\)/)
  assert.match(discoveryRoute, /Approval requires a pending result, independently supported search criteria, a verified LinkedIn profile, and a new stable identity/)
})

test("professional-profile review uses a viewport-bounded shell with an independent evidence scroller", () => {
  assert.match(page, /className="comparison-dialog-body" tabIndex=\{0\} aria-label="Professional profile comparison evidence"/)
  assert.match(page, /className="comparison-dialog-footer comparison-footer"/)
  assert.match(styles, /\.comparison-dialog \{[^}]*max-height: calc\(100dvh - 24px\);[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;/s)
  assert.match(styles, /\.comparison-dialog-body \{[^}]*min-height: 0;[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/s)
  assert.match(styles, /\.comparison-dialog-footer \{[^}]*flex: none;[^}]*border-top:/s)
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.comparison-dialog \{[^}]*max-height: calc\(100dvh - max\(1rem, env\(safe-area-inset-top\) \+ env\(safe-area-inset-bottom\)\)\);[^}]*overflow: hidden;/)
  assert.match(styles, /\.comparison-dialog-footer \{[^}]*flex-direction: column;[^}]*env\(safe-area-inset-bottom\)/s)
})

test("professional-profile review keeps its controls reachable and restores focus to its exact trigger", () => {
  assert.match(page, /comparisonTriggerRef = useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(page, /comparisonTriggerRef\.current = event\.currentTarget; openComparison\(result\)/)
  assert.match(page, /onCloseAutoFocus=\{event => \{ event\.preventDefault\(\); comparisonTriggerRef\.current\?\.focus\(\) \}\}/)
  assert.match(page, />Ignore profile<\/Button>/)
  assert.match(page, />Keep Pending Review<\/Button>/)
})

test("historical review retains exact-year, absent-raw-evidence, and insufficient-seniority disclosures", () => {
  for (const evidence of [
    "Candidate summary",
    "Education evidence",
    "Employment and seniority evidence",
    "Remaining details",
    "IIM Lucknow — Exact provider query match",
    "Underlying education evidence was not included in Preview; independent verification remains pending.",
    "Not returned / not provider-verified",
    "Employer identity requires verification.",
    "Selected seniority qualification",
    "Provider person ID",
  ]) assert.ok(page.includes(evidence), evidence)
})

test("opening or closing the review modal has no provider execution path", () => {
  const openBlock = page.slice(page.indexOf("function openComparison"), page.indexOf("async function saveCandidateEvidence"))
  const dialogBlock = page.slice(page.indexOf('<Dialog open={Boolean(comparisonResult)}'), page.indexOf('<Dialog open={directoryExportOpen}'))
  assert.doesNotMatch(openBlock, /fetch\(|runDiscovery|runProfileRefresh|executeCollectOnly/)
  assert.doesNotMatch(dialogBlock, /executeCollectOnly|runProfileRefresh|discoverMoreAlumni/)
})
