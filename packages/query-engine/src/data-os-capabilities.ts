export const DATA_OS_CAPABILITY_KEYS = [
  "social_listening",
  "ecommerce_sales",
  "product_catalog",
  "web_analytics",
  "search_demand",
  "customer_service",
  "organic_social",
  "paid_media",
  "crm_marketing",
  "reviews_ratings",
  "pricing_inventory",
  "competitive_intelligence"
] as const;

export type DataOsCapabilityKey = (typeof DATA_OS_CAPABILITY_KEYS)[number];
export type DataOsCapabilityStatus = "available" | "review_required" | "missing";

export type DataOsCapabilityRow = {
  dataset_role: string | null;
  metric_family: string | null;
  accepted_observations: number | string;
  review_observations: number | string;
  rejected_observations: number | string;
  temporal_observations: number | string;
  snapshot_observations?: number | string;
  accepted_records: number | string;
  review_records: number | string;
  rejected_records: number | string;
  temporal_records: number | string;
  snapshot_records?: number | string;
  months: number | string;
  assets: number | string;
  governed_assets?: number | string;
  period_start: string | null;
  period_end: string | null;
  snapshot_start?: string | null;
  snapshot_end?: string | null;
};

export type DataOsCapability = {
  key: DataOsCapabilityKey;
  label: string;
  status: DataOsCapabilityStatus;
  evidence_source: "data_observations" | "data_asset_records" | "data_catalog" | "mentions_fallback" | "none";
  accepted_observations: number;
  review_observations: number;
  rejected_observations: number;
  temporal_observations: number;
  snapshot_observations: number;
  accepted_records: number;
  review_records: number;
  rejected_records: number;
  temporal_records: number;
  snapshot_records: number;
  months: number;
  assets: number;
  period_start: string | null;
  period_end: string | null;
  snapshot_start: string | null;
  snapshot_end: string | null;
  metric_families: string[];
};

/**
 * Shared capability evidence query used by preflight and Claude RAG.
 *
 * Numeric observations remain the only scored evidence. A governed static
 * catalog is surfaced separately so product/SKU entities can participate in
 * joins without fabricating measurements or time series.
 */
