export const PROVIDER_USAGE_STATES = [
  "provider_reported",
  "reconciled_account_usage",
  "reconciliation_required",
  "provider_reported_zero",
  "not_applicable",
] as const

export type ProviderUsageState = typeof PROVIDER_USAGE_STATES[number]

export function providerUsageState(reportedCredits: number | null, applicable = true): ProviderUsageState {
  if (!applicable) return "not_applicable"
  if (reportedCredits === null) return "reconciliation_required"
  return reportedCredits === 0 ? "provider_reported_zero" : "provider_reported"
}

export function effectiveProviderCredits(input: {
  providerReportedCredits?: number | null
  reconciledCredits?: number | null
  creditsUsed?: number
}) {
  if (typeof input.reconciledCredits === "number") return input.reconciledCredits
  if (typeof input.providerReportedCredits === "number") return input.providerReportedCredits
  return typeof input.creditsUsed === "number" ? input.creditsUsed : 0
}

export function providerUsageLabel(input: {
  usageState?: string
  providerReportedCredits?: number | null
  reconciledCredits?: number | null
  creditsUsed?: number
  provider?: string
  status?: string
  responseSummary?: string
}) {
  const legacyMissingLushaUsage = input.provider === "lusha"
    && input.status === "success"
    && input.creditsUsed === 0
    && /usage was not returned|reconcile/i.test(input.responseSummary ?? "")
  const state = legacyMissingLushaUsage ? "reconciliation_required" : input.usageState ?? "not_applicable"
  if (state === "reconciliation_required") return { label: "Reconciliation required", detail: "The provider did not return per-call usage metadata." }
  if (state === "reconciled_account_usage") return { label: `${input.reconciledCredits ?? input.creditsUsed ?? 0}`, detail: "Observed account-usage delta; not provider response metadata." }
  if (state === "provider_reported") return { label: `${input.providerReportedCredits ?? input.creditsUsed ?? 0}`, detail: "Exact usage reported by the provider response." }
  if (state === "provider_reported_zero") return { label: "0", detail: "The provider explicitly reported zero usage." }
  return { label: "—", detail: "Usage does not apply to this operation." }
}
