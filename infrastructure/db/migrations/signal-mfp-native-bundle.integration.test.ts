import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { seedSignalTopicEditorialRenewalSourceV1 } from "./signal-topic-editorial-renewal.synthetic.fixture";
import { createSignalTopicStoreV1 } from "../signal-topic-catalog";
import { registerFacetContextV1 } from "../signal-mention-facets";
import { selectConceptMembershipV1 } from "../signal-concept-memberships";
import { loadSignalWorkspaceTopicsPageV1, loadSignalWorkspaceTopicReadBundleV1,
  loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicDetailV1, loadSignalWorkspaceTopicEvidenceV1 } from "../signal-workspace-topics-serving";

test("MFP native bundle: complete PG DTO parity, one snapshot, topic changes and live authority", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 300_000,
}, async () => {
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const pool: Pool = await openDatabase(), raw = await pool.connect();
  const flags = ["NOISIA_CONCEPT_MEMBERSHIP_ENABLED", "NOISIA_MENTION_FACETS_ENABLED"] as const;
  const prior = flags.map(key => process.env[key]);
  process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = "true";
  process.env.NOISIA_MENTION_FACETS_ENABLED = "false";
  try {
    await raw.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    let sequence = 0, connections = 0; const stack: string[] = [];
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("BEGIN")) { const key = `native_bundle_${++sequence}`; stack.push(key); return raw.query(`SAVEPOINT ${key}`); }
      if (sql === "COMMIT") return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
      if (sql === "ROLLBACK") { const key = stack.pop()!; await raw.query(`ROLLBACK TO SAVEPOINT ${key}`); return raw.query(`RELEASE SAVEPOINT ${key}`); }
      return raw.query(sql, params);
    };
    const scoped = Object.assign(Object.create(raw), { query, release() {} });
    const database = Object.assign(Object.create(pool), { query, connect: async () => { connections++; return scoped; } }) as Pool;
    const seed = await seedSignalTopicEditorialRenewalSourceV1({ database, scoped, query, cleanup: async () => {} });
    const args = { database, workspace_id: seed.scope.workspace_id, actor_user_id: seed.scope.actor_user_id, timezone: "UTC" };
    await query(`INSERT INTO signal_workspace_features(workspace_id,feature,enabled_by)
      VALUES($1,'concept_membership',$2) ON CONFLICT(workspace_id,feature) DO NOTHING`, [args.workspace_id, args.actor_user_id]);
    for (const label of ["Bicycle brakes", "Bicycle service"]) {
      const created = await createSignalTopicStoreV1({ pool: database, ...args, idempotency_key: randomUUID(), input: {
        label, definition: `Experiences concerning ${label}`, scope: "all_conversations", inclusion: [], exclusion: [], positive_examples: [], negative_examples: [],
      } });
      await selectConceptMembershipV1({ ...args, idempotency_key: randomUUID(), selection: {
        concept_key: created.term_key, selected: true, expected_selection_revision: 0,
      } });
    }
    const unprepared = await loadSignalWorkspaceTopicsPageV1(args);
    assert.ok(unprepared && !unprepared.overview.is_current);
    assert.equal(unprepared.detail, null, "unregistered initial entity context keeps the source stale");
    assert.equal(unprepared.evidence, null);
    await registerFacetContextV1(scoped, args.workspace_id);
    connections = 0;
    const initial = await loadSignalWorkspaceTopicsPageV1(args);
    assert.ok(initial?.detail && initial.evidence, "fixture must exercise actual aggregate and evidence SQL");
    assert.equal(connections, 1, "SSR complete bundle holds one connection/snapshot");
    assert.equal(initial.overview.source, "workspace_computed");
    assert.ok(initial.overview.denominator > 0, "real nonempty synthetic mention population");
    const content = (value: NonNullable<Awaited<ReturnType<typeof loadSignalWorkspaceTopicsOverviewV1>>>) => {
      // Serving intentionally stamps clock_timestamp(), even inside one outer
      // transaction. Exclude only this root observation time, never data/guards.
      const { observed_at, ...rest } = value;
      assert.ok(Number.isFinite(Date.parse(observed_at)));
      return rest;
    };
    assert.deepEqual(content(initial.overview), content((await loadSignalWorkspaceTopicsOverviewV1(args))!));
    assert.equal(initial.overview.terms.length, 2);
    for (const term of initial.overview.terms) {
      const selected: Parameters<typeof loadSignalWorkspaceTopicReadBundleV1>[0] = { ...args, term_key: term.term_key, kind: "topic" as const, expected_scope_digest: initial.overview.scope_digest, limit: 25 };
      connections = 0;
      const bundle = await loadSignalWorkspaceTopicReadBundleV1(selected);
      assert.equal(connections, 1, "Topic switch combines its metrics and evidence without duplicate context reads");
      assert.deepEqual(content(bundle.overview), content(initial.overview));
      assert.deepEqual(bundle.detail, await loadSignalWorkspaceTopicDetailV1(selected));
      assert.deepEqual(bundle.evidence, await loadSignalWorkspaceTopicEvidenceV1(selected));
      await assert.rejects(loadSignalWorkspaceTopicReadBundleV1({ ...selected, expected_scope_digest: `sha256:${"0".repeat(64)}` }), /workspace_topics_scope_changed/);
      const cursor = Buffer.from(JSON.stringify({ root_id: randomUUID(), scope: initial.overview.scope_digest, term: "foreign-topic", kind: "topic" })).toString("base64url");
      await assert.rejects(loadSignalWorkspaceTopicReadBundleV1({ ...selected, cursor }), /workspace_topics_scope_changed/);
    }
    await assert.rejects(loadSignalWorkspaceTopicReadBundleV1({ ...args, term_key: "foreign-topic", expected_scope_digest: initial.overview.scope_digest }), /workspace_topics_topic_unavailable/);
    await query("UPDATE users SET status='inactive' WHERE id=$1", [args.actor_user_id]);
    await assert.rejects(loadSignalWorkspaceTopicsPageV1(args), /workspace_topics_forbidden/);
    await assert.rejects(loadSignalWorkspaceTopicReadBundleV1({ ...args, term_key: initial.detail.term_key, expected_scope_digest: initial.overview.scope_digest }), /workspace_topics_forbidden/);
  } finally {
    await raw.query("ROLLBACK"); raw.release(); await pool.end();
    flags.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; });
  }
});
