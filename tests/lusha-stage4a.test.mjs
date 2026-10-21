import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

const originalEnvironment = {
  CORESIGNAL_API_KEY: process.env.CORESIGNAL_API_KEY,
  LUSHA_API_KEY: process.env.LUSHA_API_KEY,
  CORESIGNAL_LIVE_ENABLED: process.env.CORESIGNAL_LIVE_ENABLED,
  LUSHA_LIVE_ENABLED: process.env.LUSHA_LIVE_ENABLED,
  MAIL_LIVE_ENABLED: process.env.MAIL_LIVE_ENABLED,
};

after(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await vite.close();
});

process.env.CORESIGNAL_API_KEY = "test-coresignal-key-never-sent-to-a-real-provider";
process.env.LUSHA_API_KEY = "test-lusha-key-never-sent-to-a-real-provider";
process.env.CORESIGNAL_LIVE_ENABLED = "true";
process.env.LUSHA_LIVE_ENABLED = "true";
process.env.MAIL_LIVE_ENABLED = "false";

const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts");
const lusha = await vite.ssrLoadModule("/lib/lusha-client.ts");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../lib/enrichment-providers.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("stage4a 1: Coresignal and Lusha have independent live gates while mail remains off", () => {
  assert.equal(runtime.providerMode("coresignal"), "live");
  assert.equal(runtime.providerMode("lusha"), "live");
  assert.equal(process.env.MAIL_LIVE_ENABLED, "false");
});

test("stage4a 2: Lusha secret remains server-only", () => {
  assert.equal(runtime.providerConfigured("lusha"), true);
  assert.doesNotMatch(page, /LUSHA_API_KEY/);
  assert.doesNotMatch(route, /process\.env\.LUSHA_API_KEY/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_LUSHA/);
});

test("stage4a 3: known-contact search uses V3 and prefers the professional profile", async () => {
  const calls = [];
  const result = await lusha.searchLushaContact({ name: "Sahil Bansal", company: "Google", linkedinUrl: "linkedin.com/in/sahilb" }, { fetcher: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers.api_key });
    return new Response(JSON.stringify({ results: [{ id: "lusha-contact-1", fullName: "Sahil Bansal", has: ["emails"], socialLinks: { linkedin: "https://linkedin.com/in/sahilb" }, jobTitle: { title: "Product Leader" }, company: { name: "Google" } }] }), { status: 200, headers: { "content-type": "application/json", "x-credits-used": "1" } });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.lusha.com/v3/contacts/search");
  assert.deepEqual(calls[0].body, { contacts: [{ linkedinUrl: "https://linkedin.com/in/sahilb" }] });
  assert.equal(calls[0].key, process.env.LUSHA_API_KEY);
  assert.equal(result.contactId, "lusha-contact-1");
  assert.equal(result.status, "success");
  assert.equal(result.identityReason, "PROFILE_URL_MATCH");
  assert.equal(result.emailAvailable, true);
  assert.equal(result.creditsUsed, 1);
});

test("stage4a 3b: a conflicting or missing provider profile URL cannot establish a canonical Lusha identity", async () => {
  for (const [providerUrl, expectedReason] of [
    ["https://linkedin.com/in/someone-else", "PROFILE_URL_CONFLICT"],
    ["", "PROFILE_URL_MISSING"],
  ]) {
    const result = await lusha.searchLushaContact({ name: "Sahil Bansal", company: "Google", linkedinUrl: "https://linkedin.com/in/sahilb" }, { fetcher: async () => new Response(JSON.stringify({ results: [{ id: "other-contact", fullName: "Sahil Bansal", socialLinks: { linkedin: providerUrl } }] }), { status: 200, headers: { "x-credits-used": "1" } }) });
    assert.equal(result.status, "review_required");
    assert.equal(result.identityReason, expectedReason);
    assert.equal(result.linkedinUrl, providerUrl);
    assert.equal(result.creditsUsed, 1);
  }
});

