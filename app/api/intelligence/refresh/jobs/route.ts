import type { RefreshJobInput, RefreshJobRecord } from "@/lib/intelligence-contracts"
import { resolveFixedIntelligenceCohort } from "@/lib/intelligence-cohort.server"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    return Response.json(await intelligenceRequest<{ jobs: RefreshJobRecord[] }>(context, "/v1/refresh/jobs"))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as RefreshJobInput & { cnAlumniIds?: number[] }
    const permission = input.timingType === "RECURRING" ? "MANAGE_PROVIDER_SETTINGS" : "OPERATE_PCOM"
    const context = await authorizeRequest(request, permission)
    let job: RefreshJobInput = input
    let cohort = null
    if (input.cohortType === "FIXED_COHORT") {
      cohort = await resolveFixedIntelligenceCohort(context, input.cnAlumniIds ?? [])
      if (!cohort.mappedIds.length) return Response.json({ error: "None of the selected alumni has an approved intelligence identity mapping.", code: "unmapped_cohort", cohort }, { status: 409 })
      job = { ...input, alumniIds: cohort.mappedIds }
      delete (job as RefreshJobInput & { cnAlumniIds?: number[] }).cnAlumniIds
    }
    const created = await intelligenceRequest<{ jobId: string }>(context, "/v1/refresh/jobs", { method: "POST", body: JSON.stringify(job) })
    return Response.json({ ...created, cohort }, { status: 201 })
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
