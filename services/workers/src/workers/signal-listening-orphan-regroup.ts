import {createHash}from'node:crypto';
import {createReadStream}from'node:fs';
import {mkdtemp,open,stat,rm}from'node:fs/promises';
import {tmpdir}from'node:os';
import {join}from'node:path';
import {createInterface}from'node:readline';
import type{SignalListeningAccessV1,ListeningDiscoveryGenerationV1,ListeningDiscoveryOrphanManifestV1}from'@noisia/db';
import {signalWorkspaceMassLabelingConfigV3,signalWorkspaceEmbeddingDigestV1 as digest,type SignalWorkspaceEngineChunkV1}from'@noisia/query-engine';
import {spoolSignalWorkspaceEngineInputV1,hashWorkspaceEngineFileV1}from'./signal-workspace-engine-files';
import {runWorkspaceEngineProcessV1,validateWorkspaceEngineOutputV1}from'./signal-workspace-engine-process';
import {readWorkspaceEngineInterpretationEvidenceV1}from'./signal-workspace-engine-evidence';

type Db=typeof import('@noisia/db');
export type ListeningOrphanSubsetV1={id:string;workspace_id:string;generation_id:string;root_count:number;cached_count:number;subset_digest:string};
type NativePage=Awaited<ReturnType<Db['readSignalListeningDiscoveryOrphanSubsetV1']>>;
/** Exact SQL canonical strings preserve PostgreSQL decimal spelling in hashes. */
export type ListeningOrphanPageV1=Omit<NativePage,'roots'>&{roots:Array<NativePage['roots'][number]&{proof_json:string;vector_json:string|null}>};
export type ListeningOrphanNumericManifestV1={contract_version:'listening-orphan-numeric-v1';workspace_id:string;generation_id:string;generation_digest:string;
 subset_id:string;subset_digest:string;source_proofs_sha256:string;root_count:number;cached_count:number;uncached_count:number;
 grouped_count:number;unclustered_count:number;status:'empty'|'no_cached_vectors'|'insufficient_population'|'completed';
 numeric_config:ReturnType<typeof signalWorkspaceMassLabelingConfigV3>;numeric_config_digest:string;
 input_manifest_sha256:string|null;output_manifest_sha256:string|null;
 groups:ListeningDiscoveryOrphanManifestV1[];group_digests:Record<string,string>};
export type ListeningOrphanNumericResultV1={manifest:ListeningOrphanNumericManifestV1;manifest_sha256:string;manifest_json:string;
 artifacts:Array<{name:string;file:string;sha256:string;size_bytes:number}>;dispose():Promise<void>};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,hash=/^sha256:[a-f0-9]{64}$/u;
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
function fail(suffix:string):never{throw Error('listening_orphan_'+suffix);}
async function* jsonl(file:string){const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});
 try{for await(const line of lines){if(line.trim())yield JSON.parse(line)as Record<string,unknown>;}}finally{lines.close();}}

/** Read-only numeric regrouping. No importer, embedding client or editorial
 * transport is available here. The caller must durably verify every artifact
 * before its groups may enter the native round admission. */
