import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Local launcher with session-backed local auth and fictional fixtures.
// Default backend: a local PostgreSQL 17 cluster under .sites-runtime/postgres-local
// (git-ignored, loopback-only, kept between launches; --reset-postgres recreates it).
// CN_DB_BACKEND=d1 keeps the previous behaviour: a NEW disposable D1 each launch.
// Never seed .wrangler/state, never use DATABASE_URL and never contact a provider.
const root = fileURLToPath(new URL("../", import.meta.url))
const host = "127.0.0.1"
const portArgument = process.argv.find(argument => argument.startsWith("--port="))
const port = portArgument ? Number(portArgument.slice("--port=".length)) : 3000
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be a whole number from 1024 to 65535.")
// --coresignal-live opts into REAL, PAID Coresignal External Discovery (ES-DSL Preview only; Collect,
// Lusha, Bright Data and mail stay off). It mirrors the package's approved
// dev:local:coresignal-exact-year-live recipe and needs CORESIGNAL_API_KEY in .env.local.
const coresignalLive = process.argv.includes("--coresignal-live")
const origin = coresignalLive ? `http://127.0.0.1:${port}` : `http://localhost:${port}`
const backend = process.env.CN_DB_BACKEND?.trim() || "postgres"
if (backend !== "postgres" && backend !== "d1") throw new Error("CN_DB_BACKEND must be either postgres or d1.")
if (process.env.DATABASE_URL?.trim()) throw new Error("Unset DATABASE_URL. The local launcher never connects to a hosted database.")
const resetPostgres = process.argv.includes("--reset-postgres")

async function portFree(candidate) {
  return new Promise(resolve => {
    const probe = createServer()
    probe.once("error", () => resolve(false))
    probe.listen(candidate, host, () => probe.close(() => resolve(true)))
  })
}
if (!await portFree(port)) throw new Error(`Port ${port} is in use. Stop the previous local demo before starting another.`)

