import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())

const collect = await vite.ssrLoadModule("/lib/coresignal-collect-only.ts")
const searchEvidence = await vite.ssrLoadModule("/lib/coresignal-search-evidence.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")
const localDevelopment = await vite.ssrLoadModule("/lib/local-development.ts")

function retainedEvidence({ employeeId = "289351894", routes, ids } = {}) {
  const employeeIds = ids ?? [employeeId]
  const identityRoutes = routes ?? employeeIds.map(id => ({ employeeId: id, routingState: "IDENTITY_RESOLUTION_REQUIRED", mappedAlumnusId: null, canonicalLinkedinUrl: null, identityResolutionRequired: true, nextProviderAction: "UNDECIDED", profileFreshness: "NOT_EVALUATED", reason: "No durable mapping." }))
  return searchEvidence.createCoresignalSearchEvidence({
    attemptId: "search-attempt-1",
    filters: { ...search.defaultDiscoveryFilters(), company: "Lincoln International", graduationYear: "2011" },
    institutionId: 25919228,
    itemsPerPage: Math.max(1, employeeIds.length),
    requestedAt: "2026-10-17T02:49:13.567Z",
    completedAt: "2026-10-17T02:49:15.015Z",
    execution: {
      upstreamHttpStatus: 200,
      searchMode: "CURRENT_COMPANY_EXACT_GRADUATION_YEAR",
      companyMapping: { providerCompanyId: 8469989 },
      providerCreditsRemaining: 4950,
      routing: { providerSearch: { totalResults: employeeIds.length, pageIdsReceived: employeeIds.length, totalPages: 1, nextPageAfter: employeeId }, routes: identityRoutes },
    },
  })
}

function history(options = {}) {
  const evidence = options.evidence ?? retainedEvidence()
  return {
    id: 14,
    provider: options.provider ?? "coresignal",
    operation: options.operation ?? "Base Employee ES-DSL Search",
    mode: options.mode ?? "live",
    status: options.status ?? "success",
    createdAt: "2026-10-17 02:49:15",
    responseSummary: options.responseSummary ?? searchEvidence.serializeCoresignalSearchEvidence("One Search request succeeded.", evidence),
  }
}

function candidate(options = {}) { return collect.candidateFromSearchHistory(history(options), options.employeeId ?? "289351894", options.priorCollectStatus ?? null) }
function runtime(options = {}) { return { configured: true, providerLiveMode: true, transportMode: "mock", collectGateEnabled: true, entitlement: "confirmed", applicationUnitsRemaining: 25, maximumRequests: 1, ...options } }
function profile(options = {}) {
  return {
    id: options.id ?? 289351894,
    full_name: "Synthetic Review Candidate",
    profile_url: "https://www.linkedin.com/in/synthetic-review-candidate",
    location_full: "Chicago, United States",
    checked_at: "2026-10-10T00:00:00Z",
    education: options.education ?? [{ institution_id: 25919228, institution_name: "Indian Institute of Management Lucknow", degree_name: "PGP", date_to_year: 2011, deleted: 0 }],
    experience: options.experience ?? [{ company_id: 8469989, company_name: "Lincoln International", title: "Director", is_current: 1, deleted: 0, date_from: "2024-01" }, { company_id: 7, company_name: "Prior Employer", title: "Manager", is_current: 0, deleted: 0, date_from: "2020", date_to: "2023" }],
  }
}

function memoryStore({ duplicate = false } = {}) {
  const writes = { acquired: 0, completed: 0, failed: 0, failureStatus: null, evidence: null, transportMode: null }
  return {
    writes,
    store: {
      acquire: async input => { writes.acquired += 1; writes.transportMode = input.transportMode; return duplicate || writes.acquired > 1 ? { acquired: false } : { acquired: true, claimId: 44 } },
      complete: async input => { writes.completed += 1; writes.evidence = input.evidence; return true },
      fail: async input => { writes.failed += 1; writes.failureStatus = input.status; return true },
    },
  }
}

