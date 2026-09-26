import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const route = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const adapter = await readFile(new URL("../lib/coresignal-adapter.ts", import.meta.url), "utf8")

test("discovery uses Coresignal behind a professional-data adapter", () => {
  assert.match(route, /coresignalProvider\.searchCandidates/)
  assert.match(adapter, /ProfessionalDataProvider/)
  assert.doesNotMatch(route, /pdlGet|People Data Labs/)
})

test("discovery stays review-first and duplicate-aware", () => {
  assert.match(route, /Possible duplicate/)
  assert.match(route, /Needs review/)
  assert.match(route, /Only confirmed degree alumni that are clearly new/)
  assert.match(page, /Compare professional profile/)
  assert.match(page, /Keep Pending Review/)
})

test("professional discovery remains separate from Lusha contact enrichment", () => {
  assert.match(page, /"Coresignal"\} sourced professional profile/)
  assert.match(page, /Get Email via Lusha/)
  assert.match(page, /Get Phone via Lusha/)
  assert.doesNotMatch(route, /emailSource|phoneSource/)
})
