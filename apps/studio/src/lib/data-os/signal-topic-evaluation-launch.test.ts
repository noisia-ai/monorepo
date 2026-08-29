import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acquireSignalTopicEvaluationSubmissionLockV1,
  buildSignalTopicEvaluationLaunchRequestV1,
  canLaunchSignalTopicEvaluationV1,
  createSignalTopicEvaluationIdempotencyKeyV1,
  createSignalTopicEvaluationReviewIdempotencyKeyV1,
  projectSignalTopicEvaluationManagementV1,
  projectSignalTopicEvaluationFlightCardV1,
  readSignalTopicEvaluationRunStatusV1
} from "./signal-topic-evaluation-launch";

function preflight() {
  return {
    contract_version: "signal-topic-evaluation-preflight-v1",
    preflight_status:"ready",
    preflight_error_code:null,
    execution_enabled: true,
    execution_configuration_complete: true,
    credential_configured: true,
    product_provider_key_name: "ANTHROPIC_API_KEY",
    provider: "anthropic",
    model: "claude-sonnet-5",
    pricing_version: "anthropic-claude-sonnet-5-2026-08-29",
    envelope_digest: `sha256:${"1".repeat(64)}`,
    proposal_count: 115,
    historical_bertopic_proposals: 115,
    one_call_max: 1,
    retry_allowed: false,
    hard_cap_micro_usd: "380000",
    estimated_max_cost_micro_usd: "330000",
    success_minimum_candidates: 10,
    topic_adoption: false,
    publication: false,
    serving: false,
    input_authority: { corpus: { private: "ignored" } },
    envelope: { private: "never_projected" },
    raw_prompt: "never_projected",
    credential_value: "never_projected"
  };
}

function blockedManagement(){return{...management(),preflight_status:"blocked",
  preflight_error_code:"topic_evaluation_launch_authority_unavailable",execution_enabled:false,
  input_authority:null,envelope_digest:null,proposal_count:null};}

function management(){return{...preflight(),run:{run_key:"topic-evaluation-safe",status:"completed",
  provider_call_count:1,candidate_count:10,rubric_met:true,error_code:null,settled_micro_usd:"120000",
  queued_at:"2026-08-29T00:00:00.000Z",started_at:"2026-08-29T00:00:01.000Z",
  completed_at:"2026-08-29T00:00:02.000Z",failed_at:null,updated_at:"2026-08-29T00:00:02.000Z"},
  results:{contract_version:"signal-topic-evaluation-candidate-page-v1",run_key:"topic-evaluation-safe",total:10,pending:10,rejected:0,
    limit:20,next_cursor:null,items:[{candidate_key:"candidate.one",title:"Candidate one",
      description:"Bounded description",inclusion:["in"],exclusion:[],source_proposal_keys:["proposal.one"],
      source_proposal_count:1,evidence:{count:1,supports:1,limits:0,contradicts:0},review_state:"pending",
      revision:1,state_token:`sha256:${"3".repeat(64)}`,undo_target_revision:null,
      updated_at:"2026-08-29T00:00:02.000Z"}]}};}

test("Topic Evaluation projects only the sanitized flight card", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  assert.equal(card.proposalCount, 115);
  assert.equal(card.model, "claude-sonnet-5");
  assert.equal(card.estimatedMaxCostMicroUsd, "330000");
  assert.equal(card.hardCapMicroUsd, "380000");
  assert.equal(canLaunchSignalTopicEvaluationV1(card), true);
  assert.doesNotMatch(JSON.stringify(card), /private|raw_prompt|credential_value/u);
});

test("completed results remain visible while a fresh launch preflight is blocked",()=>{
  const projected=projectSignalTopicEvaluationManagementV1(blockedManagement());
  assert.equal(projected.card.preflightStatus,"blocked");
  assert.equal(projected.card.preflightErrorCode,"topic_evaluation_launch_authority_unavailable");
  assert.equal(canLaunchSignalTopicEvaluationV1(projected.card),false);
  assert.equal(projected.run?.status,"completed");
  assert.equal(projected.results.items.length,1);
  assert.equal(projected.results.items[0]?.reviewState,"pending");
  assert.throws(()=>buildSignalTopicEvaluationLaunchRequestV1({acknowledged:true,card:projected.card,
    idempotencyKey:"topic-evaluation:start:blocked"}),/topic_evaluation_preflight_not_ready/u);
});

test("Topic Evaluation requires the explicit acknowledgement before building a command", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  assert.throws(() => buildSignalTopicEvaluationLaunchRequestV1({
    acknowledged: false,
    card,
    idempotencyKey: "topic-evaluation:start:one"
  }), /topic_evaluation_cost_acknowledgement_required/u);
});

test("Topic Evaluation builds the unchanged closed POST contract", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  const command = buildSignalTopicEvaluationLaunchRequestV1({
    acknowledged: true,
    card,
    idempotencyKey: "topic-evaluation:start:one"
  });
  assert.deepEqual(command, {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "topic-evaluation:start:one"
    },
    body: {
      expected_envelope_digest: `sha256:${"1".repeat(64)}`,
      confirmation: "RUN_ONE_TOPIC_EVALUATION",
      hard_cap_micro_usd: "380000"
    }
  });
  assert.deepEqual(Object.keys(command.body).sort(), [
    "confirmation", "expected_envelope_digest", "hard_cap_micro_usd"
  ]);
});

