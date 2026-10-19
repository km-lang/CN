import {
  matchesSeniority,
  isReportingRelationshipTitle,
  normalizeFunction,
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
  | "NOT_PROVIDER_VERIFIED"
  | "SEARCH_CONSTRAINED_NOT_VERIFIED"
  | "EXACT_YEAR_VERIFIED"
  | "EXACT_YEAR_QUERY_MATCH"
  | "WRONG_YEAR"
  | "GRADUATION_YEAR_UNVERIFIED"
  | "PROVIDER_SIDE_NARROWING_ONLY"
  | "NAME_MATCH_IDENTITY_UNVERIFIED"

export type QualificationCriterion = {
  result: CriterionResult
  source: "NOT_REQUESTED" | "SEARCH_PREVIEW" | "SEARCH_PREVIEW_TITLE" | "SEARCH_CONSTRAINT" | "PROVIDER_UPPER_BOUND" | "BASE_COLLECT"
  evidence: string
  rationale: string
}

export type CandidateQualification = {
  alumniStatus: QualificationCriterion
  company: QualificationCriterion
  role: QualificationCriterion
  function: QualificationCriterion
  seniority: QualificationCriterion
  location: QualificationCriterion
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
  roleMismatches: number
  functionMismatches: number
  seniorityMismatches: number
  locationMismatches: number
  seniorityInsufficientEvidence: number
  pendingVerification: number
  confirmedMismatches: number
  alreadyKnown: number
  savedReviewCandidates: number
  approvedAlumni: number
  confirmedFilterMatches: number
  reviewBeforeCollect: number
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
  selectedCandidates: DiscoveryExecutionCandidate[]
  metrics: DiscoveryExecutionMetrics
}

export type DiscoverySearchConstraintEvidence = {
  institutionId: number
  exactGraduationYear: number
  providerCompanyId: number | null
  exactCompanyName?: string | null
  companyIdentityMode?: "VERIFIED_ID" | "EXACT_NAME" | null
  expectedCompanyUrl?: string | null
  semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW"
}

export type PersistedDiscoveryOperationEvidence = {
  operation: string
  status: string
  requestSummary: string
}

export function persistedSearchConstraintEvidence(
  filters: DiscoveryFilters,
  operations: readonly PersistedDiscoveryOperationEvidence[],
): DiscoverySearchConstraintEvidence | undefined {
  const exactGraduationYear = Number(filters.graduationYear)
  const exactOperation = operations.some(operation => operation.status === "success"
    && ["Exact-year ES-DSL Preview", "Constrained ES-DSL Preview", "ES-DSL Preview continuation"].includes(operation.operation)
    && (operation.requestSummary.includes("exact same-row IIML end-year constraint") || operation.requestSummary.includes("same-row nested education and current-employment constraints")))
  if (!exactOperation) return undefined
  return {
    institutionId: 25_919_228,
    exactGraduationYear: Number.isInteger(exactGraduationYear) && exactGraduationYear > 0 ? exactGraduationYear : 0,
    providerCompanyId: null,
    exactCompanyName: filters.company || null,
    companyIdentityMode: filters.company ? "EXACT_NAME" : null,
    semantics: "BASE_EMPLOYEE_ES_DSL_PREVIEW",
  }
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

function companyLinkedinIdentity(value: string) {
  if (!value) return ""
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    const parts = url.pathname.split("/").filter(Boolean)
    return host === "linkedin.com" && parts[0]?.toLowerCase() === "company" && parts[1]
      ? normalized(decodeURIComponent(parts[1]))
      : ""
  } catch { return "" }
}

function companyCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW" | "BASE_COLLECT", searchConstraint?: DiscoverySearchConstraintEvidence) {
  if (!filters.company) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No company filter was requested.")
  const roles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.role, seniority: profile.seniority, startDate: "" }]
  const returned = roles.map(role => role.company).filter(value => value && !/unavailable|multiple current roles/i.test(value))
  if (!returned.length) return criterion("INSUFFICIENT_EVIDENCE", source, "", "Current-company evidence was not returned.")
  const match = returned.find(value => normalized(value) === normalized(filters.company))
  if (match && source === "SEARCH_PREVIEW" && searchConstraint?.companyIdentityMode === "EXACT_NAME") {
    const returnedIdentity = companyLinkedinIdentity(profile.currentCompanyUrl)
    const expectedIdentity = companyLinkedinIdentity(searchConstraint.expectedCompanyUrl ?? "") || normalized(searchConstraint.exactCompanyName ?? filters.company)
    if (returnedIdentity && returnedIdentity !== expectedIdentity) {
      return criterion("MISMATCH", source, `${match} · ${profile.currentCompanyUrl}`, `Returned company name matches ${filters.company}, but the returned company URL identifies a different company. Exact-name Search does not override conflicting identity evidence.`)
    }
    const identityEvidence = returnedIdentity ? `company URL /company/${returnedIdentity}` : "company URL not returned"
    return criterion("NAME_MATCH_IDENTITY_UNVERIFIED", source, `${match} · ${identityEvidence}`, `Returned current-company name matches ${filters.company} under the same-row exact-name Search constraint. No verified numeric provider-company identity is asserted; employer identity remains subject to human review.`)
  }
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, match, `Returned current-company evidence matches ${filters.company}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, returned.join("; "), `Returned current-company evidence does not match ${filters.company}.`)
}

export function titleSeniority(title: string) {
  const value = normalized(title)
  if (!value || /unavailable/.test(value)) return { bucket: "", ambiguous: true }
  if (isReportingRelationshipTitle(value)) return { bucket: "", ambiguous: true }
  // AVP is not equivalent to VP+ for discovery qualification. Keep this
  // provider-facing decision conservative without changing CN's broader
  // display vocabulary.
  if (/\b(?:assistant|associate) vice president\b|\bavp\b/.test(value)) return { bucket: "Director", ambiguous: false }
  const bucket = normalizeSeniority("", title)
  return bucket === "Unknown/Unclassified"
    ? { bucket: "", ambiguous: true }
    : { bucket, ambiguous: false }
}

function seniorityCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW_TITLE" | "BASE_COLLECT") {
  const selected = selectedDiscoverySeniorities(filters)
  if (!selected.length) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No seniority filter was requested.")
  const allRoles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.rawTitle || profile.role, seniority: profile.seniority, startDate: "" }]
  const rolesAtSelectedCompany = filters.company
    ? allRoles.filter(role => normalized(role.company) === normalized(filters.company))
    : allRoles
  const roles = rolesAtSelectedCompany.length ? rolesAtSelectedCompany : allRoles
  const classified = roles.map(role => ({ title: role.title, ...titleSeniority(role.title) })).filter(item => item.bucket)
  if (!classified.length) return criterion("INSUFFICIENT_EVIDENCE", source, roles.map(role => role.title).filter(Boolean).join("; "), "The returned title cannot be safely classified into the CN seniority vocabulary.")
  const match = classified.map(item => ({ ...item, selected: selected.find(filter => matchesSeniority(item.bucket, filter)) })).find(item => item.selected)
  const evidence = classified.map(item => `${item.title} → ${item.bucket}`).join("; ")
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, evidence, `${match.title} → ${match.bucket}; matches selected ${match.selected}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, evidence, `Derived seniority does not match selected ${selected.join(", ")}.`)
}

function roleCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW_TITLE" | "BASE_COLLECT") {
  if (!filters.role) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No role/designation filter was requested.")
  const allRoles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.rawTitle || profile.role, seniority: profile.seniority, startDate: "" }]
  const atCompany = filters.company ? allRoles.filter(role => normalized(role.company) === normalized(filters.company)) : allRoles
  const roles = atCompany.length ? atCompany : allRoles
  const titles = roles.map(role => role.title).filter(value => value && !/unavailable/i.test(value))
  if (!titles.length) return criterion("INSUFFICIENT_EVIDENCE", source, "", "A current designation was not returned.")
  const match = titles.find(title => normalized(title).includes(normalized(filters.role)))
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, match, `Returned current designation matches ${filters.role}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, titles.join("; "), `Returned current designation does not match ${filters.role}.`)
}

function functionCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW_TITLE" | "BASE_COLLECT") {
  if (!filters.function || filters.function === "All functions") return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No function filter was requested.")
  const allRoles = source === "BASE_COLLECT" && profile.currentRoles?.length
    ? profile.currentRoles
    : [{ company: profile.currentCompany, title: profile.rawTitle || profile.role, seniority: profile.seniority, startDate: "" }]
  const atCompany = filters.company ? allRoles.filter(role => normalized(role.company) === normalized(filters.company)) : allRoles
  const roles = atCompany.length ? atCompany : allRoles
  const evidence = roles
    .map(role => ({ title: role.title, value: normalizeFunction("", role.title) }))
    .filter(item => item.title && item.value !== "Other")
  if (!evidence.length) return criterion("INSUFFICIENT_EVIDENCE", source, roles.map(role => role.title).filter(Boolean).join("; "), "The returned current role cannot be safely classified into the selected function.")
  const match = evidence.find(item => normalized(item.value) === normalized(filters.function))
  const summary = evidence.map(item => `${item.title} → ${item.value}`).join("; ")
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, summary, `Returned current-role evidence matches ${filters.function}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, summary, `Returned current-role evidence does not match ${filters.function}.`)
}

function locationCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, source: "SEARCH_PREVIEW" | "BASE_COLLECT") {
  if (!filters.location) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No location filter was requested.")
  if (!profile.location || /unavailable/i.test(profile.location)) return criterion("INSUFFICIENT_EVIDENCE", source, "", "Current location evidence was not returned.")
  const match = normalized(profile.location).includes(normalized(filters.location))
  return match
    ? criterion(source === "BASE_COLLECT" ? "VERIFIED_MATCH" : "MATCH", source, profile.location, `Returned location matches ${filters.location}.`)
    : criterion(source === "BASE_COLLECT" ? "VERIFIED_MISMATCH" : "MISMATCH", source, profile.location, `Returned location does not match ${filters.location}.`)
}

function alumniStatusCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, collected: boolean, graduation: QualificationCriterion) {
  if (filters.alumniStatus === "All graduation statuses") return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No past-alumnus restriction was requested.")
  if (profile.alumniStatus === "Past alumnus") return criterion(collected ? "VERIFIED_MATCH" : "MATCH", collected ? "BASE_COLLECT" : "SEARCH_PREVIEW", profile.alumniStatus, "Returned education evidence identifies a past alumnus.")
  if (profile.alumniStatus === "Current student") return criterion(collected ? "VERIFIED_MISMATCH" : "MISMATCH", collected ? "BASE_COLLECT" : "SEARCH_PREVIEW", profile.alumniStatus, "Returned education evidence identifies a current student, not a past alumnus.")
  if (["EXACT_YEAR_VERIFIED", "EXACT_YEAR_QUERY_MATCH"].includes(graduation.result) && Number(filters.graduationYear) < new Date().getUTCFullYear()) {
    return criterion("MATCH", graduation.source, graduation.evidence, "The exact requested IIML completion year is in the past; degree identity remains subject to human review.")
  }
  return criterion("INSUFFICIENT_EVIDENCE", collected ? "BASE_COLLECT" : "SEARCH_PREVIEW", profile.alumniStatus, "Past-alumnus status cannot be established from the returned evidence.")
}

function graduationCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, collected: boolean, searchConstraint?: DiscoverySearchConstraintEvidence) {
  if (!filters.graduationYear) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No graduation-year filter was requested.")
  const requested = Number(filters.graduationYear)
  const source = collected ? "BASE_COLLECT" : "SEARCH_PREVIEW"
  const education = profile.iimlEducationEvidence?.length
    ? profile.iimlEducationEvidence
    : profile.education !== "Education not returned"
      ? [{
          institution: profile.education,
          programme: profile.educationProgramme,
          normalizedProgramme: profile.normalizedProgramme,
          startDate: profile.educationStartDate,
          endDate: profile.educationEndDate,
          graduationYear: profile.graduationYear,
        }]
      : []
  const dated = education.filter(item => Number.isInteger(item.graduationYear) && item.graduationYear > 0)
  const exact = dated.find(item => item.graduationYear === requested)
  const describe = (item: (typeof education)[number]) => `IIM Lucknow · ${item.startDate && item.endDate ? `${item.startDate}–${item.endDate}` : item.endDate || String(item.graduationYear)}`

  if (exact) return criterion(
    "EXACT_YEAR_VERIFIED",
    source,
    describe(exact),
    `${collected ? "Collected" : "Returned Preview"} evidence has an IIM Lucknow education record ending in ${requested}. The end year matches exactly; degree award and identity still require human review.`,
  )
  if (dated.length) return criterion(
    "WRONG_YEAR",
    source,
    dated.map(describe).join("; "),
    `Returned IIM Lucknow education ends in ${[...new Set(dated.map(item => item.graduationYear))].join(", ")}, not the requested exact year ${requested}. A different institution ending in ${requested} would not satisfy this criterion.`,
  )
  if (!collected && searchConstraint?.semantics === "BASE_EMPLOYEE_ES_DSL_PREVIEW" && searchConstraint.exactGraduationYear === requested) return criterion(
    "EXACT_YEAR_QUERY_MATCH",
    "SEARCH_CONSTRAINT",
    `Nested education.institution_id=${searchConstraint.institutionId} AND education.date_to_year=${requested}`,
    `The provider Search Preview matched IIM Lucknow institution ID ${searchConstraint.institutionId} and exact end year ${requested} in the same education row. This is query-match provenance, not independent proof of degree award, identity, or profile freshness.`,
  )
  if (education.length) return criterion(
    "GRADUATION_YEAR_UNVERIFIED",
    source,
    education.map(item => `IIM Lucknow · ${item.startDate ? `start ${item.startDate}` : "completion date not returned"}`).join("; "),
    "IIM Lucknow education evidence was returned without a usable end year. A start year or approximate period is not exact graduation-year evidence.",
  )
  return criterion(
    "PROVIDER_SIDE_NARROWING_ONLY",
    "PROVIDER_UPPER_BOUND",
    `Requested ${requested} · Provider narrowing ${requested} or earlier · Exact year unverified`,
    `Legacy Filter Preview uses education_date_to=${requested} as an upper bound and its documented response does not include education. Exact IIM Lucknow end year awaits richer provider evidence.`,
  )
}

function programmeCriterion(profile: DiscoveryProfile, filters: DiscoveryFilters, collected: boolean, searchConstraint?: DiscoverySearchConstraintEvidence) {
  if (!filters.discoveryProgrammes.length) return criterion("NOT_REQUESTED", "NOT_REQUESTED", "", "No programme filter was requested.")
  if (filters.discoveryProgrammes.length > 1 && (!collected || !profile.educationProgramme) && !searchConstraint) {
    return criterion(
      "NOT_PROVIDER_VERIFIED",
      collected ? "BASE_COLLECT" : "SEARCH_PREVIEW",
      filters.discoveryProgrammes.join(", "),
      "Multiple programmes were selected, so programme was not used to constrain the provider search. Programme requires richer education evidence before it can be verified.",
    )
  }
  if (!collected || !profile.educationProgramme) return criterion("SEARCH_CONSTRAINED_NOT_VERIFIED", "SEARCH_CONSTRAINT", filters.discoveryProgrammes.join(", "), `Search was constrained to ${filters.discoveryProgrammes.join(", ")}; programme was not independently returned in the candidate profile.`)
  if (!profile.normalizedProgramme) return criterion("VERIFIED_MISMATCH", "BASE_COLLECT", profile.educationProgramme, "Collected programme evidence is not one of the selected regular IIM Lucknow programmes.")
  return filters.discoveryProgrammes.includes(profile.normalizedProgramme)
    ? criterion("VERIFIED_MATCH", "BASE_COLLECT", profile.normalizedProgramme, `Collected programme evidence matches ${profile.normalizedProgramme}.`)
    : criterion("VERIFIED_MISMATCH", "BASE_COLLECT", profile.normalizedProgramme, `Collected programme evidence does not match the selected programmes.`)
}

