# Database-access inventory and Step 3F compatibility

This inventory covers all 35 `app/api/**/route.ts` files in the supplied application. At Step 3A, every route reached D1 directly or through authorization and service helpers. `Direct ORM` means a direct database import or `getDb()` call in that file; a blank cell does not mean the route is database independent. The first table and earlier sections record their named historical checkpoints. The Consolidated Batch 1 matrix and M4/M5 notes below give the current import status.

| API path | Direct ORM | `env.DB` | Batch | SQLite-only SQL | Writes | Current PostgreSQL coverage |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `/api/admin/bright-data` | ✓ | ✓ | ✓ | ✓ | ✓ | GET and POST `preflight`/`purge_expired_raw_evidence`/`attest_human_trial` selected PostgreSQL; execution and recovery POST actions D1-only |
| `/api/admin/coresignal-collect` | ✓ | ✓ | ✓ | ✓ | ✓ | GET and POST `selection_preflight`/`preflight` HTTP-tested with D1 parity; `execute` accepted only for isolated local mock, while normal PostgreSQL/live execution fails closed |
| `/api/admin/coresignal-collect-review` | ✓ | — | — | — | ✓ | POST unconfirmed preflight selects PostgreSQL; confirmed association blocked by existing D1 identity-store SQL compilation error |
| `/api/admin/lifecycle` | ✓ | — | — | — | — | GET; HTTP-tested |
| `/api/admin/provider-credits` | ✓ | — | — | ✓ | ✓ | GET HTTP-tested; POST `attest` selected PostgreSQL with HTTP parity, `refresh` D1-only |
| `/api/admin` | ✓ | — | ✓ | — | ✓ | GET; eleven POST actions select PostgreSQL, including audited provider validations; pre-authorization correction and two mock-cleanup actions remain D1-only |
| `/api/alumni/[id]/history` | ✓ | — | — | ✓ | — | Selected PostgreSQL saved-history lookup, index and hydration; shared presentation and Intelligence proxy |
| `/api/alumni/[id]` | ✓ | — | ✓ | — | ✓ | GET, PATCH, POST proposal decision; HTTP-tested |
| `/api/alumni-collection` | ✓ | — | — | — | — | GET, HTTP-tested |
| `/api/directory` | — | — | — | — | — | GET, HTTP-tested |
| `/api/discovery/intake` | ✓ | — | ✓ | — | ✓ | POST preflight/execute HTTP-tested |
| `/api/discovery` | ✓ | — | ✓ | ✓ | ✓ | GET and POST `record_evidence`/`plan`/`regular_search_preflight`/`ignore` HTTP-tested; other POST actions D1-only |
| `/api/engagements` | ✓ | — | — | — | ✓ | GET and all seventeen POST actions select PostgreSQL; send/bulk-send mock-mail HTTP and interrupted-claim parity passed |
| `/api/enrichment` | ✓ | ✓ | ✓ | ✓ | ✓ | GET/PATCH HTTP-tested; POST `refresh_history`/`reconcile_usage`, `validate_lusha` credential-free gate, identity/contact rejection and contact approval HTTP-tested; identity approval has an uncommitted test-only draft blocked by D1 concurrency parity |
| `/api/exports` | ✓ | — | — | — | — | POST HTTP-tested |
| `/api/imports` | ✓ | — | ✓ | ✓ | ✓ | POST preview/execute HTTP-tested |
| `/api/intelligence/bright-eligibility/revalidate` | ✓ | — | — | — | — | POST HTTP-tested |
| `/api/intelligence/discovery/[candidateId]` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/discovery/readiness` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/discovery` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/profile/[alumnusId]` | ✓ | — | — | — | — | GET/POST local lookup HTTP-tested; separate service mocked |
| `/api/intelligence/refresh/jobs/[jobId]/reconcile` | — | — | — | — | — | Proxy and selected CN selection; HTTP pending |
| `/api/intelligence/refresh/jobs/[jobId]` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/refresh/jobs` | — | — | — | — | — | GET proxy; POST selected CN selection, HTTP pending |
| `/api/intelligence/refresh/preview` | — | — | — | — | — | POST selected CN selection, HTTP-tested for dynamic/fixed exclusion |
| `/api/intelligence/refresh/runs` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/reviews/[reviewId]` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/reviews` | — | — | — | — | — | Proxy; PostgreSQL auth |
| `/api/intelligence/webhooks` | ✓ | ✓ | ✓ | — | ✓ | GET and all nine POST actions select PostgreSQL; lifecycle execution remains isolated mock only and downstream Collect remains D1-only |
| `/api/opportunities` | ✓ | — | ✓ | — | ✓ | GET/POST/PATCH HTTP-tested |
| `/api/outreach-route` | ✓ | — | — | — | ✓ | POST HTTP-tested |
| `/api/professional-verification` | ✓ | — | ✓ | — | ✓ | GET/POST HTTP-tested |
| `/api/signals` | ✓ | — | — | — | ✓ | GET no local DB; POST D1-only |
| `/api/webhooks/coresignal/[subscriptionId]/[token]` | ✓ | ✓ | ✓ | ✓ | ✓ | POST HTTP-tested with D1 parity for HMAC, notice storage, dedupe, quarantine, ordering, rollback and outage |
| `/api/workspace` | ✓ | — | — | — | ✓ | GET; POST `manual_check`/`manual_add`/`import`; PATCH four actions; HTTP-tested, with import failure-path mismatch |

## Current checkpoint (2026-11-15, Windows laptop)

**PostgreSQL is the default backend.** An unset `CN_DB_BACKEND` selects PostgreSQL, and D1 requires
`CN_DB_BACKEND=d1`. Every branch still listed below as D1-only returns a sanitized error in the default
configuration (fail closed, no D1 fallback).

**Coverage: 49 full / 7 partial / 1 D1-only of 57 methods; 73/84 named actions select PostgreSQL**
(previously 47/9/1 and 61/84). `POST /api/admin` (14/14) and `POST /api/admin/coresignal-collect-review`
(2/2) are now fully routed.

Selected in this checkpoint under the compatibility decisions approved on 2026-11-15:

| Action | Contract | Evidence (disposable PostgreSQL/D1 HTTP acceptance) |
| --- | --- | --- |
| Admin `correct_pre_authorization` | D1 validation and messages; concurrent loser gets a sanitized 409 and writes no audit; sequential replay keeps 404 | Single winner [200, 409], one audit per correction |
| Admin `preview_mock_cleanup` | D1 inventory over one read-only snapshot; SQLite PRAGMA fields reported as `integrity_check: "ok"` and `foreignKeys: []` (PostgreSQL enforces FKs) | 200 with D1 shape |
| Admin `remove_mock_dataset` | D1 confirmation, ambiguity stop, delete order and audit, in one transaction | Atomic. The D1 inventory predates 17 FKs from newer tables, so referenced data blocks removal on both backends; PostgreSQL rolls back with a sanitized 500 (decision pending: extend the cleanup scope?) |
| Collect review, confirmed association | Intended identity attachment (D1 store fails SQL compilation) | Attach once, history and approval audit, replay without a second write |
| Discovery `keep_separate`, Enrichment `lusha_approve_identity` | Sanitized 409 for the concurrent loser | [201, 409] / [200, 409] |
| Discovery `link_existing`, `approve`, `apply_updates` | D1 validation; row locks; identity via the PostgreSQL store; race loser rolled back | [200/201, 409] with single history and audit |
| Enrichment `apply_refresh` | D1 checks including stale-evidence 409 and the identity-change permission | Forced audit failure rolls back; [200, 409] |
| Workspace bulk import collision | Atomic rollback with D1's 400 status and a sanitized message | No rows, run, activity or audit written |
| Discovery `search` | Mock (isolated local demo) and live ES-DSL Preview with D1's gates, budget, company mapping, history and audit; successful runs commit atomically | Mock: stored results, rollback on audit failure, D1 parity of counts and response fields. Live: gates verified up to the provider call with no Coresignal request |
| Discovery `continue_search` | Live Preview continuation with D1's gates, page checks and accounting | Gate responses verified; the paid continuation is the account owner's first live action |

