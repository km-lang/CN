import { defaultDirectoryFilters, matchesInternalFilters, normalized, type DirectoryFilters, type SearchableAlumnus } from "@/lib/alumni-search"

export const DIRECTORY_PAGE_SIZES = [10, 25, 50] as const
export type DirectorySort = "relevance" | "name" | "graduationYear" | "seniority"

export type DirectoryQuery = {
  filters: DirectoryFilters
  page: number
  pageSize: 10 | 25 | 50
  sort: DirectorySort
}

export type EmploymentEvidence = {
  companyId?: string
  company: string
  title: string
  seniority?: string
  startDate?: string
  endDate?: string
  current?: boolean
  deleted?: boolean
  observedAt?: string
}

export type CurrentRoleResolution = {
  state: "RESOLVED" | "UNKNOWN" | "REVIEW_REQUIRED"
  current: EmploymentEvidence | null
  historical: EmploymentEvidence[]
  reason: string
}

function text(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max)
}

function parseYear(value: unknown, label: string, required = false) {
  const raw = text(value, 4)
  if (!raw && !required) return ""
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error(`${label} must be a valid year from 1900 to 2100.`)
  return String(year)
}

function stringList(value: unknown) {
  const supplied = Array.isArray(value) ? value : text(value).split(",")
  return [...new Set(supplied.map(item => text(item, 80)).filter(Boolean))]
}

export function normalizeDirectoryQuery(value: unknown): DirectoryQuery {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const defaults = defaultDirectoryFilters()
  if (candidate.graduationYearMode !== undefined && !["exact", "onOrBefore", "range", "multiple"].includes(text(candidate.graduationYearMode))) throw new Error("Graduation-year mode is unsupported.")
  const mode = ["exact", "onOrBefore", "range", "multiple"].includes(text(candidate.graduationYearMode))
    ? text(candidate.graduationYearMode) as DirectoryFilters["graduationYearMode"]
    : defaults.graduationYearMode
  if (candidate.seniorityMode !== undefined && !["selected", "minimum"].includes(text(candidate.seniorityMode))) throw new Error("Seniority mode is unsupported.")
  const seniorityMode = candidate.seniorityMode === "minimum" ? "minimum" : "selected"
  const seniorities = stringList(candidate.seniorities)
  const batch = mode === "exact" || mode === "onOrBefore" ? parseYear(candidate.batch, "Graduation year", false) : ""
  const graduationYearStart = mode === "range" ? parseYear(candidate.graduationYearStart, "Start year", true) : ""
  const graduationYearEnd = mode === "range" ? parseYear(candidate.graduationYearEnd, "End year", true) : ""
  if (mode === "range" && Number(graduationYearStart) > Number(graduationYearEnd)) throw new Error("Start year must be on or before end year.")
  const years = mode === "multiple" ? stringList(candidate.graduationYears).map(value => parseYear(value, "Selected batch", true)) : []
  if (mode === "multiple" && !years.length) throw new Error("Select at least one graduation year.")
  if (seniorityMode === "minimum" && seniorities.length > 1) throw new Error("Minimum seniority accepts one threshold.")
  const pageSizeValue = Number(candidate.pageSize)
  if (candidate.pageSize !== undefined && !DIRECTORY_PAGE_SIZES.includes(pageSizeValue as 10 | 25 | 50)) throw new Error("Page size must be 10, 25, or 50.")
  const pageSize = DIRECTORY_PAGE_SIZES.includes(pageSizeValue as 10 | 25 | 50) ? pageSizeValue as 10 | 25 | 50 : 10
  if (candidate.sort !== undefined && !["relevance", "name", "graduationYear", "seniority"].includes(text(candidate.sort))) throw new Error("Directory sort is unsupported.")
  const sort = ["relevance", "name", "graduationYear", "seniority"].includes(text(candidate.sort)) ? text(candidate.sort) as DirectorySort : "relevance"
  return {
    filters: {
      ...defaults,
      name: text(candidate.name), company: text(candidate.company) || defaults.company, role: text(candidate.role),
      function: text(candidate.function) || defaults.function, seniority: text(candidate.seniority) || defaults.seniority,
      location: text(candidate.location), linkedinUrl: text(candidate.linkedinUrl, 300), programme: text(candidate.programme) || defaults.programme,
      batch, graduationYearMode: mode, graduationYearStart, graduationYearEnd, graduationYears: years.join(","),
      seniorityMode, seniorities, previousCompany: text(candidate.previousCompany),
      minRelevance: Math.max(0, Math.min(100, Number(candidate.minRelevance) || 0)),
      minConfidence: Math.max(0, Math.min(100, Number(candidate.minConfidence) || 0)),
      contactStatus: text(candidate.contactStatus) || defaults.contactStatus,
      outreachStatus: text(candidate.outreachStatus) || defaults.outreachStatus,
      relationship: text(candidate.relationship) || defaults.relationship,
    },
    page: Math.max(1, Math.trunc(Number(candidate.page) || 1)), pageSize, sort,
  }
}

