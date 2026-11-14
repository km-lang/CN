/** Read-only verification of the Neon staging schema after Drizzle migration. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Client } from "pg"

const expected = JSON.parse(readFileSync(new URL("../drizzle-postgres/meta/0000_snapshot.json", import.meta.url))).tables
const tables = Object.fromEntries(Object.entries(expected).map(([name, value]) => [name.replace(/^public\./, ""), value]))
const url = process.env.DATABASE_URL_UNPOOLED
const expectEmpty = process.argv.includes("--expect-empty")
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")
const parsed = new URL(url)
assert.equal(parsed.pathname.slice(1), "corporate_network", "wrong database")
assert.ok(!parsed.hostname.includes("-pooler"), "migration verification requires the direct endpoint")
assert.equal(parsed.hostname, "ep-super-meadow-az4e41mn.c-3.ap-southeast-1.aws.neon.tech", "wrong new-project branch endpoint")

const client = new Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN READ ONLY")
  const identity = (await client.query("select current_database() as name, current_setting('server_version_num')::integer as version")).rows[0]
  assert.equal(identity.name, "corporate_network")
  assert.ok(identity.version >= 170000 && identity.version < 180000, "expected PostgreSQL 17")

  const actualTables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => row.tablename)
  assert.deepEqual(actualTables, Object.keys(tables).sort(), "application table names")

  const actualColumns = (await client.query(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema='public'
  `)).rows
  const columnsByKey = new Map(actualColumns.map(row => [`${row.table_name}.${row.column_name}`, row]))
  for (const [tableName, table] of Object.entries(tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      const actual = columnsByKey.get(`${tableName}.${columnName}`)
      assert.ok(actual, `missing ${tableName}.${columnName}`)
      const type = column.type === "serial" ? "integer" : column.type
      assert.equal(actual.data_type, type, `${tableName}.${columnName} type`)
      assert.equal(actual.is_nullable === "NO", column.notNull, `${tableName}.${columnName} nullability`)
      assert.equal(Boolean(actual.column_default), Object.hasOwn(column, "default") || column.type === "serial", `${tableName}.${columnName} default presence`)
      if (column.type === "serial") assert.match(actual.column_default, /^nextval\(/, `${tableName}.${columnName} sequence`)
      if (typeof column.default === "string" && column.default.startsWith("to_char(timezone")) assert.match(actual.column_default, /^to_char\(timezone\(/, `${tableName}.${columnName} UTC default`)
    }
  }
  assert.equal(actualColumns.length, 609, "column count")

  const constraints = (await client.query(`
    select t.relname as table_name, c.conname, c.contype,
      to_json((select array_agg(a.attname order by u.ordinality) from unnest(c.conkey) with ordinality u(attnum, ordinality)
       join pg_attribute a on a.attrelid=t.oid and a.attnum=u.attnum)) as columns_from,
      rt.relname as table_to,
      to_json((select array_agg(a.attname order by u.ordinality) from unnest(c.confkey) with ordinality u(attnum, ordinality)
       join pg_attribute a on a.attrelid=rt.oid and a.attnum=u.attnum)) as columns_to
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    left join pg_class rt on rt.oid=c.confrelid
    where n.nspname='public'
  `)).rows
  const groups = Object.groupBy(constraints, row => row.contype)
  assert.equal(groups.p?.length, 44, "primary keys")
  assert.equal(groups.f?.length, 55, "foreign keys")
  assert.equal(groups.c?.length, 19, "CHECK constraints")
  const actualFks = new Set(groups.f.map(row => JSON.stringify([row.table_name, row.columns_from, row.table_to, row.columns_to])))
  const expectedFks = new Set(Object.entries(tables).flatMap(([tableName, table]) => Object.values(table.foreignKeys).map(fk => JSON.stringify([tableName, fk.columnsFrom, fk.tableTo, fk.columnsTo]))))
  assert.deepEqual(actualFks, expectedFks, "foreign-key relationships")
  const actualFkNames = new Set(groups.f.map(row => `${row.table_name}.${row.conname}`))
  const expectedFkNames = new Set(Object.entries(tables).flatMap(([tableName, table]) => Object.keys(table.foreignKeys).map(name => `${tableName}.${name.slice(0, 63)}`)))
  assert.deepEqual(actualFkNames, expectedFkNames, "foreign-key names, including PostgreSQL truncation")
  const actualChecks = new Set(groups.c.map(row => `${row.table_name}.${row.conname}`))
  const expectedChecks = new Set(Object.entries(tables).flatMap(([tableName, table]) => Object.keys(table.checkConstraints).map(name => `${tableName}.${name}`)))
  assert.deepEqual(actualChecks, expectedChecks, "CHECK names")

  const indexes = (await client.query(`
    select t.relname as table_name, ic.relname as index_name, i.indisunique, i.indisprimary,
      i.indpred is not null as is_partial
    from pg_index i join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    join pg_class ic on ic.oid=i.indexrelid
    where n.nspname='public'
  `)).rows.filter(row => !row.indisprimary)
  assert.equal(indexes.length, 100, "non-primary indexes")
  const actualIndexes = new Map(indexes.map(row => [row.index_name, row]))
  for (const [tableName, table] of Object.entries(tables)) {
    for (const [name, index] of Object.entries(table.indexes)) {
      const actual = actualIndexes.get(name)
      assert.ok(actual, `missing index ${name}`)
      assert.equal(actual.table_name, tableName, `${name} table`)
      assert.equal(actual.indisunique, index.isUnique, `${name} uniqueness`)
      assert.equal(actual.is_partial, Boolean(index.where), `${name} predicate presence`)
    }
  }
  assert.equal(indexes.filter(row => row.is_partial).length, 13, "partial indexes")

  const ledger = (await client.query("select id, hash, created_at::text from drizzle.__drizzle_migrations order by id")).rows
  assert.deepEqual(ledger, [{
    id: 1,
    hash: "23570f8d18c96466880ed9a3c365bb598b830ba5e9af2fc422987769cbc89082",
    created_at: "1794330605437",
  }], "Drizzle migration ledger")
  if (expectEmpty) for (const tableName of actualTables) {
    const result = await client.query(`select count(*)::integer as count from "${tableName}"`)
    assert.equal(result.rows[0].count, 0, `${tableName} must remain empty`)
  }
  await client.query("COMMIT")
  console.log(`PASS: PostgreSQL 17 staging has 44${expectEmpty ? " empty" : ""} tables, 609 columns, 44 PKs, 55 FKs, 100 indexes (13 partial), 19 CHECKs, and one Drizzle ledger entry`)
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
