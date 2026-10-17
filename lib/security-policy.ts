import { APPLICATION_ROLES, type ApplicationRole } from "@/lib/access-types"

export type Permission =
  | "VIEW_ALUMNI"
  | "EXPORT_DIRECTORY"
  | "VIEW_CONTACTS"
  | "OPERATE_PCOM"
  | "MANAGE_USERS"
  | "MANAGE_PROVIDER_SETTINGS"
  | "VIEW_AUDIT"
  | "MANAGE_PRIVACY"
  | "MANAGE_LIFECYCLE"
  | "VIEW_PROVIDER_STATUS"

const permissions: Record<ApplicationRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(["VIEW_ALUMNI", "EXPORT_DIRECTORY", "VIEW_CONTACTS", "OPERATE_PCOM", "MANAGE_USERS", "MANAGE_PROVIDER_SETTINGS", "VIEW_AUDIT", "MANAGE_PRIVACY", "MANAGE_LIFECYCLE", "VIEW_PROVIDER_STATUS"]),
  PCOM: new Set(["VIEW_ALUMNI", "EXPORT_DIRECTORY", "VIEW_CONTACTS", "OPERATE_PCOM", "MANAGE_PRIVACY", "VIEW_PROVIDER_STATUS"]),
  DEVELOPER: new Set(["VIEW_ALUMNI", "VIEW_PROVIDER_STATUS"]),
}

export function isApplicationRole(value: unknown): value is ApplicationRole {
  return APPLICATION_ROLES.includes(String(value) as ApplicationRole)
}

export function hasPermission(role: ApplicationRole, permission: Permission) {
  return permissions[role].has(permission)
}

export function maskEmail(value: string) {
  if (!value) return ""
  const [local, domain] = value.split("@")
  if (!domain) return "••••••"
  return `${local.slice(0, 1) || "•"}•••••@${domain}`
}

export function maskPhone(value: string) {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  const suffix = digits.slice(-3)
  const prefix = value.trim().startsWith("+") && digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : ""
  return `${prefix}••••• ••${suffix}`.trim()
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (/api.?key|password|secret|token|authorization|cookie/i.test(key)) return "[REDACTED]"
  if (/email/i.test(key) && typeof value === "string") return maskEmail(value)
  if (/phone/i.test(key) && typeof value === "string") return maskPhone(value)
  if (Array.isArray(value)) return value.map(item => sanitizeValue(key, item))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitizeValue(childKey, child)]))
  return value
}

export function safeAuditMetadata(value: Record<string, unknown> = {}) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(key, item)]))).slice(0, 4000)
}
