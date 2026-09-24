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
