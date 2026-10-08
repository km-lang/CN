type LocalDevelopmentEnvironment = {
  NODE_ENV?: string
  LOCAL_DEV_AUTH_ENABLED?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_HOST?: string
  CORESIGNAL_LIVE_ENABLED?: string
  CORESIGNAL_API_KEY?: string
}

export function localDevelopmentAuthEnabled(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return values.NODE_ENV === "development" && values.LOCAL_DEV_AUTH_ENABLED === "true"
}

export function isLoopbackHost(host: string | null | undefined) {
  const normalized = (host ?? "").trim().toLowerCase()
  const closingBracket = normalized.indexOf("]")
  const hostname = normalized.startsWith("[") && closingBracket > 0
    ? normalized.slice(1, closingBracket)
    : normalized.split(":", 1)[0]
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

export function localCoresignalLiveDemoEnabled(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return localDevelopmentAuthEnabled(values)
    && values.LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED === "true"
    && isLoopbackHost(values.LOCAL_CORESIGNAL_LIVE_DEMO_HOST)
    && values.CORESIGNAL_LIVE_ENABLED === "true"
    && Boolean(values.CORESIGNAL_API_KEY?.trim())
}

export function localDevelopmentSecurityContext() {
  return {
    userId: 1,
    identityId: 1,
    provider: "chatgpt",
    externalIdentity: "local-development-admin",
    email: "local.admin@example.test",
    displayName: "Local Development Admin",
    role: "ADMIN",
  } as const
}
