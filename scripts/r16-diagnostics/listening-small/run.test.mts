import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {chmod,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertCpuProfilerArgsV1,assertListeningSmallGuardV1,captureCalibrationObservationV1,classificationClockMetadataV1,
  assertListeningResourceProfileV1,listeningResourceProfileV1,cpuProfileIdentityV1,cpuProfileMetadataV1,cpuProfileRangeV1,createJevHttpTokenWitnessV1,
  runListeningSmallDiagnosticV1,tokenCalibrationKindFromEnvV1,diagnosticModeV1,assertDiagnosticExecArgsV1} from './run.mjs';

async function streamProfileDependencies(){
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'resource profile contract needs checked out public target root');
 const runtime=await import(pathToFileURL(join(target,'services/workers/src/providers/jev-streaming-runtime.ts')).href) as any;
 const envFor=(profile:'baseline_512m'|'bounded_2g'):NodeJS.ProcessEnv=>({NOISIA_JEV_STREAMING_V2_ENABLED:'true',
  NOISIA_JEV_STREAM_MAX_IN_FLIGHT:profile==='baseline_512m'?'1024':'4096',
  NOISIA_JEV_STREAM_BUFFER_BYTES:profile==='baseline_512m'?'536870912':'2147483648',
  NOISIA_JEV_STREAM_FLUSH_SIZE:profile==='baseline_512m'?'1024':'4096',NOISIA_JEV_STREAM_MAX_FLUSHES:'2',
  NOISIA_JEV_STREAM_FLUSH_INTERVAL_MS:profile==='baseline_512m'?'250':'1000',NOISIA_JEV_STREAM_WINDOW_SIZE:'4096'});
 return{getExecution:runtime.jevStreamingExecutionFromEnvV2,envFor};
}
async function projectionMetadataSource(target:string){
 const source=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const start=source.indexOf('async function inputProjectionMetadata('),end=source.indexOf('\nasync function inputs(',start);
 if(start<0||end<=start){const historical=source.match(/`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?LIMIT \$6)`/u);
  let sql=historical?.[1]??null;
  if(sql){const refs=[...new Set([...sql.matchAll(/\$\{([A-Za-z_]+)\}/gu)].map(match=>match[1]!))].sort();
   assert.ok(JSON.stringify(refs)==='["noHumanDecision","unresolvedScope"]'||JSON.stringify(refs)==='["pendingScope","population"]');
   for(const name of refs){const literal=source.match(new RegExp('const '+name+'=(?:`([^`]+)`|"([^"]+)");','u'));
    assert.ok(literal);sql=sql.replaceAll('${'+name+'}',literal[1]??literal[2]!);}}
  return{source,helper:null,sql};}
 const helper=source.slice(start,end);
 const query=helper.match(/`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?ORDER BY (?:prefix\.root_id|root_id))`\s*,\s*\[run\.workspace_id,o\.configuration_id,o\.map_id,run\.entity_context_digest,run\.id,limit-rows\.length,fixed,ids,remaining\.toString\(\)\]\)/u);
 assert.ok(query,'projection helper must use the full nine-bind metadata query and exact bind order');
 const refs=[...new Set([...query[1]!.matchAll(/\$\{([A-Za-z_]+)\}/gu)].map(match=>match[1]!))].sort();
 assert.deepEqual(refs,['noHumanDecision','unresolvedScope'],'projection SQL may interpolate only the two scoped source predicates');
 let sql=query[1]!;
 for(const name of refs){const literal=source.match(new RegExp('const '+name+'=(?:`([^`]+)`|"([^"]+)");','u'));
  assert.ok(literal,'projection SQL source predicate must be a literal');const value=literal[1]??literal[2];assert.ok(value&&!value.includes('${'));
  sql=sql.replaceAll('${'+name+'}',value);}
 assert.ok(!sql.includes('${'),'all projection SQL interpolation must resolve to source literals');
 return{source,helper,sql};
}

test('default resource profile resolves through the product getter to the baseline tuple',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();
 assert.equal(listeningResourceProfileV1({},'legacy'),'baseline_512m');
 const env=envFor('baseline_512m');
 assert.deepEqual(assertListeningResourceProfileV1('baseline_512m','legacy',env,getExecution),
  {max_in_flight:1024,max_buffered_bytes:536870912,flush_size:1024,max_flushes:2,flush_interval_ms:250,window_size:4096});
});

test('bounded resource profile resolves through the product getter only for neutral modes',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();
 const env={...envFor('bounded_2g'),R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g'};
 assert.equal(listeningResourceProfileV1(env,'neutral_only'),'bounded_2g');
 assert.deepEqual(assertListeningResourceProfileV1('bounded_2g','neutral_only',env,getExecution),
  {max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096});
 assert.equal(listeningResourceProfileV1(env,'sql_frontier_only'),'bounded_2g');
 assert.deepEqual(assertListeningResourceProfileV1('bounded_2g','sql_frontier_only',env,getExecution),
  {max_in_flight:4096,max_buffered_bytes:2147483648,flush_size:4096,max_flushes:2,flush_interval_ms:1000,window_size:4096});
});

test('resource profile selection rejects unknown names and bounded mode outside neutral runs',()=>{
 assert.throws(()=>listeningResourceProfileV1({R16_DIAGNOSTIC_RESOURCE_PROFILE:'surprise'},'neutral_only'),/resource_profile_invalid/u);
 assert.throws(()=>listeningResourceProfileV1({R16_DIAGNOSTIC_RESOURCE_PROFILE:'bounded_2g'},'legacy'),/resource_profile_requires_neutral_mode/u);
});

test('resource profile workflow Bash gate allows manual SQL frontier shared smoke and preserves other mode gates',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 assert.match(workflow,/capture_projection_plan:\r?\n\s+type: boolean\r?\n\s+default: false/u);
 const runnerEnv=workflow.slice(workflow.indexOf('      - name: Apply migrations, focused oracle, and native diagnostic'),
  workflow.indexOf('        run: |',workflow.indexOf('      - name: Apply migrations, focused oracle, and native diagnostic')));
 assert.equal([...runnerEnv.matchAll(/^\s+R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:/gmu)].length,1,
  'native diagnostic must receive the opt-in exactly once');
 assert.ok(runnerEnv.includes('RAW_ACCEPTANCE_SELECTED_PASS:')&&runnerEnv.includes('RAW_ACCEPTANCE_TARGET_SHA:')
  &&runnerEnv.includes('RESERVE_SHARED_SMOKE:'),'runner must receive only the isolated RAW acceptance decision metadata');
 const stepStart=workflow.indexOf('      - name: Validate resource profile selection');assert.ok(stepStart>=0,'resource profile validation step must exist');
 const nextStep=workflow.indexOf('      - name: ',stepStart+'      - name: Validate resource profile selection'.length);
 const step=workflow.slice(stepStart,nextStep<0?undefined:nextStep).split(/\r?\n/u);
 const runLine=step.findIndex(line=>line==='        run: |');assert.ok(runLine>=0,'resource profile validation must remain an inline Bash step');
 const body:string[]=[];
 for(const line of step.slice(runLine+1)){
  if(line===''){body.push('');continue;}
  if(!line.startsWith('          '))break;
  body.push(line.slice(10));
 }
 const script=body.join('\n').trimEnd();assert.ok(script.includes('reserve_shared_smoke requires a manual neutral_only or sql_frontier_only run'));
 const sha='a'.repeat(40);
 const run=(mode:string,profile:string,smoke:boolean,event:string,targetRef=sha,selectedPass='0',acceptanceSha='',capture=false,
  projectionLinear=false,linearPass='0',linearSha='')=>spawnSync('/bin/bash',['-euo','pipefail','-c',script],{
  encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',MODE:mode,RESOURCE_PROFILE:profile,
   RESERVE_SHARED_SMOKE:String(smoke),EVENT_NAME:event,TARGET_REF:targetRef,
   RAW_ACCEPTANCE_SELECTED_PASS:selectedPass,RAW_ACCEPTANCE_TARGET_SHA:acceptanceSha,CAPTURE_PROJECTION_PLAN:String(capture),
   PROJECTION_LINEAR_ORACLE:String(projectionLinear),LINEAR_ACCEPTANCE_SELECTED_PASS:linearPass,LINEAR_ACCEPTANCE_TARGET_SHA:linearSha,
   STATEMENT_SHARED_WIRE_ORACLE:'false',STATEMENT_SHARED_WIRE_SELECTED_PASS:'0',STATEMENT_SHARED_WIRE_TARGET_SHA:'',TARGET_ROOT:'/nonexistent/r16-shared-wire-target'}});
 const cases:[string,string,string,boolean,string,string,string,string,boolean,boolean][]=[
  ['SQL frontier bounded profile with exact RAW acceptance evidence','sql_frontier_only','bounded_2g',true,'workflow_dispatch',sha,'6',sha,true,false],
  ['neutral bounded profile with exact RAW acceptance evidence','neutral_only','bounded_2g',true,'workflow_dispatch',sha,'6',sha,true,false],
  ['projection capture accepts the exact SQL shared smoke target','sql_frontier_only','baseline_512m',true,'workflow_dispatch',sha,'6',sha,true,true],
  ['projection capture rejects neutral mode','neutral_only','bounded_2g',true,'workflow_dispatch',sha,'6',sha,false,true],
  ['projection capture rejects missing shared smoke','sql_frontier_only','baseline_512m',false,'workflow_dispatch',sha,'0','',false,true],
  ['projection capture rejects a non-manual run','sql_frontier_only','baseline_512m',true,'pull_request',sha,'6',sha,false,true],
  ['projection capture rejects a mismatched RAW target','sql_frontier_only','baseline_512m',true,'workflow_dispatch',sha,'6','b'.repeat(40),false,true],
  ['smoke rejects missing RAW acceptance passes','sql_frontier_only','bounded_2g',true,'workflow_dispatch',sha,'0',sha,false,false],
  ['smoke rejects RAW acceptance from a different target','neutral_only','baseline_512m',true,'workflow_dispatch',sha,'6','b'.repeat(40),false,false],
  ['legacy shared smoke remains rejected','legacy','baseline_512m',true,'workflow_dispatch','', '0','',false,false],
  ['SQL shared smoke remains manual-only','sql_frontier_only','baseline_512m',true,'pull_request',sha,'0','',false,false],
  ['neutral shared smoke remains manual-only','neutral_only','baseline_512m',true,'pull_request',sha,'0','',false,false],
  ['SQL mode rejects a missing explicit target','sql_frontier_only','baseline_512m',false,'workflow_dispatch','', '0','',false,false],
  ['SQL mode rejects a malformed explicit target','sql_frontier_only','baseline_512m',false,'workflow_dispatch','A'.repeat(40),'0','',false,false],
  ['legacy baseline without shared smoke remains unchanged','legacy','baseline_512m',false,'pull_request','', '0','',true,false],
 ];
 for(const [label,mode,profile,smoke,event,targetRef,selectedPass,acceptanceSha,expectedPass,capture] of cases){
  const result=run(mode,profile,smoke,event,targetRef,selectedPass,acceptanceSha,capture);
  assert.equal(result.status,expectedPass?0:1,`${label}: ${result.stderr||result.stdout}`);
 }
 const linearCases:[string,string,boolean,string,string,string,string,boolean][]=[
  ['neutral manual projection oracle with exact RAW/linear evidence','neutral_only',true,'workflow_dispatch',sha,'6',sha,true],
  ['SQL manual projection oracle with exact RAW/linear evidence','sql_frontier_only',true,'workflow_dispatch',sha,'6',sha,true],
  ['projection oracle rejects legacy mode','legacy',true,'workflow_dispatch',sha,'6',sha,false],
  ['projection oracle rejects missing shared smoke','neutral_only',false,'workflow_dispatch',sha,'0','',false],
  ['projection oracle rejects non-manual mode','neutral_only',true,'pull_request',sha,'6',sha,false],
  ['projection oracle rejects missing target SHA','sql_frontier_only',true,'workflow_dispatch','', '6',sha,false],
  ['projection oracle rejects missing three-case evidence','neutral_only',true,'workflow_dispatch',sha,'6',sha,false],
  ['projection oracle rejects target mismatch','neutral_only',true,'workflow_dispatch',sha,'6',sha,false],
 ];
 for(const [label,mode,smoke,event,targetRef,rawPass,rawSha,expectedPass] of linearCases){
  const linearPass=label.includes('missing three-case')?'2':'3',linearSha=label.includes('target mismatch')?'b'.repeat(40):sha;
  const result=run(mode,'baseline_512m',smoke,event,targetRef,rawPass,rawSha,false,true,linearPass,linearSha);
  assert.equal(result.status,expectedPass?0:1,`${label}: ${result.stderr||result.stdout}`);
 }
});

test('0330 source and statement shared-wire evidence are enforced by the actual workflow Bash gate',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 assert.match(workflow,/statement_shared_wire_oracle:\r?\n\s+type: boolean\r?\n\s+default: false/u);
 const stepStart=workflow.indexOf('      - name: Validate resource profile selection');assert.ok(stepStart>=0);
 const nextStep=workflow.indexOf('      - name: ',stepStart+'      - name: Validate resource profile selection'.length);
 const step=workflow.slice(stepStart,nextStep<0?undefined:nextStep).split(/\r?\n/u);
 const runLine=step.findIndex(line=>line==='        run: |');assert.ok(runLine>=0);
 const body:string[]=[];
 for(const line of step.slice(runLine+1)){
  if(line===''){body.push('');continue;}
  if(!line.startsWith('          '))break;
  body.push(line.slice(10));
 }
 const script=body.join('\n').trimEnd();
 assert.ok(script.includes('0330 source requires five statement shared-wire passes plus RAW and projection gates on the exact target SHA'));
 for(const file of ['0330_signal_listening_statement_shared_wire.sql','signal-listening-statement-shared-wire.oracle.ts',
  'signal-listening-statement-shared-wire.fixture.ts','signal-listening-statement-shared-wire.postgres.test.ts',
  'signal-listening-statement-shared-wire.test.ts'])assert.ok(script.includes(`$TARGET_ROOT/infrastructure/db/migrations/${file}`),`workflow guard requires ${file}`);
 assert.ok(script.includes('[ "$statement_source_count" -ne "${#statement_sources[@]}" ]'),'the real Bash guard fails closed when any source file is absent');
 const sha='a'.repeat(40),dir=await mkdtemp(join(tmpdir(),'r16-shared-wire-gate-'));
 const target=join(dir,'target'),migrationDir=join(target,'infrastructure/db/migrations');
 const sourceFiles=['0330_signal_listening_statement_shared_wire.sql','signal-listening-statement-shared-wire.oracle.ts',
  'signal-listening-statement-shared-wire.fixture.ts','signal-listening-statement-shared-wire.postgres.test.ts',
  'signal-listening-statement-shared-wire.test.ts'];
 await mkdir(migrationDir,{recursive:true});
 for(const file of sourceFiles)await writeFile(join(migrationDir,file),file.endsWith('.postgres.test.ts')?"test('0330 native suite source fixture');\n":"// synthetic presence-only source fixture\n");
 const base={PATH:process.env.PATH??'/usr/bin:/bin',MODE:'neutral_only',RESOURCE_PROFILE:'bounded_2g',RESERVE_SHARED_SMOKE:'true',
  CAPTURE_PROJECTION_PLAN:'false',PROJECTION_LINEAR_ORACLE:'true',STATEMENT_SHARED_WIRE_ORACLE:'true',EVENT_NAME:'workflow_dispatch',
  TARGET_REF:sha,TARGET_ROOT:target,RAW_ACCEPTANCE_SELECTED_PASS:'6',RAW_ACCEPTANCE_TARGET_SHA:sha,
  LINEAR_ACCEPTANCE_SELECTED_PASS:'3',LINEAR_ACCEPTANCE_TARGET_SHA:sha,STATEMENT_SHARED_WIRE_SELECTED_PASS:'5',STATEMENT_SHARED_WIRE_TARGET_SHA:sha};
 const run=(env:Record<string,string>)=>spawnSync('/bin/bash',['-euo','pipefail','-c',script],{encoding:'utf8',env:{...base,...env}});
 try{
  const accepted=run({});assert.equal(accepted.status,0,accepted.stderr||accepted.stdout);
  for(const [label,env] of [
   ['new source cannot omit the dedicated oracle',{STATEMENT_SHARED_WIRE_ORACLE:'false'}],
   ['legacy mode cannot claim the opt-in',{MODE:'legacy'}],
   ['pull requests cannot request this manual oracle',{EVENT_NAME:'pull_request'}],
   ['missing selected case evidence fails closed',{STATEMENT_SHARED_WIRE_SELECTED_PASS:'4'}],
   ['a different target SHA fails closed',{STATEMENT_SHARED_WIRE_TARGET_SHA:'b'.repeat(40)}],
   ['missing exact target SHA fails closed',{TARGET_REF:''}],
   ['missing linear evidence fails closed',{LINEAR_ACCEPTANCE_SELECTED_PASS:'2'}],
   ['missing RAW evidence fails closed',{RAW_ACCEPTANCE_SELECTED_PASS:'5'}],
   ['malformed boolean fails closed',{STATEMENT_SHARED_WIRE_ORACLE:'yes'}],
  ] as const){const result=run(env);assert.notEqual(result.status,0,`${label}: ${result.stderr||result.stdout}`);}
  for(const file of sourceFiles)await rm(join(migrationDir,file),{force:true});
  assert.notEqual(run({}).status,0,'an explicit opt-in fails if the target source lacks the 0330 oracle file');
  await writeFile(join(migrationDir,sourceFiles[0]!),"-- synthetic SQL source\n");
  const partial=run({STATEMENT_SHARED_WIRE_ORACLE:'false'});assert.notEqual(partial.status,0,'an 0330 SQL-only target cannot no-op');
  await rm(join(migrationDir,sourceFiles[0]!),{force:true});
  const oldTarget=run({MODE:'legacy',RESOURCE_PROFILE:'baseline_512m',RESERVE_SHARED_SMOKE:'false',PROJECTION_LINEAR_ORACLE:'false',
   STATEMENT_SHARED_WIRE_ORACLE:'false',EVENT_NAME:'pull_request',TARGET_REF:'',RAW_ACCEPTANCE_SELECTED_PASS:'0',RAW_ACCEPTANCE_TARGET_SHA:'',
   LINEAR_ACCEPTANCE_SELECTED_PASS:'0',LINEAR_ACCEPTANCE_TARGET_SHA:'',STATEMENT_SHARED_WIRE_SELECTED_PASS:'0',STATEMENT_SHARED_WIRE_TARGET_SHA:''});
  assert.equal(oldTarget.status,0,`pre-0330 legacy baseline remains unchanged: ${oldTarget.stderr||oldTarget.stdout}`);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('statement shared-wire probe and MFP jobs gate five exact cases on isolated labs and sealed source',async()=>{
 const probePath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const mfpPath=new URL('../../../.github/workflows/mfp-postgres.yml',import.meta.url);
 const [probe,mfp]=await Promise.all([readFile(probePath,'utf8'),readFile(mfpPath,'utf8')]);
 const jobStart=probe.indexOf('  statement-shared-wire-acceptance:');assert.ok(jobStart>=0);
 const mainStart=probe.indexOf('  listening-small:',jobStart);assert.ok(mainStart>jobStart);
 const job=probe.slice(jobStart,mainStart);
 assert.ok(job.includes("if: ${{ always() && inputs.statement_shared_wire_oracle == true }}"));
 assert.ok(job.includes('needs: [raw-acceptance, projection-linear-acceptance]'));
 assert.ok(job.includes('RAW_ACCEPTANCE_SELECTED_PASS')&&job.includes('LINEAR_ACCEPTANCE_SELECTED_PASS'));
 assert.ok(job.includes('source_sha=$(git rev-parse HEAD)')&&job.includes('test "$source_sha" = "$TARGET_REF"'));
 assert.ok(job.includes('test "$(git rev-parse HEAD)" = "$R16_STATEMENT_SHARED_WIRE_SOURCE_SHA"'));
 assert.ok(job.includes("NOISIA_R16_STATEMENT_SHARED_WIRE_PG: 'true'")&&job.includes('R16_STATEMENT_SHARED_WIRE_LAB_OWNED'));
 assert.ok(probe.includes('statement-shared-wire-acceptance.result == \'success\''),'main job must wait for selected evidence when the input is true');
 assert.ok(probe.includes('STATEMENT_SHARED_WIRE_SELECTED_PASS: ${{ needs.statement-shared-wire-acceptance.outputs.selected_pass || \'0\' }}'));
 const expected=[
  '0330 native same-snapshot validators preserve32shapes256keys UTF8 precision and mixed-wire fallback',
  '0330 native reserve Mark bad-mixed rollback and deferred pre-owner forged hash stay enforced',
  '0330 native real prior unknown is true and target ownership never becomes a cached authority',
  '0330 preserves answer BEFORE attempts including conflict-suppressed bad tuples and native source bytes',
  '0330 native DML ABBA keeps full guards and fresh transactions and rejects expiry with atomic rollback',
 ];
 const selectorMatch=job.match(/--test-name-pattern='([^']+)'[\s\\\n]*--import tsx infrastructure\/db\/migrations\/signal-listening-statement-shared-wire\.postgres\.test\.ts/u);
 assert.ok(selectorMatch,'probe must run the native statement shared-wire file with a focused selector');
 const selector=new RegExp(selectorMatch[1]!);
 for(const title of expected)assert.equal(selector.test(title),true,`selector includes exact title: ${title}`);
 assert.equal(selector.test('0330 unrelated control'),false,'selector rejects unlisted native cases');
 const gateStart=job.indexOf('node - "$R16_STATEMENT_SHARED_WIRE_TAP" "$test_status"');assert.ok(gateStart>=0);
 const heredocStart=job.indexOf("<<'NODE'\n",gateStart);assert.ok(heredocStart>=0);
 const bodyStart=heredocStart+"<<'NODE'\n".length,bodyEnd=job.indexOf('\n          NODE',bodyStart);assert.ok(bodyEnd>bodyStart);
 const gate=job.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const dir=await mkdtemp(join(tmpdir(),'r16-shared-wire-tap-')),tapPath=join(dir,'tap');
 const execute=async(tap:string,status=0)=>{await writeFile(tapPath,tap);return spawnSync(process.execPath,['-',tapPath,String(status)],{encoding:'utf8',input:gate});};
 try{
  const passing=[...expected.map((title,index)=>`ok ${index+1} - ${title}`),'1..5','# tests 5','# pass 5','# fail 0','# cancelled 0','# skipped 0','# todo 0'].join('\n');
  const pass=await execute(passing);assert.equal(pass.status,0,pass.stderr||pass.stdout);
  const skipped=passing.replace(`ok 1 - ${expected[0]}`,`ok 1 - ${expected[0]} # SKIP unavailable`).replace('# pass 5','# pass 4').replace('# skipped 0','# skipped 1');
  assert.notEqual((await execute(skipped)).status,0,'selected skip is rejected');
  assert.notEqual((await execute(passing,1)).status,0,'nonzero test process status is rejected');
 }finally{await rm(dir,{recursive:true,force:true});}
 const mfpStart=mfp.indexOf('  statement-shared-wire:');assert.ok(mfpStart>=0);
 const mfpJob=mfp.slice(mfpStart);
 assert.ok(mfpJob.includes('name: R16 statement shared-wire acceptance (fresh isolated lab)'));
 assert.ok(mfpJob.includes('needs: projection-linear-joins'));
 assert.ok(mfpJob.includes('source_present=true')&&mfpJob.includes('source_present=false'));
 assert.ok(mfpJob.includes('0330_signal_listening_statement_shared_wire.sql'),'MFP no-op detection includes the authoritative 0330 SQL source');
 assert.ok(mfpJob.includes('if: ${{ steps.seal.outputs.source_present == \'true\' }}'));
 assert.ok(mfpJob.includes('NOISIA_R16_STATEMENT_SHARED_WIRE_PG: \'true\''));
 assert.ok(mfpJob.includes('^# tests 5$')&&mfpJob.includes('^# pass 5$')&&mfpJob.includes('^# skipped 0$'));
 assert.ok(mfpJob.includes('Upload statement shared-wire TAP receipt')&&mfpJob.includes('Stop and remove only the owned statement shared-wire lab'));
});

test('target 0330 source exposes the five exact native cases through its existing isolated fixture',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'statement source contract needs the exact checked out product target');
 const testPath=join(target,'infrastructure/db/migrations/signal-listening-statement-shared-wire.postgres.test.ts');
 let source='';try{source=await readFile(testPath,'utf8');}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 }
 if(!source){
  assert.ok(!source,'pre-0330 target has no statement shared-wire native suite');
  return;
 }
 const expected=[
  '0330 native same-snapshot validators preserve32shapes256keys UTF8 precision and mixed-wire fallback',
  '0330 native reserve Mark bad-mixed rollback and deferred pre-owner forged hash stay enforced',
  '0330 native real prior unknown is true and target ownership never becomes a cached authority',
  '0330 preserves answer BEFORE attempts including conflict-suppressed bad tuples and native source bytes',
  '0330 native DML ABBA keeps full guards and fresh transactions and rejects expiry with atomic rollback',
 ];
 for(const title of expected){
  const occurrences=source.split(`test('${title}'`).length-1;
  assert.equal(occurrences,1,`target source has exactly one executable native case: ${title}`);
 }
 assert.ok(source.includes("process.env.NOISIA_R16_STATEMENT_SHARED_WIRE_PG==='true'"),'the native suite is behind its dedicated opt-in flag');
 assert.ok(source.includes("from './signal-listening-statement-shared-wire.fixture'"),'the suite uses its fixture module');
 assert.ok(source.includes('withSharedWireFixtureV1'),'the suite uses the established isolated acceptance fixture');
 const fixture=await readFile(join(target,'infrastructure/db/migrations/signal-listening-statement-shared-wire.fixture.ts'),'utf8');
 assert.ok(fixture.includes('runMassLabelingAcceptanceFixtureV1(mode,'),'the fixture delegates isolation to the established native fixture factory');
 assert.ok(fixture.includes("options.mode==='scaled_recovery'?'product-recovery':'product'"),'the 1002-root case uses product-recovery');
 assert.ok(!fixture.includes('benchmark:')&&!fixture.includes('benchmark_'),'the shared-wire fixture does not allocate the global benchmark fixture');
});

