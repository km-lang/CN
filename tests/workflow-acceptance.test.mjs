import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const discovery = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const enrichment = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")

test("accepted workflow is Coresignal discovery, qualification, approval, then Lusha contacts", () => {
  assert.match(page, /Discover More Alumni/)
  assert.match(page, /Confirmed degree alumnus/)
  assert.match(discovery, /action === "qualify"/)
  assert.match(discovery, /action === "approve"/)
  assert.match(enrichment, /lusha_search_contact/)
})

test("professional refresh and contact enrichment remain independent actions", () => {
  assert.match(page, /Coresignal refresh and Lusha contact preparation remain separate/)
  assert.match(page, /Refresh Profiles/)
  assert.match(page, /Prepare Email Reveal/)
  assert.match(enrichment, /Use Refresh Profiles for Coresignal professional data checks/)
})

test("returned professional changes require a human disposition", () => {
  assert.match(page, /Apply Selected Updates/)
  assert.match(page, /Keep existing/)
  assert.match(enrichment, /Reviewed — kept existing/)
  assert.match(enrichment, /professional_profile_update_approved/)
})
