# Step 2: isolated PostgreSQL schema baseline

This record applies only to Neon project `muddy-glitter-45208530`, branch
`br-young-term-az2sojx8` (`cn-sabarinadh-staging`), database
`corporate_network`. The branch was created with `init_source=parent-schema`.
The original v44 staging branch `br-bitter-block-azwume3e` was read only for
comparison and was not changed.

## Version-controlled source

The team's SQLite `db/schema.ts`, `drizzle/meta/0026_snapshot.json`, migration
`0026_green_ben_parker.sql`, and journal are byte-identical to the v44 source.
Only the independently maintained PostgreSQL schema, migration 0000, snapshot,
journal, schema comparator, and verifier were copied into this repository.
The copied migration SQL has SHA-256
`23570f8d18c96466880ed9a3c365bb598b830ba5e9af2fc422987769cbc89082`.
Its journal entry is `0000_cynical_dexter_bennett` at `1794330605437`.
`python3 scripts/check-postgres-schema.py` passes all 44 tables, 609 columns,
55 foreign keys, 100 non-primary indexes, and 19 CHECK constraints, with 103
intentional field mappings.

## Live catalog comparison

Both branches were queried read only before ledger reconciliation. The new
branch had 44 public tables, 609 columns, 44 primary keys, 55 foreign keys,
100 non-primary indexes (13 partial), 19 CHECK constraints, 40 public serial
sequences, zero application rows, and zero Drizzle migration rows. The
`drizzle.__drizzle_migrations` table had `id` serial, `hash` text, and
`created_at` bigint; its sequence was fresh (`last_value=1`, `is_called=false`).

Catalog fingerprints below include sorted object names and complete PostgreSQL
definitions, not just counts. Each matched the previously verified v44 staging
schema exactly:

| Catalog object | Count | New and reference MD5 fingerprint |
| --- | ---: | --- |
| Columns (order, types, nullability, defaults, lengths, precision) | 609 | `b25aa92022dde1db88e1e263b16078d1` |
| Constraints (`pg_get_constraintdef`, name, type, validity) | 118 | `6f317628d46b07cfb649a7cbc9476b85` |
| Indexes (`pg_indexes.indexdef`, including 44 primary indexes) | 144 | `4d59354e37fcd997c5055834db431e04` |
| Sequences (start, step, bounds, cache, cycling, owner) | 40 | `038ae9277db8c8cec4593450bee65452` |

The v44 staging ledger contained one row: `id=1`, migration SQL SHA-256 above,
and the exact journal timestamp above. That row was read as evidence only.

## Empty-ledger reconciliation

Schema-only branching copied database objects but no Drizzle migration row.
Running migration 0000 again would attempt to create 44 existing tables.
The baseline was reconciled by inserting the verified migration record **only
on the new branch**. The single conditional insert required, in the same SQL
statement, the 44-table and 609-column counts, all four catalog fingerprints
above, zero rows across all 44 application tables, an empty Drizzle ledger, and
a fresh ledger sequence. It returned exactly `id=1`, the migration SHA-256,
and `created_at=1794330605437`. A readback confirmed exactly that row.
Because the ledger is no longer empty, the same conditional insert cannot
repeat. No schema DDL or application data write was made.

Future migration commands must first verify project, branch ID, direct endpoint,
database, schema, and ledger against this record. The copied
`drizzle.postgres.config.ts` and `scripts/verify-postgres-schema.mjs` pin the
new branch's direct endpoint. They do not change the application's D1 adapter.

## Repository changes and validation

`drizzle.postgres.config.ts` was copied and then restricted to the new branch's
direct endpoint and database, so a supplied URL cannot silently target the
v44 staging branch. `.env.example` documents the variable without a password;
real values belong in ignored `.env.postgres.local` or a secret manager.
`pg` and `@types/pg` were added as development dependencies solely for the
read-only PostgreSQL verifier. The verifier was pinned to the new branch and
now checks the exact migration hash and journal timestamp, rather than only
the ledger row ID. No runtime database adapter or API module was changed.

Validation passed: `npm ci --ignore-scripts`, `python3
scripts/check-postgres-schema.py`, `drizzle-kit check` with both PostgreSQL and
SQLite configurations, `tsc --noEmit`, ESLint, verifier syntax check, and 124
serial tests across nine import, security, provider-credit, migration, PCOM,
and D1 regression files. Live catalog queries confirmed the baseline row and
the schema counts after reconciliation. The verifier's direct-URL execution
was not run because no credential was placed in this workspace; equivalent
catalog and ledger checks were executed through the branch-scoped Neon
connector.

A broader direct `node --test tests/*.test.mjs` run failed. It included tests
that require a built `dist` tree, assertions against UI text already changed
in the supplied application, and concurrent temporary-database creation that
hit `ENOSPC`. The targeted serial regression set passed without changing any
application behavior. The broad run is not a release acceptance result.

## Scope

This is schema preparation only. No real data was transferred, no application
route was connected to PostgreSQL, and no provider or deployment was invoked.
The v44 staging data, the original SQLite migrations, production D1, and
historical accounting reservations remain untouched.