test('MFP source detector runs only for a complete 0330 source set and rejects incomplete pairs',async()=>{
 const workflow=await readFile(new URL('../../../.github/workflows/mfp-postgres.yml',import.meta.url),'utf8');
 const jobStart=workflow.indexOf('  statement-shared-wire:');assert.ok(jobStart>=0);
 const sealStart=workflow.indexOf('      - name: Seal the checked out source revision',jobStart);assert.ok(sealStart>jobStart);
 const nextStep=workflow.indexOf('      - name: ',sealStart+'      - name: Seal the checked out source revision'.length);
 const step=workflow.slice(sealStart,nextStep<0?undefined:nextStep).split(/\r?\n/u);
 const runLine=step.findIndex(line=>line==='        run: |');assert.ok(runLine>=0);
 const body:string[]=[];for(const line of step.slice(runLine+1)){if(line===''){body.push('');continue;}if(!line.startsWith('          '))break;body.push(line.slice(10));}
 const script=body.join('\n').trimEnd();
 for(const path of [
  '0330_signal_listening_statement_shared_wire.sql',
  'signal-listening-statement-shared-wire.oracle.ts',
  'signal-listening-statement-shared-wire.fixture.ts',
  'signal-listening-statement-shared-wire.postgres.test.ts',
  'signal-listening-statement-shared-wire.test.ts',
 ])assert.ok(script.includes(path),`source detector covers ${path}`);
 const dir=await mkdtemp(join(tmpdir(),'r16-shared-wire-source-detect-'));
 const target=join(dir,'target'),bin=join(dir,'bin'),migration=join(target,'infrastructure/db/migrations');
 await mkdir(bin,{recursive:true});await mkdir(migration,{recursive:true});
 const fakeGit=join(bin,'git');await writeFile(fakeGit,'#!/bin/sh\ncase "$1" in\n rev-parse) printf "%s\\n" "$TARGET_REF" ;;\n status) exit 0 ;;\n *) exit 2 ;;\nesac\n');await chmod(fakeGit,0o755);
 const files=['0330_signal_listening_statement_shared_wire.sql','signal-listening-statement-shared-wire.oracle.ts',
  'signal-listening-statement-shared-wire.fixture.ts','signal-listening-statement-shared-wire.postgres.test.ts',
  'signal-listening-statement-shared-wire.test.ts'];
 const run=async(present:string[])=>{
  for(const file of files){const path=join(migration,file);await rm(path,{force:true});if(present.includes(file))await writeFile(path,'// synthetic presence-only fixture\n');}
  const output=join(dir,'output'),environment=join(dir,'environment');await writeFile(output,'');await writeFile(environment,'');
  const result=spawnSync('/bin/bash',['-euo','pipefail','-c',script],{cwd:target,encoding:'utf8',env:{PATH:`${bin}:/usr/bin:/bin`,TARGET_REF:'a'.repeat(40),GITHUB_ENV:environment,GITHUB_OUTPUT:output}});
  const emitted=await readFile(output,'utf8');return{result,emitted};
 };
 try{
  const absent=await run([]);assert.equal(absent.result.status,0,absent.result.stderr||absent.result.stdout);assert.match(absent.emitted,/source_present=false/u);
  const complete=await run(files);assert.equal(complete.result.status,0,complete.result.stderr||complete.result.stdout);assert.match(complete.emitted,/source_present=true/u);
  for(const partial of [[files[0]!],[files[2]!],[files[0]!,files[1]!,files[3]!]]){
   const result=await run(partial);assert.notEqual(result.result.status,0,'a partial SQL/fixture/test source set must fail closed');
   assert.match(`${result.result.stderr}${result.result.stdout}`,/statement shared-wire source files are incomplete/u);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('workflow shared smoke execution condition selects SQL and neutral runs only for manual opt-in',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const start=workflow.indexOf('          if { [ "$R16_DIAGNOSTIC_MODE" = neutral_only ]');
 assert.ok(start>=0,'native shared smoke execution condition must exist');
 const then=workflow.indexOf(' then',start);assert.ok(then>=0,'native shared smoke execution condition must terminate with then');
 const condition=workflow.slice(start,then+' then'.length);
 const runnable=condition.replace(/\$\{\{\s*inputs\.reserve_shared_smoke\s*\}\}/u,'$RESERVE_SHARED_SMOKE');
 assert.notEqual(runnable,condition,'GitHub input must be parameterized for the isolated Bash check');
 const script=`set -euo pipefail\n${runnable}\n  printf 'smoke_selected\\n'\nfi\n`;
 const cases:[string,string,boolean,string,boolean][]=[
  ['SQL manual opt-in selects the PostgreSQL smoke block','sql_frontier_only',true,'workflow_dispatch',true],
  ['neutral manual opt-in selects the PostgreSQL smoke block','neutral_only',true,'workflow_dispatch',true],
  ['legacy is excluded from shared smoke','legacy',true,'workflow_dispatch',false],
  ['SQL without opt-in is excluded','sql_frontier_only',false,'workflow_dispatch',false],
  ['neutral without opt-in is excluded','neutral_only',false,'workflow_dispatch',false],
  ['SQL pull request is excluded','sql_frontier_only',true,'pull_request',false],
  ['neutral pull request is excluded','neutral_only',true,'pull_request',false],
 ];
 for(const [label,mode,smoke,event,selected] of cases){
  const result=spawnSync('/bin/bash',['-euo','pipefail','-c',script],{encoding:'utf8',env:{PATH:process.env.PATH??'/usr/bin:/bin',
   R16_DIAGNOSTIC_MODE:mode,RESERVE_SHARED_SMOKE:String(smoke),GITHUB_EVENT_NAME:event}});
  assert.equal(result.status,0,`${label}: ${result.stderr||result.stdout}`);
  assert.equal(result.stdout.trim()==='smoke_selected',selected,label);
 }
});

test('workflow input-contract selector and inline TAP gate enforce five cases and the 32-case main census',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const patternMatch=workflow.match(/--test-name-pattern='([^']+)'[\s\\\n]*--test-concurrency=1 --import tsx infrastructure\/db\/migrations\/signal-listening-input-bounds\.postgres\.test\.ts/u);
 assert.ok(patternMatch,'workflow must keep the focused selector on the input-bounds test');
 const selector=new RegExp(patternMatch[1]);
 const gateStart=workflow.indexOf('node - "$R16_RESERVE_INPUT_CONTRACTS_TAP" "$reserve_input_status"');
 assert.ok(gateStart>=0,'inline input-contract TAP gate must exist');
 const heredocStart=workflow.indexOf("<<'NODE'\n",gateStart);assert.ok(heredocStart>=0,'input-contract gate must use its inline Node block');
 const bodyStart=heredocStart+"<<'NODE'\n".length;const bodyEnd=workflow.indexOf('\n          NODE',bodyStart);
 assert.ok(bodyEnd>bodyStart,'input-contract gate heredoc must terminate');
 const gate=workflow.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const expectedMatch=gate.match(/const expected = \[([\s\S]*?)\];/u);assert.ok(expectedMatch,'gate must enumerate exact titles');
 const expected=[...expectedMatch[1].matchAll(/^\s*'([^']+)'[,]?\s*$/gmu)].map(match=>match[1]);
 assert.equal(expected.length,5,'the input-contract gate must require the new fifth selected case');
 assert.deepEqual(expected.filter(title=>selector.test(title)),expected,'the workflow name pattern must select each gated title');
 assert.equal(selector.test('unrelated input-bounds test'),false,'the focused selector must exclude unlisted tests');
 const added='bounded Listening projection preserves 256 native keys, Unicode wire bytes and source timestamp microseconds';
 assert.ok(expected.includes(added),'the exact 256-key/Unicode/timestamp case must be gated');
 assert.ok(workflow.includes('NOISIA_R16_INPUT_BOUNDS_PG: ${{ inputs.reserve_shared_smoke && \'true\' || \'false\' }}'),
  'the existing opt-in must enable the real input-bounds fixture');

 const dir=await mkdtemp(join(tmpdir(),'r16-input-gate-'));const tapPath=join(dir,'input-contract.tap');
 const execute=async(tap:string,status=0)=>{await writeFile(tapPath,tap);return spawnSync(process.execPath,['-',tapPath,String(status)],{encoding:'utf8',input:gate});};
 try{
  const passing=[...expected.map((title,index)=>`ok ${index+1} - ${title}`),'1..5','# tests 5','# pass 5','# fail 0','# cancelled 0','# skipped 0','# todo 0'].join('\n');
  const pass=await execute(passing);assert.equal(pass.status,0,pass.stderr||pass.stdout);
  const skipped=passing.replace(`ok 2 - ${added}`,`ok 2 - ${added} # SKIP not available`)
   .replace('# pass 5','# pass 4').replace('# skipped 0','# skipped 1');
  const skipResult=await execute(skipped);assert.notEqual(skipResult.status,0,'a skipped selected title must fail the exact TAP gate');
  const missing=passing.replace(`ok 2 - ${added}\n`,'').replace('1..5','1..4').replace('# tests 5','# tests 4').replace('# pass 5','# pass 4');
  const missingResult=await execute(missing);assert.notEqual(missingResult.status,0,'an absent selected title must fail the exact TAP gate');
  const failed=await execute(passing,1);assert.notEqual(failed.status,0,'nonzero test process status must fail the exact TAP gate');
 }finally{await rm(dir,{recursive:true,force:true});}

 // Existing workflow gates contribute 26 exact main-job passes; five focused input cases make 31.
 const baselineCounts=[1,3,10,3,2,8];
 assert.ok(workflow.includes('selected.length !== 1')&&workflow.includes('^# tests 3$')
  &&workflow.includes('selected.length !== 10')&&workflow.includes('selected.length !== 2'),
  'the existing oracle, runtime, fence, reader, recovery and reserve gates must remain in the workflow');
 assert.equal(baselineCounts.reduce((sum,count)=>sum+count,0)+expected.length,32,
  'main diagnostic selected-case census must be 32; isolated RAW acceptance contributes six for 38 overall');
});

test('workflow RAW reservation selector and inline TAP gate require both exact cases and preserve the 32/38 census',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const patternMatches=[...workflow.matchAll(/--test-name-pattern='([^']+)'[\s\\\n]*--test-concurrency=1 --import tsx infrastructure\/db\/migrations\/signal-labeling-raw-page-locks\.postgres\.test\.ts/gu)];
 const reservationPattern=patternMatches.find(match=>match[1].includes('generic mass labeling with RAW pages retains its default reservation cursor'));
 assert.ok(reservationPattern,'main workflow must keep a focused selector on the RAW page lock suite');
 const selector=new RegExp(reservationPattern[1]);
 const gateStart=workflow.indexOf('node - "$R16_RESERVE_MONEY_TAP" "$reserve_money_status" "$R16_RESERVE_RAW_PAGE_TAP" "$reserve_raw_status"');
 assert.ok(gateStart>=0,'main RAW reservation TAP gate must exist');
 const heredocStart=workflow.indexOf("<<'NODE'\n",gateStart);assert.ok(heredocStart>=0);
 const bodyStart=heredocStart+"<<'NODE'\n".length;const bodyEnd=workflow.indexOf('\n          NODE',bodyStart);assert.ok(bodyEnd>bodyStart);
 const gate=workflow.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const groupsMatch=gate.match(/const groups = \[([\s\S]*?)\n\s*\];/u);assert.ok(groupsMatch,'TAP gate must enumerate money and RAW selected titles');
 const arrays=[...groupsMatch[1].matchAll(/expected:\s*\[([\s\S]*?)\]/gu)].map(match=>[...match[1].matchAll(/^\s*'([^']+)'[,]?\s*$/gmu)].map(title=>title[1]));
 assert.equal(arrays.length,2);assert.equal(arrays[0]?.length,6);assert.equal(arrays[1]?.length,2);
 const orderTitle='RAW attachment locks UUID order before a blocked last member and leaves disjoint calls compatible';
 assert.deepEqual(arrays[1],['generic mass labeling with RAW pages retains its default reservation cursor',orderTitle]);
 assert.ok(arrays[1]?.every(title=>selector.test(title)),'selector must include both exact gated RAW cases');
 assert.equal(selector.test('unrelated RAW page lock case'),false);
 assert.ok(workflow.includes('reserve shared smoke: 8 exact selected PostgreSQL cases passed'));

 const dir=await mkdtemp(join(tmpdir(),'r16-raw-selector-'));const moneyPath=join(dir,'money.tap'),rawPath=join(dir,'raw.tap');
 const execute=async(money:string,raw:string,moneyStatus=0,rawStatus=0)=>{
  await writeFile(moneyPath,money);await writeFile(rawPath,raw);
  return spawnSync(process.execPath,['-',moneyPath,String(moneyStatus),rawPath,String(rawStatus)],{encoding:'utf8',input:gate});
 };
 try{
  const moneyTap=arrays[0]!.map((title,index)=>`ok ${index+1} - ${title}`).join('\n');
  const rawTap=arrays[1]!.map((title,index)=>`ok ${index+1} - ${title}`).join('\n');
  const pass=await execute(moneyTap,rawTap);assert.equal(pass.status,0,pass.stderr||pass.stdout);
  const skipped=await execute(moneyTap,rawTap.replace(`ok 2 - ${orderTitle}`,`ok 2 - ${orderTitle} # SKIP not available`));
  assert.notEqual(skipped.status,0,'the selected order case cannot be skipped');
  const missing=await execute(moneyTap,rawTap.replace(`ok 2 - ${orderTitle}`,''));
  assert.notEqual(missing.status,0,'the order case must be present exactly once');
  const failed=await execute(moneyTap,rawTap,0,1);assert.notEqual(failed.status,0,'nonzero RAW TAP process status must fail the gate');
 }finally{await rm(dir,{recursive:true,force:true});}
 const priorOtherMainCases=1+3+10+3+2;
 assert.equal(priorOtherMainCases+arrays[0]!.length+arrays[1]!.length+5,32,
  'main selected census must be 32; six isolated RAW cases make 38');
});

test('RAW attach acceptance runs only in its isolated job and main job consumes exact evidence',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const rawStart=workflow.indexOf('\n  raw-acceptance:\n');assert.ok(rawStart>=0,'isolated RAW acceptance job must exist');
 const mainStart=workflow.indexOf('\n  listening-small:\n',rawStart);assert.ok(mainStart>rawStart,'main listening diagnostic job must follow RAW acceptance');
 const rawJob=workflow.slice(rawStart,mainStart);
 const mainJob=workflow.slice(mainStart);
 for(const forbidden of ['signal-labeling-raw-attach.postgres.test.ts','NOISIA_R16_RAW_ATTACH_ORACLE_PG',
  'R16_RESERVE_RAW_ATTACH_ORACLE_TAP','reserve-shared-raw-attach-oracle.tap'])
  assert.ok(!mainJob.includes(forbidden),`main diagnostic must not run or publish isolated RAW attach oracle: ${forbidden}`);
 assert.ok(rawJob.includes('signal-labeling-raw-attach.postgres.test.ts'),'isolated job must run the real RAW attach fixture');
 assert.ok(rawJob.includes("NOISIA_R16_RAW_ATTACH_ORACLE_PG: 'true'"),'isolated attach oracle flag must be enabled');
 assert.ok(rawJob.includes("NOISIA_R16_RAW_PAGE_LOCKS_PG: 'true'"),'isolated fault cases must enable the RAW page lock fixture');
 for(const title of [
  'raw rollback recovery preserves exact bytes and existing budget',
  'raw commit_ack recovery preserves exact bytes and existing budget',
  'RAW page rejects a digest conflict without mutating a valid sibling',
  'RAW page rejects a raw conflict without mutating a valid sibling',
  'RAW attach layout720 original and page map preserve native rows among 4128 calls',
  'RAW attach layout4096 original and page map preserve native rows among 4128 calls',
 ]) assert.ok(rawJob.includes(title),`isolated job must gate the exact selected case: ${title}`);
 assert.ok(rawJob.includes("/^# pass 4$/mu.test(tap)")&&rawJob.includes("/^# fail 0$/mu.test(tap)"),
  'four RAW fault cases must have a passing TAP gate');
 assert.ok(rawJob.includes("/^# tests 2$/mu.test(tap)")&&rawJob.includes("/^# pass 2$/mu.test(tap)")
  &&rawJob.includes("/^# fail 0$/mu.test(tap)")&&rawJob.includes("/^# skipped 0$/mu.test(tap)"),
  'two RAW attach cases must have an exact no-skip TAP gate');
 assert.ok(mainJob.includes('needs: [raw-acceptance, projection-linear-acceptance, statement-shared-wire-acceptance]'),'main job must wait for all isolated evidence jobs');
 assert.ok(mainJob.includes("needs.raw-acceptance.result == 'success'")&&mainJob.includes("needs.projection-linear-acceptance.result == 'success'"),
  'main job must fail closed when either requested acceptance job fails');
 assert.ok(mainJob.includes("RAW_ACCEPTANCE_SELECTED_PASS: ${{ needs.raw-acceptance.outputs.selected_pass || '0' }}")
  &&mainJob.includes("RAW_ACCEPTANCE_TARGET_SHA: ${{ needs.raw-acceptance.outputs.target_sha || '' }}"),
  'main resource guard must consume the isolated job outputs');
});

