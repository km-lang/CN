import { z } from "zod"
import { COMPANY_PRIORITY_OPTIONS, PLACEMENT_RELEVANCE_VERSION } from "@/lib/placement-relevance"

export const CN_SELECTION_VERSION = "cn-selection-v1" as const
const year = z.number().int().min(1900).max(2100)
const label = z.string().trim().min(1).max(160)
const ids = z.array(z.number().int().positive()).max(20_000).default([])
export const cnSelectionSchema = z.object({
  version: z.literal(CN_SELECTION_VERSION),
  scoreVersion: z.literal(PLACEMENT_RELEVANCE_VERSION),
  criteria: z.object({
    minPlacementRelevance: z.number().int().min(0).max(100).optional(),
    minDataConfidence: z.number().int().min(0).max(100).optional(),
    company: label.optional(),
    companyPriority: z.enum(COMPANY_PRIORITY_OPTIONS.map(([name]) => name) as [typeof COMPANY_PRIORITY_OPTIONS[number][0], ...Array<typeof COMPANY_PRIORITY_OPTIONS[number][0]>]).optional(),
    seniorities: z.array(label).max(20).default([]),
    seniorityMode: z.enum(["selected", "minimum"]).default("selected"),
    role: label.optional(), function: label.optional(),
    graduationYearMode: z.enum(["exact", "range"]).optional(),
    graduationYear: year.optional(), graduationYearStart: year.optional(), graduationYearEnd: year.optional(),
    programmes: z.array(label).max(20).default([]),
    location: label.optional(),
  }).strict().superRefine((value, context) => {
    if (value.graduationYearMode === "exact" && !value.graduationYear) context.addIssue({ code: "custom", message: "Exact year is required." })
    if (value.graduationYearMode === "range" && (!value.graduationYearStart || !value.graduationYearEnd || value.graduationYearStart > value.graduationYearEnd)) context.addIssue({ code: "custom", message: "A valid graduation-year range is required." })
    if (value.graduationYearMode === undefined && (value.graduationYear !== undefined || value.graduationYearStart !== undefined || value.graduationYearEnd !== undefined)) context.addIssue({ code: "custom", message: "Graduation-year mode is required when a year is supplied." })
    if (value.seniorityMode === "minimum" && value.seniorities.length !== 1) context.addIssue({ code: "custom", message: "Minimum seniority requires one level." })
  }),
  includeCnAlumniIds: ids,
  excludeCnAlumniIds: ids,
  calendarPolicy: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("WEEKLY"), weekday: z.number().int().min(0).max(6), localTime: z.string(), timezone: label }).strict(),
    z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31), localTime: z.string(), timezone: label }).strict(),
    z.object({ kind: z.literal("TWICE_MONTHLY"), days: z.tuple([z.number().int().min(1).max(31), z.number().int().min(1).max(31)]), localTime: z.string(), timezone: label }).strict(),
    z.object({ kind: z.literal("CUSTOM_MONTH_DAYS"), days: z.array(z.number().int().min(1).max(31)).min(1).max(10), localTime: z.string(), timezone: label }).strict(),
  ]).optional(),
}).strict().superRefine((value, context) => {
  const included = new Set(value.includeCnAlumniIds)
  if (value.excludeCnAlumniIds.some(id => included.has(id))) context.addIssue({ code: "custom", message: "An alumnus cannot be both included and excluded." })
})

export type CnSelectionContract = z.infer<typeof cnSelectionSchema>
export function parseCnSelectionContract(value: unknown): CnSelectionContract { return cnSelectionSchema.parse(value) }
