import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const coverage = await vite.ssrLoadModule("/lib/discovery-coverage.ts")
const reconciliation = await vite.ssrLoadModule("/lib/discovery-reconciliation.ts")
const capabilities = await vite.ssrLoadModule("/lib/discovery-provider-capabilities.ts")
const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const capabilitySource = await readFile(new URL("../lib/discovery-provider-capabilities.ts", import.meta.url), "utf8")

const filters = {
  alumniStatus: "Past alumni only",
  discoveryProgrammes: ["PGP"],
  company: "Innovaccer",
  role: "",
  function: "All functions",
  seniority: "All seniority levels",
  location: "India",
  graduationYear: "2024",
}

function history(id, graduationYear, createdAt, overrides = {}) {
  return {
    id,
    provider: "coresignal",
    mode: "live",
    filtersJson: JSON.stringify({ ...filters, graduationYear: String(graduationYear), ...overrides }),
    createdAt,
  }
}

const candidate = (overrides = {}) => ({
  candidateKey: "candidate-1",
  providerEmployeeId: "new-employee",
  profileUrl: "https://www.linkedin.com/in/new-person",
  name: "New Person",
  educationInstitution: "Indian Institute of Management Lucknow",
  programme: "PGP",
  graduationYear: 2024,
  currentCompany: "Innovaccer",
  currentTitle: "Director",
  ...overrides,
})

const alumni = [
  { id: 1, coresignalEmployeeId: "cs-1", linkedinUrl: "https://www.linkedin.com/in/provider-match", name: "Provider Match", education: "Indian Institute of Management Lucknow", programme: "PGP", graduationYear: 2012 },
  { id: 2, coresignalEmployeeId: "cs-2", linkedinUrl: "https://www.linkedin.com/in/url-match", name: "URL Match", education: "Indian Institute of Management Lucknow", programme: "PGP", graduationYear: 2013 },
  { id: 3, name: "Strong Match", education: "IIM Lucknow", programme: "PGDM", graduationYear: 2014 },
]

test("coverage normalizes equivalent filters and keeps graduation years as distinct segments", () => {
  const plan = coverage.discoveryCoveragePlan(
    { ...filters, company: "  INNOVACCER ", discoveryProgrammes: ["pgp", "PGP"] },
    [history(10, 2024, "2026-10-10T00:00:00.000Z"), history(11, 2023, "2026-08-01T00:00:00.000Z")],
    { now: new Date("2026-10-12T00:00:00.000Z"), provider: "Coresignal", mode: "LIVE", graduationYears: [2024, 2023, 2022] },
  )
  assert.equal(plan.overallState, "PARTIALLY_COVERED")
  assert.deepEqual(plan.segments.map(item => [item.graduationYear, item.state]), [[2022, "NEVER_SEARCHED"], [2023, "STALE_SEARCH"], [2024, "RECENTLY_SEARCHED"]])
  assert.deepEqual(plan.counts, { requested: 3, recentlySearched: 1, stale: 1, neverSearched: 1 })
  assert.equal(plan.searchSegmentsRequiringProviderQuery, 2)
  assert.equal(plan.policy.advisoryOnly, true)
})

test("coverage is scoped to equivalent provider, mode, filter, and year history", () => {
  const plan = coverage.discoveryCoveragePlan(filters, [
    history(1, 2024, "2026-10-11T00:00:00.000Z", { company: "Other" }),
    { ...history(2, 2024, "2026-10-11T00:00:00.000Z"), provider: "pdl" },
    { ...history(3, 2024, "2026-10-11T00:00:00.000Z"), mode: "mock" },
  ], { now: new Date("2026-10-12T00:00:00.000Z"), provider: "coresignal", mode: "live" })
  assert.equal(plan.overallState, "NEVER_SEARCHED")
  assert.equal(plan.lastEquivalentSearch.lastSearchId, null)
})

test("A: an exact stable provider ID is already known and should not be collected", () => {
  const result = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "CS-1", profileUrl: "" }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision, result.linkedAlumnusId], ["KNOWN_PROVIDER_ID", "DO_NOT_COLLECT", 1])
})

test("B: an equivalent professional-profile URL is already known", () => {
  const result = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "unknown", profileUrl: "https://linkedin.com/in/url-match/?trk=abc#top" }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision, result.linkedAlumnusId], ["KNOWN_PROFILE_URL", "DO_NOT_COLLECT", 2])
})

