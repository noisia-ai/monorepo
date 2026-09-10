import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { writeFile } from "node:fs/promises";
import { workspaceProjectionFixtureV1, fixtureSha, type WorkspaceProjectionCheckpointFixtureV1 } from "./signal-workspace-topic-projection.fixture";
import { loadSignalWorkspaceMentionsV1, loadSignalWorkspaceTopicsOverviewV1, type SignalWorkspaceMentionsArgsV1 } from "../signal-workspace-topics-serving";
import * as projection from "../signal-workspace-topic-projection";
import * as classification from "../signal-workspace-classification";
import * as progress from "../signal-workspace-engine-progress";
import { loadSignalWorkspaceTopicSelectionV1, selectSignalWorkspaceTopicV1 } from "../signal-workspace-topic-selection";
import { signalWorkspaceTopicProjectionJobV1 } from "../../../services/workers/src/workers/signal-workspace-topic-projection";

const enabled = process.env.NOISIA_WORKSPACE_ENGINE_TEST_APPROVED === "true";
const migrations = ["0141_signal_workspace_editorial_repair.sql", "0142_signal_workspace_terminal_transport.sql",
  "0143_signal_workspace_editorial_revision.sql", "0144_signal_workspace_engine_progress.sql",
  "0145_signal_workspace_incremental_numeric.sql", "0146_signal_workspace_incremental_projection.sql", "0147_signal_workspace_interpretation_admission.sql"];
const stores = { claim: projection.claimSignalWorkspaceTopicProjectionV1, heartbeat: projection.heartbeatSignalWorkspaceTopicProjectionV1,
  readTopics: projection.readSignalWorkspaceTopicProjectionTopicsV1, readProposals: projection.readSignalWorkspaceTopicProjectionProposalsV1,
  readPage: classification.readSignalWorkspaceClassificationPageV1, readChunksPage: classification.readSignalWorkspaceClassificationChunksPageV1,
  commitPage: classification.commitSignalWorkspaceClassificationPageV1, finish: classification.finishSignalWorkspaceClassificationV1,
  fail: classification.failSignalWorkspaceClassificationV1 };
async function project(f: Pick<WorkspaceProjectionCheckpointFixtureV1, "database" | "bodies">, request: { execution_id: string; worker_job_id: string }) {
  await signalWorkspaceTopicProjectionJobV1({ id: request.worker_job_id, data: { execution_id: request.execution_id }, updateProgress: async () => {} },
    { database: f.database, stores, storage: {
      put: async () => { throw new Error("unexpected_storage_upload"); },
      get: async args => { const body = f.bodies.get(args.stored.storage_key); assert.notEqual(body, undefined); await writeFile(args.destination, body!); }
    } });
}
async function read(args: SignalWorkspaceMentionsArgsV1) { const result = await loadSignalWorkspaceMentionsV1(args); assert.ok(result); return result; }

