import { inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, alumniSourceObservations, coresignalWebhookEvents, externalDiscoveryCandidateEvidence, externalDiscoveryResults, fieldChangeHistory, providerCollectionAttempts, providerRefreshReviews, providerResponseHistory, provisionalAlumniIntakes } from "@/db/schema"
import { compareRetainedObservations, intelligenceSnapshotEntry, retainedProfessionalFields, type AlumniHistoryEntry, type RetainedIntelligenceSnapshotPage } from "@/lib/alumni-history"
import { presentProviderHistoryCollectEvidence } from "@/lib/coresignal-collect-only"
import { intelligenceErrorResponse, intelligenceRequest } from "@/lib/intelligence-service.server"
import { accessErrorResponse, authorizeRequest } from "@/lib/security"

type IndexRow = { row_kind: string; row_id: number; occurred_at: string; previous_kind?: string | null; previous_id?: number | null; previous_at?: string | null }

function pageNumber(value: string | null) {
  const number = Number(value ?? "1")
  return Number.isSafeInteger(number) && number >= 1 && number <= 1000 ? number : null
}

function proposedFields(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return {}
    return retainedProfessionalFields(Object.fromEntries(parsed.filter(item => item && typeof item === "object" && typeof item.field === "string" && typeof item.newValue === "string").map(item => [item.field, item.newValue])))
  } catch { return {} }
}

