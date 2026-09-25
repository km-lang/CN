"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type AlumnusComboboxOption = { id: number; name: string; title: string; company: string }

export function AlumnusCombobox({ options, value, onValueChange, label = "Target alumnus", placeholder = "Search or select an alumnus..." }: {
  options: AlumnusComboboxOption[]
  value: number | null
  onValueChange: (value: number | null) => void
  label?: string
  placeholder?: string
}) {
  const selected = options.find(option => option.id === value) ?? null
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? options.filter(option => `${option.name} ${option.title} ${option.company}`.toLowerCase().includes(needle)) : options
  }, [options, query])

  function choose(id: number) {
    onValueChange(id)
    setQuery("")
    setOpen(false)
  }

  return <label className="alumnus-combobox-field"><span>{label}</span><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery("") }}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={open} className="alumnus-combobox-trigger"><span>{selected ? selected.name : placeholder}</span><ChevronsUpDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="alumnus-combobox-content" align="start" onOpenAutoFocus={event => event.preventDefault()}><div className="alumnus-combobox-search"><Search aria-hidden="true" /><Input autoFocus autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or role" aria-label="Search alumni" /></div><div className="alumnus-combobox-options" role="listbox" aria-label={label}>{filtered.map(option => <button type="button" role="option" aria-selected={option.id === value} key={option.id} onClick={() => choose(option.id)}><span><strong>{option.name}</strong><small>{option.title} · {option.company}</small></span>{option.id === value && <Check aria-hidden="true" />}</button>)}{!filtered.length && <p>No matching alumni</p>}</div></PopoverContent></Popover></label>
}
