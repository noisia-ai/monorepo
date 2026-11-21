// Remote-only experimental acceptance. No import from product or automatic runtime switch.
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile,lstat,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,validateSignalListeningConfigurationV1,buildSignalListeningJevRequestV1,
 signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,llmCostMicroUsdV1,llmPriceV1,type SignalListeningInputV1} from '@noisia/query-engine';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {selectLabelingInputPrefixV1} from '../signal-labeling-input-bounds';
import {openR16CiPostgresV1} from './signal-r16-local-pg.fixture';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {createR16ListeningNativeFixtureV1} from '../../../scripts/r16/listening-native-fixture';
import {loadR16ListeningNativeCensusV1} from '../../../scripts/r16/listening-native-census';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {captureR16ExpectedGitProvenanceV1,captureR16SourceProvenanceV1} from '../../../scripts/r16/source-provenance';
import {withR16ListeningRuntimeWitnessV1} from '../../../scripts/r16/run-listening-benchmark';
import {startR16HttpFilesystemStorageV1} from '../../../scripts/r16/http-filesystem-storage';
import {buildSyntheticJevResponseV1} from '../../../scripts/r16/synthetic-jev';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';
import {createSignalListeningRuntimeStoreV1} from '../../../services/workers/src/workers/signal-listening-jev';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {SURVEY_SCALAR_BEFORE_SQL_V1,SURVEY_SCALAR_BEFORE_PRODUCT_SHA_V1,surveyScalarShaV1,assertSurveyScalarWireSourceV1} from './signal-listening-survey-wire-scalars.test-support';
import {buildSurveyWireScalarCandidateV1,compareSurveyScalarRowsV1,profileSurveyScalarAbbaV1} from './signal-listening-survey-wire-scalars.oracle';

