import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";
import {signalRetentionPolicyDefinitionHashV1,signalProvenancePolicyBindingDefinitionHashV1,
 type SignalRetentionPolicyDefinitionV1,type SignalProvenancePolicyBindingDefinitionV1} from "@noisia/query-engine";
import * as store from "../signal-workspace-corpus-preparation";
import {requestSignalWorkspaceCorpusPreparationStoreV1 as request,loadSignalWorkspaceCorpusPreparationStoreV1 as status} from "../signal-workspace-corpus-preparation-management";
import {signalWorkspaceCorpusPreparationJobV1 as execute} from "../../../services/workers/src/workers/signal-workspace-corpus-preparation";

test("workspace preparation freezes full text, fences retries, invalidates corrections and scopes private assets",{
 skip:process.env.NOISIA_CORPUS_PREPARATION_TEST_APPROVED!=="true",timeout:120_000
},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname));assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const database=new pg.Pool({connectionString:url.href,ssl:false,max:3});
 const workspace_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_ACTOR_ID!;
 const ask=(key=randomUUID())=>request({database,workspace_id,actor_user_id,idempotency_key:key});
 const load=()=>status({queryable:database,workspace_id});
 const claim=async(run_id:string)=>{const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[run_id])).rows[0]!.worker_job_id;
  const lease=await store.claimSignalWorkspaceCorpusPreparationRunV1({database,run_id,worker_job_id:job});assert.ok(lease);return lease;};
 const runWorker=async(run_id:string)=>{const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[run_id])).rows[0]!.worker_job_id;
  await execute({id:job,data:{run_id},updateProgress:async()=>{}},{database,page_size:100});};
 let changedRoot:string|null=null;let originalText:string|null=null;let lease:store.SignalWorkspaceCorpusPreparationLeaseV1|null=null;
 try{
  const initial=await load();assert.equal(initial.is_current,true,"runner must first finish the isolated600-root fixture");
  assert.equal(initial.latest_completed!.counts.total_roots,600);
  const long=(await database.query<{full_text:string;text_sha256:string;chunks:store.SignalCorpusTextChunksV1}>(`SELECT full_text,text_sha256,chunks FROM signal_corpus_text_assets
    WHERE workspace_id=$1::uuid ORDER BY char_length(full_text) DESC LIMIT 1`,[workspace_id])).rows[0]!;
  assert.ok(long.chunks.chunks.length>80);store.validateSignalCorpusTextChunksV1(long.full_text,long.text_sha256,long.chunks);
  const permissions=(await database.query<{relrowsecurity:boolean;relacl:unknown}>(`SELECT relrowsecurity,relacl FROM pg_class
    WHERE oid=ANY(ARRAY['signal_corpus_text_assets'::regclass,'signal_corpus_preparation_items'::regclass,'signal_corpus_preparation_runs'::regclass,'signal_corpus_preparation_input_state'::regclass])`)).rows;
  assert.equal(permissions.length,4);assert.ok(permissions.every(row=>row.relrowsecurity));
  const publicGrants=(await database.query<{count:string}>(`SELECT count(*)::text FROM pg_class relation
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) acl
    WHERE relation.oid=ANY(ARRAY['signal_corpus_text_assets'::regclass,'signal_corpus_preparation_items'::regclass,'signal_corpus_preparation_runs'::regclass,'signal_corpus_preparation_input_state'::regclass]) AND acl.grantee=0`)).rows[0]!.count;
  assert.equal(publicGrants,"0");
  const root=(await database.query<{id:string;text_clean:string}>(`SELECT id,text_clean FROM mentions WHERE workspace_id=$1::uuid
    AND canonical_mention_id=id AND inclusion_status='included' ORDER BY id LIMIT 1`,[workspace_id])).rows[0]!;
  changedRoot=root.id;originalText=root.text_clean;
  await database.query("UPDATE mentions SET text_clean=text_clean||' changed preparation fixture' WHERE id=$1::uuid",[root.id]);
  assert.equal((await load()).is_current,false);assert.equal((await load()).latest_completed!.id,initial.latest_completed!.id);
  const key=randomUUID(),first=await ask(key);assert.equal((await ask(key)).run_id,first.run_id);
  lease=await claim(first.run_id);lease=await store.snapshotSignalWorkspaceCorpusPreparationV1({database,lease});
  assert.equal((await load()).active_run!.counts.changed_roots,1);
  const page=await store.readSignalWorkspaceCorpusPreparationPageV1({database,lease,limit:1});
  await assert.rejects(store.readSignalWorkspaceCorpusPreparationAssetV1({database,lease:{...lease,workspace_id:randomUUID()},asset_sha256:long.text_sha256}),/corpus_preparation_lease_lost/);
  await database.query("UPDATE signal_corpus_preparation_runs SET execution_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[first.run_id]);
  await assert.rejects(store.commitSignalWorkspaceCorpusPreparationPageV1({database,lease,page,assets:[]}),/corpus_preparation_lease_lost/);
  await store.scheduleSignalWorkspaceCorpusPreparationV1({database});
  const recovered=await claim(first.run_id);assert.notEqual(recovered.execution_token,lease.execution_token);
  await assert.rejects(store.readSignalWorkspaceCorpusPreparationPageV1({database,lease}),/corpus_preparation_lease_lost/);
  lease=recovered;
  // Mutation after snapshot must supersede it, while the sealed old body remains unchanged.
  await database.query("UPDATE mentions SET text_clean=$2 WHERE id=$1::uuid",[root.id,originalText]);
  await assert.rejects(store.readSignalWorkspaceCorpusPreparationPageV1({database,lease}),/corpus_preparation_inputs_changed/);
  await store.failSignalWorkspaceCorpusPreparationV1({database,lease,error_code:"corpus_preparation_inputs_changed"});lease=null;
  assert.equal((await load()).latest_run!.status,"superseded");
  const replacement=await ask();await runWorker(replacement.run_id);
  const complete=await load();assert.equal(complete.is_current,true);assert.equal(complete.latest_completed!.counts.processed_roots,600);
  // Inclusion uncertainty has its own complete accounting; it is not mislabeled excluded.
  await database.query("UPDATE mentions SET inclusion_status='pending' WHERE id=$1::uuid",[root.id]);
  const pending=await ask();await runWorker(pending.run_id);assert.equal((await load()).latest_completed!.counts.inclusion_pending_roots,1);
  await database.query("UPDATE mentions SET inclusion_status='included' WHERE id=$1::uuid",[root.id]);
  const restored=await ask();await runWorker(restored.run_id);assert.equal((await load()).is_current,true);
  const priorCount=(await database.query<{count:string}>("SELECT count(*)::text FROM signal_corpus_text_assets WHERE workspace_id=$1::uuid",[workspace_id])).rows[0]!.count;
  assert.equal(Number(priorCount),592,"591 originals plus one changed full text, reused by later generations");
  // Authorization removed after request is durably visible, not a permanently queued job.
  await database.query("UPDATE mentions SET text_clean=text_clean||' revoke fixture' WHERE id=$1::uuid",[root.id]);
  const forbidden=await ask();await database.query("UPDATE users SET status='suspended' WHERE id=$1::uuid",[actor_user_id]);
  const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1",[forbidden.run_id])).rows[0]!.worker_job_id;
  assert.equal(await store.claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:forbidden.run_id,worker_job_id:job}),null);
  assert.equal((await load()).latest_run!.error_code,"corpus_preparation_forbidden");
  await database.query("UPDATE users SET status='active' WHERE id=$1::uuid",[actor_user_id]);
  await database.query("UPDATE mentions SET text_clean=$2 WHERE id=$1::uuid",[root.id,originalText]);
  const last=await ask();await runWorker(last.run_id);assert.equal((await load()).is_current,true);
 }finally{
  if(lease)await store.failSignalWorkspaceCorpusPreparationV1({database,lease});
  if(changedRoot!==null)await database.query("UPDATE mentions SET text_clean=$2,inclusion_status='included' WHERE id=$1::uuid",[changedRoot,originalText]);
  await database.query("UPDATE users SET status='active' WHERE id=$1::uuid",[actor_user_id]);
  await database.end();
 }
});

