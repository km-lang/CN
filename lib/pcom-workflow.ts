// Presentation policy; retained APIs still enforce their own permissions.
export const ACTIVE_WORKSPACE_TABS = ["overview", "data-import", "directory", "companies", "enrichment", "admin"] as const
export function activeWorkspaceUrl(href: string) {
  const url = new URL(href)
  if (!ACTIVE_WORKSPACE_TABS.includes((url.searchParams.get("tab") || "overview") as typeof ACTIVE_WORKSPACE_TABS[number])) url.searchParams.set("tab", "directory")
  for (const key of ["compose", "alumnusId", "returnAlumnusId", "returnTab", "engagementEventId", "view"]) url.searchParams.delete(key)
  return url.href
}
export const MISSING_COMPANY_FILTER = "Missing current company"
export function missingProfessionalValue(value: unknown) {
  return !String(value ?? "").trim() || /^(?:unknown|not recorded|company not recorded|role not recorded|unavailable|n\/a|-)$/i.test(String(value).trim())
}
type ReviewPerson = {
  company?: string; title?: string; linkedinUrl?: string; providerFreshnessAt?: string;
  professionalDataStatus?: string; professionalReviewedAt?: string;
  verification?: { currentCompany?: string; designation?: string; profileMatch?: string };
  profileProposals?: Array<{field: string; status: string; proposedValue: string}>;
  employmentHistory?: Array<{ originalCompanyName: string; originalJobTitle: string; isCurrent: boolean; isDeleted: boolean; observedAt: string }>;
}
export function professionalReviewStatus(person: ReviewPerson, now = Date.now()) {
  const missing = [missingProfessionalValue(person.company) ? "Current company" : "", missingProfessionalValue(person.title) ? "Current designation" : "", missingProfessionalValue(person.linkedinUrl) ? "Professional-profile URL" : ""].filter(Boolean)
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")
  const conflict = /conflict|mismatch/i.test(person.professionalDataStatus || "") || person.verification?.profileMatch === "Mismatch"
    || Boolean(person.profileProposals?.some(item => item.status === "PENDING" && ["company", "title", "linkedinUrl"].includes(item.field)))
    || Boolean(person.employmentHistory?.some(item => item.isCurrent && !item.isDeleted && !missingProfessionalValue(item.originalCompanyName) && !missingProfessionalValue(person.company) && norm(item.originalCompanyName) !== norm(person.company!)))
  const observed = Date.parse(person.providerFreshnessAt || "")
  const reviewed = Date.parse(person.professionalReviewedAt || "")
  const oldObservation = Number.isFinite(observed) && now - observed > 180 * 86_400_000 && (!Number.isFinite(reviewed) || reviewed < observed)
  const outdated = person.verification?.currentCompany === "Possibly outdated" || person.verification?.designation === "Possibly outdated" || oldObservation
  const recent = Number.isFinite(reviewed) && reviewed <= now && now - reviewed <= 180 * 86_400_000 && person.verification?.currentCompany === "Verified" && ["Verified", "Likely"].includes(person.verification?.designation || "") && person.verification?.profileMatch === "Confirmed"
  const statuses = [...(missing.length ? ["MISSING DATA"] : []), ...(conflict ? ["CONFLICTING EVIDENCE"] : []), ...(outdated ? ["POTENTIALLY OUTDATED"] : [])]
  if (!statuses.length) statuses.push(recent ? "VERIFIED / RECENTLY REVIEWED" : "REVIEW REQUIRED")
  return { status: missingProfessionalValue(person.company) ? "MISSING DATA" : conflict ? "CONFLICTING EVIDENCE" : outdated ? "POTENTIALLY OUTDATED" : statuses[0], statuses, missing, conflict, outdated, reviewedAt: recent ? person.professionalReviewedAt : "", note: oldObservation ? "The stored provider observation is older than 180 days. This is a review prompt, not proof of an employment change." : "Employment changes require source evidence and authorized human review. A record edit or provider fetch alone is not verification." }
}
