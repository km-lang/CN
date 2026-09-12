import { appConfig, withBasePath } from "@/lib/app-config"

export const IDENTITY_PROVIDERS = ["google_workspace", "chatgpt"] as const
export type IdentityProvider = typeof IDENTITY_PROVIDERS[number]

export function googleAllowedDomain() {
  return (process.env.GOOGLE_ALLOWED_DOMAIN ?? "iiml.ac.in").trim().toLowerCase()
}

export function googleOAuthCallbackUrl() {
  const configured = process.env.GOOGLE_OAUTH_CALLBACK_URL?.trim()
  if (configured) return configured
  return absoluteAppUrl("/auth/google/callback")
}

export function absoluteAppUrl(path: string) {
  return new URL(withBasePath(path), `${appConfig.publicUrl}/`).toString()
}

export function googleOAuthConfiguration() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
    callbackUrl: googleOAuthCallbackUrl(),
    allowedDomain: googleAllowedDomain(),
  }
}

export function isGoogleOAuthConfigured() {
  const config = googleOAuthConfiguration()
  return Boolean(config.clientId && config.clientSecret && process.env.AUTH_SESSION_SECRET?.trim())
}

export function safeReturnPath(value: string | null | undefined) {
  const fallback = appConfig.basePath || "/"
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback
  try {
    const url = new URL(value, "https://app.local")
    if (url.origin !== "https://app.local") return fallback
    const reserved = ["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"]
    if (reserved.includes(url.pathname)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
