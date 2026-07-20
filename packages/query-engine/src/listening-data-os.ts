export const LISTENING_DATA_OS_CONTRACT_VERSION = 1;
export const LISTENING_DATA_OS_SOURCE_PROVIDER = "portable_listening_import";
export const LISTENING_DATA_OS_ASSET_NAME = "Listening mentions";
export const LISTENING_DATA_OS_DATASET_KEY = "listening_monthly";
export const LISTENING_DATA_OS_DATASET_ROLE = "social_listening";
export const LISTENING_NUMERIC_SENTIMENT_SQL = "m.sentiment_score::numeric";

export type DataOsSqlResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number | null;
};

export type DataOsSqlExecutor = <Row extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<DataOsSqlResult<Row>>;

export type ListeningQualityStatus = "passed" | "warning" | "failed";

export type ListeningDataQualityInput = {
  totalRecords: number;
  includedRecords: number;
  excludedRecords: number;
  duplicateRecords: number;
  missingTextRecords: number;
  missingDateRecords: number;
  missingPlatformRecords: number;
  coveredMonths: number;
};

export type ListeningDataQualityResult = {
  status: ListeningQualityStatus;
  readyForAnalysis: boolean;
  metrics: {
    textCompleteness: number;
    dateCompleteness: number;
    platformCompleteness: number;
    duplicateRate: number;
    inclusionRate: number;
  };
  blockers: string[];
  warnings: string[];
};

export type ListeningDataOsReconciliation = {
  corpusId: string;
  dataSourceId: string;
  dataAssetId: string;
  sourceSyncRunId: string;
  contractId: string;
  quality: ListeningDataQualityResult;
  counts: {
    total: number;
    included: number;
    excluded: number;
    duplicates: number;
    deduplicatedDuringIngestion: number;
    months: number;
    platforms: number;
    observations: number;
    commercialObservations: number;
  };
  coverage: {
    start: string | null;
    end: string | null;
  };
  capabilities: {
    canonicalMentionRecords: true;
    listeningMonthlySeries: boolean;
    commercialJoinAvailable: boolean;
  };
};

type CorpusScopeRow = {
  corpus_id: string;
  organization_id: string | null;
  brand_id: string | null;
  theme_id: string | null;
  subject_name: string;
};

type IdRow = { id: string };

type ListeningStatsRow = {
  total_records: number | string;
  included_records: number | string;
  excluded_records: number | string;
  duplicate_records: number | string;
  ingestion_deduplicated_records: number | string;
  invalid_records: number | string;
  missing_text_records: number | string;
  missing_date_records: number | string;
  missing_platform_records: number | string;
  covered_months: number | string;
  platforms: number | string;
  coverage_start: string | null;
  coverage_end: string | null;
};

type CountRow = { count: number | string };

const LISTENING_FIELDS = [
  ["id", "uuid", "record_id", false, "Canonical mention identifier"],
  ["import_batch_id", "uuid", "lineage_reference", true, "Import batch that introduced the record"],
  ["external_id", "text", "source_record_id", false, "Provider or file record identifier"],
  ["text_clean", "text", "content", false, "Normalized mention text"],
  ["published_at", "timestamptz", "event_time", false, "Business event timestamp"],
  ["platform", "text", "channel", false, "Canonical listening platform"],
  ["country", "char(2)", "country_code", true, "Observed or inferred country code"],
  ["engagement", "jsonb", "engagement_metrics", true, "Provider engagement counters"],
  ["sentiment_source", "text", "sentiment_label", true, "Source sentiment label"],
  ["sentiment_score", "text", "sentiment_score", true, "Source sentiment score"],
  ["inclusion_status", "text", "record_disposition", false, "Included or excluded corpus disposition"],
  ["exclusion_reason", "text", "quality_reason", true, "Reason an observation was excluded"],
  ["quality_flags", "jsonb", "quality_flags", true, "Deterministic ingestion quality flags"],
  ["raw_metadata", "jsonb", "source_payload", true, "Unmodified source-specific fields"]
] as const;

