import {loadWireObserverContractV1,attestWireObserverRuntimeV1} from './signal-listening-wire-observer.test-support';
import {withSharedWireDefaultPostcheckV1} from './signal-listening-statement-shared-wire.oracle';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
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
import {readSignalLabelingRunExposureV1,type LabelingRunV1} from '../signal-labeling-runs';
import {getSignalListeningStatusV1} from '../signal-listening-serving';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {prepareSyntheticSiblingEditorialPolicyV1,loadSyntheticSiblingEditorialDeadlineV1} from './signal-mfp-mass-labeling-sibling.synthetic.fixture';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {quoteSignalTopicEditorialChunkedAdmissionV3,requestSignalTopicEditorialChunkedAdmissionV3} from '../signal-topic-editorial-admission-v3';
import {prepareSignalTopicEditorialBatchV2} from '../signal-topic-editorial-batch-v2';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {createSignalListeningDiscoveryAdvanceStoreV1} from '../signal-listening-discovery-advance';
import {activateSignalListeningServingSnapshotV1,lockSignalListeningDiscoveryPolicyWithClientV1,type ListeningDiscoveryRoundV1} from '../signal-listening-discovery-money';

import {anchorListeningStatementOracleParametersV1,listeningExpectedProjectionOracleSqlV1} from './signal-listening-statement-validator.oracle';
import {listeningTransitionSetReferencesV1,assertListeningTransitionSetOracleV1} from './signal-listening-transition-set.oracle';
import {ownerTargetSetReferencesV1,assertOwnerTargetSetOracleV1} from './signal-listening-owner-target-sets.oracle';
import {answerGuardBefore0334SqlV1,answerGuardBefore0334BodySha256V1,answerGuardAfter0334BodySha256V1,answerGuardAfter0334LookupV1,
 answerGuardBodyV1,answerGuardShaV1,assertAnswerGuard0334SourceV1} from './signal-listening-answer-guard.oracle';
import {answerGuardBefore0339SqlV1,answerGuard0339LookupV1,answerGuardAfter0339BodySha256V1,
 assertAnswerGuard0339SourceV1,answerGuard0339WitnessSqlV1} from './signal-listening-answer-guard-narrow.oracle';

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
 const wireObserver=await loadWireObserverContractV1(),before=await attestWireObserverRuntimeV1(f.database,wireObserver);
 await withSharedWireDefaultPostcheckV1(()=>transaction(f,async c=>{
  assert.deepEqual(await attestWireObserverRuntimeV1(c,wireObserver),before,'counter attests the same actual E producer before tracking');
  await c.query("SET LOCAL track_functions='all'");
  const population=wireObserver.populationSignature;
  const authority='signal_listening_call_authority_v1(uuid,date,text,timestamptz)';
  const beforePopulation=await exposureCalls(c,population),beforeAuthority=await exposureCalls(c,authority);
  const calls=(await insert(c,f,1000)).rows;assert.equal(calls.length,3);
  assert.equal(await exposureCalls(c,population)-beforePopulation,1,'all three roots must share one statement-local population');
  assert.equal(await exposureCalls(c,authority)-beforeAuthority,2,'authority is checked before validation and after final exposure');
  const beforeMark=await exposureCalls(c,population),beforeMarkAuthority=await exposureCalls(c,authority);
  await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",[calls.map(row=>row.id)]);
  assert.equal(await exposureCalls(c,population)-beforeMark,1,'mark must read another population even in the same transaction');
  assert.equal(await exposureCalls(c,authority)-beforeMarkAuthority,2,'mark retains both physical authority fences');
  assert.deepEqual(await attestWireObserverRuntimeV1(c,wireObserver),before,'measured E body/signature/OID/owner/ACL/attrs remain unchanged');
 }),async()=>{assert.deepEqual(await attestWireObserverRuntimeV1(f.database,wireObserver),before,'catalog is unchanged after the real COMMIT or ROLLBACK; tracking uses SET LOCAL only');});
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

test('selected materialization and full join match old validators and atomically reject forged siblings',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const sources=await Promise.all(['0318_signal_listening_statement_population.sql','0322_signal_listening_statement_selected_materialization.sql','0323_signal_listening_statement_selected_full_join.sql','0328_signal_listening_owner_target_sets.sql','0329_signal_listening_expected_projection.sql']
  .map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));
 // The exact native validation statements run against the same native owner,
 // population and typed batch. No public trigger is replaced for the oracle.
 const validators=sources.map(source=>{
  const text=source.match(/EXECUTE format\(\$validation\$([\s\S]*?)\$validation\$,batch_sql\)/u)?.[1];assert.ok(text);
  assert.equal((text.match(/%s/g)??[]).length,1);
  return text.replace('%s','SELECT n.* FROM jsonb_populate_recordset(NULL::signal_labeling_calls,$8::jsonb) n');
 });
 const owner=(await f.database.query(`SELECT o.configuration_id,o.map_id,c.configuration_digest FROM signal_listening_runs o
  JOIN signal_listening_configurations c ON c.id=o.configuration_id AND c.workspace_id=o.workspace_id
  WHERE o.run_id=$1 AND o.workspace_id=$2`,[f.run.id,f.run.workspace_id])).rows[0];assert.ok(owner);
 async function oracle(c:PoolClient,rows:ReturnType<typeof proposals>,missingSelectedId?:string,exactBatchJson?:string){
  const params=[f.run.id,f.run.workspace_id,owner.configuration_id,owner.map_id,f.run.entity_context_digest,
   f.inputs.map(i=>i.root_id),owner.configuration_digest,exactBatchJson??JSON.stringify(rows)];
  const outputs=[];
  for(const sql of validators){
   const flags=(await c.query(anchorListeningStatementOracleParametersV1(sql),params)).rows[0];
   const projected=await c.query(listeningExpectedProjectionOracleSqlV1(sql),params);
   const exact=(await c.query(listeningExpectedProjectionOracleSqlV1(sql,true),params)).rows.map(r=>r.value as string);
   const perCall=exact.map(value=>JSON.parse(value));
   const metadata=projected.fields.map(field=>({name:field.name,type:field.dataTypeID,modifier:field.dataTypeModifier,size:field.dataTypeSize,format:field.format}));
   assert.deepEqual(metadata.map(({name,type})=>({name,type})),[
    {name:'id',type:2950},{name:'request',type:3802},{name:'request_digest',type:25},{name:'i',type:3802},
    {name:'selected_count',type:23},{name:'digests',type:3802},{name:'basis',type:3802},{name:'expected_request',type:3802}]);
   if(exactBatchJson){
    // The probe modifies JSON batch index 0; SQL orders independently by UUID.
    // Parse only its identity, then inspect both exact values in that same row.
    const probeIndex=perCall.findIndex((row:{id:string})=>row.id===rows[0]!.id);assert.ok(probeIndex>0,'descending UUID input places the precise call after the first ascending SQL result');
    const probe=exact[probeIndex]!;
    assert.ok(probe.includes('1234567890.1234567890123456789'),'SQL JSON text retains arbitrary JSONB numeric precision');
    assert.ok(probe.includes('00:00:00.123456'),'input JSON timestamp microseconds survive projection');
   }
   assert.equal(perCall.length,rows.length);
   assert.deepEqual(perCall.map((row:{id:string})=>row.id).sort(),rows.map(row=>row.id).sort(),'FULL never adds an unmatched-right ID or drops a batch call');
   if(missingSelectedId){const missing=perCall.find((row:{id:string})=>row.id===missingSelectedId);assert.ok(missing);assert.equal(missing.selected_count,null,'a call with no selected question survives the join');}
   outputs.push({flags,exact,metadata});
  }
  for(const output of outputs.slice(1))assert.deepEqual(output,outputs[0],'all validators preserve three flags, eight typed expected values, NULLs, multiplicity and exact JSON bytes');
  return outputs.at(-1)!.flags;
 }
 await transaction(f,async c=>{
  const flags=await oracle(c,structuredClone(proposals(f,1000)));
  assert.deepEqual(flags,{invalid_questions:false,invalid_request:false,invalid_prior:false});
  assert.deepEqual(await oracle(c,[]),flags,'empty expected relations retain all three flags');
  const rows=structuredClone(proposals(f,1000)).sort((a,b)=>a.id>b.id?-1:a.id<b.id?1:0);
  const precise=(await c.query(`SELECT jsonb_set(jsonb_set($1::jsonb,'{0,inputs,0,native_precision_probe}',
   '1234567890.1234567890123456789'::jsonb),'{0,inputs,0,published_at}','"2026-01-01T00:00:00.123456Z"'::jsonb)::text batch`,[JSON.stringify(rows)])).rows[0].batch;
  assert.deepEqual(await oracle(c,rows,undefined,precise),flags,'precision probes in unread input metadata never alter validation');
 });
 for(const defect of ['text','request_digest','question_digest','duplicate_question','input_digest','map_id','configuration_digest','scope_basis','empty_questions']as const){
  const rows=structuredClone(proposals(f,1000)),bad=rows[1]!,input=bad.inputs[0]!;
  if(defect==='text'){input.text+=' forged text';bad.request={...bad.request,state:input.text};}
  if(defect==='question_digest')input.question_digests={...input.question_digests,voice:'sha256:'+'f'.repeat(64)};
  if(defect==='duplicate_question'){input.question_keys=['voice','voice'];input.question_digests={voice:input.question_digests.voice!};input.scope_basis={};bad.request={...bad.request,questions:{voice:bad.request.questions.voice!}};}
  if(defect==='input_digest')input.input_digest='sha256:'+'0'.repeat(64);
  if(defect==='map_id')input.map_id=randomUUID();
  if(defect==='configuration_digest')input.configuration_digest='sha256:'+'1'.repeat(64);
  if(defect==='scope_basis')input.scope_basis={voice:'sha256:'+'2'.repeat(64)};
  if(defect==='empty_questions'){input.question_keys=[];input.question_digests={};input.scope_basis={};bad.request={...bad.request,questions:{}};}
  bad.request_digest=signalListeningRequestDigestV1(f.run,input,bad.request);
  if(defect==='request_digest')bad.request_digest='sha256:'+'e'.repeat(64);
  bad.custom_id='listening_'+bad.request_digest.slice(7,67);
  await transaction(f,async c=>{
   const flags=await oracle(c,rows,defect==='empty_questions'?bad.id:undefined);assert.equal(flags.invalid_prior,false);
   assert.equal(defect==='text'||defect==='request_digest'?flags.invalid_request:flags.invalid_questions,true,defect);
  });
  await assert.rejects(transaction(f,c=>insertPrepared(c,f,rows).then(()=>{})),
   defect==='text'||defect==='request_digest'?/listening_request_invalid/:/listening_call_questions_invalid/,defect);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,0,'valid siblings roll back with '+defect);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,0,'no question links survive '+defect);
 }
 const selectors=await listeningTransitionSetReferencesV1(),targetSelectors=await ownerTargetSetReferencesV1();let nativeIds:string[]=[];
 await transaction(f,async c=>{
  const calls=(await insert(c,f,1000)).rows;assert.equal(calls.length,3);nativeIds=calls.map(row=>row.id);
  const persisted=(await c.query('SELECT to_jsonb(call) value FROM signal_labeling_calls call WHERE run_id=$1 ORDER BY id',[f.run.id])).rows.map(r=>r.value as Record<string,unknown>);
  assert.deepEqual(await oracle(c,persisted as ReturnType<typeof proposals>),{invalid_questions:false,invalid_request:false,invalid_prior:false},'complete actual native call rows retain validation despite unused ledger fields');
  // Counterfactual transition relations only: no forged call or admission is
  // written. Actual table records supply the complete named row descriptor.
  const old=persisted.map(row=>({...row,created_at:'2026-01-01T00:00:00.123456Z'}));
  const next=old.map(row=>({...row,status:'submitting'}));
  const valid=await assertListeningTransitionSetOracleV1(c,selectors,f.run.id,next,old);
  assert.equal(valid.length,3);assert.ok(valid.every(row=>String(row.created_at).includes('.123456')));
  assert.deepEqual(await assertOwnerTargetSetOracleV1(c,targetSelectors.listening,next,old),[{array_agg:[f.run.id]}]);
  assert.deepEqual(await assertOwnerTargetSetOracleV1(c,targetSelectors.scoped,next,old),[],'native Listening admission is not a historical scoped admission');
  const oldFirst=old[0]!,nextFirst=next[0]!;
  const variants:Array<[unknown[],unknown[]]>=[
   [[],[]],[next,[]],[[],old],
   [[{...nextFirst,id:randomUUID()},...next.slice(1)],old],
   [[{...nextFirst,run_id:randomUUID()},...next.slice(1)],old],
   [[{...nextFirst,workspace_id:randomUUID()},...next.slice(1)],old],
   [next.map(row=>({...row,workspace_id:randomUUID()})),old],
   [next.map(row=>({...row,run_id:randomUUID()})),old],
   [[{...nextFirst,id:null},...next.slice(1)],[{...oldFirst,id:null},...old.slice(1)]],
   [[...next,nextFirst],[...old,oldFirst]],
   [next.map(row=>({...row,status:'settled'})),old],
   [next,old.map(row=>({...row,status:'submitted'}))],
  ];
  for(const [n,o]of variants){
   await assertListeningTransitionSetOracleV1(c,selectors,f.run.id,n,o);
   await assertOwnerTargetSetOracleV1(c,targetSelectors.listening,n,o);await assertOwnerTargetSetOracleV1(c,targetSelectors.scoped,n,o);
  }
  assert.deepEqual(await assertOwnerTargetSetOracleV1(c,targetSelectors.listening,[],old),[{array_agg:null}],'an empty target aggregate stays NULL, not an empty array');
 });
 const snapshot=async()=>({calls:(await f.database.query('SELECT to_jsonb(call) value FROM signal_labeling_calls call WHERE run_id=$1 ORDER BY id',[f.run.id])).rows,
  links:(await f.database.query('SELECT to_jsonb(link) value FROM signal_listening_call_questions link WHERE run_id=$1 ORDER BY call_id,question_key',[f.run.id])).rows});
 const beforeChangedId=await snapshot(),changedId=randomUUID();
 await assert.rejects(transaction(f,async c=>{
  await c.query("UPDATE signal_labeling_calls SET id=CASE WHEN id=$2::uuid THEN $3::uuid ELSE id END,status='submitting' WHERE id=ANY($1::uuid[])",
   [nativeIds.slice(0,2),nativeIds[1],changedId]);
 }),error=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='P0001'&&'message'in error&&String(error.message)==='listening_call_immutable',
 'the existing native BEFORE guard rejects changed ID with a valid sibling, without changing its authority');
 assert.deepEqual(await snapshot(),beforeChangedId,'the rejected native UPDATE leaves every call and question link unchanged');
 await transaction(f,async c=>{
  const marked=await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[]) AND status='reserved' RETURNING id",[nativeIds]);
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
 const access={database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id};
 const statusMoney=async(expected:[string,string,string])=>{
  const status=await getSignalListeningStatusV1(access);assert.equal(status.run?.id,f.run.id);assert.ok(status.run);
  const amounts=[status.run.confirmed_micro_usd,status.run.reserved_micro_usd,status.run.unknown_micro_usd];assert.deepEqual(amounts,expected);
  assert.ok(amounts.every(value=>typeof value==='string'&&/^\d+$/u.test(value)),'DTO amounts retain exact integer text');
  const c=await f.database.connect();try{assert.equal(amounts.reduce((sum,value)=>sum+BigInt(value),0n).toString(),await readSignalLabelingRunExposureV1(c,f.run.id),'three disjoint monetary buckets reconcile to native run exposure');}finally{c.release();}
  return status.run;
 };
 await statusMoney(['0','0','0']);
 await assert.rejects(getSignalListeningStatusV1({...access,workspace_id:randomUUID()}),/listening_forbidden/);
 const calls=await f.store.reserve(f.run,proposals(f,1000));await statusMoney(['0','3000','0']);await f.store.markSubmitting(f.run,calls);
 assert.ok(f.store.requeueUnsent);await f.store.requeueUnsent(f.run,[calls[2]!]);
 const exposure=async()=>BigInt((await f.database.query(`SELECT COALESCE(sum(CASE WHEN status IN('settled','failed')
  THEN COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd ELSE reserved_micro_usd END),0)::text n
  FROM signal_labeling_calls WHERE run_id=$1`,[f.run.id])).rows[0].n);
 assert.equal(await exposure(),3000n);
 await f.store.markFailed(f.run,[calls[1]!],true);
 await statusMoney(['0','2000','1000']);
 const responses=calls.slice(0,2).map(call=>{
  const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,f.configuration);
  const response={model:f.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
   ?{type:'noul' as const,noul:.1}:{type:'choice' as const,choice:'individual',confidence:.9,
    probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
  return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),
   result:mapSignalListeningJevResponseV1(input,f.run.context,f.configuration,response)};
 });
 await f.store.persistRawPage(f.run,responses);
 // Page membership is admitted from submitting/unknown, before submitted.
 await f.store.markSubmitted(f.run,[calls[0]!],null);await statusMoney(['0','2000','1000']);
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
 await statusMoney(['12','1000','0']);
 await f.store.apply(f.run,responses.map(row=>({call:row.call,results:[row.result]})));
 await f.store.markSubmitting(f.run,[calls[2]!]);
 await f.store.markFailed(f.run,[calls[2]!],true);await statusMoney(['12','0','1000']);
 assert.equal(await exposure(),1012n,'two exact settlements plus the unknown reservation remain charged once');
 const held=(await f.database.query('SELECT status,settled_micro_usd::text,reserved_micro_usd::text FROM signal_labeling_calls WHERE id=$1',[calls[2]!.id])).rows[0];
 assert.equal(held.status,'unknown');assert.equal(held.settled_micro_usd,null);assert.equal(held.reserved_micro_usd,'1000');
 await f.store.fail(f.run,'labeling_raw_receipt_invalid');const failed=await statusMoney(['1012','0','0']);assert.equal(failed.status,'failed');
 assert.equal((await f.database.query('SELECT status,settled_micro_usd::text cost FROM signal_labeling_calls WHERE id=$1',[calls[2]!.id])).rows[0].cost,'1000','the real invalid-RAW failure retains its conservatively booked amount');
 await f.store.fail(f.run,'labeling_raw_receipt_invalid');await statusMoney(['1012','0','0']);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,3);
}));


