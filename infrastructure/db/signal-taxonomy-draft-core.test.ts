import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import test from "node:test";
import type {Pool} from "pg";
import {normalizeSignalTaxonomyProposalV1, signalTaxonomyContextHashV1,
  type SignalTaxonomyContextRefV1} from "@noisia/query-engine";
import {createSignalTaxonomyDraftStoreV1, insertSignalTaxonomyDraftCoreV1,
  type CreateSignalTaxonomyDraftStoreInputV1, type SignalTaxonomyDraftInsertClient} from "./signal-taxonomy-profile";

const workspace = "11111111-1111-4111-8111-111111111111";
const corpus = "22222222-2222-4222-8222-222222222222";
const otherWorkspace = "99999999-9999-4999-8999-999999999999";
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const governed = [{source_type: "brand_os_objective" as const,
  source_id: "33333333-3333-4333-8333-333333333333", version: "brand-os:2", content: "Understand football discussion."},
  {source_type: "brand_os_brief" as const, source_id: "44444444-4444-4444-8444-444444444444", version: "v1", content: "  "}];
const mention = {source_type: "mention_sample" as const,
  source_id: "55555555-5555-4555-8555-555555555555", version: "corpus:7", content: "A fake football mention."};
const refs: SignalTaxonomyContextRefV1[] = [governed[0]!, mention].map(({source_type, source_id, version, content}) =>
  ({source_type, source_id, version, content_hash: hash(content)}));
const contextHash = signalTaxonomyContextHashV1(refs);
type Query = {sql: string; values: unknown[]; via: "pool" | "client"};
type Profile = {id: string; workspace_id: string; kind: string; version: number; status: string; context_hash: string};
type Inserted = {id: string; table: string; values: unknown[]};
type Store = {profiles: Profile[]; inserted: Inserted[]};

/** An explicit in-memory SQL protocol fake, never a real Pool/client or database URL.
 * It checks transaction/allocator ordering and preserves state on savepoint/outer rollback.
 */
