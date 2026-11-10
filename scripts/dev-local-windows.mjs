import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, realpath } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Use existing session-backed local auth and fixtures, with a NEW D1 each launch.
// Never seed .wrangler/state or trust an inherited database path.
const root = fileURLToPath(new URL("../", import.meta.url))
const host = "127.0.0.1"
const port = 3000
const origin = `http://localhost:${port}`
await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once("error", reject)
  probe.listen(port, host, () => probe.close(resolve))
}).catch(() => {
  throw new Error(`Port ${port} is in use. Stop the previous local demo before starting another.`)
})
const persistPath = await realpath(await mkdtemp(join(tmpdir(), "corporate-network-local-")))
const environment = {
  ...process.env,
  CI: "1",
  NODE_ENV: "development",
  LOCAL_DEV_AUTH_ENABLED: "true",
  LOCAL_DEV_AUTH_ROLE: "ADMIN",
  LOCAL_DEV_D1_PERSIST_PATH: persistPath,
  AUTH_SESSION_SECRET: randomBytes(48).toString("base64url"),
  LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: "false",
  LOCAL_CORESIGNAL_SEARCH_ENABLED: "false",
  CORESIGNAL_LIVE_ENABLED: "false",
  CORESIGNAL_SEARCH_ENABLED: "false",
  CORESIGNAL_ES_DSL_PREVIEW_ENABLED: "false",
  CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT: "unknown",
  CORESIGNAL_COLLECT_ENABLED: "false",
  CORESIGNAL_COLLECT_ENTITLEMENT: "unknown",
  CORESIGNAL_COLLECT_MOCK_TRANSPORT: "false",
  // Opts the disposable D1 into mock External Discovery (and mock webhook simulation); no provider call or webhook receipt is enabled.
  CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true",
  CORESIGNAL_WEBHOOK_RECEIVE_ENABLED: "false",
  LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "false",
  BRIGHTDATA_LIVE_ENABLED: "false",
  BRIGHTDATA_MOCK_TRANSPORT: "false",
  BRIGHTDATA_HUMAN_TRIAL_ENABLED: "false",
  BRIGHTDATA_ACCESS_ENTITLEMENT: "unknown",
  LOCAL_LUSHA_LIVE_DEMO_ENABLED: "false",
  LOCAL_LUSHA_V3_MOCK_TRANSPORT: "false",
  LUSHA_LIVE_ENABLED: "false",
  LUSHA_SIGNALS_LIVE_ENABLED: "false",
  LUSHA_SEARCH_ENTITLEMENT: "unknown",
  LUSHA_EMAIL_ENTITLEMENT: "unknown",
  LUSHA_PHONE_ENTITLEMENT: "unknown",
  MAIL_MODE: "mock",
  MAIL_LIVE_ENABLED: "false",
  GMAIL_SEND_SCOPE_CONFIRMED: "false",
  APP_PUBLIC_URL: origin,
  APP_BASE_PATH: "/",
  NEXT_PUBLIC_APP_PUBLIC_URL: origin,
  NEXT_PUBLIC_APP_BASE_PATH: "/",
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: join(root, ".wrangler", "logs"),
  WRANGLER_SEND_METRICS: "false",
}
async function run(entry, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, entry), ...args], {
      cwd: root, env: environment, stdio: "inherit", windowsHide: true,
    })
    child.once("error", reject)
    child.once("exit", code => code === 0
      ? resolve()
      : reject(new Error(`${entry} exited with code ${code}`)))
  })
}
console.log(`Disposable local D1: ${persistPath}`)
const databaseArgs = ["DB", "--config", "wrangler.local.jsonc", "--local", "--persist-to", persistPath]
await run("node_modules/wrangler/bin/wrangler.js", ["d1", "migrations", "apply", ...databaseArgs])
await run("node_modules/wrangler/bin/wrangler.js", ["d1", "execute", ...databaseArgs,
  "--file", "scripts/local-development-fixture.sql", "--yes"])
console.log(`Admin: ${origin}/login/admin`)
console.log(`PCOM:  ${origin}/login/pcom`)
console.log("Development fixtures only. Live providers and mail are disabled. Ctrl+C stops the server.")
await run("node_modules/vite/bin/vite.js", ["--host", host, "--port", String(port), "--strictPort"])
