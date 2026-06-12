import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_PULSE_PUBLISH_BLOCKER_GATES,
  validateSignalPulsePublishReadiness
} from "./publish-gates";

test("Signal Pulse publish gates block reports without structured performance", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: [
      { id: "source_presence", passed: true, detail: "3 señales." },
      { id: "performance_structured", passed: false, detail: "0 registros de performance estructurada." },
      { id: "humanizer_passed", passed: false, detail: "Copy por revisar." }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has("performance_structured"), true);
  if (!result.ok) {
    assert.deepEqual(result.failedChecks, [
      { id: "performance_structured", detail: "0 registros de performance estructurada." }
    ]);
  }
});

test("Signal Pulse publish gates block reports without comparable periods", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: [
      { id: "source_presence", passed: true, detail: "3 señales." },
      { id: "period_coverage", passed: true, detail: "12 periodos materializados." },
      { id: "period_comparability", passed: false, detail: "0 periodos comparables." },
      { id: "performance_structured", passed: true, detail: "120 registros." },
      { id: "performance_period_coverage", passed: true, detail: "12 periodos con performance." },
      { id: "signal_min_evidence", passed: true, detail: "24 evidencias." },
      { id: "chart_data_available", passed: true, detail: "4 charts." },
      { id: "move_has_signal", passed: true, detail: "8 moves." },
      { id: "cost_within_budget", passed: true, detail: "Dentro del tope." },
      { id: "no_invented_numbers", passed: true, detail: "SQL only." }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has("period_comparability"), true);
  if (!result.ok) {
    assert.deepEqual(result.failedChecks, [
      { id: "period_comparability", detail: "0 periodos comparables." }
    ]);
  }
});

test("Signal Pulse publish gates block incomplete performance period coverage", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: [
      { id: "source_presence", passed: true, detail: "3 señales." },
      { id: "period_coverage", passed: true, detail: "12 periodos materializados." },
      { id: "period_comparability", passed: true, detail: "12 periodos comparables." },
      { id: "performance_structured", passed: true, detail: "120 registros." },
      { id: "performance_period_coverage", passed: false, detail: "7/12 periodos con performance estructurada." },
      { id: "signal_min_evidence", passed: true, detail: "24 evidencias." },
      { id: "chart_data_available", passed: true, detail: "4 charts." },
      { id: "move_has_signal", passed: true, detail: "8 moves." },
      { id: "cost_within_budget", passed: true, detail: "Dentro del tope." },
      { id: "no_invented_numbers", passed: true, detail: "SQL only." }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has("performance_period_coverage"), true);
  if (!result.ok) {
    assert.deepEqual(result.failedChecks, [
      { id: "performance_period_coverage", detail: "7/12 periodos con performance estructurada." }
    ]);
  }
});

test("Signal Pulse publish gates allow non-blocking editorial warnings", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: [
      { id: "source_presence", passed: true, detail: "3 señales." },
      { id: "period_coverage", passed: true, detail: "12 periodos materializados." },
      { id: "period_comparability", passed: true, detail: "12 periodos comparables." },
      { id: "performance_structured", passed: true, detail: "120 registros." },
      { id: "performance_period_coverage", passed: true, detail: "12 periodos con performance." },
      { id: "signal_min_evidence", passed: true, detail: "24 evidencias." },
      { id: "chart_data_available", passed: true, detail: "4 charts." },
      { id: "move_has_signal", passed: true, detail: "8 moves." },
      { id: "cost_within_budget", passed: true, detail: "Dentro del tope." },
      { id: "no_invented_numbers", passed: true, detail: "SQL only." },
      { id: "humanizer_passed", passed: false, detail: "Revisar tono." }
    ]
  });

  assert.equal(result.ok, true);
});
