import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { TopicRuleCohortManagerView } from "../../components/brands/TopicRuleCohortManager";
import * as management from "./signal-topic-rule-cohort-management";
import * as api from "./signal-topic-rule-cohort-api";
import * as individualManagement from "./signal-topic-rule-draft-management";
import { topicRuleIdempotencyKey } from "./signal-topic-rule-draft-api";

// Synthetic two-candidate contract fixture, not a claim about saved UAT rules or measured relevance.
const hash=`sha256:${"a".repeat(64)}`,changedHash=`sha256:${"b".repeat(64)}`;
const id=(digit:number)=>`${String(digit).repeat(8)}-${String(digit).repeat(4)}-4${String(digit).repeat(3)}-8${String(digit).repeat(3)}-${String(digit).repeat(12)}`;
const workspace=id(1),runKey="run.fixture",timestamp="2026-09-06T12:00:00.000Z";
const sources:management.TopicCohortSource[]=["football","campaign"].map((label,index)=>({candidate_key:`candidate.${label}`,
  title:`${label} experience`,description:`Saved ${label} definition`,inclusion:[label],exclusion:[],revision:1,state_token:hash,
  review_state:"pending",draft:{draft_id:id(index+2),revision:1,draft_digest:hash,spec_digest:hash,is_stale:false},eligibility:"eligible"}));
const selections=sources.map(source=>management.cohortSelectionFromSource(source)!);
const store:management.TopicCohortStore={contract_version:"signal-topic-rule-cohort-store-v1",cohort_id:id(4),cohort_revision:1,
  cohort_digest:hash,profile_id:id(5),profile_version:8,binding:{workspace_id:workspace,run_key:runKey,run_id:id(6),snapshot_id:id(7),
    snapshot_digest:hash,population_digest:hash,rights_digest:hash,semantic_context_authority_digest:hash,artifact_binding_digest:hash,
    cohort_revision:1,predecessor_digest:null,rules:sources.map((source,index)=>({candidate_id:id(index+8),candidate_key:source.candidate_key,
      candidate_revision:1,candidate_version_digest:hash,candidate_state_token:hash,draft_id:source.draft!.draft_id,
      draft_revision:1,draft_digest:hash,spec_digest:hash,rule_spec:{contract_version:"signal-topic-rule-spec-v1",kind:"topic",
        label:source.title,definition:source.description,lexical:{any:[source.inclusion[0]!],all:[],not:[]},
        filters:{languages:[],markets:[],scopes:[]}}}))},created_at:timestamp,is_stale:false,stale_reasons:[],is_latest:true,idempotent_replay:false};
const trial:management.TopicCohortTrial={contract_version:"signal-topic-rule-cohort-trial-v1",cohort_id:store.cohort_id,cohort_revision:1,
  cohort_digest:hash,profile_id:store.profile_id,profile_version:8,compiler_version:"signal-topic-rule-cohort-simple-fts-v1",plan_hash:hash,
  rule_plans:sources.map(source=>({candidate_key:source.candidate_key,spec_digest:hash,plan_hash:hash,compiler_version:"signal-topic-rule-simple-fts-v1"})),
  snapshot_digest:hash,population_digest:hash,considered_digest:hash,population_kind:"frozen_snapshot_memberships",
  counts:{total:21195,considered:21195,not_tested:0,unavailable:0,excluded_by_all_filters:16074,abstained:4604,
    single_match:509,multiple_match:8,covered:517},per_rule:[{candidate_key:sources[0]!.candidate_key,matched:517,exclusive:509,shared:8},
    {candidate_key:sources[1]!.candidate_key,matched:8,exclusive:0,shared:8}],
  pairs:[{left_candidate_key:sources[0]!.candidate_key,right_candidate_key:sources[1]!.candidate_key,intersection:8}],
  max_memberships:25000,example_limit:10,timeout_ms:15000,
  examples:[{evidence_ref:hash,outcome:"multiple_match",matched_candidate_keys:sources.map(source=>source.candidate_key),
    excerpt:"<script>Human evidence</script>",language:"es",market:"MX",scope:"primary_brand",month:"2026-09"}],
  topic_adoption:false,publication:false,serving:false,trial_id:id(6),created_at:timestamp,is_stale:false,stale_reasons:[],
  is_latest_cohort:true,idempotent_replay:false,example_availability:{stored:2,available:1,unavailable:1}};