export const DATA_OS_CAPABILITY_ROLLUP_SQL = `
  WITH observation_rollup AS (
    SELECT
      NULLIF(BTRIM(dataset_role), '') AS dataset_role,
      NULLIF(BTRIM(metric_family), '') AS metric_family,
      COUNT(*) FILTER (WHERE quality_status = 'accepted')::int AS accepted_observations,
      COUNT(*) FILTER (WHERE quality_status = 'needs_mapping_review')::int AS review_observations,
      COUNT(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected_observations,
      COUNT(*) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics IN ('measurement', 'event')
          AND period_start IS NOT NULL
      )::int AS temporal_observations,
      COUNT(*) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics = 'snapshot'
          AND period_start IS NOT NULL
      )::int AS snapshot_observations,
      0::int AS accepted_records,
      0::int AS review_records,
      0::int AS rejected_records,
      0::int AS temporal_records,
      0::int AS snapshot_records,
      COUNT(DISTINCT date_trunc('month', period_start)) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics IN ('measurement', 'event')
          AND period_start IS NOT NULL
      )::int AS months,
      COUNT(DISTINCT data_asset_id) FILTER (WHERE quality_status = 'accepted')::int AS assets,
      0::int AS governed_assets,
      MIN(period_start) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
      )::text AS period_start,
      MAX(COALESCE(period_end, period_start)) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
      )::text AS period_end,
      MIN(period_start) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
      )::text AS snapshot_start,
      MAX(COALESCE(period_end, period_start)) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
      )::text AS snapshot_end
    FROM data_observations
    WHERE study_corpus_id = $1::uuid
    GROUP BY 1, 2
  ),
  record_rollup AS (
    SELECT
      NULLIF(BTRIM(dataset_role), '') AS dataset_role,
      NULL::text AS metric_family,
      0::int AS accepted_observations,
      0::int AS review_observations,
      0::int AS rejected_observations,
      0::int AS temporal_observations,
      0::int AS snapshot_observations,
      COUNT(*) FILTER (WHERE quality_status = 'accepted')::int AS accepted_records,
      COUNT(*) FILTER (WHERE quality_status = 'needs_mapping_review')::int AS review_records,
      COUNT(*) FILTER (WHERE quality_status = 'rejected')::int AS rejected_records,
      COUNT(*) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics IN ('measurement', 'event')
          AND period_start IS NOT NULL
      )::int AS temporal_records,
      COUNT(*) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics = 'snapshot'
          AND period_start IS NOT NULL
      )::int AS snapshot_records,
      COUNT(DISTINCT date_trunc('month', period_start)) FILTER (
        WHERE quality_status = 'accepted'
          AND period_semantics IN ('measurement', 'event')
          AND period_start IS NOT NULL
      )::int AS months,
      COUNT(DISTINCT data_asset_id) FILTER (WHERE quality_status = 'accepted')::int AS assets,
      0::int AS governed_assets,
      MIN(period_start) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
      )::text AS period_start,
      MAX(COALESCE(period_end, period_start)) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics IN ('measurement', 'event')
      )::text AS period_end,
      MIN(period_start) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
      )::text AS snapshot_start,
      MAX(COALESCE(period_end, period_start)) FILTER (
        WHERE quality_status = 'accepted' AND period_semantics = 'snapshot'
      )::text AS snapshot_end
    FROM data_asset_records
    WHERE study_corpus_id = $1::uuid
    GROUP BY 1
  ),
  governed_asset_roles AS (
    SELECT DISTINCT
      asset.id AS data_asset_id,
      NULLIF(BTRIM(dataset.value ->> 'semantic_role'), '') AS dataset_role
    FROM data_assets asset
    JOIN data_contracts contract
      ON contract.data_asset_id = asset.id
     AND contract.status = 'active'
    JOIN data_quality_results quality
      ON quality.data_asset_id = asset.id
     AND quality.result_key = 'materialization_contract'
     AND quality.status IN ('pass', 'passed')
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(asset.metadata #> '{source_profile,datasets}') = 'array'
          THEN asset.metadata #> '{source_profile,datasets}'
        ELSE '[]'::jsonb
      END
    ) AS dataset(value)
    WHERE asset.study_corpus_id = $1::uuid
      AND asset.status = 'active'
      AND NULLIF(BTRIM(dataset.value ->> 'semantic_role'), '') IS NOT NULL
  ),
  governed_asset_rollup AS (
    SELECT
      dataset_role,
      NULL::text AS metric_family,
      0::int AS accepted_observations,
      0::int AS review_observations,
      0::int AS rejected_observations,
      0::int AS temporal_observations,
      0::int AS snapshot_observations,
      0::int AS accepted_records,
      0::int AS review_records,
      0::int AS rejected_records,
      0::int AS temporal_records,
      0::int AS snapshot_records,
      0::int AS months,
      COUNT(DISTINCT data_asset_id)::int AS assets,
      COUNT(DISTINCT data_asset_id)::int AS governed_assets,
      NULL::text AS period_start,
      NULL::text AS period_end,
      NULL::text AS snapshot_start,
      NULL::text AS snapshot_end
    FROM governed_asset_roles
    GROUP BY dataset_role
  )
  SELECT * FROM observation_rollup
  UNION ALL
  SELECT * FROM record_rollup
  UNION ALL
  SELECT * FROM governed_asset_rollup
  ORDER BY dataset_role, metric_family NULLS LAST
`;

type CapabilityDefinition = {
  key: DataOsCapabilityKey;
  label: string;
  roles: string[];
  fallbackFamilies?: string[];
  missingClaim: string;
};