// These are genuine Listening admissions/receipts. Interception only holds an
// already executed native lock; it never approves authority or replaces SQL.
const pageDelay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function pageDeferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
type ListeningPageFixture=NativeFixture&{calls:Awaited<ReturnType<NativeFixture['store']['reserve']>>;
 intercept:{before?:(sql:string,c:PoolClient)=>Promise<void>;after?:(sql:string,c:PoolClient)=>Promise<void>}};
async function withListeningPageFixture(body:(f:ListeningPageFixture)=>Promise<void>,rawPages=true){
 await withMoneyFixture(1000000,async f=>{
  const intercept:ListeningPageFixture['intercept']={};
  const database={query:f.database.query.bind(f.database),connect:async()=>{
   const c=await f.database.connect();return new Proxy(c,{get(target,key){
    if(key==='query')return async(sql:string,values?:unknown[])=>{await intercept.before?.(sql,target);const result=await target.query(sql,values);await intercept.after?.(sql,target);return result;};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
  }} as NativeFixture['database'];
  const store=createSignalListeningStoreV1({database,...(rawPages?{rawPages:f.rawPages}:{}),storeRaw:async()=>{throw Error('no individual raw or provider transport');}});
  const calls=await store.reserve(f.run,proposals(f,1000));assert.equal(calls.length,3);
  await body({...f,store,calls,intercept});
 });
}
async function listeningPageReady(f:ListeningPageFixture,index=0){
 const call=f.calls[index]!;await f.store.markSubmitting(f.run,[call]);
 const request=buildSignalListeningJevRequestV1(call.inputs[0]!,f.configuration);
 const response={model:f.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
  ?{type:'noul' as const,noul:.1}:{type:'choice' as const,choice:Object.keys(q.criteria)[0]!,confidence:.9,
   probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i,all)=>[k,i===0?.9:.1/(all.length-1)]))}]))};
 const raw=JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)});
 await f.store.persistRawPage(f.run,[{call,raw}]);
 await f.store.settlePage(f.run,[{call,usage:jevUsageV1(response.usage),settled_micro_usd:6}]);
 return{call,results:[mapSignalListeningJevResponseV1(call.inputs[0]!,f.run.context,f.configuration,response)]};
}
async function listeningPageSnapshot(f:ListeningPageFixture){
 return{calls:(await f.database.query('SELECT id,status,results_applied,results,settled_micro_usd,terminal_exposure_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,raw_storage_verified_at,raw_storage_verified_key,usage FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[f.run.id])).rows,
  answers:(await f.database.query('SELECT * FROM signal_listening_answers WHERE run_id=$1 ORDER BY root_id,question_key',[f.run.id])).rows,
  fences:(await f.database.query('SELECT id FROM signal_labeling_page_mutation_fences WHERE run_id=$1 ORDER BY id',[f.run.id])).rows};
}

const answerInsertV1='INSERT INTO signal_listening_answers SELECT * FROM jsonb_populate_recordset(NULL::signal_listening_answers,$1::jsonb) ON CONFLICT DO NOTHING';
// ACL perturbations exist only in the already-owned rollback fixture. One named
// statement is reused before/after REVOKE and across both function bodies.
async function answerGuard0339ColumnAuthority(c:PoolClient,old:string,next:string,rows:Record<string,unknown>[],
 witness:()=>Promise<Record<string,unknown>>,original:Record<string,unknown>,snapshot:()=>Promise<unknown>){
 const owned=(await c.query("SELECT current_database() name,current_setting('server_version_num')::int version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0];
 assert.match(owned.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.ok(owned.version>=170000&&owned.version<180000);assert.equal(owned.super,true);
 const role='r16_answer_guard_'+randomUUID().replaceAll('-',''),quotedRole='"'+role+'"',prepared='r16_answer_acl_'+randomUUID().replaceAll('-','');
 const identity=(row:Record<string,unknown>)=>{const{prosrc,...attributes}=row;return attributes;};
 const probes:Array<{name:string;columns:Array<readonly[string,string]>;table:string;missing?:boolean}>=[
  {name:'unused call request',columns:[['signal_labeling_calls','request']],table:'signal_labeling_calls'},
  {name:'unused run cursor',columns:[['signal_labeling_runs','cursor_root_id']],table:'signal_labeling_runs'},
  {name:'unused owner full corpus',columns:[['signal_listening_runs','full_corpus']],table:'signal_listening_runs'},
  {name:'unused question prototype',columns:[['signal_listening_questions','prototype_embedding_id']],table:'signal_listening_questions'},
  {name:'unused call and used run columns',columns:[['signal_labeling_calls','request'],['signal_labeling_runs','entity_context_digest']],table:'signal_labeling_calls'},
  {name:'unused owner and used question columns',columns:[['signal_listening_runs','full_corpus'],['signal_listening_questions','question_digest']],table:'signal_listening_runs'},
  {name:'missing call still checks whole row permissions',columns:[['signal_labeling_calls','request']],table:'signal_labeling_calls',missing:true},
 ];
 const observations=new Map<string,Array<{code:string|null;message:string|null}>>();
 const attempt=async(input:Record<string,unknown>[])=>{
  const before=await snapshot();await c.query('SAVEPOINT answer_role_probe');let entered=false;
  let result:{code:string|null;message:string|null;inserted:number|null};
  try{
   await c.query('SET LOCAL ROLE '+quotedRole);entered=true;
   assert.equal((await c.query('SELECT current_user name')).rows[0].name,role);
   const inserted=await c.query({name:prepared,text:answerInsertV1,values:[JSON.stringify(input)]});
   result={code:null,message:null,inserted:inserted.rowCount};
  }catch(error){
   assert.equal(entered,true,'a denied role change cannot masquerade as a guard denial');
   assert.ok(typeof error==='object'&&error!==null&&'code'in error&&'message'in error);
   result={code:String(error.code),message:String(error.message),inserted:null};
  }finally{await c.query('ROLLBACK TO SAVEPOINT answer_role_probe');await c.query('RELEASE SAVEPOINT answer_role_probe');}
  assert.deepEqual(await snapshot(),before,'every role probe is rolled back without data changes');return result;
 };
 await c.query('SAVEPOINT answer_column_role');
 try{
  await c.query('CREATE ROLE '+quotedRole+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');
  await c.query('GRANT USAGE ON SCHEMA public,extensions TO '+quotedRole);
  await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+quotedRole);
  // SELECT FOR SHARE in the unchanged actor helper requires an UPDATE column
  // privilege on these locked relations, independently of its SELECT privilege.
  await c.query('GRANT UPDATE(id) ON TABLE users,signal_workspaces,brands,organizations,user_brand_access TO '+quotedRole);
  for(const signature of ['signal_listening_root_right_v1(uuid,uuid,text)',
   'signal_processing_lock_actor_v1(uuid,uuid,boolean)','signal_processing_actor_v1(uuid,uuid)'])
   await c.query('GRANT EXECUTE ON FUNCTION public.'+signature+' TO '+quotedRole);
  await c.query('GRANT INSERT ON TABLE signal_listening_answers TO '+quotedRole);
  for(const [label,sql,body]of [['old0334',old,answerGuardAfter0334BodySha256V1],['new0339',next,answerGuardAfter0339BodySha256V1]]as const){
   await c.query(sql);assert.deepEqual(identity(await witness()),identity(original));
   assert.equal(answerGuardShaV1(String((await witness()).prosrc)),body);
   assert.deepEqual(await attempt(rows),{code:null,message:null,inserted:1},label+' role must first execute a real fresh insert and conflict');
   for(const probe of probes){
    const input=probe.missing?[{...rows[0],call_id:randomUUID()}]:rows;
    await c.query('SAVEPOINT answer_column_phase');
    try{
     for(const [table,column]of probe.columns){
      assert.match(table,/^signal_(?:labeling_calls|labeling_runs|listening_runs|listening_questions)$/u);
      await c.query('REVOKE SELECT ON TABLE public.'+table+' FROM PUBLIC,'+quotedRole);
      const columns=(await c.query("SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",['public.'+table])).rows.map(row=>String(row.attname));
      assert.ok(columns.includes(column));
      await c.query('GRANT SELECT('+columns.filter(name=>name!==column).map(name=>'"'+name.replaceAll('"','""')+'"').join(',')+') ON TABLE public.'+table+' TO '+quotedRole);
      assert.equal((await c.query("SELECT has_column_privilege($1::name,$2::regclass,$3::text,'SELECT') allowed",[role,'public.'+table,column])).rows[0].allowed,false,'unused-column denial must actually be installed');
     }
     const denied=await attempt(input);assert.equal(denied.code,'42501',label+' '+probe.name);
     assert.ok(denied.message?.includes(probe.table),'the historical table must explain the denial');
     const values=observations.get(probe.name)??[];values.push({code:denied.code,message:denied.message});observations.set(probe.name,values);
    }finally{await c.query('ROLLBACK TO SAVEPOINT answer_column_phase');await c.query('RELEASE SAVEPOINT answer_column_phase');}
    assert.deepEqual(await attempt(rows),{code:null,message:null,inserted:1},label+' restored permissions execute the same prepared statement');
   }
   assert.equal(answerGuardShaV1(String((await witness()).prosrc)),body);assert.deepEqual(identity(await witness()),identity(original));
  }
  for(const [name,values]of observations){assert.equal(values.length,2);assert.deepEqual(values[1],values[0],name+' preserves SQLSTATE and error message on cached/prepared plans');}
 }finally{
  await c.query('ROLLBACK TO SAVEPOINT answer_column_role');await c.query('RELEASE SAVEPOINT answer_column_role');
  if((await c.query('SELECT name FROM pg_prepared_statements WHERE name=$1',[prepared])).rows.length)await c.query('DEALLOCATE "'+prepared+'"');
 }
 assert.equal((await c.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows.length,0,'only the owned uncommitted role is removed by rollback');
 assert.deepEqual(await witness(),original,'column permission probes restore the whole migrated guard');
 return [...observations].map(([name,values])=>({name,...values[0],old_new_equal:true}));
}

test('0339 preserves native answer errors, BEFORE conflicts, actor locks and statement rollback against frozen 0296 and 0334',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const historical=assertAnswerGuard0334SourceV1(await readFile(new URL('./0334_signal_listening_answer_guard_lookup.sql',import.meta.url),'utf8'));
 assert.equal(historical,answerGuardBefore0339SqlV1);
 const migration=await readFile(new URL('./0339_signal_listening_answer_guard_narrow.sql',import.meta.url),'utf8'),candidate=assertAnswerGuard0339SourceV1(migration);
 const first=await listeningPageReady(f,0);await f.store.apply(f.run,[first]);
 const spare=await listeningPageReady(f,1),input=spare.call.inputs[0]!;
 const existing=(await f.database.query("SELECT to_jsonb(a) value FROM signal_listening_answers a WHERE call_id=$1 AND question_key='promotion'",[first.call.id])).rows[0].value as Record<string,unknown>;
 const spareReceipt=(await f.database.query('SELECT request_digest,raw_sha256 FROM signal_labeling_calls WHERE id=$1',[spare.call.id])).rows[0];
 const unowned=(await f.database.query(`SELECT r.id FROM signal_labeling_runs r WHERE r.workspace_id=$1
  AND NOT EXISTS(SELECT 1 FROM signal_listening_runs o WHERE o.run_id=r.id) ORDER BY r.id LIMIT 1`,[f.run.workspace_id])).rows[0];assert.ok(unowned);
 const c=await f.database.connect();let original:Record<string,unknown>|undefined;
 type Case={name:string;code:string|null;message?:string;actor?:boolean;rights?:boolean;fresh?:boolean;question?:'promotion'|'voice';
  answer?:unknown;receiptBad?:boolean;patch?:Record<string,unknown>;twice?:boolean;siblingBad?:boolean;operation?:'update'|'delete'};
 const cases:Case[]=[
  {name:'valid conflict',code:null},{name:'two valid conflicts retain two actor checks',code:null,twice:true},
  {name:'valid fresh row',code:null,fresh:true},
  {name:'missing call',code:'P0001',message:'listening_answer_receipt_invalid',patch:{call_id:randomUUID()}},
  {name:'NULL call',code:'P0001',message:'listening_answer_receipt_invalid',patch:{call_id:null}},
  {name:'missing run',code:'P0001',message:'listening_answer_receipt_invalid',patch:{run_id:randomUUID()}},
  {name:'NULL run',code:'P0001',message:'listening_answer_receipt_invalid',patch:{run_id:null}},
  {name:'missing owner',code:'P0001',message:'listening_answer_receipt_invalid',patch:{run_id:unowned.id}},
  {name:'missing question',code:'P0001',message:'listening_answer_receipt_invalid',patch:{question_key:'missing_question'}},
  {name:'NULL question',code:'P0001',message:'listening_answer_receipt_invalid',patch:{question_key:null}},
  ...['root_id','input_digest','entity_context_digest','question_digest','request_digest','raw_sha256'].map(key=>({
   name:'mismatched '+key,code:'P0001',message:'listening_answer_receipt_invalid',patch:{[key]:key==='root_id'?randomUUID():'sha256:'+'e'.repeat(64)},
  })),
  {name:'malformed noul shape',code:'P0001',message:'listening_answer_invalid',fresh:true,answer:{type:'noul',noul:2}},
  {name:'malformed choice shape',code:'P0001',message:'listening_answer_invalid',fresh:true,question:'voice',
   answer:{...spare.results[0]!.answers.voice,confidence:2}},
  {name:'malformed choice cast',code:'22P02',fresh:true,question:'voice',answer:{...spare.results[0]!.answers.voice,confidence:'not-a-number'}},
  {name:'malformed cast',code:'22P02',fresh:true,answer:{type:'noul',noul:'not-a-number'}},
  {name:'bad receipt precedes malformed cast',code:'P0001',message:'listening_answer_receipt_invalid',fresh:true,
   answer:{type:'noul',noul:'not-a-number'},receiptBad:true},
  {name:'revoked root rights',code:'P0001',message:'listening_answer_receipt_invalid',rights:true},
  {name:'revoked actor',code:'42501',message:'processing_forbidden',actor:true},
  {name:'bad receipt precedes revoked actor',code:'P0001',message:'listening_answer_receipt_invalid',actor:true,receiptBad:true},
  {name:'revoked actor precedes malformed cast',code:'42501',message:'processing_forbidden',actor:true,fresh:true,
   answer:{type:'noul',noul:'not-a-number'}},
  {name:'valid fresh sibling rolls back with bad conflict tuple',code:'P0001',message:'listening_answer_receipt_invalid',fresh:true,siblingBad:true},
  {name:'update remains immutable',code:'P0001',message:'listening_history_immutable',operation:'update'},
  {name:'delete remains immutable',code:'P0001',message:'listening_history_immutable',operation:'delete'},
 ];
 const witness=async()=>{const row=(await c.query(answerGuard0339WitnessSqlV1)).rows[0];assert.ok(row);return row as Record<string,unknown>;};
 const identity=(row:Record<string,unknown>)=>{const{prosrc,...attributes}=row;return attributes;};
 const snapshot=async()=>(await c.query(`SELECT jsonb_build_object(
  'answers',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY root_id,question_key),'[]') FROM signal_listening_answers a WHERE run_id=$1),
  'calls',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM signal_labeling_calls v WHERE run_id=$1),
  'links',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY call_id,question_key),'[]') FROM signal_listening_call_questions v WHERE run_id=$1)) value`,[f.run.id])).rows[0].value;
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query("SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='5s';SET LOCAL track_functions='all'");
  original=await witness();assert.equal(original.return_type,'trigger');assert.equal(original.arguments,'');
  assert.equal(original.proretset,false);assert.equal(original.pronargs,0);assert.equal(original.pronargdefaults,0);
  assert.equal(original.provolatile,'v');assert.equal(original.proparallel,'u');assert.equal(original.prosecdef,false);
  assert.equal(answerGuardShaV1(String(original.prosrc)),answerGuardAfter0339BodySha256V1,'migrated native source must be exactly 0339');
  const triggerBefore=(await c.query("SELECT tgfoid::text,tgtype,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='signal_listening_answers'::regclass AND tgname='signal_listening_answer_guard'")).rows;
  assert.equal(triggerBefore.length,1);assert.equal(triggerBefore[0]!.tgtype,31,'BEFORE ROW INSERT/UPDATE/DELETE remains installed');
  const singleLookup=answerGuardAfter0334LookupV1.slice(0,answerGuardAfter0334LookupV1.indexOf(';')).replace(' INTO looked_up','')
   .replaceAll('NEW.call_id','$1').replaceAll('NEW.workspace_id','$2').replaceAll('NEW.run_id','$3').replaceAll('NEW.question_key','$4');
  const narrowLookup=answerGuard0339LookupV1.slice(0,answerGuard0339LookupV1.indexOf(';')).replace(' INTO looked_up','')
   .replaceAll('NEW.call_id','$1').replaceAll('NEW.workspace_id','$2').replaceAll('NEW.run_id','$3').replaceAll('NEW.question_key','$4');
  assert.ok(!singleLookup.includes('NEW.')&&!singleLookup.includes('looked_up'));
  const lookupPatches:Array<Record<string,unknown>>=[{},{call_id:randomUUID()},{call_id:null},{run_id:randomUUID()},{run_id:null},{run_id:unowned.id},{question_key:'missing_question'},{question_key:null}];
  for(const patch of lookupPatches){
   const row={...existing,...patch};
   const call=(await c.query('SELECT to_jsonb(v) value FROM signal_labeling_calls v WHERE id=$1 AND workspace_id=$2 AND run_id=$3',[row.call_id,row.workspace_id,row.run_id])).rows[0]?.value??null;
   const run=(await c.query('SELECT to_jsonb(v) value FROM signal_labeling_runs v WHERE id=$1',[row.run_id])).rows[0]?.value??null;
   const owner=(await c.query('SELECT to_jsonb(v) value FROM signal_listening_runs v WHERE run_id=$1 AND workspace_id=$2',[run?.id??null,row.workspace_id])).rows[0]?.value??null;
   const question=(await c.query('SELECT to_jsonb(v) value FROM signal_listening_questions v WHERE configuration_id=$1 AND question_key=$2',[owner?.configuration_id??null,row.question_key])).rows[0]?.value??null;
   const actual=(await c.query('SELECT to_jsonb(v) value FROM ('+singleLookup+') v',[row.call_id,row.workspace_id,row.run_id,row.question_key])).rows;
   assert.equal(actual.length,1,'seed retains one row for every missing relation');
   assert.deepEqual(actual[0].value,{selected_call:call,selected_run:run,selected_owner:owner,selected_question:question},'all four native composites and NULLs equal the separate reads in SAME RR');
   const narrow=(await c.query('SELECT to_jsonb(v) value FROM ('+narrowLookup+') v',[row.call_id,row.workspace_id,row.run_id,row.question_key])).rows;
   assert.equal(narrow.length,1,'the narrow record always has a descriptor, including missing and NULL relations');
   assert.deepEqual(narrow[0].value,{
    call_id:call?.id??null,call_status:call?.status??null,call_settled_micro_usd:call?.settled_micro_usd??null,
    call_usage:call?.usage??null,call_raw_sha256:call?.raw_sha256??null,call_raw_storage_verified_at:call?.raw_storage_verified_at??null,
    call_raw_storage_verified_key:call?.raw_storage_verified_key??null,call_raw_storage_key:call?.raw_storage_key??null,
    call_results_applied:call?.results_applied??null,call_results:call?.results??null,call_request_digest:call?.request_digest??null,
    run_entity_context_digest:run?.entity_context_digest??null,run_workspace_id:run?.workspace_id??null,run_actor_user_id:run?.actor_user_id??null,
    question_digest:question?.question_digest??null,question_type:question?.definition?.type??null,question_criteria:question?.wire?.criteria??null,
    permission_call:null,permission_run:null,permission_owner:null,permission_question:null,
   },'every projected value equals its frozen composite field; four permission-only slots stay NULL');
   if(patch.call_id){assert.equal(actual[0].value.selected_call,null);assert.equal(actual[0].value.selected_run.id,f.run.id,'missing call never drives away the independent run');}
  }
  for(const probe of cases){
   const observed=[];
   for(const [label,sql,bodySha]of [['old0296',answerGuardBefore0334SqlV1,answerGuardBefore0334BodySha256V1],['old0334',historical,answerGuardAfter0334BodySha256V1],['new0339',candidate,answerGuardAfter0339BodySha256V1]]as const){
    await c.query('SAVEPOINT answer_variant');
    try{
     await c.query(sql);const current=await witness();assert.deepEqual(identity(current),identity(original),label+' preserves OID/owner/ACL/signature/attributes');
     assert.equal(answerGuardShaV1(String(current.prosrc)),bodySha,label+' native body is exact');
     let row={...existing,...probe.patch};
     if(probe.fresh){
      const key=probe.question??'promotion',answer=probe.answer??spare.results[0]!.answers[key];assert.ok(answer);
      const result={...spare.results[0]!,answers:{...spare.results[0]!.answers,[key]:answer}};
      await c.query('UPDATE signal_labeling_calls SET results_applied=true,results=$2::jsonb WHERE id=$1',[spare.call.id,JSON.stringify([result])]);
      row={...existing,root_id:input.root_id,input_digest:input.input_digest,question_key:key,question_digest:input.question_digests[key],
       call_id:spare.call.id,request_digest:spareReceipt.request_digest,raw_sha256:spareReceipt.raw_sha256,answer};
     }
     if(probe.receiptBad)row.raw_sha256='sha256:'+'f'.repeat(64);
     if(probe.rights)await c.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.run.workspace_id]);
     if(probe.actor)await c.query("UPDATE users SET status='suspended' WHERE id=$1",[f.run.actor_user_id]);
     const rows=probe.twice?[row,row]:probe.siblingBad?[row,{...row,raw_sha256:'sha256:'+'f'.repeat(64)}]:[row];
     const before=await snapshot(),beforeActor=await exposureCalls(c,'signal_processing_lock_actor_v1(uuid,uuid,boolean)');
     await c.query('SAVEPOINT answer_attempt');let result:{code:string|null;message:string|null;inserted:number|null};
     try{
      const inserted=probe.operation==='update'?await c.query('UPDATE signal_listening_answers SET answer=answer WHERE call_id=$1',[first.call.id])
       :probe.operation==='delete'?await c.query('DELETE FROM signal_listening_answers WHERE call_id=$1',[first.call.id])
       :await c.query(answerInsertV1,[JSON.stringify(rows)]);
      result={code:null,message:null,inserted:inserted.rowCount};
     }catch(error){
      assert.ok(typeof error==='object'&&error!==null&&'code'in error&&'message'in error);
      result={code:String(error.code),message:String(error.message),inserted:null};await c.query('ROLLBACK TO SAVEPOINT answer_attempt');
     }
     await c.query('RELEASE SAVEPOINT answer_attempt');const after=await snapshot();
     if(probe.fresh&&probe.code===null){
      assert.equal(after.answers.length,before.answers.length+1);assert.deepEqual(after.calls,before.calls);assert.deepEqual(after.links,before.links);
     }else assert.deepEqual(after,before,probe.name+' has no partial answers/calls/links');
     assert.equal(result.code,probe.code,probe.name);if(probe.message)assert.equal(result.message,probe.message,probe.name);
     if(probe.code===null){assert.equal(result.inserted,probe.fresh?1:0);assert.equal(await exposureCalls(c,'signal_processing_lock_actor_v1(uuid,uuid,boolean)')-beforeActor,probe.twice?2:1,'actor lock executes for every fresh or conflict-suppressed BEFORE row');}
     observed.push(result);
    }finally{await c.query('ROLLBACK TO SAVEPOINT answer_variant');await c.query('RELEASE SAVEPOINT answer_variant');}
   }
   assert.deepEqual(observed[1],observed[0],probe.name+' retains frozen 0334/0296 SQLSTATE, precedence and row count');
   assert.deepEqual(observed[2],observed[0],probe.name+' retains 0339 SQLSTATE, message, precedence and row count in SAME transaction');
  }
  await c.query('SAVEPOINT answer_pair_inputs');
  try{
   await c.query('UPDATE signal_labeling_calls SET results_applied=true,results=$2::jsonb WHERE id=$1',[spare.call.id,JSON.stringify(spare.results)]);
   const fresh={...existing,root_id:input.root_id,input_digest:input.input_digest,question_key:'promotion',question_digest:input.question_digests.promotion,
    call_id:spare.call.id,request_digest:spareReceipt.request_digest,raw_sha256:spareReceipt.raw_sha256,answer:spare.results[0]!.answers.promotion};
   const pairRows=[existing,fresh],pairJson=JSON.stringify(pairRows),acl=await answerGuard0339ColumnAuthority(c,historical,candidate,pairRows,witness,original,snapshot);
   const timings:Array<{variant:string;elapsed_ms:number;inserted:number|null;output_sha256:string}>=[];
   for(const [variant,sql,body]of [['old0334',historical,answerGuardAfter0334BodySha256V1],['new0339',candidate,answerGuardAfter0339BodySha256V1],
    ['new0339',candidate,answerGuardAfter0339BodySha256V1],['old0334',historical,answerGuardAfter0334BodySha256V1]]as const){
    await c.query('SAVEPOINT answer_pair_variant');try{
     await c.query(sql);assert.deepEqual(identity(await witness()),identity(original));assert.equal(answerGuardShaV1(String((await witness()).prosrc)),body);
     const actorBefore=await exposureCalls(c,'signal_processing_lock_actor_v1(uuid,uuid,boolean)'),before=await snapshot();
     const start=performance.now(),inserted=await c.query(answerInsertV1,[pairJson]),elapsed_ms=performance.now()-start;
     const after=await snapshot();assert.equal(inserted.rowCount,1);assert.equal(after.answers.length,before.answers.length+1);
     assert.deepEqual(after.calls,before.calls);assert.deepEqual(after.links,before.links);
     assert.equal(await exposureCalls(c,'signal_processing_lock_actor_v1(uuid,uuid,boolean)')-actorBefore,2,'one real BEFORE check per row, including the conflict');
     assert.deepEqual(identity(await witness()),identity(original));assert.equal(answerGuardShaV1(String((await witness()).prosrc)),body);
     timings.push({variant,elapsed_ms,inserted:inserted.rowCount,output_sha256:answerGuardShaV1(JSON.stringify(after))});
    }finally{await c.query('ROLLBACK TO SAVEPOINT answer_pair_variant');await c.query('RELEASE SAVEPOINT answer_pair_variant');}
   }
   assert.equal(new Set(timings.map(row=>row.output_sha256)).size,1,'ABBA keeps every data result byte-equivalent in the same RR');
   console.log('# answer guard0339 Native '+JSON.stringify({contract:'r16-answer-guard-narrow-native-v1',migration_source_sha256:answerGuardShaV1(migration),
    old_body_sha256:answerGuardAfter0334BodySha256V1,new_body_sha256:answerGuardAfter0339BodySha256V1,catalog:identity(original),
    acl_prepared_probes:acl,rows_per_statement:2,same_three_root_fixture:true,same_RR:true,input_sha256:answerGuardShaV1(pairJson),timings,
    timing_scope:'one original INSERT statement, inclusive wall; outside installation/catalog/snapshot checks',
    no_scale_or_CPU_or_throughput_gain_claim:true}));
  }finally{await c.query('ROLLBACK TO SAVEPOINT answer_pair_inputs');await c.query('RELEASE SAVEPOINT answer_pair_inputs');}
  assert.deepEqual((await c.query("SELECT tgfoid::text,tgtype,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='signal_listening_answers'::regclass AND tgname='signal_listening_answer_guard'")).rows,triggerBefore);
  assert.deepEqual(await witness(),original,'savepoint rollback restores the original migrated function and attributes');
 }finally{try{await c.query('ROLLBACK');}finally{c.release();}}
 if(original)assert.deepEqual((await f.database.query(answerGuard0339WitnessSqlV1)).rows[0],original,'outer rollback leaves the native public guard unchanged');
}));
for(const operation of ['apply_raw','mark_raw']as const)test('native Listening page fence disjoint '+operation+' commits while another page retains its run fence',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const page=operation==='apply_raw'?await listeningPageReady(f):null;
 if(operation==='apply_raw')await f.store.markSubmitting(f.run,[f.calls[1]!]);else await f.store.markSubmitting(f.run,[f.calls[0]!]);
 const held=pageDeferred(),release=pageDeferred();let caught=false;
 f.intercept.after=async sql=>{if(!caught&&(/WITH raw_run_fence|SELECT id FROM signal_labeling_runs/u.test(sql))){caught=true;held.resolve();await release.promise;}};
 const first=operation==='apply_raw'?f.store.apply(f.run,[page!]):f.store.persistRawPage(f.run,[{call:f.calls[0]!,raw:'exact native first Listening receipt'}]);
 await held.promise;
 const second=operation==='apply_raw'?f.store.persistRawPage(f.run,[{call:f.calls[1]!,raw:'exact disjoint Listening receipt'}]):f.store.markSubmitting(f.run,[f.calls[1]!]);
 let progressed=false;
 try{progressed=await Promise.race([second.then(()=>true),pageDelay(1000).then(()=>false)]);}finally{release.resolve();await Promise.all([first,second]);}
 assert.equal(progressed,true,'disjoint native Listening pages must commit before the first run fence is released');
 const snapshot=await listeningPageSnapshot(f);
 assert.ok(snapshot.calls.every(c=>c.terminal_exposure_micro_usd==='0'));
 assert.equal(snapshot.answers.length,operation==='apply_raw'?Object.keys(page!.results[0]!.question_digests).length:0);
}));

