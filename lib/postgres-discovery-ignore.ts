import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { externalDiscoveryResults, externalDiscoverySearches, securityAuditEvents } from "@/db/postgres/schema"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { resultProviderIntegrity } from "@/lib/discovery-runs"
import { PROFESSIONAL_DATA_PROVIDER } from "@/lib/professional-data"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

const allowedReasons = new Set(["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"])
const response = (error: string) => Response.json({ error }, { status: 409 })

/** A local human review decision with no provider call or canonical profile change. */
export async function postgresIgnoreDiscoveryResult(resultId: number, requestedReason: unknown, context: SecurityContext): Promise<Response> {
  const reason = allowedReasons.has(String(requestedReason)) ? String(requestedReason) : "Other"
  const now = new Date().toISOString()
  return getPostgresDb().transaction(async tx => {
    const [result] = await tx.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, resultId)).for("update").limit(1)
    if (result && result.provider !== PROFESSIONAL_DATA_PROVIDER) return response("Historical provider results are read-only.")
    const [search] = result ? await tx.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.id, result.searchId)).limit(1) : []
    if (!result || !search || resultProviderIntegrity(search.provider, result.provider) !== "consistent") {
      return response("Discovery result provider provenance does not match its search run.")
    }
    if (result.reviewStatus !== DISCOVERY_REVIEW_STATUS.pending) return response("Only a pending discovery result can be ignored.")
    await tx.update(externalDiscoveryResults).set({ reviewStatus: "Ignored", reviewNote: reason, reviewedAt: now, reviewedBy: context.displayName })
      .where(eq(externalDiscoveryResults.id, result.id))
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "coresignal_result_ignored",
      entityType: "discovery_result", entityId: String(result.id), metadataJson: safeAuditMetadata({ reason }),
      result: "success", source: "application" })
    return Response.json({ ignored: true, reason })
  })
}
