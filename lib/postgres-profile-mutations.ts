import { and, eq, sql } from "drizzle-orm"
import type { PostgresDatabase } from "@/db/postgres/adapter"
import { alumni, alumniProfileChangeProposals, coresignalWebhookEvents, fieldChangeHistory, mutationCommitGuards, mutationRequests, securityAuditEvents } from "@/db/postgres/schema"
import { planProfileUpdate } from "@/lib/alumni-profile-update"
import { mutationConflictResponse, mutationIdentity, mutationPendingResponse, replayMutationResponse } from "@/lib/mutation-idempotency"
import type { MutationIdentity } from "@/lib/mutation-idempotency"
import type { SecurityContext } from "@/lib/security"
import { safeAuditMetadata } from "@/lib/security-policy"

type ProfilePatch = { expectedVersion?: number; fields?: Record<string, unknown>; clearFields?: string[]; source?: string }
type ProposalDecision = { action?: "accept_proposal" | "reject_proposal"; proposalId?: number; note?: string }

class MutationRejection extends Error {
  constructor(readonly response: Response) { super("PostgreSQL profile mutation rejected") }
}

function reject(body: Record<string, unknown>, status: number): never {
  throw new MutationRejection(Response.json(body, { status }))
}

async function priorMutation(db: PostgresDatabase, identity: MutationIdentity, actorUserId: number) {
  const [existing] = await db.select().from(mutationRequests).where(and(
    eq(mutationRequests.actorUserId, actorUserId), eq(mutationRequests.operationType, identity.operationType),
    eq(mutationRequests.targetKey, identity.targetKey), eq(mutationRequests.clientKeyHash, identity.clientKeyHash),
  )).limit(1)
  if (!existing) return null
  if (existing.payloadHash !== identity.payloadHash) return mutationConflictResponse()
  if (existing.status === "COMPLETED" && existing.responseJson) return replayMutationResponse(existing)
  return mutationPendingResponse()
}

function requestRow(identity: MutationIdentity, context: SecurityContext, now: string) {
  return { requestKey: identity.requestKey, clientKeyHash: identity.clientKeyHash, actorUserId: context.userId,
    operationType: identity.operationType, targetKey: identity.targetKey, payloadHash: identity.payloadHash,
    status: "IN_PROGRESS", leaseExpiresAt: now, createdAt: now, updatedAt: now }
}

function auditRow(context: SecurityContext, action: string, id: number, metadata: Record<string, unknown>, requestKey: string) {
  return { actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
    actorRole: context.role, action, entityType: "alumnus", entityId: String(id), metadataJson: safeAuditMetadata(metadata),
    result: "success", source: "application", mutationRequestKey: requestKey }
}

function finishRow(body: unknown, now: string) {
  return { status: "COMPLETED", httpStatus: 200, responseJson: JSON.stringify(body), updatedAt: now }
}

export function profileMutationErrorResponse(error: unknown): Response {
  if (error instanceof MutationRejection) return error.response
  return Response.json({ error: "Database operation failed." }, { status: 500 })
}

