import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

export const SYNTHETIC_SEED = 20261016
const programmes = ["PGP", "ABM", "SM"]
const functions = ["Strategy", "Finance", "Operations", "Human Resources", "Sales", "Technology", "Marketing"]
const seniorities = ["Manager", "Senior Manager", "Director", "Vice President", "C-suite"]
const industries = ["Technology", "Financial Services", "Manufacturing", "Consumer", "Healthcare", "Consulting"]
const locations = ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Chennai", "Pune", "Kolkata"]

function prng(seed) { let value = seed >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x100000000 } }
function pick(values, random) { return values[Math.floor(random() * values.length)] }
function csvCell(value) { const text = String(value ?? ""); const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text; return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe }

export function generateSyntheticAlumni(count, seed = SYNTHETIC_SEED) {
  const random = prng(seed)
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1; const token = String(ordinal).padStart(5, "0"); const programme = programmes[index % programmes.length]; const companyNumber = (index % Math.max(20, Math.ceil(count / 40))) + 1; const company = `Example Enterprise ${String(companyNumber).padStart(3, "0")}`; const title = `${pick(seniorities, random)} of ${pick(functions, random)}`
    return {
      source_alumni_id: `SYN-${token}`, source_system: "cn-synthetic-validation", name: `Synthetic Alumnus ${token}`, programme,
      graduation_year: String(1985 + (index % 40)), company, title, function: pick(functions, random), seniority: pick(seniorities, random),
      industry: pick(industries, random), location: pick(locations, random), previous_companies: index % 4 === 0 ? `Prior Example ${String((index % 75) + 1).padStart(3, "0")}` : "",
      experience_years: String(1 + (index % 35)), linkedin_url: index % 5 === 0 ? "" : `https://www.linkedin.com/in/synthetic-alumnus-${token}`,
      email: index % 7 === 0 ? "" : `synthetic.${token}@example.test`, phone: "",
      general_contact_status: index % 23 === 0 ? "Do not contact" : "Unknown", professional_engagement_status: "Unknown", birthday_engagement_status: "Unknown",
      consent_source: index % 23 === 0 ? "Internal institutional record" : "Unknown", source_date: "2026-10-01", last_reviewed_date: "", note: "Fictional scale-validation record",
    }
  })
}

export function generateMalformedAlumni(seed = SYNTHETIC_SEED) {
  const rows = generateSyntheticAlumni(8, seed)
  rows[0].source_alumni_id = ""
  rows[1].graduation_year = "1800"
  rows[2].email = "not-an-email"
  rows[3].linkedin_url = "https://example.test/not-linkedin"
  rows[4].programme = "Unsupported Programme"
  rows[5].general_contact_status = "Assumed consent"
  rows[6].source_alumni_id = rows[7].source_alumni_id
  rows[6].name = '=HYPERLINK("https://example.test","unsafe")'
  return rows
}

export function recordsToCsv(records) {
  const headers = ["source_alumni_id", "source_system", "name", "programme", "graduation_year", "company", "title", "function", "seniority", "industry", "location", "previous_companies", "experience_years", "linkedin_url", "email", "phone", "general_contact_status", "professional_engagement_status", "birthday_engagement_status", "consent_source", "source_date", "last_reviewed_date", "note"]
  return [headers, ...records.map(record => headers.map(header => record[header] ?? ""))].map(row => row.map(csvCell).join(",")).join("\r\n")
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]?.startsWith("--") ? "true" : all[index + 1]] : null).filter(Boolean))
  const count = Number(args.count ?? 1000); const seed = Number(args.seed ?? SYNTHETIC_SEED); const output = args.output
  if (!output) throw new Error("Use --output with an isolated, non-repository path.")
  if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error("--count must be an integer from 1 to 10000.")
  const records = args.malformed === "true" ? generateMalformedAlumni(seed) : generateSyntheticAlumni(count, seed)
  await writeFile(output, recordsToCsv(records), { encoding: "utf8", flag: "wx" })
  console.log(JSON.stringify({ output, rows: records.length, seed, malformed: args.malformed === "true" }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