test('native Listening page fence exact and partial replay retain original answers and reject divergent replay',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const first=await listeningPageReady(f);await f.store.apply(f.run,[first]);const before=await listeningPageSnapshot(f);
 await f.store.apply(f.run,[first]);assert.deepEqual(await listeningPageSnapshot(f),before,'identical replay performs no new mutation');
 const divergent=structuredClone(first),key=Object.keys(divergent.results[0]!.answers)[0]!;
 divergent.results[0]!.answers[key]={type:'noul',noul:.987};
 await assert.rejects(f.store.apply(f.run,[divergent]),/labeling_result_replay_conflict/);
 assert.deepEqual(await listeningPageSnapshot(f),before);
 const second=await listeningPageReady(f,1);await f.store.apply(f.run,[first,second]);
 const after=await listeningPageSnapshot(f);assert.equal(after.fences.length,before.fences.length+2,'one new mark and one new apply fence');
 assert.deepEqual(after.answers.filter(a=>a.call_id===first.call.id),before.answers);
 assert.equal(after.calls.filter(c=>c.results_applied).length,2);
}));

async function requireListeningPageGate(gate:Promise<void>){
 await Promise.race([gate,pageDelay(3000).then(()=>{throw Error('native Listening page lock was not reached');})]);
}
async function requireListeningPageBlock(c:Pick<PoolClient,'query'>,holder:number,waiter:number){
 assert.ok(holder>0&&waiter>0&&holder!==waiter,'holder and waiter are distinct native backends');
 let blocked=false;const deadline=Date.now()+3000;
 do{blocked=Boolean((await c.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[holder,waiter])).rows[0].blocked);if(!blocked)await pageDelay(20);}while(!blocked&&Date.now()<deadline);
 assert.equal(blocked,true,'the second native backend must be blocked by this exact holder before release');
}
for(const divergent of [false,true])test('native Listening page fence overlapping reverse-order apply serializes exact calls (divergent '+divergent+')',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const a=await listeningPageReady(f),b=await listeningPageReady(f,1),held=pageDeferred(),attempted=pageDeferred(),release=pageDeferred();let caught=false,holder=0,waiter=0;const custody:{client?:PoolClient}={};
 const locks=(sql:string)=>/WHERE workspace_id=\$1 AND run_id=\$2 AND id=ANY\(\$3::uuid\[\]\) ORDER BY id FOR UPDATE|SELECT id FROM signal_labeling_runs/u.test(sql);
 f.intercept.before=async(sql,c)=>{if(holder&&!waiter&&locks(sql)){waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}};
 f.intercept.after=async(sql,c)=>{if(!caught&&locks(sql)){caught=true;custody.client=c;holder=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);held.resolve();await release.promise;}};
 const first=f.store.apply(f.run,[a,b]),firstOutcome=first.then(()=>null,error=>error);
 let outcome:Promise<{ok:boolean;error?:unknown}>|undefined;
 try{
  await requireListeningPageGate(held.promise);
  const copy=structuredClone(a);if(divergent)copy.results[0]!.answers[Object.keys(copy.results[0]!.answers)[0]!]={type:'noul',noul:.987};
  outcome=f.store.apply(f.run,[b,copy]).then(()=>({ok:true}),error=>({ok:false,error}));
  await requireListeningPageGate(attempted.promise);assert.ok(custody.client);await requireListeningPageBlock(custody.client,holder,waiter);
 }finally{release.resolve();await Promise.all([firstOutcome,outcome]);}
 assert.equal(await firstOutcome,null);assert.ok(outcome);
 const result=await outcome;assert.equal(result.ok,!divergent);if('error'in result)assert.match(String(result.error),/labeling_result_replay_conflict/);
 const snapshot=await listeningPageSnapshot(f);assert.equal(snapshot.calls.filter(c=>c.results_applied).length,2);
 assert.deepEqual(snapshot.answers.filter(row=>row.call_id===a.call.id).map(row=>[row.question_key,row.answer]),Object.entries(a.results[0]!.answers).sort(([a],[b])=>a.localeCompare(b)));
}));

for(const mutation of ['expiry','token']as const)test('native Listening page fence mark rejects '+mutation+' after waiting on the run writer',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const blocker=await f.database.connect(),attempted=pageDeferred();let caught=false,waiter=0;
 const blockerPid=Number((await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid);
 await blocker.query('BEGIN');await blocker.query('SELECT id FROM signal_labeling_runs WHERE id=$1 FOR UPDATE',[f.run.id]);
 f.intercept.before=async(sql,c)=>{if(!caught&&/WITH raw_run_fence|SELECT id FROM signal_labeling_runs/u.test(sql)){caught=true;waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}};
 const marking=f.store.markSubmitting(f.run,[f.calls[0]!]),outcome=marking.then(()=>null,error=>error);
 try{await attempted.promise;
  let blocked=false;const deadline=Date.now()+3000;
  do{blocked=Boolean((await blocker.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[blockerPid,waiter])).rows[0].blocked);if(!blocked)await pageDelay(20);}while(!blocked&&Date.now()<deadline);
  assert.equal(blocked,true,'the native run writer must actually block this exact waiting backend before its lease changes');
  if(mutation==='expiry')await blocker.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  else await blocker.query('UPDATE signal_labeling_runs SET lease_token=$2 WHERE id=$1',[f.run.id,randomUUID()]);
  await blocker.query('COMMIT');
 }catch(error){await blocker.query('ROLLBACK');throw error;}finally{blocker.release();await outcome;}
 assert.match(String(await outcome),/labeling_lease_lost/);
 const snapshot=await listeningPageSnapshot(f);assert.ok(snapshot.calls.every(c=>c.status==='reserved'&&!c.results_applied));assert.equal(snapshot.answers.length,0);assert.equal(snapshot.fences.length,0);
}));

for(const operation of ['mark','apply']as const)test('native Listening page fence '+operation+' rolls back answers, results and fences when deferred COMMIT crosses lease expiry',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const page=operation==='apply'?await listeningPageReady(f):null,before=await listeningPageSnapshot(f);
 await f.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1",[f.run.id]);
 let delayed=false;f.intercept.before=async sql=>{if(sql==='COMMIT'&&!delayed){delayed=true;await pageDelay(1700);}};
 await assert.rejects(operation==='mark'?f.store.markSubmitting(f.run,[f.calls[0]!]):f.store.apply(f.run,[page!]),/labeling_lease_lost/);
 assert.equal(delayed,true,'the real deferred constraint must reject COMMIT, not an earlier check');
 assert.deepEqual(await listeningPageSnapshot(f),before,'rollback retains settled RAW custody and money while reverting all page mutations');
}));

