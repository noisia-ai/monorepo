import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  loadSignalTopicEditorialOwnerInputV1, createSignalTopicEditorialRunnerStoreV1,
  bindSignalTopicEditorialGlobalRequestV1, bindSignalTopicEditorialRepairRequestV1,
  readSignalTopicEditorialRecoveryV1, markSentSignalTopicEditorialCallV1,
  persistSignalTopicEditorialReceiptV1, settleSignalTopicEditorialCallV1, failSignalTopicEditorialCallV1,
  type SignalTopicEditorialLeaseV1,
} from "@noisia/db";
import { createSignalTopicEditorialRuntimeStoresV1, signalTopicEditorialRuntimeConfigurationV1 } from "./signal-topic-editorial-runtime";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha=(body:Uint8Array|string)=>`sha256:${createHash("sha256").update(body).digest("hex")}`;
const lease:SignalTopicEditorialLeaseV1={workspace_id:id(1),execution_id:id(2),execution_token:id(3),actor_user_id:id(4),numeric_run_id:id(5),source_execution_id:id(6),worker_job_id:"editorial-fixture"};
const receipt=()=>{const bytes=new TextEncoder().encode('{"private":"synthetic response"}');return {request_digest:sha("request"),idempotency_key:"fixture-call",bytes,sha256:sha(bytes),http_status:200,complete:true,provider_request_id:"request-fixture"};};

test("exact independent flags default off and never read credentials while disabled",()=>{
 const poison={get ANTHROPIC_API_KEY():string{throw Error("credentials must not be read");}};
 assert.deepEqual(signalTopicEditorialRuntimeConfigurationV1(poison),{enabled:false,provider_enabled:false,api_key:""});
 for(const value of [undefined,"false","1","TRUE"," true "])
  assert.equal(signalTopicEditorialRuntimeConfigurationV1({NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:value,get ANTHROPIC_API_KEY():string{throw Error("credentials must not be read");}}).enabled,false);
 assert.deepEqual(signalTopicEditorialRuntimeConfigurationV1({NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:"true",get ANTHROPIC_API_KEY():string{throw Error("provider off");}}),
  {enabled:true,provider_enabled:false,api_key:""});
 assert.deepEqual(signalTopicEditorialRuntimeConfigurationV1({NOISIA_SIGNAL_TOPIC_EDITORIAL_ENABLED:"true",NOISIA_SIGNAL_TOPIC_EDITORIAL_PROVIDER_ENABLED:"true",ANTHROPIC_API_KEY:"test_key"}),
  {enabled:true,provider_enabled:true,api_key:"test_key"});
});

test("default runtime composes the exact DB owner, repair, recovery and persistence exports without opening resources",()=>{
 const runtime=createSignalTopicEditorialRuntimeStoresV1({create_storage:()=>assert.fail("eager storage")});
 assert.equal(runtime.loadInput,loadSignalTopicEditorialOwnerInputV1);assert.equal(runtime.runnerStore,createSignalTopicEditorialRunnerStoreV1);
 assert.equal(runtime.bindGlobal,bindSignalTopicEditorialGlobalRequestV1);assert.equal(runtime.bindRepair,bindSignalTopicEditorialRepairRequestV1);
 assert.equal(runtime.ledger.readRecovery,readSignalTopicEditorialRecoveryV1);assert.equal(runtime.ledger.markSent,markSentSignalTopicEditorialCallV1);
 assert.equal(runtime.ledger.persistReceipt,persistSignalTopicEditorialReceiptV1);assert.equal(runtime.ledger.settle,settleSignalTopicEditorialCallV1);
 assert.equal(runtime.ledger.failCall,failSignalTopicEditorialCallV1);
});

