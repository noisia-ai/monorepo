import type { Job } from "bullmq";
import {
  SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
  type SignalTaxonomyEnrichmentJobDataV1
} from "@noisia/query-engine";
import {
  requireSafeDatabaseWriteTarget
} from "@noisia/db";

import { pool } from "../src/db/client";
import { signalTaxonomyEnrichmentJob } from "../src/workers/signal-taxonomy-enrichment";

const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_TAXONOMY_WORKER_ALLOW_REMOTE";
const RUN_APPROVAL_ENV = "NOISIA_SIGNAL_TAXONOMY_WORKER_APPROVED";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type Args = {
  corpusId: string;
  historicalOutputId: string;
  untrackedCostReserveUsd: number;
  kind: "topic" | "narrative" | null;
};

type RunRow = {
  id: string;
  workspace_id: string;
  study_corpus_id: string;
  profile_id: string;
  kind: "topic" | "narrative";
  corpus_revision: number;
  budget_cap_usd: string;
  status: string;
  attempt: number;
  actual_cost_usd: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2).filter((value) => value !== "--");
  const read = (name: string) => {
    const inline = argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const corpusId = read("--corpus-id")?.trim().toLowerCase() ?? "";
  const historicalOutputId =
    read("--historical-output-id")?.trim().toLowerCase() ?? "";
  const untrackedCostReserveUsd = Number(
    read("--untracked-cost-reserve-usd") ?? "0"
  );
  const kindValue = read("--kind")?.trim() ?? "";
  const kind = kindValue === "" ? null : kindValue;
  if (!UUID.test(corpusId)) throw new Error("--corpus-id must be a UUID.");
  if (!UUID.test(historicalOutputId)) {
    throw new Error("--historical-output-id must be a UUID.");
  }
  if (
    !Number.isFinite(untrackedCostReserveUsd)
    || untrackedCostReserveUsd < 0
  ) {
    throw new Error("--untracked-cost-reserve-usd must be nonnegative.");
  }
  if (kind !== null && kind !== "topic" && kind !== "narrative") {
    throw new Error("--kind must be topic or narrative.");
  }
  return { corpusId, historicalOutputId, untrackedCostReserveUsd, kind };
}

function requireLiteralTrue(name: string) {
  if (process.env[name] !== "true") {
    throw new Error(`${name}=true is required.`);
  }
}

async function loadRuns(args: Args): Promise<RunRow[]> {
  const result = await pool.query<RunRow>(`
    WITH governed_scope AS (
      SELECT workspace.id AS workspace_id
      FROM signal_workspace_corpora membership
      JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
      JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
      JOIN published_outputs output
        ON output.id = $2::uuid
       AND output.study_corpus_id = corpus.id
       AND output.status = 'published'
       AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
       AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      LEFT JOIN brands brand ON brand.id = corpus.brand_id
      LEFT JOIN themes theme ON theme.id = corpus.theme_id
      WHERE corpus.id = $1::uuid
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
        AND workspace.status = 'active'
        AND workspace.organization_id = COALESCE(
          brand.organization_id,
          theme.organization_id
        )
        AND workspace.brand_id IS NOT DISTINCT FROM corpus.brand_id
        AND workspace.theme_id IS NOT DISTINCT FROM corpus.theme_id
    )
    SELECT run.id::text, run.workspace_id::text,
      run.study_corpus_id::text, profile.id::text AS profile_id,
      profile.kind, run.input_corpus_revision AS corpus_revision,
      run.budget_cap_usd::text, run.status, run.attempt,
      COALESCE(run.actual_cost_usd, 0)::text AS actual_cost_usd
    FROM signal_refresh_runs run
    JOIN signal_taxonomy_profiles profile
      ON profile.id = run.taxonomy_profile_id
     AND profile.status = 'active'
    JOIN governed_scope scope ON scope.workspace_id = run.workspace_id
    WHERE run.study_corpus_id = $1::uuid
      AND run.run_type = 'taxonomy_enrichment'
      AND (
        run.status IN ('queued', 'running', 'failed', 'completed')
        OR (
          run.status = 'dead_letter'
          AND COALESCE(run.actual_cost_usd, 0) = 0
          AND NOT EXISTS (
            SELECT 1
            FROM record_feature_values feature
            WHERE feature.study_corpus_id = run.study_corpus_id
              AND feature.subject_type = 'mention'
              AND feature.feature_key =
                'signal_taxonomy_classification:' || profile.id::text
              AND feature.source =
                'signal_taxonomy_profile:' || profile.id::text
          )
        )
      )
    ORDER BY profile.kind, run.created_at DESC, run.id DESC
  `, [args.corpusId, args.historicalOutputId]);
  const latest = new Map<RunRow["kind"], RunRow>();
  for (const row of result.rows) {
    if (!latest.has(row.kind)) latest.set(row.kind, row);
  }
  const selected = ["topic", "narrative"].map((kind) =>
    latest.get(kind as RunRow["kind"])
  );
  if (selected.some((run) => !run)) {
    throw new Error(
      "Exactly one recoverable latest run per active taxonomy kind is required."
    );
  }
  const runs = selected as RunRow[];
  if (new Set(runs.map((run) => run.workspace_id)).size !== 1) {
    throw new Error("Taxonomy runs do not belong to one governed workspace.");
  }
  return runs;
}

