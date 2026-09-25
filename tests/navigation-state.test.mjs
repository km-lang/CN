import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const navigation = await vite.ssrLoadModule("/lib/controlled-email-navigation.ts")
const mutations = await vite.ssrLoadModule("/lib/persisted-mutation.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")

test("canonical navigation removes invalid and orphaned email state", () => {
  const malformed = navigation.canonicalWorkspaceUrl("https://network.example/?tab=directory&compose=email&alumnusId=bad&returnAlumnusId=15&returnTab=directory")
  assert.equal(malformed, "/?tab=directory")
  const orphaned = navigation.canonicalWorkspaceUrl("https://network.example/?tab=overview&returnAlumnusId=15&returnTab=directory&profileAlumnusId=15")
  assert.equal(orphaned, "/?tab=overview")
})

test("canonical navigation makes valid compose and profile state agree with the visible tab", () => {
  const compose = navigation.canonicalWorkspaceUrl("https://network.example/?tab=overview&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory&profileAlumnusId=22")
  assert.equal(compose, "/?tab=engagement&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory")
  const staleProfile = navigation.canonicalWorkspaceUrl("https://network.example/?tab=companies&profileAlumnusId=15")
  assert.equal(staleProfile, "/?tab=companies")
})

test("canonical navigation removes inaccessible tabs and compose state", () => {
  const developer = { canOperate: false, canAdminister: false }
  assert.equal(navigation.canonicalWorkspaceUrl("https://network.example/?tab=admin", developer), "/?tab=overview")
  assert.equal(navigation.canonicalWorkspaceUrl("https://network.example/?tab=engagement&compose=email&alumnusId=15", developer), "/?tab=overview")
})

test("profile history URLs remain deterministic for consecutive selection, close, Back and Forward", () => {
  const first = navigation.alumnusProfileUrl("https://network.example/?tab=directory", 15)
  const second = navigation.alumnusProfileUrl(`https://network.example${first}`, 22)
  const closed = navigation.workspaceTabUrl(`https://network.example${second}`, "directory")
  assert.equal(first, "/?tab=directory&profileAlumnusId=15")
  assert.equal(second, "/?tab=directory&profileAlumnusId=22")
  assert.equal(closed, "/?tab=directory")
  assert.deepEqual(navigation.profileRouteState(new URL(first, "https://network.example").search), { profileAlumnusId: 15, tab: "directory" })
  assert.deepEqual(navigation.profileRouteState(new URL(second, "https://network.example").search), { profileAlumnusId: 22, tab: "directory" })
})

test("same-field persistence is serialized and only the newest result reconciles the UI", async () => {
  const coordinator = new mutations.PersistedMutationCoordinator()
  let active = 0
  let maximumActive = 0
  const order = []
  const persist = value => async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    order.push(`start:${value}`)
    await new Promise(resolve => setTimeout(resolve, 5))
    order.push(`finish:${value}`)
    active -= 1
    return value
  }
  const first = coordinator.run("alumnus:15:status", "Not contacted", persist("Contacted"))
  const second = coordinator.run("alumnus:15:status", "Not contacted", persist("Responded"))
  assert.deepEqual(await first, { ok: true, latest: false, value: "Contacted" })
  assert.deepEqual(await second, { ok: true, latest: true, value: "Responded" })
  assert.equal(maximumActive, 1)
  assert.deepEqual(order, ["start:Contacted", "finish:Contacted", "start:Responded", "finish:Responded"])
})

test("a failed newest mutation rolls back to the last confirmed field value", async () => {
  const coordinator = new mutations.PersistedMutationCoordinator()
  const first = coordinator.run("user:7:role", "PCOM", async () => "ADMIN")
  const second = coordinator.run("user:7:role", "PCOM", async () => { throw new Error("save failed") })
  assert.deepEqual(await first, { ok: true, latest: false, value: "ADMIN" })
  const failed = await second
  assert.equal(failed.ok, false)
  assert.equal(failed.latest, true)
  assert.equal(failed.rollback, "ADMIN")
})

test("different fields can retain independent rollback state while sharing one server write queue", async () => {
  const coordinator = new mutations.PersistedMutationCoordinator()
  let active = 0
  let maximumActive = 0
  const persist = value => async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    return value
  }
  const first = coordinator.run("alumnus:15:privacy:general", "Unknown", persist("Standard engagement allowed"), "alumnus:15:privacy-write")
  const second = coordinator.run("alumnus:15:privacy:professional", "Unknown", persist("Professional engagement only"), "alumnus:15:privacy-write")
  assert.equal((await first).ok, true)
  assert.equal((await second).ok, true)
  assert.equal(maximumActive, 1)
})

test("profile textarea drafts do not overwrite confirmed alumni state before persistence", () => {
  assert.match(page, /professionalNoteDrafts\[selected\.id\]/)
  assert.match(page, /privacyNoteDrafts\[selected\.id\]/)
  assert.doesNotMatch(page, /onChange=\{event => replaceAlumnus\(\{ \.\.\.selected, professionalDataNote/)
  assert.match(admin, /PersistedMutationCoordinator/)
  assert.match(admin, /Saving latest role/)
  assert.match(admin, /Saving latest lifecycle state/)
  assert.match(page, /workspaceLoading \|\| activeTab !== "directory" \|\| !routeState\.profileAlumnusId \|\| selected/)
})