const enabled=process.env.NOISIA_R16_SURVEY_WIRE_SCALARS_PG==='true';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const parity:unknown[]=[],profiles:unknown[]=[];let nativeWitness:unknown;
const sourceState:{expected?:ReturnType<typeof captureR16ExpectedGitProvenanceV1>;before?:Awaited<ReturnType<typeof captureR16SourceProvenanceV1>>}={};
const EMPTY=surveyScalarShaV1('');
async function prerequisites(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','experimental PostgreSQL runs only on the owned CI lab');
 assert.ok(process.env.R16_SURVEY_WIRE_SCALARS_EVIDENCE_DIR);assert.equal(process.env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 const product=await readFile(new URL('../signal-listening-runs.ts',import.meta.url),'utf8');assert.equal(surveyScalarShaV1(product),SURVEY_SCALAR_BEFORE_PRODUCT_SHA_V1,'this diagnostic must not activate a candidate product query');
 if(!sourceState.expected){const expected=process.env.R16_SURVEY_EXPECTED_SOURCE_SHA??process.env.GITHUB_SHA;assert.match(expected??'',/^[a-f0-9]{40}$/u);sourceState.expected=captureR16ExpectedGitProvenanceV1(repo,expected!);sourceState.before=await captureR16SourceProvenanceV1(repo);assert.deepEqual(sourceState.before,sourceState.expected);}
}
async function readOnly<T>(c:PoolClient,body:()=>Promise<T>):Promise<T>{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');let failed=false;
 try{await c.query("SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='1s'");return await body();}
 catch(e){failed=true;throw e;}finally{try{await c.query('ROLLBACK');}catch(e){if(!failed)throw e;}}
}
const asParams=(run:LabelingRunV1,cfg:string,map:string,ids:string[]|null,max=4096,bytes=512*1024*1024)=>
 [run.workspace_id,cfg,map,run.entity_context_digest,run.id,max,Buffer.byteLength(JSON.stringify(run.identity))+Buffer.byteLength(JSON.stringify(run.context))+Buffer.byteLength(JSON.stringify(run.identity.params.configuration)),ids,String(bytes)];
function prefixResult(rows:Array<{root_id:string;working_bytes:string}>,max:number,bytes:number,mode:'empty'|'error'){
 try{return{ids:selectLabelingInputPrefixV1(rows,{max_rows:max,max_working_bytes:bytes,on_oversize:mode})};}
 catch(e){return{error:e instanceof Error?e.message:'unknown'};}
}
async function paired(c:PoolClient,params:unknown[],name:string,options:{old?:string;next?:string}={}){
 const result=await compareSurveyScalarRowsV1(c,params,options);
 const old=(await c.query(options.old??SURVEY_SCALAR_BEFORE_SQL_V1,params)).rows;
 for(const mode of ['empty','error']as const)assert.deepEqual(prefixResult(result.rows,Number(params[5]),Number(params[8]),mode),prefixResult(old,Number(params[5]),Number(params[8]),mode));
 parity.push({name,complete_rows:result.rows.length,complete_rows_sha256:result.rows_sha256,all_fields_and_order_equal:true,snapshot_sha256:result.snapshot_sha256,canonical_prefix_both_modes_equal:true});return result.rows;
}

test('Survey scalar synthetic PostgreSQL matrix preserves rows bounds empty and nullable domains',{skip:!enabled,timeout:120000},async()=>{
 await prerequisites();const db=await openR16CiPostgresV1(),c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query(`CREATE TEMP TABLE survey_native_rows(workspace_id uuid,configuration_id uuid,map_id uuid,ctx text,root_id uuid,input_digest text,question_key text,question_digest text,wire jsonb,scope_basis text,candidate boolean,scope_state text,answer jsonb,body_octets integer,platform_octets integer);
   CREATE TEMP TABLE survey_sent(workspace_id uuid,run_id uuid,root_id uuid,question_digest text);
   CREATE TEMP TABLE survey_human(workspace_id uuid,configuration_id uuid,map_id uuid,root_id uuid,input_digest text,ctx text,question_digest text);
   CREATE TEMP TABLE survey_items(workspace_id uuid,map_id uuid,root_id uuid,text text);
   CREATE FUNCTION pg_temp.survey_wire_native(uuid,uuid,uuid,text,uuid[],text) RETURNS TABLE(root_id uuid,input_digest text,question_key text,question_digest text,wire jsonb,scope_basis text,candidate boolean,scope_state text,answer jsonb,body_octets integer,platform_octets integer) LANGUAGE plpgsql STABLE AS $$
   BEGIN
    PERFORM set_config('r16.survey_native_calls',(COALESCE(NULLIF(current_setting('r16.survey_native_calls',true),''),'0')::int+1)::text,true);
    IF $5 IS NULL THEN PERFORM set_config('r16.survey_full_calls',(COALESCE(NULLIF(current_setting('r16.survey_full_calls',true),''),'0')::int+1)::text,true);END IF;
    RETURN QUERY SELECT n.root_id,n.input_digest,n.question_key,n.question_digest,n.wire,n.scope_basis,n.candidate,n.scope_state,n.answer,n.body_octets,n.platform_octets FROM pg_temp.survey_native_rows n
     WHERE n.workspace_id=$1 AND n.configuration_id=$2 AND n.map_id=$3 AND n.ctx=$4 AND($5 IS NULL OR n.root_id=ANY($5));
   END $$;
   CREATE FUNCTION pg_temp.survey_human_exists(uuid,uuid,uuid,uuid,text,text,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM pg_temp.survey_human h WHERE h.workspace_id=$1 AND h.configuration_id=$2 AND h.map_id=$3 AND h.root_id=$4 AND h.input_digest=$5 AND h.ctx=$6 AND h.question_digest=$7) $$;
   CREATE FUNCTION pg_temp.survey_wire_bytes(jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN IF $1 ? 'DO_NOT_ENCODE' THEN RAISE EXCEPTION 'ineligible_wire_was_encoded';END IF;RETURN octet_length($1::text);END $$;`);
  const [w,cfg,map,run]=Array.from({length:4},()=>randomUUID()),ctx='sha256:'+'a'.repeat(64),roots=Array.from({length:8},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
  for(const [i,id]of roots.entries()){
   const text=i===6?'long '.repeat(4000):'Unicode 😀 e\u0301 é "quoted" \\ \n\t \u2028';await c.query('INSERT INTO pg_temp.survey_items VALUES($1,$2,$3,$4)',[w,map,id,text]);
   const scope=i===4?'awaiting_base':i===5?'excluded':'included',candidate=i!==3;
   for(const [key,wire]of [['alpha','{"type":"noul","n":1.00,"rules":"emoji 😀"}'],['beta','[null,true,1.0,"combining é",{"nested":"☕"}]'],['escaped',JSON.stringify({rules:'quote " backslash \\ newline\n tab\t control\u0001 separator\u2028'})]]as const){
    const digest='sha256:'+'b'.repeat(64);await c.query('INSERT INTO pg_temp.survey_native_rows VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15)',[w,cfg,map,ctx,id,'sha256:'+'c'.repeat(64),key,digest,(i===3||i===4||i===5)?'{"DO_NOT_ENCODE":true,"giant":"'+('x'.repeat(200000))+'"}':wire,i%2?null:'sha256:'+'d'.repeat(64),candidate,scope,i===7?'true':null,Buffer.byteLength(text),i%2?0:4]);
   }
  }
  await c.query('INSERT INTO pg_temp.survey_sent VALUES($1,$2,$3,$4)',[w,run,roots[1],'sha256:'+'b'.repeat(64)]);
  await c.query('INSERT INTO pg_temp.survey_human VALUES($1,$2,$3,$4,$5,$6,$7)',[w,cfg,map,roots[2],'sha256:'+'c'.repeat(64),ctx,'sha256:'+'b'.repeat(64)]);
  // Nullable transport fields are tested independently from legal native schema PKs.
  await c.query('INSERT INTO pg_temp.survey_native_rows VALUES($1,$2,$3,$4,$5,$6,\'nullable_key\',NULL,NULL,NULL,true,\'included\',NULL,24,NULL)',[w,cfg,map,ctx,roots[0],'sha256:'+'c'.repeat(64)]);
  await c.query('COMMIT');
  const bind=(sql:string)=>sql.replaceAll('signal_listening_wire_population_roots_v1','pg_temp.survey_wire_native').replaceAll('signal_listening_call_questions','pg_temp.survey_sent').replaceAll('signal_listening_human_decision_exists_v1','pg_temp.survey_human_exists').replaceAll('signal_mass_labeling_items item','pg_temp.survey_items item').replaceAll('octet_length(p.wire::text)','pg_temp.survey_wire_bytes(p.wire)');
  const old=bind(SURVEY_SCALAR_BEFORE_SQL_V1),next=bind(buildSurveyWireScalarCandidateV1(SURVEY_SCALAR_BEFORE_SQL_V1));
  await readOnly(c,async()=>{
   const base:unknown[]=[w,cfg,map,ctx,run,4096,1024,roots,String(512*1024*1024)];
   for(const[name,ids,budget]of [['bounded',roots,512*1024*1024],['empty',[],0],['full-null',null,512*1024*1024],['zero-budget',roots,0],['cursor-subset',roots.slice(4),512*1024*1024]]as const){
    const p=[...base];p[7]=ids;p[8]=String(budget);await paired(c,p,'synthetic-'+name,{old,next});
    if(name==='empty'){await c.query("SELECT set_config('r16.survey_full_calls','0',true)");await c.query(next,p);assert.equal((await c.query("SELECT current_setting('r16.survey_full_calls') n")).rows[0].n,'0','empty representatives never activate FULL(NULL)');}
   }
  });
 }finally{c.release();await db.end();}
});

async function nativePermissions(c:PoolClient,params:unknown[]){
 const role='r16_scalar_'+randomUUID().replaceAll('-',''),quoted='"'+role+'"';await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 try{
  const owner=(await c.query("SELECT current_database() database,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0];assert.match(owner.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.equal(owner.super,true);
  await c.query('CREATE ROLE '+quoted+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');await c.query('GRANT USAGE ON SCHEMA public,extensions TO '+quoted);await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+quoted);await c.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO '+quoted);
  const attempt=async(sql:string)=>{await c.query('SAVEPOINT scalar_acl');try{await c.query('SET LOCAL ROLE '+quoted);return{code:null,rows:(await c.query(sql,params)).rows};}catch(e){return{code:String((e as{code?:string}).code),rows:null};}finally{await c.query('ROLLBACK TO SAVEPOINT scalar_acl');await c.query('RELEASE SAVEPOINT scalar_acl');}};
  const before=SURVEY_SCALAR_BEFORE_SQL_V1,after=buildSurveyWireScalarCandidateV1(before);assert.deepEqual(await attempt(after),await attempt(before));
  for(const[table,column]of [['signal_listening_questions','wire'],['signal_listening_questions','definition'],['signal_mass_labeling_items','root_fingerprint'],['mentions','text_clean']]as const){
   await c.query('SAVEPOINT scalar_revoke');
   const columns=(await c.query('SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',[table])).rows.map(r=>String(r.attname));assert.ok(columns.includes(column));
   await c.query('REVOKE SELECT ON TABLE '+table+' FROM PUBLIC,'+quoted);await c.query('GRANT SELECT('+columns.filter(k=>k!==column).map(k=>'"'+k.replaceAll('"','""')+'"').join(',')+') ON TABLE '+table+' TO '+quoted);
   const old=await attempt(before),next=await attempt(after);assert.equal(old.code,'42501');assert.deepEqual(next,old,'same original invoker column permission denial');await c.query('ROLLBACK TO SAVEPOINT scalar_revoke');await c.query('RELEASE SAVEPOINT scalar_revoke');
  }
  parity.push({name:'native-column-ACL',old_new_SQLSTATE_equal:true,denied_columns:4,all_role_and_grant_changes_rolled_back:true});
 }finally{await c.query('ROLLBACK');}
}

test('Survey scalar native PostgreSQL parity preserves source0337 permissions and current scope',{skip:!enabled,timeout:600000},async()=>{
 await prerequisites();await runMassLabelingAcceptanceFixtureV1('product',{wire_octet_probe:true,beforeProcessing:async ctx=>{
  const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};await ctx.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND status='queued'",[ctx.run_id]);
  const base=signalListeningBaseTemplateV1({category:'synthetic Unicode bicycles',lexicon_terms:['synthetic']});base.instructions+=' Quotes " slash \\ emoji 😀 combining e\u0301 and separators \u2028.';
  const configuration=validateSignalListeningConfigurationV1({...base,questions:[...base.questions,{key:'choice_extra',type:'choice',text:'Extra all-scope ☕',scope:'all',origin:'brand_os',human_locked:false,options:[{key:'a',definition:'α " \\'},{key:'b',definition:'β\n\t'}]},
   {key:'awaiting_large',type:'choice',text:'Never encode before consumer scope',scope:'consumer_category',origin:'brand_os',human_locked:false,options:Array.from({length:32},(_,i)=>({key:'option_'+i,definition:('synthetic '+i+' ').padEnd(1600,'x')}))}]});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration});const req=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const store=createSignalListeningStoreV1({database:ctx.database,page_size:4096,storeRaw:async()=>{throw Error('no provider');}}),run=await store.claim(req.run_id);assert.ok(run);
  const ids=(await ctx.database.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[ctx.workspace_id,ctx.map_id])).rows.map(r=>String(r.root_id));assert.equal(ids.length,3);
  const c=await ctx.database.connect();try{
   const proof=await assertSurveyScalarWireSourceV1(),runtime=(await c.query("SELECT prosrc FROM pg_proc WHERE oid='public.signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::regprocedure")).rows[0];assert.equal(surveyScalarShaV1(runtime.prosrc),proof.prosrc_sha256);
   let rows:Array<{root_id:string;working_bytes:string}>=[];
   await readOnly(c,async()=>{
    const params=asParams(run,cfg.id,ctx.map_id,ids);rows=await paired(c,params,'native-small-all');
    assert.ok(rows.length>0);const first=Number(rows[0]!.working_bytes);
    for(const[caseName,bytes]of [['zero',0],['first-oversize',first-1],['exact-first',first],['all',512*1024*1024]]as const)await paired(c,asParams(run,cfg.id,ctx.map_id,ids,4096,bytes),'native-'+caseName);
    await paired(c,asParams(run,cfg.id,ctx.map_id,[]),'native-empty');await paired(c,asParams(run,cfg.id,ctx.map_id,null),'native-full-null');await paired(c,asParams(run,cfg.id,ctx.map_id,ids.slice(1)),'native-cursor-subset');
    for(const[index,value]of [[0,randomUUID()],[1,randomUUID()],[2,randomUUID()],[3,'sha256:'+'f'.repeat(64)]]as const){const p=asParams(run,cfg.id,ctx.map_id,ids);p[index]=value;await paired(c,p,'native-changed-scope-'+index);}
   });
   await nativePermissions(c,asParams(run,cfg.id,ctx.map_id,ids));
  }finally{c.release();}
  const input=(await store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024}))[0]!;const request=buildSignalListeningJevRequestV1(input,configuration),request_digest=signalListeningRequestDigestV1(run,input,request);
  const reserved=await store.reserve(run,[{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000}]);assert.equal(reserved.length,1);
  const sentClient=await ctx.database.connect();try{await readOnly(sentClient,async()=>{const rows=await paired(sentClient,asParams(run,cfg.id,ctx.map_id,ids),'native-fresh-sent');assert.ok(!rows.some(r=>r.root_id===input.root_id));});}finally{sentClient.release();}
  await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'human',configuration:{...configuration,instructions:configuration.instructions+' A new current publication.'}});
  await store.withInputSurvey(run,{max_rows:4096,max_working_bytes:512*1024*1024},async scope=>assert.deepEqual(scope.hints,[]));
  parity.push({name:'native-latest-publication',old_product_reader_rechecks_current_configuration:true});
 }});
});

