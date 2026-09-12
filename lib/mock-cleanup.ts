type Id = number

export type MockCleanupInput = {
  alumni: Array<{ id: Id; source: string; profileKey: string; company: string }>
  companyPriorities: Array<{ company: string }>
  activityLog: Array<{ id: Id; entityType: string; entityId: string }>
  alumniRelationships: Array<{ id: Id; intermediaryAlumnusId: Id; targetAlumnusId: Id }>
  birthdayData: Array<{ id: Id; alumnusId: Id }>
  communicationPreferences: Array<{ id: Id; alumnusId: Id }>
  engagementEvents: Array<{ id: Id; alumnusId: Id; eventType: string }>
  engagementActions: Array<{ id: Id; eventId: Id; alumnusId: Id }>
  engagementResponses: Array<{ id: Id; eventId: Id }>
  eventViews: Array<{ id: Id; eventId: Id }>
  engagementAuditLog: Array<{ id: Id; eventId: Id }>
  externalDiscoverySearches: Array<{ id: Id; mode: string; creditsUsed: number }>
  externalDiscoveryResults: Array<{ id: Id; searchId: Id; linkedInternalAlumnusId: Id | null }>
  providerResponseHistory: Array<{ id: Id; mode: string; alumnusId: Id | null; searchId: Id | null; creditsUsed: number; operation: string }>
  providerRefreshReviews: Array<{ id: Id; providerResponseId: Id; alumnusId: Id }>
  fieldChangeHistory: Array<{ id: Id; alumnusId: Id }>
  importRuns: Array<{ id: Id; filename: string }>
  alumniPrivacyControls: Array<{ id: Id; alumnusId: Id }>
  alumniDataLifecycle: Array<{ id: Id; alumnusId: Id }>
}

function explicitMockMarker(value: string) {
  return /(^|[^a-z])(mock|demo|demonstration|fixture|seed)([^a-z]|$)/i.test(value)
}