function intakeObservations(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const item = parsed as Record<string, unknown>
    return retainedProfessionalFields({ company: item.currentCompany, title: item.rawTitle || item.role, location: item.location,
      programme: item.educationProgramme, graduationYear: item.graduationYear, seniority: item.seniority })
  } catch { return {} }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI")
    const alumnusId = Number((await params).id)
    const query = new URL(request.url).searchParams
    const page = pageNumber(query.get("page"))
    const source = query.get("source") ?? "corporate-network"
    if (source !== "corporate-network" && source !== "intelligence") return Response.json({ error: "Unsupported history source." }, { status: 400 })
    if (!Number.isSafeInteger(alumnusId) || alumnusId < 1 || !page) return Response.json({ error: "A valid alumnus ID and history page are required." }, { status: 400 })
    const db = getDb()
    const person = await db.select({ id: alumni.id, createdAt: alumni.createdAt, source: alumni.source, discoverySource: alumni.discoverySource,
      company: alumni.company, title: alumni.title, location: alumni.location, programme: alumni.programme, graduationYear: alumni.graduationYear, seniority: alumni.seniority }).from(alumni).where(sql`${alumni.id} = ${alumnusId}`).limit(1)
    if (!person.length) return Response.json({ error: "Alumnus not found." }, { status: 404 })
    if (source === "intelligence") {
      let remote: RetainedIntelligenceSnapshotPage
      try {
        remote = await intelligenceRequest<RetainedIntelligenceSnapshotPage>(context, `/v1/cn/alumni/${alumnusId}/history?page=${page}`)
      } catch (error) {
        if ((error as { status?: number }).status === 404) return Response.json({ page, pageSize: 20, hasMore: false, entries: [], comparisons: {}, limitations: "No exact standalone intelligence mapping or retained snapshots are available." }, { headers: { "cache-control": "no-store" } })
        return intelligenceErrorResponse(error)
      }
      if (remote.sourceId !== `cn:${alumnusId}` || remote.page !== page || remote.pageSize !== 20 || !Array.isArray(remote.snapshots) || remote.snapshots.length > 20) return Response.json({ error: "Intelligence history identity or page contract did not match." }, { status: 502 })
      const entries = remote.snapshots.map(snapshot => intelligenceSnapshotEntry(snapshot, remote.sourceId))
      const canonical = retainedProfessionalFields(person[0] as Record<string, unknown>)
      let older: AlumniHistoryEntry | null = null
      if (remote.hasMore) {
        const next = await intelligenceRequest<RetainedIntelligenceSnapshotPage>(context, `/v1/cn/alumni/${alumnusId}/history?page=${page + 1}`)
        if (next.sourceId !== remote.sourceId || next.page !== page + 1 || next.pageSize !== 20 || !Array.isArray(next.snapshots) || next.snapshots.length < 1 || next.snapshots.length > 20) return Response.json({ error: "Intelligence history lookahead did not match the exact mapped page." }, { status: 502 })
        older = intelligenceSnapshotEntry(next.snapshots[0], next.sourceId)
      }
      const comparisons = Object.fromEntries(entries.map((entry, index) => [entry.key, compareRetainedObservations(entry, entries[index + 1] ?? older, canonical)]))
      return Response.json({ page, pageSize: 20, hasMore: remote.hasMore, entries, comparisons, limitations: "Standalone snapshots are read through an exact authenticated cn:<id> mapping. Comparisons identify retained snapshot IDs, including the next page boundary." }, { headers: { "cache-control": "no-store" } })
    }
    const pageSize = 20
    const offset = (page - 1) * pageSize
    const indexed = await db.all<IndexRow>(sql`
      with source_kinds(row_kind) as (values ('SOURCE_BASELINE'), ('SOURCE_OBSERVATION')),
      primary_history as (
        select k.row_kind,
          case when k.row_kind = 'SOURCE_BASELINE' then a.id else s.id end as row_id,
          case when k.row_kind = 'SOURCE_BASELINE' then a.created_at else s.created_at end as occurred_at
          from alumni a cross join source_kinds k
          left join alumni_source_observations s on s.alumnus_id = a.id and k.row_kind = 'SOURCE_OBSERVATION'
          where a.id = ${alumnusId} and (k.row_kind = 'SOURCE_BASELINE' or s.id is not null)
        union all select 'DISCOVERY_OBSERVATION', id, created_at from external_discovery_results where linked_internal_alumnus_id = ${alumnusId}
        union all select 'PROVISIONAL_INTAKE', id, created_at from provisional_alumni_intakes where alumnus_id = ${alumnusId}
        union all select 'PROVIDER_ATTEMPT', id, created_at from provider_response_history where alumnus_id = ${alumnusId}
        union all select 'PROVIDER_REVIEW', id, created_at from provider_refresh_reviews where alumnus_id = ${alumnusId}
      ), secondary_history as (
        select 'CAREER_OBSERVATION' as row_kind, id as row_id, observed_at as occurred_at from alumni_employment_evidence where alumnus_id = ${alumnusId}
        union all select 'BRIGHT_SNAPSHOT', id, created_at from provider_collection_attempts where alumnus_id = ${alumnusId} and provider = 'brightdata' and evidence_json != ''
        union all select 'CANONICAL_CHANGE', id, created_at from field_change_history where alumnus_id = ${alumnusId}
        union all select 'REVIEW_DECISION', id, created_at from alumni_profile_change_proposals where alumnus_id = ${alumnusId}
        union all select 'DISCOVERY_REVIEW', e.id, e.reviewed_at from external_discovery_candidate_evidence e inner join external_discovery_results r on r.id = e.result_id where r.linked_internal_alumnus_id = ${alumnusId}
      )
      , webhook_history as (
        select 'WEBHOOK_NOTIFICATION' as row_kind, id as row_id, received_at as occurred_at
        from coresignal_webhook_events where alumnus_id = ${alumnusId}
      )
      , history as (select * from primary_history union all select * from secondary_history union all select * from webhook_history)
      , observation_order as (
        select row_kind, row_id,
          lag(row_kind) over (order by datetime(occurred_at), occurred_at, row_kind, row_id) as previous_kind,
          lag(row_id) over (order by datetime(occurred_at), occurred_at, row_kind, row_id) as previous_id,
          lag(occurred_at) over (order by datetime(occurred_at), occurred_at, row_kind, row_id) as previous_at
        from history where row_kind in ('SOURCE_OBSERVATION', 'DISCOVERY_OBSERVATION', 'PROVISIONAL_INTAKE', 'PROVIDER_ATTEMPT', 'PROVIDER_REVIEW', 'BRIGHT_SNAPSHOT')
          and (row_kind != 'PROVIDER_ATTEMPT' or exists (select 1 from provider_response_history p where p.id = row_id and instr(p.response_summary, '[coresignal-collect-evidence:v1]') > 0))
          and (row_kind != 'PROVIDER_REVIEW' or exists (select 1 from provider_refresh_reviews p where p.id = row_id and p.proposed_changes_json != '[]'))
          and (row_kind != 'PROVISIONAL_INTAKE' or exists (select 1 from provisional_alumni_intakes p where p.id = row_id and p.provider_observations_json != '{}' and p.provider_observations_json != ''))
      )
      select h.row_kind, h.row_id, h.occurred_at, o.previous_kind, o.previous_id, o.previous_at
      from history h left join observation_order o on o.row_kind = h.row_kind and o.row_id = h.row_id
      order by datetime(h.occurred_at) desc, h.occurred_at desc, h.row_kind desc, h.row_id desc limit ${pageSize + 1} offset ${offset}`)
    const selected = indexed.slice(0, pageSize)
    const hydrationRows = [...selected]
    for (const row of selected) if (row.previous_kind && row.previous_id && row.previous_at && !hydrationRows.some(item => item.row_kind === row.previous_kind && item.row_id === row.previous_id)) hydrationRows.push({ row_kind: row.previous_kind, row_id: row.previous_id, occurred_at: row.previous_at })
    const ids = (kind: string) => hydrationRows.filter(row => row.row_kind === kind).map(row => row.row_id)
    const [sources, discoveries, intakes, attempts, reviews, careers, brightSnapshots, changes, proposals, evidence, webhookEvents] = await Promise.all([
      ids("SOURCE_OBSERVATION").length ? db.select().from(alumniSourceObservations).where(inArray(alumniSourceObservations.id, ids("SOURCE_OBSERVATION"))) : [],
      ids("DISCOVERY_OBSERVATION").length ? db.select().from(externalDiscoveryResults).where(inArray(externalDiscoveryResults.id, ids("DISCOVERY_OBSERVATION"))) : [],
      ids("PROVISIONAL_INTAKE").length ? db.select().from(provisionalAlumniIntakes).where(inArray(provisionalAlumniIntakes.id, ids("PROVISIONAL_INTAKE"))) : [],
      ids("PROVIDER_ATTEMPT").length ? db.select().from(providerResponseHistory).where(inArray(providerResponseHistory.id, ids("PROVIDER_ATTEMPT"))) : [],
      ids("PROVIDER_REVIEW").length ? db.select().from(providerRefreshReviews).where(inArray(providerRefreshReviews.id, ids("PROVIDER_REVIEW"))) : [],
      ids("CAREER_OBSERVATION").length ? db.select().from(alumniEmploymentEvidence).where(inArray(alumniEmploymentEvidence.id, ids("CAREER_OBSERVATION"))) : [],
      ids("BRIGHT_SNAPSHOT").length ? db.select().from(providerCollectionAttempts).where(inArray(providerCollectionAttempts.id, ids("BRIGHT_SNAPSHOT"))) : [],
      ids("CANONICAL_CHANGE").length ? db.select().from(fieldChangeHistory).where(inArray(fieldChangeHistory.id, ids("CANONICAL_CHANGE"))) : [],
      ids("REVIEW_DECISION").length ? db.select().from(alumniProfileChangeProposals).where(inArray(alumniProfileChangeProposals.id, ids("REVIEW_DECISION"))) : [],
      ids("DISCOVERY_REVIEW").length ? db.select().from(externalDiscoveryCandidateEvidence).where(inArray(externalDiscoveryCandidateEvidence.id, ids("DISCOVERY_REVIEW"))) : [],
      ids("WEBHOOK_NOTIFICATION").length ? db.select().from(coresignalWebhookEvents).where(inArray(coresignalWebhookEvents.id, ids("WEBHOOK_NOTIFICATION"))) : [],
    ])
    const byId = <T extends { id: number }>(items: T[]) => new Map(items.map(item => [item.id, item]))
    const sourceById = byId(sources), discoveryById = byId(discoveries), intakeById = byId(intakes), attemptById = byId(attempts), reviewById = byId(reviews)
    const careerById = byId(careers), brightById = byId(brightSnapshots), changeById = byId(changes), proposalById = byId(proposals), evidenceById = byId(evidence), webhookById = byId(webhookEvents)
    const hydratedEntries: AlumniHistoryEntry[] = hydrationRows.flatMap<AlumniHistoryEntry>(row => {
      const base = { key: `${row.row_kind}:${row.row_id}`, occurredAt: row.occurred_at, requestReference: "", observed: {} as Record<string, string> }
      if (row.row_kind === "SOURCE_BASELINE") return [{ ...base, kind: "SOURCE_BASELINE", source: person[0].source || person[0].discoverySource || "Unknown", outcome: "Source attribution", verification: "Original field-level baseline not retained", details: "This is the current source label and creation time, not a reconstructed import snapshot." }]
      if (row.row_kind === "WEBHOOK_NOTIFICATION") {
        const item = webhookById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "WEBHOOK_NOTIFICATION", source: "Coresignal Base Employee Experience", outcome: item.status, requestReference: `Notification #${item.id} · Subscription #${item.subscriptionId}`, verification: "Change signal only; no company, title, or alumni fact verified", details: `${item.changeType}${item.changedFieldsJson !== "[]" ? ` · changed fields ${item.changedFieldsJson}` : ""}. A separate approved profile Collect is needed to observe the changed facts.`, observed: {} }]
      }
      if (row.row_kind === "SOURCE_OBSERVATION") {
        const item = sourceById.get(row.row_id); if (!item) return []
        let observed: Record<string, string> = {}
        try { const parsed: unknown = JSON.parse(item.observedJson); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) observed = retainedProfessionalFields(parsed as Record<string, unknown>) } catch { /* Preserve source attribution without claiming unreadable fields. */ }
        return [{ ...base, kind: "SOURCE_OBSERVATION", source: `Institutional import · ${item.sourceSystem || "unspecified"}`, outcome: "Source fields retained", requestReference: `${item.filename} · row ${item.sourceRowKey}`, verification: "Imported claim; not independently verified", details: `Imported by ${item.importedBy}${item.sourceDate ? ` · source date ${item.sourceDate}` : ""}. Contact fields are not retained in this history snapshot.`, observed }]
      }
      if (row.row_kind === "DISCOVERY_OBSERVATION") {
        const item = discoveryById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "DISCOVERY_OBSERVATION", source: item.provider, outcome: item.reviewStatus, requestReference: `Search #${item.searchId} · Result #${item.id}`, verification: "Provider observation; query match is not independent alumni verification", details: item.reviewNote || item.matchStatus,
          observed: retainedProfessionalFields({ company: item.currentCompany, title: item.rawTitle || item.role, location: item.location, programme: item.educationProgramme, graduationYear: item.graduationYear || null, seniority: item.seniority }) }]
      }
      if (row.row_kind === "PROVISIONAL_INTAKE") {
        const item = intakeById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "PROVISIONAL_INTAKE", source: item.provider, outcome: "Added provisionally", requestReference: `Search #${item.searchId} · Result #${item.discoveryResultId}`, verification: "Alumni and current-employment facts unverified", details: `Recorded by ${item.intakeActorName}; original query constraints are retained separately and are not canonical facts.`, observed: intakeObservations(item.providerObservationsJson) }]
      }
      if (row.row_kind === "PROVIDER_ATTEMPT") {
        const item = attemptById.get(row.row_id); if (!item) return []
        const presented = presentProviderHistoryCollectEvidence(item)
        const collect = presented.collectEvidence?.state === "RETAINED" ? presented.collectEvidence.evidence : null
        const current = collect?.employment.find(position => position.current)
        return [{ ...base, kind: "PROVIDER_ATTEMPT", source: item.provider, outcome: collect?.reviewState === "NO_CHANGE" ? "Evidence retained · no observed change" : item.status, requestReference: `Provider request #${item.id}`, verification: collect?.reviewState === "NO_CHANGE" ? "Retained Collect observation; no correction proposed" : collect ? "Retained Collect observation; human review required" : "Request outcome only; no complete response snapshot retained here", details: item.errorMessage || presented.responseSummary || "No response summary retained",
          observed: collect ? retainedProfessionalFields({ company: current?.company, title: current?.title, location: collect.location, programme: collect.education[0]?.programme, graduationYear: collect.education[0]?.endYear }) : {},
          ...(collect ? { experience: collect.employment.map(position => ({ company: position.company || null, title: position.title || null, startDate: position.startDate || null, endDate: position.endDate || null, current: position.current })),
            education: collect.education.map(item => ({ institution: item.institution || null, degree: item.programme || null, startYear: item.startYear ? String(item.startYear) : null, endYear: item.endYear ? String(item.endYear) : null })) } : {}) }]
      }
      if (row.row_kind === "BRIGHT_SNAPSHOT") {
        const item = brightById.get(row.row_id); if (!item) return []
        let parsed: Record<string, unknown> = {}
        try { const value: unknown = JSON.parse(item.evidenceJson); if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown> } catch { /* The attempt remains visible without unparseable observation fields. */ }
        const positions = Array.isArray(parsed.experience) ? parsed.experience.slice(0, 20) : []
        const schools = Array.isArray(parsed.education) ? parsed.education.slice(0, 20) : []
        const experience = positions.filter(value => value && typeof value === "object").map(value => { const position = value as Record<string, unknown>; return { company: typeof position.company === "string" ? position.company : null, title: typeof position.title === "string" ? position.title : null, startDate: typeof position.startDate === "string" ? position.startDate : null, endDate: typeof position.endDate === "string" ? position.endDate : null, current: typeof position.current === "boolean" ? position.current : null } })
        const education = schools.filter(value => value && typeof value === "object").map(value => { const school = value as Record<string, unknown>; return { institution: typeof school.institution === "string" ? school.institution : null, degree: typeof school.degree === "string" ? school.degree : null, startYear: typeof school.startYear === "string" ? school.startYear : null, endYear: typeof school.endYear === "string" ? school.endYear : null } })
        return [{ ...base, kind: "PROVIDER_SNAPSHOT", source: "Bright Data", outcome: item.status, requestReference: item.providerJobId ? `Snapshot ${item.providerJobId}` : `Collection attempt #${item.id}`, verification: "Retained profile observation; not independently verified or canonical", details: `One-profile request #${item.id} · ${item.errorCategory || "No recorded error"}`,
          observed: retainedProfessionalFields({ company: parsed.currentCompany, title: parsed.currentTitle, location: parsed.location }), experience, education }]
      }
      if (row.row_kind === "PROVIDER_REVIEW") {
        const item = reviewById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "PROVIDER_REVIEW", source: "Professional profile refresh", outcome: item.status, requestReference: `Provider request #${item.providerResponseId}`, verification: item.status === "Applied" ? "Selected fields accepted" : "Proposed fields only; not canonical", details: item.reviewedBy ? `Reviewed by ${item.reviewedBy}` : "Awaiting review", observed: proposedFields(item.proposedChangesJson) }]
      }
      if (row.row_kind === "CAREER_OBSERVATION") {
        const item = careerById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "CAREER_OBSERVATION", source: item.evidenceSource, outcome: item.reviewerStatus, requestReference: item.providerResponseId ? `Provider request #${item.providerResponseId}` : item.discoveryResultId ? `Discovery result #${item.discoveryResultId}` : "", verification: item.verificationStatus, details: `${item.isCurrent ? "Current-role claim" : "Historical-role claim"}${item.isDeleted ? " · deleted by source" : ""} · ${item.startDate || "?"}–${item.endDate || "?"}`, observed: retainedProfessionalFields({ company: item.originalCompanyName, title: item.originalJobTitle }) }]
      }
      if (row.row_kind === "CANONICAL_CHANGE") {
        const item = changeById.get(row.row_id); if (!item) return []
        return [{ ...base, kind: "CANONICAL_CHANGE", source: item.source, outcome: "Canonical field changed", requestReference: item.providerAction, verification: `Applied by ${item.initiatedBy}`, details: `${item.field}: ${item.oldValue || "Not recorded"} → ${item.newValue || "Cleared"}` }]
      }
      const proposal = row.row_kind === "REVIEW_DECISION" ? proposalById.get(row.row_id) : null
      if (proposal) return [{ ...base, kind: "REVIEW_DECISION", source: proposal.source, outcome: proposal.status, requestReference: `Profile proposal #${proposal.id}`, verification: proposal.reviewedBy || "Pending review", details: `${proposal.field}: ${proposal.oldValue || "Not recorded"} → ${proposal.proposedValue || "Cleared"}` }]
      const reviewed = row.row_kind === "DISCOVERY_REVIEW" ? evidenceById.get(row.row_id) : null
      if (reviewed) return [{ ...base, kind: "REVIEW_DECISION", source: reviewed.sourceProvenance, outcome: reviewed.reviewerDecision, requestReference: `Discovery result #${reviewed.resultId}`, verification: `Reviewed by ${reviewed.reviewerName}`, details: reviewed.verificationReason }]
      return []
    })
    const canonical = retainedProfessionalFields(person[0] as Record<string, unknown>)
    const byKey = new Map(hydratedEntries.map(entry => [entry.key, entry]))
    const entries = selected.flatMap(row => { const entry = byKey.get(`${row.row_kind}:${row.row_id}`); return entry ? [entry] : [] })
    const comparisons = Object.fromEntries(selected.flatMap(row => {
      const entry = byKey.get(`${row.row_kind}:${row.row_id}`)
      if (!entry || !Object.keys(entry.observed).length) return []
      const previous = row.previous_kind && row.previous_id ? byKey.get(`${row.previous_kind}:${row.previous_id}`) ?? null : null
      return [[entry.key, compareRetainedObservations(entry, previous, canonical)]]
    }))
    return Response.json({ page, pageSize, hasMore: indexed.length > pageSize, entries, comparisons, limitations: "Corporate Network retained evidence only. Legacy import baselines and Search #10 individual observations cannot be reconstructed. Future confirmed imports retain source fields; comparisons identify exact record IDs across pages." }, { headers: { "cache-control": "no-store" } })
  } catch (error) { return accessErrorResponse(error) ?? Response.json({ error: "Unable to load retained alumni history." }, { status: 500 }) }
}
