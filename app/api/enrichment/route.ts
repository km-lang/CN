import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { alumni, fieldChangeHistory, providerRefreshReviews, providerResponseHistory, providerSettings } from "@/db/schema";
import { enrich, enrichmentMode, providerConfigured, type ProviderName } from "@/lib/enrichment-providers";
import { getLushaAccountUsage, revealLushaEmail, searchLushaContact } from "@/lib/lusha-client";
import { pdlLiveRefreshMaximum } from "@/lib/provider-runtime";
import { providerUsageState } from "@/lib/provider-usage";
import { eligibleContactChannels, type ContactChannel } from "@/lib/contact-enrichment";
import { accessErrorResponse, authenticatedJsonResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security";

const providers: ProviderName[] = ["pdl", "lusha"];
const defaultLimits: Record<ProviderName, number> = { pdl: 100, lusha: 100 };

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
    db.select({ provider: providerResponseHistory.provider, used: sql<number>`coalesce(sum(${providerResponseHistory.creditsUsed}), 0)` })
      .from(providerResponseHistory)
      .where(gte(providerResponseHistory.createdAt, monthStart()))
      .groupBy(providerResponseHistory.provider),
  ]);
  const usedByProvider = Object.fromEntries(usage.map(row => [row.provider, Number(row.used)]));
  return Object.fromEntries(providers.map(provider => {
    const limit = settings.find(row => row.provider === provider)?.monthlyCreditLimit ?? defaultLimits[provider];
    const used = usedByProvider[provider] ?? 0;
    return [provider, { used, limit, remaining: Math.max(0, limit - used), configured: providerConfigured(provider), mode: enrichmentMode(provider) }];
  }));
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_PROVIDER_STATUS");
    const db = getDb();
    const [usage, history] = await Promise.all([
      usageSnapshot(),
      db.select().from(providerResponseHistory).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(100),
    ]);
    return Response.json({ modes: { pdl: enrichmentMode("pdl"), lusha: enrichmentMode("lusha") }, usage, history: context.role === "DEVELOPER" ? [] : history, historyRestricted: context.role === "DEVELOPER" });
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
    const payload = await request.json() as { action?: string; alumniIds?: number[]; alumnusId?: number; providers?: ProviderName[]; operation?: string; contactChannels?: ("email" | "phone")[]; reviewId?: number; historyId?: number; fields?: string[]; confirmed?: boolean; reconciledCredits?: number; reconciliationSource?: string };
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
      if (!history || history.provider !== "lusha" || history.providerReportedCredits !== null || !["reconciliation_required", "not_applicable"].includes(history.usageState)) {
        return Response.json({ error: "Only a Lusha operation without provider-reported usage can be reconciled." }, { status: 409 });
      }
      const reconciledCredits = Number(payload.reconciledCredits);
      const now = new Date().toISOString();
      await db.update(providerResponseHistory).set({
        creditsUsed: reconciledCredits,
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
      if (!Number.isInteger(payload.alumnusId)) return Response.json({ error: "Select one approved alumnus." }, { status: 400 });
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      if (usage.lusha.remaining < 1) return Response.json({ error: "The Lusha application limit has been reached. An Admin must review it before another provider request." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, payload.alumnusId!)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      const identifier = person.linkedinUrl ? "professional profile" : "name and current company";
      const result = await searchLushaContact({ name: person.name, company: person.company, linkedinUrl: person.linkedinUrl });
      const recordedCredits = result.creditsUsed ?? 0;
      if (result.status === "success" && result.contactId) {
        const companyConflict = Boolean(result.company && person.company && result.company.toLowerCase() !== person.company.toLowerCase());
        const roleConflict = Boolean(result.jobTitle && person.title && result.jobTitle.toLowerCase() !== person.title.toLowerCase());
        await db.update(alumni).set({
          lushaPersonId: result.contactId,
          ...(companyConflict || roleConflict ? {
            professionalDataStatus: "Conflict — manual verification required",
            professionalDataNote: `Internal/PDL: ${person.title} at ${person.company}. Lusha preview: ${result.jobTitle || "role not reported"} at ${result.company || "company not reported"}. No profile field was overwritten.`,
          } : {}),
          updatedBy: actor,
          updatedAt: new Date().toISOString(),
        }).where(eq(alumni.id, person.id));
      }
      await db.insert(providerResponseHistory).values({
        provider: "lusha", alumnusId: person.id, alumnusName: person.name, operation: "Contact Search Preview", mode: "live", status: result.status,
        creditsUsed: recordedCredits, providerReportedCredits: result.creditsUsed, usageState: providerUsageState(result.creditsUsed), resultCount: result.status === "success" ? 1 : 0,
        requestSummary: `Identifier: ${identifier} · Requested fields: availability preview`,
        responseSummary: result.status === "success"
          ? `Stable Lusha contact ID found. Email availability: ${result.emailAvailable === null ? "not reported" : result.emailAvailable ? "available" : "not available"}. ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`
          : `No Lusha contact match. ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`,
        requestedBy: actor,
      });
      await writeSecurityAudit(context, { action: "lusha_contact_preview", entityType: "alumnus", entityId: person.id, metadata: { identifier, outcome: result.status, requestedFields: ["availability_preview"], creditsUsed: result.creditsUsed } });
      return authenticatedJsonResponse(context, {
        preview: {
          alumnusId: person.id, alumnusName: person.name, contactId: result.contactId,
          fullName: result.fullName, jobTitle: result.jobTitle, company: result.company,
          professionalProfile: result.linkedinUrl, emailAvailable: result.emailAvailable,
          phoneAvailable: result.phoneAvailable, status: result.status,
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
      if (!person.lushaPersonId) return Response.json({ error: "Run the Lusha contact preview first so a stable contact ID can be confirmed." }, { status: 409 });
      const result = await revealLushaEmail(person.lushaPersonId);
      const recordedCredits = result.creditsUsed ?? 0;
      if (result.status === "success" && result.email) {
        const now = new Date().toISOString();
        if (result.email !== person.email) await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field: "email", oldValue: person.email, newValue: result.email, source: "Lusha", providerAction: "Email Reveal", creditsCharged: recordedCredits, initiatedBy: actor });
        await db.update(alumni).set({ email: result.email, emailVerification: "Unverified", emailSource: "Lusha", emailRetrievedAt: now, lastLushaEnrichment: now, updatedBy: actor, updatedAt: now }).where(eq(alumni.id, person.id));
      }
      await db.insert(providerResponseHistory).values({
        provider: "lusha", alumnusId: person.id, alumnusName: person.name, operation: "Email Reveal", mode: "live", status: result.status,
        creditsUsed: recordedCredits, providerReportedCredits: result.creditsUsed, usageState: providerUsageState(result.creditsUsed), resultCount: result.status === "success" ? 1 : 0,
        requestSummary: "Stable Lusha contact ID · Requested fields: email only",
        responseSummary: result.status === "success"
          ? `Email returned by Lusha. ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`
          : `No email was returned. ${result.creditsUsed === null ? "Per-call usage was not returned; reconcile against Lusha account usage." : `${result.creditsUsed} provider credit${result.creditsUsed === 1 ? "" : "s"} reported.`}`,
        requestedBy: actor,
      });
      await writeSecurityAudit(context, { action: "lusha_email_reveal", entityType: "alumnus", entityId: person.id, metadata: { requestedFields: ["email"], outcome: result.status, creditsUsed: result.creditsUsed } });
      return authenticatedJsonResponse(context, { result: { status: result.status, creditsUsed: result.creditsUsed, usageSource: result.usageSource }, usage: await usageSnapshot() });
    }

    if (payload.action === "apply_refresh" && Number.isInteger(payload.reviewId)) {
      const [review] = await db.select().from(providerRefreshReviews).where(eq(providerRefreshReviews.id, payload.reviewId!)).limit(1);
      if (!review || review.status !== "Pending review") return Response.json({ error: "This profile refresh is no longer pending review." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, review.alumnusId)).limit(1);
      if (!person) return Response.json({ error: "The alumnus could not be found." }, { status: 404 });
      const proposed = JSON.parse(review.proposedChangesJson) as Array<{ field: string; oldValue: string; newValue: string }>;
      const allowedFields = new Set(["company", "title", "function", "seniority", "location", "previous", "linkedinUrl", "pdlPersonId"]);
      const requested = new Set((payload.fields ?? []).filter(field => allowedFields.has(field)));
      const updates: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: new Date().toISOString() };
      const applied: string[] = [];
      for (const change of proposed) {
        if (!requested.has(change.field) || !change.newValue || change.oldValue === change.newValue) continue;
        (updates as Record<string, unknown>)[change.field] = change.newValue;
        applied.push(change.field);
        await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field: change.field, oldValue: change.oldValue, newValue: change.newValue, source: "People Data Labs", providerAction: "Profile Refresh", creditsCharged: 0, initiatedBy: actor });
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
      if (enrichmentMode("pdl") === "live" && alumniIds.length > pdlLiveRefreshMaximum()) {
        return Response.json({ error: "The controlled live PDL pilot permits exactly one profile refresh at a time." }, { status: 400 });
      }
      const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      const results = [];
      const labels: Record<string, string> = { company: "Current company", title: "Role", function: "Function", seniority: "Seniority", location: "Location", previous: "Employment history", linkedinUrl: "Professional profile", pdlPersonId: "PDL profile ID" };
      for (const person of people) {
        if (usage.pdl.remaining < 1) {
          await db.insert(providerResponseHistory).values({ provider: "pdl", alumnusId: person.id, alumnusName: person.name, operation: "Person Enrichment", mode: enrichmentMode("pdl"), status: "blocked", creditsUsed: 0, requestSummary: `${person.name} at ${person.company}`, responseSummary: "Monthly application credit limit reached.", requestedBy: actor });
          results.push({ alumnusId: person.id, alumnusName: person.name, status: "blocked", creditsUsed: 0, responseSummary: "PDL application limit reached.", fields: [] });
          continue;
        }
        const result = await enrich("pdl", { id: person.id, name: person.name, company: person.company, title: person.title, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl, pdlPersonId: person.pdlPersonId });
        const [history] = await db.insert(providerResponseHistory).values({
          provider: "pdl", alumnusId: person.id, alumnusName: person.name, operation: "Person Enrichment", mode: enrichmentMode("pdl"), status: result.status,
          creditsUsed: result.creditsUsed, providerReportedCredits: result.creditsUsed, usageState: providerUsageState(result.creditsUsed), resultCount: result.status === "success" ? 1 : 0, requestSummary: `${person.name} at ${person.company}`,
          responseSummary: result.responseSummary, errorMessage: result.errorMessage ?? "", requestedBy: actor,
        }).returning();
        usage.pdl.used += result.creditsUsed;
        usage.pdl.remaining = Math.max(0, usage.pdl.limit - usage.pdl.used);
        const fields = Object.entries(result.changes)
          .filter(([field]) => field in labels)
          .map(([field, value]) => ({ field, label: labels[field], oldValue: String(person[field as keyof typeof person] ?? ""), newValue: String(value ?? "") }));
        const changed = fields.filter(field => field.newValue && field.oldValue !== field.newValue);
        const reviewStatus = result.status === "no_match" ? "No match" : result.status === "error" ? "Provider error" : changed.length ? "Pending review" : "No changes";
        const [review] = await db.insert(providerRefreshReviews).values({ providerResponseId: history.id, alumnusId: person.id, proposedChangesJson: JSON.stringify(changed), status: reviewStatus, requestedBy: actor }).returning();
        if (result.status === "success") {
          const now = new Date().toISOString();
          await db.update(alumni).set({
            lastPdlRefresh: now,
            verified: `Profile checked via PDL · ${now.slice(0, 10)}`,
            profileMatch: String(result.changes.profileMatch ?? person.profileMatch),
            currentCompanyVerification: String(result.changes.currentCompanyVerification ?? person.currentCompanyVerification),
            designationVerification: String(result.changes.designationVerification ?? person.designationVerification),
            locationVerification: String(result.changes.locationVerification ?? person.locationVerification),
            updatedBy: actor,
            updatedAt: now,
          }).where(eq(alumni.id, person.id));
        }
        results.push({ alumnusId: person.id, alumnusName: person.name, status: result.status, reviewStatus, reviewId: review.id, creditsUsed: result.creditsUsed, responseSummary: result.responseSummary, fields });
      }
      await writeSecurityAudit(context, { action: "pdl_profile_refresh", entityType: "alumni_batch", metadata: { requested: alumniIds.length, processed: people.length, mode: enrichmentMode("pdl") } });
      return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
    }

    if (!alumniIds.length || alumniIds.length > 25 || !requestedProviders.length) {
      return Response.json({ error: "Select 1 to 25 alumni and at least one provider." }, { status: 400 });
    }
    if (requestedProviders.includes("pdl")) return Response.json({ error: "Use Refresh Profiles for PDL professional data checks." }, { status: 400 });
    if (requestedProviders.includes("lusha") && enrichmentMode("lusha") === "live") return Response.json({ error: "Use the controlled Lusha contact preview and email-only confirmation workflow in LIVE mode." }, { status: 409 });
    const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
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
        const estimated = provider === "pdl" ? 1 : (channels.includes("email") ? 1 : 0) + (channels.includes("phone") ? 5 : 0);
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
