import {
  DATA_OS_CAPABILITY_ROLLUP_SQL,
  buildDataOsCapabilities,
  type DataOsCapability,
  type DataOsCapabilityRow
} from "./data-os-capabilities";
import { DATA_OS_METRIC_DEFINITIONS } from "./data-os-metric-catalog";
import type { DataOsSqlExecutor } from "./listening-data-os";
import {
  assessTbCodingBridgeQuality,
  type TbCodingBridgeCounts,
  type TbCodingBridgeQuality
} from "./tb-data-os-bridge-quality";

export const DATA_OS_CORPUS_AUDIT_CONTRACT = "noisia_data_os_corpus_audit_v1";

export type DataOsCorpusAuditStage = "pre_analysis" | "post_coding" | "release";
export type DataOsCorpusAuditStatus = "ready" | "ready_with_warnings" | "blocked";

export type DataOsCorpusAuditIssue = {
  code: string;
  message: string;
  count?: number;
};

export type DataOsSourceMaterializationEvidence = {
  source_id: string;
  file_name: string;
  source_status: string;
  source_error: string | null;
  active_data_sources: number;
  active_assets: number;
  active_asset_rows: number;
  active_contracts: number;
  current_quality_results: number;
  passed_quality_results: number;
  warning_quality_results: number;
  failed_quality_results: number;
  expected_source_rows: number;
  expected_materialized_rows: number;
  expects_numeric_observations: boolean;
  expects_temporal_records: boolean;
  expects_snapshot_records: boolean;
  expects_snapshot_observations: boolean;
  requires_catalog_identity: boolean;
  canonical_records: number;
  accepted_records: number;
  review_records: number;
  rejected_records: number;
  temporal_records: number;
  snapshot_records: number;
  catalog_records: number;
  accepted_catalog_identity_records: number;
  complete_record_lineage: number;
  accepted_observations: number;
  review_observations: number;
  rejected_observations: number;
  temporal_observations: number;
  snapshot_observations: number;
  knowledge_source_lineage: number;
  source_asset_lineage: number;
  sync_asset_lineage: number;
};

export type DataOsCorpusAuditEvidence = {
  corpus: {
    exists: boolean;
    total_records: number;
    included_records: number;
    excluded_records: number;
    other_records: number;
    completed_imports: number;
    duplicate_records: number;
    ingestion_deduplicated_records: number;
    covered_months: number;
    platforms: number;
    coverage_start: string | null;
    coverage_end: string | null;
  };
  catalog: {
    listening_sources: number;
    listening_assets: number;
    listening_asset_rows: number;
    active_contracts: number;
    canonical_fields: number;
    active_quality_rules: number;
    quality_results: number;
    failed_quality_results: number;
    warning_quality_results: number;
    source_asset_lineage: number;
    source_sync_lineage: number;
    import_asset_lineage: number;
    import_source_lineage: number;
    tb_taxonomy_terms: number;
    tb_required_bindings: number;
  };
  observations: {
    total: number;
    accepted: number;
    review_required: number;
    rejected: number;
    listening: number;
    represented_listening_records: number;
    represented_listening_value: number;
    invalid_currency_contract: number;
    invalid_unit_contract: number;
    unknown_metric_family: number;
    invalid_count_value: number;
    invalid_ratio_value: number;
    invalid_duration_value: number;
    invalid_period_contract: number;
    invalid_metric_mapping: number;
    invalid_product_catalog_time: number;
  };
  source_materializations: {
    uploaded_sources: number;
    processed_sources: number;
    pending_sources: number;
    failed_sources: number;
    canonical_records: number;
    accepted_records: number;
    review_records: number;
    rejected_records: number;
    accepted_observations: number;
    warning_quality_results: number;
    failed_quality_results: number;
    sources: DataOsSourceMaterializationEvidence[];
  };
  capabilities: DataOsCapability[];
  tb_bridge: {
    analysis_found: boolean;
    counts: TbCodingBridgeCounts;
    quality: TbCodingBridgeQuality | null;
  };
};

export type DataOsCorpusAudit = DataOsCorpusAuditEvidence & {
  contract: typeof DATA_OS_CORPUS_AUDIT_CONTRACT;
  stage: DataOsCorpusAuditStage;
  status: DataOsCorpusAuditStatus;
  ready_for_claude: boolean;
  blockers: DataOsCorpusAuditIssue[];
  warnings: DataOsCorpusAuditIssue[];
};

type Numeric = number | string;

type CorpusRow = {
  exists: boolean;
  total_records: Numeric;
  included_records: Numeric;
  excluded_records: Numeric;
  other_records: Numeric;
  completed_imports: Numeric;
  duplicate_records: Numeric;
  ingestion_deduplicated_records: Numeric;
  covered_months: Numeric;
  platforms: Numeric;
  coverage_start: string | null;
  coverage_end: string | null;
};

type CatalogRow = {
  listening_sources: Numeric;
  listening_assets: Numeric;
  listening_asset_rows: Numeric;
  active_contracts: Numeric;
  canonical_fields: Numeric;
  active_quality_rules: Numeric;
  quality_results: Numeric;
  failed_quality_results: Numeric;
  warning_quality_results: Numeric;
  source_asset_lineage: Numeric;
  source_sync_lineage: Numeric;
  import_asset_lineage: Numeric;
  import_source_lineage: Numeric;
  tb_taxonomy_terms: Numeric;
  tb_required_bindings: Numeric;
};

type ObservationRow = {
  total: Numeric;
  accepted: Numeric;
  review_required: Numeric;
  rejected: Numeric;
  listening: Numeric;
  represented_listening_records: Numeric;
  represented_listening_value: Numeric;
  invalid_currency_contract: Numeric;
  invalid_unit_contract: Numeric;
  unknown_metric_family: Numeric;
  invalid_count_value: Numeric;
  invalid_ratio_value: Numeric;
  invalid_duration_value: Numeric;
  invalid_period_contract: Numeric;
  invalid_metric_mapping: Numeric;
  invalid_product_catalog_time: Numeric;
};

type SourceMaterializationRow = {
  source_id: string;
  file_name: string;
  source_status: string;
  source_error: string | null;
  active_data_sources: Numeric;
  active_assets: Numeric;
  active_asset_rows: Numeric;
  active_contracts: Numeric;
  current_quality_results: Numeric;
  passed_quality_results: Numeric;
  warning_quality_results: Numeric;
  failed_quality_results: Numeric;
  expected_source_rows: Numeric;
  expected_materialized_rows: Numeric;
  expects_numeric_observations: boolean;
  expects_temporal_records: boolean;
  expects_snapshot_records: boolean;
  expects_snapshot_observations: boolean;
  requires_catalog_identity: boolean;
  canonical_records: Numeric;
  accepted_records: Numeric;
  review_records: Numeric;
  rejected_records: Numeric;
  temporal_records: Numeric;
  snapshot_records: Numeric;
  catalog_records: Numeric;
  accepted_catalog_identity_records: Numeric;
  complete_record_lineage: Numeric;
  accepted_observations: Numeric;
  review_observations: Numeric;
  rejected_observations: Numeric;
  temporal_observations: Numeric;
  snapshot_observations: Numeric;
  knowledge_source_lineage: Numeric;
  source_asset_lineage: Numeric;
  sync_asset_lineage: Numeric;
};

