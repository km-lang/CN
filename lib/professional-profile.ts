const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"])

export function normalizeProfessionalProfileUrl(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""

  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  if (hasExplicitScheme && !/^https?:\/\//i.test(raw)) return ""

  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : `https://${raw.replace(/^\/\//, "")}`

  try {
    const url = new URL(candidate)
    const hostname = url.hostname.toLowerCase()
    if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) || !hostname || !hostname.includes(".")) return ""
    if (hostname === "localhost" || hostname.endsWith(".localhost") || url.username || url.password) return ""
    return url.href
  } catch {
    return ""
  }
}

function recordedText(value: unknown) {
  const text = String(value ?? "").trim()
  return /^(?:not recorded|unknown|unavailable|n\/a|-)$/i.test(text) ? "" : text
}

export function professionalExperienceSummary(experience: unknown, previous: unknown) {
  const numericExperience = typeof experience === "number" ? experience : Number(experience)
  const hasKnownDuration = Number.isFinite(numericExperience) && numericExperience > 0
  const previousCompanies = recordedText(previous)
  const duration = hasKnownDuration
    ? `${numericExperience} ${numericExperience === 1 ? "year" : "years"}`
    : ""

  if (duration && previousCompanies) return `${duration} · Previously ${previousCompanies}`
  if (duration) return `${duration} · Previous employment not recorded`
  if (previousCompanies) return `Experience duration not available · Previously ${previousCompanies}`
  return "Experience history not available"
}
