export const INTELLIGENCE_VIEWS = ["refresh", "reviews", "discovery", "webhooks"] as const
export type IntelligenceView = typeof INTELLIGENCE_VIEWS[number]

export function intelligenceView(search: string): IntelligenceView {
  const value = new URLSearchParams(search).get("view")
  return INTELLIGENCE_VIEWS.includes(value as IntelligenceView) ? value as IntelligenceView : "refresh"
}

export function intelligenceViewUrl(href: string, view: IntelligenceView) {
  const url = new URL(href)
  for (const key of ["compose", "alumnusId", "returnAlumnusId", "returnTab", "profileAlumnusId", "engagementEventId"]) url.searchParams.delete(key)
  url.searchParams.set("tab", "intelligence")
  url.searchParams.set("view", view)
  return `${url.pathname}${url.search}${url.hash}`
}
