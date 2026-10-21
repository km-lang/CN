import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const localDevelopment = await import("../lib/local-development.ts")
const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts")
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8")
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const adminRoute = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const client = await readFile(new URL("../lib/coresignal-client.ts", import.meta.url), "utf8")

const environmentKeys = [
  "NODE_ENV",
  "LOCAL_DEV_AUTH_ENABLED",
  "LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED",
  "LOCAL_CORESIGNAL_LIVE_DEMO_HOST",
  "CORESIGNAL_LIVE_ENABLED",
  "CORESIGNAL_API_KEY",
  "CORESIGNAL_LIVE_SEARCH_MAX_RESULTS",
  "CORESIGNAL_LIVE_REFRESH_MAX_PROFILES",
]
const originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))

after(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await vite.close()
})

function demoEnvironment(overrides = {}) {
  return {
    NODE_ENV: "development",
    LOCAL_DEV_AUTH_ENABLED: "true",
    LOCAL_DEV_AUTH_ROLE: "ADMIN",
    LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "true",
    LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1",
    CORESIGNAL_LIVE_ENABLED: "true",
    CORESIGNAL_API_KEY: "placeholder-test-key",
    ...overrides,
  }
}

function setRuntimeEnvironment(values) {
  for (const key of environmentKeys) delete process.env[key]
  Object.assign(process.env, values)
}

test("the explicit local Coresignal gate requires every fail-closed condition", () => {
  assert.equal(localDevelopment.localCoresignalLiveDemoEnabled(demoEnvironment()), true)
  assert.equal(localDevelopment.localCoresignalLiveDemoEnabled(demoEnvironment({ CORESIGNAL_API_KEY: "" })), false)
  assert.equal(localDevelopment.localCoresignalLiveDemoEnabled(demoEnvironment({ LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "false" })), false)
  assert.equal(localDevelopment.localCoresignalLiveDemoEnabled(demoEnvironment({ LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "network.teamsynapse.app" })), false)
  assert.equal(localDevelopment.localCoresignalLiveDemoEnabled(demoEnvironment({ NODE_ENV: "production" })), false)
})

test("runtime enables only Coresignal and enforces one-result local demo limits", () => {
  setRuntimeEnvironment(demoEnvironment({ CORESIGNAL_LIVE_SEARCH_MAX_RESULTS: "20", CORESIGNAL_LIVE_REFRESH_MAX_PROFILES: "20" }))
  assert.equal(runtime.providerMode("coresignal"), "live")
  assert.equal(runtime.providerConfigured("coresignal"), true)
  assert.equal(runtime.providerMode("lusha"), "mock")
  assert.equal(runtime.coresignalLiveSearchMaximum(), 1)
  assert.equal(runtime.coresignalLiveRefreshMaximum(), 1)

  setRuntimeEnvironment(demoEnvironment({ CORESIGNAL_API_KEY: "" }))
  assert.equal(runtime.providerMode("coresignal"), "mock")
  setRuntimeEnvironment(demoEnvironment({ LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "false" }))
  assert.equal(runtime.providerMode("coresignal"), "mock")
})

test("normal local development stays mock and the named demo command is loopback-only", () => {
  const normal = packageJson.scripts["dev:local"]
  const demo = packageJson.scripts["dev:local:coresignal-live"]
  assert.match(normal, /CORESIGNAL_LIVE_ENABLED=false/)
  assert.doesNotMatch(normal, /LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED=true/)
  assert.match(demo, /LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED=true/)
  assert.match(demo, /LOCAL_CORESIGNAL_LIVE_DEMO_HOST=127\.0\.0\.1/)
  assert.match(demo, /CORESIGNAL_LIVE_SEARCH_MAX_RESULTS=1/)
  assert.match(demo, /CORESIGNAL_LIVE_REFRESH_MAX_PROFILES=1/)
  assert.match(demo, /LUSHA_LIVE_ENABLED=false/)
  assert.match(demo, /LUSHA_SIGNALS_LIVE_ENABLED=false/)
  assert.match(demo, /MAIL_LIVE_ENABLED=false/)
  assert.match(demo, /GMAIL_SEND_SCOPE_CONFIRMED=false/)
  assert.match(demo, /--host 127\.0\.0\.1/)
  assert.doesNotMatch(demo, /CORESIGNAL_API_KEY=/)
  const manual = packageJson.scripts["dev:local:coresignal-manual-live"]
  assert.match(manual, /CORESIGNAL_SEARCH_ENABLED=true/)
  assert.match(manual, /CORESIGNAL_COLLECT_ENABLED=true/)
  assert.match(manual, /LOCAL_DEV_AUTH_ROLE=ADMIN/)
  assert.match(manual, /CORESIGNAL_LIVE_SEARCH_MAX_RESULTS=1/)
  assert.match(manual, /LUSHA_LIVE_ENABLED=false/)
  assert.match(manual, /LUSHA_SIGNALS_LIVE_ENABLED=false/)
  assert.match(manual, /MAIL_LIVE_ENABLED=false/)
  assert.match(manual, /--host 127\.0\.0\.1/)
  assert.doesNotMatch(manual, /CORESIGNAL_API_KEY=/)
})

