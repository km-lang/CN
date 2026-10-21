import { evaluateCnSelection } from "@/lib/intelligence-selection.server"
import type { RefreshJobRecord } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

async function currentSelection(request: Request, id: string, permission: "VIEW_ALUMNI" | "OPERATE_PCOM") {
  const actor = await authorizeRequest(request, permission)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "A valid saved policy ID is required." }, { status: 400 })
  const job = await intelligenceRequest<RefreshJobRecord>(actor, `/v1/refresh/jobs/${id}`)
  if (job.enabled || job.cohortType !== "DYNAMIC_FILTER" || !job.selectionContract) return Response.json({ error: "Only an inactive CN-owned dynamic policy can be reevaluated." }, { status: 409 })
  const selection = await evaluateCnSelection(job.selectionContract)
  return { actor, job, selection }
}

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const outcome = await currentSelection(request, (await params).jobId, "VIEW_ALUMNI")
    if (outcome instanceof Response) return outcome
    const page = Number(new URL(request.url).searchParams.get("page") ?? 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 400) return Response.json({ error: "Page must be between 1 and 400." }, { status: 400 })
    return Response.json({ jobId: outcome.job.id, monitoringState: "INACTIVE_POLICY", ...outcome.selection, members: outcome.selection.members.slice((page - 1) * 50, page * 50), page, pageSize: 50, hasMore: page * 50 < outcome.selection.selectedCount, providerCalls: 0 })
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const outcome = await currentSelection(request, (await params).jobId, "OPERATE_PCOM")
    if (outcome instanceof Response) return outcome
    const recorded = await intelligenceRequest(outcome.actor, `/v1/refresh/jobs/${outcome.job.id}/reconcile`, { method: "POST", body: JSON.stringify({ selectedCnAlumniIds: outcome.selection.members.map(item => item.cnAlumniId), identityReady: outcome.selection.identityReady, pendingProviderMapping: outcome.selection.pendingProviderMapping }) })
    return Response.json({ jobId: outcome.job.id, monitoringState: "INACTIVE_POLICY", selection: { ...outcome.selection, members: outcome.selection.members.slice(0, 50), hasMore: outcome.selection.members.length > 50 }, recorded, providerCalls: 0 })
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
