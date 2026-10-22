# Corporate Network

Corporate Network is an internal alumni intelligence and engagement platform for the Placement Committee. It brings together canonical alumni records, company targeting, outreach and engagement, data import, enrichment, provider evidence, human review, and controlled external alumni discovery.

Provider output is evidence, not canonical truth. Corporate Network owns its institutional alumni record and never silently overwrites it from a provider response.

## Current status (2026-10-22)

**Implemented** means code exists; **mock-tested** means provider-free fixtures exercised it; **locally live-verified** means an actual local browser/database or explicitly identified provider operation was observed. None of these means deployed or accepted on the current production Sites database.

- **Local application:** Directory/profile management, Admin/PCOM navigation and authorization, discovery evidence/review/history, Company Intelligence, engagement/outreach, opportunities, scoring/cohort previews, and governed CSV/XLSX import/export have local browser and/or isolated-D1 acceptance. Write-oriented acceptance used synthetic data; it did not prove production operation.
- **Provider operations:** real Coresignal Search/ES-DSL Preview and one isolated Bright Data Trigger → Snapshot retrieval have retained local evidence. Coresignal Collect, Lusha V3 Search/Enrich, real webhook subscriptions/events, and Gmail sending are implemented or mock-tested but **not live-verified** in their intended environment. External entitlement, billing, callback, or send-scope requirements still block activation. PDL is excluded from active execution; historical evidence is preserved.
- **Identity and contact safety:** provider responses remain evidence until governed review. Lusha V3 Search stores even an exact-URL contact ID as pending Admin identity review. Email-only and phone-only Reveal responses are now retained as separate Admin-restricted contact proposals; neither changes the canonical alumnus automatically. An Admin must approve each value independently, with stale-identity, privacy, conflict, and explicit-replacement checks. See [Providers and safety](docs/providers.md).
- **Lusha browser acceptance:** a loopback-only, disposable-D1 V3 mock transport has exercised the actual Chrome UI for Search, Admin identity approval, separate Email/Phone Reveal and approval, a mismatched-identity rejection, failed transport, and PCOM denial. Authenticated negative checks rejected stale/duplicate approvals and confirmed PCOM history, Directory response, and CSV export redaction. Mock history records zero application units and no provider charge; the browser made no Lusha request. This is **browser-tested with fictional responses**, not a live Lusha entitlement or billing test. The mock gate requires development Admin auth, loopback, a temporary D1 path, and `LUSHA_LIVE_ENABLED=false`; it is disabled in production and by default.
- **Coresignal Preview trial boundary:** the seven one-off Lincoln/2011/PGP trial paths were retained in a recoverable local Git stash. Their hard-coded request scope and UNKNOWN-entitlement exception are **not** part of the default application. The sole retained source change forwards the already-validated temporary isolated-D1 path to the local worker for local-only workflows; it does not enable a provider. The general ES-DSL Preview workflow remains implemented, provider-gated and off by default; a real request still requires the normal confirmed-entitlement gate, Admin confirmation and budget checks. Collect remains separately disabled.
- **Validation:** the Lusha contact-review baseline passed **849 total, 833 passed, 0 failed, 16 skipped** in the serial full suite; TypeScript, ESLint and the direct production build passed. The 16 optional tests are not passes. Local source validation is not provider-live or production acceptance.
- **Production release: NO-GO.** The Sites D1 has 24 tables versus 44 in the local release schema; migrations 0010–0026 remain pending there. A documented complete, restorable production backup/restore path and authoritative production migration ledger are unavailable. Do not publish or migrate until the exact production database can be backed up, restored and rehearsed safely. See the [release checklist](docs/production-release-checklist-2026-10-22.md).

See [Architecture](docs/architecture.md), [Providers and safety](docs/providers.md), [Local development](docs/local-development.md), and [Alumni import readiness](docs/alumni-import-readiness.md) for the detailed current-state contract.

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

Corporate Network uses Cloudflare D1/SQLite with Drizzle migrations through `drizzle/0026_green_ben_parker.sql`. The original local D1 is at 0026. The current hosted Sites database is older (24 tables, corresponding to the 0009 schema snapshot) and must not receive the 0026 source without a supported backup, ledger reconciliation, isolated restore/rehearsal and separately authorized migration.

Migration 0012 adds a partial unique index so one non-empty `coresignal_employee_id` can belong to at most one CN alumnus. The empty string remains the supported unassigned value. Migration 0012 has been validated against repository-local D1 only; this README does **not** claim staging or production migration completion.

Migration 0013 adds the provider-company mapping boundary. It stores conservative normalized company keys and provider identities with `VERIFIED`, `UNVERIFIED`, or `CONFLICT` status; `MISSING` is represented by no row. Only an Admin-verified mapping with provider ID, verifier, and verification time can enable company-constrained Search. The migration is schema-only and seeds no company data.

Generate a migration only when an approved schema change requires one:

```bash
npm run db:generate
```

## Implementation status

| Capability | Status | Notes |
| --- | --- | --- |
| CN canonical workflows and product areas | Locally verified, not production-accepted | Directory/profile, discovery review/history, company, engagement/outreach, opportunities, cohorts and administration have local or isolated acceptance. |
| CSV/XLSX import and export | Locally browser-verified | Preview/validation/confirmed import, Directory reload and both downloads were accepted with synthetic isolated-D1 records; production persistence is untested. |
| Intelligence local integration | Locally verified, currently separate/inactive | Loopback authenticated service and review UI were validated; no automatic Intelligence-to-CN writeback. |
| Coresignal Base Employee Filter Preview and selective Collect | Implemented / mock-tested; Collect not live-verified | Exact-ID Collect remains gated pending key-specific endpoint entitlement, spend ceiling and separately approved application allowance. |
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
