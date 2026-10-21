import { and, asc, desc, eq, inArray, like, notExists, or, sql, type SQL } from "drizzle-orm"

import { getDb } from "@/db"
import {
  alumni,
  applicationUsers,
  companyPriorities,
  corporateOpportunities,
  corporateOpportunityHistory,
  engagementEvents,
} from "@/db/schema"
import {
  cleanOpportunityText,
  isOpportunityStage,
  OPPORTUNITY_STAGES,
  requiresOpportunityOutcome,
  validateOpportunityDate,
  validateOpportunityTransition,
} from "@/lib/opportunities"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

const allowedPageSizes = new Set([10, 25, 50])

function positiveInteger(value: unknown, label: string, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} is invalid.`)
  return result
}

async function eligibleOwner(ownerUserId: number) {
  const [owner] = await getDb().select({ id: applicationUsers.id, displayName: applicationUsers.displayName, role: applicationUsers.role, enabled: applicationUsers.enabled })
    .from(applicationUsers).where(and(eq(applicationUsers.id, ownerUserId), eq(applicationUsers.enabled, true))).limit(1)
  if (!owner || !["ADMIN", "PCOM"].includes(owner.role)) throw new Error("Choose an active PCOM or Admin opportunity owner.")
  return owner
}

async function validateLinks(company: string, alumnusId: number | null, engagementId: number | null) {
  const db = getDb()
  let alumnus = null
  let engagement = null
  if (alumnusId) {
    ;[alumnus] = await db.select({ id: alumni.id, name: alumni.name, company: alumni.company, intakeStatus: alumni.intakeStatus }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
    if (!alumnus) throw new Error("The selected alumnus does not exist.")
    if (alumnus.intakeStatus === "PROVISIONAL") throw new Error("Provisional profiles cannot be treated as verified company relationships.")
    if (alumnus.company.trim().toLowerCase() !== company.toLowerCase()) throw new Error("The selected alumnus is not linked to this company.")
  }
  if (engagementId) {
    ;[engagement] = await db.select({ id: engagementEvents.id, alumnusId: engagementEvents.alumnusId, company: engagementEvents.company, title: engagementEvents.eventTitle })
      .from(engagementEvents).where(eq(engagementEvents.id, engagementId)).limit(1)
    if (!engagement) throw new Error("The selected engagement does not exist.")
    const [engagementAlumnus] = await db.select({ id: alumni.id, company: alumni.company, intakeStatus: alumni.intakeStatus }).from(alumni).where(eq(alumni.id, engagement.alumnusId)).limit(1)
    if (engagementAlumnus?.intakeStatus === "PROVISIONAL") throw new Error("Provisional profiles cannot be used as verified engagement relationships.")
    const engagementCompany = engagement.company.trim() || engagementAlumnus?.company.trim() || ""
    if (engagementCompany.toLowerCase() !== company.toLowerCase()) throw new Error("The selected engagement belongs to another company.")
    if (alumnusId && engagement.alumnusId !== alumnusId) throw new Error("The selected engagement belongs to another alumnus.")
    alumnusId = engagement.alumnusId
  }
  return { alumnusId, alumnus, engagement }
}

async function canonicalCompany(raw: unknown) {
  const requested = cleanOpportunityText(raw, "Company", 180, true)
  const db = getDb()
  const [knownAlumnus, knownPriority, knownOpportunity] = await Promise.all([
    db.select({ company: alumni.company }).from(alumni).where(sql`lower(trim(${alumni.company})) = lower(trim(${requested}))`).limit(1),
    db.select({ company: companyPriorities.company }).from(companyPriorities).where(sql`lower(trim(${companyPriorities.company})) = lower(trim(${requested}))`).limit(1),
    db.select({ company: corporateOpportunities.company }).from(corporateOpportunities).where(sql`lower(trim(${corporateOpportunities.company})) = lower(trim(${requested}))`).limit(1),
  ])
  return knownAlumnus[0]?.company ?? knownPriority[0]?.company ?? knownOpportunity[0]?.company ?? requested
}

async function serialize(rows: Array<typeof corporateOpportunities.$inferSelect>) {
  const db = getDb()
  const alumnusIds = rows.flatMap(row => row.alumnusId ? [row.alumnusId] : [])
  const engagementIds = rows.flatMap(row => row.engagementId ? [row.engagementId] : [])
  const userIds = [...new Set(rows.flatMap(row => [row.ownerUserId, row.createdByUserId, row.lastUpdatedByUserId]))]
  const opportunityIds = rows.map(row => row.id)
  const [people, events, users, history] = await Promise.all([
    alumnusIds.length ? db.select({ id: alumni.id, name: alumni.name, company: alumni.company, title: alumni.title }).from(alumni).where(inArray(alumni.id, alumnusIds)) : [],
    engagementIds.length ? db.select({ id: engagementEvents.id, title: engagementEvents.eventTitle, status: engagementEvents.status, alumnusId: engagementEvents.alumnusId }).from(engagementEvents).where(inArray(engagementEvents.id, engagementIds)) : [],
    userIds.length ? db.select({ id: applicationUsers.id, displayName: applicationUsers.displayName }).from(applicationUsers).where(inArray(applicationUsers.id, userIds)) : [],
    opportunityIds.length ? db.select().from(corporateOpportunityHistory).where(inArray(corporateOpportunityHistory.opportunityId, opportunityIds)).orderBy(desc(corporateOpportunityHistory.createdAt), desc(corporateOpportunityHistory.id)) : [],
  ])
  const peopleById = new Map(people.map(person => [person.id, person]))
  const eventsById = new Map(events.map(event => [event.id, event]))
  const usersById = new Map(users.map(user => [user.id, user]))
  return rows.map(row => ({
    ...row,
    alumnus: row.alumnusId ? peopleById.get(row.alumnusId) ?? null : null,
    engagement: row.engagementId ? eventsById.get(row.engagementId) ?? null : null,
    owner: usersById.get(row.ownerUserId) ?? null,
    creator: usersById.get(row.createdByUserId) ?? null,
    lastUpdater: usersById.get(row.lastUpdatedByUserId) ?? null,
    history: history.filter(item => item.opportunityId === row.id).map(item => ({
      id: item.id,
      action: item.action,
      fromStage: item.fromStage,
      toStage: item.toStage,
      summary: item.summary,
      actor: usersById.get(item.actorUserId)?.displayName ?? "Authorized user",
      createdAt: item.createdAt,
    })),
  }))
}

async function supportData() {
  const db = getDb()
  const [owners, people, events, priorities, opportunityCompanies] = await Promise.all([
    db.select({ id: applicationUsers.id, displayName: applicationUsers.displayName, role: applicationUsers.role }).from(applicationUsers).where(eq(applicationUsers.enabled, true)).orderBy(asc(applicationUsers.displayName)),
    db.select({ id: alumni.id, name: alumni.name, company: alumni.company, title: alumni.title }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL'`).orderBy(asc(alumni.name)),
    db.select({ id: engagementEvents.id, alumnusId: engagementEvents.alumnusId, company: engagementEvents.company, title: engagementEvents.eventTitle, status: engagementEvents.status }).from(engagementEvents).orderBy(desc(engagementEvents.eventDate)),
    db.select({ company: companyPriorities.company }).from(companyPriorities),
    db.selectDistinct({ company: corporateOpportunities.company }).from(corporateOpportunities),
  ])
  const companies = [...new Set([...people.map(item => item.company), ...priorities.map(item => item.company), ...opportunityCompanies.map(item => item.company)].filter(Boolean))].sort()
  return { owners: owners.filter(owner => ["ADMIN", "PCOM"].includes(owner.role)), alumni: people, engagements: events, companies, stages: OPPORTUNITY_STAGES }
}

