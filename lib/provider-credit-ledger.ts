export const PROVIDER_CREDIT_AUDIT_ACTION = "provider_credit_balance_observed"
export const PROVIDER_CREDIT_STALE_MS = 24 * 60 * 60 * 1000

export type CreditProvider = "coresignal" | "brightdata" | "lusha"
export type CreditCategory = "general" | "search" | "collect" | "bulk_credits" | "free_credits" | "currency"
export type CreditSource = "authenticated_api" | "admin_dashboard_attestation"

export type ProviderCreditObservation = {
  provider: CreditProvider
  category: CreditCategory
  available: number | null
  consumed: number | null
  unit: string
  observedAt: string
  expiresAt: string | null
  source: CreditSource
  sourceDetail: string
  warning: string
  operation: string
  operationCost: number | null
  operationCostUnit: string
  costBasis: "estimated" | "provider_verified" | "unknown"
}

const PROVIDERS = new Set<CreditProvider>(["coresignal", "brightdata", "lusha"])
const CATEGORIES = new Set<CreditCategory>(["general", "search", "collect", "bulk_credits", "free_credits", "currency"])
const SOURCES = new Set<CreditSource>(["authenticated_api", "admin_dashboard_attestation"])

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("Balance amounts must be non-negative finite numbers.")
  return value
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new Error("Balance provenance is invalid.")
  const normalized = value.trim()
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized) || /\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]/i.test(normalized)) throw new Error("Balance provenance is invalid.")
  return normalized
}

function timestamp(value: unknown, optional = false): string | null {
  if ((value === null || value === undefined || value === "") && optional) return null
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("A valid ISO balance observation date is required.")
  return new Date(value).toISOString()
}

export function parseProviderCreditObservation(value: unknown): ProviderCreditObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Balance observation is invalid.")
  const row = value as Record<string, unknown>
  if (!PROVIDERS.has(row.provider as CreditProvider) || !CATEGORIES.has(row.category as CreditCategory) || !SOURCES.has(row.source as CreditSource)) throw new Error("Balance provider, category or source is invalid.")
  const available = amount(row.available)
  const consumed = amount(row.consumed)
  if (available === null && consumed === null) throw new Error("At least one externally reported balance or usage value is required.")
  const observedAt = timestamp(row.observedAt)!
  if (Date.parse(observedAt) > Date.now() + 5 * 60_000) throw new Error("Future balance observations cannot be attested.")
  const unit = bounded(row.unit, 40)
  const sourceDetail = bounded(row.sourceDetail, 160)
  const warning = bounded(row.warning ?? "", 240)
  const operation = bounded(row.operation ?? "", 120)
  const operationCostUnit = bounded(row.operationCostUnit ?? "", 40)
  if (!unit || !sourceDetail) throw new Error("Balance unit and source detail are required.")
  const costBasis = row.costBasis === "estimated" || row.costBasis === "provider_verified" ? row.costBasis : "unknown"
  const operationCost = amount(row.operationCost)
  if (operationCost !== null && (!operation || !operationCostUnit || costBasis === "unknown")) throw new Error("A priced operation needs its unit and evidence basis.")
  return { provider: row.provider as CreditProvider, category: row.category as CreditCategory, available, consumed, unit, observedAt, expiresAt: timestamp(row.expiresAt, true), source: row.source as CreditSource, sourceDetail, warning, operation, operationCost, operationCostUnit, costBasis }
}

export function creditObservationState(observation: ProviderCreditObservation | null, now = Date.now()): "unavailable" | "stale" | "current" {
  if (!observation) return "unavailable"
  return now - Date.parse(observation.observedAt) > PROVIDER_CREDIT_STALE_MS || (observation.expiresAt !== null && Date.parse(observation.expiresAt) <= now) ? "stale" : "current"
}

export function latestCreditObservations(observations: ProviderCreditObservation[]): ProviderCreditObservation[] {
  const latest = new Map<string, ProviderCreditObservation>()
  for (const observation of observations) {
    const key = `${observation.provider}:${observation.category}`
    const previous = latest.get(key)
    if (!previous || Date.parse(observation.observedAt) > Date.parse(previous.observedAt)) latest.set(key, observation)
  }
  return [...latest.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.category.localeCompare(b.category))
}

export function creditObservationHistory(observations: ProviderCreditObservation[]): ProviderCreditObservation[] {
  return [...observations].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
}
