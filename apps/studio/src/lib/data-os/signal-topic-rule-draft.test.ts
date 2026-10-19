import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseSignalTopicRuleSpecV1 } from "@noisia/query-engine";
import { TopicCandidateRuleDraftView } from "../../components/brands/TopicCandidateRuleDraft";
import * as management from "./signal-topic-rule-draft-management";
import { parseTopicRuleDraftSave,parseTopicRuleDraftTrial,topicRuleError,topicRuleIdempotencyKey } from "./signal-topic-rule-draft-api";

const digest=`sha256:${"4".repeat(64)}`;
const uuid="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const candidate={candidate_key:"candidate.test",title:"Football experience",description:"Saved description",
  revision:1,state_token:digest,review_state:"pending"as const};
const fields={...management.emptyTopicRuleFields(),any:"echo football\nAlexa, campaign",all:"experience",markets:"MX"};
const spec=management.topicRuleSpecFromFields(candidate,fields);
const request={run_key:"run.test",candidate_key:candidate.candidate_key,expected_candidate_revision:1,
  expected_candidate_state_token:digest,expected_draft_revision:0,expected_draft_digest:null,rule_spec:spec};
const draft={contract_version:"signal-topic-contract-draft-v1"as const,draft_id:uuid,revision:1,
  draft_digest:digest,predecessor_draft_id:null,rule_spec:spec,spec_digest:digest,
  source:{run_key:"run.test",candidate_key:candidate.candidate_key,revision:1,version_digest:digest,snapshot_digest:digest},
  created_at:"2026-09-06T12:00:00.000Z",is_stale:false,is_latest:true,idempotent_replay:false};
const trialRequest={run_key:"run.test",candidate_key:candidate.candidate_key,expected_candidate_revision:1,
  expected_candidate_state_token:digest,draft_id:uuid,expected_draft_revision:1,expected_draft_digest:digest,
  max_memberships:25000,example_limit:10,timeout_ms:15000};
const trial:management.TopicRuleTrial={contract_version:"signal-topic-contract-draft-trial-v1",draft_id:uuid,
  draft_revision:1,draft_digest:digest,spec_digest:digest,compiler_version:"signal-topic-rule-simple-fts-v1",plan_hash:digest,
  snapshot_digest:digest,population_digest:digest,considered_digest:digest,population_kind:"frozen_snapshot_memberships",
  counts:{total:21195,considered:21195,not_tested:0,filter_excluded:16074,unavailable:0,matched:517,abstained:4604},
  max_memberships:25000,example_limit:10,timeout_ms:15000,
  examples:[{evidence_ref:digest,outcome:"matched",excerpt:"<script>Football evidence</script>",
    language:"en",market:"MX",scope:"primary_brand",month:"2026-09"}],
  example_availability:{stored:2,available:1,unavailable:1},topic_adoption:false,publication:false,serving:false,
  trial_id:other,created_at:"2026-09-06T12:01:00.000Z",is_stale:false,is_latest_draft:true,idempotent_replay:false};
const page:management.TopicRuleDraftPage={contract_version:"signal-topic-rule-draft-management-v1",run_key:"run.test",
  candidate_key:candidate.candidate_key,candidate:{title:candidate.title,description:candidate.description,
    revision:1,state_token:digest,review_state:"pending"},draft,trial};
const t=(key:string,values?:Record<string,string|number>)=>`${key}${values?JSON.stringify(values):""}`;
function render(overrides:Partial<Parameters<typeof TopicCandidateRuleDraftView>[0]>={}){
  return renderToStaticMarkup(createElement(TopicCandidateRuleDraftView,{candidate,page,fields,t,locale:"en-US",
    loading:false,busy:false,blocked:false,dirty:false,valid:true,editorDirty:false,sourceStale:false,error:null,
    pending:false,readChecked:true,success:null,onFields:()=>undefined,onSave:()=>undefined,onTrial:()=>undefined,
    onRefresh:()=>undefined,onRecover:()=>undefined,...overrides}));
}

