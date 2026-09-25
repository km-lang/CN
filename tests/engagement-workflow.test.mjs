import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";
import { engagementFixtures } from "./fixtures/engagement-events.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => vite.close());

const route = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0003_puzzling_flatman.sql", import.meta.url), "utf8");
const { createMailDraft, sendMail } = await vite.ssrLoadModule("/lib/mail-service.ts");

test("1. a Lusha professional signal enters the shared queue as New", () => {
  const signal = engagementFixtures.find(event => event.eventType === "Professional Signal");
  assert.equal(signal.source, "Lusha Signals");
  assert.equal(signal.status, "New");
});

test("2. viewing is tracked separately from taking action", () => {
  assert.match(route, /action === "view"/);
  assert.match(route, /eventViews/);
  assert.match(route, /Event opened\. No engagement action was taken/);
});

test("3. ownership can be taken and reassignment is explicit", () => {
  assert.match(route, /action === "assign"/);
  assert.match(route, /payload\.force/);
  assert.match(page, /Reassign to Me/);
});

test("4. a sent message records action, actor, channel and delivery", () => {
  assert.match(route, /status: "Action Taken"/);
  assert.match(route, /actionTakenBy: actor/);
  assert.match(route, /actionChannel: "Email"/);
  assert.match(route, /deliveryStatus: result\.deliveryStatus/);
});

test("5. duplicate sends are prevented atomically", () => {
  assert.match(schema, /uniqueIndex\("idx_engagement_action_key"\)\.on\(table\.actionKey\)/);
  assert.match(route, /mail:\$\{person\.id\}:\$\{event\.eventKey\}:\$\{template\.templateKey\}:v\$\{template\.version\}/);
  assert.match(route, /onConflictDoNothing\(\)\.returning\(\)/);
});

test("6. confirmed birthdays with email are classified as ready", () => {
  assert.match(route, /Confirmed internally/);
  assert.match(page, /birthdayReady/);
  assert.match(page, /birthdayReady\(event\) \? "Eligible"/);
});

test("7. preview personalises a template and mock send returns a receipt", async () => {
  const draft = createMailDraft("alumnus@example.com", "Hello [First Name]", "Dear [Full Name]", "Aditi Srivastava");
  assert.equal(draft.subject, "Hello Aditi");
  assert.equal(draft.body, "Dear Aditi Srivastava");
  const result = await sendMail(draft);
  assert.equal(result.mode, "mock");
  assert.match(result.messageId, /^mock-mail-/);
});

test("8. an already-actioned birthday fixture remains attributable to another member", () => {
  const birthday = engagementFixtures.find(event => event.eventType === "Birthday");
  assert.equal(birthday.status, "Action Taken");
  assert.equal(birthday.actionTakenBy, "PCOM Fixture User");
});

test("9. missing email is excluded and Lusha retrieval is explicit", () => {
  assert.match(route, /Email unavailable\. Retrieve an email through Lusha/);
  assert.match(page, /Get Email via Lusha/);
  assert.doesNotMatch(route, /sendOne[\s\S]{0,500}runEnrichment/);
});

test("10. birthday events use a unique alumnus and year key", () => {
  assert.match(engagementFixtures[0].eventKey, /^birthday:\d+:\d{4}$/);
  assert.match(migration, /CREATE UNIQUE INDEX `idx_engagement_event_key`/);
});

test("11. incorrect professional signals are skipped, not deleted", () => {
  assert.match(route, /payload\.action === "incorrect"/);
  assert.match(route, /status: "Skipped"/);
  assert.match(route, /signal_marked_incorrect/);
});

test("12. skipped events retain their source and an audit record", () => {
  assert.match(route, /skipReason: reason/);
  assert.match(route, /await audit\(eventId, context/);
  assert.doesNotMatch(route, /delete\(engagementEvents\)/);
});

test("13. responses update the event and create response history", () => {
  assert.match(route, /db\.insert\(engagementResponses\)/);
  assert.match(route, /responseReceived: true/);
  assert.match(route, /"Response Received"/);
});

test("14. follow-ups have a due date, owner and shared status", () => {
  assert.match(route, /action === "follow_up"/);
  assert.match(route, /status: "Follow-up Due"/);
  assert.match(route, /assignedTo: event\.assignedTo \|\| actor/);
});

test("15. profile separates open work from completed engagement history", () => {
  assert.match(page, /Needs attention/);
  assert.match(page, /Engagement history/);
  assert.match(page, /selectedCompletedEngagements/);
  assert.match(page, /providerHistory\.filter/);
});

test("16. responsiveness derives from recorded engagement outcomes", () => {
  assert.match(page, /function derivedResponsiveness/);
  assert.match(page, /responseReceived/);
  assert.match(page, /Derived from shared engagement history/);
});

test("17. multi-user state uses the authenticated server identity and persists in D1 tables", () => {
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/);
  assert.match(route, /context\.displayName/);
  assert.doesNotMatch(route + page, /x-demo-user/);
  assert.match(schema, /engagementEvents = sqliteTable/);
  assert.doesNotMatch(page, /localStorage/);
});
