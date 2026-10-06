"use client"

export function SelectionSummary({ label, ids, unresolved = 0 }: { label: string; ids: number[]; unresolved?: number }) {
  return <div className="intelligence-selection-summary" role="status">
    <strong>{label}</strong>
    <span>{ids.length} Corporate Network alumn{ids.length === 1 ? "us" : "i"} selected</span>
    {unresolved > 0 && <small>{unresolved} record{unresolved === 1 ? " is" : "s are"} not yet mapped and will be excluded.</small>}
  </div>
}
