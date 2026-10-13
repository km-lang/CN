import { linkedinProfileIdentifier } from "@/lib/professional-profile"

export type CoresignalIdentityAlumnus = {
  id: number
  coresignalEmployeeId?: string | null
  linkedinUrl?: string | null
}

export type CoresignalIdentityOutcome =
  | "KNOWN_PROVIDER_ID"
  | "ATTACHED_PROVIDER_ID"
  | "NEW_CANDIDATE"
  | "IDENTITY_REVIEW_REQUIRED"
  | "CONFLICT"

export type CoresignalIdentityDecision = {
  outcome: CoresignalIdentityOutcome
  alumnusId: number | null
  matchingMethod: "PROVIDER_ID" | "LINKEDIN_URL" | "NONE"
  rationale: string
  evidenceReviewRequired: boolean
  wroteIdentity: boolean
}

export type CoresignalIdentityInput = {
  coresignalEmployeeId: string
  profileUrl?: string | null
  expectedAlumnusId?: number | null
  source: string
  actor: string
  discoveryResultId?: number | null
}

export type CoresignalIdentityEvidence = CoresignalIdentityInput & CoresignalIdentityDecision

export type CoresignalIdentityStore = {
  loadAlumni(): Promise<readonly CoresignalIdentityAlumnus[]>
  attachIfUnassigned(alumnusId: number, coresignalEmployeeId: string, input: CoresignalIdentityInput): Promise<boolean>
  recordEvidence(evidence: CoresignalIdentityEvidence): Promise<void>
  isUniqueConflict(error: unknown): boolean
}

export function normalizeCoresignalEmployeeId(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function decision(
  outcome: CoresignalIdentityOutcome,
  alumnusId: number | null,
  matchingMethod: CoresignalIdentityDecision["matchingMethod"],
  rationale: string,
  evidenceReviewRequired = false,
): CoresignalIdentityDecision {
  return { outcome, alumnusId, matchingMethod, rationale, evidenceReviewRequired, wroteIdentity: false }
}

export function reconcileCoresignalIdentity(
  input: Pick<CoresignalIdentityInput, "coresignalEmployeeId" | "profileUrl" | "expectedAlumnusId">,
  alumni: readonly CoresignalIdentityAlumnus[],
): CoresignalIdentityDecision {
  const providerId = normalizeCoresignalEmployeeId(input.coresignalEmployeeId)
  if (!providerId) return decision("IDENTITY_REVIEW_REQUIRED", null, "NONE", "A non-empty Coresignal employee ID is required before identity can be attached.", true)

  const providerMatches = alumni.filter(person => normalizeCoresignalEmployeeId(person.coresignalEmployeeId) === providerId)
  const profileIdentifier = linkedinProfileIdentifier(input.profileUrl)
  const profileMatches = profileIdentifier
    ? alumni.filter(person => linkedinProfileIdentifier(person.linkedinUrl) === profileIdentifier)
    : []

  if (providerMatches.length > 1) {
    return decision("CONFLICT", null, "PROVIDER_ID", "The Coresignal employee ID is already associated with multiple alumni; manual identity resolution is required.", true)
  }

  if (providerMatches.length === 1) {
    const mapped = providerMatches[0]
    if (input.expectedAlumnusId && mapped.id !== input.expectedAlumnusId) {
      return decision("CONFLICT", mapped.id, "PROVIDER_ID", "The Coresignal employee ID is already attached to a different alumnus than the requested target.", true)
    }
    if (profileMatches.some(person => person.id !== mapped.id)) {
      return decision("CONFLICT", mapped.id, "PROVIDER_ID", "The stable Coresignal employee ID and returned LinkedIn URL point to different alumni.", true)
    }
    const storedProfile = linkedinProfileIdentifier(mapped.linkedinUrl)
    const changedProfileEvidence = Boolean(profileIdentifier && storedProfile && profileIdentifier !== storedProfile)
    return decision(
      "KNOWN_PROVIDER_ID",
      mapped.id,
      "PROVIDER_ID",
      changedProfileEvidence
        ? "The stable Coresignal employee ID remains mapped to this alumnus; the changed LinkedIn URL is retained only as review evidence."
        : "The Coresignal employee ID is already mapped to this alumnus.",
      changedProfileEvidence,
    )
  }

  if (!profileIdentifier) {
    return decision("NEW_CANDIDATE", null, "NONE", "No known Coresignal employee ID or valid LinkedIn profile identity was found.")
  }
  if (profileMatches.length > 1) {
    return decision("IDENTITY_REVIEW_REQUIRED", null, "LINKEDIN_URL", "The normalized LinkedIn URL maps to multiple alumni; no provider identity was attached.", true)
  }
  if (profileMatches.length === 0) {
    return decision("NEW_CANDIDATE", null, "NONE", "The Coresignal employee ID and normalized LinkedIn URL are both unknown.")
  }

  const target = profileMatches[0]
  if (input.expectedAlumnusId && target.id !== input.expectedAlumnusId) {
    return decision("CONFLICT", target.id, "LINKEDIN_URL", "The normalized LinkedIn URL points to a different alumnus than the requested attachment target.", true)
  }
  const targetProviderId = normalizeCoresignalEmployeeId(target.coresignalEmployeeId)
  if (targetProviderId && targetProviderId !== providerId) {
    return decision("CONFLICT", target.id, "LINKEDIN_URL", "The LinkedIn-matched alumnus already has a different Coresignal employee ID.", true)
  }
  return decision("ATTACHED_PROVIDER_ID", target.id, "LINKEDIN_URL", "The new Coresignal employee ID can be attached to the single exact normalized LinkedIn URL match.")
}

export async function attachCoresignalIdentity(input: CoresignalIdentityInput, store: CoresignalIdentityStore): Promise<CoresignalIdentityDecision> {
  const normalizedInput = { ...input, coresignalEmployeeId: normalizeCoresignalEmployeeId(input.coresignalEmployeeId) }
  let current = await store.loadAlumni()
  let planned = reconcileCoresignalIdentity(normalizedInput, current)

  if (planned.outcome !== "ATTACHED_PROVIDER_ID" || planned.alumnusId === null) {
    await store.recordEvidence({ ...normalizedInput, ...planned })
    return planned
  }

  try {
    const attached = await store.attachIfUnassigned(planned.alumnusId, normalizedInput.coresignalEmployeeId, normalizedInput)
    if (attached) {
      planned = { ...planned, wroteIdentity: true }
      await store.recordEvidence({ ...normalizedInput, ...planned })
      return planned
    }
  } catch (error) {
    if (!store.isUniqueConflict(error)) throw error
  }

  // A conditional update can lose a race either to this same mapping or to a
  // conflicting mapping. Reload authoritative state and convert that race into
  // a domain result instead of leaking the database constraint error.
  current = await store.loadAlumni()
  const afterRace = reconcileCoresignalIdentity(normalizedInput, current)
  const resolved = afterRace.outcome === "KNOWN_PROVIDER_ID"
    ? afterRace
    : decision("CONFLICT", afterRace.alumnusId, afterRace.matchingMethod, "The Coresignal identity changed while attachment was in progress; no identity was reassigned.", true)
  await store.recordEvidence({ ...normalizedInput, ...resolved })
  return resolved
}
