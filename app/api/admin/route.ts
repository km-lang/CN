import { desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle, alumniPrivacyControls, applicationUsers, providerSettings, securityAuditEvents } from "@/db/schema"
import { accessErrorResponse, authorizeRequest, isApplicationRole, writeSecurityAudit } from "@/lib/security"

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max)
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_USERS")
    const db = getDb()
    const [users, audit, lifecycle, providerLimits] = await Promise.all([
      db.select().from(applicationUsers).orderBy(applicationUsers.displayName),
      db.select().from(securityAuditEvents).orderBy(desc(securityAuditEvents.createdAt), desc(securityAuditEvents.id)).limit(200),
      db.select().from(alumniDataLifecycle).orderBy(desc(alumniDataLifecycle.updatedAt)),
      db.select().from(providerSettings).orderBy(providerSettings.provider),
    ])
    return Response.json({ users, audit, lifecycle, providerLimits })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load administration data." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_USERS")
    const payload = await request.json() as { action?: string; userId?: number; email?: string; displayName?: string; role?: string; enabled?: boolean; alumnusId?: number; status?: string; notes?: string; confirmation?: string }
    const db = getDb()
    const now = new Date().toISOString()

    if (payload.action === "authorize_user") {
      const email = clean(payload.email, 320).toLowerCase()
      const displayName = clean(payload.displayName, 160) || email
      if (!/^\S+@\S+\.\S+$/.test(email) || !isApplicationRole(payload.role)) return Response.json({ error: "Enter a valid email and role." }, { status: 400 })
      const [user] = await db.insert(applicationUsers).values({ email, displayName, role: payload.role, enabled: true, updatedAt: now }).onConflictDoUpdate({
        target: applicationUsers.email,
        set: { displayName, role: payload.role, enabled: true, updatedAt: now },
      }).returning()
      await writeSecurityAudit(context, { action: "user_authorized", entityType: "application_user", entityId: user.id, metadata: { role: user.role, enabled: user.enabled } })
      return Response.json({ user }, { status: 201 })
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
    return Response.json({ error: error instanceof Error ? error.message : "Unable to complete the administration action." }, { status: 500 })
  }
}
