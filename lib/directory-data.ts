import { and, asc, count, desc, eq, inArray, like, lte, gte, or, sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle, companyPriorities, engagementEvents, providerCompanyAliases, providerCompanyMappings } from "@/db/schema"
import { contactReadiness } from "@/lib/alumni-metrics"
import type { DirectoryQuery } from "@/lib/directory-query"

type AlumniRow = typeof alumni.$inferSelect

const scores: Record<string, number> = {
  "Direct hiring decision-maker": 100, "Strong hiring influence": 80, "Moderate hiring influence": 60, "Limited hiring influence": 30, "No known hiring influence": 10,
  "Very strong": 100, Strong: 85, Moderate: 65, Limited: 40, "Minimal / record only": 20,
  "Is the relevant decision-maker": 100, "Confirmed direct connection to decision-maker": 90, "Can credibly provide introduction": 75, "Same relevant function / business unit": 60, "Same company only": 40, "Weak evidence of connection": 20, "No known route": 10,
  "Tier 1 Strategic Target": 100, "High Priority": 85, "Target Recruiter": 70, "Secondary Target": 50, "Low Priority": 30, "Not Currently Targeted": 10,
}

function optionScore(value: string) { return scores[value] ?? 50 }
function seniorityScore(value: string) {
  const text = value.toLowerCase()
  if (/country|managing director|chief|c-suite|cxo/.test(text)) return 100
  if (/evp|svp|vice president|\bvp\b|partner/.test(text)) return 90
  if (/director|general manager|\bgm\b/.test(text)) return 80
  if (/senior manager/.test(text)) return 65
  if (/manager/.test(text)) return 50
  if (/associate|consultant/.test(text)) return 35
  return 20
}

function responsiveness(row: AlumniRow, events: Array<typeof engagementEvents.$inferSelect>) {
  const relevant = events.filter(event => event.alumnusId === row.id)
  const responses = relevant.filter(event => event.responseReceived).length
  const completed = relevant.filter(event => ["Action Taken", "Response Received", "Follow-up Due", "Closed"].includes(event.status)).length
  if (responses >= 2) return 90
  if (responses === 1) return 80
  if (completed >= 2 || row.status === "Contacted") return 35
  if (["Responded", "Meeting set"].includes(row.status)) return 80
  return 50
}

export function directoryRelevance(row: AlumniRow, priority: string, events: Array<typeof engagementEvents.$inferSelect>) {
  return Math.round(optionScore(row.hiringInfluence) * .30 + seniorityScore(row.seniority) * .20 + optionScore(priority) * .20 + optionScore(row.iimlRelationship) * .15 + responsiveness(row, events) * .10 + optionScore(row.warmIntroPotential) * .05)
}

export function directoryContactStatus(row: AlumniRow) {
  return contactReadiness({ profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification })
}

export function directoryPublicRow(row: AlumniRow, relevance: number) {
  return {
    id: row.id, name: row.name, initials: row.initials, programme: row.programme, batch: row.batch, graduationYear: row.graduationYear,
    education: row.education, company: row.company, title: row.title, rawTitle: row.rawTitle, function: row.function, seniority: row.seniority,
    location: row.location, previous: row.previous, experience: row.experience, confidence: row.confidence, linkedinUrl: row.linkedinUrl,
    verified: row.verified, status: row.status, note: row.note,
    assessment: { hiringInfluence: row.hiringInfluence, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential },
    verification: { profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification, location: row.locationVerification },
    discoverySource: row.discoverySource, providerFreshnessAt: row.providerFreshnessAt, source: row.source, updatedBy: row.updatedBy, updatedAt: row.updatedAt,
    relevance, contactStatus: directoryContactStatus(row),
  }
}

