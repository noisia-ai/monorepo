import { z } from "zod";

import { unauthorized, validationError } from "@/lib/api/responses";
import { getAuthenticatedAppUser } from "@/lib/auth/session";
import { pool } from "@/lib/db";
import { isUndefinedTableError } from "@/lib/db/errors";
import { getSignalOutputForUser } from "@/lib/data/signal";
import { getPublishedCorpusExplorer } from "@/lib/data-os/published-corpus-explorer";
import {
  assessSignalServingReadiness,
  getSignalServingReadiness
} from "@/lib/data-os/signal-serving";
import { buildCorpusExplorerSql } from "@/lib/live-intelligence/corpus-explorer";
import {
  hasSignalServingContract,
  SIGNAL_SERVING_CONTRACT_VERSION
} from "@/lib/signal/semantics";

const querySchema = z.object({
  q: z.string().max(500).optional().default(""),
  platform: z.string().max(80).optional().default(""),
  finding: z.string().max(80).optional().default(""),
  tag: z.string().max(160).optional().default(""),
  feature: z.string().max(160).optional().default(""),
  lens: z.string().max(120).optional().default(""),
  signalIntent: z.string().max(120).optional().default(""),
  entity: z.string().max(160).optional().default(""),
  signal: z.string().max(160).optional().default(""),
  evidenceRole: z.enum(["", "protagonist", "support", "counter"]).optional().default(""),
  dateFrom: z.string().max(20).optional().default(""),
  dateTo: z.string().max(20).optional().default(""),
  sort: z.enum(["relevance", "newest", "oldest"]).optional().default("relevance"),
  page: z.coerce.number().int().min(1).max(5000).optional().default(1),
  limit: z.coerce.number().int().min(20).max(500).optional().default(120)
});

type CorpusExplorerRouteOptions = {
  requiredMethodologySlug?: string;
  requiredKind?: string;
  forcedLensSlug?: string;
  canonicalMethodologySlug?: "signal-pulse";
  notFoundMessage?: string;
  schemaMissingMessage?: string;
};

