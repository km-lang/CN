import { absoluteAppUrl } from "@/lib/auth-config"
import { authenticationErrorResponse } from "@/lib/auth-responses"
import { APP_SESSION_COOKIE, GOOGLE_OAUTH_COOKIE, clearGoogleOAuthCookie, cookieValue, createAppSessionToken, sessionCookie, verifyGoogleOAuthToken } from "@/lib/auth-session"
import { exchangeGoogleAuthorizationCode, GoogleOidcError } from "@/lib/google-oidc"
import { AccessError, resolveAuthorizedIdentity, writeSecurityAudit } from "@/lib/security"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const state = url.searchParams.get("state") ?? ""
  const code = url.searchParams.get("code") ?? ""
  const providerError = url.searchParams.get("error")
  try {
    if (providerError) throw new GoogleOidcError("Google Workspace sign-in was cancelled or declined.", "provider_denied")
    const transient = await verifyGoogleOAuthToken(cookieValue(request.headers.get("cookie"), GOOGLE_OAUTH_COOKIE))
    if (!transient || !state || state !== transient.state || !code) throw new GoogleOidcError("Google sign-in state could not be verified.", "invalid_oauth_state")
    const identity = await exchangeGoogleAuthorizationCode(code, transient.codeVerifier, transient.nonce)
    const context = await resolveAuthorizedIdentity(identity)
    const session = await createAppSessionToken({ applicationUserId: context.userId, applicationIdentityId: context.identityId, provider: context.provider })
    const headers = new Headers({ location: absoluteAppUrl(transient.returnTo), "cache-control": "no-store" })
    headers.append("set-cookie", sessionCookie(session))
    headers.append("set-cookie", clearGoogleOAuthCookie())
    return new Response(null, { status: 302, headers })
  } catch (error) {
    const code = error instanceof GoogleOidcError || error instanceof AccessError ? error.code : "authentication_failed"
    await writeSecurityAudit(null, { action: "login_denied", entityType: "application_identity", metadata: { provider: "google_workspace", reason: code }, result: code, source: "google_workspace" }).catch(() => undefined)
    const message = error instanceof GoogleOidcError || error instanceof AccessError ? error.message : "Institutional authentication could not be completed."
    const status = error instanceof AccessError ? error.status : 403
    const response = authenticationErrorResponse("Corporate Network access unavailable", message, status)
    response.headers.append("set-cookie", clearGoogleOAuthCookie())
    response.headers.append("set-cookie", `${APP_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
    return response
  }
}