export function classifyMockDataset(input: MockCleanupInput) {
  const mockSearchIds = input.externalDiscoverySearches.filter(row => row.mode.toLowerCase() === "mock").map(row => row.id)
  const mockSearchSet = new Set(mockSearchIds)
  const liveSearchIds = input.externalDiscoverySearches.filter(row => row.mode.toLowerCase() === "live").map(row => row.id)
  const liveSearchSet = new Set(liveSearchIds)
  const mockDiscoveryResults = input.externalDiscoveryResults.filter(row => mockSearchSet.has(row.searchId))
  const mockLinkedAlumni = new Set(mockDiscoveryResults.flatMap(row => row.linkedInternalAlumnusId == null ? [] : [row.linkedInternalAlumnusId]))
  const mockAlumni = input.alumni.filter(row => explicitMockMarker(row.source) || explicitMockMarker(row.profileKey) || mockLinkedAlumni.has(row.id))
  const mockAlumniIds = mockAlumni.map(row => row.id)
  const mockAlumniSet = new Set(mockAlumniIds)
  const liveResultsLinkedToMock = input.externalDiscoveryResults.filter(row => liveSearchSet.has(row.searchId) && row.linkedInternalAlumnusId != null && mockAlumniSet.has(row.linkedInternalAlumnusId))

  const mockCompanyNames = input.companyPriorities.filter(priority => {
    const people = input.alumni.filter(person => person.company.trim().toLowerCase() === priority.company.trim().toLowerCase())
    return people.length > 0 && people.every(person => mockAlumniSet.has(person.id))
  }).map(row => row.company)
  const mockCompanySet = new Set(mockCompanyNames.map(value => value.toLowerCase()))
  const ambiguousCompanyPriorities = input.companyPriorities.filter(priority => {
    const people = input.alumni.filter(person => person.company.trim().toLowerCase() === priority.company.trim().toLowerCase())
    return people.length === 0
  }).map(row => row.company)

  const mockEventIds = input.engagementEvents.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id)
  const mockEventSet = new Set(mockEventIds)
  const mockProviderHistoryIds = input.providerResponseHistory.filter(row => row.mode.toLowerCase() === "mock").map(row => row.id)
  const mockProviderHistorySet = new Set(mockProviderHistoryIds)

  const ids = {
    alumni: mockAlumniIds,
    companyPriorities: mockCompanyNames,
    activityLog: input.activityLog.filter(row =>
      (row.entityType === "alumnus" && mockAlumniSet.has(Number(row.entityId))) ||
      (row.entityType === "company" && mockCompanySet.has(row.entityId.trim().toLowerCase())) ||
      (row.entityType === "alumni" && explicitMockMarker(row.entityId)),
    ).map(row => row.id),
    alumniRelationships: input.alumniRelationships.filter(row => mockAlumniSet.has(row.intermediaryAlumnusId) || mockAlumniSet.has(row.targetAlumnusId)).map(row => row.id),
    birthdayData: input.birthdayData.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    communicationPreferences: input.communicationPreferences.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    engagementEvents: mockEventIds,
    engagementActions: input.engagementActions.filter(row => mockEventSet.has(row.eventId) || mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    engagementResponses: input.engagementResponses.filter(row => mockEventSet.has(row.eventId)).map(row => row.id),
    eventViews: input.eventViews.filter(row => mockEventSet.has(row.eventId)).map(row => row.id),
    engagementAuditLog: input.engagementAuditLog.filter(row => mockEventSet.has(row.eventId)).map(row => row.id),
    externalDiscoverySearches: mockSearchIds,
    externalDiscoveryResults: mockDiscoveryResults.map(row => row.id),
    providerResponseHistory: mockProviderHistoryIds,
    providerRefreshReviews: input.providerRefreshReviews.filter(row => mockProviderHistorySet.has(row.providerResponseId) || mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    fieldChangeHistory: input.fieldChangeHistory.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    importRuns: input.importRuns.filter(row => explicitMockMarker(row.filename)).map(row => row.id),
    alumniPrivacyControls: input.alumniPrivacyControls.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id),
    alumniDataLifecycle: input.alumniDataLifecycle.filter(row => mockAlumniSet.has(row.alumnusId)).map(row => row.id),
  }

  const professionalSignals = input.engagementEvents.filter(row => mockEventSet.has(row.id) && row.eventType === "Professional Signal").length
  const ambiguous = [
    ...liveResultsLinkedToMock.map(row => `Live discovery result ${row.id} links to mock alumnus ${row.linkedInternalAlumnusId}.`),
    ...ambiguousCompanyPriorities.map(company => `Company priority ${company} has no explicitly classified alumni provenance.`),
  ]

  return {
    ids,
    ambiguous,
    counts: {
      alumni: ids.alumni.length,
      companies: ids.companyPriorities.length,
      engagementOutreach: ids.engagementEvents.length + ids.engagementActions.length + ids.engagementResponses.length + ids.eventViews.length + ids.engagementAuditLog.length,
      professionalSignals,
      birthdays: ids.birthdayData.length,
      communicationPreferences: ids.communicationPreferences.length,
      relationships: ids.alumniRelationships.length,
      activityLog: ids.activityLog.length,
      providerHistory: ids.providerResponseHistory.length,
      providerSearches: ids.externalDiscoverySearches.length,
      providerResults: ids.externalDiscoveryResults.length,
      providerReviews: ids.providerRefreshReviews.length,
      fieldChanges: ids.fieldChangeHistory.length,
      imports: ids.importRuns.length,
      privacyControls: ids.alumniPrivacyControls.length,
      lifecycleRecords: ids.alumniDataLifecycle.length,
    },
    retained: {
      liveDiscoveryResults: input.externalDiscoveryResults.filter(row => liveSearchSet.has(row.searchId)).length,
      liveSearchCredits: input.externalDiscoverySearches.filter(row => liveSearchSet.has(row.id)).reduce((total, row) => total + row.creditsUsed, 0),
      liveProviderHistory: input.providerResponseHistory.filter(row => row.mode.toLowerCase() === "live").length,
      liveProviderCredits: input.providerResponseHistory.filter(row => row.mode.toLowerCase() === "live").reduce((total, row) => total + row.creditsUsed, 0),
    },
  }
}
