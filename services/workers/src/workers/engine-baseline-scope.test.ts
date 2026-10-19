import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEngineCorpusScopeIds,
  readRetrievedUnitLimit,
  readRetrievedUnits,
  shouldReadUnitsFromRunMap
} from "./engine-scope";
import { normalizeEngineCodingIntensity } from "./engine-coding-utils";

test("engine corpus scope keeps primary and baseline corpus ids unique", () => {
  assert.deepEqual(buildEngineCorpusScopeIds({
    study_corpus_id: "00000000-0000-4000-8000-000000000001",
    base_corpus_id: "00000000-0000-4000-8000-000000000002"
  }), [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ]);

  assert.deepEqual(buildEngineCorpusScopeIds({
    study_corpus_id: "00000000-0000-4000-8000-000000000001",
    base_corpus_id: "00000000-0000-4000-8000-000000000001"
  }), ["00000000-0000-4000-8000-000000000001"]);
});

test("engine retrieved units preserve the source corpus for baseline mentions", () => {
  const units = readRetrievedUnits({
    retrieval: {
      units: [
        {
          external_ref: "mention-primary",
          study_corpus_id: "00000000-0000-4000-8000-000000000001",
          entity_id: "entity-primary",
          text: "This is a primary corpus mention with enough signal.",
          platform: "twitter"
        },
        {
          external_ref: "mention-baseline",
          study_corpus_id: "00000000-0000-4000-8000-000000000002",
          entity_hint: "Category baseline",
          text: "This is a baseline corpus mention with enough signal.",
          published_at: "2026-06-01T00:00:00.000Z"
        }
      ]
    }
  });

  assert.equal(units.length, 2);
  assert.equal(units[0]?.study_corpus_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(units[1]?.study_corpus_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(units[1]?.entity_hint, "Category baseline");
});

test("engine coding loads retrieved units from the materialized run map when available", () => {
  const metaJson = {
    retrieval: {
      materialized_run_map: true,
      materialized_run_map_table: "engine_run_mention_map",
      units_in_meta: false,
      max_units: 720,
      retrieved_units: 512,
      unit_preview: [
        {
          external_ref: "preview-only",
          text: "Preview text should not be treated as the full coding payload."
        }
      ]
    }
  };

  assert.equal(shouldReadUnitsFromRunMap(metaJson), true);
  assert.equal(readRetrievedUnitLimit(metaJson), 720);
  assert.deepEqual(readRetrievedUnits(metaJson), []);
});

test("engine coding keeps legacy retrieval units compatible", () => {
  const metaJson = {
    retrieval: {
      retrieved_units: 2,
      units: [
        {
          external_ref: "legacy-mention",
          study_corpus_id: "00000000-0000-4000-8000-000000000001",
          text: "Legacy retrieved unit with enough text to code."
        }
      ]
    }
  };

  assert.equal(shouldReadUnitsFromRunMap(metaJson), false);
  assert.equal(readRetrievedUnitLimit(metaJson), 2);
  assert.equal(readRetrievedUnits(metaJson).length, 1);
});

test("engine coding clamps model intensity into the database range", () => {
  assert.equal(normalizeEngineCodingIntensity(8), 5);
  assert.equal(normalizeEngineCodingIntensity(-2), 0);
  assert.equal(normalizeEngineCodingIntensity(3.6), 4);
  assert.equal(normalizeEngineCodingIntensity(Number.NaN), 1);
});
