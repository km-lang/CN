import { inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni } from "@/db/schema"
import type { IdentityResolution } from "@/lib/intelligence-contracts"
import { intelligenceRequest } from "@/lib/intelligence-service.server"
import type { SecurityContext } from "@/lib/security"

export async function resolveFixedIntelligenceCohort(context: SecurityContext, cnAlumniIds: number[]) {
  const ids = [...new Set(cnAlumniIds)].filter(id => Number.isInteger(id) && id > 0).slice(0, 1000)
  if (!ids.length) throw new Error("Select at least one alumnus.")
  const people = await getDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(inArray(alumni.id, ids))
  const resolved = await Promise.all(people.map(async person => ({
    cnAlumniId: person.id,
    resolution: await intelligenceRequest<IdentityResolution>(context, "/v1/alumni/resolve", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, linkedinUrl: person.linkedinUrl || undefined }) }),
  })))
  const mappedIds = resolved.flatMap(item => item.resolution.status === "MAPPED" && item.resolution.intelligenceAlumniId ? [item.resolution.intelligenceAlumniId] : [])
  return { requested: ids.length, mappedIds, unresolved: resolved.filter(item => item.resolution.status !== "MAPPED") }
}
