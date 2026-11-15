// Coresignal employee dataset selection for External Discovery Preview. No network: every request
// goes to an injected fake fetch. Base Employee (default) is the live-verified dataset for this
// account; Multi-source Employee is the currently documented API, selected with
// CORESIGNAL_EMPLOYEE_DATASET=multi_source.
import assert from "node:assert/strict"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, logLevel: "error", resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const adapter = await vite.ssrLoadModule("/lib/coresignal-adapter.ts")
const runtime = await vite.ssrLoadModule("/lib/provider-runtime.ts")
const originalKey = process.env.CORESIGNAL_API_KEY
const originalDataset = process.env.CORESIGNAL_EMPLOYEE_DATASET
process.env.CORESIGNAL_API_KEY = "fictional-test-key-never-sent"
after(async () => {
  if (originalKey === undefined) delete process.env.CORESIGNAL_API_KEY; else process.env.CORESIGNAL_API_KEY = originalKey
  if (originalDataset === undefined) delete process.env.CORESIGNAL_EMPLOYEE_DATASET; else process.env.CORESIGNAL_EMPLOYEE_DATASET = originalDataset
  await vite.close()
})

const contract = () => client.coresignalExactYearEsDslPreviewContract({ graduationYear: 2021, programmes: ["PGP"], seniorities: ["Director"], companyName: "Fictional Co" })
const multiSourceRecord = { id: 123456789, full_name: "Fictional Real Alumna", professional_network_url: "https://www.linkedin.com/in/fictional-real-alumna", headline: "Director at Fictional Co", location_full: "Mumbai, Maharashtra, India", company_name: "Fictional Co", active_experience_title: "Director", company_professional_network_url: "https://www.linkedin.com/company/fictional-co" }
function fakeFetch(rows, headers = {}) {
  const calls = []
  const fetcher = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json", "x-total-results": "927", "x-credits-remaining": "4910", ...headers } }) }
  return { calls, fetcher }
}

test("dataset defaults to the live-verified Base Employee API and accepts multi_source", () => {
  assert.equal(runtime.coresignalEmployeeDataset({}), "base")
  assert.equal(runtime.coresignalEmployeeDataset({ CORESIGNAL_EMPLOYEE_DATASET: "multi_source" }), "multi_source")
  assert.equal(runtime.coresignalEmployeeDataset({ CORESIGNAL_EMPLOYEE_DATASET: "other" }), "base")
})

test("Multi-source translation uses only documented Multi-source field names", () => {
  const translated = JSON.stringify(client.toCoresignalMultiSourceEsDsl(contract().body))
  for (const baseOnly of ["is_parent", "experience.deleted", "experience.is_current", "\"experience.title\"", "education.program\""]) assert.doesNotMatch(translated, new RegExp(baseOnly.replace(".", "\\.")), baseOnly)
  for (const field of ["\"is_deleted\":0", "experience.active_experience", "experience.position_title", "education.degree", "education.date_to_year\":2021", "experience.company_name.exact"]) assert.match(translated, new RegExp(field.replace(/[.]/g, "\\.")), field)
  // IIM Lucknow: id OR LinkedIn school URL OR exact name.
  assert.match(translated, /education\.institution_id":25919228/)
  assert.match(translated, /education\.institution_url\.exact":"https:\/\/www\.linkedin\.com\/school\/indian-institute-of-management-lucknow"/)
  assert.match(translated, /education\.institution_name":"Indian Institute of Management Lucknow"/)
  // The Base contract itself is unchanged.
  assert.match(JSON.stringify(contract().body), /"is_parent":1/)
})

test("Multi-source Preview calls the documented endpoint with the translated query and page", async () => {
  const { calls, fetcher } = fakeFetch([multiSourceRecord])
  const result = await client.previewCoresignalEmployeesExactYear(contract().body, { fetcher, operationContext: "fictional test", page: 2, dataset: "multi_source" })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://api.coresignal.com/cdapi/v2/employee_multi_source/search/es_dsl/preview?page=2")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.headers.apikey, "fictional-test-key-never-sent")
  assert.deepEqual(JSON.parse(calls[0].init.body), client.toCoresignalMultiSourceEsDsl(contract().body))
  assert.deepEqual({ rows: result.body.length, total: result.totalResults, credits: result.providerCreditsRemaining, page: result.page }, { rows: 1, total: 927, credits: 4910, page: 2 })
})

test("Base Preview keeps the live-verified endpoint and the original query", async () => {
  const { calls, fetcher } = fakeFetch([])
  await client.previewCoresignalEmployeesExactYear(contract().body, { fetcher, operationContext: "fictional test", dataset: "base" })
  assert.equal(calls[0].url, "https://api.coresignal.com/cdapi/v2/employee_base/search/es_dsl/preview")
  assert.deepEqual(JSON.parse(calls[0].init.body), contract().body)
})

test("a Multi-source Preview record maps to a real name, LinkedIn URL, company and title", () => {
  const profile = adapter.mapCoresignalPreview(multiSourceRecord, 0)
  assert.ok(profile)
  assert.equal(profile.name, "Fictional Real Alumna")
  assert.equal(profile.linkedinUrl, "https://www.linkedin.com/in/fictional-real-alumna")
  assert.equal(profile.currentCompany, "Fictional Co")
  assert.equal(profile.role, "Director")
  assert.equal(profile.providerPersonId, "123456789")
})
