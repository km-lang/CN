import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { brightdataSnapshotEvidence, providerCollectionAttempts, providerResponseHistory } from "@/db/postgres/schema"
import { brightDataRuntimeStatus } from "@/lib/provider-runtime"

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }

export async function postgresBrightRead(publicAttempt: (row: typeof providerCollectionAttempts.$inferSelect, snapshot?: Pick<typeof brightdataSnapshotEvidence.$inferSelect, "attemptId" | "returnedUrl" | "canonicalReturnedUrl" | "identityUrlStatus" | "requestedAt" | "retrievedAt" | "providerTimestampJson" | "normalizerVersion" | "rawSha256" | "retentionUntil">) => unknown) {
  const db = getPostgresDb()
  const runtime = brightDataRuntimeStatus()
  const [attempts, usage, count] = await Promise.all([
    db.select().from(providerCollectionAttempts).where(eq(providerCollectionAttempts.provider, "brightdata")).orderBy(desc(providerCollectionAttempts.id)).limit(25),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, "brightdata"), gte(providerResponseHistory.createdAt, monthStart()))),
    db.select({ used: sql<number>`count(*)::integer` }).from(providerCollectionAttempts).where(and(eq(providerCollectionAttempts.provider, "brightdata"), gte(providerCollectionAttempts.createdAt, monthStart()))),
  ])
  const metadata = attempts.length ? await db.select({ attemptId: brightdataSnapshotEvidence.attemptId, returnedUrl: brightdataSnapshotEvidence.returnedUrl, canonicalReturnedUrl: brightdataSnapshotEvidence.canonicalReturnedUrl,
    identityUrlStatus: brightdataSnapshotEvidence.identityUrlStatus, requestedAt: brightdataSnapshotEvidence.requestedAt, retrievedAt: brightdataSnapshotEvidence.retrievedAt,
    providerTimestampJson: brightdataSnapshotEvidence.providerTimestampJson, normalizerVersion: brightdataSnapshotEvidence.normalizerVersion, rawSha256: brightdataSnapshotEvidence.rawSha256, retentionUntil: brightdataSnapshotEvidence.retentionUntil })
    .from(brightdataSnapshotEvidence).where(inArray(brightdataSnapshotEvidence.attemptId, attempts.map(row => row.id))) : []
  const byAttempt = new Map(metadata.map(item => [item.attemptId, item]))
  const used = Math.max(Number(usage[0]?.used ?? 0), Number(count[0]?.used ?? 0))
  return Response.json({ runtime: { ...runtime, applicationBudget: { used, limit: runtime.applicationRequestLimit, remaining: Math.max(0, runtime.applicationRequestLimit - used) }, maximumTargets: 1, automaticRetries: 0, automaticPolling: false, providerBillingKnown: false }, attempts: attempts.map(row => publicAttempt(row, byAttempt.get(row.id))) })
}
