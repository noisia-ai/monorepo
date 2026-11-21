import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
 buildMassLabelingJevRequestV2,massLabelingConfigurationV2,signalWorkspaceEmbeddingDigestV1,
 type SignalListeningInputV1} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import type {LabelingRunV1,LabelingCallV1} from '../signal-labeling-runs';
import type {LabelingDatabaseV1} from '../signal-mention-facets';
import {planNativeListeningAdmissionPacketV1,nativeListeningAdmissionPacketBodyV1,
 NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,NATIVE_LISTENING_ADMISSION_MARK_SQL_V1,
 reconstructNativeListeningAdmissionRowsV1} from '../signal-listening-native-admission';

const enabled=process.env.NOISIA_R16_LINK_STATEMENT_PG==='true';
const benchmark=process.env.NOISIA_R16_LINK_STATEMENT_BENCHMARK_PG==='true';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const quote=(identifier:string)=>'"'+identifier.replaceAll('"','""')+'"';
type Context={database:LabelingDatabaseV1;run_id:string;workspace_id:string;actor_user_id:string;map_id:string};
type Fixture={database:LabelingDatabaseV1;run:LabelingRunV1;inputs:SignalListeningInputV1[];
 configuration:ReturnType<typeof signalListeningBaseTemplateV1>;renew:()=>Promise<void>};
type Arm='baseline'|'candidate';
type PgFailure={code:string|null;message:string;constraint:string|null};
type CallJsonData=Record<string,unknown>&{id:string;custom_id:string};
type CallJsonRow={row:CallJsonData};
type CallQuestionRow={workspace_id:string;run_id:string;call_id:string;root_id:string;question_key:string;question_digest:string};
type ExposureRow={confirmed_micro_usd:string;reserved_micro_usd:string;ambiguous_micro_usd:string;total_micro_usd:string};
type Snapshot={calls:CallJsonRow[];links:CallQuestionRow[];exposure:ExposureRow[]};
type ArmResult<T>={value?:T;error?:PgFailure;rows:Snapshot;rollback_acknowledged:boolean};
type NativeDmlValue={elapsed_ms:number;count:number;links:number};
type NormalizedLinkRow=Omit<CallQuestionRow,'call_id'>&{call_id:string|undefined};
type NativeDmlSemantic={calls:Record<string,unknown>[];links:NormalizedLinkRow[];exposure:ExposureRow[]};
type NativeDmlSample=NativeDmlValue&{arm:Arm;semantic:NativeDmlSemantic;rollback_acknowledged:boolean};
const failure=(error:unknown):PgFailure=>{
 const e=error as {code?:string;message?:string;constraint?:string};
 return{code:typeof e?.code==='string'?e.code:null,message:typeof e?.message==='string'?e.message:String(error),constraint:e?.constraint??null};
};
const protectedFunctions=['signal_listening_call_question_guard_v1','signal_listening_answer_guard_v1',
 'signal_listening_call_guard_v1','signal_listening_statement_money_v1','signal_processing_lock_actor_v1',
 'guard_signal_mass_labeling_call_root_v1','signal_study_jev_link_v1','guard_mass_labeling_scoped_money_total_v1'];
