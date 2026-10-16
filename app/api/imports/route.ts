import { eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { activityLog, alumni, alumniPrivacyControls, fieldChangeHistory, importRuns, programmeOptions } from "@/db/schema"
import { importPreviewDigest, institutionalProfileKey, MAX_IMPORT_ROWS, validateImport, type ImportExisting, type ImportRecord } from "@/lib/alumni-import"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { accessErrorResponse, authorizeRequest, writeSecurityAudit } from "@/lib/security"

type ImportPayload = { action?: "preview" | "execute"; filename?: string; records?: ImportRecord[]; previewId?: string; approvedUpdateKeys?: string[]; confirmed?: boolean }

function text(value: unknown, fallback = "") { const result = String(value ?? "").trim(); return result || fallback }
function number(value: unknown, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? Math.round(result) : fallback }
function normalized(value: unknown) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL" }
function safeFilename(value: unknown) { return text(value, "alumni-import.csv").split(/[\\/]/).pop()?.slice(0, 180) || "alumni-import.csv" }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("") }

function existingRecord(person: typeof alumni.$inferSelect): ImportExisting {
  return { id: person.id, profileKey: person.profileKey, name: person.name, batch: person.batch, graduationYear: person.graduationYear, programme: person.programme, company: person.company, title: person.title, function: person.function, seniority: person.seniority, location: person.location, email: person.email, phone: person.phone, linkedinUrl: person.linkedinUrl, previous: person.previous, currentCompanyVerification: person.currentCompanyVerification, designationVerification: person.designationVerification, locationVerification: person.locationVerification, emailVerification: person.emailVerification, updatedAt: person.updatedAt }
}

function newAlumnus(record: ImportRecord, actor: string) {
  const year = number(record.graduation_year)
  const now = new Date().toISOString()
  return {
    profileKey: institutionalProfileKey(record), name: record.name, initials: initials(record.name), batch: year, graduationYear: year,
    programme: record.programme, education: "Indian Institute of Management Lucknow", company: record.company,
    title: text(record.title, "Role not recorded"), rawTitle: text(record.title), function: text(record.function, "Not assessed"),
    seniority: text(record.seniority, "Not assessed"), location: text(record.location, "Not recorded"), previous: text(record.previous_companies),
    experience: Math.max(0, number(record.experience_years)), confidence: 50, email: text(record.email).toLowerCase(), phone: text(record.phone),
    linkedinUrl: normalizeProfessionalProfileUrl(record.linkedin_url), discoverySource: `Institutional import · ${record.source_system}`,
    discoveryDate: text(record.source_date), currentIndustry: text(record.industry), emailSource: record.email ? `Institutional import · ${record.source_system}` : "",
    phoneSource: record.phone ? `Institutional import · ${record.source_system}` : "", emailVerification: "Unverified", phoneVerification: "Unverified",
    profileMatch: "Unverified", currentCompanyVerification: "Unverified", designationVerification: "Unverified", locationVerification: "Unverified",
    professionalDataStatus: "Needs assessment", verified: "Imported claim · not independently verified", status: "Not contacted",
    note: text(record.note, "Institutional import. Placement context has not yet been assessed."), source: `Institutional import · ${record.source_system}`,
    updatedBy: actor, createdAt: now, updatedAt: now,
  }
}

function safeUpdates(record: ImportRecord, current: typeof alumni.$inferSelect, actor: string) {
  const changes: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: new Date().toISOString(), source: `Institutional import · ${record.source_system}` }
  const history: Array<{ field: string; oldValue: string; newValue: string }> = []
  let protectedFields = 0
  const apply = (column: keyof typeof changes, field: string, currentValue: unknown, nextValue: unknown, allowed: boolean) => {
    const next = text(nextValue); if (!next || normalized(currentValue) === normalized(next)) return
    if (!allowed) { protectedFields += 1; return }
    ;(changes as Record<string, unknown>)[column] = column === "experience" ? number(next) : next
    history.push({ field, oldValue: text(currentValue), newValue: next })
  }
  apply("programme", "programme", current.programme, record.programme, !current.programme || current.programme === "Not recorded")
  apply("company", "company", current.company, record.company, current.currentCompanyVerification === "Unverified")
  apply("title", "title", current.title, record.title, current.designationVerification === "Unverified")
  apply("rawTitle", "rawTitle", current.rawTitle, record.title, current.designationVerification === "Unverified")
  apply("function", "function", current.function, record.function, current.designationVerification === "Unverified" || current.function === "Not assessed")
  apply("seniority", "seniority", current.seniority, record.seniority, current.designationVerification === "Unverified" || current.seniority === "Not assessed")
  apply("location", "location", current.location, record.location, current.locationVerification === "Unverified")
  apply("previous", "previous_companies", current.previous, record.previous_companies, !current.previous)
  apply("experience", "experience_years", current.experience, record.experience_years, current.experience === 0)
  apply("linkedinUrl", "linkedin_url", current.linkedinUrl, normalizeProfessionalProfileUrl(record.linkedin_url), !current.linkedinUrl)
  apply("email", "email", current.email, record.email, !current.email)
  apply("phone", "phone", current.phone, record.phone, !current.phone)
  apply("currentIndustry", "industry", current.currentIndustry, record.industry, !current.currentIndustry)
  if (changes.email) { changes.emailSource = `Institutional import · ${record.source_system}`; changes.emailVerification = "Unverified" }
  if (changes.phone) { changes.phoneSource = `Institutional import · ${record.source_system}`; changes.phoneVerification = "Unverified" }
  return { changes, history, protectedFields }
}

