import React from "react"
import { createRoot } from "react-dom/client"

import Home from "@/app/page"
import { AccessProvider } from "@/app/access-provider"
import "@/app/globals.css"

const scenario = new URLSearchParams(window.location.search).get("testScenario") ?? "success"

let sahil = {
  id: 15, name: "Sahil Bansal", initials: "SB", batch: 2012, graduationYear: 2012, programme: "PGP", education: "Indian Institute of Management Lucknow",
  company: "Google", title: "Product Leader", rawTitle: "Product Leader", function: "Product", seniority: "Director / GM", location: "Bengaluru", previous: "Microsoft", experience: 14,
  confidence: 96, email: "sahil.bansal@example.test", phone: "+91 9000000015", linkedinUrl: "https://linkedin.com/in/sahilb", pdlPersonId: "pdl-15", lushaPersonId: "lusha-15",
  emailSource: "Stored verified contact", verified: "Verified", status: "Contacted", note: "Historical outreach exists.", assessment: { hiringInfluence: "Strong hiring influence", iimlRelationship: "Strong", warmIntroPotential: "Can credibly provide introduction" },
  verification: { profileMatch: "Confirmed", currentCompany: "Verified", designation: "Verified", email: "Verified", phone: "Verified", location: "Verified" },
  privacy: { generalContactStatus: "Standard engagement allowed", professionalEngagementStatus: "Professional engagement only", birthdayEngagementStatus: "Unknown", consentSource: "Internal record", notes: "", updatedAt: "2026-09-01T00:00:00Z", updatedBy: "Test" },
}

const priya = {
  ...sahil,
  id: 22,
  name: "Priya Sharma",
  initials: "PS",
  batch: 2015,
  graduationYear: 2015,
  title: "Vice President, Human Resources",
  function: "HR",
  seniority: "Vice President / CXO",
  location: "Mumbai",
  email: "priya.sharma@example.test",
  phone: "+91 9000000022",
  linkedinUrl: "https://linkedin.com/in/priyasharma",
  pdlPersonId: "pdl-22",
  lushaPersonId: "lusha-22",
}

const historicalEvent = {
  id: 901, eventKey: "manual-professional-email:15:completed", alumnusId: 15, company: "Google", eventType: "Manual Relationship", eventSubtype: "Controlled institutional email", eventTitle: "Completed historical outreach", eventDescription: "Historical email", eventDate: "2026-08-01", source: "Manual PCOM selection", sourceDetectedDate: "", status: "Action Taken", assignedTo: "Test Operator", assignedAt: "", actionTakenAt: "2026-08-01T12:00:00Z", actionTakenBy: "Test Operator", actionType: "Congratulations Email", actionChannel: "Email", deliveryStatus: "Sent", responseReceived: false, responseReceivedAt: "", responseType: "", followUpRequired: false, followUpDate: "", skipReason: "", lastViewedBy: "", alumnus: sahil, birthday: null, preference: "Professional engagement only", actions: [{ id: 1, actionType: "Congratulations Email", channel: "Email", performedBy: "Test Operator", performedAt: "2026-08-01T12:00:00Z", subject: "Earlier outreach", deliveryStatus: "Sent", notes: "" }], responses: [], views: [], activity: [],
}

const preparedEvent = { ...historicalEvent, id: 902, eventKey: "manual-professional-email:15:new", eventTitle: "Controlled institutional outreach", status: "New", actionTakenAt: "", actionTakenBy: "", actionType: "", deliveryStatus: "", actions: [] }
const template = { id: 51, templateKey: "professional-outreach-v1", name: "Professional outreach", eventType: "Professional Signal", subject: "Connecting with IIM Lucknow", body: "Hello [First Name],\n\nWe would value a conversation.", status: "Approved", version: 1 }

declare global {
  interface Window { __emailTest: { prepareRequests: number; sends: number; providerCalls: string[]; workspaceGets: number; workspaceMutations: number; workspaceMutationActive: number; maximumWorkspaceMutationActive: number; persistedStatus: string } }
}

