export type PublicAppEnvironment = {
  NEXT_PUBLIC_APP_NAME?: string
  NEXT_PUBLIC_APP_SHORT_NAME?: string
  NEXT_PUBLIC_APP_SUBTITLE?: string
  NEXT_PUBLIC_APP_TAGLINE?: string
  NEXT_PUBLIC_APP_PUBLIC_URL?: string
  NEXT_PUBLIC_APP_BASE_PATH?: string
}

const defaults = {
  name: "Corporate Network",
  subtitle: "Placement Committee Workspace",
  tagline: "Connect alumni relationships to corporate opportunities.",
  publicUrl: "http://localhost:3000",
}

function text(value: string | undefined, fallback: string) {
  return value?.trim() || fallback
}

export function normalizeBasePath(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === "/") return ""
  const pathname = `/${trimmed.replace(/^\/+|\/+$/g, "")}`
  if (pathname.includes("?") || pathname.includes("#") || pathname.includes("//")) {
    throw new Error("APP_BASE_PATH must be a simple URL path such as /corporate_network.")
  }
  return pathname
}

function deriveShortName(name: string) {
  if (/^[A-Z0-9]{2,6}$/.test(name)) return name
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map(part => part[0]?.toUpperCase()).join("") || "APP"
}

function normalizePublicUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Unsupported protocol")
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return defaults.publicUrl
  }
}

export function createAppConfig(environment: PublicAppEnvironment = {}) {
  const name = text(environment.NEXT_PUBLIC_APP_NAME, defaults.name)
  return Object.freeze({
    name,
    shortName: text(environment.NEXT_PUBLIC_APP_SHORT_NAME, deriveShortName(name)),
    subtitle: text(environment.NEXT_PUBLIC_APP_SUBTITLE, defaults.subtitle),
    tagline: text(environment.NEXT_PUBLIC_APP_TAGLINE, defaults.tagline),
    publicUrl: normalizePublicUrl(text(environment.NEXT_PUBLIC_APP_PUBLIC_URL, defaults.publicUrl)),
    basePath: normalizeBasePath(environment.NEXT_PUBLIC_APP_BASE_PATH),
  })
}

export const appConfig = createAppConfig({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_APP_SHORT_NAME: process.env.NEXT_PUBLIC_APP_SHORT_NAME,
  NEXT_PUBLIC_APP_SUBTITLE: process.env.NEXT_PUBLIC_APP_SUBTITLE,
  NEXT_PUBLIC_APP_TAGLINE: process.env.NEXT_PUBLIC_APP_TAGLINE,
  NEXT_PUBLIC_APP_PUBLIC_URL: process.env.NEXT_PUBLIC_APP_PUBLIC_URL,
  NEXT_PUBLIC_APP_BASE_PATH: process.env.NEXT_PUBLIC_APP_BASE_PATH,
})

export function withBasePath(path: string, basePath = appConfig.basePath) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  if (!basePath || normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) return normalizedPath
  return `${basePath}${normalizedPath}`
}

export function apiPath(path: string) {
  return withBasePath(path)
}

export function assetPath(path: string) {
  return withBasePath(path)
}
