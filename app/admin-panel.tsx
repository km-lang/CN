"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, ShieldCheck, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiPath } from "@/lib/app-config"
import type { ApplicationRole } from "@/lib/access-types"

type AdminIdentity = { id: number; provider: "google_workspace" | "chatgpt"; verifiedEmail: string; providerDomain: string; lastAuthenticatedAt: string }
type AdminUser = { id: number; externalIdentity: string; displayName: string; email: string; role: ApplicationRole; enabled: boolean; createdAt: string; updatedAt: string; lastLoginAt: string; identities: AdminIdentity[] }
type AuditEvent = { id: number; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; result: string; createdAt: string }
type AdminData = { users: AdminUser[]; audit: AuditEvent[] }

export function AdminPanel({ alumni }: { alumni: Array<{ id: number; name: string; lifecycle?: string }> }) {
  const [data, setData] = useState<AdminData>({ users: [], audit: [] })
  const [form, setForm] = useState({ displayName: "", email: "", role: "PCOM" as ApplicationRole })
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [anonymizeId, setAnonymizeId] = useState<number | null>(null)
  const [confirmation, setConfirmation] = useState("")

  const load = useCallback(async () => {
    const response = await fetch(apiPath("/api/admin"), { cache: "no-store" })
    const result = await response.json() as AdminData & { error?: string }
    if (!response.ok) throw new Error(result.error || "Unable to load administration data.")
    setData(result)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch(error => setMessage(error instanceof Error ? error.message : "Unable to load administration data.")), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function action(payload: Record<string, unknown>) {
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || "Administration action failed.")
      await load()
      setMessage("Administration change saved and audited.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Administration action failed.")
    } finally {
      setLoading(false)
    }
  }

  return <div className="admin-workspace">
    <section className="admin-heading"><div><p className="eyebrow">Security administration</p><h2>Users, roles and audit history</h2><span>Access is denied by default. Only active, authorized identities receive application data.</span></div><span className="security-chip"><ShieldCheck /> Server enforced</span></section>
    {message && <div className="enrichment-message"><Activity /><span>{message}</span></div>}

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Authorize a user</h2><span>Authorize the institutional email first. A verified Google Workspace or recovery identity is linked only after successful sign-in.</span></div></div>
      <div className="admin-add-user"><Input placeholder="Display name" value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} /><Input type="email" placeholder="Institutional email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /><Select value={form.role} onValueChange={role => setForm({ ...form, role: role as ApplicationRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem><SelectItem value="ADMIN">Admin</SelectItem></SelectContent></Select><Button disabled={loading || !form.email} onClick={() => void action({ action: "authorize_user", ...form }).then(() => setForm({ displayName: "", email: "", role: "PCOM" }))}><UserPlus /> Authorize</Button></div>
      <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Linked sign-in</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{data.users.map(user => <TableRow key={user.id}><TableCell><strong>{user.displayName}</strong><small className="review-status">{user.email}</small></TableCell><TableCell>{user.identities.length ? user.identities.map(identity => <span key={identity.id} className="identity-provider">{identity.provider === "google_workspace" ? "Institutional Google" : "ChatGPT recovery"}<small>{identity.verifiedEmail}</small></span>) : <span className="review-status">Pending first sign-in</span>}</TableCell><TableCell><Select value={user.role} onValueChange={role => void action({ action: "change_role", userId: user.id, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem></SelectContent></Select></TableCell><TableCell><span className={`history-status ${user.enabled ? "history-success" : "history-blocked"}`}>{user.enabled ? "Active" : "Disabled"}</span></TableCell><TableCell>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Not signed in"}</TableCell><TableCell><Button size="sm" variant="outline" disabled={loading} onClick={() => void action({ action: "set_user_status", userId: user.id, enabled: !user.enabled })}>{user.enabled ? "Disable" : "Enable"}</Button></TableCell></TableRow>)}</TableBody></Table>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Data lifecycle</h2><span>Archive or request deletion without removing historical audit references.</span></div></div>
      <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Lifecycle state</TableHead><TableHead>Protected anonymization</TableHead></TableRow></TableHeader><TableBody>{alumni.map(person => <TableRow key={person.id}><TableCell>{person.name}<small className="review-status">Record #{person.id}</small></TableCell><TableCell><Select value={person.lifecycle || "Active"} onValueChange={status => void action({ action: "update_lifecycle", alumnusId: person.id, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Archived">Archived</SelectItem><SelectItem value="Deletion requested">Deletion requested</SelectItem>{person.lifecycle === "Anonymized" && <SelectItem value="Anonymized">Anonymized</SelectItem>}</SelectContent></Select></TableCell><TableCell>{anonymizeId === person.id ? <div className="anonymize-confirm"><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={`ANONYMIZE ${person.id}`} /><Button variant="outline" disabled={confirmation !== `ANONYMIZE ${person.id}` || loading} onClick={() => void action({ action: "anonymize_alumnus", alumnusId: person.id, confirmation }).then(() => { setAnonymizeId(null); setConfirmation("") })}>Confirm anonymization</Button><Button variant="ghost" onClick={() => { setAnonymizeId(null); setConfirmation("") }}>Cancel</Button></div> : <Button size="sm" variant="ghost" disabled={person.lifecycle === "Anonymized"} onClick={() => setAnonymizeId(person.id)}>Anonymize…</Button>}</TableCell></TableRow>)}</TableBody></Table>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Central security audit</h2><span>Recent authorization, privacy, provider, outreach and lifecycle changes.</span></div><Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button></div>
      <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{data.audit.map(event => <TableRow key={event.id}><TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell><TableCell>{event.actorName}<small className="review-status">{event.actorRole}</small></TableCell><TableCell>{event.action.replaceAll("_", " ")}</TableCell><TableCell>{event.entityType}{event.entityId ? ` #${event.entityId}` : ""}</TableCell><TableCell>{event.result}</TableCell></TableRow>)}</TableBody></Table>
    </section>
  </div>
}
