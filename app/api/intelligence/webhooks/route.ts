import { env } from "cloudflare:workers"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, coresignalWebhookCoverage, coresignalWebhookEvents, coresignalWebhookIdentities, coresignalWebhookOperations, coresignalWebhookSubscriptions } from "@/db/schema"
import { parseCnSelectionContract } from "@/lib/cn-selection-contract"
import { callbackToken, classifyWebhookMembers, coverageReconciliation, effectiveSubscriptionStatus, renewalDue, webhookMockEnabled } from "@/lib/coresignal-webhooks"
import { evaluateCnSelection } from "@/lib/intelligence-selection.server"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"
import { POST as receiveWebhook } from "@/app/api/webhooks/coresignal/[subscriptionId]/[token]/route"

type SelectionInput = { cohortType: "DYNAMIC_FILTER" | "FIXED_IDS"; selection?: unknown; ids?: number[]; name?: string }
const MAX_PREPARED = 100
function responseError(error: unknown) { return accessErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Webhook monitoring operation failed." }, { status: 409 }) }
function validId(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null }
function mockAllowed() { return webhookMockEnabled() }

async function selectionPreview(input: SelectionInput) {
  const db = getDb()
  let ids: number[]
  let selectionVersion: string
  let selectionJson: string
  if (input.cohortType === "DYNAMIC_FILTER") {
    const contract = parseCnSelectionContract(input.selection)
    if (!contract.criteria.minPlacementRelevance && !contract.criteria.minDataConfidence) throw new Error("A high-priority dynamic selection threshold is required.")
    const selected = await evaluateCnSelection(contract)
    ids = selected.members.map(item => item.cnAlumniId)
    selectionVersion = `${selected.version}:${selected.scoreVersion}`
    selectionJson = JSON.stringify(contract)
  } else if (input.cohortType === "FIXED_IDS") {
    if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > MAX_PREPARED || input.ids.some(id => !validId(id))) throw new Error("Fixed monitoring requires 1–100 explicit CN alumni IDs.")
    ids = [...new Set(input.ids)]
    selectionVersion = "fixed-cn-ids-v1"
    selectionJson = JSON.stringify(ids)
  } else throw new Error("Unsupported monitoring cohort type.")
  const people = []
  for (let offset = 0; offset < ids.length; offset += 500) people.push(...await db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId, intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(inArray(alumni.id, ids.slice(offset, offset + 500))))
  const [attestations, covered] = await Promise.all([
    db.select().from(coresignalWebhookIdentities),
    db.select({ alumnusId: coresignalWebhookCoverage.alumnusId, employeeId: coresignalWebhookCoverage.employeeId }).from(coresignalWebhookCoverage).where(eq(coresignalWebhookCoverage.status, "ACTIVE")),
  ])
  const classified = classifyWebhookMembers(ids, people, attestations, covered)
  const counts = Object.fromEntries(["ELIGIBLE", "PENDING_PROVIDER_MAPPING", "IDENTITY_REVIEW_REQUIRED", "ALREADY_COVERED"].map(status => [status, classified.filter(item => item.status === status).length]))
  const eligible = classified.filter(item => item.status === "ELIGIBLE").slice(0, MAX_PREPARED)
  return { ids, classified, counts, eligible, selectionVersion, selectionJson, remainingEligible: Number(counts.ELIGIBLE) - eligible.length, selectedCount: ids.length }
}

async function readPlan(id: number) {
  const [plan] = await getDb().select().from(coresignalWebhookSubscriptions).where(eq(coresignalWebhookSubscriptions.id, id)).limit(1)
  if (!plan) throw new Error("Monitoring subscription was not found.")
  return plan
}

