import { normalizeDirectoryQuery } from "@/lib/directory-query"
import { runDirectoryQuery } from "@/lib/directory-data"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"
import { selectedDatabaseBackend } from "@/db/backend"
import { postgresDatabaseErrorResponse } from "@/lib/postgres-http-error"

function requestQuery(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get("filters")
  let filters: Record<string, unknown> = {}
  if (raw) {
    try { filters = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error("Directory filters are malformed.") }
  }
  const query: Record<string, unknown> = { ...filters }
  for (const key of ["page", "pageSize", "sort"] as const) {
    const value = url.searchParams.get(key)
    if (value !== null) query[key] = value
  }
  return normalizeDirectoryQuery(query)
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "VIEW_ALUMNI")
    const query = requestQuery(request)
    const result = selectedDatabaseBackend() === "postgres"
      ? await (async () => {
        const { getPostgresDb } = await import("@/db/postgres/adapter")
        const { runPostgresDirectoryQuery } = await import("@/lib/postgres-directory-data")
        return runPostgresDirectoryQuery(getPostgresDb(), query)
      })()
      : await runDirectoryQuery(query)
    return Response.json({ items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, pageCount: result.pageCount, filters: query.filters, sort: query.sort }, { headers: { "cache-control": "private, no-store" } })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    const databaseFailure = postgresDatabaseErrorResponse(error)
    if (databaseFailure) return databaseFailure
    return Response.json({ error: error instanceof Error ? error.message : "Unable to query the Alumni Directory." }, { status: 400 })
  }
}