export async function handleCorpusExplorerRequest(
  request: Request,
  context: { params: Promise<{ outputId: string }> },
  options: CorpusExplorerRouteOptions = {}
) {
  const session = await getAuthenticatedAppUser();
  if (!session) return unauthorized();

  const { outputId } = await context.params;
  const output = await getSignalOutputForUser(session.appUser, outputId);
  if (
    !output ||
    (options.requiredMethodologySlug && output.methodologySlug !== options.requiredMethodologySlug) ||
    (options.requiredKind && output.kind !== options.requiredKind)
  ) {
    return Response.json(
      { error: "not_found", message: options.notFoundMessage ?? "Signal output not found." },
      { status: 404 }
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return validationError(parsed.error);

  const filters = {
    ...parsed.data,
    lens: options.forcedLensSlug ?? parsed.data.lens
  };

  if (options.canonicalMethodologySlug !== "signal-pulse") {
    if (!output.snapshotId || !output.tbAnalysisId) {
      return Response.json(
        {
          error: "published_contract_incomplete",
          message: "This Signal output has no approved snapshot or reviewed analysis.",
          contract_version: SIGNAL_SERVING_CONTRACT_VERSION,
          missing: [
            ...(!output.snapshotId ? ["snapshot_id"] : []),
            ...(!output.tbAnalysisId ? ["tb_analysis_id"] : [])
          ]
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    try {
      if (hasSignalServingContract(output.manifest)) {
        const readiness = await getSignalServingReadiness({
          analysisId: output.tbAnalysisId,
          snapshotId: output.snapshotId,
          outputId,
          requireDataRefs: true
        });
        const assessment = assessSignalServingReadiness(readiness);
        if (!assessment.ready) {
          return Response.json(
            {
              error: "signal_serving_not_ready",
              message: "The published Signal output does not satisfy its relational serving contract.",
              contract_version: SIGNAL_SERVING_CONTRACT_VERSION,
              hard_blocks: assessment.hardBlocks,
              warnings: assessment.warnings,
              readiness
            },
            { status: 409, headers: { "Cache-Control": "no-store" } }
          );
        }
      }

      const explorer = await getPublishedCorpusExplorer({
        snapshotId: output.snapshotId,
        analysisId: output.tbAnalysisId,
        filters: {
          q: filters.q,
          platform: filters.platform,
          finding: filters.finding,
          tag: filters.tag,
          feature: filters.feature,
          entity: filters.entity,
          evidenceRole: filters.evidenceRole,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          sort: filters.sort,
          page: filters.page,
          limit: filters.limit
        }
      });
      return Response.json(explorer, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (!isUndefinedTableError(error)) throw error;
      return Response.json(
        {
          error: "data_os_schema_missing",
          message: options.schemaMissingMessage ?? "The published Data OS serving schema is not available yet."
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  const scopedCorpusIds = Array.from(new Set([output.studyCorpusId, output.baseCorpusId].flatMap((id) => id ? [id] : [])));
  const corpusSql = buildCorpusExplorerSql({ scopedCorpusIds, filters });
  const canonicalSignalIdSelect = options.canonicalMethodologySlug === "signal-pulse"
    ? "max(cs.id::text) FILTER (WHERE cs.methodology_slug = 'signal-pulse')"
    : "max(cs.id::text)";
  const canonicalSignalTitleSelect = options.canonicalMethodologySlug === "signal-pulse"
    ? "max(cs.canonical_title) FILTER (WHERE cs.methodology_slug = 'signal-pulse')"
    : "max(cs.canonical_title)";
  const canonicalSignalFacetClause = options.canonicalMethodologySlug === "signal-pulse"
    ? "AND cs.methodology_slug = 'signal-pulse'"
    : "";

  let results;
  try {
    results = await Promise.all([
      pool.query<{ total: number }>(
        `
          ${corpusSql.baseSql}
          SELECT COUNT(DISTINCT m.id)::int AS total
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
        `,
        corpusSql.countValues
      ),
      pool.query(
        `
          ${corpusSql.baseSql}
          SELECT
            m.id AS mention_id,
            CASE WHEN m.study_corpus_id = ($1::uuid[])[1] THEN 'primary' ELSE 'baseline' END AS corpus_scope,
            m.text_clean AS text,
            m.text_snippet,
            m.resolved_platform AS platform,
            m.published_at::text AS published_at,
            m.sentiment_source,
            m.url,
            m.batch_mention_type AS mention_type,
            m.batch_entity_kind AS entity_kind,
            m.batch_entity_label AS entity_label,
            m.source_file_name,
            max(f.finding_id) AS finding_id,
            max(f.nombre_comercial) AS finding_name,
            bool_or(COALESCE(fc.is_protagonist, soe.is_protagonist, soe.evidence_role = 'protagonist', false)) AS is_protagonist,
            max(soe.evidence_role) AS evidence_role,
            max(mqs.lens_slug) AS lens_slug,
            max(mqs.signal_intent) AS signal_intent,
            max(mqs.scope) AS query_scope,
            max(COALESCE(mqs.entity_id, mqs.corpus_entity_id::text, m.batch_entity_label)) AS source_entity_id,
            ${canonicalSignalIdSelect} AS canonical_signal_id,
            ${canonicalSignalTitleSelect} AS canonical_signal_title
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN tb_finding_citations fc ON fc.finding_id = f.id AND fc.mention_id = m.id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
          GROUP BY
            m.id, m.study_corpus_id, m.text_clean, m.text_snippet, m.resolved_platform,
            m.platform, m.published_at, m.sentiment_source, m.url, m.batch_mention_type,
            m.batch_entity_kind, m.batch_entity_label, m.source_file_name
          ORDER BY ${corpusSql.orderBy}, m.id
          LIMIT $${corpusSql.limitParam} OFFSET $${corpusSql.offsetParam}
        `,
        corpusSql.values
      ),
      pool.query<{ platform: string; count: number }>(
        `
          ${corpusSql.baseSql}
          SELECT COALESCE(NULLIF(m.resolved_platform, ''), 'unknown') AS platform, COUNT(*)::int AS count
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
          GROUP BY 1
          ORDER BY count DESC
          LIMIT 24
        `,
        corpusSql.countValues
      ),
      pool.query<{ finding_id: string; finding_name: string; count: number }>(
        `
          ${corpusSql.baseSql}
          SELECT
            f.finding_id,
            max(f.nombre_comercial) AS finding_name,
            COUNT(DISTINCT m.id)::int AS count
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
            AND f.finding_id IS NOT NULL
          GROUP BY f.finding_id
          ORDER BY count DESC
          LIMIT 120
        `,
        corpusSql.countValues
      ),
      pool.query<{ lens_slug: string; signal_intent: string; count: number }>(
        `
          ${corpusSql.baseSql}
          SELECT
            COALESCE(NULLIF(mqs.lens_slug, ''), 'unmapped') AS lens_slug,
            COALESCE(NULLIF(mqs.signal_intent, ''), 'unmapped') AS signal_intent,
            COUNT(DISTINCT m.id)::int AS count
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT 80
        `,
        corpusSql.countValues
      ),
      pool.query<{ entity_id: string; entity_label: string; count: number }>(
        `
          ${corpusSql.baseSql}
          SELECT
            COALESCE(mqs.entity_id, mqs.corpus_entity_id::text, m.batch_entity_label, ib.entity_label, 'unknown') AS entity_id,
            COALESCE(m.batch_entity_label, ib.entity_label, mqs.entity_id, 'unknown') AS entity_label,
            COUNT(DISTINCT m.id)::int AS count
          FROM scoped_mentions m
          LEFT JOIN import_batches ib ON ib.id = m.source_file_id
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT 80
        `,
        corpusSql.countValues
      ),
      pool.query<{ id: string; title: string; count: number }>(
        `
          ${corpusSql.baseSql}
          SELECT
            cs.id::text AS id,
            cs.canonical_title AS title,
            COUNT(DISTINCT soe.mention_id)::int AS count
          FROM scoped_mentions m
          LEFT JOIN tb_mention_codings mc ON mc.mention_id = m.id
          LEFT JOIN tb_findings f ON f.id = mc.finding_id
          LEFT JOIN mention_query_sources mqs ON mqs.mention_id = m.id
          LEFT JOIN signal_observation_evidence soe ON soe.mention_id = m.id
          LEFT JOIN signal_observations so ON so.id = soe.signal_observation_id
          LEFT JOIN canonical_signals cs ON cs.id = so.canonical_signal_id
          WHERE ${corpusSql.whereSql}
            AND cs.id IS NOT NULL
            ${canonicalSignalFacetClause}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT 80
        `,
        corpusSql.countValues
      )
    ]);
  } catch (error) {
    if (!isUndefinedTableError(error)) throw error;
    return Response.json(
      {
        error: "live_intelligence_schema_missing",
        message: options.schemaMissingMessage ?? "Live corpus schema is not migrated yet; fall back to static published evidence."
      },
      { status: 503 }
    );
  }
  const [
    countResult,
    rowsResult,
    facetsResult,
    findingFacetResult,
    lensFacetResult,
    entityFacetResult,
    signalFacetResult
  ] = results;

  return Response.json(
    {
      total: countResult.rows[0]?.total ?? 0,
      page: filters.page,
      limit: filters.limit,
      rows: rowsResult.rows,
      facets: {
        platforms: facetsResult.rows,
        findings: findingFacetResult.rows,
        lenses: lensFacetResult.rows,
        entities: entityFacetResult.rows,
        signals: signalFacetResult.rows
      }
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