export async function GET(request: Request) {
  try {
    const actor = await authorizeRequest(request, "OPERATE_PCOM")
    const db = getDb()
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1")
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return Response.json({ error: "Invalid page." }, { status: 400 })
    const [plans, events, coverageCounts] = await Promise.all([
      db.select().from(coresignalWebhookSubscriptions).orderBy(desc(coresignalWebhookSubscriptions.id)).limit(20).offset((page - 1) * 20),
      db.select({ id: coresignalWebhookEvents.id, subscriptionId: coresignalWebhookEvents.subscriptionId, alumnusId: coresignalWebhookEvents.alumnusId, employeeId: coresignalWebhookEvents.employeeId, changeType: coresignalWebhookEvents.changeType, changedFieldsJson: coresignalWebhookEvents.changedFieldsJson, providerAt: coresignalWebhookEvents.providerAt, receivedAt: coresignalWebhookEvents.receivedAt, status: coresignalWebhookEvents.status, errorState: coresignalWebhookEvents.errorState, reviewOutcome: coresignalWebhookEvents.reviewOutcome, collectHistoryId: coresignalWebhookEvents.collectHistoryId, name: alumni.name, company: alumni.company, title: alumni.title }).from(coresignalWebhookEvents).leftJoin(alumni, eq(coresignalWebhookEvents.alumnusId, alumni.id)).orderBy(desc(coresignalWebhookEvents.id)).limit(20).offset((page - 1) * 20),
      db.select({ subscriptionId: coresignalWebhookCoverage.subscriptionId, count: sql<number>`count(*)` }).from(coresignalWebhookCoverage).where(eq(coresignalWebhookCoverage.status, "ACTIVE")).groupBy(coresignalWebhookCoverage.subscriptionId),
    ])
    const countByPlan = new Map(coverageCounts.map(item => [item.subscriptionId, Number(item.count)]))
    return Response.json({ providerMode: "mock-only", liveActivationAvailable: false, collectionCreditEstimate: 10, autoCollect: false,
      plans: plans.map(plan => ({ ...plan, status: effectiveSubscriptionStatus(plan.status, plan.activatedAt, plan.expiresAt), coveredCount: countByPlan.get(plan.id) ?? 0, membershipJson: actor.role === "ADMIN" ? plan.membershipJson : "[redacted]" })),
      events: events.map(event => ({ ...event, employeeId: actor.role === "ADMIN" ? event.employeeId : "[redacted]" })), page })
  } catch (error) { return responseError(error) }
}

