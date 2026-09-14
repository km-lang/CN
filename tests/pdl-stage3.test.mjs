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
  PDL_API_KEY: process.env.PDL_API_KEY,
  LUSHA_API_KEY: process.env.LUSHA_API_KEY,
  PDL_LIVE_ENABLED: process.env.PDL_LIVE_ENABLED,
  LUSHA_LIVE_ENABLED: process.env.LUSHA_LIVE_ENABLED,
  PDL_IIML_SCHOOL_ID: process.env.PDL_IIML_SCHOOL_ID,
  PDL_LIVE_SEARCH_MAX_RESULTS: process.env.PDL_LIVE_SEARCH_MAX_RESULTS,
  PDL_LIVE_REFRESH_MAX_PROFILES: process.env.PDL_LIVE_REFRESH_MAX_PROFILES,
  ENRICHMENT_MODE: process.env.ENRICHMENT_MODE,
  PROVIDER_LIVE_ENABLED: process.env.PROVIDER_LIVE_ENABLED,
};

after(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await vite.close();
});

process.env.PDL_API_KEY = "test-pdl-key-never-sent-to-a-real-provider";
process.env.PDL_LIVE_ENABLED = "true";
process.env.LUSHA_LIVE_ENABLED = "false";
process.env.PDL_IIML_SCHOOL_ID = "school-iim-lucknow";
process.env.PDL_LIVE_SEARCH_MAX_RESULTS = "99";
process.env.PDL_LIVE_REFRESH_MAX_PROFILES = "99";
process.env.ENRICHMENT_MODE = "live";
process.env.PROVIDER_LIVE_ENABLED = "true";

const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts");
const search = await vite.ssrLoadModule("/lib/alumni-search.ts");
const discovery = await vite.ssrLoadModule("/lib/pdl-discovery.ts");
const client = await vite.ssrLoadModule("/lib/pdl-client.ts");
const enrichment = await vite.ssrLoadModule("/lib/enrichment-providers.ts");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8");
const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8");
const discoverySource = await readFile(new URL("../lib/pdl-discovery.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("stage3 1: PDL can be live while Lusha remains mock", () => {
  assert.equal(runtime.providerMode("pdl"), "live");
  assert.equal(runtime.providerMode("lusha"), "mock");
  assert.equal(runtime.providerConfigured("pdl"), true);
  assert.equal(runtime.providerConfigured("lusha"), false);
});

test("stage3 2: legacy global flags cannot activate Lusha", () => {
  assert.equal(process.env.ENRICHMENT_MODE, "live");
  assert.equal(process.env.PROVIDER_LIVE_ENABLED, "true");
  assert.equal(runtime.providerMode("lusha"), "mock");
});

test("stage3 3: provider secrets and live gates remain server-only", () => {
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_(PDL|LUSHA|PROVIDER)/);
  assert.doesNotMatch(page, /PDL_API_KEY|LUSHA_API_KEY/);
  assert.match(envExample, /PDL_API_KEY=/);
  assert.match(envExample, /PDL_LIVE_ENABLED=false/);
  assert.match(envExample, /LUSHA_LIVE_ENABLED=false/);
});