test("late dispatch failure or acknowledgement cannot replace a completed execution",{
 skip:process.env.NOISIA_CORPUS_PREPARATION_TEST_APPROVED!=="true",timeout:30_000
},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname));assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const database=new pg.Pool({connectionString:url.href,ssl:false,max:2});
 const workspace=process.env.NOISIA_CORPUS_PREPARATION_TEST_WORKSPACE_ID!;let runId:string|undefined;
 try{
  const prior=(await database.query<{id:string;counts:unknown}>(`SELECT id,counts FROM signal_corpus_preparation_runs
    WHERE workspace_id=$1::uuid AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[workspace])).rows[0]!;
  assert.ok(prior);runId=prior.id;const token=randomUUID();
  await database.query(`UPDATE signal_corpus_preparation_runs SET dispatch_status='dispatching',dispatch_token=$2::uuid,
    dispatch_expires_at=clock_timestamp()+interval '1 minute',dispatch_attempts=8 WHERE id=$1::uuid`,[runId,token]);
  await store.failSignalWorkspaceCorpusPreparationDispatchV1({database,run_id:runId,dispatch_token:token});
  await store.acknowledgeSignalWorkspaceCorpusPreparationDispatchV1({database,run_id:runId,dispatch_token:token});
  const final=(await database.query<{status:string;phase:string;counts:unknown}>("SELECT status,phase,counts FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[runId])).rows[0]!;
  assert.equal(final.status,"completed");assert.equal(final.phase,"complete");assert.deepEqual(final.counts,prior.counts);
 }finally{
  if(runId)await database.query(`UPDATE signal_corpus_preparation_runs SET status='completed',dispatch_status='dispatched',dispatch_token=NULL,
    dispatch_expires_at=NULL,dispatch_attempts=0 WHERE id=$1::uuid`,[runId]);
  await database.end();
 }
});

test("queue failure backs off, stops after eight attempts and resumes the sealed checkpoint",{
 skip:process.env.NOISIA_CORPUS_PREPARATION_TEST_APPROVED!=="true",timeout:30_000
},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const database=new pg.Pool({connectionString:url.href,ssl:false,max:3});
 const workspace_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_ACTOR_ID!;
 const load=()=>status({queryable:database,workspace_id});
 const ask=(idempotency_key=randomUUID())=>request({database,workspace_id,actor_user_id,idempotency_key});
 let expiredId:string|null=null,runId:string|null=null;
 let previousDeadline:Date|null=null;
 try{
  assert.equal((await database.query("SELECT 1 FROM signal_corpus_preparation_runs WHERE status IN('queued','running')")).rowCount,0,"run only with the isolated drainer stopped");
  const completed=(await database.query<{id:string;policy_valid_until:Date|null}>(`SELECT id,policy_valid_until FROM signal_corpus_preparation_runs
    WHERE workspace_id=$1::uuid AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[workspace_id])).rows[0]!;
  expiredId=completed.id;previousDeadline=completed.policy_valid_until;
  // Seed a stale completed ledger to request a fresh run without changing the fixture's text.
  await database.query("UPDATE signal_corpus_preparation_runs SET policy_valid_until=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[expiredId]);
  runId=(await ask()).run_id;
  const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[runId])).rows[0]!.worker_job_id;
  let lease=await store.claimSignalWorkspaceCorpusPreparationRunV1({database,run_id:runId,worker_job_id:job});assert.ok(lease);
  lease=await store.snapshotSignalWorkspaceCorpusPreparationV1({database,lease});
  const page=await store.readSignalWorkspaceCorpusPreparationPageV1({database,lease});
  assert.equal(page.items.length,100);assert.ok(page.items.every(item=>!item.asset_sha256||item.asset_ready));
  lease=await store.commitSignalWorkspaceCorpusPreparationPageV1({database,lease,page,assets:[]});
  await store.failSignalWorkspaceCorpusPreparationV1({database,lease,error_code:"corpus_preparation_worker_failed"});
  const retryKey=randomUUID();assert.equal((await ask(retryKey)).run_id,runId);
  for(let attempt=1;attempt<=8;attempt++){
   const dispatches=await store.claimSignalWorkspaceCorpusPreparationDispatchV1({database,limit:32});
   assert.equal(dispatches.length,1);const dispatch=dispatches[0]!;assert.equal(dispatch.run_id,runId);
   await store.failSignalWorkspaceCorpusPreparationDispatchV1({database,run_id:runId,dispatch_token:dispatch.dispatch_token});
   const row:{status:string;dispatch_attempts:number;backoff:boolean;cursor_root_id:string;counts:store.SignalWorkspaceCorpusPreparationCountsV1}=(await database.query<{status:string;dispatch_attempts:number;backoff:boolean;cursor_root_id:string;counts:store.SignalWorkspaceCorpusPreparationCountsV1}>(`
     SELECT status,dispatch_attempts,available_at>clock_timestamp() backoff,cursor_root_id,counts
     FROM signal_corpus_preparation_runs WHERE id=$1::uuid`,[runId])).rows[0]!;
   assert.equal(row.dispatch_attempts,attempt);assert.equal(row.backoff,true);assert.equal(row.cursor_root_id,page.next_cursor);assert.equal(row.counts.processed_roots,100);
   assert.equal(row.status,attempt===8?"failed":"queued");
   assert.deepEqual(await store.claimSignalWorkspaceCorpusPreparationDispatchV1({database}),[],"backoff or terminal status prevents immediate reoffer");
   if(attempt<8)await database.query("UPDATE signal_corpus_preparation_runs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",[runId]);
  }
  assert.equal((await load()).latest_run!.retryable,true);assert.equal((await load()).latest_run!.error_code,"corpus_preparation_queue_unavailable");
  assert.equal((await ask(retryKey)).replayed,true);assert.equal((await load()).latest_run!.status,"failed","an ambiguous-request replay cannot restart work");
  assert.equal((await ask()).run_id,runId);
  const resumed=(await database.query<{worker_job_id:string;dispatch_attempts:number;cursor_root_id:string}>("SELECT worker_job_id,dispatch_attempts,cursor_root_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[runId])).rows[0]!;
  assert.equal(resumed.dispatch_attempts,0);assert.equal(resumed.cursor_root_id,page.next_cursor);
  await execute({id:resumed.worker_job_id,data:{run_id:runId},updateProgress:async()=>{}},{database});
  assert.equal((await load()).is_current,true);assert.equal((await load()).latest_completed!.counts.processed_roots,600);
 }finally{
  if(runId)await database.query(`UPDATE signal_corpus_preparation_runs SET status='failed',error_code='corpus_preparation_worker_failed',execution_token=NULL,execution_expires_at=NULL
    WHERE id=$1::uuid AND status IN('queued','running')`,[runId]);
  if(expiredId)await database.query("UPDATE signal_corpus_preparation_runs SET policy_valid_until=$2::timestamptz WHERE id=$1::uuid",[expiredId,previousDeadline]);
  await database.end();
 }
});