export async function runDirectoryQuery(query: DirectoryQuery, includeFacets = false) {
  const db = getDb()
  const f = query.filters
  const directoryCompanyKey = f.company === "All companies" ? "" : f.company.toLowerCase().trim()
  const conditions: SQL[] = [or(eq(alumniDataLifecycle.status, "Active"), sql`${alumniDataLifecycle.status} is null`)!]
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
  if (f.programme !== "All programmes") conditions.push(eq(alumni.programme, f.programme))
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

  if (f.company !== "All companies") {
    const normalizedCompany = directoryCompanyKey
    const aliases = await db.select({ displayAlias: providerCompanyAliases.displayAlias, displayName: providerCompanyMappings.displayName, providerCompanyId: providerCompanyMappings.providerCompanyId }).from(providerCompanyAliases).innerJoin(providerCompanyMappings, eq(providerCompanyMappings.id, providerCompanyAliases.mappingId)).where(and(eq(providerCompanyAliases.normalizedAlias, normalizedCompany), eq(providerCompanyAliases.status, "VERIFIED"), eq(providerCompanyMappings.status, "VERIFIED")))
    if (aliases.length > 1) conditions.push(sql`0 = 1`)
    else if (aliases.length === 1) conditions.push(or(eq(alumni.company, aliases[0].displayName), eq(alumni.company, aliases[0].displayAlias), eq(alumni.currentCompanyId, aliases[0].providerCompanyId))!)
    else {
      const mappings = await db.select().from(providerCompanyMappings).where(and(eq(providerCompanyMappings.normalizedCompanyKey, normalizedCompany), eq(providerCompanyMappings.status, "VERIFIED")))
      conditions.push(mappings.length === 1 ? or(eq(alumni.company, mappings[0].displayName), eq(alumni.currentCompanyId, mappings[0].providerCompanyId))! : eq(alumni.company, f.company))
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

  const option = (column: AnySQLiteColumn) => sql<number>`case lower(${column})
    when 'direct hiring decision-maker' then 100 when 'strong hiring influence' then 80 when 'moderate hiring influence' then 60
    when 'very strong' then 100 when 'strong' then 85 when 'moderate' then 65
    when 'is the relevant decision-maker' then 100 when 'confirmed direct connection to decision-maker' then 90 when 'can credibly provide introduction' then 75
    else 50 end`
  const seniority = sql<number>`case
    when lower(${alumni.company}) = 'lincoln international' and ${alumni.seniority} = 'Director' then 95
    when ${alumni.seniority} in ('CXO','Executive') then 100
    when ${alumni.seniority} in ('EVP/SVP','Managing Director') then 95
    when ${alumni.seniority} in ('VP','Vice President') then 90
    when ${alumni.seniority} = 'Director' then 80
    when ${alumni.seniority} = 'GM' then 70 when ${alumni.seniority} = 'Senior Manager' then 65 when ${alumni.seniority} = 'Manager' then 50 when ${alumni.seniority} in ('Associate/Consultant','Associate') then 35 else 20 end`
  const priority = sql<number>`case ${companyPriorities.priority} when 'Tier 1 Strategic Target' then 100 when 'High Priority' then 85 when 'Target Recruiter' then 70 when 'Secondary Target' then 50 when 'Low Priority' then 30 when 'Not Currently Targeted' then 10 else 50 end`
  const responsive = sql<number>`case when exists(select 1 from engagement_events e where e.alumnus_id = ${alumni.id} and e.response_received = 1) then 80 when ${alumni.status} in ('Responded','Meeting set') then 80 when ${alumni.status} = 'Contacted' then 35 else 50 end`
  const relevance = sql<number>`round((${option(alumni.hiringInfluence)} * .30) + (${seniority} * .20) + (${priority} * .20) + (${option(alumni.iimlRelationship)} * .15) + (${responsive} * .10) + (${option(alumni.warmIntroPotential)} * .05))`
  if (f.minRelevance) conditions.push(gte(relevance, f.minRelevance))
  if (f.maxRelevance < 100) conditions.push(lte(relevance, f.maxRelevance))
  const where = and(...conditions)
  const [{ total }] = await db.select({ total: count() }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where)
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const order = query.sort === "name" ? [asc(alumni.name), asc(alumni.id)] : query.sort === "graduationYear" ? [asc(alumni.graduationYear), asc(alumni.name), asc(alumni.id)] : query.sort === "seniority" ? [desc(seniority), asc(alumni.name), asc(alumni.id)] : [desc(relevance), asc(alumni.name), asc(alumni.id)]
  const rows = await db.select({ person: alumni, relevance }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where).orderBy(...order).limit(query.pageSize).offset((page - 1) * query.pageSize)
  const [functionRows, aggregateRows] = includeFacets ? await Promise.all([
    db.select({ value: alumni.function, total: count() }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where).groupBy(alumni.function),
    db.select({
      seniorLeaders: sql<number>`sum(case when ${alumni.seniority} in ('CXO','Executive','EVP/SVP','Managing Director','VP','Vice President','Director') then 1 else 0 end)`,
      contactReady: sql<number>`sum(case when ${alumni.profileMatch} = 'Confirmed' and ${alumni.currentCompanyVerification} = 'Verified' and ${alumni.designationVerification} in ('Verified','Likely') and (${alumni.emailVerification} = 'Verified' or ${alumni.phoneVerification} = 'Verified') then 1 else 0 end)`,
    }).from(alumni).leftJoin(alumniDataLifecycle, eq(alumniDataLifecycle.alumnusId, alumni.id)).leftJoin(companyPriorities, eq(companyPriorities.company, alumni.company)).where(where),
  ]) : [[], []]
  return { items: rows.map(row => directoryPublicRow(row.person, Number(row.relevance))), all: [], total, page, pageSize: query.pageSize, pageCount, facets: { functions: Object.fromEntries(functionRows.map(item => [item.value, Number(item.total)])), seniorLeaders: Number(aggregateRows[0]?.seniorLeaders ?? 0), contactReady: Number(aggregateRows[0]?.contactReady ?? 0) } }
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
