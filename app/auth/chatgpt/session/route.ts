import { chatGPTSignInPath, hostedRecoveryAvailable } from "@/app/chatgpt-auth"
import { withBasePath } from "@/lib/app-config"
import { absoluteAppUrl, safeReturnPath } from "@/lib/auth-config"
import { authenticationErrorResponse } from "@/lib/auth-responses"
import { createAppSessionToken, sessionCookie } from "@/lib/auth-session"
import { roleHome } from "@/lib/login-intent"
import { AccessError, identityFromRequest, resolveAuthorizedIdentity } from "@/lib/security"

export async function GET(request: Request) {
  if (!hostedRecoveryAvailable(request.url)) {
    return authenticationErrorResponse("ChatGPT recovery unavailable", "Open the hosted Corporate Network site to use ChatGPT recovery.", 503)
  }
  const url = new URL(request.url)
  const returnTo = safeReturnPath(url.searchParams.get("return_to"))
  const identity = identityFromRequest(request)
  if (!identity) {
    const sessionReturn = withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`)
    return new Response(null, { status: 302, headers: { location: new URL(chatGPTSignInPath(sessionReturn), request.url).toString(), "cache-control": "no-store" } })
  }
  try {
    const context = await resolveAuthorizedIdentity(identity)
    const session = await createAppSessionToken({ applicationUserId: context.userId, applicationIdentityId: context.identityId, provider: context.provider })
    const destination = returnTo === "/" ? roleHome(context.role) : returnTo
    return new Response(null, { status: 302, headers: { location: absoluteAppUrl(destination), "set-cookie": sessionCookie(session), "cache-control": "no-store" } })
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "ChatGPT recovery authentication could not be completed."
    return authenticationErrorResponse("Corporate Network access unavailable", message, error instanceof AccessError ? error.status : 403)
  }
}
