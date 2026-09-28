import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, fieldChangeHistory, providerRefreshReviews, providerResponseHistory, securityAuditEvents } from "@/db/schema"
import {
  PROFESSIONAL_VERIFICATION_LABELS,
  type ProfessionalVerificationField,
  validateProfessionalVerificationRequest,
} from "@/lib/professional-verification"
import { accessErrorResponse, authorizeRequest, safeAuditMetadata } from "@/lib/security"

const historyFields = [
  "profile_match",
  "current_company_verification",
  "designation_verification",
  "company",
  "title",
  "rawTitle",
  "function",
  "seniority",
  "linkedinUrl",
]

const databaseFields = {
  profileMatch: { column: "profile_match", property: "profileMatch" },
  currentCompany: { column: "current_company_verification", property: "currentCompanyVerification" },
  designation: { column: "designation_verification", property: "designationVerification" },
} as const

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "OPERATE_PCOM")
    const alumnusId = Number(new URL(request.url).searchParams.get("alumnusId"))
    if (!Number.isInteger(alumnusId) || alumnusId < 1) return Response.json({ error: "Choose a valid alumnus." }, { status: 400 })
    const db = getDb()
    const [person] = await db.select().from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })

    const [recentChanges, coresignalHistory, lushaHistory] = await Promise.all([
      db.select().from(fieldChangeHistory).where(and(eq(fieldChangeHistory.alumnusId, alumnusId), inArray(fieldChangeHistory.field, historyFields))).orderBy(desc(fieldChangeHistory.createdAt), desc(fieldChangeHistory.id)).limit(12),
      db.select().from(providerResponseHistory).where(and(eq(providerResponseHistory.alumnusId, alumnusId), eq(providerResponseHistory.provider, "coresignal"))).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(1),
      db.select().from(providerResponseHistory).where(and(eq(providerResponseHistory.alumnusId, alumnusId), eq(providerResponseHistory.provider, "lusha"))).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(1),
    ])
    const [refreshReview] = coresignalHistory[0]
      ? await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.providerResponseId, coresignalHistory[0].id)).orderBy(desc(providerRefreshReviews.id)).limit(1)
      : []

    return Response.json({
      evidence: {
        stored: {
          name: person.name,
          company: person.company,
          designation: person.title,
          professionalProfileUrl: person.linkedinUrl,
          programme: person.programme,
          graduationYear: person.graduationYear || person.batch,
          verification: {
            profileMatch: person.profileMatch,
            currentCompany: person.currentCompanyVerification,
            designation: person.designationVerification,
          },
        },
        coresignal: {
          identityAvailable: Boolean(person.coresignalEmployeeId),
          lastRefresh: person.lastProfessionalDataRefresh,
          freshness: person.providerFreshnessAt,
          operation: coresignalHistory[0] ? {
            status: coresignalHistory[0].status,
            responseSummary: coresignalHistory[0].responseSummary,
            createdAt: coresignalHistory[0].createdAt,
          } : null,
          review: refreshReview ? {
            status: refreshReview.status,
            proposedChanges: JSON.parse(refreshReview.proposedChangesJson) as unknown,
            reviewedBy: refreshReview.reviewedBy,
            reviewedAt: refreshReview.reviewedAt,
          } : null,
        },
        lusha: {
          stableIdentityAvailable: Boolean(person.lushaPersonId),
          conflictEvidence: person.professionalDataStatus === "Conflict — manual verification required" ? person.professionalDataNote : "",
          operation: lushaHistory[0] ? {
            operation: lushaHistory[0].operation,
            status: lushaHistory[0].status,
            responseSummary: lushaHistory[0].responseSummary,
            createdAt: lushaHistory[0].createdAt,
          } : null,
        },
        professionalDataStatus: person.professionalDataStatus,
        professionalDataNote: person.professionalDataNote,
        recentChanges: recentChanges.map(change => ({
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          source: change.source,
          action: change.providerAction,
          reviewedBy: change.initiatedBy,
          createdAt: change.createdAt,
        })),
      },
    })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load verification evidence." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    let input: unknown
    try { input = await request.json() } catch { return Response.json({ error: "A valid JSON verification request is required." }, { status: 400 }) }
    let payload
    try { payload = validateProfessionalVerificationRequest(input) } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid verification request." }, { status: 400 })
    }

    const db = getDb()
    const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const changes = (Object.entries(payload.fields) as Array<[ProfessionalVerificationField, string]>).filter(([field, value]) => person[databaseFields[field].property] !== value)
    if (!changes.length) return Response.json({ error: "No verification states changed." }, { status: 409 })

    const now = new Date().toISOString()
    const updates: Partial<typeof alumni.$inferInsert> = { updatedBy: context.displayName, updatedAt: now }
    for (const [field, value] of changes) updates[databaseFields[field].property] = value
    const updatePerson = db.update(alumni).set(updates).where(eq(alumni.id, person.id))
    const historyWrites = changes.map(([field, value]) => db.insert(fieldChangeHistory).values({
      alumnusId: person.id,
      field: databaseFields[field].column,
      oldValue: person[databaseFields[field].property],
      newValue: value,
      source: "Manual verification",
      providerAction: `Evidence: ${payload.evidenceSource || "Not required for non-positive state"}${payload.note ? ` · Note: ${payload.note}` : ""}`,
      initiatedBy: context.displayName,
      createdAt: now,
    }))
    const audit = db.insert(securityAuditEvents).values({
      actorUserId: context.userId,
      actorIdentity: context.externalIdentity,
      actorName: context.displayName,
      actorRole: context.role,
      action: "professional_fields_verified",
      entityType: "alumnus",
      entityId: String(person.id),
      metadataJson: safeAuditMetadata({
        alumnus: person.name,
        selectedFields: changes.map(([field, value]) => ({ field, label: PROFESSIONAL_VERIFICATION_LABELS[field], oldValue: person[databaseFields[field].property], newValue: value })),
        evidenceSource: payload.evidenceSource,
        noteRecorded: Boolean(payload.note),
      }),
      result: "success",
      source: "application",
      createdAt: now,
    })
    await db.batch([updatePerson, ...historyWrites, audit])

    return Response.json({
      alumnusId: person.id,
      verification: {
        profileMatch: updates.profileMatch ?? person.profileMatch,
        currentCompany: updates.currentCompanyVerification ?? person.currentCompanyVerification,
        designation: updates.designationVerification ?? person.designationVerification,
      },
      reviewedBy: context.displayName,
      reviewedAt: now,
      changedFields: changes.map(([field]) => field),
    })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save professional verification." }, { status: 500 })
  }
}
