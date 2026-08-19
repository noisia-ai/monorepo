import {
  SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD,
  SIGNAL_SEMANTIC_RESOLUTION_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL,
  SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
  SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
  estimateSignalSemanticResolutionCostV1,
  estimateSignalSemanticResolutionCostV2,
  signalSemanticStableHashV1,
  type SignalSemanticResolutionClassificationV1,
  type SignalSemanticResolutionDecisionV1,
  type SignalSemanticResolutionRunV1
} from "@noisia/query-engine";
import type { QueryResult, QueryResultRow } from "pg";

export type SignalSemanticResolutionQueryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

export type SignalSemanticResolutionPreparationV1 =
  | {
      state: "confirmation_required";
      estimate: ReturnType<typeof estimateSignalSemanticResolutionCostV1>;
    }
  | {
      state: "queued" | "already_active" | "nothing_to_resolve";
      estimate: ReturnType<typeof estimateSignalSemanticResolutionCostV1>;
      run: SignalSemanticResolutionRunV1 | null;
    };

export type SignalSemanticResolutionMentionContextV1 = {
  mention_id: string;
  published_at: string;
  platform: string;
  title: string | null;
  text: string;
  thread_context: string | null;
  author_handle: string | null;
  author_name: string | null;
  source_name: string;
  source_intent: string;
  prepared_decision: SignalSemanticResolutionDecisionV1 | null;
};

export type SignalSemanticResolutionGovernedContextV1 = {
  workspace: {
    workspace_id: string;
    brand_id: string;
    brand_name: string;
    brand_slug: string;
    brand_handles: string[];
    description: string | null;
    industry: string | null;
    industry_sub: string | null;
    countries: string[];
  };
  identities: Array<{
    scope: "primary_brand" | "competitor" | "category" | "reference";
    entity_id: string;
    entity_label: string;
    aliases: string[];
  }>;
  brand_context: Array<{ kind: string; title: string; content: string }>;
};

export class SignalSemanticResolutionContractError extends Error {
  constructor(
    public readonly code: "invalid_input" | "not_found" | "conflict" | "forbidden_state",
    message: string
  ) {
    super(message);
    this.name = "SignalSemanticResolutionContractError";
  }
}

type WorkloadRow = {
  mention_id: string;
  context_hash: string;
  character_count: number;
};

export type SignalSemanticResolutionSelectedItemV2 = WorkloadRow;

