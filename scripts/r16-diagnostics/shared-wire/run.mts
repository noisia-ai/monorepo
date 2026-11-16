import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {candidateSql,fixtures,fixtureConfigurations,correctnessSql} from './candidate.mjs';
import type {ValidatorObservation,NativePublicSeal} from './validator.mjs';

// Guard and evidence boundaries derive from the reviewed 4614ab80 canonical
// diagnostic. This is an experimental branch override, never a release workflow.
const instruments=['scripts/r16-diagnostics/shared-wire/candidate.mts','scripts/r16-diagnostics/shared-wire/run.mts',
 'scripts/r16-diagnostics/shared-wire/run.test.mts','scripts/r16-diagnostics/shared-wire/validator.mts',
 'infrastructure/db/migrations/signal-listening-money.synthetic.fixture.ts',
 'infrastructure/db/migrations/signal-listening-money-batches.postgres.test.ts','.github/workflows/mfp-postgres.yml'];
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function guard(env:NodeJS.ProcessEnv):void{
 assert.equal(env.GITHUB_ACTIONS,'true','real CI required');
 assert.equal(env.NOISIA_R16_SHARED_WIRE_READONLY,'true','explicit diagnostic required');
 assert.equal(env.NOISIA_R16_LOCAL_PG_LAB,'r16-benchmark-pg17');
 for(const name of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(env[name]??'',/^[1-9]\d*$/u);
 for(const name of ['TYPESAFE_API_KEY','ANTHROPIC_API_KEY','VOYAGE_API_KEY','OPENAI_API_KEY'])assert.ok(!env[name]?.trim(),'provider credentials forbidden');
 const u=new URL(env.DATABASE_URL??'');
 assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.username,'postgres');assert.equal(u.pathname,'/noisia_mfp_ci');
 assert.match(u.port,/^\d+$/u);assert.equal(u.search,'');assert.equal(u.hash,'');
}
export function artifactPath(root:string,id:string,attempt:string):string{
 assert.match(id,/^[1-9]\d*$/u);assert.match(attempt,/^[1-9]\d*$/u);
 const base=resolve(root,'.data/piloto-masivo/r16/shared-wire-validator'),dest=resolve(base,`${id}-${attempt}`,'result.json');
 assert.ok(relative(base,dest).startsWith(`${id}-${attempt}${sep}`));return dest;
}
export async function writePrivateArtifact(dest:string,value:unknown):Promise<void>{
 await mkdir(resolve(dest,'..'),{recursive:true,mode:0o700});
 await writeFile(dest,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
// 0041 seeds three catalogs; 0289 the current identity cut. 0169 drops the
// temporary 0167 backfill relation. Its presence, even empty, rejects the lab.
export const currentSeedCounts:Readonly<Record<string,number>>=Object.freeze({taxonomies:3,taxonomy_terms:6,methodology_taxonomy_bindings:3,signal_topic_context_identity_cuts_v1:1});
export function assertCurrentSeedRelations(names:readonly string[]):void{
 assert.ok(!names.includes('signal_mention_text_digest_backfill_state'),'retired backfill relation must be absent');
 for(const name of Object.keys(currentSeedCounts))assert.ok(names.includes(name),'current migration-seeded relation must exist');
}
type GuardContext={phase:'schema-relations'|'schema-count'|'schema-catalog'|'schema-singleton';table?:string;actual_count?:number;expected_count?:number};
export function observationError(error:unknown):{state:'censored'|'error';code:string}{
 const raw=typeof error==='object'&&error!==null&&'code'in error?error.code:undefined;
 const code=typeof raw==='string'&&/^[A-Z0-9_]{1,40}$/u.test(raw)?raw:'unknown';
 return {state:code==='57014'||code==='54001'?'censored':'error',code};
}
type Observation={id:string;complete:boolean;equal:boolean|null;old?:unknown;candidate?:unknown};
type Consumption={rows:number;bytes:string|null;digest:string};
type Timing={context:string;round:number;arm:string;ms:number;consumed?:Consumption};
export function verdict(rows:Array<Pick<Observation,'complete'|'equal'>>,timings:Timing[]):string{
 if(rows.some(x=>x.equal===false))return 'rejected-byte-mismatch';
 if(!rows.length||rows.some(x=>!x.complete||x.equal!==true))return 'censored-no-equivalence-proof';
 const groups=new Map<string,Map<string,Timing>>();
 for(const t of timings){const key=`${t.context}:${t.round}`,group=groups.get(key)??new Map();
  if(group.has(t.arm)||!['old','candidate'].includes(t.arm)||!Number.isFinite(t.ms)||t.ms<0)return 'unavailable-timing';
  group.set(t.arm,t);groups.set(key,group);
 }
 if(!groups.size||[...groups.values()].some(g=>g.size!==2))return 'unavailable-timing';
 const pairs=[...groups.values()].map(g=>({old:g.get('old')!,candidate:g.get('candidate')!}));
 if(pairs.reduce((n,p)=>n+p.candidate.ms,0)>=pairs.reduce((n,p)=>n+p.old.ms,0))return 'rejected-not-faster';
 if(pairs.some(p=>p.candidate.ms>=p.old.ms))return 'rejected-unstable-speed';
 return 'diagnostic-only-faster-not-production-proof';
}
async function seal(){
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim(),'','tracked source must be clean');
 const files=[...instruments,...execFileSync('git',['ls-files','infrastructure/db/migrations/*.sql','infrastructure/db/migrations/*.ts',
  'infrastructure/db/*.ts','packages/query-engine/src/*.ts','scripts/r16/listening-workload.ts'],{encoding:'utf8'}).trim().split('\n')];
 for(const f of instruments)execFileSync('git',['ls-files','--error-unmatch',f],{stdio:'pipe'});
 return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:await Promise.all(files.map(async path=>({path,sha256:hash(await readFile(path))})))};
}

