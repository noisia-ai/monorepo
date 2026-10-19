import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSignalWorkspaceInterestDecisionRequestV1, signalWorkspaceEmbeddingDigestV1 } from "@noisia/query-engine";
import { createSignalWorkspaceInterestDecisionBatchStoresV1, validateSignalWorkspaceInterestDecisionBatchManifestV1 } from "./signal-workspace-interest-decision-batch-v1";

const hash=(value:string)=>`sha256:${createHash("sha256").update(value,"utf8").digest("hex")}`;
const uuid="123e4567-e89b-42d3-a456-426614174000";
const configuration={contract_version:"signal-workspace-interest-decision-provider-config-v1",provider:"anthropic",transport:"message_batches",
  model:"claude-sonnet-4-6",max_output_tokens:128000,thinking:"disabled",effort:"high",
  prompt_digest:"sha256:a3c77b96cddc5051bd97f2bb7027112a96f3c7d8643e73d974a98ee434ba0d10"};
function manifestFixture(){
  const text="context";
  const request=buildSignalWorkspaceInterestDecisionRequestV1({contract_version:"signal-workspace-interest-decision-v1",workspace_id:uuid,
    context_digest:hash("context"),decision_policy_digest:hash("policy"),interest:{taxonomy_term_id:"123e4567-e89b-42d3-a456-426614174001",
      term_key:"alexa_display",definition_revision:1,definition_digest:hash("definition"),definition:"Alexa with display",inclusion:[],exclusion:[]},
    roots:[{root_id:"123e4567-e89b-42d3-a456-426614174002",fingerprint:hash("fingerprint"),correction_digest:hash("correction"),
      asset_sha256:hash(text),chunks:[{chunk_index:0,start:0,end:text.length,chunk_sha256:hash(text),text}]}]});
  const params={model:"claude-sonnet-4-6",max_tokens:128000,thinking:{type:"disabled"},system:"system",output_config:{effort:"high"},messages:[]};
  const provider_request_digest=signalWorkspaceEmbeddingDigestV1({request_digest:request.request_digest,configuration,params});
  const provider_request={custom_id:`id1_${provider_request_digest.slice(7,67)}`,params};
  const item={contract_version:"signal-workspace-interest-decision-batch-request-v1",root_ids:[request.roots[0]!.root_id],request,
    provider_request,provider_request_digest,provider_request_bytes:Buffer.byteLength(JSON.stringify(provider_request),"utf8")};
  const page={contract_version:"signal-workspace-interest-decision-v1",workspace_id:uuid,context_digest:request.context_digest,
    decision_policy_digest:request.decision_policy_digest,interest:request.interest,roots:request.roots};
  const core={contract_version:"signal-workspace-interest-decision-page-manifest-v1",expected_root_ids:item.root_ids,
    page_digest:signalWorkspaceEmbeddingDigestV1(page),configuration,requests:[item]};
  const manifest={...core,manifest_digest:signalWorkspaceEmbeddingDigestV1(core)};
  const body=JSON.stringify({requests:[provider_request]});
  return {manifest,body,digest:hash(body)};
}

test("stored batch manifest is validated against both immutable digests and the batch body",()=>{
  const fixture=manifestFixture();
  assert.deepEqual(validateSignalWorkspaceInterestDecisionBatchManifestV1(fixture.manifest,fixture.body,fixture.digest),fixture.manifest);
  assert.throws(()=>validateSignalWorkspaceInterestDecisionBatchManifestV1(fixture.manifest,fixture.body,hash("different")),/manifest_digest_invalid/u);
  const changed=structuredClone(fixture.manifest); changed.expected_root_ids=["123e4567-e89b-42d3-a456-426614174099"];
  const {manifest_digest:_digest,...core}=changed; changed.manifest_digest=signalWorkspaceEmbeddingDigestV1(core);
  assert.throws(()=>validateSignalWorkspaceInterestDecisionBatchManifestV1(changed,fixture.body,fixture.digest),/manifest_coverage_invalid/u);
});

test("terminal rejection consumes lease and finally-release is a verified no-op",async()=>{
  const calls:string[]=[];
  const database={connect:async()=>({query:async(sql:string)=>{
    calls.push(sql);
    if(sql.includes("reject_signal_interest_decision_batch_v1")) return {rows:[{result:{state:"rejected"}}]};
    return {rows:[]};
  },release(){}})} as never;
  const stores=createSignalWorkspaceInterestDecisionBatchStoresV1({database,storeRawReceipt:async()=>""});
  const lease={batch_id:uuid,lease_token:"123e4567-e89b-42d3-a456-426614174003",state:"prepared" as const,
    provider_batch_id:null,manifest:manifestFixture().manifest};
  await stores.markKnownRejection(lease,"provider_rejected",{http_status:422,raw_body:"{\"error\":\"bad\"}",complete:true,provider_request_id:null});
  const before=calls.length;
  await stores.releaseLease(lease,{next_poll_at:null,error_code:"provider_rejected"});
  assert.equal(calls.length,before);
});

test("release passes the Worker's null error code through to SQL instead of fabricating one",async()=>{
  let releaseArgs:unknown[]|undefined;
  const database={connect:async()=>({query:async(sql:string,params?:unknown[])=>{
    if(sql.includes("release_signal_interest_decision_batch_v1")){releaseArgs=params;return {rows:[{result:{batch_id:uuid,state:"prepared",next_poll_at:params?.[2],error_code:null}}]};}
    return {rows:[]};
  },release(){}})} as never;
  const stores=createSignalWorkspaceInterestDecisionBatchStoresV1({database,storeRawReceipt:async()=>""});
  const lease={batch_id:uuid,lease_token:"123e4567-e89b-42d3-a456-426614174003",state:"prepared" as const,
    provider_batch_id:null,manifest:manifestFixture().manifest};
  const next=new Date(Date.now()+60_000).toISOString();
  await stores.releaseLease(lease,{next_poll_at:next,error_code:null});
  assert.equal(releaseArgs?.[3],null);
});

test("ambiguous HTTP receipt is preserved byte-for-byte in quarantine and not finalized as rejection",async()=>{
  const calls:Array<{sql:string;params?:unknown[]}>=[];
  const database={connect:async()=>({query:async(sql:string,params?:unknown[])=>{
    calls.push({sql,params});
    if(sql.includes("quarantine_signal_interest_decision_batch_v1"))
      return {rows:[{result:{state:"submission_unknown",retry_allowed:false}}]};
    return {rows:[]};
  },release(){}})} as never;
  const stores=createSignalWorkspaceInterestDecisionBatchStoresV1({database,storeRawReceipt:async()=>""});
  const lease={batch_id:uuid,lease_token:"123e4567-e89b-42d3-a456-426614174003",state:"submitting" as const,
    provider_batch_id:null,manifest:manifestFixture().manifest};
  const raw="{ \"error\" : {\"type\":\"rate_limit_error\"} }";
  await stores.markSubmissionUnknown(lease,"batch_http_429",null,
    {http_status:429,raw_body:raw,complete:true,provider_request_id:"req_01"});
  const quarantine=calls.find(call=>call.sql.includes("quarantine_signal_interest_decision_batch_v1"));
  assert.equal(quarantine?.params?.[2],"batch_http_429");
  assert.equal(quarantine?.params?.[3],raw);
  assert.equal(quarantine?.params?.[4],hash(raw));
  const before=calls.length;
  await stores.releaseLease(lease,{next_poll_at:null,error_code:"batch_http_429"});
  assert.equal(calls.length,before);
  assert.equal(calls.some(call=>call.sql.includes("reject_signal_interest_decision_batch_v1")),false);
});