export async function postgresProfilePatch(db: PostgresDatabase, request: Request, id: number, context: SecurityContext,
  payload: ProfilePatch, mapAlumnus: (row: typeof alumni.$inferSelect, role: SecurityContext["role"]) => unknown) {
  if (!Number.isInteger(payload.expectedVersion) || !payload.fields || typeof payload.fields !== "object")
    return Response.json({ error: "Record version and profile fields are required." }, { status: 400 })
  const identity = await mutationIdentity(request, context, "alumnus_profile_patch", String(id), payload)
  const prior = await priorMutation(db, identity, context.userId)
  if (prior) return prior
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`select id from alumni where id = ${id} for update`)
      const raced = await priorMutation(db, identity, context.userId)
      if (raced) return raced
      const [current] = await tx.select().from(alumni).where(eq(alumni.id, id)).limit(1)
      if (!current) reject({ error: "Alumnus not found." }, 404)
      if (current.recordVersion !== payload.expectedVersion) reject({ error: "This profile changed after you opened it. Reload and review the latest values.", code: "VERSION_CONFLICT", currentVersion: current.recordVersion }, 409)
      let plan: ReturnType<typeof planProfileUpdate>
      try { plan = planProfileUpdate(current as unknown as Record<string, unknown>, payload.fields!, payload.clearFields, context.role) }
      catch (error) { reject({ error: error instanceof Error ? error.message : "Invalid profile update." }, 400) }
      const now = new Date().toISOString()
      const nextVersion = current.recordVersion + (plan.history.length ? 1 : 0)
      const source = payload.source?.slice(0, 120) || "Manual profile edit"
      await tx.insert(mutationRequests).values(requestRow(identity, context, now))
      const [updated] = await tx.update(alumni).set({ ...plan.direct, recordVersion: nextVersion,
        lastMutationRequestKey: identity.requestKey, updatedBy: context.displayName, updatedAt: now })
        .where(and(eq(alumni.id, id), eq(alumni.recordVersion, current.recordVersion))).returning()
      if (!updated) reject({ error: "The profile was changed concurrently. Reload before saving again.", code: "VERSION_CONFLICT" }, 409)
      const body = { alumnus: mapAlumnus(updated, context.role), changed: plan.history.length, proposed: plan.proposed.length }
      await tx.insert(mutationCommitGuards).values({ requestKey: identity.requestKey, alumnusId: id, operation: "profile_patch", valid: 1 })
      for (const item of plan.history) await tx.insert(fieldChangeHistory).values({ alumnusId: id, field: item.field,
        oldValue: item.oldValue, newValue: item.newValue, source, providerAction: "Authorized field-level profile update",
        initiatedBy: context.displayName, mutationRequestKey: identity.requestKey })
      for (const item of plan.proposed) await tx.insert(alumniProfileChangeProposals).values({ alumnusId: id, field: item.field,
        oldValue: item.oldValue, proposedValue: item.proposedValue, source, expectedRecordVersion: nextVersion,
        proposedBy: context.displayName, mutationRequestKey: identity.requestKey })
      await tx.insert(securityAuditEvents).values(auditRow(context, "alumnus_profile_patch", id,
        { fieldsChanged: plan.history.map(item => item.field), proposalsCreated: plan.proposed.map(item => item.field),
          expectedVersion: current.recordVersion, resultingVersion: nextVersion }, identity.requestKey))
      await tx.update(mutationRequests).set(finishRow(body, now)).where(eq(mutationRequests.requestKey, identity.requestKey))
      return Response.json(body)
    })
  } catch (error) {
    if (error instanceof MutationRejection) return error.response
    try { const raced = await priorMutation(db, identity, context.userId); if (raced) return raced } catch { /* original failure */ }
    throw error
  }
}

