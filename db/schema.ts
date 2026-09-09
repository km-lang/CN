import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const alumni = sqliteTable("alumni", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileKey: text("profile_key").notNull(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  batch: integer("batch").notNull(),
  graduationYear: integer("graduation_year").notNull().default(0),
  programme: text("programme").notNull(),
  education: text("education").notNull().default("Indian Institute of Management Lucknow"),
  company: text("company").notNull(),
  title: text("title").notNull(),
  rawTitle: text("raw_title").notNull().default(""),
  function: text("function").notNull(),
  seniority: text("seniority").notNull(),
  location: text("location").notNull(),
  previous: text("previous_companies").notNull().default(""),
  experience: integer("experience_years").notNull().default(0),
  confidence: integer("confidence").notNull().default(50),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  pdlPersonId: text("pdl_person_id").notNull().default(""),
  lushaPersonId: text("lusha_person_id").notNull().default(""),
  discoverySource: text("discovery_source").notNull().default("Manual import"),
  discoveryDate: text("discovery_date").notNull().default(""),
  lastPdlRefresh: text("last_pdl_refresh").notNull().default(""),
  lastLushaEnrichment: text("last_lusha_enrichment").notNull().default(""),
  emailSource: text("email_source").notNull().default(""),
  phoneSource: text("phone_source").notNull().default(""),
  emailRetrievedAt: text("email_retrieved_at").notNull().default(""),
  phoneRetrievedAt: text("phone_retrieved_at").notNull().default(""),
  verified: text("verified_label").notNull().default("Not yet verified"),
  status: text("outreach_status").notNull().default("Not contacted"),
  note: text("note").notNull().default("No placement context recorded."),
  hiringInfluence: text("hiring_influence").notNull().default("Unknown / Not assessed"),
  iimlRelationship: text("iiml_relationship").notNull().default("Unknown / Not assessed"),
  warmIntroPotential: text("warm_intro_potential").notNull().default("Unknown / Not assessed"),
  profileMatch: text("profile_match").notNull().default("Unverified"),
  currentCompanyVerification: text("current_company_verification").notNull().default("Unverified"),
  designationVerification: text("designation_verification").notNull().default("Unverified"),
  emailVerification: text("email_verification").notNull().default("Unverified"),
  phoneVerification: text("phone_verification").notNull().default("Unverified"),
  locationVerification: text("location_verification").notNull().default("Unverified"),
  source: text("source").notNull().default("Manual import"),
  updatedBy: text("updated_by").notNull().default("System"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_alumni_profile_key").on(table.profileKey),
  uniqueIndex("idx_alumni_email").on(table.email).where(sql`${table.email} != ''`),
  index("idx_alumni_company").on(table.company),
  index("idx_alumni_pdl_person_id").on(table.pdlPersonId),
]);

export const companyPriorities = sqliteTable("company_priorities", {
  company: text("company").primaryKey(),
  priority: text("priority").notNull(),
  updatedBy: text("updated_by").notNull().default("System"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const importRuns = sqliteTable("import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  importedBy: text("imported_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  actor: text("actor").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const birthdayData = sqliteTable("birthday_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alumnusId: integer("alumnus_id").notNull().references(() => alumni.id),
  birthMonthDay: text("birth_month_day").notNull(),
  fullBirthDate: text("full_birth_date").notNull().default(""),
  source: text("source").notNull(),
  status: text("status").notNull(),
  lastVerifiedAt: text("last_verified_at").notNull().default(""),
  lastUpdatedBy: text("last_updated_by").notNull().default("System"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_birthday_data_alumnus").on(table.alumnusId),
  index("idx_birthday_data_month_day").on(table.birthMonthDay),
]);

export const communicationPreferences = sqliteTable("communication_preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alumnusId: integer("alumnus_id").notNull().references(() => alumni.id),
  engagementType: text("engagement_type").notNull().default("All"),
  status: text("status").notNull().default("Unknown"),
  source: text("source").notNull().default("Not recorded"),
  updatedBy: text("updated_by").notNull().default("System"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_communication_preference_alumnus_type").on(table.alumnusId, table.engagementType),
]);

export const messageTemplates = sqliteTable("message_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  templateKey: text("template_key").notNull(),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("Approved"),
  updatedBy: text("updated_by").notNull().default("System"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_message_template_key").on(table.templateKey)]);

export const engagementEvents = sqliteTable("engagement_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventKey: text("event_key").notNull(),
  alumnusId: integer("alumnus_id").notNull().references(() => alumni.id),
  company: text("company").notNull().default(""),
  eventType: text("event_type").notNull(),
  eventSubtype: text("event_subtype").notNull().default(""),
  eventTitle: text("event_title").notNull(),
  eventDescription: text("event_description").notNull().default(""),
  source: text("source").notNull(),
  sourceReferenceId: text("source_reference_id").notNull().default(""),
  sourceDetectedDate: text("source_detected_date").notNull().default(""),
  eventDate: text("event_date").notNull(),
  status: text("status").notNull().default("New"),
  firstViewedAt: text("first_viewed_at").notNull().default(""),
  lastViewedBy: text("last_viewed_by").notNull().default(""),
  acknowledgedAt: text("acknowledged_at").notNull().default(""),
  assignedTo: text("assigned_to").notNull().default(""),
  assignedAt: text("assigned_at").notNull().default(""),
  actionPlannedAt: text("action_planned_at").notNull().default(""),
  actionTakenAt: text("action_taken_at").notNull().default(""),
  actionTakenBy: text("action_taken_by").notNull().default(""),
  actionType: text("action_type").notNull().default(""),
  actionChannel: text("action_channel").notNull().default(""),
  messageTemplateId: integer("message_template_id").references(() => messageTemplates.id),
  messageSubject: text("message_subject").notNull().default(""),
  messageSummary: text("message_summary").notNull().default(""),
  providerMessageId: text("provider_message_id").notNull().default(""),
  deliveryStatus: text("delivery_status").notNull().default(""),
  responseReceived: integer("response_received", { mode: "boolean" }).notNull().default(false),
  responseReceivedAt: text("response_received_at").notNull().default(""),
  responseType: text("response_type").notNull().default(""),
  followUpRequired: integer("follow_up_required", { mode: "boolean" }).notNull().default(false),
  followUpDate: text("follow_up_date").notNull().default(""),
  responseNotes: text("response_notes").notNull().default(""),
  closedAt: text("closed_at").notNull().default(""),
  skippedAt: text("skipped_at").notNull().default(""),
  skipReason: text("skip_reason").notNull().default(""),
  createdBy: text("created_by").notNull().default("System"),
  lastUpdatedBy: text("last_updated_by").notNull().default("System"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUpdatedAt: text("last_updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_engagement_event_key").on(table.eventKey),
  index("idx_engagement_event_status_date").on(table.status, table.eventDate),
  index("idx_engagement_event_alumnus").on(table.alumnusId),
]);

export const engagementActions = sqliteTable("engagement_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actionKey: text("action_key").notNull(),
  eventId: integer("event_id").notNull().references(() => engagementEvents.id),
  alumnusId: integer("alumnus_id").notNull().references(() => alumni.id),
  actionType: text("action_type").notNull(),
  channel: text("channel").notNull(),
  performedBy: text("performed_by").notNull(),
  performedAt: text("performed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  templateId: integer("template_id").references(() => messageTemplates.id),
  subject: text("subject").notNull().default(""),
  messageSummary: text("message_summary").notNull().default(""),
  externalMessageId: text("external_message_id").notNull().default(""),
  deliveryStatus: text("delivery_status").notNull().default(""),
  notes: text("notes").notNull().default(""),
}, (table) => [
  uniqueIndex("idx_engagement_action_key").on(table.actionKey),
  index("idx_engagement_action_event").on(table.eventId),
]);

export const engagementResponses = sqliteTable("engagement_responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => engagementEvents.id),
  responseType: text("response_type").notNull(),
  receivedAt: text("received_at").notNull(),
  recordedBy: text("recorded_by").notNull(),
  notes: text("notes").notNull().default(""),
  followUpRequired: integer("follow_up_required", { mode: "boolean" }).notNull().default(false),
  followUpDate: text("follow_up_date").notNull().default(""),
}, (table) => [index("idx_engagement_response_event").on(table.eventId)]);

export const eventViews = sqliteTable("event_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => engagementEvents.id),
  userId: text("user_id").notNull(),
  viewedAt: text("viewed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_event_view_event_user").on(table.eventId, table.userId)]);

export const engagementAuditLog = sqliteTable("engagement_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => engagementEvents.id),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_engagement_audit_event").on(table.eventId)]);

export const providerSettings = sqliteTable("provider_settings", {
  provider: text("provider").primaryKey(),
  monthlyCreditLimit: integer("monthly_credit_limit").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const providerResponseHistory = sqliteTable("provider_response_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  alumnusId: integer("alumnus_id").references(() => alumni.id),
  alumnusName: text("alumnus_name").notNull(),
  searchId: integer("search_id"),
  operation: text("operation").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  creditsUsed: integer("credits_used").notNull().default(0),
  resultCount: integer("result_count").notNull().default(0),
  requestSummary: text("request_summary").notNull().default(""),
  responseSummary: text("response_summary").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  requestedBy: text("requested_by").notNull().default("Public workspace user"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const externalDiscoverySearches = sqliteTable("external_discovery_searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().default("pdl"),
  filtersJson: text("filters_json").notNull(),
  criteriaSummary: text("criteria_summary").notNull(),
  resultCount: integer("result_count").notNull().default(0),
  existingCount: integer("existing_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  mode: text("mode").notNull(),
  initiatedBy: text("initiated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const externalDiscoveryResults = sqliteTable("external_discovery_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  searchId: integer("search_id").notNull().references(() => externalDiscoverySearches.id),
  provider: text("provider").notNull().default("pdl"),
  providerResultId: text("provider_result_id").notNull(),
  name: text("name").notNull(),
  education: text("education").notNull(),
  currentCompany: text("current_company").notNull(),
  role: text("role").notNull(),
  rawTitle: text("raw_title").notNull().default(""),
  function: text("function").notNull(),
  seniority: text("seniority").notNull(),
  location: text("location").notNull(),
  graduationYear: integer("graduation_year").notNull().default(0),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  providerPersonId: text("provider_person_id").notNull().default(""),
  matchStatus: text("match_status").notNull(),
  matchConfidence: integer("match_confidence").notNull().default(50),
  linkedInternalAlumnusId: integer("linked_internal_alumnus_id").references(() => alumni.id),
  reviewStatus: text("review_status").notNull().default("Pending review"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedAt: text("reviewed_at").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""),
}, (table) => [
  uniqueIndex("idx_external_result_search_provider").on(table.searchId, table.providerResultId),
  index("idx_external_result_search").on(table.searchId),
  index("idx_external_result_match_status").on(table.matchStatus),
]);

export const fieldChangeHistory = sqliteTable("field_change_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alumnusId: integer("alumnus_id").notNull().references(() => alumni.id),
  field: text("field").notNull(),
  oldValue: text("old_value").notNull().default(""),
  newValue: text("new_value").notNull().default(""),
  source: text("source").notNull(),
  providerAction: text("provider_action").notNull().default(""),
  creditsCharged: integer("credits_charged").notNull().default(0),
  initiatedBy: text("initiated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_field_change_alumnus").on(table.alumnusId)]);
