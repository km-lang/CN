import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { engagementActions, engagementAuditLog, securityAuditEvents } from "@/db/postgres/schema"
import { buildDraft, eventPerson, PreviewExclusion, validate } from "@/lib/postgres-engagement-bulk-preview"
import { mailConfiguration, mailMode } from "@/lib/mail-service"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function businessError(error: PreviewExclusion) {
  const status = /Already engaged|assigned to|already completed/i.test(error.message) ? 409 : 400
  return Response.json({ error: error.message }, { status })
}

export async function auditEngagementDraft(context: SecurityContext, eventId: number, action: "draft_generated" | "draft_failed", details: string) {
  await getPostgresDb().transaction(async tx => {
    await tx.insert(engagementAuditLog).values({ eventId, actor: context.displayName, action, details })
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: `engagement_${action}`, entityType: "engagement_event",
      entityId: String(eventId), metadataJson: safeAuditMetadata({ details }), result: "success", source: "application" })
  })
}

/** Single-recipient draft preview. The only writes are the paired activity and security audits. */
export async function postgresEngagementPreview(eventId: number, templateId: number | undefined, context: SecurityContext): Promise<Response> {
  if (!Number.isInteger(eventId)) return Response.json({ error: "A valid engagement event is required." }, { status: 400 })
  try {
    await eventPerson(eventId)
  } catch (error) {
    if (error instanceof PreviewExclusion) return businessError(error)
    throw error
  }

  try {
    const eligibility = await validate(eventId, context.displayName)
    const item = await buildDraft(eventId, templateId)
    const actionKey = `mail:${item.person.id}:${item.event.eventKey}:${item.template.templateKey}:v${item.template.version}`
    const [duplicate] = await getPostgresDb().select({ id: engagementActions.id }).from(engagementActions)
      .where(eq(engagementActions.actionKey, actionKey)).limit(1)
    if (duplicate) throw new PreviewExclusion("This approved message has already been sent or reserved.")
    await auditEngagementDraft(context, eventId, "draft_generated", `Draft prepared with ${item.template.name}.`)
    return Response.json({ template: item.template, draft: item.draft,
      readiness: { ...eligibility, duplicateStatus: "No duplicate send found", provider: "Google Workspace / Gmail",
        mode: mailMode(), sender: mailConfiguration().sender || "Mock placement committee" } })
  } catch (error) {
    if (!(error instanceof PreviewExclusion)) throw error
    await auditEngagementDraft(context, eventId, "draft_failed", "Controlled email draft initialization failed before any send attempt.")
    return businessError(error)
  }
}
