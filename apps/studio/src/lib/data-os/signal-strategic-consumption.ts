import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import {
  SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES,
  TB_METHODOLOGY_VERSION,
  TB_PIPELINE_VERSION,
  TB_PROMPT_VERSION,
  signalStrategicDeterministicSampleV1,
  signalStrategicPreflightDigestV1,
  signalStrategicProviderBudgetPlanV1,
  validateSignalCoverageDescriptorV1,
  type SignalCoverageDescriptorV1
} from "@noisia/query-engine";

import {
  type AnalysisStudySize,
  resolveAnalysisStudyPlan
} from "@/lib/analysis/study-size";
import { pool } from "@/lib/db";
import {
  loadTbAnalysisRuntimeReadiness,
  type TbAnalysisRuntimeReadiness
} from "@/lib/queue/tb-analysis";

export const SIGNAL_TB_REPORT_KEY = "triggers-barriers" as const;
export const SIGNAL_TB_STRATEGIC_CONTRACT_VERSION = "signal-tb-strategic-v1" as const;
export const SIGNAL_TB_STRATEGIC_V2_CONTRACT_VERSION = "signal-tb-strategic-v2" as const;
export const SIGNAL_TB_STRATEGIC_GATE_D_CONTRACT_VERSION =
  "signal-tb-strategic-preflight-v1" as const;
export const SIGNAL_TB_ANALYSIS_POLICY = {
  key: "primary-brand-analysis",
  version: "1",
  scopes: ["primary_brand"] as const
};

export type SignalTbStrategicPreflightInput = {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  studySize?: AnalysisStudySize;
  hardCapUsd: number;
};

export type SignalTbStrategicPreflight = {
  contract_version: typeof SIGNAL_TB_STRATEGIC_GATE_D_CONTRACT_VERSION;
  read_only: true;
  writes_performed: false;
  jobs_enqueued: 0;
  provider_calls: 0;
  ready: boolean;
  launch_authorized: boolean;
  blocking_reasons: string[];
  module_key: "triggers-barriers";
  view_key: "strategic";
  population: {
    version: number;
    total_root_count: number;
    membership_digest: string;
    definition_hash: string;
  } | null;
  authority: {
    policy_definition_hash: string;
    compiled_plan_hash: string;
    governance_digest: string;
    provenance_digest: string;
    watermark_hash: string;
    governance_unknown_count: number;
    next_policy_transition_at: string | null;
    usage_purposes: readonly ["llm-processing", "strategic-analysis"];
  } | null;
  sample: {
    algorithm: "canonical-root-sha256-rank-v1";
    count: number;
    digest: string;
    seed: string;
  } | null;
  denominator: {
    key: "snapshot-canonical-roots";
    count: number;
    canonical_ids_digest: string;
    alias_membership_count: 0;
  } | null;
  coverage: SignalCoverageDescriptorV1 | null;
  provider: {
    provider: "anthropic";
    model: string;
    prompt_version: string;
    pricing_version: string;
    input_usd_per_million_tokens: number;
    output_usd_per_million_tokens: number;
    max_input_tokens_per_call: number;
    config_digest: string;
  } | null;
  budget: {
    currency: "USD";
    estimated_cost_usd: number;
    hard_cap_usd: number;
    server_max_cap_usd: number;
    planned_provider_calls: number;
    reserved_input_tokens: number;
    reserved_output_tokens: number;
  } | null;
  execution_plan: ReturnType<typeof signalStrategicProviderBudgetPlanV1> | null;
  readiness: TbAnalysisRuntimeReadiness;
  destinations: {
    status: string;
    cancel: string;
    review: string;
    release: string;
    report: string;
    retry_policy: "durable-step-outbox-bounded-v1";
  } | null;
  preflight_digest: string | null;
};

type StrategicAuthorityRow = {
  workspace_slug: string;
  workspace_timezone: string;
  binding_id: string;
  policy_bundle_id: string;
  policy_compilation_id: string;
  governance_evaluation_id: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  membership_digest: string;
  computed_membership_digest: string;
  population_root_count: number;
  alias_membership_count: number;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  governance_digest: string;
  source_watermark_hash: string;
  governance_unknown_count: number;
  next_policy_transition_at: string | null;
  usage_purposes: string[];
  invalidation_count: number;
  study_corpus_id: string;
  corpus_revision: number;
  execution_corpus_count: number;
  min_quality_score: number | null;
  required_quality_flags: string[];
  forbidden_quality_flags: string[];
};

type StrategicRootRow = {
  mention_id: string;
  governance_path_hash: string | null;
};

type StrategicCoverageRow = {
  captured: number;
  quality_eligible: number;
  reviewed: number;
  resolved_attributed: number;
  unattributed: number;
  used_by_view: number;
};

type StrategicPreflightClient = Pick<PoolClient, "query" | "release">;

export type SignalTbStrategicPreparedLaunch = {
  authority: {
    binding_id: string;
    policy_bundle_id: string;
    policy_compilation_id: string;
    governance_evaluation_id: string;
    population_id: string;
    population_version: number;
    population_definition_hash: string;
    membership_digest: string;
    policy_definition_hash: string;
    compiled_plan_hash: string;
    governance_digest: string;
    provenance_digest: string;
    watermark_hash: string;
    next_policy_transition_at: string | null;
    usage_purposes: readonly ["llm-processing", "strategic-analysis"];
  };
  execution: {
    study_corpus_id: string;
    corpus_revision: number;
    pipeline_version: string;
    methodology_version: string;
    prompt_version: string;
  };
  sample: {
    algorithm: "canonical-root-sha256-rank-v1";
    seed: string;
    count: number;
    digest: string;
  };
  provider: NonNullable<SignalTbStrategicPreflight["provider"]>;
  budget: NonNullable<SignalTbStrategicPreflight["budget"]>;
  execution_plan: NonNullable<SignalTbStrategicPreflight["execution_plan"]>;
  destinations: NonNullable<SignalTbStrategicPreflight["destinations"]>;
  preflight_digest: string;
};

