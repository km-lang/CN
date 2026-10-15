import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const client = await vite.ssrLoadModule("/lib/coresignal-client.ts")
const search = await vite.ssrLoadModule("/lib/alumni-search.ts")

const exactYearFilters = overrides => ({
  ...search.defaultDiscoveryFilters(),
  graduationYear: "2011",
  ...overrides,
})

const exactContract = overrides => client.coresignalExactYearEsDslSearchContract(exactYearFilters(overrides))

test("institution-only ES-DSL contract omits education year and keeps one nested institution query", () => {
  const contract = client.coresignalEmployeeEsDslSearchContract()
  assert.equal(contract.searchMode, "INSTITUTION_ONLY")
  assert.deepEqual(contract.body, {
    query: {
      bool: {
        filter: [
          { term: { is_parent: 1 } },
          {
            nested: {
              path: "education",
              query: {
                bool: {
                  filter: [
                    { term: { "education.institution_id": 25919228 } },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    sort: ["id"],
  })
  assert.equal(JSON.stringify(contract.body).includes("education.date_to_year"), false)
  assert.equal(JSON.stringify(contract.body).includes("education.institution_url"), false)
  assert.equal(client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, 25919228)
})

test("general ES-DSL contract keeps institution and exact year in one nested education query", () => {
  const contract = client.coresignalEmployeeEsDslSearchContract({ graduationYear: 2011 })
  assert.equal(contract.searchMode, "EXACT_GRADUATION_YEAR")
  const nestedClauses = contract.body.query.bool.filter.filter(clause => clause.nested)
  assert.equal(nestedClauses.length, 1)
  assert.deepEqual(nestedClauses[0].nested.query.bool.filter, [
    { term: { "education.institution_id": client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID } },
    { term: { "education.date_to_year": 2011 } },
  ])
  assert.equal(JSON.stringify(contract.body).includes("education.institution_url"), false)
})

function educationMatchesGeneratedNestedQuery(education, contract = exactContract()) {
  const nested = contract.body.query.bool.filter.find(clause => clause.nested)?.nested
  assert.equal(nested.path, "education")
  const terms = nested.query.bool.filter.map(clause => clause.term)
  return education.some(row => terms.every(term => {
    const [[field, expected]] = Object.entries(term)
    return row[field.slice("education.".length)] === expected
  }))
}

test("exact-year ES-DSL contract uses free Base Employee Search with conservative deterministic paging", () => {
  assert.deepEqual(exactContract(), {
    method: "POST",
    path: "/cdapi/v2/employee_base/search/es_dsl",
    query: { items_per_page: 1 },
    body: {
      query: {
        bool: {
          filter: [
            { term: { is_parent: 1 } },
            {
              nested: {
                path: "education",
                query: {
                  bool: {
                    filter: [
                      { term: { "education.institution_id": 25919228 } },
                      { term: { "education.date_to_year": 2011 } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      sort: ["id"],
    },
  })
})

test("items_per_page is configurable only inside the documented bounded integer range", () => {
  for (const itemsPerPage of [1, 20, 1_000]) {
    assert.equal(client.coresignalExactYearEsDslSearchContract(exactYearFilters(), { itemsPerPage }).query.items_per_page, itemsPerPage)
  }
  for (const itemsPerPage of [0, 1.5, 1_001]) {
    assert.throws(() => client.coresignalExactYearEsDslSearchContract(exactYearFilters(), { itemsPerPage }), /items_per_page/)
  }
  for (const graduationYear of ["", "13", "2013-01-01", "latest"]) {
    assert.throws(() => client.coresignalExactYearEsDslSearchContract(exactYearFilters({ graduationYear })), /four-digit graduation year/)
  }
  for (const graduationYear of ["", " ", "201", "20130", "NaN", "20x3", Number.NaN]) {
    assert.throws(() => client.coresignalEmployeeEsDslSearchContract({ graduationYear }), /exact four-digit year/)
  }
})

test("nested education binds stable IIML identity and exact year to the same education row", () => {
  const shruti = [{ institution_id: client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, date_to_year: 2011 }]
  const differentYear = [{ institution_id: client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, date_to_year: 2013 }]
  const crossObject = [
    { institution_id: client.CORESIGNAL_IIM_LUCKNOW_INSTITUTION_ID, date_to_year: 2013 },
    { institution_id: 999, date_to_year: 2011 },
  ]

  assert.equal(educationMatchesGeneratedNestedQuery(shruti), true)
  assert.equal(educationMatchesGeneratedNestedQuery(differentYear), false)
  assert.equal(educationMatchesGeneratedNestedQuery(crossObject), false)
})

test("unsupported discovery filters cannot leak into dormant exact-year provider clauses", () => {
  const baseline = exactContract()
  const withUnsupportedFilters = exactContract({
    company: "Lincoln International",
    role: "Vice President",
    function: "Finance",
    seniorities: ["Director", "VP", "CXO"],
    seniority: "VP",
    discoveryProgrammes: ["PGP", "ABM", "SM"],
    location: "Mumbai",
  })
  assert.deepEqual(withUnsupportedFilters, baseline)
  assert.doesNotMatch(JSON.stringify(withUnsupportedFilters), /Lincoln|Vice President|Finance|Director|CXO|PGP|ABM|Mumbai|experience|program/i)
})

test("verified current-company builder keeps company, current, and deletion terms in one experience row", () => {
  const contract = client.coresignalCurrentCompanyEsDslDiagnosticContract({ companyId: 8469989 })
  assert.equal(contract.searchMode, "CURRENT_COMPANY")
  assert.equal(contract.method, "POST")
  assert.equal(contract.path, "/cdapi/v2/employee_base/search/es_dsl")
  assert.deepEqual(contract.query, { items_per_page: 1 })

  const nestedClauses = contract.body.query.bool.filter.filter(clause => clause.nested).map(clause => clause.nested)
  assert.deepEqual(nestedClauses.map(clause => clause.path), ["education", "experience"])
  assert.deepEqual(nestedClauses[0].query.bool.filter, [
    { term: { "education.institution_id": 25919228 } },
  ])
  assert.deepEqual(nestedClauses[1].query.bool.filter, [
    { term: { "experience.company_id": 8469989 } },
    { term: { "experience.is_current": 1 } },
    { term: { "experience.deleted": 0 } },
  ])

  const serialized = JSON.stringify(contract.body)
  assert.doesNotMatch(serialized, /institution_url|date_to|date_to_year|company_name|seniority|title/)
})

test("verified current-company builder strictly validates provider company IDs", () => {
  assert.equal(client.coresignalCurrentCompanyEsDslDiagnosticContract({ companyId: "8469989" }).body.query.bool.filter.length, 3)
  for (const companyId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "", " ", " 8469989", "8469989 ", "1.5", "company", "9007199254740992", Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    assert.throws(() => client.coresignalCurrentCompanyEsDslDiagnosticContract({ companyId }), /positive safe integer/)
  }
})

test("optional company year reuses the same verified nested education row", () => {
  const contract = client.coresignalCurrentCompanyEsDslDiagnosticContract({ companyId: 8469989, graduationYear: "2011" })
  assert.equal(contract.searchMode, "CURRENT_COMPANY_EXACT_GRADUATION_YEAR")
  const nestedClauses = contract.body.query.bool.filter.filter(clause => clause.nested).map(clause => clause.nested)
  assert.equal(nestedClauses.filter(clause => clause.path === "education").length, 1)
  assert.deepEqual(nestedClauses.find(clause => clause.path === "education").query.bool.filter, [
    { term: { "education.institution_id": 25919228 } },
    { term: { "education.date_to_year": 2011 } },
  ])
})

test("current-company builder remains provider-free and raw client IDs are not accepted by product routes", async () => {
  const previousFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error("Unexpected provider call")
  }
  try {
    client.coresignalCurrentCompanyEsDslDiagnosticContract({ companyId: 8469989 })
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = previousFetch
  }

  for (const file of ["app/page.tsx", "app/api/discovery/route.ts", "lib/coresignal-regular-search.ts"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /coresignalCurrentCompanyEsDslDiagnosticContract/, file)
    assert.doesNotMatch(source, /payload\.(companyId|providerCompanyId)/, file)
  }
})

test("exact-year builder does not replace or alter the upper-bound Filter Preview contract", () => {
  const filters = exactYearFilters({
    company: "Lincoln International",
    seniorities: ["VP"],
    seniority: "VP",
    discoveryProgrammes: ["PGP", "ABM", "SM"],
  })
  assert.deepEqual(client.coresignalSearchContract(filters).body, {
    education_institution_professional_network_url: client.CORESIGNAL_IIML_INSTITUTION_URL,
    active_experience: true,
    education_date_to: "2011",
    experience_company_name: "Lincoln International",
  })
  assert.equal("education_date_to" in exactContract().body, false)
  assert.equal("education_program_name" in client.coresignalSearchContract(filters).body, false)
  assert.equal("experience_title" in client.coresignalSearchContract(filters).body, false)
})

test("building the contract is provider-free and only the separately gated runtime references it", async () => {
  const previousFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error("Unexpected provider call")
  }
  try {
    exactContract()
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = previousFetch
  }

  const unchangedPreviewCollectFiles = [
    "lib/coresignal-adapter.ts",
    "lib/discovery-execution.ts",
  ]
  for (const file of unchangedPreviewCollectFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /coresignalExactYearEsDslSearchContract|CORESIGNAL_ES_DSL_SEARCH_PATH|employee_base\/search\/es_dsl/, file)
  }
  const runtime = await readFile(new URL("../lib/coresignal-regular-search.ts", import.meta.url), "utf8")
  assert.match(runtime, /coresignalRegularSearchEnabled/)
  assert.match(runtime, /searchCoresignalEmployeeIds/)
})

test("documentation separates verified search predicates from post-Collect authority", async () => {
  const clientSource = await readFile(new URL("../lib/coresignal-client.ts", import.meta.url), "utf8")
  const providerDocs = await readFile(new URL("../docs/providers.md", import.meta.url), "utf8")
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8")
  assert.match(clientSource, /experience[\s\S]*live-verified current-company ES structure/)
  assert.match(providerDocs, /education\.institution_id=25919228[^\n]*provider reported 35,103 matches/)
  assert.match(providerDocs, /Bharani[^\n]*2013[^\n]*deleted legacy/)
  assert.match(providerDocs, /live verified for the IIM Lucknow 2011 case/)
  assert.match(providerDocs, /provider_company_mappings/)
  assert.match(readme, /institution ID 25919228[^\n]*live-verified/)
})