test("valid retained Employee ID is eligible evidence without hard-coding the candidate", () => {
  const result = candidate()
  assert.equal(result.employeeId, "289351894")
  assert.equal(result.searchHistoryId, 14)
  assert.equal(result.identityResolutionStatus, "IDENTITY_RESOLUTION_REQUIRED")
})

test("known alumnus Collect derives the exact saved ID without any Search or paid lookup", () => {
  const known = collect.candidateFromKnownAlumnus({ id: 7, coresignalEmployeeId: "289351894", createdAt: "2026-10-17T00:00:00Z" }, null)
  assert.equal(known.sourceAlumnusId, 7)
  assert.equal(known.searchHistoryId, 0)
  assert.equal(known.searchOperation, "Known alumnus identity")
  assert.equal(known.employeeId, "289351894")
  assert.equal(collect.collectPreflight(known, runtime({ entitlement: "unknown" })).allowed, false)
  assert.throws(() => collect.candidateFromKnownAlumnus({ id: 7, coresignalEmployeeId: "", createdAt: "" }, null), /valid Coresignal Employee ID/)
})

test("known-ID comparison distinguishes no change, proposals, missing role and conflicting profile identity", () => {
  const known = collect.candidateFromKnownAlumnus({ id: 7, coresignalEmployeeId: "289351894", createdAt: "2026-10-17T00:00:00Z" }, null)
  const evidence = collect.sanitizeCollectResponse({ body: profile(), candidate: known, attemptId: "a", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: null })
  const person = { coresignalEmployeeId: "289351894", linkedinUrl: "https://linkedin.com/in/synthetic-review-candidate/", company: "Lincoln International", title: "Director", location: "Chicago, United States" }
  assert.equal(collect.knownAlumnusCollectChanges(person, evidence).outcome, "NO_CHANGE")
  assert.deepEqual(collect.knownAlumnusCollectChanges({ ...person, company: "Old Co" }, evidence).changes.map(item => item.field), ["company"])
  assert.equal(collect.knownAlumnusCollectChanges({ ...person, linkedinUrl: "https://www.linkedin.com/in/a-different-person" }, evidence).outcome, "IDENTITY_CONFLICT")
  assert.deepEqual(collect.knownAlumnusCollectChanges({ ...person, linkedinUrl: "https://www.linkedin.com/in/a-different-person" }, evidence).changes, [])
  const missingRole = { ...evidence, employment: [] }
  assert.equal(collect.knownAlumnusCollectChanges(person, missingRole).outcome, "INSUFFICIENT_CURRENT_ROLE")
})

test("unknown or absent Employee IDs and historical Search without evidence fail closed", () => {
  assert.throws(() => candidate({ employeeId: "123456" }), /absent/)
  assert.throws(() => candidate({ responseSummary: "Historical Search succeeded." }), /retained/)
  assert.throws(() => candidate({ provider: "pdl" }), /eligible successful live Coresignal Search/)
})

test("resolved or conflicting provider identity cannot enter Collect-only workflow", () => {
  const evidence = retainedEvidence({ routes: [{ employeeId: "289351894", routingState: "IDENTITY_REVIEW_REQUIRED", mappedAlumnusId: null, profileFreshness: "NOT_EVALUATED" }] })
  assert.throws(() => candidate({ evidence }), /resolved or has conflicting/)
})

test("preflight fails closed for gate, budget and account entitlement", () => {
  for (const [overrides, message] of [
    [{ collectGateEnabled: false }, /gate is disabled/],
    [{ applicationUnitsRemaining: 19 }, /fewer than 20 units/],
    [{ entitlement: "unknown" }, /entitlement is unknown/],
    [{ entitlement: "not_entitled" }, /not entitled/],
    [{ configured: false }, /authentication is not configured/],
    [{ providerLiveMode: false, transportMode: "live" }, /live mode is disabled/],
  ]) assert.match(collect.collectPreflight(candidate(), runtime(overrides)).blockers.join(" "), message)
})

test("prior claimed, successful or failed Collect remains non-replayable", () => {
  for (const status of ["in_progress", "success", "error", "ambiguous"]) assert.equal(collect.collectPreflight(candidate({ priorCollectStatus: status }), runtime()).allowed, false)
})

