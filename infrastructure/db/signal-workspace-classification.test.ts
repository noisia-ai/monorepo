import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import type {PoolClient} from "pg";
import type {SignalTopicDefinitionV1,SignalWorkspaceClassificationIdentityV1} from "@noisia/query-engine";
import {beginSignalWorkspaceClassificationWithClientV1,loadSignalWorkspaceClassificationStatusV1,
  scopeSignalWorkspaceClassificationTopicsV1} from "./signal-workspace-classification";

const id=(digit:string)=>`00000000-0000-4000-8000-00000000000${digit}`;
const sha=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const definition=(term_key:string,revision:number):SignalTopicDefinitionV1=>({
  term_key,label:term_key,definition:`Meaning of ${term_key}`,scope:"primary_brand",inclusion:[],exclusion:[],
  positive_examples:[],negative_examples:[],lifecycle:"draft",origin:"manual",source:null,
  definition_revision:revision,definition_digest:sha(`${term_key}:${revision}`),
  created_at:"2026-09-01T00:00:00.000Z",updated_at:"2026-09-01T00:00:00.000Z"
});

test("one-interest identity ignores changes to unrelated interests while historical catalog does not",()=>{
  const source=[{taxonomy_term_id:id("1"),definition:definition("alexa_consent",1),compiled:{compiler_digest:sha("alexa compiler")}},
    {taxonomy_term_id:id("2"),definition:definition("other_interest",1),compiled:{compiler_digest:sha("other compiler")}}];
  const changed=[source[0]!,{...source[1]!,definition:definition("other_interest",2),compiled:{compiler_digest:sha("other compiler v2")}}];
  const one=scopeSignalWorkspaceClassificationTopicsV1(source,"alexa_consent");
  const oneAfter=scopeSignalWorkspaceClassificationTopicsV1(changed,"alexa_consent");
  assert.equal(one.topics.length,1);
  assert.equal(one.topics[0]?.definition.term_key,"alexa_consent");
  assert.equal(one.catalog_digest,oneAfter.catalog_digest);
  assert.equal(one.compiler_digest,oneAfter.compiler_digest);
  const all=scopeSignalWorkspaceClassificationTopicsV1(source);
  const allAfter=scopeSignalWorkspaceClassificationTopicsV1(changed);
  assert.equal(all.topics.length,2);
  assert.notEqual(all.catalog_digest,allAfter.catalog_digest);
  assert.notEqual(all.compiler_digest,allAfter.compiler_digest);
  assert.throws(()=>scopeSignalWorkspaceClassificationTopicsV1(source,"missing"),/interest_unavailable/u);
  assert.throws(()=>scopeSignalWorkspaceClassificationTopicsV1([...source,source[0]!],"alexa_consent"),/interest_unavailable/u);
  assert.throws(()=>scopeSignalWorkspaceClassificationTopicsV1([{...source[0]!,
    definition:{...source[0]!.definition,origin:"workspace_discovery",discovery_guidance:false}}],"alexa_consent"),
    /interest_unavailable/u);
  assert.throws(()=>scopeSignalWorkspaceClassificationTopicsV1(source,"Invalid-Key"),/interest_invalid/u);
});

