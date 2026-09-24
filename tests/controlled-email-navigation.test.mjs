import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const navigation = await vite.ssrLoadModule("/lib/controlled-email-navigation.ts")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const route = await readFile(new URL("../app/api/engagements/route.ts", import.meta.url), "utf8")

test("profile Draft Email preserves the exact alumnus across navigation", () => {
  const url = navigation.controlledEmailUrl("https://network.example/?tab=directory", 417, "directory")
  assert.equal(url, "/?tab=engagement&compose=email&alumnusId=417&returnAlumnusId=417&returnTab=directory")
  assert.deepEqual(navigation.parseControlledEmailIntent(new URL(url, "https://network.example").search), { alumnusId: 417, returnAlumnusId: 417, returnTab: "directory" })
  assert.match(page, /startProfileEmailDraft\(selected\)/)
})

test("URL state, not a deferred initializer, owns the composer and profile", () => {
  assert.doesNotMatch(page, /createControlledEmailInitializer|setControlledEmailIntent|setSelected\(/)
  assert.match(page, /const controlledEmailIntent = parseControlledEmailIntent\(routeSearch\)/)
  assert.match(page, /const selected = activeTab === "directory" && routeState\.profileAlumnusId/)
  assert.match(page, /open=\{Boolean\(controlledEmailIntent \|\| mailPreview\)\}/)
})

test("composer recipient remains the selected alumnus stored email", () => {
  assert.match(route, /where\(eq\(alumni\.id, alumnusId\)\)/)
  assert.match(route, /A valid stored recipient email is required before drafting/)
  assert.match(page, /<Input value=\{mailPreview\.recipient\} readOnly/)
})

test("opening and cancelling the profile composer never sends email", () => {
  const createBlock = route.match(/if \(payload\.action === "create_manual_email_event"\)[\s\S]*?return Response\.json\(\{ \.\.\.\(await loadWorkspace\(\)\), createdEventId: selectedEvent\.id \}\);/)?.[0] ?? ""
  assert.doesNotMatch(createBlock, /sendMail\(/)
  assert.match(page, /cancelControlledEmailDraft/)
  assert.doesNotMatch(page.match(/function cancelControlledEmailDraft\(\)[\s\S]*?\n  \}/)?.[0] ?? "", /sendMailPreview|postEngagement\("send"/)
})

test("blocked and unknown preferences remain enforced by the server", () => {
  assert.match(route, /Unknown is not consent/)
  assert.match(route, /Do not contact/)
  assert.match(route, /validateSendEligibility/)
})

test("mobile and desktop use the same durable composer route", () => {
  assert.equal((page.match(/startProfileEmailDraft\(selected\)/g) ?? []).length, 1)
  assert.match(page, /controlledEmailUrl\(window\.location\.href, person\.id, "directory"\)/)
  assert.doesNotMatch(page, /setActiveTab/)
})

test("Cancel restores the originating profile and tab", () => {
  const intent = { alumnusId: 417, returnAlumnusId: 417, returnTab: "directory" }
  const returnUrl = navigation.controlledEmailReturnUrl("https://network.example/?tab=engagement&compose=email&alumnusId=417&returnAlumnusId=417&returnTab=directory", intent)
  assert.equal(returnUrl, "/?tab=directory&profileAlumnusId=417")
})

test("Flow A: ordinary Directory selection opens only the profile route", () => {
  const url = navigation.alumnusProfileUrl("https://network.example/?tab=directory", 15, "directory")
  assert.equal(url, "/?tab=directory&profileAlumnusId=15")
  assert.equal(navigation.parseControlledEmailIntent(new URL(url, "https://network.example").search), null)
  assert.deepEqual(navigation.profileRouteState(new URL(url, "https://network.example").search), { profileAlumnusId: 15, tab: "directory" })
  assert.match(page, /openAlumnusProfile\(person, "directory"\)/)
})

test("Flow B: Draft Email alone creates the Engagement compose route", () => {
  const profile = navigation.alumnusProfileUrl("https://network.example/", 15, "directory")
  const email = navigation.controlledEmailUrl(`https://network.example${profile}`, 15, "directory")
  assert.equal(email, "/?tab=engagement&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory")
  assert.equal(navigation.parseControlledEmailIntent(new URL(email, "https://network.example").search).alumnusId, 15)
})

test("Flow C: Cancel removes compose state and restores the original drawer", () => {
  const email = "https://network.example/?tab=engagement&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory"
  const returned = navigation.controlledEmailReturnUrl(email, { alumnusId: 15, returnAlumnusId: 15, returnTab: "directory" })
  const parsed = new URL(returned, "https://network.example")
  assert.equal(parsed.searchParams.has("compose"), false)
  assert.deepEqual(navigation.profileRouteState(parsed.search), { profileAlumnusId: 15, tab: "directory" })
})

test("Flow D: selecting another alumnus replaces stale email and profile identity", () => {
  const stale = "https://network.example/?tab=engagement&profileAlumnusId=15&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory"
  const next = navigation.alumnusProfileUrl(stale, 22, "directory")
  assert.equal(next, "/?tab=directory&profileAlumnusId=22")
  assert.equal(navigation.parseControlledEmailIntent(new URL(next, "https://network.example").search), null)
})

test("Flow E: close and tab navigation remove stale compose/profile state", () => {
  const stale = "https://network.example/?tab=engagement&profileAlumnusId=15&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory"
  const directory = navigation.workspaceTabUrl(stale, "directory")
  assert.equal(directory, "/?tab=directory")
  assert.deepEqual(navigation.profileRouteState(new URL(directory, "https://network.example").search), { profileAlumnusId: null, tab: "directory" })
  assert.match(page, /const selected = activeTab === "directory" && routeState\.profileAlumnusId[\s\S]*?alumni\.find/)
})

test("critical browser contract: Cancel is one atomic URL navigation with the drawer identity", () => {
  const cancel = page.match(/function cancelControlledEmailDraft\(\)[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.match(cancel, /navigateWorkspace\(controlledEmailReturnUrl\(window\.location\.href, controlledEmailIntent\), "replace"\)/)
  assert.doesNotMatch(cancel, /setTimeout|setSelected|setActiveTab/)
  assert.match(page, /<Sheet open=\{Boolean\(selected\)\}/)
})

test("direct Engagement email controls remain separate from profile navigation", () => {
  assert.match(page, /previewEngagement\(event\)/)
  assert.match(page, /openAlumnusProfile\(person, "directory"\)/)
  assert.doesNotMatch(page.match(/function openAlumnusProfile[\s\S]*?\n  \}/)?.[0] ?? "", /previewEngagement|create_manual_email_event/)
})