test("confirmation binds exact Search, Employee ID and attempt and expires", () => {
  const secret = "synthetic-test-secret-at-least-32-characters"
  const token = collect.createCollectConfirmation({ searchHistoryId: 14, employeeId: "289351894", searchAttemptId: "search-attempt-1", now: 1000, nonce: "n" }, secret)
  assert.equal(collect.verifyCollectConfirmation(token, { searchHistoryId: 14, employeeId: "289351894", searchAttemptId: "search-attempt-1", now: 2000 }, secret), true)
  assert.equal(collect.verifyCollectConfirmation(token, { searchHistoryId: 15, employeeId: "289351894", searchAttemptId: "search-attempt-1", now: 2000 }, secret), false)
  assert.equal(collect.verifyCollectConfirmation(token, { searchHistoryId: 14, employeeId: "289351895", searchAttemptId: "search-attempt-1", now: 2000 }, secret), false)
  assert.equal(collect.verifyCollectConfirmation(token, { searchHistoryId: 14, employeeId: "289351894", searchAttemptId: "search-attempt-1", now: 9999999 }, secret), false)
})

test("one approved execution calls Collect once and stores sanitized review evidence", async () => {
  const state = memoryStore(); let calls = 0
  const result = await collect.executeCollectOnce({ preflight: collect.collectPreflight(candidate(), runtime()), confirmationValid: true, actor: "Synthetic Admin", uuid: () => "collect-attempt-1", now: (() => { const values = [new Date("2026-10-17T03:00:00Z"), new Date("2026-10-17T03:00:01Z")]; return () => values.shift() })(), store: state.store, transport: async id => { calls += 1; assert.equal(id, "289351894"); return { body: profile(), upstreamHttpStatus: 200, providerCreditsRemaining: 4949 } } })
  assert.equal(calls, 1)
  assert.equal(state.writes.transportMode, "mock")
  assert.equal(result.state, "REVIEW_REQUIRED")
  assert.equal(state.writes.completed, 1)
  assert.equal(result.evidence.providerActions.searchRequests, 0)
  assert.equal(result.evidence.providerActions.collectRequests, 1)
  assert.equal(result.evidence.providerActions.canonicalMutations, 0)
  assert.equal(result.evidence.providerActions.identityAttachments, 0)
  assert.equal(result.evidence.quality.education, "PRESENT_AND_PLAUSIBLE")
  assert.equal(result.evidence.quality.currentEmployer, "PRESENT_AND_PLAUSIBLE")
  assert.doesNotMatch(JSON.stringify(result.evidence), /email|phone|apikey|secret/i)
})

test("duplicate and concurrent duplicate submissions produce zero additional provider calls", async () => {
  const state = memoryStore(); let calls = 0
  const input = { preflight: collect.collectPreflight(candidate(), runtime()), confirmationValid: true, actor: "Synthetic Admin", store: state.store, transport: async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { body: profile(), upstreamHttpStatus: 200, providerCreditsRemaining: 4949 } } }
  const [first, second] = await Promise.allSettled([collect.executeCollectOnce(input), collect.executeCollectOnce(input)])
  assert.equal(calls, 1)
  assert.equal([first, second].filter(item => item.status === "fulfilled" && item.value.state === "DUPLICATE_BLOCKED").length, 1)
})

