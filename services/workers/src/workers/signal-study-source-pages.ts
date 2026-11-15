import {createHash} from 'node:crypto';
import {readSync} from 'node:fs';
import {mkdtemp,open,rm,type FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signalWorkspaceEmbeddingDigestV1 as digest,type SignalStudyRootV1} from '@noisia/query-engine';
import type{StudyRuntimeRootV1,StudyRuntimeSourceV1}from'./signal-study-runtime';

export const STUDY_SOURCE_PAGES_V1='signal-study-source-pages-v1' as const;
export const STUDY_SOURCE_PAGE_WORKING_BYTES_V1=16*1024*1024;
const MAX_ROOTS=32768,MAX_DESCRIPTOR_BYTES=128*1024*1024,MAX_SPOOL_BYTES=2*1024*1024*1024;
const sha=(value:string|Uint8Array)=>'sha256:'+createHash('sha256').update(value).digest('hex');
function fail(code:string):never{throw Error('study_source_pages_'+code);}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
type Metadata=Omit<StudyRuntimeRootV1,'vector'|'embedding_proof'>&{embedding_proof:Omit<StudyRuntimeRootV1['embedding_proof'],'vector_json'>};
type Segment={offset:number;bytes:number;sha256:string};
type Entry={root_id:string;metadata:Segment;vector:Segment;native:Segment;record:Segment;metadata_digest:string;vector_digest:string};
export type StudySourcePagesManifestV1={contract_version:typeof STUDY_SOURCE_PAGES_V1;root_count:number;root_manifest_digest:string;
 metadata_bytes:number;vector_bytes:number;native_vector_json_bytes:number;descriptor_working_limit_bytes:number;
 page_working_limit_bytes:number;cache_working_limit_bytes:number;vector_encoding:'float64-le-exact-parsed-native'};
type CacheValue={value:unknown;working:number};
export type StudySourcePagesV1=Awaited<ReturnType<typeof createStudySourcePagesV1>>;
const owners=new WeakMap<object,StudySourcePagesV1>();
const pagedRoots=new WeakSet<object>();

/** Attaching axes must preserve deferred property access. Object spread copies
 * every enumerable value and would eagerly retain the complete vector corpus. */
export function studySourceRootWithAxesV1<T extends StudyRuntimeRootV1>(root:T,axes:SignalStudyRootV1['axes']):T&SignalStudyRootV1{
 return pagedRoots.has(root)?Object.assign(Object.create(root) as T&SignalStudyRootV1,{axes}):{...root,axes};
}
export function studySourcePagesManifestV1(source:StudyRuntimeSourceV1):StudySourcePagesManifestV1|null{
 const manifest=(source as StudyRuntimeSourceV1&{source_storage?:StudySourcePagesManifestV1}).source_storage;
 if(manifest===undefined)return null;
 if(manifest.contract_version!==STUDY_SOURCE_PAGES_V1||!owners.has(source))fail('unowned_source');
 return manifest;
}
export function bindStudySourcePagesV1(source:StudyRuntimeSourceV1,pages:StudySourcePagesV1){owners.set(source,pages);return source;}
export async function disposeStudySourcePagesV1(source:StudyRuntimeSourceV1|undefined|null){const pages=source&&owners.get(source);if(pages){owners.delete(source!);await pages.dispose();}}
/** V3 commits the exact ordered metadata/vector manifest, not a second inline
 * serialization of the complete corpus. Historical sources keep their hash. */
export function studyRuntimeSourceDigestV1(source:StudyRuntimeSourceV1):string{
 const{source_digest:_digest,roots,...header}=source;
 const pages=studySourcePagesManifestV1(source);
 return pages?digest(header):digest({...header,roots});
}
export function assertStudySourcePagesV1(source:StudyRuntimeSourceV1){
 const manifest=studySourcePagesManifestV1(source);if(!manifest)return false;
 const pages=owners.get(source)!;const current=pages.manifest();
 if(digest(manifest)!==digest(current)||manifest.root_count!==source.roots.length||source.roots!==pages.roots()
  ||manifest.page_working_limit_bytes>STUDY_SOURCE_PAGE_WORKING_BYTES_V1
  ||manifest.cache_working_limit_bytes>STUDY_SOURCE_PAGE_WORKING_BYTES_V1
  ||manifest.descriptor_working_limit_bytes+manifest.cache_working_limit_bytes+manifest.page_working_limit_bytes>512*1024*1024)fail('manifest_invalid');
 return true;
}