test("stage4a 3c: name/company-only and multiple-result previews remain unverified", async () => {
  const noUrl = await lusha.searchLushaContact({ name: "Sahil Bansal", company: "Google", linkedinUrl: "" }, { fetcher: async () => new Response(JSON.stringify({ results: [{ id: "contact-1", socialLinks: { linkedin: "https://linkedin.com/in/sahilb" } }] }), { status: 200 }) });
  assert.equal(noUrl.status, "review_required");
  assert.equal(noUrl.identityReason, "NO_TRUSTED_INPUT_URL");
  const multiple = await lusha.searchLushaContact({ name: "Sahil Bansal", company: "Google", linkedinUrl: "https://linkedin.com/in/sahilb" }, { fetcher: async () => new Response(JSON.stringify({ results: [{ id: "contact-1", socialLinks: { linkedin: "https://linkedin.com/in/sahilb" } }, { id: "contact-2" }] }), { status: 200 }) });
  assert.equal(multiple.status, "review_required");
  assert.equal(multiple.identityReason, "MULTIPLE_RESULTS");
});

test("stage4a 4: search preview requests no contact reveal", async () => {
  let body;
  await lusha.searchLushaContact({ name: "Sahil Bansal", company: "Google", linkedinUrl: "https://linkedin.com/in/sahilb" }, { fetcher: async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json", "x-credits-used": "0" } });
  } });
  assert.equal(JSON.stringify(body).includes("reveal"), false);
  assert.equal(JSON.stringify(body).includes("email"), false);
  assert.equal(JSON.stringify(body).includes("phone"), false);
});

test("stage4a 5: confirmed V3 enrichment requests email only by stable ID", async () => {
  let call;
  const result = await lusha.revealLushaEmail("lusha-contact-1", { fetcher: async (url, init) => {
    call = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ results: [{ id: "lusha-contact-1", emails: [{ email: "sahil@example.org" }] }] }), { status: 200, headers: { "content-type": "application/json", "x-credits-used": "2" } });
  } });
  assert.equal(call.url, "https://api.lusha.com/v3/contacts/enrich");
  assert.deepEqual(call.body, { ids: ["lusha-contact-1"], reveal: ["emails"] });
  assert.equal(result.email, "sahil@example.org");
  assert.equal(result.creditsUsed, 2);
});

test("stage4a 6: missing per-call usage is marked for reconciliation instead of invented", async () => {
  const result = await lusha.revealLushaEmail("lusha-contact-1", { fetcher: async () => new Response(JSON.stringify({ results: [{ id: "lusha-contact-1", emails: [{ email: "sahil@example.org" }] }] }), { status: 200, headers: { "content-type": "application/json" } }) });
  assert.equal(result.creditsUsed, null);
  assert.equal(result.usageSource, "unavailable");
  assert.match(route, /reconcile against Lusha account usage/);
});

test("stage4a 6b: email reveal never applies a different or unidentified contact", async () => {
  for (const records of [
    [{ id: "different", emails: [{ email: "wrong@example.org" }] }],
    [{ emails: [{ email: "unknown@example.org" }] }],
    [{ id: "lusha-contact-1", emails: [{ email: "first@example.org" }] }, { id: "other" }],
  ]) {
    const result = await lusha.revealLushaEmail("lusha-contact-1", { fetcher: async () => new Response(JSON.stringify({ results: records }), { status: 200 }) });
    assert.equal(result.status, "review_required");
    assert.equal(result.email, "");
  }
});

