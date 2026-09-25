type LocalDevelopmentEnvironment = {
  NODE_ENV?: string
  LOCAL_DEV_AUTH_ENABLED?: string
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
