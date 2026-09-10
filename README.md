# Corporate Network

Corporate Network is an alumni relationship and placement-intelligence MVP. It includes a shared alumni database, CSV import, deterministic placement scoring, company intelligence, outreach tracking, and an internal-search-to-PDL-to-Lusha discovery workflow.

## Shared engagement workspace

Professional signals and birthdays now use one D1-backed engagement-event framework. Each event records its source, status, owner, views, planned or completed actions, responses, follow-ups, skipped/incorrect reasons, and audit history. Viewing an event does not imply that action was taken, and an atomic action key prevents duplicate sends across committee members.

The **Engagement** tab includes:

- professional-signal and birthday queues with shared statuses
- PCOMmer 1 / PCOMmer 2 demonstration identities for multi-user testing
- birthday date-window, company, and email-readiness filters
- individual and bulk preview/approval before sending
- communication-preference and birthday-confidence safety checks
- approved templates with editable preview text
- mock email delivery with delivery receipts and an interface for a future official mailbox
- response capture, follow-up dates, ownership, reassignment, correction, skip, close, and audit timelines

Mail is deliberately semi-automatic. Set `MAIL_MODE=mock` for the demonstrable flow. `MAIL_MODE=live` remains blocked until an approved institutional mailbox adapter is connected; API secrets must stay server-side.

## Company-first alumni discovery

The Alumni Directory supports optional filters for name, current company, role, function, seniority, location, programme, graduation year, previous company, placement relevance, data confidence, contact state, outreach state, and IIML relationship. Filters combine with AND logic. Searching the internal database does not call an external provider.

The end-to-end discovery flow is:

1. Search the internal Corporate Network database.
2. Select **Discover More Alumni** to carry the active filters into PDL Person Search.
3. Keep **Indian Institute of Management Lucknow** as the fixed education criterion.
4. Review results classified as New, Already in database, Possible duplicate, or Needs review.
5. Manually approve clearly new records or compare possible matches. No external result is inserted automatically.
6. After approval, selectively request an email, phone, or both from Lusha.

Company Intelligence reuses the same workflow through **Find More Alumni**. PDL comparisons never overwrite an existing profile silently. Selected updates are recorded in field-change history, while all provider calls are recorded in provider-response history.

The active filters and requested result count remain visible with every external search. The UI distinguishes a successful zero-result search from a search that was blocked before a provider call, and ignored results retain a shared review reason.

## Target-specific outreach routes

Outreach-route recommendations are made for an explicitly selected alumnus, never for a company alone. The engine recommends direct outreach when the selected person has a usable contact route and reliable profile. A warm route is shown only when a confirmed intermediary relationship is recorded and the intermediary has credible PlaceCom engagement; the recommendation includes the evidence and rationale. If neither route is credible, the app explains what data or relationship evidence is missing.

## Bulk and manual data entry

The Data Import tab separates bulk CSV import from single-record entry. Manual entry validates a minimum identity, checks possible duplicates before insertion, records the source and actor, and consumes no provider credits. PDL profile refresh and Lusha contact enrichment remain optional actions after the internal record has been created.

## Enrichment providers

Phase 3 supports two operating modes:

- `mock` is the safe default. It runs deterministic demonstration enrichments, consumes only application-level mock credits, and needs no vendor account.
- `live` calls People Data Labs and Lusha from server routes. Provider keys never reach the browser.

Copy `.env.example` into your local environment configuration and set:

```text
ENRICHMENT_MODE=mock
MAIL_MODE=mock
PDL_API_KEY=
LUSHA_API_KEY=
```

Change `ENRICHMENT_MODE` to `live` only after both vendor keys are configured. The application also enforces adjustable monthly credit caps stored in D1. The default caps are 100 credits per provider per month.

The Enrichment tab provides:

- manual and selected-batch PDL profile/employment refresh with confirmation
- review-and-apply of changed professional fields; no-change and no-match results remain visible
- manual and selected-batch Lusha email/phone enrichment
- batch enrichment for up to 25 alumni
- monthly credit-limit controls and usage meters
- sanitized provider-response history

The live discovery adapter uses the PDL v5 Person Search API, while existing-profile refresh continues through the PDL enrichment workflow. The live Lusha adapter targets the v3 Search and Enrich endpoint. Provider errors are saved to response history without saving API secrets or raw provider payloads.

## Local setup

1. Install Node.js 22.13 or newer.
2. Run `npm ci`.
3. Run `npm run dev` for development.
4. Run `npm run lint`, `npm run build`, and `npm test` before release.
5. After any schema change, run `npm run db:generate` and deploy the new migration.

## Source layout

- `app/page.tsx`: main dashboard and enrichment interface
- `app/api/workspace/route.ts`: alumni import and shared-workspace updates
- `app/api/enrichment/route.ts`: manual/batch enrichment, limits, usage, and history
- `app/api/discovery/route.ts`: PDL discovery, reconciliation, review, approval, refresh, and history
- `app/api/outreach-route/route.ts`: target-specific direct, warm, and no-route recommendations
- `app/api/engagements/route.ts`: engagement queues, ownership, mail workflow, responses, follow-ups, and audits
- `lib/alumni-search.ts`: shared internal filtering and provider-query translation
- `lib/mail-service.ts`: mock mail service and future live-mail boundary
- `lib/pdl-discovery.ts`: mock/live PDL Person Search service
- `lib/enrichment-providers.ts`: mock/live PDL and Lusha adapters
- `db/schema.ts`: D1 schema
- `drizzle/`: database migrations

## Validation

Run `node --test tests/alumni-discovery.test.mjs` to verify the 15 company-first discovery conditions, `node --test tests/workflow-acceptance.test.mjs` for the 18 route, discovery, manual-entry, refresh, and contact-provenance conditions, and `node --test tests/engagement-workflow.test.mjs` for the 17 engagement conditions. Run `npx tsc --noEmit` and `npm test` before release.

## Starter runtime notes

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from `oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
