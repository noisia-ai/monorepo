/** Frozen v1 baseline includes governed reused pairs, not just the last run's delta. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
// @ts-expect-error guarded private runner JavaScript
import {main,openDatabase} from '../dev-corpus/guard.mjs';
import {loadMfpEvalIdentity} from './fixture-identity';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '../../packages/query-engine/src/index';
import {createWorkspaceEngineStorageV1} from '../../services/workers/src/workers/signal-workspace-engine-storage';
import {readSignalLabelingReceiptV1} from '../../services/workers/src/workers/signal-labeling-receipt-storage';
const directory='.data/dev-corpus/voyage-real/standard-v2-r11';
void main(async()=>{
 const baseline=JSON.parse(await readFile(`${directory}/baseline.json`,'utf8')),manifest=JSON.parse(await readFile(`${directory}/run-manifest.json`,'utf8')),identity=await loadMfpEvalIdentity(),pool=await openDatabase();
 try{
  const rows=(await pool.query(`WITH frozen_inputs AS MATERIALIZED (
   SELECT DISTINCT ON(input->>'root_id') input FROM signal_labeling_calls call CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
   WHERE call.run_id=$1 ORDER BY input->>'root_id',call.created_at DESC,call.id DESC
  ),definitions AS MATERIALIZED (SELECT value FROM jsonb_array_elements($4::jsonb))
  SELECT DISTINCT ON(result->>'root_id',result->>'concept_key') result result,source.input source_input,frozen.input frozen_input,
   call.id call_id,call.run_id,call.raw_sha256,call.raw_storage_key,call.raw_size_bytes::int,call.status call_status,call.results_applied,call.inputs call_inputs,call.results call_results,
   version.labeler_digest source_labeler_digest,call.settled_micro_usd::text source_call_cost,run.status source_run_status,run.membership_snapshot source_snapshot
  FROM signal_labeling_calls call JOIN signal_labeling_runs run ON run.id=call.run_id AND run.workspace_id=call.workspace_id
   JOIN signal_labeler_versions version ON version.id=run.labeler_version_id
   CROSS JOIN LATERAL jsonb_array_elements(call.results) result
   JOIN LATERAL (SELECT input FROM jsonb_array_elements(call.inputs) input WHERE input->>'root_id'=result->>'root_id') source ON true
   JOIN frozen_inputs frozen ON frozen.input->>'root_id'=result->>'root_id'
    AND frozen.input->>'root_fingerprint'=source.input->>'root_fingerprint'
    AND frozen.input->>'entity_context_digest'=source.input->>'entity_context_digest'
    AND frozen.input->>'effective_entities_digest'=source.input->>'effective_entities_digest'
   JOIN definitions def ON def.value->>'concept_key'=result->>'concept_key' AND def.value->>'definition_digest'=result->>'definition_digest'
  WHERE call.workspace_id=$2 AND version.labeler_digest=$3 AND call.status='settled' AND call.results_applied
   AND run.status='completed' AND coalesce((run.membership_snapshot->>'preview')::boolean,false)=false
  ORDER BY result->>'root_id',result->>'concept_key',call.created_at DESC,call.id DESC`,[manifest.run_id,identity.workspace_id,baseline.run.labeler_digest,JSON.stringify(baseline.run.membership_snapshot.concepts)])).rows.map((row:any)=>({...row.source_input,...row.result,...row,labeler_digest:row.source_labeler_digest}));
  console.log(JSON.stringify({stage:'baseline_tuple_coverage',pairs:rows.length,technical_pairs:rows.filter((row:any)=>!['belongs','not_belongs','insufficient'].includes(row.verdict)).length}));
  assert.equal(rows.length,2757,'frozen baseline pair coverage');
  const storage=createWorkspaceEngineStorageV1(),verified=new Set<string>();
  for(const row of rows){
   assert.equal(row.call_status,'settled');assert.equal(row.results_applied,true);assert.equal(row.source_run_status,'completed');assert.equal(row.source_labeler_digest,baseline.run.labeler_digest);assert.notEqual(row.source_snapshot.preview,true);
   const input=row.call_inputs.find((item:any)=>item.root_id===row.root_id);assert.ok(input);
   for(const key of ['root_fingerprint','entity_context_digest','effective_entities_digest'])assert.equal(input[key],row[key]);
   assert.equal(input.input_digest,row.frozen_input.input_digest);assert.equal(input.text,row.frozen_input.text);
   assert.ok(input.evaluated_concepts.some((concept:any)=>concept.concept_key===row.concept_key&&concept.definition_digest===row.definition_digest));
   const result=row.call_results.find((item:any)=>item.root_id===row.root_id&&item.concept_key===row.concept_key&&item.definition_digest===row.definition_digest);assert.ok(result);
   assert.equal(result.verdict,row.verdict);assert.deepEqual(result.citations,row.citations);
   if(!verified.has(row.call_id)){
    await readSignalLabelingReceiptV1({storage,workspace_id:identity.workspace_id,run_id:row.run_id,storage_key:row.raw_storage_key,raw_sha256:row.raw_sha256,size_bytes:row.raw_size_bytes});verified.add(row.call_id);
   }
  }
  const overrides=(await pool.query(`SELECT o.* FROM signal_concept_membership_overrides o JOIN signal_labeling_calls call ON call.run_id=$1 CROSS JOIN LATERAL jsonb_array_elements(call.inputs) input
   WHERE o.workspace_id=$2 AND o.superseded_at IS NULL AND o.root_id=(input->>'root_id')::uuid AND o.root_fingerprint=input->>'root_fingerprint'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements($3::jsonb) concept WHERE concept->>'concept_key'=o.concept_key AND concept->>'definition_digest'=o.definition_digest)`,[manifest.run_id,identity.workspace_id,JSON.stringify(baseline.run.membership_snapshot.concepts)])).rows;
  const uniqueOverrides=new Map(overrides.map((row:any)=>[row.id,row]));
  const predictions=rows.map((row:any)=>{const human=[...uniqueOverrides.values()].find((o:any)=>o.root_id===row.root_id&&o.concept_key===row.concept_key) as any;
   return {root_id:row.root_id,input_digest:row.frozen_input.input_digest,root_fingerprint:row.root_fingerprint,concept_key:row.concept_key,definition_digest:row.definition_digest,entity_context_digest:row.entity_context_digest,effective_entities_digest:row.effective_entities_digest,verdict:human?.verdict??row.verdict,citations:human?[]:row.citations,rationale:human?null:row.rationale,call_id:row.call_id,run_id:row.run_id,labeler_digest:row.labeler_digest,source:human?'human':'model',override_id:human?.id??null,raw_sha256:row.raw_sha256};});
  const lastPairs=new Set(baseline.calls.flatMap((call:any)=>(call.results??[]).map((result:any)=>`${result.root_id}:${result.concept_key}`)));
  const sourceCalls=[...new Map(rows.map((row:any)=>[row.call_id,{call_id:row.call_id,run_id:row.run_id,raw_sha256:row.raw_sha256,settled_micro_usd:row.source_call_cost}])).values()];
  const receipt={stage:'standard_v2_baseline_cache_verified',root_input_sha256:baseline.root_input_sha256,labeler_digest:baseline.run.labeler_digest,pairs:predictions.length,reused_pairs:predictions.filter((row:any)=>!lastPairs.has(`${row.root_id}:${row.concept_key}`)).length,overrides:uniqueOverrides.size,source_calls:sourceCalls,verified_raw_calls:verified.size,predictions,provider_calls:0,at:new Date().toISOString()};
  await writeFile(`${directory}/baseline-cache.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({stage:receipt.stage,pairs:receipt.pairs,reused_pairs:receipt.reused_pairs,overrides:receipt.overrides,verified_raw_calls:receipt.verified_raw_calls,baseline_cache_digest:digest(receipt),provider_calls:0}));
 }catch(error){const e=error as any;console.error(JSON.stringify({stage:'baseline_cache_failed',code:e.code??null,location:e.stack?.split('\n').find((line:string)=>line.includes('standard-v2-baseline-cache.ts'))?.trim()}));throw error;}finally{await pool.end();}
});
