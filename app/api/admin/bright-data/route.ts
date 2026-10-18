import { env } from "cloudflare:workers"
import { and, desc, eq, gte, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, providerCollectionAttempts, providerResponseHistory } from "@/db/schema"
import { BrightDataClient, BrightDataProviderError } from "@/lib/brightdata-client"
import { BRIGHTDATA_OPERATION, createBrightConfirmation, normalizeBrightLinkedinUrl, normalizeBrightProfile, sanitizedBrightEvidence, targetFingerprint, verifyBrightConfirmation, type NormalizedBrightProfile } from "@/lib/brightdata-collection"
import { brightDataDatasetId, brightDataMockTransportEnabled, brightDataRuntimeStatus, brightDataSecret } from "@/lib/provider-runtime"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { classifyCurrentTitle } from "@/lib/seniority-classifier"

type AttemptRow = typeof providerCollectionAttempts.$inferSelect
const TERMINAL = new Set(["EVIDENCE_STORED", "REVIEW_REQUIRED", "FAILED_BEFORE_TRIGGER", "TRIGGER_OUTCOME_UNKNOWN", "FAILED_AFTER_TRIGGER", "BLOCKED"])
function now() { return new Date().toISOString() }
function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }
function confirmationSecret() { return process.env.AUTH_SESSION_SECRET?.trim() ?? "" }
function client() { return new BrightDataClient({ token: brightDataSecret(), datasetId: brightDataDatasetId() }) }
function parseEvidence(value: string) {
  if (!value) return null
  try { return JSON.parse(value) as unknown } catch { return { unavailable: true, reason: "Stored evidence could not be parsed." } }
}
function publicAttempt(row: AttemptRow) {
  return {
    id: row.id, alumnusId: row.alumnusId, targetReference: row.targetReference,
    datasetId: row.datasetId ? "configured" : "missing", providerJobId: row.providerJobId,
    generation: row.generation, status: row.status, lastStatusCheckAt: row.lastStatusCheckAt,
    completedAt: row.completedAt, errorCategory: row.errorCategory, usageState: row.usageState,
    providerReportedUsage: row.providerReportedUsage, evidenceJson: parseEvidence(row.evidenceJson),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

async function capacity() {
  const runtime = brightDataRuntimeStatus()
  const [usage] = await getDb().select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, "brightdata"), gte(providerResponseHistory.createdAt, monthStart())))
  const [attempts] = await getDb().select({ used: sql<number>`count(*)` }).from(providerCollectionAttempts).where(and(eq(providerCollectionAttempts.provider, "brightdata"), gte(providerCollectionAttempts.createdAt, monthStart())))
  const used = Math.max(Number(usage?.used ?? 0), Number(attempts?.used ?? 0))
  return { used, limit: runtime.applicationRequestLimit, remaining: Math.max(0, runtime.applicationRequestLimit - used) }
}

async function runtimeState() {
  const runtime = brightDataRuntimeStatus()
  return { ...runtime, applicationBudget: await capacity(), maximumTargets: 1, automaticRetries: 0, automaticPolling: false, providerBillingKnown: false }
}

async function findAttempt(id: number) {
  const [attempt] = await getDb().select().from(providerCollectionAttempts).where(and(eq(providerCollectionAttempts.id, id), eq(providerCollectionAttempts.provider, "brightdata"))).limit(1)
  if (!attempt) throw new Error("Bright Data collection attempt not found.")
  return attempt
}

async function targetAlumnusBlocker(alumnusId: number | null, profileUrl: string) {
  if (!alumnusId) return ""
  const [person] = await getDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
  if (!person) return "The selected Corporate Network alumnus does not exist."
  try {
    if (!person.linkedinUrl || normalizeBrightLinkedinUrl(person.linkedinUrl) !== profileUrl) return "The target URL does not exactly match the selected alumnus's stored LinkedIn identity."
  } catch { return "The selected alumnus does not have a valid stored LinkedIn profile identity." }
  return ""
}

