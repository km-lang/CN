import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import {
  alumni,
  alumniPrivacyControls,
  applicationUsers,
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
import { createMailDraft, mailConfiguration, mailMode, sendMail } from "@/lib/mail-service";
import { reusableManualEmailEvent } from "@/lib/controlled-email-draft";
import { accessErrorResponse, authorizeRequest, type SecurityContext, writeSecurityAudit } from "@/lib/security";

const terminalStatuses = new Set(["Action Taken", "Response Received", "Closed", "Completed", "Skipped"]);
const actionableBirthdayStates = new Set(["Confirmed internally", "Manually confirmed", "PDL sourced"]);

async function audit(eventId: number, context: SecurityContext, action: string, details = "") {
  await getDb().insert(engagementAuditLog).values({ eventId, actor: context.displayName, action, details });
  await writeSecurityAudit(context, { action: `engagement_${action}`, entityType: "engagement_event", entityId: eventId, metadata: { details } });
}

async function loadWorkspace() {
  const db = getDb();
  const [events, people, birthdays, preferences, templates, actions, responses, views, audits, privacyControls, assignees] = await Promise.all([
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
    db.select({ id: applicationUsers.id, displayName: applicationUsers.displayName }).from(applicationUsers).where(and(eq(applicationUsers.enabled, true), inArray(applicationUsers.role, ["ADMIN", "PCOM"]))),
  ]);
  const peopleById = new Map(people.map(person => [person.id, person]));
  const birthdayByAlumnus = new Map(birthdays.map(item => [item.alumnusId, item]));
  const preferenceByAlumnus = new Map(preferences.filter(item => item.engagementType === "Birthday").map(item => [item.alumnusId, item]));
  const privacyByAlumnus = new Map(privacyControls.map(item => [item.alumnusId, item]));
  return {
    mode: mailMode(),
    mail: { mode: mailMode(), ...mailConfiguration() },
    templates,
    assignees,
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
  if (eventType === "Birthday" && privacy?.birthdayEngagementStatus && privacy.birthdayEngagementStatus !== "Unknown") return privacy.birthdayEngagementStatus;
  if (eventType === "Professional Signal" && privacy?.professionalEngagementStatus && privacy.professionalEngagementStatus !== "Unknown") return privacy.professionalEngagementStatus;
  if (privacy?.generalContactStatus && privacy.generalContactStatus !== "Unknown") return privacy.generalContactStatus;
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
    : await db.select().from(messageTemplates).where(eq(messageTemplates.eventType, event.eventType === "Manual Relationship" ? "Professional Signal" : event.eventType));
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
  const generalPreference = privacy?.generalContactStatus ?? "Unknown";
  const professionalPreference = privacy?.professionalEngagementStatus ?? "Unknown";
  const birthdayPreference = privacy?.birthdayEngagementStatus ?? "Unknown";
  const explicitProfessionalPermission = ["Standard engagement allowed", "Professional engagement only"].includes(generalPreference)
    || ["Standard engagement allowed", "Professional engagement only"].includes(professionalPreference);
  const explicitBirthdayPermission = ["Standard engagement allowed", "Birthday engagement allowed"].includes(generalPreference)
    || birthdayPreference === "Birthday engagement allowed";
  if (event.eventType === "Professional Signal" && !explicitProfessionalPermission) throw new Error("Explicit professional communication permission is required; Unknown is not consent.");
  if (event.eventType === "Birthday" && !explicitBirthdayPermission) throw new Error("Explicit birthday communication permission is required; Unknown is not consent.");
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
  return {
    communicationStatus: event.eventType === "Birthday" ? birthdayPreference : professionalPreference !== "Unknown" ? professionalPreference : generalPreference,
    recipient: person.email,
    purpose: event.eventType === "Birthday" ? "Birthday wish" : event.eventType === "Manual Relationship" ? "Institutional outreach" : "Professional congratulations",
  };
}

async function sendOne(eventId: number, context: SecurityContext, approved: boolean, templateId?: number, subject?: string, body?: string) {
  const db = getDb();
  const actor = context.displayName;
  if (!approved) throw new Error("Human approval is required after preview and before sending.");
  await validateSendEligibility(eventId, actor);
  const { event, person, template, draft } = await buildDraft(eventId, templateId);
  const prepared = { ...draft, subject: subject?.trim() || draft.subject, body: body?.trim() || draft.body };
  const purpose = event.eventType === "Birthday" ? "birthday" : "professional-congratulations";
  const actionKey = `mail:${person.id}:${event.eventKey}:${template.templateKey}:v${template.version}`;
  const approvedAt = new Date().toISOString();
  const [reserved] = await db.insert(engagementActions).values({
    actionKey,
    eventId: event.id,
    alumnusId: person.id,
    actionType: event.eventType === "Birthday" ? "Birthday Email" : "Congratulations Email",
    channel: "Email",
    performedBy: actor,
    templateId: template.id,
    templateVersion: template.version,
    sender: mailConfiguration().sender,
    recipient: person.email,
    purpose,
    approvedBy: actor,
    approvedAt,
    subject: prepared.subject,
    messageSummary: prepared.body.slice(0, 500),
    deliveryStatus: "Sending",
  }).onConflictDoNothing().returning();
  if (!reserved) {
    const [existing] = await db.select().from(engagementActions).where(eq(engagementActions.actionKey, actionKey)).limit(1);
    throw new Error(`Already engaged by ${existing?.performedBy || "another committee member"}${existing?.performedAt ? ` on ${new Date(existing.performedAt).toLocaleString()}` : ""}.`);
  }
  try {
    const result = await sendMail(prepared);
    const now = new Date().toISOString();
    await db.update(engagementActions).set({ externalMessageId: result.messageId, deliveryStatus: result.deliveryStatus, sender: result.sender, recipient: result.recipient, performedAt: now, notes: `Mail mode: ${result.mode}; provider: ${result.provider}` }).where(eq(engagementActions.id, reserved.id));
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
      alumnusId?: number;
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
      approved?: boolean;
    };
    const actor = context.displayName;
    const db = getDb();
    const now = new Date().toISOString();
    const eventId = Number(payload.eventId);

    if (payload.action === "prepare_manual_email") {
      const alumnusId = Number(payload.alumnusId);
      if (!Number.isInteger(alumnusId)) return Response.json({ error: "Select a valid approved alumnus." }, { status: 400 });
      const [person] = await db.select().from(alumni).where(eq(alumni.id, alumnusId)).limit(1);
      if (!person) return Response.json({ error: "Approved alumnus not found." }, { status: 404 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) return Response.json({ error: "A valid stored recipient email is required before drafting." }, { status: 409 });

      const manualEvents = await db.select().from(engagementEvents).where(and(
        eq(engagementEvents.alumnusId, person.id),
        eq(engagementEvents.eventType, "Manual Relationship"),
      )).orderBy(desc(engagementEvents.id));
      const manualEventIds = manualEvents.map(event => event.id);
      const priorEmailActions = manualEventIds.length
        ? await db.select({ eventId: engagementActions.eventId }).from(engagementActions).where(and(
            inArray(engagementActions.eventId, manualEventIds),
            eq(engagementActions.channel, "Email"),
          ))
        : [];
      const eventsWithEmailActions = new Set(priorEmailActions.map(action => action.eventId));
      const reusableEvent = reusableManualEmailEvent(manualEvents, eventsWithEmailActions, actor);
      const eventKey = `manual-professional-email:${person.id}:${crypto.randomUUID()}`;
      const [created] = reusableEvent ? [] : await db.insert(engagementEvents).values({ eventKey, alumnusId: person.id, company: person.company, eventType: "Manual Relationship", eventSubtype: "Controlled institutional email", eventTitle: "Controlled institutional outreach", eventDescription: "Manually prepared institutional outreach for explicit review and approval.", source: "Manual PCOM selection", eventDate: now.slice(0, 10), status: "New", createdBy: actor, lastUpdatedBy: actor }).returning();
      const event = reusableEvent ?? created;
      if (!event) throw new Error("Unable to create the controlled email draft event.");

      try {
        const eligibility = await validateSendEligibility(event.id, actor);
        const item = await buildDraft(event.id);
        const actionKey = `mail:${item.person.id}:${item.event.eventKey}:${item.template.templateKey}:v${item.template.version}`;
        const [duplicate] = await db.select({ id: engagementActions.id }).from(engagementActions).where(eq(engagementActions.actionKey, actionKey)).limit(1);
        if (duplicate) throw new Error("This approved message has already been sent or reserved.");
        const templates = await db.select().from(messageTemplates).where(eq(messageTemplates.eventType, "Professional Signal"));
        const approvedTemplates = templates.filter(template => template.status === "Approved");
        await audit(event.id, context, "draft_generated", `Draft prepared with ${item.template.name}.`);
        const preparedEvent = {
          ...event,
          alumnus: { id: person.id, name: person.name, initials: person.initials, company: person.company, title: person.title, programme: person.programme, batch: person.batch, email: person.email, relationship: person.iimlRelationship, confidence: person.confidence, outreachStatus: person.status },
          birthday: null,
          preference: eligibility.communicationStatus,
          actions: [],
          responses: [],
          views: [],
          activity: [],
        };
        return Response.json({ event: preparedEvent, templates: approvedTemplates, template: item.template, draft: item.draft, readiness: { ...eligibility, duplicateStatus: "No duplicate send found", provider: "Google Workspace / Gmail", mode: mailMode(), sender: mailConfiguration().sender || "Mock placement committee" } });
      } catch (error) {
        await audit(event.id, context, "draft_failed", "Controlled email draft initialization failed before any send attempt.");
        console.error("Controlled email draft initialization failed", { eventId: event.id, message: error instanceof Error ? error.message : "Unknown error" });
        throw error;
      }
    }

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
        try { sent.push(await sendOne(id, context, payload.approved === true, payload.templateId)); }
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
      try {
        const eligibility = await validateSendEligibility(eventId, actor);
        const item = await buildDraft(eventId, payload.templateId);
        const actionKey = `mail:${item.person.id}:${item.event.eventKey}:${item.template.templateKey}:v${item.template.version}`;
        const [duplicate] = await db.select({ id: engagementActions.id }).from(engagementActions).where(eq(engagementActions.actionKey, actionKey)).limit(1);
        if (duplicate) throw new Error("This approved message has already been sent or reserved.");
        await audit(eventId, context, "draft_generated", `Draft prepared with ${item.template.name}.`);
        return Response.json({ template: item.template, draft: item.draft, readiness: { ...eligibility, duplicateStatus: "No duplicate send found", provider: "Google Workspace / Gmail", mode: mailMode(), sender: mailConfiguration().sender || "Mock placement committee" } });
      } catch (error) {
        await audit(eventId, context, "draft_failed", "Controlled email draft initialization failed before any send attempt.");
        console.error("Controlled email draft initialization failed", { eventId, message: error instanceof Error ? error.message : "Unknown error" });
        throw error;
      }
    } else if (payload.action === "send") {
      const sent = await sendOne(eventId, context, payload.approved === true, payload.templateId, payload.subject, payload.body);
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
