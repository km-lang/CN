import { classifyCurrentTitle } from "@/lib/seniority-classifier"

export const PROFILE_EDITABLE_FIELDS = ["name", "programme", "graduationYear", "company", "title", "location", "email", "phone", "note"] as const
export type ProfileEditableField = typeof PROFILE_EDITABLE_FIELDS[number]

export type ProfileUpdatePlan = {
  direct: Record<string, string | number>
  proposed: Array<{ field: ProfileEditableField; oldValue: string; proposedValue: string }>
  history: Array<{ field: ProfileEditableField | "seniority"; oldValue: string; newValue: string }>
}

function clean(value: unknown, max: number) { return String(value ?? "").trim().slice(0, max) }
function same(a: unknown, b: unknown) { return String(a ?? "").trim() === String(b ?? "").trim() }

export function planProfileUpdate(current: Record<string, unknown>, patch: Record<string, unknown>, clearFields: unknown, role: string): ProfileUpdatePlan {
  const clears = new Set(Array.isArray(clearFields) ? clearFields.map(String) : [])
  const direct: Record<string, string | number> = {}
  const proposed: ProfileUpdatePlan["proposed"] = []
  const history: ProfileUpdatePlan["history"] = []
  const limits: Record<ProfileEditableField, number> = { name: 200, programme: 100, graduationYear: 4, company: 240, title: 240, location: 200, email: 320, phone: 80, note: 1000 }
  const protectedField = (field: ProfileEditableField) =>
    (role === "PCOM" && (field === "programme" || field === "graduationYear"))
    || (field === "company" && current.currentCompanyVerification !== "Unverified")
    || (field === "title" && current.designationVerification !== "Unverified")
    || (field === "location" && current.locationVerification !== "Unverified")
    || (field === "email" && current.emailVerification === "Verified")
    || (field === "phone" && current.phoneVerification === "Verified")

  for (const field of PROFILE_EDITABLE_FIELDS) {
    if (!(field in patch) && !clears.has(field)) continue
    if (clears.has(field) && !["company", "title", "location", "email", "phone", "note"].includes(field)) throw new Error(`${field} cannot be cleared.`)
    let next: string | number = clears.has(field) ? "" : clean(patch[field], limits[field])
    if (!clears.has(field) && next === "") continue
    if (field === "graduationYear") {
      const year = Number(next)
      if (!Number.isInteger(year) || year < 1940 || year > new Date().getUTCFullYear() + 10) throw new Error("Graduation year must be a plausible four-digit year.")
      next = year
    }
    if (field === "email" && next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(next))) throw new Error("Email is malformed.")
    if (same(current[field], next)) continue
    if (protectedField(field)) {
      proposed.push({ field, oldValue: String(current[field] ?? ""), proposedValue: String(next) })
      continue
    }
    direct[field] = next
    history.push({ field, oldValue: String(current[field] ?? ""), newValue: String(next) })
  }
  if ("graduationYear" in direct) direct.batch = direct.graduationYear
  if ("name" in direct) direct.initials = String(direct.name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL"
  if ("title" in direct || "company" in direct) {
    const title = direct.title ?? current.title
    const company = direct.company ?? current.company
    const classified = classifyCurrentTitle(title, company)
    if (classified.state === "CLASSIFIED" && !same(current.seniority, classified.level)) {
      direct.seniority = classified.level
      history.push({ field: "seniority", oldValue: String(current.seniority ?? ""), newValue: classified.level })
    }
  }
  if (role === "DEVELOPER") throw new Error("Developer accounts cannot edit alumni profiles.")
  return { direct, proposed, history }
}
