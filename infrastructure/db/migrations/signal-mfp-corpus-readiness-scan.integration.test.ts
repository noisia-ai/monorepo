import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { loadSignalWorkspaceCorpusReadinessStoreV1 } from "../signal-workspace-corpus-readiness";

type Plan = {
  "Relation Name"?: string;
  "Actual Loops": number;
  Plans?: Plan[];
};

test("corpus readiness scans canonical roots once and preserves provenance reconciliation", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const { openDatabase } = await import(new URL("../../../scripts/dev-corpus/guard.mjs", import.meta.url).href);
  const database = await openDatabase();
  const client = await database.connect();
  const workspaceId = randomUUID();
  const siblingId = randomUUID();
  const read = () => loadSignalWorkspaceCorpusReadinessStoreV1({ queryable: client, workspace_id: workspaceId });
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path=pg_temp,public,extensions");
    await client.query("SELECT set_config('fixture.workspace',$1,true),set_config('fixture.sibling',$2,true)", [workspaceId, siblingId]);
    // Temporary relations permit malformed provenance cases that live constraints reject.
    // The real reader executes unchanged and all fixture data rolls back on this client.
    await client.query(`
      CREATE TEMP TABLE import_batches (
        id uuid PRIMARY KEY,workspace_id uuid,data_source_id uuid,status text,record_count integer,
        included_count integer,excluded_count integer,duplicate_count integer,
        provider_observation_projection_state text,provider_observation_count bigint
      ) ON COMMIT DROP;
      CREATE TEMP TABLE mentions (
        id uuid PRIMARY KEY,workspace_id uuid,canonical_mention_id uuid,inclusion_status text,text_clean text
      ) ON COMMIT DROP;
      CREATE INDEX ON mentions(workspace_id,id);
      CREATE TEMP TABLE signal_mention_import_memberships (
        workspace_id uuid,import_batch_id uuid,data_source_id uuid,mention_id uuid
      ) ON COMMIT DROP;
      CREATE INDEX ON signal_mention_import_memberships(import_batch_id,mention_id);
      CREATE TEMP TABLE signal_provider_mention_observations (
        id uuid,workspace_id uuid,import_batch_id uuid,data_source_id uuid,mention_id uuid
      ) ON COMMIT DROP;
      CREATE TEMP TABLE data_sources (id uuid,workspace_id uuid,status text) ON COMMIT DROP;
      CREATE TEMP TABLE signal_provenance_policy_bindings (
        id uuid,workspace_id uuid,data_source_id uuid,import_batch_id uuid,status text,
        effective_from timestamptz,effective_to timestamptz,binding_version integer,
        retention_policy_id uuid,licensing_policy_id uuid
      ) ON COMMIT DROP;
      CREATE TEMP TABLE signal_retention_policies (
        id uuid,workspace_id uuid,status text,effective_from timestamptz,effective_to timestamptz,
        retention_state text,retention_mode text,retain_until timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE signal_licensing_policies (
        id uuid,workspace_id uuid,status text,effective_from timestamptz,effective_to timestamptz
      ) ON COMMIT DROP;
      CREATE TEMP TABLE signal_licensing_policy_usages (
        workspace_id uuid,licensing_policy_id uuid,usage_purpose text,decision text
      ) ON COMMIT DROP;
      CREATE TEMP TABLE signal_mention_attributions (
        workspace_id uuid,mention_id uuid,import_batch_id uuid,data_source_id uuid,
        attribution_basis text,is_current boolean,review_status text,eligibility_status text
      ) ON COMMIT DROP;
    `);
    await client.query(`
      INSERT INTO mentions
      SELECT md5('root:'||g)::uuid,current_setting('fixture.workspace')::uuid,md5('root:'||g)::uuid,
        CASE WHEN g%10=0 THEN 'excluded' ELSE 'included' END,
        CASE WHEN g=10 THEN '   ' ELSE repeat('Synthetic corpus text. ',100) END
      FROM generate_series(1,7000) g;
      INSERT INTO mentions VALUES(md5('sibling-root')::uuid,current_setting('fixture.sibling')::uuid,md5('sibling-root')::uuid,'included','Sibling text');
      INSERT INTO import_batches
      SELECT md5('batch:'||b)::uuid,current_setting('fixture.workspace')::uuid,md5('source:'||b)::uuid,'completed',
        600,540,60,0,'ready',CASE WHEN b=1 THEN 601 ELSE 600 END
      FROM generate_series(1,11) b;
      INSERT INTO import_batches VALUES(md5('failed')::uuid,current_setting('fixture.workspace')::uuid,md5('source:1')::uuid,
        'failed',1000,900,100,0,'ready',1000);
      INSERT INTO import_batches VALUES(md5('sibling')::uuid,current_setting('fixture.sibling')::uuid,md5('source:1')::uuid,
        'completed',1000,900,100,0,'ready',1000);
      INSERT INTO signal_mention_import_memberships
      SELECT current_setting('fixture.workspace')::uuid,md5('batch:'||b)::uuid,md5('source:'||b)::uuid,
        md5('root:'||(((b-1)*600+g-1)%6000+1))::uuid
      FROM generate_series(1,11) b CROSS JOIN generate_series(1,600) g;
      INSERT INTO signal_mention_import_memberships
      SELECT current_setting('fixture.workspace')::uuid,md5('failed')::uuid,md5('source:1')::uuid,md5('root:'||g)::uuid
      FROM generate_series(6001,7000) g;
      INSERT INTO signal_provider_mention_observations
      SELECT gen_random_uuid(),workspace_id,import_batch_id,data_source_id,mention_id
      FROM signal_mention_import_memberships;
      INSERT INTO signal_provider_mention_observations
      VALUES(gen_random_uuid(),current_setting('fixture.workspace')::uuid,md5('batch:1')::uuid,md5('source:1')::uuid,md5('root:1')::uuid);
      INSERT INTO signal_provider_mention_observations
      VALUES(gen_random_uuid(),current_setting('fixture.sibling')::uuid,md5('batch:1')::uuid,md5('source:1')::uuid,md5('root:2')::uuid);
      INSERT INTO data_sources SELECT md5('source:'||b)::uuid,current_setting('fixture.workspace')::uuid,'active' FROM generate_series(1,11) b;
      INSERT INTO signal_retention_policies VALUES(md5('retention')::uuid,current_setting('fixture.workspace')::uuid,'active',
        now()-interval '1 day',NULL,'allowed','indefinite',NULL);
      INSERT INTO signal_licensing_policies VALUES(md5('license')::uuid,current_setting('fixture.workspace')::uuid,'active',now()-interval '1 day',NULL);
      INSERT INTO signal_licensing_policy_usages VALUES(current_setting('fixture.workspace')::uuid,md5('license')::uuid,'llm-processing','allowed');
      INSERT INTO signal_provenance_policy_bindings
      SELECT md5('binding:'||b)::uuid,current_setting('fixture.workspace')::uuid,md5('source:'||b)::uuid,NULL,'active',
        now()-interval '1 day',NULL,1,md5('retention')::uuid,md5('license')::uuid
      FROM generate_series(1,11) b;
      INSERT INTO signal_mention_attributions
      SELECT current_setting('fixture.workspace')::uuid,md5('root:'||g)::uuid,md5('batch:1')::uuid,md5('source:1')::uuid,
        'mention_semantic',true,'approved','eligible' FROM generate_series(1,100) g;
      INSERT INTO signal_mention_attributions VALUES(current_setting('fixture.workspace')::uuid,md5('root:601')::uuid,md5('batch:2')::uuid,
        md5('wrong-source')::uuid,'mention_semantic',true,'approved','eligible');
    `);
    // Match stale estimates for a workspace first received after the last ANALYZE.
    const received = await read();
    assert.equal(received.state, "received");
    assert.equal(received.accepted_files, 11);
    assert.equal(received.records_read, 6600);
    assert.deepEqual(received.dispositions, { included: 5940, excluded: 660, duplicates: 0 });
    assert.deepEqual(received.projection, {
      observations: 6601, linked_roots: 6000, included_roots: 5400, excluded_roots: 600, roots_with_text: 5999,
    });
    assert.deepEqual(received.eligibility, {
      rights_eligible_roots: 5400, rights_blocked_roots: 0, semantic_eligible_roots: 90, semantic_pending_roots: 5310,
    });
    assert.deepEqual(received.reconciliation_errors, []);
    let statement = "";
    await loadSignalWorkspaceCorpusReadinessStoreV1({ workspace_id: workspaceId,
      queryable: { query: async (sql, values) => { statement = sql; return client.query(sql, values); } },
    });
    const explained = await client.query("EXPLAIN(ANALYZE,FORMAT JSON) " + statement, [workspaceId]);
    const scans: Plan[] = [];
    const inspect = (node: Plan) => {
      if (node["Relation Name"] === "mentions") scans.push(node);
      node.Plans?.forEach(inspect);
    };
    inspect(explained.rows[0]["QUERY PLAN"][0].Plan);
    assert.equal(scans.length, 1);
    assert.ok(scans[0]!["Actual Loops"] <= 1,
      "readiness must scan workspace roots once instead of a random heap lookup per import membership");

    await client.query("SAVEPOINT denied_import");
    await client.query(`
      INSERT INTO signal_retention_policies VALUES(md5('blocked')::uuid,current_setting('fixture.workspace')::uuid,'active',
        now()-interval '1 day',NULL,'blocked','indefinite',NULL);
      INSERT INTO signal_provenance_policy_bindings VALUES(md5('override')::uuid,current_setting('fixture.workspace')::uuid,
        md5('source:1')::uuid,md5('batch:1')::uuid,'active',now()-interval '1 day',NULL,2,
        md5('blocked')::uuid,md5('license')::uuid);
    `);
    const denied = await read();
    assert.equal(denied.eligibility.rights_eligible_roots, 5400, "the overlapping allowed import still covers its roots");
    assert.equal(denied.eligibility.semantic_eligible_roots, 0,
      "semantic evidence on the denied import cannot borrow rights from an overlapping import");
    await client.query("ROLLBACK TO SAVEPOINT denied_import");

    await client.query("SAVEPOINT corrupt");
    await client.query(`
      INSERT INTO signal_mention_import_memberships
      VALUES(current_setting('fixture.workspace')::uuid,md5('batch:1')::uuid,md5('source:1')::uuid,md5('sibling-root')::uuid);
      INSERT INTO signal_provider_mention_observations
      VALUES(gen_random_uuid(),current_setting('fixture.workspace')::uuid,md5('batch:1')::uuid,md5('source:1')::uuid,md5('root:6999')::uuid);
      UPDATE mentions SET text_clean=' ' WHERE id=md5('root:2')::uuid;
      UPDATE mentions SET inclusion_status='pending' WHERE id=md5('root:3')::uuid;
    `);
    const corrupt = await read();
    assert.equal(corrupt.state, "needs_attention");
    assert.deepEqual(corrupt.reconciliation_errors, [
      "canonical_root_link_invalid", "provider_observation_membership_missing",
      "provider_observation_count_mismatch", "included_root_text_missing", "canonical_inclusion_pending",
    ]);
    assert.equal(corrupt.projection.linked_roots, 6000, "a foreign-workspace mention never joins the root population");
    await client.query("ROLLBACK TO SAVEPOINT corrupt");

    await client.query("UPDATE import_batches SET status='failed' WHERE workspace_id=$1::uuid", [workspaceId]);
    const empty = await read();
    assert.equal(empty.state, "awaiting_import");
    assert.equal(empty.accepted_files, 0);
    assert.equal(empty.projection.linked_roots, 0);
    assert.equal(empty.projection.observations, 0);
    assert.deepEqual(empty.reconciliation_errors, []);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await database.end();
  }
});