// Cloudflare local state (and the D1 database in d1 mode) lives in a new temp directory each launch.
const persistPath = await realpath(await mkdtemp(join(tmpdir(), "corporate-network-local-")))
const environment = {
  ...process.env,
  CI: "1",
  NODE_ENV: "development",
  CN_DB_BACKEND: backend,
  CN_PG_LOCAL_DEV_ENABLED: backend === "postgres" ? "true" : "false",
  LOCAL_DEV_AUTH_ENABLED: "true",
  LOCAL_DEV_AUTH_ROLE: "ADMIN",
  LOCAL_DEV_D1_PERSIST_PATH: persistPath,
  AUTH_SESSION_SECRET: randomBytes(48).toString("base64url"),
  LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "false",
  LOCAL_CORESIGNAL_SEARCH_ENABLED: "false",
  CORESIGNAL_LIVE_ENABLED: "false",
  CORESIGNAL_SEARCH_ENABLED: "false",
  CORESIGNAL_ES_DSL_PREVIEW_ENABLED: "false",
  CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "unknown",
  CORESIGNAL_COLLECT_ENABLED: "false",
  CORESIGNAL_COLLECT_ENTITLEMENT: "unknown",
  CORESIGNAL_COLLECT_MOCK_TRANSPORT: "false",
  // Opts the disposable D1 into mock External Discovery (and mock webhook simulation); no provider call or webhook receipt is enabled.
  CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true",
  CORESIGNAL_WEBHOOK_RECEIVE_ENABLED: "false",
  LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "false",
  BRIGHTDATA_LIVE_ENABLED: "false",
  BRIGHTDATA_MOCK_TRANSPORT: "false",
  BRIGHTDATA_HUMAN_TRIAL_ENABLED: "false",
  BRIGHTDATA_ACCESS_ENTITLEMENT: "unknown",
  LOCAL_LUSHA_LIVE_DEMO_ENABLED: "false",
  LOCAL_LUSHA_V3_MOCK_TRANSPORT: "false",
  LUSHA_LIVE_ENABLED: "false",
  LUSHA_SIGNALS_LIVE_ENABLED: "false",
  LUSHA_SEARCH_ENTITLEMENT: "unknown",
  LUSHA_EMAIL_ENTITLEMENT: "unknown",
  LUSHA_PHONE_ENTITLEMENT: "unknown",
  MAIL_MODE: "mock",
  MAIL_LIVE_ENABLED: "false",
  GMAIL_SEND_SCOPE_CONFIRMED: "false",
  APP_PUBLIC_URL: origin,
  APP_BASE_PATH: "/",
  NEXT_PUBLIC_APP_PUBLIC_URL: origin,
  NEXT_PUBLIC_APP_BASE_PATH: "/",
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: join(root, ".wrangler", "logs"),
  WRANGLER_SEND_METRICS: "false",
}
delete environment.DATABASE_URL
delete environment.DATABASE_URL_UNPOOLED
delete environment.CN_PG_LOCAL_TEST_ENABLED
delete environment.CN_PG_LOCAL_TEST_SOCKET
if (coresignalLive) {
  // Only the key's presence is checked; its value is never printed or read here.
  let keyPresent = Boolean(process.env.CORESIGNAL_API_KEY?.trim())
  try { keyPresent ||= /^CORESIGNAL_API_KEY=\s*\S+/m.test(await readFile(join(root, ".env.local"), "utf8")) } catch { /* no .env.local */ }
  if (!keyPresent) throw new Error("--coresignal-live needs CORESIGNAL_API_KEY in .env.local (your paid Coresignal key).")
  Object.assign(environment, {
    LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "true",
    LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1",
    CORESIGNAL_LIVE_ENABLED: "true",
    CORESIGNAL_SEARCH_ENABLED: "true",
    LOCAL_CORESIGNAL_SEARCH_ENABLED: "true",
    CORESIGNAL_ES_DSL_PREVIEW_ENABLED: "true",
    // Account-owner attestation that the paid plan includes Base Employee ES-DSL Preview.
    CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "confirmed",
    CORESIGNAL_COLLECT_ENABLED: "false",
    CORESIGNAL_COLLECT_ENTITLEMENT: "unknown",
    // One Preview page returns up to 20 results for the same ~20 credits, so keep the full page by default.
    CORESIGNAL_LIVE_SEARCH_MAX_RESULTS: process.env.CORESIGNAL_LIVE_SEARCH_MAX_RESULTS?.trim() || "20",
    CORESIGNAL_EMPLOYEE_DATASET: process.env.CORESIGNAL_EMPLOYEE_DATASET?.trim() === "multi_source" ? "multi_source" : "base",
    CORESIGNAL_LIVE_REFRESH_MAX_PROFILES: "1",
  })
  delete environment.CORESIGNAL_API_KEY // taken from .env.local by Vite; never placed on the command line
  console.warn(`LIVE CORESIGNAL ENABLED (${environment.CORESIGNAL_EMPLOYEE_DATASET} dataset, up to ${environment.CORESIGNAL_LIVE_SEARCH_MAX_RESULTS} results per search): each Discover search makes one paid ES-DSL Preview request (about 20 search credits per page by the vendor workbook; the actual debit is unverified). Admin confirmation is required per search; Collect stays off.`)
}

async function run(entry, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, entry), ...args], {
      cwd: root, env: environment, stdio: "inherit", windowsHide: true,
    })
    child.once("error", reject)
    child.once("exit", code => code === 0
      ? resolve()
      : reject(new Error(`${entry} exited with code ${code}`)))
  })
}

// ---- Local PostgreSQL 17 cluster (default backend) ----
// Must match the CN_PG_LOCAL_DEV_ENABLED gate in db/postgres/adapter.ts.
const pg = { port: 55432, user: "cn_local_dev", database: "cn_local_dev" }
const pgBin = process.env.PG_LOCAL_BIN || join(root, ".sites-runtime", "postgresql17", "pgsql", "bin")
const pgHome = join(root, ".sites-runtime", "postgres-local")
const pgData = join(pgHome, "cluster")
const pgMarker = join(pgHome, "schema.sha256")
const pgExe = name => join(pgBin, process.platform === "win32" ? `${name}.exe` : name)
const schemaFiles = ["drizzle-postgres/0000_cynical_dexter_bennett.sql", "scripts/local-development-fixture.postgres.sql"]

