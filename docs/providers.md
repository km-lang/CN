# Providers and safety

## Safety model

Provider-free local development is the default. Each live provider has an independent server-side gate and secret. Browser state cannot enable a provider. Application limits are not provider-account balances, and unknown provider usage is not fabricated as zero.

All provider workflows preserve these rules:

- evidence is separate from canonical truth;
- review precedes application of changed professional data;
- no silent overwrite;
- retries and timeouts are bounded;
- provenance and sanitized provider-response history are retained;
- identity namespaces are not conflated;
- no secret is returned to or logged by the browser.

Status in this document is environment-specific: source/mocks do not establish current key entitlement, a live provider charge, or production deployment. The latest Lusha identity-review checkpoints are `5bcec2184c38a53c7dd23a957e9c0057d7597772` and `69bbaf6e70024a2d620b9afe30952571779ebbb6`; their latest reported serial validation was 831 passed, 0 failed, 16 skipped.

## Coresignal

### Current Base Employee flow

The repository retains a separately gated Base Employee Filter Preview and selective stable-ID Collect path. Normal External Discovery uses the ES-DSL Preview path described below; it does **not** automatically chain Preview to Collect:

```text
POST /cdapi/v2/employee_base/search/filter/preview
  → preview candidates / IDs
  → local reconciliation and qualification
GET /cdapi/v2/employee_base/collect/{employee_id}
  → collected evidence
  → exact local validation
  → review before add/apply
```

Authentication uses the server-only `apikey` header. The application supports company and explicit role/function narrowing, multi-select seniority with authoritative local OR semantics, programme qualification, exact graduation-year verification when returned non-deleted IIML education is available, deleted-record safeguards, and explicit ambiguity for multiple current roles. Base Employee Collect is **not** live-verified for the currently configured key; Search/Preview access does not establish Collect entitlement or a maximum debit.

Preview fields are not treated as proof that unavailable evidence was returned. Search criteria are never reconstructed as education facts.

Every live External Discovery run targets the guarded `POST /cdapi/v2/employee_base/search/es_dsl/preview` contract, including institution-only and company-only searches. The separately confirmed ID-only Search action remains a distinct workflow; External Discovery never silently falls back to Search/Collect. Preview correlates `education.institution_id=25919228`, optional `education.date_to_year=<year>`, and optional `education.program` `match_phrase` alternatives inside one nested education row. PGP, MBA, PGDM, ABM/PGP-ABM, PGP-SM, and IPMX/Executive MBA are distinct selectable categories; multiple selections are OR alternatives while year and institution remain AND constraints on that same row. A manually supplied exact label uses the same phrase operator but remains review-only unless it matches a known qualification rule. MBA and PGDM never establish PGP equivalence. A selected company prefers a server-side `VERIFIED` numeric mapping and correlates `experience.company_id`, `experience.is_current=1`, and `experience.deleted=0`. When no verified numeric mapping exists, it instead uses `experience.company_name.exact`. Selected seniority levels narrow the same current, non-deleted experience row through conservative `experience.title` phrases; Base Employee has no dedicated seniority field, and returned title classification remains the authoritative second layer. Exact-name matching does not create or verify a provider-company mapping; returned identity evidence remains subject to human review.

Each confirmed request retrieves one page of at most 20 Preview candidates. The official Base Employee OpenAPI contract supports `page=1..50`; the application never advances automatically and never retries. Each additional page requires a separate Admin confirmation and one available application unit, retains the page/request provenance on the original search run, performs zero Collect operations, and omits Employee IDs already stored for that run. The vendor workbook states 20 search credits per Preview page; provider-account reconciliation remains separate from the application budget.

Operational access is now verified for the configured local key. On 2026-10-19 one authorized `POST /cdapi/v2/employee_base/search/es_dsl/preview` request correlated `education.institution_id=25919228` and `education.date_to_year=2011`, returned HTTP 200, 20 bounded Preview rows, `x-total-results=927`, and `x-credits-remaining=4930`. It made zero retries, pagination, fallback, or Collect requests. The limited rows contained identity/current-role summary fields but no education objects, so query acceptance is provider-constraint provenance rather than person-level degree evidence or freshness proof. Sanitized evidence is retained in `docs/provider-evidence/coresignal-es-dsl-preview-2026-10-19.md`.

