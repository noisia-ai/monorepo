import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
 mapSignalListeningJevResponseV1,buildSignalTopicEditorialBatchPlanFromPreparedInputV2,type SignalListeningInputV1} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {prepareSyntheticSiblingEditorialPolicyV1,loadSyntheticSiblingEditorialDeadlineV1} from './signal-mfp-mass-labeling-sibling.synthetic.fixture';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {quoteSignalTopicEditorialChunkedAdmissionV3,requestSignalTopicEditorialChunkedAdmissionV3} from '../signal-topic-editorial-admission-v3';
import {prepareSignalTopicEditorialBatchV2} from '../signal-topic-editorial-batch-v2';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {createSignalListeningDiscoveryAdvanceStoreV1} from '../signal-listening-discovery-advance';
import {activateSignalListeningServingSnapshotV1,lockSignalListeningDiscoveryPolicyWithClientV1,type ListeningDiscoveryRoundV1} from '../signal-listening-discovery-money';

const enabled=process.env.NOISIA_R16_LISTENING_MONEY_BATCHES_PG==='true';
type NativeFixture={database:Parameters<typeof createSignalListeningStoreV1>[0]['database'];
 run:LabelingRunV1;inputs:SignalListeningInputV1[];configuration:ReturnType<typeof signalListeningBaseTemplateV1>;
 store:ReturnType<typeof createSignalListeningStoreV1>;rawPages:NonNullable<Parameters<typeof createSignalListeningStoreV1>[0]['rawPages']>;
 editorial?:Awaited<ReturnType<typeof seedEditorialRace>>};
async function withMoneyFixture(cap:number,body:(fixture:NativeFixture)=>Promise<void>,editorialRace=false){
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const editorial=editorialRace?await seedEditorialRace(access):undefined;
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',
   configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
   idempotency_key:randomUUID(),cap_micro_usd:editorial?.cap??cap,provider_available:true});
  const files=await mkdtemp(join(tmpdir(),'r16-listening-money-'));
  const rawPages:NativeFixture['rawPages']={
   reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
   async store(a){const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});
    const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
    assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},
   load:a=>readFile(join(files,a.sha256.slice(7)),'utf8')};
  const store=createSignalListeningStoreV1({database,rawPages,storeRaw:async()=>{throw Error('no individual provider/raw in money acceptance');}});
  const run=await store.claim(requested.run_id);assert.ok(run);
  const inputs=await store.inputs(run);assert.equal(inputs.length,3);
  try{await body({database,run,inputs,configuration:cfg.configuration,store,rawPages,editorial});}
  finally{await rm(files,{recursive:true,force:true});}
 }});
}
/** Setup only: the shared source fixture runs in its usual rollback/savepoint
 * harness, then commits before either competing native reservation begins. */
