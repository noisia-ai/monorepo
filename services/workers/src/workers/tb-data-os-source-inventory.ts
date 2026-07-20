export type DataOsSourceInventoryStatus = "ready" | "review_required" | "blocked";

export type DataOsSourceInventoryRow = {
  asset_id: string | null;
  knowledge_source_id: string | null;
  file_name: string;
  source_kind: string | null;
  provider: string | null;
  connection_method: string | null;
  knowledge_source_status: string | null;
  data_source_status: string | null;
  asset_status: string | null;
  asset_kind: string | null;
  canonical_record_table: string | null;
  asset_reported_rows: number | string | null;
  active_contracts: number | string;
  field_count: number | string;
  expected_source_rows: number | string;
  expected_materialized_rows: number | string;
  expects_numeric_observations: boolean | null;
  expects_temporal_records: boolean | null;
  expects_snapshot_records?: boolean | null;
  expects_snapshot_observations?: boolean | null;
  canonical_records: number | string;
  accepted_records: number | string;
  review_records: number | string;
  rejected_records: number | string;
  temporal_records: number | string;
  snapshot_records?: number | string;
  record_period_start: string | null;
  record_period_end: string | null;
  record_snapshot_start?: string | null;
  record_snapshot_end?: string | null;
  accepted_observations: number | string;
  review_observations: number | string;
  rejected_observations: number | string;
  temporal_observations: number | string;
  snapshot_observations?: number | string;
  observation_period_start: string | null;
  observation_period_end: string | null;
  observation_snapshot_start?: string | null;
  observation_snapshot_end?: string | null;
  listening_mentions: number | string;
  listening_included_mentions: number | string;
  listening_excluded_mentions: number | string;
  listening_period_start: string | null;
  listening_period_end: string | null;
  dataset_roles: unknown;
  metric_families: unknown;
  metric_keys: unknown;
  entity_types: unknown;
  entity_labels_sample: unknown;
  quality_status: string | null;
  quality_blockers: unknown;
  quality_warnings: unknown;
  knowledge_source_lineage: number | string;
  source_asset_lineage: number | string;
  sync_asset_lineage: number | string;
  sync_status: string | null;
  sync_records_total: number | string | null;
  sync_records_valid: number | string | null;
};

export type DataOsSourceInventoryItem = {
  asset_id: string | null;
  knowledge_source_id: string | null;
  file_name: string;
  source_kind: string | null;
  provider: string | null;
  connection_method: string | null;
  status: DataOsSourceInventoryStatus;
  canonical_record_store: "mentions" | "data_asset_records";
  rows: {
    expected_source: number;
    expected_materialized: number;
    asset_reported: number;
    canonical: number;
    accepted: number;
    review_required: number;
    rejected: number;
    temporal: number;
    snapshot: number;
  };
  observations: {
    accepted: number;
    review_required: number;
    rejected: number;
    temporal: number;
    snapshot: number;
  };
  semantic: {
    dataset_roles: string[];
    metric_families: string[];
    metric_keys: string[];
    entity_types: string[];
    entity_labels_sample: string[];
    period_start: string | null;
    period_end: string | null;
    snapshot_start: string | null;
    snapshot_end: string | null;
  };
  contract: {
    active: boolean;
    fields: number;
    expects_numeric_observations: boolean;
    expects_temporal_records: boolean;
    expects_snapshot_records: boolean;
    expects_snapshot_observations: boolean;
  };
  quality: {
    status: string;
    blockers: string[];
    warnings: string[];
  };
  lineage: {
    edges: number;
    complete: boolean;
  };
  sync: {
    status: string | null;
    records_total: number;
    records_valid: number;
  };
};

/**
 * Compact, governed inventory for Claude. It exposes contracts and coverage,
 * never raw customer records. Listening keeps `mentions` as its canonical
 * record store; uploaded files keep one row per source row in
 * `data_asset_records` plus numeric facts in `data_observations`.
 */