async function catalogs(db:Pick<PoolClient,'query'>){
 return{functions:(await db.query(`SELECT p.oid::text,p.proname,p.proowner::text,p.proacl,p.prosecdef,p.provolatile,
 p.proparallel,p.proisstrict,p.proleakproof,p.proconfig,p.procost,p.prorows,pg_get_functiondef(p.oid) definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND (p.proname=ANY($1::text[]) OR p.proname LIKE 'signal_listening_link_call%') ORDER BY p.oid`,[protectedFunctions])).rows,
 triggers:(await db.query(`SELECT t.oid::text,t.tgrelid::text,t.tgfoid::text,t.tgname,t.tgtype,t.tgenabled,
 t.tgconstraint::text,t.tgdeferrable,t.tginitdeferred,t.tgoldtable,t.tgnewtable,pg_get_triggerdef(t.oid) definition
 FROM pg_trigger t WHERE t.tgrelid IN('public.signal_labeling_calls'::regclass,
 'public.signal_listening_call_questions'::regclass,'public.signal_listening_answers'::regclass)
 ORDER BY t.oid`)).rows};
}
async function listening(ctx:Context):Promise<Fixture>{
 await ctx.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
 const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',
  configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
 const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
  cap_micro_usd:benchmark?16_000_000:1_000_000,idempotency_key:randomUUID(),provider_available:true});
 const store=createSignalListeningStoreV1({database:ctx.database,page_size:4096,
  storeRaw:async()=>{throw Error('no provider or individual RAW in link-statement acceptance');}});
 const run=await store.claim(admitted.run_id);assert.ok(run);
 const inputs=await store.inputs(run,{max_rows:4096,max_working_bytes:512*1024*1024});
 assert.equal(inputs.length,benchmark?1024:3);assert.ok(inputs.every(i=>i.question_keys.join(',')==='promotion,voice'));
 return{database:ctx.database,run,inputs,configuration:cfg.configuration,renew:async()=>{await store.renew(run);}};
}
function proposals(f:Fixture,inputs=f.inputs.slice(0,3)){
 return inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,f.configuration),
  request_digest=signalListeningRequestDigestV1(f.run,input,request);
  return{id:randomUUID(),custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,
   inputs:[input],reserved_micro_usd:1000};});
}
type Proposal=ReturnType<typeof proposals>[number];
async function insert(c:PoolClient,f:Fixture,rows:Proposal[],conflict:boolean|'update_noop'|'update_invalid'=false){
 const result=await c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,
 request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
 SELECT x.id,$1,$2,'typesafe','jev-1.13.0','sync',x.custom_id,x.request_digest,x.request,x.inputs,x.reserved_micro_usd,
 a.budget_date,a.budget_timezone FROM jsonb_to_recordset($3::jsonb) x(id uuid,custom_id text,request_digest text,
 request jsonb,inputs jsonb,reserved_micro_usd bigint) JOIN signal_processing_admissions a ON a.id=$4
 ${conflict==='update_noop'?'ON CONFLICT(custom_id) DO UPDATE SET updated_at=now()':conflict==='update_invalid'?"ON CONFLICT(custom_id) DO UPDATE SET request='{}'::jsonb":conflict?'ON CONFLICT(custom_id) DO NOTHING':''} RETURNING id`,
 [f.run.id,f.run.workspace_id,JSON.stringify(rows),f.run.processing_admission_id]);
 return{rows:result.rows,rowCount:result.rowCount,command:result.command};
}
async function snapshot(c:Pick<PoolClient,'query'>,run_id:string):Promise<Snapshot>{
 const calls=(await c.query<CallJsonRow>(`SELECT to_jsonb(c)-ARRAY['created_at','updated_at'] row FROM signal_labeling_calls c
 WHERE run_id=$1 ORDER BY custom_id`,[run_id])).rows;
 const links=(await c.query<CallQuestionRow>(`SELECT q.* FROM signal_listening_call_questions q WHERE run_id=$1
 ORDER BY call_id,question_key`,[run_id])).rows;
 const exposure=(await c.query<ExposureRow>('SELECT * FROM signal_processing_org_exposure_v1((SELECT organization_id FROM signal_workspaces WHERE id=(SELECT workspace_id FROM signal_labeling_runs WHERE id=$1)),(SELECT a.budget_date FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id WHERE r.id=$1),(SELECT a.budget_timezone FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id WHERE r.id=$1))',[run_id])).rows;
 return{calls,links,exposure};
}
async function arm<T>(f:Fixture,kind:Arm,sql:string,body:(c:PoolClient)=>Promise<T>,role?:'no_child_insert'|'no_child_and_owner'):Promise<ArmResult<T>>{
 await f.renew();
 const before=await catalogs(f.database),baseline=await snapshot(f.database,f.run.id);
 // The actual arm owns exactly one client and one transaction. No paid calls
 // are sent; ROLLBACK, not ledger deletion, restores the starting history.
 const c=await f.database.connect();let rollbackAck=false,primary:unknown,known=false,roleName:string|undefined;
 let result:Omit<ArmResult<T>,'rollback_acknowledged'>|undefined;
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='1s'");
  if(kind==='candidate')await c.query(sql);
  if(role){
   const name='r16_link_'+randomUUID().replaceAll('-','');roleName=name;
   await c.query(`CREATE ROLE ${quote(name)} NOLOGIN BYPASSRLS`);
   await c.query(`GRANT USAGE ON SCHEMA public,extensions TO ${quote(name)};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${quote(name)};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quote(name)};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${quote(name)};
    REVOKE INSERT ON signal_listening_call_questions FROM ${quote(name)}`);
   assert.equal((await c.query("SELECT has_table_privilege($1,'public.signal_listening_call_questions','INSERT') ok",[name])).rows[0]!.ok,false);
   if(role==='no_child_and_owner')await c.query(`REVOKE SELECT ON signal_listening_runs FROM ${quote(name)}`);
   await c.query(`SET LOCAL ROLE ${quote(name)}`);
  }
  await c.query('SAVEPOINT link_operation');
  let value:T|undefined,error:PgFailure|undefined;
  try{value=await body(c);}catch(e){error=failure(e);await c.query('ROLLBACK TO SAVEPOINT link_operation');}
  if(role)await c.query('RESET ROLE');
  result={value,error,rows:await snapshot(c,f.run.id)};
  if(error)assert.deepEqual(result.rows,baseline,'one rejected operation leaves no partial call/link/exposure');
 }catch(e){known=true;primary=e;}
 finally{
  try{await c.query('ROLLBACK');rollbackAck=true;}catch(e){primary=known?new AggregateError([primary,e],'link_arm_and_rollback_failed',{cause:primary}):e;known=true;}
  c.release(!rollbackAck);
 }
 if(known)throw primary;
 assert.ok(result);assert.ok(rollbackAck);
 assert.deepEqual(await catalogs(f.database),before,'all catalog entries, ACLs and OIDs restore after the arm rollback');
 if(roleName)assert.equal((await f.database.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[roleName])).rows[0]!.n,0,'owned temporary role is absent after acknowledged ROLLBACK');
 return{...result,rollback_acknowledged:rollbackAck};
}

test('native Listening link statement preserves guards, valid ACLs, rejected writes and bounded ABBA DML',{
 skip:!enabled,timeout:600000,
},async t=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true','remote CI only; never start Docker or PostgreSQL on the Mac');
 assert.ok(process.env.NOISIA_R16_LOCAL_PG_LAB,'requires the already owned accredited disposable CI lab');
 const candidate=await readFile(new URL('./signal-listening-link-statement.candidate.sql',import.meta.url),'utf8');
 const records:Array<Record<string,unknown>>=[];
 const fixtureStarted=performance.now();
 let owned:{name:string;oid:string}|undefined,receipt:Record<string,unknown>|undefined;
 const beforeProcessing=async(ctx:Context)=>{
  owned=(await ctx.database.query(`SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid`)).rows[0];
  assert.ok(owned);assert.match(owned.name,/^noisia_mfp_recovery_[a-f0-9]{32}$/);
  const runtime=(await ctx.database.query("SELECT current_setting('server_version_num')::int version,current_setting('auto_explain.log_min_duration',true) auto_explain")).rows[0]!;
  assert.ok(runtime.version>=170000&&runtime.version<180000,'the comparative lab is PostgreSQL17');
  assert.equal(runtime.auto_explain,null,'normal DML experiment must not load auto_explain');
  const massStore=createMassLabelingStoreV1({database:ctx.database,storeRaw:async()=>{throw Error('no provider in the non-Listening ACL control');}});
  const massRun=await massStore.claim(ctx.run_id);assert.ok(massRun);
  const massInputs=await massStore.inputs(massRun,{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(massInputs.length,1);
  const input=massInputs[0]!,request=buildMassLabelingJevRequestV2(input,massRun.context,massLabelingConfigurationV2(massRun.identity.params),massRun.identity.model);
  const digest=signalWorkspaceEmbeddingDigestV1({request_version:massRun.identity.params.request_version,run_id:massRun.id,root_id:input.root_id,
   input_digest:input.input_digest,map_digest:input.map_digest,entity_context_digest:massRun.entity_context_digest,labeler_digest:massRun.labeler_digest,request});
  const massProposal={id:randomUUID(),custom_id:'mass_'+digest.slice(7,67),request_digest:digest,request,inputs:[input],reserved_micro_usd:1000}as unknown as Proposal;
  const massFixture:Fixture={database:ctx.database,run:massRun,inputs:[],configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']}),renew:async()=>{await massStore.renew(massRun);}};
  let nonListeningPassed=false;
  await t.test('valid non-Listening call does not require child INSERT privilege',async()=>{
   const outputs=[];for(const kind of ['baseline','candidate']as const)outputs.push(await arm(massFixture,kind,candidate,c=>insert(c,massFixture,[massProposal]),'no_child_insert'));
   assert.deepEqual(outputs[1],outputs[0]);assert.equal(outputs[0]!.error,undefined);assert.equal(outputs[0]!.rows.calls.length,1);assert.equal(outputs[0]!.rows.links.length,0);
   records.push({name:'valid non-Listening call does not require child INSERT privilege',parity:true,code:null,rollback_acknowledged:true});nonListeningPassed=true;
  });assert.ok(nonListeningPassed);
  const f=await listening(ctx),baseCatalog=await catalogs(f.database);
  const cases:Array<{name:string;role?:'no_child_insert'|'no_child_and_owner';ok?:boolean;code?:string;run:(c:PoolClient,rows:Proposal[])=>Promise<unknown>}>= [
   {name:'multi-call multi-question exact link set',ok:true,run:async(c,rows)=>{await insert(c,f,rows);const links=(await snapshot(c,f.run.id)).links;
    assert.equal(links.length,6);for(const p of rows)assert.deepEqual(links.filter(q=>q.call_id===p.id).map(q=>[q.root_id,q.question_key,q.question_digest]).sort(),
     Object.entries(p.inputs[0]!.question_digests).map(([key,d])=>[p.inputs[0]!.root_id,key,d]).sort());}},
   {name:'parent DO NOTHING conflict does not relink skipped rows',ok:true,run:async(c,rows)=>{await insert(c,f,rows);assert.equal((await insert(c,f,rows,true)).rows.length,0);assert.equal((await snapshot(c,f.run.id)).links.length,6);}},
   {name:'parent DO UPDATE no-op does not relink existing questions',ok:true,run:async(c,rows)=>{await insert(c,f,rows);assert.equal((await insert(c,f,rows,'update_noop')).rows.length,3);assert.equal((await snapshot(c,f.run.id)).links.length,6);}},
   {name:'parent DO UPDATE still rejects immutable request changes',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);return insert(c,f,rows,'update_invalid');}},
   {name:'empty transition does not require child INSERT privilege',role:'no_child_insert',ok:true,run:(c)=>insert(c,f,[],true)},
   {name:'single missing child INSERT privilege still rejects',role:'no_child_insert',code:'42501',run:(c,rows)=>insert(c,f,rows)},
   {name:'single missing owner SELECT privilege still rejects',role:'no_child_and_owner',code:'42501',run:(c,rows)=>insert(c,f,rows)},
   {name:'one bad root cast rolls back every valid sibling',code:'22P02',run:(c,rows)=>{(rows[1]!.inputs[0] as unknown as Record<string,unknown>).root_id='not-a-uuid';return insert(c,f,rows);}},
   {name:'one non-object question dictionary rolls back every sibling',code:'22023',run:(c,rows)=>{(rows[1]!.inputs[0] as unknown as Record<string,unknown>).question_digests=[];return insert(c,f,rows);}},
   {name:'direct child forged root remains guarded',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);await c.query(`INSERT INTO signal_listening_call_questions SELECT workspace_id,run_id,call_id,$2::uuid,'forged',question_digest FROM signal_listening_call_questions WHERE call_id=$1 LIMIT 1`,[rows[0]!.id,randomUUID()]);}},
   {name:'direct child missing call binding remains guarded',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);await c.query(`INSERT INTO signal_listening_call_questions SELECT workspace_id,run_id,$2::uuid,root_id,'forged',question_digest FROM signal_listening_call_questions WHERE call_id=$1 LIMIT 1`,[rows[0]!.id,randomUUID()]);}},
   {name:'direct child after submitting remains guarded',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);await c.query("UPDATE signal_labeling_calls SET status='submitting' WHERE id=ANY($1::uuid[])",[rows.map(p=>p.id)]);await c.query('INSERT INTO signal_listening_call_questions SELECT * FROM signal_listening_call_questions WHERE call_id=$1',[rows[0]!.id]);}},
   {name:'direct duplicate child retains conflict and rollback',code:'23505',run:async(c,rows)=>{await insert(c,f,rows);await c.query('INSERT INTO signal_listening_call_questions SELECT * FROM signal_listening_call_questions WHERE call_id=$1',[rows[0]!.id]);}},
   {name:'child UPDATE remains immutable',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);await c.query("UPDATE signal_listening_call_questions SET question_key='changed' WHERE call_id=$1",[rows[0]!.id]);}},
   {name:'child DELETE remains immutable',code:'P0001',run:async(c,rows)=>{await insert(c,f,rows);await c.query('DELETE FROM signal_listening_call_questions WHERE call_id=$1',[rows[0]!.id]);}},
  ];
  for(const spec of cases){
   let completed=false;
   await t.test(spec.name,async()=>{
    const rows=proposals(f),outputs=[];
    for(const kind of ['baseline','candidate']as const){const copy=structuredClone(rows);
     outputs.push(await arm(f,kind,candidate,c=>spec.run(c,copy),spec.role));}
    const [a,b]=outputs;assert.ok(a&&b);assert.deepEqual(b,a,'valid output or single-failure SQLSTATE/message and complete rollback match');
    if(spec.ok)assert.equal(a.error,undefined);else assert.equal(a.error?.code,spec.code);
    records.push({name:spec.name,parity:true,code:a.error?.code??null,rollback_acknowledged:a.rollback_acknowledged&&b.rollback_acknowledged});completed=true;
   });assert.ok(completed,'functional failure stops later DML measurements');
  }
  // Independent invalidations may race for the first error, but neither arm
  // may accept a row or leave a call/link/exposure. This is a NEW probe only;
  // all original cached/prepared 42501 assertions remain unchanged.
  const multiRows=structuredClone(proposals(f));(multiRows[0]!.inputs[0] as unknown as Record<string,unknown>).root_id='not-a-uuid';
  (multiRows[1]!.inputs[0] as unknown as Record<string,unknown>).question_digests=[];
  const multi=[];for(const kind of ['baseline','candidate']as const)multi.push(await arm(f,kind,candidate,c=>insert(c,f,structuredClone(multiRows))));
  assert.ok(multi.every(v=>v.error&&['22P02','22023'].includes(v.error.code??'')&&v.rows.calls.length===0&&v.rows.links.length===0&&v.rollback_acknowledged));
  records.push({name:'two independent invalidations both reject and roll back',parity:true,actual_errors:multi.map(v=>v.error),first_error_equality_not_claimed:true});
  const measurements:Array<Record<string,unknown>>=[];
  if(benchmark){
   const walStart=(await f.database.query('SELECT pg_current_wal_insert_lsn()::text value')).rows[0]!.value;
   const walBytes=async()=>Number((await f.database.query('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),$1::pg_lsn)::text n',[walStart])).rows[0]!.n);
   for(const size of [720,1024]){
    const rows=proposals(f,f.inputs.slice(0,size));assert.equal(rows.length,size);
    const plan=planNativeListeningAdmissionPacketV1(f.run,rows,1024);assert.ok(plan);
    const packet=nativeListeningAdmissionPacketBodyV1(plan,rows),samples:NativeDmlSample[]=[];
    for(const kind of ['baseline','candidate','candidate','baseline']as const){
     assert.ok(await walBytes()<48*1024*1024,'stop before another DML arm if the local64MiB WAL allowance lacks16MiB headroom');
     const output:ArmResult<NativeDmlValue>=await arm<NativeDmlValue>(f,kind,candidate,async(c:PoolClient):Promise<NativeDmlValue>=>{
      const a=(await c.query<{budget_date:string;budget_timezone:string}>('SELECT budget_date::text,budget_timezone FROM signal_processing_admissions WHERE id=$1',[f.run.processing_admission_id])).rows[0];assert.ok(a);
      const begin=performance.now();
      const inserted=await c.query<Record<string,unknown>>(NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1,[f.run.id,f.run.workspace_id,'typesafe','jev-1.13.0','sync',packet,a.budget_date,a.budget_timezone]);
      const reserved:LabelingCallV1<SignalListeningInputV1>[]=reconstructNativeListeningAdmissionRowsV1(f.run,plan,rows,inserted.rows,'reserved');
      const marked=await c.query<Record<string,unknown>>(NATIVE_LISTENING_ADMISSION_MARK_SQL_V1,[f.run.id,f.run.workspace_id,reserved.map(v=>v.id),packet]);
      const calls:LabelingCallV1<SignalListeningInputV1>[]=reconstructNativeListeningAdmissionRowsV1(f.run,plan,rows,marked.rows,'submitting');
      const elapsed_ms=performance.now()-begin;
      assert.equal(calls.length,size);assert.ok(calls.every(v=>v.status==='submitting'));
      const links=(await c.query<{n:number}>('SELECT count(*)::int n FROM signal_listening_call_questions WHERE run_id=$1',[f.run.id])).rows[0]!.n;
      assert.equal(links,size*2);return{elapsed_ms,count:calls.length,links};
     });assert.equal(output.error,undefined);assert.ok(output.value);
     // Generated IDs differ by design. Compare every remaining immutable field
     // and bind each link back to its exact request identity before comparing.
     const idToCustom=new Map<string,string>(output.rows.calls.map((v:CallJsonRow):[string,string]=>[v.row.id,v.row.custom_id]));
     const semantic:NativeDmlSemantic={calls:output.rows.calls.map((v:CallJsonRow):Record<string,unknown>=>{const{id,...rest}=v.row;return rest;}),
      links:output.rows.links.map((v:CallQuestionRow):NormalizedLinkRow=>({...v,call_id:idToCustom.get(v.call_id)})).sort((a:NormalizedLinkRow,b:NormalizedLinkRow)=>String(a.call_id).localeCompare(String(b.call_id))||a.question_key.localeCompare(b.question_key)),exposure:output.rows.exposure};
     samples.push({arm:kind,...output.value,semantic,rollback_acknowledged:output.rollback_acknowledged});
     assert.ok(await walBytes()<=64*1024*1024,'local WAL budget is not silently expanded');
    }
    for(const s of samples)assert.deepEqual(s.semantic,samples[0]!.semantic,'all DML results, linked questions and exposure match across ABBA');
    const means=Object.fromEntries((['baseline','candidate']as const).map(k=>[k,samples.filter(v=>v.arm===k).reduce((n,v)=>n+v.elapsed_ms,0)/2]));
    const ratio=means.candidate!/means.baseline!;
    measurements.push({size,order:samples.map(v=>v.arm),samples:samples.map(({semantic,...s})=>s),semantic_sha256:hash(JSON.stringify(samples[0]!.semantic)),means,ratio,materially_faster:ratio<=.9});
   }
  }
  assert.deepEqual(await catalogs(f.database),baseCatalog,'all experimental DDL/roles return to their original catalog state');
  receipt={contract:'r16-native-link-statement-abba-v1',candidate_sql_sha256:hash(candidate),
   postgres_version:runtime.version,auto_explain_loaded:false,fixture_root_count:benchmark?1024:3,fixture_elapsed_ms:performance.now()-fixtureStarted,
   native_insert_sql_sha256:hash(NATIVE_LISTENING_ADMISSION_INSERT_SQL_V1),native_mark_sql_sha256:hash(NATIVE_LISTENING_ADMISSION_MARK_SQL_V1),
   parity_cases:records,measurements,protected_catalog_unchanged:true,provider_spend0:true,
   benchmark_scope:'canonical Native INSERT+MARK DML with real guards, driver wall and ROLLBACK/savepoints; no COMMIT, complete caller or H1 claim',
   materially_faster:benchmark?measurements.length===2&&measurements.every(v=>v.materially_faster===true):null};
 };
 if(benchmark)await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{isolated:true,root_count:1024,
  execution_cap_micro_usd:16_000_000,beforeProcessing,embedding_page_limit:Math.ceil(1024/128)+1}});
 else await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing});
 assert.ok(owned&&receipt);
 const {openR16CiPostgresV1}=await import('./signal-r16-local-pg.fixture');
 const admin=await openR16CiPostgresV1();
 try{
  assert.equal((await admin.query('SELECT count(*)::int n FROM pg_database WHERE oid=$1::oid OR datname=$2',[owned.oid,owned.name])).rows[0]!.n,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[owned.name])).rows[0]!.n,0);
 }finally{await admin.end();}
 receipt.fixture_drop_acknowledged=true;receipt.fixture_no_sessions_or_database=true;
 console.log('r16-native-link-statement-v1 '+JSON.stringify(receipt));
 if(benchmark)assert.equal(receipt.materially_faster,true,'both preregistered720/1024 DML mean ratios must be<=.9; otherwise do not promote');
});
