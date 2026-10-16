"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, ArrowUpRight, Ban, BellRing, BriefcaseBusiness, Building2, Cake,
  CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleUserRound, Cloud, ContactRound,
  Database, Download, Eye, FileSpreadsheet, Filter, GitCompare, History, LoaderCircle,
  Mail, MapPin, MessageSquare, Network, Plus, Search, Send, ShieldCheck, Sparkles, Target, Upload,
  Info, UserPlus, UserRoundCheck, UsersRound, XCircle, Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AlumnusCombobox } from "@/components/alumnus-combobox"
import { CompanyCombobox, normalizeCompanyOptions } from "@/components/company-combobox"
import { PaginationFooter, usePagination } from "@/components/pagination"
import { IntelligenceWorkspace } from "@/components/intelligence/intelligence-workspace"
import { OpportunitiesWorkspace } from "@/components/opportunities/opportunities-workspace"
import { ProfileIntelligencePanel } from "@/components/intelligence/profile-intelligence-panel"
import { AdminPanel } from "@/app/admin-panel"
import { useAccessSession } from "@/app/access-provider"
import {
  DISCOVERY_SENIORITY_OPTIONS,
  FIXED_ALUMNI_SCHOOL,
  defaultDiscoveryFilters,
  defaultDirectoryFilters,
  discoverySenioritySummary,
  matchesInternalFilters,
  selectedDiscoverySeniorities,
  type DiscoveryFilters,
  type DirectoryFilters,
} from "@/lib/alumni-search"
import { apiPath, appConfig } from "@/lib/app-config"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { normalizeProfessionalProfileUrl, professionalExperienceSummary } from "@/lib/professional-profile"
import { discoveryApplicationUnits, maximumDiscoveryCount, validateDiscoveryCount } from "@/lib/discovery-limit"
import { providerUsageLabel } from "@/lib/provider-usage"
import { alumnusProfileUrl, canonicalWorkspaceUrl, controlledEmailReturnUrl, controlledEmailUrl, engagementEventUrl, parseControlledEmailIntent, parseEngagementEventId, profileRouteState, workspaceTabUrl } from "@/lib/controlled-email-navigation"
import { intelligenceView, intelligenceViewUrl, type IntelligenceView } from "@/lib/intelligence-navigation"
import { initializeControlledEmail } from "@/lib/controlled-email-initialization"
import { PersistedMutationCoordinator } from "@/lib/persisted-mutation"
import { programmeFilterOptions, programmeSelectionSummary, type ProgrammeOption } from "@/lib/programme-options"
import { contactReadiness, isActiveOutreach } from "@/lib/alumni-metrics"
import { parseCsv, parseXlsx, validateImport, type ImportReviewRow } from "@/lib/alumni-import"
import { contactEnrichmentPlan, eligibleContactChannels, type ContactChannel } from "@/lib/contact-enrichment"
import { engagementMatches } from "@/lib/engagement-filters"
import { groupEngagementsByAlumnus } from "@/lib/engagement-presentation"
import { MANUAL_ALUMNUS_REQUIRED_COPY, validateManualAlumnusInput } from "@/lib/manual-alumnus"
import { mailPresentation, signalsPresentation } from "@/lib/runtime-readiness"
import { alumniEducationLabel } from "@/lib/alumni-education"
import {
  PROFESSIONAL_VERIFICATION_LABELS,
  PROFESSIONAL_VERIFICATION_OPTIONS,
  PROFESSIONAL_VERIFICATION_SOURCES,
  isPositiveProfessionalVerification,
  type ProfessionalVerificationField,
} from "@/lib/professional-verification"

const API_ROUTES = Object.freeze({
  workspace: apiPath("/api/workspace"),
  enrichment: apiPath("/api/enrichment"),
  engagements: apiPath("/api/engagements"),
  discovery: apiPath("/api/discovery"),
  signals: apiPath("/api/signals"),
  outreachRoute: apiPath("/api/outreach-route"),
  professionalVerification: apiPath("/api/professional-verification"),
})

const ADDED_DISCOVERY_STATUSES = new Set<string>([
  DISCOVERY_REVIEW_STATUS.added,
  DISCOVERY_REVIEW_STATUS.addedSeparate,
  DISCOVERY_REVIEW_STATUS.legacyAdded,
])

type OutreachStatus = "Not contacted" | "Contacted" | "Responded" | "Meeting set"
type VerificationState = "Confirmed" | "Verified" | "Likely" | "Unverified" | "Possibly outdated" | "Mismatch"

type ProfessionalVerificationDraft = Record<ProfessionalVerificationField, VerificationState>

type ProfessionalVerificationEvidence = {
  stored: {
    name: string
    company: string
    designation: string
    location: string
    professionalProfileUrl: string
    programme: string
    graduationYear: number
    verification: ProfessionalVerificationDraft
  }
  coresignal: {
    identityAvailable: boolean
    lastRefresh: string
    freshness: string
    locationEvidence: { field?: string; label?: string; oldValue?: string; newValue?: string } | null
    operation: { status: string; responseSummary: string; createdAt: string } | null
    review: { status: string; proposedChanges: Array<{ field?: string; label?: string; oldValue?: string; newValue?: string }>; reviewedBy: string; reviewedAt: string } | null
  }
  lusha: {
    stableIdentityAvailable: boolean
    conflictEvidence: string
    operation: { operation: string; status: string; responseSummary: string; createdAt: string } | null
  }
  professionalDataStatus: string
  professionalDataNote: string
  recentChanges: Array<{ field: string; oldValue: string; newValue: string; source: string; action: string; reviewedBy: string; createdAt: string }>
}

type Alumni = {
  id: number
  name: string
  initials: string
  batch: number
  graduationYear?: number
  programme: string
  education?: string
  company: string
  title: string
  rawTitle?: string
  function: string
  seniority: string
  location: string
  previous: string
  experience: number
  confidence: number
  email: string
  phone: string
  linkedinUrl?: string
  pdlPersonId?: string
  coresignalEmployeeId?: string
  lushaPersonId?: string
  discoverySource?: string
  discoveryDate?: string
  lastPdlRefresh?: string
  lastProfessionalDataRefresh?: string
  professionalDataProvider?: string
  lastLushaEnrichment?: string
  emailSource?: string
  phoneSource?: string
  emailRetrievedAt?: string
  phoneRetrievedAt?: string
  professionalDataStatus?: string
  professionalDataNote?: string
  verified: string
  status: OutreachStatus
  note: string
  assessment: {
    hiringInfluence: string
    iimlRelationship: string
    warmIntroPotential: string
  }
  verification: {
    profileMatch: VerificationState
    currentCompany: VerificationState
    designation: VerificationState
    email: VerificationState
    phone: VerificationState
    location: VerificationState
  }
  source?: string
  updatedBy?: string
  updatedAt?: string
  privacy?: {
    generalContactStatus: string
    professionalEngagementStatus: string
    birthdayEngagementStatus: string
    consentSource: string
    notes: string
    updatedAt: string
    updatedBy: string
  }
  lifecycle?: string
}

type LatestImport = { filename: string; rowCount: number; importedBy: string; createdAt: string }
type Provider = "coresignal" | "lusha"
type ProviderMode = "mock" | "live"
type ProviderUsage = Record<Provider, { used: number; limit: number; remaining: number; configured: boolean; mode?: ProviderMode }>
type CoresignalSearchEvidence = {
  schemaVersion: 1
  attemptId: string
  searchParameters: { institutionId: number; company: string | null; mappedCompanyId: number | null; graduationYear: number | null; itemsPerPage: number; searchMode: string }
  upstreamHttpStatus: number
  employeeIds: readonly string[]
  returnedCount: number
  totalResults: number | null
  totalPages: number | null
  nextPageAfter: string | null
  creditsRemaining: number | null
  identityRoutes: readonly { employeeId: string; routingState: "IDENTITY_RESOLVED" | "IDENTITY_RESOLUTION_REQUIRED" | "IDENTITY_REVIEW_REQUIRED"; mappedAlumnusId: number | null; profileFreshness: "NOT_EVALUATED" }[]
  profileFreshness: "NOT_EVALUATED"
  applicationAccounting: { applicationUnits: 1; providerRequestCost: "UNRESOLVED" }
  providerActions: { searchRequests: 1; previewRequests: 0; collectRequests: 0; automaticPagination: false; canonicalMutations: 0 }
  audit: { requestedAt: string; completedAt: string; provenance: "provider_response_history" }
}
type PresentedSearchEvidence = { state: "RETAINED"; evidence: CoresignalSearchEvidence } | { state: "NOT_RETAINED" | "UNAVAILABLE"; reason: string }
type ProviderHistory = {
  id: number
  provider: Provider | "pdl"
  alumnusId?: number | null
  alumnusName: string
  operation: string
  mode: "mock" | "live"
  status: string
  creditsUsed: number
  applicationUnits?: number
  providerReportedCredits?: number | null
  usageState?: "provider_reported" | "reconciled_account_usage" | "reconciliation_required" | "provider_reported_zero" | "not_applicable"
  reconciledCredits?: number | null
  reconciliationSource?: string
  reconciledBy?: string
  reconciledAt?: string
  resultCount?: number
  requestSummary?: string
  responseSummary: string
  errorMessage: string
  requestedBy: string
  createdAt: string
  searchEvidence?: PresentedSearchEvidence
}

type DiscoveryResult = {
  id: number
  searchId: number
  name: string
  education: string
  currentCompany: string
  role: string
  rawTitle: string
  function: string
  seniority: string
  location: string
  graduationYear: number
  linkedinUrl: string
  providerPersonId: string
  provider?: string
  matchStatus: "New" | "Already in database" | "Possible duplicate" | "Needs review"
  matchConfidence: number
  linkedInternalAlumnusId: number | null
  reviewStatus: string
  actionableReview?: boolean
  reviewNote?: string
  affiliationStatus?: "Confirmed degree alumnus" | "Potential alumnus — review required" | "Short-term / exchange affiliation"
  educationProgramme?: string
  normalizedProgramme?: string
  programmeStatus?: "Programme matched" | "Executive/non-regular programme" | "Programme requires review"
  alumniStatus?: "Past alumnus" | "Current student" | "Graduation status unknown — review required"
  eligibleForAddition?: boolean
  currentRoleAmbiguous?: boolean
  searchProvider?: string
  searchMode?: string
  retrievedAt?: string
  providerIntegrity?: "consistent" | "provider_mismatch" | "search_missing"
  plannerClassification?: "KNOWN_PROVIDER_ID" | "KNOWN_PROFILE_URL" | "KNOWN_STRONG_IDENTITY" | "NEW_CANDIDATE" | "AMBIGUOUS" | "PREVIOUSLY_REJECTED"
  collectDecision?: "DO_NOT_COLLECT" | "COLLECT_RECOMMENDED" | "REVIEW_BEFORE_COLLECT"
  plannerReasonCode?: string
  plannerRationale?: string
  reconciledAlumnusId?: number | null
  qualification?: Record<"company" | "seniority" | "graduationYear" | "programme", { result: string; source: string; evidence: string; rationale: string }>
  collectionState?: "COLLECT_PERFORMED" | "SKIPPED_ALREADY_KNOWN" | "SKIPPED_FILTER_MISMATCH" | "SKIPPED_PREVIOUSLY_REJECTED" | "REVIEW_BEFORE_COLLECT" | "SKIPPED_COLLECT_LIMIT"
  collectionRationale?: string
  finalDiscoveryStatus?: "QUALIFIED_FOR_REVIEW" | "FILTER_MISMATCH" | "IDENTITY_REVIEW_REQUIRED" | "INSUFFICIENT_EVIDENCE" | "ALREADY_KNOWN" | "PREVIOUSLY_REJECTED" | "COLLECT_LIMIT_REACHED"
}

type DiscoveryCounts = { existing: number; new: number; possibleDuplicate: number; needsReview: number }
type DiscoveryCoveragePlan = {
  overallState: "NEVER_SEARCHED" | "RECENTLY_SEARCHED" | "STALE_SEARCH" | "PARTIALLY_COVERED"
  policy: { recentSearchWindowDays: number; advisoryOnly: boolean }
  counts: { requested: number; recentlySearched: number; stale: number; neverSearched: number }
  searchSegmentsRequiringProviderQuery: number
  lastEquivalentSearch: { lastSearchId: number | null; lastSearchedAt: string | null; daysSinceLastSearch: number | null; mode: string | null } | null
}
type ReconciliationSummary = {
  candidatesReturned: number
  knownProviderIds: number
  knownProfileUrls: number
  knownStrongIdentities: number
  newCandidates: number
  ambiguousCandidates: number
  previouslyRejected: number
  alreadyKnown: number
  collectRecommended: number
  collectReviewRequired: number
  collectAvoided: number
}
type DiscoveryExecutionSummary = {
  previewCountReturned: number
  previewCountConsidered: number
  knownProviderIds: number
  knownProfileUrls: number
  companyMismatches: number
  seniorityMismatches: number
  previouslyRejected: number
  ambiguousCandidates: number
  collectRecommended: number
  collectExecuted: number
  collectSkippedKnown: number
  collectSkippedFilter: number
  collectSkippedLimit: number
  potentialCollectionsAvoided: number
}
type DiscoveryRunSummary = {
  searchId: number
  provider: string
  mode: string
  initiatedBy: string
  createdAt: string
  criteriaSummary: string
  requestedCount: number | null
  providerResultCount: number
  storedResultCount: number
  pendingCount: number
  counts: DiscoveryCounts
  creditsUsed: number
  applicationUnits: number | null
  providerReportedCredits: number | null
}

type EngagementStatus = "New" | "Viewed" | "Acknowledged" | "Action Planned" | "Action Taken" | "Response Received" | "Follow-up Due" | "Closed" | "Completed" | "Skipped"
type EngagementActivity = { id: number; action: string; actor: string; details: string; createdAt: string }
type EngagementAction = { id: number; actionType: string; channel: string; performedBy: string; performedAt: string; subject: string; deliveryStatus: string; notes: string }
type EngagementEvent = {
  id: number
  alumnusId: number
  eventType: "Birthday" | "Professional Signal" | "Manual Relationship" | string
  eventSubtype: string
  eventTitle: string
  eventDescription: string
  eventDate: string
  source: string
  sourceDetectedDate: string
  providerEventAt?: string
  previousCompany?: string
  previousRole?: string
  newCompany?: string
  newRole?: string
  sourceConfidence?: string
  sourceStatus?: string
  status: EngagementStatus
  assignedTo: string
  owner?: { userId: number | null; displayName: string; storedIdentity: string; available: boolean } | null
  assignedAt: string
  actionTakenAt: string
  actionTakenBy: string
  actionType: string
  actionChannel: string
  deliveryStatus: string
  responseReceived: boolean
  responseReceivedAt: string
  responseType: string
  followUpRequired: boolean
  followUpDate: string
  skipReason: string
  lastViewedBy: string
  alumnus: { id: number; name: string; initials: string; company: string; title: string; programme: string; batch: number; email: string; relationship: string; confidence: number; outreachStatus: string } | null
  birthday: { birthMonthDay: string; source: string; status: string; lastVerifiedAt: string } | null
  preference: string
  actions: EngagementAction[]
  responses: Array<{ id: number; responseType: string; receivedAt: string; recordedBy: string; notes: string; followUpRequired: boolean; followUpDate: string }>
  views: Array<{ id: number; userId: string; viewedAt: string }>
  activity: EngagementActivity[]
}
type MessageTemplate = { id: number; templateKey: string; name: string; eventType: string; subject: string; body: string }
type MailPreview = { event: EngagementEvent; templateId: number; recipient: string; subject: string; body: string; readiness: { communicationStatus: string; purpose: string; duplicateStatus: string; provider: string; mode: "mock" | "live"; sender: string } }
type BulkPreview = { ready: Array<{ eventId: number; alumnusName: string; templateId: number; recipient: string; subject: string; body: string }>; excluded: Array<{ eventId: number; alumnusName: string; reason: string }> }
type RouteRecommendation = {
  routeType: "Direct" | "Warm" | "No eligible route"
  rationale: string
  target: { id: number; name: string; initials: string; company: string; title: string }
  intermediary: { id: number; name: string; initials: string; company: string; title: string } | null
  evidence: string
  factors: { usableContact: boolean; verifiedContact: boolean; reliableProfile: boolean; directAttempts: number; directResponses: number; confirmedIntermediary: boolean; relationshipType: string; successfulIntroductions: number }
}
type ManualForm = { name: string; programme: string; batch: string; company: string; title: string; function: string; seniority: string; location: string; linkedinUrl: string; email: string; phone: string; relationship: string; note: string; status: OutreachStatus }
type ManualMatch = { id: number; name: string; programme: string; batch: number; company: string; title: string; reasons: string[]; exact: boolean }
type RefreshField = { field: string; label: string; oldValue: string; newValue: string }
type RefreshResult = { alumnusId: number; alumnusName: string; status: string; reviewStatus: string; reviewId?: number; creditsUsed: number | null; applicationUnits?: number; responseSummary: string; fields: RefreshField[] }
type LushaContactPreview = {
  alumnusId: number
  alumnusName: string
  contactId: string
  fullName: string
  jobTitle: string
  company: string
  professionalProfile: string
  emailAvailable: boolean | null
  phoneAvailable: boolean | null
  status: "success" | "no_match"
  creditsUsed: number | null
  usageSource: "provider_response" | "unavailable" | "stored"
  resumedFromStoredContact?: boolean
}

const hiringOptions = [
  ["Direct hiring decision-maker", 100], ["Strong hiring influence", 80],
  ["Moderate hiring influence", 60], ["Limited hiring influence", 30],
  ["No known hiring influence", 10], ["Unknown / Not assessed", 50],
] as const

const relationshipOptions = [
  ["Very strong", 100], ["Strong", 85], ["Moderate", 65],
  ["Limited", 40], ["Minimal / record only", 20], ["Unknown / Not assessed", 50],
] as const

const warmIntroOptions = [
  ["Is the relevant decision-maker", 100], ["Confirmed direct connection to decision-maker", 90],
  ["Can credibly provide introduction", 75], ["Same relevant function / business unit", 60],
  ["Same company only", 40], ["Weak evidence of connection", 20],
  ["No known route", 10], ["Unknown / Not assessed", 50],
] as const

const companyPriorityOptions = [
  ["Tier 1 Strategic Target", 100], ["High Priority", 85], ["Target Recruiter", 70],
  ["Secondary Target", 50], ["Low Priority", 30], ["Not Currently Targeted", 10],
] as const

const seniorityOptions = [
  ["CXO / Country Head / Managing Partner", 100], ["EVP / SVP / VP / Partner", 90],
  ["Director / GM", 80], ["Senior Manager", 65], ["Manager", 50],
  ["Associate / Consultant", 35], ["Analyst / Junior", 20],
] as const

const responsivenessOptions = [
  ["Positive and took action", 90], ["Positive response", 80],
  ["Contacted once, no response", 35], ["Never contacted / no history", 50],
] as const

const statusOptions: OutreachStatus[] = ["Not contacted", "Contacted", "Responded", "Meeting set"]
const functionFilterOptions = ["HR", "Finance", "Strategy", "Consulting", "Product", "Operations", "Sales", "Marketing", "Technology", "General Management", "Other"]
const seniorityFilterOptions = [...DISCOVERY_SENIORITY_OPTIONS]

function optionScore(options: readonly (readonly [string, number])[], label: string) {
  return options.find(([name]) => name === label)?.[1] ?? 50
}

function seniorityLabel(person: Alumni) {
  const value = person.seniority.toLowerCase()
  if (/country|managing director|chief|c-suite|cxo/.test(value)) return seniorityOptions[0][0]
  if (/evp|svp|vice president|\bvp\b|partner/.test(value)) return seniorityOptions[1][0]
  if (/director|general manager|\bgm\b/.test(value)) return seniorityOptions[2][0]
  if (/senior manager/.test(value)) return seniorityOptions[3][0]
  if (/manager/.test(value)) return seniorityOptions[4][0]
  if (/associate|consultant/.test(value)) return seniorityOptions[5][0]
  return seniorityOptions[6][0]
}

function responsivenessLabel(status: OutreachStatus) {
  if (status === "Meeting set") return responsivenessOptions[0][0]
  if (status === "Responded") return responsivenessOptions[1][0]
  if (status === "Contacted") return responsivenessOptions[2][0]
  return responsivenessOptions[3][0]
}

function derivedResponsiveness(person: Alumni, history: EngagementEvent[] = []) {
  const relevant = history.filter(event => event.alumnusId === person.id)
  const responses = relevant.filter(event => event.responseReceived).length
  const completed = relevant.filter(event => ["Action Taken", "Response Received", "Follow-up Due", "Closed"].includes(event.status)).length
  if (responses >= 2) return responsivenessOptions[0][0]
  if (responses === 1) return responsivenessOptions[1][0]
  if (completed >= 2) return responsivenessOptions[2][0]
  return responsivenessLabel(person.status)
}

function relevanceBreakdown(person: Alumni, priorities: Record<string, string>, history: EngagementEvent[] = []) {
  const items = [
    { label: "Hiring influence", score: optionScore(hiringOptions, person.assessment.hiringInfluence), weight: 30 },
    { label: "Seniority", score: optionScore(seniorityOptions, seniorityLabel(person)), weight: 20 },
    { label: "Company priority", score: optionScore(companyPriorityOptions, priorities[person.company]), weight: 20 },
    { label: "IIML relationship", score: optionScore(relationshipOptions, person.assessment.iimlRelationship), weight: 15 },
    { label: "Past responsiveness", score: optionScore(responsivenessOptions, derivedResponsiveness(person, history)), weight: 10 },
    { label: "Warm-intro potential", score: optionScore(warmIntroOptions, person.assessment.warmIntroPotential), weight: 5 },
  ]
  const score = Math.round(items.reduce((total, item) => total + item.score * item.weight / 100, 0))
  return { score, items }
}

function operationalStatus(person: Alumni) {
  return contactReadiness(person.verification)
}

function scoreTone(score: number) {
  if (score >= 90) return "score-high"
  if (score >= 80) return "score-medium"
  return "score-low"
}

function verificationTone(state: VerificationState) {
  if (["Confirmed", "Verified"].includes(state)) return "verification-good"
  if (["Likely", "Possibly outdated"].includes(state)) return "verification-caution"
  if (state === "Mismatch") return "verification-bad"
  return "verification-neutral"
}

