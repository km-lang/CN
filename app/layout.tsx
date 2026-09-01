import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Corporate Network",
  description: "Placement-focused alumni discovery, company intelligence and outreach tracking.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  other: { "codex-preview": "development" },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
