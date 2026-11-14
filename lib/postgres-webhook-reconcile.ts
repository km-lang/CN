import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { coresignalWebhookCoverage, coresignalWebhookOperations, coresignalWebhookSubscriptions } from "@/db/postgres/schema"
import { coverageReconciliation } from "@/lib/coresignal-webhooks"
import { postgresWebhookSelectionPlan, type SelectionInput } from "@/lib/postgres-webhook-selection"
import type { SecurityContext } from "@/lib/security"

const MAX_PREPARED = 100

/** Save only a membership preview. This never edits provider membership or credit balances. */
export async function postgresWebhookReconcile(subscriptionId: unknown, actor: SecurityContext): Promise<Response> {
  if (!Number.isSafeInteger(subscriptionId) || Number(subscriptionId) < 1) throw new Error("A saved monitoring subscription is required.")
  const id = Number(subscriptionId)
  const db = getPostgresDb()
  const [plan] = await db.select().from(coresignalWebhookSubscriptions).where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!plan) throw new Error("Monitoring subscription was not found.")
  const preview = await postgresWebhookSelectionPlan({ cohortType: plan.cohortType as SelectionInput["cohortType"],
    selection: plan.cohortType === "DYNAMIC_FILTER" ? JSON.parse(plan.selectionJson) : undefined,
    ids: plan.cohortType === "FIXED_IDS" ? JSON.parse(plan.selectionJson) : undefined })
  const current = await db.select().from(coresignalWebhookCoverage).where(and(eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.status, "ACTIVE")))
  const currentIds = new Set(current.map(item => item.employeeId))
  const intended = preview.classified.filter(item => item.status === "ELIGIBLE" || (item.status === "ALREADY_COVERED" && currentIds.has(item.employeeId))).map(item => item.employeeId)
  const changes = coverageReconciliation(intended, [...currentIds])
  await db.transaction(async tx => {
    await tx.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: "RECONCILE_PREVIEW", requestKey: crypto.randomUUID(), actor: actor.displayName,
      status: "PREVIEW_ONLY", requestJson: JSON.stringify({ selectionVersion: preview.selectionVersion }),
      responseJson: JSON.stringify({ add: changes.add.length, remove: changes.remove.length, unchanged: changes.unchanged.length }) })
    await tx.update(coresignalWebhookSubscriptions).set({ lastReconciledAt: new Date().toISOString() }).where(eq(coresignalWebhookSubscriptions.id, id))
  })
  return Response.json({ changes: { ...changes, add: changes.add.slice(0, MAX_PREPARED) }, remainingAdditions: Math.max(0, changes.add.length - MAX_PREPARED),
    counts: preview.counts, providerRequests: 0, nextAction: "Review bounded changes; provider membership has not been edited." })
}
