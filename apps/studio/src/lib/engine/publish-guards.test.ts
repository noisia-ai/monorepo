import assert from "node:assert/strict";
import test from "node:test";

import { validateEnginePublishReadiness } from "./publish-guards";

test("engine publish guard requires a ready synthesized block", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: false },
    quality_gates: [{ id: "traceability", passed: true, detail: "ok" }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "engine_block_not_ready");
});

test("engine publish guard requires quality gates before publishing", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_coding: { provider: "anthropic", fixture: false }
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "quality_gates_missing");
});

test("engine publish guard blocks completed outputs without Claude coding metadata", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_block: {
      methodology_view: {
        readiness: {
          status: "beta_ready",
          reason: "ok"
        }
      }
    },
    quality_gates: [{ id: "traceability", passed: true, detail: "ok" }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "engine_coding_missing");
    assert.deepEqual(result.failedChecks, [{ id: "engine_coding_provider", detail: "provider=missing" }]);
  }
});

test("engine publish guard blocks fixture-coded beta outputs", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_coding: { provider: "fixture", fixture: true },
    quality_gates: [{ id: "traceability", passed: true, detail: "ok" }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "fixture_coding_used");
    assert.deepEqual(result.failedChecks, [{ id: "fixture_coding", detail: "engine_coding.fixture=true" }]);
  }
});

test("engine publish guard blocks failed quality gates and reports failures", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_coding: { provider: "anthropic", fixture: false },
    quality_gates: [
      { id: "traceability", passed: false, detail: "1/2 findings tienen cita." },
      { id: "confidence_calibrated", passed: true, detail: "2/2 findings tienen confianza." }
    ]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "quality_gates_failed");
    assert.deepEqual(result.failedChecks, [{ id: "traceability", detail: "1/2 findings tienen cita." }]);
  }
});

test("engine publish guard blocks directional methodology blocks", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_block: {
      methodology_view: {
        readiness: {
          status: "directional",
          reason: "El lente tiene señales, pero requiere mas cobertura."
        }
      }
    },
    engine_coding: { provider: "anthropic", fixture: false },
    quality_gates: [{ id: "traceability", passed: true, detail: "ok" }]
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "engine_block_directional");
    assert.deepEqual(result.failedChecks, [{
      id: "engine_block_readiness",
      detail: "El lente tiene señales, pero requiere mas cobertura."
    }]);
  }
});

test("engine publish guard allows ready blocks with passed quality gates", () => {
  const result = validateEnginePublishReadiness({
    synthesis: { engine_block_ready: true },
    engine_block: {
      methodology_view: {
        readiness: {
          status: "beta_ready",
          reason: "ok"
        }
      }
    },
    engine_coding: { provider: "anthropic", fixture: false },
    quality_gates: [
      { id: "traceability", passed: true, detail: "2/2 findings tienen cita." },
      { id: "confidence_calibrated", passed: true, detail: "2/2 findings tienen confianza." }
    ]
  });

  assert.equal(result.ok, true);
});
