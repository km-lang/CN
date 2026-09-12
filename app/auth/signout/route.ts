import { chatGPTSignOutPath } from "@/app/chatgpt-auth"
import { absoluteAppUrl } from "@/lib/auth-config"
import { withBasePath } from "@/lib/app-config"
import { clearSessionCookie } from "@/lib/auth-session"

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider")
  const location = provider === "chatgpt"
    ? new URL(chatGPTSignOutPath(withBasePath("/")), request.url).toString()
    : absoluteAppUrl("/")
  return new Response(null, { status: 302, headers: { location, "set-cookie": clearSessionCookie(), "cache-control": "no-store" } })
}
