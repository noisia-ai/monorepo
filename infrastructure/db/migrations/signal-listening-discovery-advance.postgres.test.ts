import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,open} from 'node:fs/promises';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {withDiscoveryAdvanceFixtureV1} from './signal-listening-discovery-advance.synthetic.fixture';
import {createSignalListeningDiscoveryAdvanceStoreV1,persistSignalListeningDiscoveryAdvanceNumericV1,enqueueSignalListeningDiscoveryAdvanceV1,type ListeningDiscoveryNumericInputV1} from '../signal-listening-discovery-advance';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {activateSignalListeningServingSnapshotV1,claimSignalListeningDiscoveryRoundV1,reserveSignalListeningDiscoveryCallV1,type ListeningDiscoveryRoundV1} from '../signal-listening-discovery-money';
import {signalWorkspaceMassLabelingConfigV3,signalWorkspaceEmbeddingDigestV1 as stableDigest} from '@noisia/query-engine';
import {jevFacetLabelerIdentityV1,JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1,buildJevFacetRequestV1} from '@noisia/query-engine/src/signal-mention-facets-jev-v1';
import {requestMentionFacetsV1,createSignalLabelingStoreV1} from '../signal-labeling-runs';
const enabled=process.env.NOISIA_R16_DISCOVERY_ADVANCE_PG==='true';
const sha=(raw:string)=>'sha256:'+createHash('sha256').update(raw).digest('hex');
const configuration=(n:ListeningDiscoveryNumericInputV1)=>String(JSON.parse(n.manifest_json).numeric_config_digest);

// The fixture supplies a committed, disposable native PostgreSQL clone. Its
// setup remains governed by the normal policy/admission/source contracts.
test('discovery advance owns immutable leases, numeric custody and one native admission',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 for(const table of ['signal_listening_discovery_advances','signal_listening_discovery_subset_bindings','signal_listening_discovery_numeric_checkpoints','signal_listening_discovery_numeric_artifacts']){
  assert.ok((await ctx.database.query('SELECT to_regclass($1) name',[table])).rows[0].name,table+' requires the additive migration');
  assert.equal((await ctx.database.query('SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)',[table])).rows[0].relrowsecurity,true,'numerical custody is private service-only data');
 }
}}));

