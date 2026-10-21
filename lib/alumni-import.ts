import { unzipSync } from "fflate"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"

export const MAX_IMPORT_ROWS = 10_000
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024
export const IMPORT_TEMPLATE_COLUMNS = ["source_alumni_id", "source_system", "canonical_alumni_id", "name", "programme", "graduation_year", "company", "title", "function", "seniority", "industry", "location", "previous_companies", "experience_years", "linkedin_url", "email", "phone", "general_contact_status", "professional_engagement_status", "birthday_engagement_status", "consent_source", "source_date", "last_reviewed_date", "note", "clear_fields"] as const

export type ImportRecord = Record<string, string>
export type ImportExisting = { id: number; profileKey?: string; name: string; batch: number; graduationYear?: number; programme: string; company: string; title: string; function: string; seniority: string; location: string; email: string; phone: string; linkedinUrl?: string; previous?: string; currentCompanyVerification?: string; designationVerification?: string; locationVerification?: string; emailVerification?: string; updatedAt?: string }
export type ImportReviewKind = "new" | "existing" | "unchanged" | "duplicate" | "likely_duplicate" | "conflict" | "error"
export type ImportReviewRow = { index: number; key: string; kind: ImportReviewKind; disposition: string; record: ImportRecord; rawRecord: ImportRecord; existing?: ImportExisting; changedFields: string[]; issues: string[]; matchedBy: string[] }
export type ImportReview = { rows: ImportReviewRow[]; counts: { detected: number; valid: number; invalid: number; newRecords: number; existingMatches: number; supportedUpdates: number; unchanged: number; needsAttention: number; duplicates: number; conflicts: number; rejected: number }; blocking: boolean }

const HEADER_ALIASES: Record<string, string> = { alumnus_id: "source_alumni_id", alumni_id: "canonical_alumni_id", source_id: "source_alumni_id", institutional_id: "source_alumni_id", source: "source_system", batch: "graduation_year", designation: "title", current_company: "company", current_title: "title", professional_profile_url: "linkedin_url", linkedin: "linkedin_url", data_confidence: "confidence", outreach_status: "status", current_industry: "industry" }
const CONTACT_STATUSES = new Set(["", "Unknown", "Standard engagement allowed", "Professional engagement only", "Birthday engagement allowed", "No birthday engagement", "No professional engagement", "Do not contact"])
const CONSENT_SOURCES = new Set(["", "Unknown", "Internal institutional record", "Alumni-confirmed", "Manual PCOM record", "Provider sourced"])

function canonicalHeader(value: string) { const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); return HEADER_ALIASES[normalized] ?? normalized }
function recordsFromRows(rows: string[][]) {
  if (rows.length < 2) throw new Error("The file must contain a header row and at least one alumnus.")
  const headers = rows[0].map(header => canonicalHeader(header.replace(/^\uFEFF/, "")))
  if (headers.some(header => !header)) throw new Error("Every import column needs a header.")
  if (new Set(headers).size !== headers.length) throw new Error("The file contains duplicate or equivalent column headers.")
  const supported = new Set<string>([...IMPORT_TEMPLATE_COLUMNS, "confidence", "status"])
  const unsupported = headers.filter(header => !supported.has(header))
  if (unsupported.length) throw new Error(`Unsupported import column${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}.`)
  return rows.slice(1).filter(row => row.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])))
}

export function parseCsv(content: string): ImportRecord[] {
  if (new TextEncoder().encode(content).byteLength > MAX_IMPORT_BYTES) throw new Error("The file exceeds the 8 MB import limit.")
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]; const next = content[index + 1]
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === "," && !quoted) { row.push(cell); cell = ""; continue }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell); cell = ""; if (row.some(value => value.trim())) rows.push(row); row = []
      if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`The file contains more than the ${MAX_IMPORT_ROWS.toLocaleString()}-row import limit.`)
      continue
    }
    cell += character
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted field.")
  row.push(cell); if (row.some(value => value.trim())) rows.push(row)
  return recordsFromRows(rows)
}

