import { and, eq, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, applicationUsers, companyPriorities, corporateOpportunities, corporateOpportunityHistory, engagementEvents, securityAuditEvents } from "@/db/postgres/schema"
import { cleanOpportunityText, isOpportunityStage, requiresOpportunityOutcome, validateOpportunityDate, validateOpportunityTransition } from "@/lib/opportunities"
import { serializePostgresOpportunities } from "@/lib/postgres-opportunities-read"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Opportunity = typeof corporateOpportunities.$inferSelect

function positiveInteger(value: unknown, label: string, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} is invalid.`)
  return result
}

async function eligibleOwner(ownerUserId: number) {
  const [owner] = await getPostgresDb().select({ id: applicationUsers.id, displayName: applicationUsers.displayName, role: applicationUsers.role, enabled: applicationUsers.enabled })
    .from(applicationUsers).where(and(eq(applicationUsers.id, ownerUserId), eq(applicationUsers.enabled, true))).limit(1)
  if (!owner || !["ADMIN", "PCOM"].includes(owner.role)) throw new Error("Choose an active PCOM or Admin opportunity owner.")
  return owner
}

async function canonicalCompany(raw: unknown) {
  const requested = cleanOpportunityText(raw, "Company", 180, true)
  const db = getPostgresDb()
  const [knownAlumnus, knownPriority, knownOpportunity] = await Promise.all([
    db.select({ company: alumni.company }).from(alumni).where(sql`lower(trim(${alumni.company})) = lower(trim(${requested}))`).limit(1),
    db.select({ company: companyPriorities.company }).from(companyPriorities).where(sql`lower(trim(${companyPriorities.company})) = lower(trim(${requested}))`).limit(1),
    db.select({ company: corporateOpportunities.company }).from(corporateOpportunities).where(sql`lower(trim(${corporateOpportunities.company})) = lower(trim(${requested}))`).limit(1),
  ])
  return knownAlumnus[0]?.company ?? knownPriority[0]?.company ?? knownOpportunity[0]?.company ?? requested
}

async function validateLinks(company: string, alumnusId: number | null, engagementId: number | null) {
  const db = getPostgresDb()
  if (alumnusId) {
    const [person] = await db.select({ id: alumni.id, company: alumni.company, intakeStatus: alumni.intakeStatus }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
    if (!person) throw new Error("The selected alumnus does not exist.")
    if (person.intakeStatus === "PROVISIONAL") throw new Error("Provisional profiles cannot be treated as verified company relationships.")
    if (person.company.trim().toLowerCase() !== company.toLowerCase()) throw new Error("The selected alumnus is not linked to this company.")
  }
  if (engagementId) {
    const [engagement] = await db.select({ id: engagementEvents.id, alumnusId: engagementEvents.alumnusId, company: engagementEvents.company })
      .from(engagementEvents).where(eq(engagementEvents.id, engagementId)).limit(1)
    if (!engagement) throw new Error("The selected engagement does not exist.")
    const [engagementAlumnus] = await db.select({ company: alumni.company, intakeStatus: alumni.intakeStatus }).from(alumni).where(eq(alumni.id, engagement.alumnusId)).limit(1)
    if (engagementAlumnus?.intakeStatus === "PROVISIONAL") throw new Error("Provisional profiles cannot be used as verified engagement relationships.")
    const engagementCompany = engagement.company.trim() || engagementAlumnus?.company.trim() || ""
    if (engagementCompany.toLowerCase() !== company.toLowerCase()) throw new Error("The selected engagement belongs to another company.")
    if (alumnusId && engagement.alumnusId !== alumnusId) throw new Error("The selected engagement belongs to another alumnus.")
    alumnusId = engagement.alumnusId
  }
  return alumnusId
}

function audit(context: SecurityContext, action: string, opportunityId: number, metadata: Record<string, unknown>) {
  return { actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
    actorRole: context.role, action, entityType: "corporate_opportunity", entityId: String(opportunityId),
    metadataJson: safeAuditMetadata(metadata), result: "success", source: "application" }
}

export async function postgresCreateOpportunity(payload: Record<string, unknown>, context: SecurityContext) {
  const opportunityKey = cleanOpportunityText(payload.idempotencyKey, "Idempotency key", 100, true)
  const company = await canonicalCompany(payload.company)
  const ownerUserId = positiveInteger(payload.ownerUserId, "Owner")!
  const title = cleanOpportunityText(payload.title, "Opportunity title", 240, true)
  const description = cleanOpportunityText(payload.description, "Description", 4000)
  const nextAction = cleanOpportunityText(payload.nextAction, "Next action", 1000)
  const followUpDate = validateOpportunityDate(payload.followUpDate)
  const alumnusId = positiveInteger(payload.alumnusId, "Alumnus", true)
  const engagementId = positiveInteger(payload.engagementId, "Engagement", true)
  const owner = await eligibleOwner(ownerUserId)
  const linkedAlumnusId = await validateLinks(company, alumnusId, engagementId)
  const now = new Date().toISOString()
  const creation = await getPostgresDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7303105)`)
    const [inserted] = await tx.insert(corporateOpportunities).values({ opportunityKey, company, alumnusId: linkedAlumnusId,
      engagementId, ownerUserId, title, description, stage: "IDENTIFIED", nextAction, followUpDate,
      createdByUserId: context.userId, lastUpdatedByUserId: context.userId, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: corporateOpportunities.opportunityKey }).returning()
    const row = inserted ?? (await tx.select().from(corporateOpportunities).where(eq(corporateOpportunities.opportunityKey, opportunityKey)).limit(1))[0]
    if (!row) throw new Error("The duplicate opportunity could not be resolved safely.")
    const [history] = await tx.select({ id: corporateOpportunityHistory.id }).from(corporateOpportunityHistory)
      .where(and(eq(corporateOpportunityHistory.opportunityId, row.id), eq(corporateOpportunityHistory.action, "created"))).limit(1)
    if (!history) await tx.insert(corporateOpportunityHistory).values({ opportunityId: row.id, actorUserId: context.userId,
      action: "created", fromStage: "", toStage: row.stage, summary: `Created for ${company}; owner ${owner.displayName}.`,
      changesJson: "{}", createdAt: now })
    if (inserted) await tx.insert(securityAuditEvents).values(audit(context, "opportunity_created", row.id,
      { company, ownerUserId, alumnusId: linkedAlumnusId, engagementId }))
    return { row, idempotent: !inserted }
  })
  return Response.json({ opportunity: (await serializePostgresOpportunities([creation.row]))[0], idempotent: creation.idempotent },
    { status: creation.idempotent ? 200 : 201 })
}

