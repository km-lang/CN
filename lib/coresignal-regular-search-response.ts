import {
  CoresignalSearchIdValidationError,
  normalizeCoresignalSearchIdentityBatch,
} from "@/lib/coresignal-search-id-dedupe"

export type CoresignalRegularSearchResponseHeaders =
  | Pick<Headers, "get">
  | Readonly<Record<string, string | number | null | undefined>>

export type CoresignalRegularSearchPage = {
  employeeIds: readonly string[]
  pageIdsReceived: number
  uniquePageIds: number
  totalResults: number | null
  pagination: {
    totalPages: number | null
    nextPageAfter: string | null
  }
}

export class CoresignalRegularSearchResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CoresignalRegularSearchResponseError"
  }
}

function headerValue(headers: CoresignalRegularSearchResponseHeaders, name: string): string | null {
  if (!headers || typeof headers !== "object") {
    throw new CoresignalRegularSearchResponseError("Coresignal regular Search response headers must be a Headers-compatible object.")
  }
  if ("get" in headers && typeof headers.get === "function") return headers.get(name)
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  const value = entry?.[1]
  return value === null || value === undefined ? null : String(value)
}

function optionalNonNegativeSafeIntegerHeader(headers: CoresignalRegularSearchResponseHeaders, name: string) {
  const raw = headerValue(headers, name)
  if (raw === null) return null
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new CoresignalRegularSearchResponseError(`Coresignal regular Search response ${name} must be a non-negative integer when supplied.`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new CoresignalRegularSearchResponseError(`Coresignal regular Search response ${name} exceeds the safe integer range.`)
  }
  return value
}

/**
 * Parses one documented regular Search page. Coresignal returns the ID page in
 * the JSON body and total/continuation metadata in response headers. The
 * continuation value is deliberately retained as an opaque string; this layer
 * never follows it or performs another request.
 */
export function parseCoresignalRegularSearchResponse(
  body: unknown,
  headers: CoresignalRegularSearchResponseHeaders,
): CoresignalRegularSearchPage {
  if (!Array.isArray(body)) {
    throw new CoresignalRegularSearchResponseError("Coresignal regular Search response body must be an array of employee IDs.")
  }

  let employeeIds: readonly string[]
  try {
    employeeIds = normalizeCoresignalSearchIdentityBatch({ employeeIds: body })
  } catch (error) {
    if (error instanceof CoresignalSearchIdValidationError) {
      throw new CoresignalRegularSearchResponseError("Coresignal regular Search returned an invalid employee ID page.", { cause: error })
    }
    throw error
  }

  const totalResults = optionalNonNegativeSafeIntegerHeader(headers, "x-total-results")
  const totalPages = optionalNonNegativeSafeIntegerHeader(headers, "x-total-pages")
  const nextPageAfterHeader = headerValue(headers, "x-next-page-after")
  if (nextPageAfterHeader !== null && (!nextPageAfterHeader.trim() || nextPageAfterHeader.length > 256 || /[\u0000-\u001f\u007f]/.test(nextPageAfterHeader))) {
    throw new CoresignalRegularSearchResponseError("Coresignal regular Search returned an invalid x-next-page-after header.")
  }
  if (totalResults !== null && body.length > totalResults) {
    throw new CoresignalRegularSearchResponseError("Coresignal regular Search page contains more IDs than its x-total-results header reports.")
  }
  if (body.length > 0 && totalPages === 0) {
    throw new CoresignalRegularSearchResponseError("Coresignal regular Search returned IDs while x-total-pages was zero.")
  }

  return {
    employeeIds,
    pageIdsReceived: body.length,
    uniquePageIds: employeeIds.length,
    totalResults,
    pagination: {
      totalPages,
      nextPageAfter: nextPageAfterHeader,
    },
  }
}
