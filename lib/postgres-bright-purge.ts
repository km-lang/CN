import { lt } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { brightdataSnapshotEvidence, securityAuditEvents } from "@/db/postgres/schema"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

/** Purge only expired raw evidence, with the Admin audit in the same transaction. */
export async function postgresBrightPurge(context: SecurityContext, confirmed: boolean | undefined): Promise<Response> {
  if (!confirmed) return Response.json({ error: "Explicit Admin confirmation is required to purge expired raw evidence." }, { status: 400 })
  const purgedCount = await getPostgresDb().transaction(async tx => {
    const deleted = await tx.delete(brightdataSnapshotEvidence)
      .where(lt(brightdataSnapshotEvidence.retentionUntil, new Date().toISOString()))
      .returning({ attemptId: brightdataSnapshotEvidence.attemptId })
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "brightdata_raw_evidence_expired_purged",
      entityType: "brightdata_snapshot_evidence", entityId: "", metadataJson: safeAuditMetadata({ purgedCount: deleted.length }),
      result: "success", source: "application" })
    return deleted.length
  })
  return Response.json({ purgedCount, providerCallMade: false })
}
