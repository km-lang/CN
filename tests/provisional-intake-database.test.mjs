import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

const root = fileURLToPath(new URL("..", import.meta.url))
const migrations = (await readdir(join(root, "drizzle"))).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()
const intakeMigrationIndex = migrations.findIndex(name => name.startsWith("0019_"))

async function migrate(db, through = migrations.length) {
  for (const name of migrations.slice(0, through)) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
}

function seedPrechange(db) {
  db.exec(`insert into application_users (id, display_name, email, role) values (901, 'Synthetic PCOM', 'synthetic-pcom@example.test', 'PCOM');
    insert into alumni (id, profile_key, name, initials, batch, programme, company, title, "function", seniority, location, verified_label)
      values (901, 'synthetic:verified', 'Verified Example', 'VE', 2020, 'PGP', 'Example Co', 'Director', 'Strategy', 'Director', 'India', 'Locally verified');
    insert into external_discovery_searches (id, provider, filters_json, criteria_summary, mode, initiated_by)
      values (901, 'coresignal', '{"institution":"IIML","year":2026}', 'Synthetic test', 'mock', 'Synthetic PCOM');
    insert into external_discovery_results (id, search_id, provider, provider_result_id, provider_person_id, name, education, current_company, role, "function", seniority, location, linkedin_url, match_status)
      values (901, 901, 'coresignal', 'synthetic-result', '900000901', 'Synthetic K.', 'Education not returned', 'Summary company', 'Unknown', 'Other', 'Unknown/Unclassified', 'Unknown', 'https://www.linkedin.com/in/synthetic-intake-k/', 'Needs review');`)
}

test("0019 upgrades populated prechange data without rewriting verified alumni or discovery history", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("pragma foreign_keys=on")
    await migrate(db, intakeMigrationIndex)
    seedPrechange(db)
    const before = db.prepare("select profile_key, verified_label from alumni where id=901").get()
    const searchBefore = db.prepare("select filters_json from external_discovery_searches where id=901").get()
    db.exec(await readFile(join(root, "drizzle", migrations[intakeMigrationIndex]), "utf8"))
    assert.deepEqual(db.prepare("select profile_key, verified_label from alumni where id=901").get(), before)
    assert.deepEqual(db.prepare("select filters_json from external_discovery_searches where id=901").get(), searchBefore)
    assert.equal(db.prepare("select intake_status from alumni where id=901").get().intake_status, "REVIEW_REQUIRED")
    assert.equal(db.prepare("select count(*) as n from external_discovery_results where id=901").get().n, 1)
    for (const name of migrations.slice(intakeMigrationIndex + 1)) db.exec(await readFile(join(root, "drizzle", name), "utf8"))
    assert.equal(db.prepare("select count(*) as n from sqlite_master where type='index' and name='idx_external_result_linked_alumnus_date'").get().n, 1)
    assert.equal(db.prepare("select count(*) as n from sqlite_master where type='index' and name='idx_provider_collection_alumnus_date'").get().n, 1)
    assert.equal(db.prepare("pragma integrity_check").get().integrity_check, "ok")
    assert.equal(db.prepare("select count(*) as n from pragma_foreign_key_check").get().n, 0)
  } finally { db.close() }
})