test('native Listening page fence without raw pages retains exclusive run serialization',{
 skip:!enabled,timeout:600000,
},async()=>withListeningPageFixture(async f=>{
 const held=pageDeferred(),attempted=pageDeferred(),release=pageDeferred();let caught=false,holder=0,waiter=0;const custody:{client?:PoolClient}={};
 const locks=(sql:string)=>sql.includes('SELECT id FROM signal_labeling_runs');
 f.intercept.before=async(sql,c)=>{if(holder&&!waiter&&locks(sql)){waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}};
 f.intercept.after=async(sql,c)=>{if(!caught&&locks(sql)){caught=true;custody.client=c;holder=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);held.resolve();await release.promise;}};
 const first=f.store.markSubmitting(f.run,[f.calls[0]!]),firstOutcome=first.then(()=>null,error=>error);let second:Promise<unknown>|undefined;
 try{
  await requireListeningPageGate(held.promise);second=f.store.markSubmitting(f.run,[f.calls[1]!]).then(()=>null,error=>error);
  await requireListeningPageGate(attempted.promise);assert.ok(custody.client);await requireListeningPageBlock(custody.client,holder,waiter);
 }finally{release.resolve();await Promise.all([firstOutcome,second]);}
 assert.equal(await firstOutcome,null);assert.ok(second);assert.equal(await second,null);assert.equal((await listeningPageSnapshot(f)).fences.length,0);
},false));

type ListeningReserveFixture=NativeFixture&{intercept:ListeningPageFixture['intercept']};
/** Real transactions and real authority. Only pause AFTER the selected SQL has
 * executed; finite PostgreSQL timeouts also bound failures before cleanup. */
async function withListeningReserveFixture(cap:number,body:(f:ListeningReserveFixture)=>Promise<void>,rawPages=true){
 await withMoneyFixture(cap,async f=>{
  const intercept:ListeningPageFixture['intercept']={};
  const database={query:f.database.query.bind(f.database),connect:async()=>{
   const c=await f.database.connect();return new Proxy(c,{get(target,key){
    if(key==='query')return async(sql:string,values?:unknown[])=>{
     await intercept.before?.(sql,target);const result=await target.query(sql,values);
     if(sql==='BEGIN')await target.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'");
     await intercept.after?.(sql,target);return result;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
  }} as NativeFixture['database'];
  const store=createSignalListeningStoreV1({database,...(rawPages?{rawPages:f.rawPages}:{}),
   storeRaw:async()=>{throw Error('no individual raw/provider in reserve acceptance');}});
  await body({...f,store,intercept});
 });
}
async function reserveGate<T>(promise:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('native reserve barrier not reached')),15000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
const reservePolicyLock=(sql:string)=>sql.includes("pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'");
for(const operation of ['raw','apply']as const)test('native Listening reserve commits while disjoint '+operation+' retains its real run SHARE fence',{
 skip:!enabled,timeout:600000,
},async()=>withListeningReserveFixture(1000000,async f=>{
 const calls=await f.store.reserve(f.run,proposals({...f,inputs:[f.inputs[0]!]},1000));assert.equal(calls.length,1);
 const pageFixture={...f,calls};
 const page=operation==='apply'?await listeningPageReady(pageFixture):null;
 if(operation==='raw')await f.store.markSubmitting(f.run,calls);
 const held=pageDeferred(),release=pageDeferred();let caught=false,share=false;
 f.intercept.after=async sql=>{if(!caught&&/WITH raw_run_fence|SELECT id FROM signal_labeling_runs/u.test(sql)){
  caught=true;share=sql.includes('FOR SHARE');held.resolve();await release.promise;
 }};
 const first=(operation==='raw'?f.store.persistRawPage(f.run,[{call:calls[0]!,raw:'native reserve disjoint RAW bytes'}]):f.store.apply(f.run,[page!]))
  .then(()=>null,error=>error);
 let reserved:Awaited<ReturnType<NativeFixture['store']['reserve']>>|undefined;
 try{
  await reserveGate(held.promise);assert.equal(share,true,'the retained fence must be the actual shared native fence');
  // Completion, including COMMIT, is required while the first TX is paused.
  // An exclusive reserve fails via PostgreSQL lock_timeout, not a timing race.
  reserved=await f.store.reserve(f.run,proposals({...f,inputs:[f.inputs[1]!]},1000));
  assert.equal(reserved.length,1);assert.notEqual(reserved[0]!.id,calls[0]!.id);
 }finally{release.resolve();await first;}
 assert.equal(await first,null);assert.ok(reserved);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0].n,2);
 assert.equal(f.run.cursor_root_id,null);
 assert.equal((await f.database.query('SELECT cursor_root_id FROM signal_labeling_runs WHERE id=$1',[f.run.id])).rows[0].cursor_root_id,null);
}));

for(const same of [true,false])test('native Listening concurrent reserve cap one call '+(same?'replays the same identity once':'rejects a different identity atomically'),{
 skip:!enabled,timeout:600000,
},async()=>withListeningReserveFixture(1000,async f=>{
 const held=pageDeferred(),attempted=pageDeferred(),release=pageDeferred();let caught=false,holder=0,waiter=0;
 const custody:{client?:PoolClient}={};
 f.intercept.after=async(sql,c)=>{if(!caught&&sql==='SELECT * FROM signal_labeling_calls WHERE custom_id=ANY($1::text[])'){
  caught=true;custody.client=c;holder=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);held.resolve();await release.promise;
 }};
 f.intercept.before=async(sql,c)=>{if(holder&&!waiter&&reservePolicyLock(sql)){
  waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();
 }};
 const row=proposals({...f,inputs:[f.inputs[0]!]},1000);
 const first=f.store.reserve(f.run,row).then(value=>({value,error:null}),error=>({value:null,error}));
 let second:typeof first|undefined;
 try{
  await reserveGate(held.promise);
  second=f.store.reserve(f.run,same?row:proposals({...f,inputs:[f.inputs[1]!]},1000))
   .then(value=>({value,error:null}),error=>({value:null,error}));
  await reserveGate(attempted.promise);assert.ok(custody.client);
  await requireListeningPageBlock(custody.client,holder,waiter);
 }finally{release.resolve();await Promise.all([first,second]);}
 const a=await first;assert.equal(a.error,null);assert.ok(a.value);assert.ok(second);const b=await second;
 if(same){assert.equal(b.error,null);assert.deepEqual(b.value?.map(c=>c.id),a.value.map(c=>c.id));}
 else{assert.match(String(b.error),/labeling_cap_exhausted/);assert.equal(b.value,null);}
 const ledger=(await f.database.query('SELECT count(*)::int n,sum(reserved_micro_usd)::text reserved FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows[0];
 assert.deepEqual(ledger,{n:1,reserved:'1000'});
 await transaction(f,async c=>{assert.equal(await readSignalLabelingRunExposureV1(c,f.run.id),'1000');});
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0].n,f.inputs[0]!.question_keys.length);
}));

test('native Listening reserve replay preserves unknown custody and prior uncertainty blocks a new run',{
 skip:!enabled,timeout:600000,
},async()=>withListeningReserveFixture(1000,async f=>{
 const row=proposals({...f,inputs:[f.inputs[0]!]},1000),calls=await f.store.reserve(f.run,row);
 await f.store.markSubmitting(f.run,calls);await f.store.markFailed(f.run,calls,true);
 const before=(await f.database.query('SELECT to_jsonb(c) value FROM signal_labeling_calls c WHERE run_id=$1',[f.run.id])).rows;
 const replay=await f.store.reserve(f.run,row);assert.equal(replay[0]!.id,calls[0]!.id);assert.equal(replay[0]!.status,'unknown');
 assert.deepEqual((await f.database.query('SELECT to_jsonb(c) value FROM signal_labeling_calls c WHERE run_id=$1',[f.run.id])).rows,before);
 await transaction(f,async c=>{assert.equal(await readSignalLabelingRunExposureV1(c,f.run.id),'1000');});
 assert.equal(await f.store.finish(f.run),'failed');await f.store.release(f.run);
 const configuration_id=(await f.database.query('SELECT configuration_id FROM signal_listening_runs WHERE run_id=$1',[f.run.id])).rows[0].configuration_id;
 const map_id=(await f.database.query('SELECT map_id FROM signal_listening_runs WHERE run_id=$1',[f.run.id])).rows[0].map_id;
 await assert.rejects(requestSignalListeningV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,
  configuration_id,map_id,idempotency_key:randomUUID(),cap_micro_usd:1000,provider_available:true}),/listening_prior_outcome_unresolved/);
}));

test('native Listening without RAW pages retains the default reservation cursor and exclusive run fence',{
 skip:!enabled,timeout:600000,
},async()=>withListeningReserveFixture(1000000,async f=>{
 const statements:string[]=[];f.intercept.after=async sql=>{statements.push(sql);};
 const calls=await f.store.reserve(f.run,proposals(f,1000));assert.equal(calls.length,3);
 const last=f.inputs.map(i=>i.root_id).sort().at(-1)!;
 assert.equal(f.run.cursor_root_id,last);
 assert.equal((await f.database.query('SELECT cursor_root_id FROM signal_labeling_runs WHERE id=$1',[f.run.id])).rows[0].cursor_root_id,last);
 assert.ok(statements.some(sql=>sql.includes('SELECT id FROM signal_labeling_runs')&&sql.includes('FOR UPDATE')));
 assert.ok(!statements.some(sql=>sql.includes('WITH raw_run_fence')));
},false));


// Atomic covered admission acceptance is additive. The original money/0339
// cases above retain their source bytes and their existing CI environment gate.
import {deriveSignalListeningCalibrationV1} from '../signal-listening-calibration';
import {quoteSignalListeningDiscoveryRoundV1} from '../signal-listening-discovery-money';
import {signalListeningCalibrationShapeV1,llmPriceV1,llmCostMicroUsdV1} from '@noisia/query-engine';
import type {LabelingCallProposalV1,LabelingCallV1,LabelingAdmissionSelectionV1} from '../signal-labeling-runs';
import {LabelingAdmissionFailureV1} from '../signal-labeling-runs';

type CoveredNativeFixture=NativeFixture&{intercept:ListeningPageFixture['intercept'];
 evidence:{operation:'insert'|'mark';population_calls:number;money_calls:number}[];sourceProfile:NonNullable<Awaited<ReturnType<typeof deriveSignalListeningCalibrationV1>>>;prewarm_calls:number;probeDatabase:NativeFixture['database']};
async function withCoveredNativeFixture(cap:number,body:(f:CoveredNativeFixture)=>Promise<void>,editorialRace=false,fixture:{study_text_length?:number}={}){
 await runMassLabelingAcceptanceFixtureV1('product',{population_count:60,study_text_length:fixture.study_text_length,beforeProcessing:async ctx=>{
  const original=ctx.database,access={database:original,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  await original.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const editorial=editorialRace?await seedEditorialRace(access):undefined,runCap=editorial?.cap??cap;
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:{...base,questions:[...base.questions,
   {key:'consumer_signal',type:'choice',text:'What kind of synthetic consumer experience is described? ☕',scope:'consumer_category',origin:'brand_os',human_locked:false,
    options:[{key:'experience',definition:'Personal bicycle experience'},{key:'other',definition:'Other consumer context'}]}]}});
  const files=await mkdtemp(join(tmpdir(),'r16-native-covered-'));
  const rawPages:NativeFixture['rawPages']={reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
   async store(a){const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const fd=await open(path,'r+');try{await fd.sync();}finally{await fd.close();}
    assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},
   load:a=>readFile(join(files,a.sha256.slice(7)),'utf8')};
  const warmStore=createSignalListeningStoreV1({database:original,rawPages,storeRaw:async()=>{throw Error('no real provider or individual receipt');}});
  const warm=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:runCap,provider_available:true});
  const warmRun=await warmStore.claim(warm.run_id);assert.ok(warmRun);
  let counter=0;
  const complete=async(inputs:SignalListeningInputV1[])=>{
   const batchSize=Math.max(1,Math.min(16,Math.floor(runCap/2000)));
   for(let offset=0;offset<inputs.length;offset+=batchSize){
   const batch=inputs.slice(offset,offset+batchSize);
   const calls=await warmStore.reserve(warmRun,proposals({run:warmRun,inputs:batch,configuration:cfg.configuration},1000));
   await warmStore.markSubmitting(warmRun,calls);
   const outcomes=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,cfg.configuration),response={model:cfg.configuration.model,
    usage:{input_tokens:120+counter++,output_tokens:0},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>q.type==='noul'
     ?[key,{type:'noul' as const,noul:.1}]:[key,{type:'choice' as const,choice:key==='voice'?'individual':'experience',confidence:.9,
      probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===(key==='voice'?'individual':'experience')?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
    const usage=jevUsageV1(response.usage);return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),usage,
     settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1('typesafe',cfg.configuration.model,'sync',.042)),result:mapSignalListeningJevResponseV1(input,warmRun.context,cfg.configuration,response)};});
   await warmStore.persistRawPage(warmRun,outcomes);await warmStore.settlePage(warmRun,outcomes);await warmStore.apply(warmRun,outcomes.map(o=>({call:o.call,results:[o.result]})));
   if(counter%16===0)await warmStore.renew(warmRun);
   }
  };
  try{
   const initial=await warmStore.inputs(warmRun);assert.equal(initial.length,60);assert.ok(initial.every(i=>i.question_keys.join(',')==='promotion,voice'));
   await complete(initial);
   const consumers=await warmStore.inputs(warmRun);assert.equal(consumers.length,60);assert.ok(consumers.every(i=>i.question_keys.join(',')==='consumer_signal'));
   const sized=consumers.map(i=>({input:i,bytes:Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(i,cfg.configuration)))})).sort((a,b)=>a.bytes-b.bytes||a.input.root_id.localeCompare(b.input.root_id));
   const anchors=[sized[0]!.input,sized.at(-1)!.input,...sized.slice(1,-1).map(x=>x.input)].filter((i,n,a)=>a.findIndex(x=>x.root_id===i.root_id)===n).slice(0,32);
   assert.equal(anchors.length,32);await complete(anchors);
   const shape=signalListeningCalibrationShapeV1(cfg.configuration,anchors[0]!),sourceProfile=await deriveSignalListeningCalibrationV1({...access,run_id:warmRun.id,shape_digest:shape.shape_digest});
   assert.ok(sourceProfile);assert.equal(sourceProfile.sample_count,32);assert.equal(new Set(sourceProfile.source_call_ids).size,32);assert.equal(sourceProfile.scope.phase,'consumer_category');
   assert.equal(sourceProfile.source_run_id,warmRun.id,'coverage must be derived from this exact scope run');
   await warmStore.renew(warmRun);
   const intercept:CoveredNativeFixture['intercept']={},evidence:CoveredNativeFixture['evidence']=[];
   const database={query:original.query.bind(original),connect:async()=>{const c=await original.connect();return new Proxy(c,{get(target,key){
    if(key==='query')return async(sql:string,values?:unknown[])=>{await intercept.before?.(sql,target);const result=await target.query(sql,values);
     if(sql==='BEGIN')await target.query("SET LOCAL track_functions='all'");
     if(sql.includes('labeling_native_covered_insert_v1')||sql.includes('labeling_native_covered_mark_v1'))evidence.push({operation:sql.includes('labeling_native_covered_insert_v1')?'insert':'mark',
      population_calls:await exposureCalls(target,'signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'),money_calls:await exposureCalls(target,'signal_listening_statement_money_v1()')});
     await intercept.after?.(sql,target);return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});}}as NativeFixture['database'];
   const store=createSignalListeningStoreV1({database,rawPages,storeRaw:async()=>{throw Error('no provider or individual receipt');}}),run=warmRun;
   const inputs=await store.inputs(run);assert.equal(inputs.length,28);assert.ok(inputs.every(i=>i.question_keys.join(',')==='consumer_signal'));
   assert.ok(store.admitAndMarkSelected,'constructor-authenticated Native Listening+RAW exposes the private operation');
   await body({database,run,store,rawPages,inputs,configuration:cfg.configuration,intercept,evidence,sourceProfile,prewarm_calls:counter,probeDatabase:original,editorial});
  }finally{await rm(files,{recursive:true,force:true});}
 }});
}
function freshSelection<I extends SignalListeningInputV1>(select:(p:readonly LabelingCallProposalV1<I>[])=>readonly LabelingCallProposalV1<I>[],
 validate:(calls:readonly LabelingCallV1<I>[],selected:readonly LabelingCallProposalV1<I>[])=>void=()=>{}):LabelingAdmissionSelectionV1<I>{return{selectFresh:select,validateBeforeCommit:validate};}
async function coveredLedger(f:CoveredNativeFixture){return(await f.database.query('SELECT to_jsonb(c) row FROM signal_labeling_calls c WHERE run_id=$1 ORDER BY id',[f.run.id])).rows;}

