import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLog, alumni, alumniDataLifecycle, alumniPrivacyControls, companyPriorities, fieldChangeHistory, importRuns, programmeOptions } from "@/db/schema";
import type { ApplicationRole } from "@/lib/access-types";
import { normalizeProfessionalProfileUrl } from "@/lib/professional-profile";
import { accessErrorResponse, authorizeRequest, hasPermission, maskEmail, maskPhone, writeSecurityAudit } from "@/lib/security";

const allowedStatuses = new Set(["Not contacted", "Contacted", "Responded", "Meeting set"]);
const allowedVerification = new Set(["Confirmed", "Verified", "Likely", "Unverified", "Possibly outdated", "Mismatch"]);

type ImportedRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result) : fallback;
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function possibleManualMatches(record: ImportedRecord, people: (typeof alumni.$inferSelect)[]) {
  const name = normalized(record.name);
  const email = normalized(record.email);
  const linkedin = normalized(normalizeProfessionalProfileUrl(record.linkedinUrl ?? record.linkedin_url));
  const company = normalized(record.company);
  const batch = number(record.batch ?? record.graduationYear ?? record.graduation_year);
  return people.map(person => {
    const reasons: string[] = [];
    if (email && normalized(person.email) === email) reasons.push("email");
    if (linkedin && normalized(person.linkedinUrl) === linkedin) reasons.push("professional profile URL");
    const sameName = name === normalized(person.name);
    if (sameName) reasons.push("name");
    if (sameName && batch > 0 && (person.batch === batch || person.graduationYear === batch)) reasons.push("graduation year / batch");
    if (sameName && company && normalized(person.company) === company) reasons.push("current company");
    const exact = reasons.includes("email") || reasons.includes("professional profile URL") || (reasons.includes("name") && reasons.includes("graduation year / batch") && reasons.includes("current company"));
    const possible = exact || (sameName && reasons.length > 1) || (sameName && !batch && !company);
    return possible ? { id: person.id, name: person.name, programme: person.programme, batch: person.batch, company: person.company, title: person.title, reasons, exact } : null;
  }).filter((person): person is NonNullable<typeof person> => Boolean(person)).slice(0, 5);
}

function normaliseManualRecord(record: ImportedRecord, actor: string, continueAsNew: boolean) {
  const name = text(record.name);
  const company = text(record.company, "Not recorded");
  const batch = number(record.batch ?? record.graduationYear ?? record.graduation_year);
  const email = text(record.email).toLowerCase();
  const linkedinUrl = normalizeProfessionalProfileUrl(record.linkedinUrl ?? record.linkedin_url);
  if (!name) throw new Error("Name is required.");
  if (!email && !linkedinUrl && !(company !== "Not recorded" && batch >= 1980 && batch <= 2100)) {
    throw new Error("Add an email, professional-profile URL, or both company and graduation year to reduce duplicates.");
  }
  const now = new Date().toISOString();
  const baseKey = email ? `manual-email:${normalized(email)}` : linkedinUrl ? `manual-profile:${normalized(linkedinUrl)}` : `manual:${normalized(name)}|${batch}|${normalized(company)}`;
  return {
    profileKey: continueAsNew ? `${baseKey}|confirmed-${Date.now()}` : baseKey,
    name,
    initials: initials(name),
    batch: batch >= 1980 && batch <= 2100 ? batch : 0,
    graduationYear: batch >= 1980 && batch <= 2100 ? batch : 0,
    programme: text(record.programme, "Not recorded"),
    education: "Indian Institute of Management Lucknow",
    company,
    title: text(record.title, "Role not recorded"),
    rawTitle: text(record.title),
    function: text(record.function, "Not assessed"),
    seniority: text(record.seniority, "Not assessed"),
    location: text(record.location, "Not recorded"),
    confidence: 50,
    email,
    phone: text(record.phone),
    linkedinUrl,
    discoverySource: "Manual entry",
    discoveryDate: now,
    emailSource: email ? "Manual entry" : "",
    phoneSource: text(record.phone) ? "Manual entry" : "",
    emailRetrievedAt: email ? now : "",
    phoneRetrievedAt: text(record.phone) ? now : "",
    verified: "Manually supplied · not provider verified",
    status: allowedStatuses.has(text(record.status)) ? text(record.status) : "Not contacted",
    note: text(record.note, "Manually added. Placement context has not yet been assessed."),
    iimlRelationship: text(record.iimlRelationship ?? record.relationship, "Unknown / Not assessed"),
    profileMatch: "Unverified",
    currentCompanyVerification: "Unverified",
    designationVerification: "Unverified",
    emailVerification: email ? "Unverified" : "Unverified",
    phoneVerification: text(record.phone) ? "Unverified" : "Unverified",
    locationVerification: "Unverified",
    source: "Manual entry",
    updatedBy: actor,
    updatedAt: now,
  };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL";
}

