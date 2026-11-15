import assert from 'node:assert/strict';
import {provisionSyntheticListeningStudyPolicyV1} from './signal-listening-study-policy.synthetic.fixture';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,signalWorkspaceMassLabelingConfigV3,
 type SignalListeningConfigurationV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1,loadSignalListeningConfigurationWithClientV1,type SignalListeningAccessV1} from '../signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import {bootstrapSignalListeningDiscoveryV1,proposeSignalListeningDiscoveryBootstrapV1,refreshSignalListeningDiscoveryV1,readSignalListeningDiscoveryOrphanSubsetV1} from '../signal-listening-discovery';
import * as money from '../signal-listening-discovery-money';
import type {ListeningDiscoveryAdvanceSubsetV1,ListeningDiscoveryNumericInputV1,ListeningDiscoveryNumericStorageV1,ListeningDiscoveryNumericArtifactDescriptorV1} from '../signal-listening-discovery-advance';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
const sha=(raw:string|Buffer)=>'sha256:'+createHash('sha256').update(raw).digest('hex');
type FixtureOptions={population_count?:number;study_author_metadata?:boolean;study_text_length?:number;initial_approved?:number;no_category?:boolean;cap_micro_usd?:number;org_race?:boolean;additional_defined_topic?:boolean};
export async function withDiscoveryAdvanceFixtureV1(fn:(f:Awaited<ReturnType<typeof seed>>)=>Promise<void>,options:FixtureOptions={}){
 await runMassLabelingAcceptanceFixtureV1('product',{population_count:options.population_count,study_author_metadata:options.study_author_metadata,study_text_length:options.study_text_length,beforeProcessing:async ctx=>{
  const files=await mkdtemp(join(tmpdir(),'r16-discovery-advance-'));
  try{await fn(await seed(ctx,files,options));}finally{await rm(files,{recursive:true,force:true});}
 }});
}
type FixtureContext={database:SignalListeningAccessV1['database'];workspace_id:string;actor_user_id:string;map_id:string;run_id:string};
async function seed(ctx:FixtureContext,files:string,options:FixtureOptions){
 const db=ctx.database,access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
 await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
 const base=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
 const proposal=await proposeSignalListeningDiscoveryBootstrapV1({...access,configuration_id:base.id,map_id:ctx.map_id});
 if(options.additional_defined_topic){const source=proposal.configuration.questions.find(q=>q.topic_source==='discovered');assert.ok(source);
  const key='additional_defined_topic';proposal.configuration.questions.push({...source,key,topic_source:'defined',human_locked:false});}
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:base.revision,provenance:'agent',source_digest:proposal.source_digest,configuration:proposal.configuration});
 const initial=await bootstrapSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,bindings:proposal.bindings});
 const roots=(await db.query<{root_id:string}>('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[ctx.workspace_id,ctx.map_id])).rows.map(r=>r.root_id);
 const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
  store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{await durable(join(files,a.raw_sha256.slice(7)),Buffer.from(a.raw_text));return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},
  load:async(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
 const labeling=createSignalListeningStoreV1({database:db,rawPages,page_size:200,storeRaw:async()=>{throw Error('no individual provider/raw writes');}});
 async function classify(run_id:string,configuration:SignalListeningConfigurationV1,approved=3,noCategory=false){
  const run=await labeling.claim(run_id);assert.ok(run);
  for(;;){const inputs=await labeling.inputs(run);if(!inputs.length)break;
   const proposals=inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
    return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:1000};});
   const calls=await labeling.reserve(run,proposals);await labeling.markSubmitting(run,calls);
   const responses=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,configuration),choice=noCategory?'brand_official':'individual';
    const response={model:configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
     ?{type:'noul' as const,noul:key==='promotion'?.1:roots.indexOf(input.root_id)<approved?.9:.1}
     :{type:'choice' as const,choice,confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
    return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),result:mapSignalListeningJevResponseV1(input,run.context,configuration,response)};});
   await labeling.persistRawPage(run,responses);await labeling.settlePage(run,responses.map(p=>({call:p.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));
   await labeling.apply(run,responses.map(p=>({call:p.call,results:[p.result]})));
  }
  assert.equal(await labeling.finish(run),'completed');await labeling.release(run);
 }
 const first=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
 await classify(first.run_id,cfg.configuration,options.initial_approved??3,options.no_category);
 const confirmed=await refreshSignalListeningDiscoveryV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,round:1,source_generation_id:initial.id});
 assert.equal(confirmed.kind,'confirmed_members');assert.equal(confirmed.round,1);
 const prior=(await db.query('SELECT p.* FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status=\'active\'',[ctx.workspace_id])).rows[0];
 const quote=options.org_race?await money.quoteSignalListeningDiscoveryRoundV1({...access,generation_id:confirmed.id,ordinal:1,orphan_groups:[]}):null;
 const exposure=options.org_race?Number((await db.query("SELECT total_micro_usd::text value FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)",[prior.organization_id,prior.budget_timezone])).rows[0].value):0;
 const basePolicy=(await db.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
  SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,COALESCE($2::bigint,daily_cap_micro_usd),created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[prior.id,quote?exposure+quote.reservation_micro_usd+19:null])).rows[0];
 await db.query("INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND(NOT $3::boolean OR action<>'mention_facets')",[prior.id,basePolicy.id,options.org_race===true]);
 if(options.org_race)await db.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
  SELECT $1,'mention_facets','provider','typesafe','jev-1.13.0',c,signal_labeling_digest_v1(c),1000000,false FROM(SELECT '{"contract_version":"mention-facets-jev-v1"}'::jsonb c)x`,[basePolicy.id]);
 await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[prior.id]);await db.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[basePolicy.id]);
 const scopedParentCap=quote?quote.reservation_micro_usd+18:4000000;
 const policy=await provisionSyntheticListeningStudyPolicyV1(access,{discovery_cap_micro_usd:scopedParentCap,study_cap_micro_usd:quote?1:4000001,retry_headroom_micro_usd:quote?0:100000});
 const execution=await money.startSignalListeningDiscoveryExecutionV1({...access,generation_id:confirmed.id,classification_run_id:first.run_id,cap_micro_usd:options.cap_micro_usd??scopedParentCap,idempotency_key:randomUUID()});
 const artifacts=new Map<string,Buffer>(),remote=new Map<string,string>();let uploads=0,allowUploads=true;
 let afterPut:((d:ListeningDiscoveryNumericArtifactDescriptorV1)=>Promise<void>)|undefined;
 const storage:ListeningDiscoveryNumericStorageV1={reference(d){assert.equal(d.workspace_id,ctx.workspace_id);assert.equal(d.execution_id,execution.id);
   return{storage_key:`workspace-engine/${d.workspace_id}/${d.checkpoint_id}/${basename(d.name)}.${d.sha256.slice(7)}.parts.json`};},
  async verify(d){try{const file=remote.get(d.storage_key);if(!file)return false;const bytes=await readFile(file);return bytes.length===d.size_bytes&&sha(bytes)===d.sha256;}catch{return false;}},
  async store(d){assert.equal(allowUploads,true,'an existing intent must never upload/refit');const body=artifacts.get(d.name);assert.ok(body);assert.equal(body.length,d.size_bytes);assert.equal(sha(body),d.sha256);
   const key=storage.reference(d).storage_key,file=join(files,'blob-'+sha(key).slice(7));await durable(file,body);remote.set(key,file);uploads++;await afterPut?.(d);
   return{storage_key:key,sha256:d.sha256,size_bytes:d.size_bytes,verified:true};}};
 async function numericReceipt(subset:ListeningDiscoveryAdvanceSubsetV1){
  const page=await readSignalListeningDiscoveryOrphanSubsetV1({...access,subset_id:subset.id,limit:1024});assert.equal(page.roots.length,subset.root_count);
  const rows=page.roots,config=signalWorkspaceMassLabelingConfigV3(subset.cached_count);assert.ok(subset.cached_count<config.hdbscan_min_cluster_size,'the synthetic receipt is an honest insufficient-population short circuit, never a fitted model');
  const proofs=rows.map(row=>JSON.stringify({root_id:row.root_id,proof_digest:row.proof_digest,proof_json:row.proof_json,vector_json:row.vector_json})+'\n').join('');
  artifacts.clear();artifacts.set('source-proofs.jsonl',Buffer.from(proofs));let inputSha:string|null=null,outputSha:string|null=null;
  if(subset.cached_count){const selected=rows.filter(row=>row.vector!==null),g=page.generation;
   const records=selected.map((row,ordinal)=>JSON.stringify({ordinal,root_id:row.root_id,root_fingerprint:row.proof_digest,asset_sha256:row.proof.source_text_sha256,
    expected_chunks:1,chunk_index:0,start:0,end:row.text.length,chunk_sha256:row.proof.chunk_sha256,text:row.text})+'\n').join('');
   artifacts.set('input/chunks.jsonl',Buffer.from(records));artifacts.set('input/vectors.npy',npy(selected.map(row=>row.vector!)));artifacts.set('input/guides.jsonl',Buffer.alloc(0));artifacts.set('input/guide-vectors.npy',npy([]));artifacts.set('input/source-proofs.jsonl',Buffer.from(proofs));
   const input={contract_version:'workspace-topic-engine-input-v1',workspace_id:ctx.workspace_id,input_revision:Number(g.input_revision),preparation_run_id:g.preparation_run_id,
    embedding_config_digest:g.embedding_config_digest,context_digest:g.entity_context_digest,catalog_digest:subset.subset_digest,chunk_policy_version:'corpus-text-chunks-v1',config,
    cached_vector_source:{kind:'sealed-listening-orphan-subset-v1',generation_id:g.id,generation_digest:g.snapshot_digest,subset_id:subset.id,subset_digest:subset.subset_digest,root_count:subset.root_count,cached_count:subset.cached_count,proofs:{file:'source-proofs.jsonl',sha256:sha(proofs),rows:subset.root_count}},
    records:{file:'chunks.jsonl',sha256:sha(records),rows:selected.length,roots:selected.length},vectors:{file:'vectors.npy',sha256:sha(artifacts.get('input/vectors.npy')!),rows:selected.length,dimensions:1024,dtype:'float32'},
    guides:{file:'guides.jsonl',sha256:sha(''),rows:0},guide_vectors:{file:'guide-vectors.npy',sha256:sha(artifacts.get('input/guide-vectors.npy')!),rows:0,dimensions:1024,dtype:'float32'}};
   const inputRaw=JSON.stringify(input)+'\n';artifacts.set('input/manifest.json',Buffer.from(inputRaw));inputSha=sha(inputRaw);
   artifacts.set('output/assignments.open.jsonl',Buffer.from(selected.map(row=>JSON.stringify({root_id:row.root_id,chunk_index:0,stable_cluster_id:null})+'\n').join('')));
   artifacts.set('output/clusters.open.jsonl',Buffer.alloc(0));artifacts.set('output/roots.jsonl',Buffer.from(selected.map(row=>JSON.stringify({root_id:row.root_id})+'\n').join('')));artifacts.set('output/lineage.json',Buffer.from('[]\n'));
   const fitRoots=selected.map((row,ordinal)=>JSON.stringify({root_id:row.root_id,ordinal})+'\n').join('');artifacts.set('output/fit-roots.jsonl',Buffer.from(fitRoots));
   artifacts.set('output/fit-population.json',Buffer.from(JSON.stringify({contract_version:'canonical-root-centroid-v1',rows:selected.length,dimensions:1024,dtype:'little-endian-float32',source_records_sha256:input.records.sha256,source_vectors_sha256:input.vectors.sha256,roots_sha256:sha(fitRoots),vectors_sha256:sha(artifacts.get('input/vectors.npy')!)})+'\n'));
   const output={contract_version:'workspace-topic-engine-output-v1',workspace_id:ctx.workspace_id,input_manifest_sha256:inputSha,previous_manifest_sha256:null,
    input_identity:{embedding_config_digest:g.embedding_config_digest,context_digest:g.entity_context_digest,catalog_digest:subset.subset_digest,chunk_policy_version:'corpus-text-chunks-v1'},config,
    versions:{fixture:'native-subset-below-fit-minimum'},status:'insufficient_population',counts:{occurrences:selected.length,roots:selected.length,guides:0,common_unchanged_roots:0},
    lanes:[{lane:'open',model_file:null,assignments_file:'assignments.open.jsonl',clusters_file:'clusters.open.jsonl',occurrences:selected.length,roots:selected.length,clusters:0,fit_unit:'canonical-root-centroid-v1',fit_rows:selected.length}],
    artifacts:[...artifacts].filter(([name])=>name.startsWith('output/')).map(([name,bytes])=>({file:name.slice(7),sha256:sha(bytes),bytes:bytes.length})),quality:'uncalibrated',approval_policy:'none'};
   const outputRaw=JSON.stringify(output)+'\n';artifacts.set('output/manifest.json',Buffer.from(outputRaw));outputSha=sha(outputRaw);
  }
  const manifest={contract_version:'listening-orphan-numeric-v1',workspace_id:ctx.workspace_id,generation_id:subset.generation_id,generation_digest:page.generation.snapshot_digest,
   subset_id:subset.id,subset_digest:subset.subset_digest,source_proofs_sha256:sha(proofs),root_count:subset.root_count,cached_count:subset.cached_count,uncached_count:subset.root_count-subset.cached_count,grouped_count:0,unclustered_count:subset.root_count,
   status:subset.cached_count?'insufficient_population':subset.root_count?'no_cached_vectors':'empty',numeric_config:config,numeric_config_digest:digest(config),input_manifest_sha256:inputSha,output_manifest_sha256:outputSha,groups:[],group_digests:{}};
  const manifest_json=JSON.stringify(manifest);artifacts.set('numeric-manifest.json',Buffer.from(manifest_json));
  return{manifest_json,manifest_sha256:sha(manifest_json),artifacts:[...artifacts].map(([name,bytes])=>({name,sha256:sha(bytes),size_bytes:bytes.length}))};
 }
 async function emptyNumeric(subset:ListeningDiscoveryAdvanceSubsetV1){assert.equal(subset.root_count,0);return numericReceipt(subset);}
 async function prepareRoundChild(round:money.ListeningDiscoveryRoundV1){
  const lease=await money.claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(lease);
  const call=await money.reserveSignalListeningDiscoveryCallV1({database:db,lease,provider_available:true});assert.equal(await money.markSignalListeningDiscoveryCallSentV1({database:db,lease,call_id:call.id,attempt_token:call.attempt_token,provider_available:true}),true);
  const current=(await db.query<{configuration:SignalListeningConfigurationV1}>('SELECT configuration FROM signal_listening_configurations WHERE workspace_id=$1 AND id=$2',[ctx.workspace_id,round.configuration_id])).rows[0]!.configuration;
  const output={contract_version:'listening-discovery-editorial-output-v1',retained_topic_keys:[],themes:[{key:'everyday',name:'Everyday',original_language:'en',original_name:'Everyday',en_name:'Everyday',es_name:'Cotidiano'}],
   topics:current.questions.filter(q=>q.topic_source==='discovered').map(q=>{assert.equal(q.type,'noul');if(q.type!=='noul')throw Error('fixture question');return{key:q.key,source_topic_keys:[q.key],orphan_group_keys:[],question:q.text,positive:q.positive+' Refined '+round.ordinal+'.',negative:q.negative,domain:'category',theme_key:'everyday',original_language:'en',original:{name:q.key,definition:q.positive},en:{name:q.key,definition:q.positive},es:{name:q.key,definition:q.positive}};})};
  const raw=JSON.stringify({http_status:200,body:JSON.stringify({model:'claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20},stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]})});
  const rawStore:money.ListeningDiscoveryRawStoreV1={reference(a){return{storage_key:`workspace-engine/${a.workspace_id}/${a.round_id}/${a.name}`};},
   async store(a){await durable(join(files,'review-'+a.raw_sha256.slice(7)),Buffer.from(a.raw_text));return{storage_key:rawStore.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},
   async load(a){return readFile(join(files,'review-'+a.sha256.slice(7)),'utf8');}};
  await money.persistSignalListeningDiscoveryRawV1({database:db,call_id:call.id,attempt_token:call.attempt_token,raw_text:raw,raw_store:rawStore});await money.settleSignalListeningDiscoveryCallV1({database:db,call_id:call.id,attempt_token:call.attempt_token});
  const applied=await money.applySignalListeningDiscoveryReviewV1({...access,round_id:round.id});assert.equal(applied.status,'classifying');
  const child=await money.prepareSignalListeningDiscoveryChildV1({...access,round_id:round.id,provider_available:true});assert.ok(child.listening_run_id);
  const next=(await db.query<{configuration:SignalListeningConfigurationV1}>('SELECT configuration FROM signal_listening_configurations WHERE id=$1',[applied.configuration_id])).rows[0]!.configuration;
  return{run_id:child.listening_run_id,configuration:next};
 }
 async function finishRound(round:money.ListeningDiscoveryRoundV1,approved=3,
  beforeChild?:(run_id:string,configuration:SignalListeningConfigurationV1)=>Promise<void>){
  const child=await prepareRoundChild(round);
  await beforeChild?.(child.run_id,child.configuration);
  await classify(child.run_id,child.configuration,approved);return money.completeSignalListeningDiscoveryRoundV1({...access,round_id:round.id});
 }
 return{...access,map_id:ctx.map_id,cfg,confirmed,execution,policy,files,roots,storage,artifacts,remote,emptyNumeric,numericReceipt,prepareRoundChild,finishRound,
  uploads:()=>uploads,setAllowUploads:(value:boolean)=>{allowUploads=value;},afterPut:(fn:typeof afterPut)=>{afterPut=fn;}};
}
async function durable(file:string,body:Buffer){await writeFile(file,body);const handle=await open(file,'r+');try{await handle.sync();}finally{await handle.close();}assert.equal(sha(await readFile(file)),sha(body));}
function npy(rows:number[][]){const dictionary=`{'descr': '<f4', 'fortran_order': False, 'shape': (${rows.length}, 1024), }`,padding=(64-((10+Buffer.byteLength(dictionary)+1)%64))%64;
 const header=Buffer.from(dictionary+' '.repeat(padding)+'\n','ascii'),prefix=Buffer.from([0x93,0x4e,0x55,0x4d,0x50,0x59,1,0,0,0]);prefix.writeUInt16LE(header.length,8);
 const values=Buffer.alloc(rows.length*1024*4);for(let i=0;i<rows.length;i++)for(let j=0;j<1024;j++)values.writeFloatLE(Math.fround(rows[i]![j]!),4*(i*1024+j));return Buffer.concat([prefix,header,values]);}
