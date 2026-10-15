import { chatGPTSignInPath } from "@/app/chatgpt-auth"
import { withBasePath } from "@/lib/app-config"
import { loginReturnPath, type LoginIntent } from "@/lib/login-intent"

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

export function loginEntryResponse(intent: LoginIntent) {
  const admin = intent === "admin"
  const returnTo = loginReturnPath(intent)
  const googleHref = withBasePath(`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`)
  const recoveryHref = chatGPTSignInPath(withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`))
  const title = admin ? "Admin sign in" : "PCOM sign in"
  const description = admin
    ? "Access governance, provider oversight, data quality and system audit tools. Your server-resolved account must have the Admin role."
    : "Open the placement workspace for alumni research, ownership, outreach and follow-ups. Your server-resolved account must have PCOM or Admin access."
  const secondary = admin ? `<a class="secondary" href="${escapeHtml(recoveryHref)}">Admin recovery with ChatGPT</a>` : ""
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Corporate Network</title><style>body{margin:0;background:#f4f7f8;color:#17313f;font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(440px,calc(100vw - 32px));box-sizing:border-box;background:white;border:1px solid #d9e2e7;border-radius:18px;padding:32px;box-shadow:0 18px 50px #17313f18}.mark{width:48px;height:48px;border-radius:14px;background:#17313f;color:white;display:grid;place-items:center;font-weight:800}h1{margin:24px 0 8px;font-size:28px}p{color:#526875}.action,.secondary{display:block;text-align:center;border-radius:10px;padding:12px 16px;margin-top:20px;text-decoration:none;font-weight:700}.action{background:#17313f;color:white}.secondary{border:1px solid #bccbd3;color:#17313f}.note{display:block;margin-top:20px;color:#71818e;font-size:13px}</style></head><body><main class="card"><div class="mark">CN</div><h1>${title}</h1><p>${description}</p><a class="action" href="${escapeHtml(googleHref)}">Continue with IIM Lucknow</a>${secondary}<span class="note">Choosing an entry point never grants a role. Corporate Network resolves and rechecks your approved account on the server.</span></main></body></html>`
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}
