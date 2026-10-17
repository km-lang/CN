import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const api = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")
const fixture = await readFile(new URL("../scripts/local-development-fixture.sql", import.meta.url), "utf8")
const readiness = await readFile(new URL("../lib/runtime-readiness.ts", import.meta.url), "utf8")

test("Signals acquisition is rendered only inside its queue", () => {
  assert.match(page, /engagementFilter === "Professional Signals" && <>/)
  assert.match(page, /Selecting an alumnus never calls Lusha/)
  assert.match(page, /Check for signals/)
  assert.match(readiness, /Signals disabled in local development/)
})

test("engagement summaries select their corresponding queues", () => {
  for (const queue of ["Professional Signals", "Birthdays", "Assigned to Me", "Follow-ups"]) {
    assert.match(page, new RegExp(`setEngagementFilter\\(\"${queue}\"\\)`))
  }
})

test("desktop engagement rows use balanced semantic columns", () => {
  assert.match(styles, /\.engagement-card\s*\{[^}]*grid-template-columns:\s*minmax\(190px,[^}]*minmax\(240px,[^}]*minmax\(170px,/s)
  for (const className of ["event-identity", "event-copy", "event-context", "event-state", "event-actions"]) assert.match(page, new RegExp(`className=\"${className}`))
  assert.doesNotMatch(styles, /\.engagement-card\s*\{[^}]*minmax\(150px,\s*\.35fr\)/s)
})

test("birthday rows expose eligibility and disabled preview guidance", () => {
  assert.match(page, /Select at least one eligible birthday engagement to preview emails/)
  assert.match(page, /Cannot email — \$\{event\.preference === "Unknown" \? "birthday permission unknown"/)
  assert.match(fixture, /local-priya-birthday-2026/)
  assert.match(fixture, /local-sahil-birthday-2026/)
})

test("completed is terminal on both client and server", () => {
  assert.match(api, /terminalStatuses = new Set\(\["Action Taken", "Response Received", "Closed", "Completed", "Skipped"\]\)/)
  assert.match(page, /isCompletedEngagement\(event\.status\)/)
})

test("Outreach counters and filters share the displayed result set", () => {
  assert.match(page, /setOutreachStatus\(status\)/)
  assert.match(page, /const visibleOutreach = outreachRows/)
  assert.match(page, /75–100/)
  assert.match(page, /50–74/)
  assert.match(page, /Below 50/)
  assert.match(page, /clearOutreachFilters/)
  assert.match(page, /Why this alumnus\?/)
  assert.match(page, /No outreach rationale recorded\./)
})

test("local engagement fixtures cover signal, birthday, follow-up, ownership, completed and skipped queues", () => {
  for (const value of ["Professional Signal", "Birthday", "Follow-up Due", "assigned_to", "Completed", "Skipped"]) assert.match(fixture, new RegExp(value))
  assert.match(fixture, /'Example Company', 'Low Priority'/)
})

test("completed historical email is not classified as a Professional Signal", () => {
  assert.match(fixture, /'local-fixture-sahil-completed-email',[\s\S]*?'Manual Relationship',[\s\S]*?'Completed historical email'/)
})
