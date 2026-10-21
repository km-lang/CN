"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

type Plan = { id: number; name: string; status: string; cohortType: string; coveredCount: number; membershipJson: string; providerSubscriptionId: string; expiresAt: string; lastError: string }
type Signal = { id: number; subscriptionId: number; alumnusId: number | null; name: string | null; changeType: string; changedFieldsJson: string; receivedAt: string; status: string; errorState: string; reviewOutcome: string }
type Overview = { plans: Plan[]; events: Signal[]; liveActivationAvailable: boolean; collectionCreditEstimate: number; autoCollect: boolean; page: number }
type Preview = { selectedCount: number; counts: Record<string, number>; preparedCount: number; remainingEligible: number; excludedFromBatch: number; providerRequests: number }
type CollectPreflight = { allowed: boolean; blockers: string[]; runtime: { applicationUnitsRemaining: number; transportMode: string } }
function firstPreparedAlumnus(value: string): number | null {
  try { const rows = JSON.parse(value) as Array<{ alumnusId?: number }>; return Number.isSafeInteger(rows[0]?.alumnusId) ? rows[0].alumnusId! : null } catch { return null }
}

export function WebhookMonitoring({ selectedIds, canOperate, canAdminister }: { selectedIds: number[]; canOperate: boolean; canAdminister: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [mode, setMode] = useState<"DYNAMIC_FILTER" | "FIXED_IDS">("DYNAMIC_FILTER")
  const [threshold, setThreshold] = useState(80)
  const [name, setName] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [collectToken, setCollectToken] = useState<{ eventId: number; alumnusId: number; token: string; preflight: CollectPreflight } | null>(null)
  const [attestId, setAttestId] = useState("")
  const [evidence, setEvidence] = useState("")
  const load = useCallback(async () => {
    const response = await fetch(`/api/intelligence/webhooks?page=${page}`, { cache: "no-store" })
    const data = await response.json() as Overview & { error?: string }
    if (!response.ok) throw new Error(data.error || "Monitoring inbox could not be loaded.")
    setOverview(data)
  }, [page])
  useEffect(() => {
    if (!canOperate) return
    let active = true
    fetch(`/api/intelligence/webhooks?page=${page}`, { cache: "no-store" })
      .then(async response => { const data = await response.json() as Overview & { error?: string }; if (!response.ok) throw new Error(data.error || "Monitoring inbox could not be loaded."); return data })
      .then(data => { if (active) setOverview(data) })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : "Unable to load monitoring.") })
    return () => { active = false }
  }, [canOperate, page])
  const selection = mode === "FIXED_IDS" ? { cohortType: mode, ids: selectedIds } : { cohortType: mode, selection: { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minPlacementRelevance: threshold, seniorities: [], seniorityMode: "selected", programmes: [] }, includeCnAlumniIds: [], excludeCnAlumniIds: [] } }
  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/intelligence/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const data = await response.json() as Record<string, unknown> & { error?: string }
    if (!response.ok) throw new Error(data.error || "Monitoring action failed.")
    return data
  }
  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true); setNotice("")
    try { await post(body); setNotice(success); await load() } catch (error) { setNotice(error instanceof Error ? error.message : "Monitoring action failed.") } finally { setBusy(false) }
  }
  async function previewSelection() {
    setBusy(true); setNotice(""); setPreview(null)
    try { setPreview(await post({ action: "preview", ...selection }) as unknown as Preview) } catch (error) { setNotice(error instanceof Error ? error.message : "Preview failed.") } finally { setBusy(false) }
  }
  async function prepare() {
    setBusy(true); setNotice("")
    try { const result = await post({ action: "prepare", ...selection, name }); setNotice(`Prepared mock-only plan #${result.id} with ${result.preparedCount} eligible identities. No provider request occurred.`); setPreview(null); await load() } catch (error) { setNotice(error instanceof Error ? error.message : "Preparation failed.") } finally { setBusy(false) }
  }
  async function preflightCollect(event: Signal) {
    if (!event.alumnusId) return
    setBusy(true); setNotice(""); setCollectToken(null)
    try {
      const response = await fetch("/api/admin/coresignal-collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preflight", alumnusId: event.alumnusId, webhookEventId: event.id }) })
      const result = await response.json() as { error?: string; preflight?: CollectPreflight; confirmationToken?: string; documentedCollectCredits?: number }
      if (!response.ok) throw new Error(result.error || "Collect preflight failed.")
      if (!result.preflight?.allowed || !result.confirmationToken) { setNotice(result.preflight?.blockers.join(" ") || "Collect is unavailable."); return }
      setCollectToken({ eventId: event.id, alumnusId: event.alumnusId, token: result.confirmationToken, preflight: result.preflight })
    } catch (error) { setNotice(error instanceof Error ? error.message : "Collect preflight failed.") } finally { setBusy(false) }
  }
  async function executeCollect() {
    if (!collectToken || !window.confirm(`Approve exactly one MOCK profile Collect for notification #${collectToken.eventId}? Estimated 10 credits; ${collectToken.preflight.runtime.applicationUnitsRemaining} application units remain. Provider balance is unknown. No automatic retry or canonical update.`)) return
    setBusy(true); setNotice("")
    try {
      const response = await fetch("/api/admin/coresignal-collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "execute", alumnusId: collectToken.alumnusId, webhookEventId: collectToken.eventId, confirmationToken: collectToken.token, confirmed: true }) })
      const result = await response.json() as { error?: string; comparisonOutcome?: string }
      if (!response.ok) throw new Error(result.error || "Mock Collect failed.")
      setNotice(`Mock Collect evidence retained for notification #${collectToken.eventId}: ${result.comparisonOutcome}. Human review is still required for changes.`)
      setCollectToken(null); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : "Mock Collect failed.") } finally { setBusy(false) }
  }
  return <section aria-label="Employment change monitoring" className="intelligence-purpose" style={{ display: "block" }}>
    <h2>Employment Signals</h2><p>Base Employee experience monitoring is mock-only here. Subscriptions and notifications cost 0 credits; an approved profile Collect is estimated at 10 credits. No automatic Collect, profile update, or live subscription is enabled.</p>
    {notice && <p role="status">{notice}</p>}
    {canAdminister && <div style={{ display: "grid", gap: 12, maxWidth: 650 }}>
      <h3>Prepare a monitored cohort</h3>
      <label>Selection source <select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setPreview(null) }}><option value="DYNAMIC_FILTER">High-priority dynamic cohort</option><option value="FIXED_IDS">Selected Directory alumni ({selectedIds.length})</option></select></label>
      {mode === "DYNAMIC_FILTER" ? <label>Minimum placement relevance <input type="number" min="0" max="100" value={threshold} onChange={event => { setThreshold(Number(event.target.value)); setPreview(null) }} /></label> : <p>Only the currently selected Directory IDs are included. Maximum 100 per batch.</p>}
      <label>Plan name <input maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <div><Button disabled={busy} variant="outline" onClick={() => void previewSelection()}>Preview identity readiness</Button> {preview && <Button disabled={busy || preview.preparedCount < 1 || !name.trim()} onClick={() => void prepare()}>Prepare saved plan · no provider call</Button>}</div>
      {preview && <p role="status">Selected {preview.selectedCount}; eligible {preview.counts.ELIGIBLE ?? 0}; missing mapping {preview.counts.PENDING_PROVIDER_MAPPING ?? 0}; identity review {preview.counts.IDENTITY_REVIEW_REQUIRED ?? 0}; already covered {preview.counts.ALREADY_COVERED ?? 0}. This batch prepares {preview.preparedCount}; {preview.remainingEligible} eligible remain beyond its 100-ID bound.</p>}
      <h3>Verify a saved Base Employee ID</h3><p>Requires independent evidence for the exact saved ID. No browser-supplied provider ID is accepted.</p>
      <label>CN alumnus ID <input inputMode="numeric" value={attestId} onChange={event => setAttestId(event.target.value)} /></label><label>Evidence reference <input maxLength={300} value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
      <Button variant="outline" disabled={busy || !attestId || !evidence.trim()} onClick={() => void action({ action: "attest", alumnusId: Number(attestId), evidenceReference: evidence, confirmation: "VERIFY_BASE_EMPLOYEE_ID" }, "Saved Base Employee identity attestation. No provider request occurred.")}>Attest exact saved ID</Button>
    </div>}
    <p>{overview?.plans.reduce((count, plan) => count + plan.coveredCount, 0) ?? 0} monitored alumni across the displayed plans. Monitoring does not imply verified new employment or outreach consent.</p>
    <h3>Monitored plans</h3>{overview?.plans.length ? <div style={{ display: "grid", gap: 12 }}>{overview.plans.map(plan => <article key={plan.id} style={{ border: "1px solid var(--border)", padding: 12, borderRadius: 8 }}><strong>#{plan.id} {plan.name}</strong><p>{plan.cohortType} · {plan.status} · expires {plan.expiresAt || "not activated"}</p>{plan.lastError && <p>{plan.lastError}</p>}{canAdminister && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="outline" disabled={busy} onClick={() => void action({ action: "reconcile", subscriptionId: plan.id }, `Reconciliation preview recorded for plan #${plan.id}; provider membership unchanged.`)}>Preview reconciliation</Button>{plan.status === "DRAFT" && <Button disabled={busy} onClick={() => { const count = JSON.parse(plan.membershipJson).length as number; if (window.confirm(`Activate MOCK subscription #${plan.id} for ${count} exact saved IDs? Zero provider requests.`)) void action({ action: "activate", subscriptionId: plan.id, confirmation: `ACTIVATE ${plan.id} ${count}` }, `Mock subscription #${plan.id} activated.`) }}>Activate mock</Button>}{["ACTIVE", "RENEWAL_DUE"].includes(plan.status) && <><Button variant="outline" disabled={busy} onClick={() => void action({ action: "renew", subscriptionId: plan.id, confirmation: `RENEW ${plan.id}` }, `Mock subscription #${plan.id} renewed.`)}>Renew mock if due</Button><Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Stop MOCK subscription #${plan.id}?`)) void action({ action: "stop", subscriptionId: plan.id, confirmation: `STOP ${plan.id}` }, `Mock subscription #${plan.id} stopped.`) }}>Stop mock</Button>{firstPreparedAlumnus(plan.membershipJson) && <Button variant="outline" disabled={busy} onClick={() => { const alumnusId = firstPreparedAlumnus(plan.membershipJson); if (alumnusId && window.confirm(`Simulate one local callback for covered alumnus #${alumnusId}? No provider request or paid Collect.`)) void action({ action: "simulate", subscriptionId: plan.id, alumnusId, confirmation: `SIMULATE ${plan.id} ${alumnusId}` }, `One synthetic change signal retained for plan #${plan.id}.`) }}>Simulate one local signal</Button>}</>}</div>}</article>)}</div> : <p>No saved monitoring plans.</p>}
    <h3>Change inbox</h3>{overview?.events.length ? <div style={{ display: "grid", gap: 12 }}>{overview.events.map(event => <article key={event.id} style={{ border: "1px solid var(--border)", padding: 12, borderRadius: 8 }}><strong>Notification #{event.id} · {event.name || "Unmapped identity"}</strong><p>{event.changeType} · {event.status} · {event.receivedAt}</p>{event.errorState && <p>Reconciliation: {event.errorState}</p>}<p>Changed fields reported: {event.changedFieldsJson === "[]" ? "none specified" : event.changedFieldsJson}. This signal does not establish a new company or role.</p>{canAdminister && event.alumnusId && event.status === "AWAITING_PROFILE_COLLECTION" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="outline" disabled={busy} onClick={() => void preflightCollect(event)}>Review one mock Collect · 10 credits</Button><Button variant="outline" disabled={busy} onClick={() => void action({ action: "review", subscriptionId: event.subscriptionId, eventId: event.id, outcome: "REVIEW_REQUIRED" }, `Notification #${event.id} sent to review.`)}>Review exception</Button></div>}{canAdminister && event.status === "REVIEW_REQUIRED" && <Button variant="outline" disabled={busy} onClick={() => void action({ action: "review", subscriptionId: event.subscriptionId, eventId: event.id, outcome: "IGNORED" }, `Notification #${event.id} ignored with audit.`)}>Ignore with audit</Button>}{collectToken?.eventId === event.id && <div role="group" aria-label="Confirm one mock profile collection"><p>One mock Collect; estimated 10 credits; application units remaining {collectToken.preflight.runtime.applicationUnitsRemaining}; actual provider balance unknown. No automatic retry or canonical update.</p><Button disabled={busy} onClick={() => void executeCollect()}>Approve one mock Collect</Button> <Button variant="outline" onClick={() => setCollectToken(null)}>Cancel</Button></div>}</article>)}</div> : <p>No retained employment signals.</p>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}><Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!overview || (overview.events.length < 20 && overview.plans.length < 20)} onClick={() => setPage(value => value + 1)}>Next</Button></div>
  </section>
}
