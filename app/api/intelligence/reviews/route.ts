import type { IntelligenceReview } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    return Response.json(await intelligenceRequest<{ reviews: IntelligenceReview[] }>(context, "/v1/reviews"))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
