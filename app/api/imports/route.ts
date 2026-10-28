import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { activityLog, alumni, alumniPrivacyControls, alumniProfileChangeProposals, alumniSourceObservations, fieldChangeHistory, importRuns, mutationCommitGuards, mutationRequestItems, mutationRequests, programmeOptions, securityAuditEvents } from "@/db/schema"
import { importPreviewDigest, institutionalProfileKey, MAX_IMPORT_ROWS, validateImport, type ImportExisting, type ImportRecord } from "@/lib/alumni-import"
import { existingMutation, mutationConflictResponse, mutationIdentity, mutationPendingResponse, replayMutationResponse } from "@/lib/mutation-idempotency"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"
import { effectiveIntakeStatus } from "@/lib/intake-status"
import { accessErrorResponse, authorizeRequest, safeAuditMetadata } from "@/lib/security"

type ImportPayload = { action?: "preview" | "execute"; mode?: "upsert" | "update_only"; filename?: string; records?: ImportRecord[]; previewId?: string; approvedUpdateKeys?: string[]; confirmed?: boolean }

function text(value: unknown, fallback = "") { const result = String(value ?? "").trim(); return result || fallback }
function number(value: unknown, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? Math.round(result) : fallback }
function normalized(value: unknown) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL" }
function safeFilename(value: unknown) { return text(value, "alumni-import.csv").split(/[\\/]/).pop()?.slice(0, 180) || "alumni-import.csv" }
function retainedImportObservation(record: ImportRecord) {
  return JSON.stringify(Object.fromEntries(Object.entries({
    company: record.company, title: record.title, location: record.location, programme: record.programme,
    graduationYear: record.graduation_year, seniority: record.seniority, function: record.function,
    previousCompanies: record.previous_companies,
  }).filter(([, value]) => text(value) && !/^(unknown|not recorded|not assessed)$/i.test(text(value)))))
}
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
  const now = new Date().toISOString()
  const changes: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: now }
  const history: Array<{ field: string; oldValue: string; newValue: string }> = []
  const proposals: Array<{ field: string; oldValue: string; proposedValue: string }> = []
  let protectedFields = 0
  const clearFields = new Set(text(record.clear_fields).split(/[;,]/).map(value => value.trim()).filter(Boolean))
  const allowedClears = new Set(["company", "title", "location", "email", "phone", "note"])
  for (const field of clearFields) if (!allowedClears.has(field)) throw new Error(`Explicit clear is not supported for ${field}.`)
  const apply = (column: keyof typeof changes, field: string, currentValue: unknown, nextValue: unknown, allowed: boolean) => {
    const clearing = clearFields.has(field)
    const next = clearing ? "" : text(nextValue); if ((!next && !clearing) || normalized(currentValue) === normalized(next)) return
    if (!allowed) { protectedFields += 1; proposals.push({ field, oldValue: text(currentValue), proposedValue: next }); return }
    ;(changes as Record<string, unknown>)[column] = column === "experience" ? number(next) : next
    history.push({ field, oldValue: text(currentValue), newValue: next })
  }
  const trustedAlumniIdentity = effectiveIntakeStatus(current) === "VERIFIED" || current.profileMatch === "Confirmed"
  apply("name", "name", current.name, record.name, !trustedAlumniIdentity)
  if (changes.name) changes.initials = initials(String(changes.name))
  apply("programme", "programme", current.programme, record.programme, !trustedAlumniIdentity && (!current.programme || current.programme === "Not recorded" || current.programme === "Unknown"))
  apply("graduationYear", "graduation_year", current.graduationYear, record.graduation_year, !trustedAlumniIdentity && current.graduationYear === 0)
  if (changes.graduationYear) changes.batch = number(changes.graduationYear)
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
  apply("note", "note", current.note, record.note, true)
  if (changes.email) { changes.emailSource = `Institutional import · ${record.source_system}`; changes.emailVerification = "Unverified" }
  if (changes.phone) { changes.phoneSource = `Institutional import · ${record.source_system}`; changes.phoneVerification = "Unverified" }
  if (history.length) {
    changes.recordVersion = current.recordVersion + 1
    changes.source = `Institutional import · ${record.source_system || "partial update"}`
  }
  return { changes, history, proposals, protectedFields, now }
}

