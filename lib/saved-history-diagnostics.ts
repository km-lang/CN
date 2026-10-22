/** Minimal diagnostics for an unexpected saved-history failure. Never log SQL, URL, identity, or provider payloads. */
export function savedHistoryFailure(error: unknown, endpoint: "discovery" | "alumni", stage: string) {
  const requestId = crypto.randomUUID()
  const candidate = error && typeof error === "object" ? error as { code?: unknown } : null
  const code = typeof candidate?.code === "string" && /^(SQLITE_[A-Z_]{1,30}|D1_[A-Z_]{1,30})$/.test(candidate.code) ? candidate.code : null
  const errorType = error instanceof Error && ["Error", "SQLiteError", "DrizzleError", "TypeError"].includes(error.name) ? error.name : "Unknown"
  console.error("Saved history request failed", { requestId, endpoint, stage, code, errorType, runtime: process.env.NODE_ENV === "production" ? "production" : "local" })
  return Response.json({ error: "Unable to load saved history. Please retry later and provide the request ID to the administrator.", requestId }, { status: 500, headers: { "x-cn-request-id": requestId, "cache-control": "no-store" } })
}