test("the durable attempt fence follows Employee ID across different retained Search histories", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE provider_response_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, alumnus_name TEXT NOT NULL,
    search_id INTEGER, operation TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    credits_used INTEGER NOT NULL, application_units INTEGER NOT NULL, provider_reported_credits INTEGER,
    usage_state TEXT NOT NULL, result_count INTEGER NOT NULL, request_summary TEXT NOT NULL,
    response_summary TEXT NOT NULL, error_message TEXT NOT NULL, requested_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE provider_settings (provider TEXT PRIMARY KEY, monthly_credit_limit INTEGER)`)
  const statement = db.prepare(collect.CORESIGNAL_COLLECT_CLAIM_SQL)
  const summary = "Retained Search Collect-only · Employee ID 289351894"
  const bind = [14, collect.CORESIGNAL_COLLECT_OPERATION, "mock", 20, summary, "claim", "Admin", collect.CORESIGNAL_COLLECT_OPERATION, summary, 20, new Date().toISOString().slice(0, 7) + "-01"]
  assert.equal(statement.get(...bind).id, 1)
  assert.equal(statement.get(...bind), undefined)
  assert.equal(statement.get(99, collect.CORESIGNAL_COLLECT_OPERATION, "live", 20, "Retained Search Collect-only · Employee ID 999", "claim", "Admin", collect.CORESIGNAL_COLLECT_OPERATION, "Retained Search Collect-only · Employee ID 999", 20, bind.at(-1)), undefined)
  const retainedClaim = db.prepare("SELECT search_id, mode FROM provider_response_history").get()
  assert.equal(retainedClaim.search_id, 14)
  assert.equal(retainedClaim.mode, "mock")
  db.close()
})

test("known-alumnus and Search Collect share a durable Employee-ID replay fence", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE provider_response_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, alumnus_id INTEGER,
    alumnus_name TEXT NOT NULL, search_id INTEGER, operation TEXT NOT NULL, mode TEXT NOT NULL,
    status TEXT NOT NULL, credits_used INTEGER NOT NULL, application_units INTEGER NOT NULL,
    provider_reported_credits INTEGER, usage_state TEXT NOT NULL, result_count INTEGER NOT NULL,
    request_summary TEXT NOT NULL, response_summary TEXT NOT NULL, error_message TEXT NOT NULL,
    requested_by TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE provider_settings (provider TEXT PRIMARY KEY, monthly_credit_limit INTEGER)`)
  const summary = "Retained Search Collect-only · Employee ID 289351894"
  const known = db.prepare(collect.CORESIGNAL_KNOWN_COLLECT_CLAIM_SQL)
  const month = new Date().toISOString().slice(0, 7) + "-01"
  const knownBind = [7, "Alumnus 7", collect.CORESIGNAL_COLLECT_OPERATION, "mock", 20, summary, "claim", "Admin", collect.CORESIGNAL_COLLECT_OPERATION, summary, 20, month]
  assert.equal(known.get(...knownBind).id, 1)
  assert.equal(known.get(...knownBind), undefined)
  assert.equal(db.prepare(collect.CORESIGNAL_COLLECT_CLAIM_SQL).get(14, collect.CORESIGNAL_COLLECT_OPERATION, "mock", 20, summary, "claim", "Admin", collect.CORESIGNAL_COLLECT_OPERATION, summary, 20, month), undefined)
  assert.equal(db.prepare("select alumnus_id from provider_response_history").get().alumnus_id, 7)
  db.close()
})

test("failed preflight and invalid or replayed confirmation make no provider call", async () => {
  let calls = 0; const state = memoryStore()
  await assert.rejects(() => collect.executeCollectOnce({ preflight: collect.collectPreflight(candidate(), runtime({ entitlement: "unknown" })), confirmationValid: true, actor: "A", store: state.store, transport: async () => { calls += 1 } }), /entitlement/)
  await assert.rejects(() => collect.executeCollectOnce({ preflight: collect.collectPreflight(candidate(), runtime()), confirmationValid: false, actor: "A", store: state.store, transport: async () => { calls += 1 } }), /invalid or expired/)
  assert.equal(calls, 0)
  assert.equal(state.writes.acquired, 0)
})

test("HTTP/auth/rate-limit/timeout/malformed failures are single-attempt and retain uncertain capacity", async () => {
  for (const [error, expectedStatus] of [
    [Object.assign(new Error("Authentication rejected"), { status: 401, kind: "authentication" }), "error"],
    [Object.assign(new Error("Forbidden"), { status: 403, kind: "authentication" }), "error"],
    [Object.assign(new Error("Insufficient credits"), { status: 402, kind: "insufficient_credits" }), "error"],
    [Object.assign(new Error("Rate limited"), { status: 429, kind: "rate_limit" }), "error"],
    [Object.assign(new Error("timed out"), { name: "AbortError" }), "ambiguous"],
    [new Error("malformed response"), "ambiguous"],
  ]) {
    const state = memoryStore(); let calls = 0
    await assert.rejects(() => collect.executeCollectOnce({ preflight: collect.collectPreflight(candidate(), runtime()), confirmationValid: true, actor: "A", store: state.store, transport: async () => { calls += 1; throw error } }))
    assert.equal(calls, 1)
    assert.equal(state.writes.failed, 1)
    assert.equal(state.writes.failureStatus, expectedStatus)
    assert.equal(state.writes.completed, 0)
  }
})

