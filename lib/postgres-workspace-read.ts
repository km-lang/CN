import { asc, desc, sql } from "drizzle-orm";
import type { PostgresDatabase } from "@/db/postgres/adapter";
import { alumni, alumniDataLifecycle, alumniPrivacyControls, companyPriorities, importRuns, programmeOptions, providerCompanyAliases, providerCompanyMappings } from "@/db/postgres/schema";
import { defaultDirectoryFilters } from "@/lib/alumni-search";
import { buildCompanyDirectory } from "@/lib/company-directory";
import { runPostgresDirectoryQuery } from "@/lib/postgres-directory-data";
import type { SecurityContext } from "@/lib/security";
import { hasPermission } from "@/lib/security-policy";

const effectiveIntakeStatusSql = sql<string>`case
  when ${alumni.intakeStatus} = 'PROVISIONAL' then 'PROVISIONAL'
  when ${alumni.intakeStatus} = 'VERIFIED' or ${alumni.verified} = 'Locally verified' or ${alumni.verified} like 'Human-reviewed external candidate%' then 'VERIFIED'
  else 'REVIEW_REQUIRED' end`;

export async function postgresWorkspaceResponse(
  db: PostgresDatabase,
  request: Request,
  context: SecurityContext,
  mapAlumnus: (row: typeof alumni.$inferSelect, role: SecurityContext["role"], privacy?: typeof alumniPrivacyControls.$inferSelect, lifecycle?: typeof alumniDataLifecycle.$inferSelect) => unknown,
) {
  const url = new URL(request.url);
  const includeAlumni = url.searchParams.get("includeAlumni") === "true";
  const [alumniRows, priorityRows, latestImports, privacyRows, lifecycleRows, programmeRows, companyRows, mappingRows, aliasRows, countRows, intakeCountRows, activeOutreachRows, contactReadyRows, outreachStatusRows, topResult] = await Promise.all([
    includeAlumni ? db.select().from(alumni).orderBy(alumni.name).limit(500) : Promise.resolve([]),
    db.select().from(companyPriorities).orderBy(companyPriorities.company),
    db.select().from(importRuns).orderBy(desc(importRuns.createdAt), desc(importRuns.id)).limit(1),
    includeAlumni ? db.select().from(alumniPrivacyControls) : Promise.resolve([]),
    includeAlumni ? db.select().from(alumniDataLifecycle) : Promise.resolve([]),
    db.select().from(programmeOptions).orderBy(programmeOptions.sortOrder, programmeOptions.name),
    db.selectDistinct({ company: alumni.company }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL' and trim(${alumni.company}) != ''`).orderBy(asc(alumni.company)).limit(1000),
    db.select().from(providerCompanyMappings).orderBy(providerCompanyMappings.displayName, providerCompanyMappings.id),
    db.select().from(providerCompanyAliases).orderBy(providerCompanyAliases.displayAlias),
    db.select({ count: sql<number>`count(*)` }).from(alumni),
    db.select({ status: effectiveIntakeStatusSql, count: sql<number>`count(*)` }).from(alumni).groupBy(effectiveIntakeStatusSql),
    db.select({ count: sql<number>`count(*)` }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL' and ${alumni.status} in ('Contacted','Responded','Meeting set')`),
    db.select({ count: sql<number>`count(*)` }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL' and ${alumni.profileMatch} = 'Confirmed' and ${alumni.currentCompanyVerification} = 'Verified' and ${alumni.designationVerification} in ('Verified','Likely') and (${alumni.emailVerification} = 'Verified' or ${alumni.phoneVerification} = 'Verified')`),
    db.select({ status: alumni.status, count: sql<number>`count(*)` }).from(alumni).where(sql`${alumni.intakeStatus} != 'PROVISIONAL'`).groupBy(alumni.status),
    runPostgresDirectoryQuery(db, { filters: defaultDirectoryFilters(), page: 1, pageSize: 10, sort: "relevance" }),
  ]);
  const privacyByAlumnus = new Map(privacyRows.map(row => [row.alumnusId, row]));
  const lifecycleByAlumnus = new Map(lifecycleRows.map(row => [row.alumnusId, row]));
  return Response.json({
    alumni: alumniRows.map(row => mapAlumnus(row, context.role, privacyByAlumnus.get(row.id), lifecycleByAlumnus.get(row.id))),
    companyPriorities: Object.fromEntries(priorityRows.map(row => [row.company, row.priority])),
    companyOptions: companyRows.map(row => row.company),
    companyDirectory: buildCompanyDirectory({ mappings: mappingRows, aliases: aliasRows, organizationNames: companyRows.map(row => row.company), priorityNames: priorityRows.map(row => row.company) }),
    alumniCount: Number(countRows[0]?.count ?? 0),
    alumniSummary: { total: Number(countRows[0]?.count ?? 0), verified: Number(intakeCountRows.find(row => row.status === "VERIFIED")?.count ?? 0), provisional: Number(intakeCountRows.find(row => row.status === "PROVISIONAL")?.count ?? 0), needsReview: Number(intakeCountRows.find(row => row.status === "REVIEW_REQUIRED")?.count ?? 0), activeOutreach: Number(activeOutreachRows[0]?.count ?? 0), contactReady: Number(contactReadyRows[0]?.count ?? 0) },
    outreachStatusCounts: Object.fromEntries(outreachStatusRows.map(item => [item.status, Number(item.count)])),
    topAlumni: topResult.items.filter(person => person.intakeStatus !== "PROVISIONAL").slice(0, 5),
    alumniIncluded: includeAlumni,
    latestImport: latestImports[0] ?? null,
    programmeOptions: programmeRows,
    access: { role: context.role, contactsMasked: !hasPermission(context.role, "VIEW_CONTACTS") },
  });
}
