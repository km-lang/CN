"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BriefcaseBusiness, ChevronRight, LoaderCircle, Plus, RefreshCw, UserRoundCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { apiPath } from "@/lib/app-config"
import { opportunityStageLabel, OPPORTUNITY_STAGES, type OpportunityStage } from "@/lib/opportunities"

type Opportunity = {
  id: number
  opportunityKey: string
  company: string
  alumnusId: number | null
  engagementId: number | null
  ownerUserId: number
  title: string
  description: string
  stage: OpportunityStage
  nextAction: string
  followUpDate: string
  outcome: string
  version: number
  createdAt: string
  updatedAt: string
  alumnus: { id: number; name: string; company: string; title: string } | null
  engagement: { id: number; title: string; status: string; alumnusId: number } | null
  owner: { id: number; displayName: string } | null
  history: Array<{ id: number; action: string; fromStage: string; toStage: string; summary: string; actor: string; createdAt: string }>
}

type Support = {
  owners: Array<{ id: number; displayName: string; role: string }>
  alumni: Array<{ id: number; name: string; company: string; title: string }>
  engagements: Array<{ id: number; alumnusId: number; company: string; title: string; status: string }>
  companies: string[]
}

type Form = {
  company: string
  alumnusId: string
  engagementId: string
  ownerUserId: string
  title: string
  description: string
  stage: OpportunityStage
  nextAction: string
  followUpDate: string
  outcome: string
}

const emptySupport: Support = { owners: [], alumni: [], engagements: [], companies: [] }
const emptyForm: Form = { company: "", alumnusId: "none", engagementId: "none", ownerUserId: "", title: "", description: "", stage: "IDENTIFIED", nextAction: "", followUpDate: "", outcome: "" }

