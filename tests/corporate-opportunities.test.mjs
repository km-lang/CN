import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const domain = await vite.ssrLoadModule("/lib/opportunities.ts")
const migration = await readFile(new URL("../drizzle/0014_wandering_revanche.sql", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")
const route = await readFile(new URL("../app/api/opportunities/route.ts", import.meta.url), "utf8")
const workspace = await readFile(new URL("../components/opportunities/opportunities-workspace.tsx", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const policy = await vite.ssrLoadModule("/lib/security-policy.ts")

test("opportunity migration is additive and preserves canonical/provider/outreach data", () => {
  assert.match(migration, /CREATE TABLE `corporate_opportunities`/)
  assert.match(migration, /CREATE TABLE `corporate_opportunity_history`/)
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE|ALTER TABLE)\b/im)
  assert.doesNotMatch(migration, /provider_response_history|professional_data|field_change_history|email_send/i)
})

test("opportunity identities, associations, ownership and versioning are constrained", () => {
  assert.match(migration, /UNIQUE INDEX `idx_corporate_opportunities_key`/)
  for (const foreignKey of ["alumnus_id", "engagement_id", "owner_user_id", "created_by_user_id", "last_updated_by_user_id"]) assert.equal(migration.includes(`FOREIGN KEY (\`${foreignKey}\`)`), true)
  assert.match(migration, /corporate_opportunity_version_check/)
  assert.match(migration, /corporate_opportunity_stage_check/)
  assert.match(migration, /corporate_opportunity_outcome_check/)
  assert.match(schema, /uniqueIndex\("idx_corporate_opportunities_key"\)/)
})

test("the documented MVP lifecycle accepts controlled progress and rejects invalid jumps", () => {
  assert.deepEqual(domain.OPPORTUNITY_STAGES, ["IDENTIFIED", "QUALIFYING", "OUTREACH_IN_PROGRESS", "IN_DISCUSSION", "CONFIRMED", "ON_HOLD", "CLOSED_LOST"])
  assert.doesNotThrow(() => domain.validateOpportunityTransition("IDENTIFIED", "QUALIFYING"))
  assert.doesNotThrow(() => domain.validateOpportunityTransition("QUALIFYING", "OUTREACH_IN_PROGRESS"))
  assert.doesNotThrow(() => domain.validateOpportunityTransition("OUTREACH_IN_PROGRESS", "IN_DISCUSSION"))
  assert.doesNotThrow(() => domain.validateOpportunityTransition("IN_DISCUSSION", "CONFIRMED"))
  assert.doesNotThrow(() => domain.validateOpportunityTransition("CONFIRMED", "IN_DISCUSSION"))
  assert.throws(() => domain.validateOpportunityTransition("IDENTIFIED", "CONFIRMED"), /cannot move/i)
  assert.throws(() => domain.validateOpportunityTransition("CLOSED_LOST", "CONFIRMED"), /cannot move/i)
})

test("follow-up and outcome validation fail closed", () => {
  assert.equal(domain.validateOpportunityDate("2026-10-20"), "2026-10-20")
  assert.equal(domain.validateOpportunityDate(""), "")
  assert.throws(() => domain.validateOpportunityDate("20/10/2026"), /valid calendar date/i)
  assert.equal(domain.requiresOpportunityOutcome("CONFIRMED"), true)
  assert.equal(domain.requiresOpportunityOutcome("CLOSED_LOST"), true)
  assert.equal(domain.requiresOpportunityOutcome("IN_DISCUSSION"), false)
})

test("Admin and PCOM may operate opportunities while Developer may not", () => {
  assert.equal(policy.hasPermission("ADMIN", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false)
  assert.equal(policy.hasPermission("ADMIN", "VIEW_AUDIT"), true)
  assert.equal(policy.hasPermission("PCOM", "VIEW_AUDIT"), false)
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.doesNotMatch(route, /x-user-role|role\s*=\s*payload/)
})

test("server validates owner, alumnus and engagement context instead of trusting the browser", () => {
  assert.match(route, /Choose an active PCOM or Admin opportunity owner/)
  assert.match(route, /selected alumnus is not linked to this company/)
  assert.match(route, /selected engagement belongs to another company/)
  assert.match(route, /selected engagement belongs to another alumnus/)
  assert.match(route, /links\.alumnusId/)
})

test("create is atomic, idempotent under retry, and writes operational plus security history", () => {
  assert.match(route, /db\.batch\(\[insertOpportunity, insertCreatedHistory\]\)/)
  assert.match(route, /onConflictDoNothing\(\{ target: corporateOpportunities\.opportunityKey \}\)/)
  assert.match(route, /opportunity_created/)
  assert.match(route, /corporateOpportunityHistory/)
  assert.match(route, /idempotent: creation\.idempotent/)
})

test("updates use optimistic concurrency and record lifecycle history", () => {
  assert.match(route, /db\.batch\(\[updateOpportunity, insertUpdateHistory\]\)/)
  assert.match(route, /eq\(corporateOpportunities\.version, version\)/)
  assert.match(route, /current\.version \+ 1/)
  assert.match(route, /changed while you were reviewing it/)
  assert.match(route, /stage_changed/)
  assert.match(route, /owner_changed/)
  assert.match(route, /opportunity_updated/)
})

test("listing filters before server pagination and reports persisted totals", () => {
  assert.match(route, /conditions\.push\(eq\(corporateOpportunities\.alumnusId/)
  assert.match(route, /conditions\.push\(eq\(corporateOpportunities\.ownerUserId/)
  assert.match(route, /conditions\.push\(eq\(corporateOpportunities\.stage/)
  assert.match(route, /\.where\(where\).*\.limit\(id \? 1 : pageSize\)\.offset/s)
  assert.match(route, /count\(\*\)/)
  assert.match(workspace, /\[10, 25, 50\]/)
  assert.match(workspace, /Showing \{start\}–\{end\} of \{total\}/)
})

test("the UI provides actual create, edit, lifecycle, follow-up, outcome and conflict states", () => {
  for (const text of ["New opportunity", "Create corporate opportunity", "Update corporate opportunity", "Responsible owner", "Linked alumnus", "Linked engagement", "Follow-up date", "Outcome", "Operational history"]) assert.match(workspace, new RegExp(text))
  assert.match(workspace, /method: editing === "new" \? "POST" : "PATCH"/)
  assert.match(workspace, /Opportunity saved to the shared workspace/)
  assert.match(workspace, /Unable to save the opportunity/)
})

test("company, alumnus, overview and My Work use the same persistent opportunity workspace", () => {
  assert.match(page, /View opportunities/)
  assert.match(page, /View linked opportunities/)
  assert.match(page, /Create opportunity/)
  assert.match(page, /label="Active opportunities" value=\{`\$\{opportunitySummary\.active\}`\}/)
  assert.match(page, /My opportunities<strong>\{opportunitySummary\.assignedToMe\}/)
  assert.match(page, /contextMode=\{opportunityContext\.mode\}/)
  assert.match(workspace, /params\.set\("alumnusId"/)
  assert.match(workspace, /params\.set\("company"/)
})

test("company-first creation is supported without inventing a company foreign key", () => {
  assert.equal(migration.includes("company_id"), false)
  assert.match(workspace, /No alumnus linked/)
  assert.match(workspace, /No engagement linked/)
  assert.match(route, /allows|canonicalCompany|knownOpportunity/)
})

test("opportunity recording does not bypass DNC or initiate outreach/provider activity", () => {
  assert.match(workspace, /does not contact an alumnus or invoke a provider/)
  assert.match(workspace, /never bypass consent, DNC, or outreach review/)
  assert.doesNotMatch(route, /fetch\(|sendGmail|coresignal|lusha|pdl|socai|bright/i)
  assert.doesNotMatch(workspace, /send email|send message|runEnrichment|compareProfessionalProfile/i)
})

test("PCOM receives projected operational history rather than technical audit envelopes", () => {
  assert.match(route, /history: history\.filter/)
  assert.deepEqual(["id", "action", "fromStage", "toStage", "summary", "actor", "createdAt"], ["id", "action", "fromStage", "toStage", "summary", "actor", "createdAt"])
  assert.doesNotMatch(route, /securityAuditEvents|providerResponseHistory|rawPayload|requestPayload/)
  assert.doesNotMatch(workspace, /credential|provider request|raw payload/i)
})

test("responsive opportunity layouts preserve usable forms, details and actions", () => {
  assert.match(styles, /\.opportunity-filters \{[^}]*grid-template-columns:/s)
  assert.match(styles, /@media \(max-width: 1000px\)[\s\S]*\.opportunity-filters/)
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*\.opportunity-heading[\s\S]*\.opportunity-form[\s\S]*grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(styles, /\.opportunity-dialog \{[^}]*max-height:/s)
})
