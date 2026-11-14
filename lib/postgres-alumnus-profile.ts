import { desc, eq } from "drizzle-orm"
import type { PostgresDatabase } from "@/db/postgres/adapter"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, fieldChangeHistory } from "@/db/postgres/schema"
import type { SecurityContext } from "@/lib/security"

export async function postgresAlumnusProfileResponse(
  db: PostgresDatabase,
  id: number,
  context: SecurityContext,
  mapAlumnus: (row: typeof alumni.$inferSelect, role: SecurityContext["role"]) => unknown,
) {
  const [person] = await db.select().from(alumni).where(eq(alumni.id, id)).limit(1)
  if (!person) return Response.json({ error: "Alumnus not found." }, { status: 404 })
  const [employmentHistory, proposals, history] = await Promise.all([
    db.select().from(alumniEmploymentEvidence).where(eq(alumniEmploymentEvidence.alumnusId, id)).orderBy(desc(alumniEmploymentEvidence.observedAt), desc(alumniEmploymentEvidence.id)),
    db.select().from(alumniProfileChangeProposals).where(eq(alumniProfileChangeProposals.alumnusId, id)).orderBy(desc(alumniProfileChangeProposals.createdAt), desc(alumniProfileChangeProposals.id)).limit(20),
    db.select().from(fieldChangeHistory).where(eq(fieldChangeHistory.alumnusId, id)).orderBy(desc(fieldChangeHistory.createdAt), desc(fieldChangeHistory.id)).limit(30),
  ])
  return Response.json({ alumnus: mapAlumnus(person, context.role), employmentHistory, proposals, fieldHistory: history })
}
