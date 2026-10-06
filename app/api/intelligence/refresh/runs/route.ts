import type { RefreshRunRecord } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    return Response.json(await intelligenceRequest<{ runs: RefreshRunRecord[] }>(context, "/v1/refresh/runs"))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