test("stage3 4: live education query uses the canonical exact IIM Lucknow school ID", () => {
  const filters = { ...search.defaultDirectoryFilters(), company: "Google" };
  const query = search.buildPdlQuery(filters, "school-iim-lucknow");
  assert.deepEqual(query.query.bool.must[0], { term: { "education.school.id": "school-iim-lucknow" } });
  const serialized = JSON.stringify(query);
  assert.match(serialized, /Google/i);
  assert.doesNotMatch(serialized, /"IIM"|Indian Institute of Management"/);
});

test("stage3 5: live Person Search is hard-capped at five returned profiles", () => {
  assert.equal(runtime.pdlLiveSearchMaximum(), 5);
  const url = discovery.buildPdlSearchUrl({ ...search.defaultDirectoryFilters(), company: "Google" }, 5, "school-iim-lucknow");
  assert.equal(url.origin + url.pathname, "https://api.peopledatalabs.com/v5/person/search");
  assert.equal(url.searchParams.get("size"), "5");
});

test("stage3 6: School Cleaner resolves the fixed institution before paid search", async () => {
  const calls = [];
  const school = await client.cleanIimLucknowSchool({ fetcher: async (url, init) => {
    calls.push({ url, apiKey: init.headers["X-Api-Key"] });
    return new Response(JSON.stringify({ id: "school-iim-lucknow", name: "Indian Institute of Management Lucknow" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-call-credits-spent": "0", "x-call-credits-type": "school_clean" },
    });
  } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v5\/school\/clean/);
  assert.match(calls[0].url, /Indian\+Institute\+of\+Management\+Lucknow/);
  assert.equal(calls[0].apiKey, process.env.PDL_API_KEY);
  assert.equal(school.id, "school-iim-lucknow");
  assert.equal(school.creditsUsed, 0);
});

test("stage3 7: live provider response headers drive usage recording", async () => {
  const response = await client.pdlGet(new URL("https://api.peopledatalabs.com/v5/person/search"), { fetcher: async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { "content-type": "application/json", "x-call-credits-spent": "3", "x-call-credits-type": "search", "x-totallimit-remaining": "97" },
  }) });
  assert.equal(response.creditsUsed, 3);
  assert.equal(response.creditType, "search");
  assert.equal(response.totalCreditsRemaining, 97);
});

test("stage3 8: live result normalization maps returned fields and persistent identity", () => {
  const result = search.toDiscoveryProfile({
    id: "pdl-person-123",
    full_name: "Controlled Test Person",
    education: [{ school: { id: "school-iim-lucknow", name: "Indian Institute of Management Lucknow" }, end_date: "2014" }],
    job_company_name: "Google",
    job_title: "Director, Talent Acquisition",
    job_title_role: "human_resources",
    job_title_levels: ["director"],
    location_name: "Gurugram, India",
    linkedin_url: "https://www.linkedin.com/in/controlled-test",
  }, 0, "school-iim-lucknow");
  assert.equal(result.providerPersonId, "pdl-person-123");
  assert.equal(result.education, "Indian Institute of Management Lucknow");
  assert.equal(result.currentCompany, "Google");
  assert.equal(result.role, "Director, Talent Acquisition");
  assert.equal(result.function, "HR");
  assert.equal(result.seniority, "Director");
  assert.equal(result.graduationYear, 2014);
  assert.match(result.linkedinUrl, /linkedin\.com/);
});

test("stage3 9: missing live fields are labelled unavailable instead of fabricated", () => {
  const result = search.toDiscoveryProfile({ id: "pdl-person-empty", full_name: "Controlled Test Person" }, 0, "school-iim-lucknow");
  assert.equal(result.education, "Education not returned");
  assert.equal(result.currentCompany, "Company unavailable");
  assert.equal(result.role, "Role unavailable");
  assert.equal(result.location, "Location unavailable");
});

test("stage3 10: discovery remains review-before-add with separate identity confidence", () => {
  assert.match(discoveryRoute, /externalDiscoveryResults/);
  assert.match(discoveryRoute, /if \(payload\.action === "approve"\)/);
  assert.match(discoveryRoute, /matchConfidence/);
  assert.match(page, /Identity Match Confidence|match confidence/);
  assert.match(page, /Data confidence/);
  assert.match(page, /Results are review-only and will not be added automatically/);
});

test("stage3 11: Provider History records live mode, Person Search and actual usage", () => {
  assert.match(discoveryRoute, /operation: "Person Search"/);
  assert.match(discoveryRoute, /mode: discoveryMode\(\)/);
  assert.match(discoveryRoute, /creditsUsed: response\.creditsUsed/);
  assert.match(discoveryRoute, /resultCount: response\.profiles\.length/);
  assert.match(discoveryRoute, /Maximum requested:/);
});

test("stage3 12: application limits and company filter block before a live provider call", () => {
  assert.match(discoveryRoute, /filters\.company === "All companies"/);
  assert.match(discoveryRoute, /pdlRemainingCredits\(\)/);
  assert.match(discoveryRoute, /remaining < 1/);
  assert.match(discoveryRoute, /Math\.min\(requestedLimit, remaining/);
});

test("stage3 13: zero results and provider failures remain distinct", () => {
  assert.match(discoverySource, /No additional external alumni were found/);
  assert.match(discoveryRoute, /reason: "provider_error"/);
  assert.match(page, /External search was not run/);
  assert.match(page, /No additional external alumni were found/);
});

test("stage3 14: PDL failures are normalized without exposing provider payloads", async () => {
  for (const [status, kind] of [[401, "authentication"], [402, "credit_limit"], [429, "rate_limit"], [503, "unavailable"]]) {
    await assert.rejects(
      client.pdlGet(new URL("https://api.peopledatalabs.com/v5/person/search"), { fetcher: async () => new Response(JSON.stringify({ error: { message: "provider detail" } }), { status, headers: { "content-type": "application/json" } }) }),
      error => error instanceof client.PdlProviderError && error.kind === kind,
    );
  }
});

test("stage3 15: Person Enrichment uses persistent PDL ID and maps successful output", async () => {
  const previousFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async url => {
    calledUrl = String(url);
    return new Response(JSON.stringify({
      id: "pdl-person-123", likelihood: 9, job_company_name: "Google", job_title: "Director, Talent Acquisition",
      job_title_role: "human_resources", job_title_levels: ["director"], location_name: "Gurugram, India",
      linkedin_url: "https://www.linkedin.com/in/controlled-test", experience: [{ company: { name: "Microsoft" } }],
    }), { status: 200, headers: { "content-type": "application/json", "x-call-credits-spent": "1", "x-call-credits-type": "enrichment" } });
  };
  try {
    const result = await enrichment.enrich("pdl", { id: 99, name: "Controlled Test Person", company: "Google", title: "Director", location: "India", email: "", phone: "", linkedinUrl: "", pdlPersonId: "pdl-person-123" });
    assert.match(calledUrl, /\/v5\/person\/enrich/);
    assert.match(calledUrl, /pdl_id=pdl-person-123/);
    assert.equal(result.status, "success");
    assert.equal(result.creditsUsed, 1);
    assert.equal(result.changes.pdlPersonId, "pdl-person-123");
    assert.equal(result.changes.company, "Google");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("stage3 16: profile refresh supports no-change, no-match and review-before-apply", () => {
  assert.match(enrichmentRoute, /changed\.length \? "Pending review" : "No changes"/);
  assert.match(enrichmentRoute, /result\.status === "no_match" \? "No match"/);
  assert.match(enrichmentRoute, /if \(payload\.action === "apply_refresh"/);
  assert.match(enrichmentRoute, /fieldChangeHistory/);
  assert.match(page, /Apply Selected Updates/);
  assert.match(page, /No professional changes detected/);
  assert.match(page, /No matching external professional profile found/);
});

test("stage3 17: no PDL path automatically invokes Lusha", () => {
  const discoverySearchBlock = discoveryRoute.match(/if \(payload\.action === "search"\)[\s\S]*?if \(payload\.action === "approve"\)/)?.[0] ?? "";
  const pdlRefreshBlock = enrichmentRoute.match(/if \(payload\.action === "refresh_profiles"\)[\s\S]*?if \(!alumniIds\.length/ )?.[0] ?? "";
  assert.doesNotMatch(discoverySearchBlock, /lusha|Lusha/);
  assert.doesNotMatch(pdlRefreshBlock, /enrich\("lusha"/);
  assert.equal(runtime.providerMode("lusha"), "mock");
});

test("stage3 18: live PDL calls remain PCOM/Admin-only and Admin alone manages limits", () => {
  assert.match(discoveryRoute, /authorizeRequest\(request, payload\.action === "validate_pdl" \? "MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM"\)/);
  assert.match(enrichmentRoute, /"MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM"/);
  assert.match(enrichmentRoute, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/);
  assert.match(enrichmentRoute, /pdlLiveRefreshMaximum\(\)/);
  assert.match(page, /People Data Labs — \{providerModes\.pdl\.toUpperCase\(\)\}/);
});

test("stage3 19: successful live zero-result Search is not reported as a failure", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 200, total: 0, data: [] }), {
    status: 200,
    headers: { "content-type": "application/json", "x-call-credits-spent": "0", "x-call-credits-type": "search" },
  });
  try {
    const result = await discovery.searchExternalAlumni({ ...search.defaultDirectoryFilters(), company: "Google" }, [], 5);
    assert.equal(result.profiles.length, 0);
    assert.equal(result.creditsUsed, 0);
    assert.equal(result.responseSummary, "No additional external alumni were found.");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("stage3 20: PDL timeout is normalized safely", async () => {
  await assert.rejects(
    client.pdlGet(new URL("https://api.peopledatalabs.com/v5/person/search"), {
      timeoutMs: 1,
      fetcher: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    }),
    error => error instanceof client.PdlProviderError && error.kind === "timeout" && !error.message.includes(process.env.PDL_API_KEY),
  );
});

test("stage3 21: live Person Enrichment no-match changes nothing", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 404, error: { message: "No matching person found" } }), {
    status: 404,
    headers: { "content-type": "application/json", "x-call-credits-spent": "0", "x-call-credits-type": "enrichment" },
  });
  try {
    const result = await enrichment.enrich("pdl", { id: 100, name: "Controlled Missing Person", company: "Google", title: "Director", location: "India", email: "", phone: "", linkedinUrl: "", pdlPersonId: "pdl-missing" });
    assert.equal(result.status, "no_match");
    assert.equal(result.creditsUsed, 0);
    assert.deepEqual(result.changes, {});
    assert.equal(result.responseSummary, "No matching external professional profile found.");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("stage3 22: first live Search validates connectivity before Person Search without changing RBAC", () => {
  const block = discoveryRoute.match(/let canonicalSchoolId = pdlIimlSchoolId\(\);[\s\S]*?let response;/)?.[0] ?? "";
  assert.match(block, /cleanIimLucknowSchool\(\)/);
  assert.match(block, /PDL Connection Check/);
  assert.match(block, /reason: "connectivity_error"/);
  assert.match(discoveryRoute, /searchExternalAlumni\(filters, people, limit, canonicalSchoolId\)/);
  assert.match(discoveryRoute, /"OPERATE_PCOM"/);
  assert.match(discoveryRoute, /"MANAGE_PROVIDER_SETTINGS"/);
});
