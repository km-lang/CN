import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { createServer } from "vite"

const require = createRequire(import.meta.url)
const runRenderedBrowserTests = process.env.RUN_RENDERED_BROWSER_TESTS === "1"
const browserTest = runRenderedBrowserTests ? test : test.skip
let playwright
try {
  playwright = require("playwright")
} catch {
  playwright = null
}

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = runRenderedBrowserTests ? await createServer({
  appType: "spa",
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { "@": root } },
  server: { host: "127.0.0.1", hmr: false },
}) : null
if (vite) await vite.listen(0)
const address = vite?.httpServer?.address()
const port = typeof address === "object" && address ? address.port : 0
const baseUrl = `http://127.0.0.1:${port}`
after(async () => vite?.close())

async function withPage(run) {
  assert.ok(playwright, "Playwright must be available for the rendered-browser regression suite")
  const browser = await playwright.chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await run(page)
  } finally {
    await context.close()
    await browser.close()
  }
}

function fixtureUrl(search) {
  return `${baseUrl}/tests/browser/controlled-email.html?${search}`
}

async function openFromDirectory(page, scenario = "success") {
  await page.goto(fixtureUrl(`tab=directory&testScenario=${scenario}`))
  await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
  await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
  await page.getByRole("button", { name: "Draft Email" }).click()
}

async function expectReady(page) {
  await page.getByRole("heading", { name: "Review email before sending" }).waitFor()
  await page.getByText("Preparing email draft").waitFor({ state: "hidden" })
}

async function expectNoExternalCalls(page) {
  const state = await page.evaluate(() => window.__emailTest)
  assert.equal(state.sends, 0)
  assert.deepEqual(state.providerCalls, [])
}

