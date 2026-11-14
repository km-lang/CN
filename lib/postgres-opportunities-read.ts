import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, applicationUsers, companyPriorities, corporateOpportunities, corporateOpportunityHistory, engagementEvents } from "@/db/postgres/schema"
import { isOpportunityStage, OPPORTUNITY_STAGES } from "@/lib/opportunities"

type Opportunity = typeof corporateOpportunities.$inferSelect

function positiveInteger(value: string, label: string) {
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} is invalid.`)
  return result
}

export async function serializePostgresOpportunities(rows: Opportunity[]) {
  const db = getPostgresDb()
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
      id: item.id, action: item.action, fromStage: item.fromStage, toStage: item.toStage,
      summary: item.summary, actor: usersById.get(item.actorUserId)?.displayName ?? "Authorized user", createdAt: item.createdAt,
    })),
  }))
}

export async function postgresOpportunitiesRead(request: Request, currentUserId: number) {
  const db = getPostgresDb()
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
  const requestedPageSize = Number(url.searchParams.get("pageSize")) || 10
  const pageSize = new Set([10, 25, 50]).has(requestedPageSize) ? requestedPageSize : 10
  const conditions: SQL[] = []
  const id = url.searchParams.get("id")
  const company = url.searchParams.get("company")?.trim()
  const alumnusId = url.searchParams.get("alumnusId")
  const ownerId = url.searchParams.get("ownerId")
  const stage = url.searchParams.get("stage")
  const search = url.searchParams.get("search")?.trim()
  if (id) conditions.push(eq(corporateOpportunities.id, positiveInteger(id, "Opportunity ID")))
  if (company) conditions.push(sql`lower(${corporateOpportunities.company}) = lower(${company})`)
  if (alumnusId) conditions.push(eq(corporateOpportunities.alumnusId, positiveInteger(alumnusId, "Alumnus ID")))
  if (ownerId === "me") conditions.push(eq(corporateOpportunities.ownerUserId, currentUserId))
  else if (ownerId) conditions.push(eq(corporateOpportunities.ownerUserId, positiveInteger(ownerId, "Owner ID")))
  if (stage && stage !== "ALL") {
    if (!isOpportunityStage(stage)) return Response.json({ error: "Opportunity stage is invalid." }, { status: 400 })
    conditions.push(eq(corporateOpportunities.stage, stage))
  }
  if (search) conditions.push(or(like(corporateOpportunities.title, `%${search}%`), like(corporateOpportunities.company, `%${search}%`))!)
  const where = conditions.length ? and(...conditions) : undefined
  const [[count], rows, owners, people, events, priorities, opportunityCompanies, summaryRows] = await Promise.all([
    db.select({ value: sql<number>`count(*)::integer` }).from(corporateOpportunities).where(where),
    db.select().from(corporateOpportunities).where(where).orderBy(desc(corporateOpportunities.updatedAt), desc(corporateOpportunities.id)).limit(id ? 1 : pageSize).offset(id ? 0 : (page - 1) * pageSize),
    db.select({ id: applicationUsers.id, displayName: applicationUsers.displayName, role: applicationUsers.role }).from(applicationUsers).where(eq(applicationUsers.enabled, true)).orderBy(asc(applicationUsers.displayName)),
    db.select({ id: alumni.id, name: alumni.name, company: alumni.company, title: alumni.title }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL'`).orderBy(asc(alumni.name)),
    db.select({ id: engagementEvents.id, alumnusId: engagementEvents.alumnusId, company: engagementEvents.company, title: engagementEvents.eventTitle, status: engagementEvents.status }).from(engagementEvents).orderBy(desc(engagementEvents.eventDate)),
    db.select({ company: companyPriorities.company }).from(companyPriorities),
    db.selectDistinct({ company: corporateOpportunities.company }).from(corporateOpportunities),
    db.select({ ownerUserId: corporateOpportunities.ownerUserId, stage: corporateOpportunities.stage, followUpDate: corporateOpportunities.followUpDate }).from(corporateOpportunities),
  ])
  const companies = [...new Set([...people.map(item => item.company), ...priorities.map(item => item.company), ...opportunityCompanies.map(item => item.company)].filter(Boolean))].sort()
  const today = new Date().toISOString().slice(0, 10)
  const active = summaryRows.filter(row => !["CONFIRMED", "CLOSED_LOST"].includes(row.stage))
  const summary = { total: summaryRows.length, active: active.length,
    assignedToMe: active.filter(row => row.ownerUserId === currentUserId).length,
    followUpsDue: active.filter(row => row.followUpDate && row.followUpDate <= today).length }
  return Response.json({ opportunities: await serializePostgresOpportunities(rows), total: Number(count.value), page, pageSize, summary,
    owners: owners.filter(owner => ["ADMIN", "PCOM"].includes(owner.role)), alumni: people, engagements: events, companies, stages: OPPORTUNITY_STAGES })
}
