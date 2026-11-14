import { and, eq, inArray, sql } from "drizzle-orm"

import type { PostgresDatabase } from "@/db/postgres/adapter"
import { providerResponseHistory, providerSettings } from "@/db/postgres/schema"
import { providerUsageState } from "@/lib/provider-usage"

type ClaimBase = {
  alumnusId?: number | null
  alumnusName: string
  operation: string
  requestSummary: string
  responseSummary: string
  requestedBy: string
  searchId?: number | null
}

export type ProviderClaimRequest = ClaimBase & (
  | { kind: "coresignal_collect"; applicationUnits: number; mode: "mock" | "live" }
  | { kind: "lusha_mock"; alumnusId: number }
  | { kind: "lusha_live"; alumnusId: number; applicationUnits: number }
)

export type ProviderClaimOutcome = { acquired: true; id: number; reservation: number } | {
  acquired: false; reason: "duplicate" | "unresolved_usage" | "application_limit"
}

const activeLushaStatuses = ["in_progress", "success", "no_match", "review_required", "ambiguous"]

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

// Match SQLite datetime() on stored UTC, offset, and bare timestamps. Invalid
// historical values do not enter the current-month budget.
function historyTimestamp() {
  const createdAt = providerResponseHistory.createdAt
  const candidate = sql<string>`case when ${createdAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then case when length(${createdAt}) = 10 then ${createdAt} || 'T00:00:00Z' when ${createdAt} ~* '(z|[+-][0-9]{2}:[0-9]{2})$' then ${createdAt} else ${createdAt} || 'Z' end else null end`
  return sql`case when pg_input_is_valid(${candidate}, 'timestamp with time zone') then (${candidate})::timestamptz else null end`
}

/** Reserve once before provider I/O. A provider-wide transaction lock fences
 * duplicate and monthly-budget checks across concurrent Worker requests. */
