import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniDataLifecycle, alumniPrivacyControls, providerRefreshReviews, securityAuditEvents } from "@/db/postgres/schema"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { alumnusId?: number; confirmation?: string; notes?: string }
const response = (error: string, status: number) => Response.json({ error }, { status })
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max)

/** The D1 anonymization batch represented as one PostgreSQL transaction. */
export async function postgresAnonymizeAlumnus(payload: Input, context: SecurityContext): Promise<Response> {
  if (!Number.isInteger(payload.alumnusId)) return response("Unsupported administration action.", 400)
  const id = payload.alumnusId!
  if (payload.confirmation !== `ANONYMIZE ${id}`) return response(`Type ANONYMIZE ${id} to confirm.`, 409)
  const now = new Date().toISOString()
  return getPostgresDb().transaction(async tx => {
    const [person] = await tx.select().from(alumni).where(eq(alumni.id, id)).for("update").limit(1)
    if (!person) return response("Alumnus not found.", 404)
    const pendingReview = await tx.select({ id: providerRefreshReviews.id }).from(providerRefreshReviews)
      .where(and(eq(providerRefreshReviews.alumnusId, id), eq(providerRefreshReviews.status, "Pending review"))).limit(1)
    if (pendingReview.length) return response("Resolve the pending provider review before anonymizing this alumnus.", 409)

    await tx.update(alumni).set({
      profileKey: `anonymized:${id}:${Date.now()}`, name: `Anonymized alumnus #${id}`, initials: "AA",
      email: "", phone: "", linkedinUrl: "", pdlPersonId: "", coresignalEmployeeId: "", lushaPersonId: "",
      currentCompanyId: "", currentCompanyUrl: "", iimlInstitutionId: "", iimlInstitutionUrl: "",
      note: "Personal data anonymized by an administrator.", hiringInfluence: "Unknown / Not assessed",
      iimlRelationship: "Unknown / Not assessed", warmIntroPotential: "Unknown / Not assessed",
      updatedBy: context.displayName, updatedAt: now,
    }).where(eq(alumni.id, id))
    await tx.insert(alumniPrivacyControls).values({ alumnusId: id, generalContactStatus: "Do not contact",
      professionalEngagementStatus: "Do not contact", birthdayEngagementStatus: "Do not contact", consentSource: "Unknown",
      notes: "Record anonymized", updatedBy: context.displayName, updatedAt: now })
      .onConflictDoUpdate({ target: alumniPrivacyControls.alumnusId, set: { generalContactStatus: "Do not contact",
        professionalEngagementStatus: "Do not contact", birthdayEngagementStatus: "Do not contact", consentSource: "Unknown",
        notes: "Record anonymized", updatedBy: context.displayName, updatedAt: now } })
    await tx.insert(alumniDataLifecycle).values({ alumnusId: id, status: "Anonymized", anonymizedAt: now,
      notes: clean(payload.notes, 1000), updatedBy: context.displayName, updatedAt: now })
      .onConflictDoUpdate({ target: alumniDataLifecycle.alumnusId, set: { status: "Anonymized", anonymizedAt: now,
        notes: clean(payload.notes, 1000), updatedBy: context.displayName, updatedAt: now } })
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "alumnus_anonymized", entityType: "alumnus",
      entityId: String(id), metadataJson: safeAuditMetadata({ previousProfileKey: person.profileKey }),
      result: "success", source: "application", createdAt: now })
    return Response.json({ anonymized: true, alumnusId: id })
  })
}
