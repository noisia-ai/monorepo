import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GOVERNED_BINDING_WITHDRAWAL_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GOVERNED_BINDING_WITHDRAWAL_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organization: "71000000-0000-4000-8000-000000007101",
  actor: "71000000-0000-4000-8000-000000007102",
  brand: "71000000-0000-4000-8000-000000007103",
  workspace: "71000000-0000-4000-8000-000000007104"
} as const;

test("0071 is forward-only, idempotent and creates no binding state", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 58);
    await seedWorkspace(client);
    await applyMigrationsRange(client, 59, 70);
    const protectedBefore = await protectedState(client);

    await applyMigration(client, "0071_signal_governed_brand_binding_withdrawal.sql");
    const afterFirst = await protectedState(client);
    assert.deepEqual(afterFirst, protectedBefore);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_brand_binding_set_operations
    `), 0);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_brand_binding_set_operation_items
    `), 0);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_binding_events
      WHERE action='withdraw-to-bridge'
    `), 0);

    assert.equal(await scalar<boolean>(client, `
      SELECT is_nullable='YES' FROM information_schema.columns
      WHERE table_schema='public' AND table_name='signal_governed_view_binding_events'
        AND column_name='next_binding_id'
    `), true);
    assert.equal(await scalar<boolean>(client, `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='signal_governed_view_binding_events'
          AND column_name='request_digest'
      )
    `), true);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM pg_proc
      WHERE proname IN (
        'withdraw_signal_governed_view_binding',
        'signal_governed_view_binding_digest_v1',
        'enforce_signal_governed_brand_binding_set_operation',
        'enforce_signal_governed_brand_binding_set_item'
      )
    `), 4);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM pg_constraint
      WHERE conname IN (
        'signal_governed_view_binding_event_transition_shape',
        'signal_governed_view_binding_event_request_digest',
        'signal_governed_brand_binding_set_action',
        'signal_governed_brand_binding_set_hashes',
        'signal_governed_brand_binding_set_item_identity'
      )
    `), 5);
    await assert.rejects(client.query(`
      INSERT INTO signal_governed_view_binding_events (
        workspace_id,module_key,view_key,action,actor_user_id,idempotency_key,request_digest
      ) VALUES ($1::uuid,'mentions','brand','withdraw-to-bridge',$2::uuid,$3,$4)
    `, [IDS.workspace, IDS.actor, hash("invalid-event-key"), hash("invalid-event-request")]),
    (error: unknown) => (error as { code?: string }).code === "23514");

    await applyMigration(client, "0071_signal_governed_brand_binding_withdrawal.sql");
    assert.deepEqual(await protectedState(client), afterFirst);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_brand_binding_set_operations
    `), 0);
  } finally {
    await client.end();
  }
});

async function seedWorkspace(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id,slug,legal_name,status)
    VALUES ($1::uuid,'binding-withdrawal','Binding Withdrawal','active')
  `, [IDS.organization]);
  await client.query(`
    INSERT INTO users (id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES ($1::uuid,'binding-withdrawal@example.test','Binding Withdrawal',
      'noisia_internal','admin',$2::uuid,'active')
  `, [IDS.actor, IDS.organization]);
  await client.query(`
    INSERT INTO brands (id,organization_id,slug,name,status)
    VALUES ($1::uuid,$2::uuid,'binding-withdrawal','Binding Withdrawal','active')
  `, [IDS.brand, IDS.organization]);
  await client.query(`
    INSERT INTO signal_workspaces (id,organization_id,brand_id,slug,timezone,status)
    VALUES ($1::uuid,$2::uuid,$3::uuid,'binding-withdrawal','UTC','active')
  `, [IDS.workspace, IDS.organization, IDS.brand]);
}

async function protectedState(client: pg.Client) {
  const result = await client.query(`
    SELECT jsonb_build_object(
      'pointers', COALESCE((SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.id)
        FROM signal_workspace_population_pointers pointer), '[]'::jsonb),
      'definitions', COALESCE((SELECT jsonb_agg(to_jsonb(definition) ORDER BY definition.id)
        FROM signal_population_definitions definition), '[]'::jsonb),
      'memberships', COALESCE((SELECT jsonb_agg(to_jsonb(membership)
        ORDER BY membership.population_id,membership.mention_id)
        FROM signal_population_memberships membership), '[]'::jsonb),
      'bundles', COALESCE((SELECT jsonb_agg(to_jsonb(bundle) ORDER BY bundle.id)
        FROM signal_population_policy_bundles bundle), '[]'::jsonb),
      'bindings', COALESCE((SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.id)
        FROM signal_governed_view_bindings binding), '[]'::jsonb)
    ) AS state
  `);
  return result.rows[0]!.state;
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) await applySql(client, await readFile(join(migrationDir, file), "utf8"));
}

async function applyMigrationsRange(client: pg.Client, minimum: number, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .filter((file) => Number(file.slice(0, 4)) >= minimum && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) await applySql(client, await readFile(join(migrationDir, file), "utf8"));
}

async function applyMigration(client: pg.Client, file: string) {
  await applySql(client, await readFile(join(migrationDir, file), "utf8"));
}

async function applySql(client: pg.Client, sql: string) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as T;
}

function hash(seed: string) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}
