"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight, BriefcaseBusiness, Building2, CalendarClock, CheckCircle2,
  ChevronRight, CircleUserRound, Cloud, ContactRound, Database, Download,
  FileSpreadsheet, History, LoaderCircle, MapPin, Network, Search, Sparkles,
  Target, Upload, UserRoundCheck, UsersRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type OutreachStatus = "Not contacted" | "Contacted" | "Responded" | "Meeting set"
type VerificationState = "Confirmed" | "Verified" | "Likely" | "Unverified" | "Possibly outdated" | "Mismatch"

type Alumni = {
  id: number
  name: string
  initials: string
  batch: number
  programme: string
  company: string
  title: string
  function: string
  seniority: string
  location: string
  previous: string
  experience: number
  confidence: number
  email: string
  phone: string
  linkedinUrl?: string
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

function StatusBadge({ status }: { status: OutreachStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
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
  const [query, setQuery] = useState("")
  const [company, setCompany] = useState("All companies")
  const [func, setFunc] = useState("All functions")
  const [seniority, setSeniority] = useState("All levels")
  const [selected, setSelected] = useState<Alumni | null>(null)
  const [targetCompany, setTargetCompany] = useState("Microsoft")
  const [activeTab, setActiveTab] = useState("overview")
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [workspaceMessage, setWorkspaceMessage] = useState("")
  const [latestImport, setLatestImport] = useState<LatestImport | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

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
      if (data.alumni?.length) setAlumni(data.alumni)
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

  const companies = useMemo(() => [...new Set(alumni.map(person => person.company))].sort(), [alumni])
  const functions = useMemo(() => [...new Set(alumni.map(person => person.function))].sort(), [alumni])
  const levels = useMemo(() => [...new Set(alumni.map(person => person.seniority))].sort(), [alumni])
  const filtered = useMemo(() => alumni.filter(person => {
    const text = `${person.name} ${person.company} ${person.title} ${person.location}`.toLowerCase()
    return text.includes(query.toLowerCase())
      && (company === "All companies" || person.company === company)
      && (func === "All functions" || person.function === func)
      && (seniority === "All levels" || person.seniority === seniority)
  }).sort((a, b) => relevanceBreakdown(b, companyPriorities).score - relevanceBreakdown(a, companyPriorities).score), [alumni, company, companyPriorities, func, query, seniority])

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
      "name,batch,programme,company,title,function,seniority,location,previous_companies,experience_years,email,phone,linkedin_url,confidence,status,note",
      'Demo Alumnus,2018,PGP,Example Company,"Senior Manager, Talent Acquisition",HR,Senior Manager,Bengaluru,Example Consulting,8,demo@example.com,+910000000000,,70,Not contacted,"Demonstration record only"',
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

  const functionCounts = targetAlumni.reduce<Record<string, number>>((acc, person) => {
    acc[person.function] = (acc[person.function] ?? 0) + 1
    return acc
  }, {})
  const selectedBreakdown = selected ? relevanceBreakdown(selected, companyPriorities) : null

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
              <div className="panel-heading directory-heading"><div><p className="eyebrow">Discover and prioritise</p><h2>Alumni directory</h2><span>{filtered.length} matching records, ranked by Placement Relevance</span></div></div>
              <div className="filters">
                <div className="search-field"><Search /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, company, role or city" aria-label="Search alumni" /></div>
                <Select value={company} onValueChange={setCompany}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All companies">All companies</SelectItem>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={func} onValueChange={setFunc}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={seniority} onValueChange={setSeniority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All levels">All levels</SelectItem>{levels.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Button variant="ghost" onClick={() => { setQuery(""); setCompany("All companies"); setFunc("All functions"); setSeniority("All levels") }}>Clear</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Location</TableHead><TableHead>Data confidence</TableHead><TableHead>Placement relevance</TableHead><TableHead>Outreach</TableHead></TableRow></TableHeader>
                <TableBody>{filtered.map(person => { const relevance = relevanceBreakdown(person, companyPriorities).score; return <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.programme} · {person.batch}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.function}</TableCell><TableCell>{person.location}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.confidence)}`}>{person.confidence}%</span></TableCell><TableCell><span className={`score-pill ${scoreTone(relevance)}`}>{relevance}/100</span></TableCell><TableCell><StatusBadge status={person.status} /></TableCell></TableRow> })}</TableBody>
              </Table>
              {filtered.length === 0 && <div className="empty-state"><Search /><h3>No alumni match these filters</h3><p>Clear a filter or try a broader search.</p></div>}
            </section>
          </TabsContent>

          <TabsContent value="companies" className="tab-panel">
            <section className="company-toolbar"><div><p className="eyebrow">Company intelligence</p><h2>Map the strongest route into a target firm.</h2></div><Select value={targetCompany} onValueChange={setTargetCompany}><SelectTrigger className="company-select"><Building2 /><SelectValue /></SelectTrigger><SelectContent>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></section>
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
            <section className="profile-section"><h3>IIM Lucknow context</h3><div className="detail-grid"><div><CircleUserRound /><span>Programme and batch<strong>{selected.programme} · {selected.batch}</strong></span></div><div><Network /><span>PlaceCom relationship<strong>{selected.assessment.iimlRelationship === "Unknown / Not assessed" ? "No prior PlaceCom engagement" : selected.assessment.iimlRelationship}</strong></span></div></div><div className="insight-note"><Sparkles /><p>{selected.note}</p></div></section>
            <section className="profile-section"><div className="verification-heading"><div><h3>Contact and verification</h3><span className={`operational-status status-${operationalStatus(selected).toLowerCase().replaceAll(" ", "-")}`}>{operationalStatus(selected)}</span></div><small>Last verified {selected.verified}</small></div><div className="verification-list">
              <div><span>Profile match</span><strong className={verificationTone(selected.verification.profileMatch)}>{selected.verification.profileMatch}</strong></div>
              <div><span>Current company</span><strong className={verificationTone(selected.verification.currentCompany)}>{selected.verification.currentCompany}</strong></div>
              <div><span>Designation</span><strong className={verificationTone(selected.verification.designation)}>{selected.verification.designation}</strong></div>
              <div><span>Email · {selected.email}</span><strong className={verificationTone(selected.verification.email)}>{selected.verification.email}</strong></div>
              <div><span>Phone · {selected.phone}</span><strong className={verificationTone(selected.verification.phone)}>{selected.verification.phone}</strong></div>
              <div><span>Location</span><strong className={verificationTone(selected.verification.location)}>{selected.verification.location}</strong></div>
            </div><p className="verified-copy">Operational status uses field-level checks. It is not inferred from Data Confidence alone.</p></section>
            <section className="profile-section"><h3>Update outreach status</h3><Select value={selected.status} onValueChange={value => updateStatus(selected.id, value as OutreachStatus)}><SelectTrigger className="profile-status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select><p className="verified-copy">Saved centrally. Last updated by {selected.updatedBy ?? "the committee"}.</p></section>
          </div></>}
        </SheetContent>
      </Sheet>
    </main>
  )
}
