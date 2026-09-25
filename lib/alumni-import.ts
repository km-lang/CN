import { unzipSync } from "fflate"

export type ImportRecord = Record<string, string>
export type ImportExisting = { id: number; name: string; batch: number; graduationYear?: number; programme: string; company: string; title: string; function: string; seniority: string; location: string; email: string; phone: string; linkedinUrl?: string; previous?: string }
export type ImportReviewRow = { index: number; key: string; kind: "new" | "existing" | "duplicate" | "error"; record: ImportRecord; existing?: ImportExisting; changedFields: string[]; issues: string[] }

const HEADER_ALIASES: Record<string, string> = {
  designation: "title",
  professional_profile_url: "linkedin_url",
  data_confidence: "confidence",
  outreach_status: "status",
}

function canonicalHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  return HEADER_ALIASES[normalized] ?? normalized
}

function recordsFromRows(rows: string[][]) {
  if (rows.length < 2) throw new Error("The file must contain a header row and at least one alumnus.")
  const headers = rows[0].map(header => canonicalHeader(header.replace(/^\uFEFF/, "")))
  return rows.slice(1).filter(row => row.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])))
}

export function parseCsv(content: string): ImportRecord[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const next = content[index + 1]
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === "," && !quoted) { row.push(cell); cell = ""; continue }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell); cell = ""
      if (row.some(value => value.trim())) rows.push(row)
      row = []
      continue
    }
    cell += character
  }
  row.push(cell)
  if (row.some(value => value.trim())) rows.push(row)
  return recordsFromRows(rows)
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

function xmlText(value: string) {
  return [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1])).join("")
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A"
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

function decodeEntry(entries: Record<string, Uint8Array>, name: string) {
  const entry = entries[name]
  if (!entry) throw new Error("The Excel workbook is missing required worksheet data.")
  return new TextDecoder().decode(entry)
}

export function parseXlsx(input: ArrayBuffer | Uint8Array): { records: ImportRecord[]; sheetName: string } {
  let entries: Record<string, Uint8Array>
  try { entries = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input)) } catch { throw new Error("The Excel workbook is invalid, encrypted, or password-protected.") }
  if (entries.EncryptionInfo || entries.EncryptedPackage) throw new Error("Password-protected or encrypted Excel workbooks are not supported.")
  const workbook = decodeEntry(entries, "xl/workbook.xml")
  const sheet = workbook.match(/<sheet\b([^>]*)\/?\s*>/)
  if (!sheet) throw new Error("The Excel workbook does not contain a worksheet.")
  const name = decodeXml(sheet[1].match(/\bname="([^"]*)"/)?.[1] ?? "First worksheet")
  const relationshipId = sheet[1].match(/\br:id="([^"]+)"/)?.[1]
  let sheetPath = "xl/worksheets/sheet1.xml"
  if (relationshipId && entries["xl/_rels/workbook.xml.rels"]) {
    const relationships = decodeEntry(entries, "xl/_rels/workbook.xml.rels")
    const relationship = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(match => match[1].includes(`Id="${relationshipId}"`))
    const target = relationship?.[1].match(/\bTarget="([^"]+)"/)?.[1]
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`
  }
  const shared = entries["xl/sharedStrings.xml"] ? [...decodeEntry(entries, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1])) : []
  const worksheet = decodeEntry(entries, sheetPath)
  const rows = [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const row: string[] = []
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cell[1].match(/\br="([^"]+)"/)?.[1] ?? "A1"
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? "n"
      const raw = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""
      row[columnIndex(reference)] = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? xmlText(cell[2]) : decodeXml(raw)
    }
    return row
  })
  return { records: recordsFromRows(rows), sheetName: name }
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function recordKey(record: ImportRecord) {
  return [record.name, record.batch || record.graduation_year, record.company].map(normalized).join("|")
}

export function validateImport(records: ImportRecord[], existing: ImportExisting[], programmeValues: string[]): { rows: ImportReviewRow[]; counts: { detected: number; newRecords: number; existingMatches: number; needsAttention: number; duplicates: number }; blocking: boolean } {
  if (records.length > 250) throw new Error("The file contains more than the 250-row import limit.")
  const seen = new Set<string>()
  const allowedProgrammes = new Set(programmeValues.map(normalized))
  const rows = records.map((record, offset): ImportReviewRow => {
    const index = offset + 2
    const key = recordKey(record)
    const issues: string[] = []
    const batch = Number(record.batch || record.graduation_year)
    if (!record.name?.trim()) issues.push("Name is required")
    if (!record.company?.trim()) issues.push("Company is required")
    if (!Number.isInteger(batch) || batch < 1980 || batch > 2100) issues.push("Graduation year / batch must be between 1980 and 2100")
    if (record.programme && !allowedProgrammes.has(normalized(record.programme))) issues.push(`Programme “${record.programme}” is not configured`)
    const duplicate = Boolean(key && seen.has(key))
    if (key) seen.add(key)
    const match = existing.find(person => normalized(person.email) && normalized(person.email) === normalized(record.email))
      ?? existing.find(person => normalized(person.linkedinUrl) && normalized(person.linkedinUrl) === normalized(record.linkedin_url))
      ?? existing.find(person => recordKey({ name: person.name, batch: String(person.batch || person.graduationYear || ""), company: person.company }) === key)
    const changedFields = match ? ["programme", "company", "title", "function", "seniority", "location", "email", "phone", "linkedin_url", "previous_companies"].filter(field => {
      const existingField = field === "linkedin_url" ? match.linkedinUrl : field === "previous_companies" ? match.previous : match[field as keyof ImportExisting]
      return Boolean(record[field]) && normalized(existingField) !== normalized(record[field])
    }) : []
    return { index, key, kind: issues.length ? "error" : duplicate ? "duplicate" : match ? "existing" : "new", record, existing: match, changedFields, issues }
  })
  const counts = { detected: rows.length, newRecords: rows.filter(row => row.kind === "new").length, existingMatches: rows.filter(row => row.kind === "existing").length, needsAttention: rows.filter(row => row.kind === "error" || (row.kind === "existing" && row.changedFields.length)).length, duplicates: rows.filter(row => row.kind === "duplicate").length }
  return { rows, counts, blocking: rows.some(row => row.kind === "error" || row.kind === "duplicate") }
}
