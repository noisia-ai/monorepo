import "dotenv/config";

import pg from "pg";

import {
  getDatabaseSslConfig,
  requireSafeDatabaseReadTarget
} from "../../../infrastructure/db/seeds/connection";
import type { ResolvedSignalWorkspace } from "../src/lib/data-os/signal-workspace";
import { loadSignalWorkspaceHomeV1 } from "../src/lib/data-os/signal-workspace-home";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READY_INTERPRETATION_STATES = new Set(["fresh", "stale", "partial"]);
const EXPECTED_METRIC_GROUPS = new Set([
  "conversation_volume_velocity",
  "sentiment_emotion",
  "platform_source_mix",
  "engagement",
  "topics_narratives_entities"
]);

type ShadowScope = {
  workspace_id: string;
  organization_id: string;
  slug: string;
  brand_id: string | null;
  theme_id: string | null;
  timezone: string;
  workspace_status: string;
  corpus_id: string;
  corpus_name: string | null;
  corpus_status: string;
  membership_role: "operational" | "legacy";
  membership_valid_from: Date;
  active_operational_count: number;
  legacy_output_matches: boolean;
  legacy_mentions: number;
};

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const workspaceId = requiredUuid("NOISIA_SIGNAL_WORKSPACE_ID");
  const corpusId = requiredUuid("NOISIA_DATA_OS_BACKFILL_CORPUS_ID");
  const outputId = requiredUuid("NOISIA_DATA_OS_SHADOW_OUTPUT_ID");
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "signal:v2:shadow",
    allowRemoteEnv: "NOISIA_SIGNAL_V2_SHADOW_ALLOW_REMOTE"
  });

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  try {
    const scope = await pool.query<ShadowScope>(
      `WITH membership_scope AS (
         SELECT membership.workspace_id,
           COUNT(*) FILTER (WHERE membership.role = 'operational')::integer AS active_operational_count
         FROM signal_workspace_corpora membership
         WHERE membership.workspace_id = $1::uuid
           AND membership.valid_to IS NULL
         GROUP BY membership.workspace_id
       )
       SELECT
         workspace.id::text AS workspace_id,
         workspace.organization_id::text,
         workspace.slug,
         workspace.brand_id::text,
         workspace.theme_id::text,
         workspace.timezone,
         workspace.status AS workspace_status,
         corpus.id::text AS corpus_id,
         corpus.name AS corpus_name,
         corpus.status AS corpus_status,
         membership.role AS membership_role,
         membership.valid_from AS membership_valid_from,
         COALESCE(membership_scope.active_operational_count, 0)::integer AS active_operational_count,
         EXISTS (
           SELECT 1
           FROM published_outputs output
           WHERE output.id = $3::uuid
             AND output.study_corpus_id = corpus.id
             AND output.status = 'published'
             AND (
               (
                 output.methodology_slug = 'signal-pulse'
                 AND output.kind = 'signal_pulse'
               )
               OR (
                 output.methodology_slug = 'triggers-barriers'
                 AND output.kind = 'signal'
               )
             )
             AND output.brand_id IS NOT DISTINCT FROM workspace.brand_id
             AND output.theme_id IS NOT DISTINCT FROM workspace.theme_id
         ) AS legacy_output_matches,
         (
           SELECT COUNT(*)::integer
           FROM mentions mention
           WHERE mention.study_corpus_id = corpus.id
             AND mention.inclusion_status = 'included'
         ) AS legacy_mentions
       FROM signal_workspaces workspace
       JOIN signal_workspace_corpora membership
         ON membership.workspace_id = workspace.id
        AND membership.valid_to IS NULL
        AND membership.role IN ('operational', 'legacy')
       JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
       LEFT JOIN membership_scope ON membership_scope.workspace_id = workspace.id
       WHERE workspace.id = $1::uuid
         AND corpus.id = $2::uuid
       ORDER BY CASE membership.role WHEN 'operational' THEN 0 ELSE 1 END,
         membership.valid_from DESC, membership.id
       LIMIT 1`,
      [workspaceId, corpusId, outputId]
    );
    const row = scope.rows[0];
    if (!row) throw new Error("Signal V2 workspace/corpus scope was not found.");
    if (row.active_operational_count > 1) {
      throw new Error("Signal V2 workspace has ambiguous active operational corpora.");
    }

    const workspace: ResolvedSignalWorkspace = {
      contractVersion: "signal-backend-v1",
      id: row.workspace_id,
      organizationId: row.organization_id,
      slug: row.slug,
      subject: row.brand_id
        ? { type: "brand", id: row.brand_id }
        : { type: "theme", id: row.theme_id as string },
      timezone: row.timezone,
      status: row.workspace_status,
      corpora: [{
        id: row.corpus_id,
        name: row.corpus_name,
        role: row.membership_role,
        status: row.corpus_status,
        validFrom: row.membership_valid_from.toISOString()
      }]
    };
    const [internalFacade, clientFacade, tables, comparison] = await Promise.all([
      loadSignalWorkspaceHomeV1(workspace, true),
      loadSignalWorkspaceHomeV1(workspace, false),
      pool.query<{ name: string }>(
        `SELECT name
         FROM unnest($1::text[]) AS required_tables(name)
         WHERE to_regclass('public.' || name) IS NOT NULL
         ORDER BY name`,
        [[
          "metric_materializations",
          "metric_interpretations",
          "signal_workspace_releases",
          "tb_finding_temporal_comparisons"
        ]]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM tb_finding_temporal_comparisons comparison
         JOIN tb_analyses analysis
           ON analysis.id = comparison.tb_analysis_id
          AND analysis.comparison_compatibility_state = 'compatible'
         JOIN signal_workspace_releases release
           ON release.tb_analysis_id = comparison.tb_analysis_id
         WHERE release.workspace_id = $1::uuid`,
        [workspaceId]
      )
    ]);

    const groups = internalFacade.metric_groups as Array<{
      key?: string;
      metrics?: Array<{ state?: string }>;
    }>;
    const materializedGroups = groups.filter((group) =>
      group.key
      && EXPECTED_METRIC_GROUPS.has(group.key)
      && (group.metrics?.length ?? 0) > 0
    );
    const interpretations = internalFacade.interpretations as Array<{
      metric_group_key?: string;
      state?: string;
      generated_by?: string;
      review_status?: string;
    }>;
    const interpretationGroups = interpretations.filter((interpretation) =>
      interpretation.metric_group_key
      && EXPECTED_METRIC_GROUPS.has(interpretation.metric_group_key)
      && READY_INTERPRETATION_STATES.has(interpretation.state ?? "")
      && interpretation.generated_by === "claude"
      && ["auto_published", "approved"].includes(interpretation.review_status ?? "")
    );
    const checks = {
      workspace_identity_stable:
        internalFacade.workspace.workspace_id === workspaceId
        && internalFacade.workspace.subject.id === workspace.subject.id,
      operational_membership_unambiguous:
        row.active_operational_count === 1 && row.membership_role === "operational",
      legacy_output_mapping_matches: row.legacy_output_matches,
      legacy_coverage_reconciled:
        internalFacade.coverage.mentions === Number(row.legacy_mentions),
      five_metric_groups_materialized: materializedGroups.length === EXPECTED_METRIC_GROUPS.size,
      five_claude_interpretations_reviewed: interpretationGroups.length === EXPECTED_METRIC_GROUPS.size,
      strategic_release_current:
        internalFacade.strategic.current?.status === "published"
        && internalFacade.strategic.current?.is_current === true,
      compatible_temporal_comparison: Number(comparison.rows[0]?.count ?? 0) > 0,
      client_visibility_sanitized:
        clientFacade.visibility.internal === false
        && clientFacade.visibility.source_type === false
        && clientFacade.visibility.quality_details === false
        && JSON.stringify(clientFacade).includes("quality_state") === false
        && JSON.stringify(clientFacade).includes("data_scope") === false,
      canonical_tables_present: tables.rows.length === 4,
      legacy_fallback_explicit:
        clientFacade.legacy_fallback.source_of_truth === false
        && clientFacade.legacy_fallback.identity === "outputId",
      client_flags_off:
        process.env.NOISIA_SIGNAL_WORKSPACE_API_ENABLED !== "true"
        && process.env.NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED !== "true"
    };
    const failed = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key);
    const ready = failed.length === 0;
    console.log(JSON.stringify({
      ready_for_backend_signal_v2: ready,
      identifiers_redacted: true,
      checks,
      failed,
      metric_groups_materialized: materializedGroups.length,
      claude_interpretations_reviewed: interpretationGroups.length,
      legacy_mentions: Number(row.legacy_mentions),
      facade_mentions: internalFacade.coverage.mentions,
      llm_spend_usd: 0,
      client_activation: false
    }, null, 2));
    if (!ready) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredUuid(name: string) {
  const value = required(name).toLowerCase();
  if (!UUID.test(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