test('atomic native covered fresh admission exercises both E statements after32 real consumer receipts; keeps zero/fallback/cap/rollback contracts',{
 skip:!enabled,timeout:600000,
},async t=>withCoveredNativeFixture(1000000,async f=>{
 const observer=await loadWireObserverContractV1(),catalogBefore=await attestWireObserverRuntimeV1(f.database,observer),fresh=()=>proposals({...f,inputs:f.inputs.slice(2,4)},1000);
 let committed:readonly LabelingCallV1<SignalListeningInputV1>[]=[],validated:readonly LabelingCallV1<SignalListeningInputV1>[]|undefined;
 await t.test('actual covered commit returns exact ordered cohort, correct links, two actual fresh E populations and the same beforeCommit array',async()=>{
  let selected=0,validation=0;const rows=proposals({...f,inputs:f.inputs.slice(0,2)},1000);
  const result=await f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>{selected++;return p;},(calls,plan)=>{validation++;validated=calls;assert.equal(calls.length,2);assert.deepEqual(plan,rows);assert.ok(calls.every(c=>c.status==='submitting'&&!c.raw_body));
   for(const call of calls){const proposed=rows.find(p=>p.custom_id===call.custom_id)!;assert.deepEqual(call.request,proposed.request);assert.deepEqual(call.inputs,proposed.inputs);assert.equal(Number(call.reserved_micro_usd),1000);}}));
  assert.equal(result.kind,'committed');assert.equal(selected,1);assert.equal(validation,1);if(result.kind!=='committed')throw Error('expected actual native fastpath');
  assert.equal(result.calls,validated);committed=result.calls;assert.equal(committed.length,2);
  assert.deepEqual(f.evidence,[{operation:'insert',population_calls:1,money_calls:1},{operation:'mark',population_calls:2,money_calls:2}],'both real commands execute the current full E source independently');
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1 AND call_id=ANY($2::uuid[])',[f.run.id,result.calls.map(c=>c.id)])).rows[0].n,2);
  const persisted=(await f.database.query('SELECT id,request,inputs,created_at,updated_at,reserved_micro_usd FROM signal_labeling_calls WHERE id=ANY($1::uuid[]) ORDER BY id',[result.calls.map(c=>c.id)])).rows;
  for(const call of result.calls){const stored=persisted.find(row=>row.id===call.id);assert.ok(stored);
   assert.equal(JSON.stringify(call.request),JSON.stringify(stored.request),'the provider body keeps the actual PostgreSQL JSONB key/numeric wire order');
   assert.equal(JSON.stringify(call.inputs),JSON.stringify(stored.inputs));assert.deepEqual(call.created_at,stored.created_at);assert.deepEqual(call.updated_at,stored.updated_at);
   assert.equal(call.reserved_micro_usd,stored.reserved_micro_usd);
  }
 });
 await t.test('zero late selection invokes validation once but creates no new reservation or Mark',async()=>{
  const before=await coveredLedger(f),evidence=f.evidence.length;let selected=0,validation=0;
  const result=await f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(()=>{selected++;return[];},calls=>{validation++;assert.deepEqual(calls,[]);}));
  assert.equal(result.kind,'committed');assert.equal(selected,1);assert.equal(validation,1);assert.deepEqual(await coveredLedger(f),before);assert.equal(f.evidence.length,evidence);
 });
 await t.test('existing and mixed packets return legacy before either late callback or any DML',async()=>{
  const before=await coveredLedger(f);for(const rows of [proposals({...f,inputs:f.inputs.slice(0,1)},1000),[...proposals({...f,inputs:f.inputs.slice(0,1)},1000),...fresh()]]){
   const result=await f.store.admitAndMarkSelected!(f.run,rows,freshSelection(()=>{throw Error('legacy cannot claim response credits');},()=>{throw Error('legacy cannot validate a new handoff');}));assert.equal(result.kind,'legacy');
  }assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('generic0multi and unsupported retries retain legacy, without new rejections or financial mutations',async()=>{
  const before=await coveredLedger(f);for(const mode of ['zero','multi','retry']as const){const rows=fresh();if(mode==='zero')rows[0]!.inputs=[];if(mode==='multi')rows[0]!.inputs.push(f.inputs[4]!);if(mode==='retry')Object.assign(rows[0]!,{retry_depth:1});
   assert.equal((await f.store.admitAndMarkSelected!(f.run,rows,freshSelection(()=>{throw Error('unsupported callback');}))).kind,'legacy');}assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('an invalid fullSHA reaches E INSERT and rolls back the entire fresh packet',async()=>{
  const before=await coveredLedger(f),rows=fresh();rows[1]!.request_digest='sha256:'+'0'.repeat(64);rows[1]!.custom_id='listening_'+rows[1]!.request_digest.slice(7,67);
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p)),error=>{
   assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'rolled_back');assert.equal(error.message,'listening_request_invalid');
   assert.match(String((error.cause as {where?:unknown}|undefined)?.where),/signal_listening_statement_money_v1/,'invalid fullSHA must fail in E, not the row guard');return true;});assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('immutable source rejects text changes between INSERT and Mark while both actual E statements revalidate the unchanged request',async()=>{
  const before=await coveredLedger(f),rows=fresh(),start=f.evidence.length;let inserted=false,markAttempted=false,validated=false;
  const beforeDml=new Map<'insert'|'mark',{population_calls:number;money_calls:number}>();
  const sourceBefore=(await f.database.query('SELECT text FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3',[f.run.workspace_id,rows[0]!.inputs[0]!.map_id,rows[0]!.inputs[0]!.root_id])).rows[0].text;
  f.intercept.after=async(sql,c)=>{if(sql.includes('labeling_native_covered_insert_v1')){inserted=true;
   // The snapshot is immutable: a source UPDATE cannot legitimately reach E.
   // Keep that guard installed, prove its rejection inside a savepoint, and
   // continue to the real Mark statement with the original fullSHA payload.
   await c.query('SAVEPOINT native_immutable_source_probe');
   try{await assert.rejects(c.query("UPDATE signal_mass_labeling_items SET text=text||' source changed between native statements' WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3",[f.run.workspace_id,rows[0]!.inputs[0]!.map_id,rows[0]!.inputs[0]!.root_id]),error=>{
    assert.ok(error instanceof Error&&'code'in error);assert.equal(error.code,'23514');assert.equal(error.message,'mass_labeling_history_is_immutable');return true;});}
   finally{await c.query('ROLLBACK TO SAVEPOINT native_immutable_source_probe');await c.query('RELEASE SAVEPOINT native_immutable_source_probe');}
  }};
  f.intercept.before=async(sql,c)=>{
   const operation=sql.includes('labeling_native_covered_insert_v1')?'insert':sql.includes('labeling_native_covered_mark_v1')?'mark':null;
   if(operation){beforeDml.set(operation,{population_calls:await exposureCalls(c,'signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'),money_calls:await exposureCalls(c,'signal_listening_statement_money_v1()')});if(operation==='mark')markAttempted=true;}
  };
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,calls=>{
   validated=true;for(const call of calls){const proposal=rows.find(row=>row.custom_id===call.custom_id)!;
    assert.equal(call.status,'submitting');assert.deepEqual(call.request,proposal.request);assert.deepEqual(call.inputs,proposal.inputs);
    assert.equal(signalListeningRequestDigestV1(f.run,call.inputs[0]!,call.request as never),call.request_digest);}
   throw Error('synthetic_fullsha_mark_probe_rollback');
  })),/synthetic_fullsha_mark_probe_rollback/);}
  finally{f.intercept.after=undefined;f.intercept.before=undefined;}
  assert.equal(inserted,true);assert.equal(markAttempted,true);assert.equal(validated,true);
  // The constructor's authorized preflight may already have called population
  // in this transaction. Measure each actual DML against its own prior census;
  // do not transfer an absolute counter expectation from another connection.
  assert.deepEqual(f.evidence.slice(start).map(event=>{const baseline=beforeDml.get(event.operation);assert.ok(baseline);
   return{operation:event.operation,population_calls:event.population_calls-baseline.population_calls,money_calls:event.money_calls-baseline.money_calls};
  }),[{operation:'insert',population_calls:1,money_calls:1},{operation:'mark',population_calls:1,money_calls:1}]);
  assert.deepEqual(await coveredLedger(f),before);
  assert.equal((await f.database.query('SELECT text FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 AND root_id=$3',[f.run.workspace_id,rows[0]!.inputs[0]!.map_id,rows[0]!.inputs[0]!.root_id])).rows[0].text,sourceBefore);
 });
 await t.test('Mark authority denial rolls back fresh reservations, retaining the intentional new atomicity',async()=>{
  const before=await coveredLedger(f);let inserted=false;f.intercept.after=async(sql,c)=>{if(sql.includes('labeling_native_covered_insert_v1')){inserted=true;await c.query("UPDATE users SET status='suspended' WHERE id=$1",[f.run.actor_user_id]);}};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p)),/processing_forbidden|labeling_forbidden/);}finally{f.intercept.after=undefined;}
  assert.equal(inserted,true);assert.deepEqual(await coveredLedger(f),before);assert.equal((await f.database.query('SELECT status FROM users WHERE id=$1',[f.run.actor_user_id])).rows[0].status,'active');
 });
 await t.test('validation rejection beforeCOMMIT rolls back both DML and cannot invoke automatic legacy fallback',async()=>{
  const before=await coveredLedger(f),start=f.evidence.length;let validation=0;
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p,()=>{validation++;throw Error('synthetic_precommit_handoff_denied');})),/synthetic_precommit_handoff_denied/);
  assert.equal(validation,1);assert.equal(f.evidence.length,start+2);assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('deferred physical lease expiry at COMMIT rolls back fresh INSERT and submitting transition',async()=>{
  const before=await coveredLedger(f);f.intercept.before=async(sql,c)=>{if(sql==='COMMIT')await c.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p)),/labeling_lease_lost/);}finally{f.intercept.before=undefined;}
  assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('a lost INSERT ACK with confirmed rollback is classified and cannot fall back or attempt a second INSERT',async()=>{
  const before=await coveredLedger(f);let inserts=0,validations=0;f.intercept.after=async sql=>{if(sql.includes('labeling_native_covered_insert_v1')){inserts++;throw Error('synthetic_atomic_insert_ack_lost');}};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p,()=>{validations++;})),error=>{
   assert.ok(error instanceof Error&&'outcome'in error);assert.equal(error.outcome,'rolled_back');assert.match(error.message,/synthetic_atomic_insert_ack_lost/);return true;});}
  finally{f.intercept.after=undefined;}assert.equal(inserts,1);assert.equal(validations,0);assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('INSERT and ROLLBACK ACK loss remains UNKNOWN, discards only its own client and never starts another admission',async()=>{
  const before=await coveredLedger(f);let backend=0,inserts=0;
  f.intercept.after=async(sql,c)=>{if(sql.includes('labeling_native_covered_insert_v1')){inserts++;backend=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);throw Error('synthetic_insert_transport_lost');}};
  f.intercept.before=async sql=>{if(sql==='ROLLBACK')throw Error('synthetic_rollback_transport_lost');};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p)),error=>{
   assert.ok(error instanceof Error&&'outcome'in error&&'custom_ids'in error);assert.equal(error.outcome,'unknown');assert.ok(error.cause instanceof AggregateError);assert.equal(error.cause.errors.length,2);assert.equal((error.custom_ids as string[]).length,2);return true;});}
  finally{f.intercept.before=undefined;f.intercept.after=undefined;}
  assert.equal(inserts,1);assert.ok(backend>0);let ended=false;const deadline=Date.now()+3000;
  do{ended=(await f.probeDatabase.query('SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1',[backend])).rows[0].n===0;if(!ended)await pageDelay(20);}while(!ended&&Date.now()<deadline);
  assert.equal(ended,true,'the discarded owned connection ends; this observation is not a rollback ACK');assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('late and precommit callbacks are synchronous; a mutated handoff cannot poison the paid row or provider body',async()=>{
  const before=await coveredLedger(f),start=f.evidence.length;
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),{selectFresh:(()=>Promise.reject(Error('async selection rejected')))as never,validateBeforeCommit:()=>{}}),/labeling_admission_callback_invalid/);
  assert.equal(f.evidence.length,start);
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p,(()=>Promise.reject(Error('async validation rejected')))as never)),/labeling_admission_callback_invalid/);
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p,calls=>{calls[0]!.request.state='poison';})),/labeling_admission_handoff_changed/);
  assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('actual inline SQL packet preserves Unicode strings and finite JSON numbers without changing the JS reservation',async()=>{
  const before=await coveredLedger(f),rows=structuredClone(fresh().slice(0,1)),input=rows[0]!.inputs[0]! as SignalListeningInputV1&{extra_numeric?:number[];extra_unicode?:string};
  input.extra_numeric=[1e-7,1e20,-0,.25];input.extra_unicode='quoted " / newline\n tab\t ☕ \u2028';let validated=0;
  const probe=input as typeof input&{extra_keys?:Record<string,unknown>};probe.extra_keys={'zz':1e-7,'a':-0,'é':1e20,'z':.25,'10':['ten'],'2':'two'};
  const driver:{row?:{request:unknown;inputs:unknown}}={};f.intercept.after=async(sql,c)=>{if(sql.includes('labeling_native_covered_mark_v1'))
   driver.row=(await c.query('SELECT request,inputs FROM signal_labeling_calls WHERE run_id=$1 AND custom_id=$2',[f.run.id,rows[0]!.custom_id])).rows[0];};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,calls=>{validated++;assert.deepEqual(calls[0]!.inputs,JSON.parse(JSON.stringify(rows[0]!.inputs)));assert.deepEqual(calls[0]!.request,rows[0]!.request);
   assert.ok(driver.row);assert.equal(JSON.stringify(calls[0]!.request),JSON.stringify(driver.row.request));assert.equal(JSON.stringify(calls[0]!.inputs),JSON.stringify(driver.row.inputs),'actual PG JSONB round trip preserves Unicode, numeric and key-order provider custody');
   assert.equal(Number(calls[0]!.reserved_micro_usd),1000);throw Error('synthetic_packet_positive_rollback');})),/synthetic_packet_positive_rollback/);}
  finally{f.intercept.after=undefined;}
  assert.equal(validated,1);assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('run cap exact-fit and minus1 reach both E guards before a deliberately rolled-back validation probe',async()=>{
  const before=await coveredLedger(f);let spent=0;await transaction(f,async c=>{spent=Number(await readSignalLabelingRunExposureV1(c,f.run.id));});
  for(const delta of [-1,0]){const amount=Number(f.run.cap_micro_usd)-spent+delta,rows=fresh().slice(0,1),events=f.evidence.length;rows[0]!.reserved_micro_usd=amount;let validated=0;
   await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,calls=>{validated++;assert.equal(Number(calls[0]!.reserved_micro_usd),amount);throw Error('synthetic_cap_positive_rollback');})),/synthetic_cap_positive_rollback/);
   assert.equal(validated,1);assert.equal(f.evidence.length,events+2,'both E commands accept the exact fresh cumulative cap boundary');assert.deepEqual(await coveredLedger(f),before);
  }
 });
 await t.test('sum+1 cap rejection uses only the late selected fresh prefix and preserves all prior exposure',async()=>{
  const before=await coveredLedger(f),rows=fresh();let spent=0;await transaction(f,async c=>{spent=Number(await readSignalLabelingRunExposureV1(c,f.run.id));});const remaining=1000000-spent;rows[0]!.reserved_micro_usd=Math.floor(remaining/2);rows[1]!.reserved_micro_usd=remaining-rows[0]!.reserved_micro_usd+1;
  await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p)),/labeling_cap_exhausted/);assert.deepEqual(await coveredLedger(f),before);
 });
 await t.test('a lost actual COMMIT ACK propagates once, leaves the one cohort durable and never automatically retries',async()=>{
  let ackLost=false,insertCount=0;f.intercept.after=async sql=>{if(sql.includes('labeling_native_covered_insert_v1'))insertCount++;if(sql==='COMMIT'&&!ackLost){ackLost=true;throw Error('synthetic_atomic_commit_ack_lost');}};
  try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,fresh(),freshSelection(p=>p)),/synthetic_atomic_commit_ack_lost/);}finally{f.intercept.after=undefined;}
  assert.equal(ackLost,true);assert.equal(insertCount,1);assert.equal((await coveredLedger(f)).length,f.prewarm_calls+4);
  const restarted=createSignalListeningStoreV1({database:f.database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
  assert.equal((await restarted.admitAndMarkSelected!(f.run,fresh(),freshSelection(()=>{throw Error('existing on restart cannot send');}))).kind,'legacy');
  assert.ok((await restarted.calls(f.run)).every(c=>c.status==='submitting'&&!c.raw_body),'restart discovers ambiguous native status; this test makes no provider attempts');
 });
 assert.deepEqual(await attestWireObserverRuntimeV1(f.database,observer),catalogBefore,'all tests leave actual current E function/catalog/ACL identical');
}));


test('native covered preflight rejects a genuine measured32 profile from another run before claiming credits',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 assert.equal(f.sourceProfile.source_run_id,f.run.id);await f.store.release(f.run);
 await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[f.run.id]);
 const owner=(await f.database.query('SELECT configuration_id,map_id FROM signal_listening_runs WHERE run_id=$1',[f.run.id])).rows[0];
 const next=await requestSignalListeningV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,
  configuration_id:owner.configuration_id,map_id:owner.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
 const run=await f.store.claim(next.run_id);assert.ok(run);assert.notEqual(run.id,f.sourceProfile.source_run_id);
 const inputs=await f.store.inputs(run);assert.equal(inputs.length,28);const before=(await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n;
 const result=await f.store.admitAndMarkSelected!(run,proposals({run,inputs:inputs.slice(0,1),configuration:f.configuration},1000),freshSelection(()=>{throw Error('wrong run profile cannot claim memory or HTTP credits');}));
 assert.equal(result.kind,'legacy');assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,before);
}));

for(const same of [true,false])test('atomic covered concurrency '+(same?'falls back for the one durable existing identity':'cannot overspend the same remaining run budget'),{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(2000,async f=>{
 let spent=0;await transaction(f,async c=>{spent=Number(await readSignalLabelingRunExposureV1(c,f.run.id));});assert.ok(2000-spent>=1000&&2000-spent<2000);
 const held=pageDeferred(),attempted=pageDeferred(),release=pageDeferred();let caught=false,holder=0,waiter=0;const custody:{client?:PoolClient}={};
 f.intercept.after=async(sql,c)=>{if(!caught&&sql==='SELECT * FROM signal_labeling_calls WHERE custom_id=ANY($1::text[])'){
  caught=true;custody.client=c;holder=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);held.resolve();await release.promise;
 }};
 f.intercept.before=async(sql,c)=>{if(holder&&!waiter&&reservePolicyLock(sql)){waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}};
 const rows=proposals({...f,inputs:f.inputs.slice(0,1)},1000);let firstSelected=0,secondSelected=0;
 const first=f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>{firstSelected++;return p;})).then(value=>({value,error:null}),error=>({value:null,error}));
 let second:typeof first|undefined;
 try{await reserveGate(held.promise);second=f.store.admitAndMarkSelected!(f.run,same?rows:proposals({...f,inputs:f.inputs.slice(1,2)},1000),freshSelection(p=>{secondSelected++;return p;}))
  .then(value=>({value,error:null}),error=>({value:null,error}));await reserveGate(attempted.promise);assert.ok(custody.client);await requireListeningPageBlock(custody.client,holder,waiter);
 }finally{release.resolve();await Promise.all([first,second]);f.intercept.before=undefined;f.intercept.after=undefined;}
 const a=await first;assert.equal(a.error,null);assert.equal(a.value?.kind,'committed');assert.equal(firstSelected,1);assert.ok(second);const b=await second;
 if(same){assert.equal(b.error,null);assert.equal(b.value?.kind,'legacy');assert.equal(secondSelected,0);}
 else{assert.match(String(b.error),/labeling_cap_exhausted/);assert.equal(secondSelected,1);}
 const fresh=(await f.database.query('SELECT status,count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND NOT results_applied GROUP BY status',[f.run.id])).rows;
 assert.deepEqual(fresh,[{status:'submitting',n:1}]);assert.equal((await coveredLedger(f)).length,f.prewarm_calls+1);
}));