function pgTool(name, args, { quiet = false } = {}) {
  // pg_ctl's postmaster inherits stdio on Windows, so it never gets captured pipes.
  return new Promise((resolve, reject) => {
    const child = spawn(pgExe(name), args, { stdio: quiet || name === "pg_ctl" ? "ignore" : ["ignore", "ignore", "inherit"], windowsHide: true, env: { ...process.env, LC_ALL: "C", LANG: "C" } })
    child.once("error", reject)
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${name} exited with code ${code}`)))
  })
}
// Only the launcher that started the cluster stops it; a second launcher that
// reuses a running cluster must never take it away from the first.
let startedPostgres = false
const pgRunning = () => pgTool("pg_ctl", ["status", "-D", pgData], { quiet: true }).then(() => true, () => false)
async function schemaHash() {
  const hash = createHash("sha256")
  for (const file of schemaFiles) hash.update(await readFile(join(root, file)))
  return hash.digest("hex")
}

async function preparePostgres() {
  if (!existsSync(pgExe("initdb"))) throw new Error(`PostgreSQL 17 binaries were not found in ${pgBin}. Set PG_LOCAL_BIN or run with CN_DB_BACKEND=d1.`)
  const expected = await schemaHash()
  if (resetPostgres && existsSync(pgData)) {
    if (await pgRunning()) await pgTool("pg_ctl", ["stop", "-D", pgData, "-m", "fast", "-w"])
    await rm(pgHome, { recursive: true, force: true })
    console.log("Local PostgreSQL cluster removed for --reset-postgres.")
  }
  if (!existsSync(pgData)) {
    if (!await portFree(pg.port)) throw new Error(`Port ${pg.port} is already in use by another program; the local PostgreSQL cluster cannot start.`)
    await mkdir(pgHome, { recursive: true })
    await pgTool("initdb", ["-A", "trust", "--locale=C", "--encoding=UTF8", "-U", pg.user, "-D", pgData, "--no-instructions"], { quiet: true })
    await appendFile(join(pgData, "postgresql.conf"), `\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = ${pg.port}\n`)
    await pgTool("pg_ctl", ["start", "-D", pgData, "-l", join(pgHome, "postgres.log"), "-w"])
    startedPostgres = true
    const connection = ["-h", host, "-p", String(pg.port), "-U", pg.user]
    await pgTool("createdb", [...connection, pg.database])
    for (const file of schemaFiles) await pgTool("psql", [...connection, "-q", "-d", pg.database, "-v", "ON_ERROR_STOP=1", "-f", join(root, file)], { quiet: true })
    await writeFile(pgMarker, `${expected}\n`)
    console.log(`Created local PostgreSQL cluster with fictional fixtures: ${pgData}`)
    return
  }
  const recorded = existsSync(pgMarker) ? (await readFile(pgMarker, "utf8")).trim() : ""
  if (recorded !== expected) throw new Error("The PostgreSQL schema or local fixture changed since this cluster was created. Restart with --reset-postgres to rebuild it (local fictional data is discarded).")
  if (!await pgRunning()) {
    if (!await portFree(pg.port)) throw new Error(`Port ${pg.port} is already in use by another program; the local PostgreSQL cluster cannot start.`)
    await pgTool("pg_ctl", ["start", "-D", pgData, "-l", join(pgHome, "postgres.log"), "-w"])
    startedPostgres = true
  }
  console.log(`Using local PostgreSQL cluster: ${pgData}`)
}

async function stopPostgres() {
  if (backend === "postgres" && startedPostgres && await pgRunning()) await pgTool("pg_ctl", ["stop", "-D", pgData, "-m", "fast", "-w"]).catch(() => {})
}

if (backend === "postgres") {
  await preparePostgres()
  console.log(`Database: local PostgreSQL 127.0.0.1:${pg.port}/${pg.database} (data kept between launches)`)
} else {
  console.log(`Disposable local D1: ${persistPath}`)
  const databaseArgs = ["DB", "--config", "wrangler.local.jsonc", "--local", "--persist-to", persistPath]
  await run("node_modules/wrangler/bin/wrangler.js", ["d1", "migrations", "apply", ...databaseArgs])
  await run("node_modules/wrangler/bin/wrangler.js", ["d1", "execute", ...databaseArgs,
    "--file", "scripts/local-development-fixture.sql", "--yes"])
}
console.log(`Admin: ${origin}/login/admin`)
console.log(`PCOM:  ${origin}/login/pcom`)
console.log("Development fixtures only. Live providers and mail are disabled. Ctrl+C stops the server.")
process.once("SIGINT", () => { /* the Vite child receives it too; cleanup runs below */ })
try {
  await run("node_modules/vite/bin/vite.js", ["--host", host, "--port", String(port), "--strictPort"])
} finally {
  await stopPostgres()
}
