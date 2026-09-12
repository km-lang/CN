export type ProviderName = "pdl" | "lusha"
export type ProviderMode = "mock" | "live"

type ProviderRuntimeEnvironment = {
  PDL_API_KEY?: string
  LUSHA_API_KEY?: string
  PDL_LIVE_ENABLED?: string
  LUSHA_LIVE_ENABLED?: string
  PDL_IIML_SCHOOL_ID?: string
  PDL_LIVE_SEARCH_MAX_RESULTS?: string
  PDL_LIVE_REFRESH_MAX_PROFILES?: string
}

function runtimeEnvironment() {
  return process.env as ProviderRuntimeEnvironment
}

function enabled(value?: string) {
  return value?.trim().toLowerCase() === "true"
}

export function providerMode(provider: ProviderName): ProviderMode {
  const values = runtimeEnvironment()
  return provider === "pdl"
    ? enabled(values.PDL_LIVE_ENABLED) ? "live" : "mock"
    : enabled(values.LUSHA_LIVE_ENABLED) ? "live" : "mock"
}

export function providerConfigured(provider: ProviderName) {
  const values = runtimeEnvironment()
  return provider === "pdl" ? Boolean(values.PDL_API_KEY?.trim()) : Boolean(values.LUSHA_API_KEY?.trim())
}

export function providerSecret(provider: ProviderName) {
  const values = runtimeEnvironment()
  return provider === "pdl" ? values.PDL_API_KEY?.trim() ?? "" : values.LUSHA_API_KEY?.trim() ?? ""
}

export function pdlIimlSchoolId() {
  return runtimeEnvironment().PDL_IIML_SCHOOL_ID?.trim() ?? ""
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export function pdlLiveSearchMaximum() {
  return boundedInteger(runtimeEnvironment().PDL_LIVE_SEARCH_MAX_RESULTS, 5, 5)
}

export function pdlLiveRefreshMaximum() {
  return boundedInteger(runtimeEnvironment().PDL_LIVE_REFRESH_MAX_PROFILES, 1, 1)
}
