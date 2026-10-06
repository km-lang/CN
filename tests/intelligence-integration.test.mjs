import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const navigation = await vite.ssrLoadModule("/lib/intelligence-navigation.ts")
const workspaceNavigation = await vite.ssrLoadModule("/lib/controlled-email-navigation.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const client = await readFile(new URL("../lib/intelligence-service.server.ts", import.meta.url), "utf8")
const cohort = await readFile(new URL("../lib/intelligence-cohort.server.ts", import.meta.url), "utf8")
const refresh = await readFile(new URL("../components/intelligence/refresh-center.tsx", import.meta.url), "utf8")
const reviews = await readFile(new URL("../components/intelligence/review-changes.tsx", import.meta.url), "utf8")
const discovery = await readFile(new URL("../components/intelligence/alumni-discovery.tsx", import.meta.url), "utf8")
const profile = await readFile(new URL("../components/intelligence/profile-intelligence-panel.tsx", import.meta.url), "utf8")

test("Intelligence is query-authoritative and preserves existing navigation cleanup", () => {
  assert.equal(navigation.intelligenceView("?tab=intelligence&view=reviews"), "reviews")
  assert.equal(navigation.intelligenceView("?tab=intelligence&view=invalid"), "refresh")
  assert.equal(navigation.intelligenceViewUrl("https://network.example/?tab=directory&profileAlumnusId=15", "discovery"), "/?tab=intelligence&view=discovery")
  assert.equal(workspaceNavigation.workspaceTabUrl("https://network.example/?tab=intelligence&view=reviews", "directory"), "/?tab=directory")
  assert.match(page, /TabsTrigger value="intelligence">Intelligence/)
})

test("service credential remains in the server adapter and is never referenced by client components", () => {
  assert.match(client, /process\.env\.INTELLIGENCE_SERVICE_SECRET/)
  assert.match(client, /authorization: `Bearer \$\{secret\}`/)
  for (const source of [page, refresh, reviews, discovery, profile]) {
    assert.doesNotMatch(source, /INTELLIGENCE_SERVICE_SECRET|BRIGHT_DATA_API_TOKEN|SOCAI_EXECUTABLE/)
  }
})

test("local development forwards intelligence configuration only as server runtime variables", async () => {
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
  assert.match(viteConfig, /INTELLIGENCE_SERVICE_URL: process\.env\.INTELLIGENCE_SERVICE_URL\.trim\(\)/)
  assert.match(viteConfig, /INTELLIGENCE_SERVICE_SECRET: process\.env\.INTELLIGENCE_SERVICE_SECRET\.trim\(\)/)
  assert.doesNotMatch(viteConfig, /NEXT_PUBLIC_INTELLIGENCE/)
})

test("Directory selections are materialized into a fixed intelligence cohort", () => {
  assert.match(page, /selectedForIntelligence/)
  assert.match(page, /Use current page/)
  assert.match(page, /Use all matching/)
  assert.match(cohort, /sourceId|\/v1\/alumni\/resolve/)
  assert.match(refresh, /cohortType: scope === "dynamic" \? "DYNAMIC_FILTER" : "FIXED_COHORT"/)
})

test("Refresh preview is explicitly non-mutating and supports score operators", () => {
  assert.match(refresh, /Canonical mutations/)
  assert.match(refresh, /No provider call or canonical mutation occurs during preview/)
  for (const operator of ["EQ", "GT", "GTE", "LT", "LTE", "BETWEEN"]) assert.match(refresh, new RegExp(`"${operator}"`))
})

test("review decisions preview before apply and unresolved ACCEPT is disabled", () => {
  assert.match(reviews, /preview-decision|action: apply \? "decide" : "preview"/)
  assert.match(reviews, /disabled=\{selected\?\.kind === "UNRESOLVED"\}/)
  assert.match(reviews, /Confirm \{String\(preview\.decision\)\}/)
})

test("live discovery is disabled and staged verification does not imply CN mutation", () => {
  assert.match(discovery, /Live Bright discovery unavailable/)
  assert.match(discovery, /disabled title=\{readiness\?\.reason\}/)
  assert.match(discovery, /No Corporate Network alumnus was created or changed/)
})

test("profile panel uses the accurate Last Bright attempt label", () => {
  assert.match(profile, /Last Bright attempt/)
  assert.doesNotMatch(profile, /Last Bright refresh/)
  assert.match(profile, /Find LinkedIn profile/)
})
