import { and, eq, gte, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, providerCollectionAttempts, providerResponseHistory, securityAuditEvents } from "@/db/postgres/schema"
import { BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION, BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY, createBrightConfirmation,
  humanTrialRequestKey, normalizeBrightLinkedinUrl } from "@/lib/brightdata-collection"
import { brightDataDatasetId, brightDataHumanTrialTarget, brightDataRuntimeStatus } from "@/lib/provider-runtime"
import type { SecurityContext } from "@/lib/security"

function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString() }

export async function postgresBrightRuntimeState() {
  const db = getPostgresDb()
  const runtime = brightDataRuntimeStatus()
  const [[usage], [attempts]] = await Promise.all([
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)` }).from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.provider, "brightdata"), gte(providerResponseHistory.createdAt, monthStart()))),
    db.select({ used: sql<number>`count(*)::integer` }).from(providerCollectionAttempts)
      .where(and(eq(providerCollectionAttempts.provider, "brightdata"), gte(providerCollectionAttempts.createdAt, monthStart()))),
  ])
  const used = Math.max(Number(usage?.used ?? 0), Number(attempts?.used ?? 0))
  return { ...runtime, applicationBudget: { used, limit: runtime.applicationRequestLimit,
    remaining: Math.max(0, runtime.applicationRequestLimit - used) }, maximumTargets: 1, automaticRetries: 0,
    automaticPolling: false, providerBillingKnown: false }
}

async function eligibleHumanTrial(context: SecurityContext, profileUrl: string) {
  const runtime = brightDataRuntimeStatus()
  if (!runtime.humanTrialEnabled || runtime.mode !== "live" || runtime.entitlement !== "unknown") return null
  try { if (normalizeBrightLinkedinUrl(brightDataHumanTrialTarget()) !== profileUrl) return null } catch { return null }
  const db = getPostgresDb()
  const [audit] = await db.select().from(securityAuditEvents).where(eq(securityAuditEvents.mutationRequestKey, BRIGHTDATA_HUMAN_TRIAL_AUDIT_KEY)).limit(1)
  if (!audit || audit.action !== BRIGHTDATA_HUMAN_TRIAL_AUDIT_ACTION || audit.actorRole !== "ADMIN" || audit.actorUserId !== context.userId) return null
  let metadata: Record<string, unknown>
  try { metadata = JSON.parse(audit.metadataJson) as Record<string, unknown> } catch { return null }
  if (metadata.attestationSource !== "dashboard" || metadata.datasetId !== brightDataDatasetId() || metadata.profileUrl !== profileUrl || metadata.requestQuantity !== 1 || metadata.confirmationStatus !== "AWAITING_SEPARATE_TRIGGER_APPROVAL" || metadata.billingUncertainty !== "actual_account_charge_unverified") return null
  const [used] = await db.select({ id: providerCollectionAttempts.id }).from(providerCollectionAttempts)
    .where(eq(providerCollectionAttempts.requestKey, humanTrialRequestKey(audit.id))).limit(1)
  return used ? null : audit
}

async function targetAlumnusBlocker(alumnusId: number | null, profileUrl: string) {
  if (!alumnusId) return ""
  const [person] = await getPostgresDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
  if (!person) return "The selected Corporate Network alumnus does not exist."
  try {
    if (!person.linkedinUrl || normalizeBrightLinkedinUrl(person.linkedinUrl) !== profileUrl) return "The target URL does not exactly match the selected alumnus's stored LinkedIn identity."
  } catch { return "The selected alumnus does not have a valid stored LinkedIn profile identity." }
  return ""
}

/** Read-only readiness assessment; no provider call, claim, or reservation. */
export async function postgresBrightPreflight(context: SecurityContext, payload: { profileUrl?: string; alumnusId?: number | null; humanTrial?: boolean }): Promise<Response> {
  const profileUrl = normalizeBrightLinkedinUrl(payload.profileUrl ?? "")
  const alumnusId = Number.isInteger(payload.alumnusId) ? payload.alumnusId! : null
  const runtime = await postgresBrightRuntimeState()
  const humanAudit = payload.humanTrial === true && alumnusId === null ? await eligibleHumanTrial(context, profileUrl) : null
  const humanApproved = Boolean(humanAudit)
  const blockers = [!runtime.configured ? "Bright Data server credential and dataset are required." : "",
    !runtime.executionGateEnabled ? "The local Bright Data execution gate is disabled." : "",
    runtime.entitlement !== "confirmed" && !humanApproved ? `Bright Data access entitlement is ${runtime.entitlement}; no eligible one-time human attestation applies.` : "",
    payload.humanTrial === true && !humanApproved ? "The exact isolated Admin dashboard attestation is missing, invalid or already used." : "",
    runtime.applicationBudget.remaining < 1 ? "The Bright Data application request allowance is exhausted." : "",
    await targetAlumnusBlocker(alumnusId, profileUrl)].filter(Boolean)
  const confirmation = blockers.length ? null : createBrightConfirmation({ actorUserId: context.userId, profileUrl, alumnusId,
    ...(humanAudit ? { humanTrialAuditId: humanAudit.id } : {}) }, process.env.AUTH_SESSION_SECRET?.trim() ?? "")
  return Response.json({ allowed: blockers.length === 0, blockers, profileUrl, runtime,
    entitlementBasis: humanApproved ? "HUMAN_ATTESTED_PROVIDER_UNVERIFIED" : runtime.entitlement === "confirmed" ? "CONFIGURED_CONFIRMED" : "UNKNOWN",
    humanTrialAuditId: humanAudit?.id ?? null, confirmationToken: confirmation?.token ?? "", requestKey: confirmation?.confirmation.requestKey ?? "" })
}
