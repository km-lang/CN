"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, CheckCircle2, Cloud, Eye, LoaderCircle, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type Runtime = {
  mode: "mock" | "live" | "disabled"
  configured: boolean
  tokenConfigured: boolean
  datasetConfigured: boolean
  executionGateEnabled: boolean
  entitlement: "unknown" | "confirmed" | "not_entitled"
  applicationBudget: { used: number; limit: number; remaining: number }
  supportedInput: string
  providerBillingKnown: false
  automaticRetries: 0
  automaticPolling: false
}

type Evidence = {
  provider?: string
  providerProfileId?: string
  fullName?: string
  requestedUrl?: string
  returnedUrl?: string
  currentCompany?: string
  currentTitle?: string
  roleStartDate?: string
  location?: string
  experience?: Array<{ company?: string; title?: string; startDate?: string; endDate?: string; current?: boolean }>
  education?: Array<{ institution?: string; degree?: string; programme?: string; startDate?: string; endDate?: string; startYear?: string; endYear?: string }>
  unavailable?: boolean
  reason?: string
}

type Attempt = {
  id: number
  alumnusId: number | null
  targetReference: string
  providerJobId: string
  status: string
  errorCategory: string
  usageState: string
  evidenceJson: Evidence | null
  rawEvidenceStored?: boolean
  identityUrlStatus?: "MATCH" | "MISMATCH" | "UNVERIFIED"
  evidenceRetrievedAt?: string
  providerTimestamp?: unknown
  normalizerVersion?: number | null
  rawRetentionUntil?: string
  createdAt: string
}

type Preflight = {
  allowed: boolean
  blockers: string[]
  profileUrl: string
  confirmationToken: string
  requestKey: string
  runtime: Runtime
}

async function responseJson<T>(response: Response) {
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || "Bright Data operation failed.")
  return data
}

function RetainedEvidenceDetails({ attempt }: { attempt: Attempt }) {
  const evidence = attempt.evidenceJson
  if (!evidence || evidence.unavailable) return null
  return <details className="permission-details">
    <summary>Review retained provider evidence</summary>
    <div className="brightdata-evidence-detail">
      <small>Profile URL match: {attempt.identityUrlStatus || "UNVERIFIED"} · Provider profile ID: {evidence.providerProfileId || "not returned"}</small>
      <small>Canonical alumnus association: {attempt.alumnusId ? `Alumnus #${attempt.alumnusId} (subject to review)` : "unresolved; human review required"}</small>
      <small>Requested URL: {evidence.requestedUrl || "not retained"}</small>
      <small>Returned URL: {evidence.returnedUrl || "not returned"}</small>
      <small>Full name: {evidence.fullName || "not returned"}</small>
      <small>Current company: {evidence.currentCompany || "not returned"} · designation: {evidence.currentTitle || "not returned"}</small>
      <small>Role start: {evidence.roleStartDate || "not returned"} · location: {evidence.location || "not returned"}</small>
      <strong>Employment observations ({evidence.experience?.length ?? 0})</strong>
      {evidence.experience?.length ? evidence.experience.map((item, index) => <small key={index}>{item.company || "Company unknown"} · {item.title || "Title unknown"} · {item.startDate || "Start unknown"}–{item.endDate || (item.current ? "Current claim" : "End unknown")}</small>) : <small>No employment rows returned; a top-level company is not proof of current employment.</small>}
      <strong>Education observations ({evidence.education?.length ?? 0})</strong>
      {evidence.education?.length ? evidence.education.map((item, index) => <small key={index}>{item.institution || "Institution unknown"} · degree: {item.degree || "not returned"} · programme: {item.programme || "not returned"} · {item.startDate || item.startYear || "Start unknown"}–{item.endDate || item.endYear || "End unknown"}</small>) : <small>No education rows returned.</small>}
      <small>Snapshot: {attempt.providerJobId || "not returned"} · retrieved: {attempt.evidenceRetrievedAt || "not recorded"} · provider timestamp: {typeof attempt.providerTimestamp === "string" ? attempt.providerTimestamp : "not reported"}. Neither timestamp verifies employment freshness.</small>
      <small>Raw provider response retained for Admin audit: {attempt.rawEvidenceStored ? "yes" : "no"}. Canonical alumni fields were not changed by this collection.</small>
    </div>
  </details>
}

