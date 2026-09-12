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
  const query = JSON.stringify(helper.buildPdlQuery(filters));
  assert.match(query, /education\.school\.name/);
  assert.match(query, /indian institute of management lucknow/);
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
  assert.match(pageSource, /View profile/);
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
  assert.match(pageSource, /onClick=\{\(\) => void discoverMoreAlumni\(\)\}/);
  assert.equal(pageSource.includes('runEnrichment([result.linkedInternalAlumnusId!], ["lusha"], "manual"'), true);
});

test("16. application configuration preserves the current root-hosted defaults", () => {
  const current = config.createAppConfig({});
  assert.equal(current.name, "Corporate Network");
  assert.equal(current.shortName, "CN");
  assert.equal(current.subtitle, "Placement Committee Workspace");
  assert.equal(current.tagline, "Connect alumni relationships to corporate opportunities.");
  assert.equal(current.publicUrl, "https://iiml-alumni-intelligence.dokina-ramakrishna.chatgpt.site");
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
