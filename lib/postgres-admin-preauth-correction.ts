import { eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { applicationIdentities, applicationUsers, securityAuditEvents } from "@/db/postgres/schema"
import { isLikelyInstitutionalEmailTypo } from "@/lib/email-identity"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { userId?: number; correctUserId?: number; confirmation?: string }
const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Admin pre-authorization correction on PostgreSQL.
 * Same validation, messages, audit payload and success response as D1.
 * Approved concurrency contract (2026-11-15): exactly one concurrent request
 * deletes the duplicate and writes the single success audit; a request that
 * lost the race gets a sanitized 409 and writes nothing. A request for a user
 * that did not exist when it started keeps D1's 404.
 */
export async function postgresCorrectPreAuthorization(payload: Input, context: SecurityContext): Promise<Response> {
  const duplicateId = payload.userId!
  const correctUserId = payload.correctUserId!
  if (payload.confirmation !== `CORRECT USER ${duplicateId}`) return json({ error: `Type CORRECT USER ${duplicateId} to confirm.` }, 409)
  if (duplicateId === context.userId || duplicateId === correctUserId) return json({ error: "This user correction is not permitted." }, 409)
  const db = getPostgresDb()
  const [initiallyPresent] = await db.select({ id: applicationUsers.id }).from(applicationUsers).where(eq(applicationUsers.id, duplicateId)).limit(1)
  return db.transaction(async tx => {
    const [duplicate] = await tx.select().from(applicationUsers).where(eq(applicationUsers.id, duplicateId)).for("update").limit(1)
    const [correctUser] = await tx.select().from(applicationUsers).where(eq(applicationUsers.id, correctUserId)).limit(1)
    if (!duplicate && initiallyPresent) return json({ error: "This pre-authorization was already corrected by a concurrent request." }, 409)
    if (!duplicate || !correctUser) return json({ error: "The requested user record was not found." }, 404)
    const [identity] = await tx.select({ id: applicationIdentities.id }).from(applicationIdentities).where(eq(applicationIdentities.applicationUserId, duplicateId)).limit(1)
    const [actorEvent] = await tx.select({ id: securityAuditEvents.id }).from(securityAuditEvents).where(eq(securityAuditEvents.actorUserId, duplicateId)).limit(1)
    if (duplicate.enabled || duplicate.lastLoginAt || identity || actorEvent) return json({ error: "Only a disabled, never-authenticated and unlinked pre-authorization can be corrected." }, 409)
    if (!correctUser.enabled || duplicate.role !== correctUser.role || !isLikelyInstitutionalEmailTypo(duplicate.email, correctUser.email, duplicate.displayName, correctUser.displayName)) {
      return json({ error: "The proposed correction does not match a conservative institutional-email typo." }, 409)
    }
    await tx.insert(securityAuditEvents).values({
      actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role,
      action: "user_pre_authorization_corrected", entityType: "application_user", entityId: String(duplicate.id),
      metadataJson: safeAuditMetadata({
        reason: `Institutional email was entered incorrectly as ${duplicate.email}.`,
        incorrectUser: { id: duplicate.id, email: duplicate.email },
        correctUser: { id: correctUser.id, email: correctUser.email },
      }),
      result: "success", source: "application",
    })
    const [deleted] = await tx.delete(applicationUsers).where(eq(applicationUsers.id, duplicate.id)).returning({ id: applicationUsers.id })
    if (!deleted) throw new Error("Pre-authorization correction did not persist atomically.")
    return json({ corrected: true, deletedUserId: duplicate.id, correctUserId: correctUser.id })
  })
}
