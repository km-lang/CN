import type { MetadataRoute } from "next"

import { appConfig, assetPath } from "@/lib/app-config"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.name,
    short_name: appConfig.shortName,
    description: appConfig.tagline,
    start_url: appConfig.basePath || "/",
    scope: `${appConfig.basePath || ""}/`,
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#173f3a",
    icons: [{ src: assetPath("/favicon.svg"), sizes: "any", type: "image/svg+xml" }],
  }
}
