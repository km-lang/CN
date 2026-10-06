import type { DiscoveryCandidate } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const view = new URL(request.url).searchParams.get("view")
    if (view === "missing") return Response.json(await intelligenceRequest(context, "/v1/discovery/missing-linkedin"))
    return Response.json(await intelligenceRequest<{ candidates: DiscoveryCandidate[] }>(context, "/v1/discovery/candidates"))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
