# Corporate Network

Corporate Network is a Placement Committee workspace for alumni ingestion, discovery and professional-data accuracy. The primary journey is Excel/CSV upload → governed import review → Alumni Directory → missing/outdated-data review → approved professional evidence → batch/current-company filtering → reviewed alumni profile.

Provider output is evidence, not canonical truth. Corporate Network owns its institutional alumni record and never silently overwrites it from a provider response.

## PCOM workflow redesign (2026-10-28)

This is local development only. Institutional data, provider histories, the unresolved Coresignal Collect reservation and production recovery restrictions are preserved.

- **PCOM upload:** authorized PCOM and Admin users can upload Excel (.xlsx) or CSV, map columns to supported fields, validate and preview up to 10,000 rows / 8 MB, inspect row errors and duplicates, and download a review report. Only Admin can execute an explicitly reviewed import. PCOM provides the source file and review report to Admin; there is no new background approval queue. Execution revalidates stale previews, maintains idempotency/audit history and retains bounded transactional batches. Invalid, duplicate, conflicting and unresolved rows are excluded; partial outcomes remain explicit. Missing company is allowed as an unverified claim rather than invented employment. Stable source identity and other existing required fields still apply.
- **Directory:** Batch / Graduation Year and Current Company are primary, alongside simple name search, Reset and server pagination/counts. Company case/whitespace normalization and existing verified mapping/alias rules are retained; a Missing current company option handles absent employer data. Secondary search APIs and stored fields remain available to existing integrations.
- **Profile accuracy:** missing company (highest priority), designation and profile URL are flagged. Explicit outdated states and provider observations older than 180 days prompt review; timestamps do not prove an employment change. Conflicting retained career evidence or pending protected corrections are shown in the profile. VERIFIED / RECENTLY REVIEWED requires existing positive verification states and a dated human field-verification audit; generic edits and provider fetches are insufficient.
- **Professional evidence:** profile review compares canonical values with retained professional observations, shows review status and provenance, and supports explicit Admin apply/keep decisions for pending Coresignal professional reviews. Stale selected-field evidence is rejected before updates. Protected profile corrections retain Admin accept/reject and version checks. New professional lookup preparation retains existing Coresignal/Bright Data gates and confirmations. Discovery, enrichment and human verification remain separate; there is no automatic provider-to-canonical promotion.
- **Lusha-only Enrichment:** the primary screen shows Contact Search, separate Email/Phone preparation, Lusha allowance and Lusha evidence/reviews. Stable identity approval, separate contact approvals, credit reservations, duplicate fences, restricted contacts and backend authorization are preserved. Lusha contact matches and Reveal do **not** independently verify current employment. No provider has been substituted for professional evidence.
- **Retired UI:** Engagement, its dependent Outreach workspace, Opportunities and standalone Intelligence navigation, Overview shortcuts, profile entry points and workspace menus are inactive. Their backend routes, tables, migrations, mail/webhook/audit history and shared utilities remain. Retired deep links resolve to Directory. Overview no longer presents Professional Signals, Birthday Engagement or Recommended Outreach Route; it uses stored alumni/import metrics and the upload/review journey. Previous dry-run language is removed from import actions in favor of preview/validation; legitimate saved discovery and Admin operational histories remain available. Legacy JSX is retained behind a non-rendering retirement boundary to avoid a broad backend refactor.
- **Admin governance:** Administration retains all-provider credit governance, retained Collect candidates, complete sanitized provider history, Lusha identity/contact decisions and audit visibility. Removing provider cards from Enrichment does not release unresolved reservations or delete evidence. PCOM cannot commit imports, approve provider identities/contacts, change spending limits or read secrets. Existing operational professional-field verification permissions are retained.
- **Provider status:** local acceptance uses fictional fixtures and disposable D1. Live providers and mail stay disabled. Production-live professional accuracy, provider entitlement and billing are not established by local tests. No production migration, publishing or deployment is authorized.

Final redesign validation (2026-10-28): **873 total, 857 passed, 0 failed, 16 skipped** in the full serial suite; focused functional tests **50/50 passed**. TypeScript, ESLint, direct production build and scoped/staged Git whitespace checks passed. The 16 optional rendered email-composer tests remain skipped under their existing opt-in guard and are not browser acceptance. Authenticated disposable-D1 API checks cover import approval/idempotency, protected corrections, provider identity/contact decisions, contact redaction, stale selected-field rejection, audit and zero-paid-request accounting.

Browser acceptance for this redesign is **PARTIAL**: real local Admin/PCOM login, PCOM Excel mapping/validation, Directory filters/counts/pagination, missing/outdated indicators, retained professional comparison, simplified navigation, Lusha-only presentation and reload checks passed. Admin import execution, protected correction/professional review, Lusha identity and separate contact approvals were verified through authenticated disposable-D1 APIs; their final browser confirmation buttons and mobile layout remain unverified. Computer Use stopped because the active Windows Chrome URL could not be verified for policy enforcement, after Chrome access was approved. No further UI automation was attempted after that stop.

Regression, exact checkpoint and detailed limitations are recorded in the task's final acceptance report. The existing Windows local launcher remains the supported provider-free start; its original database and .env.local are unchanged.

## Preserved provider/release status (2026-10-23)

**Implemented** means code exists; **mock-tested** means provider-free fixtures exercised it; **locally live-verified** means an actual local browser/database or explicitly identified provider operation was observed. None of these means deployed or accepted on the current production Sites database.

- **Local application:** Directory/profile management, Admin/PCOM navigation and authorization, discovery evidence/review/history, Company Intelligence, engagement/outreach, opportunities, scoring/cohort previews, and governed CSV/XLSX import/export have local browser and/or isolated-D1 acceptance. Write-oriented acceptance used synthetic data; it did not prove production operation.
- **Provider operations:** real Coresignal Search/ES-DSL Preview and one isolated Bright Data Trigger → Snapshot retrieval have retained local evidence. One authorized Coresignal Collect attempt on 2026-10-23 returned an application HTTP 503 and is retained as ambiguous with no profile payload; it is **not** a successful live Collect acceptance and must not be retried automatically. Lusha V3 Search/Enrich, real webhook subscriptions/events, and Gmail sending are implemented or mock-tested but **not live-verified** in their intended environment. External billing reconciliation, callback, or send-scope requirements still block activation. PDL is excluded from active execution; historical evidence is preserved.
- **Identity and contact safety:** provider responses remain evidence until governed review. Lusha V3 Search stores even an exact-URL contact ID as pending Admin identity review. Email-only and phone-only Reveal responses are now retained as separate Admin-restricted contact proposals; neither changes the canonical alumnus automatically. An Admin must approve each value independently, with stale-identity, privacy, conflict, and explicit-replacement checks. See [Providers and safety](docs/providers.md).
- **Lusha browser acceptance:** a loopback-only, disposable-D1 V3 mock transport has exercised the actual Chrome UI for Search, Admin identity approval, separate Email/Phone Reveal and approval, a mismatched-identity rejection, failed transport, and PCOM denial. Authenticated negative checks rejected stale/duplicate approvals and confirmed PCOM history, Directory response, and CSV export redaction. Mock history records zero application units and no provider charge; the browser made no Lusha request. This is **browser-tested with fictional responses**, not a live Lusha entitlement or billing test. The mock gate requires development Admin auth, loopback, a temporary D1 path, and `LUSHA_LIVE_ENABLED=false`; it is disabled in production and by default.
- **Coresignal Preview trial boundary:** the seven one-off Lincoln/2011/PGP trial paths were retained in a recoverable local Git stash. Their hard-coded request scope and UNKNOWN-entitlement exception are **not** part of the default application. The sole retained source change forwards the already-validated temporary isolated-D1 path to the local worker for local-only workflows; it does not enable a provider. The general ES-DSL Preview workflow remains implemented, provider-gated and off by default; a real request still requires the normal confirmed-entitlement gate, Admin confirmation and budget checks. Collect remains separately disabled.
- **Coresignal Collect governance:** Coresignal Support confirmed on 2026-10-23 that the configured account key may use Base Employee Collect and that a core Employee Collect costs 10 provider credits; Search is free and shares the balance. This does not make a Search match independently verified. The local Collect workflow still requires an exact retained Employee ID, Admin confirmation, an isolated live gate and a durable one-attempt claim. Its conservative **20-unit application reservation is separate from the 10-credit provider ceiling**; neither number is a verified debit. The first isolated attempt is held for reconciliation after application HTTP 503, with no second request allowed by the durable claim. Historical telemetry cannot distinguish an upstream 5xx from a transport exception; subsequent attempts retain sanitized failure origin, upstream status and request reference where available, without logging raw provider errors. Collect is off again and must not be enabled for production merely from this local account confirmation.
- **Validation:** the latest host-permitted serial full suite passed **851 total, 835 passed, 0 failed, 16 skipped** after the Collect failure-telemetry change; TypeScript, ESLint and the direct production build passed. The 16 optional tests are not passes. Local source validation is not provider-live or production acceptance.
- **Production release: NO-GO.** The Sites D1 has 24 tables versus 44 in the local release schema; migrations 0010–0026 remain pending there. A documented complete, restorable production backup/restore path and authoritative production migration ledger are unavailable. Do not publish or migrate until the exact production database can be backed up, restored and rehearsed safely. See the [release checklist](docs/production-release-checklist-2026-10-22.md).

See [Architecture](docs/architecture.md), [Providers and safety](docs/providers.md), [Local development](docs/local-development.md), and [Alumni import readiness](docs/alumni-import-readiness.md) for the detailed current-state contract.

## Product areas

- Overview
- Alumni Directory and Add Alumnus
- External Discovery
- Company Intelligence
- Alumni upload and governed import review
- Lusha contact enrichment
- Professional evidence review within alumni profiles
- Administration

Growth-prone stored-data lists share pagination; Overview stays compact. External Discovery is intentionally separate from internal Directory filtering.

## Architecture at a glance

```text
Corporate Network (Cloudflare D1 / SQLite)
  ├─ canonical institutional alumni truth
  ├─ discovery, engagement, outreach, enrichment, and administration
  ├─ provider identity mappings and provenance
  └─ authenticated server-to-server Intelligence integration
       ↓
Alumni Profile Intelligence (separate service and Postgres database)
  └─ provider evidence → normalization/comparison → human review
       └─ ACCEPT updates Intelligence-side canonical state only
```

Corporate Network and Alumni Profile Intelligence are separate repositories, services, and databases. There is no approved automatic Intelligence-to-CN writeback. Any future CN writeback must be separately designed, explicitly authorized, field-safe, and human-controlled.

## Identity model

These identifiers are deliberately distinct:

- **CN alumnus ID:** canonical internal Corporate Network identity.
- **Coresignal Employee ID:** namespaced provider identity.
- **LinkedIn/professional-profile URL:** normalized external identity evidence.
- **Intelligence source ID:** stable cross-service identity such as `cn:<CN alumnus ID>`.

`attachCoresignalIdentity` enforces durable provider-ID uniqueness, exact normalized LinkedIn reconciliation, conflict and ambiguity handling, and conditional attachment. It never attaches by name alone, silently reassigns an ID, or overwrites canonical LinkedIn data merely because provider evidence differs.

## Review and canonical ownership

```text
provider evidence
  → normalize and compare
  → human review
  → ACCEPT or REJECT
```

