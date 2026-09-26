import { providerConfigured, providerMode, type ProviderName } from "@/lib/provider-runtime"

export type { ProviderName } from "@/lib/provider-runtime"

export type EnrichmentInput = {
  id: number
  name: string
  company: string
  title: string
  location: string
  email: string
  phone: string
  linkedinUrl: string
  contactChannels?: ("email" | "phone")[]
}

export type EnrichmentResult = {
  provider: "lusha"
  status: "success" | "no_match" | "error"
  creditsUsed: number
  changes: Record<string, string | number>
  responseSummary: string
  errorMessage?: string
}

export function enrichmentMode(provider: ProviderName = "lusha") { return providerMode(provider) }
export { providerConfigured }

function mockLusha(input: EnrichmentInput): EnrichmentResult {
  const channels = input.contactChannels?.length ? input.contactChannels : ["email", "phone"]
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")
  const email = input.email && !input.email.endsWith("@example.com") ? input.email : `${slug}@demo-contact.invalid`
  const phone = input.phone && !input.phone.includes("•") ? input.phone : `+91 90000 ${String(10000 + input.id).slice(-5)}`
  const emailRequested = channels.includes("email")
  const emailAvailable = input.id % 7 !== 0
  const phoneRequested = channels.includes("phone")
  const phoneAvailable = input.id % 5 !== 0
  const now = new Date().toISOString()
  return {
    provider: "lusha",
    status: (emailRequested && emailAvailable) || (phoneRequested && phoneAvailable) ? "success" : "no_match",
    creditsUsed: (emailRequested && emailAvailable ? 1 : 0) + (phoneRequested && phoneAvailable ? 5 : 0),
    changes: {
      ...(emailRequested && emailAvailable ? { email, emailVerification: "Verified", emailSource: "Lusha", emailRetrievedAt: now } : {}),
      ...(phoneRequested && phoneAvailable ? { phone, phoneVerification: "Verified", phoneSource: "Lusha", phoneRetrievedAt: now } : {}),
      lastLushaEnrichment: now,
    },
    responseSummary: `Demonstration ${channels.join(" and ")} returned.`,
  }
}

export async function enrich(provider: ProviderName, input: EnrichmentInput) {
  if (provider !== "lusha") throw new Error("Professional data operations must use the ProfessionalDataProvider adapter.")
  if (enrichmentMode("lusha") === "mock") return mockLusha(input)
  throw new Error("Use the controlled Lusha V3 contact-search preview and confirmed reveal workflow.")
}
