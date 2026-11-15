import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertListeningSmallGuardV1,captureCalibrationObservationV1,runListeningSmallDiagnosticV1} from './run.mjs';

test('diagnostic CLI has no database side effect without explicit run flag',async()=>{
  assert.doesNotThrow(()=>assertListeningSmallGuardV1({},[]));
  assert.deepEqual(await runListeningSmallDiagnosticV1(),{
    diagnostic_only:true,h1_accepted:false,status:'no_database_action',
  });
});

test('diagnostic run requires real GitHub Actions and explicit opt-in',()=>{
  assert.throws(()=>assertListeningSmallGuardV1({},['--run']),/diagnostic_requires_github_actions/u);
  assert.throws(()=>assertListeningSmallGuardV1({GITHUB_ACTIONS:'true'},['--run']),/diagnostic_opt_in_required/u);
});

test('diagnostic run rejects provider credentials before any target access',()=>{
  const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',TYPESAFE_API_KEY:'unexpected'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
  delete env.TYPESAFE_API_KEY;
  env.NOISIA_R16_SONNET_API_KEY='unexpected';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/provider_credentials_forbidden/u);
});

test('diagnostic run binds target and artifact to this workflow workspace',()=>{
  const env={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',GITHUB_WORKSPACE:'/tmp/work',
    R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
    R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'b'.repeat(40),
    R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/evil/result.json',
    DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',
    R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/artifact_path_not_bound/u);
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/target';
  env.R16_DIAGNOSTIC_ARTIFACT='/tmp/work/artifacts/r16-listening-small/result.json';
  assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/target_root_outside_workspace/u);
});

test('calibration observations preserve native phase shapes from the query-engine contract',async()=>{
  const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;
  assert.ok(target,'pure test needs the checked out public target root');
  const [contracts,calibration]=await Promise.all([
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-contracts.ts')).href),
    import(pathToFileURL(join(target,'packages/query-engine/src/signal-listening-calibration.ts')).href),
  ]) as any;
  const configuration=contracts.signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  configuration.questions.push({key:'consumer_test_v1',type:'noul',text:'Synthetic consumer classification',
    scope:'consumer_category',origin:'brand_os',human_locked:true,topic_source:'defined',
    positive:'Synthetic consumer topic applies',negative:'Synthetic consumer topic does not apply'});
  const baseKeys=configuration.questions.filter((question:any)=>question.origin==='base').map((question:any)=>question.key);
  const consumerKeys=configuration.questions.filter((question:any)=>question.scope==='consumer_category').map((question:any)=>question.key);
  const base=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:baseKeys});
  const consumer=calibration.signalListeningCalibrationShapeV1(configuration,{question_keys:consumerKeys});
  assert.equal(base.phase,'base');
  assert.equal(consumer.phase,'consumer_category');
  const shapeDigests=[base.shape_digest,consumer.shape_digest];
  const captured=captureCalibrationObservationV1({warmup:true,selected_roots:32,max_in_flight:32,shape_digests:shapeDigests});
  shapeDigests.pop();
  assert.deepEqual(captured.shape_digests,[base.shape_digest,consumer.shape_digest]);
});

test('neutral observer retains hashes and operation timing without SQL, binds or returned rows',async()=>{
 const {createListeningObserver,queryHash}=await import('./observer.mjs');const observer=createListeningObserver();
 try{const db=observer.wrapDatabase({async query(){return{rows:[{secret:'never record'}]};}});
 const store=observer.wrapStore({async inputs(){return db.query('SELECT private_value FROM synthetic WHERE credential=$1',['secret-bind']);}});
 await store.inputs();const snapshot=observer.snapshot(),serialized=JSON.stringify(snapshot);
 assert.ok(serialized.includes(queryHash('SELECT private_value FROM synthetic WHERE credential=$1')!));
 for(const forbidden of ['private_value','credential','secret-bind','never record'])assert.ok(!serialized.includes(forbidden));
 const events=snapshot.events as any[];assert.equal(events.filter(x=>x.kind==='query').length,1);assert.equal(events.find(x=>x.kind==='query').operation,'inputs');
 assert.equal(events.find(x=>x.kind==='query').pid,null);assert.ok(events.every(x=>x.end_ms>=x.start_ms));
 }finally{await observer.close();}
});

