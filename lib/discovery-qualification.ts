export const DEFAULT_DISCOVERY_PROGRAMMES = ["PGP", "ABM", "SM"] as const

export type AlumniStatusFilter = "Past alumni only" | "All graduation statuses"
export type AlumniStatus = "Past alumnus" | "Current student" | "Graduation status unknown — review required"
export type ProgrammeStatus = "Programme matched" | "Executive/non-regular programme" | "Programme requires review"

type ProgrammeRule = {
  code: string
  aliases: RegExp[]
  providerTerms: string[]
}

const executiveMarkers = /\b(executive|working manager|working managers|working professional|working professionals|emba|e mba|one year mba|weekend mba|general management programme for executives|gmpe|advanced management programme|management development programme)\b/

export const CORESIGNAL_PROGRAMME_RULES: ProgrammeRule[] = [
  {
    code: "ABM",
    aliases: [
      /^abm$/,
      /^pgp abm$/,
      /^post graduate programme in agribusiness management$/,
      /^post graduate program in agribusiness management$/,
      /^mba in agribusiness management$/,
    ],
    providerTerms: ["ABM", "Agribusiness Management"],
  },
  {
    code: "SM",
    aliases: [
      /^sm$/,
      /^pgp sm$/,
      /^post graduate programme in sustainable management$/,
      /^post graduate program in sustainable management$/,
      /^mba in sustainable management$/,
    ],
    providerTerms: ["PGP-SM", "Sustainable Management"],
  },
  {
    code: "PGP",
    aliases: [
      /^pgp$/,
      /^post graduate programme$/,
      /^post graduate program$/,
      /^post graduate programme in management$/,
      /^post graduate programme in management pgp$/,
      /^post graduate program in management$/,
      /^post graduate program in management pgp$/,
      /^pgdm$/,
      /^post graduate diploma$/,
      /^post graduate diploma in management$/,
      /^post graduate diploma in management pgdm$/,
      /^mba$/,
      /^master of business administration$/,
      /^master of business administration mba$/,
    ],
    providerTerms: ["PGP", "Post Graduate Programme", "PGDM", "MBA"],
  },
]

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function normalizeCoresignalProgramme(rawProgramme: unknown) {
  const value = normalized(rawProgramme)
  if (!value) return { code: null, status: "Programme requires review" as ProgrammeStatus }
  if (executiveMarkers.test(value)) return { code: null, status: "Executive/non-regular programme" as ProgrammeStatus }
  const rule = CORESIGNAL_PROGRAMME_RULES.find(candidate => candidate.aliases.some(alias => alias.test(value)))
  return rule
    ? { code: rule.code, status: "Programme matched" as ProgrammeStatus }
    : { code: null, status: "Programme requires review" as ProgrammeStatus }
}

export function coresignalProgrammeQuery(programmes: readonly string[]) {
  const selected = new Set(programmes.map(value => value.trim().toUpperCase()).filter(Boolean))
  const terms = CORESIGNAL_PROGRAMME_RULES
    .filter(rule => selected.has(rule.code))
    .flatMap(rule => rule.providerTerms)
  const unique = [...new Set(terms)]
  if (!unique.length) return ""
  return unique.map(term => term.includes(" ") ? `(${term})` : term).join(" OR ")
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
  const selected = new Set(selectedProgrammes.map(value => value.trim().toUpperCase()).filter(Boolean))
  const programmeMatchesSelection = Boolean(programme.code && selected.has(programme.code))
  return {
    normalizedProgramme: programme.code ?? "",
    programmeStatus: programme.status,
    alumniStatus,
    programmeMatchesSelection,
    eligibleForAddition: programmeMatchesSelection && alumniStatus === "Past alumnus",
  }
}
