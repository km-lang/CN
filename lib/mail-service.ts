import { appConfig } from "@/lib/app-config";
import { serverConfig } from "@/lib/server-config";

export type MailDraft = {
  recipient: string;
  subject: string;
  body: string;
};

export type MailSendResult = {
  messageId: string;
  deliveryStatus: "Mock sent" | "Queued";
  mode: "mock" | "live";
};

type MailRuntimeEnv = { MAIL_MODE?: string; MAIL_LIVE_ENABLED?: string };

export function mailMode(): "mock" | "live" {
  const values = process.env as MailRuntimeEnv;
  return values.MAIL_MODE?.toLowerCase() === "live" && values.MAIL_LIVE_ENABLED?.toLowerCase() === "true" ? "live" : "mock";
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

export async function sendMail(draft: MailDraft): Promise<MailSendResult> {
  if (mailMode() === "live") {
    throw new Error("The official Placement Committee mailbox has not been connected yet.");
  }
  if (!draft.recipient || !draft.subject.trim() || !draft.body.trim()) {
    throw new Error("Recipient, subject, and message are required before sending.");
  }
  return {
    messageId: `mock-mail-${crypto.randomUUID()}`,
    deliveryStatus: "Mock sent",
    mode: "mock",
  };
}