type RunRow = {
  id: string;
  workspace_id: string;
  status: SignalSemanticResolutionRunV1["status"];
  model_version: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  estimated_cost_usd: string;
  actual_cost_usd: string;
  budget_threshold_usd: string;
  budget_cap_usd: string;
  over_budget_confirmed: boolean;
  provider_batch_id: string | null;
  provider_batch_status: SignalSemanticResolutionRunV1["provider_batch_status"];
  provider_processing_items: number;
  provider_succeeded_items: number;
  provider_errored_items: number;
  provider_canceled_items: number;
  provider_expired_items: number;
  provider_submitted_at: string | null;
  provider_ended_at: string | null;
  provider_results_imported_at: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type SignalSemanticResolutionPreflightDataV2 = {
  projection_generation: number;
  projection_snapshot_digest: string;
  population_digest: string;
  projection_reconciled_at: string;
  accepted_root_count: number;
  quality_excluded_count: number;
  quality_unknown_count: number;
  incomplete_provenance_count: number;
  retention_blocked_count: number;
  retention_expired_count: number;
  retention_unknown_count: number;
  licensing_unknown_count: number;
  licensing_denied_count: number;
  licensing_expired_count: number;
  llm_eligible_count: number;
  already_resolved_count: number;
  unresolved_count: number;
  deterministic_count: number;
  ambiguous_count: number;
  needs_context_count: number;
  selected_character_count: number;
  selection_digest: string;
  governance_digest: string;
  next_policy_transition_at: string | null;
};

const ACTIVE_STATUSES = ["queued", "running"] as const;

export async function loadSignalSemanticResolutionPreflightDataV2(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
): Promise<SignalSemanticResolutionPreflightDataV2> {
  const result = await queryable.query<SignalSemanticResolutionPreflightDataV2>(`
    WITH projection AS (
      SELECT state.current_generation,state.snapshot_digest,state.population_digest,
        state.governance_digest,state.resolution_selection_digest,
        state.resolution_selected_character_count,state.incomplete_provenance_count,
        state.resolution_next_policy_transition_at,state.projected_root_count,
        state.reconciled_at
      FROM signal_semantic_review_projection_state state
      WHERE state.workspace_id=$1::uuid AND state.status='ready'
        AND state.snapshot_digest IS NOT NULL AND state.population_digest IS NOT NULL
        AND state.governance_digest IS NOT NULL
        AND state.resolution_selection_digest IS NOT NULL
    ), counts AS (
      SELECT aggregate.dimension,aggregate.dimension_value,aggregate.root_count
      FROM projection
      JOIN signal_semantic_review_projection_aggregates aggregate
        ON aggregate.workspace_id=$1::uuid
       AND aggregate.generation=projection.current_generation
      WHERE aggregate.dimension IN (
        'resolution_eligibility','resolution_status','resolution_stratum'
      )
    )
    SELECT projection.current_generation::int AS projection_generation,
      projection.snapshot_digest AS projection_snapshot_digest,
      projection.population_digest,projection.reconciled_at::text AS projection_reconciled_at,
      projection.projected_root_count::int AS accepted_root_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='quality_excluded'),0)::int AS quality_excluded_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='quality_unknown'),0)::int AS quality_unknown_count,
      projection.incomplete_provenance_count::int AS incomplete_provenance_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='retention_blocked'),0)::int AS retention_blocked_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='retention_expired'),0)::int AS retention_expired_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='retention_unknown'),0)::int AS retention_unknown_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='licensing_unknown'),0)::int AS licensing_unknown_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='licensing_denied'),0)::int AS licensing_denied_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='licensing_expired'),0)::int AS licensing_expired_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_eligibility'
        AND dimension_value='eligible'),0)::int AS llm_eligible_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_status'
        AND dimension_value='resolved'),0)::int AS already_resolved_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_status'
        AND dimension_value='unresolved'),0)::int AS unresolved_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_stratum'
        AND dimension_value='deterministic'),0)::int AS deterministic_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_stratum'
        AND dimension_value='ambiguous'),0)::int AS ambiguous_count,
      COALESCE((SELECT root_count FROM counts WHERE dimension='resolution_stratum'
        AND dimension_value='needs_context'),0)::int AS needs_context_count,
      projection.resolution_selected_character_count::text::bigint AS selected_character_count,
      projection.resolution_selection_digest AS selection_digest,
      projection.governance_digest,
      projection.resolution_next_policy_transition_at::text AS next_policy_transition_at
    FROM projection
  `,[workspaceId]);
  return normalizeSignalSemanticResolutionPreflightDataV2(result.rows[0]);
}

export async function auditSignalSemanticResolutionPreflightAuthorityV2(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
): Promise<SignalSemanticResolutionPreflightDataV2> {
  const result = await queryable.query<SignalSemanticResolutionPreflightDataV2>(`
    WITH projection AS (
      SELECT state.current_generation,state.snapshot_digest,state.population_digest,
        state.reconciled_at
      FROM signal_semantic_review_projection_state state
      WHERE state.workspace_id=$1::uuid AND state.status='ready'
        AND state.snapshot_digest IS NOT NULL AND state.population_digest IS NOT NULL
    ), roots AS (
      SELECT item.mention_id,item.queue_state,item.candidate_resolution,
        item.character_count,item.context_hash,mention.quality_score,
        COALESCE(mention.quality_flags,'[]'::jsonb) AS quality_flags
      FROM projection
      JOIN signal_semantic_review_projection_items item
        ON item.workspace_id=$1::uuid AND item.generation=projection.current_generation
      JOIN mentions mention ON mention.id=item.mention_id
        AND mention.workspace_id=item.workspace_id
        AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included'
    ), all_included AS (
      SELECT mention.id
      FROM mentions mention
      WHERE mention.workspace_id=$1::uuid
        AND mention.canonical_mention_id=mention.id
        AND mention.inclusion_status='included'
    ), paths AS (
      SELECT root.mention_id,membership.id AS import_membership_id,
        batch.id AS completed_import_batch_id,binding.id AS binding_id,
        binding.status AS binding_status,binding.effective_from AS binding_effective_from,
        binding.effective_to AS binding_effective_to,
        quality.id AS quality_policy_id,quality.definition_hash AS quality_hash,
        retention.id AS retention_policy_id,retention.definition_hash AS retention_hash,
        licensing.id AS licensing_policy_id,licensing.definition_hash AS licensing_hash,
        LEAST(binding.effective_to,quality.effective_to,retention.effective_to,
          retention.retain_until,licensing.effective_to) AS next_transition,
        CASE
          WHEN membership.id IS NULL OR batch.id IS NULL THEN 'provenance_incomplete'
          WHEN binding.id IS NULL OR binding.status<>'active'
            OR binding.effective_from>clock_timestamp() THEN 'licensing_not_available'
          WHEN binding.effective_to IS NOT NULL AND binding.effective_to<=clock_timestamp()
            THEN 'licensing_expired'
          WHEN quality.id IS NULL OR quality.status<>'active'
            OR quality.effective_from>clock_timestamp()
            OR (quality.effective_to IS NOT NULL AND quality.effective_to<=clock_timestamp())
            OR quality.canonical_root_disposition='not_available' THEN 'quality_not_available'
          WHEN quality.canonical_root_disposition='blocked'
            OR (quality.min_quality_score IS NOT NULL
              AND COALESCE(root.quality_score,-1)<quality.min_quality_score)
            OR EXISTS (SELECT 1 FROM unnest(quality.required_quality_flags) flag
              WHERE NOT root.quality_flags ? flag)
            OR EXISTS (SELECT 1 FROM unnest(quality.forbidden_quality_flags) flag
              WHERE root.quality_flags ? flag) THEN 'quality_excluded'
          WHEN retention.id IS NULL OR retention.status<>'active'
            OR retention.effective_from>clock_timestamp()
            OR retention.retention_state='not_available' THEN 'retention_not_available'
          WHEN retention.effective_to IS NOT NULL AND retention.effective_to<=clock_timestamp()
            THEN 'retention_expired'
          WHEN retention.retention_state='blocked' THEN 'retention_blocked'
          WHEN retention.retention_mode='until' AND retention.retain_until<=clock_timestamp()
            THEN 'retention_expired'
          WHEN licensing.id IS NULL OR licensing.status<>'active'
            OR licensing.effective_from>clock_timestamp() THEN 'licensing_not_available'
          WHEN licensing.effective_to IS NOT NULL AND licensing.effective_to<=clock_timestamp()
            THEN 'licensing_expired'
          WHEN EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
            WHERE usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose='llm-processing'
              AND usage.decision='prohibited') THEN 'licensing_prohibited'
          WHEN NOT EXISTS (SELECT 1 FROM signal_licensing_policy_usages usage
            WHERE usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose='llm-processing'
              AND usage.decision='allowed') THEN 'licensing_not_available'
          ELSE 'policy_eligible'
        END AS path_reason
      FROM roots root
      LEFT JOIN mentions provenance_mention
        ON provenance_mention.workspace_id=$1::uuid
       AND provenance_mention.canonical_mention_id=root.mention_id
      LEFT JOIN signal_mention_import_memberships membership
        ON membership.workspace_id=$1::uuid
       AND membership.mention_id=provenance_mention.id
      LEFT JOIN import_batches batch
        ON batch.id=membership.import_batch_id
       AND batch.workspace_id=membership.workspace_id
       AND batch.status='completed'
      LEFT JOIN LATERAL (
        SELECT candidate.* FROM signal_provenance_policy_bindings candidate
        WHERE candidate.workspace_id=$1::uuid
          AND candidate.data_source_id=membership.data_source_id
          AND (candidate.import_batch_id=membership.import_batch_id
            OR candidate.import_batch_id IS NULL)
        ORDER BY (
          candidate.status='active'
          AND candidate.effective_from<=clock_timestamp()
          AND (candidate.effective_to IS NULL OR candidate.effective_to>clock_timestamp())
        ) DESC,(candidate.import_batch_id IS NOT NULL) DESC,
          candidate.binding_version DESC,candidate.id
        LIMIT 1
      ) binding ON batch.id IS NOT NULL
      LEFT JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
      LEFT JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
      LEFT JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
    ), root_state AS (
      SELECT root.mention_id,root.queue_state,root.candidate_resolution,
        root.character_count,root.context_hash,
        COALESCE(bool_or(path.path_reason='policy_eligible'),false) AS eligible,
        COALESCE(bool_or(path.path_reason='quality_excluded'),false) AS quality_excluded,
        COALESCE(bool_or(path.path_reason='retention_blocked'),false) AS retention_blocked,
        COALESCE(bool_or(path.path_reason='retention_expired'),false) AS retention_expired,
        COALESCE(bool_or(path.path_reason='licensing_prohibited'),false) AS licensing_denied,
        COALESCE(bool_or(path.path_reason='licensing_expired'),false) AS licensing_expired,
        COALESCE(bool_or(path.path_reason='quality_not_available'),false) AS quality_unknown,
        COALESCE(bool_or(path.path_reason='retention_not_available'),false) AS retention_unknown,
        COALESCE(bool_or(path.path_reason='licensing_not_available'),false) AS licensing_unknown
      FROM roots root LEFT JOIN paths path ON path.mention_id=root.mention_id
      GROUP BY root.mention_id,root.queue_state,root.candidate_resolution,
        root.character_count,root.context_hash
    ), selected AS (
      SELECT * FROM root_state
      WHERE eligible AND queue_state NOT IN ('current_approved','current_rejected')
    ), eligible_paths AS (
      SELECT DISTINCT path.mention_id,path.binding_id,path.quality_policy_id,
        path.retention_policy_id,path.licensing_policy_id,path.quality_hash,
        path.retention_hash,path.licensing_hash,path.next_transition
      FROM paths path WHERE path.path_reason='policy_eligible'
    ), governance_source AS (
      SELECT COALESCE(string_agg(concat_ws('|',
        path.mention_id::text,path.binding_id::text,path.quality_policy_id::text,
        path.retention_policy_id::text,path.licensing_policy_id::text,
        path.quality_hash,path.retention_hash,path.licensing_hash),E'\n'
        ORDER BY path.mention_id,path.binding_id),'') AS serialized_authority,
        min(path.next_transition)::text AS next_transition
      FROM eligible_paths path
    ), governance AS (
      SELECT 'sha256:'||encode(sha256(convert_to(
        source.serialized_authority,'UTF8')),'hex') AS digest,
        source.next_transition
      FROM governance_source source
    )
    SELECT projection.current_generation::int AS projection_generation,
      projection.snapshot_digest AS projection_snapshot_digest,
      projection.population_digest,projection.reconciled_at::text AS projection_reconciled_at,
      (SELECT count(*)::int FROM roots) AS accepted_root_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND quality_excluded) AS quality_excluded_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND quality_unknown) AS quality_unknown_count,
      (SELECT count(*)::int FROM all_included mention
        WHERE signal_mention_has_only_incomplete_imports_v1($1::uuid,mention.id)) AS incomplete_provenance_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND retention_blocked) AS retention_blocked_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND retention_expired) AS retention_expired_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND retention_unknown) AS retention_unknown_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND licensing_unknown) AS licensing_unknown_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND licensing_denied) AS licensing_denied_count,
      (SELECT count(*)::int FROM root_state WHERE NOT eligible AND licensing_expired) AS licensing_expired_count,
      (SELECT count(*)::int FROM root_state WHERE eligible) AS llm_eligible_count,
      (SELECT count(*)::int FROM root_state WHERE eligible
        AND queue_state IN ('current_approved','current_rejected')) AS already_resolved_count,
      (SELECT count(*)::int FROM selected) AS unresolved_count,
      (SELECT count(*)::int FROM selected
        WHERE queue_state='candidate_pending' AND candidate_resolution='governed_identity_match') AS deterministic_count,
      (SELECT count(*)::int FROM selected WHERE queue_state='unresolved') AS ambiguous_count,
      (SELECT count(*)::int FROM selected WHERE queue_state='needs_context') AS needs_context_count,
      COALESCE((SELECT sum(character_count)::bigint FROM selected),0)::text::bigint AS selected_character_count,
      COALESCE((SELECT 'sha256:'||encode(sha256(convert_to(string_agg(
        concat_ws('|',mention_id::text,context_hash),E'\n' ORDER BY mention_id),'UTF8')),'hex')
        FROM selected),'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') AS selection_digest,
      governance.digest AS governance_digest,
      governance.next_transition AS next_policy_transition_at
    FROM projection CROSS JOIN governance
  `, [workspaceId]);
  return normalizeSignalSemanticResolutionPreflightDataV2(result.rows[0]);
}

function normalizeSignalSemanticResolutionPreflightDataV2(
  row: SignalSemanticResolutionPreflightDataV2 | undefined
) {
  if (!row) {
    throw new SignalSemanticResolutionContractError(
      "forbidden_state",
      "Semantic Review projection is not ready for resolution preflight."
    );
  }
  return {
    ...row,
    projection_generation: Number(row.projection_generation),
    accepted_root_count: Number(row.accepted_root_count),
    quality_excluded_count: Number(row.quality_excluded_count),
    quality_unknown_count: Number(row.quality_unknown_count),
    incomplete_provenance_count: Number(row.incomplete_provenance_count),
    retention_blocked_count: Number(row.retention_blocked_count),
    retention_expired_count: Number(row.retention_expired_count),
    retention_unknown_count: Number(row.retention_unknown_count),
    licensing_unknown_count: Number(row.licensing_unknown_count),
    licensing_denied_count: Number(row.licensing_denied_count),
    licensing_expired_count: Number(row.licensing_expired_count),
    llm_eligible_count: Number(row.llm_eligible_count),
    already_resolved_count: Number(row.already_resolved_count),
    unresolved_count: Number(row.unresolved_count),
    deterministic_count: Number(row.deterministic_count),
    ambiguous_count: Number(row.ambiguous_count),
    needs_context_count: Number(row.needs_context_count),
    selected_character_count: Number(row.selected_character_count)
  };
}

export async function buildSignalSemanticResolutionPreflightV2(
  queryable: SignalSemanticResolutionQueryable,
  args: { workspace_id: string; hard_cap_usd: string; provider_batch_item_limit?: number }
) {
  const data = await loadSignalSemanticResolutionPreflightDataV2(queryable, args.workspace_id);
  const context = await loadSignalSemanticResolutionGovernedContextV1(queryable, args.workspace_id);
  const estimate = estimateSignalSemanticResolutionCostV2({
    mention_count: data.unresolved_count,
    mention_character_count: data.selected_character_count,
    context_character_count: JSON.stringify(context).length,
    hard_cap_usd: args.hard_cap_usd,
    provider_batch_item_limit: args.provider_batch_item_limit
  });
  return { data, context_character_count: JSON.stringify(context).length, estimate };
}

export async function loadSignalSemanticResolutionSelectionV2(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    workspace_id: string;
    projection_snapshot_digest: string;
    population_digest: string;
    governance_digest: string;
  }
): Promise<SignalSemanticResolutionSelectedItemV2[]> {
  const result = await queryable.query<WorkloadRow>(`
    WITH projection AS (
      SELECT state.current_generation
      FROM signal_semantic_review_projection_state state
      WHERE state.workspace_id=$1::uuid AND state.status='ready'
        AND state.snapshot_digest=$2 AND state.population_digest=$3
        AND state.governance_digest=$4
    ), roots AS (
      SELECT item.mention_id,item.context_hash,item.character_count
      FROM projection
      JOIN signal_semantic_review_projection_items item
        ON item.workspace_id=$1::uuid AND item.generation=projection.current_generation
      JOIN mentions mention ON mention.id=item.mention_id AND mention.workspace_id=item.workspace_id
      WHERE item.queue_state NOT IN ('current_approved','current_rejected')
        AND item.resolution_eligibility='eligible'
        AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
        AND NOT signal_mention_has_only_incomplete_imports_v1(mention.workspace_id,mention.id)
    )
    SELECT root.mention_id::text,root.context_hash,root.character_count
    FROM roots root
    ORDER BY root.mention_id
  `, [
    args.workspace_id,
    args.projection_snapshot_digest,
    args.population_digest,
    args.governance_digest
  ]);
  const digest = signalSemanticStableHashV1(result.rows.map((row) => ({
    mention_id: row.mention_id,
    context_hash: row.context_hash
  })));
  // The caller compares this selection with the preflight. Keep the supplied
  // governance digest in the signature so a stale launch request cannot omit it.
  if (!/^sha256:[0-9a-f]{64}$/.test(args.governance_digest) || !digest) {
    throw new SignalSemanticResolutionContractError("forbidden_state", "Semantic resolution authority is invalid.");
  }
  return result.rows.map((row) => ({
    ...row,
    character_count: Number(row.character_count)
  }));
}