test('projection linear-joins acceptance is opt-in, isolated, source-sealed and gates the 41-case total',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 assert.match(workflow,/projection_linear_oracle:\r?\n\s+type: boolean\r?\n\s+default: false/u);
 const rawStart=workflow.indexOf('\n  raw-acceptance:\n'),linearStart=workflow.indexOf('\n  projection-linear-acceptance:\n'),mainStart=workflow.indexOf('\n  listening-small:\n',linearStart);
 assert.ok(rawStart>=0&&linearStart>rawStart&&mainStart>linearStart,'linear oracle job must follow RAW acceptance and precede main diagnostic');
 const linearJob=workflow.slice(linearStart,mainStart),mainJob=workflow.slice(mainStart);
 assert.match(linearJob,/needs: raw-acceptance/u);
 assert.match(linearJob,/inputs\.projection_linear_oracle == true[\s\S]*?github\.event_name == 'workflow_dispatch'[\s\S]*?inputs\.reserve_shared_smoke == true[\s\S]*?inputs\.mode == 'neutral_only'[\s\S]*?inputs\.mode == 'sql_frontier_only'/u);
 assert.match(linearJob,/TARGET_REF[\s\S]*?\^\[0-9a-f\]\{40\}\$/u);
 assert.ok(linearJob.includes('[ "$RAW_ACCEPTANCE_SELECTED_PASS" != 6 ]'));
 assert.match(linearJob,/selected_pass: \$\{\{ steps\.publish\.outputs\.selected_pass \|\| '0' \}\}[\s\S]*?target_sha: \$\{\{ steps\.publish\.outputs\.target_sha \|\| '' \}\}/u);
 assert.match(linearJob,/steps\.oracle\.outcome == 'success'[\s\S]*?steps\.source_end\.outcome == 'success'[\s\S]*?selected_pass=3[\s\S]*?target_sha=%s/u);
 assert.match(mainJob,/needs: \[raw-acceptance, projection-linear-acceptance, statement-shared-wire-acceptance\]/u);
 assert.match(mainJob,/LINEAR_ACCEPTANCE_SELECTED_PASS: \$\{\{ needs\.projection-linear-acceptance\.outputs\.selected_pass \|\| '0' \}\}/u);
 assert.match(mainJob,/LINEAR_ACCEPTANCE_TARGET_SHA: \$\{\{ needs\.projection-linear-acceptance\.outputs\.target_sha \|\| '' \}\}/u);
 assert.ok(mainJob.includes('[ "$LINEAR_ACCEPTANCE_SELECTED_PASS" != 3 ]')
  &&mainJob.includes('[ "$LINEAR_ACCEPTANCE_TARGET_SHA" != "$TARGET_REF" ]'));
 for(const forbidden of ['signal-listening-projection-linear-joins.postgres.test.ts','NOISIA_R16_PROJECTION_LINEAR_JOINS_PG','R16_PROJECTION_LINEAR_TAP'])
  assert.equal(mainJob.includes(forbidden),false,`main job must consume only evidence, not rerun the isolated oracle: ${forbidden}`);
 const patternMatch=linearJob.match(/--test-name-pattern='([^']+)'[\s\\\n]*--import tsx infrastructure\/db\/migrations\/signal-listening-projection-linear-joins\.postgres\.test\.ts/u);
 assert.ok(patternMatch);const selector=new RegExp(patternMatch[1]);
 const tapStart=linearJob.indexOf('node - "$R16_PROJECTION_LINEAR_TAP" "$test_status"');assert.ok(tapStart>=0);
 const heredocStart=linearJob.indexOf("<<'NODE'\n",tapStart),bodyStart=heredocStart+"<<'NODE'\n".length,bodyEnd=linearJob.indexOf('\n          NODE',bodyStart);
 assert.ok(heredocStart>=0&&bodyEnd>bodyStart);const gate=linearJob.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const expectedMatch=gate.match(/const expected = \[([\s\S]*?)\];/u);assert.ok(expectedMatch);
 const expected=[...expectedMatch[1].matchAll(/^\s*'([^']+)'[,]?\s*$/gmu)].map(match=>match[1]);
 assert.equal(expected.length,3);assert.ok(expected.every(title=>selector.test(title)));
 assert.match(linearJob,/\^# tests 3\$[\s\S]*?\^# pass 3\$[\s\S]*?\^# fail 0\$[\s\S]*?\^# skipped 0\$/u);
 const priorMain=1+3+10+3+2+8+5;assert.equal(priorMain,32);
 assert.equal(priorMain+6+expected.length,41,'opt-in run must select 32 main + six RAW + three projection cases');
 assert.equal(32+6,38,'default remains the prior 32 main + six RAW cases');
});

test('MFP RAW acceptance workflow selects and gates the fifth UUID-order case without accepting skips',async()=>{
 const workflowPath=new URL('../../../.github/workflows/mfp-postgres.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const patternMatch=workflow.match(/--test-name-pattern='([^']+)'[\s\\\n]*--import tsx infrastructure\/db\/migrations\/signal-labeling-raw-page-locks\.postgres\.test\.ts/u);
 assert.ok(patternMatch,'MFP raw-page acceptance must select the focused lock suite');
 const selector=new RegExp(patternMatch[1]);
 const start=workflow.indexOf('node - "$R16_RAW_PAGE_ACCEPTANCE_FAULT_TAP" "$test_status"');
 assert.ok(start>=0,'MFP isolated fault TAP gate must exist');
 const heredocStart=workflow.indexOf("<<'NODE'\n",start);assert.ok(heredocStart>=0);
 const bodyStart=heredocStart+"<<'NODE'\n".length;const bodyEnd=workflow.indexOf('\n          NODE',bodyStart);assert.ok(bodyEnd>bodyStart);
 const gate=workflow.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const expectedMatch=gate.match(/const expected = \[([\s\S]*?)\];/u);assert.ok(expectedMatch);
 const expected=[...expectedMatch[1].matchAll(/^\s*'([^']+)'[,]?\s*$/gmu)].map(match=>match[1]);
 const orderTitle='RAW attachment locks UUID order before a blocked last member and leaves disjoint calls compatible';
 assert.equal(expected.length,5);assert.ok(expected.includes(orderTitle));
 assert.ok(expected.every(title=>selector.test(title)),'MFP name pattern must select all five titles');
 const dir=await mkdtemp(join(tmpdir(),'r16-mfp-raw-gate-'));const tapPath=join(dir,'raw-page.tap');
 const execute=async(tap:string,status=0)=>{await writeFile(tapPath,tap);return spawnSync(process.execPath,['-',tapPath,String(status)],{encoding:'utf8',input:gate});};
 try{
  const passing=[...expected.map((title,index)=>`ok ${index+1} - ${title}`),'# pass 5','# fail 0'].join('\n');
  const pass=await execute(passing);assert.equal(pass.status,0,pass.stderr||pass.stdout);
  const skipped=await execute(passing.replace(`ok 5 - ${orderTitle}`,`ok 5 - ${orderTitle} # SKIP unavailable`).replace('# pass 5','# pass 4'));
  assert.notEqual(skipped.status,0,'MFP must reject a skipped UUID-order case');
  const missing=await execute(passing.replace(`ok 5 - ${orderTitle}\n`,''));
  assert.notEqual(missing.status,0,'MFP must reject a missing UUID-order case');
  const failed=await execute(passing,1);assert.notEqual(failed.status,0,'MFP must reject a nonzero test process status');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('MFP projection linear-joins oracle uses an isolated offline-runtime lab and exact three-case TAP gate',async()=>{
 const workflowPath=new URL('../../../.github/workflows/mfp-postgres.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const start=workflow.indexOf('\n  projection-linear-joins:\n');assert.ok(start>=0,'dedicated projection linear-joins job must exist');
 const job=workflow.slice(start);
 assert.match(job,/needs: raw-page-acceptance/u);assert.match(job,/if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.scope == 'full' \|\| inputs\.scope == 'listening-smoke' \}\}/u);
 assert.match(job,/actions\/setup-python@v5[\s\S]*?python-version: '3\.12'[\s\S]*?requirements-workspace-engine\.txt/u);
 assert.match(job,/Install the offline workspace numerical runtime[\s\S]*?pip install --no-deps -r services\/workers\/requirements-workspace-engine\.txt[\s\S]*?pytest==8\.3\.5/u);
 assert.match(job,/HF_HUB_OFFLINE: '1'[\s\S]*?TRANSFORMERS_OFFLINE: '1'[\s\S]*?NUMBA_NUM_THREADS: '1'[\s\S]*?OPENBLAS_NUM_THREADS: '1'[\s\S]*?MKL_NUM_THREADS: '1'/u);
 assert.match(job,/R16_PROJECTION_LINEAR_SOURCE_SHA/u);assert.match(job,/git status --porcelain --untracked-files=all/u);
 assert.match(job,/NOISIA_R16_PROJECTION_LINEAR_JOINS_PG: 'true'/u);assert.match(job,/signal-listening-projection-linear-joins\.postgres\.test\.ts/u);
 assert.match(job,/Start the owned PostgreSQL 17 and Redis lab[\s\S]*?Apply migrations to the fresh projection linear-joins lab[\s\S]*?Run the exact projection linear-joins oracle cases/u);
 assert.match(job,/Stop and remove only the owned projection linear-joins lab/u);
 const patternMatch=job.match(/--test-name-pattern='([^']+)'[\s\\\n]*--import tsx infrastructure\/db\/migrations\/signal-listening-projection-linear-joins\.postgres\.test\.ts/u);
 assert.ok(patternMatch,'MFP job must select the exact source-native projection oracle tests');const selector=new RegExp(patternMatch[1]);
 const gateStart=job.indexOf('node - "$R16_PROJECTION_LINEAR_TAP" "$test_status"');assert.ok(gateStart>=0);
 const heredocStart=job.indexOf("<<'NODE'\n",gateStart),bodyStart=heredocStart+"<<'NODE'\n".length,bodyEnd=job.indexOf('\n          NODE',bodyStart);
 assert.ok(heredocStart>=0&&bodyEnd>bodyStart);const gate=job.slice(bodyStart,bodyEnd).split(/\r?\n/u).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const expectedMatch=gate.match(/const expected = \[([\s\S]*?)\];/u);assert.ok(expectedMatch);
 const expected=[...expectedMatch[1].matchAll(/^\s*'([^']+)'[,]?\s*$/gmu)].map(match=>match[1]);
 assert.deepEqual(expected,[
  'projection linear joins native preserves256keys, Unicode microseconds, byte sentinels, reservations and rights',
  'projection linear joins native preserves awaiting/excluded, H5 precedence and a global byte prefix across pages',
  'projection linear joins native4096 paired RRRO preserves rows and removes both materialized CTE rescans',
 ]);
 assert.ok(expected.every(title=>selector.test(title)));assert.equal(selector.test('unselected projection test'),false);
 const dir=await mkdtemp(join(tmpdir(),'r16-mfp-projection-linear-'));const tapPath=join(dir,'linear.tap');
 const execute=async(tap:string,status=0)=>{await writeFile(tapPath,tap);return spawnSync(process.execPath,['-',tapPath,String(status)],{encoding:'utf8',input:gate});};
 try{
  const passing=[...expected.map((title,index)=>`ok ${index+1} - ${title}`),'# tests 3','# pass 3','# fail 0','# skipped 0'].join('\n');
  assert.equal((await execute(passing)).status,0);
  assert.notEqual((await execute(passing.replace(`ok 3 - ${expected[2]}`,`ok 3 - ${expected[2]} # SKIP unavailable`).replace('# pass 3','# pass 2').replace('# skipped 0','# skipped 1'))).status,0);
  assert.notEqual((await execute(passing.replace(`ok 2 - ${expected[1]}\n`,''))).status,0);
  assert.notEqual((await execute(passing,1)).status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('probe sparse checkout materializes the MFP workflow used by the source-contract gate',async()=>{
 const workflowPath=new URL('../../../.github/workflows/r16-listening-small-diagnostic.yml',import.meta.url);
 const workflow=await readFile(workflowPath,'utf8');
 const checkoutName='      - name: Checkout diagnostic harness only\n';
 const checkoutStart=workflow.indexOf(checkoutName);assert.ok(checkoutStart>=0,'diagnostic harness checkout must exist');
 const nextStep=workflow.indexOf('\n      - name: ',checkoutStart+checkoutName.length);
 const checkout=workflow.slice(checkoutStart,nextStep<0?undefined:nextStep);
 assert.match(checkout,/uses: actions\/checkout@v4/u);
 assert.match(checkout,/path: probe\s*$/mu,'the harness checkout must remain rooted at probe');
 const sparse=checkout.match(/\n          sparse-checkout: \|\n((?:            [^\n]*\n)+)/u);
 assert.ok(sparse,'the probe checkout must declare its sparse paths');
 const paths=sparse[1].split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
 const assertMfpWorkflowMaterialized=(entries:string[])=>assert.ok(entries.includes('.github/workflows/mfp-postgres.yml'),
  'the probe checkout must include the MFP workflow read by its acceptance test');
 assertMfpWorkflowMaterialized(paths);
 assert.throws(()=>assertMfpWorkflowMaterialized(paths.filter(path=>path!=='.github/workflows/mfp-postgres.yml')),
  /probe checkout must include the MFP workflow/u,'the previous sparse checkout must fail this regression assertion');
});

test('resource profile guard rejects environment and effective tuple drift without allocating the profile budget',async()=>{
 const {getExecution,envFor}=await streamProfileDependencies();const env=envFor('baseline_512m');
 env.NOISIA_JEV_STREAM_MAX_IN_FLIGHT='2048';
 assert.throws(()=>assertListeningResourceProfileV1('baseline_512m','legacy',env,getExecution),/stream_environment_profile_mismatch/u);
 const correct=envFor('baseline_512m');
 assert.throws(()=>assertListeningResourceProfileV1('baseline_512m','legacy',correct,current=>({...getExecution(current),max_in_flight:2048})),/stream_execution_profile_mismatch/u);
});

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
    R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_CPU_PROFILE_DIR:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate',
    DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',
    R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/artifact_path_not_bound/u);
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/target';
  env.R16_DIAGNOSTIC_ARTIFACT='/tmp/work/artifacts/r16-listening-small/result.json';
  assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
  env.R16_DIAGNOSTIC_CPU_PROFILE_DIR='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/cpu_profile_path_not_bound/u);
  env.R16_DIAGNOSTIC_CPU_PROFILE_DIR='/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate';
  env.R16_DIAGNOSTIC_TARGET_ROOT='/tmp/work/elsewhere';
  assert.throws(()=>assertListeningSmallGuardV1(env,['--run']),/target_root_outside_workspace/u);
});

test('SQL frontier mode is manual candidate-only with an explicit immutable target ref and no profiler',()=>{
 assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'sql_frontier_only'}),'sql_frontier_only');
 assert.doesNotThrow(()=>assertDiagnosticExecArgsV1('sql_frontier_only',['--import','tsx'],'/unused'));
 assert.throws(()=>assertDiagnosticExecArgsV1('sql_frontier_only',['--cpu-prof'],'/unused'),/profiler_forbidden/u);
 const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',NOISIA_R16_SMALL_DIAGNOSTIC:'true',
  R16_DIAGNOSTIC_MODE:'sql_frontier_only',R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'c'.repeat(40),
  GITHUB_WORKSPACE:'/tmp/work',R16_DIAGNOSTIC_TARGET_ROOT:'/tmp/work/target',R16_DIAGNOSTIC_PROBE_ROOT:'/tmp/work/probe',
  R16_DIAGNOSTIC_PROBE_REF_REQUESTED:'b'.repeat(40),R16_DIAGNOSTIC_ARTIFACT:'/tmp/work/artifacts/r16-listening-small/result.json',
  R16_DIAGNOSTIC_CPU_PROFILE_DIR:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate',
  DATABASE_URL:'postgresql://postgres:pw@127.0.0.1:5432/noisia_mfp_ci',R16BENCH_REDIS_URL:'redis://127.0.0.1:6379'};
 assert.doesNotThrow(()=>assertListeningSmallGuardV1(env,['--run']));
 const projectionEnv={...env,R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'true',RESERVE_SHARED_SMOKE:'true',
  RAW_ACCEPTANCE_SELECTED_PASS:'6',RAW_ACCEPTANCE_TARGET_SHA:'c'.repeat(40)};
 assert.doesNotThrow(()=>assertListeningSmallGuardV1(projectionEnv,['--run']));
 assert.throws(()=>assertListeningSmallGuardV1({...projectionEnv,R16_DIAGNOSTIC_MODE:'neutral_only'},['--run']),/projection_plan_requires_sql_frontier/u);
 assert.throws(()=>assertListeningSmallGuardV1({...projectionEnv,RESERVE_SHARED_SMOKE:'false'},['--run']),/projection_plan_requires_shared_smoke/u);
 assert.throws(()=>assertListeningSmallGuardV1({...projectionEnv,RAW_ACCEPTANCE_SELECTED_PASS:'5'},['--run']),/projection_plan_requires_raw_acceptance/u);
 assert.throws(()=>assertListeningSmallGuardV1({...projectionEnv,RAW_ACCEPTANCE_TARGET_SHA:'d'.repeat(40)},['--run']),/projection_plan_raw_target_mismatch/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'yes'},['--run']),/projection_plan_flag_invalid/u);
 const linearEnv={...env,RESERVE_SHARED_SMOKE:'true',RAW_ACCEPTANCE_SELECTED_PASS:'6',RAW_ACCEPTANCE_TARGET_SHA:'c'.repeat(40),
  R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'true',LINEAR_ACCEPTANCE_SELECTED_PASS:'3',LINEAR_ACCEPTANCE_TARGET_SHA:'c'.repeat(40)};
 assert.doesNotThrow(()=>assertListeningSmallGuardV1(linearEnv,['--run']));
 assert.doesNotThrow(()=>assertListeningSmallGuardV1({...linearEnv,R16_DIAGNOSTIC_MODE:'neutral_only'},['--run']));
 assert.throws(()=>assertListeningSmallGuardV1({...linearEnv,R16_DIAGNOSTIC_MODE:'legacy'},['--run']),/projection_linear_oracle_mode_invalid/u);
 assert.throws(()=>assertListeningSmallGuardV1({...linearEnv,LINEAR_ACCEPTANCE_SELECTED_PASS:'2'},['--run']),/projection_linear_oracle_requires_linear_acceptance/u);
 assert.throws(()=>assertListeningSmallGuardV1({...linearEnv,LINEAR_ACCEPTANCE_TARGET_SHA:'d'.repeat(40)},['--run']),/projection_linear_oracle_target_mismatch/u);
 assert.throws(()=>assertListeningSmallGuardV1({...linearEnv,RESERVE_SHARED_SMOKE:'false'},['--run']),/projection_linear_oracle_requires_shared_smoke/u);
 assert.throws(()=>assertListeningSmallGuardV1({...linearEnv,R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'on'},['--run']),/projection_linear_oracle_flag_invalid/u);
 const sharedWireEnv={...linearEnv,R16_DIAGNOSTIC_STATEMENT_SHARED_WIRE_ORACLE:'true',STATEMENT_SHARED_WIRE_SELECTED_PASS:'5',STATEMENT_SHARED_WIRE_TARGET_SHA:'c'.repeat(40)};
 assert.doesNotThrow(()=>assertListeningSmallGuardV1(sharedWireEnv,['--run']));
 assert.doesNotThrow(()=>assertListeningSmallGuardV1({...sharedWireEnv,R16_DIAGNOSTIC_MODE:'neutral_only'},['--run']));
 assert.throws(()=>assertListeningSmallGuardV1({...sharedWireEnv,R16_DIAGNOSTIC_MODE:'legacy',R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false'},['--run']),/statement_shared_wire_oracle_mode_invalid/u);
 assert.throws(()=>assertListeningSmallGuardV1({...sharedWireEnv,STATEMENT_SHARED_WIRE_SELECTED_PASS:'4'},['--run']),/statement_shared_wire_oracle_requires_five_cases/u);
 assert.throws(()=>assertListeningSmallGuardV1({...sharedWireEnv,STATEMENT_SHARED_WIRE_TARGET_SHA:'d'.repeat(40)},['--run']),/statement_shared_wire_oracle_target_mismatch/u);
 assert.throws(()=>assertListeningSmallGuardV1({...sharedWireEnv,R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false'},['--run']),/statement_shared_wire_oracle_requires_projection_linear_oracle/u);
 assert.throws(()=>assertListeningSmallGuardV1({...sharedWireEnv,R16_DIAGNOSTIC_STATEMENT_SHARED_WIRE_ORACLE:'on'},['--run']),/statement_shared_wire_oracle_flag_invalid/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,GITHUB_EVENT_NAME:'pull_request'},['--run']),/sql_frontier_requires_manual_dispatch/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,R16_DIAGNOSTIC_TARGET_LABEL:'baseline-32f'},['--run']),/sql_frontier_requires_candidate_target/u);
 assert.throws(()=>assertListeningSmallGuardV1({...env,R16_DIAGNOSTIC_TARGET_REF_REQUESTED:''},['--run']),/target_ref_required/u);
});

