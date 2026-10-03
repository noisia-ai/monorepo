import type { SourceObservation } from "@noisia/query-engine";

type PreparedSourceObservation = SourceObservation & {
  lineage: Record<string, unknown>;
};

/**
 * The database key intentionally identifies one canonical metric per source row.
 * Exact duplicates may collapse, but different source fields or values sharing that
 * key mean the semantic mapping is lossy and must stop before any write occurs.
 */
export function prepareSourceObservationsForUpsert(
  observations: SourceObservation[],
  dataSourceId: string,
  dataAssetId: string
) {
  const byConstraintKey = new Map<string, PreparedSourceObservation>();
  const duplicateCounts = new Map<string, number>();

  for (const observation of observations) {
    const key = observationConstraintKey(observation, dataSourceId, dataAssetId);
    const existing = byConstraintKey.get(key);
    if (!existing) {
      byConstraintKey.set(key, observation);
      duplicateCounts.set(key, 1);
      continue;
    }

    if (!observationsAreEquivalent(existing, observation)) {
      throw new Error(
        [
          "Data OS observation key collision",
          `dataset=${observation.datasetKey}`,
          `row=${observation.rowIndex}`,
          `metric_key=${observation.metricKey}`,
          `source_fields=${sourceField(existing)},${sourceField(observation)}`
        ].join("; ")
      );
    }

    const duplicateCount = (duplicateCounts.get(key) ?? 1) + 1;
    duplicateCounts.set(key, duplicateCount);
    byConstraintKey.set(key, {
      ...existing,
      lineage: {
        ...existing.lineage,
        deduplicated_before_upsert: true,
        exact_duplicate_observation_count: duplicateCount,
        dedupe_key: key
      }
    });
  }

  return Array.from(byConstraintKey.values());
}

function observationConstraintKey(
  observation: SourceObservation,
  dataSourceId: string,
  dataAssetId: string
) {
  return [
    dataSourceId,
    dataAssetId,
    observation.datasetKey,
    observation.rowIndex,
    observation.metricKey
  ].join("::");
}

function observationsAreEquivalent(left: SourceObservation, right: SourceObservation) {
  return left.metricFamily === right.metricFamily
    && left.metricVariant === right.metricVariant
    && left.metricValue === right.metricValue
    && left.metricUnit === right.metricUnit
    && left.metricCurrencyCode === right.metricCurrencyCode
    && left.periodStart === right.periodStart
    && left.periodEnd === right.periodEnd
    && left.periodGrain === right.periodGrain
    && left.periodSemantics === right.periodSemantics
    && left.entityType === right.entityType
    && left.entityKey === right.entityKey
    && sourceField(left) === sourceField(right)
    && JSON.stringify(left.dimensions) === JSON.stringify(right.dimensions)
    && JSON.stringify(left.rawRecord) === JSON.stringify(right.rawRecord)
    && left.qualityStatus === right.qualityStatus
    && JSON.stringify(left.qualityIssues) === JSON.stringify(right.qualityIssues);
}

function sourceField(observation: SourceObservation) {
  const value = observation.lineage.source_field;
  return typeof value === "string" && value.trim() ? value : "unknown";
}
