"use client"

import { Button } from "@/components/ui/button"
import type { IntelligenceView } from "@/lib/intelligence-navigation"
import { AlumniDiscovery } from "./alumni-discovery"
import { RefreshCenter } from "./refresh-center"
import { ReviewChanges } from "./review-changes"

export function IntelligenceWorkspace({ view, onViewChange, selectedIds, pageIds, matchingIds, canOperate, canAdminister }: { view: IntelligenceView; onViewChange: (view: IntelligenceView) => void; selectedIds: number[]; pageIds: number[]; matchingIds: number[]; canOperate: boolean; canAdminister: boolean }) {
  return <div className="intelligence-workspace"><div className="intelligence-subtabs" role="navigation" aria-label="Intelligence sections"><Button variant={view === "refresh" ? "default" : "outline"} onClick={() => onViewChange("refresh")}>Refresh Center</Button><Button variant={view === "reviews" ? "default" : "outline"} onClick={() => onViewChange("reviews")}>Review Changes</Button><Button variant={view === "discovery" ? "default" : "outline"} onClick={() => onViewChange("discovery")}>Alumni Discovery</Button></div>{view === "refresh" ? <RefreshCenter selectedIds={selectedIds} pageIds={pageIds} matchingIds={matchingIds} canOperate={canOperate} canManageSchedules={canAdminister} /> : view === "reviews" ? <ReviewChanges canOperate={canOperate} /> : <AlumniDiscovery canOperate={canOperate} />}</div>
}