test('CPU profile metadata is PID-scoped, bounded to CPU sampling, and records classification clocks',()=>{
 const execArgs=['--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir=/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate','--import','tsx'];
 assert.doesNotThrow(()=>assertCpuProfilerArgsV1(execArgs,'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'));
 assert.throws(()=>assertCpuProfilerArgsV1(execArgs.filter(arg=>arg!=='--cpu-prof'),'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'),/cpu_profile_not_enabled/u);
 assert.throws(()=>assertCpuProfilerArgsV1([...execArgs,'--heap-prof'],'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'),/heap_profile_forbidden/u);
 const clock=classificationClockMetadataV1({hrtime_origin_ns:'500000',start_hrtime_ns:'501000',end_hrtime_ns:'601000',
   performance_time_origin_ms:1_700_000_000_000,start_performance_ms:1,end_performance_ms:101});
 assert.deepEqual(clock,{clock_axis:'linux_runner_node_hrtime_monotonic_ns',runner_hrtime_origin_ns:'500000',
   classification_start_hrtime_ns:'501000',classification_end_hrtime_ns:'601000',performance_time_origin_ms:1_700_000_000_000,
   classification_start_performance_ms:1,classification_end_performance_ms:101,v8_profile_clock_bridge:'unknown',
   classification_profile_overlap:'unknown_no_cross_clock_truncation'});
 assert.deepEqual(cpuProfileMetadataV1({main_pid:12,sampler_pid:13,clock,exec_args:execArgs,
   profile_dir:'/tmp/work/artifacts/r16-listening-small/cpu-profile-candidate'}),{
  enabled:true,profiler:'node_cpu_prof',interval_us:1000,main_process_pid:12,sampler_process_pid:13,
  clock,output:'pid_scoped_cpu_profiles_only',
  heap_profile:false,source_text_embedded:false,overhead_measured:false,capacity_claim:false,
 });
 assert.throws(()=>classificationClockMetadataV1({hrtime_origin_ns:'500000',start_hrtime_ns:'601000',end_hrtime_ns:'501000',
   performance_time_origin_ms:1_700_000_000_000,start_performance_ms:101,end_performance_ms:1}),/classification_clock_invalid/u);
});

test('CPU profiles admit bounded worker threads only for the recorded PIDs and validate V8 time coverage',()=>{
 assert.deepEqual(cpuProfileIdentityV1('CPU.20261115.123456.12.0.0.cpuprofile',12,13),
   {filename:'CPU.20261115.123456.12.0.0.cpuprofile',pid:12,tid:0,sequence:0,role:'runner'});
 assert.equal(cpuProfileIdentityV1('CPU.20261115.123456.12.2.0.cpuprofile',12,13).role,'runner_worker_thread');
 assert.equal(cpuProfileIdentityV1('CPU.20261115.123456.13.1.0.cpuprofile',12,13).role,'sampler_worker_thread');
 assert.throws(()=>cpuProfileIdentityV1('CPU.20261115.123456.99.0.0.cpuprofile',12,13),/foreign_process/u);
 const range=cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1000,1000],startTime:1_000_000,endTime:1_002_000});
 assert.deepEqual(range,{profile_start_time_us:1_000_000,profile_end_time_us:1_002_000,profile_duration_us:2000,
   sampled_time_delta_us:2000,profile_sample_coverage:'v8_range_validated'});
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1],timeDeltas:[1000],startTime:5,endTime:5}),/time_range_invalid/u);
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1000],startTime:1_000_000,endTime:1_002_000}),/delta_count_mismatch/u);
 assert.throws(()=>cpuProfileRangeV1({nodes:[],samples:[1,2],timeDeltas:[1_000_000,1_000_000],startTime:1_000_000,endTime:1_002_000}),/does_not_cover_samples/u);
});

test('synthetic HTTP witness correlates evaluate admission to fetches and keeps token evidence value-free',async()=>{
 const configuredEnv={NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({synthetic_digest:{kind:'measured',source:'private calibration source'}})};
 assert.equal(tokenCalibrationKindFromEnvV1(configuredEnv),'measured');
 assert.equal(tokenCalibrationKindFromEnvV1({NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:'{}'}),null);
 assert.equal(tokenCalibrationKindFromEnvV1({NOISIA_JEV_TOKEN_CALIBRATIONS_JSON:JSON.stringify({a:{kind:'measured'},b:{kind:'official_context_bound'}})}),null);
 let fakeFetches=0;
 const witness=createJevHttpTokenWitnessV1(()=>performance.now(),32);
 const fakeFetch=witness.wrapFetch(async()=>{fakeFetches++;await new Promise(resolve=>setTimeout(resolve,8));
  if(fakeFetches===3)throw Error('synthetic private error');return new Response('synthetic response');});
 const raws=[
  {body:'private body A',http_status:200,latency_ms:8,rate_reservation:{id:'private-reservation-a',estimated_input_tokens:302},rate_calibration:{labeler_digest:'private-digest-a',input_bytes:900,kind:'measured'}},
  {body:'private body B',http_status:200,latency_ms:8,rate_reservation:{id:'private-reservation-b',estimated_input_tokens:250},rate_calibration:{labeler_digest:'private-digest-b',input_bytes:700,kind:'measured'}},
 ];
 const lifecycle:string[]=[];
 const originalProvider={max_concurrency:64,max_response_bytes:16384,close:async()=>{lifecycle.push('close');},
  observeUsage:async()=>{lifecycle.push('usage');},async evaluate(request:any){
   if(request.fail){await fakeFetch('https://private.invalid',{body:'private fetch body'});throw Error('synthetic private error');}
   await fakeFetch('https://private.invalid',{body:'private fetch body'});return raws[request.index];
  }};
 const measured=witness.wrapProvider(originalProvider,tokenCalibrationKindFromEnvV1(configuredEnv));
 assert.equal(measured.max_concurrency,64);assert.equal(measured.max_response_bytes,16384);
 const [resultA,resultB]=await Promise.all([measured.evaluate({index:0}),measured.evaluate({index:1})]);
 assert.equal(resultA,raws[0]);assert.equal(resultB,raws[1]);
 await measured.observeUsage?.(resultA as any,241);await measured.close?.();
 const errorProvider=witness.wrapProvider({...originalProvider,async evaluate(){
   await fakeFetch('https://private.invalid',{body:'private fetch body'});throw Error('synthetic private error');
  }},null);
 await assert.rejects(errorProvider.evaluate({fail:true}),/synthetic private error/u);
 const snapshot=witness.snapshot(),serialized=JSON.stringify(snapshot);
 assert.equal(fakeFetches,3);assert.equal(snapshot.evaluations_started,3);assert.equal(snapshot.evaluations_completed,2);
 assert.equal(snapshot.evaluation_errors,1);assert.equal(snapshot.evaluations_without_fetch,0);
 assert.equal(snapshot.fetches_started,3);assert.equal(snapshot.fetches_completed,2);
 assert.equal(snapshot.fetch_errors,1);assert.equal(snapshot.active_fetches,0);assert.equal(snapshot.peak_active_fetches,2);
 assert.equal(snapshot.max_fetch_starts_in_rolling_second,3);assert.equal(snapshot.pre_fetch_admission_ms.count,3);
 assert.equal(snapshot.reservation_estimate.count,2);assert.equal(snapshot.reservation_estimate.missing,0);
 assert.equal(snapshot.reservation_estimate.min,250);assert.equal(snapshot.reservation_estimate.max,302);assert.equal(snapshot.reservation_estimate.total,552);
 assert.equal(snapshot.calibration_kind_counts.measured,2);assert.equal(snapshot.calibration_kind_missing,0);
 assert.equal(snapshot.events.length,9);assert.equal(snapshot.events_dropped,0);assert.deepEqual(lifecycle,['usage','close']);
 const evaluations=snapshot.events.filter(event=>event.event.startsWith('evaluate_')).sort((a,b)=>a.sequence-b.sequence);
 assert.deepEqual(evaluations.map(event=>[event.sequence,event.event,event.estimated_input_tokens]),[
  [1,'evaluate_complete',302],[2,'evaluate_complete',250],[3,'evaluate_error',null],
 ]);
 for(const secret of ['private.invalid','private fetch body','private body A','private-reservation-a','private-digest-a','private calibration source','synthetic private error'])
  assert.ok(!serialized.includes(secret));
 assert.ok(snapshot.events.every(event=>Object.keys(event).every(key=>['sequence','event','at_ms','active_fetches','pre_fetch_admission_ms','fetch_duration_ms',
  'estimated_input_tokens','reservation_estimate_status','calibration_kind','calibration_kind_source'].includes(key))));
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
 const {createListeningObserver,projectObserverTimeToPerformanceRangeV1,queryHash}=await import('./observer.mjs');const observer=createListeningObserver();
 try{const db=observer.wrapDatabase({async query(){return{rows:[{secret:'never record'}]};}});
 const store=observer.wrapStore({async inputs(){return db.query('SELECT private_value FROM synthetic WHERE credential=$1',['secret-bind']);}});
 await store.inputs();const snapshot=observer.snapshot(),serialized=JSON.stringify(snapshot);
 assert.ok(serialized.includes(queryHash('SELECT private_value FROM synthetic WHERE credential=$1')!));
 for(const forbidden of ['private_value','credential','secret-bind','never record'])assert.ok(!serialized.includes(forbidden));
 const events=snapshot.events as any[];assert.equal(events.filter(x=>x.kind==='query').length,1);assert.equal(events.find(x=>x.kind==='query').operation,'inputs');
 assert.equal(events.find(x=>x.kind==='query').pid,null);assert.ok(events.filter(x=>x.kind==='query'||x.kind==='store').every(x=>x.end_ms>=x.start_ms));
 const anchor=(snapshot as any).clock_anchor;assert.match(anchor.hrtime_origin_ns,/^\d+$/u);assert.equal(anchor.hrtime_origin_unit,'nanoseconds');
 assert.equal(anchor.event_offset_unit,'milliseconds');assert.ok(anchor.performance_after_ms>=anchor.performance_before_ms);
 assert.equal(anchor.uncertainty_ms,anchor.performance_after_ms-anchor.performance_before_ms);
 assert.equal(anchor.projection,'[performance_before_ms + event_offset_ms, performance_after_ms + event_offset_ms]');
 const event=events.find(x=>x.kind==='query'),projected=projectObserverTimeToPerformanceRangeV1(anchor,event.start_ms);
 assert.ok(projected.end_performance_ms>=projected.start_performance_ms);
 assert.equal(projected.uncertainty_ms,anchor.uncertainty_ms);
 }finally{await observer.close();}
});

test('observer clock projection preserves a bounded interval without fabricating an offset',async()=>{
 const {projectObserverTimeToPerformanceRangeV1}=await import('./observer.mjs');
 assert.deepEqual(projectObserverTimeToPerformanceRangeV1({performance_before_ms:100.25,performance_after_ms:100.5},25),
  {start_performance_ms:125.25,end_performance_ms:125.5,uncertainty_ms:.25});
 assert.throws(()=>projectObserverTimeToPerformanceRangeV1({performance_before_ms:100.5,performance_after_ms:100.25},25),/anchor_invalid/u);
 assert.throws(()=>projectObserverTimeToPerformanceRangeV1({performance_before_ms:100,performance_after_ms:101},-1),/anchor_invalid/u);
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
 assert.equal(observer.snapshot().sampler_process_pid,null);
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
 assert.equal(innerPlanQueryLabel('sha256:8ea420589c30b27ac581ade8d7fe31c467e50d5b96abc4a96358a3133b517a66'),'metadata');
 assert.equal(innerPlanQueryLabel('sha256:8fdf796e82ccd9b4528996c607536f72bd5992946d6d3c21f0daf1700ea97d84'),'hydrate');
 assert.equal(innerPlanQueryLabel('sha256:unknown'),null);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:'on',superuser:true},'noisia_mfp_ci','postgres'),true);
 assert.equal(verifiedInnerPlanScopeV1({database:'noisia_mfp_ci',role:'postgres',isolation:'read committed',read_only:'off',superuser:true},'noisia_mfp_ci','postgres'),false);
});