export function OpportunitiesWorkspace({ currentUserName, initialCompany = "", initialAlumnusId = null, contextKey = 0, contextMode = "create", defaultToMyWork = false }: { currentUserName: string; initialCompany?: string; initialAlumnusId?: number | null; contextKey?: number; contextMode?: "create" | "filter"; defaultToMyWork?: boolean }) {
  const [items, setItems] = useState<Opportunity[]>([])
  const [support, setSupport] = useState<Support>(emptySupport)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [stageFilter, setStageFilter] = useState("ALL")
  const [ownerFilter, setOwnerFilter] = useState(defaultToMyWork ? "me" : "ALL")
  const [companyFilter, setCompanyFilter] = useState("ALL")
  const [alumnusFilter, setAlumnusFilter] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [selected, setSelected] = useState<Opportunity | null>(null)
  const [editing, setEditing] = useState<Opportunity | null | "new">(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [idempotencyKey, setIdempotencyKey] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (stageFilter !== "ALL") params.set("stage", stageFilter)
    if (ownerFilter !== "ALL") params.set("ownerId", ownerFilter)
    if (companyFilter !== "ALL") params.set("company", companyFilter)
    if (alumnusFilter) params.set("alumnusId", String(alumnusFilter))
    if (search.trim()) params.set("search", search.trim())
    try {
      const response = await fetch(`${apiPath("/api/opportunities")}?${params}`, { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load Corporate Opportunities.")
      setItems(data.opportunities ?? [])
      setTotal(data.total ?? 0)
      setSupport({ owners: data.owners ?? [], alumni: data.alumni ?? [], engagements: data.engagements ?? [], companies: data.companies ?? [] })
      setMessage("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Corporate Opportunities.")
    } finally {
      setLoading(false)
    }
  }, [alumnusFilter, companyFilter, ownerFilter, page, pageSize, search, stageFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(() => {
    if (!contextKey) return
    const timer = window.setTimeout(() => {
      if (contextMode === "create") openCreate(initialCompany, initialAlumnusId)
      else {
        setCompanyFilter(initialCompany || "ALL")
        setAlumnusFilter(initialAlumnusId)
        setPage(1)
        setEditing(null)
        setSelected(null)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const start = total ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(total, page * pageSize)
  const availableAlumni = useMemo(() => support.alumni.filter(person => !form.company || person.company.toLowerCase() === form.company.toLowerCase()), [form.company, support.alumni])
  const availableEngagements = useMemo(() => support.engagements.filter(event => {
    const person = support.alumni.find(item => item.id === event.alumnusId)
    const company = event.company || person?.company || ""
    return (!form.company || company.toLowerCase() === form.company.toLowerCase()) && (form.alumnusId === "none" || event.alumnusId === Number(form.alumnusId))
  }), [form.alumnusId, form.company, support.alumni, support.engagements])

  function resetPage() { setPage(1) }

  function openCreate(company = "", alumnusId: number | null = null) {
    const person = alumnusId ? support.alumni.find(item => item.id === alumnusId) : null
    const resolvedCompany = company || person?.company || ""
    setForm({ ...emptyForm, company: resolvedCompany, alumnusId: alumnusId ? String(alumnusId) : "none", ownerUserId: support.owners.find(owner => owner.displayName === currentUserName)?.id.toString() ?? support.owners[0]?.id.toString() ?? "" })
    setIdempotencyKey(crypto.randomUUID())
    setEditing("new")
    setMessage("")
  }

  function openEdit(item: Opportunity) {
    setForm({ company: item.company, alumnusId: item.alumnusId ? String(item.alumnusId) : "none", engagementId: item.engagementId ? String(item.engagementId) : "none", ownerUserId: String(item.ownerUserId), title: item.title, description: item.description, stage: item.stage, nextAction: item.nextAction, followUpDate: item.followUpDate, outcome: item.outcome })
    setEditing(item)
    setMessage("")
  }

  async function save() {
    if (!form.company.trim() || !form.ownerUserId || !form.title.trim()) {
      setMessage("Company, owner and opportunity title are required.")
      return
    }
    setSaving(true)
    setMessage("")
    const payload = { ...form, alumnusId: form.alumnusId === "none" ? null : Number(form.alumnusId), engagementId: form.engagementId === "none" ? null : Number(form.engagementId), ownerUserId: Number(form.ownerUserId) }
    try {
      const response = await fetch(apiPath("/api/opportunities"), { method: editing === "new" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(editing === "new" ? { ...payload, idempotencyKey } : { ...payload, id: editing?.id, version: editing?.version }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save the opportunity.")
      setEditing(null)
      setSelected(data.opportunity)
      setMessage(data.idempotent ? "The original opportunity was preserved; no duplicate was created." : "Opportunity saved to the shared workspace.")
      window.dispatchEvent(new Event("corporate-opportunities:changed"))
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the opportunity.")
    } finally {
      setSaving(false)
    }
  }

  return <section className="opportunity-workspace">
    <header className="opportunity-heading"><div><p className="eyebrow">Corporate opportunities</p><h2>Track accountable placement opportunities</h2><span>Internal opportunity records never bypass consent, DNC, or outreach review.</span></div><Button onClick={() => openCreate()}><Plus /> New opportunity</Button></header>
    {(alumnusFilter || companyFilter !== "ALL") && <div className="opportunity-context" role="status"><span>Showing {alumnusFilter ? `opportunities linked to alumnus #${alumnusFilter}` : `opportunities for ${companyFilter}`}.</span><Button size="sm" variant="ghost" onClick={() => { setAlumnusFilter(null); setCompanyFilter("ALL"); setPage(1) }}>Clear context</Button></div>}
    {message && <div className="workspace-message" role="status"><BriefcaseBusiness /><span>{message}</span></div>}
    <section className="panel opportunity-list-panel">
      <div className="opportunity-filters"><Input value={search} onChange={event => { setSearch(event.target.value); resetPage() }} placeholder="Search opportunity or company" aria-label="Search Corporate Opportunities" /><Select value={companyFilter} onValueChange={value => { setCompanyFilter(value); resetPage() }}><SelectTrigger aria-label="Filter opportunities by company"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All companies</SelectItem>{support.companies.map(company => <SelectItem key={company} value={company}>{company}</SelectItem>)}</SelectContent></Select><Select value={stageFilter} onValueChange={value => { setStageFilter(value); resetPage() }}><SelectTrigger aria-label="Filter opportunities by stage"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All stages</SelectItem>{OPPORTUNITY_STAGES.map(stage => <SelectItem key={stage} value={stage}>{opportunityStageLabel(stage)}</SelectItem>)}</SelectContent></Select><Select value={ownerFilter} onValueChange={value => { setOwnerFilter(value); resetPage() }}><SelectTrigger aria-label="Filter opportunities by owner"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All owners</SelectItem><SelectItem value="me">Assigned to me</SelectItem>{support.owners.map(owner => <SelectItem key={owner.id} value={String(owner.id)}>{owner.displayName}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> Refresh</Button></div>
      {loading ? <div className="empty-state"><LoaderCircle className="spin" /><h3>Loading opportunities</h3></div> : items.length ? <><Table><TableHeader><TableRow><TableHead>Company / opportunity</TableHead><TableHead>Owner</TableHead><TableHead>Stage</TableHead><TableHead>Next action</TableHead><TableHead>Follow-up</TableHead><TableHead>Updated</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id}><TableCell><span className="stacked-cell"><strong>{item.company}</strong><small>{item.title}</small>{item.alumnus && <small>{item.alumnus.name}</small>}</span></TableCell><TableCell>{item.owner?.displayName || "Unavailable"}</TableCell><TableCell><span className={`opportunity-stage stage-${item.stage.toLowerCase()}`}>{opportunityStageLabel(item.stage)}</span></TableCell><TableCell className="reason-cell">{item.nextAction || "Not recorded"}</TableCell><TableCell>{item.followUpDate || "Not scheduled"}</TableCell><TableCell>{new Date(item.updatedAt).toLocaleDateString()}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelected(item)}>Open <ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table><nav className="pagination-footer" aria-label="Corporate Opportunities pagination"><span className="pagination-summary">Showing {start}–{end} of {total}</span><label className="pagination-size"><span>Rows per page</span><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }}><SelectTrigger aria-label="Corporate Opportunities rows per page"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50].map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></label><div className="pagination-navigation"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button></div></nav></> : <div className="empty-state"><BriefcaseBusiness /><h3>No opportunities found</h3><p>Create a company-first opportunity or adjust the current filters.</p></div>}
    </section>

    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent className="opportunity-dialog">{selected && <><DialogHeader><DialogTitle>{selected.title}</DialogTitle><DialogDescription>{selected.company} · {opportunityStageLabel(selected.stage)}</DialogDescription></DialogHeader><div className="opportunity-detail-grid"><div><span>Responsible owner</span><strong>{selected.owner?.displayName || "Unavailable"}</strong></div><div><span>Linked alumnus</span><strong>{selected.alumnus?.name || "Not linked"}</strong></div><div><span>Linked engagement</span><strong>{selected.engagement?.title || "Not linked"}</strong></div><div><span>Follow-up</span><strong>{selected.followUpDate || "Not scheduled"}</strong></div><div><span>Next action</span><strong>{selected.nextAction || "Not recorded"}</strong></div><div><span>Outcome</span><strong>{selected.outcome || "Not recorded"}</strong></div></div>{selected.description && <p className="opportunity-description">{selected.description}</p>}<section className="opportunity-history"><h3>Operational history</h3>{selected.history.length ? selected.history.map(entry => <article key={entry.id}><span><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.actor} · {new Date(entry.createdAt).toLocaleString()}</small></span><p>{entry.summary}</p></article>) : <p>No history recorded.</p>}</section><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Close</Button><Button onClick={() => { const item = selected; setSelected(null); openEdit(item) }}>Edit opportunity</Button></DialogFooter></>}</DialogContent></Dialog>

    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !saving) setEditing(null) }}><DialogContent className="opportunity-dialog opportunity-form-dialog"><DialogHeader><DialogTitle>{editing === "new" ? "Create corporate opportunity" : "Update corporate opportunity"}</DialogTitle><DialogDescription>Save an accountable internal record. This action does not contact an alumnus or invoke a provider.</DialogDescription></DialogHeader><div className="opportunity-form"><label><span>Company *</span><Input list="opportunity-company-options" value={form.company} disabled={editing !== "new"} onChange={event => setForm(current => ({ ...current, company: event.target.value, alumnusId: "none", engagementId: "none" }))} /><datalist id="opportunity-company-options">{support.companies.map(company => <option key={company} value={company} />)}</datalist></label><label><span>Opportunity title *</span><Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label><label><span>Responsible owner *</span><Select value={form.ownerUserId} onValueChange={value => setForm(current => ({ ...current, ownerUserId: value }))}><SelectTrigger><SelectValue placeholder="Choose owner" /></SelectTrigger><SelectContent>{support.owners.map(owner => <SelectItem key={owner.id} value={String(owner.id)}>{owner.displayName} · {owner.role}</SelectItem>)}</SelectContent></Select></label><label><span>Linked alumnus</span><Select value={form.alumnusId} onValueChange={value => setForm(current => ({ ...current, alumnusId: value, engagementId: "none" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No alumnus linked</SelectItem>{availableAlumni.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.name} · {person.title}</SelectItem>)}</SelectContent></Select></label><label><span>Linked engagement</span><Select value={form.engagementId} onValueChange={value => setForm(current => ({ ...current, engagementId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No engagement linked</SelectItem>{availableEngagements.map(event => <SelectItem key={event.id} value={String(event.id)}>{event.title} · {event.status}</SelectItem>)}</SelectContent></Select></label><label><span>Stage</span><Select disabled={editing === "new"} value={form.stage} onValueChange={value => setForm(current => ({ ...current, stage: value as OpportunityStage }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OPPORTUNITY_STAGES.map(stage => <SelectItem key={stage} value={stage}>{opportunityStageLabel(stage)}</SelectItem>)}</SelectContent></Select></label><label className="opportunity-form-wide"><span>Description / notes</span><Textarea value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label><label className="opportunity-form-wide"><span>Next action</span><Input value={form.nextAction} onChange={event => setForm(current => ({ ...current, nextAction: event.target.value }))} /></label><label><span>Follow-up date</span><Input type="date" value={form.followUpDate} onInput={event => setForm(current => ({ ...current, followUpDate: (event.target as HTMLInputElement).value }))} /></label><label><span>Outcome{["CONFIRMED", "CLOSED_LOST"].includes(form.stage) ? " *" : ""}</span><Input value={form.outcome} onChange={event => setForm(current => ({ ...current, outcome: event.target.value }))} /></label></div>{message && <p className="opportunity-form-message" role="alert">{message}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <UserRoundCheck />} Save opportunity</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