test('neutral events are bounded and wait rows expose only allowed metadata',async()=>{
 const {boundedEvents,safeWaitRow,queryHash}=await import('./observer.mjs');const bounded=boundedEvents(2);
 bounded.push(1);bounded.push(2);bounded.push(3);assert.deepEqual(bounded.snapshot(),{events:[1,2],dropped:1,limit:2});
 assert.deepEqual(safeWaitRow({pid:12,wait_event_type:'Lock',wait_event:'tuple',blocking_pids:[13,'SQL',-1],query:'secret'}),{pid:12,wait_event_type:'Lock',wait_event:'tuple',blocking_pids:[13]});
 assert.equal(safeWaitRow({pid:12,wait_event_type:'SELECT secret',wait_event:null}).wait_event_type,'redacted');
 assert.throws(()=>safeWaitRow({pid:'secret'}),/invalid_pid/u);assert.equal(queryHash({text:'SELECT  1'}),queryHash(' SELECT 1 '));
});

test('sampler refuses non-CI before starting any child and observer cleanup stops sampling',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver();
 try{await assert.rejects(observer.startSampler({target:'/missing',url:'postgresql://localhost/x',database:'noisia_mfp_ci'}),/ci_only|target_invalid/u);}finally{await observer.close();}
 const before=observer.snapshot().events.length;await new Promise(resolve=>setTimeout(resolve,280));assert.equal(observer.snapshot().events.length,before);
});

test('child cleanup sends stop only to its owned child and waits for exit',async()=>{
 const {EventEmitter}=await import('node:events');const {closeOwnedChild}=await import('./observer.mjs');
 const child=new EventEmitter() as any;Object.assign(child,{exitCode:null,signalCode:null,connected:true});let message:unknown;
 child.send=(m:unknown)=>{message=m;queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0);});};child.kill=()=>assert.fail('graceful child must not be killed');
 await closeOwnedChild(child);assert.deepEqual(message,{kind:'stop'});await closeOwnedChild(child);
});

test('final observer snapshot includes late cleanup events with consistent counters and an immutable cutoff',async()=>{
 const {boundedEvents,finishListeningObserver}=await import('./observer.mjs');const events=boundedEvents(1);
 const early=events.snapshot();let closed=false;
 const final=await finishListeningObserver({async close(){await Promise.resolve();events.push({kind:'late_child_sample'});events.push({kind:'overflow'});closed=true;},snapshot(){assert.equal(closed,true);return events.snapshot();}});
 assert.deepEqual(early,{events:[],dropped:0,limit:1});
 assert.deepEqual(final,{events:[{kind:'late_child_sample'}],dropped:1,limit:1});
 events.push({kind:'after_cutoff'});assert.equal(final.dropped,1);assert.equal(final.events.length,1);
});

test('inner-plan guard is limited to the owned CI loopback database and role',async()=>{
 const {assertInnerPlanCaptureGuard,innerPlanQueryLabel,verifiedInnerPlanScopeV1}=await import('./observer.mjs');
 const env:NodeJS.ProcessEnv={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'};
 assert.doesNotThrow(()=>assertInnerPlanCaptureGuard(env,'noisia_mfp_ci','postgres'));
 assert.throws(()=>assertInnerPlanCaptureGuard({...env,GITHUB_ACTIONS:'false'},'noisia_mfp_ci','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard({...env,DATABASE_URL:'postgresql://postgres@db.example.test/noisia_mfp_ci'},'noisia_mfp_ci','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard(env,'private_database','postgres'),/capture_denied/u);
 assert.throws(()=>assertInnerPlanCaptureGuard(env,'noisia_mfp_ci','other_role'),/capture_denied/u);
 assert.equal(innerPlanQueryLabel('sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680'),'metadata');
 assert.equal(innerPlanQueryLabel('sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04'),'hydrate');
 assert.equal(innerPlanQueryLabel('sha256:unknown'),null);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true},'noisia_mfp_ci','postgres'),true);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'read committed',read_only:'off',superuser:true},'noisia_mfp_ci','postgres'),false);
});

