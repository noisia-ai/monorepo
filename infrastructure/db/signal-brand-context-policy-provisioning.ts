import type { Pool } from "pg";
import { SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { signalSemanticContextProposalRuntimeConfigurationFromEnvV1 } from "./signal-semantic-context-proposal";

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

/** Server configuration only. Neither credentials nor provider/queue health creates policy authority.
 * A missing explicit system creator, organization ceiling or expiry never creates an allowance. */
function configuredPolicy(env: Record<string, string | undefined>) {
  const creatorUserId = env.NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID;
  const semantic = signalSemanticContextProposalRuntimeConfigurationFromEnvV1(env);
  const daily = money(env.NOISIA_BRAND_CONTEXT_POLICY_DAILY_CAP_MICRO_USD);
  const prototype = money(env.NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD
    ?? String(SIGNAL_WORKSPACE_EMBEDDING_DEFAULT_MAX_COST_MICRO_USD_V1));
  const until = env.NOISIA_BRAND_CONTEXT_POLICY_VALID_UNTIL;
  if (!creatorUserId || !uuid.test(creatorUserId) || !semantic.available || !daily || !prototype || !money(semantic.platform_hard_cap_micro_usd.toString())
    || !validDeadline(until) || daily < semantic.platform_hard_cap_micro_usd + prototype) return null;
  return { creatorUserId, daily: daily.toString(), until, semanticCap: semantic.platform_hard_cap_micro_usd.toString(),
    prototypeCap: prototype.toString(), semanticConfiguration: {
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
 * brands in the organization; existing active, draft or revoked history is never rewritten.
 * Draft + both actions + activation commit together. This creates no admission, work or spend.
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
    const history = (await client.query<{ status: string }>(
      "SELECT status FROM signal_processing_policy_versions WHERE organization_id=$1::uuid", [scope.organization_id])).rows;
    if (history.some(policy => policy.status === "active")) return await commit("existing_policy");
    // A creation retry must never revoke/replace a policy or undo a previous stop.
    if (history.length) return await commit("configuration_required");
    const configuration = configuredPolicy(args.env ?? process.env);
    if (!configuration) return await commit("configuration_required");
    const creator = (await client.query(`SELECT id FROM users WHERE id=$1::uuid
      AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin')
      FOR SHARE NOWAIT`, [configuration.creatorUserId])).rows[0];
    if (!creator) return await commit("configuration_required");
    const compatible = (await client.query<{ deadline_valid: boolean; timezone_valid: boolean; configuration_valid: boolean }>(`SELECT
      $1::timestamptz>clock_timestamp() deadline_valid,
      EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$2) timezone_valid,
      (signal_processing_configuration_allows_v1('brand_context_proposal',$3::jsonb,$3::jsonb)
        AND signal_brand_context_prototype_configuration_v1($4::jsonb)) configuration_valid`,
    [configuration.until, authority.timezone, JSON.stringify(configuration.semanticConfiguration), JSON.stringify(SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1)])).rows[0];
    if (!compatible?.deadline_valid || !compatible.timezone_valid || !compatible.configuration_valid) return await commit("configuration_required");
    const policy = (await client.query<{ id: string }>(`INSERT INTO signal_processing_policy_versions(
      organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1::uuid,1,'draft',clock_timestamp(),$2::timestamptz,$3,$4::bigint,$5::uuid) RETURNING id::text`,
    [scope.organization_id, configuration.until, authority.timezone, configuration.daily, configuration.creatorUserId])).rows[0];
    if (!policy) throw new Error("brand_context_policy_provisioning_incomplete");
    for (const [action, provider, model, policyConfiguration, cap, automatic] of [
      ["brand_context_proposal", "anthropic", "claude-sonnet-4-6", configuration.semanticConfiguration, configuration.semanticCap, false],
      ["topic_prototype_embeddings", "voyage", "voyage-4-large", SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, configuration.prototypeCap, true]
    ] as const) {
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
        configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
        VALUES($1::uuid,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6::bigint,$7::boolean)`,
      [policy.id, action, provider, model, JSON.stringify(policyConfiguration), cap, automatic]);
    }
    const active = await client.query(`UPDATE signal_processing_policy_versions SET status='active'
      WHERE id=$1::uuid AND status='draft' RETURNING id`, [policy.id]);
    if (active.rows.length !== 1) throw new Error("brand_context_policy_provisioning_incomplete");
    return await commit("provisioned");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); throw error;
  } finally { client.release(); }
}