- **REJECT:** preserves canonical state and records the decision.
- **ACCEPT in Intelligence:** changes accepted Intelligence-side canonical state and records audit history.
- **Corporate Network canonical record:** remains unchanged unless a separately authorized CN workflow changes it.

Provider provenance, field-change history, and security audit infrastructure are retained. An identity match does not imply profile freshness, and an unknown provider ID does not by itself prove a new alumnus.

## Database and migrations

Corporate Network uses Cloudflare D1/SQLite with Drizzle migrations through `drizzle/0026_green_ben_parker.sql`. The original local D1 is at 0026. The current hosted Sites database is older (24 tables, corresponding to the 0009 schema snapshot) and must not receive the 0026 source without a supported backup, ledger reconciliation, isolated restore/rehearsal and separately authorized migration.

Migration 0012 adds a partial unique index so one non-empty `coresignal_employee_id` can belong to at most one CN alumnus. The empty string remains the supported unassigned value. Migration 0012 has been validated against repository-local D1 only; this README does **not** claim staging or production migration completion.

Migration 0013 adds the provider-company mapping boundary. It stores conservative normalized company keys and provider identities with `VERIFIED`, `UNVERIFIED`, or `CONFLICT` status; `MISSING` is represented by no row. Only an Admin-verified mapping with provider ID, verifier, and verification time can enable company-constrained Search. The migration is schema-only and seeds no company data.

Generate a migration only when an approved schema change requires one:

```bash
npm run db:generate
```

### Isolated PostgreSQL schema baseline (Step 2)

The independent PostgreSQL schema is in `db/postgres/schema.ts`, with its own
`drizzle.postgres.config.ts` and `drizzle-postgres/` history. These files were
copied from the previously validated v44 schema because this project's final
SQLite 0026 schema and snapshot are byte-identical. The application still uses
Cloudflare D1 through `db/index.ts`; no API route or application connection has
been moved to PostgreSQL. The SQLite schema and `drizzle/` history are unchanged.

The isolated Neon target is project `muddy-glitter-45208530`, schema-only branch
`br-young-term-az2sojx8` (`cn-sabarinadh-staging`), database
`corporate_network`. Its direct endpoint is pinned in the PostgreSQL Drizzle
configuration and verifier. The branch has no application records. Schema-only
branch creation copied the table structures but no Drizzle ledger row; the
verified migration-0000 baseline reconciliation and full catalog checks are
documented in [Step 2 schema validation](docs/postgres-step2-schema-validation.md).
Never run migration 0000 against these existing tables. The separate v44 staging
branch and its fictional data remain untouched.

For schema tooling, store `DATABASE_URL_UNPOOLED` only in ignored
`.env.postgres.local` or a secret manager. Obtain the direct connection string
for the **new** branch from Neon; confirm its host is
`ep-super-meadow-az4e41mn.c-3.ap-southeast-1.aws.neon.tech` and its database
is `corporate_network`. Do not put the password in tracked files or terminal
output. The application does not consume this variable in Step 2. With the URL
available, read-only verification is:

```bash
node --env-file=.env.postgres.local scripts/verify-postgres-schema.mjs --expect-empty
python3 scripts/check-postgres-schema.py
```

`drizzle.postgres.config.ts` exists for future reviewed migrations, but no
PostgreSQL migration command should run against the existing Step 2 baseline.

### PostgreSQL application foundation (Step 3A)

The existing `db/index.ts` remains the D1 adapter for all public routes.
`CN_DB_BACKEND` selects `d1` or `postgres` explicitly. An unset value keeps
the legacy D1 deployment behavior only when no runtime `DATABASE_URL` is
present. Invalid values, a PostgreSQL URL without explicit selection, a
PostgreSQL URL alongside explicit D1 selection, and a
PostgreSQL selection at an unconverted D1 route fail closed; there is no
automatic cross-database fallback. The server-only PostgreSQL adapter is
`db/postgres/adapter.ts`, using Drizzle's PostgreSQL schema and a `pg` pool.
Its runtime URL must identify this new branch's pooled endpoint, database
`corporate_network`, and `sslmode=require`. The separate direct
`DATABASE_URL_UNPOOLED` remains for migration and read-only schema tooling.
Store real URLs only in ignored local files or a secret manager; neither URL
is sent to client code. The new branch's pooler was not enabled in Step 3A,
so runtime PostgreSQL mode is intentionally unavailable until that staging
configuration and the remaining route/authorization migration are reviewed.

The first isolated storage proof is Admin programme-option read/add in
`db/postgres/programme-options.ts`. It preserves code normalization, duplicate
responses, the Admin role-policy check, returned option fields, and audit content.
The proof accepts a trusted caller-supplied actor and is not connected to the
public authentication path. The
PostgreSQL add and audit writes use one Drizzle transaction; an audit failure
rolls back the option insert. Tests use fictional records in a temporary local
PostgreSQL 17 cluster that is stopped and removed after the test. The public
Admin API still uses its existing D1 path; this proof does not change its
response contract or authorize PostgreSQL application traffic. See the
[database-access inventory](docs/postgres-app-access-inventory.md) for the
remaining query and transaction conversions.

Step 3A checks include TypeScript, ESLint, the application build, the
PostgreSQL adapter/transaction test, and focused serial D1 regressions. Run the
isolated PostgreSQL test with `node --test --test-concurrency=1
tests/postgres-app-foundation.test.mjs`; it requires local PostgreSQL 17
`initdb`/`pg_ctl`/`psql` binaries and permission to create local shared memory.
It uses a temporary Unix-socket-only cluster, never the Neon staging database.
The PostgreSQL proof passed 7 tests, including concurrent duplicate rejection
and audit rollback; 129 focused existing D1/build-dependent tests and 2
programme contract tests passed. The serial full suite reported 873 tests,
851 passed, 16 skipped, and 6 failed: five pre-existing UI-source assertions
in `coresignal-regular-search-transport`, `login-ui-stabilization`, and
`provider-company-mapping`, plus one sandbox denial of PostgreSQL shared
memory. The UI source and assertions were unchanged from the supplied baseline.
That same PostgreSQL test passed separately with local shared-memory permission. The
previous missing-`dist` failures were resolved by building before those
build-dependent tests. Existing UI-text assertions reflect the supplied
application's October 28 redesign and are not changed here. Earlier
`ENOSPC` occurred during broad concurrent temporary-database tests; the
serial run did not hit `ENOSPC`. At the Step 3A checkpoint, all 35 API routes and the authentication
path remained on D1; no public PostgreSQL route was enabled. No real records were transferred,
provider calls or deployment were made, and production cutover remains NO-GO.

### Core PostgreSQL read group (Step 3B)

Explicit `CN_DB_BACKEND=postgres` now uses PostgreSQL for database-backed
identity and session lookup, authorization, and audit records. The existing
ChatGPT and Google Workspace provider verification and session-token format
are unchanged. The same PostgreSQL pool supplies identity, authorization and
application records for each selected request; a connection failure never
falls back to D1. `CN_DB_BACKEND=d1` or an unset backend without
`DATABASE_URL` retains the existing D1 behavior. Runtime PostgreSQL URLs
remain server-only and restricted to this new branch's pooled endpoint.

The first read group covers GET `/api/directory`, GET
`/api/alumni-collection`, GET `/api/alumni/[id]`, and GET `/api/workspace`.
Directory search, company and missing-company filters, graduation year,
designation, relevance, sorting, counts, facets, and pagination use the
PostgreSQL schema and equivalent SQL. Profile and collection responses retain
role-based contact masking and their existing JSON shape. The shared profile
response mapper is used by both backends. Login and identity audit writes
are the minimum required for the existing authentication lifecycle. The
`/api/workspace` and `/api/alumni/[id]` write methods, exports, and the other
31 API route files remain D1-only and fail closed under PostgreSQL selection.
See the [route-level compatibility matrix](docs/postgres-app-access-inventory.md).

For isolated verification, run `node --test --test-concurrency=1
tests/postgres-app-foundation.test.mjs tests/postgres-core-reads.test.mjs` with
local PostgreSQL 17 binaries and local shared-memory permission. The tests
start Unix-socket-only temporary clusters, apply the committed PostgreSQL
schema and use fictional identities and alumni; they do not contact Neon or
the original D1. The Step 3A and Step 3B PostgreSQL suites pass 16/16 tests,
including Admin/PCOM/Developer identity isolation, denied and disabled
accounts, Google identity linkage, bootstrap Admin policy, empty and populated reads, combined
filters, pagination, role masking, profile retrieval and connection failure.
Five Directory queries also compare D1 and PostgreSQL counts, returned names,
relevance scores and facets on the same fictional fixtures.
This is service-level acceptance; PostgreSQL browser acceptance remains
pending because the runtime adapter intentionally rejects arbitrary local
URLs and no Neon connection was made in this task. Browser control was disabled in
Work settings during this task, so no browser acceptance result is claimed.
A separate loopback D1 server on port 3001, using a newly created disposable
fictional D1 fixture, returned Admin sign-in 200, Directory 200 (two exact
records), workspace 200, alumni collection 200 with its required pagination
parameters, profile 200, and unauthenticated Directory 401. The server and
fixture were stopped and removed after the HTTP smoke checks. Focused D1
Directory/profile/security/auth tests passed 99/99. TypeScript, ESLint and
the production build passed. The full serial suite reported 888 tests: 867
passed, 16 skipped, and five failed in the same unchanged UI source assertions
recorded at Step 3A. The prior PostgreSQL shared-memory failure did not recur
when the suite ran with local permission. No real alumni data transfer,
provider request, deployment or production cutover was performed. Production
remains **NO-GO**.

### PostgreSQL HTTP and controlled Admin write acceptance (Step 3C)

The four Step 3B GET routes (`/api/directory`, `/api/alumni-collection`,
`/api/alumni/[id]`, `/api/workspace`) now have actual HTTP acceptance against
the running local application and a disposable PostgreSQL 17 database.
Fictional Admin and PCOM sessions can read them; an existing signed Developer
session confirms contact masking, and missing sessions return 401. Directory
filters, pagination, empty results, and missing profiles were exercised. A
stopped database returns a generic 5xx without a D1 fallback or SQL text.

Only `POST /api/admin` with `action: "add_programme"` uses PostgreSQL when
explicitly selected. It retains `MANAGE_USERS` authorization, code and name
rules, the `{ programme }` 201 response, and the existing 400/403/409 behavior.
The programme row and `programme_added` audit event use one PostgreSQL
transaction. Two simultaneous duplicate requests leave one row and one audit;
a forced audit failure rolls back the new programme. GET `/api/workspace`
provides PostgreSQL readback. A separate disposable D1 HTTP fixture confirmed
the same Admin request, errors, and response fields. At the Step 3C checkpoint,
Admin GET, other Admin actions, and the write handlers of `/api/workspace` and
`/api/alumni/[id]` remained D1-only; the other 30 API route files were D1-only.
The existing Admin UI depends on its still D1-only GET payload, so the full
Admin page is not accepted in PostgreSQL mode.

