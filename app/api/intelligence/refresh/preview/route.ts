import type { RefreshJobInput, RefreshPreview } from "@/lib/intelligence-contracts"
import { resolveFixedIntelligenceCohort } from "@/lib/intelligence-cohort.server"
import { evaluateCnSelection } from "@/lib/intelligence-selection.server"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"
import { ZodError } from "zod"

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const input = await request.json() as RefreshJobInput & { cnAlumniIds?: number[] }
    if (input.cohortType === "DYNAMIC_FILTER") {
      if (!Number.isSafeInteger(input.maxProfiles) || input.maxProfiles < 1 || input.maxProfiles > 5) return Response.json({ error: "Dynamic preview maximum profiles must be between 1 and 5." }, { status: 400 })
      const selection = await evaluateCnSelection(input.filter)
      return Response.json({ preview: { mode: input.mode, cohortType: input.cohortType, matchingProfiles: selection.selectedCount, selectedProfiles: Math.min(selection.selectedCount, input.maxProfiles), selectionExceedsRunLimit: selection.selectedCount > input.maxProfiles, maxProfiles: input.maxProfiles, maxSocaiCalls: input.maxSocaiCalls, maxTargetedBright: input.maxTargetedBright, providerCalls: 0, canonicalMutations: 0 }, selection: { ...selection, members: selection.members.slice(0, 50), hasMore: selection.members.length > 50 } })
    }
    if (input.cohortType !== "FIXED_COHORT") return Response.json({ error: "Unsupported cohort type." }, { status: 400 })
    let job: RefreshJobInput = input
    let cohort = null
    if (input.cohortType === "FIXED_COHORT") {
      cohort = await resolveFixedIntelligenceCohort(context, input.cnAlumniIds ?? [])
      if (!cohort.mappedIds.length) return Response.json({ error: "None of the selected alumni has an approved intelligence identity mapping.", code: "unmapped_cohort", cohort }, { status: 409 })
      job = { ...input, alumniIds: cohort.mappedIds }
      delete (job as RefreshJobInput & { cnAlumniIds?: number[] }).cnAlumniIds
    }
    const preview = await intelligenceRequest<RefreshPreview>(context, "/v1/refresh/preview", { method: "POST", body: JSON.stringify(job) })
    return Response.json({ preview, cohort })
  } catch (error) { return accessErrorResponse(error) ?? (error instanceof ZodError ? Response.json({ error: "Invalid CN selection contract.", issues: error.issues }, { status: 400 }) : intelligenceErrorResponse(error)) }
}