export function BrightDataWorkflow({ apiUrl, target }: { apiUrl: string; target?: { alumnusId: number; profileUrl: string } | null }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [profileUrl, setProfileUrl] = useState("")
  const [alumnusId, setAlumnusId] = useState("")
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!target) return
    const timer = window.setTimeout(() => {
      setProfileUrl(target.profileUrl)
      setAlumnusId(String(target.alumnusId))
      setPreflight(null)
      setMessage("Target loaded from the selected Directory profile. Validate it before any provider confirmation.")
    }, 0)
    return () => window.clearTimeout(timer)
  }, [target])

  const load = useCallback(async () => {
    const data = await responseJson<{ runtime: Runtime; attempts: Attempt[] }>(await fetch(apiUrl, { cache: "no-store" }))
    setRuntime(data.runtime)
    setAttempts(data.attempts)
  }, [apiUrl])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => void load().catch(error => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load Bright Data readiness.") }), 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [load])

  async function prepare() {
    setBusy(true); setMessage("")
    try {
      const data = await responseJson<Preflight>(await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preflight", profileUrl, alumnusId: alumnusId ? Number(alumnusId) : null }) }))
      setPreflight(data)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to validate the Bright Data target.") }
    finally { setBusy(false) }
  }

  async function trigger() {
    if (!preflight?.allowed || !preflight.confirmationToken) return
    setBusy(true); setMessage("")
    try {
      const data = await responseJson<{ attempt: Attempt; replayed: boolean; providerCallMade: boolean; reason?: string }>(await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "trigger", confirmed: true, confirmationToken: preflight.confirmationToken }) }))
      setPreflight(null)
      setMessage(data.replayed ? data.reason || "The existing durable collection attempt was reused; no duplicate trigger was sent." : `Collection submitted. Snapshot ${data.attempt.providerJobId || "awaiting reconciliation"}.`)
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to submit the Bright Data collection.") }
    finally { setBusy(false) }
  }

  async function act(action: "status" | "retrieve", attemptId: number) {
    setBusy(true); setMessage("")
    try {
      const data = await responseJson<{ attempt: Attempt; replayed?: boolean; persisted?: { identityVerified: boolean; proposalsCreated: number } }>(await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, attemptId }) }))
      setMessage(action === "status" ? `Snapshot state: ${data.attempt.status.replaceAll("_", " ")}.` : data.persisted?.identityVerified ? `Evidence retained for human review with ${data.persisted.proposalsCreated} protected correction proposal(s). Canonical fields were not changed.` : "Evidence retained, but identity remains unresolved. No alumnus was changed.")
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bright Data operation failed.") }
    finally { setBusy(false) }
  }

  const readiness = runtime ? [
    ["Credential", runtime.tokenConfigured ? "Configured" : "Missing"],
    ["Dataset", runtime.datasetConfigured ? "Configured" : "Missing"],
    ["Execution gate", runtime.executionGateEnabled ? "Enabled" : "Disabled"],
    ["Entitlement", runtime.entitlement],
    ["Application allowance", `${runtime.applicationBudget.remaining} of ${runtime.applicationBudget.limit} remaining`],
    ["Provider billing", "Unknown — verify in Bright Data account"],
  ] : []

  return <section id="brightdata-workflow" className="panel collect-candidate-panel brightdata-workflow" aria-label="Bright Data known profile collection">
    <div className="panel-heading"><div><p className="eyebrow">External discovery · Bright Data</p><h2>Collect one known professional profile</h2><span>Bright Data accepts one validated LinkedIn profile target. It does not run a people search and never updates canonical alumni data automatically.</span></div><Cloud /></div>
    {runtime && <div className="external-search-summary">{readiness.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    <div className="external-discovery-criteria">
      <label><span>Supported profile URL</span><Input value={profileUrl} onChange={event => setProfileUrl(event.target.value)} placeholder="https://www.linkedin.com/in/profile" aria-label="Bright Data LinkedIn profile URL" /><small>Only a public LinkedIn /in/ profile URL is accepted. Opening this panel makes no provider request.</small></label>
      <label><span>Corporate Network alumnus ID (optional)</span><Input type="number" min="1" value={alumnusId} onChange={event => setAlumnusId(event.target.value)} placeholder="Leave blank for identity review" aria-label="Bright Data alumnus ID" /><small>Linking still requires exact stored profile-URL agreement after retrieval. Names are never used for automatic attachment.</small></label>
    </div>
    <div className="batch-actions"><Button variant="outline" disabled={busy || !profileUrl.trim()} onClick={() => void prepare()}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />} Validate target and review collection</Button></div>
    {message && <div className="enrichment-message" role="status"><Activity /><span>{message}</span></div>}
    <p className="verified-copy">No automatic polling or paid retries. Trigger, status check, and completed-result retrieval are separate explicit Admin actions.</p>
    {attempts.length > 0 && <div className="collect-candidate-list">{attempts.map(attempt => <article key={attempt.id}><div><strong>Attempt #{attempt.id} · {attempt.status.replaceAll("_", " ")}</strong><span>{attempt.targetReference}</span><small>Snapshot: {attempt.providerJobId || "not returned"} · usage: {attempt.usageState.replaceAll("_", " ")} · {new Date(attempt.createdAt).toLocaleString()}</small>{attempt.errorCategory && <small>Operator attention: {attempt.errorCategory.replaceAll("_", " ")}</small>}{attempt.evidenceJson && !attempt.evidenceJson.unavailable && <small>Evidence: {attempt.evidenceJson.fullName || "name not returned"} · {attempt.evidenceJson.currentTitle || "title not returned"} at {attempt.evidenceJson.currentCompany || "company not returned"}</small>}{attempt.rawEvidenceStored && <small>Original response retained for Admin audit · normalizer v{attempt.normalizerVersion} · returned URL: {attempt.identityUrlStatus?.toLowerCase() || "unverified"} · retrieved {attempt.evidenceRetrievedAt || "time unavailable"} · source timestamp {typeof attempt.providerTimestamp === "string" ? attempt.providerTimestamp : "not reported"}. These timestamps do not verify employment freshness.</small>}{!attempt.rawEvidenceStored && attempt.evidenceJson && <small>Normalized evidence only; original response not retained.</small>}<RetainedEvidenceDetails attempt={attempt} /></div><div className="batch-actions">{["SNAPSHOT_PENDING", "SNAPSHOT_RUNNING"].includes(attempt.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("status", attempt.id)}><Activity /> Check collection status</Button>}{attempt.status === "SNAPSHOT_READY" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("retrieve", attempt.id)}><Eye /> Retrieve completed result</Button>}{attempt.status === "REVIEW_REQUIRED" && <span className="configured"><CheckCircle2 /> Identity matched · review protected corrections</span>}{attempt.status === "EVIDENCE_STORED" && <span className="role-restriction">Identity review required before association</span>}</div></article>)}</div>}
    <Dialog open={Boolean(preflight)} onOpenChange={open => { if (!open && !busy) setPreflight(null) }}><DialogContent><DialogHeader><DialogTitle>Confirm one Bright Data collection</DialogTitle><DialogDescription>This is the only action that can submit a new provider collection. A refresh or status check never re-triggers it.</DialogDescription></DialogHeader>{preflight && <div className="refresh-confirm-summary"><div><span>Target</span><strong>{preflight.profileUrl}</strong></div><div><span>Provider mode</span><strong>{preflight.runtime.mode.toUpperCase()}</strong></div><div><span>Dataset</span><strong>{preflight.runtime.datasetConfigured ? "Configured server-side" : "Missing"}</strong></div><div><span>Maximum targets</span><strong>1</strong></div><div><span>Automatic retries</span><strong>0</strong></div><div><span>Application allowance remaining</span><strong>{preflight.runtime.applicationBudget.remaining}</strong></div><div><span>Provider-account cost</span><strong>Unknown</strong></div>{preflight.blockers.map(blocker => <div key={blocker}><span>Blocked</span><strong>{blocker}</strong></div>)}</div>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreflight(null)}>Cancel</Button><Button disabled={busy || !preflight?.allowed} onClick={() => void trigger()}>{busy ? <LoaderCircle className="spin" /> : <Cloud />} Confirm single collection</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
