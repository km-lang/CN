import { and, eq, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, fieldChangeHistory, providerRefreshReviews } from "@/db/postgres/schema"
import { attachCoresignalIdentity } from "@/lib/coresignal-identity"
import { postgresCoresignalIdentityStore } from "@/lib/postgres-coresignal-identity-store"
import { writePostgresSecurityAudit } from "@/lib/postgres-security"
import { PROFESSIONAL_DATA_PROVIDER_LABEL } from "@/lib/professional-data"
import type { SecurityContext } from "@/lib/security"

const ALLOWED_FIELDS = new Set(["company", "title", "rawTitle", "function", "seniority", "location", "previous", "linkedinUrl", "coresignalEmployeeId", "graduationYear", "iimlAffiliationStatus", "iimlEducationProgramme", "iimlEducationStartDate", "iimlEducationEndDate", "iimlInstitutionId", "iimlInstitutionUrl", "currentCompanyId", "currentCompanyUrl", "currentRoleStartDate", "currentIndustry", "currentRoleAmbiguous", "providerFreshnessAt"])
class RaceLost extends Error { constructor(readonly response: Response) { super("race lost") } }

/**
 * Enrichment `apply_refresh` on PostgreSQL: same checks, messages and response as D1. The
 * review, alumnus update, field history, identity attachment and audit commit together.
 * `authorizeIdentityChange` performs D1's extra MANAGE_PROVIDER_SETTINGS check before an
 * identity change. Approved 2026-11-15: intended identity attachment; a request that loses a
 * concurrent race on the same review is rolled back and gets a sanitized 409.
 */
export async function postgresApplyProfileRefresh(input: { reviewId: number; fields?: string[] }, context: SecurityContext, authorizeIdentityChange: () => Promise<unknown>): Promise<Response> {
  const actor = context.displayName
  try {
    return await getPostgresDb().transaction(async tx => {
      const [review] = await tx.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, input.reviewId)).for("update").limit(1)
      if (!review || review.status !== "Pending review") return Response.json({ error: "This profile refresh is no longer pending review." }, { status: 409 })
      const [person] = await tx.select().from(alumni).where(eq(alumni.id, review.alumnusId)).for("update").limit(1)
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 })
      const proposed = JSON.parse(review.proposedChangesJson) as Array<{ field: string; oldValue: string; newValue: string }>
      const requested = new Set((input.fields ?? []).filter(field => ALLOWED_FIELDS.has(field)))
      const staleField = proposed.find(change => requested.has(change.field) && change.oldValue !== change.newValue && String((person as unknown as Record<string, unknown>)[change.field] ?? "") !== String(change.oldValue ?? ""))
      if (staleField) return Response.json({ error: "The canonical profile changed after this evidence was staged. Review the latest profile before applying it.", code: "STALE_PROFESSIONAL_REVIEW" }, { status: 409 })
      const updates: Record<string, unknown> = { updatedBy: actor, updatedAt: new Date().toISOString(), recordVersion: person.recordVersion + 1 }
      const applied: string[] = []
      const identityChange = proposed.find(change => change.field === "coresignalEmployeeId" && requested.has(change.field) && change.newValue && change.oldValue !== change.newValue)
      if (identityChange) {
        await authorizeIdentityChange()
        await tx.execute(sql`select pg_advisory_xact_lock(7303107)`)
        const proposedProfile = proposed.find(change => change.field === "linkedinUrl")?.newValue || person.linkedinUrl
        const identity = await attachCoresignalIdentity({ coresignalEmployeeId: identityChange.newValue, profileUrl: proposedProfile, expectedAlumnusId: person.id, source: `profile_refresh_review:${review.id}`, actor }, postgresCoresignalIdentityStore(tx, context))
        if (["CONFLICT", "IDENTITY_REVIEW_REQUIRED", "NEW_CANDIDATE"].includes(identity.outcome)) return Response.json({ error: identity.rationale, identityOutcome: identity.outcome }, { status: 409 })
        if (identity.wroteIdentity) applied.push("coresignalEmployeeId")
      }
      for (const change of proposed) {
        if (change.field === "coresignalEmployeeId" || !requested.has(change.field) || !change.newValue || change.oldValue === change.newValue) continue
        updates[change.field] = change.field === "currentRoleAmbiguous" ? change.newValue === "true" : change.field === "graduationYear" ? Number(change.newValue) : change.newValue
        applied.push(change.field)
        await tx.insert(fieldChangeHistory).values({ alumnusId: person.id, field: change.field, oldValue: change.oldValue, newValue: change.newValue, source: PROFESSIONAL_DATA_PROVIDER_LABEL, providerAction: "Profile Refresh", creditsCharged: 0, initiatedBy: actor })
      }
      await tx.update(alumni).set(updates).where(eq(alumni.id, person.id))
      const [reviewed] = await tx.update(providerRefreshReviews).set({ status: applied.length ? "Applied" : "Reviewed — kept existing", reviewedBy: actor, reviewedAt: new Date().toISOString() })
        .where(and(eq(providerRefreshReviews.id, review.id), eq(providerRefreshReviews.status, "Pending review"))).returning({ id: providerRefreshReviews.id })
      if (!reviewed) throw new RaceLost(Response.json({ error: "This profile refresh is no longer pending review." }, { status: 409 }))
      await writePostgresSecurityAudit(tx as unknown as Parameters<typeof writePostgresSecurityAudit>[0], context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { appliedFields: applied } })
      return Response.json({ applied, alumnusId: person.id })
    })
  } catch (error) {
    if (error instanceof RaceLost) return error.response
    throw error
  }
}
