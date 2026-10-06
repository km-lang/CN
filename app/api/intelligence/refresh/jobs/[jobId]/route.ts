import type { RefreshJobRecord } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    return Response.json(await intelligenceRequest<RefreshJobRecord>(context, `/v1/refresh/jobs/${encodeURIComponent((await params).jobId)}`))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
