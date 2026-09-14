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

after(async () => vite.close());

const helper = await vite.ssrLoadModule("/lib/alumni-search.ts");
const config = await vite.ssrLoadModule("/lib/app-config.ts");
const policy = await vite.ssrLoadModule("/lib/security-policy.ts");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8");
const enrichmentRoute = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8");
const providerSource = await readFile(new URL("../lib/enrichment-providers.ts", import.meta.url), "utf8");
const mockProvider = await readFile(new URL("../lib/pdl-discovery.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

const person = (overrides = {}) => ({
  name: "Aarav Mehta",
  company: "Google",
  title: "Director, Talent Acquisition",
  function: "HR",
  seniority: "Director",
  location: "Gurugram, India",
  programme: "PGP",
  batch: 2012,
  previous: "Microsoft",
  confidence: 88,
  status: "Not contacted",
  assessment: { iimlRelationship: "Strong" },
  ...overrides,
});

test("1. company-only search matches mapped alumni", () => {
  const filters = { ...helper.defaultDirectoryFilters(), company: "Google" };
  assert.equal(helper.matchesInternalFilters(person(), filters, 81, "Contact-ready"), true);
  assert.equal(helper.matchesInternalFilters(person({ company: "Amazon" }), filters, 81, "Contact-ready"), false);
});

test("2. combined function and Director+ filters narrow results with AND", () => {
  const filters = { ...helper.defaultDirectoryFilters(), company: "Google", function: "HR", seniority: "Director+" };
  assert.equal(helper.matchesInternalFilters(person(), filters, 81, "Contact-ready"), true);
  assert.equal(helper.matchesInternalFilters(person({ function: "Finance", title: "Finance Director" }), filters, 81, "Contact-ready"), false);
  assert.equal(helper.matchesInternalFilters(person({ seniority: "Senior Manager" }), filters, 81, "Contact-ready"), false);
});

test("3. external discovery carries filters and fixes IIM Lucknow education", () => {
  const filters = { ...helper.defaultDirectoryFilters(), company: "Microsoft", function: "HR", seniority: "Director+", location: "India" };
  const query = JSON.stringify(helper.buildPdlQuery(filters, "school-iim-lucknow"));
  assert.match(query, /education\.school\.id/);
  assert.match(query, /school-iim-lucknow/);
  assert.doesNotMatch(query, /education\.school\.name/);
  assert.match(query, /microsoft/);
  assert.match(query, /human resources/);
  assert.match(query, /director/);
  assert.match(query, /india/);
});

test("4. mock discovery demonstrates mapped, new, duplicate and review states", () => {
  assert.match(mockProvider, /slice\(0, 3\)/);
  assert.match(mockProvider, /Isha Malhotra/);
  assert.match(mockProvider, /slice\(5, 6\)/);
  assert.match(mockProvider, /needs-review-1/);
  assert.match(providerSource + pageSource + discoveryRoute, /Possible duplicate/);
  assert.match(pageSource, /discoveryCounts\.new/);
});

test("5. new external results require an explicit add action", () => {
  assert.match(pageSource, /Add Selected to \{appConfig\.name\}/);
  assert.match(discoveryRoute, /action === "approve"/);
});

test("6. possible duplicates cannot use the batch approval path", () => {
  assert.match(discoveryRoute, /result\.matchStatus !== "New"/);
  assert.match(pageSource, /Keep Separate/);
});

test("7. mapped alumni support comparison before refresh", () => {
  assert.match(pageSource, /Compare professional profile/);
  assert.match(pageSource, /Apply Selected Updates/);
});

test("8. discovery results expose a professional-profile reference", () => {
  assert.match(pageSource, /View LinkedIn Profile/);
  assert.match(pageSource, /PDL sourced professional profile/);
  assert.match(pageSource, /target="_blank"/);
});

test("9. approved records retain PDL source and neutral contact state", () => {
  assert.match(discoveryRoute, /discoverySource: "PDL"/);
  assert.match(schemaSource, /email: text\("email"\)\.notNull\(\)\.default\(""\)/);
  assert.match(schemaSource, /phone: text\("phone"\)\.notNull\(\)\.default\(""\)/);
});

test("10. approved alumni expose selective Lusha actions", () => {
  assert.match(pageSource, /Get Email/);
  assert.match(pageSource, /Get Phone/);
  assert.match(pageSource, /Get Both/);
});

test("11. Lusha stores channel source and provider history", () => {
  assert.match(providerSource, /emailSource: "Lusha"/);
  assert.match(providerSource, /phoneSource: "Lusha"/);
  assert.match(enrichmentRoute, /providerResponseHistory/);
});

test("12. approved PDL changes create field history", () => {
  assert.match(discoveryRoute, /fieldChangeHistory/);
  assert.match(discoveryRoute, /oldValue/);
  assert.match(discoveryRoute, /newValue/);
});

test("13. no-change refresh is visible and still recorded", () => {
  assert.match(pageSource, /No professional changes detected/);
  assert.match(discoveryRoute, /Compared, no changes/);
  assert.match(discoveryRoute, /providerResponseHistory/);
});

test("14. filtering the internal dataset has no provider call", () => {
  const filterBlock = pageSource.match(/const filtered = useMemo\([\s\S]*?\[alumni, companyPriorities, engagements, filters\]\)/)?.[0] ?? "";
  assert.match(filterBlock, /matchesInternalFilters/);
  assert.doesNotMatch(filterBlock, /fetch\(/);
});

test("15. external usage is attached to explicit buttons", () => {
  assert.match(pageSource, /onClick=\{\(\) => discoverMoreAlumni\(\)\}/);
  assert.match(pageSource, /Confirm Live Search/);
  assert.match(pageSource, /Prepare Email Reveal/);
  assert.match(pageSource, /Confirm Contact Search/);
  assert.match(pageSource, /Confirm Email-Only Reveal/);
});

test("16. application configuration preserves the current root-hosted defaults", () => {
  const current = config.createAppConfig({});
  assert.equal(current.name, "Corporate Network");
  assert.equal(current.shortName, "CN");
  assert.equal(current.subtitle, "Placement Committee Workspace");
  assert.equal(current.tagline, "Connect alumni relationships to corporate opportunities.");
  assert.equal(current.publicUrl, "http://localhost:3000");
  assert.equal(current.basePath, "");
});

test("17. application configuration supports another brand and a non-root base path", () => {
  const future = config.createAppConfig({
    NEXT_PUBLIC_APP_NAME: "ABC",
    NEXT_PUBLIC_APP_SHORT_NAME: "ABC",
    NEXT_PUBLIC_APP_SUBTITLE: "Placement Committee Workspace",
    NEXT_PUBLIC_APP_TAGLINE: "Future deployment test.",
    NEXT_PUBLIC_APP_PUBLIC_URL: "https://teamsynapse.app/corporate_network/",
    NEXT_PUBLIC_APP_BASE_PATH: "/corporate_network/",
  });
  assert.equal(future.name, "ABC");
  assert.equal(future.publicUrl, "https://teamsynapse.app/corporate_network");
  assert.equal(future.basePath, "/corporate_network");
  assert.equal(config.withBasePath("/api/workspace", future.basePath), "/corporate_network/api/workspace");
  assert.equal(config.withBasePath("/auth/google/callback", future.basePath), "/corporate_network/auth/google/callback");
  assert.equal(config.withBasePath("favicon.svg", future.basePath), "/corporate_network/favicon.svg");
});

test("18. UI, metadata, assets and internal API calls consume centralized configuration", () => {
  assert.match(pageSource, /appConfig\.name/);
  assert.match(pageSource, /appConfig\.tagline/);
  assert.match(pageSource, /apiPath\("\/api\/workspace"\)/);
  assert.doesNotMatch(pageSource, /fetch\("\/api\//);
  assert.match(layoutSource, /metadataBase: new URL\(appConfig\.publicUrl\)/);
  assert.match(layoutSource, /assetPath\("\/favicon\.svg"\)/);
});

test("19. PCOM sees a pending-review entry point only when stored results exist", () => {
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true);
  assert.match(pageSource, /session\.canOperate && pendingDiscoveryCount > 0/);
  assert.match(pageSource, /external alumn\{pendingDiscoveryCount === 1 \? "us" : "i"\} awaiting review/);
  assert.match(pageSource, /Review Results/);
});

test("20. reopening pending results is a stored database read with zero provider credits", () => {
  const getHandler = discoveryRoute.match(/export async function GET\(request: Request\)[\s\S]*?\n}\n\nexport async function POST/)?.[0] ?? "";
  assert.match(getHandler, /reviewStatus, DISCOVERY_REVIEW_STATUS\.pending/);
  assert.match(getHandler, /creditsUsed: 0/);
  assert.match(getHandler, /retrieval: "stored"/);
  assert.doesNotMatch(getHandler, /searchExternalAlumni\(|cleanIimLucknowSchool\(|pdlRemainingCredits\(/);
});

test("21. Review Results uses GET while Discover More Alumni still requires live confirmation", () => {
  const reviewHandler = pageSource.match(/async function reviewPendingDiscoveryResults\(\)[\s\S]*?\n  }\n\n  async function runDiscovery/)?.[0] ?? "";
  assert.match(reviewHandler, /\?view=pending/);
  assert.doesNotMatch(reviewHandler, /method: "POST"|action: "search"/);
  assert.match(pageSource, /setPendingDiscoveryFilters\(searchFilters\)/);
  assert.match(pageSource, /Run live PDL Person Search\?/);
  assert.match(pageSource, /Confirm Live Search/);
});

test("22. pending-review API is available to PCOM operational permission", () => {
  const getHandler = discoveryRoute.match(/export async function GET\(request: Request\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(getHandler, /authorizeRequest\(request, "OPERATE_PCOM"\)/);
});

test("23. pending-review navigation does not expose Admin-only provider controls", () => {
  assert.equal(policy.hasPermission("PCOM", "MANAGE_PROVIDER_SETTINGS"), false);
  assert.match(pageSource, /disabled=\{!session\.canAdminister\}/);
  assert.match(enrichmentRoute, /authorizeRequest\(request, "MANAGE_PROVIDER_SETTINGS"\)/);
});
