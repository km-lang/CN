export type ProgrammeOption = {
  id: number
  code: string
  name: string
  active: boolean
  sortOrder: number
}

export type ProgrammeFilterOption = {
  value: string
  label: string
  active: boolean
  historical: boolean
}

export function normaliseProgrammeCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
}

export function programmeFilterOptions(options: ProgrammeOption[], historicalValues: string[]): ProgrammeFilterOption[] {
  const historical = [...new Set(historicalValues.map(value => value.trim()).filter(Boolean))]
  const configured = [...options]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(option => ({
      value: option.code,
      label: option.name + (option.active ? "" : " (inactive)"),
      active: option.active,
      historical: false,
    }))
  const configuredValues = new Set(options.flatMap(option => [option.code.toLowerCase(), option.name.toLowerCase()]))
  const legacy = historical
    .filter(value => !configuredValues.has(value.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map(value => ({ value, label: `${value} (historical)`, active: false, historical: true }))
  return [...configured, ...legacy]
}

export function programmeSelectionSummary(selected: string[]) {
  if (!selected.length) return "Select programmes"
  if (selected.length <= 2) return selected.join(", ")
  if (selected.length === 3) return selected.join(", ")
  return `${selected.length} programmes selected`
}
