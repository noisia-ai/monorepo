import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import { createMassLabelingProductDatabaseFixtureV1 } from "./signal-mass-labeling-product-database.synthetic.fixture";
import { signalMfpLegacyWorkspaceFixtureV1 } from "./signal-mfp-legacy-workspace.synthetic.fixture";
import * as projection from "../signal-workspace-topic-projection";
import * as classification from "../signal-workspace-classification";
import { signalWorkspaceTopicProjectionJobV1 } from "../../../services/workers/src/workers/signal-workspace-topic-projection";
import { loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";
import { inspectTopicContextIdentityCutV1, sealTopicContextIdentityCutV1 } from "../signal-topic-context-identity-cut";

const enabled = process.env.NOISIA_MFP_PG_CI === "true";
test("the sealed historical cut rejects later metadata, aliases and clock-only activation", { skip: !enabled, timeout: 180_000 }, async () => {
  const { database: owner, cleanup } = await createMassLabelingProductDatabaseFixtureV1();
  const physical = await owner.connect();
  const saves: string[] = [];
  let sequence = 0, legacyTransport = true;
  const competitor = randomUUID(), seed = randomUUID();
  try {
    await physical.query("BEGIN");
    await physical.query("SET LOCAL search_path=public,extensions,pg_temp");
    // Simulate the real upgrade order in this test-owned disposable database.
    // Synthetic legacy work precedes migration 0289; provider/fit transports are
    // the existing invented fixtures and entity rows use the deployed v1 shape.
    await physical.query(`DROP TABLE signal_topic_context_identity_bridges_v1,signal_topic_context_identity_cuts_v1;
      DROP FUNCTION guard_signal_topic_context_identity_bridge_v1(),guard_signal_topic_context_identity_cut_v1(),reject_signal_topic_context_identity_truncate_v1()`);
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("BEGIN")) {
        const save = `identity_cut_${++sequence}`; saves.push(save);
        await physical.query(`SAVEPOINT ${save}`);
        const separator = sql.indexOf(";");
        return separator < 0 ? { rows: [], rowCount: null } : physical.query(sql.slice(separator + 1), values);
      }
      if (sql === "COMMIT") return physical.query(`RELEASE SAVEPOINT ${saves.pop()!}`);
      if (sql === "ROLLBACK") {
        const save = saves.pop()!;
        await physical.query(`ROLLBACK TO SAVEPOINT ${save}`);
        return physical.query(`RELEASE SAVEPOINT ${save}`);
      }
      const identityQuery=legacyTransport&&sql.includes("SELECT 'primary_brand'::text AS scope");
      const deployedSql=identityQuery?sql
        .replace("|| ARRAY(SELECT product.name FROM brand_os_products product JOIN brand_os_profiles p ON p.id=product.brand_os_profile_id WHERE p.brand_id=brand.id AND p.status='active' AND product.status='active')","")
        .replace("AND competitor.status = 'current' AND competitor.effective_from <= clock_timestamp() AND (competitor.effective_to IS NULL OR competitor.effective_to > clock_timestamp())",""):sql;
      const result = await physical.query(deployedSql, values);
      if (legacyTransport && sql.includes("SELECT 'primary_brand'::text AS scope")) {
        result.rows = result.rows.map(({ disambiguation: _ignored, ...row }) => row);
      }
      return result;
    };
    const scoped = Object.assign(Object.create(physical) as PoolClient, { query, release: () => {} });
    const database = { query, connect: async () => scoped } as unknown as Pool;
    const f = await signalMfpLegacyWorkspaceFixtureV1({ transaction: { database, scoped, query: query as never,
      cleanup: async () => {} }, after_brand_created: async ({ identity }) => {
      await query(`INSERT INTO brand_seeds(id,canonical_name,aliases,active) VALUES($1,'Synthetic cut competitor',ARRAY['Synthetic rival'],true)`, [seed]);
      await query(`INSERT INTO competitors(id,brand_id,competitor_brand_seed_id,notes,status,effective_from,effective_to,updated_at)
        VALUES($1,$2,$3,'Pre-existing historical distinction','current',clock_timestamp()+interval '30 seconds',NULL,clock_timestamp())`,
      [competitor, identity.brand_id, seed]);
    } });
    const requested = (await query(`SELECT execution.id execution_id,outbox.worker_job_id,execution.generation_id
      FROM signal_topic_catalog_executions execution JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id
      WHERE execution.workspace_id=$1 AND execution.input_contract='workspace-topic-classification-v1'
        AND execution.status='queued' AND execution.input_snapshot#>>'{source_projection,engine_execution_id}'=$2`,
    [f.workspace_id,f.engine_execution_id])).rows[0];
    assert.ok(requested,'the native engine queued its classification automatically');
    await signalWorkspaceTopicProjectionJobV1({ id: requested.worker_job_id,
      data: { execution_id: requested.execution_id }, updateProgress: async () => {} }, { database,
      stores: { claim: projection.claimSignalWorkspaceTopicProjectionV1, heartbeat: projection.heartbeatSignalWorkspaceTopicProjectionV1,
        readTopics: projection.readSignalWorkspaceTopicProjectionTopicsV1, readProposals: projection.readSignalWorkspaceTopicProjectionProposalsV1,
        readPage: classification.readSignalWorkspaceClassificationPageV1, readChunksPage: classification.readSignalWorkspaceClassificationChunksPageV1,
        commitPage: classification.commitSignalWorkspaceClassificationPageV1, finish: classification.finishSignalWorkspaceClassificationV1,
        fail: classification.failSignalWorkspaceClassificationV1 },
      storage: { put: async () => { throw new Error("unexpected_storage_upload"); }, get: async args => {
        const body = f.projection.bodies.get(args.stored.storage_key); assert.ok(body); await writeFile(args.destination, body);
      } } });
    legacyTransport = false;
    await query(await readFile(new URL("./0289_signal_topic_context_identity_cut.sql", import.meta.url), "utf8"));
    assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.is_current, false, "unsealed cut cannot approve historical serving");
    const access = { database, actor_user_id: f.actor_user_id };
    await assert.rejects(inspectTopicContextIdentityCutV1({database,actor_user_id:randomUUID()}),/operator_forbidden/u);
    const preflight = await inspectTopicContextIdentityCutV1(access);
    assert.equal(preflight.transition_count, 1);
    assert.equal(preflight.candidates[0]?.generation_id, requested.generation_id);
    await query("SAVEPOINT cut_changed_before_seal");
    await query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{entity_disambiguation}','"Changed after preflight"')
      WHERE brand_id=(SELECT brand_id FROM signal_workspaces WHERE id=$1) AND status='active'`,[f.workspace_id]);
    await assert.rejects(sealTopicContextIdentityCutV1({ ...access, expected_inventory_digest: preflight.inventory_digest }), /preflight_changed/u);
    assert.equal((await query("SELECT count(*)::int n FROM signal_topic_context_identity_bridges_v1")).rows[0]!.n, 0);
    await query("ROLLBACK TO SAVEPOINT cut_changed_before_seal");
    await query("RELEASE SAVEPOINT cut_changed_before_seal");
    const sealed = await sealTopicContextIdentityCutV1({ ...access, expected_inventory_digest: preflight.inventory_digest });
    assert.equal(sealed.transition_count, 1);
    assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.is_current, true);
    const snapshot = (await query("SELECT to_jsonb(cut) value FROM signal_topic_context_identity_cuts_v1 cut")).rows[0]!.value;
    const replay = await sealTopicContextIdentityCutV1({ ...access, expected_inventory_digest: preflight.inventory_digest });
    assert.equal(replay.already_sealed, true);
    assert.deepEqual((await query("SELECT to_jsonb(cut) value FROM signal_topic_context_identity_cuts_v1 cut")).rows[0]!.value, snapshot);
    const staleAfter = async (name: string, sql: string, values: unknown[]) => {
      await query(`SAVEPOINT ${name}`); await query(sql, values);
      assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.is_current, false, name);
      await query(`ROLLBACK TO SAVEPOINT ${name}`); await query(`RELEASE SAVEPOINT ${name}`);
    };
    await staleAfter("new_disambiguation", `UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{entity_disambiguation}','"New actual distinction"')
      WHERE brand_id=(SELECT brand_id FROM signal_workspaces WHERE id=$1) AND status='active'`,[f.workspace_id]);
    await staleAfter("new_alias", "UPDATE brand_seeds SET aliases=ARRAY['A new alias'] WHERE id=$1", [seed]);
    for (const sql of ["UPDATE signal_topic_context_identity_cuts_v1 SET sealed_at=NULL",
      "DELETE FROM signal_topic_context_identity_bridges_v1", "TRUNCATE signal_topic_context_identity_bridges_v1", "UPDATE signal_topic_context_identity_bridges_v1 SET modern_identity=legacy_identity"]) {
      await query("SAVEPOINT immutable_cut");
      await assert.rejects(query(sql), /immutable/u);
      await query("ROLLBACK TO SAVEPOINT immutable_cut"); await query("RELEASE SAVEPOINT immutable_cut");
    }
    await query("SAVEPOINT late_bridge");
    await assert.rejects(query(`INSERT INTO signal_topic_context_identity_bridges_v1
      (generation_id,workspace_id,source_engine_execution_id,legacy_identity,modern_identity)
      SELECT generation_id,workspace_id,source_engine_execution_id,legacy_identity,modern_identity
      FROM signal_topic_context_identity_bridges_v1`),/already_sealed/u);
    await query("ROLLBACK TO SAVEPOINT late_bridge"); await query("RELEASE SAVEPOINT late_bridge");
    const protectedTables = (await query(`SELECT c.relrowsecurity,
      has_table_privilege('authenticated',c.oid,'SELECT') can_read,has_table_privilege('anon',c.oid,'SELECT') anon_read
      FROM pg_class c WHERE c.relname IN('signal_topic_context_identity_cuts_v1','signal_topic_context_identity_bridges_v1')`)).rows;
    assert.equal(protectedTables.length, 2);
    assert.ok(protectedTables.every(row => row.relrowsecurity && !row.can_read && !row.anon_read));
    const before = (await query("SELECT xmin::text,effective_from FROM competitors WHERE id=$1", [competitor])).rows[0];
    const wait = (await query("SELECT greatest(0,extract(epoch FROM effective_from-clock_timestamp())) seconds FROM competitors WHERE id=$1", [competitor])).rows[0]!.seconds;
    assert.ok(Number(wait) > 0 && Number(wait) <= 30, "the scheduled activation remains ahead of the sealed cut");
    await query("SELECT pg_sleep($1::double precision+0.02)", [wait]);
    assert.deepEqual((await query("SELECT xmin::text,effective_from FROM competitors WHERE id=$1", [competitor])).rows[0], before,
      "activation performs no write to the source");
    assert.equal((await loadSignalWorkspaceTopicsOverviewV1(f.access))?.is_current, false,
      "clock-only validity changes cannot reuse the sealed modern identity");
    assert.equal(saves.length, 0);
  } finally { await physical.query("ROLLBACK"); physical.release(); await cleanup(); }
});
