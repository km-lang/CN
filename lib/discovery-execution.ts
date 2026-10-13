import {
  matchesSeniority,
  isReportingRelationshipTitle,
  normalizeSeniority,
  normalized,
  selectedDiscoverySeniorities,
  type DiscoveryFilters,
  type DiscoveryProfile,
} from "@/lib/alumni-search"
import {
  reconcileDiscoveryCandidate,
  type ReconciliationAlumnus,
  type ReconciliationCandidate,
  type ReconciliationResult,
  type RejectedCandidateEvidence,
} from "@/lib/discovery-reconciliation"
import type { DiscoveryPreviewCapabilities } from "@/lib/discovery-provider-capabilities"

export type CriterionResult =
  | "NOT_REQUESTED"
  | "MATCH"
  | "MISMATCH"
  | "NEEDS_COLLECT"
  | "VERIFIED_MATCH"
  | "VERIFIED_MISMATCH"
  | "NOT_RETURNED_IN_PREVIEW"
  | "INSUFFICIENT_EVIDENCE"
  | "SEARCH_CONSTRAINED_NOT_VERIFIED"

export type QualificationCriterion = {
  result: CriterionResult
  source: "NOT_REQUESTED" | "SEARCH_PREVIEW" | "SEARCH_PREVIEW_TITLE" | "SEARCH_CONSTRAINT" | "BASE_COLLECT"
  evidence: string
  rationale: string
}

export type CandidateQualification = {
  company: QualificationCriterion
  seniority: QualificationCriterion
  graduationYear: QualificationCriterion
  programme: QualificationCriterion
}

export type CollectionState =
  | "COLLECT_PERFORMED"
  | "SKIPPED_ALREADY_KNOWN"
  | "SKIPPED_FILTER_MISMATCH"
  | "SKIPPED_PREVIOUSLY_REJECTED"
  | "REVIEW_BEFORE_COLLECT"
  | "SKIPPED_COLLECT_LIMIT"

export type FinalDiscoveryStatus =
  | "QUALIFIED_FOR_REVIEW"
  | "FILTER_MISMATCH"
  | "IDENTITY_REVIEW_REQUIRED"
  | "INSUFFICIENT_EVIDENCE"
  | "ALREADY_KNOWN"
  | "PREVIOUSLY_REJECTED"
  | "COLLECT_LIMIT_REACHED"

export type DiscoveryExecutionCandidate = {
  profile: DiscoveryProfile
  reconciliation: ReconciliationResult
  qualification: CandidateQualification
  collectionState: CollectionState
  collectionRationale: string
  finalStatus: FinalDiscoveryStatus
}

export type DiscoveryExecutionMetrics = {
  previewCountReturned: number
  previewCountConsidered: number
  knownProviderIds: number
  knownProfileUrls: number
  companyMismatches: number
  seniorityMismatches: number
  previouslyRejected: number
  ambiguousCandidates: number
  collectRecommended: number
  collectExecuted: number
  collectSkippedKnown: number
  collectSkippedFilter: number
  collectSkippedLimit: number
  potentialCollectionsAvoided: number
}

export type DiscoveryExecutionResult = {
  candidates: DiscoveryExecutionCandidate[]
  metrics: DiscoveryExecutionMetrics
}

function candidate(profile: DiscoveryProfile): ReconciliationCandidate {
  return {
    candidateKey: profile.providerResultId || profile.providerPersonId,
    providerEmployeeId: profile.providerPersonId,
    profileUrl: profile.linkedinUrl,
    name: profile.name,
    educationInstitution: profile.education === "Education not returned" ? "" : profile.education,
    programme: profile.educationProgramme,
    graduationYear: profile.graduationYear,
    currentCompany: profile.currentCompany,
    currentTitle: profile.role,
  }
}

function criterion(result: CriterionResult, source: QualificationCriterion["source"], evidence: string, rationale: string): QualificationCriterion {
  return { result, source, evidence, rationale }
}

function companyCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW" | "BASE_COLLECT") {
  if (!filters.company) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No company filter was requested.")
  const roles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.role, seniority: profile.seniority, startDate: "" }]
  const returned = roles.map(role => role.company).filter(value => value && !/unavailable|multiple current roles/i.test(value))
  if (!returned.length) return criterion("INSUFFICIENT_EVIDENCE", source, "", "Current-company evidence was not returned.")
  const match = returned.find(value => normalized(value) === normalized(filters.company))
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, match, `Returned current-company evidence matches ${filters.company}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, returned.join("; "), `Returned current-company evidence does not match ${filters.company}.`)
}

export function titleSeniority(title: string) {
  const value = normalized(title)
  if (!value || /unavailable/.test(value)) return { bucket: "", ambiguous: true }
  if (isReportingRelationshipTitle(value)) return { bucket: "", ambiguous: true }
  return { bucket: normalizeSeniority("", title), ambiguous: false }
}

function seniorityCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW_TITLE" | "BASE_COLLECT") {
  const selected = selectedDiscoverySeniorities(filters)
  if (!selected.length) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No seniority filter was requested.")
  const roles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.rawTitle || profile.role, seniority: profile.seniority, startDate: "" }]
  const classified = roles.map(role => ({ title: role.title, ...titleSeniority(role.title) })).filter(item => item.bucket)
  if (!classified.length) return criterion("INSUFFICIENT_EVIDENCE", source, roles.map(role => role.title).filter(Boolean).join("; "), "The returned title cannot be safely classified into the CN seniority vocabulary.")
  const match = classified.map(item => ({ ...item, selected: selected.find(filter => matchesSeniority(item.bucket, filter)) })).find(item => item.selected)
  const evidence = classified.map(item => `${item.title} → ${item.bucket}`).join("; ")
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, evidence, `${match.title} → ${match.bucket}; matches selected ${match.selected}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, evidence, `Derived seniority does not match selected ${selected.join(", ")}.`)
}

function graduationCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, collected: boolean) {
  if (!filters.graduationYear) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No graduation-year filter was requested.")
  if (!collected) return criterion("NEEDS_COLLECT", "SEARCH_CONSTRAINT", filters.graduationYear, "The provider search was constrained by year, but Preview did not return independent education evidence.")
  if (!profile.graduationYear) return criterion("INSUFFICIENT_EVIDENCE", "BASE_COLLECT", "", "IIM Lucknow education was returned without a usable completion year.")
  return profile.graduationYear === Number(filters.graduationYear)
    ? criterion("VERIFIED_MATCH", "BASE_COLLECT", String(profile.graduationYear), `Collected IIM Lucknow education ends in ${filters.graduationYear}.`)
    : criterion("VERIFIED_MISMATCH", "BASE_COLLECT", String(profile.graduationYear), `Collected IIM Lucknow education ends in ${profile.graduationYear}, not ${filters.graduationYear}.`)
}

function programmeCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, collected: boolean) {
  if (!filters.discoveryProgrammes.length) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No programme filter was requested.")
  if (!collected || !profile.educationProgramme) return criterion("SEARCH_CONSTRAINED_NOT_VERIFIED", "SEARCH_CONSTRAINT", filters.discoveryProgrammes.join(", "), `Search was constrained to ${filters.discoveryProgrammes.join(", ")}; programme was not independently returned in the candidate profile.`)
  if (!profile.normalizedProgramme) return criterion("VERIFIED_MISMATCH", "BASE_COLLECT", profile.educationProgramme, "Collected programme evidence is not one of the selected regular IIM Lucknow programmes.")
  return filters.discoveryProgrammes.includes(profile.normalizedProgramme)
    ? criterion("VERIFIED_MATCH", "BASE_COLLECT", profile.normalizedProgramme, `Collected programme evidence matches ${profile.normalizedProgramme}.`)
    : criterion("VERIFIED_MISMATCH", "BASE_COLLECT", profile.normalizedProgramme, `Collected programme evidence does not match the selected programmes.`)
}

export function qualifyPreviewCandidate(profile: DiscoveryProfile, filters: DiscoveryFilters): CandidateQualification {
  return {
    company: companyCriterion(profile, filters, "SEARCH_PREVIEW"),
    seniority: seniorityCriterion(profile, filters, "SEARCH_PREVIEW_TITLE"),
    graduationYear: graduationCriterion(profile, filters, false),
    programme: programmeCriterion(profile, filters, false),
  }
}

export function qualifyCollectedCandidate(profile: DiscoveryProfile, filters: DiscoveryFilters): CandidateQualification {
  return {
    company: companyCriterion(profile, filters, "BASE_COLLECT"),
    seniority: seniorityCriterion(profile, filters, "BASE_COLLECT"),
    graduationYear: graduationCriterion(profile, filters, true),
    programme: programmeCriterion(profile, filters, true),
  }
}

function hasMismatch(qualification: CandidateQualification) {
  return Object.values(qualification).some(item => item.result === "MISMATCH" || item.result === "VERIFIED_MISMATCH")
}

function hasInsufficientRequiredEvidence(qualification: CandidateQualification) {
  return qualification.company.result === "INSUFFICIENT_EVIDENCE"
    || qualification.seniority.result === "INSUFFICIENT_EVIDENCE"
    || qualification.graduationYear.result === "INSUFFICIENT_EVIDENCE"
}

function preliminaryDecision(reconciliation: ReconciliationResult, qualification: CandidateQualification) {
  if (["KNOWN_PROVIDER_ID", "KNOWN_PROFILE_URL", "KNOWN_STRONG_IDENTITY"].includes(reconciliation.classification)) return { state: "SKIPPED_ALREADY_KNOWN" as const, status: "ALREADY_KNOWN" as const, reason: reconciliation.rationale }
  if (reconciliation.classification === "PREVIOUSLY_REJECTED") return { state: "SKIPPED_PREVIOUSLY_REJECTED" as const, status: "PREVIOUSLY_REJECTED" as const, reason: reconciliation.rationale }
  if (hasMismatch(qualification)) return { state: "SKIPPED_FILTER_MISMATCH" as const, status: "FILTER_MISMATCH" as const, reason: qualification.company.result === "MISMATCH" ? qualification.company.rationale : qualification.seniority.rationale }
  if (reconciliation.classification === "AMBIGUOUS" || hasInsufficientRequiredEvidence(qualification)) return { state: "REVIEW_BEFORE_COLLECT" as const, status: "IDENTITY_REVIEW_REQUIRED" as const, reason: reconciliation.classification === "AMBIGUOUS" ? reconciliation.rationale : "Preview evidence is insufficient for safe automatic collection." }
  return null
}

