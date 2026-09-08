"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity, ArrowUpRight, BriefcaseBusiness, Building2, CalendarClock, CheckCircle2,
  ChevronRight, CircleUserRound, Cloud, ContactRound, Database, Download,
  Eye, FileSpreadsheet, Filter, GitCompare, History, LoaderCircle, MapPin, Network,
  Plus, Search, Sparkles, Target, Upload, UserRoundCheck, UsersRound, XCircle, Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  FIXED_ALUMNI_SCHOOL,
  defaultDirectoryFilters,
  matchesInternalFilters,
  type DirectoryFilters,
} from "@/lib/alumni-search"

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
  discoverySource?: string
  discoveryDate?: string
  lastPdlRefresh?: string
  lastLushaEnrichment?: string
  emailSource?: string
  phoneSource?: string
  emailRetrievedAt?: string
  phoneRetrievedAt?: string
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
}

type LatestImport = { filename: string; rowCount: number; importedBy: string; createdAt: string }
type Provider = "pdl" | "lusha"
type ProviderUsage = Record<Provider, { used: number; limit: number; remaining: number; configured: boolean }>
type ProviderHistory = {
  id: number
  provider: Provider
  alumnusName: string
  operation: string
  mode: "mock" | "live"
  status: string
  creditsUsed: number
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
}

type DiscoveryCounts = { existing: number; new: number; possibleDuplicate: number; needsReview: number }

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

const companyPrioritySeed: Record<string, string> = {
  Microsoft: "Tier 1 Strategic Target", Amazon: "High Priority", "Tata Consumer": "Target Recruiter",
  ITC: "Target Recruiter", Google: "Tier 1 Strategic Target", Deloitte: "High Priority",
  Flipkart: "High Priority", "HDFC Bank": "Target Recruiter",
}

