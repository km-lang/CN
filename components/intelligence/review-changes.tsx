"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { IntelligenceReview } from "@/lib/intelligence-contracts"

type Decision = "ACCEPT" | "REJECT" | "KEEP_IN_REVIEW"

export function ReviewChanges({ canOperate }: { canOperate: boolean }) {
  const [reviews, setReviews] = useState<IntelligenceReview[]>([])
  const [selected, setSelected] = useState<IntelligenceReview | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [note, setNote] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { const response = await fetch("/api/intelligence/reviews", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setReviews(data.reviews ?? []) }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load intelligence reviews.") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { const timer = window.setTimeout(() => { if (canOperate) void load(); else setLoading(false) }, 0); return () => window.clearTimeout(timer) }, [canOperate, load])

  async function open(review: IntelligenceReview) {
    setSelected(review); setPreview(null); setMessage("")
    const response = await fetch(`/api/intelligence/reviews/${review.id}`, { cache: "no-store" }); const data = await response.json()
    if (!response.ok) setMessage(data.error || "Unable to load review evidence."); else setDetail(data)
  }
  async function act(decision: Decision, apply = false) {
    if (!selected) return
    setMessage("")
    const response = await fetch(`/api/intelligence/reviews/${selected.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: apply ? "decide" : "preview", decision, note }) })
    const data = await response.json()
    if (!response.ok) { setPreview(null); setMessage(data.error || "The review decision was rejected."); return }
    if (apply) { setMessage(`${decision} recorded by the authoritative intelligence service.`); setPreview(null); await load() }
    else setPreview({ ...data, decision })
  }

  return <section className="intelligence-review-layout">
    <div className="panel intelligence-review-list"><div className="panel-heading"><div><p className="eyebrow">Review Changes</p><h2>Human-gated intelligence reviews</h2><span>Canonical data changes only through an authorized ACCEPT transaction.</span></div></div>
      {!canOperate ? <p>Detailed intelligence evidence requires PCOM or Admin access.</p> : loading ? <p>Loading reviews…</p> : reviews.length ? reviews.map(review => <button key={review.id} className={selected?.id === review.id ? "active" : ""} onClick={() => void open(review)}><strong>{review.alumnus}</strong><span>{review.category} · {review.state}</span><small>{review.reason}</small></button>) : <p>No intelligence reviews are waiting.</p>}
    </div>
    <div className="panel intelligence-review-detail"><div className="panel-heading"><div><p className="eyebrow">Stored evidence</p><h2>{selected?.alumnus ?? "Select a review"}</h2><span>Bright and Socai evidence is sanitized before reaching this browser.</span></div></div>
      {detail ? <><pre className="intelligence-evidence">{JSON.stringify(detail, null, 2)}</pre><label><span>Optional decision note</span><Textarea value={note} onChange={event => setNote(event.target.value)} /></label><div className="intelligence-actions"><Button variant="outline" onClick={() => void act("KEEP_IN_REVIEW")}>Preview Keep in review</Button><Button variant="outline" onClick={() => void act("REJECT")}>Preview Reject</Button><Button disabled={selected?.kind === "UNRESOLVED"} onClick={() => void act("ACCEPT")}>Preview Accept</Button></div></> : <p>Current canonical values, changed fields, provider agreement, confidence, timestamps, and decision history will appear here.</p>}
      {preview && <div className="intelligence-decision-preview"><strong>Decision preview</strong><pre>{JSON.stringify(preview, null, 2)}</pre><Button onClick={() => void act(String(preview.decision) as Decision, true)}>Confirm {String(preview.decision)}</Button></div>}
      {message && <p role="alert" className="intelligence-message">{message}</p>}
    </div>
  </section>
}
