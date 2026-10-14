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

The regular Search response parser and routing planner are implemented, deterministic, and provider-free. Regular Search transport/runtime activation is not wired.

### Exact-year ES-DSL

`coresignalExactYearEsDslSearchContract` implements an exact nested education-year request strategy. The builder is dormant and absent from normal discovery entry points. Current runtime still treats post-Collect education validation as authoritative where exact-year proof is required.

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

