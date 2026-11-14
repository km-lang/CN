# Stage 3 provider accounting and concurrency decisions

This is an internal implementation map for CN-sabarinadh. D1 remains the
default. The PostgreSQL claim foundation is connected only to the isolated
local mock Collect route; it does not authorize a live provider request.

## Shared dependency map

| Phase | Coresignal Collect | Lusha V3 enrichment | Bright Data | Discovery / profile refresh | Signals |
| --- | --- | --- | --- | --- | --- |
| Entitlement and gate | `coresignalCollectEnabled` and account-specific Collect entitlement; mock transport has its own local gate | Endpoint-specific entitlement, approved per-operation ceiling, current account balance; mock is local-only | Dataset/credential, execution gate, entitlement or exact one-profile human attestation | Coresignal mode, preview/search gates and request limits | Confirmed Signals entitlement and live gate; no local provider test path |
| Durable request identity | Provider, operation and request summary in `provider_response_history`; webhook event also points to its claim | Provider, mode, alumnus and operation; unresolved live usage blocks another claim | Unique attempt `request_key`, active target and provider job ID in `provider_collection_attempts` | Search/run IDs and retained result/history; no pre-request claim for all paths | Stable Lusha contact ID and deduplicated event keys; no pre-request claim |
| Claim and reservation | One `in_progress` history row reserves 20 application units before Collect; monthly Coresignal sum is fenced with the claim | Live `in_progress` row reserves configured units; mock reserves zero; monthly live budget uses application units or recorded credits | Unique `CLAIMED` attempt consumes one monthly application request allowance; provider history is linked after claim | Several paths write history after provider response; execution must remain blocked until interruption accounting is designed | History is written after provider response; no durable pre-request reservation |
| Settlement | Success retains 20 units and unknown provider charge for reconciliation. Deterministic failure releases to zero; ambiguous failure retains the hold | Final units are at least the reservation or reported charge; unknown usage requires reconciliation. Transport/persistence ambiguity retains the hold | Attempt generation and status compare-and-set; submitted/unknown trigger remains unretried and requires reconciliation | Response history and review evidence are retained after response; provider charge may be unknown | Reported usage is recorded after response, or marked for reconciliation if absent |
| Replay and recovery | Same operation/request summary cannot be claimed twice; webhook status links to claim. No automatic retry of ambiguous Collect | Active or completed same-alumnus operation blocks duplicate; any unresolved live usage blocks new live claim; manual reconciliation is explicit | Request-key and active-target unique indexes; job ID and generation fence status/retrieve/recovery | Search evidence and candidate dedupe exist, but interrupted request/replay coverage is incomplete | Event-key dedupe protects stored events, but cannot prove request was not charged twice after interruption |
| Audit/history | Claim and outcome in provider history; review evidence/proposals and security audit follow execution | Provider history, review record, field history and security audit are distinct; Admin reconciliation writes audit | Attempt, linked history, raw/normalized evidence and security audit | Discovery and refresh history, candidate/review evidence and security audit | Engagement events, provider history and security audit after provider response |

The PostgreSQL foundation in `lib/postgres-provider-claims.ts` centralizes
provider-wide transaction serialization, duplicate and monthly-budget checks,
and compare-and-set settlement for **Coresignal Collect and Lusha V3**. It
preserves the two providers' distinct reservation formulas. It does not
replace Bright Data's attempt ledger, infer an external provider balance,
perform entitlement checks, call providers, or create an audit on its own.
Routes must complete their own gate, response, evidence, audit and interruption
tests before selecting it. Existing PostgreSQL `reconcile_usage` remains the
Lusha manual reconciliation path and keeps history and audit in one transaction.
The `postgres-collect-claim-store.ts` adapter applies the shared claim and
settlement operations to the existing Collect executor. Disposable adapter
tests passed 7/7 for mock one-request execution, ambiguous hold/replay and
webhook-event claim/release. The route selects it only for isolated local mock
execution. PostgreSQL/D1 HTTP acceptance passed 80/80, including insufficient
budget, claim failure with safe retry, concurrent one-winner execution,
ambiguous settlement with held units and no retry, deterministic release with
no second release, retained evidence/proposals, and post-commit audit failure
with the same stored state and response. Normal PostgreSQL/live execution and
downstream webhook Collect are still unavailable; the full `execute` action
is not counted as selected.

### Acceptance gate for execution

Before any live execution route selects the foundation, disposable HTTP tests must
show insufficient external balance, concurrent distinct and duplicate claims,
held units, successful consumption, deterministic release exactly once,
ambiguous retained holds, Admin reconciliation, replay after interruption,
forced claim/settlement/audit failures, no double consumption, response and
state parity with D1, and zero real provider requests. Bright Data requires
its separate attempt-ledger lifecycle tests. Discovery/refresh and Signals
need an explicit pre-request accounting design before they can be accepted.

## Proposed concurrency compatibility decisions

Neither proposal below is approved. Both PostgreSQL routes remain guarded by
`CN_PG_LOCAL_TEST_ENABLED` and fail closed outside disposable tests.

| Decision item | Lusha identity approval | Discovery `keep_separate` |
| --- | --- | --- |
| Original D1 response | Concurrent winner 200; loser 500 from unique `field_change_history` mutation-key constraint | Concurrent winner 201; loser 500 from a unique constraint in the second insert/batch |
| PostgreSQL response | Winner 200; loser sanitized 409 | Winner 201; loser sanitized 409 |
| Business state | D1 and PostgreSQL retain one approved identity association. Exact D1 history/audit query and PostgreSQL state query showed one successful mutation for the raced review | D1 and PostgreSQL retain one separately added alumnus linked to the reviewed result, with the expected profile key |
| History and audit | One field-history entry and one success audit for the winner; no second success record | One success audit for the result; PostgreSQL forced-audit failure rolled back the new alumnus and result transition |
| Replay | Completed review is rejected; a competing decision does not create a second association | Repeating the completed result returns 409; concurrent loser has no second alumnus or success audit |
| Integrity risk | Reproducing D1's raw 500 could expose a constraint name while a loser has no successful mutation; accepting an unreviewed 409 changes the concurrent API response | Same response difference; a partial alumnus/result/audit write or false success would be unacceptable |
| Recommendation | Approve a sanitized 409 only for the losing concurrent request, with one winning mutation and unchanged permission, history and provider-credit rules | Approve a sanitized 409 only for the losing concurrent request, with one winning mutation and atomic result/alumnus/audit state |

Required approval evidence remains: repeated D1/PostgreSQL races, full
before/after state and audit/history snapshots, duplicate and opposing
decisions where applicable, authorization, forced transaction and audit
failures, provider-call/credit invariants, redacted errors, and a staging
fail-closed check. The local HTTP suite already covers many of these cases;
its latest D1 state-query additions are still in the uncommitted HTTP test
draft. The two API response exceptions still require explicit user approval
before activation or commit.

## Other blockers

Collect confirmed association fails in the original D1 identity-store SQL;
the PostgreSQL prototype remains inactive. Admin preauthorization correction
has nondeterministic D1 200/200 or 200/404 concurrent responses and an inactive
PostgreSQL prototype. Legacy workspace bulk import has D1 partial-write/400
versus PostgreSQL rollback/500 semantics. The intermittent import-confirmation
500, provider-limit PATCH stall, native Node crashes and five UI/source
assertions remain separate acceptance issues. None is resolved by the new
claim foundation.
