import type { Pool } from "pg";
import { SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 } from "@noisia/query-engine";
import { signalSemanticContextProposalRuntimeConfigurationFromEnvV1 } from "./signal-semantic-context-proposal";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";

export type SignalBrandContextPolicyProvisioningV1 = {
  contract_version: "brand-context-policy-provisioning-v1";
  status: "provisioned" | "existing_policy" | "configuration_required" | "not_eligible";
};
const result = (status: SignalBrandContextPolicyProvisioningV1["status"]): SignalBrandContextPolicyProvisioningV1 => ({
  contract_version: "brand-context-policy-provisioning-v1", status
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const money = (value: string | undefined) => typeof value === "string" && /^[1-9][0-9]{0,14}$/u.test(value) ? BigInt(value) : null;
function validDeadline(value: string | undefined): value is string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u);
  if (!match || !Number.isFinite(Date.parse(value!))) return false;
  const [, year, month, day, hour, minute, second] = match;
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1
    && Number(day) <= new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
}

/** Bootstrap is server-owned. MFP has no legacy semantic-pack prerequisite or
 * default monetary ceiling; a configured strict maximum remains binding. */
function configuredPolicy(env: Record<string, string | undefined>) {
  const creatorUserId = env.NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID;
  if (!creatorUserId || !uuid.test(creatorUserId)) return null;
  const mfp = env.NOISIA_MENTION_FACETS_ENABLED === "true";
  if (mfp) {
    const caps = [env.NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD,
      env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD].map(value => value === undefined ? null : money(value));
    if ([env.NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD, env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD]
      .some((value, index) => value !== undefined && caps[index] === null)) return null;
    return { creatorUserId, mfp: true as const, daily: caps[0]?.toString() ?? null,
      until: "infinity", prototypeCap: caps[1]?.toString() ?? null,
      semanticCap: null, semanticConfiguration: null };
  }
  const semantic = signalSemanticContextProposalRuntimeConfigurationFromEnvV1(env);
  const daily = money(env.NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD);
  const prototype = money(env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD
    ?? String(SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1));
  const until = env.NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL;
  if (!semantic.available || !daily || !prototype || !money(semantic.platform_hard_cap_micro_usd.toString())
    || !validDeadline(until) || daily < semantic.platform_hard_cap_micro_usd + prototype) return null;
  return { creatorUserId, mfp: false as const, daily: daily.toString(), until,
    semanticCap: semantic.platform_hard_cap_micro_usd.toString(), prototypeCap: prototype.toString(), semanticConfiguration: {
      provider: semantic.provider, model: semantic.model, model_version: semantic.model_version,
      pricing_version: semantic.pricing_version, max_input_tokens: semantic.max_input_tokens,
      max_output_tokens: semantic.max_output_tokens, input_usd_per_million_tokens: semantic.input_usd_per_million_tokens,
      output_usd_per_million_tokens: semantic.output_usd_per_million_tokens
    } };
}

/** Bootstrap for a committed brand creation, including an exact creation replay.
 * The authenticated initiator must still match the sealed brand creation and live authority.
 * Only the separately configured internal system actor owns the policy; neither identity comes
 * from browser input. Both actors and the tenant are checked under row locks. The policy lock serializes all
 * brands in the organization. Only an opted-in MFP workspace may gain missing actions
 * through a successor; active owners postpone replacement. Draft or revoked history is never reactivated.
 * Draft, required actions and activation commit together. This creates no admission, work or spend.
 * Keep this server-owned seam out of generic client policy routes. */