test('advance leases, complete subsets, staged bytes and concurrent enqueue use one native owner',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const store=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage}),db=f.database;
 assert.ok((await store.pending({database:db,limit:20})).some(row=>row.execution_id===f.execution.id));
 const claims=await Promise.all([store.claim({database:db,execution_id:f.execution.id}),store.claim({database:db,execution_id:f.execution.id})]);assert.equal(claims.filter(Boolean).length,1);
 let lease=claims.find(Boolean)!;const context=await store.context({database:db,lease});assert.equal(context?.source_generation?.id,f.execution.initial_generation_id);assert.equal(context?.source_generation?.round,1);assert.equal(lease.next_ordinal,1);
 assert.ok(!(await store.pending({database:db,limit:20})).some(row=>row.execution_id===f.execution.id));
 const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id});assert.equal(subset.root_count,0);
 assert.equal((await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id})).id,subset.id);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_subset_bindings WHERE generation_id=$1',[lease.source_generation_id])).rows[0].n,1);
 assert.deepEqual((await db.query('SELECT signal_listening_discovery_numeric_configuration_v1(0) value')).rows[0].value,signalWorkspaceMassLabelingConfigV3(0));
 const numeric=await f.emptyNumeric(subset),digest=configuration(numeric);
 assert.equal(await store.loadNumeric({database:db,lease,subset_id:subset.id,numeric_config_digest:digest}),null,'no intent is not an invented compute outcome');
 await db.query("UPDATE signal_listening_discovery_advances SET execution_expires_at=clock_timestamp()+interval '30 milliseconds' WHERE execution_id=$1",[f.execution.id]);await db.query('SELECT pg_sleep(0.04)');
 assert.equal(await store.renew({database:db,lease}),false);assert.equal(await store.release({database:db,lease}),false);assert.equal(await store.context({database:db,lease}),null);
 lease=(await store.claim({database:db,execution_id:f.execution.id}))!;assert.ok(lease);
 assert.equal(await store.loadNumeric({database:db,lease,subset_id:subset.id,numeric_config_digest:digest}),null,'a restart before any CPU-result intent may repeat free computation');
 const forged=changed(numeric,m=>{m.generation_id=randomUUID();});
 await assert.rejects(store.persistNumeric({database:db,lease,subset_id:subset.id,numeric:forged}),/numeric_source_invalid/);assert.equal(f.uploads(),0);
 f.afterPut(async d=>{if(d.name==='source-proofs.jsonl')throw Error('synthetic_storage_ack_lost');});
 await assert.rejects(store.persistNumeric({database:db,lease,subset_id:subset.id,numeric}),/synthetic_storage_ack_lost/);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows[0].n,0,'all staging precedes the first database intent');
 assert.equal(await store.loadNumeric({database:db,lease,subset_id:subset.id,numeric_config_digest:digest}),null);
 f.afterPut(undefined);const stored=await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});assert.ok('verified'in stored);
 const writes=f.uploads();f.setAllowUploads(false);
 assert.deepEqual(await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric}),stored);assert.equal(f.uploads(),writes,'existing intents neither upload nor refit');
 const checkpoint=(await db.query('SELECT * FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows[0];
 const ref=checkpoint.artifact_manifest[0],file=f.remote.get(ref.storage_key)!;const original=await readFile(file);await writeFile(file,'corrupt');
 assert.deepEqual(await store.loadNumeric({database:db,lease,subset_id:subset.id,numeric_config_digest:digest}),{status:'pending',manifest_sha256:numeric.manifest_sha256},'missing/corrupt custody is never no-intent');
 const enqueue={database:db,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true};
 assert.equal(await store.enqueue(enqueue),null);await writeFile(file,original);const fd=await open(file,'r+');try{await fd.sync();}finally{await fd.close();}
 await assert.rejects(store.loadNumeric({database:db,lease:{...lease,workspace_id:randomUUID()},subset_id:subset.id,numeric_config_digest:digest}),/lease_lost/);
 await assert.rejects(store.enqueue({...enqueue,expected_human_revision_digest:sha('forged')}),/expected_binding_invalid/);
 await assert.rejects(db.query("UPDATE signal_listening_discovery_numeric_checkpoints SET manifest_json=manifest_json||' ' WHERE id=$1",[checkpoint.id]),/immutable/);
 await assert.rejects(db.query('DELETE FROM signal_listening_discovery_numeric_artifacts WHERE checkpoint_id=$1',[checkpoint.id]),/immutable/);
 await assert.rejects(db.query('TRUNCATE signal_listening_discovery_numeric_checkpoints,signal_listening_discovery_numeric_artifacts'),/immutable/);
 assert.equal(await store.enqueue({...enqueue,provider_available:false}),null);
 const queued=await Promise.all([store.enqueue(enqueue),store.enqueue(enqueue)]);const rounds=queued.filter((r):r is ListeningDiscoveryRoundV1=>r!==null&&r.status!=='budget_exhausted');assert.ok(rounds.length>=1);assert.equal(new Set(rounds.map(r=>r.id)).size,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_contract='listening-discovery-round-v1' AND workspace_id=$1",[f.workspace_id])).rows[0].n,0,'enqueue never sends a provider request');
 await store.release({database:db,lease});
}));

test('native enqueue COMMIT acknowledgement loss replays one admission without uploads or sends',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage});
 const lease=(await store.claim({database:db,execution_id:f.execution.id}))!,subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);
 await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});const writes=f.uploads();f.setAllowUploads(false);
 let armed=false,fired=false;
 const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
  if(sql.startsWith('INSERT INTO signal_listening_discovery_rounds'))armed=true;
  const result=await(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);
  if(sql==='COMMIT'&&armed&&!fired){fired=true;throw Error('synthetic_enqueue_commit_ack_lost');}return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
 const args={lease,generation_id:lease.source_generation_id,expected_ordinal:1,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true,numeric_storage:f.storage};
 await assert.rejects(enqueueSignalListeningDiscoveryAdvanceV1({...args,database:proxy}),/synthetic_enqueue_commit_ack_lost/);assert.equal(fired,true);
 const replay=await store.enqueue({...args,database:db});assert.ok(replay&&replay.status!=='budget_exhausted');
 assert.equal((await db.query('SELECT id FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].id,replay.id);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1'",[f.workspace_id])).rows[0].n,0);assert.equal(f.uploads(),writes);
 await store.release({database:db,lease});
}));