export async function regroupSignalListeningOrphansV1(args:{access:SignalListeningAccessV1;generation:ListeningDiscoveryGenerationV1;subset:ListeningOrphanSubsetV1;
 read?:(args:Parameters<Db['readSignalListeningDiscoveryOrphanSubsetV1']>[0])=>Promise<ListeningOrphanPageV1>;
 python?:string;module_root?:string;process?:typeof runWorkspaceEngineProcessV1;heartbeat?:()=>Promise<void>;storage_root?:string;
}):Promise<ListeningOrphanNumericResultV1>{
 const {generation:g,subset:s,access}=args;
 if(![g.id,s.id,access.workspace_id,g.preparation_run_id].every(id=>uuid.test(id))||g.workspace_id!==access.workspace_id||s.workspace_id!==access.workspace_id
  ||s.generation_id!==g.id||g.status!=='ready'||g.kind!=='confirmed_members'||![g.snapshot_digest,s.subset_digest,g.embedding_config_digest,g.entity_context_digest].every(x=>hash.test(x))
  ||![s.root_count,s.cached_count].every(n=>Number.isSafeInteger(n)&&n>=0)||s.cached_count>s.root_count)fail('snapshot_invalid');
 const directory=await mkdtemp(join(args.storage_root??tmpdir(),'noisia-listening-orphans-'));
 const read=args.read??(async options=>await(await import('@noisia/db')).readSignalListeningDiscoveryOrphanSubsetV1(options)as ListeningOrphanPageV1);
 const proofPath=join(directory,'source-proofs.jsonl'),proofFile=await open(proofPath,'wx',0o600);
 const config=signalWorkspaceMassLabelingConfigV3(s.cached_count);let count=0,cached=0;
 const census=createHash('sha256');census.update('{"generation_id":'+JSON.stringify(g.id)+',"roots":[');
 try{
  for await(const page of pages())for(const row of page){
   if(count)census.update(',');census.update(JSON.stringify([row.root_id,row.proof_digest]));count++;
   if(row.vector!==null)cached++;
   await proofFile.writeFile(JSON.stringify({root_id:row.root_id,proof_digest:row.proof_digest,proof_json:row.proof_json,vector_json:row.vector_json})+'\n');
  }
  census.update('],"workspace_id":'+JSON.stringify(access.workspace_id)+'}');
  if(count!==s.root_count||cached!==s.cached_count||'sha256:'+census.digest('hex')!==s.subset_digest)fail('subset_census_invalid');
  await proofFile.sync();await proofFile.close();
  const proofSha=await hashWorkspaceEngineFileV1(proofPath),groups:ListeningDiscoveryOrphanManifestV1[]=[],group_digests:Record<string,string>={};
  let inputSha:string|null=null,outputSha:string|null=null,status:ListeningOrphanNumericManifestV1['status']=!count?'empty':'no_cached_vectors';
  const artifacts:ListeningOrphanNumericResultV1['artifacts']=[];
  if(cached){
   const revision=Number(g.input_revision);if(!Number.isSafeInteger(revision)||revision<1)fail('snapshot_invalid');
   const inputDirectory=join(directory,'input'),outputDirectory=join(directory,'output');
   async function* chunks(){for await(const page of pages()){
    const selected:SignalWorkspaceEngineChunkV1[]=[];
    for(const row of page){if(!row.vector)continue;selected.push({root_id:row.root_id,root_fingerprint:row.proof_digest,
     asset_sha256:String(row.proof.source_text_sha256),expected_chunks:1,chunk_index:0,start:0,end:row.text.length,
     chunk_sha256:String(row.proof.chunk_sha256),text:row.text,vector:row.vector});}yield selected;
   }}
   const input=await spoolSignalWorkspaceEngineInputV1({storage_root:directory,directory:inputDirectory,source_proofs_path:proofPath,
    snapshot:{workspace_id:access.workspace_id,input_revision:revision,preparation_run_id:g.preparation_run_id,
     embedding_config_digest:g.embedding_config_digest,context_digest:g.entity_context_digest,catalog_digest:s.subset_digest,
     chunk_policy_version:'corpus-text-chunks-v1',roots:cached,chunks:cached,guides:0,dimensions:1024,config,
     cached_vector_source:{kind:'sealed-listening-orphan-subset-v1',generation_id:g.id,generation_digest:g.snapshot_digest,subset_id:s.id,subset_digest:s.subset_digest,
      root_count:s.root_count,cached_count:s.cached_count,proofs:{file:'source-proofs.jsonl',sha256:proofSha,rows:s.root_count}}},
    chunks:chunks(),guides:(async function*(){yield[];})()});
   inputSha=await hashWorkspaceEngineFileV1(join(inputDirectory,'manifest.json'));
   await(args.process??runWorkspaceEngineProcessV1)({python:args.python??process.env.NOISIA_WORKSPACE_ENGINE_PYTHON??'/opt/noisia-engine/bin/python',
    module_root:args.module_root??process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT??'/app/tools/signal-semantic-lab/src',storage_root:directory,
    input_directory:inputDirectory,output_directory:outputDirectory,heartbeat:args.heartbeat});
   const output=await validateWorkspaceEngineOutputV1({directory:outputDirectory,storage_root:directory,input,input_manifest_sha256:inputSha});
   outputSha=await hashWorkspaceEngineFileV1(join(outputDirectory,'manifest.json'));status=output.status;
   const evidence=await readWorkspaceEngineInterpretationEvidenceV1({input_directory:inputDirectory,output_directory:outputDirectory,output});
   const members=new Map(evidence.map(group=>[group.cluster_id,[]as string[]]));
   for await(const assigned of jsonl(join(outputDirectory,'assignments.open.jsonl'))){
    if(assigned.stable_cluster_id===null)continue;
    const ids=members.get('open:'+String(assigned.stable_cluster_id));if(!ids)fail('group_coverage_invalid');ids.push(String(assigned.root_id));
   }
   for(const group of evidence){const ids=members.get(group.cluster_id)!;
    if(ids.length!==group.root_count||new Set(ids).size!==ids.length)fail('group_coverage_invalid');ids.sort();
    const groupDigest=digest({subset_id:s.id,root_ids:ids}),group_key='orphan_'+groupDigest.slice(7,63);
    groups.push({group_key,root_count:ids.length,root_ids:ids,terms:group.terms,representative_root_ids:group.representatives.map(r=>r.root_id)});
    group_digests[group_key]=groupDigest;
   }
   for(const [prefix,folder,names]of [['input',inputDirectory,['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','source-proofs.jsonl']],
    ['output',outputDirectory,['manifest.json',...output.artifacts.map(a=>a.file)]]]as const)
    for(const name of names)await artifact(prefix+'/'+name,join(folder,name));
  }
  const grouped=groups.reduce((n,group)=>n+group.root_count,0);
  const manifest:ListeningOrphanNumericManifestV1={contract_version:'listening-orphan-numeric-v1',workspace_id:access.workspace_id,generation_id:g.id,generation_digest:g.snapshot_digest,
   subset_id:s.id,subset_digest:s.subset_digest,source_proofs_sha256:proofSha,root_count:count,cached_count:cached,uncached_count:count-cached,
   grouped_count:grouped,unclustered_count:count-grouped,status,numeric_config:config,numeric_config_digest:digest(config),
   input_manifest_sha256:inputSha,output_manifest_sha256:outputSha,groups,group_digests};
  const raw=JSON.stringify(manifest);if(Buffer.byteLength(raw)>32*1024*1024)fail('manifest_capacity_exceeded');
  const file=await open(join(directory,'numeric-manifest.json'),'wx',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
  await artifact('numeric-manifest.json',join(directory,'numeric-manifest.json'));await artifact('source-proofs.jsonl',proofPath);
  return{manifest,manifest_json:raw,manifest_sha256:sha(raw),artifacts,dispose:()=>rm(directory,{recursive:true,force:true})};
  async function artifact(name:string,file:string){artifacts.push({name,file,sha256:await hashWorkspaceEngineFileV1(file),size_bytes:(await stat(file)).size});}
 }catch(error){await proofFile.close().catch(()=>undefined);await rm(directory,{recursive:true,force:true});throw error;}
 async function* pages(){let cursor:string|undefined,seen=0;
  for(;;){await args.heartbeat?.();const page=await read({...access,subset_id:s.id,after_root_id:cursor,limit:1024});
   if(page.generation.id!==g.id||page.generation.snapshot_digest!==g.snapshot_digest||page.subset.id!==s.id||page.subset.subset_digest!==s.subset_digest
    ||page.subset.root_count!==s.root_count||page.subset.cached_count!==s.cached_count||page.roots.length>1024)fail('snapshot_changed');
   for(const row of page.roots){
    if(!uuid.test(row.root_id)||cursor&&row.root_id<=cursor||!hash.test(row.proof_digest)||typeof row.proof_json!=='string'||sha(row.proof_json)!==row.proof_digest
     ||digest(JSON.parse(row.proof_json))!==digest(row.proof)||!row.text||row.text.length>1400
     ||sha(row.text)!==row.proof.source_text_sha256||sha(row.text)!==row.proof.chunk_sha256||row.proof.in_category!==true
     ||!Array.isArray(row.proof.evaluations)||row.proof.evaluations.some(e=>!e||typeof e!=='object'||typeof(e as{probability?:unknown}).probability!=='number'
       ||!Number.isFinite(Number((e as{probability:number}).probability))||Number((e as{probability:number}).probability)<0||Number((e as{probability:number}).probability)>=.7))fail('source_proof_invalid');
    if(row.vector!==null){if(!uuid.test(String(row.proof.embedding_call_id))||typeof row.vector_json!=='string'||sha(row.vector_json)!==row.proof.embedding_sha256
      ||JSON.stringify(JSON.parse(row.vector_json))!==JSON.stringify(row.vector)||row.vector.length!==1024||row.vector.some(n=>!Number.isFinite(n))
      ||Math.abs(Math.sqrt(row.vector.reduce((n,v)=>n+v*v,0))-1)>1e-4)fail('cached_vector_invalid');
    }else if(row.vector_json!==null||row.proof.embedding_call_id!==null||row.proof.embedding_sha256!==null)fail('cached_vector_invalid');
    cursor=row.root_id;if(++seen>s.root_count)fail('subset_census_invalid');
   }
   if(page.next_root_id!==(page.roots.at(-1)?.root_id??null))fail('cursor_invalid');
   if(!page.roots.length){if(seen!==s.root_count)fail('subset_census_invalid');break;}yield page.roots;
  }
 }
}