test("explicit phrase form never infers from candidate prose, splits commas or silently truncates",()=>{
  assert.throws(()=>management.topicRuleSpecFromFields(candidate,management.emptyTopicRuleFields()));
  assert.deepEqual(spec.lexical.any,["echo football","Alexa, campaign"]);
  assert.deepEqual(spec.filters,{languages:[],markets:["MX"],scopes:[]});
  assert.equal(spec.label,candidate.title);assert.equal(spec.definition,candidate.description);
  for(const change of[{any:"x".repeat(161)},{any:Array.from({length:17},()=>"echo").join("\n")},
    {any:"!!!"},{any:"echo\u0000"},{markets:"mx"},{languages:"EN"},{markets:"MX,US"},
    {any:Array.from({length:16},()=>"echo").join("\n"),all:Array.from({length:16},()=>"echo").join("\n"),not:"extra"}])
    assert.throws(()=>management.topicRuleSpecFromFields(candidate,{...fields,...change}));
});

test("closed save/trial contracts enforce identity CAS, predecessor and every trial bound",()=>{
  assert.deepEqual(parseTopicRuleDraftSave(request).rule_spec,parseSignalTopicRuleSpecV1(spec));
  assert.deepEqual(parseTopicRuleDraftTrial(trialRequest),trialRequest);
  for(const field of["reason","rationale","confirmation","workspace_id","actor","sql","provider"])
    assert.throws(()=>parseTopicRuleDraftSave({...request,[field]:"extra"}));
  for(const value of[{...request,expected_draft_digest:digest},{...request,expected_draft_revision:1},
    {...request,rule_spec:{...spec,filters:{...spec.filters,column:"private"}}},
    {...request,rule_spec:{...spec,lexical:{...spec.lexical,regex:".*"}}}])assert.throws(()=>parseTopicRuleDraftSave(value));
  for(const change of[{draft_id:"not-uuid"},{expected_draft_digest:null},{max_memberships:50001},
    {max_memberships:0},{example_limit:11},{timeout_ms:15001},{timeout_ms:0},{limit:20}])
    assert.throws(()=>parseTopicRuleDraftTrial({...trialRequest,...change}));
  for(const key of["short","x".repeat(201),"valid-key with space"])assert.equal(topicRuleIdempotencyKey(
    new Request("https://local.invalid",{headers:{"Idempotency-Key":key}})),null);
  assert.equal(topicRuleIdempotencyKey(new Request("https://local.invalid",{headers:{"Idempotency-Key":"valid-key"}})),"valid-key");
});

test("browser projection binds draft/trial scope, count conservation and current example availability",()=>{
  assert.deepEqual(management.topicRuleDraftPageSchema.parse(page),page);
  for(const value of[{...page,draft:{...draft,source:{...draft.source,run_key:"run.other"}}},
    {...page,trial:{...trial,draft_id:other}},{...page,draft:null},
    {...page,trial:{...trial,counts:{...trial.counts,total:21196}}},
    {...page,trial:{...trial,examples:[{...trial.examples[0],url:"private"}]}},
    {...page,trial:{...trial,example_availability:{stored:2,available:2,unavailable:0}}},
    {...page,trial:{...trial,serving:true}}])assert.throws(()=>management.topicRuleDraftPageSchema.parse(value));
  assert.equal(management.topicRuleDraftPageSchema.parse({...page,trial:null}).trial,null);
});

test("GET is no-store and scope-bound; transport uncertainty never invents a safe new request",async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[],controller=new AbortController();
  await management.loadTopicRuleDraftPage("/rule-draft","run.test",candidate.candidate_key,controller.signal,
    async(url,init)=>{calls.push({url:String(url),init});return Response.json(page);});
  assert.equal(calls.length,1);assert.equal(calls[0]?.url,"/rule-draft?run_key=run.test");
  assert.equal(calls[0]?.init?.method,"GET");assert.equal(calls[0]?.init?.cache,"no-store");
  assert.equal(calls[0]?.init?.signal,controller.signal);
  await assert.rejects(management.loadTopicRuleDraftPage("/rule-draft","run.other",candidate.candidate_key,undefined,
    async()=>Response.json(page)),/scope_mismatch/u);
  for(const transport of[async()=>{throw new Error("private network body");},
    async()=>Response.json({error:"raw-secret-code",message:"private"},{status:500})]){
    await assert.rejects(management.requestTopicRuleJson("/trial",{method:"POST"},transport),
      (error:unknown)=>error instanceof management.TopicRuleRequestError&&error.ambiguous&&error.code==="topic_rule_operation_failed");
  }
  await assert.rejects(management.requestTopicRuleJson("/trial",{method:"POST"},
    async()=>Response.json({error:"topic_rule_candidate_stale"},{status:409})),
  (error:unknown)=>error instanceof management.TopicRuleRequestError&&!error.ambiguous);
});