function decodeXml(value: string) { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))) }
function xmlText(value: string) { return [...value.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/g)].map(match => decodeXml(match[1])).join("") }
function columnIndex(reference: string) { const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A"; return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1 }
function decodeEntry(entries: Record<string, Uint8Array>, name: string) { const entry = entries[name]; if (!entry) throw new Error("The Excel workbook is missing required worksheet data."); return new TextDecoder().decode(entry) }
function dateStyleIndexes(styles: string) {
  const customDates = new Set<number>()
  for (const match of styles.matchAll(/<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*)\/?\s*>/g)) {
    const id = Number(match[1].match(/\bnumFmtId="(\d+)"/)?.[1]); const format = decodeXml(match[1].match(/\bformatCode="([^"]*)"/)?.[1] ?? "")
    if (/[yd]/i.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""))) customDates.add(id)
  }
  const cellXfs = styles.match(/<(?:[A-Za-z_][\w.-]*:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs>/)?.[1] ?? ""
  return new Set([...cellXfs.matchAll(/<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*)\/?\s*>/g)].flatMap((match, index) => {
    const id = Number(match[1].match(/\bnumFmtId="(\d+)"/)?.[1]); return (id >= 14 && id <= 17) || id === 22 || customDates.has(id) ? [index] : []
  }))
}
function excelDate(value: string, date1904: boolean) {
  const serial = Number(value)
  if (!Number.isInteger(serial) || serial < (date1904 ? 0 : 1) || (!date1904 && serial === 60)) return ""
  const days = date1904 ? serial : serial < 60 ? serial + 1 : serial
  const date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + days * 86_400_000)
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : ""
}
export function parseXlsx(input: ArrayBuffer | Uint8Array): { records: ImportRecord[]; sheetName: string } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("The file exceeds the 8 MB import limit.")
  let entries: Record<string, Uint8Array>; try { entries = unzipSync(bytes) } catch { throw new Error("The Excel workbook is invalid, encrypted, or password-protected.") }
  if (entries.EncryptionInfo || entries.EncryptedPackage) throw new Error("Password-protected or encrypted Excel workbooks are not supported.")
  const workbook = decodeEntry(entries, "xl/workbook.xml"); const sheet = workbook.match(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/)
  if (!sheet) throw new Error("The Excel workbook does not contain a worksheet.")
  const name = decodeXml(sheet[1].match(/\bname="([^"]*)"/)?.[1] ?? "First worksheet"); const relationshipId = sheet[1].match(/\br:id="([^"]+)"/)?.[1]; let sheetPath = "xl/worksheets/sheet1.xml"
  if (relationshipId && entries["xl/_rels/workbook.xml.rels"]) { const relationships = decodeEntry(entries, "xl/_rels/workbook.xml.rels"); const relationship = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(match => match[1].includes(`Id="${relationshipId}"`)); const target = relationship?.[1].match(/\bTarget="([^"]+)"/)?.[1]; if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}` }
  const shared = entries["xl/sharedStrings.xml"] ? [...decodeEntry(entries, "xl/sharedStrings.xml").matchAll(/<(?:[A-Za-z_][\w.-]*:)?si>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/g)].map(match => xmlText(match[1])) : []
  const dateStyles = entries["xl/styles.xml"] ? dateStyleIndexes(decodeEntry(entries, "xl/styles.xml")) : new Set<number>()
  const date1904 = /<(?:[A-Za-z_][\w.-]*:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbook)
  const worksheet = decodeEntry(entries, sheetPath)
  const rows = [...worksheet.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/g)].map(rowMatch => { const row: string[] = []; for (const cell of rowMatch[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/g)) { const reference = cell[1].match(/\br="([^"]+)"/)?.[1] ?? "A1"; const type = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? "n"; const raw = cell[2]?.match(/<(?:[A-Za-z_][\w.-]*:)?v>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/)?.[1] ?? ""; const value = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? xmlText(cell[2] ?? "") : decodeXml(raw); const style = Number(cell[1].match(/\bs="(\d+)"/)?.[1]); row[columnIndex(reference)] = type === "d" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : type === "n" && dateStyles.has(style) && raw ? excelDate(value, date1904) || value : value } return row })
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`The workbook contains more than the ${MAX_IMPORT_ROWS.toLocaleString()}-row import limit.`)
  return { records: recordsFromRows(rows), sheetName: name }
}

