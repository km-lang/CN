"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowUpRight, BriefcaseBusiness, Building2, CalendarClock, CheckCircle2,
  ChevronRight, CircleUserRound, ContactRound, History, Mail, MapPin, Network,
  Phone, Search, Sparkles, Target, UsersRound,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type OutreachStatus = "Not contacted" | "Contacted" | "Responded" | "Meeting set"

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
  relevance: number
  relationship: "Strong" | "Warm" | "New"
  email: string
  phone: string
  verified: string
  status: OutreachStatus
  note: string
}

const alumniSeed: Alumni[] = [
  { id: 1, name: "Aditi Srivastava", initials: "AS", batch: 2012, programme: "PGP", company: "Microsoft", title: "Director, People & Culture", function: "HR", seniority: "Director", location: "Gurugram", previous: "Deloitte, GE", experience: 14, confidence: 94, relevance: 93, relationship: "Strong", email: "aditi.s@example.com", phone: "+91 98••• 4102", verified: "12 days ago", status: "Meeting set", note: "Supported summer placements in 2024. Best route to India TA leadership." },
  { id: 2, name: "Rohan Mehta", initials: "RM", batch: 2015, programme: "PGP", company: "Amazon", title: "Senior Manager, Talent Acquisition", function: "HR", seniority: "Senior Manager", location: "Bengaluru", previous: "Flipkart, EY", experience: 11, confidence: 91, relevance: 90, relationship: "Warm", email: "rohan.m@example.com", phone: "+91 99••• 6721", verified: "21 days ago", status: "Responded", note: "Replied positively last cycle. Interested in product and operations roles." },
  { id: 3, name: "Neha Kapoor", initials: "NK", batch: 2008, programme: "PGP", company: "Tata Consumer", title: "Vice President, Strategy", function: "Strategy", seniority: "VP", location: "Mumbai", previous: "Bain & Company", experience: 18, confidence: 88, relevance: 86, relationship: "Strong", email: "neha.k@example.com", phone: "+91 98••• 0385", verified: "36 days ago", status: "Contacted", note: "Regular alumni speaker. Can introduce the campus team to business HR." },
  { id: 4, name: "Arjun Bhatia", initials: "AB", batch: 2017, programme: "PGP", company: "Microsoft", title: "Principal Product Manager", function: "Product", seniority: "Director", location: "Hyderabad", previous: "Adobe, Infosys", experience: 9, confidence: 96, relevance: 79, relationship: "Warm", email: "arjun.b@example.com", phone: "+91 97••• 9460", verified: "8 days ago", status: "Not contacted", note: "High-confidence profile. Useful product hiring route, but no prior placement interaction." },
  { id: 5, name: "Kavya Nair", initials: "KN", batch: 2013, programme: "PGP-ABM", company: "ITC", title: "General Manager, Rural Markets", function: "Sales", seniority: "GM", location: "Kolkata", previous: "HUL", experience: 13, confidence: 87, relevance: 82, relationship: "Strong", email: "kavya.n@example.com", phone: "+91 98••• 2241", verified: "44 days ago", status: "Responded", note: "Previously mentored ABM students. Strong fit for rural sales and strategy roles." },
  { id: 6, name: "Vikram Rao", initials: "VR", batch: 2010, programme: "PGP", company: "Google", title: "Country Operations Lead", function: "Operations", seniority: "VP", location: "Bengaluru", previous: "Uber, McKinsey", experience: 16, confidence: 90, relevance: 88, relationship: "New", email: "vikram.r@example.com", phone: "+91 99••• 7814", verified: "17 days ago", status: "Not contacted", note: "Senior decision-maker. A warm introduction is available through Neha Kapoor." },
  { id: 7, name: "Meera Iyer", initials: "MI", batch: 2019, programme: "PGP", company: "Amazon", title: "Finance Manager", function: "Finance", seniority: "Manager", location: "Bengaluru", previous: "P&G", experience: 7, confidence: 92, relevance: 65, relationship: "Warm", email: "meera.i@example.com", phone: "+91 96••• 4108", verified: "15 days ago", status: "Contacted", note: "Engaged with the finance club. Better suited for role intelligence than recruiter outreach." },
  { id: 8, name: "Siddharth Jain", initials: "SJ", batch: 2006, programme: "PGP", company: "Deloitte", title: "Managing Director", function: "Consulting", seniority: "C-suite", location: "Mumbai", previous: "Kearney", experience: 20, confidence: 86, relevance: 91, relationship: "Strong", email: "siddharth.j@example.com", phone: "+91 98••• 5542", verified: "52 days ago", status: "Meeting set", note: "Long-standing campus relationship. Priority route for consulting leadership." },
  { id: 9, name: "Priya Menon", initials: "PM", batch: 2016, programme: "PGP", company: "Flipkart", title: "Director, Category Management", function: "Operations", seniority: "Director", location: "Bengaluru", previous: "Amazon", experience: 10, confidence: 89, relevance: 80, relationship: "Warm", email: "priya.m@example.com", phone: "+91 97••• 1973", verified: "28 days ago", status: "Not contacted", note: "Recently promoted. Timely congratulations can open a placement conversation." },
  { id: 10, name: "Rahul Banerjee", initials: "RB", batch: 2011, programme: "PGP", company: "HDFC Bank", title: "Senior Vice President", function: "Finance", seniority: "VP", location: "Mumbai", previous: "ICICI Bank", experience: 15, confidence: 84, relevance: 83, relationship: "New", email: "rahul.b@example.com", phone: "+91 99••• 2636", verified: "61 days ago", status: "Not contacted", note: "Role is relevant, but contact data needs another verification before outreach." },
  { id: 11, name: "Tanvi Gupta", initials: "TG", batch: 2018, programme: "PGP", company: "Google", title: "People Partner, India", function: "HR", seniority: "Senior Manager", location: "Gurugram", previous: "Microsoft", experience: 8, confidence: 95, relevance: 92, relationship: "Warm", email: "tanvi.g@example.com", phone: "+91 98••• 8309", verified: "6 days ago", status: "Responded", note: "Changed companies recently. Existing Microsoft relationship can provide context." },
  { id: 12, name: "Mohit Khanna", initials: "MK", batch: 2014, programme: "IPMX", company: "Deloitte", title: "Partner, Technology Strategy", function: "Consulting", seniority: "Partner", location: "Gurugram", previous: "Accenture", experience: 17, confidence: 93, relevance: 87, relationship: "Strong", email: "mohit.k@example.com", phone: "+91 96••• 5427", verified: "19 days ago", status: "Contacted", note: "Past guest lecturer. Strong candidate for technology consulting outreach." },
]