async function loadReview(records: ImportRecord[], mode: "upsert" | "update_only") {
  const db = getDb()
  const [people, programmes] = await Promise.all([db.select().from(alumni), db.select().from(programmeOptions)])
  const activeProgrammes = programmes.filter(item => item.active).flatMap(item => [item.code, item.name])
  const review = validateImport(records, people.map(existingRecord), activeProgrammes, { maxRows: MAX_IMPORT_ROWS, mode })
  const previewId = await sha256(importPreviewDigest(review))
  return { db, people, review, previewId }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM")
    const payload = await request.json() as ImportPayload
    if (payload.action !== "preview") await authorizeRequest(request, "MANAGE_USERS")
    const mode = payload.mode === "update_only" ? "update_only" : "upsert"
    if (!Array.isArray(payload.records) || payload.records.length < 1 || payload.records.length > MAX_IMPORT_ROWS) return Response.json({ error: `Import between 1 and ${MAX_IMPORT_ROWS.toLocaleString()} records.` }, { status: 400 })
    const filename = safeFilename(payload.filename)
    if (!/\.(csv|xlsx)$/i.test(filename)) return Response.json({ error: "Choose a .csv or .xlsx alumni file." }, { status: 400 })
    const executeIdentity = payload.action === "execute"
      ? await mutationIdentity(request, context, "alumni_import_execute", payload.previewId || "missing-preview", payload)
      : null
    const prior = executeIdentity ? await existingMutation(executeIdentity, context.userId) : null
    if (prior?.kind === "conflict") return mutationConflictResponse()
    if (prior?.kind === "completed") return replayMutationResponse(prior.existing)
    if (prior?.kind === "pending" && prior.existing.status === "IN_PROGRESS" && prior.existing.leaseExpiresAt > new Date().toISOString()) return mutationPendingResponse()
    const { db, people, review, previewId } = await loadReview(payload.records, mode)
    if (payload.action === "preview") return Response.json({ ...review, previewId, mode, providerCalls: 0, canonicalMutations: 0 })
    if (payload.action !== "execute" || payload.confirmed !== true) return Response.json({ error: "Explicit import confirmation is required." }, { status: 400 })
    if (!executeIdentity) return Response.json({ error: "A durable import identity could not be established." }, { status: 400 })
    if (!prior && (!payload.previewId || payload.previewId !== previewId)) return Response.json({ error: "The import preview is stale. Preview the file again before executing." }, { status: 409 })
    if (review.blocking) return Response.json({ error: "No valid records are available to import." }, { status: 400 })
    const approved = new Set(payload.approvedUpdateKeys ?? [])
    const creatable = mode === "update_only" ? [] : review.rows.filter(row => row.kind === "new")
    const now = new Date().toISOString()
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    if (!prior) {
      try {
        await db.insert(mutationRequests).values({ ...executeIdentity, actorUserId: context.userId, status: "IN_PROGRESS", leaseExpiresAt, metadataJson: JSON.stringify({ originalPreviewId: previewId, counts: review.counts }), createdAt: now, updatedAt: now })
      } catch {
        const raced = await existingMutation(executeIdentity, context.userId)
        if (raced?.kind === "completed") return replayMutationResponse(raced.existing)
        if (raced?.kind === "conflict") return mutationConflictResponse()
        return mutationPendingResponse()
      }
    } else {
      const reclaimConditions = [
        eq(mutationRequests.requestKey, executeIdentity.requestKey),
        eq(mutationRequests.status, prior.existing.status),
        eq(mutationRequests.attemptCount, prior.existing.attemptCount),
      ]
      if (prior.existing.status === "IN_PROGRESS") reclaimConditions.push(sql`unixepoch(${mutationRequests.leaseExpiresAt}) < unixepoch('now')`)
      const reclaimed = await db.update(mutationRequests).set({ status: "IN_PROGRESS", attemptCount: prior.existing.attemptCount + 1, leaseExpiresAt, updatedAt: now }).where(and(...reclaimConditions)).returning({ requestKey: mutationRequests.requestKey })
      if (reclaimed.length !== 1) return mutationPendingResponse()
    }

    try {
      const attemptCount = prior ? prior.existing.attemptCount + 1 : 1
      const originalCounts = (() => {
        try {
          const parsed = prior ? JSON.parse(prior.existing.metadataJson) as { counts?: typeof review.counts } : null
          return parsed?.counts ?? review.counts
        } catch { return review.counts }
      })()
      const completed = new Set((await db.select({ itemKey: mutationRequestItems.itemKey }).from(mutationRequestItems).where(eq(mutationRequestItems.requestKey, executeIdentity.requestKey))).map(item => item.itemKey))
      let queued: Array<Parameters<typeof db.batch>[0][number]> = []
      const flush = async () => {
        if (!queued.length) return
        const batch = queued
        queued = []
        await db.batch(batch as unknown as Parameters<typeof db.batch>[0])
        const renewed = await db.update(mutationRequests).set({ leaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(mutationRequests.requestKey, executeIdentity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"), eq(mutationRequests.attemptCount, attemptCount), sql`unixepoch(${mutationRequests.leaseExpiresAt}) >= unixepoch('now')`)).returning({ requestKey: mutationRequests.requestKey })
        if (renewed.length !== 1) throw new Error("Import ownership was lost before the next batch.")
      }
      const enqueueGroup = async (actions: typeof queued) => {
        if (queued.length && queued.length + actions.length > 80) await flush()
        queued.push(...actions)
        if (queued.length >= 80) await flush()
      }
      const ownershipGuard = (alumnusId: number | ReturnType<typeof sql<number>>, operation: string) => db.insert(mutationCommitGuards).values({
        requestKey: executeIdentity.requestKey,
        alumnusId: alumnusId as unknown as number,
        operation: `${operation}:attempt:${attemptCount}`,
        valid: sql<number>`(select case when exists (
          select 1 from mutation_requests
          where request_key = ${executeIdentity.requestKey}
            and status = 'IN_PROGRESS'
            and attempt_count = ${attemptCount}
            and unixepoch(lease_expires_at) >= unixepoch('now')
        ) then 1 else 0 end)`,
      })

      for (const row of creatable) {
        if (completed.has(row.key)) continue
        const record = newAlumnus(row.record, context.displayName)
        const itemMutationKey = `${executeIdentity.requestKey}:${row.key}`
        const alumnusId = sql<number>`(select id from alumni where profile_key = ${record.profileKey})`
        const actions: typeof queued = [
          db.insert(alumni).values({ ...record, lastMutationRequestKey: itemMutationKey }).onConflictDoNothing({ target: alumni.profileKey }),
          ownershipGuard(alumnusId, `import_create_ownership:${row.key}`),
          db.insert(mutationCommitGuards).values({ requestKey: executeIdentity.requestKey, alumnusId: alumnusId as unknown as number, operation: `import_create:${row.key}:attempt:${attemptCount}`, valid: sql<number>`(select case when exists (select 1 from alumni where profile_key = ${record.profileKey} and last_mutation_request_key = ${itemMutationKey}) then 1 else 0 end)` }),
          db.insert(alumniSourceObservations).values({ alumnusId: alumnusId as unknown as number, mutationRequestKey: executeIdentity.requestKey, sourceRowKey: row.key, filename, sourceSystem: text(row.record.source_system), sourceDate: text(row.record.source_date), observedJson: retainedImportObservation(row.record), importedBy: context.displayName }).onConflictDoNothing(),
        ]
        if (record.linkedinUrl) actions.push(db.insert(mutationCommitGuards).values({ requestKey: executeIdentity.requestKey, alumnusId: alumnusId as unknown as number, operation: `import_linkedin_identity:${row.key}:attempt:${attemptCount}`, valid: sql<number>`(select case when (select count(*) from alumni where rtrim(lower(linkedin_url), '/') = rtrim(lower(${record.linkedinUrl}), '/')) = 1 then 1 else 0 end)` }))
        const privacy = { generalContactStatus: text(row.record.general_contact_status, "Unknown"), professionalEngagementStatus: text(row.record.professional_engagement_status, "Unknown"), birthdayEngagementStatus: text(row.record.birthday_engagement_status, "Unknown"), consentSource: text(row.record.consent_source, "Unknown") }
        if (Object.values(privacy).some(value => value !== "Unknown")) actions.push(db.insert(alumniPrivacyControls).values({ alumnusId: alumnusId as unknown as number, ...privacy, notes: "Imported explicit restrictions/consent status; no consent inferred.", updatedBy: context.displayName }).onConflictDoNothing())
        actions.push(db.insert(mutationRequestItems).values({ requestKey: executeIdentity.requestKey, itemKey: row.key, outcomeJson: JSON.stringify({ imported: 1, updated: 0, unchanged: 0, protectedFields: 0 }) }))
        await enqueueGroup(actions)
      }

      for (const row of review.rows.filter(item => item.kind === "existing" && approved.has(item.key))) {
        if (completed.has(row.key)) continue
        const current = people.find(person => person.id === row.existing?.id); if (!current) continue
        const plan = safeUpdates(row.record, current, context.displayName)
        const itemMutationKey = `${executeIdentity.requestKey}:${row.key}`
        const proposalRecordVersion = current.recordVersion + (plan.history.length ? 1 : 0)
        const actions: typeof queued = []
        if (plan.history.length || plan.proposals.length) {
          actions.push(
            db.update(alumni).set({ ...plan.changes, lastMutationRequestKey: itemMutationKey }).where(and(eq(alumni.id, current.id), eq(alumni.recordVersion, current.recordVersion))),
            ownershipGuard(current.id, `import_update_ownership:${row.key}`),
            db.insert(mutationCommitGuards).values({ requestKey: executeIdentity.requestKey, alumnusId: current.id, operation: `import_update:${row.key}:attempt:${attemptCount}`, valid: sql<number>`(select case when exists (select 1 from alumni where id = ${current.id} and record_version = ${proposalRecordVersion} and last_mutation_request_key = ${itemMutationKey}) then 1 else 0 end)` }),
            ...plan.history.map(item => db.insert(fieldChangeHistory).values({ alumnusId: current.id, field: item.field, oldValue: item.oldValue, newValue: item.newValue, source: `Institutional import · ${row.record.source_system}`, providerAction: "Reviewed alumni import", initiatedBy: context.displayName, mutationRequestKey: itemMutationKey })),
            ...plan.proposals.map(item => db.insert(alumniProfileChangeProposals).values({ alumnusId: current.id, field: item.field, oldValue: item.oldValue, proposedValue: item.proposedValue, source: `Institutional import · ${row.record.source_system || "partial update"}`, expectedRecordVersion: proposalRecordVersion, proposedBy: context.displayName, createdAt: plan.now, mutationRequestKey: itemMutationKey })),
          )
        }
        actions.push(ownershipGuard(current.id, `import_item_ownership:${row.key}`))
        actions.push(db.insert(alumniSourceObservations).values({ alumnusId: current.id, mutationRequestKey: executeIdentity.requestKey, sourceRowKey: row.key, filename, sourceSystem: text(row.record.source_system), sourceDate: text(row.record.source_date), observedJson: retainedImportObservation(row.record), importedBy: context.displayName }).onConflictDoNothing())
        actions.push(db.insert(mutationRequestItems).values({ requestKey: executeIdentity.requestKey, itemKey: row.key, outcomeJson: JSON.stringify({ imported: 0, updated: plan.history.length ? 1 : 0, unchanged: plan.history.length || plan.proposals.length ? 0 : 1, protectedFields: plan.protectedFields }) }))
        await enqueueGroup(actions)
      }
      await flush()

      const outcomes = await db.select({ outcomeJson: mutationRequestItems.outcomeJson }).from(mutationRequestItems).where(eq(mutationRequestItems.requestKey, executeIdentity.requestKey))
      const totals = outcomes.reduce((sum, item) => {
        const value = JSON.parse(item.outcomeJson) as { imported?: number; updated?: number; unchanged?: number; protectedFields?: number }
        sum.imported += value.imported ?? 0; sum.updated += value.updated ?? 0; sum.unchanged += value.unchanged ?? 0; sum.protectedFields += value.protectedFields ?? 0
        return sum
      }, { imported: 0, updated: 0, unchanged: originalCounts.unchanged, protectedFields: 0 })
      const responseBody = { importId: payload.previewId || previewId, mode, ...totals, excluded: originalCounts.rejected, providerCalls: 0, canonicalProviderMutations: 0 }
      const completedAt = new Date().toISOString()
      const finalAlumnusId = sql<number>`(select min(id) from alumni)`
      await db.batch([
        ownershipGuard(finalAlumnusId, "import_finalize"),
        db.insert(importRuns).values({ filename, rowCount: originalCounts.detected, importedBy: context.displayName, mutationRequestKey: executeIdentity.requestKey }),
        db.insert(activityLog).values({ action: "governed_import", entityType: "alumni", entityId: payload.previewId || previewId, actor: context.displayName, details: `${totals.imported} created; ${totals.updated} safely updated; ${originalCounts.rejected} excluded; ${totals.protectedFields} protected fields preserved`, mutationRequestKey: executeIdentity.requestKey }),
        db.insert(securityAuditEvents).values({ actorUserId: context.userId, actorIdentity: context.externalIdentity, actorName: context.displayName, actorRole: context.role, action: "alumni_import_executed", entityType: "import", entityId: payload.previewId || previewId, metadataJson: safeAuditMetadata({ filename, mode, rows: originalCounts.detected, imported: totals.imported, updated: totals.updated, excluded: originalCounts.rejected, protectedFields: totals.protectedFields, providerCalls: 0 }), result: "success", source: "application", mutationRequestKey: executeIdentity.requestKey }),
        db.update(mutationRequests).set({ status: "COMPLETED", httpStatus: 201, responseJson: JSON.stringify(responseBody), leaseExpiresAt: "", updatedAt: completedAt }).where(and(eq(mutationRequests.requestKey, executeIdentity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"), eq(mutationRequests.attemptCount, attemptCount))),
      ] as unknown as Parameters<typeof db.batch>[0])
      return Response.json(responseBody, { status: 201 })
    } catch (error) {
      const failedAt = new Date().toISOString()
      await db.update(mutationRequests).set({ status: "FAILED", leaseExpiresAt: "", updatedAt: failedAt }).where(and(eq(mutationRequests.requestKey, executeIdentity.requestKey), eq(mutationRequests.status, "IN_PROGRESS"), eq(mutationRequests.attemptCount, prior ? prior.existing.attemptCount + 1 : 1)))
      throw error
    }
  } catch (error) {
    const denied = accessErrorResponse(error); if (denied) return denied
    return Response.json({ error: error instanceof Error ? error.message : "Unable to process the alumni import." }, { status: 400 })
  }
}
