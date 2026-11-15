import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,open,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceMassLabelingConfigV3,type SignalWorkspaceEngineChunkV1} from '@noisia/query-engine';
import {spoolSignalWorkspaceEngineInputV1,hashWorkspaceEngineFileV1} from './signal-workspace-engine-files';
import {runWorkspaceEngineProcessV1,validateWorkspaceEngineOutputV1} from './signal-workspace-engine-process';
import {readWorkspaceEngineInterpretationEvidenceV1} from './signal-workspace-engine-evidence';
import {createListeningDiscoveryNumericStorageV1} from './signal-listening-discovery-numeric-storage';
import type {WorkspaceEngineStorageV1} from './signal-workspace-engine-storage';
import type {StudyRuntimeDriversV1,StudyRuntimeLeaseV1,StudyRuntimeNumericPlanV1,StudyRuntimeNumericComputedV1,StudyRuntimeNumericV1} from './signal-study-runtime';

export type StudyNumericContextV1={workspace_id:string;execution_id:string;study_digest:string;source_digest:string;cut_digest:string;
 fit_plan_digest:string;proof_census_digest:string;context_digest:string;embedding_config_digest:string;embedding_space_digest:string;
 input_revision:number;root_count:number;source_preparation_run_ids:string[];preparation_unknown_root_ids:string[];sampling_seed:string};
export type StudyNumericRowV1={root_id:string;text:string;vector:number[];proof_json:string;proof_digest:string;vector_json:string};
export type StudyNumericAdapterV1={
 /** Resolve native owner and replay the exact fit plan from the frozen cut and
  * committed axes. Header count alone is never proof of membership or rights. */
 load(args:{lease:StudyRuntimeLeaseV1;numeric_plan:StudyRuntimeNumericPlanV1;fit_plan:Parameters<StudyRuntimeDriversV1['fit']>[0]['fit_plan']}):Promise<StudyNumericContextV1|null>;
 /** SQL proof2 is derived AFTER axes: no self-referential hash in Source proof1.
  * The native joins prove root→asset→exact UTF16 fragment→paid raw call/vector,
  * model/config/context/rights and real/nullable embedding preparation lineage.
  * Select IDs/octet lengths BEFORE hydration; never silently omit an oversize root. */
 read(args:{lease:StudyRuntimeLeaseV1;context:StudyNumericContextV1;after_root_id?:string;limit:number;max_working_bytes:number}):Promise<{
  proof_census_digest:string;roots:StudyNumericRowV1[];next_root_id:string|null}>;
 assertCurrent(args:{lease:StudyRuntimeLeaseV1;context:StudyNumericContextV1}):Promise<void>;
};
export type StudyNumericManifestV1={contract_version:'signal-study-numeric-v1';workspace_id:string;execution_id:string;study_digest:string;
 source_digest:string;cut_digest:string;request_sha256:string;fit_plan_digest:string;numeric_config:ReturnType<typeof signalWorkspaceMassLabelingConfigV3>;
 numeric_config_digest:string;seed_digest:string;embedding_space_digest:string;proof_census_digest:string;source_proofs_sha256:string;
 source_preparation_run_ids:string[];preparation_unknown_root_ids:string[];preparation_unknown_count:number;root_count:number;grouped_count:number;unassigned_count:number;
 status:'empty'|'insufficient_population'|'completed';input_manifest_sha256:string;output_manifest_sha256:string|null;
 groups:StudyRuntimeNumericV1['groups'];unassigned_root_ids:string[];
 artifacts:Array<{name:string;sha256:string;size_bytes:number}>};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,hash=/^sha256:[a-f0-9]{64}$/u;
const sha=(text:string)=>'sha256:'+createHash('sha256').update(text).digest('hex');
function fail(code:string):never{throw Error('study_numeric_'+code);}
async function* jsonl(file:string){const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});try{for await(const line of lines)if(line.trim())yield JSON.parse(line)as Record<string,unknown>;}finally{lines.close();}}

/** Free numeric CPU only. No import, Voyage, Sonnet, paid-call markSent or fake
 * HTTP receipt is available. Every output is a private artifact with real SHA.
 * Native persistNumeric stages/readbacks ALL of these files before its intent. */
