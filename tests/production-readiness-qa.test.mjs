import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start)
  assert.ok(start >= 0 && end > start, `${name} source block is available`)
  return source.slice(start, end)
}

test("persisted profile selections update visually before the network request", () => {
  const blocks = [
    functionBody(page, "saveAlumnus", "updateStatus"),
    functionBody(page, "updateCompanyPriority", "updatePrivacy"),
    functionBody(page, "updatePrivacy", "updateProfessionalDataQuality"),
    functionBody(page, "updateProfessionalDataQuality", "downloadTemplate"),
  ]
  for (const block of blocks) {
    const visualUpdate = Math.min(...[block.indexOf("replaceAlumnus("), block.indexOf("setAlumni("), block.indexOf("setCompanyPriorities(")].filter(index => index >= 0))
    assert.ok(visualUpdate >= 0)
    assert.ok(visualUpdate < block.indexOf("await fetch("), "the controlled value changes before persistence begins")
  }
})

test("rapid persisted selections ignore stale responses and retain saving state until all requests settle", () => {
  assert.match(page, /persistedMutationsRef = useRef\(new PersistedMutationCoordinator\(\)\)/)
  assert.match(page, /persistedMutationsRef\.current\.run\(mutationKey/)
  assert.match(page, /result\.ok && result\.latest/)
  assert.match(page, /!result\.ok && result\.latest/)
  assert.match(page, /pendingSyncCountRef\.current \+= 1/)
  assert.match(page, /setSyncing\(pendingSyncCountRef\.current > 0\)/)
  assert.doesNotMatch(functionBody(page, "saveAlumnus", "updateStatus"), /loadWorkspace\(/)
})

test("admin role and lifecycle selections are optimistic and roll back on failure", () => {
  const role = functionBody(admin, "updateUserRole", "updateLifecycle")
  const lifecycle = functionBody(admin, "updateLifecycle", "authorizeUser")
  assert.ok(role.indexOf("setData(") < role.indexOf("await persistedMutationsRef.current.run("))
  assert.match(role, /result\.ok \? result\.value : result\.rollback/)
  assert.ok(lifecycle.indexOf("setLifecycleDrafts(") < lifecycle.indexOf("await persistedMutationsRef.current.run("))
  assert.match(lifecycle, /result\.ok \? result\.value : result\.rollback/)
})

test("live readiness copy never claims enabled Signals or mail remain off", () => {
  assert.doesNotMatch(admin, /Signals remain OFF/)
  assert.doesNotMatch(admin, /Mail remains OFF\/MOCK/)
  assert.match(admin, /No person-level Professional Signals lookup is run/)
  assert.match(admin, /live mail configuration is unchanged/)
})

test("disabled workflow controls explain their missing prerequisites", () => {
  for (const explanation of [
    "Select a target alumnus first.",
    "Requires a stored Lusha contact ID.",
    "Choose a CSV or Excel file first.",
    "Requires an eligible stored email.",
    "available PDL application credits",
    "Enter an institutional email address first.",
    "Requires configured Gmail OAuth credentials.",
  ]) assert.ok(page.includes(explanation) || admin.includes(explanation), explanation)
})

test("responsive rules cover tablet, phone, dialogs, drawers, touch targets, and scrollable tables", () => {
  assert.match(css, /@media \(max-width: 768px\)/)
  assert.match(css, /@media \(max-width: 650px\)/)
  assert.match(css, /@media \(max-width: 430px\)/)
  assert.match(css, /max-height: calc\(100dvh - 1rem\)/)
  assert.match(css, /max-width: 100vw !important/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /\[data-slot="table-container"\][^{]*\{[^}]*overflow-scrolling: touch/s)
})

test("provider safeguards stay explicit in confirmation UI", () => {
  assert.match(page, /Cancel — No Provider Call/)
  assert.match(page, /Opening this review does not call the provider/)
  assert.match(page, /Human review only; no automatic profile update/)
  assert.match(page, /No message is sent until you approve it/)
})

test("controlled email initialization stays bounded and provider-free until explicit send", () => {
  const cancelStart = page.indexOf("function cancelControlledEmailDraft")
  const initializeStart = page.indexOf("useEffect(() => {", cancelStart)
  const initializeEnd = page.indexOf("async function sendMailPreview", initializeStart)
  const initialize = page.slice(initializeStart, initializeEnd)
  assert.ok(initializeStart > cancelStart && initializeEnd > initializeStart)
  assert.match(initialize, /15_000/)
  assert.match(initialize, /AbortController/)
  assert.match(initialize, /setComposeState\(\{ status: "error"/)
  assert.doesNotMatch(initialize, /sendMail|postEngagement\("send"/)
})
