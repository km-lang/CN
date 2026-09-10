import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  alumni,
  externalDiscoveryResults,
  externalDiscoverySearches,
  fieldChangeHistory,
  providerResponseHistory,
  providerSettings,
} from "@/db/schema";
import {
  FIXED_ALUMNI_SCHOOL,
  criteriaSummary,
  defaultDirectoryFilters,
  normalized,
  type DirectoryFilters,
  type DiscoveryProfile,
  type MatchStatus,
} from "@/lib/alumni-search";
import { discoveryMode, searchExternalAlumni } from "@/lib/pdl-discovery";
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status";
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security";

const allowedLimits = new Set([25, 50, 100]);

function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL";
}

function classify(profile: DiscoveryProfile, people: (typeof alumni.$inferSelect)[]) {
  const linkedin = normalized(profile.linkedinUrl);
  const pdlId = normalized(profile.providerPersonId);
  const name = normalized(profile.name);
  const exact = people.find(person =>
    (pdlId && normalized(person.pdlPersonId) === pdlId)
    || (linkedin && normalized(person.linkedinUrl) === linkedin)
    || (name === normalized(person.name) && profile.graduationYear > 0 && (person.graduationYear || person.batch) === profile.graduationYear),
  );
  if (exact) return { matchStatus: "Already in database" as MatchStatus, linkedInternalAlumnusId: exact.id, matchConfidence: Math.max(95, profile.matchConfidence) };
  const possible = people.find(person =>
    name === normalized(person.name)
    || (normalized(person.name).split(" ").at(-1) === name.split(" ").at(-1)
      && normalized(person.company) === normalized(profile.currentCompany)),
  );
  if (possible) return { matchStatus: "Possible duplicate" as MatchStatus, linkedInternalAlumnusId: possible.id, matchConfidence: Math.min(84, profile.matchConfidence) };
  if (!normalized(profile.education).includes("indian institute of management lucknow") || profile.matchConfidence < 65) {
    return { matchStatus: "Needs review" as MatchStatus, linkedInternalAlumnusId: null, matchConfidence: profile.matchConfidence };
  }
  return { matchStatus: "New" as MatchStatus, linkedInternalAlumnusId: null, matchConfidence: profile.matchConfidence };
}

