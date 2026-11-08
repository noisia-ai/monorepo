import {mapCurrent} from "./signal-mass-labeling";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {LabelingDatabaseV1} from "./signal-mention-facets";
import {admitSignalProcessingWithClientV1,type SignalProcessingAdmitArgsV1} from "./signal-processing-policy";
import type {LabelingRunV1,LabelingPolicyV1,LabelingRequestPolicyV1,LabelingAdmissionRefV1} from "./signal-labeling-runs";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";
type Extension={id:string;organization_id:string;base_policy_version_id:string;base_policy_digest:string;map_id:string;map_digest:string;workspace_id:string;actor_user_id:string;cap_micro_usd:string;configuration:unknown;configuration_digest:string;extension_digest:string};
function fail(code:string):never{throw new Error(code);}
async function extension(c:PoolClient,scope:{workspace_id:string;actor_user_id:string;map_id:string}):Promise<Extension|null>{
 const row=(await c.query<Extension>(`SELECT e.*,e.cap_micro_usd::text FROM signal_mass_labeling_policy_extensions e
  JOIN signal_processing_policy_versions p ON p.id=e.base_policy_version_id AND p.status='active'
  WHERE e.workspace_id=$1 AND e.actor_user_id=$2 AND e.map_id=$3`,[scope.workspace_id,scope.actor_user_id,scope.map_id])).rows[0];
 if(!row)return null;await c.query("SELECT signal_mass_labeling_extension_base_v1($1)",[row.id]);return row;
}
/** Adds only new private authority rows. Rotation and its blockers remain unchanged. */
export async function provisionMassLabelingScopedPolicyV1(args:{database:LabelingDatabaseV1;workspace_id:string;actor_user_id:string;map_id:string;cap_micro_usd:number}){
 if(!Number.isSafeInteger(args.cap_micro_usd)||args.cap_micro_usd<=0)fail("mass_labeling_cap_invalid");
 const c=await args.database.connect();try{
  await c.query("BEGIN");const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});
  const actor=(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder')",[args.actor_user_id])).rows[0];
  if(!caps.can_edit_topics||!caps.can_request_processing||!actor||!await signalWorkspaceFeatureEnabledV1({queryable:c,workspace_id:args.workspace_id,feature:"mass_labeling"}))fail("mass_labeling_scoped_policy_forbidden");
  await mapCurrent(c,args.workspace_id,args.map_id);
  const scope=(await c.query<{organization_id:string;map_digest:string}>(`SELECT w.organization_id,m.map_digest FROM signal_workspaces w
   JOIN signal_mass_labeling_maps m ON m.workspace_id=w.id JOIN signal_corpus_preparation_input_state s ON s.workspace_id=w.id AND s.input_revision=m.input_revision
   WHERE w.id=$1 AND m.id=$2`,[args.workspace_id,args.map_id])).rows[0];if(!scope)fail("mass_labeling_map_stale");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))",[scope.organization_id]);
  const base=(await c.query<{id:string;policy_digest:string}>("SELECT id,policy_digest FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp()",[scope.organization_id])).rows[0];
  if(!base)fail("mass_labeling_active_policy_required");
  const old=await extension(c,args);if(old){if(Number(old.cap_micro_usd)!==args.cap_micro_usd)fail("mass_labeling_scoped_policy_conflict");await c.query("COMMIT");return{extension_id:old.id,policy_id:base.id,map_id:args.map_id,replayed:true};}
  const id=randomUUID();await c.query(`INSERT INTO signal_mass_labeling_policy_extensions(id,organization_id,base_policy_version_id,base_policy_digest,workspace_id,map_id,map_digest,actor_user_id,
   cap_micro_usd,configuration,configuration_digest,extension_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}','pending','pending')`,
   [id,scope.organization_id,base.id,base.policy_digest,args.workspace_id,args.map_id,scope.map_digest,args.actor_user_id,args.cap_micro_usd]);
  await c.query("SELECT signal_mass_labeling_extension_base_v1($1)",[id]);await c.query("COMMIT");return{extension_id:id,policy_id:base.id,map_id:args.map_id,replayed:false};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
