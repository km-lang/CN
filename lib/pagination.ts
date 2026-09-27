export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]

export function totalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

export function clampedPage(page: number, total: number, pageSize: number) {
  return Math.min(Math.max(1, page), totalPages(total, pageSize))
}

export function paginationRange(total: number, page: number, pageSize: number) {
  if (total <= 0) return { start: 0, end: 0 }
  const safePage = clampedPage(page, total, pageSize)
  const start = (safePage - 1) * pageSize + 1
  return { start, end: Math.min(total, start + pageSize - 1) }
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number) {
  const safePage = clampedPage(page, items.length, pageSize)
  const offset = (safePage - 1) * pageSize
  return items.slice(offset, offset + pageSize)
}
