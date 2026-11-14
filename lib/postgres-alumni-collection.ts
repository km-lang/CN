import { inArray } from "drizzle-orm"
import type { PostgresDatabase } from "@/db/postgres/adapter"
import { alumni, alumniDataLifecycle, alumniPrivacyControls } from "@/db/postgres/schema"
import type { DirectoryQuery } from "@/lib/directory-query"
import { runPostgresDirectoryQuery } from "@/lib/postgres-directory-data"
import type { SecurityContext } from "@/lib/security"
import { hasPermission, maskEmail, maskPhone } from "@/lib/security-policy"

export async function postgresAlumniCollectionResponse(db: PostgresDatabase, context: SecurityContext, query: DirectoryQuery) {
  const result = await runPostgresDirectoryQuery(db, query, true)
  const ids = result.items.map(item => item.id)
  if (!ids.length) return Response.json({ ...result, items: [] }, { headers: { "cache-control": "private, no-store" } })
  const [people, privacyRows, lifecycleRows] = await Promise.all([
    db.select().from(alumni).where(inArray(alumni.id, ids)),
    db.select().from(alumniPrivacyControls).where(inArray(alumniPrivacyControls.alumnusId, ids)),
    db.select().from(alumniDataLifecycle).where(inArray(alumniDataLifecycle.alumnusId, ids)),
  ])
  const peopleById = new Map(people.map(person => [person.id, person]))
  const privacyById = new Map(privacyRows.map(item => [item.alumnusId, item]))
  const lifecycleById = new Map(lifecycleRows.map(item => [item.alumnusId, item]))
  const canViewContacts = hasPermission(context.role, "VIEW_CONTACTS")
  const operational = context.role !== "DEVELOPER"
  const items = result.items.map(summary => {
    const person = peopleById.get(summary.id)!
    const privacy = privacyById.get(summary.id)
    return {
      ...summary,
      email: canViewContacts ? person.email : maskEmail(person.email), phone: canViewContacts ? person.phone : maskPhone(person.phone),
      pdlPersonId: person.pdlPersonId, coresignalEmployeeId: person.coresignalEmployeeId, lushaPersonId: person.lushaPersonId,
      lastPdlRefresh: person.lastPdlRefresh, lastProfessionalDataRefresh: person.lastProfessionalDataRefresh, professionalDataProvider: person.professionalDataProvider,
      emailSource: person.emailSource, phoneSource: person.phoneSource, emailRetrievedAt: person.emailRetrievedAt, phoneRetrievedAt: person.phoneRetrievedAt,
      professionalDataStatus: person.professionalDataStatus, professionalDataNote: operational ? person.professionalDataNote : "Restricted for Developer role",
      currentCompanyId: person.currentCompanyId, currentCompanyUrl: person.currentCompanyUrl, currentRoleStartDate: person.currentRoleStartDate,
      currentIndustry: person.currentIndustry, currentRoleAmbiguous: person.currentRoleAmbiguous, recordVersion: person.recordVersion,
      privacy: privacy ? { generalContactStatus: privacy.generalContactStatus, professionalEngagementStatus: privacy.professionalEngagementStatus, birthdayEngagementStatus: privacy.birthdayEngagementStatus, consentSource: privacy.consentSource, notes: operational ? privacy.notes : "", updatedAt: privacy.updatedAt, updatedBy: privacy.updatedBy } : { generalContactStatus: "Unknown", professionalEngagementStatus: "Unknown", birthdayEngagementStatus: "Unknown", consentSource: "Unknown", notes: "", updatedAt: "", updatedBy: "" },
      lifecycle: lifecycleById.get(summary.id)?.status ?? "Active",
    }
  })
  return Response.json({ items, total: result.total, page: result.page, pageSize: result.pageSize, pageCount: result.pageCount, facets: result.facets }, { headers: { "cache-control": "private, no-store" } })
}
