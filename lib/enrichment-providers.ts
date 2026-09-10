export type ProviderName = "pdl" | "lusha";

export type EnrichmentInput = {
  id: number;
  name: string;
  company: string;
  title: string;
  location: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  contactChannels?: ("email" | "phone")[];
};

export type EnrichmentResult = {
  provider: ProviderName;
  status: "success" | "no_match" | "error";
  creditsUsed: number;
  changes: Record<string, string | number>;
  responseSummary: string;
  errorMessage?: string;
};

type RuntimeEnv = {
  PDL_API_KEY?: string;
  LUSHA_API_KEY?: string;
  ENRICHMENT_MODE?: string;
};

function runtimeEnv() {
  return process.env as RuntimeEnv;
}

export function enrichmentMode(): "mock" | "live" {
  const configured = runtimeEnv().ENRICHMENT_MODE?.toLowerCase();
  return configured === "live" ? "live" : "mock";
}

export function providerConfigured(provider: ProviderName) {
  const values = runtimeEnv();
  return provider === "pdl" ? Boolean(values.PDL_API_KEY) : Boolean(values.LUSHA_API_KEY);
}

function mockPdl(input: EnrichmentInput): EnrichmentResult {
  if (input.id % 5 === 0) {
    return { provider: "pdl", status: "no_match", creditsUsed: 0, changes: {}, responseSummary: "No matching external professional profile found." };
  }
  const titles = [input.title, "Senior " + input.title.replace(/^Senior\s+/i, ""), input.title];
  const title = titles[input.id % titles.length];
  return {
    provider: "pdl",
    status: "success",
    creditsUsed: 1,
    changes: {
      company: input.company,
      title,
      location: input.location,
      profileMatch: "Confirmed",
      currentCompanyVerification: "Verified",
      designationVerification: "Verified",
      locationVerification: "Verified",
      lastPdlRefresh: new Date().toISOString(),
      verified: "just now",
      source: "PDL demonstration enrichment",
    },
    responseSummary: `Profile matched at ${input.company}; current employment fields refreshed.`,
  };
}

function mockLusha(input: EnrichmentInput): EnrichmentResult {
  const channels = input.contactChannels?.length ? input.contactChannels : ["email", "phone"];
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  const email = input.email && !input.email.endsWith("@example.com") ? input.email : `${slug}@demo-contact.invalid`;
  const phone = input.phone && !input.phone.includes("•") ? input.phone : `+91 90000 ${String(10000 + input.id).slice(-5)}`;
  const emailRequested = channels.includes("email");
  const emailAvailable = input.id % 7 !== 0;
  const phoneRequested = channels.includes("phone");
  const phoneAvailable = input.id % 5 !== 0;
  const now = new Date().toISOString();
  return {
    provider: "lusha",
    status: (emailRequested && emailAvailable) || (phoneRequested && phoneAvailable) ? "success" : "no_match",
    creditsUsed: (emailRequested && emailAvailable ? 1 : 0) + (phoneRequested && phoneAvailable ? 5 : 0),
    changes: {
      ...(emailRequested && emailAvailable ? { email, emailVerification: "Verified", emailSource: "Lusha", emailRetrievedAt: now } : {}),
      ...(phoneRequested && phoneAvailable ? { phone, phoneVerification: "Verified", phoneSource: "Lusha", phoneRetrievedAt: now } : {}),
      lastLushaEnrichment: now,
      verified: "just now",
      source: "Lusha demonstration enrichment",
    },
    responseSummary: (emailRequested && !emailAvailable) || (phoneRequested && !phoneAvailable)
      ? `${emailRequested && emailAvailable ? "Demonstration work email returned. " : ""}${phoneRequested && phoneAvailable ? "Demonstration phone returned. " : ""}${emailRequested && !emailAvailable ? "No email was available. " : ""}${phoneRequested && !phoneAvailable ? "No phone was available." : ""}`.trim()
      : `Demonstration ${channels.join(" and ")} returned.`,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const result = stringValue(record.address ?? record.email ?? record.number ?? record.phone);
        if (result) return result;
      }
    }
  }
  return "";
}

