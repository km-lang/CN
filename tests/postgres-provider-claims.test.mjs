import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, appendFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import pg from "pg"
import { createServer } from "vite"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const pgBin = process.env.PG_TEST_BIN || "/opt/homebrew/opt/postgresql@17/bin"
const role = "cn_claim_test"
const database = "cn_claim_fixture"
const command = (name, args) => run(join(pgBin, name), args, { maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } })

test("PostgreSQL provider claims retain D1 reservation and replay invariants without provider I/O", async t => {
  try { await access(join(pgBin, "initdb")) } catch { return t.skip("PostgreSQL 17 test binaries are unavailable") }
  const temporary = await mkdtemp(join(tmpdir(), "cn-stage3-claims-"))
  const dataDir = join(temporary, "cluster")
  const socketDir = join(temporary, "socket")
  let started = false
  let pool
  let vite
  try {
    await mkdir(socketDir)
    await command("initdb", ["-A", "trust", "--locale=C", "-U", role, "-D", dataDir, "--no-instructions"])
    await appendFile(join(dataDir, "postgresql.conf"), `\nlisten_addresses = ''\nunix_socket_directories = '${socketDir}'\nport = 5432\n`)
    await command("pg_ctl", ["-D", dataDir, "-l", join(temporary, "postgres.log"), "-w", "start"])
    started = true
    await command("createdb", ["-h", socketDir, "-U", role, database])
    await command("psql", ["-h", socketDir, "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", join(root, "drizzle-postgres/0000_cynical_dexter_bennett.sql")])
    pool = new pg.Pool({ host: socketDir, port: 5432, user: role, database, max: 8 })
    vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
    const adapter = await vite.ssrLoadModule("/db/postgres/adapter.ts")
    const claims = await vite.ssrLoadModule("/lib/postgres-provider-claims.ts")
    const lushaGuard = await vite.ssrLoadModule("/lib/lusha-request-guard.ts")
    const collectWorkflow = await vite.ssrLoadModule("/lib/coresignal-collect-only.ts")
    const collectStore = await vite.ssrLoadModule("/lib/postgres-collect-claim-store.ts")
    const db = adapter.postgresDatabaseFromPool(pool)
    const person = (await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location) VALUES ('claim:fictional','Fictional Claim Person','FC',2020,2020,'PGP','Example','Analyst','Other','Analyst/Junior','Mumbai') RETURNING id")).rows[0]
    await pool.query("INSERT INTO provider_settings(provider,monthly_credit_limit) VALUES ('coresignal',25),('lusha',10)")
    const collect = (summary, units = 20) => ({ kind: "coresignal_collect", mode: "mock", alumnusName: "Fictional candidate", operation: "Base Employee Collect-only", requestSummary: summary, responseSummary: "Claimed; no provider response.", requestedBy: "Fixture", applicationUnits: units })
    const lusha = (summary, units = 3) => ({ kind: "lusha_live", alumnusId: person.id, alumnusName: "Fictional Claim Person", operation: "Email Reveal", requestSummary: summary, responseSummary: "Claimed; no provider response.", requestedBy: "Fixture", applicationUnits: units })

    await t.test("concurrent Coresignal claims hold one reservation and reject duplicate or excess budget", async () => {
      const race = await Promise.all(Array.from({ length: 5 }, () => claims.postgresReserveProviderClaim(db, collect("fixture:collect:one"))))
      assert.equal(race.filter(item => item.acquired).length, 1)
      assert.deepEqual(race.filter(item => !item.acquired).map(item => item.reason), Array(4).fill("duplicate"))
      assert.deepEqual(await claims.postgresReserveProviderClaim(db, collect("fixture:collect:two")), { acquired: false, reason: "application_limit" })
      const { rows } = await pool.query("SELECT status,application_units,usage_state FROM provider_response_history WHERE provider='coresignal'")
      assert.deepEqual(rows, [{ status: "in_progress", application_units: 20, usage_state: "reconciliation_required" }])
      const first = race.find(item => item.acquired)
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: first.id, status: "error", reservation: 20, responseSummary: "Rejected before charge." }), true)
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: first.id, status: "error", reservation: 20, responseSummary: "Duplicate release." }), false)
      assert.equal((await pool.query("SELECT application_units FROM provider_response_history WHERE id=$1", [first.id])).rows[0].application_units, 0)
      const next = await claims.postgresReserveProviderClaim(db, collect("fixture:collect:two"))
      assert.equal(next.acquired, true)
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: next.id, status: "success", reservation: 19, responseSummary: "Incorrect reservation." }), false)
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: next.id, status: "success", reservation: 20, responseSummary: "One mock Collect succeeded." }), true)
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: next.id, status: "success", reservation: 20, responseSummary: "Duplicate success." }), false)
      assert.deepEqual((await pool.query("SELECT status,application_units,usage_state,result_count FROM provider_response_history WHERE id=$1", [next.id])).rows[0], { status: "success", application_units: 20, usage_state: "reconciliation_required", result_count: 1 })
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=40 WHERE provider='coresignal'")
      const capacityRace = await Promise.all(["a", "b", "c"].map(key => claims.postgresReserveProviderClaim(db, collect(`fixture:collect:capacity:${key}`, 10))))
      assert.equal(capacityRace.filter(item => item.acquired).length, 2)
      assert.equal(capacityRace.filter(item => !item.acquired)[0].reason, "application_limit")
      for (const item of capacityRace.filter(item => item.acquired)) assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: item.id, status: "error", reservation: 10, responseSummary: "No provider request." }), true)
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=25 WHERE provider='coresignal'")
    })

    await t.test("failed transaction and settlement leave no partial success or released hold", async () => {
      await pool.query("CREATE FUNCTION reject_claim_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_summary='fixture:claim:rejected' THEN RAISE EXCEPTION 'fixture claim failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_claim_insert BEFORE INSERT ON provider_response_history FOR EACH ROW EXECUTE FUNCTION reject_claim_insert()")
      try { await assert.rejects(claims.postgresReserveProviderClaim(db, collect("fixture:claim:rejected", 1))) }
      finally { await pool.query("DROP TRIGGER reject_claim_insert ON provider_response_history"); await pool.query("DROP FUNCTION reject_claim_insert()") }
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE request_summary='fixture:claim:rejected'")).rows[0].n, 0)
      const held = await claims.postgresReserveProviderClaim(db, collect("fixture:claim:held", 1))
      assert.equal(held.acquired, true)
      await pool.query("CREATE FUNCTION reject_claim_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_summary='fixture:claim:held' AND NEW.status='success' THEN RAISE EXCEPTION 'fixture settlement failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_claim_settlement BEFORE UPDATE ON provider_response_history FOR EACH ROW EXECUTE FUNCTION reject_claim_settlement()")
      try { await assert.rejects(claims.postgresSettleCoresignalCollect(db, { id: held.id, status: "success", reservation: 1, responseSummary: "Mock success." })) }
      finally { await pool.query("DROP TRIGGER reject_claim_settlement ON provider_response_history"); await pool.query("DROP FUNCTION reject_claim_settlement()") }
      assert.deepEqual((await pool.query("SELECT status,application_units FROM provider_response_history WHERE id=$1", [held.id])).rows[0], { status: "in_progress", application_units: 1 })
      assert.equal(await claims.postgresSettleCoresignalCollect(db, { id: held.id, status: "ambiguous", reservation: 1, responseSummary: "Outcome uncertain." }), true)
      assert.equal((await pool.query("SELECT application_units,usage_state FROM provider_response_history WHERE id=$1", [held.id])).rows[0].application_units, 1)
    })

    await t.test("Lusha live holds, duplicate fences, unknown usage and manual-reconciliation prerequisite", async () => {
      assert.equal(lushaGuard.lushaBalanceCoversReservation(null, 3), false)
      assert.equal(lushaGuard.lushaBalanceCoversReservation(2, 3), false)
      assert.equal(lushaGuard.lushaBalanceCoversReservation(3, 3), true)
      const first = await claims.postgresReserveProviderClaim(db, lusha("fixture:lusha:one"))
      assert.equal(first.acquired, true)
      assert.deepEqual(await claims.postgresReserveProviderClaim(db, lusha("fixture:lusha:one")), { acquired: false, reason: "duplicate" })
      const other = { ...lusha("fixture:lusha:other"), operation: "Phone Reveal" }
      assert.deepEqual(await claims.postgresReserveProviderClaim(db, other), { acquired: false, reason: "unresolved_usage" })
      assert.equal(await claims.postgresMarkLushaAmbiguous(db, first.id), true)
      assert.equal(await claims.postgresMarkLushaAmbiguous(db, first.id), false)
      assert.deepEqual((await pool.query("SELECT status,application_units,usage_state FROM provider_response_history WHERE id=$1", [first.id])).rows[0], { status: "ambiguous", application_units: 3, usage_state: "reconciliation_required" })
      assert.deepEqual(await claims.postgresReserveProviderClaim(db, other), { acquired: false, reason: "unresolved_usage" })
      await pool.query("UPDATE provider_response_history SET credits_used=2,application_units=greatest(application_units,2),reconciled_credits=2,usage_state='reconciled_account_usage',reconciliation_source='Fictional account delta',reconciled_by='Fixture',reconciled_at='2026-11-01T00:00:00Z' WHERE id=$1", [first.id])
      const resumed = await claims.postgresReserveProviderClaim(db, other)
      assert.equal(resumed.acquired, true)
      assert.equal(await claims.postgresSettleLushaClaim(db, { id: resumed.id, status: "success", reservation: 3, reportedCredits: 2, resultCount: 1, responseSummary: "Wrong transport.", mock: true }), false)
      assert.equal(await claims.postgresSettleLushaClaim(db, { id: resumed.id, status: "success", reservation: 3, reportedCredits: 2, resultCount: 1, responseSummary: "Mocked provider response.", mock: false }), true)
      assert.equal(await claims.postgresSettleLushaClaim(db, { id: resumed.id, status: "success", reservation: 3, reportedCredits: 2, resultCount: 1, responseSummary: "Duplicate completion.", mock: false }), false)
      assert.deepEqual((await pool.query("SELECT status,application_units,credits_used,provider_reported_credits,usage_state FROM provider_response_history WHERE id=$1", [resumed.id])).rows[0], { status: "success", application_units: 3, credits_used: 2, provider_reported_credits: 2, usage_state: "provider_reported" })
    })

    await t.test("Lusha synthetic claims use no credit reservation or provider request", async () => {
      const mock = { ...lusha("fixture:lusha:mock"), kind: "lusha_mock" }
      delete mock.applicationUnits
      const first = await claims.postgresReserveProviderClaim(db, mock)
      assert.equal(first.acquired, true)
      assert.deepEqual(await claims.postgresReserveProviderClaim(db, mock), { acquired: false, reason: "duplicate" })
      assert.equal(await claims.postgresSettleLushaClaim(db, { id: first.id, status: "no_match", reservation: 0, reportedCredits: null, resultCount: 0, responseSummary: "Synthetic no match.", mock: true }), true)
      assert.deepEqual((await pool.query("SELECT mode,application_units,credits_used,usage_state FROM provider_response_history WHERE id=$1", [first.id])).rows[0], { mode: "mock", application_units: 0, credits_used: 0, usage_state: "not_applicable" })
    })

    await t.test("existing Collect executor uses the shared PostgreSQL claim store once with a mock transport", async () => {
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=100 WHERE provider='coresignal'")
      await pool.query("UPDATE alumni SET coresignal_employee_id='289351894' WHERE id=$1", [person.id])
      const candidate = collectWorkflow.candidateFromKnownAlumnus({ id: person.id, coresignalEmployeeId: "289351894", createdAt: new Date().toISOString() }, null)
      const runtime = { configured: true, providerLiveMode: false, transportMode: "mock", collectGateEnabled: true, entitlement: "confirmed", applicationUnitsRemaining: 100, maximumRequests: 1 }
      const preflight = collectWorkflow.collectPreflight(candidate, runtime)
      let calls = 0
      const transport = async employeeId => {
        calls += 1
        assert.equal(employeeId, "289351894")
        return { body: { id: 289351894, full_name: "Fictional Collect Person", profile_url: "https://www.linkedin.com/in/fictional-collect-person/", location_full: "Mumbai", checked_at: "2026-10-17T00:00:00Z", education: [{ institution_id: 25919228, institution_name: "Indian Institute of Management Lucknow", degree_name: "PGP", date_to_year: 2020, deleted: 0 }], experience: [{ company_id: 8, company_name: "Fictional Co", title: "Director", is_current: 1, deleted: 0, date_from: "2024-01" }] }, upstreamHttpStatus: 200, providerCreditsRemaining: null }
      }
      const input = { preflight, confirmationValid: true, actor: "Fictional Admin", store: collectStore.postgresCollectClaimStore(db), transport }
      const first = await collectWorkflow.executeCollectOnce(input)
      assert.equal(first.state, "REVIEW_REQUIRED")
      assert.equal(first.evidence.providerActions.collectRequests, 1)
      assert.equal(first.evidence.providerActions.canonicalMutations, 0)
      assert.equal(calls, 1)
      const replay = await collectWorkflow.executeCollectOnce(input)
      assert.equal(replay.state, "DUPLICATE_BLOCKED")
      assert.equal(calls, 1)
      const { rows } = await pool.query("SELECT status,application_units,usage_state,result_count,response_summary FROM provider_response_history WHERE id=$1", [first.claimId])
      assert.deepEqual(rows[0].status, "success")
      assert.equal(rows[0].application_units, 20)
      assert.equal(rows[0].usage_state, "reconciliation_required")
      assert.equal(rows[0].result_count, 1)
      assert.match(rows[0].response_summary, /\[coresignal-collect-evidence:v1\]/)
      const secondPerson = (await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location,coresignal_employee_id) VALUES ('claim:collect-interrupted','Fictional Interrupted Collect','FI',2020,2020,'PGP','Example','Analyst','Other','Analyst/Junior','Mumbai','289351895') RETURNING id")).rows[0]
      const interruptedCandidate = collectWorkflow.candidateFromKnownAlumnus({ id: secondPerson.id, coresignalEmployeeId: "289351895", createdAt: new Date().toISOString() }, null)
      const interruptedInput = { ...input, preflight: collectWorkflow.collectPreflight(interruptedCandidate, runtime), transport: async () => { throw new Error("fictional ambiguous transport") } }
      await assert.rejects(collectWorkflow.executeCollectOnce(interruptedInput), /fictional ambiguous transport/)
      const { rows: held } = await pool.query("SELECT status,application_units,usage_state FROM provider_response_history WHERE provider='coresignal' AND alumnus_id=$1", [secondPerson.id])
      assert.deepEqual(held, [{ status: "ambiguous", application_units: 20, usage_state: "reconciliation_required" }])
      const blockedReplay = await collectWorkflow.executeCollectOnce(interruptedInput)
      assert.equal(blockedReplay.state, "DUPLICATE_BLOCKED")
    })

    await t.test("webhook Collect claim links one notification and releases on deterministic failure", async () => {
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=120 WHERE provider='coresignal'")
      const subscription = (await pool.query("INSERT INTO coresignal_webhook_subscriptions(name,cohort_type,selection_json,selection_version,membership_json,created_by) VALUES ('Fictional Claim Subscription','FIXED_IDS','{}','v1','[]','Fixture') RETURNING id")).rows[0]
      const event = (await pool.query("INSERT INTO coresignal_webhook_events(subscription_id,alumnus_id,employee_id,change_type,payload_digest,dedupe_window,status) VALUES ($1,$2,'289351894','changed','fixture-collect-webhook','fixture-window','AWAITING_PROFILE_COLLECTION') RETURNING id", [subscription.id, person.id])).rows[0]
      const candidate = { ...collectWorkflow.candidateFromKnownAlumnus({ id: person.id, coresignalEmployeeId: "289351894", createdAt: new Date().toISOString() }, null), sourceWebhookEventId: event.id }
      const store = collectStore.postgresCollectClaimStore(db)
      const claimed = await store.acquire({ candidate, attemptId: "fixture-webhook-attempt", actor: "Fixture", transportMode: "mock" })
      assert.equal(claimed.acquired, true)
      assert.deepEqual((await pool.query("SELECT status,collect_history_id FROM coresignal_webhook_events WHERE id=$1", [event.id])).rows[0], { status: "PROFILE_COLLECTION_APPROVED", collect_history_id: claimed.claimId })
      assert.equal(await store.fail({ claimId: claimed.claimId, candidate, status: "error", message: "Fictional provider rejection." }), true)
      assert.deepEqual((await pool.query("SELECT status,error_state,collect_history_id FROM coresignal_webhook_events WHERE id=$1", [event.id])).rows[0], { status: "REVIEW_REQUIRED", error_state: "COLLECT_FAILED", collect_history_id: claimed.claimId })
      assert.deepEqual((await pool.query("SELECT status,application_units,usage_state FROM provider_response_history WHERE id=$1", [claimed.claimId])).rows[0], { status: "error", application_units: 0, usage_state: "not_applicable" })
      assert.deepEqual(await store.acquire({ candidate, attemptId: "fixture-webhook-replay", actor: "Fixture", transportMode: "mock" }), { acquired: false })
    })
  } finally {
    if (vite) await vite.close()
    if (pool) await pool.end()
    if (started) await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"])
    await rm(temporary, { recursive: true, force: true })
  }
})