test("wrong returned ID is rejected after one call and never retained as evidence", async () => {
  const state = memoryStore(); let calls = 0
  await assert.rejects(() => collect.executeCollectOnce({ preflight: collect.collectPreflight(candidate(), runtime()), confirmationValid: true, actor: "A", store: state.store, transport: async () => { calls += 1; return { body: profile({ id: 123456 }), upstreamHttpStatus: 200, providerCreditsRemaining: 4949 } } }), /different Employee ID/)
  assert.equal(calls, 1); assert.equal(state.writes.completed, 0); assert.equal(state.writes.failed, 1)
  assert.equal(state.writes.failureStatus, "ambiguous", "a 200 response with conflicting identity may still have been billed")
})

test("missing education/employment and conflicting evidence remain review states, not canonical decisions", () => {
  const missing = collect.sanitizeCollectResponse({ body: profile({ education: [], experience: [] }), candidate: candidate(), attemptId: "a", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: 4950 })
  assert.equal(missing.quality.education, "MISSING")
  assert.equal(missing.quality.currentEmployer, "MISSING")
  const conflict = collect.sanitizeCollectResponse({ body: profile({ education: [{ institution_id: 1, date_to_year: 2012 }], experience: [{ company_id: 2, company_name: "Different", title: "VP", is_current: 1 }] }), candidate: candidate(), attemptId: "b", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: 4950 })
  assert.equal(conflict.quality.education, "PRESENT_BUT_CONFLICTING")
  assert.equal(conflict.quality.currentEmployer, "PRESENT_BUT_CONFLICTING")
  assert.equal(conflict.reviewState, "REVIEW_REQUIRED")
})

test("an explicitly non-current experience is never promoted by a missing end date", () => {
  const evidence = collect.sanitizeCollectResponse({
    body: profile({ experience: [
      { company_id: 8469989, company_name: "Lincoln International", title: "Director", is_current: 0, deleted: 0 },
      { company_id: 7, company_name: "Other Company", title: "VP", deleted: 0 },
    ] }),
    candidate: candidate(), attemptId: "currentness", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: null,
  })
  assert.equal(evidence.employment[0].current, false)
  assert.equal(evidence.employment[1].current, true)
  assert.equal(evidence.quality.currentEmployer, "PRESENT_BUT_CONFLICTING")
  assert.equal(evidence.reviewState, "REVIEW_REQUIRED")
})

test("unchanged provider credit header stays separate from documented cost and confirmed debit", () => {
  const evidence = collect.sanitizeCollectResponse({ body: profile(), candidate: candidate(), attemptId: "a", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: 4950 })
  assert.equal(evidence.providerCreditsRemaining, 4950)
  assert.deepEqual(evidence.applicationAccounting, { applicationUnits: 20, maximumAuthorizedProviderCredits: 20, confirmedDebit: null })
})

test("Collect metadata transport is one GET with apikey auth, redirect refusal and retained balance header", async () => {
  const previous = process.env.CORESIGNAL_API_KEY
  process.env.CORESIGNAL_API_KEY = "synthetic-collect-test-key"
  try {
    let calls = 0
    const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
    const result = await client.collectCoresignalEmployeeWithMetadata("289351894", { fetcher: async (url, init) => {
      calls += 1
      assert.equal(url, "https://api.coresignal.com/cdapi/v2/employee_base/collect/289351894")
      assert.equal(init.method, "GET")
      assert.equal(init.redirect, "error")
      const headers = new Headers(init.headers)
      assert.equal(headers.get("apikey"), "synthetic-collect-test-key")
      assert.equal(headers.has("authorization"), false)
      return new Response(JSON.stringify(profile()), { status: 200, headers: { "content-type": "application/json", "x-credits-remaining": "4949" } })
    } })
    assert.equal(calls, 1)
    assert.equal(result.upstreamHttpStatus, 200)
    assert.equal(result.providerCreditsRemaining, 4949)
  } finally {
    if (previous === undefined) delete process.env.CORESIGNAL_API_KEY
    else process.env.CORESIGNAL_API_KEY = previous
  }
})

