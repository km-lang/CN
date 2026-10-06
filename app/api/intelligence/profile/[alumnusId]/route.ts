import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni } from "@/db/schema"
import type { IdentityResolution, IntelligenceProfileResponse, IntelligenceProfileSummary } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request, { params }: { params: Promise<{ alumnusId: string }> }) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    const alumnusId = Number((await params).alumnusId)
    if (!Number.isInteger(alumnusId) || alumnusId < 1) return Response.json({ error: "Invalid alumnus ID." }, { status: 400 })
    const [person] = await getDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl }).from(alumni).where(eq(alumni.id, alumnusId)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const resolution = await intelligenceRequest<IdentityResolution>(context, "/v1/alumni/resolve", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, linkedinUrl: person.linkedinUrl || undefined }) })
    const summary = resolution.status === "MAPPED" && resolution.intelligenceAlumniId
      ? await intelligenceRequest<IntelligenceProfileSummary>(context, `/v1/alumni/${encodeURIComponent(resolution.intelligenceAlumniId)}/summary`)
      : null
    return Response.json({ resolution, summary } satisfies IntelligenceProfileResponse)
  } catch (error) {
    return accessErrorResponse(error) ?? intelligenceErrorResponse(error)
  }
}