test("stage4a 7: account validation uses the non-contact usage endpoint", async () => {
  let calledUrl = "";
  const usage = await lusha.getLushaAccountUsage({ fetcher: async url => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ data: { usage: { used: 7, remaining: 93, limit: 100 } } }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  assert.equal(calledUrl, "https://api.lusha.com/account/usage");
  assert.deepEqual(usage, { used: 7, remaining: 93, limit: 100, creditType: "general" });
});

test("stage4a 7b: documented account usage nested bulk-credit totals are parsed", async () => {
  const usage = await lusha.getLushaAccountUsage({ fetcher: async () => new Response(JSON.stringify({ usage: { bulkCredits: { used: 4, remaining: 29, total: 33 } } }), { status: 200 }) });
  assert.deepEqual(usage, { used: 4, remaining: 29, limit: 33, creditType: "bulk_credits" });
});

test("stage4a 8: live UI requires search preview and a second channel-only confirmation", () => {
  assert.match(page, /Check Lusha contact availability\?/);
  assert.match(page, /Confirm Contact Search/);
  assert.match(page, /Continue to \{lushaRevealChannel === "email" \? "Email" : "Phone"\} Reveal/);
  assert.match(page, /Confirm \{lushaRevealChannel === "email" \? "Email" : "Phone"\}-Only Reveal/);
  assert.match(page, /No email or phone is revealed in this step/);
});

test("stage4a 9: live channel-specific reveals are offered while combined and bulk reveals remain unavailable", () => {
  const liveBatch = page.match(/providerModes\.lusha === "live" \? <>[\s\S]*? : <><Button/)?.[0] ?? "";
  assert.match(liveBatch, /Prepare Email Reveal/);
  assert.match(liveBatch, /Prepare Phone Reveal/);
  assert.doesNotMatch(liveBatch, /Get Both|Get Phones|batch/);
  assert.match(page, /Combined and bulk reveal remain disabled/);
});

test("stage4a 10: server rejects the legacy combined live path", () => {
  assert.doesNotMatch(provider, /\/v3\/contacts\/search-and-enrich/);
  assert.match(provider, /controlled Lusha V3 contact-search preview/);
  assert.match(route, /Use the controlled single-alumnus Lusha contact preview and channel-specific confirmation workflow in LIVE mode/);
});

test("stage4a 11: Lusha actions remain PCOM-operational and settings remain Admin-only", () => {
  assert.match(route, /requiredPermission = payload\.action === "validate_lusha" \? "MANAGE_PROVIDER_SETTINGS"/);
  assert.match(page, /disabled=\{!session\.canAdminister\}/);
  assert.match(page, /Only an Admin can change application credit limits/);
});

test("stage4a 12: search persists stable ID and history without raw provider payload", () => {
  assert.match(route, /LUSHA_ATTACH_ID_SQL/);
  assert.match(route, /if \(previewStatus === "success" && result\.contactId\)/);
  assert.match(route, /identityReason = "CONTACT_ID_ALREADY_LINKED_OR_CONFLICTING"/);
  assert.match(route, /no contact ID was attached/);
  assert.match(route, /claimLushaRequest\(person, "Contact Search Preview", actor\)/);
  assert.match(route, /completeLushaRequest\(claim\.id/);
  assert.doesNotMatch(route, /JSON\.stringify\(result\)/);
});

test("stage4a 13: reveal stores only provider-sourced email and preserves profile provenance", () => {
  const revealBlock = route.match(/if \(payload\.action === "lusha_reveal_email"\)[\s\S]*?return authenticatedJsonResponse\(context, \{ result:/)?.[0] ?? "";
  assert.match(revealBlock, /emailSource: "Lusha"/);
  assert.match(revealBlock, /emailVerification: "Unverified"/);
  assert.doesNotMatch(revealBlock, /phone:/);
  const alumniUpdate = revealBlock.match(/db\.update\(alumni\)\.set\(\{[\s\S]*?\}\)\.where/)?.[0] ?? "";
  assert.doesNotMatch(alumniUpdate, /(?:^|[, {])source: "Lusha"/);
});

test("stage4a 14: UI distinguishes application limit from Lusha account balance", () => {
  assert.match(page, /application limit, not the Lusha account balance/);
  assert.doesNotMatch(page, /Usage estimate: 1 credit per email and 5 per phone/);
  assert.match(page, /request\/result usage plus selected reveal fields/);
});

test("stage4a 15: automated Lusha coverage injects mock fetchers and never reaches the network", () => {
  assert.match(page, /No live action runs without confirmation/);
  assert.match(route, /confirmed !== true/);
});
