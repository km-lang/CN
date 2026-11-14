import { and, eq, or } from "drizzle-orm"
import { applicationIdentities, applicationUsers, securityAuditEvents } from "@/db/postgres/schema"
import type { PostgresDatabase } from "@/db/postgres/adapter"
import type { AppSessionClaims } from "@/lib/auth-session"
import type { ApplicationRole } from "@/lib/access-types"
import type { IdentityProvider } from "@/lib/auth-config"
import { tryNormalizeEmail } from "@/lib/email-identity"
import { isApplicationRole, safeAuditMetadata } from "@/lib/security-policy"
import { AccessError } from "@/lib/access-error"
import type { RequestIdentity, SecurityContext } from "@/lib/security"

function bootstrapAdminEmails() {
  return new Set((process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map(tryNormalizeEmail)
    .filter(Boolean))
}

export async function resolvePostgresAuthorizedIdentity(db: PostgresDatabase, identity: RequestIdentity): Promise<SecurityContext> {
  const now = new Date().toISOString()
  const provider = identity.provider ?? "chatgpt"
  const providerSubjectId = (identity.providerSubjectId ?? identity.externalIdentity ?? "").trim()
  const email = tryNormalizeEmail(identity.email)
  const emailVerified = identity.emailVerified ?? provider === "chatgpt"
  if (!providerSubjectId || !email || !emailVerified) {
    await auditPostgresIdentity(db, null, { provider, providerSubjectId, email, displayName: identity.displayName }, "login_denied", "identity_not_verified")
    throw new AccessError("A verified identity is required.", 401, "identity_not_verified")
  }

  let [linkedIdentity] = await db.select().from(applicationIdentities).where(and(
    eq(applicationIdentities.provider, provider),
    eq(applicationIdentities.providerSubjectId, providerSubjectId),
  )).limit(1)
  let user = linkedIdentity
    ? (await db.select().from(applicationUsers).where(eq(applicationUsers.id, linkedIdentity.applicationUserId)).limit(1))[0]
    : undefined
  let bootstrapCreated = false

  if (!user) {
    const candidates = provider === "chatgpt"
      ? await db.select().from(applicationUsers).where(or(eq(applicationUsers.externalIdentity, providerSubjectId), eq(applicationUsers.email, email))).limit(1)
      : await db.select().from(applicationUsers).where(eq(applicationUsers.email, email)).limit(1)
    user = candidates[0]
  }

  if (!user && provider === "chatgpt" && bootstrapAdminEmails().has(email)) {
    bootstrapCreated = true
    ;[user] = await db.insert(applicationUsers).values({
      externalIdentity: providerSubjectId,
      displayName: identity.displayName,
      email,
      role: "ADMIN",
      enabled: true,
      lastLoginAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: applicationUsers.email,
      set: { externalIdentity: providerSubjectId, displayName: identity.displayName, enabled: true, role: "ADMIN", lastLoginAt: now, updatedAt: now },
    }).returning()
  }

  if (!user || !isApplicationRole(user.role)) {
    await auditPostgresIdentity(db, user ?? null, { provider, providerSubjectId, email, displayName: identity.displayName }, "login_denied", "not_authorized")
    throw new AccessError("Your account is not authorized to access Corporate Network.", 403, "not_authorized")
  }
  if (!user.enabled) {
    await auditPostgresIdentity(db, user, { provider, providerSubjectId, email, displayName: identity.displayName }, "login_denied", "account_disabled")
    throw new AccessError("Your Corporate Network access has been disabled. Contact an administrator.", 403, "account_disabled")
  }

  if (!linkedIdentity) {
    ;[linkedIdentity] = await db.insert(applicationIdentities).values({
      applicationUserId: user.id,
      provider,
      providerSubjectId,
      verifiedEmail: email,
      emailVerified: true,
      providerDomain: identity.providerDomain?.trim().toLowerCase() ?? "",
      lastAuthenticatedAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning()
    if (!linkedIdentity) {
      ;[linkedIdentity] = await db.select().from(applicationIdentities).where(and(
        eq(applicationIdentities.provider, provider),
        eq(applicationIdentities.providerSubjectId, providerSubjectId),
      )).limit(1)
    }
    if (!linkedIdentity || linkedIdentity.applicationUserId !== user.id) {
      await auditPostgresIdentity(db, user, { provider, providerSubjectId, email, displayName: identity.displayName }, "login_denied", "identity_link_conflict")
      throw new AccessError("This sign-in identity is already linked to another account.", 403, "identity_link_conflict")
    }
    await auditPostgresIdentity(db, user, { provider, providerSubjectId, email, displayName: identity.displayName }, "identity_linked", "success", linkedIdentity.id)
  } else {
    await db.update(applicationIdentities).set({
      verifiedEmail: email,
      emailVerified: true,
      providerDomain: identity.providerDomain?.trim().toLowerCase() ?? linkedIdentity.providerDomain,
      lastAuthenticatedAt: now,
      updatedAt: now,
    }).where(eq(applicationIdentities.id, linkedIdentity.id))
  }

  const userUpdates = provider === "chatgpt"
    ? { externalIdentity: providerSubjectId, displayName: identity.displayName, lastLoginAt: now, updatedAt: now }
    : { displayName: identity.displayName, lastLoginAt: now, updatedAt: now }
  ;[user] = await db.update(applicationUsers).set(userUpdates).where(eq(applicationUsers.id, user.id)).returning()

  if (bootstrapCreated) await auditPostgresIdentity(db, user, { provider, providerSubjectId, email, displayName: identity.displayName }, "bootstrap_admin_authorized", "success", linkedIdentity.id)
  await auditPostgresIdentity(db, user, { provider, providerSubjectId, email, displayName: identity.displayName }, "login_success", "success", linkedIdentity.id)

  return {
    userId: user.id,
    identityId: linkedIdentity.id,
    provider,
    externalIdentity: providerSubjectId,
    email: user.email,
    displayName: user.displayName,
    role: user.role as ApplicationRole,
  }
}

export async function resolvePostgresSessionIdentity(db: PostgresDatabase, claims: AppSessionClaims): Promise<SecurityContext> {
  const [identity] = await db.select().from(applicationIdentities).where(eq(applicationIdentities.id, claims.applicationIdentityId)).limit(1)
  if (!identity || identity.applicationUserId !== claims.applicationUserId || identity.provider !== claims.provider) {
    throw new AccessError("Your authentication session is no longer valid.", 401, "invalid_session_identity")
  }
  const [user] = await db.select().from(applicationUsers).where(eq(applicationUsers.id, claims.applicationUserId)).limit(1)
  if (!user || !isApplicationRole(user.role)) throw new AccessError("Your account is not authorized to access Corporate Network.", 403, "not_authorized")
  if (!user.enabled) throw new AccessError("Your Corporate Network access has been disabled. Contact an administrator.", 403, "account_disabled")
  return {
    userId: user.id,
    identityId: identity.id,
    provider: identity.provider as IdentityProvider,
    externalIdentity: identity.providerSubjectId,
    email: user.email,
    displayName: user.displayName,
    role: user.role as ApplicationRole,
  }
}

export async function writePostgresSecurityAudit(db: PostgresDatabase, context: SecurityContext | null, event: {
  action: string
  entityType: string
  entityId?: string | number
  metadata?: Record<string, unknown>
  result?: string
  source?: string
}) {
  await db.insert(securityAuditEvents).values({
    actorUserId: context?.userId,
    actorIdentity: context?.externalIdentity ?? "System",
    actorName: context?.displayName ?? "System",
    actorRole: context?.role ?? "SYSTEM",
    action: event.action,
    entityType: event.entityType,
    entityId: String(event.entityId ?? ""),
    metadataJson: safeAuditMetadata(event.metadata),
    result: event.result ?? "success",
    source: event.source ?? "application",
  })
}

async function auditPostgresIdentity(db: PostgresDatabase, user: typeof applicationUsers.$inferSelect | null, identity: { provider: IdentityProvider; providerSubjectId: string; email: string; displayName: string }, action: string, result: string, identityId?: number) {
  await db.insert(securityAuditEvents).values({
    actorUserId: user?.id,
    actorIdentity: identity.providerSubjectId || identity.email || "Unknown",
    actorName: identity.displayName || identity.email || "Unknown",
    actorRole: user?.role ?? "UNAUTHORIZED",
    action,
    entityType: "application_identity",
    entityId: String(identityId ?? ""),
    metadataJson: safeAuditMetadata({ provider: identity.provider, email: identity.email }),
    result,
    source: identity.provider,
  })
}