export type SignalTbStrategicPreparedPreflight = {
  public: SignalTbStrategicPreflight;
  launch: SignalTbStrategicPreparedLaunch | null;
};

export type SignalTbStrategicPreflightDependencies = {
  connect?: () => Promise<StrategicPreflightClient>;
  loadRuntimeReadiness?: () => Promise<TbAnalysisRuntimeReadiness>;
  env?: NodeJS.ProcessEnv;
};

export async function preflightSignalTbStrategicRun(
  input: SignalTbStrategicPreflightInput,
  dependencies: SignalTbStrategicPreflightDependencies = {}
): Promise<SignalTbStrategicPreflight> {
  return (await prepareSignalTbStrategicRun(input, dependencies)).public;
}

export async function prepareSignalTbStrategicRun(
  input: SignalTbStrategicPreflightInput,
  dependencies: SignalTbStrategicPreflightDependencies = {}
): Promise<SignalTbStrategicPreparedPreflight> {
  validateStrategicPreflightInput(input);
  const env = dependencies.env ?? process.env;
  const blockingReasons: string[] = [];
  let provider: ReturnType<typeof loadPinnedStrategicProvider> | null = null;
  try {
    provider = loadPinnedStrategicProvider(env);
  } catch (error) {
    blockingReasons.push(error instanceof SignalStrategicConsumptionError
      ? error.code : "provider_authority_unavailable");
  }
  const readiness = await (dependencies.loadRuntimeReadiness
    ?? (() => loadTbAnalysisRuntimeReadiness(env)))();
  if (!readiness.queue_configured) blockingReasons.push("strategic_queue_not_configured");
  if (!readiness.worker_alive) blockingReasons.push("strategic_worker_not_alive");
  if (!readiness.provider_key_configured) blockingReasons.push("strategic_provider_key_unavailable");
  if (!readiness.recovery_ready) blockingReasons.push("strategic_recovery_not_ready");

  const connect = dependencies.connect ?? (() => pool.connect());
  const client = await connect();
  let authorityRows: StrategicAuthorityRow[] = [];
  let roots: StrategicRootRow[] = [];
  let coverageRow: StrategicCoverageRow | null = null;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const authorityResult = await client.query<StrategicAuthorityRow>(
    `SELECT workspace.slug AS workspace_slug, workspace.timezone AS workspace_timezone,
       binding.id::text AS binding_id, bundle.id::text AS policy_bundle_id,
       compilation.id::text AS policy_compilation_id,
       evaluation.id::text AS governance_evaluation_id,
       population.id::text AS population_id,
       population.version AS population_version,
       population.definition_hash AS population_definition_hash,
       population.membership_digest,
       population_state.computed_membership_digest,
       population_state.population_root_count,
       population_state.alias_membership_count,
       compilation.policy_definition_hash,
       compilation.compiled_plan_hash,
       compilation.governance_digest,
       compilation.source_watermark_hash,
       compilation.governance_unknown_count,
       compilation.next_policy_transition_at::text,
       compilation.usage_purposes,
       (SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id) AS invalidation_count,
       execution.study_corpus_id::text, execution.corpus_revision,
       execution.execution_corpus_count,
       quality.min_quality_score,quality.required_quality_flags,
       quality.forbidden_quality_flags
     FROM signal_governed_view_bindings binding
     JOIN signal_workspaces workspace ON workspace.id=binding.workspace_id
     JOIN signal_workspace_reports report ON report.workspace_id=binding.workspace_id
       AND report.report_key='triggers-barriers' AND report.status='active'
     JOIN signal_population_policy_bundles bundle ON bundle.id=binding.policy_bundle_id
     JOIN signal_population_policy_compilations compilation
       ON compilation.id=binding.policy_compilation_id
     JOIN signal_population_definitions population ON population.id=binding.population_id
     JOIN signal_data_governance_evaluations evaluation
       ON evaluation.id=compilation.governance_evaluation_id
     JOIN signal_quality_policies quality ON quality.id=compilation.quality_policy_id
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS population_root_count,
         count(*) FILTER (WHERE mention.canonical_mention_id<>mention.id)::int
           AS alias_membership_count,
         'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
           membership.mention_id::text, ',' ORDER BY membership.mention_id
         ) FILTER (WHERE membership.membership_status='included'
           AND membership.removed_at IS NULL), ''), 'UTF8')), 'hex')
           AS computed_membership_digest
       FROM signal_population_memberships membership
       JOIN mentions mention ON mention.id=membership.mention_id
        AND mention.workspace_id=membership.workspace_id
       WHERE membership.population_id=population.id
         AND membership.workspace_id=binding.workspace_id
         AND membership.membership_status='included' AND membership.removed_at IS NULL
     ) population_state
     CROSS JOIN LATERAL (
       SELECT selected.study_corpus_id, selected.corpus_revision,
         selected.execution_corpus_count
       FROM (
         SELECT membership.study_corpus_id, corpus.corpus_revision,
           count(*) OVER ()::int AS execution_corpus_count,
           row_number() OVER (ORDER BY membership.valid_from,membership.id) AS ordinal
         FROM signal_workspace_corpora membership
         JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
         JOIN methodologies methodology ON methodology.id=corpus.methodology_id
         WHERE membership.workspace_id=binding.workspace_id
           AND membership.role='strategic' AND membership.valid_to IS NULL
           AND methodology.slug='triggers-barriers'
           AND corpus.analysis_plan->>'contract_version'='signal-tb-execution-corpus-v1'
       ) selected WHERE selected.ordinal=1
     ) execution
     WHERE binding.workspace_id=$1::uuid
       AND binding.module_key='triggers-barriers' AND binding.view_key='strategic'
       AND binding.binding_status='current' AND binding.effective_from <= now()
       AND (binding.effective_to IS NULL OR binding.effective_to > now())
       AND bundle.workspace_id=binding.workspace_id AND bundle.status='active'
       AND bundle.visibility_class='strategic-internal'
       AND bundle.required_usage_purposes=$2::text[]
       AND bundle.data_governance_contract_status='resolved'
       AND bundle.quality_policy_id=quality.id
       AND bundle.effective_from <= now()
       AND (bundle.effective_to IS NULL OR bundle.effective_to > now())
       AND compilation.workspace_id=binding.workspace_id
       AND compilation.policy_bundle_id=bundle.id
       AND compilation.population_id=population.id
       AND compilation.module_key='triggers-barriers' AND compilation.view_key='strategic'
       AND compilation.compilation_status='ready' AND compilation.is_current
       AND compilation.governance_unknown_count=0
       AND compilation.usage_purposes=$2::text[]
       AND compilation.quality_policy_id=quality.id
       AND compilation.quality_policy_version=quality.policy_version
       AND compilation.quality_policy_hash=quality.definition_hash
       AND (compilation.next_policy_transition_at IS NULL
         OR compilation.next_policy_transition_at > now())
       AND evaluation.evaluation_status='complete'
       AND evaluation.quality_policy_id=quality.id
       AND evaluation.module_key='triggers-barriers' AND evaluation.view_key='strategic'
       AND evaluation.usage_purposes=$2::text[]
       AND evaluation.governance_unknown_count=0
       AND evaluation.governance_digest=compilation.governance_digest
       AND evaluation.next_policy_transition_at IS NOT DISTINCT FROM compilation.next_policy_transition_at
       AND population.workspace_id=binding.workspace_id
       AND population.purpose='analysis' AND population.status='draft'
       AND population.version=compilation.population_version
       AND population.definition_hash=compilation.population_definition_hash
       AND population.membership_digest=compilation.membership_digest
       AND population.membership_digest=population_state.computed_membership_digest
       AND quality.workspace_id=binding.workspace_id AND quality.status='active'
       AND quality.effective_from <= now()
       AND (quality.effective_to IS NULL OR quality.effective_to > now())
       AND workspace.status='active' AND workspace.timezone=$3::text
     LIMIT 2`,
    [input.workspaceId, [...SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES], input.timezone]
    );
    authorityRows = authorityResult.rows;
    const exactAuthority = authorityRows.length === 1 ? authorityRows[0] : null;
    if (exactAuthority) {
      const rootsResult = await client.query<StrategicRootRow>(
        `SELECT membership.mention_id::text, item.governance_path_hash
         FROM signal_population_memberships membership
         JOIN mentions mention ON mention.id=membership.mention_id
          AND mention.workspace_id=membership.workspace_id
          AND mention.canonical_mention_id=mention.id
         LEFT JOIN signal_data_governance_evaluation_items item
           ON item.evaluation_id=$3::uuid
          AND item.workspace_id=membership.workspace_id
          AND item.mention_id=membership.mention_id
          AND item.decision='included' AND item.reason_code='policy_eligible'
         WHERE membership.workspace_id=$1::uuid
           AND membership.population_id=$2::uuid
           AND membership.membership_status='included' AND membership.removed_at IS NULL
           AND mention.published_at >= ($4::date::timestamp AT TIME ZONE $6::text)
           AND mention.published_at < (($5::date + 1)::timestamp AT TIME ZONE $6::text)
         ORDER BY membership.mention_id`,
        [input.workspaceId, exactAuthority.population_id,
          exactAuthority.governance_evaluation_id, input.periodStart, input.periodEnd,
          input.timezone]
      );
      roots = rootsResult.rows;
      const coverageResult = await client.query<StrategicCoverageRow>(
        `WITH captured AS (
           SELECT mention.* FROM mentions mention
           WHERE mention.workspace_id=$1::uuid
             AND mention.canonical_mention_id=mention.id
             AND mention.inclusion_status='included'
             AND mention.published_at >= ($3::date::timestamp AT TIME ZONE $5::text)
             AND mention.published_at < (($4::date + 1)::timestamp AT TIME ZONE $5::text)
         ), review_state AS (
           SELECT captured.id,
             bool_or(assertion.review_status IN ('approved','rejected')) AS reviewed,
             bool_or(assertion.review_status='approved'
               AND assertion.eligibility_status='eligible'
               AND assertion.scope<>'unattributed') AS resolved_attributed,
             bool_or(assertion.review_status='approved'
               AND assertion.eligibility_status='not_eligible'
               AND assertion.scope='unattributed'
               AND assertion.entity_id IS NULL) AS unattributed
           FROM captured LEFT JOIN signal_mention_attributions assertion
             ON assertion.workspace_id=$1::uuid AND assertion.mention_id=captured.id
            AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
           GROUP BY captured.id
         )
         SELECT (SELECT count(*)::int FROM captured) AS captured,
           (SELECT count(*)::int FROM captured mention
            WHERE ($6::int IS NULL OR COALESCE(mention.quality_score,-1)>=$6::int)
              AND NOT EXISTS (SELECT 1 FROM unnest($7::text[]) required(flag)
                WHERE NOT (COALESCE(mention.quality_flags,'[]'::jsonb) ? required.flag))
              AND NOT EXISTS (SELECT 1 FROM unnest($8::text[]) forbidden(flag)
                WHERE COALESCE(mention.quality_flags,'[]'::jsonb) ? forbidden.flag))
             AS quality_eligible,
           (SELECT count(*)::int FROM review_state WHERE reviewed) AS reviewed,
           (SELECT count(*)::int FROM review_state WHERE resolved_attributed)
             AS resolved_attributed,
           (SELECT count(*)::int FROM review_state WHERE unattributed) AS unattributed,
           (SELECT count(*)::int FROM signal_population_memberships membership
            JOIN mentions mention ON mention.id=membership.mention_id
              AND mention.workspace_id=membership.workspace_id
              AND mention.canonical_mention_id=mention.id
            WHERE membership.workspace_id=$1::uuid
              AND membership.population_id=$2::uuid
              AND membership.membership_status='included' AND membership.removed_at IS NULL
              AND mention.published_at >= ($3::date::timestamp AT TIME ZONE $5::text)
              AND mention.published_at < (($4::date + 1)::timestamp AT TIME ZONE $5::text))
             AS used_by_view`,
        [input.workspaceId, exactAuthority.population_id,
          input.periodStart, input.periodEnd, input.timezone, exactAuthority.min_quality_score,
          exactAuthority.required_quality_flags, exactAuthority.forbidden_quality_flags]
      );
      coverageRow = coverageResult.rows[0] ?? null;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (isUndefinedGateDSchema(error)) {
      blockingReasons.push("strategic_gate_d_schema_unavailable");
    } else {
      throw error;
    }
  } finally {
    client.release();
  }

  if (authorityRows.length !== 1) blockingReasons.push(
    authorityRows.length > 1
      ? "strategic_authority_ambiguous" : "strategic_governed_binding_unavailable"
  );
  const authorityRow = authorityRows[0] ?? null;
  if (authorityRow?.invalidation_count) blockingReasons.push("strategic_compilation_invalidated");
  if (authorityRow && authorityRow.execution_corpus_count !== 1) {
    blockingReasons.push("strategic_execution_corpus_ambiguous");
  }
  if (authorityRow && authorityRow.alias_membership_count !== 0) {
    blockingReasons.push("strategic_alias_membership_detected");
  }
  if (authorityRow
      && authorityRow.membership_digest !== authorityRow.computed_membership_digest) {
    blockingReasons.push("strategic_membership_digest_mismatch");
  }
  if (authorityRow && (
    authorityRow.governance_unknown_count !== 0
    || authorityRow.usage_purposes.join(",") !== SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES.join(",")
  )) blockingReasons.push("strategic_governance_not_exact");
  if (authorityRow && roots.some((row) => !row.governance_path_hash)) {
    blockingReasons.push("strategic_governance_provenance_incomplete");
  }
  if (authorityRow && !coverageRow) blockingReasons.push("strategic_coverage_unavailable");
  if (authorityRow && coverageRow && coverageRow.used_by_view !== roots.length) {
    blockingReasons.push("strategic_coverage_denominator_mismatch");
  }

  let sample: ReturnType<typeof signalStrategicDeterministicSampleV1> | null = null;
  let provenanceDigest: string | null = null;
  let canonicalIdsDigest: string | null = null;
  let sampleSeed: string | null = null;
  let mentionCount = 0;
  let studyPlan: ReturnType<typeof resolveAnalysisStudyPlan> | null = null;
  if (authorityRow && blockingReasons.length === 0) {
    mentionCount = roots.length;
    if (mentionCount === 0) {
      blockingReasons.push("strategic_period_empty");
    } else {
      studyPlan = resolveAnalysisStudyPlan({
        corpusMentions: mentionCount,
        requestedSize: input.studySize
      });
      sampleSeed = hashIdentity([
        "signal-strategic-sample-v1", input.workspaceId, input.periodStart,
        input.periodEnd, input.timezone, authorityRow.membership_digest
      ]);
      sample = signalStrategicDeterministicSampleV1(
        roots.map((row) => row.mention_id),
        sampleSeed,
        Math.min(studyPlan.estimatedMentions, mentionCount)
      );
      canonicalIdsDigest = sha256Digest(roots.map((row) => row.mention_id.toLowerCase())
        .sort().join(","));
      provenanceDigest = sha256Digest(roots
        .map((row) => `${row.mention_id.toLowerCase()}:${row.governance_path_hash!}`)
        .sort().join(","));
    }
  }
  const providerBudgetPlan = provider && sample ? signalStrategicProviderBudgetPlanV1({
    sample_count: sample.mention_ids.length,
    max_input_tokens_per_call: provider.maxInputTokensPerCall,
    input_usd_per_million_tokens: provider.inputUsdPerMillionTokensExact,
    output_usd_per_million_tokens: provider.outputUsdPerMillionTokensExact
  }) : null;
  const estimatedCostUsd = providerBudgetPlan?.reservation_upper_bound_usd ?? 0;
  if (provider && input.hardCapUsd > provider.serverMaxCapUsd) {
    blockingReasons.push("strategic_hard_cap_exceeds_server_max");
  }
  if (provider && input.hardCapUsd < estimatedCostUsd) {
    blockingReasons.push("strategic_hard_cap_below_estimate");
  }
  const ready = blockingReasons.length === 0 && authorityRow != null
    && sample != null && provider != null && provenanceDigest != null
    && canonicalIdsDigest != null && sampleSeed != null && studyPlan != null
    && coverageRow != null
    && Object.values(readiness).every(Boolean);
  const providerConfigDigest = provider ? hashIdentity([
    "signal-tb-provider-config-v1", "anthropic", provider.model,
    TB_PIPELINE_VERSION, TB_METHODOLOGY_VERSION, TB_PROMPT_VERSION,
    provider.pricingVersion, String(provider.inputUsdPerMillionTokens),
    String(provider.outputUsdPerMillionTokens), String(provider.maxInputTokensPerCall),
    String(provider.serverMaxCapUsd)
  ]) : null;
  const coverage = coverageRow ? strategicCoverage(coverageRow) : null;
  const destinations = authorityRow
    ? strategicDestinations(input.workspaceId, authorityRow.workspace_slug) : null;
  let preflightDigest: string | null = null;
  if (ready && authorityRow && sample && provider && provenanceDigest
      && canonicalIdsDigest && sampleSeed && providerConfigDigest && destinations && coverage) {
    preflightDigest = signalStrategicPreflightDigestV1({
      workspace_id: input.workspaceId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      timezone: input.timezone,
      study_size: input.studySize ?? "medium",
      execution: {
        study_corpus_id: authorityRow.study_corpus_id,
        corpus_revision: authorityRow.corpus_revision,
        pipeline_version: TB_PIPELINE_VERSION,
        methodology_version: TB_METHODOLOGY_VERSION
      },
      denominator: {
        key: "snapshot-canonical-roots",
        count: mentionCount,
        canonical_ids_digest: canonicalIdsDigest,
        alias_membership_count: 0
      },
      coverage,
      sample_count: sample.mention_ids.length,
      sample_digest: sample.digest,
      sample_seed: sampleSeed,
      authority: {
        binding_id: authorityRow.binding_id,
        policy_bundle_id: authorityRow.policy_bundle_id,
        policy_compilation_id: authorityRow.policy_compilation_id,
        governance_evaluation_id: authorityRow.governance_evaluation_id,
        population_id: authorityRow.population_id,
        population_version: authorityRow.population_version,
        population_definition_hash: authorityRow.population_definition_hash,
        policy_definition_hash: authorityRow.policy_definition_hash,
        compiled_plan_hash: authorityRow.compiled_plan_hash,
        membership_digest: authorityRow.membership_digest,
        governance_digest: authorityRow.governance_digest,
        provenance_digest: provenanceDigest,
        watermark_hash: authorityRow.source_watermark_hash,
        governance_unknown_count: 0,
        next_policy_transition_at: authorityRow.next_policy_transition_at
      },
      provider: {
        provider: "anthropic",
        model: provider.model,
        prompt_version: TB_PROMPT_VERSION,
        pricing_version: provider.pricingVersion,
        input_usd_per_million_tokens: provider.inputUsdPerMillionTokens,
        output_usd_per_million_tokens: provider.outputUsdPerMillionTokens,
        config_digest: providerConfigDigest
      },
      budget: {
        currency: "USD",
        estimated_cost_usd: estimatedCostUsd,
        hard_cap_usd: input.hardCapUsd,
        planned_provider_calls: providerBudgetPlan!.planned_provider_calls,
        reserved_input_tokens: providerBudgetPlan!.reserved_input_tokens,
        reserved_output_tokens: providerBudgetPlan!.reserved_output_tokens
      },
      readiness: readiness as {
        queue_configured: true; worker_alive: true;
        provider_key_configured: true; recovery_ready: true;
      },
      destinations
    });
  }
  const publicPreflight: SignalTbStrategicPreflight = {
    contract_version: SIGNAL_TB_STRATEGIC_GATE_D_CONTRACT_VERSION,
    read_only: true,
    writes_performed: false,
    jobs_enqueued: 0,
    provider_calls: 0,
    ready,
    launch_authorized: isPaidStrategicLaunchAuthorized(env),
    blocking_reasons: [...new Set(blockingReasons)].sort(),
    module_key: "triggers-barriers",
    view_key: "strategic",
    population: authorityRow ? {
      version: authorityRow.population_version,
      total_root_count: authorityRow.population_root_count,
      membership_digest: authorityRow.membership_digest,
      definition_hash: authorityRow.population_definition_hash
    } : null,
    authority: authorityRow && provenanceDigest ? {
      policy_definition_hash: authorityRow.policy_definition_hash,
      compiled_plan_hash: authorityRow.compiled_plan_hash,
      governance_digest: authorityRow.governance_digest,
      provenance_digest: provenanceDigest,
      watermark_hash: authorityRow.source_watermark_hash,
      governance_unknown_count: authorityRow.governance_unknown_count,
      next_policy_transition_at: authorityRow.next_policy_transition_at,
      usage_purposes: SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES
    } : null,
    sample: sample ? {
      algorithm: sample.algorithm,
      count: sample.mention_ids.length,
      digest: sample.digest,
      seed: sampleSeed!
    } : null,
    denominator: canonicalIdsDigest ? {
      key: "snapshot-canonical-roots",
      count: mentionCount,
      canonical_ids_digest: canonicalIdsDigest,
      alias_membership_count: 0
    } : null,
    coverage,
    provider: provider ? {
      provider: "anthropic",
      model: provider.model,
      prompt_version: TB_PROMPT_VERSION,
      pricing_version: provider.pricingVersion,
      input_usd_per_million_tokens: provider.inputUsdPerMillionTokens,
      output_usd_per_million_tokens: provider.outputUsdPerMillionTokens,
      max_input_tokens_per_call: provider.maxInputTokensPerCall,
      config_digest: providerConfigDigest!
    } : null,
    budget: provider && providerBudgetPlan ? {
      currency: "USD",
      estimated_cost_usd: estimatedCostUsd,
      hard_cap_usd: input.hardCapUsd,
      server_max_cap_usd: provider.serverMaxCapUsd,
      planned_provider_calls: providerBudgetPlan!.planned_provider_calls,
      reserved_input_tokens: providerBudgetPlan!.reserved_input_tokens,
      reserved_output_tokens: providerBudgetPlan!.reserved_output_tokens
    } : null,
    execution_plan: providerBudgetPlan,
    readiness,
    destinations,
    preflight_digest: preflightDigest
  };
  const launch = ready && authorityRow && sample && sampleSeed && provider
      && providerConfigDigest && preflightDigest && provenanceDigest
    ? {
        authority: {
          binding_id: authorityRow.binding_id,
          policy_bundle_id: authorityRow.policy_bundle_id,
          policy_compilation_id: authorityRow.policy_compilation_id,
          governance_evaluation_id: authorityRow.governance_evaluation_id,
          population_id: authorityRow.population_id,
          population_version: authorityRow.population_version,
          population_definition_hash: authorityRow.population_definition_hash,
          membership_digest: authorityRow.membership_digest,
          policy_definition_hash: authorityRow.policy_definition_hash,
          compiled_plan_hash: authorityRow.compiled_plan_hash,
          governance_digest: authorityRow.governance_digest,
          provenance_digest: provenanceDigest,
          watermark_hash: authorityRow.source_watermark_hash,
          next_policy_transition_at: authorityRow.next_policy_transition_at,
          usage_purposes: SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES
        },
        execution: {
          study_corpus_id: authorityRow.study_corpus_id,
          corpus_revision: authorityRow.corpus_revision,
          pipeline_version: TB_PIPELINE_VERSION,
          methodology_version: TB_METHODOLOGY_VERSION,
          prompt_version: TB_PROMPT_VERSION
        },
        sample: {
          algorithm: sample.algorithm,
          seed: sampleSeed,
          count: sample.mention_ids.length,
          digest: sample.digest
        },
        provider: publicPreflight.provider!,
        budget: publicPreflight.budget!,
        execution_plan: providerBudgetPlan!,
        destinations: publicPreflight.destinations!,
        preflight_digest: preflightDigest
      } satisfies SignalTbStrategicPreparedLaunch
    : null;
  return { public: publicPreflight, launch };
}