test('capture scope matches the real bounded-labeling transaction path and not the unbounded path',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'scope contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const beginMatch=labeling.match(/await c\.query\(["']BEGIN["']\)/u);
 const readOnlyMatch=labeling.match(/await c\.query\(["']SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY["']\)/u);
 assert.ok(beginMatch,'transaction helper must begin with its native BEGIN statement');
 assert.ok(readOnlyMatch,'bounded path must set its native RR/RO transaction before adapter work');
 const boundedPath=/if\(bounds\)[\s\S]{0,450}return tx\(db,async c=>\{await c\.query\(["']SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY["']\);\s*return options\.adapter!\.bounded_inputs!\(c,run,read\);\}\)/u;
 assert.match(labeling,boundedPath);
 assert.match(listening,/bounded_inputs:\(c,run,bounds\)=>inputs\(c,run,limit,bounds\)/u);
 assert.match(listening,/const metadata=bounds\?await inputMetadata\(c,run,bounds\.max_rows\):null/u);
 assert.match(listening,/const rows=\(await c\.query[\s\S]{0,700}FROM \$\{hydratePopulation\}/u);
 const begin='BEGIN',setReadOnly='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
 const statements:string[]=[];let isolation='read committed',readOnly='off',inTransaction=false;
 const client={async query(sql:string){statements.push(sql);if(sql===begin){inTransaction=true;isolation='read committed';readOnly='off';}
  else if(sql===setReadOnly&&inTransaction){isolation='repeatable read';readOnly='on';}
  else throw Error('unexpected_transaction_command');return{rows:[]};}};
 await client.query(begin);await client.query(setReadOnly);
 const {verifiedInnerPlanScopeV1}=await import('./observer.mjs');
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation,read_only:readOnly,superuser:true},'noisia_mfp_ci','postgres'),true);
 assert.deepEqual(statements,[begin,setReadOnly]);
 isolation='read committed';readOnly='off';
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation,read_only:readOnly,superuser:true},'noisia_mfp_ci','postgres'),false);
});

test('auto_explain notice parser keeps only safe plan node fields',async()=>{
 const {safeAutoExplainNotice}=await import('./observer.mjs');
 const plan=safeAutoExplainNotice({message:'duration: 1.2 ms  plan:\n'+JSON.stringify({'Query Text':"SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x",'Planning Time':.1,'Execution Time':1.2,Plan:{'Node Type':'Index Scan','Relation Name':'mentions','Alias':'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,'Index Cond':"(root_id = 'private-uuid')",Output:['private_value'],Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Subplan Name':'private_cte','Filter':"credential = 'private'",'Actual Rows':1}]}})});
 const serialized=JSON.stringify(plan);
 assert.deepEqual(plan,{query_text_sha256:`sha256:${createHash('sha256').update("SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x").digest('hex')}`,
  planning_time_ms:.1,execution_time_ms:1.2,plan:{'Node Type':'Index Scan','Relation Name':'mentions',Alias:'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Actual Rows':1}]}});
 for(const forbidden of ['private-uuid','private_value','credential','Filter','Output','Index Cond','Query Text','jsonb_agg'])assert.ok(!serialized.includes(forbidden));
 assert.equal(safeAutoExplainNotice({message:'ERROR: private SQL and params'}),null);
 assert.equal(safeAutoExplainNotice({message:'x'.repeat(1_000_001)}),null);
});

