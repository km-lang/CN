# Alumni import readiness

Corporate Network supports governed CSV and `.xlsx` imports through the Alumni Upload workspace: PCOM and Admin can map and preview files; only Admin can execute imports. A file is parsed, normalized and matched on the server before any write. The validation preview must be reviewed and explicitly confirmed. Unresolved, duplicate and invalid rows are excluded.

## Capability inventory

| Capability | Before this milestone | Current behavior |
| --- | --- | --- |
| CSV and first-worksheet XLSX parsing | Existing, client-side | Reused with UTF-8, quoted-cell, malformed-quote, size and 10,000-row checks |
| Dry run | Client-only | Server-authoritative and non-mutating |
| Authorization | PCOM operation permission | PCOM/Admin preview; Admin-only execution is checked before mutation or idempotency replay |
| Stable source identity | Not represented | `source_system` + `source_alumni_id` map to the unique `alumni.profile_key` |
| Duplicate handling | Email, profile URL or name/year/company | Trusted identifiers can match; weak name/programme/year evidence requires review and never auto-merges |
| Existing-record updates | User-selected; protected fields partly preserved | User-selected, stale-preview revalidated, blank values never clear data, verified professional fields remain protected |
| Contact governance | Contacts imported as unverified | Contacts stay unverified; restrictions/consent are only stored when explicitly supplied and consent is never inferred |
| Large execution | 250 rows, sequential | 10,000-row maximum, bounded 50-statement D1 batches, retry-safe unique source keys |
| Row report | On-screen subset | Complete paginated review plus formula-injection-safe CSV report |

No schema migration is required. The existing schema cannot retain every raw input cell, a first-class import-run status, or a unique import digest. Row provenance is represented by the stable profile key, `source`, `discovery_source`, activity/security audit and field-change history. Large imports use bounded batches; prior successful batches remain retryable through unique profile keys if a later batch fails. This is recoverable and idempotent for alumnus creation, but it is not claimed to be a single 10,000-row atomic transaction.

## Data contract

For new records, required fields are `source_alumni_id`, `source_system`, `name`, `programme`, and `graduation_year`. Company can remain missing and unverified for professional review. Update-only mode retains its stable-identity rules. All other fields are optional.

| Import column | Required | Persisted mapping | Rule |
| --- | --- | --- | --- |
| source_alumni_id | Yes | `alumni.profile_key` with source system | Stable institutional identifier; never fuzzy matched |
| source_system | Yes | `profile_key`, `source`, `discovery_source` | Short provenance label such as `iiml-master` |
| name | Yes | `alumni.name`, derived initials | Whitespace collapsed; not used alone for automatic identity matching |
| programme | Yes | `alumni.programme` | Must match active Programme Reference Data (code or name) |
| graduation_year | Yes | `batch`, `graduation_year` | Plausible four-digit year from 1940 through current year + 10 |
| company | No | `alumni.company` | Whitespace collapsed; spelling is not fuzzy-merged |
| title | No | `title`, `raw_title` | Missing values use `Role not recorded` for a new row |
| function | No | `function` | Missing values use `Not assessed` |
| seniority | No | `seniority` | Missing values use `Not assessed` |
| industry | No | `current_industry` | Plain text |
| location | No | `location` | Missing values use `Not recorded` |
| previous_companies | No | `previous_companies` | Blank does not clear existing history |
| experience_years | No | `experience_years` | Integer 0–80 |
| linkedin_url | No | `linkedin_url` | Must be a `linkedin.com/in/...` profile; normalized to HTTPS identity form |
| email | No | `email` | Syntax validated; stored as unverified and never treated as consent |
| phone | No | `phone` | Stored as unverified; no fabricated values |
| general_contact_status | No | `alumni_privacy_controls` | Supported value only; defaults to `Unknown` |
| professional_engagement_status | No | `alumni_privacy_controls` | Supported value only; defaults to `Unknown` |
| birthday_engagement_status | No | `alumni_privacy_controls` | Supported value only; defaults to `Unknown` |
| consent_source | No | `alumni_privacy_controls` | Explicit source only; defaults to `Unknown` |
| source_date | No | `discovery_date` | ISO `YYYY-MM-DD` |
| last_reviewed_date | No | Validation/staging only | Current schema has no dedicated imported-review date |
| note | No | `note` | Maximum 1,000 characters |

