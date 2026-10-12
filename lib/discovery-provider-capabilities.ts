export type ProviderCapability = "YES" | "NO" | "UNKNOWN"

export type DiscoveryPreviewCapabilities = {
  searchPreviewProvidesEmployeeId: ProviderCapability
  searchPreviewProvidesProfileUrl: ProviderCapability
  searchPreviewProvidesName: ProviderCapability
  searchPreviewProvidesEducation: ProviderCapability
  searchPreviewProvidesCurrentCompany: ProviderCapability
  searchPreviewProvidesCurrentTitle: ProviderCapability
  searchPreviewProvidesGraduationYear: ProviderCapability
}

// A controlled Base Search Preview response proved that these candidate fields are
// returned for the current account. Education/programme/year remain unproved and
// must not be reconstructed from request filters. The same preview returned 20
// items despite items_per_page=1; request-limit semantics need separate validation.
export const CORESIGNAL_BASE_SEARCH_PREVIEW_CAPABILITIES: DiscoveryPreviewCapabilities = Object.freeze({
  searchPreviewProvidesEmployeeId: "YES",
  searchPreviewProvidesProfileUrl: "YES",
  searchPreviewProvidesName: "YES",
  searchPreviewProvidesEducation: "UNKNOWN",
  searchPreviewProvidesCurrentCompany: "YES",
  searchPreviewProvidesCurrentTitle: "YES",
  searchPreviewProvidesGraduationYear: "UNKNOWN",
})
