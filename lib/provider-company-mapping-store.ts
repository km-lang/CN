import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { providerCompanyMappings } from "@/db/schema"
import type { ProviderCompanyMappingStore } from "@/lib/provider-company-mapping"

type Database = ReturnType<typeof getDb>

export function providerCompanyMappingStore(db: Database): ProviderCompanyMappingStore {
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
