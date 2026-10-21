import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

test("future import observations are FK-bound, idempotent, and preserve a source row without contact data", async () => {
  const migration = await readFile(new URL("../drizzle/0022_fearless_impossible_man.sql", import.meta.url), "utf8")
  const route = await readFile(new URL("../app/api/imports/route.ts", import.meta.url), "utf8")
  const history = await readFile(new URL("../app/api/alumni/[id]/history/route.ts", import.meta.url), "utf8")
  assert.match(route, /retainedImportObservation\(row\.record\)/)
  assert.doesNotMatch(route.slice(route.indexOf("function retainedImportObservation"), route.indexOf("async function sha256")), /record\.(email|phone)/)
  assert.match(history, /SOURCE_OBSERVATION/)
  const db = new DatabaseSync(":memory:")
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE alumni(id INTEGER PRIMARY KEY); INSERT INTO alumni(id) VALUES (1);")
    db.exec(migration.replaceAll("--> statement-breakpoint", ""))
    const insert = db.prepare("INSERT INTO alumni_source_observations(alumnus_id,mutation_request_key,source_row_key,filename,source_system,observed_json,imported_by) VALUES(?,?,?,?,?,?,?)")
    insert.run(1, "request-a", "row-a", "synthetic.xlsx", "synthetic", JSON.stringify({ company: "Example", title: "Director" }), "Admin")
    assert.throws(() => insert.run(1, "request-a", "row-a", "synthetic.xlsx", "synthetic", "{}", "Admin"), /UNIQUE/)
    assert.throws(() => insert.run(99, "request-b", "row-b", "synthetic.xlsx", "synthetic", "{}", "Admin"), /FOREIGN KEY/)
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok")
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [])
  } finally { db.close() }
})
