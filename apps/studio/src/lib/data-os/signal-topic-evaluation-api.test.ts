import assert from "node:assert/strict";import { readFile } from "node:fs/promises";import test from "node:test";
import { parseSignalTopicEvaluationCandidateCommandV1,parseSignalTopicEvaluationStartRequestV1 } from "./signal-topic-evaluation-api";

test("topic evaluation start request is closed and explicitly confirmed",()=>{
  const digest=`sha256:${"1".repeat(64)}`;
  const parsed=parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000"});
  assert.equal(parsed.hard_cap_micro_usd,1_000_000n);
  assert.throws(()=>parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000",retry:true}));
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
  const[managementRoute,commandRoute,errorBoundary,openapi]=await Promise.all([
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/topic-evaluation/candidates/[candidateKey]/commands/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../../app/api/data-os/signal/[workspaceId]/semantic-context/_lib.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  for(const source of[managementRoute,commandRoute])assert.match(source,
    /loadSignalWorkspaceContextForSemanticContextManagement/u);
  assert.match(managementRoute,/searchParams\.get\("cursor"\)/u);
  assert.match(managementRoute,/semanticContextError\(error,"topic_evaluation_preflight_rejected"\)/u);
  assert.ok(errorBoundary.includes('error:fallback,message:"Semantic Context Pack is temporarily unavailable."'),
    "unexpected GET failures preserve the explicit fallback error");
  assert.ok(errorBoundary.includes('},409);'),"unexpected GET failures remain visible as non-200 responses");
  assert.match(commandRoute,/requireIdempotencyKey/u);assert.match(commandRoute,/candidate_key!==candidateKey/u);
  assert.match(commandRoute,/parseSignalTopicEvaluationCandidateCommandV1/u);
  assert.match(openapi,/reviewSignalTopicEvaluationCandidate/u);
  assert.match(openapi,/Append one reversible pending\/rejected candidate revision/u);
});