async function recoverAbandonedOperatorRun(args: Args) {
  await pool.query(`
    WITH governed_scope AS (
      SELECT workspace.id AS workspace_id
      FROM signal_workspace_corpora membership
      JOIN signal_workspaces workspace ON workspace.id = membership.workspace_id
      JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
      JOIN published_outputs output
        ON output.id = $2::uuid
       AND output.study_corpus_id = corpus.id
       AND output.status = 'published'
       AND output.brand_id IS NOT DISTINCT FROM corpus.brand_id
       AND output.theme_id IS NOT DISTINCT FROM corpus.theme_id
      WHERE corpus.id = $1::uuid
        AND membership.role = 'operational'
        AND membership.valid_to IS NULL
        AND workspace.status = 'active'
    )
    UPDATE signal_refresh_runs run
    SET status = 'failed',
      error_code = 'operator_process_exited',
      error_summary = jsonb_build_object(
        'message',
        'Targeted operator process exited; durable run remains recoverable.'
      ),
      updated_at = now()
    FROM signal_taxonomy_profiles profile, governed_scope scope
    WHERE run.workspace_id = scope.workspace_id
      AND run.study_corpus_id = $1::uuid
      AND run.run_type = 'taxonomy_enrichment'
      AND run.taxonomy_profile_id = profile.id
      AND run.status = 'running'
      AND run.bullmq_job_id LIKE 'operator-%'
      AND COALESCE(run.heartbeat_at, run.started_at, run.created_at)
        < now() - interval '10 seconds'
      AND COALESCE(run.actual_cost_usd, 0) = 0
      AND NOT EXISTS (
        SELECT 1
        FROM record_feature_values feature
        WHERE feature.study_corpus_id = run.study_corpus_id
          AND feature.subject_type = 'mention'
          AND feature.feature_key =
            'signal_taxonomy_classification:' || profile.id::text
          AND feature.source =
            'signal_taxonomy_profile:' || profile.id::text
      )
  `, [args.corpusId, args.historicalOutputId]);
}

async function reserveUntrackedCost(runs: RunRow[], reserveUsd: number) {
  if (reserveUsd === 0) return;
  const failed = runs.filter((run) =>
    run.status === "failed" && Number(run.actual_cost_usd) === 0
  );
  if (failed.length !== 1) {
    throw new Error(
      "Untracked provider cost can only be reserved against one zero-cost failed run."
    );
  }
  const result = await pool.query(`
    UPDATE signal_refresh_runs
    SET actual_cost_usd = $2,
      result_summary = result_summary || jsonb_build_object(
        'untracked_provider_cost_reserve_usd', $2::numeric
      ),
      updated_at = now()
    WHERE id = $1::uuid
      AND status = 'failed'
      AND COALESCE(actual_cost_usd, 0) = 0
      AND $2 <= budget_cap_usd
    RETURNING id
  `, [failed[0]!.id, reserveUsd]);
  if (!result.rows[0]) {
    throw new Error("Failed to reserve untracked provider cost.");
  }
}