export function qualifyPreviewCandidate(profile: DiscoveryProfile, filters: DiscoveryFilters, searchConstraint?: DiscoverySearchConstraintEvidence): CandidateQualification {
  const graduationYear = graduationCriterion(profile, filters, false, searchConstraint)
  return {
    alumniStatus: alumniStatusCriterion(profile, filters, false, graduationYear),
    company: companyCriterion(profile, filters, "SEARCH_PREVIEW", searchConstraint),
    role: roleCriterion(profile, filters, "SEARCH_PREVIEW_TITLE"),
    function: functionCriterion(profile, filters, "SEARCH_PREVIEW_TITLE"),
    seniority: seniorityCriterion(profile, filters, "SEARCH_PREVIEW_TITLE"),
    location: locationCriterion(profile, filters, "SEARCH_PREVIEW"),
    graduationYear,
    programme: programmeCriterion(profile, filters, false, searchConstraint),
  }
}

export function qualifyCollectedCandidate(profile: DiscoveryProfile, filters: DiscoveryFilters): CandidateQualification {
  const graduationYear = graduationCriterion(profile, filters, true)
  return {
    alumniStatus: alumniStatusCriterion(profile, filters, true, graduationYear),
    company: companyCriterion(profile, filters, "BASE_COLLECT"),
    role: roleCriterion(profile, filters, "BASE_COLLECT"),
    function: functionCriterion(profile, filters, "BASE_COLLECT"),
    seniority: seniorityCriterion(profile, filters, "BASE_COLLECT"),
    location: locationCriterion(profile, filters, "BASE_COLLECT"),
    graduationYear,
    programme: programmeCriterion(profile, filters, true),
  }
}

function hasMismatch(qualification: CandidateQualification) {
  return Object.values(qualification).some(item => item.result === "MISMATCH" || item.result === "VERIFIED_MISMATCH" || item.result === "WRONG_YEAR")
}

function hasInsufficientRequiredEvidence(qualification: CandidateQualification) {
  return qualification.alumniStatus.result === "INSUFFICIENT_EVIDENCE"
    || qualification.company.result === "INSUFFICIENT_EVIDENCE"
    || qualification.role.result === "INSUFFICIENT_EVIDENCE"
    || qualification.function.result === "INSUFFICIENT_EVIDENCE"
    || qualification.seniority.result === "INSUFFICIENT_EVIDENCE"
    || qualification.location.result === "INSUFFICIENT_EVIDENCE"
    || ["INSUFFICIENT_EVIDENCE", "GRADUATION_YEAR_UNVERIFIED"].includes(qualification.graduationYear.result)
    || ["NOT_PROVIDER_VERIFIED", "SEARCH_CONSTRAINED_NOT_VERIFIED"].includes(qualification.programme.result)
}

function hasPreviewOnlyInsufficientEvidence(qualification: CandidateQualification) {
  // Missing education/programme/alumni-status fields are precisely what the
  // legacy Collect step can resolve. Do not stop before Collect for those.
  // Current-role dimensions are already returned by Preview; ambiguous or
  // missing evidence there must remain pending rather than spending a Collect.
  return qualification.company.result === "INSUFFICIENT_EVIDENCE"
    || qualification.role.result === "INSUFFICIENT_EVIDENCE"
    || qualification.function.result === "INSUFFICIENT_EVIDENCE"
    || qualification.seniority.result === "INSUFFICIENT_EVIDENCE"
    || qualification.location.result === "INSUFFICIENT_EVIDENCE"
    || qualification.graduationYear.result === "GRADUATION_YEAR_UNVERIFIED"
}

