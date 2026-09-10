import type { Metadata } from "next"
import "./globals.css"

import { appConfig, assetPath } from "@/lib/app-config"

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
