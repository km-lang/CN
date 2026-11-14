import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, coresignalWebhookIdentities, coresignalWebhookSubscriptions, securityAuditEvents } from "@/db/postgres/schema"
import { postgresWebhookSelectionPlan, type SelectionInput } from "@/lib/postgres-webhook-selection"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

function validId(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null }
function audit(actor: SecurityContext, action: string, entityType: string, entityId: number, metadata: Record<string, unknown>) {
  return { actorUserId: actor.userId, actorIdentity: actor.externalIdentity, actorName: actor.displayName, actorRole: actor.role,
    action, entityType, entityId: String(entityId), metadataJson: safeAuditMetadata(metadata), result: "success", source: "application" }
}

export async function postgresWebhookAttest(body: { alumnusId?: number; evidenceReference?: string; confirmation?: string }, actor: SecurityContext): Promise<Response> {
  const id = validId(body.alumnusId)
  const evidenceReference = body.evidenceReference?.trim() ?? ""
  if (!id || !evidenceReference || (body.evidenceReference?.length ?? 0) > 300 || body.confirmation !== "VERIFY_BASE_EMPLOYEE_ID") throw new Error("Exact Base Employee mapping verification and evidence reference are required.")
  const db = getPostgresDb()
  await db.transaction(async tx => {
    const [person] = await tx.select().from(alumni).where(eq(alumni.id, id)).limit(1)
    if (!person || !/^\d{1,18}$/.test(person.coresignalEmployeeId) || person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") throw new Error("This saved identity is not eligible for Base Employee attestation.")
    const [created] = await tx.insert(coresignalWebhookIdentities).values({ alumnusId: id, employeeId: person.coresignalEmployeeId,
      evidenceReference, verifiedBy: actor.displayName }).onConflictDoNothing().returning({ id: coresignalWebhookIdentities.id })
    if (!created) throw new Error("An attestation already exists; identity changes require separate review.")
    await tx.insert(securityAuditEvents).values(audit(actor, "coresignal_base_employee_id_attested", "alumni", id,
      { employeeId: person.coresignalEmployeeId, evidenceReference }))
  })
  return Response.json({ alumnusId: id, status: "VERIFIED", providerRequests: 0 })
}

export async function postgresWebhookPrepare(body: SelectionInput & { name?: string }, actor: SecurityContext): Promise<Response> {
  const preview = await postgresWebhookSelectionPlan(body)
  if (!body.name?.trim() || body.name.length > 120 || !preview.eligible.length) throw new Error("Name and at least one verified, uncovered Base Employee ID are required.")
  const db = getPostgresDb()
  const plan = await db.transaction(async tx => {
    const [created] = await tx.insert(coresignalWebhookSubscriptions).values({ name: body.name!.trim(), cohortType: body.cohortType,
      selectionJson: preview.selectionJson, selectionVersion: preview.selectionVersion, membershipJson: JSON.stringify(preview.eligible),
      createdBy: actor.displayName }).returning()
    await tx.insert(securityAuditEvents).values(audit(actor, "coresignal_webhook_plan_prepared", "coresignal_webhook_subscriptions", created.id,
      { memberCount: preview.eligible.length, selectionVersion: preview.selectionVersion, providerRequests: 0 }))
    return created
  })
  return Response.json({ id: plan.id, status: plan.status, employeeIds: preview.eligible.map(item => item.employeeId),
    selectedCount: preview.selectedCount, preparedCount: preview.eligible.length, remainingEligible: preview.remainingEligible, providerRequests: 0 })
}
