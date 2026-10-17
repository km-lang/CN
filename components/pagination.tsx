"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { clampedPage, PAGE_SIZE_OPTIONS, paginate, paginationRange, totalPages, type PageSize } from "@/lib/pagination"

export function usePagination<T>(items: readonly T[], resetKey = "") {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<PageSize>(10)
  const [activeResetKey, setActiveResetKey] = useState(resetKey)

  if (activeResetKey !== resetKey) {
    setActiveResetKey(resetKey)
    setPage(1)
  }

  const total = items.length
  const pageCount = totalPages(total, pageSize)
  const currentPage = clampedPage(page, total, pageSize)
  const range = paginationRange(total, currentPage, pageSize)
  const pageItems = useMemo(() => paginate(items, currentPage, pageSize), [currentPage, items, pageSize])

  function setPageSize(next: PageSize) {
    setPageSizeState(next)
    setPage(1)
  }

  return {
    items: pageItems,
    total,
    page: currentPage,
    pageSize,
    pageCount,
    start: range.start,
    end: range.end,
    setPage,
    setPageSize,
  }
}

export type PaginationModel = ReturnType<typeof usePagination<unknown>>

export function PaginationFooter({ model, label = "Pagination" }: { model: PaginationModel; label?: string }) {
  return <nav className="pagination-footer" aria-label={label}>
    <span className="pagination-summary">Showing {model.start}–{model.end} of {model.total}</span>
    <label className="pagination-size"><span>Rows per page</span><Select value={String(model.pageSize)} onValueChange={value => model.setPageSize(Number(value) as PageSize)}><SelectTrigger aria-label={`${label} rows per page`}><SelectValue /></SelectTrigger><SelectContent>{PAGE_SIZE_OPTIONS.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></label>
    <div className="pagination-navigation">
      <Button type="button" size="sm" variant="outline" disabled={model.page <= 1} onClick={() => model.setPage(model.page - 1)}>Previous</Button>
      <span>Page {model.page} of {model.pageCount}</span>
      <Button type="button" size="sm" variant="outline" disabled={model.page >= model.pageCount} onClick={() => model.setPage(model.page + 1)}>Next</Button>
    </div>
  </nav>
}
