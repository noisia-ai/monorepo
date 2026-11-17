import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {prepareSharedWireRawV1,type SharedWireFixtureV1} from './signal-listening-statement-shared-wire.fixture';
import {saveSignalListeningConfigurationV1,authorizeSignalListeningV1,loadSignalListeningConfigurationWithClientV1} from '../signal-listening-configuration';
import {assertMassLabelingMapCurrentV1} from '../signal-mass-labeling';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {createSignalListeningStoreV1} from '../signal-listening-runs';
import {r16ListeningWorkloadV2} from '../../../scripts/r16/listening-workload';
import {startR16HttpFilesystemStorageV1} from '../../../scripts/r16/http-filesystem-storage';
import {createWorkspaceEngineStorageV1} from '../../../services/workers/src/workers/signal-workspace-engine-storage';
import {createLabelingRawPagesStorageV1} from '../../../services/workers/src/workers/signal-labeling-receipt-storage';
const uncertainClients=new WeakSet<PoolClient>();
export function releaseFlatPrefixClientV1(c:PoolClient){c.release(uncertainClients.has(c));}
export async function withFlatPrefixReadOnlyV1(c:PoolClient,body:()=>Promise<void>){
 let failed=false,primary:unknown;
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await body();}catch(error){failed=true;primary=error;}
 try{await c.query('ROLLBACK');}catch(rollback){uncertainClients.add(c);if(failed)throw new AggregateError([primary,rollback],'prefix body and rollback failed',{cause:primary});throw rollback;}
 if(failed)throw primary;
}
const publicRead="SELECT * FROM public.signal_listening_population_roots_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid[],$6::text)";
//0295 stores page identity on the member, not on signal_labeling_calls.
// Keep the aggregate at call grain: the native page/member identity is an
// EXISTS witness, so even malformed linkage cannot multiply money or roots.
export const flatPrefixLedgerSqlV1=`SELECT count(*)::int calls,
 count(*) FILTER(WHERE c.status='settled' AND c.results_applied AND c.usage IS NOT NULL
  AND c.raw_sha256 IS NOT NULL AND c.raw_size_bytes>0 AND c.raw_storage_verified_at IS NOT NULL
  AND c.raw_storage_verified_key=c.raw_storage_key AND EXISTS(
   SELECT 1 FROM signal_labeling_raw_page_members member JOIN signal_labeling_raw_pages page
    ON page.id=member.page_id AND page.workspace_id=member.workspace_id AND page.run_id=member.run_id
   WHERE member.call_id=c.id AND member.workspace_id=c.workspace_id AND member.run_id=c.run_id
    AND member.request_digest=c.request_digest AND member.raw_sha256=c.raw_sha256 AND member.raw_size_bytes=c.raw_size_bytes
    AND page.status='verified' AND page.verified_at IS NOT NULL AND page.storage_key=c.raw_storage_key
    AND member.byte_offset>=0 AND member.byte_length>0 AND member.byte_offset+member.byte_length+1<=page.size_bytes
  ))::int applied,
 count(DISTINCT c.inputs->0->>'root_id')::int roots,COALESCE(sum(c.settled_micro_usd),0)::text synthetic_spend_micro_usd,
 COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status IN('reserved','submitting','submitted')),0)::text reserved_micro_usd,
 (COALESCE(sum(c.reserved_micro_usd) FILTER(WHERE c.status='unknown'),0)+COALESCE(sum(c.terminal_exposure_micro_usd) FILTER(WHERE c.status IN('settled','failed')),0))::text unknown_micro_usd
 FROM signal_labeling_calls c WHERE c.workspace_id=$1 AND c.run_id=$2`;
