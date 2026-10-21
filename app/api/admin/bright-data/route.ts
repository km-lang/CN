import { env } from "cloudflare:workers"
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, brightdataSnapshotEvidence, providerCollectionAttempts, providerResponseHistory, securityAuditEvents } from "@/db/schema"
import { BrightDataClient, BrightDataProviderError } from "@/lib/brightdata-client"
import { BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION, BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY, BRIGHTDATA_OPERATION, brightProfileChanges, createBrightConfirmation, humanTrialRequestKey, normalizeBrightLinkedinUrl, normalizeBrightProfile, prepareBrightRawEvidence, sanitizedBrightEvidence, targetFingerprint, verifyBrightConfirmation, type NormalizedBrightProfile } from "@/lib/brightdata-collection"
import { brightDataDatasetId, brightDataHumanTrialTarget, brightDataMockTransportEnabled, brightDataRuntimeStatus, brightDataSecret } from "@/lib/provider-runtime"
import { accessErrorResponse, authorizeRequest, safeAuditMetadata, writeSecurityAudit, type SecurityContext } from "@/lib/security"
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
type SnapshotMetadata = Pick<typeof brightdataSnapshotEvidence.$inferSelect, "attemptId" | "returnedUrl" | "canonicalReturnedUrl" | "identityUrlStatus" | "requestedAt" | "retrievedAt" | "providerTimestampJson" | "normalizerVersion" | "rawSha256" | "retentionUntil">
function publicAttempt(row: AttemptRow, snapshot?: SnapshotMetadata) {
  return {
    id: row.id, alumnusId: row.alumnusId, targetReference: row.targetReference,
    datasetId: row.datasetId ? "configured" : "missing", providerJobId: row.providerJobId,
    generation: row.generation, status: row.status, lastStatusCheckAt: row.lastStatusCheckAt,
    completedAt: row.completedAt, errorCategory: row.errorCategory, usageState: row.usageState,
    providerReportedUsage: row.providerReportedUsage, evidenceJson: parseEvidence(row.evidenceJson),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    rawEvidenceStored: Boolean(snapshot), identityUrlStatus: snapshot?.identityUrlStatus ?? "UNVERIFIED", originalReturnedUrl: snapshot?.returnedUrl ?? "", canonicalReturnedUrl: snapshot?.canonicalReturnedUrl ?? "",
    providerTimestamp: snapshot?.providerTimestampJson ? JSON.parse(snapshot.providerTimestampJson) as unknown : null, evidenceRequestedAt: snapshot?.requestedAt ?? "", evidenceRetrievedAt: snapshot?.retrievedAt ?? "",
    normalizerVersion: snapshot?.normalizerVersion ?? null, rawSha256: snapshot?.rawSha256 ?? "", rawRetentionUntil: snapshot?.retentionUntil ?? "",
  }
}

