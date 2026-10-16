export const OPPORTUNITY_STAGES = [
  "IDENTIFIED",
  "QUALIFYING",
  "OUTREACH_IN_PROGRESS",
  "IN_DISCUSSION",
  "CONFIRMED",
  "ON_HOLD",
  "CLOSED_LOST",
] as const

export type OpportunityStage = typeof OPPORTUNITY_STAGES[number]

const transitions: Record<OpportunityStage, ReadonlySet<OpportunityStage>> = {
  IDENTIFIED: new Set(["QUALIFYING", "ON_HOLD", "CLOSED_LOST"]),
  QUALIFYING: new Set(["IDENTIFIED", "OUTREACH_IN_PROGRESS", "ON_HOLD", "CLOSED_LOST"]),
  OUTREACH_IN_PROGRESS: new Set(["QUALIFYING", "IN_DISCUSSION", "ON_HOLD", "CLOSED_LOST"]),
  IN_DISCUSSION: new Set(["OUTREACH_IN_PROGRESS", "CONFIRMED", "ON_HOLD", "CLOSED_LOST"]),
  CONFIRMED: new Set(["IN_DISCUSSION"]),
  ON_HOLD: new Set(["QUALIFYING", "OUTREACH_IN_PROGRESS", "IN_DISCUSSION", "CLOSED_LOST"]),
  CLOSED_LOST: new Set(["QUALIFYING"]),
}

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return OPPORTUNITY_STAGES.includes(String(value) as OpportunityStage)
}

export function opportunityStageLabel(stage: OpportunityStage) {
  return stage.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())
}

export function validateOpportunityTransition(from: OpportunityStage, to: OpportunityStage) {
  if (from === to) return
  if (!transitions[from].has(to)) throw new Error(`Opportunity stage cannot move from ${opportunityStageLabel(from)} to ${opportunityStageLabel(to)}.`)
}

export function validateOpportunityDate(value: unknown) {
  const date = String(value ?? "").trim()
  if (!date) return ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error("Follow-up date must be a valid calendar date.")
  return date
}

export function cleanOpportunityText(value: unknown, label: string, max: number, required = false) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max)
  if (required && !text) throw new Error(`${label} is required.`)
  return text
}

export function requiresOpportunityOutcome(stage: OpportunityStage) {
  return stage === "CONFIRMED" || stage === "CLOSED_LOST"
}
