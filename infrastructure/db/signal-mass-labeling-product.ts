import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { labelerDigestV1, massLabelingJevIdentityV2, massLabelingConfigurationV2,
  signalWorkspaceEmbeddingDigestV1 as digest, buildMassLabelingConsolidationRequestV1, parseMassLabelingConsolidationResponseV1,
  type MassLabelingSourceGroupV1, type MassLabelingCategoryContextV2, type SignalWorkspaceInterpretationConfigurationV1 } from "@noisia/query-engine";
import { requestMentionFacetsV1, SignalLabelingError } from "./signal-labeling-runs";
import type { LabelingDatabaseV1 } from "./signal-mention-facets";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { mapCurrent, selectMassLabelingTopicsV1 } from "./signal-mass-labeling";
import { loadSignalWorkspaceMassLabelingSeedsV1 } from "./signal-workspace-mass-labeling-profile";
import { readClassicPolicyActiveWorkV1 } from "./signal-classic-policy-completion";
import { loadMassLabelingStudyPolicyWithClientV1, proposeMassLabelingStudyLexiconV1 } from "./signal-mass-labeling-study-policy";

const actionConfiguration = { contract_version: "mass-labeling-jev-v2", provider: "typesafe", model: "jev-1.13.0" };
function fail(code: string, status = 409): never { throw new SignalLabelingError(code, status); }
async function transaction<T>(database: LabelingDatabaseV1, work: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const result = await work(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** A normal workspace request inherits the organization's active price and budget.
 * Only a policy administrator can publish a missing action into a successor. */
export async function enableMassLabelingProductV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; cap_micro_usd: number;
}) {
  if (!Number.isSafeInteger(args.cap_micro_usd) || args.cap_micro_usd <= 0) fail("mass_labeling_cap_invalid", 422);
  return transaction(args.database, async client => {
    const scope = (await client.query<{ organization_id: string }>("SELECT organization_id FROM signal_workspaces WHERE id=$1", [args.workspace_id])).rows[0];
    if (!scope) fail("mass_labeling_workspace_unavailable", 404);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))", [scope.organization_id]);
    const prior = (await client.query<{ id: string; budget_timezone: string }>(`SELECT id,budget_timezone FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active' AND valid_from<=now() AND valid_until>now() FOR UPDATE`, [scope.organization_id])).rows[0];
    if (!prior) fail("mass_labeling_active_policy_required");
    await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
    const capability = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args, lock_authority: true });
    if (!capability.can_request_processing || !capability.can_edit_topics) fail("mass_labeling_forbidden", 403);
    const existing = (await client.query<{ provider: string; model: string; configuration: unknown; max_execution_micro_usd: string | null }>(`SELECT provider,model,configuration,max_execution_micro_usd::text
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='mass_labeling_jev'`, [prior.id])).rows[0];
    let policyId = prior.id;
    if (!existing || digest(existing.configuration) !== digest(actionConfiguration)) {
      if (!(await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
        AND primary_role IN('noisia_admin','founder','admin')`, [args.actor_user_id])).rows.length) fail("mass_labeling_policy_internal_only", 403);
      await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
      if (await readClassicPolicyActiveWorkV1(client, scope.organization_id)) fail("mass_labeling_policy_active_work");
      policyId = randomUUID();
      await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
        SELECT $1,organization_id,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=$2),'draft',now(),valid_until,budget_timezone,daily_cap_micro_usd,$3
        FROM signal_processing_policy_versions WHERE id=$4`, [policyId, scope.organization_id, args.actor_user_id, prior.id]);
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
        FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'mass_labeling_jev'`, [policyId, prior.id]);
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1,'mass_labeling_jev','provider','typesafe','jev-1.13.0',$2::jsonb,$3,$4,false)`,
        [policyId, JSON.stringify(actionConfiguration), digest(actionConfiguration), args.cap_micro_usd]);
      await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [prior.id]);
      await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policyId]);
    } else if (existing.provider !== "typesafe" || existing.model !== "jev-1.13.0"
      || existing.max_execution_micro_usd !== null && Number(existing.max_execution_micro_usd) < args.cap_micro_usd) fail("mass_labeling_policy_cap_exceeded");
    await client.query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mass_labeling',$2)
      ON CONFLICT(workspace_id,feature) DO NOTHING`, [args.workspace_id, args.actor_user_id]);
    return { policy_id: policyId, request_version: "mass-labeling-jev-v2" as const };
  });
}

export async function requestMassLabelingProductV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; map_id: string;
  idempotency_key: string; cap_micro_usd: number; provider_available: boolean;
}) {
  const config = await transaction(args.database, async client => {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
    if (!caps.can_request_processing || !caps.can_edit_topics) fail("mass_labeling_forbidden", 403);
    const policy = await loadMassLabelingStudyPolicyWithClientV1(client, args.workspace_id);
    return massLabelingConfigurationV2({ ...policy, interests: policy.interests.filter(interest => interest.active) });
  });
  const identity = massLabelingJevIdentityV2(config);
  return requestMentionFacetsV1({ ...args, identity, full_recalculation: true, adapter: {
    request_identity: { version: "mass-labeling-jev-v2", map_id: args.map_id, smoke: true },
    policy_action: "mass_labeling_jev", feature: "mass_labeling", select_labeler: false,
    validateIdentity: candidate => { if (labelerDigestV1(candidate) !== labelerDigestV1(identity)) fail("mass_labeling_identity_changed"); },
    prepare: async (client, workspace) => {
      const currentPolicy = await loadMassLabelingStudyPolicyWithClientV1(client, workspace);
      const currentConfig = massLabelingConfigurationV2({ ...currentPolicy, interests: currentPolicy.interests.filter(interest => interest.active) });
      if (digest(config) !== digest(currentConfig)) fail("mass_labeling_configuration_changed");
      const map = await mapCurrent(client, workspace, args.map_id);
      if ((await client.query("SELECT 1 FROM signal_mass_labeling_runs WHERE map_id=$1", [args.map_id])).rows.length) fail("mass_labeling_map_already_admitted");
      const size = (await client.query<{ characters: string }>(`SELECT COALESCE(sum(length(text)+length(candidates::text)),0)::text characters
        FROM signal_mass_labeling_items WHERE map_id=$1`, [args.map_id])).rows[0]!;
      const interestsSize = JSON.stringify(config.interests).length;
      return { roots: map.root_count, estimated_micro_usd: Math.ceil((Number(size.characters) / 3.5 + map.root_count * (600 + interestsSize / 3.5)) * .042),
        concept_set_digest: map.map_digest, snapshot: { map_id: map.id, map_digest: map.map_digest, configuration: config } };
    },
    persist: async (client, runId, prepared) => {
      await client.query(`INSERT INTO signal_mass_labeling_runs(workspace_id,map_id,run_id,smoke_root_limit) VALUES($1,$2,$3,1000)`, [args.workspace_id, args.map_id, runId]);
      await client.query("UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1", [runId, JSON.stringify(prepared.snapshot), prepared.concept_set_digest]);
    },
  } });
}

export async function loadMassLabelingProductStatusV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
}) {
  return transaction(args.database, async client => {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
    if (!caps.can_view) fail("mass_labeling_forbidden", 403);
    const map = (await client.query<{ id: string; root_count: number; topic_count: number; source_engine_execution_id: string }>(`SELECT id,root_count,jsonb_array_length(catalog) topic_count,source_engine_execution_id
      FROM signal_mass_labeling_maps WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [args.workspace_id])).rows[0] ?? null;
    const run = map ? (await client.query<{ id: string; status: string; smoke_root_limit: number | null;
      smoke_metrics: { technical_failure: boolean } | null; counts: Record<string, number>; estimated_micro_usd: string; cap_micro_usd: string | null }>(`SELECT run.id,run.status,mass.smoke_root_limit,mass.smoke_metrics,run.counts,
      run.estimated_micro_usd::text,run.cap_micro_usd::text FROM signal_mass_labeling_runs mass
      JOIN signal_labeling_runs run ON run.id=mass.run_id AND run.workspace_id=mass.workspace_id
      WHERE mass.workspace_id=$1 AND mass.map_id=$2`, [args.workspace_id, map.id])).rows[0] ?? null : null;
    const policy = (await client.query<{ max_execution_micro_usd: string | null }>(`SELECT action.max_execution_micro_usd::text
      FROM signal_workspaces workspace JOIN signal_processing_policy_versions policy ON policy.organization_id=workspace.organization_id
      JOIN signal_processing_policy_actions action ON action.policy_version_id=policy.id AND action.action='mass_labeling_jev'
      WHERE workspace.id=$1 AND policy.status='active' AND policy.valid_from<=now() AND policy.valid_until>now()`, [args.workspace_id])).rows[0];
    const enabled = (await client.query<{ enabled: boolean }>(`SELECT EXISTS(SELECT 1 FROM signal_workspace_features
      WHERE workspace_id=$1 AND feature='mass_labeling') enabled`, [args.workspace_id])).rows[0]?.enabled === true;
    return { contract_version: "mass-labeling-product-status-v2" as const, workspace_id: args.workspace_id, enabled,
      can_request_processing: caps.can_request_processing && caps.can_edit_topics, map, run,
      estimated_micro_usd: run ? Number(run.estimated_micro_usd) : map ? Math.ceil(map.root_count * 60) : null,
      cap_micro_usd: policy?.max_execution_micro_usd === null ? null : policy ? Number(policy.max_execution_micro_usd) : null };
  });
}

