import { timingSafeEqual } from "node:crypto"
import { evaluateBrightEligibility, type BrightEligibilityReason } from "@/lib/bright-eligibility"
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"

export const BRIGHT_REVALIDATION_BATCH_LIMIT = 500
export type BrightRevalidationItem = { sourceId: string; intelligenceAlumniId: string; normalizedLinkedinUrl: string }
export type BrightRevalidationReason = BrightEligibilityReason | "INVALID_SOURCE_ID" | "NOT_FOUND" | "LINKEDIN_CHANGED"
export type BrightRevalidationResult = BrightRevalidationItem & { eligible: boolean; reason: BrightRevalidationReason }
export type CurrentCnBrightRecord = { id: number; linkedinUrl: string; profileMatch: string; professionalDataStatus: string; lifecycleStatus: string }

export function authenticateBrightRevalidation(request: Request, expectedSecret: string) {
  if (!expectedSecret.trim()) return false
  const header = request.headers.get("authorization") ?? ""
  const presented = header.startsWith("Bearer ") ? header.slice(7) : ""
  const left = Buffer.from(presented)
  const right = Buffer.from(expectedSecret)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function revalidateBrightItems(items: BrightRevalidationItem[], records: Map<number, CurrentCnBrightRecord>): BrightRevalidationResult[] {
  return items.map(item => {
    const match = item.sourceId.match(/^cn:([1-9]\d*)$/)
    const base = { ...item }
    if (!match) return { ...base, eligible: false, reason: "INVALID_SOURCE_ID" }
    const record = records.get(Number(match[1]))
    if (!record) return { ...base, eligible: false, reason: "NOT_FOUND" }
    const currentUrl = normalizeProfessionalProfileUrl(record.linkedinUrl)
    if (!currentUrl || currentUrl !== normalizeProfessionalProfileUrl(item.normalizedLinkedinUrl)) return { ...base, eligible: false, reason: "LINKEDIN_CHANGED" }
    const eligibility = evaluateBrightEligibility({ lifecycleStatus: record.lifecycleStatus, linkedinUrl: record.linkedinUrl, profileMatch: record.profileMatch, professionalDataStatus: record.professionalDataStatus, mappingStatus: "MAPPED", intelligenceEnrollmentApproved: true })
    return { ...base, eligible: eligibility.eligible, reason: eligibility.reason }
  })
}
