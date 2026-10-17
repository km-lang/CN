import { normalizeDirectoryQuery } from "@/lib/directory-query"
import { runDirectoryQuery } from "@/lib/directory-data"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

function requestQuery(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get("filters")
  let filters: Record<string, unknown> = {}
  if (raw) {
    try { filters = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error("Directory filters are malformed.") }
  }
  return normalizeDirectoryQuery({ ...filters, page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), sort: url.searchParams.get("sort") })
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "VIEW_ALUMNI")
    const query = requestQuery(request)
    const result = await runDirectoryQuery(query)
    return Response.json({ items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, pageCount: result.pageCount, filters: query.filters, sort: query.sort }, { headers: { "cache-control": "private, no-store" } })
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to query the Alumni Directory." }, { status: 400 })
  }
}