async function snapshotMetadata(attemptId: number) {
  const [snapshot] = await getDb().select({ attemptId: brightdataSnapshotEvidence.attemptId, returnedUrl: brightdataSnapshotEvidence.returnedUrl, canonicalReturnedUrl: brightdataSnapshotEvidence.canonicalReturnedUrl,
    identityUrlStatus: brightdataSnapshotEvidence.identityUrlStatus, requestedAt: brightdataSnapshotEvidence.requestedAt, retrievedAt: brightdataSnapshotEvidence.retrievedAt,
    providerTimestampJson: brightdataSnapshotEvidence.providerTimestampJson, normalizerVersion: brightdataSnapshotEvidence.normalizerVersion, rawSha256: brightdataSnapshotEvidence.rawSha256, retentionUntil: brightdataSnapshotEvidence.retentionUntil })
    .from(brightdataSnapshotEvidence).where(eq(brightdataSnapshotEvidence.attemptId, attemptId)).limit(1)
  return snapshot
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

async function eligibleHumanTrial(context: SecurityContext, profileUrl: string, auditId?: number) {
  const runtime = brightDataRuntimeStatus()
  if (!runtime.humanTrialEnabled || runtime.mode !== "live" || runtime.entitlement !== "unknown") return null
  try { if (normalizeBrightLinkedinUrl(brightDataHumanTrialTarget()) !== profileUrl) return null } catch { return null }
  const [audit] = await getDb().select().from(securityAuditEvents).where(eq(securityAuditEvents.mutationRequestKey, BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY)).limit(1)
  if (!audit || (auditId !== undefined && audit.id !== auditId) || audit.action !== BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION || audit.actorRole !== "ADMIN" || audit.actorUserId !== context.userId) return null
  let metadata: Record<string, unknown>
  try { metadata = JSON.parse(audit.metadataJson) as Record<string, unknown> } catch { return null }
  if (metadata.attestationSource !== "dashboard" || metadata.datasetId !== brightDataDatasetId() || metadata.profileUrl !== profileUrl || metadata.requestQuantity !== 1 || metadata.confirmationStatus !== "AWAITING_SEPARATE_TRIGGER_APPROVAL" || metadata.billingUncertainty !== "actual_account_charge_unverified") return null
  const [used] = await getDb().select({ id: providerCollectionAttempts.id }).from(providerCollectionAttempts).where(eq(providerCollectionAttempts.requestKey, humanTrialRequestKey(audit.id))).limit(1)
  return used ? null : audit
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
  returnedUrlMatches = profile.identityUrlStatus === "MATCH"
  const identityVerified = Boolean(linkedAlumnus && canonicalUrlMatches && returnedUrlMatches)
  const source = `Bright Data snapshot ${attempt.providerJobId}`
  const evidence = profile.experience.map(position => db.insert(alumniEmploymentEvidence).values({
    alumnusId: identityVerified ? linkedAlumnus!.id : null, evidenceSource: "Bright Data Web Scraper API", providerEmployeeId: profile.providerProfileId,
    providerResponseId: attempt.resultProviderHistoryId, stableCompanyId: position.companyId, originalCompanyName: position.company || "Not returned",
    originalJobTitle: position.title || "Not returned", normalizedJobTitle: position.title ? classifyCurrentTitle(position.title, position.company).state : "UNCLASSIFIED",
    startDate: position.startDate, endDate: position.endDate, isCurrent: position.current, isDeleted: false, observedAt: now(), evidenceVersion: "1",
    verificationStatus: "UNVERIFIED", reviewerStatus: "PENDING",
  }).onConflictDoNothing())
  const proposals = identityVerified && linkedAlumnus ? brightProfileChanges(profile, linkedAlumnus) : []
  const mutationKey = `brightdata:${attempt.id}:evidence`
  const proposalWrites = proposals.map(item => db.insert(alumniProfileChangeProposals).values({ alumnusId: linkedAlumnus!.id, field: item.field, oldValue: item.oldValue, proposedValue: item.proposedValue, source, expectedRecordVersion: linkedAlumnus!.recordVersion, proposedBy: actor, mutationRequestKey: mutationKey }).onConflictDoNothing())
  if (evidence.length || proposalWrites.length) await db.batch([...evidence, ...proposalWrites] as unknown as Parameters<typeof db.batch>[0])
  return { identityVerified, linkedAlumnusId: identityVerified ? linkedAlumnus!.id : null, proposalsCreated: proposals.length, reviewState: !identityVerified ? "IDENTITY_UNRESOLVED" : proposals.length ? "REVIEW_REQUIRED" : "NO_CHANGE" }
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const attempts = await getDb().select().from(providerCollectionAttempts).where(eq(providerCollectionAttempts.provider, "brightdata")).orderBy(desc(providerCollectionAttempts.id)).limit(25)
    const metadata = attempts.length ? await getDb().select({ attemptId: brightdataSnapshotEvidence.attemptId, returnedUrl: brightdataSnapshotEvidence.returnedUrl, canonicalReturnedUrl: brightdataSnapshotEvidence.canonicalReturnedUrl,
      identityUrlStatus: brightdataSnapshotEvidence.identityUrlStatus, requestedAt: brightdataSnapshotEvidence.requestedAt, retrievedAt: brightdataSnapshotEvidence.retrievedAt,
      providerTimestampJson: brightdataSnapshotEvidence.providerTimestampJson, normalizerVersion: brightdataSnapshotEvidence.normalizerVersion, rawSha256: brightdataSnapshotEvidence.rawSha256, retentionUntil: brightdataSnapshotEvidence.retentionUntil })
      .from(brightdataSnapshotEvidence).where(inArray(brightdataSnapshotEvidence.attemptId, attempts.map(row => row.id))) : []
    const byAttempt = new Map(metadata.map(item => [item.attemptId, item]))
    return Response.json({ runtime: await runtimeState(), attempts: attempts.map(row => publicAttempt(row, byAttempt.get(row.id))) })
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: "Unable to load Bright Data readiness." }, { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS")
    const payload = await request.json() as { action?: "attest_human_trial" | "preflight" | "trigger" | "status" | "retrieve" | "recover_evidence" | "purge_expired_raw_evidence"; profileUrl?: string; alumnusId?: number | null; datasetId?: string; attestationSource?: string; requestQuantity?: number; billingUncertaintyAcknowledged?: boolean; humanTrial?: boolean; confirmationToken?: string; confirmed?: boolean; attemptId?: number; snapshotId?: string }
    if (payload.action === "attest_human_trial") {
      if (!payload.confirmed || !payload.billingUncertaintyAcknowledged || payload.attestationSource !== "dashboard" || payload.requestQuantity !== 1 || payload.alumnusId !== null || payload.datasetId !== brightDataDatasetId()) return Response.json({ error: "Explicit one-profile dashboard attestation and billing-uncertainty acknowledgement are required." }, { status: 400 })
      const profileUrl = normalizeBrightLinkedinUrl(payload.profileUrl ?? "")
      const runtime = await runtimeState()
      let configuredTarget = ""
      try { configuredTarget = normalizeBrightLinkedinUrl(brightDataHumanTrialTarget()) } catch { /* fail closed */ }
      if (!runtime.humanTrialEnabled || runtime.mode !== "live" || runtime.entitlement !== "unknown" || !runtime.configured || runtime.applicationBudget.remaining < 1 || profileUrl !== configuredTarget) return Response.json({ error: "The isolated one-profile human-trial gate is unavailable for this exact target." }, { status: 409 })
      const attestedAt = now()
      const [audit] = await getDb().insert(securityAuditEvents).values({
        actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role,
        action: BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION, entityType: "brightdata_human_trial", entityId: targetFingerprint(profileUrl),
        metadataJson: safeAuditMetadata({ attestationSource: "dashboard", attestedAt, datasetId: brightDataDatasetId(), profileUrl, requestQuantity: 1, advertisedRate: "USD 1.50 per 1,000 successful records", estimatedOneRecordCostUsd: 0.0015, billingUncertainty: "actual_account_charge_unverified", confirmationStatus: "AWAITING_SEPARATE_TRIGGER_APPROVAL", authorizingActorUserId: context.userId }),
        result: "human_attested_provider_unverified", source: "local_admin_dashboard", mutationRequestKey: BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY,
      }).onConflictDoNothing().returning({ id: securityAuditEvents.id })
      if (!audit) return Response.json({ error: "The one-time dashboard attestation already exists; it cannot be issued twice." }, { status: 409 })
      return Response.json({ attested: true, attestationId: audit.id, profileUrl, datasetId: brightDataDatasetId(), entitlementBasis: "HUMAN_ATTESTED_PROVIDER_UNVERIFIED", confirmationStatus: "AWAITING_SEPARATE_TRIGGER_APPROVAL", providerCallMade: false })
    }
    if (payload.action === "preflight") {
      const profileUrl = normalizeBrightLinkedinUrl(payload.profileUrl ?? "")
      const alumnusId = Number.isInteger(payload.alumnusId) ? payload.alumnusId! : null
      const runtime = await runtimeState()
      const humanAudit = payload.humanTrial === true && alumnusId === null ? await eligibleHumanTrial(context, profileUrl) : null
      const humanApproved = Boolean(humanAudit)
      const blockers = [!runtime.configured ? "Bright Data server credential and dataset are required." : "", !runtime.executionGateEnabled ? "The local Bright Data execution gate is disabled." : "", runtime.entitlement !== "confirmed" && !humanApproved ? `Bright Data access entitlement is ${runtime.entitlement}; no eligible one-time human attestation applies.` : "", payload.humanTrial === true && !humanApproved ? "The exact isolated Admin dashboard attestation is missing, invalid or already used." : "", runtime.applicationBudget.remaining < 1 ? "The Bright Data application request allowance is exhausted." : "", await targetAlumnusBlocker(alumnusId, profileUrl)].filter(Boolean)
      const confirmation = blockers.length ? null : createBrightConfirmation({ actorUserId: context.userId, profileUrl, alumnusId, ...(humanAudit ? { humanTrialAuditId: humanAudit.id } : {}) }, confirmationSecret())
      return Response.json({ allowed: blockers.length === 0, blockers, profileUrl, runtime, entitlementBasis: humanApproved ? "HUMAN_ATTESTED_PROVIDER_UNVERIFIED" : runtime.entitlement === "confirmed" ? "CONFIGURED_CONFIRMED" : "UNKNOWN", humanTrialAuditId: humanAudit?.id ?? null, confirmationToken: confirmation?.token ?? "", requestKey: confirmation?.confirmation.requestKey ?? "" })
    }
    if (payload.action === "trigger") {
      if (!payload.confirmed || !payload.confirmationToken) return Response.json({ error: "Explicit Bright Data collection confirmation is required." }, { status: 400 })
      const confirmation = verifyBrightConfirmation(payload.confirmationToken, context.userId, confirmationSecret())
      if (!confirmation) return Response.json({ error: "The Bright Data confirmation is invalid or expired." }, { status: 409 })
      const identityBlocker = await targetAlumnusBlocker(confirmation.alumnusId, confirmation.profileUrl)
      if (identityBlocker) return Response.json({ error: identityBlocker }, { status: 409 })
      const runtime = await runtimeState()
      const humanAudit = confirmation.humanTrialAuditId ? await eligibleHumanTrial(context, confirmation.profileUrl, confirmation.humanTrialAuditId) : null
      const humanApproved = Boolean(humanAudit) && confirmation.alumnusId === null
      if (!runtime.configured || !runtime.executionGateEnabled || (confirmation.humanTrialAuditId ? !humanApproved : runtime.entitlement !== "confirmed") || runtime.applicationBudget.remaining < 1) return Response.json({ error: "Bright Data execution is blocked by current readiness, entitlement or application budget." }, { status: 409 })
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
      const [history] = await getDb().insert(providerResponseHistory).values({ provider: "brightdata", alumnusId: confirmation.alumnusId, alumnusName: confirmation.alumnusId ? `Alumnus ${confirmation.alumnusId}` : "Unresolved Bright Data target", operation: BRIGHTDATA_OPERATION, mode: runtime.mode, status: "in_progress", requestSummary: humanApproved ? `One human-attested, provider-unverified LinkedIn target; audit ${humanAudit!.id}` : "One explicitly confirmed LinkedIn profile target", responseSummary: "Durable claim created; trigger not yet completed.", requestedBy: context.displayName }).returning()
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
      await writeSecurityAudit(context, { action: "brightdata_collection_triggered", entityType: "provider_collection_attempt", entityId: attempt.id, metadata: { status: attempt.status, providerCalls: 1, automaticRetries: 0, canonicalMutations: 0, humanTrialAuditId: humanAudit?.id ?? null, entitlementBasis: humanApproved ? "HUMAN_ATTESTED_PROVIDER_UNVERIFIED" : "CONFIGURED_CONFIRMED" } })
      return Response.json({ attempt: publicAttempt(attempt), replayed: false, providerCallMade: true })
    }
    if (payload.action === "purge_expired_raw_evidence") {
      if (!payload.confirmed) return Response.json({ error: "Explicit Admin confirmation is required to purge expired raw evidence." }, { status: 400 })
      const expired = await getDb().select({ attemptId: brightdataSnapshotEvidence.attemptId }).from(brightdataSnapshotEvidence).where(lt(brightdataSnapshotEvidence.retentionUntil, now()))
      if (expired.length) await getDb().delete(brightdataSnapshotEvidence).where(lt(brightdataSnapshotEvidence.retentionUntil, now()))
      await writeSecurityAudit(context, { action: "brightdata_raw_evidence_expired_purged", entityType: "brightdata_snapshot_evidence", metadata: { purgedCount: expired.length } })
      return Response.json({ purgedCount: expired.length, providerCallMade: false })
    }
    if (!Number.isInteger(payload.attemptId)) return Response.json({ error: "A valid Bright Data attempt is required." }, { status: 400 })
    let attempt = await findAttempt(payload.attemptId!)
    if (payload.action === "recover_evidence") {
      if (!payload.confirmed || !attempt.providerJobId || payload.snapshotId !== attempt.providerJobId || attempt.alumnusId !== null || !["EVIDENCE_STORED", "REVIEW_REQUIRED"].includes(attempt.status)) return Response.json({ error: "Exact existing unlinked snapshot recovery requires explicit Admin confirmation." }, { status: 409 })
      const priorSnapshot = await snapshotMetadata(attempt.id)
      if (priorSnapshot) return Response.json({ attempt: publicAttempt(attempt, priorSnapshot), replayed: true, providerCallMade: false })
      const records = await providerDownload(attempt)
      if (records.length !== 1) throw new BrightDataProviderError(`Expected one Bright Data profile result; received ${records.length}.`, 502, "unexpected_result_count")
      const profile = normalizeBrightProfile(records[0], attempt.targetReference)
      const normalizedJson = sanitizedBrightEvidence(profile)
      const prepared = prepareBrightRawEvidence(records[0], attempt.providerJobId, attempt.datasetId, attempt.targetReference, attempt.createdAt, now(), normalizedJson)
      const [retained] = await getDb().insert(brightdataSnapshotEvidence).values({ attemptId: attempt.id, ...prepared }).onConflictDoNothing().returning({ attemptId: brightdataSnapshotEvidence.attemptId })
      if (!retained) return Response.json({ error: "Snapshot evidence was retained concurrently; reload the existing attempt before recovery." }, { status: 409 })
      await getDb().update(providerCollectionAttempts).set({ evidenceJson: normalizedJson, updatedAt: now() }).where(and(eq(providerCollectionAttempts.id, attempt.id), eq(providerCollectionAttempts.status, attempt.status)))
      await writeSecurityAudit(context, { action: "brightdata_raw_evidence_recovered", entityType: "provider_collection_attempt", entityId: attempt.id, metadata: { snapshotId: attempt.providerJobId, rawSha256: prepared.rawSha256, normalizerVersion: prepared.normalizerVersion, canonicalMutations: 0, providerCalls: brightDataMockTransportEnabled() ? 0 : 1 } })
      attempt = await findAttempt(attempt.id)
      return Response.json({ attempt: publicAttempt(attempt, await snapshotMetadata(attempt.id)), recovered: true, providerCallMade: !brightDataMockTransportEnabled(), canonicalMutations: 0 })
    }
    if (payload.action === "status") {
      if (!["SNAPSHOT_PENDING", "SNAPSHOT_RUNNING"].includes(attempt.status) || !attempt.providerJobId) return Response.json({ error: "This attempt is not awaiting provider status." }, { status: 409 })
      const progress = await providerProgress(attempt)
      const next = progress.status === "ready" ? "SNAPSHOT_READY" : progress.status === "failed" ? "FAILED_AFTER_TRIGGER" : progress.status === "running" ? "SNAPSHOT_RUNNING" : "SNAPSHOT_PENDING"
      await guardedUpdate(attempt, ["SNAPSHOT_PENDING", "SNAPSHOT_RUNNING"], "status=?, last_status_check_at=?, error_category=?", [next, now(), progress.status === "failed" ? "provider_job_failed" : ""])
      attempt = await findAttempt(attempt.id)
      return Response.json({ attempt: publicAttempt(attempt, await snapshotMetadata(attempt.id)), providerCallMade: true, triggerCallMade: false })
    }
    if (payload.action === "retrieve") {
      if (TERMINAL.has(attempt.status) && attempt.evidenceJson) return Response.json({ attempt: publicAttempt(attempt, await snapshotMetadata(attempt.id)), replayed: true, providerCallMade: false })
      let profile: NormalizedBrightProfile
      let providerCallMade = false
      if (attempt.status === "RESULT_RETRIEVED" && attempt.evidenceJson) profile = JSON.parse(attempt.evidenceJson) as NormalizedBrightProfile
      else {
        if (attempt.status !== "SNAPSHOT_READY" || !attempt.providerJobId) return Response.json({ error: "The Bright Data snapshot is not ready for retrieval." }, { status: 409 })
        const [existingRaw] = await getDb().select({ normalizedJson: brightdataSnapshotEvidence.normalizedJson }).from(brightdataSnapshotEvidence).where(eq(brightdataSnapshotEvidence.attemptId, attempt.id)).limit(1)
        if (existingRaw) profile = JSON.parse(existingRaw.normalizedJson) as NormalizedBrightProfile
        else {
          const records = await providerDownload(attempt)
          providerCallMade = !brightDataMockTransportEnabled()
          if (records.length !== 1) throw new BrightDataProviderError(`Expected one Bright Data profile result; received ${records.length}.`, 502, "unexpected_result_count")
          profile = normalizeBrightProfile(records[0], attempt.targetReference)
          const normalizedJson = sanitizedBrightEvidence(profile)
          const prepared = prepareBrightRawEvidence(records[0], attempt.providerJobId, attempt.datasetId, attempt.targetReference, attempt.createdAt, now(), normalizedJson)
          const [retained] = await getDb().insert(brightdataSnapshotEvidence).values({ attemptId: attempt.id, ...prepared }).onConflictDoNothing().returning({ attemptId: brightdataSnapshotEvidence.attemptId })
          if (!retained) throw new Error("The same snapshot was retained concurrently. Reload the existing attempt before continuing.")
        }
        const evidenceJson = sanitizedBrightEvidence(profile)
        await guardedUpdate(attempt, ["SNAPSHOT_READY"], "status='RESULT_RETRIEVED', evidence_json=?", [evidenceJson])
        attempt = await findAttempt(attempt.id)
      }
      const persisted = await persistEvidence(attempt, profile, context.displayName)
      await guardedUpdate(attempt, ["RESULT_RETRIEVED"], "status=?, completed_at=?", [persisted.proposalsCreated ? "REVIEW_REQUIRED" : "EVIDENCE_STORED", now()])
      if (attempt.resultProviderHistoryId) await getDb().update(providerResponseHistory).set({ status: "success", resultCount: 1, responseSummary: `Bright Data professional evidence retained. ${persisted.reviewState}. Canonical mutations: 0.` }).where(eq(providerResponseHistory.id, attempt.resultProviderHistoryId))
      attempt = await findAttempt(attempt.id)
      await writeSecurityAudit(context, { action: "brightdata_evidence_retained", entityType: "provider_collection_attempt", entityId: attempt.id, metadata: { ...persisted, canonicalMutations: 0 } })
      return Response.json({ attempt: publicAttempt(attempt, await snapshotMetadata(attempt.id)), persisted, providerCallMade })
    }
    return Response.json({ error: "Unsupported Bright Data action." }, { status: 400 })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    const message = error instanceof Error ? error.message : "Bright Data operation failed."
    return Response.json({ error: message.includes("Bearer") ? "Bright Data authentication failed." : message }, { status: error instanceof BrightDataProviderError ? error.status : 400 })
  }
}
