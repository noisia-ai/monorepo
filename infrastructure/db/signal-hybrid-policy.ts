import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";
import { assertMfpJevPolicyFixtureV1, readMfpPolicySwitchBlockersV1 } from "./signal-labeling-policy-action-switch";

/** Internal, MFP-fixture-only successor. Copy every existing action before adding H1. */
export async function planMfpHybridPolicyV1(args:{database:Pick<Pool,"connect">;fixture_key:string;
  workspace_id:string;organization_id:string;internal_user_id:string;execute?:boolean}) {
  assertMfpJevPolicyFixtureV1(args.fixture_key,`mfp-${args.fixture_key}`);
  const client=await args.database.connect();
  let phase="begin";
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout='10s'");
    phase="scope";
    const scope=(await client.query<{organization_id:string;slug:string}>(`SELECT w.organization_id,o.slug
      FROM signal_workspaces w JOIN organizations o ON o.id=w.organization_id
      WHERE w.id=$1 FOR SHARE OF w,o`,[args.workspace_id])).rows[0];
    if (!scope||scope.organization_id!==args.organization_id) throw new Error("hybrid_policy_scope_invalid");
    assertMfpJevPolicyFixtureV1(args.fixture_key,scope.slug);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))",
      [args.organization_id]);
    phase="active";
    const policies=(await client.query<{id:string;version:string;valid_until:string;budget_timezone:string;
      daily_cap_micro_usd:string|null}>(`SELECT id,version::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
      FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'
        AND valid_from<=now() AND valid_until>now() FOR UPDATE`,[args.organization_id])).rows;
    if (policies.length!==1) throw new Error("hybrid_policy_active_required");
    const prior=policies[0]!;
    await client.query("SELECT signal_processing_lock_v1($1,(now() AT TIME ZONE $2)::date)",
      [args.organization_id,prior.budget_timezone]);
    phase="actor";
    const actor=(await client.query(`SELECT 1 FROM users WHERE id=$1
      AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','founder','admin') FOR SHARE`,
      [args.internal_user_id])).rows[0];
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,
      workspace_id:args.workspace_id,actor_user_id:args.internal_user_id,lock_authority:true});
    if (!actor||!caps.can_request_processing) throw new Error("hybrid_policy_forbidden");
    phase="blockers";
    const blockers=await readMfpPolicySwitchBlockersV1(client,args.organization_id);
    const actions=(await client.query<{action:string;provider:string|null;model:string|null}>(
      "SELECT action,provider,model FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action",
      [prior.id])).rows;
    const jev=actions.find(row=>row.action==="concept_membership_jev");
    const claude=actions.find(row=>row.action==="concept_membership_claude");
    if (!!jev!==!!claude || jev && (jev.provider!=="typesafe"||jev.model!=="jev-1.13.0") ||
      claude && (claude.provider!=="anthropic"||claude.model!=="claude-sonnet-5-5"))
      throw new Error("hybrid_policy_partial_or_changed");
    const blocked=Object.values(blockers).some(count=>count>0);
    const receipt={stage:"mfp_hybrid_policy",execute:args.execute===true,prior_version:prior.version,
      action_count:actions.length,other_actions_preserved:true,blockers,
      daily_cap_micro_usd:prior.daily_cap_micro_usd,hybrid_action_cap_micro_usd:null};
    if (args.execute!==true||blocked||jev) {
      await client.query("ROLLBACK");
      return {...receipt,status:blocked?"blocked":jev?"unchanged":"planned"};
    }
    phase="draft";
    const next=(await client.query<{id:string;version:string}>(`INSERT INTO signal_processing_policy_versions
      (organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      SELECT $1,COALESCE(max(version),0)+1,'draft',now(),$2::timestamptz,$3,$4,$5
      FROM signal_processing_policy_versions WHERE organization_id=$1 RETURNING id,version::text`,
      [args.organization_id,prior.valid_until,prior.budget_timezone,prior.daily_cap_micro_usd,args.internal_user_id])).rows[0]!;
    phase="copy";
    await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[next.id,prior.id]);
    await client.query(`WITH input(action,provider,model) AS (VALUES
      ('concept_membership_jev'::text,'typesafe'::text,'jev-1.13.0'::text),
      ('concept_membership_claude','anthropic','claude-sonnet-5-5'))
      INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
        configuration_digest,max_execution_micro_usd,automatic_allowed)
      SELECT $1,input.action,'provider',input.provider,input.model,
        jsonb_build_object('contract_version','mfp-hybrid-h1-policy-v1','provider',input.provider,'model',input.model),
        signal_semantic_context_digest_json_v2(jsonb_build_object('contract_version','mfp-hybrid-h1-policy-v1',
          'provider',input.provider,'model',input.model)),NULL,false FROM input`,[next.id]);
    const preserved=(await client.query<{count:number}>(`SELECT count(*)::int count FROM (
      SELECT action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$1
      EXCEPT SELECT action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
      FROM signal_processing_policy_actions WHERE policy_version_id=$2) missing`,[prior.id,next.id])).rows[0]!.count;
    if (preserved!==0) throw new Error("hybrid_policy_copy_mismatch");
    phase="transition";
    if ((await client.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active' RETURNING id",
      [prior.id])).rowCount!==1 || (await client.query(
        "UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id",
        [next.id])).rowCount!==1) throw new Error("hybrid_policy_transition_conflict");
    const sealed=(await client.query(`SELECT 1 FROM signal_processing_policy_versions current
      JOIN signal_processing_policy_versions prior ON prior.id=$2 WHERE current.id=$1 AND current.status='active'
        AND current.policy_digest IS NOT NULL AND prior.status='revoked'
        AND ROW(current.valid_until,current.budget_timezone,current.daily_cap_micro_usd)
          IS NOT DISTINCT FROM ROW(prior.valid_until,prior.budget_timezone,prior.daily_cap_micro_usd)
        AND (SELECT count(*) FROM signal_processing_policy_versions WHERE organization_id=current.organization_id
          AND status='active')=1`,[next.id,prior.id])).rows.length===1;
    if (!sealed) throw new Error("hybrid_policy_seal_invalid");
    await client.query("COMMIT");
    return {...receipt,status:"activated",version:next.version};
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw Object.assign(new Error("mfp_hybrid_policy_operation_failed"),
      {phase,code:error instanceof Error&&/^hybrid_[a-z_]+$/u.test(error.message)?error.message:undefined});
  } finally {client.release();}
}
