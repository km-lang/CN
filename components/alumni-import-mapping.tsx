"use client"
import { useEffect, useState } from "react"
import { IMPORT_TEMPLATE_COLUMNS, parseCsv, parseXlsx, suggestedImportMapping, type ImportColumnMapping } from "@/lib/alumni-import"

export function AlumniImportMapping({ file, mapping, onChange }: { file: File | null; mapping: ImportColumnMapping | null; onChange: (value: ImportColumnMapping | null) => void }) {
  const [headers, setHeaders] = useState<string[]>([])
  const [message, setMessage] = useState("")
  useEffect(() => {
    let current = true
    if (!file) return
    const load = async () => {
      try {
        const records = /\.xlsx$/i.test(file.name) ? parseXlsx(await file.arrayBuffer(), "inspect").records : /\.csv$/i.test(file.name) ? parseCsv(await file.text(), "inspect") : (() => { throw new Error("Choose a .csv or .xlsx alumni file.") })()
        if (!records.length) throw new Error("The file contains no alumni rows.")
        if (current) { const columns = Object.keys(records[0]); setHeaders(columns); onChange(suggestedImportMapping(columns)); setMessage("") }
      } catch (error) { if (current) { setHeaders([]); onChange(null); setMessage(error instanceof Error ? error.message : "Unable to read file columns.") } }
    }
    void load()
    return () => { current = false }
  }, [file, onChange])
  if (!file) return null
  return <section className="import-column-mapping" aria-label="Import column mapping"><h3>Map file columns</h3><p>Match your headings to stored alumni fields. Unmapped columns are ignored. Preview validates every row before any write.</p>{message && <p role="alert">{message}</p>}<div className="import-mapping-grid">{headers.map(header => <label key={header}><span>{header}</span><select aria-label={`Map ${header}`} value={mapping?.[header] ?? ""} onChange={event => onChange({ ...mapping, [header]: event.target.value })}><option value="">Ignore column</option>{IMPORT_TEMPLATE_COLUMNS.map(field => <option key={field} value={field}>{field.replaceAll("_", " ")}</option>)}</select></label>)}</div></section>
}
