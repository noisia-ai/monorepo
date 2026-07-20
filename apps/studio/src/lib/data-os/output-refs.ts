import { dashboardDataRefs, dataAssets, lineageEdges } from "@noisia/db";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { getDataOsOverlappingMonths } from "@/lib/data-os/month-overlap";
import { getDataOsCorpusReadiness } from "@/lib/data-os/readiness";
import {
  REQUIRED_SIGNAL_DATA_REF_KEYS,
  SIGNAL_OPPORTUNITY_KINDS,
  SIGNAL_SERVING_CONTRACT_VERSION,
  type RequiredSignalDataRefKey
} from "@/lib/signal/semantics";

type OutputRefResult = {
  status: "ok" | "skipped" | "failed";
  refs: number;
  lineageEdges: number;
  contractVersion: string;
  presentRefs: string[];
  missingRefs: RequiredSignalDataRefKey[];
  reason?: string;
};

type OutputRef = {
  refKey: string;
  sourceType: string;
  sourceId: string;
  filters: Record<string, unknown>;
  visibility: Record<string, unknown>;
};

export async function persistDataOsOutputRefs(args: {
  outputId: string;
  corpusId: string;
  analysisId?: string | null;
  snapshotId?: string | null;
  required?: boolean;
}): Promise<OutputRefResult> {
  const required = args.required === true;
  const dataOsEnabled = process.env.NOISIA_DATA_OS_ENABLED === "true";

  if (!dataOsEnabled && !required) {
    return {
      status: "skipped",
      refs: 0,
      lineageEdges: 0,
      contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
      presentRefs: [],
      missingRefs: [...REQUIRED_SIGNAL_DATA_REF_KEYS],
      reason: "data_os_disabled"
    };
  }

  if (required && (!args.analysisId || !args.snapshotId)) {
    return {
      status: "failed",
      refs: 0,
      lineageEdges: 0,
      contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
      presentRefs: [],
      missingRefs: [...REQUIRED_SIGNAL_DATA_REF_KEYS],
      reason: "published_signal_requires_analysis_and_snapshot"
    };
  }

  try {
    const refs: OutputRef[] = [];
    const shouldLoadReadiness = Boolean(args.analysisId && args.snapshotId) || dataOsEnabled;
    const readiness = shouldLoadReadiness
      ? await getDataOsCorpusReadiness(args.corpusId)
      : null;

    if (args.analysisId && args.snapshotId) {
      refs.push(...buildRequiredSignalRefs({
        corpusId: args.corpusId,
        analysisId: args.analysisId,
        snapshotId: args.snapshotId,
        metricFamilies: readiness?.metricFamilies.map((family) => family.family) ?? [],
        overlapMonths: readiness ? getDataOsOverlappingMonths(readiness.monthlySeries) : []
      }));
    }

    if (dataOsEnabled && readiness) {
      refs.push(...buildDataOsContextRefs(args.corpusId, readiness));
    }

    const persisted: Array<{ id: string; ref: OutputRef }> = [];
    for (const ref of refs) {
      const [row] = await db
        .insert(dashboardDataRefs)
        .values({
          outputId: args.outputId,
          studyCorpusId: args.corpusId,
          refKey: ref.refKey,
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          filters: ref.filters,
          visibility: ref.visibility
        })
        .onConflictDoUpdate({
          target: [dashboardDataRefs.outputId, dashboardDataRefs.refKey],
          set: {
            studyCorpusId: args.corpusId,
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            filters: ref.filters,
            visibility: ref.visibility
          }
        })
        .returning({ id: dashboardDataRefs.id });
      if (row) persisted.push({ id: row.id, ref });
    }

    let lineageCount = 0;
    for (const { id, ref } of persisted) {
      const edges = [
        {
          sourceType: ref.sourceType,
          sourceId: ref.sourceId,
          targetType: "dashboard_data_ref",
          targetId: id,
          relationType: "backs"
        },
        {
          sourceType: "dashboard_data_ref",
          sourceId: id,
          targetType: "published_output",
          targetId: args.outputId,
          relationType: "serves"
        }
      ];
      for (const edge of edges) {
        await db
          .insert(lineageEdges)
          .values({
            ...edge,
            metadata: {
              contract: SIGNAL_SERVING_CONTRACT_VERSION,
              ref_key: ref.refKey,
              source: "signal_output"
            }
          })
          .onConflictDoNothing();
        lineageCount += 1;
      }
    }

    const assets = await db
      .select({ id: dataAssets.id })
      .from(dataAssets)
      .where(and(eq(dataAssets.studyCorpusId, args.corpusId), eq(dataAssets.status, "active")));
    for (const asset of assets) {
      await db
        .insert(lineageEdges)
        .values({
          sourceType: "data_asset",
          sourceId: asset.id,
          targetType: "published_output",
          targetId: args.outputId,
          relationType: "feeds",
          metadata: { contract: SIGNAL_SERVING_CONTRACT_VERSION, source: "signal_output" }
        })
        .onConflictDoNothing();
      lineageCount += 1;
    }

    const existing = await db
      .select({ refKey: dashboardDataRefs.refKey })
      .from(dashboardDataRefs)
      .where(eq(dashboardDataRefs.outputId, args.outputId));
    const presentRefs = Array.from(new Set(existing.map((row) => row.refKey)));
    const missingRefs = REQUIRED_SIGNAL_DATA_REF_KEYS.filter((key) => !presentRefs.includes(key));

    if (required && missingRefs.length > 0) {
      return {
        status: "failed",
        refs: persisted.length,
        lineageEdges: lineageCount,
        contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
        presentRefs,
        missingRefs,
        reason: `missing_required_dashboard_data_refs:${missingRefs.join(",")}`
      };
    }

    return {
      status: "ok",
      refs: persisted.length,
      lineageEdges: lineageCount,
      contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
      presentRefs,
      missingRefs
    };
  } catch (error) {
    return {
      status: "failed",
      refs: 0,
      lineageEdges: 0,
      contractVersion: SIGNAL_SERVING_CONTRACT_VERSION,
      presentRefs: [],
      missingRefs: [...REQUIRED_SIGNAL_DATA_REF_KEYS],
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildRequiredSignalRefs(args: {
  corpusId: string;
  analysisId: string;
  snapshotId: string;
  metricFamilies: string[];
  overlapMonths: string[];
}): OutputRef[] {
  const snapshotVisibility = {
    internal: true,
    client_safe: true,
    raw_rows: true,
    sensitive_fields: "policy_redacted"
  };
  const analysisVisibility = { internal: true, client_safe: true, raw_rows: false };

  return [
    {
      refKey: "published_mentions",
      sourceType: "corpus_snapshot",
      sourceId: args.snapshotId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        table: "corpus_snapshot_mentions",
        snapshot_id: args.snapshotId,
        membership: "immutable",
        endpoint: `/api/signal/{outputId}/corpus`
      },
      visibility: snapshotVisibility
    },
    {
      refKey: "social_overview",
      sourceType: "corpus_snapshot",
      sourceId: args.snapshotId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        endpoint: `/api/signal/{outputId}/overview`,
        snapshot_id: args.snapshotId,
        grain: "snapshot"
      },
      visibility: analysisVisibility
    },
    {
      refKey: "social_timeseries",
      sourceType: "corpus_snapshot",
      sourceId: args.snapshotId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        endpoint: `/api/signal/{outputId}/overview`,
        snapshot_id: args.snapshotId,
        grain: "month",
        measures: ["mentions", "triggers", "barriers"]
      },
      visibility: analysisVisibility
    },
    {
      refKey: "social_dimensions",
      sourceType: "tb_analysis",
      sourceId: args.analysisId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        analysis_id: args.analysisId,
        dimensions: ["platform", "content_type", "polarity", "layer", "mobility", "taxonomy_tag", "feature"]
      },
      visibility: analysisVisibility
    },
    {
      refKey: "analysis_findings",
      sourceType: "tb_analysis",
      sourceId: args.analysisId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        table: "tb_findings",
        analysis_id: args.analysisId,
        grain: "finding"
      },
      visibility: analysisVisibility
    },
    {
      refKey: "analysis_opportunities",
      sourceType: "tb_analysis",
      sourceId: args.analysisId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        table: "tb_recommendations",
        analysis_id: args.analysisId,
        kinds: [...SIGNAL_OPPORTUNITY_KINDS],
        grain: "recommendation"
      },
      visibility: analysisVisibility
    },
    {
      refKey: "analysis_evidence",
      sourceType: "tb_analysis",
      sourceId: args.analysisId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        tables: [
          "tb_finding_citations",
          "tb_mention_codings",
          "record_tags",
          "record_feature_values"
        ],
        analysis_id: args.analysisId,
        snapshot_id: args.snapshotId,
        grain: "finding_mention"
      },
      visibility: analysisVisibility
    },
    {
      refKey: "cross_source_timeline",
      sourceType: "study_corpus",
      sourceId: args.corpusId,
      filters: {
        contract: SIGNAL_SERVING_CONTRACT_VERSION,
        endpoint: `/api/data-os/corpora/${args.corpusId}/readiness`,
        join_key: "month",
        left_metric: "mentions_monthly",
        right_metrics: args.metricFamilies,
        overlap_months: args.overlapMonths,
        empty_state: args.metricFamilies.length === 0 ? "social_only" : "no_overlap",
        causality: "not_inferred"
      },
      visibility: analysisVisibility
    }
  ];
}

function buildDataOsContextRefs(
  corpusId: string,
  readiness: Awaited<ReturnType<typeof getDataOsCorpusReadiness>>
): OutputRef[] {
  return [
    {
      refKey: "brand_os_context",
      sourceType: "study_corpus",
      sourceId: corpusId,
      filters: {
        contract: "noisia_data_os_cut_1",
        scope: "brand_os",
        tables: ["brand_os_profiles", "brand_os_objectives", "brand_os_briefs", "brand_os_audiences", "brand_knowledge_sources"]
      },
      visibility: { internal: true, client_safe_summary: true }
    },
    {
      refKey: "listening_mentions_monthly",
      sourceType: "study_corpus",
      sourceId: corpusId,
      filters: {
        table: "mentions",
        period_grain: "month",
        metric_key: "mentions_monthly",
        population_ref: "published_mentions"
      },
      visibility: { internal: false, raw_rows: false }
    },
    {
      refKey: "structured_observations_monthly",
      sourceType: "study_corpus",
      sourceId: corpusId,
      filters: {
        table: "data_observations",
        quality_status: "accepted",
        period_grain: "month",
        metric_families: readiness.metricFamilies.map((family) => family.family)
      },
      visibility: { internal: false, raw_rows: false }
    }
  ];
}
