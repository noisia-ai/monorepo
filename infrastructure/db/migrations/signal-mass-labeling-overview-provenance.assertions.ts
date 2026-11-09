import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { signalProvenancePolicyBindingDefinitionHashV1, signalWorkspaceEmbeddingDigestV1 as digest } from "@noisia/query-engine";
import { loadSignalWorkspaceTopicsOverviewV1 } from "../signal-workspace-topics-serving";

/** Two imports of the same canonical roots must preserve one complete rights path. */
export async function assertMassLabelingOverviewProvenanceV1(args: {
  database: Pool; query: PoolClient["query"]; workspace_id: string; actor_user_id: string;
}) {
  let summary: Record<string, unknown> | null = null;
  const database = Object.assign(Object.create(args.database), { connect: async () => {
    const client = await args.database.connect();
    return { release: () => client.release(), query: async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values);
      if (sql.includes("consumer_indicators") && sql.includes("FROM population root")) summary = result.rows[0];
      return result;
    } };
  } }) as Pool;
  const read = async (filters: { date_from?: string; date_to?: string; timezone?: string } = {}) => {
    summary = null;
    await loadSignalWorkspaceTopicsOverviewV1({ ...args, database, ...filters });
    assert.ok(summary);
    return Object.fromEntries(Object.entries(summary).filter(([key]) => !["observed_at", "rights_digest"].includes(key)));
  };
  const expected = await read();
  assert.equal(expected.denominator, 3);
  assert.equal(expected.evidence_visible_total, 3);
  const outside = await read({ date_from: "2099-01-01", date_to: "2099-01-02", timezone: "America/Sao_Paulo" });
  assert.equal(outside.denominator, 0, "civil date filters apply before topic and indicator counts");
  assert.deepEqual(outside.counts, []);
  assert.deepEqual(outside.series, []);
  await args.query("SAVEPOINT mass_overview_provenance");
  try {
    const binding = (await args.query(`SELECT * FROM signal_provenance_policy_bindings
      WHERE workspace_id=$1 AND status='active' AND import_batch_id IS NULL LIMIT 1`, [args.workspace_id])).rows[0]!;
    const original = (await args.query("SELECT id FROM import_batches WHERE workspace_id=$1 AND data_source_id=$2 AND status='completed' LIMIT 1", [args.workspace_id, binding.data_source_id])).rows[0]!.id;
    const duplicate = randomUUID();
    await args.query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,source_file_name,source_file_hash,
      status,record_count,included_count,excluded_count,duplicate_count,imported_by_user_id)
      SELECT $1,workspace_id,data_source_id,source_system,'synthetic-repeat.txt',$2,'processing',
        record_count,0,0,record_count,imported_by_user_id FROM import_batches WHERE id=$3`,
    [duplicate, digest(duplicate), original]);
    await args.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,import_batch_id,data_source_id,ingestion_disposition)
      SELECT workspace_id,mention_id,$1,data_source_id,'duplicate'
      FROM signal_mention_import_memberships WHERE import_batch_id=$2`, [duplicate, original]);
    const license = async (allowed: string[]) => {
      const id = randomUUID();
      await args.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,policy_version,status,
        approval_evidence_hash,definition_hash,created_by_user_id,creation_idempotency_key)
        SELECT $1,organization_id,workspace_id,$2,1,'draft',$3,$3,$4,$5
        FROM signal_licensing_policies WHERE id=$6`,
      [id, `synthetic-overview-${id}`, digest("synthetic rights evidence"), args.actor_user_id, digest(id), binding.licensing_policy_id]);
      await args.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,usage_purpose,decision)
        SELECT workspace_id,$1,usage_purpose,CASE WHEN usage_purpose=ANY($3::text[]) THEN 'allowed' ELSE 'prohibited' END
        FROM signal_licensing_policy_usages WHERE licensing_policy_id=$2`, [id, binding.licensing_policy_id, allowed]);
      await args.query("UPDATE signal_licensing_policies SET definition_hash=signal_licensing_policy_definition_hash(id) WHERE id=$1", [id]);
      await args.query("UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2,approved_at=now() WHERE id=$1", [id, args.actor_user_id]);
      return id;
    };
    const bind = async (batch: string, licensing: string, version: number) => {
      const value = { workspace_id: args.workspace_id, data_source_id: binding.data_source_id, import_batch_id: batch,
        binding_version: version, quality_policy_id: binding.quality_policy_id, retention_policy_id: binding.retention_policy_id,
        licensing_policy_id: licensing };
      await args.query(`UPDATE signal_provenance_policy_bindings SET status='retired',effective_to=now(),updated_at=now()
        WHERE workspace_id=$1 AND data_source_id=$2 AND import_batch_id=$3 AND status='active'`,
      [args.workspace_id, value.data_source_id, batch]);
      await args.query(`INSERT INTO signal_provenance_policy_bindings(workspace_id,data_source_id,import_batch_id,binding_version,
        status,quality_policy_id,retention_policy_id,licensing_policy_id,definition_hash,created_by_user_id,
        activated_by_user_id,activated_at,creation_idempotency_key)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$9,now(),$10)`,
      [args.workspace_id, value.data_source_id, batch, version, value.quality_policy_id, value.retention_policy_id,
        licensing, signalProvenancePolicyBindingDefinitionHashV1(value), args.actor_user_id, digest(randomUUID())]);
    };
    assert.deepEqual(await read(), expected);
    await bind(original, await license(["llm-processing", "client-derived-metrics"]), 1);
    assert.equal((await read()).evidence_visible_total, 0, "a pending import grants no complete evidence path");
    await args.query("SAVEPOINT complete_duplicate_import");
    await args.query("UPDATE import_batches SET status='completed' WHERE id=$1", [duplicate]);
    assert.deepEqual(await read(), expected, "duplicate provenance preserves every count and daily series");
    await args.query("ROLLBACK TO SAVEPOINT complete_duplicate_import; RELEASE SAVEPOINT complete_duplicate_import");
    await bind(duplicate, await license(["llm-processing", "client-mention-list", "client-text-or-excerpt"]), 1);
    await args.query("UPDATE import_batches SET status='completed' WHERE id=$1", [duplicate]);
    const split = await read();
    assert.equal(split.denominator, 3);
    assert.equal(split.evidence_visible_total, 0, "metrics and evidence cannot be combined across disjoint licenses");
    await bind(duplicate, binding.licensing_policy_id, 2);
    assert.deepEqual(await read(), expected, "one complete authorized path restores evidence without duplicate roots");
  } finally {
    await args.query("ROLLBACK TO SAVEPOINT mass_overview_provenance; RELEASE SAVEPOINT mass_overview_provenance");
  }
}
