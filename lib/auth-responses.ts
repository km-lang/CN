import { appConfig, withBasePath } from "@/lib/app-config"

export function authenticationErrorResponse(title: string, message: string, status = 403) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | ${escapeHtml(appConfig.name)}</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f4f6f8;color:#15212b;margin:0;min-height:100vh;display:grid;place-items:center}.card{width:min(520px,calc(100% - 40px));background:white;border:1px solid #dbe2e8;border-radius:18px;padding:32px;box-shadow:0 18px 50px #14212b18}.mark{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#173f36;color:white;font-weight:800}h1{font-size:1.7rem;margin:20px 0 10px}p{line-height:1.6;color:#50616d}a{display:inline-block;margin-top:14px;color:#173f36;font-weight:700}</style></head><body><main class="card"><span class="mark">${escapeHtml(appConfig.shortName)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(withBasePath("/"))}">Return to Corporate Network</a></main></body></html>`
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character)
}