async function seedEditorialRace(access:Pick<NativeFixture,'database'>&{workspace_id:string;actor_user_id:string}){
 const c=await access.database.connect();let sequence=0;const stack:string[]=[];
 await c.query('BEGIN');await c.query('SET LOCAL search_path=public,extensions,pg_temp');
 const query=(async(sql:string,values?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const name='money_seed_'+(++sequence);stack.push(name);return c.query('SAVEPOINT '+name);}
  if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT '+stack.pop()!);
  if(sql==='ROLLBACK'){const name=stack.pop()!;await c.query('ROLLBACK TO SAVEPOINT '+name);return c.query('RELEASE SAVEPOINT '+name);}
  if(sql.startsWith('SET TRANSACTION'))return c.query('SELECT 1');
  return c.query(sql,values);
 }) as PoolClient['query'];
 const scoped=Object.assign(Object.create(c),{query,release(){}})as PoolClient;
 const database=Object.assign(Object.create(access.database),{query,connect:async()=>scoped})as Pool;
 try{
  const organization_id=(await c.query('SELECT organization_id FROM signal_workspaces WHERE id=$1',[access.workspace_id])).rows[0].organization_id;
  const setup={database,scoped,query,cleanup:async()=>{},identity:{organization_id,actor_user_id:access.actor_user_id}};
  const priorId=await prepareSyntheticSiblingEditorialPolicyV1(setup);
  const source=await seedSignalTopicEditorialRenewalSourceV1({...setup,defer_numeric_policy_activation:true});
  const input=await loadSignalTopicConsolidationEditorialInputV1(source.scope);
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:source.scope.numeric_run_id});
  const editorialAccess={database,workspace_id:source.identity.workspace_id,actor_user_id:access.actor_user_id};
  const deadline=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:priorId});
  const estimate=await quoteSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,deadline});
  assert.equal(estimate.status,'ready_to_authorize');const cap=Number(estimate.maximum_micro_usd);
  assert.ok(Number.isSafeInteger(cap)&&cap>0);
  const prior=(await c.query('SELECT * FROM signal_processing_policy_versions WHERE id=$1',[priorId])).rows[0];
  const priorExposure=Number((await c.query('SELECT total_micro_usd::text n FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)',[organization_id,prior.budget_timezone])).rows[0].n);
  await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');
  // Both finite caps are provisioned BEFORE either tested owner, never raised
  // to make an already-owned request pass. Each can consume the remaining day.
  const next=(await c.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,$2,created_by_user_id
   FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[priorId,priorExposure+cap])).rows[0];
  await c.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,
   CASE WHEN action='mass_labeling_jev' THEN $3::bigint ELSE max_execution_micro_usd END,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[priorId,next.id,cap]);
  await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[priorId]);
  await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[next.id]);
  const finalQuote=await quoteSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,deadline});
  assert.equal(finalQuote.status,'ready_to_authorize');assert.equal(Number(finalQuote.maximum_micro_usd),cap);assert.ok(finalQuote.quote_reference);
  const admitted=await requestSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,
   idempotency_key:'money-native-'+randomUUID(),quote_reference:finalQuote.quote_reference});
  assert.equal(stack.length,0);await c.query('COMMIT');
  return{execution_id:admitted.execution_id,cap,organization_id,budget_timezone:next.budget_timezone,daily_cap_micro_usd:next.daily_cap_micro_usd};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
