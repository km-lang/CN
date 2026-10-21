import assert from "node:assert/strict"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFile, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
after(() => vite.close())
const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")

function d1(db) {
  return { prepare(statement) { return { bind(...values) {
    const query = db.prepare(statement)
    return {
      first: async () => query.get(...values) ?? null,
      all: async () => ({ results: query.all(...values) }),
      raw: async () => { query.setReturnArrays(true); return query.all(...values) },
      run: async () => ({ meta: { changes: query.run(...values).changes } }),
    }
  } } } }
}

test("historical PDL discovery stays readable but cannot enter active mutation paths", async () => {
  const db = new DatabaseSync(":memory:")
  const oldSecret = process.env.AUTH_SESSION_SECRET
  const oldFetch = globalThis.fetch
  try {
    db.exec("pragma foreign_keys=on")
    for (const name of (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("insert into application_users (id,display_name,email,role) values (1,'Synthetic Admin','admin@example.test','ADMIN')")
    db.exec("insert into application_identities (id,application_user_id,provider,provider_subject_id,verified_email,email_verified) values (1,1,'chatgpt','synthetic-admin','admin@example.test',1)")
    db.exec("insert into external_discovery_searches (id,provider,filters_json,criteria_summary,requested_count,result_count,mode,initiated_by) values (41,'pdl','{}','Historical search',1,1,'live','Synthetic Admin')")
    db.exec("insert into external_discovery_results (id,search_id,provider,provider_result_id,provider_person_id,name,education,current_company,role,function,seniority,location,match_status,affiliation_status) values (51,41,'pdl','historical-51','historical-51','Synthetic Historical','Unverified','Example','Role','Other','Unknown','India','New','Confirmed degree alumnus')")
    process.env.AUTH_SESSION_SECRET = "synthetic-session-secret-at-least-thirty-two"
    globalThis.fetch = async () => { throw new Error("No provider request is permitted in this test.") }
    cloudflare.env.DB = d1(db)
    const auth = await vite.ssrLoadModule("/lib/auth-session.ts")
    const route = await vite.ssrLoadModule("/app/api/discovery/route.ts")
    const token = await auth.createAppSessionToken({ applicationUserId: 1, applicationIdentityId: 1, provider: "chatgpt" })
    const headers = { "content-type": "application/json", cookie: `corporate_network_session=${token}` }
    const historical = await route.GET(new Request("http://localhost/api/discovery?view=pending&searchId=41", { headers }))
    assert.equal(historical.status, 200)
    const data = await historical.json()
    assert.equal(data.results.length, 1)
    assert.equal(data.results[0].provider, "pdl")
    assert.equal(data.results[0].actionableReview, false)
    assert.equal(data.results[0].eligibleForAddition, false)
    assert.equal(data.activeSearch.pendingCount, 0)

    const actions = [
      { action: "record_evidence", resultId: 51 },
      { action: "approve", resultIds: [51] },
      { action: "apply_updates", resultId: 51 },
      { action: "keep_separate", resultId: 51 },
      { action: "ignore", resultId: 51 },
      { action: "qualify", resultId: 51, affiliationStatus: "Confirmed degree alumnus" },
    ]
    for (const action of actions) {
      const response = await route.POST(new Request("http://localhost/api/discovery", { method: "POST", headers, body: JSON.stringify(action) }))
      assert.ok([400, 409].includes(response.status), `${action.action} must be blocked`)
    }
    assert.equal(db.prepare("select count(*) as n from alumni").get().n, 0)
    assert.equal(db.prepare("select count(*) as n from external_discovery_results").get().n, 1)
    assert.equal(db.prepare("select review_status as status from external_discovery_results where id=51").get().status, "Pending review")
    assert.equal(db.prepare("select count(*) as n from external_discovery_candidate_evidence").get().n, 0)
    assert.equal(db.prepare("select count(*) as n from security_audit_events").get().n, 0)
  } finally {
    cloudflare.env.DB = undefined
    globalThis.fetch = oldFetch
    if (oldSecret === undefined) delete process.env.AUTH_SESSION_SECRET
    else process.env.AUTH_SESSION_SECRET = oldSecret
    db.close()
  }
})
