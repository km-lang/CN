import { FIXED_ALUMNI_SCHOOL, normalized } from "@/lib/alumni-search"
import { linkedinProfileIdentifier } from "@/lib/professional-profile"
import type { DiscoveryPreviewCapabilities } from "@/lib/discovery-provider-capabilities"

export type DiscoveryPlannerClassification = "KNOWN_PROVIDER_ID" | "KNOWN_PROFILE_URL" | "KNOWN_STRONG_IDENTITY" | "NEW_CANDIDATE" | "AMBIGUOUS" | "PREVIOUSLY_REJECTED"
export type SelectiveCollectDecision = "DO_NOT_COLLECT" | "COLLECT_RECOMMENDED" | "REVIEW_BEFORE_COLLECT"

export type ReconciliationCandidate = {
  candidateKey: string
  providerEmployeeId?: string
  profileUrl?: string
  name?: string
  educationInstitution?: string
  programme?: string
  graduationYear?: number
  currentCompany?: string
  currentTitle?: string
}

export type ReconciliationAlumnus = {
  id: number
  coresignalEmployeeId?: string
  linkedinUrl?: string
  name: string
  education?: string
  programme?: string
  batch?: number
  graduationYear?: number
  company?: string
  title?: string
}

export type RejectedCandidateEvidence = ReconciliationCandidate & {
  reviewStatus: string
  resultId?: number
}

export type ReconciliationResult = {
  candidateKey: string
  classification: DiscoveryPlannerClassification
  collectDecision: SelectiveCollectDecision
  linkedAlumnusId: number | null
  reasonCode: string
  rationale: string
}

function value(value: unknown) { return normalized(value) }
function employeeId(valueToNormalize: unknown) { return String(valueToNormalize ?? "").trim().toLowerCase() }

function isIiml(valueToCheck: unknown) {
  const candidate = value(valueToCheck)
  return candidate.includes(value(FIXED_ALUMNI_SCHOOL)) || candidate.includes("iim lucknow") || candidate.includes("iiml")
}

function normalizedProgramme(valueToNormalize: unknown) {
  const candidate = value(valueToNormalize)
  if (/\b(pgp|pgdm|mba|post graduate programme|post graduate program)\b/.test(candidate) && !/agribusiness|sustainable/.test(candidate)) return "pgp"
  if (/\b(abm|pgp abm)\b|agribusiness/.test(candidate)) return "abm"
  if (/\b(sm|pgp sm)\b|sustainable management/.test(candidate)) return "sm"
  return candidate
}

export function reconciliationEvidenceFingerprint(candidate: ReconciliationCandidate) {
  return [
    employeeId(candidate.providerEmployeeId),
    linkedinProfileIdentifier(candidate.profileUrl),
    value(candidate.name),
    value(candidate.educationInstitution),
    normalizedProgramme(candidate.programme),
    Number(candidate.graduationYear) || 0,
    value(candidate.currentCompany),
    value(candidate.currentTitle),
  ].join("|")
}

function collectDecision(classification: DiscoveryPlannerClassification): SelectiveCollectDecision {
  if (classification === "NEW_CANDIDATE") return "COLLECT_RECOMMENDED"
  if (classification === "AMBIGUOUS") return "REVIEW_BEFORE_COLLECT"
  return "DO_NOT_COLLECT"
}

function result(candidate: ReconciliationCandidate, classification: DiscoveryPlannerClassification, linkedAlumnusId: number | null, reasonCode: string, rationale: string): ReconciliationResult {
  return { candidateKey: candidate.candidateKey, classification, collectDecision: collectDecision(classification), linkedAlumnusId, reasonCode, rationale }
}

function stableEvidenceMatches(candidate: ReconciliationCandidate, rejected: RejectedCandidateEvidence) {
  const candidateProviderId = employeeId(candidate.providerEmployeeId)
  const rejectedProviderId = employeeId(rejected.providerEmployeeId)
  if (candidateProviderId && rejectedProviderId && candidateProviderId === rejectedProviderId) return true
  const candidateProfile = linkedinProfileIdentifier(candidate.profileUrl)
  const rejectedProfile = linkedinProfileIdentifier(rejected.profileUrl)
  return Boolean(candidateProfile && rejectedProfile && candidateProfile === rejectedProfile)
}