export function normalizedPersonName(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function directoryMatches(person: SearchableAlumnus, query: DirectoryQuery, relevance: number, contactStatus: string) {
  const nameQuery = normalizedPersonName(query.filters.name)
  const nameMatches = !nameQuery || normalizedPersonName(person.name).includes(nameQuery)
  return nameMatches && matchesInternalFilters(person, { ...query.filters, name: "" }, relevance, contactStatus)
}

function evidenceTime(value: EmploymentEvidence) {
  const source = value.startDate || value.endDate || value.observedAt || ""
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function employerKey(value: EmploymentEvidence) {
  return value.companyId?.trim() ? `id:${value.companyId.trim()}` : `name:${normalized(value.company)}`
}

export function resolveLatestValidPosition(records: readonly EmploymentEvidence[], selectedCompany?: { id?: string; name?: string }): CurrentRoleResolution {
  const valid = records.filter(record => !record.deleted && normalized(record.company))
  const selectedKey = selectedCompany?.id?.trim() ? `id:${selectedCompany.id.trim()}` : selectedCompany?.name ? `name:${normalized(selectedCompany.name)}` : ""
  const scoped = selectedKey ? valid.filter(record => employerKey(record) === selectedKey) : valid
  const historical = scoped.filter(record => record.current === false).sort((a, b) => evidenceTime(b) - evidenceTime(a))
  const current = scoped.filter(record => record.current === true).sort((a, b) => evidenceTime(b) - evidenceTime(a))
  if (!current.length) return { state: "UNKNOWN", current: null, historical, reason: "No valid current employment evidence was returned." }
  const latestTime = evidenceTime(current[0])
  const latest = current.filter(record => evidenceTime(record) === latestTime)
  const identities = new Set(latest.map(record => `${employerKey(record)}|${normalized(record.title)}`))
  if (identities.size !== 1) return { state: "REVIEW_REQUIRED", current: null, historical, reason: "Current employment records conflict at the latest observed position." }
  return { state: "RESOLVED", current: latest[0], historical, reason: "Latest unambiguous current position." }
}

export function applyDirectoryQuery<T extends SearchableAlumnus>(items: readonly T[], query: DirectoryQuery, relevance: (item: T) => number, contactStatus: (item: T) => string) {
  const matched = items.filter(item => directoryMatches(item, query, relevance(item), contactStatus(item)))
  matched.sort((a, b) => {
    if (query.sort === "name") return normalizedPersonName(a.name).localeCompare(normalizedPersonName(b.name)) || a.name.localeCompare(b.name)
    if (query.sort === "graduationYear") return (a.graduationYear || a.batch || 0) - (b.graduationYear || b.batch || 0) || a.name.localeCompare(b.name)
    if (query.sort === "seniority") return normalized(a.seniority).localeCompare(normalized(b.seniority)) || a.name.localeCompare(b.name)
    return relevance(b) - relevance(a) || a.name.localeCompare(b.name) || 0
  })
  const total = matched.length
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const offset = (page - 1) * query.pageSize
  return { items: matched.slice(offset, offset + query.pageSize), all: matched, total, page, pageSize: query.pageSize, pageCount }
}
