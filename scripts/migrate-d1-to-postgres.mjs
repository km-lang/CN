#!/usr/bin/env node
// Step 4 tooling: copy a D1 (SQLite) database file into an EMPTY PostgreSQL
// database created from drizzle-postgres/0000_*.sql, then reconcile.
//
//   node scripts/migrate-d1-to-postgres.mjs --sqlite <file.sqlite> --pg-port <port>
//        [--pg-user cn_local_dev] [--pg-database cn_local_dev] [--report out.json]
//        [--dry-run] [--verify-only]
//
// Safety rules (local rehearsal authorization, 2026-11-15):
// - PostgreSQL host is always 127.0.0.1; no DATABASE_URL or remote host is accepted.
// - The original local D1 under .wrangler/state is refused; use an exported or disposable copy.
// - The SQLite file is opened read-only. All PostgreSQL writes happen in ONE transaction;
//   any error or reconciliation mismatch rolls everything back.
// - The target must be empty; the tool never merges into existing data.
// Mapping (docs/postgres-schema-comparison.md): identical table/column names; SQLite 0/1
// becomes PostgreSQL boolean; serial sequences are advanced past the copied ids.
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { DatabaseSync } from "node:sqlite"
import pg from "pg"

const argv = process.argv.slice(2)
const option = name => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined }
const flag = name => argv.includes(`--${name}`)
const sqlitePath = option("sqlite")
const port = Number(option("pg-port"))
const user = option("pg-user") ?? "cn_local_dev"
const database = option("pg-database") ?? "cn_local_dev"
const reportPath = option("report")
const dryRun = flag("dry-run")
const verifyOnly = flag("verify-only")

function fail(message) { console.error(`migrate-d1-to-postgres: ${message}`); process.exit(2) }
if (!sqlitePath) fail("--sqlite <file> is required.")
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("--pg-port must be a local port number.")
if (process.env.DATABASE_URL?.trim()) fail("Unset DATABASE_URL; this tool only targets a loopback PostgreSQL.")
const absoluteSqlite = resolve(sqlitePath)
if (absoluteSqlite.split(sep).join("/").includes("/.wrangler/state/")) fail("Refusing the original local D1 under .wrangler/state. Use an exported or disposable copy.")

const BATCH = 200
const IGNORED_SQLITE_TABLES = new Set(["d1_migrations", "_cf_KV", "_cf_METADATA", "sqlite_sequence"])
const quote = name => `"${name.replaceAll("\"", "\"\"")}"`

/** Canonical value for checksums: booleans as 0/1, everything else as stored. */
function canonical(value, isBoolean) {
  if (value === null || value === undefined) return null
  if (isBoolean) return value === true || value === 1 || value === "1" || value === "t" ? 1 : 0
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value)
  return String(value)
}

