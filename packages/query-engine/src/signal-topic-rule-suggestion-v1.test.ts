import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adaptSignalTopicRuleSuggestionToDraftV1, parseSignalTopicRuleSuggestionV1,
  prepareSignalTopicRuleSuggestionContextV1, SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1,
  type SignalTopicRuleSuggestionContextV1, type SignalTopicRuleSuggestionV1
} from "./signal-topic-rule-suggestion-v1";
import { compileSignalTopicRuleSpecV1, parseSignalTopicRuleSpecV1, signalTopicRuleSpecDigestV1 }
  from "./signal-topic-rule-spec-v1";
import { compileSignalTopicRuleCohortV1 } from "./signal-topic-rule-cohort-v1";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const context = (): SignalTopicRuleSuggestionContextV1 => {
  const source = {workspace_id: "00000000-0000-4000-8000-000000000001", run_key: "fixture-run-1",
    candidate_key: "echo-football", snapshot_digest: digest("a"), session_key: "fixture-session-1",
    candidate_revision: 1, candidate_state_token: digest("b"), candidate_version_digest: digest("c")};
  return {source, candidate: {label: "Alexa y fútbol", definition: "Conversación sobre Alexa durante el fútbol.",
    inclusion: ["Uso de voz durante partidos"], exclusion: ["Soporte técnico sin relación al deporte"],
    source_cluster_keys: ["cluster-football"], historical_evidence_refs: [digest("f")]},
  draft: {revision: 0, digest: null},
  brand_os: {source: {...source}, status: "available", authority_digest: digest("d"), elements: [
    {element_key: "benefit.hands-free", element_kind: "benefit", display_text: "Conveniencia mediante voz",
      scope: "workspace", locale: null, source_refs_digest: digest("e"), evidence_count: 2}]},
  traces: [{source: {...source}, trace_index: 3, operation: "representative_mentions",
    cluster_key: "cluster-football", result_digest: digest("0"), mentions: [
      {evidence_ref: digest("1"), status: "available", source_digest: digest("2"),
        excerpt: "Le pido a Alexa los resultados del fútbol.", language: "es", market: "MX",
        scope: "primary_brand", month: "2026-08", stratum: "central"}]},
  {source: {...source}, trace_index: 4, operation: "search_cluster", cluster_key: "cluster-football",
    result_digest: digest("3"), mentions: [{evidence_ref: digest("4"), status: "available",
      source_digest: digest("5"), excerpt: "Echo acompaña mis partidos de fútbol.", language: "es",
      market: "MX", scope: "primary_brand", month: "2026-08", stratum: "edge"}]}]};
};
const suggestion = (): SignalTopicRuleSuggestionV1 => ({contract_version: "signal-topic-rule-suggestion-v1",
  status: "suggested", lexical: {any: ["Alexa fútbol", "Echo partidos"], all: [], not: ["soporte técnico"]},
  filters: {languages: [], markets: [], scopes: []}, evidence_refs: [digest("1"), digest("4")],
  explanation: "Las menciones describen uso de Alexa y Echo durante el fútbol."});
const adapt = (ctx: unknown = context(), output: unknown = suggestion()) =>
  adaptSignalTopicRuleSuggestionToDraftV1({context: ctx, suggestion: output});

test("suggestion normalizes through existing RuleSpec schemas and preserves explicit empty filters", () => {
  const input = {...suggestion(), lexical: {any: [" Echo\t partidos ", "Alexa fútbol", "Echo partidos"],
    all: [], not: ["soporte técnico"]}, evidence_refs: [digest("4"), digest("1")]};
  const before = JSON.stringify(input), result = parseSignalTopicRuleSuggestionV1(input);
  assert.ok(result.status === "suggested");
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.lexical.any, ["Alexa fútbol", "Echo partidos"]);
  assert.deepEqual(result.evidence_refs, [digest("1"), digest("4")]);
  assert.deepEqual(result.filters, {languages: [], markets: [], scopes: []});
  assert.deepEqual(parseSignalTopicRuleSuggestionV1(result), result);
});

