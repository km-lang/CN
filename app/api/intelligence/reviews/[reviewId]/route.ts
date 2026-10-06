import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    return Response.json(await intelligenceRequest(context, `/v1/reviews/${encodeURIComponent((await params).reviewId)}`))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}

export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const body = await request.json() as { action?: string; decision?: string; note?: string }
    const suffix = body.action === "preview" ? "preview-decision" : body.action === "decide" ? "decision" : ""
    if (!suffix) return Response.json({ error: "Action must be preview or decide." }, { status: 400 })
    return Response.json(await intelligenceRequest(context, `/v1/reviews/${encodeURIComponent((await params).reviewId)}/${suffix}`, { method: "POST", body: JSON.stringify({ decision: body.decision, note: body.note }) }))
  } catch (error) { return accessErrorResponse(error) ?? intelligenceErrorResponse(error) }
}