export async function postgresUpdateOpportunity(payload: Record<string, unknown>, context: SecurityContext) {
  const id = positiveInteger(payload.id, "Opportunity ID")!
  const version = positiveInteger(payload.version, "Opportunity version")!
  const db = getPostgresDb()
  const [current] = await db.select().from(corporateOpportunities).where(eq(corporateOpportunities.id, id)).limit(1)
  if (!current) return Response.json({ error: "Opportunity not found." }, { status: 404 })
  const stage = payload.stage === undefined ? current.stage : String(payload.stage)
  if (!isOpportunityStage(current.stage) || !isOpportunityStage(stage)) return Response.json({ error: "Opportunity stage is invalid." }, { status: 400 })
  validateOpportunityTransition(current.stage, stage)
  const title = payload.title === undefined ? current.title : cleanOpportunityText(payload.title, "Opportunity title", 240, true)
  const description = payload.description === undefined ? current.description : cleanOpportunityText(payload.description, "Description", 4000)
  const nextAction = payload.nextAction === undefined ? current.nextAction : cleanOpportunityText(payload.nextAction, "Next action", 1000)
  const followUpDate = payload.followUpDate === undefined ? current.followUpDate : validateOpportunityDate(payload.followUpDate)
  const outcome = payload.outcome === undefined ? current.outcome : cleanOpportunityText(payload.outcome, "Outcome", 2000)
  if (requiresOpportunityOutcome(stage) && !outcome) return Response.json({ error: `Record an outcome before moving this opportunity to ${stage === "CONFIRMED" ? "Confirmed" : "Closed Lost"}.` }, { status: 400 })
  const ownerUserId = payload.ownerUserId === undefined ? current.ownerUserId : positiveInteger(payload.ownerUserId, "Owner")!
  await eligibleOwner(ownerUserId)
  const alumnusId = payload.alumnusId === undefined ? current.alumnusId : positiveInteger(payload.alumnusId, "Alumnus", true)
  const engagementId = payload.engagementId === undefined ? current.engagementId : positiveInteger(payload.engagementId, "Engagement", true)
  const linkedAlumnusId = await validateLinks(current.company, alumnusId, engagementId)
  const now = new Date().toISOString()
  const changes = Object.fromEntries(Object.entries({ title, description, stage, nextAction, followUpDate, outcome,
    ownerUserId, alumnusId: linkedAlumnusId, engagementId }).filter(([key, value]) => value !== current[key as keyof Opportunity]))
  if (!Object.keys(changes).length) return Response.json({ opportunity: (await serializePostgresOpportunities([current]))[0], unchanged: true })
  const action = stage !== current.stage ? "stage_changed" : ownerUserId !== current.ownerUserId ? "owner_changed" : "updated"
  const summary = stage !== current.stage ? `${current.stage} → ${stage}` : ownerUserId !== current.ownerUserId ? "Responsible owner changed." : "Opportunity details updated."
  const updated = await db.transaction(async tx => {
    const [row] = await tx.update(corporateOpportunities).set({ ...changes, version: current.version + 1,
      lastUpdatedByUserId: context.userId, updatedAt: now })
      .where(and(eq(corporateOpportunities.id, id), eq(corporateOpportunities.version, version))).returning()
    if (!row) return null
    await tx.insert(corporateOpportunityHistory).values({ opportunityId: id, actorUserId: context.userId, action,
      fromStage: current.stage, toStage: stage, summary, changesJson: JSON.stringify(Object.keys(changes)), createdAt: now })
    await tx.insert(securityAuditEvents).values(audit(context, "opportunity_updated", id,
      { changedFields: Object.keys(changes), fromVersion: version, toVersion: row.version }))
    return row
  })
  if (!updated) return Response.json({ error: "This opportunity changed while you were reviewing it. Reload and try again." }, { status: 409 })
  return Response.json({ opportunity: (await serializePostgresOpportunities([updated]))[0] })
}
