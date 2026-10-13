import { inArray } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni } from "@/db/schema"
import type { CoresignalSearchIdLookupStore, CoresignalSearchIdMapping } from "@/lib/coresignal-search-id-dedupe"

type CorporateDatabase = ReturnType<typeof getDb>
type ChunkLoader = (employeeIds: readonly string[]) => Promise<readonly CoresignalSearchIdMapping[]>

// D1 documents a bounded number of bind parameters per statement. Ninety keeps
// each IN query conservatively below that ceiling while leaving room for future
// predicates. The service-level batch remains bounded independently.
export const CORESIGNAL_SEARCH_ID_LOOKUP_CHUNK_SIZE = 90

export function createChunkedCoresignalSearchIdLookupStore(
  loadChunk: ChunkLoader,
  chunkSize = CORESIGNAL_SEARCH_ID_LOOKUP_CHUNK_SIZE,
): CoresignalSearchIdLookupStore {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("Coresignal Search ID lookup chunk size must be a positive safe integer.")
  return {
    async findMappings(employeeIds) {
      const rows: CoresignalSearchIdMapping[] = []
      for (let offset = 0; offset < employeeIds.length; offset += chunkSize) {
        rows.push(...await loadChunk(employeeIds.slice(offset, offset + chunkSize)))
      }
      return rows.sort((left, right) => Number(left.employeeId) - Number(right.employeeId) || left.alumnusId - right.alumnusId)
    },
  }
}

export function coresignalSearchIdLookupStore(db: CorporateDatabase): CoresignalSearchIdLookupStore {
  return createChunkedCoresignalSearchIdLookupStore(employeeIds => db.select({
    employeeId: alumni.coresignalEmployeeId,
    alumnusId: alumni.id,
    linkedinUrl: alumni.linkedinUrl,
  }).from(alumni).where(inArray(alumni.coresignalEmployeeId, [...employeeIds])).orderBy(alumni.coresignalEmployeeId, alumni.id))
}
