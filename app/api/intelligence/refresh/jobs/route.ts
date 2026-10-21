import type { RefreshJobInput, RefreshJobRecord } from "@/lib/intelligence-contracts"
import { resolveFixedIntelligenceCohort } from "@/lib/intelligence-cohort.server"
import { evaluateCnSelection } from "@/lib/intelligence-selection.server"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"
import { ZodError } from "zod"

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
    if (input.cohortType === "DYNAMIC_FILTER") {
      if (input.enabled !== false || input.timingType !== "RECURRING" || !input.calendarPolicy) return Response.json({ error: "CN dynamic monitoring policies must be recurring calendar policies saved inactive." }, { status: 400 })
      if (!Number.isSafeInteger(input.maxProfiles) || input.maxProfiles < 1 || input.maxProfiles > 5) return Response.json({ error: "Dynamic policy maximum profiles must be between 1 and 5." }, { status: 400 })
      const selection = await evaluateCnSelection(input.filter)
      const created = await intelligenceRequest<{ jobId: string }>(context, "/v1/refresh/jobs", { method: "POST", body: JSON.stringify({ ...input, enabled: false }) })
      return Response.json({ ...created, selection: { selectedCount: selection.selectedCount, identityReady: selection.identityReady, pendingProviderMapping: selection.pendingProviderMapping }, monitoringState: "INACTIVE_POLICY", providerCalls: 0 }, { status: 201 })
    }
    if (input.cohortType !== "FIXED_COHORT") return Response.json({ error: "Unsupported cohort type." }, { status: 400 })
    if (input.timingType === "RUN_NOW") return Response.json({ error: "Run-now provider jobs are unavailable while monitoring is inactive.", code: "monitoring_inactive" }, { status: 409 })
    let job: RefreshJobInput = input
    let cohort = null
    if (input.cohortType === "FIXED_COHORT") {
      cohort = await resolveFixedIntelligenceCohort(context, input.cnAlumniIds ?? [])
      if (!cohort.mappedIds.length) return Response.json({ error: "None of the selected alumni has an approved intelligence identity mapping.", code: "unmapped_cohort", cohort }, { status: 409 })
      job = { ...input, alumniIds: cohort.mappedIds }
      delete (job as RefreshJobInput & { cnAlumniIds?: number[] }).cnAlumniIds
    }
    const created = await intelligenceRequest<{ jobId: string }>(context, "/v1/refresh/jobs", { method: "POST", body: JSON.stringify({ ...job, enabled: false }) })
    return Response.json({ ...created, cohort, monitoringState: "INACTIVE_POLICY", providerCalls: 0 }, { status: 201 })
  } catch (error) { return accessErrorResponse(error) ?? (error instanceof ZodError ? Response.json({ error: "Invalid CN selection contract.", issues: error.issues }, { status: 400 }) : intelligenceErrorResponse(error)) }
}