function StatusBadge({ status }: { status: OutreachStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
}

function CoresignalSearchEvidencePanel({ evidence, showIds = false }: { evidence: CoresignalSearchEvidence; showIds?: boolean }) {
  return <div className="search-evidence-panel">
    <div className="search-evidence-grid">
      <div><span>Search conditions</span><strong>IIM Lucknow{evidence.searchParameters.graduationYear ? ` · ${evidence.searchParameters.graduationYear}` : " · all years"}{evidence.searchParameters.company ? ` · ${evidence.searchParameters.company}` : ""}</strong></div>
      <div><span>Provider response</span><strong>HTTP {evidence.upstreamHttpStatus}</strong><small>Attempt {evidence.attemptId}</small></div>
      <div><span>Returned candidates</span><strong>{evidence.returnedCount}</strong><small>{evidence.totalResults === null ? "Total not supplied" : `${evidence.totalResults} provider matches reported`}</small></div>
      <div><span>Pagination</span><strong>{evidence.totalPages === null ? "Pages not supplied" : `${evidence.totalPages} page${evidence.totalPages === 1 ? "" : "s"}`}</strong><small>{evidence.nextPageAfter === null ? "No next-page cursor supplied" : "Next-page cursor retained; not followed"}</small></div>
      <div><span>Profile freshness</span><strong>{evidence.profileFreshness.replaceAll("_", " ")}</strong><small>Search IDs are not verified profiles</small></div>
      <div><span>Provider actions</span><strong>Search 1 · Preview 0 · Collect 0</strong><small>No pagination or canonical mutation</small></div>
      <div><span>Application accounting</span><strong>1 application unit</strong><small>Provider request cost unresolved · remaining {evidence.creditsRemaining ?? "not supplied"}</small></div>
      <div><span>Observed</span><strong>{new Date(evidence.audit.completedAt).toLocaleString()}</strong><small>Provider History evidence v{evidence.schemaVersion}</small></div>
    </div>
    <div className="search-route-summary">
      {(["IDENTITY_RESOLVED", "IDENTITY_RESOLUTION_REQUIRED", "IDENTITY_REVIEW_REQUIRED"] as const).map(state => <span key={state}><strong>{evidence.identityRoutes.filter(route => route.routingState === state).length}</strong> {state.replaceAll("_", " ").toLowerCase()}</span>)}
    </div>
    {showIds && <details className="search-id-evidence"><summary>View returned Employee IDs</summary>{evidence.identityRoutes.length ? <div>{evidence.identityRoutes.map(route => <article key={route.employeeId}><code>{route.employeeId}</code><span>{route.routingState.replaceAll("_", " ")}</span><small>Freshness {route.profileFreshness.replaceAll("_", " ").toLowerCase()}</small></article>)}</div> : <p>No Employee IDs were returned.</p>}<p>IDs are secondary provider evidence only. They do not create alumni, attach identities, or prove profile freshness.</p></details>}
  </div>
}

function EngagementStatusBadge({ status }: { status: EngagementStatus }) {
  return <span className={`engagement-status engagement-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
}

function displayEventDate(value: string) {
  if (!value) return "Date not recorded"
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function DiscoveryBadge({ status, actionableReview = true }: { status: DiscoveryResult["matchStatus"]; actionableReview?: boolean }) {
  const label = !actionableReview && status === "Needs review" ? "Filter mismatch" : status === "New" ? "Externally discovered" : status
  return <span className={`discovery-badge discovery-${status.toLowerCase().replaceAll(" ", "-")}`}>{label}</span>
}

function discoveryReviewLabel(status: string, actionableReview = true) {
  if (!actionableReview) return "Stored history — filter mismatch"
  if (status === DISCOVERY_REVIEW_STATUS.added || status === DISCOVERY_REVIEW_STATUS.legacyAdded) return `Added to ${appConfig.name}`
  return status
}

function contactDataLabel(person: Alumni, channel: "email" | "phone") {
  const value = person[channel]
  if (!value) return { status: "Not enriched", detail: "No contact data stored" }
  const source = channel === "email" ? person.emailSource : person.phoneSource
  const retrievedAt = channel === "email" ? person.emailRetrievedAt : person.phoneRetrievedAt
  const verification = person.verification[channel]
  const status = source === "Lusha" ? "Lusha sourced" : source === "Manual entry" ? "Manual entry · not independently verified" : verification === "Verified" ? "Stored status: Verified" : "Needs verification"
  const detail = [source && source !== "Manual entry" ? `Source: ${source}` : "", retrievedAt ? new Date(retrievedAt).toLocaleDateString() : "Date not recorded"].filter(Boolean).join(" · ")
  return { status, detail }
}

function isCompletedEngagement(status: string) {
  return ["Action Taken", "Response Received", "Closed", "Completed", "Skipped"].includes(status)
}

function missingLushaChannels(person: Alumni) {
  return eligibleContactChannels(person, ["email", "phone"])
}

function placementContext(person: Alumni) {
  return person.note === "No placement context recorded." ? "No Placement Committee relationship context recorded." : person.note
}

function engagementEmptyState(filter: string) {
  if (filter === "Birthdays") return ["No birthdays require action", "No birthdays require action in the selected period."]
  if (filter === "Professional Signals") return ["No professional signals require review", "New promotions and company changes will appear here for human review."]
  if (filter === "Follow-ups") return ["No follow-ups are due", "Scheduled follow-ups will appear here when they become due."]
  if (filter === "Assigned to Me") return ["Nothing is assigned to you", "Take ownership of an open engagement to add it to this queue."]
  if (filter === "Completed") return ["No completed engagements", "Completed engagement history will appear here."]
  if (filter === "Skipped") return ["No skipped engagements", "Skipped items will remain available here for audit history."]
  return ["No actions need attention", "New and follow-up engagement work will appear here."]
}

function outreachRationale(person: Alumni) {
  const reasons: string[] = []
  if (["HR", "General Management"].includes(person.function)) reasons.push(`${person.function} leader`)
  else if (/VP|Director|CXO|Chief|Partner/i.test(person.seniority)) reasons.push("Senior decision-maker")
  if (!["Unknown / Not assessed", "Minimal / record only"].includes(person.assessment.iimlRelationship)) reasons.push(`${person.assessment.iimlRelationship} IIML relationship`)
  if (["Responded", "Meeting set"].includes(person.status)) reasons.push("Previously responsive")
  if (!["Unknown / Not assessed", "No known route", "Weak evidence of connection"].includes(person.assessment.warmIntroPotential)) reasons.push("Warm route available")
  return reasons.slice(0, 2).join(" · ") || "No outreach rationale recorded."
}

function StatCard({ icon: Icon, label, value, delta, help }: { icon: typeof UsersRound; label: string; value: string; delta: string; help?: string }) {
  return <article className="stat-card"><div className="stat-icon"><Icon aria-hidden="true" /></div><div><p>{label}</p><strong>{value}</strong><span>{delta}{help && <TooltipProvider><Tooltip><TooltipTrigger asChild><button type="button" className="kpi-help" aria-label={`What ${label} means`}><Info aria-hidden="true" /></button></TooltipTrigger><TooltipContent side="bottom" className="kpi-help-content">{help}</TooltipContent></Tooltip></TooltipProvider>}</span></div></article>
}

export default function Home() {
  const session = useAccessSession()
  const currentDemoUser = session.displayName
  const [alumni, setAlumni] = useState<Alumni[]>([])
  const [companyPriorities, setCompanyPriorities] = useState<Record<string, string>>({})
  const [configuredProgrammes, setConfiguredProgrammes] = useState<ProgrammeOption[]>([])
  const [filters, setFilters] = useState<DirectoryFilters>(defaultDirectoryFilters)
  const [discoveryFilters, setDiscoveryFilters] = useState<DiscoveryFilters>(defaultDiscoveryFilters)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [targetCompany, setTargetCompany] = useState("")
  const [overviewCompany, setOverviewCompany] = useState("All companies")
  const [opportunityContext, setOpportunityContext] = useState<{ company: string; alumnusId: number | null; mode: "create" | "filter"; key: number }>({ company: "", alumnusId: null, mode: "create", key: 0 })
  const [opportunitySummary, setOpportunitySummary] = useState({ total: 0, active: 0, assignedToMe: 0, followUpsDue: 0 })
  const [routeSearch, setRouteSearch] = useState("")
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState("")
  const [latestImport, setLatestImport] = useState<LatestImport | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importReview, setImportReview] = useState<{ rows: ImportReviewRow[]; counts: { detected: number; newRecords: number; existingMatches: number; needsAttention: number; duplicates: number }; blocking: boolean; sheetName?: string } | null>(null)
  const [approvedImportUpdates, setApprovedImportUpdates] = useState<string[]>([])
  const [importMessage, setImportMessage] = useState("")
  const [providerModes, setProviderModes] = useState<Record<Provider, ProviderMode>>({ coresignal: "mock", lusha: "mock" })
  const [providerUsage, setProviderUsage] = useState<ProviderUsage>({ coresignal: { used: 0, limit: 25, remaining: 25, configured: false }, lusha: { used: 0, limit: 100, remaining: 100, configured: false } })
  const [providerHistory, setProviderHistory] = useState<ProviderHistory[]>([])
  const [contactResume, setContactResume] = useState<Record<number, { emailAvailable: boolean | null; phoneAvailable: boolean | null }>>({})
  const [usageReconciliationDrafts, setUsageReconciliationDrafts] = useState<Record<number, string>>({})
  const [creditDrafts, setCreditDrafts] = useState<Record<Provider, string>>({ coresignal: "25", lusha: "100" })
  const [selectedForEnrichment, setSelectedForEnrichment] = useState<number[]>([])
  const [selectedForIntelligence, setSelectedForIntelligence] = useState<number[]>([])
  const [enriching, setEnriching] = useState(false)
  const [enrichmentMessage, setEnrichmentMessage] = useState("")
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([])
  const [discoveryCounts, setDiscoveryCounts] = useState<DiscoveryCounts>({ existing: 0, new: 0, possibleDuplicate: 0, needsReview: 0 })
  const [discoveryLimit, setDiscoveryLimit] = useState("5")
  const [discovering, setDiscovering] = useState(false)
  const [discoveryMessage, setDiscoveryMessage] = useState("")
  const [discoveryState, setDiscoveryState] = useState<"idle" | "results" | "empty" | "blocked">("idle")
  const [pendingDiscoveryCount, setPendingDiscoveryCount] = useState(0)
  const [loadingPendingReview, setLoadingPendingReview] = useState(false)
  const [lastDiscoveryFilters, setLastDiscoveryFilters] = useState<DiscoveryFilters | null>(null)
  const [pendingDiscoveryFilters, setPendingDiscoveryFilters] = useState<DiscoveryFilters | null>(null)
  const [pendingRegularSearchFilters, setPendingRegularSearchFilters] = useState<DiscoveryFilters | null>(null)
  const [regularSearchPreparation, setRegularSearchPreparation] = useState<{ provider: string; operation: string; institution: string; company: string; companyMapping: string; graduationYear: string; seniority: string; pageSize: number; maximumSearchRequests: number; automaticPagination: boolean; automaticCollect: boolean; automaticCanonicalUpdate: boolean; searchMode: string } | null>(null)
  const [regularSearchResultEvidence, setRegularSearchResultEvidence] = useState<CoresignalSearchEvidence | null>(null)
  const [regularSearchStatus, setRegularSearchStatus] = useState({ enabled: false, configured: false, maxRequests: 1, automaticPagination: false })
  const [coresignalLiveMaximum, setCoresignalLiveMaximum] = useState(5)
  const [activeDiscoveryRun, setActiveDiscoveryRun] = useState<DiscoveryRunSummary | null>(null)
  const [previousDiscoveryRuns, setPreviousDiscoveryRuns] = useState<DiscoveryRunSummary[]>([])
  const [activeDiscoveryHistory, setActiveDiscoveryHistory] = useState<ProviderHistory[]>([])
  const [discoveryCoverage, setDiscoveryCoverage] = useState<DiscoveryCoveragePlan | null>(null)
  const [discoveryCoverageLoading, setDiscoveryCoverageLoading] = useState(false)
  const [discoveryCoverageError, setDiscoveryCoverageError] = useState("")
  const [discoveryReconciliation, setDiscoveryReconciliation] = useState<ReconciliationSummary | null>(null)
  const [discoveryExecution, setDiscoveryExecution] = useState<DiscoveryExecutionSummary | null>(null)
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState<number[]>([])
  const [comparisonResult, setComparisonResult] = useState<DiscoveryResult | null>(null)
  const [selectedComparisonFields, setSelectedComparisonFields] = useState<string[]>([])
  const [ignoreResult, setIgnoreResult] = useState<DiscoveryResult | null>(null)
  const [ignoreReason, setIgnoreReason] = useState("Wrong person")
  const [engagements, setEngagements] = useState<EngagementEvent[]>([])
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([])
  const [mailMode, setMailMode] = useState<"mock" | "live">("mock")
  const [mailConfigured, setMailConfigured] = useState(false)
  const [signalsStatus, setSignalsStatus] = useState<{ mode: string; configured: boolean; liveEnabled: boolean; entitlement: "unknown" | "confirmed" | "not_entitled"; startDate: string; requiresManualEntitlementValidation: boolean } | null>(null)
  const [signalsAlumnusId, setSignalsAlumnusId] = useState<number | null>(null)
  const [signalsConfirmOpen, setSignalsConfirmOpen] = useState(false)
  const [signalsRunning, setSignalsRunning] = useState(false)
  const [signalsMessage, setSignalsMessage] = useState("")
  const [engagementFilter, setEngagementFilter] = useState("Needs Action")
  const [engagementPeriod, setEngagementPeriod] = useState("All dates")
  const [engagementCompany, setEngagementCompany] = useState("All companies")
  const [engagementAssignee, setEngagementAssignee] = useState("All assignees")
  const [engagementActionState, setEngagementActionState] = useState("All email states")
  const [engagementAssignees, setEngagementAssignees] = useState<Array<{ id: number; displayName: string }>>([])
  const [selectedEngagement, setSelectedEngagement] = useState<EngagementEvent | null>(null)
  const openEngagementRef = useRef<(event: EngagementEvent) => Promise<void>>(async () => {})
  const [selectedBirthdayIds, setSelectedBirthdayIds] = useState<number[]>([])
  const [engagementLoading, setEngagementLoading] = useState(false)
  const engagementWorkCountRef = useRef(0)
  const pendingEngagementKeysRef = useRef(new Set<string>())
  const [pendingEngagementKeys, setPendingEngagementKeys] = useState<Set<string>>(new Set())
  const [engagementMessage, setEngagementMessage] = useState("")
  const [mailPreview, setMailPreview] = useState<MailPreview | null>(null)
  const [mailSendConfirmOpen, setMailSendConfirmOpen] = useState(false)
  const composeGenerationRef = useRef(0)
  const persistedMutationsRef = useRef(new PersistedMutationCoordinator())
  const pendingSyncCountRef = useRef(0)
  const [composeState, setComposeState] = useState<{ status: "idle" | "loading" | "ready" | "error" | "cancelled"; message: string }>({ status: "idle", message: "" })
  const [composeRetry, setComposeRetry] = useState(0)
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null)
  const [responseType, setResponseType] = useState("Positive")
  const [responseNotes, setResponseNotes] = useState("")
  const [followUpDate, setFollowUpDate] = useState("")
  const [birthdayCorrection, setBirthdayCorrection] = useState("")
  const [targetAlumnusId, setTargetAlumnusId] = useState<number | null>(null)
  const [routeRecommendation, setRouteRecommendation] = useState<RouteRecommendation | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeMessage, setRouteMessage] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const [manualForm, setManualForm] = useState<ManualForm>({ name: "", programme: "PGP", batch: "", company: "", title: "", function: "Not assessed", seniority: "Not assessed", location: "", linkedinUrl: "", email: "", phone: "", relationship: "Unknown / Not assessed", note: "", status: "Not contacted" })
  const [manualMatches, setManualMatches] = useState<ManualMatch[]>([])
  const [manualSaved, setManualSaved] = useState<Alumni | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualMessage, setManualMessage] = useState("")
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false)
  const [contactConfirm, setContactConfirm] = useState<{ ids: number[]; channels: ContactChannel[]; operation: "manual" | "batch" } | null>(null)
  const [refreshResults, setRefreshResults] = useState<RefreshResult[]>([])
  const [refreshSelections, setRefreshSelections] = useState<Record<number, string[]>>({})
  const [lushaTarget, setLushaTarget] = useState<Alumni | null>(null)
  const [lushaPreview, setLushaPreview] = useState<LushaContactPreview | null>(null)
  const [lushaRevealChannel, setLushaRevealChannel] = useState<ContactChannel>("email")
  const [lushaRevealConfirmOpen, setLushaRevealConfirmOpen] = useState(false)
  const [professionalNoteDrafts, setProfessionalNoteDrafts] = useState<Record<number, string>>({})
  const [privacyNoteDrafts, setPrivacyNoteDrafts] = useState<Record<number, string>>({})
  const [verificationTarget, setVerificationTarget] = useState<Alumni | null>(null)
  const [verificationEvidence, setVerificationEvidence] = useState<ProfessionalVerificationEvidence | null>(null)
  const [verificationDraft, setVerificationDraft] = useState<ProfessionalVerificationDraft | null>(null)
  const [verificationEvidenceSource, setVerificationEvidenceSource] = useState("")
  const [verificationReviewNote, setVerificationReviewNote] = useState("")
  const [verificationStage, setVerificationStage] = useState<"review" | "confirm">("review")
  const [verificationLoading, setVerificationLoading] = useState(false)
  const [verificationSaving, setVerificationSaving] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState("")
  const [outreachSearch, setOutreachSearch] = useState("")
  const [outreachCompany, setOutreachCompany] = useState("All companies")
  const [outreachStatus, setOutreachStatus] = useState("All alumni")
  const [outreachRelevance, setOutreachRelevance] = useState("All")

  const loadWorkspace = useCallback(async () => {
    try {
      setWorkspaceLoading(true)
      const response = await fetch(API_ROUTES.workspace, { cache: "no-store" })
      const data = await response.json() as { alumni?: Alumni[]; companyPriorities?: Record<string, string>; programmeOptions?: ProgrammeOption[]; latestImport?: LatestImport | null; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to load the shared workspace.")
      setAlumni(data.alumni ?? [])
      setCompanyPriorities(data.companyPriorities ?? {})
      setConfiguredProgrammes(data.programmeOptions ?? [])
      setLatestImport(data.latestImport ?? null)
      setWorkspaceMessage("")
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Unable to connect to the shared database.")
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0)
    return () => window.clearTimeout(timer)
  }, [loadWorkspace, session.canOperate])

  const loadOpportunitySummary = useCallback(async () => {
    if (!session.canOperate) return
    try {
      const response = await fetch(`${apiPath("/api/opportunities")}?page=1&pageSize=10`, { cache: "no-store" })
      const data = await response.json() as { summary?: { total: number; active: number; assignedToMe: number; followUpsDue: number } }
      if (response.ok && data.summary) setOpportunitySummary(data.summary)
    } catch {
      // The Opportunities workspace owns its visible error state; overview remains non-blocking.
    }
  }, [session.canOperate])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOpportunitySummary(), 0)
    const refresh = () => void loadOpportunitySummary()
    window.addEventListener("corporate-opportunities:changed", refresh)
    return () => { window.clearTimeout(timer); window.removeEventListener("corporate-opportunities:changed", refresh) }
  }, [loadOpportunitySummary])

  useEffect(() => {
    const applyRouteState = () => {
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const canonical = canonicalWorkspaceUrl(window.location.href, {
        canOperate: session.canOperate,
        canAdminister: session.canAdminister,
      })
      if (canonical !== current) window.history.replaceState({}, "", canonical)
      setRouteSearch(window.location.search)
      setMailPreview(null)
      setMailSendConfirmOpen(false)
      composeGenerationRef.current += 1
      setComposeState({ status: "idle", message: "" })
    }
    applyRouteState()
    window.addEventListener("popstate", applyRouteState)
    return () => window.removeEventListener("popstate", applyRouteState)
  }, [session.canAdminister, session.canOperate])

  const routeState = profileRouteState(routeSearch)
  const engagementEventId = parseEngagementEventId(routeSearch)
  const controlledEmailIntent = useMemo(() => parseControlledEmailIntent(routeSearch), [routeSearch])
  const activeTab = controlledEmailIntent ? "engagement" : routeState.tab ?? "overview"
  const activeIntelligenceView = intelligenceView(routeSearch)
  const selected = activeTab === "directory" && routeState.profileAlumnusId
    ? alumni.find(person => person.id === routeState.profileAlumnusId) ?? null
    : null

  useEffect(() => {
    if (workspaceLoading || activeTab !== "directory" || !routeState.profileAlumnusId || selected) return
    const destination = workspaceTabUrl(window.location.href, "directory")
    window.history.replaceState({}, "", destination)
    const timer = window.setTimeout(() => setRouteSearch(window.location.search), 0)
    return () => window.clearTimeout(timer)
  }, [activeTab, routeState.profileAlumnusId, selected, workspaceLoading])

  function navigateWorkspace(destination: string, mode: "push" | "replace" = "push") {
    const canonical = canonicalWorkspaceUrl(new URL(destination, window.location.href).href, session)
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", canonical)
    setRouteSearch(window.location.search)
  }

  const loadEnrichment = useCallback(async () => {
    try {
      const response = await fetch(API_ROUTES.enrichment, { cache: "no-store" })
      const data = await response.json() as { modes?: Record<Provider, ProviderMode>; usage?: ProviderUsage; history?: ProviderHistory[]; contactResume?: Record<number, { emailAvailable: boolean | null; phoneAvailable: boolean | null }>; error?: string }
      if (!response.ok || !data.usage) throw new Error(data.error || "Unable to load provider activity.")
      setProviderModes(data.modes ?? { coresignal: data.usage.coresignal.mode ?? "mock", lusha: data.usage.lusha.mode ?? "mock" })
      setProviderUsage(data.usage)
      setProviderHistory(data.history ?? [])
      setContactResume(data.contactResume ?? {})
      setCreditDrafts({ coresignal: String(data.usage.coresignal.limit), lusha: String(data.usage.lusha.limit) })
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to load provider activity.")
    }
  }, [])

  async function refreshProviderHistory() {
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh_history" }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || "Unable to refresh provider history.")
      await loadEnrichment()
      setEnrichmentMessage("Provider history refreshed and audited.")
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to refresh provider history.")
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEnrichment(), 0)
    return () => window.clearTimeout(timer)
  }, [loadEnrichment])

  const loadPendingDiscoverySummary = useCallback(async () => {
    if (!session.canOperate) return
    try {
      const response = await fetch(`${API_ROUTES.discovery}?view=summary`, { cache: "no-store" })
      const data = await response.json() as { pendingCount?: number; liveMaximum?: number; regularSearch?: { enabled: boolean; configured: boolean; maxRequests: number; automaticPagination: boolean }; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to load pending external-review status.")
      setPendingDiscoveryCount(data.pendingCount ?? 0)
      setCoresignalLiveMaximum(data.liveMaximum ?? 5)
      setRegularSearchStatus(data.regularSearch ?? { enabled: false, configured: false, maxRequests: 1, automaticPagination: false })
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to load pending external-review status.")
    }
  }, [session.canOperate])

  useEffect(() => {
    if (!session.canOperate) return
    const timer = window.setTimeout(() => void loadPendingDiscoverySummary(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPendingDiscoverySummary, session.canOperate])

  useEffect(() => {
    if (!session.canOperate) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setDiscoveryCoverageLoading(true)
      setDiscoveryCoverageError("")
      try {
        const response = await fetch(API_ROUTES.discovery, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "plan", filters: discoveryFilters }),
          signal: controller.signal,
        })
        const data = await response.json() as { coverage?: DiscoveryCoveragePlan; providerCallMade?: boolean; applicationUnits?: number; error?: string }
        if (!response.ok || !data.coverage) throw new Error(data.error || "Unable to plan discovery coverage.")
        setDiscoveryCoverage(data.coverage)
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return
        setDiscoveryCoverage(null)
        setDiscoveryCoverageError(error instanceof Error ? error.message : "Unable to plan discovery coverage.")
      } finally {
        if (!controller.signal.aborted) setDiscoveryCoverageLoading(false)
      }
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [discoveryFilters, session.canOperate])

  const loadEngagements = useCallback(async () => {
    if (!session.canOperate) return
    try {
      engagementWorkCountRef.current += 1
      setEngagementLoading(true)
      const response = await fetch(API_ROUTES.engagements, { cache: "no-store" })
      const data = await response.json() as { events?: EngagementEvent[]; templates?: MessageTemplate[]; assignees?: Array<{ id: number; displayName: string }>; mode?: "mock" | "live"; mail?: { configured?: boolean }; error?: string }
      if (!response.ok || !data.events) throw new Error(data.error || "Unable to load the shared engagement queue.")
      setEngagements(data.events)
      setMessageTemplates(data.templates ?? [])
      setEngagementAssignees(data.assignees ?? [])
      setMailMode(data.mode ?? "mock")
      setMailConfigured(Boolean(data.mail?.configured))
      setSelectedEngagement(current => current ? data.events?.find(event => event.id === current.id) ?? null : null)
      setEngagementMessage("")
    } catch (error) {
      setEngagementMessage(error instanceof Error ? error.message : "Unable to load the shared engagement queue.")
    } finally {
      engagementWorkCountRef.current = Math.max(0, engagementWorkCountRef.current - 1)
      setEngagementLoading(engagementWorkCountRef.current > 0)
    }
  }, [session.canOperate])

  function beginEngagementWork() {
    engagementWorkCountRef.current += 1
    setEngagementLoading(true)
  }

  function finishEngagementWork() {
    engagementWorkCountRef.current = Math.max(0, engagementWorkCountRef.current - 1)
    setEngagementLoading(engagementWorkCountRef.current > 0)
  }

  useEffect(() => {
    if (!session.canOperate) return
    const timer = window.setTimeout(() => void loadEngagements(), 0)
    return () => window.clearTimeout(timer)
  }, [loadEngagements, session.canOperate])

  const loadSignalsStatus = useCallback(async () => {
    if (!session.canOperate) return
    try {
      const response = await fetch(API_ROUTES.signals, { cache: "no-store" })
      const data = await response.json()
      if (response.ok) setSignalsStatus(data)
    } catch {
      setSignalsStatus(null)
    }
  }, [session.canOperate])

  useEffect(() => {
    if (!session.canOperate) return
    const timer = window.setTimeout(() => void loadSignalsStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [loadSignalsStatus, session.canOperate])

  async function runOneContactSignalsCheck() {
    if (!signalsTarget) return
    setSignalsRunning(true)
    setSignalsMessage("")
    try {
      const response = await fetch(API_ROUTES.signals, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", alumniIds: [signalsTarget.id], confirmed: true }),
      })
      const data = await response.json() as { message?: string; providerReportedCredits?: number | null; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to check Professional Signals.")
      const usage = data.providerReportedCredits === null || data.providerReportedCredits === undefined
        ? " Provider usage was not returned; reconciliation is required."
        : ` Lusha reported ${data.providerReportedCredits} credit${data.providerReportedCredits === 1 ? "" : "s"} charged.`
      setSignalsMessage(`${data.message ?? "Professional Signals check complete."}${usage}`)
      setSignalsConfirmOpen(false)
      await Promise.all([loadEngagements(), loadEnrichment()])
    } catch (error) {
      setSignalsMessage(error instanceof Error ? error.message : "Unable to check Professional Signals.")
    } finally {
      setSignalsRunning(false)
    }
  }

  const companies = useMemo(() => normalizeCompanyOptions(alumni.filter(person => (person.lifecycle ?? "Active") === "Active").map(person => person.company)), [alumni])
  const programmeChoices = useMemo(() => programmeFilterOptions(configuredProgrammes, alumni.map(person => person.programme)), [alumni, configuredProgrammes])
  const activeProgrammeChoices = useMemo(() => programmeChoices.filter(option => option.active), [programmeChoices])
  useEffect(() => {
    if (!configuredProgrammes.length) return
    const activeCodes = new Set(activeProgrammeChoices.map(option => option.value))
    const timer = window.setTimeout(() => setDiscoveryFilters(current => {
        const selected = current.discoveryProgrammes.filter(code => activeCodes.has(code))
        return selected.length === current.discoveryProgrammes.length ? current : { ...current, discoveryProgrammes: selected }
      }), 0)
    return () => window.clearTimeout(timer)
  }, [activeProgrammeChoices, configuredProgrammes.length])
  const activeTargetCompany = companies.includes(targetCompany) ? targetCompany : companies[0] ?? ""
  const routeEligibleAlumni = useMemo(() => alumni.filter(person => (person.lifecycle ?? "Active") === "Active").sort((a, b) => a.name.localeCompare(b.name)), [alumni])
  const filtered = useMemo(() => alumni.filter(person => {
    const relevance = relevanceBreakdown(person, companyPriorities, engagements).score
    return matchesInternalFilters(person, filters, relevance, operationalStatus(person))
  }).sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score), [alumni, companyPriorities, engagements, filters])

  const topLeads = [...alumni].sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score || a.name.localeCompare(b.name)).slice(0, 5)
  const targetAlumni = alumni.filter(person => person.company === activeTargetCompany).sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score)
  const activeOutreach = alumni.filter(person => isActiveOutreach(person.status)).length
  const contactReadyCount = alumni.filter(person => operationalStatus(person) === "Contact-ready").length
  const today = new Date().toISOString().slice(0, 10)
  const nextWeekDate = new Date(); nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7)
  const nextWeek = nextWeekDate.toISOString().slice(0, 10)
  const birthdayEvents = engagements.filter(event => event.eventType === "Birthday")
  const professionalEvents = engagements.filter(event => event.eventType === "Professional Signal")
  const actionableProfessionalEvents = professionalEvents.filter(event => !isCompletedEngagement(event.status))
  const signalsTarget = alumni.find(person => person.id === signalsAlumnusId) ?? null
  const localDevelopment = process.env.NODE_ENV === "development"
  const signalsUi = signalsPresentation({ development: localDevelopment, liveEnabled: Boolean(signalsStatus?.liveEnabled), entitlement: signalsStatus?.entitlement ?? "unknown", configured: Boolean(signalsStatus?.configured) })
  const signalsActive = signalsUi.available
  const mailUi = mailPresentation({ development: localDevelopment, mode: mailMode, configured: mailConfigured })
  const birthdaysToday = birthdayEvents.filter(event => event.eventDate === today)
  const birthdaysNextWeek = birthdayEvents.filter(event => event.eventDate >= today && event.eventDate <= nextWeek)
  const assignedToMe = engagements.filter(event => (event.owner?.displayName ?? event.assignedTo) === currentDemoUser && !["Closed", "Skipped"].includes(event.status))
  const followUpsDue = engagements.filter(event => event.status === "Follow-up Due")
  const professionalSelectionReady = selectedForEnrichment.length > 0 && (providerModes.coresignal === "mock" || selectedForEnrichment.length === 1) && providerUsage.coresignal.remaining >= selectedForEnrichment.length && (providerModes.coresignal === "mock" || providerUsage.coresignal.configured)
  const selectedContactPeople = alumni.filter(person => selectedForEnrichment.includes(person.id))
  const emailPlan = contactEnrichmentPlan(selectedContactPeople, ["email"])
  const phonePlan = contactEnrichmentPlan(selectedContactPeople, ["phone"])
  const bothPlan = contactEnrichmentPlan(selectedContactPeople, ["email", "phone"])
  const pendingContactPlan = contactConfirm
    ? contactEnrichmentPlan(alumni.filter(person => contactConfirm.ids.includes(person.id)), contactConfirm.channels)
    : null
  const lushaEmailReady = emailPlan.emailOperations > 0 && (providerModes.lusha !== "live" || selectedContactPeople.length === 1) && providerUsage.lusha.remaining >= (providerModes.lusha === "live" ? 1 : emailPlan.emailOperations) && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const lushaPhoneReady = phonePlan.phoneOperations > 0 && (providerModes.lusha !== "live" || selectedContactPeople.length === 1) && providerUsage.lusha.remaining >= (providerModes.lusha === "live" ? 1 : phonePlan.phoneOperations * 5) && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const lushaBothReady = bothPlan.emailOperations + bothPlan.phoneOperations > 0 && providerUsage.lusha.remaining >= bothPlan.emailOperations + bothPlan.phoneOperations * 5 && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const birthdayReady = (event: EngagementEvent) => Boolean(event.alumnus?.email)
    && ["Confirmed internally", "Manually confirmed", "PDL sourced", "Coresignal sourced"].includes(event.birthday?.status ?? "")
    && ["Standard engagement allowed", "Birthday engagement allowed"].includes(event.preference)
    && !isCompletedEngagement(event.status)
  const reviewableBirthdaysNextWeek = birthdaysNextWeek.filter(birthdayReady)
  const discoverySearchOperationReserve = providerModes.coresignal === "live" ? 1 : 0
  const discoveryMaximum = maximumDiscoveryCount(providerUsage.coresignal.remaining, providerModes.coresignal === "live" ? coresignalLiveMaximum : 100, discoverySearchOperationReserve)
  const discoveryCountPreset = ["1", "5", "10", "20"].includes(discoveryLimit) ? discoveryLimit : "custom"
  const discoveryCountValidation = validateDiscoveryCount(Number(discoveryLimit), providerUsage.coresignal.remaining, providerModes.coresignal === "live" ? coresignalLiveMaximum : 100, discoverySearchOperationReserve)
  const discoveryMaximumApplicationUsage = discoveryApplicationUnits(Number(discoveryLimit), discoverySearchOperationReserve)
  const visibleEngagements = engagements.filter(event => engagementMatches(event, {
    queue: engagementFilter, period: engagementPeriod, company: engagementCompany,
    assignee: engagementAssignee, actionState: engagementActionState,
    currentUser: currentDemoUser, today,
  }))

  function changeTargetCompany(company: string) {
    setTargetCompany(company)
    setTargetAlumnusId(null)
    setRouteRecommendation(null)
    setRouteMessage("")
  }

  function selectTargetAlumnus(id: number | null) {
    setTargetAlumnusId(id)
    const person = id ? routeEligibleAlumni.find(item => item.id === id) : null
    if (person) setOverviewCompany(person.company)
    setRouteRecommendation(null)
    setRouteMessage("")
  }

  function replaceAlumnus(updated: Alumni) {
    setAlumni(current => current.map(person => person.id === updated.id ? updated : person))
  }

  function beginSync() {
    pendingSyncCountRef.current += 1
    setSyncing(true)
  }

  function finishSync() {
    pendingSyncCountRef.current = Math.max(0, pendingSyncCountRef.current - 1)
    setSyncing(pendingSyncCountRef.current > 0)
  }

  async function saveAlumnus(id: number, changes: { status?: OutreachStatus; assessment?: Partial<Alumni["assessment"]> }) {
    const previous = alumni.find(person => person.id === id)
    if (!previous) return
    const assessmentKeys = Object.keys(changes.assessment ?? {}) as Array<keyof Alumni["assessment"]>
    const mutationKey = changes.status ? `alumnus:${id}:status` : `alumnus:${id}:assessment:${assessmentKeys.join(",")}`
    const initialConfirmed = changes.status
      ? { status: previous.status } as { status?: OutreachStatus; assessment?: Partial<Alumni["assessment"]> }
      : { assessment: Object.fromEntries(assessmentKeys.map(key => [key, previous.assessment[key]])) as Partial<Alumni["assessment"]> }
    replaceAlumnus({ ...previous, ...(changes.status ? { status: changes.status } : {}), assessment: { ...previous.assessment, ...changes.assessment } })
    beginSync()
    const result = await persistedMutationsRef.current.run(mutationKey, initialConfirmed, async () => {
      const response = await fetch(API_ROUTES.workspace, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_alumnus", id, ...changes }) })
      const data = await response.json() as { alumnus?: Alumni; error?: string }
      if (!response.ok || !data.alumnus) throw new Error(data.error || "Unable to save the update.")
      return changes.status
        ? { status: data.alumnus.status }
        : { assessment: Object.fromEntries(assessmentKeys.map(key => [key, data.alumnus!.assessment[key]])) as Partial<Alumni["assessment"]> }
    })
    try {
      if (result.ok && result.latest) {
        setAlumni(current => current.map(person => person.id === id ? {
          ...person,
          ...(result.value.status ? { status: result.value.status } : {}),
          assessment: result.value.assessment ? { ...person.assessment, ...result.value.assessment } : person.assessment,
        } : person))
        setWorkspaceMessage("Saved to the shared workspace.")
      }
      if (!result.ok && result.latest) {
        setWorkspaceMessage(result.error instanceof Error ? result.error.message : "Unable to save the update.")
        setAlumni(current => current.map(person => person.id === id ? {
          ...person,
          ...(result.rollback.status ? { status: result.rollback.status } : {}),
          assessment: result.rollback.assessment ? { ...person.assessment, ...result.rollback.assessment } : person.assessment,
        } : person))
      }
    } finally {
      finishSync()
    }
  }

  function updateStatus(id: number, status: OutreachStatus) {
    void saveAlumnus(id, { status })
  }

  function updateAssessment(id: number, field: keyof Alumni["assessment"], value: string) {
    void saveAlumnus(id, { assessment: { [field]: value } })
  }

  async function updateCompanyPriority(name: string, priority: string) {
    const previous = companyPriorities[name]
    const mutationKey = `company:${name}:priority`
    setCompanyPriorities(current => ({ ...current, [name]: priority }))
    beginSync()
    const result = await persistedMutationsRef.current.run<string | undefined>(mutationKey, previous, async () => {
      const response = await fetch(API_ROUTES.workspace, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_priority", company: name, priority }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to save company priority.")
      return priority
    })
    try {
      if (result.ok && result.latest) setWorkspaceMessage("Company priority saved for all committee members.")
      if (!result.ok && result.latest) {
        setWorkspaceMessage(result.error instanceof Error ? result.error.message : "Unable to save company priority.")
        setCompanyPriorities(current => {
          if (result.rollback !== undefined) return { ...current, [name]: result.rollback }
          const next = { ...current }
          delete next[name]
          return next
        })
      }
    } finally {
      finishSync()
    }
  }

  async function updatePrivacy(person: Alumni, changes: Partial<NonNullable<Alumni["privacy"]>>) {
    const fallback = { generalContactStatus: "Unknown", professionalEngagementStatus: "Unknown", birthdayEngagementStatus: "Unknown", consentSource: "Unknown", notes: "", updatedAt: "", updatedBy: "" }
    const previousPrivacy = person.privacy ?? fallback
    const changedKeys = Object.keys(changes) as Array<keyof NonNullable<Alumni["privacy"]>>
    const mutationKey = `alumnus:${person.id}:privacy:${changedKeys.join(",")}`
    const initialConfirmed = Object.fromEntries(changedKeys.map(key => [key, previousPrivacy[key]])) as Partial<NonNullable<Alumni["privacy"]>>
    const privacy = { ...previousPrivacy, ...changes }
    replaceAlumnus({ ...person, privacy })
    beginSync()
    const result = await persistedMutationsRef.current.run(mutationKey, initialConfirmed, async () => {
      const response = await fetch(API_ROUTES.workspace, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_privacy", id: person.id, privacy }) })
      const data = await response.json() as { privacy?: NonNullable<Alumni["privacy"]>; error?: string }
      if (!response.ok || !data.privacy) throw new Error(data.error || "Unable to save privacy preferences.")
      return Object.fromEntries(changedKeys.map(key => [key, data.privacy![key]])) as Partial<NonNullable<Alumni["privacy"]>>
    }, `alumnus:${person.id}:privacy-write`)
    try {
      if (result.ok && result.latest) {
        setAlumni(current => current.map(item => item.id === person.id ? { ...item, privacy: { ...(item.privacy ?? fallback), ...result.value } } : item))
        if (typeof result.value.notes === "string") setPrivacyNoteDrafts(current => ({ ...current, [person.id]: result.value.notes! }))
        setWorkspaceMessage("Privacy preference saved and audited.")
      }
      if (!result.ok && result.latest) {
        setWorkspaceMessage(result.error instanceof Error ? result.error.message : "Unable to save privacy preferences.")
        setAlumni(current => current.map(item => item.id === person.id ? { ...item, privacy: { ...(item.privacy ?? fallback), ...result.rollback } } : item))
        if (typeof result.rollback.notes === "string") setPrivacyNoteDrafts(current => ({ ...current, [person.id]: result.rollback.notes! }))
      }
    } finally {
      finishSync()
    }
  }

  async function updateProfessionalDataQuality(person: Alumni, status: string, note: string) {
    const mutationKey = `alumnus:${person.id}:professional-data-quality`
    const previous = { status: person.professionalDataStatus, note: person.professionalDataNote }
    replaceAlumnus({ ...person, professionalDataStatus: status, professionalDataNote: note })
    beginSync()
    const result = await persistedMutationsRef.current.run(mutationKey, previous, async () => {
      const response = await fetch(API_ROUTES.workspace, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_data_quality", id: person.id, professionalDataStatus: status, professionalDataNote: note }) })
      const data = await response.json() as { alumnus?: Alumni; error?: string }
      if (!response.ok || !data.alumnus) throw new Error(data.error || "Unable to save the professional data-quality review.")
      return { status: data.alumnus.professionalDataStatus, note: data.alumnus.professionalDataNote }
    })
    try {
      if (result.ok && result.latest) {
        setAlumni(current => current.map(item => item.id === person.id ? { ...item, professionalDataStatus: result.value.status, professionalDataNote: result.value.note } : item))
        setProfessionalNoteDrafts(current => ({ ...current, [person.id]: result.value.note ?? "" }))
        setWorkspaceMessage("Professional data-quality status saved without overwriting profile fields.")
      }
      if (!result.ok && result.latest) {
        setWorkspaceMessage(result.error instanceof Error ? result.error.message : "Unable to save the professional data-quality review.")
        setAlumni(current => current.map(item => item.id === person.id ? { ...item, professionalDataStatus: result.rollback.status, professionalDataNote: result.rollback.note } : item))
        setProfessionalNoteDrafts(current => ({ ...current, [person.id]: result.rollback.note ?? "" }))
      }
    } finally {
      finishSync()
    }
  }

  function closeProfessionalVerification() {
    setVerificationTarget(null)
    setVerificationEvidence(null)
    setVerificationDraft(null)
    setVerificationEvidenceSource("")
    setVerificationReviewNote("")
    setVerificationStage("review")
    setVerificationMessage("")
  }

  async function openProfessionalVerification(person: Alumni) {
    setVerificationTarget(person)
    setVerificationDraft({
      profileMatch: person.verification.profileMatch,
      currentCompany: person.verification.currentCompany,
      designation: person.verification.designation,
      location: person.verification.location,
    })
    setVerificationEvidence(null)
    setVerificationEvidenceSource("")
    setVerificationReviewNote("")
    setVerificationStage("review")
    setVerificationMessage("")
    setVerificationLoading(true)
    try {
      const response = await fetch(`${API_ROUTES.professionalVerification}?alumnusId=${person.id}`, { cache: "no-store" })
      const data = await response.json() as { evidence?: ProfessionalVerificationEvidence; error?: string }
      if (!response.ok || !data.evidence) throw new Error(data.error || "Unable to load verification evidence.")
      setVerificationEvidence(data.evidence)
      setVerificationDraft(data.evidence.stored.verification)
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Unable to load verification evidence.")
    } finally {
      setVerificationLoading(false)
    }
  }

  function professionalVerificationChanges() {
    if (!verificationTarget || !verificationDraft) return []
    const current: ProfessionalVerificationDraft = verificationEvidence?.stored.verification ?? {
      profileMatch: verificationTarget.verification.profileMatch,
      currentCompany: verificationTarget.verification.currentCompany,
      designation: verificationTarget.verification.designation,
      location: verificationTarget.verification.location,
    }
    return (Object.keys(current) as ProfessionalVerificationField[])
      .filter(field => current[field] !== verificationDraft[field])
      .map(field => ({ field, oldValue: current[field], newValue: verificationDraft[field] }))
  }

  function reviewProfessionalVerification() {
    const changes = professionalVerificationChanges()
    if (!changes.length) return setVerificationMessage("Choose at least one changed verification state.")
    if (changes.some(change => isPositiveProfessionalVerification(change.field, change.newValue)) && !verificationEvidenceSource) {
      return setVerificationMessage("Choose an evidence source before positively verifying a field.")
    }
    if (verificationEvidenceSource === "Other documented evidence" && !verificationReviewNote.trim()) {
      return setVerificationMessage("Add a review note for other documented evidence.")
    }
    setVerificationMessage("")
    setVerificationStage("confirm")
  }

  async function saveProfessionalVerification() {
    if (!verificationTarget || !verificationDraft) return
    const changes = professionalVerificationChanges()
    if (!changes.length) return setVerificationMessage("No verification states changed.")
    setVerificationSaving(true)
    setVerificationMessage("")
    try {
      const fields = Object.fromEntries(changes.map(change => [change.field, change.newValue]))
      const response = await fetch(API_ROUTES.professionalVerification, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "verify_professional_fields",
          alumnusId: verificationTarget.id,
          fields,
          evidenceSource: verificationEvidenceSource,
          note: verificationReviewNote,
          confirmed: true,
        }),
      })
      const data = await response.json() as { verification?: Pick<Alumni["verification"], "profileMatch" | "currentCompany" | "designation" | "location">; reviewedBy?: string; reviewedAt?: string; error?: string }
      if (!response.ok || !data.verification) throw new Error(data.error || "Unable to save professional verification.")
      const updated = {
        ...verificationTarget,
        verification: { ...verificationTarget.verification, ...data.verification },
        updatedBy: data.reviewedBy ?? verificationTarget.updatedBy,
        updatedAt: data.reviewedAt ?? verificationTarget.updatedAt,
      }
      replaceAlumnus(updated)
      setWorkspaceMessage("Professional verification saved with field history and security audit.")
      closeProfessionalVerification()
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Unable to save professional verification.")
    } finally {
      setVerificationSaving(false)
    }
  }

  function downloadTemplate() {
    const content = [
      "name,batch,graduation_year,programme,education,company,title,function,seniority,location,previous_companies,experience_years,email,phone,linkedin_url,confidence,status,note",
      'Demo Alumnus,2018,2018,PGP,Indian Institute of Management Lucknow,Example Company,"Senior Manager, Talent Acquisition",HR,Senior Manager,Bengaluru,Example Consulting,8,demo@example.com,+910000000000,,70,Not contacted,"Demonstration record only"',
    ].join("\n")
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "corporate-network-alumni-template.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  async function readImportFile() {
    if (!importFile) throw new Error("Choose a CSV or Excel file first.")
    const extension = importFile.name.toLowerCase().split(".").pop()
    if (extension === "csv") return { records: parseCsv(await importFile.text()), sheetName: undefined }
    if (extension === "xlsx") return parseXlsx(await importFile.arrayBuffer())
    throw new Error("Choose a .csv or .xlsx alumni file.")
  }

  async function validateImportFile() {
    setImporting(true)
    setImportMessage("")
    try {
      const parsed = await readImportFile()
      const review = validateImport(parsed.records, alumni, programmeChoices.map(option => option.value))
      setImportReview({ ...review, sheetName: parsed.sheetName })
      setApprovedImportUpdates([])
      setImportMessage(review.blocking ? "Resolve the blocking rows before importing." : "Validation complete. Review new records and any existing-record differences before importing.")
    } catch (error) {
      setImportReview(null)
      setImportMessage(error instanceof Error ? error.message : "Unable to validate the selected file.")
    } finally {
      setImporting(false)
    }
  }

  async function importAlumni() {
    if (!importFile || !importReview) { setImportMessage("Validate and review the selected file first."); return }
    if (importReview.blocking) { setImportMessage("Resolve the blocking rows before importing."); return }
    setImporting(true)
    try {
      const parsed = await readImportFile()
      const response = await fetch(API_ROUTES.workspace, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", filename: importFile.name, records: parsed.records, approvedUpdateKeys: approvedImportUpdates }) })
      const data = await response.json() as { imported?: number; updated?: number; protectedFields?: number; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to import the selected file.")
      setImportMessage(`${data.imported ?? 0} new alumni added${data.updated ? ` · ${data.updated} existing records safely updated` : ""}${data.protectedFields ? ` · ${data.protectedFields} verified fields preserved` : ""}.`)
      setImportFile(null)
      setImportReview(null)
      setApprovedImportUpdates([])
      await loadWorkspace()
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to import the selected file.")
    } finally {
      setImporting(false)
    }
  }

  async function executeEnrichment(ids: number[], requestedProviders: Provider[], operation: "manual" | "batch", contactChannels?: ContactChannel[]) {
    if (!ids.length) { setEnrichmentMessage("Select at least one alumnus first."); return }
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alumniIds: ids.slice(0, 25), providers: requestedProviders, operation, contactChannels }),
      })
      const data = await response.json() as { results?: Array<{ status: string; alumnusName?: string; appliedChannels?: ContactChannel[]; skippedVerifiedChannels?: ContactChannel[]; blockedReason?: string }>; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to run enrichment.")
      const results = data.results ?? []
      const appliedEmail = results.reduce((count, result) => count + (result.appliedChannels?.includes("email") ? 1 : 0), 0)
      const appliedPhone = results.reduce((count, result) => count + (result.appliedChannels?.includes("phone") ? 1 : 0), 0)
      const preserved = results.reduce((count, result) => count + (result.skippedVerifiedChannels?.length ?? 0), 0)
      const blocked = results.filter(result => result.blockedReason).length
      const summary = [appliedEmail && `${appliedEmail} email channel${appliedEmail === 1 ? "" : "s"} enriched`, appliedPhone && `${appliedPhone} phone channel${appliedPhone === 1 ? "" : "s"} enriched`, preserved && `${preserved} existing verified channel${preserved === 1 ? "" : "s"} preserved`, blocked && `${blocked} alumn${blocked === 1 ? "us" : "i"} skipped`].filter(Boolean).join(". ")
      setEnrichmentMessage(summary ? `${summary}. Full details are in response history.` : "No eligible contact channels required a provider call.")
      setContactConfirm(null)
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to run enrichment.")
    } finally {
      setEnriching(false)
    }
  }

  function prepareContactEnrichment(ids: number[], channels: ContactChannel[], operation: "manual" | "batch") {
    const people = alumni.filter(person => ids.includes(person.id))
    const plan = contactEnrichmentPlan(people, channels)
    if (!plan.emailOperations && !plan.phoneOperations) {
      setEnrichmentMessage("No missing or unverified contact channels are eligible. Existing verified contacts were preserved.")
      return
    }
    setContactConfirm({ ids, channels, operation })
  }

  function runEnrichment(ids: number[], requestedProviders: Provider[], operation: "manual" | "batch", contactChannels?: ContactChannel[]) {
    if (requestedProviders.length === 1 && requestedProviders[0] === "lusha" && contactChannels?.length) {
      prepareContactEnrichment(ids, contactChannels, operation)
      return Promise.resolve()
    }
    return executeEnrichment(ids, requestedProviders, operation, contactChannels)
  }

  function prepareLushaReveal(person: Alumni, channel: ContactChannel) {
    setLushaTarget(person)
    setLushaRevealChannel(channel)
    const storedContactId = person.lushaPersonId?.trim() ?? ""
    const completedEmailAvailability = contactResume[person.id]?.emailAvailable ?? null
    const completedPhoneAvailability = contactResume[person.id]?.phoneAvailable ?? null
    setLushaPreview(storedContactId ? {
      alumnusId: person.id,
      alumnusName: person.name,
      contactId: storedContactId,
      fullName: person.name,
      jobTitle: "",
      company: "",
      professionalProfile: normalizeProfessionalProfileUrl(person.linkedinUrl),
      emailAvailable: completedEmailAvailability,
      phoneAvailable: completedPhoneAvailability,
      status: "success",
      creditsUsed: 0,
      usageSource: "stored",
      resumedFromStoredContact: true,
    } : null)
    setLushaRevealConfirmOpen(false)
    setEnrichmentMessage("")
  }

  async function searchLushaContactPreview() {
    if (!lushaTarget) return
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "lusha_search_contact", alumnusId: lushaTarget.id, contactChannel: lushaRevealChannel }),
      })
      const data = await response.json() as { preview?: LushaContactPreview; error?: string }
      if (!response.ok || !data.preview) throw new Error(data.error || "Unable to retrieve the Lusha contact preview.")
      setLushaPreview(data.preview)
      await loadEnrichment()
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to retrieve the Lusha contact preview.")
    } finally {
      setEnriching(false)
    }
  }

  async function revealLushaEmail() {
    if (!lushaTarget || !lushaPreview?.contactId) return
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "lusha_reveal_email", alumnusId: lushaTarget.id, confirmed: true }),
      })
      const data = await response.json() as { result?: { status: string; creditsUsed: number | null }; error?: string }
      if (!response.ok || !data.result) throw new Error(data.error || "Unable to reveal the Lusha email.")
      setEnrichmentMessage(data.result.status === "success" ? "Lusha returned an email. The provider-sourced value and actual reported usage are recorded." : "Lusha did not return an email. The provider outcome and reported usage are recorded.")
      setLushaRevealConfirmOpen(false)
      setLushaTarget(null)
      setLushaPreview(null)
      await Promise.all([loadWorkspace(), loadEnrichment(), loadEngagements()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to reveal the Lusha email.")
    } finally {
      setEnriching(false)
    }
  }

  async function revealLushaPhone() {
    if (!lushaTarget || !lushaPreview?.contactId) return
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "lusha_reveal_phone", alumnusId: lushaTarget.id, confirmed: true }),
      })
      const data = await response.json() as { result?: { status: string; creditsUsed: number | null }; error?: string }
      if (!response.ok || !data.result) throw new Error(data.error || "Unable to reveal the Lusha phone.")
      setEnrichmentMessage(data.result.status === "success" ? "Lusha returned a phone. The provider-sourced value and actual reported usage are recorded; the existing email was preserved." : "Lusha did not return a phone. The provider outcome and reported usage are recorded.")
      setLushaRevealConfirmOpen(false)
      setLushaTarget(null)
      setLushaPreview(null)
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to reveal the Lusha phone.")
    } finally {
      setEnriching(false)
    }
  }

  async function saveCreditLimit(provider: Provider) {
    const monthlyCreditLimit = Number(creditDrafts[provider])
    if (!Number.isInteger(monthlyCreditLimit) || monthlyCreditLimit < 0) { setEnrichmentMessage("Enter a whole-number credit limit."); return }
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, monthlyCreditLimit }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to save the credit limit.")
      setEnrichmentMessage(`${provider.toUpperCase()} monthly application limit saved.`)
      await loadEnrichment()
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to save the credit limit.")
    }
  }

  async function reconcileProviderUsage(item: ProviderHistory) {
    const reconciledCredits = Number(usageReconciliationDrafts[item.id])
    if (!Number.isInteger(reconciledCredits) || reconciledCredits < 0) {
      setEnrichmentMessage("Enter the whole-number account usage delta observed for this operation.")
      return
    }
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reconcile_usage", historyId: item.id, reconciledCredits, reconciliationSource: "Lusha account dashboard reconciliation" }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to reconcile provider usage.")
      setEnrichmentMessage(`${item.operation} reconciled to an observed account delta of ${reconciledCredits}.`)
      await loadEnrichment()
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to reconcile provider usage.")
    }
  }

  async function validateLushaConnection() {
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate_lusha" }) })
      const data = await response.json() as { connected?: boolean; accountUsage?: { used: number | null; remaining: number | null; limit: number | null }; error?: string }
      if (!response.ok || !data.connected) throw new Error(data.error || "Unable to validate Lusha.")
      const usage = data.accountUsage
      const details = usage && (usage.used !== null || usage.remaining !== null || usage.limit !== null)
        ? ` Account usage reported: ${usage.used ?? "unknown"} used, ${usage.remaining ?? "unknown"} remaining, ${usage.limit ?? "unknown"} limit.`
        : " Authentication succeeded; this account response did not expose a normalized balance."
      setEnrichmentMessage(`Lusha authenticated through the non-contact account usage endpoint.${details}`)
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to validate Lusha.")
    }
  }

  function toggleEnrichmentSelection(id: number) {
    setSelectedForEnrichment(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      if (providerModes.coresignal === "live") return [id]
      return current.length < 25 ? [...current, id] : current
    })
  }

  async function postEngagement(action: string, eventId?: number, extra: Record<string, unknown> = {}) {
    const mutationKey = eventId ? `event:${eventId}` : `engagement:${action}`
    if (pendingEngagementKeysRef.current.has(mutationKey)) return null
    pendingEngagementKeysRef.current.add(mutationKey)
    setPendingEngagementKeys(current => new Set(current).add(mutationKey))
    beginEngagementWork()
    setEngagementMessage("")
    try {
      const response = await fetch(API_ROUTES.engagements, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, eventId, ...extra }),
      })
      const data = await response.json() as { events?: EngagementEvent[]; templates?: MessageTemplate[]; error?: string; sent?: { deliveryStatus: string } }
      if (!response.ok) throw new Error(data.error || "Unable to update the engagement event.")
      if (data.events) {
        setEngagements(data.events)
        setMessageTemplates(data.templates ?? messageTemplates)
        setSelectedEngagement(current => current ? data.events?.find(event => event.id === current.id) ?? current : null)
      } else await loadEngagements()
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update the engagement event."
      setEngagementMessage(message)
      return null
    } finally {
      pendingEngagementKeysRef.current.delete(mutationKey)
      setPendingEngagementKeys(current => { const next = new Set(current); next.delete(mutationKey); return next })
      finishEngagementWork()
    }
  }

  async function openEngagement(event: EngagementEvent) {
    setSelectedEngagement(event)
    setBirthdayCorrection(event.birthday?.birthMonthDay ?? "")
    await postEngagement("view", event.id)
  }
  openEngagementRef.current = openEngagement

  useEffect(() => {
    if (!engagementEventId || selectedEngagement?.id === engagementEventId) return
    const event = engagements.find(item => item.id === engagementEventId)
    if (!event) return
    const timer = window.setTimeout(() => void openEngagementRef.current(event), 0)
    return () => window.clearTimeout(timer)
  }, [engagementEventId, engagements, selectedEngagement?.id])

  function openEngagementFromOverview(event: EngagementEvent) {
    setEngagementFilter("Professional Signals")
    navigateWorkspace(engagementEventUrl(window.location.href, event.id))
  }

  function closeEngagement() {
    setSelectedEngagement(null)
    if (engagementEventId) navigateWorkspace(workspaceTabUrl(window.location.href, "engagement"), "replace")
  }

  async function previewEngagement(event: EngagementEvent) {
    const mutationKey = `event:${event.id}`
    if (pendingEngagementKeysRef.current.has(mutationKey)) return
    pendingEngagementKeysRef.current.add(mutationKey)
    setPendingEngagementKeys(current => new Set(current).add(mutationKey))
    const template = messageTemplates.find(item => item.eventType === event.eventType)
    beginEngagementWork()
    try {
      const response = await fetch(API_ROUTES.engagements, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", eventId: event.id, templateId: template?.id }),
      })
      const data = await response.json() as { template?: MessageTemplate; draft?: { recipient: string; subject: string; body: string }; readiness?: MailPreview["readiness"]; error?: string }
      if (!response.ok || !data.template || !data.draft || !data.readiness) throw new Error(data.error || "Unable to prepare the email draft.")
      setMailPreview({ event, templateId: data.template.id, ...data.draft, readiness: data.readiness })
      await loadEngagements()
    } catch (error) {
      setEngagementMessage(error instanceof Error ? error.message : "Unable to prepare the email draft.")
    } finally {
      pendingEngagementKeysRef.current.delete(mutationKey)
      setPendingEngagementKeys(current => { const next = new Set(current); next.delete(mutationKey); return next })
      finishEngagementWork()
    }
  }

  function startProfileEmailDraft(person: Alumni) {
    navigateWorkspace(controlledEmailUrl(window.location.href, person.id, "directory"))
  }

  function openAlumnusProfile(person: Alumni, tab = "directory") {
    const destinationTab = tab === "engagement" ? "directory" : tab
    navigateWorkspace(alumnusProfileUrl(window.location.href, person.id, destinationTab))
    setMailPreview(null)
    setMailSendConfirmOpen(false)
  }

  function closeAlumnusProfile() {
    navigateWorkspace(workspaceTabUrl(window.location.href, activeTab), "replace")
  }

  function changeWorkspaceTab(tab: string) {
    navigateWorkspace(workspaceTabUrl(window.location.href, tab))
    setMailPreview(null)
    setMailSendConfirmOpen(false)
  }

  function createOpportunity(company = "", alumnusId: number | null = null) {
    setOpportunityContext({ company, alumnusId, mode: "create", key: Date.now() })
    changeWorkspaceTab("opportunities")
  }

  function viewOpportunities(company = "", alumnusId: number | null = null) {
    setOpportunityContext({ company, alumnusId, mode: "filter", key: Date.now() })
    changeWorkspaceTab("opportunities")
  }

  function changeIntelligenceView(view: IntelligenceView) {
    navigateWorkspace(intelligenceViewUrl(window.location.href, view))
  }

  function openIntelligenceFor(ids: number[], view: IntelligenceView = "refresh") {
    setSelectedForIntelligence(ids)
    changeIntelligenceView(view)
  }

  function cancelControlledEmailDraft() {
    composeGenerationRef.current += 1
    setComposeState({ status: "cancelled", message: "" })
    setMailPreview(null)
    setMailSendConfirmOpen(false)
    if (!controlledEmailIntent) return
    navigateWorkspace(controlledEmailReturnUrl(window.location.href, controlledEmailIntent), "replace")
  }

  useEffect(() => {
    if (!controlledEmailIntent || mailPreview) return
    const generation = ++composeGenerationRef.current
    const controller = new AbortController()
    const initialize = async () => {
      setComposeState({ status: "loading", message: "" })
      setEngagementMessage("")
      const result = await initializeControlledEmail({
        signal: controller.signal,
        timeoutMs: 15_000,
        timeoutMessage: "Email draft preparation timed out. Please retry.",
        errorMessage: "Unable to prepare this email draft.",
        request: async signal => {
          const response = await fetch(API_ROUTES.engagements, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare_manual_email", alumnusId: controlledEmailIntent.alumnusId }), signal })
          const data = await response.json() as { event?: EngagementEvent; templates?: MessageTemplate[]; template?: MessageTemplate; draft?: { recipient: string; subject: string; body: string }; readiness?: MailPreview["readiness"]; error?: string }
          if (!response.ok || !data.event || !data.template || !data.draft || !data.readiness) throw new Error(data.error || "Unable to prepare the controlled email draft.")
          return data
        },
      })
      if (composeGenerationRef.current !== generation) return
      if (result.status === "cancelled") {
        setComposeState({ status: "cancelled", message: "" })
        return
      }
      if (result.status === "error") {
        console.error("Controlled email composer initialization failed", result.message)
        setComposeState({ status: "error", message: result.message })
        return
      }
      const prepared = result.value
      setEngagements(current => [prepared.event!, ...current.filter(item => item.id !== prepared.event!.id)])
      setMessageTemplates(prepared.templates ?? [prepared.template!])
      setMailPreview({ event: prepared.event!, templateId: prepared.template!.id, ...prepared.draft!, readiness: prepared.readiness! })
      setComposeState({ status: "ready", message: "" })
    }
    void initialize()
    return () => controller.abort()
  }, [composeRetry, controlledEmailIntent, mailPreview])

  async function sendMailPreview() {
    if (!mailPreview) return
    const result = await postEngagement("send", mailPreview.event.id, { templateId: mailPreview.templateId, subject: mailPreview.subject, body: mailPreview.body, approved: true })
    if (result) {
      if (controlledEmailIntent) {
        const url = new URL(window.location.href)
        for (const key of ["compose", "alumnusId", "returnAlumnusId", "returnTab", "profileAlumnusId"]) url.searchParams.delete(key)
        url.searchParams.set("tab", "engagement")
        navigateWorkspace(`${url.pathname}${url.search}${url.hash}`, "replace")
      }
      setMailPreview(null)
      setMailSendConfirmOpen(false)
      setSelectedEngagement(null)
      setEngagementMessage(mailMode === "mock" ? "Mock email sent. The shared engagement history has been updated." : "Email sent and recorded in the shared engagement history.")
      await loadWorkspace()
    }
  }

  function switchMailTemplate(templateId: number) {
    if (!mailPreview) return
    const template = messageTemplates.find(item => item.id === templateId)
    if (!template) return
    const firstName = mailPreview.event.alumnus?.name.split(/\s+/)[0] ?? "Alumnus"
    const personalize = (value: string) => value.replaceAll("[First Name]", firstName).replaceAll("[Full Name]", mailPreview.event.alumnus?.name ?? firstName)
    setMailPreview({ ...mailPreview, templateId, subject: personalize(template.subject), body: personalize(template.body) })
  }

  function toggleBirthdaySelection(eventId: number) {
    setSelectedBirthdayIds(current => current.includes(eventId) ? current.filter(id => id !== eventId) : [...current, eventId].slice(0, 25))
  }

  async function previewSelectedBirthdays() {
    beginEngagementWork()
    try {
      const response = await fetch(API_ROUTES.engagements, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk_preview", eventIds: selectedBirthdayIds }),
      })
      const data = await response.json() as BulkPreview & { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to review the selected birthday emails.")
      setBulkPreview({ ready: data.ready ?? [], excluded: data.excluded ?? [] })
    } catch (error) {
      setEngagementMessage(error instanceof Error ? error.message : "Unable to review the selected birthday emails.")
    } finally {
      finishEngagementWork()
    }
  }

  async function sendSelectedBirthdays() {
    if (!bulkPreview?.ready.length) return
    const result = await postEngagement("bulk_send", undefined, { eventIds: bulkPreview.ready.map(item => item.eventId), approved: true })
    if (result) {
      setBulkPreview(null)
      setSelectedBirthdayIds([])
      setEngagementMessage(mailMode === "mock" ? "Selected birthday emails were sent in mock mode and recorded." : "Selected birthday emails were sent and recorded.")
      await loadWorkspace()
    }
  }

  async function getBirthdayEmail(event: EngagementEvent) {
    if (!event.alumnus) return
    if (providerModes.lusha === "live") {
      const person = alumni.find(item => item.id === event.alumnus?.id)
      if (person) prepareLushaReveal(person, "email")
      return
    }
    await runEnrichment([event.alumnus.id], ["lusha"], "manual", ["email"])
    await Promise.all([loadWorkspace(), loadEngagements()])
    setEngagementMessage("Lusha email enrichment completed. Review the updated contact before sending.")
  }

  function updateDirectoryFilter<K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }))
  }

  function updateDiscoveryFilter<K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) {
    setDiscoveryFilters(current => ({ ...current, [key]: value }))
    setDiscoveryResults([])
    setSelectedDiscoveryIds([])
    setDiscoveryMessage("")
    setDiscoveryState("idle")
    setLastDiscoveryFilters(null)
    setDiscoveryReconciliation(null)
    setDiscoveryExecution(null)
  }

  function toggleDiscoveryProgramme(code: string) {
    const selected = discoveryFilters.discoveryProgrammes.includes(code)
      ? discoveryFilters.discoveryProgrammes.filter(value => value !== code)
      : [...discoveryFilters.discoveryProgrammes, code]
    updateDiscoveryFilter("discoveryProgrammes", selected)
  }

  function setDiscoverySeniorities(selected: string[]) {
    setDiscoveryFilters(current => ({
      ...current,
      seniorities: selected,
      seniority: selected.length === 1 ? selected[0] : "All levels",
    }))
    setDiscoveryResults([])
    setSelectedDiscoveryIds([])
    setDiscoveryMessage("")
    setDiscoveryState("idle")
    setLastDiscoveryFilters(null)
    setDiscoveryReconciliation(null)
    setDiscoveryExecution(null)
  }

  function toggleDiscoverySeniority(value: string) {
    const current = selectedDiscoverySeniorities(discoveryFilters)
    setDiscoverySeniorities(current.includes(value) ? current.filter(item => item !== value) : [...current, value])
  }

  function clearDirectoryFilters() {
    setFilters(defaultDirectoryFilters())
  }

  function changeDiscoveryCountPreset(value: string) {
    if (value === "custom") {
      if (discoveryCountPreset !== "custom") setDiscoveryLimit("")
      return
    }
    setDiscoveryLimit(value)
  }

  function discoveryCountControl(actionLabel: string, variant: "default" | "outline" = "default") {
    return <div className="discovery-count-control"><label className="discovery-count-field"><span>Results to retrieve</span><Select value={discoveryCountPreset} onValueChange={changeDiscoveryCountPreset}><SelectTrigger aria-label="Results to retrieve"><SelectValue /></SelectTrigger><SelectContent>{[1, 5, 10, 20].map(value => <SelectItem key={value} value={String(value)} disabled={value > discoveryMaximum}>{value}</SelectItem>)}<SelectItem value="custom">Custom</SelectItem></SelectContent></Select></label>{discoveryCountPreset === "custom" && <label><span>Custom result count</span><Input type="number" inputMode="numeric" min="1" max={discoveryMaximum} step="1" value={discoveryLimit} onChange={event => setDiscoveryLimit(event.target.value)} aria-label="Custom result count" /></label>}<small><strong>Maximum results requested from this discovery operation.</strong> {!discoveryFilters.discoveryProgrammes.length ? "Select at least one programme for external discovery." : discoveryCountValidation.ok ? `Current application limit allows up to ${discoveryMaximum}.` : discoveryCountValidation.message}</small><Button className="discovery-action-button" title={!discoveryFilters.discoveryProgrammes.length ? "Select at least one configured programme." : !discoveryCountValidation.ok ? `Enter a valid count within the ${discoveryMaximum} available Coresignal application units.` : undefined} variant={variant} onClick={() => discoverMoreAlumni()} disabled={discovering || !discoveryFilters.discoveryProgrammes.length || !discoveryCountValidation.ok}>{discovering ? <LoaderCircle className="spin" /> : <Search />} {actionLabel}</Button></div>
  }

  function discoverMoreAlumni(searchFilters: DiscoveryFilters = discoveryFilters) {
    const requested = Number(discoveryLimit)
    const validation = validateDiscoveryCount(requested, providerUsage.coresignal.remaining, providerModes.coresignal === "live" ? coresignalLiveMaximum : 100, discoverySearchOperationReserve)
    if (!validation.ok) {
      setDiscoveryState("blocked")
      setDiscoveryMessage(validation.message)
      return
    }
    if (providerModes.coresignal === "live") {
      setPendingDiscoveryFilters(searchFilters)
      return
    }
    void runDiscovery(searchFilters)
  }

  async function reviewPendingDiscoveryResults(searchId?: number) {
    setLoadingPendingReview(true)
    setDiscoveryMessage("")
    try {
      const query = new URLSearchParams({ view: "pending", ...(searchId ? { searchId: String(searchId) } : {}) })
      const response = await fetch(`${API_ROUTES.discovery}?${query}`, { cache: "no-store" })
      const data = await response.json() as {
        pendingCount?: number
        results?: DiscoveryResult[]
        counts?: DiscoveryCounts
        filters?: DiscoveryFilters
        activeSearch?: DiscoveryRunSummary | null
        previousSearches?: DiscoveryRunSummary[]
        providerHistory?: ProviderHistory[]
        reconciliationSummary?: ReconciliationSummary | null
        creditsUsed?: number
        retrieval?: string
        source?: { provider: string; mode: string; searchId: number }
        error?: string
      }
      if (!response.ok || !data.results || !data.counts) throw new Error(data.error || "Unable to reopen stored external results.")
      setPendingDiscoveryCount(data.pendingCount ?? data.results.length)
      setDiscoveryResults(data.results)
      setDiscoveryCounts(data.counts)
      setSelectedDiscoveryIds([])
      setLastDiscoveryFilters(data.filters ?? null)
      setActiveDiscoveryRun(data.activeSearch ?? null)
      setPreviousDiscoveryRuns(data.previousSearches ?? [])
      setActiveDiscoveryHistory(data.providerHistory ?? [])
      setDiscoveryReconciliation(data.reconciliationSummary ?? null)
      setDiscoveryExecution(null)
      setDiscoveryState(data.results.length ? "results" : "empty")
      const provenance = data.activeSearch ? `${data.activeSearch.provider.toUpperCase()} ${data.activeSearch.mode.toUpperCase()} Search #${data.activeSearch.searchId}` : "external"
      setDiscoveryMessage(data.results.length
        ? `Loaded ${data.results.length} stored ${provenance} profile${data.results.length === 1 ? "" : "s"}; ${data.activeSearch?.pendingCount ?? 0} actionable review candidate${data.activeSearch?.pendingCount === 1 ? "" : "s"}. No provider call was made and 0 credits were used.`
        : "There are no external alumni awaiting review.")
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to reopen stored external results.")
    } finally {
      setLoadingPendingReview(false)
    }
  }

  async function runDiscovery(searchFilters: DiscoveryFilters) {
    setDiscovering(true)
    setDiscoveryMessage("")
    setLastDiscoveryFilters(searchFilters)
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", filters: searchFilters, limit: Number(discoveryLimit) }),
      })
      const data = await response.json() as { results?: DiscoveryResult[]; counts?: DiscoveryCounts; reconciliationSummary?: ReconciliationSummary | null; executionSummary?: DiscoveryExecutionSummary | null; activeSearch?: DiscoveryRunSummary; previousSearches?: DiscoveryRunSummary[]; providerHistory?: ProviderHistory[]; creditsUsed?: number | null; applicationUnits?: number; effectiveLimit?: number; requestedCount?: number; returnedCount?: number; storedResultCount?: number; error?: string; blocked?: boolean }
      if (data.blocked) {
        setDiscoveryState("blocked")
        setDiscoveryMessage(data.error || "External search could not be run because the Coresignal application limit has been reached.")
        return
      }
      if (!response.ok || !data.results || !data.counts) throw new Error(data.error || "Unable to search external professional data.")
      if (data.effectiveLimit) setDiscoveryLimit(String(data.effectiveLimit))
      setPreviousDiscoveryRuns(data.previousSearches ?? (activeDiscoveryRun ? [activeDiscoveryRun] : []))
      setActiveDiscoveryRun(data.activeSearch ?? null)
      setActiveDiscoveryHistory(data.providerHistory ?? [])
      setDiscoveryResults(data.results)
      setDiscoveryCounts(data.counts)
      setDiscoveryReconciliation(data.reconciliationSummary ?? null)
      setDiscoveryExecution(data.executionSummary ?? null)
      setSelectedDiscoveryIds([])
      setDiscoveryState(data.results.length ? "results" : "empty")
      setDiscoveryMessage(data.results.length
        ? `${data.returnedCount ?? data.results.length} Preview candidates returned; ${data.storedResultCount ?? data.results.length} discovery results stored; ${data.activeSearch?.pendingCount ?? 0} actionable review candidates. Application usage: ${data.applicationUnits ?? data.results.length}; provider-account usage: ${data.creditsUsed == null ? "unknown" : data.creditsUsed}.`
        : "No additional external alumni were found for these criteria.")
      await Promise.all([loadEnrichment(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to search external professional data.")
    } finally {
      setDiscovering(false)
      setPendingDiscoveryFilters(null)
    }
  }

  async function runRegularSearch(searchFilters: DiscoveryFilters) {
    setDiscovering(true)
    setDiscoveryMessage("")
    setRegularSearchResultEvidence(null)
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regular_search", filters: { ...searchFilters, graduationYear: searchFilters.graduationYear || undefined }, limit: Number(discoveryLimit), confirmed: true }),
      })
      const data = await response.json() as {
        routing?: { providerSearch: { totalResults: number | null; pageIdsReceived: number; totalPages: number | null }; summary: { identityResolved: number; identityResolutionRequired: number; identityReviewRequired: number } }
        searchEvidence?: CoresignalSearchEvidence
        previewRequests?: number
        collectRequests?: number
        providerCreditsRemaining?: number | null
        error?: string
      }
      if (!response.ok || !data.routing) throw new Error(data.error || "Unable to run Coresignal Base Employee Search.")
      const summary = data.routing.summary
      setRegularSearchResultEvidence(data.searchEvidence ?? null)
      setDiscoveryMessage(`Coresignal Search returned ${data.routing.providerSearch.pageIdsReceived} Employee ID${data.routing.providerSearch.pageIdsReceived === 1 ? "" : "s"} on this page (${data.routing.providerSearch.totalResults === null ? "total not supplied" : `${data.routing.providerSearch.totalResults} total reported`}): ${summary.identityResolved} mapped, ${summary.identityResolutionRequired} require identity resolution, ${summary.identityReviewRequired} require identity review. Preview ${data.previewRequests ?? 0}; Collect ${data.collectRequests ?? 0}; provider remaining credits ${data.providerCreditsRemaining == null ? "not reported" : data.providerCreditsRemaining}. No alumnus or profile field was changed.`)
      await Promise.all([loadEnrichment(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to run Coresignal Base Employee Search.")
    } finally {
      setDiscovering(false)
      setPendingRegularSearchFilters(null)
      setRegularSearchPreparation(null)
    }
  }

  async function prepareRegularSearch(searchFilters: DiscoveryFilters) {
    setDiscovering(true)
    setDiscoveryMessage("")
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regular_search_preflight", filters: { ...searchFilters, graduationYear: searchFilters.graduationYear || undefined }, limit: Number(discoveryLimit) }),
      })
      const data = await response.json() as { preparation?: typeof regularSearchPreparation; error?: string }
      if (!response.ok || !data.preparation) throw new Error(data.error || "Unable to prepare Coresignal Search.")
      setRegularSearchPreparation(data.preparation)
      setPendingRegularSearchFilters(searchFilters)
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to prepare Coresignal Search.")
      setDiscoveryState("blocked")
    } finally {
      setDiscovering(false)
    }
  }

  function findMoreForCompany(companyName: string) {
    const next = { ...defaultDiscoveryFilters(), company: companyName }
    setDiscoveryFilters(next)
    changeWorkspaceTab("directory")
    discoverMoreAlumni(next)
  }

  function compareProfessionalProfile(person: Alumni) {
    setSelectedForEnrichment([person.id])
    closeAlumnusProfile()
    setRefreshConfirmOpen(true)
  }

  function toggleDiscoverySelection(id: number) {
    setSelectedDiscoveryIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function openComparison(result: DiscoveryResult) {
    const person = alumni.find(item => item.id === result.linkedInternalAlumnusId)
    const candidates = person ? [
      ["company", person.company, result.currentCompany],
      ["title", person.title, result.role],
      ["function", person.function, result.function],
      ["seniority", person.seniority, result.seniority],
      ["location", person.location, result.location],
      ["linkedinUrl", person.linkedinUrl ?? "", result.linkedinUrl],
      ["graduationYear", String(person.graduationYear || person.batch || ""), String(result.graduationYear || "")],
      [result.provider === "pdl" ? "pdlPersonId" : "coresignalEmployeeId", result.provider === "pdl" ? person.pdlPersonId ?? "" : person.coresignalEmployeeId ?? "", result.providerPersonId],
    ] : []
    setSelectedComparisonFields(candidates.filter(([, internal, external]) => Boolean(external) && internal !== external).map(([field]) => field))
    setComparisonResult(result)
  }

  async function approveDiscoveryResults(resultIds: number[]) {
    if (!resultIds.length) return
    setDiscovering(true)
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", resultIds }),
      })
      const data = await response.json() as { addedCount?: number; added?: Array<{ resultId: number; alumnusId: number }>; error?: string }
      if (!response.ok || !data.added) throw new Error(data.error || "Unable to add the selected alumni.")
      const added = data.added
      const addedMap = new Map(added.map(item => [item.resultId, item.alumnusId]))
      setDiscoveryResults(current => current.map(item => addedMap.has(item.id)
        ? { ...item, linkedInternalAlumnusId: addedMap.get(item.id) ?? null, reviewStatus: DISCOVERY_REVIEW_STATUS.added }
        : item))
      setActiveDiscoveryRun(current => current ? { ...current, pendingCount: Math.max(0, current.pendingCount - added.length) } : current)
      setSelectedDiscoveryIds([])
      setDiscoveryMessage(`${data.addedCount ?? added.length} alumn${added.length === 1 ? "us" : "i"} added. Contact enrichment is now available.`)
      await Promise.all([loadWorkspace(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to add the selected alumni.")
    } finally {
      setDiscovering(false)
    }
  }

  async function ignoreDiscoveryResult(resultId: number, reason = ignoreReason) {
    const response = await fetch(API_ROUTES.discovery, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ignore", resultId, reason }) })
    if (response.ok) {
      setDiscoveryResults(current => current.map(item => item.id === resultId ? { ...item, reviewStatus: "Ignored", reviewNote: reason } : item))
      setActiveDiscoveryRun(current => current ? { ...current, pendingCount: Math.max(0, current.pendingCount - 1) } : current)
      setIgnoreResult(null)
      setDiscoveryMessage(`External result ignored: ${reason}. The decision is saved for other committee members.`)
      await loadPendingDiscoverySummary()
    }
  }

  async function qualifyDiscoveryResult(result: DiscoveryResult, affiliationStatus: NonNullable<DiscoveryResult["affiliationStatus"]>) {
    setDiscovering(true)
    try {
      const response = await fetch(API_ROUTES.discovery, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "qualify", resultId: result.id, affiliationStatus }) })
      const data = await response.json() as { affiliationStatus?: DiscoveryResult["affiliationStatus"]; matchStatus?: DiscoveryResult["matchStatus"]; error?: string }
      if (!response.ok || !data.affiliationStatus || !data.matchStatus) throw new Error(data.error || "Unable to save the affiliation classification.")
      setDiscoveryResults(current => current.map(item => item.id === result.id ? { ...item, affiliationStatus: data.affiliationStatus, matchStatus: data.matchStatus!, reviewNote: "Affiliation classified by reviewer." } : item))
      setDiscoveryMessage(`${result.name} classified as ${data.affiliationStatus}.`)
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to save the affiliation classification.")
    } finally {
      setDiscovering(false)
    }
  }

  async function applyComparison() {
    if (!comparisonResult) return
    setDiscovering(true)
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "apply_updates", resultId: comparisonResult.id, fields: selectedComparisonFields }),
      })
      const data = await response.json() as { changedFields?: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to apply the selected updates.")
      setDiscoveryResults(current => current.map(item => item.id === comparisonResult.id ? { ...item, reviewStatus: data.changedFields?.length ? "Updates applied" : "Compared, no changes" } : item))
      setActiveDiscoveryRun(current => current ? { ...current, pendingCount: Math.max(0, current.pendingCount - 1) } : current)
      setDiscoveryMessage(data.changedFields?.length ? `${data.changedFields.length} professional fields updated and recorded in Change History.` : "No professional changes detected. The Coresignal interaction remains in Provider History.")
      setComparisonResult(null)
      setSelectedComparisonFields([])
      await Promise.all([loadWorkspace(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to apply the selected updates.")
    } finally {
      setDiscovering(false)
    }
  }

  async function keepDiscoveryResultSeparate() {
    if (!comparisonResult) return
    setDiscovering(true)
    try {
      const response = await fetch(API_ROUTES.discovery, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "keep_separate", resultId: comparisonResult.id }) })
      const data = await response.json() as { alumnusId?: number; error?: string }
      if (!response.ok || !data.alumnusId) throw new Error(data.error || "Unable to keep this alumnus as a separate record.")
      setDiscoveryResults(current => current.map(item => item.id === comparisonResult.id ? { ...item, linkedInternalAlumnusId: data.alumnusId!, reviewStatus: DISCOVERY_REVIEW_STATUS.addedSeparate } : item))
      setActiveDiscoveryRun(current => current ? { ...current, pendingCount: Math.max(0, current.pendingCount - 1) } : current)
      setComparisonResult(null)
      setSelectedComparisonFields([])
      setDiscoveryMessage("The reviewed profile was added as a separate alumnus. Lusha enrichment is now available from the internal profile.")
      await Promise.all([loadWorkspace(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to keep this alumnus as a separate record.")
    } finally {
      setDiscovering(false)
    }
  }

  async function recommendRoute(targetId = targetAlumnusId) {
    if (!targetId) { setRouteMessage("Select the alumnus you want to reach first."); return }
    setRouteLoading(true)
    setRouteMessage("")
    try {
      const response = await fetch(API_ROUTES.outreachRoute, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetAlumnusId: targetId }) })
      const data = await response.json() as RouteRecommendation & { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to recommend an outreach route.")
      setRouteRecommendation(data)
    } catch (error) {
      setRouteMessage(error instanceof Error ? error.message : "Unable to recommend an outreach route.")
    } finally {
      setRouteLoading(false)
    }
  }

  function updateManualField<K extends keyof ManualForm>(field: K, value: ManualForm[K]) {
    setManualForm(current => ({ ...current, [field]: value }))
    setManualMatches([])
    setManualSaved(null)
    setManualMessage("")
  }

  async function saveManualAlumnus(continueAsNew: boolean) {
    const validation = validateManualAlumnusInput(manualForm)
    if (!validation.valid) { setManualMessage(Object.values(validation.errors)[0] ?? MANUAL_ALUMNUS_REQUIRED_COPY); return }
    setManualLoading(true)
    try {
      const response = await fetch(API_ROUTES.workspace, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "manual_add", record: manualForm, continueAsNew }) })
      const data = await response.json() as { alumnus?: Alumni; matches?: ManualMatch[]; error?: string }
      if (!response.ok || !data.alumnus) {
        if (data.matches?.length) setManualMatches(data.matches)
        throw new Error(data.error || "Unable to add the alumnus.")
      }
      setManualSaved(data.alumnus)
      setManualMatches([])
      setManualMessage(`Alumnus added to ${appConfig.name}. No provider credits were used.`)
      await loadWorkspace()
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : "Unable to add the alumnus.")
    } finally {
      setManualLoading(false)
    }
  }

  async function checkManualAlumnus() {
    const validation = validateManualAlumnusInput(manualForm)
    if (!validation.valid) { setManualMessage(Object.values(validation.errors)[0] ?? MANUAL_ALUMNUS_REQUIRED_COPY); return }
    setManualLoading(true)
    setManualMessage("")
    try {
      const response = await fetch(API_ROUTES.workspace, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "manual_check", record: manualForm }) })
      const data = await response.json() as { matches?: ManualMatch[]; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to check for duplicates.")
      if (data.matches?.length) {
        setManualMatches(data.matches)
        setManualMessage("Possible existing alumni found. Review them before continuing.")
      } else await saveManualAlumnus(false)
    } catch (error) {
      setManualMessage(error instanceof Error ? error.message : "Unable to check for duplicates.")
    } finally {
      setManualLoading(false)
    }
  }

  async function runProfileRefresh() {
    if (!selectedForEnrichment.length) return
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh_profiles", alumniIds: selectedForEnrichment }) })
      const data = await response.json() as { results?: RefreshResult[]; error?: string }
      if (!response.ok || !data.results) throw new Error(data.error || "Unable to refresh the selected profiles.")
      setRefreshResults(data.results)
      setRefreshSelections(Object.fromEntries(data.results.map(result => [result.reviewId ?? -result.alumnusId, result.fields.filter(field => field.oldValue !== field.newValue).map(field => field.field)])))
      setRefreshConfirmOpen(false)
      setEnrichmentMessage(`Coresignal profile refresh completed for ${data.results.length} alumn${data.results.length === 1 ? "us" : "i"}. Review proposed changes before applying them.`)
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to refresh the selected profiles.")
    } finally {
      setEnriching(false)
    }
  }

  async function applyRefreshResult(result: RefreshResult, fields = refreshSelections[result.reviewId ?? -1] ?? []) {
    if (!result.reviewId) return
    setEnriching(true)
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply_refresh", reviewId: result.reviewId, fields }) })
      const data = await response.json() as { applied?: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to apply the selected profile updates.")
      setRefreshResults(current => current.map(item => item.reviewId === result.reviewId ? { ...item, reviewStatus: data.applied?.length ? "Applied" : "Reviewed — kept existing" } : item))
      setEnrichmentMessage(data.applied?.length ? `${data.applied.length} professional fields updated with full change history.` : "Profile refresh reviewed. Internal values were kept.")
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to apply the selected profile updates.")
    } finally {
      setEnriching(false)
    }
  }

  const functionCounts = targetAlumni.reduce<Record<string, number>>((acc, person) => {
    acc[person.function] = (acc[person.function] ?? 0) + 1
    return acc
  }, {})
  const selectedBreakdown = selected ? relevanceBreakdown(selected, companyPriorities, engagements) : null
  const selectedProfessionalProfileUrl = selected ? normalizeProfessionalProfileUrl(selected.linkedinUrl) : ""
  const selectedExperienceSummary = selected ? professionalExperienceSummary(selected.experience, selected.previous) : ""
  const selectedEngagementHistory = selected ? engagements.filter(event => event.alumnusId === selected.id) : []
  const selectedUpcomingEngagements = selectedEngagementHistory.filter(event => !isCompletedEngagement(event.status))
  const selectedCompletedEngagements = selectedEngagementHistory.filter(event => isCompletedEngagement(event.status))
  const manualValidation = validateManualAlumnusInput(manualForm)
  const companyEngagements = engagements.filter(event => event.alumnus && event.alumnus.company === activeTargetCompany)
  const visibleOutreach = alumni.filter(person => {
    const relevance = relevanceBreakdown(person, companyPriorities, engagements).score
    if (outreachSearch && !`${person.name} ${person.title}`.toLowerCase().includes(outreachSearch.toLowerCase())) return false
    if (outreachCompany !== "All companies" && person.company !== outreachCompany) return false
    if (outreachStatus !== "All alumni" && person.status !== outreachStatus) return false
    if (outreachRelevance === "75–100" && relevance < 75) return false
    if (outreachRelevance === "50–74" && (relevance < 50 || relevance >= 75)) return false
    if (outreachRelevance === "Below 50" && relevance >= 50) return false
    return true
  }).sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score)
  const importReviewRows = importReview?.rows.filter(row => row.kind !== "new" || row.issues.length) ?? []

  const directoryPagination = usePagination(filtered, JSON.stringify(filters))
  const companyContactsPagination = usePagination(targetAlumni, activeTargetCompany)
  const companyHistoryPagination = usePagination(companyEngagements, activeTargetCompany)
  const visibleEngagementGroups = groupEngagementsByAlumnus(visibleEngagements)
  const engagementPagination = usePagination(visibleEngagementGroups, JSON.stringify([engagementFilter, engagementPeriod, engagementCompany, engagementAssignee, engagementActionState]))
  const outreachPagination = usePagination(visibleOutreach, JSON.stringify([outreachSearch, outreachCompany, outreachStatus, outreachRelevance]))
  const importPagination = usePagination(importReviewRows, importReviewRows.map(row => row.key).join("|"))
  const enrichmentPagination = usePagination(alumni)
  const providerHistoryPagination = usePagination(providerHistory)
  const profileOpenEngagementPagination = usePagination(selectedUpcomingEngagements, String(selected?.id ?? ""))
  const profileEngagementHistoryPagination = usePagination(selectedCompletedEngagements, String(selected?.id ?? ""))
  const eventActivityPagination = usePagination(selectedEngagement?.activity ?? [], String(selectedEngagement?.id ?? ""))

  function clearOutreachFilters() {
    setOutreachSearch("")
    setOutreachCompany("All companies")
    setOutreachStatus("All alumni")
    setOutreachRelevance("All")
  }
  const selectedEngagementBusy = selectedEngagement ? pendingEngagementKeys.has(`event:${selectedEngagement.id}`) : false
  const comparisonAlumnus = comparisonResult ? alumni.find(person => person.id === comparisonResult.linkedInternalAlumnusId) ?? null : null
  const comparisonRows = comparisonResult && comparisonAlumnus ? [
    { field: "company", label: "Current company", internal: comparisonAlumnus.company, external: comparisonResult.currentCompany },
    { field: "title", label: "Role", internal: comparisonAlumnus.title, external: comparisonResult.role },
    { field: "function", label: "Function", internal: comparisonAlumnus.function, external: comparisonResult.function },
    { field: "seniority", label: "Seniority", internal: comparisonAlumnus.seniority, external: comparisonResult.seniority },
    { field: "location", label: "Location", internal: comparisonAlumnus.location, external: comparisonResult.location },
    { field: "graduationYear", label: "Graduation year", internal: String(comparisonAlumnus.graduationYear || comparisonAlumnus.batch || "Not recorded"), external: String(comparisonResult.graduationYear || "Not returned") },
    { field: "linkedinUrl", label: "Professional profile URL", internal: normalizeProfessionalProfileUrl(comparisonAlumnus.linkedinUrl) || "Not recorded", external: normalizeProfessionalProfileUrl(comparisonResult.linkedinUrl) || "Not returned" },
    comparisonResult.provider === "pdl"
      ? { field: "pdlPersonId", label: "PDL person ID", internal: comparisonAlumnus.pdlPersonId || "Not recorded", external: comparisonResult.providerPersonId || "Not returned" }
      : { field: "coresignalEmployeeId", label: "Coresignal employee ID", internal: comparisonAlumnus.coresignalEmployeeId || "Not recorded", external: comparisonResult.providerPersonId || "Not returned" },
  ] : []

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">{appConfig.shortName}</div><div><strong>{appConfig.name}</strong><span>{appConfig.subtitle}</span></div></div>
        <div className="topbar-actions"><div className={`data-state ${workspaceMessage ? "data-state-warning" : ""}`}><span /> {workspaceLoading ? "Connecting to shared database" : syncing ? "Saving changes" : workspaceMessage || "Shared database · Synced"}</div><div className="signed-in-user"><strong>{session.displayName}</strong><span>{session.role}</span></div><a className="sign-out-link" href={session.signOutPath} target="_top">Sign out</a></div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">{session.canAdminister ? "Administration and governance" : "Placement intelligence"}</p><h1>{session.canAdminister ? "Operate Corporate Network safely" : appConfig.tagline}</h1></div>
        </div>

        <Tabs value={activeTab} onValueChange={changeWorkspaceTab} className="product-tabs">
          <TabsList variant="line" className="main-tabs" aria-label="Platform sections">
            {session.canAdminister && <TabsTrigger value="admin">Administration</TabsTrigger>}
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="directory">Alumni directory</TabsTrigger>
            <TabsTrigger value="companies">Company intelligence</TabsTrigger>
            {session.canOperate && <TabsTrigger value="engagement">Engagement</TabsTrigger>}
            {session.canOperate && <TabsTrigger value="outreach">Outreach</TabsTrigger>}
            {session.canOperate && <TabsTrigger value="opportunities">Opportunities</TabsTrigger>}
            {session.canOperate && <TabsTrigger value="data-import">Data import</TabsTrigger>}
            <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="tab-panel">
            <section className="stats-grid" aria-label="Key metrics">
              <StatCard icon={UsersRound} label="Alumni mapped" value={`${alumni.length}`} delta="Shared master database" />
              <StatCard icon={Building2} label="Companies covered" value={`${companies.length}`} delta="Calculated from current records" />
              <StatCard icon={UserRoundCheck} label="Contact-ready alumni" value={`${contactReadyCount} / ${alumni.length}`} delta="Based on field verification" help="Requires a confirmed profile match, verified current company, verified or likely designation, and at least one verified email or phone." />
              <StatCard icon={Target} label="Active outreach" value={`${activeOutreach}`} delta="Visible to all committee members" help="Includes shared outreach states Contacted, Responded, and Meeting set." />
              {session.canOperate && <StatCard icon={BriefcaseBusiness} label="Active opportunities" value={`${opportunitySummary.active}`} delta={`${opportunitySummary.followUpsDue} follow-up${opportunitySummary.followUpsDue === 1 ? "" : "s"} due`} help="Persistent Corporate Opportunities that are not Confirmed or Closed Lost." />}
            </section>

            {session.role === "PCOM" && <section className="panel pcom-work-panel" aria-label="My work">
              <div className="panel-heading"><div><p className="eyebrow">My work</p><h2>Assigned actions and follow-ups</h2><span>Use the shared ownership state to avoid parallel outreach.</span></div><Button variant="ghost" size="sm" onClick={() => { setEngagementFilter("Assigned to Me"); changeWorkspaceTab("engagement") }}>Open my queue <ChevronRight /></Button></div>
              <div className="engagement-stats"><button onClick={() => { setEngagementFilter("Assigned to Me"); changeWorkspaceTab("engagement") }}><UserRoundCheck /><span>Assigned to me<strong>{assignedToMe.length}</strong></span></button><button onClick={() => { setEngagementFilter("Follow-ups"); changeWorkspaceTab("engagement") }}><CalendarClock /><span>Follow-ups due<strong>{followUpsDue.length}</strong></span></button><button onClick={() => { setEngagementFilter("Needs Action"); changeWorkspaceTab("engagement") }}><BellRing /><span>Needs action<strong>{visibleEngagements.filter(event => !isCompletedEngagement(event.status)).length}</strong></span></button><button onClick={() => changeWorkspaceTab("opportunities")}><BriefcaseBusiness /><span>My opportunities<strong>{opportunitySummary.assignedToMe}</strong></span></button></div>
            </section>}

            <section className="overview-grid">
              <article className="panel lead-panel">
                <div className="panel-heading"><div><p className="eyebrow">Recommended next</p><h2>Top alumni for outreach</h2><span>Ranked by Placement Relevance</span></div><Button variant="ghost" size="sm" onClick={() => changeWorkspaceTab("directory")}>View all <ArrowUpRight /></Button></div>
                <div className="lead-list">{topLeads.map((person, index) => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; return <button key={person.id} className="lead-row" onClick={() => openAlumnusProfile(person)}><span className="rank">0{index + 1}</span><span className="avatar">{person.initials}</span><span className="lead-copy"><strong>{person.name}</strong><small>{person.title} · {person.company}</small></span><span className={`score-pill ${scoreTone(relevance)}`} title="Placement Relevance">{relevance}/100</span><ChevronRight aria-hidden="true" /></button> })}</div>
              </article>

              {session.canOperate && <aside className={`panel signal-panel ${actionableProfessionalEvents.length ? "signal-panel-active" : "signal-panel-empty"}`}>
                {actionableProfessionalEvents.length ? <><div className="signal-orbit"><Sparkles /><span>{actionableProfessionalEvents.length}</span></div><p className="eyebrow">Professional signals</p><h2>Signals requiring review</h2>
                  {actionableProfessionalEvents.slice(0, 3).map(event => <button key={event.id} className="signal-item signal-button" onClick={() => openEngagementFromOverview(event)}><div>{event.eventSubtype === "Promotion" ? <ArrowUpRight /> : <BriefcaseBusiness />}</div><p><strong>{event.alumnus?.name}</strong> · {event.eventSubtype || event.eventTitle} <ChevronRight /><small><EngagementStatusBadge status={event.status} /></small></p></button>)}
                  <Button variant="ghost" size="sm" className="signal-review" onClick={() => { setEngagementFilter("Professional Signals"); changeWorkspaceTab("engagement") }}>View all signals <ChevronRight /></Button></> : <><p className="eyebrow">Professional signals</p><h2>No signals requiring review</h2><p className="signal-empty-copy">Promotions and company changes requiring attention will appear here.</p><Button variant="ghost" size="sm" className="signal-history-link" onClick={() => { setEngagementFilter("Professional Signals"); changeWorkspaceTab("engagement") }}>View signal history</Button></>}
              </aside>}
            </section>

            {session.canOperate && <button className={`panel birthday-overview ${birthdaysNextWeek.length || reviewableBirthdaysNextWeek.length ? "birthday-overview-active" : "birthday-overview-empty"}`} onClick={() => { setEngagementFilter("Birthdays"); setEngagementPeriod("Next 7 Days"); changeWorkspaceTab("engagement") }}>
              <span className="birthday-overview-icon"><Cake /></span><span><p className="eyebrow">Birthday engagement</p><strong>{birthdaysToday.length} today · {birthdaysNextWeek.length} in the next 7 days</strong><small>{reviewableBirthdaysNextWeek.length} ready for review</small></span><ChevronRight />
            </button>}

            {session.canOperate && <section className="panel route-panel route-planner">
              <div className="panel-heading"><div><p className="eyebrow">Recommended outreach route</p><h2>Choose who you want to reach</h2><span>Ranking answers who to approach. Route recommendation explains how to approach the selected alumnus.</span></div></div>
              <div className="route-controls route-controls-overview"><CompanyCombobox options={companies} value={overviewCompany} onValueChange={company => { setOverviewCompany(company); setTargetAlumnusId(null); setRouteRecommendation(null); setRouteMessage("") }} /><AlumnusCombobox options={routeEligibleAlumni} preferredCompany={overviewCompany} value={targetAlumnusId} onValueChange={selectTargetAlumnus} /><Button title={!targetAlumnusId ? "Select a target alumnus from the suggestions first." : routeLoading ? "The route recommendation is still being prepared." : undefined} disabled={!targetAlumnusId || routeLoading} onClick={() => void recommendRoute()}>{routeLoading ? <LoaderCircle className="spin" /> : <Network />} Recommend Outreach Route</Button></div>
              {routeMessage && <p className="route-message">{routeMessage}</p>}
            </section>}
          </TabsContent>

          <TabsContent value="directory" className="tab-panel">
            <section className="panel directory-panel">
              <div className="panel-heading directory-heading"><div><p className="eyebrow">Internal alumni directory</p><h2>Alumni directory</h2><span>{filtered.length} alumni found in {appConfig.name}, ranked by Placement Relevance</span></div>{session.canOperate && <div className="directory-intelligence-actions"><Button variant="outline" disabled={!selectedForIntelligence.length} onClick={() => openIntelligenceFor(selectedForIntelligence)}>Refresh selected</Button><Button variant="outline" disabled={!selectedForIntelligence.length} onClick={() => openIntelligenceFor(selectedForIntelligence)}>Schedule selected</Button><Button variant="ghost" onClick={() => openIntelligenceFor(directoryPagination.items.map(person => person.id))}>Use current page</Button><Button variant="ghost" onClick={() => openIntelligenceFor(filtered.map(person => person.id))}>Use all matching</Button></div>}</div>
              {session.canOperate && pendingDiscoveryCount > 0 && <div className="pending-review-banner" role="status"><span className="pending-review-icon"><Eye /></span><span><strong>{pendingDiscoveryCount} external alumn{pendingDiscoveryCount === 1 ? "us" : "i"} awaiting review</strong><small>Reopen the stored results without running another provider search.</small></span><Button variant="outline" onClick={() => void reviewPendingDiscoveryResults()} disabled={loadingPendingReview}>{loadingPendingReview ? <LoaderCircle className="spin" /> : <Eye />} Review Results</Button></div>}
              <div className="filters core-filters">
                <div className="search-field"><Search /><Input value={filters.name} onChange={event => updateDirectoryFilter("name", event.target.value)} placeholder="Alumnus name" aria-label="Search by alumnus name" /></div>
                <Input list="company-options" value={filters.company === "All companies" ? "" : filters.company} onChange={event => updateDirectoryFilter("company", event.target.value || "All companies")} placeholder="Company name" aria-label="Filter by current company" />
                <datalist id="company-options">{companies.map(item => <option key={item} value={item} />)}</datalist>
                <Input value={filters.role} onChange={event => updateDirectoryFilter("role", event.target.value)} placeholder="Role or designation" aria-label="Filter by role or designation" />
                <Select value={filters.function} onValueChange={value => updateDirectoryFilter("function", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.seniority} onValueChange={value => updateDirectoryFilter("seniority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All levels">All seniority</SelectItem>{seniorityFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Input value={filters.location} onChange={event => updateDirectoryFilter("location", event.target.value)} placeholder="Location" aria-label="Filter by location" />
                <Input value={filters.linkedinUrl} onChange={event => updateDirectoryFilter("linkedinUrl", event.target.value)} placeholder="LinkedIn URL or profile ID" aria-label="Filter by LinkedIn profile URL" />
                <Button variant="outline" onClick={() => setShowAdvancedFilters(value => !value)}><Filter /> {showAdvancedFilters ? "Hide advanced filters" : "More filters"}</Button>
                <Button variant="ghost" onClick={clearDirectoryFilters}>Clear</Button>
              </div>
              {showAdvancedFilters && <div className="advanced-filters">
                <label className="directory-filter-field"><span>Directory programme</span><Select value={filters.programme} onValueChange={value => updateDirectoryFilter("programme", value)}><SelectTrigger aria-label="Directory programme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All programmes">All programmes</SelectItem>{programmeChoices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><small>Applies only to existing Corporate Network records. It does not affect external provider discovery.</small></label>
                <Input type="number" min="1980" max="2100" value={filters.batch} onChange={event => updateDirectoryFilter("batch", event.target.value)} placeholder="Batch / graduation year" />
                <Input value={filters.previousCompany} onChange={event => updateDirectoryFilter("previousCompany", event.target.value)} placeholder="Previous company" />
                <Select value={String(filters.minRelevance)} onValueChange={value => updateDirectoryFilter("minRelevance", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any Placement Relevance</SelectItem><SelectItem value="60">Placement Relevance 60+</SelectItem><SelectItem value="75">Placement Relevance 75+</SelectItem><SelectItem value="85">Placement Relevance 85+</SelectItem></SelectContent></Select>
                <Select value={String(filters.minConfidence)} onValueChange={value => updateDirectoryFilter("minConfidence", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any Data Confidence</SelectItem><SelectItem value="60">Data Confidence 60+</SelectItem><SelectItem value="75">Data Confidence 75+</SelectItem><SelectItem value="90">Data Confidence 90+</SelectItem></SelectContent></Select>
                <Select value={filters.contactStatus} onValueChange={value => updateDirectoryFilter("contactStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["All contact states", "Contact-ready", "Partially verified", "Needs verification", "Mismatch"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.outreachStatus} onValueChange={value => updateDirectoryFilter("outreachStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All outreach states">All outreach states</SelectItem>{statusOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.relationship} onValueChange={value => updateDirectoryFilter("relationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All relationships">All IIML relationships</SelectItem>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select>
              </div>}
              <Table>
                <TableHeader><TableRow><TableHead>{session.canOperate && <input type="checkbox" aria-label="Select current Directory page for intelligence" checked={Boolean(directoryPagination.items.length) && directoryPagination.items.every(person => selectedForIntelligence.includes(person.id))} onChange={event => { const ids = directoryPagination.items.map(person => person.id); setSelectedForIntelligence(current => event.target.checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id))) }} />}</TableHead><TableHead>Alumnus</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Location</TableHead><TableHead>Data confidence</TableHead><TableHead>Placement relevance</TableHead><TableHead>Outreach</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{directoryPagination.items.map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; return <TableRow key={person.id}><TableCell>{session.canOperate && <input type="checkbox" aria-label={`Select ${person.name} for intelligence`} checked={selectedForIntelligence.includes(person.id)} onChange={() => setSelectedForIntelligence(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id])} />}</TableCell><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person, "directory")}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{alumniEducationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.function}</TableCell><TableCell>{person.location}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.confidence)}`}>{person.confidence}%</span></TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><StatusBadge status={person.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void recommendRoute(person.id)}><Network /> Recommend Route</Button></TableCell></TableRow> })}</TableBody>
              </Table>
              <PaginationFooter model={directoryPagination} label="Alumni Directory pagination" />
              {filtered.length === 0 && <div className="empty-state"><Search /><h3>No mapped alumni match these filters</h3><p>{session.canOperate ? "Adjust or clear the internal filters, or use the separate external discovery area below." : "No authorized records match the selected filters."}</p></div>}
            </section>

            {session.canOperate && <section className="panel directory-external-discovery">
              <div className="external-discovery-heading"><p className="eyebrow">External discovery</p><h2>Need more alumni?</h2><span>Build a targeted Coresignal search here. Internal directory filters never call or constrain a provider.</span></div>
              <div className="external-discovery-criteria">
                <label><span>Alumni status</span><Select value={discoveryFilters.alumniStatus} onValueChange={value => updateDiscoveryFilter("alumniStatus", value as DiscoveryFilters["alumniStatus"])}><SelectTrigger aria-label="External discovery alumni status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Past alumni only">Past alumni only</SelectItem><SelectItem value="All graduation statuses">All graduation statuses (review only)</SelectItem></SelectContent></Select></label>
                <label><span>IIML programmes to discover</span><Popover><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" className="programme-multiselect-trigger" aria-label="IIML programmes to discover"><span>{programmeSelectionSummary(discoveryFilters.discoveryProgrammes)}</span><ChevronDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="programme-multiselect-content" align="start"><div role="group" aria-label="Active IIML programmes">{activeProgrammeChoices.map(option => <label key={option.value}><input type="checkbox" checked={discoveryFilters.discoveryProgrammes.includes(option.value)} onChange={() => toggleDiscoveryProgramme(option.value)} /><span>{option.label}</span></label>)}{!activeProgrammeChoices.length && <small>No active programmes are configured.</small>}</div></PopoverContent></Popover><small>Used only for external Coresignal discovery. Directory filters above do not affect provider searches.</small><small>Only active Programme Reference Data options are available. Unknown and executive programmes remain review-only.</small></label>
                <label><span>Company</span><Input value={discoveryFilters.company} onChange={event => updateDiscoveryFilter("company", event.target.value)} placeholder="Any company" aria-label="Discovery company" /></label>
                <label><span>Role / designation</span><Input value={discoveryFilters.role} onChange={event => updateDiscoveryFilter("role", event.target.value)} placeholder="Any role" aria-label="Discovery role or designation" /></label>
                <label><span>Function</span><Select value={discoveryFilters.function} onValueChange={value => updateDiscoveryFilter("function", value)}><SelectTrigger aria-label="Discovery function"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label>
                <label><span>Seniority</span><Popover><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" className="programme-multiselect-trigger" aria-label="Discovery seniority"><span>{discoverySenioritySummary(discoveryFilters)}</span><ChevronDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="programme-multiselect-content" align="start"><div role="group" aria-label="Discovery seniority levels"><label><input type="checkbox" checked={!selectedDiscoverySeniorities(discoveryFilters).length} onChange={() => setDiscoverySeniorities([])} /><span>All levels</span></label>{seniorityFilterOptions.map(item => <label key={item}><input type="checkbox" checked={selectedDiscoverySeniorities(discoveryFilters).includes(item)} onChange={() => toggleDiscoverySeniority(item)} /><span>{item}</span></label>)}</div></PopoverContent></Popover><small>Matches any selected level locally from the returned Preview title.</small></label>
                <label><span>Location</span><Input value={discoveryFilters.location} onChange={event => updateDiscoveryFilter("location", event.target.value)} placeholder="Any location" aria-label="Discovery location" /></label>
                <label><span>Graduation year</span><Input type="number" min="1980" max="2100" value={discoveryFilters.graduationYear} onChange={event => updateDiscoveryFilter("graduationYear", event.target.value)} placeholder="Any year" aria-label="Discovery graduation year" /></label>
              </div>
              <div className="discovery-coverage-plan" role="status" aria-live="polite">
                <div><span>Discovery coverage</span><strong>{discoveryCoverageLoading ? "Checking stored search history…" : discoveryCoverage?.overallState.replaceAll("_", " ") ?? "Unavailable"}</strong><small>{discoveryCoverage?.lastEquivalentSearch?.lastSearchedAt ? `Last equivalent search ${discoveryCoverage.lastEquivalentSearch.daysSinceLastSearch} day${discoveryCoverage.lastEquivalentSearch.daysSinceLastSearch === 1 ? "" : "s"} ago · Search #${discoveryCoverage.lastEquivalentSearch.lastSearchId}` : "No equivalent stored search found for the current filters."}</small></div>
                <div><span>Segments requested</span><strong>{discoveryCoverage?.counts.requested ?? "—"}</strong></div>
                <div><span>Recently searched</span><strong>{discoveryCoverage?.counts.recentlySearched ?? "—"}</strong></div>
                <div><span>Stale</span><strong>{discoveryCoverage?.counts.stale ?? "—"}</strong></div>
                <div><span>Never searched</span><strong>{discoveryCoverage?.counts.neverSearched ?? "—"}</strong></div>
                <div><span>Provider-query segments</span><strong>{discoveryCoverage?.searchSegmentsRequiringProviderQuery ?? "—"}</strong><small>Plan only · no provider call</small></div>
              </div>
              {discoveryCoverageError && <small className="discovery-coverage-error">{discoveryCoverageError}</small>}
              {discoveryCountControl("Discover More Alumni")}
              <div className="discovery-count-control"><div><strong>Coresignal Employee ID Search</strong><small>Separate ID-only ES-DSL Search. Graduation year is optional. A selected company is sent only after the server resolves an Admin-verified provider-company mapping; missing, unverified, conflicting, or invalid mappings block before any provider request. Programme, role, function, seniority, and location remain local. It never automatically calls Preview or Collect.</small><small>Status: provider-free preparation available · {regularSearchStatus.enabled ? "LIVE execution gate enabled" : "LIVE execution gate disabled"} · maximum Search requests: {regularSearchStatus.maxRequests} · automatic pagination: {regularSearchStatus.automaticPagination ? "on" : "off"}.</small></div><Button variant="outline" title={discoveryFilters.graduationYear && !/^\d{4}$/.test(discoveryFilters.graduationYear) ? "Enter an exact four-digit graduation year or leave it blank for all years." : "Prepare and inspect the Search contract without calling Coresignal."} disabled={discovering || Boolean(discoveryFilters.graduationYear && !/^\d{4}$/.test(discoveryFilters.graduationYear)) || !discoveryCountValidation.ok} onClick={() => void prepareRegularSearch(discoveryFilters)}><Search /> {discovering ? "Preparing…" : "Prepare ID-only Search"}</Button></div>
            </section>}

            {(discoveryState !== "idle" || discoveryResults.length > 0 || discoveryMessage) && <section className="panel discovery-panel">
              <div className="discovery-header">
                <div><p className="eyebrow">External discovery</p><h2>{discoveryState === "blocked" ? "External search not run" : discoveryState === "empty" ? "No additional profiles found" : `${discoveryResults.length} external profiles found`}</h2><span>{discoveryState === "blocked" ? "The previous search state is retained below." : activeDiscoveryRun ? `Search #${activeDiscoveryRun.searchId} · ${activeDiscoveryRun.provider.toUpperCase()} · ${activeDiscoveryRun.mode.toUpperCase()}` : `Education affiliation and current-role evidence are reviewed before any record enters ${appConfig.name}.`}</span></div>
                <div className="fixed-criterion"><span>{activeDiscoveryRun ? "Active discovery run" : "Fixed alumni criterion"}</span><strong>{activeDiscoveryRun ? `Search #${activeDiscoveryRun.searchId}` : FIXED_ALUMNI_SCHOOL}</strong>{activeDiscoveryRun && <small>{activeDiscoveryRun.provider.toUpperCase()} · {activeDiscoveryRun.mode.toUpperCase()}</small>}</div>
              </div>
              {lastDiscoveryFilters && <div className="external-search-summary"><div><span>Education</span><strong>{FIXED_ALUMNI_SCHOOL}</strong><small>Fixed</small></div><div><span>Alumni status</span><strong>{lastDiscoveryFilters.alumniStatus}</strong></div><div><span>Programmes</span><strong>{lastDiscoveryFilters.discoveryProgrammes.join(", ") || "None selected"}</strong></div><div><span>Company</span><strong>{lastDiscoveryFilters.company || "Any company"}</strong></div><div><span>Role</span><strong>{lastDiscoveryFilters.role || "Any role"}</strong></div><div><span>Function</span><strong>{lastDiscoveryFilters.function}</strong></div><div><span>Seniority</span><strong>{discoverySenioritySummary(lastDiscoveryFilters)}</strong></div><div><span>Location</span><strong>{lastDiscoveryFilters.location || "Any location"}</strong></div><div><span>Graduation year</span><strong>{lastDiscoveryFilters.graduationYear || "Any year"}</strong></div><div><span>Requested</span><strong>{activeDiscoveryRun?.requestedCount ?? "Unavailable for this historical run"}</strong></div><div><span>Provider returned</span><strong>{activeDiscoveryRun?.providerResultCount ?? "Not recorded"}</strong></div><div><span>Discovery results stored</span><strong>{activeDiscoveryRun?.storedResultCount ?? discoveryResults.length}</strong><small>{activeDiscoveryRun ? `${activeDiscoveryRun.pendingCount} actionable review candidate${activeDiscoveryRun.pendingCount === 1 ? "" : "s"}` : "Current result set"}</small></div><div><span>Run</span><strong>{activeDiscoveryRun ? displayEventDate(activeDiscoveryRun.createdAt) : "Not recorded"}</strong><small>{activeDiscoveryRun?.initiatedBy || "Initiator unavailable"}</small></div><div><span>Application units</span><strong>{activeDiscoveryRun?.applicationUnits ?? "Not recorded"}</strong><small>Search-scoped provider history</small></div></div>}
              {previousDiscoveryRuns.length > 0 && <div className="previous-discovery-runs"><div><strong>Previous discovery runs</strong><small>Each run retains its own results, filters, and provider provenance.</small></div><div>{previousDiscoveryRuns.map(run => <Button key={run.searchId} size="sm" variant="outline" disabled={loadingPendingReview} onClick={() => void reviewPendingDiscoveryResults(run.searchId)}><span>#{run.searchId} · {run.provider.toUpperCase()} · {run.mode.toUpperCase()}</span><small>{run.criteriaSummary || "Criteria unavailable"} · {run.pendingCount} actionable · {displayEventDate(run.createdAt)}</small></Button>)}</div></div>}
              <div className="discovery-controls">
                <div className="reconciliation-summary"><span><strong>{discoveryCounts.existing}</strong> already mapped</span><span><strong>{discoveryCounts.new}</strong> qualified new</span><span><strong>{discoveryCounts.possibleDuplicate}</strong> possible duplicates</span><span><strong>{discoveryCounts.needsReview}</strong> not qualified as new</span></div>
                <div className="discovery-run-again"><strong>Run again</strong><small>These controls create a separate discovery run.</small>{discoveryCountControl("Run new search", "outline")}</div>
              </div>
              {discoveryReconciliation && <div className="selective-collect-plan">
                <div><span>Candidate reconciliation</span><strong>{discoveryReconciliation.candidatesReturned} provider candidates</strong><small>Derived from stored CN identity and review evidence.</small></div>
                <span><strong>{discoveryReconciliation.knownProviderIds}</strong> known provider IDs</span>
                <span><strong>{discoveryReconciliation.knownProfileUrls}</strong> known profile URLs</span>
                <span><strong>{discoveryReconciliation.knownStrongIdentities}</strong> strong identity matches</span>
                <span><strong>{discoveryReconciliation.newCandidates}</strong> new identity candidates</span>
                <span><strong>{discoveryReconciliation.ambiguousCandidates}</strong> needs identity review</span>
                <span><strong>{discoveryReconciliation.previouslyRejected}</strong> previously rejected</span>
                <span><strong>{discoveryReconciliation.collectRecommended}</strong> profile collects recommended</span>
                <span><strong>{discoveryReconciliation.collectReviewRequired}</strong> review before collect</span>
                <span><strong>{discoveryReconciliation.collectAvoided}</strong> potential profile collections avoided</span>
              </div>}
              {discoveryExecution && <div className="selective-collect-plan discovery-execution-summary">
                <div><span>Selective execution</span><strong>{discoveryExecution.collectExecuted} profile collects executed</strong><small>Preview qualification and CN identity reconciliation run before Collect.</small></div>
                <span><strong>{discoveryExecution.previewCountReturned}</strong> Preview candidates returned</span>
                <span><strong>{discoveryExecution.previewCountConsidered}</strong> candidates considered</span>
                <span><strong>{discoveryExecution.companyMismatches}</strong> company mismatches</span>
                <span><strong>{discoveryExecution.seniorityMismatches}</strong> seniority mismatches</span>
                <span><strong>{discoveryExecution.collectSkippedKnown}</strong> known identities skipped</span>
                <span><strong>{discoveryExecution.collectSkippedFilter}</strong> filter mismatches skipped</span>
                <span><strong>{discoveryExecution.collectSkippedLimit}</strong> Collect-limit skips</span>
                <span><strong>{discoveryExecution.potentialCollectionsAvoided}</strong> potential profile collections avoided</span>
              </div>}
              {activeDiscoveryHistory.length > 0 && <div className="discovery-run-history"><strong>Search #{activeDiscoveryRun?.searchId} provider operations</strong>{activeDiscoveryHistory.map(item => <span key={item.id}>{item.operation} · {item.status} · {item.applicationUnits ?? 0} application unit{item.applicationUnits === 1 ? "" : "s"} · {item.createdAt}</span>)}</div>}
              <div className="credit-notice"><Activity /><span>External discovery consumes the configured application allowance separately from provider-account usage. If Coresignal does not report account usage, it remains unknown until reconciled. Internal search remains free.</span></div>
              {discoveryMessage && <div className="discovery-message">{discoveryMessage}</div>}
              {selectedDiscoveryIds.length > 0 && <div className="batch-approval"><span>{selectedDiscoveryIds.length} clearly new profile{selectedDiscoveryIds.length === 1 ? "" : "s"} selected</span><Button onClick={() => void approveDiscoveryResults(selectedDiscoveryIds)} disabled={discovering}><Plus /> Add Selected to {appConfig.name}</Button></div>}
              <div className="discovery-table-wrap"><Table>
                <TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Name and education</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Seniority</TableHead><TableHead>Location</TableHead><TableHead>Database match</TableHead><TableHead>Identity match confidence</TableHead><TableHead>Professional profile</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{discoveryResults.map(result => {
                  const provenanceConsistent = result.providerIntegrity === "consistent"
                  const actionableReview = result.actionableReview !== false
                  const canAdd = provenanceConsistent && actionableReview && result.matchStatus === "New" && result.reviewStatus === "Pending review" && result.eligibleForAddition === true
                  const added = ADDED_DISCOVERY_STATUSES.has(result.reviewStatus) && result.linkedInternalAlumnusId
                  const professionalProfileUrl = normalizeProfessionalProfileUrl(result.linkedinUrl)
                  return <TableRow key={result.id}>
                    <TableCell><input type="checkbox" aria-label={`Select ${result.name}`} disabled={!canAdd} checked={selectedDiscoveryIds.includes(result.id)} onChange={() => toggleDiscoverySelection(result.id)} /></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.name}</strong><small>Search #{result.searchId} · {(result.provider || "Provider unavailable").toUpperCase()} · {(result.searchMode || "mode unavailable").toUpperCase()}</small><small>Provider person ID: {result.providerPersonId || "Not returned"} · Retrieved: {result.retrievedAt ? displayEventDate(result.retrievedAt) : "Not recorded"}</small>{!provenanceConsistent && <small className="provider-integrity-warning">Provider mismatch — review actions blocked</small>}<small>{result.education}</small><small>Raw programme: {result.educationProgramme || "Not returned"}</small><small>Corporate Network programme: {result.normalizedProgramme || result.programmeStatus || "Programme requires review"}</small><small>Graduation: {result.graduationYear || "Date not returned"} · {result.alumniStatus || "Graduation status unknown — review required"}</small><small>{result.affiliationStatus ?? "Potential alumnus — review required"}</small>{result.qualification && <span className="qualification-evidence"><em>Graduation year · {result.qualification.graduationYear.result.replaceAll("_", " ")}</em>{result.qualification.graduationYear.evidence && <small>Evidence: {result.qualification.graduationYear.evidence}</small>}<small>{result.qualification.graduationYear.rationale}</small><em>Programme · {result.qualification.programme.result.replaceAll("_", " ")}</em><small>{result.qualification.programme.rationale}</small></span>}</span></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.currentRoleAmbiguous ? "Multiple current roles — review required" : result.currentCompany}</strong><small>{result.currentRoleAmbiguous ? "No current employer selected automatically" : result.role}</small>{result.qualification && <span className="qualification-evidence"><em>Company · {result.qualification.company.result.replaceAll("_", " ")}</em><small>{result.qualification.company.evidence || result.qualification.company.rationale}</small><em>Seniority · {result.qualification.seniority.result.replaceAll("_", " ")}</em><small>{result.qualification.seniority.evidence || result.qualification.seniority.rationale}</small></span>}</span></TableCell>
                    <TableCell>{result.function}</TableCell><TableCell>{result.seniority}</TableCell><TableCell>{result.location}</TableCell>
                    <TableCell><DiscoveryBadge status={result.matchStatus} actionableReview={actionableReview} /><small className="review-status">{discoveryReviewLabel(result.reviewStatus, actionableReview)}{result.reviewNote ? ` · ${result.reviewNote}` : ""}</small>{result.plannerClassification && <span className="planner-rationale"><strong>{result.plannerClassification.replaceAll("_", " ")}</strong><small>{result.plannerRationale}</small><em>{result.collectionState?.replaceAll("_", " ") ?? result.collectDecision?.replaceAll("_", " ")}</em>{result.collectionRationale && <small>{result.collectionRationale}</small>}{result.finalDiscoveryStatus && <small>Final status: {result.finalDiscoveryStatus.replaceAll("_", " ")}</small>}</span>}</TableCell>
                    <TableCell><span className={`score-pill ${scoreTone(result.matchConfidence)}`}>{result.matchConfidence}%</span></TableCell>
                    <TableCell>{professionalProfileUrl ? <span className="stacked-cell"><a className="professional-link" href={professionalProfileUrl} target="_blank" rel="noopener noreferrer">View LinkedIn Profile <ArrowUpRight /></a><small>{result.provider?.toLowerCase() === "pdl" ? "Historical PDL" : "Coresignal"} sourced professional profile</small></span> : <span className="muted-cell">Not returned or invalid</span>}</TableCell>
                    <TableCell><div className="row-actions">
                      {canAdd && <Button size="sm" onClick={() => void approveDiscoveryResults([result.id])}><Plus /> Add</Button>}
                      {provenanceConsistent && actionableReview && result.reviewStatus === "Pending review" && (result.matchStatus === "Already in database" || result.matchStatus === "Possible duplicate") && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><GitCompare /> Compare</Button>}
                      {provenanceConsistent && actionableReview && result.reviewStatus === "Pending review" && result.matchStatus === "Needs review" && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><Eye /> Review</Button>}
                      {provenanceConsistent && actionableReview && result.reviewStatus === "Pending review" && result.affiliationStatus !== "Confirmed degree alumnus" && <Select value={result.affiliationStatus ?? "Potential alumnus — review required"} onValueChange={value => void qualifyDiscoveryResult(result, value as NonNullable<DiscoveryResult["affiliationStatus"]>)}><SelectTrigger aria-label={`Classify ${result.name} affiliation`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Confirmed degree alumnus">Confirmed degree alumnus</SelectItem><SelectItem value="Potential alumnus — review required">Potential alumnus — review required</SelectItem><SelectItem value="Short-term / exchange affiliation">Short-term / exchange affiliation</SelectItem></SelectContent></Select>}
                      {added && (() => { const person = alumni.find(item => item.id === result.linkedInternalAlumnusId); return person ? providerModes.lusha === "live" ? <><Button size="sm" variant="outline" onClick={() => prepareLushaReveal(person, "email")}>Prepare Email Reveal</Button><Button size="sm" variant="outline" onClick={() => prepareLushaReveal(person, "phone")}>Prepare Phone Reveal</Button></> : <><Button size="sm" variant="outline" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["email"])}>Get Email</Button><Button size="sm" variant="outline" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["phone"])}>Get Phone</Button><Button size="sm" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["email", "phone"])}>Get Both Contacts</Button></> : null })()}
                      {provenanceConsistent && actionableReview && result.reviewStatus === "Pending review" && <Button size="sm" variant="ghost" onClick={() => { setIgnoreResult(result); setIgnoreReason("Wrong person") }}><XCircle /> Ignore</Button>}
                    </div></TableCell>
                  </TableRow>
                })}</TableBody>
              </Table></div>
              {discoveryState === "empty" && !discoveryResults.length && <div className="empty-state"><Search /><h3>No additional external alumni were found</h3><p>The Coresignal search ran successfully. Broaden optional filters such as location or seniority.</p></div>}
              {discoveryState === "blocked" && !discoveryResults.length && <div className="empty-state blocked-search"><Ban /><h3>External search was not run</h3><p>Review the explanation above. No result is being treated as a successful zero-result search.</p></div>}
            </section>}
          </TabsContent>

          <TabsContent value="companies" className="tab-panel">
            <section className="company-toolbar"><div><p className="eyebrow">Company intelligence</p><h2>Map the strongest route into a target firm.</h2></div>{companies.length > 0 ? <div className="company-actions"><Select value={activeTargetCompany} onValueChange={changeTargetCompany}><SelectTrigger className="company-select"><Building2 /><SelectValue /></SelectTrigger><SelectContent>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>{session.canOperate && <><Button variant="outline" onClick={() => viewOpportunities(activeTargetCompany)}><Eye /> View opportunities</Button><Button variant="outline" onClick={() => createOpportunity(activeTargetCompany)}><BriefcaseBusiness /> Create opportunity</Button><Button onClick={() => findMoreForCompany(activeTargetCompany)} disabled={discovering}><Search /> Discover More Alumni</Button></>}</div> : session.canOperate ? <Button onClick={() => changeWorkspaceTab("directory")}><Search /> Discover alumni</Button> : null}</section>
            {companies.length === 0 ? <section className="panel empty-state"><Building2 /><h3>No companies are mapped yet</h3><p>Approve a reviewed external profile or import approved alumni data to create company intelligence.</p></section> : <section className="company-grid">
              <article className="panel company-summary">
                <div className="company-title"><div className="company-logo">{activeTargetCompany.slice(0, 1)}</div><div><h2>{activeTargetCompany}</h2><span>Target company · Priority inherited by all mapped alumni</span></div></div>
                <div className="company-priority"><label>Company priority</label><Select value={companyPriorities[activeTargetCompany] || "Secondary Target"} disabled={!session.canAdminister} onValueChange={value => updateCompanyPriority(activeTargetCompany, value)}><SelectTrigger aria-label="Company priority"><SelectValue /></SelectTrigger><SelectContent>{companyPriorityOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select><small>Company Priority contributes to Placement Relevance for every alumnus at {activeTargetCompany}. {session.canAdminister ? "Changes apply to all mapped alumni." : "PCOM can view this value; only an Admin can change it."}</small></div>
                <div className="company-kpis"><div><strong>{targetAlumni.length}</strong><span>Alumni mapped</span></div><div><strong>{targetAlumni.filter(p => optionScore(seniorityOptions, seniorityLabel(p)) >= 80).length}</strong><span>Senior leaders</span></div><div><strong>{targetAlumni.filter(p => p.function === "HR").length}</strong><span>HR contacts</span></div><div><strong>{targetAlumni.filter(p => operationalStatus(p) === "Contact-ready").length}</strong><span>Contact-ready</span></div></div>
                <div className="distribution"><h3>Network by function</h3>{Object.entries(functionCounts).map(([name, count]) => <div key={name} className="distribution-row"><span>{name}</span><div><i style={{ width: `${Math.max(24, count / Math.max(targetAlumni.length, 1) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
              </article>
              <article className="panel contacts-panel"><div className="panel-heading"><div><p className="eyebrow">Recommended contacts</p><h2>Best people to approach</h2></div></div>{targetAlumni.length ? <>{companyContactsPagination.items.map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; const unknownRelationship = person.assessment.iimlRelationship === "Unknown / Not assessed"; return <button key={person.id} className="contact-card" onClick={() => openAlumnusProfile(person)}><span className="avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small><em className={unknownRelationship ? "relationship-neutral" : ""}>{unknownRelationship ? "IIML relationship not assessed" : `${person.assessment.iimlRelationship} IIML relationship`}</em></span><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></button> })}<PaginationFooter model={companyContactsPagination} label="Company contacts pagination" /></> : <div className="empty-state"><ContactRound /><h3>No alumni mapped yet</h3><p>This is a clear network gap for the committee.</p></div>}</article>
              {session.canOperate && <article className="panel company-route-card"><div className="panel-heading"><div><p className="eyebrow">Plan outreach</p><h2>How should we approach?</h2><span>Selecting a company does not automatically choose the target person.</span></div></div><AlumnusCombobox options={targetAlumni} value={targetAlumnusId} onValueChange={selectTargetAlumnus} /><Button title={!targetAlumnusId ? "Select a target alumnus first." : routeLoading ? "The route recommendation is still being prepared." : undefined} disabled={!targetAlumnusId || routeLoading} onClick={() => void recommendRoute()}><Network /> Recommend Route</Button>{!targetAlumni.length && <small>Add or discover an alumnus at {activeTargetCompany} before requesting a route.</small>}</article>}
              <article className="panel account-history"><div className="panel-heading"><div><p className="eyebrow">Institutional memory</p><h2>Account history</h2></div></div>{companyEngagements.length ? <><div className="account-history-list">{companyHistoryPagination.items.map(event => <div key={event.id}><History /><span><strong>{event.eventTitle}</strong><small>{event.alumnus?.name} · {displayEventDate(event.actionTakenAt || event.eventDate)} · {event.status}</small></span></div>)}</div><PaginationFooter model={companyHistoryPagination} label="Company account history pagination" /></> : <div className="account-history-empty"><History /><span><strong>Account history</strong><small>No company engagement recorded yet.</small></span></div>}</article>
            </section>}
          </TabsContent>

          <TabsContent value="engagement" className="tab-panel">
            <section className="engagement-header">
              <div><p className="eyebrow">Shared relationship actions</p><h2>Engagement queue</h2><span>Views, ownership, emails, responses, and follow-ups are shared across committee members.</span></div>
              <div className="demo-user"><label>Signed-in owner</label><strong>{session.displayName}</strong><small>Actions use your authenticated identity</small></div>
            </section>

            <section className="engagement-stats">
              <button onClick={() => setEngagementFilter("Professional Signals")}><BellRing /><span>New professional signals<strong>{professionalEvents.filter(event => event.status === "New").length}</strong></span></button>
              <button onClick={() => setEngagementFilter("Birthdays")}><Cake /><span>Birthdays today<strong>{birthdaysToday.length}</strong></span></button>
              <button onClick={() => setEngagementFilter("Assigned to Me")}><UserRoundCheck /><span>Assigned to me<strong>{assignedToMe.length}</strong></span></button>
              <button onClick={() => setEngagementFilter("Follow-ups")}><CalendarClock /><span>Follow-ups due<strong>{followUpsDue.length}</strong></span></button>
            </section>

            <section className="panel engagement-panel">
              <div className="engagement-filterbar">
                <div className="engagement-filter-tabs">{["Needs Action", "Professional Signals", "Birthdays", "Assigned to Me", "Follow-ups", "Completed", "Skipped"].map(filter => <button key={filter} className={engagementFilter === filter ? "active" : ""} onClick={() => setEngagementFilter(filter)}>{filter}</button>)}</div>
                <div className={`mail-mode mail-${mailMode}`}><Mail /> {mailUi.label}</div>
              </div>

              {engagementFilter === "Professional Signals" && <><section className="signals-readiness"><div><Sparkles /><span><strong>Check Professional Signals</strong><small>Promotions and company changes only · review before profile updates</small></span></div><span className={`provider-mode mode-${signalsActive ? "live" : "mock"}`}>{signalsUi.label}</span><small>{signalsUi.reason} Selecting an alumnus never calls Lusha.</small>{session.canOperate && <div className="signals-selector"><AlumnusCombobox label="Alumnus with a verified Lusha identity" options={alumni} value={signalsAlumnusId} onValueChange={setSignalsAlumnusId} placeholder="Search or select an alumnus..." />{signalsTarget && <small>{signalsTarget.lushaPersonId ? "Eligible identity: existing stable Lusha contact ID" : "Lusha contact identity required before Professional Signals can be checked."}</small>}<Button title={!signalsTarget ? "Select an alumnus first." : !signalsTarget.lushaPersonId ? "Requires a stored Lusha contact ID." : signalsUi.reason} size="sm" disabled={!signalsActive || !signalsTarget?.lushaPersonId} onClick={() => setSignalsConfirmOpen(true)}><Sparkles /> Check for signals</Button></div>}</section>{signalsMessage && <div className="discovery-message">{signalsMessage}</div>}</>}

              <div className="birthday-filters" aria-label="Engagement filters">
                <Select value={engagementPeriod} onValueChange={setEngagementPeriod}><SelectTrigger aria-label="Time period"><SelectValue /></SelectTrigger><SelectContent>{["Today", "Tomorrow", "Next 7 Days", "This Month", "All upcoming", "All dates"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={engagementCompany} onValueChange={setEngagementCompany}><SelectTrigger aria-label="Company"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All companies">All companies</SelectItem>{companies.map(company => <SelectItem key={company} value={company}>{company}</SelectItem>)}</SelectContent></Select>
                {engagementFilter !== "Assigned to Me" && <Select value={engagementAssignee} onValueChange={setEngagementAssignee}><SelectTrigger aria-label="Assignee"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All assignees">All assignees</SelectItem><SelectItem value="Unassigned">Unassigned</SelectItem><SelectItem value="Assigned to me">Assigned to me</SelectItem>{engagementAssignees.filter(user => user.displayName !== currentDemoUser).map(user => <SelectItem key={user.id} value={user.displayName}>{user.displayName}</SelectItem>)}</SelectContent></Select>}
                <Select value={engagementActionState} onValueChange={setEngagementActionState}><SelectTrigger aria-label="Email or action state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All email states">All email states</SelectItem><SelectItem value="Email available">Email available</SelectItem><SelectItem value="Email unavailable">Email unavailable</SelectItem></SelectContent></Select>
                <Button variant="ghost" onClick={() => { setEngagementPeriod("All dates"); setEngagementCompany("All companies"); setEngagementAssignee("All assignees"); setEngagementActionState("All email states") }}>Clear</Button>
                {engagementFilter === "Birthdays" && <div className="birthday-bulk-summary"><span>{selectedBirthdayIds.length} selected</span><Button title={!selectedBirthdayIds.length ? "Select at least one eligible birthday engagement to preview emails." : undefined} variant="outline" disabled={!selectedBirthdayIds.length || engagementLoading} onClick={() => void previewSelectedBirthdays()}><Eye /> Preview Selected Emails</Button></div>}
              </div>

              {engagementMessage && <div className="engagement-message"><Activity /><span>{engagementMessage}</span><button aria-label="Dismiss message" onClick={() => setEngagementMessage("")}><XCircle /></button></div>}

              <div className="engagement-list">{engagementPagination.items.map(group => {
                const representative = group.events[0]
                const person = alumni.find(item => item.id === group.alumnusId)
                const relevance = person ? relevanceBreakdown(person, companyPriorities, engagements).score : 50
                return <section className="engagement-alumnus-group" key={group.alumnusId}>
                  <header><span className="avatar small">{representative?.alumnus?.initials ?? "?"}</span><span><strong>{representative?.alumnus?.name ?? "Unknown alumnus"}</strong><small>{representative?.alumnus?.title} · {representative?.alumnus?.company}</small></span><em>{group.events.length} distinct engagement{group.events.length === 1 ? "" : "s"}</em></header>
                  {group.events.map(event => {
                    const completed = isCompletedEngagement(event.status)
                    const emailMissing = !event.alumnus?.email
                    const canEmail = event.eventType === "Professional Signal" ? Boolean(event.alumnus?.email) && !completed : birthdayReady(event)
                    const eventBusy = pendingEngagementKeys.has(`event:${event.id}`)
                    const ownerName = event.owner?.displayName ?? event.assignedTo
                    return <article key={event.id} className={`engagement-card engagement-card-grouped ${completed ? "completed" : ""}`}>
                      <div className="event-identity"><span className={`event-icon event-${event.eventType.toLowerCase().replaceAll(" ", "-")}`}>{event.eventType === "Birthday" ? <Cake /> : <ArrowUpRight />}</span><span><small>Action</small><strong>{event.eventType}</strong><em>{event.eventSubtype || "Recorded engagement"}</em></span>{event.eventType === "Birthday" && <input type="checkbox" aria-label={`Select ${event.alumnus?.name} birthday`} disabled={!birthdayReady(event)} checked={selectedBirthdayIds.includes(event.id)} onChange={() => toggleBirthdaySelection(event.id)} />}</div>
                      <div className="event-copy"><small>Engagement</small><h3>{event.eventTitle}</h3><p>{event.eventDescription}</p>{event.eventType === "Birthday" && <span className={`birthday-eligibility ${birthdayReady(event) ? "eligible" : "ineligible"}`}>{birthdayReady(event) ? "Eligible" : emailMissing ? "Cannot email — no stored email" : `Cannot email — ${event.preference === "Unknown" ? "birthday permission unknown" : "permission or birthday verification required"}`}</span>}</div>
                      <div className="event-context"><small>Context</small><EngagementStatusBadge status={event.status} /><span>{displayEventDate(event.eventDate)}</span><span>Source: {event.source}</span>{ownerName && <em title={event.owner?.userId ? `Internal user ID ${event.owner.userId}` : event.owner?.storedIdentity ? `Stored audit identity ${event.owner.storedIdentity}` : undefined}>Assigned to {ownerName}</em>}{event.skipReason && <em>{event.skipReason}</em>}</div>
                      <div className="event-state"><small>Placement relevance</small><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></div>
                      <div className="event-actions">
                        {!completed && !event.assignedTo && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void postEngagement("assign", event.id)}>Take Ownership</Button>}
                        {!completed && event.assignedTo && ownerName !== currentDemoUser && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void postEngagement("assign", event.id, { force: true })}>Reassign to Me</Button>}
                        {!completed && event.eventType === "Birthday" && emailMissing && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void getBirthdayEmail(event)}>Get Email via Lusha</Button>}
                        {canEmail && <Button size="sm" disabled={eventBusy} onClick={() => void previewEngagement(event)}>{event.eventType === "Birthday" ? <Cake /> : <Mail />} {event.eventType === "Birthday" ? "Preview Wish" : "Send Congratulations"}</Button>}
                        <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void openEngagement(event)}>{completed ? "View Engagement" : "Review"}</Button>
                      </div>
                    </article>
                  })}
                </section>
              })}</div>
              {!visibleEngagements.length && (() => { const [title, copy] = engagementEmptyState(engagementFilter); return <div className="empty-state"><CheckCircle2 /><h3>{title}</h3><p>{copy}</p></div> })()}
              <PaginationFooter model={engagementPagination} label="Engagement queue pagination" />
            </section>
          </TabsContent>

          <TabsContent value="outreach" className="tab-panel">
            <section className="panel outreach-panel">
              <div className="panel-heading"><div><p className="eyebrow">Relationship workflow</p><h2>Outreach pipeline</h2><span>Updates are saved centrally and shared across committee members.</span></div></div>
              <div className="pipeline-summary"><button className={`pipeline-all ${outreachStatus === "All alumni" ? "active" : ""}`} onClick={() => setOutreachStatus("All alumni")}><span>All alumni</span><strong>{alumni.length}</strong></button>{statusOptions.map(status => <button className={outreachStatus === status ? "active" : ""} key={status} onClick={() => setOutreachStatus(status)}><StatusBadge status={status} /><strong>{alumni.filter(person => person.status === status).length}</strong></button>)}</div>
              <div className="outreach-filters"><div className="search-field"><Search /><Input value={outreachSearch} onChange={event => setOutreachSearch(event.target.value)} placeholder="Search alumnus" aria-label="Search outreach alumni" /></div><Select value={outreachCompany} onValueChange={setOutreachCompany}><SelectTrigger aria-label="Filter outreach by company"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All companies">All companies</SelectItem>{companies.map(company => <SelectItem key={company} value={company}>{company}</SelectItem>)}</SelectContent></Select><Select value={outreachStatus} onValueChange={setOutreachStatus}><SelectTrigger aria-label="Filter by outreach status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All alumni">All statuses</SelectItem>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><Select value={outreachRelevance} onValueChange={setOutreachRelevance}><SelectTrigger aria-label="Filter by Placement Relevance"><SelectValue /></SelectTrigger><SelectContent>{["All", "75–100", "50–74", "Below 50"].map(item => <SelectItem key={item} value={item}>{item === "All" ? "All Placement Relevance" : item}</SelectItem>)}</SelectContent></Select><Button variant="ghost" onClick={clearOutreachFilters}>Clear</Button></div>
              <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Target company</TableHead><TableHead>Why this alumnus?</TableHead><TableHead>Placement relevance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{outreachPagination.items.map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small></span></button></TableCell><TableCell>{person.company}</TableCell><TableCell className="reason-cell">{outreachRationale(person)}</TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><Select value={person.status} onValueChange={value => updateStatus(person.id, value as OutreachStatus)}><SelectTrigger className="status-select"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></TableCell></TableRow> })}</TableBody></Table>{!visibleOutreach.length && <div className="empty-state"><Search /><h3>No alumni match these Outreach filters</h3><p>Clear or adjust the filters to return to the full pipeline.</p></div>}
              <PaginationFooter model={outreachPagination} label="Outreach pipeline pagination" />
            </section>
          </TabsContent>

          {session.canOperate && <TabsContent value="opportunities" className="tab-panel"><OpportunitiesWorkspace currentUserName={currentDemoUser} initialCompany={opportunityContext.company} initialAlumnusId={opportunityContext.alumnusId} contextKey={opportunityContext.key} contextMode={opportunityContext.mode} defaultToMyWork={session.role === "PCOM"} /></TabsContent>}

          <TabsContent value="data-import" className="tab-panel">
            <section className="import-layout">
              <article className="panel import-panel">
                <div className="panel-heading"><div><p className="eyebrow">Bulk import</p><h2>Upload alumni file</h2><span>Validate and review CSV or Excel data before anything is saved.</span></div><div className="database-badge"><Database /> Shared database</div></div>
                <div className="import-body">
                  <div className="upload-zone">
                    <FileSpreadsheet />
                    <div><strong>{importFile ? importFile.name : "Choose a CSV or Excel file"}</strong><span>Required: name, graduation year / batch and company. Excel uses the first worksheet and reads cell values only.</span></div>
                    <input className="file-input" aria-label="Choose CSV or Excel alumni file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { setImportFile(event.target.files?.[0] ?? null); setImportReview(null); setApprovedImportUpdates([]); setImportMessage("") }} />
                  </div>
                  <div className="import-actions"><Button variant="outline" onClick={downloadTemplate}><Download /> Download CSV template</Button><span><Button title={!importFile ? "Choose a CSV or Excel file first." : undefined} variant="outline" onClick={() => void validateImportFile()} disabled={!importFile || importing}>{importing && !importReview ? <LoaderCircle className="spin" /> : <CheckCircle2 />} Validate</Button><Button title={!importReview ? "Validate and review the file first." : importReview.blocking ? "Resolve blocking validation errors first." : undefined} onClick={() => void importAlumni()} disabled={!importReview || importReview.blocking || importing}>{importing && importReview ? <LoaderCircle className="spin" /> : <Upload />} Import reviewed records</Button></span></div>
                  {importReview && <div className="import-review"><div className="import-review-summary"><span><strong>{importReview.counts.detected}</strong> rows detected</span><span><strong>{importReview.counts.newRecords}</strong> new alumni</span><span><strong>{importReview.counts.existingMatches}</strong> existing matches</span><span><strong>{importReview.counts.needsAttention}</strong> need attention</span><span><strong>{importReview.counts.duplicates}</strong> duplicates in file</span></div>{importReview.sheetName && <p>Excel worksheet used: <strong>{importReview.sheetName}</strong>. Other worksheets are not imported.</p>}<div className="import-review-rows">{importPagination.items.map(row => <div key={`${row.index}-${row.key}`} className={`import-review-row import-${row.kind}`}><span>Row {row.index}</span><strong>{row.record.name || "Unnamed row"}</strong><small>{row.kind === "duplicate" ? "Duplicate within this file" : row.issues.length ? row.issues.join(" · ") : row.kind === "existing" ? `Existing match${row.changedFields.length ? ` · changed: ${row.changedFields.join(", ")}` : " · no changes"}` : "Ready to add"}</small>{row.kind === "existing" && row.changedFields.length > 0 && <label><input type="checkbox" checked={approvedImportUpdates.includes(row.key)} onChange={() => setApprovedImportUpdates(current => current.includes(row.key) ? current.filter(key => key !== row.key) : [...current, row.key])} /> Apply safe changes; preserve verified fields</label>}</div>)}</div><PaginationFooter model={importPagination} label="Import review pagination" /></div>}
                  {importMessage && <div className="workspace-message" role="status"><Cloud /> <span>{importMessage}</span></div>}
                </div>
              </article>

              <article className="panel manual-entry-card"><div className="manual-entry-icon"><UserPlus /></div><div><p className="eyebrow">Manual entry</p><h2>Add one alumnus</h2><span>Best for one or a few known alumni when preparing a CSV is unnecessary.</span></div><Button onClick={() => { setManualForm(current => ({ ...current, programme: activeProgrammeChoices.some(option => option.value === current.programme) ? current.programme : activeProgrammeChoices[0]?.value ?? "" })); setManualOpen(true); setManualSaved(null); setManualMatches([]); setManualMessage("") }}><UserPlus /> Add Alumnus</Button><small>Duplicate checking runs before any record is saved. Provider calls remain optional.</small></article>

              <aside className="panel database-panel">
                <div className="database-hero"><Database /><div><p className="eyebrow">Shared alumni database</p><h2>{alumni.length} alumni · {companies.length} companies</h2><span>One governed workspace</span></div></div>
                <div className="database-facts"><div><span>Maximum import</span><strong>250 rows</strong></div><div><span>Duplicate matching</span><strong>Email, profile URL, or name + year + company</strong></div><div><span>Database</span><strong>Ready ✓</strong></div><div><span>Latest CSV/Excel import</span><strong>{latestImport?.filename ?? "None yet"}</strong></div></div>
                <div className="latest-import"><CheckCircle2 /><div><strong>{latestImport ? "Latest import completed" : "Database ready"}</strong><span>{latestImport ? `${latestImport.rowCount} records by ${latestImport.importedBy}` : "No uploaded file has been recorded yet."}</span></div></div>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="enrichment" className="tab-panel">
            <section className="enrichment-header">
              <div><p className="eyebrow">Coresignal and Lusha</p><h2>Provider enrichment centre</h2><span>Refresh professional profiles, retrieve contact channels and control paid usage from one place.</span></div>
              <span className={`provider-mode mode-${providerModes.coresignal}`}>Coresignal {providerModes.coresignal.toUpperCase()} · Lusha {providerModes.lusha.toUpperCase()}</span>
            </section>

            <section className="provider-grid">
              {(["coresignal", "lusha"] as Provider[]).map(provider => {
                const usage = providerUsage[provider]
                const percent = usage.limit ? Math.min(100, usage.used / usage.limit * 100) : 100
                return <article className="panel provider-card" key={provider}>
                  <div className="provider-title"><span>{provider === "coresignal" ? "CS" : "LU"}</span><div><h3>{provider === "coresignal" ? "Coresignal" : "Lusha"}</h3><small>{provider === "coresignal" ? "Professional discovery and employment refresh" : "Email and phone enrichment"}</small></div></div>
                  <div className="provider-status"><span className={usage.configured ? "configured" : "not-configured"}>{provider === "coresignal" ? "Coresignal" : "Lusha"} — {providerModes[provider].toUpperCase()}{providerModes[provider] === "live" ? usage.configured ? " · key configured" : " · key missing" : ""}</span><strong>Application usage limit</strong></div>
                  <div className="credit-meter"><i style={{ width: `${percent}%` }} /></div>
                  <div className="credit-numbers"><span>{usage.used} / {usage.limit} used</span><span>{usage.remaining} remaining internal capacity</span></div>
                  <div className="credit-limit"><Input type="number" min="0" value={creditDrafts[provider]} disabled={!session.canAdminister} onChange={event => setCreditDrafts(current => ({ ...current, [provider]: event.target.value }))} aria-label={`${provider} monthly credit limit`} />{session.canAdminister && <Button variant="outline" onClick={() => void saveCreditLimit(provider)}>Save limit</Button>}</div>
                  {provider === "lusha" && session.canAdminister && providerModes.lusha === "live" && <Button variant="outline" onClick={() => void validateLushaConnection()}>Validate Lusha connection</Button>}
                  {!session.canAdminister && <small className="role-restriction">Only an Admin can change application credit limits.</small>}
                  <p>{provider === "coresignal" ? "This application allowance is not the Coresignal account balance. Provider usage remains unknown unless Coresignal reports it or an administrator reconciles it." : "This is Corporate Network's application limit, not the Lusha account balance. V3 requests may include request/result usage plus selected reveal fields. Provider-reported usage is recorded; unavailable per-call usage is flagged for account reconciliation."}</p>
                </article>
              })}
            </section>

            <section className="panel batch-panel">
              <div className="panel-heading"><div><p className="eyebrow">Selected alumni actions</p><h2>{session.canOperate ? providerModes.coresignal === "live" ? "Select one approved alumnus for controlled provider actions" : "Select up to 25 approved alumni" : "Provider diagnostics"}</h2><span>{session.canOperate ? `${selectedForEnrichment.length} selected. Coresignal refresh and Lusha contact preparation remain separate. No live action runs without confirmation.` : "Developer access is read-only. Credit-consuming operations and provider history are restricted."}</span></div>{session.canOperate && <div className="batch-actions"><Button variant="outline" disabled={!professionalSelectionReady || enriching} title={!selectedForEnrichment.length ? "Select at least one alumnus" : !professionalSelectionReady ? "Coresignal is unavailable or its application limit is insufficient" : "Review and refresh professional profiles"} onClick={() => setRefreshConfirmOpen(true)}><Cloud /> Refresh Profiles</Button>{providerModes.lusha === "live" ? <><Button variant="outline" disabled={!lushaEmailReady || enriching} title={!selectedForEnrichment.length ? "Select one alumnus" : !lushaEmailReady ? "Select exactly one eligible alumnus and confirm Lusha is configured with application capacity" : "Start the controlled Lusha V3 email workflow"} onClick={() => { const person = alumni.find(item => item.id === selectedForEnrichment[0]); if (person) prepareLushaReveal(person, "email") }}><Mail /> Prepare Email Reveal</Button><Button variant="outline" disabled={!lushaPhoneReady || enriching} title={!selectedForEnrichment.length ? "Select one alumnus" : !lushaPhoneReady ? "Select exactly one eligible alumnus with a missing or unverified phone and available application capacity" : "Start the controlled Lusha V3 phone workflow"} onClick={() => { const person = alumni.find(item => item.id === selectedForEnrichment[0]); if (person) prepareLushaReveal(person, "phone") }}><ContactRound /> Prepare Phone Reveal</Button></> : <><Button variant="outline" disabled={!lushaEmailReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email"])}>Get Emails</Button><Button variant="outline" disabled={!lushaPhoneReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["phone"])}>Get Phones</Button><Button disabled={!lushaBothReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email", "phone"])}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both Contacts</Button></>}</div>}</div>
              <div className="selection-eligibility" role="status"><strong>{selectedForEnrichment.length} selected</strong><span>{selectedForEnrichment.length} eligible for Coresignal refresh · {emailPlan.emailOperations} eligible for email enrichment · {phonePlan.phoneOperations} eligible for phone enrichment</span><small>Refresh Profiles: Coresignal professional data is staged for review; returned changes require approval. Get Emails/Phones: only missing or unverified eligible channels are retrieved through Lusha.</small></div>
              {enrichmentMessage && <div className="enrichment-message"><Activity /> <span>{enrichmentMessage}</span></div>}
              <Table><TableHeader><TableRow><TableHead>{session.canOperate && <input type="checkbox" aria-label={providerModes.coresignal === "live" ? "Select first alumnus" : "Select visible alumni"} checked={Boolean(enrichmentPagination.items.length) && enrichmentPagination.items.every(person => selectedForEnrichment.includes(person.id))} onChange={event => { const visibleIds = enrichmentPagination.items.map(person => person.id); setSelectedForEnrichment(current => event.target.checked ? [...new Set([...current, ...visibleIds])].slice(0, providerModes.coresignal === "live" ? 1 : 25) : current.filter(id => !visibleIds.includes(id))) }} />}</TableHead><TableHead>Alumnus</TableHead><TableHead>Current profile</TableHead><TableHead>Email status</TableHead><TableHead>Phone status</TableHead><TableHead>Last profile refresh</TableHead></TableRow></TableHeader><TableBody>{enrichmentPagination.items.map(person => { const emailState = contactDataLabel(person, "email"); const phoneState = contactDataLabel(person, "phone"); const lastProfileRefresh = person.lastProfessionalDataRefresh || person.lastPdlRefresh; return <TableRow key={person.id}><TableCell>{session.canOperate && <input type="checkbox" aria-label={`Select ${person.name}`} checked={selectedForEnrichment.includes(person.id)} onChange={() => toggleEnrichmentSelection(person.id)} />}</TableCell><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{alumniEducationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell><span className="contact-state"><strong>{emailState.status}</strong><small>{emailState.detail}</small></span></TableCell><TableCell><span className="contact-state"><strong>{phoneState.status}</strong><small>{phoneState.detail}</small></span></TableCell><TableCell>{lastProfileRefresh ? new Date(lastProfileRefresh).toLocaleDateString() : "Not refreshed"}</TableCell></TableRow> })}</TableBody></Table>
              <PaginationFooter model={enrichmentPagination} label="Enrichment alumni pagination" />
            </section>

            {session.canAdminister ? <section className="panel history-panel">
              <div className="panel-heading"><div><p className="eyebrow">Provider-response history</p><h2>{session.canOperate ? "Complete enrichment audit trail" : "Operational history restricted"}</h2><span>{session.canOperate ? "Sanitised request outcomes are shared centrally. API secrets and raw sensitive payloads are never stored here." : "Developer access includes provider health and usage status, not alumni-specific provider responses."}</span></div>{session.canAdminister && <Button variant="ghost" size="sm" onClick={() => void refreshProviderHistory()}>Refresh history</Button>}</div>
              <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Provider</TableHead><TableHead>Alumnus</TableHead><TableHead>Operation</TableHead><TableHead>Result</TableHead><TableHead>Usage</TableHead><TableHead>Response</TableHead></TableRow></TableHeader><TableBody>{providerHistoryPagination.items.map(item => { const usage = providerUsageLabel(item); return <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell><TableCell><span className="provider-chip">{item.provider.toUpperCase()}</span></TableCell><TableCell>{item.alumnusName}</TableCell><TableCell>{item.operation} · {item.mode}</TableCell><TableCell><span className={`history-status history-${item.status}`}>{item.status.replace("_", " ")}</span>{item.resultCount ? <small className="review-status">{item.resultCount} results</small> : null}</TableCell><TableCell><span className="stacked-cell"><strong>{usage.label}</strong><small>{usage.detail}</small>{item.provider === "coresignal" && <small>{item.applicationUnits ?? 0} application unit{(item.applicationUnits ?? 0) === 1 ? "" : "s"}</small>}{item.reconciliationSource && <small>{item.reconciliationSource}</small>}{session.canAdminister && item.provider === "lusha" && usage.label === "Reconciliation required" && <span className="usage-reconcile"><Input type="number" min="0" step="1" value={usageReconciliationDrafts[item.id] ?? ""} onChange={event => setUsageReconciliationDrafts(current => ({ ...current, [item.id]: event.target.value }))} aria-label={`Observed account delta for ${item.operation}`} placeholder="Observed delta" /><Button size="sm" variant="outline" onClick={() => void reconcileProviderUsage(item)}>Reconcile</Button></span>}</span></TableCell><TableCell className="response-cell">{item.requestSummary && <small>{item.requestSummary}</small>}{item.errorMessage || item.responseSummary}{session.canAdminister && item.searchEvidence?.state === "RETAINED" && <details className="history-evidence-details"><summary>Review Search evidence</summary><CoresignalSearchEvidencePanel evidence={item.searchEvidence.evidence} showIds /></details>}{session.canAdminister && item.searchEvidence && item.searchEvidence.state !== "RETAINED" && <small className="history-evidence-unavailable">{item.searchEvidence.reason}</small>}</TableCell></TableRow> })}</TableBody></Table>
              <PaginationFooter model={providerHistoryPagination} label="Provider history pagination" />
              {!providerHistory.length && <div className="empty-state"><Activity /><h3>No provider responses yet</h3><p>Run a manual or batch enrichment to create the first audit entry.</p></div>}
            </section> : <section className="panel history-panel"><div className="empty-state"><ShieldCheck /><h3>Administrative provider history is restricted</h3><p>Your operational actions remain available above. Provider requests, credit accounting, evidence envelopes, and technical diagnostics are available only in the Admin workspace.</p></div></section>}
          </TabsContent>
          <TabsContent value="intelligence" className="tab-panel"><IntelligenceWorkspace view={activeIntelligenceView} onViewChange={changeIntelligenceView} selectedIds={selectedForIntelligence} pageIds={directoryPagination.items.map(person => person.id)} matchingIds={filtered.map(person => person.id)} canOperate={session.canOperate} canAdminister={session.canAdminister} /></TabsContent>
          {session.canAdminister && <TabsContent value="admin" className="tab-panel"><AdminPanel alumni={alumni} /></TabsContent>}
        </Tabs>
      </section>

      <Sheet open={Boolean(selected)}>
        <SheetContent className="profile-sheet sm:max-w-xl" onClose={closeAlumnusProfile}>
          {selected && session.canOperate && <div className="profile-direct-mail"><div><strong>Controlled institutional email</strong><small>Draft, edit, review, and explicitly approve before any send.</small></div><Button title={!selected.email ? "Requires an eligible stored email." : undefined} size="sm" variant="outline" disabled={!selected.email} onClick={() => startProfileEmailDraft(selected)}><Mail /> Draft Email</Button>{!selected.email && <small>A valid stored email is required before drafting.</small>}</div>}
          {selected && selectedBreakdown && <><SheetHeader className="profile-header"><div className="profile-avatar">{selected.initials}</div><div><SheetTitle>{selected.name}</SheetTitle><SheetDescription>{selected.title} at {selected.company}</SheetDescription></div></SheetHeader><div className="profile-scroll">
            <div className="profile-scores profile-order-summary"><div><span>Data confidence</span><strong className={scoreTone(selected.confidence)}>{selected.confidence}%</strong><small>Can we trust the information?</small></div><div><span>Placement relevance</span><strong className={scoreTone(selectedBreakdown.score)}>{selectedBreakdown.score}/100</strong><small>How valuable is this alumnus for outreach?</small></div></div>
            {selected.privacy?.generalContactStatus === "Do not contact" && <div className="do-not-contact-banner profile-order-dnc"><Ban /><div><strong>Do not contact</strong><span>All birthday, professional and outreach sends are blocked server-side for this alumnus.</span></div></div>}
            {session.canOperate && <details className="profile-section data-quality-section profile-order-quality"><summary>Professional data quality</summary><p className="section-help">Provider success does not prove freshness. Conflicts remain visible until reviewed.</p><label className="data-quality-status"><span>Status</span><Select value={selected.professionalDataStatus || "Needs assessment"} onValueChange={value => void updateProfessionalDataQuality(selected, value, professionalNoteDrafts[selected.id] ?? selected.professionalDataNote ?? "")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Needs assessment", "Reviewed", "Current", "Conflict — manual verification required", "Manually verified"].map(item => <SelectItem key={item} value={item}>{item === "Reviewed" ? "Reviewed (legacy)" : item}</SelectItem>)}</SelectContent></Select></label>{(selected.professionalDataStatus === "Conflict — manual verification required" || Boolean(selected.professionalDataNote)) && <label className="data-quality-note"><span>Verification / conflict note</span><Textarea value={professionalNoteDrafts[selected.id] ?? selected.professionalDataNote ?? ""} placeholder="Explain conflicting sources and what should be checked." onChange={event => setProfessionalNoteDrafts(current => ({ ...current, [selected.id]: event.target.value }))} onBlur={event => void updateProfessionalDataQuality(selected, selected.professionalDataStatus || "Needs assessment", event.target.value)} /></label>}</details>}
            <details className="score-breakdown profile-order-score"><summary>Why this score?</summary><div className="breakdown-list">{selectedBreakdown.items.map(item => <div key={item.label}><span>{item.label}<small>{item.weight}% weight</small></span><strong>{item.score}</strong><em>{(item.score * item.weight / 100).toFixed(1)}</em></div>)}</div><p>Placement Relevance uses the established weighted factors and rounds the total to the nearest whole number.</p></details>
            <details className="profile-section assessment-details profile-order-assessment"><summary>Edit assessment</summary><p className="section-help">Choose the relationship evidence requiring committee judgment. System-derived factors remain read-only.</p><div className="assessment-grid">
              <label><span>Hiring influence</span><Select disabled={!session.canOperate} value={selected.assessment.hiringInfluence} onValueChange={value => updateAssessment(selected.id, "hiringInfluence", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{hiringOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
              <label><span>IIML relationship</span><Select disabled={!session.canOperate} value={selected.assessment.iimlRelationship} onValueChange={value => updateAssessment(selected.id, "iimlRelationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
              <label><span>Warm-introduction potential</span><Select disabled={!session.canOperate} value={selected.assessment.warmIntroPotential} onValueChange={value => updateAssessment(selected.id, "warmIntroPotential", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{warmIntroOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
            </div><div className="derived-grid"><div><span>Company priority</span><strong>{companyPriorities[selected.company] || "Secondary Target"}</strong><small>Inherited from company settings</small></div><div><span>Seniority</span><strong>{seniorityLabel(selected)}</strong><small>Derived from designation</small></div><div><span>Past responsiveness</span><strong>{derivedResponsiveness(selected, engagements)}</strong><small>{selectedEngagementHistory.some(event => event.responseReceived) ? "Derived from shared engagement history" : "Uses current outreach evidence"}</small></div></div><div className="calculated-score"><span>Calculated Placement Relevance</span><strong>{selectedBreakdown.score}/100</strong></div></details>
            <section className="profile-section profile-order-professional"><h3>Professional profile</h3><div className="detail-grid"><div><Building2 /><span>Current company<strong>{selected.company}</strong></span></div><div><BriefcaseBusiness /><span>Function<strong>{selected.function} · {selected.seniority}</strong></span></div><div><MapPin /><span>Location<strong>{selected.location}</strong></span></div><div><History /><span>Experience<strong>{selectedExperienceSummary}</strong></span></div></div>{selectedProfessionalProfileUrl && <a className="profile-link" href={selectedProfessionalProfileUrl} target="_blank" rel="noopener noreferrer">Open professional profile <ArrowUpRight /></a>}</section>
            <ProfileIntelligencePanel alumnusId={selected.id} canOperate={session.canOperate} onOpenIntelligence={view => { closeAlumnusProfile(); window.setTimeout(() => changeIntelligenceView(view), 0) }} />
            {session.canOperate && <section className="profile-section profile-opportunities"><div><h3>Corporate opportunities</h3><p className="section-help">Create or review accountable opportunities linked to this alumnus and company.</p></div><div className="profile-opportunity-actions"><Button variant="outline" onClick={() => { const id = selected.id; const company = selected.company; closeAlumnusProfile(); window.setTimeout(() => viewOpportunities(company, id), 0) }}><Eye /> View linked opportunities</Button><Button onClick={() => { const id = selected.id; const company = selected.company; closeAlumnusProfile(); window.setTimeout(() => createOpportunity(company, id), 0) }}><BriefcaseBusiness /> Create opportunity</Button></div></section>}
            <section className="profile-section profile-order-iiml"><h3>IIM Lucknow context</h3><div className="detail-grid"><div><CircleUserRound /><span>Programme and batch<strong>{alumniEducationLabel(selected)}</strong></span></div><div><Network /><span>Placement Committee relationship<strong>{session.canOperate ? selected.assessment.iimlRelationship === "Unknown / Not assessed" ? "No prior Placement Committee engagement" : selected.assessment.iimlRelationship : "Restricted for Developer role"}</strong></span></div></div>{session.canOperate && <><div className="insight-note"><Sparkles /><p>{placementContext(selected)}</p></div><Button className="profile-route-button" onClick={() => { const id = selected.id; void recommendRoute(id) }}><Network /> Recommend Outreach Route</Button></>}</section>
            {session.canOperate && <section className="profile-section privacy-section profile-order-permissions"><h3>Contact permissions</h3><p className="section-help">Unknown is not permission. The server checks the overall ceiling and the purpose-specific permission before every send.</p><div className="assessment-grid"><label><span>Overall contact permission</span><Select value={selected.privacy?.generalContactStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { generalContactStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Standard engagement allowed", "Professional engagement only", "Birthday engagement allowed", "No birthday engagement", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Professional outreach</span><Select value={selected.privacy?.professionalEngagementStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { professionalEngagementStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Standard engagement allowed", "Professional engagement only", "No professional engagement", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Birthday outreach</span><Select value={selected.privacy?.birthdayEngagementStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { birthdayEngagementStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Birthday engagement allowed", "No birthday engagement", "Professional engagement only", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Permission source</span><Select value={selected.privacy?.consentSource || "Unknown"} onValueChange={value => void updatePrivacy(selected, { consentSource: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Internal institutional record", "Alumni-confirmed", "Manual PCOM record", "Provider sourced", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label></div><details className="permission-details"><summary>More details</summary><label><span>Permission note</span><Textarea value={privacyNoteDrafts[selected.id] ?? selected.privacy?.notes ?? ""} onChange={event => setPrivacyNoteDrafts(current => ({ ...current, [selected.id]: event.target.value }))} onBlur={event => void updatePrivacy(selected, { notes: event.target.value })} /></label></details></section>}
            {session.canOperate && <section className="profile-section profile-order-engagement"><div className="profile-engagement-heading"><div><h3>Needs attention</h3><small>{selectedUpcomingEngagements.length} open item{selectedUpcomingEngagements.length === 1 ? "" : "s"}</small></div><Button size="sm" variant="ghost" onClick={() => { setEngagementFilter("Needs Action"); changeWorkspaceTab("engagement") }}>Open queue</Button></div>{selectedUpcomingEngagements.length ? <><div className="profile-event-list">{profileOpenEngagementPagination.items.map(event => <button key={event.id} onClick={() => { changeWorkspaceTab("engagement"); void openEngagement(event) }}><span>{event.eventType === "Birthday" ? <Cake /> : <BellRing />}</span><div><strong>{event.eventTitle}</strong><small>{displayEventDate(event.eventDate)} · {event.status}</small></div><ChevronRight /></button>)}</div><PaginationFooter model={profileOpenEngagementPagination} label="Profile open engagement pagination" /></> : <p className="section-help profile-empty-copy">No open engagement items need attention.</p>}<h3 className="history-title">Engagement history</h3><div className="profile-timeline">{profileEngagementHistoryPagination.items.map(event => <div key={event.id}><span>{event.eventType === "Birthday" ? <Cake /> : <MessageSquare />}</span><p><strong>{displayEventDate(event.actionTakenAt || event.eventDate)}</strong>{event.eventTitle}<small>{event.actionType || event.status}{event.actionTakenBy ? ` · by ${event.actionTakenBy}` : ""}</small></p></div>)}{session.canAdminister && providerHistory.filter(item => item.alumnusName === selected.name).slice(0, 3).map(item => { const usage = providerUsageLabel(item); return <div key={`provider-${item.id}`}><span><Cloud /></span><p><strong>{new Date(item.createdAt).toLocaleDateString()}</strong>{item.provider.toUpperCase()} {item.operation}<small>{item.status} · {usage.label}{item.provider === "coresignal" ? ` · ${item.applicationUnits ?? 0} application units` : ""}</small></p></div> })}{!selectedCompletedEngagements.length && (!session.canAdminister || !providerHistory.some(item => item.alumnusName === selected.name)) && <p className="section-help">No completed operational engagement history recorded.</p>}</div>{selectedCompletedEngagements.length > 0 && <PaginationFooter model={profileEngagementHistoryPagination} label="Profile engagement history pagination" />}</section>}
            <section className="profile-section profile-order-verification"><div className="verification-heading"><div><h3>Contact and verification</h3><span className={`operational-status status-${operationalStatus(selected).toLowerCase().replaceAll(" ", "-")}`}>{operationalStatus(selected)}</span></div><small>Last data check: {selected.verified}</small></div><div className="verification-list">
              <div><span>Profile match</span><strong className={verificationTone(selected.verification.profileMatch)}>{selected.verification.profileMatch}</strong></div>
              <div><span>Current company</span><strong className={verificationTone(selected.verification.currentCompany)}>{selected.verification.currentCompany}</strong></div>
              <div><span>Designation</span><strong className={verificationTone(selected.verification.designation)}>{selected.verification.designation}</strong></div>
              <div><span>Email · {selected.email || "Not enriched"}</span><strong className={verificationTone(selected.verification.email)}>{contactDataLabel(selected, "email").status} · {contactDataLabel(selected, "email").detail}</strong></div>
              <div><span>Phone · {selected.phone || "Not enriched"}</span><strong className={verificationTone(selected.verification.phone)}>{contactDataLabel(selected, "phone").status} · {contactDataLabel(selected, "phone").detail}</strong></div>
              <div><span>Location</span><strong className={verificationTone(selected.verification.location)}>{selected.verification.location}</strong></div>
            </div><p className="verified-copy">{session.canViewContacts ? "A stored Verified status reflects the recorded workflow state. Provider-sourced data is identified separately and does not imply independent deliverability or ownership verification." : "Contact values are masked for the Developer role and were never sent to this browser in full."}</p>{session.canOperate && <Button className="verification-review-button" variant="outline" onClick={() => void openProfessionalVerification(selected)}><UserRoundCheck /> Review verification evidence</Button>}<div className="refresh-note"><strong>Last profile refresh</strong><span>{selected.lastProfessionalDataRefresh || selected.lastPdlRefresh ? new Date(selected.lastProfessionalDataRefresh || selected.lastPdlRefresh!).toLocaleString() : "Not refreshed yet"}. Coresignal professional data is staged for review; email and phone remain Lusha-owned.</span></div>{session.canOperate && (() => { const missing = missingLushaChannels(selected); const contactBlocked = selected.privacy?.generalContactStatus === "Do not contact"; return <div className="manual-enrichment"><Button variant="outline" disabled={enriching || providerUsage.coresignal.remaining < 1 || (providerModes.coresignal === "live" && !providerUsage.coresignal.configured)} onClick={() => compareProfessionalProfile(selected)}>Refresh Profile via Coresignal</Button>{providerModes.lusha === "live" ? <><Button variant="outline" title={selected.verification.email === "Verified" ? "A verified email is already stored; no additional email credit is needed." : contactBlocked ? "Contact enrichment is blocked by do-not-contact." : undefined} disabled={selected.verification.email === "Verified" || contactBlocked || enriching || providerUsage.lusha.remaining < 1 || !providerUsage.lusha.configured} onClick={() => prepareLushaReveal(selected, "email")}>Prepare Email Reveal</Button><Button variant="outline" title={selected.verification.phone === "Verified" ? "A verified phone is already stored; no repeat provider call is needed." : contactBlocked ? "Contact enrichment is blocked by do-not-contact." : undefined} disabled={selected.verification.phone === "Verified" || contactBlocked || enriching || providerUsage.lusha.remaining < 1 || !providerUsage.lusha.configured} onClick={() => prepareLushaReveal(selected, "phone")}>Prepare Phone Reveal</Button></> : <><Button variant="outline" title={selected.verification.email === "Verified" ? "A verified email is already stored." : undefined} disabled={selected.verification.email === "Verified" || enriching || providerUsage.lusha.remaining < 1} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["email"])}>Get Email via Lusha</Button><Button variant="outline" title={selected.verification.phone === "Verified" ? "A verified phone is already stored." : undefined} disabled={selected.verification.phone === "Verified" || enriching || providerUsage.lusha.remaining < 5} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["phone"])}>Get Phone via Lusha</Button><Button title={!missing.length ? "Verified email and phone are already stored." : `Only missing or unverified channels will be requested: ${missing.join(" and ")}.`} disabled={!missing.length || enriching || providerUsage.lusha.remaining < (missing.includes("phone") ? 5 : 0) + (missing.includes("email") ? 1 : 0)} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", missing)}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both Contacts</Button></>}</div> })()}</section>
            {session.canOperate && <section className="profile-section profile-order-status"><h3>Update outreach status</h3><Select value={selected.status} onValueChange={value => updateStatus(selected.id, value as OutreachStatus)}><SelectTrigger className="profile-status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><p className="verified-copy">Saved centrally. Last updated by {selected.updatedBy ?? "the committee"}.</p></section>}
          </div></>}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(verificationTarget)} onOpenChange={open => { if (!open && !verificationSaving) closeProfessionalVerification() }}>
        <DialogContent className="verification-review-dialog">
          <DialogHeader>
            <DialogTitle>{verificationStage === "confirm" ? "Verify professional data?" : "Review verification evidence"}</DialogTitle>
            <DialogDescription>{verificationStage === "confirm" ? "Confirm the field-level changes and their evidence. This does not change professional values or call a provider." : "Review stored, provider, and change-history evidence before choosing each field's independent verification state."}</DialogDescription>
          </DialogHeader>
          {verificationLoading && <div className="verification-loading"><LoaderCircle className="spin" /> Loading stored verification evidence…</div>}
          {verificationMessage && <p className="verification-review-message" role="alert">{verificationMessage}</p>}
          {!verificationLoading && verificationTarget && verificationEvidence && verificationDraft && verificationStage === "review" && <div className="verification-review-body">
            <section className="verification-evidence-card">
              <h3>Stored professional record</h3>
              <dl><div><dt>Name</dt><dd>{verificationEvidence.stored.name}</dd></div><div><dt>Current company</dt><dd>{verificationEvidence.stored.company}</dd></div><div><dt>Designation</dt><dd>{verificationEvidence.stored.designation}</dd></div><div><dt>Location</dt><dd>{verificationEvidence.stored.location || "Not recorded"}</dd></div><div><dt>Programme / graduation</dt><dd>{verificationEvidence.stored.programme} · {verificationEvidence.stored.graduationYear || "Year not recorded"}</dd></div><div><dt>Professional profile</dt><dd>{verificationEvidence.stored.professionalProfileUrl ? <a href={verificationEvidence.stored.professionalProfileUrl} target="_blank" rel="noopener noreferrer">Open stored profile <ArrowUpRight /></a> : "Not stored"}</dd></div></dl>
            </section>
            <div className="verification-provider-grid">
              <section className="verification-evidence-card"><h3>Coresignal evidence</h3><p>{verificationEvidence.coresignal.identityAvailable ? "Stable Coresignal employee identity stored." : "No stable Coresignal employee identity stored."}</p><p>Last refresh: {verificationEvidence.coresignal.lastRefresh ? new Date(verificationEvidence.coresignal.lastRefresh).toLocaleString() : "Not refreshed"}</p><p>Provider freshness: {verificationEvidence.coresignal.freshness || "Not reported"}</p><p>Latest location evidence: {verificationEvidence.coresignal.locationEvidence?.newValue || "No distinct location change retained in the latest sanitized review."}</p>{verificationEvidence.coresignal.operation && <p>{verificationEvidence.coresignal.operation.status}: {verificationEvidence.coresignal.operation.responseSummary}</p>}{verificationEvidence.coresignal.review && <><p>Review: {verificationEvidence.coresignal.review.status}{verificationEvidence.coresignal.review.proposedChanges.length ? ` · ${verificationEvidence.coresignal.review.proposedChanges.length} proposed change(s)` : ""}</p>{verificationEvidence.coresignal.review.proposedChanges.length > 0 && <div className="verification-proposed-changes">{verificationEvidence.coresignal.review.proposedChanges.slice(0, 8).map((change, index) => <small key={`${change.field ?? "field"}-${index}`}><strong>{change.label || change.field || "Professional field"}</strong>{change.oldValue || "Empty"} → {change.newValue || "Empty"}</small>)}</div>}</>}</section>
              <section className="verification-evidence-card"><h3>Lusha identity evidence</h3><p>{verificationEvidence.lusha.stableIdentityAvailable ? "Stable Lusha contact identity stored." : "No stable Lusha contact identity stored."}</p>{verificationEvidence.lusha.operation && <p>{verificationEvidence.lusha.operation.operation} · {verificationEvidence.lusha.operation.status}: {verificationEvidence.lusha.operation.responseSummary}</p>}{verificationEvidence.lusha.conflictEvidence && <p className="verification-conflict">{verificationEvidence.lusha.conflictEvidence}</p>}</section>
            </div>
            <section className="verification-evidence-card"><h3>Professional-data review state</h3><p><strong>{verificationEvidence.professionalDataStatus}</strong>{verificationEvidence.professionalDataNote ? ` · ${verificationEvidence.professionalDataNote}` : ""}</p><small>This aggregate state remains separate and will not be changed by field verification.</small></section>
            <section className="verification-field-controls"><h3>Choose field-level states</h3>{(Object.keys(PROFESSIONAL_VERIFICATION_OPTIONS) as ProfessionalVerificationField[]).map(field => <label key={field}><span>{PROFESSIONAL_VERIFICATION_LABELS[field]}</span><Select value={verificationDraft[field]} onValueChange={value => setVerificationDraft(current => current ? { ...current, [field]: value as VerificationState } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PROFESSIONAL_VERIFICATION_OPTIONS[field].map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></label>)}</section>
            <section className="verification-evidence-entry"><label><span>Verification evidence source</span><Select value={verificationEvidenceSource || "not-selected"} onValueChange={value => setVerificationEvidenceSource(value === "not-selected" ? "" : value)}><SelectTrigger><SelectValue placeholder="Choose evidence source" /></SelectTrigger><SelectContent><SelectItem value="not-selected">Choose evidence source</SelectItem>{PROFESSIONAL_VERIFICATION_SOURCES.map(source => <SelectItem key={source} value={source}>{source}</SelectItem>)}</SelectContent></Select></label><label><span>Optional review note{verificationEvidenceSource === "Other documented evidence" ? " (required)" : ""}</span><Textarea value={verificationReviewNote} maxLength={1000} onChange={event => setVerificationReviewNote(event.target.value)} placeholder="Record what was reviewed; do not paste raw provider payloads or secrets." /></label></section>
            <section className="verification-evidence-card"><h3>Recent professional field history</h3>{verificationEvidence.recentChanges.length ? <div className="verification-history">{verificationEvidence.recentChanges.map((change, index) => <div key={`${change.field}-${change.createdAt}-${index}`}><strong>{change.field}</strong><span>{change.oldValue || "Empty"} → {change.newValue || "Empty"}</span><small>{change.source} · {change.reviewedBy} · {new Date(change.createdAt).toLocaleString()}</small></div>)}</div> : <p>No recent professional field changes recorded.</p>}</section>
          </div>}
          {!verificationLoading && verificationTarget && verificationDraft && verificationStage === "confirm" && <div className="verification-confirm-body"><h3>{verificationTarget.name}</h3>{professionalVerificationChanges().map(change => <div key={change.field}><span>{PROFESSIONAL_VERIFICATION_LABELS[change.field]}</span><strong>{change.oldValue} → {change.newValue}</strong></div>)}<div><span>Evidence</span><strong>{verificationEvidenceSource || "Not required for non-positive state"}</strong></div>{verificationReviewNote && <div><span>Review note</span><strong>{verificationReviewNote}</strong></div>}<p>This action records the verifier, server timestamp, evidence source, field-change history, and security audit.</p></div>}
          <DialogFooter>{verificationStage === "confirm" ? <><Button variant="outline" disabled={verificationSaving} onClick={() => setVerificationStage("review")}>Back to evidence</Button><Button disabled={verificationSaving} onClick={() => void saveProfessionalVerification()}>{verificationSaving ? <LoaderCircle className="spin" /> : <UserRoundCheck />} Confirm verification</Button></> : <><Button variant="outline" disabled={verificationSaving} onClick={closeProfessionalVerification}>Cancel</Button><Button disabled={verificationLoading || !verificationEvidence || !professionalVerificationChanges().length} onClick={reviewProfessionalVerification}>Review changes</Button></>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(contactConfirm)} onOpenChange={open => { if (!open) setContactConfirm(null) }}>
        <DialogContent className="refresh-confirm-dialog">
          <DialogHeader><DialogTitle>Confirm contact enrichment</DialogTitle><DialogDescription>Only missing or unverified requested channels will be sent to the mock Lusha workflow. Existing verified channels are preserved.</DialogDescription></DialogHeader>
          {pendingContactPlan && <><div className="refresh-confirm-summary"><div><span>Selected alumni</span><strong>{pendingContactPlan.rows.length}</strong></div><div><span>Email operations</span><strong>{pendingContactPlan.emailOperations}</strong></div><div><span>Phone operations</span><strong>{pendingContactPlan.phoneOperations}</strong></div><div><span>Verified channels skipped</span><strong>{pendingContactPlan.skippedVerified}</strong></div><div><span>Estimated eligible operations</span><strong>{pendingContactPlan.emailOperations + pendingContactPlan.phoneOperations}</strong></div></div><div className="refresh-result-list">{pendingContactPlan.rows.map(row => <article key={row.id}><strong>{row.name}</strong><p>Email: {row.states.email === "verified" ? "Already verified — will be skipped" : row.eligible.includes("email") ? `${row.states.email} — will be retrieved via Lusha` : "Not requested"}</p><p>Phone: {row.states.phone === "verified" ? "Already verified — will be skipped" : row.eligible.includes("phone") ? `${row.states.phone} — will be retrieved via Lusha` : "Not requested"}</p></article>)}</div></>}
          <DialogFooter><Button variant="outline" onClick={() => setContactConfirm(null)}>Cancel</Button><Button disabled={enriching || !contactConfirm || !pendingContactPlan || (!pendingContactPlan.emailOperations && !pendingContactPlan.phoneOperations)} onClick={() => contactConfirm && void executeEnrichment(contactConfirm.ids, ["lusha"], contactConfirm.operation, contactConfirm.channels)}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Confirm eligible channels</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signalsConfirmOpen} onOpenChange={setSignalsConfirmOpen}>
        <DialogContent className="signals-confirm-dialog">
          <DialogHeader><DialogTitle>Check Professional Signals?</DialogTitle><DialogDescription>Confirm this one-contact, potentially credit-consuming Lusha request. Opening this review does not call the provider.</DialogDescription></DialogHeader>
          <div className="refresh-confirm-summary"><div><span>Provider</span><strong>Lusha Professional Signals — LIVE</strong></div><div><span>Alumnus</span><strong>{signalsTarget?.name ?? "Approved alumnus unavailable"}</strong></div><div><span>Identity</span><strong>Existing stable Lusha contact ID</strong></div><div><span>Scope</span><strong>Promotion; Company/job change</strong></div><div><span>Excluded</span><strong>Company hiring, news, intent, job listings, and other company-level signals</strong></div><div><span>Date window</span><strong>{signalsStatus?.startDate ?? "Unavailable"} to today</strong></div><div><span>Expected usage</span><strong>Actual provider usage comes from V3 billing.creditsCharged</strong></div><div><span>Safety</span><strong>Human review only; no automatic profile update</strong></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setSignalsConfirmOpen(false)}>Cancel — No Provider Call</Button><Button disabled={signalsRunning || !signalsTarget || !signalsStatus?.liveEnabled || signalsStatus.entitlement !== "confirmed"} onClick={() => void runOneContactSignalsCheck()}>{signalsRunning ? <LoaderCircle className="spin" /> : <Sparkles />} Confirm One-Contact Signals Test</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedEngagement)} onOpenChange={open => { if (!open) closeEngagement() }}>
        <DialogContent className="engagement-dialog">
          {selectedEngagement && <>
            <DialogHeader><DialogTitle>{selectedEngagement.eventTitle}</DialogTitle><DialogDescription>{selectedEngagement.alumnus?.name} · {selectedEngagement.alumnus?.company} · {selectedEngagement.eventType}</DialogDescription></DialogHeader>
            <div className="engagement-dialog-scroll">
              <section className="event-detail-summary"><div className={`event-icon event-${selectedEngagement.eventType.toLowerCase().replaceAll(" ", "-")}`}>{selectedEngagement.eventType === "Birthday" ? <Cake /> : <ArrowUpRight />}</div><div><p>{selectedEngagement.eventDescription}</p><span>{displayEventDate(selectedEngagement.eventDate)} · Source: {selectedEngagement.source}</span>{selectedEngagement.eventType === "Professional Signal" && <small>{selectedEngagement.previousRole || selectedEngagement.previousCompany ? `${selectedEngagement.previousRole || "Role unavailable"} at ${selectedEngagement.previousCompany || "company unavailable"}` : "Previous role/company unavailable"} → {selectedEngagement.newRole || selectedEngagement.newCompany ? `${selectedEngagement.newRole || "Role unavailable"} at ${selectedEngagement.newCompany || "company unavailable"}` : "New role/company unavailable"} · Provider event: {selectedEngagement.providerEventAt || "not reported"} · Confidence: {selectedEngagement.sourceConfidence || "unknown"}</small>}</div><EngagementStatusBadge status={selectedEngagement.status} /></section>
              {selectedEngagement.actionTakenBy && <div className="already-engaged"><CheckCircle2 /><div><strong>Action already taken</strong><span>{selectedEngagement.actionType} by {selectedEngagement.actionTakenBy} on {new Date(selectedEngagement.actionTakenAt).toLocaleString()} · {selectedEngagement.deliveryStatus}</span></div></div>}
              {selectedEngagement.assignedTo && <div className="assignment-note"><UserRoundCheck /><span>Assigned to <strong>{selectedEngagement.owner?.displayName ?? selectedEngagement.assignedTo}</strong>{selectedEngagement.assignedAt ? ` since ${new Date(selectedEngagement.assignedAt).toLocaleString()}` : ""}{selectedEngagement.owner?.userId ? <small>Internal user ID {selectedEngagement.owner.userId}</small> : null}</span></div>}

              {!['Action Taken', 'Response Received', 'Closed', 'Skipped'].includes(selectedEngagement.status) && <section className="dialog-action-section"><h3>Review and action</h3><div className="dialog-actions">
                <label className="engagement-owner-control"><span>Responsible owner</span><Select value={String(selectedEngagement.owner?.userId ?? "")} onValueChange={value => void postEngagement("assign_to", selectedEngagement.id, { assigneeId: Number(value) })}><SelectTrigger aria-label="Responsible owner"><SelectValue placeholder="Unassigned" /></SelectTrigger><SelectContent>{engagementAssignees.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select><small>Saved centrally and visible after reload.</small></label>
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("acknowledge", selectedEngagement.id)}>Acknowledge</Button>
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("assign", selectedEngagement.id, { force: Boolean(selectedEngagement.assignedTo && (selectedEngagement.owner?.displayName ?? selectedEngagement.assignedTo) !== currentDemoUser) })}>{selectedEngagement.assignedTo && (selectedEngagement.owner?.displayName ?? selectedEngagement.assignedTo) !== currentDemoUser ? "Reassign to Me" : "Take Ownership"}</Button>
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("plan", selectedEngagement.id, { notes: "Follow-up action planned by the assigned committee member.", force: Boolean(selectedEngagement.assignedTo && (selectedEngagement.owner?.displayName ?? selectedEngagement.assignedTo) !== currentDemoUser) })}>Plan Action</Button>
                {selectedEngagement.alumnus?.email ? <Button disabled={selectedEngagementBusy} onClick={() => void previewEngagement(selectedEngagement)}><Mail /> {selectedEngagement.eventType === "Birthday" ? "Preview Birthday Wish" : "Preview Congratulations"}</Button> : <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void getBirthdayEmail(selectedEngagement)}>Get Email via Lusha</Button>}
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("manual_action", selectedEngagement.id, { notes: "Engagement completed outside the platform." })}>Mark Action Taken</Button>
              </div></section>}

              <section className="dialog-action-section"><h3>Response and follow-up</h3><div className="response-form"><Select value={responseType} onValueChange={setResponseType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Positive", "Neutral", "Negative", "Introduction offered", "Meeting requested", "Other"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Input value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} type="date" aria-label="Follow-up date" /><Textarea value={responseNotes} onChange={event => setResponseNotes(event.target.value)} placeholder="Response or follow-up notes" /><div><Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("response", selectedEngagement.id, { responseType, notes: responseNotes, followUpRequired: Boolean(followUpDate), followUpDate })}>Record Response</Button><Button variant="outline" disabled={!followUpDate || selectedEngagementBusy} title={!followUpDate ? "Choose a follow-up date first." : undefined} onClick={() => void postEngagement("follow_up", selectedEngagement.id, { followUpDate })}>Add Follow-up</Button></div></div></section>

              {selectedEngagement.eventType === "Birthday" && <section className="dialog-action-section"><h3>Birthday data</h3><div className="birthday-data-row"><div><span>Birthday</span><strong>{selectedEngagement.birthday?.birthMonthDay || "Unknown"}</strong></div><div><span>Source</span><strong>{selectedEngagement.birthday?.source || "Not recorded"}</strong></div><div><span>Status</span><strong>{selectedEngagement.birthday?.status || "Unknown"}</strong></div></div><div className="birthday-correction"><Input value={birthdayCorrection} onChange={event => setBirthdayCorrection(event.target.value)} placeholder="MM-DD" aria-label="Correct birthday as MM-DD" /><Button variant="outline" onClick={() => void postEngagement("correct_birthday", selectedEngagement.id, { birthMonthDay: birthdayCorrection })}>Confirm Correction</Button></div></section>}

              <section className="dialog-action-section"><h3>Event activity</h3><div className="activity-timeline">{eventActivityPagination.items.map(item => <div key={item.id}><span>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><p><strong>{item.action.replaceAll("_", " ")}</strong>{item.details}<small>{item.actor} · {new Date(item.createdAt).toLocaleDateString()}</small></p></div>)}{!selectedEngagement.activity.length && <p className="section-help">No activity has been recorded yet.</p>}</div>{selectedEngagement.activity.length > 0 && <PaginationFooter model={eventActivityPagination} label="Event activity pagination" />}</section>

              {!['Closed', 'Skipped'].includes(selectedEngagement.status) && <section className="danger-actions"><Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("skip", selectedEngagement.id, { reason: "Not relevant" })}><Ban /> Skip</Button>{selectedEngagement.eventType === "Professional Signal" && <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("incorrect", selectedEngagement.id, { reason: "Provider signal requires correction" })}><XCircle /> Mark Signal Incorrect</Button>}<Button variant="ghost" disabled={selectedEngagementBusy} onClick={() => void postEngagement("close", selectedEngagement.id)}>Close Event</Button></section>}
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(controlledEmailIntent || mailPreview)}>
        <DialogContent className="mail-dialog" onClose={() => { if (controlledEmailIntent) cancelControlledEmailDraft(); else setMailPreview(null) }}>
          {controlledEmailIntent && !mailPreview && composeState.status !== "error" && <><DialogHeader><DialogTitle>Preparing email draft</DialogTitle><DialogDescription>Loading the selected alumnus and eligible stored recipient. No email is sent while this draft opens.</DialogDescription></DialogHeader><div className="empty-state"><LoaderCircle className="spin" /><h3>Loading composer for alumnus {controlledEmailIntent.alumnusId}</h3></div><DialogFooter><Button variant="outline" onClick={cancelControlledEmailDraft}>Cancel</Button></DialogFooter></>}
          {controlledEmailIntent && !mailPreview && composeState.status === "error" && <><DialogHeader><DialogTitle>Unable to prepare this email draft.</DialogTitle><DialogDescription>{composeState.message} No email was sent.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setComposeRetry(value => value + 1)}>Retry</Button><Button onClick={cancelControlledEmailDraft}>Cancel</Button></DialogFooter></>}
          {mailPreview && <><DialogHeader><DialogTitle>Review email before sending</DialogTitle><DialogDescription>No message is sent until you approve it. {mailMode === "mock" ? "This demonstration uses the mock mail service." : "This message will use the approved institute mail service."}</DialogDescription></DialogHeader>
            <div className="mail-form"><label><span>Recipient</span><Input value={mailPreview.recipient} readOnly /></label><label><span>Approved template</span><Select value={String(mailPreview.templateId)} onValueChange={value => switchMailTemplate(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{messageTemplates.filter(item => item.eventType === mailPreview.event.eventType).map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></label><label><span>Subject</span><Input value={mailPreview.subject} onChange={event => setMailPreview({ ...mailPreview, subject: event.target.value })} /></label><label><span>Message</span><Textarea value={mailPreview.body} onChange={event => setMailPreview({ ...mailPreview, body: event.target.value })} rows={9} /></label></div>
            <DialogFooter><Button variant="outline" onClick={() => { if (controlledEmailIntent) cancelControlledEmailDraft(); else setMailPreview(null) }}>Cancel</Button><Button disabled={engagementLoading || !mailPreview.subject.trim() || !mailPreview.body.trim()} onClick={() => setMailSendConfirmOpen(true)}><Eye /> Continue to Final Confirmation</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={mailSendConfirmOpen} onOpenChange={setMailSendConfirmOpen}>
        <DialogContent className="mail-dialog">
          {mailPreview && <><DialogHeader><DialogTitle>Final email confirmation</DialogTitle><DialogDescription>Opening this confirmation makes zero mail calls. Sending occurs only after the explicit final approval below.</DialogDescription></DialogHeader>
            <div className="refresh-confirm-summary"><div><span>From</span><strong>{mailPreview.readiness.sender}</strong></div><div><span>To</span><strong>{mailPreview.recipient}</strong></div><div><span>Subject</span><strong>{mailPreview.subject}</strong></div><div><span>Purpose / event</span><strong>{mailPreview.readiness.purpose} · {mailPreview.event.eventTitle}</strong></div><div><span>Communication status</span><strong>{mailPreview.readiness.communicationStatus}</strong></div><div><span>Duplicate-send status</span><strong>{mailPreview.readiness.duplicateStatus}</strong></div><div><span>Mail provider</span><strong>{mailPreview.readiness.provider}</strong></div><div><span>Mode</span><strong>{mailPreview.readiness.mode.toUpperCase()}</strong></div></div>
            <DialogFooter><Button variant="outline" onClick={() => setMailSendConfirmOpen(false)}>Back to Draft</Button><Button disabled={engagementLoading} onClick={() => void sendMailPreview()}>{engagementLoading ? <LoaderCircle className="spin" /> : <Send />} Approve and Send One Email</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bulkPreview)} onOpenChange={open => { if (!open) setBulkPreview(null) }}>
        <DialogContent className="bulk-dialog">
          {bulkPreview && <><DialogHeader><DialogTitle>Review selected birthday emails</DialogTitle><DialogDescription>Duplicate, preference, birthday-confidence, and email checks run again before sending.</DialogDescription></DialogHeader>
            <div className="bulk-review-summary"><span>Selected<strong>{bulkPreview.ready.length + bulkPreview.excluded.length}</strong></span><span>Ready<strong>{bulkPreview.ready.length}</strong></span><span>Excluded<strong>{bulkPreview.excluded.length}</strong></span></div>
            <div className="bulk-review-list">{bulkPreview.ready.map(item => <div key={item.eventId}><CheckCircle2 /><p><strong>{item.alumnusName}</strong><span>{item.recipient} · {item.subject}</span></p><em>Ready</em></div>)}{bulkPreview.excluded.map(item => <div key={item.eventId} className="excluded"><XCircle /><p><strong>{item.alumnusName}</strong><span>{item.reason}</span></p><em>Excluded</em></div>)}</div>
            <DialogFooter><Button variant="outline" onClick={() => setBulkPreview(null)}>Back</Button><Button disabled={!bulkPreview.ready.length || engagementLoading} onClick={() => void sendSelectedBirthdays()}><Send /> Approve & Send {bulkPreview.ready.length}</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(routeRecommendation)} onOpenChange={open => { if (!open) setRouteRecommendation(null) }}>
        <DialogContent className="route-dialog">
          {routeRecommendation && <><DialogHeader><DialogTitle>Recommended outreach route</DialogTitle><DialogDescription>Target: {routeRecommendation.target.name} · {routeRecommendation.target.title}</DialogDescription></DialogHeader>
            <div className={`route-result route-result-${routeRecommendation.routeType.toLowerCase().replaceAll(" ", "-")}`}><span>{routeRecommendation.routeType}</span><h3>{routeRecommendation.routeType === "Warm" ? `Via ${routeRecommendation.intermediary?.name}` : routeRecommendation.routeType === "Direct" ? `Contact ${routeRecommendation.target.name} directly` : "Profile enrichment or relationship evidence required"}</h3><p>{routeRecommendation.rationale}</p></div>
            <div className={`route-flow route-dialog-flow route-flow-${routeRecommendation.routeType.toLowerCase().replaceAll(" ", "-")}`}><div className="route-node active"><span>PC</span><p><strong>Placement Committee</strong><small>Starts outreach</small></p></div>{routeRecommendation.intermediary && <><div className="route-link"><span>Warm introduction</span><ChevronRight /></div><div className="route-node"><span>{routeRecommendation.intermediary.initials}</span><p><strong>{routeRecommendation.intermediary.name}</strong><small>Confirmed introducer</small></p></div></>}<div className="route-link"><span>{routeRecommendation.routeType === "Direct" ? "Direct outreach" : routeRecommendation.routeType === "Warm" ? "Introduction" : "No eligible route"}</span><ChevronRight /></div><div className="route-node"><span>{routeRecommendation.target.initials}</span><p><strong>{routeRecommendation.target.name}</strong><small>Target alumnus</small></p></div></div>
            <div className="route-evidence"><strong>Why this route?</strong><dl><div><dt>Relationship evidence</dt><dd>{routeRecommendation.evidence}</dd></div><div><dt>Direct contact</dt><dd>{routeRecommendation.factors.usableContact ? routeRecommendation.factors.verifiedContact ? "Verified contact available" : "Stored contact; verification incomplete" : "Not available"}</dd></div>{routeRecommendation.intermediary && <div><dt>Introducer</dt><dd>{routeRecommendation.intermediary.name} · {routeRecommendation.factors.relationshipType || "Confirmed relationship"}</dd></div>}<div><dt>Profile data</dt><dd>{routeRecommendation.factors.reliableProfile ? "Sufficiently verified" : "Needs review"}</dd></div></dl></div>
            <DialogFooter><Button variant="outline" onClick={() => setRouteRecommendation(null)}>Close</Button>{routeRecommendation.intermediary && <Button variant="outline" onClick={() => { const person = alumni.find(item => item.id === routeRecommendation.intermediary?.id); setRouteRecommendation(null); if (person) openAlumnusProfile(person) }}>View {routeRecommendation.intermediary.name}&apos;s profile</Button>}<Button onClick={() => { const person = alumni.find(item => item.id === routeRecommendation.target.id); setRouteRecommendation(null); if (person) openAlumnusProfile(person) }}>View {routeRecommendation.target.name}&apos;s profile</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ignoreResult)} onOpenChange={open => { if (!open) setIgnoreResult(null) }}>
        <DialogContent className="ignore-dialog"><DialogHeader><DialogTitle>Ignore external result?</DialogTitle><DialogDescription>This decision will be shared so another committee member does not repeatedly review the same profile.</DialogDescription></DialogHeader><label className="dialog-field"><span>Reason</span><Select value={ignoreReason} onValueChange={setIgnoreReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Wrong person", "Not IIML alumnus", "Duplicate already handled", "Irrelevant", "Data appears incorrect", "Other"].map(reason => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}</SelectContent></Select></label><DialogFooter><Button variant="outline" onClick={() => setIgnoreResult(null)}>Cancel</Button><Button onClick={() => ignoreResult && void ignoreDiscoveryResult(ignoreResult.id, ignoreReason)}>Ignore Result</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="manual-dialog"><DialogHeader><DialogTitle>{manualSaved ? "Alumnus added" : "Add alumnus manually"}</DialogTitle><DialogDescription>{manualSaved ? `The record is now in ${appConfig.name}. Provider actions remain optional.` : MANUAL_ALUMNUS_REQUIRED_COPY}</DialogDescription></DialogHeader>
          {manualSaved ? <div className="manual-success"><CheckCircle2 /><div><h3>{manualSaved.name}</h3><p>{manualSaved.title} · {manualSaved.company}</p><span>Source: Manual entry · Contact details are manually supplied and not provider verified.</span></div><div className="manual-success-actions"><Button variant="outline" onClick={() => { setSelectedForEnrichment([manualSaved.id]); setManualOpen(false); setRefreshConfirmOpen(true) }}>Refresh Profile via Coresignal</Button>{providerModes.lusha === "live" ? <><Button variant="outline" onClick={() => { setManualOpen(false); prepareLushaReveal(manualSaved, "email") }}>Prepare Email Reveal</Button><Button variant="outline" onClick={() => { setManualOpen(false); prepareLushaReveal(manualSaved, "phone") }}>Prepare Phone Reveal</Button></> : <><Button variant="outline" onClick={() => void runEnrichment([manualSaved.id], ["lusha"], "manual", ["email"])}>Get Email via Lusha</Button><Button variant="outline" onClick={() => void runEnrichment([manualSaved.id], ["lusha"], "manual", ["phone"])}>Get Phone via Lusha</Button></>}</div></div> : <div className="manual-form">
            <h3>Identity</h3><div className="manual-grid"><label><span>Name <b aria-hidden="true">*</b></span><Input required aria-required="true" aria-invalid={Boolean(manualValidation.errors.name)} aria-describedby={manualValidation.errors.name ? "manual-name-error" : undefined} value={manualForm.name} onChange={event => updateManualField("name", event.target.value)} />{manualValidation.errors.name && <small id="manual-name-error" className="field-error">{manualValidation.errors.name}</small>}</label><label><span>Programme</span><Select value={manualForm.programme} onValueChange={value => updateManualField("programme", value)}><SelectTrigger><SelectValue placeholder="Select programme" /></SelectTrigger><SelectContent>{activeProgrammeChoices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label><label><span>Graduation year / batch</span><Input type="number" min="1980" max="2100" value={manualForm.batch} onChange={event => updateManualField("batch", event.target.value)} /></label></div>
            <h3>Professional</h3><div className="manual-grid"><label><span>Current company</span><Input aria-describedby="manual-identity-requirement" value={manualForm.company} onChange={event => updateManualField("company", event.target.value)} /></label><label><span>Role / designation</span><Input value={manualForm.title} onChange={event => updateManualField("title", event.target.value)} /></label><label><span>Function</span><Select value={manualForm.function} onValueChange={value => updateManualField("function", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Not assessed">Not assessed</SelectItem>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Seniority</span><Select value={manualForm.seniority} onValueChange={value => updateManualField("seniority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Not assessed">Not assessed</SelectItem>{seniorityFilterOptions.filter(item => !item.endsWith("+")).map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Location</span><Input value={manualForm.location} onChange={event => updateManualField("location", event.target.value)} /></label><label><span>Professional profile URL</span><Input aria-invalid={Boolean(manualValidation.errors.linkedinUrl)} aria-describedby="manual-identity-requirement" value={manualForm.linkedinUrl} onChange={event => updateManualField("linkedinUrl", event.target.value)} />{manualValidation.errors.linkedinUrl && <small className="field-error">{manualValidation.errors.linkedinUrl}</small>}</label></div>
            <div className="manual-identity-requirement" id="manual-identity-requirement" role="note"><strong>Required identity evidence *</strong><span>Provide an email, a professional-profile URL, or both current company and graduation year.</span>{manualValidation.errors.identity && <small className="field-error">{manualValidation.errors.identity}</small>}</div>
            <h3>Contact and relationship</h3><div className="manual-grid"><label><span>Email</span><Input type="email" aria-invalid={Boolean(manualValidation.errors.email)} aria-describedby="manual-identity-requirement" value={manualForm.email} onChange={event => updateManualField("email", event.target.value)} />{manualValidation.errors.email && <small className="field-error">{manualValidation.errors.email}</small>}</label><label><span>Phone</span><Input value={manualForm.phone} onChange={event => updateManualField("phone", event.target.value)} /></label><label><span>IIML relationship <TooltipProvider><Tooltip><TooltipTrigger asChild><button type="button" className="inline-help" aria-label="About IIML relationship"><Info /></button></TooltipTrigger><TooltipContent>Captures Placement Committee and alumni relationship context.</TooltipContent></Tooltip></TooltipProvider></span><Select value={manualForm.relationship} onValueChange={value => updateManualField("relationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label><label><span>Outreach status</span><Select value={manualForm.status} onValueChange={value => updateManualField("status", value as OutreachStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label></div><label><span>Notes</span><Textarea value={manualForm.note} onChange={event => updateManualField("note", event.target.value)} /></label>
            {manualMessage && <div className="manual-message">{manualMessage}</div>}
            {manualMatches.length > 0 && <div className="manual-matches"><strong>{manualMatches.some(match => match.exact) ? "Existing alumnus found" : "Possible existing alumnus"}</strong>{manualMatches.map(match => <div key={match.id}><span className="avatar small">{match.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><p><strong>{match.name}</strong><small>{match.programme} {match.batch || ""} · {match.company} · {match.title}</small><em>Matched by {match.reasons.join(" and ")}</em></p><Button variant="outline" size="sm" onClick={() => { setManualOpen(false); openAlumnusProfile(alumni.find(item => item.id === match.id)!) }}>Compare</Button><Button size="sm" onClick={() => { setManualOpen(false); openAlumnusProfile(alumni.find(item => item.id === match.id)!) }}>Use Existing</Button></div>)}</div>}
          </div>}
          <DialogFooter>{manualSaved ? <><Button variant="outline" onClick={() => setManualOpen(false)}>Close</Button><Button onClick={() => { setManualOpen(false); openAlumnusProfile(manualSaved) }}>Open Profile</Button></> : <><Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>{manualMatches.length > 0 && !manualMatches.some(match => match.exact) && <Button variant="outline" disabled={!manualValidation.valid || manualLoading} onClick={() => void saveManualAlumnus(true)}>Different person · Continue</Button>}<TooltipProvider><Tooltip><TooltipTrigger asChild><Button disabled={manualLoading || !manualValidation.valid} onClick={() => void checkManualAlumnus()}>{manualLoading ? <LoaderCircle className="spin" /> : <Search />} Check & Add Alumnus</Button></TooltipTrigger><TooltipContent>{manualValidation.valid ? "Checks the internal alumni database for possible duplicates before adding this record. No Coresignal or Lusha call is made." : MANUAL_ALUMNUS_REQUIRED_COPY}</TooltipContent></Tooltip></TooltipProvider></>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lushaTarget) && !lushaRevealConfirmOpen} onOpenChange={open => { if (!open && !lushaRevealConfirmOpen) { setLushaTarget(null); setLushaPreview(null) } }}>
        <DialogContent className="refresh-confirm-dialog">
          {lushaTarget && !lushaPreview && <><DialogHeader><DialogTitle>Check Lusha contact availability?</DialogTitle><DialogDescription>This first V3 step searches for a stable Lusha contact ID and availability flags. It does not reveal an email or phone.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Alumnus</span><strong>{lushaTarget.name}</strong></div><div><span>Preferred identifier</span><strong>{normalizeProfessionalProfileUrl(lushaTarget.linkedinUrl) ? "Professional profile URL" : "Name and current company"}</strong></div><div><span>Requested contact data</span><strong>Availability preview only</strong></div><div><span>Application capacity</span><strong>{providerUsage.lusha.remaining} credits remaining</strong></div></div><div className="credit-notice"><Activity /><span>Lusha V3 Search may incur request/result usage under your account plan. The app will record usage reported by Lusha; this application limit is not the Lusha account balance. No email or phone is revealed in this step.</span></div>{enrichmentMessage && <div className="enrichment-message"><Activity /> <span>{enrichmentMessage}</span></div>}<DialogFooter><Button variant="outline" onClick={() => setLushaTarget(null)}>Cancel</Button><Button disabled={enriching || providerUsage.lusha.remaining < 1 || !providerUsage.lusha.configured} onClick={() => void searchLushaContactPreview()}>{enriching ? <LoaderCircle className="spin" /> : <Search />} Confirm Contact Search</Button></DialogFooter></>}
          {lushaTarget && lushaPreview && <><DialogHeader><DialogTitle>Lusha contact preview</DialogTitle><DialogDescription>{lushaPreview.resumedFromStoredContact ? "Resume from the previously completed contact match without running another Lusha Search." : `Review the non-contact match before deciding whether to reveal a ${lushaRevealChannel}.`}</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Internal alumnus</span><strong>{lushaTarget.name}</strong></div><div><span>Lusha match</span><strong>{lushaPreview.fullName || "No match returned"}</strong></div><div><span>Role</span><strong>{lushaPreview.resumedFromStoredContact ? "Previously reviewed match" : [lushaPreview.jobTitle, lushaPreview.company].filter(Boolean).join(" · ") || "Not reported"}</strong></div><div><span>Email availability</span><strong>{lushaPreview.resumedFromStoredContact ? lushaPreview.emailAvailable === true ? "Available in the completed preview" : lushaPreview.emailAvailable === false ? "Not available in the completed preview" : "Previously checked · not re-queried" : lushaPreview.emailAvailable === null ? "Not reported" : lushaPreview.emailAvailable ? "Available to reveal" : "Not available"}</strong></div><div><span>Phone availability</span><strong>{lushaPreview.resumedFromStoredContact ? lushaPreview.phoneAvailable === true ? "Available in the completed preview" : lushaPreview.phoneAvailable === false ? "Not available in the completed preview" : "Previously checked · availability not retained" : lushaPreview.phoneAvailable === null ? "Not reported" : lushaPreview.phoneAvailable ? "Available to reveal" : "Not available"}</strong></div><div><span>Search usage</span><strong>{lushaPreview.resumedFromStoredContact ? "Previously completed · 0 new Search calls" : lushaPreview.creditsUsed === null ? "Not returned · reconcile account usage" : `${lushaPreview.creditsUsed} credit${lushaPreview.creditsUsed === 1 ? "" : "s"} reported`}</strong></div></div><div className="credit-notice"><Activity /><span>{lushaPreview.resumedFromStoredContact ? `Corporate Network will reuse the saved stable Lusha contact ID. Continuing does not repeat Contact Search; only the separately confirmed ${lushaRevealChannel} reveal can reach Lusha.` : `${lushaRevealChannel === "email" ? "Email" : "Phone"} reveal is a separate live provider call and may include request/result usage plus the selected field. The actual charge is not hard-coded. Combined and bulk reveal remain disabled.`}</span></div><DialogFooter><Button variant="outline" onClick={() => { setLushaTarget(null); setLushaPreview(null) }}>Close</Button><Button disabled={lushaPreview.status !== "success" || (lushaRevealChannel === "email" ? lushaPreview.emailAvailable === false : lushaPreview.phoneAvailable === false) || enriching} onClick={() => setLushaRevealConfirmOpen(true)}>{lushaRevealChannel === "email" ? <Mail /> : <ContactRound />} Continue to {lushaRevealChannel === "email" ? "Email" : "Phone"} Reveal</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={lushaRevealConfirmOpen} onOpenChange={setLushaRevealConfirmOpen}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Reveal {lushaRevealChannel} through Lusha?</DialogTitle><DialogDescription>This is the final human confirmation before a live {lushaRevealChannel}-only contact reveal.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Alumnus</span><strong>{lushaTarget?.name ?? "Not selected"}</strong></div><div><span>Lusha contact</span><strong>{lushaPreview?.fullName || "Stable contact ID matched"}</strong></div><div><span>Requested field</span><strong>{lushaRevealChannel === "email" ? "Email" : "Phone"} only</strong></div><div><span>{lushaRevealChannel === "email" ? "Phone" : "Email"}</span><strong>Not requested</strong></div></div><div className="credit-notice"><Activity /><span>This live call may consume request/result usage plus {lushaRevealChannel} reveal usage. Corporate Network records provider-reported actual usage; if Lusha omits per-call metadata, the history will require reconciliation against the Lusha account usage view.</span></div><DialogFooter><Button variant="outline" onClick={() => setLushaRevealConfirmOpen(false)}>Cancel</Button><Button disabled={enriching || !lushaPreview?.contactId || (lushaRevealChannel === "email" ? lushaPreview.emailAvailable === false : lushaPreview.phoneAvailable === false)} onClick={() => void (lushaRevealChannel === "email" ? revealLushaEmail() : revealLushaPhone())}>{enriching ? <LoaderCircle className="spin" /> : lushaRevealChannel === "email" ? <Mail /> : <ContactRound />} Confirm {lushaRevealChannel === "email" ? "Email" : "Phone"}-Only Reveal</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDiscoveryFilters)} onOpenChange={open => { if (!open) setPendingDiscoveryFilters(null) }}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Run live Coresignal employee search?</DialogTitle><DialogDescription>Confirm this controlled search before it reaches Coresignal. Provider filters reduce irrelevant Collect calls; Corporate Network independently validates the collected IIML education record before a candidate can be added.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Provider</span><strong>Coresignal — LIVE</strong></div><div><span>Education</span><strong>{FIXED_ALUMNI_SCHOOL}</strong></div><div><span>Alumni status</span><strong>{pendingDiscoveryFilters?.alumniStatus ?? "Past alumni only"}</strong></div><div><span>IIML programmes to discover</span><strong>{pendingDiscoveryFilters?.discoveryProgrammes.join(", ") || "None selected"}</strong></div><div><span>Company</span><strong>{pendingDiscoveryFilters?.company || "Any company"}</strong></div><div><span>Role</span><strong>{pendingDiscoveryFilters?.role || "Any role"}</strong></div><div><span>Function</span><strong>{pendingDiscoveryFilters?.function ?? "All functions"}</strong></div><div><span>Seniority</span><strong>{pendingDiscoveryFilters ? discoverySenioritySummary(pendingDiscoveryFilters) : "All levels"}</strong></div><div><span>Location</span><strong>{pendingDiscoveryFilters?.location || "Any location"}</strong></div><div><span>Graduation year</span><strong>{pendingDiscoveryFilters?.graduationYear || "Any year"}</strong></div><div><span>Profiles requested</span><strong>{discoveryLimit}</strong></div><div><span>Application units remaining</span><strong>{providerUsage.coresignal.remaining}</strong></div><div><span>Maximum application usage</span><strong>{discoveryMaximumApplicationUsage}</strong></div></div><div className="credit-notice"><Activity /><span>Maximum usage includes one Search operation plus up to one Collect operation per requested profile. Application usage and provider-account usage are recorded separately. Unknown provider usage is never presented as zero. Results remain review-only and are never added automatically.</span></div><DialogFooter><Button variant="outline" onClick={() => setPendingDiscoveryFilters(null)}>Cancel</Button><Button disabled={discovering || !pendingDiscoveryFilters || !pendingDiscoveryFilters.discoveryProgrammes.length || !discoveryCountValidation.ok} onClick={() => pendingDiscoveryFilters && void runDiscovery(pendingDiscoveryFilters)}>{discovering ? <LoaderCircle className="spin" /> : <Search />} Confirm Live Search</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingRegularSearchFilters && regularSearchPreparation)} onOpenChange={open => { if (!open) { setPendingRegularSearchFilters(null); setRegularSearchPreparation(null) } }}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Run one Coresignal Base Employee ES-DSL Search?</DialogTitle><DialogDescription>Server-side preparation verified this ID-only Search contract without calling Coresignal. Live execution remains independently gated.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Provider</span><strong>{regularSearchStatus.enabled ? "Coresignal — LIVE gate enabled" : "Coresignal — preflight only; LIVE gate disabled"}</strong></div><div><span>Operation</span><strong>{regularSearchPreparation?.operation}</strong></div><div><span>Search mode</span><strong>{regularSearchPreparation?.searchMode.replaceAll("_", " ")}</strong></div><div><span>Institution</span><strong>{regularSearchPreparation?.institution}</strong></div><div><span>Graduation year</span><strong>{regularSearchPreparation?.graduationYear}</strong></div><div><span>Company</span><strong>{regularSearchPreparation?.company}</strong></div><div><span>Company mapping</span><strong>{regularSearchPreparation?.companyMapping}</strong></div><div><span>Programme</span><strong>Not constrained</strong></div><div><span>Seniority</span><strong>{regularSearchPreparation?.seniority}</strong></div><div><span>Page size / result bound</span><strong>{regularSearchPreparation?.pageSize}</strong></div><div><span>Maximum Search requests</span><strong>{regularSearchPreparation?.maximumSearchRequests}</strong></div><div><span>Automatic pagination</span><strong>{regularSearchPreparation?.automaticPagination ? "On" : "Off"}</strong></div><div><span>Automatic Collect</span><strong>{regularSearchPreparation?.automaticCollect ? "On" : "Off"}</strong></div><div><span>Automatic canonical update</span><strong>{regularSearchPreparation?.automaticCanonicalUpdate ? "On" : "Off"}</strong></div></div><div className="credit-notice"><Activity /><span>{regularSearchStatus.enabled ? "A confirmed Search may consume provider usage." : "Live Search is unavailable because the server gate is disabled. Preparation and cancellation consume no provider usage."} No downstream provider action is automatic. Returned Employee IDs are routed against stored identities only. Search matches are not verified alumni or fresh profiles. Unknown IDs remain unresolved; no alumnus is created, no identity is attached, freshness is not evaluated, and no profile field is changed.</span></div><DialogFooter><Button variant="outline" onClick={() => { setPendingRegularSearchFilters(null); setRegularSearchPreparation(null) }}>Cancel — No Provider Call</Button><Button title={!regularSearchStatus.enabled ? "Live Search is unavailable while CORESIGNAL_SEARCH_ENABLED is off." : !regularSearchStatus.configured ? "Live Search requires configured server-side Coresignal authentication." : undefined} disabled={discovering || !pendingRegularSearchFilters || !regularSearchStatus.enabled || !regularSearchStatus.configured || Boolean(pendingRegularSearchFilters.graduationYear && !/^\d{4}$/.test(pendingRegularSearchFilters.graduationYear))} onClick={() => pendingRegularSearchFilters && void runRegularSearch(pendingRegularSearchFilters)}>{discovering ? <LoaderCircle className="spin" /> : <Search />} {regularSearchStatus.enabled ? "Confirm One Search Request" : "Live Search Unavailable — Gate Off"}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(regularSearchResultEvidence)} onOpenChange={open => { if (!open) setRegularSearchResultEvidence(null) }}>
        <DialogContent className="search-evidence-dialog"><DialogHeader><DialogTitle>Coresignal Search evidence</DialogTitle><DialogDescription>Sanitized ID-only evidence from the confirmed Search. These candidates are not verified alumni and their profiles were not collected or marked fresh.</DialogDescription></DialogHeader>{regularSearchResultEvidence && <CoresignalSearchEvidencePanel evidence={regularSearchResultEvidence} showIds />}<DialogFooter><Button onClick={() => setRegularSearchResultEvidence(null)}>Done</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={refreshConfirmOpen} onOpenChange={setRefreshConfirmOpen}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Refresh professional profiles?</DialogTitle><DialogDescription>Review this provider action before it runs.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Selected alumni</span><strong>{selectedForEnrichment.length}</strong></div><div><span>Provider</span><strong>Coresignal — {providerModes.coresignal.toUpperCase()}</strong></div><div><span>Action</span><strong>Employee collect</strong></div></div><div className="credit-notice"><Activity /><span>Coresignal professional fields are staged for human review. Email and phone are never requested or overwritten by this workflow.</span></div><DialogFooter><Button variant="outline" onClick={() => setRefreshConfirmOpen(false)}>Cancel</Button><Button disabled={!professionalSelectionReady || enriching} onClick={() => void runProfileRefresh()}>{enriching ? <LoaderCircle className="spin" /> : <Cloud />} Run Refresh</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={refreshResults.length > 0} onOpenChange={open => { if (!open) setRefreshResults([]) }}>
        <DialogContent className="refresh-results-dialog"><DialogHeader><DialogTitle>Coresignal profile refresh complete</DialogTitle><DialogDescription>Provider responses are recorded. Apply only the professional-field changes you approve, or explicitly keep existing values.</DialogDescription></DialogHeader><div className="refresh-result-list">{refreshResults.map(result => { const changed = result.fields.filter(field => field.oldValue !== field.newValue); return <article key={result.alumnusId}><div className="refresh-result-heading"><div><strong>{result.alumnusName}</strong><span>{result.reviewStatus} · {result.applicationUnits ?? 1} application unit{(result.applicationUnits ?? 1) === 1 ? "" : "s"} · provider usage {result.creditsUsed == null ? "unknown" : result.creditsUsed}</span></div><span className={`history-status history-${result.status}`}>{result.status.replace("_", " ")}</span></div>{result.status === "no_match" ? <p>No matching external professional profile found. Internal data was not modified.</p> : changed.length ? <div className="refresh-fields">{changed.map(field => <label key={field.field}><input type="checkbox" checked={(refreshSelections[result.reviewId ?? -result.alumnusId] ?? []).includes(field.field)} disabled={result.reviewStatus !== "Pending review"} onChange={() => result.reviewId && setRefreshSelections(current => ({ ...current, [result.reviewId!]: (current[result.reviewId!] ?? []).includes(field.field) ? current[result.reviewId!].filter(item => item !== field.field) : [...(current[result.reviewId!] ?? []), field.field] }))} /><span>{field.label}</span><strong>{field.oldValue || "Not recorded"}</strong><ChevronRight /><strong>{field.newValue}</strong></label>)}</div> : <p>No professional changes detected. Existing professional profile confirmed against Coresignal.</p>}{result.reviewStatus === "Pending review" && <div className="programme-actions"><Button size="sm" disabled={!(refreshSelections[result.reviewId ?? -result.alumnusId] ?? []).length} onClick={() => void applyRefreshResult(result)}>Apply Selected Updates</Button><Button size="sm" variant="outline" onClick={() => void applyRefreshResult(result, [])}>Keep existing</Button></div>}<small>{result.responseSummary}</small></article> })}</div><DialogFooter><Button onClick={() => setRefreshResults([])}>Done</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(comparisonResult)} onOpenChange={open => { if (!open) { setComparisonResult(null); setSelectedComparisonFields([]) } }}>
        <DialogContent className="comparison-dialog">
          <DialogHeader><DialogTitle>Compare professional profile</DialogTitle><DialogDescription>Review {appConfig.name} and Coresignal values. Nothing is overwritten until you approve selected fields.</DialogDescription></DialogHeader>
          {comparisonResult && <>
            <div className="comparison-person"><div className="avatar">{comparisonAlumnus?.initials ?? comparisonResult.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</div><div><strong>{comparisonResult.name}</strong><span><DiscoveryBadge status={comparisonResult.matchStatus} /> · {comparisonResult.matchConfidence}% match confidence</span></div></div>
            {comparisonAlumnus ? <div className="comparison-grid"><div className="comparison-head"><span>Field</span><strong>Internal database</strong><strong>Coresignal result</strong></div>{comparisonRows.map(row => {
              const changed = row.internal !== row.external && Boolean(row.external) && row.external !== "Not returned"
              return <label key={row.field} className={`comparison-row ${changed ? "changed" : "same"}`}><input type="checkbox" disabled={!changed} checked={selectedComparisonFields.includes(row.field)} onChange={() => setSelectedComparisonFields(current => current.includes(row.field) ? current.filter(item => item !== row.field) : [...current, row.field])} /><span>{row.label}<small>{changed ? "Changed" : "Same"}</small></span><strong>{row.internal}</strong><strong>{row.external}</strong></label>
            })}</div> : <div className="external-review-card"><div><span>Education</span><strong>{comparisonResult.education}</strong></div><div><span>Company</span><strong>{comparisonResult.currentCompany}</strong></div><div><span>Role</span><strong>{comparisonResult.role}</strong></div><div><span>Function and seniority</span><strong>{comparisonResult.function} · {comparisonResult.seniority}</strong></div><div><span>Location</span><strong>{comparisonResult.location}</strong></div><div><span>Graduation year</span><strong>{comparisonResult.graduationYear || "Not returned"}</strong></div></div>}
          </>}
          <DialogFooter className="comparison-footer">
            {comparisonResult?.matchStatus === "Possible duplicate" && <Button variant="outline" onClick={() => void keepDiscoveryResultSeparate()} disabled={discovering}>Different person · Keep Separate</Button>}
            {comparisonResult?.matchStatus === "Needs review" && <Button variant="outline" onClick={() => { setIgnoreResult(comparisonResult); setComparisonResult(null) }}>Ignore profile</Button>}
            {comparisonAlumnus && <Button variant="ghost" onClick={() => { openAlumnusProfile(comparisonAlumnus); setComparisonResult(null) }}><Eye /> View existing record</Button>}
            {comparisonAlumnus ? <Button onClick={() => void applyComparison()} disabled={discovering}>{comparisonResult?.matchStatus === "Possible duplicate" ? selectedComparisonFields.length ? "Same person · Apply Updates" : "Same person · Keep Internal" : selectedComparisonFields.length ? "Apply Selected Updates" : "Keep Internal Values"}</Button> : <Button onClick={() => setComparisonResult(null)}>Keep Pending Review</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
