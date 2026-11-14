import { eq } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { providerResponseHistory, securityAuditEvents } from "@/db/postgres/schema"
import { postgresEnrichmentRead } from "@/lib/postgres-enrichment-read"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function audit(context: SecurityContext, action: string, entityType: string, entityId: string | number, metadata: Record<string, unknown>) {
  return { actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
    actorRole: context.role, action, entityType, entityId: String(entityId), metadataJson: safeAuditMetadata(metadata),
    result: "success", source: "application" }
}

export async function postgresEnrichmentLocalAction(payload: {
  action?: string; historyId?: number; reconciledCredits?: number; reconciliationSource?: string
}, context: SecurityContext): Promise<Response | null> {
  const db = getPostgresDb()
  if (payload.action === "refresh_history") {
    await db.insert(securityAuditEvents).values(audit(context, "provider_history_refreshed", "provider_history", "", { source: "administration_ui" }))
    return Response.json({ refreshed: true })
  }
  if (payload.action !== "reconcile_usage") return null
  if (!Number.isInteger(payload.historyId) || !Number.isInteger(payload.reconciledCredits)
    || Number(payload.reconciledCredits) < 0 || !payload.reconciliationSource?.trim()) {
    return Response.json({ error: "Choose a provider-history record, enter a whole observed account delta, and record its source." }, { status: 400 })
  }
  const reconciledCredits = Number(payload.reconciledCredits)
  const source = payload.reconciliationSource.trim().slice(0, 240)
  const now = new Date().toISOString()
  const result = await db.transaction(async tx => {
    const [history] = await tx.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, payload.historyId!)).for("update").limit(1)
    if (!history || history.provider !== "lusha" || history.providerReportedCredits !== null || history.status === "in_progress"
      || !["reconciliation_required", "not_applicable"].includes(history.usageState)) {
      return Response.json({ error: "Only a Lusha operation without provider-reported usage can be reconciled." }, { status: 409 })
    }
    await tx.update(providerResponseHistory).set({ creditsUsed: reconciledCredits,
      applicationUnits: Math.max(history.applicationUnits, reconciledCredits), reconciledCredits,
      usageState: "reconciled_account_usage", reconciliationSource: source, reconciledBy: context.displayName,
      reconciledAt: now }).where(eq(providerResponseHistory.id, history.id))
    await tx.insert(securityAuditEvents).values(audit(context, "provider_usage_reconciled", "provider_response", history.id,
      { provider: "lusha", operation: history.operation, reconciledCredits, source }))
    return null
  })
  if (result) return result
  return Response.json({ reconciled: true, usage: (await postgresEnrichmentRead(context.role)).usage })
}
