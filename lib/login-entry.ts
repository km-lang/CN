import { isGoogleOAuthConfigured } from "@/lib/auth-config"
import { chatGPTSignInPath, hostedRecoveryAvailable } from "@/app/chatgpt-auth"
import { withBasePath } from "@/lib/app-config"
import { loginReturnPath, type LoginIntent } from "@/lib/login-intent"
import { isLoopbackHost, localDevelopmentAuthEnabled } from "@/lib/local-development"

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function loginEntryResponse(request: Request, intent: LoginIntent) {
  const admin = intent === "admin"
  const returnTo = loginReturnPath(intent)
  const googleHref = withBasePath(`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`)
  const localHref = withBasePath(`/auth/local/start?intent=${intent}&return_to=${encodeURIComponent(returnTo)}`)
  const recoveryHref = chatGPTSignInPath(withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`))
  const localAvailable = localDevelopmentAuthEnabled() && isLoopbackHost(new URL(request.url).host)
  const title = admin ? "Admin sign in" : "PCOM sign in"
  const description = admin
    ? "Access governance, provider oversight, data quality and system audit tools. Your server-resolved account must have the Admin role."
    : "Open the placement workspace for alumni research, ownership, outreach and follow-ups. Your server-resolved account must have PCOM or Admin access."
  const primaryHref = localAvailable ? localHref : googleHref
  const primaryLabel = localAvailable ? `Enter local ${admin ? "Admin" : "PCOM"} workspace` : "Continue with IIM Lucknow"
  const localNote = localAvailable ? `<p class="local-note"><strong>Development-only access</strong>This loopback-only entry uses a server-approved local fixture identity. Google Workspace is not required.</p>` : ""
  const primary = localAvailable || isGoogleOAuthConfigured()
    ? `<a class="action" href="${escapeHtml(primaryHref)}">${primaryLabel}</a>`
    : '<p class="note">Google Workspace sign-in requires administrator configuration.</p>'
  let secondary = ""
  if (admin && !localAvailable) {
    secondary = hostedRecoveryAvailable(request.url)
      ? `<a class="secondary" target="_top" href="${escapeHtml(recoveryHref)}">Admin recovery with ChatGPT</a>`
      : '<p class="note">ChatGPT recovery is available on the hosted Corporate Network site.</p>'
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Corporate Network</title><style>body{margin:0;background:#f4f7f8;color:#17313f;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(460px,calc(100vw - 32px));box-sizing:border-box;background:white;border:1px solid #d9e2e7;border-radius:18px;padding:32px;box-shadow:0 18px 50px #17313f18}.mark{width:48px;height:48px;border-radius:14px;background:#8c1d2c;color:white;display:grid;place-items:center;font-weight:800}h1{margin:24px 0 8px;font-size:28px}p{color:#526875}.action,.secondary{display:block;text-align:center;border-radius:10px;padding:12px 16px;margin-top:20px;text-decoration:none;font-weight:700}.action{background:#17313f;color:white}.secondary{border:1px solid #bccbd3;color:#17313f}.local-note{display:grid;gap:2px;padding:12px;margin:20px 0 0;border:1px solid #c6d9d2;border-radius:10px;background:#f0f8f5;font-size:13px}.local-note strong{color:#17633a}.note{display:block;margin-top:20px;color:#71818e;font-size:13px}</style></head><body><main class="card"><div class="mark">CN</div><h1>${title}</h1><p>${description}</p>${localNote}${primary}${secondary}<span class="note">Choosing an entry point never grants an arbitrary role. Corporate Network resolves and rechecks the approved server-side identity.</span></main></body></html>`
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}