test("native mentions reads the complete real generation, pages/focus/filter in scope and withholds revoked or changed text", { skip: !enabled, timeout: 90_000 }, async t => {
  const f = await workspaceProjectionFixtureV1({ migrations });
  try {
    await assert.rejects(read(f.access), /workspace_mentions_generation_unavailable/u);
    const request = await projection.requestSignalWorkspaceTopicProjectionV1({ ...f.access, engine_execution_id: f.engine_execution_id, idempotency_key: `workspace-projection:${f.engine_execution_id}` });
    await project(f, request);
    const audit = async () => (await f.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM engine_cost_events c WHERE catalog_execution_id=$1::uuid) costs,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY canonical_root_id) FROM signal_classification_generation_items i WHERE generation_id=$2::uuid) items,
      (SELECT topic_signal_selection FROM signal_workspaces WHERE id=$3::uuid) selection`, [f.engine_execution_id, request.generation_id, f.workspace_id])).rows[0];
    const baseline = await audit();
    const overview = await loadSignalWorkspaceTopicsOverviewV1(f.access); assert.ok(overview);
    assert.equal(overview.terms.length, 0, "no selected Topic is required for global mention content");
    await f.query("SET LOCAL jit=on");
    const statements: string[] = [], corpusPlanCosts: number[] = [];
    const observed = { connect: async () => {
      const client = await f.database.connect(), proxy = Object.create(client) as PoolClient;
      proxy.query = (async (sql: string, params?: unknown[]) => {
        statements.push(sql);
        if (sql.includes("mention_roots AS MATERIALIZED")) {
          const settings = (await client.query("SELECT current_setting('jit') jit,current_setting('enable_nestloop') nestloop")).rows[0]!;
          assert.deepEqual(settings, { jit: "off", nestloop: "off" });
          const plan = (await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params)).rows[0]!["QUERY PLAN"][0].Plan;
          corpusPlanCosts.push(plan["Total Cost"]);
        }
        return client.query(sql, params);
      }) as PoolClient["query"];
      return proxy;
    } };
    const readStart = performance.now();
    const first = await read({ ...f.access, database: observed, limit: 1 });
    t.diagnostic(JSON.stringify({ first_read_ms: Math.round(performance.now() - readStart), corpus_plan_costs: corpusPlanCosts, entered_jit: "on" }));
    const setting = statements.indexOf("SET LOCAL enable_nestloop=off");
    const corpusQueries = statements.map((sql, index) => sql.includes("mention_roots AS MATERIALIZED") ? index : -1).filter(index => index >= 0);
    assert.equal(statements.filter(sql => sql === "SET LOCAL enable_nestloop=off").length, 1);
    const jitSetting = statements.indexOf("SET LOCAL jit=off");
    assert.equal(statements.filter(sql => sql === "SET LOCAL jit=off").length, 1);
    assert.equal(corpusQueries.length, 2); assert.ok(setting > 3 && jitSetting > setting && corpusQueries.every(index => index > jitSetting));
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(first.generation_id, overview.generation_id); assert.equal(first.metric_denominator, overview.denominator);
    assert.equal(first.total_count, f.roots.length); assert.equal(first.evidence_visible_total, f.roots.length);
    assert.equal(first.withheld_evidence_count, 0); assert.equal(first.integrity_withheld_count, 0); assert.ok(first.next_cursor);
    const canonical = (await f.query(`SELECT id mention_id,to_char(published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,
      left(text_clean,2000) text_snippet,COALESCE(resolved_platform,platform) platform,to_char(published_at,'YYYY-MM-DD') date
      FROM mentions WHERE id=ANY($1::uuid[]) ORDER BY published_at DESC NULLS LAST,id`, [f.roots.map(root => root.root_id)])).rows;
    const all = [...first.items]; let cursor: string | null = first.next_cursor, offset = 1;
    assert.deepEqual(first.available_platforms, [...new Set(canonical.map(row => row.platform.trim().toLowerCase()))].sort());
    while (cursor) { const page = await read({ ...f.access, limit: 2, cursor, expected_scope_digest: first.scope_digest });
      assert.equal(page.page_offset, offset); all.push(...page.items); offset += page.items.length; cursor = page.next_cursor; }
    assert.deepEqual(all.map(row => row.mention_id), canonical.map(row => row.mention_id));
    assert.equal(new Set(all.map(row => row.mention_id)).size, f.roots.length, "multilabel assignments do not duplicate roots");
    for (const item of all) {
      assert.equal(item.text_snippet, canonical.find(row => row.mention_id === item.mention_id)!.text_snippet);
      assert.ok(Array.from(item.text_snippet).length <= 2000);
      const focus = await read({ ...f.access, focus_mention_id: item.mention_id.toUpperCase(), expected_scope_digest: first.scope_digest });
      assert.deepEqual(focus.items, [item]); assert.equal(focus.next_cursor, null);
    }
    const asc = await read({ ...f.access, sort_direction: "asc" });
    const ascOracle = (await f.query("SELECT id FROM mentions WHERE id=ANY($1::uuid[]) ORDER BY published_at ASC NULLS LAST,id", [f.roots.map(root => root.root_id)])).rows;
    assert.deepEqual(asc.items.map(row => row.mention_id), ascOracle.map(row => row.id));
    const platform = canonical[0]!.platform;
    const filtered = await read({ ...f.access, platforms: [platform.toUpperCase(), platform] });
    assert.deepEqual(filtered.filters.platforms, [platform.toLowerCase()]);
    assert.equal(filtered.total_count, canonical.filter(row => row.platform.toLowerCase() === platform.toLowerCase()).length);
    assert.equal(filtered.metric_denominator, first.metric_denominator);
    assert.deepEqual(filtered.available_platforms, first.available_platforms, "platform choices use the full authorized period, not the current page/filter");
    for (const literal of ["%", "_", "\\", "never-a-match-" + randomUUID()]) {
      const found = await read({ ...f.access, search_query: literal });
      const expected = (await f.query("SELECT count(*)::int n FROM mentions WHERE id=ANY($1::uuid[]) AND strpos(lower(text_clean),lower($2))>0", [f.roots.map(root => root.root_id), literal])).rows[0]!.n;
      assert.equal(found.total_count, expected, "search syntax is literal, not LIKE or regex");
      assert.equal(found.evidence_visible_total, first.evidence_visible_total);
    }
    const date = canonical[0]!.date, dated = await read({ ...f.access, date_from: date, date_to: date });
    assert.equal(dated.total_count, canonical.filter(row => row.date === date).length);
    assert.equal(dated.metric_denominator, (await loadSignalWorkspaceTopicsOverviewV1({ ...f.access, date_from: date, date_to: date }))!.denominator);
    await assert.rejects(read({ ...f.access, focus_mention_id: randomUUID() }), /mention_unavailable/u);
    await assert.rejects(read({ ...f.access, focus_mention_id: all[0]!.mention_id, platforms: ["nonexistent-platform"] }), /mention_unavailable/u);
    await assert.rejects(read({ ...f.access, cursor: first.next_cursor, search_query: "different" }), /scope_changed/u);
    await assert.rejects(read({ ...f.access, cursor: first.next_cursor, sort_direction: "asc" }), /scope_changed/u);
    await assert.rejects(read({ ...f.access, cursor: first.next_cursor, actor_user_id: randomUUID() }), /forbidden/u);
    await assert.rejects(read({ ...f.access, workspace_id: randomUUID(), focus_mention_id: all[0]!.mention_id }), /forbidden|unavailable/u);
    const forged = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8")); forged.root_id = randomUUID();
    await assert.rejects(read({ ...f.access, cursor: Buffer.from(JSON.stringify(forged)).toString("base64url") }), /scope_changed/u);
    const falseRange = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8")); falseRange.offset = 900_000;
    await assert.rejects(read({ ...f.access, cursor: Buffer.from(JSON.stringify(falseRange)).toString("base64url") }), /scope_changed/u);
    assert.ok(all.some(row => row.text_truncated), "long root text is explicitly presented as an excerpt");
    assert.deepEqual(await audit(), baseline, "reads do not alter costs, classification receipts or selection");

    const admin = await loadSignalWorkspaceTopicsOverviewV1({ ...f.access, include_unselected: true }); assert.ok(admin);
    const term = admin.terms[0]!, selection = await loadSignalWorkspaceTopicSelectionV1(f.access);
    await selectSignalWorkspaceTopicV1({ ...f.access, term_key: term.term_key, selected: true, generation_id: request.generation_id,
      expected_selection_revision: selection.revision, expected_definition_revision: term.definition_revision,
      expected_definition_digest: term.definition_digest, idempotency_key: randomUUID() });
    assert.equal((await read(f.access)).scope_digest, first.scope_digest, "selection does not invalidate a global mention cursor");
    assert.ok((await read({ ...f.access, cursor: first.next_cursor })).items.length);

    await f.query("SAVEPOINT mentions_display_rights");
    try {
      // Active usages are immutable. Author an explicit local test restriction
      // in a new draft, activate it and version the source bindings legally.
      const licenses = (await f.query("SELECT DISTINCT licensing_policy_id id FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid AND status='active'", [f.workspace_id])).rows;
      for (const prior of licenses) {
        const license = randomUUID(), policyKey = `mentions-text-restriction-${license}`;
        await f.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
          approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key)
          SELECT $1::uuid,organization_id,workspace_id,$2,1,'draft',$3,$3,$4::uuid,$5
          FROM signal_licensing_policies WHERE id=$6::uuid`,
        [license, policyKey, fixtureSha("explicit local fixture display restriction"), f.actor_user_id, fixtureSha(license), prior.id]);
        await f.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
          SELECT workspace_id,$1::uuid,usage_purpose,CASE WHEN usage_purpose='client-text-or-excerpt' THEN 'prohibited' ELSE decision END
          FROM signal_licensing_policy_usages WHERE licensing_policy_id=$2::uuid`, [license, prior.id]);
        await f.query("UPDATE signal_licensing_policies SET definition_hash=signal_licensing_policy_definition_hash(id) WHERE id=$1::uuid", [license]);
        await f.query(`UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2::uuid,
          approved_at=now(),updated_at=now() WHERE id=$1::uuid`, [license, f.actor_user_id]);
        const bindings = (await f.query("SELECT * FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid AND status='active' AND licensing_policy_id=$2::uuid", [f.workspace_id, prior.id])).rows;
        for (const binding of bindings) {
          await f.query("UPDATE signal_provenance_policy_bindings SET status='retired',effective_to=now(),updated_at=now() WHERE id=$1::uuid", [binding.id]);
          const hash = fixtureSha(["signal-provenance-policy-binding-v1", f.workspace_id, binding.data_source_id,
            binding.import_batch_id ?? "∅", String(binding.binding_version + 1), binding.quality_policy_id, binding.retention_policy_id, license].join("\u001f"));
          await f.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,status,
            quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4,'active',$5::uuid,$6::uuid,$7::uuid,$8,$9::uuid,$9::uuid,now(),$10)`,
          [f.workspace_id,binding.data_source_id,binding.import_batch_id,binding.binding_version+1,binding.quality_policy_id,
            binding.retention_policy_id,license,hash,f.actor_user_id,fixtureSha(randomUUID())]);
        }
      }
      const metricView = await loadSignalWorkspaceTopicsOverviewV1(f.access); assert.ok(metricView);
      assert.equal(metricView.denominator, first.metric_denominator, "metrics rights remain available");
      // Versioning provenance also invalidates the prepared input. The stricter
      // current-generation guard must reject content rather than fake an empty page.
      await assert.rejects(read(f.access), /workspace_mentions_stale/u);
      await assert.rejects(read({ ...f.access, cursor: first.next_cursor }), /workspace_mentions_stale/u);
      await assert.rejects(read({ ...f.access, focus_mention_id: all[0]!.mention_id }), /workspace_mentions_stale/u);
    } finally { await f.query("ROLLBACK TO SAVEPOINT mentions_display_rights"); await f.query("RELEASE SAVEPOINT mentions_display_rights"); }
    await f.query("SAVEPOINT mentions_changed_text");
    try {
      await f.query("UPDATE mentions SET text_clean=text_clean||' changed after preparation' WHERE id=$1::uuid", [all[0]!.mention_id]);
      // A normal source revision may reject the whole generation before SHA;
      // otherwise the SHA check must remove both the row and the visible count.
      try {
        const changed = await read(f.access); assert.equal(changed.integrity_withheld_count, 1);
        assert.equal(changed.total_count, first.total_count - 1); assert.equal(changed.items.some(row => row.mention_id === all[0]!.mention_id), false);
      } catch (error) { assert.match(String(error), /workspace_mentions_stale/u); }
      await assert.rejects(read({ ...f.access, expected_scope_digest: first.scope_digest, focus_mention_id: all[0]!.mention_id }), /stale|scope_changed/u);
    } finally { await f.query("ROLLBACK TO SAVEPOINT mentions_changed_text"); await f.query("RELEASE SAVEPOINT mentions_changed_text"); }
    await f.query("SAVEPOINT mentions_source_stale");
    try {
      await f.query("UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid", [f.workspace_id]);
      await assert.rejects(read(f.access), /workspace_mentions_stale/u);
      await assert.rejects(read({ ...f.access, focus_mention_id: all[0]!.mention_id }), /workspace_mentions_stale/u);
    } finally { await f.query("ROLLBACK TO SAVEPOINT mentions_source_stale"); await f.query("RELEASE SAVEPOINT mentions_source_stale"); }
  } finally { await f.cleanup(); }
});