The successful response establishes operational endpoint access, not an exact billing tariff or a permanent contractual guarantee. Additional retained local live Preview evidence includes Search #13's genuine zero-result response; zero results are not by themselves a software defect. Live execution remains off by default behind `CORESIGNAL_ES_DSL_PREVIEW_ENABLED=false`; the normal runtime also requires its independent Search gate and `CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT=confirmed`. Entitlement must not be inferred for a different key or runtime. The confirmation UI discloses the workbook's expected 20-search-credit page cost while marking the actual account debit unverified. Mock tests may exercise the full application flow without provider use. The seven one-use Preview-trial paths were preserved in a local Git stash. Only a generic, guarded isolated-D1 path forwarding line from `vite.config.ts` was retained; the hard-coded Lincoln/2011/PGP scope, trial flag and UNKNOWN-entitlement exception are absent from the shipping runtime.

### Durable identity

`coresignal_employee_id` is the provider identity. Migration 0012 ensures one non-empty ID maps to at most one alumnus. `attachCoresignalIdentity` combines this constraint with normalized LinkedIn reconciliation, ambiguity/conflict results, evidence history, and no name-only attachment.

### Search-first readiness

The provider-independent regular Search processing path is implemented:

```text
regular Search response
  → validate and normalize Employee IDs
  → deduplicate the page
  → bounded bulk indexed lookup
  → IDENTITY_RESOLVED
     or IDENTITY_RESOLUTION_REQUIRED
     or IDENTITY_REVIEW_REQUIRED
```

`IDENTITY_RESOLVED` means only that the provider identity maps uniquely. It does not mean `PROFILE_FRESH` or `NO_REFRESH_NEEDED`; freshness remains `NOT_EVALUATED`. An unknown Employee ID also does not automatically mean a new alumnus.

The regular Search response parser, routing planner, and one-request transport boundary are implemented. Provider-free preflight and confirmation remain available while live Search is disabled so operators can inspect the resolved contract safely. Runtime Search remains disabled by default behind the independent server-only `CORESIGNAL_SEARCH_ENABLED=false` gate, in addition to the normal Coresignal live gate and server-only API key. Opening External Discovery, preparing a contract, opening its confirmation, or cancelling does not call the provider.

The controlled path performs exactly one `POST /cdapi/v2/employee_base/search/es_dsl` request, parses the documented ID body and pagination headers, deduplicates IDs, and routes them against durable Corporate Network identity. It has zero automatic retries and never follows `x-next-page-after`. It does not automatically call Filter Preview or Collect, create alumni, attach unknown IDs, or mutate canonical professional/contact fields. Explicit UI confirmation shows the provider, operation, `items_per_page`, one-request cap, provider constraints, and zero Preview/Collect operations.

### Institution-only and exact-year ES-DSL

`coresignalEmployeeEsDslSearchContract` supports either institution-only Search or institution plus an optional exact graduation year. Its compatibility wrapper, `coresignalExactYearEsDslSearchContract`, continues to require a year. A bounded live diagnostic confirmed the nested `education` structure and `education.institution_id=25919228` for IIM Lucknow: the provider reported 35,103 matches and returned one ID with `items_per_page=1`. That count is provider-reported Search coverage, not a verified alumni count. The prior `education.institution_url` diagnostics returned zero and that field is no longer used by ES-DSL Search; the URL remains valid for Filter Preview, Collect normalization, evidence, and display.

For the ES-DSL path, only `is_parent=1` and the verified IIM Lucknow provider institution ID are always sent. The exact `education.date_to_year` term is included in the same nested education filter only when the user supplies a valid four-digit graduation year. Institution matching is live verified. Exact-year Search is **live verified for the IIM Lucknow 2011 case**: one controlled app-originated request placed `education.institution_id=25919228` and `education.date_to_year=2011` in the same nested education filter, used `items_per_page=1`, and received HTTP 200 with `x-total-results=927`. The first returned ID routed to `IDENTITY_RESOLUTION_REQUIRED`; profile freshness remained `NOT_EVALUATED`. The run made zero Preview, Collect, pagination, retry, or Bright calls and caused zero identity attachments and zero canonical mutations.

