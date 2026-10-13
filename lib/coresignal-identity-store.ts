import { and, eq, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, fieldChangeHistory } from "@/db/schema"
import type { CoresignalIdentityEvidence, CoresignalIdentityInput, CoresignalIdentityStore } from "@/lib/coresignal-identity"
import { writeSecurityAudit, type SecurityContext } from "@/lib/security"

type CorporateDatabase = ReturnType<typeof getDb>

function uniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /unique constraint failed:\s*alumni\.coresignal_employee_id|idx_alumni_coresignal_employee_id_unique/i.test(message)
}

export function coresignalIdentityStore(db: CorporateDatabase, context: SecurityContext): CoresignalIdentityStore {
  return {
    async loadAlumni() {
      return db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni).orderBy(alumni.id)
    },
    async attachIfUnassigned(alumnusId: number, coresignalEmployeeId: string, input: CoresignalIdentityInput) {
      const now = new Date().toISOString()
      const updateIdentity = db.update(alumni).set({ coresignalEmployeeId, updatedBy: input.actor, updatedAt: now }).where(and(
        eq(alumni.id, alumnusId),
        eq(alumni.coresignalEmployeeId, ""),
      )).returning({ id: alumni.id })
      // D1 executes a batch transactionally. changes() belongs to the preceding
      // compare-and-set UPDATE, so history is written only when this attempt won.
      const insertHistory = db.insert(fieldChangeHistory).select(db.select({
        alumnusId: sql<number>`${alumnusId}`.as("alumnus_id"),
        field: sql<string>`'coresignalEmployeeId'`.as("field"),
        oldValue: sql<string>`''`.as("old_value"),
        newValue: sql<string>`${coresignalEmployeeId}`.as("new_value"),
        source: sql<string>`'Coresignal'`.as("source"),
        providerAction: sql<string>`'Identity attachment'`.as("provider_action"),
        creditsCharged: sql<number>`0`.as("credits_charged"),
        initiatedBy: sql<string>`${input.actor}`.as("initiated_by"),
        createdAt: sql<string>`CURRENT_TIMESTAMP`.as("created_at"),
      }).from(alumni).where(and(
        eq(alumni.id, alumnusId),
        eq(alumni.coresignalEmployeeId, coresignalEmployeeId),
        sql`changes() = 1`,
      )))
      const [attached] = await db.batch([updateIdentity, insertHistory])
      return attached.length === 1
    },
    async recordEvidence(evidence: CoresignalIdentityEvidence) {
      await writeSecurityAudit(context, {
        action: "coresignal_identity_reconciled",
        entityType: "alumnus",
        entityId: evidence.alumnusId ?? "",
        result: evidence.outcome === "CONFLICT" || evidence.outcome === "IDENTITY_REVIEW_REQUIRED" ? "review_required" : "success",
        source: evidence.source,
        metadata: {
          coresignalEmployeeId: evidence.coresignalEmployeeId,
          discoveryResultId: evidence.discoveryResultId ?? null,
          evidenceLinkedinUrl: evidence.profileUrl ?? "",
          matchingMethod: evidence.matchingMethod,
          outcome: evidence.outcome,
          rationale: evidence.rationale,
          evidenceReviewRequired: evidence.evidenceReviewRequired,
          identityWritten: evidence.wroteIdentity,
        },
      })
    },
    isUniqueConflict: uniqueConflict,
  }
}
