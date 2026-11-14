import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { promisify } from "node:util"
import { access, appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer as createTcpServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { createHmac } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import test from "node:test"
import pg from "pg"
import { clusterSettings, pgCtl, httpTemporaryPrefix, pgExecutable } from "./support/postgres-test-platform.mjs"
import { unzipSync } from "fflate"
import { createServer as createViteServer } from "vite"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const base = "http://127.0.0.1:3103"
const role = "cn_step3c_test"
const database = "cn_step3c_fixture"
const secret = "fictional-step3c-local-session-secret-at-least-thirty-two"
const serviceSecret = "fictional-stage3-bright-revalidation-only"
const brightTrialUrl = "https://www.linkedin.com/in/fictional-bright-trial"
const brightTrialBody = { action: "attest_human_trial", confirmed: true, billingUncertaintyAcknowledged: true,
  attestationSource: "dashboard", requestQuantity: 1, alumnusId: null, datasetId: "fictional-trial-dataset", profileUrl: brightTrialUrl }
const webhookSecret = "fictional-stage3-webhook-secret-at-least-thirty-two"
const webhookToken = createHmac("sha256", webhookSecret).update("coresignal-experience-v1:99460").digest("hex")
const mockPolicyId = "123e4567-e89b-42d3-a456-426614174000"
const mockPolicyFilter = { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { company: "Fictional unmatched company" }, includeCnAlumniIds: [2], excludeCnAlumniIds: [] }
const mockPolicy = { id: mockPolicyId, name: "Fictional inactive CN policy", mode: "SOCAI_MONITOR", cohortType: "DYNAMIC_FILTER", timingType: "RECURRING", enabled: false, maxProfiles: 5, maxSocaiCalls: 0, maxTargetedBright: 0, lastRunAt: null, nextRunAt: "", status: "INACTIVE", selectionContract: mockPolicyFilter }
const creditMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
const creditBoundary = creditMonth.toISOString()
const creditBefore = new Date(creditMonth.getTime() - 1000).toISOString()
const creditSpace = new Date(creditMonth.getTime() + 86_400_000).toISOString().replace("T", " ").replace(".000Z", "")
const creditOffset = `${creditBoundary.slice(0, 10)}T05:30:00+05:30`
const creditOffsetBefore = `${creditBefore.slice(0, 10)}T23:59:59+00:00`
const creditObserved = new Date().toISOString()
const manualCreditObserved = new Date(new Date(creditObserved).getTime() + 60_000).toISOString()
const q = value => `'${String(value).replaceAll("'", "''")}'`
const creditRows = [
  ["coresignal", "Held Collect", "live", "in_progress", 10, 0, "reserved", creditBoundary],
  ["coresignal", "Completed Collect", "live", "success", 5, 5, "confirmed", creditBoundary],
  ["coresignal", "Ambiguous Collect", "live", "uncertain", 20, 0, "reconciliation_required", creditSpace],
  ["coresignal", "Released Collect", "live", "failed", 0, 0, "released", creditSpace],
  ["coresignal", "Mock Preview", "mock", "success", 7, 0, "not_applicable", creditBoundary],
  ["coresignal", "Previous Month", "live", "success", 99, 99, "confirmed", creditBefore],
  ["lusha", "Completed Reveal", "live", "success", 0, 3, "confirmed", creditBoundary],
  ["lusha", "Held Reveal", "live", "in_progress", 6, 0, "reserved", creditSpace],
  ["lusha", "Released Reveal", "live", "failed", 0, 0, "released", creditSpace],
  ["brightdata", "Completed Trigger", "live", "success", 0, 1, "confirmed", creditBoundary],
  ["coresignal", "Invalid Timestamp", "live", "success", 100, 100, "confirmed", "invalid"],
  ["coresignal", "Offset Boundary", "live", "success", 2, 0, "confirmed", creditOffset],
  ["coresignal", "Offset Before", "live", "success", 100, 0, "confirmed", creditOffsetBefore],
]
const creditObservation = (provider, category, available, unit) => ({ provider, category, available, consumed: null, unit, observedAt: creditObserved, expiresAt: null, source: "admin_dashboard_attestation", sourceDetail: "Fictional dashboard evidence", warning: "", operation: "", operationCost: null, operationCostUnit: "", costBasis: "unknown" })
const creditAuditRows = [
  creditObservation("coresignal", "search", 100, "search credits"),
  creditObservation("coresignal", "search", 80, "search credits"),
  creditObservation("coresignal", "collect", 30, "collect credits"),
  creditObservation("lusha", "general", 5, "credits"),
  creditObservation("brightdata", "currency", 9.5, "USD"),
]
const intakeSearchId = 99001
const intakeResultId = 99002
const intakeProviderId = "99001001"
const intakeProfileUrl = "https://www.linkedin.com/in/fictional-provisional-one/"
const intakeFixtureSql = `
INSERT INTO external_discovery_searches(id,provider,filters_json,criteria_summary,mode,initiated_by)
VALUES (${intakeSearchId},'coresignal','{}','Fictional provisional intake','mock','Fixture');
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status,provider_person_id,linkedin_url)
VALUES (${intakeResultId},${intakeSearchId},'coresignal','fictional-intake-one','Fictional Provisional One','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','${intakeProviderId}','${intakeProfileUrl}');
`
const discoveryEvidenceResultId = 99501
const discoveryEvidenceFixtureSql = `
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status,provider_person_id,linkedin_url)
VALUES (99501,${intakeSearchId},'coresignal','fictional-evidence-one','Fictional Evidence One','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99501001','https://www.linkedin.com/in/fictional-evidence-one/'),
(99502,${intakeSearchId},'coresignal','fictional-evidence-race','Fictional Evidence Race','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99501002','https://www.linkedin.com/in/fictional-evidence-race/'),
(99503,${intakeSearchId},'coresignal','fictional-evidence-rollback','Fictional Evidence Rollback','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99501003','https://www.linkedin.com/in/fictional-evidence-rollback/');
`
const discoveryIgnoreFixtureSql = `
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status)
VALUES (99504,${intakeSearchId},'coresignal','fictional-ignore-one','Fictional Ignore One','Unknown','Fictional Co','Analyst','Other','Unknown/Unclassified','Unknown','New'),
(99505,${intakeSearchId},'coresignal','fictional-ignore-race','Fictional Ignore Race','Unknown','Fictional Co','Analyst','Other','Unknown/Unclassified','Unknown','New'),
(99506,${intakeSearchId},'coresignal','fictional-ignore-rollback','Fictional Ignore Rollback','Unknown','Fictional Co','Analyst','Other','Unknown/Unclassified','Unknown','New');
`
const keepSeparateFixtureSql = `
UPDATE external_discovery_results SET match_status='Possible duplicate' WHERE id=99502;
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status,provider_person_id,linkedin_url)
VALUES (99507,${intakeSearchId},'coresignal','fictional-separate-race','Fictional Separate Race','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','Possible duplicate','99507001','https://www.linkedin.com/in/fictional-separate-race/'),
(99508,${intakeSearchId},'coresignal','fictional-separate-rollback','Fictional Separate Rollback','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','Possible duplicate','99508001','https://www.linkedin.com/in/fictional-separate-rollback/');
`
// Approved 2026-11-15 Discovery review actions (link_existing, approve, apply_updates) and
// Enrichment apply_refresh on PostgreSQL. All records are fictional.
const reviewActionsFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email,linkedin_url)
VALUES (99520,'step3c:link-target','Fictional Link Target','FL',2020,2020,'PGP','Fictional Link Co','Manager','Finance','Manager','Mumbai','VERIFIED','fictional.link@example.test','https://www.linkedin.com/in/fictional-link-race/'),
(99521,'step3c:refresh-target','Fictional Refresh Target','FR',2019,2019,'PGP','Fictional Old Co','Analyst','Finance','Analyst/Junior','Delhi','VERIFIED','fictional.refresh@example.test','');
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status,provider_person_id,linkedin_url)
VALUES (99511,${intakeSearchId},'coresignal','fictional-approve-race','Fictional Approve Race','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99511001','https://www.linkedin.com/in/fictional-approve-race/'),
(99512,${intakeSearchId},'coresignal','fictional-link-race','Fictional Link Target','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','Possible duplicate','99512001','https://www.linkedin.com/in/fictional-link-race/');
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status) VALUES (99530,'coresignal',99521,'Fictional Refresh Target','Profile Refresh','mock','success');
INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,proposed_changes_json,status,requested_by)
VALUES (99531,99530,99521,'[{"field":"company","oldValue":"Fictional Old Co","newValue":"Fictional New Co"},{"field":"location","oldValue":"Delhi","newValue":"Pune"}]','Pending review','Fictional Requester'),
(99532,99530,99521,'[{"field":"title","oldValue":"Stale Title","newValue":"Fictional Director"}]','Pending review','Fictional Requester');
`
const urlEvidenceBody = (resultId, url) => {
  const body = evidenceBody(resultId)
  body.observation.sourceUrl = url
  body.observation.profileUrl = url
  return body
}
const separateEvidenceBody = (resultId, suffix) => {
  const body = evidenceBody(resultId)
  const url = `https://www.linkedin.com/in/fictional-separate-${suffix}/`
  body.observation.sourceUrl = url
  body.observation.profileUrl = url
  return body
}
const evidenceBody = (resultId, decision = "MATCH", reason = "Fictional public source independently supports the observed profile.") => ({
  action: "record_evidence", resultId,
  observation: { sourceType: "LINKEDIN_PROFILE", sourceUrl: `https://www.linkedin.com/in/fictional-evidence-${resultId === 99501 ? "one" : resultId === 99502 ? "race" : "rollback"}/`, profileUrl: `https://www.linkedin.com/in/fictional-evidence-${resultId === 99501 ? "one" : resultId === 99502 ? "race" : "rollback"}/`, observedInstitution: "IIM Lucknow", educationEndYear: 2020, graduationYear: 2020, programme: "PGP", verificationReason: reason },
  decisions: { identity: decision, institution: "MATCH", alumniStatus: "MATCH", programme: "MATCH" },
})
let postgresDiscoveryEvidenceSnapshot
let postgresDiscoveryIgnoreSnapshot
let postgresKeepSeparateSnapshot
let postgresSearchSnapshot
let postgresDiscoveryEvidenceInvalidSnapshot
let postgresDiscoveryPlanSnapshot
let postgresSearchPreflightSnapshot
let postgresOutreachSnapshot
let postgresOpportunityMutationSnapshot
let postgresEnrichmentLimitSnapshot
let postgresEnrichmentActionSnapshot
let postgresCollectReviewSnapshot
let postgresAdminValidationSnapshot
let postgresBrightTrialSnapshot
let postgresCollectMockExecutionSnapshot
const opportunityFixtureSql = `
INSERT INTO corporate_opportunities(id,opportunity_key,company,owner_user_id,title,description,stage,next_action,follow_up_date,created_by_user_id,last_updated_by_user_id)
VALUES (99100,'fictional-opportunity-read','Fictional Opportunity Co',1,'Fictional Placement Discussion','Fixture only','IDENTIFIED','Follow up','2030-01-01',1,1);
INSERT INTO corporate_opportunity_history(id,opportunity_id,actor_user_id,action,from_stage,to_stage,summary)
VALUES (99101,99100,1,'created','','IDENTIFIED','Fictional creation history');
`
const engagementFixtureSql = alumnusId => `INSERT INTO engagement_events(id,event_key,alumnus_id,company,event_type,event_title,source,event_date,assigned_to)
VALUES (99200,'fictional-workspace-event',${alumnusId},'Example Co','Manual Relationship','Fictional committee follow-up','Fixture','2026-10-28','Local Development PCOM');`
const engagementLocalFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status)
VALUES (99230,'fictional-engagement-local','Fictional Engagement Member','FE',2020,2020,'PGP','Fictional Engagement Co','Manager','Strategy','Manager','Mumbai','VERIFIED');
INSERT INTO birthday_data(id,alumnus_id,birth_month_day,source,status)
VALUES (99231,99230,'10-28','Fixture','Confirmed internally');
INSERT INTO engagement_events(id,event_key,alumnus_id,company,event_type,event_title,source,event_date,status) VALUES
${Array.from({ length: 14 }, (_, index) => `(${99210 + index},'fictional-engagement-local-${index}',99230,'Fictional Engagement Co','${index === 11 ? "Birthday" : "Manual Relationship"}','Fictional engagement action ${index}','Fixture','2026-10-28','New')`).join(",\n")};
`
const engagementBulkPreviewFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email) VALUES
(99240,'fictional-bulk-ready','Fictional Preview Ready','FR',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','ready@example.test'),
(99241,'fictional-bulk-provisional','Fictional Preview Provisional','FP',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','PROVISIONAL','provisional@example.test'),
(99242,'fictional-bulk-no-email','Fictional Preview Missing','FM',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED',''),
(99247,'fictional-manual-new','Fictional Manual New','FN',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','manual@example.test'),
(99248,'fictional-manual-race','Fictional Manual Race','FC',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','race@example.test');
INSERT INTO engagement_events(id,event_key,alumnus_id,company,event_type,event_title,source,event_date,status) VALUES
(99243,'fictional-bulk-ready-event',99240,'Fictional Co','Manual Relationship','Fictional ready draft','Fixture','2026-10-28','New'),
(99244,'fictional-bulk-provisional-event',99241,'Fictional Co','Manual Relationship','Fictional provisional draft','Fixture','2026-10-28','New'),
(99245,'fictional-bulk-no-email-event',99242,'Fictional Co','Manual Relationship','Fictional missing draft','Fixture','2026-10-28','New');
INSERT INTO message_templates(id,template_key,name,event_type,subject,body,status,version)
VALUES (99246,'fictional-bulk-template','Fictional Bulk Template','Professional Signal','Hello [First Name]','Dear [Full Name], this is a fictional draft.','Approved',1);
`
const engagementSendFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email,outreach_status) VALUES
(99250,'fictional-send-single','Fictional Single Recipient','FS',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','single@example.test','Not contacted'),
(99251,'fictional-send-bulk-one','Fictional Bulk One','FO',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','bulk-one@example.test','Not contacted'),
(99252,'fictional-send-bulk-two','Fictional Bulk Two','FT',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','bulk-two@example.test','Not contacted');
INSERT INTO engagement_events(id,event_key,alumnus_id,company,event_type,event_title,source,event_date,status) VALUES
(99253,'fictional-send-single-event',99250,'Fictional Co','Manual Relationship','Fictional single send','Fixture','2026-10-28','New'),
(99254,'fictional-send-bulk-one-event',99251,'Fictional Co','Manual Relationship','Fictional bulk send one','Fixture','2026-10-28','New'),
(99255,'fictional-send-bulk-two-event',99252,'Fictional Co','Manual Relationship','Fictional bulk send two','Fixture','2026-10-28','New'),
(99256,'fictional-send-concurrent-event',99252,'Fictional Co','Manual Relationship','Fictional concurrent send','Fixture','2026-10-28','New'),
(99257,'fictional-send-ambiguous-event',99252,'Fictional Co','Manual Relationship','Fictional ambiguous send','Fixture','2026-10-28','New'),
(99258,'fictional-send-invalid-draft-event',99252,'Fictional Co','Manual Relationship','Fictional invalid draft','Fixture','2026-10-28','New'),
(99260,'fictional-send-interrupted-event',99252,'Fictional Co','Manual Relationship','Fictional interrupted send','Fixture','2026-10-28','New');
INSERT INTO message_templates(id,template_key,name,event_type,subject,body,status,version)
VALUES (99259,'fictional-invalid-draft-template','Fictional Invalid Draft','Professional Signal','Fictional subject','  ','Approved',1);
INSERT INTO engagement_actions(action_key,event_id,alumnus_id,action_type,channel,performed_by,template_id,template_version,delivery_status)
VALUES ('mail:99252:fictional-send-interrupted-event:fictional-bulk-template:v1',99260,99252,'Congratulations Email','Email','Fictional prior worker',99246,1,'Sending');
`
const lushaRejectionFixtureSql = `
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status,result_count)
VALUES (99270,'lusha',99240,'Fictional Preview Ready','Contact Search Preview','live','review_required',1),
(99271,'lusha',99240,'Fictional Preview Ready','Email Reveal','live','review_required',1);
INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,proposed_changes_json,status,requested_by)
VALUES (99272,99270,99240,${q(JSON.stringify({ kind: "LUSHA_CONTACT_IDENTITY", version: 1, contactId: "fictional-lusha-id", requestedProfileUrl: "https://www.linkedin.com/in/fictional-ready/", returnedProfileUrl: "https://www.linkedin.com/in/fictional-ready/", returnedName: "Fictional Preview Ready", returnedCompany: "Fictional Co", returnedTitle: "Manager", identityReason: "PROFILE_URL_MATCH", providerStatus: "success", returnedCount: 1, alumnusRecordVersion: 1, emailAvailable: true, phoneAvailable: false, providerReportedCredits: null }))},'Pending identity review','Fixture'),
(99273,99271,99240,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-lusha-id", value: "fictional@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
(99274,99271,99240,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-lusha-id", value: "second@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
(99275,99271,99240,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-lusha-id", value: "third@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture');
`
const lushaContactApprovalFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email,lusha_person_id,linkedin_url) VALUES
(99280,'fictional-contact-approval-one','Fictional Contact One','F1',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','','fictional-contact-one','https://www.linkedin.com/in/fictional-contact-one/'),
(99281,'fictional-contact-approval-race','Fictional Contact Race','F2',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','','fictional-contact-race','https://www.linkedin.com/in/fictional-contact-race/'),
(99282,'fictional-contact-approval-replace','Fictional Contact Replace','F3',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','old@example.test','fictional-contact-replace','https://www.linkedin.com/in/fictional-contact-replace/'),
(99283,'fictional-contact-approval-privacy','Fictional Contact Privacy','F4',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','','fictional-contact-privacy','https://www.linkedin.com/in/fictional-contact-privacy/');
INSERT INTO alumni_privacy_controls(alumnus_id,general_contact_status) VALUES (99283,'Do not contact');
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status,application_units,provider_reported_credits)
VALUES (99284,'lusha',99280,'Fictional Contact One','Email Reveal','live','review_required',1,1),
(99285,'lusha',99281,'Fictional Contact Race','Email Reveal','live','review_required',1,1),
(99286,'lusha',99282,'Fictional Contact Replace','Email Reveal','live','review_required',1,1),
(99287,'lusha',99283,'Fictional Contact Privacy','Email Reveal','live','review_required',1,1);
INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES
(99288,99284,99280,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-contact-one", value: "one@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
(99289,99285,99281,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-contact-race", value: "race-contact@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
(99290,99286,99282,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-contact-replace", value: "replaced@example.test", previousValue: "old@example.test", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
(99291,99287,99283,${q(JSON.stringify({ kind: "LUSHA_CONTACT_FIELD", version: 1, channel: "email", contactId: "fictional-contact-privacy", value: "privacy@example.test", previousValue: "", alumnusRecordVersion: 1 }))},'Pending contact review','Fixture'),
${[99280,99281,99282,99283].map((id,index) => `(${99292+index},${99284+index},${id},${q(JSON.stringify({ kind: "LUSHA_CONTACT_IDENTITY", version: 1, contactId: ["fictional-contact-one","fictional-contact-race","fictional-contact-replace","fictional-contact-privacy"][index], requestedProfileUrl: "https://www.linkedin.com/in/fictional-contact/", returnedProfileUrl: "https://www.linkedin.com/in/fictional-contact/", returnedName: "Fictional", returnedCompany: "Fictional Co", returnedTitle: "Manager", identityReason: "PROFILE_URL_MATCH", providerStatus: "success", returnedCount: 1, alumnusRecordVersion: 1, emailAvailable: true, phoneAvailable: false, providerReportedCredits: 1 }))},'Approved identity','Fixture')`).join(",\n")};
`
const lushaIdentityApprovalFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,linkedin_url,record_version) VALUES
(99310,'fictional-identity-one','Fictional Identity One','I1',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','https://www.linkedin.com/in/fictional-identity-one/',1),
(99311,'fictional-identity-race','Fictional Identity Race','I2',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','https://www.linkedin.com/in/fictional-identity-race/',1),
(99312,'fictional-identity-shared','Fictional Identity Shared','I3',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','https://www.linkedin.com/in/fictional-identity-shared/',1),
(99313,'fictional-identity-other','Fictional Identity Other','I4',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','https://www.linkedin.com/in/fictional-identity-shared/',1),
(99314,'fictional-identity-stale','Fictional Identity Stale','I5',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','https://www.linkedin.com/in/fictional-identity-stale/',2);
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status,result_count,response_summary,application_units,provider_reported_credits)
VALUES (99320,'lusha',99310,'Fictional Identity One','Contact Search Preview','live','review_required',1,'Fictional retained observation',2,1),
(99321,'lusha',99311,'Fictional Identity Race','Contact Search Preview','live','review_required',1,'Fictional retained observation',2,1),
(99322,'lusha',99312,'Fictional Identity Shared','Contact Search Preview','live','review_required',1,'Fictional retained observation',2,1),
(99323,'lusha',99314,'Fictional Identity Stale','Contact Search Preview','live','review_required',1,'Fictional retained observation',2,1);
INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,proposed_changes_json,status,requested_by) VALUES
${[[99330,99320,99310,"one",1],[99331,99321,99311,"race",1],[99332,99322,99312,"shared",1],[99333,99323,99314,"stale",1]].map(([reviewId,historyId,alumnusId,key,version]) => {
  const url = `https://www.linkedin.com/in/fictional-identity-${key}/`
  return `(${reviewId},${historyId},${alumnusId},${q(JSON.stringify({ kind: "LUSHA_CONTACT_IDENTITY", version: 1, contactId: `fictional-lusha-identity-${key}`, requestedProfileUrl: url, returnedProfileUrl: url, returnedName: `Fictional Identity ${key}`, returnedCompany: "Fictional Co", returnedTitle: "Manager", identityReason: "PROFILE_URL_MATCH", providerStatus: "success", returnedCount: 1, alumnusRecordVersion: version, emailAvailable: true, phoneAvailable: false, providerReportedCredits: 1 }))},'Pending identity review','Fixture')`
}).join(",\n")};
`
const anonymizeFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,email,phone,linkedin_url) VALUES
(99180,'fictional-anonymize','Fictional Anonymize','FA',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','private@example.test','+10000000000','https://www.linkedin.com/in/fictional-anonymize/'),
(99181,'fictional-pending-anonymize','Fictional Pending Review','FP',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','pending@example.test','+10000000001',''),
(99182,'fictional-rollback-anonymize','Fictional Rollback','FR',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','rollback@example.test','+10000000002','');
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status)
VALUES (99183,'coresignal',99181,'Fictional Pending Review','Fictional fixture','mock','success');
INSERT INTO provider_refresh_reviews(id,provider_response_id,alumnus_id,status,requested_by)
VALUES (99184,99183,99181,'Pending review','Fixture');
`
const brightFixtureSql = `
INSERT INTO provider_collection_attempts(id,provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,dataset_id,status,evidence_json)
VALUES (99300,'brightdata','fictional-read',1,'https://www.linkedin.com/in/fictional-bright-read/','fictional-bright-fingerprint','fictional-bright-read-key','fictional-dataset','EVIDENCE_STORED','{}');
INSERT INTO brightdata_snapshot_evidence(attempt_id,snapshot_id,dataset_id,requested_url,returned_url,canonical_returned_url,identity_url_status,requested_at,retrieved_at,normalizer_version,raw_json,raw_sha256,normalized_json,retention_until)
VALUES (99300,'fictional-bright-snapshot','fictional-dataset','https://www.linkedin.com/in/fictional-bright-read/','https://www.linkedin.com/in/fictional-bright-read/','https://www.linkedin.com/in/fictional-bright-read/','MATCH','2026-10-28T00:00:00.000Z','2026-10-28T00:00:01.000Z',1,'{}','fictional-sha256','{}','2030-01-01T00:00:00.000Z');
`
const brightPurgeFixtureSql = `
INSERT INTO provider_collection_attempts(id,provider,operation,actor_user_id,target_reference,target_fingerprint,request_key,dataset_id,status,evidence_json)
VALUES (99301,'brightdata','fictional-expired-evidence',1,'https://www.linkedin.com/in/fictional-expired/','fictional-expired-fingerprint','fictional-expired-key','fictional-dataset','EVIDENCE_STORED','{}');
INSERT INTO brightdata_snapshot_evidence(attempt_id,snapshot_id,dataset_id,requested_url,returned_url,canonical_returned_url,identity_url_status,requested_at,retrieved_at,normalizer_version,raw_json,raw_sha256,normalized_json,retention_until)
VALUES (99301,'fictional-expired-snapshot','fictional-dataset','https://www.linkedin.com/in/fictional-expired/','https://www.linkedin.com/in/fictional-expired/','https://www.linkedin.com/in/fictional-expired/','MATCH','2026-10-28T00:00:00.000Z','2026-10-28T00:00:01.000Z',1,'{}','fictional-expired-sha256','{}','2000-01-01T00:00:00.000Z');
`
const webhookOverviewFixtureSql = alumnusId => `
INSERT INTO coresignal_webhook_subscriptions(id,name,cohort_type,selection_json,selection_version,membership_json,status,created_by,activated_at,expires_at)
VALUES (99400,'Fictional inactive monitoring','FIXED_IDS','[${alumnusId}]','fixed-cn-ids-v1','[{"alumnusId":${alumnusId},"employeeId":"994001"}]','ACTIVE','Fixture','2026-10-28T00:00:00.000Z','2099-01-01T00:00:00.000Z');
INSERT INTO coresignal_webhook_coverage(id,subscription_id,alumnus_id,employee_id,status)
VALUES (99401,99400,${alumnusId},'994001','ACTIVE');
INSERT INTO coresignal_webhook_events(id,subscription_id,alumnus_id,employee_id,change_type,payload_digest,dedupe_window,status)
VALUES (99402,99400,${alumnusId},'994001','changed','fictional-digest','fictional-window','AWAITING_PROFILE_COLLECTION');
`
const webhookSetupFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,profile_match,coresignal_employee_id,confidence)
VALUES (99410,'fictional-webhook-setup','Fictional Monitoring Member','FM',2020,2020,'PGP','Fictional Monitoring Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99410001',70);
`
const webhookReceiverFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,profile_match,coresignal_employee_id)
VALUES (99470,'fictional-webhook-receiver','Fictional Webhook Member','FW',2020,2020,'PGP','Fictional Receiver Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99470001');
INSERT INTO coresignal_webhook_identities(id,alumnus_id,employee_id,evidence_reference,verified_by)
VALUES (99471,99470,'99470001','Fictional exact employee ID attestation','Fixture Admin');
INSERT INTO coresignal_webhook_subscriptions(id,name,cohort_type,selection_json,selection_version,membership_json,provider_subscription_id,status,created_by,expires_at)
VALUES (99460,'Fictional receiver plan','FIXED_IDS','[99470]','fixed-cn-ids-v1','[]','fictional-receiver-subscription','ACTIVE','Fixture Admin','2099-01-01T00:00:00.000Z');
INSERT INTO coresignal_webhook_coverage(id,subscription_id,alumnus_id,employee_id,status)
VALUES (99461,99460,99470,'99470001','ACTIVE');
`
const webhookLifecycleActivatedAt = new Date(Date.now() - 30 * 86_400_000).toISOString()
const webhookLifecycleExpiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
const webhookLifecycleFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status)
VALUES (99482,'fictional-webhook-lifecycle','Fictional Lifecycle Member','FL',2020,2020,'PGP','Fictional Lifecycle Co','Manager','Strategy','Manager','Mumbai','VERIFIED');
INSERT INTO coresignal_webhook_subscriptions(id,name,cohort_type,selection_json,selection_version,membership_json,provider_subscription_id,status,created_by,activated_at,expires_at) VALUES
(99480,'Fictional renewal','FIXED_IDS','[99482]','fixed-cn-ids-v1','[]','fictional-renewal','ACTIVE','Fixture Admin',${q(webhookLifecycleActivatedAt)},${q(webhookLifecycleExpiresAt)}),
(99481,'Fictional stop','FIXED_IDS','[99482]','fixed-cn-ids-v1','[]','fictional-stop','ACTIVE','Fixture Admin',${q(webhookLifecycleActivatedAt)},${q(webhookLifecycleExpiresAt)}),
(99484,'Fictional concurrent stop','FIXED_IDS','[99482]','fixed-cn-ids-v1','[]','fictional-concurrent-stop','ACTIVE','Fixture Admin',${q(webhookLifecycleActivatedAt)},${q(webhookLifecycleExpiresAt)}),
(99485,'Fictional rollback stop','FIXED_IDS','[99482]','fixed-cn-ids-v1','[]','fictional-rollback-stop','ACTIVE','Fixture Admin',${q(webhookLifecycleActivatedAt)},${q(webhookLifecycleExpiresAt)});
INSERT INTO coresignal_webhook_coverage(id,subscription_id,alumnus_id,employee_id,status)
VALUES (99483,99481,99482,'99482001','ACTIVE');
`
const webhookSimulationFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,profile_match,coresignal_employee_id)
VALUES (99490,'fictional-webhook-simulation','Fictional Simulation Member','FS',2020,2020,'PGP','Fictional Simulation Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99490001');
INSERT INTO coresignal_webhook_identities(id,alumnus_id,employee_id,evidence_reference,verified_by)
VALUES (99493,99490,'99490001','Fictional simulation mapping','Fixture Admin');
INSERT INTO coresignal_webhook_subscriptions(id,name,cohort_type,selection_json,selection_version,membership_json,provider_subscription_id,status,created_by,expires_at)
VALUES (99491,'Fictional simulation plan','FIXED_IDS','[99490]','fixed-cn-ids-v1','[]','fictional-simulation-subscription','ACTIVE','Fixture Admin','2099-01-01T00:00:00.000Z');
INSERT INTO coresignal_webhook_coverage(id,subscription_id,alumnus_id,employee_id,status)
VALUES (99492,99491,99490,'99490001','ACTIVE');
`
const webhookActivationFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,intake_status,profile_match,coresignal_employee_id) VALUES
(99680,'fictional-activation-one','Fictional Activation One','A1',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99680001'),
(99681,'fictional-activation-race','Fictional Activation Race','AR',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99681001'),
(99682,'fictional-activation-rollback','Fictional Activation Rollback','AF',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','VERIFIED','Confirmed','99682001');
INSERT INTO coresignal_webhook_identities(id,alumnus_id,employee_id,evidence_reference,verified_by) VALUES
(99683,99680,'99680001','Fictional exact mapping','Fixture Admin'),
(99684,99681,'99681001','Fictional exact mapping','Fixture Admin'),
(99685,99682,'99682001','Fictional exact mapping','Fixture Admin');
INSERT INTO coresignal_webhook_subscriptions(id,name,cohort_type,selection_json,selection_version,membership_json,status,created_by) VALUES
(99686,'Fictional activation one','FIXED_IDS','[99680]','fixed-cn-ids-v1','[{"alumnusId":99680,"employeeId":"99680001"}]','DRAFT','Fixture Admin'),
(99687,'Fictional activation race','FIXED_IDS','[99681]','fixed-cn-ids-v1','[{"alumnusId":99681,"employeeId":"99681001"}]','DRAFT','Fixture Admin'),
(99688,'Fictional activation rollback','FIXED_IDS','[99682]','fixed-cn-ids-v1','[{"alumnusId":99682,"employeeId":"99682001"}]','DRAFT','Fixture Admin');
`
const alumniHistoryFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,source,created_at)
VALUES (99420,'fictional-saved-history','Fictional History Member','FH',2020,2020,'PGP','Fictional History Co','Manager','Strategy','Manager','Mumbai','Fictional import','2026-10-28 00:00:00');
INSERT INTO alumni_source_observations(id,alumnus_id,mutation_request_key,source_row_key,filename,source_system,observed_json,imported_by,created_at)
VALUES (99421,99420,'fictional-history-request','row-1','fictional-history.csv','fixture','{"company":"Fictional History Co","email":"private@example.test"}','Fixture','2026-10-28T00:02:30.000Z');
INSERT INTO provider_response_history(id,provider,alumnus_id,alumnus_name,operation,mode,status,response_summary,created_at)
VALUES (99422,'lusha',99420,'Fictional History Member','Fictional observation','mock','success','Fictional request without retained contact evidence','2026-10-28 00:03:00');
INSERT INTO coresignal_webhook_events(id,subscription_id,alumnus_id,employee_id,change_type,payload_digest,dedupe_window,status,received_at)
VALUES (99423,99400,99420,'99420001','changed','fictional-history-digest','fictional-history-window','REVIEW_REQUIRED','2026-10-28T00:04:00.000Z');
INSERT INTO field_change_history(id,alumnus_id,field,old_value,new_value,source,initiated_by,created_at) VALUES
${Array.from({ length: 22 }, (_, index) => `(${99430 + index},99420,'note','','Fictional history change ${index + 1}','Fixture','Fixture',${q(`2026-10-28 ${String(Math.floor(index / 10)).padStart(2, "0")}:${String(index % 10).padStart(2, "0")}:00`)})`).join(",\n")};
INSERT INTO field_change_history(id,alumnus_id,field,old_value,new_value,source,initiated_by,created_at)
VALUES (99452,99420,'note','','Fictional malformed timestamp','Fixture','Fixture','invalid');
`
const outreachFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,graduation_year,programme,company,title,"function",seniority,location,email,email_verification,intake_status,outreach_status,iiml_relationship,confidence,profile_match) VALUES
(99600,'fictional-outreach-warm','Fictional Warm Target','FW',2020,2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','warm@example.test','Verified','VERIFIED','Contacted','Unknown / Not assessed',80,'Confirmed'),
(99601,'fictional-outreach-intermediary','Fictional Intermediary','FI',2018,2018,'PGP','Fictional Co','Director','Strategy','Director','Mumbai','','Unverified','VERIFIED','Responded','Strong',80,'Confirmed'),
(99602,'fictional-outreach-direct','Fictional Direct Target','FD',2021,2021,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','direct@example.test','Verified','VERIFIED','Not contacted','Unknown / Not assessed',80,'Confirmed'),
(99603,'fictional-outreach-none','Fictional No Route','FN',2022,2022,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','','Unverified','VERIFIED','Not contacted','Unknown / Not assessed',40,'Unverified'),
(99604,'fictional-outreach-provisional','Fictional Provisional','FP',2023,2023,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','','Unverified','PROVISIONAL','Not contacted','Unknown / Not assessed',40,'Unverified');
INSERT INTO alumni_relationships(intermediary_alumnus_id,target_alumnus_id,relationship_type,evidence,confirmed,successful_introductions)
VALUES (99601,99600,'Confirmed committee relationship','Fictional recorded introduction',true,2);
`
const collectCandidateFixtureSql = `
INSERT INTO external_discovery_searches(id,provider,filters_json,criteria_summary,mode,initiated_by)
VALUES (99700,'coresignal','{"company":"Fictional Collect Co","graduationYear":"2020"}','Fictional retained Preview','live','Fixture');
INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,"function",seniority,location,match_status,provider_person_id,review_note)
VALUES (99701,99700,'coresignal','fictional-collect-eligible','Fictional Eligible','Unknown','Fictional Collect Co','Analyst','Other','Unknown/Unclassified','Unknown','New','99701001','REVIEW_BEFORE_COLLECT: fictional retained Preview'),
(99702,99700,'coresignal','fictional-collect-ineligible','Fictional Excluded','Unknown','Fictional Collect Co','Analyst','Other','Unknown/Unclassified','Unknown','New','99701002','INELIGIBLE: conflicting retained evidence');
INSERT INTO provider_response_history(id,provider,alumnus_name,search_id,operation,mode,status,request_summary,created_at)
VALUES (99703,'coresignal','Fictional Account',99700,'Exact-year ES-DSL Preview','live','success','Fictional retained Preview',${q(creditBoundary)}),
(99704,'coresignal','Fictional Account',99700,'Base Employee Collect-only','live','ambiguous','Retained Search Collect-only · Employee ID 99701001',${q(creditBoundary)});
`
const collectKnownFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,programme,company,title,"function",seniority,location,coresignal_employee_id,created_at)
VALUES (99910,'fictional-known-collect','Fictional Known Collect','FK',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99910001',${q(creditBoundary)}),
(99911,'fictional-known-collect-audit','Fictional Known Collect Audit','FA',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99911001',${q(creditBoundary)}),
(99912,'fictional-known-collect-race','Fictional Known Collect Race','FR',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99912001',${q(creditBoundary)}),
(99913,'fictional-known-collect-ambiguous','Fictional Known Collect Ambiguous','FU',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99913001',${q(creditBoundary)}),
(99914,'fictional-known-collect-release','Fictional Known Collect Release','FL',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99914001',${q(creditBoundary)}),
(99915,'fictional-known-collect-claim-failure','Fictional Known Collect Claim Failure','FF',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99915001',${q(creditBoundary)}),
(99916,'fictional-known-collect-budget','Fictional Known Collect Budget','FB',2020,'PGP','Fictional Collect Co','Manager','Strategy','Manager','Mumbai','99916001',${q(creditBoundary)});
`
const workspacePartialFailureBody = { action: "import", filename: "workspace-partial-failure.csv", records: [
  { profileKey: "fictional-workspace-partial-first", name: "Fictional Partial First", batch: 2024, company: "Fictional Partial Co", email: "fictional-partial-collision@example.test" },
  { profileKey: "fictional-workspace-partial-second", name: "Fictional Partial Second", batch: 2024, company: "Fictional Partial Co", email: "fictional-partial-collision@example.test" },
] }
const enrichmentReconciliationFixtureSql = `
INSERT INTO provider_response_history(id,provider,alumnus_name,operation,mode,status,credits_used,application_units,provider_reported_credits,usage_state,request_summary,created_at)
VALUES (99800,'lusha','Fictional Account','Fictional Contact Search','live','success',0,0,NULL,'reconciliation_required','Fictional account usage',${q(creditBoundary)}),
(99801,'lusha','Fictional Account','Fictional Concurrent Search','live','success',0,0,NULL,'reconciliation_required','Fictional concurrent account usage',${q(creditBoundary)}),
(99802,'lusha','Fictional Account','Fictional Audit Failure Search','live','success',0,0,NULL,'reconciliation_required','Fictional audit failure account usage',${q(creditBoundary)});
`
const userCorrectionFixtureSql = `
INSERT INTO application_users(id,display_name,email,role,enabled)
VALUES (99850,'Fictional Member','fictional.membet2020@iiml.ac.in','PCOM',false),
(99851,'Fictional Member','fictional.member2020@iiml.ac.in','PCOM',true),
(99852,'Fictional Member','fictional.membet2021@iiml.ac.in','PCOM',false),
(99854,'Fictional Member','fictional.member2021@iiml.ac.in','PCOM',true),
(99855,'Fictional Member','fictional.membet2022@iiml.ac.in','PCOM',true),
(99856,'Fictional Member','fictional.member2022@iiml.ac.in','PCOM',true);
`
const collectReviewEvidence = {
  schemaVersion: 1, reviewState: "REVIEW_REQUIRED", targetEmployeeId: "999001", returnedEmployeeId: "999001",
  identity: { professionalProfileUrl: "https://www.linkedin.com/in/fictional-collect-review/" },
  providerActions: { collectRequests: 1, searchRequests: 0, canonicalMutations: 0, identityAttachments: 0 },
}
const collectReviewFixtureSql = `
INSERT INTO alumni(id,profile_key,name,initials,batch,programme,company,title,"function",seniority,location,linkedin_url,intake_status,profile_match)
VALUES (99900,'fictional-collect-review','Fictional Collect Reviewer','FC',2020,'PGP','Fictional Co','Manager','Strategy','Manager','Mumbai','https://www.linkedin.com/in/fictional-collect-review/','VERIFIED','Confirmed');
INSERT INTO provider_response_history(id,provider,alumnus_name,operation,mode,status,response_summary)
VALUES (99901,'coresignal','Fictional Collect Reviewer','Base Employee Collect-only','mock','success',${q(`Fictional review.\n\n[coresignal-collect-evidence:v1]\n${JSON.stringify(collectReviewEvidence)}`)});
`
const creditFixtureSql = `
INSERT INTO provider_settings(provider,monthly_credit_limit) VALUES ('coresignal',50),('lusha',20) ON CONFLICT(provider) DO UPDATE SET monthly_credit_limit=excluded.monthly_credit_limit;
INSERT INTO provider_response_history(provider,alumnus_name,operation,mode,status,application_units,credits_used,usage_state,created_at) VALUES
${creditRows.map(([provider, operation, mode, status, units, credits, usageState, createdAt]) => `(${[provider, "Fictional Account", operation, mode, status].map(q).join(",")},${units},${credits},${q(usageState)},${q(createdAt)})`).join(",\n")};
INSERT INTO security_audit_events(actor_user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES
${creditAuditRows.map(observation => `(1,'provider_credit_balance_observed','provider_balance',${q(observation.provider)},${q(JSON.stringify(observation))},${q(creditObserved)})`).join(",\n")};
`
let postgresCreditSnapshot
let postgresCreditAttestSnapshot
let postgresCollectOverviewSnapshot
let postgresCollectCandidateSnapshot
let postgresCollectSelectionSnapshot
let postgresCollectSingleSnapshot
let postgresWebhookPreviewSnapshot
let postgresWebhookReviewSnapshot
let postgresWebhookSetupSnapshot
let postgresAlumniHistorySnapshot
let postgresEngagementLocalSnapshot
let postgresEngagementBulkPreviewSnapshot
let postgresEngagementSendSnapshot
let postgresLushaRejectionSnapshot
let postgresLushaContactApprovalSnapshot
let postgresLushaIdentityApprovalSnapshot
let postgresEngagementPreviewSnapshot
let postgresManualEmailSnapshot
let postgresAnonymizeSnapshot
let postgresWebhookReceiverSnapshot
let postgresWebhookLifecycleSnapshot
let postgresWebhookSimulationSnapshot
let postgresWebhookActivationSnapshot
let postgresBrightPreflightSnapshot
let postgresBrightPurgeSnapshot
let postgresAdminLocalSnapshot
let postgresImportPreviewSnapshot
let postgresImportExecuteSnapshot
let postgresWorkspaceImportSnapshot
let postgresBrightMissingSnapshot
let postgresProfessionalVerificationSnapshot
let postgresIntakePreflightSnapshot
let postgresIntelligenceMissingSnapshot
let postgresEnrichmentUsageSnapshot
const command = (name, args) => name === "pg_ctl" ? pgCtl(args) : run(pgExecutable(name), args, { maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } })

async function portAvailable(port) {
  const probe = createTcpServer()
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve) })
  await new Promise(resolve => probe.close(resolve))
}

async function http(path, { cookie, body, method = "GET", origin = base, key, timeoutMs, extraHeaders = {} } = {}) {
  const startedAt = Date.now()
  let status = "transport_error"
  try {
    const response = await fetch(`${origin}${path}`, { method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}), ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) })
    status = response.status
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { json = null }
    return { status: response.status, body: json, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "", replayed: response.headers.get("idempotency-replayed") }
  } finally {
    const durationMs = Date.now() - startedAt
    if (durationMs >= 10_000) console.error("CN_HTTP_SLOW", JSON.stringify({ method, path: path.split("?", 1)[0].replace(/\/api\/webhooks\/coresignal\/[^/]+\/[^/]+/, "/api/webhooks/coresignal/[subscriptionId]/[token]"), backend: origin === base ? "postgres" : "d1", status, durationMs }))
  }
}

async function exportHttp(origin, cookie, body) {
  const response = await fetch(`${origin}/api/exports`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  return { status: response.status, type: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), body: await response.text() }
}

async function exportArchive(origin, cookie, body) {
  const response = await fetch(`${origin}/api/exports`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  return { status: response.status, type: response.headers.get("content-type"), files: response.ok ? unzipSync(new Uint8Array(await response.arrayBuffer())) : {} }
}

async function adminLocalContract(origin, adminCookie, pcomCookie, alumnusId) {
  const post = (cookie, body) => http("/api/admin", { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, { action: "authorize_user", email: "fictional.member@iiml.ac.in", role: "PCOM" })).status, 401)
  assert.equal((await post(pcomCookie, { action: "authorize_user", email: "fictional.member@iiml.ac.in", role: "PCOM" })).status, 403)
  assert.equal((await post(adminCookie, { action: "authorize_user", email: "invalid", role: "PCOM" })).status, 400)
  assert.equal((await post(adminCookie, { action: "authorize_user", email: "fictional.member@example.test", role: "PCOM" })).status, 400)
  const created = await post(adminCookie, { action: "authorize_user", email: "fictional.member@iiml.ac.in", displayName: "Fictional Member", role: "PCOM" })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.user.role, "PCOM")
  const userId = created.body.user.id
  assert.equal((await post(adminCookie, { action: "change_role", userId, role: "ADMIN" })).status, 409)
  const promoted = await post(adminCookie, { action: "change_role", userId, role: "ADMIN", confirmation: `GRANT ADMIN ${userId}` })
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body))
  assert.equal(promoted.body.user.role, "ADMIN")
  assert.equal((await post(adminCookie, { action: "set_user_status", userId, enabled: false })).status, 409)
  const disabled = await post(adminCookie, { action: "set_user_status", userId, enabled: false, confirmation: `DISABLE USER ${userId}` })
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body))
  assert.equal(disabled.body.user.enabled, false)
  assert.equal((await post(adminCookie, { action: "set_user_status", userId: 1, enabled: false, confirmation: "DISABLE USER 1" })).status, 409)
  assert.equal((await post(adminCookie, { action: "update_lifecycle", alumnusId, status: "Unsupported" })).status, 400)
  assert.equal((await post(adminCookie, { action: "update_lifecycle", alumnusId, status: "Archived" })).status, 409)
  const lifecycle = await post(adminCookie, { action: "update_lifecycle", alumnusId, status: "Archived", confirmation: `ARCHIVE ${alumnusId}` })
  assert.equal(lifecycle.status, 200, JSON.stringify(lifecycle.body))
  assert.equal(lifecycle.body.lifecycle.status, "Archived")
  const mappingInput = { action: "upsert_provider_company_mapping", displayName: "Fictional Mapping Co", provider: "coresignal", status: "UNVERIFIED", mappingSource: "Fixture" }
  const mapping = await post(adminCookie, mappingInput)
  assert.equal(mapping.status, 201, JSON.stringify(mapping.body))
  assert.equal(mapping.body.mapping.status, "UNVERIFIED")
  const verified = await post(adminCookie, { ...mappingInput, mappingId: mapping.body.mapping.id, status: "VERIFIED", providerCompanyId: "12345", aliases: ["Fictional Mapping Alias"] })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.mapping.status, "VERIFIED")
  const summary = await http("/api/admin", { origin, cookie: adminCookie })
  assert.equal(summary.status, 200)
  assert.equal(summary.body.users.find(user => user.id === userId).enabled, false)
  assert.equal(summary.body.lifecycle.find(item => item.alumnusId === alumnusId).status, "Archived")
  assert.ok(summary.body.providerCompanyAliases.some(item => item.displayAlias === "Fictional Mapping Alias"))
  for (const action of ["user_authorized", "user_role_changed", "user_disabled", "data_lifecycle_changed", "provider_company_mapping_changed"]) {
    assert.ok(summary.body.audit.some(item => item.action === action), action)
  }
  return { statuses: [created.status, promoted.status, disabled.status, lifecycle.status, mapping.status, verified.status],
    user: { role: created.body.user.role, enabled: disabled.body.user.enabled }, lifecycle: lifecycle.body.lifecycle.status,
    mapping: verified.body.mapping.status }
}

async function importPreviewContract(origin, adminCookie, pcomCookie, alumnusId) {
  const record = { source_alumni_id: "BATCH1-NEW", source_system: "fictional-sheet", name: "Fictional Import Person", programme: "PGP", graduation_year: "2020", company: "", title: "Analyst" }
  const post = (cookie, body) => http("/api/imports", { origin, cookie, method: "POST", body })
  const basePayload = { action: "preview", filename: "fictional-import.csv", records: [record] }
  assert.equal((await post(undefined, basePayload)).status, 401)
  assert.equal((await post(pcomCookie, { ...basePayload, filename: "bad.txt" })).status, 400)
  assert.equal((await post(pcomCookie, { ...basePayload, records: [null] })).status, 400)
  const preview = await post(pcomCookie, basePayload)
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.equal(preview.body.rows[0].kind, "new")
  assert.equal(preview.body.rows[0].record.company, "")
  assert.equal(preview.body.counts.newRecords, 1)
  assert.equal(preview.body.providerCalls, 0)
  assert.equal(preview.body.canonicalMutations, 0)
  assert.match(preview.body.previewId, /^[a-f0-9]{64}$/)
  assert.equal((await post(adminCookie, basePayload)).status, 200)
  const invalid = await post(pcomCookie, { ...basePayload, records: [{}] })
  assert.equal(invalid.status, 200)
  assert.equal(invalid.body.rows[0].kind, "error")
  assert.equal(invalid.body.blocking, true)
  const duplicate = await post(pcomCookie, { ...basePayload, records: [record, record] })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.counts.duplicates, 1)
  const existing = await post(pcomCookie, { ...basePayload, records: [{ ...record, canonical_alumni_id: String(alumnusId) }] })
  assert.equal(existing.status, 200)
  assert.ok(["existing", "unchanged"].includes(existing.body.rows[0].kind))
  assert.equal((await post(pcomCookie, { action: "execute", filename: "fictional-import.csv", records: [record], previewId: preview.body.previewId, confirmed: true })).status, 403)
  return { status: preview.status, previewId: preview.body.previewId, counts: preview.body.counts,
    record: preview.body.rows[0].record, duplicateKind: duplicate.body.rows[1].kind, invalidKind: invalid.body.rows[0].kind }
}

async function workspaceImportContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/workspace", { origin, cookie, method: "POST", body })
  const record = { profileKey: "batch1:workspace:fixture", name: "Fictional Workspace Import", batch: 2023, programme: "PGP", company: "Original Co", title: "Analyst", email: "workspace-import@example.test" }
  const create = { action: "import", filename: "workspace.csv", records: [record] }
  assert.equal((await post(undefined, create)).status, 401)
  assert.equal((await post(pcomCookie, create)).status, 403)
  assert.equal((await post(adminCookie, { ...create, records: [] })).status, 400)
  assert.equal((await post(adminCookie, { ...create, records: [record, record] })).status, 400)
  assert.equal((await post(adminCookie, { ...create, records: [{ name: "Invalid" }] })).status, 400)
  const created = await post(adminCookie, create)
  assert.deepEqual({ status: created.status, body: created.body }, { status: 201, body: { imported: 1, updated: 0, protectedFields: 0, filename: "workspace.csv" } })
  const updateRecord = { ...record, company: "Updated Co" }
  const unapproved = await post(adminCookie, { ...create, records: [updateRecord] })
  assert.deepEqual({ status: unapproved.status, body: unapproved.body }, { status: 201, body: { imported: 0, updated: 0, protectedFields: 0, filename: "workspace.csv" } })
  const approved = await post(adminCookie, { ...create, records: [updateRecord], approvedUpdateKeys: [record.profileKey] })
  assert.deepEqual({ status: approved.status, body: approved.body }, { status: 201, body: { imported: 0, updated: 1, protectedFields: 0, filename: "workspace.csv" } })
  return [created, unapproved, approved].map(item => ({ status: item.status, body: item.body }))
}

async function opportunityMutationContract(origin, operatorCookie) {
  const path = "/api/opportunities"
  const post = (cookie, body) => http(path, { origin, cookie, method: "POST", body })
  const patch = (cookie, body) => http(path, { origin, cookie, method: "PATCH", body })
  const body = { idempotencyKey: "fictional-opportunity-write-key", company: "Fictional Opportunity Co", ownerUserId: 1,
    title: "Fictional New Discussion", description: "Fictional opportunity only", nextAction: "Review", followUpDate: "2030-02-01" }
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(operatorCookie, { ...body, idempotencyKey: "" })).status, 400)
  assert.equal((await post(operatorCookie, { ...body, ownerUserId: 99999 })).status, 409)
  const created = await post(operatorCookie, body)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.opportunity.history[0].action, "created")
  const replay = await post(operatorCookie, body)
  assert.equal(replay.status, 200, JSON.stringify(replay.body))
  assert.equal(replay.body.idempotent, true)
  assert.equal(replay.body.opportunity.id, created.body.opportunity.id)
  const id = created.body.opportunity.id
  assert.equal((await patch(undefined, { id, version: 1, stage: "QUALIFYING" })).status, 401)
  assert.equal((await patch(operatorCookie, { id: 99999, version: 1, stage: "QUALIFYING" })).status, 404)
  assert.equal((await patch(operatorCookie, { id, version: 1, stage: "CONFIRMED" })).status, 400)
  const changed = await patch(operatorCookie, { id, version: 1, stage: "QUALIFYING" })
  assert.equal(changed.status, 200, JSON.stringify(changed.body))
  assert.equal(changed.body.opportunity.version, 2)
  assert.equal((await patch(operatorCookie, { id, version: 1, title: "Stale edit" })).status, 409)
  return { id, snapshot: { createdStatus: created.status, replayStatus: replay.status, changedStatus: changed.status,
    created: { title: created.body.opportunity.title, company: created.body.opportunity.company, stage: created.body.opportunity.stage,
      owner: created.body.opportunity.owner.displayName, history: created.body.opportunity.history.map(item => item.action) },
    changed: { title: changed.body.opportunity.title, stage: changed.body.opportunity.stage, version: changed.body.opportunity.version,
      history: changed.body.opportunity.history.map(item => item.action) } } }
}

async function enrichmentLimitContract(origin, adminCookie, pcomCookie) {
  const patch = (cookie, monthlyCreditLimit) => http("/api/enrichment", { origin, cookie, method: "PATCH",
    body: { provider: "lusha", monthlyCreditLimit } })
  assert.equal((await patch(undefined, 30)).status, 401)
  assert.equal((await patch(pcomCookie, 30)).status, 403)
  assert.equal((await patch(adminCookie, -1)).status, 400)
  const changed = await patch(adminCookie, 30)
  assert.equal(changed.status, 200, JSON.stringify(changed.body))
  assert.equal(changed.body.usage.lusha.limit, 30)
  assert.equal(changed.body.usage.lusha.remaining, 21)
  const duplicate = await patch(adminCookie, 30)
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body))
  assert.deepEqual(duplicate.body, changed.body)
  return changed.body
}

async function enrichmentLocalActionContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/enrichment", { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, { action: "refresh_history" })).status, 401)
  assert.equal((await post(pcomCookie, { action: "refresh_history" })).status, 403)
  const refreshed = await post(adminCookie, { action: "refresh_history" })
  assert.deepEqual({ status: refreshed.status, body: refreshed.body }, { status: 200, body: { refreshed: true } })
  assert.equal((await post(pcomCookie, { action: "reconcile_usage", historyId: 99800, reconciledCredits: 2, reconciliationSource: "Fictional account ledger" })).status, 403)
  assert.equal((await post(adminCookie, { action: "reconcile_usage", historyId: 99800, reconciledCredits: -1, reconciliationSource: "Fictional account ledger" })).status, 400)
  assert.equal((await post(adminCookie, { action: "reconcile_usage", historyId: 99999, reconciledCredits: 2, reconciliationSource: "Fictional account ledger" })).status, 409)
  const body = { action: "reconcile_usage", historyId: 99800, reconciledCredits: 2, reconciliationSource: "Fictional account ledger" }
  const reconciled = await post(adminCookie, body)
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body))
  assert.equal(reconciled.body.reconciled, true)
  assert.equal(reconciled.body.usage.lusha.used, 11)
  assert.equal(reconciled.body.usage.lusha.remaining, 19)
  assert.equal((await post(adminCookie, body)).status, 409)
  return { refreshed: refreshed.body, reconciled: reconciled.body }
}

async function userCorrectionContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/admin", { origin, cookie, method: "POST", body })
  const body = { action: "correct_pre_authorization", userId: 99850, correctUserId: 99851, confirmation: "CORRECT USER 99850" }
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(pcomCookie, body)).status, 403)
  assert.equal((await post(adminCookie, { ...body, confirmation: "" })).status, 409)
  assert.equal((await post(adminCookie, { ...body, userId: 1, confirmation: "CORRECT USER 1" })).status, 409)
  assert.equal((await post(adminCookie, { ...body, userId: 99855, correctUserId: 99856, confirmation: "CORRECT USER 99855" })).status, 409)
  assert.equal((await post(adminCookie, { ...body, correctUserId: 99999 })).status, 404)
  const corrected = await post(adminCookie, body)
  assert.deepEqual({ status: corrected.status, body: corrected.body }, { status: 200, body: { corrected: true, deletedUserId: 99850, correctUserId: 99851 } })
  assert.equal((await post(adminCookie, body)).status, 404)
  const summary = await http("/api/admin", { origin, cookie: adminCookie })
  assert.equal(summary.status, 200)
  assert.equal(summary.body.users.some(user => user.id === 99850), false)
  assert.equal(summary.body.users.some(user => user.id === 99851), true)
  assert.equal(summary.body.audit.filter(event => event.action === "user_pre_authorization_corrected" && event.entityId === "99850").length, 1)
  const concurrentBody = { action: "correct_pre_authorization", userId: 99852, correctUserId: 99854, confirmation: "CORRECT USER 99852" }
  const concurrent = await Promise.all([post(adminCookie, concurrentBody), post(adminCookie, concurrentBody)])
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 200])
  const afterConcurrent = await http("/api/admin", { origin, cookie: adminCookie })
  assert.equal(afterConcurrent.body.users.some(user => user.id === 99852), false)
  assert.equal(afterConcurrent.body.users.some(user => user.id === 99854), true)
  assert.equal(afterConcurrent.body.audit.filter(event => event.action === "user_pre_authorization_corrected" && event.entityId === "99852").length, 2)
  return corrected.body
}

async function collectReviewPreflightContract(origin, adminCookie, pcomCookie) {
  const path = "/api/admin/coresignal-collect-review"
  const body = { collectHistoryId: 99901, alumnusId: 99900 }
  const post = (cookie, value) => http(path, { origin, cookie, method: "POST", body: value })
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(pcomCookie, body)).status, 403)
  assert.equal((await post(adminCookie, { collectHistoryId: 0, alumnusId: 99900 })).status, 400)
  assert.equal((await post(adminCookie, { ...body, collectHistoryId: 99999 })).status, 404)
  const preview = await post(adminCookie, body)
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.equal(preview.body.decision.outcome, "ATTACHED_PROVIDER_ID")
  assert.equal(preview.body.providerCalls, 0)
  assert.equal(preview.body.canonicalMutations, 0)
  return preview.body
}

async function collectSelectionContract(origin, adminCookie, pcomCookie) {
  const path = "/api/admin/coresignal-collect"
  const selection = { action: "selection_preflight", selections: [{ searchHistoryId: 99703, employeeId: "99701001" }] }
  const post = (cookie, body) => http(path, { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, selection)).status, 401)
  assert.equal((await post(pcomCookie, selection)).status, 403)
  assert.equal((await post(adminCookie, { action: "selection_preflight", selections: [] })).status, 400)
  assert.equal((await post(adminCookie, { action: "selection_preflight", selections: [{ searchHistoryId: 99999, employeeId: "99701001" }] })).status, 409)
  const result = await post(adminCookie, selection)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.providerCalls, 0)
  assert.equal(result.body.confirmationTokensIssued, 0)
  assert.equal(result.body.plan.operations[0].candidate.employeeId, "99701001")
  assert.equal(result.body.plan.operations[0].candidate.priorCollectStatus, "ambiguous")
  return result.body
}

async function collectSinglePreflightContract(origin, adminCookie, pcomCookie) {
  const path = "/api/admin/coresignal-collect"
  const post = (cookie, body) => http(path, { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, { action: "preflight", alumnusId: 99910 })).status, 401)
  assert.equal((await post(pcomCookie, { action: "preflight", alumnusId: 99910 })).status, 403)
  assert.equal((await post(adminCookie, { action: "preflight" })).status, 400)
  assert.equal((await post(adminCookie, { action: "preflight", webhookEventId: 99999, alumnusId: 99910 })).status, 409)
  const missing = await post(adminCookie, { action: "preflight", searchHistoryId: 99999, employeeId: "99701001" })
  assert.equal(missing.status, 503, JSON.stringify(missing.body))
  assert.deepEqual(Object.keys(missing.body).sort(), ["error", "failureOrigin", "providerRequestId", "upstreamHttpStatus"].sort())
  const preview = await post(adminCookie, { action: "preflight", searchHistoryId: 99703, employeeId: "99701001" })
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.equal(preview.body.preflight.candidate.priorCollectStatus, "ambiguous")
  assert.equal(preview.body.confirmationToken, null)
  const known = await post(adminCookie, { action: "preflight", alumnusId: 99910 })
  assert.equal(known.status, 200, JSON.stringify(known.body))
  assert.equal(known.body.preflight.candidate.employeeId, "99910001")
  assert.equal(known.body.preflight.candidate.sourceAlumnusId, 99910)
  assert.equal(known.body.confirmationToken, null)
  return { missing: { status: missing.status, body: missing.body }, preview: preview.body, known: known.body }
}

async function collectMockExecutionContract(origin, adminCookie, pcomCookie, readRows, auditFailure, settlementFailure, claimFailure, setLimit) {
  const post = (cookie, body) => http("/api/admin/coresignal-collect", { origin, cookie, method: "POST", body })
  const prepare = async alumnusId => {
    const preflight = await post(adminCookie, { action: "preflight", alumnusId })
    assert.equal(preflight.status, 200, JSON.stringify(preflight.body))
    assert.equal(preflight.body.preflight.allowed, true, JSON.stringify(preflight.body.preflight))
    assert.equal(typeof preflight.body.confirmationToken, "string")
    return { action: "execute", alumnusId, confirmed: true, confirmationToken: preflight.body.confirmationToken }
  }
  const inspect = async alumnusId => {
    const rows = await readRows(`SELECT h.status,h.application_units,h.usage_state,h.result_count,
      (SELECT count(*) FROM alumni_employment_evidence e WHERE e.provider_response_id=h.id) AS evidence,
      (SELECT count(*) FROM alumni_profile_change_proposals p WHERE p.mutation_request_key='coresignal-collect:'||h.id) AS proposals,
      (SELECT count(*) FROM security_audit_events a WHERE a.action='coresignal_collect_only_executed' AND a.entity_id=CAST(h.id AS TEXT)) AS audits
      FROM provider_response_history h WHERE h.provider='coresignal' AND h.operation='Base Employee Collect-only' AND h.alumnus_id=${alumnusId}`)
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : value])))
  }
  assert.equal((await post(undefined, { action: "execute", alumnusId: 99910 })).status, 401)
  assert.equal((await post(pcomCookie, { action: "execute", alumnusId: 99910 })).status, 403)
  const firstBody = await prepare(99910)
  assert.equal((await post(adminCookie, { ...firstBody, confirmationToken: "invalid" })).status, 409)
  const first = await post(adminCookie, firstBody)
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.evidence.returnedEmployeeId, "99910001")
  assert.equal(first.body.evidence.providerActions.collectRequests, 1)
  assert.equal((await post(adminCookie, firstBody)).status, 409)
  const firstState = await inspect(99910)
  assert.equal(firstState.length, 1)
  assert.equal(firstState[0].application_units, 20)
  assert.equal(firstState[0].audits, 1)
  assert.equal(firstState[0].evidence, 1)

  const auditBody = await prepare(99911)
  await auditFailure(true)
  let auditResponse
  try { auditResponse = await post(adminCookie, auditBody) } finally { await auditFailure(false) }
  assert.ok(auditResponse.status >= 500)
  const auditState = await inspect(99911)
  assert.equal(auditState.length, 1)
  assert.equal(auditState[0].status, "success")
  assert.equal(auditState[0].application_units, 20)
  assert.equal(auditState[0].evidence, 1)
  assert.equal(auditState[0].audits, 0)

  const raceBody = await prepare(99912)
  const raced = await Promise.all([post(adminCookie, raceBody), post(adminCookie, raceBody)])
  assert.equal(raced.filter(item => item.status === 200).length, 1)
  assert.equal(raced.filter(item => item.status === 409).length, 1)
  const raceState = await inspect(99912)
  assert.equal(raceState.length, 1)
  assert.equal(raceState[0].application_units, 20)
  assert.equal(raceState[0].audits, 1)
  const ambiguousBody = await prepare(99913)
  await settlementFailure(true)
  let ambiguousResponse
  try { ambiguousResponse = await post(adminCookie, ambiguousBody) } finally { await settlementFailure(false) }
  assert.equal(ambiguousResponse.status, 503)
  assert.equal((await post(adminCookie, ambiguousBody)).status, 409)
  const ambiguousState = await inspect(99913)
  assert.equal(ambiguousState.length, 1)
  assert.equal(ambiguousState[0].status, "ambiguous")
  assert.equal(ambiguousState[0].application_units, 20)
  assert.equal(ambiguousState[0].evidence, 0)
  assert.equal(ambiguousState[0].audits, 0)

  const releaseBody = await prepare(99914)
  const released = await post(adminCookie, releaseBody)
  assert.deepEqual({ status: released.status, body: released.body }, { status: 402, body: { error: "Fictional mock Collect rejection.", failureOrigin: "upstream_http", upstreamHttpStatus: 402, providerRequestId: null } })
  assert.equal((await post(adminCookie, releaseBody)).status, 409)
  const releaseState = await inspect(99914)
  assert.equal(releaseState.length, 1)
  assert.equal(releaseState[0].status, "error")
  assert.equal(releaseState[0].application_units, 0)
  assert.equal(releaseState[0].evidence, 0)
  assert.equal(releaseState[0].audits, 0)
  const failedClaimBody = await prepare(99915)
  await claimFailure(true)
  let claimFailureResponse
  try { claimFailureResponse = await post(adminCookie, failedClaimBody) } finally { await claimFailure(false) }
  assert.equal(claimFailureResponse.status, 503)
  assert.deepEqual(await inspect(99915), [])
  const recoveredClaim = await post(adminCookie, failedClaimBody)
  assert.equal(recoveredClaim.status, 200)
  const recoveredState = await inspect(99915)
  assert.equal(recoveredState.length, 1)
  assert.equal(recoveredState[0].application_units, 20)
  assert.equal(recoveredState[0].audits, 1)

  await setLimit(1)
  let budgetResponse
  try {
    const budgetPreflight = await post(adminCookie, { action: "preflight", alumnusId: 99916 })
    assert.equal(budgetPreflight.status, 200)
    assert.equal(budgetPreflight.body.preflight.allowed, false)
    assert.equal(budgetPreflight.body.confirmationToken, null)
    budgetResponse = await post(adminCookie, { action: "execute", alumnusId: 99916, confirmed: true, confirmationToken: "invalid" })
  } finally { await setLimit(1000) }
  assert.equal(budgetResponse.status, 409)
  assert.deepEqual(await inspect(99916), [])
  return { first: { state: first.body.state, comparisonOutcome: first.body.comparisonOutcome,
    returnedEmployeeId: first.body.evidence.returnedEmployeeId, reviewState: first.body.evidence.reviewState },
    firstState, audit: { status: auditResponse.status, state: auditState }, race: { statuses: raced.map(item => item.status).sort(), state: raceState },
    ambiguous: { status: ambiguousResponse.status, state: ambiguousState }, release: { status: released.status, state: releaseState },
    claimFailure: { status: claimFailureResponse.status, recovered: recoveredState }, budget: { status: budgetResponse.status } }
}

async function webhookPreviewContract(origin, adminCookie, pcomCookie, alumnusId) {
  const path = "/api/intelligence/webhooks"
  const body = { action: "preview", cohortType: "FIXED_IDS", ids: [alumnusId, 99999] }
  const post = (cookie, value) => http(path, { origin, cookie, method: "POST", body: value })
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(pcomCookie, { ...body, ids: [] })).status, 409)
  const pcom = await post(pcomCookie, body)
  assert.equal(pcom.status, 200, JSON.stringify(pcom.body))
  assert.equal(pcom.body.providerRequests, 0)
  assert.equal(pcom.body.selectedCount, 2)
  assert.equal(pcom.body.counts.PENDING_PROVIDER_MAPPING, 1)
  assert.equal(pcom.body.counts.IDENTITY_REVIEW_REQUIRED, 1)
  assert.equal(pcom.body.eligible, undefined)
  const admin = await post(adminCookie, body)
  assert.equal(admin.status, 200, JSON.stringify(admin.body))
  assert.deepEqual(admin.body.eligible, [])
  const dynamicBody = { action: "preview", cohortType: "DYNAMIC_FILTER", selection: {
    version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minDataConfidence: 100, company: "Fictional unmatched monitoring company" },
    includeCnAlumniIds: [alumnusId], excludeCnAlumniIds: [],
  } }
  const dynamic = await post(pcomCookie, dynamicBody)
  assert.equal(dynamic.status, 200, JSON.stringify(dynamic.body))
  assert.equal(dynamic.body.selectedCount, 0)
  assert.equal(dynamic.body.excludedFromBatch, 0)
  assert.equal(dynamic.body.providerRequests, 0)
  return { pcom: pcom.body, admin: admin.body, dynamic: dynamic.body }
}

async function webhookReviewContract(origin, adminCookie, pcomCookie) {
  const path = "/api/intelligence/webhooks"
  const body = { action: "review", subscriptionId: 99400, eventId: 99402, outcome: "IGNORED" }
  const post = (cookie, value) => http(path, { origin, cookie, method: "POST", body: value })
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(pcomCookie, body)).status, 403)
  assert.equal((await post(adminCookie, { ...body, subscriptionId: 99999 })).status, 409)
  assert.equal((await post(adminCookie, { ...body, outcome: "INVALID" })).status, 409)
  assert.equal((await post(adminCookie, { ...body, eventId: 99999 })).status, 409)
  const reviewed = await post(adminCookie, body)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body))
  assert.deepEqual(reviewed.body, { eventId: 99402, status: "IGNORED", canonicalMutations: 0 })
  assert.equal((await post(adminCookie, body)).status, 409)
  return reviewed.body
}

async function webhookSetupContract(origin, adminCookie, pcomCookie) {
  const path = "/api/intelligence/webhooks"
  const post = (cookie, value) => http(path, { origin, cookie, method: "POST", body: value })
  const attestation = { action: "attest", alumnusId: 99410, evidenceReference: "Fictional exact Base Employee mapping", confirmation: "VERIFY_BASE_EMPLOYEE_ID" }
  assert.equal((await post(undefined, attestation)).status, 401)
  assert.equal((await post(pcomCookie, attestation)).status, 403)
  assert.equal((await post(adminCookie, { ...attestation, confirmation: "INVALID" })).status, 409)
  const attested = await post(adminCookie, attestation)
  assert.deepEqual({ status: attested.status, body: attested.body }, { status: 200, body: { alumnusId: 99410, status: "VERIFIED", providerRequests: 0 } })
  assert.equal((await post(adminCookie, attestation)).status, 409)

  const fixed = { action: "prepare", cohortType: "FIXED_IDS", ids: [99410], name: "Fictional fixed monitoring batch" }
  assert.equal((await post(undefined, fixed)).status, 401)
  assert.equal((await post(pcomCookie, fixed)).status, 403)
  assert.equal((await post(adminCookie, { ...fixed, name: "" })).status, 409)
  const fixedPlan = await post(adminCookie, fixed)
  assert.equal(fixedPlan.status, 200, JSON.stringify(fixedPlan.body))
  assert.ok(Number.isSafeInteger(fixedPlan.body.id) && fixedPlan.body.id > 0)
  assert.deepEqual({ ...fixedPlan.body, id: 0 }, { id: 0, status: "DRAFT", employeeIds: ["99410001"], selectedCount: 1, preparedCount: 1, remainingEligible: 0, providerRequests: 0 })

  const dynamic = { action: "prepare", cohortType: "DYNAMIC_FILTER", name: "Fictional dynamic monitoring batch", selection: {
    version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { minDataConfidence: 1, company: "Fictional Monitoring Co" }, includeCnAlumniIds: [], excludeCnAlumniIds: [],
  } }
  const dynamicPlan = await post(adminCookie, dynamic)
  assert.equal(dynamicPlan.status, 200, JSON.stringify(dynamicPlan.body))
  assert.ok(Number.isSafeInteger(dynamicPlan.body.id) && dynamicPlan.body.id > 0)
  assert.deepEqual({ ...dynamicPlan.body, id: 0 }, { id: 0, status: "DRAFT", employeeIds: ["99410001"], selectedCount: 1, preparedCount: 1, remainingEligible: 0, providerRequests: 0 })
  const reconcile = { action: "reconcile", subscriptionId: fixedPlan.body.id }
  assert.equal((await post(undefined, reconcile)).status, 401)
  assert.equal((await post(pcomCookie, reconcile)).status, 403)
  assert.equal((await post(adminCookie, { ...reconcile, subscriptionId: 99999 })).status, 409)
  const reviewed = await post(adminCookie, reconcile)
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body))
  assert.deepEqual(reviewed.body, { changes: { add: ["99410001"], remove: [], unchanged: [] }, remainingAdditions: 0,
    counts: { ELIGIBLE: 1, PENDING_PROVIDER_MAPPING: 0, IDENTITY_REVIEW_REQUIRED: 0, ALREADY_COVERED: 0 }, providerRequests: 0,
    nextAction: "Review bounded changes; provider membership has not been edited." })
  return { attested: attested.body, fixed: { ...fixedPlan.body, id: 0 }, dynamic: { ...dynamicPlan.body, id: 0 }, reconcile: reviewed.body }
}

async function alumniHistoryContract(origin, adminCookie, pcomCookie) {
  const path = "/api/alumni/99420/history"
  const get = (cookie, suffix = "") => http(`${path}${suffix}`, { origin, cookie })
  assert.equal((await get(undefined)).status, 401)
  assert.equal((await get(pcomCookie, "?page=0")).status, 400)
  assert.equal((await get(pcomCookie, "?source=unsupported")).status, 400)
  assert.equal((await http("/api/alumni/99999/history", { origin, cookie: pcomCookie })).status, 404)
  const first = await get(adminCookie)
  const second = await get(pcomCookie, "?page=2")
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(first.body.pageSize, 20)
  assert.equal(first.body.hasMore, true)
  assert.equal(first.body.entries.length, 20)
  assert.equal(second.body.hasMore, false)
  assert.equal(second.body.entries.length, 7)
  assert.equal(second.body.entries.at(-1)?.occurredAt, "invalid")
  assert.ok(second.body.entries.some(item => item.kind === "SOURCE_OBSERVATION"))
  assert.ok(second.body.entries.some(item => item.kind === "SOURCE_BASELINE"))
  assert.ok(first.body.entries.some(item => item.kind === "WEBHOOK_NOTIFICATION"))
  assert.ok(first.body.entries.some(item => item.kind === "PROVIDER_ATTEMPT"))
  assert.doesNotMatch(JSON.stringify({ first: first.body, second: second.body }), /private@example\.test/)
  assert.deepEqual((await get(pcomCookie)).body, first.body)
  return { first: first.body, second: second.body }
}

async function engagementLocalContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/engagements", { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, { action: "view", eventId: 99210 })).status, 401)
  assert.equal((await post(pcomCookie, { action: "view", eventId: 0 })).status, 400)
  assert.equal((await post(pcomCookie, { action: "view", eventId: 99999 })).status, 400)
  assert.equal((await post(pcomCookie, { action: "assign_to", eventId: 99212, assigneeId: 99999 })).status, 409)
  assert.equal((await post(pcomCookie, { action: "follow_up", eventId: 99219 })).status, 400)
  assert.equal((await post(pcomCookie, { action: "correct_birthday", eventId: 99221, birthMonthDay: "bad" })).status, 400)
  const cases = [
    ["view", 99210, {}, "Viewed"], ["acknowledge", 99211, {}, "Acknowledged"],
    ["assign_to", 99212, { assigneeId: 2 }, "New"], ["assign", 99213, {}, "New"],
    ["plan", 99214, { notes: "Fictional plan" }, "Action Planned"],
    ["manual_action", 99215, { notes: "Fictional offline conversation" }, "Action Taken"],
    ["skip", 99216, { reason: "Fictional irrelevant event" }, "Skipped"],
    ["incorrect", 99217, { reason: "Fictional incorrect signal" }, "Skipped"],
    ["response", 99218, { responseType: "Interested", followUpRequired: true, followUpDate: "2030-01-01", notes: "Fictional response" }, "Follow-up Due"],
    ["follow_up", 99219, { followUpDate: "2030-01-02" }, "Follow-up Due"],
    ["close", 99220, { notes: "Fictional close" }, "Closed"],
    ["correct_birthday", 99221, { birthMonthDay: "11-02" }, "New"],
  ]
  const snapshots = []
  for (const [action, eventId, fields, status] of cases) {
    const result = await post(action === "correct_birthday" ? adminCookie : pcomCookie, { action, eventId, ...fields })
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`)
    if (action === "manual_action") {
      assert.equal(result.body.action.actionType, "Manual Action")
      assert.equal(result.body.action.deliveryStatus, "Completed")
    }
    const read = await http("/api/engagements", { origin, cookie: pcomCookie })
    assert.equal(read.status, 200)
    const event = read.body.events.find(item => item.id === eventId)
    assert.equal(event.status, status, action)
    snapshots.push({ action, eventId, status: event.status, assignedTo: event.assignedTo,
      actionType: event.actionType, actionChannel: event.actionChannel, deliveryStatus: event.deliveryStatus,
      responseReceived: event.responseReceived, followUpRequired: event.followUpRequired,
      followUpDate: event.followUpDate, eventDate: event.eventDate, source: event.source,
      birthday: event.birthday && { birthMonthDay: event.birthday.birthMonthDay, status: event.birthday.status },
      actions: event.actions.map(item => ({ actionType: item.actionType, channel: item.channel, deliveryStatus: item.deliveryStatus, notes: item.notes })),
      responses: event.responses.map(item => ({ responseType: item.responseType, followUpRequired: item.followUpRequired, followUpDate: item.followUpDate, notes: item.notes })),
      activity: event.activity.map(item => ({ action: item.action, details: item.details })), views: event.views.length })
  }
  assert.equal((await post(pcomCookie, { action: "manual_action", eventId: 99215 })).status, 409)
  assert.equal((await post(pcomCookie, { action: "assign_to", eventId: 99220, assigneeId: 2 })).status, 409)
  return snapshots
}

async function engagementBulkPreviewContract(origin, pcomCookie) {
  const post = (cookie, body) => http("/api/engagements", { origin, cookie, method: "POST", body: { action: "bulk_preview", ...body } })
  assert.equal((await post(undefined, { eventIds: [99243] })).status, 401)
  assert.deepEqual((await post(pcomCookie, { eventIds: [] })).body, { ready: [], excluded: [] })
  const result = await post(pcomCookie, { eventIds: [99243, 99243, 99244, 99245, 99999], templateId: 99246 })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.deepEqual(result.body.ready, [{ eventId: 99243, alumnusName: "Fictional Preview Ready", templateId: 99246,
    recipient: "ready@example.test", subject: "Hello Fictional", body: "Dear Fictional Preview Ready, this is a fictional draft." }])
  assert.equal(result.body.excluded.length, 3)
  assert.match(result.body.excluded[0].reason, /Provisional intake/)
  assert.match(result.body.excluded[1].reason, /Email unavailable/)
  assert.equal(result.body.excluded[2].alumnusName, "Unknown alumnus")
  return result.body
}

async function engagementSendContract(origin, pcomCookie) {
  const post = (body, cookie = pcomCookie) => http("/api/engagements", { origin, cookie, method: "POST", body })
  assert.equal((await post({ action: "send", eventId: 99253, approved: true }, null)).status, 401)
  assert.deepEqual((await post({ action: "send", eventId: "invalid", approved: true })).body,
    { error: "A valid engagement event is required." })
  assert.deepEqual((await post({ action: "send", eventId: 99253, templateId: 99246 })).body,
    { error: "Human approval is required after preview and before sending." })
  const missing = await post({ action: "send", eventId: 99245, templateId: 99246, approved: true })
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /Email unavailable/)
  const invalid = await post({ action: "send", eventId: 99258, templateId: 99259, approved: true })
  assert.equal(invalid.status, 400, JSON.stringify(invalid.body))
  assert.match(invalid.body.error, /Recipient, subject, and message are required/)
  const interrupted = await post({ action: "send", eventId: 99260, templateId: 99246, approved: true })
  assert.equal(interrupted.status, 409)
  assert.match(interrupted.body.error, /Already engaged/)
  const single = await post({ action: "send", eventId: 99253, templateId: 99246, approved: true })
  assert.equal(single.status, 200, JSON.stringify(single.body))
  assert.equal(single.body.mode, "mock")
  assert.equal(single.body.sent.eventId, 99253)
  assert.equal(single.body.sent.deliveryStatus, "Mock sent")
  assert.match(single.body.sent.messageId, /^mock-mail-/)
  const duplicate = await post({ action: "send", eventId: 99253, templateId: 99246, approved: true })
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body))
  assert.match(duplicate.body.error, /Already engaged/)
  const bulk = await post({ action: "bulk_send", eventIds: [99254, 99254, 99255, 99244], templateId: 99246, approved: true })
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body))
  assert.equal(bulk.body.mode, "mock")
  assert.deepEqual(bulk.body.sent.map(item => [item.eventId, item.deliveryStatus]), [[99254, "Mock sent"], [99255, "Mock sent"]])
  assert.deepEqual(bulk.body.excluded.map(item => item.eventId), [99244])
  assert.match(bulk.body.excluded[0].reason, /Provisional intake/)
  const replay = await post({ action: "bulk_send", eventIds: [99254, 99255], templateId: 99246, approved: true })
  assert.deepEqual(replay.body.sent, [])
  assert.equal(replay.body.excluded.length, 2)
  assert.ok(replay.body.excluded.every(item => /Already engaged/.test(item.reason)))
  const bounded = await post({ action: "bulk_send", eventIds: Array.from({ length: 30 }, (_, i) => 99350 + i),
    templateId: 99246, approved: true })
  assert.equal(bounded.status, 200)
  assert.equal(bounded.body.sent.length, 0)
  assert.deepEqual(bounded.body.excluded.map(item => item.eventId), Array.from({ length: 25 }, (_, i) => 99350 + i))
  const workspace = await http("/api/engagements", { origin, cookie: pcomCookie })
  assert.equal(workspace.status, 200)
  const stored = workspace.body.events.filter(item => [99253,99254,99255,99258].includes(item.id))
    .sort((a,b) => a.id-b.id).map(item => ({ id: item.id, status: item.status,
      deliveryStatus: item.deliveryStatus, outreachStatus: item.alumnus?.outreachStatus,
      actions: item.actions.map(action => action.deliveryStatus),
      audit: item.activity.map(action => action.action) }))
  return { singleStatus: single.status, duplicateStatus: duplicate.status, interruptedStatus: interrupted.status, bulkStatus: bulk.status,
    sent: bulk.body.sent.map(item => [item.eventId, item.deliveryStatus]),
    excluded: bulk.body.excluded.map(item => [item.eventId, item.reason]),
    replay: replay.body.excluded.map(item => item.eventId), invalid: invalid.body, missing: missing.body,
    bounded: bounded.body.excluded.map(item => item.eventId), stored }
}

async function lushaRejectionContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/enrichment", { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, { action: "lusha_reject_identity", reviewId: 99272, confirmed: true })).status, 401)
  assert.equal((await post(pcomCookie, { action: "lusha_reject_identity", reviewId: 99272, confirmed: true })).status, 403)
  assert.deepEqual((await post(adminCookie, { action: "lusha_reject_identity", reviewId: 99272 })).body,
    { error: "Choose a Lusha identity review and explicitly confirm rejection." })
  const identity = await post(adminCookie, { action: "lusha_reject_identity", reviewId: 99272, confirmed: true })
  assert.deepEqual({ status: identity.status, body: identity.body }, { status: 200,
    body: { rejected: true, reviewId: 99272 } })
  const identityReplay = await post(adminCookie, { action: "lusha_reject_identity", reviewId: 99272, confirmed: true })
  assert.equal(identityReplay.status, 409)
  const contact = await post(adminCookie, { action: "lusha_reject_contact", reviewId: 99273, confirmed: true })
  assert.deepEqual({ status: contact.status, body: contact.body }, { status: 200,
    body: { rejected: true, reviewId: 99273 } })
  const competing = await Promise.all([1,2].map(() => post(adminCookie,
    { action: "lusha_reject_contact", reviewId: 99274, confirmed: true })))
  assert.deepEqual(competing.map(item => item.status).sort(), [200,409])
  assert.match(competing.find(item => item.status === 409)?.body.error ?? "",
    /not pending an eligible review|changed concurrently/)
  return { identity: identity.body, identityReplay: identityReplay.body, contact: contact.body,
    competingStatuses: competing.map(item => item.status).sort() }
}

async function lushaContactApprovalContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/enrichment", { origin, cookie, method: "POST",
    body: { action: "lusha_approve_contact", ...body } })
  assert.equal((await post(undefined, { reviewId: 99288, confirmed: true })).status, 401)
  assert.equal((await post(pcomCookie, { reviewId: 99288, confirmed: true })).status, 403)
  assert.deepEqual((await post(adminCookie, { reviewId: 99288 })).body,
    { error: "Choose a pending contact review and explicitly confirm this decision." })
  const privacy = await post(adminCookie, { reviewId: 99291, confirmed: true })
  assert.equal(privacy.status, 409)
  assert.match(privacy.body.error, /do-not-contact/)
  const replacementGate = await post(adminCookie, { reviewId: 99290, confirmed: true })
  assert.equal(replacementGate.status, 409)
  assert.match(replacementGate.body.error, /explicit confirmation/)
  const first = await post(adminCookie, { reviewId: 99288, confirmed: true })
  assert.deepEqual({ status: first.status, body: first.body }, { status: 200,
    body: { approved: true, reviewId: 99288, alumnusId: 99280 } })
  const replay = await post(adminCookie, { reviewId: 99288, confirmed: true })
  assert.equal(replay.status, 409)
  const replaced = await post(adminCookie, { reviewId: 99290, confirmed: true, replaceExisting: true })
  assert.deepEqual({ status: replaced.status, body: replaced.body }, { status: 200,
    body: { approved: true, reviewId: 99290, alumnusId: 99282 } })
  const competing = await Promise.all([1,2].map(() => post(adminCookie, { reviewId: 99289, confirmed: true })))
  assert.deepEqual(competing.map(item => item.status).sort(), [200,409])
  const profiles = []
  for (const id of [99280,99281,99282,99283]) {
    const response = await http(`/api/alumni/${id}`, { origin, cookie: adminCookie })
    assert.equal(response.status, 200)
    profiles.push({ id, email: response.body.alumnus.email,
      recordVersion: response.body.alumnus.recordVersion,
      history: response.body.fieldHistory.map(item => [item.field,item.oldValue,item.newValue,item.creditsCharged]) })
  }
  return { first: first.body, replay: replay.body, replaced: replaced.body,
    competingStatuses: competing.map(item => item.status).sort(), privacy: privacy.body,
    replacementGate: replacementGate.body, profiles }
}

async function lushaIdentityApprovalContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/enrichment", { origin, cookie, method: "POST",
    body: { action: "lusha_approve_identity", ...body } })
  assert.equal((await post(undefined, { reviewId: 99330, confirmed: true })).status, 401)
  assert.equal((await post(pcomCookie, { reviewId: 99330, confirmed: true })).status, 403)
  assert.deepEqual((await post(adminCookie, { reviewId: 99330 })).body,
    { error: "Choose a pending Lusha identity review and explicitly confirm the association." })
  const shared = await post(adminCookie, { reviewId: 99332, confirmed: true })
  assert.equal(shared.status, 409)
  assert.match(shared.body.error, /shared by another alumnus/)
  const stale = await post(adminCookie, { reviewId: 99333, confirmed: true })
  assert.equal(stale.status, 409)
  assert.match(stale.body.error, /do not support this association/)
  const first = await post(adminCookie, { reviewId: 99330, confirmed: true })
  assert.deepEqual({ status: first.status, body: first.body }, { status: 200,
    body: { approved: true, reviewId: 99330, alumnusId: 99310 } })
  const replay = await post(adminCookie, { reviewId: 99330, confirmed: true })
  assert.equal(replay.status, 409)
  const competing = await Promise.all([1,2].map(() => post(adminCookie, { reviewId: 99331, confirmed: true })))
  const statuses = competing.map(item => item.status).sort()
  if (origin === base) assert.deepEqual(statuses, [200,409])
  else {
    // D1 can fail the losing batch at its unique field-history insert after the winner commits.
    assert.equal(statuses[0], 200)
    assert.ok([409,500].includes(statuses[1]), JSON.stringify(competing))
    if (statuses[1] === 500) assert.match(competing.find(item => item.status === 500)?.body.error ?? "",
      /UNIQUE constraint failed: field_change_history\.mutation_request_key, field_change_history\.field/)
  }
  const profiles = []
  for (const id of [99310,99311,99312,99314]) {
    const response = await http(`/api/alumni/${id}`, { origin, cookie: adminCookie })
    assert.equal(response.status, 200)
    profiles.push({ id, contactId: response.body.alumnus.lushaPersonId,
      recordVersion: response.body.alumnus.recordVersion,
      history: response.body.fieldHistory.map(item => [item.field,item.oldValue,item.newValue,item.creditsCharged]) })
  }
  return { first: first.body, replay: replay.body, shared: shared.body, stale: stale.body,
    concurrentWinnerCount: competing.filter(item => item.status === 200).length, profiles }
}

async function engagementPreviewContract(origin, pcomCookie) {
  const post = (cookie, body) => http("/api/engagements", { origin, cookie, method: "POST", body: { action: "preview", ...body } })
  assert.equal((await post(undefined, { eventId: 99243, templateId: 99246 })).status, 401)
  assert.equal((await post(pcomCookie, { eventId: "invalid" })).status, 400)
  const ready = await post(pcomCookie, { eventId: 99243, templateId: 99246 })
  assert.equal(ready.status, 200, JSON.stringify(ready.body))
  assert.equal(ready.body.template.id, 99246)
  assert.deepEqual(ready.body.draft, { recipient: "ready@example.test", subject: "Hello Fictional", body: "Dear Fictional Preview Ready, this is a fictional draft." })
  assert.equal(ready.body.readiness.duplicateStatus, "No duplicate send found")
  const excluded = await post(pcomCookie, { eventId: 99244, templateId: 99246 })
  assert.equal(excluded.status, 400)
  assert.deepEqual(excluded.body, { error: "Provisional intake does not grant outreach eligibility or consent." })
  return { templateKey: ready.body.template.templateKey, draft: ready.body.draft, readiness: ready.body.readiness, excluded: excluded.body }
}

async function manualEmailContract(origin, pcomCookie) {
  const post = (cookie, alumnusId) => http("/api/engagements", { origin, cookie, method: "POST", body: { action: "prepare_manual_email", alumnusId } })
  assert.equal((await post(undefined, 99240)).status, 401)
  assert.deepEqual((await post(pcomCookie, "invalid")).body, { error: "Select a valid approved alumnus." })
  assert.equal((await post(pcomCookie, 99999)).status, 404)
  assert.equal((await post(pcomCookie, 99241)).status, 409)
  assert.equal((await post(pcomCookie, 99242)).status, 409)
  const reused = await post(pcomCookie, 99240)
  assert.equal(reused.status, 200, JSON.stringify(reused.body))
  assert.equal(reused.body.event.id, 99243)
  assert.equal(reused.body.event.alumnus.id, 99240)
  assert.equal(reused.body.event.preference, "Unknown")
  const created = await post(pcomCookie, 99247)
  assert.equal(created.status, 200, JSON.stringify(created.body))
  assert.equal(created.body.event.alumnus.id, 99247)
  assert.equal(created.body.event.eventType, "Manual Relationship")
  assert.equal(created.body.event.eventSubtype, "Controlled institutional email")
  const repeated = await post(pcomCookie, 99247)
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body))
  assert.equal(repeated.body.event.id, created.body.event.id)
  return { reused: { eventId: reused.body.event.id, templateKey: reused.body.template.templateKey, draft: reused.body.draft,
    readiness: reused.body.readiness }, created: { eventType: created.body.event.eventType, eventSubtype: created.body.event.eventSubtype,
    source: created.body.event.source, templateKey: created.body.template.templateKey, draft: created.body.draft,
    readiness: created.body.readiness } }
}

async function anonymizeContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/admin", { origin, cookie, method: "POST", body: { action: "anonymize_alumnus", ...body } })
  assert.equal((await post(undefined, { alumnusId: 99180 })).status, 401)
  assert.equal((await post(pcomCookie, { alumnusId: 99180 })).status, 403)
  assert.equal((await post(adminCookie, { alumnusId: 99180 })).status, 409)
  assert.equal((await post(adminCookie, { alumnusId: 99999, confirmation: "ANONYMIZE 99999" })).status, 404)
  const pending = await post(adminCookie, { alumnusId: 99181, confirmation: "ANONYMIZE 99181" })
  assert.deepEqual({ status: pending.status, body: pending.body }, { status: 409,
    body: { error: "Resolve the pending provider review before anonymizing this alumnus." } })
  const result = await post(adminCookie, { alumnusId: 99180, confirmation: "ANONYMIZE 99180", notes: "Fictional request" })
  assert.deepEqual({ status: result.status, body: result.body }, { status: 200, body: { anonymized: true, alumnusId: 99180 } })
  return result.body
}

async function discoveryIgnoreContract(origin, pcomCookie) {
  const post = (cookie, resultId, reason) => http("/api/discovery", { origin, cookie, method: "POST", body: { action: "ignore", resultId, reason } })
  assert.equal((await post(undefined, 99504, "Irrelevant")).status, 401)
  assert.deepEqual((await post(pcomCookie, 99999, "Irrelevant")).body, { error: "Discovery result provider provenance does not match its search run." })
  const ignored = await post(pcomCookie, 99504, "Irrelevant")
  assert.equal(ignored.status, 200, JSON.stringify(ignored.body))
  assert.deepEqual(ignored.body, { ignored: true, reason: "Irrelevant" })
  const replay = await post(pcomCookie, 99504, "Irrelevant")
  assert.equal(replay.status, 409)
  assert.deepEqual(replay.body, { error: "Only a pending discovery result can be ignored." })
  return { ignored: ignored.body, replay: replay.body }
}

async function keepSeparateContract(origin, pcomCookie, developerCookie) {
  const post = (cookie, resultId) => http("/api/discovery", { origin, cookie, method: "POST", body: { action: "keep_separate", resultId } })
  assert.equal((await post(undefined, 99502)).status, 401)
  if (developerCookie) assert.equal((await post(developerCookie, 99502)).status, 403)
  assert.equal((await post(pcomCookie, 99999)).status, 409)
  const first = await post(pcomCookie, 99502)
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.ok(Number.isInteger(first.body.alumnusId))
  const replay = await post(pcomCookie, 99502)
  assert.equal(replay.status, 409)
  const race = await Promise.all([post(pcomCookie, 99507), post(pcomCookie, 99507)])
  return { status: first.status, replayStatus: replay.status, raceStatuses: race.map(item => item.status).sort(), raceErrors: race.filter(item => item.status >= 500).map(item => String(item.body.error ?? "")) }
}

async function webhookReceiverContract(origin) {
  const path = `/api/webhooks/coresignal/99460/${webhookToken}`
  const post = (body, endpoint = path) => http(endpoint, { origin, method: "POST", body })
  assert.equal((await post([{ member_id: 99470001, status: "changed" }], `/api/webhooks/coresignal/99460/${"0".repeat(64)}`)).status, 401)
  assert.equal((await post([{ member_id: 99470001, status: "changed" }], `/api/webhooks/coresignal/99999/${webhookToken}`)).status, 401)
  assert.equal((await post([{ member_id: "invalid", status: "changed" }])).status, 400)
  const body = [{ member_id: 99470001, status: "changed", changed_fields: ["experience"], event_id: "fictional-1", event_at: "2026-10-19T00:00:00Z" },
    { member_id: 99999999, status: "changed", event_id: "fictional-unknown" }]
  const first = await post(body)
  assert.equal(first.status, 202, JSON.stringify(first.body))
  assert.deepEqual(first.body, { stored: 2, duplicates: 0, providerRequests: 0, canonicalMutations: 0 })
  const replay = await post(body)
  assert.equal(replay.status, 202)
  assert.deepEqual(replay.body, { stored: 0, duplicates: 2, providerRequests: 0, canonicalMutations: 0 })
  const older = await post([{ member_id: 99470001, status: "changed", event_id: "fictional-older", event_at: "2026-10-18T00:00:00Z" }])
  assert.deepEqual(older.body, { stored: 1, duplicates: 0, providerRequests: 0, canonicalMutations: 0 })
  const racing = await Promise.all([1, 2].map(() => post([{ member_id: 99470001, status: "changed", event_id: "fictional-race", event_at: "2026-10-20T00:00:00Z" }])))
  assert.deepEqual(racing.map(item => item.status), [202, 202])
  assert.equal(racing.reduce((sum, item) => sum + item.body.stored, 0), 1)
  return { first: first.body, replay: replay.body, older: older.body, raceStored: 1 }
}

async function webhookLifecycleContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, action, subscriptionId, confirmation) => http("/api/intelligence/webhooks", { origin, cookie, method: "POST", body: { action, subscriptionId, confirmation } })
  assert.equal((await post(undefined, "stop", 99481, "STOP 99481")).status, 401)
  assert.equal((await post(pcomCookie, "stop", 99481, "STOP 99481")).status, 403)
  assert.equal((await post(adminCookie, "stop", 99999, "STOP 99999")).status, 409)
  assert.equal((await post(adminCookie, "stop", 99481, "wrong")).status, 409)
  const renewed = await post(adminCookie, "renew", 99480, "RENEW 99480")
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body))
  assert.deepEqual(renewed.body, { id: 99480, status: "ACTIVE", expiresAt: new Date(Date.parse(webhookLifecycleExpiresAt) + 91 * 86_400_000).toISOString(), providerRequests: 0 })
  assert.equal((await post(adminCookie, "renew", 99480, "RENEW 99480")).status, 409)
  const stopped = await post(adminCookie, "stop", 99481, "STOP 99481")
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body))
  assert.deepEqual(stopped.body, { id: 99481, status: "STOPPED", expiresAt: webhookLifecycleExpiresAt, providerRequests: 0 })
  assert.equal((await post(adminCookie, "stop", 99481, "STOP 99481")).status, 409)
  return { renewed: renewed.body, stopped: stopped.body }
}

async function webhookSimulationContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/intelligence/webhooks", { origin, cookie, method: "POST", body: { action: "simulate", ...body } })
  assert.equal((await post(undefined, { subscriptionId: 99491, alumnusId: 99490 })).status, 401)
  assert.equal((await post(pcomCookie, { subscriptionId: 99491, alumnusId: 99490 })).status, 403)
  assert.equal((await post(adminCookie, { subscriptionId: 99491, alumnusId: 99490, confirmation: "wrong" })).status, 409)
  const simulated = await post(adminCookie, { subscriptionId: 99491, alumnusId: 99490, confirmation: "SIMULATE 99491 99490" })
  assert.deepEqual({ status: simulated.status, body: simulated.body }, { status: 200,
    body: { stored: 1, duplicates: 0, providerRequests: 0, creditsUsed: 0, canonicalMutations: 0 } })
  return simulated.body
}

async function webhookActivationContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/intelligence/webhooks", { origin, cookie, method: "POST", body: { action: "activate", ...body } })
  assert.equal((await post(undefined, { subscriptionId: 99686 })).status, 401)
  assert.equal((await post(pcomCookie, { subscriptionId: 99686 })).status, 403)
  assert.equal((await post(adminCookie, { subscriptionId: 99686, confirmation: "wrong" })).status, 409)
  const activated = await post(adminCookie, { subscriptionId: 99686, confirmation: "ACTIVATE 99686 1" })
  assert.equal(activated.status, 200, JSON.stringify(activated.body))
  assert.equal(activated.body.id, 99686)
  assert.equal(activated.body.status, "ACTIVE")
  assert.equal(activated.body.providerRequests, 0)
  assert.equal(activated.body.creditsUsed, 0)
  assert.match(activated.body.providerSubscriptionId, /^mock-base-experience-/)
  assert.ok(Math.abs(Date.parse(activated.body.expiresAt) - (Date.now() + 91 * 86_400_000)) < 60_000)
  assert.equal((await post(adminCookie, { subscriptionId: 99686, confirmation: "ACTIVATE 99686 1" })).status, 409)
  return { id: activated.body.id, status: activated.body.status, providerRequests: activated.body.providerRequests,
    creditsUsed: activated.body.creditsUsed, providerMode: "mock" }
}

async function brightPreflightContract(origin, adminCookie, pcomCookie, alumnusId) {
  const path = "/api/admin/bright-data"
  const body = { action: "preflight", profileUrl: "https://www.linkedin.com/in/fictional-bright-read/", alumnusId, humanTrial: true }
  const post = (cookie, value) => http(path, { origin, cookie, method: "POST", body: value })
  assert.equal((await post(undefined, body)).status, 401)
  assert.equal((await post(pcomCookie, body)).status, 403)
  assert.equal((await post(adminCookie, { ...body, profileUrl: "invalid" })).status, 400)
  const preflight = await post(adminCookie, body)
  assert.equal(preflight.status, 200, JSON.stringify(preflight.body))
  assert.equal(preflight.body.allowed, false)
  assert.equal(preflight.body.confirmationToken, "")
  assert.equal(preflight.body.requestKey, "")
  assert.equal(preflight.body.runtime.applicationBudget.used, 1)
  assert.ok(preflight.body.blockers.includes("The exact isolated Admin dashboard attestation is missing, invalid or already used."))
  assert.ok(preflight.body.blockers.includes("The target URL does not exactly match the selected alumnus's stored LinkedIn identity."))
  return preflight.body
}

async function brightTrialContract(origin, adminCookie, pcomCookie) {
  const post = (cookie, body) => http("/api/admin/bright-data", { origin, cookie, method: "POST", body })
  assert.equal((await post(undefined, brightTrialBody)).status, 401)
  assert.equal((await post(pcomCookie, brightTrialBody)).status, 403)
  const missingConfirmation = await post(adminCookie, { ...brightTrialBody, confirmed: false })
  assert.deepEqual({ status: missingConfirmation.status, body: missingConfirmation.body }, {
    status: 400, body: { error: "Explicit one-profile dashboard attestation and billing-uncertainty acknowledgement are required." },
  })
  const wrong = await post(adminCookie, { ...brightTrialBody, profileUrl: "https://www.linkedin.com/in/fictional-other-trial/" })
  assert.deepEqual({ status: wrong.status, body: wrong.body }, { status: 409,
    body: { error: "The isolated one-profile human-trial gate is unavailable for this exact target." } })
  const race = await Promise.all([post(adminCookie, brightTrialBody), post(adminCookie, brightTrialBody)])
  assert.deepEqual(race.map(item => item.status).sort(), [200, 409])
  const success = race.find(item => item.status === 200).body
  assert.equal(Number.isInteger(success.attestationId), true)
  assert.deepEqual({ ...success, attestationId: null }, { attested: true, attestationId: null, profileUrl: brightTrialUrl,
    datasetId: "fictional-trial-dataset", entitlementBasis: "HUMAN_ATTESTED_PROVIDER_UNVERIFIED",
    confirmationStatus: "AWAITING_SEPARATE_TRIGGER_APPROVAL", providerCallMade: false })
  const replay = await post(adminCookie, brightTrialBody)
  assert.deepEqual({ status: replay.status, body: replay.body }, { status: 409,
    body: { error: "The one-time dashboard attestation already exists; it cannot be issued twice." } })
  return { ...success, attestationId: null }
}

async function brightPurgeContract(origin, adminCookie, pcomCookie) {
  const path = "/api/admin/bright-data"
  const post = (cookie, body) => http(path, { origin, cookie, method: "POST", body })
  const action = { action: "purge_expired_raw_evidence", confirmed: true }
  assert.equal((await post(undefined, action)).status, 401)
  assert.equal((await post(pcomCookie, action)).status, 403)
  const denied = await post(adminCookie, { ...action, confirmed: false })
  assert.deepEqual({ status: denied.status, body: denied.body }, { status: 400, body: { error: "Explicit Admin confirmation is required to purge expired raw evidence." } })
  const purged = await post(adminCookie, action)
  assert.deepEqual({ status: purged.status, body: purged.body }, { status: 200, body: { purgedCount: 1, providerCallMade: false } })
  const replay = await post(adminCookie, action)
  assert.deepEqual({ status: replay.status, body: replay.body }, { status: 200, body: { purgedCount: 0, providerCallMade: false } })
  return { purged: purged.body, replay: replay.body }
}

async function professionalVerificationContract(origin, adminCookie, pcomCookie, alumnusId) {
  const path = "/api/professional-verification"
  assert.equal((await http(`${path}?alumnusId=${alumnusId}`, { origin })).status, 401)
  assert.equal((await http(`${path}?alumnusId=invalid`, { origin, cookie: pcomCookie })).status, 400)
  assert.equal((await http(`${path}?alumnusId=99999`, { origin, cookie: pcomCookie })).status, 404)
  const evidence = await http(`${path}?alumnusId=${alumnusId}`, { origin, cookie: pcomCookie })
  assert.equal(evidence.status, 200, JSON.stringify(evidence.body))
  assert.ok(evidence.body.evidence.stored)
  assert.ok(evidence.body.evidence.coresignal)
  assert.ok(evidence.body.evidence.lusha)
  const body = { action: "verify_professional_fields", alumnusId, fields: { location: "Possibly outdated" }, confirmed: true }
  assert.equal((await http(path, { origin, method: "POST", body })).status, 401)
  assert.equal((await http(path, { origin, method: "POST", body: { ...body, confirmed: false }, cookie: pcomCookie })).status, 400)
  const changed = await http(path, { origin, method: "POST", body, cookie: pcomCookie })
  assert.equal(changed.status, 200, JSON.stringify(changed.body))
  assert.deepEqual(changed.body.changedFields, ["location"])
  assert.equal(changed.body.verification.location, "Possibly outdated")
  assert.equal((await http(path, { origin, method: "POST", body, cookie: pcomCookie })).status, 409)
  const reviewed = await http(`${path}?alumnusId=${alumnusId}`, { origin, cookie: adminCookie })
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.body.evidence.stored.verification.location, "Possibly outdated")
  assert.ok(reviewed.body.evidence.recentChanges.some(item => item.field === "location_verification" && item.newValue === "Possibly outdated"))
  return { changedStatus: changed.status, changedFields: changed.body.changedFields, location: changed.body.verification.location,
    evidenceKeys: Object.keys(reviewed.body.evidence).sort() }
}

// Server startup only, before any acceptance check. A cold Vite/Cloudflare
// start measured 33-35 s on the Windows development laptop.
const appStartupMs = 120_000

// Stop before any request if a developer .env file reached the local Worker:
// its real provider keys would replace the fictional or blanked test values.
function assertNoDotEnvSecrets(log) {
  assert.doesNotMatch(log, /Using secrets defined in \.env/, "Disposable test server loaded developer .env secrets; aborting before any provider-capable request.")
}

async function waitForApp(child) {
  const until = Date.now() + appStartupMs
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Local app exited before readiness: ${child.exitCode}`)
    try { if ((await http("/api/directory")).status === 401) return } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error("Local Step 3C app did not become ready")
}

test("actual PostgreSQL HTTP reads and Admin programme transaction use one disposable local database", async t => {
  try { await access(pgExecutable("initdb")) } catch { return t.skip("PostgreSQL 17 test binaries are unavailable") }
  await portAvailable(55433)
  await portAvailable(3103)
  const temporary = await mkdtemp(httpTemporaryPrefix("cn-step3c-postgres"))
  const dataDir = join(temporary, "cluster")
  const socketDir = join(temporary, "socket")
  const cluster = clusterSettings(socketDir, { port: 55433, tcp: true })
  let started = false
  let child
  let pool
  let authVite
  let intelligenceMock
  const intelligenceRequests = []
  let childLog = ""
  try {
    await mkdir(socketDir)
    await command("initdb", ["-A", "trust", "--locale=C", "-U", role, "-D", dataDir, "--no-instructions"])
    await appendFile(join(dataDir, "postgresql.conf"), cluster.conf)
    await command("pg_ctl", ["-D", dataDir, "-l", join(temporary, "postgres.log"), "-w", "start"])
    started = true
    await command("createdb", ["-h", cluster.host, "-p", String(cluster.port), "-U", role, database])
    await command("psql", ["-h", cluster.host, "-p", String(cluster.port), "-U", role, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", join(root, "drizzle-postgres/0000_cynical_dexter_bennett.sql")])
    pool = new pg.Pool({ host: "127.0.0.1", port: 55433, user: role, database, max: 2 })
    await pool.query("INSERT INTO application_users(id,external_identity,display_name,email,role,enabled) VALUES (1,'local-development-admin','Local Development Admin','local.admin@example.test','ADMIN',true),(2,'local-development-pcom','Local Development PCOM','local.pcom@example.test','PCOM',true),(3,'fictional-developer','Fictional Developer','developer@example.test','DEVELOPER',true)")
    await pool.query("INSERT INTO application_identities(id,application_user_id,provider,provider_subject_id,verified_email,email_verified) VALUES (1,1,'chatgpt','local-development-admin','local.admin@example.test',true),(2,2,'chatgpt','local-development-pcom','local.pcom@example.test',true),(3,3,'chatgpt','fictional-developer','developer@example.test',true)")
    await pool.query("SELECT setval(pg_get_serial_sequence('application_users','id'), (SELECT max(id) FROM application_users))")
    await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location,intake_status,email) VALUES ('step3c:ada','Ada Demo-Only','AD',2020,2020,'PGP','Example Co','Director','Finance','Director','Mumbai','VERIFIED','ada@example.test'),('step3c:bea','Bea Demo-Only','BD',2021,2021,'PGP','Not recorded','Analyst','Finance','Analyst/Junior','Delhi','VERIFIED','bea@example.test')")
    await pool.query("INSERT INTO programme_options(code,name,active,sort_order,updated_by) VALUES ('PGP','Post Graduate Programme',true,10,'Fixture')")
    await pool.query(intakeFixtureSql)
    await pool.query(discoveryEvidenceFixtureSql)
    await pool.query(opportunityFixtureSql)
    await pool.query(engagementFixtureSql(1))
    await pool.query(brightFixtureSql)
    await pool.query(webhookOverviewFixtureSql(1))

    await portAvailable(3105)
    intelligenceMock = createHttpServer((request, response) => {
      intelligenceRequests.push({ method: request.method, path: request.url, authorized: request.headers.authorization === `Bearer ${serviceSecret}` })
      let result = { error: "Unexpected local intelligence request." }
      let status = 404
      if (request.method === "POST" && request.url === "/v1/alumni/resolve") {
        result = { status: "UNMAPPED", sourceId: "cn:1", intelligenceAlumniId: null, suggestedIntelligenceAlumniId: null, reason: "Fictional local mock" }; status = 200
      } else if (request.method === "POST" && request.url === "/v1/alumni/enroll") {
        result = { status: "ENROLLED", sourceId: "cn:1", intelligenceAlumniId: "fictional-intelligence-1", reason: "Fictional local mock" }; status = 200
      } else if (request.method === "GET" && request.url === "/v1/alumni/fictional-intelligence-1/summary") {
        result = { alumniId: "fictional-intelligence-1", sourceId: "cn:1", fullName: "Ada Demo-Only", linkedinUrlStatus: "KNOWN", identityStatus: "MAPPED", lastBrightAttempt: null, lastSocaiCheck: null, latestEvidence: [], pendingReviewCount: 0, refreshEligible: true, discoveryEligible: false, canonical: null }; status = 200
      } else if (request.method === "GET" && request.url === "/v1/refresh/jobs") {
        result = { jobs: [mockPolicy] }; status = 200
      } else if (request.method === "POST" && request.url === "/v1/refresh/jobs") {
        result = { jobId: mockPolicyId }; status = 200
      } else if (request.method === "GET" && request.url === `/v1/refresh/jobs/${mockPolicyId}`) {
        result = mockPolicy; status = 200
      } else if (request.method === "POST" && request.url === `/v1/refresh/jobs/${mockPolicyId}/reconcile`) {
        result = { recorded: true }; status = 200
      }
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(result))
    })
    await new Promise(resolve => intelligenceMock.listen(3105, "127.0.0.1", resolve))

    const environment = { ...process.env, NODE_ENV: "development", CN_DB_BACKEND: "postgres", CN_PG_LOCAL_TEST_ENABLED: "true", CN_PG_LOCAL_TEST_SOCKET: socketDir, LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", AUTH_SESSION_SECRET: secret, INTELLIGENCE_SERVICE_SECRET: serviceSecret, INTELLIGENCE_SERVICE_URL: "http://127.0.0.1:3105", CORESIGNAL_API_KEY: "", CORESIGNAL_LIVE_ENABLED: "false", CORESIGNAL_SEARCH_ENABLED: "false", CORESIGNAL_COLLECT_ENABLED: "true", CORESIGNAL_COLLECT_ENTITLEMENT: "confirmed", CORESIGNAL_COLLECT_MOCK_TRANSPORT: "true", LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1", CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", CORESIGNAL_WEBHOOK_RECEIVE_ENABLED: "true", CORESIGNAL_WEBHOOK_CALLBACK_SECRET: webhookSecret, LUSHA_LIVE_ENABLED: "false", LUSHA_API_KEY: "", BRIGHTDATA_LIVE_ENABLED: "true", BRIGHTDATA_API_TOKEN: "fictional-never-send", BRIGHTDATA_DATASET_ID: "fictional-trial-dataset", BRIGHTDATA_HUMAN_TRIAL_ENABLED: "true", BRIGHTDATA_HUMAN_TRIAL_TARGET: brightTrialUrl, BRIGHTDATA_MOCK_TRANSPORT: "false", BRIGHTDATA_ACCESS_ENTITLEMENT: "unknown", BRIGHTDATA_APPLICATION_REQUEST_LIMIT: "5", LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "true", LOCAL_PROVIDER_LIVE_DEMO_HOST: "127.0.0.1", MAIL_MODE: "mock", MAIL_LIVE_ENABLED: "false", MAIL_PROVIDER: "gmail", GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "", GMAIL_REFRESH_TOKEN: "", APP_PUBLIC_URL: "http://localhost:3103", APP_BASE_PATH: "/", NEXT_PUBLIC_APP_PUBLIC_URL: "http://localhost:3103", NEXT_PUBLIC_APP_BASE_PATH: "/", WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" }
    delete environment.DATABASE_URL
    delete environment.DATABASE_URL_UNPOOLED
    environment.LOCAL_DEV_D1_PERSIST_PATH = temporary
    child = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "3103", "--strictPort"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.on("data", data => { childLog = (childLog + data.toString()).slice(-4000) })
    child.stderr.on("data", data => { childLog = (childLog + data.toString()).slice(-4000) })
    await waitForApp(child)
    assertNoDotEnvSecrets(childLog)

    const admin = await http("/auth/local/start?intent=admin")
    const pcom = await http("/auth/local/start?intent=pcom")
    assert.equal(admin.status, 302)
    assert.equal(pcom.status, 302)
    assert.match(admin.cookie, /^corporate_network_session=/)
    assert.match(pcom.cookie, /^corporate_network_session=/)

    process.env.AUTH_SESSION_SECRET = secret
    authVite = await createViteServer({ appType: "custom", configFile: false, root, optimizeDeps: { noDiscovery: true }, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } })
    const auth = await authVite.ssrLoadModule("/lib/auth-session.ts")
    const developer = `corporate_network_session=${await auth.createAppSessionToken({ applicationUserId: 3, applicationIdentityId: 3, provider: "chatgpt" })}`

    if (process.env.CN_PG_STRESS_DIAGNOSTIC === "true") {
      const measure = async (label, count, path = "/api/admin", concurrent = true) => {
        const startedAt = Date.now()
        const request = async index => {
          const before = Date.now()
          try {
            const target = typeof path === "function" ? path(index) : path
            const result = await http(target, { cookie: admin.cookie, timeoutMs: 12_000 })
            return { status: result.status, ms: Date.now() - before }
          } catch (error) {
            return { status: "transport_error", ms: Date.now() - before, error: error instanceof Error ? error.name : "unknown" }
          }
        }
        const results = concurrent
          ? await Promise.all(Array.from({ length: count }, (_, index) => request(index)))
          : await Array.from({ length: count }).reduce(async (prior, _, index) => [...await prior, await request(index)], Promise.resolve([]))
        const sorted = results.map(result => result.ms).sort((a, b) => a - b)
        const activity = (await pool.query("SELECT state, count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() GROUP BY state ORDER BY state")).rows
        const summary = { label, count, statuses: results.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] ?? 0) + 1 }), {}), totalMs: Date.now() - startedAt, p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1], maxMs: sorted.at(-1), activity }
        console.log("CN_PG_STRESS", JSON.stringify(summary))
        return summary
      }
      const verify = async (label, count, path, concurrent) => {
        const result = await measure(label, count, path, concurrent)
        assert.deepEqual(result.statuses, { 200: count }, `${label}: ${JSON.stringify(result)}`)
        assert.deepEqual(result.activity, [{ state: "active", count: 1 }], `${label}: leaked Worker PostgreSQL sessions`)
      }
      await verify("cold", 1)
      await verify("admin_5", 5)
      await verify("recovery_5", 1)
      await verify("admin_10", 10)
      await verify("recovery_10", 1)
      await verify("admin_20", 20)
      await verify("recovery_20", 1)
      for (let burst = 1; burst <= 3; burst++) {
        await verify(`repeat_10_${burst}`, 10)
        await verify(`repeat_recovery_${burst}`, 1)
      }
      await verify("directory_10", 10, "/api/directory")
      await verify("admin_sequential_10", 10, "/api/admin", false)
      await verify("admin_directory_10", 10, index => index % 2 ? "/api/directory" : "/api/admin")
      assert.equal((await http("/api/admin")).status, 401)
      assert.equal((await http("/api/admin", { cookie: pcom.cookie })).status, 403)
      console.log("CN_PG_STRESS", JSON.stringify({ label: "auth_permission", statuses: { 401: 1, 403: 1 } }))
      return
    }

    await t.test("four GET routes enforce sessions and preserve returned fields", async () => {
      for (const path of ["/api/directory", "/api/alumni-collection?page=1&pageSize=10", "/api/alumni/1", "/api/workspace"]) assert.equal((await http(path)).status, 401)
      for (const cookie of [admin.cookie, pcom.cookie]) {
        const directory = await http("/api/directory?sort=name", { cookie })
        assert.equal(directory.status, 200)
        assert.deepEqual(directory.body.items.map(item => item.name), ["Ada Demo-Only", "Bea Demo-Only"])
        assert.equal(directory.body.total, 2)
        assert.equal(typeof directory.body.items[0].graduationYear, "number")
        const collection = await http("/api/alumni-collection?page=1&pageSize=10&sort=name", { cookie })
        assert.equal(collection.status, 200)
        assert.equal(collection.body.total, 2)
        assert.equal(collection.body.items[0].email, "ada@example.test")
        const profile = await http("/api/alumni/1", { cookie })
        assert.equal(profile.status, 200)
        assert.equal(profile.body.alumnus.name, "Ada Demo-Only")
        const workspace = await http("/api/workspace?includeAlumni=true", { cookie })
        assert.equal(workspace.status, 200)
        assert.equal(workspace.body.alumniCount, 2)
        assert.equal(workspace.body.access.role, cookie === admin.cookie ? "ADMIN" : "PCOM")
      }
      assert.equal((await http("/api/alumni/99999", { cookie: admin.cookie })).status, 404)
      const masked = await http("/api/alumni/1", { cookie: developer })
      assert.equal(masked.status, 200)
      assert.notEqual(masked.body.alumnus.email, "ada@example.test")
      const developerCollection = await http("/api/alumni-collection?page=1&pageSize=10&sort=name", { cookie: developer })
      assert.equal(developerCollection.status, 200, JSON.stringify(developerCollection.body))
      assert.notEqual(developerCollection.body.items[0].email, "ada@example.test")
    })

    await t.test("stored Discovery summary and pending view select PostgreSQL history without provider calls", async () => {
      assert.equal((await http("/api/discovery")).status, 401)
      assert.equal((await http("/api/discovery?searchId=bad", { cookie: pcom.cookie })).status, 400)
      assert.equal((await http("/api/discovery?searchId=99999", { cookie: pcom.cookie })).status, 404)
      const summary = await http("/api/discovery", { cookie: pcom.cookie })
      assert.equal(summary.status, 200, JSON.stringify(summary.body))
      assert.ok(summary.body.searches.some(item => item.id === intakeSearchId))
      const pending = await http(`/api/discovery?view=pending&searchId=${intakeSearchId}`, { cookie: pcom.cookie })
      assert.equal(pending.status, 200, JSON.stringify(pending.body))
      assert.equal(pending.body.activeSearch.searchId, intakeSearchId)
      const result = pending.body.results.find(item => item.id === intakeResultId)
      assert.equal(result?.providerIntegrity, "consistent")
      assert.equal(result?.humanEvidenceAvailable, true)
      assert.equal(result?.reviewStatus, "Pending review")
      assert.equal(intelligenceRequests.length, 0)
    })
    await t.test("Discovery evidence recording preserves PCOM gates, replay, revisions, audit and rollback", async () => {
      const post = (cookie, body) => http("/api/discovery", { cookie, method: "POST", body })
      const body = evidenceBody(discoveryEvidenceResultId)
      assert.equal((await post(undefined, body)).status, 401)
      assert.equal((await post(developer, body)).status, 403)
      assert.equal((await post(pcom.cookie, { action: "record_evidence", resultId: 0 })).status, 400)
      assert.equal((await post(pcom.cookie, { ...body, resultId: 99999 })).status, 409)
      const invalid = await post(pcom.cookie, { ...body, observation: { ...body.observation, sourceType: "BAD_SOURCE" } })
      postgresDiscoveryEvidenceInvalidSnapshot = invalid
      assert.deepEqual(invalid, { status: 500, body: { error: "Choose an evidence source type." }, cookie: "", replayed: null })
      const saved = await post(pcom.cookie, body)
      assert.equal(saved.status, 201, JSON.stringify(saved.body))
      assert.equal(saved.body.evidence.reviewerDecision, "SUPPORTS")
      assert.equal(saved.body.evidence.sourceProvenance, "HUMAN_ENTERED")
      const replay = await post(pcom.cookie, body)
      assert.equal(replay.status, 200)
      assert.equal(replay.body.duplicate, true)
      assert.equal(replay.body.evidence.id, saved.body.evidence.id)
      const shortRevision = evidenceBody(discoveryEvidenceResultId, "UNVERIFIED", "Changed review after.")
      assert.equal((await post(pcom.cookie, shortRevision)).status, 409)
      const revision = evidenceBody(discoveryEvidenceResultId, "UNVERIFIED", "Fictional reviewer explains the changed conclusion in detail.")
      const revised = await post(pcom.cookie, revision)
      assert.equal(revised.status, 201, JSON.stringify(revised.body))
      assert.equal(revised.body.evidence.reviewerDecision, "INSUFFICIENT")
      assert.equal(revised.body.evidence.sourceProvenance, `HUMAN_ENTERED_REVIEW_REVISION_OF:${saved.body.evidence.id}`)
      const raceBody = evidenceBody(discoveryEvidenceResultId + 1)
      const race = await Promise.all([post(pcom.cookie, raceBody), post(pcom.cookie, raceBody)])
      assert.deepEqual(race.map(item => item.status).sort(), [200, 201])
      const counts = await pool.query("SELECT (SELECT count(*)::integer FROM external_discovery_candidate_evidence WHERE result_id=99501) AS evidence, (SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_evidence_recorded' AND entity_id='99501') AS audits, (SELECT count(*)::integer FROM external_discovery_candidate_evidence WHERE result_id=99502) AS race_evidence, (SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_evidence_recorded' AND entity_id='99502') AS race_audits")
      assert.deepEqual(counts.rows[0], { evidence: 2, audits: 2, race_evidence: 1, race_audits: 1 })
      await pool.query("CREATE FUNCTION reject_discovery_evidence_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'external_candidate_evidence_recorded' AND NEW.entity_id = '99503' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_discovery_evidence_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_discovery_evidence_audit()")
      try {
        const failed = await post(pcom.cookie, evidenceBody(discoveryEvidenceResultId + 2))
        assert.equal(failed.status, 500)
        assert.deepEqual(failed.body, { error: "Database operation failed." })
        const rollback = await pool.query("SELECT count(*)::integer AS count FROM external_discovery_candidate_evidence WHERE result_id=99503")
        assert.equal(rollback.rows[0].count, 0)
      } finally {
        await pool.query("DROP TRIGGER reject_discovery_evidence_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_discovery_evidence_audit()")
      }
      postgresDiscoveryEvidenceSnapshot = { status: saved.status, decision: saved.body.evidence.reviewerDecision, provenance: saved.body.evidence.sourceProvenance, replay: replay.body.duplicate, revision: revised.body.evidence.reviewerDecision }
    })
    await t.test("Discovery coverage plan reads selected PostgreSQL history without provider work", async () => {
      const body = { action: "plan", filters: { company: "Fictional never searched" }, graduationYears: [2020, 2021] }
      assert.equal((await http("/api/discovery", { method: "POST", body })).status, 401)
      assert.equal((await http("/api/discovery", { cookie: developer, method: "POST", body })).status, 403)
      const planned = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body })
      assert.equal(planned.status, 200, JSON.stringify(planned.body))
      assert.equal(planned.body.providerCallMade, false)
      assert.equal(planned.body.applicationUnits, 0)
      assert.equal(planned.body.coverage.counts.neverSearched, 2)
      assert.equal(intelligenceRequests.length, 0)
      postgresDiscoveryPlanSnapshot = planned.body
    })
    await t.test("Discovery Search preflight reads PostgreSQL company mappings without a provider request", async () => {
      const body = { action: "regular_search_preflight", filters: { company: "Fictional unmapped company" }, limit: 1 }
      assert.equal((await http("/api/discovery", { method: "POST", body })).status, 401)
      assert.equal((await http("/api/discovery", { cookie: developer, method: "POST", body })).status, 403)
      assert.equal((await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: { ...body, filters: { graduationYear: "20XX" } } })).status, 400)
      const prepared = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body })
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body))
      assert.equal(prepared.body.allowed, true)
      assert.equal(prepared.body.providerCallMade, false)
      assert.equal(prepared.body.applicationUnits, 0)
      assert.equal(prepared.body.preparation.companyMapping, "Unverified exact-name fallback")
      assert.equal(intelligenceRequests.length, 0)
      postgresSearchPreflightSnapshot = prepared.body
    })
    await t.test("Corporate Opportunities GET retains filtered support and history reads", async () => {
      assert.equal((await http("/api/opportunities")).status, 401)
      assert.equal((await http("/api/opportunities?id=bad", { cookie: pcom.cookie })).status, 400)
      assert.equal((await http("/api/opportunities?stage=BAD", { cookie: pcom.cookie })).status, 400)
      const listed = await http("/api/opportunities?company=fictional%20opportunity%20co", { cookie: pcom.cookie })
      assert.equal(listed.status, 200, JSON.stringify(listed.body))
      assert.equal(listed.body.total, 1)
      assert.equal(listed.body.opportunities[0].id, 99100)
      assert.equal(listed.body.opportunities[0].owner.displayName, "Local Development Admin")
      assert.equal(listed.body.opportunities[0].history[0].summary, "Fictional creation history")
      assert.ok(listed.body.companies.includes("Fictional Opportunity Co"))
      assert.ok(listed.body.stages.includes("IDENTIFIED"))
      assert.ok(listed.body.summary.total >= 1)
      const empty = await http("/api/opportunities?search=nonexistent-fixture", { cookie: pcom.cookie })
      assert.equal(empty.status, 200)
      assert.equal(empty.body.total, 0)
      assert.deepEqual(empty.body.opportunities, [])
    })
    await t.test("Engagements workspace GET reads selected PostgreSQL event and owner state", async () => {
      assert.equal((await http("/api/engagements")).status, 401)
      const workspace = await http("/api/engagements", { cookie: pcom.cookie })
      assert.equal(workspace.status, 200, JSON.stringify(workspace.body))
      const event = workspace.body.events.find(item => item.id === 99200)
      assert.equal(event?.eventTitle, "Fictional committee follow-up")
      assert.equal(event?.alumnus?.name, "Ada Demo-Only")
      assert.equal(event?.owner?.displayName, "Local Development PCOM")
      assert.equal(event?.preference, "Unknown")
      assert.deepEqual(event?.actions, [])
      assert.ok(workspace.body.assignees.some(item => item.displayName === "Local Development PCOM"))
    })

    await t.test("Directory filtering, empty results and pagination use PostgreSQL", async () => {
      const missing = await http(`/api/directory?filters=${encodeURIComponent(JSON.stringify({ company: "Missing current company" }))}`, { cookie: admin.cookie })
      assert.deepEqual(missing.body.items.map(item => item.name), ["Bea Demo-Only"])
      const empty = await http(`/api/directory?filters=${encodeURIComponent(JSON.stringify({ search: "No Such Alumnus" }))}`, { cookie: admin.cookie })
      assert.equal(empty.status, 200)
      assert.equal(empty.body.total, 0)
      assert.deepEqual(empty.body.items, [])
      await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location) SELECT 'step3c:extra:' || n, 'Fictional ' || lpad(n::text,2,'0'), 'F', 2022, 2022, 'PGP', 'Example Co', 'Analyst', 'Finance', 'Analyst/Junior', 'Mumbai' FROM generate_series(1,9) AS n")
      const second = await http("/api/directory?sort=name&page=2&pageSize=10", { cookie: admin.cookie })
      assert.equal(second.status, 200)
      assert.equal(second.body.total, 11)
      assert.equal(second.body.pageCount, 2)
      assert.deepEqual(second.body.items.map(item => item.name), ["Fictional 09"])
    })

    const add = (cookie, code, name = code) => http("/api/admin", { cookie, method: "POST", body: { action: "add_programme", code, name } })
    await t.test("Admin summary and lifecycle reads retain authorization, shape, filters and concurrent behavior", async () => {
      for (const path of ["/api/admin", "/api/admin/lifecycle"]) {
        assert.equal((await http(path)).status, 401)
        assert.equal((await http(path, { cookie: pcom.cookie })).status, 403)
      }
      await pool.query("INSERT INTO alumni_data_lifecycle(alumnus_id,status,notes,updated_by) VALUES (1,'Archived','Fictional lifecycle note','Fixture')")
      await pool.query("INSERT INTO provider_settings(provider,monthly_credit_limit) VALUES ('coresignal',25)")
      await pool.query("INSERT INTO security_audit_events(actor_user_id,action,entity_type,entity_id,metadata_json) VALUES (1,'fictional_admin_review','alumnus','1','{\"review\":\"fixture\"}')")
      const summary = await http("/api/admin", { cookie: admin.cookie })
      assert.equal(summary.status, 200, JSON.stringify(summary.body))
      assert.deepEqual(Object.keys(summary.body).sort(), ["audit", "lifecycle", "operationalReadiness", "programmeOptions", "providerCompanyAliases", "providerCompanyMappings", "providerLimits", "users"].sort())
      assert.equal(summary.body.users.length, 3)
      assert.deepEqual(summary.body.users.find(item => item.id === 1).identities.map(item => item.provider), ["chatgpt"])
      assert.equal(summary.body.lifecycle[0].status, "Archived")
      assert.equal(summary.body.providerLimits[0].monthlyCreditLimit, 25)
      assert.equal(summary.body.programmeOptions[0].code, "PGP")
      assert.ok(summary.body.audit.some(item => item.action === "fictional_admin_review" && JSON.parse(item.metadataJson).review === "fixture"))
      assert.ok(summary.body.operationalReadiness.mail)
      const lifecycle = await http("/api/admin/lifecycle?pageSize=10&lifecycle=Archived", { cookie: admin.cookie })
      assert.equal(lifecycle.status, 200, JSON.stringify(lifecycle.body))
      assert.deepEqual(lifecycle.body.items.map(item => item.name), ["Ada Demo-Only"])
      assert.equal(lifecycle.body.total, 1)
      assert.deepEqual(lifecycle.body.programmes, ["PGP"])
      const empty = await http("/api/admin/lifecycle?search=absent-fixture", { cookie: admin.cookie })
      assert.deepEqual({ status: empty.status, items: empty.body.items, total: empty.body.total, pageCount: empty.body.pageCount }, { status: 200, items: [], total: 0, pageCount: 1 })
      const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) => http(index % 2 ? "/api/admin/lifecycle" : "/api/admin", { cookie: admin.cookie })))
      assert.ok(concurrent.every(item => item.status === 200), JSON.stringify(concurrent.map(item => item.status)))
    })
    await t.test("Provider Credits GET preserves Admin authorization and read-only accounting", async () => {
      const empty = await http("/api/admin/provider-credits", { cookie: admin.cookie })
      assert.equal(empty.status, 200)
      assert.ok(empty.body.providers.every(item => item.state === "unavailable" && item.history.length === 0))
      await pool.query(creditFixtureSql)
      const path = "/api/admin/provider-credits"
      assert.equal((await http(path)).status, 401)
      assert.equal((await http(path, { cookie: pcom.cookie })).status, 403)
      const before = (await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_credit_balance_observed'")).rows[0].n
      const response = await http(path, { cookie: admin.cookie })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      postgresCreditSnapshot = response.body
      assert.deepEqual(postgresCreditSnapshot.internalControls.map(item => ({ provider: item.provider, used: item.used, limit: item.limit })), [
        { provider: "coresignal", used: 44, limit: 50 }, { provider: "lusha", used: 9, limit: 20 },
      ])
      assert.deepEqual(postgresCreditSnapshot.providers.map(item => item.provider), ["coresignal", "brightdata", "lusha"])
      assert.equal(postgresCreditSnapshot.providers[0].observations.length, 2)
      assert.equal(postgresCreditSnapshot.providers[0].history.length, 3)
      assert.deepEqual(postgresCreditSnapshot.providers[0].history.filter(item => item.category === "search").map(item => item.available), [80, 100])
      assert.equal(postgresCreditSnapshot.providers[0].lastSuccessfulOperationAt, creditOffsetBefore)
      assert.equal((await http("/api/admin/coresignal-collect")).status, 401)
      assert.equal((await http("/api/admin/coresignal-collect", { cookie: pcom.cookie })).status, 403)
      const collectOverview = await http("/api/admin/coresignal-collect", { cookie: admin.cookie })
      assert.equal(collectOverview.status, 200, JSON.stringify(collectOverview.body))
      assert.equal(collectOverview.body.runtime.applicationUnitsRemaining, 0)
      postgresCollectOverviewSnapshot = collectOverview.body
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_credit_balance_observed'")).rows[0].n, before)
      const observation = { ...creditObservation("lusha", "general", 7, "credits"), observedAt: manualCreditObserved, sourceDetail: "Fictional manual attestation" }
      assert.equal((await http(path, { method: "POST", body: { action: "attest", confirmed: true, observation } })).status, 401)
      assert.equal((await http(path, { cookie: pcom.cookie, method: "POST", body: { action: "attest", confirmed: true, observation } })).status, 403)
      assert.equal((await http(path, { cookie: admin.cookie, method: "POST", body: { action: "attest", confirmed: false, observation } })).status, 400)
      assert.equal((await http(path, { cookie: admin.cookie, method: "POST", body: { action: "attest", confirmed: true, observation: { ...observation, available: -1 } } })).status, 400)
      assert.equal((await http(path, { cookie: admin.cookie, method: "POST", body: { action: "refresh", provider: "lusha" } })).status, 501)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_credit_balance_observed'")).rows[0].n, before)
      const attested = await http(path, { cookie: admin.cookie, method: "POST", body: { action: "attest", confirmed: true, observation } })
      assert.equal(attested.status, 200, JSON.stringify(attested.body))
      postgresCreditAttestSnapshot = attested.body
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_credit_balance_observed'")).rows[0].n, before + 1)
      assert.deepEqual(attested.body.internalControls, response.body.internalControls)
      await pool.query("ALTER TABLE provider_response_history RENAME TO step3f_history_unavailable")
      try {
        const failure = await http(path, { cookie: admin.cookie })
        assert.deepEqual({ status: failure.status, body: failure.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.doesNotMatch(JSON.stringify(failure.body), /select|params:|provider_response_history|postgresql:/i)
      } finally {
        await pool.query("ALTER TABLE step3f_history_unavailable RENAME TO provider_response_history")
      }
    })
    await t.test("Enrichment status GET preserves provider usage, review visibility and default settings", async () => {
      const path = "/api/enrichment"
      assert.equal((await http(path)).status, 401)
      const adminRead = await http(path, { cookie: admin.cookie })
      assert.equal(adminRead.status, 200, JSON.stringify(adminRead.body))
      assert.equal(adminRead.body.usage.coresignal.limit, 50)
      assert.equal(adminRead.body.usage.lusha.limit, 20)
      assert.ok(adminRead.body.history.some(item => item.provider === "coresignal"))
      postgresEnrichmentUsageSnapshot = adminRead.body.usage
      const pcomRead = await http(path, { cookie: pcom.cookie })
      assert.equal(pcomRead.status, 200)
      assert.equal(pcomRead.body.historyRestricted, true)
      assert.deepEqual(pcomRead.body.history, [])
      const settings = await pool.query("SELECT provider,monthly_credit_limit FROM provider_settings WHERE provider IN ('coresignal','lusha') ORDER BY provider")
      assert.deepEqual(settings.rows, [{ provider: "coresignal", monthly_credit_limit: 50 }, { provider: "lusha", monthly_credit_limit: 20 }])
      await pool.query("DELETE FROM provider_settings WHERE provider IN ('coresignal','lusha')")
      const concurrent = await Promise.all([1, 2].map(() => http(path, { cookie: admin.cookie })))
      assert.ok(concurrent.every(item => item.status === 200), JSON.stringify(concurrent))
      assert.ok(concurrent.every(item => item.body.usage.coresignal.limit === 25 && item.body.usage.lusha.limit === 100))
      const defaults = await pool.query("SELECT provider,monthly_credit_limit FROM provider_settings WHERE provider IN ('coresignal','lusha') ORDER BY provider")
      assert.deepEqual(defaults.rows, [{ provider: "coresignal", monthly_credit_limit: 25 }, { provider: "lusha", monthly_credit_limit: 100 }])
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=CASE provider WHEN 'coresignal' THEN 50 ELSE 20 END WHERE provider IN ('coresignal','lusha')")
    })
    await t.test("Bright Data Admin GET reads sanitized attempts and application capacity", async () => {
      const path = "/api/admin/bright-data"
      assert.equal((await http(path)).status, 401)
      assert.equal((await http(path, { cookie: pcom.cookie })).status, 403)
      const response = await http(path, { cookie: admin.cookie })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      assert.equal(response.body.runtime.applicationBudget.used, 1)
      const attempt = response.body.attempts.find(item => item.id === 99300)
      assert.equal(attempt?.rawEvidenceStored, true)
      assert.equal(attempt?.identityUrlStatus, "MATCH")
      assert.equal(attempt?.datasetId, "configured")
      assert.equal(attempt?.rawSha256, "fictional-sha256")
      assert.equal(attempt?.evidenceJson?.unavailable, undefined)
      assert.doesNotMatch(JSON.stringify(response.body), /rawJson|fictional-dataset/)
    })
    await t.test("Bright Data preflight reads selected PostgreSQL capacity and exact target without a claim", async () => {
      const before = (await pool.query("SELECT count(*)::integer AS n FROM provider_collection_attempts")).rows[0].n
      const beforeHistory = (await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE provider='brightdata'")).rows[0].n
      postgresBrightPreflightSnapshot = await brightPreflightContract(base, admin.cookie, pcom.cookie, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_collection_attempts")).rows[0].n, before)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE provider='brightdata'")).rows[0].n, beforeHistory)
      await pool.query("ALTER TABLE provider_collection_attempts RENAME TO fictional_bright_attempts_unavailable")
      try {
        const failed = await http("/api/admin/bright-data", { cookie: admin.cookie, method: "POST", body: { action: "preflight", profileUrl: "https://www.linkedin.com/in/fictional-bright-read/" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      } finally {
        await pool.query("ALTER TABLE fictional_bright_attempts_unavailable RENAME TO provider_collection_attempts")
      }
    })
    await t.test("Bright Data one-time human trial attestation is local, fenced and audited", async () => {
      await pool.query("CREATE FUNCTION reject_bright_trial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='brightdata_local_human_trial_attested' THEN RAISE EXCEPTION 'fictional trial audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_bright_trial_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_bright_trial_audit()")
      try {
        const failed = await http("/api/admin/bright-data", { cookie: admin.cookie, method: "POST", body: brightTrialBody })
        assert.equal(failed.status, 500)
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE mutation_request_key='brightdata:local-human-trial:one-request'")).rows[0].n, 0)
      } finally {
        await pool.query("DROP TRIGGER reject_bright_trial_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_bright_trial_audit()")
      }
      postgresBrightTrialSnapshot = await brightTrialContract(base, admin.cookie, pcom.cookie)
      const rows = await pool.query("SELECT action,result,metadata_json FROM security_audit_events WHERE mutation_request_key='brightdata:local-human-trial:one-request'")
      assert.equal(rows.rows.length, 1)
      assert.equal(rows.rows[0].result, "human_attested_provider_unverified")
      assert.equal(JSON.parse(rows.rows[0].metadata_json).confirmationStatus, "AWAITING_SEPARATE_TRIGGER_APPROVAL")
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_collection_attempts WHERE request_key LIKE 'brightdata:human_trial:%'")).rows[0].n, 0)
    })
    await t.test("Bright Data expired raw evidence purge preserves Admin confirmation and atomic audit", async () => {
      await pool.query(brightPurgeFixtureSql)
      await pool.query("CREATE FUNCTION reject_bright_purge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='brightdata_raw_evidence_expired_purged' THEN RAISE EXCEPTION 'fictional purge audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_bright_purge_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_bright_purge_audit()")
      try {
        const failed = await http("/api/admin/bright-data", { cookie: admin.cookie, method: "POST", body: { action: "purge_expired_raw_evidence", confirmed: true } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM brightdata_snapshot_evidence WHERE attempt_id=99301")).rows[0].n, 1)
      } finally {
        await pool.query("DROP TRIGGER reject_bright_purge_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_bright_purge_audit()")
      }
      postgresBrightPurgeSnapshot = await brightPurgeContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM brightdata_snapshot_evidence WHERE attempt_id=99300) AS retained,(SELECT count(*)::integer FROM brightdata_snapshot_evidence WHERE attempt_id=99301) AS expired,(SELECT count(*)::integer FROM security_audit_events WHERE action='brightdata_raw_evidence_expired_purged') AS audits")
      assert.deepEqual(state.rows[0], { retained: 1, expired: 0, audits: 2 })
    })
    await t.test("webhook monitoring overview reads PostgreSQL plans and preserves PCOM redaction", async () => {
      const path = "/api/intelligence/webhooks"
      assert.equal((await http(path)).status, 401)
      assert.equal((await http(`${path}?page=bad`, { cookie: pcom.cookie })).status, 400)
      const adminRead = await http(path, { cookie: admin.cookie })
      assert.equal(adminRead.status, 200, JSON.stringify(adminRead.body))
      assert.equal(adminRead.body.plans.find(item => item.id === 99400)?.coveredCount, 1)
      assert.match(adminRead.body.plans.find(item => item.id === 99400)?.membershipJson, /994001/)
      assert.equal(adminRead.body.events.find(item => item.id === 99402)?.employeeId, "994001")
      const pcomRead = await http(path, { cookie: pcom.cookie })
      assert.equal(pcomRead.status, 200, JSON.stringify(pcomRead.body))
      assert.equal(pcomRead.body.plans.find(item => item.id === 99400)?.membershipJson, "[redacted]")
      assert.equal(pcomRead.body.events.find(item => item.id === 99402)?.employeeId, "[redacted]")
    })
    await t.test("webhook monitoring fixed-cohort preview reads PostgreSQL without a plan or provider request", async () => {
      const before = (await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_subscriptions")).rows[0].n
      postgresWebhookPreviewSnapshot = await webhookPreviewContract(base, admin.cookie, pcom.cookie, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_subscriptions")).rows[0].n, before)
      await pool.query("ALTER TABLE coresignal_webhook_identities RENAME TO fictional_webhook_identities_unavailable")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: pcom.cookie, method: "POST", body: { action: "preview", cohortType: "FIXED_IDS", ids: [1] } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      } finally {
        await pool.query("ALTER TABLE fictional_webhook_identities_unavailable RENAME TO coresignal_webhook_identities")
      }
    })
    await t.test("webhook notification review preserves Admin decision and atomic audit", async () => {
      await pool.query("CREATE FUNCTION reject_webhook_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_webhook_event_reviewed' THEN RAISE EXCEPTION 'fictional webhook audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_review_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_review_audit()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "review", subscriptionId: 99400, eventId: 99402, outcome: "IGNORED" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const unchanged = await pool.query("SELECT status FROM coresignal_webhook_events WHERE id=99402")
        assert.equal(unchanged.rows[0].status, "AWAITING_PROFILE_COLLECTION")
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_review_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_webhook_review_audit()")
      }
      postgresWebhookReviewSnapshot = await webhookReviewContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_webhook_event_reviewed' AND entity_id='99402') AS audits, (SELECT status FROM coresignal_webhook_events WHERE id=99402) AS status")
      assert.deepEqual(state.rows[0], { audits: 1, status: "IGNORED" })
    })
    await t.test("Admin query failure is redacted and never falls back to D1", async () => {
      await pool.query("ALTER TABLE provider_company_aliases RENAME TO step3e_aliases_unavailable")
      try {
        const failed = await http("/api/admin", { cookie: admin.cookie })
        assert.equal(failed.status, 500)
        assert.deepEqual(failed.body, { error: "Database operation failed." })
        assert.doesNotMatch(JSON.stringify(failed.body), /select|params:|provider_company_aliases|postgresql:|127\.0\.0\.1/i)
      } finally {
        await pool.query("ALTER TABLE step3e_aliases_unavailable RENAME TO provider_company_aliases")
      }
    })
    await t.test("Admin programme creation retains response, permissions and readback", async () => {
      assert.equal((await add(undefined, "NOAUTH")).status, 401)
      assert.equal((await add(pcom.cookie, "NOPE")).status, 403)
      assert.equal((await add(admin.cookie, "", "")).status, 400)
      const created = await add(admin.cookie, " mba ", "Fictional MBA")
      assert.equal(created.status, 201)
      assert.equal(created.body.programme.code, "MBA")
      assert.equal(created.body.programme.active, true)
      assert.equal((await add(admin.cookie, "MBA", "Duplicate")).status, 409)
      const workspace = await http("/api/workspace", { cookie: admin.cookie })
      assert.ok(workspace.body.programmeOptions.some(item => item.code === "MBA" && item.name === "Fictional MBA"))
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='programme_added' AND metadata_json LIKE '%MBA%' ")).rows[0].n, 1)
    })
    await t.test("programme rename/status preserve validation, concurrency and atomic audit", async () => {
      const update = (cookie, body) => http("/api/admin", { cookie, method: "POST", body })
      const rename = { action: "rename_programme", programmeId: 1, name: "Fictional PGP Renamed" }
      assert.equal((await update(undefined, rename)).status, 401)
      assert.equal((await update(pcom.cookie, rename)).status, 403)
      assert.deepEqual({ status: (await update(admin.cookie, { ...rename, programmeId: 99999 })).status, body: (await update(admin.cookie, { ...rename, programmeId: 99999 })).body }, { status: 404, body: { error: "Programme option not found." } })
      assert.deepEqual({ status: (await update(admin.cookie, { ...rename, name: "" })).status, body: (await update(admin.cookie, { ...rename, name: "" })).body }, { status: 400, body: { error: "Enter a programme name." } })
      const changed = await update(admin.cookie, rename)
      assert.equal(changed.status, 200, JSON.stringify(changed.body))
      assert.equal(changed.body.programme.name, rename.name)
      assert.equal(changed.body.programme.code, "PGP")
      const deactivate = { action: "set_programme_status", programmeId: 1, active: false }
      assert.deepEqual({ status: (await update(admin.cookie, deactivate)).status, body: (await update(admin.cookie, deactivate)).body }, { status: 409, body: { error: "Type DEACTIVATE PROGRAMME 1 to confirm." } })
      const disabled = await update(admin.cookie, { ...deactivate, confirmation: "DEACTIVATE PROGRAMME 1" })
      assert.equal(disabled.status, 200)
      assert.equal(disabled.body.programme.active, false)
      const enabled = await update(admin.cookie, { ...deactivate, active: true })
      assert.equal(enabled.status, 200)
      assert.equal(enabled.body.programme.active, true)
      const repeated = await update(admin.cookie, { ...deactivate, active: true })
      assert.equal(repeated.status, 200)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE entity_type='programme_option' AND entity_id='1' AND action IN ('programme_renamed','programme_activated','programme_deactivated')")).rows[0].n, 4)
      const race = await Promise.all([update(admin.cookie, { ...rename, name: "Concurrent Alpha" }), update(admin.cookie, { ...rename, name: "Concurrent Beta" })])
      assert.deepEqual(race.map(item => item.status), [200, 200])
      assert.ok(["Concurrent Alpha", "Concurrent Beta"].includes((await pool.query("SELECT name FROM programme_options WHERE id=1")).rows[0].name))
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE entity_type='programme_option' AND entity_id='1' AND action='programme_renamed'")).rows[0].n, 3)
      await pool.query("CREATE FUNCTION step3f_reject_programme_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='programme_renamed' AND NEW.metadata_json LIKE '%Rollback Name%' THEN RAISE EXCEPTION 'fictional programme audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3f_reject_programme_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION step3f_reject_programme_audit()")
      const prior = (await pool.query("SELECT name FROM programme_options WHERE id=1")).rows[0].name
      const failed = await update(admin.cookie, { ...rename, name: "Rollback Name" })
      assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      assert.equal((await pool.query("SELECT name FROM programme_options WHERE id=1")).rows[0].name, prior)
      await pool.query("DROP TRIGGER step3f_reject_programme_audit ON security_audit_events")
      await pool.query("DROP FUNCTION step3f_reject_programme_audit()")
    })

    await t.test("simultaneous duplicate submissions retain one row and audit", async () => {
      const results = await Promise.all([add(admin.cookie, "RACE", "Fictional Race"), add(admin.cookie, "RACE", "Fictional Race")])
      assert.deepEqual(results.map(item => item.status).sort(), [201, 409])
      const counts = await pool.query("SELECT (SELECT count(*)::integer FROM programme_options WHERE code='RACE') AS programmes, (SELECT count(*)::integer FROM security_audit_events WHERE action='programme_added' AND metadata_json LIKE '%RACE%') AS audits")
      assert.deepEqual(counts.rows[0], { programmes: 1, audits: 1 })
    })

    await t.test("forced audit failure rolls back programme creation over HTTP", async () => {
      await pool.query("CREATE FUNCTION step3c_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'programme_added' AND NEW.metadata_json LIKE '%ROLLBACK%' THEN RAISE EXCEPTION 'fictional forced audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3c_reject_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION step3c_reject_audit()")
      const failed = await add(admin.cookie, "ROLLBACK", "Fictional Rollback")
      assert.equal(failed.status, 500)
      assert.equal(failed.body.error, "Database operation failed.")
      const counts = await pool.query("SELECT (SELECT count(*)::integer FROM programme_options WHERE code='ROLLBACK') AS programmes, (SELECT count(*)::integer FROM security_audit_events WHERE action='programme_added' AND metadata_json LIKE '%ROLLBACK%') AS audits")
      assert.deepEqual(counts.rows[0], { programmes: 0, audits: 0 })
      await pool.query("DROP TRIGGER step3c_reject_audit ON security_audit_events")
      await pool.query("DROP FUNCTION step3c_reject_audit()")
    })

    await t.test("local Admin user, lifecycle and mapping mutations preserve D1 contracts and audit", async () => {
      postgresAdminLocalSnapshot = await adminLocalContract(base, admin.cookie, pcom.cookie, 1)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM application_users WHERE email='fictional.member@iiml.ac.in' AND enabled=false) AS users, (SELECT count(*)::integer FROM security_audit_events WHERE action='user_authorized') AS audits, (SELECT count(*)::integer FROM provider_company_aliases WHERE normalized_alias='fictional mapping alias') AS aliases")
      assert.deepEqual(state.rows[0], { users: 1, audits: 1, aliases: 1 })
    })
    await t.test("Admin provider validations preserve permission, no-request outcomes and audited PostgreSQL state", async () => {
      const actions = ["validate_signals_entitlement", "validate_gmail_connectivity"]
      for (const action of actions) {
        assert.equal((await http("/api/admin", { method: "POST", body: { action } })).status, 401)
        assert.equal((await http("/api/admin", { cookie: pcom.cookie, method: "POST", body: { action } })).status, 403)
      }
      const signals = await http("/api/admin", { cookie: admin.cookie, method: "POST", body: { action: actions[0] } })
      const gmail = await http("/api/admin", { cookie: admin.cookie, method: "POST", body: { action: actions[1] } })
      assert.equal(signals.status, 200)
      assert.equal(gmail.status, 200)
      assert.deepEqual({ entitlement: signals.body.validation.entitlement, outcome: signals.body.validation.outcome, providerReportedCredits: signals.body.validation.providerReportedCredits }, { entitlement: "unknown", outcome: "key_missing", providerReportedCredits: null })
      assert.deepEqual({ status: gmail.body.validation.status, outcome: gmail.body.validation.outcome, scopeVerified: gmail.body.validation.scopeVerified }, { status: "failed", outcome: "configuration_missing", scopeVerified: null })
      const rows = (await pool.query("SELECT action,result,metadata_json FROM security_audit_events WHERE action IN ('lusha_signals_entitlement_validated','gmail_connectivity_validated') ORDER BY action")).rows
      assert.equal(rows.length, 2)
      assert.deepEqual(rows.map(row => [row.action, row.result]), [["gmail_connectivity_validated", "failed"], ["lusha_signals_entitlement_validated", "unknown"]])
      assert.equal(JSON.parse(rows[0].metadata_json).outcome, "configuration_missing")
      assert.equal(JSON.parse(rows[1].metadata_json).outcome, "key_missing")
      postgresAdminValidationSnapshot = { signals: { ...signals.body.validation, checkedAt: null }, gmail: { ...gmail.body.validation, checkedAt: null } }
    })
    await t.test("Lusha connection validation retains Admin gate and credential-free failure without D1 access", async () => {
      const body = { action: "validate_lusha" }
      assert.equal((await http("/api/enrichment", { method: "POST", body })).status, 401)
      assert.equal((await http("/api/enrichment", { cookie: pcom.cookie, method: "POST", body })).status, 403)
      const response = await http("/api/enrichment", { cookie: admin.cookie, method: "POST", body })
      assert.deepEqual({ status: response.status, body: response.body }, { status: 409, body: { error: "Lusha LIVE and its server-side API key must both be configured." } })
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='lusha_connection_validated'")).rows[0].n, 0)
    })
    await t.test("local Admin audit failure rolls back the user change", async () => {
      const userId = (await pool.query("SELECT id FROM application_users WHERE email='fictional.member@iiml.ac.in'")).rows[0].id
      await pool.query("CREATE FUNCTION step3_batch1_reject_admin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user_role_changed' THEN RAISE EXCEPTION 'fictional Admin audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3_batch1_reject_admin_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION step3_batch1_reject_admin_audit()")
      try {
        const failed = await http("/api/admin", { cookie: admin.cookie, method: "POST", body: { action: "change_role", userId, role: "PCOM" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const state = await pool.query("SELECT role, (SELECT count(*)::integer FROM security_audit_events WHERE action='user_role_changed' AND entity_id=$1) AS audits FROM application_users WHERE id=$2", [String(userId), userId])
        assert.deepEqual(state.rows[0], { role: "ADMIN", audits: 1 })
      } finally {
        await pool.query("DROP TRIGGER step3_batch1_reject_admin_audit ON security_audit_events")
        await pool.query("DROP FUNCTION step3_batch1_reject_admin_audit()")
      }
    })
    await t.test("Admin anonymization preserves confirmation, review gate, redaction and audit rollback", async () => {
      await pool.query(anonymizeFixtureSql)
      postgresAnonymizeSnapshot = await anonymizeContract(base, admin.cookie, pcom.cookie)
      const redacted = await pool.query(`SELECT a.name,a.email,a.phone,a.linkedin_url,a.coresignal_employee_id,
        p.general_contact_status,p.professional_engagement_status,p.birthday_engagement_status,l.status,
        (SELECT count(*)::integer FROM security_audit_events WHERE action='alumnus_anonymized' AND entity_id='99180') AS audits
        FROM alumni a JOIN alumni_privacy_controls p ON p.alumnus_id=a.id JOIN alumni_data_lifecycle l ON l.alumnus_id=a.id WHERE a.id=99180`)
      assert.deepEqual(redacted.rows[0], { name: "Anonymized alumnus #99180", email: "", phone: "", linkedin_url: "",
        coresignal_employee_id: "", general_contact_status: "Do not contact", professional_engagement_status: "Do not contact",
        birthday_engagement_status: "Do not contact", status: "Anonymized", audits: 1 })
      await pool.query("CREATE FUNCTION reject_anonymize_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='alumnus_anonymized' AND NEW.entity_id='99182' THEN RAISE EXCEPTION 'fictional anonymize audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_anonymize_audit_trigger BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_anonymize_audit()")
      try {
        const failed = await http("/api/admin", { cookie: admin.cookie, method: "POST", body: { action: "anonymize_alumnus", alumnusId: 99182, confirmation: "ANONYMIZE 99182" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const unchanged = await pool.query(`SELECT a.name,a.email,
          (SELECT count(*)::integer FROM alumni_privacy_controls WHERE alumnus_id=99182) AS privacy,
          (SELECT count(*)::integer FROM alumni_data_lifecycle WHERE alumnus_id=99182) AS lifecycle
          FROM alumni a WHERE a.id=99182`)
        assert.deepEqual(unchanged.rows[0], { name: "Fictional Rollback", email: "rollback@example.test", privacy: 0, lifecycle: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_anonymize_audit_trigger ON security_audit_events")
        await pool.query("DROP FUNCTION reject_anonymize_audit()")
      }
    })
    await t.test("PCOM import preview preserves shared validation and makes no canonical write", async () => {
      const before = await pool.query("SELECT (SELECT count(*)::integer FROM alumni) AS alumni, (SELECT count(*)::integer FROM import_runs) AS runs, (SELECT count(*)::integer FROM alumni_source_observations) AS observations")
      postgresImportPreviewSnapshot = await importPreviewContract(base, admin.cookie, pcom.cookie, 1)
      const after = await pool.query("SELECT (SELECT count(*)::integer FROM alumni) AS alumni, (SELECT count(*)::integer FROM import_runs) AS runs, (SELECT count(*)::integer FROM alumni_source_observations) AS observations")
      assert.deepEqual(after.rows[0], before.rows[0])
    })
    await t.test("concurrent PCOM previews and Admin reads release PostgreSQL sessions", async () => {
      const record = { source_alumni_id: "BATCH1-PREVIEW-BURST", source_system: "fictional-sheet", name: "Fictional Preview Burst", programme: "PGP", graduation_year: "2020" }
      const requests = await Promise.all(Array.from({ length: 10 }, (_, index) => index % 2
        ? http("/api/admin", { cookie: admin.cookie, timeoutMs: 12_000 })
        : http("/api/imports", { cookie: pcom.cookie, method: "POST", body: { action: "preview", filename: "burst.xlsx", records: [record] }, timeoutMs: 12_000 })))
      assert.ok(requests.every(result => result.status === 200), JSON.stringify(requests.map(item => item.status)))
      assert.equal((await http("/api/admin", { cookie: admin.cookie })).status, 200)
      const activity = await pool.query("SELECT state, count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() GROUP BY state ORDER BY state")
      assert.deepEqual(activity.rows, [{ state: "active", n: 1 }])
    })
    await t.test("Admin confirmed import creates a retained unverified claim and replays once", async () => {
      const record = { source_alumni_id: "BATCH1-EXEC-1", source_system: "fictional-sheet", name: "Fictional Execute Person", programme: "PGP", graduation_year: "2020", company: "", title: "Analyst" }
      const preview = await http("/api/imports", { cookie: pcom.cookie, method: "POST", body: { action: "preview", filename: "fictional.csv", records: [record] } })
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      const body = { action: "execute", filename: "fictional.csv", records: [record], previewId: preview.body.previewId, confirmed: true }
      const created = await http("/api/imports", { cookie: admin.cookie, method: "POST", body, key: "batch1-confirmed-import" })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      assert.equal(created.body.imported, 1)
      postgresImportExecuteSnapshot = { status: created.status, body: created.body }
      const replay = await http("/api/imports", { cookie: admin.cookie, method: "POST", body, key: "batch1-confirmed-import" })
      assert.equal(replay.status, 201, JSON.stringify(replay.body))
      assert.equal(replay.replayed, "true")
      assert.deepEqual(replay.body, created.body)
      const conflict = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { ...body, filename: "different.csv" }, key: "batch1-confirmed-import" })
      assert.equal(conflict.status, 409)
      assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT")
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE name='Fictional Execute Person' AND current_company_verification='Unverified') AS alumni, (SELECT count(*)::integer FROM import_runs WHERE filename='fictional.csv') AS runs, (SELECT count(*)::integer FROM security_audit_events WHERE action='alumni_import_executed') AS audits, (SELECT count(*)::integer FROM alumni_source_observations WHERE source_row_key=$1) AS observations", [preview.body.rows[0].key])
      assert.deepEqual(state.rows[0], { alumni: 1, runs: 1, audits: 1, observations: 1 })
    })
    await t.test("import confirmation, stale preview and audit rollback retain their gates", async () => {
      const record = { source_alumni_id: "BATCH1-ROLLBACK", source_system: "fictional-sheet", name: "Fictional Rollback Person", programme: "PGP", graduation_year: "2020", company: "" }
      const post = (body, key) => http("/api/imports", { cookie: admin.cookie, method: "POST", body, key })
      const preview = await post({ action: "preview", filename: "rollback.xlsx", records: [record] })
      assert.equal(preview.status, 200)
      const body = { action: "execute", filename: "rollback.xlsx", records: [record], previewId: preview.body.previewId, confirmed: true }
      assert.equal((await post({ ...body, confirmed: false }, "batch1-no-confirm")).status, 400)
      assert.equal((await post({ ...body, previewId: "stale" }, "batch1-stale")).status, 409)
      const overlength = await post(body, "x".repeat(201))
      assert.deepEqual({ status: overlength.status, body: overlength.body },
        { status: 400, body: { error: "Idempotency-Key cannot exceed 200 characters." } })
      await pool.query("CREATE FUNCTION batch1_reject_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='alumni_import_executed' AND NEW.entity_id=$1 THEN RAISE EXCEPTION 'fictional import audit failure'; END IF; RETURN NEW; END $$".replace("$1", q(preview.body.previewId)))
      await pool.query("CREATE TRIGGER batch1_reject_import_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION batch1_reject_import_audit()")
      try {
        const failed = await post(body, "batch1-audit-fail")
        assert.equal(failed.status, 500, JSON.stringify(failed.body))
        assert.equal(failed.body.error, "Database operation failed.")
        const state = await pool.query("SELECT (SELECT count(*)::integer FROM import_runs WHERE filename='rollback.xlsx') AS runs, (SELECT count(*)::integer FROM security_audit_events WHERE action='alumni_import_executed' AND entity_id=$1) AS audits, (SELECT status FROM mutation_requests WHERE operation_type='alumni_import_execute' AND target_key=$1 ORDER BY created_at DESC LIMIT 1) AS status", [preview.body.previewId])
        assert.deepEqual(state.rows[0], { runs: 0, audits: 0, status: "FAILED" })
      } finally {
        await pool.query("DROP TRIGGER batch1_reject_import_audit ON security_audit_events")
        await pool.query("DROP FUNCTION batch1_reject_import_audit()")
      }
      const recovered = await post(body, "batch1-audit-fail")
      assert.equal(recovered.status, 201, JSON.stringify(recovered.body))
      assert.equal(recovered.body.imported, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM alumni WHERE name='Fictional Rollback Person'")).rows[0].n, 1)
    })
    await t.test("existing-alumnus history failure rolls back a chunk and can resume", async () => {
      const record = { source_alumni_id: "BATCH1-UPDATE", source_system: "fictional-sheet", canonical_alumni_id: "2", name: "Bea Demo-Only", programme: "PGP", graduation_year: "2021", location: "Bengaluru", note: "Batch1 history update" }
      const preview = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { action: "preview", filename: "update.csv", records: [record] } })
      assert.equal(preview.status, 200)
      assert.equal(preview.body.rows[0].kind, "existing")
      const body = { action: "execute", filename: "update.csv", records: [record], previewId: preview.body.previewId, approvedUpdateKeys: [preview.body.rows[0].key], confirmed: true }
      const before = (await pool.query("SELECT record_version,note FROM alumni WHERE id=2")).rows[0]
      await pool.query("CREATE FUNCTION batch1_reject_import_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.new_value='Batch1 history update' THEN RAISE EXCEPTION 'fictional import history failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER batch1_reject_import_history BEFORE INSERT ON field_change_history FOR EACH ROW EXECUTE FUNCTION batch1_reject_import_history()")
      try {
        const failed = await http("/api/imports", { cookie: admin.cookie, method: "POST", body, key: "batch1-history-fail" })
        assert.equal(failed.status, 500, JSON.stringify(failed.body))
        assert.deepEqual((await pool.query("SELECT record_version,note FROM alumni WHERE id=2")).rows[0], before)
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM mutation_request_items WHERE request_key=(SELECT request_key FROM mutation_requests WHERE target_key=$1 AND operation_type='alumni_import_execute' LIMIT 1)", [preview.body.previewId])).rows[0].n, 0)
      } finally {
        await pool.query("DROP TRIGGER batch1_reject_import_history ON field_change_history")
        await pool.query("DROP FUNCTION batch1_reject_import_history()")
      }
      const completed = await http("/api/imports", { cookie: admin.cookie, method: "POST", body, key: "batch1-history-fail" })
      assert.equal(completed.status, 201, JSON.stringify(completed.body))
      assert.equal(completed.body.updated, 1)
      assert.equal((await pool.query("SELECT note FROM alumni WHERE id=2")).rows[0].note, "Batch1 history update")
    })
    await t.test("chunked import and competing executions create one row per source identity", async () => {
      const records = Array.from({ length: 20 }, (_, index) => ({ source_alumni_id: `BATCH1-CHUNK-${index}`, source_system: "fictional-sheet", name: `Fictional Chunk Person ${index}`, programme: "PGP", graduation_year: "2020", company: "" }))
      const preview = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { action: "preview", filename: "chunks.csv", records } })
      assert.equal(preview.status, 200)
      const body = { action: "execute", filename: "chunks.csv", records, previewId: preview.body.previewId, confirmed: true }
      const completed = await http("/api/imports", { cookie: admin.cookie, method: "POST", body, key: "batch1-chunks" })
      assert.equal(completed.status, 201, JSON.stringify(completed.body))
      assert.equal(completed.body.imported, 20)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE name LIKE 'Fictional Chunk Person %') AS alumni, (SELECT count(*)::integer FROM mutation_request_items WHERE request_key=(SELECT request_key FROM mutation_requests WHERE target_key=$1 AND operation_type='alumni_import_execute')) AS items", [preview.body.previewId])
      assert.deepEqual(state.rows[0], { alumni: 20, items: 20 })
      const raceRecord = { source_alumni_id: "BATCH1-RACE", source_system: "fictional-sheet", name: "Fictional Race Person", programme: "PGP", graduation_year: "2020", company: "" }
      const racePreview = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { action: "preview", filename: "race.csv", records: [raceRecord] } })
      const raceBody = { action: "execute", filename: "race.csv", records: [raceRecord], previewId: racePreview.body.previewId, confirmed: true }
      const race = await Promise.all([1, 2].map(() => http("/api/imports", { cookie: admin.cookie, method: "POST", body: raceBody, key: "batch1-race" })))
      assert.ok(race.some(item => item.status === 201), JSON.stringify(race))
      assert.ok(race.every(item => [201, 409].includes(item.status)), JSON.stringify(race))
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM alumni WHERE name='Fictional Race Person'")).rows[0].n, 1)
      const competingRecord = { ...raceRecord, source_alumni_id: "BATCH1-COMPETING", name: "Fictional Competing Person" }
      const competingPreview = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { action: "preview", filename: "competing.csv", records: [competingRecord] } })
      const competingBody = { action: "execute", filename: "competing.csv", records: [competingRecord], previewId: competingPreview.body.previewId, confirmed: true }
      const competing = await Promise.all(["batch1-competing-a", "batch1-competing-b"].map(key => http("/api/imports", { cookie: admin.cookie, method: "POST", body: competingBody, key })))
      assert.equal(competing.filter(item => item.status === 201).length, 1, JSON.stringify(competing))
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM alumni WHERE name='Fictional Competing Person'")).rows[0].n, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='alumni_import_executed' AND entity_id=$1", [competingPreview.body.previewId])).rows[0].n, 1)
    })
    await t.test("legacy workspace import preserves Admin contract and local history", async () => {
      postgresWorkspaceImportSnapshot = await workspaceImportContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE profile_key='batch1:workspace:fixture' AND company='Updated Co') AS alumni, (SELECT count(*)::integer FROM field_change_history h JOIN alumni a ON a.id=h.alumnus_id WHERE a.profile_key='batch1:workspace:fixture' AND h.field='company') AS history, (SELECT count(*)::integer FROM import_runs WHERE filename='workspace.csv') AS runs, (SELECT count(*)::integer FROM security_audit_events WHERE action='alumni_imported' AND entity_id='workspace.csv') AS audits")
      assert.deepEqual(state.rows[0], { alumni: 1, history: 1, runs: 3, audits: 3 })
    })
    await t.test("workspace import audit failure rolls back alumni and history", async () => {
      await pool.query("CREATE FUNCTION batch1_reject_workspace_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='alumni_imported' AND NEW.entity_id='workspace-rollback.csv' THEN RAISE EXCEPTION 'fictional workspace import audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER batch1_reject_workspace_import_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION batch1_reject_workspace_import_audit()")
      try {
        const failed = await http("/api/workspace", { cookie: admin.cookie, method: "POST", body: { action: "import", filename: "workspace-rollback.csv", records: [{ profileKey: "batch1:workspace:rollback", name: "Fictional Workspace Rollback", batch: 2023, company: "Rollback Co" }] } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE profile_key='batch1:workspace:rollback') AS alumni, (SELECT count(*)::integer FROM import_runs WHERE filename='workspace-rollback.csv') AS runs, (SELECT count(*)::integer FROM activity_log WHERE entity_id='workspace-rollback.csv') AS activity")
        assert.deepEqual(state.rows[0], { alumni: 0, runs: 0, activity: 0 })
      } finally {
        await pool.query("DROP TRIGGER batch1_reject_workspace_import_audit ON security_audit_events")
        await pool.query("DROP FUNCTION batch1_reject_workspace_import_audit()")
      }
    })
    await t.test("legacy workspace later-row collision rolls back atomically with D1's 400 status", async () => {
      // Approved 2026-11-15: atomic rollback + 400 (D1 keeps earlier rows and returns raw constraint text).
      const failed = await http("/api/workspace", { cookie: admin.cookie, method: "POST", body: workspacePartialFailureBody })
      assert.deepEqual({ status: failed.status, body: failed.body }, { status: 400, body: { error: "An imported row conflicts with an existing alumnus record. No records were imported; review the file and validate again." } })
      assert.doesNotMatch(JSON.stringify(failed.body), /constraint|unique|duplicate key|alumni_/i)
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE profile_key LIKE 'fictional-workspace-partial-%') AS people, (SELECT count(*)::integer FROM import_runs WHERE filename='workspace-partial-failure.csv') AS runs, (SELECT count(*)::integer FROM activity_log WHERE entity_id='workspace-partial-failure.csv') AS activity, (SELECT count(*)::integer FROM security_audit_events WHERE action='alumni_imported' AND entity_id='workspace-partial-failure.csv') AS audits")
      assert.deepEqual(state.rows[0], { people: 0, runs: 0, activity: 0, audits: 0 })
    })

    const profilePatch = (cookie, body, key = "") => http("/api/alumni/1", { method: "PATCH", cookie, body, key })
    const proposalDecision = (cookie, body, key = "") => http("/api/alumni/1", { method: "POST", cookie, body, key })
    const workspacePatch = (cookie, body) => http("/api/workspace", { method: "PATCH", cookie, body })
    await t.test("profile PATCH enforces permissions, versions, idempotency and field review", async () => {
      const original = await http("/api/alumni/1", { cookie: pcom.cookie })
      const version = original.body.alumnus.recordVersion
      assert.equal((await profilePatch(undefined, { expectedVersion: version, fields: { note: "Fictional note" } })).status, 401)
      assert.equal((await profilePatch(developer, { expectedVersion: version, fields: { note: "Fictional note" } })).status, 403)
      assert.equal((await profilePatch(pcom.cookie, { expectedVersion: version, fields: { email: "invalid" } })).status, 400)
      assert.equal((await http("/api/alumni/99999", { method: "PATCH", cookie: pcom.cookie, body: { expectedVersion: 1, fields: { note: "Missing" } } })).status, 404)
      const body = { expectedVersion: version, fields: { note: "Fictional reviewed note" }, source: "Fictional review" }
      const changed = await profilePatch(pcom.cookie, body, "step3d-profile-note")
      assert.equal(changed.status, 200, JSON.stringify(changed.body))
      assert.equal(changed.body.changed, 1)
      assert.equal(changed.body.alumnus.note, "Fictional reviewed note")
      assert.equal(changed.body.alumnus.email, "ada@example.test")
      assert.equal(changed.body.alumnus.recordVersion, version + 1)
      const replay = await profilePatch(pcom.cookie, body, "step3d-profile-note")
      assert.equal(replay.status, 200)
      assert.equal(replay.replayed, "true")
      assert.deepEqual(replay.body, changed.body)
      assert.equal((await profilePatch(pcom.cookie, { ...body, fields: { note: "Different" } }, "step3d-profile-note")).body.code, "IDEMPOTENCY_CONFLICT")
      const stale = await profilePatch(pcom.cookie, { expectedVersion: version, fields: { note: "Stale" } })
      assert.equal(stale.status, 409)
      assert.equal(stale.body.code, "VERSION_CONFLICT")
      const next = changed.body.alumnus.recordVersion
      const concurrent = await Promise.all([
        profilePatch(pcom.cookie, { expectedVersion: next, fields: { note: "Concurrent A" } }, "step3d-concurrent-a"),
        profilePatch(pcom.cookie, { expectedVersion: next, fields: { note: "Concurrent B" } }, "step3d-concurrent-b"),
      ])
      assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409])
      const rows = await pool.query("SELECT (SELECT count(*)::integer FROM field_change_history WHERE mutation_request_key=(SELECT request_key FROM mutation_requests WHERE client_key_hash=(SELECT client_key_hash FROM mutation_requests WHERE operation_type='alumnus_profile_patch' AND target_key='1' ORDER BY created_at LIMIT 1) LIMIT 1)) AS history_count")
      assert.ok(rows.rows[0].history_count >= 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='alumnus_profile_patch' AND entity_id='1'")).rows[0].n, 2)
    })

    await t.test("protected fields create proposals; Admin decisions are version-fenced and replayable", async () => {
      await pool.query("UPDATE alumni SET current_company_verification='Verified' WHERE id=1")
      let current = (await http("/api/alumni/1", { cookie: pcom.cookie })).body.alumnus
      const proposed = await profilePatch(pcom.cookie, { expectedVersion: current.recordVersion, fields: { company: "Fictional New Co" } }, "step3d-propose-company")
      assert.equal(proposed.status, 200, JSON.stringify(proposed.body))
      assert.equal(proposed.body.changed, 0)
      assert.equal(proposed.body.proposed, 1)
      assert.equal(proposed.body.alumnus.company, "Example Co")
      const proposal = (await http("/api/alumni/1", { cookie: admin.cookie })).body.proposals.find(item => item.proposedValue === "Fictional New Co")
      assert.ok(proposal)
      assert.equal((await proposalDecision(pcom.cookie, { action: "accept_proposal", proposalId: proposal.id })).status, 403)
      const decision = { action: "accept_proposal", proposalId: proposal.id, note: "Fictional approval" }
      const accepted = await proposalDecision(admin.cookie, decision, "step3d-accept-company")
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
      assert.equal(accepted.body.status, "ACCEPTED")
      assert.equal((await proposalDecision(admin.cookie, decision, "step3d-accept-company")).replayed, "true")
      current = (await http("/api/alumni/1", { cookie: admin.cookie })).body.alumnus
      assert.equal(current.company, "Fictional New Co")
      const newProposal = await profilePatch(pcom.cookie, { expectedVersion: current.recordVersion, fields: { programme: "Fictional Other Programme" } }, "step3d-propose-programme")
      assert.equal(newProposal.status, 200)
      const proposal2 = (await http("/api/alumni/1", { cookie: admin.cookie })).body.proposals.find(item => item.proposedValue === "Fictional Other Programme")
      const rejected = await proposalDecision(admin.cookie, { action: "reject_proposal", proposalId: proposal2.id }, "step3d-reject-programme")
      assert.deepEqual({ status: rejected.status, body: rejected.body }, { status: 200, body: { status: "REJECTED" } })
      const staleProposal = await profilePatch(pcom.cookie,
        { expectedVersion: current.recordVersion, fields: { company: "Fictional Stale Co" } }, "step3d-stale-proposal")
      assert.equal(staleProposal.status, 200)
      const proposal3 = (await http("/api/alumni/1", { cookie: admin.cookie })).body.proposals.find(item => item.proposedValue === "Fictional Stale Co")
      const intervening = await profilePatch(admin.cookie,
        { expectedVersion: current.recordVersion, fields: { note: "Intervening fictional edit" } }, "step3d-intervening")
      assert.equal(intervening.status, 200)
      const staleDecision = await proposalDecision(admin.cookie, { action: "accept_proposal", proposalId: proposal3.id }, "step3d-stale-decision")
      assert.equal(staleDecision.status, 409)
      assert.equal(staleDecision.body.code, "STALE_PROPOSAL")
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action IN ('alumnus_profile_proposal_accepted','alumnus_profile_proposal_rejected') AND entity_id='1'")).rows[0].n, 2)
    })

    await t.test("forced profile audit and history failures leave no partial mutation", async () => {
      const version = (await http("/api/alumni/1", { cookie: admin.cookie })).body.alumnus.recordVersion
      await pool.query("CREATE FUNCTION step3d_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='alumnus_profile_patch' AND NEW.metadata_json LIKE '%note%' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3d_reject_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION step3d_reject_audit()")
      const failedAudit = await profilePatch(admin.cookie, { expectedVersion: version, fields: { note: "Audit should fail" } }, "step3d-fail-audit")
      assert.equal(failedAudit.status, 500)
      assert.equal(failedAudit.body.error, "Database operation failed.")
      assert.equal((await pool.query("SELECT record_version,note FROM alumni WHERE id=1")).rows[0].record_version, version)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM mutation_requests WHERE target_key='1' AND operation_type='alumnus_profile_patch' AND status='IN_PROGRESS'")).rows[0].n, 0)
      await pool.query("DROP TRIGGER step3d_reject_audit ON security_audit_events")
      await pool.query("DROP FUNCTION step3d_reject_audit()")
      await pool.query("CREATE FUNCTION step3d_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.mutation_request_key != '' AND NEW.new_value='History should fail' THEN RAISE EXCEPTION 'fictional history failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3d_reject_history BEFORE INSERT ON field_change_history FOR EACH ROW EXECUTE FUNCTION step3d_reject_history()")
      const failedHistory = await profilePatch(admin.cookie, { expectedVersion: version, fields: { note: "History should fail" } }, "step3d-fail-history")
      assert.equal(failedHistory.status, 500)
      assert.equal(failedHistory.body.error, "Database operation failed.")
      assert.equal((await pool.query("SELECT record_version FROM alumni WHERE id=1")).rows[0].record_version, version)
      await pool.query("DROP TRIGGER step3d_reject_history ON field_change_history")
      await pool.query("DROP FUNCTION step3d_reject_history()")
    })

    await t.test("workspace manual and PATCH actions retain permissions, readback and audit", async () => {
      const record = { name: "Fictional Workspace Person", batch: 2022, programme: "PGP", company: "Example New Co", title: "Analyst", email: "workspace-person@example.test" }
      assert.equal((await http("/api/workspace", { method: "POST", body: { action: "manual_add", record } })).status, 401)
      const checked = await http("/api/workspace", { method: "POST", cookie: pcom.cookie, body: { action: "manual_check", record } })
      assert.deepEqual({ status: checked.status, matches: checked.body.matches }, { status: 200, matches: [] })
      const created = await http("/api/workspace", { method: "POST", cookie: pcom.cookie, body: { action: "manual_add", record } })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      assert.equal(created.body.providerCreditsUsed, 0)
      const newId = created.body.alumnus.id
      assert.equal((await http("/api/workspace", { method: "POST", cookie: pcom.cookie, body: { action: "manual_add", record } })).status, 409)
      const raceRecord = { ...record, name: "Fictional Concurrent Person", email: "workspace-race@example.test" }
      const race = await Promise.all([1, 2].map(() => http("/api/workspace", { method: "POST", cookie: pcom.cookie, body: { action: "manual_add", record: raceRecord } })))
      assert.deepEqual(race.map(item => item.status).sort(), [201, 409])
      assert.equal((await http("/api/workspace", { method: "POST", cookie: pcom.cookie, body: { action: "import", records: [record] } })).status, 403)
      assert.equal((await http("/api/workspace", { method: "POST", cookie: admin.cookie, body: { action: "import", records: [record] } })).status, 201)
      const updated = await workspacePatch(pcom.cookie, { action: "update_alumnus", id: newId, status: "Contacted", assessment: { hiringInfluence: "High" } })
      assert.equal(updated.status, 200, JSON.stringify(updated.body))
      assert.equal(updated.body.alumnus.status, "Contacted")
      const quality = await workspacePatch(pcom.cookie, { action: "update_data_quality", id: newId, professionalDataStatus: "Reviewed", professionalDataNote: "Fictional review" })
      assert.equal(quality.status, 200)
      assert.equal(quality.body.alumnus.professionalDataStatus, "Reviewed")
      assert.equal((await workspacePatch(pcom.cookie, { action: "update_priority", company: "Example New Co", priority: "High" })).status, 403)
      const priority = await workspacePatch(admin.cookie, { action: "update_priority", company: "Example New Co", priority: "High" })
      assert.deepEqual({ status: priority.status, body: priority.body }, { status: 200, body: { company: "Example New Co", priority: "High" } })
      const privacy = await workspacePatch(admin.cookie, { action: "update_privacy", id: newId, privacy: { generalContactStatus: "Do not contact", consentSource: "Manual PCOM record" } })
      assert.equal(privacy.status, 200)
      assert.equal(privacy.body.privacy.generalContactStatus, "Do not contact")
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE entity_id=$1 AND action IN ('alumnus_manual_created','relationship_assessment_changed','professional_data_quality_changed','do_not_contact_changed')", [String(newId)])).rows[0].n, 4)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM activity_log WHERE entity_id=$1", [String(newId)])).rows[0].n, 2)
    })

    await t.test("workspace audit failure rolls back priority and activity", async () => {
      await pool.query("CREATE FUNCTION step3d_reject_priority_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='company_priority_changed' AND NEW.entity_id='Rollback Company' THEN RAISE EXCEPTION 'fictional priority audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER step3d_reject_priority_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION step3d_reject_priority_audit()")
      const failed = await workspacePatch(admin.cookie, { action: "update_priority", company: "Rollback Company", priority: "High" })
      assert.equal(failed.status, 500)
      assert.equal(failed.body.error, "Database operation failed.")
      const counts = await pool.query("SELECT (SELECT count(*)::integer FROM company_priorities WHERE company='Rollback Company') AS priorities, (SELECT count(*)::integer FROM activity_log WHERE entity_id='Rollback Company') AS activity, (SELECT count(*)::integer FROM security_audit_events WHERE entity_id='Rollback Company') AS audits")
      assert.deepEqual(counts.rows[0], { priorities: 0, activity: 0, audits: 0 })
      await pool.query("DROP TRIGGER step3d_reject_priority_audit ON security_audit_events")
      await pool.query("DROP FUNCTION step3d_reject_priority_audit()")
    })
    await t.test("professional verification retains PCOM contract, history and atomic audit", async () => {
      postgresProfessionalVerificationSnapshot = await professionalVerificationContract(base, admin.cookie, pcom.cookie, 1)
      const before = await pool.query("SELECT location_verification FROM alumni WHERE id=1")
      await pool.query("CREATE FUNCTION stage3_reject_verification_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='professional_fields_verified' AND NEW.entity_id='1' THEN RAISE EXCEPTION 'fictional verification audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER stage3_reject_verification_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION stage3_reject_verification_audit()")
      try {
        const failed = await http("/api/professional-verification", { cookie: pcom.cookie, method: "POST", body: { action: "verify_professional_fields", alumnusId: 1, fields: { location: "Unverified" }, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.deepEqual((await pool.query("SELECT location_verification FROM alumni WHERE id=1")).rows, before.rows)
      } finally {
        await pool.query("DROP TRIGGER stage3_reject_verification_audit ON security_audit_events")
        await pool.query("DROP FUNCTION stage3_reject_verification_audit()")
      }
    })
    await t.test("PostgreSQL Directory and Admin CSV exports retain permissions, shape and audit", async () => {
      const directory = { scope: "directory", format: "csv", filters: {} }
      assert.equal((await exportHttp(base, undefined, directory)).status, 401)
      assert.equal((await exportHttp(base, pcom.cookie, { ...directory, format: "bad" })).status, 400)
      assert.equal((await exportHttp(base, pcom.cookie, { scope: "bad", format: "csv" })).status, 400)
      const alumniCsv = await exportHttp(base, pcom.cookie, directory)
      assert.equal(alumniCsv.status, 200, alumniCsv.body)
      assert.match(alumniCsv.type, /^text\/csv/)
      assert.match(alumniCsv.disposition, /corporate-network-alumni/)
      assert.match(alumniCsv.body, /"Alumni ID","Alumni Name","Profile Status"/)
      assert.equal((await exportHttp(base, pcom.cookie, { scope: "admin", format: "csv", datasets: ["programmes"] })).status, 403)
      assert.equal((await exportHttp(base, admin.cookie, { scope: "admin", format: "csv", datasets: ["unknown"] })).status, 400)
      const programmesCsv = await exportHttp(base, admin.cookie, { scope: "admin", format: "csv", datasets: ["programmes"] })
      assert.equal(programmesCsv.status, 200, programmesCsv.body)
      assert.match(programmesCsv.body, /"Programme ID","Code","Name","Active","Sort Order"/)
      const directoryXlsx = await exportArchive(base, pcom.cookie, { ...directory, format: "xlsx", importCompatible: true })
      assert.equal(directoryXlsx.status, 200)
      assert.match(directoryXlsx.type, /spreadsheetml\.sheet/)
      assert.ok(directoryXlsx.files["xl/workbook.xml"])
      const adminZip = await exportArchive(base, admin.cookie, { scope: "admin", format: "csv", datasets: ["programmes", "companies"] })
      assert.equal(adminZip.status, 200)
      assert.equal(adminZip.type, "application/zip")
      assert.ok(Object.keys(adminZip.files).some(name => name.endsWith(".csv")))
      const approvedDatasets = ["alumni", "companies", "company_mappings", "priorities", "engagements", "opportunities", "opportunity_history", "professional_reviews", "programmes"]
      const allAdminZip = await exportArchive(base, admin.cookie, { scope: "admin", format: "csv", datasets: approvedDatasets })
      assert.equal(allAdminZip.status, 200)
      assert.deepEqual(Object.keys(allAdminZip.files).sort(), [...approvedDatasets.map(id => `${id}.csv`), "README.txt"].sort())
      assert.ok((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='business_data_exported'")).rows[0].n >= 2)
      await pool.query("CREATE FUNCTION stage3_reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='business_data_exported' THEN RAISE EXCEPTION 'fictional export audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER stage3_reject_export_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION stage3_reject_export_audit()")
      try {
        const failed = await exportHttp(base, admin.cookie, { scope: "admin", format: "csv", datasets: ["programmes"] })
        assert.equal(failed.status, 500)
        assert.deepEqual(JSON.parse(failed.body), { error: "Database operation failed." })
      } finally {
        await pool.query("DROP TRIGGER stage3_reject_export_audit ON security_audit_events")
        await pool.query("DROP FUNCTION stage3_reject_export_audit()")
      }
    })
    await t.test("provisional discovery intake preserves PCOM preflight, unverified creation and per-candidate audit", async () => {
      const path = "/api/discovery/intake"
      const post = (cookie, body) => http(path, { cookie, method: "POST", body })
      const preflightBody = { action: "preflight", resultIds: [intakeResultId] }
      assert.equal((await post(undefined, preflightBody)).status, 401)
      assert.equal((await post(pcom.cookie, { action: "bad", resultIds: [intakeResultId] })).status, 400)
      assert.equal((await post(pcom.cookie, { action: "execute", resultIds: [intakeResultId] })).status, 400)
      const preflight = await post(pcom.cookie, preflightBody)
      assert.equal(preflight.status, 200, JSON.stringify(preflight.body))
      assert.equal(preflight.body.eligibleCount, 1)
      assert.equal(preflight.body.databaseWrites, 0)
      postgresIntakePreflightSnapshot = preflight.body
      const before = await pool.query("SELECT (SELECT count(*)::integer FROM provisional_alumni_intakes WHERE discovery_result_id=$1) AS intakes, (SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_provisionally_added' AND entity_id=$2) AS audits", [intakeResultId, String(intakeResultId)])
      assert.deepEqual(before.rows[0], { intakes: 0, audits: 0 })
      const executed = await post(pcom.cookie, { action: "execute", resultIds: [intakeResultId], confirmed: true })
      assert.equal(executed.status, 201, JSON.stringify(executed.body))
      assert.equal(executed.body.addedCount, 1)
      assert.equal(executed.body.providerCalls, 0)
      const state = await pool.query("SELECT a.intake_status,a.company,a.programme,a.profile_match,a.coresignal_employee_id,r.review_status,(SELECT count(*)::integer FROM provisional_alumni_intakes WHERE discovery_result_id=$1) AS intakes,(SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_provisionally_added' AND entity_id=$2) AS audits FROM external_discovery_results r JOIN alumni a ON a.id=r.linked_internal_alumnus_id WHERE r.id=$1", [intakeResultId, String(intakeResultId)])
      assert.deepEqual(state.rows[0], { intake_status: "PROVISIONAL", company: "Unknown", programme: "Unknown", profile_match: "Unverified", coresignal_employee_id: intakeProviderId, review_status: "Added provisionally", intakes: 1, audits: 1 })
      const replay = await post(pcom.cookie, { action: "execute", resultIds: [intakeResultId], confirmed: true })
      assert.equal(replay.status, 200, JSON.stringify(replay.body))
      assert.equal(replay.body.alreadyPresentCount, 1)
    })
    await t.test("provisional intake audit failure rolls back one candidate", async () => {
      const resultId = intakeResultId + 1
      await pool.query("INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,\"function\",seniority,location,match_status,provider_person_id,linkedin_url) VALUES ($1,$2,'coresignal','fictional-intake-two','Fictional Provisional Two','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99001002','https://www.linkedin.com/in/fictional-provisional-two/')", [resultId, intakeSearchId])
      await pool.query("CREATE FUNCTION stage3_reject_intake_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='external_candidate_provisionally_added' AND NEW.entity_id='99003' THEN RAISE EXCEPTION 'fictional intake audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER stage3_reject_intake_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION stage3_reject_intake_audit()")
      try {
        const failed = await http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: { action: "execute", resultIds: [resultId], confirmed: true } })
        assert.equal(failed.status, 500, JSON.stringify(failed.body))
        assert.equal(failed.body.error, "Database operation failed.")
        const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE coresignal_employee_id='99001002') AS alumni,(SELECT count(*)::integer FROM provisional_alumni_intakes WHERE discovery_result_id=$1) AS intakes,(SELECT review_status FROM external_discovery_results WHERE id=$1) AS status", [resultId])
        assert.deepEqual(state.rows[0], { alumni: 0, intakes: 0, status: "Pending review" })
      } finally {
        await pool.query("DROP TRIGGER stage3_reject_intake_audit ON security_audit_events")
        await pool.query("DROP FUNCTION stage3_reject_intake_audit()")
      }
      const recovered = await http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: { action: "execute", resultIds: [resultId], confirmed: true } })
      assert.equal(recovered.status, 201, JSON.stringify(recovered.body))
      assert.equal(recovered.body.addedCount, 1)
    })
    await t.test("competing provisional intake and cross-source LinkedIn claims remain unique", async () => {
      const raceId = intakeResultId + 2
      await pool.query("INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,\"function\",seniority,location,match_status,provider_person_id,linkedin_url) VALUES ($1,$2,'coresignal','fictional-intake-race','Fictional Provisional Race','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99001003','https://www.linkedin.com/in/fictional-provisional-race/')", [raceId, intakeSearchId])
      const raceBody = { action: "execute", resultIds: [raceId], confirmed: true }
      const race = await Promise.all([1, 2].map(() => http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: raceBody })))
      assert.equal(race.filter(item => item.status === 201).length, 1, JSON.stringify(race))
      assert.ok(race.every(item => [200, 201, 409].includes(item.status)), JSON.stringify(race))
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE coresignal_employee_id='99001003') AS alumni,(SELECT count(*)::integer FROM provisional_alumni_intakes WHERE discovery_result_id=$1) AS intakes,(SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_provisionally_added' AND entity_id=$2) AS audits", [raceId, String(raceId)])
      assert.deepEqual(state.rows[0], { alumni: 1, intakes: 1, audits: 1 })
      const collisionId = intakeResultId + 3
      await pool.query("INSERT INTO external_discovery_results(id,search_id,provider,provider_result_id,name,education,current_company,role,\"function\",seniority,location,match_status,provider_person_id,linkedin_url) VALUES ($1,$2,'coresignal','fictional-intake-collision','Fictional Provisional Collision','Unknown','Unknown','Unknown','Other','Unknown/Unclassified','Unknown','New','99001004','https://www.linkedin.com/in/fictional-provisional-collision/')", [collisionId, intakeSearchId])
      const preflight = await http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: { action: "preflight", resultIds: [collisionId] } })
      assert.equal(preflight.body.eligibleCount, 1)
      await pool.query("INSERT INTO alumni(profile_key,name,initials,batch,graduation_year,programme,company,title,\"function\",seniority,location,linkedin_url) VALUES ('fictional:cross-source-collision','Different Fictional Claim','DF',2020,2020,'PGP','Example Co','Analyst','Other','Analyst/Junior','Mumbai','https://www.linkedin.com/in/fictional-provisional-collision/')")
      const blocked = await http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: { action: "execute", resultIds: [collisionId], confirmed: true } })
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body))
      assert.equal(blocked.body.addedCount, 0)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM alumni WHERE coresignal_employee_id='99001004'")).rows[0].n, 0)
    })
    await t.test("intelligence profile reads selected PostgreSQL state and uses a local mock for enrollment", async () => {
      const path = "/api/intelligence/profile/1"
      assert.equal((await http(path)).status, 401)
      assert.equal((await http("/api/intelligence/profile/bad", { cookie: pcom.cookie })).status, 400)
      const missing = await http("/api/intelligence/profile/99999", { cookie: pcom.cookie })
      assert.deepEqual({ status: missing.status, body: missing.body }, { status: 404, body: { error: "Alumnus not found." } })
      postgresIntelligenceMissingSnapshot = missing
      assert.equal((await http(path, { method: "POST", cookie: pcom.cookie, body: { action: "bad" } })).status, 400)
      await pool.query("UPDATE alumni SET linkedin_url='https://www.linkedin.com/in/fictional-ada-demo/', profile_match='Confirmed' WHERE id=1")
      await pool.query("UPDATE alumni_data_lifecycle SET status='Active' WHERE alumnus_id=1")
      const read = await http(path, { cookie: pcom.cookie })
      assert.equal(read.status, 200, JSON.stringify(read.body))
      assert.equal(read.body.eligibility.reason, "MAPPING_REQUIRED")
      assert.equal(typeof read.body.provenance.recordOrigin, "string")
      const enrolled = await http(path, { method: "POST", cookie: pcom.cookie, body: { action: "enroll_bright" } })
      assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body))
      assert.equal(enrolled.body.enrollment.status, "ENROLLED")
      assert.equal(enrolled.body.eligibility.reason, "ELIGIBLE")
      assert.deepEqual(intelligenceRequests.map(item => `${item.method} ${item.path}`), [
        "POST /v1/alumni/resolve", "POST /v1/alumni/resolve", "POST /v1/alumni/enroll", "GET /v1/alumni/fictional-intelligence-1/summary",
      ])
      assert.ok(intelligenceRequests.every(item => item.authorized))
    })
    await t.test("fixed and dynamic refresh previews use selected CN PostgreSQL records", async () => {
      const path = "/api/intelligence/refresh/preview"
      const filter = { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { company: "Fictional unmatched company" }, includeCnAlumniIds: [2], excludeCnAlumniIds: [] }
      const dynamic = { cohortType: "DYNAMIC_FILTER", mode: "mock", maxProfiles: 5, maxSocaiCalls: 0, maxTargetedBright: 0, filter }
      assert.equal((await http(path, { method: "POST", body: dynamic })).status, 401)
      assert.equal((await http(path, { method: "POST", cookie: pcom.cookie, body: { ...dynamic, maxProfiles: 6 } })).status, 400)
      const preview = await http(path, { method: "POST", cookie: pcom.cookie, body: dynamic })
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      assert.equal(preview.body.selection.selectedCount, 1)
      assert.equal(preview.body.selection.members[0].cnAlumniId, 2)
      assert.equal(preview.body.selection.members[0].reason, "MANUAL_INCLUDE")
      assert.equal(preview.body.preview.providerCalls, 0)
      const fixed = await http(path, { method: "POST", cookie: pcom.cookie, body: { cohortType: "FIXED_COHORT", cnAlumniIds: [1] } })
      assert.equal(fixed.status, 409, JSON.stringify(fixed.body))
      assert.equal(fixed.body.code, "unmapped_cohort")
      assert.equal(fixed.body.cohort.unresolved[0].reason, "MAPPING_REQUIRED")
    })
    await t.test("inactive CN refresh policy creation and reconciliation use PostgreSQL selection with a local mock service", async () => {
      const create = { name: "Fictional inactive CN policy", mode: "SOCAI_MONITOR", cohortType: "DYNAMIC_FILTER", timingType: "RECURRING", enabled: false,
        maxProfiles: 5, maxSocaiCalls: 0, maxTargetedBright: 0, calendarPolicy: { kind: "WEEKLY", weekday: 1, localTime: "09:00", timezone: "Asia/Kolkata" }, filter: mockPolicyFilter }
      const path = "/api/intelligence/refresh/jobs"
      assert.equal((await http(path, { method: "POST", body: create })).status, 401)
      assert.equal((await http(path, { method: "POST", body: create, cookie: pcom.cookie })).status, 403)
      const jobs = await http(path, { cookie: pcom.cookie })
      assert.equal(jobs.status, 200, JSON.stringify(jobs.body))
      assert.equal(jobs.body.jobs[0].id, mockPolicyId)
      const created = await http(path, { method: "POST", body: create, cookie: admin.cookie })
      assert.equal(created.status, 201, JSON.stringify(created.body))
      assert.equal(created.body.monitoringState, "INACTIVE_POLICY")
      assert.equal(created.body.selection.selectedCount, 1)
      assert.equal(created.body.providerCalls, 0)
      const reconcilePath = `/api/intelligence/refresh/jobs/${mockPolicyId}/reconcile`
      const preview = await http(reconcilePath, { cookie: pcom.cookie })
      assert.equal(preview.status, 200, JSON.stringify(preview.body))
      assert.equal(preview.body.members[0].cnAlumniId, 2)
      const reconciled = await http(reconcilePath, { method: "POST", cookie: pcom.cookie, body: {} })
      assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body))
      assert.equal(reconciled.body.selection.selectedCount, 1)
      assert.equal(reconciled.body.recorded.recorded, true)
      assert.equal(reconciled.body.providerCalls, 0)
      assert.ok(intelligenceRequests.slice(-4).every(item => item.authorized))
    })

    await t.test("internal Bright revalidation uses selected PostgreSQL state and service-only authentication", async () => {
      const path = "/api/intelligence/bright-eligibility/revalidate"
      const record = { sourceId: "cn:2", intelligenceAlumniId: "fictional-intelligence-id", normalizedLinkedinUrl: "https://www.linkedin.com/in/fictional-bright" }
      const body = { records: [record] }
      assert.equal((await http(path, { method: "POST", body })).status, 401)
      assert.equal((await http(path, { method: "POST", body, extraHeaders: { authorization: "Bearer wrong" } })).status, 401)
      const authenticated = input => http(path, { method: "POST", body: input, extraHeaders: { authorization: `Bearer ${serviceSecret}` } })
      assert.equal((await authenticated({ records: [] })).status, 400)
      const missing = await authenticated({ records: [{ ...record, sourceId: "cn:99999" }] })
      assert.equal(missing.status, 200)
      postgresBrightMissingSnapshot = missing.body.results
      assert.equal(missing.body.results[0].reason, "NOT_FOUND")
      await pool.query("UPDATE alumni SET linkedin_url=$1,profile_match='Confirmed',professional_data_status='Verified' WHERE id=2", [record.normalizedLinkedinUrl])
      await pool.query("INSERT INTO alumni_data_lifecycle(alumnus_id,status) VALUES (2,'Active') ON CONFLICT (alumnus_id) DO UPDATE SET status='Active'")
      const eligible = await authenticated(body)
      assert.equal(eligible.status, 200, JSON.stringify(eligible.body))
      assert.deepEqual(eligible.body.results.map(item => [item.eligible, item.reason]), [[true, "ELIGIBLE"]])
      const mismatched = await authenticated({ records: [{ ...record, normalizedLinkedinUrl: "https://www.linkedin.com/in/changed" }] })
      assert.equal(mismatched.body.results[0].reason, "LINKEDIN_CHANGED")
    })

    await pool.query(outreachFixtureSql)
    await t.test("retained Outreach recommendations preserve warm, direct and blocked contracts with atomic audit", async () => {
      const post = (cookie, targetAlumnusId) => http("/api/outreach-route", { cookie, method: "POST", body: { targetAlumnusId } })
      assert.equal((await post(undefined, 99600)).status, 401)
      assert.equal((await post(developer, 99600)).status, 403)
      assert.equal((await post(pcom.cookie, undefined)).status, 400)
      assert.equal((await post(pcom.cookie, 99999)).status, 404)
      assert.equal((await post(pcom.cookie, 99604)).status, 409)
      const responses = await Promise.all([99600, 99602, 99603].map(id => post(pcom.cookie, id)))
      assert.deepEqual(responses.map(item => item.status), [200, 200, 200])
      assert.deepEqual(responses.map(item => item.body.routeType), ["Warm", "Direct", "No eligible route"])
      assert.equal(responses[0].body.intermediary?.id, 99601)
      const stored = await pool.query("SELECT (SELECT count(*)::integer FROM activity_log WHERE action='recommend_route' AND entity_id IN ('99600','99602','99603')) AS activities,(SELECT count(*)::integer FROM security_audit_events WHERE action='outreach_route_recommended' AND entity_id IN ('99600','99602','99603')) AS audits")
      assert.deepEqual(stored.rows[0], { activities: 3, audits: 3 })
      postgresOutreachSnapshot = responses.map(item => item.body)
      await pool.query("CREATE FUNCTION reject_outreach_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'outreach_route_recommended' AND NEW.entity_id = '99603' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_outreach_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_outreach_audit()")
      try {
        const failed = await post(pcom.cookie, 99603)
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const after = await pool.query("SELECT count(*)::integer AS count FROM activity_log WHERE action='recommend_route' AND entity_id='99603'")
        assert.equal(after.rows[0].count, 1)
      } finally {
        await pool.query("DROP TRIGGER reject_outreach_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_outreach_audit()")
      }
    })

    await t.test("retained Collect Preview offers eligible candidate and preserves prior claim", async () => {
      await pool.query(collectCandidateFixtureSql)
      const response = await http("/api/admin/coresignal-collect", { cookie: admin.cookie })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      assert.deepEqual(response.body.candidates.map(item => ({ employeeId: item.employeeId, priorCollectStatus: item.priorCollectStatus })),
        [{ employeeId: "99701001", priorCollectStatus: "ambiguous" }])
      postgresCollectCandidateSnapshot = response.body
    })

    await t.test("Collect selection preflight reads retained candidates without reservation", async () => {
      const before = (await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE operation='Base Employee Collect-only'")).rows[0].n
      postgresCollectSelectionSnapshot = await collectSelectionContract(base, admin.cookie, pcom.cookie)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE operation='Base Employee Collect-only'")).rows[0].n, before)
      await pool.query("ALTER TABLE external_discovery_searches RENAME TO fictional_collect_searches_unavailable")
      try {
        const failed = await http("/api/admin/coresignal-collect", { cookie: admin.cookie, method: "POST", body: { action: "selection_preflight", selections: [{ searchHistoryId: 99703, employeeId: "99701001" }] } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      } finally {
        await pool.query("ALTER TABLE fictional_collect_searches_unavailable RENAME TO external_discovery_searches")
      }
    })

    await t.test("single Collect preflight reads retained and known identities without reservation", async () => {
      await pool.query(collectKnownFixtureSql)
      const before = (await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE operation='Base Employee Collect-only'")).rows[0].n
      postgresCollectSingleSnapshot = await collectSinglePreflightContract(base, admin.cookie, pcom.cookie)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE operation='Base Employee Collect-only'")).rows[0].n, before)
      await pool.query("ALTER TABLE external_discovery_searches RENAME TO fictional_collect_single_searches_unavailable")
      try {
        const failed = await http("/api/admin/coresignal-collect", { cookie: admin.cookie, method: "POST", body: { action: "preflight", searchHistoryId: 99703, employeeId: "99701001" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      } finally {
        await pool.query("ALTER TABLE fictional_collect_single_searches_unavailable RENAME TO external_discovery_searches")
      }
    })

    await t.test("Corporate Opportunities POST/PATCH preserve lifecycle, idempotency and atomic audit", async () => {
      assert.equal((await http("/api/opportunities", { cookie: developer, method: "POST", body: { idempotencyKey: "forbidden", company: "Fictional Opportunity Co", ownerUserId: 1, title: "Forbidden" } })).status, 403)
      assert.equal((await http("/api/opportunities", { cookie: developer, method: "PATCH", body: { id: 99100, version: 1, title: "Forbidden" } })).status, 403)
      const contract = await opportunityMutationContract(base, pcom.cookie)
      postgresOpportunityMutationSnapshot = contract.snapshot
      const id = contract.id
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM corporate_opportunity_history WHERE opportunity_id=$1) AS history,(SELECT count(*)::integer FROM security_audit_events WHERE entity_type='corporate_opportunity' AND entity_id=$2) AS audits", [id, String(id)])
      assert.deepEqual(state.rows[0], { history: 2, audits: 2 })
      const concurrentBody = { idempotencyKey: "fictional-concurrent-opportunity", company: "Fictional Opportunity Co", ownerUserId: 1, title: "Fictional Concurrent Discussion" }
      const concurrent = await Promise.all(Array.from({ length: 2 }, () => http("/api/opportunities", { cookie: pcom.cookie, method: "POST", body: concurrentBody })))
      assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 201])
      assert.equal(concurrent[0].body.opportunity.id, concurrent[1].body.opportunity.id)
      const concurrentState = await pool.query("SELECT (SELECT count(*)::integer FROM corporate_opportunities WHERE opportunity_key='fictional-concurrent-opportunity') AS opportunities,(SELECT count(*)::integer FROM corporate_opportunity_history h JOIN corporate_opportunities o ON o.id=h.opportunity_id WHERE o.opportunity_key='fictional-concurrent-opportunity') AS history,(SELECT count(*)::integer FROM security_audit_events WHERE action='opportunity_created' AND entity_id=$1) AS audits", [String(concurrent[0].body.opportunity.id)])
      assert.deepEqual(concurrentState.rows[0], { opportunities: 1, history: 1, audits: 1 })
      await pool.query("CREATE FUNCTION reject_opportunity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='opportunity_updated' AND NEW.entity_id=$1 THEN RAISE EXCEPTION 'fictional opportunity audit failure'; END IF; RETURN NEW; END $$".replace("$1", q(String(id))))
      await pool.query("CREATE TRIGGER reject_opportunity_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_opportunity_audit()")
      try {
        const failed = await http("/api/opportunities", { cookie: pcom.cookie, method: "PATCH", body: { id, version: 2, stage: "OUTREACH_IN_PROGRESS" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const unchanged = await pool.query("SELECT stage,version FROM corporate_opportunities WHERE id=$1", [id])
        assert.deepEqual(unchanged.rows[0], { stage: "QUALIFYING", version: 2 })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM corporate_opportunity_history WHERE opportunity_id=$1", [id])).rows[0].n, 2)
      } finally {
        await pool.query("DROP TRIGGER reject_opportunity_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_opportunity_audit()")
      }
      await pool.query("CREATE FUNCTION reject_opportunity_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='opportunity_created' AND NEW.metadata_json LIKE '%Fictional Audit Failure Co%' THEN RAISE EXCEPTION 'fictional creation audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_opportunity_create_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_opportunity_create_audit()")
      try {
        const failed = await http("/api/opportunities", { cookie: pcom.cookie, method: "POST", body: { idempotencyKey: "fictional-opportunity-create-rollback", company: "Fictional Audit Failure Co", ownerUserId: 1, title: "Fictional Rollback Discussion" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM corporate_opportunities WHERE opportunity_key='fictional-opportunity-create-rollback'")).rows[0].n, 0)
      } finally {
        await pool.query("DROP TRIGGER reject_opportunity_create_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_opportunity_create_audit()")
      }
    })

    await t.test("Enrichment provider-limit PATCH preserves Admin accounting and atomic audit", async () => {
      postgresEnrichmentLimitSnapshot = await enrichmentLimitContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT (SELECT monthly_credit_limit FROM provider_settings WHERE provider='lusha') AS credit_limit,(SELECT count(*)::integer FROM security_audit_events WHERE action='provider_limit_changed' AND entity_id='lusha') AS audits")
      assert.deepEqual(state.rows[0], { credit_limit: 30, audits: 2 })
      await pool.query("CREATE FUNCTION reject_enrichment_limit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='provider_limit_changed' AND NEW.entity_id='lusha' THEN RAISE EXCEPTION 'fictional limit audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_enrichment_limit_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_enrichment_limit_audit()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "PATCH", body: { provider: "lusha", monthlyCreditLimit: 31 } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const unchanged = await pool.query("SELECT monthly_credit_limit FROM provider_settings WHERE provider='lusha'")
        assert.equal(unchanged.rows[0].monthly_credit_limit, 30)
      } finally {
        await pool.query("DROP TRIGGER reject_enrichment_limit_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_enrichment_limit_audit()")
      }
    })

    await t.test("Enrichment local Admin actions retain Lusha accounting and audit", async () => {
      await pool.query(enrichmentReconciliationFixtureSql)
      postgresEnrichmentActionSnapshot = await enrichmentLocalActionContract(base, admin.cookie, pcom.cookie)
      const stored = await pool.query("SELECT credits_used,application_units,reconciled_credits,usage_state,reconciliation_source FROM provider_response_history WHERE id=99800")
      assert.deepEqual(stored.rows[0], { credits_used: 2, application_units: 2, reconciled_credits: 2,
        usage_state: "reconciled_account_usage", reconciliation_source: "Fictional account ledger" })
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_usage_reconciled' AND entity_id='99800'")).rows[0].n, 1)
      const raceBody = { action: "reconcile_usage", historyId: 99801, reconciledCredits: 3, reconciliationSource: "Fictional concurrent ledger" }
      const race = await Promise.all(Array.from({ length: 2 }, () => http("/api/enrichment", { cookie: admin.cookie, method: "POST", body: raceBody })))
      assert.deepEqual(race.map(item => item.status).sort(), [200, 409])
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='provider_usage_reconciled' AND entity_id='99801'")).rows[0].n, 1)
      await pool.query("CREATE FUNCTION reject_enrichment_reconciliation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='provider_usage_reconciled' AND NEW.entity_id='99802' THEN RAISE EXCEPTION 'fictional reconciliation audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_enrichment_reconciliation_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_enrichment_reconciliation_audit()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST", body: { action: "reconcile_usage", historyId: 99802, reconciledCredits: 4, reconciliationSource: "Fictional audit failure" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const retained = await pool.query("SELECT credits_used,usage_state FROM provider_response_history WHERE id=99802")
        assert.deepEqual(retained.rows[0], { credits_used: 0, usage_state: "reconciliation_required" })
      } finally {
        await pool.query("DROP TRIGGER reject_enrichment_reconciliation_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_enrichment_reconciliation_audit()")
      }
    })

    await t.test("Admin pre-authorization correction keeps the D1 contract with one concurrent winner", async () => {
      // Approved 2026-11-15: the losing concurrent request gets a sanitized 409 and writes no audit
      // (D1 returns 200/200 or 200/404 and can write a second success audit).
      await pool.query(userCorrectionFixtureSql)
      const post = (cookie, body) => http("/api/admin", { cookie, method: "POST", body })
      const body = { action: "correct_pre_authorization", userId: 99850, correctUserId: 99851, confirmation: "CORRECT USER 99850" }
      assert.equal((await post(undefined, body)).status, 401)
      assert.equal((await post(pcom.cookie, body)).status, 403)
      assert.equal((await post(admin.cookie, { ...body, confirmation: "" })).status, 409)
      assert.equal((await post(admin.cookie, { ...body, userId: 1, confirmation: "CORRECT USER 1" })).status, 409)
      assert.equal((await post(admin.cookie, { ...body, userId: 99855, correctUserId: 99856, confirmation: "CORRECT USER 99855" })).status, 409)
      assert.equal((await post(admin.cookie, { ...body, correctUserId: 99999 })).status, 404)
      assert.deepEqual(await post(admin.cookie, { action: "correct_pre_authorization", userId: "99850" }).then(result => [result.status, result.body]), [400, { error: "Unsupported administration action." }])
      const corrected = await post(admin.cookie, body)
      assert.deepEqual({ status: corrected.status, body: corrected.body }, { status: 200, body: { corrected: true, deletedUserId: 99850, correctUserId: 99851 } })
      assert.equal((await post(admin.cookie, body)).status, 404)
      const concurrentBody = { action: "correct_pre_authorization", userId: 99852, correctUserId: 99854, confirmation: "CORRECT USER 99852" }
      const concurrent = await Promise.all([post(admin.cookie, concurrentBody), post(admin.cookie, concurrentBody)])
      assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409])
      const loser = concurrent.find(result => result.status === 409)
      assert.deepEqual(loser.body, { error: "This pre-authorization was already corrected by a concurrent request." })
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM application_users WHERE id IN (99850,99852)) AS duplicates,(SELECT count(*)::integer FROM application_users WHERE id IN (99851,99854)) AS correct,(SELECT count(*)::integer FROM security_audit_events WHERE action='user_pre_authorization_corrected' AND entity_id='99850') AS first_audits,(SELECT count(*)::integer FROM security_audit_events WHERE action='user_pre_authorization_corrected' AND entity_id='99852') AS race_audits")
      assert.deepEqual(state.rows[0], { duplicates: 0, correct: 2, first_audits: 1, race_audits: 1 })
    })

    await t.test("retained Collect review preflight reads PostgreSQL without attaching identity", async () => {
      await pool.query(collectReviewFixtureSql)
      postgresCollectReviewSnapshot = await collectReviewPreflightContract(base, admin.cookie, pcom.cookie)
      // Approved 2026-11-15: intended identity attachment on PostgreSQL (the D1 identity store fails SQL compilation).
      const confirmPost = () => http("/api/admin/coresignal-collect-review", { cookie: admin.cookie, method: "POST", body: { collectHistoryId: 99901, alumnusId: 99900, confirmed: true, identityReviewed: true, educationReviewed: true } })
      assert.equal((await http("/api/admin/coresignal-collect-review", { cookie: admin.cookie, method: "POST", body: { collectHistoryId: 99901, alumnusId: 99900, confirmed: true } })).status, 400)
      const confirmed = await confirmPost()
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
      assert.deepEqual({ associated: confirmed.body.associatedAlumnusId, outcome: confirmed.body.decision.outcome, wrote: confirmed.body.decision.wroteIdentity, providerCalls: confirmed.body.providerCalls }, { associated: 99900, outcome: "ATTACHED_PROVIDER_ID", wrote: true, providerCalls: 0 })
      const replay = await confirmPost()
      assert.deepEqual({ status: replay.status, outcome: replay.body.decision?.outcome, wrote: replay.body.decision?.wroteIdentity }, { status: 200, outcome: "KNOWN_PROVIDER_ID", wrote: false })
      const attached = await pool.query("SELECT (SELECT coresignal_employee_id FROM alumni WHERE id=99900) AS employee_id,(SELECT alumnus_id FROM provider_response_history WHERE id=99901) AS history_alumnus,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99900 AND field='coresignalEmployeeId') AS identity_history,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_collect_identity_approved' AND entity_id='99901') AS audits")
      assert.deepEqual(attached.rows[0], { employee_id: collectReviewEvidence.returnedEmployeeId, history_alumnus: 99900, identity_history: 1, audits: 2 })
      await pool.query("ALTER TABLE provider_response_history RENAME TO fictional_collect_review_history_unavailable")
      try {
        const failed = await http("/api/admin/coresignal-collect-review", { cookie: admin.cookie, method: "POST", body: { collectHistoryId: 99901, alumnusId: 99900 } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
      } finally {
        await pool.query("ALTER TABLE fictional_collect_review_history_unavailable RENAME TO provider_response_history")
      }
    })

    await t.test("webhook identity attestation and draft preparation preserve Admin gates and atomic audit", async () => {
      await pool.query(webhookSetupFixtureSql)
      await pool.query("CREATE FUNCTION reject_webhook_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('coresignal_base_employee_id_attested','coresignal_webhook_plan_prepared') THEN RAISE EXCEPTION 'fictional webhook setup audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_setup_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_setup_audit()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "attest", alumnusId: 99410, evidenceReference: "Fictional exact mapping", confirmation: "VERIFY_BASE_EMPLOYEE_ID" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_identities WHERE alumnus_id=99410")).rows[0].n, 0)
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_setup_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_webhook_setup_audit()")
      }
      postgresWebhookSetupSnapshot = await webhookSetupContract(base, admin.cookie, pcom.cookie)
      await pool.query("CREATE FUNCTION reject_webhook_prepare_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_webhook_plan_prepared' THEN RAISE EXCEPTION 'fictional draft audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_prepare_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_prepare_audit()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "prepare", cohortType: "FIXED_IDS", ids: [99410], name: "Fictional rejected monitoring batch" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_subscriptions WHERE name='Fictional rejected monitoring batch'")).rows[0].n, 0)
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_prepare_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_webhook_prepare_audit()")
      }
      const state = await pool.query("SELECT (SELECT count(*)::integer FROM coresignal_webhook_identities WHERE alumnus_id=99410) AS identities,(SELECT count(*)::integer FROM coresignal_webhook_subscriptions WHERE name LIKE 'Fictional % monitoring batch') AS drafts,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_base_employee_id_attested' AND entity_id='99410') AS attest_audits,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_webhook_plan_prepared') AS plan_audits")
      assert.deepEqual(state.rows[0], { identities: 1, drafts: 2, attest_audits: 1, plan_audits: 2 })
    })

    await t.test("webhook reconciliation preview records no provider changes and rolls back on persistence failure", async () => {
      const before = await pool.query("SELECT id,last_reconciled_at FROM coresignal_webhook_subscriptions WHERE name='Fictional fixed monitoring batch'")
      const id = before.rows[0].id
      assert.ok(before.rows[0].last_reconciled_at)
      const count = (await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_operations WHERE subscription_id=$1", [id])).rows[0].n
      await pool.query("CREATE FUNCTION reject_webhook_reconcile_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=OLD.id THEN RAISE EXCEPTION 'fictional reconciliation update failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_reconcile_update BEFORE UPDATE ON coresignal_webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION reject_webhook_reconcile_update()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "reconcile", subscriptionId: id } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const after = await pool.query("SELECT last_reconciled_at FROM coresignal_webhook_subscriptions WHERE id=$1", [id])
        assert.equal(after.rows[0].last_reconciled_at, before.rows[0].last_reconciled_at)
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_operations WHERE subscription_id=$1", [id])).rows[0].n, count)
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_reconcile_update ON coresignal_webhook_subscriptions")
        await pool.query("DROP FUNCTION reject_webhook_reconcile_update()")
      }
    })

    await t.test("retained alumni history preserves chronology, pagination, redaction and PCOM access", async () => {
      await pool.query(alumniHistoryFixtureSql)
      postgresAlumniHistorySnapshot = await alumniHistoryContract(base, admin.cookie, pcom.cookie)
      await pool.query("ALTER TABLE alumni_source_observations RENAME TO fictional_history_source_unavailable")
      try {
        const failed = await http("/api/alumni/99420/history", { cookie: admin.cookie })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.doesNotMatch(JSON.stringify(failed.body), /select|params:|alumni_source_observations|postgresql:/i)
      } finally {
        await pool.query("ALTER TABLE fictional_history_source_unavailable RENAME TO alumni_source_observations")
      }
    })

    await t.test("local engagement actions preserve D1 state and atomic audit", async () => {
      await pool.query(engagementLocalFixtureSql)
      postgresEngagementLocalSnapshot = await engagementLocalContract(base, admin.cookie, pcom.cookie)
      const { rows: audits } = await pool.query("SELECT count(*)::integer AS n FROM engagement_audit_log WHERE event_id BETWEEN 99210 AND 99221")
      const { rows: security } = await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE entity_type = 'engagement_event' AND entity_id::integer BETWEEN 99210 AND 99221")
      assert.equal(audits[0].n, 12)
      assert.equal(security[0].n, 12)
      const { rows: history } = await pool.query("SELECT (SELECT count(*) FROM event_views WHERE event_id = 99210)::integer AS views, (SELECT count(*) FROM engagement_responses WHERE event_id = 99218)::integer AS responses, (SELECT count(*) FROM engagement_actions WHERE event_id = 99215)::integer AS actions, (SELECT count(*) FROM field_change_history WHERE alumnus_id = 99230 AND field = 'birthday')::integer AS birthdays")
      assert.deepEqual(history[0], { views: 1, responses: 1, actions: 1, birthdays: 1 })
      await pool.query("CREATE FUNCTION reject_engagement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id = 99223 THEN RAISE EXCEPTION 'fictional audit rejection'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_engagement_audit BEFORE INSERT ON engagement_audit_log FOR EACH ROW EXECUTE FUNCTION reject_engagement_audit()")
      try {
        const failed = await http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "view", eventId: 99223 } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.doesNotMatch(JSON.stringify(failed.body), /fictional audit rejection|postgresql:|params:/i)
        const { rows } = await pool.query("SELECT status, (SELECT count(*) FROM event_views WHERE event_id = 99223)::integer AS views FROM engagement_events WHERE id = 99223")
        assert.deepEqual(rows[0], { status: "New", views: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_engagement_audit ON engagement_audit_log")
        await pool.query("DROP FUNCTION reject_engagement_audit()")
      }
      const competing = await Promise.all([1, 2].map(() => http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "view", eventId: 99222 } })))
      assert.deepEqual(competing.map(item => item.status), [200, 200])
      const { rows: concurrent } = await pool.query("SELECT status, (SELECT count(*) FROM event_views WHERE event_id = 99222)::integer AS views, (SELECT count(*) FROM engagement_audit_log WHERE event_id = 99222)::integer AS audits FROM engagement_events WHERE id = 99222")
      assert.deepEqual(concurrent[0], { status: "Viewed", views: 2, audits: 2 })
    })

    await t.test("authenticated webhook receiver stores, deduplicates and quarantines fictional notices", async () => {
      await pool.query(webhookReceiverFixtureSql)
      postgresWebhookReceiverSnapshot = await webhookReceiverContract(base)
      const { rows } = await pool.query("SELECT employee_id, alumnus_id, status, error_state FROM coresignal_webhook_events WHERE subscription_id = 99460 ORDER BY id")
      assert.deepEqual(rows, [
        { employee_id: "99470001", alumnus_id: 99470, status: "AWAITING_PROFILE_COLLECTION", error_state: "" },
        { employee_id: "99999999", alumnus_id: null, status: "QUARANTINED_UNKNOWN_ID", error_state: "UNKNOWN_EMPLOYEE_ID" },
        { employee_id: "99470001", alumnus_id: 99470, status: "REVIEW_REQUIRED", error_state: "OUT_OF_ORDER" },
        { employee_id: "99470001", alumnus_id: 99470, status: "AWAITING_PROFILE_COLLECTION", error_state: "" },
      ])
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history WHERE operation LIKE '%Webhook%' ")).rows[0].n, 0)
      await pool.query("CREATE FUNCTION reject_webhook_receiver() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.employee_id = '777' THEN RAISE EXCEPTION 'fictional receiver failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_receiver BEFORE INSERT ON coresignal_webhook_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_receiver()")
      try {
        const failed = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { method: "POST", body: [
          { member_id: 99470001, status: "changed", event_id: "fictional-rollback-first" },
          { member_id: 777, status: "changed", event_id: "fictional-rollback-second" },
        ] })
        assert.equal(failed.status, 503)
        assert.deepEqual(failed.body, { error: "Webhook receipt could not be persisted." })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_events WHERE subscription_id = 99460")).rows[0].n, 4)
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_receiver ON coresignal_webhook_events")
        await pool.query("DROP FUNCTION reject_webhook_receiver()")
      }
      await pool.query("UPDATE alumni SET coresignal_employee_id = '99470002' WHERE id = 99470")
      const stale = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { method: "POST", body: [{ member_id: 99470001, status: "changed", event_id: "fictional-stale-identity" }] })
      assert.equal(stale.status, 202)
      assert.equal(stale.body.stored, 1)
      const { rows: staleRows } = await pool.query("SELECT alumnus_id, status, error_state FROM coresignal_webhook_events WHERE subscription_id = 99460 AND employee_id = '99470001' ORDER BY id DESC LIMIT 1")
      assert.deepEqual(staleRows[0], { alumnus_id: null, status: "QUARANTINED_IDENTITY_CONFLICT", error_state: "IDENTITY_MAPPING_CHANGED" })
      await pool.query("UPDATE alumni SET coresignal_employee_id = '99470001' WHERE id = 99470")
      await pool.query("UPDATE coresignal_webhook_subscriptions SET status = 'EXPIRED' WHERE id = 99460")
      const expired = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { method: "POST", body: [{ member_id: 99470001, status: "changed", event_id: "fictional-expired" }] })
      assert.equal(expired.status, 202)
      assert.equal(expired.body.stored, 1)
      const { rows: expiredRows } = await pool.query("SELECT status, error_state FROM coresignal_webhook_events WHERE subscription_id = 99460 ORDER BY id DESC LIMIT 1")
      assert.deepEqual(expiredRows[0], { status: "REVIEW_REQUIRED", error_state: "SUBSCRIPTION_EXPIRED" })
    })

    await t.test("Discovery ignore preserves provenance, replay, concurrent review and audit rollback", async () => {
      await pool.query(discoveryIgnoreFixtureSql)
      postgresDiscoveryIgnoreSnapshot = await discoveryIgnoreContract(base, pcom.cookie)
      const { rows: saved } = await pool.query("SELECT review_status, review_note, reviewed_by FROM external_discovery_results WHERE id=99504")
      assert.deepEqual(saved[0], { review_status: "Ignored", review_note: "Irrelevant", reviewed_by: "Local Development PCOM" })
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='coresignal_result_ignored' AND entity_id='99504'")).rows[0].n, 1)
      await pool.query("CREATE FUNCTION reject_discovery_ignore_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_result_ignored' AND NEW.entity_id='99506' THEN RAISE EXCEPTION 'fictional ignore audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_discovery_ignore_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_discovery_ignore_audit()")
      try {
        const failed = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: { action: "ignore", resultId: 99506, reason: "Wrong person" } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.equal((await pool.query("SELECT review_status FROM external_discovery_results WHERE id=99506")).rows[0].review_status, "Pending review")
      } finally {
        await pool.query("DROP TRIGGER reject_discovery_ignore_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_discovery_ignore_audit()")
      }
      const competing = await Promise.all([1, 2].map(() => http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: { action: "ignore", resultId: 99505, reason: "Other" } })))
      assert.deepEqual(competing.map(item => item.status).sort(), [200, 409])
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='coresignal_result_ignored' AND entity_id='99505'")).rows[0].n, 1)
    })

    await t.test("Discovery keep-separate preserves reviewer evidence, one winner and audit rollback", async () => {
      await pool.query(keepSeparateFixtureSql)
      for (const [id, suffix] of [[99507, "race"], [99508, "rollback"]]) {
        const recorded = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: separateEvidenceBody(id, suffix) })
        assert.equal(recorded.status, 201, JSON.stringify(recorded.body))
      }
      postgresKeepSeparateSnapshot = await keepSeparateContract(base, pcom.cookie, developer)
      assert.deepEqual(postgresKeepSeparateSnapshot.raceStatuses, [201, 409])
      assert.deepEqual(postgresKeepSeparateSnapshot.raceErrors, [])
      const { rows: state } = await pool.query("SELECT r.id,r.review_status,r.linked_internal_alumnus_id,a.profile_key,(SELECT count(*)::integer FROM security_audit_events s WHERE s.action='possible_duplicate_kept_separate' AND s.entity_id=r.id::text) AS audits FROM external_discovery_results r LEFT JOIN alumni a ON a.id=r.linked_internal_alumnus_id WHERE r.id IN (99502,99507) ORDER BY r.id")
      assert.deepEqual(state.map(row => ({ id: row.id, review: row.review_status, linked: Boolean(row.linked_internal_alumnus_id), key: row.profile_key, audits: row.audits })), [
        { id: 99502, review: "Added as separate record", linked: true, key: "coresignal:99501002", audits: 1 },
        { id: 99507, review: "Added as separate record", linked: true, key: "coresignal:99507001", audits: 1 },
      ])
      await pool.query("CREATE FUNCTION reject_keep_separate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='possible_duplicate_kept_separate' AND NEW.entity_id='99508' THEN RAISE EXCEPTION 'fictional separate audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_keep_separate_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_keep_separate_audit()")
      try {
        const failed = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: { action: "keep_separate", resultId: 99508 } })
        assert.equal(failed.status, 500)
        assert.deepEqual(failed.body, { error: "Database operation failed." })
        const { rows } = await pool.query("SELECT review_status,(SELECT count(*)::integer FROM alumni WHERE profile_key='coresignal:99508001') AS people FROM external_discovery_results WHERE id=99508")
        assert.deepEqual(rows[0], { review_status: "Pending review", people: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_keep_separate_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_keep_separate_audit()")
      }
    })

    await t.test("approved Discovery review actions and profile refresh run atomically on PostgreSQL", async () => {
      await pool.query(reviewActionsFixtureSql)
      const discovery = (cookie, body) => http("/api/discovery", { cookie, method: "POST", body })
      for (const [resultId, url] of [[99511, "https://www.linkedin.com/in/fictional-approve-race/"], [99512, "https://www.linkedin.com/in/fictional-link-race/"]]) {
        const recorded = await discovery(pcom.cookie, urlEvidenceBody(resultId, url))
        assert.equal(recorded.status, 201, JSON.stringify(recorded.body))
      }
      // approve: authorization, validation, one concurrent winner, single audit pair.
      assert.equal((await discovery(undefined, { action: "approve", resultIds: [99511] })).status, 401)
      assert.deepEqual(await discovery(pcom.cookie, { action: "approve", resultIds: [] }).then(result => [result.status, result.body]), [400, { error: "Select at least one confirmed degree alumnus." }])
      const approvals = await Promise.all([discovery(pcom.cookie, { action: "approve", resultIds: [99511] }), discovery(pcom.cookie, { action: "approve", resultIds: [99511] })])
      assert.deepEqual(approvals.map(result => result.status).sort(), [201, 409], JSON.stringify(approvals.map(result => result.body)))
      const approved = approvals.find(result => result.status === 201).body
      assert.deepEqual({ count: approved.addedCount, resultId: approved.added[0].resultId, outcome: approved.added[0].identityOutcome }, { count: 1, resultId: 99511, outcome: "NEW_VERIFIED_CANDIDATE" })
      const { rows: [approveState] } = await pool.query("SELECT (SELECT count(*)::integer FROM alumni WHERE profile_key='coresignal:99511001') AS people,(SELECT count(*)::integer FROM external_discovery_results WHERE id=99511 AND review_status<>'Pending review' AND linked_internal_alumnus_id IS NOT NULL) AS reviewed,(SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_approved' AND entity_id='99511') AS audits,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_results_approved') AS batch_audits")
      assert.deepEqual(approveState, { people: 1, reviewed: 1, audits: 1, batch_audits: 1 })
      // link_existing: exact LinkedIn match attaches the provider ID once; the race loser writes nothing.
      const links = await Promise.all([discovery(pcom.cookie, { action: "link_existing", resultId: 99512 }), discovery(pcom.cookie, { action: "link_existing", resultId: 99512 })])
      assert.deepEqual(links.map(result => result.status).sort(), [200, 409], JSON.stringify(links.map(result => result.body)))
      assert.deepEqual(links.find(result => result.status === 200).body, { alumnusId: 99520, identityOutcome: "ATTACHED_PROVIDER_ID" })
      assert.deepEqual(links.find(result => result.status === 409).body, { error: "This discovery result was already linked or changed concurrently." })
      const { rows: [linkState] } = await pool.query("SELECT (SELECT coresignal_employee_id FROM alumni WHERE id=99520) AS employee_id,(SELECT linked_internal_alumnus_id FROM external_discovery_results WHERE id=99512) AS linked,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99520 AND field='coresignalEmployeeId') AS identity_history,(SELECT count(*)::integer FROM security_audit_events WHERE action='external_candidate_identity_linked' AND entity_id='99512') AS audits,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_identity_reconciled' AND entity_id='99520') AS identity_audits")
      assert.deepEqual(linkState, { employee_id: "99512001", linked: 99520, identity_history: 1, audits: 1, identity_audits: 1 })
      // apply_updates: unverified fields are refused; a verified identity field is reviewed once.
      assert.deepEqual(await discovery(pcom.cookie, { action: "apply_updates", resultId: 99512, fields: ["company"] }).then(result => [result.status, result.body]), [409, { error: "Only independently verified selected fields can be applied to an existing alumnus. Provider-only values remain review evidence." }])
      const applies = await Promise.all([discovery(pcom.cookie, { action: "apply_updates", resultId: 99512, fields: ["coresignalEmployeeId", "linkedinUrl"] }), discovery(pcom.cookie, { action: "apply_updates", resultId: 99512, fields: ["coresignalEmployeeId", "linkedinUrl"] })])
      assert.deepEqual(applies.map(result => result.status).sort(), [200, 409], JSON.stringify(applies.map(result => result.body)))
      assert.deepEqual(applies.find(result => result.status === 200).body, { alumnusId: 99520, changedFields: [] })
      const { rows: [applyState] } = await pool.query("SELECT (SELECT review_status FROM external_discovery_results WHERE id=99512) AS review,(SELECT count(*)::integer FROM security_audit_events WHERE action='professional_profile_update_approved' AND entity_id='99520') AS audits")
      assert.deepEqual(applyState, { review: "Reviewed — kept existing", audits: 1 })
      // apply_refresh: stale evidence is refused; selected fields apply once with history; forced audit failure rolls back.
      const enrichment = body => http("/api/enrichment", { cookie: pcom.cookie, method: "POST", body })
      assert.deepEqual(await enrichment({ action: "apply_refresh", reviewId: 99532, fields: ["title"] }).then(result => [result.status, result.body.code]), [409, "STALE_PROFESSIONAL_REVIEW"])
      await pool.query("CREATE FUNCTION reject_refresh_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='professional_profile_update_approved' AND NEW.entity_id='99521' THEN RAISE EXCEPTION 'fictional refresh audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_refresh_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_refresh_audit()")
      try {
        const failed = await enrichment({ action: "apply_refresh", reviewId: 99531, fields: ["company", "location"] })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        const { rows: [rolledBack] } = await pool.query("SELECT (SELECT company FROM alumni WHERE id=99521) AS company,(SELECT status FROM provider_refresh_reviews WHERE id=99531) AS status,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99521) AS history")
        assert.deepEqual(rolledBack, { company: "Fictional Old Co", status: "Pending review", history: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_refresh_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_refresh_audit()")
      }
      const refreshes = await Promise.all([enrichment({ action: "apply_refresh", reviewId: 99531, fields: ["company", "location"] }), enrichment({ action: "apply_refresh", reviewId: 99531, fields: ["company", "location"] })])
      assert.deepEqual(refreshes.map(result => result.status).sort(), [200, 409], JSON.stringify(refreshes.map(result => result.body)))
      assert.deepEqual(refreshes.find(result => result.status === 200).body, { applied: ["company", "location"], alumnusId: 99521 })
      const { rows: [refreshState] } = await pool.query("SELECT company,location,(SELECT status FROM provider_refresh_reviews WHERE id=99531) AS status,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99521) AS history,(SELECT count(*)::integer FROM security_audit_events WHERE action='professional_profile_update_approved' AND entity_id='99521') AS audits FROM alumni WHERE id=99521")
      assert.deepEqual(refreshState, { company: "Fictional New Co", location: "Pune", status: "Applied", history: 2, audits: 1 })
    })

    await t.test("mock webhook renewal and stop preserve state, audit and rollback", async () => {
      await pool.query(webhookLifecycleFixtureSql)
      postgresWebhookLifecycleSnapshot = await webhookLifecycleContract(base, admin.cookie, pcom.cookie)
      const { rows: state } = await pool.query("SELECT s.id, s.status, s.expires_at, (SELECT count(*)::integer FROM coresignal_webhook_coverage c WHERE c.subscription_id=s.id AND c.status='ACTIVE') AS active_coverage, (SELECT count(*)::integer FROM coresignal_webhook_operations o WHERE o.subscription_id=s.id) AS operations, (SELECT count(*)::integer FROM security_audit_events a WHERE a.entity_type='coresignal_webhook_subscriptions' AND a.entity_id=s.id::text AND a.action LIKE 'coresignal_webhook_mock_%') AS audits FROM coresignal_webhook_subscriptions s WHERE s.id IN (99480,99481) ORDER BY s.id")
      assert.deepEqual(state, [
        { id: 99480, status: "ACTIVE", expires_at: postgresWebhookLifecycleSnapshot.renewed.expiresAt, active_coverage: 0, operations: 1, audits: 1 },
        { id: 99481, status: "STOPPED", expires_at: webhookLifecycleExpiresAt, active_coverage: 0, operations: 1, audits: 1 },
      ])
      await pool.query("CREATE FUNCTION reject_webhook_stop_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_webhook_mock_stop' AND NEW.entity_id='99485' THEN RAISE EXCEPTION 'fictional lifecycle audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_stop_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_stop_audit()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "stop", subscriptionId: 99485, confirmation: "STOP 99485" } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const { rows } = await pool.query("SELECT status, (SELECT count(*)::integer FROM coresignal_webhook_operations WHERE subscription_id=99485) AS operations FROM coresignal_webhook_subscriptions WHERE id=99485")
        assert.deepEqual(rows[0], { status: "ACTIVE", operations: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_stop_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_webhook_stop_audit()")
      }
      const competing = await Promise.all([1, 2].map(() => http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "stop", subscriptionId: 99484, confirmation: "STOP 99484" } })))
      assert.deepEqual(competing.map(item => item.status).sort(), [200, 409])
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='coresignal_webhook_mock_stop' AND entity_id='99484'")).rows[0].n, 1)
    })

    await t.test("mock webhook simulation uses the authenticated receiver and records its audit", async () => {
      await pool.query(webhookSimulationFixtureSql)
      const before = await pool.query("SELECT count(*)::integer AS n FROM provider_response_history")
      postgresWebhookSimulationSnapshot = await webhookSimulationContract(base, admin.cookie, pcom.cookie)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_events WHERE subscription_id=99491 AND status='AWAITING_PROFILE_COLLECTION'")).rows[0].n, 1)
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='coresignal_webhook_mock_simulated' AND entity_id='99491'")).rows[0].n, 1)
      assert.deepEqual((await pool.query("SELECT count(*)::integer AS n FROM provider_response_history")).rows[0], before.rows[0])
      await pool.query("CREATE FUNCTION reject_webhook_simulation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_webhook_mock_simulated' AND NEW.entity_id='99491' THEN RAISE EXCEPTION 'fictional simulation audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_simulation_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_webhook_simulation_audit()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "simulate", subscriptionId: 99491, alumnusId: 99490, confirmation: "SIMULATE 99491 99490" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM coresignal_webhook_events WHERE subscription_id=99491")).rows[0].n, 2)
        assert.equal((await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='coresignal_webhook_mock_simulated' AND entity_id='99491'")).rows[0].n, 1)
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_simulation_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_webhook_simulation_audit()")
      }
    })

    await t.test("mock webhook activation claims once and persists coverage or reviewable error", async () => {
      await pool.query(webhookActivationFixtureSql)
      postgresWebhookActivationSnapshot = await webhookActivationContract(base, admin.cookie, pcom.cookie)
      const active = await pool.query("SELECT s.status,s.provider_subscription_id,c.employee_id,o.status AS operation_status,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_webhook_mock_activated' AND entity_id='99686') AS audits FROM coresignal_webhook_subscriptions s JOIN coresignal_webhook_coverage c ON c.subscription_id=s.id JOIN coresignal_webhook_operations o ON o.subscription_id=s.id WHERE s.id=99686")
      assert.equal(active.rows.length, 1)
      assert.deepEqual({ status: active.rows[0].status, employeeId: active.rows[0].employee_id,
        operationStatus: active.rows[0].operation_status, audits: active.rows[0].audits },
      { status: "ACTIVE", employeeId: "99680001", operationStatus: "CONFIRMED", audits: 1 })
      assert.match(active.rows[0].provider_subscription_id, /^mock-base-experience-/)
      const race = await Promise.all([1, 2].map(() => http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST",
        body: { action: "activate", subscriptionId: 99687, confirmation: "ACTIVATE 99687 1" } })))
      assert.deepEqual(race.map(item => item.status).sort(), [200, 409])
      const raceState = await pool.query("SELECT (SELECT count(*)::integer FROM coresignal_webhook_coverage WHERE subscription_id=99687) AS coverage,(SELECT count(*)::integer FROM coresignal_webhook_operations WHERE subscription_id=99687) AS operations,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_webhook_mock_activated' AND entity_id='99687') AS audits")
      assert.deepEqual(raceState.rows[0], { coverage: 1, operations: 1, audits: 1 })
      await pool.query("CREATE FUNCTION reject_webhook_activation_coverage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.employee_id='99682001' THEN RAISE EXCEPTION 'fictional coverage failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_webhook_activation_coverage BEFORE INSERT ON coresignal_webhook_coverage FOR EACH ROW EXECUTE FUNCTION reject_webhook_activation_coverage()")
      try {
        const failed = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST",
          body: { action: "activate", subscriptionId: 99688, confirmation: "ACTIVATE 99688 1" } })
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 409,
          body: { error: "Activation persistence failed; no live provider request occurred." } })
        const failedState = await pool.query("SELECT s.status,s.provider_subscription_id,(SELECT count(*)::integer FROM coresignal_webhook_coverage WHERE subscription_id=99688) AS coverage,(SELECT status FROM coresignal_webhook_operations WHERE subscription_id=99688) AS operation_status,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_webhook_mock_activated' AND entity_id='99688') AS audits FROM coresignal_webhook_subscriptions s WHERE id=99688")
        assert.deepEqual(failedState.rows[0], { status: "ERROR", provider_subscription_id: "", coverage: 0,
          operation_status: "CLAIMED", audits: 0 })
      } finally {
        await pool.query("DROP TRIGGER reject_webhook_activation_coverage ON coresignal_webhook_coverage")
        await pool.query("DROP FUNCTION reject_webhook_activation_coverage()")
      }
    })

    await t.test("engagement bulk preview preserves consent, template and no-write contract", async () => {
      await pool.query(`INSERT INTO message_templates(id,template_key,name,event_type,subject,body,status,version,updated_by)
        VALUES (1,'local-professional-outreach','Local professional outreach','Professional Signal','Connecting with IIM Lucknow',$1,'Approved',1,'Local Development Admin')`,
      ["Hello {{name}},\\n\\nWe would value a conversation with you.\\n\\nRegards,\\nPlacement Committee, IIM Lucknow"])
      await pool.query(engagementBulkPreviewFixtureSql)
      const before = await pool.query("SELECT (SELECT count(*)::integer FROM engagement_actions) AS actions, (SELECT count(*)::integer FROM engagement_audit_log) AS activity, (SELECT count(*)::integer FROM security_audit_events WHERE action LIKE 'engagement_%') AS audit")
      postgresEngagementBulkPreviewSnapshot = await engagementBulkPreviewContract(base, pcom.cookie)
      const after = await pool.query("SELECT (SELECT count(*)::integer FROM engagement_actions) AS actions, (SELECT count(*)::integer FROM engagement_audit_log) AS activity, (SELECT count(*)::integer FROM security_audit_events WHERE action LIKE 'engagement_%') AS audit")
      assert.deepEqual(after.rows[0], before.rows[0])
      await pool.query("ALTER TABLE message_templates RENAME TO fictional_bulk_templates_unavailable")
      try {
        const failed = await http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "bulk_preview", eventIds: [99243] } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.doesNotMatch(JSON.stringify(failed.body), /message_templates|select|params:|postgresql:/i)
      } finally {
        await pool.query("ALTER TABLE fictional_bulk_templates_unavailable RENAME TO message_templates")
      }
    })

    await t.test("engagement single preview preserves draft and paired audit contract", async () => {
      const before = await pool.query("SELECT count(*)::integer AS n FROM engagement_actions")
      postgresEngagementPreviewSnapshot = await engagementPreviewContract(base, pcom.cookie)
      const after = await pool.query("SELECT count(*)::integer AS n FROM engagement_actions")
      assert.deepEqual(after.rows[0], before.rows[0])
      const activity = await pool.query("SELECT event_id,action,details FROM engagement_audit_log WHERE event_id IN (99243,99244) ORDER BY id")
      assert.deepEqual(activity.rows.map(row => [row.event_id, row.action]), [[99243, "draft_generated"], [99244, "draft_failed"]])
      const security = await pool.query("SELECT entity_id,action FROM security_audit_events WHERE entity_id IN ('99243','99244') ORDER BY id")
      assert.deepEqual(security.rows.map(row => [row.entity_id, row.action]), [["99243", "engagement_draft_generated"], ["99244", "engagement_draft_failed"]])
    })

    await t.test("controlled manual email preparation reuses or creates audited draft events", async () => {
      const before = await pool.query("SELECT count(*)::integer AS n FROM engagement_actions")
      postgresManualEmailSnapshot = await manualEmailContract(base, pcom.cookie)
      const after = await pool.query("SELECT count(*)::integer AS n FROM engagement_actions")
      assert.deepEqual(after.rows[0], before.rows[0])
      const events = await pool.query("SELECT id FROM engagement_events WHERE alumnus_id=99247 AND event_type='Manual Relationship'")
      assert.equal(events.rows.length, 1)
      const activity = await pool.query("SELECT event_id,action FROM engagement_audit_log WHERE event_id=99243 OR event_id=$1 ORDER BY id", [events.rows[0].id])
      assert.deepEqual(activity.rows.map(row => row.action), ["draft_generated", "draft_generated", "draft_generated", "draft_generated"])
      const security = await pool.query("SELECT action FROM security_audit_events WHERE (entity_id='99243' OR entity_id=$1) AND action LIKE 'engagement_%' ORDER BY id", [String(events.rows[0].id)])
      assert.deepEqual(security.rows.map(row => row.action), ["engagement_draft_generated", "engagement_draft_generated", "engagement_draft_generated", "engagement_draft_generated"])
    })

    await t.test("manual email preparation serializes duplicate creation and rolls back failed audits", async () => {
      const prepare = () => http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "prepare_manual_email", alumnusId: 99248 } })
      const competing = await Promise.all([prepare(), prepare()])
      assert.deepEqual(competing.map(result => result.status), [200, 200])
      assert.equal(competing[0].body.event.id, competing[1].body.event.id)
      const eventId = competing[0].body.event.id
      const events = await pool.query("SELECT count(*)::integer AS n FROM engagement_events WHERE alumnus_id=99248 AND event_type='Manual Relationship'")
      assert.equal(events.rows[0].n, 1)
      const before = await pool.query("SELECT count(*)::integer AS n FROM engagement_audit_log WHERE event_id=$1", [eventId])
      assert.equal(before.rows[0].n, 2)
      await pool.query("CREATE FUNCTION reject_manual_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='engagement_draft_generated' AND NEW.entity_id=$1 THEN RAISE EXCEPTION 'fictional manual draft audit failure'; END IF; RETURN NEW; END $$".replace("$1", q(String(eventId))))
      await pool.query("CREATE TRIGGER reject_manual_draft_audit_trigger BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_manual_draft_audit()")
      try {
        const failed = await prepare()
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        assert.doesNotMatch(JSON.stringify(failed.body), /security_audit_events|select|insert|params:/i)
      } finally {
        await pool.query("DROP TRIGGER reject_manual_draft_audit_trigger ON security_audit_events")
        await pool.query("DROP FUNCTION reject_manual_draft_audit()")
      }
      const after = await pool.query("SELECT count(*)::integer AS n FROM engagement_audit_log WHERE event_id=$1", [eventId])
      assert.deepEqual(after.rows[0], before.rows[0])
    })

    await t.test("mock engagement send preserves approval, reservation, history and D1 response contract", async () => {
      await pool.query(engagementSendFixtureSql)
      postgresEngagementSendSnapshot = await engagementSendContract(base, pcom.cookie)
      const state = await pool.query(`SELECT e.id,e.status,e.delivery_status,a.outreach_status AS alumnus_status,
        (SELECT count(*)::integer FROM engagement_actions x WHERE x.event_id=e.id) AS actions,
        (SELECT count(*)::integer FROM engagement_audit_log x WHERE x.event_id=e.id AND x.action='email_sent') AS audits,
        (SELECT count(*)::integer FROM security_audit_events x WHERE x.entity_id=e.id::text AND x.action='engagement_email_sent') AS security
        FROM engagement_events e JOIN alumni a ON a.id=e.alumnus_id WHERE e.id BETWEEN 99253 AND 99255 ORDER BY e.id`)
      assert.deepEqual(state.rows.map(row => [row.id,row.status,row.delivery_status,row.alumnus_status,row.actions,row.audits,row.security]),
        [99253,99254,99255].map(id => [id,"Action Taken","Mock sent","Contacted",1,1,1]))
      const failedBeforeDelivery = await pool.query("SELECT action_key,delivery_status,notes FROM engagement_actions WHERE event_id=99258")
      assert.equal(failedBeforeDelivery.rows.length, 1)
      assert.match(failedBeforeDelivery.rows[0].action_key, /^failed:/)
      assert.equal(failedBeforeDelivery.rows[0].delivery_status, "Failed")
      assert.match(failedBeforeDelivery.rows[0].notes, /Recipient, subject, and message are required/)
      const failedAudit = await pool.query("SELECT action FROM engagement_audit_log WHERE event_id=99258")
      assert.deepEqual(failedAudit.rows.map(item => item.action), ["email_send_failed_before_delivery"])
      const interruptedState = await pool.query("SELECT e.status,x.delivery_status,(SELECT count(*)::integer FROM engagement_actions WHERE event_id=e.id) AS actions FROM engagement_events e JOIN engagement_actions x ON x.event_id=e.id WHERE e.id=99260")
      assert.deepEqual(interruptedState.rows[0], { status: "New", delivery_status: "Sending", actions: 1 })
      const competing = await Promise.all([1,2].map(() => http("/api/engagements", { cookie: pcom.cookie,
        method: "POST", body: { action: "send", eventId: 99256, templateId: 99246, approved: true } })))
      assert.deepEqual(competing.map(item => item.status).sort(), [200,409])
      const claim = await pool.query("SELECT count(*)::integer AS n FROM engagement_actions WHERE event_id=99256")
      assert.equal(claim.rows[0].n, 1)
      await pool.query("CREATE FUNCTION reject_fictional_send_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id=99257 AND NEW.action='email_sent' THEN RAISE EXCEPTION 'fictional send audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_send_audit BEFORE INSERT ON engagement_audit_log FOR EACH ROW EXECUTE FUNCTION reject_fictional_send_audit()")
      try {
        const failed = await http("/api/engagements", { cookie: pcom.cookie, method: "POST",
          body: { action: "send", eventId: 99257, templateId: 99246, approved: true } })
        assert.equal(failed.status, 400)
        assert.match(failed.body.error, /reconcile before retrying/i)
        const uncertain = await pool.query("SELECT action_key,delivery_status FROM engagement_actions WHERE event_id=99257")
        assert.equal(uncertain.rows.length, 1)
        assert.match(uncertain.rows[0].action_key, /^mail:/)
        assert.equal(uncertain.rows[0].delivery_status, "Outcome unknown")
        const replay = await http("/api/engagements", { cookie: pcom.cookie, method: "POST",
          body: { action: "send", eventId: 99257, templateId: 99246, approved: true } })
        assert.equal(replay.status, 409)
        const audit = await pool.query("SELECT action FROM engagement_audit_log WHERE event_id=99257")
        assert.deepEqual(audit.rows.map(item => item.action), ["email_send_outcome_unknown"])
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_send_audit ON engagement_audit_log")
        await pool.query("DROP FUNCTION reject_fictional_send_audit()")
      }
    })

    await t.test("Lusha evidence rejection preserves Admin gate, CAS, history and audit order", async () => {
      await pool.query(lushaRejectionFixtureSql)
      postgresLushaRejectionSnapshot = await lushaRejectionContract(base, admin.cookie, pcom.cookie)
      const decisions = await pool.query("SELECT id,status,reviewed_by FROM provider_refresh_reviews WHERE id BETWEEN 99272 AND 99274 ORDER BY id")
      assert.deepEqual(decisions.rows.map(item => [item.id,item.status,Boolean(item.reviewed_by)]),
        [[99272,"Rejected identity",true],[99273,"Rejected contact",true],[99274,"Rejected contact",true]])
      const audits = await pool.query("SELECT action FROM security_audit_events WHERE entity_type='alumnus' AND entity_id='99240' AND action LIKE 'lusha_%_rejected' ORDER BY id")
      assert.deepEqual(audits.rows.map(item => item.action),
        ["lusha_identity_association_rejected","lusha_contact_evidence_rejected","lusha_contact_evidence_rejected"])
      await pool.query("CREATE FUNCTION reject_fictional_lusha_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lusha_contact_evidence_rejected' AND NEW.entity_id='99240' THEN RAISE EXCEPTION 'fictional review audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_lusha_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_fictional_lusha_audit()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
          body: { action: "lusha_reject_contact", reviewId: 99275, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const decision = await pool.query("SELECT status FROM provider_refresh_reviews WHERE id=99275")
        assert.equal(decision.rows[0].status, "Rejected contact")
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_lusha_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_fictional_lusha_audit()")
      }
    })

    await t.test("Lusha contact approval preserves reviewed evidence, privacy, replacement, history and rollback", async () => {
      await pool.query(lushaContactApprovalFixtureSql)
      postgresLushaContactApprovalSnapshot = await lushaContactApprovalContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT r.id,r.status,a.email,a.record_version,a.last_mutation_request_key FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id WHERE r.id BETWEEN 99288 AND 99291 ORDER BY r.id")
      assert.deepEqual(state.rows.map(item => [item.id,item.status,item.email,item.record_version,item.last_mutation_request_key]), [
        [99288,"Applied","one@example.test",2,"lusha-contact-review:99288"],
        [99289,"Applied","race-contact@example.test",2,"lusha-contact-review:99289"],
        [99290,"Applied","replaced@example.test",2,"lusha-contact-review:99290"],
        [99291,"Pending contact review","",1,""]])
      const audits = await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='lusha_contact_evidence_approved' AND entity_id IN ('99280','99281','99282')")
      assert.equal(audits.rows[0].n, 3)
      await pool.query("DELETE FROM alumni_privacy_controls WHERE alumnus_id=99283")
      await pool.query("CREATE FUNCTION reject_fictional_contact_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.alumnus_id=99283 THEN RAISE EXCEPTION 'fictional history failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_contact_history BEFORE INSERT ON field_change_history FOR EACH ROW EXECUTE FUNCTION reject_fictional_contact_history()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
          body: { action: "lusha_approve_contact", reviewId: 99291, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const unchanged = await pool.query("SELECT r.status,a.email,a.record_version FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id WHERE r.id=99291")
        assert.deepEqual(unchanged.rows[0], { status: "Pending contact review", email: "", record_version: 1 })
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_contact_history ON field_change_history")
        await pool.query("DROP FUNCTION reject_fictional_contact_history()")
      }
      await pool.query("CREATE FUNCTION reject_fictional_contact_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lusha_contact_evidence_approved' AND NEW.entity_id='99283' THEN RAISE EXCEPTION 'fictional contact audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_contact_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_fictional_contact_audit()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
          body: { action: "lusha_approve_contact", reviewId: 99291, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const committed = await pool.query("SELECT r.status,a.email,a.record_version,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99283) AS changes FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id WHERE r.id=99291")
        assert.deepEqual(committed.rows[0], { status: "Applied", email: "privacy@example.test", record_version: 2, changes: 1 })
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_contact_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_fictional_contact_audit()")
      }
    })

    await t.test("Lusha identity approval preserves exact identity, provenance, concurrency and rollback", async () => {
      await pool.query(lushaIdentityApprovalFixtureSql)
      postgresLushaIdentityApprovalSnapshot = await lushaIdentityApprovalContract(base, admin.cookie, pcom.cookie)
      const state = await pool.query("SELECT r.id,r.status,a.lusha_person_id,a.record_version,h.status AS history_status FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id JOIN provider_response_history h ON h.id=r.provider_response_id WHERE r.id BETWEEN 99330 AND 99333 ORDER BY r.id")
      assert.deepEqual(state.rows.map(item => [item.id,item.status,item.lusha_person_id,item.record_version,item.history_status]), [
        [99330,"Approved identity","fictional-lusha-identity-one",2,"success"],
        [99331,"Approved identity","fictional-lusha-identity-race",2,"success"],
        [99332,"Pending identity review","",1,"review_required"],
        [99333,"Pending identity review","",2,"review_required"]])
      const audits = await pool.query("SELECT count(*)::integer AS n FROM security_audit_events WHERE action='lusha_identity_association_approved' AND entity_id IN ('99310','99311')")
      assert.equal(audits.rows[0].n, 2)
      await pool.query("UPDATE alumni SET linkedin_url='https://www.linkedin.com/in/fictional-identity-other/' WHERE id=99313")
      await pool.query("CREATE FUNCTION reject_fictional_identity_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.alumnus_id=99312 THEN RAISE EXCEPTION 'fictional identity history failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_identity_history BEFORE INSERT ON field_change_history FOR EACH ROW EXECUTE FUNCTION reject_fictional_identity_history()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
          body: { action: "lusha_approve_identity", reviewId: 99332, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const unchanged = await pool.query("SELECT r.status,a.lusha_person_id,a.record_version,h.status AS history_status FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id JOIN provider_response_history h ON h.id=r.provider_response_id WHERE r.id=99332")
        assert.deepEqual(unchanged.rows[0], { status: "Pending identity review", lusha_person_id: "", record_version: 1, history_status: "review_required" })
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_identity_history ON field_change_history")
        await pool.query("DROP FUNCTION reject_fictional_identity_history()")
      }
      await pool.query("CREATE FUNCTION reject_fictional_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lusha_identity_association_approved' AND NEW.entity_id='99312' THEN RAISE EXCEPTION 'fictional identity audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_fictional_identity_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_fictional_identity_audit()")
      try {
        const failed = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
          body: { action: "lusha_approve_identity", reviewId: 99332, confirmed: true } })
        assert.equal(failed.status, 500)
        assert.equal(failed.body.error, "Database operation failed.")
        const committed = await pool.query("SELECT r.status,a.lusha_person_id,a.record_version,h.status AS history_status,(SELECT count(*)::integer FROM field_change_history WHERE alumnus_id=99312) AS changes FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id JOIN provider_response_history h ON h.id=r.provider_response_id WHERE r.id=99332")
        assert.deepEqual(committed.rows[0], { status: "Approved identity", lusha_person_id: "fictional-lusha-identity-shared", record_version: 2, history_status: "success", changes: 1 })
      } finally {
        await pool.query("DROP TRIGGER reject_fictional_identity_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_fictional_identity_audit()")
      }
    })

    await t.test("mock Collect execute preserves one claim, replay, post-commit audit failure and concurrency", async () => {
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=1000 WHERE provider='coresignal'")
      const readRows = async statement => (await pool.query(statement)).rows
      const auditFailure = async enabled => {
        if (enabled) {
          await pool.query("CREATE FUNCTION reject_mock_collect_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_collect_only_executed' AND NEW.metadata_json LIKE '%99911001%' THEN RAISE EXCEPTION 'fictional Collect audit failure'; END IF; RETURN NEW; END $$")
          await pool.query("CREATE TRIGGER reject_mock_collect_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_mock_collect_audit()")
        } else {
          await pool.query("DROP TRIGGER reject_mock_collect_audit ON security_audit_events")
          await pool.query("DROP FUNCTION reject_mock_collect_audit()")
        }
      }
      const settlementFailure = async enabled => {
        if (enabled) {
          await pool.query("CREATE FUNCTION reject_mock_collect_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='success' AND NEW.alumnus_id=99913 THEN RAISE EXCEPTION 'fictional Collect settlement failure'; END IF; RETURN NEW; END $$")
          await pool.query("CREATE TRIGGER reject_mock_collect_settlement BEFORE UPDATE ON provider_response_history FOR EACH ROW EXECUTE FUNCTION reject_mock_collect_settlement()")
        } else {
          await pool.query("DROP TRIGGER reject_mock_collect_settlement ON provider_response_history")
          await pool.query("DROP FUNCTION reject_mock_collect_settlement()")
        }
      }
      const claimFailure = async enabled => {
        if (enabled) {
          await pool.query("CREATE FUNCTION reject_mock_collect_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.alumnus_id=99915 THEN RAISE EXCEPTION 'fictional Collect claim failure'; END IF; RETURN NEW; END $$")
          await pool.query("CREATE TRIGGER reject_mock_collect_claim BEFORE INSERT ON provider_response_history FOR EACH ROW EXECUTE FUNCTION reject_mock_collect_claim()")
        } else {
          await pool.query("DROP TRIGGER reject_mock_collect_claim ON provider_response_history")
          await pool.query("DROP FUNCTION reject_mock_collect_claim()")
        }
      }
      const setLimit = async value => pool.query("UPDATE provider_settings SET monthly_credit_limit=$1 WHERE provider='coresignal'", [value])
      try { postgresCollectMockExecutionSnapshot = await collectMockExecutionContract(base, admin.cookie, pcom.cookie, readRows, auditFailure, settlementFailure, claimFailure, setLimit) }
      finally { await pool.query("UPDATE provider_settings SET monthly_credit_limit=50 WHERE provider='coresignal'") }
    })

    await t.test("mock External Discovery search stores results atomically on PostgreSQL", async () => {
      const discovery = (cookie, body) => http("/api/discovery", { cookie, method: "POST", body })
      const searchBody = { action: "search", filters: {}, limit: 5, confirmed: false }
      assert.equal((await discovery(undefined, searchBody)).status, 401)
      // The credit fixture intentionally exhausts most of the Coresignal allowance (the 429 path is
      // covered elsewhere); give this subtest headroom and restore the fixture limit afterwards.
      const { rows: [{ monthly_credit_limit: fixtureLimit }] } = await pool.query("SELECT monthly_credit_limit FROM provider_settings WHERE provider='coresignal'")
      await pool.query("UPDATE provider_settings SET monthly_credit_limit=100000 WHERE provider='coresignal'")
      try {
      const counts = async () => (await pool.query("SELECT (SELECT count(*)::integer FROM external_discovery_searches) AS searches,(SELECT count(*)::integer FROM external_discovery_results) AS results,(SELECT count(*)::integer FROM provider_response_history WHERE operation='Education affiliation search') AS history,(SELECT count(*)::integer FROM security_audit_events WHERE action='coresignal_discovery_run') AS audits")).rows[0]
      const before = await counts()
      const searched = await discovery(admin.cookie, searchBody)
      assert.equal(searched.status, 200, JSON.stringify(searched.body))
      postgresSearchSnapshot = { returned: searched.body.returnedCount, stored: searched.body.storedResultCount, units: searched.body.applicationUnits, keys: Object.keys(searched.body).sort() }
      assert.ok(searched.body.returnedCount > 0 && searched.body.storedResultCount > 0, JSON.stringify(postgresSearchSnapshot))
      assert.deepEqual(await counts(), { searches: before.searches + 1, results: before.results + searched.body.storedResultCount, history: before.history + 1, audits: before.audits + 1 })
      const { rows: [linked] } = await pool.query("SELECT (SELECT count(*)::integer FROM external_discovery_results WHERE search_id=$1) AS results,(SELECT count(*)::integer FROM provider_response_history WHERE search_id=$1 AND status='success' AND mode='mock') AS history", [searched.body.searchId])
      assert.deepEqual(linked, { results: searched.body.storedResultCount, history: 1 })
      // A failed audit rolls back the search, its results and its provider history.
      await pool.query("CREATE FUNCTION reject_discovery_run_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='coresignal_discovery_run' THEN RAISE EXCEPTION 'fictional discovery audit failure'; END IF; RETURN NEW; END $$")
      await pool.query("CREATE TRIGGER reject_discovery_run_audit BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION reject_discovery_run_audit()")
      try {
        const settled = await counts()
        const failed = await discovery(admin.cookie, searchBody)
        assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: "Database operation failed." } })
        assert.deepEqual(await counts(), settled)
      } finally {
        await pool.query("DROP TRIGGER reject_discovery_run_audit ON security_audit_events")
        await pool.query("DROP FUNCTION reject_discovery_run_audit()")
      }
      // continue_search keeps D1's gate responses instead of failing at the D1 handle.
      assert.deepEqual(await discovery(pcom.cookie, { action: "continue_search", searchId: searched.body.searchId, page: 2, confirmed: true }).then(result => [result.status, result.body.reason]), [403, "admin_required"])
      assert.deepEqual(await discovery(admin.cookie, { action: "continue_search", searchId: searched.body.searchId, page: 2, confirmed: true }).then(result => [result.status, result.body.reason, result.body.providerCallMade]), [403, "preview_unavailable", false])
      } finally {
        await pool.query("UPDATE provider_settings SET monthly_credit_limit=$1 WHERE provider='coresignal'", [fixtureLimit])
      }
    })

    await t.test("mock dataset preview and removal keep the Admin contract on PostgreSQL", async () => {
      const adminPost = (cookie, body) => http("/api/admin", { cookie, method: "POST", body })
      assert.equal((await adminPost(undefined, { action: "preview_mock_cleanup" })).status, 401)
      assert.equal((await adminPost(pcom.cookie, { action: "preview_mock_cleanup" })).status, 403)
      const preview = await adminPost(admin.cookie, { action: "preview_mock_cleanup" })
      if (preview.status !== 200) await writeFile(join(tmpdir(), "cn-cleanup-preview-server.log"), childLog)
      assert.equal(preview.status, 200, `${JSON.stringify(preview.body)}
server log tail:
${childLog.slice(-1500)}`)
      assert.deepEqual(Object.keys(preview.body).sort(), ["foreignKeys", "integrity", "inventory"])
      assert.deepEqual({ integrity: preview.body.integrity, foreignKeys: preview.body.foreignKeys }, { integrity: [{ integrity_check: "ok" }], foreignKeys: [] })
      assert.ok(Array.isArray(preview.body.inventory.ambiguous) && preview.body.inventory.counts && preview.body.inventory.ids)
      assert.deepEqual(await adminPost(admin.cookie, { action: "remove_mock_dataset", confirmation: "" }).then(result => [result.status, result.body]), [409, { error: "Type CLEANUP to confirm." }])
      const before = (await pool.query("SELECT (SELECT count(*)::integer FROM alumni) AS alumni,(SELECT count(*)::integer FROM security_audit_events WHERE action='mock_dataset_removed') AS audits")).rows[0]
      const removed = await adminPost(admin.cookie, { action: "remove_mock_dataset", confirmation: "CLEANUP" })
      const after = (await pool.query("SELECT (SELECT count(*)::integer FROM alumni) AS alumni,(SELECT count(*)::integer FROM security_audit_events WHERE action='mock_dataset_removed') AS audits")).rows[0]
      if (preview.body.inventory.ambiguous.length) {
        // D1 contract: ambiguous records stop the cleanup before any write.
        assert.deepEqual({ status: removed.status, error: removed.body.error }, { status: 409, error: "Cleanup stopped because ambiguous records require review." })
        assert.deepEqual(after, before)
      } else {
        // The cleanup inventory (unchanged from D1) predates 17 foreign keys from newer tables
        // (evidence, intakes, webhook identities, opportunities, ...). When such rows reference the
        // dataset, the delete cannot succeed on either backend; PostgreSQL rolls back atomically.
        if (removed.status === 500) {
          assert.deepEqual(removed.body, { error: "Database operation failed." })
          assert.deepEqual(after, before)
          return
        }
        assert.equal(removed.status, 200, JSON.stringify(removed.body))
        assert.equal(removed.body.final.alumni, after.alumni)
        assert.equal(before.alumni - after.alumni, removed.body.removed.alumni)
        assert.deepEqual({ integrity: removed.body.final.integrity, foreignKeys: removed.body.final.foreignKeys }, { integrity: [{ integrity_check: "ok" }], foreignKeys: [] })
        assert.equal(after.audits, before.audits + 1)
      }
    })

    await t.test("connection failure returns 5xx without SQL text or D1 fallback", async () => {
      await pool.end()
      pool = undefined
      await command("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"])
      started = false
      const failed = await http("/api/directory", { cookie: admin.cookie })
      assert.equal(failed.status, 500)
      assert.equal(failed.body.error, "Database operation failed.")
      const failedHistory = await http("/api/alumni/99420/history", { cookie: admin.cookie })
      assert.ok(failedHistory.status >= 500)
      assert.match(failedHistory.body.error, /^(Database operation failed\.|Database connection is unavailable\.|Unable to load saved history\. Please retry later and provide the request ID to the administrator\.)$/)
      assert.doesNotMatch(JSON.stringify(failedHistory.body), /select|params:|alumni_source_observations|postgresql:/i)
      const failedPreview = await http("/api/imports", { cookie: pcom.cookie, method: "POST", body: { action: "preview", filename: "fictional.csv", records: [{ source_alumni_id: "OFFLINE", source_system: "fixture", name: "Offline Example", programme: "PGP", graduation_year: "2020" }] } })
      assert.ok(failedPreview.status >= 500)
      assert.match(failedPreview.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedExecution = await http("/api/imports", { cookie: admin.cookie, method: "POST", body: { action: "execute", filename: "fictional.csv", records: [{ source_alumni_id: "OFFLINE", source_system: "fixture", name: "Offline Example", programme: "PGP", graduation_year: "2020" }], previewId: "offline", confirmed: true } })
      assert.ok(failedExecution.status >= 500)
      assert.match(failedExecution.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      assert.doesNotMatch(JSON.stringify(failedExecution.body), /select|params:|mutation_requests|postgresql:/i)
      const failedBright = await http("/api/intelligence/bright-eligibility/revalidate", { method: "POST", body: { records: [{ sourceId: "cn:2", intelligenceAlumniId: "fictional-intelligence-id", normalizedLinkedinUrl: "https://www.linkedin.com/in/fictional-bright" }] }, extraHeaders: { authorization: `Bearer ${serviceSecret}` } })
      assert.ok(failedBright.status >= 500)
      assert.match(failedBright.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedExport = await exportHttp(base, admin.cookie, { scope: "admin", format: "csv", datasets: ["programmes"] })
      assert.ok(failedExport.status >= 500)
      assert.match(JSON.parse(failedExport.body).error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedIntake = await http("/api/discovery/intake", { cookie: pcom.cookie, method: "POST", body: { action: "preflight", resultIds: [intakeResultId] } })
      assert.ok(failedIntake.status >= 500)
      assert.match(failedIntake.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedIntelligence = await http("/api/intelligence/profile/1", { cookie: pcom.cookie })
      assert.ok(failedIntelligence.status >= 500)
      assert.match(failedIntelligence.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedSelection = await http("/api/intelligence/refresh/preview", { cookie: pcom.cookie, method: "POST", body: { cohortType: "DYNAMIC_FILTER", mode: "mock", maxProfiles: 5, filter: { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: {}, includeCnAlumniIds: [], excludeCnAlumniIds: [] } } })
      assert.ok(failedSelection.status >= 500)
      assert.match(failedSelection.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedDiscovery = await http("/api/discovery", { cookie: pcom.cookie })
      assert.equal(failedDiscovery.status, 500)
      assert.match(failedDiscovery.body.error, /^(Database operation failed\.|Unable to load saved history\. Please retry later and provide the request ID to the administrator\.)$/)
      const failedDiscoveryIgnore = await http("/api/discovery", { cookie: pcom.cookie, method: "POST", body: { action: "ignore", resultId: 99506, reason: "Other" } })
      assert.equal(failedDiscoveryIgnore.status, 500)
      assert.equal(failedDiscoveryIgnore.body.error, "Database operation failed.")
      const failedOpportunities = await http("/api/opportunities", { cookie: pcom.cookie })
      assert.ok(failedOpportunities.status >= 500)
      assert.match(failedOpportunities.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedOpportunityPost = await http("/api/opportunities", { cookie: pcom.cookie, method: "POST", body: { idempotencyKey: "db-down-opportunity", company: "Fictional Opportunity Co", ownerUserId: 1, title: "Offline" } })
      assert.ok(failedOpportunityPost.status >= 500)
      assert.match(failedOpportunityPost.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedOpportunityPatch = await http("/api/opportunities", { cookie: pcom.cookie, method: "PATCH", body: { id: 99100, version: 1, title: "Offline" } })
      assert.ok(failedOpportunityPatch.status >= 500)
      assert.match(failedOpportunityPatch.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEngagements = await http("/api/engagements", { cookie: pcom.cookie })
      assert.ok(failedEngagements.status >= 500)
      assert.match(failedEngagements.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEngagementPost = await http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "view", eventId: 99222 } })
      assert.ok(failedEngagementPost.status >= 500)
      assert.match(failedEngagementPost.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      assert.doesNotMatch(JSON.stringify(failedEngagementPost.body), /select|params:|postgresql:/i)
      const failedBulkPreview = await http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "bulk_preview", eventIds: [99243] } })
      assert.ok(failedBulkPreview.status >= 500)
      assert.match(failedBulkPreview.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEngagementPreview = await http("/api/engagements", { cookie: pcom.cookie, method: "POST", body: { action: "preview", eventId: 99243, templateId: 99246 } })
      assert.ok(failedEngagementPreview.status >= 500)
      assert.match(failedEngagementPreview.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedCollectOverview = await http("/api/admin/coresignal-collect", { cookie: admin.cookie })
      assert.ok(failedCollectOverview.status >= 500)
      assert.match(failedCollectOverview.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEnrichment = await http("/api/enrichment", { cookie: admin.cookie })
      assert.ok(failedEnrichment.status >= 500)
      assert.match(failedEnrichment.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEnrichmentLimit = await http("/api/enrichment", { cookie: admin.cookie, method: "PATCH", body: { provider: "lusha", monthlyCreditLimit: 32 } })
      assert.ok(failedEnrichmentLimit.status >= 500)
      assert.match(failedEnrichmentLimit.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedEnrichmentReconciliation = await http("/api/enrichment", { cookie: admin.cookie, method: "POST", body: { action: "reconcile_usage", historyId: 99802, reconciledCredits: 4, reconciliationSource: "Fictional offline ledger" } })
      assert.ok(failedEnrichmentReconciliation.status >= 500)
      assert.match(failedEnrichmentReconciliation.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedContactApproval = await http("/api/enrichment", { cookie: admin.cookie, method: "POST",
        body: { action: "lusha_approve_contact", reviewId: 99291, confirmed: true } })
      assert.ok(failedContactApproval.status >= 500)
      assert.match(failedContactApproval.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      assert.doesNotMatch(JSON.stringify(failedContactApproval.body), /select|params:|provider_refresh_reviews|postgresql:/i)
      const failedBrightAdmin = await http("/api/admin/bright-data", { cookie: admin.cookie })
      assert.ok(failedBrightAdmin.status >= 500)
      assert.doesNotMatch(JSON.stringify(failedBrightAdmin.body), /select|params:|postgresql:/i)
      const blockedUserCorrection = await http("/api/admin", { cookie: admin.cookie, method: "POST", body: { action: "correct_pre_authorization", userId: 99850, correctUserId: 99851, confirmation: "CORRECT USER 99850" } })
      assert.equal(blockedUserCorrection.status, 500)
      assert.match(blockedUserCorrection.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedWebhookOverview = await http("/api/intelligence/webhooks", { cookie: pcom.cookie })
      assert.ok(failedWebhookOverview.status >= 500)
      assert.match(failedWebhookOverview.body.error, /^Database (operation failed|connection is unavailable)\.$/)
      const failedWebhookStop = await http("/api/intelligence/webhooks", { cookie: admin.cookie, method: "POST", body: { action: "stop", subscriptionId: 99485, confirmation: "STOP 99485" } })
      assert.equal(failedWebhookStop.status, 500)
      assert.equal(failedWebhookStop.body.error, "Database operation failed.")
      const failedReceiver = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { method: "POST", body: [{ member_id: 99470001, status: "changed", event_id: "fictional-outage" }] })
      assert.equal(failedReceiver.status, 503)
      assert.deepEqual(failedReceiver.body, { error: "Webhook receipt could not be persisted." })
      const failedProfile = await profilePatch(admin.cookie, { expectedVersion: 1, fields: { note: "Connection failure" } }, "step3d-db-down")
      assert.equal(failedProfile.status, 500)
      assert.equal(failedProfile.body.error, "Database operation failed.")
      const failedWorkspace = await workspacePatch(admin.cookie, { action: "update_priority", company: "DB Down Co", priority: "High" })
      assert.equal(failedWorkspace.status, 500)
      assert.equal(failedWorkspace.body.error, "Database operation failed.")
      const protectedLifecycle = await http("/api/admin/lifecycle", { cookie: admin.cookie })
      assert.equal(protectedLifecycle.status, 500)
      assert.deepEqual(protectedLifecycle.body, { error: "Database operation failed." })
      assert.doesNotMatch(JSON.stringify(protectedLifecycle.body), /select|params:|application_identities|postgresql:/i)
      await command("pg_ctl", ["-D", dataDir, "-l", join(temporary, "postgres.log"), "-w", "start"])
      started = true
      const recovered = await http("/api/directory", { cookie: admin.cookie })
      assert.equal(recovered.status, 200)
    })
  } catch (error) {
    if (childLog) console.error("Step 3C local app log tail:\n", childLog)
    throw error
  } finally {
    if (authVite) await authVite.close()
    if (intelligenceMock) await new Promise(resolve => intelligenceMock.close(resolve))
    if (child) {
      child.kill("SIGINT")
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
      if (child.exitCode === null) child.kill("SIGKILL")
    }
    if (pool) await pool.end()
    if (started) await command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"])
    await rm(temporary, { recursive: true, force: true })
  }
})

test("D1 Admin programme route retains the same HTTP contract on a separate disposable fixture", async () => {
  const origin = "http://127.0.0.1:3104"
  await portAvailable(3104)
  const temporary = await mkdtemp(httpTemporaryPrefix("cn-step3c-d1"))
  let child
  let childLog = ""
  try {
    const d1Args = ["DB", "--config", "wrangler.local.jsonc", "--local", "--persist-to", temporary]
    const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js")
    await run(process.execPath, [wrangler, "d1", "migrations", "apply", ...d1Args], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", "scripts/local-development-fixture.sql", "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const creditFixturePath = join(temporary, "credit-fixture.sql")
    await writeFile(creditFixturePath, creditFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", creditFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const intakeFixturePath = join(temporary, "intake-fixture.sql")
    await writeFile(intakeFixturePath, intakeFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", intakeFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const discoveryEvidenceFixturePath = join(temporary, "discovery-evidence-fixture.sql")
    await writeFile(discoveryEvidenceFixturePath, discoveryEvidenceFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", discoveryEvidenceFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const opportunityFixturePath = join(temporary, "opportunity-fixture.sql")
    await writeFile(opportunityFixturePath, opportunityFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", opportunityFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const engagementFixturePath = join(temporary, "engagement-fixture.sql")
    await writeFile(engagementFixturePath, engagementFixtureSql(15))
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", engagementFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const brightFixturePath = join(temporary, "bright-fixture.sql")
    await writeFile(brightFixturePath, brightFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", brightFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const webhookOverviewFixturePath = join(temporary, "webhook-overview-fixture.sql")
    await writeFile(webhookOverviewFixturePath, webhookOverviewFixtureSql(15))
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookOverviewFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const environment = { ...process.env, NODE_ENV: "development", CN_DB_BACKEND: "d1", LOCAL_DEV_AUTH_ENABLED: "true", LOCAL_DEV_AUTH_ROLE: "ADMIN", LOCAL_DEV_D1_PERSIST_PATH: temporary, AUTH_SESSION_SECRET: secret, INTELLIGENCE_SERVICE_SECRET: serviceSecret, CORESIGNAL_API_KEY: "", CORESIGNAL_LIVE_ENABLED: "false", CORESIGNAL_SEARCH_ENABLED: "false", CORESIGNAL_COLLECT_ENABLED: "true", CORESIGNAL_COLLECT_ENTITLEMENT: "confirmed", CORESIGNAL_COLLECT_MOCK_TRANSPORT: "true", LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1", CORESIGNAL_WEBHOOK_MOCK_TRANSPORT: "true", CORESIGNAL_WEBHOOK_RECEIVE_ENABLED: "true", CORESIGNAL_WEBHOOK_CALLBACK_SECRET: webhookSecret, LUSHA_LIVE_ENABLED: "false", LUSHA_API_KEY: "", BRIGHTDATA_LIVE_ENABLED: "true", BRIGHTDATA_API_TOKEN: "fictional-never-send", BRIGHTDATA_DATASET_ID: "fictional-trial-dataset", BRIGHTDATA_HUMAN_TRIAL_ENABLED: "true", BRIGHTDATA_HUMAN_TRIAL_TARGET: brightTrialUrl, BRIGHTDATA_MOCK_TRANSPORT: "false", BRIGHTDATA_ACCESS_ENTITLEMENT: "unknown", BRIGHTDATA_APPLICATION_REQUEST_LIMIT: "5", LOCAL_PROVIDER_LIVE_DEMO_ENABLED: "true", LOCAL_PROVIDER_LIVE_DEMO_HOST: "127.0.0.1", MAIL_MODE: "mock", MAIL_LIVE_ENABLED: "false", MAIL_PROVIDER: "gmail", GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "", GMAIL_REFRESH_TOKEN: "", WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" }
    delete environment.DATABASE_URL
    delete environment.DATABASE_URL_UNPOOLED
    delete environment.CN_PG_LOCAL_TEST_ENABLED
    delete environment.CN_PG_LOCAL_TEST_SOCKET
    child = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "3104", "--strictPort"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.on("data", data => { childLog = (childLog + data.toString()).slice(-4000) })
    child.stderr.on("data", data => { childLog = (childLog + data.toString()).slice(-4000) })
    const until = Date.now() + appStartupMs
    while (Date.now() < until) {
      if (child.exitCode !== null) throw new Error(`D1 app exited: ${child.exitCode}`)
      try { if ((await http("/api/directory", { origin })).status === 401) break } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assertNoDotEnvSecrets(childLog)
    const admin = await http("/auth/local/start?intent=admin", { origin })
    const pcom = await http("/auth/local/start?intent=pcom", { origin })
    assert.equal(admin.status, 302)
    assert.equal(pcom.status, 302)
    if (process.env.CN_PG_STRESS_DIAGNOSTIC === "true") {
      for (const count of [5, 10, 20]) {
        const startedAt = Date.now()
        const results = await Promise.all(Array.from({ length: count }, async () => {
          const before = Date.now()
          const response = await http("/api/admin", { origin, cookie: admin.cookie, timeoutMs: 12_000 })
          return { status: response.status, ms: Date.now() - before }
        }))
        const timings = results.map(result => result.ms).sort((a, b) => a - b)
        const statuses = results.reduce((counts, result) => ({ ...counts, [result.status]: (counts[result.status] ?? 0) + 1 }), {})
        console.log("CN_D1_STRESS", JSON.stringify({ count, statuses, totalMs: Date.now() - startedAt, p95Ms: timings[Math.ceil(0.95 * timings.length) - 1] }))
        assert.deepEqual(statuses, { 200: count })
      }
      assert.equal((await http("/api/admin", { origin, cookie: admin.cookie })).status, 200)
      return
    }
    for (const [action, key] of [["validate_signals_entitlement", "signals"], ["validate_gmail_connectivity", "gmail"]]) {
      const response = await http("/api/admin", { origin, cookie: admin.cookie, method: "POST", body: { action } })
      assert.equal(response.status, 200)
      assert.deepEqual({ ...response.body.validation, checkedAt: null }, postgresAdminValidationSnapshot[key])
    }
    const { stdout: validationAuditJson } = await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", "SELECT action,result,metadata_json FROM security_audit_events WHERE action IN ('lusha_signals_entitlement_validated','gmail_connectivity_validated') ORDER BY action", "--json"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const validationAudits = JSON.parse(validationAuditJson)[0].results
    assert.deepEqual(validationAudits.map(row => [row.action, row.result]), [["gmail_connectivity_validated", "failed"], ["lusha_signals_entitlement_validated", "unknown"]])
    assert.deepEqual(validationAudits.map(row => JSON.parse(row.metadata_json).outcome), ["configuration_missing", "key_missing"])
    for (const [cookie, status] of [[undefined, 401], [pcom.cookie, 403], [admin.cookie, 409]]) {
      const response = await http("/api/enrichment", { origin, cookie, method: "POST", body: { action: "validate_lusha" } })
      assert.equal(response.status, status)
      if (status === 409) assert.deepEqual(response.body, { error: "Lusha LIVE and its server-side API key must both be configured." })
    }
    const creditResponse = await http("/api/admin/provider-credits", { origin, cookie: admin.cookie })
    const d1Bright = await http("/api/intelligence/bright-eligibility/revalidate", { origin, method: "POST",
      body: { records: [{ sourceId: "cn:99999", intelligenceAlumniId: "fictional-intelligence-id", normalizedLinkedinUrl: "https://www.linkedin.com/in/fictional-bright" }] },
      extraHeaders: { authorization: `Bearer ${serviceSecret}` } })
    assert.equal(d1Bright.status, 200)
    assert.deepEqual(d1Bright.body.results, postgresBrightMissingSnapshot)
    assert.equal(creditResponse.status, 200, JSON.stringify(creditResponse.body))
    assert.ok(postgresCreditSnapshot)
    assert.deepEqual(creditResponse.body, postgresCreditSnapshot)
    const d1CollectOverview = await http("/api/admin/coresignal-collect", { origin, cookie: admin.cookie })
    assert.equal(d1CollectOverview.status, 200, JSON.stringify(d1CollectOverview.body))
    assert.deepEqual(d1CollectOverview.body, postgresCollectOverviewSnapshot)
    const manualObservation = { ...creditObservation("lusha", "general", 7, "credits"), observedAt: manualCreditObserved, sourceDetail: "Fictional manual attestation" }
    const creditPost = (cookie, body) => http("/api/admin/provider-credits", { origin, cookie, method: "POST", body })
    assert.equal((await creditPost(undefined, { action: "attest", confirmed: true, observation: manualObservation })).status, 401)
    assert.equal((await creditPost(pcom.cookie, { action: "attest", confirmed: true, observation: manualObservation })).status, 403)
    assert.equal((await creditPost(admin.cookie, { action: "attest", confirmed: false, observation: manualObservation })).status, 400)
    assert.equal((await creditPost(admin.cookie, { action: "attest", confirmed: true, observation: { ...manualObservation, available: -1 } })).status, 400)
    const d1Attested = await creditPost(admin.cookie, { action: "attest", confirmed: true, observation: manualObservation })
    assert.equal(d1Attested.status, 200, JSON.stringify(d1Attested.body))
    assert.deepEqual(d1Attested.body, postgresCreditAttestSnapshot)
    for (const path of ["/api/admin", "/api/admin/lifecycle"]) {
      assert.equal((await http(path, { origin })).status, 401)
      assert.equal((await http(path, { origin, cookie: pcom.cookie })).status, 403)
    }
    const d1Summary = await http("/api/admin", { origin, cookie: admin.cookie })
    assert.equal(d1Summary.status, 200, JSON.stringify(d1Summary.body))
    assert.deepEqual(Object.keys(d1Summary.body).sort(), ["audit", "lifecycle", "operationalReadiness", "programmeOptions", "providerCompanyAliases", "providerCompanyMappings", "providerLimits", "users"].sort())
    const d1Lifecycle = await http("/api/admin/lifecycle?search=absent-fixture", { origin, cookie: admin.cookie })
    assert.deepEqual({ status: d1Lifecycle.status, items: d1Lifecycle.body.items, total: d1Lifecycle.body.total, pageCount: d1Lifecycle.body.pageCount }, { status: 200, items: [], total: 0, pageCount: 1 })
    assert.deepEqual(await adminLocalContract(origin, admin.cookie, pcom.cookie, 15), postgresAdminLocalSnapshot)
    const anonymizeFixturePath = join(temporary, "anonymize-fixture.sql")
    await writeFile(anonymizeFixturePath, anonymizeFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", anonymizeFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    assert.deepEqual(await anonymizeContract(origin, admin.cookie, pcom.cookie), postgresAnonymizeSnapshot)
    assert.deepEqual(await importPreviewContract(origin, admin.cookie, pcom.cookie, 15), postgresImportPreviewSnapshot)
    assert.deepEqual(await workspaceImportContract(origin, admin.cookie, pcom.cookie), postgresWorkspaceImportSnapshot)
    const d1PartialFailure = await http("/api/workspace", { origin, cookie: admin.cookie, method: "POST", body: workspacePartialFailureBody })
    assert.equal(d1PartialFailure.status, 400, JSON.stringify(d1PartialFailure.body))
    const d1PartialState = await http("/api/workspace?includeAlumni=true", { origin, cookie: admin.cookie })
    assert.equal(d1PartialState.status, 200, JSON.stringify(d1PartialState.body))
    assert.deepEqual(d1PartialState.body.alumni.filter(person => person.name.startsWith("Fictional Partial")).map(person => person.name), ["Fictional Partial First"])
    assert.deepEqual(await professionalVerificationContract(origin, admin.cookie, pcom.cookie, 15), postgresProfessionalVerificationSnapshot)
    const d1IntakePreflight = await http("/api/discovery/intake", { origin, cookie: pcom.cookie, method: "POST", body: { action: "preflight", resultIds: [intakeResultId] } })
    assert.equal(d1IntakePreflight.status, 200, JSON.stringify(d1IntakePreflight.body))
    assert.deepEqual(d1IntakePreflight.body, postgresIntakePreflightSnapshot)
    const d1DiscoverySummary = await http("/api/discovery", { origin, cookie: pcom.cookie })
    assert.equal(d1DiscoverySummary.status, 200)
    assert.ok(d1DiscoverySummary.body.searches.some(item => item.id === intakeSearchId))
    const d1DiscoveryPending = await http(`/api/discovery?view=pending&searchId=${intakeSearchId}`, { origin, cookie: pcom.cookie })
    assert.equal(d1DiscoveryPending.status, 200, JSON.stringify(d1DiscoveryPending.body))
    assert.equal(d1DiscoveryPending.body.results.find(item => item.id === intakeResultId)?.providerIntegrity, "consistent")
    const d1EvidenceBody = evidenceBody(discoveryEvidenceResultId)
    const d1InvalidEvidence = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: { ...d1EvidenceBody, observation: { ...d1EvidenceBody.observation, sourceType: "BAD_SOURCE" } } })
    assert.deepEqual(d1InvalidEvidence, postgresDiscoveryEvidenceInvalidSnapshot)
    const d1SavedEvidence = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: d1EvidenceBody })
    assert.equal(d1SavedEvidence.status, 201, JSON.stringify(d1SavedEvidence.body))
    const d1ReplayEvidence = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: d1EvidenceBody })
    const d1RevisedEvidence = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: evidenceBody(discoveryEvidenceResultId, "UNVERIFIED", "Fictional reviewer explains the changed conclusion in detail.") })
    assert.equal(d1RevisedEvidence.status, 201, JSON.stringify(d1RevisedEvidence.body))
    assert.deepEqual({ status: d1SavedEvidence.status, decision: d1SavedEvidence.body.evidence.reviewerDecision, provenance: d1SavedEvidence.body.evidence.sourceProvenance, replay: d1ReplayEvidence.body.duplicate, revision: d1RevisedEvidence.body.evidence.reviewerDecision }, postgresDiscoveryEvidenceSnapshot)
    const d1Plan = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: { action: "plan", filters: { company: "Fictional never searched" }, graduationYears: [2020, 2021] } })
    assert.equal(d1Plan.status, 200, JSON.stringify(d1Plan.body))
    assert.deepEqual(d1Plan.body, postgresDiscoveryPlanSnapshot)
    const d1SearchPreflight = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: { action: "regular_search_preflight", filters: { company: "Fictional unmapped company" }, limit: 1 } })
    assert.equal(d1SearchPreflight.status, 200, JSON.stringify(d1SearchPreflight.body))
    assert.deepEqual(d1SearchPreflight.body, postgresSearchPreflightSnapshot)
    const d1Opportunity = await http("/api/opportunities?company=fictional%20opportunity%20co", { origin, cookie: pcom.cookie })
    assert.equal(d1Opportunity.status, 200, JSON.stringify(d1Opportunity.body))
    assert.equal(d1Opportunity.body.total, 1)
    assert.equal(d1Opportunity.body.opportunities[0].history[0].summary, "Fictional creation history")
    assert.equal((await http("/api/opportunities?id=bad", { origin, cookie: pcom.cookie })).status, 400)
    const d1Engagements = await http("/api/engagements", { origin, cookie: pcom.cookie })
    assert.equal(d1Engagements.status, 200, JSON.stringify(d1Engagements.body))
    assert.equal(d1Engagements.body.events.find(item => item.id === 99200)?.eventTitle, "Fictional committee follow-up")
    assert.equal(d1Engagements.body.events.find(item => item.id === 99200)?.owner?.displayName, "Local Development PCOM")
    const d1Enrichment = await http("/api/enrichment", { origin, cookie: admin.cookie })
    assert.equal(d1Enrichment.status, 200, JSON.stringify(d1Enrichment.body))
    assert.deepEqual(d1Enrichment.body.usage, postgresEnrichmentUsageSnapshot)
    assert.ok(d1Enrichment.body.history.some(item => item.provider === "coresignal"))
    const d1BrightAdmin = await http("/api/admin/bright-data", { origin, cookie: admin.cookie })
    assert.equal(d1BrightAdmin.status, 200, JSON.stringify(d1BrightAdmin.body))
    assert.equal(d1BrightAdmin.body.runtime.applicationBudget.used, 1)
    assert.equal(d1BrightAdmin.body.attempts.find(item => item.id === 99300)?.rawEvidenceStored, true)
    const d1BrightPreflight = await brightPreflightContract(origin, admin.cookie, pcom.cookie, 15)
    assert.deepEqual(d1BrightPreflight, postgresBrightPreflightSnapshot)
    const d1BrightTrial = await brightTrialContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1BrightTrial, postgresBrightTrialSnapshot)
    const { stdout: trialAuditsJson } = await run(process.execPath, [wrangler, "d1", "execute", ...d1Args,
      "--command", "SELECT action,result,metadata_json FROM security_audit_events WHERE mutation_request_key='brightdata:local-human-trial:one-request'", "--json"],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const trialAudits = JSON.parse(trialAuditsJson)[0].results
    assert.equal(trialAudits.length, 1)
    assert.equal(trialAudits[0].result, "human_attested_provider_unverified")
    assert.equal(JSON.parse(trialAudits[0].metadata_json).confirmationStatus, "AWAITING_SEPARATE_TRIGGER_APPROVAL")
    const brightPurgeFixturePath = join(temporary, "bright-purge-fixture.sql")
    await writeFile(brightPurgeFixturePath, brightPurgeFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", brightPurgeFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1BrightPurge = await brightPurgeContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1BrightPurge, postgresBrightPurgeSnapshot)
    const d1WebhookOverview = await http("/api/intelligence/webhooks", { origin, cookie: pcom.cookie })
    assert.equal(d1WebhookOverview.status, 200, JSON.stringify(d1WebhookOverview.body))
    assert.equal(d1WebhookOverview.body.plans.find(item => item.id === 99400)?.coveredCount, 1)
    assert.equal(d1WebhookOverview.body.plans.find(item => item.id === 99400)?.membershipJson, "[redacted]")
    assert.equal(d1WebhookOverview.body.events.find(item => item.id === 99402)?.employeeId, "[redacted]")
    const d1WebhookPreview = await webhookPreviewContract(origin, admin.cookie, pcom.cookie, 15)
    assert.deepEqual(d1WebhookPreview, postgresWebhookPreviewSnapshot)
    const d1WebhookReview = await webhookReviewContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1WebhookReview, postgresWebhookReviewSnapshot)
    const d1IntakeExecute = await http("/api/discovery/intake", { origin, cookie: pcom.cookie, method: "POST", body: { action: "execute", resultIds: [intakeResultId], confirmed: true } })
    assert.equal(d1IntakeExecute.status, 201, JSON.stringify(d1IntakeExecute.body))
    assert.equal(d1IntakeExecute.body.addedCount, 1)
    const d1IntelligenceMissing = await http("/api/intelligence/profile/99999", { origin, cookie: pcom.cookie })
    assert.deepEqual(d1IntelligenceMissing, postgresIntelligenceMissingSnapshot)
    const d1Selection = await http("/api/intelligence/refresh/preview", { origin, cookie: pcom.cookie, method: "POST", body: { cohortType: "DYNAMIC_FILTER", mode: "mock", maxProfiles: 5, maxSocaiCalls: 0, maxTargetedBright: 0, filter: { version: "cn-selection-v1", scoreVersion: "cn-placement-relevance-v1", criteria: { company: "Fictional unmatched company" }, includeCnAlumniIds: [22], excludeCnAlumniIds: [] } } })
    assert.equal(d1Selection.status, 200, JSON.stringify(d1Selection.body))
    assert.equal(d1Selection.body.selection.selectedCount, 1)
    assert.equal(d1Selection.body.selection.members[0].cnAlumniId, 22)
    assert.equal(d1Selection.body.selection.members[0].reason, "MANUAL_INCLUDE")
    const d1DirectoryCsv = await exportHttp(origin, pcom.cookie, { scope: "directory", format: "csv", filters: {} })
    assert.equal(d1DirectoryCsv.status, 200)
    assert.match(d1DirectoryCsv.type, /^text\/csv/)
    assert.match(d1DirectoryCsv.body, /"Alumni ID","Alumni Name","Profile Status"/)
    const d1ProgrammeCsv = await exportHttp(origin, admin.cookie, { scope: "admin", format: "csv", datasets: ["programmes"] })
    assert.equal(d1ProgrammeCsv.status, 200)
    assert.match(d1ProgrammeCsv.body, /"Programme ID","Code","Name","Active","Sort Order"/)
    const d1Xlsx = await exportArchive(origin, pcom.cookie, { scope: "directory", format: "xlsx", filters: {}, importCompatible: true })
    assert.equal(d1Xlsx.status, 200)
    assert.ok(d1Xlsx.files["xl/workbook.xml"])
    const importRecord = { source_alumni_id: "BATCH1-EXEC-1", source_system: "fictional-sheet", name: "Fictional Execute Person", programme: "PGP", graduation_year: "2020", company: "", title: "Analyst" }
    const importPreview = await http("/api/imports", { origin, cookie: pcom.cookie, method: "POST", body: { action: "preview", filename: "fictional.csv", records: [importRecord] } })
    assert.equal(importPreview.status, 200)
    const importBody = { action: "execute", filename: "fictional.csv", records: [importRecord], previewId: importPreview.body.previewId, confirmed: true }
    const d1Import = await http("/api/imports", { origin, cookie: admin.cookie, method: "POST", body: importBody, key: "batch1-confirmed-import" })
    assert.deepEqual({ status: d1Import.status, body: d1Import.body }, postgresImportExecuteSnapshot)
    const d1Replay = await http("/api/imports", { origin, cookie: admin.cookie, method: "POST", body: importBody, key: "batch1-confirmed-import" })
    assert.equal(d1Replay.replayed, "true")
    assert.deepEqual(d1Replay.body, d1Import.body)
    const add = (cookie, code, name = code) => http("/api/admin", { origin, cookie, method: "POST", body: { action: "add_programme", code, name } })
    assert.equal((await add(undefined, "NOAUTH")).status, 401)
    assert.equal((await add(pcom.cookie, "NOPE")).status, 403)
    const invalid = await add(admin.cookie, "", "")
    assert.deepEqual({ status: invalid.status, body: invalid.body }, { status: 400, body: { error: "Enter a programme code and name." } })
    const created = await add(admin.cookie, " step3c ", "Fictional Step 3C")
    assert.equal(created.status, 201)
    assert.equal(created.body.programme.code, "STEP3C")
    assert.equal(created.body.programme.name, "Fictional Step 3C")
    assert.equal(created.body.programme.active, true)
    assert.equal(typeof created.body.programme.id, "number")
    const duplicate = await add(admin.cookie, "STEP3C", "Duplicate")
    assert.deepEqual({ status: duplicate.status, body: duplicate.body }, { status: 409, body: { error: "That programme code already exists." } })
    const programmeId = created.body.programme.id
    const updateProgramme = (cookie, body) => http("/api/admin", { origin, cookie, method: "POST", body: { programmeId, ...body } })
    assert.equal((await updateProgramme(undefined, { action: "rename_programme", name: "No auth" })).status, 401)
    assert.equal((await updateProgramme(pcom.cookie, { action: "rename_programme", name: "No role" })).status, 403)
    const invalidRename = await updateProgramme(admin.cookie, { action: "rename_programme", name: "" })
    assert.deepEqual({ status: invalidRename.status, body: invalidRename.body }, { status: 400, body: { error: "Enter a programme name." } })
    const renamed = await updateProgramme(admin.cookie, { action: "rename_programme", name: "Fictional Renamed" })
    assert.equal(renamed.status, 200)
    assert.deepEqual({ code: renamed.body.programme.code, name: renamed.body.programme.name, active: renamed.body.programme.active }, { code: "STEP3C", name: "Fictional Renamed", active: true })
    const unconfirmed = await updateProgramme(admin.cookie, { action: "set_programme_status", active: false })
    assert.deepEqual({ status: unconfirmed.status, body: unconfirmed.body }, { status: 409, body: { error: `Type DEACTIVATE PROGRAMME ${programmeId} to confirm.` } })
    const deactivated = await updateProgramme(admin.cookie, { action: "set_programme_status", active: false, confirmation: `DEACTIVATE PROGRAMME ${programmeId}` })
    assert.deepEqual({ status: deactivated.status, active: deactivated.body.programme.active }, { status: 200, active: false })
    const activated = await updateProgramme(admin.cookie, { action: "set_programme_status", active: true })
    assert.deepEqual({ status: activated.status, active: activated.body.programme.active }, { status: 200, active: true })
    const repeated = await updateProgramme(admin.cookie, { action: "set_programme_status", active: true })
    assert.deepEqual({ status: repeated.status, active: repeated.body.programme.active }, { status: 200, active: true })
    assert.equal((await updateProgramme(admin.cookie, { action: "rename_programme", programmeId: 999999, name: "Missing" })).status, 404)
    const programmeAudit = await http("/api/admin", { origin, cookie: admin.cookie })
    assert.equal(programmeAudit.status, 200)
    assert.deepEqual(programmeAudit.body.audit.filter(item => item.entityType === "programme_option" && item.entityId === String(programmeId) && ["programme_renamed", "programme_activated", "programme_deactivated"].includes(item.action)).map(item => item.action).sort(), ["programme_renamed", "programme_deactivated", "programme_activated", "programme_activated"].sort())
    const workspace = await http("/api/workspace", { origin, cookie: admin.cookie })
    assert.equal(workspace.status, 200)
    assert.ok(workspace.body.programmeOptions.some(item => item.code === "STEP3C"))
    const record = { name: "Fictional D1 Workspace Person", batch: 2022, programme: "PGP", company: "D1 Example Co", title: "Analyst", email: "d1-workspace-person@example.test" }
    const checked = await http("/api/workspace", { origin, method: "POST", cookie: pcom.cookie, body: { action: "manual_check", record } })
    assert.deepEqual({ status: checked.status, matches: checked.body.matches }, { status: 200, matches: [] })
    const manual = await http("/api/workspace", { origin, method: "POST", cookie: pcom.cookie, body: { action: "manual_add", record } })
    assert.equal(manual.status, 201, JSON.stringify(manual.body))
    assert.equal(manual.body.providerCreditsUsed, 0)
    const id = manual.body.alumnus.id
    assert.equal((await http("/api/workspace", { origin, method: "POST", cookie: pcom.cookie, body: { action: "manual_add", record } })).status, 409)
    const update = await http("/api/workspace", { origin, method: "PATCH", cookie: pcom.cookie, body: { action: "update_alumnus", id, status: "Contacted" } })
    assert.equal(update.status, 200)
    assert.equal(update.body.alumnus.status, "Contacted")
    const quality = await http("/api/workspace", { origin, method: "PATCH", cookie: pcom.cookie, body: { action: "update_data_quality", id, professionalDataStatus: "Reviewed" } })
    assert.equal(quality.status, 200)
    assert.equal(quality.body.alumnus.professionalDataStatus, "Reviewed")
    const priority = await http("/api/workspace", { origin, method: "PATCH", cookie: admin.cookie, body: { action: "update_priority", company: "D1 Example Co", priority: "High" } })
    assert.deepEqual({ status: priority.status, body: priority.body }, { status: 200, body: { company: "D1 Example Co", priority: "High" } })
    assert.equal((await http("/api/workspace", { origin, method: "PATCH", cookie: pcom.cookie, body: { action: "update_priority", company: "D1 Example Co", priority: "Low" } })).status, 403)
    const privacy = await http("/api/workspace", { origin, method: "PATCH", cookie: admin.cookie, body: { action: "update_privacy", id, privacy: { generalContactStatus: "Do not contact", consentSource: "Manual PCOM record" } } })
    assert.equal(privacy.status, 200)
    assert.equal(privacy.body.privacy.generalContactStatus, "Do not contact")
    const profile = await http(`/api/alumni/${id}`, { origin, cookie: pcom.cookie })
    assert.equal(profile.status, 200)
    const patchBody = { expectedVersion: profile.body.alumnus.recordVersion, fields: { note: "Fictional D1 profile note" } }
    const changed = await http(`/api/alumni/${id}`, { origin, method: "PATCH", cookie: pcom.cookie, body: patchBody, key: "step3d-d1-profile" })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    assert.equal(changed.body.changed, 1)
    assert.equal(changed.body.alumnus.note, "Fictional D1 profile note")
    assert.equal((await http(`/api/alumni/${id}`, { origin, method: "PATCH", cookie: pcom.cookie, body: patchBody, key: "step3d-d1-profile" })).replayed, "true")
    assert.equal((await http(`/api/alumni/${id}`, { origin, method: "PATCH", cookie: pcom.cookie, body: { ...patchBody, fields: { note: "Stale D1" } } })).body.code, "VERSION_CONFLICT")
    const programmeProposal = await http(`/api/alumni/${id}`, { origin, method: "PATCH", cookie: pcom.cookie,
      body: { expectedVersion: changed.body.alumnus.recordVersion, fields: { programme: "Fictional D1 Programme" } }, key: "step3d-d1-propose" })
    assert.equal(programmeProposal.status, 200)
    assert.equal(programmeProposal.body.changed, 0)
    assert.equal(programmeProposal.body.proposed, 1)
    const proposal = (await http(`/api/alumni/${id}`, { origin, cookie: admin.cookie })).body.proposals.find(item => item.proposedValue === "Fictional D1 Programme")
    const accepted = await http(`/api/alumni/${id}`, { origin, method: "POST", cookie: admin.cookie,
      body: { action: "accept_proposal", proposalId: proposal.id }, key: "step3d-d1-accept" })
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    assert.equal(accepted.body.status, "ACCEPTED")
    assert.equal(typeof accepted.body.recordVersion, "number")
    const outreachFixturePath = join(temporary, "outreach-fixture.sql")
    await writeFile(outreachFixturePath, outreachFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", outreachFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1Outreach = await Promise.all([99600, 99602, 99603].map(targetAlumnusId => http("/api/outreach-route", { origin, cookie: pcom.cookie, method: "POST", body: { targetAlumnusId } })))
    assert.deepEqual(d1Outreach.map(item => item.status), [200, 200, 200])
    assert.deepEqual(d1Outreach.map(item => item.body), postgresOutreachSnapshot)
    const d1OpportunityMutation = await opportunityMutationContract(origin, pcom.cookie)
    assert.deepEqual(d1OpportunityMutation.snapshot, postgresOpportunityMutationSnapshot)
    const d1EnrichmentLimit = await enrichmentLimitContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1EnrichmentLimit, postgresEnrichmentLimitSnapshot)
    const enrichmentReconciliationFixturePath = join(temporary, "enrichment-reconciliation-fixture.sql")
    await writeFile(enrichmentReconciliationFixturePath, enrichmentReconciliationFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", enrichmentReconciliationFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1EnrichmentAction = await enrichmentLocalActionContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1EnrichmentAction, postgresEnrichmentActionSnapshot)
    const webhookSetupFixturePath = join(temporary, "webhook-setup-fixture.sql")
    await writeFile(webhookSetupFixturePath, webhookSetupFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookSetupFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1WebhookSetup = await webhookSetupContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1WebhookSetup, postgresWebhookSetupSnapshot)
    const alumniHistoryFixturePath = join(temporary, "alumni-history-fixture.sql")
    await writeFile(alumniHistoryFixturePath, alumniHistoryFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", alumniHistoryFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1AlumniHistory = await alumniHistoryContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1AlumniHistory, postgresAlumniHistorySnapshot)
    const engagementLocalFixturePath = join(temporary, "engagement-local-fixture.sql")
    await writeFile(engagementLocalFixturePath, engagementLocalFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", engagementLocalFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1EngagementLocal = await engagementLocalContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1EngagementLocal, postgresEngagementLocalSnapshot)
    const webhookReceiverFixturePath = join(temporary, "webhook-receiver-fixture.sql")
    await writeFile(webhookReceiverFixturePath, webhookReceiverFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookReceiverFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1WebhookReceiver = await webhookReceiverContract(origin)
    assert.deepEqual(d1WebhookReceiver, postgresWebhookReceiverSnapshot)
    const webhookLifecycleFixturePath = join(temporary, "webhook-lifecycle-fixture.sql")
    await writeFile(webhookLifecycleFixturePath, webhookLifecycleFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookLifecycleFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1WebhookLifecycle = await webhookLifecycleContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1WebhookLifecycle, postgresWebhookLifecycleSnapshot)
    const webhookSimulationFixturePath = join(temporary, "webhook-simulation-fixture.sql")
    await writeFile(webhookSimulationFixturePath, webhookSimulationFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookSimulationFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1WebhookSimulation = await webhookSimulationContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1WebhookSimulation, postgresWebhookSimulationSnapshot)
    const webhookActivationFixturePath = join(temporary, "webhook-activation-fixture.sql")
    await writeFile(webhookActivationFixturePath, webhookActivationFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", webhookActivationFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1WebhookActivation = await webhookActivationContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1WebhookActivation, postgresWebhookActivationSnapshot)
    const engagementBulkFixturePath = join(temporary, "engagement-bulk-preview-fixture.sql")
    await writeFile(engagementBulkFixturePath, engagementBulkPreviewFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", engagementBulkFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1EngagementBulk = await engagementBulkPreviewContract(origin, pcom.cookie)
    assert.deepEqual(d1EngagementBulk, postgresEngagementBulkPreviewSnapshot)
    const d1EngagementPreview = await engagementPreviewContract(origin, pcom.cookie)
    assert.deepEqual(d1EngagementPreview, postgresEngagementPreviewSnapshot)
    const d1ManualEmail = await manualEmailContract(origin, pcom.cookie)
    assert.deepEqual(d1ManualEmail, postgresManualEmailSnapshot)
    const engagementSendFixturePath = join(temporary, "engagement-send-fixture.sql")
    await writeFile(engagementSendFixturePath, engagementSendFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", engagementSendFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1EngagementSend = await engagementSendContract(origin, pcom.cookie)
    assert.deepEqual(d1EngagementSend, postgresEngagementSendSnapshot)
    const lushaRejectionFixturePath = join(temporary, "lusha-review-rejection-fixture.sql")
    await writeFile(lushaRejectionFixturePath, lushaRejectionFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", lushaRejectionFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1LushaRejection = await lushaRejectionContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1LushaRejection, postgresLushaRejectionSnapshot)
    const lushaContactApprovalFixturePath = join(temporary, "lusha-contact-approval-fixture.sql")
    await writeFile(lushaContactApprovalFixturePath, lushaContactApprovalFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", lushaContactApprovalFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1LushaContactApproval = await lushaContactApprovalContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1LushaContactApproval, postgresLushaContactApprovalSnapshot)
    const lushaIdentityApprovalFixturePath = join(temporary, "lusha-identity-approval-fixture.sql")
    await writeFile(lushaIdentityApprovalFixturePath, lushaIdentityApprovalFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", lushaIdentityApprovalFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1LushaIdentityApproval = await lushaIdentityApprovalContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1LushaIdentityApproval, postgresLushaIdentityApprovalSnapshot)
    const d1Read = async statement => {
      const { stdout } = await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", statement, "--json"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      return JSON.parse(stdout)[0].results
    }
    const d1IdentityState = await d1Read("SELECT r.id,r.status,a.lusha_person_id,(SELECT count(*) FROM field_change_history f WHERE f.alumnus_id=a.id AND f.field='lushaPersonId') AS changes,(SELECT count(*) FROM security_audit_events s WHERE s.action='lusha_identity_association_approved' AND s.entity_id=CAST(a.id AS TEXT)) AS audits FROM provider_refresh_reviews r JOIN alumni a ON a.id=r.alumnus_id WHERE r.id IN (99330,99331) ORDER BY r.id")
    assert.deepEqual(d1IdentityState.map(row => [row.id,row.status,row.lusha_person_id,row.changes,row.audits]), [[99330,"Approved identity","fictional-lusha-identity-one",1,1],[99331,"Approved identity","fictional-lusha-identity-race",1,1]])
    const discoveryIgnoreFixturePath = join(temporary, "discovery-ignore-fixture.sql")
    await writeFile(discoveryIgnoreFixturePath, discoveryIgnoreFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", discoveryIgnoreFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1DiscoveryIgnore = await discoveryIgnoreContract(origin, pcom.cookie)
    assert.deepEqual(d1DiscoveryIgnore, postgresDiscoveryIgnoreSnapshot)
    const keepSeparateFixturePath = join(temporary, "keep-separate-fixture.sql")
    await writeFile(keepSeparateFixturePath, keepSeparateFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", keepSeparateFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1RaceEvidence = await Promise.all([[99507, "race"], [99508, "rollback"]].map(([id, suffix]) => http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: separateEvidenceBody(id, suffix) })))
    assert.deepEqual(d1RaceEvidence.map(item => item.status), [201, 201])
    const d1SeparateEvidence = await http("/api/discovery", { origin, cookie: pcom.cookie, method: "POST", body: evidenceBody(99502) })
    assert.equal(d1SeparateEvidence.status, 201)
    const d1KeepSeparate = await keepSeparateContract(origin, pcom.cookie, null)
    assert.deepEqual({ status: d1KeepSeparate.status, replayStatus: d1KeepSeparate.replayStatus }, { status: postgresKeepSeparateSnapshot.status, replayStatus: postgresKeepSeparateSnapshot.replayStatus })
    assert.ok([[201, 409], [201, 500]].some(statuses => statuses.every((status, index) => d1KeepSeparate.raceStatuses[index] === status)), JSON.stringify(d1KeepSeparate))
    if (d1KeepSeparate.raceStatuses.includes(500)) assert.match(d1KeepSeparate.raceErrors.join(" "), /UNIQUE constraint failed/i)
    const d1SeparateState = await d1Read("SELECT r.id,r.review_status,r.linked_internal_alumnus_id,a.profile_key,(SELECT count(*) FROM security_audit_events s WHERE s.action='possible_duplicate_kept_separate' AND s.entity_id=CAST(r.id AS TEXT)) AS audits FROM external_discovery_results r LEFT JOIN alumni a ON a.id=r.linked_internal_alumnus_id WHERE r.id IN (99502,99507) ORDER BY r.id")
    assert.deepEqual(d1SeparateState.map(row => [row.id,row.review_status,Boolean(row.linked_internal_alumnus_id),row.profile_key,row.audits]), [[99502,"Added as separate record",true,"coresignal:99501002",1],[99507,"Added as separate record",true,"coresignal:99507001",1]])
    const receiverStatePath = join(temporary, "webhook-receiver-state.sql")
    await writeFile(receiverStatePath, "UPDATE alumni SET coresignal_employee_id = '99470002' WHERE id = 99470;")
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", receiverStatePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1Stale = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { origin, method: "POST", body: [{ member_id: 99470001, status: "changed", event_id: "fictional-stale-identity" }] })
    assert.deepEqual(d1Stale.body, { stored: 1, duplicates: 0, providerRequests: 0, canonicalMutations: 0 })
    await writeFile(receiverStatePath, "UPDATE alumni SET coresignal_employee_id = '99470001' WHERE id = 99470; UPDATE coresignal_webhook_subscriptions SET status = 'EXPIRED' WHERE id = 99460;")
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", receiverStatePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1Expired = await http(`/api/webhooks/coresignal/99460/${webhookToken}`, { origin, method: "POST", body: [{ member_id: 99470001, status: "changed", event_id: "fictional-expired" }] })
    assert.deepEqual(d1Expired.body, { stored: 1, duplicates: 0, providerRequests: 0, canonicalMutations: 0 })
    const collectReviewFixturePath = join(temporary, "collect-review-fixture.sql")
    await writeFile(collectReviewFixturePath, collectReviewFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", collectReviewFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1CollectReview = await collectReviewPreflightContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1CollectReview, postgresCollectReviewSnapshot)
    const d1CollectConfirm = await http("/api/admin/coresignal-collect-review", { origin, cookie: admin.cookie, method: "POST", body: { collectHistoryId: 99901, alumnusId: 99900, confirmed: true, identityReviewed: true, educationReviewed: true } })
    assert.equal(d1CollectConfirm.status, 500)
    assert.match(d1CollectConfirm.body.error, /Insert select error: selected fields are not the same or are in a different order compared to the table definition/)
    const userCorrectionFixturePath = join(temporary, "user-correction-fixture.sql")
    await writeFile(userCorrectionFixturePath, userCorrectionFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", userCorrectionFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    await userCorrectionContract(origin, admin.cookie, pcom.cookie)
    const collectCandidateFixturePath = join(temporary, "collect-candidate-fixture.sql")
    await writeFile(collectCandidateFixturePath, collectCandidateFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", collectCandidateFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1CollectCandidate = await http("/api/admin/coresignal-collect", { origin, cookie: admin.cookie })
    assert.equal(d1CollectCandidate.status, 200, JSON.stringify(d1CollectCandidate.body))
    assert.deepEqual(d1CollectCandidate.body, postgresCollectCandidateSnapshot)
    const d1CollectSelection = await collectSelectionContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1CollectSelection, postgresCollectSelectionSnapshot)
    const collectKnownFixturePath = join(temporary, "collect-known-fixture.sql")
    await writeFile(collectKnownFixturePath, collectKnownFixtureSql)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--file", collectKnownFixturePath, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const d1CollectSingle = await collectSinglePreflightContract(origin, admin.cookie, pcom.cookie)
    assert.deepEqual(d1CollectSingle, postgresCollectSingleSnapshot)
    await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", "UPDATE provider_settings SET monthly_credit_limit=1000 WHERE provider='coresignal'", "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    const readCollectRows = async statement => {
      const { stdout } = await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", statement, "--json"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      return JSON.parse(stdout)[0].results
    }
    const collectAuditFailure = async enabled => {
      const statement = enabled
        ? "CREATE TRIGGER reject_mock_collect_audit BEFORE INSERT ON security_audit_events WHEN NEW.action='coresignal_collect_only_executed' AND NEW.metadata_json LIKE '%99911001%' BEGIN SELECT RAISE(ABORT, 'fictional Collect audit failure'); END"
        : "DROP TRIGGER reject_mock_collect_audit"
      await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", statement, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    }
    const collectSettlementFailure = async enabled => {
      const statement = enabled
        ? "CREATE TRIGGER reject_mock_collect_settlement BEFORE UPDATE OF status ON provider_response_history WHEN NEW.status='success' AND NEW.alumnus_id=99913 BEGIN SELECT RAISE(ABORT, 'fictional Collect settlement failure'); END"
        : "DROP TRIGGER reject_mock_collect_settlement"
      await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", statement, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    }
    const collectClaimFailure = async enabled => {
      const statement = enabled
        ? "CREATE TRIGGER reject_mock_collect_claim BEFORE INSERT ON provider_response_history WHEN NEW.alumnus_id=99915 BEGIN SELECT RAISE(ABORT, 'fictional Collect claim failure'); END"
        : "DROP TRIGGER reject_mock_collect_claim"
      await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", statement, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    }
    const setCollectLimit = async value => run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", `UPDATE provider_settings SET monthly_credit_limit=${value} WHERE provider='coresignal'`, "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    let d1CollectMockExecution
    try { d1CollectMockExecution = await collectMockExecutionContract(origin, admin.cookie, pcom.cookie, readCollectRows, collectAuditFailure, collectSettlementFailure, collectClaimFailure, setCollectLimit) }
    finally { await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", "UPDATE provider_settings SET monthly_credit_limit=50 WHERE provider='coresignal'", "--yes"], { cwd: root, maxBuffer: 8 * 1024 * 1024 }) }
    assert.deepEqual(d1CollectMockExecution, postgresCollectMockExecutionSnapshot)
    if (postgresSearchSnapshot) {
      // Same mock External Discovery search on D1: identical counts and response fields.
      const d1Limit = async value => run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", `UPDATE provider_settings SET monthly_credit_limit=${value} WHERE provider='coresignal'`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      const { stdout: limitJson } = await run(process.execPath, [wrangler, "d1", "execute", ...d1Args, "--command", "SELECT monthly_credit_limit FROM provider_settings WHERE provider='coresignal'", "--json"], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      const d1FixtureLimit = JSON.parse(limitJson)[0].results[0]?.monthly_credit_limit ?? 50
      await d1Limit(100000)
      let d1Search
      try { d1Search = await http("/api/discovery", { origin, cookie: admin.cookie, method: "POST", body: { action: "search", filters: {}, limit: 5, confirmed: false } }) } finally { await d1Limit(d1FixtureLimit) }
      assert.equal(d1Search.status, 200, JSON.stringify(d1Search.body))
      assert.deepEqual({ returned: d1Search.body.returnedCount, stored: d1Search.body.storedResultCount, units: d1Search.body.applicationUnits, keys: Object.keys(d1Search.body).sort() }, postgresSearchSnapshot)
    }
  } catch (error) {
    if (childLog) console.error("Step 3C D1 app log tail:\n", childLog)
    throw error
  } finally {
    if (child) {
      child.kill("SIGINT")
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
      if (child.exitCode === null) child.kill("SIGKILL")
    }
    await rm(temporary, { recursive: true, force: true })
  }
})