export async function prepareSignalSemanticResolutionRunV1(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    workspace_id: string;
    requested_by_user_id: string;
    confirm_over_budget: boolean;
    model_version?: string;
  }
): Promise<SignalSemanticResolutionPreparationV1> {
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${args.workspace_id}:signal-semantic-resolution-v1`
  ]);
  await ensureSignalSemanticResolutionCategoryIdentityV1(queryable, args.workspace_id);

  const active = await loadActiveSignalSemanticResolutionRunV1(queryable, args.workspace_id);
  if (active) {
    return {
      state: "already_active",
      estimate: estimateFromRun(active),
      run: active
    };
  }

  const workload = await loadResolutionWorkload(queryable, args.workspace_id);
  const governedContext = await loadSignalSemanticResolutionGovernedContextV1(
    queryable,
    args.workspace_id
  );
  const estimate = estimateSignalSemanticResolutionCostV1({
    mention_count: workload.length,
    mention_character_count: workload.reduce((total, row) => total + row.character_count, 0),
    context_character_count: JSON.stringify(governedContext).length
  });
  if (workload.length === 0) return { state: "nothing_to_resolve", estimate, run: null };
  if (estimate.confirmation_required && !args.confirm_over_budget) {
    return { state: "confirmation_required", estimate };
  }

  const queueDigest = signalSemanticStableHashV1(workload.map((row) => ({
    mention_id: row.mention_id,
    context_hash: row.context_hash
  })));
  const budgetCap = estimate.confirmation_required
    ? estimate.estimated_cost_usd
    : SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD;
  const inserted = await queryable.query<RunRow>(`
    INSERT INTO signal_semantic_resolution_runs (
      workspace_id, requested_by_user_id, status, model_version,
      policy_key, policy_version, queue_digest, total_items,
      budget_threshold_usd, budget_cap_usd, estimated_cost_usd,
      over_budget_confirmed
    ) VALUES (
      $1::uuid, $2::uuid, 'queued', $3,
      $4, $5, $6, $7,
      $8::numeric, $9::numeric, $10::numeric, $11
    )
    RETURNING id::text, workspace_id::text, status, model_version,
      total_items, completed_items, failed_items,
      estimated_cost_usd::text, actual_cost_usd::text,
      budget_threshold_usd::text, budget_cap_usd::text,
      over_budget_confirmed, provider_batch_id, provider_batch_status,
      provider_processing_items, provider_succeeded_items, provider_errored_items,
      provider_canceled_items, provider_expired_items,
      provider_submitted_at::text, provider_ended_at::text,
      provider_results_imported_at::text, error_code,
      created_at::text, started_at::text, completed_at::text
  `, [
    args.workspace_id,
    args.requested_by_user_id,
    args.model_version ?? SIGNAL_SEMANTIC_RESOLUTION_DEFAULT_MODEL,
    SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
    SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
    queueDigest,
    workload.length,
    SIGNAL_SEMANTIC_RESOLUTION_BUDGET_THRESHOLD_USD,
    budgetCap,
    estimate.estimated_cost_usd,
    estimate.confirmation_required
  ]);
  const run = toRun(requiredRow(inserted));

  for (let offset = 0; offset < workload.length; offset += 500) {
    const chunk = workload.slice(offset, offset + 500);
    await queryable.query(`
      INSERT INTO signal_semantic_resolution_run_items (
        run_id, workspace_id, mention_id, context_hash
      )
      SELECT $1::uuid, $2::uuid, input.mention_id::uuid, input.context_hash
      FROM jsonb_to_recordset($3::jsonb) AS input(mention_id text, context_hash text)
      ON CONFLICT (run_id, mention_id) DO NOTHING
    `, [run.run_id, args.workspace_id, JSON.stringify(chunk)]);
  }
  return { state: "queued", estimate, run };
}

export async function ensureSignalSemanticResolutionCategoryIdentityV1(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
) {
  const result = await queryable.query<{ entity_id: string }>(`
    WITH brand_context AS (
      SELECT brand.organization_id, brand.id AS brand_id,
        NULLIF(btrim(COALESCE(NULLIF(brand.industry_sub, ''), NULLIF(brand.industry, ''))), '') AS category_name,
        ARRAY(
          SELECT DISTINCT btrim(value)
          FROM unnest(ARRAY[brand.industry_sub, brand.industry]) value
          WHERE value IS NOT NULL AND btrim(value) <> ''
        ) AS aliases
      FROM signal_workspaces workspace
      JOIN brands brand ON brand.id = workspace.brand_id
      WHERE workspace.id = $1::uuid
        AND workspace.status = 'active'
        AND brand.status = 'active'
    ), inserted AS (
      INSERT INTO intelligence_entities (
        organization_id, brand_id, entity_type, canonical_name,
        external_id, metadata, status
      )
      SELECT context.organization_id, context.brand_id, 'category', context.category_name,
        'signal-brand-os-category:' || context.brand_id::text,
        jsonb_build_object(
          'source', 'brand_os',
          'source_fields', jsonb_build_array('industry_sub', 'industry')
        ),
        'active'
      FROM brand_context context
      WHERE context.category_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM intelligence_entities existing
          WHERE existing.brand_id = context.brand_id
            AND existing.entity_type = 'category'
            AND existing.status = 'active'
        )
      ON CONFLICT (entity_type, external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        brand_id = EXCLUDED.brand_id,
        canonical_name = EXCLUDED.canonical_name,
        metadata = intelligence_entities.metadata || EXCLUDED.metadata,
        status = 'active',
        updated_at = now()
      RETURNING id, brand_id
    ), generated AS (
      SELECT inserted.id, context.aliases
      FROM inserted
      JOIN brand_context context ON context.brand_id = inserted.brand_id
    ), inserted_aliases AS (
      INSERT INTO entity_aliases (entity_id, alias, alias_type, source, confidence)
      SELECT generated.id, alias, 'taxonomy_label', 'brand_os', 1
      FROM generated
      CROSS JOIN LATERAL unnest(generated.aliases) alias
      ON CONFLICT (entity_id, alias) DO NOTHING
      RETURNING entity_id
    )
    SELECT id::text AS entity_id FROM generated
  `, [workspaceId]);
  return result.rows[0]?.entity_id ?? null;
}

export async function loadLatestSignalSemanticResolutionRunV1(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
): Promise<SignalSemanticResolutionRunV1 | null> {
  const result = await queryable.query<RunRow>(`
    SELECT id::text, workspace_id::text, status, model_version,
      total_items, completed_items, failed_items,
      estimated_cost_usd::text, actual_cost_usd::text,
      budget_threshold_usd::text, budget_cap_usd::text,
      over_budget_confirmed, provider_batch_id, provider_batch_status,
      provider_processing_items, provider_succeeded_items, provider_errored_items,
      provider_canceled_items, provider_expired_items,
      provider_submitted_at::text, provider_ended_at::text,
      provider_results_imported_at::text, error_code,
      created_at::text, started_at::text, completed_at::text
    FROM signal_semantic_resolution_runs
    WHERE workspace_id = $1::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [workspaceId]);
  return result.rows[0] ? toRun(result.rows[0]) : null;
}

export async function loadSignalSemanticResolutionBatchV1(
  queryable: SignalSemanticResolutionQueryable,
  args: { run_id: string; limit: number; child_batch_id?: string | null }
): Promise<SignalSemanticResolutionMentionContextV1[]> {
  const result = await queryable.query<SignalSemanticResolutionMentionContextV1>(`
    SELECT mention.id::text AS mention_id,
      mention.published_at::text,
      COALESCE(mention.resolved_platform, mention.platform) AS platform,
      mention.title,
      mention.text_clean AS text,
      COALESCE(
        mention.raw_metadata->>'thread_context',
        mention.raw_metadata->>'root_post_text',
        mention.raw_metadata->>'parent_text'
      ) AS thread_context,
      author.handle AS author_handle,
      author.display_name AS author_name,
      source.name AS source_name,
      concat_ws(':', intent.scope, intent.entity_label) AS source_intent,
      item.decision AS prepared_decision
    FROM signal_semantic_resolution_run_items item
    JOIN signal_semantic_resolution_runs run ON run.id = item.run_id
    JOIN mentions mention
      ON mention.id = item.mention_id
     AND mention.workspace_id = item.workspace_id
     AND mention.canonical_mention_id = mention.id
    LEFT JOIN authors author ON author.id = mention.author_id
    JOIN LATERAL (
      SELECT attribution.data_source_id, attribution.scope, attribution.entity_label
      FROM signal_mention_attributions attribution
      JOIN import_batches batch ON batch.id=attribution.import_batch_id
        AND batch.workspace_id=attribution.workspace_id AND batch.status='completed'
      WHERE attribution.workspace_id = mention.workspace_id
        AND attribution.mention_id = mention.id
        AND attribution.attribution_basis = 'source_intent'
      ORDER BY attribution.created_at, attribution.id
      LIMIT 1
    ) intent ON true
    JOIN data_sources source ON source.id = intent.data_source_id
    WHERE item.run_id = $1::uuid
      AND item.status = 'pending'
      AND ($3::uuid IS NULL OR item.child_batch_id=$3::uuid)
      AND run.status IN ('queued', 'running')
      AND NOT signal_mention_has_only_incomplete_imports_v1(mention.workspace_id,mention.id)
    ORDER BY item.created_at, item.id
    LIMIT $2
  `, [args.run_id, args.limit, args.child_batch_id ?? null]);
  return result.rows;
}

