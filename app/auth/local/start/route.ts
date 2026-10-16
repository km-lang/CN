import { safeReturnPath } from "@/lib/auth-config"
import { authenticationErrorResponse } from "@/lib/auth-responses"
import { clearSessionCookie, createAppSessionToken, sessionCookie } from "@/lib/auth-session"
import { landingForRole, parseLoginIntent } from "@/lib/login-intent"
import { isLoopbackHost, localDevelopmentAuthEnabled, localDevelopmentSecurityContextForRole } from "@/lib/local-development"
import { AccessError, resolveSessionIdentity } from "@/lib/security"

function unavailable(message: string, status: 401 | 403 = 403) {
  const response = authenticationErrorResponse("Local sign-in unavailable", message, status)
  response.headers.append("set-cookie", clearSessionCookie({ secure: false }))
  return response
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const intent = parseLoginIntent(url.searchParams.get("intent"))
  if (!localDevelopmentAuthEnabled() || !isLoopbackHost(url.host)) {
    return unavailable("Local development authentication is unavailable.")
  }
  if (!intent) return unavailable("Choose a supported local Admin or PCOM entry point.")

  const expectedRole = intent === "admin" ? "ADMIN" : "PCOM"
  const fixture = localDevelopmentSecurityContextForRole(expectedRole)
  try {
    const now = Math.floor(Date.now() / 1000)
    const context = await resolveSessionIdentity({
      kind: "app_session",
      version: 1,
      applicationUserId: fixture.userId,
      applicationIdentityId: fixture.identityId,
      provider: fixture.provider,
      issuedAt: now,
      expiresAt: now + 60,
    })
    if (context.role !== expectedRole || context.externalIdentity !== fixture.externalIdentity) {
      return unavailable("The configured local fixture identity does not match this entry point.")
    }
    const landing = landingForRole(context.role, intent)
    if (!landing.allowed) return unavailable(landing.reason)
    const session = await createAppSessionToken({ applicationUserId: context.userId, applicationIdentityId: context.identityId, provider: context.provider })
    const returnTo = safeReturnPath(url.searchParams.get("return_to"))
    const destination = returnTo === "/" ? landing.destination : returnTo
    return new Response(null, { status: 302, headers: { location: new URL(destination, request.url).toString(), "set-cookie": sessionCookie(session, { secure: false }), "cache-control": "no-store" } })
  } catch (error) {
    const missingFixture = error instanceof AccessError && error.code === "invalid_session_identity"
    const message = missingFixture
      ? "The selected local development identity is unavailable. Complete the supported local setup, restart the application, and try again."
      : error instanceof AccessError ? error.message : "The local fixture identity could not be verified."
    return unavailable(message, error instanceof AccessError ? error.status : 401)
  }
}
