import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import {availableParallelism,cpus,platform,arch,totalmem,loadavg} from "node:os";
import type pg from "pg";
import {seed,processingBatch,addRoots,complete,scalar,sha,byteLength} from "./signal-import-finalization.synthetic.fixture";

test("completion avoids the legacy per-root loop even without semantic drafts",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true"
},async()=>{
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:pg.Pool=await openDatabase(),client=await pool.connect();
 try{await client.query("BEGIN");
  const fixture=await seed(client),batch=await processingBatch(client,fixture,"synthetic finalization","bounded.csv");
  await addRoots(client,fixture,batch,1);
  await client.query(`CREATE OR REPLACE FUNCTION reconcile_signal_semantic_candidate_population_mention(target_workspace_id uuid,target_mention_id uuid)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'per_root_import_reconciliation'; END $$`);
  const result=(await complete(client,batch,1)).rows[0];assert.equal(result.accepted,true);
 }finally{await client.query("ROLLBACK");client.release();await pool.end();}
});

test("normal import completes 95,100 rows atomically with a semantic draft",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:240_000
},async t=>{
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:pg.Pool=await openDatabase(),client=await pool.connect();
 try{
  await client.query("BEGIN");
  const fixture=await seed(client),batch=await processingBatch(client,fixture,"synthetic finalization","finalization.csv");
  const size=95_100;
  await client.query("SELECT ensure_signal_operational_semantic_candidate_v2($1,$2)",[fixture.workspace,fixture.actor]);
  await addRoots(client,fixture,batch,size);
  assert.equal(await scalar(client,"SELECT count(*)::int FROM signal_population_memberships WHERE workspace_id=$1 AND membership_status='included'",[fixture.workspace]),0,"processing roots remain quarantined");
  // Fail closed if a future completion reintroduces its legacy per-root loop.
  // This transaction-local spy restores automatically with the fixture rollback.
  await client.query(`CREATE OR REPLACE FUNCTION reconcile_signal_semantic_candidate_population_mention(target_workspace_id uuid,target_mention_id uuid)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'per_root_import_reconciliation'; END $$`);
  await client.query("SAVEPOINT completion");
  // This is a synthetic performance gate, not a product timeout override.
  // UAT's real worker role has 120s. Reserve at least 30s of that budget on CI;
  // report the measured time instead of treating one developer machine as an SLO.
  const gateMs=90_000,uatTimeoutMs=120_000;
  await client.query("SET LOCAL statement_timeout='90s'; SET LOCAL track_functions='pl'");
  const settings=(await client.query(`SELECT current_setting('server_version_num') version,
   current_setting('shared_buffers') shared_buffers,current_setting('work_mem') work_mem,
   current_setting('effective_cache_size') effective_cache_size,current_setting('jit') jit,
   current_setting('max_parallel_workers_per_gather') max_parallel_workers_per_gather,
   current_setting('random_page_cost') random_page_cost,current_setting('seq_page_cost') seq_page_cost`)).rows[0];
  t.diagnostic(JSON.stringify({performance_workload:{roots:size,semantic_drafts:1,semantic_approvals:0,
   legacy_source_intent_approved:true,gate_ms:gateMs,uat_role_timeout_ms:uatTimeoutMs},
   hardware:{platform:platform(),arch:arch(),logical_cpus:cpus().length,available_parallelism:availableParallelism(),
   memory_mb:Math.round(totalmem()/1024**2),load_average:loadavg()},postgres:settings}));
  const sample=(await client.query<{mention_id:string}>("SELECT mention_id::text FROM signal_mention_import_memberships WHERE import_batch_id=$1 LIMIT 1",[batch.id])).rows[0]!;
  const plan=(await client.query(`EXPLAIN(FORMAT JSON) SELECT EXISTS(
   SELECT 1 FROM signal_mention_import_memberships membership WHERE membership.workspace_id=$1 AND membership.mention_id=$2)
   AND NOT EXISTS(SELECT 1 FROM signal_mention_import_memberships membership JOIN import_batches b
    ON b.id=membership.import_batch_id AND b.workspace_id=membership.workspace_id AND b.status='completed'
    WHERE membership.workspace_id=$1 AND membership.mention_id=$2)`,[fixture.workspace,sample.mention_id])).rows[0]["QUERY PLAN"][0].Plan;
  const scans:Array<Record<string,unknown>>=[];
  function summarizePlan(node:Record<string,unknown>){
   if(node["Relation Name"])scans.push({node:node["Node Type"],relation:node["Relation Name"],
    index:node["Index Name"],estimated_rows:node["Plan Rows"],cost:node["Total Cost"]});
   for(const child of (node.Plans??[]) as Array<Record<string,unknown>>)summarizePlan(child);
  }
  summarizePlan(plan);t.diagnostic(JSON.stringify({accepted_import_guard_plan:scans}));
  const started=performance.now();
  let result;
  try{
   result=(await client.query(`SELECT * FROM complete_signal_workspace_import_v1($1::uuid,$2,$3,$4,$4,0,0,$5)`,[batch.id,batch.job,createHash('sha256').update('finalization:'+batch.id).digest('hex'),size,byteLength('synthetic finalization')])).rows[0];
  }catch(error){
   t.diagnostic(JSON.stringify({completion_failed_after_ms:Math.round(performance.now()-started)}));
   await client.query("ROLLBACK TO SAVEPOINT completion");
   t.diagnostic(JSON.stringify({failed_function_timings:(await client.query(`SELECT funcname,calls,total_time::int total_ms,self_time::int self_ms FROM pg_stat_xact_user_functions WHERE calls>0 ORDER BY total_time DESC LIMIT 20`)).rows}));
   throw error;
  }
  const elapsed=performance.now()-started;
  const timings=(await client.query(`SELECT funcname,calls,total_time::int total_ms,self_time::int self_ms
   FROM pg_stat_xact_user_functions WHERE calls>0 ORDER BY total_time DESC LIMIT 20`)).rows;
  t.diagnostic(JSON.stringify({completion_ms:Math.round(elapsed),uat_headroom_ms:Math.round(uatTimeoutMs-elapsed),function_timings:timings}));
  assert.ok(elapsed<gateMs,`completion must retain at least 30s of the real worker budget; observed ${Math.round(elapsed)}ms`);
  assert.equal(result.accepted,true);
  assert.equal(await scalar(client,"SELECT count(*)::int FROM signal_population_memberships WHERE workspace_id=$1 AND membership_status='included' AND removed_at IS NULL",[fixture.workspace]),size);
  assert.equal(await scalar(client,"SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1",[batch.id]),1);
  const durable=await completionState(client,fixture.workspace);
  assert.equal((await complete(client,batch,size)).rows[0].accepted,true);
  assert.deepEqual(await completionState(client,fixture.workspace),durable,"completed replay is a pure read");
  await client.query("ROLLBACK TO SAVEPOINT completion");
  assert.equal(await scalar(client,"SELECT status FROM import_batches WHERE id=$1",[batch.id]),'processing',"completion and visibility roll back together");
 }finally{await client.query("ROLLBACK");client.release();await pool.end();}
});

