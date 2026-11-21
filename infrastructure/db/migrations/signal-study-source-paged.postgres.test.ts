import assert from'node:assert/strict';
import type{PoolClient}from'pg';
import test from'node:test';
import{readdir}from'node:fs/promises';
import{tmpdir}from'node:os';
import{randomUUID,createHash}from'node:crypto';
import{withSignalStudyFixtureV1}from'./signal-study.synthetic.fixture';
import{requestSignalStudyExecutionV1,claimSignalStudyExecutionV1,readSignalStudyRuntimeSourceV1,releaseSignalStudyExecutionV1}from'../signal-study-executions';
import{prepareSignalStudyInlineSourceWithClientV1}from'../signal-study-source';
import{disposeStudySourcePagesV1,studyRuntimeSourceDigestV1,assertStudySourcePagesV1}from'../../../services/workers/src/workers/signal-study-source-pages';
import{studyDigestV1 as digest,type StudyDatabaseV1,type SignalStudyConfigurationRecordV1}from'../signal-study-core';
const enabled=process.env.NOISIA_R16_STUDY_SOURCE_PAGED_PG==='true';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
function databaseWithQuery(database:StudyDatabaseV1,intercept:(sql:string,values:unknown[]|undefined,client:PoolClient)=>Promise<unknown[]|undefined>){
 return Object.assign(Object.create(database),{query:database.query.bind(database),connect:async()=>{const client=await database.connect();return Object.assign(Object.create(client),{release:()=>client.release(),query:async(sql:string,values?:unknown[])=>client.query(sql,await intercept(sql,values,client))});}})as StudyDatabaseV1;
}
test('native paged Study source freezes the complete cut and exact raw/vector/metadata hashes without new provider calls',{
 skip:!enabled,timeout:180000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const counts=async()=>(await f.database.query('SELECT (SELECT count(*) FROM signal_workspace_embedding_calls)::int embeddings,(SELECT count(*) FROM engine_cost_events)::int editorial,(SELECT count(*) FROM signal_labeling_calls)::int jev,(SELECT count(*) FROM signal_processing_admissions)::int admissions')).rows[0];
 const before=await counts(),execution=await f.request();assert.equal(execution.status,'queued');assert.equal(execution.source_roots,3);
 assert.equal((execution.source_header.source_storage as {contract_version:string}).contract_version,'signal-study-source-pages-v1');
 assert.equal(execution.source_header.dominance_reask_version,'signal-study-dominance-reask-v1');
 const native=(await f.database.query('SELECT signal_labeling_digest_v1(source_header) header_digest,signal_study_census_v1(id) census FROM signal_study_executions WHERE id=$1',[execution.id])).rows[0];
 assert.equal(native.header_digest,execution.source_digest);assert.equal(native.census,execution.source_census_digest);
 const lease=await claimSignalStudyExecutionV1({database:f.database,execution_id:execution.id});assert.ok(lease);
 const source=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(source);
 try{
  assert.equal(assertStudySourcePagesV1(source),true);assert.equal(studyRuntimeSourceDigestV1(source),execution.source_digest);
  assert.deepEqual(source.roots.map(r=>r.root_id).sort(),[...f.roots].sort());
  const observed=source.roots.map(root=>{const proof=JSON.parse(root.embedding_proof.proof_json);assert.equal(sha(root.embedding_proof.vector_json),proof.embedding_sha256);assert.equal(digest(root.vector),root.embedding_proof.vector_digest);assert.equal(sha(root.text),root.text_sha256);return[root.root_id,root.text,root.embedding_proof.proof_json,root.embedding_proof.vector_json,digest(root.vector),root.private_person_names];});
  const again=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(again);try{
   assert.equal(again.source_digest,source.source_digest);assert.deepEqual(again.roots.map(root=>[root.root_id,root.text,root.embedding_proof.proof_json,root.embedding_proof.vector_json,digest(root.vector),root.private_person_names]),observed);
  }finally{await disposeStudySourcePagesV1(again);}
 }finally{await disposeStudySourcePagesV1(source);await releaseSignalStudyExecutionV1({database:f.database,lease});}
 const directories=async()=>new Set((await readdir(tmpdir())).filter(name=>name.startsWith('noisia-study-source-')));
 const existing=await directories(),ackLease=await claimSignalStudyExecutionV1({database:f.database,execution_id:execution.id});assert.ok(ackLease);
 const ackDatabase=Object.assign(Object.create(f.database),{query:f.database.query.bind(f.database),connect:async()=>{const client=await f.database.connect();return Object.assign(Object.create(client),{release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{const result=await client.query(sql,values);if(sql==='COMMIT')throw Error('lost_source_commit_ack');return result;}});}})as StudyDatabaseV1;
 try{await assert.rejects(readSignalStudyRuntimeSourceV1({database:ackDatabase,lease:ackLease}),/lost_source_commit_ack/);
  assert.deepEqual([...(await directories())].filter(name=>!existing.has(name)),[],'COMMIT ACK loss disposes the hydrated spool before rethrow');
 }finally{await releaseSignalStudyExecutionV1({database:f.database,lease:ackLease});}
 assert.deepEqual(await counts(),before,'source preparation/reload never imports, embeds, admits or sends a provider request');
}));