/** Private local cache only. Native PostgreSQL rows remain canonical. Each
 * reload rebuilds this spool from immutable frozen identities, verifies hashes,
 * and closes/removes its uniquely owned files in the caller's finally block. */
export async function createStudySourcePagesV1(options:{storage_root?:string;cache_working_bytes?:number}={}){
 const cacheLimit=options.cache_working_bytes??STUDY_SOURCE_PAGE_WORKING_BYTES_V1;
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<128*1024||cacheLimit>STUDY_SOURCE_PAGE_WORKING_BYTES_V1)fail('cache_bound_invalid');
 const directory=await mkdtemp(join(options.storage_root??tmpdir(),'noisia-study-source-'));
 const names=['metadata.jsonl','vectors.f64le','native-vectors.jsonl','records.jsonl']as const;
 const handles:FileHandle[]=[],paths=names.map(name=>join(directory,name));
 try{for(const path of paths)handles.push(await open(path,'wx+',0o600));}catch(error){await Promise.all(handles.map(h=>h.close()));await rm(directory,{recursive:true,force:true});throw error;}
 const entries:Entry[]=[],positions=[0,0,0,0],cache=new Map<string,CacheValue>();
 let descriptorWorking=0;
 let finished=false,disposed=false,working=0,vectorReads=0,metadataReads=0,manifestValue:StudySourcePagesManifestV1|undefined;
 let runtimeRoots:StudyRuntimeRootV1[]=[];
 const live=()=>{if(disposed)fail('disposed');};
 async function segment(index:number,body:Buffer):Promise<Segment>{
  if(positions.reduce((a,b)=>a+b,0)+body.length>MAX_SPOOL_BYTES)fail('disk_capacity_exceeded');
  const value={offset:positions[index]!,bytes:body.length,sha256:sha(body)};let written=0;
  while(written<body.length){const result=await handles[index]!.write(body,written,body.length-written,value.offset+written);if(!result.bytesWritten)fail('write_incomplete');written+=result.bytesWritten;}
  positions[index]!+=body.length;return value;
 }
 function read(index:number,part:Segment):Buffer{
  live();const bytes=Buffer.allocUnsafe(part.bytes);let done=0;
  while(done<bytes.length){const got=readSync(handles[index]!.fd,bytes,done,bytes.length-done,part.offset+done);if(!got)fail('read_incomplete');done+=got;}
  if(sha(bytes)!==part.sha256)fail(index===1?'vector_custody_invalid':'metadata_custody_invalid');return bytes;
 }
 function cached<T>(key:string,weight:number,load:()=>T):T{
  live();const prior=cache.get(key);if(prior){cache.delete(key);cache.set(key,prior);return prior.value as T;}
  if(weight>cacheLimit)fail('root_page_oversize');
  while(working+weight>cacheLimit){const first=cache.entries().next().value as [string,CacheValue]|undefined;if(!first)fail('cache_bound_invalid');cache.delete(first[0]);working-=first[1].working;}
  const value=load();cache.set(key,{value,working:weight});working+=weight;return value;
 }
 function metadata(entry:Entry):Metadata{return cached('m:'+entry.root_id,entry.metadata.bytes*8+8192,()=>{
  metadataReads++;const value=JSON.parse(read(0,entry.metadata).toString('utf8')) as Metadata;
  if(digest(value)!==entry.metadata_digest||value.root_id!==entry.root_id||value.embedding_proof.vector_digest!==entry.vector_digest)fail('metadata_custody_invalid');
  Object.defineProperty(value.embedding_proof,'vector_json',{enumerable:false,get:()=>native(entry)});return freeze(value);
 });}
 function vector(entry:Entry):number[]{return cached('v:'+entry.root_id,1024*8*4+8192,()=>{
  vectorReads++;const bytes=read(1,entry.vector),value=Array.from({length:1024},(_,i)=>bytes.readDoubleLE(i*8));
  if(digest(value)!==entry.vector_digest)fail('vector_custody_invalid');return Object.freeze(value) as number[];
 });}
 function native(entry:Entry):string{return cached('n:'+entry.root_id,entry.native.bytes*4+8192,()=>read(2,entry.native).toString('utf8'));}
 const fields=['text','text_sha256','occurred_at','channel','source_url','listening_topic_keys','private_person_names','attributes','base_answers','question_cache','selected_fragment','embedding_proof']as const;
 const api={
  async append(root:StudyRuntimeRootV1,record:unknown){live();if(finished||entries.length>=MAX_ROOTS||entries.length&&root.root_id<=entries.at(-1)!.root_id)fail('root_order_invalid');
   const{vector:values,embedding_proof,...rest}=root,{vector_json,...proof}=embedding_proof;
   if(values.length!==1024||values.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...values)-1)>1e-4||digest(values)!==proof.vector_digest
    ||JSON.stringify(JSON.parse(vector_json))!==JSON.stringify(values))fail('vector_invalid');
   const metadataValue:Metadata={...rest,embedding_proof:proof},metadataBody=Buffer.from(JSON.stringify(metadataValue)),nativeBody=Buffer.from(vector_json),recordBody=Buffer.from(JSON.stringify(record));
   const rootWorking=metadataBody.length*8+nativeBody.length*4+1024*8*4+recordBody.length*8+32768;
   if(rootWorking>STUDY_SOURCE_PAGE_WORKING_BYTES_V1||metadataBody.length*8+8192>cacheLimit||1024*8*4+8192>cacheLimit||nativeBody.length*4+8192>cacheLimit)fail('root_page_oversize');
   const binary=Buffer.allocUnsafe(1024*8);for(let n=0;n<1024;n++)binary.writeDoubleLE(values[n]!,n*8);
   const entry:Entry={root_id:root.root_id,metadata:await segment(0,metadataBody),vector:await segment(1,binary),native:await segment(2,nativeBody),record:await segment(3,recordBody),metadata_digest:digest(metadataValue),vector_digest:proof.vector_digest};
   entries.push(entry);
  },
  async finish(){live();if(finished)fail('already_finished');finished=true;
   for(const handle of handles)await handle.sync();
   descriptorWorking=Buffer.byteLength(JSON.stringify(entries))*8+entries.length*2048;
   if(descriptorWorking>256*1024*1024||Buffer.byteLength(JSON.stringify(entries))>MAX_DESCRIPTOR_BYTES)fail('descriptor_capacity_exceeded');
   manifestValue={contract_version:STUDY_SOURCE_PAGES_V1,root_count:entries.length,
    root_manifest_digest:digest(entries.map(e=>({root_id:e.root_id,metadata_digest:e.metadata_digest,vector_digest:e.vector_digest,native_vector_sha256:e.native.sha256}))),
    metadata_bytes:positions[0]!,vector_bytes:positions[1]!,native_vector_json_bytes:positions[2]!,descriptor_working_limit_bytes:256*1024*1024,
    page_working_limit_bytes:STUDY_SOURCE_PAGE_WORKING_BYTES_V1,cache_working_limit_bytes:cacheLimit,vector_encoding:'float64-le-exact-parsed-native'};
   runtimeRoots=entries.map(entry=>{const root={root_id:entry.root_id};for(const field of fields)Object.defineProperty(root,field,{enumerable:false,get:()=>metadata(entry)[field]});
    Object.defineProperty(root,'vector',{enumerable:false,get:()=>vector(entry)});pagedRoots.add(root);return Object.freeze(root) as StudyRuntimeRootV1;});
   Object.freeze(runtimeRoots);
   return{manifest:manifestValue,roots:runtimeRoots};
  },
  manifest(){live();if(!manifestValue)fail('not_finished');return manifestValue;},roots(){live();if(!finished)fail('not_finished');return runtimeRoots;},
  async* records(){live();if(!finished)fail('not_finished');let batch:unknown[]=[],weight=0;
   for(const entry of entries){const next=entry.record.bytes*8+8192;if(batch.length&&(batch.length>=512||weight+next>STUDY_SOURCE_PAGE_WORKING_BYTES_V1)){yield batch;batch=[];weight=0;}
    if(next>STUDY_SOURCE_PAGE_WORKING_BYTES_V1)fail('root_page_oversize');batch.push(JSON.parse(read(3,entry.record).toString('utf8')));weight+=next;}
   if(batch.length)yield batch;
  },
  diagnostics(){live();return{cache_working_bytes:working,cache_entries:cache.size,vector_reads:vectorReads,metadata_reads:metadataReads,descriptor_working_bytes:descriptorWorking,record_bytes:positions[3]!,root_count:entries.length};},
  privateFiles(){live();return[...paths];},
  async dispose(){if(disposed)return;disposed=true;cache.clear();working=0;runtimeRoots=[];await Promise.all(handles.map(handle=>handle.close()));await rm(directory,{recursive:true,force:true});},
 };
 return api;
}
