import type { Pool } from "pg";
import {
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  signalWorkspaceEmbeddingDigestV1 as digest,
} from "@noisia/query-engine";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
/** Server-owned bootstrap. Copy all existing actions/caps unchanged into a successor policy;
 * never rewrite paid admissions, reactivate revoked policy, or grant a client budget authority. */
export async function provisionSignalLabelingPolicyV1(args: {
  database: Pick<Pool, "connect">;
  workspace_id: string;
  initiator_user_id: string;
  creator_user_id: string;
  cap_micro_usd?: number | null;
  /** Explicit internal operator action, never copied from client bodies. */
  upgrade_existing?: boolean;
  daily_cap_micro_usd?: number | null;
  budget_micro_usd?: number | null;
}) {
  for (const amount of [
    args.cap_micro_usd,
    args.budget_micro_usd,
    args.daily_cap_micro_usd,
  ])
    if (amount != null && (!Number.isSafeInteger(amount) || amount < 0))
      throw new Error("labeling_policy_amount_invalid");
  const c = await args.database.connect();
  try {
    await c.query("BEGIN");
    const scope = (
      await c.query<{ organization_id: string; timezone: string }>(
        "SELECT organization_id,timezone FROM signal_workspaces WHERE id=$1",
        [args.workspace_id],
      )
    ).rows[0];
    if (!scope) throw new Error("labeling_policy_scope_invalid");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",
      [scope.organization_id],
    );
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({
      queryable: c,
      workspace_id: args.workspace_id,
      actor_user_id: args.initiator_user_id,
      lock_authority: true,
    });
    if (!caps.can_request_processing)
      throw new Error("labeling_policy_forbidden");
    const creator = (
      await c.query(
        `SELECT id FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`,
        [args.creator_user_id],
      )
    ).rows[0];
    if (!creator) throw new Error("labeling_policy_creator_forbidden");
    const prior = (
      await c.query<{
        id: string;
        status: string;
        version: number;
        valid_until: string;
        daily_cap_micro_usd: string | null;
        budget_timezone: string;
      }>(
        `SELECT id,status,version,valid_until::text,daily_cap_micro_usd::text,budget_timezone FROM signal_processing_policy_versions WHERE organization_id=$1 ORDER BY version DESC LIMIT 1`,
        [scope.organization_id],
      )
    ).rows[0];
    if (prior && prior.status !== "active")
      throw new Error("labeling_policy_history_requires_operator");
    const labeling = {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      contract_version: "signal-labeling-policy-v1",
    };
    const desiredDaily =
      args.daily_cap_micro_usd === undefined
        ? (prior?.daily_cap_micro_usd ?? null)
        : args.daily_cap_micro_usd === null
          ? null
          : String(args.daily_cap_micro_usd);
    const desiredCap =
      args.cap_micro_usd == null ? null : String(args.cap_micro_usd);
    if (prior) {
      const rows = (
        await c.query<{
          action: string;
          configuration: unknown;
          max_execution_micro_usd: string | null;
        }>(
          `SELECT action,configuration,max_execution_micro_usd::text FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action IN('mention_facets','concept_membership','corpus_embeddings')`,
          [prior.id],
        )
      ).rows;
      const identical =
        rows.length === 3 &&
        rows.every(
          (row) =>
            row.max_execution_micro_usd === desiredCap &&
            digest(row.configuration) ===
              digest(
                row.action === "corpus_embeddings"
                  ? SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1
                  : labeling,
              ),
        );
      if (identical && prior.daily_cap_micro_usd === desiredDaily) {
        await c.query("COMMIT");
        return { status: "existing_policy" };
      }
    }
    if (prior && !args.upgrade_existing) {
      await c.query("COMMIT");
      return { status: "existing_policy" };
    }
    if (prior) {
      if (args.creator_user_id !== args.initiator_user_id)
        throw new Error("labeling_policy_upgrade_internal_only");
      const active = (
        await c.query(
          `SELECT 1 FROM signal_labeling_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND (r.status IN('queued','running') OR EXISTS(SELECT 1 FROM signal_labeling_calls call WHERE call.run_id=r.id AND call.status IN('submitting','submitted','unknown')))
        UNION ALL SELECT 1 FROM signal_workspace_embedding_runs r JOIN signal_workspaces w ON w.id=r.workspace_id
        WHERE w.organization_id=$1 AND r.status IN('queued','running','outcome_unknown') LIMIT 1`,
          [scope.organization_id],
        )
      ).rows[0];
      if (active) throw new Error("labeling_policy_work_active");
      await c.query(
        "UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",
        [prior.id],
      );
    }
    const policy = (
      await c.query<{ id: string }>(
        `INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   VALUES($1,$2,'draft',now(),$3::timestamptz,$4,$5,$6) RETURNING id`,
        [
          scope.organization_id,
          (prior?.version ?? 0) + 1,
          prior?.valid_until ?? "infinity",
          prior?.budget_timezone ?? scope.timezone,
          args.daily_cap_micro_usd === undefined
            ? (prior?.daily_cap_micro_usd ?? null)
            : args.daily_cap_micro_usd,
          args.creator_user_id,
        ],
      )
    ).rows[0]!;
    if (prior)
      await c.query(
        `INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$2 AND action NOT IN('mention_facets','concept_membership','corpus_embeddings')`,
        [policy.id, prior.id],
      );
    await c.query(
      `INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
       VALUES($1,'corpus_preparation','free',NULL,NULL,'{}'::jsonb,signal_semantic_context_digest_json_v2('{}'::jsonb),0,false)
       ON CONFLICT(policy_version_id,action) DO NOTHING`,
      [policy.id],
    );
    for (const [action, configuration] of [
      ["mention_facets", labeling],
      ["concept_membership", labeling],
      ["corpus_embeddings", SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1],
    ] as const) {
      await c.query(
        `INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
    VALUES($1,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6,false) ON CONFLICT(policy_version_id,action) DO NOTHING`,
        [
          policy.id,
          action,
          configuration.provider,
          configuration.model,
          JSON.stringify(configuration),
          args.cap_micro_usd ?? null,
        ],
      );
    }
    await c.query(
      "UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",
      [policy.id],
    );
    await c.query("COMMIT");
    return { status: "provisioned" };
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
