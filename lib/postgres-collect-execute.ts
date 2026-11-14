import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, coresignalWebhookEvents, providerResponseHistory } from "@/db/postgres/schema"
import { collectPreflight, executeCollectOnce,
  knownAlumnusCollectChanges, serializeCollectEvidence, verifyCollectConfirmation } from "@/lib/coresignal-collect-only"
import { CORESIGNAL_COLLECT_ESTIMATED_CREDITS, webhookMockEnabled } from "@/lib/coresignal-webhooks"
import { postgresCollectClaimStore } from "@/lib/postgres-collect-claim-store"
import { postgresCollectRuntime, postgresKnownCollectAlumnus, postgresSelectedCollectCandidate } from "@/lib/postgres-collect-selection-preflight"
import { coresignalCollectMockTransportEnabled } from "@/lib/provider-runtime"
import { classifyCurrentTitle } from "@/lib/seniority-classifier"
import { writeSecurityAudit, type SecurityContext } from "@/lib/security"

type Payload = { action?: string; searchHistoryId?: number; alumnusId?: number; employeeId?: string; webhookEventId?: number; confirmed?: boolean; confirmationToken?: string }
type MockTransport = (employeeId: string) => Promise<{ body: unknown; upstreamHttpStatus: number; providerCreditsRemaining: number | null }>

/** Local disposable mock execution only. The live provider path is deliberately
 * unavailable until its external balance and interruption checks are accepted. */
