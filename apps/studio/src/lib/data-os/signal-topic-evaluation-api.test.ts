import assert from "node:assert/strict";import { readFile } from "node:fs/promises";import test from "node:test";
import { createRequire } from "node:module";
import { navigateSignalTopicEvaluationEvidenceV2 } from "../../../../../infrastructure/db/signal-topic-evaluation-v2";
import { parseSignalTopicEvaluationCandidateCommandV1,parseSignalTopicEvaluationStartRequestV1,
  parseSignalTopicEvaluationSuccessorStartRequestV1 } from "./signal-topic-evaluation-api";
import { parseSignalTopicEvidenceNavigationRequestV2,signalTopicEvaluationFlightCardV2,
  signalTopicEvidenceNavigationResultV2 }
  from "@noisia/query-engine";

test("actual compact catalog validates in runtime and OpenAPI; forged result fails before Studio",async()=>{
  const digest=`sha256:${"1".repeat(64)}`;
  let catalogRow:Record<string,unknown>={cluster_key:"cluster.1",proposal_key:"proposal.1",
    member_count:12,profile_digest:digest};
  const statements:string[]=[];
  const queryable={query:async<T>(sql:string)=>{statements.push(sql);
    if(sql.includes("SELECT snapshot.id"))return{rowCount:1,rows:[{id:"snapshot",workspace_id:"workspace",
      snapshot_key:"snapshot",snapshot_digest:digest,rights_digest:digest,cluster_count:116,
      membership_count:21195,semantic_context_authority_digest:digest}] as T[]};
    assert.match(sql,/SELECT cluster_key,proposal_key,member_count,profile_digest\s+FROM/u);
    return{rowCount:1,rows:[catalogRow] as T[]};}};
  const args={queryable,workspace_id:"workspace",actor:{id:"actor",user_type:"noisia_internal" as const},
    request:{operation:"cluster_catalog",limit:5,cursor:null}};
  const result=await navigateSignalTopicEvaluationEvidenceV2(args);
  assert.deepEqual(result.data,{clusters:[catalogRow],total_clusters:116});
  assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(result).success,true);
  const require=createRequire(import.meta.url);
  const requireEslint=createRequire(require.resolve("eslint"));
  const {load}=requireEslint("js-yaml");const Ajv=requireEslint("ajv");
  const openapi=load(await readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8"));
  const validate=new Ajv({allErrors:true}).compile({$ref:"#/components/schemas/SignalTopicEvidenceNavigationResultV2",
    components:openapi.components});
  assert.equal(validate(result),true,JSON.stringify(validate.errors));
  assert.equal(validate({...result,operation:"cluster_profile"}),false);
  assert.equal(validate({...result,data:{...result.data,total_clusters:undefined}}),false);
  const profile={...catalogRow,profile:{label:"Cluster",terms:[],phrases:[],limitations:[],
    distributions:{language:{en:12},market:{US:12},scope:{category:12},month:{"2026-01":12}},
    centrality_available:true}};
  const mentions={cluster_key:"cluster.1",mentions:[{evidence_ref:digest,excerpt:"Sanitized excerpt",
    language:"en",market:"US",scope:"category",month:"2026-01",stratum:"central",source_digest:digest}],
    sampling_limit:"Bounded by metadata."};
  const dataByOperation={cluster_catalog:result.data,cluster_profile:profile,
    compare_clusters:{clusters:[profile,{...profile,cluster_key:"cluster.2"}]},
    representative_mentions:{...mentions,sampling_guarantee:"deterministic_round_robin_across_observed_strata"},
    search_cluster:{...mentions,sampling_guarantee:"stable_cluster_rank"},brand_os_context:{elements:[{
      element_key:"identity.example",element_kind:"brand_identity",display_text:"Example",scope:"workspace",
      locale:null,source_refs_digest:digest,evidence_count:1}]}};
  for(const[operation,data]of Object.entries(dataByOperation)){
    assert.equal(validate({...result,operation,data}),true,`${operation}: ${JSON.stringify(validate.errors)}`);
    assert.equal(signalTopicEvidenceNavigationResultV2.safeParse({...result,operation,data}).success,true);
    for(const[other,foreignData]of Object.entries(dataByOperation))if(other!==operation){
      const forged={...result,operation,data:foreignData};
      assert.equal(validate(forged),false,`${operation} must reject ${other}`);
      assert.equal(signalTopicEvidenceNavigationResultV2.safeParse(forged).success,false);
    }
  }
  catalogRow={...catalogRow,profile:{private_payload:"must not escape"}};
  await assert.rejects(navigateSignalTopicEvaluationEvidenceV2(args),/unrecognized_keys|Unrecognized key/u);
  assert.ok(statements.every((sql)=>sql.trimStart().startsWith("SELECT")),"only read queries executed");
});