test("bulk completion preserves the row-reconciler oracle, draft isolation and sibling visibility",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:60_000
},async()=>{
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:pg.Pool=await openDatabase(),client=await pool.connect();
 try{await client.query("BEGIN");
  const fixture=await seed(client),prior=await processingBatch(client,fixture,"synthetic finalization","prior.csv");
  await addRoots(client,fixture,prior,8);await complete(client,prior,8);
  const roots=(await client.query<{id:string}>("SELECT id::text FROM mentions WHERE source_file_id=$1 ORDER BY id",[prior.id])).rows.map(x=>x.id);
  const primary=await scalar<string>(client,"SELECT ensure_signal_operational_semantic_candidate_v2($1,$2)::text",[fixture.workspace,fixture.actor]);
  const attributable=await scalar<string>(client,"SELECT population_id::text FROM ensure_signal_operational_attributable_semantic_base_v1($1,$2)",[fixture.workspace,fixture.actor]);
  const reference=randomUUID();await client.query(`INSERT INTO intelligence_entities(id,organization_id,brand_id,entity_type,canonical_name,status)
   VALUES($1,$2,$3,'reference','Synthetic reference','active')`,[reference,fixture.organization,fixture.brand]);
  await assertion(client,fixture,prior,roots[0]!,fixture.brand,'primary_brand','brand',true);
  await assertion(client,fixture,prior,roots[1]!,fixture.brand,'primary_brand','brand',false);
  await assertion(client,fixture,prior,roots[2]!,reference,'reference','reference',true);
  await assertion(client,fixture,prior,roots[3]!,fixture.brand,'primary_brand','brand',true);
  await assertion(client,fixture,prior,roots[7]!,fixture.brand,'primary_brand','brand',true);
  await client.query("UPDATE mentions SET inclusion_status='excluded',exclusion_reason='synthetic exclusion' WHERE id=$1",[roots[3]]);
  await client.query("UPDATE mentions SET quality_score=1 WHERE id=$1",[roots[4]]);
  await client.query("UPDATE mentions SET published_at='2025-01-01T12:00:00Z' WHERE id=$1",[roots[5]]);
  await client.query("UPDATE mentions SET published_at='2027-01-01T12:00:00Z' WHERE id=$1",[roots[6]]);
  await client.query(`UPDATE signal_population_definitions p SET min_quality_score=5,period_start='2026-01-01',period_end='2026-12-31'
   FROM signal_workspace_population_pointers pointer WHERE pointer.population_id=p.id AND pointer.workspace_id=$1 AND pointer.purpose='operational'`,[fixture.workspace]);
  const sibling=await seed(client),siblingBatch=await processingBatch(client,sibling,"synthetic finalization","sibling.csv");
  await addRoots(client,sibling,siblingBatch,1);await complete(client,siblingBatch,1);
  const siblingBefore=await completionState(client,sibling.workspace);
  const batch=await processingBatch(client,fixture,"synthetic finalization","repeated-roots.csv");
  await client.query("SELECT record_signal_workspace_import_provenance_set_v1($1,$2::uuid[],$3::text[])",[batch.id,roots,roots.map(()=> 'duplicate')]);
  await client.query('UPDATE mentions SET canonical_mention_id=$2 WHERE id=$1',[roots[7],roots[0]]);
  const pointers=(await client.query("SELECT * FROM signal_workspace_population_pointers WHERE workspace_id=$1 ORDER BY purpose",[fixture.workspace])).rows;
  await client.query("SAVEPOINT oracle");
  await client.query("SELECT materialize_signal_workspace_import_source_intent_v1($1)",[batch.id]);
  await client.query("SELECT set_config('noisia.import_bulk_reconcile','on',true)");
  for(const root of roots){
   await client.query("SELECT reconcile_signal_operational_population_mention($1,$2),reconcile_signal_semantic_candidate_population_mention($1,$2),reconcile_signal_attributable_semantic_base_mention_v1($1,$2,false)",[fixture.workspace,root]);
  }
  await client.query("SELECT set_config('noisia.import_bulk_reconcile','off',true)");
  await client.query("SELECT refresh_signal_operational_bridge_membership_digest_v1($1),refresh_signal_semantic_candidate_membership_digest($2),refresh_signal_attributable_semantic_base_digest_v1($3)",[fixture.workspace,primary,attributable]);
  const expected=await memberships(client,fixture.workspace);
  const visibleExpected=await scalar(client,`SELECT count(*)::int FROM signal_population_memberships m JOIN mentions root ON root.id=m.mention_id AND root.canonical_mention_id=root.id WHERE m.workspace_id=$1 AND m.membership_status='included' AND m.removed_at IS NULL`,[fixture.workspace]);
  await client.query("ROLLBACK TO SAVEPOINT oracle");
  // Replayed existing roots are duplicates; they still need membership reconciliation.
  const done=(await client.query(`SELECT * FROM complete_signal_workspace_import_v1($1,$2,$3,8,0,0,8,$4)`,[batch.id,batch.job,sha(batch.id).slice(7),byteLength('synthetic finalization')])).rows[0];
  assert.equal(done.accepted,true);assert.deepEqual(await memberships(client,fixture.workspace),expected);
  assert.equal(await scalar(client,`SELECT count(*)::int FROM signal_population_memberships m JOIN mentions root ON root.id=m.mention_id AND root.canonical_mention_id=root.id WHERE m.workspace_id=$1 AND m.membership_status='included' AND m.removed_at IS NULL`,[fixture.workspace]),visibleExpected);
  assert.deepEqual(await completionState(client,sibling.workspace),siblingBefore,"another workspace's serving and acceptance remain byte-identical");
  assert.deepEqual((await client.query("SELECT * FROM signal_workspace_population_pointers WHERE workspace_id=$1 ORDER BY purpose",[fixture.workspace])).rows,pointers,"completion cannot promote a draft");
  assert.equal(await scalar(client,"SELECT status FROM signal_population_definitions WHERE id=$1",[primary]),'draft');
  assert.equal(await scalar(client,"SELECT count(*)::int FROM signal_population_memberships m JOIN mentions root ON root.id=m.mention_id AND root.canonical_mention_id=root.id WHERE population_id=$1 AND membership_status='included' AND removed_at IS NULL",[primary]),1);
  assert.equal(await scalar(client,"SELECT count(*)::int FROM signal_population_memberships m JOIN mentions root ON root.id=m.mention_id AND root.canonical_mention_id=root.id WHERE population_id=$1 AND membership_status='included' AND removed_at IS NULL",[attributable]),2);
 }finally{await client.query("ROLLBACK");client.release();await pool.end();}
});

