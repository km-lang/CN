"use client"

import { useId, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Search, ShieldCheck, ShieldQuestion } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { filterCompanyDirectory, type CompanyDirectoryOption } from "@/lib/company-directory"

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

export function CompanySearchCombobox({ options, value, selectionKey, onValueChange, label = "Company" }: {
  options: CompanyDirectoryOption[]
  value: string
  selectionKey: string
  onValueChange: (value: string, selectionKey: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const listboxId = useId()
  const normalizedQuery = query.trim().replace(/\s+/g, " ")
  const filtered = useMemo(() => filterCompanyDirectory(options, query).slice(0, 50), [options, query])
  const exactSavedMatch = options.some(option => [option.canonicalName, ...option.aliases].some(name => name.toLowerCase() === normalizedQuery.toLowerCase()))

  function choose(company: string, key: string) {
    onValueChange(company, key)
    setQuery("")
    setOpen(false)
  }

  function selected(option: CompanyDirectoryOption) {
    return selectionKey ? option.selectionKey === selectionKey : !option.selectionKey && option.canonicalName.toLowerCase() === value.toLowerCase()
  }

  return <div className="company-combobox-field"><span>{label}</span><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery("") }}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listboxId} className="company-combobox-trigger"><span>{value || "Any company"}</span><ChevronsUpDown aria-hidden="true" /></Button></PopoverTrigger><PopoverContent className="company-combobox-content company-search-combobox-content" align="start" onOpenAutoFocus={event => event.preventDefault()}><div className="company-combobox-search"><Search aria-hidden="true" /><Input autoFocus autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.closest("[data-radix-popper-content-wrapper]")?.querySelector<HTMLButtonElement>("[data-company-option]")?.focus() } }} placeholder="Type a company or alias" aria-label="Search saved companies" aria-controls={listboxId} /></div><div id={listboxId} className="company-combobox-options" role="listbox" aria-label={label}><button data-company-option type="button" role="option" aria-selected={!value} onClick={() => choose("", "")}><span><strong>Any company</strong><small>Clear the company filter</small></span>{!value && <Check aria-hidden="true" />}</button>{filtered.map(option => <button data-company-option type="button" role="option" aria-selected={selected(option)} key={option.selectionKey || `local:${option.canonicalName.toLowerCase()}`} onClick={() => choose(option.canonicalName, option.selectionKey)}><span><strong>{option.canonicalName}</strong><small>{option.aliases.length ? `Aliases: ${option.aliases.join(", ")} · ` : ""}{option.verificationStatus === "VERIFIED" ? "Verified Coresignal identity" : option.verificationStatus === "CONFLICT" ? "Identity conflict — blocked" : "Unverified exact-name fallback"}</small>{option.linkedinOrganizationUrl && <small>{option.linkedinOrganizationUrl}</small>}</span>{option.verificationStatus === "VERIFIED" ? <ShieldCheck aria-label="Verified" /> : <ShieldQuestion aria-label={option.verificationStatus === "CONFLICT" ? "Conflict" : "Unverified"} />}{selected(option) && <Check aria-hidden="true" />}</button>)}{normalizedQuery && !exactSavedMatch && <button data-company-option type="button" role="option" aria-selected={!selectionKey && value.toLowerCase() === normalizedQuery.toLowerCase()} onClick={() => choose(normalizedQuery, "")}><span><strong>Use “{normalizedQuery}”</strong><small>Controlled unverified exact-name fallback · human review required</small></span><ShieldQuestion aria-hidden="true" /></button>}{!filtered.length && (!normalizedQuery || exactSavedMatch) && <p>No matching saved companies</p>}</div></PopoverContent></Popover>{value && <small>{selectionKey ? "Saved company selected; the server will resolve its authoritative provider identity." : "Unverified name fallback; no provider identity is asserted."}</small>}</div>
}
