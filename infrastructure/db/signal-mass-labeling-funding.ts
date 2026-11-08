import {randomUUID} from "node:crypto";
import type {LabelingDatabaseV1} from "./signal-mention-facets";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {mapCurrent} from "./signal-mass-labeling";

export type MassLabelingFundingReceiptV1={
 id:string;contract_version:string;scoped_admission_id:string;extension_id:string;organization_id:string;
 workspace_id:string;map_id:string;run_id:string;actor_user_id:string;base_policy_version_id:string;base_policy_digest:string;
 map_digest:string;labeler_digest:string;entity_context_digest:string;prior_admission_receipt_digest:string;
 prior_total_cap_micro_usd:string;total_cap_micro_usd:string;smoke_metrics_digest:string;smoke_metrics_canonical:string;smoke_root_count:number;smoke_call_count:number;
 smoke_calls_digest:string;prior_budget_date:string;prior_budget_timezone:string;budget_date:string;budget_timezone:string;
 admission_not_after:string;quote:Record<string,unknown>;quote_digest:string;receipt_digest:string;idempotency_key:string;
 created_by_user_id:string;created_at:string;
};
export const MASS_LABELING_FUNDING_RECEIPT_SELECT_V1="SELECT signal_mass_labeling_funding_dto_v1(f) receipt FROM signal_mass_labeling_funding_receipts f";
/** Explicit authorization only. This does not continue, claim, reserve or send. */
export async function authorizeMassLabelingFullBudgetV1(args:{
 database:LabelingDatabaseV1;workspace_id:string;actor_user_id:string;map_id:string;run_id:string;idempotency_key:string;
 total_cap_micro_usd:number;expected_prior_admission_id:string;expected_prior_receipt_digest:string;
 expected_prior_cap_micro_usd:number;expected_smoke_metrics_digest:string;
}):Promise<{receipt:MassLabelingFundingReceiptV1;replayed:boolean}>{
 const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu,digest=/^sha256:[0-9a-f]{64}$/u;
 if(![args.workspace_id,args.actor_user_id,args.map_id,args.run_id,args.expected_prior_admission_id].every(v=>uuid.test(v))
  ||![args.expected_prior_receipt_digest,args.expected_smoke_metrics_digest].every(v=>digest.test(v))
  ||!Number.isSafeInteger(args.total_cap_micro_usd)||!Number.isSafeInteger(args.expected_prior_cap_micro_usd)
  ||args.expected_prior_cap_micro_usd<=0||args.total_cap_micro_usd<=args.expected_prior_cap_micro_usd
  ||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))throw new Error("mass_labeling_funding_invalid");
 const c=await args.database.connect();try{
  await c.query("BEGIN");await c.query("SET LOCAL search_path=public,extensions,pg_temp");
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});
  const actor=(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder')",[args.actor_user_id])).rows[0];
  if(!caps.can_edit_topics||!caps.can_request_processing||!actor)throw new Error("mass_labeling_funding_forbidden");
  await mapCurrent(c,args.workspace_id,args.map_id);
  const admission=(await c.query<{id:string;organization_id:string}>(`SELECT a.id,a.organization_id FROM signal_mass_labeling_scoped_admissions a
   JOIN signal_labeling_runs r ON r.id=a.target_id JOIN signal_mass_labeling_runs m ON m.run_id=r.id
   WHERE a.id=$1 AND a.workspace_id=$2 AND a.actor_user_id=$3 AND a.map_id=$4 AND a.target_id=$5 AND m.map_id=$4`,
   [args.expected_prior_admission_id,args.workspace_id,args.actor_user_id,args.map_id,args.run_id])).rows[0];
  if(!admission)throw new Error("mass_labeling_funding_invalid");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::text,0))",[admission.organization_id]);
  await c.query("SELECT id FROM signal_labeling_runs WHERE id=$1 FOR UPDATE",[args.run_id]);
  const old=(await c.query<{receipt:MassLabelingFundingReceiptV1}>(`${MASS_LABELING_FUNDING_RECEIPT_SELECT_V1} WHERE f.run_id=$1`,[args.run_id])).rows[0]?.receipt;
  if(old){
   if(old.scoped_admission_id!==args.expected_prior_admission_id||old.prior_admission_receipt_digest!==args.expected_prior_receipt_digest
    ||old.prior_total_cap_micro_usd!==String(args.expected_prior_cap_micro_usd)||old.smoke_metrics_digest!==args.expected_smoke_metrics_digest
    ||old.total_cap_micro_usd!==String(args.total_cap_micro_usd)||old.idempotency_key!==args.idempotency_key
    ||old.actor_user_id!==args.actor_user_id||old.map_id!==args.map_id)throw new Error("mass_labeling_funding_conflict");
   await c.query("COMMIT");return{receipt:old,replayed:true};
  }
  const smoke=(await c.query<{smoke_metrics:unknown}>("SELECT smoke_metrics FROM signal_mass_labeling_runs WHERE run_id=$1",[args.run_id])).rows[0]?.smoke_metrics;
  const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==="object"
    ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,ordered(child)])):value;
  const smokeCanonical=JSON.stringify(ordered(smoke));
  const id=randomUUID();
  await c.query(`INSERT INTO signal_mass_labeling_funding_receipts(id,contract_version,scoped_admission_id,extension_id,organization_id,
   workspace_id,map_id,run_id,actor_user_id,base_policy_version_id,base_policy_digest,map_digest,labeler_digest,entity_context_digest,
   prior_admission_receipt_digest,prior_total_cap_micro_usd,total_cap_micro_usd,smoke_metrics_digest,smoke_metrics_canonical,smoke_root_count,smoke_call_count,
   smoke_calls_digest,prior_budget_date,prior_budget_timezone,budget_date,budget_timezone,admission_not_after,quote,quote_digest,receipt_digest,
   idempotency_key,created_by_user_id,created_at)
   SELECT $1,'mass-labeling-prospective-total-budget-v1',a.id,e.id,a.organization_id,a.workspace_id,a.map_id,a.target_id,a.actor_user_id,
   a.policy_version_id,e.base_policy_digest,e.map_digest,signal_mass_labeling_scoped_identity_v1(),r.entity_context_digest,
   $2,$3,$4,$5,$9,1000,1000,'pending',a.budget_date,a.budget_timezone,a.budget_date,a.budget_timezone,a.admission_not_after,
   '{}','pending','pending',$6,$7,clock_timestamp()
   FROM signal_mass_labeling_scoped_admissions a JOIN signal_mass_labeling_policy_extensions e ON e.id=a.extension_id
   JOIN signal_labeling_runs r ON r.id=a.target_id WHERE a.id=$8`,
   [id,args.expected_prior_receipt_digest,args.expected_prior_cap_micro_usd,args.total_cap_micro_usd,args.expected_smoke_metrics_digest,args.idempotency_key,args.actor_user_id,args.expected_prior_admission_id,smokeCanonical]);
  const receipt=(await c.query<{receipt:MassLabelingFundingReceiptV1}>(`${MASS_LABELING_FUNDING_RECEIPT_SELECT_V1} WHERE f.id=$1`,[id])).rows[0]!.receipt;
  await c.query("COMMIT");return{receipt,replayed:false};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
