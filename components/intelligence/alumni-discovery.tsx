"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { DiscoveryCandidate, DiscoveryReadiness } from "@/lib/intelligence-contracts"

type Missing = { alumniId: string; sourceId: string | null; fullName: string; programme: string | null; graduationYear: number | null }

export function AlumniDiscovery({ canOperate }: { canOperate: boolean }) {
  const [view, setView] = useState<"missing" | "candidates">("missing")
  const [readiness, setReadiness] = useState<DiscoveryReadiness | null>(null)
  const [missing, setMissing] = useState<Missing[]>([])
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const readinessResponse = await fetch("/api/intelligence/discovery/readiness", { cache: "no-store" }); const readinessData = await readinessResponse.json()
      if (!readinessResponse.ok) throw new Error(readinessData.error)
      setReadiness(readinessData)
      if (canOperate) {
        const [missingResponse, candidateResponse] = await Promise.all([fetch("/api/intelligence/discovery?view=missing", { cache: "no-store" }), fetch("/api/intelligence/discovery?view=candidates", { cache: "no-store" })])
        const missingData = await missingResponse.json(); const candidateData = await candidateResponse.json()
        if (!missingResponse.ok || !candidateResponse.ok) throw new Error(missingData.error || candidateData.error)
        setMissing(missingData.alumni ?? []); setCandidates(candidateData.candidates ?? [])
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load staged discovery.") }
    finally { setLoading(false) }
  }, [canOperate])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  async function decide(candidate: DiscoveryCandidate, action: "VERIFY_MATCH" | "REJECT_MATCH" | "KEEP_IN_REVIEW") {
    const response = await fetch(`/api/intelligence/discovery/${candidate.discoveryCandidateId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })
    const data = await response.json()
    if (!response.ok) setMessage(data.error || "Discovery decision was rejected.")
    else { setMessage(`${action} recorded. No Corporate Network alumnus was created or changed.`); await load() }
  }

  return <section className="panel intelligence-discovery"><div className="panel-heading"><div><p className="eyebrow">Alumni Discovery</p><h2>Staged LinkedIn resolution</h2><span>Review evidence without adding alumni or launching refresh automatically.</span></div><Button disabled title={readiness?.reason}>Live Bright discovery unavailable</Button></div>
    <div className="intelligence-disabled-notice"><strong>Live discovery disabled</strong><span>{readiness?.reason ?? "Checking discovery readiness…"}</span></div>
    <div className="intelligence-subtabs"><Button variant={view === "missing" ? "default" : "outline"} onClick={() => setView("missing")}>Missing LinkedIn URL</Button><Button variant={view === "candidates" ? "default" : "outline"} onClick={() => setView("candidates")}>Staged future/new alumni</Button></div>
    {loading ? <p>Loading staged discovery…</p> : !canOperate ? <p>Discovery evidence and decisions require PCOM or Admin access.</p> : view === "missing" ? <div className="intelligence-card-grid">{missing.length ? missing.map(person => <article key={person.alumniId}><strong>{person.fullName}</strong><span>{person.programme || "Programme not recorded"} · {person.graduationYear || "Year not recorded"}</span><small>{person.sourceId ?? "No Corporate Network source mapping"}</small></article>) : <p>No mapped alumni are missing a LinkedIn URL.</p>}</div> : <div className="intelligence-card-grid">{candidates.length ? candidates.map(candidate => { const education = candidate.education[0]; return <article key={candidate.discoveryCandidateId}><strong>{candidate.name}</strong><span>{candidate.currentTitle || "Title unavailable"} · {candidate.currentCompany || "Company unavailable"} · {candidate.location || "Location unavailable"}</span><span>{candidate.linkedinUrl || "LinkedIn URL unavailable"}</span><span>{education?.institution || "Institution unavailable"} · {education?.program || education?.degree || "Programme unavailable"} · {education?.endYear || "Year unavailable"}</span><small>{candidate.reviewStatus} · {candidate.alumniIdentityStatus} · {candidate.linkedinUrlStatus}</small><small>Confidence: {Object.entries(candidate.scores).map(([key, value]) => `${key} ${Math.round(value * 100)}%`).join(" · ")}</small><small>Reasons: {candidate.validationReasons.join(", ") || "No reason codes"}</small>{candidate.duplicateStatus === "DUPLICATE" && <b>Duplicate LinkedIn warning</b>}<div className="intelligence-actions"><Button size="sm" variant="outline" onClick={() => void decide(candidate, "KEEP_IN_REVIEW")}>Keep in review</Button><Button size="sm" variant="outline" onClick={() => void decide(candidate, "REJECT_MATCH")}>Reject match</Button><Button size="sm" disabled={candidate.duplicateStatus === "DUPLICATE"} onClick={() => void decide(candidate, "VERIFY_MATCH")}>Verify match</Button></div></article> }) : <p>No staged discovery candidates.</p>}</div>}
    {message && <p role="alert" className="intelligence-message">{message}</p>}
  </section>
}