async function assertion(client:pg.PoolClient,fixture:Awaited<ReturnType<typeof seed>>,batch:Awaited<ReturnType<typeof processingBatch>>,root:string,entity:string,scope:string,type:string,approve:boolean){
 const id=await scalar<string>(client,`SELECT create_signal_mention_semantic_assertion($1,$2,$3,$4,$5,$6,$7,'Synthetic',0.99,'human_reviewed_context',$8,'fixture-semantic','1',NULL,$9,NULL)::text`,
 [fixture.workspace,root,fixture.source,batch.id,scope,type,entity,sha(root+scope),sha(randomUUID())]);
 if(approve)await client.query("SELECT review_signal_mention_semantic_assertion($1,$2,'approve','fixture','fixture-review','1',$3,$4)",[id,fixture.actor,sha(randomUUID()),sha(randomUUID())]);
}
async function memberships(client:pg.PoolClient,workspace:string){
 return (await client.query(`SELECT p.id,p.status,p.membership_digest,COALESCE(jsonb_agg(jsonb_build_array(m.mention_id,m.membership_status,m.membership_reason,m.effective_at,m.removed_at) ORDER BY m.mention_id) FILTER(WHERE m.id IS NOT NULL),'[]') members
 FROM signal_population_definitions p LEFT JOIN signal_population_memberships m ON m.population_id=p.id
 WHERE p.workspace_id=$1 GROUP BY p.id ORDER BY p.id`,[workspace])).rows;
}
async function completionState(client:pg.PoolClient,workspace:string){
 return (await client.query(`SELECT jsonb_build_object('memberships',(SELECT jsonb_build_object('count',count(*),'digest',encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(m)::text,'' ORDER BY m.id),''),'UTF8')),'hex')) FROM signal_population_memberships m WHERE workspace_id=$1),
 'batches',(SELECT jsonb_agg(b ORDER BY b.id) FROM import_batches b WHERE workspace_id=$1),
 'pointers',(SELECT jsonb_agg(p ORDER BY p.id) FROM signal_workspace_population_pointers p WHERE workspace_id=$1),
 'watermarks',(SELECT jsonb_agg(w ORDER BY w.id) FROM signal_data_watermarks w WHERE workspace_id=$1),
 'sync',(SELECT jsonb_agg(s ORDER BY s.id) FROM source_sync_runs s WHERE workspace_id=$1),
 'events',(SELECT jsonb_agg(e ORDER BY e.id) FROM signal_workspace_import_events e WHERE workspace_id=$1),
 'outbox',(SELECT jsonb_agg(o ORDER BY o.id) FROM signal_workspace_import_outbox o WHERE workspace_id=$1)) state`,[workspace])).rows[0].state;
}
