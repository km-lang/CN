import { FIXED_ALUMNI_SCHOOL, matchesDiscoverySeniorities, normalizeFunction, normalized, type DiscoveryFilters } from "@/lib/alumni-search"
import { discoveryQualification } from "@/lib/discovery-qualification"
import { titleSeniority } from "@/lib/discovery-execution"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"

export const EVIDENCE_FIELDS = ["identity", "institution", "alumniStatus", "graduationYear", "programme", "company", "role", "function", "seniority", "location"] as const
export type EvidenceField = typeof EVIDENCE_FIELDS[number]
export type EvidenceDecision = "MATCH" | "MISMATCH" | "UNVERIFIED" | "NOT_REQUESTED"
export type EvidenceDecisions = Record<EvidenceField, EvidenceDecision>
export type CandidateObservation = {
  sourceType: string
  sourceUrl: string
  profileUrl: string
  observedInstitution: string
  educationStartYear: number | null
  educationEndYear: number | null
  graduationYear: number | null
  programme: string
  currentCompany: string
  currentDesignation: string
  seniority: string
  location: string
  verificationReason: string
}

export function requiredEvidenceFields(filters: DiscoveryFilters): EvidenceField[] {
  return ["identity", "institution", ...(filters.alumniStatus === "Past alumni only" ? ["alumniStatus"] as const : []),
    ...(filters.graduationYear ? ["graduationYear"] as const : []),
    ...(filters.discoveryProgrammes.length ? ["programme"] as const : []),
    ...(filters.company ? ["company"] as const : []),
    ...(filters.role ? ["role"] as const : []),
    ...(filters.function !== "All functions" ? ["function"] as const : []),
    ...(filters.seniorities?.length || filters.seniority !== "All levels" ? ["seniority"] as const : []),
    ...(filters.location ? ["location"] as const : [])]
}

function validYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const year = Number(value)
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null
}

export function normalizeCandidateObservation(raw: unknown): CandidateObservation {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const sourceType = String(input.sourceType ?? "").trim()
  const sourceUrl = String(input.sourceUrl ?? "").trim()
  const profileUrl = String(input.profileUrl ?? "").trim()
  const verificationReason = String(input.verificationReason ?? "").trim()
  if (!["LINKEDIN_PROFILE", "INSTITUTION_RECORD", "COMPANY_RECORD", "OTHER_PUBLIC_SOURCE"].includes(sourceType)) throw new Error("Choose an evidence source type.")
  if (!/^https:\/\//i.test(sourceUrl) || !safeHttpUrl(sourceUrl)) throw new Error("A valid HTTPS evidence source URL is required.")
  if (profileUrl && !linkedinProfileIdentifier(profileUrl)) throw new Error("The professional profile URL must identify a LinkedIn person profile.")
  if (sourceType === "LINKEDIN_PROFILE" && (!linkedinProfileIdentifier(sourceUrl) || (profileUrl && linkedinProfileIdentifier(sourceUrl) !== linkedinProfileIdentifier(profileUrl)))) throw new Error("A LinkedIn source must be the same person profile as the observed identity.")
  if (verificationReason.length < 12 || verificationReason.length > 2000) throw new Error("Explain the verification decision in 12–2000 characters.")
  const start = validYear(input.educationStartYear)
  const end = validYear(input.educationEndYear)
  const graduation = validYear(input.graduationYear)
  if (start && end && start > end) throw new Error("Education start year cannot be after end year.")
  if (end && graduation && end !== graduation) throw new Error("Graduation year must agree with the observed education end year.")
  return {
    sourceType, sourceUrl, profileUrl,
    observedInstitution: String(input.observedInstitution ?? "").trim().slice(0, 300),
    educationStartYear: start, educationEndYear: end, graduationYear: graduation,
    programme: String(input.programme ?? "").trim().slice(0, 300),
    currentCompany: String(input.currentCompany ?? "").trim().slice(0, 300),
    currentDesignation: String(input.currentDesignation ?? "").trim().slice(0, 300),
    seniority: String(input.seniority ?? "").trim().slice(0, 100),
    location: String(input.location ?? "").trim().slice(0, 300),
    verificationReason,
  }
}

function safeHttpUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
}