const alumniSeed: Alumni[] = [
  { id: 1, name: "Aditi Srivastava", initials: "AS", batch: 2012, programme: "PGP", company: "Microsoft", title: "Director, People & Culture", function: "HR", seniority: "Director", location: "Gurugram", previous: "Deloitte, GE", experience: 14, confidence: 94, email: "aditi.s@example.com", phone: "+91 98••• 4102", verified: "12 days ago", status: "Meeting set", note: "Supported summer placements in 2024. Best route to India TA leadership.", assessment: { hiringInfluence: "Direct hiring decision-maker", iimlRelationship: "Very strong", warmIntroPotential: "Confirmed direct connection to decision-maker" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Unverified", location: "Verified" } },
  { id: 2, name: "Rohan Mehta", initials: "RM", batch: 2015, programme: "PGP", company: "Amazon", title: "Senior Manager, Talent Acquisition", function: "HR", seniority: "Senior Manager", location: "Bengaluru", previous: "Flipkart, EY", experience: 11, confidence: 91, email: "rohan.m@example.com", phone: "+91 99••• 6721", verified: "21 days ago", status: "Responded", note: "Replied positively last cycle. Interested in product and operations roles.", assessment: { hiringInfluence: "Direct hiring decision-maker", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Verified", location: "Verified" } },
  { id: 3, name: "Neha Kapoor", initials: "NK", batch: 2008, programme: "PGP", company: "Tata Consumer", title: "Vice President, Strategy", function: "Strategy", seniority: "VP", location: "Mumbai", previous: "Bain & Company", experience: 18, confidence: 88, email: "neha.k@example.com", phone: "+91 98••• 0385", verified: "36 days ago", status: "Contacted", note: "Regular alumni speaker. No confirmed relationship with the current Google target is recorded.", assessment: { hiringInfluence: "Moderate hiring influence", iimlRelationship: "Very strong", warmIntroPotential: "Can credibly provide introduction" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Likely", email: "Verified", phone: "Unverified", location: "Possibly outdated" } },
  { id: 4, name: "Arjun Bhatia", initials: "AB", batch: 2017, programme: "PGP", company: "Microsoft", title: "Principal Product Manager", function: "Product", seniority: "Director", location: "Hyderabad", previous: "Adobe, Infosys", experience: 9, confidence: 96, email: "arjun.b@example.com", phone: "+91 97••• 9460", verified: "8 days ago", status: "Not contacted", note: "High-confidence profile. Useful product hiring route, but no prior placement interaction.", assessment: { hiringInfluence: "Moderate hiring influence", iimlRelationship: "Moderate", warmIntroPotential: "Same company only" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Unverified", location: "Verified" } },
  { id: 5, name: "Kavya Nair", initials: "KN", batch: 2013, programme: "PGP-ABM", company: "ITC", title: "General Manager, Rural Markets", function: "Sales", seniority: "GM", location: "Kolkata", previous: "HUL", experience: 13, confidence: 87, email: "kavya.n@example.com", phone: "+91 98••• 2241", verified: "44 days ago", status: "Responded", note: "Previously mentored ABM students. Strong fit for rural sales and strategy roles.", assessment: { hiringInfluence: "Strong hiring influence", iimlRelationship: "Strong", warmIntroPotential: "Same relevant function / business unit" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Likely", email: "Unverified", phone: "Unverified", location: "Verified" } },
  { id: 6, name: "Vikram Rao", initials: "VR", batch: 2010, programme: "PGP", company: "Google", title: "Country Operations Lead", function: "Operations", seniority: "Country Head", location: "Bengaluru", previous: "Uber, McKinsey", experience: 16, confidence: 90, email: "vikram.r@example.com", phone: "+91 99••• 7814", verified: "17 days ago", status: "Not contacted", note: "Senior decision-maker. Direct outreach is preferred because no confirmed intermediary relationship is recorded.", assessment: { hiringInfluence: "Direct hiring decision-maker", iimlRelationship: "Unknown / Not assessed", warmIntroPotential: "No known route" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Unverified", location: "Verified" } },
  { id: 7, name: "Meera Iyer", initials: "MI", batch: 2019, programme: "PGP", company: "Amazon", title: "Finance Manager", function: "Finance", seniority: "Manager", location: "Bengaluru", previous: "P&G", experience: 7, confidence: 92, email: "meera.i@example.com", phone: "+91 96••• 4108", verified: "15 days ago", status: "Contacted", note: "Engaged with the finance club. Better suited for role intelligence than recruiter outreach.", assessment: { hiringInfluence: "Limited hiring influence", iimlRelationship: "Moderate", warmIntroPotential: "Same company only" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Likely", phone: "Unverified", location: "Verified" } },
  { id: 8, name: "Siddharth Jain", initials: "SJ", batch: 2006, programme: "PGP", company: "Deloitte", title: "Managing Director", function: "Consulting", seniority: "C-suite", location: "Mumbai", previous: "Kearney", experience: 20, confidence: 86, email: "siddharth.j@example.com", phone: "+91 98••• 5542", verified: "52 days ago", status: "Meeting set", note: "Long-standing campus relationship. Priority route for consulting leadership.", assessment: { hiringInfluence: "Direct hiring decision-maker", iimlRelationship: "Very strong", warmIntroPotential: "Confirmed direct connection to decision-maker" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Verified", location: "Possibly outdated" } },
  { id: 9, name: "Priya Menon", initials: "PM", batch: 2016, programme: "PGP", company: "Flipkart", title: "Director, Category Management", function: "Operations", seniority: "Director", location: "Bengaluru", previous: "Amazon", experience: 10, confidence: 89, email: "priya.m@example.com", phone: "+91 97••• 1973", verified: "28 days ago", status: "Not contacted", note: "Recently promoted. Timely congratulations can open a placement conversation.", assessment: { hiringInfluence: "Moderate hiring influence", iimlRelationship: "Moderate", warmIntroPotential: "Same company only" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Likely", email: "Likely", phone: "Unverified", location: "Verified" } },
  { id: 10, name: "Rahul Banerjee", initials: "RB", batch: 2011, programme: "PGP", company: "HDFC Bank", title: "Senior Vice President", function: "Finance", seniority: "VP", location: "Mumbai", previous: "ICICI Bank", experience: 15, confidence: 84, email: "rahul.b@example.com", phone: "+91 99••• 2636", verified: "61 days ago", status: "Not contacted", note: "Role is relevant, but contact data needs another verification before outreach.", assessment: { hiringInfluence: "Strong hiring influence", iimlRelationship: "Unknown / Not assessed", warmIntroPotential: "No known route" }, verification: { profileMatch: "Confirmed", currentCompany: "Likely", designation: "Likely", email: "Unverified", phone: "Unverified", location: "Possibly outdated" } },
  { id: 11, name: "Tanvi Gupta", initials: "TG", batch: 2018, programme: "PGP", company: "Google", title: "People Partner, India", function: "HR", seniority: "Senior Manager", location: "Gurugram", previous: "Microsoft", experience: 8, confidence: 95, email: "tanvi.g@example.com", phone: "+91 98••• 8309", verified: "6 days ago", status: "Responded", note: "Moved to Google People Operations recently. Prior engagement provides useful context.", assessment: { hiringInfluence: "Direct hiring decision-maker", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Verified", location: "Verified" } },
  { id: 12, name: "Mohit Khanna", initials: "MK", batch: 2014, programme: "IPMX", company: "Deloitte", title: "Partner, Technology Strategy", function: "Consulting", seniority: "Partner", location: "Gurugram", previous: "Accenture", experience: 17, confidence: 93, email: "mohit.k@example.com", phone: "+91 96••• 5427", verified: "19 days ago", status: "Contacted", note: "Past guest lecturer. Strong candidate for technology consulting outreach.", assessment: { hiringInfluence: "Strong hiring influence", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction" }, verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Likely", phone: "Unverified", location: "Verified" } },
]

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

function relevanceBreakdown(person: Alumni, priorities: Record<string, string>) {
  const items = [
    { label: "Hiring influence", score: optionScore(hiringOptions, person.assessment.hiringInfluence), weight: 30 },
    { label: "Seniority", score: optionScore(seniorityOptions, seniorityLabel(person)), weight: 20 },
    { label: "Company priority", score: optionScore(companyPriorityOptions, priorities[person.company]), weight: 20 },
    { label: "IIML relationship", score: optionScore(relationshipOptions, person.assessment.iimlRelationship), weight: 15 },
    { label: "Past responsiveness", score: optionScore(responsivenessOptions, responsivenessLabel(person.status)), weight: 10 },
    { label: "Warm-intro potential", score: optionScore(warmIntroOptions, person.assessment.warmIntroPotential), weight: 5 },
  ]
  const score = Math.round(items.reduce((total, item) => total + item.score * item.weight / 100, 0))
  return { score, items }
}

function operationalStatus(person: Alumni) {
  const fields = person.verification
  if (fields.profileMatch === "Mismatch") return "Mismatch"
  const profileReliable = fields.profileMatch === "Confirmed" && fields.currentCompany === "Verified" && ["Verified", "Likely"].includes(fields.designation)
  const verifiedChannel = fields.email === "Verified" || fields.phone === "Verified"
  if (profileReliable && verifiedChannel) return "Contact-ready"
  if (fields.profileMatch === "Confirmed" && (profileReliable || verifiedChannel)) return "Partially verified"
  return "Needs verification"
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

function DiscoveryBadge({ status }: { status: DiscoveryResult["matchStatus"] }) {
  return <span className={`discovery-badge discovery-${status.toLowerCase().replaceAll(" ", "-")}`}>{status === "New" ? "Externally discovered" : status}</span>
}

function StatCard({ icon: Icon, label, value, delta }: { icon: typeof UsersRound; label: string; value: string; delta: string }) {
  return <article className="stat-card"><div className="stat-icon"><Icon aria-hidden="true" /></div><div><p>{label}</p><strong>{value}</strong><span>{delta}</span></div></article>
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
  const [alumni, setAlumni] = useState<Alumni[]>(alumniSeed)
  const [companyPriorities, setCompanyPriorities] = useState<Record<string, string>>(companyPrioritySeed)
  const [filters, setFilters] = useState<DirectoryFilters>(defaultDirectoryFilters)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [selected, setSelected] = useState<Alumni | null>(null)
  const [targetCompany, setTargetCompany] = useState("Microsoft")
  const [activeTab, setActiveTab] = useState("overview")
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState("")
  const [latestImport, setLatestImport] = useState<LatestImport | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [enrichmentMode, setEnrichmentMode] = useState<"mock" | "live">("mock")
  const [providerUsage, setProviderUsage] = useState<ProviderUsage>({ pdl: { used: 0, limit: 100, remaining: 100, configured: false }, lusha: { used: 0, limit: 100, remaining: 100, configured: false } })
  const [providerHistory, setProviderHistory] = useState<ProviderHistory[]>([])
  const [creditDrafts, setCreditDrafts] = useState<Record<Provider, string>>({ pdl: "100", lusha: "100" })
  const [selectedForEnrichment, setSelectedForEnrichment] = useState<number[]>([])
  const [enriching, setEnriching] = useState(false)
  const [enrichmentMessage, setEnrichmentMessage] = useState("")
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([])
  const [discoveryCounts, setDiscoveryCounts] = useState<DiscoveryCounts>({ existing: 0, new: 0, possibleDuplicate: 0, needsReview: 0 })
  const [discoveryLimit, setDiscoveryLimit] = useState("25")
  const [discovering, setDiscovering] = useState(false)
  const [discoveryMessage, setDiscoveryMessage] = useState("")
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState<number[]>([])
  const [comparisonResult, setComparisonResult] = useState<DiscoveryResult | null>(null)
  const [selectedComparisonFields, setSelectedComparisonFields] = useState<string[]>([])

  const loadWorkspace = useCallback(async (seedIfEmpty = false) => {
    try {
      setWorkspaceLoading(true)
      let response = await fetch("/api/workspace", { cache: "no-store" })
      let data = await response.json() as { alumni?: Alumni[]; companyPriorities?: Record<string, string>; latestImport?: LatestImport | null; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to load the shared workspace.")
      if (seedIfEmpty && data.alumni?.length === 0) {
        const seedResponse = await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "import", filename: "Demonstration alumni dataset", records: alumniSeed }),
        })
        if (!seedResponse.ok) throw new Error("The shared database was created, but the demonstration dataset could not be loaded.")
        response = await fetch("/api/workspace", { cache: "no-store" })
        data = await response.json() as { alumni?: Alumni[]; companyPriorities?: Record<string, string>; latestImport?: LatestImport | null; error?: string }
        if (!response.ok) throw new Error(data.error || "Unable to reload the shared workspace.")
      }
      if (data.alumni?.length) {
        setAlumni(data.alumni)
        setSelected(current => current ? data.alumni?.find(person => person.id === current.id) ?? null : null)
      }
      if (data.companyPriorities) setCompanyPriorities(current => ({ ...current, ...data.companyPriorities }))
      setLatestImport(data.latestImport ?? null)
      setWorkspaceMessage("")
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Unable to connect to the shared database.")
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(true), 0)
    return () => window.clearTimeout(timer)
  }, [loadWorkspace])

  const loadEnrichment = useCallback(async () => {
    try {
      const response = await fetch("/api/enrichment", { cache: "no-store" })
      const data = await response.json() as { mode?: "mock" | "live"; usage?: ProviderUsage; history?: ProviderHistory[]; error?: string }
      if (!response.ok || !data.usage) throw new Error(data.error || "Unable to load provider activity.")
      setEnrichmentMode(data.mode ?? "mock")
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

  const companies = useMemo(() => [...new Set(alumni.map(person => person.company))].sort(), [alumni])
  const programmes = useMemo(() => [...new Set(alumni.map(person => person.programme))].sort(), [alumni])
  const filtered = useMemo(() => alumni.filter(person => {
    const relevance = relevanceBreakdown(person, companyPriorities).score
    return matchesInternalFilters(person, filters, relevance, operationalStatus(person))
  }).sort((a, b) => relevanceBreakdown(b, companyPriorities).score - relevanceBreakdown(a, companyPriorities).score), [alumni, companyPriorities, filters])

  const topLeads = [...alumni].sort((a, b) => relevanceBreakdown(b, companyPriorities).score - relevanceBreakdown(a, companyPriorities).score).slice(0, 5)
  const targetAlumni = alumni.filter(person => person.company === targetCompany).sort((a, b) => relevanceBreakdown(b, companyPriorities).score - relevanceBreakdown(a, companyPriorities).score)
  const activeOutreach = alumni.filter(person => person.status !== "Not contacted").length
  const contactReadyCount = alumni.filter(person => operationalStatus(person) === "Contact-ready").length

  function replaceAlumnus(updated: Alumni) {
    setAlumni(current => current.map(person => person.id === updated.id ? updated : person))
    setSelected(current => current?.id === updated.id ? updated : current)
  }

  async function saveAlumnus(id: number, changes: { status?: OutreachStatus; assessment?: Partial<Alumni["assessment"]> }) {
    setSyncing(true)
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_alumnus", id, ...changes }) })
      const data = await response.json() as { alumnus?: Alumni; error?: string }
      if (!response.ok || !data.alumnus) throw new Error(data.error || "Unable to save the update.")
      replaceAlumnus(data.alumnus)
      setWorkspaceMessage("Saved to the shared workspace.")
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Unable to save the update.")
      await loadWorkspace(false)
    } finally {
      setSyncing(false)
    }
  }

  function updateStatus(id: number, status: OutreachStatus) {
    void saveAlumnus(id, { status })
  }

  function updateAssessment(id: number, field: keyof Alumni["assessment"], value: string) {
    void saveAlumnus(id, { assessment: { [field]: value } })
  }

  async function updateCompanyPriority(name: string, priority: string) {
    setSyncing(true)
    try {
      const response = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_priority", company: name, priority }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to save company priority.")
      setCompanyPriorities(current => ({ ...current, [name]: priority }))
      setWorkspaceMessage("Company priority saved for all committee members.")
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Unable to save company priority.")
    } finally {
      setSyncing(false)
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
      const response = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", filename: importFile.name, records }) })
      const data = await response.json() as { imported?: number; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to import the selected file.")
      setWorkspaceMessage(`${data.imported ?? records.length} alumni records imported into the shared database.`)
      setImportFile(null)
      await loadWorkspace(false)
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
      const response = await fetch("/api/enrichment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alumniIds: ids.slice(0, 25), providers: requestedProviders, operation, contactChannels }),
      })
      const data = await response.json() as { results?: Array<{ status: string }>; error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to run enrichment.")
      const successes = data.results?.filter(result => result.status === "success").length ?? 0
      setEnrichmentMessage(`${successes} provider result${successes === 1 ? "" : "s"} applied. Full details are in response history.`)
      await Promise.all([loadWorkspace(false), loadEnrichment()])
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to run enrichment.")
    } finally {
      setEnriching(false)
    }
  }

  async function saveCreditLimit(provider: Provider) {
    const monthlyCreditLimit = Number(creditDrafts[provider])
    if (!Number.isInteger(monthlyCreditLimit) || monthlyCreditLimit < 0) { setEnrichmentMessage("Enter a whole-number credit limit."); return }
    try {
      const response = await fetch("/api/enrichment", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, monthlyCreditLimit }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || "Unable to save the credit limit.")
      setEnrichmentMessage(`${provider.toUpperCase()} monthly application limit saved.`)
      await loadEnrichment()
    } catch (error) {
      setEnrichmentMessage(error instanceof Error ? error.message : "Unable to save the credit limit.")
    }
  }

  function toggleEnrichmentSelection(id: number) {
    setSelectedForEnrichment(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 25 ? [...current, id] : current)
  }

  function updateFilter<K extends keyof DirectoryFilters>(key: K, value: DirectoryFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }))
    setDiscoveryResults([])
    setSelectedDiscoveryIds([])
    setDiscoveryMessage("")
  }

  async function discoverMoreAlumni(searchFilters: DirectoryFilters = filters) {
    setDiscovering(true)
    setDiscoveryMessage("")
    setDiscoveryResults([])
    setSelectedDiscoveryIds([])
    try {
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search", filters: searchFilters, limit: Number(discoveryLimit) }),
      })
      const data = await response.json() as { results?: DiscoveryResult[]; counts?: DiscoveryCounts; creditsUsed?: number; error?: string }
      if (!response.ok || !data.results || !data.counts) throw new Error(data.error || "Unable to search external professional data.")
      setDiscoveryResults(data.results)
      setDiscoveryCounts(data.counts)
      setDiscoveryMessage(data.results.length
        ? `${data.results.length} external profiles returned. ${data.creditsUsed ?? 0} PDL credits recorded.`
        : "No additional external alumni were found for these criteria.")
      await loadEnrichment()
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to search external professional data.")
    } finally {
      setDiscovering(false)
    }
  }

  function findMoreForCompany(companyName: string) {
    const next = { ...defaultDirectoryFilters(), company: companyName }
    setFilters(next)
    setActiveTab("directory")
    void discoverMoreAlumni(next)
  }

  function compareRefreshWithPdl(person: Alumni) {
    const next = { ...defaultDirectoryFilters(), name: person.name, company: person.company }
    setFilters(next)
    setSelected(null)
    setActiveTab("directory")
    void discoverMoreAlumni(next)
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
      const response = await fetch("/api/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", resultIds }),
      })
      const data = await response.json() as { addedCount?: number; added?: Array<{ resultId: number; alumnusId: number }>; error?: string }
      if (!response.ok || !data.added) throw new Error(data.error || "Unable to add the selected alumni.")
      const addedMap = new Map(data.added.map(item => [item.resultId, item.alumnusId]))
      setDiscoveryResults(current => current.map(item => addedMap.has(item.id)
        ? { ...item, linkedInternalAlumnusId: addedMap.get(item.id) ?? null, reviewStatus: "Added to Corporate Network" }
        : item))
      setSelectedDiscoveryIds([])
      setDiscoveryMessage(`${data.addedCount ?? data.added.length} alumn${data.added.length === 1 ? "us" : "i"} added. Contact enrichment is now available.`)
      await loadWorkspace(false)
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to add the selected alumni.")
    } finally {
      setDiscovering(false)
    }
  }

  async function ignoreDiscoveryResult(resultId: number) {
    const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ignore", resultId }) })
    if (response.ok) setDiscoveryResults(current => current.map(item => item.id === resultId ? { ...item, reviewStatus: "Ignored" } : item))
  }

  async function applyComparison() {
    if (!comparisonResult) return
    setDiscovering(true)
    try {
      const response = await fetch("/api/discovery", {
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
      await loadWorkspace(false)
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
      const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "keep_separate", resultId: comparisonResult.id }) })
      const data = await response.json() as { alumnusId?: number; error?: string }
      if (!response.ok || !data.alumnusId) throw new Error(data.error || "Unable to keep this alumnus as a separate record.")
      setDiscoveryResults(current => current.map(item => item.id === comparisonResult.id ? { ...item, linkedInternalAlumnusId: data.alumnusId!, reviewStatus: "Added as separate record" } : item))
      setComparisonResult(null)
      setSelectedComparisonFields([])
      setDiscoveryMessage("The reviewed profile was added as a separate alumnus. Lusha enrichment is now available from the internal profile.")
      await loadWorkspace(false)
    } catch (error) {
      setDiscoveryMessage(error instanceof Error ? error.message : "Unable to keep this alumnus as a separate record.")
    } finally {
      setDiscovering(false)
    }
  }

  const functionCounts = targetAlumni.reduce<Record<string, number>>((acc, person) => {
    acc[person.function] = (acc[person.function] ?? 0) + 1
    return acc
  }, {})
  const selectedBreakdown = selected ? relevanceBreakdown(selected, companyPriorities) : null
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
        <div className="brand-lockup"><div className="brand-mark">CN</div><div><strong>Corporate Network</strong><span>Placement Committee Workspace</span></div></div>
        <div className={`data-state ${workspaceMessage ? "data-state-warning" : ""}`}><span /> {workspaceLoading ? "Connecting to shared database" : syncing ? "Saving changes" : workspaceMessage || "Shared database · Synced"}</div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">Placement intelligence</p><h1>Connect alumni relationships to corporate opportunities.</h1></div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="product-tabs">
          <TabsList variant="line" className="main-tabs" aria-label="Platform sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="directory">Alumni directory</TabsTrigger>
            <TabsTrigger value="companies">Company intelligence</TabsTrigger>
            <TabsTrigger value="outreach">Outreach</TabsTrigger>
            <TabsTrigger value="data-import">Data import</TabsTrigger>
            <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="tab-panel">
            <section className="stats-grid" aria-label="Key metrics">
              <StatCard icon={UsersRound} label="Alumni mapped" value={`${alumni.length}`} delta="Shared master database" />
              <StatCard icon={Building2} label="Companies covered" value={`${companies.length}`} delta="Calculated from current records" />
              <StatCard icon={UserRoundCheck} label="Contact-ready alumni" value={`${contactReadyCount} / ${alumni.length}`} delta="Based on field verification" />
              <StatCard icon={Target} label="Active outreach" value={`${activeOutreach}`} delta="Visible to all committee members" />
            </section>

            <section className="overview-grid">
              <article className="panel lead-panel">
                <div className="panel-heading"><div><p className="eyebrow">Recommended next</p><h2>Highest-value alumni leads</h2><span>Ranked by Placement Relevance</span></div><Button variant="ghost" size="sm" onClick={() => setActiveTab("directory")}>View all <ArrowUpRight /></Button></div>
                <div className="lead-list">{topLeads.map((person, index) => { const relevance = relevanceBreakdown(person, companyPriorities).score; return <button key={person.id} className="lead-row" onClick={() => setSelected(person)}><span className="rank">0{index + 1}</span><span className="avatar">{person.initials}</span><span className="lead-copy"><strong>{person.name}</strong><small>{person.title} · {person.company}</small></span><span className={`score-pill ${scoreTone(relevance)}`} title="Placement Relevance">{relevance}/100</span><ChevronRight aria-hidden="true" /></button> })}</div>
              </article>

              <aside className="panel signal-panel">
                <div className="signal-orbit"><Sparkles /><span>3</span></div><p className="eyebrow">Professional signals</p><h2>Three timely reasons to reach out</h2>
                <div className="signal-item"><div><ArrowUpRight /></div><p><strong>Priya Menon</strong> was promoted to Director at Flipkart.</p></div>
                <div className="signal-item"><div><BriefcaseBusiness /></div><p><strong>Tanvi Gupta</strong> recently moved to Google People Operations.</p></div>
                <div className="signal-item"><div><UserRoundCheck /></div><p><strong>Rohan Mehta</strong> was promoted within Talent Acquisition.</p></div>
              </aside>
            </section>

            <section className="panel route-panel">
              <div className="panel-heading"><div><p className="eyebrow">Recommended outreach route</p><h2>Direct path to Google India</h2><span>No confirmed intermediary relationship is recorded, so direct outreach remains the default.</span></div><span className="route-score">Direct route</span></div>
              <div className="route-flow"><div className="route-node active"><span>PC</span><p><strong>PlaceCom</strong><small>Direct outreach recommended</small></p></div><div className="route-link"><span>Contact directly</span><Network /></div><button className="route-node route-button" onClick={() => setSelected(alumni.find(person => person.id === 6) ?? null)}><span>VR</span><p><strong>Vikram Rao</strong><small>Country Operations Lead</small></p></button><div className="route-link"><span>Target company</span><ChevronRight /></div><div className="company-node"><Building2 /><p><strong>Google India</strong><small>2 mapped alumni</small></p></div></div>
            </section>
          </TabsContent>

          <TabsContent value="directory" className="tab-panel">
            <section className="panel directory-panel">
              <div className="panel-heading directory-heading"><div><p className="eyebrow">Internal results</p><h2>Alumni directory</h2><span>{filtered.length} alumni found in Corporate Network, ranked by Placement Relevance</span></div><Button onClick={() => void discoverMoreAlumni()} disabled={discovering}>{discovering ? <LoaderCircle className="spin" /> : <Search />} Discover More Alumni</Button></div>
              <div className="filters core-filters">
                <div className="search-field"><Search /><Input value={filters.name} onChange={event => updateFilter("name", event.target.value)} placeholder="Alumnus name" aria-label="Search by alumnus name" /></div>
                <Input list="company-options" value={filters.company === "All companies" ? "" : filters.company} onChange={event => updateFilter("company", event.target.value || "All companies")} placeholder="Company name" aria-label="Filter by current company" />
                <datalist id="company-options">{companies.map(item => <option key={item} value={item} />)}</datalist>
                <Input value={filters.role} onChange={event => updateFilter("role", event.target.value)} placeholder="Role or designation" aria-label="Filter by role or designation" />
                <Select value={filters.function} onValueChange={value => updateFilter("function", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functionFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.seniority} onValueChange={value => updateFilter("seniority", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All levels">All seniority</SelectItem>{seniorityFilterOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Input value={filters.location} onChange={event => updateFilter("location", event.target.value)} placeholder="Location" aria-label="Filter by location" />
                <Button variant="outline" onClick={() => setShowAdvancedFilters(value => !value)}><Filter /> {showAdvancedFilters ? "Fewer filters" : "More filters"}</Button>
                <Button variant="ghost" onClick={() => { setFilters(defaultDirectoryFilters()); setDiscoveryResults([]); setDiscoveryMessage(""); setSelectedDiscoveryIds([]) }}>Clear</Button>
              </div>
              {showAdvancedFilters && <div className="advanced-filters">
                <Select value={filters.programme} onValueChange={value => updateFilter("programme", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All programmes">All programmes</SelectItem>{programmes.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Input type="number" min="1980" max="2100" value={filters.batch} onChange={event => updateFilter("batch", event.target.value)} placeholder="Batch / graduation year" />
                <Input value={filters.previousCompany} onChange={event => updateFilter("previousCompany", event.target.value)} placeholder="Previous company" />
                <Select value={String(filters.minRelevance)} onValueChange={value => updateFilter("minRelevance", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any relevance</SelectItem><SelectItem value="60">Relevance 60+</SelectItem><SelectItem value="75">Relevance 75+</SelectItem><SelectItem value="85">Relevance 85+</SelectItem></SelectContent></Select>
                <Select value={String(filters.minConfidence)} onValueChange={value => updateFilter("minConfidence", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Any confidence</SelectItem><SelectItem value="60">Confidence 60+</SelectItem><SelectItem value="75">Confidence 75+</SelectItem><SelectItem value="90">Confidence 90+</SelectItem></SelectContent></Select>
                <Select value={filters.contactStatus} onValueChange={value => updateFilter("contactStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["All contact states", "Contact-ready", "Partially verified", "Needs verification", "Mismatch"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.outreachStatus} onValueChange={value => updateFilter("outreachStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All outreach states">All outreach states</SelectItem>{statusOptions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={filters.relationship} onValueChange={value => updateFilter("relationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All relationships">All IIML relationships</SelectItem>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select>
              </div>}
              <Table>
                <TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Location</TableHead><TableHead>Data confidence</TableHead><TableHead>Placement relevance</TableHead><TableHead>Outreach</TableHead></TableRow></TableHeader>
                <TableBody>{filtered.map(person => { const relevance = relevanceBreakdown(person, companyPriorities).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{educationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.function}</TableCell><TableCell>{person.location}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.confidence)}`}>{person.confidence}%</span></TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><StatusBadge status={person.status} /></TableCell></TableRow> })}</TableBody>
              </Table>
              {filtered.length === 0 && <div className="empty-state"><Search /><h3>No mapped alumni match these filters</h3><p>Search external professional data while keeping the IIM Lucknow education criterion fixed.</p><Button onClick={() => void discoverMoreAlumni()} disabled={discovering}>Discover More Alumni</Button></div>}
            </section>

            {(discoveryResults.length > 0 || discoveryMessage) && <section className="panel discovery-panel">
              <div className="discovery-header">
                <div><p className="eyebrow">External discovery</p><h2>{discoveryResults.length} PDL profiles found</h2><span>Results are reviewed before any record enters Corporate Network.</span></div>
                <div className="fixed-criterion"><span>Fixed alumni criterion</span><strong>{FIXED_ALUMNI_SCHOOL}</strong></div>
              </div>
              <div className="discovery-controls">
                <div className="reconciliation-summary"><span><strong>{discoveryCounts.existing}</strong> already mapped</span><span><strong>{discoveryCounts.new}</strong> new</span><span><strong>{discoveryCounts.possibleDuplicate}</strong> possible duplicates</span><span><strong>{discoveryCounts.needsReview}</strong> needs review</span></div>
                <div className="result-limit"><span>Results to retrieve</span><Select value={discoveryLimit} onValueChange={setDiscoveryLimit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["25", "50", "100"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={() => void discoverMoreAlumni()} disabled={discovering}>Run again</Button></div>
              </div>
              <div className="credit-notice"><Activity /><span>External discovery may consume PDL credits based on the number of person records returned. Internal search remains free.</span></div>
              {discoveryMessage && <div className="discovery-message">{discoveryMessage}</div>}
              {selectedDiscoveryIds.length > 0 && <div className="batch-approval"><span>{selectedDiscoveryIds.length} clearly new profile{selectedDiscoveryIds.length === 1 ? "" : "s"} selected</span><Button onClick={() => void approveDiscoveryResults(selectedDiscoveryIds)} disabled={discovering}><Plus /> Add Selected to Corporate Network</Button></div>}
              <div className="discovery-table-wrap"><Table>
                <TableHeader><TableRow><TableHead>Select</TableHead><TableHead>Name and education</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Seniority</TableHead><TableHead>Location</TableHead><TableHead>Database match</TableHead><TableHead>Confidence</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                <TableBody>{discoveryResults.map(result => {
                  const canAdd = result.matchStatus === "New" && result.reviewStatus === "Pending review"
                  const added = result.reviewStatus === "Added to Corporate Network" && result.linkedInternalAlumnusId
                  return <TableRow key={result.id}>
                    <TableCell><input type="checkbox" aria-label={`Select ${result.name}`} disabled={!canAdd} checked={selectedDiscoveryIds.includes(result.id)} onChange={() => toggleDiscoverySelection(result.id)} /></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.name}</strong><small>{result.education} · {result.graduationYear || "Year not returned"}</small>{result.linkedinUrl && <a href={result.linkedinUrl} target="_blank" rel="noreferrer">View LinkedIn Profile <ArrowUpRight /></a>}</span></TableCell>
                    <TableCell><span className="stacked-cell"><strong>{result.currentCompany}</strong><small>{result.role}</small></span></TableCell>
                    <TableCell>{result.function}</TableCell><TableCell>{result.seniority}</TableCell><TableCell>{result.location}</TableCell>
                    <TableCell><DiscoveryBadge status={result.matchStatus} /><small className="review-status">{result.reviewStatus}</small></TableCell>
                    <TableCell><span className={`score-pill ${scoreTone(result.matchConfidence)}`}>{result.matchConfidence}%</span></TableCell>
                    <TableCell><div className="row-actions">
                      {canAdd && <Button size="sm" onClick={() => void approveDiscoveryResults([result.id])}><Plus /> Add</Button>}
                      {(result.matchStatus === "Already in database" || result.matchStatus === "Possible duplicate") && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><GitCompare /> Compare</Button>}
                      {result.matchStatus === "Needs review" && <Button size="sm" variant="outline" onClick={() => openComparison(result)}><Eye /> Review</Button>}
                      {added && <><Button size="sm" variant="outline" onClick={() => void runEnrichment([result.linkedInternalAlumnusId!], ["lusha"], "manual", ["email"])}>Get Email</Button><Button size="sm" variant="outline" onClick={() => void runEnrichment([result.linkedInternalAlumnusId!], ["lusha"], "manual", ["phone"])}>Get Phone</Button><Button size="sm" onClick={() => void runEnrichment([result.linkedInternalAlumnusId!], ["lusha"], "manual", ["email", "phone"])}>Get Both</Button></>}
                      {result.reviewStatus === "Pending review" && <Button size="sm" variant="ghost" onClick={() => void ignoreDiscoveryResult(result.id)}><XCircle /> Ignore</Button>}
                    </div></TableCell>
                  </TableRow>
                })}</TableBody>
              </Table></div>
              {!discoveryResults.length && <div className="empty-state"><Search /><h3>No additional external alumni were found</h3><p>Broaden optional filters such as location or seniority. The IIM Lucknow criterion will remain fixed.</p></div>}
            </section>}
          </TabsContent>

          <TabsContent value="companies" className="tab-panel">
            <section className="company-toolbar"><div><p className="eyebrow">Company intelligence</p><h2>Map the strongest route into a target firm.</h2></div><div className="company-actions"><Select value={targetCompany} onValueChange={setTargetCompany}><SelectTrigger className="company-select"><Building2 /><SelectValue /></SelectTrigger><SelectContent>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Button onClick={() => findMoreForCompany(targetCompany)} disabled={discovering}><Search /> Find More Alumni</Button></div></section>
            <section className="company-grid">
              <article className="panel company-summary">
                <div className="company-title"><div className="company-logo">{targetCompany.slice(0, 1)}</div><div><h2>{targetCompany}</h2><span>Target company · Priority inherited by all mapped alumni</span></div></div>
                <div className="company-priority"><label>Company priority</label><Select value={companyPriorities[targetCompany]} onValueChange={value => updateCompanyPriority(targetCompany, value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{companyPriorityOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select><small>Set once here. The score automatically updates for every alumnus at {targetCompany}.</small></div>
                <div className="company-kpis"><div><strong>{targetAlumni.length}</strong><span>Alumni mapped</span></div><div><strong>{targetAlumni.filter(p => optionScore(seniorityOptions, seniorityLabel(p)) >= 80).length}</strong><span>Senior leaders</span></div><div><strong>{targetAlumni.filter(p => p.function === "HR").length}</strong><span>HR contacts</span></div><div><strong>{targetAlumni.filter(p => operationalStatus(p) === "Contact-ready").length}</strong><span>Contact-ready</span></div></div>
                <div className="distribution"><h3>Network by function</h3>{Object.entries(functionCounts).map(([name, count]) => <div key={name} className="distribution-row"><span>{name}</span><div><i style={{ width: `${Math.max(24, count / Math.max(targetAlumni.length, 1) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
              </article>
              <article className="panel contacts-panel"><div className="panel-heading"><div><p className="eyebrow">Recommended contacts</p><h2>Best people to approach</h2></div></div>{targetAlumni.length ? targetAlumni.map(person => { const relevance = relevanceBreakdown(person, companyPriorities).score; return <button key={person.id} className="contact-card" onClick={() => setSelected(person)}><span className="avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small><em>{person.assessment.iimlRelationship} IIML relationship</em></span><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></button> }) : <div className="empty-state"><ContactRound /><h3>No alumni mapped yet</h3><p>This is a clear network gap for the committee.</p></div>}</article>
              <article className="panel account-history"><div className="panel-heading"><div><p className="eyebrow">Institutional memory</p><h2>Account history</h2></div></div><div className="timeline-item"><span><CalendarClock /></span><div><strong>12 Aug 2026</strong><p>Placement outreach opened for the 2026–27 cycle.</p></div></div><div className="timeline-item"><span><History /></span><div><strong>22 Nov 2025</strong><p>Two recruiter conversations recorded. Product hiring discussed.</p></div></div><div className="timeline-item"><span><CheckCircle2 /></span><div><strong>08 Sep 2024</strong><p>Summer placement participation confirmed through an alumni introduction.</p></div></div></article>
            </section>
          </TabsContent>

          <TabsContent value="outreach" className="tab-panel">
            <section className="panel outreach-panel">
              <div className="panel-heading"><div><p className="eyebrow">Relationship workflow</p><h2>Outreach pipeline</h2><span>Updates are saved centrally and shared across committee members.</span></div></div>
              <div className="pipeline-summary">{statusOptions.map(status => <div key={status}><StatusBadge status={status} /><strong>{alumni.filter(person => person.status === status).length}</strong></div>)}</div>
              <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Target company</TableHead><TableHead>Why this person</TableHead><TableHead>Placement relevance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[...alumni].sort((a, b) => relevanceBreakdown(b, companyPriorities).score - relevanceBreakdown(a, companyPriorities).score).map(person => { const relevance = relevanceBreakdown(person, companyPriorities).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small></span></button></TableCell><TableCell>{person.company}</TableCell><TableCell className="reason-cell">{person.note}</TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><Select value={person.status} onValueChange={value => updateStatus(person.id, value as OutreachStatus)}><SelectTrigger className="status-select"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></TableCell></TableRow> })}</TableBody></Table>
            </section>
          </TabsContent>

          <TabsContent value="data-import" className="tab-panel">
            <section className="import-layout">
              <article className="panel import-panel">
                <div className="panel-heading"><div><p className="eyebrow">Alumni master data</p><h2>Import alumni records</h2><span>Add or update up to 250 records from a CSV file.</span></div><div className="database-badge"><Database /> Shared database</div></div>
                <div className="import-body">
                  <div className="upload-zone">
                    <FileSpreadsheet />
                    <div><strong>{importFile ? importFile.name : "Choose an alumni CSV file"}</strong><span>Required: name, batch and company. Existing records are matched by name, batch and company.</span></div>
                    <input aria-label="Choose alumni CSV file" type="file" accept=".csv,text/csv" onChange={event => setImportFile(event.target.files?.[0] ?? null)} />
                  </div>
                  <div className="import-actions"><Button variant="outline" onClick={downloadTemplate}><Download /> Download template</Button><Button onClick={importAlumni} disabled={!importFile || importing}>{importing ? <LoaderCircle className="spin" /> : <Upload />} {importing ? "Importing" : "Import to shared database"}</Button></div>
                  {workspaceMessage && <div className="workspace-message"><Cloud /> <span>{workspaceMessage}</span></div>}
                </div>
              </article>

              <aside className="panel database-panel">
                <div className="database-hero"><Database /><div><p className="eyebrow">Central data state</p><h2>{alumni.length} alumni records</h2><span>{companies.length} companies in one shared workspace</span></div></div>
                <div className="database-facts"><div><span>Persistence</span><strong>Across users and devices</strong></div><div><span>Duplicate control</span><strong>Name + batch + company</strong></div><div><span>Maximum batch</span><strong>250 records per import</strong></div><div><span>Current source</span><strong>{latestImport?.filename ?? "Demonstration alumni dataset"}</strong></div></div>
                <div className="latest-import"><CheckCircle2 /><div><strong>{latestImport ? "Latest import completed" : "Database ready"}</strong><span>{latestImport ? `${latestImport.rowCount} records by ${latestImport.importedBy}` : "No uploaded file has been recorded yet."}</span></div></div>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="enrichment" className="tab-panel">
            <section className="enrichment-header">
              <div><p className="eyebrow">PDL and Lusha</p><h2>Provider enrichment centre</h2><span>Refresh professional profiles, retrieve contact channels and control paid usage from one place.</span></div>
              <span className={`provider-mode mode-${enrichmentMode}`}>{enrichmentMode === "mock" ? "Demonstration mode" : "Live provider mode"}</span>
            </section>

            <section className="provider-grid">
              {(["pdl", "lusha"] as Provider[]).map(provider => {
                const usage = providerUsage[provider]
                const percent = usage.limit ? Math.min(100, usage.used / usage.limit * 100) : 100
                return <article className="panel provider-card" key={provider}>
                  <div className="provider-title"><span>{provider === "pdl" ? "PDL" : "LU"}</span><div><h3>{provider === "pdl" ? "People Data Labs" : "Lusha"}</h3><small>{provider === "pdl" ? "Profile discovery and employment refresh" : "Email and phone enrichment"}</small></div></div>
                  <div className="provider-status"><span className={usage.configured ? "configured" : "not-configured"}>{enrichmentMode === "mock" ? "Mock provider active" : usage.configured ? "API key configured" : "API key missing"}</span><strong>{usage.remaining} credits remaining</strong></div>
                  <div className="credit-meter"><i style={{ width: `${percent}%` }} /></div>
                  <div className="credit-numbers"><span>{usage.used} used this month</span><span>{usage.limit} app limit</span></div>
                  <div className="credit-limit"><Input type="number" min="0" value={creditDrafts[provider]} onChange={event => setCreditDrafts(current => ({ ...current, [provider]: event.target.value }))} aria-label={`${provider} monthly credit limit`} /><Button variant="outline" onClick={() => void saveCreditLimit(provider)}>Save limit</Button></div>
                  <p>{provider === "pdl" ? "A successful match is counted as 1 PDL credit." : "Usage estimate: 1 credit per email and 5 per phone. Actual usage is recorded from each result."}</p>
                </article>
              })}
            </section>

            <section className="panel batch-panel">
              <div className="panel-heading"><div><p className="eyebrow">Batch enrichment</p><h2>Select up to 25 approved alumni</h2><span>{selectedForEnrichment.length} selected. Contact retrieval happens only after a deliberate request.</span></div><div className="batch-actions"><Button variant="outline" disabled={!selectedForEnrichment.length || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email"])}>Get Emails</Button><Button variant="outline" disabled={!selectedForEnrichment.length || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["phone"])}>Get Phones</Button><Button disabled={!selectedForEnrichment.length || enriching} onClick={() => void runEnrichment(selectedForEnrichment, ["lusha"], "batch", ["email", "phone"])}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both</Button></div></div>
              {enrichmentMessage && <div className="enrichment-message"><Activity /> <span>{enrichmentMessage}</span></div>}
              <Table><TableHeader><TableRow><TableHead><input type="checkbox" aria-label="Select first 25 alumni" checked={Boolean(alumni.length) && selectedForEnrichment.length === Math.min(25, alumni.length)} onChange={event => setSelectedForEnrichment(event.target.checked ? alumni.slice(0, 25).map(person => person.id) : [])} /></TableHead><TableHead>Alumnus</TableHead><TableHead>Current profile</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>Last verified</TableHead></TableRow></TableHeader><TableBody>{alumni.map(person => <TableRow key={person.id}><TableCell><input type="checkbox" aria-label={`Select ${person.name}`} checked={selectedForEnrichment.includes(person.id)} onChange={() => toggleEnrichmentSelection(person.id)} /></TableCell><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{educationLabel(person)}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.verification.email}</TableCell><TableCell>{person.verification.phone}</TableCell><TableCell>{person.verified}</TableCell></TableRow>)}</TableBody></Table>
            </section>

            <section className="panel history-panel">
              <div className="panel-heading"><div><p className="eyebrow">Provider-response history</p><h2>Complete enrichment audit trail</h2><span>Sanitised request outcomes are shared centrally. API secrets and raw sensitive payloads are never stored here.</span></div><Button variant="ghost" size="sm" onClick={() => void loadEnrichment()}>Refresh history</Button></div>
              <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Provider</TableHead><TableHead>Alumnus</TableHead><TableHead>Operation</TableHead><TableHead>Result</TableHead><TableHead>Credits</TableHead><TableHead>Response</TableHead></TableRow></TableHeader><TableBody>{providerHistory.map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell><TableCell><span className="provider-chip">{item.provider.toUpperCase()}</span></TableCell><TableCell>{item.alumnusName}</TableCell><TableCell>{item.operation} · {item.mode}</TableCell><TableCell><span className={`history-status history-${item.status}`}>{item.status.replace("_", " ")}</span>{item.resultCount ? <small className="review-status">{item.resultCount} results</small> : null}</TableCell><TableCell>{item.creditsUsed}</TableCell><TableCell className="response-cell">{item.requestSummary && <small>{item.requestSummary}</small>}{item.errorMessage || item.responseSummary}</TableCell></TableRow>)}</TableBody></Table>
              {!providerHistory.length && <div className="empty-state"><Activity /><h3>No provider responses yet</h3><p>Run a manual or batch enrichment to create the first audit entry.</p></div>}
            </section>
          </TabsContent>
        </Tabs>
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent className="profile-sheet sm:max-w-xl">
          {selected && selectedBreakdown && <><SheetHeader className="profile-header"><div className="profile-avatar">{selected.initials}</div><div><SheetTitle>{selected.name}</SheetTitle><SheetDescription>{selected.title} at {selected.company}</SheetDescription></div></SheetHeader><div className="profile-scroll">
            <div className="profile-scores"><div><span>Data confidence</span><strong className={scoreTone(selected.confidence)}>{selected.confidence}%</strong><small>Can we trust the information?</small></div><div><span>Placement relevance</span><strong className={scoreTone(selectedBreakdown.score)}>{selectedBreakdown.score}/100</strong><small>How valuable is this alumnus for outreach?</small></div></div>
            <details className="score-breakdown"><summary>Why this Placement Relevance score?</summary><div className="breakdown-list">{selectedBreakdown.items.map(item => <div key={item.label}><span>{item.label}<small>{item.weight}% weight</small></span><strong>{item.score}</strong><em>{(item.score * item.weight / 100).toFixed(1)}</em></div>)}</div><p>Weighted contributions are added and rounded to the nearest whole number.</p></details>
            <section className="profile-section"><h3>Assess alumnus</h3><p className="section-help">Choose qualitative evidence. Corporate Network converts each choice into an auditable score.</p><div className="assessment-grid">
              <label><span>Hiring influence</span><Select value={selected.assessment.hiringInfluence} onValueChange={value => updateAssessment(selected.id, "hiringInfluence", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{hiringOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
              <label><span>IIML relationship</span><Select value={selected.assessment.iimlRelationship} onValueChange={value => updateAssessment(selected.id, "iimlRelationship", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{relationshipOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
              <label><span>Warm-introduction potential</span><Select value={selected.assessment.warmIntroPotential} onValueChange={value => updateAssessment(selected.id, "warmIntroPotential", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{warmIntroOptions.map(([label]) => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent></Select></label>
            </div><div className="derived-grid"><div><span>Company priority</span><strong>{companyPriorities[selected.company]}</strong><small>Inherited from company settings</small></div><div><span>Seniority</span><strong>{seniorityLabel(selected)}</strong><small>Derived from designation</small></div><div><span>Past responsiveness</span><strong>{responsivenessLabel(selected.status)}</strong><small>Derived from outreach history</small></div></div><div className="calculated-score"><span>Calculated Placement Relevance</span><strong>{selectedBreakdown.score}/100</strong></div></section>
            <section className="profile-section"><h3>Professional profile</h3><div className="detail-grid"><div><Building2 /><span>Current company<strong>{selected.company}</strong></span></div><div><BriefcaseBusiness /><span>Function<strong>{selected.function} · {selected.seniority}</strong></span></div><div><MapPin /><span>Location<strong>{selected.location}</strong></span></div><div><History /><span>Experience<strong>{selected.experience} years · Previously {selected.previous}</strong></span></div></div>{selected.linkedinUrl && <a className="profile-link" href={selected.linkedinUrl} target="_blank" rel="noreferrer">Open professional profile <ArrowUpRight /></a>}</section>
            <section className="profile-section"><h3>IIM Lucknow context</h3><div className="detail-grid"><div><CircleUserRound /><span>Programme and batch<strong>{educationLabel(selected)}</strong></span></div><div><Network /><span>PlaceCom relationship<strong>{selected.assessment.iimlRelationship === "Unknown / Not assessed" ? "No prior PlaceCom engagement" : selected.assessment.iimlRelationship}</strong></span></div></div><div className="insight-note"><Sparkles /><p>{selected.note}</p></div></section>
            <section className="profile-section"><div className="verification-heading"><div><h3>Contact and verification</h3><span className={`operational-status status-${operationalStatus(selected).toLowerCase().replaceAll(" ", "-")}`}>{operationalStatus(selected)}</span></div><small>Last verified {selected.verified}</small></div><div className="verification-list">
              <div><span>Profile match</span><strong className={verificationTone(selected.verification.profileMatch)}>{selected.verification.profileMatch}</strong></div>
              <div><span>Current company</span><strong className={verificationTone(selected.verification.currentCompany)}>{selected.verification.currentCompany}</strong></div>
              <div><span>Designation</span><strong className={verificationTone(selected.verification.designation)}>{selected.verification.designation}</strong></div>
              <div><span>Email · {selected.email || "Not enriched"}{selected.emailSource ? ` · Source: ${selected.emailSource}` : ""}{selected.emailRetrievedAt ? ` · Retrieved ${new Date(selected.emailRetrievedAt).toLocaleDateString()}` : ""}</span><strong className={verificationTone(selected.verification.email)}>{selected.verification.email}</strong></div>
              <div><span>Phone · {selected.phone || "Not enriched"}{selected.phoneSource ? ` · Source: ${selected.phoneSource}` : ""}{selected.phoneRetrievedAt ? ` · Retrieved ${new Date(selected.phoneRetrievedAt).toLocaleDateString()}` : ""}</span><strong className={verificationTone(selected.verification.phone)}>{selected.verification.phone}</strong></div>
              <div><span>Location</span><strong className={verificationTone(selected.verification.location)}>{selected.verification.location}</strong></div>
            </div><p className="verified-copy">Operational status uses field-level checks. It is not inferred from Data Confidence alone.</p><div className="refresh-note"><strong>Last PDL refresh</strong><span>{selected.lastPdlRefresh ? new Date(selected.lastPdlRefresh).toLocaleString() : "Not refreshed yet"}. A successful refresh may consume a credit even when no information changes.</span></div><div className="manual-enrichment"><Button variant="outline" disabled={enriching} onClick={() => compareRefreshWithPdl(selected)}>Compare & Refresh with PDL</Button><Button variant="outline" disabled={enriching} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["email"])}>Get Email</Button><Button variant="outline" disabled={enriching} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["phone"])}>Get Phone</Button><Button disabled={enriching} onClick={() => void runEnrichment([selected.id], ["lusha"], "manual", ["email", "phone"])}>{enriching ? <LoaderCircle className="spin" /> : <Zap />} Get Both</Button></div></section>
            <section className="profile-section"><h3>Update outreach status</h3><Select value={selected.status} onValueChange={value => updateStatus(selected.id, value as OutreachStatus)}><SelectTrigger className="profile-status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><p className="verified-copy">Saved centrally. Last updated by {selected.updatedBy ?? "the committee"}.</p></section>
          </div></>}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(comparisonResult)} onOpenChange={open => { if (!open) { setComparisonResult(null); setSelectedComparisonFields([]) } }}>
        <DialogContent className="comparison-dialog">
          <DialogHeader><DialogTitle>Compare professional profile</DialogTitle><DialogDescription>Review Corporate Network and PDL values. Nothing is overwritten until you approve selected fields.</DialogDescription></DialogHeader>
          {comparisonResult && <>
            <div className="comparison-person"><div className="avatar">{comparisonAlumnus?.initials ?? comparisonResult.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</div><div><strong>{comparisonResult.name}</strong><span><DiscoveryBadge status={comparisonResult.matchStatus} /> · {comparisonResult.matchConfidence}% match confidence</span></div></div>
            {comparisonAlumnus ? <div className="comparison-grid"><div className="comparison-head"><span>Field</span><strong>Internal database</strong><strong>PDL result</strong></div>{comparisonRows.map(row => {
              const changed = row.internal !== row.external && Boolean(row.external) && row.external !== "Not returned"
              return <label key={row.field} className={`comparison-row ${changed ? "changed" : "same"}`}><input type="checkbox" disabled={!changed} checked={selectedComparisonFields.includes(row.field)} onChange={() => setSelectedComparisonFields(current => current.includes(row.field) ? current.filter(item => item !== row.field) : [...current, row.field])} /><span>{row.label}<small>{changed ? "Changed" : "Same"}</small></span><strong>{row.internal}</strong><strong>{row.external}</strong></label>
            })}</div> : <div className="external-review-card"><div><span>Education</span><strong>{comparisonResult.education}</strong></div><div><span>Company</span><strong>{comparisonResult.currentCompany}</strong></div><div><span>Role</span><strong>{comparisonResult.role}</strong></div><div><span>Function and seniority</span><strong>{comparisonResult.function} · {comparisonResult.seniority}</strong></div><div><span>Location</span><strong>{comparisonResult.location}</strong></div><div><span>Graduation year</span><strong>{comparisonResult.graduationYear || "Not returned"}</strong></div></div>}
          </>}
          <DialogFooter className="comparison-footer">
            {comparisonResult?.matchStatus === "Possible duplicate" && <Button variant="outline" onClick={() => void keepDiscoveryResultSeparate()} disabled={discovering}>Keep separate</Button>}
            {comparisonResult?.matchStatus === "Needs review" && <Button variant="outline" onClick={() => { void ignoreDiscoveryResult(comparisonResult.id); setComparisonResult(null) }}>Ignore profile</Button>}
            {comparisonAlumnus && <Button variant="ghost" onClick={() => { setSelected(comparisonAlumnus); setComparisonResult(null) }}><Eye /> View existing record</Button>}
            {comparisonAlumnus ? <Button onClick={() => void applyComparison()} disabled={discovering}>{selectedComparisonFields.length ? "Apply selected updates" : "Confirm no changes"}</Button> : <Button onClick={() => setComparisonResult(null)}>Close review</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
