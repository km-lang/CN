import type { DiscoveryReadiness } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_PROVIDER_STATUS")
    return Response.json(await intelligenceRequest<DiscoveryReadiness>(context, "/v1/discovery/readiness"))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
