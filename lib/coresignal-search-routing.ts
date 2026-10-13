import type { CoresignalSearchIdLookupStore } from "@/lib/coresignal-search-id-dedupe"
import { deduplicateCoresignalSearchIds } from "@/lib/coresignal-search-id-dedupe"
import {
  parseCoresignalRegularSearchResponse,
  type CoresignalRegularSearchResponseHeaders,
} from "@/lib/coresignal-regular-search-response"

export type CoresignalSearchIdentityRoute = {
  employeeId: string
  routingState: "IDENTITY_RESOLVED" | "IDENTITY_RESOLUTION_REQUIRED" | "IDENTITY_REVIEW_REQUIRED"
  mappedAlumnusId: number | null
  canonicalLinkedinUrl: string | null
  identityResolutionRequired: boolean
  nextProviderAction: "NOT_NEEDED_FOR_IDENTITY" | "UNDECIDED"
  profileFreshness: "NOT_EVALUATED"
  reason: string
}

export type CoresignalSearchRoutingPlan = {
  providerSearch: {
    totalResults: number
    pageIdsReceived: number
    uniquePageIds: number
    totalPages: number
    nextPageAfter: string | null
  }
  routes: readonly CoresignalSearchIdentityRoute[]
  summary: {
    identityResolved: number
    identityResolutionRequired: number
    identityReviewRequired: number
    providerIdentityResolutionOperationsPotentiallyAvoidable: number
    profilesRequiringFurtherResolution: number
  }
}

export async function planCoresignalRegularSearchRouting(
  body: unknown,
  headers: CoresignalRegularSearchResponseHeaders,
  store: CoresignalSearchIdLookupStore,
): Promise<CoresignalSearchRoutingPlan> {
  const providerSearch = parseCoresignalRegularSearchResponse(body, headers)
  const dedupe = await deduplicateCoresignalSearchIds({ employeeIds: providerSearch.employeeIds }, store)
  const routes = dedupe.classifications.map<CoresignalSearchIdentityRoute>((classification) => {
    if (classification.mappingState === "KNOWN_PROVIDER_ID") {
      return {
        employeeId: classification.employeeId,
        routingState: "IDENTITY_RESOLVED",
        mappedAlumnusId: classification.mappedAlumnusId,
        canonicalLinkedinUrl: classification.canonicalLinkedinUrl,
        identityResolutionRequired: false,
        nextProviderAction: "NOT_NEEDED_FOR_IDENTITY",
        profileFreshness: "NOT_EVALUATED",
        reason: "The Coresignal Employee ID already maps uniquely to a Corporate Network alumnus.",
      }
    }
    if (classification.mappingState === "IDENTITY_REVIEW_REQUIRED") {
      return {
        employeeId: classification.employeeId,
        routingState: "IDENTITY_REVIEW_REQUIRED",
        mappedAlumnusId: null,
        canonicalLinkedinUrl: null,
        identityResolutionRequired: true,
        nextProviderAction: "UNDECIDED",
        profileFreshness: "NOT_EVALUATED",
        reason: "Stored identity mappings are inconsistent and require human resolution before any provider action is selected.",
      }
    }
    return {
      employeeId: classification.employeeId,
      routingState: "IDENTITY_RESOLUTION_REQUIRED",
      mappedAlumnusId: null,
      canonicalLinkedinUrl: null,
      identityResolutionRequired: true,
      nextProviderAction: "UNDECIDED",
      profileFreshness: "NOT_EVALUATED",
      reason: "No durable Corporate Network mapping exists for this Coresignal Employee ID.",
    }
  })

  const count = (state: CoresignalSearchIdentityRoute["routingState"]) => routes.filter(route => route.routingState === state).length
  const identityResolved = count("IDENTITY_RESOLVED")
  const identityResolutionRequired = count("IDENTITY_RESOLUTION_REQUIRED")
  const identityReviewRequired = count("IDENTITY_REVIEW_REQUIRED")

  return {
    providerSearch: {
      totalResults: providerSearch.totalResults,
      pageIdsReceived: providerSearch.pageIdsReceived,
      uniquePageIds: providerSearch.uniquePageIds,
      totalPages: providerSearch.pagination.totalPages,
      nextPageAfter: providerSearch.pagination.nextPageAfter,
    },
    routes,
    summary: {
      identityResolved,
      identityResolutionRequired,
      identityReviewRequired,
      providerIdentityResolutionOperationsPotentiallyAvoidable: identityResolved,
      profilesRequiringFurtherResolution: identityResolutionRequired + identityReviewRequired,
    },
  }
}
