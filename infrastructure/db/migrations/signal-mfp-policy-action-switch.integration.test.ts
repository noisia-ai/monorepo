import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { readMfpPolicySwitchBlockersV1 } from "../signal-labeling-policy-action-switch";

test("a terminal invalid receipt does not block the next MFP policy", {
  skip: process.env.NOISIA_MFP_PG_CI !== "true",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/noisia_mfp_ci");
  const pool = new Pool({ connectionString: url.href, max: 1 });
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const org = randomUUID(), brand = randomUUID();
  const actor = randomUUID(), prep = randomUUID(), labeler = randomUUID(), run = randomUUID(), call = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO organizations(id,slug,legal_name,status)
      VALUES($1,$2,$3,'active')`, [org, `mfp-policy-${suffix}`, "MFP policy integration fixture"]);
    await client.query(`INSERT INTO brands(id,organization_id,slug,name,status)
      VALUES($1,$2,$3,$4,'active')`, [brand, org, `mfp-policy-${suffix}`, "MFP policy fixture"]);
    await client.query(`INSERT INTO users(id,email,user_type,primary_role,organization_id,status)
      VALUES($1,$2,'noisia_internal','noisia_admin',$3,'active')`, [actor, `mfp-policy-${suffix}@example.invalid`, org]);
    const workspace = (await client.query<{ id: string }>(`SELECT id FROM signal_workspaces
      WHERE organization_id=$1 AND brand_id=$2`, [org, brand])).rows[0]?.id;
    assert.ok(workspace, "brand provisioning must create the workspace");
    await client.query(`INSERT INTO signal_corpus_preparation_runs(id,workspace_id,actor_user_id,worker_job_id)
      VALUES($1,$2,$3,$4)`, [prep, workspace, actor, `mfp-policy-${suffix}`]);
    await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,labeler_digest,identity)
      VALUES($1,'facets','anthropic','claude-sonnet-5-5',$2,$2,$3,'{}'::jsonb)`, [labeler, `sha256:${"0".repeat(64)}`, `sha256:${suffix.padEnd(64, "0")}`]);
    await client.query(`INSERT INTO signal_entity_context_versions
      (workspace_id,version_no,digest,context,diff,affected_mode,affected_count)
      VALUES($1,1,$2,'{}'::jsonb,'{}'::jsonb,'targeted',0)`, [workspace, `sha256:${"1".repeat(64)}`]);
    await client.query(`INSERT INTO signal_labeling_runs
      (id,workspace_id,kind,labeler_version_id,preparation_run_id,entity_context_digest,
       entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,actor_user_id,error_code)
      VALUES($1,$2,'facets',$3,$4,$5,1,'failed',0,$6,$7,$8,'labeling_raw_receipt_invalid')`,
    [run, workspace, labeler, prep, `sha256:${"1".repeat(64)}`, `mfp-policy-${suffix}`, `sha256:${"2".repeat(64)}`, actor]);
    await client.query(`INSERT INTO signal_labeling_calls
      (id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,
       status,reserved_micro_usd,settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,
       budget_date,budget_timezone)
      VALUES($1,$2,$3,'anthropic','claude-sonnet-5-5','batch',$4,$5,'{}'::jsonb,'[]'::jsonb,
       'failed',47,47,$6,$7,4,current_date,'UTC')`,
    [call, run, workspace, `mfp-policy-${suffix}`, `sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`, `private/${suffix}`]);

    assert.deepEqual(await readMfpPolicySwitchBlockersV1(client, org), {
      labeling_runs: 0, labeling_calls: 0, unapplied_raw: 0, embedding_runs: 0,
    });
    await client.query("UPDATE signal_labeling_calls SET status='submitted' WHERE id=$1", [call]);
    assert.equal((await readMfpPolicySwitchBlockersV1(client, org)).unapplied_raw, 1);
    assert.equal((await readMfpPolicySwitchBlockersV1(client, org)).labeling_calls, 1);
    await client.query("UPDATE signal_labeling_calls SET status='failed' WHERE id=$1", [call]);
    await client.query("UPDATE signal_labeling_runs SET error_code='other_failure' WHERE id=$1", [run]);
    assert.equal((await readMfpPolicySwitchBlockersV1(client, org)).unapplied_raw, 1);
    await client.query("UPDATE signal_labeling_runs SET error_code='labeling_raw_receipt_invalid' WHERE id=$1", [run]);
    assert.equal((await readMfpPolicySwitchBlockersV1(client, org)).unapplied_raw, 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
