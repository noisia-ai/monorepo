import assert from "node:assert/strict";
import test from "node:test";

import { engineLensParamsFromTbMeta } from "@noisia/query-engine";
import {
  isCompletedEngineAnalysisUsable,
  resolveSelectedEngineLaunchOptions
} from "./engine-selected-lenses-options";

test("selected engine lenses inherit max_units from T&B study package", () => {
  assert.deepEqual(
    engineLensParamsFromTbMeta({
      analysis_sample: {
        target_mentions: 14035,
        resolved_study_size: "large",
        strategy: "stratified_random"
      }
    }),
    {
      max_units: 14035,
      budget_source: "tb_analysis_sample",
      study_size: "large",
      sampling_strategy: "stratified_random"
    }
  );
});

test("selected engine lenses do not invent a budget when T&B metadata is missing", () => {
  assert.deepEqual(engineLensParamsFromTbMeta({}), {});
});

test("selected engine lenses launch metadata identifies post-T&B launch surfaces", () => {
  assert.deepEqual(resolveSelectedEngineLaunchOptions(), {
    launchSurface: "tb_quality_gates_auto_selected_lenses",
    resultMetaKey: "selected_engine_lenses_after_tb",
    triggerReason: null
  });

  assert.deepEqual(resolveSelectedEngineLaunchOptions({
    launchSurface: "tb_step6_failure_auto_selected_lenses",
    resultMetaKey: "selected_engine_lenses_after_tb_step6_failure",
    triggerReason: "invalid synthesis JSON"
  }), {
    launchSurface: "tb_step6_failure_auto_selected_lenses",
    resultMetaKey: "selected_engine_lenses_after_tb_step6_failure",
    triggerReason: "invalid synthesis JSON"
  });
});

test("selected engine lenses only reuse completed analyses with real retrieval and Anthropic coding", () => {
  assert.equal(isCompletedEngineAnalysisUsable({
    retrieved_units: 180,
    coding_provider: "anthropic",
    coding_fixture: false
  }), true);

  assert.equal(isCompletedEngineAnalysisUsable({
    retrieved_units: 0,
    coding_provider: "anthropic",
    coding_fixture: false
  }), false);

  assert.equal(isCompletedEngineAnalysisUsable({
    retrieved_units: 180,
    coding_provider: null,
    coding_fixture: null
  }), false);

  assert.equal(isCompletedEngineAnalysisUsable({
    retrieved_units: 180,
    coding_provider: "fixture",
    coding_fixture: true
  }), false);
});
