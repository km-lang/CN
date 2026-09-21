"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, ShieldCheck, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiPath } from "@/lib/app-config"
import type { ApplicationRole } from "@/lib/access-types"

type AdminIdentity = { id: number; provider: "google_workspace" | "chatgpt"; verifiedEmail: string; providerDomain: string; lastAuthenticatedAt: string }
type AdminUser = { id: number; externalIdentity: string; displayName: string; email: string; role: ApplicationRole; enabled: boolean; createdAt: string; updatedAt: string; lastLoginAt: string; identities: AdminIdentity[] }
type AuditEvent = { id: number; actorName: string; actorRole: string; action: string; entityType: string; entityId: string; result: string; createdAt: string }
type OperationalReadiness = {
  pdl: { mode: string; configured: boolean }
  lushaContacts: { mode: string; configured: boolean }
  signals: { implementationStatus: string; liveEnabled: boolean; entitlement: "unknown" | "confirmed" | "not_entitled"; lastVerifiedAt: string; verificationSource: string }
  mail: { mode: string; liveEnabled: boolean; provider: string; senderConfigured: boolean; oauthConfigured: boolean; sendPermissionConfigured: boolean; lastValidationStatus: string; lastValidatedAt: string; validationSource: string }
}
type AdminData = { users: AdminUser[]; audit: AuditEvent[]; operationalReadiness?: OperationalReadiness }
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

