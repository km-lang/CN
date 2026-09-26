export type ProviderName = "coresignal" | "lusha"
export type ProviderMode = "mock" | "live"

type ProviderRuntimeEnvironment = {
  CORESIGNAL_API_KEY?: string
  CORESIGNAL_LIVE_ENABLED?: string
  CORESIGNAL_LIVE_SEARCH_MAX_RESULTS?: string
  CORESIGNAL_LIVE_REFRESH_MAX_PROFILES?: string
  LUSHA_API_KEY?: string
  LUSHA_LIVE_ENABLED?: string
  LUSHA_SIGNALS_LIVE_ENABLED?: string
  LUSHA_SIGNALS_ENTITLEMENT?: string
  LUSHA_SIGNALS_ENTITLEMENT_VERIFIED_AT?: string
  LUSHA_SIGNALS_ENTITLEMENT_SOURCE?: string
}

function runtimeEnvironment() {
  return process.env as ProviderRuntimeEnvironment
}

function enabled(value?: string) {
  return value?.trim().toLowerCase() === "true"
}

export function providerMode(provider: ProviderName): ProviderMode {
  const values = runtimeEnvironment()
  if (provider === "coresignal") return enabled(values.CORESIGNAL_LIVE_ENABLED) ? "live" : "mock"
  return enabled(values.LUSHA_LIVE_ENABLED) ? "live" : "mock"
}

export function providerConfigured(provider: ProviderName) {
  const values = runtimeEnvironment()
  if (provider === "coresignal") return Boolean(values.CORESIGNAL_API_KEY?.trim())
  return Boolean(values.LUSHA_API_KEY?.trim())
}

export function providerSecret(provider: ProviderName) {
  const values = runtimeEnvironment()
  if (provider === "coresignal") return values.CORESIGNAL_API_KEY?.trim() ?? ""
  return values.LUSHA_API_KEY?.trim() ?? ""
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export function coresignalLiveSearchMaximum() {
  return boundedInteger(runtimeEnvironment().CORESIGNAL_LIVE_SEARCH_MAX_RESULTS, 20, 20)
}

export function coresignalLiveRefreshMaximum() {
  return boundedInteger(runtimeEnvironment().CORESIGNAL_LIVE_REFRESH_MAX_PROFILES, 1, 1)
}

export function signalsRuntimeStatus() {
  const values = runtimeEnvironment()
  const configuredEntitlement = values.LUSHA_SIGNALS_ENTITLEMENT?.trim().toLowerCase()
  const entitlement = configuredEntitlement === "confirmed" ? "confirmed" : configuredEntitlement === "not_entitled" ? "not_entitled" : "unknown"
  return {
    liveEnabled: enabled(values.LUSHA_SIGNALS_LIVE_ENABLED),
    entitlement,
    implementationStatus: "ready" as const,
    lastVerifiedAt: values.LUSHA_SIGNALS_ENTITLEMENT_VERIFIED_AT?.trim() ?? "",
    verificationSource: values.LUSHA_SIGNALS_ENTITLEMENT_SOURCE?.trim() ?? "",
  } as const
}
