import { and, asc, count, desc, eq, inArray, like, lte, gte, or, sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle, companyPriorities, engagementEvents, providerCompanyAliases, providerCompanyMappings } from "@/db/schema"
import { MISSING_COMPANY_FILTER } from "@/lib/pcom-workflow"
import { contactReadiness } from "@/lib/alumni-metrics"
import { effectiveIntakeStatus, effectiveIntakeStatusSql } from "@/lib/intake-status"
import type { DirectoryQuery } from "@/lib/directory-query"
import { calculatePlacementRelevance } from "@/lib/placement-relevance"
import { placementRelevanceSql, placementSenioritySql } from "@/lib/placement-relevance-sql"

type AlumniRow = typeof alumni.$inferSelect

export function directoryRelevance(row: AlumniRow, priority: string, events: Array<typeof engagementEvents.$inferSelect>) {
  return calculatePlacementRelevance({ intakeStatus: effectiveIntakeStatus(row), hiringInfluence: row.hiringInfluence, seniority: row.seniority, company: row.company, companyPriority: priority, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential, outreachStatus: row.status, events: events.filter(event => event.alumnusId === row.id) }).score
}

export function directoryContactStatus(row: AlumniRow) {
  return contactReadiness({ profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification })
}

export function directoryPublicRow(row: AlumniRow, relevance: number | null) {
  return {
    id: row.id, name: row.name, initials: row.initials, programme: row.programme, batch: row.batch, graduationYear: row.graduationYear,
    education: row.education, company: row.company, title: row.title, rawTitle: row.rawTitle, function: row.function, seniority: row.seniority,
    location: row.location, previous: row.previous, experience: row.experience, confidence: row.confidence, linkedinUrl: row.linkedinUrl,
    verified: row.verified, intakeStatus: effectiveIntakeStatus(row), status: row.status, note: row.note,
    assessment: { hiringInfluence: row.hiringInfluence, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential },
    verification: { profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification, location: row.locationVerification },
    professionalDataStatus: row.professionalDataStatus, lastProfessionalDataRefresh: row.lastProfessionalDataRefresh, discoverySource: row.discoverySource, providerFreshnessAt: row.providerFreshnessAt, source: row.source, updatedBy: row.updatedBy, updatedAt: row.updatedAt,
    relevance, contactStatus: directoryContactStatus(row), providerIdentityReady: Boolean(row.coresignalEmployeeId),
  }
}