test("safe domain errors conceal SQL/private diagnostics and map timeout/schema/conflict truthfully",async()=>{
  for(const [input,expected,status] of[[{code:"57014",message:"secret SQL"},"topic_rule_trial_timeout",409],
    [{code:"42P01",message:"private table"},"topic_rule_schema_unavailable",503],
    [{code:"40001"},"topic_rule_candidate_stale",409],
    [{code:"topic_evaluation_v2_candidate_not_found",message:"private source identity"},"topic_rule_candidate_not_found",404],
    [{code:"PRIVATE",message:"credential"},"topic_rule_operation_failed",500]]as const){
    const response=topicRuleError(input);assert.equal(response.status,status);
    assert.deepEqual(await response.json(),{error:expected});assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  }
  await assert.rejects(management.requestTopicRuleJson("/rule-draft",{method:"POST"},async()=>
    topicRuleError({code:"topic_evaluation_v2_candidate_not_found"})),
  (error:unknown)=>error instanceof management.TopicRuleRequestError
    &&error.code==="topic_rule_candidate_not_found"&&!error.ambiguous);
});

async function loadProductHarness(overrides:Record<string,unknown>={},options:{existing?:boolean;commitFailure?:boolean}={}){
  const source=await readFile(new URL("./signal-topic-rule-draft-product.ts",import.meta.url),"utf8");
  const log:string[]=[];
  const client={query:async(sql:string)=>{log.push(sql);
    if(sql==="COMMIT"&&options.commitFailure)throw new Error("connection lost during commit");
    return{rows:sql.startsWith("SELECT 1 FROM signal_topic_contract_draft_versions")?(options.existing?[{}]:[])
      :sql.startsWith("SELECT draft.id::text")?[{draft_id:uuid,run_key:"run.test",candidate_key:candidate.candidate_key}]:[],rowCount:0};},
    release:()=>{log.push("RELEASE_CLIENT");}};
  const functions={createSignalTopicContractDraftV1:async()=>{log.push("CREATE");return draft;},
    loadSignalTopicContractDraftV1:async()=>{log.push("LOAD_DRAFT");return draft;},
    loadSignalTopicContractDraftLatestTrialV1:async()=>{log.push("LOAD_TRIAL");return trial;},
    loadSignalTopicEvaluationV2CandidateDetail:async()=>{log.push("DETAIL");return{candidate};},
    runSignalTopicContractDraftTrialV1:async()=>{log.push("MEASURE");return trial;},...overrides};
  const exports:Record<string,unknown>={};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","exports",compiled)((name:string)=>{
    if(name==="@noisia/db")return functions;
    if(name==="@/lib/db")return{pool:{connect:async()=>{log.push("CONNECT");return client;}}};
    if(name==="./signal-topic-rule-draft-management")return management;
    throw new Error(`Unexpected module ${name}`);
  },exports);
  return{api:exports as typeof import("./signal-topic-rule-draft-product"),log};
}
const context={workspace:{id:uuid},actor:{id:other,userType:"noisia_internal"}};

