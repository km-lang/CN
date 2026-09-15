import { and, desc, eq, inArray, or, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  activityLog,
  alumni,
  alumniDataLifecycle,
  alumniPrivacyControls,
  alumniRelationships,
  applicationIdentities,
  applicationUsers,
  birthdayData,
  communicationPreferences,
  companyPriorities,
  engagementActions,
  engagementAuditLog,
  engagementEvents,
  engagementResponses,
  eventViews,
  externalDiscoveryResults,
  externalDiscoverySearches,
  fieldChangeHistory,
  importRuns,
  providerRefreshReviews,
  providerResponseHistory,
  providerSettings,
  securityAuditEvents,
} from "@/db/schema"
import { InvalidEmailError, isLikelyInstitutionalEmailTypo, normalizeEmail } from "@/lib/email-identity"
import { classifyMockDataset } from "@/lib/mock-cleanup"
import { mailConfiguration, mailRuntimeStatus } from "@/lib/mail-service"
import { providerConfigured, providerMode, signalsRuntimeStatus } from "@/lib/provider-runtime"
import { accessErrorResponse, authorizeRequest, isApplicationRole, writeSecurityAudit } from "@/lib/security"
import { safeAuditMetadata } from "@/lib/security-policy"

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max)
}

async function mockCleanupInventory() {
  const db = getDb()
  const [
    alumniRows,
    companyPriorityRows,
    activityRows,
    relationshipRows,
    birthdayRows,
    communicationRows,
    eventRows,
    actionRows,
    responseRows,
    viewRows,
    engagementAuditRows,
    searchRows,
    discoveryResultRows,
    providerHistoryRows,
    providerReviewRows,
    fieldChangeRows,
    importRows,
    privacyRows,
    lifecycleRows,
  ] = await Promise.all([
    db.select().from(alumni),
    db.select().from(companyPriorities),
    db.select().from(activityLog),
    db.select().from(alumniRelationships),
    db.select().from(birthdayData),
    db.select().from(communicationPreferences),
    db.select().from(engagementEvents),
    db.select().from(engagementActions),
    db.select().from(engagementResponses),
    db.select().from(eventViews),
    db.select().from(engagementAuditLog),
    db.select().from(externalDiscoverySearches),
    db.select().from(externalDiscoveryResults),
    db.select().from(providerResponseHistory),
    db.select().from(providerRefreshReviews),
    db.select().from(fieldChangeHistory),
    db.select().from(importRuns),
    db.select().from(alumniPrivacyControls),
    db.select().from(alumniDataLifecycle),
  ])
  return classifyMockDataset({
    alumni: alumniRows,
    companyPriorities: companyPriorityRows,
    activityLog: activityRows,
    alumniRelationships: relationshipRows,
    birthdayData: birthdayRows,
    communicationPreferences: communicationRows,
    engagementEvents: eventRows,
    engagementActions: actionRows,
    engagementResponses: responseRows,
    eventViews: viewRows,
    engagementAuditLog: engagementAuditRows,
    externalDiscoverySearches: searchRows,
    externalDiscoveryResults: discoveryResultRows,
    providerResponseHistory: providerHistoryRows,
    providerRefreshReviews: providerReviewRows,
    fieldChangeHistory: fieldChangeRows,
    importRuns: importRows,
    alumniPrivacyControls: privacyRows,
    alumniDataLifecycle: lifecycleRows,
  })
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_USERS")
    const db = getDb()
    const [users, identities, audit, lifecycle, providerLimits] = await Promise.all([
      db.select().from(applicationUsers).orderBy(applicationUsers.displayName),
      db.select({ id: applicationIdentities.id, applicationUserId: applicationIdentities.applicationUserId, provider: applicationIdentities.provider, verifiedEmail: applicationIdentities.verifiedEmail, providerDomain: applicationIdentities.providerDomain, lastAuthenticatedAt: applicationIdentities.lastAuthenticatedAt }).from(applicationIdentities).orderBy(applicationIdentities.provider),
      db.select().from(securityAuditEvents).orderBy(desc(securityAuditEvents.createdAt), desc(securityAuditEvents.id)).limit(200),
      db.select().from(alumniDataLifecycle).orderBy(desc(alumniDataLifecycle.updatedAt)),
      db.select().from(providerSettings).orderBy(providerSettings.provider),
    ])
    return Response.json({
      users: users.map(user => ({ ...user, identities: identities.filter(identity => identity.applicationUserId === user.id) })),
      audit,
      lifecycle,
      providerLimits,
      operationalReadiness: {
        pdl: { mode: providerMode("pdl"), configured: providerConfigured("pdl") },
        lushaContacts: { mode: providerMode("lusha"), configured: providerConfigured("lusha") },
        signals: signalsRuntimeStatus(),
        mail: { ...mailRuntimeStatus(), ...mailConfiguration() },
      },
    })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load administration data." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_USERS")
    const payload = await request.json() as { action?: string; userId?: number; correctUserId?: number; email?: string; displayName?: string; role?: string; enabled?: boolean; alumnusId?: number; status?: string; notes?: string; confirmation?: string; confirmSimilarEmail?: boolean }
    const db = getDb()
    const now = new Date().toISOString()

    if (payload.action === "preview_mock_cleanup") {
      const inventory = await mockCleanupInventory()
      const [quickCheck, foreignKeys] = await Promise.all([
        db.all<{ quick_check: string }>(sql.raw("PRAGMA quick_check")),
        db.all<Record<string, unknown>>(sql.raw("PRAGMA foreign_key_check")),
      ])
      return Response.json({
        inventory,
        integrity: quickCheck.map(row => ({ integrity_check: row.quick_check })),
        foreignKeys,
      })
    }

    if (payload.action === "remove_mock_dataset") {
      if (payload.confirmation !== "REMOVE MOCK DATASET") {
        return Response.json({ error: "Type REMOVE MOCK DATASET to confirm." }, { status: 409 })
      }
      const inventory = await mockCleanupInventory()
      if (inventory.ambiguous.length) {
        return Response.json({ error: "Cleanup stopped because ambiguous records require review.", inventory }, { status: 409 })
      }
      const ids = inventory.ids
      await db.batch([
        db.delete(engagementAuditLog).where(inArray(engagementAuditLog.id, ids.engagementAuditLog)),
        db.delete(engagementResponses).where(inArray(engagementResponses.id, ids.engagementResponses)),
        db.delete(eventViews).where(inArray(eventViews.id, ids.eventViews)),
        db.delete(engagementActions).where(inArray(engagementActions.id, ids.engagementActions)),
        db.delete(engagementEvents).where(inArray(engagementEvents.id, ids.engagementEvents)),
        db.delete(birthdayData).where(inArray(birthdayData.id, ids.birthdayData)),
        db.delete(communicationPreferences).where(inArray(communicationPreferences.id, ids.communicationPreferences)),
        db.delete(alumniRelationships).where(or(
          inArray(alumniRelationships.intermediaryAlumnusId, ids.alumni),
          inArray(alumniRelationships.targetAlumnusId, ids.alumni),
        )),
        db.delete(alumniPrivacyControls).where(inArray(alumniPrivacyControls.id, ids.alumniPrivacyControls)),
        db.delete(alumniDataLifecycle).where(inArray(alumniDataLifecycle.id, ids.alumniDataLifecycle)),
        db.delete(providerRefreshReviews).where(inArray(providerRefreshReviews.id, ids.providerRefreshReviews)),
        db.delete(providerResponseHistory).where(inArray(providerResponseHistory.id, ids.providerResponseHistory)),
        db.delete(fieldChangeHistory).where(inArray(fieldChangeHistory.id, ids.fieldChangeHistory)),
        db.delete(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, ids.externalDiscoveryResults)),
        db.delete(externalDiscoverySearches).where(inArray(externalDiscoverySearches.id, ids.externalDiscoverySearches)),
        db.delete(activityLog).where(inArray(activityLog.id, ids.activityLog)),
        db.delete(companyPriorities).where(inArray(companyPriorities.company, ids.companyPriorities)),
        db.delete(importRuns).where(inArray(importRuns.id, ids.importRuns)),
        db.delete(alumni).where(inArray(alumni.id, ids.alumni)),
        db.insert(securityAuditEvents).values({
          actorUserId: context.userId,
          actorIdentity: context.externalIdentity,
          actorName: context.displayName,
          actorRole: context.role,
          action: "mock_dataset_removed",
          entityType: "dataset",
          entityId: "production-business-data",
          metadataJson: safeAuditMetadata({
            timestamp: now,
            alumniRemoved: inventory.counts.alumni,
            companiesRemoved: inventory.counts.companies,
            engagementOutreachRemoved: inventory.counts.engagementOutreach,
            mockProviderRecordsRemoved: inventory.counts.providerHistory + inventory.counts.providerSearches + inventory.counts.providerResults + inventory.counts.providerReviews + inventory.counts.fieldChanges,
            reason: "production transition to real-data pilot",
          }),
          result: "success",
          source: "application",
          createdAt: now,
        }),
      ])
      const [finalAlumni, finalUsers, finalIdentities, finalLiveSearches, finalLiveResults, finalMockHistory, integrity, foreignKeys] = await Promise.all([
        db.select({ id: alumni.id }).from(alumni),
        db.select({ id: applicationUsers.id }).from(applicationUsers),
        db.select({ id: applicationIdentities.id }).from(applicationIdentities),
        db.select().from(externalDiscoverySearches).where(eq(externalDiscoverySearches.mode, "live")),
        db.select({ id: externalDiscoveryResults.id }).from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.searchId,
          db.select({ id: externalDiscoverySearches.id }).from(externalDiscoverySearches).where(eq(externalDiscoverySearches.mode, "live")),
        )),
        db.select({ id: providerResponseHistory.id }).from(providerResponseHistory).where(eq(providerResponseHistory.mode, "mock")),
        db.all<{ quick_check: string }>(sql.raw("PRAGMA quick_check")),
        db.all<Record<string, unknown>>(sql.raw("PRAGMA foreign_key_check")),
      ])
      return Response.json({
        removed: inventory.counts,
        retained: {
          ...inventory.retained,
          liveDiscoveryResults: finalLiveResults.length,
          liveSearchCredits: finalLiveSearches.reduce((total, row) => total + row.creditsUsed, 0),
        },
        final: {
          alumni: finalAlumni.length,
          applicationUsers: finalUsers.length,
          applicationIdentities: finalIdentities.length,
          mockProviderHistory: finalMockHistory.length,
          integrity: integrity.map(row => ({ integrity_check: row.quick_check })),
          foreignKeys,
        },
      })
    }

    if (payload.action === "authorize_user") {
      const email = normalizeEmail(payload.email)
      const displayName = clean(payload.displayName, 160) || email
      if (!isApplicationRole(payload.role)) return Response.json({ error: "Enter a valid email and role." }, { status: 400 })
      const users = await db.select().from(applicationUsers)
      const exactUser = users.find(user => normalizeEmail(user.email) === email)
      const similarUser = users.find(user => isLikelyInstitutionalEmailTypo(email, user.email, displayName, user.displayName))
      if (!exactUser && similarUser && payload.confirmSimilarEmail !== true) {
        return Response.json({
          error: "Possible similar authorized user found.",
          code: "possible_similar_user",
          enteredEmail: email,
          similarUser: { id: similarUser.id, email: similarUser.email, displayName: similarUser.displayName },
        }, { status: 409 })
      }
      const [user] = exactUser
        ? await db.update(applicationUsers).set({ email, displayName, role: payload.role, enabled: true, updatedAt: now }).where(eq(applicationUsers.id, exactUser.id)).returning()
        : await db.insert(applicationUsers).values({ email, displayName, role: payload.role, enabled: true, updatedAt: now }).returning()
      await writeSecurityAudit(context, { action: "user_authorized", entityType: "application_user", entityId: user.id, metadata: { role: user.role, enabled: user.enabled } })
      return Response.json({ user }, { status: 201 })
    }

    if (payload.action === "correct_pre_authorization" && Number.isInteger(payload.userId) && Number.isInteger(payload.correctUserId)) {
      const duplicateId = payload.userId!
      const correctUserId = payload.correctUserId!
      if (payload.confirmation !== `CORRECT USER ${duplicateId}`) return Response.json({ error: `Type CORRECT USER ${duplicateId} to confirm.` }, { status: 409 })
      if (duplicateId === context.userId || duplicateId === correctUserId) return Response.json({ error: "This user correction is not permitted." }, { status: 409 })
      const [duplicate, correctUser, duplicateIdentities, actorEvents] = await Promise.all([
        db.select().from(applicationUsers).where(eq(applicationUsers.id, duplicateId)).limit(1).then(rows => rows[0]),
        db.select().from(applicationUsers).where(eq(applicationUsers.id, correctUserId)).limit(1).then(rows => rows[0]),
        db.select({ id: applicationIdentities.id }).from(applicationIdentities).where(eq(applicationIdentities.applicationUserId, duplicateId)).limit(1),
        db.select({ id: securityAuditEvents.id }).from(securityAuditEvents).where(eq(securityAuditEvents.actorUserId, duplicateId)).limit(1),
      ])
      if (!duplicate || !correctUser) return Response.json({ error: "The requested user record was not found." }, { status: 404 })
      if (duplicate.enabled || duplicate.lastLoginAt || duplicateIdentities.length || actorEvents.length) return Response.json({ error: "Only a disabled, never-authenticated and unlinked pre-authorization can be corrected." }, { status: 409 })
      if (!correctUser.enabled || duplicate.role !== correctUser.role || !isLikelyInstitutionalEmailTypo(duplicate.email, correctUser.email, duplicate.displayName, correctUser.displayName)) {
        return Response.json({ error: "The proposed correction does not match a conservative institutional-email typo." }, { status: 409 })
      }
      const correctionEvent = db.insert(securityAuditEvents).values({
        actorUserId: context.userId,
        actorIdentity: context.externalIdentity,
        actorName: context.displayName,
        actorRole: context.role,
        action: "user_pre_authorization_corrected",
        entityType: "application_user",
        entityId: String(duplicate.id),
        metadataJson: safeAuditMetadata({
          reason: `Institutional email was entered incorrectly as ${duplicate.email}.`,
          incorrectUser: { id: duplicate.id, email: duplicate.email },
          correctUser: { id: correctUser.id, email: correctUser.email },
        }),
        result: "success",
        source: "application",
        createdAt: now,
      })
      const deleteUser = db.delete(applicationUsers).where(and(eq(applicationUsers.id, duplicate.id), eq(applicationUsers.enabled, false)))
      await db.batch([correctionEvent, deleteUser])
      return Response.json({ corrected: true, deletedUserId: duplicate.id, correctUserId: correctUser.id })
    }

    if ((payload.action === "change_role" || payload.action === "set_user_status") && Number.isInteger(payload.userId)) {
      const [existing] = await db.select().from(applicationUsers).where(eq(applicationUsers.id, payload.userId!)).limit(1)
      if (!existing) return Response.json({ error: "User not found." }, { status: 404 })
      if (existing.id === context.userId && (payload.action === "set_user_status" ? payload.enabled === false : payload.role !== "ADMIN")) {
        return Response.json({ error: "You cannot disable or remove your own Admin access." }, { status: 409 })
      }
      if (payload.action === "change_role" && !isApplicationRole(payload.role)) return Response.json({ error: "Choose a recognized role." }, { status: 400 })
      const changes = payload.action === "change_role" ? { role: payload.role!, updatedAt: now } : { enabled: Boolean(payload.enabled), updatedAt: now }
      const [updated] = await db.update(applicationUsers).set(changes).where(eq(applicationUsers.id, existing.id)).returning()
      await writeSecurityAudit(context, { action: payload.action === "change_role" ? "user_role_changed" : updated.enabled ? "user_enabled" : "user_disabled", entityType: "application_user", entityId: updated.id, metadata: { before: { role: existing.role, enabled: existing.enabled }, after: { role: updated.role, enabled: updated.enabled } } })
      return Response.json({ user: updated })
    }

    if (payload.action === "update_lifecycle" && Number.isInteger(payload.alumnusId)) {
      const lifecycleStates = new Set(["Active", "Archived", "Deletion requested"])
      if (!lifecycleStates.has(clean(payload.status))) return Response.json({ error: "Choose Active, Archived, or Deletion requested." }, { status: 400 })
      const status = clean(payload.status)
      const record = {
        alumnusId: payload.alumnusId!,
        status,
        deletionRequestedAt: status === "Deletion requested" ? now : "",
        archivedAt: status === "Archived" ? now : "",
        notes: clean(payload.notes, 1000),
        updatedBy: context.displayName,
        updatedAt: now,
      }
      const [updated] = await db.insert(alumniDataLifecycle).values(record).onConflictDoUpdate({ target: alumniDataLifecycle.alumnusId, set: record }).returning()
      await writeSecurityAudit(context, { action: "data_lifecycle_changed", entityType: "alumnus", entityId: payload.alumnusId, metadata: { status } })
      return Response.json({ lifecycle: updated })
    }

    if (payload.action === "anonymize_alumnus" && Number.isInteger(payload.alumnusId)) {
      if (payload.confirmation !== `ANONYMIZE ${payload.alumnusId}`) return Response.json({ error: `Type ANONYMIZE ${payload.alumnusId} to confirm.` }, { status: 409 })
      const id = payload.alumnusId!
      const [person] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
      if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
      await db.update(alumni).set({
        profileKey: `anonymized:${id}:${Date.now()}`,
        name: `Anonymized alumnus #${id}`,
        initials: "AA",
        email: "",
        phone: "",
        linkedinUrl: "",
        pdlPersonId: "",
        lushaPersonId: "",
        note: "Personal data anonymized by an administrator.",
        hiringInfluence: "Unknown / Not assessed",
        iimlRelationship: "Unknown / Not assessed",
        warmIntroPotential: "Unknown / Not assessed",
        updatedBy: context.displayName,
        updatedAt: now,
      }).where(eq(alumni.id, id))
      await db.insert(alumniPrivacyControls).values({ alumnusId: id, generalContactStatus: "Do not contact", professionalEngagementStatus: "Do not contact", birthdayEngagementStatus: "Do not contact", consentSource: "Unknown", notes: "Record anonymized", updatedBy: context.displayName, updatedAt: now }).onConflictDoUpdate({ target: alumniPrivacyControls.alumnusId, set: { generalContactStatus: "Do not contact", professionalEngagementStatus: "Do not contact", birthdayEngagementStatus: "Do not contact", consentSource: "Unknown", notes: "Record anonymized", updatedBy: context.displayName, updatedAt: now } })
      await db.insert(alumniDataLifecycle).values({ alumnusId: id, status: "Anonymized", anonymizedAt: now, notes: clean(payload.notes, 1000), updatedBy: context.displayName, updatedAt: now }).onConflictDoUpdate({ target: alumniDataLifecycle.alumnusId, set: { status: "Anonymized", anonymizedAt: now, notes: clean(payload.notes, 1000), updatedBy: context.displayName, updatedAt: now } })
      await writeSecurityAudit(context, { action: "alumnus_anonymized", entityType: "alumnus", entityId: id, metadata: { previousProfileKey: person.profileKey } })
      return Response.json({ anonymized: true, alumnusId: id })
    }

    return Response.json({ error: "Unsupported administration action." }, { status: 400 })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    if (error instanceof InvalidEmailError) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ error: error instanceof Error ? error.message : "Unable to complete the administration action." }, { status: 500 })
  }
}
