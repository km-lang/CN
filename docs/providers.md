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

## Coresignal

### Current Base Employee flow

The provider-gated runtime uses Base Employee Filter Preview followed by selective stable-ID Collect:

```text
POST /cdapi/v2/employee_base/search/filter/preview
  → preview candidates / IDs
  → local reconciliation and qualification
GET /cdapi/v2/employee_base/collect/{employee_id}
  → collected evidence
  → exact local validation
  → review before add/apply
```

Authentication uses the server-only `apikey` header. The application supports company and explicit role/function narrowing, multi-select seniority with authoritative local OR semantics, programme qualification, exact graduation-year verification from returned non-deleted IIML education, deleted-record safeguards, and explicit ambiguity for multiple current roles.

Preview fields are not treated as proof that unavailable evidence was returned. Search criteria are never reconstructed as education facts.

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

The regular Search response parser, routing planner, and one-request transport boundary are implemented. Runtime Search remains disabled by default behind the independent server-only `CORESIGNAL_SEARCH_ENABLED=false` gate, in addition to the normal Coresignal live gate and server-only API key. Opening External Discovery or its confirmation does not call the provider.

The controlled path performs exactly one `POST /cdapi/v2/employee_base/search/es_dsl` request, parses the documented ID body and pagination headers, deduplicates IDs, and routes them against durable Corporate Network identity. It has zero automatic retries and never follows `x-next-page-after`. It does not automatically call Filter Preview or Collect, create alumni, attach unknown IDs, or mutate canonical professional/contact fields. Explicit UI confirmation shows the provider, operation, `items_per_page`, one-request cap, provider constraints, and zero Preview/Collect operations.

### Institution-only and exact-year ES-DSL

`coresignalEmployeeEsDslSearchContract` supports either institution-only Search or institution plus an optional exact graduation year. Its compatibility wrapper, `coresignalExactYearEsDslSearchContract`, continues to require a year. A bounded live diagnostic confirmed the nested `education` structure and `education.institution_id=25919228` for IIM Lucknow: the provider reported 35,103 matches and returned one ID with `items_per_page=1`. That count is provider-reported Search coverage, not a verified alumni count. The prior `education.institution_url` diagnostics returned zero and that field is no longer used by ES-DSL Search; the URL remains valid for Filter Preview, Collect normalization, evidence, and display.

For the ES-DSL path, only `is_parent=1` and the verified IIM Lucknow provider institution ID are always sent. The exact `education.date_to_year` term is included in the same nested education filter only when the user supplies a valid four-digit graduation year. Institution matching is live verified. Exact-year Search is **live verified for the IIM Lucknow 2011 case**: one controlled app-originated request placed `education.institution_id=25919228` and `education.date_to_year=2011` in the same nested education filter, used `items_per_page=1`, and received HTTP 200 with `x-total-results=927`. The first returned ID routed to `IDENTITY_RESOLUTION_REQUIRED`; profile freshness remained `NOT_EVALUATED`. The run made zero Preview, Collect, pagination, retry, or Bright calls and caused zero identity attachments and zero canonical mutations.

The provider-reported 927 matches establish support for that Search field combination; they are not a verified count of IIML 2011 alumni. This evidence does not establish equivalent institution mappings elsewhere, complete year population, alumni qualification, or profile freshness. Both Search modes continue to require the independent provider gates and explicit confirmation, issue at most one request, and perform no automatic pagination, Filter Preview, or Collect. Programme, seniority, company, role/function, location, deleted-record interpretation, and qualification remain conservative local concerns unless a provider constraint is separately validated. Other institutions require their own verified provider identity; IDs must not be guessed. Post-Collect evidence and human review remain authoritative.

The controlled exact-year response reported `x-credits-remaining=4950`. That account-balance signal does not establish the cost of the request, so regular Search must not be described as free; exact provider cost remains unresolved. Saved Collect evidence still does not support Bharani as an active exact-2013 case: the active IIML row has null year fields, while 2013 appears only on a deleted legacy row.

### Dormant current-company diagnostic

**CURRENT COMPANY ES CONTRACT: LIVE-SUPPORTED FOR THE CONTROLLED LINCOLN DIAGNOSTIC ONLY.** One controlled Base Employee ES-DSL Search combined IIM Lucknow (`education.institution_id=25919228`) with a single nested `experience` row containing `experience.company_id=8469989`, `experience.is_current=1`, and `experience.deleted=0`. With no graduation-year constraint and `items_per_page=1`, the request returned HTTP 200, the first Employee ID `1696198` (known locally as Bharani Kumar R), and `x-total-results=8`. The eight matches are provider-reported Search coverage, not eight verified alumni or evidence that every returned profile is current.

This result supports the joint nested predicate for the Lincoln International diagnostic; it does not independently prove each experience field in isolation, establish company IDs for other employers, establish profile freshness, or make current-company Search product-ready. `coresignalCurrentCompanyEsDslDiagnosticContract` remains dormant, with no UI, route, or automatic runtime integration. A null `date_to` remains deliberately excluded because saved evidence contains non-current employment with no end date.

The remaining core Search validation is IIM Lucknow plus `education.date_to_year=2011` plus the Lincoln current-company predicate in their respective nested rows. That combined batch-and-company query has not been executed. Shruti Chaturvedi (Employee ID `289351894`) is the preferred controlled case because saved Collect evidence contains active IIM Lucknow education ending in 2011 and a current, non-deleted Lincoln row with company ID `8469989`; this evidence does not guarantee that a future Search will return Shruti first. Current-company Search must remain unexposed in normal External Discovery until the combined validation and subsequent product wiring are separately completed.

The controlled company diagnostic again reported `x-credits-remaining=4950`. This does not establish that Search is free; exact provider request cost remains unresolved. The request performed zero retries, pagination, Preview, or Collect calls and caused zero identity attachments or canonical mutations.

### RTAPI and webhooks

Real-Time Employee API work is frozen: a controlled attempt was unauthorized and later provider guidance said the API is currently unavailable. It is not active or recommended.

Webhooks are not implemented and entitlement is unconfirmed. A future selective design may be:

```text
stored Employee ID
  → optional subscription for an explicit cohort
  → change signal
  → relevance decision
  → optional selective Collect
  → compare
  → human review
```

Monitoring must remain selective. Possessing an Employee ID does not subscribe an alumnus. Future cohorts may use placement relevance, priority company, seniority, active outreach, manual selection, or other explicit rules. No plan entitlement is assumed.

## Bright Data

The separate Intelligence service has a technically validated, bounded Bright execution pipeline with retry safety, immutable evidence, comparison, and review. Controlled validation proved that evidence reached review without automatic CN mutation.

Observed live evidence was stale relative to known current professional data. Bright is therefore positioned as secondary, fallback, or corroborating evidence—not the primary freshness authority and not the preferred continuous-monitoring solution for the entire alumni population.

## PDL

PDL remains historical/existing provenance and compatibility support. Historical PDL evidence stays readable, but new professional discovery strategy is Coresignal-led; documentation and UI must not present PDL as the primary current provider.

## Lusha and Professional Signals

Lusha owns contact identity, selective email/phone enrichment, and Professional Signals. Its contact and signal gates are independent from Coresignal and mail. Existing channel-specific confirmation, DNC, usage-reconciliation, and provenance controls remain in force.

## Mail

Institutional Gmail is independently gated and mock/off in ordinary local development. Live sending requires the Gmail sender/OAuth configuration, `MAIL_MODE=live`, `MAIL_LIVE_ENABLED=true`, and confirmed send-scope authorization. Preparing or reviewing a draft does not send mail.