type BridgeRow = TbCodingBridgeCounts & { analysis_found: boolean };

const EXPECTED_LISTENING_FIELDS = 14;
const EXPECTED_LISTENING_QUALITY_RULES = 6;
const EXPECTED_TB_TAXONOMY_TERMS = 6;
const EXPECTED_TB_BINDINGS = 3;
const CANONICAL_METRIC_FAMILIES_SQL = sqlTextList(
  DATA_OS_METRIC_DEFINITIONS.map((definition) => definition.family)
);
const CURRENCY_METRIC_FAMILIES_SQL = metricFamiliesForUnit("currency");
const COUNT_METRIC_FAMILIES_SQL = metricFamiliesForUnit("count");
const RATIO_METRIC_FAMILIES_SQL = metricFamiliesForUnit("ratio");
const SCORE_METRIC_FAMILIES_SQL = metricFamiliesForUnit("score");
const DURATION_METRIC_FAMILIES_SQL = metricFamiliesForUnit("duration_seconds");
const RATIO_VALUE_RANGE_VIOLATION_SQL = metricValueRangeViolationSql("ratio");

export async function auditDataOsCorpus(
  execute: DataOsSqlExecutor,
  args: {
    corpusId: string;
    stage?: DataOsCorpusAuditStage;
    tbAnalysisId?: string | null;
  }
): Promise<DataOsCorpusAudit> {
  const stage = args.stage ?? "pre_analysis";
  const corpusResult = await readCorpusEvidence(execute, args.corpusId);
  const catalogResult = await readCatalogEvidence(execute, args.corpusId);
  const observationResult = await readObservationEvidence(execute, args.corpusId);
  const sourceMaterializationResult = await readSourceMaterializationEvidence(execute, args.corpusId);
  const capabilityResult = await readCapabilityEvidence(execute, args.corpusId);
  const bridgeResult = await readBridgeEvidence(execute, args.corpusId, args.tbAnalysisId ?? null);

  const corpus = normalizeCorpus(corpusResult.rows[0]);
  const catalog = normalizeCatalog(catalogResult.rows[0]);
  const observations = normalizeObservations(observationResult.rows[0]);
  const sourceMaterializations = normalizeSourceMaterializations(sourceMaterializationResult.rows);
  const capabilities = buildDataOsCapabilities({
    rows: capabilityResult.rows,
    rawListeningFallbackObservations: corpus.included_records
  });
  const bridge = normalizeBridge(bridgeResult.rows[0]);

  return evaluateDataOsCorpusAudit({
    stage,
    corpus,
    catalog,
    observations,
    source_materializations: sourceMaterializations,
    capabilities,
    tb_bridge: bridge
  });
}

