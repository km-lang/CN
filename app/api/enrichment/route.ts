import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { alumni, alumniPrivacyControls, communicationPreferences, fieldChangeHistory, providerRefreshReviews, providerResponseHistory, providerSettings } from "@/db/schema";
import { enrich, enrichmentMode, providerConfigured, type ProviderName } from "@/lib/enrichment-providers";
import { coresignalProvider } from "@/lib/coresignal-adapter";
import { safeCoresignalError } from "@/lib/coresignal-client";
import { getLushaAccountUsage, revealLushaEmail, revealLushaPhone, searchLushaContact } from "@/lib/lusha-client";
import { coresignalLiveRefreshMaximum } from "@/lib/provider-runtime";
import { PROFESSIONAL_DATA_PROVIDER, PROFESSIONAL_DATA_PROVIDER_LABEL, type ProfessionalRefreshResult } from "@/lib/professional-data";
import { providerUsageState } from "@/lib/provider-usage";
import { contactEnrichmentPermission, eligibleContactChannels, type ContactChannel } from "@/lib/contact-enrichment";
import { accessErrorResponse, authenticatedJsonResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security";
import { attachCoresignalIdentity } from "@/lib/coresignal-identity";
import { coresignalIdentityStore } from "@/lib/coresignal-identity-store";
import { presentProviderHistorySearchEvidence } from "@/lib/coresignal-search-evidence";
import { presentProviderHistoryCollectEvidence } from "@/lib/coresignal-collect-only";
import { LUSHA_REQUEST_CLAIM_SQL, lushaApplicationReservation, lushaBalanceCoversReservation, lushaContactEntitlement, lushaReportedChargeExceedsReservation, type LushaGovernedOperation } from "@/lib/lusha-request-guard";
import { LUSHA_APPROVE_REVIEW_SQL, LUSHA_COMPLETE_REVIEWED_HISTORY_SQL, LUSHA_RECORD_IDENTITY_CHANGE_SQL, LUSHA_REJECT_REVIEW_SQL, LUSHA_REVIEWED_ATTACH_ID_SQL, lushaIdentityApprovalEligible, lushaIdentityEvidence, parseLushaIdentityEvidence } from "@/lib/lusha-identity-review";
import { linkedinProfileIdentifier, normalizeProfessionalProfileUrl } from "@/lib/professional-profile";
import { LUSHA_APPROVE_CONTACT_REVIEW_SQL, LUSHA_REJECT_CONTACT_REVIEW_SQL, lushaContactApprovalSql, lushaContactValueValid, parseLushaContactReview, type LushaContactReviewEvidence } from "@/lib/lusha-contact-review";

const providers: ProviderName[] = ["coresignal", "lusha"];
const defaultLimits: Record<ProviderName, number> = { coresignal: 25, lusha: 100 };

function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

async function ensureSettings() {
  const db = getDb();
  for (const provider of providers) {
    await db.insert(providerSettings).values({ provider, monthlyCreditLimit: defaultLimits[provider] }).onConflictDoNothing();
  }
}

async function usageSnapshot() {
  const db = getDb();
  await ensureSettings();
  const [settings, usage] = await Promise.all([
    db.select().from(providerSettings),
    db.select({ provider: providerResponseHistory.provider, credits: sql<number>`coalesce(sum(${providerResponseHistory.creditsUsed}), 0)`, applicationUnits: sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}), 0)`, lushaBudgetUnits: sql<number>`coalesce(sum(case when ${providerResponseHistory.mode}='live' then case when ${providerResponseHistory.applicationUnits}>0 then ${providerResponseHistory.applicationUnits} else ${providerResponseHistory.creditsUsed} end else 0 end), 0)` })
      .from(providerResponseHistory)
      .where(sql`datetime(${providerResponseHistory.createdAt}) >= datetime(${monthStart()})`)
      .groupBy(providerResponseHistory.provider),
  ]);
  const usedByProvider = Object.fromEntries(usage.map(row => [row.provider, row.provider === "lusha" ? Number(row.lushaBudgetUnits) : row.provider === PROFESSIONAL_DATA_PROVIDER ? Number(row.applicationUnits) : Number(row.credits)]));
  return Object.fromEntries(providers.map(provider => {
    const limit = settings.find(row => row.provider === provider)?.monthlyCreditLimit ?? defaultLimits[provider];
    const used = usedByProvider[provider] ?? 0;
    return [provider, { used, limit, remaining: Math.max(0, limit - used), configured: providerConfigured(provider), mode: enrichmentMode(provider) }];
  }));
}

function lushaMonthStart() { return monthStart(); }

async function claimLushaRequest(person: typeof alumni.$inferSelect, operation: LushaGovernedOperation, actor: string) {
  const reservation = lushaApplicationReservation(operation);
  if (reservation === null) return { error: "This Lusha operation has no approved application-unit ceiling. Configure it only after account-specific entitlement and billing review." } as const;
  if (!lushaContactEntitlement(operation)) return { error: "Lusha endpoint entitlement has not been confirmed for this operation and account. No provider request was made." } as const;
  let accountBalance: Awaited<ReturnType<typeof getLushaAccountUsage>>;
  try { accountBalance = await getLushaAccountUsage(); }
  catch { return { error: "Current Lusha account balance could not be verified. No contact request was made." } as const; }
  if (!lushaBalanceCoversReservation(accountBalance.remaining, reservation)) return { error: "Lusha account balance is unavailable or below the approved per-operation ceiling. No contact request was made." } as const;
  await ensureSettings();
  const start = lushaMonthStart();
  const row = await env.DB.prepare(LUSHA_REQUEST_CLAIM_SQL).bind(
    person.id, person.name, operation, reservation, `One ${operation} request for saved alumnus #${person.id}`, actor,
    person.id, operation, start, reservation, start,
  ).first<{ id: number }>();
  if (!row) return { error: "A duplicate, unresolved Lusha charge, or application allowance blocks this request. No provider call was made." } as const;
  return { id: row.id, reservation } as const;
}

async function completeLushaRequest(claimId: number, reservation: number, status: string, credits: number | null, resultCount: number, summary: string) {
  const applicationUnits = Math.max(reservation, credits ?? 0);
  const result = await env.DB.prepare("UPDATE provider_response_history SET status=?,credits_used=?,application_units=?,provider_reported_credits=?,usage_state=?,result_count=?,response_summary=? WHERE id=? AND provider='lusha' AND status='in_progress'")
    .bind(status, credits ?? 0, applicationUnits, credits, providerUsageState(credits), resultCount, summary, claimId).run() as { meta: { changes?: number } };
  if (result.meta.changes !== 1) throw new Error("The Lusha request claim could not be finalized; manual reconciliation is required.");
}

async function markLushaAttemptUncertain(claimId: number) {
  await env.DB.prepare("UPDATE provider_response_history SET status='ambiguous',response_summary='The request outcome is uncertain; the reserved application units remain held and no retry is permitted.',error_message='Provider transport or persistence failed; Admin reconciliation required.' WHERE id=? AND provider='lusha' AND status='in_progress'").bind(claimId).run();
}

async function hasApprovedLushaIdentity(person: typeof alumni.$inferSelect) {
  if (!person.lushaPersonId.trim()) return false;
  const row = await env.DB.prepare(`SELECT proposed_changes_json AS evidence FROM provider_refresh_reviews
    WHERE alumnus_id=? AND status='Approved identity' AND json_valid(proposed_changes_json)
      AND json_extract(proposed_changes_json,'$.kind')='LUSHA_CONTACT_IDENTITY'
      AND json_extract(proposed_changes_json,'$.contactId')=?
    ORDER BY id DESC LIMIT 1`).bind(person.id, person.lushaPersonId).first<{ evidence: string }>();
  const evidence = row ? parseLushaIdentityEvidence(row.evidence) : null;
  const saved = linkedinProfileIdentifier(person.linkedinUrl);
  return Boolean(evidence && saved && saved === linkedinProfileIdentifier(evidence.requestedProfileUrl) && saved === linkedinProfileIdentifier(evidence.returnedProfileUrl));
}

async function retainLushaContactResult(input: { claimId: number; reservation: number; person: typeof alumni.$inferSelect; actor: string; channel: "email" | "phone"; value: string; status: string; credits: number | null }) {
  const exceeded = lushaReportedChargeExceedsReservation(input.credits, input.reservation);
  const pending = input.status === "success" && Boolean(input.value);
  const outcome = exceeded || pending ? "review_required" : input.status;
  const summary = `${pending ? `${input.channel === "email" ? "Email" : "Phone"} retained for Admin contact review; no canonical field changed.` : outcome === "review_required" ? "Provider identity or billing requires review; no contact value was applied." : "No contact value was returned."} ${input.credits === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${input.credits} provider credit${input.credits === 1 ? "" : "s"} reported.`}`;
  if (pending) {
    const evidence: LushaContactReviewEvidence = { kind: "LUSHA_CONTACT_FIELD", version: 1, channel: input.channel, contactId: input.person.lushaPersonId, value: input.value, previousValue: input.channel === "email" ? input.person.email : input.person.phone, alumnusRecordVersion: input.person.recordVersion };
    const [completed, reviews] = await env.DB.batch([
      env.DB.prepare(`UPDATE provider_response_history SET status=?,credits_used=?,application_units=?,provider_reported_credits=?,usage_state=?,result_count=1,response_summary=?
        WHERE id=? AND provider='lusha' AND status='in_progress' RETURNING id`)
        .bind(outcome, input.credits ?? 0, Math.max(input.reservation, input.credits ?? 0), input.credits, providerUsageState(input.credits), summary, input.claimId),
      env.DB.prepare(`INSERT INTO provider_refresh_reviews (provider_response_id,alumnus_id,proposed_changes_json,status,requested_by)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM provider_response_history WHERE id=? AND provider='lusha' AND status='review_required')
          AND NOT EXISTS (SELECT 1 FROM provider_refresh_reviews WHERE provider_response_id=?)
        RETURNING id`)
        .bind(input.claimId, input.person.id, JSON.stringify(evidence), exceeded ? "Contact exception" : "Pending contact review", input.actor, input.claimId, input.claimId),
    ]) as Array<{ results: Array<{ id: number }> }>;
    if (completed.results.length !== 1 || reviews.results.length !== 1) throw new Error("Lusha contact evidence could not be retained; manual reconciliation is required.");
    return { outcome, reviewId: reviews.results[0].id };
  }
  await completeLushaRequest(input.claimId, input.reservation, outcome, input.credits, 0, summary);
  return { outcome, reviewId: null };
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_PROVIDER_STATUS");
    const db = getDb();
    const [usage, history] = await Promise.all([
      usageSnapshot(),
      db.select().from(providerResponseHistory).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(100),
    ]);
    const lushaHistoryIds = history.filter(item => item.provider === "lusha").map(item => item.id);
    const lushaReviews = context.role === "ADMIN" && lushaHistoryIds.length
      ? await db.select().from(providerRefreshReviews).where(inArray(providerRefreshReviews.providerResponseId, lushaHistoryIds))
      : [];
    const reviewByHistory = new Map(lushaReviews.map(review => [review.providerResponseId, review]));
    const contactResume = context.role === "DEVELOPER" ? {} : Object.fromEntries(history
      .filter(item => item.provider === "lusha" && item.alumnusId && item.operation === "Contact Search Preview" && item.status === "success")
      .map(item => [item.alumnusId!, {
        emailAvailable: item.responseSummary.includes("Email availability: available.") ? true : item.responseSummary.includes("Email availability: not available.") ? false : null,
        phoneAvailable: item.responseSummary.includes("Phone availability: available.") ? true : item.responseSummary.includes("Phone availability: not available.") ? false : null,
      }]));
    return Response.json({
      modes: { coresignal: coresignalProvider.mode(), lusha: enrichmentMode("lusha") },
      usage,
      lushaReservations: { search: lushaApplicationReservation("Contact Search Preview"), email: lushaApplicationReservation("Email Reveal"), phone: lushaApplicationReservation("Phone Reveal") },
      contactResume,
      history: context.role === "ADMIN" ? history.map(presentProviderHistorySearchEvidence).map(presentProviderHistoryCollectEvidence).map(item => {
        const review = reviewByHistory.get(item.id);
        return review ? { ...item, lushaReview: { id: review.id, status: review.status, evidence: parseLushaIdentityEvidence(review.proposedChangesJson), contactEvidence: parseLushaContactReview(review.proposedChangesJson), reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt } } : item;
      }) : [],
      historyRestricted: context.role !== "ADMIN",
    });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load enrichment activity." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS");
    const payload = await request.json() as { provider?: ProviderName; monthlyCreditLimit?: number };
    if (!providers.includes(payload.provider as ProviderName) || !Number.isInteger(payload.monthlyCreditLimit) || Number(payload.monthlyCreditLimit) < 0 || Number(payload.monthlyCreditLimit) > 100000) {
      return Response.json({ error: "Choose a provider and a valid monthly credit limit." }, { status: 400 });
    }
    const db = getDb();
    const provider = payload.provider as ProviderName;
    const monthlyCreditLimit = Number(payload.monthlyCreditLimit);
    await db.insert(providerSettings).values({ provider, monthlyCreditLimit, updatedAt: new Date().toISOString() }).onConflictDoUpdate({
      target: providerSettings.provider,
      set: { monthlyCreditLimit, updatedAt: new Date().toISOString() },
    });
    await writeSecurityAudit(context, { action: "provider_limit_changed", entityType: "provider", entityId: provider, metadata: { monthlyCreditLimit } });
    return Response.json({ usage: await usageSnapshot() });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the credit limit." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; alumniIds?: number[]; alumnusId?: number; providers?: ProviderName[]; operation?: string; contactChannel?: "email" | "phone"; contactChannels?: ("email" | "phone")[]; reviewId?: number; historyId?: number; fields?: string[]; confirmed?: boolean; replaceExisting?: boolean; reconciledCredits?: number; reconciliationSource?: string };
    const requiredPermission = ["validate_lusha", "reconcile_usage", "refresh_history", "lusha_approve_identity", "lusha_reject_identity", "lusha_approve_contact", "lusha_reject_contact"].includes(payload.action ?? "") ? "MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM";
    const context = await authorizeRequest(request, requiredPermission);
    const db = getDb();
    const actor = context.displayName;

    if (payload.action === "refresh_history") {
      await writeSecurityAudit(context, { action: "provider_history_refreshed", entityType: "provider_history", metadata: { source: "administration_ui" } });
      return Response.json({ refreshed: true });
    }

    if (payload.action === "validate_lusha") {
      if (enrichmentMode("lusha") !== "live" || !providerConfigured("lusha")) return Response.json({ error: "Lusha LIVE and its server-side API key must both be configured." }, { status: 409 });
      const accountUsage = await getLushaAccountUsage();
      await writeSecurityAudit(context, { action: "lusha_connection_validated", entityType: "provider", entityId: "lusha", metadata: { endpoint: "account_usage", contactDataRequested: false } });
      return Response.json({ connected: true, accountUsage });
    }

    if (payload.action === "reconcile_usage") {
      if (!Number.isInteger(payload.historyId) || !Number.isInteger(payload.reconciledCredits) || Number(payload.reconciledCredits) < 0 || !payload.reconciliationSource?.trim()) {
        return Response.json({ error: "Choose a provider-history record, enter a whole observed account delta, and record its source." }, { status: 400 });
      }
      const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, payload.historyId!)).limit(1);
      if (!history || history.provider !== "lusha" || history.providerReportedCredits !== null || history.status === "in_progress" || !["reconciliation_required", "not_applicable"].includes(history.usageState)) {
        return Response.json({ error: "Only a Lusha operation without provider-reported usage can be reconciled." }, { status: 409 });
      }
      const reconciledCredits = Number(payload.reconciledCredits);
      const now = new Date().toISOString();
      await db.update(providerResponseHistory).set({
        creditsUsed: reconciledCredits,
        applicationUnits: Math.max(history.applicationUnits, reconciledCredits),
        reconciledCredits,
        usageState: "reconciled_account_usage",
        reconciliationSource: payload.reconciliationSource.trim().slice(0, 240),
        reconciledBy: actor,
        reconciledAt: now,
      }).where(eq(providerResponseHistory.id, history.id));
      await writeSecurityAudit(context, { action: "provider_usage_reconciled", entityType: "provider_response", entityId: history.id, metadata: { provider: "lusha", operation: history.operation, reconciledCredits, source: payload.reconciliationSource.trim().slice(0, 240) } });
      return Response.json({ reconciled: true, usage: await usageSnapshot() });
    }

    if (payload.action === "lusha_search_contact") {
      if (enrichmentMode("lusha") !== "live" || !providerConfigured("lusha")) return Response.json({ error: "Lusha LIVE is not available." }, { status: 409 });
      if (!Number.isInteger(payload.alumnusId) || payload.confirmed !== true) return Response.json({ error: "Select one approved alumnus and explicitly confirm the Lusha contact Search." }, { status: 400 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      if (usage.lusha.remaining < 1) return Response.json({ error: "The Lusha application limit has been reached. An Admin must review it before another provider request." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId!)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      if (person.intakeStatus === "PROVISIONAL") return Response.json({ error: "Provisional profiles are not eligible for contact enrichment." }, { status: 409 });
      if (person.lushaPersonId.trim()) return Response.json({ error: "A Lusha contact ID is already linked. Search will not be repeated." }, { status: 409 });
      if (!linkedinProfileIdentifier(person.linkedinUrl)) return Response.json({ error: "A saved LinkedIn profile URL is required for this one-person Lusha Search. Name/company fallback is not authorized." }, { status: 409 });
      if (payload.contactChannel === "phone") {
        const [privacy, preferences] = await Promise.all([
          db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1),
          db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id)),
        ]);
        const permission = contactEnrichmentPermission({ ...person, privacy: privacy[0] }, preferences.map(preference => preference.status));
        if (!permission.allowed) return Response.json({ error: permission.reason }, { status: 409 });
        if (!eligibleContactChannels(person, ["phone"]).includes("phone")) return Response.json({ error: "A verified phone is already stored. No contact search was made." }, { status: 409 });
      }
      const identifier = "professional profile";
      const claim = await claimLushaRequest(person, "Contact Search Preview", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof searchLushaContact>>;
      try { result = await searchLushaContact({ name: person.name, company: person.company, linkedinUrl: person.linkedinUrl }); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      const chargeExceeded = lushaReportedChargeExceedsReservation(result.creditsUsed, claim.reservation);
      const previewStatus = result.returnedCount ? "review_required" : "no_match";
      const identityReason = chargeExceeded ? "REPORTED_CHARGE_EXCEEDS_APPROVED_RESERVATION" : result.identityReason;
      const summary = `${result.returnedCount ? `Lusha returned ${result.returnedCount} contact observation${result.returnedCount === 1 ? "" : "s"}; human identity review required (${identityReason}). No canonical record or contact channel was changed. Email availability: ${result.emailAvailable === null ? "not reported" : result.emailAvailable ? "available" : "not available"}. Phone availability: ${result.phoneAvailable === null ? "not reported" : result.phoneAvailable ? "available" : "not available"}.` : "No Lusha contact match."} ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`;
      const evidence = lushaIdentityEvidence({ returnedCount: result.returnedCount, alumnusRecordVersion: person.recordVersion, contactId: result.contactId, requestedProfileUrl: normalizeProfessionalProfileUrl(person.linkedinUrl), returnedProfileUrl: result.linkedinUrl, returnedName: result.fullName, returnedCompany: result.company, returnedTitle: result.jobTitle, emailAvailable: result.emailAvailable, phoneAvailable: result.phoneAvailable, identityReason, providerStatus: chargeExceeded ? "review_required" : result.status, providerReportedCredits: result.creditsUsed });
      const [linkedElsewhere, pendingElsewhere] = result.contactId ? await Promise.all([
        db.select({ id: alumni.id }).from(alumni).where(and(eq(alumni.lushaPersonId, result.contactId), ne(alumni.id, person.id))).limit(1),
        db.select({ id: providerRefreshReviews.id }).from(providerRefreshReviews).where(and(eq(providerRefreshReviews.status, "Pending identity review"), sql`case when json_valid(${providerRefreshReviews.proposedChangesJson}) then json_extract(${providerRefreshReviews.proposedChangesJson}, '$.kind') end = 'LUSHA_CONTACT_IDENTITY'`, sql`case when json_valid(${providerRefreshReviews.proposedChangesJson}) then json_extract(${providerRefreshReviews.proposedChangesJson}, '$.contactId') end = ${result.contactId}`)).limit(1),
      ]) : [[], []];
      const approvableProposal = result.status === "success" && !chargeExceeded && !linkedElsewhere.length && !pendingElsewhere.length;
      let reviewId: number | null = null;
      try {
        const updateHistory = db.update(providerResponseHistory).set({ status: previewStatus, creditsUsed: result.creditsUsed ?? 0, applicationUnits: Math.max(claim.reservation, result.creditsUsed ?? 0), providerReportedCredits: result.creditsUsed, usageState: providerUsageState(result.creditsUsed), resultCount: result.returnedCount, responseSummary: summary }).where(and(eq(providerResponseHistory.id, claim.id), eq(providerResponseHistory.status, "in_progress"))).returning({ id: providerResponseHistory.id });
        if (result.returnedCount) {
          const insertReview = db.insert(providerRefreshReviews).values({ providerResponseId: claim.id, alumnusId: person.id, proposedChangesJson: JSON.stringify(evidence), status: approvableProposal ? "Pending identity review" : "Identity exception", requestedBy: actor }).returning({ id: providerRefreshReviews.id });
          const [completed, reviews] = await db.batch([updateHistory, insertReview]);
          if (completed.length !== 1 || reviews.length !== 1) throw new Error("The Lusha Search evidence was not durably recorded; reconcile the request before continuing.");
          reviewId = reviews[0].id;
        } else {
          const completed = await updateHistory;
          if (completed.length !== 1) throw new Error("The Lusha Search outcome was not durably recorded; reconcile the request before continuing.");
        }
      } catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      await writeSecurityAudit(context, { action: "lusha_contact_preview", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, identifier, outcome: previewStatus, identityReason, requestedFields: ["availability_preview"], providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation } });
      return authenticatedJsonResponse(context, {
        preview: {
          alumnusId: person.id, alumnusName: person.name, contactId: "", reviewId,
          fullName: result.fullName, jobTitle: result.jobTitle, company: result.company,
          professionalProfile: result.linkedinUrl, emailAvailable: result.emailAvailable,
          phoneAvailable: result.phoneAvailable, status: previewStatus, identityReason,
          creditsUsed: result.creditsUsed, usageSource: result.usageSource,
        },
        usage: await usageSnapshot(),
      });
    }

    if (payload.action === "lusha_approve_identity") {
      if (!Number.isSafeInteger(payload.reviewId) || Number(payload.reviewId) < 1 || payload.confirmed !== true) return Response.json({ error: "Choose a pending Lusha identity review and explicitly confirm the association." }, { status: 400 });
      const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, payload.reviewId!)).limit(1);
      if (!review || review.status !== "Pending identity review") return Response.json({ error: "This Lusha identity is not pending an approvable review." }, { status: 409 });
      const [[history], [person]] = await Promise.all([
        db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, review.providerResponseId)).limit(1),
        db.select().from(alumni).where(eq(alumni.id, review.alumnusId)).limit(1),
      ]);
      const evidence = parseLushaIdentityEvidence(review.proposedChangesJson);
      if (!history || !person || !evidence || history.provider !== "lusha" || history.operation !== "Contact Search Preview" || history.mode !== "live" || history.status !== "review_required" || history.resultCount !== 1 || history.alumnusId !== person.id || person.intakeStatus === "PROVISIONAL" || !lushaIdentityApprovalEligible(evidence, person.linkedinUrl, person.lushaPersonId, person.recordVersion)) {
        return Response.json({ error: "Stored provider identity and the current alumnus profile do not support this association." }, { status: 409 });
      }
      const otherProfiles = await db.select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(ne(alumni.id, person.id));
      const profileId = linkedinProfileIdentifier(person.linkedinUrl);
      if (otherProfiles.some(other => linkedinProfileIdentifier(other.linkedinUrl) === profileId)) return Response.json({ error: "The professional profile is shared by another alumnus; resolve identity ambiguity before association." }, { status: 409 });
      const now = new Date().toISOString();
      const mutationKey = `lusha-identity-review:${review.id}`;
      const [attached, reviewed, completed, change] = await env.DB.batch([
        env.DB.prepare(LUSHA_REVIEWED_ATTACH_ID_SQL).bind(evidence.contactId, actor, now, mutationKey, person.id, person.linkedinUrl, person.recordVersion, review.id, evidence.contactId, evidence.requestedProfileUrl, evidence.returnedProfileUrl, history.id, evidence.contactId, evidence.contactId),
        env.DB.prepare(LUSHA_APPROVE_REVIEW_SQL).bind(actor, now, review.id, person.id, evidence.contactId, mutationKey),
        env.DB.prepare(LUSHA_COMPLETE_REVIEWED_HISTORY_SQL).bind(history.id, review.id),
        env.DB.prepare(LUSHA_RECORD_IDENTITY_CHANGE_SQL).bind(person.id, evidence.contactId, actor, mutationKey, review.id),
      ]);
      if (([attached, reviewed, completed, change] as Array<{ results: unknown[] }>).some(result => result.results.length !== 1)) return Response.json({ error: "The identity review could not be applied uniquely; inspect the retained evidence before retrying." }, { status: 409 });
      await writeSecurityAudit(context, { action: "lusha_identity_association_approved", entityType: "alumnus", entityId: person.id, metadata: { reviewId: review.id, providerHistoryId: history.id, identityReason: evidence.identityReason, contactFieldsRevealed: 0, providerRequests: 0 } });
      return Response.json({ approved: true, reviewId: review.id, alumnusId: person.id });
    }

    if (payload.action === "lusha_reject_identity") {
      if (!Number.isSafeInteger(payload.reviewId) || Number(payload.reviewId) < 1 || payload.confirmed !== true) return Response.json({ error: "Choose a Lusha identity review and explicitly confirm rejection." }, { status: 400 });
      const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, payload.reviewId!)).limit(1);
      if (!review || !["Pending identity review", "Identity exception"].includes(review.status) || !parseLushaIdentityEvidence(review.proposedChangesJson)) return Response.json({ error: "This Lusha identity review cannot be rejected again." }, { status: 409 });
      const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, review.providerResponseId)).limit(1);
      if (!history || history.provider !== "lusha" || history.operation !== "Contact Search Preview" || history.alumnusId !== review.alumnusId) return Response.json({ error: "The retained Lusha provider request does not match this review." }, { status: 409 });
      const now = new Date().toISOString();
      const rejected = await env.DB.prepare(LUSHA_REJECT_REVIEW_SQL).bind(actor, now, review.id).first<{ id: number }>();
      if (!rejected) return Response.json({ error: "The review decision changed concurrently; reload before deciding." }, { status: 409 });
      await writeSecurityAudit(context, { action: "lusha_identity_association_rejected", entityType: "alumnus", entityId: review.alumnusId, metadata: { reviewId: review.id, providerHistoryId: history.id, providerRequests: 0, canonicalMutations: 0 } });
      return Response.json({ rejected: true, reviewId: review.id });
    }

    if (payload.action === "lusha_approve_contact" || payload.action === "lusha_reject_contact") {
      if (!Number.isSafeInteger(payload.reviewId) || Number(payload.reviewId) < 1 || payload.confirmed !== true) return Response.json({ error: "Choose a pending contact review and explicitly confirm this decision." }, { status: 400 });
      const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, payload.reviewId!)).limit(1);
      const evidence = review ? parseLushaContactReview(review.proposedChangesJson) : null;
      if (!review || !evidence || !(payload.action === "lusha_reject_contact" ? ["Pending contact review", "Contact exception"].includes(review.status) : review.status === "Pending contact review")) return Response.json({ error: "This Lusha contact evidence is not pending an eligible review." }, { status: 409 });
      const [history] = await db.select().from(providerResponseHistory).where(eq(providerResponseHistory.id, review.providerResponseId)).limit(1);
      if (!history || history.provider !== "lusha" || history.mode !== "live" || history.alumnusId !== review.alumnusId || history.operation !== (evidence.channel === "email" ? "Email Reveal" : "Phone Reveal") || history.status !== "review_required") return Response.json({ error: "The retained provider request does not match this contact review." }, { status: 409 });
      const now = new Date().toISOString();
      if (payload.action === "lusha_reject_contact") {
        const rejected = await env.DB.prepare(LUSHA_REJECT_CONTACT_REVIEW_SQL).bind(actor, now, review.id).first<{ id: number }>();
        if (!rejected) return Response.json({ error: "The review changed concurrently; reload before deciding." }, { status: 409 });
        await writeSecurityAudit(context, { action: "lusha_contact_evidence_rejected", entityType: "alumnus", entityId: review.alumnusId, metadata: { reviewId: review.id, providerHistoryId: history.id, channel: evidence.channel, canonicalMutations: 0 } });
        return Response.json({ rejected: true, reviewId: review.id });
      }
      if (history.usageState === "reconciliation_required" || history.providerReportedCredits !== null && history.providerReportedCredits > history.applicationUnits) return Response.json({ error: "Provider usage must be reconciled within the approved ceiling before contact approval." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, review.alumnusId)).limit(1);
      if (!person || person.intakeStatus === "PROVISIONAL" || person.lushaPersonId !== evidence.contactId || person.recordVersion !== evidence.alumnusRecordVersion || (evidence.channel === "email" ? person.email : person.phone) !== evidence.previousValue || (evidence.channel === "email" ? person.emailVerification : person.phoneVerification) === "Verified") return Response.json({ error: "The alumni identity or contact field changed since the provider observation; review again before applying." }, { status: 409 });
      if (!lushaContactValueValid(evidence.channel, evidence.value)) return Response.json({ error: "The retained provider contact value is not valid for canonical use." }, { status: 409 });
      if (evidence.previousValue && evidence.previousValue !== evidence.value && payload.replaceExisting !== true) return Response.json({ error: "Replacing an existing contact value requires separate explicit confirmation." }, { status: 409 });
      const [privacy, preferences] = await Promise.all([
        db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1),
        db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id)),
      ]);
      const permission = contactEnrichmentPermission({ ...person, privacy: privacy[0] }, preferences.map(preference => preference.status));
      if (!permission.allowed) return Response.json({ error: permission.reason }, { status: 409 });
      const [other] = await db.select({ id: alumni.id }).from(alumni).where(and(eq(evidence.channel === "email" ? alumni.email : alumni.phone, evidence.value), ne(alumni.id, person.id))).limit(1);
      if (other) return Response.json({ error: "This contact value is already associated with another alumnus; resolve the identity conflict before approval." }, { status: 409 });
      const mutationKey = `lusha-contact-review:${review.id}`;
      const [updated, reviewed, changed] = await env.DB.batch([
        env.DB.prepare(lushaContactApprovalSql(evidence.channel)).bind(evidence.value, now, now, actor, now, mutationKey, person.id, evidence.contactId, evidence.alumnusRecordVersion, evidence.previousValue, evidence.value, review.id, evidence.value),
        env.DB.prepare(LUSHA_APPROVE_CONTACT_REVIEW_SQL).bind(actor, now, review.id, person.id, mutationKey),
        env.DB.prepare(`INSERT INTO field_change_history (alumnus_id,field,old_value,new_value,source,provider_action,credits_charged,initiated_by,mutation_request_key)
          SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM provider_refresh_reviews WHERE id=? AND status='Applied')
            AND NOT EXISTS (SELECT 1 FROM field_change_history WHERE mutation_request_key=?) RETURNING id`)
          .bind(person.id, evidence.channel, evidence.previousValue, evidence.value, "Lusha", evidence.channel === "email" ? "Email Reveal review" : "Phone Reveal review", history.providerReportedCredits ?? history.reconciledCredits ?? 0, actor, mutationKey, review.id, mutationKey),
      ]);
      if (([updated, reviewed, changed] as Array<{ results: unknown[] }>).some(result => result.results.length !== 1)) return Response.json({ error: "The contact review could not be applied uniquely; inspect the retained evidence." }, { status: 409 });
      await writeSecurityAudit(context, { action: "lusha_contact_evidence_approved", entityType: "alumnus", entityId: person.id, metadata: { reviewId: review.id, providerHistoryId: history.id, channel: evidence.channel, providerRequests: 0 } });
      return Response.json({ approved: true, reviewId: review.id, alumnusId: person.id });
    }

    if (payload.action === "lusha_reveal_email") {
      if (enrichmentMode("lusha") !== "live" || !providerConfigured("lusha")) return Response.json({ error: "Lusha LIVE is not available." }, { status: 409 });
      if (!Number.isInteger(payload.alumnusId) || payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before a Lusha email reveal." }, { status: 400 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      if (usage.lusha.remaining < 1) return Response.json({ error: "The Lusha application limit has been reached. An Admin must review it before another provider request." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId!)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      if (person.intakeStatus === "PROVISIONAL") return Response.json({ error: "Provisional profiles are not eligible for contact enrichment." }, { status: 409 });
      const [privacy, preferences] = await Promise.all([
        db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1),
        db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id)),
      ]);
      const permission = contactEnrichmentPermission({ ...person, privacy: privacy[0] }, preferences.map(preference => preference.status));
      if (!permission.allowed) return Response.json({ error: permission.reason }, { status: 409 });
      if (!eligibleContactChannels(person, ["email"]).includes("email")) return Response.json({ error: "A verified email is already stored. No repeat provider call was made." }, { status: 409 });
      if (!await hasApprovedLushaIdentity(person)) return Response.json({ error: "Admin-approved Lusha identity evidence matching the saved LinkedIn profile is required before Email Reveal." }, { status: 409 });
      const claim = await claimLushaRequest(person, "Email Reveal", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof revealLushaEmail>>;
      try { result = await revealLushaEmail(person.lushaPersonId); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      const retained = await retainLushaContactResult({ claimId: claim.id, reservation: claim.reservation, person, actor, channel: "email", value: result.email, status: result.status, credits: result.creditsUsed });
      await writeSecurityAudit(context, { action: "lusha_email_reveal", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, reviewId: retained.reviewId, requestedFields: ["email"], outcome: retained.outcome, providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation, canonicalMutations: 0 } });
      return authenticatedJsonResponse(context, { result: { status: retained.outcome, reviewId: retained.reviewId, creditsUsed: result.creditsUsed, usageSource: result.usageSource }, usage: await usageSnapshot() });
    }

    if (payload.action === "lusha_reveal_phone") {
      if (enrichmentMode("lusha") !== "live" || !providerConfigured("lusha")) return Response.json({ error: "Lusha LIVE is not available." }, { status: 409 });
      if (!Number.isInteger(payload.alumnusId) || payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before a Lusha phone reveal." }, { status: 400 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      if (usage.lusha.remaining < 1) return Response.json({ error: "The Lusha application limit has been reached. An Admin must review it before another provider request." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId!)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      if (person.intakeStatus === "PROVISIONAL") return Response.json({ error: "Provisional profiles are not eligible for contact enrichment." }, { status: 409 });
      const [privacy, preferences] = await Promise.all([
        db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1),
        db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id)),
      ]);
      const permission = contactEnrichmentPermission({ ...person, privacy: privacy[0] }, preferences.map(preference => preference.status));
      if (!permission.allowed) return Response.json({ error: permission.reason }, { status: 409 });
      if (!eligibleContactChannels(person, ["phone"]).includes("phone")) return Response.json({ error: "A verified phone is already stored. No repeat provider call was made." }, { status: 409 });
      if (!await hasApprovedLushaIdentity(person)) return Response.json({ error: "Admin-approved Lusha identity evidence matching the saved LinkedIn profile is required before Phone Reveal." }, { status: 409 });
      const claim = await claimLushaRequest(person, "Phone Reveal", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof revealLushaPhone>>;
      try { result = await revealLushaPhone(person.lushaPersonId); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      const retained = await retainLushaContactResult({ claimId: claim.id, reservation: claim.reservation, person, actor, channel: "phone", value: result.phone, status: result.status, credits: result.creditsUsed });
      await writeSecurityAudit(context, { action: "lusha_phone_reveal", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, reviewId: retained.reviewId, requestedFields: ["phone"], outcome: retained.outcome, providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation, canonicalMutations: 0 } });
      return authenticatedJsonResponse(context, { result: { status: retained.outcome, reviewId: retained.reviewId, creditsUsed: result.creditsUsed, usageSource: result.usageSource }, usage: await usageSnapshot() });
    }

    if (payload.action === "apply_refresh" && Number.isInteger(payload.reviewId)) {
      const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, payload.reviewId!)).limit(1);
      if (!review || review.status !== "Pending review") return Response.json({ error: "This profile refresh is no longer pending review." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, review.alumnusId)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      const proposed = JSON.parse(review.proposedChangesJson) as Array<{ field: string; oldValue: string; newValue: string }>;
      const allowedFields = new Set(["company", "title", "rawTitle", "function", "seniority", "location", "previous", "linkedinUrl", "coresignalEmployeeId", "graduationYear", "iimlAffiliationStatus", "iimlEducationProgramme", "iimlEducationStartDate", "iimlEducationEndDate", "iimlInstitutionId", "iimlInstitutionUrl", "currentCompanyId", "currentCompanyUrl", "currentRoleStartDate", "currentIndustry", "currentRoleAmbiguous", "providerFreshnessAt"]);
      const requested = new Set((payload.fields ?? []).filter(field => allowedFields.has(field)));
      const updates: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: new Date().toISOString() };
      const applied: string[] = [];
      const identityChange = proposed.find(change => change.field === "coresignalEmployeeId" && requested.has(change.field) && change.newValue && change.oldValue !== change.newValue);
      if (identityChange) {
        const proposedProfile = proposed.find(change => change.field === "linkedinUrl")?.newValue || person.linkedinUrl;
        const identity = await attachCoresignalIdentity({ coresignalEmployeeId: identityChange.newValue, profileUrl: proposedProfile, expectedAlumnusId: person.id, source: `profile_refresh_review:${review.id}`, actor }, coresignalIdentityStore(db, context));
        if (["CONFLICT", "IDENTITY_REVIEW_REQUIRED", "NEW_CANDIDATE"].includes(identity.outcome)) return Response.json({ error: identity.rationale, identityOutcome: identity.outcome }, { status: 409 });
        if (identity.wroteIdentity) applied.push("coresignalEmployeeId");
      }
      for (const change of proposed) {
        if (change.field === "coresignalEmployeeId" || !requested.has(change.field) || !change.newValue || change.oldValue === change.newValue) continue;
        const typedValue = change.field === "currentRoleAmbiguous" ? change.newValue === "true" : change.field === "graduationYear" ? Number(change.newValue) : change.newValue;
        (updates as Record<string, unknown>)[change.field] = typedValue;
        applied.push(change.field);
        await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field: change.field, oldValue: change.oldValue, newValue: change.newValue, source: PROFESSIONAL_DATA_PROVIDER_LABEL, providerAction: "Profile Refresh", creditsCharged: 0, initiatedBy: actor });
      }
      await db.update(alumni).set(updates).where(eq(alumni.id, person.id));
      const now = new Date().toISOString();
      await db.update(providerRefreshReviews).set({ status: applied.length ? "Applied" : "Reviewed — kept existing", reviewedBy: actor, reviewedAt: now }).where(eq(providerRefreshReviews.id, review.id));
      await writeSecurityAudit(context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { appliedFields: applied } });
      return Response.json({ applied, alumnusId: person.id });
    }

    const alumniIds = [...new Set(payload.alumniIds?.filter(Number.isInteger) ?? [])];
    const requestedProviders = [...new Set(payload.providers?.filter(provider => providers.includes(provider)) ?? [])];
    if (payload.action === "refresh_profiles") {
      if (!alumniIds.length || alumniIds.length > 25) return Response.json({ error: "Select 1 to 25 approved alumni." }, { status: 400 });
      if (coresignalProvider.mode() === "live" && alumniIds.length > coresignalLiveRefreshMaximum()) {
        return Response.json({ error: "The controlled live Coresignal pilot permits exactly one profile refresh at a time." }, { status: 400 });
      }
      const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
      if (people.some(person => person.intakeStatus === "PROVISIONAL")) return Response.json({ error: "Provisional profiles cannot enter the professional refresh workflow." }, { status: 409 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      const results = [];
      const labels: Record<string, string> = { company: "Current company", title: "Role", rawTitle: "Raw role", function: "Function", seniority: "Seniority", location: "Location", linkedinUrl: "Professional profile", coresignalEmployeeId: "Coresignal employee ID", graduationYear: "IIML education end year", iimlAffiliationStatus: "IIML affiliation qualification", iimlEducationProgramme: "IIML programme", iimlEducationStartDate: "IIML education start", iimlEducationEndDate: "IIML education end", iimlInstitutionId: "Institution ID", iimlInstitutionUrl: "Institution URL", currentCompanyId: "Company ID", currentCompanyUrl: "Company URL", currentRoleStartDate: "Role start date", currentIndustry: "Industry", currentRoleAmbiguous: "Current-role ambiguity", providerFreshnessAt: "Provider freshness" };
      for (const person of people) {
        if (usage.coresignal.remaining < 1) {
          await db.insert(providerResponseHistory).values({ provider: PROFESSIONAL_DATA_PROVIDER, alumnusId: person.id, alumnusName: person.name, operation: "Professional profile collect", mode: coresignalProvider.mode(), status: "blocked", creditsUsed: 0, applicationUnits: 0, providerReportedCredits: null, usageState: "not_applicable", requestSummary: `${person.name} at ${person.company}`, responseSummary: "Monthly application operation limit reached.", requestedBy: actor });
          results.push({ alumnusId: person.id, alumnusName: person.name, status: "blocked", creditsUsed: null, responseSummary: "Coresignal application limit reached.", fields: [] });
          continue;
        }
        let result: ProfessionalRefreshResult;
        try {
          result = await coresignalProvider.refreshProfile(person);
        } catch (error) {
          const failure = safeCoresignalError(error);
          result = { status: "error", changes: {}, responseSummary: failure.message, errorMessage: failure.message, usage: { applicationUnits: failure.successfulOperationCredits, providerReportedUsage: null, usageState: failure.successfulOperationCredits ? "reconciliation_required" : "not_applicable" } };
        }
        const [history] = await db.insert(providerResponseHistory).values({
          provider: PROFESSIONAL_DATA_PROVIDER, alumnusId: person.id, alumnusName: person.name, operation: "Professional profile collect", mode: coresignalProvider.mode(), status: result.status,
          creditsUsed: result.usage.providerReportedUsage ?? 0, applicationUnits: result.usage.applicationUnits, providerReportedCredits: result.usage.providerReportedUsage, usageState: result.usage.usageState, resultCount: result.status === "success" ? 1 : 0, requestSummary: `${person.name} at ${person.company}`,
          responseSummary: result.responseSummary, errorMessage: result.errorMessage ?? "", requestedBy: actor,
        }).returning();
        usage.coresignal.used += result.usage.applicationUnits;
        usage.coresignal.remaining = Math.max(0, usage.coresignal.limit - usage.coresignal.used);
        const fields = Object.entries(result.changes)
          .filter(([field]) => field in labels)
          .map(([field, value]) => ({ field, label: labels[field], oldValue: String(person[field as keyof typeof person] ?? ""), newValue: String(value ?? "") }));
        const changed = fields.filter(field => field.newValue && field.oldValue !== field.newValue);
        const reviewStatus = result.status === "no_match" ? "No match" : result.status === "error" ? "Provider error" : changed.length ? "Pending review" : "No changes";
        const [review] = await db.insert(providerRefreshReviews).values({ providerResponseId: history.id, alumnusId: person.id, proposedChangesJson: JSON.stringify(changed), status: reviewStatus, requestedBy: actor }).returning();
        if (result.status === "success") {
          const now = new Date().toISOString();
          await db.update(alumni).set({
            lastProfessionalDataRefresh: now,
            professionalDataProvider: PROFESSIONAL_DATA_PROVIDER_LABEL,
            verified: `Profile checked via Coresignal · ${now.slice(0, 10)}`,
            updatedBy: actor,
            updatedAt: now,
          }).where(eq(alumni.id, person.id));
        }
        results.push({ alumnusId: person.id, alumnusName: person.name, status: result.status, reviewStatus, reviewId: review.id, creditsUsed: result.usage.providerReportedUsage, applicationUnits: result.usage.applicationUnits, responseSummary: result.responseSummary, fields });
      }
      await writeSecurityAudit(context, { action: "coresignal_profile_refresh", entityType: "alumni_batch", metadata: { requested: alumniIds.length, processed: people.length, mode: coresignalProvider.mode() } });
      return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
    }

    if (!alumniIds.length || alumniIds.length > 25 || !requestedProviders.length) {
      return Response.json({ error: "Select 1 to 25 alumni and at least one provider." }, { status: 400 });
    }
    if (requestedProviders.includes("coresignal")) return Response.json({ error: "Use Refresh Profiles for Coresignal professional data checks." }, { status: 400 });
    if (requestedProviders.includes("lusha") && enrichmentMode("lusha") === "live") return Response.json({ error: "Use the controlled single-alumnus Lusha contact preview and channel-specific confirmation workflow in LIVE mode." }, { status: 409 });
    const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
    if (people.some(person => person.intakeStatus === "PROVISIONAL")) return Response.json({ error: "Provisional profiles are not eligible for contact enrichment." }, { status: 409 });
    const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
    const results = [];
    for (const person of people) {
      for (const provider of requestedProviders) {
        const requestedChannels = (payload.contactChannels?.filter(channel => channel === "email" || channel === "phone") ?? ["email", "phone"]) as ContactChannel[];
        const channels = eligibleContactChannels(person, requestedChannels);
        const skippedVerifiedChannels = requestedChannels.filter(channel => !channels.includes(channel));
        if (!channels.length) {
          results.push({ provider, status: "skipped", creditsUsed: 0, alumnusId: person.id, alumnusName: person.name, appliedChannels: [], skippedVerifiedChannels, responseSummary: "Existing verified contact channels preserved; no provider call was made." });
          continue;
        }
        const estimated = (channels.includes("email") ? 1 : 0) + (channels.includes("phone") ? 5 : 0);
        if (usage[provider].remaining < estimated) {
          const blocked = { provider, status: "blocked", creditsUsed: 0, alumnusId: person.id, alumnusName: person.name, appliedChannels: [], skippedVerifiedChannels, blockedReason: "Insufficient application capacity", responseSummary: "Monthly application usage limit reached." };
          results.push(blocked);
          const blockedOperation = channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment";
          await db.insert(providerResponseHistory).values({ provider, alumnusId: person.id, alumnusName: person.name, operation: blockedOperation, mode: enrichmentMode(provider), status: "blocked", creditsUsed: 0, requestSummary: `${person.name} at ${person.company}`, responseSummary: blocked.responseSummary, requestedBy: actor });
          continue;
        }
        const result = await enrich(provider, { id: person.id, name: person.name, company: person.company, title: person.title, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl, contactChannels: channels });
        const safeChanges: Partial<typeof alumni.$inferInsert> = {};
        const appliedChannels: ContactChannel[] = [];
        const conflicts: ContactChannel[] = [];
        if (result.status === "success" && Object.keys(result.changes).length) {
          for (const field of channels) {
            const newValue = String(result.changes[field] ?? "");
            const oldValue = person[field];
            if (!newValue || newValue === oldValue) continue;
            if (oldValue) { conflicts.push(field); continue; }
            safeChanges[field] = newValue;
            if (field === "email") {
              safeChanges.emailVerification = String(result.changes.emailVerification ?? "Unverified");
              safeChanges.emailSource = "Lusha";
              safeChanges.emailRetrievedAt = String(result.changes.emailRetrievedAt ?? new Date().toISOString());
            } else {
              safeChanges.phoneVerification = String(result.changes.phoneVerification ?? "Unverified");
              safeChanges.phoneSource = "Lusha";
              safeChanges.phoneRetrievedAt = String(result.changes.phoneRetrievedAt ?? new Date().toISOString());
            }
            appliedChannels.push(field);
            await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field, oldValue, newValue, source: "Lusha", providerAction: channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment", creditsCharged: field === "phone" ? 5 : 1, initiatedBy: actor });
          }
          if (conflicts.length) {
            safeChanges.professionalDataStatus = "Conflict — manual verification required";
            safeChanges.professionalDataNote = `Lusha returned a different existing ${conflicts.join(" and ")} value. Existing contact data was preserved for manual review.`;
          }
          if (Object.keys(safeChanges).length) await db.update(alumni).set({ ...safeChanges, updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(alumni.id, person.id));
        }
        usage[provider].used += result.creditsUsed;
        usage[provider].remaining = Math.max(0, usage[provider].limit - usage[provider].used);
        await db.insert(providerResponseHistory).values({
          provider,
          alumnusId: person.id,
          alumnusName: person.name,
          operation: channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment",
          mode: enrichmentMode(provider),
          status: result.status,
          creditsUsed: result.creditsUsed,
          resultCount: result.status === "success" ? 1 : 0,
          requestSummary: `${person.name} at ${person.company}`,
          responseSummary: conflicts.length ? `${result.responseSummary} Existing ${conflicts.join(" and ")} value differed and was preserved for review.` : result.responseSummary,
          errorMessage: result.errorMessage ?? "",
          requestedBy: actor,
        });
        results.push({ ...result, alumnusId: person.id, alumnusName: person.name, appliedChannels, skippedVerifiedChannels, conflicts });
      }
    }
    await writeSecurityAudit(context, { action: "lusha_contact_enrichment", entityType: "alumni_batch", metadata: { requested: alumniIds.length, processed: people.length, channels: payload.contactChannels ?? ["email", "phone"], mode: enrichmentMode("lusha") } });
    return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run enrichment." }, { status: 500 });
  }
}