export function createSignalStudyNumericDriverV1(options:{adapter:StudyNumericAdapterV1;python?:string;module_root?:string;storage_root?:string;
 process?:typeof runWorkspaceEngineProcessV1;max_page_bytes?:number}):StudyRuntimeDriversV1['fit']{
 return async args=>{
  const context=await options.adapter.load(args);if(!context)fail('source_unavailable');
  const {lease,numeric_plan:plan,fit_plan:fit}=args,c=context;
  if(c.workspace_id!==lease.workspace_id||c.execution_id!==lease.execution_id||c.source_digest!==lease.source_digest||plan.source_digest!==c.source_digest
   ||c.study_digest!==fit.study_digest||c.workspace_id!==fit.workspace_id||c.embedding_space_digest!==fit.embedding_space_digest||c.fit_plan_digest!==fit.plan_digest||plan.fit_plan_digest!==fit.plan_digest||sha(plan.request_body)!==plan.request_sha256||plan.request_body!==JSON.stringify(fit)
   ||![c.workspace_id,c.execution_id].every(id=>uuid.test(id))||![c.study_digest,c.source_digest,c.cut_digest,c.fit_plan_digest,c.proof_census_digest,c.embedding_config_digest,c.embedding_space_digest,c.context_digest].every(h=>hash.test(h))
   ||!Number.isSafeInteger(c.root_count)||c.root_count<0||c.root_count!==fit.rows.length||!Number.isSafeInteger(c.input_revision)||c.input_revision<1
   ||!c.sampling_seed||![c.source_preparation_run_ids,c.preparation_unknown_root_ids].every(ids=>Array.isArray(ids)&&ids.every(id=>uuid.test(id))&&new Set(ids).size===ids.length&&[...ids].sort().join(',')===ids.join(',')))fail('context_invalid');
  const config=signalWorkspaceMassLabelingConfigV3(c.root_count);if(digest(config)!==digest(fit.configuration))fail('configuration_changed');
  const budget=options.max_page_bytes??16*1024*1024;if(!Number.isSafeInteger(budget)||budget<8192||budget>32*1024*1024)fail('page_bound_invalid');
  const heartbeat=async()=>{if(args.signal.aborted)fail('stopped');await options.adapter.assertCurrent({lease,context:c});};
  const directory=await mkdtemp(join(options.storage_root??tmpdir(),'noisia-study-numeric-'));
  const proofsPath=join(directory,'source-proofs.jsonl'),proofs=await open(proofsPath,'wx',0o600);
  const artifacts:StudyRuntimeNumericComputedV1['artifacts']=[];
  try{
   let count=0;const preparations=new Set<string>(),unknown:string[]=[],census=createHash('sha256');
   census.update('{"execution_id":'+JSON.stringify(c.execution_id)+',"fit_plan_digest":'+JSON.stringify(c.fit_plan_digest)+',"roots":[');
   for await(const page of pages())for(const row of page){
    const proof=JSON.parse(row.proof_json);if(count)census.update(',');census.update(JSON.stringify([row.root_id,row.proof_digest]));count++;
    if(proof.embedding_preparation_run_id===null)unknown.push(row.root_id);else preparations.add(proof.embedding_preparation_run_id);
    await proofs.writeFile(JSON.stringify({root_id:row.root_id,proof_digest:row.proof_digest,proof_json:row.proof_json,vector_json:row.vector_json})+'\n');
   }
   census.update('],"source_digest":'+JSON.stringify(c.source_digest)+',"workspace_id":'+JSON.stringify(c.workspace_id)+'}');
   if(count!==c.root_count||'sha256:'+census.digest('hex')!==c.proof_census_digest||[...preparations].sort().join(',')!==c.source_preparation_run_ids.join(',')||unknown.join(',')!==c.preparation_unknown_root_ids.join(','))fail('proof_census_invalid');
   await proofs.sync();await proofs.close();const proofsSha=await hashWorkspaceEngineFileV1(proofsPath),inputDirectory=join(directory,'input'),outputDirectory=join(directory,'output');
   const input=await spoolSignalWorkspaceEngineInputV1({storage_root:directory,directory:inputDirectory,source_proofs_path:proofsPath,
    snapshot:{workspace_id:c.workspace_id,input_revision:c.input_revision,embedding_config_digest:c.embedding_config_digest,context_digest:c.context_digest,catalog_digest:c.proof_census_digest,
     chunk_policy_version:'corpus-text-chunks-v1',roots:c.root_count,chunks:c.root_count,guides:0,dimensions:1024,config,
     cached_vector_source:{kind:'sealed-study-consumer-cut-v1',execution_id:c.execution_id,study_digest:c.study_digest,source_digest:c.source_digest,cut_digest:c.cut_digest,
      fit_plan_digest:c.fit_plan_digest,proof_census_digest:c.proof_census_digest,root_count:c.root_count,source_preparation_run_ids:c.source_preparation_run_ids,preparation_unknown_root_ids:c.preparation_unknown_root_ids,
      proofs:{file:'source-proofs.jsonl',sha256:proofsSha,rows:c.root_count}}},
    chunks:(async function*(){for await(const page of pages())yield page.map(row=>{const proof=JSON.parse(row.proof_json);return{root_id:row.root_id,root_fingerprint:row.proof_digest,
     asset_sha256:proof.source_text_sha256,expected_chunks:1,chunk_index:0,start:0,end:row.text.length,chunk_sha256:proof.chunk_sha256,text:row.text,vector:row.vector}as SignalWorkspaceEngineChunkV1;});})(),
    guides:(async function*(){yield[];})()});
   const inputSha=await hashWorkspaceEngineFileV1(join(inputDirectory,'manifest.json'));let outputSha:string|null=null,status:StudyNumericManifestV1['status']='empty';
   const groups:StudyRuntimeNumericV1['groups']=[],unassigned:string[]=[];
   if(c.root_count){
    await heartbeat();await(options.process??runWorkspaceEngineProcessV1)({python:options.python??process.env.NOISIA_WORKSPACE_ENGINE_PYTHON??'/opt/noisia-engine/bin/python',
     module_root:options.module_root??process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT??'/app/tools/signal-semantic-lab/src',storage_root:directory,input_directory:inputDirectory,output_directory:outputDirectory,heartbeat});
    const output=await validateWorkspaceEngineOutputV1({directory:outputDirectory,storage_root:directory,input,input_manifest_sha256:inputSha});
    status=output.status;outputSha=await hashWorkspaceEngineFileV1(join(outputDirectory,'manifest.json'));
    const evidence=await readWorkspaceEngineInterpretationEvidenceV1({input_directory:inputDirectory,output_directory:outputDirectory,output});
    const members=new Map(evidence.map(g=>[g.cluster_id,[]as string[]]));let assigned=0;
    const expectedIds=new Set<string>();for await(const proof of jsonl(proofsPath))expectedIds.add(String(proof.root_id));
    for await(const row of jsonl(join(outputDirectory,'assignments.open.jsonl'))){
     if(!expectedIds.delete(String(row.root_id)))fail('group_coverage_invalid');assigned++;
     if(row.stable_cluster_id===null)unassigned.push(String(row.root_id));else{const ids=members.get('open:'+String(row.stable_cluster_id));if(!ids)fail('group_coverage_invalid');ids.push(String(row.root_id));}
    }
    if(assigned!==c.root_count||expectedIds.size)fail('group_coverage_invalid');
    for(const group of evidence){const ids=members.get(group.cluster_id)!.sort();if(ids.length!==group.root_count||new Set(ids).size!==ids.length)fail('group_coverage_invalid');
     groups.push({key:'motive_'+digest({fit_plan_digest:c.fit_plan_digest,root_ids:ids}).slice(7,63),root_ids:ids});}
    await artifact('output/manifest.json',join(outputDirectory,'manifest.json'));for(const a of output.artifacts)await artifact('output/'+a.file,join(outputDirectory,a.file));
   }
   for(const name of ['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','source-proofs.jsonl'])await artifact('input/'+name,join(inputDirectory,name));
   await artifact('source-proofs.jsonl',proofsPath);
   const value:StudyRuntimeNumericV1={plan_digest:c.fit_plan_digest,groups,unassigned_root_ids:unassigned.sort()};
   const manifest:StudyNumericManifestV1={contract_version:'signal-study-numeric-v1',workspace_id:c.workspace_id,execution_id:c.execution_id,study_digest:c.study_digest,
    source_digest:c.source_digest,cut_digest:c.cut_digest,request_sha256:plan.request_sha256,fit_plan_digest:c.fit_plan_digest,numeric_config:config,numeric_config_digest:digest(config),seed_digest:digest(c.sampling_seed),
    embedding_space_digest:c.embedding_space_digest,proof_census_digest:c.proof_census_digest,source_proofs_sha256:proofsSha,source_preparation_run_ids:c.source_preparation_run_ids,preparation_unknown_root_ids:c.preparation_unknown_root_ids,preparation_unknown_count:c.preparation_unknown_root_ids.length,
    root_count:c.root_count,grouped_count:groups.reduce((n,g)=>n+g.root_ids.length,0),unassigned_count:unassigned.length,status,input_manifest_sha256:inputSha,output_manifest_sha256:outputSha,
    groups,unassigned_root_ids:value.unassigned_root_ids,artifacts:artifacts.map(({name,sha256,size_bytes})=>({name,sha256,size_bytes}))};
   const manifest_json=JSON.stringify(manifest);if(Buffer.byteLength(manifest_json)>32*1024*1024)fail('manifest_capacity_exceeded');
   const file=await open(join(directory,'numeric-manifest.json'),'wx',0o600);try{await file.writeFile(manifest_json);await file.sync();}finally{await file.close();}
   await artifact('numeric-manifest.json',join(directory,'numeric-manifest.json'));
   return{value,manifest_json,manifest_sha256:sha(manifest_json),artifacts,dispose:()=>rm(directory,{recursive:true,force:true})};
  }catch(error){await proofs.close().catch(()=>undefined);await rm(directory,{recursive:true,force:true});throw error;}
  async function artifact(name:string,file:string){artifacts.push({name,file,sha256:await hashWorkspaceEngineFileV1(file),size_bytes:(await stat(file)).size});}
  async function* pages(){let cursor:string|undefined,count=0;
   for(;;){await heartbeat();const page=await options.adapter.read({lease,context:c,after_root_id:cursor,limit:1024,max_working_bytes:budget});
    if(page.proof_census_digest!==c.proof_census_digest||page.roots.length>1024||Buffer.byteLength(JSON.stringify(page.roots))*8>budget)fail('page_bound_or_source_changed');
    for(const row of page.roots){
     if(!uuid.test(row.root_id)||cursor&&row.root_id<=cursor||sha(row.proof_json)!==row.proof_digest||!hash.test(row.proof_digest)||!row.text||row.text.length>1400)fail('proof_invalid');
     const proof=JSON.parse(row.proof_json),fragment=proof.selected_fragment;
     if(proof.contract_version!=='signal-study-cached-vector-proof-v1'||proof.workspace_id!==c.workspace_id||proof.execution_id!==c.execution_id||proof.root_id!==row.root_id
      ||['study_digest','source_digest','cut_digest','fit_plan_digest'].some(k=>proof[k]!==c[k as keyof StudyNumericContextV1])||proof.in_consumer_cut!==true
      ||!['trigger','barrier','mixed'].includes(proof.axes?.direction)||proof.axes?.use!=='literal'||!['subject','competitor','alternative'].includes(proof.axes?.aggregate)
      ||sha(row.text)!==proof.source_text_sha256||proof.chunk_sha256!==proof.source_text_sha256||proof.embedding_chunk_sha256!==proof.chunk_sha256
      ||!fragment||fragment.text_sha256!==sha(row.text)||!Number.isSafeInteger(fragment.start)||fragment.start<0||!Number.isSafeInteger(fragment.end)||fragment.end-fragment.start!==row.text.length
      ||!Number.isSafeInteger(proof.embedding_response_index)||proof.embedding_response_index<0||typeof proof.embedding_model!=='string'||!proof.embedding_model.trim()||typeof proof.embedding_input_contract!=='string'||!proof.embedding_input_contract.trim()
      ||proof.embedding_config_digest!==c.embedding_config_digest||proof.context_digest!==c.context_digest
      ||!['input_digest','original_source_text_sha256','embedding_raw_sha256','embedding_request_digest','embedding_batch_digest','embedding_config_digest','context_digest'].every(k=>hash.test(proof[k])))fail('lineage_invalid');
     if(![proof.embedding_call_id,proof.embedding_run_id].every(id=>uuid.test(id))||proof.embedding_preparation_run_id!==null&&!uuid.test(proof.embedding_preparation_run_id)
      ||sha(row.vector_json)!==proof.embedding_sha256||JSON.stringify(JSON.parse(row.vector_json))!==JSON.stringify(row.vector)||row.vector.length!==1024
      ||row.vector.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...row.vector)-1)>1e-4)fail('cached_vector_invalid');
     cursor=row.root_id;if(++count>c.root_count)fail('proof_census_invalid');
    }
    if(page.next_root_id!==(page.roots.at(-1)?.root_id??null))fail('cursor_invalid');if(!page.roots.length){if(count!==c.root_count)fail('proof_census_invalid');break;}yield page.roots;
   }
  }
 };
}

/** Generic H3 private multipart custody is reused, but owner/source/manifest
 * remain Study-native. Local paths never enter the native journal or manifest. */
export function createSignalStudyNumericStorageBindingsV1(storage:WorkspaceEngineStorageV1){
 return{numeric_storage:createListeningDiscoveryNumericStorageV1({storage}),numeric_storage_for_result:(lease:StudyRuntimeLeaseV1,result:StudyRuntimeNumericComputedV1)=>{
  const m=JSON.parse(result.manifest_json);if(sha(result.manifest_json)!==result.manifest_sha256||m.workspace_id!==lease.workspace_id||m.execution_id!==lease.execution_id||m.source_digest!==lease.source_digest)fail('artifact_scope_invalid');
  return createListeningDiscoveryNumericStorageV1({storage,scope:{workspace_id:lease.workspace_id,execution_id:lease.execution_id},artifacts:result.artifacts});
 }};
}
