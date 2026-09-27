import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const pagination = await vite.ssrLoadModule("/lib/pagination.ts")
const paginationSource = await readFile(new URL("../lib/pagination.ts", import.meta.url), "utf8")
const component = await readFile(new URL("../components/pagination.tsx", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")
const admin = await readFile(new URL("../app/admin-panel.tsx", import.meta.url), "utf8")

test("pagination defaults to 10 rows and offers only 10, 25, and 50", () => {
  assert.deepEqual(pagination.PAGE_SIZE_OPTIONS, [10, 25, 50])
  assert.match(component, /useState<PageSize>\(10\)/)
  assert.match(component, /PAGE_SIZE_OPTIONS\.map/)
})

test("pagination calculates correct ranges and slices", () => {
  const rows = Array.from({ length: 26 }, (_, index) => index + 1)
  assert.deepEqual(pagination.paginationRange(26, 1, 10), { start: 1, end: 10 })
  assert.deepEqual(pagination.paginationRange(26, 3, 10), { start: 21, end: 26 })
  assert.deepEqual(pagination.paginationRange(0, 1, 10), { start: 0, end: 0 })
  assert.deepEqual(pagination.paginate(rows, 2, 10), rows.slice(10, 20))
  assert.equal(pagination.totalPages(26, 10), 3)
})

test("Previous and Next are disabled at their boundaries", () => {
  assert.equal(pagination.clampedPage(0, 26, 10), 1)
  assert.equal(pagination.clampedPage(99, 26, 10), 3)
  assert.match(component, /disabled=\{model\.page <= 1\}/)
  assert.match(component, /disabled=\{model\.page >= model\.pageCount\}/)
  assert.match(component, /Page \{model\.page\} of \{model\.pageCount\}/)
})

test("filter and ranking pipelines run before directory and outreach pagination", () => {
  assert.ok(page.indexOf("const filtered = useMemo") < page.indexOf("usePagination(filtered"))
  assert.match(page, /matchesInternalFilters[\s\S]*?\.sort\(\(a, b\) => relevanceBreakdown\(b/)
  assert.ok(page.indexOf("const visibleOutreach = alumni.filter") < page.indexOf("usePagination(visibleOutreach"))
  assert.match(page, /const visibleOutreach = alumni\.filter[\s\S]*?\.sort\(\(a, b\) => relevanceBreakdown\(b/)
})

test("filter and page-size changes reset to page one", () => {
  assert.match(component, /activeResetKey !== resetKey/)
  assert.match(component, /setPage\(1\)/)
  assert.match(component, /function setPageSize[\s\S]*?setPageSizeState\(next\)[\s\S]*?setPage\(1\)/)
  assert.match(page, /usePagination\(filtered, JSON\.stringify\(filters\)\)/)
  assert.match(page, /usePagination\(visibleEngagements, JSON\.stringify/)
  assert.match(page, /usePagination\(visibleOutreach, JSON\.stringify/)
  assert.match(admin, /usePagination\(visibleLifecycle, JSON\.stringify/)
  assert.match(admin, /usePagination\(visibleAudit, JSON\.stringify/)
})

test("stored-record paging is local and cannot trigger providers or mail", () => {
  assert.doesNotMatch(component, /fetch\(|CORESIGNAL|LUSHA|SIGNALS|GMAIL|MAIL/)
  assert.doesNotMatch(paginationSource, /fetch\(|CORESIGNAL|LUSHA|SIGNALS|GMAIL|MAIL/)
  assert.match(page, /const providerHistoryPagination = usePagination\(providerHistory\)/)
  assert.match(page, /discoveryResults\.map\(result =>/)
  assert.doesNotMatch(page, /usePagination\(discoveryResults/)
})

test("product sections retain independent pagination state", () => {
  for (const name of ["directoryPagination", "companyContactsPagination", "companyHistoryPagination", "engagementPagination", "outreachPagination", "importPagination", "enrichmentPagination", "providerHistoryPagination", "profileOpenEngagementPagination", "profileEngagementHistoryPagination", "eventActivityPagination"]) {
    assert.match(page, new RegExp(`const ${name} = usePagination`))
  }
  for (const name of ["usersPagination", "lifecyclePagination", "auditPagination"]) assert.match(admin, new RegExp(`const ${name} = usePagination`))
})

test("Overview stays compact and fixed configuration collections stay unpaginated", () => {
  assert.match(page, /const topLeads = [\s\S]*?\.slice\(0, 5\)/)
  assert.match(page, /Top alumni for outreach/)
  assert.match(page, /View all/)
  assert.match(page, /actionableProfessionalEvents\.slice\(0, 3\)/)
  assert.match(admin, /\(data\.programmeOptions \?\? \[\]\)\.map/)
  assert.doesNotMatch(admin, /usePagination\(data\.programmeOptions/)
})

test("every growth-prone collection renders the shared footer", () => {
  for (const label of ["Alumni Directory", "Company contacts", "Company account history", "Engagement queue", "Outreach pipeline", "Import review", "Enrichment alumni", "Provider history", "Profile open engagement", "Profile engagement history", "Event activity"]) assert.match(page, new RegExp(`${label} pagination`))
  for (const label of ["Administration users", "Data lifecycle", "Security audit"]) assert.match(admin, new RegExp(`${label} pagination`))
})