test('inner-plan setup failure rolls back its savepoint then runs the original query once without retaining the error',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any;let originalCalls=0;const statements:string[]=[];
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SAVEPOINT')||sql.startsWith('ROLLBACK TO')||sql.startsWith('RELEASE'))return{rows:[]};
   if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};
   if(sql.startsWith('LOAD'))throw Error('extension unavailable with private text');return{rows:[]};};
  const captured=await captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;return{rows:[{ok:true}]}},
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.deepEqual(captured.result,{rows:[{ok:true}]});assert.equal(originalCalls,1);assert.equal(client.listenerCount('notice'),0);
  assert.ok(captured.observation?.status==='inner_plan_unavailable');assert.equal(captured.observation.reason,'auto_explain_load_unavailable');
  for(const statement of ['SAVEPOINT r16_inner_plan_capture_v1','ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1','RELEASE SAVEPOINT r16_inner_plan_capture_v1'])assert.ok(statements.includes(statement));
  assert.ok(statements.includes("SET LOCAL log_min_messages = 'WARNING'"));assert.ok(statements.includes("SET LOCAL client_min_messages = 'NOTICE'"));
  assert.ok(statements.includes('LOAD \'auto_explain\''));
  const serialized=JSON.stringify(captured);assert.ok(!serialized.includes('private setup details'));assert.ok(!serialized.includes('extension unavailable'));
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan capture retains bounded ordered plans with query-text hashes and removes its handler',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1,INNER_PLAN_MIN_DURATION_MS}=await import('./observer.mjs');
 assert.equal(INNER_PLAN_MIN_DURATION_MS,50);
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any,statements:string[]=[];let originalCalls=0;
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};return{rows:[]};};
  const captured=await captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;for(let i=0;i<35;i++)client.emit('notice',{message:'duration: 4 ms plan: '+JSON.stringify({'Query Text':`SELECT synthetic_nested_${i}('{}'::jsonb)`,Plan:{'Node Type':'Index Scan','Relation Name':'mentions','Actual Rows':64+i,'Actual Loops':3}})});return{rows:[{ok:true}]}},
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.equal(originalCalls,1);assert.ok(captured.observation?.status==='captured');
  assert.equal(captured.observation.plans.length,32);assert.equal(captured.observation.plans_dropped,3);assert.equal(captured.observation.plan_notices_seen,35);
  assert.deepEqual(captured.observation.plans.map(plan=>plan.sequence),Array.from({length:32},(_,i)=>i+1));
  assert.equal(captured.observation.plans[0]?.plan['Actual Rows'],64);assert.match(captured.observation.plans[0]?.query_text_sha256??'/',/^sha256:[0-9a-f]{64}$/u);
  assert.ok(captured.observation.setup_ms>=0&&captured.observation.cleanup_ms>=0&&captured.observation.setup_cleanup_wall_ms>=0);
  assert.equal(captured.observation.analyze_overhead_measured,false);
  const serialized=JSON.stringify(captured);assert.ok(!serialized.includes('SELECT synthetic_nested_'));assert.ok(!serialized.includes("'{}'::jsonb"));
  assert.ok(statements.some(sql=>sql.startsWith("SET LOCAL auto_explain.log_level")));
  assert.ok(statements.includes('SET LOCAL auto_explain.log_min_duration = 50'));
  assert.ok(statements.includes('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1'));assert.equal(client.listenerCount('notice'),0);
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan query failure clears the listener and rolls back without swallowing the query failure',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any,statements:string[]=[];
  client.query=async(sql:string)=>{statements.push(sql);if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};return{rows:[]};};
  await assert.rejects(captureInnerPlanQueryV1({client,query:async()=>{throw Error('original query failure')},
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/original query failure/u);
  assert.equal(client.listenerCount('notice'),0);assert.ok(statements.includes('ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1'));
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan rollback failure propagates, never replays the query, and still removes the notice handler',async()=>{
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
 const prior={GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,NOISIA_R16_SMALL_DIAGNOSTIC:process.env.NOISIA_R16_SMALL_DIAGNOSTIC,DATABASE_URL:process.env.DATABASE_URL};
 Object.assign(process.env,{GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'});
 try{
  const client=new EventEmitter() as any;let originalCalls=0,rollbackCalls=0;
  client.query=async(sql:string)=>{if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true}]};
   if(sql.startsWith('ROLLBACK TO')){rollbackCalls++;throw Error('rollback cleanup failed');}return{rows:[]};};
  await assert.rejects(captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;return{rows:[]}},
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/rollback cleanup failed/u);
  assert.equal(originalCalls,1);assert.ok(rollbackCalls>=1);assert.equal(client.listenerCount('notice'),0);
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

const DML_PLAN_TEST_ENV={GITHUB_ACTIONS:'true',NOISIA_R16_SMALL_DIAGNOSTIC:'true',NOISIA_R16_LISTENING_DML_PLAN_PG:'true',
 NOISIA_R16_LOCAL_PG_LAB:'r16-benchmark-pg17',DATABASE_URL:'postgresql://postgres:synthetic@127.0.0.1:54321/noisia_mfp_ci'};
async function withDmlPlanTestEnv<T>(action:()=>Promise<T>){
 const keys=Object.keys(DML_PLAN_TEST_ENV) as Array<keyof typeof DML_PLAN_TEST_ENV>,prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,DML_PLAN_TEST_ENV);
 try{return await action();}finally{for(const key of keys){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function fakeDmlPlanClient(options:{readOnly?:string;failLoad?:boolean;failRestore?:boolean}={}){
 const client=new EventEmitter() as any,statements:string[]=[],events:string[]=[],restores:Array<{name:string;value:string;local:boolean}>=[];
 const oldValues:Record<string,string>={log_min_messages:'warning',client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0',
  'auto_explain.log_parameter_max_length':'0','auto_explain.log_level':'notice','auto_explain.log_min_duration':'-1',
  'auto_explain.log_nested_statements':'off','auto_explain.log_analyze':'off','auto_explain.log_buffers':'off',
  'auto_explain.log_timing':'on','auto_explain.log_format':'text','auto_explain.log_verbose':'off','auto_explain.log_triggers':'off'};
 client.query=async(sql:string,values?:unknown[])=>{
  statements.push(sql);
  if(sql.startsWith('SAVEPOINT')){events.push('savepoint');return{rows:[]};}
  if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',read_only:options.readOnly??'off',superuser:true}]};
  if(sql.startsWith("LOAD 'auto_explain'")){events.push('load');if(options.failLoad)throw Error('private extension failure');return{rows:[]};}
  if(sql.startsWith('SELECT name,current_setting'))return{rows:(values?.[0] as string[]).map(name=>({name,value:oldValues[name]}))};
  if(sql.startsWith('RELEASE SAVEPOINT')){events.push('release');return{rows:[]};}
  if(sql.startsWith('ROLLBACK TO SAVEPOINT')){events.push('rollback');return{rows:[]};}
  if(sql.startsWith('SELECT set_config')){events.push('restore');restores.push({name:String(values?.[0]),value:String(values?.[1]),local:sql.includes('true')});if(options.failRestore)throw Error('private restore failure');return{rows:[]};}
  return{rows:[]};
 };
 return{client,statements,events,restores,oldValues};
}

test('DML plan specs match the complete source SQL, bind arity and batch-value positions',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'DML SQL contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const mark=labeling.match(/`(UPDATE signal_labeling_calls SET status='submitting',[\s\S]*?RETURNING id)`\s*,\s*\[run\.id,\s*calls\.map/u);
 const answers=listening.match(/`(INSERT INTO signal_listening_answers\([\s\S]*?DO NOTHING)`\s*,\s*\[run\.workspace_id,\s*run\.entity_context_digest,\s*run\.id,\s*JSON\.stringify\(rows\)\]/u);
 assert.ok(mark,'markSubmitting SQL and run.id/calls batch position must match');assert.ok(answers,'answers INSERT SQL and $4 row batch position must match');
 const {queryHash,dmlPlanQuerySpec,dmlPlanBatchSize}=await import('./observer.mjs');
 const markHash=queryHash(mark[1]),answersHash=queryHash(answers[1]);
 assert.equal(markHash,'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b');
 assert.equal(answersHash,'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7');
 assert.deepEqual(dmlPlanQuerySpec(markHash),{label:'mark_submitting',values_count:2,batch_value_index:1,batch_kind:'array'});
 assert.deepEqual(dmlPlanQuerySpec(answersHash),{label:'listening_answers_insert',values_count:4,batch_value_index:3,batch_kind:'json_array'});
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(256).fill('synthetic-id')]]),256);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(255).fill('synthetic-id')]]),255);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run']]),null);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run',JSON.stringify(Array(256).fill({synthetic:true}))]]),256);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run','not-json']]),null);
});

