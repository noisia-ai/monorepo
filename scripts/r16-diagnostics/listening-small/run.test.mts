import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
 const {EventEmitter}=await import('node:events');const {captureInnerPlanQueryV1}=await import('./observer.mjs');
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
