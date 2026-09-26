export function signalsPresentation(input: { development: boolean; liveEnabled: boolean; entitlement: string; configured: boolean }) {
  if (input.development) return { label: "Signals disabled in local development", available: false, reason: "Live provider calls are disabled in local development." }
  if (!input.configured) return { label: "Configuration required", available: false, reason: "Lusha provider configuration is unavailable." }
  if (input.entitlement !== "confirmed") return { label: input.entitlement === "not_entitled" ? "Account not entitled" : "Validation required", available: false, reason: "Professional Signals entitlement is not confirmed." }
  if (!input.liveEnabled) return { label: "Ready — gate disabled", available: false, reason: "Professional Signals is configured, but its runtime gate is disabled." }
  return { label: "Live", available: true, reason: "Professional Signals is configured and enabled." }
}

export function mailPresentation(input: { development: boolean; mode: string; configured: boolean }) {
  if (input.development) return { label: "Mock mail · sending disabled", warning: true }
  if (input.mode === "live" && input.configured) return { label: "Institutional mail live", warning: false }
  return { label: input.configured ? "Ready — gate disabled" : "Mail configuration required", warning: true }
}
