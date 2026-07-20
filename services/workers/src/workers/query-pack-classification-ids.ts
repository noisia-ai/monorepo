import type { QueryPackClassification, QueryPackMention } from "@noisia/query-engine";

export function aliasQueryPackSample(sample: QueryPackMention[]) {
  const originalIdByAlias = new Map<string, string>();
  const aliasedSample = sample.map((mention, index) => {
    const alias = `m-${String(index + 1).padStart(2, "0")}`;
    originalIdByAlias.set(alias, mention.id);
    return { ...mention, id: alias };
  });

  return { aliasedSample, originalIdByAlias };
}

export function restoreQueryPackClassificationIds(
  classifications: QueryPackClassification[],
  originalIdByAlias: Map<string, string>
): QueryPackClassification[] {
  return classifications.map((classification) => {
    const originalId = originalIdByAlias.get(classification.mention_id);
    if (!originalId) {
      throw new Error(`Evaluator returned unknown local mention_id: ${classification.mention_id}`);
    }
    return { ...classification, mention_id: originalId };
  });
}
