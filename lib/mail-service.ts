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
  GMAIL_SEND_SCOPE_CONFIRMED?: string
  MAIL_LAST_VALIDATION_STATUS?: string
  MAIL_LAST_VALIDATED_AT?: string
  MAIL_LAST_VALIDATION_SOURCE?: string
}

function environment() {
  return process.env as MailRuntimeEnv
}

export function mailMode(): "mock" | "live" {
  const values = environment();
  return values.MAIL_MODE?.toLowerCase() === "live" && values.MAIL_LIVE_ENABLED?.toLowerCase() === "true" ? "live" : "mock";
}

export function mailRuntimeStatus() {
  const values = environment()
  const requestedLive = values.MAIL_MODE?.trim().toLowerCase() === "live"
  const liveEnabled = values.MAIL_LIVE_ENABLED?.trim().toLowerCase() === "true"
  return { requestedLive, liveEnabled, mode: requestedLive && liveEnabled ? "live" as const : "mock" as const }
}

export function mailConfiguration() {
  const values = environment()
  const required = ["MAIL_SENDER_EMAIL", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SEND_SCOPE_CONFIRMED"] as const
  const missing = required.filter(key => !values[key]?.trim())
  return {
    provider: values.MAIL_PROVIDER?.trim().toLowerCase() === "gmail" ? "gmail" as const : "unconfigured" as const,
    configured: values.MAIL_PROVIDER?.trim().toLowerCase() === "gmail" && missing.length === 0,
    sender: values.MAIL_SENDER_EMAIL?.trim() ?? "",
    senderConfigured: Boolean(values.MAIL_SENDER_EMAIL?.trim()),
    oauthConfigured: Boolean(values.GMAIL_CLIENT_ID?.trim() && values.GMAIL_CLIENT_SECRET?.trim() && values.GMAIL_REFRESH_TOKEN?.trim()),
    sendPermissionConfigured: values.GMAIL_SEND_SCOPE_CONFIRMED?.trim().toLowerCase() === "true",
    liveEnabled: values.MAIL_LIVE_ENABLED?.trim().toLowerCase() === "true",
    lastValidationStatus: values.MAIL_LAST_VALIDATION_STATUS?.trim() || "Not validated",
    lastValidatedAt: values.MAIL_LAST_VALIDATED_AT?.trim() ?? "",
    validationSource: values.MAIL_LAST_VALIDATION_SOURCE?.trim() ?? "",
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
  let response: Response
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new Error("The institutional Gmail authorization request timed out.")
    throw new Error("The institutional Gmail authorization provider is unavailable.")
  }
  const result = await response.json().catch(() => ({})) as { access_token?: string; error?: string }
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new Error("The institutional Gmail authorization has expired or been revoked.")
    throw new Error("The institutional Gmail OAuth configuration was rejected.")
  }
  return result.access_token
}

export async function sendMail(draft: MailDraft, options: { fetcher?: typeof fetch } = {}): Promise<MailSendResult> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.recipient.trim())) throw new Error("Enter a valid recipient email address.")
  if (!draft.subject.trim() || !draft.body.trim()) {
    throw new Error("Recipient, subject, and message are required before sending.");
  }
  const runtime = mailRuntimeStatus()
  if (runtime.requestedLive && !runtime.liveEnabled) throw new Error("Live institutional mail is disabled.")
  if (runtime.mode === "live") {
    const config = mailConfiguration()
    if (!config.senderConfigured) throw new Error("The institutional sender mailbox is not configured.")
    if (!config.oauthConfigured || config.provider !== "gmail") throw new Error("The institutional Gmail OAuth client is not configured.")
    if (!config.sendPermissionConfigured) throw new Error("The institutional Gmail OAuth authorization does not have confirmed Gmail send permission.")
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
    let response: Response
    try {
      response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(15_000) })
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new Error("The Gmail send request timed out.")
      throw new Error("The Gmail provider is unavailable.")
    }
    const result = await response.json().catch(() => ({})) as { id?: string; error?: { status?: string; message?: string } }
    if (!response.ok || !result.id) {
      if (response.status === 401) throw new Error("The institutional Gmail authorization has expired or been revoked.")
      if (response.status === 403) throw new Error("The institutional Gmail authorization has insufficient Gmail send scope.")
      throw new Error("Gmail did not accept the approved message.")
    }
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