test("real wrapper control flow: coherent RO GET, SERIALIZABLE writes, DTO before commit and unconditional release",async()=>{
  const read=await loadProductHarness();
  await read.api.loadTopicRuleDraftProduct({...context,runKey:"run.test",candidateKey:candidate.candidate_key}as never);
  assert.deepEqual(read.log,["CONNECT","BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","DETAIL","LOAD_DRAFT","LOAD_TRIAL","COMMIT","RELEASE_CLIENT"]);
  const save=await loadProductHarness();
  await save.api.saveTopicRuleDraftProduct({...context,request,idempotencyKey:"valid-key"}as never);
  assert.ok(save.log.indexOf("CREATE")>save.log.indexOf("BEGIN ISOLATION LEVEL SERIALIZABLE"));
  assert.deepEqual(save.log.slice(-3),["SET CONSTRAINTS ALL IMMEDIATE","COMMIT","RELEASE_CLIENT"]);
  const invalid=await loadProductHarness({createSignalTopicContractDraftV1:async()=>({...draft,private_sql:"secret"})});
  await assert.rejects(invalid.api.saveTopicRuleDraftProduct({...context,request,idempotencyKey:"valid-key"}as never));
  assert.deepEqual(invalid.log.slice(-2),["ROLLBACK","RELEASE_CLIENT"]);assert.ok(!invalid.log.includes("COMMIT"));
  const ambiguous=await loadProductHarness({}, {commitFailure:true});
  await assert.rejects(ambiguous.api.saveTopicRuleDraftProduct({...context,request,idempotencyKey:"valid-key"}as never));
  assert.deepEqual(ambiguous.log.slice(-3),["COMMIT","ROLLBACK","RELEASE_CLIENT"]);
});

test("wrappers authorize before connecting, bind exact draft route and forbid unsaved identity before creation",async()=>{
  const forbidden=await loadProductHarness();
  await assert.rejects(forbidden.api.loadTopicRuleDraftProduct({...context,actor:{...context.actor,userType:"client"},
    runKey:"run.test",candidateKey:candidate.candidate_key}as never),/forbidden/u);
  assert.deepEqual(forbidden.log,[]);
  const changed=await loadProductHarness();
  await assert.rejects(changed.api.saveTopicRuleDraftProduct({...context,request:{...request,rule_spec:{...spec,label:"Unsaved"}},
    idempotencyKey:"valid-key"}as never),/request_invalid/u);assert.ok(!changed.log.includes("CREATE"));
  for(const change of[{draft_id:other},{run_key:"run.other"},{candidate_key:"candidate.other"}])
    assert.throws(()=>changed.api.assertTopicRuleRouteBinding(draft,{draft_id:uuid,run_key:"run.test",
      candidate_key:candidate.candidate_key,...change}),/scope_mismatch/u);
  const measured=await loadProductHarness();
  await measured.api.testTopicRuleDraftProduct({...context,request:trialRequest,idempotencyKey:"trial-key"}as never);
  assert.ok(measured.log.findIndex((sql)=>sql.includes("run.run_key=$3 AND candidate.candidate_key=$4"))<measured.log.indexOf("MEASURE"));
});

test("old-key save replay reaches core request/actor validation even when source has changed",async()=>{
  const replay=await loadProductHarness({loadSignalTopicEvaluationV2CandidateDetail:async()=>{throw new Error("must not fresh validate replay");}}, {existing:true});
  await replay.api.saveTopicRuleDraftProduct({...context,request,idempotencyKey:"valid-key"}as never);
  assert.ok(replay.log.includes("CREATE"));assert.ok(!replay.log.includes("DETAIL"));
});

test("view preserves saved identity, explicit counts and safe examples; dirty/stale/ambiguous states block trial",()=>{
  const html=render();assert.match(html,/Football experience/u);assert.match(html,/21,195/u);
  assert.match(html,/counts\.not_tested/u);assert.match(html,/counts\.filter_excluded/u);
  assert.match(html,/&lt;script&gt;Football evidence&lt;\/script&gt;/u);
  assert.doesNotMatch(html,/<script|<a\s|sha256:|name="(?:rationale|reason|confirmation)"/u);
  for(const overrides of[{dirty:true},{blocked:true},{page:{...page,draft:{...draft,is_stale:true}}},
    {pending:true,readChecked:false}])assert.match(render(overrides),/<button[^>]+disabled=""[^>]*>test<\/button>/u);
  assert.match(render({editorDirty:true,blocked:true}),/editorDirty/u);
  assert.match(render({sourceStale:true,blocked:true}),/stale/u);
  assert.match(render({page:{...page,trial:null}}),/untested/u);
  assert.match(render({error:"topic_rule_trial_timeout"}),/errors\.topic_rule_trial_timeout/u);
  assert.match(render({loading:true}),/aria-busy="true"/u);
  assert.match(render({pending:true,readChecked:false}),/<button[^>]+disabled=""[^>]*>recover<\/button>/u);
});

