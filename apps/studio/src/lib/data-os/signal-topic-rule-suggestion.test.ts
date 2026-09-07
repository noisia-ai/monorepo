import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import test from "node:test";
import ts from "typescript";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TopicRuleSuggestionView} from "../../components/brands/TopicCandidateRuleDraft";
import * as management from "./signal-topic-rule-suggestion-management";
import {topicRuleFieldsFromSpec,topicRuleSpecFromFields,emptyTopicRuleFields} from "./signal-topic-rule-draft-management";
import {withTopicRuleTransaction} from "./signal-topic-rule-draft-product";
import {parseTopicRuleSuggestionCommand,parseTopicRuleSuggestionQuery,topicRuleSuggestionError} from "./signal-topic-rule-suggestion-api";
const d=`sha256:${"4".repeat(64)}`,id="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const candidate={title:"Football campaign",description:"Saved definition",revision:1,state_token:d,review_state:"pending"as const};
const spec=topicRuleSpecFromFields(candidate,{...emptyTopicRuleFields(),any:"football\necho",all:"campaign",not:"tickets",markets:"MX",languages:"es",scopes:["primary_brand"]});
const cas={expected_candidate_revision:1,expected_candidate_state_token:d,expected_draft_revision:0,expected_draft_digest:null};
const command={action:"save"as const,run_key:"run.test",candidate_key:"candidate.test",receipt_id:id,...cas,lexical:spec.lexical,filters:spec.filters};
const receipt:management.TopicRuleSuggestionReceipt={receipt_id:id,origin:"local_fixture",status:"suggested",explanation:"<script>Evidence explanation</script>",
  rule_spec:spec,run_key:"run.test",candidate_key:"candidate.test",...cas,is_stale:false,stale_reasons:[],
  current_draft:{revision:0,digest:null},draft_changed:false,evidence:{stored:1,available:1,unavailable:0},latest_link:null,created_at:"2026-09-06T12:00:00.000Z"};
const draft={contract_version:"signal-topic-contract-draft-v1"as const,draft_id:other,revision:1,draft_digest:d,predecessor_draft_id:null,
  rule_spec:spec,spec_digest:d,source:{run_key:"run.test",candidate_key:"candidate.test",revision:1,version_digest:d,snapshot_digest:d},
  created_at:"2026-09-06T12:01:00.000Z",is_stale:false,is_latest:true,idempotent_replay:false};
const page:management.TopicRuleSuggestionPage={contract_version:"signal-topic-rule-suggestion-management-v1",page:{contract_version:"signal-topic-rule-draft-management-v1",
  run_key:"run.test",candidate_key:"candidate.test",candidate,draft:null,trial:null},receipt,citations:null,prior_drafts:[],generation:{enabled:false,reason:"execution_not_enabled"}};