export async function postgresExecuteMockCollect(payload: Payload, context: SecurityContext, transport: MockTransport): Promise<Response> {
  if (process.env.CN_PG_LOCAL_TEST_ENABLED !== "true" || !coresignalCollectMockTransportEnabled()) {
    return Response.json({ error: "PostgreSQL Collect execution is pending provider accounting acceptance." }, { status: 501 })
  }
  if (payload.webhookEventId && (!Number.isSafeInteger(payload.webhookEventId) || payload.webhookEventId < 1 || !Number.isSafeInteger(payload.alumnusId))) {
    return Response.json({ error: "A saved notification and alumnus are required." }, { status: 400 })
  }
  if (payload.webhookEventId && !webhookMockEnabled()) {
    return Response.json({ error: "Event-triggered Collect requires isolated, Admin-only mock transport; live Collect is disabled." }, { status: 409 })
  }
  if (!Number.isInteger(payload.alumnusId) && (!Number.isInteger(payload.searchHistoryId) || typeof payload.employeeId !== "string")) {
    return Response.json({ error: "A saved alumnus or retained Search History record and Employee ID are required." }, { status: 400 })
  }
  const resolved = Number.isInteger(payload.alumnusId)
    ? await postgresKnownCollectAlumnus(payload.alumnusId!, payload.employeeId, payload.webhookEventId)
    : await postgresSelectedCollectCandidate(payload.searchHistoryId!, payload.employeeId!)
  const preflight = collectPreflight(resolved.candidate, await postgresCollectRuntime())
  if (payload.webhookEventId && preflight.runtime.applicationUnitsRemaining < CORESIGNAL_COLLECT_ESTIMATED_CREDITS) {
    preflight.allowed = false
    preflight.blockers.push("The application budget cannot cover this full-record Collect.")
  }
  if (payload.action !== "execute" || payload.confirmed !== true || typeof payload.confirmationToken !== "string") {
    return Response.json({ error: "Explicit Collect confirmation is required." }, { status: 400 })
  }
  const confirmationValid = verifyCollectConfirmation(payload.confirmationToken, {
    searchHistoryId: resolved.candidate.searchHistoryId, employeeId: resolved.candidate.employeeId,
    searchAttemptId: resolved.searchAttemptId,
  }, process.env.AUTH_SESSION_SECRET?.trim() ?? "")
  const result = await executeCollectOnce({ preflight, confirmationValid, actor: context.displayName,
    store: postgresCollectClaimStore(getPostgresDb()), transport })
  if (result.state === "DUPLICATE_BLOCKED") {
    return Response.json({ error: "A Collect attempt already exists for this retained candidate. No provider request was made.", state: result.state }, { status: 409 })
  }
  let comparisonOutcome = "IDENTITY_RESOLUTION_REQUIRED"
  if (result.state === "REVIEW_REQUIRED" && result.evidence && result.claimId) {
    const db = getPostgresDb()
    await db.transaction(async tx => {
      if (resolved.candidate.sourceAlumnusId) {
        const [person] = await tx.select().from(alumni).where(eq(alumni.id, resolved.candidate.sourceAlumnusId)).limit(1)
        if (person && person.coresignalEmployeeId === result.evidence!.returnedEmployeeId) {
          const comparison = knownAlumnusCollectChanges(person, result.evidence!)
          comparisonOutcome = comparison.outcome
          for (const item of comparison.changes) await tx.insert(alumniProfileChangeProposals).values({
            alumnusId: person.id, ...item, source: `Coresignal Collect #${result.claimId}`,
            expectedRecordVersion: person.recordVersion, proposedBy: context.displayName,
            mutationRequestKey: `coresignal-collect:${result.claimId}`,
          }).onConflictDoNothing()
        } else comparisonOutcome = "IDENTITY_CONFLICT"
        if (comparisonOutcome === "NO_CHANGE") result.evidence!.reviewState = "NO_CHANGE"
        await tx.update(providerResponseHistory).set({ responseSummary: serializeCollectEvidence(
          `One Base Employee Collect request succeeded. Known-alumnus comparison: ${comparisonOutcome}. No canonical update.`, result.evidence!,
        ) }).where(and(eq(providerResponseHistory.id, result.claimId), eq(providerResponseHistory.status, "success")))
      }
      for (const position of result.evidence!.employment) {
        const classification = classifyCurrentTitle(position.title, position.company)
        await tx.insert(alumniEmploymentEvidence).values({
          alumnusId: comparisonOutcome === "IDENTITY_CONFLICT" ? null : resolved.candidate.sourceAlumnusId ?? null,
          evidenceSource: "Coresignal Base Employee Collect", providerEmployeeId: result.evidence!.returnedEmployeeId,
          providerResponseId: result.claimId, stableCompanyId: position.companyId, originalCompanyName: position.company,
          originalJobTitle: position.title, normalizedJobTitle: classification.state === "CLASSIFIED" ? classification.level : classification.state,
          startDate: position.startDate, endDate: position.endDate, isCurrent: position.current, isDeleted: false,
          observedAt: result.evidence!.freshness.checkedAt || result.evidence!.audit.completedAt,
          evidenceVersion: String(result.evidence!.schemaVersion), verificationStatus: "UNVERIFIED", reviewerStatus: "PENDING",
        }).onConflictDoNothing()
      }
      if (resolved.candidate.sourceWebhookEventId) await tx.update(coresignalWebhookEvents).set({ collectHistoryId: result.claimId,
        status: comparisonOutcome === "NO_CHANGE" ? "NO_MATERIAL_CHANGE" : "PROFILE_COLLECTED", reviewOutcome: comparisonOutcome,
      }).where(and(eq(coresignalWebhookEvents.id, resolved.candidate.sourceWebhookEventId),
        eq(coresignalWebhookEvents.status, "PROFILE_COLLECTION_APPROVED")))
    })
  }
  await writeSecurityAudit(context, { action: "coresignal_collect_only_executed", entityType: "provider_response_history", entityId: result.claimId,
    metadata: { sourceSearchHistoryId: resolved.candidate.searchHistoryId, sourceAlumnusId: resolved.candidate.sourceAlumnusId ?? null,
      sourceWebhookEventId: resolved.candidate.sourceWebhookEventId ?? null, employeeId: resolved.candidate.employeeId,
      comparisonOutcome, providerCalls: 0, canonicalMutations: 0, identityAttachments: 0 } })
  return Response.json({ state: comparisonOutcome === "NO_CHANGE" ? "EVIDENCE_STORED" : result.state, comparisonOutcome, evidence: result.evidence })
}