Live Coresignal discovery is opt-in: `node scripts/dev-local-windows.mjs --coresignal-live` (see README).

Still D1-only (11), all provider execution:

| Group | Branches | Next step |
| --- | --- | --- |
| Bright Data | `trigger`, `status`, `retrieve`, `recover_evidence` | Attempt-ledger lifecycle acceptance with mocks |
| Coresignal | normal/live Collect `execute`, Discovery `regular_search`, Enrichment `refresh_profiles` | Claim/settlement acceptance (mock Collect already accepted) |
| Lusha | `lusha_search_contact`, `lusha_reveal_email`, `lusha_reveal_phone` | Reservation/settlement acceptance |
| Provider Credits | `refresh` | Read-only balance call; needs a live-request decision |
| Signals | `POST /api/signals` (whole method) | Approved pre-request claim and ambiguous-outcome policy |

## Current tracked action routing

The PostgreSQL provider-claim foundation is selected only by isolated mock
Collect execution. It is not counted as a fully accepted action or live path.
Focused claim/credit tests passed 49/49. The dependency map and two unapproved
concurrency decisions are in [Stage 3 accounting and decisions](stage3-provider-accounting-and-decisions.md).
The PostgreSQL Coresignal Collect claim-store adapter is under
disposable testing; 7/7 direct and 47/47 combined D1/PG focused checks
passed. The local mock `execute` path now has 80/80 disposable PostgreSQL/D1
HTTP acceptance, including claim, budget, settlement, audit, replay and
concurrency state parity. Live execution is still unselected and the full
named action remains outside the accepted action count.

The final consolidated serial run after mock Collect routing reported 976
tests: 955 passed, five failed and 16 skipped. The five failures are the
existing UI/source assertions. Its PostgreSQL HTTP group passed 78/78; no
new PostgreSQL regression, D1 preauthorization race or native crash appeared.
Focused Collect/claim tests passed 37/37, and TypeScript, full ESLint and the
direct production build passed. Browser and Neon capacity acceptance remain
unperformed. This checkpoint leaves method coverage at 47 full, nine partial,
one D1-only and accepted named-action coverage at 59/84.

The credential-free Lusha validation gate and one-time local Bright Data human
attestation subsequently selected PostgreSQL. Complete disposable HTTP
acceptance passed 82/82. Live Lusha balance validation and Bright Data
execution remain untested. Current selection is 61/84 named actions.

The count below uses named POST actions, or the confirmed/unconfirmed decision
branches for Collect review. It retains the original eleven tracked methods,
including webhook POST, which is now fully routed. Other fully integrated
methods and the one D1-only method are outside this denominator.
"Selected" means the named branch dispatches to PostgreSQL. It does not claim
all edge cases are functionally equivalent.

| HTTP method | Named branches | Selected PostgreSQL | Remaining D1-only |
| --- | ---: | ---: | ---: |
| `POST /api/admin` | 14 | 11 | 3 |
| `POST /api/admin/bright-data` | 7 | 3 | 4 |
| `POST /api/admin/coresignal-collect` | 3 | 2 | 1 |
| `POST /api/admin/coresignal-collect-review` | 2 | 1 | 1 |
| `POST /api/admin/provider-credits` | 2 | 1 | 1 |
| `POST /api/discovery` | 11 | 4 | 7 |
| `POST /api/enrichment` | 12 | 6 | 6 |
| `POST /api/workspace` | 3 | 3 | 0 |
| `PATCH /api/workspace` | 4 | 4 | 0 |
| `POST /api/intelligence/webhooks` | 9 | 9 | 0 |
| `POST /api/engagements` | 17 | 17 | 0 |
| **Total for these eleven methods** | **84** | **61** | **23** |

The 23 named branches still without PostgreSQL selection are:

| Method | Remaining branches |
| --- | --- |
| `POST /api/admin` | `correct_pre_authorization`, `preview_mock_cleanup`, `remove_mock_dataset` |
| `POST /api/admin/bright-data` | `trigger`, `recover_evidence`, `status`, `retrieve` |
| `POST /api/admin/coresignal-collect` | `execute` (live and normal PostgreSQL; isolated mock path accepted) |
| `POST /api/admin/coresignal-collect-review` | confirmed association |
| `POST /api/admin/provider-credits` | `refresh` |
| `POST /api/discovery` | `continue_search`, `regular_search`, `search`, `link_existing`, `approve`, `apply_updates`, `keep_separate` |
| `POST /api/enrichment` | `lusha_search_contact`, `lusha_approve_identity`, `lusha_reveal_email`, `lusha_reveal_phone`, `apply_refresh`, `refresh_profiles` |

`keep_separate` has an uncommitted PostgreSQL implementation draft. Its
accepted count remains unchanged pending disposable D1/PostgreSQL HTTP,
concurrency and audit rollback checks. PostgreSQL passed one-winner 201/409,
review state, single audit and forced-audit rollback. D1 returned 201/500
in the corresponding concurrent race; the difference is unapproved and the
PostgreSQL branch remains local-test-only.

The blocker-first final serial run reported 974 tests: 953 passed, five failed,
16 skipped. All five failures are the previously tracked UI/source assertions.
The D1 preauthorization race and intermittent native import-test crash did not
recur. Its disposable PostgreSQL/D1 HTTP suite passed 76/76, including the two
local-only drafts; the unselected provider-claim suite passed 6/6. A preceding
standalone HTTP run still reproduced the known D1 preauthorization race.
Focused provider, import and security tests passed 125/125; the Collect adapter
passed 7/7 direct and 47/47 combined focused checks. TypeScript, full ESLint
and direct build passed. Neither local-only draft changes accepted method/action
counts. Browser and Neon capacity acceptance remain unperformed.

`POST /api/signals` is the sole wholly D1-only method. Its successful path
requires a live Lusha entitlement and provider request, which this work has
not exercised. The existing D1 sync records reported or unresolved usage after
the provider response and does not have a durable pre-request claim. PostgreSQL
execution needs a reviewed accounting and ambiguous-outcome design before mock
acceptance can establish safe parity. The newly routed engagement send branches
passed local mock lifecycle acceptance; provider execution branches require accounting
acceptance. The confirmed Collect association, pre-authorization correction
and legacy workspace import failure path retain the blockers recorded below.