test('DML capture guard requires the explicit owned CI loopback lab opt-in',async()=>{
 const {dmlPlanCaptureEnvironmentAllowed}=await import('./observer.mjs');
 assert.equal(dmlPlanCaptureEnvironmentAllowed(DML_PLAN_TEST_ENV),true);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,NOISIA_R16_LISTENING_DML_PLAN_PG:'false'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,GITHUB_ACTIONS:'false'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,NOISIA_R16_LOCAL_PG_LAB:'other'}),false);
 assert.equal(dmlPlanCaptureEnvironmentAllowed({...DML_PLAN_TEST_ENV,DATABASE_URL:'postgresql://postgres@db.example.test/noisia_mfp_ci'}),false);
});

test('DML plan notice exposes allowlisted trigger metrics and omits query text, binds and unknown trigger names',async()=>{
 const {safeDmlAutoExplainNotice}=await import('./observer.mjs');
 const queryText="INSERT INTO signal_listening_answers VALUES ('private-id', '{}'::jsonb)";
 const note=safeDmlAutoExplainNotice({message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':queryText,'Execution Time':62,
  Plan:{'Node Type':'ModifyTable','Relation Name':'signal_listening_answers','Actual Rows':256,'Actual Loops':1},
  Triggers:[{'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Time:48.2,Calls:256},
   {'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Calls:0},
   {'Trigger Name':'private_dynamic_trigger',Relation:'private_table',Time:9,Calls:1}]})});
 assert.deepEqual(note?.triggers,[{name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:48.2,calls:256},
  {name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:null,calls:0}]);
 assert.equal(note?.triggers_seen,3);assert.equal(note?.triggers_omitted,1);assert.equal(note?.triggers_unknown_time,1);
 assert.match(note?.query_text_sha256??'/',/^sha256:[0-9a-f]{64}$/u);
 const serialized=JSON.stringify(note);
 for(const forbidden of ['private-id','private_dynamic_trigger','private_table','Query Text','INSERT INTO','{}'])assert.ok(!serialized.includes(forbidden));
});

