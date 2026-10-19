import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {compileSignalTopicRuleSpecV1, type SignalTopicRuleSpecV1} from "./signal-topic-rule-spec-v1";
import {aggregateSignalTopicRuleCohortMasksV1 as aggregate, compileSignalTopicRuleCohortV1 as compile,
  parseSignalTopicRuleCohortV1 as parse, SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1,
  SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1, type SignalTopicRuleCohortMaskBucketV1} from "./signal-topic-rule-cohort-v1";

const spec = (phrase = "football"): SignalTopicRuleSpecV1 => ({contract_version: "signal-topic-rule-spec-v1",
  kind: "topic", label: "Football", definition: "Discussion about football.",
  lexical: {any: [phrase], all: [], not: []}, filters: {languages: [], markets: [], scopes: []}});
const rules = () => [{candidate_key: "alpha", rule_spec: spec()}, {candidate_key: "beta", rule_spec: spec("music")}];
const bucket = (filter_mask: number, match_mask: number, count = 1, available = true): SignalTopicRuleCohortMaskBucketV1 =>
  ({available, filter_mask, match_mask, count});
const two = (histogram: SignalTopicRuleCohortMaskBucketV1[], total = histogram.reduce((sum, row) => sum + row.count, 0)) =>
  aggregate({candidate_keys: ["alpha", "beta"], total, histogram});

test("closed cohort canonicalizes distinct candidate rules without mutating authored input", () => {
  const input = rules().reverse();
  input[1]!.rule_spec.lexical.any = [" football ", "football"];
  const before = JSON.stringify(input), parsed = parse(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(parsed.map((rule) => rule.candidate_key), ["alpha", "beta"]);
  assert.deepEqual(parsed[0]!.rule_spec.lexical.any, ["football"]);
  assert.deepEqual(parse(parsed), parsed);
  assert.equal(compile(input).cohort_digest, compile(parsed).cohort_digest);
  assert.equal(compile(input).plan_hash, compile(parsed).plan_hash);
  assert.notEqual(compile(rules()).cohort_digest, compile(rules().map((rule) => ({...rule,
    rule_spec: {...rule.rule_spec, definition: "Changed candidate identity."}}))).cohort_digest);
});

test("requires 2..15 distinct candidates and rejects unknown fields at every level", () => {
  for (const input of [[], rules().slice(0, 1), Array.from({length: 16}, (_, i) => ({candidate_key: `c${i}`, rule_spec: spec()})),
    [rules()[0], rules()[0]], [{...rules()[0], candidate_key: "Bad Key"}, rules()[1]],
    [{...rules()[0], sql: "TRUE"}, rules()[1]], [{...rules()[0], model_payload: {}}, rules()[1]],
    [{...rules()[0], rule_spec: {...spec(), javascript: "return true"}}, rules()[1]],
    [{...rules()[0], rule_spec: {...spec(), lexical: {...spec().lexical, regex: ".*"}}}, rules()[1]],
    [{...rules()[0], rule_spec: {...spec(), filters: {...spec().filters, column: "secret"}}}, rules()[1]],
    {rules: rules()}, [{candidate_key: "alpha"}, rules()[1]]]) assert.throws(() => compile(input));
  assert.equal(parse(Array.from({length: 15}, (_, i) => ({candidate_key: `candidate-${i}`, rule_spec: spec()}))).length, 15);
});

test("each match bit contains its own filter AND lexical predicate, compiled by the existing compiler", () => {
  const selected = rules();
  selected[0]!.rule_spec.filters = {languages: ["es"], markets: ["MX"], scopes: ["primary_brand"]};
  selected[1]!.rule_spec.filters.markets = ["US"];
  const compiled = compile(selected, {placeholderOffset: 3});
  let offset = 3;
  for (const [index, rule] of compiled.rules.entries()) {
    const single = compileSignalTopicRuleSpecV1(selected[index]!.rule_spec, {placeholderOffset: offset});
    assert.equal(rule.predicate, single.predicate);
    assert.equal(rule.filter_predicate, single.filter_predicate);
    assert.equal(rule.lexical_predicate, single.lexical_predicate);
    assert.equal(rule.plan_hash, single.plan_hash);
    assert.equal(rule.bit, 2 ** index);
    assert.ok(compiled.match_mask_sql.includes(`COALESCE((${single.predicate}), FALSE) THEN ${rule.bit}`));
    assert.ok(compiled.filter_mask_sql.includes(`COALESCE((${single.filter_predicate}), FALSE) THEN ${rule.bit}`));
    offset += single.values.length;
  }
  assert.deepEqual(compiled.values, ["football", ["es"], ["MX"], ["primary_brand"], "music", ["US"]]);
  assert.doesNotMatch(compiled.match_mask_sql, /alpha|beta|football|music|MX|US|primary_brand/u);
});

test("all binds are consecutive, offsets are validated and relocation does not change semantic plan", () => {
  const first = compile(rules()), relocated = compile(rules(), {placeholderOffset: 3});
  assert.equal(first.cohort_digest, relocated.cohort_digest);
  assert.equal(first.plan_hash, relocated.plan_hash);
  assert.deepEqual(first.values, relocated.values);
  assert.equal(relocated.match_mask_sql, first.match_mask_sql.replace(/\$(\d+)/gu, (_, index: string) => `$${Number(index) + 3}`));
  assert.deepEqual([...new Set([...relocated.match_mask_sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])))], [4, 5]);
  for (const offset of [-1, 0.5, NaN, Infinity, 1001, "3", null]) {
    assert.throws(() => compile(rules(), {placeholderOffset: offset} as never));
  }
  assert.throws(() => compile(rules(), {placeholderOffset: 0, alias: "caller_sql"} as never));
  assert.match(compile(rules(), {placeholderOffset: 998}).match_mask_sql, /\$1000::text/u);
  assert.throws(() => compile(rules(), {placeholderOffset: 999}), /parameter_limit/u);
  assert.equal(first.compiler_version, SIGNAL_TOPIC_RULE_COHORT_COMPILER_V1);
  assert.match(first.plan_hash, /^sha256:[a-f0-9]{64}$/u);
});

