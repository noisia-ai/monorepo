import assert from "node:assert/strict";import { readFile } from "node:fs/promises";import test from "node:test";
import { parseSignalTopicEvaluationStartRequestV1 } from "./signal-topic-evaluation-api";

test("topic evaluation start request is closed and explicitly confirmed",()=>{
  const digest=`sha256:${"1".repeat(64)}`;
  const parsed=parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000"});
  assert.equal(parsed.hard_cap_micro_usd,1_000_000n);
  assert.throws(()=>parseSignalTopicEvaluationStartRequestV1({expected_envelope_digest:digest,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:"1000000",retry:true}));
});

test("public preflight strips the private envelope and contracts sealed flight-card state",async()=>{
  const[source,openapi]=await Promise.all([
    readFile(new URL("./signal-topic-evaluation.ts",import.meta.url),"utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml",import.meta.url),"utf8")]);
  assert.match(source,/const\{envelope,\.\.\.flightCard\}=prepared/u);
  assert.match(source,/input_authority/u);assert.doesNotMatch(source,/context_elements/u);
  assert.match(openapi,/execution_configuration_complete/u);
  assert.match(openapi,/bounded proposal\/context payloads remain server-private/u);
});
