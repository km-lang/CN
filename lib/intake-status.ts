import { sql, type SQL } from "drizzle-orm"
import { alumni } from "@/db/schema"

export type AlumniIntakeStatus = "VERIFIED" | "PROVISIONAL" | "REVIEW_REQUIRED"

// Legacy rows predate intake_status. Retain an explicit human-verification
// label without rewriting alumni during the additive migration. Provider-only
// profile checks and manually supplied records are not alumni verification.
export function effectiveIntakeStatus(row: { intakeStatus: string; verified: string }): AlumniIntakeStatus {
  if (row.intakeStatus === "PROVISIONAL") return "PROVISIONAL"
  if (row.intakeStatus === "VERIFIED" || row.verified === "Locally verified" || row.verified.startsWith("Human-reviewed external candidate")) return "VERIFIED"
  return "REVIEW_REQUIRED"
}

export const effectiveIntakeStatusSql: SQL<string> = sql<string>`case
  when ${alumni.intakeStatus} = 'PROVISIONAL' then 'PROVISIONAL'
  when ${alumni.intakeStatus} = 'VERIFIED' or ${alumni.verified} = 'Locally verified' or ${alumni.verified} like 'Human-reviewed external candidate%' then 'VERIFIED'
  else 'REVIEW_REQUIRED' end`