test("SQL, regex and query-language metacharacters stay phrase data, never become SQL source", () => {
  for (const phrase of ["x'; DROP TABLE mentions; --", "a.*(b)", "football | music:*", "O'Reilly", "a & b ! c"]) {
    const selected = rules(); selected[0]!.rule_spec = spec(phrase);
    const compiled = compile(selected);
    assert.ok(compiled.values.includes(phrase));
    assert.doesNotMatch(compiled.match_mask_sql, /DROP TABLE|mentions|O'Reilly|music:\*|a\.\*/u);
    assert.match(compiled.match_mask_sql, /phraseto_tsquery\('simple', \$1::text\)/u);
    assert.doesNotMatch(compiled.match_mask_sql, /regexp|\bto_tsquery\(|\bLIKE\b|\bILIKE\b/u);
  }
  for (const phrase of ["", " ", "! & |", "😀", "x".repeat(161)]) {
    assert.throws(() => compile([{candidate_key: "alpha", rule_spec: spec(phrase)}, rules()[1]]));
  }
});

test("closed precomputed vector mode shares document tokenization without changing rules, filters or binds", () => {
  const selected = rules();
  selected[0]!.rule_spec.lexical = {any: ["football", "world cup"], all: ["alexa"], not: ["offer"]};
  selected[0]!.rule_spec.filters.markets = ["MX"];
  const plain = compile(selected), cached = compile(selected, {precomputedVector: true});
  const relocated = compile(selected, {precomputedVector: true, placeholderOffset: 3});
  assert.equal(cached.cohort_digest, plain.cohort_digest);
  assert.deepEqual(cached.values, plain.values);
  assert.equal(cached.filter_mask_sql, plain.filter_mask_sql);
  assert.equal(cached.match_mask_sql, plain.match_mask_sql.replaceAll(
    "to_tsvector('simple', COALESCE(eligible.text_clean, ''))", "eligible.search_vector"));
  assert.doesNotMatch(cached.match_mask_sql, /to_tsvector/u);
  assert.match(cached.match_mask_sql, /eligible\.search_vector @@ phraseto_tsquery/u);
  assert.notEqual(cached.plan_hash, plain.plan_hash, "physical plan records the fixed vector execution mode");
  assert.equal(cached.plan_hash, relocated.plan_hash);
  assert.deepEqual(cached.rules.map(row => row.plan_hash), plain.rules.map(row => row.plan_hash));
  assert.deepEqual(compile(selected, {precomputedVector: false}), plain);
  for (const option of ["eligible.search_vector", "TRUE", 1, null]) {
    assert.throws(() => compile(selected, {precomputedVector: option} as never));
  }
  assert.throws(() => compile(selected, {precomputedVector: true, vectorSql: "caller_sql"} as never));
});

test("identical rules count a covered membership once and share it once per rule", () => {
  const result = two([bucket(3, 3, 4)]);
  assert.equal(result.counts.covered, 4); assert.equal(result.counts.multiple_match, 4);
  assert.equal(result.counts.single_match, 0);
  assert.deepEqual(result.per_rule, [{candidate_key: "alpha", matched: 4, exclusive: 0, shared: 4},
    {candidate_key: "beta", matched: 4, exclusive: 0, shared: 4}]);
  assert.equal(result.pairs[0]!.intersection, 4);
});

test("disjoint and subset rules have exact union, exclusive, shared and pair counts", () => {
  const disjoint = two([bucket(3, 1, 3), bucket(3, 2, 5)]);
  assert.equal(disjoint.counts.covered, 8); assert.equal(disjoint.counts.single_match, 8);
  assert.equal(disjoint.pairs[0]!.intersection, 0);
  assert.deepEqual(disjoint.per_rule.map((rule) => [rule.matched, rule.exclusive, rule.shared]), [[3, 3, 0], [5, 5, 0]]);
  const subset = two([bucket(3, 3, 2), bucket(3, 1, 3), bucket(3, 0)]);
  assert.equal(subset.counts.covered, 5); assert.equal(subset.counts.multiple_match, 2);
  assert.equal(subset.counts.single_match, 3); assert.equal(subset.counts.abstained, 1);
  assert.deepEqual(subset.per_rule.map((rule) => [rule.matched, rule.exclusive, rule.shared]), [[5, 3, 2], [2, 0, 2]]);
  assert.equal(subset.pairs[0]!.intersection, 2);
});

test("three-way overlap is union1, multiple1, shared1 for each rule and three pair intersections1", () => {
  const result = aggregate({candidate_keys: ["alpha", "beta", "gamma"], total: 1, histogram: [bucket(7, 7)]});
  assert.equal(result.counts.covered, 1); assert.equal(result.counts.multiple_match, 1);
  assert.equal(result.counts.single_match, 0);
  assert.deepEqual(result.per_rule.map((rule) => [rule.matched, rule.exclusive, rule.shared]), [[1, 0, 1], [1, 0, 1], [1, 0, 1]]);
  assert.deepEqual(result.pairs, [{left_candidate_key: "alpha", right_candidate_key: "beta", intersection: 1},
    {left_candidate_key: "alpha", right_candidate_key: "gamma", intersection: 1},
    {left_candidate_key: "beta", right_candidate_key: "gamma", intersection: 1}]);
});

test("different filters partition unavailable/excluded-all/abstained and require each own filter", () => {
  const result = two([bucket(1, 1, 2), bucket(2, 0, 3), bucket(2, 2, 4), bucket(0, 0, 5),
    bucket(3, 3), bucket(0, 0, 6, false)], 24);
  assert.deepEqual(result.counts, {total: 24, considered: 21, not_tested: 3, unavailable: 6,
    excluded_by_all_filters: 5, abstained: 3, single_match: 6, multiple_match: 1, covered: 7});
  assert.deepEqual(result.per_rule.map((rule) => [rule.matched, rule.exclusive, rule.shared]), [[3, 2, 1], [5, 4, 1]]);
  assert.equal(result.pairs[0]!.intersection, 1);
  assert.throws(() => two([bucket(2, 1)]), /mask_invalid/u, "another rule's passing filter cannot authorize alpha's match");
});

test("cap conservation and histogram input order are deterministic; no quality score is fabricated", () => {
  const histogram = [bucket(0, 0, 10, false), bucket(0, 0, 10), bucket(3, 0, 20), bucket(3, 1, 40), bucket(3, 3, 20)];
  const result = two(histogram, 21195);
  assert.equal(result.counts.considered, 100); assert.equal(result.counts.not_tested, 21095);
  assert.equal(result.counts.considered, result.counts.unavailable + result.counts.excluded_by_all_filters
    + result.counts.abstained + result.counts.single_match + result.counts.multiple_match);
  assert.equal(result.counts.covered, result.counts.single_match + result.counts.multiple_match);
  for (const rule of result.per_rule) assert.equal(rule.matched, rule.exclusive + rule.shared);
  assert.deepEqual(two([...histogram].reverse(), 21195), result);
  assert.equal("precision" in result, false); assert.equal("recall" in result, false);
  assert.equal(two([], 100).counts.not_tested, 100);
});

test("maximum15-rule bit mask remains positive and computes105 intersections without inflating union", () => {
  const selected = Array.from({length: 15}, (_, index) => ({candidate_key: `candidate-${String(index).padStart(2, "0")}`, rule_spec: spec()}));
  const compiled = compile(selected), keys = compiled.rules.map((rule) => rule.candidate_key);
  assert.equal(compiled.rules[14]!.bit, 16384);
  const result = aggregate({candidate_keys: keys, total: 1, histogram: [bucket(32767, 32767)]});
  assert.equal(result.counts.covered, 1); assert.equal(result.pairs.length, 105);
  assert.ok(result.pairs.every((pair) => pair.intersection === 1));
  assert.ok(result.per_rule.every((rule) => rule.shared === 1 && rule.exclusive === 0));
});

test("invalid mask/candidate order/aggregate shape fail closed instead of attaching incorrect counts", () => {
  for (const row of [bucket(4, 0), bucket(1, 2), bucket(3, 3, 1, false), bucket(1, 0, 1, false),
    bucket(-1, 0), bucket(1.5, 0), bucket(3, 0, 0), bucket(3, 0, -1), bucket(3, 0, 0.5),
    {...bucket(3, 0), sql: "TRUE"}, {...bucket(3, 0), available: "true"}]) assert.throws(() => two([row as never]));
  for (const candidate_keys of [["beta", "alpha"], ["alpha", "alpha"], ["alpha"], ["alpha", "Bad Key"]]) {
    assert.throws(() => aggregate({candidate_keys, total: 1, histogram: [bucket(3, 0)]}));
  }
  assert.throws(() => aggregate({candidate_keys: ["alpha", "beta"], total: 0, histogram: [bucket(3, 0)]}));
  assert.throws(() => aggregate({candidate_keys: ["alpha", "beta"], total: 1, histogram: [], sql: "TRUE"} as never));
});

test("only the considered population is capped and example limit is10 for the entire cohort", () => {
  assert.equal(two([bucket(3, 1, 50000)], 100000).counts.not_tested, 50000);
  assert.throws(() => two([bucket(3, 1, 50000), bucket(3, 2)], 100000), /population_invalid/u);
  assert.throws(() => two([bucket(3, 1, 50001)], 100000));
  for (const total of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => two([], total));
  assert.equal(SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1.maximum_examples, 10);
  assert.equal(SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1.default_memberships, 25000);
  assert.equal(SIGNAL_TOPIC_RULE_COHORT_LIMITS_V1.maximum_timeout_ms, 15000);
});

test("pure cohort compiler and grouped aggregation are exported and included by standard suite", async () => {
  const [source, index, manifest] = await Promise.all([
    readFile(new URL("./signal-topic-rule-cohort-v1.ts", import.meta.url), "utf8"),
    readFile(new URL("./index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")]);
  assert.match(index, /export \* from "\.\/signal-topic-rule-cohort-v1"/u);
  assert.doesNotMatch(source, /fetch\(|process\.env|\.query\(|new Pool|Anthropic|supabase|execute\(/u);
  assert.match(JSON.parse(manifest).scripts.test, /src\/\*\.test\.ts/u);
  assert.match(source, /compileSignalTopicRuleSpecV1\(rule_spec/u);
});
