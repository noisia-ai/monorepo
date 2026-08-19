import { createHash } from "node:crypto";

import {
  SIGNAL_CLIENT_GOVERNED_VIEW_KEYS,
  SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS,
  type SignalClientGovernedViewKeyV1,
  type SignalClientGovernedViewModuleKeyV1
} from "@noisia/query-engine";

import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import {
  loadSignalGovernedViewBindingSetPreflightV1,
  promoteSignalGovernedViewBindingSetV1,
  withdrawSignalGovernedViewBindingSetV1
} from "@/lib/data-os/signal-governed-view-bindings";
import {
  ensureSignalGovernedViewPolicyDraftV1,
  reconcileSignalGovernedViewPolicyCandidateV1,
  resolveSignalGovernedViewPolicyDraftGovernanceV1,
  signalGovernedViewPolicyIdentityV1
} from "@/lib/data-os/signal-governed-view-policy";
import type {
  ResolvedSignalWorkspace,
  SignalWorkspaceUser
} from "@/lib/data-os/signal-workspace";
import {
  beginSignalProductOperationV1,
  completeSignalProductOperationV1
} from "@/lib/data-os/signal-product-operation";

const CONTRACT = "signal-governed-view-product-orchestrator-v1" as const;

export type SignalGovernedViewProductStateV1 =
  | "not_applicable"
  | "blocked"
  | "draft"
  | "evaluating"
  | "ready"
  | "stale"
  | "current"
  | "withdrawn";

export type SignalGovernedViewProductModuleV1 = {
  module_key: SignalClientGovernedViewModuleKeyV1;
  state: SignalGovernedViewProductStateV1;
  denominator_count: number | null;
  coverage_state: "partial" | "not_available";
  abstained: null;
  abstained_availability: "not_available";
  population_ref: string | null;
  compilation_status: "ready" | "stale" | "blocked" | null;
  membership_digest: string | null;
  source_watermark_at: string | null;
  next_policy_transition_at: string | null;
  blockers: string[];
  current_binding: boolean;
};

export type SignalGovernedViewProductViewV1 = {
  view_key: SignalClientGovernedViewKeyV1;
  applicable: boolean;
  state: SignalGovernedViewProductStateV1;
  eligible_root_count: number;
  entity_count: number;
  policy_status: "draft" | "active" | "retired" | null;
  last_compiled_at: string | null;
  blockers: string[];
  set_digest: string | null;
  modules: SignalGovernedViewProductModuleV1[];
};

export type SignalGovernedViewsProductPreflightV1 = {
  contract_version: typeof CONTRACT;
  workspace_id: string;
  read_only: true;
  writes_performed: false;
  views: SignalGovernedViewProductViewV1[];
};

export type SignalGovernedViewProductReconcileResultV1 = {
  contract_version: typeof CONTRACT;
  action: "reconcile";
  view_key: SignalClientGovernedViewKeyV1;
  idempotency_digest: string;
  policy_key: string;
  modules: Array<{
    module_key: SignalClientGovernedViewModuleKeyV1;
    state: "ready" | "stale" | "blocked";
    denominator_count: number;
    population_ref: string;
    membership_digest: string;
    governance_unknown_count: number;
  }>;
  preflight: SignalGovernedViewProductViewV1 | undefined;
};

type StatusRow = {
  view_key: SignalClientGovernedViewKeyV1;
  module_key: SignalClientGovernedViewModuleKeyV1 | null;
  entity_count: number;
  eligible_root_count: number;
  policy_status: "draft" | "active" | "retired" | null;
  population_id: string | null;
  population_version: number | null;
  membership_digest: string | null;
  compilation_status: "ready" | "stale" | "blocked" | null;
  blocking_reasons: string[] | null;
  authorized_root_count: number | null;
  governance_unknown_count: number | null;
  source_watermark_at: string | null;
  next_policy_transition_at: string | null;
  compiled_at: string | null;
  current_binding: boolean;
  invalidation_count: number;
};