function decision(value: boolean | null): EvidenceDecision { return value === null ? "UNVERIFIED" : value ? "MATCH" : "MISMATCH" }
function known(value: string): boolean { return Boolean(value && !/^(unknown|not returned|not available|unavailable)$/i.test(value)) }

export function candidateEvidenceDecisions(observation: CandidateObservation, filters: DiscoveryFilters, providerProfileUrl: string, now = new Date()): EvidenceDecisions {
  const required = new Set(requiredEvidenceFields(filters))
  const match = (field: EvidenceField, value: boolean | null): EvidenceDecision => required.has(field) ? decision(value) : "NOT_REQUESTED"
  const id = linkedinProfileIdentifier(observation.profileUrl)
  const providerId = linkedinProfileIdentifier(providerProfileUrl)
  const year = observation.graduationYear ?? observation.educationEndYear
  const programmeMatches = discoveryQualification(observation.programme, year, filters.discoveryProgrammes, now).programmeMatchesSelection
  const title = titleSeniority(observation.currentDesignation)
  const derivedSeniority = title.ambiguous ? "" : title.bucket
  return {
    identity: match("identity", !id ? null : providerId ? id === providerId : true),
    institution: match("institution", !known(observation.observedInstitution) ? null : normalized(observation.observedInstitution) === normalized(FIXED_ALUMNI_SCHOOL) || /^(iim lucknow|iiml)$/.test(normalized(observation.observedInstitution))),
    alumniStatus: match("alumniStatus", year === null ? null : year < now.getUTCFullYear()),
    graduationYear: match("graduationYear", year === null ? null : year === Number(filters.graduationYear)),
    programme: match("programme", !known(observation.programme) ? null : programmeMatches),
    company: match("company", !known(observation.currentCompany) ? null : normalized(observation.currentCompany) === normalized(filters.company)),
    role: match("role", !known(observation.currentDesignation) ? null : normalized(observation.currentDesignation).includes(normalized(filters.role))),
    function: match("function", !known(observation.currentDesignation) ? null : normalizeFunction("", observation.currentDesignation) === "Other" ? null : normalizeFunction("", observation.currentDesignation) === filters.function),
    seniority: match("seniority", !derivedSeniority ? null : matchesDiscoverySeniorities(derivedSeniority, filters)),
    location: match("location", !known(observation.location) ? null : normalized(observation.location).includes(normalized(filters.location))),
  }
}

export function candidateEvidenceOutcome(decisions: EvidenceDecisions): "SUPPORTS" | "REJECTS" | "INSUFFICIENT" {
  const values = Object.values(decisions)
  if (values.includes("MISMATCH")) return "REJECTS"
  return values.includes("UNVERIFIED") ? "INSUFFICIENT" : "SUPPORTS"
}

export function validateReviewerDecisions(raw: unknown, calculated: EvidenceDecisions): EvidenceDecisions {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const decisions = {} as EvidenceDecisions
  for (const field of EVIDENCE_FIELDS) {
    const requested = calculated[field] !== "NOT_REQUESTED"
    const chosen = input[field]
    if (!requested) {
      decisions[field] = "NOT_REQUESTED"
      continue
    }
    if (chosen !== "MATCH" && chosen !== "MISMATCH" && chosen !== "UNVERIFIED") throw new Error(`Choose a verification state for ${field}.`)
    if (chosen !== "UNVERIFIED" && chosen !== calculated[field]) throw new Error(`${field} cannot be marked ${chosen} from the observed evidence.`)
    decisions[field] = chosen
  }
  return decisions
}
