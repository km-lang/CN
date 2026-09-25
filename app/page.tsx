"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity, ArrowUpRight, Ban, BellRing, BriefcaseBusiness, Building2, Cake,
  CalendarClock, CheckCircle2, ChevronRight, CircleUserRound, Cloud, ContactRound,
  Database, Download, Eye, FileSpreadsheet, Filter, GitCompare, History, LoaderCircle,
  Mail, MapPin, MessageSquare, Network, Plus, Search, Send, Sparkles, Target, Upload,
  Info, UserRoundCheck, UsersRound, XCircle, Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AlumnusCombobox } from "@/components/alumnus-combobox"
import { AdminPanel } from "@/app/admin-panel"
import { useAccessSession } from "@/app/access-provider"
import {
  FIXED_ALUMNI_SCHOOL,
  defaultDirectoryFilters,
  matchesInternalFilters,
  type DirectoryFilters,
} from "@/lib/alumni-search"
import { apiPath, appConfig } from "@/lib/app-config"
import { DISCOVERY_REVIEW_STATUS } from "@/lib/discovery-status"
import { normalizeProfessionalProfileUrl, professionalExperienceSummary } from "@/lib/professional-profile"
import { maximumDiscoveryCount, validateDiscoveryCount } from "@/lib/discovery-limit"
import { providerUsageLabel } from "@/lib/provider-usage"
import { alumnusProfileUrl, canonicalWorkspaceUrl, controlledEmailReturnUrl, controlledEmailUrl, engagementEventUrl, parseControlledEmailIntent, parseEngagementEventId, profileRouteState, workspaceTabUrl } from "@/lib/controlled-email-navigation"
import { initializeControlledEmail } from "@/lib/controlled-email-initialization"
import { PersistedMutationCoordinator } from "@/lib/persisted-mutation"
import { programmeFilterOptions, type ProgrammeOption } from "@/lib/programme-options"
import { contactReadiness, isActiveOutreach } from "@/lib/alumni-metrics"

const API_ROUTES = Object.freeze({
  workspace: apiPath("/api/workspace"),
  enrichment: apiPath("/api/enrichment"),
  engagements: apiPath("/api/engagements"),
  discovery: apiPath("/api/discovery"),
  signals: apiPath("/api/signals"),
  outreachRoute: apiPath("/api/outreach-route"),
})

const ADDED_DISCOVERY_STATUSES = new Set<string>([
  DISCOVERY_REVIEW_STATUS.added,
  DISCOVERY_REVIEW_STATUS.addedSeparate,
  DISCOVERY_REVIEW_STATUS.legacyAdded,
])

type OutreachStatus = "Not contacted" | "Contacted" | "Responded" | "Meeting set"
type VerificationState = "Confirmed" | "Verified" | "Likely" | "Unverified" | "Possibly outdated" | "Mismatch"

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
  lushaPersonId?: string
  discoverySource?: string
  discoveryDate?: string
  lastPdlRefresh?: string
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
type Provider = "pdl" | "lusha"
type ProviderMode = "mock" | "live"
type ProviderUsage = Record<Provider, { used: number; limit: number; remaining: number; configured: boolean; mode?: ProviderMode }>
type ProviderHistory = {
  id: number
  provider: Provider
  alumnusId?: number | null
  alumnusName: string
  operation: string
  mode: "mock" | "live"
  status: string
  creditsUsed: number
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
  matchStatus: "New" | "Already in database" | "Possible duplicate" | "Needs review"
  matchConfidence: number
  linkedInternalAlumnusId: number | null
  reviewStatus: string
  reviewNote?: string
}

type DiscoveryCounts = { existing: number; new: number; possibleDuplicate: number; needsReview: number }

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
type ManualMatch = { id: number; name: string; programme: string; batch: number; company: string; title: string }
type RefreshField = { field: string; label: string; oldValue: string; newValue: string }
type RefreshResult = { alumnusId: number; alumnusName: string; status: string; reviewStatus: string; reviewId?: number; creditsUsed: number; responseSummary: string; fields: RefreshField[] }
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
const seniorityFilterOptions = ["Director+", "VP+", "CXO", "EVP/SVP", "VP", "Director", "GM", "Senior Manager", "Manager", "Associate/Consultant", "Analyst/Junior"]

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

function educationLabel(person: Alumni) {
  if (person.programme === "Not confirmed") return `Graduation year ${person.graduationYear || "not confirmed"}`
  return `${person.programme} · ${person.batch}`
}

