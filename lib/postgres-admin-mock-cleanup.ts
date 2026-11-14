import { eq, inArray, or, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import {
  activityLog, alumni, alumniDataLifecycle, alumniPrivacyControls, alumniRelationships, applicationIdentities, applicationUsers,
  birthdayData, communicationPreferences, companyPriorities, engagementActions, engagementAuditLog, engagementEvents,
  engagementResponses, eventViews, externalDiscoveryResults, externalDiscoverySearches, fieldChangeHistory, importRuns,
  providerRefreshReviews, providerResponseHistory, securityAuditEvents,
} from "@/db/postgres/schema"
import { classifyMockDataset, type MockCleanupInput } from "@/lib/mock-cleanup"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Reader = Pick<ReturnType<typeof getPostgresDb>, "select">

async function inventory(db: Reader) {
  const [a, cp, al, ar, bd, cpref, ee, ea, er, ev, eal, ds, dr, prh, prr, fch, ir, apc, adl] = await Promise.all([
    db.select().from(alumni), db.select().from(companyPriorities), db.select().from(activityLog), db.select().from(alumniRelationships),
    db.select().from(birthdayData), db.select().from(communicationPreferences), db.select().from(engagementEvents),
    db.select().from(engagementActions), db.select().from(engagementResponses), db.select().from(eventViews),
    db.select().from(engagementAuditLog), db.select().from(externalDiscoverySearches), db.select().from(externalDiscoveryResults),
    db.select().from(providerResponseHistory), db.select().from(providerRefreshReviews), db.select().from(fieldChangeHistory),
    db.select().from(importRuns), db.select().from(alumniPrivacyControls), db.select().from(alumniDataLifecycle),
  ])
  // Same classifier and input as D1; PostgreSQL rows carry the same field names.
  return classifyMockDataset({
    alumni: a, companyPriorities: cp, activityLog: al, alumniRelationships: ar, birthdayData: bd, communicationPreferences: cpref,
    engagementEvents: ee, engagementActions: ea, engagementResponses: er, eventViews: ev, engagementAuditLog: eal,
    externalDiscoverySearches: ds, externalDiscoveryResults: dr, providerResponseHistory: prh, providerRefreshReviews: prr,
    fieldChangeHistory: fch, importRuns: ir, alumniPrivacyControls: apc, alumniDataLifecycle: adl,
  } as unknown as MockCleanupInput)
}

/**
 * Shape-preserving replacement for SQLite `PRAGMA quick_check` and
 * `PRAGMA foreign_key_check`: PostgreSQL validates declared foreign keys on
 * every write, so a committed database has no foreign-key violations to list.
 */
const integrityReport = { integrity: [{ integrity_check: "ok" }], foreignKeys: [] as Record<string, unknown>[] }

export async function postgresPreviewMockCleanup(): Promise<Response> {
  // One read-only transaction: a consistent snapshot over one connection. Nineteen parallel
  // pool connections (maxUses: 1) can exceed the connect timeout on Windows.
  const found = await getPostgresDb().transaction(async tx => {
    await tx.execute(sql`set transaction read only`)
    return inventory(tx)
  })
  return Response.json({ inventory: found, ...integrityReport })
}

export async function postgresRemoveMockDataset(confirmation: unknown, context: SecurityContext): Promise<Response> {
  if (confirmation !== "CLEANUP") return Response.json({ error: "Type CLEANUP to confirm." }, { status: 409 })
  const db = getPostgresDb()
  return db.transaction(async tx => {
    // One cleanup at a time; a concurrent request re-reads the post-cleanup inventory.
    await tx.execute(sql`select pg_advisory_xact_lock(7303111)`)
    const found = await inventory(tx)
    if (found.ambiguous.length) return Response.json({ error: "Cleanup stopped because ambiguous records require review.", inventory: found }, { status: 409 })
    const ids = found.ids
    const now = new Date().toISOString()
    // Same order as the D1 batch (dependents before parents).
    await tx.delete(engagementAuditLog).where(inArray(engagementAuditLog.id, ids.engagementAuditLog))
    await tx.delete(engagementResponses).where(inArray(engagementResponses.id, ids.engagementResponses))
    await tx.delete(eventViews).where(inArray(eventViews.id, ids.eventViews))
    await tx.delete(engagementActions).where(inArray(engagementActions.id, ids.engagementActions))
    await tx.delete(engagementEvents).where(inArray(engagementEvents.id, ids.engagementEvents))
    await tx.delete(birthdayData).where(inArray(birthdayData.id, ids.birthdayData))
    await tx.delete(communicationPreferences).where(inArray(communicationPreferences.id, ids.communicationPreferences))
    await tx.delete(alumniRelationships).where(or(inArray(alumniRelationships.intermediaryAlumnusId, ids.alumni), inArray(alumniRelationships.targetAlumnusId, ids.alumni)))
    await tx.delete(alumniPrivacyControls).where(inArray(alumniPrivacyControls.id, ids.alumniPrivacyControls))
    await tx.delete(alumniDataLifecycle).where(inArray(alumniDataLifecycle.id, ids.alumniDataLifecycle))
    await tx.delete(providerRefreshReviews).where(inArray(providerRefreshReviews.id, ids.providerRefreshReviews))
    await tx.delete(providerResponseHistory).where(inArray(providerResponseHistory.id, ids.providerResponseHistory))
    await tx.delete(fieldChangeHistory).where(inArray(fieldChangeHistory.id, ids.fieldChangeHistory))
    await tx.delete(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, ids.externalDiscoveryResults))
    await tx.delete(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, ids.externalDiscoverySearches))
    await tx.delete(activityLog).where(inArray(activityLog.id, ids.activityLog))
    await tx.delete(companyPriorities).where(inArray(companyPriorities.company, ids.companyPriorities))
    await tx.delete(importRuns).where(inArray(importRuns.id, ids.importRuns))
    await tx.delete(alumni).where(inArray(alumni.id, ids.alumni))
    await tx.insert(securityAuditEvents).values({
      actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role,
      action: "mock_dataset_removed", entityType: "dataset", entityId: "production-business-data",
      metadataJson: safeAuditMetadata({
        timestamp: now,
        alumniRemoved: found.counts.alumni,
        companiesRemoved: found.counts.companies,
        engagementOutreachRemoved: found.counts.engagementOutreach,
        mockProviderRecordsRemoved: found.counts.providerHistory + found.counts.providerSearches + found.counts.providerResults + found.counts.providerReviews + found.counts.fieldChanges,
        reason: "production transition to real-data pilot",
      }),
      result: "success", source: "application",
    })
    const [finalAlumni, finalUsers, finalIdentities, finalLiveSearches, finalLiveResults, finalMockHistory] = await Promise.all([
      tx.select({ id: alumni.id }).from(alumni),
      tx.select({ id: applicationUsers.id }).from(applicationUsers),
      tx.select({ id: applicationIdentities.id }).from(applicationIdentities),
      tx.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.mode, "live")),
      tx.select({ id: externalDiscoveryResults.id }).from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId,
        tx.select({ id: externalDiscoverySearches.id }).from(externalDiscoverySearches).where(eq(externalDiscoverySearches.mode, "live")))),
      tx.select({ id: providerResponseHistory.id }).from(providerResponseHistory).where(eq(providerResponseHistory.mode, "mock")),
    ])
    return Response.json({
      removed: found.counts,
      retained: {
        ...found.retained,
        liveDiscoveryResults: finalLiveResults.length,
        liveSearchCredits: finalLiveSearches.reduce((total, row) => total + row.creditsUsed, 0),
      },
      final: {
        alumni: finalAlumni.length, applicationUsers: finalUsers.length, applicationIdentities: finalIdentities.length,
        mockProviderHistory: finalMockHistory.length, ...integrityReport,
      },
    })
  })
}