export async function postgresReserveProviderClaim(db: PostgresDatabase, request: ProviderClaimRequest, now = new Date()): Promise<ProviderClaimOutcome> {
  const provider = request.kind === "coresignal_collect" ? "coresignal" : "lusha"
  const mode = request.kind === "coresignal_collect" ? request.mode : request.kind === "lusha_mock" ? "mock" : "live"
  const reservation = request.kind === "lusha_mock" ? 0 : request.applicationUnits
  if (!Number.isSafeInteger(reservation) || reservation < 0 || request.kind !== "lusha_mock" && reservation === 0) throw new Error("Provider reservation is invalid.")
  const since = monthStart(now)
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`corporate-network:provider-claim:${provider}`}, 0))`)
    const [setting] = await tx.select().from(providerSettings).where(eq(providerSettings.provider, provider)).for("update").limit(1)
    const [duplicate] = await tx.select({ id: providerResponseHistory.id }).from(providerResponseHistory)
      .where(request.kind === "coresignal_collect"
        ? and(eq(providerResponseHistory.provider, provider), eq(providerResponseHistory.operation, request.operation), eq(providerResponseHistory.requestSummary, request.requestSummary))
        : and(eq(providerResponseHistory.provider, provider), eq(providerResponseHistory.mode, mode), eq(providerResponseHistory.alumnusId, request.alumnusId), eq(providerResponseHistory.operation, request.operation), inArray(providerResponseHistory.status, activeLushaStatuses)))
      .limit(1)
    if (duplicate) return { acquired: false, reason: "duplicate" }
    if (request.kind === "lusha_live") {
      const [unresolved] = await tx.select({ id: providerResponseHistory.id }).from(providerResponseHistory)
        .where(and(eq(providerResponseHistory.provider, "lusha"), eq(providerResponseHistory.mode, "live"), eq(providerResponseHistory.usageState, "reconciliation_required"), sql`${historyTimestamp()} >= ${since}::timestamptz`)).limit(1)
      if (unresolved) return { acquired: false, reason: "unresolved_usage" }
    }
    if (request.kind !== "lusha_mock") {
      const [usage] = await tx.select({ used: request.kind === "coresignal_collect"
        ? sql<number>`coalesce(sum(${providerResponseHistory.applicationUnits}),0)`
        : sql<number>`coalesce(sum(case when ${providerResponseHistory.applicationUnits}>0 then ${providerResponseHistory.applicationUnits} else ${providerResponseHistory.creditsUsed} end),0)` })
        .from(providerResponseHistory).where(and(eq(providerResponseHistory.provider, provider),
          ...(request.kind === "lusha_live" ? [eq(providerResponseHistory.mode, "live")] : []),
          sql`${historyTimestamp()} >= ${since}::timestamptz`))
      const limit = setting?.monthlyCreditLimit ?? (provider === "coresignal" ? 25 : 100)
      if (reservation + Number(usage?.used ?? 0) > limit) return { acquired: false, reason: "application_limit" }
    }
    const [claim] = await tx.insert(providerResponseHistory).values({ provider,
      alumnusId: request.alumnusId ?? null, alumnusName: request.alumnusName, searchId: request.searchId ?? null,
      operation: request.operation, mode, status: "in_progress", creditsUsed: 0, applicationUnits: reservation,
      providerReportedCredits: null, usageState: request.kind === "lusha_mock" ? "not_applicable" : "reconciliation_required",
      resultCount: 0, requestSummary: request.requestSummary, responseSummary: request.responseSummary,
      requestedBy: request.requestedBy }).returning({ id: providerResponseHistory.id })
    return { acquired: true, id: claim.id, reservation }
  })
}

export async function postgresSettleCoresignalCollect(db: PostgresDatabase, input: {
  id: number; status: "success" | "error" | "ambiguous"; reservation: number; responseSummary: string; errorMessage?: string
}) {
  if (!Number.isSafeInteger(input.reservation) || input.reservation < 1) throw new Error("Provider reservation is invalid.")
  const units = input.status === "error" ? 0 : input.reservation
  const [updated] = await db.update(providerResponseHistory).set({ status: input.status, applicationUnits: units,
    usageState: input.status === "error" ? "not_applicable" : "reconciliation_required",
    resultCount: input.status === "success" ? 1 : 0, responseSummary: input.responseSummary,
    errorMessage: input.errorMessage?.slice(0, 500) ?? "" })
    .where(and(eq(providerResponseHistory.id, input.id), eq(providerResponseHistory.provider, "coresignal"), eq(providerResponseHistory.status, "in_progress"), eq(providerResponseHistory.applicationUnits, input.reservation)))
    .returning({ id: providerResponseHistory.id })
  return Boolean(updated)
}

export async function postgresSettleLushaClaim(db: PostgresDatabase, input: {
  id: number; status: string; reservation: number; reportedCredits: number | null; resultCount: number; responseSummary: string; mock: boolean
}) {
  if (!Number.isSafeInteger(input.reservation) || input.reservation < 0 || input.reportedCredits !== null && (!Number.isSafeInteger(input.reportedCredits) || input.reportedCredits < 0)) throw new Error("Provider usage is invalid.")
  const [updated] = await db.update(providerResponseHistory).set({ status: input.status,
    creditsUsed: input.mock ? 0 : input.reportedCredits ?? 0,
    applicationUnits: input.mock ? 0 : Math.max(input.reservation, input.reportedCredits ?? 0),
    providerReportedCredits: input.mock ? null : input.reportedCredits,
    usageState: input.mock ? "not_applicable" : providerUsageState(input.reportedCredits),
    resultCount: input.resultCount, responseSummary: input.responseSummary })
    .where(and(eq(providerResponseHistory.id, input.id), eq(providerResponseHistory.provider, "lusha"), eq(providerResponseHistory.mode, input.mock ? "mock" : "live"), eq(providerResponseHistory.status, "in_progress"), eq(providerResponseHistory.applicationUnits, input.reservation)))
    .returning({ id: providerResponseHistory.id })
  return Boolean(updated)
}

export async function postgresMarkLushaAmbiguous(db: PostgresDatabase, id: number) {
  const [updated] = await db.update(providerResponseHistory).set({ status: "ambiguous",
    responseSummary: "The request outcome is uncertain; the reserved application units remain held and no retry is permitted.",
    errorMessage: "Provider transport or persistence failed; Admin reconciliation required." })
    .where(and(eq(providerResponseHistory.id, id), eq(providerResponseHistory.provider, "lusha"), eq(providerResponseHistory.status, "in_progress")))
    .returning({ id: providerResponseHistory.id })
  return Boolean(updated)
}
