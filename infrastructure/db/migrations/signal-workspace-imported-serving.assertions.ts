import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { signalLicensingPolicyDefinitionHashV1, signalProvenancePolicyBindingDefinitionHashV1 } from "@noisia/query-engine";
import { syntheticImportedWorkspaceFixtureV1, type SyntheticTransactionV1 } from "./signal-client-workspace-entry.synthetic.fixture";
import { fixtureSha } from "./signal-workspace-topic-projection.fixture";
import { loadSignalWorkspaceMentionsV1, loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";

/** PostgreSQL acceptance entry point, with no environment/connection/DDL/provider.
 * A reviewed runner must verify an empty synthetic target and own physical rollback.
 * Requires the current serving schema, including exact mention digests and consolidation.
 * Not called by the historical NOI-19 runner (its SQL0152 seal is insufficient). */
export async function assertSignalWorkspaceImportedServingV1(t: Pick<TestContext, "test">, tx: SyntheticTransactionV1) {
  const f = await syntheticImportedWorkspaceFixtureV1(tx);
  const imported = { ...f.access, imported_fallback: true as const };
  const read = async (extra: Partial<Parameters<typeof loadSignalWorkspaceMentionsV1>[0]> = {}) => {
    const page = await loadSignalWorkspaceMentionsV1({ ...imported, ...extra });
    assert.ok(page, "the accepted imported workspace remains a native source"); return page;
  };
  const isolate = async (work: () => Promise<void>) => {
    await tx.query("BEGIN"); try { await work(); } finally { await tx.query("ROLLBACK"); }
  };
  const addBatch = async (status: "completed" | "failed") => {
    const batch = randomUUID();
    await tx.query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,status,
      record_count,included_count,excluded_count,duplicate_count,imported_by_user_id)
      VALUES($1,$2,$3,'synthetic','invented-import.txt',$4,$5,1,1,0,0,$6)`,
    [batch, f.workspace_id, f.source_id, fixtureSha(batch), status, f.actor_user_id]);
    return batch;
  };
  const addMention = async (batch: string, canonical?: string) => {
    const mention = randomUUID(), text = `Invented received conversation ${mention}`;
    await tx.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,source_system,
      source_file_id,text_hash,text_raw,text_clean,text_length,published_at,platform,resolved_platform,language,inclusion_status)
      VALUES($1,$2,$3,$4,$5,$5,'synthetic',$6,$7,$8,$8,$9,'2026-09-02T12:00:00Z','synthetic','synthetic','en','included')`,
    [mention, f.workspace_id, f.source_id, canonical ?? mention, mention, batch, fixtureSha(text), text, text.length]);
    await tx.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id,ingestion_disposition)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(mention_id,import_batch_id) DO NOTHING`,
    [f.workspace_id, canonical ?? mention, batch, f.source_id, canonical ? "duplicate" : "included"]);
    return mention;
  };
  const restrictBatch = async (metrics: boolean, text: boolean) => {
    const license = randomUUID();
    const definition = { workspace_id: f.workspace_id, policy_key: `imported-${license}`, policy_version: 1,
      approval_evidence_hash: fixtureSha("invented policy restriction"),
      usages: (["llm-processing", "client-derived-metrics", "client-mention-list", "client-text-or-excerpt"] as const)
        .map(usage_purpose => ({ usage_purpose, decision: (usage_purpose === "client-derived-metrics" && !metrics
          || usage_purpose === "client-text-or-excerpt" && !text ? "prohibited" : "allowed") as "prohibited" | "allowed" })) };
    await tx.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
      approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key)
      VALUES($1,$2,$3,$4,1,'draft',$5,$6,$7,$8)`, [license, f.organization_id, f.workspace_id, definition.policy_key,
      definition.approval_evidence_hash, signalLicensingPolicyDefinitionHashV1(definition), f.actor_user_id, fixtureSha(license)]);
    for (const usage of definition.usages) await tx.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
      VALUES($1,$2,$3,$4)`, [f.workspace_id, license, usage.usage_purpose, usage.decision]);
    await tx.query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1", [license, f.actor_user_id]);
    const binding = { workspace_id: f.workspace_id, data_source_id: f.source_id, import_batch_id: f.batch_id,
      binding_version: 1, quality_policy_id: f.quality_id, retention_policy_id: f.retention_id, licensing_policy_id: license };
    await tx.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,status,
      quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
      VALUES($1,$2,$3,1,'active',$4,$5,$6,$7,$8,$8,now(),$9)`, [f.workspace_id, f.source_id, f.batch_id,
      f.quality_id, f.retention_id, license, signalProvenancePolicyBindingDefinitionHashV1(binding), f.actor_user_id, fixtureSha(randomUUID())]);
  };
  await t.test("accepted import with zero Engine/preparation exposes authorized volume and canonical pages", async () => {
    const counts = (await tx.query(`SELECT
      (SELECT count(*)::int FROM signal_topic_catalog_executions WHERE workspace_id=$1) engine,
      (SELECT count(*)::int FROM signal_corpus_preparation_runs WHERE workspace_id=$1) preparation,
      (SELECT count(*)::int FROM signal_classification_generations WHERE workspace_id=$1) generations`, [f.workspace_id])).rows[0];
    assert.deepEqual(counts, { engine: 0, preparation: 0, generations: 0 });
    assert.equal(await loadSignalWorkspaceTopicsOverviewV1(f.access), null);
    assert.equal(await loadSignalWorkspaceMentionsV1(f.access), null);
    const summary = await loadSignalWorkspaceTopicsOverviewV1(imported);
    assert.ok(summary?.source === "workspace_imported", "overview reports the actual imported source");
    assert.equal(summary.denominator, 3); assert.equal(summary.evidence_visible_total, 3);
    assert.equal(summary.generation_id, null); assert.equal(summary.coverage.processed, null);
    assert.equal(summary.coverage.noise, null); assert.deepEqual(summary.terms, []);
    const first = await read({ limit: 1 }), second = await read({ limit: 1, cursor: first.next_cursor }), third = await read({ limit: 1, cursor: second.next_cursor });
    assert.ok(first.next_cursor && second.next_cursor, "each nonterminal page has a cursor");
    assert.equal(third.next_cursor, null);
    const all = [...first.items, ...second.items, ...third.items];
    assert.deepEqual(all.map(item => item.mention_id).sort(), [...f.roots].sort());
    assert.equal(all.every(item => item.resolution_state === null && item.has_unresolved_topics === null), true);
    const focused = await read({ focus_mention_id: first.items[0]!.mention_id });
    assert.deepEqual(focused.focused_item, first.items[0]);
    assert.equal((await read({ search_query: "never an invented match" })).total_count, 0);
    assert.equal((await read({ date_from: "2026-10-01" })).metric_denominator, 0);
    await assert.rejects(read({ cursor: first.next_cursor, sort_direction: "asc" }), /scope_changed/u);
    await assert.rejects(read({ focus_mention_id: randomUUID() }), /mention_unavailable/u);
  });
  await t.test("failed imports, excluded roots and inactive sources never inflate readable volume", () => isolate(async () => {
    await addMention(await addBatch("failed"));
    assert.equal((await read()).metric_denominator, 3);
    await tx.query("UPDATE mentions SET inclusion_status='excluded' WHERE id=$1", [f.roots[0]]);
    assert.equal((await read()).metric_denominator, 2);
    await tx.query("UPDATE data_sources SET status='inactive' WHERE id=$1", [f.source_id]);
    const inactive = await read(); assert.equal(inactive.metric_denominator, 0); assert.deepEqual(inactive.items, []);
  }));
  await t.test("second receipt deduplicates canonical roots and invalidates old cursors", () => isolate(async () => {
    const before = await read({ limit: 1 }), batch = await addBatch("completed");
    await addMention(batch, f.roots[0]);
    const duplicated = await read(); assert.equal(duplicated.metric_denominator, 3);
    await assert.rejects(read({ cursor: before.next_cursor }), /scope_changed/u);
    const added = await addMention(batch), after = await read();
    assert.equal(after.metric_denominator, 4); assert.equal(after.items.some(item => item.mention_id === added), true);
    assert.equal(new Set(after.items.map(item => item.mention_id)).size, 4);
    const summary = await loadSignalWorkspaceTopicsOverviewV1(imported); assert.equal(summary?.denominator, 4);
  }));
  await t.test("batch-specific text prohibition wins over permissive source rights without denying permitted metrics", () => isolate(async () => {
    const before = await read({ limit: 1 }); await restrictBatch(true, false);
    const page = await read(); assert.equal(page.metric_denominator, 3); assert.equal(page.evidence_visible_total, 0);
    assert.equal(page.withheld_evidence_count, 3); assert.deepEqual(page.items, []);
    assert.equal((await loadSignalWorkspaceTopicsOverviewV1(imported))?.denominator, 3);
    await assert.rejects(read({ cursor: before.next_cursor }), /scope_changed/u);
    await assert.rejects(read({ focus_mention_id: f.roots[0] }), /mention_unavailable/u);
  }));
  await t.test("compute permission cannot publish metrics or text and cannot cause legacy fallback", () => isolate(async () => {
    await restrictBatch(false, true);
    const page = await read(); assert.equal(page.metric_denominator, 0); assert.equal(page.total_count, 0);
    assert.deepEqual(page.items, []);
    const summary = await loadSignalWorkspaceTopicsOverviewV1(imported);
    assert.equal(summary?.source, "workspace_imported"); assert.equal(summary?.denominator, 0);
    assert.equal(summary?.coverage.withheld, null, "do not disclose a received count without metrics rights");
  }));
  await t.test("revoked retention and suspended actors fail closed on every page", () => isolate(async () => {
    const before = await read({ limit: 1 });
    await tx.query("UPDATE signal_retention_policies SET status='retired',effective_to=now() WHERE id=$1", [f.retention_id]);
    assert.equal((await read()).total_count, 0);
    await assert.rejects(read({ cursor: before.next_cursor }), /scope_changed/u);
    await tx.query("UPDATE users SET status='suspended' WHERE id=$1", [f.actor_user_id]);
    await assert.rejects(read(), /forbidden/u);
    await assert.rejects(loadSignalWorkspaceTopicsOverviewV1(imported), /forbidden/u);
  }));
}