export async function loadSignalSemanticResolutionChildRuntimeV2(
  queryable: SignalSemanticResolutionQueryable,
  args: { run_id: string; child_batch_id: string; workspace_id: string }
) {
  const result = await queryable.query<{
    run_id: string;
    child_batch_id: string;
    child_ordinal: number;
    requested_by_user_id: string;
    run_status: string;
    child_status: string;
    model_version: string;
    item_count: number;
    provider_batch_id: string | null;
    provider_batch_status: string;
    projection_snapshot_digest: string;
    population_digest: string;
    governance_digest: string;
    pricing_version: string;
    hard_cap_micro_usd: string;
    next_policy_transition_at: string | null;
    cancellation_requested_at: string | null;
    projection_current: boolean;
    authorized_item_count: number;
  }>(`
    SELECT run.id::text AS run_id,child.id::text AS child_batch_id,child.ordinal::int AS child_ordinal,
      run.requested_by_user_id::text,run.status AS run_status,child.status AS child_status,
      run.model_version,child.item_count,child.provider_batch_id,child.provider_batch_status,
      run.projection_snapshot_digest,run.population_digest,run.governance_digest,
      run.pricing_version,run.hard_cap_micro_usd::text,run.next_policy_transition_at::text,
      run.cancellation_requested_at::text,
      (projection.status='ready'
        AND projection.snapshot_digest=run.projection_snapshot_digest
        AND projection.population_digest=run.population_digest) AS projection_current,
      (
        SELECT count(*)::int
        FROM signal_semantic_resolution_run_items item
        JOIN mentions mention ON mention.id=item.mention_id AND mention.workspace_id=item.workspace_id
        WHERE item.child_batch_id=child.id
          AND mention.canonical_mention_id=mention.id AND mention.inclusion_status='included'
          AND NOT signal_mention_has_only_incomplete_imports_v1(mention.workspace_id,mention.id)
          AND EXISTS (
            SELECT 1 FROM mentions provenance_mention
            JOIN signal_mention_import_memberships membership
              ON membership.workspace_id=mention.workspace_id
             AND membership.mention_id=provenance_mention.id
            JOIN import_batches batch ON batch.id=membership.import_batch_id
              AND batch.workspace_id=membership.workspace_id AND batch.status='completed'
            JOIN LATERAL (
              SELECT candidate.* FROM signal_provenance_policy_bindings candidate
              WHERE candidate.workspace_id=mention.workspace_id
                AND candidate.data_source_id=membership.data_source_id
                AND candidate.status='active' AND candidate.effective_from<=clock_timestamp()
                AND (candidate.effective_to IS NULL OR candidate.effective_to>clock_timestamp())
                AND (candidate.import_batch_id=membership.import_batch_id
                  OR candidate.import_batch_id IS NULL)
              ORDER BY (candidate.import_batch_id IS NOT NULL) DESC,
                candidate.binding_version DESC,candidate.id LIMIT 1
            ) binding ON true
            JOIN signal_quality_policies quality ON quality.id=binding.quality_policy_id
              AND quality.status='active' AND quality.effective_from<=clock_timestamp()
              AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
              AND quality.canonical_root_disposition='evaluate'
            JOIN signal_retention_policies retention ON retention.id=binding.retention_policy_id
              AND retention.status='active' AND retention.effective_from<=clock_timestamp()
              AND (retention.effective_to IS NULL OR retention.effective_to>clock_timestamp())
              AND retention.retention_state='allowed'
              AND (retention.retention_mode<>'until' OR retention.retain_until>clock_timestamp())
            JOIN signal_licensing_policies licensing ON licensing.id=binding.licensing_policy_id
              AND licensing.status='active' AND licensing.effective_from<=clock_timestamp()
              AND (licensing.effective_to IS NULL OR licensing.effective_to>clock_timestamp())
            JOIN signal_licensing_policy_usages usage ON usage.licensing_policy_id=licensing.id
              AND usage.usage_purpose='llm-processing' AND usage.decision='allowed'
            WHERE provenance_mention.workspace_id=mention.workspace_id
              AND provenance_mention.canonical_mention_id=mention.id
              AND (quality.min_quality_score IS NULL
                OR COALESCE(mention.quality_score,-1)>=quality.min_quality_score)
              AND NOT EXISTS (SELECT 1 FROM unnest(quality.required_quality_flags) flag
                WHERE NOT COALESCE(mention.quality_flags,'[]'::jsonb) ? flag)
              AND NOT EXISTS (SELECT 1 FROM unnest(quality.forbidden_quality_flags) flag
                WHERE COALESCE(mention.quality_flags,'[]'::jsonb) ? flag)
          )
      ) AS authorized_item_count
    FROM signal_semantic_resolution_runs run
    JOIN signal_semantic_resolution_child_batches child ON child.run_id=run.id
    LEFT JOIN signal_semantic_review_projection_state projection
      ON projection.workspace_id=run.workspace_id
    WHERE run.id=$1::uuid AND child.id=$2::uuid AND run.workspace_id=$3::uuid
  `, [args.run_id,args.child_batch_id,args.workspace_id]);
  const row = result.rows[0];
  if (!row) throw new SignalSemanticResolutionContractError("not_found", "Semantic resolution child was not found.");
  if (!row.projection_current || Number(row.authorized_item_count) !== Number(row.item_count)) {
    throw new SignalSemanticResolutionContractError(
      "forbidden_state",
      "Semantic resolution child authority is stale or incomplete."
    );
  }
  if (row.next_policy_transition_at && Date.parse(row.next_policy_transition_at) <= Date.now()) {
    throw new SignalSemanticResolutionContractError(
      "forbidden_state",
      "Semantic resolution child authority crossed a temporal boundary."
    );
  }
  return {
    ...row,
    child_ordinal: Number(row.child_ordinal),
    item_count: Number(row.item_count),
    authorized_item_count: Number(row.authorized_item_count)
  };
}

export async function loadSignalSemanticResolutionGovernedContextV1(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
): Promise<SignalSemanticResolutionGovernedContextV1> {
  const workspaceResult = await queryable.query<{
    workspace_id: string;
    brand_id: string;
    brand_name: string;
    brand_slug: string;
    brand_handles: string[] | null;
    description: string | null;
    industry: string | null;
    industry_sub: string | null;
    countries: string[] | null;
  }>(`
    SELECT workspace.id::text AS workspace_id, brand.id::text AS brand_id,
      COALESCE(brand.display_name, brand.name) AS brand_name,
      brand.slug AS brand_slug, brand.brand_seed_handles AS brand_handles,
      brand.description, brand.industry, brand.industry_sub,
      brand.countries::text[] AS countries
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id = workspace.brand_id
    WHERE workspace.id = $1::uuid AND workspace.status = 'active' AND brand.status = 'active'
  `, [workspaceId]);
  const workspace = requiredRow(workspaceResult);
  const identityResult = await queryable.query<{
    scope: "primary_brand" | "competitor" | "category" | "reference";
    entity_id: string;
    entity_label: string;
    aliases: string[] | null;
  }>(`
    SELECT 'primary_brand'::text AS scope, brand.id::text AS entity_id,
      COALESCE(brand.display_name, brand.name) AS entity_label,
      ARRAY(SELECT DISTINCT value FROM unnest(
        ARRAY[brand.name, brand.display_name, brand.slug] || COALESCE(brand.brand_seed_handles, ARRAY[]::text[])
      ) value WHERE value IS NOT NULL AND btrim(value) <> '') AS aliases
    FROM brands brand WHERE brand.id = $1::uuid
    UNION ALL
    SELECT 'competitor', competitor.id::text, seed.canonical_name,
      ARRAY(SELECT DISTINCT value FROM unnest(
        ARRAY[seed.canonical_name] || COALESCE(seed.aliases, ARRAY[]::text[]) || COALESCE(seed.detection_patterns, ARRAY[]::text[])
      ) value WHERE value IS NOT NULL AND btrim(value) <> '')
    FROM competitors competitor
    JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
    WHERE competitor.brand_id = $1::uuid AND seed.active = true
    UNION ALL
    SELECT entity.entity_type, entity.id::text, entity.canonical_name,
      ARRAY(SELECT alias.alias FROM entity_aliases alias WHERE alias.entity_id = entity.id ORDER BY alias.alias)
    FROM intelligence_entities entity
    WHERE entity.brand_id = $1::uuid
      AND entity.status = 'active'
      AND entity.entity_type IN ('category', 'reference')
  `, [workspace.brand_id]);
  const brandContextResult = await queryable.query<{ kind: string; title: string; content: string }>(`
    SELECT 'brand_objective' AS kind, objective.name AS title,
      concat_ws(E'\n', objective.description, objective.success_criteria::text) AS content
    FROM brand_os_objectives objective
    JOIN brand_os_profiles profile ON profile.id = objective.brand_os_profile_id
    WHERE profile.brand_id = $1::uuid AND profile.status = 'active' AND objective.status = 'active'
    UNION ALL
    SELECT 'brand_brief', brief.title,
      concat_ws(E'\n', brief.summary, brief.metadata::text)
    FROM brand_os_briefs brief
    JOIN brand_os_profiles profile ON profile.id = brief.brand_os_profile_id
    WHERE profile.brand_id = $1::uuid AND profile.status = 'active' AND brief.status = 'active'
    UNION ALL
    SELECT 'brand_audience', audience.name,
      concat_ws(E'\n', audience.description, audience.attributes::text)
    FROM brand_os_audiences audience
    JOIN brand_os_profiles profile ON profile.id = audience.brand_os_profile_id
    WHERE profile.brand_id = $1::uuid AND profile.status = 'active' AND audience.status = 'active'
    UNION ALL
    SELECT 'brand_product', product.name,
      concat_ws(E'\n', product.product_type, product.description, product.metadata::text)
    FROM brand_os_products product
    JOIN brand_os_profiles profile ON profile.id = product.brand_os_profile_id
    WHERE profile.brand_id = $1::uuid AND profile.status = 'active' AND product.status = 'active'
    UNION ALL
    SELECT 'brand_claim', claim.claim_text,
      concat_ws(E'\n', claim.claim_type, claim.metadata::text)
    FROM brand_os_claims claim
    JOIN brand_os_profiles profile ON profile.id = claim.brand_os_profile_id
    WHERE profile.brand_id = $1::uuid AND profile.status = 'active' AND claim.status = 'active'
    ORDER BY kind, title
    LIMIT 24
  `, [workspace.brand_id]);
  return {
    workspace: {
      ...workspace,
      brand_handles: workspace.brand_handles ?? [],
      countries: workspace.countries ?? []
    },
    identities: identityResult.rows.map((row) => ({ ...row, aliases: row.aliases ?? [] })),
    brand_context: brandContextResult.rows
  };
}