The provider-reported 927 matches establish support for that Search field combination; they are not a verified count of IIML 2011 alumni. This evidence does not establish equivalent institution mappings elsewhere, complete year population, alumni qualification, or profile freshness. Both Search modes continue to require the independent provider gates and explicit confirmation, issue at most one request, and perform no automatic pagination, Filter Preview, or Collect. Programme, seniority, company, role/function, location, deleted-record interpretation, and qualification remain conservative local concerns unless a provider constraint is separately validated. Other institutions require their own verified provider identity; IDs must not be guessed. Post-Collect evidence and human review remain authoritative.

The controlled exact-year response reported `x-credits-remaining=4950`. That account-balance signal does not establish the cost of the request, so regular Search must not be described as free; exact provider cost remains unresolved. Saved Collect evidence still does not support Bharani as an active exact-2013 case: the active IIML row has null year fields, while 2013 appears only on a deleted legacy row.

### Verified current-company contract and fail-closed product wiring

**CURRENT COMPANY ES CONTRACT: LIVE-SUPPORTED FOR THE CONTROLLED LINCOLN DIAGNOSTIC ONLY.** One controlled Base Employee ES-DSL Search combined IIM Lucknow (`education.institution_id=25919228`) with a single nested `experience` row containing `experience.company_id=8469989`, `experience.is_current=1`, and `experience.deleted=0`. With no graduation-year constraint and `items_per_page=1`, the request returned HTTP 200, the first Employee ID `1696198` (known locally as Bharani Kumar R), and `x-total-results=8`. The eight matches are provider-reported Search coverage, not eight verified alumni or evidence that every returned profile is current.

This result supports the joint nested predicate for the Lincoln International diagnostic; it does not independently prove each experience field in isolation, establish company IDs for other employers, or establish profile freshness. A null `date_to` remains deliberately excluded because saved evidence contains non-current employment with no end date.

The combined batch-and-company contract is now **live-supported for the controlled IIM Lucknow 2011 + Lincoln case**. One request kept `education.institution_id=25919228` and `education.date_to_year=2011` in the same nested education row, and kept `experience.company_id=8469989`, `experience.is_current=1`, and `experience.deleted=0` in the same nested experience row. It returned HTTP 200, `x-total-results=1`, and Employee ID `289351894`, known locally as Shruti Chaturvedi. This is strong controlled evidence for the institution + batch + current-company Search concept, but is not universal verification for other companies, years, institutions, or records. Search still does not establish profile freshness, exact alumni identity, or alumni qualification.

The controlled company diagnostic again reported `x-credits-remaining=4950`. This does not establish that Search is free; exact provider request cost remains unresolved. The request performed zero retries, pagination, Preview, or Collect calls and caused zero identity attachments or canonical mutations.

### Provider company identity design

Migration 0013 implements a durable `provider_company_mappings` boundary. Company names remain stored directly on alumni and `company_priorities` remains independent. Mapping normalization trims outer whitespace, collapses internal whitespace, and lowercases the key; it does not strip punctuation, infer aliases, fuzzy-match, or reuse per-person `current_company_id` evidence as authority.

The mapping record contains the normalized key, display name, provider, provider company ID, status, source/evidence reference, verification actor/time, and optional provider source ID/URL. The provider company ID is unique per provider, and one normalized company key resolves to at most one mapping per provider. `MISSING` is absence of a row; stored records are `UNVERIFIED`, `VERIFIED`, or `CONFLICT`. Only `VERIFIED` enables Search, and Coresignal IDs must also pass positive-safe-integer validation. Admin manages mappings; PCOM can consume verified mappings but cannot mutate them. Changes are recorded in central security audit with meaningful before/after context.

