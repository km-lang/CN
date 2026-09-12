const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class InvalidEmailError extends Error {
  constructor() {
    super("Enter a valid email address.")
  }
}

export function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase()
  if (!email || email.length > 320 || !BASIC_EMAIL_PATTERN.test(email)) throw new InvalidEmailError()
  return email
}

export function tryNormalizeEmail(value: unknown) {
  try {
    return normalizeEmail(value)
  } catch {
    return ""
  }
}

export function isLikelyInstitutionalEmailTypo(candidateEmail: unknown, existingEmail: unknown, candidateName = "", existingName = "") {
  const candidate = tryNormalizeEmail(candidateEmail)
  const existing = tryNormalizeEmail(existingEmail)
  if (!candidate || !existing || candidate === existing) return false

  const [candidateLocal, candidateDomain] = candidate.split("@")
  const [existingLocal, existingDomain] = existing.split("@")
  if (candidateDomain !== existingDomain || candidateLocal.length < 5 || existingLocal.length < 5) return false

  const candidateParts = candidateLocal.match(/^(.+?)(\d{4,})$/)
  const existingParts = existingLocal.match(/^(.+?)(\d{4,})$/)
  const sameInstitutionalNumber = Boolean(candidateParts && existingParts && candidateParts[2] === existingParts[2])
  const prefixDistance = sameInstitutionalNumber ? editDistance(candidateParts![1], existingParts![1]) : Number.POSITIVE_INFINITY

  const normalizedCandidateName = normalizeDisplayName(candidateName)
  const normalizedExistingName = normalizeDisplayName(existingName)
  const sameDisplayName = Boolean(normalizedCandidateName && normalizedExistingName && normalizedCandidateName === normalizedExistingName)
  const wholeLocalDistance = sameDisplayName ? editDistance(candidateLocal, existingLocal) : Number.POSITIVE_INFINITY

  return prefixDistance === 1 || wholeLocalDistance === 1
}

function normalizeDisplayName(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

function editDistance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return 2
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}
