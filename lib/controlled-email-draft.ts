const terminalStatuses = new Set(["Action Taken", "Response Received", "Closed", "Skipped"])

type ManualEmailEvent = {
  id: number
  status: string
  actionTakenAt: string
  assignedTo: string
}

export function reusableManualEmailEvent<T extends ManualEmailEvent>(
  events: T[],
  eventIdsWithEmailActions: ReadonlySet<number>,
  actor: string,
) {
  return events.find(event =>
    !terminalStatuses.has(event.status)
    && !event.actionTakenAt
    && !eventIdsWithEmailActions.has(event.id)
    && (!event.assignedTo || event.assignedTo === actor)
  )
}
