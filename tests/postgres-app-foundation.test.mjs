import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, appendFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import pg from "pg"
import { clusterSettings, pgCtl, pgExecutable } from "./support/postgres-test-platform.mjs"
import { createServer } from "vite"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const testRole = "cn_step3a_test"
const testDatabase = "cn_step3a_fixture"

async function command(name, args) {
  return name === "pg_ctl" ? pgCtl(args) : run(pgExecutable(name), args, { maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } })
}

test("PostgreSQL programme-option foundation uses only a disposable local cluster", async t => {
  try { await access(pgExecutable("initdb")) } catch { return t.skip("PostgreSQL 17 test binaries are unavailable") }
  const temporary = await mkdtemp(join(tmpdir(), "cn-step3a-postgres-"))
  const dataDir = join(temporary, "cluster")
  const socketDir = join(temporary, "socket")
  const cluster = clusterSettings(socketDir, { port: 5432, windowsPort: 55441 })
  let started = false
  let pool
  let vite
  try {
    await mkdir(socketDir)
    await command("initdb", ["-A", "trust", "--locale=C", "-U", testRole, "-D", dataDir, "--no-instructions"])
    await appendFile(join(dataDir, "postgresql.conf"), cluster.conf)
    await command("pg_ctl", ["-D", dataDir, "-l", join(temporary, "postgres.log"), "-w", "start"])
    started = true
    await command("createdb", ["-h", cluster.host, "-p", String(cluster.port), "-U", testRole, testDatabase])
    await command("psql", ["-h", cluster.host, "-p", String(cluster.port), "-U", testRole, "-d", testDatabase, "-v", "ON_ERROR_STOP=1", "-f", join(root, "drizzle-postgres/0000_cynical_dexter_bennett.sql")])

    vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
    const backend = await vite.ssrLoadModule("/db/backend.ts")
    const adapter = await vite.ssrLoadModule("/db/postgres/adapter.ts")
    const options = await vite.ssrLoadModule("/db/postgres/programme-options.ts")

    await t.test("selection and staging configuration fail closed", () => {
      assert.equal(backend.selectedDatabaseBackend({}), "d1")
      assert.equal(backend.selectedDatabaseBackend({ CN_DB_BACKEND: "postgres" }), "postgres")
      assert.throws(() => backend.selectedDatabaseBackend({ DATABASE_URL: "postgresql://example" }), /CN_DB_BACKEND is required/)
      assert.throws(() => backend.selectedDatabaseBackend({ CN_DB_BACKEND: "d1", DATABASE_URL: "postgresql://example" }), /must be unset/)
      assert.throws(() => backend.selectedDatabaseBackend({ CN_DB_BACKEND: "other" }), /must be either/)
      assert.throws(() => backend.requireD1Backend({ CN_DB_BACKEND: "postgres" }), /No fallback/)
      assert.throws(() => adapter.postgresRuntimePoolConfig({ CN_DB_BACKEND: "postgres" }), /DATABASE_URL is required/)
      assert.throws(() => adapter.postgresRuntimePoolConfig({ CN_DB_BACKEND: "postgres", DATABASE_URL: "postgresql://user:password@old.example/corporate_network?sslmode=require" }), /pooled Neon endpoint/)
      const config = adapter.postgresRuntimePoolConfig({ CN_DB_BACKEND: "postgres", DATABASE_URL: `postgresql://user:password@${adapter.NEW_PROJECT_POOLED_HOST}/corporate_network?sslmode=require` })
      assert.equal(config.max, 5)
      assert.equal(config.connectionTimeoutMillis, 5000)
    })

    await t.test("local test marker accepts only disposable macOS or Windows Temp clusters", async () => {
      const { isLocalPostgresTestMarker } = await vite.ssrLoadModule("/db/postgres/local-test-marker.ts")
      const windowsTemp = "C:\\Users\\Fictional User\\AppData\\Local\\Temp\\"
      assert.equal(isLocalPostgresTestMarker("/private/tmp/cn-step3c-postgres-Ab12Cd/socket"), true)
      assert.equal(isLocalPostgresTestMarker(`${windowsTemp}corporate-network-local-cn-step3c-postgres-Ab12Cd\\socket`), true)
      for (const rejected of ["", "/tmp/cn-step3c-postgres-Ab12Cd/socket", "/private/tmp/cn-step3c-postgres-Ab12Cd/socket/..",
        `${windowsTemp}cn-step3c-postgres-Ab12Cd\\socket`, `${windowsTemp}corporate-network-local-cn-step3c-postgres-Ab12Cd\\socket\\..`,
        "C:\\Users\\..\\AppData\\Local\\Temp\\corporate-network-local-cn-step3c-postgres-Ab12Cd\\socket",
        "D:\\project\\corporate-network-local-cn-step3c-postgres-Ab12Cd\\socket", `${windowsTemp}corporate-network-local-cn-step3c-postgres-Ab12Cd/socket`]) {
        assert.equal(isLocalPostgresTestMarker(rejected), false, rejected)
      }
      const local = { CN_DB_BACKEND: "postgres", CN_PG_LOCAL_TEST_ENABLED: "true", NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true" }
      const marker = `${windowsTemp}corporate-network-local-cn-step3c-postgres-Ab12Cd\\socket`
      assert.equal(adapter.postgresRuntimePoolConfig({ ...local, CN_PG_LOCAL_TEST_SOCKET: marker }).host, "127.0.0.1")
      assert.throws(() => adapter.postgresRuntimePoolConfig({ ...local, CN_PG_LOCAL_TEST_SOCKET: "D:\\project\\socket" }), /isolated Step 3C socket/)
      assert.throws(() => adapter.postgresRuntimePoolConfig({ ...local, CN_PG_LOCAL_TEST_SOCKET: marker, NODE_ENV: "production" }), /isolated Step 3C socket/)
      assert.throws(() => adapter.postgresRuntimePoolConfig({ ...local, CN_PG_LOCAL_TEST_SOCKET: marker, DATABASE_URL: "postgresql://example" }), /isolated Step 3C socket/)
    })

    pool = new pg.Pool({ host: cluster.host, port: cluster.port, user: testRole, database: testDatabase, max: 2, connectionTimeoutMillis: 1000 })
    const db = adapter.postgresDatabaseFromPool(pool)
    const admin = { userId: null, externalIdentity: "fictional-admin", displayName: "Fictional Admin", role: "ADMIN" }
    const pcom = { ...admin, role: "PCOM" }

    await t.test("node-postgres releases one-use clients after 5, 10 and 20 concurrent read transactions", async () => {
      const schema = await vite.ssrLoadModule("/db/postgres/schema.ts")
      const stressPool = new pg.Pool({ host: cluster.host, port: cluster.port, user: testRole, database: testDatabase, max: 5, maxUses: 1, connectionTimeoutMillis: 5000 })
      const stressDb = adapter.postgresDatabaseFromPool(stressPool)
      try {
        for (const size of [5, 10, 20]) {
          const startedAt = performance.now()
          const results = await Promise.all(Array.from({ length: size }, () => stressDb.transaction(async tx => {
            for (let index = 0; index < 9; index += 1) await tx.select().from(schema.programmeOptions)
            return true
          })))
          assert.ok(results.every(Boolean))
          assert.equal(stressPool.waitingCount, 0)
          t.diagnostic(JSON.stringify({ concurrentTransactions: size, elapsedMs: Math.round(performance.now() - startedAt), poolTotal: stressPool.totalCount, poolIdle: stressPool.idleCount, poolWaiting: stressPool.waitingCount }))
        }
      } finally { await stressPool.end() }
    })

    await t.test("read, missing record, write, returned values and retained audit", async () => {
      assert.deepEqual(await options.listPostgresProgrammeOptions(db, admin), [])
      assert.equal(await options.findPostgresProgrammeOption(db, admin, 12345), null)
      const created = await options.addPostgresProgrammeOption(db, admin, { code: " pgp ", name: "Fictional PGP" }, "2026-11-11T00:00:00.000Z")
      assert.equal(created.code, "PGP")
      assert.equal(created.name, "Fictional PGP")
      assert.equal(created.active, true)
      assert.equal(created.sortOrder, 10)
      assert.equal(created.updatedBy, admin.displayName)
      assert.equal((await options.findPostgresProgrammeOption(db, admin, created.id))?.id, created.id)
      const audit = await pool.query("SELECT action, entity_type, entity_id, metadata_json FROM security_audit_events")
      assert.deepEqual(audit.rows, [{ action: "programme_added", entity_type: "programme_option", entity_id: String(created.id), metadata_json: JSON.stringify({ code: "PGP", name: "Fictional PGP" }) }])
    })

    await t.test("invalid input, missing record, duplicate and PCOM denial", async () => {
      await assert.rejects(options.addPostgresProgrammeOption(db, admin, { code: "", name: "" }), error => error.status === 400)
      await assert.rejects(options.findPostgresProgrammeOption(db, admin, 0), error => error.status === 400)
      assert.equal(await options.findPostgresProgrammeOption(db, admin, 99999), null)
      await assert.rejects(options.addPostgresProgrammeOption(db, admin, { code: "PGP", name: "Duplicate" }), error => error.status === 409)
      await assert.rejects(options.listPostgresProgrammeOptions(db, pcom), error => error.status === 403)
      await assert.rejects(options.addPostgresProgrammeOption(db, pcom, { code: "ABM", name: "Denied" }), error => error.status === 403)
      assert.equal((await options.listPostgresProgrammeOptions(db, admin)).length, 1)
    })

    await t.test("concurrent duplicate submissions retain one programme and one audit", async () => {
      const results = await Promise.allSettled([
        options.addPostgresProgrammeOption(db, admin, { code: "RACE", name: "Fictional race" }),
        options.addPostgresProgrammeOption(db, admin, { code: "RACE", name: "Fictional race" }),
      ])
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
      assert.equal(results.filter(result => result.status === "rejected" && result.reason.status === 409).length, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS count FROM programme_options WHERE code='RACE'")).rows[0].count, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS count FROM security_audit_events WHERE metadata_json LIKE '%RACE%'")).rows[0].count, 1)
    })

    await t.test("audit failure rolls back the programme insert", async () => {
      const invalidActor = { ...admin, userId: 999999 }
      await assert.rejects(options.addPostgresProgrammeOption(db, invalidActor, { code: "ROLLBACK", name: "Rollback fixture" }), error => error.cause?.code === "23503")
      const rows = await pool.query("SELECT count(*)::integer AS count FROM programme_options WHERE code='ROLLBACK'")
      assert.equal(rows.rows[0].count, 0)
      const audits = await pool.query("SELECT count(*)::integer AS count FROM security_audit_events WHERE metadata_json LIKE '%ROLLBACK%'")
      assert.equal(audits.rows[0].count, 0)
    })

    await t.test("connection failure returns an error without D1 fallback", async () => {
      const missing = new pg.Pool({ host: join(temporary, "missing-socket"), port: 5432, user: testRole, database: testDatabase, connectionTimeoutMillis: 500 })
      try { await assert.rejects(options.listPostgresProgrammeOptions(adapter.postgresDatabaseFromPool(missing), admin)) }
      finally { await missing.end() }
    })
  } finally {
    if (pool) await pool.end()
    if (vite) await vite.close()
    if (started) await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"])
    await rm(temporary, { recursive: true, force: true })
  }
})