test("Topic Evaluation creates one fresh idempotency key and rejects a second local submit", () => {
  let sequence = 0;
  const first = createSignalTopicEvaluationIdempotencyKeyV1(() => `uuid-${++sequence}`);
  const second = createSignalTopicEvaluationIdempotencyKeyV1(() => `uuid-${++sequence}`);
  assert.equal(first, "topic-evaluation:start:uuid-1");
  assert.equal(second, "topic-evaluation:start:uuid-2");
  assert.notEqual(first, second);
  const lock = { current: false };
  assert.equal(acquireSignalTopicEvaluationSubmissionLockV1(lock), true);
  assert.equal(acquireSignalTopicEvaluationSubmissionLockV1(lock), false);
});

test("Topic Evaluation displays only the returned run status", () => {
  assert.equal(readSignalTopicEvaluationRunStatusV1({
    run_id: "private",
    run_key: "topic-evaluation-private",
    status: "queued",
    envelope_digest: `sha256:${"2".repeat(64)}`,
    provider_call_count: 0
  }), "queued");
  assert.throws(() => readSignalTopicEvaluationRunStatusV1({ status: "completed" }),
    /topic_evaluation_run_status_invalid/u);
});

test("Topic Evaluation projects sanitized terminal run and editable candidate page",()=>{
  const value=management();(value as Record<string,unknown>).provider_response_private="private";
  const projected=projectSignalTopicEvaluationManagementV1(value);
  assert.equal(projected.run?.status,"completed");assert.equal(projected.results.items[0]?.title,"Candidate one");
  assert.equal(projected.results.items[0]?.reviewState,"pending");
  assert.doesNotMatch(JSON.stringify(projected),/provider_response_private|raw_prompt|corpus_text/u);
  assert.match(createSignalTopicEvaluationReviewIdempotencyKeyV1(()=>"one"),/^topic-evaluation:review:/u);
});

test("Brand OS mounts the normal launch and reversible review surface without touching Discovery Review", async () => {
  const [component, page, drawer, css, es, en, openapi] = await Promise.all([
    readFile(new URL("../../components/brands/TopicEvaluationManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/studio/brands/[id]/brand-os/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/workspace/WorkspaceShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/es-MX.json", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/en-US.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml", import.meta.url), "utf8")
  ]);
  assert.match(component, /AdminResourceSection/u);
  assert.match(component, /AdminSummaryStrip/u);
  assert.match(component, /WorkspaceDrawer/u);
  assert.match(component, /projectSignalTopicEvaluationManagementV1/u);
  assert.match(component,/preflightErrorCode==="topic_evaluation_launch_authority_unavailable"/u);
  assert.match(component, /candidate\.reviewState/u);
  assert.match(component, /candidate\.evidence\.count/u);
  assert.match(component, /review\("save"\)/u);
  assert.match(component, /review\("reject"\)/u);
  assert.match(component, /review\("restore"\)/u);
  assert.match(component, /review\("undo"\)/u);
  assert.match(component,/returnFocusRef=\{openerRef\}/u);
  assert.match(drawer,/event\.key === "Escape"/u);
  assert.match(drawer,/restoreWorkspaceDrawerFocusV1\(explicitReturnFocusTo/u);
  assert.match(css,/@media \(max-width: 520px\)/u);
  assert.match(component, /method:\s*"POST"/u);
  assert.match(component, /sessionStorage\.setItem/u);
  assert.match(component, /acquireSignalTopicEvaluationSubmissionLockV1/u);
  assert.doesNotMatch(component, /actions\.(retry|fallback)|retryAction|fallbackAction/u);
  assert.match(component,/const terminal=run\.status==="completed"\|\|run\.status==="failed"\|\|ambiguous/u);
  assert.match(component,/run\.status==="failed"\|\|ambiguous\?<Warning/u,
    "outcome_unknown renders a terminal warning without the progress spinner");
  assert.match(component,/ambiguous\?t\("run\.outcomeUnknownBody"\):t\("run\.progressBody"\)/u);
  assert.ok(page.indexOf("<TopicEvaluationManager") > page.indexOf("<SemanticContextPackManager"));
  assert.doesNotMatch(page, /TopicDiscoveryReviewWorkbench/u);
  assert.ok(JSON.parse(es).AdminWorkspace.brandOs.topicEvaluation.boundary.authorityUnavailableBody);
  assert.ok(JSON.parse(en).AdminWorkspace.brandOs.topicEvaluation.boundary.authorityUnavailableBody);
  assert.match(JSON.parse(es).AdminWorkspace.brandOs.topicEvaluation.run.outcomeUnknownBody,
    /desconocido.*No ocurrió ningún retry automático/u);
  assert.match(JSON.parse(en).AdminWorkspace.brandOs.topicEvaluation.run.outcomeUnknownBody,
    /unknown.*No automatic retry occurred/u);
  assert.match(openapi, /confirmation: \{ const: RUN_ONE_TOPIC_EVALUATION \}/u);
  assert.match(openapi, /IdempotencyKey/u);
  assert.match(openapi, /SignalTopicEvaluationCandidateCommandV1/u);
  assert.doesNotMatch(component,/TopicDiscoveryReviewWorkbench/u);
});
