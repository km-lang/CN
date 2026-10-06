import type { SecurityContext } from "@/lib/security"

export class IntelligenceServiceUnavailableError extends Error {}

function configuration() {
  const baseUrl = process.env.INTELLIGENCE_SERVICE_URL?.trim().replace(/\/$/, "") ?? ""
  const secret = process.env.INTELLIGENCE_SERVICE_SECRET?.trim() ?? ""
  if (!baseUrl || !secret) throw new IntelligenceServiceUnavailableError("Alumni Profile Intelligence is not configured for this environment.")
  return { baseUrl, secret }
}

function safeError(value: unknown) {
  if (!value || typeof value !== "object") return "The intelligence service request failed."
  const message = String((value as { error?: unknown }).error ?? "")
  return message && message.length <= 500 ? message : "The intelligence service request failed."
}

export async function intelligenceRequest<T>(context: SecurityContext, path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, secret } = configuration()
  const requestId = crypto.randomUUID()
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        ...init.headers,
        authorization: `Bearer ${secret}`,
        "x-cn-user-id": String(context.userId),
        "x-cn-role": context.role,
        "x-cn-request-id": requestId,
      },
    })
  } catch {
    throw new IntelligenceServiceUnavailableError("Alumni Profile Intelligence is unavailable. No provider action was started.")
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(safeError(payload)) as Error & { status?: number; code?: string }
    error.status = response.status
    error.code = typeof payload?.code === "string" ? payload.code : "intelligence_error"
    throw error
  }
  return payload as T
}

export function intelligenceErrorResponse(error: unknown) {
  if (error instanceof IntelligenceServiceUnavailableError) return Response.json({ error: error.message, code: "service_unavailable" }, { status: 503 })
  const typed = error as { message?: string; status?: number; code?: string }
  return Response.json({ error: typed.message || "The intelligence service request failed.", code: typed.code || "intelligence_error" }, { status: typed.status && typed.status >= 400 && typed.status < 600 ? typed.status : 502 })
}
