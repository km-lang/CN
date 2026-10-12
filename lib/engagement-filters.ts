export type EngagementFilterInput = {
  eventType: string
  eventDate: string
  status: string
  assignedTo: string
  owner?: { displayName: string } | null
  alumnus?: { company?: string; email?: string } | null
}

export type EngagementFilterState = {
  queue: string
  period: string
  company: string
  assignee: string
  actionState: string
  currentUser: string
  today: string
}

const terminal = new Set(["Action Taken", "Response Received", "Closed", "Completed", "Skipped"])

export function engagementMatches(event: EngagementFilterInput, filters: EngagementFilterState) {
  const assignee = event.owner?.displayName ?? event.assignedTo
  if (filters.queue === "Professional Signals" && event.eventType !== "Professional Signal") return false
  if (filters.queue === "Birthdays" && event.eventType !== "Birthday") return false
  if (filters.queue === "Assigned to Me" && assignee !== filters.currentUser) return false
  if (filters.queue === "Follow-ups" && event.status !== "Follow-up Due") return false
  if (filters.queue === "Completed" && !terminal.has(event.status)) return false
  if (filters.queue === "Skipped" && event.status !== "Skipped") return false
  if (filters.queue === "Needs Action" && terminal.has(event.status)) return false

  const today = new Date(`${filters.today}T12:00:00Z`)
  const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const nextWeek = new Date(today); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7)
  if (filters.period === "Today" && event.eventDate !== filters.today) return false
  if (filters.period === "Tomorrow" && event.eventDate !== tomorrow.toISOString().slice(0, 10)) return false
  if (filters.period === "Next 7 Days" && (event.eventDate < filters.today || event.eventDate > nextWeek.toISOString().slice(0, 10))) return false
  if (filters.period === "This Month" && event.eventDate.slice(0, 7) !== filters.today.slice(0, 7)) return false
  if (filters.period === "All upcoming" && event.eventDate < filters.today) return false
  if (filters.company !== "All companies" && event.alumnus?.company !== filters.company) return false
  if (filters.queue !== "Assigned to Me") {
    if (filters.assignee === "Unassigned" && assignee) return false
    if (filters.assignee === "Assigned to me" && assignee !== filters.currentUser) return false
    if (!['All assignees', 'Unassigned', 'Assigned to me'].includes(filters.assignee) && assignee !== filters.assignee) return false
  }
  if (filters.actionState === "Email available" && !event.alumnus?.email) return false
  if (filters.actionState === "Email unavailable" && event.alumnus?.email) return false
  return true
}
