export const APPLICATION_ROLES = ["ADMIN", "PCOM", "DEVELOPER"] as const

export type ApplicationRole = typeof APPLICATION_ROLES[number]

export type AccessSession = {
  displayName: string
  role: ApplicationRole
  provider: "google_workspace" | "chatgpt"
  signOutPath: string
  canViewContacts: boolean
  canOperate: boolean
  canAdminister: boolean
}