test("route guards precede parser/writer; pending key survives UI remount and recovery requires fresh GET",async()=>{
  const routeBase="../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/candidates/[candidateKey]/rule-draft/";
  for(const file of[`${routeBase}route.ts`,`${routeBase}trial/route.ts`]){
    const source=await readFile(new URL(file,import.meta.url),"utf8");
    assert.ok(source.indexOf('if("response" in loaded)')<source.indexOf("let body"));
    assert.match(source,/body\.candidate_key!==candidateKey/u);assert.match(source,/actor:loaded\.session\.appUser/u);
  }
  const source=await readFile(new URL("../../components/brands/TopicCandidateRuleDraft.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/from ["'](?:@noisia\/query-engine|@noisia\/db|node:crypto)/u);
  assert.ok(source.indexOf("retainPending(url,operation)")<source.indexOf("await requestTopicRuleJson"));
  assert.match(source,/pendingRef\.current&&readChecked&&!busy/u);assert.match(source,/submit\(pendingRef\.current\)/u);
  assert.match(source,/sessionStorage\.getItem/u);assert.match(source,/read\.current\?\.abort\(\)/u);
  assert.match(source,/max_memberships:25000,example_limit:10,timeout_ms:15000/u);
  const refresh=source.slice(source.indexOf("async function refresh()"),source.indexOf("function useSuggestion()"));
  assert.match(refresh,/await onRefreshCandidate\(\)/u);assert.match(refresh,/await load\(false\)/u);
  assert.ok(refresh.indexOf("await onRefreshCandidate()")<refresh.indexOf("await load(false)"));
  assert.doesNotMatch(refresh,/else|load\(true\)|setFields/u,"identity refresh rereads receipts without resetting manual phrases");
});

test("standard suite, bilingual copy and OpenAPI contain the new closed contract",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../../../package.json",import.meta.url),"utf8"));
  assert.match(manifest.scripts.test,/signal-topic-rule-draft\.test\.ts/u);
  const messages=await Promise.all(["es-MX","en-US"].map(async(locale)=>JSON.parse(await readFile(
    new URL(`../../../messages/${locale}.json`,import.meta.url),"utf8")).AdminWorkspace.brandOs.fullEvidenceTopicCandidates.ruleDraft));
  function keys(value:Record<string,unknown>,prefix=""):string[]{return Object.entries(value).flatMap(([key,item])=>
    item&&typeof item==="object"?keys(item as Record<string,unknown>,`${prefix}${key}.`):[`${prefix}${key}`]).sort();}
  assert.deepEqual(keys(messages[0]),keys(messages[1]));
  const require=createRequire(import.meta.url),eslintRequire=createRequire(require.resolve("eslint"));
  const document=eslintRequire("js-yaml").load(await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8"));
  const Ajv=eslintRequire("ajv"),validate=new Ajv({allErrors:true}).compile({
    $ref:"#/components/schemas/SignalTopicRuleDraftManagementV1",components:document.components});
  assert.equal(validate(page),true,JSON.stringify(validate.errors));
  assert.equal(validate({...page,trial:{...trial,examples:[{...trial.examples[0],source_id:uuid}]}}),false);
  const save=new Ajv({allErrors:true}).compile({$ref:"#/components/schemas/SignalTopicRuleDraftSaveV1",components:document.components});
  assert.equal(save(request),true,JSON.stringify(save.errors));assert.equal(save({...request,reason:"extra"}),false);
  assert.equal(save({...request,rule_spec:{...spec,lexical:{any:[],all:[],not:["echo"]}}}),false);
  const base="/api/data-os/signal/{workspaceId}/topic-evaluation/full-evidence/candidates/{candidateKey}/rule-draft";
  for(const route of[base,`${base}/trial`]){
    const header=document.paths[route].post.parameters.find((parameter:{name?:string})=>parameter.name==="Idempotency-Key");
    assert.equal(header.required,true);assert.equal(header.in,"header");
    const validateKey=new Ajv().compile(header.schema);
    for(const key of["valid-key","a".repeat(200)])assert.equal(validateKey(key),true);
    for(const key of["short","a".repeat(201),"invalid key"])assert.equal(validateKey(key),false);
    assert.equal(header.schema.pattern,"^[A-Za-z0-9._:-]{8,200}$");
  }
});
