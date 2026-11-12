import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {createMassLabelingProductDatabaseFixtureV1} from "./signal-mass-labeling-product-database.synthetic.fixture";
import {seed,processingBatch,addRoots,complete,scalar} from "./signal-import-finalization.synthetic.fixture";

test("import publication serializes disjoint batches, promotion and rollback",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:180_000
},async()=>{
 const {database,cleanup}=await createMassLabelingProductDatabaseFixtureV1();
 const setup=await database.connect(),left=await database.connect(),right=await database.connect();
 try{
  const fixture=await seed(setup),first=await processingBatch(setup,fixture,"synthetic finalization","first.csv"),second=await processingBatch(setup,fixture,"synthetic finalization","second.csv");
  await addRoots(setup,fixture,first,2);await addRoots(setup,fixture,second,3);
  const pid=await scalar<number>(right,"SELECT pg_backend_pid()",[]);
  // The second statement begins before the first commit. Its post-lock SQL must
  // see the union, not publish a digest computed from the old MVCC snapshot.
  await left.query("BEGIN");await complete(left,first,2);
  let result=complete(right,second,3);await waitUntilBlocked(setup,pid);
  await left.query("COMMIT");assert.equal((await result).rows[0].accepted,true);
  await assertDigest(setup,fixture.workspace,5);

  const duringCreation=await processingBatch(setup,fixture,"synthetic finalization","during-draft.csv");await addRoots(setup,fixture,duringCreation,1);
  await left.query("BEGIN");
  const candidate=await scalar<string>(left,"SELECT ensure_signal_operational_semantic_candidate_v2($1,$2)::text",[fixture.workspace,fixture.actor]);
  result=complete(right,duringCreation,1);await waitUntilBlocked(setup,pid);
  await left.query("COMMIT");assert.equal((await result).rows[0].accepted,true);
  assert.equal(await scalar(setup,"SELECT status FROM signal_population_definitions WHERE id=$1",[candidate]),'draft');
  await assertDigest(setup,fixture.workspace,6);
  const third=await processingBatch(setup,fixture,"synthetic finalization","third.csv");await addRoots(setup,fixture,third,1);
  await left.query("BEGIN");
  // Product promotion locks, deletes and recreates the pointer before commit.
  await left.query("SELECT promote_signal_workspace_population($1,'operational',$2,$3)",[fixture.workspace,candidate,fixture.actor]);
  result=complete(right,third,1);await waitUntilBlocked(setup,pid);
  await left.query("COMMIT");assert.equal((await result).rows[0].accepted,true);
  assert.equal(await scalar(setup,"SELECT population_id::text FROM signal_workspace_population_pointers WHERE workspace_id=$1 AND purpose='operational'",[fixture.workspace]),candidate);
  await assertDigest(setup,fixture.workspace,0);
  assert.equal(await scalar(setup,"SELECT membership_reason FROM signal_population_memberships WHERE population_id=$1 AND mention_id=(SELECT mention_id FROM signal_mention_import_memberships WHERE import_batch_id=$2 LIMIT 1)",[candidate,third.id]),'semantic_assertion_not_eligible',"new batch uses the promoted semantic predicate, never the retired bridge");

  const fourth=await processingBatch(setup,fixture,"synthetic finalization","rolled-back.csv"),fifth=await processingBatch(setup,fixture,"synthetic finalization","after-rollback.csv");
  await addRoots(setup,fixture,fourth,1);await addRoots(setup,fixture,fifth,1);
  await left.query("BEGIN");await complete(left,fourth,1);
  result=complete(right,fifth,1);await waitUntilBlocked(setup,pid);
  await left.query("ROLLBACK");assert.equal((await result).rows[0].accepted,true);
  assert.equal(await scalar(setup,"SELECT status FROM import_batches WHERE id=$1",[fourth.id]),'processing');
  assert.equal(await scalar(setup,"SELECT count(*)::int FROM source_sync_runs WHERE import_batch_id=$1",[fourth.id]),0,"rollback cannot publish sync/acceptance for an incomplete batch");
  await assertDigest(setup,fixture.workspace,0);
 }finally{
  await left.query("ROLLBACK");await right.query("ROLLBACK");
  setup.release();left.release();right.release();await cleanup();
 }
});

async function waitUntilBlocked(observer:pg.PoolClient,pid:number){
 const until=performance.now()+10_000;
 while(performance.now()<until){
  const blockers=await scalar<number>(observer,"SELECT cardinality(pg_blocking_pids($1))",[pid]);
  if(blockers>0)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail("concurrent import must wait for the uncommitted publication lock");
}
async function assertDigest(client:pg.PoolClient,workspace:string,count:number){
 const row=(await client.query(`SELECT p.membership_digest,'sha256:'||encode(sha256(convert_to(COALESCE(string_agg(m.mention_id::text,',' ORDER BY m.mention_id)
  FILTER(WHERE m.membership_status='included' AND m.removed_at IS NULL),''),'UTF8')),'hex') actual,
  count(*) FILTER(WHERE m.membership_status='included' AND m.removed_at IS NULL)::int included
 FROM signal_workspace_population_pointers pointer JOIN signal_population_definitions p ON p.id=pointer.population_id
 LEFT JOIN signal_population_memberships m ON m.population_id=p.id WHERE pointer.workspace_id=$1 AND pointer.purpose='operational' GROUP BY p.id`,[workspace])).rows[0];
 assert.equal(row.included,count);assert.equal(row.membership_digest,row.actual);
}
