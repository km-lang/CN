import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, engagementActions, engagementAuditLog, engagementEvents, securityAuditEvents } from "@/db/postgres/schema"
import { buildDraft, PreviewExclusion, validate } from "@/lib/postgres-engagement-bulk-preview"
import { mailConfiguration, mailFailureMayHaveDelivered, MailSendError, mailMode, sendMail } from "@/lib/mail-service"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { action?: string; eventId?: number; eventIds?: number[]; approved?: boolean; templateId?: number;
  subject?: string; body?: string }

async function audit(eventId: number, context: SecurityContext, action: string, details: string) {
  const db = getPostgresDb()
  await db.insert(engagementAuditLog).values({ eventId, actor: context.displayName, action, details })
  await db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
    actorName: context.displayName, actorRole: context.role, action: `engagement_${action}`,
    entityType: "engagement_event", entityId: String(eventId), metadataJson: safeAuditMetadata({ details }),
    result: "success", source: "application" })
}

async function sendOne(eventId: number, context: SecurityContext, approved: boolean, templateId?: number, subject?: string, body?: string) {
  const db = getPostgresDb()
  const actor = context.displayName
  if (!approved) throw new PreviewExclusion("Human approval is required after preview and before sending.")
  await validate(eventId, actor)
  const { event, person, template, draft } = await buildDraft(eventId, templateId)
  const prepared = { ...draft, subject: subject?.trim() || draft.subject, body: body?.trim() || draft.body }
  const purpose = event.eventType === "Birthday" ? "birthday" : "professional-congratulations"
  const actionKey = `mail:${person.id}:${event.eventKey}:${template.templateKey}:v${template.version}`
  const approvedAt = new Date().toISOString()
  const [reserved] = await db.insert(engagementActions).values({ actionKey, eventId: event.id, alumnusId: person.id,
    actionType: event.eventType === "Birthday" ? "Birthday Email" : "Congratulations Email", channel: "Email",
    performedBy: actor, templateId: template.id, templateVersion: template.version, sender: mailConfiguration().sender,
    recipient: person.email, purpose, approvedBy: actor, approvedAt, subject: prepared.subject,
    messageSummary: prepared.body.slice(0, 500), deliveryStatus: "Sending" }).onConflictDoNothing().returning()
  if (!reserved) {
    const [existing] = await db.select().from(engagementActions).where(eq(engagementActions.actionKey, actionKey)).limit(1)
    throw new PreviewExclusion(`Already engaged by ${existing?.performedBy || "another committee member"}${existing?.performedAt ? ` on ${new Date(existing.performedAt).toLocaleString()}` : ""}.`)
  }
  try {
    const result = await sendMail(prepared)
    const now = new Date().toISOString()
    await db.update(engagementActions).set({ externalMessageId: result.messageId, deliveryStatus: result.deliveryStatus,
      sender: result.sender, recipient: result.recipient, performedAt: now,
      notes: `Mail mode: ${result.mode}; provider: ${result.provider}` }).where(eq(engagementActions.id, reserved.id))
    await db.update(engagementEvents).set({ status: "Action Taken", assignedTo: event.assignedTo || actor,
      assignedAt: event.assignedAt || now, actionTakenAt: now, actionTakenBy: actor,
      actionType: event.eventType === "Birthday" ? "Birthday Email" : "Congratulations Email", actionChannel: "Email",
      messageTemplateId: template.id, messageSubject: prepared.subject, messageSummary: prepared.body.slice(0, 500),
      providerMessageId: result.messageId, deliveryStatus: result.deliveryStatus, lastUpdatedBy: actor, lastUpdatedAt: now })
      .where(eq(engagementEvents.id, event.id))
    if (person.status === "Not contacted") await db.update(alumni).set({ status: "Contacted", updatedBy: actor,
      updatedAt: now }).where(eq(alumni.id, person.id))
    await audit(event.id, context, "email_sent", `${event.eventType === "Birthday" ? "Birthday" : "Congratulations"} email sent through ${result.mode} mail service.`)
    return { eventId: event.id, messageId: result.messageId, deliveryStatus: result.deliveryStatus }
  } catch (error) {
    const uncertain = mailFailureMayHaveDelivered(error)
    await db.update(engagementActions).set({ ...(uncertain ? {} : { actionKey: `failed:${event.id}:${crypto.randomUUID()}` }),
      deliveryStatus: uncertain ? "Outcome unknown" : "Failed",
      notes: uncertain ? "Delivery may have occurred; reconcile with the institutional mailbox before any new send."
        : error instanceof MailSendError ? error.message : "No message was sent." }).where(eq(engagementActions.id, reserved.id))
    await audit(event.id, context, uncertain ? "email_send_outcome_unknown" : "email_send_failed_before_delivery",
      uncertain ? "The action key remains reserved pending mailbox reconciliation."
        : "The provider did not receive a message; a newly approved attempt may be prepared.")
    throw error instanceof MailSendError ? error : new MailSendError("The email send or receipt could not be verified. Reconcile before retrying.", true)
  }
}

function businessResponse(error: PreviewExclusion | MailSendError) {
  const status = /Already engaged|assigned to|already completed/i.test(error.message) ? 409 : 400
  return Response.json({ error: error.message }, { status })
}

/** Keep the D1 action-key reservation and post-send accounting order. */
export async function postgresEngagementSend(payload: Input, context: SecurityContext): Promise<Response> {
  if (payload.action === "bulk_send") {
    const ids = [...new Set(payload.eventIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
    const sent = []
    const excluded = []
    for (const id of ids) {
      try { sent.push(await sendOne(id, context, payload.approved === true, payload.templateId)) }
      catch (error) {
        if (!(error instanceof PreviewExclusion || error instanceof MailSendError)) throw error
        excluded.push({ eventId: id, reason: error.message })
      }
    }
    return Response.json({ sent, excluded, mode: mailMode() })
  }
  const eventId = Number(payload.eventId)
  if (!Number.isInteger(eventId)) return Response.json({ error: "A valid engagement event is required." }, { status: 400 })
  try { return Response.json({ sent: await sendOne(eventId, context, payload.approved === true,
    payload.templateId, payload.subject, payload.body), mode: mailMode() }) }
  catch (error) {
    if (error instanceof PreviewExclusion || error instanceof MailSendError) return businessResponse(error)
    throw error
  }
}
