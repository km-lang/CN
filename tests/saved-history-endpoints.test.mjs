import assert from "node:assert/strict"
import test, { after } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())
const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")
const auth = await vite.ssrLoadModule("/lib/auth-session.ts")
const discovery = await vite.ssrLoadModule("/app/api/discovery/route.ts")
const alumniHistory = await vite.ssrLoadModule("/app/api/alumni/[id]/history/route.ts")

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

test("saved discovery and alumni history survive repeated/concurrent reads and database restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cn-saved-history-"))
  const filename = join(directory, "isolated.sqlite")
  const previousSecret = process.env.AUTH_SESSION_SECRET
  const previousFetch = globalThis.fetch
  let db
  try {
    db = new DatabaseSync(filename)
    db.exec("pragma foreign_keys=on")
    for (const name of (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    db.exec("insert into application_users (id,display_name,email,role) values (1,'Synthetic Admin','admin@example.test','ADMIN'),(2,'Synthetic PCOM','pcom@example.test','PCOM')")
    db.exec("insert into application_identities (id,application_user_id,provider,provider_subject_id,verified_email,email_verified) values (1,1,'chatgpt','synthetic-admin','admin@example.test',1),(2,2,'chatgpt','synthetic-pcom','pcom@example.test',1)")
    db.exec("insert into alumni (id,profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) values (23,'synthetic:history','Synthetic History','SH',2019,'PGP','Example Co','Manager','Strategy','Manager','Delhi')")
    db.exec("insert into external_discovery_searches (id,provider,filters_json,criteria_summary,result_count,new_count,mode,initiated_by) values (11,'coresignal','{}','Synthetic saved search',1,1,'live','Synthetic Admin')")
    db.exec("insert into external_discovery_results (id,search_id,provider,provider_result_id,name,education,current_company,role,\"function\",seniority,location,match_status,linked_internal_alumnus_id) values (13,11,'coresignal','synthetic-result-13','Synthetic History','IIM Lucknow','Example Co','Manager','Strategy','Manager','Delhi','REVIEW_REQUIRED',23)")
    db.exec("insert into alumni_source_observations (alumnus_id,mutation_request_key,source_row_key,filename,source_system,observed_json,imported_by) values (23,'synthetic-source','row-1','synthetic.xlsx','synthetic','{\"company\":\"Example Co\"}','Synthetic Admin')")
    process.env.AUTH_SESSION_SECRET = "synthetic-session-secret-at-least-thirty-two"
    globalThis.fetch = async () => { throw new Error("External provider request forbidden in saved-history regression") }
    const admin = await auth.createAppSessionToken({ applicationUserId: 1, applicationIdentityId: 1, provider: "chatgpt" })
    const pcom = await auth.createAppSessionToken({ applicationUserId: 2, applicationIdentityId: 2, provider: "chatgpt" })
    const getDiscovery = token => discovery.GET(new Request("http://localhost/api/discovery?view=pending&searchId=11", { headers: { cookie: `corporate_network_session=${token}` } }))
    const getHistory = token => alumniHistory.GET(new Request("http://localhost/api/alumni/23/history", { headers: { cookie: `corporate_network_session=${token}` } }), { params: Promise.resolve({ id: "23" }) })
    for (const cycle of ["initial", "reopened"]) {
      cloudflare.env.DB = d1(db)
      const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => index % 2 ? getHistory(index % 3 ? admin : pcom) : getDiscovery(index % 3 ? admin : pcom)))
      for (let index = 0; index < responses.length; index += 1) {
        assert.equal(responses[index].status, 200, `${cycle} request ${index}: ${await responses[index].text()}`)
      }
      const saved = await (await getDiscovery(admin)).json()
      const retained = await (await getHistory(admin)).json()
      assert.equal(saved.activeSearch.searchId, 11)
      assert.equal(saved.results.length, 1)
      assert.equal(retained.entries.some(entry => entry.kind === "SOURCE_OBSERVATION"), true)
      assert.equal(retained.entries.some(entry => entry.kind === "DISCOVERY_OBSERVATION"), true)
      assert.equal((await getDiscovery("")).status, 401)
      assert.equal((await getHistory("")).status, 401)
      if (cycle === "initial") { db.close(); db = new DatabaseSync(filename) }
    }
    assert.equal(db.prepare("select count(*) as n from external_discovery_searches").get().n, 1)
    assert.equal(db.prepare("pragma integrity_check").get().integrity_check, "ok")
  } finally {
    cloudflare.env.DB = undefined
    globalThis.fetch = previousFetch
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = previousSecret
    db?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
