import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1,buildSignalStudyMotiveFitPlanV1,signalWorkspaceEmbeddingDigestV1 as digest,type SignalStudyRootV1,type SignalStudyV1} from '@noisia/query-engine';
import {createSignalStudyNumericDriverV1,createSignalStudyNumericStorageBindingsV1,type StudyNumericContextV1,type StudyNumericRowV1,type StudyNumericManifestV1} from './signal-study-numeric';
import type {StudyRuntimeNumericPlanV1} from './signal-study-runtime';
import {buildWorkspaceEngineStorageKeyV1,type WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
const sha=(text:string|Buffer)=>'sha256:'+createHash('sha256').update(text).digest('hex');
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const id=(n:number)=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
const module_root=fileURLToPath(new URL('../../../../tools/signal-semantic-lab/src',import.meta.url));
function fixture(count:number){
 const workspace_id=randomUUID(),execution_id=randomUUID(),source_digest=digest('sealed-source'),embedding_space_digest=digest('voyage-compatible-space');
 const study:SignalStudyV1={contract_version:'signal-study-v1',workspace_id,corpus_id:randomUUID(),listening_configuration_id:randomUUID(),listening_configuration_digest:digest('base'),
  methodology:{key:'triggers_barriers',version:'r16-v1',template_digest:SIGNAL_STUDY_TB_TEMPLATE_DIGEST_V1},subject:{kind:'category',name:'synthetic consumption',category:'synthetic consumption',own_brand:'Synthetic',competitors:['Synthetic competitor'],alternatives:['Synthetic alternative']},
  business_question:'Synthetic forces?',cut:{start_at:'2026-01-01T00:00:00Z',end_at:'2027-01-01T00:00:00Z',timezone:'UTC',voice:'individual',promotion_max:.7,exclude_hashtag_only:true,require_category_lexicon:true,filters:{}},provenance:'agent',revision:1};
 const roots:SignalStudyRootV1[]=Array.from({length:count},(_,i)=>{
  const fragment=i<count/2?'Coffee plantation aroma espresso morning breakfast '+i:'Bicycle wheels pedals mountain cycling repair '+i,text='Origin: '+fragment+' trailing context';
  const vector=Array.from({length:1024},(_,j)=>j===(i<count/2?0:1)?1:j===2+i%1022?.01:0),norm=Math.hypot(...vector);
  const direction=(['trigger','barrier','mixed']as const)[i%3]!,aggregate=i%5===0?'competitor':i%7===0?'alternative':'subject';
  return{root_id:id(100+i),text,text_sha256:sha(text),selected_fragment:{text:fragment,text_sha256:sha(fragment),start:8,end:8+fragment.length},vector:vector.map(v=>v/norm),
   axes:{direction,source_direction:direction,target:aggregate==='competitor'?'competitor_brand':aggregate==='alternative'?'alternative':'category',use:'literal',aggregate,alternative_inverted:false},
   occurred_at:'2026-01-10T00:00:00Z',channel:'synthetic',source_url:'https://example.com/'+i,listening_topic_keys:[],private_person_names:[]};
 });
 const fit_plan=buildSignalStudyMotiveFitPlanV1({study,roots,embedding_space_digest}),body=JSON.stringify(fit_plan);
 const numeric_plan:StudyRuntimeNumericPlanV1={kind:'numeric',key:digest('native-key'),source_digest,request_body:body,request_sha256:sha(body),fit_plan_digest:fit_plan.plan_digest};
 const rows:StudyNumericRowV1[]=roots.map((root,i)=>{
  const fragment=root.selected_fragment!,vector_json=JSON.stringify(root.vector),preparation=i%7===0?null:id(i%2?80001:80002);
  const proof={contract_version:'signal-study-cached-vector-proof-v1',workspace_id,execution_id,source_digest,study_digest:digest(study),cut_digest:digest(study.cut),fit_plan_digest:fit_plan.plan_digest,
   root_id:root.root_id,input_digest:digest('input-'+i),source_text_sha256:fragment.text_sha256,original_source_text_sha256:root.text_sha256,chunk_sha256:fragment.text_sha256,
   selected_fragment:{start:fragment.start,end:fragment.end,text_sha256:fragment.text_sha256},embedding_call_id:id(10000+i),embedding_run_id:id(i%2?90001:90002),embedding_preparation_run_id:preparation,
   embedding_input_contract:preparation?'corpus-prepared-v1':'legacy-cached-vectors-v1',embedding_raw_sha256:sha(JSON.stringify({embeddings:[root.vector]})),embedding_request_digest:digest({input_keys:[fragment.text_sha256]}),
   embedding_batch_digest:digest({batch:[fragment.text_sha256]}),embedding_chunk_sha256:fragment.text_sha256,embedding_response_index:0,embedding_model:'synthetic-voyage-1024',
   embedding_config_digest:digest('native-config'),context_digest:digest('native-context'),embedding_sha256:sha(vector_json),in_consumer_cut:true,axes:root.axes};
  const proof_json=canonical(proof);return{root_id:root.root_id,text:fragment.text,vector:root.vector,proof_json,proof_digest:sha(proof_json),vector_json};
 });
 const preps=[...new Set(rows.map(r=>JSON.parse(r.proof_json).embedding_preparation_run_id).filter((v):v is string=>v!==null))].sort(),unknown=rows.filter(r=>JSON.parse(r.proof_json).embedding_preparation_run_id===null).map(r=>r.root_id);
 const context:StudyNumericContextV1={workspace_id,execution_id,source_digest,study_digest:digest(study),cut_digest:digest(study.cut),fit_plan_digest:fit_plan.plan_digest,
  proof_census_digest:digest({execution_id,fit_plan_digest:fit_plan.plan_digest,roots:rows.map(r=>[r.root_id,r.proof_digest]),source_digest,workspace_id}),
  context_digest:digest('native-context'),embedding_config_digest:digest('native-config'),embedding_space_digest,input_revision:1,root_count:count,source_preparation_run_ids:preps,preparation_unknown_root_ids:unknown,sampling_seed:'sealed-synthetic-seed'};
 const lease={workspace_id,execution_id,execution_token:randomUUID(),source_digest,configuration_digest:digest('config'),human_revision_digest:digest('human')},limits:number[]=[];
 const adapter={load:async()=>context,assertCurrent:async()=>{},read:async(args:{after_root_id?:string;limit:number;max_working_bytes:number})=>{
  limits.push(args.limit);let bytes=0;const selected=rows.filter(r=>!args.after_root_id||r.root_id>args.after_root_id).slice(0,args.limit).filter(row=>{bytes+=Buffer.byteLength(JSON.stringify(row))*8;return bytes<=args.max_working_bytes;});
  return{proof_census_digest:context.proof_census_digest,roots:selected,next_root_id:selected.at(-1)?.root_id??null};}};
 return{roots,rows,context,lease,adapter,args:{lease,numeric_plan,fit_plan,signal:new AbortController().signal},limits};
}
test('empty cut writes real input/proof/manifest artifacts and never invokes a numerical fit',async()=>{
 const f=fixture(0),driver=createSignalStudyNumericDriverV1({adapter:f.adapter,process:async()=>{throw Error('no fit for empty');}}),result=await driver(f.args);
 try{const manifest=JSON.parse(result.manifest_json)as StudyNumericManifestV1;assert.equal(manifest.status,'empty');assert.deepEqual(result.value.groups,[]);assert.deepEqual(result.value.unassigned_root_ids,[]);
  assert.equal(manifest.output_manifest_sha256,null);assert.ok(manifest.input_manifest_sha256);assert.equal(sha(result.manifest_json),result.manifest_sha256);
  for(const a of result.artifacts){assert.equal((await stat(a.file)).size,a.size_bytes);assert.equal(sha(await readFile(a.file)),a.sha256);assert.equal('file'in(manifest.artifacts[0]??{}),false);}
 }finally{await result.dispose();}
});
for(const corruption of ['proof_sha','call','raw_sha','vector_sha','model','preparation','zero','nan','dimensions','outside','direction','fragment','truncated']as const)
 test(`numeric source rejects ${corruption} before any process or new provider`,async()=>{
  const f=fixture(3),row=f.rows[0]!,proof=JSON.parse(row.proof_json);
  if(corruption==='proof_sha')row.proof_digest=digest('wrong');
  if(corruption==='call')proof.embedding_call_id=randomUUID();
  if(corruption==='raw_sha')proof.embedding_raw_sha256='missing';
  if(corruption==='vector_sha')row.vector_json='[1]';
  if(corruption==='model')proof.embedding_model='';
  if(corruption==='preparation')proof.embedding_preparation_run_id=randomUUID();
  if(corruption==='zero')row.vector.fill(0);
  if(corruption==='nan')row.vector[2]=NaN;
  if(corruption==='dimensions')row.vector.pop();
  if(corruption==='outside')proof.in_consumer_cut=false;
  if(corruption==='direction')proof.axes.direction='none';
  if(corruption==='fragment')row.text+=' altered';
  if(corruption==='truncated')f.rows.pop();
  if(['call','raw_sha','model','preparation','outside','direction'].includes(corruption)){row.proof_json=canonical(proof);row.proof_digest=sha(row.proof_json);}
  await assert.rejects(createSignalStudyNumericDriverV1({adapter:f.adapter,process:async()=>{throw Error('must validate first');}})(f.args),/study_numeric_/);
 });
test('private artifact custody verifies every file and can recover after local disposal with no paths in native descriptors',async()=>{
 const f=fixture(0),result=await createSignalStudyNumericDriverV1({adapter:f.adapter,process:async()=>{throw Error('empty');}})(f.args),objects=new Map<string,Buffer>();
 const storage:WorkspaceEngineStorageV1={assertReady:async()=>{},put:async a=>{const bytes=await readFile(a.file),storage_key=buildWorkspaceEngineStorageKeyV1(a.workspace_id,a.execution_id,basename(a.file),a.sha256);objects.set(storage_key,bytes);return{storage_key,sha256:a.sha256,size_bytes:a.size_bytes,media_type:a.media_type};},
  get:async a=>{const bytes=objects.get(a.stored.storage_key);assert.ok(bytes);await writeFile(a.destination,bytes);}};
 const bindings=createSignalStudyNumericStorageBindingsV1(storage),writer=bindings.numeric_storage_for_result(f.lease,result),checkpoint_id=randomUUID();
 const descriptors=[];for(const a of result.artifacts){const descriptor={workspace_id:f.lease.workspace_id,execution_id:f.lease.execution_id,checkpoint_id,name:a.name,sha256:a.sha256,size_bytes:a.size_bytes};
  const stored=await writer.store(descriptor);descriptors.push({...descriptor,storage_key:stored.storage_key});}
 await result.dispose();for(const descriptor of descriptors){assert.equal('file'in descriptor,false);assert.equal(await bindings.numeric_storage.verify(descriptor),true);}
 const first=descriptors[0]!;objects.set(first.storage_key,Buffer.from('tampered'));assert.equal(await bindings.numeric_storage.verify(first),false);
});
test('actual Python fits pooled cached vectors from mixed preparation runs and explicit legacy-null lineage',{
 skip:!process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,timeout:180000,
},async()=>{
 const f=fixture(240),result=await createSignalStudyNumericDriverV1({adapter:f.adapter,python:process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,module_root})(f.args);
 try{const m=JSON.parse(result.manifest_json)as StudyNumericManifestV1;assert.equal(m.status,'completed');assert.ok(m.groups.length>=2);assert.equal(m.grouped_count+m.unassigned_count,240);
  assert.equal(m.source_preparation_run_ids.length,2);assert.ok(m.preparation_unknown_root_ids.length>0);assert.equal(m.preparation_unknown_count,m.preparation_unknown_root_ids.length);assert.ok(f.roots.some(r=>r.axes.aggregate==='competitor'));
  assert.equal(new Set(m.groups.flatMap(g=>g.root_ids)).size,m.grouped_count);assert.ok(result.artifacts.some(a=>a.name.startsWith('output/model')));
  const input=result.artifacts.find(a=>a.name==='input/manifest.json')!,manifest=JSON.parse(await readFile(input.file,'utf8'));
  assert.equal(manifest.cached_vector_source.kind,'sealed-study-consumer-cut-v1');assert.equal('embedding_run_id'in manifest,false);assert.equal('preparation_run_id'in manifest,false);
  const proof=result.artifacts.find(a=>a.name==='input/source-proofs.jsonl')!,original=await readFile(proof.file,'utf8'),originalManifest=await readFile(input.file,'utf8');
  const check=()=>promisify(execFile)(process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON!,['-c','import sys;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from signal_semantic_lab.workspace_engine import _load_input;_load_input(Path(sys.argv[2]))',module_root,dirname(input.file)],{maxBuffer:1024*1024});
  await check();for(const tamper of ['proof','vector','prep','ordering','missing','extra']as const){
   const rows=original.trim().split('\n').map(line=>JSON.parse(line));if(tamper==='proof')rows[0].proof_digest=digest('wrong');if(tamper==='vector')rows[0].vector_json='[1]';
   if(tamper==='prep'){const p=JSON.parse(rows[0].proof_json);p.embedding_preparation_run_id=f.lease.execution_id;rows[0].proof_json=canonical(p);rows[0].proof_digest=sha(rows[0].proof_json);}
   if(tamper==='ordering')rows.reverse();if(tamper==='missing')rows.pop();if(tamper==='extra')rows.push(rows[0]);
   const raw=rows.map(r=>JSON.stringify(r)+'\n').join(''),changed=JSON.parse(originalManifest);changed.cached_vector_source.proofs.sha256=sha(raw);changed.cached_vector_source.proofs.rows=rows.length;
   await writeFile(proof.file,raw);await writeFile(input.file,JSON.stringify(changed));await assert.rejects(check());
  }
  await writeFile(proof.file,original);await writeFile(input.file,originalManifest);await check();
 }finally{await result.dispose();}
});
test('small three-root population has a real durable insufficient_population output, not fabricated groups',{
 skip:!process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,timeout:120000,
},async()=>{
 const f=fixture(3),result=await createSignalStudyNumericDriverV1({adapter:f.adapter,python:process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,module_root})(f.args);
 try{const m=JSON.parse(result.manifest_json)as StudyNumericManifestV1;assert.equal(m.status,'insufficient_population');assert.equal(m.unassigned_count,3);assert.deepEqual(m.groups,[]);assert.ok(m.output_manifest_sha256);assert.ok(result.artifacts.some(a=>a.name==='output/manifest.json'));}
 finally{await result.dispose();}
});
