import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const verification = await vite.ssrLoadModule("/lib/professional-verification.ts")
const metrics = await vite.ssrLoadModule("/lib/alumni-metrics.ts")
const policy = await vite.ssrLoadModule("/lib/security-policy.ts")
const route = await readFile(new URL("../app/api/professional-verification/route.ts", import.meta.url), "utf8")
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

function request(fields, evidenceSource = "Professional profile manual review", note = "") {
  return { action: "verify_professional_fields", alumnusId: 15, fields, evidenceSource, note, confirmed: true }
}

test("Admin and PCOM can operate while Developer cannot", () => {
  assert.equal(policy.hasPermission("ADMIN", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("PCOM", "OPERATE_PCOM"), true)
  assert.equal(policy.hasPermission("DEVELOPER", "OPERATE_PCOM"), false)
  assert.match(route, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
})

test("the route requires authenticated authorization before reading or writing", () => {
  const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"))
  const postBody = route.slice(route.indexOf("export async function POST"))
  assert.ok(getBody.indexOf("authorizeRequest") < getBody.indexOf("getDb()"))
  assert.ok(postBody.indexOf("authorizeRequest") < postBody.indexOf("request.json()"))
  assert.match(route, /accessErrorResponse\(error\)/)
})

test("all supported independent verification states validate", () => {
  for (const state of ["Confirmed", "Mismatch", "Unverified"]) assert.equal(verification.validateProfessionalVerificationRequest(request({ profileMatch: state })).fields.profileMatch, state)
  for (const state of ["Verified", "Possibly outdated", "Unverified"]) assert.equal(verification.validateProfessionalVerificationRequest(request({ currentCompany: state })).fields.currentCompany, state)
  for (const state of ["Verified", "Likely", "Possibly outdated", "Unverified"]) assert.equal(verification.validateProfessionalVerificationRequest(request({ designation: state })).fields.designation, state)
})

test("positive verification requires a controlled evidence source", () => {
  assert.throws(() => verification.validateProfessionalVerificationRequest(request({ profileMatch: "Confirmed" }, "")), /evidence source is required/i)
  assert.throws(() => verification.validateProfessionalVerificationRequest(request({ currentCompany: "Verified" }, "Free text source")), /supported verification evidence source/i)
  assert.equal(verification.validateProfessionalVerificationRequest(request({ designation: "Likely" }, "Institutional record")).evidenceSource, "Institutional record")
})

test("other documented evidence requires a note", () => {
  assert.throws(() => verification.validateProfessionalVerificationRequest(request({ designation: "Verified" }, "Other documented evidence")), /review note/i)
  assert.equal(verification.validateProfessionalVerificationRequest(request({ designation: "Verified" }, "Other documented evidence", "Reviewed committee record.")).note, "Reviewed committee record.")
})

test("invalid states, unsupported fields, and forged reviewer identity are rejected", () => {
  assert.throws(() => verification.validateProfessionalVerificationRequest(request({ profileMatch: "Verified" })), /unsupported profile match state/i)
  assert.throws(() => verification.validateProfessionalVerificationRequest(request({ company: "Verified" })), /unsupported verification field/i)
  assert.throws(() => verification.validateProfessionalVerificationRequest({ ...request({ profileMatch: "Confirmed" }), reviewedBy: "Forged reviewer" }), /unsupported verification property/i)
})

test("explicit confirmation is mandatory", () => {
  assert.throws(() => verification.validateProfessionalVerificationRequest({ ...request({ profileMatch: "Mismatch" }, ""), confirmed: false }), /explicit confirmation/i)
})

test("partial field verification cannot falsely produce a complete readiness state", () => {
  const status = metrics.contactReadiness({ profileMatch: "Confirmed", currentCompany: "Unverified", designation: "Unverified", email: "Unverified", phone: "Unverified" })
  assert.equal(status, "Needs verification")
  const professionalOnly = metrics.contactReadiness({ profileMatch: "Confirmed", currentCompany: "Verified", designation: "Likely", email: "Unverified", phone: "Unverified" })
  assert.equal(professionalOnly, "Partially verified")
})

test("server writes only verification state plus reviewer metadata and audits each change", () => {
  assert.match(route, /profileMatch: \{ column: "profile_match", property: "profileMatch" \}/)
  assert.match(route, /currentCompany: \{ column: "current_company_verification", property: "currentCompanyVerification" \}/)
  assert.match(route, /designation: \{ column: "designation_verification", property: "designationVerification" \}/)
  assert.match(route, /source: "Manual verification"/)
  assert.match(route, /initiatedBy: context\.displayName/)
  assert.match(route, /action: "professional_fields_verified"/)
  assert.match(route, /await db\.batch\(\[updatePerson, \.\.\.historyWrites, audit\]\)/)
  assert.doesNotMatch(route, /updates\.(company|title|email|phone|professionalDataStatus)\s*=/)
})

test("verification workflow never calls a provider and leaves aggregate status independent", () => {
  assert.doesNotMatch(route, /fetch\(|refreshProfile|searchLusha|fetchLusha|revealLusha|sendGmail/)
  assert.doesNotMatch(route, /updates\.professionalDataStatus|professionalDataStatus:\s*"Manually verified"/)
  assert.match(page, /This aggregate state remains separate and will not be changed by field verification/)
})

test("profile UI provides evidence review, independent controls, and explicit confirmation", () => {
  assert.match(page, /Review verification evidence/)
  assert.match(page, /PROFESSIONAL_VERIFICATION_OPTIONS/)
  assert.match(page, /Verify professional data\?/)
  assert.match(page, /Confirm verification/)
  assert.match(page, /Current stored name|Stored professional record/)
  assert.match(page, /Recent professional field history/)
  assert.match(page, /Coresignal evidence/)
  assert.match(page, /Lusha identity evidence/)
})
