export type EngineUnit = {
  external_ref: string;
  study_corpus_id: string | null;
  entity_id: string | null;
  entity_hint: string | null;
  text: string;
  platform: string | null;
  published_at: string | null;
};

export function buildEngineCorpusScopeIds(scope: { study_corpus_id: string; base_corpus_id?: string | null }) {
  return Array.from(new Set([scope.study_corpus_id, scope.base_corpus_id].filter((id): id is string => Boolean(id))));
}

export function readRetrievedUnits(metaJson: Record<string, unknown>): EngineUnit[] {
  const retrieval = readRetrievalRecord(metaJson);
  const units = Array.isArray(retrieval.units) ? retrieval.units : [];
  return units
    .filter((unit): unit is Record<string, unknown> => Boolean(unit) && typeof unit === "object" && !Array.isArray(unit))
    .map((unit) => ({
      external_ref: stringValue(unit.external_ref),
      study_corpus_id: stringValue(unit.study_corpus_id) || null,
      entity_id: stringValue(unit.entity_id) || null,
      entity_hint: stringValue(unit.entity_hint) || null,
      text: stringValue(unit.text),
      platform: stringValue(unit.platform) || null,
      published_at: stringValue(unit.published_at) || null
    }))
    .filter((unit) => unit.external_ref && unit.text);
}

export function shouldReadUnitsFromRunMap(metaJson: Record<string, unknown>): boolean {
  const retrieval = readRetrievalRecord(metaJson);
  return retrieval.materialized_run_map === true || retrieval.materialized_run_map_table === "engine_run_mention_map";
}

export function readRetrievedUnitLimit(metaJson: Record<string, unknown>, fallback = 180): number {
  const retrieval = readRetrievalRecord(metaJson);
  return readPositiveInteger(retrieval.max_units)
    ?? readPositiveInteger(retrieval.retrieved_units)
    ?? fallback;
}

function readRetrievalRecord(metaJson: Record<string, unknown>): Record<string, unknown> {
  return metaJson.retrieval && typeof metaJson.retrieval === "object" && !Array.isArray(metaJson.retrieval)
    ? metaJson.retrieval as Record<string, unknown>
    : {};
}

function readPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
