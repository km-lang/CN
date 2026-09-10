import { desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { alumni, fieldChangeHistory, providerRefreshReviews, providerResponseHistory, providerSettings } from "@/db/schema";
import { enrich, enrichmentMode, providerConfigured, type ProviderName } from "@/lib/enrichment-providers";
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security";

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
    return [provider, { used, limit, remaining: Math.max(0, limit - used), configured: providerConfigured(provider) }];
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
    return Response.json({ mode: enrichmentMode(), usage, history: context.role === "DEVELOPER" ? [] : history, historyRestricted: context.role === "DEVELOPER" });
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
    const context = await authorizeRequest(request, "OPERATE_PCOM");
    const payload = await request.json() as { action?: string; alumniIds?: number[]; providers?: ProviderName[]; operation?: string; contactChannels?: ("email" | "phone")[]; reviewId?: number; fields?: string[] };
    const db = getDb();
    const actor = context.displayName;

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
      await db.update(providerRefreshReviews).set({ status: applied.length ? "Applied" : "Reviewed, no updates selected", reviewedBy: actor, reviewedAt: now }).where(eq(providerRefreshReviews.id, review.id));
      await writeSecurityAudit(context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { appliedFields: applied } });
      return Response.json({ applied, alumnusId: person.id });
    }

    const alumniIds = [...new Set(payload.alumniIds?.filter(Number.isInteger) ?? [])];
    const requestedProviders = [...new Set(payload.providers?.filter(provider => providers.includes(provider)) ?? [])];
    if (payload.action === "refresh_profiles") {
      if (!alumniIds.length || alumniIds.length > 25) return Response.json({ error: "Select 1 to 25 approved alumni." }, { status: 400 });
      const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
      const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
      const results = [];
      const labels: Record<string, string> = { company: "Current company", title: "Role", function: "Function", seniority: "Seniority", location: "Location", previous: "Employment history", linkedinUrl: "Professional profile", pdlPersonId: "PDL profile ID" };
      for (const person of people) {
        if (usage.pdl.remaining < 1) {
          await db.insert(providerResponseHistory).values({ provider: "pdl", alumnusId: person.id, alumnusName: person.name, operation: "Profile Refresh", mode: enrichmentMode(), status: "blocked", creditsUsed: 0, requestSummary: `${person.name} at ${person.company}`, responseSummary: "Monthly application credit limit reached.", requestedBy: actor });
          results.push({ alumnusId: person.id, alumnusName: person.name, status: "blocked", creditsUsed: 0, responseSummary: "PDL application limit reached.", fields: [] });
          continue;
        }
        const result = await enrich("pdl", { id: person.id, name: person.name, company: person.company, title: person.title, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl });
        const [history] = await db.insert(providerResponseHistory).values({
          provider: "pdl", alumnusId: person.id, alumnusName: person.name, operation: "Profile Refresh", mode: enrichmentMode(), status: result.status,
          creditsUsed: result.creditsUsed, resultCount: result.status === "success" ? 1 : 0, requestSummary: `${person.name} at ${person.company}`,
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
      await writeSecurityAudit(context, { action: "pdl_profile_refresh", entityType: "alumni_batch", metadata: { requested: alumniIds.length, processed: people.length, mode: enrichmentMode() } });
      return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
    }

    if (!alumniIds.length || alumniIds.length > 25 || !requestedProviders.length) {
      return Response.json({ error: "Select 1 to 25 alumni and at least one provider." }, { status: 400 });
    }
    if (requestedProviders.includes("pdl")) return Response.json({ error: "Use Refresh Profiles for PDL professional data checks." }, { status: 400 });
    const people = await db.select().from(alumni).where(inArray(alumni.id, alumniIds));
    const usage = await usageSnapshot() as unknown as Record<ProviderName, { used: number; limit: number; remaining: number }>;
    const results = [];
    for (const person of people) {
      for (const provider of requestedProviders) {
        const channels = payload.contactChannels?.filter(channel => channel === "email" || channel === "phone") ?? ["email", "phone"];
        const estimated = provider === "pdl" ? 1 : (channels.includes("email") ? 1 : 0) + (channels.includes("phone") ? 5 : 0);
        if (usage[provider].remaining < estimated) {
          const blocked = { provider, status: "blocked", creditsUsed: 0, alumnusId: person.id, alumnusName: person.name, responseSummary: "Monthly application credit limit reached." };
          results.push(blocked);
          const blockedOperation = channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment";
          await db.insert(providerResponseHistory).values({ provider, alumnusId: person.id, alumnusName: person.name, operation: blockedOperation, mode: enrichmentMode(), status: "blocked", creditsUsed: 0, requestSummary: `${person.name} at ${person.company}`, responseSummary: blocked.responseSummary, requestedBy: actor });
          continue;
        }
        const result = await enrich(provider, { id: person.id, name: person.name, company: person.company, title: person.title, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl, contactChannels: channels });
        if (result.status === "success" && Object.keys(result.changes).length) {
          for (const field of ["email", "phone"] as const) {
            const newValue = String(result.changes[field] ?? "");
            const oldValue = person[field];
            if (newValue && newValue !== oldValue) await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field, oldValue, newValue, source: "Lusha", providerAction: channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment", creditsCharged: field === "phone" ? 5 : 1, initiatedBy: actor });
          }
          await db.update(alumni).set({ ...result.changes, updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(alumni.id, person.id));
          usage[provider].used += result.creditsUsed;
          usage[provider].remaining = Math.max(0, usage[provider].limit - usage[provider].used);
        }
        await db.insert(providerResponseHistory).values({
          provider,
          alumnusId: person.id,
          alumnusName: person.name,
          operation: channels.length === 2 ? "Email + Phone Enrichment" : channels[0] === "email" ? "Email Enrichment" : "Phone Enrichment",
          mode: enrichmentMode(),
          status: result.status,
          creditsUsed: result.creditsUsed,
          resultCount: result.status === "success" ? 1 : 0,
          requestSummary: `${person.name} at ${person.company}`,
          responseSummary: result.responseSummary,
          errorMessage: result.errorMessage ?? "",
          requestedBy: actor,
        });
        results.push({ ...result, alumnusId: person.id, alumnusName: person.name });
      }
    }
    await writeSecurityAudit(context, { action: "lusha_contact_enrichment", entityType: "alumni_batch", metadata: { requested: alumniIds.length, processed: people.length, channels: payload.contactChannels ?? ["email", "phone"], mode: enrichmentMode() } });
    return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run enrichment." }, { status: 500 });
  }
}