export function assertSignalTbStrategicLaunchRequest(args: {
  preflight: SignalTbStrategicPreflight;
  submittedPreflightDigest: string;
  submittedHardCapUsd: number;
}) {
  if (!args.preflight.ready || !args.preflight.launch_authorized
    || !args.preflight.preflight_digest
    || args.submittedPreflightDigest !== args.preflight.preflight_digest) {
    throw new SignalStrategicConsumptionError(
      "strategic_preflight_required",
      "A current, exact governed strategic preflight is required before launch."
    );
  }
  if (!args.preflight.budget
    || args.submittedHardCapUsd !== args.preflight.budget.hard_cap_usd) {
    throw new SignalStrategicConsumptionError(
      "strategic_hard_cap_mismatch",
      "The launch hard cap must exactly match the sealed preflight."
    );
  }
}

export type LaunchSignalTbStrategicRunV2Input = {
  workspaceId: string;
  actorUserId: string;
  idempotencyKey: string;
  prepared: SignalTbStrategicPreparedLaunch;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  businessQuestion?: string | null;
  decisionToInform?: string | null;
  queryable?: Pick<typeof pool, "query">;
};

export type SignalTbStrategicRunV2LaunchResult = {
  contract_version: "signal-tb-strategic-launch-v2";
  analysis_id: string;
  created: boolean;
  status: "queued";
  destinations: NonNullable<SignalTbStrategicPreflight["destinations"]>;
};

