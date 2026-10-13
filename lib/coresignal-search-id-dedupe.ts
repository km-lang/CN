import { normalizeCoresignalEmployeeId } from "@/lib/coresignal-identity"

export const MAX_CORESIGNAL_SEARCH_IDS = 1_000

export type CoresignalSearchIdentityBatch = {
  employeeIds: readonly unknown[]
}

export type CoresignalSearchIdMapping = {
  employeeId: string
  alumnusId: number
  linkedinUrl: string
}

export type CoresignalSearchIdLookupStore = {
  findMappings(employeeIds: readonly string[]): Promise<readonly CoresignalSearchIdMapping[]>
}

export type CoresignalSearchIdClassification = {
  employeeId: string
  mappingState: "KNOWN_PROVIDER_ID" | "UNKNOWN_PROVIDER_ID" | "IDENTITY_REVIEW_REQUIRED"
  mappedAlumnusId: number | null
  canonicalLinkedinUrl: string | null
  identityResolutionRequired: boolean
  identityProviderOperationsAvoided: number
  profileFreshness: "NOT_EVALUATED"
}

export type CoresignalSearchIdDedupeResult = {
  classifications: readonly CoresignalSearchIdClassification[]
  summary: {
    rawIdsReceived: number
    uniqueValidIds: number
    knownProviderIds: number
    unknownProviderIds: number
    identityReviewRequired: number
    potentialDownstreamIdentityOperationsAvoided: number
    profilesRequiringFurtherResolution: number
  }
}

export class CoresignalSearchIdValidationError extends Error {
  readonly invalidIndexes: readonly number[]

  constructor(message: string, invalidIndexes: readonly number[] = []) {
    super(message)
    this.name = "CoresignalSearchIdValidationError"
    this.invalidIndexes = invalidIndexes
  }
}

function normalizeSearchEmployeeId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0
      ? normalizeCoresignalEmployeeId(String(value))
      : null
  }
  // Provider IDs can cross JSON/storage boundaries as decimal strings. Accept
  // only an explicit unsigned integer representation; Number(""), exponent
  // syntax, whitespace, signs and other coercible strings are intentionally
  // rejected rather than silently coerced.
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null
  return normalizeCoresignalEmployeeId(String(numeric))
}

export function normalizeCoresignalSearchIdentityBatch(batch: CoresignalSearchIdentityBatch): readonly string[] {
  if (!Array.isArray(batch.employeeIds)) {
    throw new CoresignalSearchIdValidationError("Coresignal Search employeeIds must be an array.")
  }
  if (batch.employeeIds.length > MAX_CORESIGNAL_SEARCH_IDS) {
    throw new CoresignalSearchIdValidationError(`Coresignal Search ID batches are limited to ${MAX_CORESIGNAL_SEARCH_IDS} raw IDs.`)
  }

  const invalidIndexes: number[] = []
  const normalized = batch.employeeIds.map((employeeId, index) => {
    const value = normalizeSearchEmployeeId(employeeId)
    if (value === null) invalidIndexes.push(index)
    return value
  })
  if (invalidIndexes.length) {
    throw new CoresignalSearchIdValidationError(
      `Coresignal Search employee IDs must be positive safe integers; invalid values were supplied at indexes ${invalidIndexes.join(", ")}.`,
      invalidIndexes,
    )
  }

  return [...new Set(normalized as string[])].sort((left, right) => Number(left) - Number(right))
}

export async function deduplicateCoresignalSearchIds(
  batch: CoresignalSearchIdentityBatch,
  store: CoresignalSearchIdLookupStore,
): Promise<CoresignalSearchIdDedupeResult> {
  const employeeIds = normalizeCoresignalSearchIdentityBatch(batch)
  if (employeeIds.length === 0) {
    return {
      classifications: [],
      summary: {
        rawIdsReceived: 0,
        uniqueValidIds: 0,
        knownProviderIds: 0,
        unknownProviderIds: 0,
        identityReviewRequired: 0,
        potentialDownstreamIdentityOperationsAvoided: 0,
        profilesRequiringFurtherResolution: 0,
      },
    }
  }

  const requested = new Set(employeeIds)
  const mappings = new Map<string, CoresignalSearchIdMapping[]>()
  for (const mapping of await store.findMappings(employeeIds)) {
    const employeeId = normalizeSearchEmployeeId(mapping.employeeId)
    if (!employeeId || !requested.has(employeeId)) continue
    const current = mappings.get(employeeId) ?? []
    current.push({ ...mapping, employeeId })
    mappings.set(employeeId, current)
  }

  const classifications = employeeIds.map<CoresignalSearchIdClassification>((employeeId) => {
    const matches = mappings.get(employeeId) ?? []
    if (matches.length === 0) {
      return {
        employeeId,
        mappingState: "UNKNOWN_PROVIDER_ID",
        mappedAlumnusId: null,
        canonicalLinkedinUrl: null,
        identityResolutionRequired: true,
        identityProviderOperationsAvoided: 0,
        profileFreshness: "NOT_EVALUATED",
      }
    }
    if (matches.length > 1) {
      return {
        employeeId,
        mappingState: "IDENTITY_REVIEW_REQUIRED",
        mappedAlumnusId: null,
        canonicalLinkedinUrl: null,
        identityResolutionRequired: true,
        identityProviderOperationsAvoided: 0,
        profileFreshness: "NOT_EVALUATED",
      }
    }
    return {
      employeeId,
      mappingState: "KNOWN_PROVIDER_ID",
      mappedAlumnusId: matches[0].alumnusId,
      canonicalLinkedinUrl: matches[0].linkedinUrl || null,
      identityResolutionRequired: false,
      identityProviderOperationsAvoided: 1,
      profileFreshness: "NOT_EVALUATED",
    }
  })

  const count = (state: CoresignalSearchIdClassification["mappingState"]) => classifications.filter(item => item.mappingState === state).length
  const knownProviderIds = count("KNOWN_PROVIDER_ID")
  const unknownProviderIds = count("UNKNOWN_PROVIDER_ID")
  const identityReviewRequired = count("IDENTITY_REVIEW_REQUIRED")

  return {
    classifications,
    summary: {
      rawIdsReceived: batch.employeeIds.length,
      uniqueValidIds: employeeIds.length,
      knownProviderIds,
      unknownProviderIds,
      identityReviewRequired,
      potentialDownstreamIdentityOperationsAvoided: knownProviderIds,
      profilesRequiringFurtherResolution: unknownProviderIds + identityReviewRequired,
    },
  }
}
