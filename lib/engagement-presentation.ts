export type EngagementOwnerUser = { id: number; displayName: string; email?: string; enabled?: boolean; role?: string }

export function resolveEngagementOwner(value: unknown, users: EngagementOwnerUser[]) {
  const storedIdentity = String(value ?? "").trim()
  if (!storedIdentity) return null
  const numericId = /^\d+$/.test(storedIdentity) ? Number(storedIdentity) : null
  const user = users.find(candidate => numericId !== null
    ? candidate.id === numericId
    : candidate.displayName === storedIdentity || candidate.email?.toLowerCase() === storedIdentity.toLowerCase())
  if (user) return { userId: user.id, displayName: user.displayName, storedIdentity, available: user.enabled !== false }
  return {
    userId: numericId,
    displayName: numericId === null ? storedIdentity : `Unknown user (ID ${storedIdentity})`,
    storedIdentity,
    available: false,
  }
}

export function groupEngagementsByAlumnus<T extends { alumnusId: number }>(events: T[]) {
  const groups = new Map<number, T[]>()
  for (const event of events) groups.set(event.alumnusId, [...(groups.get(event.alumnusId) ?? []), event])
  return [...groups.entries()].map(([alumnusId, items]) => ({ alumnusId, events: items }))
}
