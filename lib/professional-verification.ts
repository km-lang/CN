export const PROFESSIONAL_VERIFICATION_SOURCES = [
  "Professional profile manual review",
  "Coresignal evidence",
  "Lusha identity match",
  "Institutional record",
  "Alumnus confirmation",
  "Other documented evidence",
] as const

export type ProfessionalVerificationSource = typeof PROFESSIONAL_VERIFICATION_SOURCES[number]
export type ProfessionalVerificationField = "profileMatch" | "currentCompany" | "designation"

export const PROFESSIONAL_VERIFICATION_OPTIONS = Object.freeze({
  profileMatch: ["Confirmed", "Mismatch", "Unverified"],
  currentCompany: ["Verified", "Possibly outdated", "Unverified"],
  designation: ["Verified", "Likely", "Possibly outdated", "Unverified"],
} satisfies Record<ProfessionalVerificationField, readonly string[]>)

export const PROFESSIONAL_VERIFICATION_LABELS: Record<ProfessionalVerificationField, string> = {
  profileMatch: "Profile match",
  currentCompany: "Current company",
  designation: "Designation",
}

const requestKeys = new Set(["action", "alumnusId", "fields", "evidenceSource", "note", "confirmed"])
const fieldKeys = new Set<ProfessionalVerificationField>(["profileMatch", "currentCompany", "designation"])

export type ProfessionalVerificationRequest = {
  action: "verify_professional_fields"
  alumnusId: number
  fields: Partial<Record<ProfessionalVerificationField, string>>
  evidenceSource: ProfessionalVerificationSource | ""
  note: string
  confirmed: true
}

export function isPositiveProfessionalVerification(field: ProfessionalVerificationField, value: string) {
  if (field === "profileMatch") return value === "Confirmed"
  if (field === "currentCompany") return value === "Verified"
  return value === "Verified" || value === "Likely"
}

export function validateProfessionalVerificationRequest(input: unknown): ProfessionalVerificationRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A verification request is required.")
  const record = input as Record<string, unknown>
  const unexpected = Object.keys(record).filter(key => !requestKeys.has(key))
  if (unexpected.length) throw new Error(`Unsupported verification property: ${unexpected[0]}.`)
  if (record.action !== "verify_professional_fields") throw new Error("Unsupported verification action.")
  if (!Number.isInteger(record.alumnusId) || Number(record.alumnusId) < 1) throw new Error("Choose a valid alumnus.")
  if (record.confirmed !== true) throw new Error("Explicit confirmation is required.")
  if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) throw new Error("Choose at least one verification field.")

  const rawFields = record.fields as Record<string, unknown>
  const unsupportedField = Object.keys(rawFields).find(key => !fieldKeys.has(key as ProfessionalVerificationField))
  if (unsupportedField) throw new Error(`Unsupported verification field: ${unsupportedField}.`)
  const entries = Object.entries(rawFields) as Array<[ProfessionalVerificationField, unknown]>
  if (!entries.length) throw new Error("Choose at least one verification field.")
  const fields: Partial<Record<ProfessionalVerificationField, string>> = {}
  for (const [field, value] of entries) {
    if (typeof value !== "string" || !PROFESSIONAL_VERIFICATION_OPTIONS[field].includes(value)) {
      throw new Error(`Unsupported ${PROFESSIONAL_VERIFICATION_LABELS[field].toLowerCase()} state.`)
    }
    fields[field] = value
  }

  const evidenceSource = typeof record.evidenceSource === "string" ? record.evidenceSource.trim() : ""
  if (evidenceSource && !PROFESSIONAL_VERIFICATION_SOURCES.includes(evidenceSource as ProfessionalVerificationSource)) {
    throw new Error("Choose a supported verification evidence source.")
  }
  const note = typeof record.note === "string" ? record.note.trim().slice(0, 1000) : ""
  if (entries.some(([field, value]) => isPositiveProfessionalVerification(field, String(value))) && !evidenceSource) {
    throw new Error("An evidence source is required for positive verification.")
  }
  if (evidenceSource === "Other documented evidence" && !note) throw new Error("Add a review note for other documented evidence.")

  return {
    action: "verify_professional_fields",
    alumnusId: Number(record.alumnusId),
    fields,
    evidenceSource: evidenceSource as ProfessionalVerificationSource | "",
    note,
    confirmed: true,
  }
}
