# Local development

## Provider-free Corporate Network

Requirements: Node.js 22.13 or newer and the repository dependencies.

### Windows local login

From the repository in PowerShell or Command Prompt, with dependencies installed:

```powershell
npm run dev:local:windows
```

The existing `dev`, `dev:local` and `local:setup` scripts use POSIX assignments or
Bash. The Windows launcher invokes installed Node CLIs directly and needs no Bash
or additional dependency. It creates a **fresh** temporary D1 on every launch,
applies migrations using `--local --persist-to <new temporary directory>` and
loads `scripts/local-development-fixture.sql` there only. Never run the old
`local:setup` against the original `.wrangler/state`: fixture upserts can replace
existing rows. The new launcher ignores inherited database paths and leaves the
original D1 and `.env.local` unchanged. The printed temporary directory is
disposable demo state; it is not a copy of institutional alumni or provider history.

- Admin entry: <http://localhost:3000/login/admin>
- PCOM entry: <http://localhost:3000/login/pcom>
- Select **Enter local Admin workspace** or **Enter local PCOM workspace**.
- Port 3000 is loopback-only and fixed; startup fails if occupied. The ordinary
  Vite server on 5173 may remain running. Use `Ctrl+C` to stop a foreground demo.
- Each launch resets demo data and generates a random process-only session secret;
  sign in again after restarting. A browser session holds one role at a time.

The existing `/auth/local/start` route requires `NODE_ENV=development`,
`LOCAL_DEV_AUTH_ENABLED=true`, a supported `LOCAL_DEV_AUTH_ROLE`, a loopback host,
and the matching enabled fixture user/identity in D1. `LOCAL_DEV_AUTH_ROLE=ADMIN`
enables the development runtime; the selected entry resolves its own Admin or
PCOM fixture. Normal signed sessions and database authorization remain enforced.
The launcher forces Coresignal Search/Preview/Collect, Lusha/Signals, Bright Data,
live-demo/mock transport flags, webhook receiving and live mail off. It does not
enable PDL or call paid providers. Google OAuth and bootstrap account settings are
unnecessary for this mode, and no credentials are printed.

If an ordinary server shows **Google Workspace sign-in unavailable**, it is using
institutional auth because the explicit development opt-in was not supplied.
`isGoogleOAuthConfigured()` requires nonempty `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `AUTH_SESSION_SECRET` (the signing secret must also be
at least 32 characters). Institutional setup additionally needs the intended
`GOOGLE_ALLOWED_DOMAIN`, correct `APP_PUBLIC_URL`/`APP_BASE_PATH`, a Google Web
OAuth client with the exact `/auth/google/callback` redirect URI, and an approved
enabled user in the application database. `BOOTSTRAP_ADMIN_EMAILS` belongs to the
separate ChatGPT recovery/bootstrap flow; it does not authorize Google users.
Use the local launcher for exploration instead of inventing OAuth credentials.

### Existing Bash workflow

```bash
npm ci
npm run local:setup
npm run dev:local
```

`local:setup` targets `.wrangler/state` and loads deterministic fixtures; run it only in a disposable checkout, never against the original local data. `dev:local` listens on loopback port 3000, enables only the development authentication path, forces Coresignal/Lusha/Signals gates off, and keeps mail in mock mode. It requires no production secret and must never use a production D1 binding.

For a separately isolated local D1, an Admin may put an existing Lusha key in the gitignored `.env.local` as `LUSHA_API_KEY=...`, using a local editor rather than a shell argument or chat message. Restrict that file to the local user (`chmod 600 .env.local`). Set `LOCAL_DEV_D1_PERSIST_PATH` to an existing temporary-directory checkout of the isolated D1, and leave `LUSHA_LIVE_ENABLED=false`, `LOCAL_LUSHA_LIVE_DEMO_ENABLED=false`, `LUSHA_SIGNALS_LIVE_ENABLED=false`, and endpoint entitlements `unknown`. A prepared per-operation ceiling does not itself enable live execution. The local Vite worker receives the key only for an Admin session with that isolated D1; this permits credential-presence checks without calling Lusha. A future live test requires both explicit live flags, source/date-backed per-operation entitlements, account usage, ceilings and separate authorization for its exact request. Never set an entitlement to `confirmed` merely to pass preflight.

The separate `LOCAL_LUSHA_V3_MOCK_TRANSPORT=true` option is for disposable browser acceptance, not provider connectivity. It requires development Admin authentication, a loopback `LOCAL_PROVIDER_LIVE_DEMO_HOST`, an existing D1 persistence directory beneath `/tmp` or `/private/tmp`, and `LUSHA_LIVE_ENABLED=false`. It returns only fixed fictional `.example.test` contacts without calling Lusha, records mode `mock` with zero application units and no provider-reported charge, and retains the normal Admin review and duplicate fences. The browser harness is `tests/browser/lusha-v3-e2e.mjs`; it requires an isolated local Chrome debugging port, isolated application port, and `LUSHA_BROWSER_DB` pointing to the disposable SQLite file. This is not part of the default server configuration, and it must never point to the original D1.

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

Application allowance settings live in governed D1 provider settings; they are **not** the provider's account balance or per-call charge. Do not copy secrets, local databases, provider snapshots, or demo fixtures into Git or a Sites release package. The seven one-time Coresignal Preview-trial paths were preserved exactly in local Git stash `938ecd85966f990dbbaa6af9393a843120e535e2`; six trial-only paths were removed from the shipping worktree. One safe `vite.config.ts` change was retained: forward `LOCAL_DEV_D1_PERSIST_PATH` only when an Admin local-development checkout resolves to an existing temporary directory outside the project. This supports isolated local workflows without enabling Preview, Collect or another provider. The stash is workstation-only, not a clone or release artifact; do not apply it to production. The normal Preview gate remains disabled unless separately configured with confirmed entitlement and explicit approval.

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

## PCOM redesign acceptance (2026-10-28)

Use `npm run dev:local:windows` for a new disposable D1 and the seeded Admin/PCOM identities. Sign in as PCOM to upload a fictional .xlsx, map columns and preview; sign in as Admin with the same source file to approve the import. Test primary batch/company/name filters, profile corrections and retained professional-evidence decisions. PCOM import execution, provider identity/contact decisions and provider settings must remain denied. The active navigation omits Engagement, Opportunities and standalone Intelligence; retired deep links are sanitized to Directory without invoking those workflows. All provider gates and live mail remain off. Do not apply fixtures or acceptance writes to the original `.wrangler/state`, production, or retained real-provider evidence.

For explicitly isolated synthetic Lusha acceptance, the existing `LOCAL_LUSHA_V3_MOCK_TRANSPORT=true` gate now also recognizes a Windows `corporate-network-local-*` directory under the standard per-user or packaged-app temporary directory. Vite must independently realpath-validate it beneath `os.tmpdir()`, outside the project. All other Admin, development, loopback and live-disabled safeguards remain. The normal launcher still forces this mock gate off.