export async function loadMassLabelingProductCategoryContextV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
}) {
  return transaction(args.database, async client => {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
    if (!caps.can_request_processing || !caps.can_edit_topics) fail("mass_labeling_forbidden", 403);
    const policy = await loadMassLabelingStudyPolicyWithClientV1(client, args.workspace_id);
    const brandOs = await loadSignalWorkspaceMassLabelingSeedsV1({ queryable: client, workspace_id: args.workspace_id });
    return { category: policy.category, terms: [...new Set(brandOs.seeds.flatMap(seed => seed.names))].slice(0, 200) };
  });
}

/** The generated lexicon is accepted only from the exact settled editorial receipt. */
export async function applyMassLabelingEditorialLexiconV1(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; source_engine_execution_id: string;
  consolidation_artifact_id: string; consolidation_raw: string;
}) {
  const proposal = JSON.parse(args.consolidation_raw) as { workspace_id: string; source_engine_execution_id: string;
    source_groups: MassLabelingSourceGroupV1[]; configuration: SignalWorkspaceInterpretationConfigurationV1; category_context: MassLabelingCategoryContextV2 };
  const batch = buildMassLabelingConsolidationRequestV1({ workspace_id: proposal.workspace_id, source_engine_execution_id: proposal.source_engine_execution_id,
    source_groups: proposal.source_groups, configuration: proposal.configuration, category_context: proposal.category_context });
  const parsed = JSON.parse(args.consolidation_raw) as { raw_response: string };
  const output = parseMassLabelingConsolidationResponseV1(batch, parsed.raw_response).output;
  const lexical = output.category_lexicon;
  if (!lexical || proposal.workspace_id !== args.workspace_id || proposal.source_engine_execution_id !== args.source_engine_execution_id) fail("mass_labeling_editorial_lexicon_invalid");
  const sha = `sha256:${createHash("sha256").update(args.consolidation_raw).digest("hex")}`;
  const policy = await transaction(args.database, async client => {
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args });
    if (!caps.can_request_processing || !caps.can_edit_topics) fail("mass_labeling_forbidden", 403);
    if (!(await client.query(`SELECT 1 FROM analysis_artifacts artifact JOIN engine_cost_events call
      ON call.id::text=artifact.metadata->>'call_id' AND call.workspace_id=artifact.workspace_id AND call.catalog_execution_id=artifact.engine_execution_id
      WHERE artifact.workspace_id=$1 AND artifact.engine_execution_id=$2 AND artifact.id=$3
        AND artifact.artifact_key='mass-labeling-consolidation.json' AND artifact.content->>'sha256'=$4
        AND call.call_state='settled' AND call.actor_user_id=$5 AND call.request_digest=$6
        AND call.response_sha256=artifact.metadata->>'response_sha256' AND call.response_sha256=$7`,
      [args.workspace_id, args.source_engine_execution_id, args.consolidation_artifact_id, sha, args.actor_user_id, batch.request_digest,
        `sha256:${createHash("sha256").update(parsed.raw_response).digest("hex")}`])).rows.length) fail("mass_labeling_editorial_lexicon_receipt_required");
    return loadMassLabelingStudyPolicyWithClientV1(client, args.workspace_id);
  });
  return proposeMassLabelingStudyLexiconV1({ ...args, expected_revision: policy.revision,
    category: lexical.category, lexicon_terms: lexical.terms, source_digest: sha });
}

