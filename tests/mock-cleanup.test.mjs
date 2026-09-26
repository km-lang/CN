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

const { classifyMockDataset } = await vite.ssrLoadModule("/lib/mock-cleanup.ts");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const engagements = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8");
const admin = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");

function fixture() {
  return {
    alumni: [
      { id: 1, source: "Demonstration alumni dataset", profileKey: "seed-one", company: "ITC" },
      { id: 13, source: "People Data Labs", profileKey: "engagement-demo|person|2017|google", company: "Google" },
      { id: 14, source: "People Data Labs", profileKey: "pdl:new 1", company: "Amazon" },
      { id: 99, source: "Manual entry", profileKey: "manual:approved-real", company: "Real Company" },
    ],
    companyPriorities: [{ company: "ITC" }],
    activityLog: [
      { id: 1, entityType: "alumni", entityId: "Demonstration alumni dataset" },
      { id: 2, entityType: "alumnus", entityId: "14" },
    ],
    alumniRelationships: [{ id: 1, intermediaryAlumnusId: 1, targetAlumnusId: 13 }],
    birthdayData: [{ id: 1, alumnusId: 1 }],
    communicationPreferences: [{ id: 1, alumnusId: 1 }],
    engagementEvents: [
      { id: 1, alumnusId: 1, eventType: "Birthday" },
      { id: 2, alumnusId: 13, eventType: "Professional Signal" },
    ],
    engagementActions: [{ id: 1, eventId: 1, alumnusId: 1 }],
    engagementResponses: [],
    eventViews: [{ id: 1, eventId: 2 }],
    engagementAuditLog: [{ id: 1, eventId: 1 }],
    externalDiscoverySearches: [
      { id: 1, mode: "mock", creditsUsed: 10 },
      { id: 2, mode: "live", creditsUsed: 5 },
    ],
    externalDiscoveryResults: [
      { id: 1, searchId: 1, linkedInternalAlumnusId: 14 },
      ...Array.from({ length: 5 }, (_, index) => ({ id: index + 2, searchId: 2, linkedInternalAlumnusId: null })),
    ],
    providerResponseHistory: [
      { id: 1, mode: "mock", alumnusId: 1, searchId: 1, creditsUsed: 10, operation: "Person Search" },
      { id: 2, mode: "live", alumnusId: null, searchId: 2, creditsUsed: 5, operation: "Person Search" },
    ],
    providerRefreshReviews: [{ id: 1, providerResponseId: 1, alumnusId: 1 }],
    fieldChangeHistory: [{ id: 1, alumnusId: 13 }],
    importRuns: [{ id: 1, filename: "Demonstration alumni dataset" }],
    alumniPrivacyControls: [],
    alumniDataLifecycle: [],
  };
}

test("mock cleanup 1: explicit sources, fixture keys and mock-search links identify demo alumni", () => {
  const result = classifyMockDataset(fixture());
  assert.deepEqual(result.ids.alumni, [1, 13, 14]);
  assert.equal(result.ids.alumni.includes(99), false);
  assert.deepEqual(result.ambiguous, []);
});

test("mock cleanup 2: live PDL review evidence and five real credits are retained", () => {
  const result = classifyMockDataset(fixture());
  assert.equal(result.retained.liveDiscoveryResults, 5);
  assert.equal(result.retained.liveSearchCredits, 5);
  assert.equal(result.retained.liveProviderCredits, 5);
  assert.deepEqual(result.ids.externalDiscoverySearches, [1]);
  assert.deepEqual(result.ids.providerResponseHistory, [1]);
});

test("mock cleanup 3: relational demo business data is classified without using names", () => {
  const result = classifyMockDataset(fixture());
  assert.equal(result.counts.companies, 1);
  assert.equal(result.counts.birthdays, 1);
  assert.equal(result.counts.professionalSignals, 1);
  assert.equal(result.counts.relationships, 1);
  assert.equal(result.counts.engagementOutreach, 5);
});

test("mock cleanup 4: ambiguous orphan company data stops execution", () => {
  const input = fixture();
  input.companyPriorities.push({ company: "Unclassified Company" });
  const result = classifyMockDataset(input);
  assert.equal(result.ambiguous.length, 1);
  assert.match(result.ambiguous[0], /no explicitly classified alumni provenance/);
});

test("mock cleanup 5: production UI does not repopulate demo data after an empty response", () => {
  assert.doesNotMatch(page, /const alumniSeed|const companyPrioritySeed|Demonstration alumni dataset/);
  assert.doesNotMatch(engagements, /ensureDemoEngagements|engagement-demo|mock-seeded/);
  assert.doesNotMatch(page, /useState\("Google"\)/);
  assert.doesNotMatch(page, /Two recruiter conversations recorded|Summer placement participation confirmed/);
  assert.match(page, /setAlumni\(data\.alumni \?\? \[\]\)/);
  assert.match(page, /No mapped alumni match these filters/);
  assert.match(page, /No companies are mapped yet/);
});

test("mock cleanup 6: deletion is Admin-only, typed, audited and uses D1-compatible integrity checks", () => {
  const cleanupBlock = admin.match(/if \(payload\.action === "remove_mock_dataset"\)[\s\S]*?if \(payload\.action === "authorize_user"\)/)?.[0] ?? "";
  assert.match(admin, /authorizeRequest\(request, "MANAGE_USERS"\)/);
  assert.match(cleanupBlock, /payload\.confirmation !== "CLEANUP"/);
  assert.match(cleanupBlock, /mock_dataset_removed/);
  assert.match(cleanupBlock, /production transition to real-data pilot/);
  assert.match(admin, /PRAGMA quick_check/);
  assert.match(cleanupBlock, /PRAGMA foreign_key_check/);
  assert.doesNotMatch(admin, /PRAGMA integrity_check/);
  assert.doesNotMatch(cleanupBlock, /delete\(applicationUsers\)|delete\(applicationIdentities\)|delete\(securityAuditEvents\)/);
});
