import { and, eq, inArray } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { activityLog, alumni, alumniRelationships, engagementEvents, securityAuditEvents } from "@/db/postgres/schema"
import { appConfig } from "@/lib/app-config"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function relationshipStrength(value: string) { return ["Very strong", "Strong"].includes(value) }
function responsive(status: string) { return ["Responded", "Meeting set"].includes(status) }

export async function postgresOutreachRoute(targetAlumnusId: number | undefined, context: SecurityContext): Promise<Response> {
  if (!Number.isInteger(targetAlumnusId)) return Response.json({ error: "Select a target alumnus before requesting a route." }, { status: 400 })
  const db = getPostgresDb()
  const targetId = Number(targetAlumnusId)
  const [target] = await db.select().from(alumni).where(eq(alumni.id, targetId)).limit(1)
  if (!target) return Response.json({ error: `The selected alumnus is not in ${appConfig.name}.` }, { status: 404 })
  if (target.intakeStatus === "PROVISIONAL") return Response.json({ error: "Provisional profiles are not eligible for alumni outreach recommendations." }, { status: 409 })

  const [relations, targetHistory] = await Promise.all([
    db.select().from(alumniRelationships).where(and(eq(alumniRelationships.targetAlumnusId, targetId), eq(alumniRelationships.confirmed, true))),
    db.select().from(engagementEvents).where(eq(engagementEvents.alumnusId, targetId)),
  ])
  const intermediaryIds = [...new Set(relations.map(relation => relation.intermediaryAlumnusId))]
  const intermediaries = intermediaryIds.length ? await db.select().from(alumni).where(inArray(alumni.id, intermediaryIds)) : []
  const byId = new Map(intermediaries.map(person => [person.id, person]))
  const credible = relations.map(relation => ({ relation, person: byId.get(relation.intermediaryAlumnusId) }))
    .filter(item => item.person && item.person.intakeStatus !== "PROVISIONAL" && relationshipStrength(item.person.iimlRelationship) && responsive(item.person.status))
    .sort((a, b) => b.relation.successfulIntroductions - a.relation.successfulIntroductions)[0]

  const usableContact = Boolean(target.email || target.phone)
  const verifiedContact = target.emailVerification === "Verified" || target.phoneVerification === "Verified"
  const reliableProfile = target.confidence >= 70 && target.profileMatch !== "Mismatch"
  const directResponses = targetHistory.filter(event => event.responseReceived).length
  const directAttempts = targetHistory.filter(event => event.actionTakenAt && event.eventType !== "Birthday").length
  const poorDirectResponsiveness = target.status === "Contacted" || (directAttempts >= 2 && directResponses === 0)

  let routeType: "Direct" | "Warm" | "No eligible route" = "Direct"
  let intermediary: typeof alumni.$inferSelect | null = null
  let rationale = ""
  if (credible && poorDirectResponsiveness) {
    routeType = "Warm"
    intermediary = credible.person!
    rationale = `${target.name} has weak direct-response evidence. ${intermediary.name} has a confirmed relationship and strong Placement Committee engagement, so a warm introduction is recommended.`
  } else if (usableContact && reliableProfile) {
    routeType = "Direct"
    rationale = `${target.name} has a usable contact route and sufficiently reliable profile data${responsive(target.status) ? ", with positive response history" : ""}. Direct outreach is the shortest credible path.`
  } else if (credible) {
    routeType = "Warm"
    intermediary = credible.person!
    rationale = `${target.name} does not have a sufficiently verified direct contact route. ${intermediary.name} has a confirmed relationship and strong Placement Committee engagement, so a warm introduction is recommended.`
  } else {
    routeType = "No eligible route"
    rationale = `${target.name} does not have a sufficiently usable direct contact route, and no confirmed intermediary relationship is recorded. Refresh or enrich the profile before outreach.`
  }

  await db.transaction(async tx => {
    await tx.insert(activityLog).values({ action: "recommend_route", entityType: "alumnus", entityId: String(target.id), actor: context.displayName,
      details: `${routeType}${intermediary ? ` via ${intermediary.name}` : ""}: ${rationale}` })
    await tx.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity,
      actorName: context.displayName, actorRole: context.role, action: "outreach_route_recommended", entityType: "alumnus",
      entityId: String(target.id), metadataJson: safeAuditMetadata({ routeType, intermediaryId: intermediary?.id ?? null }), result: "success", source: "application" })
  })
  return Response.json({
    routeType, rationale,
    target: { id: target.id, name: target.name, initials: target.initials, company: target.company, title: target.title },
    intermediary: intermediary ? { id: intermediary.id, name: intermediary.name, initials: intermediary.initials, company: intermediary.company, title: intermediary.title } : null,
    evidence: credible ? credible.relation.successfulIntroductions > 0
      ? `Prior introduction confirmed by a committee member (${credible.relation.successfulIntroductions} recorded).`
      : credible.relation.relationshipType : "No confirmed intermediary relationship is recorded.",
    factors: { usableContact, verifiedContact, reliableProfile, directAttempts, directResponses, confirmedIntermediary: Boolean(credible), relationshipType: credible?.relation.relationshipType ?? "", successfulIntroductions: credible?.relation.successfulIntroductions ?? 0 },
  })
}