test("one simulated candidate reaches the actual individual and joint compilers with saved identity/CAS", () => {
  const ctx = context(); ctx.draft = {revision: 7, digest: digest("7")};
  const before = JSON.stringify(ctx), result = adapt(ctx);
  assert.ok(result.status === "suggested");
  assert.equal(JSON.stringify(ctx), before);
  assert.equal(result.rule_spec.label, ctx.candidate.label);
  assert.equal(result.rule_spec.definition, ctx.candidate.definition);
  assert.equal(result.expected_candidate_revision, 1);
  assert.equal(result.expected_candidate_state_token, ctx.source.candidate_state_token);
  assert.equal(result.expected_draft_revision, 7);
  assert.equal(result.expected_draft_digest, digest("7"));
  assert.deepEqual(parseSignalTopicRuleSpecV1(result.rule_spec), result.rule_spec);
  const compiled = compileSignalTopicRuleSpecV1(result.rule_spec, {placeholderOffset: 3});
  assert.equal(compiled.spec_digest, result.spec_digest);
  assert.equal(compiled.filter_predicate, "TRUE");
  assert.deepEqual(compiled.values, ["Alexa fútbol", "Echo partidos", "soporte técnico"]);
  assert.equal(result.provenance.evidence[0]!.source_digest, digest("2"));
  assert.equal(result.provenance.evidence[0]!.traces[0]!.trace_index, 3);
  const joint = compileSignalTopicRuleCohortV1([
    {candidate_key: ctx.source.candidate_key, rule_spec: result.rule_spec},
    {candidate_key: "explicit-second-fixture", rule_spec: {...result.rule_spec, label: "Otro fixture"}}
  ]);
  assert.equal(joint.rules.length, 2, "compatibility fixture, not two persisted topics or measured results");
  assert.equal(joint.rules[0]!.spec_digest, result.spec_digest);
});

test("deterministic replay binds provenance and edits change only the subsequent RuleSpec", () => {
  const first = adapt(), ctx = context();
  ctx.traces.reverse();
  const again = adapt(ctx, {...suggestion(), evidence_refs: [digest("4"), digest("1")]});
  assert.deepEqual(again, first);
  assert.ok(first.status === "suggested");
  const original = JSON.stringify(first);
  const edited = parseSignalTopicRuleSpecV1({...first.rule_spec, lexical: {any: ["Alexa goles"], all: [], not: []}});
  assert.notEqual(signalTopicRuleSpecDigestV1(edited), first.spec_digest);
  assert.equal(JSON.stringify(first), original);
  const renamed = context(); renamed.candidate.label = "Título guardado distinto";
  assert.notEqual(adapt(renamed).suggestion_digest, first.suggestion_digest);
  const newDraft = context(); newDraft.draft = {revision: 1, digest: digest("8")};
  assert.notEqual(adapt(newDraft).suggestion_digest, first.suggestion_digest);
});

test("insufficient evidence is explicit and cannot carry a rule, invented metrics or effects", () => {
  const ctx = context(); ctx.traces = [];
  const output = {contract_version: "signal-topic-rule-suggestion-v1", status: "insufficient_evidence",
    explanation: "No hay menciones suficientes para proponer frases."};
  const result = adapt(ctx, output);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.rule_spec, null); assert.equal(result.spec_digest, null);
  assert.deepEqual(result.provenance.evidence, []);
  for (const extra of [{lexical: {any: ["a"], all: [], not: []}}, {evidence_refs: []},
    {coverage: 42}, {provider_calls: 0}, {publication: false}]) {
    assert.throws(() => parseSignalTopicRuleSuggestionV1({...output, ...extra}));
  }
});

test("closed model output rejects ownership, authority, code, identity, unknown fields and limits", () => {
  for (const extra of [{workspace_id: context().source.workspace_id}, {candidate_key: "other"},
    {label: "Renamed"}, {definition: "Renamed"}, {verified: true}, {authority_digest: digest("0")},
    {state_token: digest("0")}, {sql: "SELECT true"}, {regex: ".*"}, {javascript: "return true"},
    {prompt: "another prompt"}, {tools: []}, {suggestion_digest: digest("0")}]) {
    assert.throws(() => parseSignalTopicRuleSuggestionV1({...suggestion(), ...extra}));
  }
  for (const output of [
    {...suggestion(), lexical: {any: [], all: [], not: ["spam"]}},
    {...suggestion(), lexical: {any: ["a"], all: [], not: [], sql: "true"}},
    {...suggestion(), filters: {languages: [], markets: [], scopes: [], columns: []}},
    {...suggestion(), filters: {languages: ["en-US"], markets: [], scopes: []}},
    {...suggestion(), explanation: " "}, {...suggestion(), explanation: "x".repeat(601)},
    {...suggestion(), lexical: {any: ["x".repeat(161)], all: [], not: []}},
    {...suggestion(), lexical: {any: Array(17).fill("x"), all: [], not: []}},
    {...suggestion(), lexical: {any: Array(16).fill("a"), all: Array(16).fill("b"), not: ["c"]}},
    {...suggestion(), lexical: {any: ["😀.*"], all: [], not: []}},
    {...suggestion(), evidence_refs: []}, {...suggestion(), evidence_refs: [digest("1"), digest("1")]},
    {...suggestion(), evidence_refs: Array.from({length: 13}, (_, index) => digest(index.toString(16)))},
    {...suggestion(), evidence_refs: ["http://not-an-evidence-reference"]}
  ]) assert.throws(() => parseSignalTopicRuleSuggestionV1(output));
});