async function setupState(c:PoolClient,params:unknown[],run_id:string){
 const ledger=(await c.query(flatPrefixLedgerSqlV1,[params[0],run_id])).rows[0];
 assert.deepEqual(ledger,{calls:4096,applied:4096,roots:4096,synthetic_spend_micro_usd:'24576',reserved_micro_usd:'0',unknown_micro_usd:'0'});
 const state=(await c.query(`WITH population AS MATERIALIZED(${publicRead}),per_root AS(
  SELECT root_id,count(*)::int questions,count(*) FILTER(WHERE question_key IN('voice','promotion') AND answer IS NOT NULL AND cache_call_id IS NOT NULL)::int bases,
   count(*) FILTER(WHERE definition->>'topic_source'='defined' AND definition->>'scope'='consumer_category' AND candidate AND scope_state='included' AND answer IS NULL AND scope_basis IS NOT NULL)::int consumers
  FROM population GROUP BY root_id),basis AS(
   SELECT count(*)::int bad FROM population p JOIN population v ON v.root_id=p.root_id AND v.question_key='voice'
   JOIN population a ON a.root_id=p.root_id AND a.question_key='promotion'
   WHERE p.definition->>'scope'='consumer_category' AND p.scope_basis IS DISTINCT FROM public.signal_labeling_digest_v1(jsonb_build_object('voice',v.cache_call_id,'promotion',a.cache_call_id)))
 SELECT (SELECT count(*)::int FROM population) rows,(SELECT count(*)::int FROM per_root) roots,
  (SELECT bool_and(questions=4 AND bases=2 AND consumers=2) FROM per_root) exact,
  (SELECT bad FROM basis) stale_basis`,params)).rows[0];
 assert.deepEqual(state,{rows:16384,roots:4096,exact:true,stale_basis:0});
 const answers=(await c.query("SELECT count(*)::int n FROM signal_listening_answers WHERE workspace_id=$1 AND run_id=$2 AND question_key IN('voice','promotion')",[params[0],run_id])).rows[0].n;assert.equal(answers,8192);
 const run=(await c.query('SELECT status,lease_token IS NULL released FROM signal_labeling_runs WHERE id=$1',[run_id])).rows[0];assert.equal(run.status,'running');assert.equal(run.released,true,'setup releases its lease before measurement');
 return{...ledger,base_answers:answers,consumer_pending:8192,raw14_rows:state.rows,basis_fresh:true,run_status:run.status,open_exposure_micro_usd:String(BigInt(ledger.reserved_micro_usd)+BigInt(ledger.unknown_micro_usd)),external_spend_micro_usd:0};
}
export type FlatPrefixNativeCaseV1={install(c:PoolClient):Promise<void>;read(args:{c:PoolClient;params:unknown[];setup:Record<string,unknown>}):Promise<void>};
export async function withFlatPrefixFullFixtureV1(testCase:FlatPrefixNativeCaseV1){
 assert.equal(process.env.GITHUB_ACTIONS,'true','owned CI only');
 const workload=r16ListeningWorkloadV2('defined_consumer_second_pass'),started=process.hrtime.bigint();
 const elapsed=()=>Number(process.hrtime.bigint()-started)/1e6;
 const deadline=()=>assert.ok(elapsed()<=600000,'prefix setup deadline600s exceeded; no measurement');
 const {withSharedWireDefaultPostcheckV1}=await import('./signal-listening-statement-shared-wire.oracle');
 await runMassLabelingAcceptanceFixtureV1('product-recovery',{benchmark:{isolated:true,root_count:4096,execution_cap_micro_usd:20000000,
  import_batch_size:256,preparation_page_size:100,embedding_page_limit:264,beforeProcessing:async ctx=>{
   deadline();const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
   assert.equal((await database.query("UPDATE signal_labeling_runs r SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=r.id) RETURNING id",[ctx.run_id,ctx.workspace_id])).rows.length,1);
   const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:workload.configuration});assert.equal(cfg.configuration_digest,workload.configuration_digest);
   const prepared=await prepareSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:'flat-prefix-acceptance:'+randomUUID(),cap_micro_usd:20000000,provider_available:true,prototype_provider_available:false});
   assert.equal(prepared.status,'labeling');assert.ok(prepared.run_id);deadline();
   const directory=await mkdtemp(join(tmpdir(),'r16-flat-prefix-acceptance-'));
   const server=await startR16HttpFilesystemStorageV1(directory);
   await withSharedWireDefaultPostcheckV1(async()=>{
    const storage=createWorkspaceEngineStorageV1({url:server.base_url,service_role_key:'synthetic-local-only',bucket:'corpus-files'}),rawPages=createLabelingRawPagesStorageV1(storage);
    const store=createSignalListeningStoreV1({database,page_size:4096,rawPages,assertRawReady:()=>storage.assertReady!(),storeRawVerified:true,storeRaw:async()=>{throw Error('acceptance requires native multipart RAW');}});
    const run=await store.claim(prepared.run_id!);assert.ok(run);
    const initial=await withSharedWireDefaultPostcheckV1(async()=>{
     deadline();const inputs=await store.inputs(run,{max_rows:4096,max_working_bytes:512*1024*1024,on_oversize:'error'});deadline();
     assert.equal(inputs.length,4096);assert.equal(new Set(inputs.map(i=>i.root_id)).size,4096);
     assert.ok(inputs.every(i=>i.question_keys.length===2&&[...i.question_keys].sort().join(',')==='promotion,voice'),'capture the entire base roster before applying any chunk');
     for(let offset=0;offset<inputs.length;offset+=1024){
      await store.renew(run);deadline();
      const f:SharedWireFixtureV1={database,run,inputs:inputs.slice(offset,offset+1024),configuration:cfg.configuration,configuration_id:cfg.id,map_id:ctx.map_id,store,rawPages};
      const outcomes=await prepareSharedWireRawV1(f,500);deadline();
      assert.equal(outcomes.length,1024);await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));deadline();
     }
     return inputs;
    },()=>store.release(run));
    // Every setup promise and the normal lease release have completed. The
    // original roster, not a new consumer read, supplies the one fixed scope.
    deadline();const roots=Object.freeze(initial.map(i=>i.root_id));
    const params:unknown[]=[access.workspace_id,cfg.id,ctx.map_id,run.entity_context_digest,roots,'llm-processing'];
    const c=await database.connect();
    try{
     const original=(await c.query("SELECT current_setting('search_path') search_path,current_setting('track_functions') track_functions,current_database() database,current_setting('server_version_num')::int version")).rows[0];
     assert.match(original.database,/^noisia_mfp_recovery_[a-f0-9]{32}$/u);assert.notEqual(original.database,new URL(process.env.DATABASE_URL!).pathname.slice(1));assert.ok(original.version>=170000&&original.version<180000);
     await testCase.install(c);
     await withSharedWireDefaultPostcheckV1(()=>withFlatPrefixReadOnlyV1(c,async()=>{
      await c.query('SET LOCAL search_path=public,extensions,pg_temp');
      await authorizeSignalListeningV1(c,access,'view');await assertMassLabelingMapCurrentV1(c,access.workspace_id,ctx.map_id);
      assert.equal((await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id))?.id,cfg.id);
      assert.equal((await c.query('SELECT digest FROM signal_entity_context_versions WHERE workspace_id=$1 ORDER BY version_no DESC LIMIT 1',[access.workspace_id])).rows[0].digest,run.entity_context_digest);
      const state=await setupState(c,params,run.id),snapshot=(await c.query('SELECT pg_current_snapshot()::text snapshot')).rows[0];
      await testCase.read({c,params,setup:state});
      assert.deepEqual((await c.query('SELECT pg_current_snapshot()::text snapshot')).rows[0],snapshot);assert.deepEqual(await setupState(c,params,run.id),state);
      await authorizeSignalListeningV1(c,access,'view');await assertMassLabelingMapCurrentV1(c,access.workspace_id,ctx.map_id);
      assert.equal((await loadSignalListeningConfigurationWithClientV1(c,access.workspace_id))?.id,cfg.id);
     }),async()=>{if(!uncertainClients.has(c))assert.deepEqual((await c.query("SELECT current_setting('search_path') search_path,current_setting('track_functions') track_functions,current_database() database,current_setting('server_version_num')::int version")).rows[0],original);});
    }finally{releaseFlatPrefixClientV1(c);}
   },async()=>{await withSharedWireDefaultPostcheckV1(()=>server.close(),()=>rm(directory,{recursive:true,force:true}));});
  }}});
}