async function privateJson(name:string,value:unknown){
 const directory=resolve(process.env.R16_SURVEY_WIRE_SCALARS_EVIDENCE_DIR!);await mkdir(directory,{recursive:true,mode:0o700});const s=await lstat(directory);assert.ok(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o700);
 const allowed=new Set(['survey-wire-scalars-source.json','survey-wire-scalars-parity.json','survey-wire-scalars-profile.json','survey-wire-scalars.tap']);for(const f of await readdir(directory))assert.ok(allowed.has(f));
 const raw=JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(raw)<=8*1024*1024,'per JSON artifact cap');const f=await open(join(directory,name),'wx',0o600);try{await f.writeFile(raw);await f.sync();}finally{await f.close();}
}
async function writeEvidence(nativeWire:unknown,closure:unknown){
 assert.ok(sourceState.expected&&sourceState.before);const after=await captureR16SourceProvenanceV1(repo);assert.deepEqual(after,sourceState.expected);
 const current=(path:string)=>readFile(join(repo,path));const workflow='.github/workflows/mfp-postgres.yml',packager='scripts/r16/package-survey-wire-scalars.py';const workflowAfter=surveyScalarShaV1(await current(workflow)),packagerAfter=surveyScalarShaV1(await current(packager));
 assert.equal(process.env.R16_SURVEY_WORKFLOW_SHA_BEFORE,workflowAfter);assert.equal(process.env.R16_SURVEY_PACKAGER_SHA_BEFORE,packagerAfter);
 const status=execFileSync('git',['status','--porcelain=v1','-z'],{cwd:repo});assert.equal(surveyScalarShaV1(status),EMPTY);assert.equal(process.env.R16_SURVEY_STATUS_SHA_BEFORE,EMPTY);
 const control={contract:'r16-survey-wire-scalars-workflow-control-v1',github:Object.fromEntries(['GITHUB_SHA','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'].map(k=>[k,process.env[k]])),
  workflow:{path:workflow,sha256_before:process.env.R16_SURVEY_WORKFLOW_SHA_BEFORE,sha256_after:workflowAfter},packager:{path:packager,sha256_before:process.env.R16_SURVEY_PACKAGER_SHA_BEFORE,sha256_after:packagerAfter},
  git_status:{sha256_before:EMPTY,sha256_after:EMPTY,clean_before:true,clean_after:true}};
 const flags={diagnostic_only:true,cpu:'UNKNOWN',gain_claim:false,capacity_claim:false,H1_accepted:false,external_provider_requests:0,external_provider_spend_micro_usd:0};
 await privateJson('survey-wire-scalars-source.json',{contract:'r16-survey-wire-scalars-source-v1',...flags,source:{expected_git:sourceState.expected,before:sourceState.before,after},control,native_wire:nativeWire,product_reader:{source353_sha256:SURVEY_SCALAR_BEFORE_PRODUCT_SHA_V1,actual_sha256:surveyScalarShaV1(await current('infrastructure/db/signal-listening-runs.ts')),activated:false},closure});
 await privateJson('survey-wire-scalars-parity.json',{contract:'r16-survey-wire-scalars-parity-v1',...flags,cases:parity,all_complete_rows_compared:true,runtime_witness:nativeWitness,closure});
 await privateJson('survey-wire-scalars-profile.json',{contract:'r16-survey-wire-scalars-profile-v1',...flags,cases:profiles,params_redacted:true,auto_explain_used:false,materiality_gate:false});
}