export async function executeSelectiveDiscovery(options: {
  previewProfiles: readonly DiscoveryProfile[]
  filters: DiscoveryFilters
  alumni: readonly ReconciliationAlumnus[]
  rejectedCandidates: readonly RejectedCandidateEvidence[]
  capabilities: DiscoveryPreviewCapabilities
  requestedCount: number
  maximumCollects: number
  collect: (employeeId: string, index: number) => Promise<DiscoveryProfile | null>
}): Promise<DiscoveryExecutionResult> {
  const considered = options.previewProfiles.slice(0, Math.max(0, Math.trunc(options.requestedCount)))
  const candidates: DiscoveryExecutionCandidate[] = []
  let collectRecommended = 0
  let collectExecuted = 0

  for (const [index, preview] of considered.entries()) {
    const previewReconciliation = reconcileDiscoveryCandidate(candidate(preview), options.alumni, options.rejectedCandidates, options.capabilities)
    const previewQualification = qualifyPreviewCandidate(preview, options.filters)
    const preliminary = preliminaryDecision(previewReconciliation, previewQualification)
    if (preliminary) {
      candidates.push({ profile: preview, reconciliation: previewReconciliation, qualification: previewQualification, collectionState: preliminary.state, collectionRationale: preliminary.reason, finalStatus: preliminary.status })
      continue
    }

    if (!preview.providerPersonId) {
      candidates.push({ profile: preview, reconciliation: previewReconciliation, qualification: previewQualification, collectionState: "REVIEW_BEFORE_COLLECT", collectionRationale: "Search Preview did not return the stable employee ID required for Base Collect.", finalStatus: "INSUFFICIENT_EVIDENCE" })
      continue
    }

    collectRecommended += 1
    if (collectExecuted >= options.maximumCollects) {
      candidates.push({ profile: preview, reconciliation: previewReconciliation, qualification: previewQualification, collectionState: "SKIPPED_COLLECT_LIMIT", collectionRationale: "The application-side Collect limit was reached before this candidate.", finalStatus: "COLLECT_LIMIT_REACHED" })
      continue
    }

    const collected = await options.collect(preview.providerPersonId, index)
    collectExecuted += 1
    if (!collected) {
      candidates.push({ profile: preview, reconciliation: previewReconciliation, qualification: previewQualification, collectionState: "REVIEW_BEFORE_COLLECT", collectionRationale: "Coresignal Collect returned no usable profile.", finalStatus: "INSUFFICIENT_EVIDENCE" })
      continue
    }
    const postReconciliation = reconcileDiscoveryCandidate(candidate(collected), options.alumni, options.rejectedCandidates, options.capabilities)
    const qualification = qualifyCollectedCandidate(collected, options.filters)
    const finalStatus: FinalDiscoveryStatus = hasMismatch(qualification)
      ? "FILTER_MISMATCH"
      : postReconciliation.classification === "AMBIGUOUS"
        ? "IDENTITY_REVIEW_REQUIRED"
        : hasInsufficientRequiredEvidence(qualification)
          ? "INSUFFICIENT_EVIDENCE"
          : "QUALIFIED_FOR_REVIEW"
    candidates.push({ profile: collected, reconciliation: postReconciliation, qualification, collectionState: "COLLECT_PERFORMED", collectionRationale: finalStatus === "QUALIFIED_FOR_REVIEW" ? "Collect supplied the richer evidence required for human review." : "Collect completed, but qualification still requires review or does not match the requested filters.", finalStatus })
  }

  const count = (state: CollectionState) => candidates.filter(item => item.collectionState === state).length
  const metrics: DiscoveryExecutionMetrics = {
    previewCountReturned: options.previewProfiles.length,
    previewCountConsidered: considered.length,
    knownProviderIds: candidates.filter(item => item.reconciliation.classification === "KNOWN_PROVIDER_ID").length,
    knownProfileUrls: candidates.filter(item => item.reconciliation.classification === "KNOWN_PROFILE_URL").length,
    companyMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.company.result)).length,
    seniorityMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.seniority.result)).length,
    previouslyRejected: candidates.filter(item => item.reconciliation.classification === "PREVIOUSLY_REJECTED").length,
    ambiguousCandidates: candidates.filter(item => item.reconciliation.classification === "AMBIGUOUS").length,
    collectRecommended,
    collectExecuted,
    collectSkippedKnown: count("SKIPPED_ALREADY_KNOWN"),
    collectSkippedFilter: count("SKIPPED_FILTER_MISMATCH"),
    collectSkippedLimit: count("SKIPPED_COLLECT_LIMIT"),
    potentialCollectionsAvoided: candidates.length - collectExecuted,
  }
  return { candidates, metrics }
}
