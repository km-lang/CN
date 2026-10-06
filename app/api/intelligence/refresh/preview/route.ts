import type { RefreshJobInput, RefreshPreview } from "@/lib/intelligence-contracts"
import { resolveFixedIntelligenceCohort } from "@/lib/intelligence-cohort.server"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const input = await request.json() as RefreshJobInput & { cnAlumniIds?: number[] }
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
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
