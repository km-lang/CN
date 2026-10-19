# Coresignal Base Employee ES-DSL Preview capability evidence

Date: 2026-10-19 (Asia/Kolkata)

This record intentionally contains no API secret, Employee ID, name, profile URL, or raw provider payload.

## Controlled request

- Endpoint: `POST /cdapi/v2/employee_base/search/es_dsl/preview`
- Authentication: existing server-only key; value not retained here
- Education predicate: `education.institution_id=25919228` and `education.date_to_year=2011`
- Correlation: both terms were inside the same nested `education` query
- Page parameter: none
- Outbound Preview requests: `1`
- Retries: `0`
- Pagination: `0`
- Collect requests: `0`
- Fallback requests: `0`

## Sanitized response evidence

- HTTP status: `200`
- Top-level shape: array
- Preview records returned: `20`
- `x-total-results`: `927`
- `x-credits-remaining`: `4930`
- Education objects returned in Preview: no

The response verifies operational access for the tested key and acceptance of the correlated exact-year predicate. It does not prove degree award, person-level graduation evidence, identity, profile freshness, the truth of the provider-reported total, an exact request tariff, or permanent contractual entitlement.

The observed `4930` balance is a remaining-balance header, not a charge amount. Corporate Network has no persisted immediate pre-request provider balance for this standalone diagnostic, so exact cost must remain unknown.
