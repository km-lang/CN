"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CN_SELECTION_VERSION, type CnSelectionContract } from "@/lib/cn-selection-contract"
import { COMPANY_PRIORITY_OPTIONS, PLACEMENT_RELEVANCE_VERSION } from "@/lib/placement-relevance"
import type { InactiveCalendarPolicy, RefreshJobInput, RefreshJobRecord } from "@/lib/intelligence-contracts"

type Selection = { selectedCount: number; matchedBeforeOverrides: number; manuallyIncluded: number; manuallyExcluded: number; identityReady: number; pendingProviderMapping: number; members: Array<{ cnAlumniId: number; placementRelevance: number | null; reason: string; monitoringEligibility: string }> }
const commaList = (value: string) => [...new Set(value.split(",").map(part => part.trim()).filter(Boolean))]
const numberList = (value: string) => [...new Set(commaList(value).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))]

async function jsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || "The inactive policy request failed.")
  return data
}

export function DynamicCohortPanel({ canOperate, canManageSchedules }: { canOperate: boolean; canManageSchedules: boolean }) {
  const [name, setName] = useState("High-priority alumni")
  const [minimumScore, setMinimumScore] = useState("75")
  const [minimumConfidence, setMinimumConfidence] = useState("")
  const [company, setCompany] = useState("")
  const [priority, setPriority] = useState("All priorities")
  const [role, setRole] = useState("")
  const [functionName, setFunctionName] = useState("")
  const [location, setLocation] = useState("")
  const [programme, setProgramme] = useState("")
  const [seniority, setSeniority] = useState("")
  const [year, setYear] = useState("")
  const [yearEnd, setYearEnd] = useState("")
  const [included, setIncluded] = useState("")
  const [excluded, setExcluded] = useState("")
  const [cadence, setCadence] = useState<InactiveCalendarPolicy["kind"]>("MONTHLY")
  const [dayOne, setDayOne] = useState("15")
  const [dayTwo, setDayTwo] = useState("28")
  const [localTime, setLocalTime] = useState("09:00")
  const [timezone, setTimezone] = useState("Asia/Kolkata")
  const [maxProfiles, setMaxProfiles] = useState("5")
  const [selection, setSelection] = useState<Selection | null>(null)
  const [previewed, setPreviewed] = useState("")
  const [jobs, setJobs] = useState<RefreshJobRecord[]>([])
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function loadJobs() {
    const data = await jsonResponse<{ jobs: RefreshJobRecord[] }>(await fetch("/api/intelligence/refresh/jobs", { cache: "no-store" }))
    setJobs(data.jobs.filter(job => job.cohortType === "DYNAMIC_FILTER" && job.selectionContract))
  }
  useEffect(() => { const timer = window.setTimeout(() => void loadJobs().catch(() => { /* Service availability is reported on explicit actions. */ }), 0); return () => window.clearTimeout(timer) }, [])

  function requestBody(): RefreshJobInput {
    const criteria: CnSelectionContract["criteria"] = { seniorities: commaList(seniority), seniorityMode: "selected", programmes: commaList(programme) }
    if (minimumScore) criteria.minPlacementRelevance = Number(minimumScore)
    if (minimumConfidence) criteria.minDataConfidence = Number(minimumConfidence)
    if (company.trim()) criteria.company = company.trim()
    if (priority !== "All priorities") criteria.companyPriority = priority as CnSelectionContract["criteria"]["companyPriority"]
    if (role.trim()) criteria.role = role.trim()
    if (functionName.trim()) criteria.function = functionName.trim()
    if (location.trim()) criteria.location = location.trim()
    if (year) { criteria.graduationYearMode = yearEnd ? "range" : "exact"; if (yearEnd) { criteria.graduationYearStart = Number(year); criteria.graduationYearEnd = Number(yearEnd) } else criteria.graduationYear = Number(year) }
    const calendarPolicy: InactiveCalendarPolicy = cadence === "WEEKLY" ? { kind: cadence, weekday: Number(dayOne), localTime, timezone }
      : cadence === "MONTHLY" ? { kind: cadence, day: Number(dayOne), localTime, timezone }
      : cadence === "TWICE_MONTHLY" ? { kind: cadence, days: [Number(dayOne), Number(dayTwo)], localTime, timezone }
      : { kind: cadence, days: numberList(`${dayOne},${dayTwo}`), localTime, timezone }
    return { name: name.trim(), mode: "BRIGHT", cohortType: "DYNAMIC_FILTER", filter: { version: CN_SELECTION_VERSION, scoreVersion: PLACEMENT_RELEVANCE_VERSION, criteria, includeCnAlumniIds: numberList(included), excludeCnAlumniIds: numberList(excluded) }, timingType: "RECURRING", calendarPolicy, enabled: false, maxProfiles: Number(maxProfiles), maxSocaiCalls: 1, maxTargetedBright: 1 }
  }

  async function act(action: "preview" | "save") {
    setBusy(true); setMessage("")
    try {
      const body = requestBody()
      const response = await jsonResponse<{ preview?: unknown; selection?: Selection; jobId?: string }>(await fetch(action === "preview" ? "/api/intelligence/refresh/preview" : "/api/intelligence/refresh/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
      if (action === "preview") { setSelection(response.selection ?? null); setPreviewed(JSON.stringify(body)) }
      else { setMessage(`Inactive dynamic policy ${response.jobId} saved. No monitoring or provider request was started.`); await loadJobs() }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The policy operation failed.") }
    finally { setBusy(false) }
  }

  async function reevaluate(jobId: string, record: boolean) {
    setBusy(true); setMessage("")
    try {
      const data = await jsonResponse<{ selection?: Selection; selectedCount?: number; identityReady?: number; pendingProviderMapping?: number }>(await fetch(`/api/intelligence/refresh/jobs/${jobId}/reconcile`, { method: record ? "POST" : "GET", cache: "no-store" }))
      setSelection(data.selection ?? { selectedCount: data.selectedCount ?? 0, matchedBeforeOverrides: 0, manuallyIncluded: 0, manuallyExcluded: 0, identityReady: data.identityReady ?? 0, pendingProviderMapping: data.pendingProviderMapping ?? 0, members: [] })
      setMessage(record ? "Current CN membership reconciled and audited. Policy remains inactive." : "Current CN membership reevaluated without a write or provider request.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reevaluation failed; no stale result was substituted.") }
    finally { setBusy(false) }
  }

  return <section className="panel intelligence-config" aria-label="Authoritative dynamic cohort">
    <div className="panel-heading"><div><p className="eyebrow">CN-owned priority selection</p><h2>Save an inactive dynamic cohort</h2><span>Criteria are evaluated against current Corporate Network D1 on every preview or reconciliation. Provider monitoring stays off.</span></div></div>
    <div className="intelligence-form-grid">
      <label><span>Policy name</span><Input value={name} onChange={event => setName(event.target.value)} /></label>
      <label><span>Placement Relevance ≥</span><Input type="number" min="0" max="100" value={minimumScore} onChange={event => setMinimumScore(event.target.value)} /></label>
      <label><span>Data Confidence ≥ (optional)</span><Input type="number" min="0" max="100" value={minimumConfidence} onChange={event => setMinimumConfidence(event.target.value)} /></label>
      <label><span>Company</span><Input value={company} onChange={event => setCompany(event.target.value)} /></label>
      <label><span>Company priority</span><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All priorities">All priorities</SelectItem>{COMPANY_PRIORITY_OPTIONS.map(([value]) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
      <label><span>Role contains</span><Input value={role} onChange={event => setRole(event.target.value)} /></label><label><span>Function</span><Input value={functionName} onChange={event => setFunctionName(event.target.value)} /></label>
      <label><span>Location contains</span><Input value={location} onChange={event => setLocation(event.target.value)} /></label>
      <label><span>Programmes, comma-separated (OR)</span><Input value={programme} onChange={event => setProgramme(event.target.value)} /></label>
      <label><span>Seniorities, comma-separated (OR)</span><Input value={seniority} onChange={event => setSeniority(event.target.value)} /></label>
      <label><span>Graduation year / range start</span><Input type="number" value={year} onChange={event => setYear(event.target.value)} /></label><label><span>Range end (optional)</span><Input type="number" value={yearEnd} onChange={event => setYearEnd(event.target.value)} /></label>
      <label><span>Always include CN IDs</span><Input value={included} onChange={event => setIncluded(event.target.value)} /></label><label><span>Always exclude CN IDs</span><Input value={excluded} onChange={event => setExcluded(event.target.value)} /></label>
      <label><span>Desired inactive cadence</span><Select value={cadence} onValueChange={value => { setCadence(value as InactiveCalendarPolicy["kind"]); setDayOne(value === "WEEKLY" ? "1" : "15"); setDayTwo("28") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WEEKLY">Weekly</SelectItem><SelectItem value="TWICE_MONTHLY">Twice per calendar month</SelectItem><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="CUSTOM_MONTH_DAYS">Custom month days</SelectItem></SelectContent></Select></label>
      <label><span>{cadence === "WEEKLY" ? "Weekday (0=Sunday)" : "Calendar day 1"}</span><Input type="number" min={cadence === "WEEKLY" ? "0" : "1"} max={cadence === "WEEKLY" ? "6" : "31"} value={dayOne} onChange={event => setDayOne(event.target.value)} /></label>
      {(cadence === "TWICE_MONTHLY" || cadence === "CUSTOM_MONTH_DAYS") && <label><span>Calendar day 2</span><Input type="number" min="1" max="31" value={dayTwo} onChange={event => setDayTwo(event.target.value)} /></label>}
      <label><span>Local time</span><Input type="time" value={localTime} onChange={event => setLocalTime(event.target.value)} /></label><label><span>IANA timezone</span><Input value={timezone} onChange={event => setTimezone(event.target.value)} /></label>
      <label><span>Maximum future profiles per run (1–5)</span><Input type="number" min="1" max="5" value={maxProfiles} onChange={event => setMaxProfiles(event.target.value)} /></label>
    </div>
    <p className="section-help">Monthly days clamp to the last day of short months; duplicate clamped dates occur once. DST gaps roll to the first valid minute and repeated times use the first occurrence. This desired cadence does not control event-driven Coresignal webhooks.</p>
    <div className="intelligence-actions"><Button variant="outline" disabled={!canOperate || busy} onClick={() => void act("preview")}>Preview current CN selection</Button><Button disabled={!canManageSchedules || busy || !selection || previewed !== JSON.stringify(requestBody())} onClick={() => void act("save")}>Save inactive dynamic policy</Button></div>
    {message && <p role="alert" className="intelligence-message">{message}</p>}
    {selection && <div className="section-help">{selection.selectedCount} selected · {selection.identityReady} Coresignal-ID ready · {selection.pendingProviderMapping} pending provider mapping · {selection.manuallyIncluded ?? 0} manual inclusions · {selection.manuallyExcluded ?? 0} exclusions. {selection.members?.slice(0, 50).map(item => `#${item.cnAlumniId} ${item.placementRelevance === null ? "unassessed" : item.placementRelevance} (${item.reason})`).join(" · ")}</div>}
    {jobs.length > 0 && <div className="verification-history"><h3>Saved inactive dynamic policies</h3>{jobs.map(job => <div key={job.id}><strong>{job.name}</strong><span>{job.calendarPolicy?.kind ?? "No calendar policy"} · {job.calendarPolicy?.localTime ?? ""} {job.calendarPolicy?.timezone ?? ""} · next desired {job.nextRunAt} · {job.enabled ? "ACTIVE—unexpected" : "INACTIVE"}</span><span>CN Placement Relevance ≥ {job.selectionContract?.criteria.minPlacementRelevance ?? "any"}; Data Confidence ≥ {job.selectionContract?.criteria.minDataConfidence ?? "any"}; company {job.selectionContract?.criteria.company ?? "any"}; {job.selectionContract?.includeCnAlumniIds.length ?? 0} manual inclusions; {job.selectionContract?.excludeCnAlumniIds.length ?? 0} exclusions.</span><div className="intelligence-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => void reevaluate(job.id, false)}>Preview current members</Button><Button size="sm" disabled={!canOperate || busy || job.enabled} onClick={() => void reevaluate(job.id, true)}>Reconcile and audit</Button></div></div>)}</div>}
  </section>
}
