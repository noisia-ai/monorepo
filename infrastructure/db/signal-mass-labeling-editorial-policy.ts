import { randomUUID } from "node:crypto";
import { SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_CONFIGURATION_V2 as configuration,
  SIGNAL_WORKSPACE_MASS_LABELING_PRODUCT_LEGACY_CONFIGURATION_V2 as legacyConfiguration,
  signalWorkspaceEmbeddingDigestV1 as digest } from "@noisia/query-engine";
import type { LabelingDatabaseV1 } from "./signal-mention-facets";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { readClassicPolicyActiveWorkV1 } from "./signal-classic-policy-completion";
import { SignalLabelingError } from "./signal-labeling-runs";

/** Internal upgrades preserve the organization ceiling and every sibling action.
 * New organizations receive this configuration from the ordinary creation template. */
export async function provisionMassLabelingProductEditorialPolicyV2(args: {
  database: LabelingDatabaseV1; workspace_id: string; actor_user_id: string;
}) {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN");
    const scope = (await client.query<{ organization_id: string }>("SELECT organization_id FROM signal_workspaces WHERE id=$1", [args.workspace_id])).rows[0];
    if (!scope) throw new SignalLabelingError("mass_labeling_workspace_unavailable", 404);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))", [scope.organization_id]);
    const prior = (await client.query<{ id: string; budget_timezone: string }>(`SELECT id,budget_timezone FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active' AND valid_from<=now() AND valid_until>now() FOR UPDATE`, [scope.organization_id])).rows[0];
    if (!prior) throw new SignalLabelingError("mass_labeling_active_policy_required");
    await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)", [scope.organization_id, prior.budget_timezone]);
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, ...args, lock_authority: true });
    if (!caps.can_request_processing || !caps.can_edit_topics) throw new SignalLabelingError("mass_labeling_forbidden", 403);
    const action = (await client.query<{ provider: string; model: string; configuration: unknown; max_execution_micro_usd: string | null; automatic_allowed: boolean }>(`SELECT provider,model,configuration,max_execution_micro_usd::text,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='topic_interpretation'`, [prior.id])).rows[0];
    if (!action) throw new SignalLabelingError("mass_labeling_editorial_policy_required");
    const approved = [configuration, legacyConfiguration].find(profile => digest(action.configuration) === digest(profile));
    if (approved) {
      await client.query("COMMIT");
      return { status: "existing_policy" as const, policy_id: prior.id, configuration: approved };
    }
    if (!(await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal'
      AND primary_role IN('noisia_admin','founder','admin')`, [args.actor_user_id])).rows.length) throw new SignalLabelingError("mass_labeling_policy_internal_only", 403);
    if (await readClassicPolicyActiveWorkV1(client, scope.organization_id)) throw new SignalLabelingError("mass_labeling_policy_active_work");
    const id = randomUUID();
    await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      SELECT $1,organization_id,(SELECT max(version)+1 FROM signal_processing_policy_versions WHERE organization_id=$2),'draft',now(),valid_until,budget_timezone,daily_cap_micro_usd,$3
      FROM signal_processing_policy_versions WHERE id=$4`, [id, scope.organization_id, args.actor_user_id, prior.id]);
    await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action<>'topic_interpretation'`, [id, prior.id]);
    await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'topic_interpretation','provider',$2,$3,$4::jsonb,$5,$6,$7)`,
      [id, configuration.provider, configuration.model, JSON.stringify(configuration), digest(configuration), action.max_execution_micro_usd, action.automatic_allowed]);
    await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1", [prior.id]);
    await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [id]);
    await client.query("COMMIT"); return { status: "provisioned" as const, policy_id: id, configuration };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
