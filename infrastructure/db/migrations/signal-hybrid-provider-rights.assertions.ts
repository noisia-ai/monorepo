import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {signalProvenancePolicyBindingDefinitionHashV1} from '@noisia/query-engine';
import {HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1,assertHybridProviderRightsBeforeSubmitV1} from '../signal-hybrid-runs';
import type {LabelingRunV1} from '../signal-labeling-runs';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** Run the frozen scalar oracle over every selected call, in bounded subsets.
 * ANY selects each ID once even when the caller repeats it; sum only disjoint sets. */
export async function verifyHybridProviderRightsOracleV1(client:PoolClient,run_id:string,workspace:string,call_ids:string[]){
 const old=await readFile(new URL('./signal-hybrid-provider-rights-before-batch.fixture.sql',import.meta.url),'utf8');
 const ids=[...new Set(call_ids)],total={found:0,allowed:0,input_count:0};
 for(let start=0;start<ids.length;start+=20){
  const args=[run_id,workspace,ids.slice(start,start+20)];
  const before=(await client.query(old,args)).rows[0]!,after=(await client.query(HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1,args)).rows[0]!;
  assert.deepEqual(after,before,'each bounded subset preserves the complete frozen scalar oracle');
  for(const key of ['found','allowed','input_count'] as const)total[key]+=before[key];
 }
 assert.deepEqual((await client.query(HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1,[run_id,workspace,call_ids])).rows[0],total,
  'the full set matches the summed scalar oracle, including ANY ID deduplication');
 return total;
}
/** Small native controls compare the prior SQL and exercise fresh policy state.
 * The separate 662-call continuation remains the unchanged 20-second gate. */
