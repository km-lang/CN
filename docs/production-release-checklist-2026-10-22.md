# Corporate Network production release checklist — 2026-10-22

Decision: retain D1. This is a preparation record, **not** authorization to deploy, change hosted D1, enable providers, send email, or start subscriptions.

## Source candidate and safe defaults

- Current local source includes the Lusha pending-identity-review checkpoints `5bcec2184c38a53c7dd23a957e9c0057d7597772` and `69bbaf6e70024a2d620b9afe30952571779ebbb6`. The seven one-time Coresignal Preview-trial paths were preserved in a recoverable local stash. Only the generic isolated-D1 path forwarding line was retained in `vite.config.ts`; the six trial-only paths and their hard-coded request exception/UNKNOWN-entitlement bypass are excluded from the production package. The general bounded Preview implementation remains independently gated and off by default.
- `.openai/hosting.json` identifies project `appgprj_6a9708aa009c8191a2108b303a300678` with D1 binding `DB`. This manifest alone does not prove current Sites connection ownership or hosted D1 state. Never copy local D1, fixtures, secrets, provider snapshots or backup dumps into the source package.
- Leave Coresignal Collect, Bright Data live Trigger, Lusha live operations, Gmail sending, real webhooks, automatic scheduling and PDL disabled by default. Provider credentials belong in protected host configuration, not Git. Preserve Admin/PCOM server-side authorization, consent, audit, one-request fences and human identity review.

## Required owner/Sites evidence before release

1. Confirm owner-level Sites project/database administration access for project `appgprj_6a9708aa009c8191a2108b303a300678` and binding `DB`. Native read access recovered in the previous investigation; browser ownership or Viewer access alone does not establish an export/restore operation.
2. Obtain a **complete, transactionally consistent and restorable export or platform snapshot** of the exact production D1, its binding identity, authoritative migration ledger and schema, plus the supported restore procedure. The observed **24-table** production schema matches the 0009 snapshot names/columns; the release schema has **44 tables** and migrations **0010–0026** are not present in production. A table count is not a migration ledger. No documented complete Sites backup/restore route has yet been established by OpenAI Support. Record a checksum and independently restore to an isolated database before any hosted write.
3. Compare the restored production ledger/schema and records with tracked `drizzle/` migrations. Rehearse the missing ordered `0010`–`0026` migrations against that restore, preserving production alumni and history; `0019`–`0026` have been applied to the original **local** D1, not the hosted D1. Resolve any divergent schema or ledger before constructing a hosted migration command. A synthetic rehearsal alone does not prove production recovery.
4. Record before/after counts and hashes for alumni, identities, discovery searches/results, provider history, audit, import/source observations, Bright Data evidence, cohort and webhook tables. Run integrity and foreign-key checks; verify Search/history reconstruction and authorized roles on the restored copy.
5. Prepare a rollback that restores the exact verified hosted export and prior source version; specify who can execute it, downtime window and evidence retention. Do not use a local-demo database as rollback material.

## Controlled release acceptance after separate approval

- Review the exact source diff, dependency lockfile, hosting manifest and secret-exposure scan; then separately approve source publishing and any exact production migration plan.
- Verify owner/Admin/PCOM authentication, unauthorized 401/403, Directory/profile/history, saved discovery, provider-history redaction, cohorts, imports/exports and credit dashboard against the **actual** hosted D1. Use approved non-sensitive fixtures only where writes are necessary; never import local synthetic demo records into production by default.
- Treat previously intermittent local saved-history 500s as unresolved until a recurrence is diagnosed; new correlation IDs and sanitized stages support evidence collection. A passing reload is not a proven permanent fix.
- Activate each external provider independently after key-specific entitlement, host permission, account billing/usage evidence and exact request approval. Coresignal Search credits do not prove Collect access; application reservations are not provider charges. Do not enable PDL.

Release gate: **NO-GO**. Publishing the 44-table release source against the 24-table production D1 is incompatible. The blocking capability is a Sites-supported complete backup/restore (or isolated clone) of the exact hosted D1 with an authoritative ledger; without it, migration and rollback cannot be safely verified. Do not deploy or migrate merely because local 0026 and the finalized baseline's 829 passing tests are healthy. Provider activation has separate gates and cannot be inferred from source tests.