export function evaluateDataOsCorpusAudit(
  evidence: DataOsCorpusAuditEvidence & { stage: DataOsCorpusAuditStage }
): DataOsCorpusAudit {
  const blockers: DataOsCorpusAuditIssue[] = [];
  const warnings: DataOsCorpusAuditIssue[] = [];
  const { corpus, catalog, observations, source_materializations: sourceMaterializations, capabilities, tb_bridge: bridge, stage } = evidence;

  addBlocker(!corpus.exists, "corpus_missing", "The study corpus does not exist.");
  addBlocker(corpus.total_records === 0, "listening_empty", "The corpus has no listening records.");
  addBlocker(corpus.included_records === 0, "listening_no_included_records", "The corpus has no included listening records.");

  addBlocker(catalog.listening_sources !== 1, "listening_source_contract", "Exactly one active canonical listening source is required.", catalog.listening_sources);
  addBlocker(catalog.listening_assets !== 1, "listening_asset_contract", "Exactly one active canonical listening asset is required.", catalog.listening_assets);
  addBlocker(catalog.listening_asset_rows !== corpus.total_records, "listening_asset_row_count", "The listening asset row count does not reconcile with the corpus.", catalog.listening_asset_rows);
  addBlocker(catalog.active_contracts !== 1, "listening_data_contract", "The canonical listening asset must have one active contract.", catalog.active_contracts);
  addBlocker(catalog.canonical_fields < EXPECTED_LISTENING_FIELDS, "listening_field_catalog", `The listening field catalog must expose at least ${EXPECTED_LISTENING_FIELDS} canonical fields.`, catalog.canonical_fields);
  addBlocker(catalog.active_quality_rules < EXPECTED_LISTENING_QUALITY_RULES, "listening_quality_rules", `The listening contract must have ${EXPECTED_LISTENING_QUALITY_RULES} active quality rules.`, catalog.active_quality_rules);
  addBlocker(catalog.quality_results < EXPECTED_LISTENING_QUALITY_RULES, "listening_quality_results", `The listening asset must have ${EXPECTED_LISTENING_QUALITY_RULES} current quality results.`, catalog.quality_results);
  addBlocker(catalog.failed_quality_results > 0, "listening_quality_failed", "One or more listening quality controls failed.", catalog.failed_quality_results);
  addBlocker(catalog.source_asset_lineage < 1, "listening_source_asset_lineage", "Listening source-to-asset lineage is missing.");
  addBlocker(catalog.source_sync_lineage < 1, "listening_source_sync_lineage", "Listening source-to-sync lineage is missing.");
  if (corpus.completed_imports > 0) {
    addBlocker(catalog.import_asset_lineage < corpus.completed_imports, "listening_import_asset_lineage", "Not every completed listening import is linked to the canonical asset.", catalog.import_asset_lineage);
    addBlocker(catalog.import_source_lineage < corpus.completed_imports, "listening_import_source_lineage", "Not every completed listening import is linked to the canonical source.", catalog.import_source_lineage);
  }

  addBlocker(observations.listening === 0, "listening_observations_missing", "Canonical monthly listening observations are missing.");
  addBlocker(observations.represented_listening_records !== corpus.included_records, "listening_observation_reconciliation", "Monthly listening observations do not represent every included mention exactly once.", observations.represented_listening_records);
  addBlocker(Math.round(observations.represented_listening_value) !== corpus.included_records, "listening_metric_reconciliation", "The monthly mention metric does not reconcile with included mentions.", Math.round(observations.represented_listening_value));

  addBlocker(observations.invalid_currency_contract > 0, "observation_currency_contract", "Accepted monetary observations have a missing/invalid currency code, or non-monetary observations carry currency.", observations.invalid_currency_contract);
  addBlocker(observations.invalid_unit_contract > 0, "observation_unit_contract", "Accepted observations have a metric-family/unit mismatch.", observations.invalid_unit_contract);
  addBlocker(observations.unknown_metric_family > 0, "observation_metric_catalog", "Accepted observations use a metric family that is absent from the canonical Data OS catalog.", observations.unknown_metric_family);
  addBlocker(observations.invalid_count_value > 0, "observation_count_contract", "Accepted count observations contain negative values.", observations.invalid_count_value);
  addBlocker(observations.invalid_ratio_value > 0, "observation_ratio_contract", "Accepted ratio observations violate the canonical range declared for their metric family.", observations.invalid_ratio_value);
  addBlocker(observations.invalid_duration_value > 0, "observation_duration_contract", "Accepted duration observations contain negative values or are not normalized to seconds.", observations.invalid_duration_value);
  addBlocker(observations.invalid_period_contract > 0, "observation_period_contract", "Accepted temporal observations have missing or unknown period semantics.", observations.invalid_period_contract);
  addBlocker(observations.invalid_metric_mapping > 0, "observation_metric_mapping", "Accepted observations contain a known metric-family misclassification.", observations.invalid_metric_mapping);
  addBlocker(observations.invalid_product_catalog_time > 0, "product_catalog_time_contract", "Product catalog rows were materialized as measurements instead of static/snapshot data.", observations.invalid_product_catalog_time);

  for (const source of sourceMaterializations.sources) {
    const label = source.file_name || source.source_id;
    addBlocker(source.source_status !== "processed", "uploaded_source_not_processed", `${label}: the uploaded source is ${source.source_status}, not processed.`);
    addBlocker(Boolean(source.source_error), "uploaded_source_failed", `${label}: ${source.source_error ?? "source processing failed"}.`);
    addBlocker(source.active_data_sources !== 1, "uploaded_source_data_source_contract", `${label}: exactly one active Data OS source is required.`, source.active_data_sources);
    addBlocker(source.active_assets !== 1, "uploaded_source_asset_contract", `${label}: exactly one active canonical asset is required.`, source.active_assets);
    addBlocker(source.active_contracts !== 1, "uploaded_source_data_contract", `${label}: exactly one active source contract is required.`, source.active_contracts);
    addBlocker(source.current_quality_results !== 1, "uploaded_source_quality_contract", `${label}: exactly one current materialization quality result is required.`, source.current_quality_results);
    addBlocker(source.failed_quality_results > 0, "uploaded_source_quality_failed", `${label}: the source materialization contract failed.`, source.failed_quality_results);
    addBlocker(source.expected_source_rows === 0, "uploaded_source_empty", `${label}: the uploaded source contains no canonical rows.`);
    addBlocker(source.expected_materialized_rows < source.expected_source_rows, "uploaded_source_truncated", `${label}: not every source row was profiled and materialized.`, source.expected_source_rows - source.expected_materialized_rows);
    addBlocker(source.canonical_records !== source.expected_materialized_rows, "uploaded_source_record_reconciliation", `${label}: canonical records do not reconcile with the materialization contract.`, source.canonical_records);
    addBlocker(source.active_asset_rows !== source.canonical_records, "uploaded_source_asset_row_count", `${label}: asset row count does not reconcile with canonical records.`, source.active_asset_rows);
    addBlocker(source.canonical_records > 0 && source.complete_record_lineage !== source.canonical_records, "uploaded_source_record_lineage", `${label}: canonical records have incomplete source/asset/sync lineage.`, source.canonical_records - source.complete_record_lineage);
    addBlocker(source.expects_numeric_observations && source.accepted_observations === 0, "uploaded_source_numeric_observations", `${label}: numeric source rows exist but no governed observation was accepted.`);
    addBlocker(source.expects_temporal_records && source.temporal_records === 0, "uploaded_source_temporal_contract", `${label}: a temporal source has no canonical period.`);
    addBlocker(source.expects_temporal_records && source.expects_numeric_observations && source.temporal_observations === 0, "uploaded_source_temporal_observations", `${label}: a longitudinal numeric source has no accepted measurement/event observations.`);
    addBlocker(source.expects_snapshot_records && source.snapshot_records === 0, "uploaded_source_snapshot_records", `${label}: a snapshot source has no accepted record with a governed capture date.`);
    addBlocker(source.expects_snapshot_observations && source.snapshot_observations === 0, "uploaded_source_snapshot_observations", `${label}: a snapshot source has no accepted observation with a governed capture date.`);
    addBlocker(source.requires_catalog_identity && source.catalog_records === 0, "uploaded_source_catalog_records", `${label}: the source contract declares a product catalog but no catalog records were materialized.`);
    addBlocker(source.requires_catalog_identity && source.accepted_catalog_identity_records === 0, "uploaded_source_catalog_identity", `${label}: product catalog records have no accepted canonical identity.`);
    addBlocker(source.knowledge_source_lineage < 1, "uploaded_source_knowledge_lineage", `${label}: knowledge source-to-Data OS source lineage is missing.`);
    addBlocker(source.source_asset_lineage < 1, "uploaded_source_asset_lineage", `${label}: Data OS source-to-asset lineage is missing.`);
    addBlocker(source.sync_asset_lineage < 1, "uploaded_source_sync_lineage", `${label}: sync-to-asset lineage is missing.`);

    addWarning(source.warning_quality_results > 0, "uploaded_source_quality_warning", `${label}: source rows are usable with materialization warnings.`, source.warning_quality_results);
    addWarning(source.review_records > 0, "uploaded_source_records_need_mapping", `${label}: some canonical records need mapping review and are not scored evidence.`, source.review_records);
    addWarning(source.rejected_records > 0, "uploaded_source_records_rejected", `${label}: some canonical records were rejected.`, source.rejected_records);
    addWarning(source.review_observations > 0, "uploaded_source_observations_need_mapping", `${label}: some numeric observations need mapping review and are not scored evidence.`, source.review_observations);
    addWarning(source.rejected_observations > 0, "uploaded_source_observations_rejected", `${label}: some numeric observations were rejected.`, source.rejected_observations);
  }

  addBlocker(catalog.tb_taxonomy_terms < EXPECTED_TB_TAXONOMY_TERMS, "tb_taxonomy_catalog", `The T&B bridge requires ${EXPECTED_TB_TAXONOMY_TERMS} active canonical taxonomy terms.`, catalog.tb_taxonomy_terms);
  addBlocker(catalog.tb_required_bindings < EXPECTED_TB_BINDINGS, "tb_taxonomy_bindings", `The T&B methodology requires ${EXPECTED_TB_BINDINGS} required taxonomy bindings.`, catalog.tb_required_bindings);

  if (stage !== "pre_analysis") {
    addBlocker(!bridge.analysis_found, "tb_analysis_missing", "No T&B analysis was found for the coding bridge audit.");
    addBlocker(!bridge.quality?.ready, "tb_coding_bridge", bridge.quality?.warnings.join(" ") || "The T&B coding bridge is not materialized.");
  }

  addWarning(catalog.warning_quality_results > 0, "listening_quality_warning", "Listening passed the hard contract with quality warnings that must remain visible to Claude and reviewers.", catalog.warning_quality_results);
  addWarning(observations.review_required > 0, "observations_need_mapping", "Some source observations require mapping review and will not be used as scored evidence.", observations.review_required);
  addWarning(observations.rejected > 0, "observations_rejected", "Some source observations were rejected by the semantic contract.", observations.rejected);
  for (const message of bridge.quality?.warnings ?? []) {
    addWarning(true, "tb_coding_bridge_warning", message);
  }

  const missing = capabilities.filter((capability) => capability.status === "missing" && capability.key !== "social_listening");
  const reviewRequired = capabilities.filter((capability) => capability.status === "review_required");
  addWarning(
    missing.length > 0,
    "optional_capabilities_missing",
    `No governed data was provided for: ${missing.map((capability) => capability.label).join(", ")}. Claude must treat those domains as unknown, not zero.`
  );
  addWarning(
    reviewRequired.length > 0,
    "capabilities_need_mapping",
    `Data exists but is not accepted for: ${reviewRequired.map((capability) => capability.label).join(", ")}.`
  );

  const listeningCapability = capabilities.find((capability) => capability.key === "social_listening");
  addBlocker(
    !listeningCapability || listeningCapability.status !== "available" || listeningCapability.evidence_source !== "data_observations",
    "listening_capability_not_governed",
    "Social listening must be available through governed Data OS observations before Claude runs."
  );

  const status: DataOsCorpusAuditStatus = blockers.length > 0
    ? "blocked"
    : warnings.length > 0
      ? "ready_with_warnings"
      : "ready";

  return {
    contract: DATA_OS_CORPUS_AUDIT_CONTRACT,
    stage,
    status,
    ready_for_claude: blockers.length === 0,
    blockers,
    warnings,
    corpus,
    catalog,
    observations,
    source_materializations: sourceMaterializations,
    capabilities,
    tb_bridge: bridge
  };

  function addBlocker(condition: boolean, code: string, message: string, count?: number) {
    if (condition) blockers.push(issue(code, message, count));
  }

  function addWarning(condition: boolean, code: string, message: string, count?: number) {
    if (condition) warnings.push(issue(code, message, count));
  }
}