export async function verifyHybridProviderRightsSetPlanV1(a:{client:PoolClient;workspace:string;organization:string;actor:string;
 source:string;batch:string;quality:string;retention:string;license:string;root:string;run_id:string;call_id:string;other_workspace:string}){
 const {client}=a,old=await readFile(new URL('./signal-hybrid-provider-rights-before-batch.fixture.sql',import.meta.url),'utf8');
 const run={id:a.run_id,workspace_id:a.workspace} as LabelingRunV1,calls=[{id:a.call_id}],values=[a.run_id,a.workspace,[a.call_id]];
 const check=async(expected:boolean)=>{
  const before=(await client.query(old,values)).rows[0]!,after=(await client.query(HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1,values)).rows[0]!;
  assert.deepEqual(after,before,'statement-local provenance preserves all original count semantics');
  assert.equal(after.found,1);assert.equal(after.input_count,1);assert.equal(after.allowed,expected?1:0);
  if(expected)await assertHybridProviderRightsBeforeSubmitV1(client,run,calls);
  else await assert.rejects(assertHybridProviderRightsBeforeSubmitV1(client,run,calls),/hybrid_provider_rights_changed/);
 };
 const license=async(purposes:string[])=>{
  const id=randomUUID(),identity=sha(id);
  await client.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
   approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key)
   VALUES($1,$2,$3,$4,1,'draft',$5,$5,$6,$5)`,[id,a.organization,a.workspace,'hybrid-rights-'+id,identity,a.actor]);
  for(const purpose of purposes)await client.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision) VALUES($1,$2,$3,'allowed')`,[a.workspace,id,purpose]);
  await client.query('UPDATE signal_licensing_policies SET definition_hash=signal_licensing_policy_definition_hash(id) WHERE id=$1',[id]);
  await client.query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1",[id,a.actor]);return id;
 };
 const binding=async(license_id:string,batch_id:string,version:number)=>{
  await client.query("UPDATE signal_provenance_policy_bindings SET status='retired',effective_to=now() WHERE workspace_id=$1 AND data_source_id=$2 AND import_batch_id=$3 AND status='active'",[a.workspace,a.source,batch_id]);
  const definition=signalProvenancePolicyBindingDefinitionHashV1({workspace_id:a.workspace,data_source_id:a.source,import_batch_id:batch_id,
   binding_version:version,quality_policy_id:a.quality,retention_policy_id:a.retention,licensing_policy_id:license_id});
  await client.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,status,
   quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
   VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$9,now(),$8)`,[a.workspace,a.source,batch_id,version,a.quality,a.retention,license_id,definition,a.actor]);
 };
 const purposes=['llm-processing','client-derived-metrics','client-mention-list','client-text-or-excerpt'];
 await check(true);
 await verifyHybridProviderRightsOracleV1(client,a.run_id,a.workspace,[a.call_id,a.call_id]);
 // Read-only call-input boundary controls: do not forge or mutate durable provider calls.
 // Both unchanged queries see the same synthetic call CTE and real provenance tables.
 const inputControl=async(inputs:unknown[],expected:{found:number;allowed:number;input_count:number},workspace=a.workspace)=>{
  const wrap=(sql:string)=>`WITH signal_labeling_calls AS (
   SELECT $4::uuid id,$1::uuid run_id,$2::uuid workspace_id,$5::jsonb inputs
  ) SELECT * FROM (${sql}) rights`;
  const args=[a.run_id,workspace,[a.call_id,a.call_id],a.call_id,JSON.stringify(inputs)];
  const before=(await client.query(wrap(old),args)).rows[0]!,after=(await client.query(wrap(HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1),args)).rows[0]!;
  assert.deepEqual(after,before,'input boundaries preserve the original scalar count and textual identity semantics');
  assert.deepEqual(after,expected);
 };
 await inputControl([],{found:1,allowed:0,input_count:0});
 await inputControl([{root_id:a.root},{root_id:a.root}],{found:1,allowed:2,input_count:2});
 const invalid=[{root_id:'not-a-uuid'},{root_id:`{${a.root}}`},{root_id:a.root.replaceAll('-','')},
  {root_id:'00000000-0000-0000-0000-000000000000'},{root_id:42},{},null];
 await inputControl(invalid,{found:1,allowed:0,input_count:invalid.length});
 await inputControl([{root_id:a.root},...invalid],{found:1,allowed:1,input_count:invalid.length+1});
 if(a.root.toUpperCase()!==a.root)await inputControl([{root_id:a.root.toUpperCase()}],{found:1,allowed:0,input_count:1});
 assert.equal((await client.query(`SELECT count(*)::int n FROM mentions WHERE workspace_id=$1 AND canonical_mention_id=$2`,
  [a.other_workspace,a.root])).rows[0].n,0,'the foreign-workspace control has no matching origin');
 await inputControl([{root_id:a.root}],{found:1,allowed:0,input_count:1},a.other_workspace);
 // A batch-specific denial takes precedence over the older complete global binding.
 for(const omitted of purposes){await client.query('SAVEPOINT rights_set_missing_usage');try{
  await binding(await license(purposes.filter(p=>p!==omitted)),a.batch,2);await check(false);
 }finally{await client.query('ROLLBACK TO SAVEPOINT rights_set_missing_usage');await client.query('RELEASE SAVEPOINT rights_set_missing_usage');}}
 await client.query('SAVEPOINT rights_set_split_paths');try{
  await binding(await license(purposes.slice(0,2)),a.batch,2);
  const otherBatch=randomUUID();await client.query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,status)
   VALUES($1,$2,$3,'fixture','rights-split.csv','completed')`,[otherBatch,a.workspace,a.source]);
  await client.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id) VALUES($1,$2,$3,$4)`,[a.workspace,a.root,otherBatch,a.source]);
  await binding(await license(purposes.slice(2)),otherBatch,3);await check(false);
  await binding(await license(purposes),otherBatch,4);await check(true);
 }finally{await client.query('ROLLBACK TO SAVEPOINT rights_set_split_paths');await client.query('RELEASE SAVEPOINT rights_set_split_paths');}
 for(const [table,id] of [['signal_retention_policies',a.retention],['signal_licensing_policies',a.license],['data_sources',a.source]] as const){
  await client.query('SAVEPOINT rights_set_revoked');try{
   if(table==='data_sources')await client.query("UPDATE data_sources SET status='inactive' WHERE id=$1",[id]);
   else await client.query(`UPDATE ${table} SET status='retired',effective_to=now() WHERE id=$1`,[id]);await check(false);
  }finally{await client.query('ROLLBACK TO SAVEPOINT rights_set_revoked');await client.query('RELEASE SAVEPOINT rights_set_revoked');}
 }
 for(const params of [[a.run_id,a.other_workspace,[a.call_id]],[randomUUID(),a.workspace,[a.call_id]],
  [a.run_id,a.workspace,[randomUUID()]],[a.run_id,a.workspace,[]]]){
  assert.deepEqual((await client.query(HYBRID_PROVIDER_RIGHTS_BEFORE_SUBMIT_SQL_V1,params)).rows,(await client.query(old,params)).rows);
 }
 await assert.rejects(assertHybridProviderRightsBeforeSubmitV1(client,{...run,workspace_id:a.other_workspace},calls),/hybrid_provider_rights_changed/);
 await assert.rejects(assertHybridProviderRightsBeforeSubmitV1(client,run,[...calls,...calls]),/hybrid_provider_rights_changed/);
 await check(true);
}
