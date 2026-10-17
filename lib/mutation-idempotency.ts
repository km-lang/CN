import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import { mutationRequests } from "@/db/schema"
import type { SecurityContext } from "@/lib/security"
import { sha256Text, stableMutationPayload } from "@/lib/mutation-fingerprint"

export { sha256Text, stableMutationPayload } from "@/lib/mutation-fingerprint"

const REQUEST_KEY_LIMIT = 200

export type MutationIdentity = {
  requestKey: string
  clientKeyHash: string
  payloadHash: string
  operationType: string
  targetKey: string
}

export async function mutationIdentity(request: Request, context: SecurityContext, operationType: string, targetKey: string, payload: unknown): Promise<MutationIdentity> {
  const payloadHash = await sha256Text(stableMutationPayload(payload))
  const supplied = request.headers.get("idempotency-key")?.trim() ?? ""
  if (supplied.length > REQUEST_KEY_LIMIT) throw new Error(`Idempotency-Key cannot exceed ${REQUEST_KEY_LIMIT} characters.`)
  const clientKey = supplied || `payload:${payloadHash}`
  const clientKeyHash = await sha256Text(clientKey)
  const requestKey = await sha256Text(`${context.userId}\n${operationType}\n${targetKey}\n${clientKey}`)
  return { requestKey, clientKeyHash, payloadHash, operationType, targetKey }
}

export async function existingMutation(identity: MutationIdentity, actorUserId: number) {
  const [existing] = await getDb().select().from(mutationRequests).where(and(
    eq(mutationRequests.actorUserId, actorUserId),
    eq(mutationRequests.operationType, identity.operationType),
    eq(mutationRequests.targetKey, identity.targetKey),
    eq(mutationRequests.clientKeyHash, identity.clientKeyHash),
  )).limit(1)
  if (!existing) return null
  if (existing.payloadHash !== identity.payloadHash) return { kind: "conflict" as const, existing }
  if (existing.status === "COMPLETED" && existing.responseJson) return { kind: "completed" as const, existing }
  return { kind: "pending" as const, existing }
}

export function replayMutationResponse(existing: typeof mutationRequests.$inferSelect) {
  try {
    return Response.json(JSON.parse(existing.responseJson), {
      status: existing.httpStatus || 200,
      headers: { "Idempotency-Replayed": "true" },
    })
  } catch {
    return Response.json({ error: "The prior mutation outcome could not be recovered safely." }, { status: 500 })
  }
}

export function mutationConflictResponse() {
  return Response.json({ error: "This Idempotency-Key was already used with a different payload.", code: "IDEMPOTENCY_CONFLICT" }, { status: 409 })
}

export function mutationPendingResponse() {
  return Response.json({ error: "An identical request is already in progress. Retry shortly with the same Idempotency-Key.", code: "IDEMPOTENCY_IN_PROGRESS" }, { status: 409, headers: { "Retry-After": "1" } })
}

export function mutationRequestInsert(identity: MutationIdentity, context: SecurityContext, now: string, leaseExpiresAt = now) {
  return getDb().insert(mutationRequests).values({
    requestKey: identity.requestKey,
    clientKeyHash: identity.clientKeyHash,
    actorUserId: context.userId,
    operationType: identity.operationType,
    targetKey: identity.targetKey,
    payloadHash: identity.payloadHash,
    status: "IN_PROGRESS",
    leaseExpiresAt,
    createdAt: now,
    updatedAt: now,
  })
}