export const DATA_OS_SOURCE_INVENTORY_SQL = `
  WITH asset_scope AS (
    SELECT
      asset.id AS asset_id,
      asset.data_source_id,
      source.id AS data_source_id_resolved,
      knowledge.id AS knowledge_source_id,
      COALESCE(knowledge.original_file_name, knowledge.title, asset.name) AS file_name,
      COALESCE(knowledge.source_kind, source.source_type) AS source_kind,
      source.provider,
      source.connection_method,
      knowledge.status AS knowledge_source_status,
      source.status AS data_source_status,
      asset.status AS asset_status,
      asset.asset_kind,
      asset.storage_ref,
      asset.row_count AS asset_reported_rows,
      asset.metadata
    FROM data_assets asset
    LEFT JOIN data_sources source ON source.id = asset.data_source_id
    LEFT JOIN brand_knowledge_sources knowledge
      ON knowledge.id::text = asset.metadata->>'knowledge_source_id'
    WHERE asset.study_corpus_id = $1::uuid
      AND asset.status = 'active'
  ),
  missing_uploads AS (
    SELECT
      NULL::uuid AS asset_id,
      NULL::uuid AS data_source_id,
      NULL::uuid AS data_source_id_resolved,
      knowledge.id AS knowledge_source_id,
      COALESCE(knowledge.original_file_name, knowledge.title, knowledge.id::text) AS file_name,
      knowledge.source_kind,
      NULL::text AS provider,
      NULL::text AS connection_method,
      knowledge.status AS knowledge_source_status,
      NULL::text AS data_source_status,
      NULL::text AS asset_status,
      NULL::text AS asset_kind,
      NULL::text AS storage_ref,
      NULL::bigint AS asset_reported_rows,
      '{}'::jsonb AS metadata
    FROM brand_knowledge_sources knowledge
    WHERE knowledge.study_corpus_id = $1::uuid
      AND knowledge.original_file_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM data_assets asset
        WHERE asset.study_corpus_id = $1::uuid
          AND asset.status = 'active'
          AND asset.metadata->>'knowledge_source_id' = knowledge.id::text
      )
  ),
  scoped AS (
    SELECT * FROM asset_scope
    UNION ALL
    SELECT * FROM missing_uploads
  ),
  corpus_mentions AS (
    SELECT
      COUNT(*)::int AS listening_mentions,
      COUNT(*) FILTER (WHERE inclusion_status = 'included')::int AS listening_included_mentions,
      COUNT(*) FILTER (WHERE inclusion_status = 'excluded')::int AS listening_excluded_mentions,
      MIN(published_at)::text AS listening_period_start,
      MAX(published_at)::text AS listening_period_end
    FROM mentions
    WHERE study_corpus_id = $1::uuid
  )
  SELECT
    scoped.asset_id::text AS asset_id,
    scoped.knowledge_source_id::text AS knowledge_source_id,
    scoped.file_name,
    scoped.source_kind,
    scoped.provider,
    scoped.connection_method,
    scoped.knowledge_source_status,
    scoped.data_source_status,
    scoped.asset_status,
    scoped.asset_kind,
    COALESCE(scoped.metadata->>'canonical_record_table', NULLIF(scoped.storage_ref, '')) AS canonical_record_table,
    scoped.asset_reported_rows,
    COALESCE(contract.active_contracts, 0)::int AS active_contracts,
    COALESCE(field.field_count, 0)::int AS field_count,
    COALESCE(quality.expected_source_rows, contract.expected_source_rows, 0)::int AS expected_source_rows,
    COALESCE(quality.expected_materialized_rows, contract.expected_materialized_rows, 0)::int AS expected_materialized_rows,
    COALESCE(contract.expects_numeric_observations, quality.expects_numeric_observations, false) AS expects_numeric_observations,
    COALESCE(contract.expects_temporal_records, quality.expects_temporal_records, false) AS expects_temporal_records,
    COALESCE(contract.expects_snapshot_records, quality.expects_snapshot_records, false) AS expects_snapshot_records,
    COALESCE(contract.expects_snapshot_observations, quality.expects_snapshot_observations, false) AS expects_snapshot_observations,
    COALESCE(record.canonical_records, 0)::int AS canonical_records,
    COALESCE(record.accepted_records, 0)::int AS accepted_records,
    COALESCE(record.review_records, 0)::int AS review_records,
    COALESCE(record.rejected_records, 0)::int AS rejected_records,
    COALESCE(record.temporal_records, 0)::int AS temporal_records,
    COALESCE(record.snapshot_records, 0)::int AS snapshot_records,
    record.period_start AS record_period_start,
    record.period_end AS record_period_end,
    record.snapshot_start AS record_snapshot_start,
    record.snapshot_end AS record_snapshot_end,
    COALESCE(observation.accepted_observations, 0)::int AS accepted_observations,
    COALESCE(observation.review_observations, 0)::int AS review_observations,
    COALESCE(observation.rejected_observations, 0)::int AS rejected_observations,
    COALESCE(observation.temporal_observations, 0)::int AS temporal_observations,
    COALESCE(observation.snapshot_observations, 0)::int AS snapshot_observations,
    observation.period_start AS observation_period_start,
    observation.period_end AS observation_period_end,
    observation.snapshot_start AS observation_snapshot_start,
    observation.snapshot_end AS observation_snapshot_end,
    corpus_mentions.listening_mentions,
    corpus_mentions.listening_included_mentions,
    corpus_mentions.listening_excluded_mentions,
    corpus_mentions.listening_period_start,
    corpus_mentions.listening_period_end,
    semantic.dataset_roles,
    semantic.metric_families,
    semantic.metric_keys,
    semantic.entity_types,
    semantic.entity_labels_sample,
    COALESCE(quality.quality_status, scoped.metadata->>'quality_status', 'missing') AS quality_status,
    COALESCE(quality.blockers, scoped.metadata->'quality_blockers', '[]'::jsonb) AS quality_blockers,
    COALESCE(quality.warnings, scoped.metadata->'quality_warnings', '[]'::jsonb) AS quality_warnings,
    COALESCE(lineage.knowledge_source_lineage, 0)::int AS knowledge_source_lineage,
    COALESCE(lineage.source_asset_lineage, 0)::int AS source_asset_lineage,
    COALESCE(lineage.sync_asset_lineage, 0)::int AS sync_asset_lineage,
    sync.status AS sync_status,
    sync.records_total AS sync_records_total,
    sync.records_valid AS sync_records_valid
  FROM scoped
  CROSS JOIN corpus_mentions
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS active_contracts,
      MAX(CASE WHEN item.schema_contract->>'expected_source_rows' ~ '^[0-9]+$'
        THEN (item.schema_contract->>'expected_source_rows')::int ELSE 0 END)::int AS expected_source_rows,
      MAX(CASE WHEN item.schema_contract->>'expected_materialized_rows' ~ '^[0-9]+$'
        THEN (item.schema_contract->>'expected_materialized_rows')::int ELSE 0 END)::int AS expected_materialized_rows,
      BOOL_OR(item.semantic_contract #>> '{source_materialization_contract,expectsNumericObservations}' = 'true') AS expects_numeric_observations,
      BOOL_OR(item.semantic_contract #>> '{source_materialization_contract,expectsTemporalRecords}' = 'true') AS expects_temporal_records,
      BOOL_OR(item.semantic_contract #>> '{source_materialization_contract,expectsSnapshotRecords}' = 'true') AS expects_snapshot_records,
      BOOL_OR(item.semantic_contract #>> '{source_materialization_contract,expectsSnapshotObservations}' = 'true') AS expects_snapshot_observations
    FROM data_contracts item
    WHERE item.data_asset_id = scoped.asset_id
      AND item.status = 'active'
  ) contract ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS field_count
    FROM data_asset_fields item
    WHERE item.data_asset_id = scoped.asset_id
  ) field ON true
  LEFT JOIN LATERAL (
    SELECT
      item.status AS quality_status,
      CASE WHEN item.expected_value->>'sourceRows' ~ '^[0-9]+$'
        THEN (item.expected_value->>'sourceRows')::int ELSE 0 END AS expected_source_rows,
      CASE WHEN item.expected_value->>'materializedRows' ~ '^[0-9]+$'
        THEN (item.expected_value->>'materializedRows')::int ELSE 0 END AS expected_materialized_rows,
      item.expected_value #>> '{source_materialization_contract,expectsNumericObservations}' = 'true' AS expects_numeric_observations,
      item.expected_value #>> '{source_materialization_contract,expectsTemporalRecords}' = 'true' AS expects_temporal_records,
      item.expected_value #>> '{source_materialization_contract,expectsSnapshotRecords}' = 'true' AS expects_snapshot_records,
      item.expected_value #>> '{source_materialization_contract,expectsSnapshotObservations}' = 'true' AS expects_snapshot_observations,
      item.observed_value->'blockers' AS blockers,
      item.observed_value->'warnings' AS warnings
    FROM data_quality_results item
    WHERE item.data_asset_id = scoped.asset_id
      AND item.result_key = 'materialization_contract'
    ORDER BY item.checked_at DESC
    LIMIT 1
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
      MIN(item.period_start) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics IN ('measurement', 'event')
      )::text AS period_start,
      MAX(COALESCE(item.period_end, item.period_start)) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics IN ('measurement', 'event')
      )::text AS period_end,
      MIN(item.period_start) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics = 'snapshot'
      )::text AS snapshot_start,
      MAX(COALESCE(item.period_end, item.period_start)) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics = 'snapshot'
      )::text AS snapshot_end
    FROM data_asset_records item
    WHERE item.data_asset_id = scoped.asset_id
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
      )::int AS snapshot_observations,
      MIN(item.period_start) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics IN ('measurement', 'event')
      )::text AS period_start,
      MAX(COALESCE(item.period_end, item.period_start)) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics IN ('measurement', 'event')
      )::text AS period_end,
      MIN(item.period_start) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics = 'snapshot'
      )::text AS snapshot_start,
      MAX(COALESCE(item.period_end, item.period_start)) FILTER (
        WHERE item.quality_status = 'accepted' AND item.period_semantics = 'snapshot'
      )::text AS snapshot_end
    FROM data_observations item
    WHERE item.data_asset_id = scoped.asset_id
  ) observation ON true
  LEFT JOIN LATERAL (
    SELECT
      ARRAY(
        SELECT DISTINCT value
        FROM (
          SELECT NULLIF(BTRIM(item.dataset_role), '') AS value
          FROM data_asset_records item
          WHERE item.data_asset_id = scoped.asset_id
          UNION ALL
          SELECT NULLIF(BTRIM(item.dataset_role), '') AS value
          FROM data_observations item
          WHERE item.data_asset_id = scoped.asset_id
          UNION ALL
          SELECT NULLIF(BTRIM(dataset.value->>'semantic_role'), '') AS value
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(scoped.metadata #> '{source_profile,datasets}') = 'array'
              THEN scoped.metadata #> '{source_profile,datasets}' ELSE '[]'::jsonb END
          ) dataset(value)
          UNION ALL
          SELECT CASE WHEN scoped.source_kind = 'social_listening' THEN 'social_listening' END
        ) roles
        WHERE value IS NOT NULL
        ORDER BY value
      ) AS dataset_roles,
      ARRAY(
        SELECT DISTINCT item.metric_family
        FROM data_observations item
        WHERE item.data_asset_id = scoped.asset_id
          AND item.quality_status <> 'rejected'
          AND NULLIF(BTRIM(item.metric_family), '') IS NOT NULL
        ORDER BY item.metric_family
      ) AS metric_families,
      ARRAY(
        SELECT DISTINCT item.metric_key
        FROM data_observations item
        WHERE item.data_asset_id = scoped.asset_id
          AND item.quality_status <> 'rejected'
          AND NULLIF(BTRIM(item.metric_key), '') IS NOT NULL
        ORDER BY item.metric_key
      ) AS metric_keys,
      ARRAY(
        SELECT DISTINCT item.entity_type
        FROM data_asset_records item
        WHERE item.data_asset_id = scoped.asset_id
          AND item.quality_status <> 'rejected'
          AND NULLIF(BTRIM(item.entity_type), '') IS NOT NULL
        ORDER BY item.entity_type
      ) AS entity_types,
      ARRAY(
        SELECT value
        FROM (
          SELECT DISTINCT item.entity_label AS value
          FROM data_asset_records item
          WHERE item.data_asset_id = scoped.asset_id
            AND item.quality_status = 'accepted'
            AND NULLIF(BTRIM(item.entity_label), '') IS NOT NULL
          ORDER BY item.entity_label
          LIMIT 12
        ) labels
      ) AS entity_labels_sample
  ) semantic ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE edge.source_type = 'brand_knowledge_source'
          AND edge.source_id = scoped.knowledge_source_id
          AND edge.target_type = 'data_source'
          AND edge.target_id = scoped.data_source_id_resolved
      )::int AS knowledge_source_lineage,
      COUNT(*) FILTER (
        WHERE edge.source_type = 'data_source'
          AND edge.source_id = scoped.data_source_id_resolved
          AND edge.target_type = 'data_asset'
          AND edge.target_id = scoped.asset_id
      )::int AS source_asset_lineage,
      COUNT(*) FILTER (
        WHERE edge.source_type = 'source_sync_run'
          AND edge.target_type = 'data_asset'
          AND edge.target_id = scoped.asset_id
          AND EXISTS (
            SELECT 1 FROM source_sync_runs run
            WHERE run.id = edge.source_id
              AND run.data_source_id = scoped.data_source_id_resolved
          )
      )::int AS sync_asset_lineage
    FROM lineage_edges edge
    WHERE edge.target_id = scoped.asset_id
       OR edge.source_id = scoped.knowledge_source_id
       OR edge.source_id = scoped.data_source_id_resolved
  ) lineage ON true
  LEFT JOIN LATERAL (
    SELECT item.status, item.records_total, item.records_valid
    FROM source_sync_runs item
    WHERE item.data_source_id = scoped.data_source_id_resolved
    ORDER BY item.created_at DESC
    LIMIT 1
  ) sync ON true
  ORDER BY scoped.file_name, scoped.asset_id
`;