test("a different LinkedIn profile slug is never treated as the same alumnus", () => {
  const result = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "unknown", profileUrl: "https://www.linkedin.com/in/url-match-different" }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision, result.linkedAlumnusId], ["NEW_CANDIDATE", "COLLECT_RECOMMENDED", null])
})

test("C: unique name plus IIML programme and year is a strong identity", () => {
  const result = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "", profileUrl: "", name: "Strong Match", graduationYear: 2014 }), alumni, [], { ...capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, searchPreviewProvidesProfileUrl: "NO" })
  assert.deepEqual([result.classification, result.collectDecision, result.linkedAlumnusId], ["KNOWN_STRONG_IDENTITY", "DO_NOT_COLLECT", 3])
})

test("D/E: same-name conflicts or incomplete evidence remain ambiguous and never auto-link", () => {
  const differentYear = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "", profileUrl: "", name: "Strong Match", graduationYear: 2015 }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  const nameOnly = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "", profileUrl: "", name: "Strong Match", educationInstitution: "", programme: "", graduationYear: 0 }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.equal(differentYear.classification, "AMBIGUOUS")
  assert.equal(differentYear.linkedAlumnusId, null)
  assert.equal(nameOnly.classification, "AMBIGUOUS")
  assert.equal(nameOnly.reasonCode, "NAME_MATCH_INSUFFICIENT_EVIDENCE")
})

test("F: a genuinely unmatched candidate with a valid profile URL is new", () => {
  const result = reconciliation.reconcileDiscoveryCandidate(candidate(), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision], ["NEW_CANDIDATE", "COLLECT_RECOMMENDED"])
})

