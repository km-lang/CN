import { withBasePath } from "@/lib/app-config"
import { clearSessionCookie } from "@/lib/auth-session"
import { parseLoginIntent } from "@/lib/login-intent"
import { isLoopbackHost } from "@/lib/local-development"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const intent = parseLoginIntent(requestUrl.searchParams.get("intent"))
  const destination = withBasePath(intent ? `/login/${intent}` : "/")
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(destination, requestUrl).toString(),
      "set-cookie": clearSessionCookie({ secure: !isLoopbackHost(requestUrl.host) }),
      "cache-control": "no-store",
    },
  })
}
