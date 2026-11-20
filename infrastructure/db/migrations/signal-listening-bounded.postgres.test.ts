import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
test('bounded listening selection preserves full semantics and freezes human global instructions',{
 skip:process.env.NOISIA_R16_LISTENING_BOUNDED_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id},db=ctx.database;
  assert.ok((await db.query("SELECT to_regprocedure('signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)') p")).rows[0].p,'bounded selector must be installed');
  await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,configuration:base,provenance:'human'});
  const context=(await db.query('SELECT entity_context_digest digest FROM signal_mass_labeling_maps WHERE id=$1',[ctx.map_id])).rows[0].digest;
  const full=(await db.query('SELECT * FROM signal_listening_population_v1($1,$2,$3,$4) ORDER BY root_id,question_key',[ctx.workspace_id,cfg.id,ctx.map_id,context])).rows;
  assert.equal(full.length,6);const root=full[0]!.root_id;
  const args=[ctx.workspace_id,cfg.id,ctx.map_id,context,[root,root],'llm-processing'];
  assert.deepEqual((await db.query('SELECT * FROM signal_listening_population_roots_v1($1,$2,$3,$4,$5,$6) ORDER BY root_id,question_key',args)).rows,full.filter(r=>r.root_id===root));
  assert.equal((await db.query('SELECT * FROM signal_listening_population_roots_v1($1,$2,$3,$4,$5,$6)',[...args.slice(0,4),[],args[5]])).rows.length,0);
  assert.equal((await db.query('SELECT * FROM signal_listening_population_roots_v1($1,$2,$3,$4,$5,$6)',[randomUUID(),...args.slice(1)])).rows.length,0);
  const queued=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const changed=await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,configuration:{...cfg.configuration,instructions:'Human instructions changed globally.'},provenance:'human'});
  assert.equal((await db.query('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1',[queued.run_id])).rows[0].status,'failed','a published replacement retires unsent old work at COMMIT');
  assert.ok(changed.configuration.questions.every(q=>q.human_locked),'semantic changes from global instructions freeze every affected question');
  await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:changed.revision,configuration:{...changed.configuration,instructions:cfg.configuration.instructions},provenance:'agent',source_digest:'sha256:'+'f'.repeat(64)}),/human_edit_frozen/);
  const forged={...changed.configuration,instructions:'A second human semantic change.',questions:changed.configuration.questions.map(q=>({...q,human_locked:false}))};
  await assert.rejects(db.query(`INSERT INTO signal_listening_configurations(workspace_id,revision,configuration,configuration_digest,provenance,state,created_by_user_id)
   VALUES($1,$2,$3::jsonb,$4,'human','published',$5)`,[ctx.workspace_id,changed.revision+1,JSON.stringify(forged),digest(forged),ctx.actor_user_id]),/human_edit_must_freeze/);
  const files=await mkdtemp(join(tmpdir(),'r16-listening-lifecycle-'));
  try{
   const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
     const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
     const actual=await readFile(path,'utf8');assert.equal(sha(actual),a.raw_sha256);assert.equal(Buffer.byteLength(actual),a.size_bytes);
     return {storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
    },load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
   const store=createSignalListeningStoreV1({database:db,rawPages,page_size:200,storeRaw:async()=>{throw Error('individual raw forbidden');}});
   assert.equal(await store.claim(queued.run_id),null);
   const paid=await requestSignalListeningV1({...access,configuration_id:changed.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const run=await store.claim(paid.run_id);assert.ok(run);
   const batch=(await store.inputs(run)).slice(0,2),input=batch[0]!,request=buildSignalListeningJevRequestV1(input,changed.configuration);
   const calls=await store.reserve(run,batch.map(i=>{const request=buildSignalListeningJevRequestV1(i,changed.configuration),requestDigest=signalListeningRequestDigestV1(run,i,request);
    return {custom_id:'listening_'+requestDigest.slice(7,67),request_digest:requestDigest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};}));
   await store.markSubmitting(run,calls);
   await assert.rejects(db.query("UPDATE signal_labeling_calls SET status='reserved' WHERE id=$1",[calls[1]!.id]),/listening_call_immutable/,'a missing live in-process witness never resets submitting');
   const witness={contract_version:'signal-labeling-unsent-requeue-v1',run_id:run.id,workspace_id:run.workspace_id,lease_token:run.lease_token,calls:[{id:calls[1]!.id,request_digest:calls[1]!.request_digest}]};
   const reset=async(marker:unknown,id:string)=>{const c=await db.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('noisia.labeling_unsent_requeue_v1',$1,true)",[JSON.stringify(marker)]);
    await c.query("UPDATE signal_labeling_calls SET status='reserved',updated_at=clock_timestamp() WHERE id=$1",[id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
   await assert.rejects(reset({...witness,lease_token:randomUUID()},calls[1]!.id),/listening_call_immutable/);
   assert.ok(store.requeueUnsent);await store.requeueUnsent(run,[calls[1]!]);await store.requeueUnsent(run,[calls[1]!]);
   for(const status of ['unknown','submitted']){
    const c=await db.connect();try{await c.query('BEGIN');await c.query('UPDATE signal_labeling_calls SET status=$2 WHERE id=$1',[calls[1]!.id,status]);
     await c.query("SELECT set_config('noisia.labeling_unsent_requeue_v1',$1,true)",[JSON.stringify(witness)]);
     await assert.rejects(c.query("UPDATE signal_labeling_calls SET status='reserved' WHERE id=$1",[calls[1]!.id]),/listening_call_immutable/);
    }finally{await c.query('ROLLBACK');c.release();}
   }
   const held=(await db.query('SELECT status,reserved_micro_usd::text,raw_sha256,usage,results,results_applied FROM signal_labeling_calls WHERE id=$1',[calls[1]!.id])).rows[0]!;
   assert.equal(held.status,'reserved');assert.equal(held.reserved_micro_usd,'1000');assert.equal(held.results_applied,false);assert.equal(held.raw_sha256,null);assert.equal(held.usage,null);assert.equal(held.results,null);
   const response={model:changed.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:.1}:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
   await store.persistRawPage(run,[{call:calls[0]!,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:100})}]);
   await assert.rejects(reset({...witness,calls:[{id:calls[0]!.id,request_digest:calls[0]!.request_digest}]},calls[0]!.id),/listening_call_immutable/,'a durable page member cannot be reset even with a forged unsent witness');
   const next=await saveSignalListeningConfigurationV1({...access,expected_revision:changed.revision,configuration:{...changed.configuration,instructions:'Human instructions version3.'},provenance:'human'});
   assert.equal((await db.query('SELECT status FROM signal_labeling_runs WHERE id=$1',[run.id])).rows[0].status,'running','raw paid before publication remains recoverable');
   assert.deepEqual(await store.inputs(run),[],'a superseded run cannot select another provider request');
   await store.renew(run);
   const recovered=(await store.calls(run))[0]!;assert.equal(recovered.id,calls[0]!.id);assert.ok(recovered.raw_body);
   await store.settlePage(run,[{call:recovered,usage:jevUsageV1(response.usage),settled_micro_usd:6}]);
   await store.apply(run,[{call:recovered,results:[mapSignalListeningJevResponseV1(calls[0]!.inputs[0]!,run.context,changed.configuration,response)]}]);
   assert.equal(await store.finish(run),'failed');await store.release(run);
   assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_answers WHERE run_id=$1',[run.id])).rows[0].n,2,'the paid receipt retains its original semantic question identities');
   const newest=await requestSignalListeningV1({...access,configuration_id:next.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   assert.ok(newest.run_id,'the replacement admits normally after draining the old raw receipt');
  }finally{await rm(files,{recursive:true,force:true});}
 }});
});
