import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const previousKey = process.env.LUSHA_API_KEY;
process.env.LUSHA_API_KEY = "phone-reveal-test-key-never-sent-to-a-real-provider";

after(async () => {
  if (previousKey === undefined) delete process.env.LUSHA_API_KEY;
  else process.env.LUSHA_API_KEY = previousKey;
  await vite.close();
});

const contact = await vite.ssrLoadModule("/lib/contact-enrichment.ts");
const usage = await vite.ssrLoadModule("/lib/provider-usage.ts");
const lusha = await vite.ssrLoadModule("/lib/lusha-client.ts");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8");
const signals = await readFile(new URL("../app/api/signals/route.ts", import.meta.url), "utf8");

test("phone reveal 1: one alumnus with a missing or unverified phone is eligible", () => {
  const missing = { id: 1, name: "Abhi Malan", phone: "", phoneVerification: "Unverified", lushaPersonId: "lusha-abhi", privacy: { generalContactStatus: "Unknown" } };
  const unverified = { ...missing, phone: "+91 90000 00000" };
  assert.equal(contact.contactEnrichmentPlan([missing], ["phone"]).phoneOperations, 1);
  assert.equal(contact.contactEnrichmentPlan([unverified], ["phone"]).phoneOperations, 1);
});

test("phone reveal 2: verified phone and explicit DNC are blocked", () => {
  const verified = { id: 1, name: "Abhi Malan", phone: "+91 90000 00000", phoneVerification: "Verified", lushaPersonId: "lusha-abhi" };
  const dnc = { ...verified, phone: "", phoneVerification: "Unverified", privacy: { generalContactStatus: "Do not contact" } };
  assert.equal(contact.contactEnrichmentPlan([verified], ["phone"]).phoneOperations, 0);
  assert.equal(contact.contactEnrichmentPlan([dnc], ["phone"]).phoneOperations, 0);
  assert.match(contact.contactEnrichmentPermission(dnc).reason, /do-not-contact/);
  assert.equal(contact.contactEnrichmentPermission({ ...dnc, privacy: { generalContactStatus: "Unknown" } }).allowed, true);
});

test("phone reveal 3: stable identity requirement is represented and enforced server-side", () => {
  const person = { id: 1, name: "Abhi Malan", phone: "", phoneVerification: "Unverified", lushaPersonId: "" };
  assert.equal(contact.contactEnrichmentPlan([person], ["phone"], true).blocked, 1);
  const phoneBlock = route.match(/if \(payload\.action === "lusha_reveal_phone"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  assert.match(phoneBlock, /hasApprovedLushaIdentity\(person\)/);
  assert.match(phoneBlock, /confirmed !== true/);
  assert.match(phoneBlock, /!lushaV3Available\(\)/);
});

test("phone reveal 4: provider request asks for phones only and normalizes the first returned phone", async () => {
  let request;
  const result = await lusha.revealLushaPhone("lusha-abhi", { fetcher: async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ results: [{ id: "lusha-abhi", phones: [{ number: "+91 98765 43210" }, { number: "+91 90000 00000" }] }] }), { status: 200, headers: { "content-type": "application/json", "x-credits-used": "3" } });
  } });
  assert.equal(request.url, "https://api.lusha.com/v3/contacts/enrich");
  assert.deepEqual(request.body, { ids: ["lusha-abhi"], reveal: ["phones"], waterfallEnabled: false });
  assert.doesNotMatch(JSON.stringify(request.body), /emails/);
  assert.equal(result.phone, "+91 98765 43210");
  assert.equal(result.creditsUsed, 3);
});

test("phone reveal 5: unavailable phone is a valid no-match outcome", async () => {
  const result = await lusha.revealLushaPhone("lusha-abhi", { fetcher: async () => new Response(JSON.stringify({ results: [{ id: "lusha-abhi", phones: [] }] }), { status: 200, headers: { "content-type": "application/json", "x-credits-used": "0" } }) });
  assert.equal(result.status, "no_match");
  assert.equal(result.phone, "");
  assert.equal(result.creditsUsed, 0);
});

