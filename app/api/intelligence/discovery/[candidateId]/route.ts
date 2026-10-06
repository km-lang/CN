import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    return Response.json(await intelligenceRequest(context, `/v1/discovery/candidates/${encodeURIComponent((await params).candidateId)}`))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const body = await request.json() as { action?: string; note?: string }
    return Response.json(await intelligenceRequest(context, `/v1/discovery/candidates/${encodeURIComponent((await params).candidateId)}/decision`, { method: "POST", body: JSON.stringify(body) }))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