test("0019 fresh sequence supports persistent synthetic intake, replay guards and unique identity claims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cn-provisional-test-"))
  const path = join(directory, "isolated.sqlite")
  let db = new DatabaseSync(path)
  try {
    db.exec("pragma foreign_keys=on")
    await migrate(db)
    seedPrechange(db)
    db.exec(`begin immediate;
      insert into alumni (profile_key, name, initials, batch, graduation_year, programme, education, company, title, "function", seniority, location, linkedin_url, coresignal_employee_id, verified_label, intake_status, outreach_status)
        values ('coresignal:900000901', 'Synthetic K.', 'SK', 0, 0, 'Unknown', 'Unknown', 'Unknown', 'Unknown', 'Other', 'Unknown/Unclassified', 'Unknown', 'https://www.linkedin.com/in/synthetic-intake-k/', '900000901', 'PROVISIONAL — provider identity only', 'PROVISIONAL', 'Not contacted');
      update external_discovery_results set review_status='Added provisionally', linked_internal_alumnus_id=(select id from alumni where profile_key='coresignal:900000901') where id=901 and review_status='Pending review';
      insert into provisional_alumni_intakes (alumnus_id, discovery_result_id, search_id, provider, provider_person_id, source_profile_url, normalized_profile_key, provider_observations_json, query_constraints_json, verification_state_json, intake_actor_user_id, intake_actor_name)
        values ((select id from alumni where profile_key='coresignal:900000901'), 901, 901, 'coresignal', '900000901', 'https://www.linkedin.com/in/synthetic-intake-k/', 'synthetic-intake-k', '{"education":"not returned"}', '{"year":2026}', '{"institution":"UNVERIFIED","graduationYear":"UNVERIFIED","programme":"UNVERIFIED","currentCompany":"UNVERIFIED"}', 901, 'Synthetic PCOM');
      commit;`)
    db.close()
    db = new DatabaseSync(path)
    db.exec("pragma foreign_keys=on")
    const profile = db.prepare("select a.intake_status, a.graduation_year, a.programme, a.company, a.outreach_status, r.review_status from alumni a join external_discovery_results r on r.linked_internal_alumnus_id=a.id where a.profile_key='coresignal:900000901'").get()
    assert.deepEqual({ ...profile }, { intake_status: "PROVISIONAL", graduation_year: 0, programme: "Unknown", company: "Unknown", outreach_status: "Not contacted", review_status: "Added provisionally" })
    const source = db.prepare("select provider_person_id, search_id, discovery_result_id, query_constraints_json, verification_state_json from provisional_alumni_intakes").get()
    assert.equal(source.provider_person_id, "900000901")
    assert.equal(source.search_id, 901)
    assert.equal(source.discovery_result_id, 901)
    assert.equal(JSON.parse(source.query_constraints_json).year, 2026)
    assert.equal(JSON.parse(source.verification_state_json).programme, "UNVERIFIED")
    assert.throws(() => db.exec("insert into alumni (profile_key,name,initials,batch,programme,company,title,\"function\",seniority,location,coresignal_employee_id) values ('coresignal:other','Duplicate','DU',0,'Unknown','Unknown','Unknown','Other','Unknown','Unknown','900000901')"), /UNIQUE constraint failed/)
    assert.throws(() => db.exec("insert into provisional_alumni_intakes (alumnus_id, discovery_result_id, search_id, provider, provider_person_id, source_profile_url, normalized_profile_key, provider_observations_json, query_constraints_json, verification_state_json, intake_actor_user_id, intake_actor_name) values (901,901,901,'coresignal','900000999','https://www.linkedin.com/in/synthetic-intake-k/','synthetic-intake-k','{}','{}','{}',901,'Synthetic PCOM')"), /UNIQUE constraint failed/)
    assert.equal(db.prepare("select count(*) as n from alumni where coresignal_employee_id='900000901'").get().n, 1)
    assert.equal(db.prepare("select count(*) as n from provisional_alumni_intakes").get().n, 1)
    assert.equal(db.prepare("pragma integrity_check").get().integrity_check, "ok")
    assert.equal(db.prepare("select count(*) as n from pragma_foreign_key_check").get().n, 0)
  } finally { db.close(); await rm(directory, { recursive: true, force: true }) }
})

test("cross-source LinkedIn claim aborts a concurrent provisional intake transaction", async () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("pragma foreign_keys=on")
    await migrate(db)
    seedPrechange(db)
    db.exec(`insert into alumni (profile_key, name, initials, batch, programme, company, title, "function", seniority, location, linkedin_url)
      values ('institutional:test:901', 'Imported Example', 'IE', 2020, 'PGP', 'Example Co', 'Analyst', 'Other', 'Unknown', 'India', 'https://www.linkedin.com/in/synthetic-intake-k')`)
    assert.throws(() => db.exec(`begin immediate;
      insert into alumni (profile_key, name, initials, batch, programme, company, title, "function", seniority, location, linkedin_url, coresignal_employee_id, intake_status)
        values ('coresignal:900000901', 'Synthetic K.', 'SK', 0, 'Unknown', 'Unknown', 'Unknown', 'Other', 'Unknown', 'Unknown', 'https://www.linkedin.com/in/synthetic-intake-k/', '900000901', 'PROVISIONAL');
      update external_discovery_results set review_status='Added provisionally', linked_internal_alumnus_id=(select id from alumni where profile_key='coresignal:900000901') where id=901;
      insert into provisional_alumni_intakes (alumnus_id, discovery_result_id, search_id, provider, provider_person_id, source_profile_url, normalized_profile_key, provider_observations_json, query_constraints_json, verification_state_json, intake_actor_user_id, intake_actor_name)
        values ((select id from alumni where profile_key='coresignal:900000901'),
          (select id from external_discovery_results where id=901 and review_status='Added provisionally' and (select count(*) from alumni where rtrim(lower(linkedin_url), '/') = rtrim(lower('https://www.linkedin.com/in/synthetic-intake-k/'), '/')) = 1),
          901, 'coresignal', '900000901', 'https://www.linkedin.com/in/synthetic-intake-k/', 'synthetic-intake-k', '{}', '{}', '{}', 901, 'Synthetic PCOM');
      commit;`), /NOT NULL constraint failed/)
    db.exec("rollback")
    assert.equal(db.prepare("select count(*) as n from alumni where linkedin_url like '%synthetic-intake-k%'").get().n, 1)
    assert.equal(db.prepare("select review_status from external_discovery_results where id=901").get().review_status, "Pending review")
    assert.equal(db.prepare("select count(*) as n from provisional_alumni_intakes").get().n, 0)
  } finally { db.close() }
})