test("ordinary SQL/regex-looking phrase characters remain parameterized data", () => {
  const phrase = "Alexa'; DROP TABLE candidate; --";
  const result = adapt(context(), {...suggestion(), lexical: {any: [phrase, "Echo.*(football)"], all: [], not: []}});
  assert.ok(result.status === "suggested");
  const compiled = compileSignalTopicRuleSpecV1(result.rule_spec);
  assert.ok(compiled.values.includes(phrase));
  assert.doesNotMatch(compiled.predicate, /DROP|candidate|football/u);
  assert.match(compiled.predicate, /phraseto_tsquery/u);
});

test("historical refs are not fresh citations, but an actual same-session reread may cite the same ref", () => {
  const ctx = context();
  assert.throws(() => adapt(ctx, {...suggestion(), evidence_refs: [digest("f")]}), /citation_not_read/u);
  const prepared = prepareSignalTopicRuleSuggestionContextV1(ctx);
  assert.doesNotMatch(JSON.stringify(prepared), new RegExp(digest("f"), "u"));
  ctx.traces[0]!.mentions[0]!.evidence_ref = digest("f");
  assert.equal(adapt(ctx, {...suggestion(), evidence_refs: [digest("f")]}).status, "suggested");
});

test("cross-workspace/run/snapshot/session/candidate/revision/authority contexts are rejected", () => {
  const changes = {workspace_id: "00000000-0000-4000-8000-000000000002", run_key: "another-run",
    snapshot_digest: digest("9"), session_key: "another-session", candidate_key: "another-candidate",
    candidate_revision: 2, candidate_state_token: digest("8"), candidate_version_digest: digest("7")};
  for (const [field, value] of Object.entries(changes)) {
    for (const target of ["trace", "brand"] as const) {
      const ctx = context();
      const source = target === "trace" ? ctx.traces[0]!.source : ctx.brand_os.source;
      Object.assign(source, {[field]: value});
      assert.throws(() => adapt(ctx), /context_mismatch/u, `${target}.${field}`);
    }
  }
  const foreignCluster = context(); foreignCluster.traces[0]!.cluster_key = "other-cluster";
  assert.throws(() => adapt(foreignCluster), /context_mismatch/u);
});

test("unavailable citations and conflicting source digests fail even after an earlier successful read", () => {
  const ctx = context();
  ctx.traces[1]!.mentions = [{evidence_ref: digest("1"), status: "unavailable", reason: "rights_changed"}];
  assert.throws(() => adapt(ctx, {...suggestion(), evidence_refs: [digest("1")]}), /citation_unavailable/u);
  const conflict = context();
  conflict.traces[1]!.mentions = [{...conflict.traces[0]!.mentions[0]!, source_digest: digest("9")} as never];
  assert.throws(() => adapt(conflict), /source_mismatch/u);
  const repeat = context(); repeat.traces[1]!.mentions = structuredClone(repeat.traces[0]!.mentions);
  const result = adapt(repeat, {...suggestion(), evidence_refs: [digest("1")]});
  assert.equal(result.provenance.evidence[0]!.traces.length, 2, "legitimate repeated retrieval is not a duplicate output citation");
});

