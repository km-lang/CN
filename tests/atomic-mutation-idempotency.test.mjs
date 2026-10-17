import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createServer } from "vite"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
const idempotency = await vite.ssrLoadModule("/lib/mutation-fingerprint.ts")
const profileRoute = await readFile(new URL("../app/api/alumni/[id]/route.ts", import.meta.url), "utf8")
const importRoute = await readFile(new URL("../app/api/imports/route.ts", import.meta.url), "utf8")
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8")
const migration = await readFile(new URL("../drizzle/0016_colossal_marrow.sql", import.meta.url), "utf8")

test.after(async () => vite.close())

test("normalized payload fingerprints are deterministic and distinguish changed requests", async () => {
  assert.equal(idempotency.stableMutationPayload({ b: 2, a: { d: 4, c: 3 } }), idempotency.stableMutationPayload({ a: { c: 3, d: 4 }, b: 2 }))
  assert.equal(await idempotency.sha256Text("same"), await idempotency.sha256Text("same"))
  assert.notEqual(await idempotency.sha256Text("same"), await idempotency.sha256Text("different"))
})

test("profile writes use one D1 batch with a database-enforced CAS guard and terminal outcome", () => {
  assert.match(profileRoute, /db\.update\(alumni\)[\s\S]*eq\(alumni\.recordVersion, current\.recordVersion\)/)
  assert.match(profileRoute, /mutationCommitGuards[\s\S]*last_mutation_request_key/)
  assert.match(profileRoute, /db\.batch\(actions/)
  assert.match(profileRoute, /securityAuditEvents[\s\S]*mutationRequestKey/)
  assert.match(profileRoute, /status: "COMPLETED"[\s\S]*responseJson/)
  assert.match(profileRoute, /IDEMPOTENCY|existingMutation|replayMutationResponse/)
})

test("proposal decisions are version-fenced and atomically persist decision, history and audit", () => {
  assert.match(profileRoute, /STALE_PROPOSAL/)
  assert.match(profileRoute, /proposal_accept[\s\S]*fieldChangeHistory[\s\S]*securityAuditEvents/)
  assert.match(profileRoute, /proposal_reject[\s\S]*securityAuditEvents/)
  assert.match(profileRoute, /decision_mutation_request_key/)
})

test("import rows keep mutation, ownership guard and durable item checkpoint in one bounded group", () => {
  assert.match(importRoute, /const enqueueGroup/)
  assert.match(importRoute, /queued\.length \+ actions\.length > 80/)
  assert.match(importRoute, /attempt_count = \$\{attemptCount\}/)
  assert.match(importRoute, /unixepoch\(lease_expires_at\) >= unixepoch\('now'\)/)
  assert.match(importRoute, /prior\.existing\.status === "IN_PROGRESS"[\s\S]*unixepoch\(\$\{mutationRequests\.leaseExpiresAt\}\) < unixepoch\('now'\)/)
  assert.match(importRoute, /const renewed = await db\.update\(mutationRequests\)[\s\S]*if \(renewed\.length !== 1\) throw new Error\("Import ownership was lost/)
  assert.match(importRoute, /actions\.push\(db\.insert\(mutationRequestItems\)/)
  assert.match(importRoute, /ownershipGuard\(finalAlumnusId, "import_finalize"\)/)
  assert.match(importRoute, /metadataJson: JSON\.stringify\(\{ originalPreviewId: previewId, counts: review\.counts \}\)/)
})

test("0016 is additive and enforces durable uniqueness for requests, items and required effects", () => {
  for (const table of ["mutation_requests", "mutation_request_items", "mutation_commit_guards"]) assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"))
  for (const index of ["idx_mutation_request_client_scope", "idx_mutation_request_item_unique", "idx_profile_change_proposal_mutation_field", "idx_field_change_mutation_field", "idx_security_audit_mutation"]) assert.match(migration, new RegExp(index))
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE)\b/im)
  assert.match(schema, /mutationRequests = sqliteTable/)
  assert.match(schema, /mutationRequestItems = sqliteTable/)
  assert.match(schema, /mutationCommitGuards = sqliteTable/)
})
