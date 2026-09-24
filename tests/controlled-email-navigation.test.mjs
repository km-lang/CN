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
  assert.match(page, /controlledEmailUrl\(window\.location\.href, person\.id, activeTab\)/)
  assert.match(page, /setActiveTab\("engagement"\)/)
})

test("Cancel restores the originating profile and tab", () => {
  const intent = { alumnusId: 417, returnAlumnusId: 417, returnTab: "directory" }
  const returnUrl = navigation.controlledEmailReturnUrl("https://network.example/?tab=engagement&compose=email&alumnusId=417&returnAlumnusId=417&returnTab=directory", intent)
  assert.equal(returnUrl, "/?tab=directory&profileAlumnusId=417")
})