export async function markSignalSemanticResolutionRunRunningV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = $1::uuid AND status IN ('queued', 'running')
  `, [runId]);
}

export async function reserveSignalSemanticResolutionMessageBatchV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string
) {
  const run = await queryable.query<{ provider_batch_id: string | null; provider_batch_status: string }>(`
    SELECT provider_batch_id, provider_batch_status
    FROM signal_semantic_resolution_runs
    WHERE id = $1::uuid
    FOR UPDATE
  `, [runId]);
  const current = requiredRow(run);
  if (current.provider_batch_id) return { reconciled: true, provider_batch_id: current.provider_batch_id };
  if (current.provider_batch_status === "submitting") {
    throw new SignalSemanticResolutionContractError(
      "conflict",
      "A provider batch submission is ambiguous and requires operator reconciliation."
    );
  }
  await queryable.query(`
    UPDATE signal_semantic_resolution_run_items
    SET provider_custom_id = 'mention_' || replace(mention_id::text, '-', ''), updated_at = now()
    WHERE run_id = $1::uuid AND status = 'pending' AND provider_custom_id IS NULL
  `, [runId]);
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET provider_batch_status = 'submitting', updated_at = now()
    WHERE id = $1::uuid AND status = 'running' AND provider_batch_id IS NULL
  `, [runId]);
  return { reconciled: false, provider_batch_id: null };
}

export async function attachSignalSemanticResolutionMessageBatchV1(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    run_id: string;
    provider_batch_id: string;
    provider_batch_status: "in_progress" | "canceling" | "ended";
    counts: {
      processing: number;
      succeeded: number;
      errored: number;
      canceled: number;
      expired: number;
    };
    ended_at?: string | null;
  }
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET provider_batch_id = $2,
      provider_batch_status = $3,
      provider_processing_items = $4,
      provider_succeeded_items = $5,
      provider_errored_items = $6,
      provider_canceled_items = $7,
      provider_expired_items = $8,
      provider_submitted_at = COALESCE(provider_submitted_at, now()),
      provider_ended_at = COALESCE($9::timestamptz, provider_ended_at),
      updated_at = now()
    WHERE id = $1::uuid
      AND (provider_batch_id IS NULL OR provider_batch_id = $2)
  `, [
    args.run_id,
    args.provider_batch_id,
    args.provider_batch_status,
    args.counts.processing,
    args.counts.succeeded,
    args.counts.errored,
    args.counts.canceled,
    args.counts.expired,
    args.ended_at ?? null
  ]);
}

export const updateSignalSemanticResolutionMessageBatchV1 =
  attachSignalSemanticResolutionMessageBatchV1;

export async function recordSignalSemanticResolutionProviderResultV1(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    run_id: string;
    provider_custom_id: string;
    result_status: "succeeded" | "errored" | "canceled" | "expired";
    decision?: SignalSemanticResolutionDecisionV1 | null;
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cost_usd?: number | string;
    error_code?: string | null;
  }
) {
  const item = await queryable.query<{
    mention_id: string;
    provider_result_status: string | null;
    decision: SignalSemanticResolutionDecisionV1 | null;
  }>(`
    SELECT mention_id::text, provider_result_status, decision
    FROM signal_semantic_resolution_run_items
    WHERE run_id = $1::uuid AND provider_custom_id = $2
    FOR UPDATE
  `, [args.run_id, args.provider_custom_id]);
  const current = requiredRow(item);
  if (current.provider_result_status !== null) {
    if (current.provider_result_status !== args.result_status) {
      throw new SignalSemanticResolutionContractError("conflict", "Provider result changed after import.");
    }
    if (args.decision && current.decision
      && signalSemanticStableHashV1(args.decision) !== signalSemanticStableHashV1(current.decision)) {
      throw new SignalSemanticResolutionContractError("conflict", "Provider decision changed after import.");
    }
    return { mention_id: current.mention_id, reconciled: true };
  }
  const inputTokens = args.input_tokens ?? 0;
  const outputTokens = args.output_tokens ?? 0;
  const cacheCreation = args.cache_creation_input_tokens ?? 0;
  const cacheRead = args.cache_read_input_tokens ?? 0;
  const cost = args.cost_usd ?? 0;
  await queryable.query(`
    UPDATE signal_semantic_resolution_run_items
    SET provider_result_status = $3,
      provider_input_tokens = $4,
      provider_output_tokens = $5,
      provider_cache_creation_input_tokens = $6,
      provider_cache_read_input_tokens = $7,
      provider_cost_usd = $8::numeric,
      provider_error_code = left($9, 120),
      decision = COALESCE($10::jsonb, decision),
      updated_at = now()
    WHERE run_id = $1::uuid AND provider_custom_id = $2
  `, [
    args.run_id,
    args.provider_custom_id,
    args.result_status,
    inputTokens,
    outputTokens,
    cacheCreation,
    cacheRead,
    cost,
    args.error_code ?? null,
    args.decision ? JSON.stringify(args.decision) : null
  ]);
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET input_tokens = input_tokens + $2,
      output_tokens = output_tokens + $3,
      actual_cost_usd = actual_cost_usd + $4::numeric,
      updated_at = now()
    WHERE id = $1::uuid
  `, [args.run_id, inputTokens, outputTokens, cost]);
  return { mention_id: current.mention_id, reconciled: false };
}

export type SignalSemanticResolutionAppliedResultV2 = {
  provider_custom_id: string;
  mention_id: string;
  result_status: "succeeded" | "errored" | "canceled" | "expired";
  decision: SignalSemanticResolutionDecisionV1 | null;
  classifications: Array<SignalSemanticResolutionClassificationV1 & {
    entity_type: "brand" | "competitor" | "category" | "reference" | "unattributed";
    entity_label: string | null;
  }>;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: string;
  error_code: string | null;
};