test('an advance lease expiring before COMMIT rolls back the admission and reuses its durable checkpoint',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage});
 let lease=(await store.claim({database:db,execution_id:f.execution.id}))!;
 const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);
 await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});const writes=f.uploads();f.setAllowUploads(false);
 let armed=false,delayed=false;
 const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
  if(sql.startsWith('INSERT INTO signal_listening_discovery_rounds'))armed=true;
  if(sql==='COMMIT'&&armed&&!delayed){delayed=true;
   await target.query("UPDATE signal_listening_discovery_advances SET execution_expires_at=clock_timestamp()+interval '20 milliseconds' WHERE execution_id=$1",[f.execution.id]);
   await target.query('SELECT pg_sleep(0.04)');
  }
  return(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
 const args=()=>({lease,generation_id:lease.source_generation_id,expected_ordinal:1,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true,numeric_storage:f.storage});
 await assert.rejects(enqueueSignalListeningDiscoveryAdvanceV1({...args(),database:proxy}),/lease_lost/);assert.equal(delayed,true);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,0);
 assert.equal((await db.query('SELECT verification_status FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows[0].verification_status,'verified');
 // The lease-shortening write was part of the aborted transaction as well.
 await db.query("UPDATE signal_listening_discovery_advances SET execution_expires_at=clock_timestamp()+interval '20 milliseconds' WHERE execution_id=$1",[f.execution.id]);await db.query('SELECT pg_sleep(0.04)');
 lease=(await store.claim({database:db,execution_id:f.execution.id}))!;assert.ok(lease);
 const replay=await store.enqueue({...args(),database:db});assert.ok(replay&&replay.status!=='budget_exhausted');assert.equal(f.uploads(),writes);
 await store.release({database:db,lease});
}));

for(const phase of ['planned','verified'] as const)test('numeric '+phase+' COMMIT acknowledgement loss recovers exact staged bytes without another upload',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage});
 let lease=(await store.claim({database:db,execution_id:f.execution.id}))!;assert.ok(lease);
 const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);
 let armed=false,fired=false;
 const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
  if(phase==='planned'&&sql.startsWith('INSERT INTO signal_listening_discovery_numeric_checkpoints')||phase==='verified'&&sql.startsWith("UPDATE signal_listening_discovery_numeric_checkpoints SET verification_status='verified'")){
   armed=true;assert.equal(f.uploads(),numeric.artifacts.length,'every artifact is durable before an intent can commit');
  }
  const result=await(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);if(sql==='COMMIT'&&armed&&!fired){fired=true;throw Error('synthetic_numeric_commit_ack_lost');}return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
 await assert.rejects(persistSignalListeningDiscoveryAdvanceNumericV1({database:proxy,lease,subset_id:subset.id,numeric,numeric_storage:f.storage}),/synthetic_numeric_commit_ack_lost/);assert.equal(fired,true);
 assert.equal((await db.query('SELECT verification_status FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows[0].verification_status,phase);
 const writes=f.uploads();f.setAllowUploads(false);assert.equal(await store.release({database:db,lease}),true);lease=(await store.claim({database:db,execution_id:f.execution.id}))!;
 const recovered=await store.loadNumeric({database:db,lease,subset_id:subset.id,numeric_config_digest:configuration(numeric)});assert.deepEqual(recovered,{manifest_json:numeric.manifest_json,manifest_sha256:numeric.manifest_sha256,verified:true});assert.equal(f.uploads(),writes);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,0);
 await store.release({database:db,lease});
}));

for(const event of ['policy','human','actor','lease'] as const)test('staging then '+event+' change cannot create a result intent or review admission',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage}),lease=(await store.claim({database:db,execution_id:f.execution.id}))!;
 const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);let fired=false;
 f.afterPut(async d=>{if(fired||d.name!=='source-proofs.jsonl')return;fired=true;
  if(event==='policy')await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[f.policy.id]);
  else if(event==='human')await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...f.cfg.configuration,instructions:f.cfg.configuration.instructions+' Human change.'}});
  else if(event==='actor')await db.query("UPDATE users SET primary_role='analyst' WHERE id=$1",[f.actor_user_id]);
  else{await db.query("UPDATE signal_listening_discovery_advances SET execution_expires_at=clock_timestamp()+interval '20 milliseconds' WHERE execution_id=$1",[f.execution.id]);await db.query('SELECT pg_sleep(0.03)');}
 });
 await assert.rejects(store.persistNumeric({database:db,lease,subset_id:subset.id,numeric}),/policy_unavailable|source_invalid|listening_forbidden|lease_lost/);assert.equal(fired,true);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_numeric_checkpoints WHERE execution_id=$1',[f.execution.id])).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,0);
}));

