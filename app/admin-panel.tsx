"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, BookPlus, ShieldCheck, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiPath } from "@/lib/app-config"
import type { ApplicationRole } from "@/lib/access-types"
import { PersistedMutationCoordinator } from "@/lib/persisted-mutation"
import type { ProgrammeOption } from "@/lib/programme-options"

type AdminIdentity = { id: number; provider: "google_workspace" | "chatgpt"; verifiedEmail: string; providerDomain: string; lastAuthenticatedAt: string }
type AdminUser = { id: number; externalIdentity: string; displayName: string; email: string; role: ApplicationRole; enabled: boolean; createdAt: string; updatedAt: string; lastLoginAt: string; identities: AdminIdentity[] }
type AuditEvent = { id: number; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; result: string; createdAt: string }
type OperationalReadiness = {
  pdl: { mode: string; configured: boolean }
  lushaContacts: { mode: string; configured: boolean }
  signals: { implementationStatus: string; liveEnabled: boolean; entitlement: "unknown" | "confirmed" | "not_entitled"; lastVerifiedAt: string; verificationSource: string }
  mail: { mode: string; liveEnabled: boolean; provider: string; senderConfigured: boolean; oauthConfigured: boolean; sendPermissionConfigured: boolean; lastValidationStatus: string; lastValidatedAt: string; validationSource: string; validationReason?: string; scopeVerified?: boolean | null }
}
type AdminData = { users: AdminUser[]; audit: AuditEvent[]; programmeOptions?: ProgrammeOption[]; operationalReadiness?: OperationalReadiness }
type SignalsEntitlementValidation = {
  entitlement: "confirmed" | "not_entitled" | "unknown"
  outcome: string
  httpStatus: number | null
  signalTypes: string[]
  promotionAvailable: boolean
  companyChangeAvailable: boolean
  providerReportedCredits: number | null
  checkedAt: string
}
type GmailConnectivityValidation = {
  status: "confirmed" | "failed" | "unknown"
  outcome: string
  checkedAt: string
  reason: string
  scopeVerified: boolean | null
}
type SimilarEmailWarning = { enteredEmail: string; similarUser: { id: number; email: string; displayName: string } }
type MockCleanupInventory = {
  ambiguous: string[]
  counts: {
    alumni: number
    companies: number
    engagementOutreach: number
    professionalSignals: number
    birthdays: number
    communicationPreferences: number
    relationships: number
    activityLog: number
    providerHistory: number
    providerSearches: number
    providerResults: number
    providerReviews: number
    fieldChanges: number
    imports: number
    privacyControls: number
    lifecycleRecords: number
  }
  retained: {
    liveDiscoveryResults: number
    liveSearchCredits: number
    liveProviderHistory: number
    liveProviderCredits: number
  }
}
type IntegrityResult = {
  integrity: Array<{ integrity_check: string }>
  foreignKeys: Array<Record<string, unknown>>
}
type MockCleanupResult = {
  removed: MockCleanupInventory["counts"]
  retained: MockCleanupInventory["retained"]
  final: {
    alumni: number
    applicationUsers: number
    applicationIdentities: number
    mockProviderHistory: number
    integrity: Array<{ integrity_check: string }>
    foreignKeys: Array<Record<string, unknown>>
  }
}

const AUDIT_LABELS: Record<string, string> = {
  lusha_contact_enrichment: "Lusha contact enrichment", pdl_profile_refresh: "PDL profile refresh",
  user_role_changed: "Role changed", user_disabled: "User disabled", user_enabled: "User enabled",
  programme_deactivated: "Programme deactivated", programme_activated: "Programme reactivated",
  alumnus_anonymized: "Data anonymized", provider_history_refreshed: "Provider history refreshed",
}

function friendlyAuditLabel(value: string) {
  return AUDIT_LABELS[value] ?? value.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase())
}