function StatusBadge({ status }: { status: OutreachStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
}

function EngagementStatusBadge({ status }: { status: EngagementStatus }) {
  return <span className={`engagement-status engagement-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
}

function displayEventDate(value: string) {
  if (!value) return "Date not recorded"
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function DiscoveryBadge({ status }: { status: DiscoveryResult["matchStatus"] }) {
  return <span className={`discovery-badge discovery-${status.toLowerCase().replaceAll(" ", "-")}`}>{status === "New" ? "Externally discovered" : status}</span>
}

function discoveryReviewLabel(status: string) {
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

function placementContext(person: Alumni) {
  return person.note === "No placement context recorded." ? "No Placement Committee relationship context recorded." : person.note
}

function missingLushaChannels(person: Alumni): ("email" | "phone")[] {
  return (["email", "phone"] as const).filter(channel => !person[channel] || person.verification[channel] !== "Verified")
}

function StatCard({ icon: Icon, label, value, delta, help }: { icon: typeof UsersRound; label: string; value: string; delta: string; help?: string }) {
  return <article className="stat-card"><div className="stat-icon"><Icon aria-hidden="true" /></div><div><p>{label}</p><strong>{value}</strong><span>{delta}{help && <TooltipProvider><Tooltip><TooltipTrigger asChild><button type="button" className="kpi-help" aria-label={`What ${label} means`}><Info aria-hidden="true" /></button></TooltipTrigger><TooltipContent side="bottom" className="kpi-help-content">{help}</TooltipContent></Tooltip></TooltipProvider>}</span></div></article>
}

function parseCsv(content: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const next = content[index + 1]
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; continue }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell.trim()); cell = ""
      if (row.some(value => value)) rows.push(row)
      row = []
      continue
    }
    cell += character
  }
  row.push(cell.trim())
  if (row.some(value => value)) rows.push(row)
  if (rows.length < 2) throw new Error("The CSV must contain a header row and at least one alumnus.")
  const headers = rows[0].map(header => header.replace(/^\uFEFF/, "").trim())
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
}

export default function Home() {
  const session = useAccessSession()
  const currentDemoUser = session.displayName
  const [alumni, setAlumni] = useState<Alumni[]>([])
  const [companyPriorities, setCompanyPriorities] = useState<Record<string, string>>({})
  const [configuredProgrammes, setConfiguredProgrammes] = useState<ProgrammeOption[]>([])
  const [filters, setFilters] = useState<DirectoryFilters>(defaultDirectoryFilters)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [targetCompany, setTargetCompany] = useState("")
  const [routeSearch, setRouteSearch] = useState("")
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState("")
  const [latestImport, setLatestImport] = useState<LatestImport | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [providerModes, setProviderModes] = useState<Record<Provider, ProviderMode>>({ pdl: "mock", lusha: "mock" })
  const [providerUsage, setProviderUsage] = useState<ProviderUsage>({ pdl: { used: 0, limit: 100, remaining: 100, configured: false }, lusha: { used: 0, limit: 100, remaining: 100, configured: false } })
  const [providerHistory, setProviderHistory] = useState<ProviderHistory[]>([])
  const [usageReconciliationDrafts, setUsageReconciliationDrafts] = useState<Record<number, string>>({})
  const [creditDrafts, setCreditDrafts] = useState<Record<Provider, string>>({ pdl: "100", lusha: "100" })
  const [selectedForEnrichment, setSelectedForEnrichment] = useState<number[]>([])
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
  const [lastDiscoveryFilters, setLastDiscoveryFilters] = useState<DirectoryFilters | null>(null)
  const [pendingDiscoveryFilters, setPendingDiscoveryFilters] = useState<DirectoryFilters | null>(null)
  const [pdlLiveMaximum, setPdlLiveMaximum] = useState(5)
  const [discoveryRequestedCount, setDiscoveryRequestedCount] = useState<number | null>(null)
  const [discoveryReturnedCount, setDiscoveryReturnedCount] = useState<number | null>(null)
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
  const [birthdayWindow, setBirthdayWindow] = useState("Next 7 Days")
  const [birthdayCompany, setBirthdayCompany] = useState("All companies")
  const [birthdayEmailFilter, setBirthdayEmailFilter] = useState("All email states")
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
  const [manualForm, setManualForm] = useState<ManualForm>({ name: "", programme: "PGP", batch: "", company: "", title: "", function: "Other", seniority: "Not assessed", location: "", linkedinUrl: "", email: "", phone: "", relationship: "Unknown / Not assessed", note: "", status: "Not contacted" })
  const [manualMatches, setManualMatches] = useState<ManualMatch[]>([])
  const [manualSaved, setManualSaved] = useState<Alumni | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualMessage, setManualMessage] = useState("")
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false)
  const [refreshResults, setRefreshResults] = useState<RefreshResult[]>([])
  const [refreshSelections, setRefreshSelections] = useState<Record<number, string[]>>({})
  const [lushaTarget, setLushaTarget] = useState<Alumni | null>(null)
  const [lushaPreview, setLushaPreview] = useState<LushaContactPreview | null>(null)
  const [lushaRevealConfirmOpen, setLushaRevealConfirmOpen] = useState(false)
  const [professionalNoteDrafts, setProfessionalNoteDrafts] = useState<Record<number, string>>({})
  const [privacyNoteDrafts, setPrivacyNoteDrafts] = useState<Record<number, string>>({})

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
      const data = await response.json() as { modes?: Record<Provider, ProviderMode>; usage?: ProviderUsage; history?: ProviderHistory[]; error?: string }
      if (!response.ok || !data.usage) throw new Error(data.error || "Unable to load provider activity.")
      setProviderModes(data.modes ?? { pdl: data.usage.pdl.mode ?? "mock", lusha: data.usage.lusha.mode ?? "mock" })
      setProviderUsage(data.usage)
      setProviderHistory(data.history ?? [])
      setCreditDrafts({ pdl: String(data.usage.pdl.limit), lusha: String(data.usage.lusha.limit) })
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to load provider activity.")
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEnrichment(), 0)
    return () => window.clearTimeout(timer)
  }, [loadEnrichment])

  const loadPendingDiscoverySummary = useCallback(async () => {
    if (!session.canOperate) return
    try {
      const response = await fetch(`${API_ROUTES.discovery}?view=summary`, { cache: "no-store" })
      const data = await response.json() as { pendingCount?: number; liveMaximum?: number; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to load pending external-review status.")
      setPendingDiscoveryCount(data.pendingCount ?? 0)
      setPdlLiveMaximum(data.liveMaximum ?? 5)
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to load pending external-review status.")
    }
  }, [session.canOperate])

  useEffect(() => {
    if (!session.canOperate) return
    const timer = window.setTimeout(() => void loadPendingDiscoverySummary(), 0)
    return () => window.clearTimeout(timer)
  }, [loadPendingDiscoverySummary, session.canOperate])

  const loadEngagements = useCallback(async () => {
    if (!session.canOperate) return
    try {
      engagementWorkCountRef.current += 1
      setEngagementLoading(true)
      const response = await fetch(API_ROUTES.engagements, { cache: "no-store" })
      const data = await response.json() as { events?: EngagementEvent[]; templates?: MessageTemplate[]; mode?: "mock" | "live"; mail?: { configured?: boolean }; error?: string }
      if (!response.ok || !data.events) throw new Error(data.error || "Unable to load the shared engagement queue.")
      setEngagements(data.events)
      setMessageTemplates(data.templates ?? [])
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

  const companies = useMemo(() => [...new Set(alumni.map(person => person.company))].sort(), [alumni])
  const programmeChoices = useMemo(() => programmeFilterOptions(configuredProgrammes, alumni.map(person => person.programme)), [alumni, configuredProgrammes])
  const activeProgrammeChoices = programmeChoices.filter(option => option.active)
  const activeTargetCompany = companies.includes(targetCompany) ? targetCompany : companies[0] ?? ""
  const filtered = useMemo(() => alumni.filter(person => {
    const relevance = relevanceBreakdown(person, companyPriorities, engagements).score
    return matchesInternalFilters(person, filters, relevance, operationalStatus(person))
  }).sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score), [alumni, companyPriorities, engagements, filters])

  const topLeads = [...alumni].sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score || a.name.localeCompare(b.name)).slice(0, 5)
  const targetAlumni = alumni.filter(person => person.company === activeTargetCompany).sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score)
  const activeOutreach = alumni.filter(person => isActiveOutreach(person.status)).length
  const contactReadyCount = alumni.filter(person => operationalStatus(person) === "Contact-ready").length
  const today = new Date().toISOString().slice(0, 10)
  const tomorrowDate = new Date(); tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
  const tomorrow = tomorrowDate.toISOString().slice(0, 10)
  const nextWeekDate = new Date(); nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7)
  const nextWeek = nextWeekDate.toISOString().slice(0, 10)
  const birthdayEvents = engagements.filter(event => event.eventType === "Birthday")
  const professionalEvents = engagements.filter(event => event.eventType === "Professional Signal")
  const actionableProfessionalEvents = professionalEvents.filter(event => !isCompletedEngagement(event.status))
  const signalsTarget = alumni.find(person => person.id === signalsAlumnusId) ?? null
  const signalsActive = Boolean(signalsStatus?.liveEnabled && signalsStatus.entitlement === "confirmed")
  const birthdaysToday = birthdayEvents.filter(event => event.eventDate === today)
  const birthdaysNextWeek = birthdayEvents.filter(event => event.eventDate >= today && event.eventDate <= nextWeek)
  const assignedToMe = engagements.filter(event => event.assignedTo === currentDemoUser && !["Closed", "Skipped"].includes(event.status))
  const followUpsDue = engagements.filter(event => event.status === "Follow-up Due")
  const pdlSelectionReady = selectedForEnrichment.length > 0 && (providerModes.pdl === "mock" || selectedForEnrichment.length === 1) && providerUsage.pdl.remaining >= selectedForEnrichment.length && (providerModes.pdl === "mock" || providerUsage.pdl.configured)
  const lushaEmailReady = selectedForEnrichment.length === 1 && providerUsage.lusha.remaining >= 1 && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const lushaPhoneReady = selectedForEnrichment.length > 0 && providerUsage.lusha.remaining >= selectedForEnrichment.length * 5 && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const lushaBothReady = selectedForEnrichment.length > 0 && providerUsage.lusha.remaining >= selectedForEnrichment.length * 6 && (providerModes.lusha === "mock" || providerUsage.lusha.configured)
  const birthdayReady = (event: EngagementEvent) => Boolean(event.alumnus?.email)
    && ["Confirmed internally", "Manually confirmed", "PDL sourced"].includes(event.birthday?.status ?? "")
    && ["Standard engagement allowed", "Birthday engagement allowed"].includes(event.preference)
    && !isCompletedEngagement(event.status)
  const reviewableBirthdaysNextWeek = birthdaysNextWeek.filter(birthdayReady)
  const discoveryMaximum = maximumDiscoveryCount(providerUsage.pdl.remaining, providerModes.pdl === "live" ? pdlLiveMaximum : 100)
  const discoveryCountPreset = ["1", "5", "10", "20"].includes(discoveryLimit) ? discoveryLimit : "custom"
  const discoveryCountValidation = validateDiscoveryCount(Number(discoveryLimit), providerUsage.pdl.remaining, providerModes.pdl === "live" ? pdlLiveMaximum : 100)
  const visibleEngagements = engagements.filter(event => {
    if (engagementFilter === "Professional Signals" && event.eventType !== "Professional Signal") return false
    if (engagementFilter === "Birthdays" && event.eventType !== "Birthday") return false
    if (engagementFilter === "Assigned to Me" && event.assignedTo !== currentDemoUser) return false
    if (engagementFilter === "Follow-ups" && event.status !== "Follow-up Due") return false
    if (engagementFilter === "Completed" && !isCompletedEngagement(event.status)) return false
    if (engagementFilter === "Skipped" && event.status !== "Skipped") return false
    if (engagementFilter === "Needs Action" && isCompletedEngagement(event.status)) return false
    if (event.eventType === "Birthday" && engagementFilter === "Birthdays") {
      if (birthdayWindow === "Today" && event.eventDate !== today) return false
      if (birthdayWindow === "Tomorrow" && event.eventDate !== tomorrow) return false
      if (birthdayWindow === "Next 7 Days" && (event.eventDate < today || event.eventDate > nextWeek)) return false
      if (birthdayWindow === "This Month" && event.eventDate.slice(0, 7) !== today.slice(0, 7)) return false
      if (birthdayCompany !== "All companies" && event.alumnus?.company !== birthdayCompany) return false
      if (birthdayEmailFilter === "Email available" && !event.alumnus?.email) return false
      if (birthdayEmailFilter === "Email unavailable" && event.alumnus?.email) return false
    }
    return true
  })

  function changeTargetCompany(company: string) {
    setTargetCompany(company)
    setTargetAlumnusId(null)
    setRouteRecommendation(null)
    setRouteMessage("")
  }

  function selectTargetAlumnus(id: number | null) {
    setTargetAlumnusId(id)
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

  async function importAlumni() {
    if (!importFile) { setWorkspaceMessage("Choose a CSV file first."); return }
    setImporting(true)
    try {
      const records = parseCsv(await importFile.text())
      const response = await fetch(API_ROUTES.workspace, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", filename: importFile.name, records }) })
      const data = await response.json() as { imported?: number; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to import the selected file.")
      setWorkspaceMessage(`${data.imported ?? records.length} alumni records imported into the shared database.`)
      setImportFile(null)
      await loadWorkspace()
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Unable to import the selected file.")
    } finally {
      setImporting(false)
    }
  }

  async function runEnrichment(ids: number[], requestedProviders: Provider[], operation: "manual" | "batch", contactChannels?: ("email" | "phone")[]) {
    if (!ids.length) { setEnrichmentMessage("Select at least one alumnus first."); return }
    setEnriching(true)
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.enrichment, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alumniIds: ids.slice(0, 25), providers: requestedProviders, operation, contactChannels }),
      })
      const data = await response.json() as { results?: Array<{ status: string }>; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to run enrichment.")
      const successes = data.results?.filter(result => result.status === "success").length ?? 0
      setEnrichmentMessage(`${successes} provider result${successes === 1 ? "" : "s"} applied. Full details are in response history.`)
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to run enrichment.")
    } finally {
      setEnriching(false)
    }
  }

  function prepareLushaEmail(person: Alumni) {
    setLushaTarget(person)
    const storedContactId = person.lushaPersonId?.trim() ?? ""
    const completedPreview = providerHistory.find(item => item.provider === "lusha" && item.alumnusId === person.id && item.operation === "Contact Search Preview" && item.status === "success")
    const completedEmailAvailability = completedPreview?.responseSummary.includes("Email availability: available.")
      ? true
      : completedPreview?.responseSummary.includes("Email availability: not available.")
        ? false
        : null
    setLushaPreview(storedContactId ? {
      alumnusId: person.id,
      alumnusName: person.name,
      contactId: storedContactId,
      fullName: person.name,
      jobTitle: "",
      company: "",
      professionalProfile: normalizeProfessionalProfileUrl(person.linkedinUrl),
      emailAvailable: completedEmailAvailability,
      phoneAvailable: null,
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
        body: JSON.stringify({ action: "lusha_search_contact", alumnusId: lushaTarget.id }),
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

  async function validatePdlConnection() {
    setEnrichmentMessage("")
    try {
      const response = await fetch(API_ROUTES.discovery, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "validate_pdl" }) })
      const data = await response.json() as { connected?: boolean; school?: { id: string; name: string; creditsUsed: number }; error?: string }
      if (!response.ok || !data.connected || !data.school) throw new Error(data.error || "Unable to validate PDL connectivity.")
      setEnrichmentMessage(`PDL authenticated successfully. Canonical school: ${data.school.name} (${data.school.id}). Cleaner credits reported: ${data.school.creditsUsed}.`)
      await loadEnrichment()
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to validate PDL connectivity.")
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
      if (providerModes.pdl === "live") return [id]
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
      if (person) prepareLushaEmail(person)
      return
    }
    await runEnrichment([event.alumnus.id], ["lusha"], "manual", ["email"])
    await Promise.all([loadWorkspace(), loadEngagements()])
    setEngagementMessage("Lusha email enrichment completed. Review the updated contact before sending.")
  }

  function updateFilter<K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }))
    setDiscoveryResults([])
    setSelectedDiscoveryIds([])
    setDiscoveryMessage("")
    setDiscoveryState("idle")
    setLastDiscoveryFilters(null)
  }

  function clearDirectoryFilters() {
    setFilters(defaultDirectoryFilters())
    setDiscoveryResults([])
    setDiscoveryCounts({ existing: 0, new: 0, possibleDuplicate: 0, needsReview: 0 })
    setDiscoveryMessage("")
    setDiscoveryState("idle")
    setLastDiscoveryFilters(null)
    setPendingDiscoveryFilters(null)
    setDiscoveryRequestedCount(null)
    setDiscoveryReturnedCount(null)
    setSelectedDiscoveryIds([])
  }

  function changeDiscoveryCountPreset(value: string) {
    if (value === "custom") {
      if (discoveryCountPreset !== "custom") setDiscoveryLimit("")
      return
    }
    setDiscoveryLimit(value)
  }

  function discoveryCountControl(actionLabel: string, variant: "default" | "outline" = "default") {
    return <div className="discovery-count-control"><label><span>Results to retrieve</span><Select value={discoveryCountPreset} onValueChange={changeDiscoveryCountPreset}><SelectTrigger aria-label="Results to retrieve"><SelectValue /></SelectTrigger><SelectContent>{[1, 5, 10, 20].map(value => <SelectItem key={value} value={String(value)} disabled={value > discoveryMaximum}>{value}</SelectItem>)}<SelectItem value="custom">Custom</SelectItem></SelectContent></Select></label>{discoveryCountPreset === "custom" && <label><span>Custom result count</span><Input type="number" inputMode="numeric" min="1" max={discoveryMaximum} step="1" value={discoveryLimit} onChange={event => setDiscoveryLimit(event.target.value)} aria-label="Custom result count" /></label>}<small>{discoveryCountValidation.ok ? `Maximum currently ${discoveryMaximum}.` : discoveryCountValidation.message}</small><Button title={!discoveryCountValidation.ok ? `Enter a valid count within the ${discoveryMaximum} available PDL application credits.` : undefined} variant={variant} onClick={() => discoverMoreAlumni()} disabled={discovering || !discoveryCountValidation.ok}>{discovering ? <LoaderCircle className="spin" /> : <Search />} {actionLabel}</Button></div>
  }

  function discoverMoreAlumni(searchFilters: DirectoryFilters = filters) {
    const requested = Number(discoveryLimit)
    const validation = validateDiscoveryCount(requested, providerUsage.pdl.remaining, providerModes.pdl === "live" ? pdlLiveMaximum : 100)
    if (!validation.ok) {
      setDiscoveryState("blocked")
      setDiscoveryMessage(validation.message)
      return
    }
    if (providerModes.pdl === "live") {
      setPendingDiscoveryFilters(searchFilters)
      return
    }
    void runDiscovery(searchFilters)
  }

  async function reviewPendingDiscoveryResults() {
    setLoadingPendingReview(true)
    setDiscoveryMessage("")
    try {
      const response = await fetch(`${API_ROUTES.discovery}?view=pending`, { cache: "no-store" })
      const data = await response.json() as {
        pendingCount?: number
        results?: DiscoveryResult[]
        counts?: DiscoveryCounts
        filters?: DirectoryFilters
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
      setDiscoveryState(data.results.length ? "results" : "empty")
      const provenance = data.source ? `${data.source.provider.toUpperCase()} ${data.source.mode.toUpperCase()}` : "external"
      setDiscoveryMessage(data.results.length
        ? `Loaded ${data.results.length} stored ${provenance} profile${data.results.length === 1 ? "" : "s"} for review. No provider call was made and 0 credits were used.`
        : "There are no external alumni awaiting review.")
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to reopen stored external results.")
    } finally {
      setLoadingPendingReview(false)
    }
  }

  async function runDiscovery(searchFilters: DirectoryFilters) {
    setDiscovering(true)
    setDiscoveryMessage("")
    setLastDiscoveryFilters(searchFilters)
    try {
      const response = await fetch(API_ROUTES.discovery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", filters: searchFilters, limit: Number(discoveryLimit) }),
      })
      const data = await response.json() as { results?: DiscoveryResult[]; counts?: DiscoveryCounts; creditsUsed?: number; effectiveLimit?: number; requestedCount?: number; returnedCount?: number; error?: string; blocked?: boolean }
      if (data.blocked) {
        setDiscoveryState("blocked")
        setDiscoveryMessage(data.error || "External search could not be run because the PDL application limit has been reached.")
        return
      }
      if (!response.ok || !data.results || !data.counts) throw new Error(data.error || "Unable to search external professional data.")
      if (data.effectiveLimit) setDiscoveryLimit(String(data.effectiveLimit))
      setDiscoveryRequestedCount(data.requestedCount ?? data.effectiveLimit ?? Number(discoveryLimit))
      setDiscoveryReturnedCount(data.returnedCount ?? data.results.length)
      setDiscoveryResults(data.results)
      setDiscoveryCounts(data.counts)
      setSelectedDiscoveryIds([])
      setDiscoveryState(data.results.length ? "results" : "empty")
      setDiscoveryMessage(data.results.length
        ? `${data.results.length} profiles returned from ${data.requestedCount ?? data.effectiveLimit ?? discoveryLimit} requested. ${data.creditsUsed ?? 0} PDL credits were reported by the provider.`
        : "No additional external alumni were found for these criteria.")
      await Promise.all([loadEnrichment(), loadPendingDiscoverySummary()])
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to search external professional data.")
    } finally {
      setDiscovering(false)
      setPendingDiscoveryFilters(null)
    }
  }

  function findMoreForCompany(companyName: string) {
    const next = { ...defaultDirectoryFilters(), company: companyName }
    setFilters(next)
    changeWorkspaceTab("directory")
    discoverMoreAlumni(next)
  }

  function compareRefreshWithPdl(person: Alumni) {
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
      ["pdlPersonId", person.pdlPersonId ?? "", result.providerPersonId],
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
      const addedMap = new Map(data.added.map(item => [item.resultId, item.alumnusId]))
      setDiscoveryResults(current => current.map(item => addedMap.has(item.id)
        ? { ...item, linkedInternalAlumnusId: addedMap.get(item.id) ?? null, reviewStatus: DISCOVERY_REVIEW_STATUS.added }
        : item))
      setSelectedDiscoveryIds([])
      setDiscoveryMessage(`${data.addedCount ?? data.added.length} alumn${data.added.length === 1 ? "us" : "i"} added. Contact enrichment is now available.`)
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
      setIgnoreResult(null)
      setDiscoveryMessage(`External result ignored: ${reason}. The decision is saved for other committee members.`)
      await loadPendingDiscoverySummary()
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
      setDiscoveryMessage(data.changedFields?.length ? `${data.changedFields.length} professional fields updated and recorded in Change History.` : "No professional changes detected. The PDL interaction remains in Provider History.")
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
      setEnrichmentMessage(`PDL profile refresh completed for ${data.results.length} alumn${data.results.length === 1 ? "us" : "i"}. Review proposed changes before applying them.`)
      await Promise.all([loadWorkspace(), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to refresh the selected profiles.")
    } finally {
      setEnriching(false)
    }
  }

  async function applyRefreshResult(result: RefreshResult) {
    if (!result.reviewId) return
    setEnriching(true)
    try {
      const response = await fetch(API_ROUTES.enrichment, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply_refresh", reviewId: result.reviewId, fields: refreshSelections[result.reviewId] ?? [] }) })
      const data = await response.json() as { applied?: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to apply the selected profile updates.")
      setRefreshResults(current => current.map(item => item.reviewId === result.reviewId ? { ...item, reviewStatus: data.applied?.length ? "Applied" : "Reviewed, no updates selected" } : item))
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
  const companyEngagements = engagements.filter(event => event.alumnus && event.alumnus.company === activeTargetCompany)
  const selectedEngagementBusy = selectedEngagement ? pendingEngagementKeys.has(`event:${selectedEngagement.id}`) : false
  const comparisonAlumnus = comparisonResult ? alumni.find(person => person.id === comparisonResult.linkedInternalAlumnusId) ?? null : null
  const comparisonRows = comparisonResult && comparisonAlumnus ? [
    { field: "company", label: "Current company", internal: comparisonAlumnus.company, external: comparisonResult.currentCompany },
    { field: "title", label: "Role", internal: comparisonAlumnus.title, external: comparisonResult.role },
    { field: "function", label: "Function", internal: comparisonAlumnus.function, external: comparisonResult.function },
    { field: "seniority", label: "Seniority", internal: comparisonAlumnus.seniority, external: comparisonResult.seniority },
    { field: "location", label: "Location", internal: comparisonAlumnus.location, external: comparisonResult.location },
    { field: "graduationYear", label: "Graduation year", internal: String(comparisonAlumnus.graduationYear || comparisonAlumnus.batch || "Not recorded"), external: String(comparisonResult.graduationYear || "Not returned") },
  ] : []

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">{appConfig.shortName}</div><div><strong>{appConfig.name}</strong><span>{appConfig.subtitle}</span></div></div>
        <div className="topbar-actions"><div className={`data-state ${workspaceMessage ? "data-state-warning" : ""}`}><span /> {workspaceLoading ? "Connecting to shared database" : syncing ? "Saving changes" : workspaceMessage || "Shared database · Synced"}</div><div className="signed-in-user"><strong>{session.displayName}</strong><span>{session.role}</span></div><a className="sign-out-link" href={session.signOutPath} target="_top">Sign out</a></div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">Placement intelligence</p><h1>{appConfig.tagline}</h1></div>
        </div>

        <Tabs value={activeTab} onValueChange={changeWorkspaceTab} className="product-tabs">
          <TabsList variant="line" className="main-tabs" aria-label="Platform sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="directory">Alumni directory</TabsTrigger>
            <TabsTrigger value="companies">Company intelligence</TabsTrigger>
            {session.canOperate && <TabsTrigger value="engagement">Engagement</TabsTrigger>}
            {session.canOperate && <TabsTrigger value="outreach">Outreach</TabsTrigger>}
            {session.canOperate && <TabsTrigger value="data-import">Data import</TabsTrigger>}
            <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
            {session.canAdminister && <TabsTrigger value="admin">Administration</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="tab-panel">
            <section className="stats-grid" aria-label="Key metrics">
              <StatCard icon={UsersRound} label="Alumni mapped" value={`${alumni.length}`} delta="Shared master database" />
              <StatCard icon={Building2} label="Companies covered" value={`${companies.length}`} delta="Calculated from current records" />
              <StatCard icon={UserRoundCheck} label="Contact-ready alumni" value={`${contactReadyCount} / ${alumni.length}`} delta="Based on field verification" help="Requires a confirmed profile match, verified current company, verified or likely designation, and at least one verified email or phone." />
              <StatCard icon={Target} label="Active outreach" value={`${activeOutreach}`} delta="Visible to all committee members" help="Includes shared outreach states Contacted, Responded, and Meeting set." />
            </section>

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

            {session.canOperate && <button className={`panel birthday-overview ${birthdaysNextWeek.length || reviewableBirthdaysNextWeek.length ? "birthday-overview-active" : "birthday-overview-empty"}`} onClick={() => { setEngagementFilter("Birthdays"); setBirthdayWindow("Next 7 Days"); changeWorkspaceTab("engagement") }}>
              <span className="birthday-overview-icon"><Cake /></span><span><p className="eyebrow">Birthday engagement</p><strong>{birthdaysToday.length} today · {birthdaysNextWeek.length} in the next 7 days</strong><small>{reviewableBirthdaysNextWeek.length} ready for review</small></span><ChevronRight />
            </button>}

            {session.canOperate && <section className="panel route-panel route-planner">
              <div className="panel-heading"><div><p className="eyebrow">Recommended outreach route</p><h2>Choose who you want to reach</h2><span>Ranking answers who to approach. Route recommendation explains how to approach the selected alumnus.</span></div></div>
              <div className="route-controls route-controls-overview"><label><span>Target company</span><Select value={activeTargetCompany} onValueChange={changeTargetCompany}><SelectTrigger><SelectValue placeholder="No mapped companies" /></SelectTrigger><SelectContent>{companies.map(company => <SelectItem key={company} value={company}>{company}</SelectItem>)}</SelectContent></Select></label><AlumnusCombobox options={targetAlumni} value={targetAlumnusId} onValueChange={selectTargetAlumnus} /><Button title={!targetAlumnusId ? "Select a target alumnus from the suggestions first." : routeLoading ? "The route recommendation is still being prepared." : undefined} disabled={!targetAlumnusId || routeLoading} onClick={() => void recommendRoute()}>{routeLoading ? <LoaderCircle className="spin" /> : <Network />} Recommend Outreach Route</Button></div>
              {routeMessage && <p className="route-message">{routeMessage}</p>}
            </section>}
          </TabsContent>

          <TabsContent value="directory" className="tab-panel">
            <section className="panel directory-panel">
              <div className="panel-heading directory-heading"><div><p className="eyebrow">Internal alumni directory</p><h2>Alumni directory</h2><span>{filtered.length} alumni found in {appConfig.name}, ranked by Placement Relevance</span></div></div>
              {session.canOperate && pendingDiscoveryCount > 0 && <div className="pending-review-banner" role="status"><span className="pending-review-icon"><Eye /></span><span><strong>{pendingDiscoveryCount} external alumn{pendingDiscoveryCount === 1 ? "us" : "i"} awaiting review</strong><small>Reopen the stored results without running another provider search.</small></span><Button variant="outline" onClick={() => void reviewPendingDiscoveryResults()} disabled={loadingPendingReview}>{loadingPendingReview ? <LoaderCircle className="spin" /> : <Eye />} Review Results</Button></div>}
              <div className="filters core-filters">
                <div className="search-field"><Search /><Input value={filters.name} onChange={event => updateFilter("name", event.target.value)} placeholder="Alumnus name" aria-label="Search by alumnus name" /></div>
                <Input list="company-options" value={filters.company === "All companies" ? "" : filters.company} onChange={event => updateFilter("company", event.target.value || "All companies")} placeholder="Company name" aria-label="Filter by current company" />
                <datalist id="company-options">{companies.map(item => <option key={item} value={item} />)}</datalist>
                <Input value={filters.role} onChange={event => updateFilter("role", event.target.value)} placeholder="Role or designation" aria-label="Filter by role or designation" />
                <Select value={filters.function} onValueChange={value => updateFilter("function", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.seniority} onValueChange={value => updateFilter("seniority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All levels">All seniority</SelectItem>{seniorityFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Input value={filters.location} onChange={event => updateFilter("location", event.target.value)} placeholder="Location" aria-label="Filter by location" />
                <Button variant="outline" onClick={() => setShowAdvancedFilters(value => !value)}><Filter /> {showAdvancedFilters ? "Hide advanced filters" : "More filters"}</Button>
                <Button variant="ghost" onClick={clearDirectoryFilters}>Clear</Button>
              </div>
              {showAdvancedFilters && <div className="advanced-filters">
                <Select value={filters.programme} onValueChange={value => updateFilter("programme", value)}><SelectTrigger aria-label="Filter by programme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All programmes">All programmes</SelectItem>{programmeChoices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
                <Input type="number" min="1980" max="2100" value={filters.batch} onChange={event => updateFilter("batch", event.target.value)} placeholder="Batch / graduation year" />
                <Input value={filters.previousCompany} onChange={event => updateFilter("previousCompany", event.target.value)} placeholder="Previous company" />
                <Select value={String(filters.minRelevance)} onValueChange={value => updateFilter("minRelevance", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any Placement Relevance</SelectItem><SelectItem value="60">Placement Relevance 60+</SelectItem><SelectItem value="75">Placement Relevance 75+</SelectItem><SelectItem value="85">Placement Relevance 85+</SelectItem></SelectContent></Select>
                <Select value={String(filters.minConfidence)} onValueChange={value => updateFilter("minConfidence", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any Data Confidence</SelectItem><SelectItem value="60">Data Confidence 60+</SelectItem><SelectItem value="75">Data Confidence 75+</SelectItem><SelectItem value="90">Data Confidence 90+</SelectItem></SelectContent></Select>
                <Select value={filters.contactStatus} onValueChange={value => updateFilter("contactStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["All contact states", "Contact-ready", "Partially verified", "Needs verification", "Mismatch"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.outreachStatus} onValueChange={value => updateFilter("outreachStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All outreach states">All outreach states</SelectItem>{statusOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.relationship} onValueChange={value => updateFilter("relationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All relationships">All IIML relationships</SelectItem>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select>
              </div>}
              <Table>
                <TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Location</TableHead><TableHead>Data confidence</TableHead><TableHead>Placement relevance</TableHead><TableHead>Outreach</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{filtered.map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person, "directory")}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{educationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.function}</TableCell><TableCell>{person.location}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.confidence)}`}>{person.confidence}%</span></TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><StatusBadge status={person.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void recommendRoute(person.id)}><Network /> Recommend Route</Button></TableCell></TableRow> })}</TableBody>
              </Table>
              {filtered.length === 0 && <div className="empty-state"><Search /><h3>No mapped alumni match these filters</h3><p>{session.canOperate ? "Adjust or clear the internal filters, or use the separate external discovery area below." : "No authorized records match the selected filters."}</p></div>}
            </section>

            {session.canOperate && <section className="panel directory-external-discovery"><div><p className="eyebrow">External discovery</p><h2>Need more alumni?</h2><span>Search external professional data for additional IIM Lucknow alumni. Internal directory filters never call a provider.</span></div>{discoveryCountControl("Discover More Alumni")}</section>}

            {(discoveryState !== "idle" || discoveryResults.length > 0 || discoveryMessage) && <section className="panel discovery-panel">
              <div className="discovery-header">
                <div><p className="eyebrow">External discovery</p><h2>{discoveryState === "blocked" ? "External search not run" : discoveryState === "empty" ? "No additional profiles found" : `${discoveryResults.length} PDL profiles found`}</h2><span>{discoveryState === "blocked" ? "The previous search state is retained below." : `Results are reviewed before any record enters ${appConfig.name}.`}</span></div>
                <div className="fixed-criterion"><span>Fixed alumni criterion</span><strong>{FIXED_ALUMNI_SCHOOL}</strong></div>
              </div>
              {lastDiscoveryFilters && <div className="external-search-summary"><div><span>Education</span><strong>{FIXED_ALUMNI_SCHOOL}</strong><small>Fixed</small></div><div><span>Company</span><strong>{lastDiscoveryFilters.company}</strong></div><div><span>Role</span><strong>{lastDiscoveryFilters.role || "Any role"}</strong></div><div><span>Function</span><strong>{lastDiscoveryFilters.function}</strong></div><div><span>Seniority</span><strong>{lastDiscoveryFilters.seniority}</strong></div><div><span>Location</span><strong>{lastDiscoveryFilters.location || "Any location"}</strong></div><div><span>Graduation year</span><strong>{lastDiscoveryFilters.batch || "Any year"}</strong></div><div><span>Results requested / returned</span><strong>{discoveryRequestedCount ?? discoveryLimit} / {discoveryReturnedCount ?? discoveryResults.length}</strong></div></div>}
              <div className="discovery-controls">
                <div className="reconciliation-summary"><span><strong>{discoveryCounts.existing}</strong> already mapped</span><span><strong>{discoveryCounts.new}</strong> new</span><span><strong>{discoveryCounts.possibleDuplicate}</strong> possible duplicates</span><span><strong>{discoveryCounts.needsReview}</strong> needs review</span></div>
                {discoveryCountControl("Run again", "outline")}
              </div>
              <div className="credit-notice"><Activity /><span>External discovery may consume PDL credits based on the number of person records returned. Internal search remains free.</span></div>
              {discoveryMessage && <div className="discovery-message">{discoveryMessage}</div>}
              {selectedDiscoveryIds.length > 0 && <div className="batch-approval"><span>{selectedDiscoveryIds.length} clearly new profile{selectedDiscoveryIds.length === 1 ? "" : "s"} selected</span><Button onClick={() => void approveDiscoveryResults(selectedDiscoveryIds)} disabled={discovering}><Plus /> Add Selected to {appConfig.name}</Button></div>}
              <div className="discovery-table-wrap"><Table>
                <TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Name and education</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Seniority</TableHead><TableHead>Location</TableHead><TableHead>Database match</TableHead><TableHead>Identity match confidence</TableHead><TableHead>Professional profile</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{discoveryResults.map(result => {
                  const canAdd = result.matchStatus === "New" && result.reviewStatus === "Pending review"
                  const added = ADDED_DISCOVERY_STATUSES.has(result.reviewStatus) && result.linkedInternalAlumnusId
                  const professionalProfileUrl = normalizeProfessionalProfileUrl(result.linkedinUrl)
                  return <TableRow key={result.id}>
                    <TableCell><input type="checkbox" aria-label={`Select ${result.name}`} disabled={!canAdd} checked={selectedDiscoveryIds.includes(result.id)} onChange={() => toggleDiscoverySelection(result.id)} /></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.name}</strong><small>{result.education} · {result.graduationYear || "Year not returned"}</small></span></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.currentCompany}</strong><small>{result.role}</small></span></TableCell>
                    <TableCell>{result.function}</TableCell><TableCell>{result.seniority}</TableCell><TableCell>{result.location}</TableCell>
                    <TableCell><DiscoveryBadge status={result.matchStatus} /><small className="review-status">{discoveryReviewLabel(result.reviewStatus)}{result.reviewNote ? ` · ${result.reviewNote}` : ""}</small></TableCell>
                    <TableCell><span className={`score-pill ${scoreTone(result.matchConfidence)}`}>{result.matchConfidence}%</span></TableCell>
                    <TableCell>{professionalProfileUrl ? <span className="stacked-cell"><a className="professional-link" href={professionalProfileUrl} target="_blank" rel="noopener noreferrer">View LinkedIn Profile <ArrowUpRight /></a><small>PDL sourced professional profile</small></span> : <span className="muted-cell">Not returned or invalid</span>}</TableCell>
                    <TableCell><div className="row-actions">
                      {canAdd && <Button size="sm" onClick={() => void approveDiscoveryResults([result.id])}><Plus /> Add</Button>}
                      {result.reviewStatus === "Pending review" && (result.matchStatus === "Already in database" || result.matchStatus === "Possible duplicate") && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><GitCompare /> Compare</Button>}
                      {result.reviewStatus === "Pending review" && result.matchStatus === "Needs review" && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><Eye /> Review</Button>}
                      {added && (() => { const person = alumni.find(item => item.id === result.linkedInternalAlumnusId); return person ? providerModes.lusha === "live" ? <Button size="sm" variant="outline" onClick={() => prepareLushaEmail(person)}>Prepare Email Reveal</Button> : <><Button size="sm" variant="outline" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["email"])}>Get Email</Button><Button size="sm" variant="outline" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["phone"])}>Get Phone</Button><Button size="sm" onClick={() => void runEnrichment([person.id], ["lusha"], "manual", ["email", "phone"])}>Get Both Contacts</Button></> : null })()}
                      {result.reviewStatus === "Pending review" && <Button size="sm" variant="ghost" onClick={() => { setIgnoreResult(result); setIgnoreReason("Wrong person") }}><XCircle /> Ignore</Button>}
                    </div></TableCell>
                  </TableRow>
                })}</TableBody>
              </Table></div>
              {discoveryState === "empty" && !discoveryResults.length && <div className="empty-state"><Search /><h3>No additional external alumni were found</h3><p>The PDL search ran successfully. Broaden optional filters such as location or seniority.</p></div>}
              {discoveryState === "blocked" && !discoveryResults.length && <div className="empty-state blocked-search"><Ban /><h3>External search was not run</h3><p>Review the explanation above. No result is being treated as a successful zero-result search.</p></div>}
            </section>}
          </TabsContent>

          <TabsContent value="companies" className="tab-panel">
            <section className="company-toolbar"><div><p className="eyebrow">Company intelligence</p><h2>Map the strongest route into a target firm.</h2></div>{companies.length > 0 ? <div className="company-actions"><Select value={activeTargetCompany} onValueChange={changeTargetCompany}><SelectTrigger className="company-select"><Building2 /><SelectValue /></SelectTrigger><SelectContent>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>{session.canOperate && <Button onClick={() => findMoreForCompany(activeTargetCompany)} disabled={discovering}><Search /> Discover More Alumni</Button>}</div> : session.canOperate ? <Button onClick={() => changeWorkspaceTab("directory")}><Search /> Discover alumni</Button> : null}</section>
            {companies.length === 0 ? <section className="panel empty-state"><Building2 /><h3>No companies are mapped yet</h3><p>Approve a reviewed external profile or import approved alumni data to create company intelligence.</p></section> : <section className="company-grid">
              <article className="panel company-summary">
                <div className="company-title"><div className="company-logo">{activeTargetCompany.slice(0, 1)}</div><div><h2>{activeTargetCompany}</h2><span>Target company · Priority inherited by all mapped alumni</span></div></div>
                <div className="company-priority"><label>Company priority</label><Select value={companyPriorities[activeTargetCompany] || "Secondary Target"} disabled={!session.canAdminister} onValueChange={value => updateCompanyPriority(activeTargetCompany, value)}><SelectTrigger aria-label="Company priority"><SelectValue /></SelectTrigger><SelectContent>{companyPriorityOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select><small>Company Priority contributes to Placement Relevance for every alumnus at {activeTargetCompany}. {session.canAdminister ? "Changes apply to all mapped alumni." : "PCOM can view this value; only an Admin can change it."}</small></div>
                <div className="company-kpis"><div><strong>{targetAlumni.length}</strong><span>Alumni mapped</span></div><div><strong>{targetAlumni.filter(p => optionScore(seniorityOptions, seniorityLabel(p)) >= 80).length}</strong><span>Senior leaders</span></div><div><strong>{targetAlumni.filter(p => p.function === "HR").length}</strong><span>HR contacts</span></div><div><strong>{targetAlumni.filter(p => operationalStatus(p) === "Contact-ready").length}</strong><span>Contact-ready</span></div></div>
                <div className="distribution"><h3>Network by function</h3>{Object.entries(functionCounts).map(([name, count]) => <div key={name} className="distribution-row"><span>{name}</span><div><i style={{ width: `${Math.max(24, count / Math.max(targetAlumni.length, 1) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
              </article>
              <article className="panel contacts-panel"><div className="panel-heading"><div><p className="eyebrow">Recommended contacts</p><h2>Best people to approach</h2></div></div>{targetAlumni.length ? targetAlumni.map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; const unknownRelationship = person.assessment.iimlRelationship === "Unknown / Not assessed"; return <button key={person.id} className="contact-card" onClick={() => openAlumnusProfile(person)}><span className="avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small><em className={unknownRelationship ? "relationship-neutral" : ""}>{unknownRelationship ? "IIML relationship not assessed" : `${person.assessment.iimlRelationship} IIML relationship`}</em></span><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></button> }) : <div className="empty-state"><ContactRound /><h3>No alumni mapped yet</h3><p>This is a clear network gap for the committee.</p></div>}</article>
              {session.canOperate && <article className="panel company-route-card"><div className="panel-heading"><div><p className="eyebrow">Plan outreach</p><h2>How should we approach?</h2><span>Selecting a company does not automatically choose the target person.</span></div></div><AlumnusCombobox options={targetAlumni} value={targetAlumnusId} onValueChange={selectTargetAlumnus} /><Button title={!targetAlumnusId ? "Select a target alumnus first." : routeLoading ? "The route recommendation is still being prepared." : undefined} disabled={!targetAlumnusId || routeLoading} onClick={() => void recommendRoute()}><Network /> Recommend Route</Button>{!targetAlumni.length && <small>Add or discover an alumnus at {activeTargetCompany} before requesting a route.</small>}</article>}
              <article className="panel account-history"><div className="panel-heading"><div><p className="eyebrow">Institutional memory</p><h2>Account history</h2></div></div>{companyEngagements.length ? <div className="account-history-list">{companyEngagements.slice(0, 5).map(event => <div key={event.id}><History /><span><strong>{event.eventTitle}</strong><small>{event.alumnus?.name} · {displayEventDate(event.actionTakenAt || event.eventDate)} · {event.status}</small></span></div>)}</div> : <div className="account-history-empty"><History /><span><strong>Account history</strong><small>No company engagement recorded yet.</small></span></div>}</article>
            </section>}
          </TabsContent>

          <TabsContent value="engagement" className="tab-panel">
            <section className="engagement-header">
              <div><p className="eyebrow">Shared relationship actions</p><h2>Engagement queue</h2><span>Views, ownership, emails, responses, and follow-ups are shared across committee members.</span></div>
              <div className="demo-user"><label>Signed-in owner</label><strong>{session.displayName}</strong><small>Actions use your authenticated identity</small></div>
            </section>

            <section className="signals-readiness"><div><Sparkles /><span><strong>Professional Signals</strong><small>Individual promotions and job/company changes only</small></span></div><span className={`provider-mode mode-${signalsActive ? "live" : "mock"}`}>{signalsActive ? "LIVE · entitlement confirmed" : signalsStatus?.entitlement === "not_entitled" ? "OFF · account not entitled" : "Professional Signals are prepared but not activated."}</span><small>Signals enter human review and never overwrite alumni profiles automatically.</small>{session.canOperate && <div className="signals-selector"><Select value={signalsAlumnusId ? String(signalsAlumnusId) : ""} onValueChange={value => setSignalsAlumnusId(Number(value))}><SelectTrigger><SelectValue placeholder="Select approved alumnus" /></SelectTrigger><SelectContent>{alumni.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.name} — {person.lushaPersonId ? "Stable Lusha ID available" : "Lusha ID required"}</SelectItem>)}</SelectContent></Select>{signalsTarget && <small>{signalsTarget.lushaPersonId ? "Eligible identity: existing stable Lusha contact ID" : "Lusha contact identity required before Professional Signals can be checked."}</small>}{signalsActive && <Button title={!signalsTarget ? "Select an alumnus first." : !signalsTarget.lushaPersonId ? "Requires a stored Lusha contact ID." : undefined} size="sm" disabled={!signalsTarget?.lushaPersonId} onClick={() => setSignalsConfirmOpen(true)}><Sparkles /> Check Professional Signals</Button>}</div>}</section>
            {signalsMessage && <div className="discovery-message">{signalsMessage}</div>}

            <section className="engagement-stats">
              <article><BellRing /><span>New professional signals<strong>{professionalEvents.filter(event => event.status === "New").length}</strong></span></article>
              <article><Cake /><span>Birthdays today<strong>{birthdaysToday.length}</strong></span></article>
              <article><UserRoundCheck /><span>Assigned to me<strong>{assignedToMe.length}</strong></span></article>
              <article><CalendarClock /><span>Follow-ups due<strong>{followUpsDue.length}</strong></span></article>
            </section>

            <section className="panel engagement-panel">
              <div className="engagement-filterbar">
                <div className="engagement-filter-tabs">{["Needs Action", "Professional Signals", "Birthdays", "Assigned to Me", "Follow-ups", "Completed", "Skipped"].map(filter => <button key={filter} className={engagementFilter === filter ? "active" : ""} onClick={() => setEngagementFilter(filter)}>{filter}</button>)}</div>
                <div className={`mail-mode mail-${mailMode}`}><Mail /> {mailMode === "mock" ? "Mock mail · sending disabled" : mailConfigured ? "Live mail · configured" : "Live mail · credentials missing"}</div>
              </div>

              {engagementFilter === "Birthdays" && <div className="birthday-filters">
                <Select value={birthdayWindow} onValueChange={setBirthdayWindow}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Today", "Tomorrow", "Next 7 Days", "This Month", "All upcoming"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={birthdayCompany} onValueChange={setBirthdayCompany}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All companies">All companies</SelectItem>{companies.map(company => <SelectItem key={company} value={company}>{company}</SelectItem>)}</SelectContent></Select>
                <Select value={birthdayEmailFilter} onValueChange={setBirthdayEmailFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All email states">All email states</SelectItem><SelectItem value="Email available">Email available</SelectItem><SelectItem value="Email unavailable">Email unavailable</SelectItem></SelectContent></Select>
                <div className="birthday-bulk-summary"><span>{selectedBirthdayIds.length} selected</span><Button variant="outline" disabled={!selectedBirthdayIds.length || engagementLoading} onClick={() => void previewSelectedBirthdays()}><Eye /> Preview Selected Emails</Button></div>
              </div>}

              {engagementMessage && <div className="engagement-message"><Activity /><span>{engagementMessage}</span><button aria-label="Dismiss message" onClick={() => setEngagementMessage("")}><XCircle /></button></div>}

              <div className="engagement-list">{visibleEngagements.map(event => {
                const person = alumni.find(item => item.id === event.alumnusId)
                const relevance = person ? relevanceBreakdown(person, companyPriorities, engagements).score : 50
                const completed = isCompletedEngagement(event.status)
                const emailMissing = !event.alumnus?.email
                const canEmail = event.eventType === "Professional Signal" ? Boolean(event.alumnus?.email) && !completed : birthdayReady(event)
                const eventBusy = pendingEngagementKeys.has(`event:${event.id}`)
                return <article key={event.id} className={`engagement-card ${completed ? "completed" : ""}`}>
                  {event.eventType === "Birthday" && <input type="checkbox" aria-label={`Select ${event.alumnus?.name} birthday`} disabled={!birthdayReady(event)} checked={selectedBirthdayIds.includes(event.id)} onChange={() => toggleBirthdaySelection(event.id)} />}
                  <div className={`event-icon event-${event.eventType.toLowerCase().replaceAll(" ", "-")}`}>{event.eventType === "Birthday" ? <Cake /> : <ArrowUpRight />}</div>
                  <div className="event-copy"><div className="event-person"><strong>{event.alumnus?.name ?? "Unknown alumnus"}</strong><span>{event.alumnus?.company} · {event.alumnus?.title}</span></div><h3>{event.eventTitle}</h3><p>{event.eventDescription}</p><div className="event-meta"><span>{displayEventDate(event.eventDate)}</span><span>Source: {event.source}</span>{event.birthday && <span>{event.birthday.status}</span>}{event.eventType === "Birthday" && <span>{birthdayReady(event) ? "Email ready" : emailMissing ? "Email unavailable" : "Review required"}</span>}</div></div>
                  <div className="event-state"><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span><EngagementStatusBadge status={event.status} />{event.assignedTo && <small>Assigned to <strong>{event.assignedTo}</strong></small>}{event.actionTakenBy && <small>Already engaged by <strong>{event.actionTakenBy}</strong></small>}{event.skipReason && <small>{event.skipReason}</small>}</div>
                  <div className="event-actions">
                    {!completed && !event.assignedTo && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void postEngagement("assign", event.id)}>Take Ownership</Button>}
                    {!completed && event.assignedTo && event.assignedTo !== currentDemoUser && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void postEngagement("assign", event.id, { force: true })}>Reassign to Me</Button>}
                    {!completed && event.eventType === "Birthday" && emailMissing && <Button variant="outline" size="sm" disabled={eventBusy} onClick={() => void getBirthdayEmail(event)}>Get Email via Lusha</Button>}
                    {canEmail && <Button size="sm" disabled={eventBusy} onClick={() => void previewEngagement(event)}>{event.eventType === "Birthday" ? <Cake /> : <Mail />} {event.eventType === "Birthday" ? "Preview Wish" : "Send Congratulations"}</Button>}
                    <Button variant="ghost" size="sm" disabled={eventBusy} onClick={() => void openEngagement(event)}>{completed ? "View Engagement" : "Review"}</Button>
                  </div>
                </article>
              })}</div>
              {!visibleEngagements.length && <div className="empty-state"><CheckCircle2 /><h3>No engagement events in this view</h3><p>Choose another queue filter or refresh the shared workspace.</p></div>}
            </section>
          </TabsContent>

          <TabsContent value="outreach" className="tab-panel">
            <section className="panel outreach-panel">
              <div className="panel-heading"><div><p className="eyebrow">Relationship workflow</p><h2>Outreach pipeline</h2><span>Updates are saved centrally and shared across committee members.</span></div></div>
              <div className="pipeline-summary">{statusOptions.map(status => <div key={status}><StatusBadge status={status} /><strong>{alumni.filter(person => person.status === status).length}</strong></div>)}</div>
              <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Target company</TableHead><TableHead>Why this person</TableHead><TableHead>Placement relevance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[...alumni].sort((a, b) => relevanceBreakdown(b, companyPriorities, engagements).score - relevanceBreakdown(a, companyPriorities, engagements).score).map(person => { const relevance = relevanceBreakdown(person, companyPriorities, engagements).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small></span></button></TableCell><TableCell>{person.company}</TableCell><TableCell className="reason-cell">{person.note}</TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><Select value={person.status} onValueChange={value => updateStatus(person.id, value as OutreachStatus)}><SelectTrigger className="status-select"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></TableCell></TableRow> })}</TableBody></Table>
            </section>
          </TabsContent>

          <TabsContent value="data-import" className="tab-panel">
            <section className="import-layout">
              <article className="panel import-panel">
                <div className="panel-heading"><div><p className="eyebrow">Bulk import</p><h2>Upload CSV</h2><span>Best for adding or updating many alumni at once.</span></div><div className="database-badge"><Database /> Shared database</div></div>
                <div className="import-body">
                  <div className="upload-zone">
                    <FileSpreadsheet />
                    <div><strong>{importFile ? importFile.name : "Choose an alumni CSV file"}</strong><span>Required: name, batch and company. Existing records are matched by name, batch and company.</span></div>
                    <input aria-label="Choose alumni CSV file" type="file" accept=".csv,text/csv" onChange={event => setImportFile(event.target.files?.[0] ?? null)} />
                  </div>
                  <div className="import-actions"><Button variant="outline" onClick={downloadTemplate}><Download /> Download template</Button><Button title={!importFile ? "Choose a CSV file first." : importing ? "The selected file is still being imported." : undefined} onClick={importAlumni} disabled={!importFile || importing}>{importing ? <LoaderCircle className="spin" /> : <Upload />} {importing ? "Importing" : "Import to shared database"}</Button></div>
                  {workspaceMessage && <div className="workspace-message"><Cloud /> <span>{workspaceMessage}</span></div>}
                </div>
              </article>

              <article className="panel manual-entry-card"><div className="manual-entry-icon"><Plus /></div><div><p className="eyebrow">Manual entry</p><h2>Add one alumnus</h2><span>Best for one or a few known alumni when preparing a CSV is unnecessary.</span></div><Button onClick={() => { setManualForm(current => ({ ...current, programme: activeProgrammeChoices.some(option => option.value === current.programme) ? current.programme : activeProgrammeChoices[0]?.value ?? "" })); setManualOpen(true); setManualSaved(null); setManualMatches([]); setManualMessage("") }}><Plus /> Add Alumnus</Button><small>Duplicate checking runs before any record is saved. Provider calls remain optional.</small></article>

              <aside className="panel database-panel">
                <div className="database-hero"><Database /><div><p className="eyebrow">Central data state</p><h2>{alumni.length} alumni records</h2><span>{companies.length} companies in one shared workspace</span></div></div>
                <div className="database-facts"><div><span>Persistence</span><strong>Across users and devices</strong></div><div><span>Duplicate control</span><strong>Name + batch + company</strong></div><div><span>Maximum batch</span><strong>250 records per import</strong></div><div><span>Current source</span><strong>{latestImport?.filename ?? "No alumni data imported"}</strong></div></div>
                <div className="latest-import"><CheckCircle2 /><div><strong>{latestImport ? "Latest import completed" : "Database ready"}</strong><span>{latestImport ? `${latestImport.rowCount} records by ${latestImport.importedBy}` : "No uploaded file has been recorded yet."}</span></div></div>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="enrichment" className="tab-panel">
            <section className="enrichment-header">
              <div><p className="eyebrow">PDL and Lusha</p><h2>Provider enrichment centre</h2><span>Refresh professional profiles, retrieve contact channels and control paid usage from one place.</span></div>
              <span className={`provider-mode mode-${providerModes.pdl}`}>PDL {providerModes.pdl.toUpperCase()} · Lusha {providerModes.lusha.toUpperCase()}</span>
            </section>

            <section className="provider-grid">
              {(["pdl", "lusha"] as Provider[]).map(provider => {
                const usage = providerUsage[provider]
                const percent = usage.limit ? Math.min(100, usage.used / usage.limit * 100) : 100
                return <article className="panel provider-card" key={provider}>
                  <div className="provider-title"><span>{provider === "pdl" ? "PDL" : "LU"}</span><div><h3>{provider === "pdl" ? "People Data Labs" : "Lusha"}</h3><small>{provider === "pdl" ? "Profile discovery and employment refresh" : "Email and phone enrichment"}</small></div></div>
                  <div className="provider-status"><span className={usage.configured ? "configured" : "not-configured"}>{provider === "pdl" ? "People Data Labs" : "Lusha"} — {providerModes[provider].toUpperCase()}{providerModes[provider] === "live" ? usage.configured ? " · key configured" : " · key missing" : ""}</span><strong>{usage.remaining} app credits remaining</strong></div>
                  <div className="credit-meter"><i style={{ width: `${percent}%` }} /></div>
                  <div className="credit-numbers"><span>{usage.used} used this month</span><span>{usage.limit} app limit</span></div>
                  <div className="credit-limit"><Input type="number" min="0" value={creditDrafts[provider]} disabled={!session.canAdminister} onChange={event => setCreditDrafts(current => ({ ...current, [provider]: event.target.value }))} aria-label={`${provider} monthly credit limit`} />{session.canAdminister && <Button variant="outline" onClick={() => void saveCreditLimit(provider)}>Save limit</Button>}</div>
                  {provider === "pdl" && session.canAdminister && providerModes.pdl === "live" && <Button variant="outline" onClick={() => void validatePdlConnection()}>Validate PDL connection</Button>}
                  {provider === "lusha" && session.canAdminister && providerModes.lusha === "live" && <Button variant="outline" onClick={() => void validateLushaConnection()}>Validate Lusha connection</Button>}
                  {!session.canAdminister && <small className="role-restriction">Only an Admin can change application credit limits.</small>}
                  <p>{provider === "pdl" ? "A successful match is counted as 1 PDL credit." : "This is Corporate Network's application limit, not the Lusha account balance. V3 requests may include request/result usage plus selected reveal fields. Provider-reported usage is recorded; unavailable per-call usage is flagged for account reconciliation."}</p>
                </article>
              })}
            </section>

            <section className="panel batch-panel">
              <div className="panel-heading"><div><p className="eyebrow">Selected alumni actions</p><h2>{session.canOperate ? providerModes.pdl === "live" ? "Select one approved alumnus for controlled provider actions" : "Select up to 25 approved alumni" : "Provider diagnostics"}</h2><span>{session.canOperate ? `${selectedForEnrichment.length} selected. PDL refresh and Lusha email preparation remain separate. No live action runs without confirmation.` : "Developer access is read-only. Credit-consuming operations and provider history are restricted."}</span></div>{session.canOperate && <div className="batch-actions"><Button variant="outline" disabled={!pdlSelectionReady || enriching} title={!selectedForEnrichment.length ? "Select at least one alumnus" : !pdlSelectionReady ? "PDL is unavailable or its application limit is insufficient" : "Review and refresh professional profiles"} onClick={() => setRefreshConfirmOpen(true)}><Cloud /> Refresh Profiles</Button>{providerModes.lusha === "live" ? <Button variant="outline" disabled={!lushaEmailReady || enriching} title={!selectedForEnrichment.length ? "Select one alumnus" : !lushaEmailReady ? "Select exactly one alumnus and confirm Lusha is configured with application capacity" : "Start the controlled Lusha V3 email workflow"} onClick={() => { const person = alumni.find(item => item.id === selectedForEnrichment[0]); if (person) prepareLushaEmail(person) }}><Mail /> Prepare Email Reveal</Button> : <><Button variant="outline" disabled={!lushaEmailReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email"])}>Get Emails</Button><Button variant="outline" disabled={!lushaPhoneReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["phone"])}>Get Phones</Button><Button disabled={!lushaBothReady || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email", "phone"])}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both Contacts</Button></>}</div>}</div>
              {enrichmentMessage && <div className="enrichment-message"><Activity /> <span>{enrichmentMessage}</span></div>}
              <Table><TableHeader><TableRow><TableHead>{session.canOperate && <input type="checkbox" aria-label={providerModes.pdl === "live" ? "Select first alumnus" : "Select first 25 alumni"} checked={Boolean(alumni.length) && selectedForEnrichment.length === Math.min(providerModes.pdl === "live" ? 1 : 25, alumni.length)} onChange={event => setSelectedForEnrichment(event.target.checked ? alumni.slice(0, providerModes.pdl === "live" ? 1 : 25).map(person => person.id) : [])} />}</TableHead><TableHead>Alumnus</TableHead><TableHead>Current profile</TableHead><TableHead>Email status</TableHead><TableHead>Phone status</TableHead><TableHead>Last profile refresh</TableHead></TableRow></TableHeader><TableBody>{alumni.map(person => { const emailState = contactDataLabel(person, "email"); const phoneState = contactDataLabel(person, "phone"); return <TableRow key={person.id}><TableCell>{session.canOperate && <input type="checkbox" aria-label={`Select ${person.name}`} checked={selectedForEnrichment.includes(person.id)} onChange={() => toggleEnrichmentSelection(person.id)} />}</TableCell><TableCell><button className="person-cell" onClick={() => openAlumnusProfile(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{educationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell><span className="contact-state"><strong>{emailState.status}</strong><small>{emailState.detail}</small></span></TableCell><TableCell><span className="contact-state"><strong>{phoneState.status}</strong><small>{phoneState.detail}</small></span></TableCell><TableCell>{person.lastPdlRefresh ? new Date(person.lastPdlRefresh).toLocaleDateString() : "Not refreshed"}</TableCell></TableRow> })}</TableBody></Table>
            </section>

            <section className="panel history-panel">
              <div className="panel-heading"><div><p className="eyebrow">Provider-response history</p><h2>{session.canOperate ? "Complete enrichment audit trail" : "Operational history restricted"}</h2><span>{session.canOperate ? "Sanitised request outcomes are shared centrally. API secrets and raw sensitive payloads are never stored here." : "Developer access includes provider health and usage status, not alumni-specific provider responses."}</span></div>{session.canOperate && <Button variant="ghost" size="sm" onClick={() => void loadEnrichment()}>Refresh history</Button>}</div>
              <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Provider</TableHead><TableHead>Alumnus</TableHead><TableHead>Operation</TableHead><TableHead>Result</TableHead><TableHead>Credits</TableHead><TableHead>Response</TableHead></TableRow></TableHeader><TableBody>{providerHistory.map(item => { const usage = providerUsageLabel(item); return <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell><TableCell><span className="provider-chip">{item.provider.toUpperCase()}</span></TableCell><TableCell>{item.alumnusName}</TableCell><TableCell>{item.operation} · {item.mode}</TableCell><TableCell><span className={`history-status history-${item.status}`}>{item.status.replace("_", " ")}</span>{item.resultCount ? <small className="review-status">{item.resultCount} results</small> : null}</TableCell><TableCell><span className="stacked-cell"><strong>{usage.label}</strong><small>{usage.detail}</small>{item.reconciliationSource && <small>{item.reconciliationSource}</small>}{session.canAdminister && usage.label === "Reconciliation required" && <span className="usage-reconcile"><Input type="number" min="0" step="1" value={usageReconciliationDrafts[item.id] ?? ""} onChange={event => setUsageReconciliationDrafts(current => ({ ...current, [item.id]: event.target.value }))} aria-label={`Observed account delta for ${item.operation}`} placeholder="Observed delta" /><Button size="sm" variant="outline" onClick={() => void reconcileProviderUsage(item)}>Reconcile</Button></span>}</span></TableCell><TableCell className="response-cell">{item.requestSummary && <small>{item.requestSummary}</small>}{item.errorMessage || item.responseSummary}</TableCell></TableRow> })}</TableBody></Table>
              {!providerHistory.length && <div className="empty-state"><Activity /><h3>No provider responses yet</h3><p>Run a manual or batch enrichment to create the first audit entry.</p></div>}
            </section>
          </TabsContent>
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
            <section className="profile-section profile-order-iiml"><h3>IIM Lucknow context</h3><div className="detail-grid"><div><CircleUserRound /><span>Programme and batch<strong>{educationLabel(selected)}</strong></span></div><div><Network /><span>Placement Committee relationship<strong>{session.canOperate ? selected.assessment.iimlRelationship === "Unknown / Not assessed" ? "No prior Placement Committee engagement" : selected.assessment.iimlRelationship : "Restricted for Developer role"}</strong></span></div></div>{session.canOperate && <><div className="insight-note"><Sparkles /><p>{placementContext(selected)}</p></div><Button className="profile-route-button" onClick={() => { const id = selected.id; void recommendRoute(id) }}><Network /> Recommend Outreach Route</Button></>}</section>
            {session.canOperate && <section className="profile-section privacy-section profile-order-permissions"><h3>Contact permissions</h3><p className="section-help">Unknown is not permission. The server checks the overall ceiling and the purpose-specific permission before every send.</p><div className="assessment-grid"><label><span>Overall contact permission</span><Select value={selected.privacy?.generalContactStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { generalContactStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Standard engagement allowed", "Professional engagement only", "Birthday engagement allowed", "No birthday engagement", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Professional outreach</span><Select value={selected.privacy?.professionalEngagementStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { professionalEngagementStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Standard engagement allowed", "Professional engagement only", "No professional engagement", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Birthday outreach</span><Select value={selected.privacy?.birthdayEngagementStatus || "Unknown"} onValueChange={value => void updatePrivacy(selected, { birthdayEngagementStatus: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Birthday engagement allowed", "No birthday engagement", "Professional engagement only", "Do not contact", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Permission source</span><Select value={selected.privacy?.consentSource || "Unknown"} onValueChange={value => void updatePrivacy(selected, { consentSource: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Internal institutional record", "Alumni-confirmed", "Manual PCOM record", "Provider sourced", "Unknown"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label></div><details className="permission-details"><summary>More details</summary><label><span>Permission note</span><Textarea value={privacyNoteDrafts[selected.id] ?? selected.privacy?.notes ?? ""} onChange={event => setPrivacyNoteDrafts(current => ({ ...current, [selected.id]: event.target.value }))} onBlur={event => void updatePrivacy(selected, { notes: event.target.value })} /></label></details></section>}
            {session.canOperate && <section className="profile-section profile-order-engagement"><div className="profile-engagement-heading"><div><h3>Needs attention</h3><small>{selectedUpcomingEngagements.length} open item{selectedUpcomingEngagements.length === 1 ? "" : "s"}</small></div><Button size="sm" variant="ghost" onClick={() => { setEngagementFilter("Needs Action"); changeWorkspaceTab("engagement") }}>Open queue</Button></div>{selectedUpcomingEngagements.length ? <div className="profile-event-list">{selectedUpcomingEngagements.map(event => <button key={event.id} onClick={() => { changeWorkspaceTab("engagement"); void openEngagement(event) }}><span>{event.eventType === "Birthday" ? <Cake /> : <BellRing />}</span><div><strong>{event.eventTitle}</strong><small>{displayEventDate(event.eventDate)} · {event.status}</small></div><ChevronRight /></button>)}</div> : <p className="section-help profile-empty-copy">No open engagement items need attention.</p>}<h3 className="history-title">Engagement history</h3><div className="profile-timeline">{selectedCompletedEngagements.map(event => <div key={event.id}><span>{event.eventType === "Birthday" ? <Cake /> : <MessageSquare />}</span><p><strong>{displayEventDate(event.actionTakenAt || event.eventDate)}</strong>{event.eventTitle}<small>{event.actionType || event.status}{event.actionTakenBy ? ` · by ${event.actionTakenBy}` : ""}</small></p></div>)}{providerHistory.filter(item => item.alumnusName === selected.name).slice(0, 3).map(item => { const usage = providerUsageLabel(item); return <div key={`provider-${item.id}`}><span><Cloud /></span><p><strong>{new Date(item.createdAt).toLocaleDateString()}</strong>{item.provider.toUpperCase()} {item.operation}<small>{item.status} · {usage.label === "—" ? usage.label : `${usage.label} credits`}</small></p></div> })}{!selectedCompletedEngagements.length && !providerHistory.some(item => item.alumnusName === selected.name) && <p className="section-help">No completed engagement or provider history recorded.</p>}</div></section>}
            <section className="profile-section profile-order-verification"><div className="verification-heading"><div><h3>Contact and verification</h3><span className={`operational-status status-${operationalStatus(selected).toLowerCase().replaceAll(" ", "-")}`}>{operationalStatus(selected)}</span></div><small>Last data check: {selected.verified}</small></div><div className="verification-list">
              <div><span>Profile match</span><strong className={verificationTone(selected.verification.profileMatch)}>{selected.verification.profileMatch}</strong></div>
              <div><span>Current company</span><strong className={verificationTone(selected.verification.currentCompany)}>{selected.verification.currentCompany}</strong></div>
              <div><span>Designation</span><strong className={verificationTone(selected.verification.designation)}>{selected.verification.designation}</strong></div>
              <div><span>Email · {selected.email || "Not enriched"}</span><strong className={verificationTone(selected.verification.email)}>{contactDataLabel(selected, "email").status} · {contactDataLabel(selected, "email").detail}</strong></div>
              <div><span>Phone · {selected.phone || "Not enriched"}</span><strong className={verificationTone(selected.verification.phone)}>{contactDataLabel(selected, "phone").status} · {contactDataLabel(selected, "phone").detail}</strong></div>
              <div><span>Location</span><strong className={verificationTone(selected.verification.location)}>{selected.verification.location}</strong></div>
            </div><p className="verified-copy">{session.canViewContacts ? "A stored Verified status reflects the recorded workflow state. Provider-sourced data is identified separately and does not imply independent deliverability or ownership verification." : "Contact values are masked for the Developer role and were never sent to this browser in full."}</p><div className="refresh-note"><strong>Last profile refresh</strong><span>{selected.lastPdlRefresh ? new Date(selected.lastPdlRefresh).toLocaleString() : "Not refreshed yet"}. A successful PDL return may consume a credit even when no information changes.</span></div>{session.canOperate && (() => { const missing = missingLushaChannels(selected); return <div className="manual-enrichment"><Button variant="outline" disabled={enriching || providerUsage.pdl.remaining < 1 || (providerModes.pdl === "live" && !providerUsage.pdl.configured)} onClick={() => compareRefreshWithPdl(selected)}>Refresh Profile via PDL</Button>{providerModes.lusha === "live" ? <Button variant="outline" title={selected.verification.email === "Verified" ? "A verified email is already stored; no additional email credit is needed." : undefined} disabled={selected.verification.email === "Verified" || enriching || providerUsage.lusha.remaining < 1 || !providerUsage.lusha.configured} onClick={() => prepareLushaEmail(selected)}>Prepare Email Reveal</Button> : <><Button variant="outline" title={selected.verification.email === "Verified" ? "A verified email is already stored." : undefined} disabled={selected.verification.email === "Verified" || enriching || providerUsage.lusha.remaining < 1} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["email"])}>Get Email via Lusha</Button><Button variant="outline" title={selected.verification.phone === "Verified" ? "A verified phone is already stored." : undefined} disabled={selected.verification.phone === "Verified" || enriching || providerUsage.lusha.remaining < 5} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["phone"])}>Get Phone via Lusha</Button><Button title={!missing.length ? "Verified email and phone are already stored." : `Only missing or unverified channels will be requested: ${missing.join(" and ")}.`} disabled={!missing.length || enriching || providerUsage.lusha.remaining < (missing.includes("phone") ? 5 : 0) + (missing.includes("email") ? 1 : 0)} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", missing)}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both Contacts</Button></>}</div> })()}</section>
            {session.canOperate && <section className="profile-section profile-order-status"><h3>Update outreach status</h3><Select value={selected.status} onValueChange={value => updateStatus(selected.id, value as OutreachStatus)}><SelectTrigger className="profile-status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><p className="verified-copy">Saved centrally. Last updated by {selected.updatedBy ?? "the committee"}.</p></section>}
          </div></>}
        </SheetContent>
      </Sheet>

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
              {selectedEngagement.assignedTo && <div className="assignment-note"><UserRoundCheck /><span>Assigned to <strong>{selectedEngagement.assignedTo}</strong>{selectedEngagement.assignedAt ? ` since ${new Date(selectedEngagement.assignedAt).toLocaleString()}` : ""}</span></div>}

              {!['Action Taken', 'Response Received', 'Closed', 'Skipped'].includes(selectedEngagement.status) && <section className="dialog-action-section"><h3>Review and action</h3><div className="dialog-actions">
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("acknowledge", selectedEngagement.id)}>Acknowledge</Button>
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("assign", selectedEngagement.id, { force: Boolean(selectedEngagement.assignedTo && selectedEngagement.assignedTo !== currentDemoUser) })}>{selectedEngagement.assignedTo && selectedEngagement.assignedTo !== currentDemoUser ? "Reassign to Me" : "Take Ownership"}</Button>
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("plan", selectedEngagement.id, { notes: "Follow-up action planned by the assigned committee member.", force: Boolean(selectedEngagement.assignedTo && selectedEngagement.assignedTo !== currentDemoUser) })}>Plan Action</Button>
                {selectedEngagement.alumnus?.email ? <Button disabled={selectedEngagementBusy} onClick={() => void previewEngagement(selectedEngagement)}><Mail /> {selectedEngagement.eventType === "Birthday" ? "Preview Birthday Wish" : "Preview Congratulations"}</Button> : <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void getBirthdayEmail(selectedEngagement)}>Get Email via Lusha</Button>}
                <Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("manual_action", selectedEngagement.id, { notes: "Engagement completed outside the platform." })}>Mark Action Taken</Button>
              </div></section>}

              <section className="dialog-action-section"><h3>Response and follow-up</h3><div className="response-form"><Select value={responseType} onValueChange={setResponseType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Positive", "Neutral", "Negative", "Introduction offered", "Meeting requested", "Other"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Input value={followUpDate} onChange={event => setFollowUpDate(event.target.value)} type="date" aria-label="Follow-up date" /><Textarea value={responseNotes} onChange={event => setResponseNotes(event.target.value)} placeholder="Response or follow-up notes" /><div><Button variant="outline" disabled={selectedEngagementBusy} onClick={() => void postEngagement("response", selectedEngagement.id, { responseType, notes: responseNotes, followUpRequired: Boolean(followUpDate), followUpDate })}>Record Response</Button><Button variant="outline" disabled={!followUpDate || selectedEngagementBusy} title={!followUpDate ? "Choose a follow-up date first." : undefined} onClick={() => void postEngagement("follow_up", selectedEngagement.id, { followUpDate })}>Add Follow-up</Button></div></div></section>

              {selectedEngagement.eventType === "Birthday" && <section className="dialog-action-section"><h3>Birthday data</h3><div className="birthday-data-row"><div><span>Birthday</span><strong>{selectedEngagement.birthday?.birthMonthDay || "Unknown"}</strong></div><div><span>Source</span><strong>{selectedEngagement.birthday?.source || "Not recorded"}</strong></div><div><span>Status</span><strong>{selectedEngagement.birthday?.status || "Unknown"}</strong></div></div><div className="birthday-correction"><Input value={birthdayCorrection} onChange={event => setBirthdayCorrection(event.target.value)} placeholder="MM-DD" aria-label="Correct birthday as MM-DD" /><Button variant="outline" onClick={() => void postEngagement("correct_birthday", selectedEngagement.id, { birthMonthDay: birthdayCorrection })}>Confirm Correction</Button></div></section>}

              <section className="dialog-action-section"><h3>Event activity</h3><div className="activity-timeline">{selectedEngagement.activity.map(item => <div key={item.id}><span>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><p><strong>{item.action.replaceAll("_", " ")}</strong>{item.details}<small>{item.actor} · {new Date(item.createdAt).toLocaleDateString()}</small></p></div>)}{!selectedEngagement.activity.length && <p className="section-help">No activity has been recorded yet.</p>}</div></section>

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
        <DialogContent className="manual-dialog"><DialogHeader><DialogTitle>{manualSaved ? "Alumnus added" : "Add alumnus manually"}</DialogTitle><DialogDescription>{manualSaved ? `The record is now in ${appConfig.name}. Provider actions remain optional.` : "Enter what is known. Name plus an email, profile URL, or company and graduation year is required."}</DialogDescription></DialogHeader>
          {manualSaved ? <div className="manual-success"><CheckCircle2 /><div><h3>{manualSaved.name}</h3><p>{manualSaved.title} · {manualSaved.company}</p><span>Source: Manual entry · Contact details are manually supplied and not provider verified.</span></div><div className="manual-success-actions"><Button variant="outline" onClick={() => { setSelectedForEnrichment([manualSaved.id]); setManualOpen(false); setRefreshConfirmOpen(true) }}>Refresh Profile via PDL</Button>{providerModes.lusha === "live" ? <Button variant="outline" onClick={() => { setManualOpen(false); prepareLushaEmail(manualSaved) }}>Prepare Email Reveal</Button> : <><Button variant="outline" onClick={() => void runEnrichment([manualSaved.id], ["lusha"], "manual", ["email"])}>Get Email via Lusha</Button><Button variant="outline" onClick={() => void runEnrichment([manualSaved.id], ["lusha"], "manual", ["phone"])}>Get Phone via Lusha</Button></>}</div></div> : <div className="manual-form">
            <h3>Identity</h3><div className="manual-grid"><label><span>Name *</span><Input value={manualForm.name} onChange={event => updateManualField("name", event.target.value)} /></label><label><span>Programme</span><Select value={manualForm.programme} onValueChange={value => updateManualField("programme", value)}><SelectTrigger><SelectValue placeholder="Select programme" /></SelectTrigger><SelectContent>{activeProgrammeChoices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label><label><span>Batch / graduation year</span><Input type="number" min="1980" max="2100" value={manualForm.batch} onChange={event => updateManualField("batch", event.target.value)} /></label></div>
            <h3>Professional</h3><div className="manual-grid"><label><span>Current company</span><Input value={manualForm.company} onChange={event => updateManualField("company", event.target.value)} /></label><label><span>Role / designation</span><Input value={manualForm.title} onChange={event => updateManualField("title", event.target.value)} /></label><label><span>Function</span><Select value={manualForm.function} onValueChange={value => updateManualField("function", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Seniority</span><Select value={manualForm.seniority} onValueChange={value => updateManualField("seniority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Not assessed">Not assessed</SelectItem>{seniorityFilterOptions.filter(item => !item.endsWith("+")).map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label><span>Location</span><Input value={manualForm.location} onChange={event => updateManualField("location", event.target.value)} /></label><label><span>Professional profile URL</span><Input value={manualForm.linkedinUrl} onChange={event => updateManualField("linkedinUrl", event.target.value)} /></label></div>
            <h3>Contact and relationship</h3><div className="manual-grid"><label><span>Email</span><Input type="email" value={manualForm.email} onChange={event => updateManualField("email", event.target.value)} /></label><label><span>Phone</span><Input value={manualForm.phone} onChange={event => updateManualField("phone", event.target.value)} /></label><label><span>IIML / Placement Committee relationship</span><Select value={manualForm.relationship} onValueChange={value => updateManualField("relationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label><label><span>Outreach status</span><Select value={manualForm.status} onValueChange={value => updateManualField("status", value as OutreachStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label></div><label><span>Notes</span><Textarea value={manualForm.note} onChange={event => updateManualField("note", event.target.value)} /></label>
            {manualMessage && <div className="manual-message">{manualMessage}</div>}
            {manualMatches.length > 0 && <div className="manual-matches"><strong>Possible existing alumnus</strong>{manualMatches.map(match => <div key={match.id}><span className="avatar small">{match.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><p><strong>{match.name}</strong><small>{match.programme} {match.batch || ""} · {match.company} · {match.title}</small></p><Button variant="outline" size="sm" onClick={() => { setManualOpen(false); openAlumnusProfile(alumni.find(item => item.id === match.id)!) }}>Compare</Button><Button size="sm" onClick={() => { setManualOpen(false); openAlumnusProfile(alumni.find(item => item.id === match.id)!) }}>Use Existing</Button></div>)}</div>}
          </div>}
          <DialogFooter>{manualSaved ? <><Button variant="outline" onClick={() => setManualOpen(false)}>Close</Button><Button onClick={() => { setManualOpen(false); openAlumnusProfile(manualSaved) }}>Open Profile</Button></> : <><Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>{manualMatches.length > 0 && <Button variant="outline" onClick={() => void saveManualAlumnus(true)}>Continue as New</Button>}<Button disabled={manualLoading} onClick={() => void checkManualAlumnus()}>{manualLoading ? <LoaderCircle className="spin" /> : <Search />} Check & Add</Button></>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lushaTarget) && !lushaRevealConfirmOpen} onOpenChange={open => { if (!open && !lushaRevealConfirmOpen) { setLushaTarget(null); setLushaPreview(null) } }}>
        <DialogContent className="refresh-confirm-dialog">
          {lushaTarget && !lushaPreview && <><DialogHeader><DialogTitle>Check Lusha contact availability?</DialogTitle><DialogDescription>This first V3 step searches for a stable Lusha contact ID and availability flags. It does not reveal an email or phone.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Alumnus</span><strong>{lushaTarget.name}</strong></div><div><span>Preferred identifier</span><strong>{normalizeProfessionalProfileUrl(lushaTarget.linkedinUrl) ? "Professional profile URL" : "Name and current company"}</strong></div><div><span>Requested contact data</span><strong>Availability preview only</strong></div><div><span>Application capacity</span><strong>{providerUsage.lusha.remaining} credits remaining</strong></div></div><div className="credit-notice"><Activity /><span>Lusha V3 Search may incur request/result usage under your account plan. The app will record usage reported by Lusha; this application limit is not the Lusha account balance. No email or phone is revealed in this step.</span></div>{enrichmentMessage && <div className="enrichment-message"><Activity /> <span>{enrichmentMessage}</span></div>}<DialogFooter><Button variant="outline" onClick={() => setLushaTarget(null)}>Cancel</Button><Button disabled={enriching || providerUsage.lusha.remaining < 1 || !providerUsage.lusha.configured} onClick={() => void searchLushaContactPreview()}>{enriching ? <LoaderCircle className="spin" /> : <Search />} Confirm Contact Search</Button></DialogFooter></>}
          {lushaTarget && lushaPreview && <><DialogHeader><DialogTitle>Lusha contact preview</DialogTitle><DialogDescription>{lushaPreview.resumedFromStoredContact ? "Resume from the previously completed contact match without running another Lusha Search." : "Review the non-contact match before deciding whether to reveal an email."}</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Internal alumnus</span><strong>{lushaTarget.name}</strong></div><div><span>Lusha match</span><strong>{lushaPreview.fullName || "No match returned"}</strong></div><div><span>Role</span><strong>{lushaPreview.resumedFromStoredContact ? "Previously reviewed match" : [lushaPreview.jobTitle, lushaPreview.company].filter(Boolean).join(" · ") || "Not reported"}</strong></div><div><span>Email availability</span><strong>{lushaPreview.resumedFromStoredContact ? lushaPreview.emailAvailable === true ? "Available in the completed preview" : lushaPreview.emailAvailable === false ? "Not available in the completed preview" : "Previously checked · not re-queried" : lushaPreview.emailAvailable === null ? "Not reported" : lushaPreview.emailAvailable ? "Available to reveal" : "Not available"}</strong></div><div><span>Phone availability</span><strong>{lushaPreview.resumedFromStoredContact ? "Not requested (phone reveal disabled)" : lushaPreview.phoneAvailable === null ? "Not reported (phone reveal disabled)" : lushaPreview.phoneAvailable ? "Available (phone reveal disabled)" : "Not available"}</strong></div><div><span>Search usage</span><strong>{lushaPreview.resumedFromStoredContact ? "Previously completed · 0 new Search calls" : lushaPreview.creditsUsed === null ? "Not returned · reconcile account usage" : `${lushaPreview.creditsUsed} credit${lushaPreview.creditsUsed === 1 ? "" : "s"} reported`}</strong></div></div><div className="credit-notice"><Activity /><span>{lushaPreview.resumedFromStoredContact ? "Corporate Network will reuse the saved stable Lusha contact ID. Continuing does not repeat Contact Search; only the separately confirmed email reveal can reach Lusha." : "Email reveal is a separate live provider call and may include request/result usage plus the email field. The actual charge is not hard-coded. Phone and bulk reveal remain disabled."}</span></div><DialogFooter><Button variant="outline" onClick={() => { setLushaTarget(null); setLushaPreview(null) }}>Close</Button><Button disabled={lushaPreview.status !== "success" || lushaPreview.emailAvailable === false || enriching} onClick={() => setLushaRevealConfirmOpen(true)}><Mail /> Continue to Email Reveal</Button></DialogFooter></>}
        </DialogContent>
      </Dialog>

      <Dialog open={lushaRevealConfirmOpen} onOpenChange={setLushaRevealConfirmOpen}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Reveal email through Lusha?</DialogTitle><DialogDescription>This is the final human confirmation before a live email-only contact reveal.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Alumnus</span><strong>{lushaTarget?.name ?? "Not selected"}</strong></div><div><span>Lusha contact</span><strong>{lushaPreview?.fullName || "Stable contact ID matched"}</strong></div><div><span>Requested field</span><strong>Email only</strong></div><div><span>Phone</span><strong>Not requested</strong></div></div><div className="credit-notice"><Activity /><span>This live call may consume request/result usage plus email reveal usage. Corporate Network records provider-reported actual usage; if Lusha omits per-call metadata, the history will require reconciliation against the Lusha account usage view.</span></div><DialogFooter><Button variant="outline" onClick={() => setLushaRevealConfirmOpen(false)}>Cancel</Button><Button disabled={enriching || !lushaPreview?.contactId || lushaPreview.emailAvailable === false} onClick={() => void revealLushaEmail()}>{enriching ? <LoaderCircle className="spin" /> : <Mail />} Confirm Email-Only Reveal</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDiscoveryFilters)} onOpenChange={open => { if (!open) setPendingDiscoveryFilters(null) }}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Run live PDL Person Search?</DialogTitle><DialogDescription>Confirm this controlled, credit-consuming search before it reaches People Data Labs.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Provider</span><strong>People Data Labs — LIVE</strong></div><div><span>Education</span><strong>{FIXED_ALUMNI_SCHOOL}</strong></div><div><span>Company</span><strong>{pendingDiscoveryFilters?.company ?? "Not selected"}</strong></div><div><span>Role</span><strong>{pendingDiscoveryFilters?.role || "Any role"}</strong></div><div><span>Function</span><strong>{pendingDiscoveryFilters?.function ?? "Any function"}</strong></div><div><span>Seniority</span><strong>{pendingDiscoveryFilters?.seniority ?? "Any level"}</strong></div><div><span>Location</span><strong>{pendingDiscoveryFilters?.location || "Any location"}</strong></div><div><span>Graduation year</span><strong>{pendingDiscoveryFilters?.batch || "Any year"}</strong></div><div><span>Profiles requested</span><strong>{discoveryLimit}</strong></div><div><span>Application credits remaining</span><strong>{providerUsage.pdl.remaining}</strong></div><div><span>Maximum potential result usage</span><strong>{discoveryLimit}</strong></div></div><div className="credit-notice"><Activity /><span>Actual provider usage and the number of profiles returned will be recorded from the live response. The requested count is only a maximum. Results are review-only and will not be added automatically.</span></div><DialogFooter><Button variant="outline" onClick={() => setPendingDiscoveryFilters(null)}>Cancel</Button><Button disabled={discovering || !pendingDiscoveryFilters || pendingDiscoveryFilters.company === "All companies" || !validateDiscoveryCount(Number(discoveryLimit), providerUsage.pdl.remaining, pdlLiveMaximum).ok} onClick={() => pendingDiscoveryFilters && void runDiscovery(pendingDiscoveryFilters)}>{discovering ? <LoaderCircle className="spin" /> : <Search />} Confirm Live Search</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={refreshConfirmOpen} onOpenChange={setRefreshConfirmOpen}>
        <DialogContent className="refresh-confirm-dialog"><DialogHeader><DialogTitle>Refresh professional profiles?</DialogTitle><DialogDescription>Review this provider action before it runs.</DialogDescription></DialogHeader><div className="refresh-confirm-summary"><div><span>Selected alumni</span><strong>{selectedForEnrichment.length}</strong></div><div><span>Provider</span><strong>People Data Labs — {providerModes.pdl.toUpperCase()}</strong></div><div><span>Action</span><strong>Person Enrichment</strong></div></div><div className="credit-notice"><Activity /><span>A successful PDL profile return may consume one PDL credit even when no information has changed. Important field changes will wait for your approval.</span></div><DialogFooter><Button variant="outline" onClick={() => setRefreshConfirmOpen(false)}>Cancel</Button><Button disabled={!pdlSelectionReady || enriching} onClick={() => void runProfileRefresh()}>{enriching ? <LoaderCircle className="spin" /> : <Cloud />} Run Refresh</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={refreshResults.length > 0} onOpenChange={open => { if (!open) setRefreshResults([]) }}>
        <DialogContent className="refresh-results-dialog"><DialogHeader><DialogTitle>PDL profile refresh complete</DialogTitle><DialogDescription>Provider responses and credits are already recorded. Apply only the professional-field changes you approve.</DialogDescription></DialogHeader><div className="refresh-result-list">{refreshResults.map(result => { const changed = result.fields.filter(field => field.oldValue !== field.newValue); return <article key={result.alumnusId}><div className="refresh-result-heading"><div><strong>{result.alumnusName}</strong><span>{result.reviewStatus} · {result.creditsUsed} credit{result.creditsUsed === 1 ? "" : "s"}</span></div><span className={`history-status history-${result.status}`}>{result.status.replace("_", " ")}</span></div>{result.status === "no_match" ? <p>No matching external professional profile found. Internal data was not modified.</p> : changed.length ? <div className="refresh-fields">{changed.map(field => <label key={field.field}><input type="checkbox" checked={(refreshSelections[result.reviewId ?? -result.alumnusId] ?? []).includes(field.field)} disabled={result.reviewStatus !== "Pending review"} onChange={() => result.reviewId && setRefreshSelections(current => ({ ...current, [result.reviewId!]: (current[result.reviewId!] ?? []).includes(field.field) ? current[result.reviewId!].filter(item => item !== field.field) : [...(current[result.reviewId!] ?? []), field.field] }))} /><span>{field.label}</span><strong>{field.oldValue || "Not recorded"}</strong><ChevronRight /><strong>{field.newValue}</strong></label>)}</div> : <p>No professional changes detected. Existing professional profile confirmed against PDL.</p>}{result.reviewStatus === "Pending review" && <Button size="sm" onClick={() => void applyRefreshResult(result)}>Apply Selected Updates</Button>}<small>{result.responseSummary}</small></article> })}</div><DialogFooter><Button onClick={() => setRefreshResults([])}>Done</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(comparisonResult)} onOpenChange={open => { if (!open) { setComparisonResult(null); setSelectedComparisonFields([]) } }}>
        <DialogContent className="comparison-dialog">
          <DialogHeader><DialogTitle>Compare professional profile</DialogTitle><DialogDescription>Review {appConfig.name} and PDL values. Nothing is overwritten until you approve selected fields.</DialogDescription></DialogHeader>
          {comparisonResult && <>
            <div className="comparison-person"><div className="avatar">{comparisonAlumnus?.initials ?? comparisonResult.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</div><div><strong>{comparisonResult.name}</strong><span><DiscoveryBadge status={comparisonResult.matchStatus} /> · {comparisonResult.matchConfidence}% match confidence</span></div></div>
            {comparisonAlumnus ? <div className="comparison-grid"><div className="comparison-head"><span>Field</span><strong>Internal database</strong><strong>PDL result</strong></div>{comparisonRows.map(row => {
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