Run `node --test --test-concurrency=1 tests/postgres-http-acceptance.test.mjs`
with local PostgreSQL 17 binaries and loopback/shared-memory permission. The
suite creates, migrates, starts and removes its own fictional PostgreSQL and
D1 fixtures. For this suite only, `CN_PG_LOCAL_TEST_ENABLED=true` and a
validated `/private/tmp/cn-step3c-postgres-*/socket` marker select a fixed
loopback PostgreSQL role and database when local development authentication
is enabled and `DATABASE_URL` is absent. The application uses port 3103 and
an isolated Worker state directory; ordinary D1 local development remains
the default. This test mode is disabled outside development. Both local and
pooled PostgreSQL connections retire after one checkout because the Cloudflare
Worker cannot reuse a connection across request contexts. No Neon connection,
real records, provider request, email, deployment, or push is part of this
acceptance.

The Step 3C HTTP suite passed 8/8 tests, including transaction/concurrency
and D1 contract checks. The Step 3A/3B PostgreSQL suites passed 16/16;
TypeScript, ESLint, and a direct `vinext build` passed. The repository's
`npm run build` wrapper could not launch here because `sites-env.sh` lacks
execute permission and GNU `timeout` is unavailable. The full serial suite
reported 896 tests: 875 passed, 16 skipped, and the same five pre-existing
UI/source assertions failed (two Coresignal search controls, two responsive
layout checks, and one provider-company-ID assertion). No new PostgreSQL
regression remained. Browser acceptance is **BLOCKED**: Work reports
“Local browser use is disabled in Work settings,” and no established local
Playwright suite covers these flows. The [database-access inventory](docs/postgres-app-access-inventory.md)
tracks the selected paths and remaining work. Full application integration is
**INCOMPLETE**; real-data transfer is not authorized; production cutover is
**NO-GO**.

### Profile and workspace PostgreSQL mutations (Step 3D)

Explicit PostgreSQL selection now supports PATCH `/api/alumni/[id]` for
field-level profile edits and POST `/api/alumni/[id]` for existing Admin
proposal acceptance or rejection. The same field planner, editable-field
limits, protected-field proposals, role policy, response mapper, and
idempotency fingerprint are retained. Profile transactions lock the alumnus
row, check its record version, and commit the canonical change, proposal or
field history, mutation request, and security audit together. A replay returns
the stored response; a reused key with different content returns 409. Proposal
acceptance checks its original field value and version, and preserves the
existing Coresignal collection-event status transition when applicable.

POST `/api/workspace` supports existing `manual_check` and `manual_add` actions.
The final duplicate scan and manual creation are transaction-scoped, with
activity and security audit rows committed together. PATCH `/api/workspace`
supports `update_alumnus`, `update_priority`, `update_data_quality`, and
`update_privacy`. Each selected action preserves its existing permission,
validation, response and audit fields, and uses a PostgreSQL transaction for
its related writes. Workspace actions have no existing request-key or version
precondition; Step 3D does not introduce one. The legacy bulk `import` POST
action remains D1-only and fails closed under PostgreSQL after its established
request and Admin permission checks. `/api/imports`, Admin GET and other Admin
actions, the other 30 API route files, provider accounting and unrelated
mutations remain D1-only under PostgreSQL selection.

The expanded local HTTP suite (`node --test --test-concurrency=1
tests/postgres-http-acceptance.test.mjs`) uses disposable fictional PostgreSQL
and D1 databases. It passes 13/13, including Admin/PCOM/unauthenticated access,
profile edits and protected-field decisions, stale versions, concurrent edits,
repeat requests, manual duplicates, workspace updates, audit/history failure
rollback, stopped-database responses, and D1 response-contract comparisons.
No Neon records, original D1 records, provider credits, provider APIs, email or
webhooks were touched. Focused Chrome acceptance passed PCOM login, Directory
search and profile retrieval, a fictional profile-note edit, and an outreach
status update; database readback confirmed both writes and the profile version.
Admin login and role display worked. Browser acceptance is **PARTIAL** because
the full UI also requests D1-only discovery, history, professional-verification,
Admin GET and provider routes. They fail closed in PostgreSQL mode. During
simultaneous page loading, the local pool timed out on a workspace request and
an unconverted Admin route showed an internal query error. The isolated local
pool timeout now matches the pooled runtime's five seconds; full UI acceptance
still requires those routes to be migrated and retested. The [route inventory](docs/postgres-app-access-inventory.md) records
method and action coverage. Full application integration is incomplete,
real-data transfer is not authorized, and production cutover remains **NO-GO**.

The Step 3A/3B PostgreSQL suites pass 16/16, focused D1 profile/workspace,
security and contract tests pass 68/68, and TypeScript, ESLint and a direct
`vinext build` pass. The full serial suite reports 901 tests: 880 passed,
16 skipped, and the same five previously documented UI/source assertions
failed. No new PostgreSQL regression remains. The repository's `npm run build`
wrapper still requires an executable `sites-env.sh` and GNU `timeout` in this
local environment; the direct build above completed successfully.

## Implementation status

### Step 3F: Admin stability and Provider Credits checkpoint

PostgreSQL Admin summary and lifecycle reads now use one short transaction
each to reduce connection checkouts. This did not resolve the local Worker
runtime's burst failure: five simultaneous Admin requests passed, while ten
produced connection-acquisition failures at about five seconds before the
change and still failed after it. Direct node-postgres read transactions
passed 5, 10 and 20 concurrent requests in 103, 71 and 113 ms respectively;
total, idle and waiting pool clients returned to zero after each one-use burst.
Database activity inspection found no persistent sessions or long query.
Twenty concurrent HTTP requests were withheld after ten destabilized the
fixture. The remaining Worker/pool interaction is unresolved, so pool
stability is **BLOCKED**. Pool size and timeouts were not increased.

`GET /api/admin/provider-credits` now reads the selected PostgreSQL database
without provider calls or accounting writes. A disposable, equivalent D1 and
PostgreSQL fixture produced identical complete HTTP JSON for retained balance
observations, monthly internal controls, held/completed/released/ambiguous
outcomes, multiple providers, same-time records and UTC month boundaries.
Invalid stored timestamps do not count toward monthly usage. PostgreSQL POST
attestation and refresh fail closed. `POST /api/admin` now supports the local
`rename_programme` and `set_programme_status` actions in transactions that
commit the programme update and existing audit event together. D1 remains
the default, and other Admin actions remain D1-only.

The focused disposable PostgreSQL/D1 HTTP suite passed 17/17, including
authorization, read parity, programme validation/concurrency/audit rollback,
and database-error redaction. Raw SQL from a separate unconverted route was
seen only in local development server diagnostics, not the tested HTTP
responses; that logging boundary requires later review. Full Admin acceptance
and full application integration remain incomplete. Real-data transfer is
unauthorized and production cutover remains **NO-GO**. The updated
[route matrix](docs/postgres-app-access-inventory.md) records each method.
Chrome acceptance was attempted, but the Mac was locked and Work settings
disabled local browser use; browser acceptance is **BLOCKED** for this step.
The consolidated Admin and Imports batch is not ready while the local Worker
burst behavior remains unresolved. The original D1 and preserved Neon branch
were not used for these tests.
Step 3F TypeScript, ESLint and the direct production build passed. The focused
PostgreSQL foundation, core reads, provider ledger, Admin and security group
passed 63/63. The full serial suite reported 906 tests: 885 passed, 16 skipped
and the same five previously recorded UI/source assertion failures. No new
regression failure was observed. The ten-request burst is a separate known
acceptance failure and is recorded as such in the route inventory.

### Stage 3 Worker PostgreSQL connection stability

The local Worker failure was caused by a PostgreSQL pool retained at module
scope across request contexts. One-use clients did not make the shared pool
request safe: on a fresh disposable fixture, five concurrent Admin GETs
returned five 200s in 292 ms, but ten returned one 200, five 500s and four
transport timeouts by 12 seconds. The next Admin GET returned 500 after
5.0 seconds, and four PostgreSQL sessions remained idle. Standalone Node.js
pool transactions had previously passed 5/10/20, isolating this to Worker
request lifecycle rather than query duration. Cloudflare's Worker TCP guidance
requires sockets to stay inside their creating request context.

`worker/index.ts` now establishes a PostgreSQL request scope only when the
PostgreSQL backend is explicitly selected. `db/postgres/adapter.ts` lazily
opens one pool per request, shares it across that request's authentication and
route queries, and closes it after the handler resolves, including on errors.
The five-client maximum, one-use retirement and five-second acquisition
timeout are unchanged. D1 remains the default; backend selection, permissions,
responses, transactions and business rules are unchanged. The request scope
fails closed if a PostgreSQL route attempts to access the adapter outside a
Worker request. No provider, Neon or preserved D1 database was contacted.

With the same fictional local PostgreSQL/Worker fixture, Admin GET bursts of
5/10/20 returned 5/10/20 HTTP 200s in 261/210/369 ms (request p95
256/206/364 ms). Three more ten-request bursts all returned 10/10 HTTP 200s
in 167/144/278 ms; immediate follow-up requests all returned 200 in
43/89/45 ms. Ten Directory requests and a mixed ten-request Admin/Directory
burst returned 200 throughout. The sequential ten-request Admin run returned
10/10 HTTP 200s in 328 ms. A cold Admin request returned 200 in 260 ms.
Post-burst `pg_stat_activity` showed only the measuring client's active
session, with no idle Worker sessions. The local acceptance command is
`CN_PG_STRESS_DIAGNOSTIC=true node --test --test-concurrency=1
tests/postgres-http-acceptance.test.mjs`; it uses only a disposable fixture.
Authentication and permission checks in that run returned 401 and 403.
An independent final run again passed 5/10/20 Admin requests (197/188/303 ms
total), three ten-request repeats, and recovery after every burst. The same
local Worker with D1 selected passed comparable 5/10/20 Admin bursts at
5/5, 10/10 and 20/20 HTTP 200 (72/114/195 ms total), followed by a normal
200. The unchanged PostgreSQL/D1 HTTP regression suite passed 17/17,
including stopped-database fail-closed behavior, Provider Credits read parity,
programme mutation and rollback, and authorization. The serial full suite
reported 906 tests: 885 passed, 16 skipped and only the same five previously
recorded UI/source assertion failures. Focused PostgreSQL foundation, core
read, provider-credit ledger and security tests passed 45/45. Their direct
Node.js pool run passed 5/10/20 transactions with total/idle/waiting counts
at zero after each burst. TypeScript, ESLint and a direct
production `vinext build` passed. `npm run build` itself could not launch its
existing non-executable `scripts/sites-env.sh` wrapper; the direct build
completed without changing unrelated script permissions.

The local test establishes Worker HTTP stability for these routes. It does
not measure individual Worker connection-acquisition times or prove the Neon
pooler's capacity at production concurrency; a production-like, isolated
connection and streaming-response validation remains mandatory. The Worker
pool's peak total/idle/waiting counters were not exposed by the test harness;
post-burst server-side activity was measured instead. The new
request-owned pools may create more simultaneous sockets than the old shared
five-client pool. The Admin plus Imports migration batch is ready for isolated
development work; its own acceptance and production-like load checks remain
required. Real data transfer and production cutover remain **NO-GO**.

### Consolidated Admin and PCOM imports Batch 1 — baseline inventory