Current method classification is 47 fully routed, nine partially routed and
one D1-only out of 57 exported methods.
The two Admin provider-validation actions use the same Admin permission,
validator and audit payload on either backend. Disposable PostgreSQL/D1 HTTP
acceptance passed 79/79 with credentials blanked, so no Signals, Gmail or
other provider request was sent. The PostgreSQL audit writer retained the
expected result and outcome; live entitlement and OAuth scope are unverified.
The latest serial regression after contact approval produced 943 passes, six
failures and 16 skips. Five failures were previously tracked UI/source
assertions; the sixth was the unchanged D1 preauthorization 200/404 race.
The contact-approval PostgreSQL subtest passed in that run.
The latest serial run after Lusha rejection produced 943 passes, five
previously tracked UI/source failures and 16 skips, without a native crash or
new PostgreSQL regression. Provider-limit and import-confirmation incidents
remain unresolved despite no recurrence in that run.
Alumni saved-history GET has disposable PostgreSQL/D1 exact-page parity across
27 retained entries,
chronology, redaction, Admin/PCOM access and fail-closed database errors. The
complete disposable HTTP suite passed 62/62; TypeScript, focused ESLint, the
D1 saved-history regression and the direct production build passed.
The subsequent engagement group passed 63/63 disposable PostgreSQL/D1 HTTP
checks, with all twelve local action snapshots matching, duplicate and
validation checks, concurrent views, forced audit rollback and stopped-database
redaction. TypeScript, focused ESLint, engagement D1 regressions and the direct
production build passed. Its five mail-related POST actions remain D1-only.
The Coresignal callback receiver passed 64/64 disposable PostgreSQL/D1 HTTP
checks, including HMAC rejection, invalid body, replay, unknown and stale
identity quarantine, out-of-order and expired states, concurrent duplicate
delivery, whole-batch rollback and database outage. No provider call, credit
reservation or canonical profile mutation occurs in the receiver.
Discovery `ignore` passed 65/65 disposable PostgreSQL/D1 HTTP checks,
including authorization, provenance, replay, competing decisions, forced audit
rollback and database outage. Its result row and security audit commit together.
Mock webhook `renew` and `stop` passed 66/66 disposable PostgreSQL/D1 HTTP
checks, including authorization, confirmation, replay, competing stop, forced
security-audit rollback and database outage. The PostgreSQL path locks the
subscription and atomically records state, coverage, operation history and
audit. Its mock gate requires the disposable local PostgreSQL test environment.
Engagement `bulk_preview` passed 67/67 disposable PostgreSQL/D1 HTTP checks,
including authorization, exact approved-template draft selection, consent
exclusions, no new action or audit writes, database error redaction and outage.
Single-recipient Engagement `preview` adds duplicate-reservation checks and
paired activity/security audits for successful and failed drafts. The HTTP
contract checks parity with D1 without invoking mail transport.
Manual Engagement email preparation now selects or creates a reusable event,
then validates and audits a controlled draft. Its per-alumnus event selection
uses a row lock to prevent duplicate draft events under concurrent requests.
Disposable PostgreSQL/D1 HTTP acceptance passes 70/70, including concurrent
creation, repeated preparation, forced audit rollback, redaction and no mail
action reservation.
Admin anonymization now atomically updates profile redaction, contact controls,
lifecycle and security audit in PostgreSQL. The dedicated HTTP subtest and D1
response contract passed. Two complete 71-test HTTP runs reported 70 passes
and one previously documented D1 concurrent preauthorization 200/404 race.
Webhook `simulate` now dispatches to PostgreSQL only in the isolated Admin mock
environment and calls the authenticated receiver with a fictional notice. The
receiver write precedes the simulation security audit, as in D1; an audit
failure can therefore leave a stored notice without that audit. This inherited
ordering needs explicit acceptance before production use. Downstream Collect
processing remains unselected.
The 72-check disposable HTTP suite passed 71 checks; the unchanged concurrent
D1 preauthorization assertion failed on its legitimate 200/404 ordering. The
new simulation subtest and D1 response contract passed. The earlier 35-second
provider-limit PATCH has not recurred in three measured HTTP runs (133, 142,
160 ms) or a repeated serial run (163 ms). The isolated stress diagnostic
observed only the test client session after each burst, but the original
stall's phase is still unproven. Two serial test-file crashes were traced in
macOS diagnostics to Node/V8 native reference cleanup with the Rolldown
binding loaded; both files passed 28/28 in isolation.
Mock webhook `activate` now selects PostgreSQL under the isolated Admin test
gate, using a single compare-and-set claim followed by a confirmed coverage
transaction. A failed persistence transaction leaves an `ERROR` subscription
and a claimed operation for manual review, matching the D1 mock state machine.
It does not create a provider subscription or spend credits.
Disposable PostgreSQL/D1 HTTP acceptance passed 73/73, including mock
activation success, competing claims, forced coverage rollback to `ERROR`,
and simulation through the signed callback receiver.
The final serial regression reports 935 passes, nine failures and 16 skips.
Five failures are tracked UI/source assertions. The combined HTTP run had a
35-second PostgreSQL provider-limit PATCH ending in a redacted 500; its next
Enrichment check and the D1 comparison then lacked the expected snapshot.
The Admin anonymization subtest passed in that combined run. The 35-second
failure has not been reproduced or attributed, so the HTTP suite is not a
clean final gate. The isolated import-review file passes 10/10; a smaller
combined run ended that file with a native Node crash.
An earlier full serial regression reported 933 passes, six
failures and 16 skips: five previously tracked UI/source assertions plus a Node
`SIGABRT` in `tests/data-import-review.test.mjs`, which passed 10/10 alone.
The timing-dependent D1 pre-authorization race passed in this run, but its
non-deterministic result still blocks activation of the PostgreSQL helper.
The saved-history source-extraction tests were adjusted for the existing
`getDb().all` D1 call site and passed 7/7, preserving their exact SQL assertions.
Focused provider-credit, webhook, import, authorization and security suites
passed 56/56. The full serial suite reported 931 passes, six failures and 16
skips: five tracked UI/source assertions and the timing-dependent D1
pre-authorization 200/200 versus 200/404 race. Browser and Neon capacity
acceptance remain unperformed. Provider reservation and execution paths remain
outside accepted PostgreSQL coverage.
Bright Data expired-evidence purge
is Admin-confirmed and atomically audited; disposable PostgreSQL/D1 HTTP
acceptance passed 61/61 on the second run. The first run passed its PostgreSQL
and D1 purge checks, then stopped at the pre-existing D1 pre-authorization
race. The newly selected webhook actions
are `preview`, `review`, `attest`, `prepare` and `reconcile`. A disposable
PostgreSQL/D1 HTTP run passed 60/60, including reconciliation preview and
transaction rollback. A prior run stopped only at the existing timing
dependent D1 pre-authorization concurrency assertion after all 58 PostgreSQL
checks passed; that assertion remains unchanged.
The prior serial regression had 928 passes, eight failures and 16 skips: five
previously tracked UI/source assertions, the timing dependent D1
pre-authorization race, and two Node test-file crashes (`SIGSEGV`, `SIGBUS`).
The crashed files passed 15/15 and 13/13 in isolation. The separate disposable
PostgreSQL/D1 HTTP suite passed 61/61. Confirmed Collect association remains
fail closed because the D1 identity store's insert/select statement fails at
SQL compilation; the PostgreSQL association prototype is inactive and
uncommitted. Browser and production-like capacity checks are outstanding.

## Library and non-API entry points

`db/index.ts` constructs Drizzle's D1 adapter from `cloudflare:workers`
`env.DB`. The two additional identity entry points are
`app/auth/chatgpt/session/route.ts` and `app/auth/google/callback/route.ts`;
both use the database-backed `lib/security.ts` identity and audit path.
`lib/security.ts`, `lib/mutation-idempotency.ts`, `lib/directory-data.ts`,
`lib/intelligence-cohort.server.ts`, `lib/intake-status.ts`,
`lib/placement-relevance-sql.ts`, `lib/coresignal-identity-store.ts`,
`lib/coresignal-search-id-store.ts`, and
`lib/provider-company-mapping-store.ts` directly import database schema,
adapter, or SQL helpers. `lib/coresignal-collect-only.ts`,
`lib/lusha-request-guard.ts`, `lib/lusha-identity-review.ts`, and
`lib/lusha-contact-review.ts` supply raw SQL embedded by API routes.

## Migration classes

- **Shared domain logic:** parsing, input validation, provider-evidence
  normalization, role policy, and response formatting can remain shared when
  they do not depend on a SQLite column type or dialect-specific SQL.
- **ORM table operations:** ordinary Drizzle selects, inserts, updates,
  deletes, and `onConflict` calls can keep their business rules but require
  PostgreSQL schema imports and a PostgreSQL transaction-aware adapter.
  SQLite boolean-mode integers become PostgreSQL booleans; IDs remain
  database-generated integers.
- **D1 prepared statements:** the five `env.DB` route files above use
  `.prepare().bind().first()/run()` and sometimes `.meta.changes`. These need
  parameterized PostgreSQL queries with checked returned rows or affected-row
  counts. Direct SQL must not be hidden behind a simulated D1 API.
- **Batch and transaction boundaries:** D1 `db.batch()` and `env.DB.batch()`
  are relied on for atomic multi-write operations in imports, discovery,
  alumni/profile updates, Admin changes, provider claims, enrichment,
  webhooks, opportunities, and professional verification. Each workflow needs
  an explicit PostgreSQL `db.transaction(async tx => ...)` boundary and must
  keep audit, idempotency, and accounting writes in that boundary where the
  workflow requires all-or-nothing behavior. Provider calls must remain
  outside long-running database transactions.
- **SQLite-only SQL:** `unixepoch`, `datetime`, `json_extract`, `json_valid`,
  `changes()`, and `INSERT OR IGNORE` occur across the marked routes and SQL
  helper modules. PostgreSQL replacements need reviewed timestamp parsing
  (stored date fields are text), safe JSON handling for malformed retained
  strings, `ON CONFLICT`, and `UPDATE ... RETURNING` or row-count checks.
