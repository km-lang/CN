"use client"

import { useCallback, useEffect, useState } from "react"
import { apiPath } from "@/lib/app-config"
import type { CreditCategory, CreditProvider, ProviderCreditObservation } from "@/lib/provider-credit-ledger"

type DisplayObservation = ProviderCreditObservation & { state: "current" | "stale" }
type ProviderRow = { provider: CreditProvider; connected: boolean; observations: DisplayObservation[]; history: DisplayObservation[]; historyLimited: boolean; state: "available" | "stale" | "unavailable"; lastVerifiedAt: string | null; lastSuccessfulOperationAt: string | null; readiness: Array<{ operation: string; entitlement: string; gateEnabled: boolean }> }
type CreditSnapshot = { providers: ProviderRow[]; internalControls: Array<{ provider: string; used: number; limit: number; remaining: number; unit: string }> }
const ENDPOINT = apiPath("/api/admin/provider-credits")
const LABELS: Record<CreditProvider, string> = { coresignal: "Coresignal", brightdata: "Bright Data", lusha: "Lusha" }
const EMPTY_FORM = { provider: "coresignal" as CreditProvider, category: "general" as CreditCategory, available: "", consumed: "", unit: "credits", expiresAt: "", sourceDetail: "Authenticated account dashboard", warning: "", operation: "", operationCost: "", operationCostUnit: "", costBasis: "unknown" as const }

function dateLabel(value: string | null) { return value ? new Date(value).toLocaleString() : "Not verified" }
function amountLabel(value: number | null, unit: string) { return value === null ? "Not reported" : `${value.toLocaleString()} ${unit}` }

