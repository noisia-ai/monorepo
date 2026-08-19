import assert from "node:assert/strict";
import { readdir,readFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import test from "node:test";

import pg from "pg";

const URL = process.env.NOISIA_SIGNAL_GREENFIELD_PRODUCT_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GREENFIELD_PRODUCT_INTEGRATION_APPROVED==="true";
const directory = resolve(process.cwd(),"migrations");

test("0077-0078 keep bridge-derived state and governance requests auditable",{
  skip: !URL || !APPROVED
},async () => {
  assert.ok(URL);requireLocal(URL);
  const client = new pg.Client({ connectionString: URL,ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/u.test(file)).sort();
    for (const file of files) await client.query(await readFile(join(directory,file),"utf8"));
    await client.query(await readFile(join(directory,"0077_signal_operational_bridge_digest.sql"),"utf8"));
    await client.query(await readFile(join(directory,"0078_signal_greenfield_product_control_plane.sql"),"utf8"));
    assert.equal((await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM signal_governance_control_operations"
    )).rows[0]!.count,0);
    await client.query(`
      INSERT INTO organizations (id,slug,legal_name,display_name,status)
      VALUES ('78000000-0000-4000-8000-000000000001','greenfield-ledger','Greenfield ledger','Greenfield ledger','active');
      INSERT INTO users (id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES ('78000000-0000-4000-8000-000000000002','greenfield-ledger@example.test','Greenfield operator',
        'noisia_internal','noisia_admin','78000000-0000-4000-8000-000000000001','active');
      INSERT INTO brands (id,organization_id,slug,name,display_name,countries,status)
      VALUES ('78000000-0000-4000-8000-000000000003','78000000-0000-4000-8000-000000000001',
        'greenfield-ledger-brand','Greenfield ledger brand','Greenfield ledger brand',ARRAY['MX']::char(2)[],'active')
    `);
    const workspace = (await client.query<{ id: string }>(
      "SELECT id::text FROM signal_workspaces WHERE brand_id='78000000-0000-4000-8000-000000000003'::uuid"
    )).rows[0]!.id;
    const digest = `sha256:${"1".repeat(64)}`;
    const key = `sha256:${"2".repeat(64)}`;
    await client.query(`
      INSERT INTO signal_governance_control_operations (
        workspace_id,actor_user_id,action,request_digest,idempotency_key,status
      ) VALUES ($1::uuid,'78000000-0000-4000-8000-000000000002','update-timezone',$2,$3,'in_progress')
    `,[workspace,digest,key]);
    await client.query(`
      UPDATE signal_governance_control_operations
      SET status='completed',result='{"changed":true}'::jsonb,
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `,[workspace,key]);
    await assert.rejects(client.query(`
      UPDATE signal_governance_control_operations SET result='{"changed":false}'::jsonb
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `,[workspace,key]),(error: unknown) => (error as { code?: string }).code==="55000");
    await assert.rejects(client.query(`
      DELETE FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid AND idempotency_key=$2
    `,[workspace,key]),(error: unknown) => (error as { code?: string }).code==="55000");
    const triggers = await client.query<{ name: string }>(`
      SELECT tgname AS name FROM pg_trigger
      WHERE NOT tgisinternal AND tgname IN (
        'trg_signal_operational_bridge_digest_membership',
        'trg_protect_signal_governance_control_operation'
      ) ORDER BY tgname
    `);
    assert.deepEqual(triggers.rows.map((row) => row.name),[
      "trg_protect_signal_governance_control_operation",
      "trg_signal_operational_bridge_digest_membership"
    ]);
  } finally { await client.end(); }
});

function requireLocal(value: string) {
  const parsed = new globalThis.URL(value);
  assert.ok(["127.0.0.1","localhost","::1"].includes(parsed.hostname));
  assert.match(parsed.pathname,/migration[_-]smoke/u);
}
