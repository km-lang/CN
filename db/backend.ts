export type DatabaseBackend = "d1" | "postgres"

/** Keep the existing D1 deployment working; any explicit selection is strict. */
export function selectedDatabaseBackend(source: Record<string, string | undefined> = process.env): DatabaseBackend {
  const selected = source.CN_DB_BACKEND?.trim()
  if (!selected) {
    if (source.DATABASE_URL?.trim()) throw new Error("CN_DB_BACKEND is required when DATABASE_URL is configured.")
    return "d1"
  }
  if (selected === "d1") {
    if (source.DATABASE_URL?.trim()) throw new Error("DATABASE_URL must be unset when CN_DB_BACKEND=d1.")
    return "d1"
  }
  if (selected === "postgres") return "postgres"
  throw new Error("CN_DB_BACKEND must be either d1 or postgres.")
}

export function requireD1Backend(source: Record<string, string | undefined> = process.env) {
  if (selectedDatabaseBackend(source) !== "d1") {
    throw new Error("This D1 database path has not been migrated to PostgreSQL. No fallback was attempted.")
  }
}
