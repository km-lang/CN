import { eq, inArray } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, coresignalWebhookCoverage, coresignalWebhookIdentities } from "@/db/postgres/schema"
import { parseCnSelectionContract } from "@/lib/cn-selection-contract"
import { classifyWebhookMembers } from "@/lib/coresignal-webhooks"
import { evaluateCnSelection } from "@/lib/intelligence-selection.server"

export type SelectionInput = { cohortType: "DYNAMIC_FILTER" | "FIXED_IDS"; selection?: unknown; ids?: number[] }
const MAX_PREPARED = 100

/** Resolve a bounded selected cohort for preview or draft preparation. */
export async function postgresWebhookSelectionPlan(input: SelectionInput) {
  let ids: number[]
  let selectionVersion: string
  let selectionJson: string
  if (input.cohortType === "DYNAMIC_FILTER") {
    const contract = parseCnSelectionContract(input.selection)
    if (!contract.criteria.minPlacementRelevance && !contract.criteria.minDataConfidence) throw new Error("A high-priority dynamic selection threshold is required.")
    const selected = await evaluateCnSelection(contract)
    ids = selected.members.map(item => item.cnAlumniId)
    selectionVersion = `${selected.version}:${selected.scoreVersion}`
    selectionJson = JSON.stringify(contract)
  } else if (input.cohortType === "FIXED_IDS") {
    if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > MAX_PREPARED || input.ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("Fixed monitoring requires 1–100 explicit CN alumni IDs.")
    ids = [...new Set(input.ids)]
    selectionVersion = "fixed-cn-ids-v1"
    selectionJson = JSON.stringify(ids)
  } else throw new Error("Unsupported monitoring cohort type.")

  const db = getPostgresDb()
  const people = []
  for (let offset = 0; offset < ids.length; offset += 500) people.push(...await db.select({ id: alumni.id, coresignalEmployeeId: alumni.coresignalEmployeeId,
    intakeStatus: alumni.intakeStatus, profileMatch: alumni.profileMatch, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(inArray(alumni.id, ids.slice(offset, offset + 500))))
  const [attestations, covered] = await Promise.all([
    db.select().from(coresignalWebhookIdentities),
    db.select({ alumnusId: coresignalWebhookCoverage.alumnusId, employeeId: coresignalWebhookCoverage.employeeId }).from(coresignalWebhookCoverage).where(eq(coresignalWebhookCoverage.status, "ACTIVE")),
  ])
  const classified = classifyWebhookMembers(ids, people, attestations, covered)
  const counts = Object.fromEntries(["ELIGIBLE", "PENDING_PROVIDER_MAPPING", "IDENTITY_REVIEW_REQUIRED", "ALREADY_COVERED"].map(status => [status, classified.filter(item => item.status === status).length]))
  const eligible = classified.filter(item => item.status === "ELIGIBLE").slice(0, MAX_PREPARED)
  return { ids, classified, counts, eligible, selectionVersion, selectionJson, remainingEligible: Number(counts.ELIGIBLE) - eligible.length,
    selectedCount: ids.length }
}

export async function postgresWebhookSelectionPreview(input: SelectionInput, isAdmin: boolean) {
  const plan = await postgresWebhookSelectionPlan(input)
  return { selectedCount: plan.selectedCount, counts: plan.counts, preparedCount: plan.eligible.length,
    remainingEligible: plan.remainingEligible, excludedFromBatch: plan.selectedCount - plan.eligible.length,
    providerRequests: 0, estimatedSubscriptionCredits: 0, eligible: isAdmin ? plan.eligible : undefined }
}
