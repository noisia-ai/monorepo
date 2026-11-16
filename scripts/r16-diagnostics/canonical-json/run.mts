import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {candidateSql,fixtures,timedSql} from './candidate.mjs';

const instruments=['scripts/r16-diagnostics/canonical-json/candidate.mts','scripts/r16-diagnostics/canonical-json/run.mts','scripts/r16-diagnostics/canonical-json/run.test.mts','.github/workflows/mfp-postgres.yml'];
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function guard(env:NodeJS.ProcessEnv):void{
 assert.equal(env.GITHUB_ACTIONS,'true','real CI required');
 assert.equal(env.NOISIA_R16_CANONICAL_READONLY,'true','explicit diagnostic required');
 assert.equal(env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 for(const name of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(env[name]??'',/^[1-9]\d*$/u);
 const u=new URL(env.DATABASE_URL??'');
 assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.username,'postgres');assert.equal(u.pathname,'/noisia_mfp_ci');
 assert.match(u.port,/^\d+$/u);assert.equal(u.search,'');assert.equal(u.hash,'');
}
export function artifactPath(root:string,id:string,attempt:string):string{
 assert.match(id,/^[1-9]\d*$/u);assert.match(attempt,/^[1-9]\d*$/u);
 const base=resolve(root,'.data/piloto-masivo/r16/canonical-json');
 const dest=resolve(base,`${id}-${attempt}`,'result.json');
 assert.ok(relative(base,dest).startsWith(`${id}-${attempt}${sep}`));return dest;
}
export async function writePrivateArtifact(dest:string,value:unknown):Promise<void>{
 await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});
 await writeFile(dest,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
export type GuardPhase='schema-relations'|'schema-count'|'schema-catalog'|'schema-singleton';
export type GuardContext={phase:GuardPhase;table?:string;actual_count?:number;expected_count?:number};
/** Only owned synthetic-lab metadata, never driver messages, queries or values. */
export function guardDiagnostic(error:unknown,context:GuardContext){
 assert.ok(['schema-relations','schema-count','schema-catalog','schema-singleton'].includes(context.phase));
 const safe:{phase:GuardPhase;code:string;table?:string;actual_count?:number;expected_count?:number}={phase:context.phase,code:observationError(error).code};
 if(context.table!==undefined){assert.match(context.table,/^[A-Za-z_][A-Za-z_0-9]{0,62}$/u);safe.table=context.table;}
 for(const key of ['actual_count','expected_count'] as const)if(context[key]!==undefined){assert.ok(Number.isSafeInteger(context[key])&&context[key]!>=0);safe[key]=context[key];}
 return safe;
}
export function observationError(error:unknown):{state:'censored'|'error';code:string}{
 const raw=typeof error==='object'&&error!==null&&'code' in error?error.code:undefined;
 const code=typeof raw==='string'&&/^[A-Z0-9_]{1,40}$/u.test(raw)?raw:'unknown';
 return {state:code==='57014'||code==='54001'?'censored':'error',code};
}
export function verdict(rows:Array<{complete:boolean;equal:boolean|null}>,timings:Array<{arm:string;ms:number}>):string{
 if(rows.some(x=>x.equal===false))return 'rejected-byte-mismatch';
 if(rows.some(x=>!x.complete))return 'censored-no-equivalence-proof';
 const old=timings.filter(x=>x.arm==='old'),candidate=timings.filter(x=>x.arm==='candidate');
 if(!old.length||old.length!==candidate.length)return 'unavailable-timing';
 const sum=(values:typeof old)=>values.reduce((a,x)=>a+x.ms,0);
 if(sum(candidate)>=sum(old))return 'rejected-not-faster';
 if(candidate.some((x,i)=>x.ms>=old[i]!.ms))return 'rejected-unstable-speed';
 return 'diagnostic-only-faster-not-production-proof';
}
async function seal(){
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim(),'','tracked source must be clean');
 const files=[...instruments,...execFileSync('git',['ls-files','infrastructure/db/migrations/*.sql'],{encoding:'utf8'}).trim().split('\n')];
 for(const f of instruments)execFileSync('git',['ls-files','--error-unmatch',f],{stdio:'pipe'});
 return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:await Promise.all(files.map(async path=>({path,sha256:hash(await readFile(path))})))};
}
export async function run():Promise<void>{
 guard(process.env);
 const before=await seal();
 const cases=fixtures();
 const {openR16CiPostgresV1,assertR16LocalPostgresPoolV1}=await import('../../../infrastructure/db/migrations/signal-r16-local-pg.fixture.js');
 const pool=await openR16CiPostgresV1();assertR16LocalPostgresPoolV1(pool);
 const client=await pool.connect();
 const result:Record<string,unknown>={diagnostic_only:true,h1_accepted:false,production_adoption:false,source:before,fixture_kind:'synthetic-only',clock:'client-wall-ms-not-CPU',timing_scope:'helper-only-not-trigger-pipeline',timing_overhead:'client-timer-and-result-consumption-included',candidate_sql_sha256:hash(candidateSql)};
 const observations:Array<{id:string;complete:boolean;equal:boolean|null;old?:unknown;candidate?:unknown}>=[];
 const timings:Array<{context:string;order:string;round:number;arm:string;ms:number;consumed:unknown}>=[];
 let primary:unknown;
 let schemaAttested=false;
 let guardContext:GuardContext={phase:'schema-relations'};
 let original:unknown;
 async function originals(){return (await client.query(`SELECT p.oid::text, p.proname, pg_get_functiondef(p.oid) definition,p.proacl::text acl FROM pg_proc p WHERE p.oid IN ('public.signal_labeling_json_v1(jsonb)'::regprocedure,'public.signal_labeling_digest_v1(jsonb)'::regprocedure) ORDER BY p.oid`)).rows;}
 try{
  // The workflow first proves an empty public schema before migrations. These are
  // the only migration-seeded catalogs/state; all other real relations must be empty.
  const seeds:Record<string,number>={taxonomies:3,taxonomy_terms:6,methodology_taxonomy_bindings:3,signal_mention_text_digest_backfill_state:1,signal_topic_context_identity_cuts_v1:1};
  const {rows:tables}=await client.query<{name:string}>(`SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  assert.ok(tables.length>0);
  for(const {name} of tables){
   assert.match(name,/^[A-Za-z_][A-Za-z_0-9]{0,62}$/u);
   guardContext={phase:'schema-count',table:name,expected_count:seeds[name]??0};
   const {rows:[r]}=await client.query(`SELECT count(*)::int AS n FROM public."${name}"`);
   if(Number.isSafeInteger(Number(r.n))&&Number(r.n)>=0)guardContext.actual_count=Number(r.n);
   assert.equal(r.n,seeds[name]??0,`fresh schema guard: ${name}`);
  }
  guardContext={phase:'schema-catalog',table:'taxonomies'};
  const {rows:[catalog]}=await client.query(`SELECT array_agg(taxonomy_key ORDER BY taxonomy_key) keys FROM public.taxonomies`);
  assert.deepEqual(catalog.keys,['barrier','tb_layer','trigger']);
  for(const table of ['signal_mention_text_digest_backfill_state','signal_topic_context_identity_cuts_v1']){
   guardContext={phase:'schema-singleton',table};
   const {rows:[r]}=await client.query(`SELECT bool_and(singleton) ok FROM public.${table}`);assert.equal(r.ok,true);
  }
  schemaAttested=true;
  original=await originals();result.original_functions_sha256=hash(JSON.stringify(original));
  result.guc=(await client.query(`SELECT current_setting('work_mem') work_mem,current_setting('jit') jit,current_setting('server_version') server_version,current_setting('max_stack_depth') max_stack_depth,current_setting('server_encoding') server_encoding,current_setting('standard_conforming_strings') standard_conforming_strings`)).rows[0];
  result.phase='temporary-setup';
  await client.query('BEGIN');await client.query(`SET LOCAL statement_timeout='15s'`);
  await client.query(`CREATE TEMP TABLE r16_canonical_cases(case_id text PRIMARY KEY,payload jsonb,deep boolean NOT NULL) ON COMMIT DROP`);
  for(const f of cases)await client.query('INSERT INTO pg_temp.r16_canonical_cases VALUES($1,$2::jsonb,$3)',[f.id,f.json,f.deep]);
  await client.query(candidateSql);
  const {rows:[attrs]}=await client.query(`SELECT proisstrict,provolatile FROM pg_proc WHERE oid='pg_temp.r16_json_flat_v1(jsonb)'::regprocedure`);assert.equal(attrs.proisstrict,true);assert.equal(attrs.provolatile,'i');
  result.phase='correctness';
  for(const f of cases){
   const outcomes:Record<string,{state:string;bytes?:string|null;digest?:string|null;code?:string}>={};
   for(const arm of ['old','candidate'] as const){
    await client.query('SAVEPOINT one_case');
    try{
     const fn=arm==='old'?'public.signal_labeling_json_v1':'pg_temp.r16_json_flat_v1';
     const {rows:[row]}=await client.query(`WITH serialized AS MATERIALIZED (SELECT ${fn}(payload) value FROM pg_temp.r16_canonical_cases WHERE case_id=$1) SELECT encode(convert_to(value,'UTF8'),'hex') bytes, CASE WHEN value IS NULL THEN NULL ELSE 'sha256:'||encode(sha256(convert_to(value,'UTF8')),'hex') END digest FROM serialized`,[f.id]);
     // Compare exact PostgreSQL UTF8 bytes; never parse JSON/numerics in JavaScript.
     outcomes[arm]={state:'complete',bytes:row.bytes,digest:row.digest};
     if(arm==='old'){
      const {rows:[d]}=await client.query('SELECT public.signal_labeling_digest_v1(payload) digest FROM pg_temp.r16_canonical_cases WHERE case_id=$1',[f.id]);assert.equal(d.digest,row.digest);
     }
    }catch(error){outcomes[arm]=observationError(error);await client.query('ROLLBACK TO SAVEPOINT one_case');if(outcomes[arm]!.state==='error')throw error;}
    finally{await client.query('RELEASE SAVEPOINT one_case');}
   }
   const old=outcomes.old!,candidate=outcomes.candidate!;
   const complete=old.state==='complete'&&candidate.state==='complete';
   const equal=complete?old.bytes===candidate.bytes&&old.digest===candidate.digest:null;
   observations.push({id:f.id,complete,equal,old:{state:old.state,code:old.code,utf8_bytes:old.bytes===null?null:old.bytes?.length! /2},candidate:{state:candidate.state,code:candidate.code,utf8_bytes:candidate.bytes===null?null:candidate.bytes?.length! /2}});
   if(equal===false)break;
  }
  result.correctness=observations;
  if(!observations.some(x=>x.equal===false)){
   result.phase='timing';
   // Warm both contexts, then balanced AB/BA rounds against the identical table.
   const contexts=[...cases.filter(f=>!f.deep).map(f=>({name:`single:${f.id}`,single:true,binds:[f.id]})),{name:'batch',single:false,binds:[]}];
   for(const context of contexts){
    for(const arm of ['old','candidate'] as const)await client.query(timedSql(arm,context.single),context.binds);
    let reference:unknown;
    for(let round=0;round<4;round++)for(const arm of (round%2===0?['old','candidate']:['candidate','old']) as Array<'old'|'candidate'>){
     const start=performance.now();const {rows:[consumed]}=await client.query(timedSql(arm,context.single),context.binds);
     const ms=performance.now()-start;
     assert.equal(consumed.rows,context.single?1:cases.filter(f=>!f.deep).length);assert.match(consumed.digest,/^[a-f0-9]{64}$/u);
     if(reference===undefined)reference=consumed;else assert.deepEqual(consumed,reference,'timed arms must consume identical bytes/digest');
     timings.push({context:context.name,round,order:round%2===0?'AB':'BA',arm,ms,consumed});
    }
   }
   result.phase='explain';
   const plans=[];
   for(const single of [true,false])for(const arm of ['old','candidate'] as const){
    const {rows:[r]}=await client.query('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+timedSql(arm,single),single?['warmup-large-0']:[]);
    const p=r['QUERY PLAN'][0];plans.push({arm,context:single?'single':'batch',planning_ms:p['Planning Time'],execution_ms:p['Execution Time'],root_node:p.Plan['Node Type'],temp_read_blocks:p.Plan['Temp Read Blocks']??null,temp_written_blocks:p.Plan['Temp Written Blocks']??null});
   }
   result.plans=plans;
  }
  result.timings=timings;result.verdict=verdict(observations,timings);
  assert.deepEqual(await originals(),original,'public protocol functions changed');
  await client.query('ROLLBACK');result.phase='complete';
 }catch(error){primary=error;result.error=observationError(error);result.verdict='diagnostic-error';try{await client.query('ROLLBACK');}catch{/* preserve primary */}}
 finally{
  if(schemaAttested){
   try{
    if(original!==undefined)assert.deepEqual(await originals(),original,'public protocol functions changed');
    result.source_end=await seal();assert.deepEqual(result.source_end,before);
    result.seals_unchanged=true;
   }catch(error){result.seals_unchanged=false;result.seal_error=observationError(error);primary??=error;result.verdict='diagnostic-error';}
  }
  client.release();await pool.end();
 }
 if(!schemaAttested){
  const diagnostic=guardDiagnostic(primary,guardContext);
  console.error(JSON.stringify({diagnostic_only:true,fresh_schema_guard:diagnostic,artifact_created:false,temporary_ddl_started:false}));
  const failure=new Error('fresh schema guard failed; no artifact created') as Error&{code:string};
  failure.code=diagnostic.code;throw failure;
 }
 // Guards ran before the first temporary write or artifact creation.
 const dest=artifactPath(process.cwd(),process.env.GITHUB_RUN_ID!,process.env.GITHUB_RUN_ATTEMPT!);
 await writePrivateArtifact(dest,result);
 console.log(JSON.stringify({diagnostic_only:true,h1_accepted:false,verdict:result.verdict,artifact_relative:relative(process.cwd(),dest),artifact_sha256:hash(await readFile(dest))}));
 if(primary)throw new Error('canonical diagnostic failed; see private scalar artifact');
 if(observations.some(x=>x.equal===false))throw new Error('canonical candidate rejected: byte mismatch');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await run();
