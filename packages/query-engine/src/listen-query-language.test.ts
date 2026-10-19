import assert from "node:assert/strict";
import test from "node:test";

import {
  PORTABLE_LISTEN_QUERY_DIALECT_VERSION,
  validatePortableListenQuery
} from "./listen-query-language";

test("accepts the portable boolean subset used by query packs", () => {
  const validation = validatePortableListenQuery(
    '("Laika Mascotas" OR @laikamascotas) AND (recompra OR "vale la pena") AND NOT ("Laika Studios" OR astronauta)'
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.dialect_version, PORTABLE_LISTEN_QUERY_DIALECT_VERSION);
  assert.equal(validation.stats.positive_terms, 4);
  assert.equal(validation.stats.negative_terms, 2);
  assert.match(validation.normalized_query, /AND NOT/);
});

test("rejects implicit adjacency and malformed operators", () => {
  const validation = validatePortableListenQuery('"Laika" "recompra" OR');

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((item) => item.code === "missing_operator"));
  assert.ok(validation.errors.some((item) => item.code === "missing_operand"));
});

test("enforces documented wildcard constraints", () => {
  assert.equal(validatePortableListenQuery("mascota*").valid, true);
  assert.equal(validatePortableListenQuery("cat*").valid, false);
  assert.equal(validatePortableListenQuery('"mascota*"').valid, false);
  assert.equal(validatePortableListenQuery("?ascota").valid, false);
});

test("rejects provider-specific advanced field operators", () => {
  const validation = validatePortableListenQuery('rawText:"Laika" AND country:MX');

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((item) => item.code === "advanced_operator_not_allowed"));
});

test("requires an include before exclusions", () => {
  const validation = validatePortableListenQuery('NOT ("Laika Studios" OR astronauta)');

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((item) => item.code === "negative_only_query"));
});

test("reports duplicate and overly broad queries without treating them as syntax errors", () => {
  const terms = Array.from({ length: 187 }, (_, index) => `term${index}`);
  const validation = validatePortableListenQuery(`(${terms.join(" OR ")} OR term0)`, { maxLength: 5_000 });

  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.some((item) => item.code === "duplicate_term"));
  assert.ok(validation.warnings.some((item) => item.code === "query_too_broad"));
});
