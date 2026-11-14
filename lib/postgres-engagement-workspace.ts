import { desc, eq } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniPrivacyControls, applicationUsers, birthdayData, communicationPreferences, engagementActions, engagementAuditLog, engagementEvents, engagementResponses, eventViews, messageTemplates } from "@/db/postgres/schema"

export async function postgresEngagementWorkspaceRows() {
  const db = getPostgresDb()
  return Promise.all([
    db.select().from(engagementEvents).orderBy(desc(engagementEvents.eventDate), desc(engagementEvents.id)),
    db.select().from(alumni),
    db.select().from(birthdayData),
    db.select().from(communicationPreferences),
    db.select().from(messageTemplates).where(eq(messageTemplates.status, "Approved")),
    db.select().from(engagementActions).orderBy(desc(engagementActions.performedAt), desc(engagementActions.id)),
    db.select().from(engagementResponses).orderBy(desc(engagementResponses.receivedAt), desc(engagementResponses.id)),
    db.select().from(eventViews).orderBy(desc(eventViews.viewedAt), desc(eventViews.id)),
    db.select().from(engagementAuditLog).orderBy(desc(engagementAuditLog.createdAt), desc(engagementAuditLog.id)),
    db.select().from(alumniPrivacyControls),
    db.select({ id: applicationUsers.id, displayName: applicationUsers.displayName, email: applicationUsers.email, enabled: applicationUsers.enabled, role: applicationUsers.role }).from(applicationUsers),
  ] as const)
}
