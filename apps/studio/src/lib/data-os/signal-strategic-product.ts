import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  ensureSignalStrategicExecutionCorpusV1,
  ensureSignalStrategicGovernedAuthorityV1
} from "@/lib/data-os/signal-strategic-authority";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";

const CONTRACT = "signal-strategic-product-authority-v1" as const;

export type SignalStrategicProductStatusV1 = {
  contract_version: typeof CONTRACT;
  workspace_id: string;
  state: "blocked" | "ready" | "current" | "stale";
  blockers: string[];
  required_usage_purposes: ["llm-processing", "strategic-analysis"];
  entity_scopes: string[];
  population: { reference: string; denominator_count: number; membership_digest: string } | null;
  compilation: { status: string; next_policy_transition_at: string | null; governance_unknown_count: number | null } | null;
  binding_current: boolean;
  execution_corpus_ready: boolean;
};

export type SignalStrategicProductOperationResultV1 = {
  contract_version: typeof CONTRACT;
  action: "reconcile" | "promote";
  execution_corpus_created: boolean;
  authority: {
    population_ref: string;
    denominator_count: number;
    governance_unknown_count: number;
    next_policy_transition_at: string | null;
    binding_current: boolean;
  };
  status: SignalStrategicProductStatusV1;
};

export async function loadSignalStrategicProductStatusV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}): Promise<SignalStrategicProductStatusV1> {
  assertAuthority(args.workspace,args.actor);
  const result = await args.queryable.query<{
    bundle_status: string | null; scopes: string[]; population_id: string | null;
    population_version: number | null; membership_digest: string | null;
    membership_count: number | null; compilation_status: string | null;
    governance_unknown_count: number | null; next_policy_transition_at: string | null;
    invalidation_count: number; binding_current: boolean; execution_corpus_count: number;
    active_quality_count: number; strategic_provenance_count: number;
  }>(`
    WITH bundle AS (
      SELECT * FROM signal_population_policy_bundles
      WHERE workspace_id=$1::uuid AND policy_key='triggers-barriers-strategic-governed'
        AND policy_version=1 ORDER BY created_at DESC LIMIT 1
    ), compilation AS (
      SELECT candidate.* FROM signal_population_policy_compilations candidate
      JOIN bundle ON bundle.id=candidate.policy_bundle_id
      WHERE candidate.workspace_id=$1::uuid AND candidate.module_key='triggers-barriers'
        AND candidate.view_key='strategic' AND candidate.is_current LIMIT 1
    ) SELECT bundle.status AS bundle_status,COALESCE(bundle.allowed_scopes,'{}'::text[]) AS scopes,
      population.id::text AS population_id,population.version AS population_version,
      population.membership_digest,
      (SELECT count(*)::int FROM signal_population_memberships membership
        WHERE membership.workspace_id=$1::uuid AND membership.population_id=population.id
          AND membership.membership_status='included' AND membership.removed_at IS NULL) AS membership_count,
      compilation.compilation_status,compilation.governance_unknown_count,
      compilation.next_policy_transition_at::text,
      COALESCE((SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id),0) AS invalidation_count,
      EXISTS (SELECT 1 FROM signal_governed_view_bindings binding
        WHERE binding.workspace_id=$1::uuid AND binding.module_key='triggers-barriers'
          AND binding.view_key='strategic' AND binding.binding_status='current') AS binding_current,
      (SELECT count(*)::int FROM signal_workspace_corpora membership
        JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
        JOIN methodologies methodology ON methodology.id=corpus.methodology_id
        WHERE membership.workspace_id=$1::uuid AND membership.role='strategic'
          AND membership.valid_to IS NULL AND methodology.slug='triggers-barriers'
          AND corpus.analysis_plan->>'contract_version'='signal-tb-execution-corpus-v1') AS execution_corpus_count,
      (SELECT count(*)::int FROM signal_quality_policies quality
        WHERE quality.workspace_id=$1::uuid AND quality.status='active'
          AND quality.canonical_root_disposition='evaluate'
          AND quality.effective_from<=clock_timestamp()
          AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())) AS active_quality_count,
      (SELECT count(*)::int FROM signal_provenance_policy_bindings provenance
        JOIN signal_licensing_policy_usages llm ON llm.licensing_policy_id=provenance.licensing_policy_id
          AND llm.usage_purpose='llm-processing' AND llm.decision='allowed'
        JOIN signal_licensing_policy_usages strategic ON strategic.licensing_policy_id=provenance.licensing_policy_id
          AND strategic.usage_purpose='strategic-analysis' AND strategic.decision='allowed'
        WHERE provenance.workspace_id=$1::uuid AND provenance.status='active'
          AND provenance.effective_from<=clock_timestamp()
          AND (provenance.effective_to IS NULL OR provenance.effective_to>clock_timestamp())) AS strategic_provenance_count
    FROM (SELECT 1) singleton LEFT JOIN bundle ON true
    LEFT JOIN compilation ON true
    LEFT JOIN signal_population_definitions population ON population.id=compilation.population_id
  `, [args.workspace.id]);
  const row = result.rows[0]!;
  const blockers: string[] = [];
  if (row.active_quality_count !== 1) blockers.push("exact_active_quality_policy_required");
  if (row.strategic_provenance_count < 1) blockers.push("strategic_usage_authorization_required");
  if (row.execution_corpus_count !== 1) blockers.push("strategic_execution_corpus_required");
  if (!row.population_id) blockers.push("strategic_population_required");
  if (row.compilation_status !== "ready") blockers.push("strategic_compilation_ready_required");
  if (row.governance_unknown_count !== null && row.governance_unknown_count !== 0) blockers.push("strategic_governance_not_exact");
  if (row.invalidation_count > 0) blockers.push("strategic_compilation_invalidated");
  let state: SignalStrategicProductStatusV1["state"] = "blocked";
  if (row.invalidation_count > 0 || row.compilation_status === "stale") state = "stale";
  else if (blockers.length === 0) state = row.binding_current ? "current" : "ready";
  return {
    contract_version: CONTRACT,workspace_id: args.workspace.id,state,blockers,
    required_usage_purposes: ["llm-processing","strategic-analysis"],
    entity_scopes: row.scopes,
    population: row.population_id && row.population_version && row.membership_digest !== null
      ? { reference: `triggers-barriers/strategic/v${row.population_version}`,
        denominator_count: row.membership_count ?? 0,membership_digest: row.membership_digest }
      : null,
    compilation: row.compilation_status ? { status: row.compilation_status,
      next_policy_transition_at: row.next_policy_transition_at,
      governance_unknown_count: row.governance_unknown_count } : null,
    binding_current: row.binding_current,
    execution_corpus_ready: row.execution_corpus_count === 1
  };
}

