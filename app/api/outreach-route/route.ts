import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { activityLog, alumni, alumniRelationships, engagementEvents } from "@/db/schema";
import { appConfig } from "@/lib/app-config";
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security";

async function ensureDemoRelationship() {
  const db = getDb();
  const [neha] = await db.select().from(alumni).where(eq(alumni.name, "Neha Kapoor")).limit(1);
  const [siddharth] = await db.select().from(alumni).where(eq(alumni.name, "Siddharth Jain")).limit(1);
  if (!neha || !siddharth) return;
  await db.insert(alumniRelationships).values({
    intermediaryAlumnusId: siddharth.id,
    targetAlumnusId: neha.id,
    relationshipType: "Confirmed professional relationship",
    evidence: "Manually confirmed professional relationship; Siddharth previously supported a PlaceCom introduction.",
    confirmed: true,
    successfulIntroductions: 1,
    source: "Demonstration relationship evidence",
  }).onConflictDoNothing();
}

function relationshipStrength(value: string) {
  return ["Very strong", "Strong"].includes(value);
}

function responsive(status: string) {
  return ["Responded", "Meeting set"].includes(status);
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM");
    const payload = await request.json() as { targetAlumnusId?: number };
    if (!Number.isInteger(payload.targetAlumnusId)) {
      return Response.json({ error: "Select a target alumnus before requesting a route." }, { status: 400 });
    }
    await ensureDemoRelationship();
    const db = getDb();
    const actor = context.displayName;
    const targetId = Number(payload.targetAlumnusId);
    const [target] = await db.select().from(alumni).where(eq(alumni.id, targetId)).limit(1);
    if (!target) return Response.json({ error: `The selected alumnus is not in ${appConfig.name}.` }, { status: 404 });

    const [relations, targetHistory] = await Promise.all([
      db.select().from(alumniRelationships).where(and(eq(alumniRelationships.targetAlumnusId, targetId), eq(alumniRelationships.confirmed, true))),
      db.select().from(engagementEvents).where(eq(engagementEvents.alumnusId, targetId)),
    ]);
    const intermediaryRows = relations.length
      ? await Promise.all(relations.map(async relation => {
          const [person] = await db.select().from(alumni).where(eq(alumni.id, relation.intermediaryAlumnusId)).limit(1);
          return { relation, person };
        }))
      : [];
    const credible = intermediaryRows
      .filter(item => item.person && relationshipStrength(item.person.iimlRelationship) && responsive(item.person.status))
      .sort((a, b) => b.relation.successfulIntroductions - a.relation.successfulIntroductions)[0];

    const usableContact = Boolean(target.email || target.phone);
    const reliableProfile = target.confidence >= 70 && target.profileMatch !== "Mismatch";
    const directResponses = targetHistory.filter(event => event.responseReceived).length;
    const directAttempts = targetHistory.filter(event => event.actionTakenAt && event.eventType !== "Birthday").length;
    const poorDirectResponsiveness = target.status === "Contacted" || (directAttempts >= 2 && directResponses === 0);

    let routeType: "Direct" | "Warm" | "No eligible route" = "Direct";
    let intermediary = null as typeof alumni.$inferSelect | null;
    let rationale = "";
    if (credible && poorDirectResponsiveness) {
      routeType = "Warm";
      intermediary = credible.person!;
      rationale = `${target.name} has weak direct-response evidence. ${intermediary.name} has a confirmed relationship with ${target.name}, a strong PlaceCom relationship and ${credible.relation.successfulIntroductions} recorded successful introduction${credible.relation.successfulIntroductions === 1 ? "" : "s"}.`;
    } else if (usableContact && reliableProfile) {
      routeType = "Direct";
      rationale = `${target.name} has a usable contact route and sufficiently reliable professional data${responsive(target.status) ? ", with positive direct-response history" : ""}. ${credible ? "The recorded intermediary does not currently offer a material advantage" : "No confirmed intermediary relationship is recorded"}, so direct outreach remains the shortest credible path.`;
    } else if (credible) {
      routeType = "Warm";
      intermediary = credible.person!;
      rationale = `${target.name} does not currently have a sufficiently usable direct contact route. ${intermediary.name} has a confirmed relationship and strong PlaceCom engagement, so a warm introduction is the credible route.`;
    } else {
      routeType = "No eligible route";
      rationale = `${target.name} does not have a sufficiently usable direct contact route, and no confirmed intermediary relationship is recorded. Refresh or enrich the profile before outreach.`;
    }

    await db.insert(activityLog).values({
      action: "recommend_route",
      entityType: "alumnus",
      entityId: String(target.id),
      actor,
      details: `${routeType}${intermediary ? ` via ${intermediary.name}` : ""}: ${rationale}`,
    });
    await writeSecurityAudit(context, { action: "outreach_route_recommended", entityType: "alumnus", entityId: target.id, metadata: { routeType, intermediaryId: intermediary?.id ?? null } });
    return Response.json({
      routeType,
      rationale,
      target: { id: target.id, name: target.name, initials: target.initials, company: target.company, title: target.title },
      intermediary: intermediary ? { id: intermediary.id, name: intermediary.name, initials: intermediary.initials, company: intermediary.company, title: intermediary.title } : null,
      evidence: credible ? credible.relation.evidence : "No confirmed intermediary evidence recorded.",
      factors: { usableContact, reliableProfile, directAttempts, directResponses, confirmedIntermediary: Boolean(credible) },
    });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to recommend an outreach route." }, { status: 500 });
  }
}
