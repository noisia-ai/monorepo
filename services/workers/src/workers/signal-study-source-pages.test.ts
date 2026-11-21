import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat,writeFile} from 'node:fs/promises';
import test from 'node:test';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {createStudySourcePagesV1,studySourceRootWithAxesV1,studyRuntimeSourceDigestV1,bindStudySourcePagesV1} from './signal-study-source-pages';
import type{StudyRuntimeRootV1,StudyRuntimeSourceV1}from'./signal-study-runtime';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
function root(index:number):StudyRuntimeRootV1{
 const text='A complete synthetic source with a force '+index;
 const vector=Array.from({length:1024},()=>.03125),vector_json='['+vector.map(n=>n.toFixed(5)).join(',')+']';
 return{root_id:'00000000-0000-4000-8000-'+index.toString().padStart(12,'0'),text,text_sha256:sha(text),vector,
 occurred_at:'2026-02-01T00:00:00.000Z',channel:'synthetic',source_url:'https://example.invalid/synthetic/'+index,listening_topic_keys:[],private_person_names:[],attributes:{},base_answers:{},question_cache:[],
 selected_fragment:{text,text_sha256:sha(text),start:0,end:text.length},embedding_proof:{embedding_call_id:randomUUID(),embedding_run_id:randomUUID(),preparation_run_id:null,input_contract:'synthetic-native',proof_json:'{}',proof_digest:sha('{}'),vector_json,vector_digest:digest(vector),text_sha256:sha(text)}};
}
test('deferred source keeps exact native JSON separate from parsed vectors, bounds cache, and survives axes derivation without eager copies',async()=>{
 const pages=await createStudySourcePagesV1({cache_working_bytes:256*1024});
 try{
  const expected:StudyRuntimeRootV1[]=[];
  for(let n=0;n<100;n++){const r=root(n);expected.push(r);await pages.append(r,{root_id:r.root_id,proof_digest:r.embedding_proof.proof_digest});}
  const complete=await pages.finish();
  assert.equal(complete.manifest.root_count,100);assert.equal(complete.roots.length,100);
  assert.ok(complete.manifest.native_vector_json_bytes>100*8192);
  assert.equal(complete.manifest.vector_bytes,100*1024*8);
  assert.ok(Buffer.byteLength(JSON.stringify(complete.roots))<10000,'root descriptors never inline vectors or source text');
  for(let n=99;n>=0;n--){const r=complete.roots[n]!;assert.deepEqual(r.vector,expected[n]!.vector);
   assert.equal(r.embedding_proof.vector_json,expected[n]!.embedding_proof.vector_json);assert.equal(sha(r.embedding_proof.vector_json),sha(expected[n]!.embedding_proof.vector_json));
   assert.ok(pages.diagnostics().cache_working_bytes<=256*1024);}
  const before=pages.diagnostics().vector_reads;
  const axes={direction:'none',source_direction:'none',target:'category',use:'literal',aggregate:'subject',alternative_inverted:false}as const;
  const resolved=complete.roots.map(r=>studySourceRootWithAxesV1(r,axes));
  assert.equal(pages.diagnostics().vector_reads,before,'attaching axes does not hydrate any vector');
  assert.equal(resolved[17]!.text,expected[17]!.text);assert.deepEqual(resolved[17]!.vector,expected[17]!.vector);
  const records=[];for await(const page of pages.records())records.push(...page);assert.equal(records.length,100);
  for(const file of pages.privateFiles())assert.equal((await stat(file)).mode&0o077,0);
 }finally{await pages.dispose();}
 assert.throws(()=>pages.diagnostics(),/disposed/);
});
test('deferred source rejects changed metadata/vector custody and indivisible oversized records',async()=>{
 const pages=await createStudySourcePagesV1({cache_working_bytes:256*1024});
 try{
  await pages.append(root(1),{});const complete=await pages.finish();
  const path=pages.privateFiles().find(file=>file.endsWith('vectors.f64le'))!;
  const body=await readFile(path);body[0]=body[0]!^1;await writeFile(path,body);
  assert.throws(()=>complete.roots[0]!.vector,/vector_custody_invalid/);
 }finally{await pages.dispose();}
 const small=await createStudySourcePagesV1({cache_working_bytes:256*1024});try{
  const r=root(2);r.text+='x'.repeat(40000);
  await assert.rejects(small.append(r,{}),/root_page_oversize/);
 }finally{await small.dispose();}
});

test('18,845 dense native vectors stay deferred with bounded cache and a small wire manifest',{
 skip:process.env.NOISIA_R16_STUDY_SOURCE_SCALE!=='true',timeout:300000,
},async()=>{
 const pages=await createStudySourcePagesV1();let peakRss=process.memoryUsage().rss;
 try{
  for(let n=0;n<18845;n++){const value=root(n);await pages.append(value,{root_id:value.root_id,proof_digest:value.embedding_proof.proof_digest});if(n%128===0)peakRss=Math.max(peakRss,process.memoryUsage().rss);}
  const done=await pages.finish();assert.equal(done.roots.length,18845);assert.equal(done.manifest.vector_bytes,18845*8192);
  assert.ok(done.manifest.native_vector_json_bytes>128*1024*1024,'actual dense native vector strings exceed the former whole-source wire limit');
  assert.ok(Buffer.byteLength(JSON.stringify({manifest:done.manifest,roots:done.roots}))<2*1024*1024);
  for(let n=18844;n>=0;n--){assert.equal(done.roots[n]!.vector.length,1024);assert.equal(done.roots[n]!.embedding_proof.vector_digest,digest(done.roots[n]!.vector));assert.ok(pages.diagnostics().cache_working_bytes<=16*1024*1024);if(n%128===0)peakRss=Math.max(peakRss,process.memoryUsage().rss);}
  assert.ok(peakRss<512*1024*1024,`observed source process RSS ${peakRss} must remain below 512 MiB`);
 }finally{await pages.dispose();}
});


test('inline and paged source digests bind only explicit new evidence association versions',async()=>{
 const pages=await createStudySourcePagesV1({cache_working_bytes:256*1024});
 try{
  const r=root(1);await pages.append(r,{});const complete=await pages.finish();
  for(const source_storage of [undefined,complete.manifest]){
   const header={...(source_storage?{source_storage}:{}),human_revision_digest:digest('frozen')};
   const legacy={...header,roots:source_storage?complete.roots:[r]}as unknown as StudyRuntimeSourceV1;
   if(source_storage)bindStudySourcePagesV1(legacy,pages);
   const expected=digest(source_storage?header:{...header,roots:[r]});
   assert.equal(studyRuntimeSourceDigestV1(legacy),expected);
   const next={...legacy,evidence_association_version:'signal-study-evidence-association-v1' as const};
   if(source_storage)bindStudySourcePagesV1(next,pages);
   assert.notEqual(studyRuntimeSourceDigestV1(next),expected);
   const {evidence_association_version:_,...without}=next;if(source_storage)bindStudySourcePagesV1(without,pages);assert.equal(studyRuntimeSourceDigestV1(without),expected);
  }
 }finally{await pages.dispose();}
});
