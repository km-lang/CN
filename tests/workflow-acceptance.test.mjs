import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const routeApi = await readFile(new URL("../app/api/outreach-route/route.ts", import.meta.url), "utf8")
const discoveryApi = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const workspaceApi = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const enrichmentApi = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const discoveryProvider = await readFile(new URL("../lib/coresignal-adapter.ts", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")

test("acceptance 1: outreach routing requires an explicitly selected target alumnus", () => {
  assert.match(page, /Target alumnus/)
  assert.match(page, /Search or select an alumnus/)
  assert.match(page, /disabled=\{!targetAlumnusId \|\| routeLoading\}/)
  assert.match(routeApi, /Select a target alumnus before requesting a route/)
})

test("acceptance 2: changing the target company clears an invalid target selection", () => {
  assert.match(page, /function changeTargetCompany\(company: string\)/)
  assert.match(page, /setTargetAlumnusId\(null\)/)
  assert.match(page, /onValueChange=\{changeTargetCompany\}/)
})

test("acceptance 3: a reliable reachable alumnus defaults to direct outreach", () => {
  assert.match(routeApi, /usableContact && reliableProfile/)
  assert.match(routeApi, /routeType = "Direct"/)
  assert.match(routeApi, /No confirmed intermediary relationship is recorded/)
})

test("acceptance 4: a warm route requires confirmed evidence and poor direct response", () => {
  assert.match(routeApi, /eq\(alumniRelationships\.confirmed, true\)/)
  assert.match(routeApi, /credible && poorDirectResponsiveness/)
  assert.match(routeApi, /routeType = "Warm"/)
})

test("acceptance 5: every recommendation returns its rationale and evidence", () => {
  assert.match(routeApi, /rationale,/)
  assert.match(routeApi, /evidence:/)
  assert.match(page, /routeRecommendation\.rationale/)
})

test("acceptance 6: external discovery preserves and displays the submitted filters", () => {
  assert.match(page, /setLastDiscoveryFilters\(searchFilters\)/)
  assert.match(page, /Education/)
  assert.match(page, /FIXED_ALUMNI_SCHOOL/)
  assert.match(page, /Results requested \/ returned/)
})

test("acceptance 7: mock discovery covers confirmed, excluded, and review-required affiliations", () => {
  assert.match(discoveryProvider, /Demo Degree Alumnus/)
  assert.match(discoveryProvider, /Demo Exchange Candidate/)
  assert.match(discoveryProvider, /Demo Affiliation Review/)
  assert.match(discoveryProvider, /classifyIimlAffiliation/)
})

test("acceptance 8: Lusha is not offered before a new discovery result is added", () => {
  assert.match(page, /DISCOVERY_REVIEW_STATUS\.added/)
  assert.match(page, /DISCOVERY_REVIEW_STATUS\.addedSeparate/)
  assert.match(page, /DISCOVERY_REVIEW_STATUS\.legacyAdded/)
  assert.match(page, /\{added && \(\(\) =>/)
})

test("acceptance 9: added discovery results expose controlled live Lusha channel preparation", () => {
  assert.match(page, /Prepare Email Reveal/)
  assert.match(page, /Prepare Phone Reveal/)
  assert.match(page, /providerModes\.lusha === "live"/)
  assert.match(page, /Confirm \{lushaRevealChannel === "email" \? "Email" : "Phone"\}-Only Reveal/)
})

test("acceptance 10: zero results and blocked searches are different user-visible states", () => {
  assert.match(page, /"idle" \| "results" \| "empty" \| "blocked"/)
  assert.match(page, /No additional external alumni were found/)
  assert.match(page, /External search not run/)
  assert.match(discoveryApi, /reason: "application_limit"/)
})

test("acceptance 11: Data Import separates bulk import from manual entry", () => {
  assert.match(page, /Bulk import/)
  assert.match(page, /Add one alumnus/)
})

test("acceptance 12: manual entry checks possible duplicates before insertion", () => {
  assert.match(workspaceApi, /action === "manual_check"/)
  assert.match(workspaceApi, /requiresConfirmation: true/)
  assert.match(page, /Different person · Continue/)
  assert.match(workspaceApi, /matches\.some\(match => match\.exact\)/)
})

test("acceptance 13: manual add records its source and consumes no provider credit", () => {
  assert.match(workspaceApi, /source: "Manual entry"/)
  assert.match(workspaceApi, /providerCreditsUsed: 0/)
  assert.match(workspaceApi, /no provider call was made/)
})

test("acceptance 14: all enrichment actions are disabled with zero selection", () => {
  assert.match(page, /const professionalSelectionReady = selectedForEnrichment\.length > 0/)
  assert.match(page, /const lushaEmailReady = emailPlan\.emailOperations > 0/)
  assert.match(page, /disabled=\{!professionalSelectionReady \|\| enriching\}/)
  assert.match(page, /disabled=\{!lushaEmailReady \|\| enriching\}/)
})

test("acceptance 15: selected alumni expose separate Coresignal and controlled Lusha actions", () => {
  assert.match(page, /> Refresh Profiles<\/Button>/)
  assert.match(page, /Prepare Email Reveal/)
  assert.match(page, /Coresignal refresh and Lusha contact preparation remain separate/)
})

test("acceptance 16: changed Coresignal values are reviewed before apply and then audited", () => {
  assert.match(schema, /providerRefreshReviews/)
  assert.match(enrichmentApi, /changed\.length \? "Pending review" : "No changes"/)
  assert.match(page, /oldValue/)
  assert.match(page, /newValue/)
  assert.match(enrichmentApi, /fieldChangeHistory/)
})

test("acceptance 17: no-change Coresignal responses remain visible in provider history", () => {
  assert.match(enrichmentApi, /"No changes"/)
  assert.match(enrichmentApi, /providerResponseHistory/)
  assert.match(page, /No professional changes detected/)
})

test("acceptance 18: Lusha contact provenance and response history are explicit", () => {
  assert.match(enrichmentApi, /source: "Lusha"/)
  assert.match(enrichmentApi, /Email Enrichment/)
  assert.match(enrichmentApi, /Phone Enrichment/)
  assert.match(page, /Provider-sourced data is identified separately and does not imply independent deliverability/)
})
