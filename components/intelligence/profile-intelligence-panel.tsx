"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { IntelligenceProfileResponse } from "@/lib/intelligence-contracts"

export function ProfileIntelligencePanel({ alumnusId, canOperate, onOpenIntelligence }: { alumnusId: number; canOperate: boolean; onOpenIntelligence: (view: "refresh" | "reviews" | "discovery") => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [data, setData] = useState<IntelligenceProfileResponse | null>(null)
  const [message, setMessage] = useState("")
  const [enrolling, setEnrolling] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState("loading"); setMessage("")
      void fetch(`/api/intelligence/profile/${alumnusId}`, { cache: "no-store", signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); setState("ready") }).catch(error => { if (error?.name !== "AbortError") { setMessage(error instanceof Error ? error.message : "Unable to load profile intelligence."); setState("error") } })
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [alumnusId])
  async function enroll() {
    setEnrolling(true); setMessage("")
    try {
      const response = await fetch(`/api/intelligence/profile/${alumnusId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enroll_bright" }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || "Unable to enroll this alumnus for Bright refresh.")
      setData(value); setMessage(value.enrollment?.reason || "Bright enrollment completed.")
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to enroll this alumnus for Bright refresh.") }
    finally { setEnrolling(false) }
  }
  return <section className="profile-section profile-intelligence-panel"><div className="verification-heading"><div><h3>Profile intelligence</h3><span className="operational-status">{state === "loading" ? "Loading" : state === "error" ? "Unavailable" : data?.resolution.status}</span></div></div>
    {state === "loading" && <p>Loading mapped intelligence state…</p>}
    {state === "error" && <p role="alert">{message} No provider action was started.</p>}
    {state === "ready" && data && <><div className="detail-grid"><div><span>Bright Refresh<strong>{data.eligibility.eligible ? "Eligible" : "Not eligible"}</strong><small>{data.eligibility.message}</small></span></div><div><span>Record origin<strong>{data.provenance.recordOrigin || "Not recorded"}</strong></span></div><div><span>Professional-profile source<strong>{data.provenance.professionalProfileSource || "Not recorded"}</strong></span></div><div><span>Professional-profile verification<strong>{data.provenance.professionalProfileVerification}</strong></span></div><div><span>Intelligence mapping<strong>{data.resolution.status === "MAPPED" ? "Connected" : data.resolution.status === "UNMAPPED" ? "Not enrolled" : "Review required"}</strong></span></div><div><span>LinkedIn URL status<strong>{data.summary?.linkedinUrlStatus ?? (data.eligibility.normalizedLinkedinUrl ? "Known in Corporate Network" : "Missing")}</strong></span></div><div><span>Last Bright attempt<strong>{data.summary?.lastBrightAttempt ? new Date(data.summary.lastBrightAttempt).toLocaleString() : "No attempt recorded"}</strong></span></div><div><span>Last Socai check<strong>{data.summary?.lastSocaiCheck ? new Date(data.summary.lastSocaiCheck).toLocaleString() : "Not checked"}</strong></span></div><div><span>Pending reviews<strong>{data.summary?.pendingReviewCount ?? 0}</strong></span></div></div><p className="section-help">{data.resolution.reason}</p>{message && <p role="status" className="section-help">{message}</p>}{data.summary?.latestEvidence.length ? <div className="profile-timeline">{data.summary.latestEvidence.map(item => <div key={item.snapshotId}><span>{item.provider}</span><p><strong>{new Date(item.fetchedAt).toLocaleString()}</strong>{item.status}<small>Stored intelligence evidence</small></p></div>)}</div> : <p className="section-help">No provider evidence is stored in the intelligence service.</p>}{canOperate && <div className="intelligence-actions">{data.eligibility.canEnroll && <Button size="sm" onClick={() => void enroll()} disabled={enrolling}>{enrolling ? "Enrolling…" : "Enroll for Bright"}</Button>}<Button size="sm" variant="outline" disabled={!data.eligibility.eligible} onClick={() => onOpenIntelligence("refresh")}>Refresh Now</Button><Button size="sm" variant="outline" disabled={!data.eligibility.eligible} onClick={() => onOpenIntelligence("refresh")}>Schedule</Button><Button size="sm" variant="outline" disabled={!data.summary?.pendingReviewCount} onClick={() => onOpenIntelligence("reviews")}>Review pending change</Button><Button size="sm" variant="outline" disabled={!data.summary?.discoveryEligible && data.resolution.status !== "UNMAPPED"} onClick={() => onOpenIntelligence("discovery")}>Find LinkedIn profile</Button></div>}</>}
  </section>
}
