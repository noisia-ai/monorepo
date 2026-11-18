import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {
  createRosterQueryObserverV1,
  rosterExactSqlV1,
  rosterFindingsV1,
  rosterFunctionDeltasV1,
  rosterGateNamesV1,
  rosterQueryMatchesV1,
  rosterStaticBindingV1,
  runRosterExactQueryObserverV1,
  type RosterFunctionIdentityV1,
  type RosterFunctionRowV1,
  type RosterStaticSourceV1,
} from './signal-listening-roster-query-plan.synthetic.fixture';

const native=process.env.NOISIA_R16_ROSTER_QUERY_PLAN_PG==='true';
const pure=process.env.NOISIA_R16_ROSTER_QUERY_PLAN_PURE==='true';
assert.ok(!(native&&pure),'native and pure roster observer modes must remain separate');

const nativeTitle='native exact facet roster query exposes one expanded view plan and transaction-local counters';
const workspace='abcdef12-3456-7890-abcd-ef1234567890';

test(nativeTitle,{skip:!native},async()=>{
  assert.equal(process.env.GITHUB_ACTIONS,'true','native roster observation is authorized only in CI');
  assert.notEqual(process.env.NOISIA_R16_ROSTER_QUERY_PLAN_PURE,'true');
  const directory=process.env.R16_ROSTER_EXACT_PLAN_EVIDENCE_DIR;
  assert.ok(directory,'native roster evidence directory is required');
  const receipt=await runRosterExactQueryObserverV1(directory);
  const persisted=JSON.parse(await readFile(join(directory,'roster-exact-plan.json'),'utf8'));
  assert.deepEqual(persisted,receipt,'persisted native evidence must match the returned receipt');
  assert.equal(receipt.contract,'r16-roster-query-plan-v1');
  assert.equal(receipt.status,'observed');
  assert.equal(receipt.diagnostic_only,true);
  assert.equal(receipt.h1_accepted,false);
  assert.equal(receipt.cpu,'UNKNOWN');
  assert.equal(receipt.speedup_claim,false);
  assert.ok(!Object.hasOwn(receipt,'candidate_accepted'));
  assert.deepEqual(Object.keys(receipt.gates).sort(),[...rosterGateNamesV1].sort());
  for(const gate of rosterGateNamesV1)assert.equal(receipt.gates[gate],true,gate+' must be explicitly observed');

  const original=receipt.original as Record<string,unknown>;
  assert.equal(original.template_sha256,'sha256:0e4f7d9708942def156838e598672ee5302c8932e332c3378b42c70dff3bd4f2');
  assert.equal(original.raw_sql_match,true);
  assert.equal(original.one_bind_match,true);
  assert.equal(original.call_count,1);
  assert.equal(original.success,true);
  assert.equal(original.same_result_reference,true);
  assert.equal(original.roster_count,32768);
  assert.match(String(original.ordered_root_sha256),/^sha256:[a-f0-9]{64}$/u);
  assert.match(String(original.bag_root_sha256),/^sha256:[a-f0-9]{64}$/u);

  const plan=receipt.plan as Record<string,unknown>;
  assert.equal(plan.status,'observed');
  assert.equal(plan.explain_count,1);
  assert.ok(Number.isSafeInteger(plan.nodes)&&Number(plan.nodes)>0&&Number(plan.nodes)<=512);
  assert.ok(Number.isSafeInteger(plan.bytes)&&Number(plan.bytes)>0&&Number(plan.bytes)<=1024*1024);
  const findings=receipt.findings as Record<string,unknown>;
  assert.equal(findings.status,'INCONCLUSIVE','unresolved callsites never become a known attribution');
  assert.equal(findings.input_digest_callsite_attribution,'UNOBSERVABLE');
  assert.equal(findings.callsites_resolution,'unresolved');

  const context=receipt.context as Record<string,unknown>;
  assert.equal(context.original_isolation,'read committed');
  assert.equal(context.track_functions_during,'all');
  assert.equal(context.local_setting_restored,true);
  assert.equal(context.track_functions_after,context.track_functions_before);
  assert.equal(context.snapshot_original,'UNOBSERVABLE');
  assert.equal(context.same_snapshot_claim,undefined);

  const state=receipt.native_state as Record<string,unknown>;
  assert.equal(state.corpus_roots,32768);
  assert.equal(state.initial_census_roots,32768);
  assert.equal(state.initial_census_rows,131072);
  assert.equal(state.listening_calls,0);
  assert.equal(state.listening_answers,0);
  assert.equal(state.calibration_profiles,0);
  assert.equal(state.open_exposure_micro_usd,0);
  assert.equal(state.lease_absent,true);
  assert.equal(state.provider_http_calls,0);

  const closure=receipt.closure as Record<string,unknown>;
  assert.equal(closure.callback_complete,true);
  assert.equal(closure.factory_returned_normally,true);
  assert.equal(closure.own_database_absent,true);
  assert.equal(closure.admin_end_awaited,true);
});

