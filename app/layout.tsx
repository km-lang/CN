import type { Metadata } from "next"
import "./globals.css"

import { AccessProvider } from "@/app/access-provider"
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "@/app/chatgpt-auth"
import { appConfig, assetPath } from "@/lib/app-config"
import type { AccessSession } from "@/lib/access-types"
import { AccessError, resolveAuthorizedIdentity, toAccessSession } from "@/lib/security"

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
  const user = await getChatGPTUser()
  const returnTo = appConfig.basePath || "/"
  if (!user) {
    return <html lang="en"><body><AccessPage title="Sign in to Corporate Network" message="Authentication is required before any alumni, outreach, engagement, or provider information is shown." actionHref={chatGPTSignInPath(returnTo)} actionLabel="Sign in with ChatGPT" /></body></html>
  }

  let session: AccessSession | null = null
  let accessMessage = ""
  try {
    const context = await resolveAuthorizedIdentity({ externalIdentity: user.userId, email: user.email.toLowerCase(), displayName: user.displayName })
    session = toAccessSession(context, chatGPTSignOutPath(returnTo))
  } catch (error) {
    accessMessage = error instanceof AccessError ? error.message : "Corporate Network access could not be verified. Please try again later."
  }
  if (!session) return <html lang="en"><body><AccessPage title="Access unavailable" message={accessMessage} actionHref={chatGPTSignOutPath(returnTo)} actionLabel="Use another account" identity={user.email} /></body></html>
  return <html lang="en"><body><AccessProvider session={session}>{children}</AccessProvider></body></html>
}

function AccessPage({ title, message, actionHref, actionLabel, identity }: { title: string; message: string; actionHref: string; actionLabel: string; identity?: string }) {
  return <main className="access-page"><section className="access-card"><div className="brand-mark">{appConfig.shortName}</div><p className="eyebrow">{appConfig.subtitle}</p><h1>{title}</h1><p>{message}</p>{identity && <small>Signed in as {identity}</small>}<a className="access-action" href={actionHref} target="_top">{actionLabel}</a><span>Access is granted by an administrator and denied by default.</span></section></main>
}
