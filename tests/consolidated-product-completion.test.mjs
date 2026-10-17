import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const login = await vite.ssrLoadModule("/lib/login-intent.ts")
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8")
const adminLogin = await readFile(new URL("../app/login/admin/route.ts", import.meta.url), "utf8")
const pcomLogin = await readFile(new URL("../app/login/pcom/route.ts", import.meta.url), "utf8")
const landing = await readFile(new URL("../app/auth/landing/route.ts", import.meta.url), "utf8")
const enrichment = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")
const discovery = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const engagement = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")
const opportunities = await readFile(new URL("../app/api/opportunities/route.ts", import.meta.url), "utf8")
const opportunityMigration = await readFile(new URL("../drizzle/0014_wandering_revanche.sql", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")

test("dedicated Admin and PCOM login entries preserve server-resolved authority", () => {
  assert.match(layout, /primaryHref=\{loginPath\("pcom"\)\}/)
  assert.match(layout, /secondaryHref=\{loginPath\("admin"\)\}/)
  assert.match(layout, /sessionRejected \? `\/auth\/session\/recover\?intent=\$\{intent\}` : `\/login\/\$\{intent\}`/)
  assert.match(adminLogin, /loginEntryResponse\(request, "admin"\)/)
  assert.match(pcomLogin, /loginEntryResponse\(request, "pcom"\)/)
  assert.match(landing, /authenticateRequest\(request\)/)
  assert.match(landing, /landingForRole\(context\.role, intent\)/)
})

test("Admin intent is fail-closed and lands an authorized Admin in administration", () => {
  assert.deepEqual(login.landingForRole("ADMIN", "admin"), { allowed: true, destination: "/?tab=admin" })
  assert.equal(login.roleHome("ADMIN"), "/?tab=admin")
  assert.equal(login.landingForRole("PCOM", "admin").allowed, false)
  assert.equal(login.landingForRole("DEVELOPER", "admin").allowed, false)
})

test("PCOM intent allows operational roles without changing their persisted role", () => {
  assert.deepEqual(login.landingForRole("PCOM", "pcom"), { allowed: true, destination: "/?tab=overview" })
  assert.equal(login.roleHome("PCOM"), "/?tab=overview")
  assert.deepEqual(login.landingForRole("ADMIN", "pcom"), { allowed: true, destination: "/?tab=overview" })
  assert.equal(login.landingForRole("DEVELOPER", "pcom").allowed, false)
})

test("Provider History is serialized only to Admin while PCOM gets bounded resume metadata", () => {
  assert.match(enrichment, /history: context\.role === "ADMIN" \? history\.map\(presentProviderHistorySearchEvidence\)\.map\(presentProviderHistoryCollectEvidence\) : \[\]/)
  assert.match(enrichment, /historyRestricted: context\.role !== "ADMIN"/)
  assert.match(enrichment, /contactResume/)
  assert.doesNotMatch(enrichment.match(/contactResume = [\s\S]*?return Response\.json/)?.[0] ?? "", /requestSummary|errorMessage|searchEvidence/)
})

test("Stored discovery history and Search evidence are Admin-only server responses", () => {
  assert.match(discovery, /providerHistory: context\.role === "ADMIN" \? activeProviderHistory : \[\]/)
  assert.match(discovery, /context\.role === "ADMIN" \? \{ historyId: completed\.persisted\.id, searchEvidence: completed\.evidence \} : \{\}/)
  assert.match(discovery, /providerHistory: context\.role === "ADMIN" \? \[history\] : \[\]/)
})

test("PCOM UI exposes operational work but not the administrative provider trail", () => {
  assert.match(page, /session\.role === "PCOM" && <section className="panel pcom-work-panel"/)
  assert.match(page, /Assigned actions and follow-ups/)
  assert.match(page, /session\.canAdminister \? <section className="panel history-panel"/)
  assert.match(page, /Administrative provider history is restricted/)
  assert.match(page, /session\.canAdminister && providerHistory\.filter/)
})

test("Admin navigation is administration-first without weakening Developer restrictions", () => {
  const tabs = page.match(/<TabsList[\s\S]*?<\/TabsList>/)?.[0] ?? ""
  assert.ok(tabs.indexOf('value="admin"') < tabs.indexOf('value="overview"'))
  assert.match(tabs, /session\.canAdminister && <TabsTrigger value="admin"/)
  assert.match(page, /session\.canOperate && <TabsTrigger value="engagement"/)
})

test("responsible-owner assignment validates an active operational user and is concurrency-safe", () => {
  assert.match(engagement, /payload\.action === "assign_to"/)
  assert.match(engagement, /\["ADMIN", "PCOM"\]\.includes\(assignee\.role\)/)
  assert.match(engagement, /eq\(engagementEvents\.assignedTo, event\.assignedTo\)/)
  assert.match(engagement, /Ownership changed while you were reviewing/)
  assert.match(page, /Responsible owner/)
  assert.match(page, /postEngagement\("assign_to"/)
})

test("Corporate Opportunities use additive persistent schema and server-authorized APIs", () => {
  assert.match(schema, /export const corporateOpportunities = sqliteTable\("corporate_opportunities"/)
  assert.match(schema, /export const corporateOpportunityHistory = sqliteTable\("corporate_opportunity_history"/)
  assert.match(opportunityMigration, /CREATE TABLE `corporate_opportunities`/)
  assert.match(opportunityMigration, /CREATE TABLE `corporate_opportunity_history`/)
  assert.match(opportunities, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(opportunities, /db\.batch\(\[insertOpportunity, insertCreatedHistory\]\)/)
  assert.match(opportunities, /eq\(corporateOpportunities\.version, version\)/)
  assert.match(schema, /export const engagementEvents = sqliteTable/)
  assert.match(schema, /export const engagementActions = sqliteTable/)
})
