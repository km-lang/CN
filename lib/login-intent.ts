import type { ApplicationRole } from "@/lib/access-types"

export const LOGIN_INTENTS = ["admin", "pcom"] as const
export type LoginIntent = typeof LOGIN_INTENTS[number]

export function parseLoginIntent(value: unknown): LoginIntent | null {
  return LOGIN_INTENTS.includes(String(value) as LoginIntent) ? value as LoginIntent : null
}

export function landingForRole(role: ApplicationRole, intent: LoginIntent) {
  if (intent === "admin") {
    return role === "ADMIN"
      ? { allowed: true as const, destination: "/?tab=admin" }
      : { allowed: false as const, destination: "/?tab=overview", reason: "Admin access requires an active Admin account." }
  }
  if (role === "DEVELOPER") {
    return { allowed: false as const, destination: "/?tab=overview", reason: "The PCOM workspace requires an active PCOM or Admin account." }
  }
  return { allowed: true as const, destination: "/?tab=overview" }
}

export function loginReturnPath(intent: LoginIntent) {
  return `/auth/landing?intent=${intent}`
}

export function roleHome(role: ApplicationRole) {
  return role === "ADMIN" ? "/?tab=admin" : "/?tab=overview"
}
