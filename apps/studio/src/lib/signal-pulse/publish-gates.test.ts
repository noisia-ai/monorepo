import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_PULSE_PUBLISH_BLOCKER_GATES,
  SIGNAL_PULSE_REQUIRED_PUBLISH_GATES,
  validateSignalPulsePublishReadiness
} from "./publish-gates";

function passingGates(overrides: Array<{ id: string; passed: boolean; detail: string }> = []) {
  const byId = new Map([
    { id: "source_presence", passed: true, detail: "3 señales." },
    { id: "period_coverage", passed: true, detail: "12 periodos materializados." },
    { id: "period_comparability", passed: true, detail: "12 periodos comparables." },
    { id: "performance_structured", passed: true, detail: "120 registros." },
    { id: "performance_period_coverage", passed: true, detail: "12 periodos con performance." },
    { id: "signal_min_evidence", passed: true, detail: "24 evidencias." },
    { id: "confidence_assigned", passed: true, detail: "Todas las señales tienen confianza." },
    { id: "chart_data_available", passed: true, detail: "4 charts." },
    { id: "move_has_signal", passed: true, detail: "8 moves." },
    { id: "move_has_evidence", passed: true, detail: "8 moves con evidencia." },
    { id: "move_is_marketing_action", passed: true, detail: "Acciones movibles por Marketing." },
    { id: "cost_within_budget", passed: true, detail: "Dentro del tope." },
    { id: "no_invented_numbers", passed: true, detail: "SQL only." },
    { id: "limitations_visible", passed: true, detail: "Limitaciones visibles." },
    { id: "source_visibility", passed: true, detail: "Visibilidad aplicada." },
    { id: "paid_data_permission", passed: true, detail: "Paid cerrado por default." },
    { id: "internal_notes_hidden", passed: true, detail: "Interno oculto." }
  ].map((gate) => [gate.id, gate]));
  for (const override of overrides) byId.set(override.id, override);
  return Array.from(byId.values());
}

test("Signal Pulse publish gates block reports without structured performance", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: [
      ...passingGates([
        { id: "performance_structured", passed: false, detail: "0 registros de performance estructurada." }
      ]),
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
    quality_gates: passingGates([
      { id: "period_comparability", passed: false, detail: "0 periodos comparables." }
    ])
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
    quality_gates: passingGates([
      { id: "performance_period_coverage", passed: false, detail: "7/12 periodos con performance estructurada." }
    ])
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
      ...passingGates(),
      { id: "humanizer_passed", passed: false, detail: "Revisar tono." }
    ]
  });

  assert.equal(result.ok, true);
});

test("Signal Pulse publish gates block when required professional gates are missing", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: passingGates().filter((gate) => gate.id !== "paid_data_permission")
  });

  assert.equal(SIGNAL_PULSE_REQUIRED_PUBLISH_GATES.includes("paid_data_permission"), true);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.failedChecks, [
      { id: "paid_data_permission", detail: "Gate requerido no se ejecutó." }
    ]);
  }
});

test("Signal Pulse publish gates block permission and move evidence failures", () => {
  const result = validateSignalPulsePublishReadiness({
    quality_gates: passingGates([
      { id: "move_has_evidence", passed: false, detail: "2 moves sin evidencia." },
      { id: "source_visibility", passed: false, detail: "Evidencia no autorizada para cliente." }
    ])
  });

  assert.equal(result.ok, false);
  assert.equal(SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has("move_has_evidence"), true);
  assert.equal(SIGNAL_PULSE_PUBLISH_BLOCKER_GATES.has("source_visibility"), true);
  if (!result.ok) {
    assert.deepEqual(result.failedChecks, [
      { id: "move_has_evidence", detail: "2 moves sin evidencia." },
      { id: "source_visibility", detail: "Evidencia no autorizada para cliente." }
    ]);
  }
});
