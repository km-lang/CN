import { and, eq } from "drizzle-orm"

import type { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, fieldChangeHistory, securityAuditEvents } from "@/db/postgres/schema"
import type { CoresignalIdentityStore } from "@/lib/coresignal-identity"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type PostgresDatabase = ReturnType<typeof getPostgresDb>
/** A Drizzle PostgreSQL transaction handle. */
export type PostgresTransaction = Parameters<Parameters<PostgresDatabase["transaction"]>[0]>[0]

/**
 * Approved PostgreSQL identity attachment (2026-11-15). This is the intended
 * behaviour of the D1 `coresignalIdentityStore`, whose INSERT ... SELECT with
 * `changes() = 1` fails SQL compilation on D1 (that D1 defect is documented,
 * not changed). A Coresignal Employee ID is attached only to an alumnus that has
 * none. The identity, its field-history row and the reconciliation audit commit
 * or roll back with the caller's transaction.
 */
export function postgresCoresignalIdentityStore(tx: PostgresTransaction, context: SecurityContext): CoresignalIdentityStore {
  return {
    loadAlumni: () => tx.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, linkedinUrl: alumni.linkedinUrl }).from(alumni).orderBy(alumni.id),
    async attachIfUnassigned(alumnusId, employeeId, attachment) {
      const now = new Date().toISOString()
      const [updated] = await tx.update(alumni).set({ coresignalEmployeeId: employeeId, updatedBy: attachment.actor, updatedAt: now })
        .where(and(eq(alumni.id, alumnusId), eq(alumni.coresignalEmployeeId, ""))).returning({ id: alumni.id })
      if (!updated) return false
      await tx.insert(fieldChangeHistory).values({ alumnusId, field: "coresignalEmployeeId", oldValue: "", newValue: employeeId,
        source: "Coresignal", providerAction: "Identity attachment", creditsCharged: 0, initiatedBy: attachment.actor })
      return true
    },
    async recordEvidence(item) {
      await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
        actorName: context.displayName, actorRole: context.role, action: "coresignal_identity_reconciled", entityType: "alumnus",
        entityId: String(item.alumnusId ?? ""), result: item.outcome === "CONFLICT" || item.outcome === "IDENTITY_REVIEW_REQUIRED" ? "review_required" : "success",
        source: item.source, metadataJson: safeAuditMetadata({ coresignalEmployeeId: item.coresignalEmployeeId,
          discoveryResultId: item.discoveryResultId ?? null, evidenceLinkedinUrl: item.profileUrl ?? "", matchingMethod: item.matchingMethod,
          outcome: item.outcome, rationale: item.rationale, evidenceReviewRequired: item.evidenceReviewRequired, identityWritten: item.wroteIdentity }) })
    },
    // The unique index on alumni.coresignal_employee_id surfaces as a 23505
    // violation inside the transaction; callers serialize attachment with an
    // advisory lock, so a conflict here is an integrity error, not a race.
    isUniqueConflict: error => (error as { code?: string } | null)?.code === "23505",
  }
}
