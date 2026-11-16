import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,
 buildSignalTopicEditorialBatchPlanFromPreparedInputV2,type SignalListeningInputV1} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {prepareSyntheticSiblingEditorialPolicyV1,loadSyntheticSiblingEditorialDeadlineV1} from './signal-mfp-mass-labeling-sibling.synthetic.fixture';
import {seedSignalTopicEditorialRenewalSourceV1} from './signal-topic-editorial-renewal.synthetic.fixture';
import {loadSignalTopicConsolidationEditorialInputV1} from '../signal-topic-consolidation-editorial-input';
import {quoteSignalTopicEditorialChunkedAdmissionV3,requestSignalTopicEditorialChunkedAdmissionV3} from '../signal-topic-editorial-admission-v3';

export type NativeFixture={database:Parameters<typeof createSignalListeningStoreV1>[0]['database'];
 run:LabelingRunV1;inputs:SignalListeningInputV1[];configuration:ReturnType<typeof signalListeningBaseTemplateV1>;
 store:ReturnType<typeof createSignalListeningStoreV1>;rawPages:NonNullable<Parameters<typeof createSignalListeningStoreV1>[0]['rawPages']>;
 editorial?:Awaited<ReturnType<typeof seedEditorialRace>>};
export async function withMoneyFixture(cap:number,body:(fixture:NativeFixture)=>Promise<void>,editorialRace=false,
 configuration=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})){
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const editorial=editorialRace?await seedEditorialRace(access):undefined;
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',
   configuration});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,
   idempotency_key:randomUUID(),cap_micro_usd:editorial?.cap??cap,provider_available:true});
  const files=await mkdtemp(join(tmpdir(),'r16-listening-money-'));
  const rawPages:NativeFixture['rawPages']={
   reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
   async store(a){const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});
    const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}
    assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},
   load:a=>readFile(join(files,a.sha256.slice(7)),'utf8')};
  const store=createSignalListeningStoreV1({database,rawPages,storeRaw:async()=>{throw Error('no individual provider/raw in money acceptance');}});
  const run=await store.claim(requested.run_id);assert.ok(run);
  const inputs=await store.inputs(run);assert.equal(inputs.length,3);
  try{await body({database,run,inputs,configuration:cfg.configuration,store,rawPages,editorial});}
  finally{await rm(files,{recursive:true,force:true});}
 }});
}
/** Setup only: the shared source fixture runs in its usual rollback/savepoint
 * harness, then commits before either competing native reservation begins. */
async function seedEditorialRace(access:Pick<NativeFixture,'database'>&{workspace_id:string;actor_user_id:string}){
 const c=await access.database.connect();let sequence=0;const stack:string[]=[];
 await c.query('BEGIN');await c.query('SET LOCAL search_path=public,extensions,pg_temp');
 const query=(async(sql:string,values?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const name='money_seed_'+(++sequence);stack.push(name);return c.query('SAVEPOINT '+name);}
  if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT '+stack.pop()!);
  if(sql==='ROLLBACK'){const name=stack.pop()!;await c.query('ROLLBACK TO SAVEPOINT '+name);return c.query('RELEASE SAVEPOINT '+name);}
  if(sql.startsWith('SET TRANSACTION'))return c.query('SELECT 1');
  return c.query(sql,values);
 }) as PoolClient['query'];
 const scoped=Object.assign(Object.create(c),{query,release(){}})as PoolClient;
 const database=Object.assign(Object.create(access.database),{query,connect:async()=>scoped})as Pool;
 try{
  const organization_id=(await c.query('SELECT organization_id FROM signal_workspaces WHERE id=$1',[access.workspace_id])).rows[0].organization_id;
  const setup={database,scoped,query,cleanup:async()=>{},identity:{organization_id,actor_user_id:access.actor_user_id}};
  const priorId=await prepareSyntheticSiblingEditorialPolicyV1(setup);
  const source=await seedSignalTopicEditorialRenewalSourceV1({...setup,defer_numeric_policy_activation:true});
  const input=await loadSignalTopicConsolidationEditorialInputV1(source.scope);
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:source.scope.numeric_run_id});
  const editorialAccess={database,workspace_id:source.identity.workspace_id,actor_user_id:access.actor_user_id};
  const deadline=await loadSyntheticSiblingEditorialDeadlineV1({query,policy_id:priorId});
  const estimate=await quoteSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,deadline});
  assert.equal(estimate.status,'ready_to_authorize');const cap=Number(estimate.maximum_micro_usd);
  assert.ok(Number.isSafeInteger(cap)&&cap>0);
  const prior=(await c.query('SELECT * FROM signal_processing_policy_versions WHERE id=$1',[priorId])).rows[0];
  const priorExposure=Number((await c.query('SELECT total_micro_usd::text n FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)',[organization_id,prior.budget_timezone])).rows[0].n);
  await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');
  // Both finite caps are provisioned BEFORE either tested owner, never raised
  // to make an already-owned request pass. Each can consume the remaining day.
  const next=(await c.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,$2,created_by_user_id
   FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[priorId,priorExposure+cap])).rows[0];
  await c.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,
   CASE WHEN action='mass_labeling_jev' THEN $3::bigint ELSE max_execution_micro_usd END,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1`,[priorId,next.id,cap]);
  await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[priorId]);
  await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[next.id]);
  const finalQuote=await quoteSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,deadline});
  assert.equal(finalQuote.status,'ready_to_authorize');assert.equal(Number(finalQuote.maximum_micro_usd),cap);assert.ok(finalQuote.quote_reference);
  const admitted=await requestSignalTopicEditorialChunkedAdmissionV3({...editorialAccess,plan,
   idempotency_key:'money-native-'+randomUUID(),quote_reference:finalQuote.quote_reference});
  assert.equal(stack.length,0);await c.query('COMMIT');
  return{execution_id:admitted.execution_id,cap,organization_id,budget_timezone:next.budget_timezone,daily_cap_micro_usd:next.daily_cap_micro_usd};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
type Requests=Pick<NativeFixture,'run'|'inputs'|'configuration'>;
export function proposals(f:Requests,amount:number){return f.inputs.map(input=>{
 const request=buildSignalListeningJevRequestV1(input,f.configuration),request_digest=signalListeningRequestDigestV1(f.run,input,request);
 return{id:randomUUID(),custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:amount};
});}
export async function transaction(f:NativeFixture,body:(c:PoolClient)=>Promise<void>){
 const c=await f.database.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s'");
  await body(c);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
