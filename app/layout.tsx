import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import "./globals.css"

import { AccessProvider } from "@/app/access-provider"
import { getChatGPTUser } from "@/app/chatgpt-auth"
import { appConfig, assetPath, withBasePath } from "@/lib/app-config"
import { APP_SESSION_COOKIE, cookieValue, verifyAppSessionToken } from "@/lib/auth-session"
import type { AccessSession } from "@/lib/access-types"
import { AccessError, resolveSessionIdentity, toAccessSession } from "@/lib/security"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.publicUrl),
  title: `${appConfig.name} | ${appConfig.subtitle}`,
  description: appConfig.tagline,
  applicationName: appConfig.name,
  alternates: { canonical: appConfig.publicUrl },
  icons: { icon: assetPath("/favicon.svg"), shortcut: assetPath("/favicon.svg") },
  manifest: assetPath("/manifest.webmanifest"),
  other: { "codex-preview": "development" },
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers()
  const token = cookieValue(requestHeaders.get("cookie"), APP_SESSION_COOKIE)
  let session: AccessSession | null = null
  let accessMessage = ""
  let sessionRejected = false
  if (!session && token) {
    try {
      const claims = await verifyAppSessionToken(token)
      if (!claims) throw new AccessError("Your authentication session has expired. Please sign in again.", 401, "invalid_session")
      const context = await resolveSessionIdentity(claims)
      const localFixture = context.externalIdentity.startsWith("local-development-")
      session = toAccessSession(context, withBasePath(`/auth/signout?provider=${localFixture ? "local" : context.provider}`))
    } catch (error) {
      sessionRejected = true
      accessMessage = error instanceof AccessError ? error.message : "Corporate Network access could not be verified. Please sign in again."
    }
  }

  if (session) return <html lang="en"><body><AccessProvider session={session}>{children}</AccessProvider></body></html>

  const returnTo = appConfig.basePath || "/"
  const chatGPTUser = await getChatGPTUser()
  if (chatGPTUser && !token) {
    redirect(withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`))
  }
  const message = accessMessage || "Authenticate with your approved institutional identity. Application access is granted separately by an administrator and denied by default."
  const loginPath = (intent: "pcom" | "admin") => withBasePath(sessionRejected ? `/auth/session/recover?intent=${intent}` : `/login/${intent}`)
  return <html lang="en"><body><AccessPage title="Sign in to Corporate Network" message={message} primaryHref={loginPath("pcom")} primaryLabel="PCOM sign in" secondaryHref={loginPath("admin")} secondaryLabel="Admin sign in" /></body></html>
}

function AccessPage({ title, message, primaryHref, primaryLabel, secondaryHref, secondaryLabel }: { title: string; message: string; primaryHref: string; primaryLabel: string; secondaryHref: string; secondaryLabel: string }) {
  return <main className="access-page"><section className="access-card"><div className="brand-mark">{appConfig.shortName}</div><p className="eyebrow">{appConfig.subtitle}</p><h1>{title}</h1><p>{message}</p><a className="access-action" href={primaryHref} target="_top">{primaryLabel}</a><a className="access-secondary-action" href={secondaryHref} target="_top">{secondaryLabel}</a><span>Authentication does not grant a role. Corporate Network rechecks the approved-user table on every request.</span></section></main>
}
