const VALID_TABS = new Set(["overview", "directory", "companies", "engagement", "outreach", "data-import", "enrichment", "intelligence", "admin"])
const EMAIL_STATE_KEYS = ["compose", "alumnusId", "returnAlumnusId", "returnTab"]

export type WorkspaceAccess = { canOperate: boolean; canAdminister: boolean }

function permittedTab(tab: string, access: WorkspaceAccess) {
  if (!VALID_TABS.has(tab)) return "overview"
  if (["engagement", "outreach", "data-import"].includes(tab) && !access.canOperate) return "overview"
  if (tab === "admin" && !access.canAdminister) return "overview"
  return tab
}

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

export function workspaceTabUrl(href: string, tab: string) {
  const url = new URL(href)
  for (const key of EMAIL_STATE_KEYS) url.searchParams.delete(key)
  url.searchParams.delete("profileAlumnusId")
  url.searchParams.delete("engagementEventId")
  url.searchParams.set("tab", VALID_TABS.has(tab) ? tab : "overview")
  if (tab !== "intelligence") url.searchParams.delete("view")
  return `${url.pathname}${url.search}${url.hash}`
}

export function engagementEventUrl(href: string, eventId: number) {
  const url = new URL(workspaceTabUrl(href, "engagement"), href)
  if (Number.isInteger(eventId) && eventId > 0) url.searchParams.set("engagementEventId", String(eventId))
  return `${url.pathname}${url.search}${url.hash}`
}

export function alumnusProfileUrl(href: string, alumnusId: number, tab = "directory") {
  const url = new URL(href)
  for (const key of EMAIL_STATE_KEYS) url.searchParams.delete(key)
  url.searchParams.set("tab", VALID_TABS.has(tab) ? tab : "directory")
  url.searchParams.set("profileAlumnusId", String(alumnusId))
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

export function parseEngagementEventId(search: string) {
  const eventId = Number(new URLSearchParams(search).get("engagementEventId"))
  return Number.isInteger(eventId) && eventId > 0 ? eventId : null
}

export function canonicalWorkspaceUrl(
  href: string,
  access: WorkspaceAccess = { canOperate: true, canAdminister: true },
) {
  const url = new URL(href)
  const intent = parseControlledEmailIntent(url.search)
  const requestedTab = url.searchParams.get("tab") ?? "overview"
  let tab = permittedTab(requestedTab, access)

  if (intent && access.canOperate) {
    tab = "engagement"
    url.searchParams.set("compose", "email")
    url.searchParams.set("alumnusId", String(intent.alumnusId))
    url.searchParams.set("returnAlumnusId", String(intent.returnAlumnusId))
    url.searchParams.set("returnTab", permittedTab(intent.returnTab, access))
    url.searchParams.delete("profileAlumnusId")
  } else {
    for (const key of EMAIL_STATE_KEYS) url.searchParams.delete(key)
    const profileAlumnusId = Number(url.searchParams.get("profileAlumnusId"))
    if (tab !== "directory" || !Number.isInteger(profileAlumnusId) || profileAlumnusId < 1) {
      url.searchParams.delete("profileAlumnusId")
    }
    const engagementEventId = Number(url.searchParams.get("engagementEventId"))
    if (tab !== "engagement" || !access.canOperate || !Number.isInteger(engagementEventId) || engagementEventId < 1) {
      url.searchParams.delete("engagementEventId")
    }
  }

  url.searchParams.set("tab", tab)
  if (tab !== "intelligence") url.searchParams.delete("view")
  return `${url.pathname}${url.search}${url.hash}`
}
