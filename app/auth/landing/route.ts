import { absoluteAppUrl } from "@/lib/auth-config"
import { landingForRole, parseLoginIntent } from "@/lib/login-intent"
import { AccessError, authenticateRequest } from "@/lib/security"

function denied(message: string, status: 401 | 403) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corporate Network access</title></head><body><main><h1>Corporate Network access unavailable</h1><p>${message}</p><a href="/">Return to sign in</a></main></body></html>`
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}

export async function GET(request: Request) {
  try {
    const intent = parseLoginIntent(new URL(request.url).searchParams.get("intent"))
    if (!intent) return denied("Choose the Admin or PCOM sign-in entry point.", 403)
    const context = await authenticateRequest(request)
    const landing = landingForRole(context.role, intent)
    if (!landing.allowed) return denied(landing.reason, 403)
    return new Response(null, { status: 302, headers: { location: absoluteAppUrl(landing.destination), "cache-control": "no-store" } })
  } catch (error) {
    return denied(error instanceof AccessError ? error.message : "Your authenticated account could not be verified.", error instanceof AccessError ? error.status : 401)
  }
}
