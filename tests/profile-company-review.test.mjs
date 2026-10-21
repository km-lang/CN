import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const workspace = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const scorer = await readFile(new URL("../lib/placement-relevance.ts", import.meta.url), "utf8")

test("legacy data-quality state remains visible and controls are labelled", () => {
  assert.match(page, /Professional data quality/)
  assert.match(page, /<span>Status<\/span>/)
  assert.match(page, /Reviewed \(legacy\)/)
  assert.match(workspace, /"Needs assessment", "Reviewed", "Current"/)
  assert.doesNotMatch(page, /<section className="profile-section data-quality-section"><h3>/)
})

test("profile uses progressive disclosure without changing score weights", () => {
  assert.match(page, /<summary>Why this score\?<\/summary>/)
  assert.match(page, /<summary>Edit assessment<\/summary>/)
  assert.match(page, /Company priority[\s\S]*Inherited from company settings/)
  assert.match(page, /calculatePlacementRelevance/)
  assert.match(scorer, /hiringInfluence: 30/)
  assert.match(styles, /\.profile-order-verification\s*\{\s*order:\s*7/)
})

test("completed engagement is history and never needs attention", () => {
  assert.match(page, /function isCompletedEngagement/)
  assert.match(page, /"Completed"/)
  assert.match(page, /selectedUpcomingEngagements = selectedEngagementHistory\.filter\(event => !isCompletedEngagement/)
  assert.match(page, /selectedCompletedEngagements = selectedEngagementHistory\.filter\(event => isCompletedEngagement/)
  assert.match(page, /No open engagement items need attention/)
})

test("contact permissions retain the global ceiling and purpose-specific fields", () => {
  assert.match(page, /Overall contact permission/)
  assert.match(page, /Professional outreach/)
  assert.match(page, /Birthday outreach/)
  assert.match(page, /Permission source/)
  assert.match(page, /The server checks the overall ceiling and the purpose-specific permission/)
})

test("company priority remains Admin-only and company history uses stored engagements", () => {
  assert.match(page, /disabled=\{!session\.canAdminister\}/)
  assert.match(workspace, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(page, /Company Priority contributes to Placement Relevance/)
  assert.match(page, /companyHistoryPagination\.items\.map/)
  assert.match(page, /Company account history pagination/)
})

test("contact enrichment avoids repurchasing already verified channels", () => {
  assert.match(page, /function missingLushaChannels/)
  assert.match(page, /selected\.verification\.email === "Verified"/)
  assert.match(page, /runEnrichment\(\[selected\.id\], \["lusha"\], "manual", missing\)/)
})