function preliminaryDecision(reconciliation: ReconciliationResult, qualification: CandidateQualification) {
  if (["KNOWN_PROVIDER_ID", "KNOWN_PROFILE_URL", "KNOWN_STRONG_IDENTITY"].includes(reconciliation.classification)) return { state: "SKIPPED_ALREADY_KNOWN" as const, status: "ALREADY_KNOWN" as const, reason: reconciliation.rationale }
  if (reconciliation.classification === "PREVIOUSLY_REJECTED") return { state: "SKIPPED_PREVIOUSLY_REJECTED" as const, status: "PREVIOUSLY_REJECTED" as const, reason: reconciliation.rationale }
  if (hasMismatch(qualification)) return { state: "SKIPPED_FILTER_MISMATCH" as const, status: "FILTER_MISMATCH" as const, reason: qualification.company.result === "MISMATCH" ? qualification.company.rationale : qualification.seniority.result === "MISMATCH" ? qualification.seniority.rationale : qualification.graduationYear.rationale }
  if (reconciliation.classification === "AMBIGUOUS" || hasPreviewOnlyInsufficientEvidence(qualification)) return { state: "REVIEW_BEFORE_COLLECT" as const, status: "IDENTITY_REVIEW_REQUIRED" as const, reason: reconciliation.classification === "AMBIGUOUS" ? reconciliation.rationale : "Preview evidence is insufficient for safe automatic collection." }
  return null
}

function hasConfirmedPreviewQualification(qualification: CandidateQualification) {
  const accepted = new Set<CriterionResult>(["NOT_REQUESTED", "MATCH", "VERIFIED_MATCH", "EXACT_YEAR_VERIFIED", "EXACT_YEAR_QUERY_MATCH", "NAME_MATCH_IDENTITY_UNVERIFIED"])
  return Object.values(qualification).every(item => accepted.has(item.result))
}

