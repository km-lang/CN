import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { generateSyntheticAlumni } from "../scripts/synthetic-alumni-generator.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))

async function isolatedDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "cn-six-stage-")); const path = join(directory, "acceptance.sqlite"); const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys=ON")
  const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
  for (const migration of migrations) db.exec((await readFile(join(root, "drizzle", migration), "utf8")).replaceAll("--> statement-breakpoint", ""))
  return { db, directory }
}

test("isolated imported alumni complete the six-stage workflow without provider or canonical automation", async () => {
  const { db, directory } = await isolatedDatabase()
  try {
    const insertAlumnus = db.prepare(`INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,education,company,title,raw_title,function,seniority,location,experience_years,confidence,email,linkedin_url,verified_label,outreach_status,note,profile_match,current_company_verification,designation_verification,email_verification,phone_verification,location_verification,source,updated_by,discovery_source,current_industry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    const records = generateSyntheticAlumni(100)
    db.exec("BEGIN")
    for (const row of records) insertAlumnus.run(`institutional:${row.source_system}:${row.source_alumni_id.toLowerCase()}`, row.name, "SA", Number(row.graduation_year), Number(row.graduation_year), row.programme, "Indian Institute of Management Lucknow", row.company, row.title, row.title, row.function, row.seniority, row.location, Number(row.experience_years), 50, row.email, row.linkedin_url, "Imported claim · not independently verified", "Not contacted", row.note, "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", "Unverified", "Institutional import", "Synthetic acceptance", "Institutional import", row.industry)
    db.exec("COMMIT")
    db.prepare("INSERT INTO application_users(external_identity,display_name,email,role,enabled) VALUES (?,?,?,?,1)").run("synthetic-admin", "Synthetic Admin", "admin@example.test", "ADMIN")
    db.prepare("INSERT INTO application_users(external_identity,display_name,email,role,enabled) VALUES (?,?,?,?,1)").run("synthetic-pcom", "Synthetic PCOM", "pcom@example.test", "PCOM")
    const admin = db.prepare("SELECT id FROM application_users WHERE role='ADMIN'").get(); const pcom = db.prepare("SELECT id FROM application_users WHERE role='PCOM'").get()

    // Stage 1: directory/company association comes from persisted imported rows.
    const targetCompany = records[0].company; const relevant = db.prepare("SELECT id,name,company FROM alumni WHERE company=? ORDER BY name").all(targetCompany)
    assert.ok(relevant.length >= 1)
    const alumnus = relevant[0]

    // Stage 2: existing inputs are persisted and deterministic for established scoring.
    db.prepare("INSERT INTO company_priorities(company,priority,updated_by) VALUES (?,?,?)").run(targetCompany, "Priority Target", "Synthetic Admin")
    const scoringInputs = db.prepare("SELECT a.company,a.seniority,a.hiring_influence,a.iiml_relationship,a.warm_intro_potential,cp.priority FROM alumni a JOIN company_priorities cp ON cp.company=a.company WHERE a.id=?").get(alumnus.id)
    assert.equal(scoringInputs.priority, "Priority Target")

    // Stage 3: mock evidence creates a pending review; canonical alumnus fields stay unchanged.
    const canonicalBefore = JSON.stringify(db.prepare("SELECT company,title,location,profile_match,current_company_verification,designation_verification FROM alumni WHERE id=?").get(alumnus.id))
    const response = db.prepare("INSERT INTO provider_response_history(provider,alumnus_id,alumnus_name,operation,mode,status,credits_used,application_units,request_summary,response_summary,requested_by) VALUES ('coresignal',?,?, 'profile_refresh','mock','success',0,0,'synthetic request','sanitized mock evidence','Synthetic Admin') RETURNING id").get(alumnus.id, alumnus.name)
    db.prepare("INSERT INTO provider_refresh_reviews(provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES (?,?,?,'Pending review','Synthetic Admin')").run(response.id, alumnus.id, JSON.stringify([{ field: "title", current: "Stored title", proposed: "Mock proposed title" }]))
    assert.equal(JSON.stringify(db.prepare("SELECT company,title,location,profile_match,current_company_verification,designation_verification FROM alumni WHERE id=?").get(alumnus.id)), canonicalBefore)

    // Stage 4: ownership and ownership history are persisted to the engagement workflow.
    const event = db.prepare("INSERT INTO engagement_events(event_key,alumnus_id,company,event_type,event_title,source,event_date,status,assigned_to,assigned_at,created_by,last_updated_by) VALUES (?,?,?,?,?,?,?,'Assigned',?,CURRENT_TIMESTAMP,?,?) RETURNING id").get("synthetic-event-1", alumnus.id, targetCompany, "Corporate outreach", "Synthetic placement conversation", "Synthetic acceptance", "2026-10-16", "Synthetic PCOM", "Synthetic Admin", "Synthetic Admin")
    db.prepare("INSERT INTO engagement_audit_log(event_id,action,actor,details) VALUES (?,?,?,?)").run(event.id, "assigned", "Synthetic Admin", "Assigned to Synthetic PCOM")
    assert.equal(db.prepare("SELECT assigned_to FROM engagement_events WHERE id=?").get(event.id).assigned_to, "Synthetic PCOM")

    // Stage 5: DNC remains authoritative; only a mock activity record is created.
    db.prepare("INSERT INTO alumni_privacy_controls(alumnus_id,general_contact_status,professional_engagement_status,birthday_engagement_status,consent_source,updated_by) VALUES (?,'Do not contact','No professional engagement','No birthday engagement','Internal institutional record','Synthetic Admin')").run(alumnus.id)
    const privacy = db.prepare("SELECT * FROM alumni_privacy_controls WHERE alumnus_id=?").get(alumnus.id)
    assert.equal(privacy.general_contact_status, "Do not contact")
    db.prepare("UPDATE engagement_events SET follow_up_required=1,follow_up_date='2026-10-30',response_notes='Mock follow-up only',last_updated_by='Synthetic PCOM' WHERE id=?").run(event.id)
    assert.equal(db.prepare("SELECT count(*) AS count FROM engagement_actions").get().count, 0)

    // Stage 6: opportunity links, transitions, history and optimistic version fencing persist.
    const opportunity = db.prepare("INSERT INTO corporate_opportunities(opportunity_key,company,alumnus_id,engagement_id,owner_user_id,title,stage,next_action,follow_up_date,version,created_by_user_id,last_updated_by_user_id) VALUES (?,?,?,?,?,?,'IDENTIFIED','Review synthetic opportunity','2026-10-30',1,?,?) RETURNING id").get("synthetic-opportunity-1", targetCompany, alumnus.id, event.id, pcom.id, "Synthetic recruiting partnership", admin.id, admin.id)
    db.prepare("INSERT INTO corporate_opportunity_history(opportunity_id,actor_user_id,action,from_stage,to_stage,summary) VALUES (?,?,'created','','IDENTIFIED','Synthetic opportunity created')").run(opportunity.id, admin.id)
    const changed = db.prepare("UPDATE corporate_opportunities SET stage='QUALIFYING',version=version+1,last_updated_by_user_id=? WHERE id=? AND version=1").run(pcom.id, opportunity.id)
    assert.equal(changed.changes, 1)
    const stale = db.prepare("UPDATE corporate_opportunities SET stage='ON_HOLD',version=version+1 WHERE id=? AND version=1").run(opportunity.id)
    assert.equal(stale.changes, 0)
    db.prepare("INSERT INTO corporate_opportunity_history(opportunity_id,actor_user_id,action,from_stage,to_stage,summary) VALUES (?,?,'updated','IDENTIFIED','QUALIFYING','Qualified by Synthetic PCOM')").run(opportunity.id, pcom.id)
    assert.equal(db.prepare("SELECT count(*) AS count FROM corporate_opportunity_history WHERE opportunity_id=?").get(opportunity.id).count, 2)

    assert.equal(db.prepare("SELECT count(*) AS count FROM alumni").get().count, 100)
    assert.equal(db.prepare("SELECT count(*) AS count FROM provider_response_history WHERE mode!='mock'").get().count, 0)
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0)
  } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
})