const QUALITY_RULES = [
  {
    key: "listening.record_count",
    type: "volume",
    severity: "error",
    definition: { operator: "gt", threshold: 0, measure: "total_records" }
  },
  {
    key: "listening.text_completeness",
    type: "completeness",
    severity: "error",
    definition: { operator: "gte", threshold: 0.95, measure: "text_completeness" }
  },
  {
    key: "listening.date_completeness",
    type: "completeness",
    severity: "error",
    definition: { operator: "gte", threshold: 0.8, measure: "date_completeness" }
  },
  {
    key: "listening.platform_completeness",
    type: "completeness",
    severity: "warning",
    definition: { operator: "gte", threshold: 0.9, measure: "platform_completeness" }
  },
  {
    key: "listening.duplicate_rate",
    type: "uniqueness",
    severity: "warning",
    definition: { operator: "lte", threshold: 0.02, measure: "duplicate_rate" }
  },
  {
    key: "listening.temporal_coverage",
    type: "coverage",
    severity: "error",
    definition: { operator: "gte", threshold: 1, measure: "covered_months" }
  }
] as const;

export function evaluateListeningDataQuality(input: ListeningDataQualityInput): ListeningDataQualityResult {
  const denominator = Math.max(input.totalRecords, 1);
  const textCompleteness = clamp01(1 - input.missingTextRecords / denominator);
  const dateCompleteness = clamp01(1 - input.missingDateRecords / denominator);
  const platformCompleteness = clamp01(1 - input.missingPlatformRecords / denominator);
  const duplicateRate = Math.max(0, input.duplicateRecords) / Math.max(input.totalRecords + input.duplicateRecords, 1);
  const inclusionRate = Math.max(0, input.includedRecords) / denominator;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.totalRecords === 0) blockers.push("The corpus has no listening records.");
  if (textCompleteness < 0.95) blockers.push("Less than 95% of listening records contain usable text.");
  if (dateCompleteness < 0.8) blockers.push("Less than 80% of listening records contain a business timestamp.");
  if (input.coveredMonths < 1) blockers.push("Listening records do not cover a measurable month.");

  if (textCompleteness >= 0.95 && textCompleteness < 0.99) warnings.push("Some listening records are missing usable text.");
  if (dateCompleteness >= 0.8 && dateCompleteness < 0.95) warnings.push("Listening temporal coverage is incomplete.");
  if (platformCompleteness < 0.9) warnings.push("More than 10% of listening records are missing a canonical platform.");
  if (duplicateRate > 0.02) warnings.push("The canonical listening corpus contains more than 2% duplicate records.");
  if (input.includedRecords === 0 && input.totalRecords > 0) warnings.push("No listening records are currently included in the corpus.");

  return {
    status: blockers.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
    readyForAnalysis: blockers.length === 0 && input.includedRecords > 0,
    metrics: {
      textCompleteness,
      dateCompleteness,
      platformCompleteness,
      duplicateRate,
      inclusionRate
    },
    blockers,
    warnings
  };
}