export async function applySignalSemanticResolutionResultBatchV2(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    run_id: string;
    child_batch_id: string;
    reviewer_user_id: string;
    model_version: string;
    results: SignalSemanticResolutionAppliedResultV2[];
  }
) {
  if(args.results.length===0)return {applied:0,failed:0,replayed:0,query_count:0};
  const customIds=new Set<string>();
  for(const result of args.results){
    if(customIds.has(result.provider_custom_id)){
      throw new SignalSemanticResolutionContractError("invalid_input","Provider results contain a duplicate custom ID.");
    }
    customIds.add(result.provider_custom_id);
    if(result.decision && result.decision.mention_id!==result.mention_id){
      throw new SignalSemanticResolutionContractError("invalid_input","Provider decision mention does not match its result.");
    }
    if(result.result_status==="succeeded" && (!result.decision || result.classifications.length===0)){
      throw new SignalSemanticResolutionContractError("invalid_input","Successful provider result is missing a semantic decision.");
    }
  }
  const payload=JSON.stringify(args.results);
  const verified=await queryable.query<{input_count:number;matched_count:number;replay_count:number}>(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($3::jsonb) AS value(
        provider_custom_id text,mention_id uuid,result_status text,decision jsonb
      )
    ), matched AS (
      SELECT input.*,item.provider_result_status,item.decision AS persisted_decision
      FROM input JOIN signal_semantic_resolution_run_items item
        ON item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
       AND item.provider_custom_id=input.provider_custom_id
       AND item.mention_id=input.mention_id
    )
    SELECT (SELECT count(*)::int FROM input) AS input_count,count(*)::int AS matched_count,
      count(*) FILTER(WHERE provider_result_status IS NOT NULL)::int AS replay_count
    FROM matched
    WHERE provider_result_status IS NULL
      OR (provider_result_status=result_status
        AND (decision IS NULL OR persisted_decision=decision))
  `,[args.run_id,args.child_batch_id,payload]);
  await queryable.query(`
    INSERT INTO signal_semantic_resolution_item_attempts(
      run_item_id,child_batch_id,attempt,provider_result_status,decision_digest,
      input_tokens,output_tokens,cost_micro_usd,error_code
    ) SELECT item.id,item.child_batch_id,item.attempt,item.provider_result_status,
      CASE WHEN item.decision IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(
        item.decision::text,'UTF8')),'hex') END,item.provider_input_tokens,
      item.provider_output_tokens,round(item.provider_cost_usd*1000000)::bigint,
      item.provider_error_code
    FROM signal_semantic_resolution_run_items item
    JOIN jsonb_to_recordset($3::jsonb) input(provider_custom_id text,mention_id uuid)
      ON input.provider_custom_id=item.provider_custom_id AND input.mention_id=item.mention_id
    WHERE item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
      AND item.provider_result_status IS NOT NULL
    ON CONFLICT(run_item_id,child_batch_id,attempt) DO NOTHING
  `,[args.run_id,args.child_batch_id,payload]);
  const verification=requiredRow(verified);
  if(Number(verification.input_count)!==args.results.length
    || Number(verification.matched_count)!==args.results.length){
    throw new SignalSemanticResolutionContractError("conflict","Provider result does not belong to the sealed child batch or changed after import.");
  }
  await queryable.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($3::jsonb) AS value(
        provider_custom_id text,mention_id uuid,result_status text,decision jsonb,
        input_tokens integer,output_tokens integer,cache_creation_input_tokens integer,
        cache_read_input_tokens integer,cost_usd numeric,error_code text
      )
    )
    UPDATE signal_semantic_resolution_run_items item SET
      provider_result_status=input.result_status,
      provider_input_tokens=input.input_tokens,provider_output_tokens=input.output_tokens,
      provider_cache_creation_input_tokens=input.cache_creation_input_tokens,
      provider_cache_read_input_tokens=input.cache_read_input_tokens,
      provider_cost_usd=input.cost_usd,provider_error_code=left(input.error_code,120),
      decision=COALESCE(input.decision,item.decision),updated_at=now()
    FROM input
    WHERE item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
      AND item.provider_custom_id=input.provider_custom_id
      AND item.mention_id=input.mention_id AND item.provider_result_status IS NULL
  `,[args.run_id,args.child_batch_id,payload]);
  const invalid=await queryable.query<{invalid_count:number}>(`
    WITH input AS (
      SELECT value.mention_id,value.result_status,value.classifications
      FROM jsonb_to_recordset($3::jsonb) AS value(
        mention_id uuid,result_status text,classifications jsonb
      )
    ), classifications AS (
      SELECT input.mention_id,classification.*
      FROM input CROSS JOIN LATERAL jsonb_to_recordset(input.classifications) AS classification(
        scope text,entity_type text,entity_id uuid,entity_label text,confidence numeric,rationale text
      ) WHERE input.result_status='succeeded'
    ), workspace AS (
      SELECT run.workspace_id,workspace.brand_id
      FROM signal_semantic_resolution_runs run
      JOIN signal_workspaces workspace ON workspace.id=run.workspace_id
      WHERE run.id=$1::uuid AND run.workspace_id=(
        SELECT child.workspace_id FROM signal_semantic_resolution_child_batches child
        WHERE child.id=$2::uuid AND child.run_id=run.id
      )
    )
    SELECT count(*)::int AS invalid_count FROM classifications classification CROSS JOIN workspace
    WHERE classification.scope NOT IN ('primary_brand','competitor','category','reference','unattributed')
      OR classification.confidence<0 OR classification.confidence>1
      OR NULLIF(btrim(classification.rationale),'') IS NULL
      OR (classification.scope='primary_brand' AND NOT(
        classification.entity_type='brand' AND classification.entity_id=workspace.brand_id))
      OR (classification.scope='competitor' AND NOT EXISTS(
        SELECT 1 FROM competitors competitor JOIN brand_seeds seed
          ON seed.id=competitor.competitor_brand_seed_id AND seed.active=true
        WHERE competitor.id=classification.entity_id AND competitor.brand_id=workspace.brand_id))
      OR (classification.scope IN ('category','reference') AND NOT EXISTS(
        SELECT 1 FROM intelligence_entities entity
        WHERE entity.id=classification.entity_id AND entity.brand_id=workspace.brand_id
          AND entity.entity_type=classification.scope AND entity.status='active'))
      OR (classification.scope='unattributed' AND NOT(
        classification.entity_type='unattributed' AND classification.entity_id IS NULL))
  `,[args.run_id,args.child_batch_id,payload]);
  if(Number(requiredRow(invalid).invalid_count)!==0){
    throw new SignalSemanticResolutionContractError("forbidden_state","Provider result references an invalid governed identity.");
  }
  await queryable.query(`
    WITH input AS (
      SELECT value.mention_id FROM jsonb_to_recordset($3::jsonb) AS value(
        mention_id uuid,result_status text
      ) WHERE value.result_status='succeeded'
    ), superseded AS (
      UPDATE signal_mention_attributions assertion SET is_current=false,
        eligibility_status='not_eligible',updated_at=now()
      FROM input,signal_semantic_resolution_runs run
      WHERE run.id=$1::uuid AND assertion.workspace_id=run.workspace_id
        AND assertion.mention_id=input.mention_id
        AND assertion.attribution_basis='mention_semantic' AND assertion.is_current=true
        AND EXISTS(SELECT 1 FROM signal_semantic_resolution_run_items item
          WHERE item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
            AND item.mention_id=input.mention_id AND item.status<>'completed')
      RETURNING assertion.workspace_id,assertion.id,assertion.review_status,
        assertion.eligibility_status,assertion.mention_id
    )
    INSERT INTO signal_mention_attribution_review_events(
      workspace_id,attribution_id,action,previous_review_status,next_review_status,
      previous_eligibility_status,next_eligibility_status,reviewer_user_id,
      review_policy_key,review_policy_version,rationale_hash,idempotency_key
    ) SELECT superseded.workspace_id,superseded.id,'superseded',superseded.review_status,
      superseded.review_status,superseded.eligibility_status,'not_eligible',$4::uuid,
      $5,$6,'sha256:'||encode(sha256(convert_to(concat_ws('|','superseded',$1::text,
        superseded.mention_id::text,superseded.id::text),'UTF8')),'hex'),
      'sha256:'||encode(sha256(convert_to(concat_ws('|','superseded-event',$1::text,
        superseded.id::text),'UTF8')),'hex')
    FROM superseded ON CONFLICT(workspace_id,idempotency_key) DO NOTHING
  `,[args.run_id,args.child_batch_id,payload,args.reviewer_user_id,
    SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION]);
  await queryable.query(`
    WITH input AS (
      SELECT value.mention_id,value.classifications
      FROM jsonb_to_recordset($3::jsonb) AS value(
        mention_id uuid,result_status text,classifications jsonb
      ) WHERE value.result_status='succeeded' AND EXISTS(
        SELECT 1 FROM signal_semantic_resolution_run_items item
        WHERE item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
          AND item.mention_id=value.mention_id AND item.status<>'completed'
      )
    ), classifications AS (
      SELECT input.mention_id,classification.*,
        row_number() OVER(PARTITION BY input.mention_id ORDER BY entry.ordinality) AS offset
      FROM input
      CROSS JOIN LATERAL jsonb_array_elements(input.classifications)
        WITH ORDINALITY AS entry(value,ordinality)
      CROSS JOIN LATERAL jsonb_to_record(entry.value) AS classification(
        scope text,entity_type text,entity_id uuid,entity_label text,confidence numeric,rationale text
      )
    ), anchors AS (
      SELECT DISTINCT ON(classification.mention_id) classification.*,
        attribution.data_source_id,attribution.import_batch_id,run.workspace_id
      FROM classifications classification
      JOIN signal_semantic_resolution_runs run ON run.id=$1::uuid
      JOIN signal_mention_attributions attribution
        ON attribution.workspace_id=run.workspace_id
       AND attribution.mention_id=classification.mention_id
       AND attribution.attribution_basis='source_intent'
      JOIN import_batches batch ON batch.id=attribution.import_batch_id
        AND batch.workspace_id=attribution.workspace_id AND batch.status='completed'
      ORDER BY classification.mention_id,attribution.created_at,attribution.id
    ), versioned AS (
      SELECT anchor.*,COALESCE(version.maximum,0)::int+anchor.offset::int AS assertion_version
      FROM anchors anchor LEFT JOIN LATERAL(
        SELECT max(assertion.assertion_version) AS maximum
        FROM signal_mention_attributions assertion
        WHERE assertion.mention_id=anchor.mention_id
          AND assertion.attribution_basis='mention_semantic'
          AND assertion.semantic_policy_key=$4
      ) version ON true
    )
    INSERT INTO signal_mention_attributions(
      workspace_id,mention_id,data_source_id,import_batch_id,scope,entity_type,entity_id,
      entity_label,confidence,review_status,attribution_source,policy_version,model_version,
      attribution_basis,eligibility_status,evidence_kind,evidence_hash,semantic_policy_key,
      assertion_version,is_current,idempotency_key,approved_by_user_id,approval_source,approved_at
    ) SELECT versioned.workspace_id,versioned.mention_id,versioned.data_source_id,
      versioned.import_batch_id,versioned.scope,versioned.entity_type,versioned.entity_id,
      versioned.entity_label,versioned.confidence,'pending','mention_semantic',$5,$6::text,
      'mention_semantic',CASE WHEN versioned.scope='unattributed' THEN 'not_eligible' ELSE 'candidate' END,
      'model_reviewed_context','sha256:'||encode(sha256(convert_to(concat_ws('|',$1::text,
        versioned.mention_id::text,versioned.scope,COALESCE(versioned.entity_id::text,'∅'),
        versioned.confidence::text,versioned.rationale,$6::text),'UTF8')),'hex'),$4,
      versioned.assertion_version,true,
      'sha256:'||encode(sha256(convert_to(concat_ws('|','resolution-assertion',$1::text,
        versioned.mention_id::text,versioned.scope,COALESCE(versioned.entity_id::text,'∅')),
        'UTF8')),'hex'),NULL,NULL,NULL
    FROM versioned
    ON CONFLICT(workspace_id,idempotency_key) WHERE attribution_basis='mention_semantic'
    DO NOTHING
  `,[args.run_id,args.child_batch_id,payload,
    SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
    args.model_version]);
  const terminal=await queryable.query<{completed:number;failed:number}>(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($3::jsonb) AS value(
        provider_custom_id text,mention_id uuid,result_status text,decision jsonb,error_code text
      )
    ), updated AS (
      UPDATE signal_semantic_resolution_run_items item SET
        status=CASE WHEN input.result_status='succeeded' THEN 'completed' ELSE 'failed' END,
        attempt=item.attempt+1,error_code=CASE WHEN input.result_status='succeeded'
          THEN NULL ELSE left(input.error_code,120) END,
        decision=COALESCE(input.decision,item.decision),
        started_at=COALESCE(item.started_at,now()),completed_at=now(),updated_at=now()
      FROM input
      WHERE item.run_id=$1::uuid AND item.child_batch_id=$2::uuid
        AND item.provider_custom_id=input.provider_custom_id
        AND item.mention_id=input.mention_id AND item.status IN ('pending','processing')
      RETURNING item.status
    ) SELECT count(*) FILTER(WHERE status='completed')::int AS completed,
      count(*) FILTER(WHERE status='failed')::int AS failed FROM updated
  `,[args.run_id,args.child_batch_id,payload]);
  return {applied:Number(requiredRow(terminal).completed),failed:Number(requiredRow(terminal).failed),
    replayed:Number(verification.replay_count),query_count:7};
}

export async function refreshSignalSemanticResolutionRunCountsV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs run
    SET completed_items = stats.completed_items,
      failed_items = stats.failed_items,
      updated_at = now()
    FROM (
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed_items,
        count(*) FILTER (WHERE status = 'failed')::int AS failed_items
      FROM signal_semantic_resolution_run_items WHERE run_id = $1::uuid
    ) stats
    WHERE run.id = $1::uuid
  `, [runId]);
}

