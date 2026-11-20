import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {deriveSignalListeningCalibrationV1,loadSignalListeningCalibrationV1} from '../signal-listening-calibration';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
 signalListeningCalibrationShapeV1,mapSignalListeningJevResponseV1,type SignalListeningInputV1} from '@noisia/query-engine';
import {extractSignalListeningCalibrationQueryV1} from './signal-listening-calibration-query';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
test('calibration uses the latest32 verified normal receipts and preserves earlier measured profiles',{
 skip:process.env.NOISIA_R16_LISTENING_CALIBRATION_SCALE_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{root_count:1002,execution_cap_micro_usd:1000000,import_batch_size:256,beforeProcessing:async ctx=>{
  const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id},database=ctx.database;
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const configuration=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const map=(await database.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[ctx.map_id])).rows[0]!;
  const roots=(await database.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id LIMIT 64',[ctx.workspace_id,ctx.map_id])).rows.map(r=>r.root_id);
  const full=(await database.query('SELECT * FROM signal_listening_population_v1($1,$2,$3,$4) ORDER BY root_id,question_key',[ctx.workspace_id,configuration.id,ctx.map_id,map.entity_context_digest])).rows;
  assert.equal(full.length,2004);
  const bounded=(await database.query('SELECT * FROM signal_listening_population_roots_v1($1,$2,$3,$4,$5,$6) ORDER BY root_id,question_key',[ctx.workspace_id,configuration.id,ctx.map_id,map.entity_context_digest,roots,'llm-processing'])).rows;
  assert.deepEqual(bounded,full.filter(r=>roots.includes(r.root_id)));
  const reader=(await database.query(`SELECT p.prosrc,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid='signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::regprocedure`)).rows[0] as {prosrc:string;lanname:string};
  let source=extractSignalListeningCalibrationQueryV1(reader);
  for(const [name,value] of Object.entries({w:'$1::uuid',cid:'$2::uuid',mid:'$3::uuid',ctx:'$4::text',roots:'$5::uuid[]',purpose:'$6::text'}))source=source.replace(new RegExp('\\b'+name+'\\b','g'),value);
  // EXPLAIN is a utility statement: unlike the native function invocation,
  // it does not inherit the six declared argument types for a leading IS NULL.
  const argumentTypes=['uuid','uuid','uuid','text','uuid[]','text'];
  source=source.replace(/\$([1-6])\b(?!\s*::)/gu,(_match,index:string)=>`$${index}::${argumentTypes[Number(index)-1]}`);
  const explained=(await database.query('EXPLAIN (ANALYZE,FORMAT JSON) '+source,[ctx.workspace_id,configuration.id,ctx.map_id,map.entity_context_digest,[roots[0]],'llm-processing'])).rows[0]['QUERY PLAN'][0].Plan;
  type Node={['Node Type']:string;['Relation Name']?:string;['Index Cond']?:string;['Actual Rows']:number;['Actual Loops']:number;Plans?:Node[]};
  const flatten=(node:Node):Node[]=>[node,...(node.Plans??[]).flatMap(flatten)];
  const itemScans=flatten(explained).filter(n=>n['Relation Name']==='signal_mass_labeling_items');assert.ok(itemScans.length>=1);
  const active=itemScans.filter(n=>n['Actual Loops']>0);assert.equal(active.length,1);
  assert.match(active[0]!['Node Type'],/Index/);assert.match(active[0]!['Index Cond']??'',/root_id/);assert.equal(active[0]!['Actual Rows'],1);
  assert.ok(itemScans.every(n=>n['Actual Loops']===0||/root_id/.test(n['Index Cond']??'')),'the full corpus branch is pruned or never executed for a call root');
  console.log('# bounded validation plan '+JSON.stringify(active.map(n=>({node:n['Node Type'],rows:n['Actual Rows'],loops:n['Actual Loops'],index_cond:n['Index Cond']}))));
  const files=await mkdtemp(join(tmpdir(),'r16-calibration-native-'));
  try{
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{
     const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const f=await open(path,'r+');try{await f.sync();}finally{await f.close();}
     const actual=await readFile(path,'utf8');assert.equal(sha(actual),a.raw_sha256);assert.equal(Buffer.byteLength(actual),a.size_bytes);
     return {storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};
    },load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
   const store=createSignalListeningStoreV1({database,rawPages,page_size:33,storeRaw:async()=>{throw Error('one raw page perflush is required');}});
   const requested=await requestSignalListeningV1({...access,configuration_id:configuration.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const run=await store.claim(requested.run_id);assert.ok(run);
   const first=await store.inputs(run);assert.equal(first.length,33);const shape=signalListeningCalibrationShapeV1(configuration.configuration,first[0]!);
   assert.equal(await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest}),null);
   let counter=0;
   const complete=async(input:SignalListeningInputV1[])=>{
    const proposals=input.map(i=>{const request=buildSignalListeningJevRequestV1(i,configuration.configuration),request_digest=signalListeningRequestDigestV1(run,i,request);
     return {custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
    const calls=await store.reserve(run,proposals);await store.markSubmitting(run,calls);
    const outcomes=calls.map(call=>{const i=call.inputs[0]!,tokens=120+(counter++),voice=buildSignalListeningJevRequestV1(i,configuration.configuration).questions.voice!;assert.equal(voice.type,'choice');if(voice.type!=='choice')throw Error('voice contract');const response={model:configuration.configuration.model,usage:{input_tokens:tokens,output_tokens:20},answers:{
      promotion:{type:'noul' as const,noul:.1},voice:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(voice.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(voice.criteria).length-1)]))}}};
     return {call,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:100}),usage:jevUsageV1(response.usage),
      result:mapSignalListeningJevResponseV1(i,run.context,configuration.configuration,response)};});
    await store.persistRawPage(run,outcomes);
    await store.settlePage(run,outcomes.map(o=>({call:o.call,usage:o.usage,settled_micro_usd:8})));
    await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));
   };
   await complete(first);
   const measured=await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest});assert.ok(measured);assert.equal(measured.sample_count,32);
   const expected=(await database.query('SELECT id FROM signal_labeling_calls WHERE run_id=$1 ORDER BY created_at DESC,id DESC LIMIT 32',[run.id])).rows.map(r=>r.id);
   assert.deepEqual(measured.source_call_ids,expected,'the newest32 receipts are authoritative, including deterministic timestamp ties');
   await complete((await store.inputs(run)).slice(0,1));
   const updated=await deriveSignalListeningCalibrationV1({...access,run_id:run.id,shape_digest:shape.shape_digest});assert.ok(updated);assert.equal(updated.sample_count,32);
   assert.notEqual(updated.source_digest,measured.source_digest);assert.equal((await database.query('SELECT count(*)::int n FROM signal_listening_calibrations WHERE source_run_id=$1',[run.id])).rows[0].n,2);
   assert.deepEqual(await loadSignalListeningCalibrationV1({...access,configuration_digest:configuration.configuration_digest,model:configuration.configuration.model,shape_digest:shape.shape_digest}),updated);
   assert.equal(await loadSignalListeningCalibrationV1({...access,configuration_digest:configuration.configuration_digest,model:'foreign-model',shape_digest:shape.shape_digest}),null);
   await store.release(run);
  }finally{await rm(files,{recursive:true,force:true});}
 }}});
});
