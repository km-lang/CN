import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, appendFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import pg from "pg"
import { createServer } from "vite"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const pgBin = process.env.PG_TEST_BIN || "/opt/homebrew/opt/postgresql@17/bin"
const role = "cn_step3b_test"
const database = "cn_step3b_fixture"
const command = (name, args) => run(join(pgBin, name), args, { maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } })

test("core PostgreSQL reads use fictional records in a disposable local cluster", async t => {
  try { await access(join(pgBin, "initdb")) } catch { return t.skip("PostgreSQL 17 test binaries are unavailable") }
  const originalBootstrapAdminEmails = process.env.BOOTSTRAP_ADMIN_EMAILS
  process.env.BOOTSTRAP_ADMIN_EMAILS = ""
  const temporary = await mkdtemp(join(tmpdir(), "cn-step3b-postgres-"))
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

    pool = new pg.Pool({ host: socketDir, port: 5432, user: role, database, max: 3, connectionTimeoutMillis: 1000 })
    vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root, "cloudflare:workers": join(root, "tests/fixtures/cloudflare-workers.ts") } }, server: { middlewareMode: true, hmr: false } })
    const adapter = await vite.ssrLoadModule("/db/postgres/adapter.ts")
    const security = await vite.ssrLoadModule("/lib/postgres-security.ts")
    const directory = await vite.ssrLoadModule("/lib/postgres-directory-data.ts")
    const collection = await vite.ssrLoadModule("/lib/postgres-alumni-collection.ts")
    const workspace = await vite.ssrLoadModule("/lib/postgres-workspace-read.ts")
    const profile = await vite.ssrLoadModule("/lib/postgres-alumnus-profile.ts")
    const profileResponse = await vite.ssrLoadModule("/lib/alumnus-response.ts")
    const queryModule = await vite.ssrLoadModule("/lib/directory-query.ts")
    const d1Directory = await vite.ssrLoadModule("/lib/directory-data.ts")
    const cloudflare = await vite.ssrLoadModule("/tests/fixtures/cloudflare-workers.ts")
    const db = adapter.postgresDatabaseFromPool(pool)
    const query = values => queryModule.normalizeDirectoryQuery(values)

    await t.test("empty Directory, collection, workspace and profile contracts", async () => {
      const empty = await directory.runPostgresDirectoryQuery(db, query({}), true).catch(error => { throw error.cause ?? error })
      assert.equal(empty.total, 0)
      assert.deepEqual(empty.items, [])
      assert.equal(empty.pageCount, 1)
      const context = { userId: 1, identityId: 1, provider: "chatgpt", externalIdentity: "fictional-admin", email: "admin@example.invalid", displayName: "Fictional Admin", role: "ADMIN" }
      const collected = await collection.postgresAlumniCollectionResponse(db, context, query({}))
      assert.deepEqual((await collected.json()).items, [])
      const ws = await workspace.postgresWorkspaceResponse(db, new Request("http://localhost/api/workspace"), context, row => row)
      assert.equal((await ws.json()).alumniCount, 0)
      const missing = await profile.postgresAlumnusProfileResponse(db, 99999, context, row => row)
      assert.equal(missing.status, 404)
    })

    const users = {}
    for (const [label, roleName, enabled] of [["admin", "ADMIN", true], ["pcom", "PCOM", true], ["developer", "DEVELOPER", true], ["disabled", "PCOM", false]]) {
      const email = `${label}@example.invalid`
      const user = (await pool.query("INSERT INTO application_users(external_identity, display_name, email, role, enabled) VALUES($1,$2,$3,$4,$5) RETURNING id", [`fictional-${label}`, `Fictional ${label}`, email, roleName, enabled])).rows[0]
      const identity = (await pool.query("INSERT INTO application_identities(application_user_id, provider, provider_subject_id, verified_email, email_verified) VALUES($1,'chatgpt',$2,$3,true) RETURNING id", [user.id, `fictional-${label}`, email])).rows[0]
      users[label] = { userId: user.id, identityId: identity.id, provider: "chatgpt", externalIdentity: `fictional-${label}`, email, displayName: `Fictional ${label}`, role: roleName }
    }

    await t.test("session identity, role isolation and login audit", async () => {
      for (const label of ["admin", "pcom", "developer"]) {
        const actual = await security.resolvePostgresSessionIdentity(db, { applicationUserId: users[label].userId, applicationIdentityId: users[label].identityId, provider: "chatgpt" })
        assert.equal(actual.role, users[label].role)
        assert.equal(actual.externalIdentity, users[label].externalIdentity)
      }
      await assert.rejects(security.resolvePostgresSessionIdentity(db, { applicationUserId: users.admin.userId, applicationIdentityId: users.pcom.identityId, provider: "chatgpt" }), e => e.status === 401 && e.code === "invalid_session_identity")
      await assert.rejects(security.resolvePostgresSessionIdentity(db, { applicationUserId: users.disabled.userId, applicationIdentityId: users.disabled.identityId, provider: "chatgpt" }), e => e.status === 403 && e.code === "account_disabled")
      await assert.rejects(security.resolvePostgresAuthorizedIdentity(db, { provider: "google_workspace", providerSubjectId: "unverified", email: "new@example.invalid", displayName: "Unknown", emailVerified: false }), e => e.status === 401)
      await assert.rejects(security.resolvePostgresAuthorizedIdentity(db, { provider: "chatgpt", providerSubjectId: "stranger", email: "stranger@example.invalid", displayName: "Stranger", emailVerified: true }), e => e.status === 403)
      const authorized = await security.resolvePostgresAuthorizedIdentity(db, { provider: "chatgpt", providerSubjectId: "fictional-admin", email: users.admin.email, displayName: "Fictional admin", emailVerified: true })
      assert.equal(authorized.userId, users.admin.userId)
      const google = await security.resolvePostgresAuthorizedIdentity(db, { provider: "google_workspace", providerSubjectId: "fictional-google-pcom", email: users.pcom.email, displayName: "Fictional Pcom", emailVerified: true, providerDomain: "example.invalid" })
      assert.equal(google.userId, users.pcom.userId)
      assert.equal(google.role, "PCOM")
      assert.equal((await security.resolvePostgresSessionIdentity(db, { applicationUserId: google.userId, applicationIdentityId: google.identityId, provider: "google_workspace" })).externalIdentity, "fictional-google-pcom")
      assert.equal((await pool.query("SELECT count(*)::integer AS count FROM security_audit_events WHERE action='login_success'")).rows[0].count, 2)
    })

    await t.test("existing bootstrap Admin allowlist applies only to a verified ChatGPT identity", async () => {
      process.env.BOOTSTRAP_ADMIN_EMAILS = "bootstrap@example.invalid"
      try {
        const bootstrap = await security.resolvePostgresAuthorizedIdentity(db, { provider: "chatgpt", providerSubjectId: "fictional-bootstrap", email: "bootstrap@example.invalid", displayName: "Fictional Bootstrap", emailVerified: true })
        assert.equal(bootstrap.role, "ADMIN")
        assert.equal((await pool.query("SELECT count(*)::integer AS count FROM security_audit_events WHERE action='bootstrap_admin_authorized'")).rows[0].count, 1)
      } finally {
        process.env.BOOTSTRAP_ADMIN_EMAILS = ""
      }
    })

    const fixtures = [
      ["ada", "Ada Fiction", "Acme", "Director", 2020, "VERIFIED", "ada@example.invalid"],
      ["bea", "Bea Fiction", "Not recorded", "Analyst", 2021, "VERIFIED", "bea@example.invalid"],
      ["chen", "Chen Fiction", "Acme", "Manager", 2019, "PROVISIONAL", "chen@example.invalid"],
    ]
    for (const [key, name, company, title, year, intake, email] of fixtures) {
      await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,function,seniority,location,intake_status,email) VALUES($1,$2,$3,$4,$4,'PGP',$5,$6,'Finance',$6,'Mumbai',$7,$8)", [key, name, name.slice(0, 2), year, company, title, intake, email])
    }
    await pool.query("INSERT INTO alumni_data_lifecycle(alumnus_id,status) SELECT id,'Active' FROM alumni")

    await t.test("search, filters, counts, sorting and pagination return exact records", async () => {
      const all = await directory.runPostgresDirectoryQuery(db, query({}), true)
      assert.equal(all.total, 3)
      assert.deepEqual(all.items.map(item => item.name).sort(), ["Ada Fiction", "Bea Fiction", "Chen Fiction"])
      assert.equal((await directory.runPostgresDirectoryQuery(db, query({ search: "ADA" }))).items[0].name, "Ada Fiction")
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ role: "director" }))).items.map(item => item.name), ["Ada Fiction"])
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ role: "director", company: "Acme", batch: "2020" }))).items.map(item => item.name), ["Ada Fiction"])
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ batch: "2020" }))).items.map(item => item.name), ["Ada Fiction"])
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ graduationYearMode: "range", graduationYearStart: "2019", graduationYearEnd: "2020", excludeProvisional: true }))).items.map(item => item.name), ["Ada Fiction"])
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ company: "Missing current company" }))).items.map(item => item.name), ["Bea Fiction"])
      assert.deepEqual((await directory.runPostgresDirectoryQuery(db, query({ search: "nobody" }))).items, [])
      assert.equal((await directory.runPostgresDirectoryQuery(db, query({ page: 99 }))).page, 1)
    })

    await t.test("same fictional Directory fixtures agree with D1 counts, filters and relevance", async () => {
      const sqlite = new DatabaseSync(":memory:")
      const priorBackend = process.env.CN_DB_BACKEND
      const priorUrl = process.env.DATABASE_URL
      try {
        const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
        for (const name of migrations) sqlite.exec(await readFile(join(root, "drizzle", name), "utf8"))
        const insert = sqlite.prepare('INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email) VALUES(?,?,?,?,?,\'PGP\',?,?,\'Finance\',?,\'Mumbai\',?,?)')
        for (const [key, name, company, title, year, intake, email] of fixtures) insert.run(key, name, name.slice(0, 2), year, year, company, title, title, intake, email)
        sqlite.exec("INSERT INTO alumni_data_lifecycle(alumnus_id,status) SELECT id,'Active' FROM alumni")
        cloudflare.env.DB = { prepare(statement) { return { bind(...values) { const prepared = sqlite.prepare(statement); return { raw: async () => prepared.all(...values).map(Object.values), all: async () => ({ results: prepared.all(...values) }) } } } } }
        process.env.CN_DB_BACKEND = "d1"
        delete process.env.DATABASE_URL
        for (const filters of [{ sort: "name" }, { search: "ADA", sort: "name" }, { company: "Missing current company", sort: "name" }, { graduationYearMode: "range", graduationYearStart: "2019", graduationYearEnd: "2020", excludeProvisional: true, sort: "name" }, { role: "director", company: "Acme", batch: "2020", sort: "name" }]) {
          const normalized = query(filters)
          const [expected, actual] = await Promise.all([d1Directory.runDirectoryQuery(normalized, true), directory.runPostgresDirectoryQuery(db, normalized, true)])
          assert.equal(actual.total, expected.total)
          assert.deepEqual(actual.items.map(item => [item.name, item.relevance]), expected.items.map(item => [item.name, item.relevance]))
          assert.deepEqual(actual.facets, expected.facets)
        }
      } finally {
        cloudflare.env.DB = undefined
        if (priorBackend === undefined) delete process.env.CN_DB_BACKEND
        else process.env.CN_DB_BACKEND = priorBackend
        if (priorUrl === undefined) delete process.env.DATABASE_URL
        else process.env.DATABASE_URL = priorUrl
        sqlite.close()
      }
    })

    await t.test("collection, workspace and profile preserve role-specific returned data", async () => {
      const collectionResponse = await collection.postgresAlumniCollectionResponse(db, users.developer, query({ search: "Ada" }))
      const collected = await collectionResponse.json()
      assert.equal(collected.total, 1)
      assert.equal(collected.items[0].name, "Ada Fiction")
      assert.notEqual(collected.items[0].email, "ada@example.invalid")
      const wsResponse = await workspace.postgresWorkspaceResponse(db, new Request("http://localhost/api/workspace?includeAlumni=true"), users.admin, row => ({ name: row.name, email: row.email, note: row.note }))
      const ws = await wsResponse.json()
      assert.equal(ws.alumniCount, 3)
      assert.equal(ws.alumni.length, 3)
      assert.equal(ws.access.role, "ADMIN")
      assert.equal(ws.alumni.find(row => row.name === "Ada Fiction").email, "ada@example.invalid")
      const devWs = await workspace.postgresWorkspaceResponse(db, new Request("http://localhost/api/workspace?includeAlumni=true"), users.developer, row => ({ name: row.name, email: row.email, note: row.note }))
      const devBody = await devWs.json()
      assert.equal(devBody.access.contactsMasked, true)
      const id = (await pool.query("SELECT id FROM alumni WHERE profile_key='ada'")).rows[0].id
      const actualProfile = await profile.postgresAlumnusProfileResponse(db, id, users.admin, profileResponse.alumnusResponse)
      const body = await actualProfile.json()
      assert.equal(body.alumnus.name, "Ada Fiction")
      assert.equal(body.alumnus.email, "ada@example.invalid")
      const developerProfile = await profile.postgresAlumnusProfileResponse(db, id, users.developer, profileResponse.alumnusResponse)
      assert.notEqual((await developerProfile.json()).alumnus.email, "ada@example.invalid")
      assert.deepEqual(body.employmentHistory, [])
      assert.deepEqual(body.fieldHistory, [])
    })

    await t.test("pagination returns the correct second-page records", async () => {
      for (let number = 1; number <= 9; number++) {
        await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,function,seniority,location) VALUES($1,$2,'F',2022,2022,'PGP','Example Co','Analyst','Finance','Analyst','Mumbai')", [`extra-${number}`, `Fictional ${String(number).padStart(2, "0")}`])
      }
      const first = await directory.runPostgresDirectoryQuery(db, query({ sort: "name" }))
      const second = await directory.runPostgresDirectoryQuery(db, query({ sort: "name", page: 2 }))
      assert.equal(first.total, 12)
      assert.equal(first.pageCount, 2)
      assert.equal(first.items.length, 10)
      assert.deepEqual(second.items.map(item => item.name), ["Fictional 08", "Fictional 09"])
      assert.equal((await directory.runPostgresDirectoryQuery(db, query({ sort: "name", page: 99 }))).page, 2)
    })

    await t.test("database connection failure has no D1 fallback", async () => {
      const missing = new pg.Pool({ host: join(temporary, "missing-socket"), user: role, database, connectionTimeoutMillis: 500 })
      try { await assert.rejects(directory.runPostgresDirectoryQuery(adapter.postgresDatabaseFromPool(missing), query({}))) }
      finally { await missing.end() }
    })
  } finally {
    if (originalBootstrapAdminEmails === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAILS
    else process.env.BOOTSTRAP_ADMIN_EMAILS = originalBootstrapAdminEmails
    if (pool) await pool.end()
    if (vite) await vite.close()
    if (started) await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"])
    await rm(temporary, { recursive: true, force: true })
  }
})
