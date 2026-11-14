import { selectedDatabaseBackend } from "@/db/backend"

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  if ("code" in error && typeof error.code === "string") return error.code
  return "cause" in error ? errorCode(error.cause) : ""
}

/** SQLSTATE (or driver code) of a PostgreSQL error, following Drizzle's `cause` chain. */
export const postgresErrorCode = errorCode

/** Hide SQL and binding details when a selected PostgreSQL read fails. */
export function postgresDatabaseErrorResponse(error: unknown, assumeDatabaseFailure = false): Response | null {
  try { if (selectedDatabaseBackend() !== "postgres") return null } catch { return null }
  if (!assumeDatabaseFailure && (!error || typeof error !== "object" || !("query" in error))) return null
  const unavailable = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND"].includes(errorCode(error))
  console.error("PostgreSQL database failure", { code: errorCode(error) || "unknown", kind: unavailable ? "connection" : "query" })
  return Response.json({ error: unavailable ? "Database connection is unavailable." : "Database operation failed." }, { status: unavailable ? 503 : 500 })
}