for(const mutation of ['lease','policy','actor']as const)test('atomic covered admission checks '+mutation+' fresh after the actual authority wait and sends no new cohort',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const before=await coveredLedger(f),holder=await f.database.connect(),attempted=pageDeferred();let waiter=0,caught=false,selected=0;
 await holder.query('BEGIN');await holder.query("SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='5s'");
 const holderPid=Number((await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid);
 if(mutation==='lease')await holder.query('SELECT id FROM signal_labeling_runs WHERE id=$1 FOR UPDATE',[f.run.id]);
 else await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||organization_id::text,0)) FROM signal_workspaces WHERE id=$1",[f.run.workspace_id]);
 f.intercept.before=async(sql,c)=>{if(!caught&&(mutation==='lease'?sql.includes('WITH raw_run_fence'):reservePolicyLock(sql))){caught=true;waiter=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);attempted.resolve();}};
 const sending=f.store.admitAndMarkSelected!(f.run,proposals({...f,inputs:f.inputs.slice(0,1)},1000),freshSelection(p=>{selected++;return p;})).then(()=>null,error=>error);
 try{await reserveGate(attempted.promise);await requireListeningPageBlock(holder,holderPid,waiter);
  if(mutation==='lease')await holder.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.run.id]);
  if(mutation==='policy')await holder.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=(SELECT policy_version_id FROM signal_processing_admissions WHERE id=$1)",[f.run.processing_admission_id]);
  if(mutation==='actor')await holder.query("UPDATE users SET status='suspended' WHERE id=$1",[f.run.actor_user_id]);
  await holder.query('COMMIT');assert.match(String(await sending),/labeling_lease_lost|labeling_policy_changed|processing_policy_expired|processing_forbidden|labeling_forbidden/);
 }finally{f.intercept.before=undefined;await holder.query('ROLLBACK').catch(()=>{});holder.release();await sending;}
 assert.equal(selected,0);assert.deepEqual(await coveredLedger(f),before);
}));


test('the actual fresh-only preflight retains whole-row SELECT permissions through same-session prepared REVOKE and restoration',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 let actualSql='';f.intercept.before=async sql=>{if(sql==='SELECT * FROM signal_labeling_calls WHERE custom_id=ANY($1::text[])')actualSql=sql;};
 const result=await f.store.admitAndMarkSelected!(f.run,proposals({...f,inputs:f.inputs.slice(0,1)},1000),freshSelection(p=>p));f.intercept.before=undefined;
 assert.equal(result.kind,'committed');assert.ok(actualSql,'capture the actual implemented preflight, not a separate query guessed by the test');
 const c=await f.probeDatabase.connect(),role='r16_atomic_read_'+randomUUID().replaceAll('-',''),quoted='"'+role+'"',prepared='r16_atomic_prepared_'+randomUUID().replaceAll('-','');
 const unused='raw_storage_verified_key',values=[proposals({...f,inputs:f.inputs.slice(1,2)},1000).map(p=>p.custom_id)];
 const attempt=async()=>{await c.query('SAVEPOINT atomic_prepared_probe');let output:{code:string|null;rows:number|null};
  try{await c.query('SET LOCAL ROLE '+quoted);const r=await c.query({name:prepared,text:actualSql,values});output={code:null,rows:r.rows.length};}
  catch(error){assert.ok(error&&typeof error==='object'&&'code'in error);output={code:String(error.code),rows:null};}
  finally{await c.query('ROLLBACK TO SAVEPOINT atomic_prepared_probe');await c.query('RELEASE SAVEPOINT atomic_prepared_probe');}return output;
 };
 try{await c.query('BEGIN');const owned=(await c.query("SELECT current_database() name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0];assert.match(owned.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(owned.super,true);
  await c.query('CREATE ROLE '+quoted+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');await c.query('GRANT USAGE ON SCHEMA public TO '+quoted);await c.query('GRANT SELECT ON TABLE signal_labeling_calls TO '+quoted);
  assert.deepEqual(await attempt(),{code:null,rows:0});
  await c.query('REVOKE SELECT ON TABLE signal_labeling_calls FROM PUBLIC,'+quoted);
  const columns=(await c.query("SELECT attname FROM pg_attribute WHERE attrelid='signal_labeling_calls'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(r=>String(r.attname));assert.ok(columns.includes(unused));
  await c.query('GRANT SELECT('+columns.filter(k=>k!==unused).map(k=>'"'+k.replaceAll('"','""')+'"').join(',')+') ON TABLE signal_labeling_calls TO '+quoted);
  assert.equal((await c.query("SELECT has_column_privilege($1::name,'signal_labeling_calls'::regclass,$2,'SELECT') allowed",[role,unused])).rows[0].allowed,false);
  assert.deepEqual(await attempt(),{code:'42501',rows:null},'prepared empty-existing preflight still checks its unused column');
  await c.query('GRANT SELECT ON TABLE signal_labeling_calls TO '+quoted);assert.deepEqual(await attempt(),{code:null,rows:0},'the same named prepared statement works after restoration');
 }finally{await c.query('ROLLBACK');if((await c.query('SELECT name FROM pg_prepared_statements WHERE name=$1',[prepared])).rows.length)await c.query('DEALLOCATE "'+prepared+'"');c.release();}
}));


test('atomic covered admission includes real warmup and a genuine Sonnet sibling in the same finite organization day cap',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const sibling=f.editorial;assert.ok(sibling);assert.equal(f.sourceProfile.source_run_id,f.run.id);assert.equal(f.sourceProfile.sample_count,32);
 const sealed=(await f.database.query(`SELECT e.hard_cap_micro_usd::text cap,request.request_digest,request.reserved_micro_usd::text first_request
  FROM signal_topic_editorial_executions e CROSS JOIN LATERAL(SELECT r.request_digest,r.reserved_micro_usd FROM signal_topic_editorial_requests r WHERE r.execution_id=e.id ORDER BY batch_index,request_digest LIMIT 1) request
  WHERE e.id=$1`,[sibling.execution_id])).rows[0];assert.ok(sealed);assert.ok(BigInt(sealed.first_request)>0n&&BigInt(sealed.first_request)<BigInt(sealed.cap));
 const exposure=async()=>BigInt((await f.database.query('SELECT total_micro_usd::text n FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)',[sibling.organization_id,sibling.budget_timezone])).rows[0].n);
 const beforeSibling=await exposure();assert.ok(beforeSibling>0n,'normal warmups and prior native owners have real exposure');
 assert.ok(BigInt(sibling.daily_cap_micro_usd)-beforeSibling>=BigInt(sealed.first_request),'the independently sealed request fits after actual warmups');
 await prepareSignalTopicEditorialBatchV2({database:f.database,execution_id:sibling.execution_id,request_digests:[sealed.request_digest],submission_key:'atomic-covered-day-'+randomUUID()});
 const afterSibling=await exposure(),headroom=BigInt(sibling.daily_cap_micro_usd)-afterSibling;assert.ok(afterSibling>beforeSibling&&headroom>=0n);
 let runSpent=0;await transaction(f,async c=>{runSpent=Number(await readSignalLabelingRunExposureV1(c,f.run.id));});
 const amount=Number(headroom+1n);assert.ok(Number.isSafeInteger(amount)&&amount>0&&amount<=Number(f.run.cap_micro_usd)-runSpent);
 const rows=proposals({...f,inputs:f.inputs.slice(0,1)},amount),before=await coveredLedger(f);let selected=0;
 await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>{selected++;return p;})),/labeling_daily_cap_exhausted|processing_daily_cap_exhausted/);
 assert.equal(selected,1,'same-run32 covered fastpath reached its late selection before the day amount check');
 assert.deepEqual(await coveredLedger(f),before);assert.equal(await exposure(),afterSibling);assert.ok(afterSibling<=BigInt(sibling.daily_cap_micro_usd));
},true));


test('atomic same-run32 covered child admission preserves real parent exposure and executes its E parent check once per DML',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const observer=await loadWireObserverContractV1(),catalogBefore=await attestWireObserverRuntimeV1(f.database,observer);
 const advances=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});
 const lease=await advances.claim({database:f.database,execution_id:f.execution.id});assert.ok(lease);
 const subset=await advances.ensureSubset({database:f.database,lease,generation_id:lease.source_generation_id});const numeric=await f.emptyNumeric(subset);
 await advances.persistNumeric({database:f.database,lease,subset_id:subset.id,numeric});
 // The editorial reservation alone has a fixed lower bound of1,004,484
 // microUSD. The old1M override could never admit this round. Use the existing
 // fixture's4M discovery allocation from creation; all caps stay immutable.
 const roundQuote=await quoteSignalListeningDiscoveryRoundV1({...f,generation_id:lease.source_generation_id,ordinal:lease.next_ordinal,orphan_groups:[]});
 const requestBodyBytes=roundQuote.input_token_upper_bound-4096;
 assert.equal(roundQuote.reservation_micro_usd,(requestBodyBytes+4096)*6+64000*15);
 const preflightExposure=BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);
 assert.equal(BigInt(f.execution.cap_micro_usd),4000000n);
 const preflight={request_body_bytes:requestBodyBytes,input_token_upper_bound:roundQuote.input_token_upper_bound,maximum_output_tokens:roundQuote.maximum_output_tokens,
  reservation_micro_usd:roundQuote.reservation_micro_usd,exposure_micro_usd:preflightExposure.toString(),cap_micro_usd:f.execution.cap_micro_usd};
 console.log('# atomic child admission preflight '+JSON.stringify(preflight));
 assert.ok(preflightExposure+BigInt(roundQuote.reservation_micro_usd)<=BigInt(f.execution.cap_micro_usd),JSON.stringify(preflight));
 const round=await advances.enqueue({database:f.database,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,
  expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,
  numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});assert.ok(round&&round.status!=='budget_exhausted');await advances.release({database:f.database,lease});
 const child=await f.prepareRoundChild(round as ListeningDiscoveryRoundV1),rawPages:NativeFixture['rawPages']={
  reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
  async store(a){const path=join(f.files,'atomic-child-'+a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const fd=await open(path,'r+');try{await fd.sync();}finally{await fd.close();}assert.equal(await readFile(path,'utf8'),a.raw_text);
   return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},
  load:a=>readFile(join(f.files,'atomic-child-'+a.sha256.slice(7)),'utf8')};
 const labeling=createSignalListeningStoreV1({database:f.database,rawPages,storeRaw:async()=>{throw Error('no individual provider/raw');}}),run=await labeling.claim(child.run_id);assert.ok(run);
 const inputs=await labeling.inputs(run),groups=new Map<string,SignalListeningInputV1[]>();
 for(const input of inputs){const shape=signalListeningCalibrationShapeV1(child.configuration,input),rows=groups.get(shape.shape_digest)??[];rows.push(input);groups.set(shape.shape_digest,rows);}
 const candidates=[...groups.values()].sort((a,b)=>b.length-a.length)[0];assert.ok(candidates&&candidates.length>32,JSON.stringify({requirement:'the real child has at least32 receipts and a later covered cohort of the same shape',roots:f.roots.length,inputs:inputs.length,shape_counts:[...groups].map(([shape,rows])=>({shape,roots:rows.length}))}));
 const sorted=candidates.map(input=>({input,bytes:Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(input,child.configuration)))})).sort((a,b)=>a.bytes-b.bytes||a.input.root_id.localeCompare(b.input.root_id));
 const anchors=[sorted[0]!.input,sorted.at(-1)!.input,...sorted.slice(1,-1).map(x=>x.input)].filter((i,n,a)=>a.findIndex(x=>x.root_id===i.root_id)===n).slice(0,32);
 const calls=await labeling.reserve(run,proposals({run,inputs:anchors,configuration:child.configuration},1000));await labeling.markSubmitting(run,calls);
 const makeOutcomes=(batch:ReadonlyArray<LabelingCallV1<SignalListeningInputV1>>)=>batch.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,child.configuration),response={model:child.configuration.model,usage:{input_tokens:120,output_tokens:20},
  answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>q.type==='noul'?[key,{type:'noul' as const,noul:.9}]:[key,{type:'choice' as const,choice:'individual',confidence:.9,
   probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};
  return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),usage:jevUsageV1(response.usage),settled_micro_usd:6,result:mapSignalListeningJevResponseV1(input,run.context,child.configuration,response)};});
 const outcomes=makeOutcomes(calls);await labeling.persistRawPage(run,outcomes);await labeling.settlePage(run,outcomes);await labeling.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));
 const shape=signalListeningCalibrationShapeV1(child.configuration,anchors[0]!),profile=await deriveSignalListeningCalibrationV1({...f,run_id:run.id,shape_digest:shape.shape_digest});assert.ok(profile);assert.equal(profile.sample_count,32);assert.equal(profile.source_run_id,run.id);
 const eligible=(await labeling.inputs(run)).filter(i=>signalListeningCalibrationShapeV1(child.configuration,i).shape_digest===shape.shape_digest);assert.ok(eligible.length>0);
 const events:number[]=[],fn='signal_listening_discovery_exposure_v1(uuid,text,uuid)';
 const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,values?:unknown[])=>{const result=await target.query(sql,values);if(sql==='BEGIN')await target.query("SET LOCAL track_functions='all'");if(sql.includes('labeling_native_covered_insert_v1')||sql.includes('labeling_native_covered_mark_v1'))events.push(await exposureCalls(target,fn));return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}}as NativeFixture['database'];
 const store=createSignalListeningStoreV1({database,rawPages,storeRaw:async()=>{throw Error('no provider');}}),parentBefore=BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);
 const result=await store.admitAndMarkSelected!(run,proposals({run,inputs:eligible.slice(0,1),configuration:child.configuration},1000),freshSelection(p=>p));assert.equal(result.kind,'committed');assert.deepEqual(events,[1,2]);
 const parentAfter=BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);
 assert.equal(parentAfter,parentBefore+1000n);assert.ok(parentAfter<=BigInt(f.execution.cap_micro_usd));
 assert.equal(result.kind,'committed');if(result.kind!=='committed')throw Error('native positive admission required');
 const positiveOutcomes=makeOutcomes(result.calls);await labeling.persistRawPage(run,positiveOutcomes);await labeling.settlePage(run,positiveOutcomes);
 await labeling.apply(run,positiveOutcomes.map(o=>({call:o.call,results:[o.result]})));await labeling.renew(run);
 // Adversarial disposable-laboratory concurrency setup, allowed by the actual
 // DB guards. This is not the ordinary worker path and does not assert product
 // recovery from failed. Park/resume and the sibling's real held reservation
 // occur in one fixture transaction; caps, funding, source and profiles stay
 // immutable. No role/trigger/function changes or fabricated money rows.
 const immutable=async()=>({parent:(await f.database.query('SELECT cap_micro_usd,policy_version_id,policy_digest,actor_user_id,map_id FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0],
  run:(await f.database.query('SELECT cap_micro_usd,processing_admission_id,labeler_digest,entity_context_digest FROM signal_labeling_runs WHERE id=$1',[run.id])).rows[0],
  profile:(await f.database.query('SELECT source_run_id,profile FROM signal_listening_calibrations WHERE source_run_id=$1 ORDER BY created_at,id',[run.id])).rows});
 const invariantBefore=await immutable(),freshInputs=(await labeling.inputs(run)).filter(i=>signalListeningCalibrationShapeV1(child.configuration,i).shape_digest===shape.shape_digest);
 assert.ok(freshInputs.length>=2);const target=freshInputs[0]!;
 const beforeSibling=BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n),cap=BigInt(f.execution.cap_micro_usd);
 const siblingAmount=cap-beforeSibling-999n,maxSiblingAmount=BigInt(run.cap_micro_usd!);assert.ok(siblingAmount>0n&&maxSiblingAmount===1000000n);
 const siblingPlan:Array<{input:SignalListeningInputV1;amount:bigint}>=[];let remainingSiblingAmount=siblingAmount;
 for(const input of freshInputs.slice(1)){if(remainingSiblingAmount===0n)break;
  const amount=remainingSiblingAmount>maxSiblingAmount?maxSiblingAmount:remainingSiblingAmount;
  siblingPlan.push({input,amount});remainingSiblingAmount-=amount;
 }
 assert.equal(remainingSiblingAmount,0n,'enough distinct genuine pending roots for individually bounded sibling reservations');
 assert.ok(siblingPlan.length>1);assert.equal(new Set(siblingPlan.map(p=>p.input.root_id)).size,siblingPlan.length);
 const siblingCalls:Array<{run_id:string;call:LabelingCallV1<SignalListeningInputV1>}>=[];
 const setupClient=await f.database.connect(),stack:string[]=[];let serial=0;
 const setupQuery=(async(sql:string,values?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const name='atomic_parent_setup_'+(++serial);stack.push(name);return setupClient.query('SAVEPOINT '+name);}
  if(sql==='COMMIT')return setupClient.query('RELEASE SAVEPOINT '+stack.pop()!);
  if(sql==='ROLLBACK'){const name=stack.pop()!;await setupClient.query('ROLLBACK TO SAVEPOINT '+name);return setupClient.query('RELEASE SAVEPOINT '+name);}
  if(sql.startsWith('SET TRANSACTION'))return setupClient.query('SELECT 1');return setupClient.query(sql,values);
 })as PoolClient['query'];
 const scoped=Object.assign(Object.create(setupClient),{query:setupQuery,release(){}})as PoolClient;
 const setupDatabase=Object.assign(Object.create(f.database),{query:setupQuery,connect:async()=>scoped})as NativeFixture['database'];
 try{await setupClient.query('BEGIN');await setupClient.query("UPDATE signal_labeling_runs SET status='failed' WHERE id=$1 AND status='running' AND lease_token=$2",[run.id,run.lease_token]);
  assert.equal((await setupClient.query('SELECT status FROM signal_labeling_runs WHERE id=$1',[run.id])).rows[0].status,'failed');
  const owner=(await setupClient.query('SELECT configuration_id,map_id FROM signal_listening_runs WHERE run_id=$1',[run.id])).rows[0];
  for(const planned of siblingPlan){
   assert.ok(planned.amount>0n&&planned.amount<=maxSiblingAmount);assert.notEqual(planned.input.root_id,target.root_id);
   const requested=await requestSignalListeningV1({database:setupDatabase,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id,
    configuration_id:owner.configuration_id,map_id:owner.map_id,idempotency_key:randomUUID(),cap_micro_usd:Number(run.cap_micro_usd),provider_available:true});
   const siblingRunId=requested.run_id;
   await setupClient.query('INSERT INTO signal_listening_discovery_children(execution_id,workspace_id,run_id,preparation_id,round_id) VALUES($1,$2,$3,NULL,$4)',[f.execution.id,run.workspace_id,siblingRunId,round.id]);
   const siblingStore=createSignalListeningStoreV1({database:setupDatabase,rawPages,storeRaw:async()=>{throw Error('no provider');}}),siblingRun=await siblingStore.claim(siblingRunId);assert.ok(siblingRun);
   assert.equal(BigInt(siblingRun.cap_micro_usd!),maxSiblingAmount);
   const siblingInput=(await siblingStore.inputs(siblingRun)).find(i=>i.root_id===planned.input.root_id);assert.ok(siblingInput);
   const siblingCall=(await siblingStore.reserve(siblingRun,proposals({run:siblingRun,inputs:[siblingInput],configuration:child.configuration},Number(planned.amount))))[0];assert.ok(siblingCall);assert.equal(siblingCall.status,'reserved');
   assert.equal(BigInt(siblingCall.reserved_micro_usd),planned.amount);siblingCalls.push({run_id:siblingRunId,call:siblingCall});
   await setupClient.query("UPDATE signal_labeling_runs SET status='failed' WHERE id=$1 AND status='running'",[siblingRunId]);
  }
  await setupClient.query("UPDATE signal_labeling_runs SET status='running',lease_until=clock_timestamp()+interval '1 hour' WHERE id=$1 AND lease_token=$2",[run.id,run.lease_token]);
  assert.equal(stack.length,0);await setupClient.query('COMMIT');
 }catch(error){await setupClient.query('ROLLBACK');throw error;}finally{setupClient.release();}
 assert.equal(siblingCalls.length,siblingPlan.length);assert.deepEqual(await immutable(),invariantBefore,'caps, policy binding, source and measured32 profile are untouched');
 const siblings=(await f.database.query('SELECT c.run_id,r.status FROM signal_listening_discovery_children c JOIN signal_labeling_runs r ON r.id=c.run_id WHERE c.execution_id=$1 AND c.run_id=ANY($2::uuid[]) ORDER BY c.run_id',[f.execution.id,[run.id,...siblingCalls.map(row=>row.run_id)]])).rows;
 assert.equal(siblings.length,siblingCalls.length+1);assert.equal(siblings.find(r=>r.run_id===run.id)?.status,'running');
 for(const sibling of siblingCalls)assert.equal(siblings.find(r=>r.run_id===sibling.run_id)?.status,'failed');
 const parentHeld=BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n);assert.equal(parentHeld,cap-999n);
 const authority=(await f.database.query(`SELECT r.cap_micro_usd::text run_cap,a.policy_version_id,p.daily_cap_micro_usd::text day_cap,action.max_execution_micro_usd::text action_cap,
  (SELECT total_micro_usd FROM signal_processing_org_exposure_v1(a.organization_id,a.budget_date,a.budget_timezone))::text day_spent
  FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
  JOIN signal_processing_policy_actions action ON action.policy_version_id=p.id AND action.action=a.action WHERE r.id=$1`,[run.id])).rows[0];assert.ok(authority);
 const runSpent=await(async()=>{const c=await f.database.connect();try{return BigInt(await readSignalLabelingRunExposureV1(c,run.id));}finally{c.release();}})();
 assert.ok(BigInt(authority.run_cap)-runSpent>1000n);assert.ok(authority.action_cap===null||BigInt(authority.action_cap)-runSpent>1000n);
 assert.ok(authority.day_cap===null||BigInt(authority.day_cap)-BigInt(authority.day_spent)>1000n,'organization day is deliberately not the failing guard');
 const heldSiblings=async()=>(await f.database.query('SELECT to_jsonb(c) value FROM signal_labeling_calls c WHERE id=ANY($1::uuid[]) ORDER BY id',[siblingCalls.map(row=>row.call.id)])).rows;
 const heldSiblingBefore=await heldSiblings();assert.equal(heldSiblingBefore.length,siblingCalls.length);
 const countBefore=(await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n;let lateSelected=0;
 await assert.rejects(store.admitAndMarkSelected!(run,proposals({run,inputs:[target],configuration:child.configuration},1000),freshSelection(p=>{lateSelected++;return p;})),error=>{
  assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'rolled_back');assert.equal(error.message,'listening_discovery_parent_cap_exhausted');
  assert.match(String((error.cause as {where?:unknown}|undefined)?.where),/signal_listening_statement_money_v1/,'actual E parent RAISE, not BEFORE ROW or a Node budget check');return true;
 });
 assert.equal(lateSelected,1);assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,countBefore);
 assert.deepEqual(await heldSiblings(),heldSiblingBefore,'all competing genuine held reservations survive the denied cohort');
 assert.equal(BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[f.execution.id])).rows[0].n),parentHeld);
 assert.deepEqual(await immutable(),invariantBefore);assert.deepEqual(await attestWireObserverRuntimeV1(f.database,observer),catalogBefore);await labeling.release(run);
},{population_count:240,initial_approved:240}));