- **Concurrency and idempotency:** import leases, request keys, provider
  claim uniqueness, credit reservations, review version checks, webhook
  deduplication, and audit uniqueness require PostgreSQL-specific compare and
  set logic and failure tests. `changes()` is connection-local SQLite state
  and cannot be translated literally. Upsert conflict targets and partial
  unique indexes must match the committed PostgreSQL schema.
- **Authorization:** Step 3A session and role logic queried D1. Step 3B adds
  PostgreSQL identity, session, and audit paths before enabling the selected
  GET routes, so those requests never combine D1 identity with PostgreSQL
  alumni records. Unconverted D1 routes fail closed under PostgreSQL selection.
  Step 3C connects `POST /api/admin` action `add_programme` to the
  transaction proof after the existing `MANAGE_USERS` authorization. Step 3E
  adds Admin GET and lifecycle GET. Every other Admin action still fails closed
  in PostgreSQL mode.

## Step 3B read group

`GET` in the final column means only that route's GET handler has a PostgreSQL
path after same-database session resolution and `VIEW_ALUMNI` authorization.
The profile PATCH and proposal-decision POST methods are integrated in Step 3D.
Workspace POST `manual_check` and `manual_add`, and PATCH `update_alumnus`,
`update_priority`, `update_data_quality`, and `update_privacy` are integrated.
Workspace POST `import` remains D1-only and returns 501 under PostgreSQL selection
after the existing request and Admin permission checks. Of the other 31 API route
files, `/api/admin` has only the `add_programme` POST action integrated; its GET
and remaining actions, and all 30 other route files, remain D1-only.
`/api/exports` and `runDirectoryExportQuery` are not
part of this read group. The auth entry points (`/auth/chatgpt/session`,
`/auth/google/callback`, `/auth/local/start`) use the PostgreSQL identity
resolver when explicitly selected; the existing session token and provider
verification are unchanged. `lib/security.ts` selects the backend for identity,
session and audit access before any application record read. PostgreSQL
login/identity writes are limited to the existing authentication lifecycle.

The PostgreSQL read modules are `lib/postgres-directory-data.ts`,
`lib/postgres-placement-relevance-sql.ts`,
`lib/postgres-alumni-collection.ts`, `lib/postgres-workspace-read.ts`, and
`lib/postgres-alumnus-profile.ts`. They use `db/postgres/schema.ts` and an
explicit PostgreSQL pool. The `response_received` relevance predicate uses
PostgreSQL boolean syntax, and the fixed decimal weights are cast to numeric
before multiplication. Counts, facets, aliases, missing-company filtering,
case-insensitive search, year and seniority filters, sort and page clamping
retain the D1 logic. The shared profile mapper preserves contact masking.
Timestamps remain text by the validated schema contract; these reads order
those stored values without changing their format. No selected read performs
JSON extraction or provider calls.

The remaining direct D1 helpers and route classes listed above still require
reviewed PostgreSQL query, transaction, accounting, and idempotency work.
PostgreSQL is not a full application backend or a production cutover target at
this checkpoint.

## Step 3C request and write acceptance

`tests/postgres-http-acceptance.test.mjs` starts the actual local application
against a disposable PostgreSQL 17 database with fictional identities and
records. It exercises the four GET routes with Admin, PCOM, Developer and
unauthenticated sessions; filters, pagination, empty and missing results;
contact masking; and a stopped-database failure with no D1 fallback or SQL
leakage. The same suite starts a separate disposable D1 application and
checks the existing Admin programme request and response contract. Both
instances are loopback-only; the suite removes their databases afterward.

The selected Admin POST returns 201 on creation, 400 for invalid input, 409
for duplicate code, 403 for PCOM, and 401 without a session. The PostgreSQL
programme and audit inserts share one transaction. Simultaneous duplicate
submissions produce one 201 and one 409, with one programme and one audit;
a forced audit insertion failure rolls back the programme insert. Workspace
GET provides the integrated PostgreSQL readback; Admin GET still requires its
separate migration. The pool retires checked-out connections after use because
the local Cloudflare Worker cannot reuse a connection across request contexts.

Browser acceptance is blocked by the Work setting “Local browser use is
disabled”; there is no established local Playwright suite for these flows.
The application backend remains incomplete and production cutover is NO-GO.

## Step 3D profile and workspace mutations

`lib/postgres-profile-mutations.ts` uses the existing field planner, profile
response mapper, request fingerprint, and role checks. A PostgreSQL transaction
locks the alumnus row and conditionally updates its record version, then commits
the mutation request, guard, field history, protected-field proposals, and
security audit together. Replays return the stored response; a reused key with
different payload is rejected. Admin proposal acceptance or rejection uses the
same request ledger and transaction. Acceptance checks the expected version
and old canonical value and retains the existing Coresignal collection-event
status update when applicable. No proposal bypasses human review.

`lib/postgres-workspace-mutations.ts` keeps manual duplicate matching and
validation, including a transaction-scoped lock before the final manual-add
scan. Manual creation commits the alumnus, activity, and audit rows together.
Each selected PATCH action commits its data, activity/history when applicable,
and security audit in one transaction. `update_alumnus` retains the provisional
outreach guard. These workspace actions have no D1 request-key or record-version
precondition, so PostgreSQL does not add a new API precondition. The bulk import
action and `/api/imports` remain D1-only, as do provider-credit accounting and
all unrelated mutations.

The disposable PostgreSQL/D1 HTTP suite covers Admin/PCOM/unauthenticated
access, profile validation and missing records, version conflicts, replay and
idempotency-key conflicts, concurrent edits, protected-field proposals and
decisions, manual duplicate submissions, workspace state changes, forced audit
and history failure rollback, and stopped-database behavior. Focused Chrome
browser checks passed PCOM login, Directory search/profile retrieval, a profile
note edit and outreach-status update; PostgreSQL readback showed version 2,
the saved note and `Contacted`. Admin login and role presentation also worked.
Browser acceptance is partial: the full page still requests D1-only discovery,
history, professional-verification, Admin GET, provider-credit and other routes,
which fail closed in PostgreSQL mode. Under simultaneous page requests, a local
pool connection timeout also caused a transient workspace failure; the local
test timeout now matches the pooled runtime's five seconds. The Admin page
displayed an internal query error from an unconverted route during that load.
It is not accepted for PostgreSQL use. This is not full application integration
or production acceptance.

## Step 3E Admin reads and error boundary

`GET /api/admin` now reads users and their linked identity summaries, the most
recent 200 security audit events, lifecycle rows, provider settings, latest
mail-validation audit, programmes, provider-company mappings and aliases from
the selected PostgreSQL database. It retains the existing response fields,
ordering, runtime-readiness values and `MANAGE_USERS` permission. Its selected
queries are issued sequentially to bound pool demand during concurrent page
loads. `GET /api/admin/lifecycle` keeps the existing search, state/programme
filters, sort, page clamping, count and distinct programme list under the same
permission. Both D1 paths remain unchanged.

The Step 3D Admin-page query text was traced to `GET /api/admin/lifecycle`:
while the selected PostgreSQL identity query failed under concurrent load,
the route serialized Drizzle's error message into a 400 JSON body and the
Admin panel displayed that body. The D1 route already had the broad
`error.message` fallback, but the PostgreSQL query and parameter detail were
introduced by the selected backend. The shared access-error boundary now
recognizes selected PostgreSQL Drizzle failures and returns a generic 5xx;
the selected handler logs only error code and kind. A forced missing-table query
and stopped-database HTTP checks verify that SQL, bindings, schema detail and
connection strings stay out of the response. AccessError 401/403 contracts
remain unchanged. No credential was observed in the reproduced response.

