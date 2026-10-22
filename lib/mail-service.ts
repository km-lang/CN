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

export type GmailConnectivityValidation = {
  status: "confirmed" | "failed" | "unknown"
  outcome: string
  checkedAt: string
  reason: string
  scopeVerified: boolean | null
}

/** A failed send may still have reached Gmail when the response is lost. */
export class MailSendError extends Error {
  constructor(message: string, public readonly deliveryMayHaveOccurred: boolean) {
    super(message)
  }
}

export function mailFailureMayHaveDelivered(error: unknown) {
  return !(error instanceof MailSendError) || error.deliveryMayHaveOccurred
}

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

class GmailTokenError extends Error {
  constructor(message: string, public readonly outcome: string, public readonly classification: "failed" | "unknown") {
    super(message)
  }
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
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new GmailTokenError("The institutional Gmail authorization request timed out.", "timeout", "unknown")
    throw new GmailTokenError("The institutional Gmail authorization provider is unavailable.", "provider_unavailable", "unknown")
  }
  let result: { access_token?: string; error?: string; scope?: string }
  try {
    result = await response.json() as typeof result
  } catch {
    throw new GmailTokenError("Google returned an unreadable OAuth response.", "malformed_response", "unknown")
  }
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new GmailTokenError("The institutional Gmail authorization has expired or been revoked.", "authorization_revoked", "failed")
    if (response.status >= 500) throw new GmailTokenError("Google OAuth is temporarily unavailable.", "provider_unavailable", "unknown")
    if (response.ok) throw new GmailTokenError("Google returned an incomplete OAuth response.", "malformed_response", "unknown")
    throw new GmailTokenError("The institutional Gmail OAuth configuration was rejected.", "oauth_rejected", "failed")
  }
  return { accessToken: result.access_token, scope: result.scope?.trim() ?? "" }
}

export async function validateGmailConnectivity(options: { fetcher?: typeof fetch; checkedAt?: string } = {}): Promise<GmailConnectivityValidation> {
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  const config = mailConfiguration()
  if (config.provider !== "gmail" || !config.oauthConfigured) {
    return { status: "failed", outcome: "configuration_missing", checkedAt, reason: "Gmail OAuth configuration is incomplete.", scopeVerified: null }
  }
  try {
    const token = await gmailAccessToken(options.fetcher ?? fetch)
    if (token.scope) {
      const scopes = new Set(token.scope.split(/\s+/).filter(Boolean))
      const scopeVerified = scopes.has("https://www.googleapis.com/auth/gmail.send")
      return scopeVerified
        ? { status: "confirmed", outcome: "oauth_authenticated", checkedAt, reason: "OAuth token refresh succeeded and Gmail send scope was confirmed.", scopeVerified: true }
        : { status: "failed", outcome: "gmail_send_scope_missing", checkedAt, reason: "OAuth token refresh succeeded, but Gmail send scope was not present.", scopeVerified: false }
    }
    return { status: "confirmed", outcome: "oauth_authenticated_scope_unreported", checkedAt, reason: "OAuth token refresh succeeded; Google did not return scope metadata.", scopeVerified: null }
  } catch (error) {
    if (error instanceof GmailTokenError) {
      return { status: error.classification, outcome: error.outcome, checkedAt, reason: error.message, scopeVerified: null }
    }
    return { status: "unknown", outcome: "unexpected_error", checkedAt, reason: "Gmail connectivity could not be determined.", scopeVerified: null }
  }
}

export async function sendMail(draft: MailDraft, options: { fetcher?: typeof fetch } = {}): Promise<MailSendResult> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.recipient.trim())) throw new MailSendError("Enter a valid recipient email address.", false)
  if (!draft.subject.trim() || !draft.body.trim()) {
    throw new MailSendError("Recipient, subject, and message are required before sending.", false);
  }
  const runtime = mailRuntimeStatus()
  if (runtime.requestedLive && !runtime.liveEnabled) throw new MailSendError("Live institutional mail is disabled.", false)
  if (runtime.mode === "live") {
    const config = mailConfiguration()
    if (!config.senderConfigured) throw new MailSendError("The institutional sender mailbox is not configured.", false)
    if (!config.oauthConfigured || config.provider !== "gmail") throw new MailSendError("The institutional Gmail OAuth client is not configured.", false)
    if (!config.sendPermissionConfigured) throw new MailSendError("The institutional Gmail OAuth authorization does not have confirmed Gmail send permission.", false)
    const fetcher = options.fetcher ?? fetch
    let accessToken: string
    try { ({ accessToken } = await gmailAccessToken(fetcher)) }
    catch (error) { if (error instanceof GmailTokenError) throw new MailSendError(error.message, false); throw error }
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
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new MailSendError("The Gmail send request timed out; delivery must be reconciled before retrying.", true)
      throw new MailSendError("The Gmail send outcome is unknown; delivery must be reconciled before retrying.", true)
    }
    const result = await response.json().catch(() => ({})) as { id?: string; error?: { status?: string; message?: string } }
    if (!response.ok || !result.id) {
      if (response.status === 401) throw new MailSendError("The institutional Gmail authorization has expired or been revoked.", false)
      if (response.status === 403) throw new MailSendError("The institutional Gmail authorization has insufficient Gmail send scope.", false)
      throw new MailSendError(response.ok ? "Gmail returned an incomplete send receipt; delivery must be reconciled before retrying." : "Gmail did not confirm the send; delivery must be reconciled before retrying.", true)
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
