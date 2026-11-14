import { eq, sql } from "drizzle-orm"
import type { PostgresDatabase } from "@/db/postgres/adapter"
import { postgresErrorCode } from "@/lib/postgres-http-error"
import { activityLog, alumni, alumniPrivacyControls, companyPriorities, fieldChangeHistory, importRuns, securityAuditEvents } from "@/db/postgres/schema"
import type { ApplicationRole } from "@/lib/access-types"
import type { SecurityContext } from "@/lib/security"
import { hasPermission, safeAuditMetadata } from "@/lib/security-policy"

type RecordInput = Record<string, unknown>
type Match = { id: number; name: string; programme: string; batch: number; company: string; title: string; reasons: string[]; exact: boolean }
type Mapper = (row: typeof alumni.$inferSelect, role: ApplicationRole) => unknown
type ManualHelpers = {
  normalise: (record: RecordInput, actor: string, continueAsNew: boolean) => typeof alumni.$inferInsert
  bulkNormalise: (record: RecordInput, filename: string, actor: string) => typeof alumni.$inferInsert
  matches: (record: RecordInput, people: (typeof alumni.$inferSelect)[]) => Match[]
  map: Mapper
}

type WorkspacePatch = {
  action?: string; id?: number; status?: string;
  assessment?: { hiringInfluence?: string; iimlRelationship?: string; warmIntroPotential?: string };
  company?: string; priority?: string;
  privacy?: { generalContactStatus?: string; professionalEngagementStatus?: string; birthdayEngagementStatus?: string; consentSource?: string; notes?: string };
  professionalDataStatus?: string; professionalDataNote?: string;
}

const allowedStatuses = new Set(["Not contacted", "Contacted", "Responded", "Meeting set"])
const contactStatuses = new Set(["Standard engagement allowed", "Professional engagement only", "Birthday engagement allowed", "No professional engagement", "No birthday engagement", "Do not contact", "Unknown"])
const consentStatuses = new Set(["Internal institutional record", "Alumni-confirmed", "Manual PCOM record", "Provider sourced", "Unknown"])
const qualityStatuses = new Set(["Needs assessment", "Reviewed", "Current", "Conflict — manual verification required", "Manually verified"])
const text = (value: unknown) => String(value ?? "").trim()

function audit(context: SecurityContext, action: string, entityType: string, entityId: string | number, metadata: Record<string, unknown>) {
  return { actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
    actorRole: context.role, action, entityType, entityId: String(entityId), metadataJson: safeAuditMetadata(metadata),
    result: "success", source: "application" }
}