test('DML savepoint releases before the original write, captures once and keeps one ledger write in outer transaction',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,DML_PLAN_MAX_PLANS}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();let writes=0;
 const query=async()=>{writes++;events.push('write');for(let i=0;i<10;i++)client.emit('notice',{message:'duration: 61 ms plan: '+JSON.stringify({'Query Text':`UPDATE synthetic_table SET value='private_${i}'`,
  'Execution Time':61+i,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1},
  Triggers:[{'Trigger Name':'mass_labeling_scoped_update_total',Relation:'signal_labeling_calls',Time:50+i,Calls:256},
   {'Trigger Name':'unknown_private_trigger',Relation:'hidden',Time:9,Calls:1}]})});return{rows:[],rowCount:256};};
 const captured=await captureDmlPlanQueryV1({client,query,query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.equal(captured.result.rowCount,256);assert.ok(captured.observation?.status==='captured');
 assert.equal(captured.observation.plans.length,DML_PLAN_MAX_PLANS);assert.equal(captured.observation.plans_dropped,2);
 assert.equal(captured.observation.triggers_omitted_count,10);assert.equal(captured.observation.plans[0]?.triggers[0]?.calls,256);
 assert.equal(captured.observation.analyze_timing_overhead_measured,false);assert.equal(client.listenerCount('notice'),0);
 assert.ok(events.indexOf('release')<events.indexOf('write'));assert.equal(events.filter(x=>x==='rollback').length,0);
 assert.ok(events.lastIndexOf('restore')>events.indexOf('write'));
 assert.equal(restores.length,15);assert.ok(restores.every(row=>row.local));
 assert.deepEqual(restores[0],{name:'auto_explain.log_min_duration',value:'-1',local:true});
 assert.deepEqual(restores.at(-1),{name:'auto_explain.log_min_duration',value:oldValues['auto_explain.log_min_duration'],local:true});
 for(const {name,value} of restores.slice(1,-1))assert.equal(value,oldValues[name]);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_triggers = on'),true);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_timing = on'),true);
 assert.equal(captured.observation.analyze_timing_enabled,true);assert.equal(captured.observation.analyze_timing_overhead_measured,false);
 assert.equal(statements.some(sql=>sql.startsWith('ROLLBACK TO SAVEPOINT')),false);
 const serialized=JSON.stringify(captured);for(const forbidden of ['private_0','unknown_private_trigger','hidden','UPDATE synthetic_table'])assert.ok(!serialized.includes(forbidden));
}));