async function readCorpusEvidence(execute: DataOsSqlExecutor, corpusId: string) {
  return execute<CorpusRow>(
    `
      SELECT
        EXISTS (SELECT 1 FROM study_corpora WHERE id = $1::uuid) AS exists,
        COUNT(m.id)::int AS total_records,
        COUNT(m.id) FILTER (WHERE m.inclusion_status = 'included')::int AS included_records,
        COUNT(m.id) FILTER (WHERE m.inclusion_status = 'excluded')::int AS excluded_records,
        COUNT(m.id) FILTER (WHERE m.inclusion_status NOT IN ('included', 'excluded') OR m.inclusion_status IS NULL)::int AS other_records,
        (SELECT COUNT(*)::int FROM import_batches batch
          WHERE batch.study_corpus_id = $1::uuid
            AND batch.status = 'completed'
            AND batch.source_system IN ('listening_csv', 'social_listening_csv', 'sentione_csv', 'sentione')) AS completed_imports,
        GREATEST(COUNT(m.id) - COUNT(DISTINCT m.text_hash), 0)::int AS duplicate_records,
        COALESCE((SELECT SUM(COALESCE(batch.duplicate_count, 0))::int FROM import_batches batch
          WHERE batch.study_corpus_id = $1::uuid
            AND batch.status = 'completed'
            AND batch.source_system IN ('listening_csv', 'social_listening_csv', 'sentione_csv', 'sentione')), 0) AS ingestion_deduplicated_records,
        COUNT(DISTINCT date_trunc('month', m.published_at)) FILTER (WHERE m.inclusion_status = 'included')::int AS covered_months,
        COUNT(DISTINCT NULLIF(BTRIM(m.platform), '')) FILTER (WHERE m.inclusion_status = 'included')::int AS platforms,
        (MIN(m.published_at) FILTER (WHERE m.inclusion_status = 'included'))::date::text AS coverage_start,
        (MAX(m.published_at) FILTER (WHERE m.inclusion_status = 'included'))::date::text AS coverage_end
      FROM mentions m
      WHERE m.study_corpus_id = $1::uuid
    `,
    [corpusId]
  );
}

async function readCatalogEvidence(execute: DataOsSqlExecutor, corpusId: string) {
  return execute<CatalogRow>(
    `
      WITH listening_sources AS (
        SELECT id
        FROM data_sources
        WHERE study_corpus_id = $1::uuid
          AND source_type = 'social_listening'
          AND provider = 'portable_listening_import'
          AND status = 'active'
      ),
      listening_assets AS (
        SELECT asset.id, asset.row_count
        FROM data_assets asset
        WHERE asset.study_corpus_id = $1::uuid
          AND asset.name = 'Listening mentions'
          AND asset.layer = 'curated'
          AND asset.status = 'active'
      ),
      listening_contracts AS (
        SELECT contract.id
        FROM data_contracts contract
        JOIN listening_assets asset ON asset.id = contract.data_asset_id
        WHERE contract.contract_name = 'canonical_social_listening'
          AND contract.status = 'active'
      )
      SELECT
        (SELECT COUNT(*) FROM listening_sources)::int AS listening_sources,
        (SELECT COUNT(*) FROM listening_assets)::int AS listening_assets,
        COALESCE((SELECT SUM(COALESCE(row_count, 0)) FROM listening_assets), 0)::int AS listening_asset_rows,
        (SELECT COUNT(*) FROM listening_contracts)::int AS active_contracts,
        (SELECT COUNT(*) FROM data_asset_fields field JOIN listening_assets asset ON asset.id = field.data_asset_id)::int AS canonical_fields,
        (SELECT COUNT(*) FROM data_quality_rules rule JOIN listening_contracts contract ON contract.id = rule.data_contract_id WHERE rule.active)::int AS active_quality_rules,
        (SELECT COUNT(*) FROM data_quality_results result JOIN listening_assets asset ON asset.id = result.data_asset_id)::int AS quality_results,
        (SELECT COUNT(*) FROM data_quality_results result JOIN listening_assets asset ON asset.id = result.data_asset_id WHERE result.status = 'failed')::int AS failed_quality_results,
        (SELECT COUNT(*) FROM data_quality_results result JOIN listening_assets asset ON asset.id = result.data_asset_id WHERE result.status = 'warning')::int AS warning_quality_results,
        (SELECT COUNT(*) FROM lineage_edges edge JOIN listening_sources source ON edge.source_type = 'data_source' AND edge.source_id = source.id JOIN listening_assets asset ON edge.target_type = 'data_asset' AND edge.target_id = asset.id WHERE edge.relation_type = 'materializes')::int AS source_asset_lineage,
        (SELECT COUNT(*) FROM lineage_edges edge JOIN listening_sources source ON edge.source_type = 'data_source' AND edge.source_id = source.id WHERE edge.target_type = 'source_sync_run' AND edge.relation_type = 'reconciled_by')::int AS source_sync_lineage,
        (SELECT COUNT(*) FROM lineage_edges edge JOIN listening_assets asset ON edge.target_type = 'data_asset' AND edge.target_id = asset.id WHERE edge.source_type = 'import_batch' AND edge.relation_type = 'contributes_to')::int AS import_asset_lineage,
        (SELECT COUNT(*) FROM lineage_edges edge JOIN listening_sources source ON edge.target_type = 'data_source' AND edge.target_id = source.id WHERE edge.source_type = 'import_batch' AND edge.relation_type = 'ingested_into')::int AS import_source_lineage,
        (SELECT COUNT(*) FROM taxonomy_terms term JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id WHERE taxonomy.taxonomy_key IN ('trigger', 'barrier', 'tb_layer') AND taxonomy.status = 'active' AND term.status = 'active')::int AS tb_taxonomy_terms,
        (SELECT COUNT(*) FROM methodology_taxonomy_bindings binding JOIN taxonomies taxonomy ON taxonomy.id = binding.taxonomy_id WHERE binding.methodology_slug = 'triggers-barriers' AND binding.required AND taxonomy.taxonomy_key IN ('trigger', 'barrier', 'tb_layer'))::int AS tb_required_bindings
    `,
    [corpusId]
  );
}

