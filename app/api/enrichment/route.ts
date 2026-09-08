import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { alumni, providerResponseHistory, providerSettings } from "@/db/schema";
import { enrich, enrichmentMode, providerConfigured, type ProviderName } from "@/lib/enrichment-providers";

const providers: ProviderName[] = ["pdl", "lusha"];
const defaultLimits: Record<ProviderName, number> = { pdl: 100, lusha: 100 };

function actorFrom(request: Request) {
  return request.headers.get("oai-authenticated-user-email")
    ?? request.headers.get("oai-authenticated-user-id")
    ?? "Public workspace user";
}

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
      .where(and(gte(providerResponseHistory.createdAt, monthStart()), eq(providerResponseHistory.status, "success")))
      .groupBy(providerResponseHistory.provider),
  ]);
  const usedByProvider = Object.fromEntries(usage.map(row => [row.provider, Number(row.used)]));
  return Object.fromEntries(providers.map(provider => {
    const limit = settings.find(row => row.provider === provider)?.monthlyCreditLimit ?? defaultLimits[provider];
    const used = usedByProvider[provider] ?? 0;
    return [provider, { used, limit, remaining: Math.max(0, limit - used), configured: providerConfigured(provider) }];
  }));
}

export async function GET() {
  try {
    const db = getDb();
    const [usage, history] = await Promise.all([
      usageSnapshot(),
      db.select().from(providerResponseHistory).orderBy(desc(providerResponseHistory.createdAt), desc(providerResponseHistory.id)).limit(100),
    ]);
    return Response.json({ mode: enrichmentMode(), usage, history });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load enrichment activity." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
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
    return Response.json({ usage: await usageSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the credit limit." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { alumniIds?: number[]; providers?: ProviderName[]; operation?: string; contactChannels?: ("email" | "phone")[] };
    const alumniIds = [...new Set(payload.alumniIds?.filter(Number.isInteger) ?? [])];
    const requestedProviders = [...new Set(payload.providers?.filter(provider => providers.includes(provider)) ?? [])];
    if (!alumniIds.length || alumniIds.length > 25 || !requestedProviders.length) {
      return Response.json({ error: "Select 1 to 25 alumni and at least one provider." }, { status: 400 });
    }
    const db = getDb();
    const actor = actorFrom(request);
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
          await db.insert(providerResponseHistory).values({ provider, alumnusId: person.id, alumnusName: person.name, operation: payload.operation ?? (alumniIds.length > 1 ? "batch" : "manual"), mode: enrichmentMode(), status: "blocked", creditsUsed: 0, requestSummary: `${person.name} at ${person.company}`, responseSummary: blocked.responseSummary, requestedBy: actor });
          continue;
        }
        const result = await enrich(provider, { id: person.id, name: person.name, company: person.company, title: person.title, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl, contactChannels: channels });
        if (result.status === "success" && Object.keys(result.changes).length) {
          await db.update(alumni).set({ ...result.changes, updatedBy: actor, updatedAt: new Date().toISOString() }).where(eq(alumni.id, person.id));
          usage[provider].used += result.creditsUsed;
          usage[provider].remaining = Math.max(0, usage[provider].limit - usage[provider].used);
        }
        await db.insert(providerResponseHistory).values({
          provider,
          alumnusId: person.id,
          alumnusName: person.name,
          operation: payload.operation ?? (alumniIds.length > 1 ? "batch" : "manual"),
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
    return Response.json({ processed: people.length, results, usage: await usageSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run enrichment." }, { status: 500 });
  }
}
