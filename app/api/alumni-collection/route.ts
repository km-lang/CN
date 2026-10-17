import { inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle, alumniPrivacyControls } from "@/db/schema"
import { normalizeDirectoryQuery } from "@/lib/directory-query"
import { runDirectoryQuery } from "@/lib/directory-data"
import { accessErrorResponse, authorizeRequest, hasPermission, maskEmail, maskPhone } from "@/lib/security"

function requestQuery(request: Request) {
  const url = new URL(request.url)
  let filters: Record<string, unknown> = {}
  const raw = url.searchParams.get("filters")
  if (raw) {
    try { filters = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error("Alumni collection filters are malformed.") }
  }
  return normalizeDirectoryQuery({ ...filters, page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), sort: url.searchParams.get("sort") })
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    const result = await runDirectoryQuery(requestQuery(request), true)
    const ids = result.items.map(item => item.id)
    if (!ids.length) return Response.json({ ...result, items: [] }, { headers: { "cache-control": "private, no-store" } })
    const db = getDb()
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
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to query alumni." }, { status: 400 })
  }
}
