import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopicCandidateEvidenceView } from "../../components/brands/TopicCandidateEvidence";
import { parseSignalTopicEvaluationV2CandidateEvidenceQuery } from "./signal-topic-evaluation-api";
import { appendSignalTopicEvaluationV2CandidateEvidencePage,
  parseSignalTopicEvaluationV2CandidateEvidencePage,requestSignalTopicEvaluationV2CandidateEvidence,
  type SignalTopicEvaluationV2CandidateEvidencePage } from "./signal-topic-evaluation-v2-management";

const digest=`sha256:${"6".repeat(64)}`;
const page:SignalTopicEvaluationV2CandidateEvidencePage={
  contract_version:"signal-topic-evaluation-v2-candidate-evidence-v1",run_key:"run.test",candidate_key:"candidate.test",
  collection:"candidate",status:"available",items:[{evidence_ref:digest,status:"available",
    excerpt:"<script>escaped evidence</script>",language:"en",market:"US",scope:"primary_brand",
    month:"2026-09",stratum:"central",source_digest:digest}],total:1,limit:20,next_cursor:null,
  topic_adoption:false,publication:false,serving:false};
const t=(key:string,values?:Record<string,string|number>)=>`${key}${values?JSON.stringify(values):""}`;
function render(overrides:Partial<Parameters<typeof TopicCandidateEvidenceView>[0]>={}){
  return renderToStaticMarkup(createElement(TopicCandidateEvidenceView,{collection:"candidate",page:null,
    loading:false,error:false,t,onLoad:()=>undefined,...overrides}));
}

test("citation query requires exact scope/collection and refuses duplicate, arbitrary or oversized navigation",()=>{
  const base="https://studio.invalid/evidence?run_key=run.test&collection=candidate";
  assert.deepEqual(parseSignalTopicEvaluationV2CandidateEvidenceQuery(base),{
    run_key:"run.test",collection:"candidate",limit:20,cursor:null});
  assert.equal(parseSignalTopicEvaluationV2CandidateEvidenceQuery(`${base}&limit=1&cursor=${"a".repeat(16)}`).limit,1);
  for(const suffix of["&limit=21","&limit=0","&limit=1.5","&limit=01","&collection=refinement",
    "&run_key=run.other","&workspace_id=other","&operation=search_cluster","&cursor=short"])
    assert.throws(()=>parseSignalTopicEvaluationV2CandidateEvidenceQuery(`${base}${suffix}`));
  for(const url of["https://studio.invalid/evidence?collection=candidate",
    "https://studio.invalid/evidence?run_key=run.test","https://studio.invalid/evidence?run_key=run.test&collection=all"])
    assert.throws(()=>parseSignalTopicEvaluationV2CandidateEvidenceQuery(url));
});

test("strict citation projection rejects private fields, forged availability and unbounded excerpts",()=>{
  assert.deepEqual(parseSignalTopicEvaluationV2CandidateEvidencePage(page),page);
  for(const extra of[{source_record_id:"private"},{url:"https://private.invalid"},{handle:"private"}])
    assert.throws(()=>parseSignalTopicEvaluationV2CandidateEvidencePage({...page,items:[{...page.items[0],...extra}]}));
  for(const invalid of[{...page,items:[{...page.items[0],excerpt:"x".repeat(601)}]},
    {...page,status:"none"},{...page,items:[page.items[0],page.items[0]],total:2},
    {...page,limit:21},{...page,total:0},{...page,provider_response:"private"}])
    assert.throws(()=>parseSignalTopicEvaluationV2CandidateEvidencePage(invalid));
});

test("lazy transport performs one exact no-store GET, propagates abort and rejects scope substitution",async()=>{
  const controller=new AbortController(),calls:Array<{url:string;init?:RequestInit}>=[];
  const args={endpoint:"/api/scoped/candidates",runKey:page.run_key,candidateKey:page.candidate_key,
    collection:"candidate" as const,signal:controller.signal};
  const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
    calls.push({url:String(input),init});return Response.json(page);};
  assert.equal(calls.length,0,"constructing the reader does not request anything");
  assert.deepEqual(await requestSignalTopicEvaluationV2CandidateEvidence(args,transport),page);
  assert.equal(calls.length,1);assert.ok(calls[0]);assert.equal(calls[0].url,
    "/api/scoped/candidates/candidate.test/evidence?run_key=run.test&collection=candidate&limit=20");
  assert.deepEqual(calls[0].init,{method:"GET",cache:"no-store",signal:controller.signal});
  for(const changed of[{run_key:"run.other"},{candidate_key:"candidate.other"},{collection:"refinement"}])
    await assert.rejects(requestSignalTopicEvaluationV2CandidateEvidence(args,
      async()=>Response.json({...page,...changed})),/scope_mismatch/u);
  await assert.rejects(requestSignalTopicEvaluationV2CandidateEvidence(args,
    async()=>Response.json({message:"private body"},{status:403})),/candidate_evidence_unavailable/u);
  controller.abort();
  await assert.rejects(requestSignalTopicEvaluationV2CandidateEvidence(args,async(_input,init)=>{
    init?.signal?.throwIfAborted();return Response.json(page);}),{name:"AbortError"});
});