test("empty or unavailable Brand OS stays explicit, preserves available mentions and does not imply Global", () => {
  for (const status of ["empty", "unavailable"] as const) {
    const ctx = context(); ctx.brand_os = {...ctx.brand_os, status, elements: [], authority_digest: null};
    const prepared = prepareSignalTopicRuleSuggestionContextV1(ctx), result = adapt(ctx);
    assert.equal(prepared.bootstrap.brand_os.status, status);
    assert.equal(prepared.history.length, 2);
    assert.equal(result.status, "suggested");
    assert.equal(result.provenance.brand_os_status, status);
    assert.equal(result.provenance.brand_os_authority_digest, null);
    assert.ok(result.status === "suggested");
    assert.deepEqual(result.rule_spec.filters, {languages: [], markets: [], scopes: []});
  }
  for (const change of [{status: "available", elements: []}, {status: "available", authority_digest: null},
    {status: "empty"}, {status: "unavailable"}]) {
    assert.throws(() => adapt({...context(), brand_os: {...context().brand_os, ...change}}));
  }
});

test("context rejects unknown authority shortcuts, invalid CAS and navigation bounds", () => {
  for (const value of [{...context(), verified: true}, {...context(), actor: {id: "injected"}},
    {...context(), source: {...context().source, verified: true}},
    {...context(), candidate: {...context().candidate, approved: true}},
    {...context(), brand_os: {...context().brand_os, verified: true}},
    {...context(), draft: {revision: 0, digest: digest("a")}},
    {...context(), draft: {revision: 1, digest: null}},
    {...context(), traces: [{...context().traces[0], trace_index: 2}]},
    {...context(), traces: [{...context().traces[0], trace_index: 13}]},
    {...context(), traces: [context().traces[0], context().traces[0]]},
    {...context(), traces: [{...context().traces[0], operation: "candidate_context"}]},
    {...context(), traces: [{...context().traces[0], raw_sql: "SELECT true"}]},
    {...context(), traces: [{...context().traces[0], mentions: [context().traces[0]!.mentions[0], context().traces[0]!.mentions[0]]}]}
  ]) assert.throws(() => prepareSignalTopicRuleSuggestionContextV1(value));
  assert.throws(() => adaptSignalTopicRuleSuggestionToDraftV1({...{suggestion: suggestion(), context: context()},
    verified: true} as never));
  const ctx = context(); ctx.candidate.inclusion = Array(16).fill("Saved inclusion");
  ctx.candidate.exclusion = Array(16).fill("Saved exclusion");
  assert.equal(prepareSignalTopicRuleSuggestionContextV1(ctx).bootstrap.candidate.inclusion.length, 16);
  assert.throws(() => prepareSignalTopicRuleSuggestionContextV1({...ctx,
    candidate: {...ctx.candidate, inclusion: Array(17).fill("Too many")}}));
});

test("large valid bootstrap compacts prose without evicting Brand OS metadata or all available mention evidence", () => {
  const ctx = context();
  ctx.brand_os.elements = Array.from({length: 40}, (_, index) => ({...ctx.brand_os.elements[0]!,
    element_key: `benefit.voice-${index}`, display_text: "Brand OS context ".repeat(40).slice(0, 600),
    locale: "es-MX"}));
  ctx.traces = Array.from({length: 10}, (_, index) => ({...ctx.traces[1]!, source: {...ctx.source},
    trace_index: index + 3, mentions: Array.from({length: 20}, (_, mentionIndex) => ({
      ...ctx.traces[1]!.mentions[0]!, evidence_ref: `sha256:${(index * 20 + mentionIndex).toString(16).padStart(64, "0")}`,
      excerpt: "Mención disponible sobre Alexa durante un partido. ".repeat(15).slice(0, 600)
    }))}));
  const before = JSON.stringify(ctx), projected = prepareSignalTopicRuleSuggestionContextV1(ctx);
  assert.equal(JSON.stringify(ctx), before);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= 18 * 1024);
  assert.equal(projected.bootstrap.candidate.label, ctx.candidate.label);
  assert.equal(projected.bootstrap.candidate.definition, ctx.candidate.definition);
  assert.equal(projected.bootstrap.brand_os.elements.length, 40);
  const element = projected.bootstrap.brand_os.elements[0]!;
  assert.equal(element.element_kind, "benefit"); assert.equal(element.scope, "workspace");
  assert.equal(element.locale, "es-MX"); assert.equal(element.source_refs_digest, digest("e"));
  assert.equal(element.evidence_count, 2);
  assert.ok(projected.history.some((trace) => trace.trace_index === 12
    && trace.mentions.some((mention) => mention.status === "available" && mention.excerpt.length >= 60)));
  assert.equal(projected.omitted_trace_count, 10 - projected.history.length);
  assert.equal(projected.omitted_mention_count, 200 - projected.history.reduce((sum, trace) => sum + trace.mentions.length, 0));
  assert.equal(projected.bootstrap_compacted, true);
  assert.deepEqual(prepareSignalTopicRuleSuggestionContextV1(ctx), projected);
});

