export type DiscoveryLimitValidation =
  | { ok: true; requested: number; maximumAllowed: number }
  | { ok: false; reason: "invalid" | "remaining_allowance" | "provider_maximum"; maximumAllowed: number; message: string }

export function discoveryApplicationUnits(requestedProfiles: number, searchOperationReserve = 0) {
  const requested = Number.isInteger(requestedProfiles) ? Math.max(0, requestedProfiles) : 0
  const reserve = Number.isInteger(searchOperationReserve) ? Math.max(0, searchOperationReserve) : 0
  return requested + reserve
}

export function maximumDiscoveryCount(remainingAllowance: number, providerSafeMaximum: number, searchOperationReserve = 0) {
  const remaining = Number.isInteger(remainingAllowance) ? Math.max(0, remainingAllowance) : 0
  const providerMaximum = Number.isInteger(providerSafeMaximum) ? Math.max(0, providerSafeMaximum) : 0
  const reserve = Number.isInteger(searchOperationReserve) ? Math.max(0, searchOperationReserve) : 0
  return Math.min(Math.max(0, remaining - reserve), providerMaximum)
}

export function validateDiscoveryCount(
  value: unknown,
  remainingAllowance: number,
  providerSafeMaximum: number,
  searchOperationReserve = 0,
): DiscoveryLimitValidation {
  const maximumAllowed = maximumDiscoveryCount(remainingAllowance, providerSafeMaximum, searchOperationReserve)
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { ok: false, reason: "invalid", maximumAllowed, message: "Enter a whole number of profiles from 1 upward." }
  }
  if (discoveryApplicationUnits(value, searchOperationReserve) > remainingAllowance) {
    return { ok: false, reason: "remaining_allowance", maximumAllowed, message: `The request exceeds the ${Math.max(0, remainingAllowance)} remaining Corporate Network professional-data application units.` }
  }
  if (value > providerSafeMaximum) {
    return { ok: false, reason: "provider_maximum", maximumAllowed, message: `The request exceeds the configured per-search safety maximum of ${Math.max(0, providerSafeMaximum)} profiles.` }
  }
  return { ok: true, requested: value, maximumAllowed }
}