async function readObservationEvidence(execute: DataOsSqlExecutor, corpusId: string) {
  return execute<ObservationRow>(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE quality_status = 'accepted')::int AS accepted,
        COUNT(*) FILTER (WHERE quality_status = 'needs_mapping_review')::int AS review_required,
        COUNT(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE dataset_role = 'social_listening')::int AS listening,
        COALESCE(SUM(CASE
          WHEN dataset_role = 'social_listening'
            AND metric_key = 'mentions_monthly'
            AND quality_status = 'accepted'
            AND raw_record->>'records' ~ '^[0-9]+$'
          THEN (raw_record->>'records')::int ELSE 0 END), 0)::int AS represented_listening_records,
        COALESCE(SUM(CASE
          WHEN dataset_role = 'social_listening'
            AND metric_key = 'mentions_monthly'
            AND quality_status = 'accepted'
          THEN metric_value ELSE 0 END), 0)::numeric AS represented_listening_value,
        COUNT(*) FILTER (WHERE quality_status = 'accepted' AND (
          (metric_family IN (${CURRENCY_METRIC_FAMILIES_SQL})
            AND (metric_unit IS DISTINCT FROM 'currency' OR metric_currency_code IS NULL OR metric_currency_code !~ '^[A-Z]{3}$'))
          OR
          (metric_family NOT IN (${CURRENCY_METRIC_FAMILIES_SQL})
            AND (metric_unit = 'currency' OR metric_currency_code IS NOT NULL))
        ))::int AS invalid_currency_contract,
        COUNT(*) FILTER (WHERE quality_status = 'accepted' AND (
          (metric_family IN (${COUNT_METRIC_FAMILIES_SQL}) AND metric_unit IS DISTINCT FROM 'count')
          OR (metric_family IN (${CURRENCY_METRIC_FAMILIES_SQL}) AND metric_unit IS DISTINCT FROM 'currency')
          OR (metric_family IN (${RATIO_METRIC_FAMILIES_SQL}) AND metric_unit IS DISTINCT FROM 'ratio')
          OR (metric_family IN (${SCORE_METRIC_FAMILIES_SQL}) AND metric_unit IS DISTINCT FROM 'score')
          OR (metric_family IN (${DURATION_METRIC_FAMILIES_SQL}) AND metric_unit IS DISTINCT FROM 'duration_seconds')
        ))::int AS invalid_unit_contract,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND (metric_family IS NULL OR metric_family NOT IN (${CANONICAL_METRIC_FAMILIES_SQL})))::int AS unknown_metric_family,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND metric_family IN (${COUNT_METRIC_FAMILIES_SQL})
          AND metric_value < 0)::int AS invalid_count_value,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND (${RATIO_VALUE_RANGE_VIOLATION_SQL}))::int AS invalid_ratio_value,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND metric_family IN (${DURATION_METRIC_FAMILIES_SQL})
          AND (metric_unit IS DISTINCT FROM 'duration_seconds' OR metric_value < 0))::int AS invalid_duration_value,
        COUNT(*) FILTER (WHERE quality_status = 'accepted' AND (
          period_semantics = 'unknown'
          OR (period_semantics IN ('measurement', 'event', 'snapshot') AND period_start IS NULL)
        ))::int AS invalid_period_contract,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND metric_family = 'support_tickets'
          AND lower(metric_key) ~ '(ticket.*(promedio|average|medio)|average.*ticket|aov)')::int AS invalid_metric_mapping,
        COUNT(*) FILTER (WHERE quality_status = 'accepted'
          AND dataset_role = 'product_catalog'
          AND period_semantics IN ('measurement', 'event'))::int AS invalid_product_catalog_time
      FROM data_observations
      WHERE study_corpus_id = $1::uuid
    `,
    [corpusId]
  );
}

async function readSourceMaterializationEvidence(execute: DataOsSqlExecutor, corpusId: string) {
  return execute<SourceMaterializationRow>(
    `
      WITH uploaded_sources AS (
        SELECT
          source.id,
          COALESCE(source.original_file_name, source.title, source.id::text) AS file_name,
          COALESCE(NULLIF(BTRIM(source.status), ''), 'unknown') AS source_status,
          source.error_message
        FROM brand_knowledge_sources source
        WHERE source.study_corpus_id = $1::uuid
          AND source.original_file_name IS NOT NULL
      )
      SELECT
        source.id::text AS source_id,
        source.file_name,
        source.source_status,
        source.error_message AS source_error,
        COALESCE(data_source.active_data_sources, 0)::int AS active_data_sources,
        COALESCE(asset.active_assets, 0)::int AS active_assets,
        COALESCE(asset.active_asset_rows, 0)::int AS active_asset_rows,
        COALESCE(contract.active_contracts, 0)::int AS active_contracts,
        COALESCE(quality.current_quality_results, 0)::int AS current_quality_results,
        COALESCE(quality.passed_quality_results, 0)::int AS passed_quality_results,
        COALESCE(quality.warning_quality_results, 0)::int AS warning_quality_results,
        COALESCE(quality.failed_quality_results, 0)::int AS failed_quality_results,
        COALESCE(quality.expected_source_rows, 0)::int AS expected_source_rows,
        COALESCE(quality.expected_materialized_rows, 0)::int AS expected_materialized_rows,
        COALESCE(quality.expects_numeric_observations, false) AS expects_numeric_observations,
        COALESCE(quality.expects_temporal_records, false) AS expects_temporal_records,
        COALESCE(quality.expects_snapshot_records, false) AS expects_snapshot_records,
        COALESCE(quality.expects_snapshot_observations, false) AS expects_snapshot_observations,
        COALESCE(quality.requires_catalog_identity, false) AS requires_catalog_identity,
        COALESCE(record.canonical_records, 0)::int AS canonical_records,
        COALESCE(record.accepted_records, 0)::int AS accepted_records,
        COALESCE(record.review_records, 0)::int AS review_records,
        COALESCE(record.rejected_records, 0)::int AS rejected_records,
        COALESCE(record.temporal_records, 0)::int AS temporal_records,
        COALESCE(record.snapshot_records, 0)::int AS snapshot_records,
        COALESCE(record.catalog_records, 0)::int AS catalog_records,
        COALESCE(record.accepted_catalog_identity_records, 0)::int AS accepted_catalog_identity_records,
        COALESCE(record.complete_record_lineage, 0)::int AS complete_record_lineage,
        COALESCE(observation.accepted_observations, 0)::int AS accepted_observations,
        COALESCE(observation.review_observations, 0)::int AS review_observations,
        COALESCE(observation.rejected_observations, 0)::int AS rejected_observations,
        COALESCE(observation.temporal_observations, 0)::int AS temporal_observations,
        COALESCE(observation.snapshot_observations, 0)::int AS snapshot_observations,
        COALESCE(lineage.knowledge_source_lineage, 0)::int AS knowledge_source_lineage,
        COALESCE(lineage.source_asset_lineage, 0)::int AS source_asset_lineage,
        COALESCE(lineage.sync_asset_lineage, 0)::int AS sync_asset_lineage
      FROM uploaded_sources source
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_data_sources
        FROM data_sources item
        WHERE item.study_corpus_id = $1::uuid
          AND item.status = 'active'
          AND item.mapping->>'knowledge_source_id' = source.id::text
      ) data_source ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS active_assets,
          COALESCE(SUM(COALESCE(item.row_count, 0)), 0)::int AS active_asset_rows
        FROM data_assets item
        WHERE item.study_corpus_id = $1::uuid
          AND item.status = 'active'
          AND item.metadata->>'knowledge_source_id' = source.id::text
      ) asset ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_contracts
        FROM data_contracts item
        JOIN data_assets target ON target.id = item.data_asset_id
        WHERE target.study_corpus_id = $1::uuid
          AND target.status = 'active'
          AND target.metadata->>'knowledge_source_id' = source.id::text
          AND item.contract_name = 'study_source_contract'
          AND item.status = 'active'
      ) contract ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS current_quality_results,
          COUNT(*) FILTER (WHERE item.status IN ('pass', 'passed'))::int AS passed_quality_results,
          COUNT(*) FILTER (WHERE item.status IN ('warn', 'warning'))::int AS warning_quality_results,
          COUNT(*) FILTER (WHERE item.status IN ('fail', 'failed'))::int AS failed_quality_results,
          COALESCE(SUM(CASE
            WHEN item.expected_value->>'sourceRows' ~ '^[0-9]+$'
              THEN (item.expected_value->>'sourceRows')::int
            ELSE 0 END), 0)::int AS expected_source_rows,
          COALESCE(SUM(CASE
            WHEN item.expected_value->>'materializedRows' ~ '^[0-9]+$'
              THEN (item.expected_value->>'materializedRows')::int
            ELSE 0 END), 0)::int AS expected_materialized_rows,
          BOOL_OR(item.expected_value #>> '{source_materialization_contract,expectsNumericObservations}' = 'true') AS expects_numeric_observations,
          BOOL_OR(item.expected_value #>> '{source_materialization_contract,expectsTemporalRecords}' = 'true') AS expects_temporal_records,
          BOOL_OR(item.expected_value #>> '{source_materialization_contract,expectsSnapshotRecords}' = 'true') AS expects_snapshot_records,
          BOOL_OR(item.expected_value #>> '{source_materialization_contract,expectsSnapshotObservations}' = 'true') AS expects_snapshot_observations,
          BOOL_OR(item.expected_value #>> '{source_materialization_contract,requiresCatalogIdentity}' = 'true') AS requires_catalog_identity
        FROM data_quality_results item
        JOIN data_assets target ON target.id = item.data_asset_id
        WHERE target.study_corpus_id = $1::uuid
          AND target.status = 'active'
          AND target.metadata->>'knowledge_source_id' = source.id::text
          AND item.result_key = 'materialization_contract'
      ) quality ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS canonical_records,
          COUNT(*) FILTER (WHERE item.quality_status = 'accepted')::int AS accepted_records,
          COUNT(*) FILTER (WHERE item.quality_status = 'needs_mapping_review')::int AS review_records,
          COUNT(*) FILTER (WHERE item.quality_status = 'rejected')::int AS rejected_records,
          COUNT(*) FILTER (
            WHERE item.quality_status = 'accepted'
              AND item.period_semantics IN ('measurement', 'event')
              AND item.period_start IS NOT NULL
          )::int AS temporal_records,
          COUNT(*) FILTER (
            WHERE item.quality_status = 'accepted'
              AND item.period_semantics = 'snapshot'
              AND item.period_start IS NOT NULL
          )::int AS snapshot_records,
          COUNT(*) FILTER (WHERE item.dataset_role = 'product_catalog')::int AS catalog_records,
          COUNT(*) FILTER (
            WHERE item.dataset_role = 'product_catalog'
              AND item.quality_status = 'accepted'
              AND NULLIF(BTRIM(item.entity_key), '') IS NOT NULL
          )::int AS accepted_catalog_identity_records,
          COUNT(*) FILTER (
            WHERE item.data_source_id IS NOT NULL
              AND item.data_asset_id IS NOT NULL
              AND item.source_sync_run_id IS NOT NULL
              AND item.lineage->>'canonical_target' = 'data_asset_records'
          )::int AS complete_record_lineage
        FROM data_asset_records item
        WHERE item.study_corpus_id = $1::uuid
          AND item.knowledge_source_id = source.id
      ) record ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE item.quality_status = 'accepted')::int AS accepted_observations,
          COUNT(*) FILTER (WHERE item.quality_status = 'needs_mapping_review')::int AS review_observations,
          COUNT(*) FILTER (WHERE item.quality_status = 'rejected')::int AS rejected_observations,
          COUNT(*) FILTER (
            WHERE item.quality_status = 'accepted'
              AND item.period_semantics IN ('measurement', 'event')
              AND item.period_start IS NOT NULL
          )::int AS temporal_observations,
          COUNT(*) FILTER (
            WHERE item.quality_status = 'accepted'
              AND item.period_semantics = 'snapshot'
              AND item.period_start IS NOT NULL
          )::int AS snapshot_observations
        FROM data_observations item
        WHERE item.study_corpus_id = $1::uuid
          AND item.knowledge_source_id = source.id
      ) observation ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE edge.source_type = 'brand_knowledge_source'
              AND edge.source_id = source.id
              AND edge.target_type = 'data_source'
              AND edge.relation_type = 'ingested_into'
          )::int AS knowledge_source_lineage,
          COUNT(*) FILTER (
            WHERE edge.source_type = 'data_source'
              AND edge.target_type = 'data_asset'
              AND edge.relation_type = 'materializes'
              AND EXISTS (
                SELECT 1 FROM data_sources source_item
                WHERE source_item.id = edge.source_id
                  AND source_item.mapping->>'knowledge_source_id' = source.id::text
              )
          )::int AS source_asset_lineage,
          COUNT(*) FILTER (
            WHERE edge.source_type = 'source_sync_run'
              AND edge.target_type = 'data_asset'
              AND edge.relation_type = 'materializes'
              AND EXISTS (
                SELECT 1
                FROM source_sync_runs sync
                JOIN data_sources source_item ON source_item.id = sync.data_source_id
                WHERE sync.id = edge.source_id
                  AND source_item.mapping->>'knowledge_source_id' = source.id::text
              )
          )::int AS sync_asset_lineage
        FROM lineage_edges edge
        WHERE edge.source_id = source.id
          OR EXISTS (
            SELECT 1
            FROM data_sources source_item
            WHERE source_item.mapping->>'knowledge_source_id' = source.id::text
              AND (edge.source_id = source_item.id OR edge.target_id = source_item.id)
          )
          OR EXISTS (
            SELECT 1
            FROM data_assets asset_item
            WHERE asset_item.metadata->>'knowledge_source_id' = source.id::text
              AND edge.target_id = asset_item.id
          )
      ) lineage ON true
      ORDER BY source.file_name, source.id
    `,
    [corpusId]
  );
}

async function readCapabilityEvidence(execute: DataOsSqlExecutor, corpusId: string) {
  return execute<DataOsCapabilityRow>(DATA_OS_CAPABILITY_ROLLUP_SQL, [corpusId]);
}

async function readBridgeEvidence(
  execute: DataOsSqlExecutor,
  corpusId: string,
  tbAnalysisId: string | null
) {
  return execute<BridgeRow>(
    `
      WITH target AS (
        SELECT analysis.id
        FROM tb_analyses analysis
        WHERE analysis.study_corpus_id = $1::uuid
          AND ($2::uuid IS NULL OR analysis.id = $2::uuid)
        ORDER BY analysis.created_at DESC, analysis.id DESC
        LIMIT 1
      ),
      coding_by_mention AS (
        SELECT
          coding.mention_id,
          COUNT(*)::int AS codings,
          bool_or(coding.polarity <> 'irrelevant') AS non_irrelevant,
          bool_or(coding.ambiguous) AS ambiguous,
          bool_or(coding.polarity <> 'irrelevant' AND coding.layer IS NOT NULL) AS has_layer,
          bool_or(coding.polarity <> 'irrelevant' AND EXISTS (
            SELECT 1
            FROM unnest(COALESCE(coding.emergent_tags, ARRAY[]::text[])) AS emergent(tag)
            WHERE BTRIM(emergent.tag) <> '' AND lower(BTRIM(emergent.tag)) <> 'irrelevant'
          )) AS has_emergent_tag,
          bool_or(coding.polarity <> 'irrelevant' AND coding.finding_id IS NOT NULL) AS has_finding
        FROM tb_mention_codings coding
        JOIN target ON target.id = coding.tb_analysis_id
        GROUP BY coding.mention_id
      ),
      coding AS (
        SELECT
          COALESCE(SUM(codings), 0)::int AS codings,
          COUNT(*)::int AS coded_mentions,
          COUNT(*) FILTER (WHERE non_irrelevant)::int AS non_irrelevant_mentions,
          COUNT(*) FILTER (WHERE ambiguous)::int AS ambiguous_mentions,
          COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_layer)::int AS missing_layer_mentions,
          COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_emergent_tag)::int AS missing_emergent_tag_mentions,
          COUNT(*) FILTER (WHERE non_irrelevant AND NOT has_finding)::int AS unlinked_finding_mentions
        FROM coding_by_mention
      ),
      tags AS (
        SELECT
          COUNT(*)::int AS record_tags,
          COUNT(DISTINCT tag.subject_id) FILTER (WHERE taxonomy.taxonomy_key IN ('trigger', 'barrier'))::int AS polarity_tagged_mentions,
          COUNT(DISTINCT tag.subject_id) FILTER (WHERE taxonomy.taxonomy_key = 'tb_layer')::int AS layer_tagged_mentions,
          COUNT(*) FILTER (WHERE taxonomy.taxonomy_key IN ('trigger', 'barrier') AND tag.evidence @> '[{"candidate":true}]'::jsonb)::int AS emergent_candidate_tags
        FROM record_tags tag
        JOIN target ON target.id = tag.tb_analysis_id
        JOIN taxonomy_terms term ON term.id = tag.taxonomy_term_id
        JOIN taxonomies taxonomy ON taxonomy.id = term.taxonomy_id
      ),
      features AS (
        SELECT COUNT(*)::int AS record_features
        FROM record_feature_values feature
        JOIN target ON target.id = feature.tb_analysis_id
        WHERE feature.feature_key = 'tb_coding'
      ),
      lineage AS (
        SELECT
          COUNT(*) FILTER (
            WHERE edge.source_type = 'tb_mention_coding'
              AND edge.target_type = 'record_tag'
              AND edge.relation_type = 'materializes_as'
          )::int AS tag_lineage_edges,
          COUNT(*) FILTER (
            WHERE edge.source_type = 'tb_mention_coding'
              AND edge.target_type = 'record_feature_value'
              AND edge.relation_type = 'materializes_as'
          )::int AS feature_lineage_edges,
          COUNT(*)::int AS lineage_edges
        FROM lineage_edges edge
        JOIN target ON edge.metadata @> jsonb_build_object('tb_analysis_id', target.id)
      )
      SELECT
        EXISTS (SELECT 1 FROM target) AS analysis_found,
        coding.codings,
        coding.coded_mentions,
        coding.non_irrelevant_mentions,
        coding.ambiguous_mentions,
        coding.missing_layer_mentions,
        coding.missing_emergent_tag_mentions,
        coding.unlinked_finding_mentions,
        tags.record_tags,
        features.record_features,
        tags.polarity_tagged_mentions,
        tags.layer_tagged_mentions,
        tags.emergent_candidate_tags,
        lineage.tag_lineage_edges,
        lineage.feature_lineage_edges,
        lineage.lineage_edges
      FROM coding CROSS JOIN tags CROSS JOIN features CROSS JOIN lineage
    `,
    [corpusId, tbAnalysisId]
  );
}

function normalizeCorpus(row?: CorpusRow): DataOsCorpusAuditEvidence["corpus"] {
  return {
    exists: row?.exists === true,
    total_records: numeric(row?.total_records),
    included_records: numeric(row?.included_records),
    excluded_records: numeric(row?.excluded_records),
    other_records: numeric(row?.other_records),
    completed_imports: numeric(row?.completed_imports),
    duplicate_records: numeric(row?.duplicate_records),
    ingestion_deduplicated_records: numeric(row?.ingestion_deduplicated_records),
    covered_months: numeric(row?.covered_months),
    platforms: numeric(row?.platforms),
    coverage_start: row?.coverage_start ?? null,
    coverage_end: row?.coverage_end ?? null
  };
}

function normalizeCatalog(row?: CatalogRow): DataOsCorpusAuditEvidence["catalog"] {
  return {
    listening_sources: numeric(row?.listening_sources),
    listening_assets: numeric(row?.listening_assets),
    listening_asset_rows: numeric(row?.listening_asset_rows),
    active_contracts: numeric(row?.active_contracts),
    canonical_fields: numeric(row?.canonical_fields),
    active_quality_rules: numeric(row?.active_quality_rules),
    quality_results: numeric(row?.quality_results),
    failed_quality_results: numeric(row?.failed_quality_results),
    warning_quality_results: numeric(row?.warning_quality_results),
    source_asset_lineage: numeric(row?.source_asset_lineage),
    source_sync_lineage: numeric(row?.source_sync_lineage),
    import_asset_lineage: numeric(row?.import_asset_lineage),
    import_source_lineage: numeric(row?.import_source_lineage),
    tb_taxonomy_terms: numeric(row?.tb_taxonomy_terms),
    tb_required_bindings: numeric(row?.tb_required_bindings)
  };
}

function normalizeObservations(row?: ObservationRow): DataOsCorpusAuditEvidence["observations"] {
  return {
    total: numeric(row?.total),
    accepted: numeric(row?.accepted),
    review_required: numeric(row?.review_required),
    rejected: numeric(row?.rejected),
    listening: numeric(row?.listening),
    represented_listening_records: numeric(row?.represented_listening_records),
    represented_listening_value: numeric(row?.represented_listening_value),
    invalid_currency_contract: numeric(row?.invalid_currency_contract),
    invalid_unit_contract: numeric(row?.invalid_unit_contract),
    unknown_metric_family: numeric(row?.unknown_metric_family),
    invalid_count_value: numeric(row?.invalid_count_value),
    invalid_ratio_value: numeric(row?.invalid_ratio_value),
    invalid_duration_value: numeric(row?.invalid_duration_value),
    invalid_period_contract: numeric(row?.invalid_period_contract),
    invalid_metric_mapping: numeric(row?.invalid_metric_mapping),
    invalid_product_catalog_time: numeric(row?.invalid_product_catalog_time)
  };
}

function normalizeSourceMaterializations(
  rows: SourceMaterializationRow[]
): DataOsCorpusAuditEvidence["source_materializations"] {
  const sources = rows.map<DataOsSourceMaterializationEvidence>((row) => ({
    source_id: row.source_id,
    file_name: row.file_name,
    source_status: row.source_status,
    source_error: row.source_error ?? null,
    active_data_sources: numeric(row.active_data_sources),
    active_assets: numeric(row.active_assets),
    active_asset_rows: numeric(row.active_asset_rows),
    active_contracts: numeric(row.active_contracts),
    current_quality_results: numeric(row.current_quality_results),
    passed_quality_results: numeric(row.passed_quality_results),
    warning_quality_results: numeric(row.warning_quality_results),
    failed_quality_results: numeric(row.failed_quality_results),
    expected_source_rows: numeric(row.expected_source_rows),
    expected_materialized_rows: numeric(row.expected_materialized_rows),
    expects_numeric_observations: row.expects_numeric_observations === true,
    expects_temporal_records: row.expects_temporal_records === true,
    expects_snapshot_records: row.expects_snapshot_records === true,
    expects_snapshot_observations: row.expects_snapshot_observations === true,
    requires_catalog_identity: row.requires_catalog_identity === true,
    canonical_records: numeric(row.canonical_records),
    accepted_records: numeric(row.accepted_records),
    review_records: numeric(row.review_records),
    rejected_records: numeric(row.rejected_records),
    temporal_records: numeric(row.temporal_records),
    snapshot_records: numeric(row.snapshot_records),
    catalog_records: numeric(row.catalog_records),
    accepted_catalog_identity_records: numeric(row.accepted_catalog_identity_records),
    complete_record_lineage: numeric(row.complete_record_lineage),
    accepted_observations: numeric(row.accepted_observations),
    review_observations: numeric(row.review_observations),
    rejected_observations: numeric(row.rejected_observations),
    temporal_observations: numeric(row.temporal_observations),
    snapshot_observations: numeric(row.snapshot_observations),
    knowledge_source_lineage: numeric(row.knowledge_source_lineage),
    source_asset_lineage: numeric(row.source_asset_lineage),
    sync_asset_lineage: numeric(row.sync_asset_lineage)
  }));

  return {
    uploaded_sources: sources.length,
    processed_sources: sources.filter((source) => source.source_status === "processed").length,
    pending_sources: sources.filter((source) => ["pending", "processing", "profiled"].includes(source.source_status)).length,
    failed_sources: sources.filter((source) => source.source_status === "failed" || Boolean(source.source_error)).length,
    canonical_records: sources.reduce((total, source) => total + source.canonical_records, 0),
    accepted_records: sources.reduce((total, source) => total + source.accepted_records, 0),
    review_records: sources.reduce((total, source) => total + source.review_records, 0),
    rejected_records: sources.reduce((total, source) => total + source.rejected_records, 0),
    accepted_observations: sources.reduce((total, source) => total + source.accepted_observations, 0),
    warning_quality_results: sources.reduce((total, source) => total + source.warning_quality_results, 0),
    failed_quality_results: sources.reduce((total, source) => total + source.failed_quality_results, 0),
    sources
  };
}

function normalizeBridge(row?: BridgeRow): DataOsCorpusAuditEvidence["tb_bridge"] {
  const counts: TbCodingBridgeCounts = {
    codings: numeric(row?.codings),
    coded_mentions: numeric(row?.coded_mentions),
    non_irrelevant_mentions: numeric(row?.non_irrelevant_mentions),
    ambiguous_mentions: numeric(row?.ambiguous_mentions),
    missing_layer_mentions: numeric(row?.missing_layer_mentions),
    missing_emergent_tag_mentions: numeric(row?.missing_emergent_tag_mentions),
    unlinked_finding_mentions: numeric(row?.unlinked_finding_mentions),
    record_tags: numeric(row?.record_tags),
    record_features: numeric(row?.record_features),
    polarity_tagged_mentions: numeric(row?.polarity_tagged_mentions),
    layer_tagged_mentions: numeric(row?.layer_tagged_mentions),
    emergent_candidate_tags: numeric(row?.emergent_candidate_tags),
    tag_lineage_edges: numeric(row?.tag_lineage_edges),
    feature_lineage_edges: numeric(row?.feature_lineage_edges),
    lineage_edges: numeric(row?.lineage_edges)
  };
  const analysisFound = row?.analysis_found === true;
  return {
    analysis_found: analysisFound,
    counts,
    quality: analysisFound && counts.codings > 0
      ? assessTbCodingBridgeQuality(counts, "reconcile")
      : null
  };
}

function issue(code: string, message: string, count?: number): DataOsCorpusAuditIssue {
  return count === undefined ? { code, message } : { code, message, count };
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricFamiliesForUnit(unit: (typeof DATA_OS_METRIC_DEFINITIONS)[number]["unit"]) {
  return sqlTextList(
    DATA_OS_METRIC_DEFINITIONS
      .filter((definition) => definition.unit === unit)
      .map((definition) => definition.family)
  );
}

function metricValueRangeViolationSql(unit: (typeof DATA_OS_METRIC_DEFINITIONS)[number]["unit"]) {
  const predicates = DATA_OS_METRIC_DEFINITIONS
    .filter((definition) => definition.unit === unit && definition.validRange)
    .map((definition) => {
      const family = definition.family.replaceAll("'", "''");
      const bounds: string[] = [];
      if (definition.validRange?.min !== undefined) bounds.push(`metric_value < ${definition.validRange.min}`);
      if (definition.validRange?.max !== undefined) bounds.push(`metric_value > ${definition.validRange.max}`);
      return `(metric_family = '${family}' AND (${bounds.join(" OR ")}))`;
    });
  if (predicates.length === 0) throw new Error(`Data OS metric catalog has no declared value ranges for ${unit}.`);
  return predicates.join(" OR ");
}

function sqlTextList(values: string[]) {
  if (values.length === 0) throw new Error("Data OS metric catalog cannot contain an empty SQL unit group.");
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