export function AdminPanel({ alumni }: { alumni: Array<{ id: number; name: string; lifecycle?: string }> }) {
  const [data, setData] = useState<AdminData>({ users: [], audit: [] })
  const [form, setForm] = useState({ displayName: "", email: "", role: "PCOM" as ApplicationRole })
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

  async function action(payload: Record<string, unknown>) {
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
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

  async function authorizeUser(confirmSimilarEmail = false) {
    setLoading(true)
    setMessage("")
    try {
      const response = await fetch(apiPath("/api/admin"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authorize_user", ...form, confirmSimilarEmail }) })
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

  return <div className="admin-workspace">
    <section className="admin-heading"><div><p className="eyebrow">Security administration</p><h2>Users, roles and audit history</h2><span>Access is denied by default. Only active, authorized identities receive application data.</span></div><span className="security-chip"><ShieldCheck /> Server enforced</span></section>
    {message && <div className="enrichment-message"><Activity /><span>{message}</span></div>}

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Authorize a user</h2><span>Authorize the institutional email first. A verified Google Workspace or recovery identity is linked only after successful sign-in.</span></div></div>
      <div className="admin-add-user"><Input placeholder="Display name" value={form.displayName} onChange={event => { setForm({ ...form, displayName: event.target.value }); setSimilarEmailWarning(null) }} /><Input type="email" placeholder="Institutional email" value={form.email} onChange={event => { setForm({ ...form, email: event.target.value }); setSimilarEmailWarning(null) }} /><Select value={form.role} onValueChange={role => setForm({ ...form, role: role as ApplicationRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem><SelectItem value="ADMIN">Admin</SelectItem></SelectContent></Select><Button disabled={loading || !form.email} onClick={() => void authorizeUser()}><UserPlus /> Authorize</Button></div>
      {similarEmailWarning && <div className="admin-similar-warning"><div><strong>Possible similar authorized user found:</strong><span>{similarEmailWarning.similarUser.email}</span><strong>You entered:</strong><span>{similarEmailWarning.enteredEmail}</span><small>Review the address carefully. This warning does not automatically block authorization.</small></div><div><Button variant="outline" disabled={loading} onClick={() => void authorizeUser(true)}>Continue anyway</Button><Button variant="ghost" disabled={loading} onClick={() => setSimilarEmailWarning(null)}>Cancel</Button></div></div>}
      <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Linked sign-in</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{data.users.map(user => <TableRow key={user.id}><TableCell><strong>{user.displayName}</strong><small className="review-status">{user.email}</small></TableCell><TableCell>{user.identities.length ? user.identities.map(identity => <span key={identity.id} className="identity-provider">{identity.provider === "google_workspace" ? "Institutional Google" : "ChatGPT recovery"}<small>{identity.verifiedEmail}</small></span>) : <span className="review-status">Pending first sign-in</span>}</TableCell><TableCell><Select value={user.role} onValueChange={role => void action({ action: "change_role", userId: user.id, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="PCOM">PCOM</SelectItem><SelectItem value="DEVELOPER">Developer</SelectItem></SelectContent></Select></TableCell><TableCell><span className={`history-status ${user.enabled ? "history-success" : "history-blocked"}`}>{user.enabled ? "Active" : "Disabled"}</span></TableCell><TableCell>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Not signed in"}</TableCell><TableCell><Button size="sm" variant="outline" disabled={loading} onClick={() => void action({ action: "set_user_status", userId: user.id, enabled: !user.enabled })}>{user.enabled ? "Disable" : "Enable"}</Button></TableCell></TableRow>)}</TableBody></Table>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Operational readiness</h2><span>Provider gates and authorization are independent. Secret values are never displayed here.</span></div></div>
      <div className="readiness-grid">
        <article><strong>People Data Labs</strong><span>{data.operationalReadiness?.pdl.mode.toUpperCase() ?? "UNKNOWN"}</span><small>{data.operationalReadiness?.pdl.configured ? "API key configured" : "API key missing"}</small></article>
        <article><strong>Lusha Contacts</strong><span>{data.operationalReadiness?.lushaContacts.mode.toUpperCase() ?? "UNKNOWN"}</span><small>{data.operationalReadiness?.lushaContacts.configured ? "Contact API configured" : "Contact API key missing"}</small></article>
        <article><strong>Lusha Professional Signals</strong><span>{data.operationalReadiness?.signals.liveEnabled && data.operationalReadiness.signals.entitlement === "confirmed" ? "LIVE" : data.operationalReadiness?.signals.entitlement === "not_entitled" ? "OFF · NOT ENTITLED" : "OFF · READY"}</span><small>Implementation: {data.operationalReadiness?.signals.implementationStatus ?? "unknown"} · Gate: {data.operationalReadiness?.signals.liveEnabled ? "enabled" : "disabled"} · Entitlement: {(data.operationalReadiness?.signals.entitlement ?? "unknown").replaceAll("_", " ")}</small><small>Last verification: {data.operationalReadiness?.signals.lastVerifiedAt || "Not verified"}{data.operationalReadiness?.signals.verificationSource ? ` · ${data.operationalReadiness.signals.verificationSource}` : ""}</small><Button size="sm" variant="outline" disabled={loading || !data.operationalReadiness?.lushaContacts.configured} onClick={() => void validateSignalsEntitlement()}>{loading ? "Validating…" : "Validate Signals Entitlement"}</Button><small>Checks contact signal types once using the server-side key. No person lookup. Signals remain OFF.</small>{signalsValidation && <div role="status" className="signals-entitlement-result"><strong>Validation: {signalsValidation.entitlement.replaceAll("_", " ")}</strong><small>Provider outcome: {signalsValidation.outcome.replaceAll("_", " ")} · HTTP: {signalsValidation.httpStatus ?? "unavailable"} · {new Date(signalsValidation.checkedAt).toLocaleString()}</small><small>Promotion: {signalsValidation.promotionAvailable ? "available" : "not confirmed"} · Company/job change: {signalsValidation.companyChangeAvailable ? "available" : "not confirmed"}</small><small>Recognized contact types: {signalsValidation.signalTypes.join(", ") || "unavailable"}</small><small>Provider-reported usage: {signalsValidation.providerReportedCredits === null ? "Not reported (do not assume zero)" : `${signalsValidation.providerReportedCredits} credits`}. Account balance was not queried.</small>{signalsValidation.entitlement === "confirmed" && <small>For later manual activation through Sites: LUSHA_SIGNALS_ENTITLEMENT=confirmed, LUSHA_SIGNALS_LIVE_ENABLED=true, LUSHA_SIGNALS_ENTITLEMENT_VERIFIED_AT={signalsValidation.checkedAt}, LUSHA_SIGNALS_ENTITLEMENT_SOURCE=Lusha V3 contact signal types. This validation changes none of these settings.</small>}</div>}</article>
        <article><strong>Institutional Mail</strong><span>{data.operationalReadiness?.mail.mode === "live" ? "LIVE" : data.operationalReadiness?.mail.senderConfigured && data.operationalReadiness?.mail.oauthConfigured && data.operationalReadiness?.mail.sendPermissionConfigured ? "OFF · READY" : "OFF"}</span><small>Mode: {data.operationalReadiness?.mail.mode.toUpperCase() ?? "MOCK"} · Sender: {data.operationalReadiness?.mail.senderConfigured ? "configured" : "missing"} · OAuth: {data.operationalReadiness?.mail.oauthConfigured ? "configured" : "missing"} · Gmail send permission: {data.operationalReadiness?.mail.sendPermissionConfigured ? "confirmed" : "not confirmed"} · Gate: {data.operationalReadiness?.mail.liveEnabled ? "enabled" : "disabled"}</small><small>Last connectivity validation: {data.operationalReadiness?.mail.lastValidationStatus ?? "Not validated"}{data.operationalReadiness?.mail.lastValidatedAt ? ` · ${data.operationalReadiness.mail.lastValidatedAt}` : ""}{data.operationalReadiness?.mail.validationSource ? ` · ${data.operationalReadiness.mail.validationSource}` : ""}</small></article>
      </div>
      <p className="section-help">Change runtime provider and mail configuration only through authorized Sites environment controls. PCOM users cannot view or change these settings.</p>
    </section>

    <section className="panel admin-section">
      <div className="panel-heading"><div><h2>Production data maintenance</h2><span>Remove only records classified through explicit mock, demo, seed or mock-provider markers. Live provider evidence and security records are excluded.</span></div><Button variant="outline" disabled={loading} onClick={() => void previewMockCleanup()}><Activity /> Preview cleanup</Button></div>
      {cleanupPreview && <div className="admin-similar-warning">
        <div>
          <strong>Records identified for removal</strong>
          <span>{cleanupPreview.counts.alumni} alumni · {cleanupPreview.counts.companies} companies · {cleanupPreview.counts.engagementOutreach} engagement/outreach · {cleanupPreview.counts.providerHistory + cleanupPreview.counts.providerSearches + cleanupPreview.counts.providerResults + cleanupPreview.counts.providerReviews + cleanupPreview.counts.fieldChanges} provider/history</span>
          <strong>Protected live evidence</strong>
          <span>{cleanupPreview.retained.liveDiscoveryResults} review results · {cleanupPreview.retained.liveSearchCredits} Search credits</span>
          {cleanupIntegrity && <><strong>Database checks</strong><span>Quick check: {cleanupIntegrity.integrity.map(row => row.integrity_check).join(", ") || "unavailable"} · Foreign-key violations: {cleanupIntegrity.foreignKeys.length}</span></>}
          {cleanupPreview.ambiguous.length > 0 && <><strong>Ambiguous records</strong>{cleanupPreview.ambiguous.map(item => <span key={item}>{item}</span>)}</>}
        </div>
        {cleanupPreview.ambiguous.length === 0 && <div className="anonymize-confirm">
          <Input value={cleanupConfirmation} onChange={event => setCleanupConfirmation(event.target.value)} placeholder="REMOVE MOCK DATASET" />
          <Button variant="destructive" disabled={loading || cleanupConfirmation !== "REMOVE MOCK DATASET"} onClick={() => void removeMockDataset()}><Trash2 /> Remove mock data</Button>
          <Button variant="ghost" onClick={() => { setCleanupPreview(null); setCleanupConfirmation("") }}>Cancel</Button>
        </div>}
      </div>}
      {cleanupResult && <div className="admin-similar-warning"><div><strong>Cleanup completed</strong><span>{cleanupResult.removed.alumni} alumni removed · {cleanupResult.final.alumni} internal alumni remain</span><span>{cleanupResult.retained.liveDiscoveryResults} live review results retained · {cleanupResult.retained.liveSearchCredits} Search credits retained</span><span>Integrity: {cleanupResult.final.integrity.map(row => row.integrity_check).join(", ")} · Foreign-key violations: {cleanupResult.final.foreignKeys.length}</span></div></div>}
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
