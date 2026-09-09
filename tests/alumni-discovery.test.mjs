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
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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

test("4. mock discovery demonstrates five mapped, three new and two possible duplicates", () => {
  assert.match(mockProvider, /slice\(0, 5\)/);
  assert.match(mockProvider, /Isha Malhotra/);
  assert.match(mockProvider, /slice\(5, 7\)/);
  assert.match(providerSource + pageSource + discoveryRoute, /Possible duplicate/);
  assert.match(pageSource, /discoveryCounts\.new/);
});

test("5. new external results require an explicit add action", () => {
  assert.match(pageSource, /Add Selected to Corporate Network/);
  assert.match(discoveryRoute, /action === "approve"/);
});

test("6. possible duplicates cannot use the batch approval path", () => {
  assert.match(discoveryRoute, /result\.matchStatus !== "New"/);
  assert.match(pageSource, /Keep separate/);
});

test("7. mapped alumni support comparison before refresh", () => {
  assert.match(pageSource, /Compare & Refresh/);
  assert.match(pageSource, /Apply selected updates/);
});

test("8. discovery results expose a professional-profile reference", () => {
  assert.match(pageSource, /View LinkedIn Profile/);
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
