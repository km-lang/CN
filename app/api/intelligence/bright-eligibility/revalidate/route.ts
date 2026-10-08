import { eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, alumniDataLifecycle } from "@/db/schema"
import { authenticateBrightRevalidation, BRIGHT_REVALIDATION_BATCH_LIMIT, revalidateBrightItems, type BrightRevalidationItem } from "@/lib/bright-revalidation"

export async function POST(request: Request) {
  const secret = process.env.INTELLIGENCE_SERVICE_SECRET?.trim() ?? ""
  if (!authenticateBrightRevalidation(request, secret)) return Response.json({ error: "Internal service authentication is required." }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > BRIGHT_REVALIDATION_BATCH_LIMIT) return Response.json({ error: `Provide 1-${BRIGHT_REVALIDATION_BATCH_LIMIT} revalidation records.` }, { status: 400 })
  const records = body.records as BrightRevalidationItem[]
  if (records.some(item => !item || typeof item.sourceId !== "string" || typeof item.intelligenceAlumniId !== "string" || !item.intelligenceAlumniId.trim() || typeof item.normalizedLinkedinUrl !== "string" || !item.normalizedLinkedinUrl.trim())) return Response.json({ error: "Every record requires sourceId, intelligenceAlumniId, and normalizedLinkedinUrl." }, { status: 400 })
  const ids = [...new Set(records.flatMap(item => { const match = item.sourceId.match(/^cn:([1-9]\d*)$/); return match ? [Number(match[1])] : [] }))]
  const rows = ids.length ? await getDb().select({ id: alumni.id, linkedinUrl: alumni.linkedinUrl, profileMatch: alumni.profileMatch, professionalDataStatus: alumni.professionalDataStatus, lifecycleStatus: alumniDataLifecycle.status }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(inArray(alumni.id, ids)) : []
  const current = new Map(rows.map(row => [row.id, { ...row, lifecycleStatus: row.lifecycleStatus ?? "Unknown" }]))
  return Response.json({ results: revalidateBrightItems(records, current), revalidatedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } })
}