/**
 * The only Studio writer for a governed strategic run. Authority identifiers
 * come exclusively from the exact read-only preflight above; callers cannot
 * substitute a population, binding, bundle, compilation or evaluation.
 */
export async function launchSignalTbStrategicRunV2(
  input: LaunchSignalTbStrategicRunV2Input
): Promise<SignalTbStrategicRunV2LaunchResult> {
  if (!isPaidStrategicLaunchAuthorized(process.env)) {
    throw new SignalStrategicConsumptionError(
      "strategic_paid_run_not_authorized",
      "Paid strategic runs require explicit server-side operator authorization."
    );
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
    throw new SignalStrategicConsumptionError(
      "invalid_idempotency_key",
      "A stable Idempotency-Key of at most 200 characters is required."
    );
  }
  if (input.prepared.authority.usage_purposes.join(",")
      !== SIGNAL_STRATEGIC_GATE_D_USAGE_PURPOSES.join(",")) {
    throw new SignalStrategicConsumptionError(
      "strategic_governance_not_exact",
      "Strategic launch requires exactly llm-processing and strategic-analysis."
    );
  }
  const serverIdempotencyKey = hashIdentity([
    "signal-tb-strategic-run-v2", input.workspaceId, SIGNAL_TB_REPORT_KEY,
    input.idempotencyKey
  ]);
  const targetRequestWithoutDigest = {
    authority: input.prepared.authority,
    execution: {
      study_corpus_id: input.prepared.execution.study_corpus_id,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      timezone: input.timezone,
      pipeline_version: input.prepared.execution.pipeline_version,
      methodology_version: input.prepared.execution.methodology_version,
      prompt_version: input.prepared.execution.prompt_version,
      model_version: input.prepared.provider.model,
      pricing_version: input.prepared.provider.pricing_version,
      provider: input.prepared.provider.provider,
      input_usd_per_million_tokens:
        input.prepared.provider.input_usd_per_million_tokens,
      output_usd_per_million_tokens:
        input.prepared.provider.output_usd_per_million_tokens,
      max_input_tokens_per_call:
        input.prepared.provider.max_input_tokens_per_call,
      provider_config_digest: input.prepared.provider.config_digest,
      estimated_cost_usd: input.prepared.budget.estimated_cost_usd,
      hard_cap_usd: input.prepared.budget.hard_cap_usd,
      business_question: input.businessQuestion ?? null,
      decision_to_inform: input.decisionToInform ?? null,
      corpus_revision: input.prepared.execution.corpus_revision
    },
    sample: input.prepared.sample,
    execution_plan: input.prepared.execution_plan,
    preflight_digest: input.prepared.preflight_digest,
    idempotency_key: serverIdempotencyKey
  };
  const queryable = input.queryable ?? pool;
  const result = await queryable.query<{
    run_control_id: string;
    tb_analysis_id: string;
    snapshot_id: string;
    run_outbox_id: string;
    step_outbox_id: string;
    created: boolean;
  }>(
    `WITH request AS (
       SELECT $5::jsonb AS body
     ), plan_sealed AS (
       SELECT jsonb_set(body,'{execution_plan}',
         (body->'execution_plan') || jsonb_build_object(
           'digest',signal_strategic_execution_plan_digest_v1(
             body->'execution_plan',body->'execution'->>'pipeline_version',
             body->'execution'->>'prompt_version'
           )
         )
       ) AS body
       FROM request
     ), sealed AS (
       SELECT body || jsonb_build_object(
         'request_digest', signal_strategic_launch_request_digest_v1(body)
       ) AS body
       FROM plan_sealed
     )
     SELECT launched.run_control_id::text,launched.tb_analysis_id::text,
       launched.snapshot_id::text,launched.run_outbox_id::text,
       launched.step_outbox_id::text,launched.created
     FROM sealed
     CROSS JOIN LATERAL launch_signal_tb_strategic_run_v2(
       $1::uuid,$2::uuid,$3::text,$4::text,sealed.body
     ) launched`,
    [input.workspaceId, input.actorUserId, serverIdempotencyKey,
      input.prepared.preflight_digest, JSON.stringify(targetRequestWithoutDigest)]
  );
  const row = result.rows[0];
  if (!row) throw new Error("signal_strategic_run_v2_not_created");
  return {
    contract_version: "signal-tb-strategic-launch-v2",
    analysis_id: row.tb_analysis_id,
    created: row.created,
    status: "queued",
    destinations: replaceStrategicDestinationAnalysisId(
      input.prepared.destinations,row.tb_analysis_id
    )
  };
}

