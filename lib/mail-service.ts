import { appConfig } from "@/lib/app-config";
import { serverConfig } from "@/lib/server-config";

export type MailDraft = {
  recipient: string;
  subject: string;
  body: string;
};

export type MailSendResult = {
  messageId: string;
  deliveryStatus: "Mock sent" | "Sent";
  mode: "mock" | "live";
  provider: "mock" | "gmail";
  sender: string;
  recipient: string;
};

type MailRuntimeEnv = {
  MAIL_MODE?: string
  MAIL_LIVE_ENABLED?: string
  MAIL_PROVIDER?: string
  MAIL_SENDER_EMAIL?: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
}

function environment() {
  return process.env as MailRuntimeEnv
}

export function mailMode(): "mock" | "live" {
  const values = environment();
  return values.MAIL_MODE?.toLowerCase() === "live" && values.MAIL_LIVE_ENABLED?.toLowerCase() === "true" ? "live" : "mock";
}

export function mailConfiguration() {
  const values = environment()
  const required = ["MAIL_SENDER_EMAIL", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] as const
  const missing = required.filter(key => !values[key]?.trim())
  return {
    provider: values.MAIL_PROVIDER?.trim().toLowerCase() === "gmail" ? "gmail" as const : "unconfigured" as const,
    configured: values.MAIL_PROVIDER?.trim().toLowerCase() === "gmail" && missing.length === 0,
    sender: values.MAIL_SENDER_EMAIL?.trim() ?? "",
    missing,
  }
}

export function createMailDraft(
  recipient: string,
  subjectTemplate: string,
  bodyTemplate: string,
  alumnusName: string,
): MailDraft {
  const firstName = alumnusName.trim().split(/\s+/)[0] || alumnusName;
  const replace = (value: string) => value
    .replaceAll("[First Name]", firstName)
    .replaceAll("[Full Name]", alumnusName)
    .replaceAll("[Product Name]", appConfig.name)
    .replaceAll("[Sender Display Name]", serverConfig.mailSenderDisplayName);
  return { recipient, subject: replace(subjectTemplate), body: replace(bodyTemplate) };
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

async function gmailAccessToken(fetcher: typeof fetch) {
  const values = environment()
  const body = new URLSearchParams({
    client_id: values.GMAIL_CLIENT_ID ?? "",
    client_secret: values.GMAIL_CLIENT_SECRET ?? "",
    refresh_token: values.GMAIL_REFRESH_TOKEN ?? "",
    grant_type: "refresh_token",
  })
  const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body })
  const result = await response.json().catch(() => ({})) as { access_token?: string }
  if (!response.ok || !result.access_token) throw new Error("The institutional Gmail authorization could not be refreshed.")
  return result.access_token
}

export async function sendMail(draft: MailDraft, options: { fetcher?: typeof fetch } = {}): Promise<MailSendResult> {
  if (!draft.recipient || !draft.subject.trim() || !draft.body.trim()) {
    throw new Error("Recipient, subject, and message are required before sending.");
  }
  if (mailMode() === "live") {
    const config = mailConfiguration()
    if (!config.configured || config.provider !== "gmail") throw new Error("The official Placement Committee Gmail mailbox has not been authorized for sending.")
    const fetcher = options.fetcher ?? fetch
    const accessToken = await gmailAccessToken(fetcher)
    const raw = base64Url([
      `From: ${safeHeader(serverConfig.mailSenderDisplayName)} <${safeHeader(config.sender)}>`,
      `To: ${safeHeader(draft.recipient)}`,
      `Subject: ${safeHeader(draft.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      draft.body,
    ].join("\r\n"))
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    })
    const result = await response.json().catch(() => ({})) as { id?: string }
    if (!response.ok || !result.id) throw new Error("Gmail did not accept the approved message.")
    return { messageId: result.id, deliveryStatus: "Sent", mode: "live", provider: "gmail", sender: config.sender, recipient: draft.recipient }
  }
  return {
    messageId: `mock-mail-${crypto.randomUUID()}`,
    deliveryStatus: "Mock sent",
    mode: "mock",
    provider: "mock",
    sender: mailConfiguration().sender || "mock-placement-committee",
    recipient: draft.recipient,
  };
}
