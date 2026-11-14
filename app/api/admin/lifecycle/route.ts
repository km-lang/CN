import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm"

import { getDb } from "@/db"
import { selectedDatabaseBackend } from "@/db/backend"
import { alumni, alumniDataLifecycle } from "@/db/schema"
import { postgresDatabaseErrorResponse } from "@/lib/postgres-http-error"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "MANAGE_USERS")
    const url = new URL(request.url)
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase().replace(/[%_]/g, "")
    const lifecycle = (url.searchParams.get("lifecycle") ?? "All lifecycle states").trim()
    const programme = (url.searchParams.get("programme") ?? "All programmes").trim()
    const pageSize = [10, 25, 50].includes(Number(url.searchParams.get("pageSize"))) ? Number(url.searchParams.get("pageSize")) : 10
    const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1)
    if (selectedDatabaseBackend() === "postgres") {
      const { getPostgresDb } = await import("@/db/postgres/adapter")
      const { alumni: pgAlumni, alumniDataLifecycle: pgLifecycle } = await import("@/db/postgres/schema")
      const state = sql<string>`coalesce(${pgLifecycle.status}, 'Active')`
      const conditions: SQL[] = []
      if (search) conditions.push(or(like(sql`lower(${pgAlumni.name})`, `%${search}%`), like(sql`cast(${pgAlumni.id} as text)`, `%${search}%`))!)
      if (lifecycle !== "All lifecycle states") conditions.push(eq(state, lifecycle))
      if (programme !== "All programmes") conditions.push(eq(pgAlumni.programme, programme))
      const where = conditions.length ? and(...conditions) : undefined
      const db = getPostgresDb()
      const { total, rows, programmes, page, pageCount } = await db.transaction(async tx => {
        const [{ total }] = await tx.select({ total: count() }).from(pgAlumni).leftJoin(pgLifecycle, eq(pgLifecycle.alumnusId, pgAlumni.id)).where(where)
        const pageCount = Math.max(1, Math.ceil(Number(total) / pageSize))
        const page = Math.min(requestedPage, pageCount)
        const rows = await tx.select({ id: pgAlumni.id, name: pgAlumni.name, programme: pgAlumni.programme, lifecycle: state })
          .from(pgAlumni).leftJoin(pgLifecycle, eq(pgLifecycle.alumnusId, pgAlumni.id)).where(where)
          .orderBy(asc(pgAlumni.name), asc(pgAlumni.id)).limit(pageSize).offset((page - 1) * pageSize)
        const programmes = await tx.selectDistinct({ programme: pgAlumni.programme }).from(pgAlumni).orderBy(asc(pgAlumni.programme))
        return { total, rows, programmes, page, pageCount }
      })
      return Response.json({ items: rows, total: Number(total), page, pageSize, pageCount, programmes: programmes.map(item => item.programme) }, { headers: { "cache-control": "private, no-store" } })
    }
    const state = sql<string>`coalesce(${alumniDataLifecycle.status}, 'Active')`
    const conditions: SQL[] = []
    if (search) conditions.push(or(like(sql`lower(${alumni.name})`, `%${search}%`), like(sql`cast(${alumni.id} as text)`, `%${search}%`))!)
    if (lifecycle !== "All lifecycle states") conditions.push(eq(state, lifecycle))
    if (programme !== "All programmes") conditions.push(eq(alumni.programme, programme))
    const where = conditions.length ? and(...conditions) : undefined
    const db = getDb()
    const [{ total }] = await db.select({ total: count() }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(where)
    const pageCount = Math.max(1, Math.ceil(Number(total) / pageSize))
    const page = Math.min(requestedPage, pageCount)
    const rows = await db.select({ id: alumni.id, name: alumni.name, programme: alumni.programme, lifecycle: state })
      .from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).where(where)
      .orderBy(asc(alumni.name), asc(alumni.id)).limit(pageSize).offset((page - 1) * pageSize)
    const programmes = await db.selectDistinct({ programme: alumni.programme }).from(alumni).orderBy(asc(alumni.programme))
    return Response.json({ items: rows, total: Number(total), page, pageSize, pageCount, programmes: programmes.map(item => item.programme) }, { headers: { "cache-control": "private, no-store" } })
  } catch (error) {
    return accessErrorResponse(error) ?? postgresDatabaseErrorResponse(error, true) ?? Response.json({ error: error instanceof Error ? error.message : "Unable to load lifecycle records." }, { status: 400 })
  }
}
