import assert from "node:assert/strict";
import test from "node:test";
import { estimateSignalDiscoveryInterpretationV1 } from "./signal-workspace-discovery-estimate";

test("advisory interpretation estimate uses population, text and existing sync Sonnet prices",()=>{
  const estimate=estimateSignalDiscoveryInterpretationV1({roots:80,chunks:80,text_bytes:80_000});
  assert.equal(estimate.assumed_groups,2);
  assert.equal(estimate.assumed_input_tokens,13024);
  assert.equal(estimate.assumed_output_tokens,2048);
  assert.equal(estimate.estimated_micro_usd,69792);
  assert.equal(estimate.method,"population-text-heuristic-v1");
  assert.ok(estimate.pricing_version.includes("sonnet-4-6"));
  assert.equal("cap_micro_usd" in estimate,false);
  assert.ok(estimateSignalDiscoveryInterpretationV1({roots:80,chunks:80,text_bytes:160_000}).estimated_micro_usd>estimate.estimated_micro_usd);
  assert.ok(estimateSignalDiscoveryInterpretationV1({roots:160,chunks:160,text_bytes:160_000}).estimated_micro_usd>estimate.estimated_micro_usd);
});
test("empty discovery has zero estimate; malformed counts are not converted into a cap",()=>{
  assert.equal(estimateSignalDiscoveryInterpretationV1({roots:0,chunks:0,text_bytes:0}).estimated_micro_usd,0);
  assert.throws(()=>estimateSignalDiscoveryInterpretationV1({roots:1,chunks:-1,text_bytes:5}),/population_invalid/);
});
