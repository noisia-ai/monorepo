import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {proposeSignalListeningDiscoveryBootstrapV1,bootstrapSignalListeningDiscoveryV1,refreshSignalListeningDiscoveryV1,
 snapshotSignalListeningDiscoveryOrphansV1,readSignalListeningDiscoveryOrphanSubsetV1,readSignalListeningDiscoveryRootsV1,
 seedSignalListeningDiscoveryV1,setSignalListeningDiscoveryManualV1,signalListeningDiscoveryAliasV1} from '../signal-listening-discovery';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
test('discovery stores scoped seed/confirmed generations and orphan subsets without rewriting MFP',{
 skip:process.env.NOISIA_R16_LISTENING_DISCOVERY_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const db=ctx.database,access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  for(const table of ['signal_listening_discovery_generations','signal_listening_discovery_topics','signal_listening_discovery_roots','signal_listening_discovery_members','signal_listening_discovery_subsets','signal_listening_discovery_subset_roots','signal_listening_discovery_manual'])
   assert.ok((await db.query('SELECT to_regclass($1) table',[table])).rows[0].table,table+' must exist on migrated PostgreSQL');
  await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const embeddingCallsBefore=(await db.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
  const original=(await db.query('SELECT to_jsonb(m) map,(SELECT jsonb_agg(to_jsonb(t) ORDER BY topic_key) FROM signal_mass_labeling_topics t WHERE t.map_id=m.id) topics FROM signal_mass_labeling_maps m WHERE m.id=$1',[ctx.map_id])).rows[0];
  const alias=signalListeningDiscoveryAliasV1(ctx.map_id,'long_external_key_'+ 'x'.repeat(95));assert.match(alias,/^mfp_[a-f0-9]{60}$/);assert.equal(alias.length,64);
  assert.equal(alias,signalListeningDiscoveryAliasV1(ctx.map_id,'long_external_key_'+ 'x'.repeat(95)));
  assert.notEqual(signalListeningDiscoveryAliasV1(ctx.map_id,'voice'),'voice');
  const base=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const proposed=await proposeSignalListeningDiscoveryBootstrapV1({...access,configuration_id:base.id,map_id:ctx.map_id});
  let cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:base.revision,provenance:'agent',source_digest:proposed.source_digest,configuration:localizeSyntheticListeningConfigurationV1(proposed.configuration)});
  const initial=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,bindings:proposed.bindings});
  assert.equal(initial.kind,'legacy_seed');assert.equal(initial.counts.roots,3);assert.equal(initial.counts.cached_vectors,3);
  assert.equal((await db.query("SELECT count(*)::int n FROM signal_listening_discovery_topics WHERE generation_id=$1 AND kind='legacy_seed' AND source_map_id=$2",[initial.id,ctx.map_id])).rows[0].n,proposed.bindings.length);
  await assert.rejects(readSignalListeningDiscoveryRootsV1({...access,workspace_id:randomUUID(),generation_id:initial.id}),/forbidden|unavailable/);
  const files=await mkdtemp(join(tmpdir(),'r16-discovery-'));
  try{
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
     const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
     const actual=await readFile(path,'utf8');assert.equal(sha(actual),a.raw_sha256);assert.equal(Buffer.byteLength(actual),a.size_bytes);
     return {storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
    },load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
   const store=createSignalListeningStoreV1({database:db,rawPages,page_size:200,storeRaw:async()=>{throw Error('individual raw forbidden');}});
   const started=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const run=await store.claim(started.run_id);assert.ok(run);const inputs=await store.inputs(run);assert.equal(inputs.length,3);
   const rows=inputs.map(i=>{const request=buildSignalListeningJevRequestV1(i,cfg.configuration),requestDigest=signalListeningRequestDigestV1(run,i,request);
    return {custom_id:'listening_'+requestDigest.slice(7,67),request_digest:requestDigest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
   const calls=await store.reserve(run,rows);await store.markSubmitting(run,calls);
   const outcomes=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,cfg.configuration),orphan=input.root_id===inputs[2]!.root_id;
    const response={model:cfg.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:orphan?.1:.9}:
     {type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
    return {call,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:100}),result:mapSignalListeningJevResponseV1(input,run.context,cfg.configuration,response)};});
   await store.persistRawPage(run,outcomes);await store.settlePage(run,outcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
   await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));assert.equal(await store.finish(run),'completed');await store.release(run);
   const confirmed=await refreshSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,round:1,source_generation_id:initial.id});
   assert.equal(confirmed.kind,'confirmed_members');assert.equal(confirmed.counts.category_roots,3);assert.equal(confirmed.counts.pending_base,0);assert.equal(confirmed.counts.pending_topics,0);
   const memberCount=(await db.query('SELECT min(member_count)::int n FROM signal_listening_discovery_topics WHERE generation_id=$1',[confirmed.id])).rows[0].n;assert.equal(memberCount,2);
   const subset=await snapshotSignalListeningDiscoveryOrphansV1({...access,generation_id:confirmed.id});assert.equal(subset.root_count,1);assert.equal(subset.cached_count,1);
   const exported=await readSignalListeningDiscoveryOrphanSubsetV1({...access,subset_id:subset.id,limit:1});assert.equal(exported.roots[0]?.root_id,inputs[2]!.root_id);assert.equal(exported.roots[0]?.vector?.length,1024);assert.equal(sha(exported.roots[0]!.text),exported.roots[0]!.proof.source_text_sha256);
   const key=proposed.bindings[0]!.question_key;
   await assert.rejects(setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,question_key:key,root_id:inputs[0]!.root_id,belongs:false}),/must_be_frozen/);
   cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'human',configuration:{...cfg.configuration,questions:cfg.configuration.questions.map(q=>q.key===key?{...q,human_locked:true}:q)}});
   await setSignalListeningDiscoveryManualV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,question_key:key,root_id:inputs[0]!.root_id,belongs:false});
   const manual=await refreshSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,round:2,source_generation_id:confirmed.id});
   assert.equal((await db.query('SELECT member_count FROM signal_listening_discovery_topics WHERE generation_id=$1 AND question_key=$2',[manual.id,key])).rows[0].member_count,1);
   await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'agent',source_digest:sha('agent'),configuration:{...cfg.configuration,
    questions:cfg.configuration.questions.map(q=>q.key===key&&q.type==='noul'?{...q,positive:'Agent may not redefine a frozen manual topic'}:q)}}),/human_edit_frozen/);
   const added=Array.from({length:5},(_,i)=>({key:'a_new_'+i,type:'noul' as const,text:'New revision topic '+i,positive:'New topic definition '+i,negative:'Other content',scope:'all' as const,origin:'agent' as const,human_locked:false,topic_source:'discovered' as const}));
   const next=await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'agent',source_digest:sha('new-map'),configuration:localizeSyntheticListeningConfigurationV1({...cfg.configuration,questions:[...cfg.configuration.questions,...added]})});
   const seeded=await seedSignalListeningDiscoveryV1({...access,configuration_id:next.id,map_id:ctx.map_id,round:3,source_generation_id:manual.id,seeds:next.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>
    q.key==='a_new_4'?{question_key:q.key,orphan_subset_id:subset.id,orphan_root_ids:[inputs[2]!.root_id]}:{question_key:q.key,source_topic_keys:[q.key.startsWith('a_new_')?key:q.key]})});
   assert.equal(seeded.kind,'source_seed');
   assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_answers WHERE question_key LIKE \'a_new_%\' AND workspace_id=$1',[ctx.workspace_id])).rows[0].n,0,'seed membership is never a new-question JEV approval');
   const current=(await db.query('SELECT question_key FROM signal_listening_population_roots_v1($1,$2,$3,$4,ARRAY[$5::uuid],\'llm-processing\') WHERE candidate AND definition->>\'topic_source\'=\'discovered\'',
    [ctx.workspace_id,next.id,ctx.map_id,seeded.entity_context_digest,inputs[1]!.root_id])).rows.map(r=>r.question_key);
   assert.equal(current.length,4);assert.ok(current.some(k=>k.startsWith('a_new_')),'new candidates are ranked by owned centroids, not frozen i.candidates');
   await assert.rejects(db.query('UPDATE signal_listening_discovery_topics SET member_count=0 WHERE generation_id=$1',[seeded.id]),/history_immutable/);
   await assert.rejects(db.query(`INSERT INTO signal_listening_discovery_generations(workspace_id,configuration_id,map_id,preparation_run_id,input_revision,embedding_config_digest,entity_context_digest,configuration_digest,round,kind,created_by_user_id)
    SELECT workspace_id,configuration_id,map_id,preparation_run_id,input_revision,'sha256:'||repeat('a',64),entity_context_digest,configuration_digest,0,'legacy_seed',created_by_user_id FROM signal_listening_discovery_generations WHERE id=$1`,[initial.id]),/scope_invalid/,'a generation cannot claim another vector space');
   await assert.rejects(seedSignalListeningDiscoveryV1({...access,configuration_id:next.id,map_id:ctx.map_id,round:3,source_generation_id:randomUUID(),seeds:[]}),/source_invalid/);
   await assert.rejects(seedSignalListeningDiscoveryV1({...access,configuration_id:next.id,map_id:ctx.map_id,round:3,source_generation_id:initial.id,
    seeds:next.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>({question_key:q.key,source_topic_keys:[key]}))}),/members_incomplete/,'unconfirmed legacy groups cannot masquerade as confirmed-member source seeds');
   assert.equal((await db.query('SELECT count(*)::int n FROM signal_workspace_embedding_calls WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n,embeddingCallsBefore,'all seed/centroid/subset work reuses existing Voyage receipts');
   assert.deepEqual((await db.query('SELECT to_jsonb(m) map,(SELECT jsonb_agg(to_jsonb(t) ORDER BY topic_key) FROM signal_mass_labeling_topics t WHERE t.map_id=m.id) topics FROM signal_mass_labeling_maps m WHERE m.id=$1',[ctx.map_id])).rows[0],original);
   await db.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[ctx.workspace_id]);
   await assert.rejects(readSignalListeningDiscoveryOrphanSubsetV1({...access,subset_id:subset.id}),/stale|context_changed|forbidden/,'a frozen subset cannot export corpus bytes after rights are revoked');
  }finally{await rm(files,{recursive:true,force:true});}
 }});
});