function fixture(active = true) {
  const state = {active, connectCount: 0, releaseCount: 0, missingCorpus: false,
    failTable: null as string | null, store: {profiles: [], inserted: []} as Store};
  const queries: Query[] = [];
  let outer: Store | null = active ? structuredClone(state.store) : null;
  let savepoint: Store | null = null, serial = 0;
  const locks = new Set<string>();
  const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++serial).padStart(12, "0")}`;
  const client = {async query(sql: string, values: unknown[] = []) {
    queries.push({sql, values: structuredClone(values), via: "client"});
    const normalized = sql.trim().replace(/\s+/gu, " ");
    let rows: unknown[] = [];
    if (normalized === "BEGIN") {
      assert.equal(state.active, false, "the legacy wrapper must never be nested in a reserved transaction");
      state.active = true; outer = structuredClone(state.store); locks.clear();
    } else if (normalized === "COMMIT") {
      assert.equal(state.active, true); state.active = false; outer = null; locks.clear();
    } else if (normalized === "ROLLBACK") {
      if (outer) state.store = structuredClone(outer);
      state.active = false; outer = null; savepoint = null; locks.clear();
    } else if (normalized === "SAVEPOINT signal_taxonomy_insert_core_v1") {
      if (!state.active) throw Object.assign(new Error("fake transaction required"), {code: "25P01"});
      savepoint = structuredClone(state.store);
    } else if (normalized === "ROLLBACK TO SAVEPOINT signal_taxonomy_insert_core_v1") {
      assert.ok(savepoint); state.store = structuredClone(savepoint);
    } else if (normalized === "RELEASE SAVEPOINT signal_taxonomy_insert_core_v1") {
      assert.ok(savepoint); savepoint = null;
    } else if (normalized.startsWith("SELECT pg_advisory_xact_lock")) {
      assert.equal(state.active, true); locks.add(String(values[0]));
    } else if (normalized.startsWith("SELECT COALESCE(MAX(version)")) {
      assert.ok(locks.has(`signal-taxonomy:${String(values[0])}:${String(values[1])}`), "global lock precedes allocator");
      assert.deepEqual(values, [workspace, "topic"]);
      rows = [{version: Math.max(0, ...state.store.profiles.filter((row) => row.workspace_id === values[0]
        && row.kind === values[1]).map((row) => row.version)) + 1}];
    } else if (normalized.startsWith("SELECT id::text, version FROM signal_taxonomy_profiles")) {
      assert.ok(locks.has(`signal-taxonomy:${String(values[0])}:${String(values[1])}`));
      rows = state.store.profiles.filter((row) => row.workspace_id === values[0] && row.kind === values[1]
        && row.status === "draft" && row.context_hash === values[2]).sort((a, b) => b.version - a.version).slice(0, 1);
    } else if (normalized.startsWith("INSERT INTO ")) {
      assert.equal(state.active, true);
      const table = /^INSERT INTO ([a-z_]+)/u.exec(normalized)?.[1];
      assert.ok(table && ["taxonomies", "taxonomy_terms", "tagging_rule_sets", "tagging_model_versions",
        "signal_taxonomy_profiles", "lineage_edges"].includes(table), "only the existing catalog stores are written");
      if (table === state.failTable) throw Object.assign(new Error("fake insertion failure"), {code: "23514"});
      const inserted = {id: id(), table, values: structuredClone(values)};
      state.store.inserted.push(inserted);
      if (table === "signal_taxonomy_profiles") state.store.profiles.push({id: inserted.id,
        workspace_id: String(values[0]), kind: String(values[2]), version: Number(values[3]),
        status: "draft", context_hash: String(values[4])});
      rows = /RETURNING id::text/u.test(normalized) ? [{id: inserted.id}] : [];
    } else throw new Error(`unexpected fake-client SQL: ${normalized.slice(0, 90)}`);
    return {rows, rowCount: rows.length};
  }, release() {state.releaseCount++;}};
  const pool = {async query(sql: string, values: unknown[] = []) {
    queries.push({sql, values: structuredClone(values), via: "pool"});
    let rows: unknown[];
    if (sql.includes("SELECT corpus_revision")) {
      assert.deepEqual(values, [corpus]); rows = state.missingCorpus ? [] : [{corpus_revision: 7}];
    } else if (sql.includes("WITH workspace_scope AS")) {
      assert.deepEqual(values, [workspace, corpus]); rows = governed;
    } else if (sql.includes("SELECT 'mention_sample'")) {
      assert.deepEqual(values, [corpus, 7]); rows = [mention];
    } else throw new Error("unexpected fake-pool SQL");
    return {rows, rowCount: rows.length};
  }, async connect() {state.connectCount++; return client;}};
  return {state, queries, client: client as SignalTaxonomyDraftInsertClient, pool: pool as unknown as Pool};
}

function coreArgs(f: ReturnType<typeof fixture>, family = "family-a", familyRevision = 1) {
  return {client: f.client, workspace_id: workspace, kind: "topic" as const, context_hash: hash(family),
    terms: [{term_key: "football", label: "Football", definition: "F".repeat(1500), metadata: {candidate_key: "football", revision: 1}},
      {term_key: "music", label: "Music", definition: "Music discussion", metadata: {candidate_key: "music", evidence_refs: [hash("evidence")]}}],
    rules: {contract_version: "signal-topic-rule-cohort-v1", family, rules: [{candidate_key: "football"}, {candidate_key: "music"}]},
    rule_set_metadata: {family, cohort_revision: familyRevision}, provider: "operator",
    model_version: "deterministic-simple-fts-v1", prompt_hash: hash("plan"),
    model_metadata: {execution_kind: "deterministic", provider_calls: 0, cost_micro_usd: 0},
    profile_metadata: {family, cohort_revision: familyRevision}, context_refs: []};
}
function legacyInput(): CreateSignalTaxonomyDraftStoreInputV1 {
  return {kind: "topic", provider: "operator", model_version: "legacy-model", prompt_hash: hash("legacy-prompt"),
    terms: [{term_key: "music", label: "Music", definition: "Music discussion", statement: null,
      examples: ["A music example."], exclusions: ["Device-only reviews."]},
    {term_key: "football", label: "Football", definition: "Football discussion", statement: null,
      examples: ["A football example."], exclusions: []}]};
}
const legacyArgs = (f: ReturnType<typeof fixture>, input = legacyInput()) => ({pool: f.pool,
  workspace_id: workspace, study_corpus_id: corpus, input});
const inserts = (f: ReturnType<typeof fixture>, table: string) => f.state.store.inserted.filter((row) => row.table === table);
const valueJson = (value: unknown): unknown => JSON.parse(String(value));

test("shared insertion uses SAVEPOINT only and acquires exact global allocator lock before MAX(version)+1", async () => {
  const f = fixture(), result = await insertSignalTaxonomyDraftCoreV1(coreArgs(f));
  const sql = f.queries.map((row) => row.sql.trim());
  assert.equal(sql[0], "SAVEPOINT signal_taxonomy_insert_core_v1");
  assert.equal(sql.at(-1), "RELEASE SAVEPOINT signal_taxonomy_insert_core_v1");
  assert.equal(sql.some((statement) => /^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(statement)), false);
  const lock = f.queries.findIndex((query) => query.sql.includes("pg_advisory_xact_lock"));
  const allocation = f.queries.findIndex((query) => query.sql.includes("MAX(version)"));
  assert.ok(lock > 0 && allocation > lock);
  assert.deepEqual(f.queries[lock]!.values, [`signal-taxonomy:${workspace}:topic`]);
  assert.deepEqual(f.queries[allocation]!.values, [workspace, "topic"]);
  assert.equal(result.version, 1); assert.equal(f.state.active, true);
  assert.equal(f.state.connectCount, 0); assert.equal(f.state.releaseCount, 0);
  assert.equal(f.queries.some((query) => query.via === "pool"), false, "core never invokes the legacy context loader");
});

test("two families and later family revisions share global profile/ruleset versions, not family revisions", async () => {
  const f = fixture();
  f.state.store.profiles.push({id: "prior-topic", workspace_id: workspace, kind: "topic", version: 4, status: "active", context_hash: hash("prior")},
    {id: "other-kind", workspace_id: workspace, kind: "narrative", version: 50, status: "draft", context_hash: hash("narrative")},
    {id: "other-workspace", workspace_id: otherWorkspace, kind: "topic", version: 99, status: "draft", context_hash: hash("other")});
  const first = await insertSignalTaxonomyDraftCoreV1(coreArgs(f, "family-a", 1));
  const second = await insertSignalTaxonomyDraftCoreV1(coreArgs(f, "family-b", 1));
  const third = await insertSignalTaxonomyDraftCoreV1(coreArgs(f, "family-a", 2));
  assert.deepEqual([first.version, second.version, third.version], [5, 6, 7]);
  assert.deepEqual(inserts(f, "tagging_rule_sets").map((row) => row.values[1]), [5, 6, 7]);
  assert.equal(new Set(inserts(f, "tagging_rule_sets").map((row) => row.values[0])).size, 1);
  assert.deepEqual(inserts(f, "signal_taxonomy_profiles").map((row) => valueJson(row.values[7])),
    [{family: "family-a", cohort_revision: 1}, {family: "family-b", cohort_revision: 1}, {family: "family-a", cohort_revision: 2}]);
  assert.equal(f.state.store.profiles[0]!.status, "active", "existing active catalog remains untouched");
  // End this simulated caller transaction before invoking the deliberately transaction-owning legacy wrapper.
  await f.client.query("COMMIT");
  const fourth = await createSignalTaxonomyDraftStoreV1(legacyArgs(f));
  assert.equal(fourth.version, 8); assert.equal(fourth.reused, false);
  assert.equal(f.state.active, false);
});

test("core preserves multiple terms, full1500-character definition and exact metadata with candidate/draft provenance only", async () => {
  const f = fixture(), args = coreArgs(f), result = await insertSignalTaxonomyDraftCoreV1(args);
  assert.equal(inserts(f, "taxonomies").length, 1); assert.equal(inserts(f, "signal_taxonomy_profiles").length, 1);
  assert.equal(inserts(f, "tagging_rule_sets").length, 1); assert.equal(inserts(f, "tagging_model_versions").length, 1);
  const terms = inserts(f, "taxonomy_terms"); assert.equal(terms.length, 2);
  terms.forEach((row, index) => {
    assert.deepEqual(row.values.slice(0, 5), [result.taxonomyId, args.terms[index]!.term_key,
      args.terms[index]!.label, args.terms[index]!.definition, index + 1]);
    assert.deepEqual(valueJson(row.values[5]), args.terms[index]!.metadata);
  });
  assert.equal(String(terms[0]!.values[3]).length, 1500);
  assert.deepEqual(valueJson(inserts(f, "tagging_rule_sets")[0]!.values[3]), args.rules);
  const model = inserts(f, "tagging_model_versions")[0]!;
  assert.equal(model.values[1], "operator");
  assert.deepEqual(valueJson(model.values[5]), {execution_kind: "deterministic", provider_calls: 0, cost_micro_usd: 0});
  const statements = f.queries.map((row) => row.sql).join("\n");
  assert.doesNotMatch(statements, /activate_signal|INSERT INTO (?:signal_classification|record_tags|.*outbox)|'active'/u);
  assert.match(statements, /'candidate'/u); assert.match(statements, /'draft'/u);
  assert.equal(inserts(f, "lineage_edges").length, 3, "no fabricated source examples/context when none were supplied");
});

test("missing outer transaction fails before writes; partial insertion rolls back only its savepoint", async () => {
  const missing = fixture(false);
  await assert.rejects(insertSignalTaxonomyDraftCoreV1(coreArgs(missing)), {code: "25P01"});
  assert.equal(missing.queries.length, 1); assert.equal(missing.state.store.inserted.length, 0);
  const f = fixture(); await insertSignalTaxonomyDraftCoreV1(coreArgs(f));
  const before = structuredClone(f.state.store), start = f.queries.length;
  f.state.failTable = "lineage_edges";
  await assert.rejects(insertSignalTaxonomyDraftCoreV1(coreArgs(f, "family-b")), {code: "23514"});
  assert.deepEqual(f.state.store, before); assert.equal(f.state.active, true);
  const failedSql = f.queries.slice(start).map((query) => query.sql.trim());
  assert.equal(failedSql.at(-2), "ROLLBACK TO SAVEPOINT signal_taxonomy_insert_core_v1");
  assert.equal(failedSql.at(-1), "RELEASE SAVEPOINT signal_taxonomy_insert_core_v1");
  assert.equal(failedSql.some((sql) => /^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(sql)), false);
  f.state.failTable = null;
  assert.equal((await insertSignalTaxonomyDraftCoreV1(coreArgs(f, "family-b"))).version, 2);
});

test("legacy creation retains context sampling, normalization, IDs, metadata and owned transaction", async () => {
  const f = fixture(false), input = legacyInput();
  input.discovery_usage = {input_tokens: 12, output_tokens: 4, voyage_tokens: 2, cost_usd: 0.03};
  input.expected_context_hash = contextHash;
  const proposal = normalizeSignalTaxonomyProposalV1({...input, context_refs: refs, context_hash: contextHash});
  const result = await createSignalTaxonomyDraftStoreV1(legacyArgs(f, input));
  assert.equal(result.contract_version, "signal-topics-narratives-v1");
  assert.equal(result.workspace_id, workspace); assert.equal(result.study_corpus_id, corpus);
  assert.equal(result.kind, "topic"); assert.equal(result.context_hash, contextHash);
  assert.equal(result.reused, false); assert.equal(result.status, "draft");
  assert.deepEqual(result.terms, proposal.terms);
  const contextQueries = f.queries.filter((query) => query.via === "pool");
  assert.equal(contextQueries.length, 3);
  assert.match(contextQueries[2]!.sql, /ORDER BY md5\(mention\.id::text \|\| ':' \|\| \$2::int::text\), mention\.id\s+LIMIT 100/u);
  assert.ok(f.queries.indexOf(contextQueries[2]!) < f.queries.findIndex((query) => query.sql === "BEGIN"));
  const clientQueries = f.queries.filter((query) => query.via === "client");
  assert.equal(clientQueries[0]!.sql, "BEGIN"); assert.equal(clientQueries.at(-1)!.sql, "COMMIT");
  assert.equal(clientQueries.filter((query) => query.sql === "BEGIN").length, 1);
  assert.equal(clientQueries.filter((query) => query.sql === "COMMIT").length, 1);
  assert.equal(f.state.releaseCount, 1); assert.equal(f.state.active, false);
  const profile = inserts(f, "signal_taxonomy_profiles")[0]!;
  assert.deepEqual(valueJson(profile.values[7]), {contract_version: proposal.contract_version,
    discovery_provider: input.provider, context_refs: proposal.context_refs, corpus_revision: 7,
    discovery_usage: input.discovery_usage});
  assert.deepEqual(valueJson(inserts(f, "tagging_model_versions")[0]!.values[5]),
    {context_hash: contextHash, discovery_usage: input.discovery_usage});
  assert.deepEqual(valueJson(inserts(f, "tagging_rule_sets")[0]!.values[3]),
    {contract_version: proposal.contract_version, kind: "topic", terms: proposal.terms});
  inserts(f, "taxonomy_terms").forEach((row, index) => assert.deepEqual(valueJson(row.values[5]), {
    statement: proposal.terms[index]!.statement, examples: proposal.terms[index]!.examples,
    exclusions: proposal.terms[index]!.exclusions}));
  assert.equal(inserts(f, "lineage_edges").length, refs.length + 3);
  assert.equal(profile.id, result.profile_id);
  assert.equal(inserts(f, "taxonomies")[0]!.id, "taxonomy_id" in result ? result.taxonomy_id : undefined);
  assert.equal(inserts(f, "tagging_rule_sets")[0]!.id, "rule_set_id" in result ? result.rule_set_id : undefined);
  assert.equal(inserts(f, "tagging_model_versions")[0]!.id, "model_version_id" in result ? result.model_version_id : undefined);
});

test("legacy context-only draft dedup remains unchanged and does not allocate or invoke insertion core", async () => {
  const f = fixture(false);
  f.state.store.profiles.push({id: "existing-profile", workspace_id: workspace, kind: "topic", version: 9,
    status: "draft", context_hash: contextHash});
  const before = structuredClone(f.state.store), input = legacyInput();
  input.terms[0]!.label = "Changed incoming legacy label";
  const result = await createSignalTaxonomyDraftStoreV1(legacyArgs(f, input));
  assert.deepEqual(result, {contract_version: "signal-topics-narratives-v1", profile_id: "existing-profile",
    workspace_id: workspace, study_corpus_id: corpus, kind: "topic", version: 9, status: "draft",
    context_hash: contextHash, terms: normalizeSignalTaxonomyProposalV1({...input, context_refs: refs}).terms, reused: true});
  assert.deepEqual(f.state.store, before);
  const sql = f.queries.filter((query) => query.via === "client").map((query) => query.sql).join("\n");
  assert.doesNotMatch(sql, /SAVEPOINT|MAX\(version\)|INSERT INTO|COMMIT/u);
  assert.match(sql, /context_hash = \$3/u); assert.match(sql, /ROLLBACK/u);
  assert.equal(f.state.releaseCount, 1); assert.equal(f.state.active, false);
});

test("legacy additional context hashes and defaults are preserved without silently widening its normalizer", async () => {
  const f = fixture(false), input = legacyInput();
  const addition = {source_type: "knowledge_chunk" as const,
    source_id: "66666666-6666-4666-8666-666666666666", version: "v1", content: "Additional fake context.",
    content_hash: hash("Additional fake context.")};
  input.additional_context_items = [addition];
  const expectedRefs = [...refs, {source_type: addition.source_type, source_id: addition.source_id,
    version: addition.version, content_hash: addition.content_hash}];
  const result = await createSignalTaxonomyDraftStoreV1(legacyArgs(f, input));
  assert.equal(result.context_hash, signalTaxonomyContextHashV1(expectedRefs));
  assert.deepEqual(valueJson(inserts(f, "tagging_model_versions")[0]!.values[5]),
    {context_hash: result.context_hash, discovery_usage: null});
  assert.equal(inserts(f, "lineage_edges").length, expectedRefs.length + 3);
  for (const invalid of [{...legacyInput(), expected_context_hash: hash("stale")},
    {...legacyInput(), additional_context_items: [{...addition, content_hash: hash("wrong content")}]},
    {...legacyInput(), terms: [{...legacyInput().terms[0]!, definition: "X".repeat(801)}]}]) {
    const rejected = fixture(false);
    await assert.rejects(createSignalTaxonomyDraftStoreV1(legacyArgs(rejected, invalid)));
    assert.equal(rejected.state.connectCount, 0); assert.equal(rejected.state.store.inserted.length, 0);
  }
});

test("legacy insertion failure rolls back its owned transaction and releases without swallowing the cause", async () => {
  const f = fixture(false); f.state.failTable = "tagging_model_versions";
  await assert.rejects(createSignalTaxonomyDraftStoreV1(legacyArgs(f)), {code: "23514"});
  assert.deepEqual(f.state.store, {profiles: [], inserted: []}); assert.equal(f.state.active, false);
  const sql = f.queries.filter((query) => query.via === "client").map((query) => query.sql.trim());
  assert.deepEqual(sql.slice(-3), ["ROLLBACK TO SAVEPOINT signal_taxonomy_insert_core_v1",
    "RELEASE SAVEPOINT signal_taxonomy_insert_core_v1", "ROLLBACK"]);
  assert.equal(f.state.connectCount, 1); assert.equal(f.state.releaseCount, 1);
});

test("this regression fixture uses no real Pool/transport and is included by the standard DB suite", async () => {
  const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.test, /(?:^|\s)signal-taxonomy-draft-core\.test\.ts(?:\s|$)/u);
  const source = await readFile(new URL("./signal-taxonomy-draft-core.test.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new\s+Pool\s*\(|process\.env\.|fetch\s*\(/u);
});
