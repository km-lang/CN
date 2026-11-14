import { and, eq, sql } from "drizzle-orm"

import type { PostgresDatabase } from "./adapter"
import { alumni, alumniDataLifecycle, applicationIdentities, applicationUsers, providerCompanyAliases, providerCompanyMappings, providerRefreshReviews, securityAuditEvents } from "./schema"
import { googleAllowedDomain } from "@/lib/auth-config"
import { isLikelyInstitutionalEmailTypo, normalizeEmail } from "@/lib/email-identity"
import type { SecurityContext } from "@/lib/security"
import { hasPermission, isApplicationRole, safeAuditMetadata } from "@/lib/security-policy"
import { validateProviderCompanyMappingInput } from "@/lib/provider-company-mapping"

type AdminInput = {
  action?: string; email?: string; displayName?: string; role?: string; confirmation?: string;
  confirmSimilarEmail?: boolean; userId?: number; correctUserId?: number; enabled?: boolean;
  alumnusId?: number; status?: string; notes?: string;
  mappingId?: number; provider?: string; providerCompanyId?: string;
  mappingSource?: string; evidenceReference?: string; providerSourceId?: string;
  providerCompanyUrl?: string; aliases?: string[];
}

const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max)
const response = (error: string, status: number) => Response.json({ error }, { status })
const audit = (context: SecurityContext, action: string, entityType: string, entityId: string | number, metadata: Record<string, unknown>, now: string) => ({
  actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName,
  actorRole: context.role, action, entityType, entityId: String(entityId), metadataJson: safeAuditMetadata(metadata),
  result: "success", source: "application", createdAt: now,
})

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && error.code === "23505") return true
  return "cause" in error && isUniqueViolation(error.cause)
}

