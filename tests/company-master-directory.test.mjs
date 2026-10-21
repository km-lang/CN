import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const directory = await vite.ssrLoadModule("/lib/company-directory.ts")
const mapping = await vite.ssrLoadModule("/lib/provider-company-mapping.ts")
const alumniSearch = await vite.ssrLoadModule("/lib/alumni-search.ts")
const companyLookup = await vite.ssrLoadModule("/lib/coresignal-company-lookup.ts")
const component = await readFile(new URL("../components/company-combobox.tsx", import.meta.url), "utf8")
const workspaceRoute = await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8")
const discoveryRoute = await readFile(new URL("../app/api/discovery/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

function company(overrides = {}) {
  return {
    id: 7, normalizedCompanyKey: "acme", displayName: "Acme", provider: "coresignal", providerCompanyId: "123",
    status: "VERIFIED", mappingSource: "reviewed Collect evidence", evidenceReference: "evidence-7", providerSourceId: "source-7",
    providerCompanyUrl: "https://www.linkedin.com/company/acme", verifiedBy: "Admin", verifiedAt: "2026-10-20T00:00:00.000Z",
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", ...overrides,
  }
}

test("company master reuses verified mappings, aliases, local organizations, and verification metadata", () => {
  const options = directory.buildCompanyDirectory({
    mappings: [company()],
    aliases: [{ mappingId: 7, displayAlias: "Acme Inc", status: "VERIFIED" }],
    organizationNames: ["Acme Inc", "Acme Labs"],
    priorityNames: ["Acme", "Other Company"],
  })
  assert.equal(options.length, 3)
  const verified = options.find(option => option.canonicalName === "Acme")
  assert.deepEqual(verified.aliases, ["Acme Inc"])
  assert.equal(verified.selectionKey, "coresignal:7")
  assert.equal(verified.providerCompanyId, "123")
  assert.equal(verified.linkedinOrganizationUrl, "https://www.linkedin.com/company/acme")
  assert.equal(verified.verificationStatus, "VERIFIED")
  assert.equal(verified.verifiedBy, "Admin")
  assert.equal(verified.lastCheckedAt, "2026-10-20T00:00:00.000Z")
  assert.equal(options.filter(option => option.canonicalName === "Acme Inc").length, 0)
})

test("company directory search matches aliases and keeps similarly named companies distinct", () => {
  const options = directory.buildCompanyDirectory({ mappings: [company(), company({ id: 8, normalizedCompanyKey: "acme labs", displayName: "Acme Labs", providerCompanyId: "124", providerCompanyUrl: "https://www.linkedin.com/company/acme-labs" })], aliases: [{ mappingId: 7, displayAlias: "Acme Inc", status: "VERIFIED" }], organizationNames: [] })
  assert.deepEqual(directory.filterCompanyDirectory(options, "Inc").map(option => option.canonicalName), ["Acme"])
  assert.deepEqual(directory.filterCompanyDirectory(options, "Acme").map(option => option.canonicalName), ["Acme", "Acme Labs"])
  assert.notEqual(options[0].selectionKey, options[1].selectionKey)
})

test("saved selection is resolved server-side and browser-supplied company text is not authoritative", async () => {
  const record = company()
  const result = await mapping.resolveProviderCompanySelection("Malicious Similar Name", "coresignal:7", "Coresignal", {
    async findByCompany() { throw new Error("name lookup must not authorize a selected mapping") },
    async findBySelectionId(provider, id) { return provider === "coresignal" && id === 7 ? [record] : [] },
  })
  assert.equal(result.state, "VERIFIED")
  assert.equal(result.displayName, "Acme")
  assert.equal(result.providerCompanyId, 123)
  assert.equal((await mapping.resolveProviderCompanySelection("Acme", "coresignal:999", "Coresignal", { async findByCompany() { return [] }, async findBySelectionId() { return [] } })).state, "MISSING")
  assert.equal((await mapping.resolveProviderCompanySelection("Acme", "coresignal:not-an-id", "Coresignal", { async findByCompany() { return [] }, async findBySelectionId() { return [] } })).state, "CONFLICT")
})

test("historical discovery filters remain compatible and free text stays explicitly unverified", () => {
  const historical = alumniSearch.normalizeDiscoveryFiltersInput({ company: "McKinsey & Company", graduationYear: "2026" })
  assert.equal(historical.company, "McKinsey & Company")
  assert.equal(historical.companySelectionKey, "")
  assert.match(component, /Controlled unverified exact-name fallback/)
  assert.match(component, /Unverified name fallback; no provider identity is asserted/)
})

test("autocomplete is local, accessible, clearable, keyboard-aware, and shared through workspace RBAC", () => {
  assert.doesNotMatch(component, /fetch\(/)
  for (const marker of ["role=\"combobox\"", "role=\"listbox\"", "role=\"option\"", "ArrowDown", "Escape", "Clear the company filter", "Type a company or alias"]) assert.match(component, new RegExp(marker))
  assert.match(workspaceRoute, /authorizeRequest\(request, "VIEW_ALUMNI"\)/)
  assert.match(workspaceRoute, /buildCompanyDirectory/)
  assert.match(page, /<CompanySearchCombobox options=\{companyDirectory\}/)
})

test("discovery resolves selection keys on the server and preserves current-company safeguards", () => {
  assert.match(discoveryRoute, /resolveProviderCompanySelection\(filters\.company, filters\.companySelectionKey/)
  assert.match(discoveryRoute, /mapping\.mapping\) filters\.company = mapping\.displayName/)
  assert.match(discoveryRoute, /filters\.company = preparation\.companyMapping\.displayName/)
  assert.doesNotMatch(discoveryRoute, /payload\.(providerCompanyId|companyId)/)
  assert.match(discoveryRoute, /companyIdentityMode = "VERIFIED_ID"/)
  assert.match(discoveryRoute, /companyIdentityMode = "EXACT_NAME"/)
})

test("future Company lookup adapter is provider-free, mocked, and fail-closed", async () => {
  const rows = companyLookup.normalizeMockedCoresignalCompanyPreview([{ id: 42, company_name: "Example", professional_network_url: "https://www.linkedin.com/company/example", website: "https://example.com", industry: "Consulting", hq_country: "India" }, { id: "bad", company_name: "Discard" }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].providerCompanyId, 42)
  assert.equal(companyLookup.CORESIGNAL_COMPANY_LOOKUP_CAPABILITIES.liveEnabled, false)
  assert.equal(companyLookup.CORESIGNAL_COMPANY_LOOKUP_CAPABILITIES.accountEntitlement, "UNKNOWN")
  assert.equal(companyLookup.CORESIGNAL_COMPANY_LOOKUP_CAPABILITIES.employeeCompanyIdCompatibility, "UNVERIFIED")
  await assert.rejects(() => companyLookup.disabledCoresignalCompanyLookup.previewByName("Example"), /not enabled/)
})