function profileKey(record: ImportedRecord) {
  const supplied = text(record.profileKey ?? record.profile_key);
  if (supplied) return supplied.toLowerCase();
  return [record.name, record.batch, record.company].map(value => text(value).toLowerCase()).join("|");
}

function toApiAlumnus(row: typeof alumni.$inferSelect, role: ApplicationRole, privacy?: typeof alumniPrivacyControls.$inferSelect, lifecycle?: typeof alumniDataLifecycle.$inferSelect) {
  const contactsAllowed = hasPermission(role, "VIEW_CONTACTS");
  const operationalDetailsAllowed = role !== "DEVELOPER";
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    batch: row.batch,
    graduationYear: row.graduationYear,
    programme: row.programme,
    education: row.education,
    company: row.company,
    title: row.title,
    rawTitle: row.rawTitle,
    function: row.function,
    seniority: row.seniority,
    location: row.location,
    previous: row.previous,
    experience: row.experience,
    confidence: row.confidence,
    email: contactsAllowed ? row.email : maskEmail(row.email),
    phone: contactsAllowed ? row.phone : maskPhone(row.phone),
    linkedinUrl: normalizeProfessionalProfileUrl(row.linkedinUrl),
    pdlPersonId: row.pdlPersonId,
    coresignalEmployeeId: row.coresignalEmployeeId,
    lushaPersonId: row.lushaPersonId,
    discoverySource: row.discoverySource,
    discoveryDate: row.discoveryDate,
    lastPdlRefresh: row.lastPdlRefresh,
    lastProfessionalDataRefresh: row.lastProfessionalDataRefresh,
    professionalDataProvider: row.professionalDataProvider,
    providerFreshnessAt: row.providerFreshnessAt,
    iimlAffiliationStatus: row.iimlAffiliationStatus,
    iimlEducationProgramme: row.iimlEducationProgramme,
    iimlEducationStartDate: row.iimlEducationStartDate,
    iimlEducationEndDate: row.iimlEducationEndDate,
    iimlInstitutionId: row.iimlInstitutionId,
    iimlInstitutionUrl: row.iimlInstitutionUrl,
    currentCompanyId: row.currentCompanyId,
    currentCompanyUrl: row.currentCompanyUrl,
    currentRoleStartDate: row.currentRoleStartDate,
    currentIndustry: row.currentIndustry,
    currentRoleAmbiguous: row.currentRoleAmbiguous,
    lastLushaEnrichment: row.lastLushaEnrichment,
    emailSource: row.emailSource,
    phoneSource: row.phoneSource,
    emailRetrievedAt: row.emailRetrievedAt,
    phoneRetrievedAt: row.phoneRetrievedAt,
    professionalDataStatus: row.professionalDataStatus,
    professionalDataNote: operationalDetailsAllowed ? row.professionalDataNote : "Restricted for Developer role",
    verified: row.verified,
    status: row.status,
    note: operationalDetailsAllowed ? row.note : "Restricted for Developer role",
    assessment: {
      hiringInfluence: operationalDetailsAllowed ? row.hiringInfluence : "Restricted",
      iimlRelationship: operationalDetailsAllowed ? row.iimlRelationship : "Restricted",
      warmIntroPotential: operationalDetailsAllowed ? row.warmIntroPotential : "Restricted",
    },
    verification: {
      profileMatch: row.profileMatch,
      currentCompany: row.currentCompanyVerification,
      designation: row.designationVerification,
      email: row.emailVerification,
      phone: row.phoneVerification,
      location: row.locationVerification,
    },
    source: row.source,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
    privacy: privacy ? {
      generalContactStatus: privacy.generalContactStatus,
      professionalEngagementStatus: privacy.professionalEngagementStatus,
      birthdayEngagementStatus: privacy.birthdayEngagementStatus,
      consentSource: privacy.consentSource,
      notes: operationalDetailsAllowed ? privacy.notes : "",
      updatedAt: privacy.updatedAt,
      updatedBy: privacy.updatedBy,
    } : { generalContactStatus: "Unknown", professionalEngagementStatus: "Unknown", birthdayEngagementStatus: "Unknown", consentSource: "Unknown", notes: "", updatedAt: "", updatedBy: "" },
    lifecycle: lifecycle?.status ?? "Active",
  };
}