export function AdminPanel({ alumni }: { alumni: Array<{ id: number; name: string; programme: string; lifecycle?: string }> }) {
  const [data, setData] = useState<AdminData>({ users: [], audit: [] })
  const [form, setForm] = useState({ displayName: "", email: "", role: "PCOM" as ApplicationRole })
  const [programmeForm, setProgrammeForm] = useState({ code: "", name: "" })
  const [programmeNameDrafts, setProgrammeNameDrafts] = useState<Record<number, string>>({})
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [anonymizeId, setAnonymizeId] = useState<number | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const [similarEmailWarning, setSimilarEmailWarning] = useState<SimilarEmailWarning | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState<MockCleanupInventory | null>(null)
  const [cleanupIntegrity, setCleanupIntegrity] = useState<IntegrityResult | null>(null)
  const [cleanupResult, setCleanupResult] = useState<MockCleanupResult | null>(null)
  const [cleanupConfirmation, setCleanupConfirmation] = useState("")
  const [signalsValidation, setSignalsValidation] = useState<SignalsEntitlementValidation | null>(null)
  const [mailValidation, setMailValidation] = useState<GmailConnectivityValidation | null>(null)
  const [lifecycleDrafts, setLifecycleDrafts] = useState<Record<number, string>>({})
  const persistedMutationsRef = useRef(new PersistedMutationCoordinator())
  const pendingMutationCountsRef = useRef(new Map<string, number>())
  const [pendingMutationKeys, setPendingMutationKeys] = useState<Set<string>>(new Set())
  const [lifecycleSearch, setLifecycleSearch] = useState("")
  const [lifecycleStateFilter, setLifecycleStateFilter] = useState("All lifecycle states")
  const [lifecycleProgramme, setLifecycleProgramme] = useState("All programmes")
  const [auditActor, setAuditActor] = useState("All actors")
  const [auditAction, setAuditAction] = useState("All actions")
  const [auditResult, setAuditResult] = useState("All results")

  function beginPersistedMutation(key: string) {
    pendingMutationCountsRef.current.set(key, (pendingMutationCountsRef.current.get(key) ?? 0) + 1)
    setPendingMutationKeys(current => new Set(current).add(key))
  }

  function finishPersistedMutation(key: string) {
    const remaining = Math.max(0, (pendingMutationCountsRef.current.get(key) ?? 1) - 1)
    if (remaining) pendingMutationCountsRef.current.set(key, remaining)
    else pendingMutationCountsRef.current.delete(key)
    setPendingMutationKeys(current => {
      const next = new Set(current)
      if (!remaining) next.delete(key)
      return next
    })
  }

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

  async function validateSignalsEntitlement() {
    setLoading(true)
    setSignalsValidation(null)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "validate_signals_entitlement" }),
      })
      const result = await response.json() as { validation?: SignalsEntitlementValidation; error?: string }
      if (!response.ok || !result.validation) throw new Error(result.error || "Unable to validate Professional Signals entitlement.")
      setSignalsValidation(result.validation)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to validate Professional Signals entitlement.")
    } finally {
      setLoading(false)
    }
  }

  async function validateGmailConnectivity() {
    setLoading(true)
    setMailValidation(null)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "validate_gmail_connectivity" }),
      })
      const result = await response.json() as { validation?: GmailConnectivityValidation; error?: string }
      if (!response.ok || !result.validation) throw new Error(result.error || "Unable to validate Gmail connectivity.")
      setMailValidation(result.validation)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to validate Gmail connectivity.")
    } finally {
      setLoading(false)
    }
  }

  async function action(payload: Record<string, unknown>) {
    const requestPayload = { ...payload }
    if (payload.action === "set_user_status" && payload.enabled === false) {
      const user = data.users.find(candidate => candidate.id === payload.userId)
      if (!window.confirm(`Disable ${user?.displayName ?? "this user"}?\n\nThis prevents future application access. Historical audit records remain.`)) return false
      requestPayload.confirmation = `DISABLE USER ${payload.userId}`
    }
    if (payload.action === "set_programme_status" && payload.active === false) {
      const programme = data.programmeOptions?.find(candidate => candidate.id === payload.programmeId)
      if (!window.confirm(`Deactivate ${programme?.code ?? "this programme"}?\n\nExisting alumni keep this programme. It will be unavailable for future selection.`)) return false
      requestPayload.confirmation = `DEACTIVATE PROGRAMME ${payload.programmeId}`
    }
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestPayload) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || "Administration action failed.")
      await load()
      setMessage("Administration change saved and audited.")
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Administration action failed.")
      return false
    } finally {
      setLoading(false)
    }
  }

  async function addProgramme() {
    if (await action({ action: "add_programme", ...programmeForm })) setProgrammeForm({ code: "", name: "" })
  }

  async function renameProgramme(programme: ProgrammeOption) {
    const name = (programmeNameDrafts[programme.id] ?? programme.name).trim()
    if (await action({ action: "rename_programme", programmeId: programme.id, name })) {
      setProgrammeNameDrafts(current => { const next = { ...current }; delete next[programme.id]; return next })
    }
  }

  async function updateUserRole(user: AdminUser, role: ApplicationRole) {
    if (role === "ADMIN" && user.role !== "ADMIN" && !window.confirm(`Grant Admin access to ${user.displayName}?\n\nAdmins can manage users, provider configuration, lifecycle operations and security-sensitive settings.`)) return
    const previousRole = user.role
    const mutationKey = `user:${user.id}:role`
    setData(current => ({ ...current, users: current.users.map(candidate => candidate.id === user.id ? { ...candidate, role } : candidate) }))
    beginPersistedMutation(mutationKey)
    const result = await persistedMutationsRef.current.run(mutationKey, previousRole, async () => {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change_role", userId: user.id, role, confirmation: role === "ADMIN" ? `GRANT ADMIN ${user.id}` : undefined }) })
      const body = await response.json() as { user?: AdminUser; error?: string }
      if (!response.ok || !body.user) throw new Error(body.error || "Unable to change the user role.")
      return body.user.role
    })
    if (result.latest) {
      const resolvedRole = result.ok ? result.value : result.rollback
      setData(current => ({ ...current, users: current.users.map(candidate => candidate.id === user.id ? { ...candidate, role: resolvedRole } : candidate) }))
      setMessage(result.ok ? "User role saved and audited." : result.error instanceof Error ? result.error.message : "Unable to change the user role.")
    }
    finishPersistedMutation(mutationKey)
  }

  async function updateLifecycle(person: { id: number; lifecycle?: string }, status: string) {
    if (status === "Archived" && !window.confirm(`Archive this alumnus?\n\nArchiving removes the alumnus from normal operational workflows while retaining the record and historical references.`)) return
    const previousStatus = lifecycleDrafts[person.id] ?? person.lifecycle ?? "Active"
    const mutationKey = `alumnus:${person.id}:lifecycle`
    setLifecycleDrafts(current => ({ ...current, [person.id]: status }))
    beginPersistedMutation(mutationKey)
    const result = await persistedMutationsRef.current.run(mutationKey, previousStatus, async () => {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_lifecycle", alumnusId: person.id, status, confirmation: status === "Archived" ? `ARCHIVE ${person.id}` : undefined }) })
      const body = await response.json() as { lifecycle?: { status: string }; error?: string }
      if (!response.ok || !body.lifecycle) throw new Error(body.error || "Unable to update the lifecycle state.")
      return body.lifecycle.status
    })
    if (result.latest) {
      setLifecycleDrafts(current => ({ ...current, [person.id]: result.ok ? result.value : result.rollback }))
      setMessage(result.ok ? "Lifecycle state saved and audited." : result.error instanceof Error ? result.error.message : "Unable to update the lifecycle state.")
    }
    finishPersistedMutation(mutationKey)
  }

  async function authorizeUser(confirmSimilarEmail = false) {
    if (form.role === "ADMIN" && !window.confirm(`Grant Admin access to ${form.displayName || form.email}?\n\nAdmins can manage users, provider configuration, lifecycle operations and security-sensitive settings.`)) return
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authorize_user", ...form, confirmSimilarEmail, confirmation: form.role === "ADMIN" ? `GRANT ADMIN ${form.email.trim().toLowerCase()}` : undefined }) })
      const result = await response.json() as { error?: string; code?: string; enteredEmail?: string; similarUser?: SimilarEmailWarning["similarUser"] }
      if (response.status === 409 && result.code === "possible_similar_user" && result.enteredEmail && result.similarUser) {
        setSimilarEmailWarning({ enteredEmail: result.enteredEmail, similarUser: result.similarUser })
        return
      }
      if (!response.ok) throw new Error(result.error || "Unable to authorize this user.")
      await load()
      setForm({ displayName: "", email: "", role: "PCOM" })
      setSimilarEmailWarning(null)
      setMessage("User authorization saved and audited.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to authorize this user.")
    } finally {
      setLoading(false)
    }
  }

  async function previewMockCleanup() {
    setLoading(true)
    setMessage("")
    setCleanupResult(null)
    try {
      const response = await fetch(apiPath("/api/admin"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview_mock_cleanup" }),
      })
      const result = await response.json() as { inventory?: MockCleanupInventory; integrity?: IntegrityResult["integrity"]; foreignKeys?: IntegrityResult["foreignKeys"]; error?: string }
      if (!response.ok || !result.inventory) throw new Error(result.error || "Unable to preview the mock-data cleanup.")
      setCleanupPreview(result.inventory)
      setCleanupIntegrity({ integrity: result.integrity ?? [], foreignKeys: result.foreignKeys ?? [] })
      setMessage(result.inventory.ambiguous.length
        ? "Cleanup is blocked until the ambiguous records are reviewed."
        : "Preview complete. No records have been deleted.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview the mock-data cleanup.")
    } finally {
      setLoading(false)
    }
  }

  async function removeMockDataset() {
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove_mock_dataset", confirmation: cleanupConfirmation }),
      })
      const result = await response.json() as MockCleanupResult & { error?: string }
      if (!response.ok) throw new Error(result.error || "Unable to remove the mock dataset.")
      setCleanupResult(result)
      setCleanupPreview(null)
      setCleanupConfirmation("")
      await load()
      setMessage("Mock/demo business data removed. Security data and live PDL review evidence were retained.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the mock dataset.")
    } finally {
      setLoading(false)
    }
  }

  const lifecycleProgrammes = [...new Set(alumni.map(person => person.programme))].sort()
  const visibleLifecycle = alumni.filter(person => {
    if (lifecycleSearch && !person.name.toLowerCase().includes(lifecycleSearch.toLowerCase())) return false
    if (lifecycleStateFilter !== "All lifecycle states" && (person.lifecycle ?? "Active") !== lifecycleStateFilter) return false
    if (lifecycleProgramme !== "All programmes" && person.programme !== lifecycleProgramme) return false
    return true
  })
  const auditActors = [...new Set(data.audit.map(event => event.actorName))].sort()
  const auditActions = [...new Set(data.audit.map(event => event.action))].sort()
  const auditResults = [...new Set(data.audit.map(event => event.result))].sort()
  const visibleAudit = data.audit.filter(event => (auditActor === "All actors" || event.actorName === auditActor) && (auditAction === "All actions" || event.action === auditAction) && (auditResult === "All results" || event.result === auditResult))

  return <div className="admin-workspace">
    <section className="admin-heading"><div><p className="eyebrow">Security administration</p><h2>Users, roles and audit history</h2><span>Access is denied by default. Only active, authorized identities receive application data.</span></div><span className="security-chip"><ShieldCheck /> Server enforced</span></section>
    {message && <div className="enrichment-message"><Activity /><span>{message}</span></div>}

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Authorize a user</h2><span>Authorize the institutional email first. A verified Google Workspace or recovery identity is linked only after successful sign-in.</span></div></div>
      <div className="admin-add-user"><Input placeholder="Display name" value={form.displayName} onChange={event => { setForm({ ...form, displayName: event.target.value }); setSimilarEmailWarning(null) }} /><Input type="email" placeholder="Institutional email" value={form.email} onChange={event => { setForm({ ...form, email: event.target.value }); setSimilarEmailWarning(null) }} /><Select value={form.role} onValueChange={role => setForm({ ...form, role: role as ApplicationRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem><SelectItem value="ADMIN">Admin</SelectItem></SelectContent></Select><Button title={!form.email ? "Enter an institutional email address first." : loading ? "Another administration change is still saving." : undefined} disabled={loading || !form.email} onClick={() => void authorizeUser()}><UserPlus /> Authorize</Button></div>
      {similarEmailWarning && <div className="admin-similar-warning"><div><strong>Possible similar authorized user found:</strong><span>{similarEmailWarning.similarUser.email}</span><strong>You entered:</strong><span>{similarEmailWarning.enteredEmail}</span><small>Review the address carefully. This warning does not automatically block authorization.</small></div><div><Button variant="outline" disabled={loading} onClick={() => void authorizeUser(true)}>Continue anyway</Button><Button variant="ghost" disabled={loading} onClick={() => setSimilarEmailWarning(null)}>Cancel</Button></div></div>}
      <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Linked sign-in</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{data.users.map(user => { const roleMutationKey = `user:${user.id}:role`; return <TableRow key={user.id}><TableCell><strong>{user.displayName}</strong><small className="review-status">{user.email}</small></TableCell><TableCell>{user.identities.length ? user.identities.map(identity => <span key={identity.id} className="identity-provider">{identity.provider === "google_workspace" ? "Institutional Google" : "Recovery sign-in"}<small>{identity.verifiedEmail}</small></span>) : <span className="review-status">Pending first sign-in</span>}</TableCell><TableCell><Select value={user.role} onValueChange={role => void updateUserRole(user, role as ApplicationRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem></SelectContent></Select>{pendingMutationKeys.has(roleMutationKey) && <small className="review-status">Saving latest role…</small>}</TableCell><TableCell><span className={`history-status ${user.enabled ? "history-success" : "history-blocked"}`}>{user.enabled ? "Active" : "Disabled"}</span></TableCell><TableCell>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Not signed in"}</TableCell><TableCell><Button title={loading ? "Another administration change is still saving." : undefined} size="sm" variant="outline" disabled={loading} onClick={() => void action({ action: "set_user_status", userId: user.id, enabled: !user.enabled })}>{user.enabled ? "Disable" : "Enable"}</Button></TableCell></TableRow> })}</TableBody></Table>
      <p className="section-help">At least one active Admin must remain. Recovery sign-in is an exception path; institutional Google Workspace remains the primary identity.</p>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Programme reference data</h2><span>Active programmes are available for future selection. Deactivation preserves historical alumni values.</span></div></div>
      <div className="admin-programme-add"><Input aria-label="New programme code" placeholder="Code, e.g. PGPWE" value={programmeForm.code} onChange={event => setProgrammeForm(current => ({ ...current, code: event.target.value }))} /><Input aria-label="New programme name" placeholder="Programme name" value={programmeForm.name} onChange={event => setProgrammeForm(current => ({ ...current, name: event.target.value }))} /><Button disabled={loading || !programmeForm.code.trim() || !programmeForm.name.trim()} onClick={() => void addProgramme()}><BookPlus /> Add programme</Button></div>
      <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Display name</TableHead><TableHead>Availability</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{(data.programmeOptions ?? []).map(programme => <TableRow key={programme.id}><TableCell><strong>{programme.code}</strong></TableCell><TableCell><Input aria-label={`Programme name for ${programme.code}`} value={programmeNameDrafts[programme.id] ?? programme.name} onChange={event => setProgrammeNameDrafts(current => ({ ...current, [programme.id]: event.target.value }))} /></TableCell><TableCell><span className={`history-status ${programme.active ? "history-success" : "history-blocked"}`}>{programme.active ? "Active" : "Inactive"}</span></TableCell><TableCell><div className="programme-actions"><Button size="sm" variant="outline" disabled={loading || !(programmeNameDrafts[programme.id] ?? programme.name).trim() || (programmeNameDrafts[programme.id] ?? programme.name).trim() === programme.name} onClick={() => void renameProgramme(programme)}>Save name</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => void action({ action: "set_programme_status", programmeId: programme.id, active: !programme.active })}>{programme.active ? "Deactivate" : "Reactivate"}</Button></div></TableCell></TableRow>)}</TableBody></Table>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Operational readiness</h2><span>Provider gates and authorization are independent. Secret values are never displayed here.</span></div></div>
      <div className="readiness-grid">
        <article><strong>People Data Labs</strong><span>{data.operationalReadiness?.pdl.mode.toUpperCase() ?? "UNKNOWN"}</span><small>{data.operationalReadiness?.pdl.configured ? "API key configured" : "API key missing"}</small></article>
        <article><strong>Lusha Contacts</strong><span>{data.operationalReadiness?.lushaContacts.mode.toUpperCase() ?? "UNKNOWN"}</span><small>{data.operationalReadiness?.lushaContacts.configured ? "Contact API configured" : "Contact API key missing"}</small></article>
        <article><strong>Lusha Professional Signals</strong><span>{data.operationalReadiness?.signals.liveEnabled && data.operationalReadiness.signals.entitlement === "confirmed" ? "LIVE" : data.operationalReadiness?.signals.entitlement === "not_entitled" ? "OFF · NOT ENTITLED" : "Ready — gate disabled"}</span><small>Implementation: {data.operationalReadiness?.signals.implementationStatus ?? "unknown"} · Gate: {data.operationalReadiness?.signals.liveEnabled ? "enabled" : "disabled"} · Entitlement: {(data.operationalReadiness?.signals.entitlement ?? "unknown").replaceAll("_", " ")}</small><small>Last verification: {data.operationalReadiness?.signals.lastVerifiedAt || "Not verified"}{data.operationalReadiness?.signals.verificationSource ? ` · ${data.operationalReadiness.signals.verificationSource}` : ""}</small><Button title={!data.operationalReadiness?.lushaContacts.configured ? "Requires the server-side Lusha Contacts API key." : loading ? "Another administration check is still running." : undefined} size="sm" variant="outline" disabled={loading || !data.operationalReadiness?.lushaContacts.configured} onClick={() => void validateSignalsEntitlement()}>{loading ? "Validating…" : "Validate Signals Entitlement"}</Button><small>{data.operationalReadiness?.signals.liveEnabled ? "Checks entitlement metadata only. No person-level Professional Signals lookup is run." : "Checks entitlement metadata only. No person-level lookup is run; the Signals gate remains disabled."}</small>{signalsValidation && <div role="status" className="signals-entitlement-result"><strong>Validation: {signalsValidation.entitlement.replaceAll("_", " ")}</strong><small>Provider outcome: {signalsValidation.outcome.replaceAll("_", " ")} · HTTP: {signalsValidation.httpStatus ?? "unavailable"} · {new Date(signalsValidation.checkedAt).toLocaleString()}</small><small>Promotion: {signalsValidation.promotionAvailable ? "available" : "not confirmed"} · Company/job change: {signalsValidation.companyChangeAvailable ? "available" : "not confirmed"}</small><small>Recognized contact types: {signalsValidation.signalTypes.join(", ") || "unavailable"}</small><small>Provider-reported usage: {signalsValidation.providerReportedCredits === null ? "Not reported (do not assume zero)" : `${signalsValidation.providerReportedCredits} credits`}. Account balance was not queried.</small>{signalsValidation.entitlement === "confirmed" && !data.operationalReadiness?.signals.liveEnabled && <small>Entitlement is confirmed. Activation remains restricted to authorized Sites environment controls; this validation changes no runtime setting.</small>}</div>}</article>
        <article><strong>Institutional Mail</strong><span>{data.operationalReadiness?.mail.mode === "live" ? "LIVE" : data.operationalReadiness?.mail.senderConfigured && data.operationalReadiness?.mail.oauthConfigured && data.operationalReadiness?.mail.sendPermissionConfigured ? "Ready — gate disabled" : "OFF"}</span><small>Mode: {data.operationalReadiness?.mail.mode.toUpperCase() ?? "MOCK"} · Sender: {data.operationalReadiness?.mail.senderConfigured ? "configured" : "missing"} · OAuth: {data.operationalReadiness?.mail.oauthConfigured ? "configured" : "missing"} · Gmail send permission: {data.operationalReadiness?.mail.sendPermissionConfigured ? "confirmed" : "not confirmed"} · Gate: {data.operationalReadiness?.mail.liveEnabled ? "enabled" : "disabled"}</small><small>Last connectivity validation: {data.operationalReadiness?.mail.lastValidationStatus ?? "Not validated"}{data.operationalReadiness?.mail.lastValidatedAt ? ` · ${data.operationalReadiness.mail.lastValidatedAt}` : ""}{data.operationalReadiness?.mail.validationSource ? ` · ${data.operationalReadiness.mail.validationSource}` : ""}</small>{data.operationalReadiness?.mail.lastValidationStatus !== "confirmed" && data.operationalReadiness?.mail.validationReason && <small>Reason: {data.operationalReadiness.mail.validationReason}</small>}<Button title={!data.operationalReadiness?.mail.oauthConfigured ? "Requires configured Gmail OAuth credentials." : data.operationalReadiness?.mail.provider !== "gmail" ? "Requires Gmail as the configured mail provider." : loading ? "Another administration check is still running." : undefined} size="sm" variant="outline" disabled={loading || !data.operationalReadiness?.mail.oauthConfigured || data.operationalReadiness?.mail.provider !== "gmail"} onClick={() => void validateGmailConnectivity()}>{loading ? "Validating…" : "Validate Gmail Connectivity"}</Button><small>{data.operationalReadiness?.mail.mode === "live" ? "Refreshes OAuth authorization only. No email is created or sent; live mail configuration is unchanged." : "Refreshes OAuth authorization only. No email is created or sent; the mail gate remains disabled."}</small>{mailValidation && <div role="status" className="signals-entitlement-result"><strong>Validation: {mailValidation.status}</strong><small>{mailValidation.reason}</small><small>Outcome: {mailValidation.outcome.replaceAll("_", " ")} · {new Date(mailValidation.checkedAt).toLocaleString()}</small><small>Gmail send scope: {mailValidation.scopeVerified === true ? "confirmed" : mailValidation.scopeVerified === false ? "missing" : "not returned by provider"}</small></div>}</article>
      </div>
      <p className="section-help">Change runtime provider and mail configuration only through authorized Sites environment controls. PCOM users cannot view or change these settings.</p>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Production data maintenance</h2><span>Remove only records classified through explicit mock, demo, seed or mock-provider markers. Live provider evidence and security records are excluded.</span></div><Button variant="outline" disabled={loading} onClick={() => void previewMockCleanup()}><Activity /> Preview cleanup</Button></div>
      {cleanupPreview && <div className="admin-similar-warning">
        <div>
          <strong>Records identified for removal</strong>
          <span>{cleanupPreview.counts.alumni} alumni · {cleanupPreview.counts.companies} companies · {cleanupPreview.counts.engagementOutreach} engagement/outreach · {cleanupPreview.counts.providerHistory + cleanupPreview.counts.providerSearches + cleanupPreview.counts.providerResults + cleanupPreview.counts.providerReviews + cleanupPreview.counts.fieldChanges} provider/history</span>
          <span>Categories: mock/demo alumni · seed engagement events · mock-provider responses · development-only activity</span>
          <strong>Protected live evidence</strong>
          <span>{cleanupPreview.retained.liveDiscoveryResults} review results · {cleanupPreview.retained.liveSearchCredits} Search credits</span>
          <span>Live provider evidence affected: 0 · Security audit records affected: 0</span>
          {cleanupIntegrity && <><strong>Database checks</strong><span>Quick check: {cleanupIntegrity.integrity.map(row => row.integrity_check).join(", ") || "unavailable"} · Foreign-key violations: {cleanupIntegrity.foreignKeys.length}</span></>}
          {cleanupPreview.ambiguous.length > 0 && <><strong>Ambiguous records</strong>{cleanupPreview.ambiguous.map(item => <span key={item}>{item}</span>)}</>}
        </div>
        {cleanupPreview.ambiguous.length === 0 && <div className="anonymize-confirm">
          <Input value={cleanupConfirmation} onChange={event => setCleanupConfirmation(event.target.value)} placeholder="CLEANUP" />
          <Button variant="destructive" disabled={loading || cleanupConfirmation !== "CLEANUP"} onClick={() => void removeMockDataset()}><Trash2 /> Remove mock data</Button>
          <Button variant="ghost" onClick={() => { setCleanupPreview(null); setCleanupConfirmation("") }}>Cancel</Button>
        </div>}
      </div>}
      {cleanupResult && <div className="admin-similar-warning"><div><strong>Cleanup completed</strong><span>{cleanupResult.removed.alumni} alumni removed · {cleanupResult.final.alumni} internal alumni remain</span><span>{cleanupResult.retained.liveDiscoveryResults} live review results retained · {cleanupResult.retained.liveSearchCredits} Search credits retained</span><span>Integrity: {cleanupResult.final.integrity.map(row => row.integrity_check).join(", ")} · Foreign-key violations: {cleanupResult.final.foreignKeys.length}</span></div></div>}
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Data lifecycle</h2><span>Archive or request deletion without removing historical audit references.</span></div></div>
      <p className="section-help"><strong>Archive:</strong> removes an alumnus from normal operational workflows while retaining the record and historical references. <strong>Anonymize:</strong> irreversibly removes identifying personal data while preserving necessary audit references.</p>
      <div className="outreach-filters"><Input aria-label="Search lifecycle alumni" placeholder="Search alumnus" value={lifecycleSearch} onChange={event => setLifecycleSearch(event.target.value)} /><Select value={lifecycleStateFilter} onValueChange={setLifecycleStateFilter}><SelectTrigger aria-label="Lifecycle state"><SelectValue /></SelectTrigger><SelectContent>{["All lifecycle states", "Active", "Archived", "Deletion requested", "Anonymized"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Select value={lifecycleProgramme} onValueChange={setLifecycleProgramme}><SelectTrigger aria-label="Lifecycle programme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All programmes">All programmes</SelectItem>{lifecycleProgrammes.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Button variant="ghost" onClick={() => { setLifecycleSearch(""); setLifecycleStateFilter("All lifecycle states"); setLifecycleProgramme("All programmes") }}>Clear</Button></div>
      <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Lifecycle state</TableHead><TableHead>Protected anonymization</TableHead></TableRow></TableHeader><TableBody>{visibleLifecycle.map(person => { const lifecycleMutationKey = `alumnus:${person.id}:lifecycle`; return <TableRow key={person.id}><TableCell>{person.name}<small className="review-status">Record #{person.id}</small></TableCell><TableCell><Select value={lifecycleDrafts[person.id] ?? person.lifecycle ?? "Active"} onValueChange={status => void updateLifecycle(person, status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Archived">Archived</SelectItem><SelectItem value="Deletion requested">Deletion requested</SelectItem>{person.lifecycle === "Anonymized" && <SelectItem value="Anonymized">Anonymized</SelectItem>}</SelectContent></Select>{pendingMutationKeys.has(lifecycleMutationKey) && <small className="review-status">Saving latest lifecycle state…</small>}</TableCell><TableCell>{anonymizeId === person.id ? <div className="anonymize-confirm"><small>Personal identity, contact details, provider identifiers, profile URL, notes and relationship assessment will be irreversibly removed.</small><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={`ANONYMIZE ${person.id}`} /><Button title={confirmation !== `ANONYMIZE ${person.id}` ? `Type ANONYMIZE ${person.id} to confirm.` : loading ? "Another administration change is still saving." : undefined} variant="outline" disabled={confirmation !== `ANONYMIZE ${person.id}` || loading} onClick={() => void action({ action: "anonymize_alumnus", alumnusId: person.id, confirmation }).then(() => { setAnonymizeId(null); setConfirmation("") })}>Confirm anonymization</Button><Button variant="ghost" onClick={() => { setAnonymizeId(null); setConfirmation("") }}>Cancel</Button></div> : <Button title={person.lifecycle === "Anonymized" ? "This record is already anonymized and cannot be anonymized again." : undefined} size="sm" variant="ghost" disabled={person.lifecycle === "Anonymized"} onClick={() => setAnonymizeId(person.id)}>Anonymize…</Button>}</TableCell></TableRow> })}</TableBody></Table>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Central security audit</h2><span>Recent authorization, privacy, provider, outreach and lifecycle changes.</span></div><Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button></div>
      <div className="outreach-filters"><Select value={auditActor} onValueChange={setAuditActor}><SelectTrigger aria-label="Audit actor"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All actors">All actors</SelectItem>{auditActors.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Select value={auditAction} onValueChange={setAuditAction}><SelectTrigger aria-label="Audit action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All actions">All actions</SelectItem>{auditActions.map(value => <SelectItem key={value} value={value}>{friendlyAuditLabel(value)}</SelectItem>)}</SelectContent></Select><Select value={auditResult} onValueChange={setAuditResult}><SelectTrigger aria-label="Audit result"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All results">All results</SelectItem>{auditResults.map(value => <SelectItem key={value} value={value}>{friendlyAuditLabel(value)}</SelectItem>)}</SelectContent></Select><Button variant="ghost" onClick={() => { setAuditActor("All actors"); setAuditAction("All actions"); setAuditResult("All results") }}>Clear</Button></div>
      <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{visibleAudit.map(event => <TableRow key={event.id}><TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell><TableCell>{event.actorName}<small className="review-status">{event.actorRole}</small></TableCell><TableCell>{friendlyAuditLabel(event.action)}</TableCell><TableCell>{friendlyAuditLabel(event.entityType)}{event.entityId ? ` #${event.entityId}` : ""}</TableCell><TableCell><span className={`history-status history-${event.result === "success" ? "success" : event.result === "blocked" ? "blocked" : "error"}`}>{friendlyAuditLabel(event.result)}</span></TableCell></TableRow>)}</TableBody></Table>
    </section>
  </div>
}