export async function run():Promise<void>{
 guard(process.env);
 const before=await seal(),cases=fixtures();
 const {openR16CiPostgresV1,assertR16LocalPostgresPoolV1}=await import('../../../infrastructure/db/migrations/signal-r16-local-pg.fixture.js');
 const pool=await openR16CiPostgresV1();assertR16LocalPostgresPoolV1(pool);
 const client=await pool.connect();
 const result:Record<string,unknown>={diagnostic_only:true,h1_accepted:false,production_adoption:false,
  native_five_validator_nine_defect_oracle_executed:false,source:before,fixture_kind:'synthetic-current-compiler-base2-consumer2',
  candidate_dml_executed:false,fixture_original_dml:true,
  timing_scope:'not-executed-correctness-only',candidate_sql_sha256:hash(candidateSql)};
 const observations:Observation[]=[],timings:Timing[]=[];
 const native:ValidatorObservation[]=[];
 const nativeSeals:NativePublicSeal[]=[];
 let primary:unknown,schemaAttested=false,original:unknown,guardContext:GuardContext={phase:'schema-relations'};
 async function originals(){return(await client.query(`SELECT p.oid::text,to_jsonb(p) metadata,p.proacl::text acl,
  CASE WHEN p.prokind='a' THEN pg_get_function_identity_arguments(p.oid) ELSE pg_get_functiondef(p.oid) END definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows;}
 try{
  // Fresh schema and current seed metadata are checked BEFORE temporary DDL or
  // artifact creation. Native synthetic setup follows this guard, and cleanup
  // remains scoped to its organization through the existing fixture harness.
  const {rows:tables}=await client.query<{name:string}>(`SELECT c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  assert.ok(tables.length>0);assertCurrentSeedRelations(tables.map(t=>t.name));
  for(const {name}of tables){
   assert.match(name,/^[A-Za-z_][A-Za-z_0-9]{0,62}$/u);guardContext={phase:'schema-count',table:name,expected_count:currentSeedCounts[name]??0};
   const {rows:[r]}=await client.query(`SELECT count(*)::int n FROM public."${name}"`);
   guardContext.actual_count=Number(r.n);assert.equal(r.n,currentSeedCounts[name]??0,'fresh schema guard');
  }
  guardContext={phase:'schema-catalog',table:'taxonomies'};
  assert.deepEqual((await client.query('SELECT array_agg(taxonomy_key ORDER BY taxonomy_key) keys FROM public.taxonomies')).rows[0].keys,['barrier','tb_layer','trigger']);
  guardContext={phase:'schema-singleton',table:'signal_topic_context_identity_cuts_v1'};
  assert.equal((await client.query('SELECT bool_and(singleton) ok FROM public.signal_topic_context_identity_cuts_v1')).rows[0].ok,true);
  schemaAttested=true;original=await originals();result.original_functions_sha256=hash(JSON.stringify(original));
  result.original_function_count=Array.isArray(original)?original.length:null;
  result.guc=(await client.query(`SELECT current_setting('work_mem') work_mem,current_setting('jit') jit,
   current_setting('server_version') server_version,current_setting('max_stack_depth') max_stack_depth,
   current_setting('server_encoding') server_encoding,current_setting('standard_conforming_strings') standard_conforming_strings,
   current_setting('session_replication_role') session_replication_role`)).rows[0];
  assert.equal((result.guc as Record<string,string>).session_replication_role,'origin');
  result.phase='temporary-setup';await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='30s'");
  await client.query(`CREATE TEMP TABLE r16_shared_wire_configurations(configuration_id text PRIMARY KEY,wires jsonb NOT NULL,configuration jsonb) ON COMMIT DROP;
   CREATE TEMP TABLE r16_shared_wire_cases(case_id text PRIMARY KEY,payload jsonb,configuration_id text NOT NULL,phase text NOT NULL,ordinal int NOT NULL,timing boolean NOT NULL) ON COMMIT DROP`);
  for(const c of fixtureConfigurations())await client.query('INSERT INTO pg_temp.r16_shared_wire_configurations VALUES($1,$2::jsonb,$3::jsonb)',[c.id,c.json,c.configuration_json]);
  // Actual compiler wires must agree with the unchanged native SQL wire builder.
  // The precision-only counterfactual is explicitly outside admitted config data.
  result.native_wire_identity=(await client.query(`SELECT count(*)::int questions,
   bool_and(c.wires->(q->>'key') IS NOT DISTINCT FROM public.signal_listening_wire_v1(c.configuration,q)) equal
   FROM pg_temp.r16_shared_wire_configurations c CROSS JOIN LATERAL jsonb_array_elements(c.configuration->'questions') q
   WHERE c.configuration IS NOT NULL`)).rows[0];
  assert.deepEqual(result.native_wire_identity,{questions:8,equal:true});
  const insertSql='INSERT INTO pg_temp.r16_shared_wire_cases VALUES($1,$2::jsonb,$3,$4,$5,$6)';
  for(const f of cases)await client.query(insertSql,[f.id,f.json,f.configuration_id,f.phase,f.ordinal,f.timing]);
  await client.query(candidateSql);
  const attrs=(await client.query("SELECT provolatile FROM pg_proc WHERE oid='pg_temp.r16_shared_wire_json_v1(jsonb,jsonb)'::regprocedure")).rows[0];assert.equal(attrs.provolatile,'i');
  result.phase='correctness';
  for(const f of cases){
   const outcomes:Record<string,{state:string;bytes?:string|null;digest?:string|null;code?:string}>={};
   for(const arm of ['old','candidate']as const){
    await client.query('SAVEPOINT one_case');
    try{
     const {rows:[row]}=await client.query(correctnessSql(arm),[f.id]);
     outcomes[arm]={state:'complete',bytes:row.bytes,digest:row.digest};
     if(arm==='old')assert.equal((await client.query('SELECT public.signal_labeling_digest_v1(payload) digest FROM pg_temp.r16_shared_wire_cases WHERE case_id=$1',[f.id])).rows[0].digest,row.digest);
    }catch(error){outcomes[arm]=observationError(error);await client.query('ROLLBACK TO SAVEPOINT one_case');if(outcomes[arm]!.state==='error')throw error;}
    finally{await client.query('RELEASE SAVEPOINT one_case');}
   }
   const old=outcomes.old!,candidate=outcomes.candidate!,complete=old.state==='complete'&&candidate.state==='complete';
   const equal=complete?old.bytes===candidate.bytes&&old.digest===candidate.digest:null;
   const safe=(v:typeof old)=>({state:v.state,code:v.code,utf8_bytes:v.bytes===null?null:v.bytes===undefined?undefined:v.bytes.length/2});
   observations.push({id:f.id,complete,equal,old:safe(old),candidate:safe(candidate)});
   if(equal===false)break;
  }
  result.correctness=observations;
  if(observations.length===cases.length&&observations.every(x=>x.complete&&x.equal)){
   await client.query('ROLLBACK');
   result.phase='native-six-validator-select';
   const {runNativeValidatorExperiment}=await import('./validator.mjs');
   await runNativeValidatorExperiment(native,nativeSeals);
   result.native_five_validator_nine_defect_oracle_executed=true;
   result.verdict='diagnostic-only-six-validator-select-equivalent-not-production-proof';
  }else{
   result.verdict='censored-no-equivalence-proof';throw Error('helper equivalence required before native SELECT');
  }
  result.timings=timings;
  assert.deepEqual(await originals(),original,'public functions or ACLs changed');
  result.phase='complete';
 }catch(error){primary=error;result.error=observationError(error);result.verdict=observationError(error).state==='censored'?'censored-no-equivalence-proof':'diagnostic-error';try{await client.query('ROLLBACK');}catch{/* retain primary */}}
 finally{
  // Preserve evidence even on an error; a failed seal prevents any positive verdict.
  result.correctness=observations;result.native_validator_cases=native;result.native_public_seals=nativeSeals;result.timings=timings;
  if(schemaAttested){try{
   if(original!==undefined)assert.deepEqual(await originals(),original,'public functions or ACLs changed');
   result.public_functions_unchanged=true;result.source_end=await seal();assert.deepEqual(result.source_end,before);result.seals_unchanged=true;
  }catch(error){result.seals_unchanged=false;result.seal_error=observationError(error);primary??=error;result.verdict='diagnostic-error';}}
  client.release();await pool.end();
 }
 if(!schemaAttested){
  console.error(JSON.stringify({diagnostic_only:true,fresh_schema_guard:{...guardContext,...observationError(primary)},artifact_created:false,temporary_ddl_started:false}));
  throw new Error('fresh schema guard failed; no artifact created');
 }
 const dest=artifactPath(process.cwd(),process.env.GITHUB_RUN_ID!,process.env.GITHUB_RUN_ATTEMPT!);
 await writePrivateArtifact(dest,result);
 console.log(JSON.stringify({diagnostic_only:true,h1_accepted:false,verdict:result.verdict,artifact_relative:relative(process.cwd(),dest),artifact_sha256:hash(await readFile(dest))}));
 if(primary)throw new Error('shared-wire diagnostic failed; see private scalar artifact');
 if(observations.some(x=>x.equal===false))throw new Error('shared-wire candidate rejected: byte mismatch');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await run();
