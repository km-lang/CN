import { desc, eq, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, coresignalWebhookCoverage, coresignalWebhookEvents, coresignalWebhookSubscriptions } from "@/db/postgres/schema"

export async function postgresWebhookOverviewRows(page: number) {
  const db = getPostgresDb()
  return Promise.all([
    db.select().from(coresignalWebhookSubscriptions).orderBy(desc(coresignalWebhookSubscriptions.id)).limit(20).offset((page - 1) * 20),
    db.select({ id: coresignalWebhookEvents.id, subscriptionId: coresignalWebhookEvents.subscriptionId, alumnusId: coresignalWebhookEvents.alumnusId, employeeId: coresignalWebhookEvents.employeeId, changeType: coresignalWebhookEvents.changeType, changedFieldsJson: coresignalWebhookEvents.changedFieldsJson, providerAt: coresignalWebhookEvents.providerAt, receivedAt: coresignalWebhookEvents.receivedAt, status: coresignalWebhookEvents.status, errorState: coresignalWebhookEvents.errorState, reviewOutcome: coresignalWebhookEvents.reviewOutcome, collectHistoryId: coresignalWebhookEvents.collectHistoryId, name: alumni.name, company: alumni.company, title: alumni.title }).from(coresignalWebhookEvents).leftJoin(alumni, eq(coresignalWebhookEvents.alumnusId, alumni.id)).orderBy(desc(coresignalWebhookEvents.id)).limit(20).offset((page - 1) * 20),
    db.select({ subscriptionId: coresignalWebhookCoverage.subscriptionId, count: sql<number>`count(*)::integer` }).from(coresignalWebhookCoverage).where(eq(coresignalWebhookCoverage.status, "ACTIVE")).groupBy(coresignalWebhookCoverage.subscriptionId),
  ] as const)
}