export type SignalTbStrategicReviewScope = {
  study_corpus_id: string;
  snapshot_id: string;
  status: string;
  run_status: "needs_review" | "completed";
  failed_gates: number;
};

export type SignalTbStrategicRunStatus = {
  status: string;
  current_step: string;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  last_heartbeat_at: string | null;
  authority_valid_until: string | null;
  provider: {
    provider: "anthropic";
    model_version: string;
    prompt_version: string;
    pricing_version: string;
  };
  budget: {
    currency: "USD";
    reserved_cost_usd: number;
    actual_cost_usd: number;
    hard_cap_usd: number;
  };
  steps: {
    completed: number;
    pending: number;
    failed: number;
  };
  latest_step: {
    pipeline_step: string;
    status: string;
    attempt: number;
    dispatch_attempt: number;
    error_code: string | null;
  } | null;
  review_ready: boolean;
  release_ready: boolean;
  destinations: NonNullable<SignalTbStrategicPreflight["destinations"]>;
};

export async function loadSignalTbStrategicRunStatus(args: {
  workspaceId: string;
  analysisId: string;
}): Promise<SignalTbStrategicRunStatus | null> {
  const result = await pool.query<{
    status: string;
    current_step: string;
    workspace_slug: string;
    cancel_requested_at: string | null;
    cancelled_at: string | null;
    last_heartbeat_at: string | null;
    authority_valid_until: string | null;
    provider: "anthropic";
    model_version: string;
    prompt_version: string;
    pricing_version: string;
    reserved_cost_usd: string;
    actual_cost_usd: string;
    hard_cap_usd: string;
    completed_steps: number;
    pending_steps: number;
    failed_steps: number;
    latest_pipeline_step: string | null;
    latest_step_status: string | null;
    latest_step_attempt: number | null;
    latest_dispatch_attempt: number | null;
    latest_error_code: string | null;
    failed_gates: number;
    release_ready: boolean;
  }>(
    `SELECT control.status,analysis.current_step,workspace.slug AS workspace_slug,
       control.cancel_requested_at::text,control.cancelled_at::text,
       control.last_heartbeat_at::text,control.reserved_cost_usd::text,
       control.authority_valid_until::text,control.provider,control.model_version,
       control.prompt_version,control.pricing_version,
       control.actual_cost_usd::text,control.hard_cap_usd::text,
       (SELECT count(*)::int FROM signal_strategic_step_outbox step
        WHERE step.run_control_id=control.id AND step.status='completed') AS completed_steps,
       (SELECT count(*)::int FROM signal_strategic_step_outbox step
        WHERE step.run_control_id=control.id
          AND step.status IN ('pending','dispatching','dispatched','running')) AS pending_steps,
       (SELECT count(*)::int FROM signal_strategic_step_outbox step
        WHERE step.run_control_id=control.id
          AND step.status IN ('failed','dead_letter')) AS failed_steps,
       latest.pipeline_step AS latest_pipeline_step,latest.status AS latest_step_status,
       latest.attempt AS latest_step_attempt,latest.dispatch_attempt AS latest_dispatch_attempt,
       CASE WHEN NULLIF(latest.last_error->>'code','') IS NULL THEN NULL
        ELSE left(regexp_replace(latest.last_error->>'code','[^a-zA-Z0-9._-]','','g'),120)
       END AS latest_error_code,
       (SELECT count(*)::int FROM tb_quality_gates gate
        WHERE gate.tb_analysis_id=analysis.id AND NOT gate.passed) AS failed_gates,
       (analysis.status IN ('approved_by_im','approved_by_kam')) AS release_ready
     FROM signal_strategic_run_controls control
     JOIN tb_analyses analysis ON analysis.id=control.tb_analysis_id
       AND analysis.workspace_id=control.workspace_id
     JOIN signal_workspaces workspace ON workspace.id=control.workspace_id
     LEFT JOIN LATERAL (
       SELECT step.pipeline_step,step.status,step.attempt,step.dispatch_attempt,step.last_error
       FROM signal_strategic_step_outbox step WHERE step.run_control_id=control.id
       ORDER BY step.created_at DESC,step.id DESC LIMIT 1
     ) latest ON true
     WHERE control.workspace_id=$1::uuid AND control.tb_analysis_id=$2::uuid
       AND analysis.strategic_contract_version=$3::text`,
    [args.workspaceId, args.analysisId, SIGNAL_TB_STRATEGIC_V2_CONTRACT_VERSION]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    current_step: row.current_step,
    cancel_requested_at: row.cancel_requested_at,
    cancelled_at: row.cancelled_at,
    last_heartbeat_at: row.last_heartbeat_at,
    authority_valid_until: row.authority_valid_until,
    provider: {
      provider: row.provider,
      model_version: row.model_version,
      prompt_version: row.prompt_version,
      pricing_version: row.pricing_version
    },
    budget: {
      currency: "USD",
      reserved_cost_usd: Number(row.reserved_cost_usd),
      actual_cost_usd: Number(row.actual_cost_usd),
      hard_cap_usd: Number(row.hard_cap_usd)
    },
    steps: {
      completed: row.completed_steps,
      pending: row.pending_steps,
      failed: row.failed_steps
    },
    latest_step: row.latest_pipeline_step && row.latest_step_status
      ? {
          pipeline_step: row.latest_pipeline_step,
          status: row.latest_step_status,
          attempt: row.latest_step_attempt ?? 0,
          dispatch_attempt: row.latest_dispatch_attempt ?? 0,
          error_code: row.latest_error_code
        }
      : null,
    review_ready: ["needs_review", "completed"].includes(row.status)
      && row.failed_gates === 0,
    release_ready: row.release_ready && row.failed_gates === 0,
    destinations: replaceStrategicDestinationAnalysisId(
      strategicDestinations(args.workspaceId, row.workspace_slug),args.analysisId
    )
  };
}