export async function executeSelectiveDiscovery(options: {
  previewProfiles: readonly DiscoveryProfile[]
  filters: DiscoveryFilters
  alumni: readonly ReconciliationAlumnus[]
  rejectedCandidates: readonly RejectedCandidateEvidence[]
  capabilities: DiscoveryPreviewCapabilities
  requestedCount: number
  maximumCollects: number
  searchConstraint?: DiscoverySearchConstraintEvidence
  collect: (employeeId: string, index: number) => Promise<DiscoveryProfile | null>
}): Promise<DiscoveryExecutionResult> {
  const requestedCount = Math.max(0, Math.trunc(options.requestedCount))
  // Search Preview may over-return beyond the requested final result count.
  // Qualify the complete bounded provider page first so an early mismatch does
  // not hide a later eligible candidate. Provider calls remain independently
  // fenced by maximumCollects below.
  const considered = options.previewProfiles
  const candidates: DiscoveryExecutionCandidate[] = []
  let collectRecommended = 0
  let collectExecuted = 0

  for (const [index, preview] of considered.entries()) {
    const previewReconciliation = reconcileDiscoveryCandidate(candidate(preview), options.alumni, options.rejectedCandidates, options.capabilities)
    const previewQualification = qualifyPreviewCandidate(preview, options.filters, options.searchConstraint)
    const preliminary = preliminaryDecision(previewReconciliation, previewQualification)
    if (preliminary) {
      candidates.push({ profile: preview, reconciliation: previewReconciliation, qualification: previewQualification, collectionState: preliminary.state, collectionRationale: preliminary.reason, finalStatus: preliminary.status })
      continue
    }

    if (hasConfirmedPreviewQualification(previewQualification)) {
      candidates.push({
        profile: preview,
        reconciliation: previewReconciliation,
        qualification: previewQualification,
        collectionState: "REVIEW_BEFORE_COLLECT",
        collectionRationale: "Preview evidence satisfies every requested locally-verifiable criterion. The candidate remains human-review-only; no Collect is required merely to occupy the requested qualified-result slot.",
        finalStatus: "QUALIFIED_FOR_REVIEW",
      })
      continue
    }

    if (options.maximumCollects === 0 && hasInsufficientRequiredEvidence(previewQualification)) {
      candidates.push({
        profile: preview,
        reconciliation: previewReconciliation,
        qualification: previewQualification,
        collectionState: "REVIEW_BEFORE_COLLECT",
        collectionRationale: "The provider-only Preview path returned unresolved requested evidence. No automatic Collect is authorized; the candidate remains pending human verification.",
        finalStatus: "INSUFFICIENT_EVIDENCE",
      })
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
    roleMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.role.result)).length,
    functionMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.function.result)).length,
    seniorityMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.seniority.result)).length,
    locationMismatches: candidates.filter(item => ["MISMATCH", "VERIFIED_MISMATCH"].includes(item.qualification.location.result)).length,
    seniorityInsufficientEvidence: candidates.filter(item => item.qualification.seniority.result === "INSUFFICIENT_EVIDENCE").length,
    pendingVerification: candidates.filter(item => ["IDENTITY_REVIEW_REQUIRED", "INSUFFICIENT_EVIDENCE", "COLLECT_LIMIT_REACHED"].includes(item.finalStatus)).length,
    confirmedMismatches: candidates.filter(item => item.finalStatus === "FILTER_MISMATCH").length,
    alreadyKnown: candidates.filter(item => item.finalStatus === "ALREADY_KNOWN").length,
    savedReviewCandidates: 0,
    approvedAlumni: 0,
    confirmedFilterMatches: candidates.filter(item => item.finalStatus === "QUALIFIED_FOR_REVIEW").length,
    reviewBeforeCollect: count("REVIEW_BEFORE_COLLECT"),
    previouslyRejected: candidates.filter(item => item.reconciliation.classification === "PREVIOUSLY_REJECTED").length,
    ambiguousCandidates: candidates.filter(item => item.reconciliation.classification === "AMBIGUOUS").length,
    collectRecommended,
    collectExecuted,
    collectSkippedKnown: count("SKIPPED_ALREADY_KNOWN"),
    collectSkippedFilter: count("SKIPPED_FILTER_MISMATCH"),
    collectSkippedLimit: count("SKIPPED_COLLECT_LIMIT"),
    potentialCollectionsAvoided: candidates.length - collectExecuted,
  }
  const selectionRank = (item: DiscoveryExecutionCandidate) => {
    if (item.finalStatus === "QUALIFIED_FOR_REVIEW") return 0
    if (item.finalStatus === "IDENTITY_REVIEW_REQUIRED" || item.finalStatus === "INSUFFICIENT_EVIDENCE") return 1
    if (item.finalStatus === "ALREADY_KNOWN") return 2
    return Number.POSITIVE_INFINITY
  }
  // Qualified matches rank first. If fewer than requested are available,
  // unresolved candidates may occupy saved-review rows, but metrics continue
  // to disclose that they are pending rather than qualified.
  const selectedCandidates = candidates
    .map((item, index) => ({
      item,
      index,
      rank: selectionRank(item),
      unresolved: Object.values(item.qualification).filter(value => ["INSUFFICIENT_EVIDENCE", "NOT_PROVIDER_VERIFIED", "SEARCH_CONSTRAINED_NOT_VERIFIED", "GRADUATION_YEAR_UNVERIFIED"].includes(value.result)).length,
    }))
    .filter(item => Number.isFinite(item.rank))
    .sort((left, right) => left.rank - right.rank || left.unresolved - right.unresolved || left.index - right.index)
    .slice(0, requestedCount)
    .map(item => item.item)
  metrics.savedReviewCandidates = selectedCandidates.length
  return { candidates, selectedCandidates, metrics }
}
