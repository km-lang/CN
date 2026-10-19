export const DEFAULT_DISCOVERY_PROGRAMMES: readonly string[] = []

export const DISCOVERY_PROGRAMME_OPTIONS = Object.freeze([
  { value: "PGP", label: "PGP" },
  { value: "MBA", label: "MBA" },
  { value: "PGDM", label: "PGDM" },
  { value: "ABM", label: "ABM / PGP-ABM" },
  { value: "PGP-SM", label: "PGP-SM" },
  { value: "IPMX", label: "IPMX / Executive MBA" },
] as const)

export type AlumniStatusFilter = "Past alumni only" | "All graduation statuses"
export type AlumniStatus = "Past alumnus" | "Current student" | "Graduation status unknown — review required"
export type ProgrammeStatus = "Programme matched" | "Executive/non-regular programme" | "Programme requires review"

type ProgrammeRule = {
  code: string
  selectionCode: string
  aliases: RegExp[]
  providerTerms: string[]
  status?: ProgrammeStatus
}

const executiveMarkers = /\b(executive|working manager|working managers|working professional|working professionals|emba|e mba|one year mba|weekend mba|general management programme for executives|gmpe|advanced management programme|management development programme)\b/

export const CORESIGNAL_PROGRAMME_RULES: ProgrammeRule[] = [
  {
    code: "ABM",
    selectionCode: "ABM",
    aliases: [
      /^abm$/,
      /^pgp abm$/,
      /^post graduate programme in agribusiness management$/,
      /^post graduate program in agribusiness management$/,
      /^pgp in agribusiness management$/,
      /^mba in agribusiness management$/,
    ],
    providerTerms: ["ABM", "Agribusiness Management"],
  },
  {
    code: "SM",
    selectionCode: "PGP-SM",
    aliases: [
      /^sm$/,
      /^pgp sm$/,
      /^post graduate programme in sustainable management$/,
      /^post graduate program in sustainable management$/,
      /^pgp in sustainable management$/,
      /^mba in sustainable management$/,
    ],
    providerTerms: ["PGP-SM", "Sustainable Management"],
  },
  {
    code: "PGP",
    selectionCode: "PGP",
    aliases: [
      /^pgp$/,
      /^post graduate programme$/,
      /^post graduate program$/,
      /^post graduate programme in management$/,
      /^post graduate programme in management pgp$/,
      /^post graduate program in management$/,
      /^post graduate program in management pgp$/,
    ],
    providerTerms: ["PGP", "Post Graduate Programme", "Post Graduate Program", "Post Graduate Programme in Management", "Post Graduate Program in Management"],
  },
  {
    code: "MBA",
    selectionCode: "MBA",
    aliases: [/^mba$/, /^master of business administration$/],
    providerTerms: ["MBA", "Master of Business Administration"],
  },
  {
    code: "PGDM",
    selectionCode: "PGDM",
    aliases: [/^pgdm$/, /^post graduate diploma in management$/],
    providerTerms: ["PGDM", "Post Graduate Diploma in Management"],
  },
  {
    code: "IPMX",
    selectionCode: "IPMX",
    aliases: [
      /^ipmx$/,
      /^international programme in management for executives$/,
      /^international program in management for executives$/,
      /^executive mba$/,
      /^emba$/,
      /^e mba$/,
    ],
    providerTerms: ["IPMX", "International Programme in Management for Executives", "International Program in Management for Executives", "Executive MBA", "EMBA"],
    status: "Executive/non-regular programme",
  },
]

const standardSelectionCodes = new Set(DISCOVERY_PROGRAMME_OPTIONS.map(option => option.value))
const customProgrammePattern = /^[A-Za-z0-9][A-Za-z0-9 &/().,+\-]{1,79}$/

export function normalizeDiscoveryProgrammeSelection(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ")
  const upper = text.toUpperCase()
  if (upper === "SM") return "PGP-SM"
  if (upper === "EXECUTIVE MBA" || upper === "EMBA" || upper === "IPMX / EXECUTIVE MBA") return "IPMX"
  return standardSelectionCodes.has(upper as (typeof DISCOVERY_PROGRAMME_OPTIONS)[number]["value"]) ? upper : text
}

