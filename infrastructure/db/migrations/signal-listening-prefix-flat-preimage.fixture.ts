import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,open,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve,relative} from 'node:path';
import type {PoolClient} from 'pg';
import {runPrefixFunctionProfileV1,withPrefixReadOnlyV1,releasePrefixClientV1} from './signal-listening-prefix-function-profile.fixture';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const sourceURL=new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url);
const candidateURL=new URL('./signal-listening-prefix-flat-preimage.candidate.sql',import.meta.url);
const sourceSHA='7ee6911c892e8633725c5d1ad48d2f257b344d9d7a7a07f5346f9d4142e734ed';
const inputOld='signal_listening_input_digest_v1(i)',basisOld="signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id))";
const revoke='\nREVOKE ALL ON FUNCTION pg_temp.r16_flat_new(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;\n';
export function flatPreimageSourceV1(source:string,candidate:string){
 assert.equal(sha(source),sourceSHA);assert.equal(sha(candidate),'9f605e4aa2d553cf6c9b5b5516eb18b7bb14795bd97d60541a45de4fbba33dd1','approved reversible candidate bytes');
 const expression=(kind:string)=>{const start=`/* flat_${kind}_begin */`,end=`/* flat_${kind}_end */`;
  assert.equal(candidate.split(start).length,3);assert.equal(candidate.split(end).length,3);
  const parts=candidate.split(start).slice(1).map(s=>s.split(end)[0]!);assert.equal(parts[0],parts[1]);return parts[0]!;};
 const input=expression('input'),basis=expression('basis');
 let inverse=candidate.replace('CREATE FUNCTION pg_temp.r16_flat_new','CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1');
 for(const [kind,next,old]of [['input',input,inputOld],['basis',basis,basisOld]])inverse=inverse.split(`/* flat_${kind}_begin */${next}/* flat_${kind}_end */`).join(old);
 assert.ok(inverse.endsWith(revoke));inverse=inverse.slice(0,-revoke.length);assert.equal(inverse,source,'inverse must recover every native0326 byte');
 assert.ok(!/\b(?:GRANT|SECURITY\s+DEFINER|ALTER)\b/iu.test(candidate));
 const preimage=(s:string)=>{const prefix="('sha256:'||encode(sha256(convert_to(",suffix=",'UTF8')),'hex'))";assert.ok(s.startsWith(prefix)&&s.endsWith(suffix));return s.slice(prefix.length,-suffix.length);};
 return{input,basis,input_preimage:preimage(input),basis_preimage:preimage(basis)};
}
async function defaults(c:PoolClient){return(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text,p.proargtypes::text,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('signal_listening_population_roots_v1','signal_listening_statement_money_v1','signal_listening_input_digest_v1','signal_labeling_json_v1','signal_labeling_digest_v1') ORDER BY p.oid`)).rows;}
export async function installFlatPreimageV1(c:PoolClient){
 const source=await readFile(sourceURL,'utf8'),candidate=await readFile(candidateURL,'utf8'),expressions=flatPreimageSourceV1(source,candidate),before=await defaults(c);
 assert.equal(before.length,5);
 const mark=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');assert.equal(before.find(r=>r.proname==='signal_listening_statement_money_v1')!.prosrc,mark.split('AS $$')[1]!.split('$$;')[0]);
 const runtime=(await c.query("SELECT current_database() database,current_setting('server_version_num')::int version")).rows[0];assert.match(runtime.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.notEqual(runtime.database,new URL(process.env.DATABASE_URL!).pathname.slice(1));assert.ok(runtime.version>=170000&&runtime.version<180000);
 const native=before.find(r=>r.proname==='signal_listening_population_roots_v1')!;
 assert.equal(native.prosrc,source.split('AS $function$')[1]!.split('$function$;')[0]);assert.notEqual(native.proacl,null);
 assert.equal((await c.query("SELECT current_setting('transaction_read_only') value")).rows[0].value,'off');
 await c.query('CREATE TEMP TABLE r16_flat_alias_lifetime(probe boolean)');
 await c.query(source.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1','CREATE FUNCTION pg_temp.r16_flat_old')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_flat_old(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
 await c.query(candidate);
 const aliases=(await c.query(`SELECT p.proname,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text,p.proargtypes::text,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset
 FROM pg_proc p WHERE p.pronamespace=pg_my_temp_schema() AND p.proname IN('r16_flat_old','r16_flat_new') ORDER BY p.proname`)).rows;
 assert.equal(aliases.length,2);for(const a of aliases)for(const key of Object.keys(a).filter(k=>k!=='proname'))assert.deepEqual(a[key],native[key],key+' exact native attribute/ACL');
 const effectiveSource=await readFile(new URL('./0316_signal_listening_human_revision_plan.sql',import.meta.url),'utf8');
 const reference=(await c.query("SELECT prosrc FROM pg_proc WHERE oid='public.signal_listening_effective_population_roots_v2(uuid,uuid,uuid,text,uuid[],text)'::regprocedure")).rows[0];
 const effectiveBody=effectiveSource.split('AS $$')[1]!.split('$$;')[0]!;assert.equal(reference.prosrc,effectiveBody);
 let effective=effectiveBody;for(const [name,param]of [['purpose','$6::text'],['roots','$5::uuid[]'],['ctx','$4::text'],['mid','$3::uuid'],['cid','$2::uuid'],['w','$1::uuid']])effective=effective.replace(new RegExp('\\b'+name+'\\b','gu'),param!);
 return{before,expressions,effective,source_sha256:sha(source),candidate_sha256:sha(candidate)};
}
export async function flatScalarKernelV1(c:PoolClient,e:ReturnType<typeof flatPreimageSourceV1>){
 let cases=0;const texts:Array<string|null>=[null,'','null','1.23','1.2300','"\\/\n\r\t\b\f'+String.fromCharCode(1),'é','e\u0301','😀\u2028\u2029',' {"a":[1,null]} ','x'.repeat(65536)];
 for(const root of [null,'11111111-1111-4111-8111-111111111111'])for(const fp of [null,'sha256:'+'a'.repeat(64)])for(const text of texts){
  const r=(await c.query(`WITH i AS(SELECT $1::uuid root_id,$2::text root_fingerprint,$3::text text)
   SELECT convert_to(signal_labeling_json_v1(jsonb_build_object('contract_version','signal-listening-input-v1','root_id',i.root_id,'source_fingerprint',i.root_fingerprint,'text',i.text)),'UTF8') old_bytes,
    convert_to(${e.input_preimage},'UTF8') new_bytes,signal_listening_input_digest_v1(jsonb_populate_record(NULL::signal_mass_labeling_items,jsonb_build_object('root_id',i.root_id,'root_fingerprint',i.root_fingerprint,'text',i.text))) old_digest,${e.input} new_digest FROM i`,[root,fp,text])).rows[0];
  assert.deepEqual(r.new_bytes,r.old_bytes);assert.equal(r.new_digest,r.old_digest);cases++;
 }
 const nullComposite=(await c.query(`WITH i AS(SELECT NULL::uuid root_id,NULL::text root_fingerprint,NULL::text text) SELECT signal_listening_input_digest_v1(NULL::signal_mass_labeling_items) old_digest,${e.input} new_digest FROM i`)).rows[0];assert.equal(nullComposite.new_digest,nullComposite.old_digest);cases++;
 for(const voice of [null,'11111111-1111-4111-8111-111111111111'])for(const promotion of [null,'22222222-2222-4222-8222-222222222222']){
  const r=(await c.query(`WITH v AS(SELECT $1::uuid call_id),p AS(SELECT $2::uuid call_id)
   SELECT convert_to(signal_labeling_json_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id)),'UTF8') old_bytes,convert_to(${e.basis_preimage},'UTF8') new_bytes,
   ${basisOld} old_digest,${e.basis} new_digest FROM v,p`,[voice,promotion])).rows[0];assert.deepEqual(r.new_bytes,r.old_bytes);assert.equal(r.new_digest,r.old_digest);cases++;
 }
 return{cases,input_cases:texts.length*4+1,basis_cases:4,preimage_utf8_equal:true,digest_equal:true};
}
const read=(arm:'old'|'new')=>`SELECT * FROM pg_temp.r16_flat_${arm}($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)`;
async function parity(c:PoolClient,args:unknown[],effective?:string){
 const a=effective?effective.replace('signal_listening_population_roots_v1(','pg_temp.r16_flat_old('):read('old'),b=effective?effective.replace('signal_listening_population_roots_v1(','pg_temp.r16_flat_new('):read('new');assert.equal((await c.query(`WITH a AS MATERIALIZED(${a}),b AS MATERIALIZED(${b}) SELECT count(*)::int n FROM((TABLE a EXCEPT ALL TABLE b)UNION ALL(TABLE b EXCEPT ALL TABLE a))d`,args)).rows[0].n,0);
 const bytes=async(sql:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') value FROM(${sql})p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,args)).rows.map(r=>r.value as string);
 const old=await bytes(a),next=await bytes(b);assert.deepEqual(next,old);if(effective)assert.deepEqual(await bytes('SELECT * FROM public.signal_listening_effective_population_roots_v2($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)'),old,'native effective20 reference bytes');return{rows:old.length,bytes:old.reduce((n,s)=>n+s.length/2,0),sha256:sha(old.join('\n')),except_all:true,ordered_record_send:true};
}
export type FlatObservationV1={scenario:'FULL_consumer'|'historical_control';root_mode:'all'|'bounded4096';arm:'old'|'new';position:number;wall_ms:number;rows:number;snapshot_sha256:string};
export function flatGatesV1(rows:FlatObservationV1[]){
 assert.equal(rows.length,16);const gates=[];
 for(const scenario of ['FULL_consumer','historical_control']as const)for(const mode of ['all','bounded4096']as const){const part=rows.filter(r=>r.scenario===scenario&&r.root_mode===mode);assert.equal(part.length,4);
  assert.deepEqual(part.map(r=>[r.position,r.arm]),[[0,'old'],[1,'new'],[2,'new'],[3,'old']]);assert.equal(new Set(part.map(r=>r.snapshot_sha256)).size,1);
  for(const r of part)assert.ok(Number.isFinite(r.wall_ms)&&r.wall_ms>0&&r.rows>0);
  const old=(part[0]!.wall_ms+part[3]!.wall_ms)/2,next=(part[1]!.wall_ms+part[2]!.wall_ms)/2,pairs=[part[1]!.wall_ms/part[0]!.wall_ms,part[2]!.wall_ms/part[3]!.wall_ms];
  gates.push({scenario,root_mode:mode,old_median_ms:old,new_median_ms:next,median_ratio:next/old,pair_ratios:pairs,accepted:next<=.90*old&&pairs.every(r=>r<=1.10)});
 }return gates;
}
async function paired(c:PoolClient,scope:unknown[],roots:ReadonlyArray<string>,scenario:FlatObservationV1['scenario'],effective:string){
 await c.query('SET LOCAL search_path=public,extensions,pg_temp');await c.query("SET LOCAL track_functions='none'");
 const snapshot=(await c.query('SELECT pg_current_snapshot()::text value')).rows[0].value,rows:FlatObservationV1[]=[],parities=[],plans=[];
 for(const mode of ['all','bounded4096']as const){const args=[...scope,mode==='all'?null:roots,'llm-processing'];const before=await parity(c,args),overlay=await parity(c,args,effective);assert.equal(before.rows,16384);assert.equal(overlay.rows,16384);parities.push({root_mode:mode,raw14:before,effective20:overlay});
  for(const arm of ['old','new']as const)await c.query(read(arm),args);
  for(const [position,arm]of (['old','new','new','old']as const).entries()){const start=process.hrtime.bigint(),result=await c.query(read(arm),args),wall=Number(process.hrtime.bigint()-start)/1e6;assert.equal(result.rows.length,before.rows);
   rows.push({scenario,root_mode:mode,arm,position,wall_ms:wall,rows:result.rows.length,snapshot_sha256:sha(snapshot)});}
  assert.deepEqual(await parity(c,args),before);assert.deepEqual(await parity(c,args,effective),overlay);
  for(const arm of ['old','new']as const){const plan=(await c.query('EXPLAIN(ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+read(arm),args)).rows[0]?.['QUERY PLAN'];assert.ok(Array.isArray(plan));plans.push({scenario,root_mode:mode,arm,plan});}
 }
 assert.equal((await c.query('SELECT pg_current_snapshot()::text value')).rows[0].value,snapshot);return{observations:rows,parities,plans};
}
async function scopeParityV1(c:PoolClient,params:unknown[],effective:string){
 const roots=params[4] as string[],cases=[['empty',[]],['duplicates_and_null',[roots[0],roots[0],null,roots[1]]]]as const;
 const evidence=[];
 for(const [name,selected]of cases){const p=[...params];p[4]=selected;evidence.push({case:name,raw14:await parity(c,p),effective20:await parity(c,p,effective)});}
 for(const [name,index,value]of [['foreign_workspace',0,randomUUID()],['foreign_configuration',1,randomUUID()],['foreign_map',2,randomUUID()],['stale_context',3,'sha256:'+'f'.repeat(64)]]as const){const p=[...params];p[index]=value;evidence.push({case:name,raw14:await parity(c,p),effective20:await parity(c,p,effective)});}
 return evidence;
}
function defaultWitnessV1(installed:Awaited<ReturnType<typeof installFlatPreimageV1>>){return{unchanged:true,functions:installed.before.map(({oid,prosrc,...row})=>({...row,body_sha256:sha(prosrc)}))};}
export async function runFlatFullV1(){let result:Record<string,unknown>|undefined;
 let installed:Awaited<ReturnType<typeof installFlatPreimageV1>>;
 await runPrefixFunctionProfileV1({install:async c=>{installed=await installFlatPreimageV1(c);},read:async({c,params,setup})=>{
  const kernel=await flatScalarKernelV1(c,installed.expressions),scopes=await scopeParityV1(c,params,installed.effective),pairs=await paired(c,params.slice(0,4),params[4] as string[],'FULL_consumer',installed.effective);
  assert.deepEqual(await defaults(c),installed.before);result={setup,kernel,scopes,default_witness:defaultWitnessV1(installed),...pairs,source_sha256:installed.source_sha256,candidate_sha256:installed.candidate_sha256};
 }});assert.ok(result);return result;
}
export async function runFlatHistoryV1(){const started=process.hrtime.bigint();const deadline=()=>assert.ok(Number(process.hrtime.bigint()-started)/1e6<=600000,'historical setup deadline600s');assert.equal(process.env.GITHUB_ACTIONS,'true');let result:Record<string,unknown>|undefined;
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{seed_published_at:'2026-01-01T00:00:00.123456Z',benchmark:{isolated:true,root_count:4096,execution_cap_micro_usd:1000000,import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async f=>{
  deadline();const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  assert.equal((await f.database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[f.run_id,f.workspace_id])).rows.length,1);
  const base=signalListeningBaseTemplateV1({category:'synthetic fixture category',lexicon_terms:['synthetic']});
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,questions:[...base.questions,...[1,2].map(n=>({key:'projection_topic_'+n,type:'noul' as const,text:'Does this discuss synthetic topic '+n+'?',positive:'Synthetic topic '+n,negative:'Other text',scope:'all' as const,origin:'brand_os' as const,human_locked:true,topic_source:'discovered' as const}))]})});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true}),c=await f.database.connect();
  try{const installed=await installFlatPreimageV1(c),ctx=(await c.query('SELECT entity_context_digest FROM signal_labeling_runs WHERE id=$1',[requested.run_id])).rows[0].entity_context_digest,scope=[f.workspace_id,cfg.id,f.map_id,ctx];
   const roots=(await c.query('SELECT root_id FROM signal_mass_labeling_items WHERE workspace_id=$1 AND map_id=$2 ORDER BY root_id',[f.workspace_id,f.map_id])).rows.map(r=>r.root_id as string);assert.equal(roots.length,4096);
   // Exact admitted historical setup676: native guards remain enabled; no answers are seeded.
   await c.query(`INSERT INTO signal_listening_discovery_manual(workspace_id,configuration_id,map_id,question_key,question_digest,root_id,input_digest,entity_context_digest,belongs,created_by_user_id,created_at)
    SELECT $1,$2,$3,q.question_key,q.question_digest,i.root_id,signal_listening_input_digest_v1(i),$4,v.belongs,$5,v.at FROM signal_mass_labeling_items i CROSS JOIN signal_listening_questions q CROSS JOIN(VALUES
     (true,'2026-01-01 00:00:00.123456+00'::timestamptz),(false,'2026-01-02 00:00:00.123456+00'::timestamptz),(true,'2026-01-02 00:00:00.123456+00'::timestamptz))v(belongs,at)
    WHERE i.map_id=$3 AND i.workspace_id=$1 AND i.root_id=ANY($6::uuid[]) AND q.configuration_id=$2 AND q.definition->>'topic_source'='discovered'`,[...scope,f.actor_user_id,roots.slice(0,256)]);
   assert.equal((await c.query('SELECT count(*)::int n FROM signal_listening_discovery_manual WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,1536);
   deadline();await withPrefixReadOnlyV1(c,async()=>{result={default_witness:defaultWitnessV1(installed),setup:{roots:4096,questions:4,scope_all:4,discovered:2,history_roots:256,history_rows:1536,is_FULL_consumer:false},...await paired(c,scope,roots,'historical_control',installed.effective)};assert.deepEqual(await defaults(c),installed.before);});
  }finally{releasePrefixClientV1(c);}
 }}});assert.ok(result);return result;
}
export async function writeFlatEvidenceV1(full:Record<string,unknown>,history:Record<string,unknown>){
 const observations=[...full.observations as FlatObservationV1[],...history.observations as FlatObservationV1[]],gates=flatGatesV1(observations);
 const checkout=fileURLToPath(new URL('../../../',import.meta.url)),target_sha=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8',timeout:5000,maxBuffer:1024}).trim();assert.match(target_sha,/^[a-f0-9]{40}$/u);
 const receipt={target_sha,oracle_sha256:sha(await readFile(fileURLToPath(import.meta.url))),acceptance_sha256:sha(await readFile(new URL('./signal-listening-prefix-flat-preimage.postgres.test.ts',import.meta.url))),contract:'r16-prefix-flat-preimage-oracle-v1',status:'observed',diagnostic_only:true,h1_accepted:false,cpu:'UNKNOWN',coverage:{native_FULL_base_cache:true,native_manual_history_rows:1536,raw14:true,effective20:true,scope_probes:['empty','duplicates_and_null','foreign_workspace','foreign_configuration','foreign_map','stale_context'],new_revoked_rights_fixture:false,new_human_membership_fixture:false},unknowns:['FunctionScan hides inner physical costs; plans are descriptive','No new native revoked-rights or human-membership mutations; unchanged logic is source-inverse proven and existing acceptance remains separate','query_wall_is_not_CPU_or_H1'],performance_accepted:gates.every(g=>g.accepted),preregistration:{observations:16,strata:4,arms:['old','new','new','old'],median_ratio_max:.90,pair_ratio_max:1.10,tracking:'none',timing:'client_wall_query_only'},full,history,gates};
 const configured=process.env.R16_PREFIX_FLAT_PREIMAGE_EVIDENCE_DIR;assert.ok(configured);const root=await realpath(fileURLToPath(new URL('../../../',import.meta.url))),dir=resolve(root,configured),sub=relative(join(root,'.data'),dir);assert.ok(sub&&!sub.startsWith('..')&&!sub.startsWith('/'));
 await mkdir(dir,{recursive:true,mode:0o700});assert.equal(await realpath(dir),dir);const bytes=Buffer.from(JSON.stringify(receipt)+'\n');assert.ok(bytes.length<=256*1024);
 const fd=await open(join(dir,'prefix-flat-preimage.json'),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}return receipt;
}
