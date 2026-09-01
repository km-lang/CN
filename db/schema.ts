import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const alumni = sqliteTable("alumni", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileKey: text("profile_key").notNull(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  batch: integer("batch").notNull(),
  programme: text("programme").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  function: text("function").notNull(),
  seniority: text("seniority").notNull(),
  location: text("location").notNull(),
  previous: text("previous_companies").notNull().default(""),
  experience: integer("experience_years").notNull().default(0),
  confidence: integer("confidence").notNull().default(50),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
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