test('Survey scalar native32768 PostgreSQL ABBA reports client and server time without capacity claims',{skip:!enabled,timeout:3300000},async()=>{
 await prerequisites();const proof=await assertSurveyScalarWireSourceV1(),workload=r16ListeningWorkloadV2('defined_consumer_second_pass');const directory=await mkdtemp(join(tmpdir(),'r16-survey-scalars-'));
 const http=await startR16HttpFilesystemStorageV1(directory),storage=createWorkspaceEngineStorageV1({url:http.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'});let returned=false,closed=false,removed=false;
 try{
  const fixture=createR16ListeningNativeFixtureV1({loadNativeCensus:args=>loadR16ListeningNativeCensusV1(args)});
  await fixture({workload,storage},async f=>{
   assert.equal(f.root_ids.length,32768);assert.equal(new Set(f.root_ids).size,32768);
   const wrapped=await withR16ListeningRuntimeWitnessV1(f.access.database,async()=>{
    const store=createSignalListeningRuntimeStoreV1(f.access.database,{execution:{max_in_flight:1024,window_size:4096,max_buffered_bytes:512*1024*1024,flush_size:1024,max_flushes:2,flush_interval_ms:250},storage});
    const run=await store.claim(f.run_id);assert.ok(run);const ids=[...f.root_ids].sort().slice(0,4096),client=await f.access.database.connect();
    try{
     const proc=(await client.query("SELECT prosrc FROM pg_proc WHERE oid='public.signal_listening_wire_population_roots_v1(uuid,uuid,uuid,text,uuid[],text)'::regprocedure")).rows[0];assert.equal(surveyScalarShaV1(proc.prosrc),proof.prosrc_sha256);
     await readOnly(client,async()=>{
      const p=asParams(run,f.access.configuration_id,f.access.map_id,ids),rows=await paired(client,p,'native32768-base4096');assert.equal(rows.length,4096);
      for(const[name,params]of [['base4096',p],['full-null',asParams(run,f.access.configuration_id,f.access.map_id,null)],['empty',asParams(run,f.access.configuration_id,f.access.map_id,[])],['first-oversize',asParams(run,f.access.configuration_id,f.access.map_id,ids,4096,Number(rows[0]!.working_bytes)-1)]]as const)profiles.push(await profileSurveyScalarAbbaV1(client,[...params],name));
     });
    }finally{client.release();}
    // Legitimate synthetic native base completion enables consumer questions;
    // no handwritten answers, fake calibration, provider HTTP or guard bypass.
    const selected=(await store.inputs(run,{max_rows:720,max_working_bytes:512*1024*1024})).slice(0,720);assert.equal(selected.length,720);
    const drafts=selected.map(input=>{const request=buildSignalListeningJevRequestV1(input,workload.configuration),request_digest=signalListeningRequestDigestV1(run,input,request);return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};});
    const calls=await store.reserve(run,drafts);assert.equal(calls.length,720);await store.markSubmitting(run,calls);
    const pages=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,workload.configuration),body=buildSyntheticJevResponseV1(request),response=JSON.parse(body),usage=jevUsageV1(response.usage);return{call,raw:JSON.stringify({http_status:200,latency_ms:125,body}),usage,settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1('typesafe',workload.configuration.model,'sync',.042)),result:mapSignalListeningJevResponseV1(input,run.context,workload.configuration,response)};});
    await store.persistRawPage(run,pages);await store.settlePage(run,pages);await store.apply(run,pages.map(row=>({call:row.call,results:[row.result]})));await store.renew(run);
    const consumer=await f.access.database.connect();try{await readOnly(consumer,async()=>{const p=asParams(run,f.access.configuration_id,f.access.map_id,ids);await paired(consumer,p,'native32768-current-consumer-mixed4096');profiles.push(await profileSurveyScalarAbbaV1(consumer,p,'consumer-mixed4096'));});}finally{consumer.release();}
   });nativeWitness=wrapped.runtime_witness;
  });returned=true;
 }finally{await http.close();closed=true;await rm(directory,{recursive:true,force:true});removed=true;}
 assert.ok(returned&&closed&&removed);await writeEvidence({migration_sha256:proof.migration_sha256,prosrc_sha256:proof.prosrc_sha256,runtime_checked:true},{native_fixture_returned:returned,synthetic_storage_closed:closed,synthetic_storage_removed:removed,all_profile_transactions_rollback_ack:true});
});