Internal-only fields include database IDs, provider person IDs, confidence, provider freshness, verification states, ownership, lifecycle timestamps, audit metadata and opportunity state. Import files cannot assert those fields as verified.

## Identity and conflict rules

1. Exact stable source key (`institutional:<source-system>:<source-id>`).
2. Exact existing canonical alumnus ID when explicitly supplied.
3. Exact normalized LinkedIn profile identifier.
4. Exact email only when the existing email is already verified.
5. Name + programme + graduation year is weak evidence. It creates a likely-duplicate review outcome and never an automatic merge.

If trusted signals identify different alumni, the row is a conflict. Repeated source IDs or LinkedIn identities within the file are rejected. Missing values never clear valid stored values. Company, designation and location claims cannot overwrite fields whose corresponding verification state is not `Unverified`.

## Operating instructions

1. Start from the CSV or XLSX template. Excel must save cached cell values; formulas are not evaluated by Corporate Network.
2. Keep stable source IDs unchanged across retries and future updates.
3. Open **Alumni upload**, select the file, review the column mapping, and choose **Preview & validate**. PCOM may preview and download the report, then provides the report and source file to Admin for execution.
4. Review counts and every exception. Download the review CSV when a source-data owner needs to correct rows.
5. Select only supported existing-record changes. Unresolved rows remain excluded.
6. An Admin confirms the preview and chooses **Import reviewed records**. PCOM direct execution returns 403.
7. Record the execution summary. If execution stops mid-file, correct the failure and rerun the same file; unique source keys prevent duplicate alumnus creation.

The import does not call Coresignal, Lusha, Bright, Socai, PDL, Signals or Gmail. Provider evidence and professional claims still require their existing review-before-apply workflows.

## Real-dataset limitations

- Field names, programme values, source identifiers and consent vocabulary must be mapped against the real IIM Lucknow master data before production onboarding.
- Weak duplicates and contradictory identifiers require human resolution.
- The current schema does not store a raw immutable copy of every uploaded row or a durable preview object.
- A 10,000-row execution is recoverable in bounded batches, not one atomic D1 transaction.
- Actual data quality, match rates and production performance cannot be accepted until the real dataset is supplied and reviewed.

## Provider-free validation and separately authorized pilots

Importing and paging stored alumni never invokes a provider. Current mock regression coverage retains Coresignal Search preparation, bounded selective Collect, Employee ID identity resolution, sanitized evidence, application-unit accounting, incomplete/conflicting evidence, and review-before-apply protection. Bright eligibility and revalidation remain server-authoritative, stable-ID based, evidence-only, and fail closed for missing, changed, unverified, inactive, or conflicted professional identities. Corporate Network delegates Bright execution to the separately configured Alumni Profile Intelligence service; it does not contain a second Bright transport or canonical writeback path.

Neither pilot below is authorized by this milestone:

- **Coresignal:** one explicitly confirmed Base Employee Search using the already verified IIM Lucknow institution mapping, a one-result request ceiling, no automatic pagination/retry, and zero Collect unless separately approved. Stop for any gate/key/readiness mismatch, unexpected response contract, or uncertain credit exposure. Search evidence establishes candidates only; Collect and human review remain authoritative. Provider-reported account cost is still uncertain and must not be inferred from application units.
- **Bright:** one active alumnus with an approved public LinkedIn profile, confirmed CN identity, stable `cn:<id>` Intelligence mapping, configured Intelligence service/dataset, and a one-job budget. Preflight must show zero canonical mutations. Poll only within the existing bounded asynchronous job contract, prevent duplicate submission, normalize/compare evidence, and require human review. Stop for identity disagreement, missing dataset/account readiness, timeout, partial evidence, unexpected cost, or service authentication failure.

Any live pilot requires fresh, operation-specific authorization after credentials, account entitlement/billing, application limits, audit visibility, and rollback/stop conditions are confirmed. No live provider accuracy is claimed by the provider-free tests.

## Windows PCOM redesign acceptance

Column mappings are schema-bound; duplicate destinations and unsupported field targets fail validation. Raw headings may be inspected before mapping; ignored columns never enter canonical records. First-worksheet/cached-cell Excel behavior and malformed/oversize-file rejection are retained. Imports never mark company, designation, identity or contacts as independently verified. The new primary Directory filters do not narrow or execute external discovery.