export async function requestSignalTbStrategicRunCancel(args: {
  workspaceId: string;
  analysisId: string;
  actorUserId: string;
}): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    `SELECT request_signal_strategic_run_cancel_v1($1::uuid,$2::uuid,$3::uuid) AS status`,
    [args.workspaceId, args.analysisId, args.actorUserId]
  );
  return result.rows[0]?.status ?? null;
}

export async function loadSignalTbStrategicReviewScope(args: {
  workspaceId: string;
  analysisId: string;
}): Promise<SignalTbStrategicReviewScope | null> {
  const result = await pool.query<SignalTbStrategicReviewScope>(
    `SELECT analysis.study_corpus_id::text, analysis.snapshot_id::text,
       analysis.status, control.status AS run_status,
       (SELECT count(*)::integer FROM tb_quality_gates gate
        WHERE gate.tb_analysis_id = analysis.id AND gate.passed = false) AS failed_gates
     FROM tb_analyses analysis
     JOIN signal_workspace_reports report
       ON report.workspace_id = analysis.workspace_id
      AND report.report_key = analysis.report_key
     JOIN signal_strategic_run_controls control
       ON control.workspace_id=analysis.workspace_id
      AND control.tb_analysis_id=analysis.id
      AND control.snapshot_id=analysis.snapshot_id
      AND control.status IN ('needs_review','completed')
     WHERE analysis.id = $1::uuid
       AND analysis.workspace_id = $2::uuid
      AND analysis.report_key = $3::text
      AND analysis.strategic_contract_version = $4::text`,
    [
      args.analysisId,
      args.workspaceId,
      SIGNAL_TB_REPORT_KEY,
      SIGNAL_TB_STRATEGIC_V2_CONTRACT_VERSION
    ]
  );
  return result.rows[0] ?? null;
}

