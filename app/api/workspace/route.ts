import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLog, alumni, companyPriorities, importRuns } from "@/db/schema";

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

function actorFrom(request: Request) {
  return request.headers.get("oai-authenticated-user-email")
    ?? request.headers.get("oai-authenticated-user-id")
    ?? "Signed-in committee member";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "AL";
}

function profileKey(record: ImportedRecord) {
  const supplied = text(record.profileKey ?? record.profile_key);
  if (supplied) return supplied.toLowerCase();
  return [record.name, record.batch, record.company].map(value => text(value).toLowerCase()).join("|");
}

function toApiAlumnus(row: typeof alumni.$inferSelect) {
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
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedinUrl,
    pdlPersonId: row.pdlPersonId,
    lushaPersonId: row.lushaPersonId,
    discoverySource: row.discoverySource,
    discoveryDate: row.discoveryDate,
    lastPdlRefresh: row.lastPdlRefresh,
    lastLushaEnrichment: row.lastLushaEnrichment,
    emailSource: row.emailSource,
    phoneSource: row.phoneSource,
    emailRetrievedAt: row.emailRetrievedAt,
    phoneRetrievedAt: row.phoneRetrievedAt,
    verified: row.verified,
    status: row.status,
    note: row.note,
    assessment: {
      hiringInfluence: row.hiringInfluence,
      iimlRelationship: row.iimlRelationship,
      warmIntroPotential: row.warmIntroPotential,
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
    function: text(record.function, "Other"),
    seniority: text(record.seniority, "Not assessed"),
    location: text(record.location, "Not recorded"),
    previous: text(record.previous ?? record.previous_companies),
    experience: Math.max(0, number(record.experience ?? record.experience_years)),
    confidence: Math.min(100, Math.max(0, number(record.confidence, 50))),
    email: text(record.email).toLowerCase(),
    phone: text(record.phone),
    linkedinUrl: text(record.linkedinUrl ?? record.linkedin_url),
    pdlPersonId: text(record.pdlPersonId ?? record.pdl_person_id),
    lushaPersonId: text(record.lushaPersonId ?? record.lusha_person_id),
    discoverySource: text(record.discoverySource ?? record.discovery_source, filename),
    discoveryDate: text(record.discoveryDate ?? record.discovery_date),
    lastPdlRefresh: text(record.lastPdlRefresh ?? record.last_pdl_refresh),
    lastLushaEnrichment: text(record.lastLushaEnrichment ?? record.last_lusha_enrichment),
    emailSource: text(record.emailSource ?? record.email_source),
    phoneSource: text(record.phoneSource ?? record.phone_source),
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
    emailVerification: verification(record.emailVerification ?? record.email_verification ?? fieldVerification.email),
    phoneVerification: verification(record.phoneVerification ?? record.phone_verification ?? fieldVerification.phone),
    locationVerification: verification(record.locationVerification ?? record.location_verification ?? fieldVerification.location),
    source: filename,
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const db = getDb();
    const [alumniRows, priorityRows, latestImports] = await Promise.all([
      db.select().from(alumni).orderBy(alumni.name),
      db.select().from(companyPriorities).orderBy(companyPriorities.company),
      db.select().from(importRuns).orderBy(desc(importRuns.createdAt), desc(importRuns.id)).limit(1),
    ]);
    return Response.json({
      alumni: alumniRows.map(toApiAlumnus),
      companyPriorities: Object.fromEntries(priorityRows.map(row => [row.company, row.priority])),
      latestImport: latestImports[0] ?? null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the shared workspace." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; filename?: string; records?: ImportedRecord[] };
    if (payload.action !== "import" || !Array.isArray(payload.records)) {
      return Response.json({ error: "A valid alumni import is required." }, { status: 400 });
    }
    if (payload.records.length < 1 || payload.records.length > 250) {
      return Response.json({ error: "Import between 1 and 250 records at a time." }, { status: 400 });
    }
    const db = getDb();
    const actor = actorFrom(request);
    const filename = text(payload.filename, "Manual import");
    const records = payload.records.map(record => normaliseRecord(record, filename, actor));
    for (const record of records) {
      await db.insert(alumni).values(record).onConflictDoUpdate({
        target: alumni.profileKey,
        set: record,
      });
    }
    await db.insert(importRuns).values({ filename, rowCount: records.length, importedBy: actor });
    await db.insert(activityLog).values({ action: "import", entityType: "alumni", entityId: filename, actor, details: `${records.length} records imported` });
    return Response.json({ imported: records.length, filename }, { status: 201 });
  } catch (error) {
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
    };
    const db = getDb();
    const actor = actorFrom(request);
    const now = new Date().toISOString();

    if (payload.action === "update_alumnus" && Number.isInteger(payload.id)) {
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
      return Response.json({ alumnus: toApiAlumnus(updated) });
    }

    if (payload.action === "update_priority" && text(payload.company) && text(payload.priority)) {
      const company = text(payload.company);
      const priority = text(payload.priority);
      await db.insert(companyPriorities).values({ company, priority, updatedBy: actor, updatedAt: now }).onConflictDoUpdate({
        target: companyPriorities.company,
        set: { priority, updatedBy: actor, updatedAt: now },
      });
      await db.insert(activityLog).values({ action: "update", entityType: "company", entityId: company, actor, details: `Priority set to ${priority}` });
      return Response.json({ company, priority });
    }

    return Response.json({ error: "Unsupported workspace update." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the update." }, { status: 500 });
  }
}
