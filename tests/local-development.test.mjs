import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const localDevelopment = await import("../lib/local-development.ts")
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const fixture = await readFile(new URL("../scripts/local-development-fixture.sql", import.meta.url), "utf8")
const security = await readFile(new URL("../lib/security.ts", import.meta.url), "utf8")
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8")
const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")

test("local authentication requires both development runtime and the explicit opt-in", () => {
  assert.equal(localDevelopment.localDevelopmentAuthEnabled({ NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "true" }), true)
  assert.equal(localDevelopment.localDevelopmentAuthEnabled({ NODE_ENV: "production", LOCAL_DEV_AUTH_ENABLED: "true" }), false)
  assert.equal(localDevelopment.localDevelopmentAuthEnabled({ NODE_ENV: "development", LOCAL_DEV_AUTH_ENABLED: "false" }), false)
})

test("local authentication accepts loopback hosts only", () => {
  assert.equal(localDevelopment.isLoopbackHost("localhost:3000"), true)
  assert.equal(localDevelopment.isLoopbackHost("127.0.0.1:3000"), true)
  assert.equal(localDevelopment.isLoopbackHost("[::1]:3000"), true)
  assert.equal(localDevelopment.isLoopbackHost("network.teamsynapse.app"), false)
  assert.equal(localDevelopment.isLoopbackHost("localhost.attacker.example"), false)
})

test("local acceptance can select PCOM while invalid local roles fail back to Admin", () => {
  assert.equal(localDevelopment.localDevelopmentSecurityContext({ LOCAL_DEV_AUTH_ROLE: "PCOM" }).role, "PCOM")
  assert.equal(localDevelopment.localDevelopmentSecurityContext({ LOCAL_DEV_AUTH_ROLE: "PCOM" }).userId, 2)
  assert.equal(localDevelopment.localDevelopmentSecurityContext({ LOCAL_DEV_AUTH_ROLE: "ADMIN" }).role, "ADMIN")
  assert.equal(localDevelopment.localDevelopmentSecurityContext({ LOCAL_DEV_AUTH_ROLE: "DEVELOPER" }).role, "ADMIN")
  assert.match(viteConfig, /LOCAL_DEV_AUTH_ROLE/)
  assert.match(viteConfig, /LOCAL_DEV_D1_PERSIST_PATH/)
})

test("local scripts hard-disable every live provider and mail gate", () => {
  const command = packageJson.scripts["dev:local"]
  assert.match(command, /NODE_ENV=development/)
  assert.match(command, /CORESIGNAL_LIVE_ENABLED=false/)
  assert.match(command, /LUSHA_LIVE_ENABLED=false/)
  assert.match(command, /LUSHA_SIGNALS_LIVE_ENABLED=false/)
  assert.match(command, /MAIL_MODE=mock/)
  assert.match(command, /MAIL_LIVE_ENABLED=false/)
  assert.match(command, /--host 127\.0\.0\.1 --port 3000/)
  assert.match(viteConfig, /command === "serve"/)
  assert.match(viteConfig, /NODE_ENV: "development"/)
  assert.match(viteConfig, /LOCAL_DEV_AUTH_ENABLED: "true"/)
  assert.match(viteConfig, /CORESIGNAL_LIVE_ENABLED: localCoresignalDemo \? "true" : "false"/)
  assert.match(viteConfig, /localCoresignalLiveDemoEnabled\(localEnvironment\)/)
  assert.match(viteConfig, /LUSHA_LIVE_ENABLED: "false"/)
  assert.match(viteConfig, /LUSHA_SIGNALS_LIVE_ENABLED: "false"/)
  assert.match(viteConfig, /MAIL_MODE: "mock"/)
  assert.match(viteConfig, /MAIL_LIVE_ENABLED: "false"/)
  assert.match(viteConfig, /GMAIL_SEND_SCOPE_CONFIRMED: "false"/)
})

test("local fixture contains alumnus 15, a recipient, and completed email history", () => {
  assert.match(fixture, /2, 'local-development-pcom', 'Local Development PCOM'/)
  assert.match(fixture, /15, 'local-fixture-sahil-bansal', 'Sahil Bansal'/)
  assert.match(fixture, /sahil\.bansal@example\.test/)
  assert.match(fixture, /'Completed'/)
  assert.match(fixture, /INSERT INTO `engagement_actions`/)
})

test("local authorization is wired through layout and server request authentication", () => {
  assert.match(layout, /localDevelopmentAuthEnabled\(\).*isLoopbackHost/)
  assert.match(security, /localDevelopmentAuthEnabled\(\).*isLoopbackHost/s)
})
