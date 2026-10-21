import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const { assessProvisionalIntake, provisionalAlumnusValues } = await vite.ssrLoadModule("/lib/provisional-intake.ts")
const { effectiveIntakeStatus } = await vite.ssrLoadModule("/lib/intake-status.ts")
const route = await readFile(new URL("../app/api/discovery/intake/route.ts", import.meta.url), "utf8")
const directory = await readFile(new URL("../lib/directory-data.ts", import.meta.url), "utf8")
const enrichment = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const workspace = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const migration = await readFile(new URL("../drizzle/0019_bored_jackal.sql", import.meta.url), "utf8")

function candidate(overrides = {}) {
  return { id: 101, searchId: 11, provider: "coresignal", providerPersonId: "599153008", name: "Synthetic K.",
    linkedinUrl: "https://www.linkedin.com/in/synthetic-k/", reviewStatus: "Pending review", matchStatus: "Needs review", providerIntegrity: "consistent", ...overrides }
}

test("Search #11-shaped abbreviated name can enter provisional intake without inferred full name", () => {
  const decision = assessProvisionalIntake([candidate()], [])
  assert.equal(decision[0].decision, "ELIGIBLE")
  const values = provisionalAlumnusValues(candidate(), "Test PCOM", "2026-10-20T00:00:00Z")
  assert.equal(values.name, "Synthetic K.")
  assert.equal(values.intakeStatus, "PROVISIONAL")
  assert.equal(values.graduationYear, 0)
  assert.equal(values.batch, 0)
  assert.equal(values.programme, "Unknown")
  assert.equal(values.education, "Unknown")
  assert.equal(values.company, "Unknown")
  assert.equal(values.emailVerification, "Unverified")
  assert.equal(values.status, "Not contacted")
})

test("stable provider ID and LinkedIn identity are both required", () => {
  assert.equal(assessProvisionalIntake([candidate({ providerPersonId: "" })], [])[0].decision, "REVIEW_REQUIRED")
  assert.equal(assessProvisionalIntake([candidate({ linkedinUrl: "" })], [])[0].decision, "REVIEW_REQUIRED")
  assert.equal(assessProvisionalIntake([candidate({ linkedinUrl: "synthetic-k" })], [])[0].decision, "REVIEW_REQUIRED")
  assert.equal(assessProvisionalIntake([candidate({ linkedinUrl: "https://example.com/person" })], [])[0].decision, "REVIEW_REQUIRED")
})

test("abbreviated names never auto-merge with plausible existing full names", () => {
  const known = [{ id: 1, name: "Synthetic Kumar", coresignalEmployeeId: "", linkedinUrl: "" }]
  assert.equal(assessProvisionalIntake([candidate()], known)[0].decision, "REVIEW_REQUIRED")
})

test("known matching stable identifiers are idempotently excluded", () => {
  const known = [{ id: 1, name: "Synthetic K.", coresignalEmployeeId: "599153008", linkedinUrl: "https://linkedin.com/in/synthetic-k" }]
  assert.equal(assessProvisionalIntake([candidate()], known)[0].decision, "ALREADY_PRESENT")
})

test("disagreeing trusted identifiers require review", () => {
  const known = [
    { id: 1, name: "First Person", coresignalEmployeeId: "599153008", linkedinUrl: "" },
    { id: 2, name: "Second Person", coresignalEmployeeId: "", linkedinUrl: "https://linkedin.com/in/synthetic-k" },
  ]
  assert.equal(assessProvisionalIntake([candidate()], known)[0].decision, "REVIEW_REQUIRED")
})

test("mixed selected batch excludes duplicate identity, conflicts and rejected evidence", () => {
  const rows = [candidate(), candidate({ id: 102, providerPersonId: "599153008", name: "Second Person", linkedinUrl: "https://linkedin.com/in/second" }),
    candidate({ id: 103, providerPersonId: "123", name: "Third Person", linkedinUrl: "https://linkedin.com/in/third", latestEvidenceDecision: "REJECTS" }),
    candidate({ id: 104, providerPersonId: "124", name: "Fourth Person", linkedinUrl: "https://linkedin.com/in/fourth", reviewNote: "SKIPPED_FILTER_MISMATCH: company" })]
  assert.deepEqual(assessProvisionalIntake(rows, []).map(row => row.decision), ["ELIGIBLE", "REVIEW_REQUIRED", "REVIEW_REQUIRED", "REVIEW_REQUIRED"])
})

test("provider mismatch, existing link and untrusted name are review exceptions", () => {
  assert.equal(assessProvisionalIntake([candidate({ providerIntegrity: "provider_mismatch" })], [])[0].decision, "REVIEW_REQUIRED")
  assert.equal(assessProvisionalIntake([candidate({ linkedInternalAlumnusId: 9 })], [])[0].decision, "ALREADY_PRESENT")
  assert.equal(assessProvisionalIntake([candidate({ name: "K." })], [])[0].decision, "REVIEW_REQUIRED")
})

test("server requires PCOM permission, a dry-run preflight and explicit execution confirmation", () => {
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(route, /payload\.action === "preflight"/)
  assert.match(route, /payload\.confirmed !== true/)
  assert.match(route, /providerCalls: 0/)
  assert.match(route, /db\.batch\(/)
  assert.match(route, /count\(\*\) from alumni where rtrim\(lower\(linkedin_url\), '\/'\)/)
  assert.match(route, /external_candidate_provisionally_added/)
  assert.doesNotMatch(route, /previewCoresignal|collectCoresignal|fetch\(/)
})

test("migration is additive and enforces single stable intake identity", () => {
  assert.match(migration, /ALTER TABLE `alumni` ADD `intake_status`/)
  assert.match(migration, /CREATE TABLE `provisional_alumni_intakes`/)
  assert.match(migration, /CREATE UNIQUE INDEX `idx_provisional_intake_provider_person`/)
  assert.match(migration, /CREATE UNIQUE INDEX `idx_provisional_intake_profile`/)
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE `alumni`|CREATE `__new_/)
})

test("Directory shows status and excludes provisional claims from trusted operational uses", () => {
  assert.match(directory, /intakeStatus: effectiveIntakeStatus\(row\)/)
  assert.match(directory, /f\.profileStatus !== "All profiles"/)
  assert.match(page, /UNVERIFIED \/ PROVISIONAL/)
  assert.match(page, /Add eligible selected profiles/)
  assert.match(page, /Review exceptions/)
  assert.match(page, /excludeProvisional: true/)
  assert.match(page, /View Directory profile/)
  assert.match(page, /selected\.intakeStatus === "PROVISIONAL" \? "Not assessed"/)
  assert.match(workspace, /Provisional profiles require review before outreach status can change/)
  assert.match(enrichment, /if \(people\.some\(person => person\.intakeStatus === "PROVISIONAL"\)\)/)
  assert.match(workspace, /effectiveIntakeStatusSql/)
})

test("legacy verified alumni retain verified presentation without modifying their stored row", () => {
  assert.equal(effectiveIntakeStatus({ intakeStatus: "REVIEW_REQUIRED", verified: "Locally verified" }), "VERIFIED")
  assert.equal(effectiveIntakeStatus({ intakeStatus: "REVIEW_REQUIRED", verified: "Human-reviewed external candidate · 2026-10-20" }), "VERIFIED")
  assert.equal(effectiveIntakeStatus({ intakeStatus: "REVIEW_REQUIRED", verified: "Profile checked via PDL · 2026-09-25" }), "REVIEW_REQUIRED")
  assert.equal(effectiveIntakeStatus({ intakeStatus: "PROVISIONAL", verified: "Locally verified" }), "PROVISIONAL")
})
