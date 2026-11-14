import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, applicationUsers, birthdayData, engagementActions, engagementAuditLog, engagementEvents,
  engagementResponses, eventViews, fieldChangeHistory, securityAuditEvents } from "@/db/postgres/schema"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { action?: string; eventId?: number; assigneeId?: number; force?: boolean; notes?: string; reason?: string;
  responseType?: string; followUpRequired?: boolean; followUpDate?: string; birthMonthDay?: string }
const terminalStatuses = new Set(["Action Taken", "Response Received", "Closed", "Completed", "Skipped"])
const response = (error: string, status: number) => Response.json({ error }, { status })

/** Database-only engagement actions. Mail drafts, reservations and delivery stay fail closed. */
export async function postgresEngagementLocalAction(payload: Input, context: SecurityContext, loadWorkspace: () => Promise<unknown>): Promise<Response> {
  const eventId = Number(payload.eventId)
  if (!Number.isInteger(eventId)) return response("A valid engagement event is required.", 400)
  const actor = context.displayName
  const now = new Date().toISOString()
  const result = await getPostgresDb().transaction(async tx => {
    const [event] = await tx.select().from(engagementEvents).where(eq(engagementEvents.id, eventId)).for("update").limit(1)
    if (!event) return response("Engagement event not found.", 400)
    const [person] = await tx.select({ id: alumni.id }).from(alumni).where(eq(alumni.id, event.alumnusId)).limit(1)
    if (!person) return response("The linked alumnus could not be found.", 400)
    const audit = async (action: string, details: string) => {
      await tx.insert(engagementAuditLog).values({ eventId, actor, action, details })
      await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
        actorName: context.displayName, actorRole: context.role, action: `engagement_${action}`, entityType: "engagement_event",
        entityId: String(eventId), metadataJson: safeAuditMetadata({ details }), result: "success", source: "application" })
    }

    if (payload.action === "view") {
      await tx.insert(eventViews).values({ eventId, userId: actor })
      await tx.update(engagementEvents).set({ status: event.status === "New" ? "Viewed" : event.status,
        firstViewedAt: event.firstViewedAt || now, lastViewedBy: actor, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("viewed", "Event opened. No engagement action was taken.")
    } else if (payload.action === "acknowledge") {
      if (!terminalStatuses.has(event.status)) await tx.update(engagementEvents).set({ status: "Acknowledged", acknowledgedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("acknowledged", "Signal reviewed and acknowledged.")
    } else if (payload.action === "assign_to") {
      if (terminalStatuses.has(event.status)) return response("A completed engagement cannot be reassigned.", 409)
      const assigneeId = Number(payload.assigneeId)
      if (!Number.isInteger(assigneeId) || assigneeId < 1) return response("Choose an active PCOM or Admin owner.", 400)
      const [assignee] = await tx.select().from(applicationUsers).where(and(eq(applicationUsers.id, assigneeId), eq(applicationUsers.enabled, true))).limit(1)
      if (!assignee || !["ADMIN", "PCOM"].includes(assignee.role)) return response("The selected owner is not an active PCOM or Admin user.", 409)
      const [updated] = await tx.update(engagementEvents).set({ assignedTo: String(assignee.id), assignedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now })
        .where(and(eq(engagementEvents.id, eventId), eq(engagementEvents.assignedTo, event.assignedTo))).returning({ id: engagementEvents.id })
      if (!updated) return response("Ownership changed while you were reviewing this engagement. Reload and try again.", 409)
      await audit(event.assignedTo ? "reassigned" : "assigned", `${event.assignedTo ? `Reassigned from ${event.assignedTo}` : "Assigned"} to ${assignee.displayName} (user ${assignee.id}).`)
    } else if (payload.action === "assign") {
      if (terminalStatuses.has(event.status)) return response("A completed engagement cannot be reassigned.", 409)
      if (event.assignedTo && event.assignedTo !== actor && !payload.force) return response(`This engagement is currently assigned to ${event.assignedTo}.`, 409)
      await tx.update(engagementEvents).set({ assignedTo: actor, assignedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit(event.assignedTo ? "reassigned" : "assigned", event.assignedTo ? `Reassigned from ${event.assignedTo}.` : "Ownership taken.")
    } else if (payload.action === "plan") {
      if (terminalStatuses.has(event.status)) return response("This event has already been completed.", 409)
      if (event.assignedTo && event.assignedTo !== actor && !payload.force) return response(`This engagement is currently assigned to ${event.assignedTo}.`, 409)
      await tx.update(engagementEvents).set({ status: "Action Planned", actionPlannedAt: now, assignedTo: actor,
        assignedAt: event.assignedAt || now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("action_planned", payload.notes ?? "Engagement action planned.")
    } else if (payload.action === "manual_action") {
      if (terminalStatuses.has(event.status)) return response("This event has already been completed.", 409)
      const [created] = await tx.insert(engagementActions).values({ actionKey: `manual:${eventId}:${Date.now()}`, eventId,
        alumnusId: event.alumnusId, actionType: "Manual Action", channel: "Manual", performedBy: actor,
        deliveryStatus: "Completed", notes: payload.notes ?? "Action completed outside the platform." }).returning()
      await tx.update(engagementEvents).set({ status: "Action Taken", actionTakenAt: now, actionTakenBy: actor, actionType: "Manual Action",
        actionChannel: "Manual", deliveryStatus: "Completed", lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("manual_action", payload.notes ?? "Action marked complete.")
      return Response.json({ action: created })
    } else if (payload.action === "skip" || payload.action === "incorrect") {
      const reason = payload.action === "incorrect" ? `Incorrect signal${payload.reason ? `: ${payload.reason}` : ""}` : payload.reason || "Not relevant"
      await tx.update(engagementEvents).set({ status: "Skipped", skippedAt: now, skipReason: reason, closedAt: now,
        lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit(payload.action === "incorrect" ? "signal_marked_incorrect" : "skipped", reason)
    } else if (payload.action === "response") {
      const followUpRequired = Boolean(payload.followUpRequired)
      await tx.insert(engagementResponses).values({ eventId, responseType: payload.responseType || "Other", receivedAt: now,
        recordedBy: actor, notes: payload.notes ?? "", followUpRequired, followUpDate: payload.followUpDate ?? "" })
      await tx.update(engagementEvents).set({ status: followUpRequired ? "Follow-up Due" : "Response Received", responseReceived: true,
        responseReceivedAt: now, responseType: payload.responseType || "Other", responseNotes: payload.notes ?? "",
        followUpRequired, followUpDate: payload.followUpDate ?? "", lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("response_recorded", `${payload.responseType || "Other"}${followUpRequired ? `; follow-up ${payload.followUpDate || "required"}` : ""}.`)
    } else if (payload.action === "follow_up") {
      if (!payload.followUpDate) return response("Choose a follow-up date.", 400)
      await tx.update(engagementEvents).set({ status: "Follow-up Due", followUpRequired: true, followUpDate: payload.followUpDate,
        assignedTo: event.assignedTo || actor, assignedAt: event.assignedAt || now,
        lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("follow_up_added", `Follow-up due ${payload.followUpDate}.`)
    } else if (payload.action === "close") {
      await tx.update(engagementEvents).set({ status: "Closed", closedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await audit("closed", payload.notes ?? "No further action required.")
    } else if (payload.action === "correct_birthday") {
      if (!/^\d{2}-\d{2}$/.test(payload.birthMonthDay ?? "")) return response("Enter the birthday as MM-DD.", 400)
      const [birthday] = await tx.select().from(birthdayData).where(eq(birthdayData.alumnusId, event.alumnusId)).limit(1)
      if (!birthday) return response("Birthday record not found.", 404)
      await tx.update(birthdayData).set({ birthMonthDay: payload.birthMonthDay!, source: "Manual confirmation", status: "Manually confirmed",
        lastVerifiedAt: now, lastUpdatedBy: actor, updatedAt: now }).where(eq(birthdayData.id, birthday.id))
      const eventYear = new Date(event.eventDate).getUTCFullYear()
      await tx.update(engagementEvents).set({ eventDate: `${eventYear}-${payload.birthMonthDay}`, source: "Manual confirmation",
        lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId))
      await tx.insert(fieldChangeHistory).values({ alumnusId: event.alumnusId, field: "birthday", oldValue: birthday.birthMonthDay,
        newValue: payload.birthMonthDay!, source: "Manual confirmation", providerAction: "Birthday correction", initiatedBy: actor })
      await audit("birthday_corrected", `${birthday.birthMonthDay} → ${payload.birthMonthDay}.`)
    } else return response("Unsupported engagement action.", 400)
    return null
  })
  return result ?? Response.json(await loadWorkspace())
}
