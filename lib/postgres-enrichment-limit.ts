import { getPostgresDb } from "@/db/postgres/adapter"
import { providerSettings, securityAuditEvents } from "@/db/postgres/schema"
import { postgresEnrichmentRead } from "@/lib/postgres-enrichment-read"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"
import type { ProviderName } from "@/lib/enrichment-providers"

export async function postgresUpdateEnrichmentLimit(provider: ProviderName, monthlyCreditLimit: number, context: SecurityContext) {
  const now = new Date().toISOString()
  await getPostgresDb().transaction(async tx => {
    await tx.insert(providerSettings).values({ provider, monthlyCreditLimit, updatedAt: now }).onConflictDoUpdate({
      target: providerSettings.provider, set: { monthlyCreditLimit, updatedAt: now },
    })
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "provider_limit_changed", entityType: "provider",
      entityId: provider, metadataJson: safeAuditMetadata({ monthlyCreditLimit }), result: "success", source: "application" })
  })
  const { usage } = await postgresEnrichmentRead(context.role)
  return Response.json({ usage })
}