// Compound lifecycle reconciliation acceptance. The thrown admission outcome is
// UNKNOWN until authoritative ledger reconciliation; it is not a promise of
// permanent run blocking. These are separate measured32 fixtures and execute
// the real fail/finish/release/claim methods, including finish's FOR UPDATE.
async function compoundNativeExposureV1(f:CoveredNativeFixture){
 const c=await f.database.connect();try{return BigInt(await readSignalLabelingRunExposureV1(c,f.run.id));}finally{c.release();}
}
const nativeRunRowV1=async(f:CoveredNativeFixture)=>(await f.database.query('SELECT status,error_code,lease_token,lease_until FROM signal_labeling_runs WHERE id=$1',[f.run.id])).rows[0];

test('native INSERT plus ROLLBACK ACK loss is not retried automatically; real finish reconciles zero rows before reopening the same identities',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 assert.equal(f.sourceProfile.source_run_id,f.run.id);assert.equal(f.sourceProfile.sample_count,32);
 const rows=proposals({...f,inputs:f.inputs.slice(0,2)},1000),customIds=rows.map(p=>p.custom_id),roots=rows.map(p=>p.inputs[0]!.root_id);
 const baseline=await coveredLedger(f),exposureBefore=await compoundNativeExposureV1(f);let inserts=0,marks=0,validations=0,backend=0;
 let bodyTransaction='',finishTransaction='',phase:'fault'|'fail'|'finish'|'restart'='fault';
 f.intercept.after=async(sql,c)=>{
  if(sql.includes('labeling_native_covered_insert_v1')){inserts++;backend=Number((await c.query('SELECT pg_backend_pid() pid')).rows[0].pid);
   bodyTransaction=String((await c.query('SELECT pg_current_xact_id()::text xid')).rows[0].xid);throw Error('synthetic_compound_insert_ack_lost');}
  if(sql.includes('labeling_native_covered_mark_v1'))marks++;
 };
 f.intercept.before=async sql=>{if(sql==='ROLLBACK')throw Error('synthetic_compound_rollback_ack_lost');};
 try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,()=>{validations++;})),error=>{
  assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'unknown');assert.deepEqual(error.custom_ids,customIds);
  assert.ok(error.cause instanceof AggregateError);assert.equal(error.cause.errors.length,2);return true;});}
 finally{f.intercept.before=undefined;f.intercept.after=undefined;}
 assert.equal(inserts,1);assert.equal(marks,0);assert.equal(validations,0,'no committed cohort was handed to the provider');assert.ok(backend>0);assert.ok(bodyTransaction);
 // Connection teardown is a physical observation, not a transport rollback ACK.
 let ended=false;const deadline=Date.now()+3000;
 do{ended=(await f.probeDatabase.query('SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1',[backend])).rows[0].n===0;if(!ended)await pageDelay(20);}while(!ended&&Date.now()<deadline);
 assert.equal(ended,true);assert.deepEqual(await coveredLedger(f),baseline);assert.equal(await compoundNativeExposureV1(f),exposureBefore);
 const lifecycle:string[]=[];
 f.intercept.after=async(sql,c)=>{
  if(sql.includes('labeling_native_covered_insert_v1'))inserts++;
  if(sql.includes('labeling_native_covered_mark_v1'))marks++;
  if(sql.includes('SELECT id FROM signal_labeling_runs')&&sql.includes('FOR UPDATE')){
   lifecycle.push(phase+':FOR UPDATE');if(phase==='finish'){
    finishTransaction=String((await c.query('SELECT pg_current_xact_id()::text xid')).rows[0].xid);
    const actual=(await c.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND custom_id=ANY($2::text[])",[f.run.id,customIds])).rows[0];
    assert.equal(actual.n,0,'the real finish run lock precedes the authoritative absence observation');
   }
  }
 };
 try{
  phase='fail';await f.store.fail(f.run,'labeling_outcome_unknown',{preserve_reserved:true});
  assert.equal((await nativeRunRowV1(f)).error_code,'labeling_outcome_unknown');assert.equal(inserts,1);
  phase='finish';assert.equal(await f.store.finish(f.run),'running');assert.ok(lifecycle.includes('finish:FOR UPDATE'));assert.ok(finishTransaction);assert.notEqual(finishTransaction,bodyTransaction);
  const finished=await nativeRunRowV1(f);assert.equal(finished.status,'running');assert.equal(finished.error_code,null);
  assert.deepEqual(await coveredLedger(f),baseline);assert.equal(await compoundNativeExposureV1(f),exposureBefore);assert.equal(inserts,1);assert.equal(marks,0);
  await f.store.release(f.run,{immediate:true});assert.equal((await nativeRunRowV1(f)).lease_token,null);
  phase='restart';const restarted=createSignalListeningStoreV1({database:f.database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider or individual RAW');}});
  const claimed=await restarted.claim(f.run.id);assert.ok(claimed);assert.notEqual(claimed.lease_token,f.run.lease_token);assert.equal(claimed.error_code,null);
  const available=await restarted.inputs(claimed);assert.ok(roots.every(root=>available.some(input=>input.root_id===root)));
  const again=proposals({run:claimed,inputs:roots.map(root=>available.find(input=>input.root_id===root)!),configuration:f.configuration},1000);
  assert.deepEqual(again.map(p=>p.custom_id),customIds);assert.equal(inserts,1,'no second financial attempt precedes authoritative finish and a new lease');
  // Explicit next operation after reconciliation, not an automatic retry of
  // the unknown operation. It reserves once and never invokes evaluate/HTTP.
  const admitted=await restarted.admitAndMarkSelected!(claimed,again,freshSelection(p=>p,()=>{validations++;}));assert.equal(admitted.kind,'committed');
  if(admitted.kind!=='committed')throw Error('reconciled zero-row identities must be fresh');assert.deepEqual(admitted.calls.map(call=>call.custom_id),customIds);
  assert.equal(inserts,2);assert.equal(marks,1);assert.equal(validations,1);assert.equal(await compoundNativeExposureV1(f),exposureBefore+2000n);
  assert.ok(admitted.calls.every(call=>call.status==='submitting'&&!call.raw_body&&!call.raw_storage_key&&!call.results_applied));await restarted.release(claimed,{immediate:true});
 }finally{f.intercept.after=undefined;f.intercept.before=undefined;}
}));

test('native durable COMMIT ACK loss keeps the same money and identities through real finish and restart claim; unknown calls cannot be selected for resending',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 assert.equal(f.sourceProfile.source_run_id,f.run.id);assert.equal(f.sourceProfile.sample_count,32);
 const rows=proposals({...f,inputs:f.inputs.slice(0,2)},1000),customIds=rows.map(p=>p.custom_id),roots=rows.map(p=>p.inputs[0]!.root_id);
 const exposureBefore=await compoundNativeExposureV1(f);let inserts=0,marks=0,validations=0,lost=false;const lifecycle:string[]=[];
 let phase:'fault'|'fail'|'finish'|'restart'|'terminal'='fault';
 f.intercept.after=async sql=>{if(sql.includes('labeling_native_covered_insert_v1'))inserts++;if(sql.includes('labeling_native_covered_mark_v1'))marks++;
  if(sql==='COMMIT'&&!lost){lost=true;throw Error('synthetic_compound_durable_commit_ack_lost');}};
 try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,()=>{validations++;})),error=>{
  assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'unknown');assert.equal(error.message,'synthetic_compound_durable_commit_ack_lost');
  assert.deepEqual(error.custom_ids,customIds);assert.equal(error.call_ids.length,2);return true;});}
 finally{f.intercept.after=undefined;}
 assert.equal(lost,true);assert.equal(inserts,1);assert.equal(marks,1);assert.equal(validations,1);
 // raw_body is a virtual loaded-bytes field since0255, never a SQL column.
 // Prove absence with all physical receipt markers AND the RAW member relation.
 const durable=async()=>(await f.database.query(`SELECT c.id,c.custom_id,c.request_digest,c.request,c.inputs,c.status,c.reserved_micro_usd::text,c.settled_micro_usd,c.terminal_exposure_micro_usd::text,
  c.request_storage_key,c.raw_sha256,c.raw_storage_key,c.raw_size_bytes,c.raw_storage_verified_at,c.raw_storage_verified_key,c.provider_batch_id,c.results,c.results_applied,
  NOT EXISTS(SELECT 1 FROM signal_labeling_raw_page_members member WHERE member.call_id=c.id) raw_page_absent
  FROM signal_labeling_calls c WHERE c.run_id=$1 AND c.custom_id=ANY($2::text[]) ORDER BY c.custom_id`,[f.run.id,customIds])).rows;
 const committed=await durable();assert.equal(committed.length,2);assert.ok(committed.every(call=>call.status==='submitting'&&call.raw_page_absent===true
  &&['request_storage_key','raw_sha256','raw_storage_key','raw_size_bytes','raw_storage_verified_at','raw_storage_verified_key','provider_batch_id','settled_micro_usd','results'].every(key=>call[key]===null)&&!call.results_applied));
 assert.equal(await compoundNativeExposureV1(f),exposureBefore+2000n);
 f.intercept.after=async(sql,c)=>{
  if(sql.includes('labeling_native_covered_insert_v1'))inserts++;if(sql.includes('labeling_native_covered_mark_v1'))marks++;
  if(sql.includes('SELECT id FROM signal_labeling_runs')&&sql.includes('FOR UPDATE')){
   lifecycle.push(phase+':FOR UPDATE');if(phase==='finish')assert.equal((await c.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND custom_id=ANY($2::text[]) AND status='submitting'",[f.run.id,customIds])).rows[0].n,2);
  }
 };
 try{
  phase='fail';await f.store.fail(f.run,'labeling_outcome_unknown',{preserve_reserved:true});assert.equal((await nativeRunRowV1(f)).error_code,'labeling_outcome_unknown');
  phase='finish';assert.equal(await f.store.finish(f.run),'running');assert.ok(lifecycle.includes('finish:FOR UPDATE'));
  assert.deepEqual(await durable(),committed,'finish retains the submitting calls and fabricates no RAW or answer');assert.equal(await compoundNativeExposureV1(f),exposureBefore+2000n);
  await f.store.release(f.run,{immediate:true});assert.equal((await nativeRunRowV1(f)).lease_token,null);
  phase='restart';const restarted=createSignalListeningStoreV1({database:f.database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider or individual RAW');}});
  const claimed=await restarted.claim(f.run.id);assert.ok(claimed);assert.notEqual(claimed.lease_token,f.run.lease_token);
  const reconciled=await durable();assert.deepEqual(reconciled,committed.map(call=>({...call,status:'unknown'})),'real claim reconciles durable submitting to unknown without changing frozen bodies or exposure');
  const available=await restarted.inputs(claimed);assert.ok(available.every(input=>!roots.includes(input.root_id)),'same-run question links exclude the paid identities');
  const discovered=await restarted.calls(claimed);assert.deepEqual(discovered.map(call=>call.id).sort(),committed.map(call=>call.id).sort());assert.ok(discovered.every(call=>call.status==='unknown'&&!call.raw_body&&!call.raw_storage_key&&!call.results_applied));
  const result=await restarted.admitAndMarkSelected!(claimed,rows,freshSelection(()=>{throw Error('existing unknown identities cannot claim a handoff');},()=>{throw Error('existing unknown identities cannot validate a fresh cohort');}));assert.equal(result.kind,'legacy');
  const existing=await restarted.reserve(claimed,rows);assert.deepEqual(existing.map(call=>call.id).sort(),committed.map(call=>call.id).sort());assert.ok(existing.every(call=>call.status==='unknown'));
  await assert.rejects(restarted.markSubmittingSelected!(claimed,()=>existing),/labeling_mark_selection_invalid/);
  assert.equal(inserts,1);assert.equal(marks,1);assert.equal(validations,1);assert.deepEqual(await durable(),reconciled);assert.equal(await compoundNativeExposureV1(f),exposureBefore+2000n);
  phase='terminal';assert.equal(await restarted.finish(claimed),'failed');assert.equal((await nativeRunRowV1(f)).error_code,'labeling_outcome_unknown');
  assert.deepEqual(await durable(),reconciled);assert.equal(await compoundNativeExposureV1(f),exposureBefore+2000n);await restarted.release(claimed,{immediate:true});
 }finally{f.intercept.after=undefined;f.intercept.before=undefined;}
}));


// Read-scoped survey acceptance: no policy cache or body survives as authority.
import {signalListeningInputSurveyStorageBoundV1,type SignalListeningInputSurveyV1} from '../signal-listening-runs';
test('metadata survey and all scan/anchor hydrations own one RR read-only client; escaped scopes expire before Native DML',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 let owned=0,connections=0;
 const oneSlot={query:f.database.query.bind(f.database),connect:async()=>{
  assert.equal(owned,0,'the scan must work with a one-slot pool');owned++;connections++;
  let c:PoolClient;try{c=await f.database.connect();}catch(error){owned--;throw error;}
  return new Proxy(c,{get(target,key){if(key==='release')return(...args:Parameters<PoolClient['release']>)=>{owned--;return target.release(...args);};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 }}as NativeFixture['database'];
 const store=createSignalListeningStoreV1({database:oneSlot,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
 const observed:Array<{pid:number;readonly:string;snapshot:string}>=[],capture:{scope?:SignalListeningInputSurveyV1}={};
 f.intercept.before=async(sql,c)=>{if(sql.includes('labeling_listening_input_metadata_v1')||sql.includes('labeling_listening_input_body_v1')){
  observed.push((await c.query("SELECT pg_backend_pid() pid,current_setting('transaction_read_only') readonly,txid_current_snapshot()::text snapshot")).rows[0]);
 }};
 try{await store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  capture.scope=scope;assert.equal(owned,1);assert.equal(scope.hints.length,f.inputs.length);
  assert.ok(scope.retained_bytes<=signalListeningInputSurveyStorageBoundV1(f.run,4096));
  assert.ok(Object.isFrozen(scope.hints));assert.ok(scope.hints.every(h=>!('text'in h)&&!('request'in h)&&h.question_keys.join(',')==='consumer_signal'));
  assert.deepEqual(scope.hints.map(h=>h.root_id),f.inputs.map(i=>i.root_id));
  const first=scope.hydrate([scope.hints[0]!.root_id],{max_rows:1,max_working_bytes:512*1024*1024});
  await assert.rejects(scope.hydrate([scope.hints[1]!.root_id],{max_rows:1,max_working_bytes:512*1024*1024}),/survey_reentrant/);
  assert.equal((await first).kind,'ready');
  for(let offset=0;offset<scope.hints.length;offset+=8){const ids=scope.hints.slice(offset,offset+8).map(h=>h.root_id),hydrated=await scope.hydrate(ids,{max_rows:ids.length,max_working_bytes:512*1024*1024});
   assert.equal(hydrated.kind,'ready');if(hydrated.kind!=='ready')throw Error('complete scan expected');assert.deepEqual(hydrated.inputs,f.inputs.slice(offset,offset+ids.length));
  }
  const ids=[scope.hints.at(-1)!.root_id,scope.hints[0]!.root_id,scope.hints[1]!.root_id],anchors=await scope.hydrate(ids,{max_rows:3,max_working_bytes:512*1024*1024});
  assert.equal(anchors.kind,'ready');if(anchors.kind!=='ready')throw Error('all selected anchors expected');assert.deepEqual(anchors.inputs.map(i=>i.root_id),ids,'exact chosen anchor order, no refill');
  await assert.rejects(scope.hydrate([randomUUID()],{max_rows:1,max_working_bytes:512*1024*1024}),/survey_selection_invalid/);
  assert.equal(connections,1);assert.equal(owned,1);
 });}finally{f.intercept.before=undefined;}
 assert.equal(owned,0);assert.equal(connections,1);assert.ok(observed.length>=4);
 assert.equal(new Set(observed.map(o=>o.pid)).size,1);assert.equal(new Set(observed.map(o=>o.snapshot)).size,1);assert.ok(observed.every(o=>o.readonly==='on'));
 assert.ok(capture.scope);await assert.rejects(capture.scope.hydrate([f.inputs[0]!.root_id],{max_rows:1,max_working_bytes:512*1024*1024}),/survey_expired/);
 assert.equal(connections,1,'an expired scope cannot reacquire a connection');
 await assert.rejects(store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  const unawaited=scope.hydrate([scope.hints[0]!.root_id],{max_rows:1,max_working_bytes:512*1024*1024});void unawaited.catch(()=>undefined);
 }),/survey_unawaited/);assert.equal(owned,0,'an unawaited read is drained before rollback/release');
 await assert.rejects(store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async()=>{throw Error('synthetic_read_scope_abort');}),/synthetic_read_scope_abort/);
 assert.equal(owned,0,'callback failure cannot retain the one pool slot');
}));

