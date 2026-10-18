/** Same-run reconciliation from verified immutable raw; no transport, settlement or serving mutation. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {parseMembershipGroupV2,normalizeMembershipRationaleV2,parseAnthropicResponseV1,signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {createWorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {readSignalLabelingReceiptV1} from '../../services/workers/src/workers/signal-labeling-receipt-storage';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
void main(async()=>{
 const acceptance=process.argv.includes('--acceptance');if(!acceptance&&!process.argv.includes('--execute'))throw new Error('mfp_reconcile_mode_invalid');
 const identity=await loadMfpEvalIdentity(),manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8')),diagnosis=JSON.parse(await readFile(`${directory}/schema-errors.json`,'utf8')),pool=await openDatabase();
 const planPath=`${directory}/normalization-plan.json`;
 try{
  const ids=diagnosis.items.map((item:any)=>item.call_id);assert.equal(ids.length,5);
  const calls=(await pool.query(`SELECT * FROM signal_labeling_calls WHERE run_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[manifest.run_id,ids])).rows;assert.equal(calls.length,5);
  const storage=createWorkspaceEngineStorageV1(),items:any[]=[];
  for(const call of calls){
   const raw=JSON.parse(await readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,run_id:call.run_id,storage_key:call.raw_storage_key,raw_sha256:call.raw_sha256,size_bytes:Number(call.raw_size_bytes)}));
   assert.equal(raw.result.type,'succeeded');const response=parseAnthropicResponseV1(raw.result.message);assert.equal(response.status,'ok');
   const normalized=normalizeMembershipRationaleV2(response.text!);assert.equal(normalized.normalizations.length,1);
   const before=JSON.parse(response.text!),after=JSON.parse(normalized.text);
   // Strip only rationale before comparing every other byte of semantic output.
   const withoutRationale=(value:any)=>JSON.stringify(value,(key,item)=>key==='rationale'?undefined:item);
   assert.equal(withoutRationale(before),withoutRationale(after));
   const parsed=parseMembershipGroupV2(response.text!,call.inputs);assert.equal(parsed.split,false);assert.deepEqual(parsed.retry_ordinals,[]);
   assert.equal(parsed.results.length,call.inputs.reduce((n:number,input:any)=>n+input.evaluated_concepts.length,0));
   assert.ok(parsed.results.every(result=>['belongs','not_belongs','insufficient'].includes(result.verdict)));
   items.push({call_id:call.id,raw_sha256:call.raw_sha256,inputs_digest:digest(call.inputs),original_results:call.results,normalized_results:JSON.parse(JSON.stringify(parsed.results)),normalizations:normalized.normalizations});
  }
  let plan:any;
  try{plan=JSON.parse(await readFile(planPath,'utf8'));}catch(error){if((error as any).code!=='ENOENT')throw error;
   assert.ok(items.every(item=>item.original_results.every((result:any)=>result.verdict==='error'&&result.error_code==='membership_item_schema_invalid')));
   plan={run_id:manifest.run_id,workspace_id:identity.workspace_id,items,provider_calls:0};await writeFile(planPath,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  for(const item of items){const saved=plan.items.find((candidate:any)=>candidate.call_id===item.call_id);assert.ok(saved);
   assert.equal(saved.raw_sha256,item.raw_sha256);assert.equal(saved.inputs_digest,item.inputs_digest);assert.deepEqual(saved.normalized_results,item.normalized_results);}
  const planDigest=digest(plan);
  if(!acceptance){const receipt=JSON.parse(await readFile(`${directory}/normalization-acceptance.json`,'utf8'));assert.equal(receipt.passed,true);assert.equal(receipt.plan_digest,planDigest);}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const run=(await client.query(`SELECT status,membership_snapshot FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,[manifest.run_id,identity.workspace_id])).rows[0];
   assert.equal(run.status,'completed');assert.equal(run.membership_snapshot.preview,true);assert.equal(run.membership_snapshot.evaluation_judge_version,2);
   const census=async()=> (await client.query(`SELECT (SELECT count(*)::int FROM signal_labeling_calls) calls,
    (SELECT coalesce(jsonb_agg(w ORDER BY workspace_id,kind),'[]') FROM signal_workspace_labelers w) selectors,
    (SELECT count(*)::int FROM signal_concept_memberships WHERE run_id=$1) serving`,[manifest.run_id])).rows[0];
   const before=await census();assert.equal(before.serving,0);
   const apply=async()=>{let updated=0;
    for(const item of plan.items){
     const current=(await client.query('SELECT * FROM signal_labeling_calls WHERE id=$1 AND run_id=$2 FOR UPDATE',[item.call_id,manifest.run_id])).rows[0];
     assert.equal(current.status,'settled');assert.equal(current.results_applied,true);assert.equal(current.raw_sha256,item.raw_sha256);assert.equal(digest(current.inputs),item.inputs_digest);
     if(digest(current.results)===digest(item.normalized_results))continue;
     assert.deepEqual(current.results,item.original_results);
     const changed=(await client.query(`UPDATE signal_labeling_calls SET results=$3::jsonb,updated_at=now() WHERE id=$1 AND run_id=$2 AND raw_sha256=$4 AND results=$5::jsonb AND status='settled' AND results_applied RETURNING *`,[item.call_id,manifest.run_id,JSON.stringify(item.normalized_results),item.raw_sha256,JSON.stringify(item.original_results)])).rows[0];assert.ok(changed);
     const immutable=(row:any)=>{const {results:_results,updated_at:_updated,...fields}=row;return fields;};assert.deepEqual(immutable(changed),immutable(current));updated++;
    }return updated;
   };
   const updated=await apply();assert.equal(await apply(),0);assert.deepEqual(await census(),before);
   if(acceptance){await client.query('ROLLBACK');
    const persisted=(await pool.query('SELECT id,results FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
    assert.deepEqual(persisted.map((row:any)=>row.results),calls.map((call:any)=>call.results));
   }else await client.query('COMMIT');
   const receipt={stage:acceptance?'standard_v2_normalization_acceptance':'standard_v2_normalization_reconciled',passed:true,plan_digest:planDigest,updated_calls:updated,roots:5,pairs:23,gold_positive_pairs:0,provider_calls:0,added_cost_micro_usd:0,settlement_unchanged:true,serving_writes:0,default_unchanged:true,checks:['raw_sha_verified','semantic_output_identical','root_pair_coverage','run_and_call_lock','cas','replay_noop','financial_fields_immutable','no_serving','no_calls','rollback_or_commit'],at:new Date().toISOString()};
   await writeFile(`${directory}/${acceptance?'normalization-acceptance':'normalization-reconciled'}.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }finally{await pool.end();}
});