test("closed command/query contracts reject authority, generation, duplicate queries and inconsistent CAS",()=>{
  assert.deepEqual(parseTopicRuleSuggestionCommand(command),command);
  assert.throws(()=>parseTopicRuleSuggestionCommand({...command,action:"restore",restore_draft_id:other,lexical:undefined,filters:undefined}));
});
test("request allowlist preserves all filters and has no route for fixture receipt or paid generation",()=>{
  for(const name of["actor","workspace_id","origin","fixture","context","evidence_refs","reason","confirmation","provider"])
    assert.throws(()=>parseTopicRuleSuggestionCommand({...command,[name]:"forged"}));
  assert.throws(()=>parseTopicRuleSuggestionCommand({...command,expected_draft_revision:1}));
  assert.throws(()=>parseTopicRuleSuggestionCommand({...command,filters:{...spec.filters,scopes:["global"]}}));
  assert.throws(()=>parseTopicRuleSuggestionQuery("https://local.invalid?run_key=run.test&run_key=run.other"));
  assert.throws(()=>parseTopicRuleSuggestionQuery("https://local.invalid?run_key=run.test&generate=true"));
  assert.deepEqual(parseTopicRuleSuggestionQuery(`https://local.invalid?run_key=run.test&receipt_id=${id}&include_citations=true`),
    {run_key:"run.test",receipt_id:id,include_citations:"true"});
  const restore={run_key:command.run_key,candidate_key:command.candidate_key,receipt_id:id,...cas};
  assert.equal(parseTopicRuleSuggestionCommand({...restore,action:"restore",restore_draft_id:other}).action,"restore");
});
test("copy is pure, only edits lexical/filter fields and rejects stale/insufficient receipts",()=>{
  const original=JSON.stringify(receipt),fields=management.topicRuleSuggestionFields(receipt);
  assert.deepEqual(fields,topicRuleFieldsFromSpec(spec));assert.equal(JSON.stringify(receipt),original);
  assert.equal("title"in fields,false);assert.equal("receipt_id"in fields,false);
  assert.throws(()=>management.topicRuleSuggestionFields({...receipt,is_stale:true,stale_reasons:["evidence_unavailable"]}));
  assert.throws(()=>management.topicRuleSuggestionFields({...receipt,status:"insufficient_evidence",rule_spec:null}));
});
test("closed read DTO binds receipt/draft/candidate/citations and never accepts enabled provider capability",()=>{
  assert.deepEqual(management.topicRuleSuggestionPageSchema.parse(page),page);
  for(const bad of[{...page,generation:{enabled:true,reason:"execution_not_enabled"}},
    {...page,receipt:{...receipt,candidate_key:"candidate.other"}},{...page,receipt:{...receipt,context:"private"}},
    {...page,prior_drafts:[{draft_id:other,revision:1}]},
    {...page,citations:{receipt_id:other,items:[],availability:{stored:0,available:0,unavailable:0}}},
    {...page,citations:{receipt_id:id,items:[{evidence_ref:d,status:"unavailable",reason:"source_changed",excerpt:"revoked"}],
      availability:{stored:1,available:0,unavailable:1}}}])assert.throws(()=>management.topicRuleSuggestionPageSchema.parse(bad));
});
test("new page/CAS cannot silently rebase fields retained by the editor",()=>{
  const base={candidate_revision:1,candidate_state_token:d,draft_revision:0,draft_digest:null};
  assert.equal(management.topicRuleSuggestionFormStale(page.page,base),false);
  assert.equal(management.topicRuleSuggestionFormStale({...page.page,draft},base),true);
  assert.equal(management.topicRuleSuggestionFormStale({...page.page,candidate:{...candidate,revision:2}},base),true);
});
test("pending request roundtrips exact scope/body/key; restore and ordinary flows remain distinct",()=>{
  const pending={kind:"suggestion",key:"suggestion-key",scope:"/workspaces/one/run.test/candidate.test",body:command};
  assert.deepEqual(management.topicRuleSuggestionPendingSchema.parse(JSON.parse(JSON.stringify(pending))),pending);
  assert.throws(()=>management.topicRuleSuggestionPendingSchema.parse({...pending,scope:undefined}));
  assert.throws(()=>management.topicRuleSuggestionPendingSchema.parse({...pending,body:{...command,lexical:{any:["a"],all:[],not:[],sql:"*"}}}));
});
test("first-send normalization keeps byte-identical bodies and keys after storage/remount for all four operations",()=>{
  const common={candidate_key:command.candidate_key,run_key:command.run_key,...cas};
  const operations=[
    {kind:"suggestion",key:"suggestion-save-key",scope:"/workspaces/one/run.test/candidate.test",body:command},
    {kind:"suggestion",key:"suggestion-restore-key",scope:"/workspaces/one/run.test/candidate.test",
      body:{action:"restore",restore_draft_id:other,receipt_id:id,...common}},
    {kind:"save",key:"ordinary-save-key",body:{rule_spec:spec,...common}},
    {kind:"trial",key:"ordinary-trial-key",body:{timeout_ms:15000,example_limit:10,max_memberships:25000,
      draft_id:other,expected_draft_digest:d,expected_draft_revision:1,expected_candidate_state_token:d,
      expected_candidate_revision:1,candidate_key:command.candidate_key,run_key:command.run_key}}
  ];
  for(const input of operations){
    const first=management.topicRuleSuggestionPendingSchema.parse(input);
    const stored=JSON.stringify(first),recovered=management.topicRuleSuggestionPendingSchema.parse(JSON.parse(stored));
    assert.equal(JSON.stringify(recovered.body),JSON.stringify(first.body),`${input.kind}: exact transport body`);
    assert.equal(recovered.key,first.key);assert.equal(JSON.stringify(recovered),stored);
  }
  // This fixture reproduces the original ordering discrepancy; raw construction is not the transport representation.
  const normalized=management.topicRuleSuggestionPendingSchema.parse(operations[0]);
  assert.notEqual(JSON.stringify(operations[0]!.body),JSON.stringify(normalized.body));
});
test("GET binds exact receipt and lazy citation flag; POST uncertainty keeps manual recovery honest",async()=>{
  let requestUrl="";await management.loadTopicRuleSuggestionPage("/suggestions","run.test","candidate.test",{receipt_id:id,include_citations:true},
    async(url,init)=>{requestUrl=String(url);assert.equal(init?.method,"GET");assert.equal(init?.cache,"no-store");return Response.json(page);});
  assert.match(requestUrl,/include_citations=true/u);
  await assert.rejects(management.loadTopicRuleSuggestionPage("/suggestions","run.test","candidate.test",{receipt_id:other},async()=>Response.json(page)),/scope_mismatch/u);
  for(const transport of[async()=>new Response("<html>error</html>",{status:200}),async()=>Response.json({}, {status:502}),
    async()=>{throw new Error("private connection diagnostic");}])await assert.rejects(
    management.requestTopicRuleSuggestionJson("/suggestions",{method:"POST"},transport),
    error=>error instanceof management.TopicRuleSuggestionRequestError&&error.ambiguous);
  for(const status of[401,403,404])await assert.rejects(management.requestTopicRuleSuggestionJson("/suggestions",{method:"POST"},
    async()=>new Response("not-json",{status})),error=>error instanceof management.TopicRuleSuggestionRequestError&&!error.ambiguous);
});
test("safe API errors never echo database, model or secret diagnostics",async()=>{
  for(const [raw,code,status]of[["40001","source_stale",409],["42P01","schema_unavailable",503],
    ["topic_rule_draft_forbidden","forbidden",403],["private-secret","operation_failed",500]]as const){
    const result=topicRuleSuggestionError({code:raw,message:"private"});assert.equal(result.status,status);
    assert.deepEqual(await result.json(),{error:`topic_rule_suggestion_${code}`});}
});
async function harness(overrides:Record<string,unknown>={}){
  const source=await readFile(new URL("./signal-topic-rule-suggestion-product.ts",import.meta.url),"utf8"),log:string[]=[];
  const dbReceipt={...receipt,adaptation:{status:receipt.status,suggestion:{explanation:receipt.explanation},rule_spec:spec,
    run_key:receipt.run_key,candidate_key:receipt.candidate_key,...cas}};
  const client={query:async(sql:string)=>{log.push(sql);return{rows:[]};},release:()=>log.push("release")};
  const fns={loadSignalTopicEvaluationV2CandidateDetail:async()=>{log.push("candidate");return{candidate};},
    loadSignalTopicContractDraftV1:async()=>{log.push("draft");return null;},loadSignalTopicContractDraftLatestTrialV1:async()=>null,
    loadSignalTopicRuleSuggestionV1:async()=>{log.push("receipt");return dbReceipt;},
    loadSignalTopicRuleSuggestionPriorDraftV1:async()=>null,loadSignalTopicRuleSuggestionEvidenceV1:async()=>{log.push("citations");return null;},
    saveSignalTopicRuleSuggestionDraftV1:async()=>{log.push("save-bridge");return{receipt_id:id,link_id:id,action:"save",draft,idempotent_replay:false};},...overrides};
  const exports:Record<string,unknown>={};new Function("require","exports",ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)((name:string)=>{
    if(name==="@noisia/db")return fns;if(name==="@/lib/db")return{pool:{connect:async()=>{log.push("connect");return client;}}};
    if(name==="./signal-topic-rule-draft-product")return{withTopicRuleTransaction};
    if(name==="./signal-topic-rule-suggestion-management")return management;throw new Error(`Unexpected ${name}`);
  },exports);return{api:exports as typeof import("./signal-topic-rule-suggestion-product"),log};
}
const context={workspace:{id},actor:{id:other,userType:"noisia_internal"}};
test("actual wrapper: coherent RRRO, lazy own evidence, SERIALIZABLE bridge and validation before COMMIT",async()=>{
  const read=await harness();await read.api.loadTopicRuleSuggestionProduct({...context,runKey:"run.test",candidateKey:"candidate.test"}as never);
  assert.equal(read.log[1],"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");assert.ok(!read.log.includes("citations"));
  const cites=await harness();await cites.api.loadTopicRuleSuggestionProduct({...context,runKey:"run.test",candidateKey:"candidate.test",includeCitations:true}as never);
  assert.ok(cites.log.includes("citations"));
  const save=await harness();await save.api.saveTopicRuleSuggestionProduct({...context,request:command,idempotencyKey:"suggestion-key"}as never);
  assert.equal(save.log[1],"BEGIN ISOLATION LEVEL SERIALIZABLE");assert.deepEqual(save.log.slice(-3),["SET CONSTRAINTS ALL IMMEDIATE","COMMIT","release"]);
  const malformed=await harness({saveSignalTopicRuleSuggestionDraftV1:async()=>({raw_context:"private"})});
  await assert.rejects(malformed.api.saveTopicRuleSuggestionProduct({...context,request:command,idempotencyKey:"suggestion-key"}as never));
  assert.ok(!malformed.log.includes("COMMIT"));assert.deepEqual(malformed.log.slice(-2),["ROLLBACK","release"]);
});
test("wrapper refuses external actor before DB and exact missing receipt is not substituted",async()=>{
  const denied=await harness();await assert.rejects(denied.api.loadTopicRuleSuggestionProduct({...context,
    actor:{id:other,userType:"client"},runKey:"run.test",candidateKey:"candidate.test"}as never));assert.deepEqual(denied.log,[]);
  const missing=await harness({loadSignalTopicRuleSuggestionV1:async()=>null});await assert.rejects(missing.api.loadTopicRuleSuggestionProduct(
    {...context,runKey:"run.test",candidateKey:"candidate.test",receiptId:id}as never),/not_found/u);
});
test("view labels fixtures, disables paid generation, escapes prose and allows stale citations without use",()=>{
  const render=(changes:Partial<Parameters<typeof TopicRuleSuggestionView>[0]>={})=>renderToStaticMarkup(createElement(TopicRuleSuggestionView,{
    page,error:null,t:key=>key,blocked:false,reading:false,dirty:false,used:false,canUndoCopy:false,onUse:()=>undefined,
    onCitations:()=>undefined,onUndoCopy:()=>undefined,onRestore:()=>undefined,...changes}));
  const html=render();assert.match(html,/suggestion.localFixture/u);assert.match(html,/&lt;script&gt;/u);assert.doesNotMatch(html,/<script|sha256:|name="reason"/u);
  assert.match(html,/<button[^>]*disabled=""[^>]*>suggestion.generate<\/button>/u);
  const stale=render({page:{...page,receipt:{...receipt,is_stale:true,stale_reasons:["evidence_unavailable"]}}});
  assert.match(stale,/<button[^>]*disabled=""[^>]*>suggestion.use<\/button>/u);
  assert.match(stale,/<button type="button" class="admin-button">suggestion.citations<\/button>/u);
  assert.match(render({page:{...page,receipt:null}}),/suggestion.empty/u);
});
test("routes and actual controller retain exact recovery, ignore late scope responses and use no fixture endpoint",async()=>{
  const base="../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/candidates/[candidateKey]/rule-suggestions/";
  const get=await readFile(new URL(`${base}route.ts`,import.meta.url),"utf8"),post=await readFile(new URL(`${base}[receiptId]/draft/route.ts`,import.meta.url),"utf8");
  assert.doesNotMatch(get,/export async function POST|receiveSimulated/u);assert.match(post,/body\.candidate_key!==candidateKey\|\|body\.receipt_id!==receiptId/u);
  assert.ok(post.indexOf('if("response"in loaded)')<post.indexOf("let body"));
  const ui=await readFile(new URL("../../components/brands/TopicCandidateRuleDraft.tsx",import.meta.url),"utf8");
  assert.match(ui,/startedEpoch!==epoch\.current/u);assert.match(ui,/operation\.scope!==scope/u);
  assert.ok(ui.indexOf("retainPending(url,operation)")<ui.indexOf("await requestTopicRuleSuggestionJson"));
  assert.ok(ui.indexOf("operation=topicRuleSuggestionPendingSchema.parse(input)")<ui.indexOf("retainPending(url,operation)"));
  assert.match(ui,/topicRuleSuggestionFormStale\(page,formBase\)/u);assert.match(ui,/pendingRef\.current&&readChecked&&!busy/u);
  assert.match(ui,/usedReceiptRef\.current=retained\.body\.receipt_id/u);
  assert.doesNotMatch(ui,/from ["'](?:@noisia\/db|@noisia\/query-engine|node:crypto)/u);
});
test("standard discovery, bilingual copy and executable OpenAPI cover exact closed suggestions",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../../../package.json",import.meta.url),"utf8"));
  assert.match(manifest.scripts.test,/signal-topic-rule-suggestion\.test\.ts/u);
  const copies=await Promise.all(["es-MX","en-US"].map(async locale=>JSON.parse(await readFile(
    new URL(`../../../messages/${locale}.json`,import.meta.url),"utf8")).AdminWorkspace.brandOs.fullEvidenceTopicCandidates.ruleDraft.suggestion));
  const keys=(value:Record<string,unknown>,prefix=""):string[]=>Object.entries(value).flatMap(([key,item])=>item&&typeof item==="object"
    ?keys(item as Record<string,unknown>,`${prefix}${key}.`):[`${prefix}${key}`]).sort();assert.deepEqual(keys(copies[0]),keys(copies[1]));
  const require=createRequire(import.meta.url),eslintRequire=createRequire(require.resolve("eslint")),Ajv=eslintRequire("ajv");
  const doc=eslintRequire("js-yaml").load(await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8"));
  for(const [name,value]of [["SignalTopicRuleSuggestionManagementV1",page],["SignalTopicRuleSuggestionCommandV1",command],
    ["SignalTopicRuleSuggestionBridgeV1",{link_id:id,receipt_id:id,action:"save",draft,idempotent_replay:false}]]as const){
    const validate=new Ajv({allErrors:true}).compile({$ref:`#/components/schemas/${name}`,components:doc.components});
    assert.equal(validate(value),true,JSON.stringify(validate.errors));assert.equal(validate({...value,private_context:"forged"}),false);}
  assert.equal(doc.paths["/api/data-os/signal/{workspaceId}/topic-evaluation/full-evidence/candidates/{candidateKey}/rule-suggestions"].post,undefined);
});
