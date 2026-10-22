import { linkedinProfileIdentifier, normalizeProfessionalProfileUrl } from "@/lib/professional-profile"

export type LushaIdentityEvidence = {
  kind: "LUSHA_CONTACT_IDENTITY"
  version: 1
  returnedCount: number
  contactId: string
  requestedProfileUrl: string
  returnedProfileUrl: string
  returnedName: string
  returnedCompany: string
  returnedTitle: string
  emailAvailable: boolean | null
  phoneAvailable: boolean | null
  identityReason: string
  providerStatus: string
  providerReportedCredits: number | null
}

export function lushaIdentityEvidence(input: Omit<LushaIdentityEvidence, "kind" | "version">): LushaIdentityEvidence {
  return { kind: "LUSHA_CONTACT_IDENTITY", version: 1, ...input }
}

export function parseLushaIdentityEvidence(value: string): LushaIdentityEvidence | null {
  try {
    const item: unknown = JSON.parse(value)
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    if (row.kind !== "LUSHA_CONTACT_IDENTITY" || row.version !== 1) return null
    if (!["contactId", "requestedProfileUrl", "returnedProfileUrl", "returnedName", "returnedCompany", "returnedTitle", "identityReason", "providerStatus"].every(key => typeof row[key] === "string")) return null
    if (!Number.isSafeInteger(row.returnedCount) || Number(row.returnedCount) < 1) return null
    if (![null, true, false].includes(row.emailAvailable as null | boolean) || ![null, true, false].includes(row.phoneAvailable as null | boolean)) return null
    if (row.providerReportedCredits !== null && (typeof row.providerReportedCredits !== "number" || !Number.isSafeInteger(row.providerReportedCredits) || row.providerReportedCredits < 0)) return null
    return row as LushaIdentityEvidence
  } catch { return null }
}

export function lushaIdentityApprovalEligible(evidence: LushaIdentityEvidence, savedProfileUrl: string, currentContactId: string) {
  const saved = linkedinProfileIdentifier(savedProfileUrl)
  return Boolean(evidence.contactId.trim()) && !currentContactId.trim()
    && evidence.returnedCount === 1
    && evidence.providerStatus === "success" && evidence.identityReason === "PROFILE_URL_MATCH"
    && Boolean(saved) && saved === linkedinProfileIdentifier(evidence.requestedProfileUrl)
    && saved === linkedinProfileIdentifier(evidence.returnedProfileUrl)
    && Boolean(normalizeProfessionalProfileUrl(evidence.returnedProfileUrl))
}

/** The reviewed identity and uniqueness conditions execute in the same SQLite UPDATE. */
export const LUSHA_REVIEWED_ATTACH_ID_SQL = `
  UPDATE alumni SET lusha_person_id=?, updated_by=?, updated_at=?, record_version=record_version+1,
    last_mutation_request_key=?
  WHERE id=? AND lusha_person_id='' AND linkedin_url=? AND record_version=?
    AND EXISTS (
      SELECT 1 FROM provider_refresh_reviews r JOIN provider_response_history h ON h.id=r.provider_response_id
      WHERE r.id=? AND r.alumnus_id=alumni.id AND r.status='Pending identity review'
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.kind') END='LUSHA_CONTACT_IDENTITY'
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.contactId') END=?
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.requestedProfileUrl') END=?
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.returnedProfileUrl') END=?
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.identityReason') END='PROFILE_URL_MATCH'
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.providerStatus') END='success'
        AND CASE WHEN json_valid(r.proposed_changes_json) THEN json_extract(r.proposed_changes_json,'$.returnedCount') END=1
        AND h.id=? AND h.alumnus_id=alumni.id AND h.provider='lusha' AND h.operation='Contact Search Preview'
        AND h.mode='live' AND h.status='review_required' AND h.result_count=1
    )
    AND NOT EXISTS (
      SELECT 1 FROM alumni other WHERE other.id<>alumni.id AND other.lusha_person_id=?
    )
    AND NOT EXISTS (
      SELECT 1 FROM alumni other WHERE other.id<>alumni.id
        AND lower(trim(other.linkedin_url))=lower(trim(alumni.linkedin_url))
    )
    AND 1=(
      SELECT count(*) FROM provider_refresh_reviews other_review
      WHERE other_review.status='Pending identity review'
        AND CASE WHEN json_valid(other_review.proposed_changes_json) THEN json_extract(other_review.proposed_changes_json,'$.kind') END='LUSHA_CONTACT_IDENTITY'
        AND CASE WHEN json_valid(other_review.proposed_changes_json) THEN json_extract(other_review.proposed_changes_json,'$.contactId') END=?
    )
  RETURNING id
`

export const LUSHA_APPROVE_REVIEW_SQL = `
  UPDATE provider_refresh_reviews SET status='Approved identity',reviewed_by=?,reviewed_at=?
  WHERE id=? AND status='Pending identity review'
    AND EXISTS (SELECT 1 FROM alumni WHERE id=? AND lusha_person_id=? AND last_mutation_request_key=?)
  RETURNING id
`

export const LUSHA_COMPLETE_REVIEWED_HISTORY_SQL = `
  UPDATE provider_response_history SET status='success',
    response_summary=response_summary || ' Stable contact ID associated only after explicit Admin identity review.'
  WHERE id=? AND status='review_required'
    AND EXISTS (SELECT 1 FROM provider_refresh_reviews WHERE id=? AND status='Approved identity')
  RETURNING id
`

export const LUSHA_RECORD_IDENTITY_CHANGE_SQL = `
  INSERT INTO field_change_history
    (alumnus_id,field,old_value,new_value,source,provider_action,credits_charged,initiated_by,mutation_request_key)
  SELECT ?, 'lushaPersonId', '', ?, 'Lusha', 'Admin identity review', 0, ?, ?
  WHERE EXISTS (SELECT 1 FROM provider_refresh_reviews WHERE id=? AND status='Approved identity')
  RETURNING id
`

export const LUSHA_REJECT_REVIEW_SQL = `
  UPDATE provider_refresh_reviews SET status='Rejected identity',reviewed_by=?,reviewed_at=?
  WHERE id=? AND status IN ('Pending identity review','Identity exception')
    AND CASE WHEN json_valid(proposed_changes_json) THEN json_extract(proposed_changes_json,'$.kind') END='LUSHA_CONTACT_IDENTITY'
  RETURNING id
`
