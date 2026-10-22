export type LushaContactReviewEvidence = {
  kind: "LUSHA_CONTACT_FIELD"
  version: 1
  channel: "email" | "phone"
  contactId: string
  value: string
  previousValue: string
  alumnusRecordVersion: number
}

export function parseLushaContactReview(value: string): LushaContactReviewEvidence | null {
  try {
    const item: unknown = JSON.parse(value)
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    if (row.kind !== "LUSHA_CONTACT_FIELD" || row.version !== 1) return null
    if (row.channel !== "email" && row.channel !== "phone") return null
    if (typeof row.contactId !== "string" || !row.contactId.trim() || typeof row.value !== "string" || !row.value.trim() || typeof row.previousValue !== "string") return null
    if (!Number.isSafeInteger(row.alumnusRecordVersion) || Number(row.alumnusRecordVersion) < 1) return null
    return row as LushaContactReviewEvidence
  } catch { return null }
}

export function lushaContactValueValid(channel: "email" | "phone", value: string) {
  const trimmed = value.trim()
  return channel === "email"
    ? trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    : trimmed.length <= 40 && /^\+?[0-9][0-9 ()-]{6,38}$/.test(trimmed)
}

/** Column names are selected only from this fixed map, never from request data. */
export function lushaContactApprovalSql(channel: "email" | "phone") {
  const column = channel === "email" ? "email" : "phone"
  const verification = channel === "email" ? "email_verification" : "phone_verification"
  const source = channel === "email" ? "email_source" : "phone_source"
  const retrieved = channel === "email" ? "email_retrieved_at" : "phone_retrieved_at"
  const operation = channel === "email" ? "Email Reveal" : "Phone Reveal"
  return `UPDATE alumni SET ${column}=?, ${verification}='Unverified', ${source}='Lusha', ${retrieved}=?,
    last_lusha_enrichment=?, updated_by=?, updated_at=?, record_version=record_version+1,
    last_mutation_request_key=?
    WHERE id=? AND lusha_person_id=? AND record_version=? AND ${column}=?
      AND ${verification}<>'Verified' AND intake_status<>'PROVISIONAL'
      AND NOT EXISTS (SELECT 1 FROM alumni other WHERE other.id<>alumni.id AND other.${column}=? AND other.${column}<>'')
      AND NOT EXISTS (SELECT 1 FROM alumni_privacy_controls p
        WHERE p.alumnus_id=alumni.id AND lower(p.general_contact_status)='do not contact')
      AND EXISTS (SELECT 1 FROM provider_refresh_reviews r
        JOIN provider_response_history h ON h.id=r.provider_response_id
        WHERE r.id=? AND r.alumnus_id=alumni.id AND r.status='Pending contact review'
          AND json_valid(r.proposed_changes_json)
          AND json_extract(r.proposed_changes_json,'$.kind')='LUSHA_CONTACT_FIELD'
          AND json_extract(r.proposed_changes_json,'$.channel')='${channel}'
          AND json_extract(r.proposed_changes_json,'$.contactId')=alumni.lusha_person_id
          AND json_extract(r.proposed_changes_json,'$.value')=?
          AND json_extract(r.proposed_changes_json,'$.previousValue')=alumni.${column}
          AND json_extract(r.proposed_changes_json,'$.alumnusRecordVersion')=alumni.record_version
          AND h.provider='lusha' AND h.operation='${operation}' AND h.mode='live'
          AND h.alumnus_id=alumni.id AND h.status='review_required')
      AND EXISTS (SELECT 1 FROM provider_refresh_reviews identity_review
        WHERE identity_review.alumnus_id=alumni.id AND identity_review.status='Approved identity'
          AND json_valid(identity_review.proposed_changes_json)
          AND json_extract(identity_review.proposed_changes_json,'$.kind')='LUSHA_CONTACT_IDENTITY'
          AND json_extract(identity_review.proposed_changes_json,'$.contactId')=alumni.lusha_person_id)
    RETURNING id`
}

export const LUSHA_APPROVE_CONTACT_REVIEW_SQL = `UPDATE provider_refresh_reviews
  SET status='Applied',reviewed_by=?,reviewed_at=?
  WHERE id=? AND status='Pending contact review'
    AND EXISTS (SELECT 1 FROM alumni WHERE id=? AND last_mutation_request_key=?)
  RETURNING id`

export const LUSHA_REJECT_CONTACT_REVIEW_SQL = `UPDATE provider_refresh_reviews
  SET status='Rejected contact',reviewed_by=?,reviewed_at=?
  WHERE id=? AND status IN ('Pending contact review','Contact exception')
    AND json_valid(proposed_changes_json)
    AND json_extract(proposed_changes_json,'$.kind')='LUSHA_CONTACT_FIELD'
  RETURNING id`