async function guardedUpdate(attempt: AttemptRow, allowedStatuses: string[], setClause: string, bindings: unknown[]) {
  const placeholders = allowedStatuses.map(() => "?").join(",")
  const result = await env.DB.prepare(`UPDATE provider_collection_attempts SET ${setClause}, updated_at=? WHERE id=? AND provider='brightdata' AND generation=? AND status IN (${placeholders})`).bind(...bindings, now(), attempt.id, attempt.generation, ...allowedStatuses).run() as { meta: { changes?: number } }
  if (result.meta.changes !== 1) throw new Error("The Bright Data attempt changed concurrently. Reload its current state.")
}

function mockProfile(profileUrl: string) {
  return { id: "bright-mock-profile", name: "Synthetic Bright Review Candidate", url: profileUrl, location: "Bengaluru, India", experience: [{ company_name: "Synthetic Employer", company_id: "bright-company-1", title: "Director", start_date: "2025-01", is_current: true }], education: [{ school: "Indian Institute of Management Lucknow", end_year: 2011 }] }
}

async function triggerProvider(profileUrl: string, attemptId: number) {
  if (brightDataMockTransportEnabled()) return `mock-snapshot-${attemptId}`
  return client().triggerProfile(profileUrl)
}
async function providerProgress(attempt: AttemptRow) {
  if (brightDataMockTransportEnabled()) return { status: attempt.status === "SNAPSHOT_PENDING" ? "running" as const : "ready" as const }
  return client().progress(attempt.providerJobId)
}
async function providerDownload(attempt: AttemptRow) {
  if (brightDataMockTransportEnabled()) return [mockProfile(attempt.targetReference)]
  return client().download(attempt.providerJobId)
}