test("projection keeps a recent available trace even when a newer trace is unavailable and sanitizes excerpts", () => {
  const ctx = context();
  const mention = ctx.traces[0]!.mentions[0]!;
  assert.ok(mention.status === "available");
  mention.excerpt = "Alexa fútbol @somehandle https://example.test/private sample@example.test";
  ctx.traces[1]!.mentions = [{evidence_ref: digest("4"), status: "unavailable", reason: "source_changed"}];
  const projection = prepareSignalTopicRuleSuggestionContextV1(ctx);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /somehandle|example\.test|workspace_id|historical_evidence_refs/u);
  assert.match(serialized, /\[handle\]|\[url\]|\[email\]/u);
  assert.ok(projection.history.some((trace) => trace.mentions.some((entry) => entry.status === "available")));
});

test("compaction pins usable A evidence rather than available B excerpts vetoed by a later rights change", () => {
  const ctx = context();
  ctx.brand_os.elements = Array.from({length: 40}, (_, index) => ({...ctx.brand_os.elements[0]!,
    element_key: `benefit.voice-${index}`, display_text: "Brand OS context ".repeat(40).slice(0, 600),
    locale: "es-MX"}));
  const source = ctx.traces[1]!;
  const makeMentions = (offset: number) => Array.from({length: 20}, (_, index) => ({
    ...source.mentions[0]!, evidence_ref: `sha256:${(offset + index).toString(16).padStart(64, "0")}`,
    excerpt: `Evidence ${offset === 0 ? "A" : "B"}: Alexa durante un partido. `.repeat(20).slice(0, 600)
  }));
  const a = makeMentions(0), b = makeMentions(20);
  ctx.traces = [{...source, trace_index: 3, mentions: a}, {...source, trace_index: 4, mentions: b},
    {...source, trace_index: 5, mentions: b.map(({evidence_ref}) =>
      ({evidence_ref, status: "unavailable", reason: "rights_changed"}))}];
  const before = JSON.stringify(ctx), projected = prepareSignalTopicRuleSuggestionContextV1(ctx);
  assert.equal(JSON.stringify(ctx), before);
  assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= 18432);
  assert.equal(projected.bootstrap.brand_os.elements.length, 40);
  const visibleAvailable = projected.history.flatMap((trace) => trace.mentions)
    .filter((mention) => mention.status === "available");
  assert.ok(visibleAvailable.length > 0);
  assert.ok(projected.history.some((trace) => trace.trace_index === 3
    && trace.mentions.some((mention) => mention.status === "available")));
  for (const mention of visibleAvailable) {
    assert.ok(a.some((item) => item.evidence_ref === mention.evidence_ref));
    assert.equal(adapt(ctx, {...suggestion(), evidence_refs: [mention.evidence_ref]}).status, "suggested");
  }
  assert.doesNotMatch(JSON.stringify(projected), /Evidence B:/u);
  for (const {evidence_ref} of b) {
    assert.throws(() => adapt(ctx, {...suggestion(), evidence_refs: [evidence_ref]}), /citation_unavailable/u);
  }
});

test("the adapter and projection are exported pure data functions without transport, storage or claim paths", async () => {
  const [source, index] = await Promise.all([
    readFile(new URL("./signal-topic-rule-suggestion-v1.ts", import.meta.url), "utf8"),
    readFile(new URL("./index.ts", import.meta.url), "utf8")]);
  assert.match(index, /export \* from "\.\/signal-topic-rule-suggestion-v1"/u);
  assert.doesNotMatch(source, /fetch\(|process\.env|\.query\(|new Pool|new Anthropic|appendSignal|createSignal|runSignal|execute\(|node:fs|node:child_process/u);
  assert.match(source, /NOT authentication/u);
  assert.equal(SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.context_bytes, 18432);
  assert.equal(SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.maximum_mention_traces
    + SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.bootstrap_navigation_calls, 12);
});
