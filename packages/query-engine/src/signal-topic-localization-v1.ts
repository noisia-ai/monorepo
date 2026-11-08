import { z } from "zod";

const wording = z.object({
  name: z.string().min(1).max(160).refine(value => value.trim().length > 0),
  definition: z.string().min(1).max(1500).refine(value => value.trim().length > 0),
}).strict();

export const signalTopicLocalizationSchemaV1 = z.object({
  original_language: z.string().min(2).max(35).refine(value => {
    try { return new Intl.Locale(value).language !== "und"; } catch { return false; }
  }),
  original: wording,
  en: wording,
  es: wording,
}).strict();
export type SignalEditorialTopicLocalizationV1 = z.infer<typeof signalTopicLocalizationSchemaV1>;

const wordingNode = {
  type: "object", additionalProperties: false, required: ["name", "definition"],
  properties: { name: { type: "string" }, definition: { type: "string" } },
};
export const SIGNAL_TOPIC_LOCALIZATION_JSON_SCHEMA_V1 = {
  type: "object", additionalProperties: false, required: ["original_language", "original", "en", "es"],
  properties: { original_language: { type: "string" }, original: wordingNode, en: wordingNode, es: wordingNode },
};