window.__emailTest = { prepareRequests: 0, sends: 0, providerCalls: [], workspaceGets: 0, workspaceMutations: 0, workspaceMutationActive: 0, maximumWorkspaceMutationActive: 0, persistedStatus: sahil.status }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const originalFetch = window.fetch.bind(window)

window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href)
  const method = init?.method ?? (input instanceof Request ? input.method : "GET")
  if (/peopledata|lusha|googleapis|gmail/i.test(url.hostname + url.pathname)) {
    window.__emailTest.providerCalls.push(url.href)
    throw new Error(`Live provider call blocked by browser fixture: ${url.href}`)
  }
  if (url.pathname.endsWith("/api/workspace") && method === "GET") {
    window.__emailTest.workspaceGets += 1
    return json({ alumni: [sahil, priya], companyPriorities: { Google: "Tier 1 Strategic Target" }, latestImport: null })
  }
  if (url.pathname.endsWith("/api/workspace") && method === "PATCH") {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { action?: string; id?: number; status?: string }
    window.__emailTest.workspaceMutations += 1
    window.__emailTest.workspaceMutationActive += 1
    window.__emailTest.maximumWorkspaceMutationActive = Math.max(window.__emailTest.maximumWorkspaceMutationActive, window.__emailTest.workspaceMutationActive)
    await new Promise(resolve => setTimeout(resolve, payload.status === "Contacted" ? 60 : 10))
    window.__emailTest.workspaceMutationActive -= 1
    if (scenario === "mutation-failure" && payload.status === "Responded") return json({ error: "Fixture persistence failure." }, 500)
    if (payload.action === "update_alumnus" && payload.id === sahil.id && payload.status) {
      sahil = { ...sahil, status: payload.status as typeof sahil.status }
      window.__emailTest.persistedStatus = sahil.status
      return json({ alumnus: sahil })
    }
    return json({ error: "Unexpected workspace mutation." }, 400)
  }
  if (url.pathname.endsWith("/api/enrichment")) return json({ modes: { pdl: "mock", lusha: "mock" }, usage: { pdl: { used: 0, limit: 100, remaining: 100, configured: false, mode: "mock" }, lusha: { used: 0, limit: 100, remaining: 100, configured: false, mode: "mock" } }, history: [] })
  if (url.pathname.endsWith("/api/discovery")) return json({ pendingCount: 0, liveMaximum: 5 })
  if (url.pathname.endsWith("/api/signals")) return json({ mode: "mock", configured: false, liveEnabled: false, entitlement: "unknown", startDate: "", requiresManualEntitlementValidation: true })
  if (url.pathname.endsWith("/api/engagements") && method === "GET") return json({ events: [historicalEvent], templates: [template], mode: "mock", mail: { configured: false } })
  if (url.pathname.endsWith("/api/engagements") && method === "POST") {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { action?: string }
    if (payload.action === "send") { window.__emailTest.sends += 1; return json({ error: "Browser fixture prohibits sends." }, 500) }
    if (payload.action !== "prepare_manual_email") return json({ error: "Unexpected engagement action." }, 400)
    window.__emailTest.prepareRequests += 1
    if (scenario === "error" || (scenario === "error-first" && window.__emailTest.prepareRequests === 1)) return json({ error: "Fixture initialization failure." }, 500)
    if (scenario === "timeout") return new Promise<Response>(() => {})
    if (scenario === "superseded") await new Promise(resolve => setTimeout(resolve, 250))
    return json({ event: preparedEvent, templates: [template], template, draft: { recipient: sahil.email, subject: "Connecting with IIM Lucknow", body: "Hello Sahil,\n\nWe would value a conversation." }, readiness: { communicationStatus: "Professional engagement only", purpose: "Institutional outreach", duplicateStatus: "No duplicate send found", provider: "Google Workspace / Gmail", mode: "mock", sender: "Mock placement committee" } })
  }
  return originalFetch(input, init)
}

createRoot(document.getElementById("root")!).render(
  <AccessProvider session={{ displayName: "Test Operator", role: "ADMIN", provider: "google_workspace", signOutPath: "#signout", canViewContacts: true, canOperate: true, canAdminister: true }}>
    <Home />
  </AccessProvider>,
)
