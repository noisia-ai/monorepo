import assert from'node:assert/strict';
import test from'node:test';
import{randomUUID,createHash}from'node:crypto';
import{readFile,writeFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import type{ListeningDiscoveryGenerationV1}from'@noisia/db';
import{regroupSignalListeningOrphansV1,type ListeningOrphanPageV1}from'./signal-listening-orphan-regroup';
const hash=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']'
 :'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const id=(n:number)=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
const module_root=fileURLToPath(new URL('../../../../tools/signal-semantic-lab/src',import.meta.url));
function fixture(n:number,uncached=0){
 const workspace_id=randomUUID(),generation_id=randomUUID(),subset_id=randomUUID(),requests:number[]=[],sourceRuns=new Map<string,string>();
 const rows:ListeningOrphanPageV1['roots']=Array.from({length:n},(_,i)=>{
  const text=i<n/2?'Coffee plantation aroma espresso morning breakfast '+i:'Bicycle wheels pedals mountain cycling repair '+i;
  const v:number[]=Array.from({length:1024},(_,j)=>j===(i<n/2?0:1)?1:j===2+i%1022?.01:0),norm=Math.sqrt(v.reduce((s,x)=>s+x*x,0));
  const vector=i<n-uncached?v.map(x=>x/norm):null,vector_json=vector?JSON.stringify(vector):null,call=vector?id(10000+i):null;
  if(call)sourceRuns.set(call,i%2?id(90001):id(90002));
  const proof={input_digest:digest('input'+i),source_text_sha256:hash(text),chunk_sha256:hash(text),embedding_call_id:call,
   embedding_sha256:vector_json?hash(vector_json):null,in_category:true,pending_base:false,evaluations:[]};
  const proof_json=canonical(proof);return{root_id:id(100+i),text,proof,proof_json,proof_digest:hash(proof_json),vector,vector_json};
 });
 const subset={id:subset_id,workspace_id,generation_id,root_count:n,cached_count:n-uncached,
  subset_digest:digest({workspace_id,generation_id,roots:rows.map(r=>[r.root_id,r.proof_digest])})};
 const generation={id:generation_id,workspace_id,configuration_id:randomUUID(),map_id:randomUUID(),preparation_run_id:randomUUID(),input_revision:'1',
  embedding_config_digest:digest('voyage1024'),entity_context_digest:digest('context'),configuration_digest:digest('configuration'),round:1,kind:'confirmed_members',
  source_generation_id:randomUUID(),status:'ready',counts:{roots:n},snapshot_digest:digest('generation')}as ListeningDiscoveryGenerationV1;
 const access={database:{}as never,workspace_id,actor_user_id:randomUUID()};
 const read=async(args:{after_root_id?:string;limit?:number})=>{requests.push(args.limit!);const selected=rows.filter(row=>!args.after_root_id||row.root_id>args.after_root_id).slice(0,args.limit);
  return{generation,subset,roots:selected,next_root_id:selected.at(-1)?.root_id??null};};
 return{access,generation,subset,read,rows,requests,sourceRuns};
}

test('zero or entirely uncached orphans have an exact census and no fabricated group or numerical call',async()=>{
 for(const[n,uncached]of[[0,0],[3,3]]){const f=fixture(n!,uncached!);const result=await regroupSignalListeningOrphansV1({...f,process:async()=>{throw Error('no numeric call');}});
  try{assert.equal(result.manifest.status,n?'no_cached_vectors':'empty');assert.equal(result.manifest.root_count,n);assert.equal(result.manifest.unclustered_count,n);
   assert.deepEqual(result.manifest.groups,[]);assert.ok(f.requests.every(limit=>limit<=1024));assert.equal(hash(result.manifest_json),result.manifest_sha256);
  }finally{await result.dispose();}
 }
});
for(const broken of ['text_sha','invented_call','proof_sha','vector_sha','zero','nan','dimensions','out_of_category','non_orphan','truncated']as const)
 test(`orphan spool rejects ${broken} before any numerical process`,async()=>{
  const f=fixture(2);const row=f.rows[0]!;
  if(broken==='text_sha')row.text+=' changed';
  if(broken==='invented_call')row.proof.embedding_call_id=randomUUID();
  if(broken==='proof_sha')row.proof_digest=digest('invented');
  if(broken==='vector_sha')row.vector_json='[1]';
  if(broken==='zero')row.vector!.fill(0);
  if(broken==='nan')row.vector![3]=NaN;
  if(broken==='dimensions')row.vector!.pop();
  if(broken==='out_of_category')row.proof.in_category=false;
  if(broken==='non_orphan')row.proof.evaluations=[{question_key:'topic',probability:.9}];
  if(broken==='truncated')f.rows.pop();
  await assert.rejects(regroupSignalListeningOrphansV1({...f,process:async()=>{throw Error('must reject source first');}}),/listening_orphan_/);
 });

test('cached-source wire fits actual BERTopic once over mixed-run synthetic vectors without a fabricated embedding owner',{
 skip:!process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,timeout:180000,
},async()=>{
 const f=fixture(240);assert.equal(new Set(f.sourceRuns.values()).size,2);
 const result=await regroupSignalListeningOrphansV1({...f,python:process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,module_root});
 try{
  assert.equal(result.manifest.status,'completed');assert.equal(result.manifest.cached_count,240);assert.ok(result.manifest.groups.length>=2);
  assert.equal(result.manifest.grouped_count+result.manifest.unclustered_count,240);
  const seen=new Set<string>();for(const group of result.manifest.groups){assert.equal(group.root_ids.length,group.root_count);assert.ok(group.root_count>=40);
   for(const root of group.root_ids){assert.ok(f.rows.some(row=>row.root_id===root));assert.equal(seen.has(root),false);seen.add(root);}
   assert.ok(group.representative_root_ids.every(id=>group.root_ids.includes(id)));assert.equal(result.manifest.group_digests[group.group_key],digest({subset_id:f.subset.id,root_ids:group.root_ids}));}
  const input=result.artifacts.find(a=>a.name==='input/manifest.json')!,manifest=JSON.parse(await readFile(input.file,'utf8'));
  assert.equal('embedding_run_id'in manifest,false);assert.equal(manifest.cached_vector_source.kind,'sealed-listening-orphan-subset-v1');
  const proof=result.artifacts.find(a=>a.name==='input/source-proofs.jsonl')!,original=await readFile(proof.file,'utf8'),originalManifest=await readFile(input.file,'utf8');
  const python=process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON!,directory=fileURLToPath(new URL('.',`file://${input.file}`));
  const check=()=>promisify(execFile)(python,['-c','import sys;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from signal_semantic_lab.workspace_engine import _load_input;_load_input(Path(sys.argv[2]))',module_root,directory],{maxBuffer:1024*1024});
  await check();
  for(const mutation of ['proof_digest','call','vector','ordering','missing','extra','truncated']as const){
   const rows=original.trim().split('\n').map(line=>JSON.parse(line));
   if(mutation==='proof_digest')rows[0].proof_digest=digest('altered');
   if(mutation==='call'){const p=JSON.parse(rows[0].proof_json);p.embedding_call_id=randomUUID();rows[0].proof_json=canonical(p);rows[0].proof_digest=hash(rows[0].proof_json);}
   if(mutation==='vector')rows[0].vector_json=JSON.stringify(Array(1024).fill(0));
   if(mutation==='ordering')rows.reverse();if(mutation==='missing')rows.shift();if(mutation==='extra')rows.push(rows[0]);
   const tampered=mutation==='truncated'?original.slice(0,-19):rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
   await writeFile(proof.file,tampered);const changed=JSON.parse(originalManifest);changed.cached_vector_source.proofs.sha256=hash(tampered);
   await writeFile(input.file,JSON.stringify(changed));await assert.rejects(check(),new RegExp('workspace_engine_|WorkspaceEngineError|json'),mutation);
  }
 }finally{await result.dispose();}
});
test('actual Python reports a small orphan population without inventing a topic',{
 skip:!process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,timeout:120000,
},async()=>{
 const f=fixture(3),result=await regroupSignalListeningOrphansV1({...f,python:process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,module_root});
 try{assert.equal(result.manifest.status,'insufficient_population');assert.equal(result.manifest.grouped_count,0);assert.equal(result.manifest.unclustered_count,3);assert.deepEqual(result.manifest.groups,[]);}
 finally{await result.dispose();}
});

test('the unchanged legacy guided numeric wire still fits both lanes without cached-source fields',{
 skip:!process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON,timeout:180000,
},async()=>{
 const{mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const{spoolSignalWorkspaceEngineInputV1,hashWorkspaceEngineFileV1}=await import('./signal-workspace-engine-files');
 const{runWorkspaceEngineProcessV1,validateWorkspaceEngineOutputV1}=await import('./signal-workspace-engine-process');
 const{SIGNAL_WORKSPACE_ENGINE_CONFIG_V1}=await import('@noisia/query-engine');
 const f=fixture(240),directory=await mkdtemp(join(tmpdir(),'noisia-legacy-guided-'));
 try{
  const input=await spoolSignalWorkspaceEngineInputV1({storage_root:directory,directory:join(directory,'input'),
   snapshot:{workspace_id:f.access.workspace_id,input_revision:1,preparation_run_id:f.generation.preparation_run_id,embedding_run_id:randomUUID(),
    embedding_config_digest:f.generation.embedding_config_digest,context_digest:f.generation.entity_context_digest,catalog_digest:digest('legacy-catalog'),
    chunk_policy_version:'corpus-text-chunks-v1',roots:240,chunks:240,guides:1,dimensions:1024,config:{...SIGNAL_WORKSPACE_ENGINE_CONFIG_V1}},
   chunks:(async function*(){yield f.rows.map(row=>({root_id:row.root_id,root_fingerprint:row.proof_digest,asset_sha256:hash(row.text),expected_chunks:1,
    chunk_index:0,start:0,end:row.text.length,chunk_sha256:hash(row.text),text:row.text,vector:row.vector!}));})(),
   guides:(async function*(){yield[{guide_key:'category',role:'scope_positive' as const,input_digest:digest('guide'),vector:Array.from({length:1024},(_,i)=>i===0?1:0)}];})()});
  assert.equal('cached_vector_source'in input,false);assert.ok(input.embedding_run_id);
  await runWorkspaceEngineProcessV1({python:process.env.NOISIA_WORKSPACE_ENGINE_TEST_PYTHON!,module_root,storage_root:directory,
   input_directory:join(directory,'input'),output_directory:join(directory,'output')});
  const output=await validateWorkspaceEngineOutputV1({directory:join(directory,'output'),storage_root:directory,input,
   input_manifest_sha256:await hashWorkspaceEngineFileV1(join(directory,'input','manifest.json'))});
  assert.deepEqual(output.lanes.map(lane=>lane.lane),['open','guided']);assert.equal(output.status,'completed');
  assert.equal('cached_vector_source'in output.input_identity,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('a verified human removal can orphan a raw positive or unasked topic without inventing a probability',async()=>{
 for(const probability of [.9,null]){
  const f=fixture(1,1),row=f.rows[0]!;
  row.proof.evaluations=[{question_key:'topic',probability,human_belongs:false,human_decision_id:randomUUID()}];
  row.proof_json=canonical(row.proof);row.proof_digest=hash(row.proof_json);
  f.subset.subset_digest=digest({workspace_id:f.access.workspace_id,generation_id:f.generation.id,roots:f.rows.map(r=>[r.root_id,r.proof_digest])});
  const result=await regroupSignalListeningOrphansV1({...f,process:async()=>{throw Error('uncached roots require no numerical call');}});
  try{assert.equal(result.manifest.status,'no_cached_vectors');assert.equal(result.manifest.root_count,1);}
  finally{await result.dispose();}
 }
});
for(const invalid of [{probability:.1,human_belongs:true,human_decision_id:randomUUID()},
 {probability:null,human_belongs:false},{probability:NaN,human_belongs:false,human_decision_id:randomUUID()}])
 test('manual orphan proof still requires a false decision, valid decision identity and original finite probability',async()=>{
  const f=fixture(1,1),row=f.rows[0]!;row.proof.evaluations=[{question_key:'topic',...invalid}];
  row.proof_json=canonical(row.proof);row.proof_digest=hash(row.proof_json);
  await assert.rejects(regroupSignalListeningOrphansV1({...f,process:async()=>{throw Error('invalid proof must fail before numerical work');}}),/listening_orphan_/);
 });