export async function POST(request: Request) {
  try {
    const bodyText = await request.text()
    if (bodyText.length > 512_000) return Response.json({ error: "Monitoring request is too large." }, { status: 413 })
    const body = JSON.parse(bodyText) as SelectionInput & { action?: string; subscriptionId?: number; alumnusId?: number; evidenceReference?: string; confirmation?: string; eventId?: number; outcome?: string }
    const actor = await authorizeRequest(request, body.action === "preview" ? "OPERATE_PCOM" : "MANAGE_PROVIDER_SETTINGS")
    const db = getDb()
    if (body.action === "preview" || body.action === "prepare") {
      const preview = await selectionPreview(body)
      if (body.action === "preview") return Response.json({ selectedCount: preview.selectedCount, counts: preview.counts, preparedCount: preview.eligible.length, remainingEligible: preview.remainingEligible, excludedFromBatch: preview.selectedCount - preview.eligible.length, providerRequests: 0, estimatedSubscriptionCredits: 0, eligible: actor.role === "ADMIN" ? preview.eligible : undefined })
      if (!body.name?.trim() || body.name.length > 120 || !preview.eligible.length) throw new Error("Name and at least one verified, uncovered Base Employee ID are required.")
      const [plan] = await db.insert(coresignalWebhookSubscriptions).values({ name: body.name.trim(), cohortType: body.cohortType, selectionJson: preview.selectionJson, selectionVersion: preview.selectionVersion, membershipJson: JSON.stringify(preview.eligible), createdBy: actor.displayName }).returning()
      await writeSecurityAudit(actor, { action: "coresignal_webhook_plan_prepared", entityType: "coresignal_webhook_subscriptions", entityId: plan.id, metadata: { memberCount: preview.eligible.length, selectionVersion: preview.selectionVersion, providerRequests: 0 } })
      return Response.json({ id: plan.id, status: plan.status, employeeIds: preview.eligible.map(item => item.employeeId), selectedCount: preview.selectedCount, preparedCount: preview.eligible.length, remainingEligible: preview.remainingEligible, providerRequests: 0 })
    }
    if (body.action === "attest") {
      const id = validId(body.alumnusId)
      if (!id || !body.evidenceReference?.trim() || body.evidenceReference.length > 300 || body.confirmation !== "VERIFY_BASE_EMPLOYEE_ID") throw new Error("Exact Base Employee mapping verification and evidence reference are required.")
      const [person] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
      if (!person || !/^\d{1,18}$/.test(person.coresignalEmployeeId) || person.intakeStatus === "PROVISIONAL" || person.profileMatch === "Mismatch") throw new Error("This saved identity is not eligible for Base Employee attestation.")
      const existing = await db.select().from(coresignalWebhookIdentities).where(eq(coresignalWebhookIdentities.alumnusId, id)).limit(1)
      if (existing.length) throw new Error("An attestation already exists; identity changes require separate review.")
      await db.insert(coresignalWebhookIdentities).values({ alumnusId: id, employeeId: person.coresignalEmployeeId, evidenceReference: body.evidenceReference.trim(), verifiedBy: actor.displayName })
      await writeSecurityAudit(actor, { action: "coresignal_base_employee_id_attested", entityType: "alumni", entityId: id, metadata: { employeeId: person.coresignalEmployeeId, evidenceReference: body.evidenceReference.trim() } })
      return Response.json({ alumnusId: id, status: "VERIFIED", providerRequests: 0 })
    }
    const id = validId(body.subscriptionId)
    if (!id) throw new Error("A saved monitoring subscription is required.")
    const plan = await readPlan(id)
    if (body.action === "simulate") {
      if (!mockAllowed() || process.env.CORESIGNAL_WEBHOOK_RECEIVE_ENABLED !== "true") throw new Error("Isolated mock transport and callback receiver must both be enabled for simulation.")
      const alumnusId = validId(body.alumnusId)
      if (plan.status !== "ACTIVE" || !alumnusId || body.confirmation !== `SIMULATE ${id} ${alumnusId}`) throw new Error("An active mock subscription, covered alumnus, and exact confirmation are required.")
      const [covered] = await db.select().from(coresignalWebhookCoverage).where(and(eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.alumnusId, alumnusId), eq(coresignalWebhookCoverage.status, "ACTIVE"))).limit(1)
      if (!covered) throw new Error("The alumnus is not covered by this subscription.")
      const secret = process.env.CORESIGNAL_WEBHOOK_CALLBACK_SECRET?.trim() ?? ""
      const token = await callbackToken(id, secret)
      const response = await receiveWebhook(new Request(`http://127.0.0.1/api/webhooks/coresignal/${id}/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ member_id: covered.employeeId, status: "changed", changed_fields: ["experience"], event_id: `mock-${crypto.randomUUID()}` }]) }), { params: Promise.resolve({ subscriptionId: String(id), token }) })
      if (!response.ok) throw new Error("Mock callback was not persisted; inspect receiver configuration.")
      const result = await response.json() as { stored: number; duplicates: number }
      await writeSecurityAudit(actor, { action: "coresignal_webhook_mock_simulated", entityType: "coresignal_webhook_subscriptions", entityId: id, metadata: { alumnusId, stored: result.stored, providerRequests: 0, canonicalMutations: 0 } })
      return Response.json({ ...result, providerRequests: 0, creditsUsed: 0, canonicalMutations: 0 })
    }
    if (body.action === "reconcile") {
      const preview = await selectionPreview({ cohortType: plan.cohortType as SelectionInput["cohortType"], selection: plan.cohortType === "DYNAMIC_FILTER" ? JSON.parse(plan.selectionJson) : undefined, ids: plan.cohortType === "FIXED_IDS" ? JSON.parse(plan.selectionJson) : undefined })
      const current = await db.select().from(coresignalWebhookCoverage).where(and(eq(coresignalWebhookCoverage.subscriptionId, id), eq(coresignalWebhookCoverage.status, "ACTIVE")))
      const currentIds = new Set(current.map(item => item.employeeId))
      const intended = preview.classified.filter(item => item.status === "ELIGIBLE" || (item.status === "ALREADY_COVERED" && currentIds.has(item.employeeId))).map(item => item.employeeId)
      const changes = coverageReconciliation(intended, [...currentIds])
      await db.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: "RECONCILE_PREVIEW", requestKey: crypto.randomUUID(), actor: actor.displayName, status: "PREVIEW_ONLY", requestJson: JSON.stringify({ selectionVersion: preview.selectionVersion }), responseJson: JSON.stringify({ add: changes.add.length, remove: changes.remove.length, unchanged: changes.unchanged.length }) })
      await db.update(coresignalWebhookSubscriptions).set({ lastReconciledAt: new Date().toISOString() }).where(eq(coresignalWebhookSubscriptions.id, id))
      return Response.json({ changes: { ...changes, add: changes.add.slice(0, MAX_PREPARED) }, remainingAdditions: Math.max(0, changes.add.length - MAX_PREPARED), counts: preview.counts, providerRequests: 0, nextAction: "Review bounded changes; provider membership has not been edited." })
    }
    if (body.action === "activate") {
      if (!mockAllowed()) return Response.json({ error: "Live Base Employee subscription creation is disabled pending exact provider contract and separate authorization." }, { status: 409 })
      if (plan.status !== "DRAFT") throw new Error("Only a draft can be activated; ambiguous states require reconciliation.")
      const members = JSON.parse(plan.membershipJson) as Array<{ alumnusId: number; employeeId: string }>
      if (!members.length || members.length > MAX_PREPARED || body.confirmation !== `ACTIVATE ${id} ${members.length}`) throw new Error("Explicit exact-batch activation confirmation is required.")
      const [subscriptionCount] = await db.select({ count: sql<number>`count(*)` }).from(coresignalWebhookSubscriptions).where(eq(coresignalWebhookSubscriptions.status, "ACTIVE"))
      if (Number(subscriptionCount?.count ?? 0) >= 500) throw new Error("The documented 500-subscription account ceiling has been reached.")
      const current = await selectionPreview({ cohortType: plan.cohortType as SelectionInput["cohortType"], selection: plan.cohortType === "DYNAMIC_FILTER" ? JSON.parse(plan.selectionJson) : undefined, ids: plan.cohortType === "FIXED_IDS" ? JSON.parse(plan.selectionJson) : undefined })
      const eligible = new Set(current.eligible.map(item => `${item.alumnusId}:${item.employeeId}`))
      if (members.some(item => !eligible.has(`${item.alumnusId}:${item.employeeId}`)) || current.selectionVersion !== plan.selectionVersion) throw new Error("Cohort membership or verified identity changed after preparation; prepare a new batch.")
      const claimed = await env.DB.prepare("UPDATE coresignal_webhook_subscriptions SET status='PENDING_ACTIVATION' WHERE id=? AND status='DRAFT' RETURNING id").bind(id).first()
      if (!claimed) throw new Error("Activation was already claimed; reconcile before any retry.")
      const requestKey = crypto.randomUUID()
      await db.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: "CREATE_IDS", requestKey, actor: actor.displayName, status: "CLAIMED", requestJson: JSON.stringify({ employeeIds: members.map(item => item.employeeId), selectionVersion: plan.selectionVersion }) })
      const now = new Date(); const expiry = new Date(now.getTime() + 91 * 86_400_000)
      const providerId = `mock-base-experience-${crypto.randomUUID()}`
      const statements = [env.DB.prepare("UPDATE coresignal_webhook_subscriptions SET provider_subscription_id=?, status='ACTIVE', activated_at=?, expires_at=?, last_error='' WHERE id=? AND status='PENDING_ACTIVATION'").bind(providerId, now.toISOString(), expiry.toISOString(), id),
        ...members.map(item => env.DB.prepare("INSERT INTO coresignal_webhook_coverage(subscription_id,alumnus_id,employee_id,status) VALUES(?,?,?,'ACTIVE')").bind(id, item.alumnusId, item.employeeId)),
        env.DB.prepare("UPDATE coresignal_webhook_operations SET status='CONFIRMED', response_json=?, updated_at=? WHERE request_key=?").bind(JSON.stringify({ providerSubscriptionId: providerId, expiresAt: expiry.toISOString(), mode: "mock" }), now.toISOString(), requestKey)]
      try { await env.DB.batch(statements) } catch { await db.update(coresignalWebhookSubscriptions).set({ status: "ERROR", lastError: "Mock activation was not fully persisted; inspect coverage before retry." }).where(eq(coresignalWebhookSubscriptions.id, id)); throw new Error("Activation persistence failed; no live provider request occurred.") }
      await writeSecurityAudit(actor, { action: "coresignal_webhook_mock_activated", entityType: "coresignal_webhook_subscriptions", entityId: id, metadata: { memberCount: members.length, providerMode: "mock", creditsUsed: 0 } })
      return Response.json({ id, status: "ACTIVE", providerSubscriptionId: providerId, expiresAt: expiry.toISOString(), providerRequests: 0, creditsUsed: 0 })
    }
    if (body.action === "renew" || body.action === "stop") {
      if (!mockAllowed()) throw new Error("Provider lifecycle requests are disabled until separately authorized and contract-verified.")
      if (plan.status !== "ACTIVE" || body.confirmation !== `${body.action.toUpperCase()} ${id}`) throw new Error("Active state and explicit confirmation are required.")
      if (body.action === "renew" && !renewalDue(plan.activatedAt, plan.expiresAt)) throw new Error("Renewal is not due or would exceed the one-year ceiling.")
      const nextExpiry = body.action === "renew" ? new Date(Date.parse(plan.expiresAt) + 91 * 86_400_000).toISOString() : plan.expiresAt
      await db.batch([
        db.update(coresignalWebhookSubscriptions).set(body.action === "renew" ? { expiresAt: nextExpiry } : { status: "STOPPED" }).where(and(eq(coresignalWebhookSubscriptions.id, id), eq(coresignalWebhookSubscriptions.status, "ACTIVE"))),
        ...(body.action === "stop" ? [db.update(coresignalWebhookCoverage).set({ status: "STOPPED" }).where(eq(coresignalWebhookCoverage.subscriptionId, id))] : []),
        db.insert(coresignalWebhookOperations).values({ subscriptionId: id, action: body.action.toUpperCase(), requestKey: crypto.randomUUID(), actor: actor.displayName, status: "CONFIRMED", responseJson: JSON.stringify({ mode: "mock", expiresAt: nextExpiry }) }),
      ] as Parameters<typeof db.batch>[0])
      await writeSecurityAudit(actor, { action: `coresignal_webhook_mock_${body.action}`, entityType: "coresignal_webhook_subscriptions", entityId: id, metadata: { providerMode: "mock", creditsUsed: 0 } })
      return Response.json({ id, status: body.action === "stop" ? "STOPPED" : "ACTIVE", expiresAt: nextExpiry, providerRequests: 0 })
    }
    if (body.action === "review") {
      const eventId = validId(body.eventId)
      if (!eventId || !["REVIEW_REQUIRED", "IGNORED"].includes(body.outcome ?? "")) throw new Error("A supported review outcome is required.")
      const updated = await env.DB.prepare("UPDATE coresignal_webhook_events SET status=?, review_outcome=? WHERE id=? AND subscription_id=? AND status IN ('AWAITING_PROFILE_COLLECTION','REVIEW_REQUIRED') RETURNING id").bind(body.outcome, `${actor.displayName}: ${body.outcome}`, eventId, id).first()
      if (!updated) throw new Error("The notification is not available for review.")
      await writeSecurityAudit(actor, { action: "coresignal_webhook_event_reviewed", entityType: "coresignal_webhook_events", entityId: eventId, metadata: { outcome: body.outcome, canonicalMutations: 0 } })
      return Response.json({ eventId, status: body.outcome, canonicalMutations: 0 })
    }
    throw new Error("Unsupported monitoring action.")
  } catch (error) { return responseError(error) }
}