async function pdlRemainingCredits() {
  const db = getDb();
  await db.insert(providerSettings).values({ provider: "pdl", monthlyCreditLimit: 100 }).onConflictDoNothing();
  const [settings, usage] = await Promise.all([
    db.select().from(providerSettings).where(eq(providerSettings.provider, "pdl")).limit(1),
    db.select({ used: sql<number>`coalesce(sum(${providerResponseHistory.creditsUsed}), 0)` })
      .from(providerResponseHistory)
      .where(and(eq(providerResponseHistory.provider, "pdl"), sql`${providerResponseHistory.createdAt} >= ${monthStart()}`)),
  ]);
  const limit = settings[0]?.monthlyCreditLimit ?? 100;
  const used = Number(usage[0]?.used ?? 0);
  return Math.max(0, limit - used);
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "OPERATE_PCOM");
    const db = getDb();
    const searches = await db.select().from(externalDiscoverySearches).orderBy(desc(externalDiscoverySearches.createdAt), desc(externalDiscoverySearches.id)).limit(10);
    return Response.json({ mode: discoveryMode(), searches });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load discovery history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM");
    const payload = await request.json() as {
      action?: string;
      filters?: Partial<DirectoryFilters>;
      limit?: number;
      resultIds?: number[];
      resultId?: number;
      fields?: string[];
      reason?: string;
    };
    const db = getDb();
    const actor = context.displayName;
    const now = new Date().toISOString();

    if (payload.action === "search") {
      const filters = { ...defaultDirectoryFilters(), ...payload.filters } as DirectoryFilters;
      const requestedLimit = allowedLimits.has(Number(payload.limit)) ? Number(payload.limit) : 25;
      const remaining = await pdlRemainingCredits();
      if (remaining < 1) {
        await db.insert(providerResponseHistory).values({ provider: "pdl", alumnusName: "External alumni discovery", operation: "Alumni Discovery", mode: discoveryMode(), status: "blocked", creditsUsed: 0, requestSummary: criteriaSummary(filters), responseSummary: "External search not run — PDL application limit reached.", requestedBy: actor });
        return Response.json({ error: "External search could not be run because the PDL application limit has been reached.", blocked: true, reason: "credit_limit", filters, effectiveLimit: 0 }, { status: 429 });
      }
      const limit = Math.min(requestedLimit, remaining);
      const people = await db.select().from(alumni).orderBy(alumni.name);
      const response = await searchExternalAlumni(filters, people, limit);
      const [search] = await db.insert(externalDiscoverySearches).values({
        filtersJson: JSON.stringify(filters),
        criteriaSummary: criteriaSummary(filters),
        resultCount: response.profiles.length,
        creditsUsed: response.creditsUsed,
        mode: discoveryMode(),
        initiatedBy: actor,
      }).returning();
      const reconciled = response.profiles.map(profile => ({ profile, ...classify(profile, people) }));
      for (const item of reconciled) {
        await db.insert(externalDiscoveryResults).values({
          searchId: search.id,
          providerResultId: item.profile.providerResultId,
          name: item.profile.name,
          education: item.profile.education,
          currentCompany: item.profile.currentCompany,
          role: item.profile.role,
          rawTitle: item.profile.rawTitle,
          function: item.profile.function,
          seniority: item.profile.seniority,
          location: item.profile.location,
          graduationYear: item.profile.graduationYear,
          linkedinUrl: item.profile.linkedinUrl,
          providerPersonId: item.profile.providerPersonId,
          matchStatus: item.matchStatus,
          matchConfidence: item.matchConfidence,
          linkedInternalAlumnusId: item.linkedInternalAlumnusId,
        });
      }
      const counts = {
        existing: reconciled.filter(item => item.matchStatus === "Already in database").length,
        new: reconciled.filter(item => item.matchStatus === "New").length,
        possibleDuplicate: reconciled.filter(item => item.matchStatus === "Possible duplicate").length,
        needsReview: reconciled.filter(item => item.matchStatus === "Needs review").length,
      };
      await db.update(externalDiscoverySearches).set({
        existingCount: counts.existing,
        newCount: counts.new,
        duplicateCount: counts.possibleDuplicate,
      }).where(eq(externalDiscoverySearches.id, search.id));
      await db.insert(providerResponseHistory).values({
        provider: "pdl",
        alumnusName: "External alumni discovery",
        searchId: search.id,
        operation: "alumni discovery",
        mode: discoveryMode(),
        status: "success",
        creditsUsed: response.creditsUsed,
        resultCount: response.profiles.length,
        requestSummary: criteriaSummary(filters),
        responseSummary: response.responseSummary,
        requestedBy: actor,
      });
      const storedResults = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.searchId, search.id)).orderBy(externalDiscoveryResults.id);
      await writeSecurityAudit(context, { action: "pdl_discovery_run", entityType: "discovery_search", entityId: search.id, metadata: { resultCount: response.profiles.length, creditsUsed: response.creditsUsed, mode: discoveryMode() } });
      return Response.json({ searchId: search.id, results: storedResults, counts, creditsUsed: response.creditsUsed, totalAvailable: response.totalAvailable, effectiveLimit: limit, filters });
    }

    if (payload.action === "approve") {
      const resultIds = [...new Set(payload.resultIds?.filter(Number.isInteger) ?? [])].slice(0, 25);
      if (!resultIds.length) return Response.json({ error: "Select at least one clearly new alumnus." }, { status: 400 });
      const results = await db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, resultIds));
      if (results.some(result => result.matchStatus !== "New" || result.reviewStatus !== "Pending review")) {
        return Response.json({ error: "Only clearly new, pending profiles can be added in a batch. Review possible duplicates separately." }, { status: 409 });
      }
      const added: Array<{ resultId: number; alumnusId: number }> = [];
      for (const result of results) {
        const profileKey = result.providerPersonId ? `pdl:${normalized(result.providerPersonId)}` : [result.name, result.graduationYear, result.currentCompany].map(normalized).join("|");
        const [created] = await db.insert(alumni).values({
          profileKey,
          name: result.name,
          initials: initials(result.name),
          batch: 0,
          graduationYear: result.graduationYear,
          programme: "Not confirmed",
          education: result.education || FIXED_ALUMNI_SCHOOL,
          company: result.currentCompany,
          title: result.role,
          rawTitle: result.rawTitle,
          function: result.function,
          seniority: result.seniority,
          location: result.location,
          confidence: 65,
          linkedinUrl: result.linkedinUrl,
          pdlPersonId: result.providerPersonId,
          discoverySource: "PDL",
          discoveryDate: now,
          lastPdlRefresh: now,
          verified: `Professional profile sourced via PDL · ${now.slice(0, 10)}`,
          status: "Not contacted",
          note: "Externally discovered through PDL. IIML relationship and placement context have not been assessed.",
          source: "People Data Labs",
          updatedBy: actor,
          updatedAt: now,
        }).returning();
        added.push({ resultId: result.id, alumnusId: created.id });
        await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.added, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id));
      }
      await writeSecurityAudit(context, { action: "pdl_results_approved", entityType: "alumni_batch", metadata: { addedCount: added.length, resultIds } });
      return Response.json({ addedCount: added.length, added }, { status: 201 });
    }

    if (payload.action === "apply_updates" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1);
      if (!result?.linkedInternalAlumnusId) return Response.json({ error: "No internal alumnus is linked to this result." }, { status: 409 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, result.linkedInternalAlumnusId)).limit(1);
      if (!person) return Response.json({ error: "The linked internal alumnus could not be found." }, { status: 404 });
      const candidates: Record<string, string | number> = {
        company: result.currentCompany,
        title: result.role,
        rawTitle: result.rawTitle,
        function: result.function,
        seniority: result.seniority,
        location: result.location,
        linkedinUrl: result.linkedinUrl,
        graduationYear: result.graduationYear,
        pdlPersonId: result.providerPersonId,
      };
      const requested = [...new Set(payload.fields ?? [])].filter(field => field in candidates);
      const updates: Partial<typeof alumni.$inferInsert> = { lastPdlRefresh: now, source: "People Data Labs", updatedBy: actor, updatedAt: now, verified: "PDL refreshed just now" };
      const changedFields: string[] = [];
      for (const field of requested) {
        const oldValue = String(person[field as keyof typeof person] ?? "");
        const newValue = String(candidates[field] ?? "");
        if (!newValue || oldValue === newValue) continue;
        (updates as Record<string, unknown>)[field] = candidates[field];
        changedFields.push(field);
        await db.insert(fieldChangeHistory).values({ alumnusId: person.id, field, oldValue, newValue, source: "People Data Labs", providerAction: "Compare & Refresh", initiatedBy: actor });
      }
      await db.update(alumni).set(updates).where(eq(alumni.id, person.id));
      await db.update(externalDiscoveryResults).set({ reviewStatus: changedFields.length ? "Updates applied" : "Compared, no changes", reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id));
      await writeSecurityAudit(context, { action: "professional_profile_update_approved", entityType: "alumnus", entityId: person.id, metadata: { changedFields } });
      return Response.json({ alumnusId: person.id, changedFields });
    }

    if (payload.action === "keep_separate" && Number.isInteger(payload.resultId)) {
      const [result] = await db.select().from(externalDiscoveryResults).where(eq(externalDiscoveryResults.id, payload.resultId!)).limit(1);
      if (!result || result.matchStatus !== "Possible duplicate" || result.reviewStatus !== "Pending review") {
        return Response.json({ error: "Only a pending possible duplicate can be kept as a separate record." }, { status: 409 });
      }
      const profileKey = result.providerPersonId ? `pdl:${normalized(result.providerPersonId)}` : `pdl-reviewed:${result.id}`;
      const [created] = await db.insert(alumni).values({
        profileKey,
        name: result.name,
        initials: initials(result.name),
        batch: 0,
        graduationYear: result.graduationYear,
        programme: "Not confirmed",
        education: result.education || FIXED_ALUMNI_SCHOOL,
        company: result.currentCompany,
        title: result.role,
        rawTitle: result.rawTitle,
        function: result.function,
        seniority: result.seniority,
        location: result.location,
        confidence: 65,
        linkedinUrl: result.linkedinUrl,
        pdlPersonId: result.providerPersonId,
        discoverySource: "PDL",
        discoveryDate: now,
        lastPdlRefresh: now,
        verified: `Professional profile sourced via PDL after duplicate review · ${now.slice(0, 10)}`,
        status: "Not contacted",
        note: "Added as a separate record after manual duplicate review. IIML relationship has not been assessed.",
        source: "People Data Labs",
        updatedBy: actor,
        updatedAt: now,
      }).returning();
      await db.update(externalDiscoveryResults).set({ reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate, linkedInternalAlumnusId: created.id, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, result.id));
      await writeSecurityAudit(context, { action: "possible_duplicate_kept_separate", entityType: "alumnus", entityId: created.id, metadata: { discoveryResultId: result.id } });
      return Response.json({ alumnusId: created.id }, { status: 201 });
    }

    if (payload.action === "ignore" && Number.isInteger(payload.resultId)) {
      const allowedReasons = new Set(["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"]);
      const reason = allowedReasons.has(String(payload.reason)) ? String(payload.reason) : "Other";
      await db.update(externalDiscoveryResults).set({ reviewStatus: "Ignored", reviewNote: reason, reviewedAt: now, reviewedBy: actor }).where(eq(externalDiscoveryResults.id, payload.resultId!));
      await writeSecurityAudit(context, { action: "pdl_result_ignored", entityType: "discovery_result", entityId: payload.resultId, metadata: { reason } });
      return Response.json({ ignored: true, reason });
    }

    return Response.json({ error: "Unsupported discovery action." }, { status: 400 });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    const message = error instanceof Error ? error.message : "Unable to complete external alumni discovery.";
    const businessMessage = /auth|api key|unauthor/i.test(message)
      ? "PDL authentication failed. Please confirm the live provider configuration."
      : /credit|limit/i.test(message)
        ? message
        : /network|fetch|unavailable/i.test(message)
          ? "PDL is temporarily unavailable. Please try again later."
          : message;
    return Response.json({ error: businessMessage }, { status: 500 });
  }
}