test('DML setup fallback rolls back before exactly one write and leaves it in the outer transaction ledger',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failLoad:true});let writes=0;
 let clockTick=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{assert.equal(client.listenerCount('notice'),0);writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,clock:()=>++clockTick});
 assert.equal(writes,1);assert.equal(captured.result.rowCount,256);assert.ok(captured.observation?.status==='setup_unavailable');
 assert.equal(captured.observation.reason,'auto_explain_load_unavailable');assert.ok(events.indexOf('rollback')<events.indexOf('write'));
 assert.equal(captured.observation.cleanup_ms,1);assert.equal(captured.observation.setup_cleanup_wall_ms,captured.observation.setup_ms+captured.observation.cleanup_ms);
 assert.equal(captured.observation.analyze_timing_enabled,false);
 assert.equal(events.filter(x=>x==='write').length,1);
}));

test('DML read-only scope mismatch falls back before write, while DML and cleanup errors never replay or leave a listener',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const hash='sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b';
 const readonly=fakeDmlPlanClient({readOnly:'on'});let fallbackWrites=0;
 const fallback=await captureDmlPlanQueryV1({client:readonly.client,query:async()=>{fallbackWrites++;readonly.events.push('write');return{rowCount:256};},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(fallbackWrites,1);assert.ok(fallback.observation?.status==='setup_unavailable');assert.equal(fallback.observation.reason,'transaction_scope_unverified');
 assert.ok(readonly.events.indexOf('rollback')<readonly.events.indexOf('write'));assert.equal(readonly.client.listenerCount('notice'),0);
 const queryError=fakeDmlPlanClient();let failedWrites=0;
 await assert.rejects(captureDmlPlanQueryV1({client:queryError.client,query:async()=>{failedWrites++;queryError.events.push('write');throw Error('synthetic_dml_error');},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic_dml_error/u);
 assert.equal(failedWrites,1);assert.equal(queryError.client.listenerCount('notice'),0);assert.equal(queryError.events.includes('rollback'),false);
 const cleanupError=fakeDmlPlanClient({failRestore:true});let cleanupWrites=0;
 await assert.rejects(captureDmlPlanQueryV1({client:cleanupError.client,query:async()=>{cleanupWrites++;cleanupError.events.push('write');return{rowCount:256};},
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env}),/private restore failure/u);
 assert.equal(cleanupWrites,1);assert.equal(cleanupError.client.listenerCount('notice'),0);assert.equal(cleanupError.events.includes('rollback'),false);
}));