`GET /api/admin/provider-credits` remains D1-only. Its monthly usage uses
SQLite `datetime()` over historical text timestamps; equivalence for mixed
legacy timestamp formats must be proved before PostgreSQL display totals are
accepted. The corresponding POST can attest balances or call external account
APIs and is outside this step. Other Admin POST actions remain D1-only:
provider-company mapping upsert, Signals/Gmail validation, mock cleanup,
programme rename/status, user authorization/correction/role/status, lifecycle
mutation and anonymization. The existing `add_programme` PostgreSQL action is
unchanged. No new administrative mutation was selected. Other Admin UI
dependencies, including exports, history, provider operations, professional
verification and provider-credit panels, are not integrated and fail closed
under PostgreSQL selection. This is partial Admin acceptance, with no provider
API calls or accounting writes in the new GET paths.

Disposable HTTP acceptance passed 15/15, including Admin GET shape, 401/403,
filters, empty results, concurrent reads, forced missing-table and stopped
database failures, D1 default shape, and the existing programme transaction
tests. Focused PostgreSQL/D1/security tests passed 84/84. TypeScript, ESLint
and direct production build passed. The full serial suite reported 903 tests:
882 passed, 16 skipped, and the five known UI/source assertion failures.
Chrome showed Admin users, programme options, lifecycle rows and filters,
readiness and audit sections without raw query text. Provider Credits failed
closed; other unconverted page requests produced a generic loading error and
transient pool timeouts. PCOM had no Administration tab. A direct Admin URL
reload during concurrent loading showed the sign-in screen, so browser role
acceptance remains partial despite the 401/403 HTTP checks. The development
runner logged raw SQL for an unconverted route outside these Admin handlers;
its logging boundary needs separate review before full application acceptance.
No preserved database or external provider was contacted.

## Step 3F focused integration

Admin summary and lifecycle PostgreSQL reads now use one short transaction
apiece, retaining their response shapes while reducing repeated pool checkouts.
The local runtime still times out under ten simultaneous Admin requests. Five
requests passed before this change; the baseline ten-request burst returned
five 200s and five 500s at about five seconds, then affected later requests.
After the transaction change, a ten-request burst still produced 200/400/500
and request timeouts by ten seconds. Twenty HTTP requests were not attempted
after ten destabilized the fixture. Direct node-postgres transactions with a
five-client, one-use pool passed 5/10/20 concurrent runs in 103/71/113 ms;
total, idle and waiting clients returned to zero. PostgreSQL activity inspection showed no accumulating
sessions or long-running query. The remaining local Worker runtime/pool
interaction is unresolved; no pool limit or timeout was increased.

`GET /api/admin/provider-credits` now reads selected PostgreSQL provider
settings, retained response history and credit observations with the original
Admin permission. It uses the existing observation parser and response
formatter. The monthly filter interprets stored text timestamps as UTC,
including offsets and bare timestamps, and ignores invalid values. An actual
HTTP parity test loaded identical fictional D1/PostgreSQL histories: held,
completed, released and ambiguous outcomes; three providers; same-time
observations; month boundary, offset, space-separated and invalid timestamps.
The full response objects matched, including internal controls and observation
history. The GET did not write an audit row. PostgreSQL POST fails closed before
attestation, refresh or provider calls. This does not authorize any provider
account operation or real-data transfer.

`POST /api/admin` now handles `rename_programme` and
`set_programme_status` in PostgreSQL after the existing `MANAGE_USERS` check.
The row is locked, and the update plus unchanged audit action/metadata commit
in one transaction. Repeated status changes retain the D1 behavior of a new
audit event. HTTP tests cover 401/403, validation and confirmation errors,
missing IDs, repeated/concurrent requests, audit rollback, and D1 equivalents.
All other Admin POST actions remain D1-only. The separate unconverted route
can still produce raw SQL in server-side development logs; touched GET/POST
HTTP responses are redacted on PostgreSQL database failure. Full Admin browser
and high-concurrency acceptance remain incomplete.
Local browser acceptance was attempted but blocked because the Mac was locked
and Work settings disabled local browser use. Admin plus Imports is not ready
for acceptance while the Worker burst issue remains open. The selected
PostgreSQL handler now also catches transaction-acquisition errors that lack
a Drizzle query property and returns a generic 5xx; D1 error behavior is
unchanged.
Step 3F TypeScript, ESLint and direct production build passed. The focused
PostgreSQL foundation, core reads, provider ledger, Admin and security group
passed 63/63. The full serial suite reported 906 tests: 885 passed, 16 skipped
and the same five previously known UI/source assertion failures. The isolated
ten-request Admin burst remains a separate acceptance failure.

## Stage 3 Worker connection blocker resolution

The Step 3F burst failure was isolated to the module-level `pg.Pool` surviving
across Cloudflare Worker request contexts. Retiring each checked-out client
after one use was insufficient. In the new baseline, 5/5 Admin GETs returned
200 in 292 ms; a ten-request burst returned one 200, five 500s and four
transport timeouts by 12 seconds, followed by a 500 after five seconds.
Four database sessions were idle after the failure. Direct Node.js pool
transactions had passed 5/10/20 previously.

The Worker entry now wraps explicitly selected PostgreSQL requests in
`AsyncLocalStorage`; the adapter lazily creates one pool for authentication
and route work within that request and closes it when the handler resolves.
It rejects PostgreSQL access outside a request scope. D1 requests do not enter
this path. The existing backend guard, pool size, one-use retirement, timeout,
transactions, permissions, routes and public responses remain unchanged.

The same disposable local Worker/PostgreSQL fixture passed Admin GET bursts
of 5/10/20 at 5/5, 10/10 and 20/20 HTTP 200, with 261/210/369 ms total
and 256/206/364 ms request p95. Three repeated ten-request bursts passed
10/10 each in 167/144/278 ms, each followed immediately by a successful
normal request. Directory ten-request, mixed Admin/Directory ten-request and
sequential Admin ten-request runs all returned 200. A cold Admin request and
401/403 authentication/authorization probes passed. `pg_stat_activity`
after each burst showed no idle Worker connection. Individual Worker pool
acquisition times were not instrumented; local HTTP latency and database
session counts are the measured evidence. The separate Neon pooler's
concurrency ceiling and any streamed-response database work still need
isolated production-like validation. Worker peak pool total/idle/waiting
counts were not exposed by this harness. A second run again passed 5/10/20
Admin requests and all repeated bursts and recoveries; the same local Worker
selected for D1 passed comparable 5/10/20 Admin bursts at 5/5, 10/10 and
20/20 HTTP 200, with a normal 200 afterward. The unchanged PostgreSQL/D1
HTTP regression suite passed 17/17, including Provider Credits parity,
programme mutation and rollback, stopped-database failure, and authorization.
Focused PostgreSQL foundation, core read, provider-credit ledger and security
tests passed 45/45; direct Node.js pool total/idle/waiting counts were zero
after its 5/10/20 transaction bursts.
TypeScript, ESLint and direct `vinext build` passed. The full serial suite
reported 906 tests: 885 passed, 16 skipped and five previously recorded
UI/source assertion failures. The existing `npm run build` wrapper cannot
launch non-executable `scripts/sites-env.sh`; direct build passed without
altering unrelated script permissions. The next Admin plus Imports batch may
proceed as isolated development work. Full application integration, real data
transfer and production cutover remain **NO-GO**.

## Consolidated Batch 1 source-derived migration matrix

This matrix records the starting point at commit `80cbf84`. `Pending` means
the PostgreSQL-selected request currently fails closed; it does not authorize
a D1 fallback. All `/api/admin` POST actions first require `MANAGE_USERS`;
the provider-company mapping action also checks `MANAGE_PROVIDER_SETTINGS`.
`/api/imports` first requires `OPERATE_PCOM`; only `execute` additionally
requires `MANAGE_USERS`. The older workspace `import` action requires both.