Batch 1 starts from commit `80cbf84` on `feature/postgres-app-integration` with
a clean working tree. The existing import, idempotency and security baseline
passed 77/77 local tests. The source-derived [Batch 1 migration matrix](docs/postgres-app-access-inventory.md#consolidated-batch-1-source-derived-migration-matrix)
separates the governed `/api/imports` workflow from the older workspace bulk
import. CSV/XLSX parsing, column mapping and review-report generation run in
the client/shared parser; the preview API reads alumni and programme options.
The confirmed import API uses a durable request lease, at most 80 queued D1
operations per atomic batch, per-row checkpoints, source observations and a
final history/audit batch. PostgreSQL conversion must preserve those chunk and
resume boundaries. External provider validation, provider-credit writes,
cleanup and anonymization are outside this batch. Production remains **NO-GO**.

The local Admin mutation milestone now routes `authorize_user`, `change_role`,
`set_user_status`, `update_lifecycle` and `upsert_provider_company_mapping`
through PostgreSQL transactions with the existing Admin permissions,
confirmation text, validation, response shape and audit metadata. User changes
serialize the last-Admin check; lifecycle changes protect the alumnus row;
provider-company aliases commit with their mapping and audit. Fictional
PostgreSQL/D1 HTTP contract checks passed 19/19, including a forced Admin
audit failure that rolled back the user change and returned redacted JSON.
`correct_pre_authorization`,
cleanup/anonymization and external provider validation remain D1-only and
fail closed when PostgreSQL is selected. No production or preserved database
was changed.
TypeScript, ESLint and direct `vinext build` passed for M2. `npm run build`
still fails before compilation because its tracked `scripts/sites-env.sh` has
mode `100644` but is invoked as an executable; the wrapper also requires GNU
`timeout`, which is unavailable on this host. The existing build script and
deployment behavior were not changed in this milestone.

PCOM import preview now reads the explicitly selected PostgreSQL database
and uses the same `validateImport` and preview-digest logic as D1. The client
continues to parse CSV/XLSX, map columns and generate downloadable review CSV;
the API receives record objects. Fictional PostgreSQL/D1 HTTP checks passed
20/20 overall, including matching preview JSON for new, invalid and duplicate
rows, existing-alumnus classification, Admin/PCOM/unauthenticated gates, and
missing-company claims. PostgreSQL alumni, import-run and source-observation
counts did not change during preview. Confirmed execution is described in
the M4 checkpoint below and cannot fall back to D1.
Malformed record objects retain the D1 400 validation response. A forced
PostgreSQL connection failure returned a redacted 5xx without D1 fallback.
The focused parser, mapping, idempotency and source-history suite passed 57/57;
TypeScript, ESLint and direct production build passed.

M4 connects Admin-only confirmed `/api/imports` execution to PostgreSQL.
The shared validator and preview digest, request lease, row checkpoints,
bounded 80-action chunks, unverified claims, protected-field proposals,
history and final audit remain in place. Each chunk and finalization uses a
PostgreSQL transaction. Completed chunks remain resumable after a failed final
audit under the same request key. Disposable local HTTP tests compare the
confirmed response and replay with D1 and exercise stale confirmation,
20-row chunking, competing execution, history and audit rollback, recovery,
PCOM denial, concurrent previews and stopped-database redaction. The local
PostgreSQL/D1 HTTP suite passed 27/27. Workspace legacy bulk import was
completed in M5 below. No Neon or production data was written.

M5 integrates the separate legacy workspace `POST /api/workspace` `import`
contract with PostgreSQL. It uses the original workspace normalizer, 250-row
limit, duplicate and matching rules, approved-update keys, protected-field
checks and response fields. A transaction groups alumni, field history,
import run, activity and security audit writes; the shared manual-entry lock
serializes competing workspace creates. This operation is distinct from the
governed PCOM preview/confirmed-import flow and does not change its rules.
Disposable local PostgreSQL/D1 HTTP checks passed for create, skipped update,
approved update, role denial, invalid and duplicate records, state/history
readback and forced audit rollback. No provider operation was invoked.

Batch 1 validation: the serial full suite reported **916 tests: 895 passed,
5 failed, 16 skipped**. The five failures are the same pre-existing UI/source
assertions for canonical operation boundaries, Search cancel, the Discovery
panel, responsive layouts and product request provider IDs. A parallel run
also showed Vite port contention and two extra failures; the serial run had
no newly introduced failure. TypeScript, ESLint and the direct `vinext` build
passed. `npm run build` still stops on non-executable `scripts/sites-env.sh`;
the host also lacks the wrapper's GNU `timeout`. The build scripts were not
changed because the bounded wrapper needs a separately verified portable
timeout implementation. The focused import paths have HTTP acceptance;
there is no import-focused browser harness in this repository and Playwright
is unavailable here.

The request-scoped PostgreSQL Worker passed 5/5, 10/10 and 20/20 concurrent
Admin reads (176, 160 and 306 ms total respectively), three repeated
ten-request bursts, normal follow-up reads, and mixed Admin/PCOM preview
requests. After each stress burst, `pg_stat_activity` showed no idle Worker
session. The D1 5/10/20 bursts also passed. Each Worker request can open up
to five PostgreSQL clients, so 20 simultaneous requests may demand up to 100
connections in the worst case. Neon pooler capacity, transaction duration,
streamed-response behavior and production-scale acquisition time remain
unverified; full application migration and production cutover are **NO-GO**.

### Stage 3 continuation — remaining database paths

The internal Bright Data eligibility revalidation endpoint now reads the
explicitly selected PostgreSQL alumni and lifecycle tables under its existing
service bearer credential. Its D1 query, input limit, eligibility rules and
response contract remain unchanged. Disposable PostgreSQL/D1 HTTP acceptance
passed 28/28, including service-authentication denial, live fixture state,
missing-record parity, and a redacted stopped-database response.

The legacy workspace bulk import has a known failure-path difference: D1
writes records sequentially, so a later history or audit failure can leave
earlier alumni, import-run or activity writes while returning an error.
PostgreSQL currently wraps the operation in one transaction and rolls those
writes back. Exact failure-state equivalence would require deliberately
retaining partial writes, which conflicts with the requested integrity
guarantee. This error path remains an acceptance blocker; the successful
request contract passed the prior D1/PostgreSQL comparison. No D1 behavior
was changed.

Professional verification GET and confirmed POST now have selected-PostgreSQL
paths using the existing role gate and field validator. The POST locks the
alumnus and commits the verification state, field-change history and security
audit together. The original D1 handlers remain unchanged. Disposable
PostgreSQL/D1 HTTP acceptance passed 29/29, including PCOM authorization,
validation, evidence readback, D1 response-field parity and forced audit
rollback with a redacted database error.

Directory and Admin business-data exports now have selected-PostgreSQL read
paths. Directory export pages through the existing PostgreSQL Directory
query; Admin export reads the same nine approved datasets from PostgreSQL.
CSV/XLSX/ZIP formatters, permissions, limits, metadata and export audit remain
shared. The D1 branch is retained. Disposable HTTP parity and failure checks
passed 30/30, covering Directory and Admin CSV downloads, import-compatible
XLSX and multi-dataset ZIP archives, authorization, invalid scope and dataset
gates, audit writes, forced audit failure and a
redacted stopped-database response. The original D1 query paths remain.

Provisional discovery intake now has a selected-PostgreSQL path for the
existing PCOM preflight and confirmed execute actions. It uses the shared
candidate assessment and unverified provisional profile builder, with one
transaction per eligible candidate for alumni, discovery linkage, immutable
intake observations and audit. PostgreSQL serializes alumni writers during
the identity check to preserve the D1 batch's collision protection. The D1
route remains intact. Disposable PostgreSQL/D1 HTTP acceptance passed 33/33,
including preflight parity, duplicate and concurrent execution, cross-source
identity collisions, forced audit rollback and stopped-database redaction.

The intelligence profile route now selects the local PostgreSQL alumni and
lifecycle records for its existing profile read and enrollment eligibility
checks. The separate intelligence service remains responsible for resolution,
enrollment and summaries; its request contract is unchanged. Disposable HTTP
acceptance passed 34/34 with a local mock service, including authenticated
read and enrollment, invalid and missing IDs, D1 missing-record parity and
stopped-database redaction. No real intelligence or provider request was made.

Fixed intelligence cohorts and dynamic CN selections now read from the
selected PostgreSQL alumni and Directory query when PostgreSQL is selected.
The D1 implementations and separate intelligence service calls remain in
place. Disposable PostgreSQL/D1 HTTP acceptance passed 35/35, including
dynamic manual inclusion, fixed-cohort exclusions, authorization and a
stopped-database response; the existing selection unit tests passed 6/6.
The source inventory now distinguishes 14 routes with remaining local D1
operations from intelligence proxy routes that have no local database access.
All 35 API route files and 57 exported HTTP methods remain in scope for
route-level acceptance; the Admin action branches are tracked separately.
Stored Discovery summary and pending-view GET requests now select PostgreSQL
search, result, candidate evidence and provider-history records. The existing
presentation and PCOM authorization remain shared. Disposable PostgreSQL/D1
HTTP acceptance passed 36/36 and focused saved-history/Discovery regressions
passed 27/27, including saved results, invalid IDs and database-failure
redaction. Discovery POST actions still require PostgreSQL integration except
for `record_evidence`. That human review action now locks the pending result
while checking provenance, reviewer decisions, exact replay and conflicting
revisions, then commits immutable evidence and its security audit together.
Duplicate submissions return saved evidence; a failed audit rolls back
evidence. The disposable PostgreSQL/D1 HTTP suite passed 43/43, including
validation-response parity, concurrent replay and audit rollback. TypeScript,
focused ESLint, the evidence unit tests (8/8) and direct production build
passed. The earlier intermittent import-confirmation failure remains an
unresolved acceptance blocker for that workflow.

Discovery `plan` now reads saved search history from selected PostgreSQL and
returns the existing advisory coverage plan without contacting a provider or
charging application units. The D1 behavior and all provider-consuming
Discovery actions remain as before. Disposable PostgreSQL/D1 HTTP acceptance
passed 44/44, including exact plan-response parity; TypeScript, focused ESLint
and the direct production build passed. Discovery planner/run tests passed
45/45.

Discovery `regular_search_preflight` now reads provider-company mappings from
selected PostgreSQL and prepares the same bounded Search contract locally.
It makes no provider request, stores no result and charges no application
units. The confirmed `regular_search` execution path remains D1-only.
Disposable PostgreSQL/D1 HTTP acceptance passed 45/45 for the preflight,
including authorization, invalid year, unmapped company and exact response
parity. One D1 run took about 492 seconds without a failing assertion; the
HTTP harness now logs requests slower than 10 seconds to help locate any
recurrence. The cause is unresolved and the earlier import-confirmation
failure remains an acceptance blocker.
The timed rerun passed 45/45 in about 53 seconds with no slow HTTP marker.
The retained Outreach recommendation POST now reads selected PostgreSQL
alumni, relationship and engagement evidence. It keeps the warm, direct and
no-route decision rules and response fields. PostgreSQL commits activity and
security audit together, so an audit failure rolls back the activity entry.
Disposable PostgreSQL/D1 HTTP acceptance passed 46/46 with exact response
parity for all three route outcomes, authorization gates and forced audit
rollback. The retained D1 path still writes activity and audit sequentially.
Outreach-focused route tests passed 26/26; TypeScript, focused ESLint and the
direct production build passed.

Opportunity POST/PATCH now select PostgreSQL before the D1 path and share the
GET serializer for linked-alumnus, owner and history projections. Validation,
idempotency, version checks and transitions retain their existing contracts.
Opportunity, operational history and security audit commit together. A
missing `await` in the first dispatch was corrected after the initial HTTP
failure exposed it. Disposable PostgreSQL/D1 HTTP acceptance passed 49/49,
including response parity, concurrent duplicate creation, stale versions,
401/403 authorization, forced create/update audit rollback and stopped-database redaction. Existing
opportunity regressions passed 15/15; TypeScript and focused ESLint passed.
The D1 opportunity path writes security audit after its opportunity/history
batch. Its audit-failure state may therefore differ from PostgreSQL's atomic
rollback; failure-path equivalence is not claimed.

The Coresignal Collect Admin overview GET now reads retained candidate and
application-capacity records from selected PostgreSQL. It uses the same
candidate eligibility and runtime gates; no Collect execution or provider
request is added. Collect POST and its credit claims remain D1-only.
The disposable credit fixture includes an intentionally invalid retained
timestamp, which the legacy text-date capacity query counts; the parity
assertion therefore expects zero remaining application units. Current source
reconciliation classifies 43 of 57 exported API methods as PostgreSQL
compatible, five as partially integrated, and nine as D1-only.
The retained Preview fixture additionally verifies one eligible Employee ID,
excludes conflicting evidence, and carries an ambiguous prior Collect claim
into the response without executing Collect.
The intermittent overlength import-key regression now asserts the exact 400
response body so a recurrence exposes the returned error class; its original
slow-run cause remains under investigation.
The legacy workspace bulk-import fixture now tests two distinct rows with a
colliding email: D1 returns 400 and retains the first alumnus, while
PostgreSQL returns a redacted 500 and rolls back both. This is a confirmed
state and error-contract difference; functional-equivalence approval is
blocked for this failure path.
Disposable PostgreSQL/D1 HTTP acceptance passed 48/48, including Collect
candidate parity, stopped-database failure redaction, the exact overlength
import-key 400 response, and the workspace collision probe. The D1 fixture
subtest completed in 33 seconds. TypeScript, focused ESLint, 30/30 Collect
unit tests, and the direct production build passed.
The latest full serial regression completed with 917 passes, the same five
known UI/source assertions, 16 skips and no repeat of the native `SIGTRAP`.
Enrichment's Admin provider-limit PATCH now selects PostgreSQL and commits
the new limit with its security audit in one transaction. It returns the
existing provider usage projection. Disposable PostgreSQL/D1 HTTP acceptance
passed 50/50, including Admin-only access, validation, repeated PATCH
response parity, the resulting credit limit, forced audit rollback and
stopped-database redaction. The D1 path writes audit after the setting, so
exact audit-failure state parity is not claimed.
Enrichment POST now routes the existing Admin `refresh_history` and
`reconcile_usage` actions to selected PostgreSQL. Reconciliation locks the
retained Lusha history row and commits its usage transition with the security
audit. Provider actions remain on the D1 path under D1 selection; PostgreSQL
HTTP parity for these two local actions passed in the 51/51 disposable suite.
That suite checked the retained Lusha row transition,
repeated and concurrent reconciliation, forced audit rollback, Admin/PCOM
access and D1 response parity without a provider request.
Focused provider-credit and Collect regressions passed 38/38; TypeScript,
focused ESLint and the direct production build passed for this checkpoint.
Admin `correct_pre_authorization` remains blocked under PostgreSQL selection.
Disposable fictional-user HTTP tests found that simultaneous D1 correction
requests both return 200, while a guarded PostgreSQL transaction returns 200
then 404. The selected PostgreSQL route returns 501 without writing; D1 keeps
its existing confirmation, identity, audit and deletion behavior. The pending
PostgreSQL helper is not wired until a concurrency-parity design is reviewed.
The disposable PostgreSQL/D1 HTTP suite passed 52/52 with that fail-closed
gate; focused identity and provider-credit regressions passed 14/14.
TypeScript, focused ESLint and the direct production build passed. The known
provider-company-mapping UI source assertion still failed in the broader
focused run (21/22 passed) and was left unchanged.
The Coresignal Collect review route now selects PostgreSQL for unconfirmed,
read-only retained-evidence preflight. Confirmed identity association remains
D1-only and fails closed under PostgreSQL selection. Disposable PostgreSQL/D1
HTTP acceptance passed 53/53 with fictional Admin/PCOM gates, missing and
invalid records, response parity and no identity write. Existing Collect
regressions passed 30/30; TypeScript, focused ESLint and direct production
build passed. No provider request is made by preflight. Current method coverage
is 43 of 57 compatible, six partial and eight D1-only.
Admin provider-credit `attest` now selects PostgreSQL for a human supplied
balance observation. It keeps the existing confirmation and observation
validation, writes the same security-audit evidence, and returns the existing
snapshot shape. Provider `refresh` remains unavailable under PostgreSQL and
no external balance API is called. Disposable HTTP parity now covers Admin and
PCOM gates, invalid observations, the audit insert and snapshot response;
the disposable PostgreSQL/D1 HTTP suite passed 53/53. Current method coverage
is 43 of 57 compatible, seven partial and seven D1-only. Focused provider-credit
ledger tests passed 8/8; TypeScript, focused ESLint and direct production build
passed.
After these checkpoints, the first full serial regression reported 921 passes,
six failures and 16 skips. A diagnostic rerun reported 921 passes, the five
previously known UI/source assertion failures and 16 skips. Its PostgreSQL
HTTP subtest took about 235 seconds, reproducing the intermittent long-running
acceptance limitation; the cause of the first run's extra failure remains
unproven. Neither run had a SIGTRAP. No timeout or assertion was weakened.
The Coresignal Collect `selection_preflight` action now reads selected
PostgreSQL retained candidates and application capacity. It issues no token,
reservation or provider request. Its disposable HTTP parity check passed;
single-target preflight and execution remain D1-only under PostgreSQL.
Fictional HTTP coverage now compares authorization, invalid and missing
selections, a saved ambiguous Collect claim, exact plan response and zero
new reservations against D1.
The two Collect read-only routes await PostgreSQL work inside their error
boundaries so a query failure is redacted instead of escaping the route. The
disposable HTTP suite forces each query failure and asserts the generic error.
Disposable PostgreSQL/D1 HTTP acceptance passed 54/54 for this checkpoint.
Focused Collect regressions passed 30/30; TypeScript, focused ESLint and the
direct production build passed.
The current method classification is 43 compatible, eight partial and six
D1-only out of 57 methods. The D1 pre-authorization correction reads before
its audit/delete batch and does not check deleted-row count; two concurrent
requests can each return success and write success audit. The locked PostgreSQL
helper cannot safely reproduce that false-success audit, so it remains inactive.
The legacy workspace import commits each row before writing import-level
history and audit. Reproducing its later-row failure would retain a row with
no import-level audit; this parity gate remains blocked.
Single-target Coresignal Collect `preflight` now reads selected PostgreSQL
retained Search or saved-alumnus identity and application capacity. It retains
the confirmation and mock-webhook gates without issuing a provider request or
reservation. Confirmed `execute` remains D1-only. Disposable PostgreSQL/D1
HTTP acceptance passed 55/55, including authorization, invalid input, mock
webhook gating, missing history diagnostics, retained Preview and known-alumnus
response parity, zero new claims and redacted database failure. TypeScript and
focused ESLint and the direct `vinext build` passed. On this macOS checkout,
`npm run build` still stops at the repository wrapper because
`scripts/sites-env.sh` is not executable; the documented direct build command
is the verified production build path.
Webhook monitoring POST `preview` now resolves fixed or high-priority dynamic
cohorts from selected PostgreSQL data, applies the existing identity and
coverage classifier, and retains PCOM/Admin visibility rules. It issues no
provider request or subscription write. Other monitoring POST actions and the
receiver remain D1-only. Disposable PostgreSQL/D1 HTTP acceptance passed 56/56,
including fixed-ID status counts, dynamic exclusion of an archived member,
authorization, role visibility, no new subscription and redacted query failure.
The webhook unit suite passed 10/10; TypeScript, focused ESLint and the direct
production build passed.
Bright Data Admin POST `preflight` now reads selected PostgreSQL application
capacity, an exact saved LinkedIn target and any eligible local human-trial
attestation. It preserves the existing blocker and confirmation response without
creating a claim or calling Bright Data. Other Bright Data POST actions remain
D1-only. Disposable PostgreSQL/D1 HTTP acceptance passed 57/57, including
authorization, invalid URL, current application capacity, target mismatch,
human-trial gate, zero new claims and redacted query failure. The focused
Bright Data suite passed 14/14; TypeScript, focused ESLint and the direct
production build passed. Current method coverage is 43 full, ten partial and
four D1-only out of 57 exported HTTP methods. The active human-trial attestation
path cannot be exercised in the selected PostgreSQL local fixture because its
existing runtime gate requires an isolated D1 webhook mock; only the blocked
attestation response was compared. Bright Data execution acceptance remains
pending.
Webhook monitoring POST `review` now selects PostgreSQL for the existing Admin
notification decision. Its eligible-state update and security audit share one
transaction; invalid and already-decided notifications retain the existing
409 response. It makes no provider call. Disposable PostgreSQL/D1 HTTP
acceptance passed 58/58, including Admin/PCOM gates, invalid inputs, a decided
notification replay, exact response parity, one audit and forced audit-failure
rollback with a redacted database error. Focused webhook regressions passed
10/10; TypeScript, ESLint and the direct production build passed. Other webhook
monitoring actions and the receiver remain D1-only.
Webhook monitoring POST `attest` and `prepare` now select PostgreSQL. Attestation
checks a saved Base Employee ID and records one Admin audit; preparation reuses
the fixed or dynamic cohort classifier to create a draft subscription and audit.
Each write and its audit share a transaction. Neither action calls a provider
or activates monitoring. Disposable PostgreSQL/D1 HTTP acceptance passed 59/59
for the fixed and dynamic draft paths, exact attestation, authorization,
duplicate denial, response parity, and redacted audit-failure rollback. The
focused webhook suite passed 10/10; TypeScript, ESLint and the direct production
build passed. Activation, simulation, renewal, stop, reconcile and the receiver
remain D1-only. Two prior D1 HTTP runs stopped at the existing
pre-authorization concurrency assertion: D1 returned 200/404 with one winner
instead of the previously observed 200/200 with two success audits. This
establishes timing dependent D1 behavior; the assertion was not weakened, and
the third run passed 59/59.
Webhook monitoring POST `reconcile` now selects PostgreSQL for a saved draft's
membership preview. It persists only a preview operation and reconciliation
timestamp in one transaction; coverage, provider membership and credit balances
are unchanged. The disposable PostgreSQL/D1 HTTP suite passed 60/60 on its
second run, checking authorization, missing plans, intended additions, response
parity, and rollback of the operation insert when the timestamp update fails.
The first run passed all 58 PostgreSQL checks and the D1 reconciliation
contract, then stopped at the previously identified timing dependent
pre-authorization concurrency assertion (200/404 rather than 200/200).
Focused webhook tests passed 10/10; TypeScript, focused ESLint and the direct
production build passed. Activation, simulation, renewal, stop and the receiver
remain D1-only. Among the ten partially integrated HTTP methods, 31 of 67
named action or decision branches select PostgreSQL; this routing count does
not establish full failure-path equivalence for legacy Workspace import.
Bright Data POST `purge_expired_raw_evidence` now selects PostgreSQL with the
existing Admin confirmation and expired-retention rule. Its raw-evidence
deletion and security audit share one transaction; provider history and
accounting records are retained. Disposable PostgreSQL/D1 HTTP acceptance
passed 61/61 on its second run, checking 401/403, confirmation, one expired
fixture, replay, response parity, and forced audit-failure rollback. The first
run passed all 59 PostgreSQL checks and D1 purge parity, then stopped at the
same timing dependent D1 pre-authorization assertion. Focused Bright Data
tests passed 14/14; TypeScript, focused ESLint and the direct production build
passed. Trigger, status, retrieval, recovery and human-trial attestation remain
D1-only.
Confirmed Coresignal Collect review remains fail closed under PostgreSQL.
Disposable D1 HTTP investigation found that its existing identity-attachment
store throws `Insert select error: selected fields are not the same or are in a
different order compared to the table definition` after human confirmation;
the D1 route returns 500 without associating the alumnus. A PostgreSQL
transactional association prototype completed locally but cannot be activated
without resolving this existing D1 behavior and rechecking response and replay
parity. The prototype is preserved as inactive, uncommitted work in
`lib/postgres-collect-review-confirm.ts`. No D1 code was changed.
The final serial regression at this checkpoint reported 928 passes, eight
failures and 16 skips across 952 tests. Five failures are the previously tracked
UI/source assertions; the disposable D1 pre-authorization race returned
200/404; and two Node test-file workers exited with `SIGSEGV` and `SIGBUS`.
The crashed Corporate Opportunities and Professional Verification files passed
15/15 and 13/13 in isolation. The separate complete PostgreSQL/D1 HTTP suite
passed 61/61, including the confirmed-Collect D1 blocker assertion. Full
repository ESLint, TypeScript and the direct production build passed. Browser
acceptance and production-like capacity testing remain pending. Stage 3 is
partial and Step 4 real-data transfer is not ready.
Stage 3 continuation: alumni saved-history GET now selects PostgreSQL for the
alumnus lookup, retained-evidence index and row hydration. The existing shared
history presentation, access check and Intelligence-service proxy contract are
unchanged. PostgreSQL normalizes valid retained timestamp text for chronology
and leaves malformed values at the end, matching SQLite index ordering.
Disposable PostgreSQL/D1 HTTP acceptance compared the exact first and second
history pages (27 retained entries), PCOM/Admin reads, invalid and missing
requests, contact redaction and mixed timestamp formats. Forced query and
stopped-database failures remained redacted with no D1 fallback. The complete
disposable HTTP suite passed 62/62 on the final run. An earlier run passed all
60 PostgreSQL checks and D1 history parity, then stopped at the existing timing
dependent D1 preauthorization assertion. The focused D1 saved-history regression
passed; TypeScript, focused ESLint and the direct production build passed.
Current method routing is 44 full, ten partial and three D1-only out of 57;
the partial-method action tally remains 31/67.
Stage 3 continuation: twelve existing database-only engagement POST actions now
select PostgreSQL, including ownership, planning, response, completion and
birthday correction. Each event mutation, activity entry and security audit
share a transaction. Disposable PostgreSQL/D1 HTTP acceptance passed 63/63,
including all twelve action snapshots, duplicate/validation checks, concurrent
views, forced audit rollback and database outage redaction. TypeScript, focused
ESLint, the engagement D1 regression and direct production build passed. Current
method routing is 44 full, eleven partial and two D1-only out of 57; the
partial-method action tally is 43/84. Email preparation, preview, bulk/send
and delivery paths remain fail closed under PostgreSQL pending mock lifecycle
and reservation acceptance; no email transport is called by the new paths.
The Coresignal callback receiver now selects PostgreSQL explicitly for bounded,
authenticated notice storage, with subscription locking and indexed replay
deduplication. It performs no provider request, credit reservation or canonical
profile mutation. The local Worker permits receiver testing only with the
isolated disposable PostgreSQL socket, Admin development role and an explicit
callback secret of at least 32 characters. Disposable PostgreSQL/D1 HTTP
acceptance passed 64/64, including HMAC denial, malformed notices, replay,
unknown and stale identities, out-of-order and expired notices, competing
deliveries, forced whole-batch rollback and database outage. PostgreSQL request
validation and persistence errors use separate response paths so a SQL error
cannot be mistaken for a client error or leak SQL text. Current routing is 45
full, eleven partial and one D1-only method out of 57; partial action coverage
remains 43/84. The receiver never initiates provider work or accounting writes.
The saved-history D1 integration tests now extract their unchanged SQL from
the route's selected-backend `getDb().all` call, preserving the same page-boundary
and webhook-history assertions after the PostgreSQL branch was added.
Final Stage 3 continuation checks: disposable PostgreSQL/D1 HTTP 64/64,
focused provider-credit, webhook, import, authorization and security tests
56/56, saved-history D1 integration 7/7, TypeScript and direct production build
passed. The full serial suite reported 931 passes, six failures and 16 skips:
five existing UI/source assertions plus the timing-dependent D1
pre-authorization 200/200 versus 200/404 race. These results do not establish
provider reservation/execution parity, complete action routing, browser
acceptance or Neon capacity acceptance. Stage 3 and production cutover remain
blocked; no live provider request, real-data transfer or deployment occurred.
Discovery's local `ignore` review decision now selects PostgreSQL with a locked
result, provenance and pending-state checks, and atomic security audit. It makes
no provider call or canonical alumni change. Disposable PostgreSQL/D1 HTTP
acceptance passed 65/65, including replay, concurrent review, forced audit
rollback and database outage redaction. Current partial-method action coverage
is 44/84; forty named branches remain D1-only within partial methods.
The final serial run at this commit reported 933 passes, six failures and 16
skips: the five tracked UI/source assertions and a `SIGABRT` in the import
review test file. That file passed 10/10 alone. The timing-dependent D1
pre-authorization race passed on this run but remains an equivalence blocker.
Webhook `renew` and `stop` now have isolated mock-only PostgreSQL paths with
subscription locking and one transaction for subscription, coverage, operation
history and security audit. These paths cannot contact Coresignal. Disposable
PostgreSQL/D1 HTTP acceptance passed 66/66, including role gates, renewal
replay, concurrent stop, forced audit rollback and database outage.
The local PostgreSQL mock gate requires the existing disposable test socket,
Admin development role and an explicit webhook mock flag; other PostgreSQL
environments leave mock lifecycle actions disabled.
The webhook configuration regression now checks both the original disposable
D1 gate and the separate disposable PostgreSQL mock gate.
Engagement `bulk_preview` now selects PostgreSQL for saved event, recipient,
privacy, birthday and approved-template checks. It creates drafts without mail
transport, provider requests, action reservations or database writes. Disposable
PostgreSQL/D1 HTTP acceptance passed 67/67, including exact template selection,
consent exclusions, no-write state and redacted database failures.
PostgreSQL preview exclusions are typed separately from database failures so
an unavailable database cannot become a successful response containing SQL.
Single-recipient Engagement `preview` now selects PostgreSQL for consent,
ownership, approved-template and duplicate-reservation checks. Successful and
failed previews write paired engagement and security audit records atomically;
they do not reserve mail, send a message or call a provider. Disposable D1 and
PostgreSQL HTTP acceptance passes 68/68 and covers the same draft, audit,
failure and outage contract.
Current method routing is 45 full, eleven partial and one D1-only out of 57;
partial-method action selection is 48/84. The other three Engagements mail
branches remain D1-only.
Manual controlled-email preparation now selects PostgreSQL for approved-person
validation, reusable-event selection or creation and draft generation. Event
selection is serialized per alumnus, and generated/failed draft audits are
paired in PostgreSQL. Disposable D1/PostgreSQL HTTP acceptance passes 70/70,
including concurrent creation, replay, forced audit rollback, and redacted
database failure. It does not send mail or call a provider. Current
partial-method action selection is 49/84; only `send` and `bulk_send` remain
D1-only within Engagements, pending safe mail-reservation acceptance.
Admin `anonymize_alumnus` now selects PostgreSQL and uses one transaction for
the profile redaction, Do-not-contact control, lifecycle state and security
audit. It preserves the confirmation and pending-review gates; acceptance uses
fictional disposable records only. Its PostgreSQL HTTP subtest and D1 response
contract passed, including forced audit rollback; two complete HTTP runs each
reported 70/71 because the previously documented D1 concurrent
preauthorization assertion returned 200/404. Partial-method action selection
is 50/84.
At this Stage 3 checkpoint, `npm run lint`, TypeScript, the direct vinext build,
and focused security tests pass. The final serial regression reports 935 passes,
nine failures and 16 skips: five tracked UI/source assertions plus four HTTP
suite failures under the combined run. Within those HTTP failures, a PostgreSQL
provider-limit PATCH returned a redacted 500 after 35 seconds; the following
Enrichment check and D1 cross-backend comparison consequently lacked the
expected snapshot. The dedicated Admin anonymization test passed in that run.
The provider-limit timeout requires diagnosis before full Stage 3 acceptance.
The isolated import-review file passes 10/10, though a smaller combined run
encountered a native Node crash in that file. Browser acceptance and a
production-like database capacity run remain outstanding.
Webhook activation was D1-only at the preceding checkpoint.
Webhook `simulate` now selects PostgreSQL only in the disposable Admin mock
environment. It uses the same authenticated callback receiver and stores a
fictional notice before recording the simulation audit, matching D1's existing
ordering. No provider or external webhook transport is invoked. Activation
and downstream Collect claims remain D1-only. Partial-method action selection
is 51/84.
The disposable PostgreSQL/D1 HTTP suite now has 72 checks: 71 passed and the
existing D1 preauthorization race failed with 200/404. The mock simulation
subtest passed, including forced audit failure with the receiver notice retained
in the D1 order. The earlier 35-second PostgreSQL provider-limit PATCH did not
recur in three measured HTTP runs (133, 142 and 160 ms) or a repeated serial
run (163 ms). Request-scoped PostgreSQL stress checks returned only the test
client session after each burst; the original stall's phase remains unknown.
Mock webhook `activate` now selects PostgreSQL only under the isolated Admin
mock gate. It rechecks exact selected membership, confirms one `DRAFT` claim,
records a claimed operation, and atomically persists the mock subscription,
coverage and confirmed operation; security audit follows as in D1. No provider
request is made. Current routing is 46 fully PostgreSQL-routed methods, ten
partial and one D1-only out of 57; 52/84 tracked named actions select
PostgreSQL. Downstream Collect claims remain D1-only.
Disposable PostgreSQL/D1 HTTP acceptance for mock activation and simulation
passed 73/73, including a competing activation claim, confirmed coverage,
forced coverage rollback to `ERROR`, and matching D1 success responses.
The first full serial regression completed with 912 passes, five previously
known UI/source assertion failures and 16 skips. The final serial run after
preflight completed with 913 passes, those same five assertions, 16 skips and
one Node native `SIGTRAP` while exiting the Corporate Opportunities test
file. That file passed 15/15 alone. These results do not clear the import
failure-path blocker or authorize a production cutover.

Corporate Opportunities GET now selects a PostgreSQL read model for the
existing filters, support lists, summary and history presentation. Disposable
PostgreSQL/D1 HTTP acceptance passed 37/37, including filtering, support
lists, saved history, authorization, invalid input and database failure.
Existing opportunity regressions passed 15/15. POST and PATCH now use selected
PostgreSQL with transactional history and audit, validated by the later 49/49
disposable HTTP suite.

The Engagements workspace GET now selects PostgreSQL stored events, people,
preferences, templates, responses and activity before using the same response
presentation. Disposable PostgreSQL/D1 HTTP acceptance passed 38/38 with a
fictional event, owner, support data, authorization and stopped-database
redaction; engagement regressions passed 26/26. Send and mutation actions
remain D1-only.

Enrichment status GET now selects PostgreSQL provider settings, monthly usage,
history and Admin review evidence. As in D1, it creates missing default
provider settings during the read. Provider actions remain D1-only; settings
PATCH now has selected PostgreSQL support. The earlier GET-only disposable
PostgreSQL/D1 HTTP acceptance passed 39/39, including
monthly usage parity, Admin history visibility, PCOM restriction, concurrent
default-setting creation and stopped-database redaction; provider-credit
regressions passed 8/8.

Bright Data Admin GET now selects PostgreSQL attempt metadata and application
capacity while retaining the existing runtime gate and sanitized response.
Disposable PostgreSQL/D1 HTTP acceptance passed 40/40, including Admin
authorization, saved attempt and snapshot metadata, capacity and a redacted
database failure; Bright Data regressions passed 14/14. All Bright Data POST
actions remain D1-only.

The route inventory's top matrix now reflects current method-level
PostgreSQL coverage and distinguishes local D1 work from intelligence
proxy routes.
The earlier parallel regression run reported 908 passes, six failures and 16
skips. Five failures are the existing UI/source assertions. The sixth was
an atomic-mutation test process crash during parallel execution; that file
passed 5/5 when rerun alone. These results do not establish full Stage 3
acceptance.

Inactive CN refresh-policy creation and saved-policy reconciliation now have
disposable PostgreSQL HTTP acceptance with a local mock intelligence service;
the complete disposable PostgreSQL/D1 HTTP suite passed 41/41 on three serial
runs after one earlier anomalous failure. The earlier run took 467 seconds in
the import confirmation subtest and returned 500 for an overlength
Idempotency-Key that normally returns 400. This occurred before the policy
subtest, and its cause remains unresolved. Import failure-path acceptance is
blocked pending a reproducible diagnosis. No timeout or expected status was
changed.

Webhook monitoring overview GET now selects PostgreSQL subscriptions, saved
notifications and active coverage while retaining the existing role-based
membership and identity redaction. All webhook monitoring actions and the
receiver remain D1-only. Disposable PostgreSQL/D1 HTTP acceptance passed
42/42, including authorization, invalid page, role redaction, saved coverage,
and stopped-database redaction. Focused webhook regressions passed 10/10.

### Step 3E: PostgreSQL Admin read checkpoint

With PostgreSQL explicitly selected, the existing Admin summary and lifecycle
GET routes now use the selected PostgreSQL context after the original Admin
permission check. The summary retains users and linked identities, audit and
lifecycle history, programme and provider configuration reads, and operational
readiness fields. The lifecycle list retains search, filters, sorting,
pagination and empty-state behavior. The D1 default paths and UI are unchanged.
No additional Admin POST action was migrated; `add_programme` remains the only
selected PostgreSQL Admin mutation. Provider-credit display and attestation,
programme rename/status, user and lifecycle changes, imports, exports, provider
validation and other provider operations remain D1-only and fail closed when
PostgreSQL is selected. The full Admin page therefore remains partial.

The query text seen on the Step 3D Admin page came from the lifecycle route's
existing error-message fallback when a PostgreSQL identity query failed during
concurrent loading. The selected backend introduced SQL and binding text into
that fallback. The shared access-error boundary now returns a generic 5xx for
PostgreSQL query failures and logs only redacted code/kind diagnostics. A
disposable local HTTP test reproduces a forced query failure and checks that
no SQL, parameters or connection details reach the response. Concurrent Admin
reads are bounded to avoid saturating the small local pool. Authorization
remains 401 without a session and 403 for PCOM. No Neon or provider service was
contacted and no accounting state was changed.

The route-level [compatibility inventory](docs/postgres-app-access-inventory.md)
records integrated and remaining Admin methods. This is not full application
integration, real-data transfer remains unauthorized, and production cutover
remains **NO-GO**.

Step 3E validation: disposable PostgreSQL/D1 HTTP acceptance passed 15/15;
focused foundation, Admin-related D1, security and provider-credit tests passed
84/84. TypeScript, ESLint and the direct production build passed. The full
serial suite reported 903 tests: 882 passed, 16 skipped and the same five
previously known UI/source assertions failed. Local Chrome acceptance showed
the Admin user, programme, lifecycle, operational-readiness and audit sections,
including lifecycle empty filtering and restoration, with no browser-visible
SQL text. Provider Credits remained unavailable, and other D1-only page
requests produced a generic loading error; concurrent page loading caused
transient local pool timeouts. PCOM login showed no Administration tab; an
attempt to reload the Admin URL during that load returned the sign-in screen,
so complete browser authorization acceptance remains partial. The local
development runner also logged a raw SQL error from an unconverted route;
the selected Admin handlers themselves log only redacted database code/kind.
No live provider, preserved Neon database or original D1 was used.

| Capability | Status | Notes |
| --- | --- | --- |
| CN canonical workflows and product areas | Locally verified, not production-accepted | Directory/profile, discovery review/history, company, engagement/outreach, opportunities, cohorts and administration have local or isolated acceptance. |
| CSV/XLSX import and export | Locally browser-verified | Preview/validation/confirmed import, Directory reload and both downloads were accepted with synthetic isolated-D1 records; production persistence is untested. |
| Intelligence local integration | Locally verified, currently separate/inactive | Loopback authenticated service and review UI were validated; no automatic Intelligence-to-CN writeback. |
| Coresignal Base Employee Filter Preview and selective Collect | Implemented / mock-tested; one live Collect attempt ambiguous, no profile | Key access and 10-credit core price are Support-confirmed, but the isolated HTTP 503 attempt has an unreconciled 20-unit application hold and no returned profile. No retry or successful live acceptance; gate disabled. |
| Coresignal Employee ID persistence and Search-ID deduplication | Active domain capability | Durable identity and bulk indexed lookup. |
| Coresignal Base Employee ES-DSL Search/Preview | Locally live-verified in bounded cases; off by default | IIM Lucknow institution ID 25919228 is live-verified, as is its controlled 2011 exact-year predicate; controlled company predicates also have real responses, including retained zero-result Search #13. Other filter combinations are mocked; a Preview query match does not verify missing education, programme or employment evidence. One confirmed page/request, no automatic Collect, retry or pagination. The one-use UNKNOWN-entitlement trial exception is not in the shipping source. |
| Regular Search response parser and routing planner | Implemented behind disabled Search gate | Parses one page, deduplicates IDs, and routes identity without canonical mutation. |
| Exact-year ES-DSL request builder | Implemented behind disabled Search gate | Provider-free structure is validated; exact-year Search is live-verified for the IIM Lucknow 2011 case only. Search matches are not freshness or alumni qualification evidence; post-Collect evidence and human review remain authoritative. |
| Current-company ES-DSL Search | Implemented; bounded local live evidence | Server-side verified numeric mapping is preferred; Preview can use the supported exact-name fallback with unverified identity and human review. Lincoln International is the controlled verified-ID example. Generic summary company is not proof of current employment. |
| Coresignal Real-Time Employee API | Frozen | Previous attempt was unauthorized; later guidance said the API is unavailable. |
| Coresignal webhooks | Implemented / mock-validated, live inactive | Support email reports subscriptions available and free; account-specific creation, public HTTPS callback and verified Employee ID mapping remain untested. |
| Bright Data LinkedIn extraction | Locally live-verified once; gated now | One authorized isolated Trigger/Progress/Snapshot flow retained raw and normalized evidence without canonical linking. A new target/runtime needs fresh entitlement, billing and request approval; retrieval time does not prove employment freshness. |
| PDL | Historical records only | Existing provenance remains readable; no active requests, intake, updates, fallback, or production credential. |
| Lusha V3 Search/Enrich and Professional Signals | Implemented / mock-tested; live disabled | Search evidence is pending Admin identity review even for exact URL matches. Enrich uses separate consent/channel controls and `waterfallEnabled: false`; no current V3 live request or charge is verified. |
| Institutional Gmail | Implemented / mock-tested; live disabled | Draft/approval and uncertain-send fencing exist; no real send accepted. |
| Production deployment | NO-GO / not deployed at this source version | Hosted D1 backup/restore, ledger and 0010–0026 compatibility remain unresolved. |

## Safe local start

On Windows PowerShell or Command Prompt, with dependencies already installed:

```powershell
npm run dev:local:windows
```

This uses the existing development-only, session-backed Admin/PCOM authentication,
creates a fresh disposable D1 under the Windows temporary directory, applies local
migrations, and loads the existing synthetic fixtures. It leaves `.env.local`, the
original `.wrangler/state`, alumni records and provider history untouched. All live
provider/mail gates are forced off. Open [Admin](http://localhost:3000/login/admin)
or [PCOM](http://localhost:3000/login/pcom), then select **Enter local … workspace**.
No Google credentials or `.env.local` edits are required. Port 3000 must be free;
the existing ordinary Vite server on 5173 can remain running. See the Windows
details in [Local development](docs/local-development.md#windows-local-login).

Windows local acceptance (2026-10-27): Admin and PCOM sign-in, Directory and
Discovery access were browser-verified on disposable D1; PCOM Admin API access
returned 403. The 50 targeted local-auth, login, institutional-auth and security
tests passed. Live providers remained disabled.

For the existing Bash workflow, use only an already isolated checkout/database:

```bash
npm ci
npm run local:setup
npm run dev:local
```

`npm run dev:local` is the provider-free loopback path. It enables development-only local authentication and forces Coresignal, Base Employee ES-DSL Search, Lusha Contacts, Professional Signals, and live mail off.

For isolated Lusha V3 browser acceptance only, `LOCAL_LUSHA_V3_MOCK_TRANSPORT=true` selects fixed fictional Search/Reveal responses when the Admin local-development gate and a temporary D1 are also in effect. It does not use the API key or send a provider request. Never use this flag with the original D1 or for claims of live-provider acceptance. See [Local development](docs/local-development.md).

An explicitly authorized, one-result Coresignal demonstration can use `npm run dev:local:coresignal-live`. That command is intentionally live-provider enabled and must not be used without approval, a server-only key, and confirmation that consuming a provider operation is acceptable.

Detailed commands, environment-variable names, macOS build guidance, and Intelligence startup are in [Local development](docs/local-development.md).

## Validation

Lusha connection validation now reaches the selected PostgreSQL audit writer
without opening the D1 adapter. Its Admin permission, live/key readiness gate,
account-usage validator and response contract are shared with D1. Disposable
credential-free HTTP acceptance verifies unauthorized and PCOM rejection,
the exact missing-key response and absence of an audit or provider request.
The configured live-provider success path remains untested and is not a claim
of external entitlement or balance.

Bright Data's one-time human-trial attestation now selects PostgreSQL. It
reuses the established local Admin gate, exact fictional target, monthly
application allowance, unique audit key and D1 response contract. It records
only a local audit; it does not trigger Bright Data or create an attempt.
Disposable PostgreSQL/D1 HTTP acceptance passed 82/82, including access,
confirmation, wrong-target, concurrent duplicate, replay, one retained audit,
no claim and forced PostgreSQL audit failure. The test uses an obviously
fictional token and makes no provider request. These two actions raise
selection to 61/84; method coverage remains 47 full, nine partial and one
D1-only.

The final serial regression after local mock Collect route integration ran
976 tests: 955 passed, five failed and 16 skipped. All five failures are the
previously tracked UI/source assertions; no new PostgreSQL application
failure, D1 preauthorization race or native Node crash occurred in this run.
The disposable PostgreSQL HTTP group passed 78/78 subtests, including the
isolated mock Collect claim lifecycle. Focused Collect/claim tests passed
37/37; TypeScript, full ESLint and the direct `vinext build` passed. The
standard build wrapper still has the existing `scripts/sites-env.sh` execute
permission issue. This is local fictional-fixture acceptance, not live
provider, browser or Neon capacity acceptance. Stage 3 remains partial.

Admin Signals entitlement and Gmail connectivity validation now reach the
selected PostgreSQL audit writer before any D1 adapter lookup. They retain the
same Admin permission, provider validation functions, sanitized responses,
and audit metadata. Disposable acceptance uses missing credentials so neither
action sends an external request; live entitlement and Gmail scope are not
claimed by this check. Disposable PostgreSQL/D1 HTTP acceptance passed 79/79,
including response, Admin/PCOM access and audit outcome parity. Accepted
routing is 47 fully selected methods, nine partial methods and one D1-only
method; 59/84 tracked actions select PostgreSQL.

A disposable-only PostgreSQL Coresignal Collect execution path now uses the
shared claim store for a single fictional mock request. It is selected only
with the existing local mock gate and `CN_PG_LOCAL_TEST_ENABLED=true`; all
other PostgreSQL execution requests fail closed. The route retains the
preflight token, 20-unit application reservation, duplicate fence, evidence
and proposal review, and post-commit security audit ordering. Disposable
PostgreSQL/D1 HTTP acceptance passed 80/80, including one-winner concurrency,
replay, insufficient application budget, forced claim and settlement failures,
ambiguous held units, deterministic release, and forced audit failure with
exact stored-state parity. A fictional mock Employee ID (`99914001`) exercises
the deterministic rejection without any provider request. This accepts the
local mock execution path only; the full `execute` action is still outside
the 59/84 count because live Collect remains unavailable. Downstream webhook
Collect processing is not accepted by this test.

Stage 3 blocker-first work adds a PostgreSQL-only provider claim/settlement
foundation for disposable testing. It reserves Coresignal or Lusha application
units before provider I/O, serializes concurrent claims by provider, retains
ambiguous holds, and uses compare-and-set settlement. Only the isolated local
mock Collect route selects it; normal/live execution and Lusha execution do
not. The full action counts remain unchanged pending live lifecycle acceptance.
The focused accounting suite
passed 49/49 against fictional/disposable fixtures; TypeScript and the direct
build passed. The [Stage 3 accounting and decision record](docs/stage3-provider-accounting-and-decisions.md)
maps shared dependencies and the two unapproved concurrency exceptions.
The Coresignal Collect adapter binds its existing one-request
execution contract to that claim foundation, including webhook-event claims.
Disposable tests passed 7/7 for one mock request, ambiguous held units,
duplicate replay, webhook-event claim/release and no provider I/O. Only the
isolated mock route selects it; the accepted full-action count remains unchanged. Combined D1
Collect/webhook and PostgreSQL adapter tests passed 47/47; TypeScript and
the direct build passed.

An uncommitted `lusha_approve_identity` PostgreSQL draft is restricted to the
disposable local test gate. It is not selected in staging. Its association,
review decision, provider history completion and field change commit together;
security audit follows the committed batch as in D1. The PostgreSQL HTTP
subtest passed, but concurrent D1 approval produced one 200 and one 500, with
the losing D1 batch hitting the unique field-history mutation key after the
winner approved the review. PostgreSQL returned one 200 and one 409. Exact
concurrent response parity is unresolved; do not activate or commit this
operation until the compatibility decision is reviewed. No provider call or
credit reservation was made. Accepted routing remains 47 full, nine partial,
one D1-only method, with 59/84 tracked actions selected.

An uncommitted PostgreSQL Discovery `keep_separate` draft is restricted to
the disposable local test gate. PostgreSQL passed reviewer evidence, one
winner (201/409), one success audit and forced-audit rollback. The matching
D1 concurrent race returned 201/500. This response difference is unapproved;
the operation is not counted as accepted or enabled in staging.

The blocker-first serial checkpoint before the two Admin validations ran 974 tests: 953 passed, five
failed, and 16 skipped. All five failures are the previously tracked UI/source
assertions; the timing-dependent D1 preauthorization race and native Node
crash did not recur. Its disposable PostgreSQL/D1 HTTP subtests passed 76/76,
including local-only Lusha identity and Discovery keep-separate drafts, and
the unselected provider-claim suite passed 6/6. A preceding standalone HTTP
run reached the same drafts but failed the known D1 preauthorization race;
those drafts remain uncommitted and fail closed outside disposable tests.
Focused provider-credit, Lusha, Bright Data, Collect, webhook, Signals,
import and security tests passed 125/125; the Collect adapter's direct and
combined checks passed 7/7 and 47/47. TypeScript, full ESLint, and the direct
production build passed after the two accounting commits. These results
validate local fixtures only. Route-level provider accounting, browser and
Neon capacity acceptance remain outstanding; Stage 3 is partial and cutover
is not ready.

Stage 3 `lusha_approve_contact` now selects PostgreSQL for stored, Admin-reviewed
contact evidence. It preserves the existing contact, identity, permission,
usage-reconciliation and explicit-replacement gates. The profile mutation,
review transition and field history share a transaction; security audit follows
as in D1. Disposable PostgreSQL/D1 Worker HTTP acceptance passed 76/76,
including response and profile-history parity, one-winner concurrency,
privacy and replacement blocks, forced history rollback, committed state after
forced audit failure. A focused PostgreSQL Worker rerun passed 75/75 with
database outage redaction and no D1 fallback for this action. Focused
Lusha, credit and security tests passed 42/42; TypeScript, full ESLint and the
direct build passed. No provider call was made. Routing is 47 full, nine
partial and one D1-only method, with 57/84 tracked actions selected. The
previously documented D1 preauthorization race interrupted two earlier full
HTTP attempts before the third completed; its existing assertion was not
changed.

The serial regression after contact approval reported 965 tests: 943 passed,
six failed and 16 skipped. Five failures remain the tracked UI/source
assertions. The sixth was the unchanged concurrent D1 preauthorization
assertion returning 200/404. The new PostgreSQL contact approval subtest
passed; no native test-file crash or provider-limit PATCH timeout occurred in
that run. Those intermittent incidents and the import-confirmation 500 remain
readiness risks despite not recurring.

Stage 3 now routes Lusha identity and contact review rejection to PostgreSQL.
These Admin decisions operate only on stored review evidence; they make no
provider request or credit charge. Disposable PostgreSQL/D1 HTTP acceptance
passed 75/75, including Admin/PCOM gates, one-winner concurrent rejection,
replay, stored review state, audit counts and forced audit failure. The losing
concurrent request may receive either existing 409 message depending on when
it reads the review; the test asserts the invariant outcome. Focused Lusha
and provider-credit tests passed 28/28; TypeScript, full ESLint and the direct
build passed. Routing is 47 full, nine partial,
one D1-only method, with 56/84 tracked actions selected.

The serial Stage 3 regression after the Lusha checkpoint reported 964 tests:
943 passed, five failed, 16 skipped. All five failures are the previously
tracked UI/source assertions; this run had no native test-file crash, HTTP
timeout or new PostgreSQL failure. The earlier intermittent provider-limit
PATCH stall and import-confirmation 500 remain unresolved acceptance risks;
one clean run does not establish their cause. The legacy workspace import
failure-path mismatch and concurrent D1 preauthorization behavior remain
separate functional-equivalence blockers.

Stage 3 Engagements `send` and `bulk_send` now select PostgreSQL. They reuse
the existing consent, ownership and approved-template checks, reserve the
action key before invoking the shared mail transport, and retain an uncertain
delivery claim for mailbox reconciliation. Disposable PostgreSQL/D1 mock-mail
HTTP acceptance passed 74/74 with response and workspace-state parity,
concurrent claims, failed-before-delivery, ambiguous audit failure and a
persisted `Sending` reservation after interrupted execution. Focused mail and
Engagements tests passed 67/67; security and provider-credit checks passed
46/46. TypeScript, full ESLint and the direct build passed. No real email was
sent. Method routing is
47 full, nine partial and one D1-only out of 57, with 54/84 tracked actions
selected. This is routing and local mock acceptance, not live-mail acceptance.

Typical repository checks are:

```bash
node --test tests/*.test.mjs
npm run lint
npx tsc --noEmit
bash scripts/sites-env.sh -- ./node_modules/.bin/vinext build
git diff --check
```

`npm test` also runs the repository build wrapper before the Node suite. The wrapper expects GNU `timeout`; on macOS, the direct environment-loader plus `vinext build` command above is the validated equivalent.

## Known non-blocking limitations

- The current workspace API returns the complete alumni collection. Import correctness is validated at 10,000 rows, but interactive 10,000-row browser performance requires server-side directory pagination and bounded tab-specific payloads before production-scale acceptance.
- A selected Intelligence detail may require reselect/reload immediately after a decision to display the persisted state.
- During an Intelligence outage, the unavailable notice can coexist with empty-list copy.
- Mobile navigation affordance could be stronger.
- Enrichment remains information-dense.

These are P2 polish items, not local P0/P1 blockers.

## Release preparation remaining

Provider work still requires key-specific entitlement, account charge evidence, protected secrets, separate live-gate/request approval and controlled acceptance. Application reservations are not provider charges; unknown balances or debits are not zero. Production work first requires a Sites-supported complete/restorable export of the exact production D1, an authoritative migration ledger, isolated migration rehearsal and rollback, then separate release authorization.

## Documentation maintenance

Any milestone that changes architecture, schema semantics, provider behavior or status, setup/environment, operational or user-facing workflows, or release status must update the relevant README/docs in the same milestone. If no documentation change is needed, the milestone report must say why.

Windows synthetic Lusha browser acceptance recognizes only the dedicated `corporate-network-local-*` directory under the standard per-user Windows Temp / packaged-app Temp paths, with no parent traversal. Vite still requires an existing real path under its OS temporary root, outside the project; development/Admin/loopback and live-disabled checks remain mandatory. The normal Windows launcher keeps this mock option off.

New professional refresh reviews retain the complete sanitized field comparison, including unchanged company/designation observations, so reviewers can compare observed values with their stored baseline. Previously retained evidence is not rewritten; applying still requires an explicit authorized field selection and a fresh baseline check.

The dependent Outreach menu and company route-planning card are inactive alongside Engagement because their actions opened the retired queue. Existing mail/outreach routes and records remain authorized and preserved. Duplicate legacy profile-refresh buttons are retired in favor of the explicit professional-lookup chooser; comparison prioritizes company and designation and leaves technical identity envelopes in Admin history.

The fixed fictional Lusha transport normalizes a trailing slash when matching its allowlisted mock URLs, so URLs produced by the import normalizer exercise the same isolated fixture safely; live request code is unchanged and retained no-match history is preserved. Normal profile history loads Corporate Network retained evidence; the standalone Intelligence history integration remains authorized and available in source/API but inactive in the normal UI by default.
