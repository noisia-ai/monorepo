import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_DIMENSIONS,
  SIGNAL_METRIC_CATALOG_V1,
  SIGNAL_METRIC_DEFINITIONS_V1,
  SIGNAL_METRIC_GROUPS_V1,
  signalMetricDefinitionV1,
  signalMetricFormulaHashV1,
  validateSignalMetricCatalogV1,
  type SignalMetricGroupV1
} from "./index";

test("Signal metric catalog V1 contains each required group and complete versioned definitions", () => {
  assert.deepEqual(SIGNAL_METRIC_CATALOG_V1.map((group) => group.key), [...SIGNAL_METRIC_GROUPS_V1]);
  assert.ok(SIGNAL_METRIC_DEFINITIONS_V1.length >= 10);
  assert.equal(validateSignalMetricCatalogV1(), SIGNAL_METRIC_CATALOG_V1);
  for (const definition of SIGNAL_METRIC_DEFINITIONS_V1) {
    assert.equal(definition.version, 1);
    assert.ok(definition.description.length > 20);
    assert.ok(definition.formula.expression.length > 5);
    assert.ok(definition.grains.includes("day"));
    assert.ok(definition.grains.includes("week"));
    assert.ok(definition.grains.includes("month"));
    assert.ok(definition.quality_rules.length >= 2);
    assert.equal(definition.drill_down_subject, "mention");
  }
});

test("Signal metric keys, versions, units and denominator semantics are unambiguous", () => {
  const identities = SIGNAL_METRIC_DEFINITIONS_V1.map((definition) => `${definition.key}@${definition.version}`);
  assert.equal(new Set(identities).size, identities.length);
  for (const definition of SIGNAL_METRIC_DEFINITIONS_V1) {
    assert.ok(["count", "ratio", "score"].includes(definition.unit));
    if (definition.unit === "ratio") assert.equal(definition.denominator.kind, "count");
    if (definition.denominator.kind === "count") assert.ok(definition.denominator.key.length > 3);
    assert.equal(definition.null_semantics.zero_is_observed_value, true);
  }
});

test("supported dimensions come from SignalFilterV1 and carry explicit visibility", () => {
  const supported = new Set<string>(SIGNAL_DIMENSIONS);
  for (const definition of SIGNAL_METRIC_DEFINITIONS_V1) {
    for (const dimension of definition.dimensions) {
      assert.equal(supported.has(dimension.key), true);
      assert.ok(["internal", "client", "both"].includes(dimension.visibility));
      if (dimension.key === "source_type") assert.equal(dimension.visibility, "internal");
    }
  }
  assert.equal(signalMetricDefinitionV1("source_type.share")?.visibility, "internal");
  assert.equal(signalMetricDefinitionV1("conversation.volume")?.visibility, "both");
});

test("formula hashes change with formula semantics and the validator rejects silent mutation", () => {
  const original = signalMetricDefinitionV1("conversation.volume");
  assert.ok(original);
  const mutatedFormula = { ...original.formula, predicate: "mentions.inclusion_status = 'all'" };
  assert.notEqual(signalMetricFormulaHashV1(original.formula), signalMetricFormulaHashV1(mutatedFormula));

  const mutated = structuredClone(SIGNAL_METRIC_CATALOG_V1) as SignalMetricGroupV1[];
  const target = mutated[0]?.metrics[0];
  assert.ok(target);
  target.formula = mutatedFormula;
  assert.throws(() => validateSignalMetricCatalogV1(mutated), /formula hash does not match/u);
});

test("catalog validation rejects duplicate metric identities and missing groups", () => {
  const duplicate = structuredClone(SIGNAL_METRIC_CATALOG_V1) as SignalMetricGroupV1[];
  duplicate[0]?.metrics.push(structuredClone(duplicate[0].metrics[0]!));
  assert.throws(() => validateSignalMetricCatalogV1(duplicate), /Duplicate Signal metric definition/u);
  assert.throws(
    () => validateSignalMetricCatalogV1(structuredClone(SIGNAL_METRIC_CATALOG_V1.slice(0, -1)) as SignalMetricGroupV1[]),
    /Missing Signal metric group/u
  );
});
