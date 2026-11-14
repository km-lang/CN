# Steps 4–6: D1 → PostgreSQL migration, acceptance and handoff runbook

Status (2026-11-15): **local rehearsal complete; real-data migration NOT authorized; production cutover NO-GO.**
Authorized scope was local rehearsal only, with fictional/local data. No Neon project, no original or production
D1, and no deployment were touched. Every step marked **[REQUIRES AUTHORIZATION]** needs explicit written
approval from the project owner before it is run.

## 1. What is ready

| Area | Artifact | Evidence on the Windows laptop |
| --- | --- | --- |
| Schema | `drizzle-postgres/0000_cynical_dexter_bennett.sql` (44 tables, 609 columns, 55 FKs, 100 indexes, 19 CHECKs) | Applied cleanly to disposable PostgreSQL 17.12 clusters |
| Data migration | `scripts/migrate-d1-to-postgres.mjs` | `tests/postgres-d1-migration-rehearsal.test.mjs` 6/6 |
| Reconciliation | Same tool, `--verify-only` | Per-table row counts and order-independent SHA-256 over all columns |
| Application | PostgreSQL default backend; 57 methods (see access inventory) | Disposable PostgreSQL/D1 HTTP acceptance (see README) |
| Local operation | `npm.cmd run dev:local:windows` (PostgreSQL) | Admin/PCOM sign-in, Directory, Workspace and pages verified |

## 2. Migration tool contract

```
node scripts/migrate-d1-to-postgres.mjs --sqlite <copy.sqlite> --pg-port <port>
     [--pg-user U] [--pg-database D] [--report report.json] [--dry-run] [--verify-only]
```

- Reads the D1 SQLite file **read-only**. Refuses the original local D1 under `.wrangler/state`.
- Writes only to `127.0.0.1:<port>`. Refuses to run when `DATABASE_URL` is set. Reaching a hosted
  database therefore needs a reviewed change to this tool plus an authorization (section 4).
- The target must be **empty**; the tool never merges.
- Copies tables in foreign-key order inside **one transaction**, converts the 11 SQLite 0/1 boolean
  columns, and advances all 40 `serial` sequences past the copied ids.
- Reconciles every table by row count and SHA-256 before committing. Any mismatch or error rolls the
  whole transaction back and exits non-zero. `--dry-run` reconciles and rolls back. `--verify-only`
  compares an already migrated database.

Rehearsed on the laptop: a fresh D1 built from the real D1 migrations, the fictional local fixture and
300 synthetic alumni. Results: all 44 tables matched, booleans converted (150/300 ambiguous flags), the
next id followed the migrated maximum, a non-empty target was refused with nothing merged, a single
tampered row was detected by `--verify-only`, and a dry run left the target empty.

## 3. Rehearsal procedure (repeatable, fictional data)

```
node --test tests/postgres-d1-migration-rehearsal.test.mjs
```

It needs the portable PostgreSQL 17 binaries (`.sites-runtime/postgresql17/pgsql/bin`) and creates and
deletes everything under the OS temp directory.

## 4. Real-data migration procedure **[REQUIRES AUTHORIZATION]**

Do not start until **every** prerequisite below is met and the owner has approved in writing.

1. **Stage 3 closure.** The remaining D1-only actions are either migrated with accepted evidence or
   explicitly accepted as unavailable (see the access inventory). Signals POST and live provider
   execution currently fail closed under PostgreSQL.
2. **Authoritative backup.** Export the production D1 with Cloudflare's supported export. Record its
   time, migration level (the hosted database is older than the source's 0026; see README "Database and
   migrations") and SHA-256. Keep it offline and access-controlled; it contains real alumni data.
3. **Schema level.** Bring a restored *copy* of the export to the source schema (0026) in an isolated
   rehearsal environment only. Never upgrade production D1 in place.
4. **Freeze window.** Announce a write freeze. Disable provider live gates and mail. Confirm no
   in-progress provider claims, unresolved credit reservations or webhook deliveries are pending (Admin
   Provider Credits and webhook overview).
5. **Rehearse on the real export, in isolation.** Load the export into a disposable SQLite copy and run
   the tool with `--dry-run` against an empty local PostgreSQL. Investigate every mismatch before
   continuing.
6. **Target.** Create an empty `corporate_network` database on the approved Neon branch, apply the
   schema, and run `scripts/verify-postgres-schema.mjs`. Running the tool against Neon requires a
   reviewed change: an explicit `--allow-remote-host` flag limited to the approved pooled endpoint with
   `sslmode=require`.
7. **Migrate, then reconcile twice:** once with the tool's built-in reconciliation, then with
   `--verify-only` as an independent pass. Archive both JSON reports with the backup hash.
8. **Application switch.** Set `DATABASE_URL` (pooled endpoint) as a secret, keep `CN_DB_BACKEND`
   unset (PostgreSQL default) or set it to `postgres`, and deploy to staging first.
9. **Acceptance on staging** (section 5), then a production go/no-go decision.

### Rollback

Before the switch, abandon the PostgreSQL target; D1 is untouched. After the switch and before new
writes, set `CN_DB_BACKEND=d1`, unset `DATABASE_URL` and redeploy. After new writes on PostgreSQL,
rollback needs a reverse export, which has **not** been built or rehearsed. That gap is a go-live
blocker unless the owner accepts a write freeze until acceptance completes.

## 5. Acceptance checklist (Step 5)

| Check | Local status (2026-11-15) |
| --- | --- |
| Disposable PostgreSQL/D1 HTTP acceptance | See README "Latest evidence" |
| Full serial regression | 979 tests; no known failures after aligning the stale UI tests |
| Migration rehearsal | 6/6 |
| Local browser walkthrough (Admin/PCOM sign-in, Directory, profile, Administration) on PostgreSQL | See README |
| Neon connection capacity under load | **Not done:** requires the authorized Neon environment |
| Production-like browser and security acceptance on staging | **Not done:** requires deployment authorization |
| Lusha account usage log confirms the two rejected 401 requests consumed nothing | **Owner action** |

## 6. Handoff (Step 6)

- Source of truth: branch `sabarinadh`, local commits after `5c2edbd`. Nothing has been pushed.
- Operating notes for Windows: README "Safe local start" and "Stage 3 Windows checkpoint".
- Open decisions and remaining actions: `docs/postgres-app-access-inventory.md` "Current checkpoint".
- Approved compatibility contracts (2026-11-15): sanitized 409 for concurrent losers (Lusha identity
  approval, Discovery `keep_separate`, Admin pre-authorization correction, Discovery review actions,
  profile refresh); intended PostgreSQL identity attachment; atomic workspace import with D1's 400 status.
- Known D1 defects documented, not changed: `coresignalIdentityStore` SQL compilation failure;
  concurrent duplicate success audits for pre-authorization correction; raw constraint text in
  bulk-import errors.