const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    key: "social_listening",
    label: "Social listening",
    roles: ["social_listening"],
    fallbackFamilies: ["mentions", "engagement", "sentiment"],
    missingClaim: "conversation volume, channel mix, engagement, sentiment, triggers, or barriers"
  },
  {
    key: "ecommerce_sales",
    label: "Ecommerce sales",
    roles: ["ecommerce_sales"],
    fallbackFamilies: ["sales", "revenue", "orders", "units", "average_order_value", "returns", "refunds", "profit", "margin"],
    missingClaim: "revenue, orders, units, ticket, repurchase, returns, margin, or product sales impact"
  },
  {
    key: "product_catalog",
    label: "Product catalog",
    roles: ["product_catalog"],
    fallbackFamilies: ["product", "sku", "category"],
    missingClaim: "SKU, product, category, assortment, or product hierarchy coverage"
  },
  {
    key: "web_analytics",
    label: "Web analytics",
    roles: ["web_analytics"],
    fallbackFamilies: ["sessions", "users", "page_views", "product_views", "add_to_cart", "checkout", "conversion_rate"],
    missingClaim: "traffic, landing-page behavior, funnel progression, add-to-cart, checkout, or conversion impact"
  },
  {
    key: "search_demand",
    label: "Search demand",
    roles: ["search_demand"],
    fallbackFamilies: ["search_volume", "search_clicks", "search_impressions", "search_position"],
    missingClaim: "search demand, query intent, share of search, rankings, clicks, or impressions"
  },
  {
    key: "customer_service",
    label: "Customer service",
    roles: ["customer_service"],
    fallbackFamilies: ["support_tickets", "resolution_time", "customer_satisfaction"],
    missingClaim: "support volume, private friction, resolution performance, or service impact"
  },
  {
    key: "organic_social",
    label: "Organic social performance",
    roles: ["organic_social"],
    fallbackFamilies: ["posts", "reach", "impressions", "engagement", "followers"],
    missingClaim: "owned-content performance, reach, saves, shares, or post-driven lift"
  },
  {
    key: "paid_media",
    label: "Paid media",
    roles: ["paid_media"],
    fallbackFamilies: ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "roas"],
    missingClaim: "spend, paid reach, campaign efficiency, ROAS, or paid contribution to observed lift"
  },
  {
    key: "crm_marketing",
    label: "CRM and lifecycle marketing",
    roles: ["crm_marketing"],
    fallbackFamilies: ["customers", "repeat_customers", "retention_rate", "churn_rate", "email_clicks", "email_opens"],
    missingClaim: "customer identity, lifecycle, retention, churn, email, SMS, or CRM activation impact"
  },
  {
    key: "reviews_ratings",
    label: "Reviews and ratings",
    roles: ["reviews_ratings"],
    fallbackFamilies: ["reviews", "rating", "score"],
    missingClaim: "post-purchase ratings, review themes, or product satisfaction"
  },
  {
    key: "pricing_inventory",
    label: "Pricing, promotions, and inventory",
    roles: ["pricing_inventory"],
    fallbackFamilies: ["price", "discount", "stock", "inventory", "stockout"],
    missingClaim: "price, promotion, stock, availability, or inventory constraints"
  },
  {
    key: "competitive_intelligence",
    label: "Competitive intelligence",
    roles: ["competitive_intelligence"],
    fallbackFamilies: ["share_of_voice", "share_of_search", "competitor_price"],
    missingClaim: "competitive share, competitor pricing, claims, or relative performance"
  }
];

