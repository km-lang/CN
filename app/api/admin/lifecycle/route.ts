import { and, asc, count, eq, like, or, sql, type SQL } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle } from "@/db/schema"
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
    return accessErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "Unable to load lifecycle records." }, { status: 400 })
  }
}
