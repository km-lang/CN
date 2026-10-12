"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function normalizeCompanyOptions(values: string[]) {
  const companies = new Map<string, string>()
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ")
    const key = value.toLowerCase()
    if (value && !companies.has(key)) companies.set(key, value)
  }
  return [...companies.values()].sort((left, right) => left.localeCompare(right))
}

export function filterCompanyOptions(options: string[], query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return tokens.length
    ? options.filter(company => tokens.every(token => company.toLowerCase().includes(token)))
    : options
}

export function CompanyCombobox({ options, value, onValueChange, label = "Target company" }: {
  options: string[]
  value: string
  onValueChange: (value: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => filterCompanyOptions(options, query), [options, query])

  function choose(company: string) {
    onValueChange(company)
    setQuery("")
    setOpen(false)
  }

  return <label className="company-combobox-field"><span>{label}</span><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery("") }}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={open} className="company-combobox-trigger"><span>{value || "All companies"}</span><ChevronsUpDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="company-combobox-content" align="start" onOpenAutoFocus={event => event.preventDefault()}><div className="company-combobox-search"><Search aria-hidden="true" /><Input autoFocus autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search companies" aria-label="Search companies" /></div><div className="company-combobox-options" role="listbox" aria-label={label}><button type="button" role="option" aria-selected={value === "All companies"} onClick={() => choose("All companies")}><span><strong>All companies</strong><small>No company filter</small></span>{value === "All companies" && <Check aria-hidden="true" />}</button>{filtered.map(company => <button type="button" role="option" aria-selected={company === value} key={company} onClick={() => choose(company)}><strong>{company}</strong>{company === value && <Check aria-hidden="true" />}</button>)}{!filtered.length && <p>No matching companies</p>}</div></PopoverContent></Popover></label>
}
