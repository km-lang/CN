type AlumniEducationSummary = {
  programme: string
  batch: number
  graduationYear?: number
}

function validYear(value: unknown) {
  const year = Number(value)
  return Number.isInteger(year) && year > 0 ? year : 0
}

export function discoveredAlumniYearValues(graduationYear: unknown) {
  const year = validYear(graduationYear)
  return { batch: year, graduationYear: year }
}

export function alumniEducationLabel(person: AlumniEducationSummary) {
  const year = validYear(person.graduationYear) || validYear(person.batch)
  if (person.programme === "Not confirmed") return `Graduation year ${year || "not confirmed"}`
  return `${person.programme} · ${year || "not confirmed"}`
}