test("G/H: unchanged prior rejection is suppressed, while changed evidence requires review", () => {
  const rejected = { ...candidate(), reviewStatus: "Ignored", resultId: 99 }
  const unchanged = reconciliation.reconcileDiscoveryCandidate(candidate(), alumni, [rejected], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  const changed = reconciliation.reconcileDiscoveryCandidate(candidate({ currentCompany: "Another company" }), alumni, [rejected], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([unchanged.classification, unchanged.collectDecision], ["PREVIOUSLY_REJECTED", "DO_NOT_COLLECT"])
  assert.deepEqual([changed.classification, changed.collectDecision], ["AMBIGUOUS", "REVIEW_BEFORE_COLLECT"])
  assert.equal(changed.reasonCode, "REJECTED_EVIDENCE_CHANGED")
})

test("I: unknown or yes preview capability never treats a missing profile URL as safely new", () => {
  for (const capability of ["UNKNOWN", "YES"]) {
    const result = reconciliation.reconcileDiscoveryCandidate(candidate({ profileUrl: "" }), [], [], { ...capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, searchPreviewProvidesProfileUrl: capability })
    assert.deepEqual([result.classification, result.collectDecision, result.reasonCode], ["AMBIGUOUS", "REVIEW_BEFORE_COLLECT", "IDENTITY_EVIDENCE_INSUFFICIENT"])
  }
  const knownUnavailable = reconciliation.reconcileDiscoveryCandidate(candidate({ profileUrl: "" }), [], [], { ...capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, searchPreviewProvidesProfileUrl: "NO", searchPreviewProvidesEducation: "YES" })
  assert.equal(knownUnavailable.classification, "NEW_CANDIDATE")
})

test("a stable new profile URL identifies a new candidate without pretending education was returned", () => {
  const withoutEducation = candidate({ educationInstitution: "", programme: "", graduationYear: 0 })
  const identified = reconciliation.reconcileDiscoveryCandidate(withoutEducation, [], [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([identified.classification, identified.collectDecision, identified.reasonCode], ["NEW_CANDIDATE", "COLLECT_RECOMMENDED", "NO_SAFE_EXISTING_IDENTITY"])

  const missingStableIdentity = reconciliation.reconcileDiscoveryCandidate({ ...withoutEducation, profileUrl: "" }, [], [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([missingStableIdentity.classification, missingStableIdentity.collectDecision], ["AMBIGUOUS", "REVIEW_BEFORE_COLLECT"])
})

test("search criteria are not reconstructed as returned education evidence", () => {
  const previewCandidate = candidate({
    providerEmployeeId: "",
    profileUrl: "",
    name: "Strong Match",
    educationInstitution: undefined,
    programme: undefined,
    graduationYear: undefined,
  })
  const result = reconciliation.reconcileDiscoveryCandidate(previewCandidate, alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision, result.reasonCode, result.linkedAlumnusId], [
    "AMBIGUOUS",
    "REVIEW_BEFORE_COLLECT",
    "NAME_MATCH_INSUFFICIENT_EVIDENCE",
    null,
  ])
})

test("current-company capability never substitutes for stable identity evidence", () => {
  const sameCompanyOnly = candidate({ name: "Another Person", educationInstitution: "", programme: "", graduationYear: 0, currentCompany: "Innovaccer" })
  const matchingCompanyAlumnus = [{ id: 50, name: "Unrelated Alumnus", company: "Innovaccer" }]
  for (const capability of ["YES", "NO", "UNKNOWN"]) {
    const result = reconciliation.reconcileDiscoveryCandidate(sameCompanyOnly, matchingCompanyAlumnus, [], {
      ...capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
      searchPreviewProvidesCurrentCompany: capability,
    })
    assert.notEqual(result.classification, "KNOWN_STRONG_IDENTITY")
    assert.equal(result.linkedAlumnusId, null)
  }
})

test("J: multiple equally strong identities are ambiguous", () => {
  const duplicates = [...alumni, { ...alumni[2], id: 4 }]
  const result = reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "", profileUrl: "", name: "Strong Match", graduationYear: 2014 }), duplicates, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual([result.classification, result.collectDecision, result.reasonCode], ["AMBIGUOUS", "REVIEW_BEFORE_COLLECT", "MULTIPLE_STRONG_IDENTITY_MATCHES"])
})

test("capability declarations reflect observed fields while keeping institutional evidence unknown", () => {
  assert.deepEqual(capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES, {
    searchPreviewProvidesEmployeeId: "YES",
    searchPreviewProvidesProfileUrl: "YES",
    searchPreviewProvidesName: "YES",
    searchPreviewProvidesEducation: "UNKNOWN",
    searchPreviewProvidesCurrentCompany: "YES",
    searchPreviewProvidesCurrentTitle: "YES",
    searchPreviewProvidesGraduationYear: "UNKNOWN",
  })
  for (const [key, value] of Object.entries(capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)) {
    assert.ok(["YES", "NO", "UNKNOWN"].includes(value), key)
  }
  assert.match(capabilitySource, /returned 20[\s\S]*items_per_page=1/)
})

test("selective collection summary uses neutral operational counts", () => {
  const results = [
    reconciliation.reconcileDiscoveryCandidate(candidate({ providerEmployeeId: "cs-1" }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES),
    reconciliation.reconcileDiscoveryCandidate(candidate({ candidateKey: "new" }), alumni, [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES),
    reconciliation.reconcileDiscoveryCandidate(candidate({ candidateKey: "review", profileUrl: "" }), [], [], capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES),
  ]
  assert.deepEqual(reconciliation.selectiveCollectSummary(results), {
    candidatesReturned: 3,
    knownProviderIds: 1,
    knownProfileUrls: 0,
    knownStrongIdentities: 0,
    newCandidates: 1,
    ambiguousCandidates: 1,
    previouslyRejected: 0,
    alreadyKnown: 1,
    collectRecommended: 1,
    collectReviewRequired: 1,
    collectAvoided: 1,
  })
})

test("planner functions are deterministic and do not mutate supplied records", () => {
  const people = structuredClone(alumni)
  const rejected = [{ ...candidate(), reviewStatus: "Ignored" }]
  const peopleBefore = structuredClone(people)
  const rejectedBefore = structuredClone(rejected)
  reconciliation.reconcileDiscoveryCandidate(candidate(), people, rejected, capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES)
  assert.deepEqual(people, peopleBefore)
  assert.deepEqual(rejected, rejectedBefore)
})

test("the plan endpoint is a stored-history read and cannot invoke a provider", () => {
  const planBlock = route.match(/if \(payload\.action === "plan"\)[\s\S]*?\n    }/)?.[0] ?? ""
  assert.match(planBlock, /externalDiscoverySearches/)
  assert.match(planBlock, /providerCallMade: false/)
  assert.match(planBlock, /applicationUnits: 0/)
  assert.doesNotMatch(planBlock, /searchCandidates|searchCoresignalIiml|collectCoresignalEmployee/)
})

test("the UI shows coverage before search plus reconciliation rationale and neutral savings wording", () => {
  assert.match(page, /Discovery coverage/)
  assert.match(page, /Plan only · no provider call/)
  assert.match(page, /potential profile collections avoided/)
  assert.match(page, /plannerRationale/)
  assert.match(page, /collectDecision/)
})
