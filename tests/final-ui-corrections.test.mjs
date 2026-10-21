import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
const history = await readFile(new URL("../components/intelligence/job-history.tsx", import.meta.url), "utf8")
const enrichment = await readFile(new URL("../app/api/enrichment/route.ts", import.meta.url), "utf8")

test("UI-01 aligns directory labels and controls while preserving scoped helper copy", () => {
  assert.match(page, /<span>Directory programme<\/span>[\s\S]*?<SelectTrigger aria-label="Directory programme"/)
  assert.match(page, /Applies only to existing Corporate Network records\. It does not affect external provider discovery\./)
  assert.match(styles, /\.directory-filter-field \{ display: grid; grid-template-rows: 1rem minmax\(36px, max-content\) auto;/)
  assert.match(styles, /\.directory-filter-field > span \{ align-self: end;/)
})

test("UX-02 explains Search, Collect, and Review without changing the provider-free action", () => {
  assert.match(page, /Find Alumni on Coresignal \(ID-only\)/)
  assert.match(page, /Search returns candidate Employee IDs for review, not complete professional profiles/)
  assert.match(page, /<strong>Search<\/strong>Candidate Employee IDs/)
  assert.match(page, /<strong>Collect<\/strong>Separately authorized full-profile retrieval/)
  assert.match(page, /<strong>Review<\/strong>Human verification before canonical changes/)
  assert.match(page, /Review Search Criteria/)
  assert.match(page, /This provider-free action opens confirmation; it does not call Search, Preview or Collect/)
  assert.match(page, /onClick=\{\(\) => void prepareRegularSearch\(discoveryFilters\)\}/)
})

test("UX-02 retains the fail-closed company and execution safety disclosures", () => {
  for (const copy of ["Verified provider ID preferred; exact-name fallback is unverified", "LIVE execution gate disabled", "Maximum ", "Pagination ", "No automatic Collect or canonical update", "remain local qualification filters"]) assert.match(page, new RegExp(copy))
})

test("UI-03 gives both history columns a shared padded body and accurate empty states", () => {
  assert.match(history, /<section><h3>Saved policies<\/h3>/)
  assert.match(history, /<section><h3>Recent runs<\/h3>/)
  assert.match(history, /No refresh policies have been saved/)
  assert.match(history, /No scheduled runs have executed/)
  assert.match(styles, /\.intelligence-history > \.intelligence-history-grid \{ padding: 1\.1rem 1\.35rem 1\.35rem; \}/)
})

test("UI-04 presents concise operational columns and expandable structured details", () => {
  for (const label of ["Date / time", "Provider", "Operation", "Status", "Results", "Usage evidence", "Details"]) assert.match(page, new RegExp(`>${label}<`))
  for (const section of ["Request context", "Execution outcome", "Usage and limits", "Technical diagnostics"]) assert.match(page, new RegExp(`>${section}<`))
  assert.match(page, /<details className="provider-history-record"/)
  assert.match(page, /View details/)
  assert.doesNotMatch(page, /<TableHead>Response<\/TableHead>/)
})

test("UI-04 preserves zero results and honest historical evidence states", () => {
  assert.match(page, /item\.resultCount == null \? "Not recorded"/)
  assert.match(page, /item\.searchEvidence && item\.searchEvidence\.state !== "RETAINED"/)
  assert.match(page, /Request criteria were not retained for this operation/)
  assert.match(enrichment, /history\.map\(presentProviderHistorySearchEvidence\)/)
})

test("UI-04 formats bounded sanitized metadata outside the main history row", () => {
  assert.match(page, /JSON\.stringify\(item\.searchEvidence\?\.state === "RETAINED" \? item\.searchEvidence\.evidence : item\.collectEvidence\?\.state === "RETAINED" \? item\.collectEvidence\.evidence : null, null, 2\)/)
  assert.match(page, /className="provider-history-json"/)
  assert.match(styles, /\.provider-history-json pre \{ max-width: 100%; max-height: 300px;/)
  assert.match(styles, /overflow: auto;/)
})

test("Provider History remains server-authorized for Admin only", () => {
  assert.match(enrichment, /authorizeRequest\(request, "VIEW_PROVIDER_STATUS"\)/)
  assert.match(enrichment, /history: context\.role === "ADMIN" \? history\.map\(presentProviderHistorySearchEvidence\)\.map\(presentProviderHistoryCollectEvidence\) : \[\]/)
  assert.match(page, /session\.canAdminister \? <section className="panel history-panel"/)
  assert.match(page, /Administrative provider history is restricted/)
})

test("affected layouts stack without page-level overflow on tablet and mobile", () => {
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.provider-history-columns \{ display: none; \}/)
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.provider-history-detail-body \{ grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(styles, /@media \(max-width: 650px\)[\s\S]*?\.provider-history-summary \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.match(styles, /\.provider-history-field \{ min-width: 0;/)
})
