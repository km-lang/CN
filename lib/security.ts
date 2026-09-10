import { eq, or } from "drizzle-orm"

import { getDb } from "@/db"
import { applicationUsers, securityAuditEvents } from "@/db/schema"
import { type AccessSession, type ApplicationRole } from "@/lib/access-types"
import { hasPermission, isApplicationRole, safeAuditMetadata, type Permission } from "@/lib/security-policy"

export { hasPermission, isApplicationRole, maskEmail, maskPhone, safeAuditMetadata } from "@/lib/security-policy"

export type RequestIdentity = {
  externalIdentity: string
  email: string
  displayName: string
}

export type SecurityContext = {
  userId: number
  externalIdentity: string
  email: string
  displayName: string
  role: ApplicationRole
}

export class AccessError extends Error {
  constructor(message: string, public readonly status: 401 | 403, public readonly code: string) {
    super(message)
  }
}

export function identityFromRequest(request: Request): RequestIdentity | null {
  const externalIdentity = request.headers.get("oai-authenticated-user-id")?.trim() ?? ""
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? ""
  if (!externalIdentity || !email) return null
  const encodedName = request.headers.get("oai-authenticated-user-full-name")
  const displayName = encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? safeDecode(encodedName) || email
    : email
  return { externalIdentity, email, displayName }
}

function bootstrapAdminEmails() {
  return new Set((process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean))
}

export async function resolveAuthorizedIdentity(identity: RequestIdentity): Promise<SecurityContext> {
  const db = getDb()
  const now = new Date().toISOString()
  let bootstrapCreated = false
  let [user] = await db.select().from(applicationUsers).where(or(
    eq(applicationUsers.externalIdentity, identity.externalIdentity),
    eq(applicationUsers.email, identity.email),
  )).limit(1)

  if (!user && bootstrapAdminEmails().has(identity.email)) {
    bootstrapCreated = true
    ;[user] = await db.insert(applicationUsers).values({
      externalIdentity: identity.externalIdentity,
      displayName: identity.displayName,
      email: identity.email,
      role: "ADMIN",
      enabled: true,
      lastLoginAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: applicationUsers.email,
      set: { externalIdentity: identity.externalIdentity, displayName: identity.displayName, enabled: true, role: "ADMIN", lastLoginAt: now, updatedAt: now },
    }).returning()
  }

  if (!user || !isApplicationRole(user.role)) {
    await db.insert(securityAuditEvents).values({ actorIdentity: identity.externalIdentity, actorName: identity.displayName, action: "login_denied", entityType: "application_user", result: "not_authorized", source: "siwc" })
    throw new AccessError("Your account is not authorized to access Corporate Network.", 403, "not_authorized")
  }
  if (!user.enabled) {
    await db.insert(securityAuditEvents).values({ actorUserId: user.id, actorIdentity: identity.externalIdentity, actorName: identity.displayName, actorRole: user.role, action: "login_denied", entityType: "application_user", entityId: String(user.id), result: "account_disabled", source: "siwc" })
    throw new AccessError("Your Corporate Network access has been disabled. Contact an administrator.", 403, "account_disabled")
  }

  const firstRecordedLogin = !user.lastLoginAt
  if (user.externalIdentity !== identity.externalIdentity || user.displayName !== identity.displayName || !user.lastLoginAt) {
    ;[user] = await db.update(applicationUsers).set({
      externalIdentity: identity.externalIdentity,
      displayName: identity.displayName,
      lastLoginAt: now,
      updatedAt: now,
    }).where(eq(applicationUsers.id, user.id)).returning()
  } else {
    await db.update(applicationUsers).set({ lastLoginAt: now }).where(eq(applicationUsers.id, user.id))
  }

  if (bootstrapCreated) {
    await db.insert(securityAuditEvents).values({ actorUserId: user.id, actorIdentity: identity.externalIdentity, actorName: identity.displayName, actorRole: "ADMIN", action: "bootstrap_admin_authorized", entityType: "application_user", entityId: String(user.id), source: "siwc" })
  }
  if (bootstrapCreated || firstRecordedLogin) {
    await db.insert(securityAuditEvents).values({ actorUserId: user.id, actorIdentity: identity.externalIdentity, actorName: identity.displayName, actorRole: user.role, action: "login_success", entityType: "application_user", entityId: String(user.id), source: "siwc" })
  }

  return { userId: user.id, externalIdentity: identity.externalIdentity, email: identity.email, displayName: identity.displayName, role: user.role as ApplicationRole }
}

export async function authenticateRequest(request: Request): Promise<SecurityContext> {
  const identity = identityFromRequest(request)
  if (!identity) throw new AccessError("Authentication is required.", 401, "authentication_required")
  return resolveAuthorizedIdentity(identity)
}

export async function authorizeRequest(request: Request, permission: Permission): Promise<SecurityContext> {
  const context = await authenticateRequest(request)
  if (!hasPermission(context.role, permission)) {
    throw new AccessError("You do not have permission to perform this action.", 403, "insufficient_permission")
  }
  return context
}

export function toAccessSession(context: SecurityContext, signOutPath = "/signout-with-chatgpt?return_to=%2F"): AccessSession {
  return {
    displayName: context.displayName,
    role: context.role,
    signOutPath,
    canViewContacts: hasPermission(context.role, "VIEW_CONTACTS"),
    canOperate: hasPermission(context.role, "OPERATE_PCOM"),
    canAdminister: hasPermission(context.role, "MANAGE_USERS"),
  }
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof AccessError) return Response.json({ error: error.message, code: error.code }, { status: error.status })
  return null
}

export async function writeSecurityAudit(context: SecurityContext | null, event: {
  action: string
  entityType: string
  entityId?: string | number
  metadata?: Record<string, unknown>
  result?: string
  source?: string
}) {
  await getDb().insert(securityAuditEvents).values({
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

function safeDecode(value: string) {
  try { return decodeURIComponent(value) } catch { return "" }
}