async function main() {
  const sqlite = new DatabaseSync(absoluteSqlite, { readOnly: true })
  const client = new pg.Client({ host: "127.0.0.1", port, user, database })
  await client.connect()
  const report = { startedAt: new Date().toISOString(), sqlite: absoluteSqlite, target: `127.0.0.1:${port}/${database}`, mode: verifyOnly ? "verify-only" : dryRun ? "dry-run" : "migrate", tables: [], ok: false }
  try {
    const { rows: columnRows } = await client.query(`select table_name, column_name, data_type, column_default from information_schema.columns
      where table_schema = 'public' order by table_name, ordinal_position`)
    const tables = new Map()
    for (const row of columnRows) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, [])
      tables.get(row.table_name).push({ name: row.column_name, boolean: row.data_type === "boolean", serial: /^nextval\(/.test(row.column_default ?? "") })
    }
    const { rows: pkRows } = await client.query(`select tc.table_name, kcu.column_name, kcu.ordinal_position from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by tc.table_name, kcu.ordinal_position`)
    const primaryKeys = new Map()
    for (const row of pkRows) { if (!primaryKeys.has(row.table_name)) primaryKeys.set(row.table_name, []); primaryKeys.get(row.table_name).push(row.column_name) }
    const { rows: fkRows } = await client.query(`select cl.relname as child, pa.relname as parent from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_class pa on pa.oid = c.confrelid join pg_namespace n on n.oid = cl.relnamespace
      where c.contype = 'f' and n.nspname = 'public'`)

    // Foreign-key order: parents before children (self references do not constrain order).
    const order = []
    const pending = new Set(tables.keys())
    while (pending.size) {
      const ready = [...pending].filter(table => !fkRows.some(fk => fk.child === table && fk.parent !== table && pending.has(fk.parent))).sort()
      if (!ready.length) throw new Error(`Foreign-key cycle among: ${[...pending].join(", ")}`)
      for (const table of ready) { order.push(table); pending.delete(table) }
    }

    const sqliteTables = new Set(sqlite.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name).filter(name => !IGNORED_SQLITE_TABLES.has(name)))
    const missingInSqlite = order.filter(table => !sqliteTables.has(table))
    const extraInSqlite = [...sqliteTables].filter(table => !tables.has(table))
    if (missingInSqlite.length || extraInSqlite.length) throw new Error(`Schema mismatch. Missing in D1: [${missingInSqlite.join(", ")}]; not in PostgreSQL: [${extraInSqlite.join(", ")}]`)
    for (const table of order) {
      const sqliteColumns = sqlite.prepare(`pragma table_info(${quote(table)})`).all().map(row => row.name).sort()
      const pgColumns = tables.get(table).map(column => column.name).sort()
      if (JSON.stringify(sqliteColumns) !== JSON.stringify(pgColumns)) throw new Error(`Column mismatch in ${table}: D1 [${sqliteColumns.join(",")}] vs PostgreSQL [${pgColumns.join(",")}]`)
    }

    await client.query("begin")
    await client.query("set local statement_timeout = 0")
    if (!verifyOnly) {
      for (const table of order) {
        const { rows: [{ count }] } = await client.query(`select count(*)::int as count from ${quote(table)}`)
        if (count !== 0) throw new Error(`Target table ${table} is not empty (${count} rows). The tool never merges; use an empty database.`)
      }
      for (const table of order) {
        const columns = tables.get(table)
        const names = columns.map(column => column.name)
        const rows = sqlite.prepare(`select ${names.map(quote).join(", ")} from ${quote(table)}`).all()
        for (let start = 0; start < rows.length; start += BATCH) {
          const chunk = rows.slice(start, start + BATCH)
          const values = []
          const tuples = chunk.map(row => `(${columns.map(column => {
            const raw = row[column.name]
            values.push(raw === null || raw === undefined ? null : column.boolean ? Boolean(Number(raw)) : typeof raw === "bigint" ? raw.toString() : raw)
            return `$${values.length}`
          }).join(", ")})`)
          await client.query(`insert into ${quote(table)} (${names.map(quote).join(", ")}) values ${tuples.join(", ")}`, values)
        }
        for (const column of columns.filter(item => item.serial)) {
          await client.query(`select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${quote(column.name)}) from ${quote(table)}), 1), (select max(${quote(column.name)}) from ${quote(table)}) is not null)`, [table, column.name])
        }
      }
    }

    // Reconciliation: row counts and an order-independent SHA-256 per table.
    let mismatches = 0
    for (const table of order) {
      const columns = tables.get(table)
      const names = columns.map(column => column.name)
      const keyColumns = primaryKeys.get(table) ?? names
      const digest = rows => {
        const lines = rows.map(row => JSON.stringify(columns.map(column => canonical(row[column.name], column.boolean)))).sort()
        return createHash("sha256").update(lines.join("\n")).digest("hex")
      }
      const sourceRows = sqlite.prepare(`select ${names.map(quote).join(", ")} from ${quote(table)}`).all()
      const { rows: targetRows } = await client.query(`select ${names.map(quote).join(", ")} from ${quote(table)} order by ${keyColumns.map(quote).join(", ")}`)
      const entry = { table, sourceRows: sourceRows.length, targetRows: targetRows.length, sourceSha256: digest(sourceRows), targetSha256: digest(targetRows) }
      entry.match = entry.sourceRows === entry.targetRows && entry.sourceSha256 === entry.targetSha256
      if (!entry.match) mismatches += 1
      report.tables.push(entry)
    }
    report.totalSourceRows = report.tables.reduce((sum, entry) => sum + entry.sourceRows, 0)
    report.totalTargetRows = report.tables.reduce((sum, entry) => sum + entry.targetRows, 0)
    report.mismatchedTables = report.tables.filter(entry => !entry.match).map(entry => entry.table)
    if (mismatches) throw new Error(`Reconciliation failed for ${mismatches} table(s): ${report.mismatchedTables.join(", ")}`)
    if (dryRun || verifyOnly) await client.query("rollback")
    else await client.query("commit")
    report.ok = true
    report.committed = !dryRun && !verifyOnly
  } catch (error) {
    await client.query("rollback").catch(() => {})
    report.error = error instanceof Error ? error.message : String(error)
    report.committed = false
  } finally {
    report.finishedAt = new Date().toISOString()
    await client.end().catch(() => {})
    sqlite.close()
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  const summary = `${report.mode}: ${report.ok ? "OK" : "FAILED"}; tables ${report.tables.length}; rows ${report.totalSourceRows ?? 0} -> ${report.totalTargetRows ?? 0}; committed ${report.committed}`
  console.log(summary)
  if (!report.ok) { console.error(report.error); process.exit(1) }
}

await main()
