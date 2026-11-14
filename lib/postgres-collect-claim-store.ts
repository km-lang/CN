import { and, eq } from "drizzle-orm"

import type { PostgresDatabase } from "@/db/postgres/adapter"
import { coresignalWebhookEvents } from "@/db/postgres/schema"
import { CORESIGNAL_COLLECT_OPERATION, type CollectClaimStore } from "@/lib/coresignal-collect-only"
import { CORESIGNAL_COLLECT_ESTIMATED_CREDITS } from "@/lib/coresignal-webhooks"
import { postgresReserveProviderClaim, postgresSettleCoresignalCollect } from "@/lib/postgres-provider-claims"

const requestSummaryPrefix = "Retained Search Collect-only"

/** Store only the pre-request claim and its outcome. Evidence and security
 * audit stay with the caller, matching the existing Collect workflow. */
export function postgresCollectClaimStore(db: PostgresDatabase): CollectClaimStore {
  return {
    async acquire({ candidate, attemptId, actor, transportMode }) {
      const summary = candidate.sourceWebhookEventId
        ? `Webhook event #${candidate.sourceWebhookEventId} Collect-only · Employee ID ${candidate.employeeId}`
        : `${requestSummaryPrefix} · Employee ID ${candidate.employeeId}`
      const claimResponseSummary = candidate.sourceWebhookEventId
        ? `Webhook event #${candidate.sourceWebhookEventId} mock Collect claimed; no provider response retained yet.`
        : `Collect attempt ${attemptId} claimed; no provider response retained yet.`
      const claim = await postgresReserveProviderClaim(db, {
        kind: "coresignal_collect", mode: candidate.sourceWebhookEventId ? "mock" : transportMode,
        alumnusId: candidate.sourceAlumnusId ?? null,
        alumnusName: candidate.sourceAlumnusId ? `Alumnus ${candidate.sourceAlumnusId}` : "Unresolved Coresignal candidate",
        searchId: candidate.sourceAlumnusId ? null : candidate.searchHistoryId,
        operation: CORESIGNAL_COLLECT_OPERATION,
        applicationUnits: CORESIGNAL_COLLECT_ESTIMATED_CREDITS,
        requestSummary: summary,
        responseSummary: claimResponseSummary,
        requestedBy: actor,
      })
      if (!claim.acquired) return { acquired: false }
      if (candidate.sourceWebhookEventId && candidate.sourceAlumnusId) {
        const [approved] = await db.update(coresignalWebhookEvents).set({ status: "PROFILE_COLLECTION_APPROVED", collectHistoryId: claim.id })
          .where(and(eq(coresignalWebhookEvents.id, candidate.sourceWebhookEventId),
            eq(coresignalWebhookEvents.alumnusId, candidate.sourceAlumnusId),
            eq(coresignalWebhookEvents.employeeId, candidate.employeeId),
            eq(coresignalWebhookEvents.status, "AWAITING_PROFILE_COLLECTION")))
          .returning({ id: coresignalWebhookEvents.id })
        if (!approved) {
          await postgresSettleCoresignalCollect(db, { id: claim.id, status: "error", reservation: claim.reservation,
            responseSummary: claimResponseSummary,
            errorMessage: "Notification was no longer eligible before mock Collect; no provider request made." })
          return { acquired: false }
        }
      }
      return { acquired: true, claimId: claim.id }
    },
    async complete({ claimId, evidence, responseSummary }) {
      const settled = await postgresSettleCoresignalCollect(db, { id: claimId, status: "success",
        reservation: CORESIGNAL_COLLECT_ESTIMATED_CREDITS, responseSummary })
      return settled && evidence.providerActions.collectRequests === 1
    },
    async fail({ claimId, candidate, status, message }) {
      const settled = await postgresSettleCoresignalCollect(db, { id: claimId, status,
        reservation: CORESIGNAL_COLLECT_ESTIMATED_CREDITS,
        responseSummary: "One bounded Collect attempt ended without reviewable evidence. No retry was made.",
        errorMessage: message })
      if (candidate.sourceWebhookEventId) await db.update(coresignalWebhookEvents).set({ status: "REVIEW_REQUIRED",
        errorState: status === "ambiguous" ? "COLLECT_OUTCOME_AMBIGUOUS" : "COLLECT_FAILED",
        reviewOutcome: "Collect attempt requires reconciliation" })
        .where(and(eq(coresignalWebhookEvents.id, candidate.sourceWebhookEventId),
          eq(coresignalWebhookEvents.collectHistoryId, claimId),
          eq(coresignalWebhookEvents.status, "PROFILE_COLLECTION_APPROVED")))
      return settled
    },
  }
}