async function livePdl(input: EnrichmentInput): Promise<EnrichmentResult> {
  const key = runtimeEnv().PDL_API_KEY;
  if (!key) throw new Error("PDL_API_KEY is not configured.");
  const query = new URLSearchParams({ name: input.name, company: input.company, min_likelihood: "6" });
  if (input.linkedinUrl) query.set("profile", input.linkedinUrl);
  const response = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${query}`, {
    headers: { "X-Api-Key": key, accept: "application/json" },
  });
  const body = await response.json() as Record<string, unknown>;
  const creditsUsed = Number(response.headers.get("x-call-credits-spent") ?? (response.ok ? 1 : 0));
  if (response.status === 404) return { provider: "pdl", status: "no_match", creditsUsed, changes: {}, responseSummary: "No sufficiently likely profile match." };
  if (!response.ok) throw new Error(stringValue((body.error as Record<string, unknown> | undefined)?.message) || `PDL returned HTTP ${response.status}.`);
  const data = (body.data ?? body) as Record<string, unknown>;
  const job = (data.job ?? {}) as Record<string, unknown>;
  const changes: Record<string, string | number> = {
    profileMatch: "Confirmed",
    currentCompanyVerification: "Verified",
    designationVerification: "Verified",
    locationVerification: "Verified",
    lastPdlRefresh: new Date().toISOString(),
    verified: "just now",
    source: "People Data Labs",
  };
  const company = stringValue(job.company_name ?? job.company);
  const title = stringValue(job.title);
  const location = stringValue(data.location_name ?? data.location);
  const linkedinUrl = stringValue(data.linkedin_url);
  const pdlPersonId = stringValue(data.id ?? body.id);
  if (company) changes.company = company;
  if (title) changes.title = title;
  if (location) changes.location = location;
  if (linkedinUrl) changes.linkedinUrl = linkedinUrl;
  if (pdlPersonId) changes.pdlPersonId = pdlPersonId;
  return { provider: "pdl", status: "success", creditsUsed, changes, responseSummary: `Profile matched with likelihood ${String(body.likelihood ?? "available")}; employment fields refreshed.` };
}

async function liveLusha(input: EnrichmentInput): Promise<EnrichmentResult> {
  const key = runtimeEnv().LUSHA_API_KEY;
  if (!key) throw new Error("LUSHA_API_KEY is not configured.");
  const [firstName, ...surname] = input.name.split(/\s+/);
  const channels = input.contactChannels?.length ? input.contactChannels : ["email", "phone"];
  const revealEmails = channels.includes("email");
  const revealPhones = channels.includes("phone");
  const response = await fetch("https://api.lusha.com/v3/contacts/search-and-enrich", {
    method: "POST",
    headers: { "api_key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      contacts: [{
        firstName,
        lastName: surname.join(" "),
        companyName: input.company,
        linkedinUrl: input.linkedinUrl || undefined,
      }],
      revealEmails,
      revealPhones,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.status === 404) return { provider: "lusha", status: "no_match", creditsUsed: 0, changes: {}, responseSummary: "No contact match." };
  if (!response.ok) throw new Error(stringValue((body.error as Record<string, unknown> | undefined)?.message ?? body.message) || `Lusha returned HTTP ${response.status}.`);
  const first = (Array.isArray(body.data) ? body.data[0] : body.data ?? body) as Record<string, unknown>;
  const email = firstString(first.email ?? first.emails);
  const phone = firstString(first.phone ?? first.phones ?? first.phoneNumbers);
  const now = new Date().toISOString();
  const changes: Record<string, string | number> = { verified: "just now", source: "Lusha", lastLushaEnrichment: now };
  if (email && revealEmails) { changes.email = email; changes.emailVerification = "Verified"; changes.emailSource = "Lusha"; changes.emailRetrievedAt = now; }
  if (phone && revealPhones) { changes.phone = phone; changes.phoneVerification = "Verified"; changes.phoneSource = "Lusha"; changes.phoneRetrievedAt = now; }
  const creditsUsed = (email ? 1 : 0) + (phone ? 5 : 0);
  return { provider: "lusha", status: email || phone ? "success" : "no_match", creditsUsed, changes, responseSummary: email || phone ? `${email ? "Email" : ""}${email && phone ? " and " : ""}${phone ? "phone" : ""} returned.` : "Contact matched without requested details." };
}

export async function enrich(provider: ProviderName, input: EnrichmentInput) {
  if (enrichmentMode() === "mock") return provider === "pdl" ? mockPdl(input) : mockLusha(input);
  try {
    return await (provider === "pdl" ? livePdl(input) : liveLusha(input));
  } catch (error) {
    return {
      provider,
      status: "error" as const,
      creditsUsed: 0,
      changes: {},
      responseSummary: "Provider request failed.",
      errorMessage: error instanceof Error ? error.message : "Unknown provider error.",
    };
  }
}
