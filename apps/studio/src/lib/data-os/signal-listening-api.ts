import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
/** A question with options, as the Brand OS form sends it. The database layer validates the composed configuration again. */
export const listeningQuestionInputSchemaV1 = z.object({
  key, text: z.string().trim().min(1).max(600),
  options: z.array(z.object({ key, definition: z.string().trim().min(1).max(600) }).strict()).min(2).max(12),
  scope: z.enum(["all", "consumer_category"]), active: z.boolean(),
  origin: z.enum(["brand_os", "agent", "methodology"]).default("brand_os"), human_locked: z.boolean().default(false),
}).strict();
export const listeningSaveInputSchemaV1 = z.object({
  expected_revision: z.number().int().min(0), questions: z.array(listeningQuestionInputSchemaV1).max(16),
}).strict();
export const listeningRunInputSchemaV1 = z.object({ cap_micro_usd: z.number().int().min(10_000).max(200_000_000) }).strict();
export type ListeningQuestionInputV1 = z.infer<typeof listeningQuestionInputSchemaV1>;

export function isSignalListeningEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NOISIA_SIGNAL_LISTENING_ENABLED === "true";
}
/** Turns free text into a stable key: lowercase words joined by underscores. */
export function listeningKeyFromLabelV1(label: string, taken: ReadonlySet<string>): string {
  const base = label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "")
    .replace(/^([^a-z])/u, "q_$1").slice(0, 48) || "question";
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${base}_${suffix}`;
  return candidate;
}
