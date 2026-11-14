import { sql } from "drizzle-orm"
import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, companyPriorities, corporateOpportunities, corporateOpportunityHistory, engagementEvents, programmeOptions, providerCompanyMappings, providerRefreshReviews } from "@/db/postgres/schema"
import { effectiveIntakeStatus } from "@/lib/intake-status"
import type { ExportDataset } from "@/lib/export-files"

export class PostgresExportInputError extends Error {}

export async function postgresAdminDatasets(requested: string[], directoryDataset: (rows: readonly Record<string, unknown>[]) => ExportDataset): Promise<ExportDataset[]> {
  const allowed = new Set(["alumni", "companies", "company_mappings", "priorities", "engagements", "opportunities", "opportunity_history", "professional_reviews", "programmes"])
  if (!requested.length || requested.some(id => !allowed.has(id))) throw new PostgresExportInputError("Select only approved business datasets.")
  const db = getPostgresDb()
  const result: ExportDataset[] = []
  for (const id of requested) {
    if (id === "alumni") {
      const rows = await db.select().from(alumni).orderBy(alumni.id)
      result.push(directoryDataset(rows.map(row => ({ ...row, intakeStatus: effectiveIntakeStatus(row), contactStatus: row.profileMatch, relevance: "", source: row.source }))))
    } else if (id === "companies") {
      const rows = await db.select({ company: alumni.company }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL'`).orderBy(alumni.company)
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
  if (result.some(dataset => dataset.rows.length > 10_000)) throw new PostgresExportInputError("An individual export dataset cannot exceed 10,000 rows.")
  return result
}