test('native V3 header rejects forged protocol, byte budgets, vector census and source digest; inline historical hash still reloads exactly',{
 skip:!enabled,timeout:240000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const bad=[
  {name:'protocol',mutate:(header:any)=>{header.source_storage.contract_version='fake';},code:/study_paged_source_contract_invalid/},
  {name:'bound',mutate:(header:any)=>{header.source_storage.cache_working_limit_bytes=536870912;},code:/study_paged_source_bound_invalid/},
  {name:'vectorbytes',mutate:(header:any)=>{header.source_storage.native_vector_json_bytes++;},code:/study_paged_source_vector_bytes_invalid/},
  {name:'rootcount',mutate:(header:any)=>{header.source_storage.root_count++;},code:/study_paged_source_bound_invalid/},
 ];
 for(const item of bad){const next=await f.createStudy();let headerDigest:string|undefined;const database=databaseWithQuery(f.database,async(sql,values)=>{
   if(sql.startsWith('INSERT INTO signal_study_executions(')){const changed=[...values!],header=JSON.parse(String(changed[14]));item.mutate(header);headerDigest=digest(header);changed[14]=JSON.stringify(header);return changed;}
   if(sql.includes("set_config('noisia.study_source_verified_v1'")){const changed=[...values!],marker=JSON.parse(String(changed[0]));marker.source_digest=headerDigest;changed[0]=JSON.stringify(marker);return changed;}
   if(sql.startsWith('UPDATE signal_study_executions SET source_digest=')){const changed=[...values!];changed[1]=headerDigest;return changed;}
   return values;
  });
  await assert.rejects(requestSignalStudyExecutionV1({...f,database,configuration_id:next.configuration.id,idempotency_key:randomUUID(),cap_micro_usd:4000000}),item.code,item.name);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_study_executions WHERE configuration_id=$1',[next.configuration.id])).rows[0].n,0,'entire source transaction rolls back');
 }
 const digestStudy=await f.createStudy(),digestDatabase=databaseWithQuery(f.database,async(sql,values)=>{
  if(sql.startsWith("UPDATE signal_study_executions SET source_digest=")){const changed=[...values!];changed[1]=digest('forged');return changed;}
  return values;
 });
 await assert.rejects(requestSignalStudyExecutionV1({...f,database:digestDatabase,configuration_id:digestStudy.configuration.id,idempotency_key:randomUUID(),cap_micro_usd:4000000}),/study_paged_source_digest_invalid/);
 const legacyStudy=await f.createStudy();let legacyDigest:string|undefined;
 const legacyDatabase=databaseWithQuery(f.database,async(sql,values,client)=>{
  if(sql.startsWith('INSERT INTO signal_study_executions(')){
   const changed=[...values!],cfg=(await client.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE id=$1',[legacyStudy.configuration.id])).rows[0]!;
   const ready=await prepareSignalStudyInlineSourceWithClientV1(client,cfg,String(changed[0]),{query_terms:[],problem_terms:[]}),{roots:_roots,source_digest,...header}=ready.source;
   legacyDigest=source_digest;changed[14]=JSON.stringify(header);changed[16]=ready.working_bytes;return changed;
  }
  if(sql.includes("set_config('noisia.study_source_verified_v1'")){const changed=[...values!],marker=JSON.parse(String(changed[0]));marker.source_digest=legacyDigest;changed[0]=JSON.stringify(marker);return changed;}
  if(sql.startsWith('UPDATE signal_study_executions SET source_digest=')){const changed=[...values!];changed[1]=legacyDigest;return changed;}
  return values;
 });
 const legacy=await requestSignalStudyExecutionV1({...f,database:legacyDatabase,configuration_id:legacyStudy.configuration.id,idempotency_key:randomUUID(),cap_micro_usd:4000000});
 assert.equal(Object.hasOwn(legacy.source_header,'source_storage'),false);assert.equal(legacy.source_digest,legacyDigest);
 assert.equal(legacy.source_header.dominance_reask_version,'signal-study-dominance-reask-v1','new inline creators also seal the protocol before digesting');
 const lease=await claimSignalStudyExecutionV1({database:f.database,execution_id:legacy.id});assert.ok(lease);
 const source=await readSignalStudyRuntimeSourceV1({database:f.database,lease});assert.ok(source);
 assert.equal(assertStudySourcePagesV1(source),false);assert.equal(studyRuntimeSourceDigestV1(source),legacyDigest);assert.equal(source.roots.length,3);
 await releaseSignalStudyExecutionV1({database:f.database,lease});
}));
