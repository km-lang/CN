import { env } from "cloudflare:workers";
import { desc, eq, inArray, sql } from "drizzle-orm";
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
import { LUSHA_ATTACH_ID_SQL, LUSHA_REQUEST_CLAIM_SQL, lushaApplicationReservation, lushaBalanceCoversReservation, lushaContactEntitlement, lushaReportedChargeExceedsReservation, type LushaGovernedOperation } from "@/lib/lusha-request-guard";

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

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_PROVIDER_STATUS");
    const db = getDb();
    const [usage, history] = await Promise.all([
      usageSnapshot(),
      db.select().from(providerResponseHistory).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(100),
    ]);
    const contactResume = context.role === "DEVELOPER" ? {} : Object.fromEntries(history
      .filter(item => item.provider === "lusha" && item.alumnusId && item.operation === "Contact Search Preview" && item.status === "success")
      .map(item => [item.alumnusId!, {
        emailAvailable: item.responseSummary.includes("Email availability: available.") ? true : item.responseSummary.includes("Email availability: not available.") ? false : null,
        phoneAvailable: item.responseSummary.includes("Phone availability: available.") ? true : item.responseSummary.includes("Phone availability: not available.") ? false : null,
      }]));
    return Response.json({
      modes: { coresignal: coresignalProvider.mode(), lusha: enrichmentMode("lusha") },
      usage,
      contactResume,
      history: context.role === "ADMIN" ? history.map(presentProviderHistorySearchEvidence).map(presentProviderHistoryCollectEvidence) : [],
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
    const payload = await request.json() as { action?: string; alumniIds?: number[]; alumnusId?: number; providers?: ProviderName[]; operation?: string; contactChannel?: "email" | "phone"; contactChannels?: ("email" | "phone")[]; reviewId?: number; historyId?: number; fields?: string[]; confirmed?: boolean; reconciledCredits?: number; reconciliationSource?: string };
    const requiredPermission = payload.action === "validate_lusha" ? "MANAGE_PROVIDER_SETTINGS" : payload.action === "reconcile_usage" ? "MANAGE_PROVIDER_SETTINGS" : payload.action === "refresh_history" ? "MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM";
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
      if (payload.contactChannel === "phone") {
        const [privacy, preferences] = await Promise.all([
          db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1),
          db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id)),
        ]);
        const permission = contactEnrichmentPermission({ ...person, privacy: privacy[0] }, preferences.map(preference => preference.status));
        if (!permission.allowed) return Response.json({ error: permission.reason }, { status: 409 });
        if (!eligibleContactChannels(person, ["phone"]).includes("phone")) return Response.json({ error: "A verified phone is already stored. No contact search was made." }, { status: 409 });
      }
      const identifier = person.linkedinUrl ? "professional profile" : "name and current company";
      const claim = await claimLushaRequest(person, "Contact Search Preview", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof searchLushaContact>>;
      try { result = await searchLushaContact({ name: person.name, company: person.company, linkedinUrl: person.linkedinUrl }); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      let previewStatus: typeof result.status = lushaReportedChargeExceedsReservation(result.creditsUsed, claim.reservation) ? "review_required" : result.status;
      let identityReason: string = previewStatus === "review_required" && result.status !== "review_required" ? "REPORTED_CHARGE_EXCEEDS_APPROVED_RESERVATION" : result.identityReason;
      const summary = previewStatus === "success"
        ? `Stable Lusha contact ID found. Email availability: ${result.emailAvailable === null ? "not reported" : result.emailAvailable ? "available" : "not available"}. Phone availability: ${result.phoneAvailable === null ? "not reported" : result.phoneAvailable ? "available" : "not available"}. ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`
        : `${previewStatus === "review_required" ? `Lusha returned a contact, but identity or billing requires review (${identityReason}); no contact ID was attached.` : "No Lusha contact match."} ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`;
      await completeLushaRequest(claim.id, claim.reservation, previewStatus, result.creditsUsed, result.contactId ? 1 : 0, summary);
      if (previewStatus === "success" && result.contactId) {
        const companyConflict = Boolean(result.company && person.company && result.company.toLowerCase() !== person.company.toLowerCase());
        const roleConflict = Boolean(result.jobTitle && person.title && result.jobTitle.toLowerCase() !== person.title.toLowerCase());
        const now = new Date().toISOString();
        const attached = await env.DB.prepare(LUSHA_ATTACH_ID_SQL).bind(result.contactId, actor, now, person.id, result.contactId, person.id, result.contactId).first<{ id: number }>();
        if (!attached) {
          previewStatus = "review_required";
          identityReason = "CONTACT_ID_ALREADY_LINKED_OR_CONFLICTING";
          await env.DB.prepare("UPDATE provider_response_history SET status='review_required',response_summary='Lusha returned a contact, but its ID could not be attached uniquely; manual identity review required.' WHERE id=? AND provider='lusha'").bind(claim.id).run();
        } else if (companyConflict || roleConflict) await db.update(alumni).set({
            professionalDataStatus: "Conflict — manual verification required",
            professionalDataNote: `Internal professional profile: ${person.title} at ${person.company}. Lusha preview: ${result.jobTitle || "role not reported"} at ${result.company || "company not reported"}. No profile field was overwritten.`,
        }).where(eq(alumni.id, person.id));
      }
      await writeSecurityAudit(context, { action: "lusha_contact_preview", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, identifier, outcome: previewStatus, identityReason, requestedFields: ["availability_preview"], providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation } });
      return authenticatedJsonResponse(context, {
        preview: {
          alumnusId: person.id, alumnusName: person.name, contactId: result.contactId,
          fullName: result.fullName, jobTitle: result.jobTitle, company: result.company,
          professionalProfile: result.linkedinUrl, emailAvailable: result.emailAvailable,
          phoneAvailable: result.phoneAvailable, status: previewStatus, identityReason,
          creditsUsed: result.creditsUsed, usageSource: result.usageSource,
        },
        usage: await usageSnapshot(),
      });
    }

    if (payload.action === "lusha_reveal_email") {
      if (enrichmentMode("lusha") !== "live" || !providerConfigured("lusha")) return Response.json({ error: "Lusha LIVE is not available." }, { status: 409 });
      if (!Number.isInteger(payload.alumnusId) || payload.confirmed !== true) return Response.json({ error: "Explicit confirmation is required before a Lusha email reveal." }, { status: 400 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      if (usage.lusha.remaining < 1) return Response.json({ error: "The Lusha application limit has been reached. An Admin must review it before another provider request." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId!)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      if (person.intakeStatus === "PROVISIONAL") return Response.json({ error: "Provisional profiles are not eligible for contact enrichment." }, { status: 409 });
      if (!person.lushaPersonId) return Response.json({ error: "Run the Lusha contact preview first so a stable contact ID can be confirmed." }, { status: 409 });
      const claim = await claimLushaRequest(person, "Email Reveal", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof revealLushaEmail>>;
      try { result = await revealLushaEmail(person.lushaPersonId); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      const outcome = lushaReportedChargeExceedsReservation(result.creditsUsed, claim.reservation) ? "review_required" : result.status;
      const recordedCredits = result.creditsUsed ?? 0;
      await completeLushaRequest(claim.id, claim.reservation, outcome, result.creditsUsed, outcome === "success" ? 1 : 0,
        `${outcome === "review_required" ? "Returned identity or reported debit requires review; no canonical email change." : outcome === "success" ? "Email returned by Lusha." : "No email was returned."} ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`);
      if (outcome === "success" && result.email) {
        const now = new Date().toISOString();
        if (result.email !== person.email) await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field: "email", oldValue: person.email, newValue: result.email, source: "Lusha", providerAction: "Email Reveal", creditsCharged: recordedCredits, initiatedBy: actor });
        await db.update(alumni).set({ email: result.email, emailVerification: "Unverified", emailSource: "Lusha", emailRetrievedAt: now, lastLushaEnrichment: now, updatedBy: actor, updatedAt: now }).where(eq(alumni.id, person.id));
      }
      await writeSecurityAudit(context, { action: "lusha_email_reveal", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, requestedFields: ["email"], outcome, providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation } });
      return authenticatedJsonResponse(context, { result: { status: outcome, creditsUsed: result.creditsUsed, usageSource: result.usageSource }, usage: await usageSnapshot() });
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
      if (!person.lushaPersonId.trim()) return Response.json({ error: "Run the Lusha contact preview first so a stable contact ID can be confirmed." }, { status: 409 });
      const claim = await claimLushaRequest(person, "Phone Reveal", actor);
      if ("error" in claim) return Response.json({ error: claim.error }, { status: 409 });
      let result: Awaited<ReturnType<typeof revealLushaPhone>>;
      try { result = await revealLushaPhone(person.lushaPersonId); }
      catch (error) { await markLushaAttemptUncertain(claim.id); throw error; }
      const outcome = lushaReportedChargeExceedsReservation(result.creditsUsed, claim.reservation) ? "review_required" : result.status;
      const recordedCredits = result.creditsUsed ?? 0;
      await completeLushaRequest(claim.id, claim.reservation, outcome, result.creditsUsed, outcome === "success" ? 1 : 0,
        `${outcome === "review_required" ? "Returned identity or reported debit requires review; no canonical phone change." : outcome === "success" ? "Phone returned by Lusha." : "No phone was returned."} ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`);
      if (outcome === "success" && result.phone) {
        const now = new Date().toISOString();
        if (result.phone !== person.phone) await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field: "phone", oldValue: person.phone, newValue: result.phone, source: "Lusha", providerAction: "Phone Reveal", creditsCharged: recordedCredits, initiatedBy: actor });
        await db.update(alumni).set({ phone: result.phone, phoneVerification: "Unverified", phoneSource: "Lusha", phoneRetrievedAt: now, lastLushaEnrichment: now, updatedBy: actor, updatedAt: now }).where(eq(alumni.id, person.id));
      }
      await writeSecurityAudit(context, { action: "lusha_phone_reveal", entityType: "alumnus", entityId: person.id, metadata: { claimId: claim.id, requestedFields: ["phone"], outcome, providerReportedCredits: result.creditsUsed, applicationUnitsReserved: claim.reservation } });
      return authenticatedJsonResponse(context, { result: { status: outcome, creditsUsed: result.creditsUsed, usageSource: result.usageSource }, usage: await usageSnapshot() });
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