test('initial stop and insufficient composite cap never create a paid stage',{
 skip:!enabled,timeout:600000,
},async()=>{
 await withDiscoveryAdvanceFixtureV1(async f=>{const store=createSignalListeningDiscoveryAdvanceStoreV1({database:f.database,numeric_storage:f.storage});assert.equal(await store.claim({database:f.database,execution_id:f.execution.id}),null);
  assert.equal((await f.database.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0].status,'completed');
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].n,0);
 },{no_category:true});
 await withDiscoveryAdvanceFixtureV1(async f=>{const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage}),lease=(await store.claim({database:db,execution_id:f.execution.id}))!;
  const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});
  const denied=await store.enqueue({database:db,lease,generation_id:lease.source_generation_id,expected_ordinal:1,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});assert.ok(denied?.status==='budget_exhausted');assert.equal(denied.error_code,'listening_discovery_parent_budget_exhausted');assert.equal(denied.cap_micro_usd,'1000');assert.equal(denied.exposure_micro_usd,'18');
  assert.equal((await db.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0].status,'failed');assert.equal(await store.claim({database:db,execution_id:f.execution.id}),null);
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_rounds WHERE execution_id=$1',[f.execution.id])).rows[0].n,0);
 },{cap_micro_usd:1000});
});

test('three native rounds wait for exact publication and stop at the sealed maximum',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage});
 async function advance(){
  const lease=await store.claim({database:db,execution_id:f.execution.id});if(!lease)return null;
  try{
  const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.numericReceipt(subset);await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});
   const next=await store.enqueue({database:db,lease,generation_id:lease.source_generation_id,expected_ordinal:lease.next_ordinal,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});assert.ok(next&&next.status!=='budget_exhausted');return next;
  }finally{await store.release({database:db,lease});}
 }
 let round=await advance();assert.ok(round);
 for(let ordinal=1;ordinal<=3;ordinal++){
  assert.equal(round.ordinal,ordinal);
  const completed=await f.finishRound(round,Math.min(3,ordinal+1));assert.equal(completed.status,'completed');
  assert.equal(await store.claim({database:db,execution_id:f.execution.id}),null,'no next review before exact native publication');
  let armed=false,fired=false,publication:Promise<{id:string}>|undefined;let competitors:Array<Promise<ListeningDiscoveryRoundV1|null>>=[];
  const round_id=round.id;
  const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
   if(sql.startsWith('INSERT INTO signal_listening_serving_snapshots'))armed=true;
   if(sql==='COMMIT'&&armed&&!fired){fired=true;
    // Both real drainers wait behind the publisher's native day lock. The ACK
    // is then lost AFTER PostgreSQL committed its one exact snapshot.
    publication=activateSignalListeningServingSnapshotV1({...f,round_id});competitors=[advance(),advance()];await new Promise(resolve=>setTimeout(resolve,5));
    await(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);throw Error('synthetic_publication_ack_lost');
   }
   return(target.query as(...a:unknown[])=>Promise<unknown>)(sql,...values);
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
  await assert.rejects(activateSignalListeningServingSnapshotV1({...f,database:proxy,round_id}),/synthetic_publication_ack_lost/);assert.equal(fired,true);
  const replay=await publication;assert.ok(replay);
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_serving_snapshots WHERE round_id=$1',[round.id])).rows[0].n,1);
  assert.equal(completed.stop_decision!.stop,ordinal===3);
  const advanced=await Promise.all(competitors),next=advanced.filter((value):value is ListeningDiscoveryRoundV1=>value!==null);
  if(ordinal<3){assert.equal(next.length,1,'only one advancing drainer can admit the next review');round=next[0]!;}
  else assert.equal(next.length,0);
 }
 assert.equal(await store.claim({database:db,execution_id:f.execution.id}),null);assert.ok(!(await store.pending({database:db,limit:20})).some(p=>p.execution_id===f.execution.id));
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1 AND action='listening_discovery_review'",[f.workspace_id])).rows[0].n,3);
 assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1'",[f.workspace_id])).rows[0].n,3);
 assert.equal((await db.query('SELECT status FROM signal_listening_discovery_executions WHERE id=$1',[f.execution.id])).rows[0].status,'completed');
},{initial_approved:1}));