function jobFacade(run: RunRow) {
  const data: SignalTaxonomyEnrichmentJobDataV1 = {
    contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
    run_id: run.id,
    workspace_id: run.workspace_id,
    study_corpus_id: run.study_corpus_id,
    profile_id: run.profile_id,
    kind: run.kind,
    corpus_revision: run.corpus_revision,
    budget_cap_usd: Number(run.budget_cap_usd)
  };
  return {
    id: `operator-${run.id}-a${run.attempt}`,
    data,
    attemptsMade: Math.max(0, run.attempt - 1),
    opts: { attempts: 3 },
    updateProgress: async (_progress: number) => undefined
  } as unknown as Job<SignalTaxonomyEnrichmentJobDataV1>;
}

async function main() {
  const args = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "run targeted Signal taxonomy enrichment",
    allowRemoteEnv: ALLOW_REMOTE_ENV
  });
  requireLiteralTrue(RUN_APPROVAL_ENV);
  requireLiteralTrue("NOISIA_SIGNAL_TAXONOMY_ENRICHMENT_ENABLED");
  requireLiteralTrue("NOISIA_SIGNAL_TAXONOMY_LLM_ENABLED");
  requireLiteralTrue("NOISIA_DATA_OS_WORKER_ENABLED");
  if (!process.env.ANTHROPIC_API_KEY || !process.env.VOYAGE_API_KEY) {
    throw new Error("Anthropic and Voyage credentials are required.");
  }
  if (
    (process.env.NOISIA_SIGNAL_TAXONOMY_PAID_BATCH_ATTEMPTS ?? "1") !== "1"
  ) {
    throw new Error(
      "Targeted paid staging backfill requires one provider attempt per batch."
    );
  }

  try {
    await recoverAbandonedOperatorRun(args);
    const allRuns = await loadRuns(args);
    const runs = args.kind
      ? allRuns.filter((run) => run.kind === args.kind)
      : allRuns;
    await reserveUntrackedCost(runs, args.untrackedCostReserveUsd);
    const results = [];
    for (const run of runs) {
      const result = await signalTaxonomyEnrichmentJob(jobFacade(run));
      results.push({ kind: run.kind, result });
    }
    const totals = await pool.query<{
      status: string;
      kind: string;
      actual_cost_usd: string;
      input_tokens: number;
      output_tokens: number;
      processed_mentions: number;
      pending_tags: number;
      rejected_tags: number;
      approved_tags: number;
    }>(`
      SELECT run.status, profile.kind,
        COALESCE(run.actual_cost_usd, 0)::text AS actual_cost_usd,
        COALESCE(run.input_tokens, 0)::int AS input_tokens,
        COALESCE(run.output_tokens, 0)::int AS output_tokens,
        count(DISTINCT feature.subject_id)::int AS processed_mentions,
        count(DISTINCT tag.id) FILTER (
          WHERE tag.review_status IN ('pending', 'needs_review')
        )::int AS pending_tags,
        count(DISTINCT tag.id) FILTER (
          WHERE tag.review_status = 'rejected'
        )::int AS rejected_tags,
        count(DISTINCT tag.id) FILTER (
          WHERE tag.review_status = 'approved'
        )::int AS approved_tags
      FROM signal_refresh_runs run
      JOIN signal_taxonomy_profiles profile
        ON profile.id = run.taxonomy_profile_id
      LEFT JOIN record_feature_values feature
        ON feature.study_corpus_id = run.study_corpus_id
       AND feature.subject_type = 'mention'
       AND feature.feature_key =
         'signal_taxonomy_classification:' || profile.id::text
       AND feature.source = 'signal_taxonomy_profile:' || profile.id::text
      LEFT JOIN record_tags tag
        ON tag.study_corpus_id = run.study_corpus_id
       AND tag.signal_taxonomy_profile_id = profile.id
      WHERE run.id = ANY($1::uuid[])
      GROUP BY run.id, profile.id
      ORDER BY profile.kind
    `, [runs.map((run) => run.id)]);
    console.log(JSON.stringify({
      contract_version: SIGNAL_TOPICS_NARRATIVES_CONTRACT_VERSION,
      target: process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "local",
      provider_attempts_per_batch: 1,
      client_activation: false,
      results,
      runtime: totals.rows
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