| Route/method and action | D1 dependency and boundary | PostgreSQL work | Audit/history and acceptance | Starting status |
| --- | --- | --- | --- | --- |
| `GET /api/admin` | Nine Admin reads | Already one PostgreSQL transaction; Admin permission | Response/role parity, load | Done |
| `GET /api/admin/lifecycle` | Lifecycle/alumni list | Already one PostgreSQL transaction; Admin permission | Filters/counts | Done |
| `POST /api/admin` `add_programme`, `rename_programme`, `set_programme_status` | Programme row plus audit | Already transactional PostgreSQL; Admin | Audit rollback, 401/403, concurrency | Done |
| `POST /api/admin` `authorize_user` | User lookup, insert/update, audit | Transaction and concurrent email guard; Admin | `user_authorized`, similar-email and confirmation responses | Done; HTTP parity |
| `POST /api/admin` `change_role`, `set_user_status` | User update, active-Admin count, audit | Locked transaction and last-Admin guard; Admin | Role/status audit, self-removal, concurrent changes | Done; HTTP parity |
| `POST /api/admin` `update_lifecycle` | Pending provider-review check, lifecycle upsert, audit | Transaction and row lock; Admin | `data_lifecycle_changed`, confirmation and review guard | Done; HTTP parity |
| `POST /api/admin` `upsert_provider_company_mapping` | Mapping read/upsert and audit in D1 batch; aliases follow | Transaction for mapping, audit and aliases; Admin and provider-settings permission | `provider_company_mapping_changed`, duplicate and alias conflict | Done; HTTP parity |
| `POST /api/admin` `correct_pre_authorization` | Disabled unlinked user deletion plus audit in D1 batch | Selected PostgreSQL returns 501 before write | Concurrent D1 requests both return 200 and emit two audits; PostgreSQL guarded transaction returns 200/404 with one audit. Resolve parity before wiring helper | Blocked |
| `POST /api/admin` `preview_mock_cleanup` | D1 inventory and SQLite `PRAGMA` integrity checks | Separate cleanup review and PostgreSQL catalog checks | Read-only inventory parity | Deferred |
| `POST /api/admin` `remove_mock_dataset`, `anonymize_alumnus` | Destructive multi-table D1 batches | Separate authorization and verified equivalence required | Historical-data retention and audit | Deferred |
| `POST /api/admin` `validate_signals_entitlement`, `validate_gmail_connectivity` | External provider calls and audit | Outside Batch 1 | No provider calls in this batch | Deferred |
| `GET /api/admin/provider-credits` | Retained settings/history/observations | Already PostgreSQL read-only | Full D1 JSON parity | Done |
| `POST /api/admin/provider-credits` and Admin provider subroutes | Provider accounting/execution and webhooks | Outside Batch 1 | No credit/provider state writes | Deferred |
| `POST /api/imports` `preview` | Alumni/programme reads; shared `validateImport` | PostgreSQL reads; same PCOM permission and JSON | CSV/XLSX/client mapping, duplicates, professional claims, report | Done; HTTP parity |
| `POST /api/imports` `execute` | Idempotency lease; D1 batches of at most 80 actions; final history/audit batch | PostgreSQL transactions preserve bounded chunks, checkpoints, lease ownership and resumable failure; Admin only | `mutation_requests`, items/guards, source observations, proposals, field history, `import_runs`, activity and security audit; replay, races, rollback | Done; disposable HTTP tested |
| `POST /api/workspace` `import` | Separate legacy Admin bulk-import loop and final history/audit writes | Original normalizer and matching with a PostgreSQL transaction; Admin only | Existing matching, protected fields, field history, import run, activity and security audit | Done; disposable HTTP parity |

The client parses CSV/XLSX and generates the CSV review report using
`lib/alumni-import.ts`; the API receives normalized record objects rather
than file bytes. `lib/mutation-idempotency.ts` is D1-specific for existing
mutation lookup, so PostgreSQL execution needs its own database-bound lookup
while sharing the current fingerprint and HTTP replay/conflict responses.
The D1 import uses `unixepoch` lease predicates, `db.batch`, scalar alumni-ID
subqueries and CHECK-constrained ownership guards; these require explicit
PostgreSQL translations. Missing-company claims must remain unverified.
The workspace import is a separate implementation with a 250-record limit,
different matching and response shape; it must not be silently redirected to
the governed import API. Baseline focused import/security tests passed 77/77.

The M2 PostgreSQL service `db/postgres/admin-local-operations.ts` now handles
the five local Admin action names above. It preserves D1 output fields,
confirmation strings and audit metadata, with one transaction per action.
Advisory transaction locks serialize user changes and mapping upserts; lifecycle
changes lock the alumnus row. The D1 branch remains intact. Fictional local
PostgreSQL/D1 HTTP checks passed 19/19, including Admin/PCOM/unauthenticated
status parity, state/audit readback, and forced Admin audit rollback with a
redacted 500 response. Destructive and external-provider
actions remain gated.
M2 TypeScript, ESLint and direct production build passed. The existing npm
build wrapper remains blocked by non-executable `scripts/sites-env.sh` (tracked
mode `100644`) and this host's missing GNU `timeout`; no build semantics were
changed.

M3 connects only `POST /api/imports` action `preview` to PostgreSQL alumni and
programme reads. The existing parser, row validator and preview digest are
shared, so file formats, mapping, reports, matching and unverified-claim rules
are unchanged. Local PostgreSQL/D1 HTTP tests passed 20/20 overall: identical
new/invalid/duplicate preview output, existing-match classification,
Admin/PCOM/unauthenticated authorization, and no PostgreSQL canonical or
history writes during preview. Admin execution is documented in M4 below.
Malformed record objects retain the D1 400 response; a forced PostgreSQL
connection failure returns a redacted 5xx with no D1 fallback. Focused
parser/mapping/idempotency/source-history tests passed 57/57, and TypeScript,
ESLint and direct production build passed.

M4 adds a PostgreSQL-only Admin execution path for the governed import. It
shares the existing preview and mutation fingerprints, preserves the lease,
80-action chunk boundaries and row checkpoints, fences updates by record
version, and atomically commits each chunk and final import-run/activity/audit
batch. A failed final audit leaves committed chunks resumable with the same
request key; a failed history insertion rolls back its chunk. The D1 execution
path is untouched. Disposable HTTP checks cover the D1 response and replay
contract, confirmation/stale-preview gates, PCOM denial, unverified claims,
20-row chunking, competing requests, forced history/audit failure and retry,
concurrent PCOM previews/Admin reads, and stopped-database redaction.

M5 adds the separate legacy workspace import path to PostgreSQL using the
source normalizer, 250-row bound, source matching and approved-update rules.
The PostgreSQL transaction includes alumni, field history, import-run,
activity and security audit writes and shares the workspace manual-entry
advisory lock. Disposable HTTP checks match the D1 create, skip and approved
update response contract and verify role/validation gates, state and audit
readback, and forced audit rollback. The local HTTP suite passed 27/27; the
full source suite and Worker burst diagnostic are separate checks.

Batch 1 final checks: the serial full suite reported 916 tests, 895 passed,
five previously known UI/source assertion failures and 16 skipped. No new
failure remained after avoiding parallel Vite port contention. TypeScript,
ESLint and direct `vinext` build passed. The normal npm build wrapper still
cannot execute tracked `scripts/sites-env.sh` (mode `100644`) and this host
has no GNU `timeout`; no build semantics changed. The repository has no
import-focused browser test and Playwright is unavailable, so import browser
acceptance is unverified. PostgreSQL Admin bursts of 5/10/20 passed in
176/160/306 ms, three repeated ten-request bursts recovered, and mixed
Admin/PCOM preview requests passed. Post-burst `pg_stat_activity` showed only
the observer's active session. D1 5/10/20 bursts passed. With a per-request
pool maximum of five, 20 simultaneous requests could theoretically demand
100 sockets; Neon pooler and production-scale behavior remain unverified.
Production cutover remains NO-GO.

### Remaining selected-PostgreSQL route work after Batch 1

Stage 3 continuation: `POST /api/intelligence/bright-eligibility/revalidate`
has a PostgreSQL alumni/lifecycle read branch behind the unchanged service
bearer credential. Disposable PostgreSQL/D1 HTTP checks passed 28/28,
including service-authentication denial, selected-state eligibility,
missing-record parity and stopped-database redaction. The legacy workspace import's
failure path remains an acceptance blocker: D1's sequential writes can
persist earlier changes after a late failure, whereas the PostgreSQL
transaction rolls them back. The successful request contract is covered by
the prior local D1/PostgreSQL HTTP comparison; exact failure-state parity
would require an unsafe partial-commit implementation.