type Requests=Pick<NativeFixture,'run'|'inputs'|'configuration'>;
function proposals(f:Requests,amount:number){return f.inputs.map(input=>{
 const request=buildSignalListeningJevRequestV1(input,f.configuration),request_digest=signalListeningRequestDigestV1(f.run,input,request);
 return{id:randomUUID(),custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:amount};
});}
async function insert(c:PoolClient,f:Requests,amount:number,inputs=f.inputs){
 return insertPrepared(c,f,proposals({...f,inputs},amount));
}
async function insertPrepared(c:PoolClient,f:Requests,rows:ReturnType<typeof proposals>){
 return c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,
  request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
 SELECT x.id,$1,$2,'typesafe','jev-1.13.0','sync',x.custom_id,x.request_digest,x.request,x.inputs,x.reserved_micro_usd,
  a.budget_date,a.budget_timezone FROM jsonb_to_recordset($3::jsonb) x(id uuid,custom_id text,request_digest text,
   request jsonb,inputs jsonb,reserved_micro_usd bigint)
 JOIN signal_processing_admissions a ON a.id=$4 RETURNING id`,
 [f.run.id,f.run.workspace_id,JSON.stringify(rows),f.run.processing_admission_id]);
}
async function transaction(f:NativeFixture,body:(c:PoolClient)=>Promise<void>){
 const c=await f.database.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s'");
  await body(c);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
async function exposureCalls(c:PoolClient,fn='signal_processing_org_exposure_v1(uuid,date,text,text,uuid)'){
 return Number((await c.query(`SELECT COALESCE((SELECT calls FROM pg_stat_xact_user_functions
  WHERE funcid=$1::regprocedure),0)::int n`,[fn])).rows[0].n);
}
test('native Listening evaluates one fresh bounded population per reserve and mark statement, not per call',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 await transaction(f,async c=>{
  await c.query("SET LOCAL track_functions='all'");
  const population='signal_listening_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)';
  const authority='signal_listening_call_authority_v1(uuid,date,text,timestamptz)';
  const beforePopulation=await exposureCalls(c,population),beforeAuthority=await exposureCalls(c,authority);
  const calls=(await insert(c,f,1000)).rows;assert.equal(calls.length,3);
  assert.equal(await exposureCalls(c,population)-beforePopulation,1,'all three roots must share one statement-local population');
  assert.equal(await exposureCalls(c,authority)-beforeAuthority,2,'authority is checked before validation and after final exposure');
  const beforeMark=await exposureCalls(c,population),beforeMarkAuthority=await exposureCalls(c,authority);
  await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",[calls.map(row=>row.id)]);
  assert.equal(await exposureCalls(c,population)-beforeMark,1,'mark must read another population even in the same transaction');
  assert.equal(await exposureCalls(c,authority)-beforeMarkAuthority,2,'mark retains both physical authority fences');
 });
}));

for(const defect of ['text','digest','question_digest','duplicate_question']as const)test('native Listening batch rejects '+defect+' and rolls back valid siblings',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const rows=proposals(f,1000),bad=rows[1]!,input=bad.inputs[0]!;
 if(defect==='text'){input.text+=' forged text';bad.request={...bad.request,state:input.text};}
 if(defect==='question_digest')input.question_digests={...input.question_digests,voice:'sha256:'+'f'.repeat(64)};
 if(defect==='duplicate_question'){
  input.question_keys=['voice','voice'];input.question_digests={voice:input.question_digests.voice!};input.scope_basis={};
  bad.request={...bad.request,questions:{voice:bad.request.questions.voice!}};
 }
 bad.request_digest=signalListeningRequestDigestV1(f.run,input,bad.request);
 if(defect==='digest')bad.request_digest='sha256:'+'e'.repeat(64);
 bad.custom_id='listening_'+bad.request_digest.slice(7,67);
 await assert.rejects(transaction(f,c=>insertPrepared(c,f,rows).then(()=>{})),
  defect==='text'||defect==='digest'?/listening_request_invalid/:/listening_call_questions_invalid/);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,0);
}));

test('materialized selected matches the old native validator and atomically rejects forged siblings',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const sources=await Promise.all(['0318_signal_listening_statement_population.sql','0322_signal_listening_statement_selected_materialization.sql']
  .map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));
 // The exact native validation statements run against the same native owner,
 // population and typed batch. No public trigger is replaced for the oracle.
 const validators=sources.map(source=>{
  const text=source.match(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/u)?.[1];assert.ok(text);
  assert.equal((text.match(/%s/g)??[]).length,1);
  return text.replace('%s','SELECT n.* FROM jsonb_to_recordset($8::jsonb) n(id uuid,inputs jsonb,request jsonb,request_digest text)');
 });
 const owner=(await f.database.query(`SELECT o.configuration_id,o.map_id,c.configuration_digest FROM signal_listening_runs o
  JOIN signal_listening_configurations c ON c.id=o.configuration_id AND c.workspace_id=o.workspace_id
  WHERE o.run_id=$1 AND o.workspace_id=$2`,[f.run.id,f.run.workspace_id])).rows[0];assert.ok(owner);
 async function oracle(c:PoolClient,rows:ReturnType<typeof proposals>){
  const params=[f.run.id,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,
   f.inputs.map(i=>i.root_id),owner.configuration_digest,JSON.stringify(rows)];
  const outputs=[];
  for(const sql of validators){
   const flags=(await c.query(sql,params)).rows[0];
   const end=sql.indexOf('\n   SELECT COALESCE(');assert.ok(end>0);
   const perCall=(await c.query(sql.slice(0,end)+"\nSELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) expected FROM expected e WHERE $1::uuid IS NOT NULL AND $7::text IS NOT NULL",params)).rows[0].expected;
   assert.equal(perCall.length,rows.length);outputs.push({flags,perCall});
  }
  assert.deepEqual(outputs[1],outputs[0],'materialization preserves all three flags and exact per-call request/digest/basis aggregates');
  return outputs[1]!.flags;
 }
 await transaction(f,async c=>{
  const flags=await oracle(c,structuredClone(proposals(f,1000)));
  assert.deepEqual(flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});
 });
 for(const defect of ['text','request_digest','question_digest','duplicate_question','input_digest','map_id','configuration_digest','scope_basis']as const){
  const rows=structuredClone(proposals(f,1000)),bad=rows[1]!,input=bad.inputs[0]!;
  if(defect==='text'){input.text+=' forged text';bad.request={...bad.request,state:input.text};}
  if(defect==='question_digest')input.question_digests={...input.question_digests,voice:'sha256:'+'f'.repeat(64)};
  if(defect==='duplicate_question'){input.question_keys=['voice','voice'];input.question_digests={voice:input.question_digests.voice!};input.scope_basis={};bad.request={...bad.request,questions:{voice:bad.request.questions.voice!}};}
  if(defect==='input_digest')input.input_digest='sha256:'+'0'.repeat(64);
  if(defect==='map_id')input.map_id=randomUUID();
  if(defect==='configuration_digest')input.configuration_digest='sha256:'+'1'.repeat(64);
  if(defect==='scope_basis')input.scope_basis={voice:'sha256:'+'2'.repeat(64)};
  bad.request_digest=signalListeningRequestDigestV1(f.run,input,bad.request);
  if(defect==='request_digest')bad.request_digest='sha256:'+'e'.repeat(64);
  bad.custom_id='listening_'+bad.request_digest.slice(7,67);
  await transaction(f,async c=>{
   const flags=await oracle(c,rows);assert.equal(flags.invalid_prior,false);
   assert.equal(defect==='text'||defect==='request_digest'?flags.invalid_request:flags.invalid_questions,true,defect);
  });
  await assert.rejects(transaction(f,c=>insertPrepared(c,f,rows).then(()=>{})),
   defect==='text'||defect==='request_digest'?/listening_request_invalid/:/listening_call_questions_invalid/,defect);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0,'valid siblings roll back with '+defect);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,0,'no question links survive '+defect);
 }
 await transaction(f,async c=>{
  const calls=(await insert(c,f,1000)).rows;assert.equal(calls.length,3);
  const marked=await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[]) AND status='reserved' RETURNING id",[calls.map(row=>row.id)]);
  assert.equal(marked.rows.length,3,'the new guard still admits genuine native insert and mark statements');
 });
}));

test('native statement root selector deduplicates before bounding and never accepts NULL as full population',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const root=f.inputs[0]!.root_id;
 assert.deepEqual((await f.database.query('SELECT signal_listening_statement_roots_v1($1::uuid[]) roots',[Array(8192).fill(root)])).rows[0].roots,[root]);
 for(const values of [null,[],[null]])await assert.rejects(
  f.database.query('SELECT signal_listening_statement_roots_v1($1::uuid[])',[values]),/listening_statement_roots_invalid/);
 assert.equal((await f.database.query('SELECT cardinality(signal_listening_statement_roots_v1(ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4096)))) n')).rows[0].n,4096);
 await assert.rejects(f.database.query('SELECT signal_listening_statement_roots_v1(ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4097)))'),/listening_statement_roots_invalid/);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0);
}));
test('native SQL rolls back an entire Listening batch when each reservation fits but their sum exceeds the run cap',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1500,async f=>{
 await assert.rejects(transaction(f,c=>insert(c,f,1000).then(()=>{})),/labeling_cap_exhausted|processing_execution_cap_exhausted/);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0);
}));
test('native insert and mark statements each evaluate organization exposure once, with immutable requests and physical lease checks',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 await transaction(f,async c=>{
  await c.query("SET LOCAL track_functions='all'");const before=await exposureCalls(c);
  const calls=(await insert(c,f,1000)).rows;assert.equal(calls.length,3);
  assert.equal(await exposureCalls(c)-before,1,'SQL must check the final batch, rather than scan all money once per row');
  const beforeMark=await exposureCalls(c);
  assert.equal((await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[]) RETURNING id",[calls.map(row=>row.id)])).rows.length,3);
  assert.equal(await exposureCalls(c)-beforeMark,1,'mark-sent must independently check the entire statement');
 });
 const rows=(await f.database.query('SELECT status,request_digest,reserved_micro_usd::text FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows;
 assert.equal(rows.length,3);assert.ok(rows.every(row=>row.status==='submitting'&&row.reserved_micro_usd==='1000'));
 await assert.rejects(transaction(f,async c=>{
  await c.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE run_id=$1 AND status='reserved'",[f.run.id]);
  await insert(c,f,1000);
 }),/listening_call_invalid|labeling_lease_lost|processing_admission_invalid/);
}));

async function waitForBlock(f:Pick<NativeFixture,'database'>,pid:number,blocker:number){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  if((await f.database.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked',[pid,blocker])).rows[0].blocked)return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('native_money_contender_did_not_wait_on_expected_lock');
}
test('competing native SQL batches cannot each spend the same remaining run budget',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1500,async f=>{
 const first=await f.database.connect(),second=await f.database.connect();let pending:Promise<unknown>|undefined;
 try{
  await first.query('BEGIN');await second.query('BEGIN');
  await first.query("SET LOCAL statement_timeout='15s'");await second.query("SET LOCAL statement_timeout='15s'");
  const firstPid=Number((await first.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  const secondPid=Number((await second.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  await insert(first,f,1000,[f.inputs[0]!]);
  // Attach a rejection handler immediately, before deliberately holding its lock.
  pending=insert(second,f,1000,[f.inputs[1]!]).then(value=>({value}),error=>({error}));
  await waitForBlock(f,secondPid,firstPid);await first.query('COMMIT');
  const outcome=await pending as{error?:Error};assert.match(outcome.error?.message??'',/labeling_cap_exhausted/);
  await second.query('ROLLBACK');
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,1);
 }finally{await first.query('ROLLBACK').catch(()=>{});await second.query('ROLLBACK').catch(()=>{});await pending;first.release();second.release();}
}));
for(const mutation of ['lease','policy','actor']as const)test('native mark rejects '+mutation+' changed while waiting on its original policy lock',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 await transaction(f,c=>insert(c,f,1000).then(()=>{}));
 const holder=await f.database.connect(),contender=await f.database.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await contender.query('BEGIN');
  await holder.query("SET LOCAL statement_timeout='15s'");await contender.query("SET LOCAL statement_timeout='15s'");
  const holderPid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  const contenderPid=Number((await contender.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization_id::text,0)) FROM signal_workspaces WHERE id=$1",[f.run.workspace_id]);
  pending=contender.query("UPDATE signal_labeling_calls SET status='submitting' WHERE run_id=$1 AND status='reserved'",[f.run.id])
   .then(value=>({value}),error=>({error}));
  await waitForBlock(f,contenderPid,holderPid);
  if(mutation==='lease')await holder.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  if(mutation==='policy')await holder.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=(SELECT policy_version_id FROM signal_processing_admissions WHERE id=$1)",[f.run.processing_admission_id]);
  if(mutation==='actor')await holder.query("UPDATE users SET status='suspended' WHERE id=$1",[f.run.actor_user_id]);
  await holder.query('COMMIT');
  const result=await pending as{error?:Error};assert.match(result.error?.message??'',/labeling_lease_lost|processing_policy_expired|processing_forbidden/);
  await contender.query('ROLLBACK');
  const states=(await f.database.query('SELECT status FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows;
  assert.equal(states.length,3);assert.ok(states.every(row=>row.status==='reserved'),'no request became sendable after the authority change');
 }finally{await holder.query('ROLLBACK').catch(()=>{});await contender.query('ROLLBACK').catch(()=>{});await pending;holder.release();contender.release();}
}));

test('Listening and a genuine Sonnet owner in another workspace cannot reserve the same organization day budget',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const sibling=f.editorial;assert.ok(sibling);
 const sealed=(await f.database.query(`SELECT e.hard_cap_micro_usd::text cap,
  (SELECT COALESCE(sum(r.reserved_micro_usd),0)::text FROM signal_topic_editorial_requests r WHERE r.execution_id=e.id) all_requests,
  request.request_digest,request.reserved_micro_usd::text first_request
  FROM signal_topic_editorial_executions e CROSS JOIN LATERAL(SELECT r.request_digest,r.reserved_micro_usd
   FROM signal_topic_editorial_requests r WHERE r.execution_id=e.id ORDER BY batch_index,request_digest LIMIT 1) request
  WHERE e.id=$1`,[sibling.execution_id])).rows[0];assert.ok(sealed);
 console.log('# native cross-ledger frozen request budget '+JSON.stringify(sealed));
 assert.ok(BigInt(sealed.first_request)>0n&&BigInt(sealed.first_request)<=BigInt(sealed.cap),'the first canonical request fits its original immutable owner cap');
 // Prove the Sonnet owner's own cap and sealed requests are independently
 // sufficient, using the real native reservation and a physical rollback.
 const positive=await f.database.connect();
 try{await positive.query('BEGIN');
  await positive.query('SELECT prepare_signal_topic_editorial_batch_v2($1,$2::text[],$3)',[sibling.execution_id,[sealed.request_digest],'money-positive-'+randomUUID()]);
  assert.ok(Number((await positive.query('SELECT count(*)::int n FROM signal_topic_editorial_calls WHERE execution_id=$1',[sibling.execution_id])).rows[0].n)>0);
  await positive.query('ROLLBACK');
 }finally{await positive.query('ROLLBACK').catch(()=>{});positive.release();}
 const attempts=await Promise.allSettled([
  prepareSignalTopicEditorialBatchV2({database:f.database,execution_id:sibling.execution_id,request_digests:[sealed.request_digest],submission_key:'money-race-'+randomUUID()}),
  transaction(f,c=>insert(c,f,sibling.cap,[f.inputs[0]!]).then(()=>{})),
 ]);
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1,'one finite shared budget funds at most one competing owner');
 const denied=attempts.find((result):result is PromiseRejectedResult=>result.status==='rejected');assert.ok(denied);
 assert.match(String(denied.reason),/daily_cap_exhausted|daily_budget_exhausted|topic_editorial_v2_cap_exhausted/);
 const money=(await f.database.query('SELECT total_micro_usd::text n FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)',[sibling.organization_id,sibling.budget_timezone])).rows[0];
 assert.ok(BigInt(money.n)<=BigInt(sibling.daily_cap_micro_usd));
 const rows=(await f.database.query(`SELECT
  (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1) labeling,
  (SELECT count(*)::int FROM signal_topic_editorial_calls WHERE execution_id=$2) sonnet,
  (SELECT count(*)::int FROM signal_labeling_calls WHERE run_id=$1 AND status<>'reserved') labeling_sent,
  (SELECT count(*)::int FROM signal_topic_editorial_calls WHERE execution_id=$2 AND status<>'reserved') sonnet_sent`,[f.run.id,sibling.execution_id])).rows[0];
 assert.equal(Number(rows.labeling>0)+Number(rows.sonnet>0),1);assert.equal(rows.labeling_sent+rows.sonnet_sent,0);
 if(String(denied.reason).includes('topic_editorial_v2_cap_exhausted')){
  assert.equal(rows.sonnet,0);assert.equal(rows.labeling,1);
  assert.equal(BigInt(money.n),BigInt(sibling.daily_cap_micro_usd),'the independently viable Sonnet owner lost only after Listening filled the shared day');
 }
},true));

test('a final native child batch includes its siblings and checks parent exposure once without losing settled history',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const store=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});
 async function enqueue(){
  const lease=await store.claim({database:f.database,execution_id:f.execution.id});assert.ok(lease);
  const subset=await store.ensureSubset({database:f.database,lease,generation_id:lease.source_generation_id});
  const numeric=await f.emptyNumeric(subset);await store.persistNumeric({database:f.database,lease,subset_id:subset.id,numeric});
  const round=await store.enqueue({database:f.database,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,
   expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,
   numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});
  assert.ok(round&&round.status!=='budget_exhausted');await store.release({database:f.database,lease});return round as ListeningDiscoveryRoundV1;
 }
 const first=await f.finishRound(await enqueue());await activateSignalListeningServingSnapshotV1({...f,round_id:first.id});
 await f.finishRound(await enqueue(),3,async(run_id,configuration)=>{
  const children=(await f.database.query('SELECT run_id FROM signal_listening_discovery_children WHERE execution_id=$1 AND round_id IS NOT NULL',[f.execution.id])).rows;
  assert.equal(children.length,2,'two real completed/prepared child owners share the original parent cap');
  const labeling=createSignalListeningStoreV1({database:f.database,storeRaw:async()=>{throw Error('no provider');}});
  const run=await labeling.claim(run_id);assert.ok(run);const inputs=await labeling.inputs(run);assert.equal(inputs.length,3);
  const c=await f.database.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL track_functions='all'");
   const parentBefore=BigInt((await c.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);
   assert.ok(parentBefore>0n);
   const fn='signal_listening_discovery_exposure_v1(uuid,text,uuid)',before=await exposureCalls(c,fn);
   await insert(c,{run,inputs,configuration},1000);
   assert.equal(await exposureCalls(c,fn)-before,1,'the parent checks all inserted calls once, after the statement');
   const parentAfter=BigInt((await c.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);
   assert.equal(parentAfter,parentBefore+3000n);assert.ok(parentAfter<=BigInt(f.execution.cap_micro_usd));
   await c.query('ROLLBACK');
   assert.equal(BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n),parentBefore);
  }finally{await c.query('ROLLBACK').catch(()=>{});c.release();await labeling.release(run);}
 });
}));

for(const operation of ['insert','mark']as const)test('direct native child '+operation+' waits for policy before locking the parent',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const advances=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});
 const lease=await advances.claim({database:f.database,execution_id:f.execution.id});assert.ok(lease);
 const subset=await advances.ensureSubset({database:f.database,lease,generation_id:lease.source_generation_id});
 const numeric=await f.emptyNumeric(subset);await advances.persistNumeric({database:f.database,lease,subset_id:subset.id,numeric});
 const round=await advances.enqueue({database:f.database,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,
  expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,
  numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});assert.ok(round&&round.status!=='budget_exhausted');
 await advances.release({database:f.database,lease});
 const child=await f.prepareRoundChild(round as ListeningDiscoveryRoundV1);
 const labeling=createSignalListeningStoreV1({database:f.database,storeRaw:async()=>{throw Error('no provider or receipt writes in lock-order acceptance');}});
 const run=await labeling.claim(child.run_id);assert.ok(run);const inputs=await labeling.inputs(run);assert.equal(inputs.length,3);
 const requests={run,inputs,configuration:child.configuration};
 if(operation==='mark'){
  const setup=await f.database.connect();try{await setup.query('BEGIN');await insert(setup,requests,1000);await setup.query('COMMIT');}
  catch(error){await setup.query('ROLLBACK');throw error;}finally{setup.release();}
 }
 const holder=await f.database.connect(),sender=await f.database.connect();let pending:Promise<{error?:Error;value?:unknown}>|undefined;
 try{
  await holder.query('BEGIN');await sender.query('BEGIN');
  await holder.query("SET LOCAL statement_timeout='15s'");await sender.query("SET LOCAL statement_timeout='15s'");
  const holderPid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  const senderPid=Number((await sender.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  // This is the native complete/advance order: policy, organization day,
  // mutable actor, then parent. The competing SQL has no adapter prelock.
  await lockSignalListeningDiscoveryPolicyWithClientV1(holder,f.workspace_id);
  await holder.query('SELECT signal_processing_lock_actor_v1($1,$2)',[f.workspace_id,f.actor_user_id]);
  pending=(operation==='insert'?insert(sender,requests,1000):sender.query(
   "UPDATE signal_labeling_calls SET status='submitting' WHERE run_id=$1 AND status='reserved' RETURNING id",[run.id]))
   .then(value=>({value}),error=>({error}));
  await waitForBlock(f,senderPid,holderPid);
  // Before the fix z_child_capacity held this row while waiting for the
  // holder's policy lock. NOWAIT proves absence of that reversed lock edge.
  assert.equal((await holder.query('SELECT id FROM signal_listening_discovery_executions WHERE id=$1 FOR UPDATE NOWAIT',[f.execution.id])).rows.length,1);
  await holder.query('COMMIT');const outcome=await pending;
  assert.equal(outcome.error,undefined,'the direct SQL must finish without deadlock after policy is released');
  const states=(await sender.query('SELECT status FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows;
  assert.equal(states.length,3);assert.ok(states.every(row=>row.status===(operation==='insert'?'reserved':'submitting')));
  await sender.query('ROLLBACK');
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,operation==='insert'?0:3);
 }finally{
  await holder.query('ROLLBACK').catch(()=>{});await sender.query('ROLLBACK').catch(()=>{});await pending;
  holder.release();sender.release();await labeling.release(run);
 }
}));

test('RAW-backed settlement recovery and unsent requeue preserve Listening money after the statement guard',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const calls=await f.store.reserve(f.run,proposals(f,1000));await f.store.markSubmitting(f.run,calls);
 assert.ok(f.store.requeueUnsent);await f.store.requeueUnsent(f.run,[calls[2]!]);
 const exposure=async()=>BigInt((await f.database.query(`SELECT COALESCE(sum(CASE WHEN status IN('settled','failed')
  THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)::text n
  FROM signal_labeling_calls WHERE run_id=$1`,[f.run.id])).rows[0].n);
 assert.equal(await exposure(),3000n);
 const responses=calls.slice(0,2).map(call=>{
  const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,f.configuration);
  const response={model:f.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
   ?{type:'noul' as const,noul:.1}:{type:'choice' as const,choice:'individual',confidence:.9,
    probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
  return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),
   result:mapSignalListeningJevResponseV1(input,f.run.context,f.configuration,response)};
 });
 await f.store.persistRawPage(f.run,responses);
 let lost=false;
 // settlePage is one native autocommit UPDATE, so its real acknowledgement
 // boundary is database.query completion rather than an explicit COMMIT call.
 const database=Object.assign(Object.create(f.database),{query:async(sql:string,values?:unknown[])=>{
  const result=await f.database.query(sql,values);
  if(sql.includes("UPDATE signal_labeling_calls c SET status='settled'")&&!lost){lost=true;throw Error('synthetic_settlement_commit_ack_lost');}
  return result;
 },connect:f.database.connect.bind(f.database)});
 const recovering=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
 const settled=responses.map(row=>({call:row.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6}));
 await recovering.settlePage(f.run,settled).catch(error=>assert.match(String(error),/synthetic_settlement_commit_ack_lost/));
 assert.equal(lost,true);await f.store.settlePage(f.run,settled);await f.store.settlePage(f.run,settled);
 await f.store.apply(f.run,responses.map(row=>({call:row.call,results:[row.result]})));
 await f.store.markSubmitting(f.run,[calls[2]!]);
 await f.database.query("UPDATE signal_labeling_calls SET status='unknown' WHERE id=$1",[calls[2]!.id]);
 assert.equal(await exposure(),1012n,'two exact settlements plus the unknown reservation remain charged once');
 const held=(await f.database.query('SELECT status,settled_micro_usd::text,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=$1',[calls[2]!.id])).rows[0];
 assert.equal(held.status,'unknown');assert.equal(held.settled_micro_usd,null);assert.equal(held.reserved_micro_usd,'1000');
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,3);
}));
