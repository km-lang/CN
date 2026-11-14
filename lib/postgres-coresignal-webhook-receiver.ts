import { and, desc, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, coresignalWebhookCoverage, coresignalWebhookEvents, coresignalWebhookIdentities, coresignalWebhookSubscriptions } from "@/db/postgres/schema"
import { parseWebhookNotices, sha256 } from "@/lib/coresignal-webhooks"

/** Persist callback notices only; collection and canonical profile changes require separate review. */
export async function postgresReceiveCoresignalWebhook(id: number, readBody: () => Promise<unknown>): Promise<Response> {
  const db = getPostgresDb()
  const [initial] = await db.select({ providerSubscriptionId: coresignalWebhookSubscriptions.providerSubscriptionId,
    status: coresignalWebhookSubscriptions.status }).from(coresignalWebhookSubscriptions)
    .where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!initial || !initial.providerSubscriptionId || !["ACTIVE", "RENEWAL_DUE", "EXPIRED"].includes(initial.status)) {
    return Response.json({ error: "Unknown or stopped subscription." }, { status: 404 })
  }
  const notices = parseWebhookNotices(await readBody())
  const now = new Date()
  const receivedAt = now.toISOString()
  const digests = await Promise.all(notices.map(notice => sha256(JSON.stringify({ employeeId: notice.employeeId,
    changeType: notice.changeType, changedFields: notice.changedFields, providerAt: notice.providerAt, eventId: notice.eventId }))))
  return db.transaction(async tx => {
    // Serialize callbacks for a subscription so out-of-order decisions survive competing deliveries.
    const [plan] = await tx.select().from(coresignalWebhookSubscriptions)
      .where(eq(coresignalWebhookSubscriptions.id, id)).for("update").limit(1)
    if (!plan || !plan.providerSubscriptionId || !["ACTIVE", "RENEWAL_DUE", "EXPIRED"].includes(plan.status)) {
      return Response.json({ error: "Unknown or stopped subscription." }, { status: 404 })
    }
    const coverage = await tx.select({ employeeId: coresignalWebhookCoverage.employeeId, alumnusId: coresignalWebhookCoverage.alumnusId,
      savedEmployeeId: alumni.coresignalEmployeeId, intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch,
      attestedEmployeeId: coresignalWebhookIdentities.employeeId, namespace: coresignalWebhookIdentities.namespace,
      identityStatus: coresignalWebhookIdentities.status }).from(coresignalWebhookCoverage)
      .innerJoin(alumni, eq(coresignalWebhookCoverage.alumnusId, alumni.id))
      .leftJoin(coresignalWebhookIdentities, eq(coresignalWebhookCoverage.alumnusId, coresignalWebhookIdentities.alumnusId))
      .where(and(eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.status, "ACTIVE")))
    const byEmployee = new Map(coverage.map(item => [item.employeeId, item]))
    const latestByEmployee = new Map<string, string>()
    for (const employeeId of new Set(notices.map(notice => notice.employeeId))) {
      const [latest] = await tx.select({ providerAt: coresignalWebhookEvents.providerAt }).from(coresignalWebhookEvents)
        .where(and(eq(coresignalWebhookEvents.subscriptionId, id), eq(coresignalWebhookEvents.employeeId, employeeId)))
        .orderBy(desc(coresignalWebhookEvents.providerAt)).limit(1)
      latestByEmployee.set(employeeId, latest?.providerAt ?? "")
    }
    let stored = 0
    for (const [index, notice] of notices.entries()) {
      const latestAt = latestByEmployee.get(notice.employeeId) ?? ""
      const outOfOrder = Boolean(notice.providerAt && latestAt && Date.parse(notice.providerAt) < Date.parse(latestAt))
      if (notice.providerAt && (!latestAt || Date.parse(notice.providerAt) > Date.parse(latestAt))) latestByEmployee.set(notice.employeeId, notice.providerAt)
      const mapped = byEmployee.get(notice.employeeId)
      const reliable = mapped?.savedEmployeeId === notice.employeeId && mapped?.attestedEmployeeId === notice.employeeId
        && mapped?.namespace === "employee_base" && mapped?.identityStatus === "VERIFIED"
        && mapped?.intakeStatus !== "PROVISIONAL" && mapped?.profileMatch !== "Mismatch"
      const expired = plan.status === "EXPIRED" || Boolean(plan.expiresAt && Date.parse(plan.expiresAt) <= now.getTime())
      const status = !mapped ? "QUARANTINED_UNKNOWN_ID" : !reliable ? "QUARANTINED_IDENTITY_CONFLICT"
        : expired || outOfOrder ? "REVIEW_REQUIRED" : notice.changeType === "changed" ? "AWAITING_PROFILE_COLLECTION" : "REVIEW_REQUIRED"
      const errorState = !mapped ? "UNKNOWN_EMPLOYEE_ID" : !reliable ? "IDENTITY_MAPPING_CHANGED"
        : expired ? "SUBSCRIPTION_EXPIRED" : outOfOrder ? "OUT_OF_ORDER" : ""
      const dedupeWindow = notice.eventId ? "provider-event-id" : notice.providerAt ? "provider-event-time" : receivedAt.slice(0, 13)
      const [inserted] = await tx.insert(coresignalWebhookEvents).values({ subscriptionId: id, alumnusId: reliable ? mapped!.alumnusId : null,
        employeeId: notice.employeeId, changeType: notice.changeType, changedFieldsJson: JSON.stringify(notice.changedFields),
        providerAt: notice.providerAt, receivedAt, payloadDigest: digests[index], dedupeWindow, status, errorState })
        .onConflictDoNothing().returning({ id: coresignalWebhookEvents.id })
      if (inserted) stored++
    }
    return Response.json({ stored, duplicates: notices.length - stored, providerRequests: 0, canonicalMutations: 0 },
      { status: 202, headers: { "cache-control": "no-store" } })
  })
}
