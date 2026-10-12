import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const routeApi = await readFile(new URL("../app/api/outreach-route/route.ts", import.meta.url), "utf8")
const fixture = await readFile(new URL("../scripts/local-development-fixture.sql", import.meta.url), "utf8")

test("shared navigation exposes an obvious compact sticky active state", () => {
  assert.match(styles, /\.product-tabs\s*\{\s*display:\s*contents;/)
  assert.match(styles, /\.main-tabs\s*\{[^}]*position:\s*sticky[^}]*box-shadow:/s)
  assert.match(styles, /\.main-tabs \[data-slot="tabs-trigger"\]\[data-state="active"\]\s*\{[^}]*color:\s*#8c1d2c/s)
  assert.match(styles, /\.main-tabs \[data-slot="tabs-trigger"\]\[data-state="active"\]::after/)
})

test("Overview renders distinct zero and actionable Professional Signals states", () => {
  assert.match(page, /signal-panel-active/)
  assert.match(page, /signal-panel-empty/)
  assert.match(page, /No signals requiring review/)
  assert.match(page, /actionableProfessionalEvents\.slice\(0, 3\)/)
  assert.match(page, /openEngagementFromOverview\(event\)/)
  assert.match(page, /engagementEventUrl\(window\.location\.href, event\.id\)/)
  assert.match(fixture, /local-priya-promotion-signal/)
})

test("Overview birthday zero state is compact and reports ready-for-review work", () => {
  assert.match(page, /birthday-overview-empty/)
  assert.match(page, /reviewableBirthdaysNextWeek\.length} ready for review/)
  assert.match(styles, /\.birthday-overview-empty\s*\{[^}]*padding-block:/s)
})

test("Overview uses searchable company and globally discoverable active-alumnus selectors with deterministic ranking", () => {
  assert.match(page, /<CompanyCombobox options=\{companies\}/)
  assert.match(page, /<AlumnusCombobox options=\{routeEligibleAlumni}/)
  assert.match(page, /preferredCompany=\{overviewCompany\}/)
  assert.doesNotMatch(page, /overview-target-alumni|<datalist id="overview-target-alumni"/)
  assert.match(page, /Top alumni for outreach/)
  assert.match(page, /a\.name\.localeCompare\(b\.name\)/)
  assert.doesNotMatch(page, /Who do you want to reach\?/)
  assert.doesNotMatch(page, /Search mapped alumni/)
})

test("route diagram adapts between warm and direct layouts without horizontal clipping", () => {
  assert.match(page, /route-flow-\$\{routeRecommendation\.routeType/)
  assert.match(page, /routeRecommendation\.intermediary &&/)
  assert.match(styles, /\.route-flow-warm\s*\{[^}]*grid-template-columns:/s)
  assert.match(styles, /\.route-dialog\s*\{[^}]*width:\s*min\(920px,[^}]*overflow-x:\s*hidden/s)
  assert.match(styles, /@media[^}]+max-width:\s*768px[\s\S]*\.route-dialog-flow, \.route-flow-warm\s*\{\s*grid-template-columns:\s*1fr/)
})

test("route explanation and profile actions use business language and stored evidence", () => {
  assert.match(page, /Why this route\?/)
  assert.match(page, /Relationship evidence/)
  assert.match(page, /View \{routeRecommendation\.intermediary\.name\}/)
  assert.match(page, /View \{routeRecommendation\.target\.name\}/)
  assert.match(routeApi, /successfulIntroductions/)
  assert.doesNotMatch(routeApi, /ensureDemoRelationship/)
  assert.doesNotMatch(routeApi, /db\.insert\(alumniRelationships\)/)
  assert.doesNotMatch(page, /PlaceCom/)
})

test("KPI help reflects the shared implemented definitions", () => {
  assert.match(page, /Requires a confirmed profile match, verified current company, verified or likely designation, and at least one verified email or phone/)
  assert.match(page, /Includes shared outreach states Contacted, Responded, and Meeting set/)
  assert.match(page, /const activeOutreach = alumni\.filter\(person => isActiveOutreach\(person\.status\)\)/)
  assert.match(page, /<TooltipTrigger asChild>/)
})