test('a native sibling JEV reservation and Sonnet review share the same organization money lock',{
 skip:!enabled,timeout:600000,
},async()=>withDiscoveryAdvanceFixtureV1(async f=>{
 const db=f.database,store=createSignalListeningDiscoveryAdvanceStoreV1({database:db,numeric_storage:f.storage}),lease=(await store.claim({database:db,execution_id:f.execution.id}))!;
 const subset=await store.ensureSubset({database:db,lease,generation_id:lease.source_generation_id}),numeric=await f.emptyNumeric(subset);await store.persistNumeric({database:db,lease,subset_id:subset.id,numeric});
 const round=await store.enqueue({database:db,lease,generation_id:lease.source_generation_id,expected_ordinal:1,expected_policy_version_id:lease.policy_version_id,expected_policy_digest:lease.policy_digest,expected_human_revision_digest:lease.human_revision_digest,numeric_manifest_sha256:numeric.manifest_sha256,provider_available:true});assert.ok(round&&round.status!=='budget_exhausted');await store.release({database:db,lease});
 const reviewLease=await claimSignalListeningDiscoveryRoundV1({database:db,round_id:round.id});assert.ok(reviewLease);
 const previous=process.env.NOISIA_MENTION_FACETS_ENABLED;process.env.NOISIA_MENTION_FACETS_ENABLED='true';
 try{
  await db.query("INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by) VALUES($1,'mention_facets',$2) ON CONFLICT DO NOTHING",[f.workspace_id,f.actor_user_id]);
  const identity=jevFacetLabelerIdentityV1(JEV_FACET_EXPERIMENTAL_THRESHOLDS_V1,.042),admitted=await requestMentionFacetsV1({...f,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true,identity});
  const sibling=createSignalLabelingStoreV1({database:db,storeRaw:async()=>{throw Error('no sibling provider call');}}),run=await sibling.claim(admitted.run_id);assert.ok(run);
  const input=(await sibling.inputs(run))[0]!;assert.ok(input);const request=buildJevFacetRequestV1(input,run.context,identity.model),request_digest=stableDigest({run_id:run.id,root_id:input.root_id,input_digest:input.input_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
  const outcomes=await Promise.allSettled([reserveSignalListeningDiscoveryCallV1({database:db,lease:reviewLease,provider_available:true}),sibling.reserve(run,[{custom_id:'mfj1_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[input],reserved_micro_usd:1000}])]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1,'only one owner can reserve the remaining shared money');
  const denied=outcomes.find((o):o is PromiseRejectedResult=>o.status==='rejected');assert.ok(denied);assert.match(String(denied.reason),/daily_cap_exhausted/);
  const exposure=(await db.query("SELECT total_micro_usd::text value FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)",[f.policy.organization_id,f.policy.budget_timezone])).rows[0].value;
  assert.ok(BigInt(exposure)<=BigInt(f.policy.daily_cap_micro_usd));
  assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1' AND sent_at IS NOT NULL",[f.workspace_id])).rows[0].n,0);
  assert.equal((await db.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status<>'reserved'",[run.id])).rows[0].n,0,'no sibling HTTP attempt or label is invented');
 }finally{if(previous===undefined)delete process.env.NOISIA_MENTION_FACETS_ENABLED;else process.env.NOISIA_MENTION_FACETS_ENABLED=previous;}
},{org_race:true}));

function changed(numeric:ListeningDiscoveryNumericInputV1,mutate:(m:Record<string,unknown>)=>void):ListeningDiscoveryNumericInputV1{
 const m=JSON.parse(numeric.manifest_json);mutate(m);const manifest_json=JSON.stringify(m),manifest_sha256=sha(manifest_json);
 return{manifest_json,manifest_sha256,artifacts:numeric.artifacts.map(a=>a.name==='numeric-manifest.json'?{...a,sha256:manifest_sha256,size_bytes:Buffer.byteLength(manifest_json)}:a)};
}