export function normalizeDiscoveryProgrammeSelections(values: unknown) {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  return values.map(normalizeDiscoveryProgrammeSelection).filter(value => {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function validateDiscoveryProgrammeSelections(values: unknown) {
  if (!Array.isArray(values)) return { ok: false as const, message: "Programmes must be an array." }
  if (values.some(value => typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value))) {
    return { ok: false as const, message: "Programme labels must be plain text without control characters." }
  }
  const selected = normalizeDiscoveryProgrammeSelections(values)
  if (selected.length > 12) return { ok: false as const, message: "Select no more than 12 programme or degree labels." }
  const invalid = selected.find(value => !standardSelectionCodes.has(value as (typeof DISCOVERY_PROGRAMME_OPTIONS)[number]["value"]) && !customProgrammePattern.test(value))
  return invalid
    ? { ok: false as const, message: `Programme label “${invalid}” must be 2–80 characters and use letters, numbers, spaces, or & / ( ) . , + -.` }
    : { ok: true as const, values: selected }
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function normalizeCoresignalProgramme(rawProgramme: unknown) {
  const value = normalized(rawProgramme)
  if (!value) return { code: null, status: "Programme requires review" as ProgrammeStatus }
  const rule = CORESIGNAL_PROGRAMME_RULES.find(candidate => candidate.aliases.some(alias => alias.test(value)))
  if (rule) return { code: rule.code, status: rule.status ?? "Programme matched" as ProgrammeStatus }
  if (executiveMarkers.test(value)) return { code: null, status: "Executive/non-regular programme" as ProgrammeStatus }
  return { code: null, status: "Programme requires review" as ProgrammeStatus }
}

function selectionRule(value: string) {
  const normalizedSelection = normalizeDiscoveryProgrammeSelection(value)
  return CORESIGNAL_PROGRAMME_RULES.find(rule => rule.selectionCode === normalizedSelection)
}

export function coresignalProgrammeQuery(programmes: readonly string[]) {
  const selected = normalizeDiscoveryProgrammeSelections(programmes)
  // Coresignal Boolean syntax inside education_program_name has not been
  // empirically validated. Keep the established single-programme behavior,
  // but do not turn a multi-selection (including all active programmes) into
  // an unverified OR expression that can unnecessarily reduce recall.
  if (selected.length !== 1) return ""
  const terms = selected.flatMap(value => selectionRule(value)?.providerTerms ?? [value])
  const unique = [...new Set(terms)]
  if (!unique.length) return ""
  return unique.map(term => term.includes(" ") ? `(${term})` : term).join(" OR ")
}

export function coresignalProgrammeTerms(programmes: readonly string[]) {
  const validation = validateDiscoveryProgrammeSelections(programmes)
  if (!validation.ok) throw new Error(validation.message)
  return [...new Set(validation.values.flatMap(value => selectionRule(value)?.providerTerms ?? [value]))]
}

type EndEvidence = { year: number; month: number | null; day: number | null }

const monthNumbers: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function endEvidence(value: unknown): EndEvidence | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  match = text.match(/^(\d{4})-(\d{1,2})$/)
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: null }
  match = text.match(/^(\d{4})$/)
  if (match) return { year: Number(match[1]), month: null, day: null }
  match = text.toLowerCase().match(/^([a-z]+)\s+(\d{4})$/)
  if (match && monthNumbers[match[1]]) return { year: Number(match[2]), month: monthNumbers[match[1]], day: null }
  return null
}

export function alumniStatusFromEducationEnd(endDate: unknown, now: Date = new Date()): AlumniStatus {
  const evidence = endEvidence(endDate)
  if (!evidence || !Number.isFinite(now.getTime())) return "Graduation status unknown — review required"
  const current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
  if (evidence.year < current.year) return "Past alumnus"
  if (evidence.year > current.year) return "Current student"
  if (evidence.month === null) return "Graduation status unknown — review required"
  if (evidence.month < current.month) return "Past alumnus"
  if (evidence.month > current.month) return "Current student"
  if (evidence.day === null) return "Graduation status unknown — review required"
  return evidence.day <= current.day ? "Past alumnus" : "Current student"
}

export function providerEducationDateTo(now: Date = new Date()) {
  const month = Object.keys(monthNumbers).find(name => monthNumbers[name] === now.getUTCMonth() + 1) ?? "january"
  return `${month[0].toUpperCase()}${month.slice(1)} ${now.getUTCFullYear()}`
}

export function discoveryQualification(
  rawProgramme: unknown,
  educationEndDate: unknown,
  selectedProgrammes: readonly string[],
  now: Date = new Date(),
) {
  const programme = normalizeCoresignalProgramme(rawProgramme)
  const alumniStatus = alumniStatusFromEducationEnd(educationEndDate, now)
  const selected = normalizeDiscoveryProgrammeSelections(selectedProgrammes)
  // Programme is an optional discovery dimension. An empty selection means
  // "any programme", not "no candidate can qualify". Unknown programmes
  // still remain review-only through programmeStatus/affiliation handling.
  const selectedCanonicalCodes = new Set(selected.map(value => selectionRule(value)?.code).filter(Boolean))
  const programmeMatchesSelection = selected.length === 0 || Boolean(programme.code && selectedCanonicalCodes.has(programme.code))
  return {
    normalizedProgramme: programme.code ?? "",
    programmeStatus: programme.status,
    alumniStatus,
    programmeMatchesSelection,
    eligibleForAddition: programmeMatchesSelection && programme.status === "Programme matched" && alumniStatus === "Past alumnus",
  }
}