function normaliseRecord(record: ImportedRecord, filename: string, actor: string) {
  const assessment = record.assessment && typeof record.assessment === "object"
    ? record.assessment as ImportedRecord
    : {};
  const fieldVerification = record.verification && typeof record.verification === "object"
    ? record.verification as ImportedRecord
    : {};
  const name = text(record.name);
  const company = text(record.company);
  const batch = number(record.batch);
  if (!name || !company || batch < 1980 || batch > 2100) {
    throw new Error("Each record needs a name, company and valid graduation batch.");
  }

  const status = text(record.status, "Not contacted");
  const verification = (value: unknown, fallback = "Unverified") => {
    const result = text(value, fallback);
    return allowedVerification.has(result) ? result : fallback;
  };

  const importSource = filename.toLowerCase().endsWith(".xlsx") ? "Excel import" : "CSV import";
  return {
    profileKey: profileKey(record),
    name,
    initials: text(record.initials, initials(name)),
    batch,
    graduationYear: number(record.graduationYear ?? record.graduation_year, batch),
    programme: text(record.programme, "PGP"),
    education: text(record.education, "Indian Institute of Management Lucknow"),
    company,
    title: text(record.title, "Role not recorded"),
    rawTitle: text(record.rawTitle ?? record.raw_title ?? record.title),
    function: text(record.function, "Not assessed"),
    seniority: text(record.seniority, "Not assessed"),
    location: text(record.location, "Not recorded"),
    previous: text(record.previous ?? record.previous_companies),
    experience: Math.max(0, number(record.experience ?? record.experience_years)),
    confidence: Math.min(100, Math.max(0, number(record.confidence, 50))),
    email: text(record.email).toLowerCase(),
    phone: text(record.phone),
    linkedinUrl: normalizeProfessionalProfileUrl(record.linkedinUrl ?? record.linkedin_url),
    pdlPersonId: text(record.pdlPersonId ?? record.pdl_person_id),
    lushaPersonId: text(record.lushaPersonId ?? record.lusha_person_id),
    discoverySource: text(record.discoverySource ?? record.discovery_source, filename),
    discoveryDate: text(record.discoveryDate ?? record.discovery_date),
    lastPdlRefresh: text(record.lastPdlRefresh ?? record.last_pdl_refresh),
    lastLushaEnrichment: text(record.lastLushaEnrichment ?? record.last_lusha_enrichment),
    emailSource: text(record.email) ? importSource : "",
    phoneSource: text(record.phone) ? importSource : "",
    emailRetrievedAt: text(record.emailRetrievedAt ?? record.email_retrieved_at),
    phoneRetrievedAt: text(record.phoneRetrievedAt ?? record.phone_retrieved_at),
    verified: text(record.verified, "Not yet verified"),
    status: allowedStatuses.has(status) ? status : "Not contacted",
    note: text(record.note, "No placement context recorded."),
    hiringInfluence: text(record.hiringInfluence ?? record.hiring_influence ?? assessment.hiringInfluence, "Unknown / Not assessed"),
    iimlRelationship: text(record.iimlRelationship ?? record.iiml_relationship ?? assessment.iimlRelationship, "Unknown / Not assessed"),
    warmIntroPotential: text(record.warmIntroPotential ?? record.warm_intro_potential ?? assessment.warmIntroPotential, "Unknown / Not assessed"),
    profileMatch: verification(record.profileMatch ?? record.profile_match ?? fieldVerification.profileMatch),
    currentCompanyVerification: verification(record.currentCompany ?? record.current_company_verification ?? fieldVerification.currentCompany),
    designationVerification: verification(record.designation ?? record.designation_verification ?? fieldVerification.designation),
    emailVerification: "Unverified",
    phoneVerification: "Unverified",
    locationVerification: verification(record.locationVerification ?? record.location_verification ?? fieldVerification.location),
    source: importSource,
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await authorizeRequest(request, "VIEW_ALUMNI");
    const db = getDb();
    const [alumniRows, priorityRows, latestImports, privacyRows, lifecycleRows, programmeRows] = await Promise.all([
      db.select().from(alumni).orderBy(alumni.name),
      db.select().from(companyPriorities).orderBy(companyPriorities.company),
      db.select().from(importRuns).orderBy(desc(importRuns.createdAt), desc(importRuns.id)).limit(1),
      db.select().from(alumniPrivacyControls),
      db.select().from(alumniDataLifecycle),
      db.select().from(programmeOptions).orderBy(programmeOptions.sortOrder, programmeOptions.name),
    ]);
    const privacyByAlumnus = new Map(privacyRows.map(row => [row.alumnusId, row]));
    const lifecycleByAlumnus = new Map(lifecycleRows.map(row => [row.alumnusId, row]));
    return Response.json({
      alumni: alumniRows.map(row => toApiAlumnus(row, context.role, privacyByAlumnus.get(row.id), lifecycleByAlumnus.get(row.id))),
      companyPriorities: Object.fromEntries(priorityRows.map(row => [row.company, row.priority])),
      latestImport: latestImports[0] ?? null,
      programmeOptions: programmeRows,
      access: { role: context.role, contactsMasked: !hasPermission(context.role, "VIEW_CONTACTS") },
    });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the shared workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizeRequest(request, "OPERATE_PCOM");
    const payload = await request.json() as { action?: string; filename?: string; records?: ImportedRecord[]; record?: ImportedRecord; continueAsNew?: boolean; approvedUpdateKeys?: string[] };
    const db = getDb();
    const actor = context.displayName;

    if (payload.action === "manual_check" || payload.action === "manual_add") {
      if (!payload.record || typeof payload.record !== "object") return Response.json({ error: "Enter the alumnus details first." }, { status: 400 });
      normaliseManualRecord(payload.record, actor, Boolean(payload.continueAsNew));
      const people = await db.select().from(alumni);
      const matches = possibleManualMatches(payload.record, people);
      if (payload.action === "manual_check") return Response.json({ matches });
      if (matches.some(match => match.exact)) {
        return Response.json({ error: "An exact existing alumnus was found. Use the existing record instead of creating a duplicate.", matches }, { status: 409 });
      }
      if (matches.length && !payload.continueAsNew) {
        return Response.json({ error: "A possible existing alumnus needs review before saving.", requiresConfirmation: true, matches }, { status: 409 });
      }
      const record = normaliseManualRecord(payload.record, actor, Boolean(payload.continueAsNew));
      const [created] = await db.insert(alumni).values(record).returning();
      await db.insert(activityLog).values({ action: "manual_add", entityType: "alumnus", entityId: String(created.id), actor, details: `Manual entry created for ${created.name}; no provider call was made.` });
      await writeSecurityAudit(context, { action: "alumnus_manual_created", entityType: "alumnus", entityId: created.id, metadata: { source: "Manual entry" } });
      return Response.json({ alumnus: toApiAlumnus(created, context.role), providerCreditsUsed: 0 }, { status: 201 });
    }

    if (payload.action !== "import" || !Array.isArray(payload.records)) return Response.json({ error: "A valid alumni import is required." }, { status: 400 });
    if (payload.records.length < 1 || payload.records.length > 250) {
      return Response.json({ error: "Import between 1 and 250 records at a time." }, { status: 400 });
    }
    const filename = text(payload.filename, "Manual import");
    const records = payload.records.map(record => normaliseRecord(record, filename, actor));
    const keys = records.map(record => record.profileKey);
    if (new Set(keys).size !== keys.length) return Response.json({ error: "The file contains duplicate alumni rows. Remove duplicates and validate again." }, { status: 400 });
    const approved = new Set(payload.approvedUpdateKeys ?? []);
    const people = await db.select().from(alumni);
    let imported = 0;
    let updated = 0;
    let protectedFields = 0;
    for (const record of records) {
      const existing = people.find(person => person.profileKey === record.profileKey)
        ?? people.find(person => record.email && normalized(person.email) === normalized(record.email))
        ?? people.find(person => record.linkedinUrl && normalized(person.linkedinUrl) === normalized(record.linkedinUrl));
      if (!existing) {
        await db.insert(alumni).values(record);
        imported += 1;
        continue;
      }
      if (!approved.has(record.profileKey)) continue;
      const changes: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: new Date().toISOString(), source: record.source };
      const changed: Array<{ field: string; oldValue: string; newValue: string }> = [];
      const apply = (field: keyof typeof record, current: unknown, allowed: boolean) => {
        const next = record[field];
        if (!next || normalized(current) === normalized(next)) return;
        if (!allowed) { protectedFields += 1; return; }
        (changes as Record<string, unknown>)[field] = next;
        changed.push({ field: String(field), oldValue: text(current), newValue: text(next) });
      };
      apply("programme", existing.programme, !existing.programme || existing.programme === "Not recorded");
      apply("education", existing.education, !existing.education);
      apply("company", existing.company, existing.currentCompanyVerification === "Unverified");
      apply("title", existing.title, existing.designationVerification === "Unverified");
      apply("rawTitle", existing.rawTitle, existing.designationVerification === "Unverified");
      apply("function", existing.function, existing.designationVerification === "Unverified" || existing.function === "Not assessed");
      apply("seniority", existing.seniority, existing.designationVerification === "Unverified" || existing.seniority === "Not assessed");
      apply("location", existing.location, existing.locationVerification === "Unverified");
      apply("previous", existing.previous, !existing.previous);
      apply("experience", existing.experience, !existing.experience);
      apply("linkedinUrl", existing.linkedinUrl, !existing.linkedinUrl);
      apply("email", existing.email, !existing.email);
      apply("phone", existing.phone, !existing.phone);
      if (changes.email) { changes.emailSource = record.emailSource; changes.emailVerification = "Unverified"; }
      if (changes.phone) { changes.phoneSource = record.phoneSource; changes.phoneVerification = "Unverified"; }
      if (changed.length) {
        await db.update(alumni).set(changes).where(eq(alumni.id, existing.id));
        for (const item of changed) await db.insert(fieldChangeHistory).values({ alumnusId: existing.id, field: item.field, oldValue: item.oldValue, newValue: item.newValue, source: record.source, providerAction: "Reviewed alumni import", initiatedBy: actor });
        updated += 1;
      }
    }
    await db.insert(importRuns).values({ filename, rowCount: records.length, importedBy: actor });
    await db.insert(activityLog).values({ action: "import", entityType: "alumni", entityId: filename, actor, details: `${imported} created; ${updated} safely updated; ${protectedFields} protected fields preserved` });
    await writeSecurityAudit(context, { action: "alumni_imported", entityType: "import", entityId: filename, metadata: { recordCount: records.length, imported, updated, protectedFields } });
    return Response.json({ imported, updated, protectedFields, filename }, { status: 201 });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import alumni records." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as {
      action?: string;
      id?: number;
      status?: string;
      assessment?: { hiringInfluence?: string; iimlRelationship?: string; warmIntroPotential?: string };
      company?: string;
      priority?: string;
      privacy?: { generalContactStatus?: string; professionalEngagementStatus?: string; birthdayEngagementStatus?: string; consentSource?: string; notes?: string };
      professionalDataStatus?: string;
      professionalDataNote?: string;
    };
    const db = getDb();
    const now = new Date().toISOString();

    if (payload.action === "update_alumnus" && Number.isInteger(payload.id)) {
      const context = await authorizeRequest(request, "OPERATE_PCOM");
      const actor = context.displayName;
      const updates: Partial<typeof alumni.$inferInsert> = { updatedBy: actor, updatedAt: now };
      if (payload.status && allowedStatuses.has(payload.status)) updates.status = payload.status;
      if (payload.assessment) {
        if (payload.assessment.hiringInfluence) updates.hiringInfluence = payload.assessment.hiringInfluence;
        if (payload.assessment.iimlRelationship) updates.iimlRelationship = payload.assessment.iimlRelationship;
        if (payload.assessment.warmIntroPotential) updates.warmIntroPotential = payload.assessment.warmIntroPotential;
      }
      const [updated] = await db.update(alumni).set(updates).where(eq(alumni.id, payload.id!)).returning();
      if (!updated) return Response.json({ error: "Alumnus not found." }, { status: 404 });
      await db.insert(activityLog).values({ action: "update", entityType: "alumnus", entityId: String(payload.id), actor, details: payload.status ? `Outreach set to ${payload.status}` : "Assessment updated" });
      await writeSecurityAudit(context, { action: payload.assessment ? "relationship_assessment_changed" : "alumnus_updated", entityType: "alumnus", entityId: payload.id, metadata: { outreachStatus: payload.status, assessmentFields: payload.assessment ? Object.keys(payload.assessment) : [] } });
      return Response.json({ alumnus: toApiAlumnus(updated, context.role) });
    }

    if (payload.action === "update_priority" && text(payload.company) && text(payload.priority)) {
      const context = await authorizeRequest(request, "MANAGE_PROVIDER_SETTINGS");
      const actor = context.displayName;
      const company = text(payload.company);
      const priority = text(payload.priority);
      await db.insert(companyPriorities).values({ company, priority, updatedBy: actor, updatedAt: now }).onConflictDoUpdate({
        target: companyPriorities.company,
        set: { priority, updatedBy: actor, updatedAt: now },
      });
      await db.insert(activityLog).values({ action: "update", entityType: "company", entityId: company, actor, details: `Priority set to ${priority}` });
      await writeSecurityAudit(context, { action: "company_priority_changed", entityType: "company", entityId: company, metadata: { priority } });
      return Response.json({ company, priority });
    }

    if (payload.action === "update_data_quality" && Number.isInteger(payload.id)) {
      const context = await authorizeRequest(request, "OPERATE_PCOM");
      const actor = context.displayName;
      const allowed = new Set(["Needs assessment", "Reviewed", "Current", "Conflict — manual verification required", "Manually verified"]);
      const professionalDataStatus = allowed.has(text(payload.professionalDataStatus)) ? text(payload.professionalDataStatus) : "Needs assessment";
      const professionalDataNote = text(payload.professionalDataNote).slice(0, 1000);
      const [updated] = await db.update(alumni).set({ professionalDataStatus, professionalDataNote, updatedBy: actor, updatedAt: now }).where(eq(alumni.id, payload.id!)).returning();
      if (!updated) return Response.json({ error: "Alumnus not found." }, { status: 404 });
      await db.insert(fieldChangeHistory).values({ alumnusId: updated.id, field: "professional_data_status", oldValue: "", newValue: professionalDataStatus, source: "Manual PCOM review", providerAction: "Data conflict review", initiatedBy: actor });
      await writeSecurityAudit(context, { action: "professional_data_quality_changed", entityType: "alumnus", entityId: updated.id, metadata: { professionalDataStatus, noteRecorded: Boolean(professionalDataNote) } });
      return Response.json({ alumnus: toApiAlumnus(updated, context.role) });
    }

    if (payload.action === "update_privacy" && Number.isInteger(payload.id) && payload.privacy) {
      const context = await authorizeRequest(request, "MANAGE_PRIVACY");
      const actor = context.displayName;
      const allowedContact = new Set(["Standard engagement allowed", "Professional engagement only", "Birthday engagement allowed", "No professional engagement", "No birthday engagement", "Do not contact", "Unknown"]);
      const allowedConsent = new Set(["Internal institutional record", "Alumni-confirmed", "Manual PCOM record", "Provider sourced", "Unknown"]);
      const value = (candidate: unknown, allowed: Set<string>, fallback = "Unknown") => allowed.has(text(candidate)) ? text(candidate) : fallback;
      const record = {
        alumnusId: payload.id!,
        generalContactStatus: value(payload.privacy.generalContactStatus, allowedContact),
        professionalEngagementStatus: value(payload.privacy.professionalEngagementStatus, allowedContact),
        birthdayEngagementStatus: value(payload.privacy.birthdayEngagementStatus, allowedContact),
        consentSource: value(payload.privacy.consentSource, allowedConsent),
        notes: text(payload.privacy.notes).slice(0, 1000),
        updatedBy: actor,
        updatedAt: now,
      };
      const [updated] = await db.insert(alumniPrivacyControls).values(record).onConflictDoUpdate({ target: alumniPrivacyControls.alumnusId, set: record }).returning();
      await writeSecurityAudit(context, { action: record.generalContactStatus === "Do not contact" ? "do_not_contact_changed" : "privacy_preference_changed", entityType: "alumnus", entityId: payload.id, metadata: { generalContactStatus: record.generalContactStatus, professionalEngagementStatus: record.professionalEngagementStatus, birthdayEngagementStatus: record.birthdayEngagementStatus, consentSource: record.consentSource } });
      return Response.json({ privacy: updated });
    }

    return Response.json({ error: "Unsupported workspace update." }, { status: 400 });
  } catch (error) {
    const denied = accessErrorResponse(error);
    if (denied) return denied;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the update." }, { status: 500 });
  }
}
