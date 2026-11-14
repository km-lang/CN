import type { alumni } from "@/db/postgres/schema"
import { effectiveIntakeStatus } from "@/lib/intake-status"
import { hasPermission, maskEmail, maskPhone } from "@/lib/security-policy"

export function alumnusResponse(row: typeof alumni.$inferSelect, role: "ADMIN" | "PCOM" | "DEVELOPER") {
  const contacts = hasPermission(role, "VIEW_CONTACTS")
  return { ...row, intakeStatus: effectiveIntakeStatus(row), email: contacts ? row.email : maskEmail(row.email), phone: contacts ? row.phone : maskPhone(row.phone), batch: row.graduationYear || row.batch, assessment: { hiringInfluence: row.hiringInfluence, iimlRelationship: row.iimlRelationship, warmIntroPotential: row.warmIntroPotential }, verification: { profileMatch: row.profileMatch, currentCompany: row.currentCompanyVerification, designation: row.designationVerification, email: row.emailVerification, phone: row.phoneVerification, location: row.locationVerification } }
}