export function buildDataOsSourceInventory(rows: DataOsSourceInventoryRow[]): DataOsSourceInventoryItem[] {
  return rows.map((row) => {
    const datasetRoles = strings(row.dataset_roles);
    const isListening = row.canonical_record_table === "table:mentions"
      || row.canonical_record_table === "mentions"
      || row.source_kind === "social_listening"
      || datasetRoles.includes("social_listening");
    const canonicalRecords = isListening ? numeric(row.listening_mentions) : numeric(row.canonical_records);
    const acceptedRecords = isListening ? numeric(row.listening_included_mentions) : numeric(row.accepted_records);
    const rejectedRecords = isListening ? numeric(row.listening_excluded_mentions) : numeric(row.rejected_records);
    const temporalRecords = isListening ? acceptedRecords : numeric(row.temporal_records);
    const snapshotRecords = isListening ? 0 : numeric(row.snapshot_records);
    const periodStart = isListening
      ? row.listening_period_start
      : minimumDate(row.record_period_start, row.observation_period_start);
    const periodEnd = isListening
      ? row.listening_period_end
      : maximumDate(row.record_period_end, row.observation_period_end);
    const snapshotStart = isListening
      ? null
      : minimumDate(row.record_snapshot_start ?? null, row.observation_snapshot_start ?? null);
    const snapshotEnd = isListening
      ? null
      : maximumDate(row.record_snapshot_end ?? null, row.observation_snapshot_end ?? null);
    const blockers = strings(row.quality_blockers);
    const warnings = strings(row.quality_warnings);
    const expectsNumeric = Boolean(row.expects_numeric_observations);
    const expectsTemporal = Boolean(row.expects_temporal_records);
    const expectsSnapshotRecords = Boolean(row.expects_snapshot_records);
    const expectsSnapshotObservations = Boolean(row.expects_snapshot_observations);
    const acceptedObservations = numeric(row.accepted_observations);
    const activeContract = numeric(row.active_contracts) > 0;
    const expectedSourceRows = isListening
      ? numeric(row.listening_mentions)
      : numeric(row.expected_source_rows);
    const expectedMaterializedRows = isListening
      ? numeric(row.listening_mentions)
      : numeric(row.expected_materialized_rows);
    const assetReportedRows = numeric(row.asset_reported_rows);
    const knowledgeLineage = numeric(row.knowledge_source_lineage);
    const sourceAssetLineage = numeric(row.source_asset_lineage);
    const syncAssetLineage = numeric(row.sync_asset_lineage);
    const lineageComplete = isListening
      ? sourceAssetLineage > 0
      : knowledgeLineage > 0 && sourceAssetLineage > 0 && syncAssetLineage > 0;
    const sourceReady = isListening
      ? row.data_source_status === "active" && row.asset_status === "active"
      : row.knowledge_source_status === "processed"
        && row.data_source_status === "active"
        && row.asset_status === "active";
    const materialized = expectedSourceRows > 0
      && expectedMaterializedRows >= expectedSourceRows
      && canonicalRecords === expectedMaterializedRows
      && assetReportedRows === canonicalRecords;
    const temporalObservationEvidence = numeric(row.temporal_observations) > 0;
    const snapshotObservationEvidence = numeric(row.snapshot_observations) > 0;
    const qualityFailed = ["fail", "failed", "missing"].includes((row.quality_status ?? "missing").toLowerCase());
    const isBlocked = !row.asset_id
      || !sourceReady
      || !activeContract
      || !materialized
      || qualityFailed
      || blockers.length > 0
      || (expectsNumeric && acceptedObservations === 0)
      || (expectsTemporal && temporalRecords === 0)
      || (expectsTemporal && expectsNumeric && !temporalObservationEvidence)
      || (expectsSnapshotRecords && snapshotRecords === 0)
      || (expectsSnapshotObservations && !snapshotObservationEvidence)
      || !lineageComplete;
    const requiresReview = warnings.length > 0
      || numeric(row.review_records) > 0
      || numeric(row.rejected_records) > 0
      || numeric(row.review_observations) > 0
      || numeric(row.rejected_observations) > 0;

    return {
      asset_id: row.asset_id,
      knowledge_source_id: row.knowledge_source_id,
      file_name: row.file_name,
      source_kind: row.source_kind,
      provider: row.provider,
      connection_method: row.connection_method,
      status: isBlocked ? "blocked" : requiresReview ? "review_required" : "ready",
      canonical_record_store: isListening ? "mentions" : "data_asset_records",
      rows: {
        expected_source: expectedSourceRows,
        expected_materialized: expectedMaterializedRows,
        asset_reported: assetReportedRows,
        canonical: canonicalRecords,
        accepted: acceptedRecords,
        review_required: numeric(row.review_records),
        rejected: rejectedRecords,
        temporal: temporalRecords,
        snapshot: snapshotRecords
      },
      observations: {
        accepted: acceptedObservations,
        review_required: numeric(row.review_observations),
        rejected: numeric(row.rejected_observations),
        temporal: numeric(row.temporal_observations),
        snapshot: numeric(row.snapshot_observations)
      },
      semantic: {
        dataset_roles: datasetRoles,
        metric_families: strings(row.metric_families),
        metric_keys: strings(row.metric_keys),
        entity_types: strings(row.entity_types),
        entity_labels_sample: strings(row.entity_labels_sample).slice(0, 12),
        period_start: periodStart,
        period_end: periodEnd,
        snapshot_start: snapshotStart,
        snapshot_end: snapshotEnd
      },
      contract: {
        active: activeContract,
        fields: numeric(row.field_count),
        expects_numeric_observations: expectsNumeric,
        expects_temporal_records: expectsTemporal,
        expects_snapshot_records: expectsSnapshotRecords,
        expects_snapshot_observations: expectsSnapshotObservations
      },
      quality: {
        status: row.quality_status ?? "missing",
        blockers,
        warnings
      },
      lineage: {
        edges: knowledgeLineage + sourceAssetLineage + syncAssetLineage,
        complete: lineageComplete
      },
      sync: {
        status: row.sync_status,
        records_total: numeric(row.sync_records_total),
        records_valid: numeric(row.sync_records_valid)
      }
    };
  });
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean))];
  }
  return [];
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function minimumDate(...values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function maximumDate(...values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}