function validateStrategicPreflightInput(input: SignalTbStrategicPreflightInput) {
  if (!input.workspaceId) throw new Error("workspaceId is required");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.periodStart)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(input.periodEnd)
      || input.periodStart > input.periodEnd) {
    throw new SignalStrategicConsumptionError("invalid_period", "The strategic period is invalid.");
  }
  if (!input.timezone.trim() || input.timezone.length > 100) {
    throw new SignalStrategicConsumptionError("invalid_timezone", "The workspace timezone is required.");
  }
  if (!Number.isFinite(input.hardCapUsd) || input.hardCapUsd <= 0) {
    throw new SignalStrategicConsumptionError(
      "strategic_hard_cap_required",
      "A positive USD hard cap is required for the free preflight."
    );
  }
}

function loadPinnedStrategicProvider(env: NodeJS.ProcessEnv) {
  const model = env.NOISIA_SIGNAL_TB_MODEL?.trim();
  const pricingVersion = env.NOISIA_SIGNAL_TB_PRICING_VERSION?.trim();
  const inputUsdPerMillionTokensExact = env.NOISIA_SIGNAL_TB_INPUT_USD_PER_MTOK?.trim() ?? "";
  const outputUsdPerMillionTokensExact = env.NOISIA_SIGNAL_TB_OUTPUT_USD_PER_MTOK?.trim() ?? "";
  const inputUsdPerMillionTokens = Number(inputUsdPerMillionTokensExact);
  const outputUsdPerMillionTokens = Number(outputUsdPerMillionTokensExact);
  const serverMaxCapUsd = Number(env.NOISIA_SIGNAL_TB_MAX_BUDGET_USD);
  const maxInputTokensPerCall = Number(
    env.NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL
  );
  if (!model || !pricingVersion
      || !Number.isFinite(inputUsdPerMillionTokens) || inputUsdPerMillionTokens <= 0
      || !Number.isFinite(outputUsdPerMillionTokens) || outputUsdPerMillionTokens <= 0
      || !Number.isFinite(serverMaxCapUsd) || serverMaxCapUsd <= 0
      || !Number.isSafeInteger(maxInputTokensPerCall) || maxInputTokensPerCall <= 0) {
    throw new SignalStrategicConsumptionError(
      "provider_authority_unavailable",
      "Pinned model, pricing authority and server hard cap are required."
    );
  }
  return {
    model,
    pricingVersion,
    inputUsdPerMillionTokens,
    outputUsdPerMillionTokens,
    inputUsdPerMillionTokensExact,
    outputUsdPerMillionTokensExact,
    maxInputTokensPerCall,
    serverMaxCapUsd
  };
}

