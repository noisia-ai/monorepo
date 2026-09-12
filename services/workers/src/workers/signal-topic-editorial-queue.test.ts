import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSignalTopicEditorialScreeningPlanV1, buildSignalTopicEditorialGlobalReviewV1, signalTopicEditorialDigestV1 as digest,
  validateSignalTopicEditorialScreeningCoverageV1, type SignalTopicEditorialRunnerStateV1,
  validateSignalTopicEditorialRepairRequestV1, type SignalTopicEditorialScreeningGroupV1 } from "@noisia/query-engine";
import type { SignalTopicEditorialLeaseV1 } from "@noisia/db";
import { drainSignalTopicEditorialOutboxV1, signalTopicEditorialJobV1, startSignalTopicEditorialOutboxDrainerV1,
  type SignalTopicEditorialControlStoresV1, type SignalTopicEditorialRuntimeStoresV1 } from "./signal-topic-editorial-queue";
import type { SignalTopicEditorialRecoveredCallV1 } from "./signal-topic-editorial-ledger";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha = (body: string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
function input() {
  const context = { brand_name:"Synthetic fixture",default_locale:"es-MX",summary:"Rutinas del hogar",audiences:["hogares"],categories:["asistentes"],
    competitors:[],positive_anchors:["rutinas"],negative_anchors:[],abstention_anchors:[] };
  const text="La rutina enciende la luz del hogar.", root_id=id(1), chunk_sha256=sha(text);
  const evidence=[{ref_id:digest({root_id,chunk_index:0,start:0,end:text.length,chunk_sha256}),root_id,chunk_index:0,start:0,end:text.length,
    chunk_sha256,text,locale:"es-MX",platform:"reddit",occurred_at:"2026-09-12T00:00:00.000Z"}];
  const fields={scope_counts:{brand:1,competitor:0,category:0,unknown:0},locale_counts:[{key:"es-MX",count:1}],platform_counts:[{key:"reddit",count:1}],
    month_counts:[{key:"2026-09",count:1}],brand_affinity:{positive:[],negative:[],abstention:[]},neighbors:[],metrics:{cohesion:null,outlier_ratio:null}};
  const dossier={contract_version:"signal-topic-group-dossier-v1",...fields,evidence:evidence.map(({text:_text,...row})=>row)};
  const group:SignalTopicEditorialScreeningGroupV1={group_key:"open:cluster-1",lane:"open",group_digest:digest("group"),source_dossier_digest:digest(dossier),dossier_digest:digest(dossier),
    community_key:"community-1",root_count:1,chunk_count:1,terms:["rutina"],...fields,evidence};
  return {groups:[group],plan:buildSignalTopicEditorialScreeningPlanV1({expected_group_count:1,source_context_digest:digest("sealed-source"),
    editorial_context_digest:digest(context),context,groups:[group]})};
}
function fixture() {
  const prepared=input();let state:SignalTopicEditorialRunnerStateV1|null=null,completed=false,failures=0,lastFailure:string|null=null,sends=0,reserves=0,marks=0,globalBinds=0;
  let settlementFailure=false,transportFailure=false,denyCap=false;
  let invalidPhase:"screening"|"global"|null=null,invalidRepair=false;
  const repairs=new Map<string,string>();
  const calls=new Map<string,SignalTopicEditorialRecoveredCallV1>();
  const requests=new Map(prepared.plan.batches.map(row=>[row.request_digest,row.request_body]));
  const lease:SignalTopicEditorialLeaseV1={execution_id:id(2),execution_token:id(3),workspace_id:id(4),actor_user_id:id(5),numeric_run_id:id(6),source_execution_id:id(7),worker_job_id:`topic-editorial-${id(2)}-1`};
  const byId=(callId:string)=>[...calls.values()].find(call=>call.call_id===callId)!;
  let materialized=false,materializations=0;
  const controls:SignalTopicEditorialControlStoresV1={recover:async()=>0,claimDispatch:async()=>[],acknowledgeDispatch:async()=>true,failDispatch:async()=>true,
    claimExecution:async()=>completed?{completed:true,execution_id:lease.execution_id}:lease,heartbeat:async()=>true,finish:async()=>{completed=true;return true;},
    materialize:async({execution_id,worker_job_id})=>{assert.equal(execution_id,lease.execution_id);assert.equal(worker_job_id,lease.worker_job_id);
      assert.equal(completed,true);assert.equal(state?.phase,'completed');const replayed=materialized;materialized=true;materializations++;
      return{contract_version:'signal-topic-editorial-materialization-v1',execution_id,revision_id:id(500),revision:1,status:'completed',concept_count:1,
        decision_count:1,topic_count:1,narrative_count:0,noise_count:0,unresolved_count:0,target_range_met:false,activation:'not_activated',replayed};},
    failExecution:async({error_code})=>{failures++;lastFailure=error_code;return true;}};
  const runtime:SignalTopicEditorialRuntimeStoresV1={loadInput:async()=>structuredClone(prepared),bindRepair:async({request})=>{
      const proof=validateSignalTopicEditorialRepairRequestV1(request),parent=calls.get(proof.original.request_digest);
      assert.equal(parent?.status,"settled","parent settled");assert.equal(parent.request_body,proof.original.request_body,"parent request body");
      const originalOutput=JSON.parse(JSON.parse(parent.response!.body).content[0].text);
      assert.equal(digest(originalOutput),request.repair!.parent_response_digest,"parent output digest");
      assert.equal(repairs.get(parent.request_digest)??request.request_digest,request.request_digest);
      repairs.set(parent.request_digest,request.request_digest);requests.set(request.request_digest,request.request_body);return request;
    },runnerStore:()=>({load:async()=>state,
    save:async next=>{assert.equal(next.expected_state_digest,state?.state_digest??null);state=structuredClone(next.state);}}),
    bindGlobal:async()=>{globalBinds++;const review=buildSignalTopicEditorialGlobalReviewV1({plan:prepared.plan,groups:prepared.groups,
      screening:validateSignalTopicEditorialScreeningCoverageV1(prepared.plan,state!.screening_outputs)});requests.set(review.request_digest,review.request_body);return review;},
    storeRawReceipt:async({receipt,call_id})=>`workspace-engine/${lease.workspace_id}/${lease.execution_id}/${call_id}/${receipt.sha256}`,
    ledger:{readRecovery:async({request_digest})=>calls.get(request_digest)??null,
      reserve:async({request_digest,provider_available})=>{assert.equal(provider_available,true);reserves++;if(denyCap)throw Error("topic_editorial_cap_exhausted");
        let call=calls.get(request_digest);if(!call){call={call_id:id(100+calls.size),attempt_token:id(200+calls.size),request_digest,request_body:requests.get(request_digest)!,
          status:"reserved",reserved_micro_usd:"1000000",settled_micro_usd:null,response:null};calls.set(request_digest,call);}return call;},
      markSent:async({call_id})=>{marks++;const call=byId(call_id);assert.equal(call.status,"reserved");call.status="in_flight";return true;},
      persistReceipt:async({call_id,receipt,storage_key})=>{const call=byId(call_id);call.status="response_persisted";
        call.response={body:new TextDecoder().decode(receipt.bytes),sha256:receipt.sha256,storage_key,http_status:receipt.http_status,complete:receipt.complete,provider_request_id:receipt.provider_request_id};},
      settle:async({call_id})=>{if(settlementFailure){settlementFailure=false;throw Error("settlement connection lost");}
        const call=byId(call_id);call.status="settled";call.settled_micro_usd="600";return{status:"settled",settled_micro_usd:"600",replayed:false};},
      failCall:async({call_id,definitely_not_sent})=>{const call=byId(call_id);if(call.status==="in_flight")call.status="outcome_unknown";
        if(call.status==="reserved"&&definitely_not_sent)call.status="definitely_not_sent";return call.status;}}};
  const fetcher:typeof fetch=async(_url,init)=>{sends++;if(transportFailure)throw Error("private transport details");
    const payload=JSON.parse(JSON.parse(String(init?.body)).messages[0].content) as {contract_version:string;original_message:string};
    const isRepair=payload.contract_version==="signal-topic-editorial-repair-request-v1";
    const request=isRepair?JSON.parse(payload.original_message) as {contract_version:string}:payload;
    const output=request.contract_version==="signal-topic-editorial-screening-request-v1"
      ?{contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[{group_key:prepared.groups[0]!.group_key,disposition:"topic",
        candidate:{candidate_key:"b0000-routine",label:"Rutinas del hogar",definition:"Rutinas de iluminación del hogar.",locale:"es-MX"},confidence:0.9,rationale:null,cited_ref_ids:[prepared.groups[0]!.evidence[0]!.ref_id]}]}
      :{contract_version:"signal-topic-editorial-global-result-v1",concepts:[{concept_key:"topic-routines",kind:"topic",label:"Rutinas del hogar",definition:"Rutinas de iluminación del hogar.",locale:"es-MX",
        priority_rank:1,priority_rationale:"Rutina observada en evidencia.",member_group_keys:[prepared.groups[0]!.group_key]}],noise_group_keys:[] as string[],unresolved_group_keys:[]};
    if((!isRepair||invalidRepair)&&invalidPhase==="screening"&&output.decisions)output.decisions[0]!.cited_ref_ids=[digest("unknown citation")];
    if((!isRepair||invalidRepair)&&invalidPhase==="global"&&output.concepts)output.noise_group_keys=[prepared.groups[0]!.group_key];
    return Response.json({type:"message",role:"assistant",model:"claude-sonnet-4-6",stop_reason:"end_turn",content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:100,output_tokens:20}});};
  const job={id:lease.worker_job_id,data:{execution_id:lease.execution_id},updateProgress:async()=>{}};
  const options={enabled:true,database:{} as never,controls,runtime,provider_enabled:true,api_key:"unit_test_key_123456789",fetch_impl:fetcher};
  return {lease,job,options,controls,runtime,calls,prepared,repairs,get state(){return state;},get stats(){return{sends,reserves,marks,globalBinds,failures,lastFailure,materializations};},
    invalidate:(phase:"screening"|"global",repairToo=false)=>{invalidPhase=phase;invalidRepair=repairToo;},
    loseSettlement:()=>{settlementFailure=true;},loseTransport:()=>{transportFailure=true;},denyCap:()=>{denyCap=true;}};
}
test("editorial job and drainer are disabled before accessing DB, Redis, credentials or provider",async()=>{
 const result=await drainSignalTopicEditorialOutboxV1();assert.equal(result.disabled,true);assert.equal(result.claimed,0);
 assert.deepEqual(await signalTopicEditorialJobV1({id:undefined,data:{execution_id:""},updateProgress:async()=>{}}),{disabled:true,provider_execution_enabled:false});
 const drainer=startSignalTopicEditorialOutboxDrainerV1();await drainer.drainNow();await drainer.close();
});
test("environment flags wire the runtime factory and require independent provider flag and key before sends",async()=>{
 const off=fixture();let factories=0;
 const disabledOptions={...off.options,enabled:undefined,provider_enabled:undefined,api_key:undefined,runtime:undefined,
  runtime_factory:()=>{factories++;return off.runtime;},env:{NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED:"true",get ANTHROPIC_API_KEY():string{throw Error("lane off");}}};
 assert.equal((await signalTopicEditorialJobV1(off.job,disabledOptions)).disabled,true);assert.equal(factories,0);assert.equal(off.stats.sends,0);
 for(const mode of ["provider_off","key_missing","enabled"]){
  const f=fixture();let built=0;
  const options={...f.options,enabled:undefined,provider_enabled:undefined,api_key:undefined,runtime:undefined,
   runtime_factory:()=>{built++;return f.runtime;},env:{NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:"true",
    NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED:mode==="provider_off"?"false":"true",
    ANTHROPIC_API_KEY:mode==="key_missing"?"":"unit_test_key_123456789"}};
  if(mode==="enabled")assert.equal((await signalTopicEditorialJobV1(f.job,options)).status,"completed");
  else await assert.rejects(signalTopicEditorialJobV1(f.job,options),/provider_disabled|provider_configuration_invalid/);
  assert.equal(built,1);assert.equal(f.stats.sends,mode==="enabled"?2:0);assert.equal(f.stats.reserves,mode==="enabled"?2:0);
 }
});
test("outbox environment flag gates control-store and queue access independently of provider enablement",async()=>{
 const f=fixture();let recovered=0,claims=0;
 f.controls.recover=async()=>{recovered++;return 0;};f.controls.claimDispatch=async()=>{claims++;return[];};
 const options={database:{} as never,queue:{} as never,stores:f.controls,env:{NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:"false",NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED:"true"}};
 assert.equal((await drainSignalTopicEditorialOutboxV1(options)).disabled,true);assert.equal(recovered,0);
 assert.equal((await drainSignalTopicEditorialOutboxV1({...options,env:{NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:"true"}})).disabled,false);
 assert.equal(recovered,1);assert.equal(claims,1);
});
test("real runner composes sealed screening/global, settles each once, and completed delivery replay sends nothing",async()=>{
 const f=fixture();assert.equal((await signalTopicEditorialJobV1(f.job,f.options)).status,"completed");
 assert.equal(f.calls.size,2);assert.equal(f.stats.sends,2);assert.equal(f.stats.reserves,2);assert.equal(f.stats.globalBinds,1);
 assert.ok([...f.calls.values()].every(call=>call.status==="settled"&&call.settled_micro_usd==="600"));
 await signalTopicEditorialJobV1(f.job,f.options);assert.equal(f.stats.sends,2);assert.equal(f.stats.reserves,2);
});
test("provider-disabled and exhausted cap stop before markSent or transport",async()=>{
 const off=fixture();await assert.rejects(signalTopicEditorialJobV1(off.job,{...off.options,provider_enabled:false,api_key:""}),/provider_disabled/u);
 assert.equal(off.stats.reserves,0);assert.equal(off.stats.sends,0);assert.equal(off.stats.marks,0);
 assert.equal(off.stats.lastFailure,"topic_editorial_anthropic_provider_disabled");
 const cap=fixture();cap.denyCap();await assert.rejects(signalTopicEditorialJobV1(cap.job,cap.options),/topic_editorial_cap_exhausted/u);
 assert.equal(cap.calls.size,0);assert.equal(cap.stats.sends,0);assert.equal(cap.stats.marks,0);
});
test("response persisted before a crash is settled/checkpointed with provider disabled; future global send remains gated",async()=>{
 const f=fixture();f.loseSettlement();await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/completion_persistence_unknown/u);
 assert.equal(f.stats.sends,1);assert.equal([...f.calls.values()][0]!.status,"response_persisted");
 await assert.rejects(signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false,api_key:""}),/provider_disabled/u);
 assert.equal(f.stats.sends,1);assert.equal(f.state?.screening_outputs.length,1);assert.equal([...f.calls.values()][0]!.status,"settled");
 await signalTopicEditorialJobV1(f.job,f.options);assert.equal(f.stats.sends,2);assert.equal(f.calls.size,2);
});
test("ambiguous transport is retained and repeated delivery cannot create another paid call",async()=>{
 const f=fixture();f.loseTransport();await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/transport_outcome_unknown/u);
 assert.equal([...f.calls.values()][0]!.status,"outcome_unknown");
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/ledger_read_unknown/u);
 assert.equal(f.stats.sends,1);assert.equal(f.stats.reserves,1);assert.equal(f.calls.size,1);
});
test("screening and global semantic repair preserve paid originals and recover a crash before checkpoint without another send",async()=>{
 for(const phase of ["screening","global"] as const){
  const f=fixture();f.invalidate(phase);let crash=true;
  const bindRepair=f.runtime.bindRepair;let bindingError:unknown=null;
  f.runtime.bindRepair=async args=>{try{return await bindRepair(args);}catch(error){bindingError=error;throw error;}};
  const runner=f.runtime.runnerStore;
  f.runtime.runnerStore=args=>{const store=runner(args);return{load:store.load,save:async input=>{
    if(crash&&f.repairs.size===1&&(phase==="screening"?input.state.screening_outputs.length===1:input.state.phase==="completed")){
      crash=false;throw Error("checkpoint connection lost");
    }await store.save(input);
  }};};
  await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/worker_failed/u);
  assert.equal(f.repairs.size,1,String(bindingError));
  const original=[...f.repairs.keys()][0]!,child=f.repairs.get(original)!;
  const beforeOriginal=structuredClone(f.calls.get(original));
  assert.equal(f.calls.get(original)!.status,"settled");assert.equal(f.calls.get(child)!.status,"settled");
  assert.equal(f.calls.get(original)!.settled_micro_usd,"600");assert.equal(f.calls.get(child)!.settled_micro_usd,"600");
  if(phase==="screening")await assert.rejects(signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false}),/provider_disabled/u);
  else assert.equal((await signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false})).status,"completed");
  await signalTopicEditorialJobV1(f.job,f.options);
  assert.equal(f.stats.sends,3);assert.equal(f.stats.reserves,3);assert.equal(f.repairs.size,1);assert.equal(f.calls.size,3);
  assert.deepEqual(f.calls.get(original),beforeOriginal);
 }
});
test("durable repair binding survives crash before reserve; replay creates the child call once",async()=>{
 const f=fixture();f.invalidate("screening");const bind=f.runtime.bindRepair;let crash=true;
 f.runtime.bindRepair=async args=>{const bound=await bind(args);if(crash){crash=false;throw Error("ACK lost after bind");}return bound;};
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/worker_failed/u);
 assert.equal(f.stats.sends,1);assert.equal(f.repairs.size,1);assert.equal(f.calls.size,1);
 const child=[...f.repairs.values()][0];await signalTopicEditorialJobV1(f.job,f.options);
 assert.equal([...f.repairs.values()][0],child);assert.equal(f.stats.sends,3);assert.equal(f.stats.reserves,3);
});
test("a semantically invalid repair remains paid and fail-closed on replay with no second repair",async()=>{
 for(const phase of ["screening","global"] as const){
  const f=fixture();f.invalidate(phase,true);
  await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/topic_editorial_repair_invalid/u);
  const before=structuredClone([...f.calls]);const sends=f.stats.sends;
  await assert.rejects(signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false}),/topic_editorial_repair_invalid/u);
  assert.equal(f.stats.sends,sends);assert.equal(f.repairs.size,1);assert.deepEqual([...f.calls],before);
 }
});
test("an exhausted repair call cannot use the generic definitely-not-sent retry path",async()=>{
 const f=fixture();f.invalidate("screening");const bind=f.runtime.bindRepair;
 f.runtime.bindRepair=async args=>{const child=await bind(args);
  f.calls.set(child.request_digest,{call_id:id(900),attempt_token:id(901),request_digest:child.request_digest,request_body:child.request_body,
    status:"definitely_not_sent",reserved_micro_usd:"1000000",settled_micro_usd:null,response:null});return child;};
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/ledger_read_unknown/u);
 assert.equal(f.stats.sends,1);assert.equal(f.stats.reserves,1);assert.equal(f.repairs.size,1);
});
test("provider-disabled or cap exhausted before repair keeps the paid original and sends no child",async()=>{
 for(const mode of ["disabled","cap"]){
  const f=fixture();f.invalidate("screening");const bind=f.runtime.bindRepair;let stop=true;
  f.runtime.bindRepair=async args=>{const result=await bind(args);if(stop){stop=false;throw Error("pause before repair");}return result;};
  await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/worker_failed/u);
  if(mode==="cap")f.denyCap();
  await assert.rejects(signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:mode!=="disabled"}),/provider_disabled|cap_exhausted/u);
  assert.equal(f.stats.sends,1);assert.equal(f.calls.size,1);assert.equal([...f.calls.values()][0]!.status,"settled");
 }
});
test("mismatched lease scope stops before loading evidence or provider",async()=>{
 const f=fixture();f.controls.claimExecution=async()=>({...f.lease,execution_id:id(999)});
 f.runtime.loadInput=async()=>assert.fail("must not read another owner");
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/lease_scope_invalid/u);assert.equal(f.stats.sends,0);
});
test("one heartbeat remains pending and loss of lease blocks the next provider send",async()=>{
 const f=fixture();let releaseInput!:()=>void,releaseHeartbeat!:(value:boolean)=>void,heartbeats=0;
 const inputWait=new Promise<void>(resolve=>{releaseInput=resolve;});
 f.runtime.loadInput=async()=>{await inputWait;return f.prepared;};
 f.controls.heartbeat=async()=>{heartbeats++;return new Promise<boolean>(resolve=>{releaseHeartbeat=resolve;});};
 const promise=signalTopicEditorialJobV1(f.job,{...f.options,heartbeat_ms:5});
 await sleep(35);assert.equal(heartbeats,1);releaseHeartbeat(false);await sleep(1);releaseInput();
 await assert.rejects(promise,/lease_lost/u);assert.equal(f.stats.sends,0);
});
test("lease loss during transport preserves the paid receipt and settlement without checkpointing or sending the next request",async()=>{
 const f=fixture();let started!:()=>void,release!:()=>void;
 const sending=new Promise<void>(resolve=>{started=resolve;}),responseWait=new Promise<void>(resolve=>{release=resolve;});
 const fetcher:typeof fetch=async(url,init)=>{started();await responseWait;return f.options.fetch_impl(url,init);};
 f.controls.heartbeat=async()=>false;
 const running=signalTopicEditorialJobV1(f.job,{...f.options,fetch_impl:fetcher,heartbeat_ms:5});
 await sending;await sleep(15);release();await assert.rejects(running,/lease_lost/u);
 assert.equal(f.stats.sends,1);assert.equal([...f.calls.values()][0]!.status,"settled");assert.equal(f.state?.screening_outputs.length,0);
 f.controls.heartbeat=async()=>true;
 await assert.rejects(signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false,api_key:""}),/provider_disabled/u);
 assert.equal(f.stats.sends,1);assert.equal(f.stats.reserves,1);assert.equal(f.state?.screening_outputs.length,1);
});
test("recovery rejects changed request bytes and incomplete or mismatched raw receipts before another reservation",async()=>{
 for(const change of ["request","sha","incomplete","http"]){
  const f=fixture();f.loseSettlement();await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/completion_persistence_unknown/u);
  const call=[...f.calls.values()][0]!;
  if(change==="request")call.request_body+=" ";
  if(change==="sha")call.response!.sha256=digest("different bytes");
  if(change==="incomplete")call.response!.complete=false;
  if(change==="http")call.response!.http_status=700;
  await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/ledger_read_unknown/u);
  assert.equal(f.stats.sends,1);assert.equal(f.stats.reserves,1);assert.equal(f.state?.screening_outputs.length,0);
 }
});
test("every short ledger operation finishes before transport begins",async()=>{
 const f=fixture();let active=0;
 const original=f.runtime.ledger;
 f.runtime.ledger=Object.fromEntries(Object.entries(original).map(([name,operation])=>[name,async(arg:never)=>{
  active++;try{return await operation(arg);}finally{active--;}
 }])) as typeof original;
 const fetcher:typeof fetch=async(url,init)=>{assert.equal(active,0);return f.options.fetch_impl(url,init);};
 await signalTopicEditorialJobV1(f.job,{...f.options,fetch_impl:fetcher});assert.equal(active,0);assert.equal(f.stats.sends,2);
});
test("ACK lost after enqueue redelivers the same durable job without a second queue add",async()=>{
 const f=fixture(),dispatch={dispatch_id:id(9),execution_id:f.lease.execution_id,workspace_id:f.lease.workspace_id,worker_job_id:f.lease.worker_job_id,lease_token:id(10),attempt:1};
 let present=false,adds=0,acks=0,retries=0;f.controls.claimDispatch=async()=>[dispatch];
 f.controls.acknowledgeDispatch=async()=>++acks>1;
 const queue={getJob:async()=>present?{getState:async()=>"failed",retry:async()=>{retries++;}}:null,
  add:async(_name:string,data:{execution_id:string},options:Record<string,unknown>)=>{adds++;present=true;assert.equal(options.jobId,dispatch.worker_job_id);assert.equal(options.attempts,5);
    assert.deepEqual(options.backoff,{type:"exponential",delay:5_000});assert.deepEqual(data,{execution_id:dispatch.execution_id});}};
 const options={enabled:true,database:{} as never,queue,stores:f.controls};
 assert.equal((await drainSignalTopicEditorialOutboxV1(options)).failed,1);
 assert.equal((await drainSignalTopicEditorialOutboxV1(options)).recovered,1);assert.equal(adds,1);assert.equal(retries,1);
});
test("transient drainer timeout is contained and close waits for its one outstanding pass",async()=>{
 const f=fixture();let calls=0,release!:()=>void;
 f.controls.recover=async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});throw Error("connection timeout");};
 const drainer=startSignalTopicEditorialOutboxDrainerV1({enabled:true,database:{} as never,queue:{} as never,stores:f.controls,run_immediately:false,interval_ms:10000});
 const first=drainer.drainNow(),second=drainer.drainNow();assert.equal(first,second);assert.equal(calls,1);
 let closed=false;const close=drainer.close().then(()=>{closed=true;});await sleep(1);assert.equal(closed,false);release();await close;assert.equal(calls,1);
});

