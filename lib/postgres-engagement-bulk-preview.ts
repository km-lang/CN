import { and, eq } from "drizzle-orm"

import { getPostgresDb } from "@/db/postgres/adapter"
import { alumni, alumniPrivacyControls, birthdayData, communicationPreferences, engagementEvents, messageTemplates } from "@/db/postgres/schema"
import { createMailDraft } from "@/lib/mail-service"

const terminalStatuses = new Set(["Action Taken", "Response Received", "Closed", "Completed", "Skipped"])
const actionableBirthdayStates = new Set(["Confirmed internally", "Manually confirmed", "Coresignal sourced"])
export class PreviewExclusion extends Error {}
function exclude(message: string): never { throw new PreviewExclusion(message) }

export async function eventPerson(eventId: number) {
  const db = getPostgresDb()
  const [event] = await db.select().from(engagementEvents).where(eq(engagementEvents.id, eventId)).limit(1)
  if (!event) exclude("Engagement event not found.")
  const [person] = await db.select().from(alumni).where(eq(alumni.id, event.alumnusId)).limit(1)
  if (!person) exclude("The linked alumnus could not be found.")
  return { event, person }
}

export async function validate(eventId: number, actor: string) {
  const db = getPostgresDb()
  const { event, person } = await eventPerson(eventId)
  if (person.intakeStatus === "PROVISIONAL") exclude("Provisional intake does not grant outreach eligibility or consent.")
  if (terminalStatuses.has(event.status) || event.actionTakenAt) {
    exclude(`Already engaged by ${event.actionTakenBy || "another committee member"}${event.actionTakenAt ? ` on ${new Date(event.actionTakenAt).toLocaleString()}` : ""}.`)
  }
  if (event.assignedTo && event.assignedTo !== actor) exclude(`This engagement is currently assigned to ${event.assignedTo}. Reassign it before taking action.`)
  if (!person.email) exclude("Email unavailable. Retrieve an email through Lusha before sending.")
  const [privacy] = await db.select().from(alumniPrivacyControls).where(eq(alumniPrivacyControls.alumnusId, person.id)).limit(1)
  const preferences = await db.select().from(communicationPreferences).where(eq(communicationPreferences.alumnusId, person.id))
  if (privacy?.generalContactStatus === "Do not contact" || preferences.some(preference => preference.status === "Do not contact")) {
    exclude("Engagement blocked because this alumnus is marked Do not contact.")
  }
  if (event.eventType === "Professional Signal" && ["Do not contact", "No professional engagement"].includes(privacy?.professionalEngagementStatus ?? "")) {
    exclude("Professional engagement is not permitted for this alumnus.")
  }
  const generalPreference = privacy?.generalContactStatus ?? "Unknown"
  const professionalPreference = privacy?.professionalEngagementStatus ?? "Unknown"
  const birthdayPreference = privacy?.birthdayEngagementStatus ?? "Unknown"
  const explicitProfessionalPermission = ["Standard engagement allowed", "Professional engagement only"].includes(generalPreference)
    || ["Standard engagement allowed", "Professional engagement only"].includes(professionalPreference)
  const explicitBirthdayPermission = ["Standard engagement allowed", "Birthday engagement allowed"].includes(generalPreference)
    || birthdayPreference === "Birthday engagement allowed"
  if (event.eventType === "Professional Signal" && !explicitProfessionalPermission) exclude("Explicit professional communication permission is required; Unknown is not consent.")
  if (event.eventType === "Birthday" && !explicitBirthdayPermission) exclude("Explicit birthday communication permission is required; Unknown is not consent.")
  if (event.eventType === "Birthday") {
    const [birthday] = await db.select().from(birthdayData).where(eq(birthdayData.alumnusId, person.id)).limit(1)
    const [preference] = await db.select().from(communicationPreferences).where(and(
      eq(communicationPreferences.alumnusId, person.id), eq(communicationPreferences.engagementType, "Birthday"))).limit(1)
    if (!birthday || !actionableBirthdayStates.has(birthday.status)) exclude("This birthday is not sufficiently confirmed for sending.")
    if (["Do not contact", "No birthday engagement", "Professional engagement only"].includes(privacy?.birthdayEngagementStatus ?? "")) {
      exclude(`Birthday email excluded because the privacy preference is “${privacy?.birthdayEngagementStatus}”.`)
    }
    if (preference && ["Do not contact", "Do not send birthday wishes", "Professional engagement only"].includes(preference.status)) {
      exclude(`Birthday email excluded because the contact preference is “${preference.status}”.`)
    }
  }
  return {
    communicationStatus: event.eventType === "Birthday" ? birthdayPreference : professionalPreference !== "Unknown" ? professionalPreference : generalPreference,
    recipient: person.email,
    purpose: event.eventType === "Birthday" ? "Birthday wish" : event.eventType === "Manual Relationship" ? "Institutional outreach" : "Professional congratulations",
  }
}

export async function buildDraft(eventId: number, templateId?: number) {
  const { event, person } = await eventPerson(eventId)
  const db = getPostgresDb()
  const templates = templateId
    ? await db.select().from(messageTemplates).where(eq(messageTemplates.id, templateId)).limit(1)
    : await db.select().from(messageTemplates).where(eq(messageTemplates.eventType, event.eventType === "Manual Relationship" ? "Professional Signal" : event.eventType))
  const template = templates.find(item => item.status === "Approved")
  if (!template) exclude("No approved message template is available for this event.")
  return { event, person, template, draft: createMailDraft(person.email, template.subject, template.body, person.name) }
}

export async function postgresEngagementBulkPreview(eventIds: number[] | undefined, templateId: number | undefined, actor: string) {
  const ids = [...new Set(eventIds?.filter(Number.isInteger) ?? [])].slice(0, 25)
  const ready = []
  const excluded = []
  for (const id of ids) {
    try {
      await validate(id, actor)
      const item = await buildDraft(id, templateId)
      ready.push({ eventId: id, alumnusName: item.person.name, templateId: item.template.id, ...item.draft })
    } catch (error) {
      if (!(error instanceof PreviewExclusion)) throw error
      const person = await eventPerson(id).catch(error => { if (!(error instanceof PreviewExclusion)) throw error; return null })
      excluded.push({ eventId: id, alumnusName: person?.person.name ?? "Unknown alumnus",
        reason: error.message })
    }
  }
  return { ready, excluded }
}
