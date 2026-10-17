"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type AlumnusComboboxOption = { id: number; name: string; title: string; company: string }

export function filterAlumnusOptions(options: AlumnusComboboxOption[], query: string, preferredCompany = "All companies") {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length) {
    return options.filter(option => {
      const searchable = `${option.name} ${option.title} ${option.company}`.toLowerCase()
      return tokens.every(token => searchable.includes(token))
    })
  }
  return preferredCompany && preferredCompany !== "All companies"
    ? options.filter(option => option.company === preferredCompany)
    : options
}

export function AlumnusCombobox({ options, value, onValueChange, onSearchChange, searching = false, label = "Target alumnus", placeholder = "Search or select an alumnus...", preferredCompany = "All companies" }: {
  options: AlumnusComboboxOption[]
  value: number | null
  onValueChange: (value: number | null) => void
  label?: string
  placeholder?: string
  preferredCompany?: string
  onSearchChange?: (query: string) => void
  searching?: boolean
}) {
  const selected = options.find(option => option.id === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => filterAlumnusOptions(options, query, preferredCompany), [options, preferredCompany, query])

  function choose(id: number) {
    onValueChange(id)
    setQuery("")
    setOpen(false)
  }

  return <label className="alumnus-combobox-field"><span>{label}</span><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) { setQuery(""); onSearchChange?.("") } }}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={open} className="alumnus-combobox-trigger"><span>{selected ? selected.name : placeholder}</span><ChevronsUpDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="alumnus-combobox-content" align="start" onOpenAutoFocus={event => event.preventDefault()}><div className="alumnus-combobox-search"><Search aria-hidden="true" /><Input autoFocus autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); onSearchChange?.(event.target.value) }} placeholder="Search name, role, or company" aria-label="Search alumni" /></div><div className="alumnus-combobox-options" role="listbox" aria-label={label}>{filtered.map(option => <button type="button" role="option" aria-selected={option.id === value} key={option.id} onClick={() => choose(option.id)}><span><strong>{option.name}</strong><small>{option.title} · {option.company}</small></span>{option.id === value && <Check aria-hidden="true" />}</button>)}{searching && <p>Searching alumni…</p>}{!searching && !filtered.length && <p>No matching alumni</p>}</div></PopoverContent></Popover></label>
}
