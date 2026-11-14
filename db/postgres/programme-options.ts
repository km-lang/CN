import { desc, eq } from "drizzle-orm"
import { normaliseProgrammeCode } from "@/lib/programme-options"
import { hasPermission, safeAuditMetadata } from "@/lib/security-policy"
import type { ApplicationRole } from "@/lib/access-types"
import { programmeOptions, securityAuditEvents } from "./schema"
import type { PostgresDatabase } from "./adapter"

export type ProgrammeActor = { userId: number | null; externalIdentity: string; displayName: string; role: ApplicationRole }

export class ProgrammeOptionError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) { super(message) }
}

function requireAdmin(actor: ProgrammeActor) {
  if (!hasPermission(actor.role, "MANAGE_USERS")) throw new ProgrammeOptionError("Administration access is required.", 403)
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ("code" in error && error.code === "23505") return true
  return "cause" in error && isUniqueViolation(error.cause)
}

export async function listPostgresProgrammeOptions(db: PostgresDatabase, actor: ProgrammeActor) {
  requireAdmin(actor)
  return db.select().from(programmeOptions).orderBy(programmeOptions.sortOrder, programmeOptions.name)
}

export async function findPostgresProgrammeOption(db: PostgresDatabase, actor: ProgrammeActor, id: number) {
  requireAdmin(actor)
  if (!Number.isInteger(id) || id < 1) throw new ProgrammeOptionError("Programme ID is invalid.", 400)
  const [programme] = await db.select().from(programmeOptions).where(eq(programmeOptions.id, id)).limit(1)
  return programme ?? null
}

/** Matches the existing add_programme validation and audit fields; writes are atomic. */
export async function addPostgresProgrammeOption(
  db: PostgresDatabase,
  actor: ProgrammeActor,
  input: { code?: unknown; name?: unknown },
  now = new Date().toISOString(),
) {
  requireAdmin(actor)
  const code = normaliseProgrammeCode(input.code)
  const name = String(input.name || code).trim().slice(0, 100)
  if (!code || !name) throw new ProgrammeOptionError("Enter a programme code and name.", 400)
  try {
    return await db.transaction(async tx => {
      const [existing] = await tx.select({ id: programmeOptions.id }).from(programmeOptions).where(eq(programmeOptions.code, code)).limit(1)
      if (existing) throw new ProgrammeOptionError("That programme code already exists.", 409)
      const [last] = await tx.select({ sortOrder: programmeOptions.sortOrder }).from(programmeOptions).orderBy(desc(programmeOptions.sortOrder)).limit(1)
      const [programme] = await tx.insert(programmeOptions).values({ code, name, active: true, sortOrder: (last?.sortOrder ?? 0) + 10, updatedBy: actor.displayName, updatedAt: now }).returning()
      await tx.insert(securityAuditEvents).values({
        actorUserId: actor.userId,
        actorIdentity: actor.externalIdentity,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: "programme_added",
        entityType: "programme_option",
        entityId: String(programme.id),
        metadataJson: safeAuditMetadata({ code, name }),
        result: "success",
        source: "application",
      })
      return programme
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new ProgrammeOptionError("That programme code already exists.", 409)
    throw error
  }
}

/** Preserve the D1 rename/status contracts while committing each audit with its update. */
export async function updatePostgresProgrammeOption(
  db: PostgresDatabase,
  actor: ProgrammeActor,
  input: { action?: unknown; programmeId?: unknown; name?: unknown; active?: unknown; confirmation?: unknown },
  now = new Date().toISOString(),
) {
  requireAdmin(actor)
  const action = input.action
  const id = input.programmeId
  if ((action !== "rename_programme" && action !== "set_programme_status") || !Number.isInteger(id)) {
    throw new ProgrammeOptionError("Unsupported administration action.", 400)
  }
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(programmeOptions).where(eq(programmeOptions.id, id as number)).for("update").limit(1)
    if (!existing) throw new ProgrammeOptionError("Programme option not found.", 404)
    if (action === "set_programme_status" && input.active === false && input.confirmation !== `DEACTIVATE PROGRAMME ${id}`) {
      throw new ProgrammeOptionError(`Type DEACTIVATE PROGRAMME ${id} to confirm.`, 409)
    }
    const changes = action === "rename_programme"
      ? { name: String(input.name ?? "").trim().slice(0, 100), updatedBy: actor.displayName, updatedAt: now }
      : { active: Boolean(input.active), updatedBy: actor.displayName, updatedAt: now }
    if (action === "rename_programme" && !changes.name) throw new ProgrammeOptionError("Enter a programme name.", 400)
    const [programme] = await tx.update(programmeOptions).set(changes).where(eq(programmeOptions.id, id as number)).returning()
    await tx.insert(securityAuditEvents).values({
      actorUserId: actor.userId,
      actorIdentity: actor.externalIdentity,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: action === "rename_programme" ? "programme_renamed" : programme.active ? "programme_activated" : "programme_deactivated",
      entityType: "programme_option",
      entityId: String(id),
      metadataJson: safeAuditMetadata({ code: existing.code, before: existing.name, after: programme.name, active: programme.active }),
      result: "success",
      source: "application",
    })
    return programme
  })
}
