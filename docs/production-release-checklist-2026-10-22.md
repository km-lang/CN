# Corporate Network production release checklist — 2026-10-22

Decision: retain D1. This is a preparation record, **not** authorization to deploy, change hosted D1, enable providers, send email, or start subscriptions.

## Source candidate and safe defaults

- Current source is the existing checkpoint plus the separately reviewed provider-free fixes recorded in `FUNCTIONAL_FIX_REGISTER.md`. Keep the seven uncommitted, one-time Lincoln Preview trial paths out of the production source candidate; the general bounded Preview implementation is distinct from that trial gate.
- `.openai/hosting.json` identifies project `appgprj_6a9708aa009c8191a2108b303a300678` with D1 binding `DB`. This manifest alone does not prove current Sites connection ownership or hosted D1 state. Never copy local D1, fixtures, secrets, provider snapshots or backup dumps into the source package.
- Leave Coresignal Collect, Bright Data live Trigger, Lusha live operations, Gmail sending, real webhooks, automatic scheduling and PDL disabled by default. Provider credentials belong in protected host configuration, not Git. Preserve Admin/PCOM server-side authorization, consent, audit, one-request fences and human identity review.

## Required owner/Sites evidence before release

1. Reconnect the native Sites integration as the **owner** account, or ask Sites Support to reconcile the project's owner account/workspace and connector `project_not_found`/zero-Sites result for the project ID and `network.teamsynapse.app`. Viewer access and public URL reachability are not database administration.
2. Obtain a **complete, restorable export** of the exact production D1, its database/binding identity, migration ledger and schema. The owner-visible table count is not a migration ledger. Record export checksum and independently restore it to an isolated D1.
3. Compare the restored production ledger/schema with tracked `drizzle/` migrations. Apply only the missing ordered migrations in an isolated restore first; `0019`–`0026` are present in source and applied to original **local** D1, but must not be assumed missing or present in production. Resolve any divergent schema or ledger before constructing a hosted migration command.
4. Record before/after counts and hashes for alumni, identities, discovery searches/results, provider history, audit, import/source observations, Bright Data evidence, cohort and webhook tables. Run integrity and foreign-key checks; verify Search/history reconstruction and authorized roles on the restored copy.
5. Prepare a rollback that restores the exact verified hosted export and prior source version; specify who can execute it, downtime window and evidence retention. Do not use a local-demo database as rollback material.

## Controlled release acceptance after separate approval

- Review the exact source diff, dependency lockfile, hosting manifest and secret-exposure scan; then separately approve source publishing and any exact production migration plan.
- Verify owner/Admin/PCOM authentication, unauthorized 401/403, Directory/profile/history, saved discovery, provider-history redaction, cohorts, imports/exports and credit dashboard against the **actual** hosted D1. Use approved non-sensitive fixtures only where writes are necessary; never import local synthetic demo records into production by default.
- Treat previously intermittent local saved-history 500s as unresolved until a recurrence is diagnosed; new correlation IDs and sanitized stages support evidence collection. A passing reload is not a proven permanent fix.
- Activate each external provider independently after key-specific entitlement, host permission, account billing/usage evidence and exact request approval. Coresignal Search credits do not prove Collect access; application reservations are not provider charges. Do not enable PDL.

Release gate: **NO-GO** until the owner/Sites-supported restorable export, exact production ledger/schema, isolated migration rehearsal and rollback are verified. Provider activation has separate gates and cannot be inferred from source tests.
