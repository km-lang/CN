import { appConfig } from "@/lib/app-config"

type ServerEnvironment = {
  MAIL_SENDER_DISPLAY_NAME?: string
  MAIL_OAUTH_CALLBACK_URL?: string
}

export function createServerConfig(environment: ServerEnvironment = {}) {
  return Object.freeze({
    mailSenderDisplayName: environment.MAIL_SENDER_DISPLAY_NAME?.trim() || "Placement Committee, IIM Lucknow",
    mailOAuthCallbackUrl: environment.MAIL_OAUTH_CALLBACK_URL?.trim() || "",
    productName: appConfig.name,
  })
}

export const serverConfig = createServerConfig({
  MAIL_SENDER_DISPLAY_NAME: process.env.MAIL_SENDER_DISPLAY_NAME,
  MAIL_OAUTH_CALLBACK_URL: process.env.MAIL_OAUTH_CALLBACK_URL,
})

