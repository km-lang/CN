import { inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, engagementEvents, providerResponseHistory } from "@/db/schema"
import { fetchLushaContactSignals, normalizeLushaSignals } from "@/lib/lusha-signals"
import { providerConfigured, providerMode, signalsRuntimeStatus } from "@/lib/provider-runtime"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "OPERATE_PCOM")
    const runtime = signalsRuntimeStatus()
    return Response.json({
      provider: "lusha",
      mode: providerMode("lusha"),
      configured: providerConfigured("lusha"),
      liveEnabled: runtime.liveEnabled,
      entitlement: runtime.entitlement,
      scope: ["promotion", "job/company change"],
      requiresManualEntitlementValidation: runtime.entitlement !== "confirmed",
    })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: "Unable to load Professional Signals status." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const payload = await request.json() as { action?: string; alumniIds?: number[]; confirmed?: boolean }
    if (payload.action !== "sync" || payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before a Signals sync." }, { status: 400 })
    const runtime = signalsRuntimeStatus()
    if (providerMode("lusha") !== "live" || !providerConfigured("lusha") || !runtime.liveEnabled || runtime.entitlement !== "confirmed") {
      return Response.json({ error: "Lusha Signals is prepared but disabled until account entitlement and billing behavior are manually validated. No provider call was made." }, { status: 409 })
    }
    const ids = [...new Set(payload.alumniIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
    if (!ids.length) return Response.json({ error: "Select at least one approved alumnus." }, { status: 400 })
    const db = getDb()
    const people = await db.select().from(alumni).where(inArray(alumni.id, ids))
    const eligible = people.filter(person => Boolean(person.lushaPersonId))
    if (!eligible.length) return Response.json({ error: "No selected alumnus has a stable Lusha contact ID." }, { status: 409 })
    const detectedAt = new Date().toISOString()
    const body = await fetchLushaContactSignals(eligible.map(person => ({ alumnusId: person.id, lushaPersonId: person.lushaPersonId })))
    let created = 0
    for (const person of eligible) {
      for (const signal of normalizeLushaSignals(person.id, body, detectedAt)) {
        const [inserted] = await db.insert(engagementEvents).values({
          eventKey: signal.eventKey,
          alumnusId: person.id,
          company: signal.newCompany || person.company,
          eventType: "Professional Signal",
          eventSubtype: signal.eventSubtype,
          eventTitle: signal.title,
          eventDescription: signal.description,
          source: "Lusha Signals",
          sourceReferenceId: signal.providerReferenceId,
          sourceDetectedDate: signal.detectedAt,
          providerEventAt: signal.providerEventAt,
          previousCompany: signal.previousCompany,
          previousRole: signal.previousRole,
          newCompany: signal.newCompany,
          newRole: signal.newRole,
          sourceConfidence: signal.sourceConfidence,
          sourceStatus: signal.sourceStatus,
          eventDate: (signal.providerEventAt || detectedAt).slice(0, 10),
          status: "New",
          createdBy: context.displayName,
          lastUpdatedBy: context.displayName,
        }).onConflictDoNothing().returning()
        if (inserted) created += 1
      }
    }
    await db.insert(providerResponseHistory).values({
      provider: "lusha",
      alumnusName: `${eligible.length} tracked alumni`,
      operation: "Professional Signals Sync",
      mode: "live",
      status: "success",
      creditsUsed: 0,
      providerReportedCredits: null,
      usageState: "reconciliation_required",
      resultCount: created,
      requestSummary: `Promotion and job/company-change signals for ${eligible.length} approved alumni`,
      responseSummary: `${created} new professional signal${created === 1 ? "" : "s"} stored for human review. Alumni profile fields were not changed. Provider usage requires account reconciliation.`,
      requestedBy: context.displayName,
    })
    await writeSecurityAudit(context, { action: "professional_signals_synced", entityType: "engagement_event", metadata: { alumniRequested: eligible.length, eventsCreated: created, provider: "lusha" } })
    return Response.json({ created, checked: eligible.length })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to sync Professional Signals." }, { status: 500 })
  }
}