test("retention expiry and future binding activation invalidate preparation without a row mutation",{
 skip:process.env.NOISIA_CORPUS_PREPARATION_TEST_APPROVED!=="true",timeout:60_000
},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.match(url.pathname,/^\/noisia_national_import_test_\d+$/u);
 const database=new pg.Pool({connectionString:url.href,ssl:false,max:3});
 const workspace_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_WORKSPACE_ID!,actor_user_id=process.env.NOISIA_CORPUS_PREPARATION_TEST_ACTOR_ID!;
 const hash=()=>`sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`;
 const policyIds:string[]=[],bindingIds:string[]=[];
 const load=()=>status({queryable:database,workspace_id});
 const run=async()=>{
  const {run_id}=await request({database,workspace_id,actor_user_id,idempotency_key:randomUUID()});
  const job=(await database.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_corpus_preparation_runs WHERE id=$1::uuid",[run_id])).rows[0]!.worker_job_id;
  await execute({id:job,data:{run_id},updateProgress:async()=>{}},{database});return load();
 };
 const retireBindings=()=>database.query(`UPDATE signal_provenance_policy_bindings SET status='retired',effective_to=clock_timestamp()
   WHERE id=ANY($1::uuid[]) AND status='active'`,[bindingIds]);
 try{
  const organizationId=(await database.query<{organization_id:string}>("SELECT organization_id FROM signal_workspaces WHERE id=$1::uuid",[workspace_id])).rows[0]!.organization_id;
  // Exercise the canonical SQL writers and definition hashes without importing Studio's aliases.
  const retention=async(definition:SignalRetentionPolicyDefinitionV1)=>{
   const result=await database.query<{object_id:string}>(`SELECT object_id FROM create_signal_retention_policy_draft(
    $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,'2019-01-01T00:00:00Z'::timestamptz,NULL)`,
   [organizationId,workspace_id,actor_user_id,definition.policy_key,definition.policy_version,definition.retention_state,
    definition.retention_mode,definition.retain_until,definition.expiry_action,definition.approval_evidence_hash,
    signalRetentionPolicyDefinitionHashV1(definition),hash()]);return result.rows[0]!.object_id;
  };
  const binding=async(definition:SignalProvenancePolicyBindingDefinitionV1,effectiveFrom:string)=>{
   const result=await database.query<{object_id:string}>(`SELECT object_id FROM create_signal_provenance_policy_binding_draft(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11::timestamptz,NULL)`,
   [workspace_id,actor_user_id,definition.data_source_id,definition.import_batch_id,definition.binding_version,
    definition.quality_policy_id,definition.retention_policy_id,definition.licensing_policy_id,
    signalProvenancePolicyBindingDefinitionHashV1(definition),hash(),effectiveFrom]);return result.rows[0]!.object_id;
  };
  const activate=async(kind:"retention-policy"|"provenance-binding",id:string)=>{
   const inputHash=`sha256:${createHash("sha256").update(["signal-data-governance-activation-v1",workspace_id,kind,id,actor_user_id].join("\u001f")).digest("hex")}`;
   await database.query("SELECT * FROM activate_signal_data_governance_object($1::uuid,$2::uuid,$3,$4::uuid,$5,$6)",[workspace_id,actor_user_id,kind,id,inputHash,hash()]);
  };
  const imports=(await database.query<{id:string;data_source_id:string;quality_policy_id:string;licensing_policy_id:string}>(`SELECT batch.id,batch.data_source_id,base.quality_policy_id,base.licensing_policy_id
    FROM import_batches batch JOIN signal_provenance_policy_bindings base ON base.workspace_id=batch.workspace_id
      AND base.data_source_id=batch.data_source_id AND base.import_batch_id IS NULL AND base.status='active'
    WHERE batch.workspace_id=$1::uuid AND batch.status='completed'`,[workspace_id])).rows;
  assert.equal(imports.length,2);
  for(const mode of ["expiry","activation"] as const){
   const boundary=(await database.query<{value:string}>("SELECT (clock_timestamp()+interval '3 seconds')::text value")).rows[0]!.value;
   const newPolicy=await retention({
    workspace_id,policy_key:`preparation-${mode}-${randomUUID()}`,policy_version:1,
    retention_state:mode==="expiry"?"allowed":"blocked",retention_mode:mode==="expiry"?"until":"indefinite",
    retain_until:mode==="expiry"?new Date(boundary).toISOString():null,expiry_action:"block_use",approval_evidence_hash:hash()});
   policyIds.push(newPolicy);
   await activate("retention-policy",newPolicy);
   for(const imported of imports){
    const nextVersion=Number((await database.query<{version:number}>(`SELECT COALESCE(max(binding_version),0)+1 version FROM signal_provenance_policy_bindings
      WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid AND import_batch_id=$3::uuid`,[workspace_id,imported.data_source_id,imported.id])).rows[0]!.version);
    const added=await binding({
     workspace_id,data_source_id:imported.data_source_id,import_batch_id:imported.id,binding_version:nextVersion,
     quality_policy_id:imported.quality_policy_id,retention_policy_id:newPolicy,licensing_policy_id:imported.licensing_policy_id},
     mode==="activation"?new Date(boundary).toISOString():"2019-01-01T00:00:00Z");
    bindingIds.push(added);
    await activate("provenance-binding",added);
   }
   const before=await run();assert.equal(before.is_current,true);assert.equal(before.latest_completed!.counts.eligible_roots,591);
   const sealedRevision=before.input_revision;
   // Wait only for the declared database boundary; do not update policies to mimic time passing.
   await database.query("SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)",[boundary]);
   const expired=await load();assert.equal(expired.input_revision,sealedRevision);assert.equal(expired.is_current,false);assert.equal(expired.latest_completed!.id,before.latest_completed!.id);
   await store.scheduleSignalWorkspaceCorpusPreparationV1({database});
   const scheduled=await load();assert.equal(scheduled.active_run!.status,"queued");
   const after=await run();assert.equal(after.is_current,true);assert.equal(after.latest_completed!.counts.eligible_roots,0);assert.equal(after.latest_completed!.counts.rights_blocked_roots,591);
   await retireBindings();await run();
  }
 }finally{
  await retireBindings();
  await database.query("UPDATE signal_retention_policies SET status='retired',effective_to=clock_timestamp() WHERE id=ANY($1::uuid[]) AND status='active'",[policyIds]);
  await database.query(`UPDATE signal_corpus_preparation_runs SET status='failed',error_code='corpus_preparation_worker_failed',execution_token=NULL,execution_expires_at=NULL
    WHERE workspace_id=$1::uuid AND status IN('queued','running')`,[workspace_id]);
  await run();await database.end();
 }
});
