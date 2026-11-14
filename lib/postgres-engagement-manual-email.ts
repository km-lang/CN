import { and, desc, eq, inArray } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, engagementActions, engagementEvents, messageTemplates } from "@/db/postgres/schema"
import { reusableManualEmailEvent } from "@/lib/controlled-email-draft"
import { buildDraft, PreviewExclusion, validate } from "@/lib/postgres-engagement-bulk-preview"
import { auditEngagementDraft } from "@/lib/postgres-engagement-preview"
import { mailConfiguration, mailMode } from "@/lib/mail-service"
import type { SecurityContext } from "@/lib/security"

const response = (error: string, status: number) => Response.json({ error }, { status })

/** Select or create a reusable manual outreach event, then build an audited draft without sending. */
export async function postgresPrepareManualEmail(alumnusId: number, context: SecurityContext): Promise<Response> {
  if (!Number.isInteger(alumnusId)) return response("Select a valid approved alumnus.", 400)
  const actor = context.displayName
  const now = new Date().toISOString()
  const prepared = await getPostgresDb().transaction(async tx => {
    const [person] = await tx.select().from(alumni).where(eq(alumni.id, alumnusId)).for("update").limit(1)
    if (!person) return response("Approved alumnus not found.", 404)
    if (person.intakeStatus === "PROVISIONAL") return response("Provisional profiles cannot enter the approved outreach workflow.", 409)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) return response("A valid stored recipient email is required before drafting.", 409)

    const manualEvents = await tx.select().from(engagementEvents).where(and(
      eq(engagementEvents.alumnusId, person.id), eq(engagementEvents.eventType, "Manual Relationship"),
    )).orderBy(desc(engagementEvents.id))
    const manualEventIds = manualEvents.map(event => event.id)
    const priorEmailActions = manualEventIds.length
      ? await tx.select({ eventId: engagementActions.eventId }).from(engagementActions).where(and(
        inArray(engagementActions.eventId, manualEventIds), eq(engagementActions.channel, "Email"),
      )) : []
    const eventsWithEmailActions = new Set(priorEmailActions.map(action => action.eventId))
    const reusableEvent = reusableManualEmailEvent(manualEvents, eventsWithEmailActions, actor)
    const [created] = reusableEvent ? [] : await tx.insert(engagementEvents).values({
      eventKey: `manual-professional-email:${person.id}:${crypto.randomUUID()}`, alumnusId: person.id,
      company: person.company, eventType: "Manual Relationship", eventSubtype: "Controlled institutional email",
      eventTitle: "Controlled institutional outreach",
      eventDescription: "Manually prepared institutional outreach for explicit review and approval.",
      source: "Manual PCOM selection", eventDate: now.slice(0, 10), status: "New", createdBy: actor, lastUpdatedBy: actor,
    }).returning()
    const event = reusableEvent ?? created
    if (!event) throw new Error("Unable to create the controlled email draft event.")
    return { event, person }
  })
  if (prepared instanceof Response) return prepared
  const { event, person } = prepared

  try {
    const eligibility = await validate(event.id, actor)
    const item = await buildDraft(event.id)
    const actionKey = `mail:${item.person.id}:${item.event.eventKey}:${item.template.templateKey}:v${item.template.version}`
    const [duplicate] = await getPostgresDb().select({ id: engagementActions.id }).from(engagementActions)
      .where(eq(engagementActions.actionKey, actionKey)).limit(1)
    if (duplicate) throw new PreviewExclusion("This approved message has already been sent or reserved.")
    const templates = await getPostgresDb().select().from(messageTemplates).where(eq(messageTemplates.eventType, "Professional Signal"))
    const approvedTemplates = templates.filter(template => template.status === "Approved")
    await auditEngagementDraft(context, event.id, "draft_generated", `Draft prepared with ${item.template.name}.`)
    const preparedEvent = {
      ...event,
      alumnus: { id: person.id, name: person.name, initials: person.initials, company: person.company, title: person.title,
        programme: person.programme, batch: person.batch, email: person.email, relationship: person.iimlRelationship,
        confidence: person.confidence, outreachStatus: person.status },
      birthday: null, preference: eligibility.communicationStatus, actions: [], responses: [], views: [], activity: [],
    }
    return Response.json({ event: preparedEvent, templates: approvedTemplates, template: item.template, draft: item.draft,
      readiness: { ...eligibility, duplicateStatus: "No duplicate send found", provider: "Google Workspace / Gmail",
        mode: mailMode(), sender: mailConfiguration().sender || "Mock placement committee" } })
  } catch (error) {
    if (!(error instanceof PreviewExclusion)) throw error
    await auditEngagementDraft(context, event.id, "draft_failed", "Controlled email draft initialization failed before any send attempt.")
    const status = /Already engaged|assigned to|already completed/i.test(error.message) ? 409 : 400
    return response(error.message, status)
  }
}
