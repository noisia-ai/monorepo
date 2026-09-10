import assert from 'node:assert/strict';
import test from 'node:test';
import {available,fixture,id,sha} from './signal-workspace-incremental-projection.fixture';
import {signalWorkspaceIncrementalDerivationJobV1 as run} from './signal-workspace-incremental-derivation';
import {buildSignalWorkspaceInterpretationBatchV1,resolveSignalWorkspaceIncrementalBindingsV1,
 SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration,
 type SignalWorkspaceIncrementalProjectionProposalV1} from '@noisia/query-engine';
import type {SignalWorkspaceIncrementalCatalogReceiptV1} from '../../../../infrastructure/db/signal-topic-catalog';

/** Previously computed local numerical files, explicit synthetic editorial
 * owner/claim/packet. This exercises delivery wiring, not DB authority or fit. */
async function scenario(){
 const f=await fixture(2),component=f.manifest.components.find(row=>row.model_origin.execution_id===f.d.execution_id)!;
 assert.ok(component);const unit=component.units[0]!,packet=f.packets.find(row=>JSON.parse(row.body).clusters[0].cluster_id===unit.unit_key)!;
 const body=JSON.parse(packet.body),owner=id(9100),context={...body.context,execution_id:owner};
 const batch=buildSignalWorkspaceInterpretationBatchV1(context,body.clusters,configuration);
 const source:NonNullable<SignalWorkspaceIncrementalProjectionProposalV1['source']>={kind:'incremental_editorial',
  numeric_execution_id:f.d.execution_id,numeric_checkpoint_digest:f.d.numeric_checkpoint.checkpoint_digest,
  evidence_plan_artifact_id:id(9101),evidence_digest:sha('explicit synthetic evidence'),target_binding_digest:sha('explicit target binding'),
  request_plan_artifact_id:id(9102),request_plan_digest:sha('explicit synthetic request plan'),response_sha256:sha('explicit synthetic response'),
  claims:[{claim_artifact_id:id(9103),owner_execution_id:owner,component_key:component.component_key,unit,model_origin:component.model_origin}]};
 const value=JSON.stringify({contract_version:'workspace-incremental-editorial-result-v1',context,clusters:body.clusters,interpretations:body.interpretations});
 Object.assign(packet,{owner_execution_id:owner,request_digest:batch.request_digest,source,body:value,artifact_sha256:sha(value)});
 const ref=f.proposals.find(row=>row.artifact_id===packet.artifact_id)!;
 Object.assign(ref,{owner_execution_id:owner,request_digest:batch.request_digest,source,artifact_sha256:sha(value),sha256:sha(value),size_bytes:Buffer.byteLength(value),
  storage_key:`workspace-engine/${f.d.workspace_id}/${owner}/explicit-proposal.json`});
 f.objects.set(ref.storage_key,Buffer.from(value));
 f.topics.splice(f.topics.findIndex(row=>row.definition.source?.candidate_key===unit.unit_key),1);
 const resolved=resolveSignalWorkspaceIncrementalBindingsV1({workspace_id:f.d.workspace_id,components:f.manifest.components,topics:f.topics,proposals:f.packets});
 f.d.editorial_cut_digest=resolved.editorial_cut_digest;
 const receipt:SignalWorkspaceIncrementalCatalogReceiptV1={contract_version:'workspace-incremental-editorial-catalog-receipt-v1',receipt_id:id(9200),
  numeric_execution_id:f.d.execution_id,serving_editorial_cut_digest:resolved.editorial_cut_digest,output_catalog_profile_id:id(9201),output_catalog_revision:2,
  mapping_digest:sha('explicit catalog mapping'),topic_count:f.topics.length+1,discovered_topic_count:f.topics.length+1};
 let materializations=0,completions=0;
 f.stores.materialize=async args=>{
  assert.equal(f.counts.root_items%f.roots.length,0);assert.equal(f.durableUnits.size,11);
  let count=0;for await(const row of args.proposals){assert.equal(sha(row.body),f.proposals.find(ref=>ref.artifact_id===row.artifact_id)!.sha256);count++;}
  assert.equal(count,f.proposals.length);materializations++;return{catalog_receipt:receipt,requires_dispatch_refresh:true};
 };
 f.stores.completeDispatch=async args=>{assert.deepEqual(args.catalog_receipt,receipt);completions++;};
 const invoke=()=>run({id:f.d.worker_job_id,data:f.d,updateProgress:async()=>{}},{database:{} as never,stores:f.stores,storage:f.storage,scratch_root:f.scratch});
 return{...f,invoke,receipt,get materializations(){return materializations;},get completions(){return completions;}};
}

test('catalog stage preflights all roots and bank units, publishes a receipt and defers classification to its new identity',{skip:!available},async()=>{
 const f=await scenario();try{
  const result=await f.invoke();assert.ok('phase' in result);assert.equal(result.phase,'catalog');assert.deepEqual(result.catalog_receipt,f.receipt);
  assert.equal(result.projection_execution_id,null);assert.equal(f.materializations,1);assert.equal(f.completions,1);
  assert.equal(f.counts.root_items,390);assert.equal(f.counts.put,0);assert.equal(f.counts.bindings,0);assert.equal(f.counts.finish,0);
  f.assertNumericUnchanged();
 }finally{await f.cleanup();}
});
test('lost catalog or dispatch ACK reuses the same durable receipt and never writes old-scope bindings',{skip:!available},async t=>{
 for(const phase of ['catalog','dispatch'] as const)await t.test(phase,async()=>{const f=await scenario();try{
  const original=phase==='catalog'?f.stores.materialize!:f.stores.completeDispatch;let lost=true;
  if(phase==='catalog')f.stores.materialize=async args=>{const result=await (original as NonNullable<typeof f.stores.materialize>)(args);if(lost){lost=false;throw Object.assign(Error('local ACK loss'),{code:'ECONNRESET'});}return result;};
  else f.stores.completeDispatch=async args=>{await (original as typeof f.stores.completeDispatch)(args);if(lost){lost=false;throw Object.assign(Error('local ACK loss'),{code:'ECONNRESET'});}};
  await assert.rejects(f.invoke(),/transport_unavailable/u);const result=await f.invoke();assert.ok('phase' in result);
  assert.deepEqual(result.catalog_receipt,f.receipt);assert.equal(f.counts.put,0);assert.equal(f.counts.bindings,0);assert.equal(f.counts.generation,0);f.assertNumericUnchanged();
 }finally{await f.cleanup();}});
});
test('last packet corruption or last root drift prevents any catalog receipt',{skip:!available},async t=>{
 for(const changed of ['packet','root'] as const)await t.test(changed,async()=>{const f=await scenario();try{
  if(changed==='packet'){const ref=f.proposals.at(-1)!;f.objects.set(ref.storage_key,Buffer.from('corrupt retained bytes'));}
  else f.roots.at(-1)!.root_fingerprint=sha('changed current root');
  await assert.rejects(f.invoke(),/verification_failed|population_changed/u);assert.equal(f.materializations,0);assert.equal(f.completions,0);assert.equal(f.counts.put,0);
 }finally{await f.cleanup();}});
});