export async function postgresProfileProposalDecision(db: PostgresDatabase, request: Request, id: number,
  context: SecurityContext, payload: ProposalDecision) {
  if (!Number.isInteger(payload.proposalId) || !["accept_proposal", "reject_proposal"].includes(String(payload.action)))
    return Response.json({ error: "A valid proposal decision is required." }, { status: 400 })
  const identity = await mutationIdentity(request, context, "alumnus_profile_proposal_decision", `${id}:${payload.proposalId}`, payload)
  const prior = await priorMutation(db, identity, context.userId)
  if (prior) return prior
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`select id from alumni where id = ${id} for update`)
      const raced = await priorMutation(db, identity, context.userId)
      if (raced) return raced
      const [current] = await tx.select().from(alumni).where(eq(alumni.id, id)).limit(1)
      const [proposal] = await tx.select().from(alumniProfileChangeProposals).where(and(eq(alumniProfileChangeProposals.id, payload.proposalId!), eq(alumniProfileChangeProposals.alumnusId, id))).limit(1)
      if (!proposal) reject({ error: "Profile proposal not found." }, 404)
      if (proposal.status !== "PENDING") reject({ error: "This proposal has already been decided." }, 409)
      if (!current) reject({ error: "Alumnus not found." }, 404)
      const accept = payload.action === "accept_proposal"
      if (accept && (current.recordVersion !== proposal.expectedRecordVersion || String((current as unknown as Record<string, unknown>)[proposal.field] ?? "") !== proposal.oldValue))
        reject({ error: "The canonical field changed after this proposal was created. Review the latest profile before accepting.", code: "STALE_PROPOSAL" }, 409)
      const editable = new Set(["programme", "graduationYear", "graduation_year", "company", "title", "location", "email", "phone"])
      if (accept && !editable.has(proposal.field)) reject({ error: "This proposed field is not eligible for acceptance." }, 400)
      const now = new Date().toISOString()
      const status = accept ? "ACCEPTED" : "REJECTED"
      const body = accept ? { status, recordVersion: current.recordVersion + 1 } : { status }
      await tx.insert(mutationRequests).values(requestRow(identity, context, now))
      if (accept) {
        const graduation = proposal.field === "graduation_year" || proposal.field === "graduationYear"
        const column = graduation ? "graduationYear" : proposal.field
        const value = graduation ? Number(proposal.proposedValue) : proposal.proposedValue
        const change: Record<string, unknown> = { [column]: value, recordVersion: current.recordVersion + 1,
          lastMutationRequestKey: identity.requestKey, updatedBy: context.displayName, updatedAt: now }
        if (graduation) change.batch = value
        const [updated] = await tx.update(alumni).set(change).where(and(eq(alumni.id, id), eq(alumni.recordVersion, current.recordVersion))).returning({ id: alumni.id })
        if (!updated) reject({ error: "The profile was changed concurrently. Reload before accepting this proposal.", code: "VERSION_CONFLICT" }, 409)
      }
      const [decided] = await tx.update(alumniProfileChangeProposals).set({ status, reviewedBy: context.displayName,
        reviewedAt: now, reviewNote: String(payload.note ?? "").trim().slice(0, 1000), decisionMutationRequestKey: identity.requestKey })
        .where(and(eq(alumniProfileChangeProposals.id, proposal.id), eq(alumniProfileChangeProposals.status, "PENDING"))).returning({ id: alumniProfileChangeProposals.id })
      if (!decided) reject({ error: "This proposal has already been decided." }, 409)
      if (accept) {
        const collectId = /^coresignal-collect:(\d+)$/.exec(proposal.mutationRequestKey)?.[1]
        if (collectId) await tx.update(coresignalWebhookEvents).set({ status: "UPDATE_APPLIED",
          reviewOutcome: `Approved ${proposal.field} proposal #${proposal.id} by ${context.displayName}` })
          .where(and(eq(coresignalWebhookEvents.alumnusId, id), eq(coresignalWebhookEvents.collectHistoryId, Number(collectId)), eq(coresignalWebhookEvents.status, "PROFILE_COLLECTED")))
        await tx.insert(fieldChangeHistory).values({ alumnusId: id, field: proposal.field, oldValue: proposal.oldValue,
          newValue: proposal.proposedValue, source: proposal.source, providerAction: "Approved profile correction",
          initiatedBy: context.displayName, mutationRequestKey: identity.requestKey })
      }
      await tx.insert(mutationCommitGuards).values({ requestKey: identity.requestKey, alumnusId: id,
        operation: accept ? "proposal_accept" : "proposal_reject", valid: 1 })
      await tx.insert(securityAuditEvents).values(auditRow(context,
        accept ? "alumnus_profile_proposal_accepted" : "alumnus_profile_proposal_rejected", id,
        accept ? { proposalId: proposal.id, field: proposal.field, resultingVersion: current.recordVersion + 1 }
          : { proposalId: proposal.id, field: proposal.field }, identity.requestKey))
      await tx.update(mutationRequests).set(finishRow(body, now)).where(eq(mutationRequests.requestKey, identity.requestKey))
      return Response.json(body)
    })
  } catch (error) {
    if (error instanceof MutationRejection) return error.response
    try { const raced = await priorMutation(db, identity, context.userId); if (raced) return raced } catch { /* original failure */ }
    throw error
  }
}