async function loadReview(records: ImportRecord[]) {
  const db = getDb()
  const [people, programmes] = await Promise.all([db.select().from(alumni), db.select().from(programmeOptions)])
  const activeProgrammes = programmes.filter(item => item.active).flatMap(item => [item.code, item.name])
  const review = validateImport(records, people.map(existingRecord), activeProgrammes, { maxRows: MAX_IMPORT_ROWS })
  const previewId = await sha256(importPreviewDigest(review))
  return { db, people, review, previewId }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "MANAGE_USERS")
    const payload = await request.json() as ImportPayload
    if (!Array.isArray(payload.records) || payload.records.length < 1 || payload.records.length > MAX_IMPORT_ROWS) return Response.json({ error: `Import between 1 and ${MAX_IMPORT_ROWS.toLocaleString()} records.` }, { status: 400 })
    const filename = safeFilename(payload.filename)
    if (!/\.(csv|xlsx)$/i.test(filename)) return Response.json({ error: "Choose a .csv or .xlsx alumni file." }, { status: 400 })
    const { db, people, review, previewId } = await loadReview(payload.records)
    if (payload.action === "preview") return Response.json({ ...review, previewId, providerCalls: 0, canonicalMutations: 0 })
    if (payload.action !== "execute" || payload.confirmed !== true) return Response.json({ error: "Explicit import confirmation is required." }, { status: 400 })
    if (!payload.previewId || payload.previewId !== previewId) return Response.json({ error: "The import preview is stale. Preview the file again before executing." }, { status: 409 })
    if (review.blocking) return Response.json({ error: "No valid records are available to import." }, { status: 400 })
    const approved = new Set(payload.approvedUpdateKeys ?? [])
    const creatable = review.rows.filter(row => row.kind === "new")
    let imported = 0; let updated = 0; let unchanged = review.counts.unchanged; let protectedFields = 0
    for (let offset = 0; offset < creatable.length; offset += 50) {
      const chunk = creatable.slice(offset, offset + 50).map(row => newAlumnus(row.record, context.displayName))
      if (!chunk.length) continue
      const before = await db.select({ id: alumni.id }).from(alumni).where(inArray(alumni.profileKey, chunk.map(record => record.profileKey)))
      const inserts = chunk.map(record => db.insert(alumni).values(record).onConflictDoNothing({ target: alumni.profileKey }))
      await db.batch(inserts as [typeof inserts[number], ...typeof inserts])
      const after = await db.select({ id: alumni.id, profileKey: alumni.profileKey }).from(alumni).where(inArray(alumni.profileKey, chunk.map(record => record.profileKey)))
      imported += Math.max(0, after.length - before.length)
      for (const created of after.filter(item => !before.some(previous => previous.id === item.id))) {
        const source = chunk.find(item => item.profileKey === created.profileKey)
        if (!source) continue
        const row = creatable.find(item => item.key === created.profileKey)
        if (!row) continue
        const privacy = { generalContactStatus: text(row.record.general_contact_status, "Unknown"), professionalEngagementStatus: text(row.record.professional_engagement_status, "Unknown"), birthdayEngagementStatus: text(row.record.birthday_engagement_status, "Unknown"), consentSource: text(row.record.consent_source, "Unknown") }
        if (Object.values(privacy).some(value => value !== "Unknown")) await db.insert(alumniPrivacyControls).values({ alumnusId: created.id, ...privacy, notes: "Imported explicit restrictions/consent status; no consent inferred.", updatedBy: context.displayName }).onConflictDoNothing()
      }
    }
    for (const row of review.rows.filter(item => item.kind === "existing" && approved.has(item.key))) {
      const current = people.find(person => person.id === row.existing?.id); if (!current) continue
      const plan = safeUpdates(row.record, current, context.displayName); protectedFields += plan.protectedFields
      if (!plan.history.length) { unchanged += 1; continue }
      await db.update(alumni).set(plan.changes).where(eq(alumni.id, current.id))
      for (const item of plan.history) await db.insert(fieldChangeHistory).values({ alumnusId: current.id, field: item.field, oldValue: item.oldValue, newValue: item.newValue, source: `Institutional import · ${row.record.source_system}`, providerAction: "Reviewed alumni import", initiatedBy: context.displayName })
      updated += 1
    }
    await db.insert(importRuns).values({ filename, rowCount: review.counts.detected, importedBy: context.displayName })
    await db.insert(activityLog).values({ action: "governed_import", entityType: "alumni", entityId: previewId, actor: context.displayName, details: `${imported} created; ${updated} safely updated; ${review.counts.rejected} excluded; ${protectedFields} protected fields preserved` })
    await writeSecurityAudit(context, { action: "alumni_import_executed", entityType: "import", entityId: previewId, metadata: { filename, rows: review.counts.detected, imported, updated, excluded: review.counts.rejected, protectedFields, providerCalls: 0 } })
    return Response.json({ importId: previewId, imported, updated, unchanged, excluded: review.counts.rejected, protectedFields, providerCalls: 0, canonicalProviderMutations: 0 }, { status: 201 })
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to process the alumni import." }, { status: 400 })
  }
}
