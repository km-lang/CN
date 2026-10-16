"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { IntelligenceCohortResolution, RefreshJobRecord, RefreshPreview, RefreshRunRecord, ScoreOperator } from "@/lib/intelligence-contracts"
import { JobHistory } from "./job-history"
import { SelectionSummary } from "./selection-summary"

type Scope = "selected" | "page" | "matching" | "fixed" | "dynamic"
type Props = { selectedIds: number[]; pageIds: number[]; matchingIds: number[]; canOperate: boolean; canManageSchedules: boolean }

export function RefreshCenter({ selectedIds, pageIds, matchingIds, canOperate, canManageSchedules }: Props) {
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "selected" : "page")
  const [fixedIds, setFixedIds] = useState("")
  const [mode, setMode] = useState<"BRIGHT" | "SOCAI_MONITOR" | "FULL">("BRIGHT")
  const [timing, setTiming] = useState<"RUN_NOW" | "ONE_TIME" | "RECURRING">("RUN_NOW")
  const [operator, setOperator] = useState<ScoreOperator>("GTE")
  const [score, setScore] = useState("80")
  const [upperScore, setUpperScore] = useState("100")
  const [maxProfiles, setMaxProfiles] = useState("10")
  const [maxSocaiCalls, setMaxSocaiCalls] = useState("5")
  const [maxTargetedBright, setMaxTargetedBright] = useState("2")
  const [intervalDays, setIntervalDays] = useState("7")
  const [runAt, setRunAt] = useState("")
  const [preview, setPreview] = useState<RefreshPreview | null>(null)
  const [cohortNotice, setCohortNotice] = useState<IntelligenceCohortResolution | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState<RefreshJobRecord[]>([])
  const [runs, setRuns] = useState<RefreshRunRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const cnAlumniIds = useMemo(() => scope === "selected" ? selectedIds : scope === "page" ? pageIds : scope === "matching" ? matchingIds : scope === "fixed" ? fixedIds.split(",").map(Number).filter(Number.isInteger) : [], [fixedIds, matchingIds, pageIds, scope, selectedIds])
  const selectionLabel = scope === "selected" ? "Selected alumni" : scope === "page" ? "Current Directory page" : scope === "matching" ? "All current Directory matches" : scope === "fixed" ? "Explicit fixed cohort" : "Supported dynamic cohort"

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const [jobsResponse, runsResponse] = await Promise.all([fetch("/api/intelligence/refresh/jobs", { cache: "no-store" }), fetch("/api/intelligence/refresh/runs", { cache: "no-store" })])
      const jobData = await jobsResponse.json(); const runData = await runsResponse.json()
      if (!jobsResponse.ok || !runsResponse.ok) throw new Error(jobData.error || runData.error || "Unable to load refresh history.")
      setJobs(jobData.jobs ?? []); setRuns(runData.runs ?? [])
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load refresh history.") }
    finally { setHistoryLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => void loadHistory(), 0); return () => window.clearTimeout(timer) }, [loadHistory])

  function requestBody() {
    const base = {
      name: `${selectionLabel} ${mode.toLowerCase()} refresh`, mode,
      cohortType: scope === "dynamic" ? "DYNAMIC_FILTER" : "FIXED_COHORT",
      timingType: timing, maxProfiles: Number(maxProfiles), maxSocaiCalls: Number(maxSocaiCalls), maxTargetedBright: Number(maxTargetedBright),
      ...(timing !== "RUN_NOW" && runAt ? { runAt: new Date(runAt).toISOString() } : {}),
      ...(timing === "RECURRING" ? { intervalDays: Number(intervalDays) } : {}),
    }
    return scope === "dynamic"
      ? { ...base, filter: { priorityScore: { operator, value: Number(score), ...(operator === "BETWEEN" ? { upperValue: Number(upperScore) } : {}) } } }
      : { ...base, cnAlumniIds }
  }

  async function submit(action: "preview" | "create") {
    setBusy(true); setMessage("")
    try {
      const response = await fetch(action === "preview" ? "/api/intelligence/refresh/preview" : "/api/intelligence/refresh/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody()) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "The refresh request was rejected.")
      if (action === "preview") { setPreview(data.preview); setCohortNotice(data.cohort) }
      else { setMessage(`Refresh job ${data.jobId} created. No provider call was made by this UI request.`); await loadHistory() }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The refresh request failed.") }
    finally { setBusy(false) }
  }

  return <div className="intelligence-refresh-layout">
    <section className="panel intelligence-config"><div className="panel-heading"><div><p className="eyebrow">Refresh Center</p><h2>Configure a governed refresh</h2><span>Select records and safety ceilings, then preview eligibility before creating a job. Preview makes no provider call.</span></div></div>
      <div className="intelligence-form-grid">
        <label><span>Provider mode</span><Select value={mode} onValueChange={value => setMode(value as typeof mode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="BRIGHT">Bright</SelectItem><SelectItem value="SOCAI_MONITOR">Socai monitor</SelectItem><SelectItem value="FULL">Full</SelectItem></SelectContent></Select></label>
        <label><span>Selection</span><Select value={scope} onValueChange={value => { setScope(value as Scope); setPreview(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="selected">Selected alumni</SelectItem><SelectItem value="page">Current Directory page</SelectItem><SelectItem value="matching">All currently matching</SelectItem><SelectItem value="fixed">Explicit fixed cohort</SelectItem><SelectItem value="dynamic">Supported dynamic cohort</SelectItem></SelectContent></Select></label>
        {scope === "fixed" && <label><span>Corporate Network alumni IDs</span><Input value={fixedIds} onChange={event => setFixedIds(event.target.value)} placeholder="15, 21, 34" /></label>}
        {scope === "dynamic" && <><label><span>Priority score operator</span><Select value={operator} onValueChange={value => setOperator(value as ScoreOperator)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["EQ", "GT", "GTE", "LT", "LTE", "BETWEEN"] as ScoreOperator[]).map(value => <SelectItem key={value} value={value}>{value === "EQ" ? "=" : value === "GTE" ? ">=" : value === "LTE" ? "<=" : value === "GT" ? ">" : value === "LT" ? "<" : "BETWEEN"}</SelectItem>)}</SelectContent></Select></label><label><span>Priority score</span><Input type="number" value={score} onChange={event => setScore(event.target.value)} /></label>{operator === "BETWEEN" && <label><span>Upper score</span><Input type="number" value={upperScore} onChange={event => setUpperScore(event.target.value)} /></label>}</>}
        <label><span>Timing</span><Select value={timing} onValueChange={value => setTiming(value as typeof timing)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="RUN_NOW">Run now</SelectItem><SelectItem value="ONE_TIME">One time</SelectItem><SelectItem value="RECURRING" disabled={!canManageSchedules}>Recurring · Admin</SelectItem></SelectContent></Select></label>
        {timing !== "RUN_NOW" && <label><span>First run</span><Input type="datetime-local" value={runAt} onChange={event => setRunAt(event.target.value)} /></label>}
        {timing === "RECURRING" && <label><span>Interval days</span><Input type="number" min="1" value={intervalDays} onChange={event => setIntervalDays(event.target.value)} /></label>}
        <label><span>Max profiles</span><Input type="number" min="1" value={maxProfiles} onChange={event => setMaxProfiles(event.target.value)} /></label>
        <label><span>Max Socai calls</span><Input type="number" min="1" value={maxSocaiCalls} onChange={event => setMaxSocaiCalls(event.target.value)} /></label>
        <label><span>Max targeted Bright calls</span><Input type="number" min="1" value={maxTargetedBright} onChange={event => setMaxTargetedBright(event.target.value)} /></label>
      </div>
      {scope !== "dynamic" && <SelectionSummary label={selectionLabel} ids={cnAlumniIds} unresolved={cohortNotice?.unresolved?.length ?? 0} />}
      <div className="intelligence-actions"><Button variant="outline" disabled={!canOperate || busy} onClick={() => void submit("preview")}>Preview</Button><Button disabled={!canOperate || busy || !preview} onClick={() => void submit("create")}>{timing === "RUN_NOW" ? "Create Run Now job" : "Create schedule"}</Button></div>
      {message && <p role="alert" className="intelligence-message">{message}</p>}
    </section>
    <section className="panel intelligence-preview"><div className="panel-heading"><div><p className="eyebrow">Provider-free preview</p><h2>{preview ? `${preview.selectedProfiles} profiles selected` : "Preview required"}</h2><span>No provider call or canonical mutation occurs during preview. Eligibility is revalidated immediately before Bright execution; an unavailable service remains unavailable rather than appearing to run.</span></div></div>
      {preview ? <dl><div><dt>Selected</dt><dd>{cohortNotice?.requested ?? preview.matchingProfiles}</dd></div><div><dt>Bright eligible</dt><dd>{cohortNotice?.brightEligible ?? preview.selectedProfiles}</dd></div><div><dt>Missing LinkedIn</dt><dd>{cohortNotice?.missingLinkedin ?? 0}</dd></div><div><dt>LinkedIn/profile not approved</dt><dd>{cohortNotice?.linkedinNotVerified ?? 0}</dd></div><div><dt>Identity/mapping review required</dt><dd>{cohortNotice?.identityReviewRequired ?? 0}</dd></div><div><dt>Inactive</dt><dd>{cohortNotice?.inactive ?? 0}</dd></div><div><dt>Other exclusions</dt><dd>{cohortNotice?.otherExcluded ?? 0}</dd></div><div><dt>Profiles that would be sent to Bright</dt><dd>{preview.selectedProfiles}</dd></div><div><dt>Truncated</dt><dd>{preview.selectionExceedsRunLimit ? "Yes" : "No"}</dd></div><div><dt>Mode</dt><dd>{preview.mode}</dd></div><div><dt>Cohort</dt><dd>{preview.cohortType}</dd></div><div><dt>Timing</dt><dd>{timing}</dd></div><div><dt>Maximum Bright exposure</dt><dd>{mode === "SOCAI_MONITOR" ? maxTargetedBright : Math.min(Number(maxProfiles), preview.selectedProfiles)}</dd></div><div><dt>Maximum Socai calls</dt><dd>{preview.maxSocaiCalls}</dd></div><div><dt>Maximum targeted Bright</dt><dd>{preview.maxTargetedBright}</dd></div><div><dt>Canonical mutations</dt><dd>{preview.canonicalMutations}</dd></div></dl> : <p>Choose a selection and preview it before creating a job.</p>}
    </section>
    <JobHistory jobs={jobs} runs={runs} loading={historyLoading} />
  </div>
}
