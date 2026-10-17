import { strToU8, zipSync } from "fflate"

export type ExportCell = string | number | boolean | null | undefined
export type ExportDataset = { id: string; label: string; columns: readonly { key: string; label: string }[]; rows: readonly Record<string, ExportCell>[] }

const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/

export function safeSpreadsheetText(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

function csvCell(value: ExportCell) {
  const normalized = value === null || value === undefined ? "" : typeof value === "string" ? safeSpreadsheetText(value) : String(value)
  return `"${normalized.replaceAll('"', '""')}"`
}

export function datasetCsv(dataset: ExportDataset) {
  const lines = [dataset.columns.map(column => csvCell(column.label)).join(",")]
  for (const row of dataset.rows) lines.push(dataset.columns.map(column => csvCell(row[column.key])).join(","))
  return `\ufeff${lines.join("\r\n")}\r\n`
}

function xml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

function columnName(index: number) {
  let result = ""
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result
  return result
}

function worksheet(dataset: ExportDataset) {
  const rows = [dataset.columns.map(column => column.label), ...dataset.rows.map(row => dataset.columns.map(column => row[column.key]))]
  const rowXml = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`
    if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(safeSpreadsheetText(String(value ?? "")))}</t></is></c>`
  }).join("")}</row>`).join("")
  const last = `${columnName(Math.max(0, dataset.columns.length - 1))}${Math.max(1, rows.length)}`
  const widths = dataset.columns.map((column, index) => {
    const longest = Math.min(48, Math.max(column.label.length, ...dataset.rows.map(row => String(row[column.key] ?? "").length)) + 2)
    return `<col min="${index + 1}" max="${index + 1}" width="${longest}" customWidth="1"/>`
  }).join("")
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
}

function safeSheetName(value: string, used: Set<string>) {
  const base = value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Data"
  let name = base
  for (let suffix = 2; used.has(name); suffix += 1) name = `${base.slice(0, 28)} ${suffix}`
  used.add(name)
  return name
}

export function datasetsXlsx(datasets: readonly ExportDataset[], info: Record<string, string | number> = {}) {
  const used = new Set<string>()
  const infoDataset: ExportDataset = {
    id: "export_info", label: "EXPORT_INFO", columns: [{ key: "field", label: "Field" }, { key: "value", label: "Value" }],
    rows: Object.entries(info).map(([field, value]) => ({ field, value })),
  }
  const all = [infoDataset, ...datasets]
  const names = all.map(dataset => safeSheetName(dataset.label, used))
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${all.map((_dataset, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${all.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${all.map((_dataset, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(workbook), "xl/_rels/workbook.xml.rels": strToU8(relationships),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`),
  }
  all.forEach((dataset, index) => { entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(dataset)) })
  return zipSync(entries, { level: 6 })
}

export function datasetsCsvZip(datasets: readonly ExportDataset[], info: Record<string, string | number> = {}) {
  const entries: Record<string, Uint8Array> = {}
  for (const dataset of datasets) entries[`${dataset.id.replace(/[^a-z0-9_-]+/gi, "_")}.csv`] = strToU8(datasetCsv(dataset))
  entries["README.txt"] = strToU8(Object.entries(info).map(([key, value]) => `${key}: ${value}`).join("\n") + "\n")
  return zipSync(entries, { level: 6 })
}