test("phone reveal 6: exact, omitted, and explicit-zero usage keep distinct accounting states", async () => {
  const omitted = await lusha.revealLushaPhone("lusha-abhi", { fetcher: async () => new Response(JSON.stringify({ results: [{ phones: [{ phoneNumber: "+1 202 555 0100" }] }] }), { status: 200, headers: { "content-type": "application/json" } }) });
  assert.equal(usage.providerUsageState(omitted.creditsUsed), "reconciliation_required");
  assert.equal(usage.providerUsageState(0), "provider_reported_zero");
  assert.equal(usage.providerUsageState(4), "provider_reported");
});

test("phone reveal 6b: an unrelated or missing provider contact ID cannot update a canonical phone", async () => {
  for (const record of [{ id: "other", phones: [{ number: "+1 202 555 0100" }] }, { phones: [{ number: "+1 202 555 0100" }] }]) {
    const result = await lusha.revealLushaPhone("lusha-abhi", { fetcher: async () => new Response(JSON.stringify({ results: [record] }), { status: 200 }) });
    assert.equal(result.status, "review_required");
    assert.equal(result.phone, "");
  }
});

test("phone reveal 7: route stages phone provenance without changing canonical fields", () => {
  const phoneBlock = route.match(/if \(payload\.action === "lusha_reveal_phone"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  assert.match(phoneBlock, /claimLushaRequest\(person, "Phone Reveal", actor\)/);
  assert.match(phoneBlock, /retainLushaContactResult\(\{ claimId: claim\.id, reservation: claim\.reservation, person, actor, channel: "phone"/);
  assert.match(phoneBlock, /providerReportedCredits: result\.creditsUsed/);
  assert.doesNotMatch(phoneBlock, /db\.update\(alumni\)|revealLushaEmail\(/);
});

test("phone reveal 8: bypasses are rejected before the provider invocation", () => {
  const phoneBlock = route.match(/if \(payload\.action === "lusha_reveal_phone"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  const providerAt = phoneBlock.indexOf("await revealLushaPhone(");
  for (const guard of ["confirmed !== true", "permission.allowed", "eligibleContactChannels", "hasApprovedLushaIdentity(person)"]) {
    const guardAt = phoneBlock.indexOf(guard);
    assert.ok(guardAt >= 0 && guardAt < providerAt, `${guard} must be checked before the provider call`);
  }
  const searchBlock = route.match(/if \(payload\.action === "lusha_search_contact"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "";
  assert.ok(searchBlock.indexOf('payload.contactChannel === "phone"') < searchBlock.indexOf("await searchLushaContact("));
  assert.ok(searchBlock.indexOf("permission.allowed") < searchBlock.indexOf("await searchLushaContact("));
  assert.match(page, /contactChannel: lushaRevealChannel/);
});

test("phone reveal 9: UI is single-person, channel-specific, and explicitly confirmed", () => {
  assert.match(page, /Prepare Phone Reveal/);
  assert.match(page, /Reveal \{lushaRevealChannel\} through Lusha\?/);
  assert.match(page, /Requested field/);
  assert.match(page, /Confirm \{lushaRevealChannel === "email" \? "Email" : "Phone"\}-Only Reveal/);
  assert.match(page, /selectedContactPeople\.length === 1/);
  assert.match(page, /Combined and bulk reveal remain disabled/);
});

test("phone reveal 10: email-only and Signals implementations remain isolated", () => {
  assert.match(route, /revealLushaEmail\(person\.lushaPersonId\)/);
  assert.match(route, /claimLushaRequest\(person, "Email Reveal", actor\)/);
  assert.match(signals, /fetchLushaContactSignals/);
  assert.doesNotMatch(route.match(/if \(payload\.action === "lusha_reveal_phone"\)[\s\S]*?return authenticatedJsonResponse/)?.[0] ?? "", /fetchLushaContactSignals|engagementEvents|sendMail|outreach/i);
});
