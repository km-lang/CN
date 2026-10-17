import { desc } from "drizzle-orm"

import { getDb } from "@/db"
import { alumni, alumniDataLifecycle, companyPriorities, engagementEvents } from "@/db/schema"
import { contactReadiness } from "@/lib/alumni-metrics"
import { applyDirectoryQuery, type DirectoryQuery } from "@/lib/directory-query"

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

export async function runDirectoryQuery(query: DirectoryQuery) {
  const db = getDb()
  const [rows, priorities, events, lifecycle] = await Promise.all([
    db.select().from(alumni).orderBy(alumni.name, alumni.id),
    db.select().from(companyPriorities),
    db.select().from(engagementEvents).orderBy(desc(engagementEvents.eventDate)),
    db.select().from(alumniDataLifecycle),
  ])
  const lifecycleById = new Map(lifecycle.map(item => [item.alumnusId, item.status]))
  const activeRows = rows.filter(row => (lifecycleById.get(row.id) ?? "Active") === "Active")
  const searchableRows = activeRows.map(row => ({ ...row, assessment: { hiringInfluence: row.hiringInfluence, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential } }))
  const priorityByCompany = new Map(priorities.map(item => [item.company, item.priority]))
  const relevance = (row: AlumniRow) => directoryRelevance(row, priorityByCompany.get(row.company) ?? "", events)
  const result = applyDirectoryQuery(searchableRows, query, relevance, directoryContactStatus)
  return { ...result, items: result.items.map(row => directoryPublicRow(row, relevance(row))), all: result.all.map(row => directoryPublicRow(row, relevance(row))) }
}
