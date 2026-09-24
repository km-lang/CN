const VALID_TABS = new Set(["overview", "directory", "companies", "engagement", "outreach", "data-import", "enrichment", "admin"])

export type ControlledEmailIntent = {
  alumnusId: number
  returnAlumnusId: number
  returnTab: string
}

export function parseControlledEmailIntent(search: string): ControlledEmailIntent | null {
  const params = new URLSearchParams(search)
  if (params.get("compose") !== "email") return null
  const alumnusId = Number(params.get("alumnusId"))
  const returnAlumnusId = Number(params.get("returnAlumnusId"))
  if (!Number.isInteger(alumnusId) || alumnusId < 1) return null
  return {
    alumnusId,
    returnAlumnusId: Number.isInteger(returnAlumnusId) && returnAlumnusId > 0 ? returnAlumnusId : alumnusId,
    returnTab: VALID_TABS.has(params.get("returnTab") ?? "") ? params.get("returnTab")! : "directory",
  }
}

export function controlledEmailUrl(href: string, alumnusId: number, returnTab: string) {
  const url = new URL(href)
  url.searchParams.set("tab", "engagement")
  url.searchParams.set("compose", "email")
  url.searchParams.set("alumnusId", String(alumnusId))
  url.searchParams.set("returnAlumnusId", String(alumnusId))
  url.searchParams.set("returnTab", VALID_TABS.has(returnTab) ? returnTab : "directory")
  url.searchParams.delete("profileAlumnusId")
  return `${url.pathname}${url.search}${url.hash}`
}

export function controlledEmailReturnUrl(href: string, intent: ControlledEmailIntent) {
  const url = new URL(href)
  url.searchParams.delete("compose")
  url.searchParams.delete("alumnusId")
  url.searchParams.delete("returnAlumnusId")
  url.searchParams.delete("returnTab")
  url.searchParams.set("tab", intent.returnTab)
  url.searchParams.set("profileAlumnusId", String(intent.returnAlumnusId))
  return `${url.pathname}${url.search}${url.hash}`
}

export function profileRouteState(search: string) {
  const params = new URLSearchParams(search)
  const profileAlumnusId = Number(params.get("profileAlumnusId"))
  const tab = params.get("tab")
  return {
    profileAlumnusId: Number.isInteger(profileAlumnusId) && profileAlumnusId > 0 ? profileAlumnusId : null,
    tab: VALID_TABS.has(tab ?? "") ? tab : null,
  }
}