/** Local Admin mutations only. Provider calls and destructive actions remain gated. */
export async function postgresAdminLocalAction(db: PostgresDatabase, context: SecurityContext, payload: AdminInput): Promise<Response> {
  if (!hasPermission(context.role, "MANAGE_USERS")) return response("You do not have permission to perform this action.", 403)
  const now = new Date().toISOString()

  if (payload.action === "authorize_user") {
    let email: string
    try { email = normalizeEmail(payload.email) }
    catch { return response("Enter a valid email address.", 400) }
    const displayName = clean(payload.displayName, 160) || email
    if (!isApplicationRole(payload.role)) return response("Enter a valid email and role.", 400)
    const role = payload.role
    if (email.split("@")[1] !== googleAllowedDomain()) return response(`Authorize an institutional @${googleAllowedDomain()} email address. Recovery identities are linked separately.`, 400)
    if (payload.role === "ADMIN" && payload.confirmation !== `GRANT ADMIN ${email}`) return response(`Type GRANT ADMIN ${email} to confirm Admin access.`, 409)
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(7303105)`)
      const users = await tx.select().from(applicationUsers)
      const exactUser = users.find(user => normalizeEmail(user.email) === email)
      const similarUser = users.find(user => isLikelyInstitutionalEmailTypo(email, user.email, displayName, user.displayName))
      if (!exactUser && similarUser && payload.confirmSimilarEmail !== true) {
        return Response.json({ error: "Possible similar authorized user found.", code: "possible_similar_user", enteredEmail: email,
          similarUser: { id: similarUser.id, email: similarUser.email, displayName: similarUser.displayName } }, { status: 409 })
      }
      const [user] = exactUser
        ? await tx.update(applicationUsers).set({ email, displayName, role, enabled: true, updatedAt: now }).where(eq(applicationUsers.id, exactUser.id)).returning()
        : await tx.insert(applicationUsers).values({ email, displayName, role, enabled: true, updatedAt: now }).returning()
      await tx.insert(securityAuditEvents).values(audit(context, "user_authorized", "application_user", user.id, { role: user.role, enabled: user.enabled }, now))
      return Response.json({ user }, { status: 201 })
    })
  }

  if (payload.action === "correct_pre_authorization" && Number.isInteger(payload.userId) && Number.isInteger(payload.correctUserId)) {
    const duplicateId = payload.userId!
    const correctUserId = payload.correctUserId!
    if (payload.confirmation !== `CORRECT USER ${duplicateId}`) return response(`Type CORRECT USER ${duplicateId} to confirm.`, 409)
    if (duplicateId === context.userId || duplicateId === correctUserId) return response("This user correction is not permitted.", 409)
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(7303105)`)
      const [duplicate] = await tx.select().from(applicationUsers).where(eq(applicationUsers.id, duplicateId)).for("update").limit(1)
      const [correctUser] = await tx.select().from(applicationUsers).where(eq(applicationUsers.id, correctUserId)).for("update").limit(1)
      if (!duplicate || !correctUser) return response("The requested user record was not found.", 404)
      const [duplicateIdentities, actorEvents] = await Promise.all([
        tx.select({ id: applicationIdentities.id }).from(applicationIdentities).where(eq(applicationIdentities.applicationUserId, duplicateId)).limit(1),
        tx.select({ id: securityAuditEvents.id }).from(securityAuditEvents).where(eq(securityAuditEvents.actorUserId, duplicateId)).limit(1),
      ])
      if (duplicate.enabled || duplicate.lastLoginAt || duplicateIdentities.length || actorEvents.length) return response("Only a disabled, never-authenticated and unlinked pre-authorization can be corrected.", 409)
      if (!correctUser.enabled || duplicate.role !== correctUser.role || !isLikelyInstitutionalEmailTypo(duplicate.email, correctUser.email, duplicate.displayName, correctUser.displayName)) {
        return response("The proposed correction does not match a conservative institutional-email typo.", 409)
      }
      await tx.insert(securityAuditEvents).values(audit(context, "user_pre_authorization_corrected", "application_user", duplicate.id,
        { reason: `Institutional email was entered incorrectly as ${duplicate.email}.`,
          incorrectUser: { id: duplicate.id, email: duplicate.email }, correctUser: { id: correctUser.id, email: correctUser.email } }, now))
      await tx.delete(applicationUsers).where(and(eq(applicationUsers.id, duplicate.id), eq(applicationUsers.enabled, false)))
      return Response.json({ corrected: true, deletedUserId: duplicate.id, correctUserId: correctUser.id })
    })
  }

  if ((payload.action === "change_role" || payload.action === "set_user_status") && Number.isInteger(payload.userId)) {
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(7303105)`)
      const [existing] = await tx.select().from(applicationUsers).where(eq(applicationUsers.id, payload.userId!)).for("update").limit(1)
      if (!existing) return response("User not found.", 404)
      if (existing.id === context.userId && (payload.action === "set_user_status" ? payload.enabled === false : payload.role !== "ADMIN")) {
        return response("You cannot disable or remove your own Admin access.", 409)
      }
      if (payload.action === "change_role" && !isApplicationRole(payload.role)) return response("Choose a recognized role.", 400)
      if (payload.action === "change_role" && payload.role === "ADMIN" && existing.role !== "ADMIN" && payload.confirmation !== `GRANT ADMIN ${existing.id}`) return response(`Type GRANT ADMIN ${existing.id} to confirm Admin access.`, 409)
      if (payload.action === "set_user_status" && payload.enabled === false && payload.confirmation !== `DISABLE USER ${existing.id}`) return response(`Type DISABLE USER ${existing.id} to confirm.`, 409)
      const changes = payload.action === "change_role" ? { role: payload.role!, updatedAt: now } : { enabled: Boolean(payload.enabled), updatedAt: now }
      const removesActiveAdmin = existing.enabled && existing.role === "ADMIN" && (payload.action === "change_role" ? payload.role !== "ADMIN" : payload.enabled === false)
      if (removesActiveAdmin) {
        const admins = await tx.select({ id: applicationUsers.id }).from(applicationUsers).where(and(eq(applicationUsers.role, "ADMIN"), eq(applicationUsers.enabled, true)))
        if (admins.length <= 1) return response("At least one active Admin must remain.", 409)
      }
      const [updated] = await tx.update(applicationUsers).set(changes).where(eq(applicationUsers.id, existing.id)).returning()
      await tx.insert(securityAuditEvents).values(audit(context, payload.action === "change_role" ? "user_role_changed" : updated.enabled ? "user_enabled" : "user_disabled", "application_user", updated.id,
        { before: { role: existing.role, enabled: existing.enabled }, after: { role: updated.role, enabled: updated.enabled } }, now))
      return Response.json({ user: updated })
    })
  }

  if (payload.action === "update_lifecycle" && Number.isInteger(payload.alumnusId)) {
    const status = clean(payload.status)
    if (!new Set(["Active", "Archived", "Deletion requested"]).has(status)) return response("Choose Active, Archived, or Deletion requested.", 400)
    if (status === "Archived" && payload.confirmation !== `ARCHIVE ${payload.alumnusId}`) return response(`Type ARCHIVE ${payload.alumnusId} to confirm.`, 409)
    return db.transaction(async tx => {
      await tx.select({ id: alumni.id }).from(alumni).where(eq(alumni.id, payload.alumnusId!)).for("update").limit(1)
      const pending = await tx.select({ id: providerRefreshReviews.id }).from(providerRefreshReviews)
        .where(and(eq(providerRefreshReviews.alumnusId, payload.alumnusId!), eq(providerRefreshReviews.status, "Pending review"))).limit(1)
      if (pending.length && status !== "Active") return response("Resolve the pending provider review before changing this alumnus lifecycle.", 409)
      const record = { alumnusId: payload.alumnusId!, status, deletionRequestedAt: status === "Deletion requested" ? now : "",
        archivedAt: status === "Archived" ? now : "", notes: clean(payload.notes, 1000), updatedBy: context.displayName, updatedAt: now }
      const [lifecycle] = await tx.insert(alumniDataLifecycle).values(record).onConflictDoUpdate({ target: alumniDataLifecycle.alumnusId, set: record }).returning()
      await tx.insert(securityAuditEvents).values(audit(context, "data_lifecycle_changed", "alumnus", payload.alumnusId!, { status }, now))
      return Response.json({ lifecycle })
    })
  }

  if (payload.action === "upsert_provider_company_mapping") {
    if (!hasPermission(context.role, "MANAGE_PROVIDER_SETTINGS")) return response("You do not have permission to perform this action.", 403)
    const values = validateProviderCompanyMappingInput(payload, context.displayName, now)
    try {
      return await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(7303106)`)
        const [existing] = Number.isInteger(payload.mappingId)
          ? await tx.select().from(providerCompanyMappings).where(eq(providerCompanyMappings.id, payload.mappingId!)).limit(1)
          : await tx.select().from(providerCompanyMappings).where(and(eq(providerCompanyMappings.normalizedCompanyKey, values.normalizedCompanyKey), eq(providerCompanyMappings.provider, values.provider))).limit(1)
        const before = existing ? { status: existing.status, providerCompanyId: existing.providerCompanyId, mappingSource: existing.mappingSource,
          evidenceReference: existing.evidenceReference, verifiedBy: existing.verifiedBy, verifiedAt: existing.verifiedAt } : null
        const after = { status: values.status, providerCompanyId: values.providerCompanyId, mappingSource: values.mappingSource,
          evidenceReference: values.evidenceReference, verifiedBy: values.verifiedBy, verifiedAt: values.verifiedAt }
        const changes = [!existing ? "created" : "updated", existing && existing.status !== values.status ? "status_changed" : "",
          existing && existing.providerCompanyId !== values.providerCompanyId ? "provider_id_changed" : "",
          existing && (existing.mappingSource !== values.mappingSource || existing.evidenceReference !== values.evidenceReference) ? "evidence_changed" : "",
          values.status === "VERIFIED" && existing?.status !== "VERIFIED" ? "verification_performed" : "",
          values.status === "CONFLICT" && existing?.status !== "CONFLICT" ? "conflict_set" : "",
          values.status === "UNVERIFIED" && existing?.status === "VERIFIED" ? "mapping_invalidated" : ""].filter(Boolean)
        const [mapping] = existing
          ? await tx.update(providerCompanyMappings).set(values).where(eq(providerCompanyMappings.id, existing.id)).returning()
          : await tx.insert(providerCompanyMappings).values({ ...values, createdAt: now }).returning()
        await tx.insert(securityAuditEvents).values(audit(context, "provider_company_mapping_changed", "provider_company_mapping", `${values.provider}:${values.normalizedCompanyKey}`,
          { changes, normalizedCompanyKey: values.normalizedCompanyKey, displayName: values.displayName, provider: values.provider, before, after }, now))
        if (mapping.status === "VERIFIED") for (const aliasValue of payload.aliases ?? []) {
          const displayAlias = clean(aliasValue, 240).replace(/\s+/g, " ")
          const normalizedAlias = displayAlias.toLowerCase()
          if (!displayAlias || normalizedAlias === mapping.normalizedCompanyKey) continue
          await tx.insert(providerCompanyAliases).values({ mappingId: mapping.id, displayAlias, normalizedAlias, status: "VERIFIED", verifiedBy: context.displayName, verifiedAt: now })
            .onConflictDoUpdate({ target: providerCompanyAliases.normalizedAlias, set: { mappingId: mapping.id, displayAlias, status: "VERIFIED", verifiedBy: context.displayName, verifiedAt: now } })
        }
        return Response.json({ mapping }, { status: existing ? 200 : 201 })
      })
    } catch (error) {
      if (isUniqueViolation(error)) return response("That company/provider identity is already mapped. Resolve the existing mapping instead of creating a duplicate.", 409)
      throw error
    }
  }

  return response("Unsupported administration action.", 400)
}
