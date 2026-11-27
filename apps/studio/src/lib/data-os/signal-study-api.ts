import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
/** What the Studio form sends to create a study. The database layer validates the subject and the methodology again. */
export const studyCreateInputSchemaV1 = z.object({
  name: text(200),
  subject: z.object({
    kind: z.enum(["category", "own_brand", "alternative"]), name: text(240), category: text(240), own_brand: text(240),
    competitors: z.array(text(80)).max(20), alternatives: z.array(text(80)).max(20), conventional_category: text(240).optional(),
  }).strict(),
  period: z.object({ start_at: z.string().datetime({ offset: true }), end_at: z.string().datetime({ offset: true }) }).strict().nullable().optional(),
  cap_micro_usd: z.number().int().min(6_000_000).max(200_000_000),
  /** The study's own lexicon, for a study that is not about the category the brand listens to. */
  lexicon_terms: z.array(text(80)).min(1).max(400).optional(),
  /** Added by the Studio mutation hook to every POST: a retried click is the same study. */
  idempotency_key: z.string().min(8).max(200),
}).strict();
export const studyPromotionInputSchemaV1 = z.object({
  motive_keys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,119}$/u)).min(1).max(32),
  idempotency_key: z.string().min(8).max(200).optional(),
}).strict();
export type StudyCreateInputV1 = z.infer<typeof studyCreateInputSchemaV1>;
/** One name per line or separated by commas, without blanks or repeats. */
export function studyNamesFromTextV1(value: string, limit = 20): string[] {
  return [...new Set(value.split(/[\n,;]+/u).map(item => item.trim()).filter(Boolean))].slice(0, limit);
}