browserTest("browser 1: alumnus 15 Draft Email reaches composer ready", async () => {
  await withPage(async page => {
    await openFromDirectory(page)
    await expectReady(page)
    assert.match(page.url(), /tab=engagement&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory/)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 2: composer uses Sahil Bansal's stored recipient", async () => {
  await withPage(async page => {
    await openFromDirectory(page)
    await expectReady(page)
    assert.equal(await page.locator(".mail-form label", { hasText: "Recipient" }).locator("input").inputValue(), "sahil.bansal@example.test")
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 3: completed historical email is followed by a fresh legitimate draft", async () => {
  await withPage(async page => {
    await openFromDirectory(page)
    await expectReady(page)
    assert.equal(await page.evaluate(() => window.__emailTest.prepareRequests), 1)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 4: direct compose URL survives refresh", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=engagement&compose=email&alumnusId=15&returnAlumnusId=15&returnTab=directory&testScenario=success"))
    await expectReady(page)
    await page.reload()
    await expectReady(page)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 5: Cancel restores the same alumnus drawer", async () => {
  await withPage(async page => {
    await openFromDirectory(page)
    await expectReady(page)
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
    assert.match(page.url(), /\?tab=directory&testScenario=success&profileAlumnusId=15|\?tab=directory&profileAlumnusId=15&testScenario=success/)
    assert.equal(await page.getByRole("heading", { name: "Review email before sending" }).count(), 0)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 6: open, cancel, and reopen starts a valid new initialization", async () => {
  await withPage(async page => {
    await openFromDirectory(page)
    await expectReady(page)
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Draft Email" }).click()
    await expectReady(page)
    assert.equal(await page.evaluate(() => window.__emailTest.prepareRequests), 2)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 7: rapid double click creates one initialization request", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=directory&testScenario=success"))
    await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
    await page.getByRole("button", { name: "Draft Email" }).evaluate(button => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await expectReady(page)
    assert.equal(await page.evaluate(() => window.__emailTest.prepareRequests), 1)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 8: initialization error exposes Retry and Cancel", async () => {
  await withPage(async page => {
    await openFromDirectory(page, "error-first")
    await page.getByRole("heading", { name: "Unable to prepare this email draft." }).waitFor()
    await page.getByRole("button", { name: "Cancel", exact: true }).waitFor()
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectReady(page)
    assert.equal(await page.evaluate(() => window.__emailTest.prepareRequests), 2)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 9: initialization timeout terminates with Retry and Cancel", async () => {
  await withPage(async page => {
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window)
      window.setTimeout = (handler, timeout, ...args) => nativeSetTimeout(handler, timeout && timeout >= 10_000 ? 40 : timeout, ...args)
    })
    await openFromDirectory(page, "timeout")
    await page.getByRole("heading", { name: "Unable to prepare this email draft." }).waitFor()
    await page.getByText("Email draft preparation timed out. Please retry.").waitFor()
    await page.getByRole("button", { name: "Retry", exact: true }).waitFor()
    await page.getByRole("button", { name: "Cancel", exact: true }).waitFor()
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 10: superseded request is cancelled and cannot reopen the composer", async () => {
  await withPage(async page => {
    await openFromDirectory(page, "superseded")
    await page.getByRole("heading", { name: "Preparing email draft" }).waitFor()
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.waitForTimeout(350)
    await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
    assert.equal(await page.getByRole("heading", { name: "Review email before sending" }).count(), 0)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 11: malformed and stale query parameters are canonically removed", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=companies&profileAlumnusId=15&compose=email&alumnusId=bad&returnAlumnusId=15&returnTab=directory&testScenario=success"))
    await page.getByRole("heading", { name: "Map the strongest route into a target firm." }).waitFor()
    const url = new URL(page.url())
    assert.equal(url.searchParams.get("tab"), "companies")
    for (const key of ["profileAlumnusId", "compose", "alumnusId", "returnAlumnusId", "returnTab"]) assert.equal(url.searchParams.has(key), false)
    await page.goto(fixtureUrl("tab=directory&profileAlumnusId=999&testScenario=success"))
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.has("profileAlumnusId"))
    assert.equal(await page.locator(".profile-sheet").count(), 0)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 12: profile refresh, Back, Forward, and rapid replacement follow URL state", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=directory&profileAlumnusId=15&testScenario=success"))
    await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
    await page.evaluate(() => {
      const url = new URL(window.location.href)
      url.searchParams.set("profileAlumnusId", "22")
      window.history.pushState({}, "", `${url.pathname}${url.search}`)
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    await page.locator(".profile-sheet", { hasText: "Priya Sharma" }).waitFor()
    await page.goBack()
    await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
    await page.goForward()
    await page.locator(".profile-sheet", { hasText: "Priya Sharma" }).waitFor()
    await page.reload()
    await page.locator(".profile-sheet", { hasText: "Priya Sharma" }).waitFor()
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 13: switching tabs during composer loading cancels stale initialization", async () => {
  await withPage(async page => {
    await openFromDirectory(page, "superseded")
    await page.getByRole("heading", { name: "Preparing email draft" }).waitFor()
    await page.getByRole("tab", { name: "Company intelligence" }).evaluate(element => element.click())
    await page.getByRole("heading", { name: "Map the strongest route into a target firm." }).waitFor()
    await page.waitForTimeout(350)
    const url = new URL(page.url())
    assert.equal(url.searchParams.get("tab"), "companies")
    assert.equal(url.searchParams.has("compose"), false)
    assert.equal(await page.getByRole("heading", { name: "Review email before sending" }).count(), 0)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 14: rapid persisted status changes are serialized and newest wins", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=directory&testScenario=mutation-race"))
    await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
    const status = page.locator(".profile-status")
    await status.click()
    await page.getByRole("option", { name: "Responded" }).click()
    await status.click()
    await page.getByRole("option", { name: "Meeting set" }).click()
    await page.waitForFunction(() => window.__emailTest.workspaceMutations === 2 && window.__emailTest.workspaceMutationActive === 0)
    assert.match(await status.textContent(), /Meeting set/)
    const state = await page.evaluate(() => window.__emailTest)
    assert.equal(state.maximumWorkspaceMutationActive, 1)
    assert.equal(state.persistedStatus, "Meeting set")
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 15: failed field mutation rolls back only that field without workspace reload", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=directory&testScenario=mutation-failure"))
    await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
    const status = page.locator(".profile-status")
    const initialGets = await page.evaluate(() => window.__emailTest.workspaceGets)
    await status.click()
    await page.getByRole("option", { name: "Responded" }).click()
    await page.getByText("Fixture persistence failure.").waitFor()
    assert.match(await status.textContent(), /Contacted/)
    assert.equal(await page.evaluate(() => window.__emailTest.workspaceGets), initialGets)
    await expectNoExternalCalls(page)
  })
})

browserTest("browser 16: profile open, close, and reopen remains URL-driven", async () => {
  await withPage(async page => {
    await page.goto(fixtureUrl("tab=directory&testScenario=success"))
    await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
    const sheet = page.locator(".profile-sheet", { hasText: "Sahil Bansal" })
    await sheet.waitFor()
    await sheet.getByRole("button", { name: "Close" }).click()
    await sheet.waitFor({ state: "hidden" })
    assert.equal(new URL(page.url()).searchParams.has("profileAlumnusId"), false)
    await page.locator("button.person-cell", { hasText: "Sahil Bansal" }).click()
    await page.locator(".profile-sheet", { hasText: "Sahil Bansal" }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get("profileAlumnusId"), "15")
    await expectNoExternalCalls(page)
  })
})