async function persistEvidence(attempt: AttemptRow, profile: NormalizedBrightProfile, actor: string) {
  const db = getDb()
  let linkedAlumnus: typeof alumni.$inferSelect | undefined
  if (attempt.alumnusId) [linkedAlumnus] = await db.select().from(alumni).where(eq(alumni.id, attempt.alumnusId)).limit(1)
  let canonicalUrlMatches = false
  let returnedUrlMatches = !profile.returnedUrl
  try { canonicalUrlMatches = Boolean(linkedAlumnus?.linkedinUrl) && normalizeBrightLinkedinUrl(linkedAlumnus!.linkedinUrl) === attempt.targetReference } catch { canonicalUrlMatches = false }
  try { returnedUrlMatches = !profile.returnedUrl || normalizeBrightLinkedinUrl(profile.returnedUrl) === attempt.targetReference } catch { returnedUrlMatches = false }
  const identityVerified = Boolean(linkedAlumnus && canonicalUrlMatches && returnedUrlMatches)
  const source = `Bright Data snapshot ${attempt.providerJobId}`
  const evidence = profile.experience.map(position => db.insert(alumniEmploymentEvidence).values({
    alumnusId: identityVerified ? linkedAlumnus!.id : null, evidenceSource: "Bright Data Web Scraper API", providerEmployeeId: profile.providerProfileId,
    providerResponseId: attempt.resultProviderHistoryId, stableCompanyId: position.companyId, originalCompanyName: position.company || "Not returned",
    originalJobTitle: position.title || "Not returned", normalizedJobTitle: position.title ? classifyCurrentTitle(position.title, position.company).state : "UNCLASSIFIED",
    startDate: position.startDate, endDate: position.endDate, isCurrent: position.current, isDeleted: false, observedAt: now(), evidenceVersion: "1",
    verificationStatus: "UNVERIFIED", reviewerStatus: "PENDING",
  }).onConflictDoNothing())
  const proposals: Array<{ field: string; oldValue: string; proposedValue: string }> = []
  if (identityVerified && linkedAlumnus) {
    if (profile.currentCompany && profile.currentCompany !== linkedAlumnus.company) proposals.push({ field: "company", oldValue: linkedAlumnus.company, proposedValue: profile.currentCompany })
    if (profile.currentTitle && profile.currentTitle !== linkedAlumnus.title) proposals.push({ field: "title", oldValue: linkedAlumnus.title, proposedValue: profile.currentTitle })
    if (profile.location && profile.location !== linkedAlumnus.location) proposals.push({ field: "location", oldValue: linkedAlumnus.location, proposedValue: profile.location })
  }
  const mutationKey = `brightdata:${attempt.id}:evidence`
  const proposalWrites = proposals.map(item => db.insert(alumniProfileChangeProposals).values({ alumnusId: linkedAlumnus!.id, field: item.field, oldValue: item.oldValue, proposedValue: item.proposedValue, source, expectedRecordVersion: linkedAlumnus!.recordVersion, proposedBy: actor, mutationRequestKey: mutationKey }).onConflictDoNothing())
  if (evidence.length || proposalWrites.length) await db.batch([...evidence, ...proposalWrites] as unknown as Parameters<typeof db.batch>[0])
  return { identityVerified, linkedAlumnusId: identityVerified ? linkedAlumnus!.id : null, proposalsCreated: proposals.length, reviewState: identityVerified ? "REVIEW_REQUIRED" : "IDENTITY_UNRESOLVED" }
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const attempts = await getDb().select().from(providerCollectionAttempts).where(eq(providerCollectionAttempts.provider, "brightdata")).orderBy(desc(providerCollectionAttempts.id)).limit(25)
    return Response.json({ runtime: await runtimeState(), attempts: attempts.map(publicAttempt) })
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: "Unable to load Bright Data readiness." }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const payload = await request.json() as { action?: "preflight" | "trigger" | "status" | "retrieve"; profileUrl?: string; alumnusId?: number | null; confirmationToken?: string; confirmed?: boolean; attemptId?: number }
    if (payload.action === "preflight") {
      const profileUrl = normalizeBrightLinkedinUrl(payload.profileUrl ?? "")
      const alumnusId = Number.isInteger(payload.alumnusId) ? payload.alumnusId! : null
      const runtime = await runtimeState()
      const blockers = [!runtime.configured ? "Bright Data server credential and dataset are required." : "", !runtime.executionGateEnabled ? "The local Bright Data execution gate is disabled." : "", runtime.entitlement !== "confirmed" ? `Bright Data access entitlement is ${runtime.entitlement}.` : "", runtime.applicationBudget.remaining < 1 ? "The Bright Data application request allowance is exhausted." : "", await targetAlumnusBlocker(alumnusId, profileUrl)].filter(Boolean)
      const confirmation = blockers.length ? null : createBrightConfirmation({ actorUserId: context.userId, profileUrl, alumnusId }, confirmationSecret())
      return Response.json({ allowed: blockers.length === 0, blockers, profileUrl, runtime, confirmationToken: confirmation?.token ?? "", requestKey: confirmation?.confirmation.requestKey ?? "" })
    }
    if (payload.action === "trigger") {
      if (!payload.confirmed || !payload.confirmationToken) return Response.json({ error: "Explicit Bright Data collection confirmation is required." }, { status: 400 })
      const confirmation = verifyBrightConfirmation(payload.confirmationToken, context.userId, confirmationSecret())
      if (!confirmation) return Response.json({ error: "The Bright Data confirmation is invalid or expired." }, { status: 409 })
      const identityBlocker = await targetAlumnusBlocker(confirmation.alumnusId, confirmation.profileUrl)
      if (identityBlocker) return Response.json({ error: identityBlocker }, { status: 409 })
      const runtime = await runtimeState()
      if (!runtime.configured || !runtime.executionGateEnabled || runtime.entitlement !== "confirmed" || runtime.applicationBudget.remaining < 1) return Response.json({ error: "Bright Data execution is blocked by current readiness, entitlement or application budget." }, { status: 409 })
      const fingerprint = targetFingerprint(confirmation.profileUrl)
      const claimed = await env.DB.prepare(`INSERT OR IGNORE INTO provider_collection_attempts (provider,operation,actor_user_id,alumnus_id,target_reference,target_fingerprint,request_key,dataset_id,status,usage_state) SELECT 'brightdata',?,?,?,?,?,?,?,'CLAIMED','not_applicable' WHERE (SELECT count(*) FROM provider_collection_attempts WHERE provider='brightdata' AND created_at>=?) < ? RETURNING id,generation`).bind(BRIGHTDATA_OPERATION, context.userId, confirmation.alumnusId, confirmation.profileUrl, fingerprint, confirmation.requestKey, brightDataDatasetId(), monthStart(), runtime.applicationBudget.limit).first<{ id: number; generation: number }>()
      if (!claimed) {
        const [existing] = await getDb().select().from(providerCollectionAttempts).where(eq(providerCollectionAttempts.requestKey, confirmation.requestKey)).limit(1)
        if (existing) return Response.json({ attempt: publicAttempt(existing), replayed: true, providerCallMade: false })
        const [active] = await getDb().select().from(providerCollectionAttempts).where(and(eq(providerCollectionAttempts.provider, "brightdata"), eq(providerCollectionAttempts.targetFingerprint, fingerprint), sql`${providerCollectionAttempts.status} in ('CLAIMED', 'TRIGGER_IN_PROGRESS', 'SNAPSHOT_PENDING', 'SNAPSHOT_RUNNING', 'SNAPSHOT_READY', 'RESULT_RETRIEVED')`)).limit(1)
        if (active) return Response.json({ attempt: publicAttempt(active), replayed: true, providerCallMade: false, reason: "An active collection already exists for this profile." })
        return Response.json({ error: "The Bright Data request could not be claimed because the application allowance is exhausted or another request won the concurrency fence." }, { status: 409 })
      }
      let attempt = await findAttempt(claimed.id)
      const [history] = await getDb().insert(providerResponseHistory).values({ provider: "brightdata", alumnusId: confirmation.alumnusId, alumnusName: confirmation.alumnusId ? `Alumnus ${confirmation.alumnusId}` : "Unresolved Bright Data target", operation: BRIGHTDATA_OPERATION, mode: runtime.mode, status: "in_progress", requestSummary: "One explicitly confirmed LinkedIn profile target", responseSummary: "Durable claim created; trigger not yet completed.", requestedBy: context.displayName }).returning()
      await guardedUpdate(attempt, ["CLAIMED"], "status='TRIGGER_IN_PROGRESS', result_provider_history_id=?", [history.id])
      attempt = await findAttempt(attempt.id)
      try {
        const snapshotId = await triggerProvider(attempt.targetReference, attempt.id)
        await guardedUpdate(attempt, ["TRIGGER_IN_PROGRESS"], "status='SNAPSHOT_PENDING', provider_job_id=?, usage_state='reconciliation_required'", [snapshotId])
        await getDb().update(providerResponseHistory).set({ status: "submitted", applicationUnits: 1, usageState: "reconciliation_required", responseSummary: "Bright Data returned a durable snapshot ID. Status retrieval requires a separate operator action." }).where(eq(providerResponseHistory.id, history.id))
      } catch (error) {
        const providerError = error instanceof BrightDataProviderError ? error : new BrightDataProviderError("Bright Data trigger failed.")
        const ambiguous = ["transport_ambiguous", "trigger_outcome_ambiguous"].includes(providerError.category)
        await guardedUpdate(attempt, ["TRIGGER_IN_PROGRESS"], "status=?, error_category=?, usage_state='reconciliation_required'", [ambiguous ? "TRIGGER_OUTCOME_UNKNOWN" : "FAILED_AFTER_TRIGGER", providerError.category])
        await getDb().update(providerResponseHistory).set({ status: ambiguous ? "ambiguous" : "error", applicationUnits: 1, usageState: "reconciliation_required", errorMessage: providerError.message, responseSummary: ambiguous ? "Trigger outcome is unknown. Automatic re-trigger is prohibited." : "Provider rejected the bounded trigger. No retry was made." }).where(eq(providerResponseHistory.id, history.id))
      }
      attempt = await findAttempt(attempt.id)
      await writeSecurityAudit(context, { action: "brightdata_collection_triggered", entityType: "provider_collection_attempt", entityId: attempt.id, metadata: { status: attempt.status, providerCalls: 1, automaticRetries: 0, canonicalMutations: 0 } })
      return Response.json({ attempt: publicAttempt(attempt), replayed: false, providerCallMade: true })
    }
    if (!Number.isInteger(payload.attemptId)) return Response.json({ error: "A valid Bright Data attempt is required." }, { status: 400 })
    let attempt = await findAttempt(payload.attemptId!)
    if (payload.action === "status") {
      if (!["SNAPSHOT_PENDING", "SNAPSHOT_RUNNING"].includes(attempt.status) || !attempt.providerJobId) return Response.json({ error: "This attempt is not awaiting provider status." }, { status: 409 })
      const progress = await providerProgress(attempt)
      const next = progress.status === "ready" ? "SNAPSHOT_READY" : progress.status === "failed" ? "FAILED_AFTER_TRIGGER" : progress.status === "running" ? "SNAPSHOT_RUNNING" : "SNAPSHOT_PENDING"
      await guardedUpdate(attempt, ["SNAPSHOT_PENDING", "SNAPSHOT_RUNNING"], "status=?, last_status_check_at=?, error_category=?", [next, now(), progress.status === "failed" ? "provider_job_failed" : ""])
      attempt = await findAttempt(attempt.id)
      return Response.json({ attempt: publicAttempt(attempt), providerCallMade: true, triggerCallMade: false })
    }
    if (payload.action === "retrieve") {
      if (TERMINAL.has(attempt.status) && attempt.evidenceJson) return Response.json({ attempt: publicAttempt(attempt), replayed: true, providerCallMade: false })
      let profile: NormalizedBrightProfile
      let providerCallMade = false
      if (attempt.status === "RESULT_RETRIEVED" && attempt.evidenceJson) profile = JSON.parse(attempt.evidenceJson) as NormalizedBrightProfile
      else {
        if (attempt.status !== "SNAPSHOT_READY" || !attempt.providerJobId) return Response.json({ error: "The Bright Data snapshot is not ready for retrieval." }, { status: 409 })
        const records = await providerDownload(attempt)
        providerCallMade = true
        if (records.length !== 1) throw new BrightDataProviderError(`Expected one Bright Data profile result; received ${records.length}.`, 502, "unexpected_result_count")
        profile = normalizeBrightProfile(records[0], attempt.targetReference)
        const evidenceJson = sanitizedBrightEvidence(profile)
        await guardedUpdate(attempt, ["SNAPSHOT_READY"], "status='RESULT_RETRIEVED', evidence_json=?", [evidenceJson])
        attempt = await findAttempt(attempt.id)
      }
      const persisted = await persistEvidence(attempt, profile, context.displayName)
      await guardedUpdate(attempt, ["RESULT_RETRIEVED"], "status=?, completed_at=?", [persisted.identityVerified ? "REVIEW_REQUIRED" : "EVIDENCE_STORED", now()])
      if (attempt.resultProviderHistoryId) await getDb().update(providerResponseHistory).set({ status: "success", resultCount: 1, responseSummary: `Bright Data professional evidence retained. ${persisted.reviewState}. Canonical mutations: 0.` }).where(eq(providerResponseHistory.id, attempt.resultProviderHistoryId))
      attempt = await findAttempt(attempt.id)
      await writeSecurityAudit(context, { action: "brightdata_evidence_retained", entityType: "provider_collection_attempt", entityId: attempt.id, metadata: { ...persisted, canonicalMutations: 0 } })
      return Response.json({ attempt: publicAttempt(attempt), persisted, providerCallMade })
    }
    return Response.json({ error: "Unsupported Bright Data action." }, { status: 400 })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    const message = error instanceof Error ? error.message : "Bright Data operation failed."
    return Response.json({ error: message.includes("Bearer") ? "Bright Data authentication failed." : message }, { status: error instanceof BrightDataProviderError ? error.status : 400 })
  }
}