export async function markSignalSemanticResolutionProviderResultsImportedV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string
) {
  await refreshSignalSemanticResolutionRunCountsV1(queryable, runId);
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET provider_results_imported_at = COALESCE(provider_results_imported_at, now()), updated_at = now()
    WHERE id = $1::uuid AND provider_batch_status = 'ended'
  `, [runId]);
}

export async function applySignalSemanticResolutionDecisionV1(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    run_id: string;
    mention_id: string;
    reviewer_user_id: string;
    model_version: string;
    decision: SignalSemanticResolutionDecisionV1;
  }
) {
  if (args.decision.mention_id !== args.mention_id) {
    throw new SignalSemanticResolutionContractError("invalid_input", "Model decision mention does not match the queued item.");
  }
  const item = await queryable.query<{ workspace_id: string; status: string }>(`
    SELECT workspace_id::text, status
    FROM signal_semantic_resolution_run_items
    WHERE run_id = $1::uuid AND mention_id = $2::uuid
    FOR UPDATE
  `, [args.run_id, args.mention_id]);
  const queuedItem = requiredRow(item);
  if (queuedItem.status === "completed") return { reconciled: true };
  await queryable.query(`
    UPDATE signal_semantic_resolution_run_items
    SET status = 'processing', attempt = attempt + 1,
      started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE run_id = $1::uuid AND mention_id = $2::uuid
  `, [args.run_id, args.mention_id]);

  const normalized = normalizeClassifications(args.decision.classifications);
  await validateClassifications(queryable, queuedItem.workspace_id, normalized);
  const provenance = await queryable.query<{ data_source_id: string; import_batch_id: string | null }>(`
    SELECT attribution.data_source_id::text, attribution.import_batch_id::text
    FROM signal_mention_attributions attribution
    JOIN import_batches batch ON batch.id=attribution.import_batch_id
      AND batch.workspace_id=attribution.workspace_id AND batch.status='completed'
    WHERE attribution.workspace_id = $1::uuid AND attribution.mention_id = $2::uuid
      AND attribution.attribution_basis = 'source_intent'
    ORDER BY attribution.created_at, attribution.id
    LIMIT 1
  `, [queuedItem.workspace_id, args.mention_id]);
  const anchor = requiredRow(provenance);
  await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${queuedItem.workspace_id}:${args.mention_id}:signal-semantic-resolution-v1`
  ]);

  const current = await queryable.query<{
    id: string;
    review_status: string;
    eligibility_status: string;
  }>(`
    SELECT id::text, review_status, eligibility_status
    FROM signal_mention_attributions
    WHERE workspace_id = $1::uuid AND mention_id = $2::uuid
      AND attribution_basis = 'mention_semantic' AND is_current = true
    FOR UPDATE
  `, [queuedItem.workspace_id, args.mention_id]);
  for (const assertion of current.rows) {
    const rationaleHash = signalSemanticStableHashV1({
      operation: "claude-resolution-supersession",
      run_id: args.run_id,
      mention_id: args.mention_id,
      assertion_id: assertion.id
    });
    const idempotencyKey = signalSemanticStableHashV1({
      operation: "claude-resolution-supersession-event",
      run_id: args.run_id,
      assertion_id: assertion.id
    });
    await queryable.query(`
      UPDATE signal_mention_attributions
      SET is_current = false, eligibility_status = 'not_eligible', updated_at = now()
      WHERE id = $1::uuid
    `, [assertion.id]);
    await queryable.query(`
      INSERT INTO signal_mention_attribution_review_events (
        workspace_id, attribution_id, action,
        previous_review_status, next_review_status,
        previous_eligibility_status, next_eligibility_status,
        reviewer_user_id, review_policy_key, review_policy_version,
        rationale_hash, idempotency_key
      ) VALUES (
        $1::uuid, $2::uuid, 'superseded', $3, $3, $4, 'not_eligible',
        $5::uuid, $6, $7, $8, $9
      ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
    `, [
      queuedItem.workspace_id,
      assertion.id,
      assertion.review_status,
      assertion.eligibility_status,
      args.reviewer_user_id,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
      rationaleHash,
      idempotencyKey
    ]);
  }

  for (const classification of normalized) {
    const entity = await resolveClassificationEntity(queryable, queuedItem.workspace_id, classification);
    const evidenceHash = signalSemanticStableHashV1({
      contract_version: SIGNAL_SEMANTIC_RESOLUTION_CONTRACT_VERSION,
      run_id: args.run_id,
      mention_id: args.mention_id,
      scope: classification.scope,
      entity_id: entity.entity_id,
      confidence: classification.confidence,
      rationale: classification.rationale,
      model_version: args.model_version
    });
    const assertionIdempotency = signalSemanticStableHashV1({
      operation: "claude-resolution-assertion",
      run_id: args.run_id,
      mention_id: args.mention_id,
      scope: classification.scope,
      entity_id: entity.entity_id
    });
    const version = await queryable.query<{ assertion_version: number }>(`
      SELECT COALESCE(max(assertion_version), 0)::int + 1 AS assertion_version
      FROM signal_mention_attributions
      WHERE mention_id = $1::uuid AND attribution_basis = 'mention_semantic'
        AND semantic_policy_key = $2
    `, [args.mention_id, SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY]);
    const inserted = await queryable.query<{ attribution_id: string }>(`
      INSERT INTO signal_mention_attributions (
        workspace_id, mention_id, data_source_id, import_batch_id,
        scope, entity_type, entity_id, entity_label, confidence,
        review_status, attribution_source, policy_version, model_version,
        attribution_basis, eligibility_status, evidence_kind, evidence_hash,
        semantic_policy_key, assertion_version, is_current, idempotency_key,
        approved_by_user_id, approval_source, approved_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        $5, $6, $7::uuid, $8, $9::numeric,
        'pending', 'mention_semantic', $10, $11,
        'mention_semantic', $12, 'model_reviewed_context', $13,
        $14, $15, true, $16,
        NULL, NULL, NULL
      )
      ON CONFLICT (workspace_id, idempotency_key) WHERE attribution_basis = 'mention_semantic'
      DO NOTHING
      RETURNING id::text AS attribution_id
    `, [
      queuedItem.workspace_id,
      args.mention_id,
      anchor.data_source_id,
      anchor.import_batch_id,
      classification.scope,
      entity.entity_type,
      entity.entity_id,
      entity.entity_label,
      classification.confidence,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_VERSION,
      args.model_version,
      classification.scope === "unattributed" ? "not_eligible" : "candidate",
      evidenceHash,
      SIGNAL_SEMANTIC_RESOLUTION_POLICY_KEY,
      requiredRow(version).assertion_version,
      assertionIdempotency
    ]);
    if (inserted.rows.length === 0) {
      const replay = await queryable.query<{ attribution_id: string }>(`
        SELECT id::text AS attribution_id FROM signal_mention_attributions
        WHERE workspace_id=$1::uuid AND attribution_basis='mention_semantic'
          AND idempotency_key=$2 AND review_status='pending'
          AND eligibility_status IN ('candidate','not_eligible')
      `,[queuedItem.workspace_id,assertionIdempotency]);
      requiredRow(replay);
    }
  }

  await queryable.query(`
    UPDATE signal_semantic_resolution_run_items
    SET status = 'completed', decision = $3::jsonb, error_code = NULL,
      completed_at = now(), updated_at = now()
    WHERE run_id = $1::uuid AND mention_id = $2::uuid
  `, [args.run_id, args.mention_id, JSON.stringify({ ...args.decision, classifications: normalized })]);
  return { reconciled: false };
}

export async function recordSignalSemanticResolutionUsageV1(
  queryable: SignalSemanticResolutionQueryable,
  args: { run_id: string; input_tokens: number; output_tokens: number; cost_usd: number }
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs run
    SET completed_items = stats.completed_items,
      failed_items = stats.failed_items,
      input_tokens = input_tokens + $2,
      output_tokens = output_tokens + $3,
      actual_cost_usd = actual_cost_usd + $4::numeric,
      updated_at = now()
    FROM (
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed_items,
        count(*) FILTER (WHERE status = 'failed')::int AS failed_items
      FROM signal_semantic_resolution_run_items WHERE run_id = $1::uuid
    ) stats
    WHERE run.id = $1::uuid
  `, [args.run_id, args.input_tokens, args.output_tokens, args.cost_usd]);
}

export async function recordSignalSemanticResolutionBatchOutputV1(
  queryable: SignalSemanticResolutionQueryable,
  args: {
    run_id: string;
    decisions: SignalSemanticResolutionDecisionV1[];
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }
) {
  if (args.decisions.length === 0) {
    throw new SignalSemanticResolutionContractError("invalid_input", "A semantic resolution batch cannot be empty.");
  }
  const mentionIds = args.decisions.map((decision) => decision.mention_id);
  if (new Set(mentionIds).size !== mentionIds.length) {
    throw new SignalSemanticResolutionContractError("invalid_input", "A semantic resolution batch contains duplicate mentions.");
  }
  const locked = await queryable.query<{ mention_id: string; decision: SignalSemanticResolutionDecisionV1 | null }>(`
    SELECT mention_id::text, decision
    FROM signal_semantic_resolution_run_items
    WHERE run_id = $1::uuid AND mention_id = ANY($2::uuid[])
    ORDER BY mention_id
    FOR UPDATE
  `, [args.run_id, mentionIds]);
  if (locked.rows.length !== args.decisions.length) {
    throw new SignalSemanticResolutionContractError("not_found", "A semantic resolution batch item was not found.");
  }
  const existing = new Map(locked.rows.map((row) => [row.mention_id, row.decision]));
  const alreadyRecorded = args.decisions.every((decision) => {
    const stored = existing.get(decision.mention_id);
    return stored && signalSemanticStableHashV1(stored) === signalSemanticStableHashV1(decision);
  });
  if (alreadyRecorded) return { reconciled: true };
  if (locked.rows.some((row) => row.decision !== null)) {
    throw new SignalSemanticResolutionContractError("conflict", "A semantic resolution batch was already recorded with different output.");
  }
  for (const decision of args.decisions) {
    await queryable.query(`
      UPDATE signal_semantic_resolution_run_items
      SET decision = $3::jsonb, updated_at = now()
      WHERE run_id = $1::uuid AND mention_id = $2::uuid AND status = 'pending'
    `, [args.run_id, decision.mention_id, JSON.stringify(decision)]);
  }
  await recordSignalSemanticResolutionUsageV1(queryable, {
    run_id: args.run_id,
    input_tokens: args.input_tokens,
    output_tokens: args.output_tokens,
    cost_usd: args.cost_usd
  });
  return { reconciled: false };
}

export async function failSignalSemanticResolutionItemV1(
  queryable: SignalSemanticResolutionQueryable,
  args: { run_id: string; mention_id: string; error_code: string }
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_run_items
    SET status = 'failed', error_code = left($3, 120),
      completed_at = now(), updated_at = now()
    WHERE run_id = $1::uuid AND mention_id = $2::uuid
      AND status <> 'completed'
  `, [args.run_id, args.mention_id, args.error_code]);
}

