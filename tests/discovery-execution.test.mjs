import assert from "node:assert/strict"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const execution = await vite.ssrLoadModule("/lib/discovery-execution.ts")
const capabilities = await vite.ssrLoadModule("/lib/discovery-provider-capabilities.ts")
const adapter = await vite.ssrLoadModule("/lib/coresignal-adapter.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")

const filters = overrides => ({ ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP"], company: "Lincoln International", seniority: "VP+", graduationYear: "2013", ...overrides })

const preview = (id, overrides = {}) => ({
  providerResultId: id,
  providerPersonId: id,
  name: `Candidate ${id}`,
  education: "Education not returned",
  currentCompany: "Lincoln International",
  role: "Vice President",
  rawTitle: "Vice President",
  function: "Finance",
  seniority: "VP",
  location: "Mumbai",
  graduationYear: 0,
  linkedinUrl: `https://www.linkedin.com/in/${id}`,
  matchConfidence: 70,
  affiliationStatus: "Potential alumnus — review required",
  educationProgramme: "",
  normalizedProgramme: "",
  programmeStatus: "Programme requires review",
  alumniStatus: "Graduation status unknown — review required",
  eligibleForAddition: false,
  educationStartDate: "",
  educationEndDate: "",
  institutionId: "",
  institutionUrl: "",
  currentCompanyId: "",
  currentCompanyUrl: "",
  currentRoleStartDate: "",
  currentIndustry: "Investment Banking",
  currentRoleAmbiguous: false,
  providerFreshnessAt: "",
  ...overrides,
})

const collected = (id, overrides = {}) => ({
  ...preview(id),
  education: "Indian Institute of Management Lucknow",
  graduationYear: 2013,
  affiliationStatus: "Potential alumnus — review required",
  educationProgramme: "",
  normalizedProgramme: "",
  programmeStatus: "Programme requires review",
  alumniStatus: "Past alumnus",
  educationStartDate: "2011",
  educationEndDate: "2013",
  currentRoles: [{ company: "Lincoln International", title: "Vice President", seniority: "VP", startDate: "2021" }],
  iimlEducationEvidence: [{ institution: "Indian Institute of Management Lucknow", programme: "", normalizedProgramme: "", startDate: "2011", endDate: "2013", graduationYear: 2013 }],
  ...overrides,
})

function run(previewProfiles, options = {}) {
  let calls = 0
  return execution.executeSelectiveDiscovery({
    previewProfiles,
    filters: options.filters ?? filters({}),
    alumni: options.alumni ?? [],
    rejectedCandidates: options.rejectedCandidates ?? [],
    capabilities: capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
    requestedCount: options.requestedCount ?? previewProfiles.length,
    maximumCollects: options.maximumCollects ?? previewProfiles.length,
    collect: async (id, index) => {
      calls += 1
      return options.collect ? options.collect(id, index) : collected(id)
    },
  }).then(result => ({ result, calls }))
}

test("known provider IDs and LinkedIn URLs skip Collect", async () => {
  const people = [
    { id: 1, name: "Known ID", coresignalEmployeeId: "known-id", linkedinUrl: "https://linkedin.com/in/known-id" },
    { id: 2, name: "Known URL", coresignalEmployeeId: "old-provider-id", linkedinUrl: "https://linkedin.com/in/known-url" },
  ]
  const { result, calls } = await run([
    preview("known-id"),
    preview("new-provider-id", { linkedinUrl: "https://www.linkedin.com/in/known-url/?trk=preview" }),
  ], { alumni: people })
  assert.equal(calls, 0)
  assert.deepEqual(result.candidates.map(item => [item.reconciliation.classification, item.collectionState]), [
    ["KNOWN_PROVIDER_ID", "SKIPPED_ALREADY_KNOWN"],
    ["KNOWN_PROFILE_URL", "SKIPPED_ALREADY_KNOWN"],
  ])
  assert.equal(result.metrics.potentialCollectionsAvoided, 2)
})

test("Preview company and seniority mismatches are rejected before Collect", async () => {
  const { result, calls } = await run([
    preview("wrong-company", { currentCompany: "Another Company" }),
    preview("junior", { role: "Analyst", rawTitle: "Analyst", seniority: "Analyst/Junior" }),
  ])
  assert.equal(calls, 0)
  assert.deepEqual(result.candidates.map(item => item.collectionState), ["SKIPPED_FILTER_MISMATCH", "SKIPPED_FILTER_MISMATCH"])
  assert.equal(result.metrics.companyMismatches, 1)
  assert.equal(result.metrics.seniorityMismatches, 1)
})

test("Search #6 multi-programme evidence is not described as provider-constrained", async () => {
  const { result, calls } = await run([
    preview("289351894", { name: "Shruti Chaturvedi", role: "Director", rawTitle: "Director", seniority: "Director" }),
  ], { filters: filters({ discoveryProgrammes: ["PGP", "ABM", "SM"], seniorities: ["VP"], seniority: "VP" }) })
  assert.equal(calls, 0)
  const item = result.candidates[0]
  assert.equal(item.qualification.company.result, "MATCH")
  assert.equal(item.qualification.seniority.result, "MISMATCH")
  assert.equal(item.qualification.graduationYear.result, "NEEDS_COLLECT")
  assert.equal(item.qualification.graduationYear.source, "PROVIDER_UPPER_BOUND")
  assert.match(item.qualification.graduationYear.evidence, /Provider narrowing 2013 or earlier/)
  assert.match(item.qualification.graduationYear.rationale, /education-end upper bound/i)
  assert.equal(item.qualification.programme.result, "NOT_PROVIDER_VERIFIED")
  assert.match(item.qualification.programme.rationale, /programme was not used to constrain the provider search/i)
  assert.doesNotMatch(item.qualification.programme.rationale, /search was constrained to/i)
  assert.equal(item.collectionState, "SKIPPED_FILTER_MISMATCH")
  assert.equal(item.finalStatus, "FILTER_MISMATCH")
})

test("Shruti exact-year verification rejects active 2011 evidence despite the 2013 provider upper bound", () => {
  const shruti = adapter.mapCoresignalProfile({
    id: "289351894",
    full_name: "Shruti Chaturvedi",
    deleted: 0,
    education: [
      { institution_name: "Indian Institute of Management, Lucknow", degree_name: "PGDM, Finance & Marketing", date_from: "2009", date_to: "2011", deleted: 0 },
      { institution_name: "Indian Institute of Management Lucknow", degree_name: "PGP", date_from: "2011", date_to: "2013", deleted: 1 },
    ],
    experience: [
      { company_name: "Lincoln International", title: "Director", date_from: "April 2022", is_current: 1, deleted: 0 },
      { company_name: "Lincoln International", title: "Vice President", date_to: null, is_current: 0, deleted: 0 },
      { company_name: "Lincoln International", title: "Vice President", is_current: 1, deleted: 1 },
    ],
  }, 0, { selectedProgrammes: ["PGP", "ABM", "SM"] })
  const qualified = execution.qualifyCollectedCandidate(shruti, filters({ discoveryProgrammes: ["PGP", "ABM", "SM"], seniorities: ["VP"], seniority: "VP" }))
  assert.equal(qualified.graduationYear.result, "VERIFIED_MISMATCH")
  assert.equal(qualified.graduationYear.evidence, "IIM Lucknow · 2009–2011")
  assert.match(qualified.graduationYear.rationale, /2013 or earlier/)
  assert.match(qualified.graduationYear.rationale, /ends in 2011/)
  assert.equal(qualified.seniority.result, "VERIFIED_MISMATCH")
  assert.match(qualified.seniority.evidence, /Director → Director/)
  assert.doesNotMatch(qualified.seniority.evidence, /Vice President/)
})

test("exact-year verification accepts non-deleted evidence ending in the requested year", () => {
  const candidate = adapter.mapCoresignalProfile({
    id: "active-year-match",
    full_name: "Active Year Match",
    deleted: 0,
    education: [
      { institution_name: "Indian Institute of Management Lucknow", degree_name: "PGDM", date_from: "2011", date_to: "2013", deleted: 0 },
      { institution_name: "Indian Institute of Management Lucknow", degree_name: "PGDM", date_from: "2011", date_to: "2013", deleted: 0 },
    ],
    experience: [{ company_name: "Lincoln International", title: "Vice President", is_current: 1, deleted: 0 }],
  }, 0, { selectedProgrammes: ["PGP"] })
  const qualified = execution.qualifyCollectedCandidate(candidate, filters({ discoveryProgrammes: ["PGP"] }))
  assert.equal(candidate.iimlEducationEvidence.length, 1)
  assert.equal(qualified.graduationYear.result, "VERIFIED_MATCH")
  assert.equal(qualified.graduationYear.evidence, "IIM Lucknow · 2011–2013")
  assert.match(qualified.graduationYear.rationale, /matching the requested graduation year/)
})

test("single-programme Preview rationale retains the established provider-constraint semantics", () => {
  const qualification = execution.qualifyPreviewCandidate(preview("single-programme"), filters({ discoveryProgrammes: ["PGP"] }))
  assert.equal(qualification.programme.result, "SEARCH_CONSTRAINED_NOT_VERIFIED")
  assert.match(qualification.programme.rationale, /Search was constrained to PGP/)
  assert.equal(qualification.graduationYear.result, "NEEDS_COLLECT")
})

test("assistant-to-VP wording is not classified as VP", async () => {
  assert.deepEqual(execution.titleSeniority("Assistant to the Vice President"), { bucket: "", ambiguous: true })
  const { result, calls } = await run([preview("assistant", { role: "Assistant to the Vice President", rawTitle: "Assistant to the Vice President" })])
  assert.equal(calls, 0)
  assert.equal(result.candidates[0].qualification.seniority.result, "INSUFFICIENT_EVIDENCE")
  assert.equal(result.candidates[0].collectionState, "REVIEW_BEFORE_COLLECT")
})

test("unchanged prior rejection skips Collect", async () => {
  const candidate = preview("rejected")
  const rejected = { candidateKey: "old", providerEmployeeId: "rejected", profileUrl: candidate.linkedinUrl, name: candidate.name, educationInstitution: "", programme: "", graduationYear: 0, currentCompany: candidate.currentCompany, currentTitle: candidate.role, reviewStatus: "Ignored" }
  const { result, calls } = await run([candidate], { rejectedCandidates: [rejected] })
  assert.equal(calls, 0)
  assert.equal(result.candidates[0].collectionState, "SKIPPED_PREVIOUSLY_REJECTED")
})

test("new qualified Preview candidate is selectively collected and year is verified", async () => {
  const { result, calls } = await run([preview("bharani")])
  assert.equal(calls, 1)
  const item = result.candidates[0]
  assert.equal(item.qualification.company.result, "VERIFIED_MATCH")
  assert.equal(item.qualification.seniority.result, "VERIFIED_MATCH")
  assert.equal(item.qualification.graduationYear.result, "VERIFIED_MATCH")
  assert.equal(item.qualification.programme.result, "SEARCH_CONSTRAINED_NOT_VERIFIED")
  assert.equal(item.finalStatus, "QUALIFIED_FOR_REVIEW")
  assert.equal(item.profile.eligibleForAddition, false)
})

test("collected IIML graduation-year mismatch becomes a filter mismatch", async () => {
  const { result, calls } = await run([preview("wrong-year")], { collect: id => collected(id, { graduationYear: 2012, educationEndDate: "2012" }) })
  assert.equal(calls, 1)
  assert.equal(result.candidates[0].qualification.graduationYear.result, "VERIFIED_MISMATCH")
  assert.equal(result.candidates[0].finalStatus, "FILTER_MISMATCH")
})

test("multiple current roles retain ambiguity while recognizing requested-company evidence", async () => {
  const roles = [
    { company: "Lincoln International", title: "Vice President", seniority: "VP", startDate: "2021" },
    { company: "Another Company", title: "Advisor", seniority: "Associate/Consultant", startDate: "2022" },
  ]
  const { result } = await run([preview("multiple")], { collect: id => collected(id, { currentRoleAmbiguous: true, currentCompany: "Multiple current roles — review required", role: "Multiple current roles — review required", currentRoles: roles }) })
  assert.equal(result.candidates[0].profile.currentRoleAmbiguous, true)
  assert.equal(result.candidates[0].qualification.company.result, "VERIFIED_MATCH")
  assert.match(result.candidates[0].qualification.company.evidence, /Lincoln International/)
})

test("duplicate IIML education rows normalize to one strongest dated fact", () => {
  const evidence = adapter.normalizedIimlEducationEvidence({ education: [
    { institution_name: "Indian Institute of Management Lucknow", degree_name: "", deleted: 0 },
    { institution_name: "Indian Institute of Management Lucknow", degree_name: "", date_from: "2011", date_to: "2013", deleted: 0 },
    { institution_name: "Indian Institute of Management Lucknow", degree_name: "", date_from: "2011", date_to: "2013", deleted: 0 },
  ] })
  assert.equal(evidence.length, 1)
  assert.equal(evidence[0].graduationYear, 2013)
})

test("duplicate current-role rows collapse without hiding genuinely different roles", () => {
  const roles = adapter.normalizedCurrentRoleEvidence({ experience: [
    { company_name: "Lincoln International", title: "Vice President", is_current: 1, deleted: 0 },
    { company_name: "Lincoln International", title: "Vice President", is_current: 1, deleted: 0, date_from: "2021" },
    { company_name: "Another Company", title: "Advisor", is_current: 1, deleted: 0 },
  ] })
  assert.equal(roles.length, 2)
  assert.equal(roles.find(item => item.company === "Lincoln International").startDate, "2021")
})

test("provider over-return is bounded before Collect", async () => {
  const twenty = Array.from({ length: 20 }, (_, index) => preview(`person-${index + 1}`))
  const { result, calls } = await run(twenty, { requestedCount: 5, maximumCollects: 5 })
  assert.equal(result.metrics.previewCountReturned, 20)
  assert.equal(result.metrics.previewCountConsidered, 5)
  assert.equal(calls, 5)
  assert.equal(result.candidates.length, 5)
})

test("mixed ten-candidate execution collects only the two genuinely new qualified candidates", async () => {
  const knownIds = [1, 2, 3].map(index => ({ id: index, name: `Known ${index}`, coresignalEmployeeId: `known-${index}`, linkedinUrl: `https://linkedin.com/in/known-${index}` }))
  const knownUrls = [4, 5].map(index => ({ id: index, name: `Known ${index}`, linkedinUrl: `https://linkedin.com/in/known-url-${index}` }))
  const rejectedPreview = preview("rejected-mixed")
  const rejected = { candidateKey: "old-rejected", providerEmployeeId: rejectedPreview.providerPersonId, profileUrl: rejectedPreview.linkedinUrl, name: rejectedPreview.name, educationInstitution: "", programme: "", graduationYear: 0, currentCompany: rejectedPreview.currentCompany, currentTitle: rejectedPreview.role, reviewStatus: "Ignored" }
  const candidates = [
    ...knownIds.map(item => preview(item.coresignalEmployeeId)),
    ...knownUrls.map((item, index) => preview(`fresh-${index}`, { linkedinUrl: item.linkedinUrl })),
    preview("junior-a", { role: "Analyst", rawTitle: "Analyst" }),
    preview("junior-b", { role: "Manager", rawTitle: "Manager" }),
    rejectedPreview,
    preview("new-a"),
    preview("new-b"),
  ]
  const { result, calls } = await run(candidates, { alumni: [...knownIds, ...knownUrls], rejectedCandidates: [rejected], requestedCount: 10, maximumCollects: 10 })
  assert.equal(calls, 2)
  assert.equal(result.metrics.collectExecuted, 2)
  assert.equal(result.metrics.potentialCollectionsAvoided, 8)
  assert.equal(result.candidates.filter(item => item.collectionState === "COLLECT_PERFORMED").length, 2)
})

test("Collect limit is independent from Preview count and does not fan out after the cap", async () => {
  const { result, calls } = await run(Array.from({ length: 6 }, (_, index) => preview(`limited-${index}`)), { requestedCount: 6, maximumCollects: 2 })
  assert.equal(calls, 2)
  assert.equal(result.metrics.collectSkippedLimit, 4)
  assert.equal(result.candidates.filter(item => item.finalStatus === "COLLECT_LIMIT_REACHED").length, 4)
})

test("a successful Collect with no usable profile still consumes the execution cap", async () => {
  const { result, calls } = await run([preview("empty"), preview("must-not-collect")], {
    requestedCount: 2,
    maximumCollects: 1,
    collect: () => null,
  })
  assert.equal(calls, 1)
  assert.equal(result.metrics.collectExecuted, 1)
  assert.equal(result.candidates[0].finalStatus, "INSUFFICIENT_EVIDENCE")
  assert.equal(result.candidates[1].collectionState, "SKIPPED_COLLECT_LIMIT")
})

test("missing employee ID and Collect failure never broaden execution", async () => {
  const missingId = preview("missing-id", { providerPersonId: "" })
  const noId = await run([missingId])
  assert.equal(noId.calls, 0)
  assert.equal(noId.result.candidates[0].collectionState, "REVIEW_BEFORE_COLLECT")

  let calls = 0
  await assert.rejects(() => execution.executeSelectiveDiscovery({
    previewProfiles: [preview("fails"), preview("must-not-run")],
    filters: filters({}),
    alumni: [],
    rejectedCandidates: [],
    capabilities: capabilities.CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES,
    requestedCount: 2,
    maximumCollects: 2,
    collect: async () => { calls += 1; throw new Error("controlled failure") },
  }), /controlled failure/)
  assert.equal(calls, 1)
})

test("company/year/seniority/programme criteria retain independent evidence states", () => {
  const candidate = preview("matrix")
  const combinations = [
    [filters({ discoveryProgrammes: [], graduationYear: "", seniority: "All levels" }), ["MATCH", "NOT_REQUESTED", "NOT_REQUESTED", "NOT_REQUESTED"]],
    [filters({ discoveryProgrammes: [], seniority: "All levels" }), ["MATCH", "NOT_REQUESTED", "NEEDS_COLLECT", "NOT_REQUESTED"]],
    [filters({ discoveryProgrammes: [], graduationYear: "" }), ["MATCH", "MATCH", "NOT_REQUESTED", "NOT_REQUESTED"]],
    [filters({}), ["MATCH", "MATCH", "NEEDS_COLLECT", "SEARCH_CONSTRAINED_NOT_VERIFIED"]],
    [filters({ company: "", discoveryProgrammes: [], graduationYear: "2013" }), ["NOT_REQUESTED", "MATCH", "NEEDS_COLLECT", "NOT_REQUESTED"]],
  ]
  for (const [requested, expected] of combinations) {
    const qualified = execution.qualifyPreviewCandidate(candidate, requested)
    assert.deepEqual([qualified.company.result, qualified.seniority.result, qualified.graduationYear.result, qualified.programme.result], expected)
  }
})

test("selective execution is deterministic, provider-injected, and never mutates canonical inputs", async () => {
  const people = [{ id: 99, name: "Existing", linkedinUrl: "https://linkedin.com/in/existing" }]
  const before = structuredClone(people)
  const { result } = await run([preview("new-safe")], { alumni: people })
  assert.deepEqual(people, before)
  assert.equal(result.candidates[0].profile.providerPersonId, "new-safe")
  assert.equal(result.candidates[0].profile.eligibleForAddition, false)
})