/** Publish the first completed product map. Later analyst selections own revision changes. */
export async function publishMassLabelingProductResultV2(args: { database: LabelingDatabaseV1; run_id: string }) {
  const publication = await transaction(args.database, async client => {
    const run = (await client.query<{ workspace_id: string; actor_user_id: string; map_id: string; topic_keys: string[] }>(`SELECT run.workspace_id,run.actor_user_id,mass.map_id,
      ARRAY(SELECT value->>'topic_key' FROM jsonb_array_elements(map.catalog) value ORDER BY value->>'topic_key') topic_keys
      FROM signal_labeling_runs run JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      JOIN signal_mass_labeling_maps map ON map.id=mass.map_id AND map.workspace_id=run.workspace_id
      WHERE run.id=$1 AND run.status='completed' AND mass.smoke_root_limit IS NULL
        AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'
        AND NOT EXISTS(SELECT 1 FROM signal_mass_labeling_selections WHERE workspace_id=run.workspace_id)`, [args.run_id])).rows[0];
    return run ?? null;
  });
  if (!publication) return { published: false };
  await selectMassLabelingTopicsV1({ database: args.database, ...publication, expected_revision: 0 });
  return { published: true };
}

/** Retry the same frozen run after a recoverable interruption. Uncertain sends
 * without their durable response require receipt recovery before proceeding. */