export async function postgresWorkspacePost(db: PostgresDatabase, context: SecurityContext,
  payload: { action?: string; filename?: string; approvedUpdateKeys?: string[]; record?: RecordInput; continueAsNew?: boolean; records?: RecordInput[] }, helpers: ManualHelpers) {
  if (payload.action !== "manual_check" && payload.action !== "manual_add") {
    if (payload.action === "import") {
      if (!Array.isArray(payload.records)) return Response.json({ error: "A valid alumni import is required." }, { status: 400 })
      if (!hasPermission(context.role, "MANAGE_USERS")) return Response.json({ error: "Administrator access is required for bulk alumni imports." }, { status: 403 })
      if (payload.records.length < 1 || payload.records.length > 250) return Response.json({ error: "Import between 1 and 250 records at a time." }, { status: 400 })
      const actor = context.displayName
      const filename = text(payload.filename) || "Manual import"
      let records: (typeof alumni.$inferInsert)[]
      try { records = payload.records.map(record => helpers.bulkNormalise(record, filename, actor)) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to validate an alumni import." }, { status: 400 }) }
      const normalized = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
      const keys = records.map(record => record.profileKey)
      if (new Set(keys).size !== keys.length) return Response.json({ error: "The file contains duplicate alumni rows. Remove duplicates and validate again." }, { status: 400 })
      const approved = new Set(payload.approvedUpdateKeys ?? [])
      // Approved contract (2026-11-15): a row that collides with an existing alumnus
      // rolls back the WHOLE import (no partial rows, run, activity or audit) and
      // returns D1's 400 status with a sanitized message instead of D1's raw
      // constraint text. Any other database error keeps the sanitized 500.
      try { return await importTransaction() } catch (error) {
        if (postgresErrorCode(error) === "23505") {
          return Response.json({ error: "An imported row conflicts with an existing alumnus record. No records were imported; review the file and validate again." }, { status: 400 })
        }
        throw error
      }
      async function importTransaction() { return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(7303104)`)
        const people = await tx.select().from(alumni)
        let imported = 0
        let updated = 0
        let protectedFields = 0
        for (const record of records) {
          const existing = people.find(person => person.profileKey === record.profileKey)
            ?? people.find(person => record.email && normalized(person.email) === normalized(record.email))
            ?? people.find(person => record.linkedinUrl && normalized(person.linkedinUrl) === normalized(record.linkedinUrl))
          if (!existing) { await tx.insert(alumni).values(record); imported += 1; continue }
          if (!approved.has(record.profileKey)) continue
          const changes: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: new Date().toISOString(), source: record.source }
          const changed: Array<{ field: string; oldValue: string; newValue: string }> = []
          const apply = (field: keyof typeof record, current: unknown, allowed: boolean) => {
            const next = record[field]
            if (!next || normalized(current) === normalized(next)) return
            if (!allowed) { protectedFields += 1; return }
            ;(changes as Record<string, unknown>)[field] = next
            changed.push({ field: String(field), oldValue: text(current), newValue: text(next) })
          }
          apply("programme", existing.programme, !existing.programme || existing.programme === "Not recorded")
          apply("education", existing.education, !existing.education)
          apply("company", existing.company, existing.currentCompanyVerification === "Unverified")
          apply("title", existing.title, existing.designationVerification === "Unverified")
          apply("rawTitle", existing.rawTitle, existing.designationVerification === "Unverified")
          apply("function", existing.function, existing.designationVerification === "Unverified" || existing.function === "Not assessed")
          apply("seniority", existing.seniority, existing.designationVerification === "Unverified" || existing.seniority === "Not assessed")
          apply("location", existing.location, existing.locationVerification === "Unverified")
          apply("previous", existing.previous, !existing.previous)
          apply("experience", existing.experience, !existing.experience)
          apply("linkedinUrl", existing.linkedinUrl, !existing.linkedinUrl)
          apply("email", existing.email, !existing.email)
          apply("phone", existing.phone, !existing.phone)
          if (changes.email) { changes.emailSource = record.emailSource; changes.emailVerification = "Unverified" }
          if (changes.phone) { changes.phoneSource = record.phoneSource; changes.phoneVerification = "Unverified" }
          if (changed.length) {
            await tx.update(alumni).set(changes).where(eq(alumni.id, existing.id))
            for (const item of changed) await tx.insert(fieldChangeHistory).values({ alumnusId: existing.id, field: item.field,
              oldValue: item.oldValue, newValue: item.newValue, source: text(record.source), providerAction: "Reviewed alumni import", initiatedBy: actor })
            updated += 1
          }
        }
        await tx.insert(importRuns).values({ filename, rowCount: records.length, importedBy: actor })
        await tx.insert(activityLog).values({ action: "import", entityType: "alumni", entityId: filename, actor,
          details: `${imported} created; ${updated} safely updated; ${protectedFields} protected fields preserved` })
        await tx.insert(securityAuditEvents).values(audit(context, "alumni_imported", "import", filename,
          { recordCount: records.length, imported, updated, protectedFields }))
        return Response.json({ imported, updated, protectedFields, filename }, { status: 201 })
      }) }
    }
    return Response.json({ error: "A valid alumni import is required." }, { status: 400 })
  }
  if (!payload.record || typeof payload.record !== "object") return Response.json({ error: "Enter the alumnus details first." }, { status: 400 })
  const actor = context.displayName
  try { helpers.normalise(payload.record, actor, Boolean(payload.continueAsNew)) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to validate alumni details." }, { status: 400 }) }
  if (payload.action === "manual_check") {
    const people = await db.select().from(alumni)
    return Response.json({ matches: helpers.matches(payload.record, people) })
  }
  return db.transaction(async tx => {
    // The D1 duplicate scan is repeated under a transaction lock before insert.
    await tx.execute(sql`select pg_advisory_xact_lock(7303104)`)
    const people = await tx.select().from(alumni)
    const matches = helpers.matches(payload.record!, people)
    if (matches.some(match => match.exact)) return Response.json({ error: "An exact existing alumnus was found. Use the existing record instead of creating a duplicate.", matches }, { status: 409 })
    if (matches.length && !payload.continueAsNew) return Response.json({ error: "A possible existing alumnus needs review before saving.", requiresConfirmation: true, matches }, { status: 409 })
    const record = helpers.normalise(payload.record!, actor, Boolean(payload.continueAsNew))
    const [created] = await tx.insert(alumni).values(record).returning()
    await tx.insert(activityLog).values({ action: "manual_add", entityType: "alumnus", entityId: String(created.id), actor,
      details: `Manual entry created for ${created.name}; no provider call was made.` })
    await tx.insert(securityAuditEvents).values(audit(context, "alumnus_manual_created", "alumnus", created.id, { source: "Manual entry" }))
    return Response.json({ alumnus: helpers.map(created, context.role), providerCreditsUsed: 0 }, { status: 201 })
  })
}

export async function postgresWorkspacePatch(db: PostgresDatabase, context: SecurityContext, payload: WorkspacePatch, map: Mapper) {
  const now = new Date().toISOString()
  if (payload.action === "update_alumnus" && Number.isInteger(payload.id)) {
    const actor = context.displayName
    return db.transaction(async tx => {
      await tx.execute(sql`select id from alumni where id = ${payload.id!} for update`)
      const [existing] = await tx.select({ intakeStatus: alumni.intakeStatus }).from(alumni).where(eq(alumni.id, payload.id!)).limit(1)
      if (!existing) return Response.json({ error: "Alumnus not found." }, { status: 404 })
      if (existing.intakeStatus === "PROVISIONAL" && payload.status) return Response.json({ error: "Provisional profiles require review before outreach status can change." }, { status: 409 })
      const updates: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: now }
      if (payload.status && allowedStatuses.has(payload.status)) updates.status = payload.status
      if (payload.assessment) {
        if (payload.assessment.hiringInfluence) updates.hiringInfluence = payload.assessment.hiringInfluence
        if (payload.assessment.iimlRelationship) updates.iimlRelationship = payload.assessment.iimlRelationship
        if (payload.assessment.warmIntroPotential) updates.warmIntroPotential = payload.assessment.warmIntroPotential
      }
      const [updated] = await tx.update(alumni).set(updates).where(eq(alumni.id, payload.id!)).returning()
      await tx.insert(activityLog).values({ action: "update", entityType: "alumnus", entityId: String(payload.id), actor,
        details: payload.status ? `Outreach set to ${payload.status}` : "Assessment updated" })
      await tx.insert(securityAuditEvents).values(audit(context, payload.assessment ? "relationship_assessment_changed" : "alumnus_updated",
        "alumnus", payload.id!, { outreachStatus: payload.status, assessmentFields: payload.assessment ? Object.keys(payload.assessment) : [] }))
      return Response.json({ alumnus: map(updated, context.role) })
    })
  }
  if (payload.action === "update_priority" && text(payload.company) && text(payload.priority)) {
    const actor = context.displayName
    const company = text(payload.company)
    const priority = text(payload.priority)
    return db.transaction(async tx => {
      await tx.insert(companyPriorities).values({ company, priority, updatedBy: actor, updatedAt: now })
        .onConflictDoUpdate({ target: companyPriorities.company, set: { priority, updatedBy: actor, updatedAt: now } })
      await tx.insert(activityLog).values({ action: "update", entityType: "company", entityId: company, actor, details: `Priority set to ${priority}` })
      await tx.insert(securityAuditEvents).values(audit(context, "company_priority_changed", "company", company, { priority }))
      return Response.json({ company, priority })
    })
  }
  if (payload.action === "update_data_quality" && Number.isInteger(payload.id)) {
    const actor = context.displayName
    const professionalDataStatus = qualityStatuses.has(text(payload.professionalDataStatus)) ? text(payload.professionalDataStatus) : "Needs assessment"
    const professionalDataNote = text(payload.professionalDataNote).slice(0, 1000)
    return db.transaction(async tx => {
      const [updated] = await tx.update(alumni).set({ professionalDataStatus, professionalDataNote, updatedBy: actor, updatedAt: now })
        .where(eq(alumni.id, payload.id!)).returning()
      if (!updated) return Response.json({ error: "Alumnus not found." }, { status: 404 })
      await tx.insert(fieldChangeHistory).values({ alumnusId: updated.id, field: "professional_data_status", oldValue: "",
        newValue: professionalDataStatus, source: "Manual PCOM review", providerAction: "Data conflict review", initiatedBy: actor })
      await tx.insert(securityAuditEvents).values(audit(context, "professional_data_quality_changed", "alumnus", updated.id,
        { professionalDataStatus, noteRecorded: Boolean(professionalDataNote) }))
      return Response.json({ alumnus: map(updated, context.role) })
    })
  }
  if (payload.action === "update_privacy" && Number.isInteger(payload.id) && payload.privacy) {
    const actor = context.displayName
    const allowed = (candidate: unknown, options: Set<string>) => options.has(text(candidate)) ? text(candidate) : "Unknown"
    const record = { alumnusId: payload.id!, generalContactStatus: allowed(payload.privacy.generalContactStatus, contactStatuses),
      professionalEngagementStatus: allowed(payload.privacy.professionalEngagementStatus, contactStatuses),
      birthdayEngagementStatus: allowed(payload.privacy.birthdayEngagementStatus, contactStatuses),
      consentSource: allowed(payload.privacy.consentSource, consentStatuses), notes: text(payload.privacy.notes).slice(0, 1000),
      updatedBy: actor, updatedAt: now }
    return db.transaction(async tx => {
      const [updated] = await tx.insert(alumniPrivacyControls).values(record)
        .onConflictDoUpdate({ target: alumniPrivacyControls.alumnusId, set: record }).returning()
      await tx.insert(securityAuditEvents).values(audit(context,
        record.generalContactStatus === "Do not contact" ? "do_not_contact_changed" : "privacy_preference_changed",
        "alumnus", payload.id!, { generalContactStatus: record.generalContactStatus,
          professionalEngagementStatus: record.professionalEngagementStatus,
          birthdayEngagementStatus: record.birthdayEngagementStatus, consentSource: record.consentSource }))
      return Response.json({ privacy: updated })
    })
  }
  return Response.json({ error: "Unsupported workspace update." }, { status: 400 })
}
