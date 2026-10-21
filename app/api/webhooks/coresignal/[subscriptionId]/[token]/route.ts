import { env } from "cloudflare:workers"
import { getDb } from "@/db"
import { alumni, coresignalWebhookCoverage, coresignalWebhookEvents, coresignalWebhookIdentities, coresignalWebhookSubscriptions } from "@/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { WEBHOOK_BODY_LIMIT, callbackAuthorized, parseWebhookNotices, sha256 } from "@/lib/coresignal-webhooks"

async function boundedBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("JSON content type is required.")
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (declared > WEBHOOK_BODY_LIMIT) throw new Error("Webhook body is too large.")
  if (!request.body) throw new Error("Webhook body is required.")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > WEBHOOK_BODY_LIMIT) throw new Error("Webhook body is too large.")
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged)) as unknown
}

export async function POST(request: Request, { params }: { params: Promise<{ subscriptionId: string; token: string }> }) {
  const configuredSecret = process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET?.trim() ?? ""
  if (process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED !== "true" || configuredSecret.length < 32) return Response.json({ error: "Webhook reception is disabled." }, { status: 503 })
  const path = await params
  const id = Number(path.subscriptionId)
  if (!Number.isSafeInteger(id) || id < 1 || !(await callbackAuthorized(id, path.token, configuredSecret))) return Response.json({ error: "Webhook authentication failed." }, { status: 401 })
  try {
    const [plan] = await getDb().select().from(coresignalWebhookSubscriptions).where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
    if (!plan || !plan.providerSubscriptionId || !["ACTIVE", "RENEWAL_DUE", "EXPIRED"].includes(plan.status)) return Response.json({ error: "Unknown or stopped subscription." }, { status: 404 })
    const parsed = await boundedBody(request)
    const notices = parseWebhookNotices(parsed)
    const coverage = await getDb().select({ employeeId: coresignalWebhookCoverage.employeeId, alumnusId: coresignalWebhookCoverage.alumnusId,
      savedEmployeeId: alumni.coresignalEmployeeId, intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch,
      attestedEmployeeId: coresignalWebhookIdentities.employeeId, namespace: coresignalWebhookIdentities.namespace, identityStatus: coresignalWebhookIdentities.status })
      .from(coresignalWebhookCoverage).innerJoin(alumni, eq(coresignalWebhookCoverage.alumnusId, alumni.id))
      .leftJoin(coresignalWebhookIdentities, eq(coresignalWebhookCoverage.alumnusId, coresignalWebhookIdentities.alumnusId))
      .where(and(eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.status, "ACTIVE")))
    const byEmployee = new Map(coverage.map(item => [item.employeeId, item]))
    const now = new Date()
    const receivedAt = now.toISOString()
    // A provider event ID or timestamp improves identity. Without one, identical
    // notifications in the same UTC hour are deduplicated, never forever.
    const latestByEmployee = new Map<string, string>()
    for (const employeeId of new Set(notices.map(notice => notice.employeeId))) {
      const [latest] = await getDb().select({ providerAt: coresignalWebhookEvents.providerAt }).from(coresignalWebhookEvents)
        .where(and(eq(coresignalWebhookEvents.subscriptionId, id), eq(coresignalWebhookEvents.employeeId, employeeId)))
        .orderBy(desc(coresignalWebhookEvents.providerAt)).limit(1)
      latestByEmployee.set(employeeId, latest?.providerAt ?? "")
    }
    const queries = await Promise.all(notices.map(async notice => {
      const latestAt = latestByEmployee.get(notice.employeeId) ?? ""
      const outOfOrder = Boolean(notice.providerAt && latestAt && Date.parse(notice.providerAt) < Date.parse(latestAt))
      if (notice.providerAt && (!latestAt || Date.parse(notice.providerAt) > Date.parse(latestAt))) latestByEmployee.set(notice.employeeId, notice.providerAt)
      const dedupeWindow = notice.eventId ? "provider-event-id" : notice.providerAt ? "provider-event-time" : receivedAt.slice(0, 13)
      const digest = await sha256(JSON.stringify({ employeeId: notice.employeeId, changeType: notice.changeType, changedFields: notice.changedFields, providerAt: notice.providerAt, eventId: notice.eventId }))
      const mapped = byEmployee.get(notice.employeeId)
      const reliable = mapped?.savedEmployeeId === notice.employeeId && mapped?.attestedEmployeeId === notice.employeeId && mapped?.namespace === "employee_base" && mapped?.identityStatus === "VERIFIED" && mapped?.intakeStatus !== "PROVISIONAL" && mapped?.profileMatch !== "Mismatch"
      const alumnusId = reliable ? mapped!.alumnusId : null
      const expired = plan.status === "EXPIRED" || (plan.expiresAt && Date.parse(plan.expiresAt) <= now.getTime())
      const status = !mapped ? "QUARANTINED_UNKNOWN_ID" : !reliable ? "QUARANTINED_IDENTITY_CONFLICT" : expired || outOfOrder ? "REVIEW_REQUIRED" : notice.changeType === "changed" ? "AWAITING_PROFILE_COLLECTION" : "REVIEW_REQUIRED"
      const errorState = !mapped ? "UNKNOWN_EMPLOYEE_ID" : !reliable ? "IDENTITY_MAPPING_CHANGED" : expired ? "SUBSCRIPTION_EXPIRED" : outOfOrder ? "OUT_OF_ORDER" : ""
      return env.DB.prepare("INSERT OR IGNORE INTO coresignal_webhook_events(subscription_id,alumnus_id,employee_id,change_type,changed_fields_json,provider_at,received_at,payload_digest,dedupe_window,status,error_state) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id, alumnusId, notice.employeeId, notice.changeType, JSON.stringify(notice.changedFields), notice.providerAt, receivedAt, digest, dedupeWindow, status, errorState)
    }))
    const results = await env.DB.batch(queries)
    const stored = (results as Array<{ meta?: { changes?: number } }>).reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0)
    return Response.json({ stored, duplicates: notices.length - stored, providerRequests: 0, canonicalMutations: 0 }, { status: 202, headers: { "cache-control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook receipt failed."
    const invalid = /JSON|body|event|changed_fields|content type|batch size/i.test(message)
    return Response.json({ error: invalid ? message : "Webhook receipt could not be persisted." }, { status: invalid ? 400 : 503 })
  }
}