export function buildDataOsCapabilities(args: {
  rows: DataOsCapabilityRow[];
  rawListeningFallbackObservations?: number;
}): DataOsCapability[] {
  const rawListeningFallbackObservations = numeric(args.rawListeningFallbackObservations);

  return CAPABILITY_DEFINITIONS.map((definition) => {
    const matching = args.rows.filter((row) => matchesDefinition(row, definition));
    const accepted = sum(matching, "accepted_observations");
    const review = sum(matching, "review_observations");
    const rejected = sum(matching, "rejected_observations");
    const acceptedRecords = sum(matching, "accepted_records");
    const reviewRecords = sum(matching, "review_records");
    const rejectedRecords = sum(matching, "rejected_records");
    const governedAssets = maximum(matching, "governed_assets");
    const catalogAvailable = definition.key === "product_catalog" && governedAssets > 0;
    const recordEvidenceAvailable = acceptedRecords > 0;
    const fallbackAvailable = definition.key === "social_listening"
      && accepted === 0
      && rawListeningFallbackObservations > 0;

    return {
      key: definition.key,
      label: definition.label,
      status: accepted > 0 || recordEvidenceAvailable || catalogAvailable || fallbackAvailable
        ? "available"
        : review > 0 || rejected > 0 || reviewRecords > 0 || rejectedRecords > 0
          ? "review_required"
          : "missing",
      evidence_source: accepted > 0
        ? "data_observations"
        : recordEvidenceAvailable
          ? "data_asset_records"
          : catalogAvailable
            ? "data_catalog"
            : fallbackAvailable
              ? "mentions_fallback"
              : "none",
      accepted_observations: accepted > 0 ? accepted : fallbackAvailable ? rawListeningFallbackObservations : 0,
      review_observations: review,
      rejected_observations: rejected,
      temporal_observations: sum(matching, "temporal_observations"),
      snapshot_observations: sum(matching, "snapshot_observations"),
      accepted_records: acceptedRecords,
      review_records: reviewRecords,
      rejected_records: rejectedRecords,
      temporal_records: sum(matching, "temporal_records"),
      snapshot_records: sum(matching, "snapshot_records"),
      months: maximum(matching, "months"),
      assets: Math.max(maximum(matching, "assets"), governedAssets),
      period_start: minimumDate(matching.map((row) => row.period_start)),
      period_end: maximumDate(matching.map((row) => row.period_end)),
      snapshot_start: minimumDate(matching.map((row) => row.snapshot_start ?? null)),
      snapshot_end: maximumDate(matching.map((row) => row.snapshot_end ?? null)),
      metric_families: [...new Set(matching.map((row) => row.metric_family).filter(isString))].sort()
    };
  });
}

export function buildDataOsCapabilityGuardrails(capabilities: DataOsCapability[]): string[] {
  return capabilities.map((capability) => {
    const definition = CAPABILITY_DEFINITIONS.find((candidate) => candidate.key === capability.key)!;
    if (capability.status === "missing") {
      return `${capability.label}: no governed data was provided; do not infer ${definition.missingClaim}.`;
    }
    if (capability.status === "review_required") {
      return `${capability.label}: rows exist but require mapping or quality review; do not use them as scored evidence.`;
    }
    if (capability.evidence_source === "mentions_fallback") {
      return `${capability.label}: raw included mentions are a declared fallback; reconcile the canonical listening contract before publication.`;
    }
    if (capability.evidence_source === "data_catalog") {
      return `${capability.label}: a governed static catalog is available; use its entities and dimensions, but do not invent a time series or numeric performance.`;
    }
    if (capability.evidence_source === "data_asset_records") {
      return `${capability.label}: canonical source rows are available as entity or contextual evidence; do not make numeric performance claims unless accepted observations are also present.`;
    }
    if (capability.temporal_observations === 0 && capability.snapshot_observations > 0) {
      return `${capability.label}: accepted point-in-time snapshots are available; use them as captured-state evidence and do not claim trend, lift, or change over time.`;
    }
    if (capability.temporal_observations > 0 && capability.snapshot_observations > 0) {
      return `${capability.label}: accepted longitudinal observations and point-in-time snapshots are available; keep temporal relationships correlational and never blend snapshots into trend series.`;
    }
    return `${capability.label}: use accepted governed observations only and keep temporal relationships correlational.`;
  });
}

function matchesDefinition(row: DataOsCapabilityRow, definition: CapabilityDefinition) {
  const role = row.dataset_role?.trim().toLowerCase() ?? "";
  if (definition.roles.includes(role)) return true;
  if (role && role !== "uploaded_context" && role !== "unclassified") return false;
  const family = row.metric_family?.trim().toLowerCase() ?? "";
  return definition.fallbackFamilies?.includes(family) ?? false;
}

function sum(rows: DataOsCapabilityRow[], key: keyof DataOsCapabilityRow) {
  return rows.reduce((total, row) => total + numeric(row[key]), 0);
}

function maximum(rows: DataOsCapabilityRow[], key: keyof DataOsCapabilityRow) {
  return rows.reduce((result, row) => Math.max(result, numeric(row[key])), 0);
}

function minimumDate(values: Array<string | null>) {
  const dates = values.filter(isString).sort();
  return dates[0] ?? null;
}

function maximumDate(values: Array<string | null>) {
  const dates = values.filter(isString).sort();
  return dates.at(-1) ?? null;
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}