test("status selects the same interest scope and leaves historical calls unscoped",async()=>{
  const seen:Array<{sql:string;params:unknown[]|undefined}>=[];
  const client={query:async(sql:string,params?:unknown[])=>{
    seen.push({sql,params});
    if(sql.includes("workspace.status workspace_status"))return{rows:[{
      workspace_status:"active",brand_status:"active",organization_status:"active",brand_same_organization:true,
      actor_status:"active",user_type:"noisia_internal",primary_role:"analyst",same_organization:true,brand_access_level:null
    }]};
    return{rows:[]};
  },release:()=>undefined} as unknown as PoolClient;
  const database={connect:async()=>client,query:client.query.bind(client)} as Parameters<typeof loadSignalWorkspaceClassificationStatusV1>[0]["database"];
  const access={database,workspace_id:id("3"),actor_user_id:id("4")};
  assert.deepEqual(await loadSignalWorkspaceClassificationStatusV1({...access,interest_term_key:"alexa_consent"}),
    {latest_run:null,latest_complete:null});
  const scoped=seen.find(entry=>entry.sql.includes("WITH selected AS"));
  assert.ok(scoped);
  assert.ok(scoped.sql.includes("generation.input_snapshot->>'interest_term_key' IS NOT DISTINCT FROM $3::text"));
  assert.deepEqual(scoped.params,[id("3"),"workspace-topic-classification-v1","alexa_consent"]);
  seen.length=0;
  await loadSignalWorkspaceClassificationStatusV1(access);
  assert.deepEqual(seen.find(entry=>entry.sql.includes("WITH selected AS"))?.params,
    [id("3"),"workspace-topic-classification-v1",null]);
});

test("begin rejects malformed interest and incompatible projection before database work",async()=>{
  const identity:SignalWorkspaceClassificationIdentityV1={contract_version:"signal-workspace-classification-v1",
    workspace_id:id("3"),engine_key:"fixture",engine_version:1,engine_artifact_digest:sha("engine"),
    embedding_config_digest:sha("embedding"),catalog_digest:sha("catalog"),compiler_digest:sha("compiler"),
    context_digest:sha("context"),decision_policy_digest:sha("policy")};
  const client={query:async()=>{throw new Error("unexpected query");}} as unknown as PoolClient;
  const base={workspace_id:id("3"),actor_user_id:id("4"),idempotency_key:"fixture-key",
    embedding_run_id:id("5"),identity};
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,{...base,interest_term_key:"Bad-Key"}),/interest_invalid/u);
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,{...base,interest_term_key:"alexa_consent",
    source_projection:{contract_version:"workspace-topic-projection-v1",engine_execution_id:id("6"),model_artifact_id:null,
      output_artifact_id:id("7"),materialization_artifact_id:id("8"),mapping_digest:sha("mapping"),policy_digest:sha("policy"),
      model_version_id:null}}),/interest_invalid/u);
});

test("client admin grant opens only the governed interest decision generation",async()=>{
  const baseIdentity:SignalWorkspaceClassificationIdentityV1={contract_version:"signal-workspace-classification-v1",
    workspace_id:id("3"),engine_key:"interest_decision",engine_version:1,engine_artifact_digest:sha("engine"),
    embedding_config_digest:sha("embedding"),catalog_digest:sha("catalog"),compiler_digest:sha("compiler"),
    context_digest:sha("context"),decision_policy_digest:sha("policy")};
  const base={workspace_id:id("3"),actor_user_id:id("4"),idempotency_key:"client-interest-key",
    embedding_run_id:id("5"),identity:baseIdentity};
  let accessLevel="admin";
  const client={query:async(sql:string)=>{
    if(sql.includes("workspace.status workspace_status"))return{rows:[{
      workspace_status:"active",brand_status:"active",organization_status:"active",brand_same_organization:true,
      actor_status:"active",user_type:"client",primary_role:"client_admin",same_organization:true,
      brand_access_level:accessLevel
    }]};
    if(sql.includes("pg_advisory_xact_lock"))throw new Error("passed_authorization");
    throw new Error("unexpected query");
  }} as unknown as PoolClient;
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,
    {...base,interest_term_key:"alexa_consent"}),/passed_authorization/u);
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,base),/workspace_classification_forbidden/u);
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,
    {...base,interest_term_key:"alexa_consent",identity:{...baseIdentity,engine_key:"other_engine"}}),
    /workspace_classification_forbidden/u);
  accessLevel="comment";
  await assert.rejects(beginSignalWorkspaceClassificationWithClientV1(client,
    {...base,interest_term_key:"alexa_consent"}),/workspace_classification_forbidden/u);
});
