export type AlumniHistoryKind = "SOURCE_BASELINE" | "SOURCE_OBSERVATION" | "DISCOVERY_OBSERVATION" | "PROVISIONAL_INTAKE" | "PROVIDER_ATTEMPT" | "PROVIDER_REVIEW" | "PROVIDER_SNAPSHOT" | "CAREER_OBSERVATION" | "CANONICAL_CHANGE" | "REVIEW_DECISION" | "WEBHOOK_NOTIFICATION"

export type RetainedIntelligenceSnapshot = {
  id: string; provider: string; fetchedAt: string; extractionStatus: string; runId: string | null
  company: string | null; title: string | null; location: string | null
  experience: Array<{ company: string | null; title: string | null; startDate: string | null; endDate: string | null; current: boolean | null }>
  education: Array<{ institution: string | null; degree: string | null; startYear: string | null; endYear: string | null }>
}

export type RetainedIntelligenceSnapshotPage = { sourceId: string; page: number; pageSize: 20; hasMore: boolean; snapshots: RetainedIntelligenceSnapshot[] }

export type AlumniHistoryEntry = {
  key: string
  kind: AlumniHistoryKind
  occurredAt: string
  source: string
  outcome: string
  requestReference: string
  verification: string
  details: string
  observed: Record<string, string>
  experience?: RetainedIntelligenceSnapshot["experience"]
  education?: RetainedIntelligenceSnapshot["education"]
}

const professionalFields = ["company", "title", "location", "programme", "graduationYear", "seniority", "function", "previousCompanies"] as const
export type ProfessionalField = typeof professionalFields[number]

export function retainedProfessionalFields(values: Record<string, unknown>): Record<string, string> {
  const observed: Record<string, string> = {}
  for (const field of professionalFields) {
    const value = values[field]
    if (value == null || String(value).trim() === "" || (field === "graduationYear" && Number(value) === 0) || /^(unknown(?:\b|\/)|.*not returned\b|not recorded\b|unverified\b)/i.test(String(value).trim())) continue
    observed[field] = String(value).trim()
  }
  return observed
}

export function compareRetainedObservations(current: AlumniHistoryEntry, previous: AlumniHistoryEntry | null, canonical: Record<string, string>) {
  return Object.entries(current.observed).map(([field, value]) => {
    const prior = previous?.observed[field] ?? null
    return { field, previousObserved: prior, newObserved: value, currentCanonical: canonical[field] || null,
      changedFromPrevious: prior !== null && prior !== value,
      previousEvidenceAvailable: prior !== null, snapshotKey: current.key, previousSnapshotKey: previous?.key ?? null,
      source: current.source, verification: current.verification }
  })
}

export function intelligenceSnapshotEntry(snapshot: RetainedIntelligenceSnapshot, sourceId: string): AlumniHistoryEntry {
  const currentExperience = snapshot.experience.find(item => item.current === true)
  return {
    key: `PROVIDER_SNAPSHOT:${snapshot.id}`, kind: "PROVIDER_SNAPSHOT", occurredAt: snapshot.fetchedAt,
    source: snapshot.provider, outcome: snapshot.extractionStatus, requestReference: snapshot.runId ? `Intelligence run ${snapshot.runId}` : `Snapshot ${snapshot.id}`,
    verification: "Retained provider observation; not a Corporate Network canonical update",
    details: `Exact ${sourceId} mapping · ${snapshot.experience.length} employment and ${snapshot.education.length} education observations retained`,
    observed: { ...retainedProfessionalFields({ company: snapshot.company, title: snapshot.title, location: snapshot.location }),
      ...(currentExperience?.startDate ? { employmentStartDate: currentExperience.startDate } : {}),
      ...(currentExperience?.endDate ? { employmentEndDate: currentExperience.endDate } : {}) },
    experience: snapshot.experience, education: snapshot.education,
  }
}
