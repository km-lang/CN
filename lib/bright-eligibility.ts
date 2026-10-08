import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"

export type IntelligenceMappingStatus = "MAPPED" | "UNMAPPED" | "AMBIGUOUS" | "CONFLICT"
export type BrightEligibilityReason = "ELIGIBLE" | "MISSING_LINKEDIN" | "LINKEDIN_NOT_VERIFIED" | "IDENTITY_CONFLICT" | "INACTIVE" | "MAPPING_REQUIRED"

export type BrightEligibility = {
  eligible: boolean
  reason: BrightEligibilityReason
  message: string
  normalizedLinkedinUrl: string
  canEnroll: boolean
}

export function evaluateBrightEligibility(input: {
  lifecycleStatus: string
  linkedinUrl: string
  profileMatch: string
  professionalDataStatus?: string
  mappingStatus: IntelligenceMappingStatus
  suggestedIntelligenceAlumniId?: string | null
  intelligenceEnrollmentApproved?: boolean
}): BrightEligibility {
  const normalizedLinkedinUrl = normalizeProfessionalProfileUrl(input.linkedinUrl)
  if (input.lifecycleStatus !== "Active") return { eligible: false, reason: "INACTIVE", message: "The Corporate Network record is not active.", normalizedLinkedinUrl, canEnroll: false }
  if (!normalizedLinkedinUrl) return { eligible: false, reason: "MISSING_LINKEDIN", message: "No valid LinkedIn professional profile is stored.", normalizedLinkedinUrl, canEnroll: false }
  if (input.profileMatch === "Mismatch" || input.professionalDataStatus === "Conflict — manual verification required" || input.mappingStatus === "AMBIGUOUS" || input.mappingStatus === "CONFLICT") {
    return { eligible: false, reason: "IDENTITY_CONFLICT", message: "Professional identity evidence requires conflict review.", normalizedLinkedinUrl, canEnroll: false }
  }
  if (input.profileMatch !== "Confirmed") return { eligible: false, reason: "LINKEDIN_NOT_VERIFIED", message: "The professional profile requires human verification.", normalizedLinkedinUrl, canEnroll: false }
  if (input.mappingStatus !== "MAPPED" || input.intelligenceEnrollmentApproved === false) return {
    eligible: false,
    reason: "MAPPING_REQUIRED",
    message: input.suggestedIntelligenceAlumniId ? "Matching LinkedIn evidence exists; explicit enrollment will attach the stable Corporate Network identity." : "Eligible profile must be enrolled with a stable intelligence identity.",
    normalizedLinkedinUrl,
    canEnroll: input.mappingStatus === "UNMAPPED" || input.mappingStatus === "MAPPED",
  }
  return { eligible: true, reason: "ELIGIBLE", message: "Approved LinkedIn identity is connected and eligible for Bright refresh.", normalizedLinkedinUrl, canEnroll: false }
}
