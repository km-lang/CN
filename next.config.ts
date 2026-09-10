import type { NextConfig } from "next"

import { createAppConfig } from "./lib/app-config"

const resolved = createAppConfig({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME,
  NEXT_PUBLIC_APP_SHORT_NAME: process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? process.env.APP_SHORT_NAME,
  NEXT_PUBLIC_APP_SUBTITLE: process.env.NEXT_PUBLIC_APP_SUBTITLE ?? process.env.APP_SUBTITLE,
  NEXT_PUBLIC_APP_TAGLINE: process.env.NEXT_PUBLIC_APP_TAGLINE ?? process.env.APP_TAGLINE,
  NEXT_PUBLIC_APP_PUBLIC_URL: process.env.NEXT_PUBLIC_APP_PUBLIC_URL ?? process.env.APP_PUBLIC_URL,
  NEXT_PUBLIC_APP_BASE_PATH: process.env.NEXT_PUBLIC_APP_BASE_PATH ?? process.env.APP_BASE_PATH,
})

const nextConfig: NextConfig = {
  basePath: resolved.basePath,
  env: {
    NEXT_PUBLIC_APP_NAME: resolved.name,
    NEXT_PUBLIC_APP_SHORT_NAME: resolved.shortName,
    NEXT_PUBLIC_APP_SUBTITLE: resolved.subtitle,
    NEXT_PUBLIC_APP_TAGLINE: resolved.tagline,
    NEXT_PUBLIC_APP_PUBLIC_URL: resolved.publicUrl,
    NEXT_PUBLIC_APP_BASE_PATH: resolved.basePath,
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }]
  },
}

export default nextConfig
