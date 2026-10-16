# Alumni import scale acceptance

Measured on macOS with Node v22.22.0 on 2026-10-16. Each run used a fresh SQLite database in `/private/tmp`, applied all 15 repository migrations, inserted deterministic fictional records generated with seed `20261016`, and then repeated the insert to verify idempotency. These are isolated local measurements, not production SLOs.

| Measurement | 1,000 alumni | 10,000 alumni |
| --- | ---: | ---: |
| CSV size | 312,662 bytes | 3,119,003 bytes |
| Companies | 25 | 250 |
| Parse | 21.710 ms | 156.795 ms |
| Validation and preview | 27.147 ms | 171.000 ms |
| Transactional SQLite insert | 38.463 ms | 372.355 ms |
| Heap delta | 1,967,992 bytes | 31,243,056 bytes |
| Persisted alumni | 1,000 | 10,000 |
| Distinct profile keys | 1,000 | 10,000 |
| Duplicate profile keys | 0 | 0 |
| Foreign-key violations | 0 | 0 |
| Rows after identical retry | 1,000 | 10,000 |

## Query timings

Values are the median and p95 of 20 local executions, in milliseconds.

| Query | 1,000 median / p95 | 10,000 median / p95 |
| --- | ---: | ---: |
| Directory initial page | 0.156 / 0.307 | 3.137 / 3.877 |
| Name search | 0.385 / 0.437 | 5.512 / 11.482 |
| Company filter | 0.033 / 0.041 | 0.032 / 0.044 |
| Function filter | 0.149 / 0.164 | 3.335 / 9.673 |
| Graduation-year filter | 0.150 / 0.176 | 3.653 / 4.592 |
| Programme filter | 0.138 / 0.162 | 3.790 / 4.848 |
| Combined filters | 0.045 / 0.060 | 0.042 / 0.071 |
| Final pagination page | 0.303 / 0.365 | 6.290 / 7.272 |
| Company association summary | 0.116 / 0.144 | 1.227 / 1.426 |
| Alumnus profile by ID | 0.092 / 0.108 | 0.142 / 0.208 |

No provider request, provider credit, email, webhook, remote D1 access or canonical provider-evidence mutation occurred. The complete reports remain local test artifacts outside Git. The scale harness uses the actual schema and persists all rows; it does not claim that the browser downloads all 10,000 rows or that the entire Admin execution is one D1 transaction.

## Cloudflare local D1 acceptance

A separate Wrangler persistence directory was migrated through `0014` and populated only with synthetic local identities and programme options. The server-authoritative import route was then exercised through the local Worker runtime with all provider and mail gates disabled.

- A 12-row confirmed import persisted 12 distinct alumni; a stale preview returned HTTP 409 with zero alumni/import-run writes; an identical reviewed replay created zero alumni.
- A 10,000-row preview reported 9,988 new and 12 unchanged records in 3.04 seconds wall time.
- Confirmed execution imported the remaining 9,988 records in 10.41 seconds wall time, leaving exactly 10,000 alumni and 10,000 distinct profile keys with zero foreign-key violations.
- The initial multi-value insert exposed D1's bound-parameter ceiling. Execution now uses batches of 50 individual, idempotent insert statements through `db.batch`, avoiding a large multi-row parameter list.
- A warmed, isolated `/api/workspace` request over the 10,000-row state completed in 1.85 seconds wall time. During a cold responsive-browser run, concurrent workspace/API fan-out made individual development-server requests take as long as 46.1 seconds. This confirms correctness but not acceptable interactive performance at 10,000 rows. Loading the complete workspace collection is the principal scale blocker; server-side directory pagination and bounded tab-specific payloads remain required before claiming 10,000-row browser readiness.

Read-only query timing over the isolated D1 SQLite state (25 executions, median / p95 milliseconds): directory `3.537 / 4.464`, name `5.294 / 5.869`, company `0.022 / 0.036`, programme `3.555 / 4.053`, graduation year `3.737 / 4.383`, combined `0.023 / 0.078`, deep pagination `4.956 / 5.725`, and company associations `0.850 / 0.897`.
