import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
after(async () => vite.close())

const { evaluateBrightEligibility } = await vite.ssrLoadModule("/lib/bright-eligibility.ts")
const cohort = await readFile(new URL("../lib/intelligence-cohort.server.ts", import.meta.url), "utf8")
const profileRoute = await readFile(new URL("../app/api/intelligence/profile/[alumnusId]/route.ts", import.meta.url), "utf8")
const profilePanel = await readFile(new URL("../components/intelligence/profile-intelligence-panel.tsx", import.meta.url), "utf8")
const refreshCenter = await readFile(new URL("../components/intelligence/refresh-center.tsx", import.meta.url), "utf8")
const externalDiscovery = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8")

const base = {
  lifecycleStatus: "Active",
  linkedinUrl: "https://www.linkedin.com/in/approved-person/",
  profileMatch: "Confirmed",
  mappingStatus: "MAPPED",
}

test("only an active approved LinkedIn identity with a stable mapping is Bright eligible", () => {
  assert.deepEqual(evaluateBrightEligibility(base), {
    eligible: true,
    reason: "ELIGIBLE",
    message: "Approved LinkedIn identity is connected and eligible for Bright refresh.",
    normalizedLinkedinUrl: "https://www.linkedin.com/in/approved-person/",
    canEnroll: false,
  })
  assert.equal(evaluateBrightEligibility({ ...base, linkedinUrl: "" }).reason, "MISSING_LINKEDIN")
  assert.equal(evaluateBrightEligibility({ ...base, profileMatch: "Unverified" }).reason, "LINKEDIN_NOT_VERIFIED")
  assert.equal(evaluateBrightEligibility({ ...base, profileMatch: "Mismatch" }).reason, "IDENTITY_CONFLICT")
  assert.equal(evaluateBrightEligibility({ ...base, lifecycleStatus: "Inactive" }).reason, "INACTIVE")
})

test("safe enrollment is offered only when no conflicting LinkedIn identity exists", () => {
  const newIdentity = evaluateBrightEligibility({ ...base, mappingStatus: "UNMAPPED" })
  assert.equal(newIdentity.reason, "MAPPING_REQUIRED")
  assert.equal(newIdentity.canEnroll, true)

  const possibleExisting = evaluateBrightEligibility({ ...base, mappingStatus: "UNMAPPED", suggestedIntelligenceAlumniId: "existing-id" })
  assert.equal(possibleExisting.reason, "MAPPING_REQUIRED")
  assert.equal(possibleExisting.canEnroll, true)
  assert.equal(evaluateBrightEligibility({ ...base, mappingStatus: "AMBIGUOUS" }).reason, "IDENTITY_CONFLICT")
  assert.equal(evaluateBrightEligibility({ ...base, mappingStatus: "CONFLICT" }).reason, "IDENTITY_CONFLICT")
  const legacyMapped = evaluateBrightEligibility({ ...base, intelligenceEnrollmentApproved: false })
  assert.equal(legacyMapped.reason, "MAPPING_REQUIRED")
  assert.equal(legacyMapped.canEnroll, true)
})

test("record origin never changes the authoritative eligibility result", () => {
  for (const origin of ["Manual entry", "CSV import", "Coresignal discovery"]) {
    assert.equal(evaluateBrightEligibility({ ...base, origin }).reason, "ELIGIBLE")
    assert.equal(evaluateBrightEligibility({ ...base, profileMatch: "Unverified", origin }).reason, "LINKEDIN_NOT_VERIFIED")
  }
})

test("Directory cohorts apply eligibility before Intelligence preview and expose exclusions", () => {
  assert.match(cohort, /evaluateBrightEligibility/)
  assert.match(cohort, /item\.eligibility\.eligible/)
  assert.match(cohort, /missingLinkedin/)
  assert.match(cohort, /linkedinNotVerified/)
  assert.match(cohort, /identityReviewRequired/)
  assert.match(refreshCenter, /Bright eligible/)
  assert.match(refreshCenter, /LinkedIn\/profile not approved/)
  assert.match(refreshCenter, /Identity\/mapping review/)
})

test("profile enrollment is server-authoritative, stable-ID based, and never invokes a provider", () => {
  assert.match(profileRoute, /authorizeRequest\(request, "OPERATE_PCOM"\)/)
  assert.match(profileRoute, /evaluateBrightEligibility/)
  assert.match(profileRoute, /\/v1\/alumni\/enroll/)
  assert.match(profileRoute, /profileApproved: true/)
  assert.match(profileRoute, /profileMatch: person\.profileMatch/)
  assert.match(profileRoute, /eligibility\.reason !== "MAPPING_REQUIRED"/)
  assert.doesNotMatch(profilePanel, /profileApproved/)
  assert.doesNotMatch(profileRoute, /coresignal|lusha|brightdata|gmail|socai/i)
  assert.match(profilePanel, /Enroll for Bright/)
  assert.match(profilePanel, /eligibility\.eligible/)
})

test("existing Coresignal External Discovery remains independent from Bright eligibility", () => {
  assert.match(externalDiscovery, /Programme \/ degree labels/)
  assert.doesNotMatch(externalDiscovery, /evaluateBrightEligibility|enroll_bright|\/v1\/alumni\/enroll/)
})
