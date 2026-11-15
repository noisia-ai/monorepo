import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {quoteSignalListeningStudyPolicyV1,provisionSignalListeningStudyPolicyV1} from '../signal-listening-study-policy';
/** Synthetic setup through the product seam, never direct INSERT of R16 actions
 * or a receipt/authority bypass. Caller supplies an accredited disposable DB. */
export async function provisionSyntheticListeningStudyPolicyV1(args:{database:Pick<Pool,'connect'|'query'>;workspace_id:string;actor_user_id:string},
 options:{discovery_cap_micro_usd?:number;study_cap_micro_usd?:number;prototype_cap_micro_usd?:number|null}={}){
 const prior=(await args.database.query(`SELECT p.*,p.valid_until::text valid_until FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id
  WHERE w.id=$1 AND p.status='active'`,[args.workspace_id])).rows[0];assert.ok(prior);
 const valid_until=(await args.database.query(`SELECT to_char(least($1::timestamptz,clock_timestamp()+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') value`,[prior.valid_until])).rows[0].value as string;
 const discovery_cap_micro_usd=options.discovery_cap_micro_usd??4000000,study_cap_micro_usd=options.study_cap_micro_usd??5000000,prototype_cap_micro_usd=options.prototype_cap_micro_usd??null;
 const request={...args,expected_policy_id:prior.id as string,expected_policy_digest:prior.policy_digest as string,valid_until,discovery_cap_micro_usd,study_cap_micro_usd,prototype_cap_micro_usd,
  budget_micro_usd:discovery_cap_micro_usd+study_cap_micro_usd+(prototype_cap_micro_usd??0)};
 const quote=await quoteSignalListeningStudyPolicyV1(request);
 const provisioned=await provisionSignalListeningStudyPolicyV1({...request,plan_digest:quote.plan_digest,idempotency_key:randomUUID()});
 return(await args.database.query('SELECT * FROM signal_processing_policy_versions WHERE id=$1',[provisioned.policy_id])).rows[0]!;
}