function normalized(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }
function compact(value: unknown) { return String(value ?? "").trim().replace(/\s+/g, " ") }
function sourceToken(value: unknown) { return compact(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") }
export function institutionalProfileKey(record: ImportRecord) { const sourceId = sourceToken(record.source_alumni_id); const sourceSystem = sourceToken(record.source_system); return sourceId && sourceSystem ? `institutional:${sourceSystem}:${sourceId}` : "" }
function safeYear(value: unknown) { const year = Number(compact(value)); return Number.isInteger(year) ? year : 0 }
function validDate(value: string) { return !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) }
function validEmail(value: string) { return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
export function normalizeImportRecord(record: ImportRecord, programmeValues: string[]): ImportRecord {
  const programmes = new Map(programmeValues.map(value => [normalized(value), value.trim()])); const rawProgramme = compact(record.programme); const programme = programmes.get(normalized(rawProgramme)) ?? rawProgramme.toUpperCase(); const linkedinIdentifier = linkedinProfileIdentifier(record.linkedin_url)
  return { ...record, source_alumni_id: compact(record.source_alumni_id), source_system: compact(record.source_system), name: compact(record.name), programme, graduation_year: String(safeYear(record.graduation_year || record.batch) || compact(record.graduation_year || record.batch)), company: compact(record.company), title: compact(record.title), function: compact(record.function), seniority: compact(record.seniority), industry: compact(record.industry), location: compact(record.location), previous_companies: compact(record.previous_companies), experience_years: compact(record.experience_years), linkedin_url: linkedinIdentifier ? `https://www.linkedin.com/in/${encodeURIComponent(linkedinIdentifier)}` : compact(record.linkedin_url), email: compact(record.email).toLowerCase(), phone: compact(record.phone), source_date: compact(record.source_date), last_reviewed_date: compact(record.last_reviewed_date), note: compact(record.note) }
}
function likelyKey(record: ImportRecord) { return [record.name, record.graduation_year, record.programme].map(normalized).join("|") }
function differences(record: ImportRecord, match: ImportExisting) { const values: Array<[string, unknown]> = [["programme", match.programme], ["company", match.company], ["title", match.title], ["function", match.function], ["seniority", match.seniority], ["location", match.location], ["email", match.email], ["phone", match.phone], ["linkedin_url", match.linkedinUrl], ["previous_companies", match.previous]]; return values.filter(([field, current]) => Boolean(record[field]) && normalized(current) !== normalized(record[field])).map(([field]) => field) }

export function validateImport(records: ImportRecord[], existing: ImportExisting[], programmeValues: string[], options: { maxRows?: number; mode?: "upsert" | "update_only" } = {}): ImportReview {
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS; if (records.length > maxRows) throw new Error(`The file contains more than the ${maxRows.toLocaleString()}-row import limit.`)
  const allowedProgrammes = new Set(programmeValues.map(normalized)); const sourceSeen = new Set<string>(); const linkedinSeen = new Set<string>(); const canonicalSeen = new Set<number>()
  const byId = new Map(existing.map(person => [person.id, person]))
  const byProfileKey = new Map<string, ImportExisting[]>(); const byLinkedin = new Map<string, ImportExisting[]>(); const byVerifiedEmail = new Map<string, ImportExisting[]>(); const byEmail = new Map<string, ImportExisting[]>(); const byLikelyKey = new Map<string, ImportExisting[]>()
  const addIndex = (index: Map<string, ImportExisting[]>, key: string, person: ImportExisting) => { if (key) index.set(key, [...(index.get(key) ?? []), person]) }
  for (const person of existing) {
    addIndex(byProfileKey, person.profileKey ?? "", person)
    const linkedin = linkedinProfileIdentifier(person.linkedinUrl); if (linkedin) addIndex(byLinkedin, linkedin, person)
    const email = normalized(person.email); if (email) { if (person.emailVerification === "Verified") addIndex(byVerifiedEmail, email, person); addIndex(byEmail, email, person) }
    addIndex(byLikelyKey, likelyKey({ name: person.name, graduation_year: String(person.graduationYear || person.batch), programme: person.programme }), person)
  }
  const rows = records.map((rawRecord, offset): ImportReviewRow => {
    const record = normalizeImportRecord(rawRecord, programmeValues); const index = offset + 2; const key = institutionalProfileKey(record) || `row:${index}`; const issues: string[] = []; const year = safeYear(record.graduation_year)
    const updateOnly = options.mode === "update_only"
    const hasStableIdentity = Boolean((record.source_alumni_id && record.source_system) || record.canonical_alumni_id || record.linkedin_url || record.email)
    if (updateOnly && !hasStableIdentity) issues.push("Update-only rows require a stable source ID, canonical alumni ID, LinkedIn profile, or verified email")
    if (!updateOnly) { if (!record.source_alumni_id) issues.push("Source alumni identifier is required"); if (!record.source_system) issues.push("Source system is required"); if (!record.name) issues.push("Name is required"); if (!record.company) issues.push("Company is required"); if (!record.programme) issues.push("Programme is required") }
    if (record.graduation_year && (!Number.isInteger(year) || year < 1940 || year > new Date().getUTCFullYear() + 10)) issues.push("Graduation year must be a plausible four-digit year")
    if (!updateOnly && (!Number.isInteger(year) || year < 1940 || year > new Date().getUTCFullYear() + 10)) issues.push("Graduation year must be a plausible four-digit year")
    if (record.programme && !allowedProgrammes.has(normalized(record.programme))) issues.push(`Programme “${record.programme}” is not configured`)
    if (!validEmail(record.email)) issues.push("Email is malformed"); if (record.linkedin_url && !linkedinProfileIdentifier(record.linkedin_url)) issues.push("LinkedIn URL must identify a linkedin.com/in profile"); if (!validDate(record.source_date)) issues.push("Source date must use YYYY-MM-DD"); if (!validDate(record.last_reviewed_date)) issues.push("Last reviewed date must use YYYY-MM-DD")
    if (record.experience_years && (!Number.isInteger(Number(record.experience_years)) || Number(record.experience_years) < 0 || Number(record.experience_years) > 80)) issues.push("Experience years must be an integer from 0 to 80")
    for (const [field, limit] of Object.entries({ source_alumni_id: 160, source_system: 80, name: 200, company: 240, title: 240, function: 160, seniority: 120, industry: 160, location: 200, note: 1000 })) if ((record[field] ?? "").length > limit) issues.push(`${field.replaceAll("_", " ")} exceeds ${limit} characters`)
    for (const field of ["general_contact_status", "professional_engagement_status", "birthday_engagement_status"]) if (!CONTACT_STATUSES.has(record[field] ?? "")) issues.push(`${field.replaceAll("_", " ")} is unsupported`)
    if (!CONSENT_SOURCES.has(record.consent_source ?? "")) issues.push("Consent source is unsupported")
    const sourceKey = institutionalProfileKey(record); const linkedinId = linkedinProfileIdentifier(record.linkedin_url); const duplicateSignals: string[] = []
    const canonicalId = Number(record.canonical_alumni_id)
    if (sourceKey && sourceSeen.has(sourceKey)) duplicateSignals.push("duplicate source identifier in this file"); if (linkedinId && linkedinSeen.has(linkedinId)) duplicateSignals.push("duplicate LinkedIn profile in this file"); if (Number.isInteger(canonicalId) && canonicalId > 0 && canonicalSeen.has(canonicalId)) duplicateSignals.push("duplicate canonical alumni ID in this file"); if (sourceKey) sourceSeen.add(sourceKey); if (linkedinId) linkedinSeen.add(linkedinId); if (Number.isInteger(canonicalId) && canonicalId > 0) canonicalSeen.add(canonicalId)
    const matched = new Map<number, { person: ImportExisting; signals: string[] }>(); const addMatch = (person: ImportExisting | undefined, signal: string) => { if (!person) return; const entry = matched.get(person.id) ?? { person, signals: [] }; entry.signals.push(signal); matched.set(person.id, entry) }
    for (const person of sourceKey ? byProfileKey.get(sourceKey) ?? [] : []) addMatch(person, "stable source identifier")
    if (Number.isInteger(canonicalId) && canonicalId > 0) { const canonicalMatch = byId.get(canonicalId); if (!canonicalMatch) issues.push("Canonical alumni ID does not exist"); else addMatch(canonicalMatch, "canonical alumni ID") }
    if (linkedinId) for (const person of byLinkedin.get(linkedinId) ?? []) addMatch(person, "LinkedIn profile")
    if (record.email) for (const person of byVerifiedEmail.get(normalized(record.email)) ?? []) addMatch(person, "verified email")
    const likely = new Map<number, ImportExisting>(); for (const person of byLikelyKey.get(likelyKey(record)) ?? []) likely.set(person.id, person); if (record.email) for (const person of byEmail.get(normalized(record.email)) ?? []) likely.set(person.id, person)
    const rawMatches = [...matched.values()]; const likelyMatches = [...likely.values()]; let kind: ImportReviewKind = "new"; let disposition = "CREATE"; let match: ImportExisting | undefined; let matchedBy: string[] = []
    if (issues.length) { kind = "error"; disposition = "REJECT" }
    else if (duplicateSignals.length) { kind = "duplicate"; disposition = "REJECT"; issues.push(...duplicateSignals) }
    else if (rawMatches.length > 1) { kind = "conflict"; disposition = "REVIEW"; issues.push("Trusted identity signals point to different existing alumni") }
    else if (rawMatches.length === 1) { match = rawMatches[0].person; matchedBy = rawMatches[0].signals; const changedFields = differences(record, match); kind = changedFields.length ? "existing" : "unchanged"; disposition = changedFields.length ? "SAFE_UPDATE_CANDIDATE" : "UNCHANGED"; return { index, key, kind, disposition, record, rawRecord, existing: match, changedFields, issues, matchedBy } }
    else if (updateOnly) { kind = "error"; disposition = "REJECT"; issues.push("No existing alumnus matched this update-only row; no record will be created") }
    else if (likelyMatches.length) { kind = likelyMatches.length > 1 ? "conflict" : "likely_duplicate"; disposition = "REVIEW"; match = likelyMatches[0]; issues.push(likelyMatches.length > 1 ? "Multiple existing alumni share weak identity signals" : "Name, programme and graduation year match an existing alumnus; stable identity evidence is required") }
    return { index, key, kind, disposition, record, rawRecord, existing: match, changedFields: match ? differences(record, match) : [], issues, matchedBy }
  })
  const counts = { detected: rows.length, valid: rows.filter(row => !["error", "duplicate", "conflict", "likely_duplicate"].includes(row.kind)).length, invalid: rows.filter(row => row.kind === "error").length, newRecords: rows.filter(row => row.kind === "new").length, existingMatches: rows.filter(row => row.kind === "existing" || row.kind === "unchanged").length, supportedUpdates: rows.filter(row => row.kind === "existing").length, unchanged: rows.filter(row => row.kind === "unchanged").length, needsAttention: rows.filter(row => row.kind === "error" || row.kind === "conflict" || row.kind === "likely_duplicate").length, duplicates: rows.filter(row => row.kind === "duplicate").length, conflicts: rows.filter(row => row.kind === "conflict" || row.kind === "likely_duplicate").length, rejected: rows.filter(row => row.disposition === "REJECT" || row.disposition === "REVIEW").length }
  return { rows, counts, blocking: counts.valid === 0 }
}

function safeSpreadsheetCell(value: unknown) { const text = String(value ?? ""); return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text }
function csvCell(value: unknown) { const safe = safeSpreadsheetCell(value); return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe }
export function importReviewCsv(review: ImportReview) { const header = ["row", "source_alumni_id", "name", "classification", "disposition", "matched_by", "changed_fields", "issues"]; return [header, ...review.rows.map(row => [row.index, row.record.source_alumni_id, row.record.name, row.kind, row.disposition, row.matchedBy.join("; "), row.changedFields.join("; "), row.issues.join("; ")])].map(values => values.map(csvCell).join(",")).join("\r\n") }
export function importPreviewDigest(review: ImportReview) { return JSON.stringify(review.rows.map(row => ({ index: row.index, key: row.key, kind: row.kind, disposition: row.disposition, changedFields: row.changedFields, matchedId: row.existing?.id ?? null, matchedUpdatedAt: row.existing?.updatedAt ?? "", record: row.record }))) }
export function templateCsv() { const example = ["IIML-TEST-0001", "iiml-master", "", "Aarav Example", "PGP", "2018", "Example Industries", "Senior Manager", "Strategy", "Senior Manager", "Technology", "Bengaluru", "Example Consulting", "8", "https://www.linkedin.com/in/aarav-example-test", "aarav.example@example.test", "", "Unknown", "Unknown", "Unknown", "Unknown", "2026-10-01", "", "Fictional template record", ""]; return [IMPORT_TEMPLATE_COLUMNS.join(","), example.map(csvCell).join(",")].join("\r\n") }
