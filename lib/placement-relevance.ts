/** CN owns this score. Standalone priority_score and priority_tier are different metrics. */
export const PLACEMENT_RELEVANCE_VERSION = "cn-placement-relevance-v1" as const
export const PLACEMENT_WEIGHTS = { hiringInfluence: 30, seniority: 20, companyPriority: 20, iimlRelationship: 15, responsiveness: 10, warmIntroduction: 5 } as const

export const HIRING_OPTIONS = [["Direct hiring decision-maker", 100], ["Strong hiring influence", 80], ["Moderate hiring influence", 60], ["Limited hiring influence", 30], ["No known hiring influence", 10], ["Unknown / Not assessed", 50]] as const
export const RELATIONSHIP_OPTIONS = [["Very strong", 100], ["Strong", 85], ["Moderate", 65], ["Limited", 40], ["Minimal / record only", 20], ["Unknown / Not assessed", 50]] as const
export const WARM_INTRO_OPTIONS = [["Is the relevant decision-maker", 100], ["Confirmed direct connection to decision-maker", 90], ["Can credibly provide introduction", 75], ["Same relevant function / business unit", 60], ["Same company only", 40], ["Weak evidence of connection", 20], ["No known route", 10], ["Unknown / Not assessed", 50]] as const
export const COMPANY_PRIORITY_OPTIONS = [["Tier 1 Strategic Target", 100], ["High Priority", 85], ["Target Recruiter", 70], ["Secondary Target", 50], ["Low Priority", 30], ["Not Currently Targeted", 10]] as const
export const SENIORITY_OPTIONS = [["CXO / Country Head / Managing Partner", 100], ["EVP / SVP / VP / Partner", 90], ["Director / GM", 80], ["Senior Manager", 65], ["Manager", 50], ["Associate / Consultant", 35], ["Analyst / Junior", 20]] as const
export const RESPONSIVENESS_OPTIONS = [["Positive and took action", 90], ["Positive response", 80], ["Contacted once, no response", 35], ["Never contacted / no history", 50]] as const

type Option = readonly (readonly [string, number])[]
export function placementOptionScore(options: Option, value: string | null | undefined) { return options.find(([label]) => label === value)?.[1] ?? 50 }
export function placementSeniorityLabel(value: string) {
  const text = value.toLowerCase()
  if (/country|managing director|chief|c-suite|cxo/.test(text)) return SENIORITY_OPTIONS[0][0]
  if (/evp|svp|vice president|\bvp\b|partner/.test(text)) return SENIORITY_OPTIONS[1][0]
  if (/director|general manager|\bgm\b/.test(text)) return SENIORITY_OPTIONS[2][0]
  if (/senior manager/.test(text)) return SENIORITY_OPTIONS[3][0]
  if (/manager/.test(text)) return SENIORITY_OPTIONS[4][0]
  if (/associate|consultant/.test(text)) return SENIORITY_OPTIONS[5][0]
  return SENIORITY_OPTIONS[6][0]
}

export type PlacementEvidence = { responseReceived: boolean; status: string }
export function placementResponsivenessLabel(status: string, events: readonly PlacementEvidence[]) {
  const responses = events.filter(event => event.responseReceived).length
  const completed = events.filter(event => ["Action Taken", "Response Received", "Follow-up Due", "Closed"].includes(event.status)).length
  if (responses >= 2) return RESPONSIVENESS_OPTIONS[0][0]
  if (responses === 1) return RESPONSIVENESS_OPTIONS[1][0]
  if (completed >= 2) return RESPONSIVENESS_OPTIONS[2][0]
  if (status === "Responded" || status === "Meeting set") return RESPONSIVENESS_OPTIONS[1][0]
  if (status === "Contacted") return RESPONSIVENESS_OPTIONS[2][0]
  return RESPONSIVENESS_OPTIONS[3][0]
}

export type PlacementInput = { intakeStatus?: string; hiringInfluence: string; seniority: string; company: string; companyPriority: string; iimlRelationship: string; warmIntroPotential: string; outreachStatus: string; events: readonly PlacementEvidence[] }
export function calculatePlacementRelevance(input: PlacementInput) {
  if (input.intakeStatus === "PROVISIONAL") return { version: PLACEMENT_RELEVANCE_VERSION, score: null, items: [] as Array<{ label: string; score: number; weight: number }> }
  const seniorityScore = input.company.toLowerCase() === "lincoln international" && input.seniority === "Director" ? 95 : placementOptionScore(SENIORITY_OPTIONS, placementSeniorityLabel(input.seniority))
  const items = [
    { label: "Hiring influence", score: placementOptionScore(HIRING_OPTIONS, input.hiringInfluence), weight: PLACEMENT_WEIGHTS.hiringInfluence },
    { label: "Seniority", score: seniorityScore, weight: PLACEMENT_WEIGHTS.seniority },
    { label: "Company priority", score: placementOptionScore(COMPANY_PRIORITY_OPTIONS, input.companyPriority), weight: PLACEMENT_WEIGHTS.companyPriority },
    { label: "IIML relationship", score: placementOptionScore(RELATIONSHIP_OPTIONS, input.iimlRelationship), weight: PLACEMENT_WEIGHTS.iimlRelationship },
    { label: "Past responsiveness", score: placementOptionScore(RESPONSIVENESS_OPTIONS, placementResponsivenessLabel(input.outreachStatus, input.events)), weight: PLACEMENT_WEIGHTS.responsiveness },
    { label: "Warm-intro potential", score: placementOptionScore(WARM_INTRO_OPTIONS, input.warmIntroPotential), weight: PLACEMENT_WEIGHTS.warmIntroduction },
  ]
  return { version: PLACEMENT_RELEVANCE_VERSION, score: Math.round(items.reduce((sum, item) => sum + item.score * item.weight / 100, 0)), items }
}