const page:management.TopicCohortPage={contract_version:"signal-topic-rule-cohort-management-v1",run_key:runKey,
  sources:{contract_version:"signal-topic-rule-cohort-sources-v1",run_key:runKey,snapshot_digest:hash,total:2,limit:20,items:sources,
    selected:sources,missing_selected_candidate_keys:[],next_cursor:null},cohort:store,trial};
const save={run_key:runKey,expected_cohort_revision:0,expected_cohort_digest:null,sources:selections};
const testRequest={run_key:runKey,expected_cohort_revision:1,expected_cohort_digest:hash,max_memberships:25000,example_limit:10,timeout_ms:15000};
const context={workspace:{id:workspace},actor:{id:id(2),userType:"noisia_internal"},runKey};

test("closed request contracts reject duplicate selection, injected fields and stale-shaped CAS",()=>{
  assert.deepEqual(management.topicCohortSaveSchema.parse(save),save);
  assert.deepEqual(management.topicCohortTrialRequestSchema.parse(testRequest),testRequest);
  for(const extra of["rule_spec","actor","workspace_id","profile_id","sql","rationale","reason","confirmation","provider"])
    assert.throws(()=>management.topicCohortSaveSchema.parse({...save,[extra]:"extra"}));
  for(const sources of[[],[selections[0]],Array(16).fill(selections[0]),[selections[0],selections[0]],
    [selections[0],{...selections[1],draft_id:selections[0]!.draft_id}],
    [{...selections[0],sql:"SELECT private"},selections[1]]])assert.throws(()=>management.topicCohortSaveSchema.parse({...save,sources}));
  for(const change of[{expected_cohort_revision:1},{expected_cohort_digest:hash},{expected_cohort_revision:-1}])
    assert.throws(()=>management.topicCohortSaveSchema.parse({...save,...change}));
  for(const change of[{max_memberships:50001},{max_memberships:0},{example_limit:11},{timeout_ms:15001},
    {expected_cohort_revision:0},{expected_cohort_digest:null},{cohort_id:id(4)}])
    assert.throws(()=>management.topicCohortTrialRequestSchema.parse({...testRequest,...change}));
});
test("GET query is exact-run, bounded, duplicate-free and has no hidden routing overrides",()=>{
  assert.deepEqual(api.parseTopicCohortQuery("https://local.invalid?selected_candidate_key=candidate.a",runKey),
    {limit:20,cursor:null,selected_candidate_keys:["candidate.a"]});
  for(const query of["run_key=run.other","workspace_id=private","limit=21","limit=1&limit=2","limit=1.0",
    "cursor=","cursor=a&cursor=b","selected_candidate_key=candidate.a&selected_candidate_key=candidate.a",
    Array.from({length:16},(_,i)=>`selected_candidate_key=candidate.${i}`).join("&")])
    assert.throws(()=>api.parseTopicCohortQuery(`https://local.invalid?${query}`,runKey));
  assert.throws(()=>api.parseTopicCohortQuery("https://local.invalid","short"));
});
test("full receipt projection enforces partitions, shared counts, exact scope and total examples",()=>{
  assert.deepEqual(management.topicCohortPageSchema.parse(page),page);
  for(const change of[{counts:{...trial.counts,covered:525}},{counts:{...trial.counts,not_tested:1}},
    {per_rule:[{...trial.per_rule[0],shared:9},trial.per_rule[1]]},{pairs:[]},
    {examples:[{...trial.examples[0],raw_url:"private"}]},
    {example_availability:{stored:2,available:2,unavailable:0}},{serving:true},
    {examples:[{...trial.examples[0],matched_candidate_keys:["candidate.foreign"]}]}])
    assert.throws(()=>management.topicCohortTrialSchema.parse({...trial,...change}));
  for(const change of[{sources:{...page.sources,run_key:"run.other"}},{cohort:null},
    {trial:{...trial,cohort_digest:changedHash}},{cohort:{...store,is_latest:false}}])
    assert.throws(()=>management.topicCohortPageSchema.parse({...page,...change}));
  assert.equal(management.topicCohortPageSchema.parse({...page,trial:null}).trial,null);
  assert.equal(management.topicCohortPageSchema.parse({...page,cohort:null,trial:null}).cohort,null);
});
test("refresh does not rewrite retained CAS; only eligible current selections can be adopted explicitly",()=>{
  const selected=structuredClone(selections),changed={...sources[0]!,revision:2,state_token:changedHash,
    draft:{...sources[0]!.draft!,revision:2,draft_digest:changedHash}};
  assert.equal(management.cohortSelectionIsCurrent(selected[0]!,changed),false);
  assert.deepEqual(selected,selections);assert.equal(management.cohortSelectionIsCurrent(selected[0]!,undefined),false);
  for(const source of[{...sources[0]!,eligibility:"rejected"as const,review_state:"rejected"as const},
    {...sources[0]!,eligibility:"missing_draft"as const,draft:null}])assert.equal(management.cohortSelectionFromSource(source),null);
  assert.equal(management.cohortSelectionIsCurrent(management.cohortSelectionFromSource(changed)!,changed),true);
  assert.equal(management.cohortSelectionEqual(selections,[...selections].reverse()),true);
  assert.deepEqual(management.cohortSelectionFromStore(store),selections);
});
test("GET validates selected refresh completeness; unknown GET never provides terminal mutation evidence",async()=>{
  const calls:RequestInit[]=[],keys=sources.map(source=>source.candidate_key);
  const loaded=await management.loadTopicCohortPage("/cohort",workspace,runKey,keys,null,undefined,
    async(url,init)=>{calls.push(init!);assert.match(String(url),/selected_candidate_key=candidate.football/u);return Response.json(page);});
  assert.equal(loaded.trial?.counts.covered,517);assert.equal(calls[0]?.cache,"no-store");assert.equal(calls[0]?.method,"GET");
  for(const result of[{...page,run_key:"run.other"},{...page,sources:{...page.sources,selected:[sources[0]]}},
    {...page,cohort:{...store,binding:{...store.binding,workspace_id:id(2)}}}])
    await assert.rejects(management.loadTopicCohortPage("/cohort",workspace,runKey,keys,null,undefined,async()=>Response.json(result)));
  await assert.rejects(management.loadTopicCohortPage("/cohort",workspace,runKey,keys,null,undefined,
    async()=>new Response("<html>expired session</html>")));
});
test("known 403 auth denial is terminal; network, HTML, unknown codes and invalid successful DTO remain ambiguous",async()=>{
  await assert.rejects(management.requestTopicCohortJson("/trial",{method:"POST"},async()=>
    Response.json({error:"forbidden",message:"private diagnostic"},{status:403})),
  (error:unknown)=>error instanceof management.TopicCohortRequestError&&!error.ambiguous&&error.code==="topic_rule_cohort_forbidden");
  for(const transport of[async()=>{throw new Error("reset");},async()=>new Response("<html>unknown</html>"),
    async()=>Response.json({error:"private"},{status:409}),async()=>Response.json({error:"topic_rule_cohort_operation_failed"},{status:500})])
    await assert.rejects(management.requestTopicCohortJson("/trial",{method:"POST"},transport),
      (error:unknown)=>error instanceof management.TopicCohortRequestError&&error.ambiguous);
  const operation:management.TopicCohortPending={kind:"save",key:"topic-cohort:original-key",body:save};
  assert.deepEqual(management.parseTopicCohortMutationResult(store,operation,workspace),store);
  for(const value of[{...store,private_sql:"private"},{...store,cohort_revision:2},
    {...store,binding:{...store.binding,run_key:"run.other"}},null])assert.throws(()=>management.parseTopicCohortMutationResult(value,operation,workspace));
  assert.deepEqual(management.topicCohortPendingSchema.parse(JSON.parse(JSON.stringify(operation))),operation);
  assert.deepEqual(management.parseTopicCohortMutationResult(trial,{kind:"trial",key:"trial-original",body:testRequest},workspace),trial);
});
test("safe error adapter never forwards SQL, arbitrary status, or unknown diagnostics",async()=>{
  for(const [input,code,status]of[["57014","topic_rule_cohort_trial_timeout",409],["42P01","topic_rule_cohort_schema_unavailable",503],
    ["40001","topic_rule_cohort_stale",409],["topic_evaluation_v2_candidate_not_found","topic_rule_cohort_run_not_found",404],
    ["topic_rule_draft_forbidden","topic_rule_cohort_forbidden",403],["private_code","topic_rule_cohort_operation_failed",500]]as const){
    const response=api.topicCohortError({code:input,status:200,message:"private SQL"});
    assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:code});
    assert.equal(response.headers.get("Cache-Control"),"private, no-store");}
});

