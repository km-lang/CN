import rules from "@/config/seniority-rules.json"

export type SeniorityClassification = {
  state: "CLASSIFIED" | "UNCLASSIFIED" | "REVIEW_REQUIRED"
  level: string
  originalTitle: string
  classifierVersion: string
  source: "company_override" | "title_rule" | "none"
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export const SENIORITY_CLASSIFIER_VERSION = rules.version
export const SENIORITY_LEVELS = rules.levels

export function classifyCurrentTitle(title: unknown, company: unknown): SeniorityClassification {
  const originalTitle = String(title ?? "").trim()
  const normalizedTitle = normalized(originalTitle)
  if (!normalizedTitle) return { state: "UNCLASSIFIED", level: "Unclassified", originalTitle, classifierVersion: rules.version, source: "none" }
  const companyRules = rules.companyOverrides[normalized(company) as keyof typeof rules.companyOverrides] ?? []
  const companyMatches = companyRules.filter(rule => new RegExp(rule.pattern, "i").test(normalizedTitle))
  if (companyMatches.length === 1) return { state: "CLASSIFIED", level: companyMatches[0].level, originalTitle, classifierVersion: rules.version, source: "company_override" }
  if (companyMatches.length > 1) return { state: "REVIEW_REQUIRED", level: "Review required", originalTitle, classifierVersion: rules.version, source: "company_override" }
  const genericMatches = rules.titleRules.filter(rule => new RegExp(rule.pattern, "i").test(normalizedTitle))
  if (!genericMatches.length) return { state: "UNCLASSIFIED", level: "Unclassified", originalTitle, classifierVersion: rules.version, source: "none" }
  return { state: "CLASSIFIED", level: genericMatches[0].level, originalTitle, classifierVersion: rules.version, source: "title_rule" }
}

export function seniorityRank(level: unknown) {
  return SENIORITY_LEVELS.indexOf(String(level))
}
