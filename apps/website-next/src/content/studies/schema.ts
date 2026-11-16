import { z } from "zod";

/**
 * A marketing study as the study agents deliver it (`estudio.json`). The load script validates
 * it with this schema before anything reaches the database; the site reads the same shape back.
 * Client studies never go here.
 */

export const MARKETS = ["MX", "UK", "BR", "DE", "US-CA", "ES", "FR"] as const;
export const ACCESS_MODES = ["abierto", "registro", "solo_link"] as const;
export const FULL_LANGUAGES = ["es", "en", "pt", "de"] as const;

export type Market = (typeof MARKETS)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];
export type FullLanguage = (typeof FULL_LANGUAGES)[number];

const text = z.string().trim().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const studySummarySchema = z.object({
  title: text,
  /** One or two sentences: what the study is about. */
  dek: text,
  findings: z.array(text).min(2).max(6),
  /** One or two figures, each with the base it was computed on. */
  stats: z.array(z.object({ value: text, label: text, base: text })).min(1).max(4),
  quote: z.object({ text, translation: text.optional(), platform: text, date: text }).optional(),
  method_note: text,
  /** The period in this language ("Jan–Oct 2026"); without it the page shows `period.label`. */
  period_label: text.optional()
});

export const studySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words joined by hyphens"),
  industry: z.string().regex(/^[a-z0-9-]+$/),
  /** One market ("MX") or several (["UK", "DE", "ES", "FR"]) for a study that reads them side by side. */
  market: z.union([z.enum(MARKETS), z.array(z.enum(MARKETS)).min(1).max(8)]),
  method: text,
  period: z.object({ label: text, start: isoDate, end: isoDate }),
  base: z.object({ mentions: z.number().int().positive(), channels: z.array(text).min(1), cut_date: isoDate }),
  access: z.enum(ACCESS_MODES),
  full_language: z.enum(FULL_LANGUAGES),
  es: studySummarySchema,
  en: studySummarySchema
});

export type StudyInput = z.infer<typeof studySchema>;

/** The markets of a study as a list without repeats, in the order given. The first is the main one. */
export function studyMarkets(input: Pick<StudyInput, "market">): Market[] {
  return [...new Set(Array.isArray(input.market) ? input.market : [input.market])];
}
export type StudySummary = z.infer<typeof studySummarySchema>;