async function evaluate(relative:string,modules:Record<string,unknown>){
  const source=await readFile(new URL(relative,import.meta.url),"utf8"),exports:Record<string,unknown>={};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function("require","exports",compiled)((name:string)=>{if(name in modules)return modules[name];throw new Error(`Unexpected module ${name}`);},exports);
  return exports;
}
async function productHarness(overrides:Record<string,unknown>={},failure?:"constraints"|"commit"){
  const log:string[]=[];
  const client={query:async(sql:string)=>{log.push(sql);if((failure==="commit"&&sql==="COMMIT")
    ||(failure==="constraints"&&sql==="SET CONSTRAINTS ALL IMMEDIATE"))throw new Error("private failure");return{rows:[]};},release:()=>log.push("RELEASE")};
  const pool={connect:async()=>{log.push("CONNECT");return client;}};
  const transaction=await evaluate("./signal-topic-rule-draft-product.ts",{"@noisia/db":{},"@/lib/db":{pool},
    "./signal-topic-rule-draft-management":individualManagement});
  const db={loadSignalTopicRuleCohortSourcesV1:async()=>{log.push("SOURCES");return page.sources;},
    loadSignalTopicRuleCohortV1:async()=>{log.push("CATALOG");return store;},
    loadSignalTopicRuleCohortLatestTrialV1:async()=>{log.push("LATEST_TRIAL");return trial;},
    createSignalTopicRuleCohortV1:async()=>{log.push("SAVE");return store;},runSignalTopicRuleCohortTrialV1:async()=>{log.push("TRIAL");return trial;},...overrides};
  const product=await evaluate("./signal-topic-rule-cohort-product.ts",{"@noisia/db":db,"@/lib/db":{pool},
    "./signal-topic-rule-draft-product":transaction,"./signal-topic-rule-cohort-management":management});
  return{product:product as typeof import("./signal-topic-rule-cohort-product"),log};
}
test("product wrapper uses one coherent read transaction and validates write DTO plus constraints before commit",async()=>{
  const read=await productHarness();await read.product.loadTopicCohortProduct({...context,query:{limit:20,cursor:null,selected_candidate_keys:[]}}as never);
  assert.deepEqual(read.log,["CONNECT","BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","SOURCES","CATALOG","LATEST_TRIAL","COMMIT","RELEASE"]);
  const write=await productHarness();await write.product.saveTopicCohortProduct({...context,request:save,idempotencyKey:"valid-key"}as never);
  assert.deepEqual(write.log,["CONNECT","BEGIN ISOLATION LEVEL SERIALIZABLE","SAVE","SET CONSTRAINTS ALL IMMEDIATE","COMMIT","RELEASE"]);
  for(const overrides of[{createSignalTopicRuleCohortV1:async()=>({...store,private_sql:"private"})},
    {createSignalTopicRuleCohortV1:async()=>({...store,binding:{...store.binding,run_key:"run.other"}})}]){
    const failed=await productHarness(overrides);await assert.rejects(failed.product.saveTopicCohortProduct({...context,request:save,idempotencyKey:"valid-key"}as never));
    assert.ok(!failed.log.includes("COMMIT"));assert.deepEqual(failed.log.slice(-2),["ROLLBACK","RELEASE"]);}
  for(const failure of["constraints","commit"]as const){const failed=await productHarness({},failure);
    await assert.rejects(failed.product.testTopicCohortProduct({...context,request:testRequest,idempotencyKey:"valid-key"}as never));
    assert.deepEqual(failed.log.slice(-2),["ROLLBACK","RELEASE"]);}
});
test("product scope and actor rejection happen before connection; replay remains the same core request",async()=>{
  for(const change of[{runKey:"run.other"},{actor:{id:id(2),userType:"client"}}]){
    const check=await productHarness();await assert.rejects(check.product.saveTopicCohortProduct({...context,...change,request:save,idempotencyKey:"valid-key"}as never));
    assert.deepEqual(check.log,[]);}
  let retained:unknown;const replay=await productHarness({runSignalTopicRuleCohortTrialV1:async(args:unknown)=>{retained=args;return{...trial,idempotent_replay:true};}});
  const result=await replay.product.testTopicCohortProduct({...context,request:testRequest,idempotencyKey:"original-key"}as never);
  assert.equal(result.idempotent_replay,true);assert.equal((retained as {idempotency_key:string}).idempotency_key,"original-key");
});
test("actual route handlers bind path run before writer, authenticate before parsing, and reject injected bodies",async()=>{
  for(const isTrial of[false,true]){
    const calls:string[]=[],path=`../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/cohorts/[runKey]/${isTrial?"trial/":""}route.ts`;
    const modules={
      [isTrial?"../../../../../semantic-context/_lib":"../../../../semantic-context/_lib"]:{loadSignalWorkspaceContextForSemanticContextManagement:async()=>{calls.push("AUTH");return{workspace:{id:workspace},session:{appUser:context.actor}};}},
      "@/lib/data-os/signal-topic-rule-draft-api":{topicRuleIdempotencyKey},"@/lib/data-os/signal-topic-rule-cohort-api":api,
      "@/lib/data-os/signal-topic-rule-cohort-management":management,
      "@/lib/data-os/signal-topic-rule-cohort-product":{saveTopicCohortProduct:async()=>{calls.push("WRITE");return store;},
        testTopicCohortProduct:async()=>{calls.push("WRITE");return trial;}}};
    const route=await evaluate(path,modules)as {POST:(request:Request,ctx:unknown)=>Promise<Response>};
    const post=(body:unknown,run=runKey)=>route.POST(new Request("https://local.invalid",{method:"POST",headers:{"Idempotency-Key":"valid-key","Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({workspaceId:workspace,runKey:run})});
    assert.equal((await post(isTrial?testRequest:save,"run.other")).status,422);assert.deepEqual(calls,["AUTH"]);
    assert.equal((await post({...isTrial?testRequest:save,actor:"private"})).status,422);assert.ok(!calls.includes("WRITE"));
    assert.equal((await post(isTrial?testRequest:save)).status,200);assert.equal(calls.at(-1),"WRITE");
  }
});

const translate=(key:string,values?:Record<string,string|number>)=>`${key}${values?JSON.stringify(values):""}`;
function render(overrides:Partial<Parameters<typeof TopicRuleCohortManagerView>[0]>={}){return renderToStaticMarkup(createElement(TopicRuleCohortManagerView,
  {page,rows:sources,current:Object.fromEntries(sources.map(source=>[source.candidate_key,source])),selected:selections,t:translate,locale:"en-US",
    loading:false,busy:false,blocked:false,valid:true,dirty:false,sourceChanged:false,familyChanged:false,error:null,pending:false,readChecked:true,success:null,
    onToggle:()=>undefined,onRemove:()=>undefined,onOpenCandidate:()=>undefined,onSave:()=>undefined,onTrial:()=>undefined,onReconcile:()=>undefined,
    onRefresh:()=>undefined,onMore:()=>undefined,onRecover:()=>undefined,...overrides}));}
test("view keeps real denominators and safe bounded evidence; stale, dirty, pending and unknown states disable mutation",()=>{
  const html=render();assert.match(html,/21,195/u);assert.match(html,/517/u);assert.match(html,/counts.not_tested/u);
  assert.match(html,/&lt;script&gt;Human evidence&lt;\/script&gt;/u);assert.doesNotMatch(html,/<script|<a\s|sha256:|name="(?:reason|rationale|confirmation)"/u);
  assert.match(html,/<input[^>]+type="checkbox"[^>]*\/><button/u,"checkbox is a sibling of the editor button");
  for(const change of[{dirty:true},{blocked:true},{valid:false},{page:{...page,cohort:{...store,is_stale:true}}}])
    assert.match(render(change),/<button[^>]+disabled=""[^>]*>actions.trial<\/button>/u);
  assert.match(render({page:{...page,trial:null}}),/untested/u);assert.match(render({page:null,error:"topic_rule_cohort_operation_failed",blocked:true}),/operation_failed/u);
  assert.match(render({pending:true,blocked:true,readChecked:false}),/<button[^>]+disabled=""[^>]*>actions.recover<\/button>/u);
  assert.match(render({sourceChanged:true,valid:false}),/actions.reconcile/u);assert.match(render({loading:true}),/aria-busy="true"/u);
});
test("stale results retain their measured labels and unready replacement has explicit non-noop guidance",()=>{
  const changed={...sources[0]!,title:"New editorial name",revision:2,draft:{...sources[0]!.draft!,is_stale:true},eligibility:"stale_draft"as const};
  const current=Object.fromEntries([changed,sources[1]!].map(source=>[source.candidate_key,source]));
  const html=render({current,sourceChanged:true,valid:false,page:{...page,cohort:{...store,is_stale:true},trial:{...trial,is_stale:true}}});
  const measured=html.slice(html.indexOf('class="topic-cohort-manager__results"'));
  assert.doesNotMatch(measured,/New editorial name/u);assert.match(measured,/football experience/u);
  assert.match(html,/needsRuleSave/u);assert.match(html,/<button[^>]+disabled=""[^>]*>actions.reconcile<\/button>/u);
});
test("controller retains exact pending request across scope-safe remounts and gates recovery on successful read",async()=>{
  const source=await readFile(new URL("../../components/brands/TopicRuleCohortManager.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/from ["'](?:@noisia\/query-engine|@noisia\/db|node:crypto)/u);
  assert.match(source,/key=\{`\$\{props.workspaceId\}:\$\{props.runKey\}`\}/u);
  assert.ok(source.indexOf("retain(url,operation)")<source.indexOf("await requestTopicCohortJson"));
  assert.ok(source.indexOf("parseTopicCohortMutationResult(value,operation,workspaceId)")<source.indexOf("retain(url,null)"));
  assert.match(source,/if\(!mounted.current\)return;/u);assert.match(source,/controller.signal.aborted\|\|!mounted.current/u);
  assert.match(source,/readChecked&&pendingRef.current\)void submit\(pendingRef.current\)/u);
  assert.match(source,/sessionStorage.getItem/u);assert.match(source,/max_memberships:25000,example_limit:10,timeout_ms:15000/u);
  assert.ok(source.indexOf("const originalBaseline=")<source.indexOf("const original=cohortSelectionFromStore(next.cohort)"));
  assert.match(source,/setBaseline\(originalBaseline\)/u);
  const parent=await readFile(new URL("../../components/brands/FullEvidenceTopicCandidateManager.tsx",import.meta.url),"utf8");
  assert.match(parent,/onRuleSaved=\{refreshCohort\}/u);assert.match(parent,/setDetail\(null\);refreshCohort\(\)/u);
  assert.match(parent,/TopicCandidateEvidence/u);assert.match(parent,/WorkspaceDrawer/u);
});
test("standard inclusion and bilingual copy cover all safe errors",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../../../package.json",import.meta.url),"utf8"));
  assert.match(manifest.scripts.test,/signal-topic-rule-cohort.test.ts/u);
  const copies=await Promise.all(["es-MX","en-US"].map(async locale=>JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`,import.meta.url),"utf8"))
    .AdminWorkspace.brandOs.fullEvidenceTopicCandidates.cohort));
  const keys=(object:Record<string,unknown>,prefix=""):string[]=>Object.entries(object).flatMap(([key,value])=>
    value&&typeof value==="object"?keys(value as Record<string,unknown>,`${prefix}${key}.`):[`${prefix}${key}`]).sort();
  assert.deepEqual(keys(copies[0]),keys(copies[1]));for(const code of management.topicCohortSafeErrors)assert.equal(typeof copies[0].errors[code],"string");
  const require=createRequire(import.meta.url),eslintRequire=createRequire(require.resolve("eslint"));
  const doc=eslintRequire("js-yaml").load(await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8"));
  const base="/api/data-os/signal/{workspaceId}/topic-evaluation/full-evidence/cohorts/{runKey}";
  assert.ok(doc.paths[base]?.get);assert.ok(doc.paths[base]?.post);assert.ok(doc.paths[`${base}/trial`]?.post);
  const Ajv=eslintRequire("ajv");
  for(const [name,value]of[["SignalTopicRuleCohortManagementV1",page],["SignalTopicRuleCohortSaveV1",save],
    ["SignalTopicRuleCohortTrialRequestV1",testRequest],["SignalTopicRuleCohortTrialV1",trial]]as const){
    const validate=new Ajv({allErrors:true}).compile({$ref:`#/components/schemas/${name}`,components:doc.components});
    assert.equal(validate(value),true,`${name}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({...value,provider:"forbidden"}),false);
  }
  const header=doc.components.parameters.TopicRuleIdempotencyKey;
  assert.equal(header.required,true);assert.equal(header.in,"header");
  const validateKey=new Ajv().compile(header.schema);
  for(const value of["valid-key","a".repeat(200)])assert.equal(validateKey(value),true);
  for(const value of["short","a".repeat(201),"invalid key"])assert.equal(validateKey(value),false);
});
test("OpenAPI rejects the same empty/oversized source phrases and unknown compiler versions as runtime",async()=>{
  const require=createRequire(import.meta.url),eslintRequire=createRequire(require.resolve("eslint"));
  const doc=eslintRequire("js-yaml").load(await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8"));
  const Ajv=eslintRequire("ajv"),compile=(name:string)=>new Ajv({allErrors:true}).compile({
    $ref:`#/components/schemas/${name}`,components:doc.components});
  const validateSource=compile("SignalTopicRuleCohortSourceV1"),validateTrial=compile("SignalTopicRuleCohortTrialV1");
  const cases:Array<{change:Partial<management.TopicCohortSource>;valid:boolean}>=[
    {change:{inclusion:[]},valid:false},{change:{inclusion:[""]},valid:false},{change:{exclusion:[""]},valid:false},
    {change:{inclusion:["x".repeat(241)]},valid:false},{change:{exclusion:["x".repeat(241)]},valid:false},
    {change:{inclusion:["x".repeat(240)],exclusion:["x".repeat(240)]},valid:true},{change:{exclusion:[]},valid:true}];
  for(const {change,valid}of cases){const source={...sources[0]!,...change};
    assert.equal(validateSource(source),valid,JSON.stringify(change));
    assert.equal(management.topicCohortSourcesSchema.safeParse({...page.sources,items:[source],selected:[]}).success,valid);
  }
  assert.equal(validateTrial(trial),true,JSON.stringify(validateTrial.errors));
  for(const compiler of["", "unknown-version", "signal-topic-rule-simple-fts-v1",null]){
    const changed={...trial,compiler_version:compiler};assert.equal(validateTrial(changed),false);
    assert.equal(management.topicCohortTrialSchema.safeParse(changed).success,false);
  }
  for(const compiler of["", "unknown-version", "signal-topic-rule-cohort-simple-fts-v1",null]){
    const changed={...trial,rule_plans:[{...trial.rule_plans[0]!,compiler_version:compiler},trial.rule_plans[1]!]};
    assert.equal(validateTrial(changed),false);assert.equal(management.topicCohortTrialSchema.safeParse(changed).success,false);
  }
});