async function opportunitySummary(currentUserId: number) {
  const rows = await getDb().select({
    ownerUserId: corporateOpportunities.ownerUserId,
    stage: corporateOpportunities.stage,
    followUpDate: corporateOpportunities.followUpDate,
  }).from(corporateOpportunities)
  const today = new Date().toISOString().slice(0, 10)
  const active = rows.filter(row => !["CONFIRMED", "CLOSED_LOST"].includes(row.stage))
  return {
    total: rows.length,
    active: active.length,
    assignedToMe: active.filter(row => row.ownerUserId === currentUserId).length,
    followUpsDue: active.filter(row => row.followUpDate && row.followUpDate <= today).length,
  }
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const url = new URL(request.url)
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const requestedPageSize = Number(url.searchParams.get("pageSize")) || 10
    const pageSize = allowedPageSizes.has(requestedPageSize) ? requestedPageSize : 10
    const conditions: SQL[] = []
    const id = url.searchParams.get("id")
    const company = url.searchParams.get("company")?.trim()
    const alumnusId = url.searchParams.get("alumnusId")
    const ownerId = url.searchParams.get("ownerId")
    const stage = url.searchParams.get("stage")
    const search = url.searchParams.get("search")?.trim()
    if (id) conditions.push(eq(corporateOpportunities.id, positiveInteger(id, "Opportunity ID")!))
    if (company) conditions.push(sql`lower(${corporateOpportunities.company}) = lower(${company})`)
    if (alumnusId) conditions.push(eq(corporateOpportunities.alumnusId, positiveInteger(alumnusId, "Alumnus ID")!))
    if (ownerId === "me") conditions.push(eq(corporateOpportunities.ownerUserId, context.userId))
    else if (ownerId) conditions.push(eq(corporateOpportunities.ownerUserId, positiveInteger(ownerId, "Owner ID")!))
    if (stage && stage !== "ALL") {
      if (!isOpportunityStage(stage)) return Response.json({ error: "Opportunity stage is invalid." }, { status: 400 })
      conditions.push(eq(corporateOpportunities.stage, stage))
    }
    if (search) conditions.push(or(like(corporateOpportunities.title, `%${search}%`), like(corporateOpportunities.company, `%${search}%`))!)
    const where = conditions.length ? and(...conditions) : undefined
    const db = getDb()
    const [[count], rows, support, summary] = await Promise.all([
      db.select({ value: sql<number>`count(*)` }).from(corporateOpportunities).where(where),
      db.select().from(corporateOpportunities).where(where).orderBy(desc(corporateOpportunities.updatedAt), desc(corporateOpportunities.id)).limit(id ? 1 : pageSize).offset(id ? 0 : (page - 1) * pageSize),
      supportData(),
      opportunitySummary(context.userId),
    ])
    return Response.json({ opportunities: await serialize(rows), total: Number(count.value), page, pageSize, summary, ...support })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Corporate Opportunities." }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const payload = await request.json() as Record<string, unknown>
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
    const links = await validateLinks(company, alumnusId, engagementId)
    const db = getDb()
    const now = new Date().toISOString()
    const insertOpportunity = db.insert(corporateOpportunities).values({
        opportunityKey,
        company,
        alumnusId: links.alumnusId,
        engagementId,
        ownerUserId,
        title,
        description,
        stage: "IDENTIFIED",
        nextAction,
        followUpDate,
        createdByUserId: context.userId,
        lastUpdatedByUserId: context.userId,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: corporateOpportunities.opportunityKey }).returning()
    const insertCreatedHistory = db.insert(corporateOpportunityHistory).select(db.select({
      id: sql<number>`null`.as("id"),
      opportunityId: corporateOpportunities.id,
      actorUserId: sql<number>`${context.userId}`.as("actor_user_id"),
      action: sql<string>`'created'`.as("action"),
      fromStage: sql<string>`''`.as("from_stage"),
      toStage: corporateOpportunities.stage,
      summary: sql<string>`${`Created for ${company}; owner ${owner.displayName}.`}`.as("summary"),
      changesJson: sql<string>`'{}'`.as("changes_json"),
      createdAt: sql<string>`${now}`.as("created_at"),
    }).from(corporateOpportunities).where(and(
      eq(corporateOpportunities.opportunityKey, opportunityKey),
      notExists(db.select({ value: sql<number>`1` }).from(corporateOpportunityHistory).where(and(
        eq(corporateOpportunityHistory.opportunityId, corporateOpportunities.id),
        eq(corporateOpportunityHistory.action, "created"),
      ))),
    )))
    const [inserted] = await db.batch([insertOpportunity, insertCreatedHistory])
    const row = inserted[0] ?? (await db.select().from(corporateOpportunities).where(eq(corporateOpportunities.opportunityKey, opportunityKey)).limit(1))[0]
    if (!row) throw new Error("The duplicate opportunity could not be resolved safely.")
    const creation = { row, idempotent: inserted.length === 0 }
    if (!creation.idempotent) await writeSecurityAudit(context, { action: "opportunity_created", entityType: "corporate_opportunity", entityId: creation.row.id, metadata: { company, ownerUserId, alumnusId: links.alumnusId, engagementId } })
    return Response.json({ opportunity: (await serialize([creation.row]))[0], idempotent: creation.idempotent }, { status: creation.idempotent ? 200 : 201 })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    const message = error instanceof Error ? error.message : "Unable to create the opportunity."
    return Response.json({ error: message }, { status: /required|invalid|does not exist|another company|another alumnus/i.test(message) ? 400 : 409 })
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const payload = await request.json() as Record<string, unknown>
    const id = positiveInteger(payload.id, "Opportunity ID")!
    const version = positiveInteger(payload.version, "Opportunity version")!
    const db = getDb()
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
    const links = await validateLinks(current.company, alumnusId, engagementId)
    const now = new Date().toISOString()
    const changes = Object.fromEntries(Object.entries({ title, description, stage, nextAction, followUpDate, outcome, ownerUserId, alumnusId: links.alumnusId, engagementId }).filter(([key, value]) => value !== current[key as keyof typeof current]))
    if (!Object.keys(changes).length) return Response.json({ opportunity: (await serialize([current]))[0], unchanged: true })
    const action = stage !== current.stage ? "stage_changed" : ownerUserId !== current.ownerUserId ? "owner_changed" : "updated"
    const summary = stage !== current.stage ? `${current.stage} → ${stage}` : ownerUserId !== current.ownerUserId ? "Responsible owner changed." : "Opportunity details updated."
    const nextVersion = current.version + 1
    const updateOpportunity = db.update(corporateOpportunities).set({ ...changes, version: nextVersion, lastUpdatedByUserId: context.userId, updatedAt: now })
      .where(and(eq(corporateOpportunities.id, id), eq(corporateOpportunities.version, version))).returning()
    const insertUpdateHistory = db.insert(corporateOpportunityHistory).select(db.select({
      id: sql<number>`null`.as("id"),
      opportunityId: corporateOpportunities.id,
      actorUserId: sql<number>`${context.userId}`.as("actor_user_id"),
      action: sql<string>`${action}`.as("action"),
      fromStage: sql<string>`${current.stage}`.as("from_stage"),
      toStage: sql<string>`${stage}`.as("to_stage"),
      summary: sql<string>`${summary}`.as("summary"),
      changesJson: sql<string>`${JSON.stringify(Object.keys(changes))}`.as("changes_json"),
      createdAt: sql<string>`${now}`.as("created_at"),
    }).from(corporateOpportunities).where(and(
      eq(corporateOpportunities.id, id),
      eq(corporateOpportunities.version, nextVersion),
      eq(corporateOpportunities.updatedAt, now),
    )))
    const [updatedRows] = await db.batch([updateOpportunity, insertUpdateHistory])
    const updated = updatedRows[0] ?? null
    if (!updated) return Response.json({ error: "This opportunity changed while you were reviewing it. Reload and try again." }, { status: 409 })
    await writeSecurityAudit(context, { action: "opportunity_updated", entityType: "corporate_opportunity", entityId: id, metadata: { changedFields: Object.keys(changes), fromVersion: version, toVersion: updated.version } })
    return Response.json({ opportunity: (await serialize([updated]))[0] })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    const message = error instanceof Error ? error.message : "Unable to update the opportunity."
    return Response.json({ error: message }, { status: /cannot move|required|invalid|does not exist|another company|another alumnus/i.test(message) ? 400 : 409 })
  }
}
