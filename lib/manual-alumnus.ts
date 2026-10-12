import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile"

export type ManualAlumnusIdentityInput = {
  name?: unknown
  email?: unknown
  linkedinUrl?: unknown
  linkedin_url?: unknown
  company?: unknown
  batch?: unknown
  graduationYear?: unknown
  graduation_year?: unknown
}

export type ManualAlumnusValidation = {
  valid: boolean
  errors: {
    name?: string
    identity?: string
    email?: string
    linkedinUrl?: string
  }
  identityPath: "email" | "professional_profile" | "company_and_graduation_year" | null
}

export const MANUAL_ALUMNUS_REQUIRED_COPY = "Name plus an email, professional-profile URL, or both company and graduation year is required."

export function validateManualAlumnusInput(input: ManualAlumnusIdentityInput): ManualAlumnusValidation {
  const name = String(input.name ?? "").trim()
  const email = String(input.email ?? "").trim().toLowerCase()
  const rawLinkedinUrl = String(input.linkedinUrl ?? input.linkedin_url ?? "").trim()
  const linkedinUrl = normalizeProfessionalProfileUrl(rawLinkedinUrl)
  const company = String(input.company ?? "").trim()
  const batch = Number(input.batch ?? input.graduationYear ?? input.graduation_year)
  const validBatch = Number.isInteger(batch) && batch >= 1980 && batch <= 2100
  const errors: ManualAlumnusValidation["errors"] = {}

  if (!name) errors.name = "Enter the alumnus name."
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address or leave it blank."
  if (rawLinkedinUrl && !linkedinUrl) errors.linkedinUrl = "Enter a valid professional-profile URL or leave it blank."

  const identityPath = !errors.email && email
    ? "email"
    : !errors.linkedinUrl && linkedinUrl
      ? "professional_profile"
      : company && validBatch
        ? "company_and_graduation_year"
        : null
  if (!identityPath) errors.identity = "Add an email, professional-profile URL, or both current company and a graduation year from 1980 to 2100."

  return { valid: !Object.keys(errors).length, errors, identityPath }
}