test('each new survey feed observes current reservations and Brand OS; only its private RR projections can supply bodies or byte budgets',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const selected=await f.store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  assert.ok(scope.hints.length>=3);let byteLimited=0;const id=scope.hints[0]!.root_id;
  assert.deepEqual(await scope.hydrate([id],{max_rows:1,max_working_bytes:0,on_oversize:'empty',on_byte_limit:()=>{byteLimited++;}}),{kind:'stale'});
  assert.equal(byteLimited,1,'current hydration budget is reapplied even within the original RR');
  await assert.rejects(scope.hydrate([id],{max_rows:1,max_working_bytes:0,on_oversize:'error'}),/input_memory_bound/);
  const hint=scope.hints[0]!;assert.throws(()=>{(hint.question_keys as string[]).push('poison');});
  assert.equal(Reflect.set(hint.question_digests,'consumer_signal','poison'),false);
  assert.equal(Reflect.set(hint.scope_basis,'consumer_signal','poison'),false);
  const same=await scope.hydrate([id],{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(same.kind,'ready');
  return scope.hints.slice(0,3).map(h=>h.root_id);
 });
 const reserved=await f.store.reserve(f.run,proposals({...f,inputs:[f.inputs[0]!]},1000));assert.equal(reserved.length,1);const before=await coveredLedger(f);
 await f.store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  assert.ok(scope.hints.every(h=>h.root_id!==selected[0]),'a new RR survey re-evaluates committed run/question reservations');
  assert.equal(scope.hints.length,f.inputs.length-1);
  await assert.rejects(scope.hydrate([selected[0]!],{max_rows:1,max_working_bytes:512*1024*1024}),/survey_selection_invalid/);
 });
 const current=(await f.database.query("SELECT revision FROM signal_listening_configurations WHERE workspace_id=$1 AND state='published' ORDER BY revision DESC LIMIT 1",[f.run.workspace_id])).rows[0];
 await saveSignalListeningConfigurationV1({database:f.database,workspace_id:f.run.workspace_id,actor_user_id:f.run.actor_user_id,expected_revision:current.revision,
  provenance:'human',configuration:{...f.configuration,instructions:f.configuration.instructions+' A fresh human instruction.'}});
 await f.store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  assert.deepEqual(scope.hints,[],'a new published Brand OS configuration invalidates the old run before any body is hydrated');
 });
 assert.deepEqual(await coveredLedger(f),before);
}));

for(const stage of ['insert','mark']as const)test('compact actual '+stage+' result rejects proposal mutation across SQL await before reconstructing a provider handoff',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const before=await coveredLedger(f),rows=proposals({...f,inputs:f.inputs.slice(0,2)},1000);let mutations=0,validations=0;
 f.intercept.after=async sql=>{if(sql.includes('labeling_native_covered_'+stage+'_v1')){mutations++;rows[0]!.request.state='poisoned after the original packet was sent';}};
 try{await assert.rejects(f.store.admitAndMarkSelected!(f.run,rows,freshSelection(p=>p,()=>{validations++;})),error=>{
  assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'rolled_back');assert.equal(error.message,'labeling_admission_selection_invalid');return true;});}
 finally{f.intercept.after=undefined;}
 assert.equal(mutations,1);assert.equal(validations,0);assert.deepEqual(await coveredLedger(f),before);
 assert.deepEqual(f.evidence.map(e=>e.operation),stage==='insert'?['insert']:['insert','mark'],'no second admission, fallback or extra DML follows a mutated return');
}));

test('compact returned proof is strict and a missing or false flag rolls back without legacy replay or provider delivery',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const before=await coveredLedger(f);
 for(const defect of ['false','missing']as const){let changed=0,validated=0;
  const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){
   if(key==='query')return async(sql:string,values?:unknown[])=>{const result=await target.query(sql,values);
    if(sql.includes('labeling_native_covered_insert_v1')){changed++;assert.ok(result.rows.length);if(defect==='false')result.rows[0].payload_matches=false;else delete result.rows[0].payload_matches;}
    return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}}as NativeFixture['database'];
  const store=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
  await assert.rejects(store.admitAndMarkSelected!(f.run,proposals({...f,inputs:f.inputs.slice(0,1)},1000),freshSelection(p=>p,()=>{validated++;})),error=>{
   assert.ok(error instanceof LabelingAdmissionFailureV1);assert.equal(error.outcome,'rolled_back');assert.equal(error.message,'labeling_admission_return_invalid');return true;});
  assert.equal(changed,1);assert.equal(validated,0);assert.deepEqual(await coveredLedger(f),before);
 }
}));

test('both actual compact DML retain WholeRowVar unused-column SELECT authority across prepared revoke and restore in one session',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const captured=new Map<'insert'|'mark',{text:string;values:unknown[]}>();
 // Capture the actual implemented SQL and arguments, including the ORIGINAL
 // compact packet. After success these same arguments select no fresh rows.
 const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){
  if(key==='query')return async(text:string,values?:unknown[])=>{const result=await target.query(text,values);for(const stage of ['insert','mark']as const)
   if(text.includes('labeling_native_covered_'+stage+'_v1'))captured.set(stage,{text,values:values??[]});return result;};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});}}as NativeFixture['database'];
 const store=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});
 assert.equal((await store.admitAndMarkSelected!(f.run,proposals({...f,inputs:f.inputs.slice(0,1)},1000),freshSelection(p=>p))).kind,'committed');
 const before=await coveredLedger(f),c=await f.probeDatabase.connect(),role='r16_compact_return_'+randomUUID().replaceAll('-',''),quoted='"'+role+'"';
 const unused='native_unused_returning_probe',preparedNames:string[]=[];
 try{await c.query('BEGIN');const owned=(await c.query("SELECT current_database() name,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0];
  assert.match(owned.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(owned.super,true);
  // Test-only nullable future metadata column, always rolled back. It is
  // deliberately absent from the outer transport projection and every guard.
  await c.query('ALTER TABLE signal_labeling_calls ADD COLUMN '+unused+' text');
  await c.query('CREATE ROLE '+quoted+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');
  await c.query('GRANT USAGE ON SCHEMA public,extensions TO '+quoted);await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+quoted);
  await c.query('GRANT INSERT,UPDATE ON signal_labeling_calls TO '+quoted);
  // BEFORE INSERT still runs before ON CONFLICT discards the durable row.
  // 0307's human decision guard needs these two explicit invoker EXECUTEs;
  // 0318 retired cross_run_call_guard, so prior_outcome_roots is not needed.
  // These grants belong only to this NOINHERIT lab role and roll back below.
  await c.query('GRANT EXECUTE ON FUNCTION public.signal_listening_human_decision_exists_v1(uuid,uuid,uuid,uuid,text,text,text),public.signal_listening_human_revision_v1(uuid) TO '+quoted);
  const columns=(await c.query("SELECT attname FROM pg_attribute WHERE attrelid='signal_labeling_calls'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(row=>String(row.attname));assert.ok(columns.includes(unused));
  for(const stage of ['insert','mark']as const){const query=captured.get(stage);assert.ok(query);assert.match(query.text,/RETURNING \*/);assert.ok(!query.text.includes(unused));
   const prepared='r16_compact_'+stage+'_'+randomUUID().replaceAll('-','');preparedNames.push(prepared);
   const attempt=async()=>{await c.query('SAVEPOINT compact_returning_probe');let answer:{code:string|null;rows:number|null;where?:unknown};
    try{await c.query('SET LOCAL ROLE '+quoted);const result=await c.query({name:prepared,text:query.text,values:query.values});answer={code:null,rows:result.rows.length};}
    catch(error){assert.ok(error&&typeof error==='object'&&'code'in error);answer={code:String(error.code),rows:null,where:'where'in error?error.where:undefined};}
    finally{await c.query('ROLLBACK TO SAVEPOINT compact_returning_probe');await c.query('RELEASE SAVEPOINT compact_returning_probe');}return answer;
   };
   assert.deepEqual(await attempt(),{code:null,rows:0},stage+' actual query works with whole-table SELECT');
   await c.query('REVOKE SELECT ON signal_labeling_calls FROM PUBLIC,'+quoted);
   await c.query('GRANT SELECT('+columns.filter(name=>name!==unused).map(name=>'"'+name.replaceAll('"','""')+'"').join(',')+') ON signal_labeling_calls TO '+quoted);
   assert.equal((await c.query("SELECT has_column_privilege($1::name,'signal_labeling_calls'::regclass,$2,'SELECT') allowed",[role,unused])).rows[0].allowed,false);
   const denied=await attempt();assert.equal(denied.code,'42501');assert.equal(denied.rows,null);assert.equal(denied.where,undefined,'target WholeRowVar permission fails before any E function executes');
   await c.query('GRANT SELECT ON signal_labeling_calls TO '+quoted);assert.deepEqual(await attempt(),{code:null,rows:0},stage+' same prepared statement restores original authority');
  }
 }finally{await c.query('ROLLBACK');for(const prepared of preparedNames)if((await c.query('SELECT name FROM pg_prepared_statements WHERE name=$1',[prepared])).rows.length)await c.query('DEALLOCATE "'+prepared+'"');c.release();}
 assert.deepEqual(await coveredLedger(f),before,'permission probes never create another financial attempt');
}));


test('survey exact state-string byte count equals JS on valid PostgreSQL UTF8 and derives whole request size from the compiler header',{
 skip:!enabled,timeout:600000,
},async()=>withMoneyFixture(1000000,async f=>{
 const controls=Array.from({length:31},(_,i)=>String.fromCharCode(i+1)).join('');
 const texts=['plain','quote " and backslash \\',controls,'emoji 😀 ☕','combining e\u0301 vs é','separators \u2028 and \u2029','C1 \u0085 and DEL \u007f'];
 const encoded=(await f.database.query('SELECT value,octet_length(to_json(value)::text)::int bytes FROM unnest($1::text[]) WITH ORDINALITY probe(value,ordinal) ORDER BY ordinal',[texts])).rows;
 assert.equal(encoded.length,texts.length);for(let i=0;i<texts.length;i++){assert.equal(encoded[i].value,texts[i]);assert.equal(encoded[i].bytes,Buffer.byteLength(JSON.stringify(texts[i])));}
 await f.store.withInputSurvey(f.run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>{
  assert.equal(scope.hints.length,f.inputs.length);
  for(const hint of scope.hints){const hydrated=await scope.hydrate([hint.root_id],{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(hydrated.kind,'ready');if(hydrated.kind!=='ready')throw Error('fresh exact input expected');
   const input=hydrated.inputs[0]!,placeholder='compiler placeholder ☕ "quoted"',header=buildSignalListeningJevRequestV1({...input,text:placeholder},f.configuration);
   assert.equal(hint.state_json_bytes,Buffer.byteLength(JSON.stringify(input.text)),'same immutable prepared i.text as hydration, not mentions.text_clean');
   assert.equal(Buffer.byteLength(JSON.stringify(buildSignalListeningJevRequestV1(input,f.configuration))),
    Buffer.byteLength(JSON.stringify(header))-Buffer.byteLength(JSON.stringify(placeholder))+hint.state_json_bytes);
   assert.ok(hydrated.retained_bytes>8192&&hydrated.retained_bytes<=512*1024*1024);
  }
 });
}));


test('survey JSON-string encoding is guarded by the original fitting prefix and never allocates the oversized prepared body',{
 skip:!enabled,timeout:600000,
},async()=>withCoveredNativeFixture(1000000,async f=>{
 const initial=await f.store.withInputSurvey(f.run,{max_rows:3,max_working_bytes:512*1024*1024},async scope=>scope.hints.slice());
 assert.equal(initial.length,3);assert.ok(initial.every(h=>h.state_json_bytes>1000),'the fixture uses genuinely long immutable prepared text');
 const firstWorking=Number(initial[0]!.working_bytes),memoryBeforeFirst=firstWorking-1;
 assert.ok(signalListeningInputSurveyStorageBoundV1(f.run,1)<memoryBeforeFirst,'metadata itself fits; it is the original body-price sentinel that stops the read');
 const observed:Array<{root_id:string;state_json_bytes:string|null}>=[];let bodyReads=0;
 const database={query:f.database.query.bind(f.database),connect:async()=>{const c=await f.database.connect();return new Proxy(c,{get(target,key){
  if(key==='query')return async(sql:string,values?:unknown[])=>{if(sql.includes('labeling_listening_input_body_v1'))bodyReads++;
   const result=await target.query(sql,values);if(sql.includes('survey_state_bytes AS MATERIALIZED'))for(const row of result.rows)observed.push({root_id:row.root_id,state_json_bytes:row.state_json_bytes});return result;
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});}}as NativeFixture['database'];
 const store=createSignalListeningStoreV1({database,rawPages:f.rawPages,storeRaw:async()=>{throw Error('no provider');}});let notified=0;
 await store.withInputSurvey(f.run,{max_rows:1,max_working_bytes:memoryBeforeFirst,on_oversize:'empty',on_byte_limit:()=>{notified++;}},async scope=>{
  assert.deepEqual(scope.hints,[]);assert.equal(bodyReads,0);
 });
 assert.equal(notified,1);assert.deepEqual(observed,[{root_id:initial[0]!.root_id,state_json_bytes:null}],'CASE leaves the non-fitting row unencoded, before the JS oversize guard');
 await assert.rejects(store.withInputSurvey(f.run,{max_rows:1,max_working_bytes:memoryBeforeFirst,on_oversize:'error'},async()=>{throw Error('an oversized read cannot enter the callback');}),/input_memory_bound/);
 assert.equal(bodyReads,0);
 observed.length=0;const fittingBudget=Number(initial[0]!.working_bytes)+Number(initial[1]!.working_bytes);let limited=0;
 await store.withInputSurvey(f.run,{max_rows:3,max_working_bytes:fittingBudget,on_oversize:'empty',on_byte_limit:()=>{limited++;}},async scope=>{
  assert.deepEqual(scope.hints.map(h=>h.root_id),initial.slice(0,2).map(h=>h.root_id));
  assert.equal(scope.hints[1]!.state_json_bytes,initial[1]!.state_json_bytes,'the last fitting root retains its exact string boundary');
  await assert.rejects(scope.hydrate([initial[2]!.root_id],{max_rows:1,max_working_bytes:512*1024*1024}),/survey_selection_invalid/);
 });
 assert.equal(limited,1);assert.equal(bodyReads,0);assert.equal(observed.at(-1)!.root_id,initial[2]!.root_id);assert.equal(observed.at(-1)!.state_json_bytes,null);
},false,{study_text_length:13000}));
