import { localCoresignalCollectMockTransportEnabled, localCoresignalLiveDemoEnabled, localDevelopmentAuthEnabled } from "@/lib/local-development"

export type ProviderName = "coresignal" | "lusha"
export type ProviderMode = "mock" | "live"

type ProviderRuntimeEnvironment = {
  CORESIGNAL_API_KEY?: string
  CORESIGNAL_LIVE_ENABLED?: string
  CORESIGNAL_SEARCH_ENABLED?: string
  CORESIGNAL_COLLECT_ENABLED?: string
  CORESIGNAL_COLLECT_ENTITLEMENT?: string
  CORESIGNAL_COLLECT_MOCK_TRANSPORT?: string
  CORESIGNAL_LIVE_SEARCH_MAX_RESULTS?: string
  CORESIGNAL_LIVE_REFRESH_MAX_PROFILES?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED?: string
  LOCAL_CORESIGNAL_LIVE_DEMO_HOST?: string
  LOCAL_DEV_AUTH_ENABLED?: string
  NODE_ENV?: string
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
  if (provider === "coresignal") {
    if (localDevelopmentAuthEnabled(values)) {
      return localCoresignalLiveDemoEnabled(values) ? "live" : "mock"
    }
    return enabled(values.CORESIGNAL_LIVE_ENABLED) ? "live" : "mock"
  }
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
  if (localCoresignalLiveDemoEnabled(runtimeEnvironment())) return 1
  return boundedInteger(runtimeEnvironment().CORESIGNAL_LIVE_SEARCH_MAX_RESULTS, 20, 20)
}

export function coresignalLiveRefreshMaximum() {
  return boundedInteger(runtimeEnvironment().CORESIGNAL_LIVE_REFRESH_MAX_PROFILES, 1, 1)
}

export function coresignalRegularSearchEnabled() {
  const values = runtimeEnvironment()
  return providerMode("coresignal") === "live" && enabled(values.CORESIGNAL_SEARCH_ENABLED)
}

export type CoresignalCollectEntitlement = "unknown" | "confirmed" | "not_entitled"

export function coresignalCollectEntitlement(): CoresignalCollectEntitlement {
  const configured = runtimeEnvironment().CORESIGNAL_COLLECT_ENTITLEMENT?.trim().toLowerCase()
  return configured === "confirmed" ? "confirmed" : configured === "not_entitled" ? "not_entitled" : "unknown"
}

export function coresignalCollectEnabled() {
  const values = runtimeEnvironment()
  return (localCoresignalCollectMockTransportEnabled(values) || localCoresignalLiveDemoEnabled(values))
    && enabled(values.CORESIGNAL_COLLECT_ENABLED)
    && coresignalCollectEntitlement() === "confirmed"
}

export function coresignalCollectMockTransportEnabled() {
  return localCoresignalCollectMockTransportEnabled(runtimeEnvironment())
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