export function ProviderCreditsDashboard() {
  const [snapshot, setSnapshot] = useState<CreditSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<CreditProvider | "attest" | null>(null)
  const [message, setMessage] = useState("")
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store" })
      const data = await response.json() as CreditSnapshot & { error?: string }
      if (!response.ok) throw new Error(data.error || "Provider balances are unavailable.")
      setSnapshot(data)
      setMessage("")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Provider balances are unavailable.") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    void fetch(ENDPOINT, { cache: "no-store" }).then(async response => {
      const data = await response.json() as CreditSnapshot & { error?: string }
      if (!response.ok) throw new Error(data.error || "Provider balances are unavailable.")
      return data
    }).then(data => { if (active) setSnapshot(data) })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : "Provider balances are unavailable.") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function refresh(provider: CreditProvider) {
    setBusy(provider); setMessage("")
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", provider }) })
      const data = await response.json() as CreditSnapshot & { error?: string; code?: string; refreshState?: "cached" | "verified" }
      if (!response.ok) throw new Error(`${data.code === "authentication_error" ? "Authentication error: " : ""}${data.error || "Balance refresh failed."}`)
      setSnapshot(data)
      setMessage(data.refreshState === "cached" ? `${LABELS[provider]}: showing the recent saved API observation; no new provider request was made.` : `${LABELS[provider]} balance verified through its read-only account API.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : "Balance refresh failed.") }
    finally { setBusy(null) }
  }

  async function attest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("attest"); setMessage("")
    try {
      const observation = {
        ...form,
        available: form.available === "" ? null : Number(form.available),
        consumed: form.consumed === "" ? null : Number(form.consumed),
        operationCost: form.operationCost === "" ? null : Number(form.operationCost),
        costBasis: form.operationCost === "" ? "unknown" : "estimated",
        observedAt: new Date().toISOString(),
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      }
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "attest", observation, confirmed: true }) })
      const data = await response.json() as CreditSnapshot & { error?: string }
      if (!response.ok) throw new Error(data.error || "Dashboard observation could not be recorded.")
      setSnapshot(data); setForm(EMPTY_FORM)
      setMessage("Dated Admin dashboard observation recorded. This is not provider API verification.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Dashboard observation could not be recorded.") }
    finally { setBusy(null) }
  }

  return <section className="panel provider-credits-dashboard" aria-label="Provider Credits and Usage">
    <div className="panel-heading"><div><p className="eyebrow">Admin · external account evidence</p><h2>Provider Credits &amp; Usage</h2><span>Externally reported balances only. A dated dashboard observation is not API entitlement or a billing guarantee.</span></div><button type="button" className="provider-credit-refresh" onClick={() => { setLoading(true); void load() }} disabled={loading || busy !== null}>Reload saved balances</button></div>
    {loading && <p role="status">Loading provider balances…</p>}
    {message && <p role="status" className="provider-credit-message">{message}</p>}
    <div className="provider-credit-grid">{snapshot?.providers.map(row => <article key={row.provider} className="provider-credit-card">
      <h3>{LABELS[row.provider]}</h3><p>Connection: <strong>{row.connected ? "credential configured" : "credential unavailable in this runtime"}</strong></p>
      <p>Balance state: <strong>{row.state}</strong></p>
      {row.readiness.map(item => <p key={item.operation}>{item.operation}: entitlement <strong>{item.entitlement}</strong> · execution gate <strong>{item.gateEnabled ? "enabled" : "disabled"}</strong>{!row.connected ? " · credential unavailable" : ""}</p>)}
      {row.observations.length ? row.observations.map(item => <div key={`${item.provider}:${item.category}`} className="provider-credit-observation">
        <strong>{item.category.replaceAll("_", " ")} · {amountLabel(item.available, item.unit)}</strong>
        <span>Consumed: {amountLabel(item.consumed, item.unit)}</span>
        <span>Source: {item.source === "authenticated_api" ? "Authenticated provider API" : "Dated Admin dashboard attestation"} · {item.sourceDetail}</span>
        <span>Observed: {dateLabel(item.observedAt)} · {item.state.toUpperCase()}{item.expiresAt ? ` · expires ${dateLabel(item.expiresAt)}` : ""}</span>
        {item.operation && <span>{item.operation}: {item.operationCost === null ? "cost unknown" : amountLabel(item.operationCost, item.operationCostUnit)} ({item.costBasis})</span>}
        {item.warning && <span role="alert">Account warning: {item.warning}</span>}
      </div>) : <p>No externally reported balance retained. Internal limits are shown separately below.</p>}
      {row.lastVerifiedAt && <p>Last successful provider API balance evidence: {dateLabel(row.lastVerifiedAt)}</p>}
      <p>Last successful recorded operation: {dateLabel(row.lastSuccessfulOperationAt)}</p>
      {row.history.length > 0 && <details><summary>Balance observation history ({row.history.length}{row.historyLimited ? "+" : ""})</summary><ol>{row.history.map((item, index) => <li key={`${item.category}:${item.observedAt}:${index}`}>{dateLabel(item.observedAt)} · {item.category.replaceAll("_", " ")} · {amountLabel(item.available, item.unit)} · {item.source === "authenticated_api" ? "provider API" : "Admin dashboard attestation"} · {item.state}</li>)}</ol>{row.historyLimited && <p>Showing the 30 most recent retained observations.</p>}</details>}
      {row.provider === "coresignal" ? <p>No documented non-billable balance endpoint; retain the next supported x-credits-remaining response.</p> : <button type="button" className="provider-credit-refresh" disabled={busy !== null} onClick={() => void refresh(row.provider)}>{busy === row.provider ? "Checking…" : "Refresh read-only account API"}</button>}
    </article>)}</div>
    <details><summary>Record an authenticated dashboard observation</summary><p>Admin attestation records what you can see in the provider account now. It never marks endpoint entitlement confirmed.</p>
      <form className="provider-credit-attestation" onSubmit={event => void attest(event)}>
        <label>Provider<select value={form.provider} onChange={event => setForm(current => ({ ...current, provider: event.target.value as CreditProvider }))}><option value="coresignal">Coresignal</option><option value="brightdata">Bright Data</option><option value="lusha">Lusha</option></select></label>
        <label>Balance type<select value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value as CreditCategory }))}><option value="general">General credits</option><option value="search">Search credits</option><option value="collect">Collect credits</option><option value="bulk_credits">Bulk credits</option><option value="free_credits">Free credits</option><option value="currency">Currency balance</option></select></label>
        <label>Available<input type="number" min="0" step="any" value={form.available} onChange={event => setForm(current => ({ ...current, available: event.target.value }))} /></label>
        <label>Consumed, if reported<input type="number" min="0" step="any" value={form.consumed} onChange={event => setForm(current => ({ ...current, consumed: event.target.value }))} /></label>
        <label>Unit / currency<input required maxLength={40} value={form.unit} onChange={event => setForm(current => ({ ...current, unit: event.target.value }))} /></label>
        <label>Dashboard location<input required maxLength={160} value={form.sourceDetail} onChange={event => setForm(current => ({ ...current, sourceDetail: event.target.value }))} /></label>
        <label>Expiry, if shown<input type="date" value={form.expiresAt} onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))} /></label>
        <label>Account warning<input maxLength={240} value={form.warning} onChange={event => setForm(current => ({ ...current, warning: event.target.value }))} /></label>
        <label>Priced operation, if shown<input maxLength={120} value={form.operation} onChange={event => setForm(current => ({ ...current, operation: event.target.value }))} /></label>
        <label>Price per operation<input type="number" min="0" step="any" value={form.operationCost} onChange={event => setForm(current => ({ ...current, operationCost: event.target.value }))} /></label>
        <label>Price unit<input maxLength={40} value={form.operationCostUnit} onChange={event => setForm(current => ({ ...current, operationCostUnit: event.target.value }))} /></label>
        <button type="submit" disabled={busy !== null || (form.available === "" && form.consumed === "")}>{busy === "attest" ? "Recording…" : "Attest dated dashboard observation"}</button>
      </form>
    </details>
    <div className="provider-credit-internal"><h3>Corporate Network Internal Spending Controls</h3><p>These application limits are never provider account balances.</p>{snapshot?.internalControls.map(row => <p key={row.provider}><strong>{LABELS[row.provider as CreditProvider]}:</strong> {row.used} / {row.limit} {row.unit} used · {row.remaining} remaining</p>)}</div>
  </section>
}