export async function reconcileSignalStrategicProductAuthorityV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  promote: boolean;
}): Promise<SignalStrategicProductOperationResultV1> {
  assertAuthority(args.workspace,args.actor);
  const action = args.promote ? "promote-strategic-authority" : "reconcile-strategic-authority";
  const operation = await beginSignalProductOperationV1<SignalStrategicProductOperationResultV1>(
    { ...args,action,input: { promote: args.promote } }
  );
  if (operation.replay !== null) return operation.replay;
  const execution = await ensureSignalStrategicExecutionCorpusV1(args);
  const authority = await ensureSignalStrategicGovernedAuthorityV1({
    ...args,promoteBinding: args.promote
  });
  const status = await loadSignalStrategicProductStatusV1(args);
  if (args.promote && status.state !== "current") throw new Error("Strategic binding promotion is not current.");
  if (!args.promote && !["ready","current"].includes(status.state)) {
    throw new Error("Strategic authority remains blocked after reconciliation.");
  }
  const result: SignalStrategicProductOperationResultV1 = {
    contract_version: CONTRACT,
    action: args.promote ? "promote" as const : "reconcile" as const,
    execution_corpus_created: execution.created,
    authority: {
      population_ref: `triggers-barriers/strategic/v${authority.population_version}`,
      denominator_count: authority.membership_count,
      governance_unknown_count: authority.governance_unknown_count,
      next_policy_transition_at: authority.next_policy_transition_at,
      binding_current: authority.binding_id !== null
    },
    status
  };
  await completeSignalProductOperationV1({
    queryable: args.queryable,workspaceId: args.workspace.id,key: operation.key,result
  });
  return result;
}

export async function loadSignalStrategicProductStatusForWorkspaceV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const { pool } = await import("@/lib/db");
  return loadSignalStrategicProductStatusV1({ ...args,queryable: pool });
}

export async function reconcileSignalStrategicProductAuthorityInTransactionV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  promote: boolean;
}) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await reconcileSignalStrategicProductAuthorityV1({ ...args,queryable: client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertAuthority(workspace: ResolvedSignalWorkspace,actor: SignalWorkspaceUser) {
  if (workspace.status!=="active" || workspace.subject.type!=="brand"
    || actor.userType!=="noisia_internal") {
    throw new Error("Strategic product authority requires an active brand workspace and internal operator.");
  }
}