export async function provisionSignalBrandContextPolicyV1(args: {
  database: Pick<Pool, "connect">; workspace_id: string; brand_id: string; initiator_user_id: string;
  env?: Record<string, string | undefined>;
}): Promise<SignalBrandContextPolicyProvisioningV1> {
  if (![args.workspace_id, args.brand_id, args.initiator_user_id].every(value => uuid.test(value))) return result("not_eligible");
  const client = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const commit = async (status: SignalBrandContextPolicyProvisioningV1["status"]) => {
      await client.query("COMMIT"); return result(status);
    };
    const scope = (await client.query<{ organization_id: string }>(
      "SELECT organization_id::text FROM signal_workspaces WHERE id=$1::uuid AND brand_id=$2::uuid",
      [args.workspace_id, args.brand_id])).rows[0];
    if (!scope) return await commit("not_eligible");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",
      [scope.organization_id]);
    const authority = (await client.query<{ timezone: string; user_type: string }>(`SELECT w.timezone,u.user_type FROM signal_workspaces w
      JOIN brands b ON b.id=w.brand_id AND b.organization_id=w.organization_id
      JOIN organizations o ON o.id=w.organization_id JOIN users u ON u.id=$2::uuid
      WHERE w.id=$1::uuid AND b.id=$3::uuid AND w.organization_id=$4::uuid
        AND w.status='active' AND b.status='active' AND o.status='active' AND u.status='active'
        AND ((u.user_type='client' AND u.primary_role='client_admin' AND u.organization_id=w.organization_id)
          OR (u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','founder','admin','analyst','kam','insights_manager','ux_data_specialist')))
        AND w.metadata->>'created_by_user_id'=u.id::text
        AND w.metadata->>'creation_request_digest' ~ '^sha256:[0-9a-f]{64}$'
      FOR SHARE OF w,b,o,u NOWAIT`, [args.workspace_id, args.initiator_user_id, args.brand_id, scope.organization_id])).rows[0];
    if (!authority) return await commit("not_eligible");
    if (authority.user_type === "client") {
      const grant = (await client.query(`SELECT id FROM user_brand_access
        WHERE user_id=$1::uuid AND brand_id=$2::uuid AND access_level='admin' AND revoked_at IS NULL
        ORDER BY id FOR SHARE NOWAIT`, [args.initiator_user_id, args.brand_id])).rows[0];
      if (!grant) return await commit("not_eligible");
    }
    const prior = (await client.query<{ id: string; status: string; version: number; valid_until: string;
      budget_timezone: string; daily_cap_micro_usd: string | null }>(
      `SELECT id::text,status,version::int,valid_until::text,budget_timezone,daily_cap_micro_usd::text
       FROM signal_processing_policy_versions WHERE organization_id=$1::uuid ORDER BY version DESC LIMIT 1`,
      [scope.organization_id])).rows[0];
    // A creation retry must never reactivate a stopped policy or amend a draft.
    if (prior && prior.status !== "active") return await commit("configuration_required");
    const mfpEnabled=await signalWorkspaceFeatureEnabledV1({queryable:client,workspace_id:args.workspace_id,
      feature:"mention_facets",env:args.env});
    if (prior && !mfpEnabled) return await commit("existing_policy");
    const required=mfpEnabled ? ["corpus_preparation","corpus_embeddings","topic_fit_incremental",
      "topic_interpretation","topic_consolidation_numeric","topic_consolidation","mention_facets","concept_membership"]
      : ["brand_context_proposal","topic_prototype_embeddings"];
    const requestedCap=mfpEnabled ? (args.env??process.env).NOISIA_MFP_PROCESSING_DAILY_CAP_MICRO_USD : undefined;
    if(requestedCap!==undefined && money(requestedCap)===null) return await commit("configuration_required");
    if (prior) {
      const existing = (await client.query<{action:string;max_execution_micro_usd:string|null}>(
        "SELECT action,max_execution_micro_usd::text FROM signal_processing_policy_actions WHERE policy_version_id=$1::uuid",[prior.id])).rows;
      const actions=new Set(existing.map(row=>row.action));
      // The daily ceiling is organization-wide. A lower MFP ceiling must still
      // cover the legacy Brand Context pair used by sibling workspaces.
      const legacyMinimum=existing.filter(row=>["brand_context_proposal","topic_prototype_embeddings"].includes(row.action))
        .reduce((sum,row)=>sum+BigInt(row.max_execution_micro_usd??"0"),0n);
      if(requestedCap!==undefined && BigInt(requestedCap)<legacyMinimum)
        return await commit("configuration_required");
      const capAlreadyBinding=requestedCap===undefined || prior.daily_cap_micro_usd!==null
        && BigInt(prior.daily_cap_micro_usd)<=BigInt(requestedCap);
      if (required.every(action=>actions.has(action)) && capAlreadyBinding) return await commit("existing_policy");
      // Admissions have no mutable status. Only an active owner still needs
      // capacity from the old policy; terminal runs and ownerless receipts do not.
      const pending=(await client.query<{pending:boolean}>(`SELECT EXISTS(
        SELECT 1 FROM signal_processing_admissions admission WHERE admission.policy_version_id=$1::uuid
          AND (
            EXISTS(SELECT 1 FROM signal_semantic_context_proposal_runs owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running','outcome_unknown')) OR
            EXISTS(SELECT 1 FROM signal_workspace_embedding_runs owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running','outcome_unknown')) OR
            EXISTS(SELECT 1 FROM signal_corpus_preparation_runs owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running')) OR
            EXISTS(SELECT 1 FROM signal_topic_catalog_executions owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running')) OR
            EXISTS(SELECT 1 FROM signal_topic_consolidation_executions owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running')) OR
            EXISTS(SELECT 1 FROM signal_topic_editorial_executions owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running','review_ready')) OR
            EXISTS(SELECT 1 FROM signal_interest_decision_owners_v1 owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('open','ready','blocked')) OR
            EXISTS(SELECT 1 FROM signal_labeling_runs owner WHERE owner.processing_admission_id=admission.id AND owner.status IN('queued','running'))
          )
      ) pending`,[prior.id])).rows[0];
      if(pending?.pending) return await commit("configuration_required");
    }
    const configuration = configuredPolicy({...args.env ?? process.env,
      NOISIA_MENTION_FACETS_ENABLED:mfpEnabled ? "true" : "false"});
    if (!configuration) return await commit("configuration_required");
    const creator = (await client.query(`SELECT id FROM users WHERE id=$1::uuid
      AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')
      FOR SHARE NOWAIT`, [configuration.creatorUserId])).rows[0];
    if (!creator) return await commit("configuration_required");
    const compatible = (await client.query<{ deadline_valid: boolean; timezone_valid: boolean; configuration_valid: boolean }>(`SELECT
      LEAST($1::timestamptz,$6::timestamptz)>clock_timestamp() deadline_valid,
      EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$2) timezone_valid,
      (($5::boolean OR signal_processing_configuration_allows_v1('brand_context_proposal',$3::jsonb,$3::jsonb))
        AND signal_brand_context_prototype_configuration_v1($4::jsonb)) configuration_valid`,
    [configuration.until, authority.timezone, JSON.stringify(configuration.semanticConfiguration), JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1), configuration.mfp,prior?.valid_until??"infinity"])).rows[0];
    if (!compatible?.deadline_valid || !compatible.timezone_valid || !compatible.configuration_valid) return await commit("configuration_required");
    const policy = (await client.query<{ id: string }>(`INSERT INTO signal_processing_policy_versions(
      organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1::uuid,$6::bigint,'draft',clock_timestamp(),LEAST($2::timestamptz,$7::timestamptz),
        $3,$4::bigint,$5::uuid) RETURNING id::text`,
    [scope.organization_id, configuration.until, prior?.budget_timezone??authority.timezone,
      prior?.daily_cap_micro_usd && configuration.daily
        ? (BigInt(prior.daily_cap_micro_usd)<BigInt(configuration.daily)?prior.daily_cap_micro_usd:configuration.daily)
        : prior?.daily_cap_micro_usd??configuration.daily, configuration.creatorUserId, (prior?.version??0)+1,
      prior?.valid_until??"infinity"])).rows[0];
    if (!policy) throw new Error("brand_context_policy_provisioning_incomplete");
    if (prior) await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1::uuid,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2::uuid`,[policy.id,prior.id]);
    for (const [action, provider, model, policyConfiguration, cap, automatic] of (configuration.mfp ? [
      ["corpus_embeddings", "voyage", "voyage-4-large", SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, configuration.prototypeCap, false],
      ["mention_facets", "anthropic", "claude-sonnet-5-5", {}, null, false],
      ["concept_membership", "anthropic", "claude-sonnet-5-5", {}, null, false]
    ] : [
      ["brand_context_proposal", "anthropic", "claude-sonnet-4-6", configuration.semanticConfiguration, configuration.semanticCap, false],
      ["topic_prototype_embeddings", "voyage", "voyage-4-large", SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, configuration.prototypeCap, true]
    ]) as ReadonlyArray<readonly [string, string, string, unknown, string | null, boolean]>) {
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1::uuid,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6::bigint,$7::boolean)
        ON CONFLICT(policy_version_id,action) DO NOTHING`,
      [policy.id, action, provider, model, JSON.stringify(policyConfiguration), cap, automatic]);
    }
    if(configuration.mfp){
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1::uuid,action,'free','{}'::jsonb,signal_semantic_context_digest_json_v2('{}'::jsonb),0,automatic
        FROM (VALUES ('corpus_preparation',false),('topic_fit_incremental',true)) actions(action,automatic)
        ON CONFLICT(policy_version_id,action) DO NOTHING`,[policy.id]);
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        SELECT $1::uuid,'topic_consolidation_numeric','free',config,
          signal_semantic_context_digest_json_v2(config),0,false
        FROM (SELECT signal_topic_consolidation_numeric_configuration_v1() config) configuration
        ON CONFLICT(policy_version_id,action) DO NOTHING`,[policy.id]);
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1::uuid,'topic_interpretation','provider','anthropic',$2,$3::jsonb,
          signal_semantic_context_digest_json_v2($3::jsonb),NULL,false)
        ON CONFLICT(policy_version_id,action) DO NOTHING`,
        [policy.id,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1.model,JSON.stringify(SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1)]);
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1::uuid,'topic_consolidation','provider','anthropic','claude-sonnet-4-6',signal_topic_editorial_configuration_v2(),
          signal_semantic_context_digest_json_v2(signal_topic_editorial_configuration_v2()),NULL,false)
        ON CONFLICT(policy_version_id,action) DO NOTHING`,[policy.id]);
    }
    if (prior) await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1::uuid AND status='active'",[prior.id]);
    const active = await client.query(`UPDATE signal_processing_policy_versions SET status='active'
      WHERE id=$1::uuid AND status='draft' RETURNING id`, [policy.id]);
    if (active.rows.length !== 1) throw new Error("brand_context_policy_provisioning_incomplete");
    return await commit("provisioned");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
}
