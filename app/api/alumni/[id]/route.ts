import { and, desc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, fieldChangeHistory, mutationCommitGuards, mutationRequests, securityAuditEvents } from "@/db/schema"
import { planProfileUpdate } from "@/lib/alumni-profile-update"
import { existingMutation, mutationConflictResponse, mutationIdentity, mutationPendingResponse, mutationRequestInsert, replayMutationResponse } from "@/lib/mutation-idempotency"
import { accessErrorResponse, authorizeRequest, hasPermission, maskEmail, maskPhone, safeAuditMetadata } from "@/lib/security"

function alumnusResponse(row: typeof alumni.$inferSelect, role: "ADMIN" | "PCOM" | "DEVELOPER") {
  const contacts = hasPermission(role, "VIEW_CONTACTS")
  return { ...row, email: contacts ? row.email : maskEmail(row.email), phone: contacts ? row.phone : maskPhone(row.phone), batch: row.graduationYear || row.batch, assessment: { hiringInfluence: row.hiringInfluence, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential }, verification: { profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification, location: row.locationVerification } }
}

async function alumnusId(params: Promise<{ id: string }>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid alumnus ID.")
  return id
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    const id = await alumnusId(params)
    const db = getDb()
    const [person] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const [employmentHistory, proposals, history] = await Promise.all([
      db.select().from(alumniEmploymentEvidence).where(eq(alumniEmploymentEvidence.alumnusId, id)).orderBy(desc(alumniEmploymentEvidence.observedAt), desc(alumniEmploymentEvidence.id)),
      db.select().from(alumniProfileChangeProposals).where(eq(alumniProfileChangeProposals.alumnusId, id)).orderBy(desc(alumniProfileChangeProposals.createdAt), desc(alumniProfileChangeProposals.id)).limit(20),
      db.select().from(fieldChangeHistory).where(eq(fieldChangeHistory.alumnusId, id)).orderBy(desc(fieldChangeHistory.createdAt), desc(fieldChangeHistory.id)).limit(30),
    ])
    return Response.json({ alumnus: alumnusResponse(person, context.role), employmentHistory, proposals, fieldHistory: history })
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Unable to load the alumnus profile." }, { status: 400 }) }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const id = await alumnusId(params)
    const payload = await request.json() as { expectedVersion?: number; fields?: Record<string, unknown>; clearFields?: string[]; source?: string }
    if (!Number.isInteger(payload.expectedVersion) || !payload.fields || typeof payload.fields !== "object") return Response.json({ error: "Record version and profile fields are required." }, { status: 400 })
    const identity = await mutationIdentity(request, context, "alumnus_profile_patch", String(id), payload)
    const prior = await existingMutation(identity, context.userId)
    if (prior?.kind === "conflict") return mutationConflictResponse()
    if (prior?.kind === "completed") return replayMutationResponse(prior.existing)
    if (prior?.kind === "pending") return mutationPendingResponse()
    const db = getDb()
    const [current] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
    if (!current) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    if (current.recordVersion !== payload.expectedVersion) return Response.json({ error: "This profile changed after you opened it. Reload and review the latest values.", code: "VERSION_CONFLICT", currentVersion: current.recordVersion }, { status: 409 })
    const plan = planProfileUpdate(current as unknown as Record<string, unknown>, payload.fields, payload.clearFields, context.role)
    const now = new Date().toISOString()
    const nextVersion = current.recordVersion + (plan.history.length ? 1 : 0)
    const updated = { ...current, ...plan.direct, recordVersion: nextVersion, lastMutationRequestKey: identity.requestKey, updatedBy: context.displayName, updatedAt: now }
    const responseBody = { alumnus: alumnusResponse(updated, context.role), changed: plan.history.length, proposed: plan.proposed.length }
    const source = payload.source?.slice(0, 120) || "Manual profile edit"
    const actions = [
      mutationRequestInsert(identity, context, now),
      db.update(alumni).set({ ...plan.direct, recordVersion: nextVersion, lastMutationRequestKey: identity.requestKey, updatedBy: context.displayName, updatedAt: now }).where(and(eq(alumni.id, id), eq(alumni.recordVersion, current.recordVersion))),
      db.insert(mutationCommitGuards).values({
        requestKey: identity.requestKey,
        alumnusId: id,
        operation: "profile_patch",
        valid: sql<number>`(select case when exists (select 1 from alumni where id = ${id} and record_version = ${nextVersion} and last_mutation_request_key = ${identity.requestKey}) then 1 else 0 end)`,
      }),
      ...plan.history.map(item => db.insert(fieldChangeHistory).values({ alumnusId: id, field: item.field, oldValue: item.oldValue, newValue: item.newValue, source, providerAction: "Authorized field-level profile update", initiatedBy: context.displayName, mutationRequestKey: identity.requestKey })),
      ...plan.proposed.map(item => db.insert(alumniProfileChangeProposals).values({ alumnusId: id, field: item.field, oldValue: item.oldValue, proposedValue: item.proposedValue, source, expectedRecordVersion: nextVersion, proposedBy: context.displayName, mutationRequestKey: identity.requestKey })),
      db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role, action: "alumnus_profile_patch", entityType: "alumnus", entityId: String(id), metadataJson: safeAuditMetadata({ fieldsChanged: plan.history.map(item => item.field), proposalsCreated: plan.proposed.map(item => item.field), expectedVersion: current.recordVersion, resultingVersion: nextVersion }), result: "success", source: "application", mutationRequestKey: identity.requestKey }),
      db.update(mutationRequests).set({ status: "COMPLETED", httpStatus: 200, responseJson: JSON.stringify(responseBody), updatedAt: now }).where(and(eq(mutationRequests.requestKey, identity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"))),
    ]
    try {
      await db.batch(actions as unknown as Parameters<typeof db.batch>[0])
    } catch (error) {
      const raced = await existingMutation(identity, context.userId)
      if (raced?.kind === "completed") return replayMutationResponse(raced.existing)
      if (raced?.kind === "conflict") return mutationConflictResponse()
      const [latest] = await db.select({ recordVersion: alumni.recordVersion }).from(alumni).where(eq(alumni.id, id)).limit(1)
      if (latest?.recordVersion !== current.recordVersion) return Response.json({ error: "The profile was changed concurrently. Reload before saving again.", code: "VERSION_CONFLICT" }, { status: 409 })
      throw error
    }
    return Response.json(responseBody)
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Unable to update the alumnus profile." }, { status: 400 }) }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizeRequest(request, "MANAGE_USERS")
    const id = await alumnusId(params)
    const payload = await request.json() as { action?: "accept_proposal" | "reject_proposal"; proposalId?: number; note?: string }
    if (!Number.isInteger(payload.proposalId) || !["accept_proposal", "reject_proposal"].includes(String(payload.action))) return Response.json({ error: "A valid proposal decision is required." }, { status: 400 })
    const identity = await mutationIdentity(request, context, "alumnus_profile_proposal_decision", `${id}:${payload.proposalId}`, payload)
    const prior = await existingMutation(identity, context.userId)
    if (prior?.kind === "conflict") return mutationConflictResponse()
    if (prior?.kind === "completed") return replayMutationResponse(prior.existing)
    if (prior?.kind === "pending") return mutationPendingResponse()
    const db = getDb()
    const [proposal] = await db.select().from(alumniProfileChangeProposals).where(and(eq(alumniProfileChangeProposals.id, payload.proposalId!), eq(alumniProfileChangeProposals.alumnusId, id))).limit(1)
    if (!proposal) return Response.json({ error: "Profile proposal not found." }, { status: 404 })
    if (proposal.status !== "PENDING") return Response.json({ error: "This proposal has already been decided." }, { status: 409 })
    const [current] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
    if (!current) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const now = new Date().toISOString()
    if (payload.action === "reject_proposal") {
      const responseBody = { status: "REJECTED" }
      const actions = [
        mutationRequestInsert(identity, context, now),
        db.update(alumniProfileChangeProposals).set({ status: "REJECTED", reviewedBy: context.displayName, reviewedAt: now, reviewNote: String(payload.note ?? "").trim().slice(0, 1000), decisionMutationRequestKey: identity.requestKey }).where(and(eq(alumniProfileChangeProposals.id, proposal.id), eq(alumniProfileChangeProposals.status, "PENDING"))),
        db.insert(mutationCommitGuards).values({ requestKey: identity.requestKey, alumnusId: id, operation: "proposal_reject", valid: sql<number>`(select case when exists (select 1 from alumni_profile_change_proposals where id = ${proposal.id} and status = 'REJECTED' and decision_mutation_request_key = ${identity.requestKey}) then 1 else 0 end)` }),
        db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role, action: "alumnus_profile_proposal_rejected", entityType: "alumnus", entityId: String(id), metadataJson: safeAuditMetadata({ proposalId: proposal.id, field: proposal.field }), result: "success", source: "application", mutationRequestKey: identity.requestKey }),
        db.update(mutationRequests).set({ status: "COMPLETED", httpStatus: 200, responseJson: JSON.stringify(responseBody), updatedAt: now }).where(and(eq(mutationRequests.requestKey, identity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"))),
      ]
      try { await db.batch(actions as unknown as Parameters<typeof db.batch>[0]) }
      catch (error) {
        const raced = await existingMutation(identity, context.userId)
        if (raced?.kind === "completed") return replayMutationResponse(raced.existing)
        throw error
      }
      return Response.json(responseBody)
    }
    if (current.recordVersion !== proposal.expectedRecordVersion || String((current as unknown as Record<string, unknown>)[proposal.field] ?? "") !== proposal.oldValue) return Response.json({ error: "The canonical field changed after this proposal was created. Review the latest profile before accepting.", code: "STALE_PROPOSAL" }, { status: 409 })
    const editable = new Set(["programme", "graduationYear", "graduation_year", "company", "title", "location", "email", "phone"])
    if (!editable.has(proposal.field)) return Response.json({ error: "This proposed field is not eligible for acceptance." }, { status: 400 })
    const graduationProposal = proposal.field === "graduation_year" || proposal.field === "graduationYear"
    const proposalColumn = graduationProposal ? "graduationYear" : proposal.field
    const proposalValue = graduationProposal ? Number(proposal.proposedValue) : proposal.proposedValue
    const change: Record<string, unknown> = { [proposalColumn]: proposalValue, recordVersion: current.recordVersion + 1, lastMutationRequestKey: identity.requestKey, updatedBy: context.displayName, updatedAt: now }
    if (graduationProposal) change.batch = proposalValue
    const responseBody = { status: "ACCEPTED", recordVersion: current.recordVersion + 1 }
    const updates = [
      mutationRequestInsert(identity, context, now),
      db.update(alumni).set(change).where(and(eq(alumni.id, id), eq(alumni.recordVersion, current.recordVersion))),
      db.update(alumniProfileChangeProposals).set({ status: "ACCEPTED", reviewedBy: context.displayName, reviewedAt: now, reviewNote: String(payload.note ?? "").trim().slice(0, 1000), decisionMutationRequestKey: identity.requestKey }).where(and(eq(alumniProfileChangeProposals.id, proposal.id), eq(alumniProfileChangeProposals.status, "PENDING"))),
      db.insert(mutationCommitGuards).values({ requestKey: identity.requestKey, alumnusId: id, operation: "proposal_accept", valid: sql<number>`(select case when exists (select 1 from alumni where id = ${id} and record_version = ${current.recordVersion + 1} and last_mutation_request_key = ${identity.requestKey}) and exists (select 1 from alumni_profile_change_proposals where id = ${proposal.id} and status = 'ACCEPTED' and decision_mutation_request_key = ${identity.requestKey}) then 1 else 0 end)` }),
      db.insert(fieldChangeHistory).values({ alumnusId: id, field: proposal.field, oldValue: proposal.oldValue, newValue: proposal.proposedValue, source: proposal.source, providerAction: "Approved profile correction", initiatedBy: context.displayName, mutationRequestKey: identity.requestKey }),
      db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role, action: "alumnus_profile_proposal_accepted", entityType: "alumnus", entityId: String(id), metadataJson: safeAuditMetadata({ proposalId: proposal.id, field: proposal.field, resultingVersion: current.recordVersion + 1 }), result: "success", source: "application", mutationRequestKey: identity.requestKey }),
      db.update(mutationRequests).set({ status: "COMPLETED", httpStatus: 200, responseJson: JSON.stringify(responseBody), updatedAt: now }).where(and(eq(mutationRequests.requestKey, identity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"))),
    ]
    try { await db.batch(updates as unknown as Parameters<typeof db.batch>[0]) }
    catch (error) {
      const raced = await existingMutation(identity, context.userId)
      if (raced?.kind === "completed") return replayMutationResponse(raced.existing)
      const [latest] = await db.select({ recordVersion: alumni.recordVersion }).from(alumni).where(eq(alumni.id, id)).limit(1)
      if (latest?.recordVersion !== current.recordVersion) return Response.json({ error: "The profile was changed concurrently. Reload before accepting this proposal.", code: "VERSION_CONFLICT" }, { status: 409 })
      throw error
    }
    return Response.json(responseBody)
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Unable to decide the profile proposal." }, { status: 400 }) }
}
