import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const evidence = await vite.ssrLoadModule("/lib/discovery-candidate-evidence.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

const filters = () => ({ ...search.defaultDiscoveryFilters(), discoveryProgrammes: ["PGP"], company: "Google", graduationYear: "2011", seniorities: ["VP+"], seniority: "All levels" })
const observed = overrides => ({
  sourceType: "LINKEDIN_PROFILE",
  sourceUrl: "https://www.linkedin.com/in/reviewed-person",
  profileUrl: "https://www.linkedin.com/in/reviewed-person",
  observedInstitution: "Indian Institute of Management Lucknow",
  educationStartYear: 2009,
  educationEndYear: 2011,
  graduationYear: 2011,
  programme: "PGP",
  currentCompany: "Google",
  currentDesignation: "Vice President, Product",
  seniority: "VP",
  location: "Bengaluru",
  verificationReason: "The reviewed public profile independently shows this education and current employment.",
  ...overrides,
})
const providerUrl = "https://linkedin.com/in/reviewed-person/?trk=provider"

test("every selected criterion is verified independently and unselected fields are NOT_REQUESTED", () => {
  const decisions = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed()), filters(), providerUrl, new Date("2026-10-19"))
  for (const field of evidence.requiredEvidenceFields(filters())) assert.equal(decisions[field], "MATCH", field)
  for (const field of evidence.EVIDENCE_FIELDS.filter(item => !evidence.requiredEvidenceFields(filters()).includes(item))) assert.equal(decisions[field], "NOT_REQUESTED", field)
  assert.equal(evidence.candidateEvidenceOutcome(decisions), "SUPPORTS")
})

test("title seniority mismatch cannot be marked Match by the reviewer", () => {
  const decisions = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed({ currentDesignation: "Account Executive", seniority: "VP" })), filters(), providerUrl)
  assert.equal(decisions.seniority, "MISMATCH")
  assert.equal(evidence.candidateEvidenceOutcome(decisions), "REJECTS")
  assert.throws(() => evidence.validateReviewerDecisions({ ...decisions, seniority: "MATCH" }, decisions), /cannot be marked MATCH/)
})

test("ambiguous current title and unknown programme remain unverified", () => {
  const decisions = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed({ currentDesignation: "Various", programme: "" })), filters(), providerUrl)
  assert.equal(decisions.seniority, "UNVERIFIED")
  assert.equal(decisions.programme, "UNVERIFIED")
  assert.equal(evidence.candidateEvidenceOutcome(decisions), "INSUFFICIENT")
})

test("review evidence honors current programme selection aliases without conflating categories", () => {
  const smFilters = { ...filters(), discoveryProgrammes: ["PGP-SM"] }
  const sm = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed({ programme: "PGP-SM" })), smFilters, providerUrl)
  const genericMba = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed({ programme: "MBA" })), smFilters, providerUrl)
  assert.equal(sm.programme, "MATCH")
  assert.equal(genericMba.programme, "MISMATCH")
})

test("wrong year and different LinkedIn identity are mismatches", () => {
  const decisions = evidence.candidateEvidenceDecisions(evidence.normalizeCandidateObservation(observed({ graduationYear: 2012, educationEndYear: 2012, profileUrl: "https://www.linkedin.com/in/another-person", sourceUrl: "https://www.linkedin.com/in/another-person" })), filters(), providerUrl)
  assert.equal(decisions.graduationYear, "MISMATCH")
  assert.equal(decisions.identity, "MISMATCH")
})

test("invalid source, malformed profile, and contradictory education years are rejected", () => {
  assert.throws(() => evidence.normalizeCandidateObservation(observed({ sourceUrl: "http://localhost/private" })), /HTTPS/)
  assert.throws(() => evidence.normalizeCandidateObservation(observed({ profileUrl: "https://example.com/person" })), /LinkedIn/)
  assert.throws(() => evidence.normalizeCandidateObservation(observed({ educationEndYear: 2012 })), /agree/)
})

test("additive migration preserves previous rows and enforces result FK and replay uniqueness", async () => {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE external_discovery_searches (id INTEGER PRIMARY KEY); CREATE TABLE external_discovery_results (id INTEGER PRIMARY KEY); CREATE TABLE application_users (id INTEGER PRIMARY KEY);")
  db.exec("INSERT INTO external_discovery_searches VALUES (9); INSERT INTO external_discovery_results VALUES (91); INSERT INTO application_users VALUES (1);")
  const migration = await readFile(new URL("../drizzle/0018_boring_meltdown.sql", import.meta.url), "utf8")
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:DROP|DELETE|ALTER)\b/im)
  db.exec(migration.replaceAll("--> statement-breakpoint", ""))
  assert.equal(db.prepare("SELECT count(*) AS count FROM external_discovery_results").get().count, 1)
  const insert = db.prepare("INSERT INTO external_discovery_candidate_evidence (search_id, result_id, provider, provider_person_id, source_type, source_url, source_provenance, decisions_json, reviewer_decision, verification_reason, reviewer_user_id, reviewer_name, request_key, reviewed_at) VALUES (9, ?, 'coresignal', '123', 'LINKEDIN_PROFILE', 'https://linkedin.com/in/example', 'HUMAN_ENTERED', '{}', 'SUPPORTS', 'Independent education and identity evidence', 1, 'Reviewer', ?, '2026-10-19')")
  insert.run(91, "first")
  assert.throws(() => insert.run(91, "first"), /UNIQUE/)
  insert.run(91, "second")
  assert.equal(db.prepare("SELECT count(*) AS count FROM external_discovery_candidate_evidence").get().count, 2)
  assert.throws(() => insert.run(999, "third"), /FOREIGN KEY/)
  db.close()
})

test("review writes are authorized, audited, and provider free in the existing discovery workflow", () => {
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(route, /payload\.action === "record_evidence"/)
  assert.match(route, /db\.batch\(\[insertEvidence, audit\]\)/)
  assert.match(route, /payload\.action === "link_existing"/)
  assert.match(route, /supportingHumanEvidence\(evidence, result, nowDate\)/)
  assert.match(route, /identity\.classification !== "NEW_CANDIDATE"/)
  assert.match(route, /Only independently verified selected fields can be applied/)
  assert.match(route, /company: evidence\.currentCompany, title: evidence\.currentDesignation/)
  assert.match(route, /sql`changes\(\) = 1`/)
  assert.match(page, /Save reviewer evidence/)
  assert.match(page, /View saved evidence/)
  assert.match(page, /Close evidence/)
  assert.match(page, /Independent verification required/)
  assert.match(page, /Confirm existing identity/)
  assert.match(page, /Approve identity and add alumnus/)
})
