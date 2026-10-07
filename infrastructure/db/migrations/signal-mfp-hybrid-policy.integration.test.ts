import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { planMfpHybridPolicyV1 } from "../signal-hybrid-policy";
import { createProcessingPolicyIdentitiesV1 } from "./signal-processing-policy.fixture";

test("H1 MFP policy successor preserves sibling actions and rolls back cleanly", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true", timeout: 120_000,
}, async () => {
  const database = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" });
  const scoped = await database.connect();
  try {
    assert.equal((await scoped.query("SELECT current_database() name")).rows[0].name, "noisia_mfp_ci");
    await scoped.query("BEGIN");
    const fixture = await createProcessingPolicyIdentitiesV1({ database, scoped });
    const key = `jev-policy-${randomUUID().replaceAll("-", "")}`;
    await scoped.query("UPDATE organizations SET slug=$2 WHERE id=$1", [fixture.first.organization_id, `mfp-${key}`]);
    const policy = randomUUID();
    await scoped.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,status,
      valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
      VALUES($1,$2,1,'draft',now()-interval '1 minute','infinity','UTC',1100000,$3)`, [
      policy, fixture.first.organization_id, fixture.actors.internal,
    ]);
    await scoped.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
      configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'corpus_preparation','free','{}'::jsonb,
        signal_semantic_context_digest_json_v2('{}'::jsonb),0,false)`, [policy]);
    await scoped.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
      provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1,'mention_facets','provider','typesafe','jev-1.13.0',$2::jsonb,
        signal_semantic_context_digest_json_v2($2::jsonb),NULL,false)`, [policy,
      JSON.stringify({ provider: "typesafe", model: "jev-1.13.0" })]);
    await scoped.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policy]);
    let savepoint = false;
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("BEGIN")) {
        assert.equal(savepoint, false); savepoint = true;
        return scoped.query("SAVEPOINT h1_policy");
      }
      if (sql === "COMMIT") {
        assert.equal(savepoint, true); savepoint = false;
        return scoped.query("RELEASE SAVEPOINT h1_policy");
      }
      if (sql === "ROLLBACK") {
        assert.equal(savepoint, true); savepoint = false;
        await scoped.query("ROLLBACK TO SAVEPOINT h1_policy");
        return scoped.query("RELEASE SAVEPOINT h1_policy");
      }
      return scoped.query(sql, params);
    };
    const wrapped = { connect: async () => ({ query, release() {} }) } as unknown as
      Parameters<typeof planMfpHybridPolicyV1>[0]["database"];
    const args = { database: wrapped, fixture_key: key, workspace_id: fixture.first.workspace_id,
      organization_id: fixture.first.organization_id, internal_user_id: fixture.actors.internal };
    assert.equal((await planMfpHybridPolicyV1(args)).status, "planned");
    assert.equal((await scoped.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1",
      [fixture.first.organization_id])).rows[0].n, 1);
    const siblingRun = randomUUID();
    const admitted = (await scoped.query<{ result: { receipt: { id: string } } }>(`SELECT admit_signal_processing_v1(
      $1::uuid,$2::uuid,'corpus_preparation',$3::uuid,$4,'sha256:'||repeat('b',64),0,false) result`,
      [fixture.second.workspace_id, fixture.actors.secondAdmin, siblingRun, randomUUID()])).rows[0]!.result.receipt;
    await scoped.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,
      processing_admission_id,status,worker_job_id) VALUES($1,$2,$3,$4,'running',$5)`,
      [siblingRun, fixture.second.workspace_id, fixture.actors.secondAdmin, admitted.id, `h1-policy-${siblingRun}`]);
    const blocked = await planMfpHybridPolicyV1({ ...args, execute: true });
    assert.equal(blocked.status, "blocked", "sibling admission must keep its policy active");
    assert.equal(blocked.active_owners, 1);
    await scoped.query("UPDATE signal_corpus_preparation_runs SET status='failed' WHERE id=$1", [siblingRun]);
    const result = await planMfpHybridPolicyV1({ ...args, execute: true });
    assert.equal(result.status, "activated");
    const successor = (await scoped.query<{ id: string; daily_cap_micro_usd: string }>(`
      SELECT id,daily_cap_micro_usd::text FROM signal_processing_policy_versions
      WHERE organization_id=$1 AND status='active'`, [fixture.first.organization_id])).rows[0]!;
    assert.notEqual(successor.id, policy);
    assert.equal(successor.daily_cap_micro_usd, "1100000");
    const actions = (await scoped.query<{ action: string; provider: string | null; model: string | null }>(`
      SELECT action,provider,model FROM signal_processing_policy_actions
      WHERE policy_version_id=$1 ORDER BY action`, [successor.id])).rows;
    assert.deepEqual(actions.map(row => row.action), ["concept_membership_claude", "concept_membership_jev",
      "corpus_preparation", "mention_facets"]);
    assert.deepEqual(actions.find(row => row.action === "mention_facets"), {
      action: "mention_facets", provider: "typesafe", model: "jev-1.13.0",
    });
    assert.equal((await planMfpHybridPolicyV1(args)).status, "unchanged");
    await scoped.query("ROLLBACK");
    assert.equal((await database.query("SELECT count(*)::int n FROM signal_processing_policy_versions WHERE id=$1",
      [policy])).rows[0].n, 0);
  } finally {
    await scoped.query("ROLLBACK").catch(() => undefined);
    scoped.release();
    await database.end();
  }
});