test("mock discovery cannot write the original local D1 when live execution is off", () => {
  const normal = {
    NODE_ENV: "development",
    LOCAL_DEV_AUTH_ENABLED: "true",
    LOCAL_DEV_AUTH_ROLE: "ADMIN",
    CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "false",
    LOCAL_DEV_D1_PERSIST_PATH: "",
  }
  assert.equal(localDevelopment.localIsolatedDiscoveryMockEnabled(normal), false)
  assert.equal(localDevelopment.localIsolatedDiscoveryMockEnabled({ ...normal, CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", LOCAL_DEV_D1_PERSIST_PATH: "/private/tmp/cn-isolated-demo" }), true)
  assert.equal(localDevelopment.localIsolatedDiscoveryMockEnabled({ ...normal, CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", LOCAL_DEV_D1_PERSIST_PATH: "/private/tmp/../original" }), false)
  assert.equal(localDevelopment.localIsolatedDiscoveryMockEnabled({ ...normal, CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", LOCAL_DEV_D1_PERSIST_PATH: "/private/tmp/cn-isolated-demo", LOCAL_DEV_AUTH_ROLE: "PCOM" }), false)
  assert.equal(localDevelopment.localIsolatedDiscoveryMockEnabled({ ...normal, CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", LOCAL_DEV_D1_PERSIST_PATH: "/private/tmp/cn-isolated-demo", NODE_ENV: "production" }), false)
  assert.match(discoveryRoute, /if \(coresignalProvider\.mode\(\) === "mock" && !localIsolatedDiscoveryMockEnabled\(providerRuntimeEnvironment\)\) return Response\.json\(/)
  assert.match(discoveryRoute, /reason: "isolated_mock_database_required"/)
  assert.match(page, /disabled=\{discovering \|\| !discoveryCountValidation\.ok \|\| mockBlocked\}/)
  assert.match(page, /findMoreForCompany\(activeTargetCompany\)\} disabled=\{discovering \|\| \(providerModes\.coresignal === "mock" && !mockDiscoveryEnabled\)\}/)
})

test("the local key stays in ignored server-only configuration", () => {
  assert.match(gitignore, /^\.env\*/m)
  assert.match(envExample, /^CORESIGNAL_API_KEY=$/m)
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_CORESIGNAL/)
  assert.doesNotMatch(page, /CORESIGNAL_API_KEY/)
  assert.match(viteConfig, /vars: localRuntimeVariables/)
  assert.match(viteConfig, /localEnvironment\.CORESIGNAL_API_KEY\?\.trim\(\) \?\? ""/)
  assert.match(viteConfig, /GMAIL_SEND_SCOPE_CONFIRMED: "false"/)
  assert.doesNotMatch(viteConfig, /NEXT_PUBLIC_CORESIGNAL/)
})

test("readiness is metadata-only and reports both demo maxima", () => {
  assert.match(adminRoute, /searchMaximum: coresignalLiveSearchMaximum\(\)/)
  assert.match(adminRoute, /refreshMaximum: coresignalLiveRefreshMaximum\(\)/)
  assert.doesNotMatch(adminRoute, /searchCoresignalIiml|collectCoresignalEmployee|coresignalProvider\.(searchCandidates|refreshProfile)/)
})

test("opening live confirmation is call-free and only its explicit action executes", () => {
  const discoveryEntry = page.match(/function discoverMoreAlumni[\s\S]*?async function reviewPendingDiscoveryResults/)?.[0] ?? ""
  assert.match(discoveryEntry, /setPendingDiscoveryFilters\(searchFilters\)/)
  assert.match(discoveryEntry, /return/)
  assert.doesNotMatch(discoveryEntry, /fetch\(/)
  assert.match(page, /onClick=\{\(\) => pendingDiscoveryFilters && void runDiscovery\(pendingDiscoveryFilters\)\}[\s\S]*Confirm One Preview Request/)
  assert.match(page, /onClick=\{\(\) => void runProfileRefresh\(\)\}[\s\S]*Run Refresh/)
})

test("the validated Coresignal API and review workflow remain unchanged", () => {
  assert.match(client, /https:\/\/api\.coresignal\.com/)
  assert.match(client, /\/cdapi\/v2\/employee_base\/search\/filter\/preview/)
  assert.match(client, /\/cdapi\/v2\/employee_base\/search\/es_dsl\/preview/)
  assert.match(client, /\/cdapi\/v2\/employee_base\/collect"/)
  assert.match(client, /apikey:/)
  assert.doesNotMatch(client, /Authorization|Bearer/)
  assert.match(discoveryRoute, /action === "approve"/)
  assert.match(page, /Confirm one Base Employee ES-DSL Preview request/)
  assert.match(page, /1 Preview · 0 Collect/)
})