export function reconcileDiscoveryCandidate(
  candidate: ReconciliationCandidate,
  alumni: readonly ReconciliationAlumnus[],
  rejectedCandidates: readonly RejectedCandidateEvidence[],
  capabilities: DiscoveryPreviewCapabilities,
): ReconciliationResult {
  const providerId = employeeId(candidate.providerEmployeeId)
  if (providerId) {
    const matches = alumni.filter(person => employeeId(person.coresignalEmployeeId) === providerId)
    if (matches.length === 1) return result(candidate, "KNOWN_PROVIDER_ID", matches[0].id, "EXACT_PROVIDER_ID", `Existing Coresignal employee ID is already mapped to CN alumnus ${matches[0].id}.`)
    if (matches.length > 1) return result(candidate, "AMBIGUOUS", null, "DUPLICATE_PROVIDER_ID", "The same Coresignal employee ID is associated with multiple CN alumni; identity review is required.")
  }

  const profileIdentifier = linkedinProfileIdentifier(candidate.profileUrl)
  if (profileIdentifier) {
    const matches = alumni.filter(person => linkedinProfileIdentifier(person.linkedinUrl) === profileIdentifier)
    if (matches.length === 1) return result(candidate, "KNOWN_PROFILE_URL", matches[0].id, "EXACT_PROFILE_URL", `Professional-profile URL already belongs to CN alumnus ${matches[0].id}; reconcile the provider identity instead of creating an alumnus.`)
    if (matches.length > 1) return result(candidate, "AMBIGUOUS", null, "DUPLICATE_PROFILE_URL", "The professional-profile URL is associated with multiple CN alumni; identity review is required.")
  }

  const priorRejections = rejectedCandidates.filter(rejected => stableEvidenceMatches(candidate, rejected))
  if (priorRejections.length) {
    const unchanged = priorRejections.find(rejected => reconciliationEvidenceFingerprint(rejected) === reconciliationEvidenceFingerprint(candidate))
    if (unchanged) return result(candidate, "PREVIOUSLY_REJECTED", null, "UNCHANGED_REJECTED_IDENTITY", "Candidate was previously rejected with the same stable provider identity and unchanged evidence.")
    return result(candidate, "AMBIGUOUS", null, "REJECTED_EVIDENCE_CHANGED", "A previously rejected provider identity now has materially changed evidence and requires review.")
  }

  const candidateName = value(candidate.name)
  const sameName = candidateName ? alumni.filter(person => value(person.name) === candidateName) : []
  const programme = normalizedProgramme(candidate.programme)
  const graduationYear = Number(candidate.graduationYear) || 0
  const strongEvidenceComplete = Boolean(candidateName && isIiml(candidate.educationInstitution) && programme && graduationYear > 0)

  if (strongEvidenceComplete) {
    const strongMatches = sameName.filter(person => isIiml(person.education)
      && normalizedProgramme(person.programme) === programme
      && Number(person.graduationYear || person.batch || 0) === graduationYear)
    if (strongMatches.length === 1) return result(candidate, "KNOWN_STRONG_IDENTITY", strongMatches[0].id, "UNIQUE_NAME_EDUCATION_PROGRAMME_YEAR", `One CN alumnus (${strongMatches[0].id}) uniquely matches name, IIM Lucknow education, programme, and graduation year.`)
    if (strongMatches.length > 1) return result(candidate, "AMBIGUOUS", null, "MULTIPLE_STRONG_IDENTITY_MATCHES", "Multiple CN alumni match the same name and institutional evidence; the provider profile requires review.")
  }

  if (sameName.length) {
    const reason = strongEvidenceComplete ? "NAME_MATCH_INSTITUTIONAL_CONFLICT" : "NAME_MATCH_INSUFFICIENT_EVIDENCE"
    return result(candidate, "AMBIGUOUS", null, reason, strongEvidenceComplete
      ? "A CN alumnus has the same name but different programme or graduation evidence; no automatic link was made."
      : "A name match exists, but institutional identity evidence is insufficient for an automatic link.")
  }

  if (!profileIdentifier && capabilities.searchPreviewProvidesProfileUrl !== "NO") {
    return result(candidate, "AMBIGUOUS", null, "IDENTITY_EVIDENCE_INSUFFICIENT", "Search Preview did not provide a professional-profile URL and provider capability is not confirmed; Collect may be required to resolve identity.")
  }
  // A returned stable profile URL that does not exist in CN is enough to identify
  // a distinct candidate. It is not proof of alumni qualification; Collect and
  // human review still own education/programme/year verification.
  if (!profileIdentifier && !strongEvidenceComplete && capabilities.searchPreviewProvidesEducation !== "NO") {
    return result(candidate, "AMBIGUOUS", null, "IDENTITY_EVIDENCE_INSUFFICIENT", "Search Preview lacks sufficient institutional evidence to safely determine whether this is a new alumnus.")
  }

  return result(candidate, "NEW_CANDIDATE", null, "NO_SAFE_EXISTING_IDENTITY", "No safe existing CN identity was found.")
}

export function reconcileDiscoveryCandidates(
  candidates: readonly ReconciliationCandidate[],
  alumni: readonly ReconciliationAlumnus[],
  rejectedCandidates: readonly RejectedCandidateEvidence[],
  capabilities: DiscoveryPreviewCapabilities,
) {
  return candidates.map(candidate => reconcileDiscoveryCandidate(candidate, alumni, rejectedCandidates, capabilities))
}

export function selectiveCollectSummary(results: readonly ReconciliationResult[]) {
  const count = (classification: DiscoveryPlannerClassification) => results.filter(resultItem => resultItem.classification === classification).length
  const collectRecommended = results.filter(resultItem => resultItem.collectDecision === "COLLECT_RECOMMENDED").length
  const collectReviewRequired = results.filter(resultItem => resultItem.collectDecision === "REVIEW_BEFORE_COLLECT").length
  const collectAvoided = results.filter(resultItem => resultItem.collectDecision === "DO_NOT_COLLECT").length
  return {
    candidatesReturned: results.length,
    knownProviderIds: count("KNOWN_PROVIDER_ID"),
    knownProfileUrls: count("KNOWN_PROFILE_URL"),
    knownStrongIdentities: count("KNOWN_STRONG_IDENTITY"),
    newCandidates: count("NEW_CANDIDATE"),
    ambiguousCandidates: count("AMBIGUOUS"),
    previouslyRejected: count("PREVIOUSLY_REJECTED"),
    alreadyKnown: count("KNOWN_PROVIDER_ID") + count("KNOWN_PROFILE_URL") + count("KNOWN_STRONG_IDENTITY"),
    collectRecommended,
    collectReviewRequired,
    collectAvoided,
  }
}