The first controlled mapping is Lincoln International → Coresignal company ID `8469989`, supported by company source ID `22432`, `https://www.linkedin.com/company/lincoln-international`, controlled Collect evidence, and the two bounded live Search diagnostics. No other company mapping is inferred. The safest durable identity path remains an Admin-maintained set of manually verified mappings for priority companies. The exact-name Preview fallback is a search constraint only: it never creates or verifies a mapping and cannot by itself establish company identity. New mappings should come from reviewed Collect evidence or, later, a separately validated company-resolution capability if entitlement and contract are established. Name-only or fuzzy automatic mapping remains prohibited.

### Dormant Company lookup capability

The local Company Master Directory reuses `provider_company_mappings`, `provider_company_aliases`, local alumni organizations, and company priorities. It performs no provider request while an operator types. A saved selection sends only an internal mapping key; the server reloads the mapping, validates its status and Coresignal ID, and chooses either the verified `experience.company_id` predicate or the existing exact-name fallback. Browser-supplied provider IDs are never accepted.

Official documentation reviewed on 2026-10-20 documents Company Search and Search Preview at `/cdapi/v2/company_multi_source/search/es_dsl` and `/cdapi/v2/company_multi_source/search/es_dsl/preview`. The documented Preview example searches `company_name`; its response includes `id`, `company_name`, `professional_network_url`, `website`, `unique_domain`, `size_range`, `employees_count`, `industry`, `hq_country`, `company_logo`, and `_score`. The general rate-limit page lists Company Search at 18 requests/second, while the credits page says Company Search consumes search credits. These are provider service limits, not application authorization or a confirmed account tariff.

The repository has no evidence that this account is entitled to Company Search or Preview, no validated cache/licensing terms, and no evidence that a Company API record ID is interchangeable with Base Employee `experience.company_id`. The dormant provider-free adapter therefore remains disabled. Future activation requires explicit Admin authorization, confirmed account entitlement and billing, licensing/cache rules, and a controlled compatibility test before any returned ID can become a verified mapping. Sources: `https://docs.coresignal.com/company-data/api/search-preview`, `https://docs.coresignal.com/api-introduction/credits`, and `https://docs.coresignal.com/api-introduction/rate-limits`.

The implemented flow is: select company and optional graduation year → resolve the normalized CN company identity server-side → block before transport for missing/unverified/conflicting/invalid mappings → show explicit confirmation for a verified mapping → run one bounded ES-DSL Search using only the verified company ID, same-row current/non-deleted experience terms, and same-row IIML/year education terms → route IDs. Any later Collect remains separately human-approved and bounded, followed by local evidence validation and human review. Seniority remains local ranking/qualification and is never added to the provider Search predicate. Search matches remain `SEARCH_MATCH`, not verified alumni or fresh profiles, and cause no automatic canonical mutation.

The Search default is five and the hard maximum is twenty, subject to any stricter configured cap. Collect remains a separate human-confirmed step, targeted to default one and maximum five in the next workflow. Confirmation shows the CN company name and `Verified` mapping state, year, IIM Lucknow, Base Employee ES-DSL operation, one-request/result bounds, zero automatic pagination/Collect/canonical update, and that seniority is applied locally. Raw provider IDs remain Admin/debug evidence rather than the normal operator summary.

### RTAPI and webhooks

Real-Time Employee API work is frozen: a controlled attempt was unauthorized and later provider guidance said the API is currently unavailable. It is not active or recommended.

Base Employee Experience webhook intake now has a local-first, mock-only implementation. It reuses the authoritative `cn-selection-v1`/`cn-placement-relevance-v1` cohort contract, exact saved Coresignal Employee IDs, independent Admin attestations, and the existing Collect evidence/review path. Additive migrations 0023–0025 create subscription, attestation, coverage, operation, and notification tables with explicit source provenance. The original local D1 has been migrated through 0026; the hosted D1 has not been reconciled or approved for these migrations. No live subscription is active.

