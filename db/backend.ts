export type DatabaseBackend = "d1" | "postgres"

/**
 * PostgreSQL is the default backend. D1 is used only when CN_DB_BACKEND=d1 is
 * set explicitly. Any explicit selection is strict, and a PostgreSQL
 * connection still has to pass the adapter's DATABASE_URL or local gates.
 */
export function selectedDatabaseBackend(source: Record<string, string | undefined> = process.env): DatabaseBackend {
  const selected = source.CN_DB_BACKEND?.trim()
  if (!selected || selected === "postgres") return "postgres"
  if (selected === "d1") {
    if (source.DATABASE_URL?.trim()) throw new Error("DATABASE_URL must be unset when CN_DB_BACKEND=d1.")
    return "d1"
  }
  throw new Error("CN_DB_BACKEND must be either d1 or postgres.")
}

export function requireD1Backend(source: Record<string, string | undefined> = process.env) {
  if (selectedDatabaseBackend(source) !== "d1") {
    throw new Error("This D1 database path has not been migrated to PostgreSQL. No fallback was attempted.")
  }
}