export async function retryMassLabelingProductV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string; run_id: string;
}) {
  return transaction(args.database, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))", [args.workspace_id]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args, lock_authority: true });
    if (!caps.can_request_processing || !caps.can_edit_topics) fail("mass_labeling_forbidden", 403);
    const run = (await client.query<{ status: string; map_id: string }>(`SELECT run.status,mass.map_id FROM signal_labeling_runs run
      JOIN signal_labeler_versions labeler ON labeler.id=run.labeler_version_id
      JOIN signal_mass_labeling_runs mass ON mass.run_id=run.id AND mass.workspace_id=run.workspace_id
      WHERE run.id=$1 AND run.workspace_id=$2 AND labeler.identity#>>'{params,request_version}'='mass-labeling-jev-v2'
      FOR UPDATE OF run`, [args.run_id, args.workspace_id])).rows[0];
    if (!run) fail("mass_labeling_run_unavailable", 404);
    if (run.status !== "failed") fail("mass_labeling_retry_unavailable");
    await mapCurrent(client, args.workspace_id, run.map_id);
    if ((await client.query(`SELECT 1 FROM signal_labeling_calls WHERE run_id=$1
      AND status IN('submitting','submitted','unknown') AND raw_storage_key IS NULL LIMIT 1`, [args.run_id])).rows.length) fail("mass_labeling_receipt_recovery_required");
    await client.query(`UPDATE signal_labeling_runs SET status='queued',error_code=NULL,lease_token=NULL,lease_until=NULL,next_poll_at=now(),updated_at=now()
      WHERE id=$1 AND status='failed'`, [args.run_id]);
    return { run_id: args.run_id };
  });
}