type BoundedInputSourcePathV1='private_projection'|'bounded_metadata';
function assertBoundedInputCaptureScopeV1(labeling:string,listening:string,projection:string):BoundedInputSourcePathV1{
 const fail=():never=>{throw Error('capture_scope_contract_invalid');};
 const transaction=labeling.match(/async function tx<T>\([\s\S]*?\n\}/u)?.[0];
 if(!transaction||!transaction.includes('const c = await db.connect()')||!transaction.includes('await c.query("BEGIN")')
  ||transaction.indexOf('await c.query("BEGIN")')>transaction.indexOf('await fn(c)')
  ||!transaction.includes('await c.query("COMMIT")')||!transaction.includes('c.release()'))return fail();
 const method=labeling.match(/async inputs\(run:\s*LabelingRunV1,\s*bounds\?:\s*LabelingInputBoundsV1\)\s*\{([\s\S]*?)\n\s*async reserve\(/u)?.[1];
 if(!method)return fail();
 const branchStart=method.indexOf('if(bounds){'),fallback=method.indexOf('if (options.adapter) return options.adapter.inputs(db, run);');
 if(branchStart<0||fallback<0||branchStart>=fallback)return fail();
 const branch=method.slice(branchStart,fallback);
 const validate=branch.indexOf('validateLabelingInputBoundsV1(bounds,pageSize)');
 const unavailable=branch.indexOf("if(!options.adapter?.bounded_inputs)fail('labeling_bounded_inputs_unavailable',409)");
 const txStart=branch.indexOf('return tx(db,async c=>{');
 const readonly=branch.indexOf("await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')");
 const callback=branch.indexOf('options.adapter!.bounded_inputs!(c,run,read)');
 if(validate<0||unavailable<0||txStart<0||readonly<0||callback<0
  ||!(validate<unavailable&&unavailable<txStart&&txStart<readonly&&readonly<callback))return fail();
 if(!/bounded_inputs:\(c,run,bounds\)=>inputs\(c,run,limit,bounds\)/u.test(listening))return fail();
 const inputs=listening.match(/async function inputs\(c:[\s\S]*?\n\}\nasync function pendingAndAvailable/u)?.[0];
 if(!inputs)return fail();
 const privatePath=/if\(bounds\)\{\s*const metadata=await inputProjectionMetadata\(c,run,bounds\);\s*return hydrateListeningInputProjectionV1\(c,\{[\s\S]*?\},metadata\.rows,bounds\);\s*\}/u.test(inputs);
 if(privatePath){
  const metadataHelper=listening.match(/async function inputProjectionMetadata\(c:Pick<PoolClient,'query'>,run:LabelingRunV1,bounds:LabelingInputBoundsV1\)\{([\s\S]*?)\n\}\nasync function inputs/u)?.[1];
  const hydrateHelper=projection.match(/export async function hydrateListeningInputProjectionV1\(c:Pick<PoolClient,'query'>,[\s\S]*?\n\}\s*$/u)?.[0];
  if(!metadataHelper||!metadataHelper.includes('const limit=bounds.max_rows')||!metadataHelper.includes('owner(c,run,false)')
   ||!metadataHelper.includes('c.query')||!metadataHelper.includes('return{o,rows}')||!hydrateHelper)return fail();
  const selectIndex=hydrateHelper.indexOf('selectLabelingInputPrefixV1(rows,bounds)'),bodyQuery=hydrateHelper.indexOf('await c.query');
  if(selectIndex<0||bodyQuery<0||selectIndex>=bodyQuery||!hydrateHelper.includes('[scope.workspace_id,scope.map_id,selected]'))return fail();
  return 'private_projection';
 }
 const legacyMetadata=/const metadata=bounds\?await inputMetadata\(c,run,bounds\.max_rows\):null;\s*const selected=metadata\?selectLabelingInputPrefixV1\(metadata\.rows,bounds!\):null/u.test(inputs);
 const selectedPopulation=/const hydratePopulation=selected\?`signal_listening_population_roots_v1\([^`]+`\s*:\s*population/u.test(inputs);
 const sameClientHydration=/const rows=\(await c\.query[\s\S]{0,1800}FROM \$\{hydratePopulation\}[\s\S]{0,2600}bounds\?\.max_rows\?\?limit,[\s\S]{0,250}\.\.\.\(selected\?\[selected\]:\[\]\)/u.test(inputs);
 if(!legacyMetadata||!selectedPopulation||!sameClientHydration)return fail();
 return 'bounded_metadata';
}

test('capture scope follows the real bounded transaction and rejects unbounded or cross-snapshot variants',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'scope contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 let projection='';try{projection=await readFile(join(target,'infrastructure/db/signal-listening-input-projection.ts'),'utf8');}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 }
 const beginMatch=labeling.match(/await c\.query\(["']BEGIN["']\)/u);
 const readOnlyMatch=labeling.match(/await c\.query\(["']SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY["']\)/u);
 assert.ok(beginMatch,'transaction helper must begin with its native BEGIN statement');
 assert.ok(readOnlyMatch,'bounded path must set its native RR/RO transaction before adapter work');
 const pathKind=assertBoundedInputCaptureScopeV1(labeling,listening,projection);
 assert.ok(pathKind==='private_projection'||pathKind==='bounded_metadata');
 const expectRejected=(label:string,changedLabeling=labeling,changedListening=listening,changedProjection=projection)=>{
  assert.throws(()=>assertBoundedInputCaptureScopeV1(changedLabeling,changedListening,changedProjection),/capture_scope_contract_invalid/u,label);
 };
 const rr='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
 const unboundedListening=pathKind==='private_projection'
  ?listening.replace('if(bounds){\n  const metadata=await inputProjectionMetadata(c,run,bounds);','if(false){\n  const metadata=await inputProjectionMetadata(c,run,bounds);')
  :listening.replace('inputMetadata(c,run,bounds.max_rows)','inputMetadata(c,run,limit)');
 expectRejected('unbounded projection fallback',labeling,unboundedListening);
 expectRejected('READ COMMITTED cannot satisfy the capture snapshot',labeling.replace(rr,'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'));
 expectRejected('adapter must use the transaction client, not another connection',labeling.replace('options.adapter!.bounded_inputs!(c,run,read)','options.adapter!.bounded_inputs!(otherClient,run,read)'));
 const guardAndBody=/await c\.query\('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'\);\s*return options\.adapter!\.bounded_inputs!\(c,run,read\);/u;
 const afterBody=labeling.replace(guardAndBody,`return options.adapter!.bounded_inputs!(c,run,read); await c.query('${rr}');`);
 assert.notEqual(afterBody,labeling,'test mutation must move the isolation guard after input projection');
 expectRejected('isolation guard after projection is unsafe',afterBody);
 if(pathKind==='private_projection'){
  expectRejected('private hydration must use the same snapshot client',labeling,
   listening.replace('return hydrateListeningInputProjectionV1(c,{','return hydrateListeningInputProjectionV1(otherClient,{'));
 }else{
  expectRejected('legacy bounded metadata cannot drop its row limit',labeling,
   listening.replace('inputMetadata(c,run,bounds.max_rows)','inputMetadata(c,run,limit)'));
 }
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
 const {safeAutoExplainNotice,classifyAutoExplainNoticeV1}=await import('./observer.mjs');
 const plan=safeAutoExplainNotice({message:'duration: 1.2 ms  plan:\n'+JSON.stringify({'Query Text':"SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x",'Planning Time':.1,'Execution Time':1.2,Plan:{'Node Type':'Index Scan','Relation Name':'mentions','Alias':'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,'Index Cond':"(root_id = 'private-uuid')",Output:['private_value'],Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Subplan Name':'private_cte','Filter':"credential = 'private'",'Actual Rows':1}]}})});
 const serialized=JSON.stringify(plan);
 assert.deepEqual(plan,{query_text_sha256:`sha256:${createHash('sha256').update("SELECT COALESCE(jsonb_agg(x), '{}'::jsonb) FROM (SELECT '{}'::jsonb AS shape) x").digest('hex')}`,
  planning_time_ms:.1,execution_time_ms:1.2,plan:{'Node Type':'Index Scan','Relation Name':'mentions',Alias:'m','Index Name':'mentions_root_idx','Plan Rows':12,'Actual Rows':7,'Actual Loops':2,Plans:[{'Node Type':'Seq Scan','Relation Name':'mentions','CTE Name':'allowed_roots','Actual Rows':1}]}});
 for(const forbidden of ['private-uuid','private_value','credential','Filter','Output','Index Cond','Query Text','jsonb_agg'])assert.ok(!serialized.includes(forbidden));
 assert.equal(safeAutoExplainNotice({message:'ERROR: private SQL and params'}),null);
 assert.equal(safeAutoExplainNotice({message:'x'.repeat(1_000_001)}),null);
 assert.deepEqual(classifyAutoExplainNoticeV1(null),{status:'rejected',reason:'message_missing'});
 assert.deepEqual(classifyAutoExplainNoticeV1({message:'x'.repeat(1_000_001)}),{status:'rejected',reason:'message_too_large'});
 assert.deepEqual(classifyAutoExplainNoticeV1({message:'ERROR: redacted'}),{status:'rejected',reason:'payload_missing'});
 assert.deepEqual(classifyAutoExplainNoticeV1({message:'plan: {not-json'}),{status:'rejected',reason:'invalid_json'});
 assert.deepEqual(classifyAutoExplainNoticeV1({message:'plan: {}'}),{status:'rejected',reason:'plan_invalid'});
 const selected=classifyAutoExplainNoticeV1({message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':'SELECT private_value FROM private_table',Plan:{'Node Type':'LockRows','Actual Rows':1}})});
 assert.equal(selected.status,'accepted');if(selected.status==='accepted')assert.equal(selected.plan['Node Type'],'LockRows');
 assert.ok(!JSON.stringify(selected).includes('private_value')&&!JSON.stringify(selected).includes('private_table'));
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
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',query_ordinal:2,root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.deepEqual(captured.result,{rows:[{ok:true}]});assert.equal(originalCalls,1);assert.equal(client.listenerCount('notice'),0);
  assert.ok(captured.observation?.status==='inner_plan_unavailable');assert.equal(captured.observation.reason,'auto_explain_load_unavailable');
  assert.equal(captured.observation.query_ordinal,2);
  for(const statement of ['SAVEPOINT r16_inner_plan_capture_v1','ROLLBACK TO SAVEPOINT r16_inner_plan_capture_v1','RELEASE SAVEPOINT r16_inner_plan_capture_v1'])assert.ok(statements.includes(statement));
  assert.ok(statements.includes("SET LOCAL log_min_messages = 'WARNING'"));assert.ok(statements.includes("SET LOCAL client_min_messages = 'NOTICE'"));
  assert.ok(statements.includes('LOAD \'auto_explain\''));
  const serialized=JSON.stringify(captured);assert.ok(!serialized.includes('private setup details'));assert.ok(!serialized.includes('extension unavailable'));
 }finally{
  for(const key of ['GITHUB_ACTIONS','NOISIA_R16_SMALL_DIAGNOSTIC','DATABASE_URL'] as const){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('inner-plan ordinals count every eligible query and select the fixed bounded schedule',async()=>{
 const {innerPlanQueryLabel,nextInnerPlanQueryOrdinalV1,shouldCaptureInnerPlanOrdinalV1,INNER_PLAN_CAPTURE_ORDINALS}=await import('./observer.mjs');
 const hash='sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',counts=new Map<string,number>();
 assert.equal(innerPlanQueryLabel(hash),'metadata');assert.deepEqual(INNER_PLAN_CAPTURE_ORDINALS,[1,2,3,4,5,6,7,8]);
 const ordinals=Array.from({length:10},()=>nextInnerPlanQueryOrdinalV1(hash,true,counts));
 assert.deepEqual(ordinals,Array.from({length:10},(_,i)=>i+1));
 assert.deepEqual(ordinals.filter(shouldCaptureInnerPlanOrdinalV1),[1,2,3,4,5,6,7,8]);
 assert.equal(nextInnerPlanQueryOrdinalV1(hash,false,counts),null);assert.equal(counts.get(hash),10);
 assert.equal(nextInnerPlanQueryOrdinalV1('sha256:unknown',true,counts),null);
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
   query_hash:'sha256:d0ecbbfdca3d93e069a3ca03367439fa25ce54164efaf3135c80b27c91ed2680',query_ordinal:1,root_count:4096,database:'noisia_mfp_ci',role:'postgres'});
  assert.equal(originalCalls,1);assert.ok(captured.observation?.status==='captured');
  assert.equal(captured.observation.query_ordinal,1);
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
  let originalCalls=0;
  await assert.rejects(captureInnerPlanQueryV1({client,query:async()=>{originalCalls++;throw Error('original query failure')},
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',query_ordinal:6,root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/original query failure/u);
  assert.equal(originalCalls,1);
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
   query_hash:'sha256:82fa4fc106842d6422046aefb067a0a7dbaf5bb28de04c0b9147854091410c04',query_ordinal:8,root_count:4096,database:'noisia_mfp_ci',role:'postgres'}),/rollback cleanup failed/u);
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
async function withProjectionPlanTestEnv<T>(action:()=>Promise<T>){
 const env={...DML_PLAN_TEST_ENV,GITHUB_EVENT_NAME:'workflow_dispatch',R16_DIAGNOSTIC_MODE:'sql_frontier_only',
  R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'true',R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),
  R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'true',LINEAR_ACCEPTANCE_SELECTED_PASS:'3',LINEAR_ACCEPTANCE_TARGET_SHA:'a'.repeat(40),
  RESERVE_SHARED_SMOKE:'true',RAW_ACCEPTANCE_SELECTED_PASS:'6',RAW_ACCEPTANCE_TARGET_SHA:'a'.repeat(40)};
 const keys=Object.keys(env) as Array<keyof typeof env>,prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,env);
 try{return await action();}finally{for(const key of keys){const value=prior[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function fakeReadonlyProjectionClient(options:{readOnly?:string;failLoad?:boolean;failShownGuc?:string;invalidShownGuc?:string}={}){
 const client=new EventEmitter() as any,statements:string[]=[],events:string[]=[];
 const gucs:Record<string,string>={log_min_messages:'warning',client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0',
  'auto_explain.log_parameter_max_length':'0','auto_explain.log_level':'notice','auto_explain.log_min_duration':'50ms',
  'auto_explain.log_nested_statements':'on','auto_explain.log_analyze':'on','auto_explain.log_buffers':'on',
  'auto_explain.log_timing':'off','auto_explain.log_format':'json','auto_explain.log_verbose':'off','auto_explain.sample_rate':'1'};
 client.processID=123;
 client.query=async(sql:string)=>{
  statements.push(sql);
  if(sql.startsWith('SAVEPOINT')){events.push(sql);return{rows:[]};}
  if(sql.startsWith('RELEASE SAVEPOINT')){events.push(sql);return{rows:[]};}
  if(sql.startsWith('ROLLBACK TO SAVEPOINT')){events.push(sql);return{rows:[]};}
  if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',isolation:'repeatable read',read_only:options.readOnly??'on',superuser:true}]};
  if(sql.startsWith("LOAD 'auto_explain'")){if(options.failLoad)throw Error('private extension failure');return{rows:[]};}
  if(sql.startsWith('SHOW ')){const name=sql.slice(5);if(name===options.failShownGuc)throw Error('private readback failure');
   return{rows:[{[name]:name===options.invalidShownGuc?'private raw value':gucs[name]}]};}
  return{rows:[]};
 };
 return{client,statements,events};
}
const CANONICAL_STATS_BEFORE=[
 {signature:'public.signal_labeling_digest_v1(jsonb)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
 {signature:'public.signal_labeling_json_v1(jsonb)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
 {signature:'public.signal_listening_statement_roots_v1(uuid[])',function_present:true,stats_observed:true,calls:5,total_time_ms:1,self_time_ms:.5},
];
const CANONICAL_STATS_AFTER=[
 CANONICAL_STATS_BEFORE[0]!,
 {signature:'public.signal_labeling_json_v1(jsonb)',function_present:true,stats_observed:true,calls:30,total_time_ms:10,self_time_ms:4},
 {signature:'public.signal_listening_statement_roots_v1(uuid[])',function_present:true,stats_observed:true,calls:6,total_time_ms:1.2,self_time_ms:.6},
];
const FUNCTION_STATS_BEFORE=[
 {signature:'public.signal_listening_answer_guard_v1()',function_present:true,stats_observed:true,calls:10,total_time_ms:2,self_time_ms:1},
 {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',function_present:true,stats_observed:true,calls:40,total_time_ms:12,self_time_ms:10},
 {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',function_present:true,stats_observed:true,calls:5,total_time_ms:8,self_time_ms:6},
 {signature:'public.signal_processing_actor_v1(uuid, uuid)',function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null},
];
const FUNCTION_STATS_AFTER=[
 {signature:'public.signal_listening_answer_guard_v1()',function_present:true,stats_observed:true,calls:11,total_time_ms:2.5,self_time_ms:1.3},
 {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',function_present:true,stats_observed:true,calls:42,total_time_ms:13,self_time_ms:11},
 {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',function_present:true,stats_observed:true,calls:6,total_time_ms:9,self_time_ms:7},
 {signature:'public.signal_processing_actor_v1(uuid, uuid)',function_present:true,stats_observed:true,calls:9,total_time_ms:5,self_time_ms:3},
];
function fakeDmlPlanClient(options:{readOnly?:string;failLoad?:boolean;failRestore?:boolean;failStatsBefore?:boolean;failStatsAfter?:boolean;
 absentSignatures?:string[];unobservedSignatures?:string[];unobservedBeforeSignatures?:string[];missingSignatures?:string[];invalidShownGuc?:string;failShownGuc?:string;
 counterRegressionSignatures?:string[];invalidBeforeSignatures?:string[];restoreFailsAfterStatsError?:boolean;failActorExplain?:boolean;restoreFailsAfterActorError?:boolean}={}){
 const client=new EventEmitter() as any,statements:string[]=[],events:string[]=[],restores:Array<{name:string;value:string;local:boolean}>=[],functionStatLookups:string[][]=[];
 let statsReads=0,transactionAborted=false;
 const oldValues:Record<string,string>={log_min_messages:'warning',client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0',
  'auto_explain.log_parameter_max_length':'0','auto_explain.log_level':'notice','auto_explain.log_min_duration':'-1',
  'auto_explain.log_nested_statements':'off','auto_explain.log_analyze':'off','auto_explain.log_buffers':'off',
  'auto_explain.log_timing':'on','auto_explain.log_format':'text','auto_explain.log_verbose':'off','auto_explain.log_triggers':'off',track_functions:'none',
  'auto_explain.sample_rate':'1',lock_timeout:'0',statement_timeout:'0'};
 client.query=async(sql:string,values?:unknown[])=>{
  statements.push(sql);
  if(sql.startsWith('SAVEPOINT')){events.push('savepoint');return{rows:[]};}
  if(sql.startsWith('SELECT current_database'))return{rows:[{database:'noisia_mfp_ci',role:'postgres',read_only:options.readOnly??'off',superuser:true}]};
  if(sql.startsWith("LOAD 'auto_explain'")){events.push('load');if(options.failLoad)throw Error('private extension failure');return{rows:[]};}
  if(sql.includes('pg_stat_xact_user_functions')){statsReads++;events.push(statsReads===1?'stats-before':'stats-after');functionStatLookups.push((values?.[0] as string[]|undefined)??[]);
   if((statsReads===1&&options.failStatsBefore)||(statsReads===2&&options.failStatsAfter)){if(statsReads===2&&options.restoreFailsAfterStatsError)transactionAborted=true;throw Error('synthetic_function_stats_error');}
   const source=statsReads===1?[...FUNCTION_STATS_BEFORE,...CANONICAL_STATS_BEFORE]:[...FUNCTION_STATS_AFTER,...CANONICAL_STATS_AFTER];
   const rows=source.filter(row=>!options.missingSignatures?.includes(row.signature)).map(row=>options.absentSignatures?.includes(row.signature)
    ?{signature:row.signature,function_present:false,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null}
    :options.unobservedSignatures?.includes(row.signature)||(statsReads===1&&options.unobservedBeforeSignatures?.includes(row.signature))
     ?{signature:row.signature,function_present:true,stats_observed:false,calls:null,total_time_ms:null,self_time_ms:null}:row);
   return{rows:rows.map(row=>statsReads===1&&options.invalidBeforeSignatures?.includes(row.signature)?{...row,calls:-1}:statsReads===2&&options.counterRegressionSignatures?.includes(row.signature)?{...row,calls:0}:row)};}
  if(sql.startsWith('SELECT name,current_setting'))return{rows:(values?.[0] as string[]).map(name=>({name,value:oldValues[name]}))};
  if(sql.startsWith('SHOW ')){const name=sql.slice(5);if(name===options.failShownGuc)throw Error('synthetic private readback failure');
   const configured:Record<string,string>={client_min_messages:'notice',log_statement:'none',log_parameter_max_length:'0','auto_explain.log_parameter_max_length':'0',
    'auto_explain.log_level':'notice','auto_explain.log_min_duration':'0','auto_explain.log_nested_statements':'on',
    'auto_explain.log_analyze':'on','auto_explain.log_buffers':'on','auto_explain.log_timing':'on','auto_explain.log_format':'json',
    'auto_explain.log_verbose':'off','auto_explain.log_triggers':'on','auto_explain.sample_rate':'1'};
   return{rows:[{[name]:name===options.invalidShownGuc?'secret raw value':configured[name]??oldValues[name]??'0'}]};}
  if(sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r'))return{rows:[{workspace_id:'11111111-1111-4111-8111-111111111111',actor_user_id:'22222222-2222-4222-8222-222222222222'}]};
  if(sql.startsWith('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)')){
   if(options.failActorExplain){if(options.restoreFailsAfterActorError)transactionAborted=true;throw Error('synthetic_actor_explain_error');}
   const plan={ 'Node Type':'Index Scan','Relation Name':'signal_workspaces','Index Name':'idx_signal_workspaces_org_status','Actual Rows':1,'Actual Loops':1};
   client.emit('notice',{message:'duration: 3 ms plan: '+JSON.stringify({'Query Text':sql,'Execution Time':3,Plan:plan})});
   return{rows:[{'QUERY PLAN':[{ 'Planning Time':.1,'Execution Time':3,Plan:plan}]}]};
  }
  if(sql.startsWith('RELEASE SAVEPOINT')){events.push('release');return{rows:[]};}
  if(sql.startsWith('ROLLBACK TO SAVEPOINT')){events.push('rollback');return{rows:[]};}
  if(sql.startsWith('SELECT set_config')){events.push('restore');restores.push({name:String(values?.[0]),value:String(values?.[1]),local:sql.includes('true')});if(options.failRestore)throw Error('synthetic restore failure');
   if(transactionAborted)throw Error('25P02 current transaction is aborted');return{rows:[]};}
  return{rows:[]};
 };
 return{client,statements,events,restores,oldValues,functionStatLookups};
}

test('projection capture binds only the exact bounded metadata SQL; legacy metadata stays outside the capture',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'projection source contract needs the checked out target');
 const {source,helper,sql}=await projectionMetadataSource(target);
 const {queryHash,projectionMetadataBatchSizeV1,PROJECTION_METADATA_QUERY_HASH_V1,PROJECTION_LINEAR_METADATA_QUERY_HASH_V1}=await import('./observer.mjs');
 if(!helper||!sql){
  const historical=source.match(/`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?LIMIT \$6)`/u);
  assert.ok(historical,'legacy target must expose its separate, unbounded metadata SQL for compatibility checking');
  let legacySql=historical[1]!;
  const refs=[...new Set([...legacySql.matchAll(/\$\{([A-Za-z_]+)\}/gu)].map(match=>match[1]!))].sort();
  assert.ok(JSON.stringify(refs)==='["noHumanDecision","unresolvedScope"]'||JSON.stringify(refs)==='["pendingScope","population"]');
  for(const name of refs){const literal=source.match(new RegExp('const '+name+'=(?:`([^`]+)`|"([^"]+)");','u'));
   assert.ok(literal);legacySql=legacySql.replaceAll('${'+name+'}',literal[1]??literal[2]!);}
  assert.ok(![PROJECTION_METADATA_QUERY_HASH_V1,PROJECTION_LINEAR_METADATA_QUERY_HASH_V1].includes(queryHash(legacySql)??''));
  const legacyValues=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
   '33333333-3333-4333-8333-333333333333','e'.repeat(64),'44444444-4444-4444-8444-444444444444',4096,2048,
   Array.from({length:1024},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`),'1000000'];
  assert.equal(projectionMetadataBatchSizeV1(PROJECTION_METADATA_QUERY_HASH_V1,[legacySql,legacyValues]),null);
  assert.equal(projectionMetadataBatchSizeV1(PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,[legacySql,legacyValues],true),null);
  return;
 }
 const sourceHash=queryHash(sql);assert.ok(sourceHash===PROJECTION_METADATA_QUERY_HASH_V1||sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,
  'only the two reviewed bounded projection query variants are accepted');
 const isLinear=sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1;
 assert.equal(PROJECTION_METADATA_QUERY_HASH_V1,'sha256:623ea62b8c7f51acab4551632bfd2518d58ed70cce110afce59914d175981bd3');
 assert.equal(PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,'sha256:e2a1d2ae7cc6917e1b58de56e7d3a2ad108e902feeb46d5d1dd1559644421f42');
 assert.deepEqual([...new Set([...sql.matchAll(/\$(\d+)/gu)].map(match=>Number(match[1])))].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9]);
 assert.match(helper,/const sliceSize=Math\.min\(4096,Math\.max\(64,limit\)\)/u);
 assert.match(helper,/const ids:string\[\]=\(await c\.query[\s\S]*?\)\.rows\.map\(row=>row\.root_id\)/u);
 if(isLinear){
  assert.match(helper,/fit_matches AS MATERIALIZED[\s\S]*?FULL JOIN fitting/u);
  assert.match(helper,/projection_rows AS MATERIALIZED[\s\S]*?FULL JOIN projections[\s\S]*?FROM projection_rows WHERE root_id IS NOT NULL ORDER BY root_id/u);
 }else assert.match(helper,/FROM prefix LEFT JOIN projections ON projections\.root_id=prefix\.root_id ORDER BY prefix\.root_id/u);
 assert.match(source,/inputProjectionMetadata\(c,run,bounds\)/u);
 assert.match(source,/bounded_inputs:\(c,run,bounds\)=>inputs\(c,run,limit,bounds\)/u);
 const ids=(count:number)=>Array.from({length:count},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
 const args=(idRows:unknown[],limit=4096,fixed=2048,budget='1000000')=>[sql,['11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','e'.repeat(64),
  '44444444-4444-4444-8444-444444444444',limit,fixed,idRows,budget]];
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(ids(1024)),isLinear),1024);
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(ids(4096)),isLinear),4096);
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(ids(1023)),isLinear),null);
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(ids(4097)),isLinear),null);
 assert.equal(projectionMetadataBatchSizeV1('sha256:'+('0'.repeat(64)),args(ids(1024)),isLinear),null);
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,[sql,[...args(ids(1024))[1].slice(0,8)]],isLinear),null);
 assert.equal(projectionMetadataBatchSizeV1(PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,args(ids(1024)),false),null,
  'the new query hash stays closed unless separate three-case evidence enables it');
 const duplicate=ids(1024);duplicate[1023]=duplicate[0]!;
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(duplicate),isLinear),null);
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,args(ids(1024),4097),isLinear),null);
 const invalid=args(ids(1024));(invalid[1] as unknown[])[8]='private malformed';
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,invalid,isLinear),null);
 if(isLinear){
  const fake=fakeReadonlyProjectionClient();let originalCalls=0;
  const denied=await (await import('./observer.mjs')).captureReadonlyProjectionPlanV1({client:fake.client,query:async()=>{originalCalls++;return{rows:[]};},
   query_hash:sourceHash,batch_size:1024,outer_query_text:sql,database:'noisia_mfp_ci',role:'postgres',env:{...DML_PLAN_TEST_ENV,
    GITHUB_EVENT_NAME:'workflow_dispatch',R16_DIAGNOSTIC_MODE:'sql_frontier_only',R16_DIAGNOSTIC_CAPTURE_PROJECTION_PLAN:'true',
    R16_DIAGNOSTIC_PROJECTION_LINEAR_ORACLE:'false',R16_DIAGNOSTIC_TARGET_LABEL:'candidate',R16_DIAGNOSTIC_TARGET_REF_REQUESTED:'a'.repeat(40),
    RESERVE_SHARED_SMOKE:'true',RAW_ACCEPTANCE_SELECTED_PASS:'6',RAW_ACCEPTANCE_TARGET_SHA:'a'.repeat(40)}});
  assert.equal(originalCalls,1);assert.equal(denied.observation,null);
  assert.equal(fake.statements.some(statement=>statement.startsWith('SAVEPOINT')||statement.startsWith('SHOW ')),false,
   'a target with the new query hash but without three-case evidence must take the untouched single-query path');
 }
});

test('read-only projection capture is one RR/RO source query with bounded delayed outer and nested plans',async()=>withProjectionPlanTestEnv(async()=>{
 const {captureReadonlyProjectionPlanV1,projectionMetadataBatchSizeV1,PROJECTION_METADATA_QUERY_HASH_V1,PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,
  queryHash,createListeningObserver}=await import('./observer.mjs');
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const {helper,sql}=await projectionMetadataSource(target);assert.ok(sql,'target metadata SQL should be source-extractable');
 const sourceHash=queryHash(sql)!;assert.ok(sourceHash===PROJECTION_METADATA_QUERY_HASH_V1||sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1);
 const isLinear=sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1;
 if(!helper){const fake=fakeReadonlyProjectionClient(),observer=createListeningObserver({sql_frontier_only:true,projection_plan_only:true,projection_linear_oracle:isLinear});
  try{const db=observer.wrapDatabase({async connect(){return fake.client;},async query(){return{rows:[]};}});
   const client=await db.connect();await client.query(sql,[]);const snapshot=observer.snapshot();
   assert.equal(fake.statements.filter(statement=>statement===sql).length,1);
   assert.equal(snapshot.projection_plan_capture?.captures_started,0);assert.equal(snapshot.dml_plan_observations.length,0);
   assert.equal(fake.statements.some(statement=>statement.startsWith('SAVEPOINT')||statement.startsWith('SHOW ')),false);
   return;
  }finally{await observer.close();}}
 const ids=Array.from({length:1024},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
 const values=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'e'.repeat(64),'44444444-4444-4444-8444-444444444444',4096,2048,ids,'1000000'];
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,[sql,values],isLinear),1024);
 const fake=fakeReadonlyProjectionClient();let originalCalls=0;
 const notice=(queryText:string,plan:Record<string,unknown>)=>({message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':queryText,'Planning Time':.1,'Execution Time':1,Plan:plan})});
 const deepPlan:any={'Node Type':'Result'};let cursor=deepPlan;for(let i=0;i<130;i++){cursor.Plans=[{'Node Type':'Result'}];cursor=cursor.Plans[0];}
 const deep={message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':'SELECT private_deep','Plan':deepPlan})};
 const capture=await captureReadonlyProjectionPlanV1({client:fake.client,query:async()=>{originalCalls++;
  for(let i=0;i<8;i++)fake.client.emit('notice',notice(`SELECT nested_${i}`,{'Node Type':'Index Scan','Relation Name':'signal_mass_labeling_items','Actual Rows':4096,'Actual Loops':1}));
  fake.client.emit('notice',{message:'duration: 1 ms plan: '+JSON.stringify({Plan:{'Node Type':'Result','Actual Rows':1,'Actual Loops':1}})});
  setImmediate(()=>{fake.client.emit('notice',notice(sql,{'Node Type':'Nested Loop','Actual Rows':4096,'Actual Loops':1,
    Plans:[{'Node Type':'CTE Scan','CTE Name':'projections','Relation Name':'signal_mass_labeling_items','Actual Rows':4096,'Actual Loops':1}]}));
   fake.client.emit('notice',{message:'ERROR: private after-query text'});fake.client.emit('notice',deep);
   fake.client.emit('notice',notice('SELECT unrelated private_cleanup',{'Node Type':'Result','Actual Rows':1,'Actual Loops':1}));});return{rows:[{private:'not retained'}]};},
  query_hash:sourceHash,batch_size:1024,outer_query_text:sql,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const observation=capture.observation!;
 assert.equal(originalCalls,1);assert.equal(capture.result.rows[0].private,'not retained');assert.equal(observation.status,'captured');
 assert.equal(observation.guc_readback.status,'captured');assert.equal(observation.raw_notice_count_by_phase.original_query,9);
 assert.equal(observation.accepted_nested_count_by_phase.original_query,8);assert.equal(observation.accepted_unattributed_count_by_phase.original_query,1);
 assert.equal(observation.capped_notice_count_by_phase.original_query,1);
 assert.equal(observation.raw_notice_count_by_phase.after_query,4);assert.equal(observation.accepted_outer_count_by_phase.after_query,1);
 assert.equal(observation.accepted_unattributed_count_by_phase.after_query,1);assert.equal(observation.rejected_notice_count_by_phase.after_query?.payload_missing,1);
 assert.equal(observation.rejected_notice_count_by_phase.after_query?.plan_invalid,1);assert.equal(observation.plans.length,8);
 assert.equal(observation.plans.filter(plan=>plan.frontier_role==='outer').length,1);
 assert.equal(observation.plans.filter(plan=>plan.frontier_role==='nested').length,7);
 assert.equal(observation.plans.at(-1)?.frontier_role,'outer');assert.equal(observation.plans_dropped,1);
 assert.equal((observation.plans.at(-1)?.plan.Plans as any[])?.[0]?.['CTE Name'],'projections');
 assert.equal(observation.after_query_drain_ms>=0,true);assert.ok(observation.cleanup_ms>=0);
 assert.ok(fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 assert.equal(fake.events.includes('RELEASE SAVEPOINT r16_projection_plan_capture_v1'),true);
 assert.equal(fake.client.listenerCount('notice'),0);assert.ok(fake.statements.some(sql=>sql==='SHOW auto_explain.log_min_duration'));
 assert.equal(fake.statements.some(sql=>sql.startsWith('EXPLAIN ')||sql.startsWith('SELECT set_config')),false);
 const serialized=JSON.stringify(observation);for(const forbidden of ['private_deep','private_cleanup','private after-query','SELECT nested_','private raw value'])assert.ok(!serialized.includes(forbidden));

 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const mark=labeling.match(new RegExp('`(UPDATE signal_labeling_calls SET status=\'submitting\',[\\s\\S]*?RETURNING id)`\\s*,\\s*\\[run\\.id,\\s*calls\\.map','u'));assert.ok(mark);
 const observer=createListeningObserver({sql_frontier_only:true,projection_plan_only:true,projection_linear_oracle:isLinear});
 try{const db=observer.wrapDatabase({async connect(){return fake.client;},async query(){return{rows:[]};}});
  const c=await db.connect();await c.query(mark[1],['44444444-4444-4444-8444-444444444444',ids.slice(0,256)]);
  const projected=await c.query(sql,values);
  assert.ok(projected);const snapshot=observer.snapshot();assert.equal(snapshot.sql_frontier_capture.captures_started,0);
  assert.equal(snapshot.dml_plan_observations.length,0);const projection=snapshot.projection_plan_capture;assert.ok(projection);
  assert.equal(projection.captures_started,1);assert.equal(projection.observations.length,1);
  assert.equal(fake.statements.filter(statement=>statement===mark[1]).length,1);
  assert.equal(fake.statements.filter(statement=>statement===sql).length,1);
  assert.equal(fake.statements.some(statement=>statement.includes('pg_stat_xact_user_functions')),false);
  assert.equal(fake.statements.some(statement=>statement.startsWith('EXPLAIN ')),false);
 }finally{await observer.close();}
}));