`GET` and `POST /api/professional-verification` now have selected-PostgreSQL
paths. They retain `OPERATE_PCOM`, the shared verification validator, the
existing evidence response and confirmed-update response. The PostgreSQL
POST locks the alumnus row and commits state, field history and security
audit in one transaction. D1 remains unchanged. Disposable PostgreSQL/D1
HTTP acceptance passed 29/29, including 401/400/404/409 gates, evidence
readback, response-field parity and a forced audit rollback.

`POST /api/exports` now selects PostgreSQL for both filtered Directory and
approved Admin business datasets. The PostgreSQL Directory export reads all
bounded pages through the existing Directory query; Admin export reads the
nine approved dataset tables. The formatters, authorization, row bounds and
audit path remain shared. D1 query paths remain intact. HTTP parity and
failure checks passed 30/30 in disposable PostgreSQL/D1 fixtures, including
CSV response shape, import-compatible XLSX, multi-dataset ZIP, authorization,
invalid requests, export audit rejection and stopped-database redaction. The
export reads are nonmutating; the existing audit write occurs before the
download is returned, so an audit failure returns no download.

`POST /api/discovery/intake` has a selected-PostgreSQL preflight and execute
branch using the existing PCOM permission, candidate assessment and provisional
alumnus builder. Each eligible candidate commits its alumnus, discovery link,
immutable intake snapshot and security audit in one transaction. A PostgreSQL
alumni table lock serializes identity checks against other writers while the
original D1 batch remains unchanged. Disposable PostgreSQL/D1 HTTP acceptance
passed 33/33, including preflight parity, collision, concurrent execution,
audit rollback and stopped-database redaction. Focused provisional intake
regressions passed 14/14; TypeScript and focused ESLint passed.

`GET` and `POST /api/intelligence/profile/[alumnusId]` now select the local
PostgreSQL alumni and lifecycle records before using the unchanged separate
intelligence service resolution and enrollment contracts. Disposable HTTP
acceptance passed 34/34 with a local mock service, including successful
read/enrollment, authorization and invalid input gates, D1 missing-record
parity and stopped-database redaction.

`GET /api/discovery` now selects PostgreSQL for saved searches, results,
candidate evidence, provider history and alumni reconciliation data. The
existing presentation and PCOM gate remain shared. Disposable PostgreSQL/D1
HTTP acceptance passed 36/36, including summary/pending reads, invalid and
missing IDs and database-failure redaction. Focused saved-history/Discovery
regressions passed 27/27. `POST /api/discovery` action `record_evidence` now
uses a selected-PostgreSQL transaction with a row lock on the pending result.
Reviewer validation and fingerprinting remain shared with D1; evidence and
security audit commit together. A replay returns the original row, concurrent
duplicate requests serialize on the result, and an audit failure rolls back
evidence. The disposable PostgreSQL/D1 suite passed 43/43, including invalid
reviewer-input response parity; focused evidence tests passed 8/8, and
TypeScript, focused ESLint and direct production build passed. All other
Discovery POST actions remain D1-only. The interrupted
import-confirmation 500 after a long request remains an unresolved acceptance
blocker for that workflow, despite three clean repeated disposable HTTP suites.

`POST /api/discovery` action `plan` reads the selected PostgreSQL saved-search
history and uses the shared advisory coverage calculator. It makes no provider
request and charges no application units. Disposable PostgreSQL/D1 HTTP
acceptance passed 44/44, including exact response parity for an unsearched
fictional query, authorization and no provider work. TypeScript, focused
ESLint, Discovery planner/run tests (45/45), and the direct production build
passed. Other POST actions remain D1-only.

`POST /api/discovery` action `regular_search_preflight` now uses a selected-
PostgreSQL provider-company mapping lookup and the existing local Search
preparation contract. It performs no provider request, result write or credit
debit. The confirmed execution action remains D1-only.
Disposable PostgreSQL/D1 HTTP acceptance passed 45/45, including the invalid
year gate, unmapped-company fallback, PCOM authorization and exact D1 response
parity. One D1 fixture run took 492 seconds without a failed assertion. The
HTTP harness now logs requests exceeding 10 seconds, without changing
timeouts or assertions. The cause of the delay and earlier PostgreSQL import
confirmation 500 remains unresolved.
The timed rerun passed 45/45 in about 53 seconds with no slow-request marker.
`POST /api/outreach-route` now uses selected PostgreSQL alumni, relationship
and engagement rows with the existing recommendation rules and response
fields. Activity and security audit commit together on PostgreSQL. A forced
audit failure rolls back activity; the D1 legacy path writes those entries
sequentially. Disposable PostgreSQL/D1 HTTP acceptance passed 46/46 with
exact warm/direct/no-route response parity, authorization and forced audit
rollback.
Outreach-focused route tests passed 26/26; TypeScript, focused ESLint and the
direct production build passed.
`GET /api/admin/coresignal-collect` now reads selected PostgreSQL retained
Search/Preview candidate state, prior Collect claims and current application
capacity. It preserves Admin authorization and provider gates and makes no
provider call. POST claim and execution paths remain D1-only. The disposable
credit fixture's invalid retained timestamp is counted by the legacy
text-date capacity query, producing zero remaining application units.
The retained Preview candidate fixture checks eligible/conflicting results
and an ambiguous prior claim against the unchanged D1 response.
The intermittent import overlength-key check now verifies the exact 400
response body for stronger failure diagnosis; no timeout or contract changed.
The disposable two-row workspace import collision test establishes D1's
earlier-row persistence (400, first alumnus retained) versus PostgreSQL's
transaction rollback (redacted 500, no alumnus). This failure-path difference
is a functional-equivalence blocker; no transaction guarantee was weakened.
Disposable PostgreSQL/D1 HTTP acceptance passed 48/48 with the exact
overlength-key 400 response and the workspace collision probe. The D1 fixture
subtest took 33 seconds. TypeScript, focused ESLint, 30/30 Collect unit tests,
and the direct production build passed for this checkpoint.