export async function completeSignalSemanticResolutionRunV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs run
    SET completed_items = stats.completed_items,
      failed_items = stats.failed_items,
      status = CASE
        WHEN stats.failed_items = 0 AND stats.pending_items = 0 THEN 'completed'
        WHEN stats.completed_items > 0 THEN 'partial'
        ELSE 'failed'
      END,
      error_code = CASE WHEN stats.failed_items > 0 THEN 'semantic_resolution_item_failed' ELSE NULL END,
      completed_at = now(), updated_at = now()
    FROM (
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed_items,
        count(*) FILTER (WHERE status = 'failed')::int AS failed_items,
        count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS pending_items
      FROM signal_semantic_resolution_run_items WHERE run_id = $1::uuid
    ) stats
    WHERE run.id = $1::uuid
  `, [runId]);
}

export async function failSignalSemanticResolutionRunV1(
  queryable: SignalSemanticResolutionQueryable,
  runId: string,
  errorCode: string
) {
  await queryable.query(`
    UPDATE signal_semantic_resolution_runs
    SET status = 'failed', error_code = left($2, 120), completed_at = now(), updated_at = now()
    WHERE id = $1::uuid AND status IN ('queued', 'running')
  `, [runId, errorCode]);
}

async function loadResolutionWorkload(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
) {
  const result = await queryable.query<WorkloadRow>(`
    SELECT mention.id::text AS mention_id,
      'sha256:' || encode(sha256(convert_to(concat_ws(E'\n',
        mention.id::text, mention.published_at::text,
        COALESCE(mention.resolved_platform, mention.platform), mention.title,
        mention.text_clean, mention.raw_metadata->>'thread_context',
        author.handle, author.display_name
      ), 'UTF8')), 'hex') AS context_hash,
      length(COALESCE(mention.title, ''))
        + length(mention.text_clean)
        + length(COALESCE(mention.raw_metadata->>'thread_context', ''))
        + length(COALESCE(author.handle, ''))
        + length(COALESCE(author.display_name, '')) AS character_count
    FROM mentions mention
    LEFT JOIN authors author ON author.id = mention.author_id
    WHERE mention.workspace_id = $1::uuid
      AND mention.canonical_mention_id = mention.id
      AND mention.inclusion_status = 'included'
      AND EXISTS (
        SELECT 1 FROM signal_mention_attributions intent
        WHERE intent.workspace_id = mention.workspace_id
          AND intent.mention_id = mention.id
          AND intent.attribution_basis = 'source_intent'
      )
      AND NOT EXISTS (
        SELECT 1 FROM signal_mention_attributions assertion
        WHERE assertion.workspace_id = mention.workspace_id
          AND assertion.mention_id = mention.id
          AND assertion.attribution_basis = 'mention_semantic'
          AND assertion.is_current = true
          AND assertion.review_status IN ('approved', 'rejected')
      )
    ORDER BY mention.published_at, mention.id
  `, [workspaceId]);
  return result.rows;
}

async function loadActiveSignalSemanticResolutionRunV1(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string
) {
  const result = await queryable.query<RunRow>(`
    SELECT id::text, workspace_id::text, status, model_version,
      total_items, completed_items, failed_items,
      estimated_cost_usd::text, actual_cost_usd::text,
      budget_threshold_usd::text, budget_cap_usd::text,
      over_budget_confirmed, provider_batch_id, provider_batch_status,
      provider_processing_items, provider_succeeded_items, provider_errored_items,
      provider_canceled_items, provider_expired_items,
      provider_submitted_at::text, provider_ended_at::text,
      provider_results_imported_at::text, error_code,
      created_at::text, started_at::text, completed_at::text
    FROM signal_semantic_resolution_runs
    WHERE workspace_id = $1::uuid AND status = ANY($2::text[])
    ORDER BY created_at DESC, id DESC LIMIT 1
  `, [workspaceId, ACTIVE_STATUSES]);
  return result.rows[0] ? toRun(result.rows[0]) : null;
}

function normalizeClassifications(input: SignalSemanticResolutionClassificationV1[]) {
  const candidates = input.length > 0 ? input : [{
    scope: "unattributed" as const,
    entity_id: null,
    confidence: 0,
    rationale: "There is not enough responsible evidence to attribute this mention."
  }];
  const deduped = new Map<string, SignalSemanticResolutionClassificationV1>();
  for (const item of candidates) {
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
      throw new SignalSemanticResolutionContractError("invalid_input", "Semantic confidence must be between zero and one.");
    }
    const rationale = item.rationale.trim();
    if (!rationale) throw new SignalSemanticResolutionContractError("invalid_input", "Semantic rationale is required.");
    const normalized = {
      ...item,
      entity_id: item.scope === "unattributed" ? null : item.entity_id,
      rationale: rationale.slice(0, 600)
    };
    deduped.set(`${normalized.scope}:${normalized.entity_id ?? "none"}`, normalized);
  }
  const values = [...deduped.values()];
  if (values.some((item) => item.scope === "unattributed") && values.length > 1) {
    throw new SignalSemanticResolutionContractError("invalid_input", "Unattributed cannot be combined with another semantic identity.");
  }
  return values;
}

async function validateClassifications(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string,
  classifications: SignalSemanticResolutionClassificationV1[]
) {
  for (const classification of classifications) {
    const entity = await resolveClassificationEntity(queryable, workspaceId, classification);
    await queryable.query("SELECT assert_signal_semantic_entity_contract($1::uuid, $2, $3, $4::uuid)", [
      workspaceId,
      classification.scope,
      entity.entity_type,
      entity.entity_id
    ]);
  }
}

async function resolveClassificationEntity(
  queryable: SignalSemanticResolutionQueryable,
  workspaceId: string,
  classification: SignalSemanticResolutionClassificationV1
) {
  if (classification.scope === "unattributed") {
    return { entity_type: "unattributed", entity_id: null, entity_label: null };
  }
  const result = await queryable.query<{
    entity_type: string;
    entity_id: string;
    entity_label: string;
  }>(`
    SELECT 'brand' AS entity_type, brand.id::text AS entity_id,
      COALESCE(brand.display_name, brand.name) AS entity_label
    FROM signal_workspaces workspace JOIN brands brand ON brand.id = workspace.brand_id
    WHERE workspace.id = $1::uuid AND $2 = 'primary_brand' AND brand.id = $3::uuid
    UNION ALL
    SELECT 'competitor', competitor.id::text, seed.canonical_name
    FROM signal_workspaces workspace
    JOIN competitors competitor ON competitor.brand_id = workspace.brand_id
    JOIN brand_seeds seed ON seed.id = competitor.competitor_brand_seed_id
    WHERE workspace.id = $1::uuid AND $2 = 'competitor' AND competitor.id = $3::uuid
    UNION ALL
    SELECT entity.entity_type, entity.id::text, entity.canonical_name
    FROM signal_workspaces workspace
    JOIN intelligence_entities entity ON entity.brand_id = workspace.brand_id
    WHERE workspace.id = $1::uuid AND entity.entity_type = $2
      AND entity.id = $3::uuid AND entity.status = 'active'
    LIMIT 1
  `, [workspaceId, classification.scope, classification.entity_id]);
  if (!result.rows[0]) {
    throw new SignalSemanticResolutionContractError(
      "forbidden_state",
      `Semantic identity is not governed for scope ${classification.scope}.`
    );
  }
  return result.rows[0];
}

function toRun(row: RunRow): SignalSemanticResolutionRunV1 {
  return {
    contract_version: SIGNAL_SEMANTIC_RESOLUTION_CONTRACT_VERSION,
    run_id: row.id,
    workspace_id: row.workspace_id,
    status: row.status,
    model_version: row.model_version,
    total_items: row.total_items,
    completed_items: row.completed_items,
    failed_items: row.failed_items,
    estimated_cost_usd: Number(row.estimated_cost_usd),
    actual_cost_usd: Number(row.actual_cost_usd),
    budget_threshold_usd: Number(row.budget_threshold_usd),
    budget_cap_usd: Number(row.budget_cap_usd),
    over_budget_confirmed: row.over_budget_confirmed,
    provider_batch_id: row.provider_batch_id,
    provider_batch_status: row.provider_batch_status,
    provider_processing_items: row.provider_processing_items,
    provider_succeeded_items: row.provider_succeeded_items,
    provider_errored_items: row.provider_errored_items,
    provider_canceled_items: row.provider_canceled_items,
    provider_expired_items: row.provider_expired_items,
    provider_submitted_at: row.provider_submitted_at,
    provider_ended_at: row.provider_ended_at,
    provider_results_imported_at: row.provider_results_imported_at,
    error_code: row.error_code,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at
  };
}

function estimateFromRun(run: SignalSemanticResolutionRunV1) {
  return {
    mention_count: run.total_items,
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    estimated_cost_usd: run.estimated_cost_usd,
    confirmation_required: run.estimated_cost_usd > run.budget_threshold_usd,
    threshold_usd: run.budget_threshold_usd
  };
}

function requiredRow<T>(result: QueryResult<T & QueryResultRow>): T {
  const row = result.rows[0];
  if (!row) throw new SignalSemanticResolutionContractError("not_found", "Semantic resolution record was not found.");
  return row;
}