test('projection capture accepts only the exact outer notice during savepoint cleanup',async()=>withProjectionPlanTestEnv(async()=>{
 const {captureReadonlyProjectionPlanV1,projectionMetadataBatchSizeV1,PROJECTION_METADATA_QUERY_HASH_V1,PROJECTION_LINEAR_METADATA_QUERY_HASH_V1,queryHash}=await import('./observer.mjs');
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const {helper,sql}=await projectionMetadataSource(target);assert.ok(helper&&sql);
 const sourceHash=queryHash(sql)!;assert.ok(sourceHash===PROJECTION_METADATA_QUERY_HASH_V1||sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1);
 const isLinear=sourceHash===PROJECTION_LINEAR_METADATA_QUERY_HASH_V1;
 const ids=Array.from({length:1024},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
 const values=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'e'.repeat(64),'44444444-4444-4444-8444-444444444444',4096,2048,ids,'1000000'];
 assert.equal(projectionMetadataBatchSizeV1(sourceHash,[sql,values],isLinear),1024);
 const notice=(queryText:string,plan:Record<string,unknown>)=>({message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':queryText,'Planning Time':.1,'Execution Time':1,Plan:plan})});
 const fake=fakeReadonlyProjectionClient();let originalCalls=0,cleanupNoticesEmitted=false;
 const originalClientQuery=fake.client.query.bind(fake.client);
 fake.client.query=async(statement:string,...args:unknown[])=>{
  const result=await originalClientQuery(statement,...args);
  if(statement==='ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'&&!cleanupNoticesEmitted){cleanupNoticesEmitted=true;
   fake.client.emit('notice',notice(sql,{'Node Type':'Result','Actual Rows':1024,'Actual Loops':1}));
   fake.client.emit('notice',notice('SELECT private_unrelated_outer',{'Node Type':'Result','Actual Rows':1,'Actual Loops':1}));
   fake.client.emit('notice',notice('SELECT private_nested_cleanup',{'Node Type':'Index Scan','Actual Rows':1,'Actual Loops':1}));
  }
  return result;
 };
 const capture=await captureReadonlyProjectionPlanV1({client:fake.client,query:async()=>{originalCalls++;
  for(let index=0;index<7;index++)fake.client.emit('notice',notice(`SELECT nested_${index}`,{'Node Type':'Index Scan','Relation Name':'signal_mass_labeling_items','Actual Rows':1024,'Actual Loops':1}));
  return{rows:[]};},query_hash:sourceHash,batch_size:1024,outer_query_text:sql,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const observation=capture.observation!;
 assert.equal(originalCalls,1);assert.equal(observation.status,'captured');assert.equal(observation.plans.length,8);
 assert.equal(observation.accepted_nested_count_by_phase.original_query,7);assert.equal(observation.accepted_nested_count_by_phase.cleanup,0);
 assert.equal(observation.accepted_outer_count_by_phase.cleanup,1);assert.equal(observation.accepted_unattributed_count_by_phase.cleanup,2);
 assert.equal(observation.raw_notice_count_by_phase.cleanup,3);assert.equal(observation.plans.filter(plan=>plan.frontier_role==='outer').length,1);
 assert.equal(observation.plans.at(-1)?.frontier_role,'outer');assert.equal(observation.plans_dropped,0);
 assert.ok(fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 assert.ok(fake.events.includes('RELEASE SAVEPOINT r16_projection_plan_capture_v1'));assert.equal(fake.client.listenerCount('notice'),0);
 for(const forbidden of ['private_unrelated_outer','private_nested_cleanup','SELECT nested_'])assert.ok(!JSON.stringify(observation).includes(forbidden));

 const negative=fakeReadonlyProjectionClient();let negativeCalls=0;
 const negativeQuery=negative.client.query.bind(negative.client);let emitted=false;
 negative.client.query=async(statement:string,...args:unknown[])=>{const result=await negativeQuery(statement,...args);
  if(statement==='ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'&&!emitted){emitted=true;
   negative.client.emit('notice',notice('SELECT private_wrong_outer_hash',{'Node Type':'Result','Actual Rows':1,'Actual Loops':1}));
   negative.client.emit('notice',notice('SELECT private_nested_cleanup_only',{'Node Type':'Index Scan','Actual Rows':1,'Actual Loops':1}));}
  return result;};
 const unknown=await captureReadonlyProjectionPlanV1({client:negative.client,query:async()=>{negativeCalls++;return{rows:[]};},
  query_hash:sourceHash,batch_size:1024,outer_query_text:sql,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(negativeCalls,1);assert.equal(unknown.observation?.status,'capture_unknown');assert.equal(unknown.observation?.reason,'outer_plan_unobserved');
 assert.equal(unknown.observation?.accepted_outer_count_by_phase.cleanup,0);assert.equal(unknown.observation?.accepted_nested_count_by_phase.cleanup,0);
 assert.equal(unknown.observation?.accepted_unattributed_count_by_phase.cleanup,2);assert.equal(negative.client.listenerCount('notice'),0);
 for(const forbidden of ['private_wrong_outer_hash','private_nested_cleanup_only'])assert.ok(!JSON.stringify(unknown.observation).includes(forbidden));
}));

test('projection capture fails closed on scope, extension or GUC readback problems and restores after query errors',async()=>withProjectionPlanTestEnv(async()=>{
 const {captureReadonlyProjectionPlanV1,PROJECTION_METADATA_QUERY_HASH_V1}=await import('./observer.mjs');
 const outerSql='SELECT synthetic bounded projection';
 const run=async(options:{readOnly?:string;failLoad?:boolean;failShownGuc?:string;invalidShownGuc?:string}={},failQuery=false)=>{
  const fake=fakeReadonlyProjectionClient(options);let calls=0;
  const capture=()=>captureReadonlyProjectionPlanV1({client:fake.client,query:async()=>{calls++;
   if(!failQuery)fake.client.emit('notice',{message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':outerSql,Plan:{'Node Type':'Result','Actual Rows':1,'Actual Loops':1}})});
   if(failQuery)throw Error('projection_original_query_failed');return{rows:[]};},query_hash:PROJECTION_METADATA_QUERY_HASH_V1,
   batch_size:1024,outer_query_text:outerSql,database:'noisia_mfp_ci',role:'postgres',env:process.env});
  return{fake,capture,calls:()=>calls};
 };
 const badScope=await run({readOnly:'off'}),scopeResult=await badScope.capture();
 assert.equal(badScope.calls(),1);assert.equal(scopeResult.observation?.status,'setup_unavailable');
 assert.equal(scopeResult.observation?.reason,'transaction_scope_unverified');assert.equal(badScope.fake.client.listenerCount('notice'),0);
 assert.ok(badScope.fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 const badLoad=await run({failLoad:true}),loadResult=await badLoad.capture();
 assert.equal(badLoad.calls(),1);assert.equal(loadResult.observation?.reason,'auto_explain_load_unavailable');
 assert.equal(badLoad.fake.client.listenerCount('notice'),0);assert.ok(badLoad.fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 const failedReadback=await run({failShownGuc:'auto_explain.log_format'}),readbackResult=await failedReadback.capture();
 assert.equal(failedReadback.calls(),1);assert.equal(readbackResult.observation?.status,'capture_unknown');
 assert.equal(readbackResult.observation?.reason,'guc_readback_unavailable');assert.equal(readbackResult.observation?.guc_readback.status,'unknown');
 assert.ok(failedReadback.fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_guc_readback_v1'));
 assert.ok(failedReadback.fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 assert.equal(failedReadback.fake.client.listenerCount('notice'),0);
 const invalidReadback=await run({invalidShownGuc:'auto_explain.log_format'}),invalidResult=await invalidReadback.capture();
 assert.equal(invalidResult.observation?.status,'capture_unknown');assert.equal(invalidResult.observation?.guc_readback.settings['auto_explain.log_format'],null);
 assert.ok(!JSON.stringify(invalidResult.observation).includes('private raw value'));
 const failedOriginal=await run({},true);
 await assert.rejects(failedOriginal.capture(),/projection_original_query_failed/u);
 assert.equal(failedOriginal.calls(),1);assert.ok(failedOriginal.fake.events.includes('ROLLBACK TO SAVEPOINT r16_projection_plan_capture_v1'));
 assert.equal(failedOriginal.fake.client.listenerCount('notice'),0);
}));

test('DML plan specs match the complete source SQL, bind arity and batch-value positions',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'DML SQL contract test needs checked out public target root');
 const labeling=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const listening=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const mark=labeling.match(/`(UPDATE signal_labeling_calls SET status='submitting',[\s\S]*?RETURNING id)`\s*,\s*\[run\.id,\s*calls\.map/u);
 const answers=listening.match(/`(INSERT INTO signal_listening_answers\([\s\S]*?DO NOTHING)`\s*,\s*\[run\.workspace_id,\s*run\.entity_context_digest,\s*run\.id,\s*JSON\.stringify\(rows\)\]/u);
 const reserve=labeling.match(/`(INSERT INTO signal_labeling_calls\([\s\S]*?ON CONFLICT\(custom_id\) DO NOTHING)`\s*,\s*\[\s*run\.id,[\s\S]*?JSON\.stringify\(fresh\),/u);
 assert.ok(mark,'markSubmitting SQL and run.id/calls batch position must match');assert.ok(answers,'answers INSERT SQL and $4 row batch position must match');
 assert.ok(reserve,'reserve INSERT SQL and $6 fresh-proposal batch position must match');
 const {queryHash,dmlPlanQuerySpec,dmlPlanBatchSize}=await import('./observer.mjs');
 const markHash=queryHash(mark[1]),answersHash=queryHash(answers[1]),reserveHash=queryHash(reserve[1]);
 assert.equal(markHash,'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b');
 assert.equal(answersHash,'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7');
 assert.equal(reserveHash,'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd');
 assert.deepEqual(dmlPlanQuerySpec(markHash),{label:'mark_submitting',batch_unit:'call_ids',values_count:2,batch_value_index:1,batch_kind:'array',function_stats:'canonical'});
 assert.deepEqual(dmlPlanQuerySpec(answersHash),{label:'listening_answers_insert',batch_unit:'answer_rows',values_count:4,batch_value_index:3,batch_kind:'json_array',function_stats:'answers'});
 assert.deepEqual(dmlPlanQuerySpec(reserveHash),{label:'reserve_calls_insert',batch_unit:'call_proposals',values_count:8,batch_value_index:5,batch_kind:'json_array',function_stats:'canonical'});
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(256).fill('synthetic-id')]]),256);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run',Array(255).fill('synthetic-id')]]),255);
 assert.equal(dmlPlanBatchSize(markHash,['UPDATE', ['run']]),null);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run',JSON.stringify(Array(256).fill({synthetic:true}))]]),256);
 assert.equal(dmlPlanBatchSize(answersHash,['INSERT', ['workspace','context','run','not-json']]),null);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport',JSON.stringify(Array(256).fill({synthetic:true})),'date','UTC']]),256);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport',JSON.stringify(Array(255).fill({synthetic:true})),'date','UTC']]),255);
 assert.equal(dmlPlanBatchSize(reserveHash,['INSERT', ['run','workspace','provider','model','transport','not-json','date','UTC']]),null);
});

test('SQL frontier uses zero duration only for the first RAW lock capture; other DML stay at 50ms and neutral bypasses it',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,createListeningObserver,queryHash,dmlPlanQuerySpec,safeAutoExplainNotice}=await import('./observer.mjs');
 const lockSql=`SELECT c.id FROM signal_labeling_calls c
        JOIN signal_labeling_raw_page_members m ON m.call_id=c.id AND m.workspace_id=c.workspace_id AND m.run_id=c.run_id
        WHERE m.page_id=$1 AND m.workspace_id=$2 AND m.run_id=$3 ORDER BY c.id FOR UPDATE OF c`;
 const lockHash=queryHash(lockSql);assert.equal(lockHash,'sha256:b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670');
 const candidateLockHash='sha256:92e110090281de57fbeb89a78954883ea71ce54d36e0d871469c34692568e474';
 for(const hash of [lockHash,candidateLockHash]){
  const spec=dmlPlanQuerySpec(hash);assert.equal(spec?.label,'raw_attach_call_lock');assert.equal(spec?.min_duration_ms,0);
 }
 const sanitized=safeAutoExplainNotice({message:'duration: 1 ms plan: '+JSON.stringify({Plan:{'Node Type':'CTE Scan','CTE Name':'raw_lock_page','Subplan Name':'raw_lock_page','Actual Rows':1}})});
 assert.equal(sanitized?.plan['CTE Name'],'raw_lock_page');assert.equal(sanitized?.plan['Subplan Name'],'raw_lock_page');
 const otherHashes=[
  'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
  'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',
  'sha256:99746d65e4fad037daa0402f77a11a5677c191c74ef01741a1182cf05e201d20',
  'sha256:f3a9ed08bf4b11ed5ec2a22e8c26663fbf14b2424d0bae8f425036338025cd35',
 ];
 for(const hash of otherHashes){
  const {client,statements}=fakeDmlPlanClient();
  await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:hash,batch_size:256,
   database:'noisia_mfp_ci',role:'postgres',env:process.env,sql_frontier_only:true});
  assert.ok(statements.includes('SET LOCAL auto_explain.log_min_duration = 50'),`${hash} retains the default duration`);
  assert.ok(!statements.includes('SET LOCAL auto_explain.log_min_duration = 0'),`${hash} does not use zero duration`);
 }
 for(const hash of [lockHash,candidateLockHash]){
  const direct=fakeDmlPlanClient();
  await captureDmlPlanQueryV1({client:direct.client,query:async()=>({rowCount:256}),query_hash:hash,batch_size:256,
   database:'noisia_mfp_ci',role:'postgres',env:process.env,sql_frontier_only:true});
  assert.ok(direct.statements.includes('SET LOCAL auto_explain.log_min_duration = 0'));
  assert.ok(!direct.statements.includes('SET LOCAL auto_explain.log_min_duration = 50'));
 }

 const firstObserver=createListeningObserver({sql_frontier_only:true}),first=fakeDmlPlanClient();let lockQueries=0;
 const firstQuery=first.client.query.bind(first.client);
 first.client.query=async(sql:string,values?:unknown[])=>{if(sql===lockSql)lockQueries++;return firstQuery(sql,values);};
 const db=firstObserver.wrapDatabase({async connect(){return first.client;},query:first.client.query});
 const rows=Array.from({length:256},(_,i)=>({call:{id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}}));
 const run={id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222'};
 try{
  const store=firstObserver.wrapStore({async persistRawPage(){const owner=await db.connect();
   await owner.query(lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]);
   await owner.query(lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]);}});
  await store.persistRawPage(run,rows);
  const snapshot=firstObserver.snapshot();
  assert.equal(lockQueries,2);assert.equal(snapshot.dml_plan_observations.length,1);
  assert.equal(snapshot.sql_frontier_capture.captures_started,1);
  assert.ok(first.statements.includes('SET LOCAL auto_explain.log_min_duration = 0'));
 }finally{await firstObserver.close();}

 const neutral=createListeningObserver({neutral_only:true}),plain=fakeDmlPlanClient();
 try{
  const neutralDb=neutral.wrapDatabase({async connect(){return plain.client;},query:plain.client.query});
  const owner=await neutralDb.connect();await owner.query(lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]);
  assert.equal(neutral.snapshot().dml_plan_observations.length,0);
  assert.equal(plain.client.listenerCount('notice'),0);
  assert.equal(plain.statements.some(sql=>sql.startsWith('SAVEPOINT r16_dml_plan_capture_v1')),false);
  assert.equal(plain.statements.some(sql=>sql.startsWith('SET LOCAL auto_explain.')),false);
 }finally{await neutral.close();}
}));

