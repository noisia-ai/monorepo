import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";

const {
  attachLiveIntelligenceLinksToPayload,
  buildLiveIntelligenceFindingLink,
  buildTbCanonicalSignalDraft,
  buildTbSemanticKey,
  buildTbSignalObservationDraft,
  getTbObservationConflictTarget
} = {
  ...(await import("./published-output")),
  ...(await import("./tb-observations"))
};

const ctx = {
  tb_analysis_id: "00000000-0000-4000-8000-000000000001",
  study_corpus_id: "00000000-0000-4000-8000-000000000002",
  snapshot_id: "00000000-0000-4000-8000-000000000003",
  brand_id: "00000000-0000-4000-8000-000000000004",
  theme_id: null,
  organization_id: "00000000-0000-4000-8000-000000000005"
};

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000006",
    finding_id: "T-PSI-01",
    polarity: "trigger",
    layer: "psicologico",
    nombre_comercial: "Querer ser reconocido por tener auto del año",
    frecuencia: 11,
    intensidad_promedio: "0.82",
    score_compuesto: "0.911",
    confidence: "alta",
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    cita_protagonista: null,
    raw_data: {
      member_tags: ["estatus", "auto del año", "reconocimiento"]
    },
    position_in_layer: 1,
    evidence_count: 9,
    ...overrides
  };
}

test("T&B semantic key is stable for tag order, accents and punctuation", () => {
  const a = finding({
    raw_data: { member_tags: ["Estatus", "auto del año", "reconocimiento"] }
  });
  const b = finding({
    nombre_comercial: "Querer ser reconocido por tener auto del año!",
    raw_data: { member_tags: ["reconocimiento", "AUTO del ano", "estatus"] }
  });

  assert.equal(buildTbSemanticKey(a), buildTbSemanticKey(b));
  assert.equal(
    buildTbSemanticKey(a),
    "trigger-psicologico-querer-ser-reconocido-por-tener-auto-del-ano-auto-del-ano-estatus-reconocimiento"
  );
});

test("T&B canonical signal draft keeps the persistent scope and provenance", () => {
  const draft = buildTbCanonicalSignalDraft(ctx, finding());

  assert.equal(draft.methodologySlug, "triggers-barriers");
  assert.equal(draft.signalType, "trigger");
  assert.equal(draft.brandId, ctx.brand_id);
  assert.equal(draft.themeId, null);
  assert.equal(draft.studyCorpusId, ctx.study_corpus_id);
  assert.equal(draft.canonicalTitle, "Querer ser reconocido por tener auto del año");
  assert.equal(draft.firstSeenAt, "2026-05-01");
  assert.equal(draft.lastSeenAt, "2026-05-31");
  assert.equal(draft.createdFromTbFindingId, "00000000-0000-4000-8000-000000000006");
  assert.deepEqual(draft.dimensions, {
    layer: "psicologico",
    original_finding_id: "T-PSI-01",
    raw_data: {
      member_tags: ["estatus", "auto del año", "reconocimiento"]
    }
  });
});

test("T&B observation draft preserves monthly metrics and delta vs previous cut", () => {
  const draft = buildTbSignalObservationDraft({
    canonicalSignalId: "00000000-0000-4000-8000-000000000007",
    ctx,
    finding: finding(),
    publishedOutputId: "00000000-0000-4000-8000-000000000008",
    previousFrequency: 7
  });

  assert.equal(draft.methodologySlug, "triggers-barriers");
  assert.equal(draft.signalType, "trigger");
  assert.equal(draft.windowStart, "2026-05-01");
  assert.equal(draft.windowEnd, "2026-05-31");
  assert.equal(draft.frequency, 11);
  assert.equal(draft.intensity, 0.82);
  assert.equal(draft.compositeScore, 0.911);
  assert.equal(draft.deltaVsPrevious, 4);
  assert.deepEqual(draft.metrics, {
    layer: "psicologico",
    finding_id: "T-PSI-01",
    evidence_count: 9,
    previous_frequency: 7
  });
});

test("T&B live intelligence link connects published finding to persistent memory", () => {
  const link = buildLiveIntelligenceFindingLink(
    finding(),
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008"
  );

  assert.deepEqual(link, {
    finding_id: "T-PSI-01",
    tb_finding_id: "00000000-0000-4000-8000-000000000006",
    canonical_signal_id: "00000000-0000-4000-8000-000000000007",
    signal_observation_id: "00000000-0000-4000-8000-000000000008",
    signal_type: "trigger",
    title: "Querer ser reconocido por tener auto del año"
  });
});

test("T&B observation upsert is idempotent without a snapshot", () => {
  assert.match(getTbObservationConflictTarget(ctx.snapshot_id), /snapshot_id/);
  assert.doesNotMatch(getTbObservationConflictTarget(ctx.snapshot_id), /tb_analysis_id/);

  const noSnapshotConflict = getTbObservationConflictTarget(null);
  assert.match(noSnapshotConflict, /tb_analysis_id/);
  assert.doesNotMatch(noSnapshotConflict, /snapshot_id\)/);
});

test("published payload keeps the old snapshot and adds live intelligence links", () => {
  const basePayload = {
    version: "signal_payload_v2",
    report: { title: "Mayo 2026", methodology_slug: "triggers-barriers" },
    modules: [{ id: "overview", title: "Overview" }]
  };
  const link = buildLiveIntelligenceFindingLink(
    finding(),
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008"
  );

  const enriched = attachLiveIntelligenceLinksToPayload(basePayload, {
    status: "ok",
    signals: 1,
    observations: 1,
    evidence: 9,
    mappings: [link]
  });

  assert.notEqual(enriched, basePayload);
  assert.deepEqual(basePayload, {
    version: "signal_payload_v2",
    report: { title: "Mayo 2026", methodology_slug: "triggers-barriers" },
    modules: [{ id: "overview", title: "Overview" }]
  });
  assert.deepEqual(enriched.report, basePayload.report);
  assert.deepEqual(enriched.modules, basePayload.modules);
  assert.deepEqual(enriched.live_intelligence, {
    status: "ok",
    signals: 1,
    observations: 1,
    evidence: 9,
    finding_links: [link]
  });
});
