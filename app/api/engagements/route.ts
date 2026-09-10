import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  alumni,
  alumniPrivacyControls,
  birthdayData,
  communicationPreferences,
  engagementActions,
  engagementAuditLog,
  engagementEvents,
  engagementResponses,
  eventViews,
  fieldChangeHistory,
  messageTemplates,
} from "@/db/schema";
import { createMailDraft, mailMode, sendMail } from "@/lib/mail-service";
import { accessErrorResponse, authorizeRequest, type SecurityContext, writeSecurityAudit } from "@/lib/security";

const terminalStatuses = new Set(["Action Taken", "Response Received", "Closed", "Skipped"]);
const actionableBirthdayStates = new Set(["Confirmed internally", "Manually confirmed", "PDL sourced"]);

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function offsetDate(days: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function monthDay(date: Date) {
  return date.toISOString().slice(5, 10);
}

async function audit(eventId: number, context: SecurityContext, action: string, details = "") {
  await getDb().insert(engagementAuditLog).values({ eventId, actor: context.displayName, action, details });
  await writeSecurityAudit(context, { action: `engagement_${action}`, entityType: "engagement_event", entityId: eventId, metadata: { details } });
}

async function ensureDemoEngagements() {
  const db = getDb();
  const templateRows = [
    {
      templateKey: "birthday-standard",
      name: "Standard Birthday",
      eventType: "Birthday",
      subject: "Warm birthday wishes from IIM Lucknow",
      body: "Dear [First Name],\n\nWishing you a very happy birthday from the Placement Committee at IIM Lucknow. We hope you have a wonderful year ahead.\n\nWarm regards,\nPlacement Committee\nIndian Institute of Management Lucknow",
    },
    {
      templateKey: "birthday-warm",
      name: "Warm Relationship Birthday",
      eventType: "Birthday",
      subject: "Warm birthday wishes from your IIM Lucknow community",
      body: "Dear [First Name],\n\nWarm birthday wishes from the Placement Committee and the IIM Lucknow community. We hope the year ahead brings you continued happiness and success.\n\nWarm regards,\nPlacement Committee\nIndian Institute of Management Lucknow",
    },
    {
      templateKey: "congratulations-standard",
      name: "Professional Congratulations",
      eventType: "Professional Signal",
      subject: "Congratulations from IIM Lucknow",
      body: "Dear [First Name],\n\nCongratulations on your recent professional milestone. The Placement Committee at IIM Lucknow wishes you continued success in your new role.\n\nWarm regards,\nPlacement Committee\nIndian Institute of Management Lucknow",
    },
  ];
  for (const template of templateRows) {
    await db.insert(messageTemplates).values(template).onConflictDoNothing();
  }

  const existingEvents = await db.select({ id: engagementEvents.id }).from(engagementEvents).limit(1);
  if (existingEvents.length) return;

  const people = await db.select().from(alumni);
  if (!people.length) return;
  const byName = new Map(people.map(person => [person.name, person]));
  let missingEmailPerson = people.find(person => !person.email);
  if (!missingEmailPerson) {
    const [created] = await db.insert(alumni).values({
      profileKey: "engagement-demo|ananya-kapoor|2017|microsoft",
      name: "Ananya Kapoor",
      initials: "AK",
      batch: 2017,
      graduationYear: 2017,
      programme: "PGP",
      company: "Microsoft",
      title: "Senior Program Manager",
      function: "Operations",
      seniority: "Senior Manager",
      location: "Hyderabad",
      confidence: 82,
      email: "",
      phone: "",
      verified: "Profile confirmed, contact not enriched",
      status: "Not contacted",
      note: "Birthday contact details are not yet available.",
      profileMatch: "Confirmed",
      currentCompanyVerification: "Verified",
      designationVerification: "Likely",
      source: "Demonstration data",
    }).onConflictDoUpdate({
      target: alumni.profileKey,
      set: { email: "", updatedAt: new Date().toISOString() },
    }).returning();
    missingEmailPerson = created;
  }

  const today = offsetDate(0);
  const birthdays = [
    { person: byName.get("Aditi Srivastava"), days: 0, source: "Internal alumni database", status: "Confirmed internally", preference: "Birthday engagement allowed" },
    { person: byName.get("Vikram Rao"), days: 0, source: "Internal alumni database", status: "Manually confirmed", preference: "Standard engagement allowed" },
    { person: missingEmailPerson, days: 1, source: "Internal alumni database", status: "Confirmed internally", preference: "Unknown" },
    { person: byName.get("Rahul Banerjee"), days: 3, source: "Internal alumni database", status: "Confirmed internally", preference: "Do not contact" },
    { person: byName.get("Tanvi Gupta"), days: 4, source: "PDL", status: "Conflict", preference: "Birthday engagement allowed" },
  ].filter(item => item.person);

  for (const item of birthdays) {
    const person = item.person!;
    const date = offsetDate(item.days);
    await db.insert(birthdayData).values({
      alumnusId: person.id,
      birthMonthDay: monthDay(date),
      source: item.source,
      status: item.status,
      lastVerifiedAt: today.toISOString(),
      lastUpdatedBy: "System",
    }).onConflictDoNothing();
    await db.insert(communicationPreferences).values({
      alumnusId: person.id,
      engagementType: "Birthday",
      status: item.preference,
      source: item.preference === "Unknown" ? "Not recorded" : "Internal alumni database",
    }).onConflictDoNothing();
    const alreadySent = person.name === "Vikram Rao";
    const skipped = person.name === "Rahul Banerjee";
    await db.insert(engagementEvents).values({
      eventKey: `birthday:${person.id}:${date.getUTCFullYear()}`,
      alumnusId: person.id,
      company: person.company,
      eventType: "Birthday",
      eventSubtype: "Annual birthday",
      eventTitle: `${person.name}'s birthday`,
      eventDescription: `Birthday on ${monthDay(date)}`,
      source: item.source,
      sourceReferenceId: `birthday-data:${person.id}`,
      sourceDetectedDate: isoDate(today),
      eventDate: isoDate(date),
      status: alreadySent ? "Action Taken" : skipped ? "Skipped" : "New",
      actionTakenAt: alreadySent ? today.toISOString() : "",
      actionTakenBy: alreadySent ? "PCOMmer 2" : "",
      actionType: alreadySent ? "Birthday Email" : "",
      actionChannel: alreadySent ? "Email" : "",
      deliveryStatus: alreadySent ? "Mock sent" : "",
      skippedAt: skipped ? today.toISOString() : "",
      skipReason: skipped ? "Do not contact preference" : "",
      createdBy: "System",
      lastUpdatedBy: alreadySent ? "PCOMmer 2" : "System",
    }).onConflictDoNothing();
  }

  const signals = [
    { person: byName.get("Priya Menon"), key: "priya-promotion-2026-09-08", subtype: "Promotion", title: "Promoted to Director", description: "Priya Menon was promoted to Director at Flipkart.", status: "New", actor: "System" },
    { person: byName.get("Tanvi Gupta"), key: "tanvi-google-move-2026-09-07", subtype: "Company change", title: "Moved to Google People Operations", description: "Tanvi Gupta recently moved into Google People Operations.", status: "Viewed", actor: "PCOMmer 2" },
    { person: byName.get("Rohan Mehta"), key: "rohan-ta-promotion-2026-08-28", subtype: "Promotion", title: "Promoted within Talent Acquisition", description: "Rohan Mehta was promoted within Talent Acquisition at Amazon.", status: "Action Taken", actor: "PCOMmer 2" },
  ].filter(item => item.person);
  for (const signal of signals) {
    const person = signal.person!;
    const actioned = signal.status === "Action Taken";
    await db.insert(engagementEvents).values({
      eventKey: `professional:lusha:${signal.key}`,
      alumnusId: person.id,
      company: person.company,
      eventType: "Professional Signal",
      eventSubtype: signal.subtype,
      eventTitle: signal.title,
      eventDescription: signal.description,
      source: "Lusha Signals",
      sourceReferenceId: signal.key,
      sourceDetectedDate: isoDate(today),
      eventDate: isoDate(today),
      status: signal.status,
      firstViewedAt: signal.status !== "New" ? today.toISOString() : "",
      lastViewedBy: signal.status !== "New" ? signal.actor : "",
      actionTakenAt: actioned ? today.toISOString() : "",
      actionTakenBy: actioned ? signal.actor : "",
      actionType: actioned ? "Congratulations Email" : "",
      actionChannel: actioned ? "Email" : "",
      deliveryStatus: actioned ? "Mock sent" : "",
      createdBy: "System",
      lastUpdatedBy: signal.actor,
    }).onConflictDoNothing();
  }

  const seededEvents = await db.select().from(engagementEvents);
  const templates = await db.select().from(messageTemplates);
  const congratulationsTemplate = templates.find(item => item.templateKey === "congratulations-standard");
  const birthdayTemplate = templates.find(item => item.templateKey === "birthday-standard");
  for (const event of seededEvents.filter(item => item.status === "Action Taken")) {
    const isBirthday = event.eventType === "Birthday";
    await db.insert(engagementActions).values({
      actionKey: `engagement-send:${event.id}`,
      eventId: event.id,
      alumnusId: event.alumnusId,
      actionType: isBirthday ? "Birthday Email" : "Congratulations Email",
      channel: "Email",
      performedBy: event.actionTakenBy || "PCOMmer 2",
      templateId: isBirthday ? birthdayTemplate?.id : congratulationsTemplate?.id,
      subject: isBirthday ? "Warm birthday wishes from IIM Lucknow" : "Congratulations from IIM Lucknow",
      messageSummary: isBirthday ? "Approved birthday wishes sent." : "Professional congratulations sent.",
      externalMessageId: `mock-seeded-${event.id}`,
      deliveryStatus: "Mock sent",
    }).onConflictDoNothing();
    await db.insert(engagementAuditLog).values({ eventId: event.id, actor: event.actionTakenBy || "PCOMmer 2", action: "email_sent", details: "Mock email sent and recorded." }).onConflictDoNothing();
  }
}

async function loadWorkspace() {
  const db = getDb();
  const [events, people, birthdays, preferences, templates, actions, responses, views, audits, privacyControls] = await Promise.all([
    db.select().from(engagementEvents).orderBy(desc(engagementEvents.eventDate), desc(engagementEvents.id)),
    db.select().from(alumni),
    db.select().from(birthdayData),
    db.select().from(communicationPreferences),
    db.select().from(messageTemplates).where(eq(messageTemplates.status, "Approved")),
    db.select().from(engagementActions).orderBy(desc(engagementActions.performedAt), desc(engagementActions.id)),
    db.select().from(engagementResponses).orderBy(desc(engagementResponses.receivedAt), desc(engagementResponses.id)),
    db.select().from(eventViews).orderBy(desc(eventViews.viewedAt), desc(eventViews.id)),
    db.select().from(engagementAuditLog).orderBy(desc(engagementAuditLog.createdAt), desc(engagementAuditLog.id)),
    db.select().from(alumniPrivacyControls),
  ]);
  const peopleById = new Map(people.map(person => [person.id, person]));
  const birthdayByAlumnus = new Map(birthdays.map(item => [item.alumnusId, item]));
  const preferenceByAlumnus = new Map(preferences.filter(item => item.engagementType === "Birthday").map(item => [item.alumnusId, item]));
  const privacyByAlumnus = new Map(privacyControls.map(item => [item.alumnusId, item]));
  return {
    mode: mailMode(),
    templates,
    events: events.map(event => {
      const person = peopleById.get(event.alumnusId);
      return {
        ...event,
        alumnus: person ? {
          id: person.id,
          name: person.name,
          initials: person.initials,
          company: person.company,
          title: person.title,
          programme: person.programme,
          batch: person.batch,
          email: person.email,
          relationship: person.iimlRelationship,
          confidence: person.confidence,
          outreachStatus: person.status,
        } : null,
        birthday: birthdayByAlumnus.has(event.alumnusId) ? {
          birthMonthDay: birthdayByAlumnus.get(event.alumnusId)!.birthMonthDay,
          source: birthdayByAlumnus.get(event.alumnusId)!.source,
          status: birthdayByAlumnus.get(event.alumnusId)!.status,
          lastVerifiedAt: birthdayByAlumnus.get(event.alumnusId)!.lastVerifiedAt,
        } : null,
        preference: engagementPreference(event.eventType, privacyByAlumnus.get(event.alumnusId), preferenceByAlumnus.get(event.alumnusId)?.status),
        actions: actions.filter(item => item.eventId === event.id),
        responses: responses.filter(item => item.eventId === event.id),
        views: views.filter(item => item.eventId === event.id),
        activity: audits.filter(item => item.eventId === event.id),
      };
    }),
  };
}

function engagementPreference(eventType: string, privacy: typeof alumniPrivacyControls.$inferSelect | undefined, legacy = "Unknown") {
  if (privacy?.generalContactStatus === "Do not contact") return "Do not contact";
  if (eventType === "Birthday" && ["Do not contact", "No birthday engagement", "Professional engagement only"].includes(privacy?.birthdayEngagementStatus ?? "")) return privacy!.birthdayEngagementStatus;
  if (eventType === "Professional Signal" && ["Do not contact", "No professional engagement"].includes(privacy?.professionalEngagementStatus ?? "")) return privacy!.professionalEngagementStatus;
  return legacy;
}

async function getEvent(eventId: number) {
  const db = getDb();
  const [event] = await db.select().from(engagementEvents).where(eq(engagementEvents.id, eventId)).limit(1);
  if (!event) throw new Error("Engagement event not found.");
  const [person] = await db.select().from(alumni).where(eq(alumni.id, event.alumnusId)).limit(1);
  if (!person) throw new Error("The linked alumnus could not be found.");
  return { event, person };
}

async function buildDraft(eventId: number, templateId?: number) {
  const db = getDb();
  const { event, person } = await getEvent(eventId);
  const templates = templateId
    ? await db.select().from(messageTemplates).where(eq(messageTemplates.id, templateId)).limit(1)
    : await db.select().from(messageTemplates).where(eq(messageTemplates.eventType, event.eventType));
  const template = templates.find(item => item.status === "Approved");
  if (!template) throw new Error("No approved message template is available for this event.");
  return { event, person, template, draft: createMailDraft(person.email, template.subject, template.body, person.name) };
}

async function validateSendEligibility(eventId: number, actor?: string) {
  const db = getDb();
  const { event, person } = await getEvent(eventId);
  if (terminalStatuses.has(event.status) || event.actionTakenAt) {
    throw new Error(`Already engaged by ${event.actionTakenBy || "another committee member"}${event.actionTakenAt ? ` on ${new Date(event.actionTakenAt).toLocaleString()}` : ""}.`);
  }
  if (actor && event.assignedTo && event.assignedTo !== actor) {
    throw new Error(`This engagement is currently assigned to ${event.assignedTo}. Reassign it before taking action.`);
  }
  if (!person.email) throw new Error("Email unavailable. Retrieve an email through Lusha before sending.");
  const [privacy] = await db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1);
  const preferences = await db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id));
  if (privacy?.generalContactStatus === "Do not contact" || preferences.some(preference => preference.status === "Do not contact")) {
    throw new Error("Engagement blocked because this alumnus is marked Do not contact.");
  }
  if (event.eventType === "Professional Signal" && ["Do not contact", "No professional engagement"].includes(privacy?.professionalEngagementStatus ?? "")) {
    throw new Error("Professional engagement is not permitted for this alumnus.");
  }
  if (event.eventType === "Birthday") {
    const [birthday] = await db.select().from(birthdayData).where(eq(birthdayData.alumnusId, person.id)).limit(1);
    const [preference] = await db.select().from(communicationPreferences).where(and(
      eq(communicationPreferences.alumnusId, person.id),
      eq(communicationPreferences.engagementType, "Birthday"),
    )).limit(1);
    if (!birthday || !actionableBirthdayStates.has(birthday.status)) throw new Error("This birthday is not sufficiently confirmed for sending.");
    if (["Do not contact", "No birthday engagement", "Professional engagement only"].includes(privacy?.birthdayEngagementStatus ?? "")) {
      throw new Error(`Birthday email excluded because the privacy preference is “${privacy?.birthdayEngagementStatus}”.`);
    }
    if (preference && ["Do not contact", "Do not send birthday wishes", "Professional engagement only"].includes(preference.status)) {
      throw new Error(`Birthday email excluded because the contact preference is “${preference.status}”.`);
    }
  }
}

