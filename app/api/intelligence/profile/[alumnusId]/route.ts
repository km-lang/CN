import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, alumniDataLifecycle } from "@/db/schema"
import { evaluateBrightEligibility } from "@/lib/bright-eligibility"
import type { CnEnrollmentResult, IdentityResolution, IntelligenceProfileResponse, IntelligenceProfileSummary } from "@/lib/intelligence-contracts"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request, { params }: { params: Promise<{ alumnusId: string }> }) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    const alumnusId = Number((await params).alumnusId)
    if (!Number.isInteger(alumnusId) || alumnusId < 1) return Response.json({ error: "Invalid alumnus ID." }, { status: 400 })
    const [person] = await getDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl, profileMatch: alumni.profileMatch, professionalDataStatus: alumni.professionalDataStatus, lifecycleStatus: alumniDataLifecycle.status, discoverySource: alumni.discoverySource, source: alumni.source, professionalDataProvider: alumni.professionalDataProvider }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(eq(alumni.id, alumnusId)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const resolution = await intelligenceRequest<IdentityResolution>(context, "/v1/alumni/resolve", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, linkedinUrl: person.linkedinUrl || undefined }) })
    const summary = resolution.status === "MAPPED" && resolution.intelligenceAlumniId
      ? await intelligenceRequest<IntelligenceProfileSummary>(context, `/v1/alumni/${encodeURIComponent(resolution.intelligenceAlumniId)}/summary`)
      : null
    const eligibility = evaluateBrightEligibility({ lifecycleStatus: person.lifecycleStatus ?? "Active", linkedinUrl: person.linkedinUrl, profileMatch: person.profileMatch, professionalDataStatus: person.professionalDataStatus, mappingStatus: resolution.status, suggestedIntelligenceAlumniId: resolution.suggestedIntelligenceAlumniId, intelligenceEnrollmentApproved: summary?.refreshEligible ?? false })
    return Response.json({ resolution, summary, eligibility, provenance: { recordOrigin: person.source || person.discoverySource, professionalProfileSource: person.professionalDataProvider || person.discoverySource || person.source, professionalProfileVerification: person.profileMatch } } satisfies IntelligenceProfileResponse)
  } catch (error) {
    return accessErrorResponse(error) ?? intelligenceErrorResponse(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ alumnusId: string }> }) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const alumnusId = Number((await params).alumnusId)
    if (!Number.isInteger(alumnusId) || alumnusId < 1) return Response.json({ error: "Invalid alumnus ID." }, { status: 400 })
    const payload = await request.json().catch(() => ({})) as { action?: string }
    if (payload.action !== "enroll_bright") return Response.json({ error: "Unsupported intelligence profile action." }, { status: 400 })
    const [person] = await getDb().select({ id: alumni.id, name: alumni.name, linkedinUrl: alumni.linkedinUrl, profileMatch: alumni.profileMatch, professionalDataStatus: alumni.professionalDataStatus, lifecycleStatus: alumniDataLifecycle.status, programme: alumni.programme, graduationYear: alumni.graduationYear, batch: alumni.batch, discoverySource: alumni.discoverySource, source: alumni.source }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(eq(alumni.id, alumnusId)).limit(1)
    if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    const resolution = await intelligenceRequest<IdentityResolution>(context, "/v1/alumni/resolve", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, linkedinUrl: person.linkedinUrl || undefined }) })
    const eligibility = evaluateBrightEligibility({ lifecycleStatus: person.lifecycleStatus ?? "Active", linkedinUrl: person.linkedinUrl, profileMatch: person.profileMatch, professionalDataStatus: person.professionalDataStatus, mappingStatus: resolution.status, suggestedIntelligenceAlumniId: resolution.suggestedIntelligenceAlumniId })
    if (eligibility.reason !== "MAPPING_REQUIRED" || !eligibility.canEnroll) return Response.json({ error: eligibility.message, code: eligibility.reason }, { status: 409 })
    const enrollment = await intelligenceRequest<CnEnrollmentResult>(context, "/v1/alumni/enroll", { method: "POST", body: JSON.stringify({ cnAlumniId: person.id, fullName: person.name, linkedinUrl: eligibility.normalizedLinkedinUrl, profileApproved: true, programme: person.programme, graduationYear: person.graduationYear || person.batch, origin: person.source || person.discoverySource }) })
    if (!enrollment.intelligenceAlumniId || (enrollment.status !== "ENROLLED" && enrollment.status !== "ALREADY_ENROLLED")) return Response.json({ enrollment, error: enrollment.reason, code: enrollment.status }, { status: 409 })
    const summary = await intelligenceRequest<IntelligenceProfileSummary>(context, `/v1/alumni/${encodeURIComponent(enrollment.intelligenceAlumniId)}/summary`)
    const mappedResolution: IdentityResolution = { status: "MAPPED", sourceId: enrollment.sourceId, intelligenceAlumniId: enrollment.intelligenceAlumniId, suggestedIntelligenceAlumniId: null, reason: enrollment.reason }
    return Response.json({ enrollment, resolution: mappedResolution, summary, eligibility: evaluateBrightEligibility({ lifecycleStatus: person.lifecycleStatus ?? "Active", linkedinUrl: person.linkedinUrl, profileMatch: person.profileMatch, professionalDataStatus: person.professionalDataStatus, mappingStatus: "MAPPED", intelligenceEnrollmentApproved: summary.refreshEligible }), provenance: { recordOrigin: person.source || person.discoverySource, professionalProfileSource: person.discoverySource || person.source, professionalProfileVerification: person.profileMatch } } satisfies IntelligenceProfileResponse)
  } catch (error) {
    return accessErrorResponse(error) ?? intelligenceErrorResponse(error)
  }
}