export async function loadSignalGovernedViewsProductPreflightV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}): Promise<SignalGovernedViewsProductPreflightV1> {
  assertAuthority(args.workspace, args.actor);
  const status = await loadStatusRows(args.queryable, args.workspace);
  const views: SignalGovernedViewProductViewV1[] = [];
  for (const viewKey of SIGNAL_CLIENT_GOVERNED_VIEW_KEYS) {
    const rows = status.filter((row) => row.view_key === viewKey);
    const first = rows[0]!;
    const applicable = first.eligible_root_count > 0 && first.entity_count > 0;
    const modules = SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS.map((moduleKey) => {
      const row = rows.find((candidate) => candidate.module_key === moduleKey) ?? first;
      return moduleState(row, applicable);
    });
    let setDigest: string | null = null;
    if (applicable && modules.every((module) => module.compilation_status === "ready")) {
      try {
        const preflight = await loadSignalGovernedViewBindingSetPreflightV1({
          workspace: args.workspace,
          actor: args.actor,
          viewKey,
          queryable: args.queryable
        });
        setDigest = preflight.set_digest;
      } catch {
        // Status remains fail-closed; no mutation and no internal SQL error is exposed.
      }
    }
    const blockers = [...new Set(modules.flatMap((module) => module.blockers))].sort();
    views.push({
      view_key: viewKey,
      applicable,
      state: applicable ? aggregateState(modules) : "not_applicable",
      eligible_root_count: first.eligible_root_count,
      entity_count: first.entity_count,
      policy_status: first.policy_status,
      last_compiled_at: rows.map((row) => row.compiled_at).filter(Boolean).sort().at(-1) ?? null,
      blockers,
      set_digest: setDigest,
      modules
    });
  }
  return {
    contract_version: CONTRACT,
    workspace_id: args.workspace.id,
    read_only: true,
    writes_performed: false,
    views
  };
}