function isPaidStrategicLaunchAuthorized(env: NodeJS.ProcessEnv) {
  return env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED === "true";
}

function strategicCoverage(row: StrategicCoverageRow): SignalCoverageDescriptorV1 {
  const available = (count: number) => ({ availability: "available" as const, count });
  const unavailable = { availability: "not_available" as const, count: null };
  return validateSignalCoverageDescriptorV1({
    state: "partial",
    captured: available(row.captured),
    quality_eligible: available(row.quality_eligible),
    unreviewed: available(row.captured - row.reviewed),
    reviewed: available(row.reviewed),
    resolved_attributed: available(row.resolved_attributed),
    abstained: unavailable,
    unattributed: available(row.unattributed),
    used_by_view: available(row.used_by_view)
  });
}

function strategicDestinations(workspaceId: string, workspaceSlug: string) {
  const base = `/api/data-os/signal/${encodeURIComponent(workspaceId)}`;
  const run = `${base}/reports/triggers-barriers/runs/:analysisId`;
  return {
    status: run,
    cancel: run,
    review: `${run}/review`,
    release: `${base}/releases`,
    report: `/signal/${encodeURIComponent(workspaceSlug)}/reports/triggers-barriers`,
    retry_policy: "durable-step-outbox-bounded-v1" as const
  };
}

function replaceStrategicDestinationAnalysisId(
  destinations: NonNullable<SignalTbStrategicPreflight["destinations"]>,
  analysisId: string
) {
  return Object.fromEntries(Object.entries(destinations).map(
    ([key, value]) => [key, typeof value === "string"
      ? value.replace(":analysisId", analysisId) : value]
  )) as NonNullable<SignalTbStrategicPreflight["destinations"]>;
}

function isUndefinedGateDSchema(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown };
  return candidate.code === "42P01" || candidate.code === "42703";
}

function hashIdentity(parts: string[]) {
  return `sha256:${createHash("sha256").update(parts.join("|"), "utf8").digest("hex")}`;
}

function sha256Digest(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export class SignalStrategicConsumptionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SignalStrategicConsumptionError";
  }
}
