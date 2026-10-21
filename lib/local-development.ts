type LocalDevelopmentEnvironment = {
  NODE_ENV?: string
  LOCAL_DEV_AUTH_ENABLED?: string
  LOCAL_DEV_AUTH_ROLE?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_HOST?: string
  LOCAL_CORESIGNAL_SEARCH_ENABLED?: string
  CORESIGNAL_ES_DSL_PREVIEW_ENABLED?: string
  CORESIGNAL_ES_DSL_PREVIEW_ENTITLEMENT?: string
  CORESIGNAL_LIVE_ENABLED?: string
  CORESIGNAL_API_KEY?: string
  CORESIGNAL_COLLECT_ENABLED?: string
  CORESIGNAL_COLLECT_ENTITLEMENT?: string
  CORESIGNAL_COLLECT_MOCK_TRANSPORT?: string
  LOCAL_PROVIDER_LIVE_DEMO_ENABLED?: string
  LOCAL_PROVIDER_LIVE_DEMO_HOST?: string
  BRIGHTDATA_LIVE_ENABLED?: string
  BRIGHTDATA_API_TOKEN?: string
  BRIGHTDATA_DATASET_ID?: string
  BRIGHTDATA_MOCK_TRANSPORT?: string
  BRIGHTDATA_HUMAN_TRIAL_ENABLED?: string
  BRIGHTDATA_HUMAN_TRIAL_TARGET?: string
  LOCAL_DEV_D1_PERSIST_PATH?: string
  CORESIGNAL_WEBHOOK_MOCK_TRANSPORT?: string
}

export function localBrightDataLiveDemoEnabled(values: LocalDevelopmentEnvironment = process.env) {
  return localDevelopmentAuthEnabled(values)
    && values.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && values.LOCAL_PROVIDER_LIVE_DEMO_ENABLED === "true"
    && isLoopbackHost(values.LOCAL_PROVIDER_LIVE_DEMO_HOST)
    && values.BRIGHTDATA_LIVE_ENABLED === "true"
    && Boolean(values.BRIGHTDATA_API_TOKEN?.trim())
    && Boolean(values.BRIGHTDATA_DATASET_ID?.trim())
}

export function localBrightDataMockTransportEnabled(values: LocalDevelopmentEnvironment = process.env) {
  return localDevelopmentAuthEnabled(values)
    && values.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && isLoopbackHost(values.LOCAL_PROVIDER_LIVE_DEMO_HOST)
    && values.BRIGHTDATA_MOCK_TRANSPORT === "true"
}

export function localBrightDataHumanTrialEnabled(values: LocalDevelopmentEnvironment = process.env) {
  const path = values.LOCAL_DEV_D1_PERSIST_PATH?.trim() ?? ""
  return localBrightDataLiveDemoEnabled(values)
    && values.BRIGHTDATA_HUMAN_TRIAL_ENABLED === "true"
    && values.BRIGHTDATA_MOCK_TRANSPORT !== "true"
    && values.CORESIGNAL_WEBHOOK_MOCK_TRANSPORT === "true"
    && (path.startsWith("/tmp/") || path.startsWith("/private/tmp/"))
    && Boolean(values.BRIGHTDATA_HUMAN_TRIAL_TARGET?.trim())
}

export function localIsolatedDiscoveryMockEnabled(values: LocalDevelopmentEnvironment = process.env) {
  const path = values.LOCAL_DEV_D1_PERSIST_PATH?.trim() ?? ""
  return localDevelopmentAuthEnabled(values)
    && values.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && values.CORESIGNAL_WEBHOOK_MOCK_TRANSPORT === "true"
    && (path.startsWith("/tmp/") || path.startsWith("/private/tmp/"))
    && !path.split("/").includes("..")
}

export function localCoresignalCollectMockTransportEnabled(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return localDevelopmentAuthEnabled(values)
    && isLoopbackHost(values.LOCAL_CORESIGNAL_LIVE_DEMO_HOST)
    && values.CORESIGNAL_COLLECT_ENABLED === "true"
    && values.CORESIGNAL_COLLECT_ENTITLEMENT === "confirmed"
    && values.CORESIGNAL_COLLECT_MOCK_TRANSPORT === "true"
}

export function localDevelopmentAuthEnabled(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return values.NODE_ENV === "development"
    && values.LOCAL_DEV_AUTH_ENABLED === "true"
    && localDevelopmentAuthRole(values) !== null
}

export function localDevelopmentAuthRole(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return values.LOCAL_DEV_AUTH_ROLE === "ADMIN" || values.LOCAL_DEV_AUTH_ROLE === "PCOM"
    ? values.LOCAL_DEV_AUTH_ROLE
    : null
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

export function localCoresignalSearchEnabled(
  values: LocalDevelopmentEnvironment = process.env,
) {
  return localCoresignalLiveDemoEnabled(values)
    && values.LOCAL_DEV_AUTH_ROLE === "ADMIN"
    && values.LOCAL_CORESIGNAL_SEARCH_ENABLED === "true"
}

export function localDevelopmentSecurityContext(
  values: LocalDevelopmentEnvironment = process.env,
) {
  const role = localDevelopmentAuthRole(values)
  if (!role) throw new Error("LOCAL_DEV_AUTH_ROLE must be ADMIN or PCOM when local authentication is enabled.")
  return localDevelopmentSecurityContextForRole(role)
}

export function localDevelopmentSecurityContextForRole(role: "ADMIN" | "PCOM") {
  const roleLabel = role === "PCOM" ? "PCOM" : "Admin"
  const localIdentityId = role === "PCOM" ? 2 : 1
  return {
    userId: localIdentityId,
    identityId: localIdentityId,
    provider: "chatgpt",
    externalIdentity: `local-development-${role.toLowerCase()}`,
    email: `local.${role.toLowerCase()}@example.test`,
    displayName: `Local Development ${roleLabel}`,
    role,
  } as const
}