`GET /api/opportunities` reads filtered opportunities, support lists, summary
and history from selected PostgreSQL. POST/PATCH now use that read serializer
for their linked-alumnus, owner and history projections. The PostgreSQL
mutations preserve existing validation, idempotency and version contracts;
opportunity, operational history and security audit commit together. A
missing `await` in the first route dispatch was corrected after the initial
HTTP failure exposed it. Disposable PostgreSQL/D1 HTTP acceptance passed
49/49, including response projection parity, duplicate and concurrent
creation, stale-version rejection, forced create/update audit rollback and
401/403 authorization and stopped-database redaction. Opportunity regressions passed 15/15; TypeScript
and focused ESLint passed.
The full serial regression then completed with 917 passes, five previously
known UI/source assertion failures, 16 skips and no repeat `SIGTRAP`.
Enrichment PATCH now selects PostgreSQL for Admin provider-limit updates;
setting and audit commit together. Disposable PostgreSQL/D1 HTTP acceptance
passed 50/50, including Admin-only access, validation, repeated PATCH
response parity, stored limit and audit counts, forced audit rollback and
stopped-database redaction. The legacy D1 path writes audit after the setting,
so exact audit-failure state parity is not claimed.
Enrichment POST now routes Admin `refresh_history` and `reconcile_usage` to
selected PostgreSQL. Reconciliation locks the Lusha row and commits usage and
security audit together. Other POST provider actions remain D1-only. The
disposable PostgreSQL/D1 HTTP suite passed 51/51, checking Lusha usage
transition, repeated and
concurrent reconciliation, forced audit rollback, role gates and D1 response
parity without provider calls.
Focused provider-credit and Collect regressions passed 38/38; TypeScript,
focused ESLint and the direct production build passed.
Admin `correct_pre_authorization` remains blocked under selected PostgreSQL.
Fictional HTTP tests observed simultaneous D1 correction requests both return
200, while the guarded PostgreSQL transaction returns 200 then 404. The route
returns 501 before a selected PostgreSQL write; D1 behavior is preserved. The
pending PostgreSQL helper is not wired until concurrency parity is resolved.
The disposable PostgreSQL/D1 HTTP suite passed 52/52 with the fail-closed
gate; identity and provider-credit regressions passed 14/14. TypeScript,
focused ESLint and the direct production build passed. One previously known
provider-company-mapping UI source assertion failed in the broader focused
run (21/22 passed) and was not changed.
The unconfirmed `POST /api/admin/coresignal-collect-review` branch now reads
selected PostgreSQL history and alumnus identity without provider requests or
writes. Confirmed association remains D1-only and fails closed. Fictional
PostgreSQL/D1 HTTP acceptance passed 53/53, including Admin/PCOM gates,
missing evidence, exact decision parity and no identity mutation; existing
Collect regressions passed 30/30. TypeScript, focused ESLint and the direct
production build passed.
The Collect review and selection preflight branches await their PostgreSQL
reads within the route error boundary so database failures remain redacted.
Disposable HTTP checks force both query failures and assert generic errors.
`POST /api/admin/coresignal-collect` action `selection_preflight` now reads
retained candidates and application capacity from selected PostgreSQL. It
issues no confirmation token, reservation or provider request. Fictional
PostgreSQL/D1 HTTP acceptance passed 54/54, including Admin/PCOM gates,
invalid and missing selection, ambiguous prior claim, exact plan parity,
zero new reservations and forced query failure. Single-target `preflight` and
`execute` remain D1-only.
Focused Collect regressions passed 30/30; TypeScript, focused ESLint and the
direct production build passed.
The D1 pre-authorization correction reads before its audit/delete batch and
does not inspect deleted-row count. Two concurrent requests can both return
200 with success audit, while PostgreSQL's locked helper returns 200/404.
Reproducing D1's second success would record a deletion that did not occur;
the helper remains inactive. Legacy workspace import also commits each row
before the import-level history and audit. Its later-row collision therefore
retains an earlier row without import-level audit; the PostgreSQL atomic
transaction differs and exact failure-path acceptance remains blocked.
`POST /api/admin/provider-credits` action `attest` now writes a human supplied
balance observation to selected PostgreSQL security audit and returns the
existing snapshot. It does not alter application reservations or call a
provider. Fictional PostgreSQL/D1 HTTP acceptance passed 53/53, including
Admin/PCOM gates, invalid observation rejection, one audit insert and exact
snapshot parity. `refresh` remains D1-only under PostgreSQL selection.
Focused provider-credit ledger regressions passed 8/8; TypeScript, focused
ESLint and direct production build passed.
The first full serial regression after these checkpoints reported 921 passes,
six failures and 16 skips. A diagnostic rerun reported 921 passes, the five
known UI/source assertion failures and 16 skips. The PostgreSQL HTTP subtest
took about 235 seconds on the rerun; the first run's extra failure and the
long-running import behavior remain unproven. No SIGTRAP occurred, and no
timeout or assertion was weakened.
The legacy D1 opportunity path writes security audit after its
opportunity/history batch; PostgreSQL rolls back all three writes on a forced
audit failure. Exact D1 failure-path equivalence remains unproven.

`GET /api/engagements` now selects PostgreSQL for the workspace's saved
events, people, consent preferences, templates, responses and activity. The
existing presentation is shared. HTTP acceptance passed 38/38 in disposable
PostgreSQL/D1 fixtures, including event and owner
readback, authorization and stopped-database redaction. Focused engagement
regressions passed 26/26. At that checkpoint POST actions were D1-only; the
current twelve local action routes and their acceptance are recorded above.

`GET /api/enrichment` now selects PostgreSQL provider settings, monthly usage,
history and Admin review evidence. It preserves D1's creation of missing
default provider settings in a transaction. PATCH now has selected PostgreSQL
support with atomic audit; POST remains D1-only.
Disposable PostgreSQL/D1 HTTP acceptance passed 39/39, including monthly
usage parity, role-restricted history, concurrent default-setting creation
and stopped-database redaction. Provider-credit regressions passed 8/8.

`GET /api/admin/bright-data` now selects PostgreSQL attempt metadata and
application capacity with the existing sanitized presentation. POST actions
remain D1-only. Disposable PostgreSQL/D1 HTTP acceptance passed 40/40,
including Admin authorization, saved attempt metadata, capacity and
database-failure redaction; Bright Data regressions passed 14/14.

`GET /api/intelligence/webhooks` now selects PostgreSQL subscriptions,
notifications and active coverage with the existing role-based redaction.
POST actions and the receiver remain D1-only. Disposable PostgreSQL/D1 HTTP
acceptance passed 42/42, including authorization, invalid page, role
redaction, saved coverage and stopped-database redaction; focused webhook
regressions passed 10/10.

The shared fixed-cohort resolver and dynamic CN selection evaluator now use
the selected PostgreSQL alumni and Directory query. They serve refresh
preview, inactive job creation and saved-policy reconciliation without
changing their selection contract or separate intelligence service calls.
Disposable PostgreSQL/D1 HTTP acceptance passed 35/35 for dynamic manual
inclusion, fixed-cohort exclusion, authorization and stopped-database
redaction; the existing selection unit tests passed 6/6. Saved-policy
reconciliation and concurrent policy creation remain untested.

Source reconciliation of all 35 API route files found 57 exported HTTP methods.
The full direct regression run reported 908 passes, six failures and 16
skips. Five are the previously known UI/source assertions; the atomic
mutation file crashed during the parallel run but passed 5/5 in isolation.
No UI source or assertions were changed to alter these outcomes.
The current full serial run reported 912 passes, the same five UI/source
assertion failures and 16 skips; the parallel crash did not recur.
The final serial run after Search preflight reported 913 passes, those five
assertions, 16 skips and a Node native `SIGTRAP` during Corporate
Opportunities test-file cleanup. That file passed 15/15 in isolation. The
native crash remains a test-runtime limitation; no source or assertion was
changed to hide it.
Inactive CN refresh-policy creation and saved-policy reconciliation now have
local mock-service HTTP acceptance coverage. The complete disposable
PostgreSQL/D1 HTTP suite passed 41/41 on three serial runs. One earlier run
returned 500 rather than the established 400 for the PostgreSQL overlength
Idempotency-Key import gate after a 467-second import subtest. It preceded the
new policy subtest. The cause is unresolved, so import failure-path acceptance
remains blocked; neither timeout nor assertion was changed.
At that earlier checkpoint, the 35 route files exported 57 HTTP methods. Source inspection
classifies 43 methods as selected-PostgreSQL compatible, eight as partial
(`POST /api/admin`, `POST /api/discovery`, `POST /api/workspace`,
`PATCH /api/workspace`, `POST /api/enrichment`,
`POST /api/admin/coresignal-collect-review`,
`POST /api/admin/provider-credits`, `POST /api/admin/coresignal-collect`)
and six as D1-only.
Compatibility includes proxy methods with PostgreSQL-backed authorization; it
is not a count of completed HTTP acceptance. The six D1-only methods are:
`POST /api/admin/bright-data`;
`GET /api/alumni/[id]/history`;
`POST /api/engagements`;
`POST /api/intelligence/webhooks`; `POST /api/signals`; and
`POST /api/webhooks/coresignal/[subscriptionId]/[token]`. These are spread
across 13 route files when the partially integrated methods are included.
The intelligence discovery, readiness, saved-job detail, run list and review
proxy routes use PostgreSQL-backed authorization but no local application
database query. Refresh preview, job creation and reconciliation use the
selected shared CN selection/cohort utilities; their remaining external
service branches need independent HTTP acceptance, not a D1 SQL conversion.
The Admin action matrix above also identifies the remaining methods of
partially integrated `/api/admin` and `/api/admin/provider-credits`.

Database-dependent utility work outside Batch 1 remains in
`lib/placement-relevance-sql.ts`,
`lib/coresignal-identity-store.ts`, `lib/coresignal-search-id-store.ts`,
`lib/provider-company-mapping-store.ts`, `lib/coresignal-collect-only.ts`,
`lib/lusha-request-guard.ts`, `lib/lusha-identity-review.ts`, and
`lib/lusha-contact-review.ts`, plus each route's direct SQL and `env.DB`
usage listed in the first table. Existing PostgreSQL-specific adapters and
shared security/import helpers are described in their checkpoint sections.
