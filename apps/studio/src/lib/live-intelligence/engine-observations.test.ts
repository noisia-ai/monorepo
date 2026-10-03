import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const {
  buildEngineLiveIntelligenceFindingLink,
  summarizeEngineLiveIntelligenceLinks
} = await import("./engine-observations");

const row = {
  finding_id: "red_sin_letras_chiquitas",
  engine_finding_id: "00000000-0000-4000-8000-000000000101",
  canonical_signal_id: "00000000-0000-4000-8000-000000000102",
  signal_observation_id: "00000000-0000-4000-8000-000000000103",
  signal_type: "narrative",
  methodology_slug: "narrative-ownership",
  title: "Red sin letras chiquitas",
  evidence_count: 4
};

test("engine live intelligence link connects engine findings to persistent memory", () => {
  assert.deepEqual(buildEngineLiveIntelligenceFindingLink(row), {
    finding_id: "red_sin_letras_chiquitas",
    engine_finding_id: "00000000-0000-4000-8000-000000000101",
    canonical_signal_id: "00000000-0000-4000-8000-000000000102",
    signal_observation_id: "00000000-0000-4000-8000-000000000103",
    signal_type: "narrative",
    methodology_slug: "narrative-ownership",
    title: "Red sin letras chiquitas",
    evidence_count: 4
  });
});

test("engine live intelligence summary aggregates signals, observations and evidence", () => {
  const summary = summarizeEngineLiveIntelligenceLinks([
    row,
    {
      ...row,
      finding_id: "red_sin_contrato",
      engine_finding_id: "00000000-0000-4000-8000-000000000104",
      signal_observation_id: "00000000-0000-4000-8000-000000000105",
      evidence_count: 3
    }
  ]);

  assert.equal(summary.status, "ok");
  assert.equal(summary.signals, 1);
  assert.equal(summary.observations, 2);
  assert.equal(summary.evidence, 7);
  assert.equal(summary.mappings.length, 2);
});

test("engine live intelligence summary stays skipped when the engine has no observations", () => {
  const summary = summarizeEngineLiveIntelligenceLinks([]);

  assert.deepEqual(summary, {
    status: "skipped",
    reason: "engine_observations_not_found",
    signals: 0,
    observations: 0,
    evidence: 0,
    mappings: []
  });
});
