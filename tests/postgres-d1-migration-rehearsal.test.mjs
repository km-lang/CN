// Step 4 local rehearsal (authorized 2026-11-15: fictional/local data only).
// Builds a disposable D1 from the real D1 migrations and the local fictional fixture,
// adds synthetic rows, migrates it into a disposable PostgreSQL 17 cluster with
// scripts/migrate-d1-to-postgres.mjs and checks reconciliation and safety rules.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, appendFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import pg from "pg"
import { clusterSettings, pgCtl, pgExecutable } from "./support/postgres-test-platform.mjs"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const role = "cn_rehearsal_test"
const command = (name, args) => name === "pg_ctl" ? pgCtl(args) : run(pgExecutable(name), args, { maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } })
const migrate = (args) => run(process.execPath, [join(root, "scripts/migrate-d1-to-postgres.mjs"), ...args], { cwd: root, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, DATABASE_URL: "" } })
  .then(result => ({ code: 0, ...result }), error => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }))

test("D1 to PostgreSQL migration rehearsal reconciles fictional data and fails safe", async t => {
  try { await access(pgExecutable("initdb")) } catch { return t.skip("PostgreSQL 17 test binaries are unavailable") }
  const temporary = await mkdtemp(join(tmpdir(), "cn-step4-rehearsal-"))
  const dataDir = join(temporary, "cluster")
  const socketDir = join(temporary, "socket")
  const cluster = clusterSettings(socketDir, { port: 5432, windowsPort: 55444 })
  const d1Dir = join(temporary, "d1")
  let started = false
  let pool
  try {
    // 1. Disposable D1: real migrations + fictional local fixture + synthetic rows.
    const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js")
    const d1Args = ["DB", "--config", "wrangler.local.jsonc", "--local", "--persist-to", d1Dir]
    await run(process.execPath, [wrangler, "d1", "migrations", "apply", ...d1Args], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", "scripts/local-development-fixture.sql", "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const objectDir = join(d1Dir, "v3", "d1", "miniflare-D1DatabaseObject")
    const sqliteFile = join(objectDir, (await readdir(objectDir)).find(name => name.endsWith(".sqlite") && name !== "metadata.sqlite"))
    const d1 = new DatabaseSync(sqliteFile)
    const insert = d1.prepare("INSERT INTO alumni (profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location,email,current_role_ambiguous) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    for (let index = 1; index <= 300; index += 1) insert.run(`rehearsal:${index}`, `Fictional Rehearsal ${index}`, "FR", 2000 + (index % 25), 2000 + (index % 25), "PGP", `Fictional Co ${index % 17}`, "Analyst", "Finance", "Analyst/Junior", "Lucknow", `rehearsal.${index}@example.test`, index % 2)
    const sourceAlumni = d1.prepare("SELECT count(*) AS n FROM alumni").get().n
    const sourceMaxId = d1.prepare("SELECT max(id) AS n FROM alumni").get().n
    d1.close()

    // 2. Disposable PostgreSQL with the project schema.
    await mkdir(socketDir)
    await command("initdb", ["-A", "trust", "--locale=C", "-U", role, "-D", dataDir, "--no-instructions"])
    await appendFile(join(dataDir, "postgresql.conf"), cluster.conf)
    await command("pg_ctl", ["-D", dataDir, "-l", join(temporary, "postgres.log"), "-w", "start"])
    started = true
    const schema = join(root, "drizzle-postgres/0000_cynical_dexter_bennett.sql")
    for (const database of ["cn_rehearsal", "cn_rehearsal_dry"]) {
      await command("createdb", ["-h", cluster.host, "-p", String(cluster.port), "-U", role, database])
      await command("psql", ["-h", cluster.host, "-p", String(cluster.port), "-U", role, "-d", database, "-q", "-v", "ON_ERROR_STOP=1", "-f", schema])
    }
    const base = ["--sqlite", sqliteFile, "--pg-port", String(cluster.port), "--pg-user", role]
    if (cluster.host !== "127.0.0.1") return t.skip("The migration tool targets loopback TCP; this platform's cluster uses a Unix socket only.")
    pool = new pg.Pool({ host: cluster.host, port: cluster.port, user: role, database: "cn_rehearsal", max: 2 })

    await t.test("safety rules refuse the original local D1, remote targets and DATABASE_URL", async () => {
      const original = await migrate(["--sqlite", join(root, ".wrangler", "state", "v3", "d1", "x.sqlite"), "--pg-port", String(cluster.port)])
      assert.equal(original.code, 2)
      assert.match(original.stderr, /Refusing the original local D1/)
      const withUrl = await run(process.execPath, [join(root, "scripts/migrate-d1-to-postgres.mjs"), ...base, "--pg-database", "cn_rehearsal"], { cwd: root, env: { ...process.env, DATABASE_URL: "postgresql://fictional@example.invalid/db" } }).then(() => 0, error => error.code)
      assert.equal(withUrl, 2)
    })

    await t.test("dry run reconciles every table and leaves the target empty", async () => {
      const report = join(temporary, "dry.json")
      const result = await migrate([...base, "--pg-database", "cn_rehearsal_dry", "--dry-run", "--report", report])
      assert.equal(result.code, 0, result.stderr)
      const parsed = JSON.parse(await readFile(report, "utf8"))
      assert.deepEqual({ ok: parsed.ok, committed: parsed.committed, mismatched: parsed.mismatchedTables, tables: parsed.tables.length }, { ok: true, committed: false, mismatched: [], tables: 44 })
      const dry = new pg.Pool({ host: cluster.host, port: cluster.port, user: role, database: "cn_rehearsal_dry", max: 1 })
      try { assert.equal((await dry.query("SELECT count(*)::integer AS n FROM alumni")).rows[0].n, 0) } finally { await dry.end() }
    })

    await t.test("migration copies all rows, converts booleans and continues sequences", async () => {
      const report = join(temporary, "migrate.json")
      const result = await migrate([...base, "--pg-database", "cn_rehearsal", "--report", report])
      assert.equal(result.code, 0, result.stderr)
      const parsed = JSON.parse(await readFile(report, "utf8"))
      assert.deepEqual({ ok: parsed.ok, committed: parsed.committed, mismatched: parsed.mismatchedTables, tables: parsed.tables.length }, { ok: true, committed: true, mismatched: [], tables: 44 })
      assert.equal(parsed.totalSourceRows, parsed.totalTargetRows)
      assert.ok(parsed.tables.every(entry => entry.match && entry.sourceSha256 === entry.targetSha256))
      const { rows: [state] } = await pool.query("SELECT (SELECT count(*)::integer FROM alumni) AS alumni,(SELECT count(*)::integer FROM alumni WHERE current_role_ambiguous) AS ambiguous,(SELECT bool_and(enabled) FROM application_users) AS users_enabled")
      assert.deepEqual(state, { alumni: sourceAlumni, ambiguous: 150, users_enabled: true })
      const { rows: [inserted] } = await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location) VALUES ('rehearsal:new','Fictional New','FN',2024,'PGP','Fictional Co','Analyst','Finance','Analyst/Junior','Lucknow') RETURNING id")
      assert.ok(inserted.id > sourceMaxId, `new id ${inserted.id} must follow migrated max ${sourceMaxId}`)
      await pool.query("DELETE FROM alumni WHERE profile_key='rehearsal:new'")
    })

    await t.test("a non-empty target is refused and nothing is merged", async () => {
      const result = await migrate([...base, "--pg-database", "cn_rehearsal"])
      assert.equal(result.code, 1)
      assert.match(result.stderr, /is not empty/)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM alumni")).rows[0].n, sourceAlumni)
    })

    await t.test("verify-only detects a changed row after migration", async () => {
      assert.equal((await migrate([...base, "--pg-database", "cn_rehearsal", "--verify-only"])).code, 0)
      await pool.query("UPDATE alumni SET company='Tampered Co' WHERE profile_key='rehearsal:7'")
      const report = join(temporary, "verify.json")
      const result = await migrate([...base, "--pg-database", "cn_rehearsal", "--verify-only", "--report", report])
      assert.equal(result.code, 1)
      assert.deepEqual(JSON.parse(await readFile(report, "utf8")).mismatchedTables, ["alumni"])
    })
  } finally {
    if (pool) await pool.end()
    if (started) await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"])
    await rm(temporary, { recursive: true, force: true })
  }
})