```text
saved Employee ID + Admin attestation
  → explicit dynamic/fixed cohort preview and bounded mock activation
  → authenticated, retained change signal (no claimed new company/role)
  → explicit Admin mock Collect preflight (10 estimated credits)
  → one event-scoped fenced mock Collect, retained evidence and comparison
  → existing human review; no automatic canonical update
```

Monitoring remains selective. Possessing an Employee ID does not subscribe an alumnus. A saved Employee ID must be independently attested as a Base Employee ID; provisional and conflicting identities are excluded. The UI is Intelligence → Employment Signals. PCOM can view monitoring and inbox; only Admin can attest, prepare, mock-activate, reconcile, renew/stop, review and approve a mock Collect. The mock transport requires development Admin auth, loopback host, an **existing absolute isolated D1 persistence directory under the OS temporary directory** in `LOCAL_DEV_D1_PERSIST_PATH`, and `CORESIGNAL_WEBHOOK_MOCK_TRANSPORT=true`; event Collect additionally requires the existing mock Collect gate. The Vite dev binding resolves symlinks, forwards these flags only under those guards, and binds to loopback. No live subscription transport is wired, and provider requests/credits remain zero in this implementation.

The receiver is disabled unless `CORESIGNAL_WEBHOOK_RECEIVE_ENABLED=true` and a secret of at least 32 characters is set as `CORESIGNAL_WEBHOOK_CALLBACK_SECRET`. Its URL carries a per-subscription HMAC token; it bounds JSON bodies and batches, ignores replays in a bounded window, quarantines unknown IDs, and retains signals without Collect or canonical writes. No provider callback-signature contract was found in official documentation, so the token mechanism is a local security boundary, not a claim of provider-signed authenticity. Live activation is fail-closed until the exact Base subscription creation payload/callback authentication, account entitlement, public HTTPS endpoint, provider response shape, billing and explicit user authorization are verified. Do not put the callback token in logs or query strings.

The support email reports webhook subscriptions/notifications are free; this is not a verified account debit. A full-record profile Collect is reserved at a 20-credit ceiling. Both known-ID and event-specific Collect paths reserve 20 application-budget units atomically and cannot repeat a claimed request. This reservation is not evidence of actual provider credits charged or the provider account balance. No automatic Collect, Search, retry, pagination, renewal or onboarding occurs. The provider's weekly notification cadence is separate from CN's inactive monthly calendar policies.

Official contract references reviewed 2026-10-20: `https://docs.coresignal.com/api-introduction/webhooks.md`, `https://docs.coresignal.com/api-introduction/webhooks/experience-webhooks.md`, `https://docs.coresignal.com/api-introduction/webhooks/subscription-management.md`, `https://docs.coresignal.com/release-notes/november-2025.md`, and `https://docs.coresignal.com/api-introduction/rate-limits.md`. The Base ID endpoint is `/v2/subscriptions/experience_changes/employee_base/ids` under the provider's `/cdapi` path. Multi-source Employee webhook examples must not be assumed to define the Base request body.

## Bright Data

Corporate Network retained one authorized local Bright Data Trigger → Progress → Snapshot retrieval for a single LinkedIn URL in an isolated D1, with Admin attempt/history and raw plus normalized provenance. No automatic CN identity link or canonical update occurred. The separate Intelligence service also has a technically validated bounded Bright pipeline, but is a separate, currently inactive deployment. A completed earlier snapshot is not proof that a new Trigger is entitled or accepted in production.

Observed live evidence was stale relative to known current professional data. Bright is therefore positioned as secondary, fallback, or corroborating evidence—not the primary freshness authority and not the preferred continuous-monitoring solution for the entire alumni population.

The one-time local human-attested trial does **not** mark dataset entitlement as provider-confirmed. It is available only to a development Admin on loopback with a separately configured isolated temporary D1, live Bright credential, explicit trial flag, and exact configured LinkedIn target. The Admin `attest_human_trial` action records dashboard source/date, dataset, normalized target, quantity one, public rate, billing uncertainty, actor, and pending-confirmation status in the security audit. A subsequent `preflight` with `humanTrial=true` signs a five-minute confirmation for that audit record and a deterministic request key. The unique audit key permits only one attestation in that isolated D1; the existing unique provider attempt key and active-target fence permit at most one claimed trigger. No automatic retry, polling, second profile, alumni link, or canonical mutation is authorized. The ordinary unknown-entitlement path remains blocked. The public $1.50/1,000-record rate and dashboard-reported free allowance do not establish the account's actual charge or token-level dataset entitlement.

