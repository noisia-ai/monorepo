import assert from'node:assert/strict';
import{randomUUID,createHash}from'node:crypto';
import{setTimeout as delay}from'node:timers/promises';
import type{StudyRuntimeLeaseV1,StudyRuntimeStepPlanV1}from'../../../services/workers/src/workers/signal-study-runtime';
import{signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import{saveSignalStudyConfigurationV1}from'../signal-study-configuration';
import{readSignalStudyOutputV1}from'../signal-study-serving';
import type{SignalStudySyntheticFixtureV1}from'./signal-study.synthetic.fixture';
import type{StudyNativeRuntimeFixtureV1}from'./signal-study-runtime.synthetic.fixture';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** These are faults around REAL native commits, not substitute stores/guards.
 * A lost acknowledgement throws only after the native method has committed. */
export async function assertSignalStudyMoneyV1(f:SignalStudySyntheticFixtureV1,r:StudyNativeRuntimeFixtureV1){
 async function capture(){const owner=await f.createStudy(),execution=await owner.request(),original=r.store.plan;let plan:StudyRuntimeStepPlanV1|undefined;
  r.store.plan=async(_lease,next)=>{plan=next;throw Error('pause before native admission');};try{await assert.rejects(r.run(execution.id),/pause before native admission/);}finally{r.store.plan=original;}
  assert.ok(plan);const lease=await r.store.claim(execution.id);assert.ok(lease);return{...owner,execution,plan,lease};
 }
 async function state(execution_id:string){return(await f.database.query('SELECT * FROM signal_study_executions WHERE id=$1',[execution_id])).rows[0];}
 async function steps(execution_id:string){return(await f.database.query(`SELECT s.id,s.status,s.request_sha256,c.call_state,c.settled_micro_usd,c.reserved_micro_usd,c.id call_id FROM signal_study_steps s LEFT JOIN engine_cost_events c ON c.study_step_id=s.id WHERE s.execution_id=$1 ORDER BY s.created_at,s.id`,[execution_id])).rows;}
 for(const fault of ['persistReceipt','settle','commit']as const){
  const owner=await f.createStudy(),execution=await owner.request(),before=r.metrics();let once=true;
  const original=r.store[fault];
  if(fault==='persistReceipt'){const fn=r.store.persistReceipt;r.store.persistReceipt=async(...args)=>{await fn(...args);if(once){once=false;throw Error('lost native paid ACK');}};}
  else if(fault==='settle'){const fn=r.store.settle;r.store.settle=async(...args)=>{const value=await fn(...args);if(once){once=false;throw Error('lost native paid ACK');}return value;};}
  else{const fn=r.store.commit;r.store.commit=async(...args)=>{const value=await fn(...args);if(once){once=false;throw Error('lost native paid ACK');}return value;};}
  try{await assert.rejects(r.run(execution.id),/lost native paid ACK/);}finally{Object.assign(r.store,{[fault]:original});}
  const paid=await steps(execution.id);assert.equal(paid.length,1);assert.ok(['raw','committed'].includes(paid[0].status));
  assert.equal((await r.run(execution.id)).status,'completed');assert.equal(r.metrics().fitCalls-before.fitCalls,1,'a native numeric intent survives all paid-step ACK losses');assert.equal(r.metrics().jevCalls,before.jevCalls,'existing question identity cache remains authoritative');
  const rows=await steps(execution.id);assert.equal(rows.length,r.metrics().sonnetCalls-before.sonnetCalls);assert.ok(rows.every(row=>row.call_state==='settled'&&BigInt(row.settled_micro_usd)>0n));assert.equal(new Set(rows.map(row=>row.call_id)).size,rows.length);
 }
 // Read/mark/reserve scope and races against real leases and native admissions.
 const scoped=await capture(),count=r.metrics().sonnetCalls;
 const invalid:StudyRuntimeLeaseV1[]=[{...scoped.lease,workspace_id:randomUUID()},{...scoped.lease,execution_token:randomUUID()},{...scoped.lease,human_revision_digest:digest('foreign human')}];
 for(const lease of invalid)await assert.rejects(r.store.plan(lease,scoped.plan),/study_(execution_unavailable|lease_lost)/);
 const opus=JSON.stringify({...JSON.parse(scoped.plan.request_body),model:'claude-opus-4-6'});await assert.rejects(r.store.plan(scoped.lease,{...scoped.plan,request_body:opus,request_sha256:sha(opus)}),/study_step_not_next/);
 assert.equal((await steps(scoped.execution.id)).length,0);assert.equal(r.metrics().sonnetCalls,count);
 const planned=await Promise.all([r.store.plan(scoped.lease,scoped.plan),r.store.plan(scoped.lease,scoped.plan)]);assert.ok(planned.every(Boolean));assert.equal((await steps(scoped.execution.id)).length,1,'two transactions admit exactly one native physical step');
 await f.database.query("UPDATE users SET status='suspended' WHERE id=$1",[f.actor_user_id]);
 try{await assert.rejects(r.store.markSent(scoped.lease,scoped.plan),/study_forbidden/);assert.equal(r.metrics().sonnetCalls,count);assert.equal((await steps(scoped.execution.id))[0].call_state,'reserved');}finally{await f.database.query("UPDATE users SET status='active' WHERE id=$1",[f.actor_user_id]);}
 const marked=await Promise.all([r.store.markSent(scoped.lease,scoped.plan),r.store.markSent(scoped.lease,scoped.plan)]);assert.deepEqual([...marked].sort(),['sent','stale']);
 const receipt=await r.drivers.send(scoped.plan,new AbortController().signal);await r.store.persistReceipt(scoped.lease,scoped.plan,receipt);assert.equal(await r.store.settle(scoped.lease,scoped.plan),'settled');
 const value=JSON.parse(Buffer.from(receipt.body_base64,'base64').toString('utf8'));assert.equal(await r.store.commit(scoped.lease,scoped.plan,value,digest(value)),true);await r.store.release(scoped.lease);assert.equal((await r.run(scoped.execution.id)).status,'completed');
 // Losing a markSent ACK is ambiguous even if this test never entered fetch.
 const ambiguous=await capture(),mark=r.store.markSent;let lost=true;r.store.markSent=async(...args)=>{const result=await mark(...args);if(lost){lost=false;throw Error('lost send-boundary ACK');}return result;};await r.store.release(ambiguous.lease);
 const beforeUnknown=r.metrics().sonnetCalls;try{await assert.rejects(r.run(ambiguous.execution.id),/lost send-boundary ACK/);}finally{r.store.markSent=mark;}
 assert.equal((await r.run(ambiguous.execution.id)).status,'not_claimed');assert.equal(r.metrics().sonnetCalls,beforeUnknown);const unknown=(await steps(ambiguous.execution.id))[0];assert.equal(unknown.call_state,'outcome_unknown');assert.equal(unknown.settled_micro_usd,null);assert.ok(BigInt(unknown.reserved_micro_usd)>0n);await assert.rejects(ambiguous.request(),/study_already_active/);
 // Incomplete bytes and overload remain durable, charged uncertainty; no reset.
 for(const mode of ['incomplete','http529','invalid_usage','invalid_utf8']as const){const owner=await f.createStudy(),execution=await owner.request(),before=r.metrics().sonnetCalls;r.setSonnetMode(mode);
  try{const result=await r.run(execution.id);assert.equal(result.status,'outcome_unknown');assert.equal(r.metrics().sonnetCalls,before+1);const rows=await steps(execution.id);assert.equal(rows[0].call_state,'outcome_unknown');assert.equal(rows[0].settled_micro_usd,null);assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_study_receipts WHERE execution_id=$1 AND verification_status=\'verified\'',[execution.id])).rows[0].n),1);
   assert.equal((await r.run(execution.id)).status,'not_claimed');assert.equal(r.metrics().sonnetCalls,before+1);assert.equal(await readSignalStudyOutputV1({...f,execution_id:execution.id}),null);
  }finally{r.setSonnetMode('normal');}}
 // A receipt observed after the lease expires remains reconciled without resend.
 const expiredOwner=await f.createStudy(),expired=await expiredOwner.request(),beforeLease=r.metrics();let expire=true;
 r.onSonnet(async()=>{if(expire){expire=false;await f.database.query("UPDATE signal_study_executions SET execution_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[expired.id]);await delay(1100);}});
 try{await r.run(expired.id).catch(error=>{assert.match(error.message,/study_lease_lost/);});}finally{r.onSonnet(undefined);}
 assert.equal((await steps(expired.id))[0].call_state,'response_persisted');const observedBefore=r.metrics();r.setAnalysisEnabled(false);assert.equal((await r.run(expired.id)).status,'not_claimed');assert.equal((await steps(expired.id))[0].call_state,'settled','observed receipt bookkeeping survives lease loss and flag off');assert.equal(r.metrics().sonnetCalls,observedBefore.sonnetCalls);assert.equal(r.metrics().jevCalls,observedBefore.jevCalls);r.setAnalysisEnabled(true);assert.equal((await r.run(expired.id)).status,'completed');assert.equal(r.metrics().fitCalls-beforeLease.fitCalls,1);
 // Exact insufficient total cap: no admission, HTTP, successor or fake stop.
 const tinyOwner=await f.createStudy(),tiny=await tinyOwner.request(1),beforeTiny=r.metrics().sonnetCalls;await r.run(tiny.id);assert.equal((await state(tiny.id)).status,'budget_exhausted');assert.equal((await steps(tiny.id)).length,0);assert.equal(r.metrics().sonnetCalls,beforeTiny);
 // Human revision wins atomically; a known unsent reservation is released by
 // bookkeeping, not converted into an ambiguous or zero-usage provider receipt.
 const human=await capture();await r.store.plan(human.lease,human.plan);const next=structuredClone(f.envelope);next.study.revision=2;next.study_digest=digest(next.study);next.question_configuration.revision=2;next.question_configuration.study_digest=next.study_digest;next.question_configuration.instructions+=' Human boundary.';next.question_configuration.human_locked=true;next.question_configuration_digest=digest(next.question_configuration);
 await saveSignalStudyConfigurationV1({...f,study_id:human.configuration.study_id,expected_revision:1,configuration:next,listening_snapshot_id:f.listeningSnapshot.id,provenance:'human'});
 await assert.rejects(r.store.markSent(human.lease,human.plan),/study_source_changed/);assert.equal((await r.run(human.execution.id)).status,'not_claimed');assert.equal((await steps(human.execution.id))[0].call_state,'definitely_not_sent');assert.equal(await readSignalStudyOutputV1({...f,execution_id:human.execution.id}),null);
 // The organization/day ledger counts Study reservations alongside every
 // pre-existing owner. Two independent parents may not each spend its last slot.
 const active=(await f.database.query("SELECT * FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'",[f.policy.organization_id])).rows[0];
 const total=async()=>BigInt((await f.database.query(`SELECT total_micro_usd::text v FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)`,[active.organization_id,active.budget_timezone])).rows[0].v);
 const beforeGlobal=await total(),room=BigInt((Buffer.byteLength(scoped.plan.request_body)+4096)*6+32768*15+10000);
 const narrow=(await f.database.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
  SELECT organization_id,version+1,'draft',valid_from,valid_until,budget_timezone,$2,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING *`,[active.id,(beforeGlobal+room).toString()])).rows[0];
 await f.database.query('INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1',[active.id,narrow.id]);
 await f.database.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[active.id]);await f.database.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[narrow.id]);
 const siblings=[await capture(),await capture()],callsBefore=r.metrics().sonnetCalls;
 const raced=await Promise.allSettled(siblings.map(owner=>r.store.plan(owner.lease,owner.plan)));
 assert.equal(raced.filter(row=>row.status==='fulfilled'&&row.value).length,1,'one organization/day slot cannot fund two parents');
 const denial=raced.find(row=>row.status==='rejected');assert.ok(denial?.status==='rejected');assert.match(String(denial.reason),/daily|capacity|budget/);
 const winner=siblings[raced.findIndex(row=>row.status==='fulfilled')]!;
 const reservation=BigInt((await steps(winner.execution.id))[0].reserved_micro_usd);assert.equal(await total(),beforeGlobal+reservation,'the shared org ledger includes the new owner exactly once');assert.equal(r.metrics().sonnetCalls,callsBefore);
 assert.equal(await r.store.markSent(winner.lease,winner.plan),'sent');
 r.onSonnet(async()=>{await f.database.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[narrow.id]);});
 let observed:Awaited<ReturnType<typeof r.drivers.send>>;try{observed=await r.drivers.send(winner.plan,new AbortController().signal);}finally{r.onSonnet(undefined);}
 await r.store.persistReceipt(winner.lease,winner.plan,observed);assert.equal(await r.store.settle(winner.lease,winner.plan),'settled');
 const raw=JSON.parse(Buffer.from(observed.body_base64,'base64').toString('utf8'));
 await assert.rejects(r.store.commit(winner.lease,winner.plan,raw,digest(raw)),/study_policy_unavailable/);
 await r.store.release(winner.lease);assert.equal((await r.run(winner.execution.id)).status,'not_claimed');assert.equal((await state(winner.execution.id)).status,'stale');assert.equal((await steps(winner.execution.id))[0].call_state,'settled');assert.equal(await readSignalStudyOutputV1({...f,execution_id:winner.execution.id}),null);
 const admissions=Number((await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0].n),off=await f.createStudy();await assert.rejects(off.request(),/study_policy_unavailable/);assert.equal(Number((await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0].n),admissions);
 assert.ok(r.sentStepKeys().every((key,index,all)=>all.indexOf(key)===index),'no physical step repeats across ACK loss, lease loss or uncertainty');
}
