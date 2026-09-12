import { createGoogleAuthorizationRequest } from "@/lib/google-oidc"
import { createGoogleOAuthToken, googleOAuthCookie } from "@/lib/auth-session"
import { authenticationErrorResponse } from "@/lib/auth-responses"
import { safeReturnPath } from "@/lib/auth-config"

export async function GET(request: Request) {
  try {
    const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return_to"))
    const authorization = await createGoogleAuthorizationRequest(returnTo)
    const token = await createGoogleOAuthToken(authorization)
    return new Response(null, {
      status: 302,
      headers: { location: authorization.authorizationUrl, "set-cookie": googleOAuthCookie(token), "cache-control": "no-store" },
    })
  } catch {
    return authenticationErrorResponse("Google Workspace sign-in unavailable", "Institutional sign-in has not been configured by the administrator yet.", 503)
  }
}
