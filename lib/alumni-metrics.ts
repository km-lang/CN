export type ContactVerification = {
  profileMatch: string
  currentCompany: string
  designation: string
  email: string
  phone: string
}

export function contactReadiness(verification: ContactVerification) {
  if (verification.profileMatch === "Mismatch") return "Mismatch"
  const reliableProfile = verification.profileMatch === "Confirmed"
    && verification.currentCompany === "Verified"
    && ["Verified", "Likely"].includes(verification.designation)
  const verifiedChannel = verification.email === "Verified" || verification.phone === "Verified"
  if (reliableProfile && verifiedChannel) return "Contact-ready"
  if (verification.profileMatch === "Confirmed" && (reliableProfile || verifiedChannel)) return "Partially verified"
  return "Needs verification"
}

export function isActiveOutreach(status: string) {
  return ["Contacted", "Responded", "Meeting set"].includes(status)
}