test("topic evaluation start request is closed and explicitly confirmed",()=>{
  const digest=`sha256:${"1".repeat(64)}`;
  const parsed=parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000"});
  assert.equal(parsed.hard_cap_micro_usd,1_000_000n);
  assert.throws(()=>parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000",retry:true}));
});

test("topic evaluation successor start is a distinct closed acknowledgement contract",()=>{
  const digest=`sha256:${"1".repeat(64)}`;
  const parsed=parseSignalTopicEvaluationSuccessorStartRequestV1({
    predecessor_run_key:"topic-evaluation-prior",expected_envelope_digest:digest,
    confirmation:"AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR",hard_cap_micro_usd:"380000"});
  assert.equal(parsed.predecessor_run_key,"topic-evaluation-prior");
  assert.equal(parsed.hard_cap_micro_usd,380_000n);
  assert.throws(()=>parseSignalTopicEvaluationSuccessorStartRequestV1({
    predecessor_run_key:"topic-evaluation-prior",expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"380000"}));
  assert.throws(()=>parseSignalTopicEvaluationSuccessorStartRequestV1({
    predecessor_run_key:"topic-evaluation-prior",expected_envelope_digest:digest,
    confirmation:"AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR",hard_cap_micro_usd:"380000",retry:true}));
  assert.throws(()=>parseSignalTopicEvaluationStartRequestV1({
    predecessor_run_key:"topic-evaluation-prior",expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"380000"}),
  "generic start cannot smuggle predecessor authority");
});

test("topic evaluation candidate commands are closed and need no semantic rationale",()=>{
  const state_token=`sha256:${"2".repeat(64)}`;
  assert.deepEqual(parseSignalTopicEvaluationCandidateCommandV1({action:"save",candidate_key:"candidate.one",
    expected_revision:1,state_token,values:{title:"One",description:"Description",
      inclusion:["included"],exclusion:[]}}).action,"save");
  for(const action of ["reject","restore"] as const)assert.equal(
    parseSignalTopicEvaluationCandidateCommandV1({action,candidate_key:"candidate.one",
      expected_revision:2,state_token}).action,action);
  assert.equal(parseSignalTopicEvaluationCandidateCommandV1({action:"undo",candidate_key:"candidate.one",
    expected_revision:3,state_token,target_revision:2}).action,"undo");
  assert.throws(()=>parseSignalTopicEvaluationCandidateCommandV1({action:"approve",candidate_key:"candidate.one",
    expected_revision:1,state_token}));
  assert.throws(()=>parseSignalTopicEvaluationCandidateCommandV1({action:"reject",candidate_key:"candidate.one",
    expected_revision:1,state_token,rationale:"not accepted"}));
});

test("public preflight strips the private envelope and contracts sealed flight-card state",async()=>{
  const[source,authorityBoundary,openapi]=await Promise.all([
    readFile(new URL("./signal-topic-evaluation.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../infrastructure/db/signal-topic-evaluation.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  assert.match(source,/loadSignalTopicEvaluationManagementPreflightV1/u);
  assert.match(source,/if\(!\("envelope" in preflight\)\)return/u);
  assert.match(source,/input_authority:null/u);assert.match(source,/input_authority/u);
  assert.doesNotMatch(source,/context_elements/u);
  assert.match(openapi,/execution_configuration_complete/u);
  assert.match(openapi,/preflight_status/u);
  assert.match(openapi,/topic_evaluation_launch_authority_unavailable/u);
  assert.match(openapi,/Completed result rows remain readable/u);
  assert.match(authorityBoundary,/!management\.run\|\|!isExpectedTopicEvaluationLaunchAuthorityErrorV1\(error\)/u);
  for(const code of["topic_evaluation_input_authority_unavailable","topic_evaluation_packet_incomplete",
    "topic_evaluation_context_incomplete"])assert.ok(authorityBoundary.includes(`error.code==="${code}"`));
});

test("management routes retain workspace AuthZ, pagination and idempotent closed review",async()=>{
  const[managementRoute,successorRoute,commandRoute,errorBoundary,openapi]=await Promise.all([
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/successor/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/candidates/[candidateKey]/commands/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/semantic-context/_lib.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  for(const source of[managementRoute,successorRoute,commandRoute])assert.match(source,
    /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(managementRoute,/searchParams\.get\("cursor"\)/u);
  assert.match(managementRoute,/semanticContextError\(error,"topic_evaluation_preflight_rejected"\)/u);
  assert.ok(errorBoundary.includes('error:fallback,message:"Semantic Context Pack is temporarily unavailable."'),
    "unexpected GET failures preserve the explicit fallback error");
  assert.ok(errorBoundary.includes('},409);'),"unexpected GET failures remain visible as non-200 responses");
  assert.match(commandRoute,/requireIdempotencyKey/u);assert.match(commandRoute,/candidate_key!==candidateKey/u);
  assert.match(successorRoute,/parseSignalTopicEvaluationSuccessorStartRequestV1/u);
  assert.match(successorRoute,/startSignalTopicEvaluationSuccessorProductV1/u);
  assert.doesNotMatch(managementRoute,/Successor/u,"generic start route cannot create successor authority");
  assert.match(commandRoute,/parseSignalTopicEvaluationCandidateCommandV1/u);
  assert.match(openapi,/reviewSignalTopicEvaluationCandidate/u);
  assert.match(openapi,/Append one reversible pending\/rejected candidate revision/u);
  assert.match(openapi,/provider_outcome_class:[\s\S]*enum: \[definitely_not_sent, known_response_invalid, ambiguous_after_send, null\]/u);
  assert.match(openapi,/startSignalTopicEvaluationSuccessor/u);
  assert.match(openapi,/AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR/u);
});

test("full-evidence API is management-only, read-only and provider-disabled",async()=>{
  const[preflightRoute,evidenceRoute,product,openapi]=await Promise.all([
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/evidence/route.ts",import.meta.url),"utf8"),
    readFile(new URL("./signal-topic-evaluation.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  for(const source of[preflightRoute,evidenceRoute])assert.match(source,
    /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(preflightRoute,/topic_evaluation_v2_disabled/u);
  assert.doesNotMatch(preflightRoute,/startSignalTopicEvaluationProductV1|enqueue/u);
  assert.match(evidenceRoute,/navigateSignalTopicEvaluationEvidenceProductV2/u);
  assert.match(product,/navigateSignalTopicEvaluationEvidenceV2/u);
  assert.match(openapi,/operationId: navigateSignalTopicEvaluationEvidence/u);
  assert.match(openapi,/Not a SQL API/u);
  assert.equal(signalTopicEvaluationFlightCardV2().provider_calls_allowed,0);
  assert.throws(()=>parseSignalTopicEvidenceNavigationRequestV2({operation:"search_cluster",
    cluster_key:"cluster.1",limit:20,cursor:null,filters:{query:"x'; SELECT secret"}}));
});