export async function reconcileListeningDataOs(
  execute: DataOsSqlExecutor,
  args: { corpusId: string; importBatchId?: string | null }
): Promise<ListeningDataOsReconciliation> {
  await execute("SELECT pg_advisory_xact_lock(hashtext($1))", [`data-os:listening:${args.corpusId}`]);

  const scopeResult = await execute<CorpusScopeRow>(
    `
      SELECT
        sc.id AS corpus_id,
        COALESCE(b.organization_id, t.organization_id) AS organization_id,
        sc.brand_id,
        sc.theme_id,
        COALESCE(b.display_name, b.name, t.name, 'Study corpus') AS subject_name
      FROM study_corpora sc
      LEFT JOIN brands b ON b.id = sc.brand_id
      LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE sc.id = $1::uuid
      LIMIT 1
    `,
    [args.corpusId]
  );
  const scope = scopeResult.rows[0];
  if (!scope) throw new Error(`Study corpus ${args.corpusId} was not found.`);

  const statsResult = await execute<ListeningStatsRow>(
    `
      WITH mention_stats AS (
        SELECT
          COUNT(*) AS total_records,
          COUNT(*) FILTER (WHERE inclusion_status = 'included') AS included_records,
          COUNT(*) FILTER (WHERE inclusion_status = 'excluded') AS excluded_records,
          COUNT(*) FILTER (WHERE NULLIF(BTRIM(text_clean), '') IS NULL) AS missing_text_records,
          COUNT(*) FILTER (WHERE published_at IS NULL) AS missing_date_records,
          COUNT(*) FILTER (
            WHERE NULLIF(BTRIM(text_clean), '') IS NULL
               OR published_at IS NULL
          ) AS invalid_records,
          COUNT(*) FILTER (WHERE NULLIF(BTRIM(platform), '') IS NULL OR platform = 'unknown') AS missing_platform_records,
          COUNT(DISTINCT date_trunc('month', published_at)) FILTER (WHERE published_at IS NOT NULL) AS covered_months,
          COUNT(DISTINCT platform) FILTER (WHERE NULLIF(BTRIM(platform), '') IS NOT NULL) AS platforms,
          GREATEST(COUNT(*) - COUNT(DISTINCT text_hash), 0) AS duplicate_records,
          MIN(published_at)::date::text AS coverage_start,
          MAX(published_at)::date::text AS coverage_end
        FROM mentions
        WHERE study_corpus_id = $1::uuid
      ),
      batch_stats AS (
        SELECT COALESCE(SUM(duplicate_count), 0) AS ingestion_deduplicated_records
        FROM import_batches
        WHERE study_corpus_id = $1::uuid
          AND source_system IN ('listening_csv', 'social_listening_csv', 'sentione_csv', 'sentione')
          AND status = 'completed'
      )
      SELECT mention_stats.*, batch_stats.ingestion_deduplicated_records
      FROM mention_stats CROSS JOIN batch_stats
    `,
    [args.corpusId]
  );
  const stats = statsResult.rows[0] ?? emptyListeningStats();
  const quality = evaluateListeningDataQuality({
    totalRecords: numeric(stats.total_records),
    includedRecords: numeric(stats.included_records),
    excludedRecords: numeric(stats.excluded_records),
    duplicateRecords: numeric(stats.duplicate_records),
    missingTextRecords: numeric(stats.missing_text_records),
    missingDateRecords: numeric(stats.missing_date_records),
    missingPlatformRecords: numeric(stats.missing_platform_records),
    coveredMonths: numeric(stats.covered_months)
  });

  const sourceId = await ensureListeningSource(execute, scope, quality, stats);
  const assetId = await ensureListeningAsset(execute, scope, sourceId, quality, stats);
  await ensureListeningFields(execute, assetId);
  const contractId = await ensureListeningContract(execute, assetId);
  await ensureListeningQualityRules(execute, contractId);
  await ensureListeningMetricDefinitions(execute);
  const syncRunId = await createListeningSyncRun(execute, sourceId, stats, quality);
  await persistListeningQualityResults(execute, assetId, contractId, syncRunId, stats, quality);
  await rebuildListeningObservations(execute, scope, sourceId, assetId, syncRunId, quality);
  await persistListeningLineage(execute, args.corpusId, sourceId, assetId, syncRunId);

  const observationCountResult = await execute<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM data_observations
      WHERE study_corpus_id = $1::uuid
        AND data_asset_id = $2::uuid
        AND dataset_role = $3
    `,
    [args.corpusId, assetId, LISTENING_DATA_OS_DATASET_ROLE]
  );
  const commercialCountResult = await execute<CountRow>(
    `
      SELECT COUNT(*) AS count
      FROM data_observations
      WHERE study_corpus_id = $1::uuid
        AND quality_status <> 'rejected'
        AND COALESCE(dataset_role, '') NOT LIKE 'social_listening%'
    `,
    [args.corpusId]
  );
  const observationCount = numeric(observationCountResult.rows[0]?.count);
  const commercialObservations = numeric(commercialCountResult.rows[0]?.count);

  return {
    corpusId: args.corpusId,
    dataSourceId: sourceId,
    dataAssetId: assetId,
    sourceSyncRunId: syncRunId,
    contractId,
    quality,
    counts: {
      total: numeric(stats.total_records),
      included: numeric(stats.included_records),
      excluded: numeric(stats.excluded_records),
      duplicates: numeric(stats.duplicate_records),
      deduplicatedDuringIngestion: numeric(stats.ingestion_deduplicated_records),
      months: numeric(stats.covered_months),
      platforms: numeric(stats.platforms),
      observations: observationCount,
      commercialObservations
    },
    coverage: {
      start: stats.coverage_start,
      end: stats.coverage_end
    },
    capabilities: {
      canonicalMentionRecords: true,
      listeningMonthlySeries: observationCount > 0,
      commercialJoinAvailable: commercialObservations > 0
    }
  };
}

async function ensureListeningSource(
  execute: DataOsSqlExecutor,
  scope: CorpusScopeRow,
  quality: ListeningDataQualityResult,
  stats: ListeningStatsRow
) {
  const existing = await execute<IdRow>(
    `
      SELECT id
      FROM data_sources
      WHERE study_corpus_id = $1::uuid
        AND source_type = 'social_listening'
        AND provider = $2
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [scope.corpus_id, LISTENING_DATA_OS_SOURCE_PROVIDER]
  );
  const sourceId = existing.rows[0]?.id;
  const mapping = {
    canonical_record_table: "mentions",
    aggregate_dataset: LISTENING_DATA_OS_DATASET_KEY,
    record_grain: "mention",
    aggregate_grain: "month",
    contract_version: LISTENING_DATA_OS_CONTRACT_VERSION
  };
  const role = {
    domain: "social_listening",
    data_os_role: "canonical_record_source",
    supports_signal: true,
    commercial_join_available: false,
    quality_status: quality.status,
    covered_months: numeric(stats.covered_months)
  };

  if (sourceId) {
    await execute(
      `
        UPDATE data_sources
        SET organization_id = $2::uuid,
            brand_id = $3::uuid,
            name = $4,
            connection_method = 'file_upload',
            mapping = $5::jsonb,
            mapping_version = $6,
            role = $7::jsonb,
            status = 'active',
            visibility = 'internal',
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [sourceId, scope.organization_id, scope.brand_id, `${scope.subject_name} social listening`, JSON.stringify(mapping), LISTENING_DATA_OS_CONTRACT_VERSION, JSON.stringify(role)]
    );
    return sourceId;
  }

  const inserted = await execute<IdRow>(
    `
      INSERT INTO data_sources (
        study_corpus_id, organization_id, brand_id, source_type, provider,
        connection_method, name, mapping, mapping_version, role, status, visibility
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, 'social_listening', $4, 'file_upload', $5, $6::jsonb, $7, $8::jsonb, 'active', 'internal')
      RETURNING id
    `,
    [scope.corpus_id, scope.organization_id, scope.brand_id, LISTENING_DATA_OS_SOURCE_PROVIDER, `${scope.subject_name} social listening`, JSON.stringify(mapping), LISTENING_DATA_OS_CONTRACT_VERSION, JSON.stringify(role)]
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("Could not create the canonical listening data source.");
  return id;
}

async function ensureListeningAsset(
  execute: DataOsSqlExecutor,
  scope: CorpusScopeRow,
  sourceId: string,
  quality: ListeningDataQualityResult,
  stats: ListeningStatsRow
) {
  const metadata = {
    canonical_record_table: "mentions",
    aggregate_dataset: LISTENING_DATA_OS_DATASET_KEY,
    record_grain: "mention",
    source_systems: ["listening_csv", "social_listening_csv", "sentione_csv", "sentione"],
    quality_status: quality.status,
    quality_blockers: quality.blockers,
    quality_warnings: quality.warnings,
    included_records: numeric(stats.included_records),
    excluded_records: numeric(stats.excluded_records),
    covered_months: numeric(stats.covered_months),
    platforms: numeric(stats.platforms)
  };
  const result = await execute<IdRow>(
    `
      INSERT INTO data_assets (
        organization_id, brand_id, theme_id, study_corpus_id, data_source_id,
        asset_kind, layer, name, description, owner_team, sensitivity, status,
        storage_ref, row_count, metadata
      )
      VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        'canonical_records', 'curated', $6,
        'Canonical social-listening records. Full evidence remains in mentions; governed monthly aggregates live in data_observations.',
        'research', 'internal', 'active', 'table:mentions', $7::bigint, $8::jsonb
      )
      ON CONFLICT (study_corpus_id, name, layer)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        brand_id = EXCLUDED.brand_id,
        theme_id = EXCLUDED.theme_id,
        data_source_id = EXCLUDED.data_source_id,
        asset_kind = EXCLUDED.asset_kind,
        description = EXCLUDED.description,
        status = 'active',
        storage_ref = EXCLUDED.storage_ref,
        row_count = EXCLUDED.row_count,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING id
    `,
    [scope.organization_id, scope.brand_id, scope.theme_id, scope.corpus_id, sourceId, LISTENING_DATA_OS_ASSET_NAME, numeric(stats.total_records), JSON.stringify(metadata)]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Could not create the canonical listening data asset.");
  return id;
}

async function ensureListeningFields(execute: DataOsSqlExecutor, assetId: string) {
  await execute(
    `
      INSERT INTO data_asset_fields (
        data_asset_id, field_name, field_type, semantic_type, nullable, description, metadata
      )
      SELECT
        $1::uuid,
        field_name,
        field_type,
        semantic_type,
        nullable,
        description,
        jsonb_build_object('contract_version', $3::int)
      FROM jsonb_to_recordset($2::jsonb) AS field(
        field_name text,
        field_type text,
        semantic_type text,
        nullable boolean,
        description text
      )
      ON CONFLICT (data_asset_id, field_name)
      DO UPDATE SET
        field_type = EXCLUDED.field_type,
        semantic_type = EXCLUDED.semantic_type,
        nullable = EXCLUDED.nullable,
        description = EXCLUDED.description,
        metadata = EXCLUDED.metadata
    `,
    [
      assetId,
      JSON.stringify(LISTENING_FIELDS.map(([field_name, field_type, semantic_type, nullable, description]) => ({ field_name, field_type, semantic_type, nullable, description }))),
      LISTENING_DATA_OS_CONTRACT_VERSION
    ]
  );
}

async function ensureListeningContract(execute: DataOsSqlExecutor, assetId: string) {
  const schemaContract = {
    record_table: "mentions",
    record_grain: "mention",
    required_fields: ["id", "external_id", "text_clean", "published_at", "platform", "inclusion_status"],
    aggregate_table: "data_observations",
    aggregate_dataset: LISTENING_DATA_OS_DATASET_KEY,
    aggregate_grain: "month"
  };
  const qualityContract = {
    record_count_min: 1,
    text_completeness_min: 0.95,
    date_completeness_min: 0.8,
    platform_completeness_warning_below: 0.9,
    duplicate_rate_warning_above: 0.02,
    country_completeness_is_blocking: false
  };
  const semanticContract = {
    domain: "social_listening",
    canonical_record: "mention",
    record_disposition_field: "inclusion_status",
    business_time_field: "published_at",
    metrics: ["mentions_monthly", "engagement_monthly", "sentiment_monthly"],
    dimensions: ["platform", "country", "language", "content_type", "entity_label"],
    no_commercial_data_claim: true
  };
  const result = await execute<IdRow>(
    `
      INSERT INTO data_contracts (
        data_asset_id, contract_name, version, status, schema_contract,
        quality_contract, freshness_contract, semantic_contract
      )
      VALUES ($1::uuid, 'canonical_social_listening', $2, 'active', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
      ON CONFLICT (data_asset_id, contract_name, version)
      DO UPDATE SET
        status = 'active',
        schema_contract = EXCLUDED.schema_contract,
        quality_contract = EXCLUDED.quality_contract,
        freshness_contract = EXCLUDED.freshness_contract,
        semantic_contract = EXCLUDED.semantic_contract,
        updated_at = now()
      RETURNING id
    `,
    [assetId, LISTENING_DATA_OS_CONTRACT_VERSION, JSON.stringify(schemaContract), JSON.stringify(qualityContract), JSON.stringify({ mode: "batch", evaluated_on_reconciliation: true }), JSON.stringify(semanticContract)]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Could not create the canonical listening data contract.");
  return id;
}

async function ensureListeningQualityRules(execute: DataOsSqlExecutor, contractId: string) {
  await execute(
    `
      INSERT INTO data_quality_rules (data_contract_id, rule_key, rule_type, severity, definition, active)
      SELECT $1::uuid, rule_key, rule_type, severity, definition, true
      FROM jsonb_to_recordset($2::jsonb) AS rule(
        rule_key text,
        rule_type text,
        severity text,
        definition jsonb
      )
      ON CONFLICT (data_contract_id, rule_key)
      DO UPDATE SET
        rule_type = EXCLUDED.rule_type,
        severity = EXCLUDED.severity,
        definition = EXCLUDED.definition,
        active = true
    `,
    [contractId, JSON.stringify(QUALITY_RULES.map((rule) => ({ rule_key: rule.key, rule_type: rule.type, severity: rule.severity, definition: rule.definition })))]
  );
}

async function ensureListeningMetricDefinitions(execute: DataOsSqlExecutor) {
  const definitions = [
    {
      metric_key: "mentions_monthly",
      name: "Included listening mentions",
      description: "Count of included canonical listening mentions by business month.",
      grain: "month",
      unit: "count",
      definition: { source: "mentions", filter: { inclusion_status: "included" }, aggregation: "count" },
      dimensions: ["platform", "country", "language", "content_type", "entity_label"]
    },
    {
      metric_key: "engagement_monthly",
      name: "Listening engagement",
      description: "Sum of provider engagement counters for included mentions by business month.",
      grain: "month",
      unit: "count",
      definition: { source: "mentions.engagement", aggregation: "sum", fallback: "likes + comments + shares + reposts + saves" },
      dimensions: ["platform"]
    },
    {
      metric_key: "sentiment_monthly",
      name: "Listening sentiment score",
      description: "Average numeric source sentiment score for included mentions by business month.",
      grain: "month",
      unit: "score",
      definition: { source: "mentions.sentiment_score", aggregation: "average", nullable: true },
      dimensions: ["platform"]
    }
  ];
  await execute(
    `
      INSERT INTO metric_definitions (
        metric_key, name, description, grain, unit, definition, dimensions, owner_team, status
      )
      SELECT metric_key, name, description, grain, unit, definition, dimensions, 'data', 'active'
      FROM jsonb_to_recordset($1::jsonb) AS metric(
        metric_key text,
        name text,
        description text,
        grain text,
        unit text,
        definition jsonb,
        dimensions jsonb
      )
      ON CONFLICT (metric_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        grain = EXCLUDED.grain,
        unit = EXCLUDED.unit,
        definition = EXCLUDED.definition,
        dimensions = EXCLUDED.dimensions,
        owner_team = EXCLUDED.owner_team,
        status = 'active',
        updated_at = now()
    `,
    [JSON.stringify(definitions)]
  );
}

async function createListeningSyncRun(
  execute: DataOsSqlExecutor,
  sourceId: string,
  stats: ListeningStatsRow,
  quality: ListeningDataQualityResult
) {
  const result = await execute<IdRow>(
    `
      INSERT INTO source_sync_runs (
        data_source_id, started_at, finished_at, status, records_total, records_valid,
        records_duplicate, records_failed, coverage_start, coverage_end, error_summary
      )
      VALUES (
        $1::uuid, now(), now(), 'completed', $2, $3, $4, $5,
        $6::date, $7::date, $8::jsonb
      )
      RETURNING id
    `,
    [
      sourceId,
      numeric(stats.total_records),
      numeric(stats.included_records) + numeric(stats.excluded_records),
      numeric(stats.duplicate_records),
      numeric(stats.invalid_records),
      stats.coverage_start,
      stats.coverage_end,
      JSON.stringify({
        quality_status: quality.status,
        blockers: quality.blockers,
        warnings: quality.warnings,
        ingestion_deduplicated_records: numeric(stats.ingestion_deduplicated_records)
      })
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Could not create the listening source sync run.");
  return id;
}

async function persistListeningQualityResults(
  execute: DataOsSqlExecutor,
  assetId: string,
  contractId: string,
  syncRunId: string,
  stats: ListeningStatsRow,
  quality: ListeningDataQualityResult
) {
  const checks = [
    { key: "listening.record_count", status: numeric(stats.total_records) > 0 ? "passed" : "failed", observed: { total_records: numeric(stats.total_records) }, expected: { min: 1 } },
    { key: "listening.text_completeness", status: quality.metrics.textCompleteness >= 0.95 ? "passed" : "failed", observed: { ratio: quality.metrics.textCompleteness, missing: numeric(stats.missing_text_records) }, expected: { min: 0.95 } },
    { key: "listening.date_completeness", status: quality.metrics.dateCompleteness >= 0.8 ? (quality.metrics.dateCompleteness >= 0.95 ? "passed" : "warning") : "failed", observed: { ratio: quality.metrics.dateCompleteness, missing: numeric(stats.missing_date_records) }, expected: { min: 0.8, target: 0.95 } },
    { key: "listening.platform_completeness", status: quality.metrics.platformCompleteness >= 0.9 ? "passed" : "warning", observed: { ratio: quality.metrics.platformCompleteness, missing: numeric(stats.missing_platform_records) }, expected: { min: 0.9 } },
    { key: "listening.duplicate_rate", status: quality.metrics.duplicateRate <= 0.02 ? "passed" : "warning", observed: { ratio: quality.metrics.duplicateRate, duplicates: numeric(stats.duplicate_records) }, expected: { max: 0.02 } },
    { key: "listening.temporal_coverage", status: numeric(stats.covered_months) >= 1 ? "passed" : "failed", observed: { months: numeric(stats.covered_months), start: stats.coverage_start, end: stats.coverage_end }, expected: { min_months: 1 } }
  ];
  await execute(
    `
      INSERT INTO data_quality_results (
        data_quality_rule_id, data_asset_id, source_sync_run_id, result_key,
        status, observed_value, expected_value, checked_at
      )
      SELECT rule.id, $2::uuid, $3::uuid, check_row.result_key,
             check_row.status, check_row.observed_value, check_row.expected_value, now()
      FROM jsonb_to_recordset($4::jsonb) AS check_row(
        result_key text,
        status text,
        observed_value jsonb,
        expected_value jsonb
      )
      JOIN data_quality_rules rule
        ON rule.data_contract_id = $1::uuid
       AND rule.rule_key = check_row.result_key
      ON CONFLICT (data_asset_id, result_key)
      DO UPDATE SET
        data_quality_rule_id = EXCLUDED.data_quality_rule_id,
        source_sync_run_id = EXCLUDED.source_sync_run_id,
        status = EXCLUDED.status,
        observed_value = EXCLUDED.observed_value,
        expected_value = EXCLUDED.expected_value,
        checked_at = now()
    `,
    [
      contractId,
      assetId,
      syncRunId,
      JSON.stringify(checks.map((check) => ({ result_key: check.key, status: check.status, observed_value: check.observed, expected_value: check.expected })))
    ]
  );
}

async function rebuildListeningObservations(
  execute: DataOsSqlExecutor,
  scope: CorpusScopeRow,
  sourceId: string,
  assetId: string,
  syncRunId: string,
  quality: ListeningDataQualityResult
) {
  await execute(
    `
      DELETE FROM data_observations
      WHERE study_corpus_id = $1::uuid
        AND data_asset_id = $2::uuid
        AND dataset_role = $3
    `,
    [scope.corpus_id, assetId, LISTENING_DATA_OS_DATASET_ROLE]
  );

  await execute(
    `
      WITH included AS (
        SELECT
          m.*,
          date_trunc('month', m.published_at)::date AS month_start,
          CASE
            WHEN COALESCE(m.engagement->>'engagement', m.engagement->>'interactions') ~ '^-?[0-9]+(?:\\.[0-9]+)?$'
              THEN COALESCE(m.engagement->>'engagement', m.engagement->>'interactions')::numeric
            ELSE
              COALESCE(CASE WHEN m.engagement->>'likes' ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (m.engagement->>'likes')::numeric END, 0)
              + COALESCE(CASE WHEN m.engagement->>'comments' ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (m.engagement->>'comments')::numeric END, 0)
              + COALESCE(CASE WHEN m.engagement->>'shares' ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (m.engagement->>'shares')::numeric END, 0)
              + COALESCE(CASE WHEN m.engagement->>'reposts' ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (m.engagement->>'reposts')::numeric END, 0)
              + COALESCE(CASE WHEN m.engagement->>'saves' ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN (m.engagement->>'saves')::numeric END, 0)
          END AS engagement_value,
          ${LISTENING_NUMERIC_SENTIMENT_SQL} AS numeric_sentiment
        FROM mentions m
        WHERE m.study_corpus_id = $1::uuid
          AND m.inclusion_status = 'included'
          AND m.published_at IS NOT NULL
      ),
      platform_counts AS (
        SELECT month_start, COALESCE(NULLIF(BTRIM(platform), ''), 'unknown') AS platform, COUNT(*)::int AS platform_count
        FROM included
        GROUP BY month_start, COALESCE(NULLIF(BTRIM(platform), ''), 'unknown')
      ),
      platform_distributions AS (
        SELECT month_start, jsonb_object_agg(platform, platform_count ORDER BY platform) AS platform_distribution
        FROM platform_counts
        GROUP BY month_start
      ),
      monthly AS (
        SELECT
          included.month_start,
          COUNT(*)::numeric AS mention_count,
          SUM(included.engagement_value)::numeric AS engagement_sum,
          AVG(included.numeric_sentiment)::numeric AS sentiment_average,
          COUNT(included.numeric_sentiment)::int AS sentiment_records,
          distribution.platform_distribution
        FROM included
        JOIN platform_distributions distribution USING (month_start)
        GROUP BY included.month_start, distribution.platform_distribution
      ),
      metric_rows AS (
        SELECT month_start, 'mentions_monthly'::text AS metric_key, 'mentions'::text AS metric_family,
               mention_count AS metric_value, 'count'::text AS metric_unit, mention_count::int AS source_records,
               jsonb_build_object('platform_distribution', platform_distribution) AS dimensions,
               $12::text[] AS quality_issues
        FROM monthly
        UNION ALL
        SELECT month_start, 'engagement_monthly', 'engagement', engagement_sum, 'count', mention_count::int,
               jsonb_build_object('platform_distribution', platform_distribution), $12::text[]
        FROM monthly
        UNION ALL
        SELECT month_start, 'sentiment_monthly', 'sentiment', sentiment_average, 'score', sentiment_records,
               jsonb_build_object('platform_distribution', platform_distribution, 'scored_records', sentiment_records), $12::text[]
        FROM monthly
        WHERE sentiment_average IS NOT NULL
      )
      INSERT INTO data_observations (
        organization_id, brand_id, theme_id, study_corpus_id, data_source_id,
        data_asset_id, source_sync_run_id, dataset_key, dataset_name, dataset_role,
        row_index, record_hash, period_start, period_end, period_grain, period_semantics,
        metric_key, metric_family, metric_value, metric_unit, metric_currency_code,
        dimensions, raw_record, lineage, quality_status, quality_issues, materialized_at
      )
      SELECT
        $2::uuid, $3::uuid, $4::uuid, $1::uuid, $5::uuid,
        $6::uuid, $7::uuid, $8, 'Social listening monthly', $9,
        (EXTRACT(YEAR FROM month_start)::int * 100 + EXTRACT(MONTH FROM month_start)::int),
        md5($1::text || ':' || month_start::text || ':' || metric_key),
        month_start,
        (month_start + INTERVAL '1 month - 1 day')::date,
        'month', 'measurement', metric_key, metric_family, metric_value, metric_unit, NULL,
        dimensions,
        jsonb_build_object(
          'canonical_record_table', 'mentions',
          'included_only', true,
          'records', source_records
        ),
        jsonb_build_object(
          'source_table', 'mentions',
          'source_sync_run_id', $7::text,
          'record_grain', 'mention',
          'aggregate_grain', 'month',
          'contract_version', $10::int
        ),
        $11,
        to_jsonb(quality_issues),
        now()
      FROM metric_rows
    `,
    [
      scope.corpus_id,
      scope.organization_id,
      scope.brand_id,
      scope.theme_id,
      sourceId,
      assetId,
      syncRunId,
      LISTENING_DATA_OS_DATASET_KEY,
      LISTENING_DATA_OS_DATASET_ROLE,
      LISTENING_DATA_OS_CONTRACT_VERSION,
      quality.readyForAnalysis ? "accepted" : "needs_mapping_review",
      [...quality.blockers, ...quality.warnings]
    ]
  );
}

async function persistListeningLineage(
  execute: DataOsSqlExecutor,
  corpusId: string,
  sourceId: string,
  assetId: string,
  syncRunId: string
) {
  await execute(
    `
      INSERT INTO lineage_edges (source_type, source_id, target_type, target_id, relation_type, metadata)
      VALUES
        ('data_source', $1::uuid, 'data_asset', $2::uuid, 'materializes', $4::jsonb),
        ('data_source', $1::uuid, 'source_sync_run', $3::uuid, 'reconciled_by', $4::jsonb)
      ON CONFLICT (source_type, source_id, target_type, target_id, relation_type)
      DO UPDATE SET metadata = EXCLUDED.metadata
    `,
    [sourceId, assetId, syncRunId, JSON.stringify({ contract_version: LISTENING_DATA_OS_CONTRACT_VERSION, canonical_record_table: "mentions" })]
  );
  await execute(
    `
      INSERT INTO lineage_edges (source_type, source_id, target_type, target_id, relation_type, metadata)
      SELECT 'import_batch', batch.id, 'data_source', $2::uuid, 'ingested_into',
             jsonb_build_object('source_file_name', batch.source_file_name, 'source_system', batch.source_system)
      FROM import_batches batch
      WHERE batch.study_corpus_id = $1::uuid
        AND batch.source_system IN ('listening_csv', 'social_listening_csv', 'sentione_csv', 'sentione')
        AND batch.status = 'completed'
      ON CONFLICT (source_type, source_id, target_type, target_id, relation_type)
      DO UPDATE SET metadata = EXCLUDED.metadata
    `,
    [corpusId, sourceId]
  );
  await execute(
    `
      INSERT INTO lineage_edges (source_type, source_id, target_type, target_id, relation_type, metadata)
      SELECT 'import_batch', batch.id, 'data_asset', $2::uuid, 'contributes_to',
             jsonb_build_object('record_count', batch.record_count, 'included_count', batch.included_count, 'excluded_count', batch.excluded_count)
      FROM import_batches batch
      WHERE batch.study_corpus_id = $1::uuid
        AND batch.source_system IN ('listening_csv', 'social_listening_csv', 'sentione_csv', 'sentione')
        AND batch.status = 'completed'
      ON CONFLICT (source_type, source_id, target_type, target_id, relation_type)
      DO UPDATE SET metadata = EXCLUDED.metadata
    `,
    [corpusId, assetId]
  );
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function emptyListeningStats(): ListeningStatsRow {
  return {
    total_records: 0,
    included_records: 0,
    excluded_records: 0,
    duplicate_records: 0,
    ingestion_deduplicated_records: 0,
    invalid_records: 0,
    missing_text_records: 0,
    missing_date_records: 0,
    missing_platform_records: 0,
    covered_months: 0,
    platforms: 0,
    coverage_start: null,
    coverage_end: null
  };
}
