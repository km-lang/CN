# Architecture

## Service boundaries

Corporate Network and Alumni Profile Intelligence are independent systems.

### Corporate Network

Corporate Network owns the canonical institutional alumni record in Cloudflare D1/SQLite. It provides Directory, External Discovery, Company Intelligence, Engagement, Outreach, Data Import, Enrichment, Intelligence, Administration, and Add Alumnus workflows. It also owns CN provider-identity mappings, provider provenance, application limits, and review-before-apply controls.

### Alumni Profile Intelligence

Alumni Profile Intelligence is a separate service backed by Postgres. It owns provider-evidence ingestion, immutable evidence snapshots, normalization, comparison, review cases, accepted Intelligence-side canonical state, and provider execution architecture.

The local service listens on loopback port `4310`. CN calls it server-to-server with a bearer/shared credential plus authenticated actor context. The URL and credential are server-only; browsers never receive the service secret or direct database access.

## Canonical ownership

```text
Corporate Network
  └─ authoritative CN alumnus record

Alumni Profile Intelligence
  ├─ provider evidence
  ├─ comparison and review
  └─ separately accepted Intelligence canonical profile
```

Provider evidence never becomes CN canonical truth automatically. A human ACCEPT in Intelligence updates only the Intelligence canonical profile. Local E2E acceptance explicitly verified that CN data remained unchanged. There is no approved automatic Intelligence-to-CN writeback architecture.

## Cross-service identity and eligibility

An enrolled CN alumnus uses a stable Intelligence `sourceId` of `cn:<CN alumnus ID>`. Enrollment is server-authoritative and idempotent. It requires approved professional-profile evidence and refuses ambiguous or conflicting identities; name-only permanent matching is prohibited.

Before Bright execution for an enrolled CN identity, Intelligence revalidates CN authority through an authenticated internal CN route. Eligibility fails closed when the source ID, lifecycle, profile verification, professional-conflict state, or normalized LinkedIn identity no longer agrees. Equivalent safe LinkedIn URL representations normalize to the same identity; a genuinely changed slug returns `LINKEDIN_CHANGED`. Missing identity is explicitly excluded.

Local eligibility, mapping, enrollment, revalidation, and preview perform no provider call.

## Review semantics

Evidence and canonical state remain separate throughout the workflow:

```text
provider evidence
  → immutable snapshot
  → deterministic normalization/comparison
  → review case
  → preview decision
  → explicit ACCEPT / REJECT / KEEP_IN_REVIEW
  → audit history
```

REJECT records the decision without canonical mutation. ACCEPT may update only the approved Intelligence fields and accepted snapshot inside the audited Intelligence transaction. Unresolved or stale evidence cannot be accepted. Neither action writes the CN canonical record.

## Corporate Network database

D1 migrations are additive and the repository currently runs through `0026_green_ben_parker.sql`. The original local D1 is at 0026; the hosted D1 is not assumed to be at the same version. Migration 0012 adds:

```sql
CREATE UNIQUE INDEX idx_alumni_coresignal_employee_id_unique
ON alumni (coresignal_employee_id)
WHERE coresignal_employee_id != '';
```

This guarantees uniqueness only for assigned Coresignal Employee IDs while preserving the empty-string unassigned representation. It has been validated on repository-local D1, not claimed as applied to staging or production.

Migration 0013 adds `provider_company_mappings` without altering existing alumni data. One conservative normalized company key can have at most one mapping per provider, and one non-empty provider company ID cannot silently map to multiple company identities for that provider. Persisted states are `VERIFIED`, `UNVERIFIED`, and `CONFLICT`; no row means `MISSING`. Verified rows require provider identity plus server-recorded verifier and verification timestamp. Mapping mutations are Admin-only and use the central security audit for before/after history.

Company-constrained Coresignal Search accepts a human-readable company name only. The server normalizes and resolves it, validates the Coresignal ID as a positive safe integer, and fails closed before transport for every state except `VERIFIED`. A verified mapping adds one same-row current/non-deleted experience clause to the established same-row IIML/year education clause. Seniority remains local, Search is one bounded request with no automatic pagination or Collect, and no canonical field is changed.

## Provider identity

CN alumnus ID, Coresignal Employee ID, professional-profile URL, Lusha contact ID, and Intelligence source ID belong to different identity namespaces.

The Coresignal attachment boundary:

- prefers an already known unique provider ID;
- uses an exact normalized LinkedIn identity only when attaching a previously unknown provider ID;
- records ambiguous and conflicting evidence for review;
- blocks name-only attachment;
- uses a conditional database write plus the migration-0012 uniqueness constraint;
- reloads authoritative state after write races;
- never silently reassigns an ID or overwrites CN LinkedIn data.

## Operational behavior

- Opening pages and dialogs does not call a provider.
- Provider calls require authenticated roles, server-side credentials, independent live gates, application limits, and explicit confirmation.
- Service outages return an explicit unavailable response; CN remains operational and does not pretend Intelligence work succeeded.
- Stored-data pagination and local filtering do not invoke providers.
- Responsive behavior is accepted at desktop, tablet, and narrow mobile widths.

