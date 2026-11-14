import { desc, inArray, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { providerRefreshReviews, providerResponseHistory, providerSettings } from "@/db/postgres/schema"
import { enrichmentMode, providerConfigured, type ProviderName } from "@/lib/enrichment-providers"
import { localLushaV3MockTransportEnabled } from "@/lib/local-development"
import { PROFESSIONAL_DATA_PROVIDER } from "@/lib/professional-data"

const providers: ProviderName[] = ["coresignal", "lusha"]
const defaultLimits: Record<ProviderName, number> = { coresignal: 25, lusha: 100 }

function monthStart() {
  const date = new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString()
}

export async function postgresEnrichmentRead(role: string) {
  const db = getPostgresDb()
  return db.transaction(async tx => {
    for (const provider of providers) await tx.insert(providerSettings).values({ provider, monthlyCreditLimit: defaultLimits[provider] }).onConflictDoNothing()
    // D1 datetime() treats bare timestamps as UTC and excludes invalid values.
    const candidate = sql<string>`case when ${providerResponseHistory.createdAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then case when length(${providerResponseHistory.createdAt}) = 10 then ${providerResponseHistory.createdAt} || 'T00:00:00Z' when ${providerResponseHistory.createdAt} ~* '(z|[+-][0-9]{2}:[0-9]{2})$' then ${providerResponseHistory.createdAt} else ${providerResponseHistory.createdAt} || 'Z' end else null end`
    const timestamp = sql`case when pg_input_is_valid(${candidate}, 'timestamp with time zone') then (${candidate})::timestamptz else null end`
    const [settings, usageRows, history] = await Promise.all([
      tx.select().from(providerSettings),
      tx.select({ provider: providerResponseHistory.provider,
        credits: sql<number>`coalesce(sum(${providerResponseHistory.creditsUsed}), 0)`,
        applicationUnits: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)`,
        lushaBudgetUnits: sql<number>`coalesce(sum(case when ${providerResponseHistory.mode}='live' then case when ${providerResponseHistory.applicationUnits}>0 then ${providerResponseHistory.applicationUnits} else ${providerResponseHistory.creditsUsed} end else 0 end), 0)` })
        .from(providerResponseHistory).where(sql`${timestamp} >= ${monthStart()}::timestamptz`).groupBy(providerResponseHistory.provider),
      tx.select().from(providerResponseHistory).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(100),
    ])
    const lushaHistoryIds = history.filter(item => item.provider === "lusha").map(item => item.id)
    const lushaReviews = role === "ADMIN" && lushaHistoryIds.length
      ? await tx.select().from(providerRefreshReviews).where(inArray(providerRefreshReviews.providerResponseId, lushaHistoryIds))
      : []
    const usedByProvider = Object.fromEntries(usageRows.map(row => [row.provider, row.provider === "lusha" ? Number(row.lushaBudgetUnits) : row.provider === PROFESSIONAL_DATA_PROVIDER ? Number(row.applicationUnits) : Number(row.credits)]))
    const usage = Object.fromEntries(providers.map(provider => {
      const limit = settings.find(row => row.provider === provider)?.monthlyCreditLimit ?? defaultLimits[provider]
      const used = usedByProvider[provider] ?? 0
      return [provider, { used, limit, remaining: Math.max(0, limit - used), configured: providerConfigured(provider) || (provider === "lusha" && localLushaV3MockTransportEnabled()), mode: enrichmentMode(provider) }]
    }))
    return { usage, history, lushaReviews }
  })
}
