import { and, eq } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { providerCompanyMappings } from "@/db/postgres/schema"
import type { ProviderCompanyMappingStore } from "@/lib/provider-company-mapping"

/** Read provider-company identity only from the selected request's PostgreSQL pool. */
export function postgresProviderCompanyMappingStore(): ProviderCompanyMappingStore {
  const db = getPostgresDb()
  return {
    findByCompany(provider, normalizedCompanyKey) {
      return db.select().from(providerCompanyMappings).where(and(
        eq(providerCompanyMappings.provider, provider),
        eq(providerCompanyMappings.normalizedCompanyKey, normalizedCompanyKey),
      )).orderBy(providerCompanyMappings.id)
    },
    findBySelectionId(provider, mappingId) {
      return db.select().from(providerCompanyMappings).where(and(
        eq(providerCompanyMappings.provider, provider),
        eq(providerCompanyMappings.id, mappingId),
      )).orderBy(providerCompanyMappings.id)
    },
  }
}
