"use client"
import { useEffect, useState } from "react"
import { apiPath } from "@/lib/app-config"
import { professionalReviewStatus } from "@/lib/pcom-workflow"
import { Button } from "@/components/ui/button"

type Person = Parameters<typeof professionalReviewStatus>[0] & { id: number; name: string }
type Evidence = {
  coresignal: { freshness: string; review: { id: number; status: string; proposedChanges: Array<{field?: string; label?: string; oldValue?: string; newValue?: string}>; reviewedBy: string; reviewedAt: string } | null; operation: { status: string; responseSummary: string; createdAt: string } | null };
  recentChanges: Array<{field: string; newValue: string; source: string; reviewedBy: string; createdAt: string}>;
}
export function ProfessionalReviewPanel({ person, canOperate, canAdminister, onReview, onCorrection, onLookup, onReviewed }: { person: Person; canOperate: boolean; canAdminister: boolean; onReviewed: () => void; onReview: () => void; onCorrection: () => void; onLookup: () => void }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [message, setMessage] = useState("")
  const [revision, setRevision] = useState(0)
  const [fields, setFields] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!canOperate) return
    const controller = new AbortController()
    void fetch(apiPath(`/api/professional-verification?alumnusId=${person.id}`), { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json() as { evidence?: Evidence; error?: string }
      if (!response.ok || !data.evidence) throw new Error(data.error || "Stored evidence is unavailable.")
      setEvidence(data.evidence); setMessage("")
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Stored evidence is unavailable.") })
    return () => controller.abort()
  }, [person.id, canOperate, revision])
  const lastReview = evidence?.recentChanges.find(item => item.source === "Manual verification" && ["current_company_verification", "designation_verification"].includes(item.field) && ["Verified", "Likely"].includes(item.newValue))
  const review = professionalReviewStatus({ ...person, providerFreshnessAt: evidence?.coresignal.freshness || person.providerFreshnessAt, professionalReviewedAt: lastReview?.createdAt || person.professionalReviewedAt })
  const fieldOrder = ["company", "title", "location", "linkedinUrl", "previous", "function", "seniority", "currentIndustry", "providerFreshnessAt"]
  const changes = (evidence?.coresignal.review?.proposedChanges ?? []).filter(item => fieldOrder.includes(item.field || "")).sort((left, right) => fieldOrder.indexOf(left.field || "") - fieldOrder.indexOf(right.field || ""))
  async function decide(keepExisting: boolean) {
    const reviewId = evidence?.coresignal.review?.id
    if (!canAdminister || !reviewId || !window.confirm(keepExisting ? "Keep canonical values and record this evidence review?" : "Apply only the selected professional observations after reviewing their source?")) return
    setSaving(true)
    try {
      const response = await fetch(apiPath("/api/enrichment"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply_refresh", reviewId, fields: keepExisting ? [] : fields }) })
      const result = await response.json() as { error?: string; applied?: string[] }
      if (!response.ok) throw new Error(result.error || "Unable to record this evidence decision.")
      setMessage(keepExisting ? "Review recorded; canonical values kept." : `Review recorded; ${(result.applied ?? []).length} professional fields applied.`)
      setFields([]); setRevision(value => value + 1); onReviewed()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to record this evidence decision.") } finally { setSaving(false) }
  }
  return <section className="profile-section professional-review-panel" aria-label="Professional data review"><p className="eyebrow">Professional data accuracy</p><h3>Review current employment</h3><div className="review-status-list">{review.statuses.map(status => <strong key={status}>{status}</strong>)}</div>{review.missing.length > 0 && <p>Needs verification: {review.missing.join(", ")}. Current company is the priority.</p>}<p>{review.note}</p>{lastReview && <small>Last recorded field review: {new Date(lastReview.createdAt).toLocaleDateString()} · {lastReview.reviewedBy}</small>}{message && <p role="status">{message}</p>}<div className="profile-opportunity-actions">{canOperate && <><Button size="sm" onClick={onReview}>Review stored professional evidence</Button><Button size="sm" variant="outline" onClick={onCorrection}>Request / edit profile correction</Button><Button size="sm" variant="outline" onClick={onLookup}>Choose professional lookup</Button></>}</div><p className="section-help">Discovery finds candidates. Professional lookup retrieves evidence for this alumnus. Verification is a separate human decision. Lusha Contact Search and Email/Phone Reveal do not verify current employment.</p>{evidence && <details open={changes.length > 0}><summary>Retained professional evidence ({changes.length} observed fields)</summary>{evidence.coresignal.operation ? <p>Coresignal · {evidence.coresignal.operation.status} · {new Date(evidence.coresignal.operation.createdAt).toLocaleDateString()} · {evidence.coresignal.operation.responseSummary}</p> : <p>No Coresignal professional observation is retained for this alumnus. Missing evidence is not confirmation.</p>}{changes.length > 0 && <><p>Review status: {evidence.coresignal.review?.status}. Canonical values remain unchanged until an authorized decision.</p><table className="professional-evidence-table"><thead><tr><th>Field</th><th>Stored at lookup</th><th>Provider evidence</th></tr></thead><tbody>{changes.map((item,index) => <tr key={index}><td>{canAdminister && evidence.coresignal.review?.status === "Pending review" && ["company", "title", "rawTitle", "function", "seniority", "location", "previous", "currentIndustry"].includes(item.field || "") && item.oldValue !== item.newValue && item.newValue && <input aria-label={`Apply ${item.label || item.field}`} type="checkbox" checked={fields.includes(item.field!)} onChange={() => setFields(current => current.includes(item.field!) ? current.filter(value => value !== item.field) : [...current,item.field!])} />} {item.label || item.field}</td><td>{item.oldValue || "Missing"}</td><td>{item.newValue || "Not returned"}</td></tr>)}</tbody></table>{canAdminister && evidence.coresignal.review?.status === "Pending review" && <div className="profile-opportunity-actions"><Button size="sm" disabled={saving || !fields.length} onClick={() => void decide(false)}>Apply selected professional fields</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => void decide(true)}>Keep canonical values</Button></div>}</>}</details>}</section>
}
