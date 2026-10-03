import type {
  SignalClientGovernedViewKeyV1,
  SignalClientGovernedViewModuleKeyV1
} from "@noisia/query-engine";

import type { SignalBrandPolicyQueryable } from "./signal-governed-brand-policy";
import {
  ensureSignalGovernedViewPolicyDraftV1,
  reconcileSignalGovernedViewPolicyCandidateV1,
  resolveSignalGovernedViewPolicyDraftGovernanceV1
} from "./signal-governed-view-policy";
import {
  loadSignalGovernedViewBindingSetPreflightV1,
  promoteSignalGovernedViewBindingSetV1
} from "./signal-governed-view-bindings";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "./signal-workspace";

const VIEWS = ["competition", "category", "all-governed"] as const;
const MODULES = ["brand-monitoring", "mentions", "topics-narratives"] as const;

/**
 * Test-only orchestration over an already-seeded workspace.
 *
 * The caller owns semantic assertions and governance authorities. This helper
 * creates no fake entities or permissions; it only compiles the closed views,
 * writes deterministic population-scoped fixture watermarks, and promotes the
 * exact three-module binding sets so loader/shadow integrations can share one
 * fixture without duplicating compiler logic.
 */
export async function seedSignalGovernedMultiViewFixture(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  qualityPolicyId: string;
  sourceId: string;
  views?: readonly Exclude<SignalClientGovernedViewKeyV1, "brand">[];
}) {
  const views = args.views ?? VIEWS;
  const result: Array<{
    view_key: Exclude<SignalClientGovernedViewKeyV1, "brand">;
    policy_bundle_id: string;
    modules: Array<{
      module_key: SignalClientGovernedViewModuleKeyV1;
      population_id: string;
      policy_compilation_id: string;
      membership_digest: string;
      membership_count: number;
    }>;
  }> = [];
  for (const viewKey of views) {
    const draft = await ensureSignalGovernedViewPolicyDraftV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey,
      queryable: args.queryable
    });
    await resolveSignalGovernedViewPolicyDraftGovernanceV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey,
      policyBundleId: draft.policy_bundle_id,
      qualityPolicyId: args.qualityPolicyId,
      queryable: args.queryable
    });
    const modules = [] as (typeof result)[number]["modules"];
    for (const moduleKey of MODULES) {
      const initial = await reconcileSignalGovernedViewPolicyCandidateV1({
        workspace: args.workspace,
        actor: args.actor,
        viewKey,
        policyBundleId: draft.policy_bundle_id,
        moduleKey,
        reconcileMemberships: true,
        queryable: args.queryable
      });
      await args.queryable.query(`
        INSERT INTO signal_data_watermarks (
          workspace_id,study_corpus_id,population_id,data_source_id,source_key,
          corpus_revision,max_observed_at,accepted_at,materialized_at,
          source_freshness_state,data_freshness_state
        ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,$4,1,
          clock_timestamp(),clock_timestamp(),clock_timestamp(),'fresh','fresh')
        ON CONFLICT DO NOTHING
      `, [args.workspace.id,initial.population_id,args.sourceId,
        `test-${viewKey}-${moduleKey}`]);
      const ready = await reconcileSignalGovernedViewPolicyCandidateV1({
        workspace: args.workspace,
        actor: args.actor,
        viewKey,
        policyBundleId: draft.policy_bundle_id,
        moduleKey,
        reconcileMemberships: true,
        queryable: args.queryable
      });
      if (ready.compilation_status !== "ready" || ready.governance_unknown_count !== 0) {
        throw new Error(`Test fixture ${moduleKey}/${viewKey} is not client-safe ready.`);
      }
      modules.push({
        module_key: moduleKey,
        population_id: ready.population_id,
        policy_compilation_id: ready.policy_compilation_id,
        membership_digest: ready.actual_membership_digest,
        membership_count: ready.actual_membership_count
      });
    }
    const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey,
      queryable: args.queryable
    });
    await promoteSignalGovernedViewBindingSetV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey,
      expectedSetDigest: preflight.set_digest,
      idempotencyKey: `test-${viewKey}-binding-set-promote`,
      queryable: args.queryable
    });
    result.push({ view_key: viewKey,policy_bundle_id: draft.policy_bundle_id,modules });
  }
  return {
    workspace: args.workspace,
    actor: args.actor,
    views: result
  };
}