test("a rejected 402 Collect remains a single non-billable attempt with an explicit insufficient-credit classification", async () => {
  const previous = process.env.CORESIGNAL_API_KEY
  process.env.CORESIGNAL_API_KEY = "synthetic-collect-test-key"
  try {
    const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
    let calls = 0
    await assert.rejects(() => client.collectCoresignalEmployeeWithMetadata("289351894", { fetcher: async () => {
      calls += 1
      return new Response("synthetic rejection", { status: 402 })
    } }), error => error.kind === "insufficient_credits" && error.status === 402 && error.successfulOperationCredits === 0 && collect.collectFailureRequiresReconciliation(error, false) === false)
    assert.equal(calls, 1)
  } finally {
    if (previous === undefined) delete process.env.CORESIGNAL_API_KEY
    else process.env.CORESIGNAL_API_KEY = previous
  }
})

test("successful Collect evidence is stripped from summary and presented as structured review evidence", () => {
  const evidence = collect.sanitizeCollectResponse({ body: profile(), candidate: candidate(), attemptId: "a", requestedAt: "2026-10-17T03:00:00Z", completedAt: "2026-10-17T03:00:01Z", upstreamHttpStatus: 200, providerCreditsRemaining: 4949 })
  const stored = collect.serializeCollectEvidence("Review required.", evidence)
  const presented = collect.presentProviderHistoryCollectEvidence({ provider: "coresignal", operation: collect.CORESIGNAL_COLLECT_OPERATION, responseSummary: stored })
  assert.equal(presented.responseSummary, "Review required.")
  assert.equal(presented.collectEvidence.state, "RETAINED")
  assert.equal(presented.collectEvidence.evidence.targetEmployeeId, "289351894")
  assert.equal(presented.collectEvidence.evidence.providerActions.canonicalMutations, 0)
})

test("Admin-only route uses atomic durable claim and never reuses Profile Refresh", async () => {
  const route = await readFile(new URL("../app/api/admin/coresignal-collect/route.ts", import.meta.url), "utf8")
  assert.match(route, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/)
  assert.match(collect.CORESIGNAL_COLLECT_CLAIM_SQL, /INSERT INTO provider_response_history[\s\S]*WHERE NOT EXISTS[\s\S]*RETURNING id/)
  assert.match(route, /WHERE id=\? AND status='in_progress'/)
  assert.match(route, /status === "ambiguous" \? CORESIGNAL_COLLECT_ESTIMATED_CREDITS : 0/)
  assert.match(route, /WEBHOOK_COLLECT_CLAIM_SQL[\s\S]*application_units[\s\S]*WHERE NOT EXISTS/)
  assert.match(route, /payload\.webhookEventId && \(!coresignalCollectMockTransportEnabled\(\) \|\| !webhookMockEnabled\(\)\)/)
  assert.match(route, /collectCoresignalEmployeeWithMetadata/)
  assert.doesNotMatch(route, /refreshProfile|attachCoresignalIdentity|externalDiscoverySearches/)
})

