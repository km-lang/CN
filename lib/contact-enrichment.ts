export type ContactChannel = "email" | "phone"
export type ContactEligibilityState = "missing" | "unverified" | "verified" | "unavailable"

export type ContactCandidate = {
  id: number
  name: string
  email?: string | null
  phone?: string | null
  emailVerification?: string | null
  phoneVerification?: string | null
  verification?: { email?: string; phone?: string }
  lushaPersonId?: string | null
  intakeStatus?: string | null
  privacy?: { generalContactStatus?: string | null } | null
}

export type ContactPermission = {
  allowed: boolean
  reason: string
}

export function contactEnrichmentPermission(person: ContactCandidate, legacyStatuses: readonly string[] = []): ContactPermission {
  if (person.intakeStatus === "PROVISIONAL") return { allowed: false, reason: "Provisional intake does not establish alumni identity or outreach eligibility" }
  if (person.privacy?.generalContactStatus === "Do not contact" || legacyStatuses.includes("Do not contact")) {
    return { allowed: false, reason: "Contact enrichment is blocked by the alumnus's do-not-contact preference" }
  }
  return { allowed: true, reason: "" }
}

function verificationFor(person: ContactCandidate, channel: ContactChannel) {
  return channel === "email"
    ? person.emailVerification ?? person.verification?.email ?? ""
    : person.phoneVerification ?? person.verification?.phone ?? ""
}

export function contactChannelState(person: ContactCandidate, channel: ContactChannel): ContactEligibilityState {
  const value = String(person[channel] ?? "").trim()
  if (!value) return "missing"
  return verificationFor(person, channel) === "Verified" ? "verified" : "unverified"
}

export function eligibleContactChannels(person: ContactCandidate, requested: readonly ContactChannel[]) {
  return [...new Set(requested)].filter(channel => contactChannelState(person, channel) !== "verified")
}

export function contactEnrichmentPlan(people: readonly ContactCandidate[], requested: readonly ContactChannel[], requireStableIdentity = false) {
  const rows = people.map(person => {
    const states = Object.fromEntries((["email", "phone"] as const).map(channel => [channel, contactChannelState(person, channel)])) as Record<ContactChannel, ContactEligibilityState>
    const eligible = eligibleContactChannels(person, requested)
    const permission = contactEnrichmentPermission(person)
    const blockedReason = !permission.allowed
      ? permission.reason
      : requireStableIdentity && !String(person.lushaPersonId ?? "").trim() ? "Stable Lusha identity required" : ""
    return {
      id: person.id,
      name: person.name,
      states,
      eligible: blockedReason ? [] : eligible,
      skippedVerified: requested.filter(channel => states[channel] === "verified"),
      blockedReason,
    }
  })
  return {
    rows,
    emailOperations: rows.filter(row => row.eligible.includes("email")).length,
    phoneOperations: rows.filter(row => row.eligible.includes("phone")).length,
    skippedVerified: rows.reduce((total, row) => total + row.skippedVerified.length, 0),
    blocked: rows.filter(row => Boolean(row.blockedReason)).length,
  }
}
