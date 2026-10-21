import { normalizedPersonName } from "@/lib/directory-query"
import { linkedinProfileIdentifier, normalizeProfessionalProfileUrl } from "@/lib/professional-profile"

export type IntakeState = "VERIFIED" | "PROVISIONAL" | "REVIEW_REQUIRED"
export type IntakeDecision = "ELIGIBLE" | "ALREADY_PRESENT" | "REVIEW_REQUIRED"

export type IntakeCandidate = {
  id: number
  searchId: number
  provider: string
  providerPersonId: string
  name: string
  linkedinUrl: string
  reviewStatus: string
  matchStatus?: string
  reviewNote?: string
  linkedInternalAlumnusId?: number | null
  providerIntegrity: "consistent" | "provider_mismatch" | "search_missing"
  latestEvidenceDecision?: "SUPPORTS" | "REJECTS" | "INSUFFICIENT" | null
}

export type IntakeKnownAlumnus = { id: number; name: string; coresignalEmployeeId: string; linkedinUrl: string }
export type IntakeAssessment = { resultId: number; decision: IntakeDecision; reason: string; providerPersonId: string; profileKey: string }

function possibleNameCollision(candidateName: string, knownName: string) {
  const candidate = normalizedPersonName(candidateName).split(" ").filter(Boolean)
  const known = normalizedPersonName(knownName).split(" ").filter(Boolean)
  if (!candidate.length || !known.length || candidate[0] !== known[0]) return false
  if (candidate.join(" ") === known.join(" ")) return true
  // "Suraj K." is never expanded to a full name. An existing Suraj Kumar
  // remains an exception until a human resolves the identity.
  return candidate.length > 1 && known.length > 1 && (
    candidate[1].length === 1 && known[1].startsWith(candidate[1]) ||
    known[1].length === 1 && candidate[1].startsWith(known[1])
  )
}

export function assessProvisionalIntake(
  candidates: readonly IntakeCandidate[],
  knownAlumni: readonly IntakeKnownAlumnus[],
): IntakeAssessment[] {
  const claimedIds = new Set<string>()
  const claimedProfiles = new Set<string>()
  return candidates.map(candidate => {
    const providerPersonId = candidate.providerPersonId.trim()
    const profileUrl = normalizeProfessionalProfileUrl(candidate.linkedinUrl)
    const profileKey = /linkedin\.com\/in\//i.test(profileUrl) ? linkedinProfileIdentifier(profileUrl) : ""
    const output = (decision: IntakeDecision, reason: string): IntakeAssessment => ({ resultId: candidate.id, decision, reason, providerPersonId, profileKey })
    if (candidate.provider !== "coresignal" || candidate.providerIntegrity !== "consistent") return output("REVIEW_REQUIRED", "Provider/search provenance is inconsistent.")
    if (candidate.reviewStatus !== "Pending review" || candidate.linkedInternalAlumnusId) return output("ALREADY_PRESENT", "This result was already processed or linked.")
    if (/^SKIPPED_(FILTER_MISMATCH|PREVIOUSLY_REJECTED)\b/.test(candidate.reviewNote ?? "")) return output("REVIEW_REQUIRED", "The saved result has a confirmed search-filter mismatch or prior rejection.")
    if (candidate.matchStatus === "Possible duplicate" || candidate.matchStatus === "Already in database") return output("REVIEW_REQUIRED", "The discovery result indicates a possible or known duplicate.")
    if (candidate.latestEvidenceDecision === "REJECTS") return output("REVIEW_REQUIRED", "Saved reviewer evidence rejects this candidate.")
    if (!/^[1-9][0-9]*$/.test(providerPersonId) || !profileKey) return output("REVIEW_REQUIRED", "A stable Coresignal person ID and valid LinkedIn profile URL are both required.")
    const name = normalizedPersonName(candidate.name).split(" ").filter(Boolean)
    if (name.length < 2 || name[0].length < 2 || /^(unknown|not|unavailable|profile)$/.test(name[0])) return output("REVIEW_REQUIRED", "The returned name is insufficient for a directory profile.")
    const idMatches = knownAlumni.filter(person => person.coresignalEmployeeId.trim() === providerPersonId)
    const urlMatches = knownAlumni.filter(person => linkedinProfileIdentifier(person.linkedinUrl) === profileKey)
    if (idMatches.length > 1 || urlMatches.length > 1 || idMatches.length && urlMatches.length && idMatches[0].id !== urlMatches[0].id) return output("REVIEW_REQUIRED", "Trusted provider ID and profile URL identify conflicting or multiple alumni.")
    if (idMatches.length && urlMatches.length && idMatches[0].id === urlMatches[0].id) return output("ALREADY_PRESENT", "Both stable identifiers already identify an existing alumnus.")
    if (idMatches.length || urlMatches.length) return output("REVIEW_REQUIRED", "One stable identifier already belongs to an existing alumnus; identity reconciliation is required.")
    if (knownAlumni.some(person => possibleNameCollision(candidate.name, person.name))) return output("REVIEW_REQUIRED", "A possible existing-name match requires identity review, especially for abbreviated names.")
    if (claimedIds.has(providerPersonId) || claimedProfiles.has(profileKey)) return output("REVIEW_REQUIRED", "Another selected result claims the same stable identity.")
    claimedIds.add(providerPersonId)
    claimedProfiles.add(profileKey)
    return output("ELIGIBLE", "Stable identity is unique in the current directory. Alumni attributes remain unverified.")
  })
}

export function provisionalAlumnusValues(candidate: Pick<IntakeCandidate, "name" | "linkedinUrl" | "providerPersonId" | "searchId">, actor: string, now: string) {
  const name = candidate.name.trim().replace(/\s+/g, " ")
  const profileKey = linkedinProfileIdentifier(candidate.linkedinUrl)
  return {
    profileKey: `coresignal:${candidate.providerPersonId.trim()}`,
    name,
    initials: name.split(" ").slice(0, 2).map(part => part[0]?.toUpperCase()).join(""),
    batch: 0, graduationYear: 0, programme: "Unknown", education: "Unknown",
    company: "Unknown", title: "Unknown", function: "Other", seniority: "Unknown/Unclassified", location: "Unknown", confidence: 0,
    linkedinUrl: `https://www.linkedin.com/in/${encodeURIComponent(profileKey)}/`,
    coresignalEmployeeId: candidate.providerPersonId.trim(),
    discoverySource: `Coresignal discovery #${candidate.searchId}`,
    discoveryDate: now,
    iimlAffiliationStatus: "Potential alumnus — review required",
    verified: "PROVISIONAL — provider identity only; alumni facts unverified",
    intakeStatus: "PROVISIONAL" as const,
    profileMatch: "Unverified", currentCompanyVerification: "Unverified", designationVerification: "Unverified",
    emailVerification: "Unverified", phoneVerification: "Unverified", locationVerification: "Unverified",
    status: "Not contacted", source: "Provisional Coresignal discovery",
    note: "Potential IIM Lucknow alumnus. Institution, programme, graduation year, employer, and outreach eligibility require independent verification.",
    updatedBy: actor, updatedAt: now,
  }
}