export async function reconcileSignalGovernedViewProductV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  idempotencyKey: string;
}): Promise<SignalGovernedViewProductReconcileResultV1> {
  assertAuthority(args.workspace, args.actor);
  const operation = await beginSignalProductOperationV1<SignalGovernedViewProductReconcileResultV1>(
    { ...args,action: "reconcile-governed-view",input: { view_key: args.viewKey } }
  );
  if (operation.replay !== null) return operation.replay;
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${args.workspace.id}:${args.viewKey}:product-reconcile`
  ]);
  const before = await loadSignalGovernedViewsProductPreflightV1(args);
  const view = before.views.find((candidate) => candidate.view_key === args.viewKey)!;
  if (!view.applicable) {
    throw new Error(`${args.viewKey} is not applicable to the current governed entity registry and assertions.`);
  }
  const qualityPolicyId = await loadExactActiveQualityPolicyId(args.queryable, args.workspace.id);
  const target = await resolvePolicyBundleTargetV1({
    queryable: args.queryable,
    workspaceId: args.workspace.id,
    viewKey: args.viewKey,
    qualityPolicyId
  });
  let policyBundleId = target.reusable_policy_bundle_id;
  if (!policyBundleId) {
    const draft = await ensureSignalGovernedViewPolicyDraftV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey: args.viewKey,
      policyVersion: target.policy_version,
      queryable: args.queryable
    });
    const governed = await resolveSignalGovernedViewPolicyDraftGovernanceV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey: args.viewKey,
      policyBundleId: draft.policy_bundle_id,
      qualityPolicyId,
      queryable: args.queryable
    });
    policyBundleId = governed.policy_bundle_id;
  }
  const firstPass = [];
  for (const moduleKey of SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS) {
    firstPass.push(await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey: args.viewKey,
      policyBundleId,
      moduleKey,
      reconcileMemberships: true,
      queryable: args.queryable
    }));
  }
  for (const result of firstPass) {
    if (!result.governance_evaluation_id) {
      throw new Error(`${result.module_key}/${args.viewKey} has no relational governance evaluation.`);
    }
    await ensureDerivedPopulationWatermarksV1({
      queryable: args.queryable,
      workspaceId: args.workspace.id,
      populationId: result.population_id,
      evaluationId: result.governance_evaluation_id,
      moduleKey: result.module_key,
      viewKey: args.viewKey
    });
  }
  const modules = [];
  for (const moduleKey of SIGNAL_CLIENT_GOVERNED_VIEW_MODULE_KEYS) {
    modules.push(await reconcileSignalGovernedViewPolicyCandidateV1({
      workspace: args.workspace,
      actor: args.actor,
      viewKey: args.viewKey,
      policyBundleId,
      moduleKey,
      reconcileMemberships: true,
      queryable: args.queryable
    }));
  }
  if (modules.some((module) => module.compilation_status !== "ready"
    || !module.policy_matches_memberships || module.governance_unknown_count !== 0)) {
    throw new Error(`Governed ${args.viewKey} reconciliation remains blocked or stale.`);
  }
  const after = await loadSignalGovernedViewsProductPreflightV1(args);
  const result: SignalGovernedViewProductReconcileResultV1 = {
    contract_version: CONTRACT,
    action: "reconcile" as const,
    view_key: args.viewKey,
    idempotency_digest: sha256(args.idempotencyKey),
    policy_key: signalGovernedViewPolicyIdentityV1(args.viewKey).policy_key,
    modules: modules.map((module) => ({
      module_key: module.module_key,
      state: module.compilation_status,
      denominator_count: module.actual_membership_count,
      population_ref: `${module.view_key}/${module.module_key}/v${module.population_version}`,
      membership_digest: module.actual_membership_digest,
      governance_unknown_count: module.governance_unknown_count!
    })),
    preflight: after.views.find((candidate) => candidate.view_key === args.viewKey)
  };
  await completeSignalProductOperationV1({
    queryable: args.queryable,workspaceId: args.workspace.id,key: operation.key,result
  });
  return result;
}

export async function transitionSignalGovernedViewProductV1(args: {
  queryable?: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  action: "promote" | "withdraw";
  expectedSetDigest: string;
  idempotencyKey: string;
}) {
  assertAuthority(args.workspace, args.actor);
  const result = args.action === "promote"
    ? await promoteSignalGovernedViewBindingSetV1({
      workspace: args.workspace, actor: args.actor, viewKey: args.viewKey,
      expectedSetDigest: args.expectedSetDigest, idempotencyKey: args.idempotencyKey,
      queryable: args.queryable
    })
    : await withdrawSignalGovernedViewBindingSetV1({
      workspace: args.workspace, actor: args.actor, viewKey: args.viewKey,
      expectedSetDigest: args.expectedSetDigest, idempotencyKey: args.idempotencyKey,
      queryable: args.queryable
    });
  return { contract_version: CONTRACT, action: args.action, result };
}

export async function loadSignalGovernedViewsProductPreflightForWorkspaceV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const { pool } = await import("@/lib/db");
  return loadSignalGovernedViewsProductPreflightV1({ ...args,queryable: pool });
}

export async function reconcileSignalGovernedViewProductInTransactionV1(args: {
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  viewKey: SignalClientGovernedViewKeyV1;
  idempotencyKey: string;
}) {
  const { pool } = await import("@/lib/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await reconcileSignalGovernedViewProductV1({ ...args,queryable: client });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadStatusRows(
  queryable: SignalBrandPolicyQueryable,
  workspace: ResolvedSignalWorkspace
): Promise<StatusRow[]> {
  const result = await queryable.query<StatusRow>(`
    WITH view_identity(view_key,policy_key) AS (VALUES
      ('brand','operational-brand-governed'),
      ('competition','operational-competition-governed'),
      ('category','operational-category-governed'),
      ('all-governed','operational-all-governed')
    ), applicability AS (
      SELECT identity.view_key,
        CASE identity.view_key
          WHEN 'brand' THEN 1
          WHEN 'competition' THEN (SELECT count(*)::int FROM competitors competitor
            JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
            WHERE competitor.brand_id=$2::uuid AND competitor.status='current')
          WHEN 'category' THEN (SELECT count(*)::int FROM intelligence_entities entity
            WHERE entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid
              AND entity.entity_type='category' AND entity.status='active')
          ELSE 1 + (SELECT count(*)::int FROM competitors competitor
            JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active
            WHERE competitor.brand_id=$2::uuid AND competitor.status='current')
            + (SELECT count(*)::int FROM intelligence_entities entity
              WHERE entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid
                AND entity.entity_type IN ('category','reference') AND entity.status='active')
        END AS entity_count,
        (SELECT count(DISTINCT assertion.mention_id)::int
          FROM signal_mention_attributions assertion
          WHERE assertion.workspace_id=$1::uuid
            AND assertion.attribution_basis='mention_semantic' AND assertion.is_current
            AND assertion.review_status='approved' AND assertion.eligibility_status='eligible'
            AND assertion.entity_id IS NOT NULL
            AND CASE identity.view_key
              WHEN 'brand' THEN assertion.scope='primary_brand' AND assertion.entity_type='brand'
                AND assertion.entity_id=$2::uuid
              WHEN 'competition' THEN assertion.scope='competitor' AND assertion.entity_type='competitor'
                AND EXISTS (SELECT 1 FROM competitors competitor JOIN brand_seeds seed
                  ON seed.id=competitor.competitor_brand_seed_id AND seed.active
                  WHERE competitor.id=assertion.entity_id AND competitor.brand_id=$2::uuid
                    AND competitor.status='current')
              WHEN 'category' THEN assertion.scope='category' AND assertion.entity_type='category'
                AND EXISTS (SELECT 1 FROM intelligence_entities entity WHERE entity.id=assertion.entity_id
                  AND entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid AND entity.status='active')
              ELSE (assertion.scope='primary_brand' AND assertion.entity_type='brand'
                  AND assertion.entity_id=$2::uuid)
                OR (assertion.scope='competitor' AND assertion.entity_type='competitor'
                  AND EXISTS (SELECT 1 FROM competitors competitor JOIN brand_seeds seed
                    ON seed.id=competitor.competitor_brand_seed_id AND seed.active
                    WHERE competitor.id=assertion.entity_id AND competitor.brand_id=$2::uuid
                      AND competitor.status='current'))
                OR (assertion.scope IN ('category','reference')
                  AND EXISTS (SELECT 1 FROM intelligence_entities entity WHERE entity.id=assertion.entity_id
                    AND entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid AND entity.status='active'))
            END) AS eligible_root_count
      FROM view_identity identity
    ), selected_bundle AS (
      SELECT DISTINCT ON (bundle.policy_key) bundle.* FROM signal_population_policy_bundles bundle
      WHERE bundle.workspace_id=$1::uuid
        AND bundle.policy_key IN (SELECT policy_key FROM view_identity)
      ORDER BY bundle.policy_key,bundle.policy_version DESC,bundle.created_at DESC
    )
    SELECT identity.view_key,module.module_key,app.entity_count,app.eligible_root_count,
      bundle.status AS policy_status,population.id::text AS population_id,
      population.version AS population_version,population.membership_digest,
      compilation.compilation_status,compilation.blocking_reasons,
      compilation.authorized_root_count,
      compilation.governance_unknown_count,compilation.source_watermark_at::text,
      compilation.next_policy_transition_at::text,compilation.compiled_at::text,
      binding.id IS NOT NULL AS current_binding,
      COALESCE((SELECT count(*)::int FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id),0) AS invalidation_count
    FROM view_identity identity
    JOIN applicability app ON app.view_key=identity.view_key
    CROSS JOIN (VALUES ('brand-monitoring'),('mentions'),('topics-narratives')) module(module_key)
    LEFT JOIN selected_bundle bundle ON bundle.policy_key=identity.policy_key
    LEFT JOIN signal_governed_view_population_derivations derivation
      ON derivation.policy_bundle_id=bundle.id AND derivation.workspace_id=$1::uuid
     AND derivation.module_key=module.module_key AND derivation.view_key=identity.view_key
    LEFT JOIN signal_population_definitions population ON population.id=derivation.resolved_population_id
    LEFT JOIN signal_population_policy_compilations compilation
      ON compilation.policy_bundle_id=bundle.id AND compilation.population_id=population.id
     AND compilation.module_key=module.module_key AND compilation.view_key=identity.view_key
     AND compilation.is_current
    LEFT JOIN signal_governed_view_bindings binding
      ON binding.workspace_id=$1::uuid AND binding.module_key=module.module_key
     AND binding.view_key=identity.view_key AND binding.binding_status='current'
     AND binding.policy_bundle_id=bundle.id
     AND binding.population_id=population.id
     AND binding.policy_compilation_id=compilation.id
    ORDER BY identity.view_key,module.module_key
  `, [workspace.id, workspace.subject.id, workspace.organizationId]);
  return result.rows;
}

function moduleState(row: StatusRow, applicable: boolean): SignalGovernedViewProductModuleV1 {
  const blockers = [...(row.blocking_reasons ?? [])];
  if (!applicable) blockers.push("view_not_applicable");
  if (applicable && !row.policy_status) blockers.push("policy_draft_missing");
  if (row.governance_unknown_count !== null && row.governance_unknown_count > 0) {
    blockers.push("governance_not_available");
  }
  if (row.invalidation_count > 0) blockers.push("compilation_invalidated");
  let state: SignalGovernedViewProductStateV1;
  if (!applicable) state = "not_applicable";
  else if (row.current_binding && row.compilation_status === "ready" && row.invalidation_count === 0) state = "current";
  else if (row.compilation_status === "stale" || row.invalidation_count > 0) state = "stale";
  else if (row.compilation_status === "ready") state = "ready";
  else if (row.compilation_status === "blocked") state = "blocked";
  else if (row.population_id) state = "evaluating";
  else if (row.policy_status === "draft") state = "draft";
  else if (row.policy_status === "active") state = "withdrawn";
  else state = "blocked";
  return {
    module_key: row.module_key ?? "brand-monitoring",
    state,
    denominator_count: row.authorized_root_count,
    coverage_state: row.authorized_root_count === null ? "not_available" : "partial",
    abstained: null,
    abstained_availability: "not_available",
    population_ref: row.population_id && row.population_version
      ? `${row.view_key}/${row.module_key}/v${row.population_version}` : null,
    compilation_status: row.compilation_status,
    membership_digest: row.membership_digest,
    source_watermark_at: row.source_watermark_at,
    next_policy_transition_at: row.next_policy_transition_at,
    blockers: [...new Set(blockers)].sort(),
    current_binding: row.current_binding
  };
}

function aggregateState(modules: SignalGovernedViewProductModuleV1[]): SignalGovernedViewProductStateV1 {
  const states = new Set(modules.map((module) => module.state));
  if (states.size === 1) return modules[0]!.state;
  if (states.has("stale")) return "stale";
  if (states.has("blocked")) return "blocked";
  if (states.has("evaluating")) return "evaluating";
  if (states.has("draft")) return "draft";
  return "blocked";
}

async function resolvePolicyBundleTargetV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  viewKey: SignalClientGovernedViewKeyV1;
  qualityPolicyId: string;
}): Promise<{ policy_version: number; reusable_policy_bundle_id: string | null }> {
  const identity = signalGovernedViewPolicyIdentityV1(args.viewKey);
  const result = await args.queryable.query<{
    id: string;
    policy_version: number;
    status: "draft" | "active" | "retired";
    quality_policy_id: string | null;
    data_governance_contract_status: string;
    registry_matches: boolean;
  }>(`
    SELECT bundle.id::text,bundle.policy_version,bundle.status,
      bundle.quality_policy_id::text,bundle.data_governance_contract_status,
      signal_governed_view_bundle_scopes_match_v1(bundle.id,$3) AS registry_matches
    FROM signal_population_policy_bundles bundle
    WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key=$2
    ORDER BY bundle.policy_version DESC,bundle.created_at DESC
    LIMIT 1
    FOR UPDATE
  `, [args.workspaceId,identity.policy_key,args.viewKey]);
  const latest = result.rows[0];
  if (!latest) {
    return { policy_version: identity.policy_version,reusable_policy_bundle_id: null };
  }
  if (latest.status === "active"
    && latest.quality_policy_id === args.qualityPolicyId
    && latest.data_governance_contract_status === "resolved"
    && latest.registry_matches) {
    return { policy_version: latest.policy_version,reusable_policy_bundle_id: latest.id };
  }
  if (latest.status === "draft" && latest.registry_matches) {
    return { policy_version: latest.policy_version,reusable_policy_bundle_id: null };
  }
  return { policy_version: latest.policy_version + 1,reusable_policy_bundle_id: null };
}

async function loadExactActiveQualityPolicyId(queryable: SignalBrandPolicyQueryable, workspaceId: string) {
  const result = await queryable.query<{ id: string }>(`
    SELECT id::text FROM signal_quality_policies
    WHERE workspace_id=$1::uuid AND status='active' AND canonical_root_disposition='evaluate'
      AND effective_from<=clock_timestamp()
      AND (effective_to IS NULL OR effective_to>clock_timestamp())
    ORDER BY policy_version DESC,id
  `, [workspaceId]);
  if (result.rows.length !== 1) {
    throw new Error("Governed view reconciliation requires exactly one active quality policy.");
  }
  return result.rows[0]!.id;
}

async function ensureDerivedPopulationWatermarksV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspaceId: string;
  populationId: string;
  evaluationId: string;
  moduleKey: SignalClientGovernedViewModuleKeyV1;
  viewKey: SignalClientGovernedViewKeyV1;
}) {
  const lineage = await args.queryable.query<{
    study_corpus_id: string | null;
    data_source_id: string;
    import_batch_id: string;
    corpus_revision: number;
    max_observed_at: string | null;
    accepted_at: string;
    lineage_digest: string;
  }>(`
    WITH selected AS (
      SELECT item.mention_id,membership.id AS provenance_id,membership.data_source_id,
        membership.import_batch_id
      FROM signal_data_governance_evaluation_items item
      JOIN signal_mention_import_memberships membership ON membership.id=item.import_membership_id
      WHERE item.workspace_id=$1::uuid AND item.evaluation_id=$2::uuid
        AND item.decision='included' AND item.reason_code='policy_eligible'
    ), grouped AS (
      SELECT selected.data_source_id,selected.import_batch_id,
        COALESCE(batch.contributed_by_study_corpus_id,batch.study_corpus_id) AS study_corpus_id,
        max(mention.published_at) AS max_observed_at,batch.created_at AS accepted_at,
        'sha256:'||encode(sha256(convert_to(string_agg(concat_ws(':',selected.provenance_id,
          selected.mention_id,selected.data_source_id,selected.import_batch_id),','
          ORDER BY selected.provenance_id),'UTF8')),'hex') AS lineage_digest
      FROM selected JOIN import_batches batch ON batch.id=selected.import_batch_id
      JOIN mentions mention ON mention.id=selected.mention_id
      GROUP BY selected.data_source_id,selected.import_batch_id,
        COALESCE(batch.contributed_by_study_corpus_id,batch.study_corpus_id),batch.created_at
    ) SELECT grouped.study_corpus_id::text,grouped.data_source_id::text,
      grouped.import_batch_id::text,
      COALESCE(corpus.corpus_revision,workspace_watermark.corpus_revision)::int AS corpus_revision,
      grouped.max_observed_at::text,grouped.accepted_at::text,grouped.lineage_digest
    FROM grouped
    LEFT JOIN study_corpora corpus ON corpus.id=grouped.study_corpus_id
    LEFT JOIN signal_workspace_corpora relation ON relation.workspace_id=$1::uuid
      AND relation.study_corpus_id=corpus.id AND relation.valid_to IS NULL
    LEFT JOIN signal_data_watermarks workspace_watermark
      ON grouped.study_corpus_id IS NULL
     AND workspace_watermark.workspace_id=$1::uuid
     AND workspace_watermark.study_corpus_id IS NULL
     AND workspace_watermark.data_source_id=grouped.data_source_id
     AND workspace_watermark.last_import_batch_id=grouped.import_batch_id
    WHERE (grouped.study_corpus_id IS NOT NULL AND relation.id IS NOT NULL)
       OR (grouped.study_corpus_id IS NULL AND workspace_watermark.id IS NOT NULL)
    ORDER BY grouped.data_source_id,grouped.import_batch_id
  `, [args.workspaceId, args.evaluationId]);
  if (lineage.rows.length === 0) {
    const diagnostic = await args.queryable.query<{ included: number; imported: number }>(`
      SELECT count(*) FILTER (WHERE item.decision='included' AND item.reason_code='policy_eligible')::int AS included,
        count(item.import_membership_id) FILTER (WHERE item.decision='included'
          AND item.reason_code='policy_eligible')::int AS imported
      FROM signal_data_governance_evaluation_items item
      WHERE item.workspace_id=$1::uuid AND item.evaluation_id=$2::uuid
    `,[args.workspaceId,args.evaluationId]);
    throw new Error(`${args.moduleKey}/${args.viewKey} has no exact import lineage (${diagnostic.rows[0]?.included ?? 0}/${diagnostic.rows[0]?.imported ?? 0}).`);
  }
  for (const row of lineage.rows) {
    const sourceKey = `governed-${args.moduleKey}-${args.viewKey}-${sha256([
      args.populationId,row.data_source_id,row.import_batch_id,row.lineage_digest
    ].join(":" )).slice(7,31)}`;
    const watermarkValues = [args.workspaceId,row.study_corpus_id,args.populationId,
      row.data_source_id,sourceKey,row.corpus_revision,row.import_batch_id,row.max_observed_at,
      row.accepted_at,args.moduleKey,args.viewKey,row.lineage_digest];
    const insert = `
      INSERT INTO signal_data_watermarks (
        workspace_id,study_corpus_id,population_id,data_source_id,source_key,corpus_revision,
        last_import_batch_id,max_observed_at,accepted_at,materialized_at,
        source_freshness_state,data_freshness_state,metadata
      ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::int,$7::uuid,
        $8::timestamptz,$9::timestamptz,clock_timestamp(),'not_available','not_available',
        jsonb_build_object('contract_version','signal-governed-view-watermark-v1',
          'module_key',$10::text,'view_key',$11::text,'lineage_digest',$12::text))`;
    await args.queryable.query(row.study_corpus_id
      ? `${insert} ON CONFLICT (workspace_id,study_corpus_id,source_key) DO NOTHING`
      : `${insert} ON CONFLICT (workspace_id,data_source_id,source_key)
           WHERE study_corpus_id IS NULL AND data_source_id IS NOT NULL DO NOTHING`,
    watermarkValues);
    const exact = await args.queryable.query<{ exact: boolean }>(`
      SELECT population_id=$3::uuid AND data_source_id=$4::uuid
        AND last_import_batch_id=$5::uuid AND metadata->>'lineage_digest'=$6 AS exact
      FROM signal_data_watermarks
      WHERE workspace_id=$1::uuid AND study_corpus_id IS NOT DISTINCT FROM $2::uuid AND source_key=$7
    `, [args.workspaceId,row.study_corpus_id,args.populationId,row.data_source_id,
      row.import_batch_id,row.lineage_digest,sourceKey]);
    if (exact.rows[0]?.exact !== true) throw new Error("Derived population watermark identity drifted.");
  }
}

function assertAuthority(workspace: ResolvedSignalWorkspace, actor: SignalWorkspaceUser) {
  if (workspace.status !== "active" || workspace.subject.type !== "brand"
    || actor.userType !== "noisia_internal") {
    throw new Error("Governed view operations require an active brand workspace and internal operator.");
  }
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
