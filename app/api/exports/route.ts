import { getDb } from "@/db"
import { alumni, companyPriorities, corporateOpportunities, corporateOpportunityHistory, engagementEvents, programmeOptions, providerCompanyMappings, providerRefreshReviews } from "@/db/schema"
import { normalizeDirectoryQuery } from "@/lib/directory-query"
import { runDirectoryExportQuery } from "@/lib/directory-data"
import { datasetCsv, datasetsCsvZip, datasetsXlsx, type ExportDataset } from "@/lib/export-files"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

const MAX_EXPORT_ROWS = 10_000
const DIRECTORY_COLUMNS = [
  { key: "id", label: "Alumni ID" }, { key: "name", label: "Alumni Name" }, { key: "programme", label: "Programme" },
  { key: "graduationYear", label: "Graduation Year" }, { key: "company", label: "Current Company" }, { key: "title", label: "Current Designation" },
  { key: "seniority", label: "Current Seniority" }, { key: "location", label: "Professional Location" }, { key: "contactStatus", label: "Verification Status" },
  { key: "relevance", label: "Placement Relevance" }, { key: "status", label: "Outreach Status" }, { key: "source", label: "Source Status" }, { key: "updatedAt", label: "Last Updated At" },
] as const

function contentDisposition(filename: string) {
  return `attachment; filename="${filename.replace(/[^a-z0-9._-]+/gi, "-")}"`
}

function download(bytes: string | Uint8Array, filename: string, contentType: string) {
  const body = typeof bytes === "string" ? bytes : new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
  return new Response(body, { headers: { "content-type": contentType, "content-disposition": contentDisposition(filename), "cache-control": "private, no-store", "x-content-type-options": "nosniff" } })
}

function directoryDataset(rows: readonly Record<string, unknown>[], importCompatible = false): ExportDataset {
  if (importCompatible) return {
    id: "alumni_import_compatible", label: "ALUMNI_IMPORT",
    columns: [{ key: "source_system", label: "source_system" }, { key: "source_alumni_id", label: "source_alumni_id" }, { key: "canonical_alumni_id", label: "canonical_alumni_id" }, { key: "name", label: "name" }, { key: "programme", label: "programme" }, { key: "graduation_year", label: "graduation_year" }, { key: "company", label: "company" }, { key: "title", label: "title" }, { key: "function", label: "function" }, { key: "seniority", label: "seniority" }, { key: "location", label: "location" }, { key: "linkedin_url", label: "linkedin_url" }],
    rows: rows.map(row => ({ source_system: "corporate_network", source_alumni_id: String(row.id), canonical_alumni_id: String(row.id), name: String(row.name ?? ""), programme: String(row.programme ?? ""), graduation_year: Number(row.graduationYear) || "", company: String(row.company ?? ""), title: String(row.title ?? ""), function: String(row.function ?? ""), seniority: String(row.seniority ?? ""), location: String(row.location ?? ""), linkedin_url: String(row.linkedinUrl ?? "") })),
  }
  return { id: "alumni", label: "ALUMNI", columns: DIRECTORY_COLUMNS, rows: rows as ExportDataset["rows"] }
}