test('RAW attach frontier requires bounded persistRawPage context and source-bound update SQL while retaining only counts',async()=>{
 const {queryHash,dmlPlanQuerySpec,rawPageDmlContextFromStoreArgsV1,rawPageDmlBatchSizeV1,SQL_FRONTIER_DML_BATCH_LIMIT,createListeningObserver}=await import('./observer.mjs');
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'RAW attach source contract needs checked out public target root');
 const rawPageSource=await readFile(join(target,'infrastructure/db/signal-labeling-raw-page-store.ts'),'utf8');
 const attach=rawPageSource.match(/export const labelingRawPageAttachSqlV1=`([\s\S]*?)`;/u);
 const legacyUpdate=rawPageSource.match(/const changed=await c\.query\(`(UPDATE signal_labeling_calls c SET[\s\S]*?RETURNING c\.id)`\s*,\s*\[page\.id/u);
 const legacyHash='sha256:99746d65e4fad037daa0402f77a11a5677c191c74ef01741a1182cf05e201d20';
 const boundedHash='sha256:f3a9ed08bf4b11ed5ec2a22e8c26663fbf14b2424d0bae8f425036338025cd35';
 const oldLockHash='sha256:b8180180dfc8340b89511bb2ecf806c6f7bc811c7c257d2a7409915751ec5670';
 const newLockHash='sha256:92e110090281de57fbeb89a78954883ea71ce54d36e0d871469c34692568e474';
 assert.ok(attach||legacyUpdate,'RAW attach UPDATE must match a source-whitelisted implementation');
 const updateSql=attach?.[1]??legacyUpdate?.[1]!;
 const expectedUpdateHash=attach?boundedHash:legacyHash;
 assert.equal(queryHash(updateSql),expectedUpdateHash);
 const newLock=rawPageSource.match(/export const labelingRawPageLockSqlV1=`([\s\S]*?)`;/u);
 const oldLock=rawPageSource.match(/c\.query<\{id:string\}>\(`(SELECT c\.id FROM signal_labeling_calls c[\s\S]*?FOR UPDATE OF c)`\s*,\s*\[page\.id,\s*run\.workspace_id,\s*run\.id\]\)/u);
 const lockSql=newLock?.[1]??oldLock?.[1];assert.ok(lockSql,'RAW lock source must expose the full allowlisted SQL');
 const lockHash=queryHash(lockSql);
 if(newLock){assert.equal(lockHash,newLockHash);assert.match(rawPageSource,/c\.query<\{id:string\}>\(labelingRawPageLockSqlV1,\s*\[page\.id,\s*run\.workspace_id,\s*run\.id\]\)/u);}
 else assert.equal(lockHash,oldLockHash);
 const updateHash=queryHash(updateSql);
 assert.equal(updateHash,expectedUpdateHash);
 for(const candidateLockHash of [oldLockHash,newLockHash]){
  const spec=dmlPlanQuerySpec(candidateLockHash);assert.equal(spec?.label,'raw_attach_call_lock');
  assert.equal(spec?.values_count,3);assert.equal(spec?.batch_kind,'raw_page_context');assert.equal(spec?.min_duration_ms,0);
 }
 assert.equal(dmlPlanQuerySpec(updateHash)?.label,'raw_attach_call_update');
 assert.equal(dmlPlanQuerySpec(legacyHash)?.label,'raw_attach_call_update');assert.equal(dmlPlanQuerySpec(boundedHash)?.label,'raw_attach_call_update');
 const rows=Array.from({length:256},(_,i)=>({call:{id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`},sensitive:'must-not-be-retained'}));
 const run={id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222'};
 const context=rawPageDmlContextFromStoreArgsV1([run,rows]);assert.deepEqual(context,{operation:'persistRawPage',run_id:run.id,workspace_id:run.workspace_id,batch_size:256});
 assert.equal(JSON.stringify(context).includes('sensitive'),false);assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),256);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],{...context,run_id:'33333333-3333-4333-8333-333333333333'}),null);
 assert.equal(rawPageDmlBatchSizeV1(updateHash,[updateSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),256);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',run.id]],context),null);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],{...context,batch_size:SQL_FRONTIER_DML_BATCH_LIMIT+1}),null);
 assert.equal(rawPageDmlBatchSizeV1(lockHash,[lockSql+' /* drift */',['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]],context),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,[...rows.slice(0,255),rows[0]]]),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,[{call:{id:'not-a-uuid'}}]]),null);
 assert.equal(rawPageDmlContextFromStoreArgsV1([run,Array(SQL_FRONTIER_DML_BATCH_LIMIT+1).fill(rows[0])]),null);
 await withDmlPlanTestEnv(async()=>{
  for(const neutralOnly of [false,true]){
   const observer=createListeningObserver(neutralOnly?{neutral_only:true}:{sql_frontier_only:true});
   const fixture=fakeDmlPlanClient();let originalLockCalls=0;
   const originalQuery=fixture.client.query.bind(fixture.client);
   fixture.client.query=async(sql:string,values?:unknown[])=>{if(sql===lockSql)originalLockCalls++;return originalQuery(sql,values);};
   try{
    const database=observer.wrapDatabase({async connect(){return fixture.client;},query:fixture.client.query});
    const store=observer.wrapStore({async persistRawPage(){const owner=await database.connect();
     await owner.query(lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]);
     await owner.query(lockSql,['33333333-3333-4333-8333-333333333333',run.workspace_id,run.id]);}});
    await store.persistRawPage(run,rows);
    const snapshot=observer.snapshot();assert.equal(originalLockCalls,2,'each source query must execute once');
    if(neutralOnly){
     assert.equal(snapshot.dml_plan_observations.length,0);assert.equal(snapshot.sql_frontier_capture.captures_started,0);
     assert.equal(fixture.client.listenerCount('notice'),0);
     assert.equal(fixture.statements.some(sql=>sql.startsWith('SHOW ')),false);
     assert.equal(fixture.statements.some(sql=>sql.startsWith('SET LOCAL auto_explain.')),false);
    }else{
     assert.equal(snapshot.dml_plan_observations.length,1);
     const observedLock=snapshot.dml_plan_observations[0] as {query_hash?:string;label?:string}|undefined;
     assert.equal(observedLock?.query_hash,lockHash);assert.equal(observedLock?.label,'raw_attach_call_lock');
     assert.equal(snapshot.sql_frontier_capture.captures_started,1);
     assert.ok(fixture.statements.includes('SET LOCAL auto_explain.log_min_duration = 0'));
    }
   }finally{await observer.close();}
  }
 });
});

test('function-stat OID contract ignores the source functions’ real argument names',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'function-stat contract test needs checked out public target root');
 const listening=await readFile(join(target,'infrastructure/db/migrations/0296_signal_listening_configuration.sql'),'utf8');
 const policy=await readFile(join(target,'infrastructure/db/migrations/0155_signal_processing_policy.sql'),'utf8');
 const actor=await readFile(join(target,'infrastructure/db/migrations/0218_signal_processing_internal_admin_actor.sql'),'utf8');
 assert.match(listening,/CREATE FUNCTION signal_listening_root_right_v1\(w uuid,r uuid,purpose text\)/u);
 assert.match(policy,/CREATE FUNCTION signal_processing_lock_actor_v1\(target_workspace uuid,target_actor uuid,require_request boolean DEFAULT true\)/u);
 assert.match(actor,/CREATE OR REPLACE FUNCTION signal_processing_actor_v1\(target_workspace uuid,target_actor uuid\)/u);
 await withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,functionStatLookups}=fakeDmlPlanClient();
  await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',
   batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
  const lookup=statements.find(sql=>sql.includes('pg_stat_xact_user_functions'))??'';
  assert.match(lookup,/to_regprocedure\(signature\)::oid/u);assert.doesNotMatch(lookup,/pg_get_function_identity_arguments|identity_arguments/u);
  assert.deepEqual(functionStatLookups[0],[
   'public.signal_listening_answer_guard_v1()',
   'public.signal_listening_root_right_v1(uuid, uuid, text)',
   'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',
   'public.signal_processing_actor_v1(uuid, uuid)',
  ]);
 });
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
   {'Trigger Name':'mass_labeling_call_root',Relation:'signal_labeling_calls',Time:8.5,Calls:256},
   {'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Calls:0},
   {'Trigger Name':'private_dynamic_trigger',Relation:'private_table',Time:9,Calls:1}]})});
 assert.deepEqual(note?.triggers,[{name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:48.2,calls:256},
  {name:'mass_labeling_call_root',relation:'signal_labeling_calls',time_ms:8.5,calls:256},
  {name:'signal_listening_answer_guard',relation:'signal_listening_answers',time_ms:null,calls:0}]);
 assert.equal(note?.triggers_seen,4);assert.equal(note?.triggers_omitted,1);assert.equal(note?.triggers_unknown_time,1);
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
 assert.equal(captured.observation.batch_unit,'call_ids');
 assert.equal(captured.observation.plans.length,DML_PLAN_MAX_PLANS);assert.equal(captured.observation.plans_dropped,2);
 assert.equal(captured.observation.triggers_omitted_count,10);assert.equal(captured.observation.plans[0]?.triggers[0]?.calls,256);
 assert.equal(captured.observation.analyze_timing_overhead_measured,false);assert.equal(client.listenerCount('notice'),0);
 assert.equal('guc_readback' in captured.observation,false);assert.equal('raw_notice_count_by_phase' in captured.observation,false);
 assert.equal(statements.some(sql=>sql.startsWith('SHOW ')),false);assert.equal(statements.includes('SET LOCAL auto_explain.sample_rate = 1'),false);
 assert.ok(events.indexOf('release')<events.indexOf('write'));assert.equal(events.filter(x=>x==='rollback').length,0);
 assert.ok(events.lastIndexOf('restore')>events.indexOf('write'));
 assert.equal(restores.length,18);assert.ok(restores.every(row=>row.local));
 assert.deepEqual(restores[0],{name:'auto_explain.log_min_duration',value:'-1',local:true});
 assert.deepEqual(restores.at(-1),{name:'auto_explain.log_min_duration',value:oldValues['auto_explain.log_min_duration'],local:true});
 for(const {name,value} of restores.slice(1,-1))assert.equal(value,oldValues[name]);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_triggers = on'),true);
 assert.equal(statements.includes('SET LOCAL auto_explain.log_timing = on'),true);
 assert.equal(captured.observation.analyze_timing_enabled,true);assert.equal(captured.observation.analyze_timing_overhead_measured,false);
 assert.equal(statements.some(sql=>sql.startsWith('ROLLBACK TO SAVEPOINT')),false);
 const serialized=JSON.stringify(captured);for(const forbidden of ['private_0','unknown_private_trigger','hidden','UPDATE synthetic_table'])assert.ok(!serialized.includes(forbidden));
}));

test('SQL frontier capture preserves the outer plan after nested notices, bounds nested plans, and never launches actor work',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,DML_PLAN_MAX_PLANS}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient();
 const outerSql='UPDATE synthetic_table SET value=$1 WHERE id=$2';let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;
  for(let i=0;i<10;i++)client.emit('notice',{message:'duration: 61 ms plan: '+JSON.stringify({'Query Text':`SELECT nested_${i}`,
   'Execution Time':61,Plan:{'Node Type':'Seq Scan','Relation Name':'synthetic_table','Actual Rows':1,'Actual Loops':1}})});
  client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':outerSql,'Execution Time':62,
   Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1}})});
  events.push('write');return{rowCount:256};},query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',
  batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,sql_frontier_only:true,outer_query_text:outerSql,query_values:{private:'not-for-actor'}});
 assert.equal(writes,1);assert.equal(captured.observation?.outer_plan_status,'captured');assert.equal(captured.observation?.nested_plan_limit,DML_PLAN_MAX_PLANS);
 assert.equal(captured.observation?.plans.filter(plan=>plan.frontier_role==='outer').length,1);
 assert.equal(captured.observation?.plans.filter(plan=>plan.frontier_role==='nested').length,DML_PLAN_MAX_PLANS);
 assert.equal(captured.observation?.plans_dropped,2);assert.ok(captured.observation&&!('actor_function_diagnostic' in captured.observation));
 assert.ok(captured.observation?.plans.at(-1)?.frontier_role==='outer');
 const artifact=JSON.stringify(captured.observation);assert.ok(!artifact.includes('UPDATE synthetic_table')&&!artifact.includes('private')&&!artifact.includes('query_values'));
}));

test('DML notice diagnostics separate delayed exact-outer notices, rejected shapes, GUC readback and cleanup',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,queryHash}=await import('./observer.mjs');const {client,statements}=fakeDmlPlanClient({invalidShownGuc:'auto_explain.log_format',failShownGuc:'auto_explain.sample_rate'});
 const outerSql='SELECT c.id FROM signal_labeling_calls c WHERE c.id=$1 FOR UPDATE';let calls=0;
 const notice=(sql:string)=>({message:'duration: 1 ms plan: '+JSON.stringify({'Query Text':sql,'Execution Time':1,Plan:{'Node Type':'LockRows','Actual Rows':1,'Actual Loops':1}})});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{calls++;
  setImmediate(()=>{client.emit('notice',notice(outerSql));client.emit('notice',notice('SELECT private_cleanup_probe'));
   client.emit('notice',{message:'ERROR: private diagnostic text'});client.emit('notice',{message:'x'.repeat(1_000_001)});});
  return{rowCount:1};},query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,sql_frontier_only:true,outer_query_text:outerSql});
 const observation=captured.observation!;assert.equal(calls,1);assert.equal(observation.status,'captured');
 assert.ok(observation.guc_readback&&observation.raw_notice_count_by_phase&&observation.rejected_notice_count_by_phase&&observation.accepted_outer_count_by_phase&&observation.accepted_unattributed_count_by_phase);
 assert.equal(observation.raw_notice_count_by_phase.after_query,4);assert.equal(observation.rejected_notice_count_by_phase.after_query?.payload_missing,1);
 assert.equal(observation.rejected_notice_count_by_phase.after_query?.message_too_large,1);
 assert.equal(observation.accepted_outer_count_by_phase.after_query,1);assert.equal(observation.accepted_unattributed_count_by_phase.after_query,1);
 assert.equal(observation.plans.length,1);assert.equal(observation.plans[0]?.frontier_role,'outer');
 assert.equal(observation.plans[0]?.query_text_sha256,queryHash(outerSql));assert.equal(observation.guc_readback.status,'unknown');
 assert.equal(observation.guc_readback.settings['auto_explain.log_format'],null);
 assert.equal(observation.guc_readback.settings['auto_explain.log_min_duration'],'0');
 assert.equal(observation.guc_readback.settings['auto_explain.sample_rate'],null);
 assert.ok(statements.includes('ROLLBACK TO SAVEPOINT r16_dml_guc_readback_v1'));
 assert.ok(statements.includes('SHOW auto_explain.sample_rate'));assert.ok(statements.includes('SHOW auto_explain.log_format'));
 const artifact=JSON.stringify(observation);for(const forbidden of ['private_cleanup_probe','private diagnostic text','secret raw value',outerSql])assert.ok(!artifact.includes(forbidden));
}));

test('deep auto_explain plan is rejected safely and never interrupts or replays the original query',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1,classifyAutoExplainNoticeV1}=await import('./observer.mjs');const {client}=fakeDmlPlanClient();
 const deepJson='{"Query Text":"SELECT private_deep_value","Plan":'+'{"Node Type":"LockRows","Plans":['.repeat(512)+'{"Node Type":"LockRows"}'+']}'.repeat(512)+'}';
 const deepNotice={message:'duration: 1 ms plan: '+deepJson};
 assert.deepEqual(classifyAutoExplainNoticeV1(deepNotice),{status:'rejected',reason:'plan_invalid'});
 let originalCalls=0;const captured=await captureDmlPlanQueryV1({client,query:async()=>{originalCalls++;client.emit('notice',deepNotice);return{rowCount:1};},
  query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,
  sql_frontier_only:true,outer_query_text:'SELECT synthetic_outer_for_deep_test'});
 assert.equal(originalCalls,1);assert.equal(captured.result.rowCount,1);assert.equal(captured.observation?.status,'plan_notice_unavailable');
 assert.equal(captured.observation?.outer_plan_status,'unknown');assert.equal(captured.observation?.raw_notice_count_by_phase?.original_query,1);
 assert.equal(captured.observation?.rejected_notice_count_by_phase?.original_query?.plan_invalid,1);
 assert.ok(!JSON.stringify(captured.observation).includes('private_deep_value'));
}));

test('DML setup fallback rolls back before exactly one write and leaves it in the outer transaction ledger',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failLoad:true});let writes=0;
 let clockTick=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{assert.equal(client.listenerCount('notice'),0);writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env,clock:()=>++clockTick});
 assert.equal(writes,1);assert.equal(captured.result.rowCount,256);assert.ok(captured.observation?.status==='setup_unavailable');
 assert.equal(captured.observation.reason,'auto_explain_load_unavailable');assert.ok(events.indexOf('rollback')<events.indexOf('write'));
 assert.equal(captured.observation.batch_unit,'answer_rows');
 assert.equal(captured.observation.cleanup_ms,1);assert.equal(captured.observation.setup_cleanup_wall_ms,captured.observation.setup_ms+captured.observation.cleanup_ms);
 assert.equal(captured.observation.analyze_timing_enabled,false);
 assert.equal(events.filter(x=>x==='write').length,1);
}));

test('answers INSERT reports allowlisted inclusive same-transaction function-stat deltas separately from DML time',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();let writes=0,clockTick=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{
  writes++;events.push('write');client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':'INSERT INTO signal_listening_answers ...',
   'Execution Time':62,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_listening_answers','Actual Rows':256,'Actual Loops':1},
   Triggers:[{'Trigger Name':'signal_listening_answer_guard',Relation:'signal_listening_answers',Time:48.2,Calls:256}]})});return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,clock:()=>++clockTick});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='captured');
 const stats=captured.observation.function_stats;assert.equal(stats?.status,'captured');assert.equal(stats?.total_time_inclusive,true);assert.equal(stats?.self_time_excludes_nested_calls,true);
 assert.equal(stats?.overhead_measured,false);assert.equal(stats?.capacity_claim,false);
 assert.deepEqual(stats?.deltas.map(({signature,calls})=>({signature,calls})),[
  {signature:'public.signal_listening_answer_guard_v1()',calls:1},
  {signature:'public.signal_listening_root_right_v1(uuid, uuid, text)',calls:2},
  {signature:'public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',calls:1},
  {signature:'public.signal_processing_actor_v1(uuid, uuid)',calls:9},
 ]);
 assert.ok(stats?.deltas.every(row=>row.status==='captured'));
 assert.equal(stats?.deltas[3]?.baseline,'transaction_local_row_absent_zero_before_dml');
 assert.ok(Math.abs(stats!.deltas[0]!.total_time_ms!-.5)<1e-9);assert.ok(Math.abs(stats!.deltas[0]!.self_time_ms!-.3)<1e-9);
 assert.deepEqual(stats?.deltas.slice(1).map(row=>[row.total_time_ms,row.self_time_ms]),[[1,1],[1,1],[5,3]]);
 assert.equal(stats?.read_before_ms,1);assert.equal(stats?.read_after_ms,1);
 assert.equal(captured.observation.query_wall_ms,1);
 assert.ok(events.indexOf('release')<events.indexOf('write'));assert.equal(events.includes('rollback'),false);
 assert.ok(statements.includes("SET LOCAL track_functions = 'all'"));
 assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
 assert.equal(client.listenerCount('notice'),0);
 const serialized=JSON.stringify(captured);for(const forbidden of ['INSERT INTO','...','workspace_id','private','run_id'])assert.ok(!serialized.includes(forbidden));
}));

test('function stats distinguishes absent functions, unobserved counters, and missing lookup rows from measured zero',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');
 const answer='public.signal_listening_answer_guard_v1()',root='public.signal_listening_root_right_v1(uuid, uuid, text)',lockActor='public.signal_processing_lock_actor_v1(uuid, uuid, boolean)',actor='public.signal_processing_actor_v1(uuid, uuid)';
 const {client}=fakeDmlPlanClient({absentSignatures:[answer],unobservedSignatures:[root],missingSignatures:[lockActor]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const deltas=captured.observation?.function_stats?.deltas;assert.ok(deltas);
 assert.deepEqual(deltas.map(({signature,status,calls,total_time_ms,self_time_ms})=>({signature,status,calls,total_time_ms,self_time_ms})),[
  {signature:answer,status:'function_absent',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:root,status:'stats_unobserved',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:lockActor,status:'lookup_unobserved',calls:null,total_time_ms:null,self_time_ms:null},
  {signature:actor,status:'captured',calls:9,total_time_ms:5,self_time_ms:3},
 ]);
}));

test('a missing pre-write transaction counter row is declared before using its transaction-start zero baseline',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const root='public.signal_listening_root_right_v1(uuid, uuid, text)';
 const {client}=fakeDmlPlanClient({unobservedBeforeSignatures:[root]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 const row=captured.observation?.function_stats?.deltas.find(item=>item.signature===root);
 assert.deepEqual(row,{signature:root,status:'captured',baseline:'transaction_local_row_absent_zero_before_dml',calls:42,total_time_ms:13,self_time_ms:11});
}));

test('post-write actor diagnostic resolves call ownership and records bounded safe EXPLAIN plans on the same backend',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,statements,events,restores,oldValues}=fakeDmlPlanClient();
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target,'actor owner lookup contract needs checked out public target root');
 const labelingSchema=await readFile(join(target,'infrastructure/db/migrations/0221_signal_labeling_core.sql'),'utf8');
 assert.match(labelingSchema,/CREATE TABLE signal_labeling_runs\s*\(\s*id uuid PRIMARY KEY/u);
 assert.match(labelingSchema,/FOREIGN KEY\(workspace_id,run_id\) REFERENCES signal_labeling_runs\(workspace_id,id\)/u);
 const callIds=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
 const queryValues=['synthetic-workspace','synthetic-context','synthetic-run',JSON.stringify(callIds.map(call_id=>({call_id})))];let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,query_values:queryValues,clock:(()=>{let tick=0;return()=>++tick;})()});
 assert.equal(writes,1);assert.ok(captured.observation&&captured.observation.status!=='setup_unavailable');assert.equal(captured.observation.query_wall_ms,1);
 const diag=captured.observation.actor_function_diagnostic;
 assert.equal(diag?.status,'captured');assert.equal(diag?.call_ids_count,2);assert.equal(diag?.calls_resolved_count,2);
 assert.equal(diag?.timing_on,true);assert.equal(diag?.query_wall_includes_nested,true);assert.equal(diag?.analyze_overhead_measured,false);assert.equal(diag?.capacity_claim,false);
 assert.equal(diag?.lock_timeout_ms,1000);assert.equal(diag?.statement_timeout_ms,15000);assert.equal(diag?.nested_plan_limit,8);
 assert.match(diag?.function_call?.query_hash??'/',/^sha256:[0-9a-f]{64}$/u);assert.match(diag?.equivalent_body?.query_hash??'/',/^sha256:[0-9a-f]{64}$/u);
 assert.equal(diag?.function_call?.explain_plan?.plan['Node Type'],'Index Scan');assert.equal(diag?.function_call?.nested_plans.length,1);
 assert.equal(diag?.equivalent_body?.explain_plan?.plan['Index Name'],'idx_signal_workspaces_org_status');
 assert.equal(statements.filter(sql=>sql.startsWith('EXPLAIN (ANALYZE,BUFFERS,TIMING ON,FORMAT JSON)')).length,2);
 assert.ok(statements.some(sql=>sql.includes('public.signal_processing_actor_v1($1::uuid,$2::uuid)')));
 assert.ok(statements.some(sql=>sql.includes('FROM public.user_brand_access a')));assert.ok(statements.every(sql=>!sql.includes('signal_processing_lock_actor_v1')));
 const ownerLookup=statements.find(sql=>sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r'))??'';
 assert.match(ownerLookup,/JOIN signal_labeling_runs r ON r\.id=c\.run_id AND r\.workspace_id=c\.workspace_id/u);
 assert.doesNotMatch(ownerLookup,/r\.run_id\s*=\s*c\.run_id/u);
 assert.ok(statements.includes("SET LOCAL lock_timeout = '1s'"));assert.ok(statements.includes("SET LOCAL statement_timeout = '15s'"));
 assert.ok(statements.filter(sql=>sql.includes('pg_stat_xact_user_functions')).length===2);
 const statReads=statements.map((sql,index)=>sql.includes('pg_stat_xact_user_functions')?index:-1).filter(index=>index>=0);
 assert.ok(statReads[1]!<statements.findIndex(sql=>sql.includes('FROM signal_labeling_calls c JOIN signal_labeling_runs r')));
 assert.equal(restores.at(-2)?.name,'statement_timeout');assert.equal(restores.at(-2)?.value,oldValues.statement_timeout);
 assert.equal(restores.at(-3)?.name,'lock_timeout');assert.equal(restores.at(-3)?.value,oldValues.lock_timeout);
 assert.equal(client.listenerCount('notice'),0);assert.ok(events.indexOf('write')<events.indexOf('restore'));
 const serialized=JSON.stringify(captured);for(const forbidden of [...callIds,'synthetic-workspace','synthetic-context','synthetic-run','signal_processing_actor_v1($1'])assert.ok(!serialized.includes(forbidden));
}));

test('actor diagnostic query error stays primary over aborted-transaction GUC restore and never replays the write',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failActorExplain:true,restoreFailsAfterActorError:true});
 const callId='55555555-5555-4555-8555-555555555555';let writes=0,caught:unknown;
 try{await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env,query_values:['synthetic','context','run',JSON.stringify([{call_id:callId}])]});}catch(error){caught=error;}
 assert.ok(caught instanceof AggregateError);assert.match(String((caught as AggregateError).errors[0]),/synthetic_actor_explain_error/u);
 assert.match(String((caught as AggregateError).errors[1]),/25P02/u);assert.equal(writes,1);assert.equal(events.includes('rollback'),false);
 assert.equal(client.listenerCount('notice'),0);
}));

test('function-stat setup failure falls back before the original answers write exactly once',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failStatsBefore:true});let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='setup_unavailable');assert.equal(captured.observation.function_stats?.status,'setup_unavailable');
 assert.equal(captured.observation.function_stats?.read_after_ms,null);assert.ok(events.indexOf('rollback')<events.indexOf('write'));
 assert.equal(events.filter(x=>x==='write').length,1);assert.equal(client.listenerCount('notice'),0);
}));

test('post-write function-stat failure propagates without replay or rollback',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events,restores,oldValues}=fakeDmlPlanClient({failStatsAfter:true});let writes=0;
 await assert.rejects(captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic_function_stats_error/u);
 assert.equal(writes,1);assert.equal(events.includes('rollback'),false);assert.equal(client.listenerCount('notice'),0);
 assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
}));

test('stats-read error remains primary when aborted-transaction cleanup also fails',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failStatsAfter:true,restoreFailsAfterStatsError:true});let writes=0;
 let caught:unknown;try{await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:7a86df2f02e720b156e7f9d7132eba342080fc9d169d7cf8e1cbdfa74de067a7',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});}catch(error){caught=error;}
 assert.ok(caught instanceof AggregateError);assert.equal((caught as AggregateError).errors.length,2);
 assert.match(String((caught as AggregateError).errors[0]),/synthetic_function_stats_error/u);
 assert.match(String((caught as AggregateError).errors[1]),/25P02/u);
 assert.equal(writes,1);assert.equal(events.includes('rollback'),false);assert.equal(client.listenerCount('notice'),0);
}));

test('reserve INSERT capture labels proposal batches distinctly from answer rows',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient();let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{
  writes++;events.push('write');client.emit('notice',{message:'duration: 62 ms plan: '+JSON.stringify({'Query Text':'INSERT INTO signal_labeling_calls ...',
   'Execution Time':62,Plan:{'Node Type':'ModifyTable','Relation Name':'signal_labeling_calls','Actual Rows':256,'Actual Loops':1},
   Triggers:[{'Trigger Name':'mass_labeling_call_root',Relation:'signal_labeling_calls',Time:8.5,Calls:256}]})});return{rowCount:256};},
  query_hash:'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='captured');
 assert.equal(captured.observation.batch_unit,'call_proposals');assert.equal(captured.observation.batch_size,256);
 assert.equal(captured.observation.plans[0]?.triggers[0]?.name,'mass_labeling_call_root');
}));

test('reserve INSERT setup fallback keeps the call-proposal batch unit and runs the write once',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events}=fakeDmlPlanClient({failLoad:true});let writes=0;
 const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},
  query_hash:'sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd',batch_size:256,
  database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.equal(writes,1);assert.ok(captured.observation?.status==='setup_unavailable');
 assert.equal(captured.observation.batch_unit,'call_proposals');assert.equal(captured.observation.reason,'auto_explain_load_unavailable');
 assert.ok(events.indexOf('rollback')<events.indexOf('write'));assert.equal(client.listenerCount('notice'),0);
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
  query_hash:hash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env}),/synthetic restore failure/u);
 assert.equal(cleanupWrites,1);assert.equal(cleanupError.client.listenerCount('notice'),0);assert.equal(cleanupError.events.includes('rollback'),false);
}));

const CANONICAL_SIGNATURES=['public.signal_labeling_digest_v1(jsonb)','public.signal_labeling_json_v1(jsonb)','public.signal_listening_statement_roots_v1(uuid[])'];
for(const queryHash of ['sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b','sha256:4ece6654c82e3d48416690d80208f849288cd5cfed5e16f0464dd3accfba33dd']){
 test('canonical DML stats are transaction-local, bounded by exact signatures and never launch actor diagnostics: '+queryHash,async()=>withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client,events,statements,functionStatLookups,restores,oldValues}=fakeDmlPlanClient();let writes=0;
  const captured=await captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},query_hash:queryHash,batch_size:256,
   query_values:['not-an-answer-bind',JSON.stringify([{call_id:'11111111-1111-4111-8111-111111111111'}])],database:'noisia_mfp_ci',role:'postgres',env:process.env});
  assert.equal(writes,1);assert.deepEqual(functionStatLookups,[CANONICAL_SIGNATURES,CANONICAL_SIGNATURES]);
  assert.ok(events.indexOf('stats-before')<events.indexOf('release'));assert.ok(events.indexOf('release')<events.indexOf('write'));assert.ok(events.indexOf('write')<events.indexOf('stats-after'));
  assert.ok(!statements.some(sql=>sql.includes('LEFT JOIN pg_stat_user_functions')||sql.startsWith('EXPLAIN ')||sql.includes('reset')||sql.includes('clear_snapshot')));
  const stats=captured.observation?.function_stats;assert.ok(stats);assert.equal(stats.view,'pg_stat_xact_user_functions');assert.equal(stats.scope,'same_backend_current_transaction_delta');
  assert.equal(stats.measured_work,'original_dml_and_all_triggers');assert.equal(stats.cpu_time,false);assert.equal(stats.recursive_calls_are_mentions,false);
  assert.ok(captured.observation&&captured.observation.status!=='setup_unavailable');
  assert.equal(captured.observation.actor_function_diagnostic,undefined);assert.equal(client.listenerCount('notice'),0);
  assert.deepEqual(stats.deltas.map(row=>row.signature),CANONICAL_SIGNATURES);
  assert.deepEqual(stats.deltas[0],{signature:CANONICAL_SIGNATURES[0],status:'stats_unobserved',baseline:null,calls:null,total_time_ms:null,self_time_ms:null},'an inline SQL digest may remain unobserved, not zero');
  assert.deepEqual(stats.deltas[1],{signature:CANONICAL_SIGNATURES[1],status:'captured',baseline:'transaction_local_row_absent_zero_before_dml',calls:30,total_time_ms:10,self_time_ms:4});
  assert.equal(stats.deltas[2]?.calls,1);assert.equal(stats.deltas[2]?.baseline,'observed_before');
  assert.equal(restores.at(-2)?.name,'track_functions');assert.equal(restores.at(-2)?.value,oldValues.track_functions);
 }));
 test('canonical DML stats fallback and post-write failure never replay the original: '+queryHash,async()=>withDmlPlanTestEnv(async()=>{
  const {captureDmlPlanQueryV1}=await import('./observer.mjs');
  for(const failStatsAfter of [false,true]){const {client,events}=fakeDmlPlanClient(failStatsAfter?{failStatsAfter:true}:{failStatsBefore:true});let writes=0;
   const capture=()=>captureDmlPlanQueryV1({client,query:async()=>{writes++;events.push('write');return{rowCount:256};},query_hash:queryHash,batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
   if(failStatsAfter)await assert.rejects(capture,/synthetic_function_stats_error/);else{const result=await capture();assert.equal(result.observation?.function_stats?.status,'setup_unavailable');assert.ok(events.indexOf('rollback')<events.indexOf('write'));}
   assert.equal(writes,1);assert.equal(client.listenerCount('notice'),0);
  }
 }));
}
test('canonical counters keep absent lookups and after-unobserved data unknown and reject a backwards counter',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const {client}=fakeDmlPlanClient({missingSignatures:[CANONICAL_SIGNATURES[0]!],unobservedSignatures:[CANONICAL_SIGNATURES[1]!],counterRegressionSignatures:[CANONICAL_SIGNATURES[2]!]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.deepEqual(captured.observation?.function_stats?.deltas.map(row=>[row.status,row.calls,row.total_time_ms,row.self_time_ms]),[['lookup_unobserved',null,null,null],['stats_unobserved',null,null,null],['counter_invalid',null,null,null]]);
}));

test('canonical statistic signatures resolve source helpers, including the real JSON canonicalizer',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/migrations/0223_signal_mention_facets.sql'),'utf8');
 const roots=await readFile(join(target,'infrastructure/db/migrations/0318_signal_listening_statement_population.sql'),'utf8');
 assert.match(source,/CREATE FUNCTION signal_labeling_json_v1\(value jsonb\) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT/u);
 assert.match(source,/CREATE FUNCTION signal_labeling_digest_v1\(value jsonb\) RETURNS text LANGUAGE sql IMMUTABLE STRICT/u);
 assert.match(roots,/CREATE FUNCTION signal_listening_statement_roots_v1\(ids uuid\[\]\) RETURNS uuid\[\]/u);
 assert.ok(!source.includes('signal_labeling_canonical_json_v1'));
});

test('invalid pre-write observed counters cannot become a transaction-zero baseline',async()=>withDmlPlanTestEnv(async()=>{
 const {captureDmlPlanQueryV1}=await import('./observer.mjs');const signature=CANONICAL_SIGNATURES[2]!;const {client}=fakeDmlPlanClient({invalidBeforeSignatures:[signature]});
 const captured=await captureDmlPlanQueryV1({client,query:async()=>({rowCount:256}),query_hash:'sha256:1e5b3d3837b8c7354d6c25d941461f0d36e55d5cc3d42cbd31c627ba0662859b',batch_size:256,database:'noisia_mfp_ci',role:'postgres',env:process.env});
 assert.deepEqual(captured.observation?.function_stats?.deltas.find(row=>row.signature===signature),{signature,status:'counter_invalid',baseline:null,calls:null,total_time_ms:null,self_time_ms:null});
}));


test('neutral mode is explicit, rejects CPU flags and preserves legacy profiler requirement',()=>{
 assert.equal(diagnosticModeV1({}),'legacy');assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'neutral_only'}),'neutral_only');
 assert.equal(diagnosticModeV1({R16_DIAGNOSTIC_MODE:'sql_frontier_only'}),'sql_frontier_only');
 assert.throws(()=>diagnosticModeV1({R16_DIAGNOSTIC_MODE:'silently-disable'}),/mode_invalid/u);
 assert.doesNotThrow(()=>assertDiagnosticExecArgsV1('neutral_only',['--import','tsx'],'/unused'));
 assert.throws(()=>assertDiagnosticExecArgsV1('neutral_only',['--cpu-prof'],'/unused'),/profiler_forbidden/u);
 assert.throws(()=>assertDiagnosticExecArgsV1('legacy',[],'/unused'),/not_enabled/u);
});

test('neutral frontier records exact batch/sequence/stream/connect correlation and redacts rows, identifiers and query text',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});
 let physicalQueries=0,releases=0,resolveConnect:()=>void=()=>{};
 const connected=new Promise<void>(r=>{resolveConnect=r;});
 const client={processID:123,async query(){physicalQueries++;return{rows:[{secret:'private returned row'}]};},release(){releases++;},on(){throw Error('must not install auto_explain notice listener');},off(){}};
 const db=observer.wrapDatabase({async connect(){await connected;return client;},async query(){physicalQueries++;return{rows:[]};}});
 const store=observer.wrapStore({async markSubmitting(_run:unknown,_rows:unknown[]){const c=await db.connect();try{return await c.query('SELECT sensitive_col FROM secret WHERE id=$1',['private bind']);}finally{c.release();}}});
 try{
  observer.beginJob(1);assert.throws(()=>observer.assertStreamObserved(),/hook_unobserved/u);
  const metrics={in_flight:3,reserved_working_bytes:4096,buffered_responses:2,active_flushes:1,client_id:'private client'};
  observer.observeStream(metrics);metrics.in_flight=999;
  const rows=[{id:'private call'},{id:'private call2'}],pending=store.markSubmitting({id:'private run'},rows);
  resolveConnect();await pending;observer.assertStreamObserved();
  const snapshot=observer.snapshot(),events=snapshot.events as any[],op=events.find(e=>e.kind==='store'),connect=events.find(e=>e.kind==='connect'),query=events.find(e=>e.kind==='query');
  assert.equal(op.batch_size,2);assert.equal(op.batch_unit,'argument_rows');assert.equal(op.last_stream_before.in_flight,3);
  assert.equal(op.sequence,query.store_sequence);assert.equal(op.sequence,connect.store_sequence);assert.equal(connect.pid,123);
  assert.equal(connect.status,'acquired');assert.ok(connect.wait_ms>=0);assert.ok(connect.start_ms>=op.start_ms&&connect.end_ms<=op.end_ms);
  assert.equal(physicalQueries,1);assert.equal(releases,1);assert.equal(snapshot.inner_plan_observations.length,0);assert.equal(snapshot.dml_plan_observations.length,0);
  const wire=JSON.stringify(snapshot);for(const x of ['private','sensitive_col','secret WHERE','client_id'])assert.ok(!wire.includes(x));
  observer.beginJob(2);assert.equal(observer.snapshot().last_stream,null);assert.throws(()=>observer.assertStreamObserved(),/hook_unobserved/u);
  observer.observeStream({in_flight:0,reserved_working_bytes:0,buffered_responses:0,active_flushes:0});observer.assertStreamObserved();
 }finally{await observer.close();}
});

test('frontier preserves original connect failure and records failure metadata without secrets',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});const primary=new Error('private failure');
 try{const db=observer.wrapDatabase({async connect(){throw primary;},async query(){return{rows:[]};}});
  const store=observer.wrapStore({async reserve(){return db.connect();}});await assert.rejects(store.reserve({},[{}]),e=>e===primary);
  const events=observer.snapshot().events as any[];assert.equal(events.find(x=>x.kind==='connect').status,'failed');
  assert.equal(events.find(x=>x.kind==='store').status,'failed');assert.ok(!JSON.stringify(events).includes('private failure'));
 }finally{await observer.close();}
});


test('neutral mode runs a whitelisted mark DML exactly once without plan/stat/GUC instrumentation',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/signal-labeling-runs.ts'),'utf8');
 const match=source.match(/`(UPDATE signal_labeling_calls SET status='submitting',[\s\S]*?RETURNING id)`\s*,\s*\[run\.id,\s*calls\.map/u);assert.ok(match);
 const {createListeningObserver,dmlPlanQuerySpec,queryHash}=await import('./observer.mjs');assert.ok(dmlPlanQuerySpec(queryHash(match[1])));
 const observer=createListeningObserver({neutral_only:true});let calls=0;
 const client={processID:123,async query(sql:string){calls++;assert.equal(sql,match[1]);return{rows:[]};},on(){throw Error('plan listener forbidden');},off(){}};
 try{
  observer.setInnerPlanRootCount(4096);const db=observer.wrapDatabase({async connect(){return client;},query:client.query});const c=await db.connect();
  await c.query(match[1],['synthetic-run',Array.from({length:256},(_,i)=>`synthetic-${i}`)]);
  assert.equal(calls,1);assert.equal(observer.snapshot().dml_plan_observations.length,0);assert.equal(observer.snapshot().inner_plan_observations.length,0);
 }finally{await observer.close();}
});

test('invalid or missing stream metadata never becomes a complete native stream observation',async()=>{
 const {createListeningObserver}=await import('./observer.mjs');const observer=createListeningObserver({neutral_only:true});
 try{observer.beginJob(1);observer.observeStream({in_flight:'1',reserved_working_bytes:0,buffered_responses:0,active_flushes:0});
  assert.equal(observer.snapshot().invalid_stream_observations,1);assert.equal(observer.snapshot().last_stream,null);
  assert.throws(()=>observer.assertStreamObserved(),/unobserved_or_invalid/u);
 }finally{await observer.close();}
});


test('neutral mode also bypasses automatic SELECT plan capture for the real eligible metadata query',async()=>{
 const target=process.env.R16_DIAGNOSTIC_TARGET_ROOT;assert.ok(target);
 const source=await readFile(join(target,'infrastructure/db/signal-listening-runs.ts'),'utf8');
 const template=source.match(/`(\/\* labeling_listening_input_metadata_v1 \*\/[\s\S]*?LIMIT \$6)`/u);
 assert.ok(template);
 const refs=[...new Set([...template[1]!.matchAll(/\$\{([A-Za-z_]+)\}/gu)].map(m=>m[1]!))].sort();
 assert.ok(JSON.stringify(refs)===JSON.stringify(['noHumanDecision','unresolvedScope'])
  ||JSON.stringify(refs)===JSON.stringify(['pendingScope','population']),'unknown metadata template format');
 let sql=template[1]!;
 for(const name of refs){
  // Only the two known source formats; literal interpolation, never eval or a copied query.
  const value=source.match(new RegExp('const '+name+'=(?:`([^`]+)`|"([^\"]+)");','u'));
  assert.ok(value,'metadata literal missing');const literal=value[1]??value[2];assert.ok(literal&&!literal.includes('${'));
  sql=sql.replaceAll('${'+name+'}',literal);
 }
 assert.ok(!sql.includes('${'),'unresolved metadata interpolation');
 const {createListeningObserver,queryHash,innerPlanQueryLabel}=await import('./observer.mjs');
 if(refs[0]==='noHumanDecision')assert.equal(innerPlanQueryLabel(queryHash(sql)),'metadata');
 else{
  assert.equal(queryHash(sql),'sha256:1c6942d84ff9c1edf7f35f28e0ba14d854fac1c51a64b2bbbdd51c1f5abc6d5f');
  assert.equal(innerPlanQueryLabel(queryHash(sql)),null,'historical metadata is not in the current capture allowlist');
 }
 const observer=createListeningObserver({neutral_only:true});let calls=0;
 const client={processID:123,async query(actual:string){calls++;assert.equal(actual,sql);return{rows:[]};},on(){throw Error('SELECT plan listener forbidden');},off(){}};
 try{observer.setInnerPlanRootCount(4096);const db=observer.wrapDatabase({async connect(){return client;},query:client.query});const c=await db.connect();await c.query(sql,[]);
  assert.equal(calls,1);assert.equal(observer.snapshot().inner_plan_observations.length,0);
 }finally{await observer.close();}
});
