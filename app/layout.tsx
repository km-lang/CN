import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import "./globals.css"

import { AccessProvider } from "@/app/access-provider"
import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth"
import { appConfig, assetPath, withBasePath } from "@/lib/app-config"
import { APP_SESSION_COOKIE, cookieValue, verifyAppSessionToken } from "@/lib/auth-session"
import type { AccessSession } from "@/lib/access-types"
import { isLoopbackHost, localDevelopmentAuthEnabled, localDevelopmentSecurityContext } from "@/lib/local-development"
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
  let session: AccessSession | null = localDevelopmentAuthEnabled() && isLoopbackHost(requestHeaders.get("host"))
    ? toAccessSession(localDevelopmentSecurityContext(), "")
    : null
  let accessMessage = ""
  if (!session && token) {
    try {
      const claims = await verifyAppSessionToken(token)
      if (!claims) throw new AccessError("Your authentication session has expired. Please sign in again.", 401, "invalid_session")
      const context = await resolveSessionIdentity(claims)
      session = toAccessSession(context, withBasePath(`/auth/signout?provider=${context.provider}`))
    } catch (error) {
      accessMessage = error instanceof AccessError ? error.message : "Corporate Network access could not be verified. Please sign in again."
    }
  }

  if (session) return <html lang="en"><body><AccessProvider session={session}>{children}</AccessProvider></body></html>

  const returnTo = appConfig.basePath || "/"
  const chatGPTUser = await getChatGPTUser()
  if (chatGPTUser && !token) {
    redirect(withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`))
  }
  const googleHref = withBasePath(`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`)
  const chatGPTSessionReturn = withBasePath(`/auth/chatgpt/session?return_to=${encodeURIComponent(returnTo)}`)
  const chatGPTHref = chatGPTSignInPath(chatGPTSessionReturn)
  const message = accessMessage || "Authenticate with your approved institutional identity. Application access is granted separately by an administrator and denied by default."
  return <html lang="en"><body><AccessPage title="Sign in to Corporate Network" message={message} primaryHref={googleHref} primaryLabel="Sign in with IIM Lucknow" secondaryHref={chatGPTHref} secondaryLabel="Sign in with ChatGPT (Admin recovery)" /></body></html>
}

function AccessPage({ title, message, primaryHref, primaryLabel, secondaryHref, secondaryLabel }: { title: string; message: string; primaryHref: string; primaryLabel: string; secondaryHref: string; secondaryLabel: string }) {
  return <main className="access-page"><section className="access-card"><div className="brand-mark">{appConfig.shortName}</div><p className="eyebrow">{appConfig.subtitle}</p><h1>{title}</h1><p>{message}</p><a className="access-action" href={primaryHref} target="_top">{primaryLabel}</a><a className="access-secondary-action" href={secondaryHref} target="_top">{secondaryLabel}</a><span>Authentication does not grant a role. Corporate Network rechecks the approved-user table on every request.</span></section></main>
}