const statusOptions: OutreachStatus[] = ["Not contacted", "Contacted", "Responded", "Meeting set"]

function scoreTone(score: number) {
  if (score >= 90) return "score-high"
  if (score >= 80) return "score-medium"
  return "score-low"
}

function StatusBadge({ status }: { status: OutreachStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>
}

function StatCard({ icon: Icon, label, value, delta }: { icon: typeof UsersRound; label: string; value: string; delta: string }) {
  return <article className="stat-card"><div className="stat-icon"><Icon aria-hidden="true" /></div><div><p>{label}</p><strong>{value}</strong><span>{delta}</span></div></article>
}

export default function Home() {
  const [alumni, setAlumni] = useState<Alumni[]>(alumniSeed)
  const [query, setQuery] = useState("")
  const [company, setCompany] = useState("All companies")
  const [func, setFunc] = useState("All functions")
  const [seniority, setSeniority] = useState("All levels")
  const [selected, setSelected] = useState<Alumni | null>(null)
  const [targetCompany, setTargetCompany] = useState("Microsoft")

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem("iiml-outreach-statuses")
      if (!saved) return
      try {
        const statuses = JSON.parse(saved) as Record<number, OutreachStatus>
        setAlumni(current => current.map(person => ({ ...person, status: statuses[person.id] ?? person.status })))
      } catch {
        window.localStorage.removeItem("iiml-outreach-statuses")
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const companies = useMemo(() => [...new Set(alumni.map(person => person.company))].sort(), [alumni])
  const functions = useMemo(() => [...new Set(alumni.map(person => person.function))].sort(), [alumni])
  const levels = useMemo(() => [...new Set(alumni.map(person => person.seniority))].sort(), [alumni])
  const filtered = useMemo(() => alumni.filter(person => {
    const text = `${person.name} ${person.company} ${person.title} ${person.location}`.toLowerCase()
    return text.includes(query.toLowerCase())
      && (company === "All companies" || person.company === company)
      && (func === "All functions" || person.function === func)
      && (seniority === "All levels" || person.seniority === seniority)
  }).sort((a, b) => b.relevance - a.relevance), [alumni, company, func, query, seniority])

  const topLeads = [...alumni].sort((a, b) => b.relevance - a.relevance).slice(0, 5)
  const targetAlumni = alumni.filter(person => person.company === targetCompany).sort((a, b) => b.relevance - a.relevance)
  const activeOutreach = alumni.filter(person => person.status !== "Not contacted").length
  const verifiedContacts = alumni.filter(person => person.confidence >= 90).length

  function updateStatus(id: number, status: OutreachStatus) {
    setAlumni(current => {
      const next = current.map(person => person.id === id ? { ...person, status } : person)
      window.localStorage.setItem("iiml-outreach-statuses", JSON.stringify(Object.fromEntries(next.map(person => [person.id, person.status]))))
      return next
    })
    if (selected?.id === id) setSelected({ ...selected, status })
  }

  const functionCounts = targetAlumni.reduce<Record<string, number>>((acc, person) => {
    acc[person.function] = (acc[person.function] ?? 0) + 1
    return acc
  }, {})

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">IL</div><div><strong>IIML Alumni Intelligence</strong><span>Placement Committee Workspace</span></div></div>
        <div className="data-state"><span /> Sample data · API-ready</div>
      </header>

      <section className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">Placement intelligence</p><h1>Turn alumni connections into recruiter conversations.</h1></div>
          <Button onClick={() => document.querySelector<HTMLButtonElement>('[data-tab="directory"]')?.click()}><Search /> Find an alumnus</Button>
        </div>

        <Tabs defaultValue="overview" className="product-tabs">
          <TabsList variant="line" className="main-tabs" aria-label="Platform sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="directory" data-tab="directory">Alumni directory</TabsTrigger>
            <TabsTrigger value="companies">Company intelligence</TabsTrigger>
            <TabsTrigger value="outreach">Outreach</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="tab-panel">
            <section className="stats-grid" aria-label="Key metrics">
              <StatCard icon={UsersRound} label="Alumni mapped" value="1,248" delta="+36 this month" />
              <StatCard icon={Building2} label="Companies covered" value="186" delta="24 priority firms" />
              <StatCard icon={CheckCircle2} label="Verified contacts" value={`${verifiedContacts}/12`} delta="MVP sample" />
              <StatCard icon={Target} label="Active outreach" value={`${activeOutreach}`} delta="Across 7 companies" />
            </section>

            <section className="overview-grid">
              <article className="panel lead-panel">
                <div className="panel-heading"><div><p className="eyebrow">Recommended next</p><h2>Highest-value alumni leads</h2></div><Button variant="ghost" size="sm" onClick={() => document.querySelector<HTMLButtonElement>('[data-tab="directory"]')?.click()}>View all <ArrowUpRight /></Button></div>
                <div className="lead-list">{topLeads.map((person, index) => <button key={person.id} className="lead-row" onClick={() => setSelected(person)}><span className="rank">0{index + 1}</span><span className="avatar">{person.initials}</span><span className="lead-copy"><strong>{person.name}</strong><small>{person.title} · {person.company}</small></span><span className={`score-pill ${scoreTone(person.relevance)}`}>{person.relevance}</span><ChevronRight aria-hidden="true" /></button>)}</div>
              </article>

              <aside className="panel signal-panel">
                <div className="signal-orbit"><Sparkles /><span>3</span></div><p className="eyebrow">Professional signals</p><h2>Three timely reasons to reach out</h2>
                <div className="signal-item"><div><ArrowUpRight /></div><p><strong>Priya Menon</strong> was promoted to Director at Flipkart.</p></div>
                <div className="signal-item"><div><BriefcaseBusiness /></div><p><strong>Tanvi Gupta</strong> recently moved to Google People Operations.</p></div>
                <div className="signal-item"><div><Building2 /></div><p><strong>Microsoft India</strong> announced expanded AI hiring.</p></div>
              </aside>
            </section>

            <section className="panel route-panel">
              <div className="panel-heading"><div><p className="eyebrow">Warm introduction route</p><h2>Best path into Google India</h2></div><span className="route-score">88 relevance</span></div>
              <div className="route-flow"><div className="route-node active"><span>NK</span><p><strong>Neha Kapoor</strong><small>Strong IIML relationship</small></p></div><div className="route-link"><span>Can introduce</span><Network /></div><div className="route-node"><span>VR</span><p><strong>Vikram Rao</strong><small>Country Operations Lead</small></p></div><div className="route-link"><span>Target company</span><ChevronRight /></div><div className="company-node"><Building2 /><p><strong>Google India</strong><small>2 mapped alumni</small></p></div></div>
            </section>
          </TabsContent>

          <TabsContent value="directory" className="tab-panel">
            <section className="panel directory-panel">
              <div className="panel-heading directory-heading"><div><p className="eyebrow">Discover and prioritise</p><h2>Alumni directory</h2><span>{filtered.length} matching records, ranked by placement relevance</span></div></div>
              <div className="filters">
                <div className="search-field"><Search /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, company, role or city" aria-label="Search alumni" /></div>
                <Select value={company} onValueChange={setCompany}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All companies">All companies</SelectItem>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={func} onValueChange={setFunc}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All functions">All functions</SelectItem>{functions.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Select value={seniority} onValueChange={setSeniority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="All levels">All levels</SelectItem>{levels.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                <Button variant="ghost" onClick={() => { setQuery(""); setCompany("All companies"); setFunc("All functions"); setSeniority("All levels") }}>Clear</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Company and role</TableHead><TableHead>Function</TableHead><TableHead>Location</TableHead><TableHead>Confidence</TableHead><TableHead>Relevance</TableHead><TableHead>Outreach</TableHead></TableRow></TableHeader>
                <TableBody>{filtered.map(person => <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.programme} · {person.batch}</small></span></button></TableCell><TableCell><span className="stacked-cell"><strong>{person.company}</strong><small>{person.title}</small></span></TableCell><TableCell>{person.function}</TableCell><TableCell>{person.location}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.confidence)}`}>{person.confidence}%</span></TableCell><TableCell><span className={`score-pill ${scoreTone(person.relevance)}`}>{person.relevance}</span></TableCell><TableCell><StatusBadge status={person.status} /></TableCell></TableRow>)}</TableBody>
              </Table>
              {filtered.length === 0 && <div className="empty-state"><Search /><h3>No alumni match these filters</h3><p>Clear a filter or try a broader search.</p></div>}
            </section>
          </TabsContent>

          <TabsContent value="companies" className="tab-panel">
            <section className="company-toolbar"><div><p className="eyebrow">Company intelligence</p><h2>Map the strongest route into a target firm.</h2></div><Select value={targetCompany} onValueChange={setTargetCompany}><SelectTrigger className="company-select"><Building2 /><SelectValue /></SelectTrigger><SelectContent>{companies.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></section>
            <section className="company-grid">
              <article className="panel company-summary">
                <div className="company-title"><div className="company-logo">{targetCompany.slice(0, 1)}</div><div><h2>{targetCompany}</h2><span>Priority account · Target company</span></div></div>
                <div className="company-kpis"><div><strong>{targetAlumni.length}</strong><span>Alumni mapped</span></div><div><strong>{targetAlumni.filter(p => ["Director", "VP", "C-suite", "Partner", "GM"].includes(p.seniority)).length}</strong><span>Senior leaders</span></div><div><strong>{targetAlumni.filter(p => p.function === "HR").length}</strong><span>HR contacts</span></div><div><strong>{targetAlumni.filter(p => p.confidence >= 90).length}</strong><span>Verified</span></div></div>
                <div className="distribution"><h3>Network by function</h3>{Object.entries(functionCounts).map(([name, count]) => <div key={name} className="distribution-row"><span>{name}</span><div><i style={{ width: `${Math.max(24, count / Math.max(targetAlumni.length, 1) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
              </article>
              <article className="panel contacts-panel"><div className="panel-heading"><div><p className="eyebrow">Recommended contacts</p><h2>Best people to approach</h2></div></div>{targetAlumni.length ? targetAlumni.map(person => <button key={person.id} className="contact-card" onClick={() => setSelected(person)}><span className="avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small><em>{person.relationship} relationship</em></span><span className={`score-pill ${scoreTone(person.relevance)}`}>{person.relevance}</span></button>) : <div className="empty-state"><ContactRound /><h3>No alumni mapped yet</h3><p>This is a clear network gap for the committee.</p></div>}</article>
              <article className="panel account-history"><div className="panel-heading"><div><p className="eyebrow">Institutional memory</p><h2>Account history</h2></div></div><div className="timeline-item"><span><CalendarClock /></span><div><strong>12 Aug 2026</strong><p>Placement outreach opened for the 2026–27 cycle.</p></div></div><div className="timeline-item"><span><History /></span><div><strong>22 Nov 2025</strong><p>Two recruiter conversations recorded. Product hiring discussed.</p></div></div><div className="timeline-item"><span><CheckCircle2 /></span><div><strong>08 Sep 2024</strong><p>Summer placement participation confirmed through an alumni introduction.</p></div></div></article>
            </section>
          </TabsContent>

          <TabsContent value="outreach" className="tab-panel">
            <section className="panel outreach-panel">
              <div className="panel-heading"><div><p className="eyebrow">Relationship workflow</p><h2>Outreach pipeline</h2><span>Updates are saved on this device for the MVP.</span></div></div>
              <div className="pipeline-summary">{statusOptions.map(status => <div key={status}><StatusBadge status={status} /><strong>{alumni.filter(person => person.status === status).length}</strong></div>)}</div>
              <Table><TableHeader><TableRow><TableHead>Alumnus</TableHead><TableHead>Target company</TableHead><TableHead>Why this person</TableHead><TableHead>Relevance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{[...alumni].sort((a, b) => b.relevance - a.relevance).map(person => <TableRow key={person.id}><TableCell><button className="person-cell" onClick={() => setSelected(person)}><span className="avatar small">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small></span></button></TableCell><TableCell>{person.company}</TableCell><TableCell className="reason-cell">{person.note}</TableCell><TableCell><span className={`score-pill ${scoreTone(person.relevance)}`}>{person.relevance}</span></TableCell><TableCell><Select value={person.status} onValueChange={value => updateStatus(person.id, value as OutreachStatus)}><SelectTrigger className="status-select"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></TableCell></TableRow>)}</TableBody></Table>
            </section>
          </TabsContent>
        </Tabs>
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent className="profile-sheet sm:max-w-xl">
          {selected && <><SheetHeader className="profile-header"><div className="profile-avatar">{selected.initials}</div><div><SheetTitle>{selected.name}</SheetTitle><SheetDescription>{selected.title} at {selected.company}</SheetDescription></div></SheetHeader><div className="profile-scroll">
            <div className="profile-scores"><div><span>Data confidence</span><strong className={scoreTone(selected.confidence)}>{selected.confidence}%</strong><small>Can we trust the data?</small></div><div><span>Placement relevance</span><strong className={scoreTone(selected.relevance)}>{selected.relevance}</strong><small>Should we approach now?</small></div></div>
            <section className="profile-section"><h3>Professional profile</h3><div className="detail-grid"><div><Building2 /><span>Current company<strong>{selected.company}</strong></span></div><div><BriefcaseBusiness /><span>Function<strong>{selected.function} · {selected.seniority}</strong></span></div><div><MapPin /><span>Location<strong>{selected.location}</strong></span></div><div><History /><span>Experience<strong>{selected.experience} years · Previously {selected.previous}</strong></span></div></div></section>
            <section className="profile-section"><h3>IIM Lucknow context</h3><div className="detail-grid"><div><CircleUserRound /><span>Programme and batch<strong>{selected.programme} · {selected.batch}</strong></span></div><div><Network /><span>Relationship<strong>{selected.relationship}</strong></span></div></div><div className="insight-note"><Sparkles /><p>{selected.note}</p></div></section>
            <section className="profile-section"><h3>Contact and verification</h3><div className="contact-line"><Mail /><span>{selected.email}</span><CheckCircle2 /></div><div className="contact-line"><Phone /><span>{selected.phone}</span><CheckCircle2 /></div><p className="verified-copy">Core profile verified {selected.verified}. Phone is partially masked in this sample dataset.</p></section>
            <section className="profile-section"><h3>Update outreach status</h3><Select value={selected.status} onValueChange={value => updateStatus(selected.id, value as OutreachStatus)}><SelectTrigger className="profile-status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></section>
          </div></>}
        </SheetContent>
      </Sheet>
    </main>
  )
}