test("the production claim statement admits exactly one durable attempt in an isolated SQLite fixture", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`CREATE TABLE provider_response_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, alumnus_name TEXT NOT NULL,
    search_id INTEGER, operation TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    credits_used INTEGER NOT NULL, application_units INTEGER NOT NULL, provider_reported_credits INTEGER,
    usage_state TEXT NOT NULL, result_count INTEGER NOT NULL, request_summary TEXT NOT NULL,
    response_summary TEXT NOT NULL, error_message TEXT NOT NULL, requested_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE provider_settings (provider TEXT PRIMARY KEY, monthly_credit_limit INTEGER)`)
  const summary = "Retained Search Collect-only · Employee ID 289351894"
  const statement = db.prepare(collect.CORESIGNAL_COLLECT_CLAIM_SQL)
  const bind = [14, collect.CORESIGNAL_COLLECT_OPERATION, "mock", 20, summary, "claim", "Admin", collect.CORESIGNAL_COLLECT_OPERATION, summary, 20, new Date().toISOString().slice(0, 7) + "-01"]
  assert.equal(statement.get(...bind).id, 1)
  assert.equal(statement.get(...bind), undefined)
  assert.equal(db.prepare("SELECT count(*) AS count FROM provider_response_history").get().count, 1)
  assert.equal(db.prepare("SELECT status FROM provider_response_history").get().status, "in_progress")
  db.close()
})

test("UI exposes retained candidates to Admin only and discloses every execution safeguard", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
  assert.match(page, /session\.canAdminister && <section className="panel collect-candidate-panel"/)
  assert.match(page, /Review Collect Eligibility/)
  assert.match(page, /Cancel — No Provider Call/)
  assert.match(page, /Confirm One Collect Request/)
  assert.match(page, /0 Search · 0 Preview · 0 attachment · 0 canonical updates/)
  assert.match(page, /<CoresignalCollectEvidencePanel evidence=\{item\.collectEvidence\.evidence\}/)
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*\.collect-candidate-list article/)
})

test("normal local mode keeps Collect OFF and Search/Collect gates remain independent", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
  assert.match(pkg.scripts["dev:local"], /CORESIGNAL_COLLECT_ENABLED=false/)
  assert.match(pkg.scripts["dev:local"], /CORESIGNAL_COLLECT_ENTITLEMENT=unknown/)
  assert.match(pkg.scripts["dev:local:coresignal-live"], /CORESIGNAL_COLLECT_ENABLED=false/)
  assert.match(pkg.scripts["dev:local:coresignal-collect-live"], /CORESIGNAL_SEARCH_ENABLED=false/)
  assert.doesNotMatch(pkg.scripts["dev:local:coresignal-collect-live"], /CORESIGNAL_COLLECT_ENABLED=true/)
  assert.match(config, /CORESIGNAL_SEARCH_ENABLED: localCoresignalDemo && localEnvironment\.CORESIGNAL_SEARCH_ENABLED === "true"/)
  assert.match(config, /CORESIGNAL_COLLECT_ENABLED: \(localCoresignalDemo \|\| localCollectMock\) && localEnvironment\.CORESIGNAL_COLLECT_ENABLED === "true"/)
  assert.match(config, /CORESIGNAL_COLLECT_MOCK_TRANSPORT: localCollectMock \? "true" : "false"/)
  assert.match(await readFile(new URL("../app/api/admin/coresignal-collect/route.ts", import.meta.url), "utf8"), /coresignalCollectMockTransportEnabled\(\) \? async employeeId => mockCollectEvidence\(employeeId\)/)
  const authorizedMock = { NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "true", LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1", CORESIGNAL_LIVE_ENABLED: "true", CORESIGNAL_API_KEY: "synthetic", CORESIGNAL_COLLECT_ENABLED: "true", CORESIGNAL_COLLECT_ENTITLEMENT: "confirmed", CORESIGNAL_COLLECT_MOCK_TRANSPORT: "true" }
  assert.equal(localDevelopment.localCoresignalCollectMockTransportEnabled(authorizedMock), true)
  assert.equal(localDevelopment.localCoresignalCollectMockTransportEnabled({ ...authorizedMock, NODE_ENV: "production" }), false)
  assert.equal(localDevelopment.localCoresignalCollectMockTransportEnabled({ ...authorizedMock, LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "network.teamsynapse.app" }), false)
  assert.equal(localDevelopment.localCoresignalCollectMockTransportEnabled({ ...authorizedMock, CORESIGNAL_COLLECT_ENTITLEMENT: "unknown" }), false)
  assert.equal(localDevelopment.localCoresignalCollectMockTransportEnabled({ ...authorizedMock, CORESIGNAL_LIVE_ENABLED: "false", LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "false", CORESIGNAL_API_KEY: "" }), true)
})