export async function runDirectoryQuery(query: Omit<DirectoryQuery, "pageSize"> & { pageSize: number }, includeFacets = false) {
  const db = getDb()
  const f = query.filters
  const directoryCompanyKey = f.company === "All companies" ? "" : f.company.toLowerCase().trim().replace(/\s+/g, " ")
  const conditions: SQL[] = [or(eq(alumniDataLifecycle.status, "Active"), sql`${alumniDataLifecycle.status} is null`)!]
  if (f.alumniIds.length) conditions.push(inArray(alumni.id, f.alumniIds))
  if (f.excludeProvisional) conditions.push(sql`${alumni.intakeStatus} != 'PROVISIONAL'`)
  if (f.profileStatus !== "All profiles") conditions.push(sql`${effectiveIntakeStatusSql} = ${{ "Verified alumni": "VERIFIED", Provisional: "PROVISIONAL", "Needs review": "REVIEW_REQUIRED" }[f.profileStatus]}`)
  const contains = (column: AnySQLiteColumn, value: string) => {
    const safe = value.toLowerCase().replace(/[%_]/g, "").trim()
    return safe ? like(sql`lower(${column})`, `%${safe}%`) : undefined
  }
  if (f.search) {
    const safe = f.search.toLowerCase().replace(/[%_]/g, "").trim()
    if (safe) conditions.push(or(like(sql`lower(${alumni.name})`, `%${safe}%`), like(sql`lower(${alumni.title})`, `%${safe}%`), like(sql`lower(${alumni.company})`, `%${safe}%`))!)
  }
  for (const condition of [contains(alumni.name, f.name), contains(alumni.title, f.role), contains(alumni.location, f.location), contains(alumni.previous, f.previousCompany)]) if (condition) conditions.push(condition)
  if (f.linkedinUrl) conditions.push(contains(alumni.linkedinUrl, f.linkedinUrl)!)
  if (f.programmes.length) conditions.push(inArray(alumni.programme, f.programmes))
  else if (f.programme !== "All programmes") conditions.push(eq(alumni.programme, f.programme))
  if (f.companyPriority !== "All priorities") conditions.push(eq(companyPriorities.priority, f.companyPriority))
  if (f.function !== "All functions") conditions.push(eq(alumni.function, f.function))
  if (f.outreachStatus !== "All outreach states") conditions.push(eq(alumni.status, f.outreachStatus))
  if (f.relationship !== "All relationships") conditions.push(eq(alumni.iimlRelationship, f.relationship))
  if (f.minConfidence) conditions.push(gte(alumni.confidence, f.minConfidence))
  if (f.contactStatus !== "All contact states") {
    const contactState = sql<string>`case
      when ${alumni.profileMatch} = 'Mismatch' then 'Mismatch'
      when ${alumni.profileMatch} = 'Confirmed' and ${alumni.currentCompanyVerification} = 'Verified' and ${alumni.designationVerification} in ('Verified','Likely') and (${alumni.emailVerification} = 'Verified' or ${alumni.phoneVerification} = 'Verified') then 'Contact-ready'
      when ${alumni.profileMatch} = 'Confirmed' and ((${alumni.currentCompanyVerification} = 'Verified' and ${alumni.designationVerification} in ('Verified','Likely')) or ${alumni.emailVerification} = 'Verified' or ${alumni.phoneVerification} = 'Verified') then 'Partially verified'
      else 'Needs verification' end`
    conditions.push(eq(contactState, f.contactStatus))
  }
  const years = f.graduationYears.split(",").map(Number).filter(Number.isInteger)
  if (f.graduationYearMode === "onOrBefore" && f.batch) conditions.push(lte(alumni.graduationYear, Number(f.batch)))
  else if (f.graduationYearMode === "range") conditions.push(and(gte(alumni.graduationYear, Number(f.graduationYearStart)), lte(alumni.graduationYear, Number(f.graduationYearEnd)))!)
  else if (f.graduationYearMode === "multiple" && years.length) conditions.push(inArray(alumni.graduationYear, years))
  else if (f.batch) conditions.push(eq(alumni.graduationYear, Number(f.batch)))

  if (f.company === MISSING_COMPANY_FILTER) {
    conditions.push(sql`lower(trim(${alumni.company})) in ('', 'unknown', 'not recorded', 'company not recorded', 'unavailable', 'n/a', '-')`)
  } else if (f.company !== "All companies") {
    const normalizedCompany = directoryCompanyKey
    const aliases = await db.select({ displayAlias: providerCompanyAliases.displayAlias, displayName: providerCompanyMappings.displayName, providerCompanyId: providerCompanyMappings.providerCompanyId }).from(providerCompanyAliases).innerJoin(providerCompanyMappings, eq(providerCompanyMappings.id, providerCompanyAliases.mappingId)).where(and(eq(providerCompanyAliases.normalizedAlias, normalizedCompany), eq(providerCompanyAliases.status, "VERIFIED"), eq(providerCompanyMappings.status, "VERIFIED")))
    if (aliases.length > 1) conditions.push(sql`0 = 1`)
    else if (aliases.length === 1) conditions.push(or(eq(alumni.company, aliases[0].displayName), eq(alumni.company, aliases[0].displayAlias), eq(alumni.currentCompanyId, aliases[0].providerCompanyId))!)
    else {
      const mappings = await db.select().from(providerCompanyMappings).where(and(eq(providerCompanyMappings.normalizedCompanyKey, normalizedCompany), eq(providerCompanyMappings.status, "VERIFIED")))
      conditions.push(mappings.length === 1 ? or(eq(alumni.company, mappings[0].displayName), eq(alumni.currentCompanyId, mappings[0].providerCompanyId))! : sql`lower(trim(replace(replace(${alumni.company}, '  ', ' '), '  ', ' '))) = ${normalizedCompany}`)
    }
  }

  const selectedSeniorities = f.seniorities.length ? f.seniorities : f.seniority !== "All levels" ? [f.seniority] : []
  const hierarchy = ["Analyst/Junior", "Associate/Consultant", "Manager", "Senior Manager", "GM", "Director", "VP", "EVP/SVP", "CXO", "Unclassified", "Review required"]
  if (selectedSeniorities.length) {
    if (f.seniorityMode === "minimum") {
      const base = selectedSeniorities[0].replace(/\+$/, "")
      const rank = hierarchy.indexOf(base)
      const accepted = rank < 0 ? ["__NO_MATCH__"] : hierarchy.slice(rank).filter(value => !["Unclassified", "Review required"].includes(value))
      if (directoryCompanyKey === "lincoln international" && base === "VP" && !accepted.includes("Director")) accepted.push("Director")
      conditions.push(inArray(alumni.seniority, accepted))
    } else conditions.push(inArray(alumni.seniority, selectedSeniorities.map(value => value.replace(/\+$/, ""))))
  }

  const seniority = placementSenioritySql
  const relevance = placementRelevanceSql()
  if (f.minRelevance) conditions.push(gte(relevance, f.minRelevance))
  if (f.maxRelevance < 100) conditions.push(lte(relevance, f.maxRelevance))
  const where = and(...conditions)
  const [{ total }] = await db.select({ total: count() }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where)
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const order = query.sort === "name" ? [asc(alumni.name), asc(alumni.id)] : query.sort === "graduationYear" ? [asc(alumni.graduationYear), asc(alumni.name), asc(alumni.id)] : query.sort === "seniority" ? [desc(seniority), asc(alumni.name), asc(alumni.id)] : [desc(sql`relevance`), asc(alumni.name), asc(alumni.id)]
  const rows = await db.select({ person: alumni, professionalReviewedAt: sql<string>`(select max(created_at) from field_change_history where alumnus_id = ${alumni.id} and field in ('current_company_verification','designation_verification') and source = 'Manual verification' and new_value in ('Verified','Likely'))`, relevance: relevance.as("relevance") }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where).orderBy(...order).limit(query.pageSize).offset((page - 1) * query.pageSize)
  const [functionRows, aggregateRows] = includeFacets ? await Promise.all([
    db.select({ value: alumni.function, total: count() }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where).groupBy(alumni.function),
    db.select({
      seniorLeaders: sql<number>`sum(case when ${alumni.intakeStatus} != 'PROVISIONAL' and ${alumni.seniority} in ('CXO','Executive','EVP/SVP','Managing Director','VP','Vice President','Director') then 1 else 0 end)`,
      contactReady: sql<number>`sum(case when ${alumni.intakeStatus} != 'PROVISIONAL' and ${alumni.profileMatch} = 'Confirmed' and ${alumni.currentCompanyVerification} = 'Verified' and ${alumni.designationVerification} in ('Verified','Likely') and (${alumni.emailVerification} = 'Verified' or ${alumni.phoneVerification} = 'Verified') then 1 else 0 end)`,
    }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where),
  ]) : [[], []]
  return { items: rows.map(row => ({ ...directoryPublicRow(row.person, row.relevance === null ? null : Number(row.relevance)), professionalReviewedAt: row.professionalReviewedAt || "" })), all: [], total, page, pageSize: query.pageSize, pageCount, facets: { functions: Object.fromEntries(functionRows.map(item => [item.value, Number(item.total)])), seniorLeaders: Number(aggregateRows[0]?.seniorLeaders ?? 0), contactReady: Number(aggregateRows[0]?.contactReady ?? 0) } }
}

export async function runDirectoryExportQuery(query: DirectoryQuery, maximumRows = 10_000) {
  const first = await runDirectoryQuery({ ...query, page: 1, pageSize: 50 }, false)
  if (first.total > maximumRows) return { ...first, all: [] }
  const all = [...first.items]
  for (let page = 2; page <= first.pageCount; page += 1) {
    const result = await runDirectoryQuery({ ...query, page, pageSize: 50 }, false)
    all.push(...result.items)
  }
  return { ...first, all }
}
