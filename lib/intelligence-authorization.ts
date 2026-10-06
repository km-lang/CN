import type { Permission } from "@/lib/security-policy"

export const intelligencePermissions = Object.freeze({
  summary: "VIEW_ALUMNI" as Permission,
  operate: "OPERATE_PCOM" as Permission,
  schedule: "MANAGE_PROVIDER_SETTINGS" as Permission,
  readiness: "VIEW_PROVIDER_STATUS" as Permission,
  audit: "VIEW_AUDIT" as Permission,
})
