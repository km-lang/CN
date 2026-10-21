"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { AlumniHistoryEntry } from "@/lib/alumni-history"

type Comparison = { field: string; previousObserved: string | null; newObserved: string; currentCanonical: string | null; previousEvidenceAvailable: boolean; changedFromPrevious: boolean; snapshotKey: string; previousSnapshotKey: string | null; source: string; verification: string }
type HistoryResponse = { page: number; hasMore: boolean; entries: AlumniHistoryEntry[]; comparisons: Record<string, Comparison[]>; limitations: string }
type HistoryView = "all" | "extractions" | "career" | "changes"

function belongsToView(entry: AlumniHistoryEntry, view: HistoryView) {
  if (view === "all") return true
  if (view === "extractions") return ["SOURCE_OBSERVATION", "DISCOVERY_OBSERVATION", "PROVIDER_ATTEMPT", "PROVIDER_REVIEW", "PROVIDER_SNAPSHOT", "PROVISIONAL_INTAKE"].includes(entry.kind)
  if (view === "career") return entry.kind === "CAREER_OBSERVATION" || Boolean(entry.experience?.length)
  return ["SOURCE_BASELINE", "CANONICAL_CHANGE", "REVIEW_DECISION"].includes(entry.kind)
}

export function AlumniHistoryPanel({ alumnusId }: { alumnusId: number }) {
  const [entries, setEntries] = useState<AlumniHistoryEntry[]>([])
  const [intelligenceEntries, setIntelligenceEntries] = useState<AlumniHistoryEntry[]>([])
  const [comparisons, setComparisons] = useState<Record<string, Comparison[]>>({})
  const [view, setView] = useState<HistoryView>("all")
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [intelligencePage, setIntelligencePage] = useState(0)
  const [intelligenceHasMore, setIntelligenceHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [intelligenceBusy, setIntelligenceBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [limitations, setLimitations] = useState("")
  const [intelligenceLimitations, setIntelligenceLimitations] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setEntries([]); setIntelligenceEntries([]); setComparisons({}); setPage(0); setIntelligencePage(0); setHasMore(false); setIntelligenceHasMore(false)
      setBusy(true)
      void fetch(`/api/alumni/${alumnusId}/history?page=1`, { cache: "no-store", signal: controller.signal }).then(async response => {
        const result = await response.json() as HistoryResponse & { error?: string }
        if (!response.ok) throw new Error(result.error || "History is unavailable.")
        setEntries(result.entries); setComparisons(current => ({ ...current, ...result.comparisons })); setPage(1); setHasMore(result.hasMore); setLimitations(result.limitations); setMessage("")
      }).catch(error => { if (error?.name !== "AbortError") setMessage(error instanceof Error ? error.message : "History is unavailable.") }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
      setIntelligenceBusy(true)
      void fetch(`/api/alumni/${alumnusId}/history?source=intelligence&page=1`, { cache: "no-store", signal: controller.signal }).then(async response => {
        const result = await response.json() as HistoryResponse & { error?: string }
        if (!response.ok) throw new Error(result.error || "Standalone intelligence history is unavailable.")
        setIntelligenceEntries(result.entries); setComparisons(current => ({ ...current, ...result.comparisons })); setIntelligencePage(1); setIntelligenceHasMore(result.hasMore); setIntelligenceLimitations(result.limitations)
      }).catch(error => { if (error?.name !== "AbortError") setIntelligenceLimitations(error instanceof Error ? error.message : "Standalone intelligence history is unavailable.") }).finally(() => { if (!controller.signal.aborted) setIntelligenceBusy(false) })
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [alumnusId])

  async function loadMore() {
    if (busy || !hasMore) return
    setBusy(true); setMessage("")
    try {
      const response = await fetch(`/api/alumni/${alumnusId}/history?page=${page + 1}`, { cache: "no-store" })
      const result = await response.json() as HistoryResponse & { error?: string }
      if (!response.ok) throw new Error(result.error || "More history is unavailable.")
      setEntries(current => [...new Map([...current, ...result.entries].map(entry => [entry.key, entry])).values()])
      setComparisons(current => ({ ...current, ...result.comparisons }))
      setPage(result.page); setHasMore(result.hasMore)
    } catch (error) { setMessage(error instanceof Error ? error.message : "More history is unavailable.") }
    finally { setBusy(false) }
  }

  async function loadMoreIntelligence() {
    if (intelligenceBusy || !intelligenceHasMore) return
    setIntelligenceBusy(true)
    try {
      const response = await fetch(`/api/alumni/${alumnusId}/history?source=intelligence&page=${intelligencePage + 1}`, { cache: "no-store" })
      const result = await response.json() as HistoryResponse & { error?: string }
      if (!response.ok) throw new Error(result.error || "More standalone history is unavailable.")
      setIntelligenceEntries(current => [...new Map([...current, ...result.entries].map(entry => [entry.key, entry])).values()])
      setComparisons(current => ({ ...current, ...result.comparisons }))
      setIntelligencePage(result.page); setIntelligenceHasMore(result.hasMore)
    } catch (error) { setIntelligenceLimitations(error instanceof Error ? error.message : "More standalone history is unavailable.") }
    finally { setIntelligenceBusy(false) }
  }

  const visible = [...entries, ...intelligenceEntries].filter(entry => belongsToView(entry, view)).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.key.localeCompare(b.key))
  return <section className="profile-section alumni-history-panel" aria-label="Alumni extraction and change history">
    <div className="verification-heading"><div><h3>Retained alumni history</h3><small>Read-only source observations, career evidence and canonical changes</small></div></div>
    <div className="profile-opportunity-actions" role="group" aria-label="History category">
      {([ ["all", "All timeline"], ["extractions", "Extraction history"], ["career", "Career history"], ["changes", "Change / review history"] ] as const).map(([value, label]) => <Button key={value} size="sm" variant={view === value ? "default" : "outline"} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}
    </div>
    {message && <p role="alert" className="section-help">{message}</p>}
    {busy && page === 0 && <p className="section-help">Loading retained history…</p>}
    {!busy && !intelligenceBusy && page > 0 && !visible.length && <p className="section-help">No {view === "all" ? "retained history" : view.replaceAll("_", " ")} entries on the loaded pages.</p>}
    <div className="profile-timeline">{visible.map(entry => <article key={entry.key} className="alumni-history-event">
      <span>{entry.kind.replaceAll("_", " ")}</span><div><strong>{entry.occurredAt ? new Date(entry.occurredAt).toLocaleString() : "Date unavailable"}</strong><p>{entry.source} · {entry.outcome}</p><small>{entry.requestReference || "No linked request recorded"} · {entry.verification}</small><small>{entry.details}</small>
      {Object.keys(entry.observed).length > 0 && <div className="alumni-history-observed">{Object.entries(entry.observed).map(([field, value]) => <small key={field}>{field}: {value}</small>)}</div>}
      {entry.experience?.length ? <details className="permission-details"><summary>Retained employment observations ({entry.experience.length})</summary>{entry.experience.map((item, index) => <small key={index}>{item.company || "Company unknown"} · {item.title || "Title unknown"} · {item.startDate || "Start unknown"}–{item.endDate || (item.current ? "Current claim" : "End unknown")}</small>)}</details> : null}
      {entry.education?.length ? <details className="permission-details"><summary>Retained education observations ({entry.education.length})</summary>{entry.education.map((item, index) => <small key={index}>{item.institution || "Institution unknown"} · {item.degree || "Degree unknown"} · {item.startYear || "Start unknown"}–{item.endYear || "End unknown"}</small>)}</details> : null}
      {comparisons[entry.key]?.length ? <details className="permission-details"><summary>Compare retained observation</summary><div className="alumni-history-table-wrap"><table><thead><tr><th>Field</th><th>Previous observed</th><th>New observed</th><th>Current canonical</th><th>Verification</th></tr></thead><tbody>{comparisons[entry.key].map(item => <tr key={item.field}><td>{item.field}</td><td>{item.previousObserved ?? "Not observed"}</td><td>{item.newObserved}</td><td>{item.currentCanonical ?? "Unknown"}</td><td>{item.verification}</td></tr>)}</tbody></table></div><small>Compared exact retained records: {comparisons[entry.key][0].previousSnapshotKey ?? "no earlier observation"} → {comparisons[entry.key][0].snapshotKey}. Missing evidence is not treated as a removal.</small></details> : null}
      </div></article>)}</div>
    {hasMore && <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : "Load more Corporate Network history"}</Button>}
    {intelligenceHasMore && <Button size="sm" variant="outline" disabled={intelligenceBusy} onClick={() => void loadMoreIntelligence()}>{intelligenceBusy ? "Loading…" : "Load more standalone snapshots"}</Button>}
    {limitations && <p className="section-help">{limitations}</p>}
    {intelligenceLimitations && <p className="section-help">{intelligenceLimitations}</p>}
  </section>
}
