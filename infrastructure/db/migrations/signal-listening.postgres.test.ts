import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {PoolClient} from 'pg';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1,getSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {getSignalListeningStatusV1,readSignalListeningQuestionMetricsV1} from '../signal-listening-serving';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
 mapSignalListeningJevResponseV1,signalListeningCalibrationShapeV1,type SignalListeningConfigurationV1,type SignalListeningInputV1} from '@noisia/query-engine';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {deriveSignalListeningCalibrationV1,loadSignalListeningCalibrationV1} from '../signal-listening-calibration';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';

const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
test('listening reuses question receipts across configuration versions with live authority and no legacy mutation',{
 skip:process.env.NOISIA_R16_LISTENING_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  // Positive paths use independent native transactions. Only deliberately denied
  // mutations share a local rollback scope so no test changes leak into the next assertion.
  let negative:PoolClient|null=null,negativeName:string|null=null,serial=0;
  const native=ctx.database;
  const query=async(sql:string,params?:unknown[])=>{
   if(sql.startsWith('SAVEPOINT ')&&!negative){negative=await native.connect();await negative.query('BEGIN');negativeName=sql.slice(10);}
   const result=await(negative??native).query(sql,params);
   if(negative&&sql==='RELEASE SAVEPOINT '+negativeName){await negative.query('ROLLBACK');negative.release();negative=null;negativeName=null;}
   return result;
  };
  const database:LabelingDatabaseV1={query:query as LabelingDatabaseV1['query'],connect:async()=>{
   if(!negative)return native.connect();
   const client=negative,stack:string[]=[];
   const scoped=Object.create(client) as PoolClient;scoped.release=()=>{};
   scoped.query=(async(sql:string,params?:unknown[])=>{
    if(sql.startsWith('BEGIN')){const name='negative_tx_'+(++serial);stack.push(name);return client.query('SAVEPOINT '+name);}
    if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT '+stack.pop()!);
    if(sql==='ROLLBACK'){const name=stack.pop()!;await client.query('ROLLBACK TO SAVEPOINT '+name);return client.query('RELEASE SAVEPOINT '+name);}
    return client.query(sql,params);
   }) as PoolClient['query'];return scoped;
  }};
  const access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  for(const name of ['signal_listening_configurations','signal_listening_questions','signal_listening_runs','signal_listening_answers'])
   assert.ok((await database.query('SELECT to_regclass($1) relation',[name])).rows[0].relation);
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const legacy=(await database.query('SELECT to_jsonb(m) row FROM signal_mass_labeling_runs m WHERE run_id=$1',[ctx.run_id])).rows;
  const root=await mkdtemp(join(tmpdir(),'r16-listening-'));
  try{
   const storage={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
     const storage_key=storage.reference(a).storage_key,path=join(root,a.raw_sha256.slice(7));
     await writeFile(path,a.raw_text,{flag:'wx'});const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
     const read=await readFile(path,'utf8');assert.equal(sha(read),a.raw_sha256);assert.equal(Buffer.byteLength(read),a.size_bytes);
     return {storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
    },load:async(a:{sha256:string})=>readFile(join(root,a.sha256.slice(7)),'utf8')};
   const store=createSignalListeningStoreV1({database,rawPages:storage,page_size:200,storeRaw:async()=>{throw Error('individual raw forbidden');}});
   const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
   const custom={key:'tone',type:'choice' as const,text:'What kind of comment is this?',scope:'all' as const,origin:'brand_os' as const,human_locked:false,
    options:[{key:'praise',definition:'A favorable comment'},{key:'other',definition:'Other comment'}]};
   const scoped={...custom,key:'usage',scope:'consumer_category' as const,text:'How is the product used?'};
   let configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,questions:[...base.questions,custom,scoped,
    {key:'repair_topic',type:'noul',text:'Does this discuss bicycle repairs?',positive:'Bicycle repairs',negative:'Unrelated content',scope:'all',
     origin:'brand_os',human_locked:false,topic_source:'defined',domain:'category'}]})});
   assert.equal(configuration.revision,1);
   assert.equal((await getSignalListeningConfigurationV1(access))?.id,configuration.id);
   await assert.rejects(getSignalListeningConfigurationV1({...access,workspace_id:randomUUID()}),/listening_forbidden/);
   await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:configuration.configuration}),/configuration_conflict/);
   const start=async()=>requestSignalListeningV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   let physical=0,phases:string[][]=[];
   async function complete(id:string){
    const run=await store.claim(id);assert.ok(run);
    const c=run.identity.params.configuration as SignalListeningConfigurationV1;
    for(let n=0;n<10;n++){
     const input=await store.inputs(run);if(!input.length)break;
     phases.push(input.flatMap(i=>i.question_keys));
     const proposals=input.map(i=>{const request=buildSignalListeningJevRequestV1(i,c),request_digest=signalListeningRequestDigestV1(run,i,request);
      return {custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
     const calls=await store.reserve(run,proposals);await store.markSubmitting(run,calls);
     const outcomes=calls.map(call=>{
      physical++;const i=call.inputs[0]!,request=buildSignalListeningJevRequestV1(i,c);
      const answers=Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:key==='promotion'?(i.text.includes('0001')?.9:.1):.9}:
       {type:'choice',choice:key==='voice'?(i.text.includes('0002')?'media':'individual'):Object.keys(q.criteria)[0],confidence:.9,
        probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,ix)=>[k,ix===0?.9:.1/(Object.keys(q.criteria).length-1)]))}]));
      const response={model:c.model,answers,usage:{input_tokens:120,output_tokens:20}};
      const raw=JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:80});
      return {call,raw,result:mapSignalListeningJevResponseV1(i,run.context,c,response as Parameters<typeof mapSignalListeningJevResponseV1>[3])};
     });
     await store.persistRawPage(run,outcomes);
     if(physical===3)await assert.rejects(store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]}))),/listening_answer_receipt_invalid/,
      'no label can be materialized before settlement');
     await store.settlePage(run,outcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
     await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));
    }
    assert.equal(await store.finish(run),'completed');await store.release(run);
    return run;
   }
   const admitted=await start();
   const run=await complete(admitted.run_id);
   const shape=signalListeningCalibrationShapeV1(configuration.configuration,{question_keys:['voice','promotion','tone','repair_topic']});
   const sqlShape=(await database.query('SELECT signal_listening_calibration_shape_v1($1::jsonb,$2::text[]) value',[JSON.stringify(configuration.configuration),['voice','promotion','tone','repair_topic']])).rows[0].value;
   assert.deepEqual(sqlShape,shape,'TypeScript and SQL share the exact candidate-independent compiler shape');
   assert.equal(await loadSignalListeningCalibrationV1({...access,configuration_digest:configuration.configuration_digest,model:configuration.configuration.model,shape_digest:shape.shape_digest}),null);
   const measured=await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest});assert.ok(measured);
   assert.equal(measured.sample_count,3,'short corpora produce finite profiles without waiting for32');
   assert.equal(measured.source_call_ids.length,3);assert.ok(measured.request_min_bytes>0);assert.ok(measured.request_max_bytes>=measured.request_min_bytes);
   const actual=(await database.query(`SELECT max((usage->>'input_tokens')::numeric/octet_length(convert_to(signal_labeling_json_v1(request),'UTF8')))*1.25 ratio
    FROM signal_labeling_calls WHERE id=ANY($1::uuid[])`,[measured.source_call_ids])).rows[0];
   assert.equal(measured.max_input_tokens_per_byte,Number(actual.ratio));
   assert.deepEqual(await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest}),measured,'replaying the same receipts preserves immutable evidence');
   assert.deepEqual(await loadSignalListeningCalibrationV1({...access,configuration_digest:configuration.configuration_digest,model:configuration.configuration.model,shape_digest:shape.shape_digest}),measured);
   await assert.rejects(deriveSignalListeningCalibrationV1({...access,run_id:randomUUID(),shape_digest:shape.shape_digest}),/run_forbidden/);
   await database.query('SAVEPOINT calibration_tamper');
   await assert.rejects(database.query(`INSERT INTO signal_listening_calibrations(workspace_id,source_run_id,scope_digest,source_digest,profile,created_by_user_id)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)`,[access.workspace_id,run.id,measured.scope_digest,'sha256:'+ 'a'.repeat(64),JSON.stringify({...measured,max_input_tokens_per_byte:.00001}),access.actor_user_id]),/evidence_invalid/);
   await database.query('ROLLBACK TO SAVEPOINT calibration_tamper');await database.query('RELEASE SAVEPOINT calibration_tamper');
   assert.equal(physical,4);assert.equal(phases.length,2);
   assert.ok(!phases[0]!.includes('usage'));assert.deepEqual(phases[1],['usage']);
   const tone=await readSignalListeningQuestionMetricsV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,question_key:'tone'});
   assert.equal(tone.counts.eligible,3);assert.equal(tone.counts.asked,3);assert.equal(tone.coverage,1);
   assert.equal(tone.topic_cross[0]?.eligible,3);assert.equal(Object.values(tone.trend[0]!.choices).reduce((n,v)=>n+v,0),3);
   const usage=await readSignalListeningQuestionMetricsV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,question_key:'usage'});
   assert.equal(usage.counts.eligible,1);assert.equal(usage.counts.asked,1);assert.equal(usage.counts.excluded_scope,2);
   const previousCalls=physical;await complete((await start()).run_id);assert.equal(physical,previousCalls,'a new run reuses every previous semantic question');
   const appended={...custom,key:'opinion',text:'Is an opinion expressed?'};
   configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...configuration.configuration,
    questions:[...configuration.configuration.questions,appended]})});
   const missing=await readSignalListeningQuestionMetricsV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,question_key:'opinion'});
   assert.equal(missing.counts.eligible,3);assert.equal(missing.counts.asked,0);assert.equal(missing.counts.pending,3);
   assert.equal(missing.distribution.reduce((n,d)=>n+d.count,0),0,'unasked roots are not assigned to a negative or other option');
   await database.query('SAVEPOINT cap_denied');
   const low=await requestSignalListeningV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1,provider_available:true});
   const lowRun=await store.claim(low.run_id);assert.ok(lowRun);const lowInput=(await store.inputs(lowRun))[0]!;
   const lowRequest=buildSignalListeningJevRequestV1(lowInput,configuration.configuration),lowDigest=signalListeningRequestDigestV1(lowRun,lowInput,lowRequest);
   await assert.rejects(store.reserve(lowRun,[{custom_id:'listening_'+lowDigest.slice(7,67),request_digest:lowDigest,
    request:lowRequest as unknown as Record<string,unknown>,inputs:[lowInput],reserved_micro_usd:1000}]),/cap_exhausted/);
   assert.equal((await database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[lowRun.id])).rows[0].n,0);
   await database.query('ROLLBACK TO SAVEPOINT cap_denied');await database.query('RELEASE SAVEPOINT cap_denied');
   const stale=await start();
   // Exercise a real publication COMMIT. A savepoint-only fake COMMIT would
   // give the configuration a subtransaction xmin, contrary to native 0307.
   configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:{...configuration.configuration,
    questions:configuration.configuration.questions.map(q=>q.key==='opinion'?{...q,text:'Changed after this run was admitted'}:q)}});
   assert.equal(await store.claim(stale.run_id),null);
   assert.equal((await database.query('SELECT status FROM signal_labeling_runs WHERE id=$1',[stale.run_id])).rows[0].status,'failed');
   await database.query('SAVEPOINT rights_revoked');
   await database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[ctx.workspace_id]);
   try{const restricted=await readSignalListeningQuestionMetricsV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,question_key:'opinion'});
    assert.equal(restricted.counts.eligible,0);}catch(error){assert.match(String(error),/map_stale|context_changed|forbidden/);}
   await database.query('ROLLBACK TO SAVEPOINT rights_revoked');await database.query('RELEASE SAVEPOINT rights_revoked');
   phases=[];await complete((await start()).run_id);assert.equal(physical,previousCalls+3);assert.ok(phases.flat().every(k=>k==='opinion'));
   configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:{...configuration.configuration,
    questions:configuration.configuration.questions.map(q=>q.key==='opinion'?{...q,text:'What is the exact opinion?'}:q)}});
   phases=[];await complete((await start()).run_id);assert.ok(phases.flat().every(k=>k==='opinion'));
   await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'agent',source_digest:sha('agent'),
    configuration:{...configuration.configuration,instructions:configuration.configuration.instructions+' Changed.'}}),/human_edit_frozen/);
   for(const sql of ["UPDATE signal_listening_answers SET answer='{}'",'DELETE FROM signal_listening_configurations',
    "UPDATE signal_labeling_runs SET cap_micro_usd=cap_micro_usd+1 WHERE id=$1"]){
    await database.query('SAVEPOINT denied_history');await assert.rejects(database.query(sql,sql.includes('$1')?[run.id]:undefined),/immutable/);
    await database.query('ROLLBACK TO SAVEPOINT denied_history');await database.query('RELEASE SAVEPOINT denied_history');
   }
   await database.query('SAVEPOINT actor_revoked');await database.query("UPDATE users SET status='suspended' WHERE id=$1",[ctx.actor_user_id]);
   await assert.rejects(getSignalListeningConfigurationV1(access),/listening_forbidden/);
   await database.query('ROLLBACK TO SAVEPOINT actor_revoked');await database.query('RELEASE SAVEPOINT actor_revoked');
   const removed=configuration.configuration.questions.find(q=>q.key==='opinion')!;
   configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:{...configuration.configuration,
    questions:configuration.configuration.questions.filter(q=>q.key!=='opinion')}});
   assert.ok(configuration.configuration.retired_question_keys.includes('opinion'));
   await assert.rejects(saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'agent',source_digest:sha('agent-resurrection'),
    configuration:{...configuration.configuration,retired_question_keys:[],questions:[...configuration.configuration.questions,removed]}}),/human_edit_frozen/);
   assert.equal((await getSignalListeningStatusV1(access)).configuration?.id,configuration.id);
   configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:configuration.revision,provenance:'human',configuration:{...configuration.configuration,
    questions:[...configuration.configuration.questions,{...custom,key:'ambiguous',text:'A new pending question'}]}});
   const ambiguous=await start(),ambiguousRun=await store.claim(ambiguous.run_id);assert.ok(ambiguousRun);
   const ambiguousInput=(await store.inputs(ambiguousRun))[0]!,ambiguousRequest=buildSignalListeningJevRequestV1(ambiguousInput,configuration.configuration);
   const ambiguousDigest=signalListeningRequestDigestV1(ambiguousRun,ambiguousInput,ambiguousRequest);
   const ambiguousCalls=await store.reserve(ambiguousRun,[{custom_id:'listening_'+ambiguousDigest.slice(7,67),request_digest:ambiguousDigest,
    request:ambiguousRequest as unknown as Record<string,unknown>,inputs:[ambiguousInput],reserved_micro_usd:1000}]);
   await store.markSubmitting(ambiguousRun,ambiguousCalls);await store.markFailed(ambiguousRun,ambiguousCalls,true);
   assert.equal(await store.finish(ambiguousRun),'failed');await store.release(ambiguousRun);
   const runCount=(await database.query('SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
   await assert.rejects(start(),/listening_prior_outcome_unresolved/,'a new key cannot resend the same ambiguous physical question');
   assert.equal((await database.query('SELECT count(*)::int n FROM signal_labeling_runs WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n,runCount);
   assert.equal(await deriveSignalListeningCalibrationV1({...access,run_id:ambiguousRun.id,shape_digest:signalListeningCalibrationShapeV1(configuration.configuration,ambiguousInput).shape_digest}),null,'unknown calls never calibrate');
   assert.deepEqual((await database.query('SELECT to_jsonb(m) row FROM signal_mass_labeling_runs m WHERE run_id=$1',[ctx.run_id])).rows,legacy,
    'all new runs and cache generations preserve the original mass-labeling owner byte-for-byte');
  }finally{const pending=negative as PoolClient|null;if(pending){await pending.query('ROLLBACK');pending.release();}await rm(root,{recursive:true,force:true});}
 }});
});