async function adminDatasets(requested: string[]): Promise<ExportDataset[]> {
  const allowed = new Set(["alumni", "companies", "company_mappings", "priorities", "engagements", "opportunities", "opportunity_history", "professional_reviews", "programmes"])
  if (!requested.length || requested.some(id => !allowed.has(id))) throw new Error("Select only approved business datasets.")
  const db = getDb()
  const result: ExportDataset[] = []
  for (const id of requested) {
    if (id === "alumni") {
      const rows = await db.select().from(alumni).orderBy(alumni.id)
      result.push(directoryDataset(rows.map(row => ({ ...row, contactStatus: row.profileMatch, relevance: "", source: row.source }))))
    } else if (id === "companies") {
      const rows = await db.select({ company: alumni.company }).from(alumni).orderBy(alumni.company)
      const names = [...new Set(rows.map(row => row.company).filter(Boolean))]
      result.push({ id, label: "COMPANIES", columns: [{ key: "company", label: "Company" }], rows: names.map(company => ({ company })) })
    } else if (id === "priorities") {
      const rows = await db.select().from(companyPriorities).orderBy(companyPriorities.company)
      result.push({ id, label: "PRIORITIES", columns: [{ key: "company", label: "Company" }, { key: "priority", label: "Priority" }, { key: "updatedBy", label: "Updated By" }, { key: "updatedAt", label: "Updated At" }], rows })
    } else if (id === "company_mappings") {
      const rows = await db.select().from(providerCompanyMappings).orderBy(providerCompanyMappings.id)
      result.push({ id, label: "COMPANY_MAPPINGS", columns: [{ key: "id", label: "Mapping ID" }, { key: "displayName", label: "Company" }, { key: "normalizedCompanyKey", label: "Normalized Key" }, { key: "provider", label: "Provider" }, { key: "providerCompanyId", label: "Provider Company ID" }, { key: "status", label: "Status" }, { key: "mappingSource", label: "Mapping Source" }, { key: "verifiedBy", label: "Verified By" }, { key: "verifiedAt", label: "Verified At" }], rows })
    } else if (id === "engagements") {
      const rows = await db.select().from(engagementEvents).orderBy(engagementEvents.id)
      result.push({ id, label: "ENGAGEMENTS", columns: [{ key: "id", label: "Engagement ID" }, { key: "alumnusId", label: "Alumni ID" }, { key: "company", label: "Company" }, { key: "eventType", label: "Event Type" }, { key: "eventTitle", label: "Title" }, { key: "eventDate", label: "Event Date" }, { key: "status", label: "Status" }, { key: "assignedTo", label: "Assigned To" }, { key: "followUpDate", label: "Follow-up Date" }], rows })
    } else if (id === "opportunities") {
      const rows = await db.select().from(corporateOpportunities).orderBy(corporateOpportunities.id)
      result.push({ id, label: "OPPORTUNITIES", columns: [{ key: "id", label: "Opportunity ID" }, { key: "company", label: "Company" }, { key: "alumnusId", label: "Alumni ID" }, { key: "engagementId", label: "Engagement ID" }, { key: "ownerUserId", label: "Owner User ID" }, { key: "title", label: "Title" }, { key: "stage", label: "Stage" }, { key: "nextAction", label: "Next Action" }, { key: "followUpDate", label: "Follow-up Date" }, { key: "outcome", label: "Outcome" }, { key: "updatedAt", label: "Updated At" }], rows })
    } else if (id === "opportunity_history") {
      const rows = await db.select().from(corporateOpportunityHistory).orderBy(corporateOpportunityHistory.id)
      result.push({ id, label: "OPPORTUNITY_HISTORY", columns: [{ key: "id", label: "History ID" }, { key: "opportunityId", label: "Opportunity ID" }, { key: "actorUserId", label: "Actor User ID" }, { key: "action", label: "Action" }, { key: "fromStage", label: "From Stage" }, { key: "toStage", label: "To Stage" }, { key: "summary", label: "Summary" }, { key: "createdAt", label: "Created At" }], rows })
    } else if (id === "programmes") {
      const rows = await db.select().from(programmeOptions).orderBy(programmeOptions.sortOrder, programmeOptions.id)
      result.push({ id, label: "PROGRAMMES", columns: [{ key: "id", label: "Programme ID" }, { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "active", label: "Active" }, { key: "sortOrder", label: "Sort Order" }], rows })
    } else if (id === "professional_reviews") {
      const rows = await db.select().from(providerRefreshReviews).orderBy(providerRefreshReviews.id)
      result.push({ id, label: "PROFESSIONAL_REVIEWS", columns: [{ key: "id", label: "Review ID" }, { key: "providerResponseId", label: "Provider Response ID" }, { key: "alumnusId", label: "Alumni ID" }, { key: "status", label: "Status" }, { key: "requestedBy", label: "Requested By" }, { key: "reviewedBy", label: "Reviewed By" }, { key: "createdAt", label: "Created At" }, { key: "reviewedAt", label: "Reviewed At" }], rows })
    }
  }
  if (result.some(dataset => dataset.rows.length > MAX_EXPORT_ROWS)) throw new Error(`An individual export dataset cannot exceed ${MAX_EXPORT_ROWS.toLocaleString()} rows.`)
  return result
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { scope?: string; format?: string; filters?: unknown; datasets?: unknown; importCompatible?: boolean }
    if (payload.scope !== "directory" && payload.scope !== "admin") throw new Error("Export scope is unsupported.")
    if (payload.format !== "csv" && payload.format !== "xlsx") throw new Error("Export format must be csv or xlsx.")
    const context = await authorizeRequest(request, payload.scope === "admin" ? "MANAGE_USERS" : "EXPORT_DIRECTORY")
    const format = payload.format === "xlsx" ? "xlsx" : "csv"
    let datasets: ExportDataset[]
    if (payload.scope === "admin") {
      datasets = await adminDatasets(Array.isArray(payload.datasets) ? payload.datasets.map(String) : [])
    } else {
      const query = normalizeDirectoryQuery({ ...(payload.filters && typeof payload.filters === "object" ? payload.filters as object : {}), page: 1, pageSize: 50, sort: "relevance" })
      const result = await runDirectoryExportQuery(query, MAX_EXPORT_ROWS)
      if (result.total > MAX_EXPORT_ROWS) throw new Error(`This export has ${result.total.toLocaleString()} rows; narrow the filters to ${MAX_EXPORT_ROWS.toLocaleString()} or fewer.`)
      datasets = [directoryDataset(result.all as unknown as Record<string, unknown>[], Boolean(payload.importCompatible))]
    }
    const rowCount = datasets.reduce((total, dataset) => total + dataset.rows.length, 0)
    const generatedAt = new Date().toISOString()
    const info = { "Generated UTC": generatedAt, "Export type": payload.scope === "admin" ? "Approved business data" : payload.importCompatible ? "Import-compatible alumni" : "Filtered Directory report", "Datasets": datasets.map(dataset => dataset.id).join(", "), "Row count": rowCount, "Schema version": 1, "Excluded": "Credentials, sessions, raw provider payloads, technical security logs", "Consent warning": "This export does not grant consent for outreach." }
    await writeSecurityAudit(context, { action: "business_data_exported", entityType: "export", metadata: { scope: payload.scope === "admin" ? "admin" : "directory", format, datasets: datasets.map(dataset => dataset.id), rowCount } })
    const stamp = generatedAt.slice(0, 10)
    if (format === "xlsx") return download(datasetsXlsx(datasets, info, { dataFirst: payload.scope === "directory" && Boolean(payload.importCompatible) }), `corporate-network-${payload.scope === "admin" ? "business-data" : "alumni"}-${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    if (datasets.length === 1) return download(datasetCsv(datasets[0]), `corporate-network-${datasets[0].id}-${stamp}.csv`, "text/csv; charset=utf-8")
    return download(datasetsCsvZip(datasets, info), `corporate-network-business-data-${stamp}.zip`, "application/zip")
  } catch (error) {
    const denied = accessErrorResponse(error)
    if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to export business data." }, { status: 400, headers: { "cache-control": "private, no-store" } })
  }
}
