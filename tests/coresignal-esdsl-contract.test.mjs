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
  graduationYear: "2013",
  ...overrides,
})

const exactContract = overrides => client.coresignalExactYearEsDslSearchContract(exactYearFilters(overrides))

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
                      { term: { "education.institution_url": "https://www.linkedin.com/school/indian-institute-of-management-lucknow" } },
                      { term: { "education.date_to_year": 2013 } },
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
})

test("nested education binds stable IIML identity and exact year to the same education row", () => {
  const shruti = [{ institution_url: client.CORESIGNAL_IIML_INSTITUTION_URL, date_to_year: 2011 }]
  const bharani = [{ institution_url: client.CORESIGNAL_IIML_INSTITUTION_URL, date_to_year: 2013 }]
  const crossObject = [
    { institution_url: client.CORESIGNAL_IIML_INSTITUTION_URL, date_to_year: 2011 },
    { institution_url: "https://www.linkedin.com/school/another-institution", date_to_year: 2013 },
  ]

  assert.equal(educationMatchesGeneratedNestedQuery(shruti), false)
  assert.equal(educationMatchesGeneratedNestedQuery(bharani), true)
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
    education_date_to: "2013",
    experience_company_name: "Lincoln International",
  })
  assert.equal("education_date_to" in exactContract().body, false)
  assert.equal("education_program_name" in client.coresignalSearchContract(filters).body, false)
  assert.equal("experience_title" in client.coresignalSearchContract(filters).body, false)
})

test("building the dormant contract performs no fetch and runtime entry points do not reference it", async () => {
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

  const runtimeFiles = [
    "app/api/discovery/route.ts",
    "app/page.tsx",
    "lib/coresignal-adapter.ts",
    "lib/discovery-execution.ts",
    "lib/provider-runtime.ts",
    "package.json",
  ]
  for (const file of runtimeFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /coresignalExactYearEsDslSearchContract|CORESIGNAL_ES_DSL_SEARCH_PATH|employee_base\/search\/es_dsl/, file)
  }
})
