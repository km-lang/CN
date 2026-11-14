import { eq, inArray, sql } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniEmploymentEvidence, alumniProfileChangeProposals, alumniSourceObservations,
  coresignalWebhookEvents, externalDiscoveryCandidateEvidence, externalDiscoveryResults, fieldChangeHistory,
  providerCollectionAttempts, providerRefreshReviews, providerResponseHistory, provisionalAlumniIntakes } from "@/db/postgres/schema"

export type PostgresHistoryIndexRow = { row_kind: string; row_id: number; occurred_at: string; previous_kind: string | null; previous_id: number | null; previous_at: string | null }

export async function postgresHistoryPerson(id: number) {
  return getPostgresDb().select({ id: alumni.id, createdAt: alumni.createdAt, source: alumni.source, discoverySource: alumni.discoverySource,
    company: alumni.company, title: alumni.title, location: alumni.location, programme: alumni.programme, graduationYear: alumni.graduationYear,
    seniority: alumni.seniority }).from(alumni).where(eq(alumni.id, id)).limit(1)
}

/** Use validated timestamp input only; stored legacy text can be malformed. */
export async function postgresHistoryIndex(alumnusId: number, limit: number, offset: number): Promise<PostgresHistoryIndexRow[]> {
  const result = await getPostgresDb().execute<PostgresHistoryIndexRow>(sql`
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
      union all select 'DISCOVERY_REVIEW', e.id, e.reviewed_at from external_discovery_candidate_evidence e join external_discovery_results r on r.id = e.result_id where r.linked_internal_alumnus_id = ${alumnusId}
    ), webhook_history as (
      select 'WEBHOOK_NOTIFICATION' as row_kind, id as row_id, received_at as occurred_at from coresignal_webhook_events where alumnus_id = ${alumnusId}
    ), history as (select * from primary_history union all select * from secondary_history union all select * from webhook_history),
    normalized as (
      select h.*, case when pg_input_is_valid(h.occurred_at, 'timestamptz') then
        case when h.occurred_at ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then h.occurred_at::timestamptz
          else h.occurred_at::timestamp at time zone 'UTC' end end as occurred_instant
      from history h
    ), observation_order as (
      select n.row_kind, n.row_id,
        lag(n.row_kind) over (order by n.occurred_instant, n.occurred_at, n.row_kind, n.row_id) as previous_kind,
        lag(n.row_id) over (order by n.occurred_instant, n.occurred_at, n.row_kind, n.row_id) as previous_id,
        lag(n.occurred_at) over (order by n.occurred_instant, n.occurred_at, n.row_kind, n.row_id) as previous_at
      from normalized n where n.row_kind in ('SOURCE_OBSERVATION', 'DISCOVERY_OBSERVATION', 'PROVISIONAL_INTAKE', 'PROVIDER_ATTEMPT', 'PROVIDER_REVIEW', 'BRIGHT_SNAPSHOT')
        and (n.row_kind != 'PROVIDER_ATTEMPT' or exists (select 1 from provider_response_history p where p.id = n.row_id and position('[coresignal-collect-evidence:v1]' in p.response_summary) > 0))
        and (n.row_kind != 'PROVIDER_REVIEW' or exists (select 1 from provider_refresh_reviews p where p.id = n.row_id and p.proposed_changes_json != '[]'))
        and (n.row_kind != 'PROVISIONAL_INTAKE' or exists (select 1 from provisional_alumni_intakes p where p.id = n.row_id and p.provider_observations_json != '{}' and p.provider_observations_json != ''))
    )
    select h.row_kind, h.row_id, h.occurred_at, o.previous_kind, o.previous_id, o.previous_at
    from normalized h left join observation_order o on o.row_kind = h.row_kind and o.row_id = h.row_id
    order by h.occurred_instant desc nulls last, h.occurred_at desc, h.row_kind desc, h.row_id desc
    limit ${limit} offset ${offset}`)
  return result.rows
}

export async function postgresHistoryHydration(ids: (kind: string) => number[]) {
  const db = getPostgresDb()
  return Promise.all([
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
  ] as const)
}
