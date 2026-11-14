import { getPostgresDb } from "@/db/postgres/adapter"
import { securityAuditEvents } from "@/db/postgres/schema"
import { BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION, BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY,
  normalizeBrightLinkedinUrl, targetFingerprint } from "@/lib/brightdata-collection"
import { postgresBrightRuntimeState } from "@/lib/postgres-bright-preflight"
import { brightDataDatasetId, brightDataHumanTrialTarget } from "@/lib/provider-runtime"
import { safeAuditMetadata, type SecurityContext } from "@/lib/security"

type Input = { confirmed?: boolean; billingUncertaintyAcknowledged?: boolean; attestationSource?: string;
  requestQuantity?: number; alumnusId?: number | null; datasetId?: string; profileUrl?: string }

/** One-time local Admin attestation; no provider transport or attempt claim. */
export async function postgresBrightHumanTrialAttestation(context: SecurityContext, payload: Input): Promise<Response> {
  if (!payload.confirmed || !payload.billingUncertaintyAcknowledged || payload.attestationSource !== "dashboard"
    || payload.requestQuantity !== 1 || payload.alumnusId !== null || payload.datasetId !== brightDataDatasetId()) {
    return Response.json({ error: "Explicit one-profile dashboard attestation and billing-uncertainty acknowledgement are required." }, { status: 400 })
  }
  const profileUrl = normalizeBrightLinkedinUrl(payload.profileUrl ?? "")
  const runtime = await postgresBrightRuntimeState()
  let configuredTarget = ""
  try { configuredTarget = normalizeBrightLinkedinUrl(brightDataHumanTrialTarget()) } catch { /* fail closed */ }
  if (!runtime.humanTrialEnabled || runtime.mode !== "live" || runtime.entitlement !== "unknown" || !runtime.configured
    || runtime.applicationBudget.remaining < 1 || profileUrl !== configuredTarget) {
    return Response.json({ error: "The isolated one-profile human-trial gate is unavailable for this exact target." }, { status: 409 })
  }
  const attestedAt = new Date().toISOString()
  const [audit] = await getPostgresDb().insert(securityAuditEvents).values({
    actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role,
    action: BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION, entityType: "brightdata_human_trial", entityId: targetFingerprint(profileUrl),
    metadataJson: safeAuditMetadata({ attestationSource: "dashboard", attestedAt, datasetId: brightDataDatasetId(), profileUrl,
      requestQuantity: 1, advertisedRate: "USD 1.50 per 1,000 successful records", estimatedOneRecordCostUsd: 0.0015,
      billingUncertainty: "actual_account_charge_unverified", confirmationStatus: "AWAITING_SEPARATE_TRIGGER_APPROVAL",
      authorizingActorUserId: context.userId }),
    result: "human_attested_provider_unverified", source: "local_admin_dashboard", mutationRequestKey: BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY,
  }).onConflictDoNothing().returning({ id: securityAuditEvents.id })
  if (!audit) return Response.json({ error: "The one-time dashboard attestation already exists; it cannot be issued twice." }, { status: 409 })
  return Response.json({ attested: true, attestationId: audit.id, profileUrl, datasetId: brightDataDatasetId(),
    entitlementBasis: "HUMAN_ATTESTED_PROVIDER_UNVERIFIED", confirmationStatus: "AWAITING_SEPARATE_TRIGGER_APPROVAL", providerCallMade: false })
}