Bright Data snapshot fidelity uses additive migration 0026. The Admin-only `brightdata_snapshot_evidence` table retains the single original provider JSON object (maximum 512 KB), its SHA-256, snapshot/dataset/request and retrieval provenance, provider timestamp exactly as returned, URL comparison outcome, normalizer version, and normalized output. The raw JSON is never sent in the Admin attempt list, alumni history, exports, fixtures, or logs; only audit metadata and normalized evidence are displayed. A regional two-letter LinkedIn host can match the same case-normalized `/in/` slug, while different slugs and unrelated hosts remain non-matches. Identity URL match alone never links an alumnus or verifies current employment. Raw source evidence has a 90-day retention deadline; an Admin must explicitly run `purge_expired_raw_evidence` after that deadline to remove expired raw rows. This is a manual local retention control, not a background purge guarantee. A separately confirmed `recover_evidence` action may append raw evidence from an existing unlinked, completed snapshot; it never triggers a new collection or creates a second attempt.

## PDL

PDL is excluded from active integrations. Existing PDL discovery rows, provider evidence, audit history, and identity fields remain readable for provenance, but cannot drive new discovery, alumni intake, profile updates, or engagement actions. Do not configure a PDL key, enable its live gate, use it as a fallback, or list it as an activation dependency.

## Lusha and Professional Signals

Lusha V3 Contact Search, selective email/phone Enrich and Professional Signals are implemented and provider-free tested, **not currently live-verified** for the configured key. Search uses one contact input; Enrich is separately authorized and sends `waterfallEnabled: false` so account Data Waterfall does not invoke additional providers. No Search result alone reveals contact channels or creates an alumnus.

Search retains the returned contact ID, actual returned LinkedIn URL, name/role summary, reported billing and request provenance in provider history, then creates a pending `provider_refresh_reviews` identity case. Even an exact normalized URL match makes **zero canonical changes** at Search time. An Admin must explicitly approve a single eligible review; the database operation checks the original alumnus and record version, URL identity, one returned contact, pending review status and cross-alumnus contact-ID uniqueness atomically. Ambiguous, mismatched, missing-URL, duplicate or stale evidence cannot be silently attached. Admin rejection retains evidence and makes no canonical change. These safeguards were checkpointed in `5bcec2184c38a53c7dd23a957e9c0057d7597772` and `69bbaf6e70024a2d620b9afe30952571779ebbb6`; no migration or original-D1 edit was needed.

The guarded live path requires a protected `LUSHA_API_KEY`, explicit live gate, operation-specific entitlement with source/date, per-operation application-unit ceiling, fresh account usage/balance, role permission and confirmation. Atomic claims prevent duplicate/concurrent overspend; unresolved or over-ceiling charges retain capacity rather than becoming zero. A user-reported one-credit key cap and public one-credit Search pricing do **not** prove hard concurrent billing enforcement or account-specific V3 entitlement. The last controlled live attempt stopped before transport; no current V3 Search/Enrich charge or response is recorded. Historical Lusha activity on another key/environment does not establish this key's access. Contact Search and channel Enrich need separate live acceptance.

## Mail

Institutional Gmail is independently gated and mock/off in ordinary local development. Live sending requires the Gmail sender/OAuth configuration, `MAIL_MODE=live`, `MAIL_LIVE_ENABLED=true`, and confirmed send-scope authorization. Preparing or reviewing a draft does not send mail.

The locally tested send fence retains the original action key after a timeout, incomplete receipt or uncertain post-send persistence; it must not silently retry or claim that an unknown outcome was undelivered. Live OAuth/send-scope setup, approved recipient and an explicitly authorized controlled send remain outstanding. No production Gmail send has been accepted.