test("receipt storage seals original bytes plus HTTP metadata, scope, private file modes and an immutable key",async()=>{
 const root=await mkdtemp(join(tmpdir(),"editorial-runtime-test-"));const files:string[]=[],bodies:string[]=[];
 const storage:WorkspaceEngineStorageV1={get:async()=>assert.fail("no download"),put:async args=>{
  files.push(args.file);assert.equal((await stat(args.file)).mode&0o777,0o600);assert.equal((await stat(dirname(args.file))).mode&0o777,0o700);
  const body=await readFile(args.file,"utf8");bodies.push(body);assert.equal(sha(body),args.sha256);assert.equal(Buffer.byteLength(body),args.size_bytes);
  return {storage_key:`workspace-engine/${args.workspace_id}/${args.execution_id}/${basename(args.file)}.${args.sha256.slice(7)}.parts.json`,
    sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};}};
 try{
  const runtime=createSignalTopicEditorialRuntimeStoresV1({storage,temporary_root:root}),raw=receipt();
  const first=await runtime.storeRawReceipt({lease,call_id:id(7),receipt:raw});
  const replay=await runtime.storeRawReceipt({lease,call_id:id(7),receipt:raw});assert.equal(first,replay);assert.equal(bodies[0],bodies[1]);
  const envelope=JSON.parse(bodies[0]!);assert.equal(envelope.contract_version,"signal-topic-editorial-http-receipt-v1");
  assert.equal(envelope.workspace_id,lease.workspace_id);assert.equal(envelope.execution_id,lease.execution_id);assert.equal(envelope.call_id,id(7));
  assert.equal(envelope.http_status,200);assert.equal(envelope.complete,true);assert.equal(envelope.provider_request_id,raw.provider_request_id);
  assert.deepEqual(Buffer.from(envelope.response_bytes_base64,"base64"),Buffer.from(raw.bytes));assert.equal(envelope.response_sha256,raw.sha256);
  for(const file of files)await assert.rejects(access(file));assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("wrong hash or storage scope fails closed and temporary files are removed after storage failure",async()=>{
 const root=await mkdtemp(join(tmpdir(),"editorial-runtime-invalid-"));let uploads=0;
 const storage:WorkspaceEngineStorageV1={get:async()=>assert.fail("unused"),put:async args=>{uploads++;return{
  storage_key:`workspace-engine/${id(99)}/${args.execution_id}/foreign`,sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};}};
 try{
  const runtime=createSignalTopicEditorialRuntimeStoresV1({storage,temporary_root:root});
  await assert.rejects(runtime.storeRawReceipt({lease,call_id:id(7),receipt:{...receipt(),sha256:sha("wrong")}}),/receipt_storage_invalid/);assert.equal(uploads,0);
  await assert.rejects(runtime.storeRawReceipt({lease,call_id:id(7),receipt:receipt()}),/receipt_storage_invalid/);assert.equal(uploads,1);
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("private bucket readiness runs before reservation without writing an object or opening DB on refusal",async()=>{
 let reads=0,dbConnections=0;
 const storage=createWorkspaceEngineStorageV1({url:"http://127.0.0.1",service_role_key:"synthetic_key",bucket:"private-test",fetch:async(_url,init)=>{
  reads++;assert.equal(init?.method,undefined);return Response.json({id:"private-test",public:true});}});
 const runtime=createSignalTopicEditorialRuntimeStoresV1({storage});
 await assert.rejects(runtime.ledger.reserve({database:{connect:async()=>{dbConnections++;throw Error("must not connect");}} as never,
  lease,request_digest:sha("request"),provider_available:true}),/bucket_not_private/);
 assert.equal(reads,1);assert.equal(dbConnections,0);
});

test("verified private storage is checked once before short reservations and never uploaded during reserve",async()=>{
 const events:string[]=[];
 const storage=createWorkspaceEngineStorageV1({url:"http://127.0.0.1",service_role_key:"synthetic_key",bucket:"private-test",fetch:async(url,init)=>{
  events.push("storage-ready");assert.equal(init?.method,undefined);assert.match(String(url),/\/bucket\/private-test$/u);
  return Response.json({id:"private-test",public:false});}});
 const base=createSignalTopicEditorialRuntimeStoresV1({storage});
 const runtime=createSignalTopicEditorialRuntimeStoresV1({storage,stores:{...base,ledger:{...base.ledger,reserve:async()=>{
  events.push("reserve");return{call_id:id(7),attempt_token:id(8),status:"reserved",reserved_micro_usd:"1000"};}}}});
 const args={database:{} as never,lease,request_digest:sha("request"),provider_available:true};
 await runtime.ledger.reserve(args);await runtime.ledger.reserve(args);
 assert.deepEqual(events,["storage-ready","reserve","reserve"]);
});
