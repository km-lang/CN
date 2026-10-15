# Corporate Network

Corporate Network is an internal alumni intelligence and engagement platform for the Placement Committee. It brings together canonical alumni records, company targeting, outreach and engagement, data import, enrichment, provider evidence, human review, and controlled external alumni discovery.

Provider output is evidence, not canonical truth. Corporate Network owns its institutional alumni record and never silently overwrites it from a provider response.

## Current status

- **Corporate Network:** feature-complete for local acceptance; full suite, lint, type-check, production-equivalent build, and responsive acceptance pass.
- **Alumni Profile Intelligence integration:** full local cross-service E2E verified, including mapping, enrollment idempotency, eligibility, revalidation, review decisions, persistence, invalid authentication, and service-unavailable handling.
- **Responsive UI:** validated at 1440, 1280, 768, 390, and 360 pixels. Low-priority polish may remain.
- **Release:** provider-gated staging and production release are pending. Local acceptance is not production approval.

See [Architecture](docs/architecture.md), [Providers and safety](docs/providers.md), and [Local development](docs/local-development.md) for the detailed current-state contract.

## Product areas

- Overview
- Alumni Directory and Add Alumnus
- External Discovery
- Company Intelligence
- Engagement and Outreach
- Data Import
- Enrichment
- Intelligence
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

Corporate Network uses Cloudflare D1/SQLite with Drizzle migrations through `drizzle/0012_superb_wildside.sql`.

Migration 0012 adds a partial unique index so one non-empty `coresignal_employee_id` can belong to at most one CN alumnus. The empty string remains the supported unassigned value. Migration 0012 has been validated against repository-local D1 only; this README does **not** claim staging or production migration completion.

Generate a migration only when an approved schema change requires one:

```bash
npm run db:generate
```

## Implementation status

| Capability | Status | Notes |
| --- | --- | --- |
| CN canonical workflows and product areas | Active / validated | Local functional and responsive acceptance complete. |
| Intelligence local integration | Active / validated | Loopback authenticated service and review UI verified. |
| Coresignal Base Employee Filter Preview and selective Collect | Implemented / provider-gated | Explicit live gate, bounded application limits, review before apply. |
| Coresignal Employee ID persistence and Search-ID deduplication | Active domain capability | Durable identity and bulk indexed lookup. |
| Coresignal Base Employee ES-DSL Search transport | Implemented / disabled by default | Nested IIM Lucknow institution ID 25919228 is live-verified; institution-only or institution + exact-year mode; independent `CORESIGNAL_SEARCH_ENABLED` server gate, explicit confirmation, one request, zero retry/pagination, no automatic Preview/Collect. Exact-year live semantics remain unconfirmed. |
| Regular Search response parser and routing planner | Implemented behind disabled Search gate | Parses one page, deduplicates IDs, and routes identity without canonical mutation. |
| Exact-year ES-DSL request builder | Implemented behind disabled Search gate | Provider-free structure is validated; live exact-year semantics remain unconfirmed. |
| Coresignal Real-Time Employee API | Frozen | Previous attempt was unauthorized; later guidance said the API is unavailable. |
| Coresignal webhooks | Future / support-dependent | No implementation or confirmed entitlement. |
| Bright execution architecture | Implemented / provider-gated | Secondary, fallback, or corroborating evidence; not primary freshness authority. |
| PDL | Historical support | Existing provenance remains readable; it is not the current primary strategy. |
| Lusha Contacts and Professional Signals | Implemented / independently gated | Contact and signal workflows remain separate from professional-profile evidence. |
| Institutional Gmail | Implemented / independently gated | Mock/off by default; live sending requires all mail safety gates. |
| Production deployment | Pending | Requires staging, rollback, security, and release approval. |

## Safe local start

```bash
npm ci
npm run local:setup
npm run dev:local
```

`npm run dev:local` is the provider-free loopback path. It enables development-only local authentication and forces Coresignal, Base Employee ES-DSL Search, Lusha Contacts, Professional Signals, and live mail off.

An explicitly authorized, one-result Coresignal demonstration can use `npm run dev:local:coresignal-live`. That command is intentionally live-provider enabled and must not be used without approval, a server-only key, and confirmation that consuming a provider operation is acceptable.

Detailed commands, environment-variable names, macOS build guidance, and Intelligence startup are in [Local development](docs/local-development.md).

## Validation

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

- A selected Intelligence detail may require reselect/reload immediately after a decision to display the persisted state.
- During an Intelligence outage, the unavailable notice can coexist with empty-list copy.
- Mobile navigation affordance could be stronger.
- Enrichment remains information-dense.

These are P2 polish items, not local P0/P1 blockers.

## Release preparation remaining

Provider work still requires account and entitlement confirmation, server-side credentials, commercial/credit confirmation, explicit live-gate approval, and controlled live acceptance. Release work still requires isolated staging configuration, secret setup, migration and rollback validation, provider-gated staging acceptance, security/release-readiness approval, and production release authorization.

## Documentation maintenance

Any milestone that changes architecture, schema semantics, provider behavior or status, setup/environment, operational or user-facing workflows, or release status must update the relevant README/docs in the same milestone. If no documentation change is needed, the milestone report must say why.
