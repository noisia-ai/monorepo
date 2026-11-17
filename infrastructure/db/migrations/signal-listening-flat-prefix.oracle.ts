import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {withFlatPrefixFullFixtureV1,withFlatPrefixReadOnlyV1,releaseFlatPrefixClientV1} from './signal-listening-flat-prefix.synthetic.fixture';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const sourceURL=new URL('./0326_signal_listening_final_answer_slice.sql',import.meta.url);
const candidateURL=new URL('./0332_signal_listening_flat_prefix_preimages.sql',import.meta.url);
const sourceSHA='7ee6911c892e8633725c5d1ad48d2f257b344d9d7a7a07f5346f9d4142e734ed';
const inputOld='signal_listening_input_digest_v1(i)',basisOld="signal_labeling_digest_v1(jsonb_build_object('voice',v.call_id,'promotion',p.call_id))";
const revoke='\nREVOKE ALL ON FUNCTION pg_temp.r16_flat_new(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;\n';
export function flatPreimageSourceV1(source:string,candidate:string){
 assert.equal(sha(source),sourceSHA);assert.equal(sha(candidate.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1','CREATE FUNCTION pg_temp.r16_flat_new')+revoke),'9f605e4aa2d553cf6c9b5b5516eb18b7bb14795bd97d60541a45de4fbba33dd1','approved reversible candidate bytes');
 const expression=(kind:string)=>{const start=`/* flat_${kind}_begin */`,end=`/* flat_${kind}_end */`;
  assert.equal(candidate.split(start).length,3);assert.equal(candidate.split(end).length,3);
  const parts=candidate.split(start).slice(1).map(s=>s.split(end)[0]!);assert.equal(parts[0],parts[1]);return parts[0]!;};
 const input=expression('input'),basis=expression('basis');
 let inverse=candidate;
 for(const [kind,next,old]of [['input',input,inputOld],['basis',basis,basisOld]])inverse=inverse.split(`/* flat_${kind}_begin */${next}/* flat_${kind}_end */`).join(old);
 assert.equal(inverse,source,'inverse must recover every native0326 byte');
 assert.ok(!/\b(?:GRANT|SECURITY\s+DEFINER|ALTER)\b/iu.test(candidate));
 const preimage=(s:string)=>{const prefix="('sha256:'||encode(sha256(convert_to(",suffix=",'UTF8')),'hex'))";assert.ok(s.startsWith(prefix)&&s.endsWith(suffix));return s.slice(prefix.length,-suffix.length);};
 return{input,basis,input_preimage:preimage(input),basis_preimage:preimage(basis)};
}
async function defaults(c:PoolClient){return(await c.query(`SELECT p.oid::text,p.proname,p.prosrc,p.proowner::text,p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.pronargs,l.lanname,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text,p.proargtypes::text,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname IN('signal_listening_population_roots_v1','signal_listening_statement_money_v1','signal_listening_input_digest_v1','signal_labeling_json_v1','signal_labeling_digest_v1') ORDER BY p.oid`)).rows;}
export async function installFlatPreimageV1(c:PoolClient){
 const source=await readFile(sourceURL,'utf8'),candidate=await readFile(candidateURL,'utf8'),expressions=flatPreimageSourceV1(source,candidate),before=await defaults(c);
 assert.equal(before.length,5);
 const mark=await readFile(new URL('./0331_signal_listening_statement_payload.sql',import.meta.url),'utf8');assert.equal(before.find(r=>r.proname==='signal_listening_statement_money_v1')!.prosrc,mark.split('AS $$')[1]!.split('$$;')[0]);
 const runtime=(await c.query("SELECT current_database() database,current_setting('server_version_num')::int version")).rows[0];assert.match(runtime.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.notEqual(runtime.database,new URL(process.env.DATABASE_URL!).pathname.slice(1));assert.ok(runtime.version>=170000&&runtime.version<180000);
 const native=before.find(r=>r.proname==='signal_listening_population_roots_v1')!;
 assert.equal(native.prosrc,candidate.split('AS $function$')[1]!.split('$function$;')[0]);assert.notEqual(native.proacl,null);
 for(const [key,value]of Object.entries({provolatile:'s',proisstrict:false,proparallel:'u',proleakproof:false,prokind:'f',pronargs:6,prosecdef:false,lanname:'plpgsql',proconfig:['search_path=public, extensions, pg_temp']}))assert.deepEqual(native[key],value,key+' strict native metadata');
 const canonical=await readFile(new URL('./0223_signal_mention_facets.sql',import.meta.url),'utf8'),inputSource=await readFile(new URL('./0296_signal_listening_configuration.sql',import.meta.url),'utf8');
 for(const [name,sql]of [['signal_labeling_json_v1',canonical],['signal_labeling_digest_v1',canonical],['signal_listening_input_digest_v1',inputSource]]){const declaration=sql!.slice(sql!.indexOf('CREATE FUNCTION '+name)),body=declaration.split('AS $$')[1]!.split('$$;')[0];assert.equal(before.find(r=>r.proname===name)!.prosrc,body,'unchanged public '+name);}

 assert.equal((await c.query("SELECT current_setting('transaction_read_only') value")).rows[0].value,'off');
 await c.query('CREATE TEMP TABLE r16_flat_alias_lifetime(probe boolean)');
 await c.query(source.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1','CREATE FUNCTION pg_temp.r16_flat_old')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_flat_old(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
 await c.query(source.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1','CREATE FUNCTION pg_temp.r16_flat_replacement')+'\nREVOKE ALL ON FUNCTION pg_temp.r16_flat_replacement(uuid,uuid,uuid,text,uuid[],text) FROM PUBLIC;');
 const replacementCatalogue=async()=>(await c.query(`SELECT p.oid::text,p.proowner::text,p.proacl::text,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.prosecdef,p.proconfig,p.proargtypes::text,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset
 FROM pg_proc p WHERE p.oid='pg_temp.r16_flat_replacement(uuid,uuid,uuid,text,uuid[],text)'::regprocedure`)).rows[0];
 const replacementBefore=await replacementCatalogue();assert.notEqual(replacementBefore.proacl,null);assert.equal(replacementBefore.proacl,native.proacl);
 await c.query(candidate.replace('CREATE OR REPLACE FUNCTION signal_listening_population_roots_v1','CREATE OR REPLACE FUNCTION pg_temp.r16_flat_replacement'));
 assert.deepEqual(await replacementCatalogue(),replacementBefore,'replace preserves native ACL/owner/OID and every function attribute');
 assert.equal((await c.query("SELECT prosrc FROM pg_proc WHERE oid='pg_temp.r16_flat_replacement(uuid,uuid,uuid,text,uuid[],text)'::regprocedure")).rows[0].prosrc,native.prosrc);
 const aliases=(await c.query(`SELECT p.proname,p.proowner::text,p.proisstrict,p.proparallel,p.proleakproof,p.prokind,p.pronargs,l.lanname,p.provolatile,p.prosecdef,p.proconfig,p.proacl::text,p.proargtypes::text,p.prorettype::text,p.proallargtypes::text,p.proargmodes,p.proargnames,p.proretset
 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace=pg_my_temp_schema() AND p.proname IN('r16_flat_old','r16_flat_replacement') ORDER BY p.proname`)).rows;
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
const read=(arm:'old'|'new')=>`SELECT * FROM ${arm==='old'?'pg_temp.r16_flat_old':'public.signal_listening_population_roots_v1'}($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)`;
async function parity(c:PoolClient,args:unknown[],effective?:string){
 const a=effective?effective.replace('signal_listening_population_roots_v1(','pg_temp.r16_flat_old('):read('old'),b=effective?effective:read('new');assert.equal((await c.query(`WITH a AS MATERIALIZED(${a}),b AS MATERIALIZED(${b}) SELECT count(*)::int n FROM((TABLE a EXCEPT ALL TABLE b)UNION ALL(TABLE b EXCEPT ALL TABLE a))d`,args)).rows[0].n,0);
 const bytes=async(sql:string)=>(await c.query(`SELECT encode(record_send(ROW(p.*)),'hex') value FROM(${sql})p ORDER BY root_id,question_key,encode(record_send(ROW(p.*)),'hex')`,args)).rows.map(r=>r.value as string);
 const old=await bytes(a),next=await bytes(b);assert.deepEqual(next,old);if(effective)assert.deepEqual(await bytes('SELECT * FROM public.signal_listening_effective_population_roots_v2($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)'),old,'native effective20 reference bytes');return{rows:old.length,bytes:old.reduce((n,s)=>n+s.length/2,0),sha256:sha(old.join('\n')),except_all:true,ordered_record_send:true};
}
async function scopeParityV1(c:PoolClient,params:unknown[],effective:string){
 const roots=params[4] as string[],cases=[['empty',[]],['duplicates_and_null',[roots[0],roots[0],null,roots[1]]]]as const;
 const evidence=[];
 for(const [name,selected]of cases){const p=[...params];p[4]=selected;evidence.push({case:name,raw14:await parity(c,p),effective20:await parity(c,p,effective)});}
 for(const [name,index,value]of [['foreign_workspace',0,randomUUID()],['foreign_configuration',1,randomUUID()],['foreign_map',2,randomUUID()],['stale_context',3,'sha256:'+'f'.repeat(64)]]as const){const p=[...params];p[index]=value;evidence.push({case:name,raw14:await parity(c,p),effective20:await parity(c,p,effective)});}
 return evidence;
}
export async function runFlatPrefixHistoricalAcceptanceV1(){const started=process.hrtime.bigint();const deadline=()=>assert.ok(Number(process.hrtime.bigint()-started)/1e6<=600000,'historical setup deadline600s');assert.equal(process.env.GITHUB_ACTIONS,'true');let result:Record<string,unknown>|undefined;
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
   deadline();await withFlatPrefixReadOnlyV1(c,async()=>{
    await c.query('SET LOCAL search_path=public,extensions,pg_temp');
    for(const selected of [null,roots]){const params=[...scope,selected,'llm-processing'];assert.equal((await parity(c,params)).rows,16384);assert.equal((await parity(c,params,installed.effective)).rows,16384);}
    assert.deepEqual(await defaults(c),installed.before);result={history_rows:1536};
   });
  }finally{releaseFlatPrefixClientV1(c);}
 }}});assert.ok(result);return result;
}
export async function runFlatPrefixAcceptanceV1(){
 let full=false,installed:Awaited<ReturnType<typeof installFlatPreimageV1>>;
 await withFlatPrefixFullFixtureV1({install:async c=>{installed=await installFlatPreimageV1(c);},read:async({c,params,setup})=>{
  assert.equal((await flatScalarKernelV1(c,installed.expressions)).cases,49);
  for(const roots of [null,params[4]]){const p=[...params];p[4]=roots;assert.equal((await parity(c,p)).rows,16384);assert.equal((await parity(c,p,installed.effective)).rows,16384);}
  await scopeParityV1(c,params,installed.effective);assert.deepEqual(await defaults(c),installed.before);
  assert.equal(setup.base_answers,8192);assert.equal(setup.consumer_pending,8192);assert.equal(setup.open_exposure_micro_usd,'0');full=true;
 }});assert.equal(full,true);await runFlatPrefixHistoricalAcceptanceV1();
}
