import { eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, alumniDataLifecycle } from "@/db/schema"
import { evaluateBrightEligibility } from "@/lib/bright-eligibility"
import type { IdentityResolution, IntelligenceCohortResolution } from "@/lib/intelligence-contracts"
import { intelligenceRequest } from "@/lib/intelligence-service.server"
import type { SecurityContext } from "@/lib/security"

export async function resolveFixedIntelligenceCohort(context: SecurityContext, cnAlumniIds: number[]) {
  const ids = [...new Set(cnAlumniIds)].filter(id => Number.isInteger(id) && id > 0).slice(0, 1000)
  if (!ids.length) throw new Error("Select at least one alumnus.")
  const people = await getDb().select({
    id: alumni.id,
    linkedinUrl: alumni.linkedinUrl,
    profileMatch: alumni.profileMatch,
    professionalDataStatus: alumni.professionalDataStatus,
    lifecycleStatus: alumniDataLifecycle.status,
  }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(inArray(alumni.id, ids))
  const resolved = await Promise.all(people.map(async person => {
    const resolution = await intelligenceRequest<IdentityResolution>(context, "/v1/alumni/resolve", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, linkedinUrl: person.linkedinUrl || undefined }) })
    const summary = resolution.status === "MAPPED" && resolution.intelligenceAlumniId
      ? await intelligenceRequest<{ refreshEligible: boolean }>(context, `/v1/alumni/${encodeURIComponent(resolution.intelligenceAlumniId)}/summary`)
      : null
    return { cnAlumniId: person.id, resolution, intelligenceEnrollmentApproved: summary?.refreshEligible ?? false }
  }))
  const peopleById = new Map(people.map(person => [person.id, person]))
  const evaluated = resolved.map(item => {
    const person = peopleById.get(item.cnAlumniId)!
    return { ...item, eligibility: evaluateBrightEligibility({ lifecycleStatus: person.lifecycleStatus ?? "Active", linkedinUrl: person.linkedinUrl, profileMatch: person.profileMatch, professionalDataStatus: person.professionalDataStatus, mappingStatus: item.resolution.status, suggestedIntelligenceAlumniId: item.resolution.suggestedIntelligenceAlumniId, intelligenceEnrollmentApproved: item.intelligenceEnrollmentApproved }) }
  })
  const mappedIds = evaluated.flatMap(item => item.eligibility.eligible && item.resolution.intelligenceAlumniId ? [item.resolution.intelligenceAlumniId] : [])
  const missingIds = ids.filter(id => !peopleById.has(id))
  const unresolved: IntelligenceCohortResolution["unresolved"] = [
    ...evaluated.filter(item => !item.eligibility.eligible).map(item => ({ cnAlumniId: item.cnAlumniId, reason: item.eligibility.reason, message: item.eligibility.message })),
    ...missingIds.map(cnAlumniId => ({ cnAlumniId, reason: "NOT_FOUND" as const, message: "Corporate Network alumnus was not found." })),
  ]
  return {
    requested: ids.length,
    brightEligible: mappedIds.length,
    missingLinkedin: unresolved.filter(item => item.reason === "MISSING_LINKEDIN").length,
    linkedinNotVerified: unresolved.filter(item => item.reason === "LINKEDIN_NOT_VERIFIED").length,
    identityReviewRequired: unresolved.filter(item => item.reason === "IDENTITY_CONFLICT" || item.reason === "MAPPING_REQUIRED").length,
    inactive: unresolved.filter(item => item.reason === "INACTIVE").length,
    otherExcluded: unresolved.filter(item => item.reason === "NOT_FOUND").length,
    mappedIds,
    unresolved,
  } satisfies IntelligenceCohortResolution
}
