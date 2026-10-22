export type LushaGovernedOperation = "Contact Search Preview" | "Email Reveal" | "Phone Reveal"

const maximumEnvironmentKey: Record<LushaGovernedOperation, string> = {
  "Contact Search Preview": "LUSHA_SEARCH_MAX_APPLICATION_UNITS",
  "Email Reveal": "LUSHA_EMAIL_MAX_APPLICATION_UNITS",
  "Phone Reveal": "LUSHA_PHONE_MAX_APPLICATION_UNITS",
}

/** An operator-approved application reservation, never a claim about provider billing. */
export function lushaApplicationReservation(operation: LushaGovernedOperation, values: Record<string, string | undefined> = process.env) {
  const raw = values[maximumEnvironmentKey[operation]]?.trim() ?? ""
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) return null
  const value = Number(raw)
  return value <= 100 ? value : null
}

const entitlementEnvironmentKey: Record<LushaGovernedOperation, string> = {
  "Contact Search Preview": "LUSHA_SEARCH_ENTITLEMENT",
  "Email Reveal": "LUSHA_EMAIL_ENTITLEMENT",
  "Phone Reveal": "LUSHA_PHONE_ENTITLEMENT",
}

/** A live endpoint needs recorded account-specific entitlement; a key alone is not proof. */
export function lushaContactEntitlement(operation: LushaGovernedOperation, values: Record<string, string | undefined> = process.env) {
  return values[entitlementEnvironmentKey[operation]]?.trim().toLowerCase() === "confirmed"
    && Boolean(values.LUSHA_ENTITLEMENT_SOURCE?.trim())
    && /^\d{4}-\d{2}-\d{2}$/.test(values.LUSHA_ENTITLEMENT_VERIFIED_AT?.trim() ?? "")
}

/** Unknown provider balance is never silently interpreted as available credit. */
export function lushaBalanceCoversReservation(remaining: number | null, reservation: number) {
  return remaining !== null && Number.isSafeInteger(remaining) && remaining >= reservation
}

/**
 * SQLite's single INSERT statement serializes the duplicate, unknown-debit and
 * monthly-allowance checks with the claim. A failed/uncertain attempt retains
 * its reserved application units until explicit reconciliation; it is never
 * interpreted as a free provider operation.
 */
export const LUSHA_REQUEST_CLAIM_SQL = `
  INSERT INTO provider_response_history
    (provider, alumnus_id, alumnus_name, operation, mode, status, credits_used,
     application_units, provider_reported_credits, usage_state, result_count,
     request_summary, response_summary, requested_by)
  SELECT 'lusha', ?, ?, ?, 'live', 'in_progress', 0, ?, NULL,
         'reconciliation_required', 0, ?, 'Request claimed; provider outcome not yet known.', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_response_history
    WHERE provider='lusha' AND mode='live' AND alumnus_id=? AND operation=?
      AND status IN ('in_progress','success','no_match','review_required','ambiguous')
  )
    AND NOT EXISTS (
      SELECT 1 FROM provider_response_history
      WHERE provider='lusha' AND mode='live'
        AND datetime(created_at)>=datetime(?)
        AND usage_state='reconciliation_required'
    )
    AND ? + coalesce((
      SELECT sum(CASE WHEN application_units>0 THEN application_units ELSE credits_used END)
      FROM provider_response_history
      WHERE provider='lusha' AND mode='live' AND datetime(created_at)>=datetime(?)
    ),0) <= coalesce((SELECT monthly_credit_limit FROM provider_settings WHERE provider='lusha'),100)
  RETURNING id
`

/** Disposable local fixture only: no application reservation or provider charge. */
export const LUSHA_MOCK_REQUEST_CLAIM_SQL = `
  INSERT INTO provider_response_history
    (provider, alumnus_id, alumnus_name, operation, mode, status, credits_used,
     application_units, provider_reported_credits, usage_state, result_count,
     request_summary, response_summary, requested_by)
  SELECT 'lusha', ?, ?, ?, 'mock', 'in_progress', 0, 0, NULL,
         'not_applicable', 0, ?, 'Synthetic V3 fixture; no provider request.', ?
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_response_history
    WHERE provider='lusha' AND mode='mock' AND alumnus_id=? AND operation=?
      AND status IN ('in_progress','success','no_match','review_required','ambiguous')
  )
  RETURNING id
`

/** Atomic cross-alumnus identity fence without a schema change. */
export const LUSHA_ATTACH_ID_SQL = `
  UPDATE alumni SET lusha_person_id=?, updated_by=?, updated_at=?, record_version=record_version+1
  WHERE id=? AND (lusha_person_id='' OR lusha_person_id=?)
    AND NOT EXISTS (
      SELECT 1 FROM alumni AS other
      WHERE other.id<>? AND other.lusha_person_id=?
    )
  RETURNING id
`

export function lushaReportedChargeExceedsReservation(reported: number | null, reserved: number) {
  return reported !== null && reported > reserved
}