export async function massLabelingRequestPolicyWithClientV1(c:PoolClient,args:{workspace_id:string;actor_user_id:string;map_id:string}):Promise<LabelingRequestPolicyV1|null>{
 const scoped=await extension(c,args);if(scoped)return{max_execution_micro_usd:scoped.cap_micro_usd,provider:"typesafe",model:"jev-1.13.0"};
 return(await c.query<LabelingRequestPolicyV1>(`SELECT a.max_execution_micro_usd::text,a.provider,a.model FROM signal_processing_policy_versions p
  JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id WHERE p.organization_id=(SELECT organization_id FROM signal_workspaces WHERE id=$1)
  AND p.status='active' AND p.valid_from<=now() AND p.valid_until>now() AND a.action='mass_labeling_jev'`,[args.workspace_id])).rows[0]??null;
}
export async function admitMassLabelingScopedWithClientV1(c:PoolClient,args:SignalProcessingAdmitArgsV1&{map_id:string}):Promise<LabelingAdmissionRefV1>{
 const e=await extension(c,args);if(!e)return admitSignalProcessingWithClientV1(c,args);
 if(args.action!=="mass_labeling_jev"||args.automatic||args.execution_cap_micro_usd===null)fail("mass_labeling_scoped_admission_invalid");
 const old=(await c.query<{id:string;target_id:string;request_digest:string;execution_cap_micro_usd:string}>("SELECT id,target_id,request_digest,execution_cap_micro_usd::text FROM signal_mass_labeling_scoped_admissions WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3",[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
 if(old){if(old.target_id!==args.target_id||old.request_digest!==args.request_digest||old.execution_cap_micro_usd!==args.execution_cap_micro_usd)fail("processing_idempotency_conflict");return{receipt:{id:old.id},processing_admission_id:null};}
 const id=randomUUID();await c.query(`INSERT INTO signal_mass_labeling_scoped_admissions(id,extension_id,organization_id,policy_version_id,workspace_id,map_id,actor_user_id,target_id,idempotency_key,request_digest,
  execution_cap_micro_usd,budget_date,budget_timezone,admission_not_after,receipt_digest)
  SELECT $1,$2,p.organization_id,p.id,$3,$4,$5,$6,$7,$8,$9,(clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone,
   least(p.valid_until,((((clock_timestamp() AT TIME ZONE p.budget_timezone)::date+1)::timestamp) AT TIME ZONE p.budget_timezone)),'pending'
  FROM signal_processing_policy_versions p WHERE p.id=$10`,[id,e.id,args.workspace_id,args.map_id,args.actor_user_id,args.target_id,args.idempotency_key,args.request_digest,args.execution_cap_micro_usd,e.base_policy_version_id]);
 return{receipt:{id},processing_admission_id:null};
}
export async function massLabelingRunPolicyWithClientV1(c:PoolClient,run:LabelingRunV1):Promise<LabelingPolicyV1|null>{
 const value=(await c.query<{value:LabelingPolicyV1|null}>("SELECT signal_mass_labeling_scoped_policy_v1($1) value",[run.id])).rows[0]?.value;
 if(value)return value;
 return(await c.query<LabelingPolicyV1>(`SELECT w.organization_id,p.budget_timezone,(now() AT TIME ZONE p.budget_timezone)::date::text budget_date,p.daily_cap_micro_usd::text,a.max_execution_micro_usd::text,a.provider,a.model,a.action
  FROM signal_workspaces w JOIN signal_processing_admissions admission ON admission.id=$2 AND admission.workspace_id=w.id AND admission.target_id=$3
  JOIN signal_processing_policy_versions p ON p.id=admission.policy_version_id JOIN signal_processing_policy_actions a ON a.policy_version_id=p.id AND a.action=admission.action
  WHERE w.id=$1 AND p.status='active' AND p.valid_from<=now() AND p.valid_until>now()`,[run.workspace_id,run.processing_admission_id,run.id])).rows[0]??null;
}