test("candidate/refinement citation sections keep states distinct and escape excerpts without links or IDs",()=>{
  const initial=render();assert.match(initial,/citations\.candidate\.title/u);assert.match(initial,/citations\.load/u);
  assert.doesNotMatch(initial,/<blockquote/u);
  const available=render({page});assert.match(available,/&lt;script&gt;escaped evidence&lt;\/script&gt;/u);
  assert.doesNotMatch(available,/<script|<a\s|sha256:|source_record/u);
  assert.match(available,/citations\.metadata/u);
  assert.match(render({collection:"refinement",page:{...page,collection:"refinement"}}),/citations\.refinement\.title/u);
  assert.match(render({loading:true}),/aria-busy="true" role="status"/u);
  assert.match(render({error:true}),/role="alert"/u);
  for(const status of["none","unavailable"]as const)assert.match(render({page:{...page,status,
    items:[],total:0}}),new RegExp(`citations\\.${status}`,"u"));
  for(const reason of["rights_changed","source_changed","reference_unavailable"]as const){
    const unavailable=render({page:{...page,items:[{status:"unavailable",evidence_ref:digest,reason}]}});
    assert.match(unavailable,new RegExp(`citations\\.reasons\\.${reason}`,"u"));
    assert.doesNotMatch(unavailable,/<blockquote/u);
  }
  assert.match(render({page:{...page,total:2,next_cursor:"x".repeat(16)}}),/citations\.more/u);
});

test("a rights denial on page two changes only that exact reference, preserving other checked excerpts",()=>{
  const denied={evidence_ref:`sha256:${"7".repeat(64)}`,status:"unavailable" as const,reason:"rights_changed" as const};
  const next={...page,items:[denied],total:2};
  const merged=appendSignalTopicEvaluationV2CandidateEvidencePage({...page,total:2},next);
  assert.deepEqual(merged.items,[page.items[0],denied]);
  const markup=render({page:merged});
  assert.match(markup,/escaped evidence/u);assert.match(markup,/citations\.reasons\.rights_changed/u);
  assert.equal((markup.match(/<blockquote>/gu)??[]).length,1);
  assert.deepEqual(appendSignalTopicEvaluationV2CandidateEvidencePage(page,{...page,status:"unavailable",
    items:[],total:0}).items,[]);
  assert.throws(()=>appendSignalTopicEvaluationV2CandidateEvidencePage(page,{...next,candidate_key:"candidate.other"}),/scope_mismatch/u);
});

test("route guards first, uses closed DTO; UI cancels discarded requests and keeps legacy history non-launchable",async()=>{
  const [route,component,manager,panels,legacy,es,en,manifest,openapi]=await Promise.all([
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/candidates/[candidateKey]/evidence/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../components/brands/TopicCandidateEvidence.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../components/brands/FullEvidenceTopicCandidateManager.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../components/brands/BrandTopicEvaluationPanels.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../components/brands/TopicEvaluationManager.tsx",import.meta.url),"utf8"),
    readFile(new URL("../../../messages/es-MX.json",import.meta.url),"utf8"),
    readFile(new URL("../../../messages/en-US.json",import.meta.url),"utf8"),
    readFile(new URL("../../../package.json",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  assert.ok(route.indexOf('if("response" in loaded)')<route.indexOf("let query"));
  assert.match(route,/actor:loaded\.session\.appUser/u);assert.match(route,/parseSignalTopicEvaluationV2CandidateEvidencePage/u);
  assert.doesNotMatch(route,/POST|INSERT|UPDATE|DELETE|enqueue/u);
  assert.match(component,/useEffect\(\(\)=>\(\)=>requestRef\.current\?\.abort\(\),\[\]\)/u);
  assert.match(component,/if\(controller\.signal\.aborted\)return/u);
  assert.match(component,/if\(requestRef\.current\)return/u);
  assert.match(manager,/candidate\.base_model_payload\.explanation/u);
  assert.match(manager,/collection="candidate"/u);assert.match(manager,/collection="refinement"/u);
  assert.match(panels,/<details className=/u);assert.doesNotMatch(panels,/<details[^>]+open/u);
  assert.match(panels,/<TopicEvaluationManager workspaceId=\{workspaceId\} readOnly\/>/u);
  assert.match(panels,/readOnly=\{imported===null\}/u);
  assert.match(legacy,/const commandDisabled=readOnly\|\|/u);
  assert.match(legacy,/if\(readOnly\|\|!selected\|\|submitting\)return/u);
  assert.match(manifest,/signal-topic-candidate-evidence-ui\.test\.ts/u);
  const esMessages=JSON.parse(es).AdminWorkspace.brandOs,enMessages=JSON.parse(en).AdminWorkspace.brandOs;
  assert.deepEqual(Object.keys(esMessages.fullEvidenceTopicCandidates.citations).sort(),
    Object.keys(enMessages.fullEvidenceTopicCandidates.citations).sort());
  assert.ok(esMessages.topicEvaluation.historical.body);assert.ok(enMessages.topicEvaluation.historical.body);
  const require=createRequire(import.meta.url),requireEslint=createRequire(require.resolve("eslint"));
  const document=requireEslint("js-yaml").load(openapi),Ajv=requireEslint("ajv");
  const validate=new Ajv({allErrors:true}).compile({$ref:"#/components/schemas/SignalTopicEvaluationV2CandidateEvidencePage",
    components:document.components});
  assert.equal(validate(page),true,JSON.stringify(validate.errors));
  assert.equal(validate({...page,status:"none"}),false);
  assert.equal(validate({...page,items:[{...page.items[0],url:"private"}]}),false);
  assert.equal(validate({...page,items:[{status:"unavailable",evidence_ref:digest,reason:"rights_changed"}]}),true);
});
