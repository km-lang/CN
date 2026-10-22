# Local development

## Provider-free Corporate Network

Requirements: Node.js 22.13 or newer and the repository dependencies.

```bash
npm ci
npm run local:setup
npm run dev:local
```

`local:setup` applies migrations to isolated local D1 and loads deterministic fixtures. `dev:local` listens on loopback port 3000, enables only the development authentication path, forces Coresignal/Lusha/Signals gates off, and keeps mail in mock mode. It requires no production secret and must never use a production D1 binding.

For a separately isolated local D1, an Admin may put an existing Lusha key in the gitignored `.env.local` as `LUSHA_API_KEY=...`, using a local editor rather than a shell argument or chat message. Restrict that file to the local user (`chmod 600 .env.local`). Set `LOCAL_DEV_D1_PERSIST_PATH` to an existing temporary-directory checkout of the isolated D1, and leave `LUSHA_LIVE_ENABLED=false`, `LOCAL_LUSHA_LIVE_DEMO_ENABLED=false`, `LUSHA_SIGNALS_LIVE_ENABLED=false`, and endpoint entitlements `unknown`. A prepared per-operation ceiling does not itself enable live execution. The local Vite worker receives the key only for an Admin session with that isolated D1; this permits credential-presence checks without calling Lusha. A future live test requires both explicit live flags, source/date-backed per-operation entitlements, account usage, ceilings and separate authorization for its exact request. Never set an entitlement to `confirmed` merely to pass preflight.

The original local D1 was migrated through 0026; a fresh isolated D1 can be set up using the existing local workflow. For an **isolated** checkout that specifically needs tracked migrations, Wrangler uses the configured local persistence path:

```bash
npx wrangler d1 migrations apply DB --config wrangler.local.jsonc --local --persist-to .wrangler/state
```

Do not add `--remote`, substitute the original D1 path, or assume this command is a production migration procedure. Migration 0013 seeds no mappings. Use the Admin provider-company mapping workflow for local acceptance data; only a verified mapping authorizes a numeric company-ID predicate. The supported exact-name Preview fallback remains unverified identity evidence. Lincoln International (`Coresignal` ID `8469989`, source ID `22432`) is the controlled live-evidenced numeric example. Provider-free development keeps all execution gates off.

## Local Intelligence integration

Alumni Profile Intelligence is a separate repository and Postgres-backed service. From that repository:

```bash
npm run service:local
```

The service is loopback-only by default on port 4310. Configure the same long local shared credential on both services with server-only variables:

```text
INTELLIGENCE_SERVICE_URL=http://127.0.0.1:4310
INTELLIGENCE_SERVICE_SECRET=<local shared secret>
```

Intelligence also needs its local `DATABASE_URL`; live Bright revalidation uses `CORPORATE_NETWORK_SERVICE_URL`. Do not prefix any credential with `NEXT_PUBLIC_` or expose it to client components.

Verified local integration covers readiness, profile mapping, enrollment and duplicate idempotency, eligibility, CN authority revalidation, review, ACCEPT/REJECT, restart persistence, invalid authentication, service-down handling, and responsive Intelligence UI. An Intelligence ACCEPT remains Intelligence-only; it does not write CN canonical data.

## Explicit live-provider demo

The repository contains:

```bash
npm run dev:local:coresignal-live
```

This is **not** the normal development command. It enables a tightly bounded live Coresignal demo only on loopback, requires a server-only `CORESIGNAL_API_KEY`, and caps search and refresh at one. Use it only with explicit authorization to consume provider operations. Lusha, Signals, and mail remain disabled by that command.

## Environment-variable groups

Only names and purposes are documented here. Never place real values in Markdown or tracked `.env` files.

### Product and authentication

- `APP_PUBLIC_URL`, `APP_BASE_PATH`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAIN`
- `AUTH_SESSION_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`

### Intelligence connectivity

- `INTELLIGENCE_SERVICE_URL`
- `INTELLIGENCE_SERVICE_SECRET`

### Provider gates and limits

- `CORESIGNAL_LIVE_ENABLED`, `CORESIGNAL_API_KEY`
- `CORESIGNAL_SEARCH_ENABLED` (independent Base Employee ES-DSL Search gate; default `false`)
- `CORESIGNAL_ES_DSL_PREVIEW_ENABLED`, `CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT`
- `CORESIGNAL_COLLECT_ENABLED`, `CORESIGNAL_COLLECT_ENTITLEMENT`
- `CORESIGNAL_LIVE_SEARCH_MAX_RESULTS`, `CORESIGNAL_LIVE_REFRESH_MAX_PROFILES`
- `LUSHA_LIVE_ENABLED`, `LUSHA_API_KEY`
- `LOCAL_LUSHA_LIVE_DEMO_ENABLED`, `LUSHA_SEARCH_MAX_APPLICATION_UNITS`, `LUSHA_EMAIL_MAX_APPLICATION_UNITS`, `LUSHA_PHONE_MAX_APPLICATION_UNITS`
- `LUSHA_SEARCH_ENTITLEMENT`, `LUSHA_EMAIL_ENTITLEMENT`, `LUSHA_PHONE_ENTITLEMENT`, `LUSHA_ENTITLEMENT_SOURCE`, `LUSHA_ENTITLEMENT_VERIFIED_AT`
- `LUSHA_SIGNALS_LIVE_ENABLED`, `LUSHA_SIGNALS_ENTITLEMENT`
- `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_DATASET_ID`, `BRIGHTDATA_LIVE_ENABLED`, `BRIGHTDATA_ACCESS_ENTITLEMENT`, `BRIGHTDATA_APPLICATION_REQUEST_LIMIT`
- `LOCAL_DEV_D1_PERSIST_PATH`, `CORESIGNAL_WEBHOOK_MOCK_TRANSPORT`, `CORESIGNAL_WEBHOOK_RECEIVE_ENABLED`, `CORESIGNAL_WEBHOOK_CALLBACK_SECRET` (isolated mock receiver only; no live subscription implied)
- `MAIL_MODE`, `MAIL_LIVE_ENABLED`, `GMAIL_SEND_SCOPE_CONFIRMED`
- `MAIL_SENDER_EMAIL`, `MAIL_SENDER_DISPLAY_NAME`
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

The authoritative example with safe placeholders is `.env.example`.

Application allowance settings live in governed D1 provider settings; they are **not** the provider's account balance or per-call charge. Do not copy secrets, local databases, provider snapshots, or demo fixtures into Git or a Sites release package. The seven currently uncommitted one-time Coresignal Preview-trial paths should remain uncommitted and out of a production source candidate until separately reviewed.

## Validation commands

```bash
node --test tests/*.test.mjs
npm run lint
npx tsc --noEmit
git diff --check
```

On Linux/Sites, `npm run build` uses the bounded wrapper and GNU `timeout`. On macOS, the validated production-equivalent command is:

```bash
bash scripts/sites-env.sh -- ./node_modules/.bin/vinext build
```

`npm test` invokes the build wrapper and then the complete Node suite, so the direct build and `node --test` form is preferable on macOS without GNU `timeout`.

## Release discipline

Local acceptance does not authorize live providers or deployment. Before release, configure isolated staging, server-side secrets, migration and rollback verification, provider/account/credit readiness, explicit live gates, controlled provider acceptance, and security/release approval.
