import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const runtime = await readFile(new URL("../lib/provider-runtime.ts", import.meta.url), "utf8")

test("retired PDL provider code cannot be activated", () => {
  assert.doesNotMatch(runtime, /PDL_API_KEY|PDL_LIVE_ENABLED|provider === "pdl"/)
  assert.doesNotMatch(page, /Validate PDL connection|Refresh Profile via PDL|Run live PDL/)
})

test("historical PDL identity and refresh provenance remain readable", () => {
  assert.match(schema, /pdlPersonId: text\("pdl_person_id"\)/)
  assert.match(schema, /lastPdlRefresh: text\("last_pdl_refresh"\)/)
  assert.match(page, /pdlPersonId\?: string/)
  assert.match(page, /lastProfessionalDataRefresh \|\| person\.lastPdlRefresh/)
})