test("crash after editorial finish retries materialization without provider, runtime or another paid call",async()=>{
 const f=fixture(),materialize=f.controls.materialize;let crash=true;
 f.controls.materialize=async args=>{if(crash){crash=false;throw Error('private database connection details');}return materialize(args);};
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/^Error: topic_editorial_worker_failed$/u);
 assert.equal(f.state?.phase,'completed');assert.equal(f.stats.failures,0);assert.equal(f.stats.sends,2);
 const result=await signalTopicEditorialJobV1(f.job,{...f.options,runtime:undefined,runtime_factory:()=>{throw Error('must not construct runtime');},
  api_key:undefined,provider_enabled:undefined,env:{NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:'true',NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED:'true',get ANTHROPIC_API_KEY():string{throw Error('must not read provider key');}}});
 assert.equal(result.status,'completed');assert.equal(result.activation,'not_activated');assert.equal(f.stats.sends,2);assert.equal(f.stats.reserves,2);
});
test("lost materialization commit acknowledgement replays the same revision and does not fail the terminal owner",async()=>{
 const f=fixture(),materialize=f.controls.materialize;let crash=true;
 f.controls.materialize=async args=>{const result=await materialize(args);if(crash){crash=false;throw Error('topic_editorial_materialization_ack_unknown');}return result;};
 await assert.rejects(signalTopicEditorialJobV1(f.job,f.options),/materialization_ack_unknown/u);
 assert.equal(f.stats.failures,0);const calls=structuredClone([...f.calls]);
 const result=await signalTopicEditorialJobV1(f.job,{...f.options,provider_enabled:false,api_key:''});
 assert.equal(result.revision_id,id(500));assert.equal(result.replayed,true);assert.equal(result.activation,'not_activated');
 assert.equal(f.stats.materializations,2);assert.deepEqual([...f.calls],calls);assert.equal(f.stats.sends,2);
});