async function sendOne(eventId: number, context: SecurityContext, templateId?: number, subject?: string, body?: string) {
  const db = getDb();
  const actor = context.displayName;
  await validateSendEligibility(eventId, actor);
  const { event, person, template, draft } = await buildDraft(eventId, templateId);
  const prepared = { ...draft, subject: subject?.trim() || draft.subject, body: body?.trim() || draft.body };
  const [reserved] = await db.insert(engagementActions).values({
    actionKey: `engagement-send:${event.id}`,
    eventId: event.id,
    alumnusId: person.id,
    actionType: event.eventType === "Birthday" ? "Birthday Email" : "Congratulations Email",
    channel: "Email",
    performedBy: actor,
    templateId: template.id,
    subject: prepared.subject,
    messageSummary: prepared.body.slice(0, 500),
    deliveryStatus: "Sending",
  }).onConflictDoNothing().returning();
  if (!reserved) {
    const [existing] = await db.select().from(engagementActions).where(eq(engagementActions.actionKey, `engagement-send:${event.id}`)).limit(1);
    throw new Error(`Already engaged by ${existing?.performedBy || "another committee member"}${existing?.performedAt ? ` on ${new Date(existing.performedAt).toLocaleString()}` : ""}.`);
  }
  try {
    const result = await sendMail(prepared);
    const now = new Date().toISOString();
    await db.update(engagementActions).set({ externalMessageId: result.messageId, deliveryStatus: result.deliveryStatus, performedAt: now }).where(eq(engagementActions.id, reserved.id));
    await db.update(engagementEvents).set({
      status: "Action Taken",
      assignedTo: event.assignedTo || actor,
      assignedAt: event.assignedAt || now,
      actionTakenAt: now,
      actionTakenBy: actor,
      actionType: event.eventType === "Birthday" ? "Birthday Email" : "Congratulations Email",
      actionChannel: "Email",
      messageTemplateId: template.id,
      messageSubject: prepared.subject,
      messageSummary: prepared.body.slice(0, 500),
      providerMessageId: result.messageId,
      deliveryStatus: result.deliveryStatus,
      lastUpdatedBy: actor,
      lastUpdatedAt: now,
    }).where(eq(engagementEvents.id, event.id));
    if (person.status === "Not contacted") await db.update(alumni).set({ status: "Contacted", updatedBy: actor, updatedAt: now }).where(eq(alumni.id, person.id));
    await audit(event.id, context, "email_sent", `${event.eventType === "Birthday" ? "Birthday" : "Congratulations"} email sent through ${result.mode} mail service.`);
    return { eventId: event.id, messageId: result.messageId, deliveryStatus: result.deliveryStatus };
  } catch (error) {
    await db.update(engagementActions).set({ actionKey: `failed:${event.id}:${Date.now()}`, deliveryStatus: "Failed", notes: error instanceof Error ? error.message : "Mail send failed" }).where(eq(engagementActions.id, reserved.id));
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    await authorizeRequest(request, "OPERATE_PCOM");
    await ensureDemoEngagements();
    return Response.json(await loadWorkspace());
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the shared engagement workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM");
    const payload = await request.json() as {
      action?: string;
      eventId?: number;
      eventIds?: number[];
      templateId?: number;
      subject?: string;
      body?: string;
      reason?: string;
      force?: boolean;
      responseType?: string;
      notes?: string;
      followUpRequired?: boolean;
      followUpDate?: string;
      birthMonthDay?: string;
    };
    const actor = context.displayName;
    const db = getDb();
    const now = new Date().toISOString();
    const eventId = Number(payload.eventId);

    if (payload.action === "bulk_preview") {
      const ids = [...new Set(payload.eventIds?.filter(Number.isInteger) ?? [])].slice(0, 25);
      const ready = [];
      const excluded = [];
      for (const id of ids) {
        try {
          await validateSendEligibility(id, actor);
          const item = await buildDraft(id, payload.templateId);
          ready.push({ eventId: id, alumnusName: item.person.name, templateId: item.template.id, ...item.draft });
        } catch (error) {
          const event = await getEvent(id).catch(() => null);
          excluded.push({ eventId: id, alumnusName: event?.person.name ?? "Unknown alumnus", reason: error instanceof Error ? error.message : "Not eligible" });
        }
      }
      return Response.json({ ready, excluded });
    }

    if (payload.action === "bulk_send") {
      const ids = [...new Set(payload.eventIds?.filter(Number.isInteger) ?? [])].slice(0, 25);
      const sent = [];
      const excluded = [];
      for (const id of ids) {
        try { sent.push(await sendOne(id, context, payload.templateId)); }
        catch (error) { excluded.push({ eventId: id, reason: error instanceof Error ? error.message : "Unable to send" }); }
      }
      return Response.json({ sent, excluded, mode: mailMode() });
    }

    if (!Number.isInteger(eventId)) return Response.json({ error: "A valid engagement event is required." }, { status: 400 });
    const { event } = await getEvent(eventId);

    if (payload.action === "view") {
      await db.insert(eventViews).values({ eventId, userId: actor });
      await db.update(engagementEvents).set({
        status: event.status === "New" ? "Viewed" : event.status,
        firstViewedAt: event.firstViewedAt || now,
        lastViewedBy: actor,
        lastUpdatedBy: actor,
        lastUpdatedAt: now,
      }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "viewed", "Event opened. No engagement action was taken.");
    } else if (payload.action === "acknowledge") {
      if (!terminalStatuses.has(event.status)) await db.update(engagementEvents).set({ status: "Acknowledged", acknowledgedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "acknowledged", "Signal reviewed and acknowledged.");
    } else if (payload.action === "assign") {
      if (event.assignedTo && event.assignedTo !== actor && !payload.force) {
        return Response.json({ error: `This engagement is currently assigned to ${event.assignedTo}.` }, { status: 409 });
      }
      await db.update(engagementEvents).set({ assignedTo: actor, assignedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, event.assignedTo ? "reassigned" : "assigned", event.assignedTo ? `Reassigned from ${event.assignedTo}.` : "Ownership taken.");
    } else if (payload.action === "plan") {
      if (terminalStatuses.has(event.status)) return Response.json({ error: "This event has already been completed." }, { status: 409 });
      if (event.assignedTo && event.assignedTo !== actor && !payload.force) {
        return Response.json({ error: `This engagement is currently assigned to ${event.assignedTo}.` }, { status: 409 });
      }
      await db.update(engagementEvents).set({ status: "Action Planned", actionPlannedAt: now, assignedTo: actor, assignedAt: event.assignedAt || now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "action_planned", payload.notes ?? "Engagement action planned.");
    } else if (payload.action === "preview") {
      const item = await buildDraft(eventId, payload.templateId);
      await audit(eventId, context, "draft_generated", `Draft prepared with ${item.template.name}.`);
      return Response.json({ template: item.template, draft: item.draft });
    } else if (payload.action === "send") {
      const sent = await sendOne(eventId, context, payload.templateId, payload.subject, payload.body);
      return Response.json({ sent, mode: mailMode() });
    } else if (payload.action === "manual_action") {
      if (terminalStatuses.has(event.status)) return Response.json({ error: "This event has already been completed." }, { status: 409 });
      const [created] = await db.insert(engagementActions).values({ actionKey: `manual:${eventId}:${Date.now()}`, eventId, alumnusId: event.alumnusId, actionType: "Manual Action", channel: "Manual", performedBy: actor, deliveryStatus: "Completed", notes: payload.notes ?? "Action completed outside the platform." }).returning();
      await db.update(engagementEvents).set({ status: "Action Taken", actionTakenAt: now, actionTakenBy: actor, actionType: "Manual Action", actionChannel: "Manual", deliveryStatus: "Completed", lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "manual_action", payload.notes ?? "Action marked complete.");
      return Response.json({ action: created });
    } else if (payload.action === "skip" || payload.action === "incorrect") {
      const reason = payload.action === "incorrect" ? `Incorrect signal${payload.reason ? `: ${payload.reason}` : ""}` : payload.reason || "Not relevant";
      await db.update(engagementEvents).set({ status: "Skipped", skippedAt: now, skipReason: reason, closedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, payload.action === "incorrect" ? "signal_marked_incorrect" : "skipped", reason);
    } else if (payload.action === "response") {
      const followUpRequired = Boolean(payload.followUpRequired);
      await db.insert(engagementResponses).values({ eventId, responseType: payload.responseType || "Other", receivedAt: now, recordedBy: actor, notes: payload.notes ?? "", followUpRequired, followUpDate: payload.followUpDate ?? "" });
      await db.update(engagementEvents).set({ status: followUpRequired ? "Follow-up Due" : "Response Received", responseReceived: true, responseReceivedAt: now, responseType: payload.responseType || "Other", responseNotes: payload.notes ?? "", followUpRequired, followUpDate: payload.followUpDate ?? "", lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "response_recorded", `${payload.responseType || "Other"}${followUpRequired ? `; follow-up ${payload.followUpDate || "required"}` : ""}.`);
    } else if (payload.action === "follow_up") {
      if (!payload.followUpDate) return Response.json({ error: "Choose a follow-up date." }, { status: 400 });
      await db.update(engagementEvents).set({ status: "Follow-up Due", followUpRequired: true, followUpDate: payload.followUpDate, assignedTo: event.assignedTo || actor, assignedAt: event.assignedAt || now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "follow_up_added", `Follow-up due ${payload.followUpDate}.`);
    } else if (payload.action === "close") {
      await db.update(engagementEvents).set({ status: "Closed", closedAt: now, lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await audit(eventId, context, "closed", payload.notes ?? "No further action required.");
    } else if (payload.action === "correct_birthday") {
      if (!/^\d{2}-\d{2}$/.test(payload.birthMonthDay ?? "")) return Response.json({ error: "Enter the birthday as MM-DD." }, { status: 400 });
      const [birthday] = await db.select().from(birthdayData).where(eq(birthdayData.alumnusId, event.alumnusId)).limit(1);
      if (!birthday) return Response.json({ error: "Birthday record not found." }, { status: 404 });
      await db.update(birthdayData).set({ birthMonthDay: payload.birthMonthDay!, source: "Manual confirmation", status: "Manually confirmed", lastVerifiedAt: now, lastUpdatedBy: actor, updatedAt: now }).where(eq(birthdayData.id, birthday.id));
      const eventYear = new Date(event.eventDate).getUTCFullYear();
      await db.update(engagementEvents).set({ eventDate: `${eventYear}-${payload.birthMonthDay}`, source: "Manual confirmation", lastUpdatedBy: actor, lastUpdatedAt: now }).where(eq(engagementEvents.id, eventId));
      await db.insert(fieldChangeHistory).values({ alumnusId: event.alumnusId, field: "birthday", oldValue: birthday.birthMonthDay, newValue: payload.birthMonthDay!, source: "Manual confirmation", providerAction: "Birthday correction", initiatedBy: actor });
      await audit(eventId, context, "birthday_corrected", `${birthday.birthMonthDay} → ${payload.birthMonthDay}.`);
    } else {
      return Response.json({ error: "Unsupported engagement action." }, { status: 400 });
    }

    return Response.json(await loadWorkspace());
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    const message = error instanceof Error ? error.message : "Unable to update the engagement event.";
    const status = /Already engaged|assigned to|already completed/i.test(message) ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}