if(pure){
  test('exact roster matcher binds the original SQL and one original workspace value',()=>{
    assert.equal(rosterQueryMatchesV1(rosterExactSqlV1,[workspace],workspace),true);
    assert.equal(rosterQueryMatchesV1('SELECT root_id  FROM signal_mention_facets_current_v1 WHERE workspace_id=$1',[workspace],workspace),false);
    assert.equal(rosterQueryMatchesV1(rosterExactSqlV1,[workspace,workspace],workspace),false);
    assert.equal(rosterQueryMatchesV1(rosterExactSqlV1,[workspace.toUpperCase()],workspace),false);
    assert.equal(rosterQueryMatchesV1(rosterExactSqlV1,[workspace],'not-a-workspace'),false);
    const poisoned=Object.defineProperty([],0,{enumerable:true,get(){throw new Error('private getter must not run');}});
    Object.defineProperty(poisoned,'length',{value:1});
    assert.equal(rosterQueryMatchesV1(rosterExactSqlV1,poisoned,workspace),false);
  });

  test('static binding checks the immutable head, source trees and complete ordered path manifest',()=>{
    const expected:RosterStaticSourceV1={
      head_sha:'a'.repeat(40),source_tree_sha256:'sha256:tree',tree_status_sha256:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      file_manifest:[{path:'infrastructure/db/source.ts',sha256:'sha256:source'}],
    };
    const actual=structuredClone(expected);
    assert.equal(rosterStaticBindingV1(expected,actual),true);
    assert.equal(rosterStaticBindingV1(expected,{...actual,head_sha:'b'.repeat(40)}),false);
    assert.equal(rosterStaticBindingV1(expected,{...actual,source_tree_sha256:'sha256:changed'}),false);
    assert.equal(rosterStaticBindingV1(expected,{...actual,tree_status_sha256:'sha256:dirty'}),false);
    assert.equal(rosterStaticBindingV1(expected,{...actual,file_manifest:[...actual.file_manifest,{path:'untracked.ts',sha256:'sha256:extra'}]}),false);
    assert.equal(rosterStaticBindingV1(expected,{...actual,file_manifest:[{...actual.file_manifest[0]!,sha256:'sha256:changed'}]}),false);
    assert.equal(rosterStaticBindingV1({...expected,head_sha:'not-a-commit'},actual),false);
  });

  test('function counters preserve missing and regressing baselines as UNKNOWN',()=>{
    const identities:RosterFunctionIdentityV1[]=[
      {oid:'16384',function:'signal_labeling_json_v1'},
      {oid:'16385',function:'signal_labeling_digest_v1'},
    ];
    const before:RosterFunctionRowV1[]=[
      {...identities[0]!,calls:2,total_time_ms:4,self_time_ms:3},
      {...identities[1]!,calls:1,total_time_ms:2,self_time_ms:1},
    ];
    const after:RosterFunctionRowV1[]=[
      {...identities[0]!,calls:5,total_time_ms:8,self_time_ms:6},
      {...identities[1]!,calls:1,total_time_ms:2,self_time_ms:1},
    ];
    const deltas=rosterFunctionDeltasV1(before,after,identities);
    assert.deepEqual(deltas,[
      {...identities[0]!,status:'known',calls:3,total_time_ms:4,self_time_ms:3},
      {...identities[1]!,status:'known',calls:0,total_time_ms:0,self_time_ms:0},
    ]);
    const missing=rosterFunctionDeltasV1(before.slice(0,1),after.slice(0,1),identities);
    assert.equal(missing[1]!.status,'UNKNOWN');
    assert.equal(missing[1]!.calls,null);
    const regressed=rosterFunctionDeltasV1(after,before,identities);
    assert.equal(regressed[0]!.status,'UNKNOWN');
    assert.equal(regressed[0]!.total_time_ms,null);
    assert.throws(()=>rosterFunctionDeltasV1(before,[{...after[0]!,oid:'99999'},after[1]!],identities));
    assert.throws(()=>rosterFunctionDeltasV1([{...before[0]!,calls:Number.NaN},before[1]!],after,identities));
  });

  test('query-level findings stay inconclusive when callsite identity is unresolved',()=>{
    const usable=rosterFindingsV1(true,'expanded','known','known');
    assert.deepEqual(usable,{
      status:'INCONCLUSIVE',view_plan_visibility:'expanded',serializer_delta_status:'known',digest_delta_status:'known',
      input_digest_callsite_attribution:'UNOBSERVABLE',callsites_resolution:'unresolved',
      interpretation:'partial_method_data_not_enough_to_establish_repetition',
    });
    assert.equal(rosterFindingsV1(true,'partly_opaque','UNKNOWN','known').status,'INCONCLUSIVE');
    assert.equal(rosterFindingsV1(false,'UNKNOWN','UNKNOWN','UNKNOWN').status,'UNKNOWN');
  });

  test('query observer keeps the exact caller client and restores local tracking before continuation',async()=>{
    const observer=createRosterQueryObserverV1(()=>1);
    observer.bindWorkspace(workspace);
    const source=await readFile(new URL('./0223_signal_mention_facets.sql',import.meta.url),'utf8');
    const functionRow=(name:'signal_labeling_json_v1'|'signal_labeling_digest_v1',oid:string)=>{
      const body=new RegExp('CREATE FUNCTION '+name+'\\(value jsonb\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;','u').exec(source)?.[1];
      assert.ok(body,'expected source declaration must exist');
      return{oid,proname:name,prosrc:body,proowner:'2',proacl:'{=X}',proconfig:null,prosecdef:false,provolatile:'i',proisstrict:true,proparallel:'u',proargtypes:'3802',lanname:name==='signal_labeling_json_v1'?'plpgsql':'sql'};
    };
    const functionRows=[functionRow('signal_labeling_digest_v1','16385'),functionRow('signal_labeling_json_v1','16384')];
    let tracking='none',statsRead=0,clientQueries=0,commits=0,releases=0;
    const client={async query(text:string,values?:unknown[]){
      clientQueries++;
      if(text.startsWith('SELECT pg_backend_pid()'))return{rows:[{backend:'42',transaction_id:'100',snapshot:'100:100:',invoker:'ci_invoker',session_user:'ci_session',role:'none',search_path:'public',track_functions:tracking,isolation:'read committed'}]};
      if(text.startsWith('SELECT c.oid::text,c.relowner::text'))return{rows:[{oid:'16390',relowner:'3',relkind:'v',reloptions:null,relacl:'{=r}',definition:'SELECT root_id',column_acls:[]}]};
      if(text.startsWith('SELECT p.oid::text,p.proname'))return{rows:functionRows};
      if(text.startsWith("SET LOCAL track_functions='")){tracking=text.includes("='all'")?'all':'none';return{rows:[]};}
      if(text.startsWith('SELECT current_setting(\'track_functions\')'))return{rows:[{value:tracking}]};
      if(text.startsWith('SELECT funcid::text oid')){
        statsRead++;
        const calls=statsRead===1?'2':'3';
        return{rows:[{oid:'16385',function:'signal_labeling_digest_v1',calls,total_time_ms:2,self_time_ms:1},{oid:'16384',function:'signal_labeling_json_v1',calls,total_time_ms:3,self_time_ms:2}]};
      }
      if(text.startsWith('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)'))return{rows:[{'QUERY PLAN':[{Plan:{'Node Type':'Result','Actual Rows':32768,'Actual Loops':1},'Planning Time':1,'Execution Time':2}]}]};
      if(text.startsWith('SELECT c.relname name FROM pg_class'))return{rows:[]};
      throw new Error('unexpected auxiliary query in observer test');
    }};
    const begin={rows:[]};
    assert.equal(await observer.query(client,['BEGIN'],()=>Promise.resolve(begin),true),begin);
    const original={rows:Array.from({length:32768},(_,index)=>({root_id:'00000000-0000-0000-0000-'+String(index).padStart(12,'0')}))};
    let forwarded=0;
    const returned=await observer.query(client,[rosterExactSqlV1,[workspace]],()=>{forwarded++;return Promise.resolve(original);},true);
    assert.equal(returned,original,'observer must return the exact result object from the original client call');
    assert.equal(forwarded,1);
    assert.equal(tracking,'none','SET LOCAL tracking must be restored before the caller continues');
    const commit={rows:[]};
    assert.equal(await observer.query(client,['COMMIT'],()=>{commits++;return Promise.resolve(commit);},true),commit);
    const releaseArgs=[false];
    const releaseResult={released:true};
    assert.equal(observer.release(client,releaseArgs,args=>{releases++;assert.deepEqual(args,releaseArgs);return releaseResult}),releaseResult);
    assert.equal(commits,1);
    assert.equal(releases,1);
    const snapshot=observer.snapshot();
    assert.equal(snapshot.original.call_count,1);
    assert.equal(snapshot.original.same_result_reference,true);
    assert.equal(snapshot.context.local_setting_restored,true);
    assert.equal(snapshot.context.track_functions_before,'none');
    assert.equal(snapshot.context.track_functions_after,'none');
    assert.equal(snapshot.native_catalog.unchanged,true);
    assert.equal(snapshot.plan.status,'observed');
    assert.equal(snapshot.plan.explain_count,1);
    assert.equal(snapshot.client_released,true);
    assert.ok(clientQueries>0);
  });

  test('original-query failure remains primary, suppresses EXPLAIN and marks the client for rollback',async()=>{
    const observer=createRosterQueryObserverV1(()=>1);
    observer.bindWorkspace(workspace);
    let tracking='none',explainCalls=0,releaseArgs:unknown;
    const source=await readFile(new URL('./0223_signal_mention_facets.sql',import.meta.url),'utf8');
    const body=(name:string)=>new RegExp('CREATE FUNCTION '+name+'\\(value jsonb\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;','u').exec(source)?.[1];
    const functions=[
      {oid:'16385',proname:'signal_labeling_digest_v1',prosrc:body('signal_labeling_digest_v1'),proowner:'2',proacl:'{=X}',proconfig:null,prosecdef:false,provolatile:'i',proisstrict:true,proparallel:'u',proargtypes:'3802',lanname:'sql'},
      {oid:'16384',proname:'signal_labeling_json_v1',prosrc:body('signal_labeling_json_v1'),proowner:'2',proacl:'{=X}',proconfig:null,prosecdef:false,provolatile:'i',proisstrict:true,proparallel:'u',proargtypes:'3802',lanname:'plpgsql'},
    ];
    const client={async query(text:string){
      if(text.startsWith('SELECT pg_backend_pid()'))return{rows:[{backend:'42',transaction_id:'100',snapshot:'100:100:',invoker:'ci_invoker',session_user:'ci_session',role:'none',search_path:'public',track_functions:tracking,isolation:'read committed'}]};
      if(text.startsWith('SELECT c.oid::text,c.relowner::text'))return{rows:[{oid:'16390',relowner:'3',relkind:'v',reloptions:null,relacl:'{=r}',definition:'SELECT root_id',column_acls:[]}]};
      if(text.startsWith('SELECT p.oid::text,p.proname'))return{rows:functions};
      if(text.startsWith("SET LOCAL track_functions='")){tracking='all';return{rows:[]};}
      if(text.startsWith('SELECT funcid::text oid'))return{rows:[{oid:'16385',function:'signal_labeling_digest_v1',calls:'2',total_time_ms:2,self_time_ms:1},{oid:'16384',function:'signal_labeling_json_v1',calls:'3',total_time_ms:3,self_time_ms:2}]};
      if(text.startsWith('EXPLAIN ')){explainCalls++;return{rows:[]};}
      throw new Error('unexpected auxiliary query in failure test');
    }};
    await observer.query(client,['BEGIN'],()=>Promise.resolve({rows:[]}),true);
    const primary=Object.assign(new Error('PRIVATE query failure'),{code:'23514'});
    await assert.rejects(async()=>observer.query(client,[rosterExactSqlV1,[workspace]],()=>Promise.reject(primary),true),error=>error===primary);
    assert.equal(explainCalls,0,'the observer must not explain a failed original query');
    assert.equal(observer.snapshot().primary_stage,'original_query');
    assert.equal(observer.snapshot().sticky_failure,true);
    const rollback={rows:[]};
    await observer.query(client,['ROLLBACK'],()=>Promise.resolve(rollback),true);
    assert.equal(observer.snapshot().rollback_reset_confirmed,true);
    const released={released:true};
    assert.equal(observer.release(client,[false],args=>{releaseArgs=args;return released}),released);
    assert.deepEqual(releaseArgs,[false],'confirmed owner rollback permits normal client release');
    assert.equal(observer.getPrimary(),primary,'the original caller failure remains primary');
  });
}
