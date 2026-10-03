export type SourceMaterializationDatasetContractInput = {
  datasetKey: string;
  datasetRole: string | null;
  sourceRows: number;
  materializedRows: number;
  hasEntityKey: boolean;
  hasTimeAxis: boolean;
  metricFamilies: string[];
};

export type SourceMaterializationContract = {
  version: 3;
  canonicalTargets: Array<"data_asset_records" | "data_observations">;
  expectedSourceRows: number;
  expectedMaterializedRows: number;
  expectsNumericObservations: boolean;
  expectsTemporalRecords: boolean;
  expectsSnapshotRecords: boolean;
  expectsSnapshotObservations: boolean;
  requiresCatalogIdentity: boolean;
  datasets: Array<{
    datasetKey: string;
    datasetRole: string | null;
    sourceRows: number;
    materializedRows: number;
    fullyProfiled: boolean;
    hasEntityKey: boolean;
    hasTimeAxis: boolean;
    metricFamilies: string[];
  }>;
};

export type SourceMaterializationEvidence = {
  insertedRecords: number;
  acceptedRecords: number;
  reviewRecords: number;
  rejectedRecords: number;
  temporalRecords: number;
  snapshotRecords: number;
  catalogRecords: number;
  acceptedCatalogIdentityRecords: number;
  insertedObservations: number;
  acceptedObservations: number;
  reviewObservations: number;
  rejectedObservations: number;
  temporalObservations: number;
  snapshotObservations: number;
};

export type SourceMaterializationQuality = {
  status: "passed" | "warning" | "failed";
  blockers: string[];
  warnings: string[];
  observed: SourceMaterializationEvidence;
  expected: {
    sourceRows: number;
    materializedRows: number;
    canonicalTargets: SourceMaterializationContract["canonicalTargets"];
  };
};

const LONGITUDINAL_DATASET_ROLES = new Set([
  "social_listening",
  "ecommerce_sales",
  "web_analytics",
  "customer_service",
  "paid_media",
  "crm_marketing",
  "reviews_ratings"
]);

export function buildSourceMaterializationContract(
  datasets: SourceMaterializationDatasetContractInput[]
): SourceMaterializationContract {
  const normalized = datasets.map((dataset) => ({
    ...dataset,
    sourceRows: finiteCount(dataset.sourceRows),
    materializedRows: finiteCount(dataset.materializedRows),
    fullyProfiled: finiteCount(dataset.materializedRows) >= finiteCount(dataset.sourceRows),
    metricFamilies: Array.from(new Set(dataset.metricFamilies.filter(Boolean))).sort()
  }));
  const expectsNumericObservations = normalized.some((dataset) => dataset.metricFamilies.length > 0);
  const expectsTemporalRecords = normalized.some(isLongitudinalDataset);
  const snapshotDatasets = normalized.filter(isNumericSnapshotDataset);

  return {
    version: 3,
    canonicalTargets: expectsNumericObservations
      ? ["data_asset_records", "data_observations"]
      : ["data_asset_records"],
    expectedSourceRows: normalized.reduce((total, dataset) => total + dataset.sourceRows, 0),
    expectedMaterializedRows: normalized.reduce((total, dataset) => total + dataset.materializedRows, 0),
    expectsNumericObservations,
    expectsTemporalRecords,
    expectsSnapshotRecords: snapshotDatasets.some(
      (dataset) => dataset.datasetRole !== "product_catalog"
    ),
    expectsSnapshotObservations: snapshotDatasets.length > 0,
    requiresCatalogIdentity: normalized.some((dataset) => dataset.datasetRole === "product_catalog"),
    datasets: normalized
  };
}

export function evaluateSourceMaterialization(
  contract: SourceMaterializationContract,
  evidence: SourceMaterializationEvidence
): SourceMaterializationQuality {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const truncatedDatasets = contract.datasets
    .filter((dataset) => !dataset.fullyProfiled)
    .map((dataset) => dataset.datasetKey);

  if (truncatedDatasets.length > 0) {
    blockers.push(`source_rows_not_fully_profiled:${truncatedDatasets.join(",")}`);
  }
  if (evidence.insertedRecords < contract.expectedMaterializedRows) {
    blockers.push("canonical_records_incomplete");
  }
  if (contract.expectedMaterializedRows > 0 && evidence.insertedRecords === 0) {
    blockers.push("canonical_records_missing");
  }
  if (evidence.rejectedRecords > 0) warnings.push("rejected_source_records_present");
  if (evidence.reviewRecords > 0) warnings.push("source_records_need_mapping_review");
  if (
    contract.expectedMaterializedRows > 0
    && evidence.acceptedRecords === 0
    && evidence.reviewRecords === 0
  ) blockers.push("no_usable_source_records");
  if (contract.expectsTemporalRecords && evidence.temporalRecords === 0) {
    blockers.push("temporal_records_missing_period");
  }
  if (
    contract.expectsTemporalRecords
    && contract.expectsNumericObservations
    && evidence.temporalObservations === 0
  ) {
    blockers.push("temporal_observations_missing_period");
  }
  if (contract.expectsSnapshotRecords && evidence.snapshotRecords === 0) {
    blockers.push("snapshot_records_missing_capture_date");
  }
  if (contract.expectsSnapshotObservations && evidence.snapshotObservations === 0) {
    blockers.push("snapshot_observations_missing_capture_date");
  }
  if (contract.requiresCatalogIdentity) {
    if (evidence.catalogRecords === 0) blockers.push("catalog_records_missing");
    if (evidence.acceptedCatalogIdentityRecords === 0) blockers.push("catalog_identity_missing");
    if (evidence.acceptedCatalogIdentityRecords < evidence.catalogRecords) {
      warnings.push("catalog_identity_incomplete");
    }
  }
  if (contract.expectsNumericObservations && evidence.insertedObservations === 0) {
    blockers.push("numeric_observations_missing");
  }
  if (contract.expectsNumericObservations && evidence.acceptedObservations === 0) {
    blockers.push("no_accepted_numeric_observations");
  }
  if (evidence.reviewObservations > 0) warnings.push("observations_need_mapping_review");
  if (evidence.rejectedObservations > 0) warnings.push("rejected_observations_present");

  return {
    status: blockers.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    observed: evidence,
    expected: {
      sourceRows: contract.expectedSourceRows,
      materializedRows: contract.expectedMaterializedRows,
      canonicalTargets: contract.canonicalTargets
    }
  };
}

function finiteCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function isLongitudinalDataset(
  dataset: SourceMaterializationContract["datasets"][number]
) {
  return dataset.hasTimeAxis || LONGITUDINAL_DATASET_ROLES.has(dataset.datasetRole ?? "");
}

function isNumericSnapshotDataset(
  dataset: SourceMaterializationContract["datasets"][number]
) {
  return dataset.metricFamilies.length > 0 && !isLongitudinalDataset(dataset);
}