test("native mentions includes partial interpretation and fully abstained roots without a selected Topic", { skip: !enabled, timeout: 90_000 }, async () => {
  let partialChecked = false;
  const f = await workspaceProjectionFixtureV1({ migrations, onCheckpoint: async checkpoint => {
    if (checkpoint.proposals.length !== 1) return;
    const scope = { ...checkpoint.access, execution_id: checkpoint.lease.execution_id };
    const source = await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope);
    const materialized = await progress.materializeSignalWorkspaceEngineTopicsProgressV1({ ...scope,
      expected_coverage: source.coverage, expected_catalog_profile_id: source.catalog_profile_id,
      proposals: (async function* () { yield* checkpoint.proposals; })() });
    const { mapping, replayed: _replayed, ...metadata } = materialized, body = JSON.stringify({ ...metadata, mapping });
    const key = `materialization-progress-${metadata.output_catalog_profile_id}.json`;
    const storage_key = `workspace-engine/${scope.workspace_id}/${scope.execution_id}/${key}`;
    checkpoint.bodies.set(storage_key, body);
    const saved = await progress.persistSignalWorkspaceEngineTopicsProgressV1({ ...scope, expected_coverage: source.coverage,
      artifact: { artifact_key: key, artifact_type: "engine_proposals", title: "Local partial mentions fixture", metadata,
        storage_key, sha256: fixtureSha(body), size_bytes: Buffer.byteLength(body), media_type: "application/json" } });
    const dispatch = (await checkpoint.query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'", [saved.projection_execution_id])).rows[0]!;
    await project(checkpoint, { execution_id: saved.projection_execution_id, worker_job_id: dispatch.worker_job_id });
    const list = await read(checkpoint.access), overview = await loadSignalWorkspaceTopicsOverviewV1(checkpoint.access);
    assert.equal(list.items.length, 3); assert.equal(list.generation_id, saved.generation_id);
    assert.equal(list.items.every(row => row.has_unresolved_topics), true);
    assert.equal(overview!.interpretation_coverage?.complete, false); assert.equal(overview!.terms.length, 0);
    partialChecked = true;
  } });
  await f.cleanup(); assert.equal(partialChecked, true);
  const empty = await workspaceProjectionFixtureV1({ migrations, empty: true });
  try {
    const request = await projection.requestSignalWorkspaceTopicProjectionV1({ ...empty.access, engine_execution_id: empty.engine_execution_id, idempotency_key: `workspace-projection:${empty.engine_execution_id}` });
    await project(empty, request);
    const list = await read(empty.access); assert.equal(list.total_count, 3); assert.equal(list.items.length, 3);
    assert.equal(list.items.every(row => row.resolution_state === "abstained"), true);
    assert.equal((await loadSignalWorkspaceTopicsOverviewV1(empty.access))!.terms.length, 0);
  } finally { await empty.cleanup(); }
});


test("mentions planner preferences restore both settings on commit, rollback and SQL error", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439");
  assert.match(url.pathname, /^\/noisia_(national_import_test|projection_test)_\d+$/u);
  const client = new pg.Client({ connectionString: url.href, ssl: false }); await client.connect();
  const settings = async () => (await client.query("SELECT current_setting('jit') jit,current_setting('enable_nestloop') nestloop")).rows[0]!;
  const start = async () => {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL enable_nestloop=off"); await client.query("SET LOCAL jit=off");
    assert.deepEqual(await settings(), { jit: "off", nestloop: "off" });
  };
  try {
    for (const nestloop of ["on", "off"] as const) for (const jit of ["on", "off"] as const) {
      await client.query(`SET enable_nestloop=${nestloop}`); await client.query(`SET jit=${jit}`);
      for (const ending of ["COMMIT", "ROLLBACK"] as const) {
        await start(); await client.query(ending); assert.deepEqual(await settings(), { jit, nestloop });
      }
      await start(); await assert.rejects(client.query("SELECT 1/0"), /division by zero/u);
      await client.query("ROLLBACK"); assert.deepEqual(await settings(), { jit, nestloop });
    }
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
