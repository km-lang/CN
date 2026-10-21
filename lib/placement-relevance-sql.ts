import { sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { alumni, companyPriorities } from "@/db/schema"
import { effectiveIntakeStatusSql } from "@/lib/intake-status"
import { COMPANY_PRIORITY_OPTIONS, HIRING_OPTIONS, PLACEMENT_WEIGHTS, RELATIONSHIP_OPTIONS, WARM_INTRO_OPTIONS } from "@/lib/placement-relevance"

function option(column: AnySQLiteColumn, values: readonly (readonly [string, number])[]) {
  // These options are fixed application constants. Inline safely quoted values
  // so a relevance threshold can reuse the expression in SELECT and WHERE
  // without exceeding D1's per-statement binding limit.
  const cases = values.map(([label, score]) => {
    if (!Number.isSafeInteger(score)) throw new Error("Placement score must be an integer.")
    return `when '${label.toLowerCase().replaceAll("'", "''")}' then ${score}`
  }).join(" ")
  return sql<number>`case lower(${column}) ${sql.raw(cases)} else 50 end`
}

export const placementSenioritySql = sql<number>`case
  when lower(${alumni.company}) = 'lincoln international' and ${alumni.seniority} = 'Director' then 95
  when lower(${alumni.seniority}) like '%country%' or lower(${alumni.seniority}) like '%managing director%' or lower(${alumni.seniority}) like '%chief%' or lower(${alumni.seniority}) like '%c-suite%' or lower(${alumni.seniority}) like '%cxo%' then 100
  when lower(${alumni.seniority}) like '%evp%' or lower(${alumni.seniority}) like '%svp%' or lower(${alumni.seniority}) like '%vice president%' or lower(${alumni.seniority}) like '%partner%' or lower(${alumni.seniority}) in ('vp','vp+') or lower(${alumni.seniority}) like 'vp %' or lower(${alumni.seniority}) like '% vp' or lower(${alumni.seniority}) like '% vp %' then 90
  when lower(${alumni.seniority}) like '%director%' or lower(${alumni.seniority}) like '%general manager%' or lower(${alumni.seniority}) in ('gm','gm+') then 80
  when lower(${alumni.seniority}) like '%senior manager%' then 65
  when lower(${alumni.seniority}) like '%manager%' then 50
  when lower(${alumni.seniority}) like '%associate%' or lower(${alumni.seniority}) like '%consultant%' then 35
  else 20 end`

const responseCount = sql<number>`(select count(*) from engagement_events e where e.alumnus_id = ${alumni.id} and e.response_received = 1)`
const completedCount = sql<number>`(select count(*) from engagement_events e where e.alumnus_id = ${alumni.id} and e.status in ('Action Taken','Response Received','Follow-up Due','Closed'))`
const responsiveness = sql<number>`case when ${responseCount} >= 2 then 90 when ${responseCount} = 1 then 80 when ${completedCount} >= 2 then 35 when ${alumni.status} in ('Responded','Meeting set') then 80 when ${alumni.status} = 'Contacted' then 35 else 50 end`

export function placementRelevanceSql(): SQL<number> {
  return sql<number>`case when ${effectiveIntakeStatusSql} = 'PROVISIONAL' then null else round(
    (${option(alumni.hiringInfluence, HIRING_OPTIONS)} * ${PLACEMENT_WEIGHTS.hiringInfluence / 100}) +
    (${placementSenioritySql} * ${PLACEMENT_WEIGHTS.seniority / 100}) +
    (${option(companyPriorities.priority, COMPANY_PRIORITY_OPTIONS)} * ${PLACEMENT_WEIGHTS.companyPriority / 100}) +
    (${option(alumni.iimlRelationship, RELATIONSHIP_OPTIONS)} * ${PLACEMENT_WEIGHTS.iimlRelationship / 100}) +
    (${responsiveness} * ${PLACEMENT_WEIGHTS.responsiveness / 100}) +
    (${option(alumni.warmIntroPotential, WARM_INTRO_OPTIONS)} * ${PLACEMENT_WEIGHTS.warmIntroduction / 100})
  ) end`
}
