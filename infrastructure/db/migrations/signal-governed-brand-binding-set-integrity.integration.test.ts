import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GOVERNED_BINDING_SET_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GOVERNED_BINDING_SET_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));
const MODULES = ["brand-monitoring", "mentions", "topics-narratives"] as const;

const IDS = {
  organization: "72000000-0000-4000-8000-000000007201",
  actor: "72000000-0000-4000-8000-000000007202",
  otherActor: "72000000-0000-4000-8000-000000007203",
  brand: "72000000-0000-4000-8000-000000007204",
  workspace: "72000000-0000-4000-8000-000000007205",
  bundleA: "72000000-0000-4000-8000-000000007206",
  bundleB: "72000000-0000-4000-8000-000000007207"
} as const;

test("0072 rejects fabricated history and enforces exact atomic binding-set authority", {
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
    await applyMigrationsRange(client, 59, 71);
    await seedBundles(client);
    const bindingsA = await seedBindings(client, IDS.bundleA, "current", 1);
    const bindingsB = await seedBindings(client, IDS.bundleB, "retired", 2);
    const protectedBefore = await protectedState(client);

    // 0071 allowed an operation to commit without its complete three-module history.
    // 0072 must refuse to install over that fabricated state.
    await client.query("BEGIN");
    await insertOperation(client, "promote", IDS.bundleA, IDS.actor);
    await assert.rejects(
      client.query(await readMigration("0072_signal_governed_brand_binding_set_integrity.sql")),
      (error: unknown) => (error as { code?: string }).code === "23514"
    );
    await client.query("ROLLBACK");

    await applyMigration(client, "0072_signal_governed_brand_binding_set_integrity.sql");
    assert.deepEqual(await protectedState(client), protectedBefore);

    await assertInvalidSet(client, async (operationId) => {
      const eventId = await insertEvent(client, {
        moduleKey: "mentions",
        action: "promote",
        actorId: IDS.otherActor,
        nextBindingId: bindingsA.mentions
      });
      await insertItem(client, operationId, "mentions", null, bindingsA.mentions, eventId);
    }, "promote", IDS.bundleA, IDS.actor);

    await assertInvalidSet(client, async (operationId) => {
      const eventId = await insertEvent(client, {
        moduleKey: "mentions",
        action: "promote",
        actorId: IDS.actor,
        nextBindingId: bindingsB.mentions
      });
      await insertItem(client, operationId, "mentions", null, bindingsB.mentions, eventId);
    }, "promote", IDS.bundleA, IDS.actor);

    await assertInvalidSet(client, async (operationId) => {
      const eventId = await insertEvent(client, {
        moduleKey: "mentions",
        action: "withdraw-to-bridge",
        actorId: IDS.actor,
        previousBindingId: bindingsB.mentions
      });
      await insertItem(client, operationId, "mentions", bindingsB.mentions, null, eventId);
    }, "withdraw-to-bridge", IDS.bundleA, IDS.actor);

    await client.query("BEGIN");
    const partialOperation = await insertOperation(client, "promote", IDS.bundleA, IDS.actor);
    for (const moduleKey of MODULES.slice(0, 2)) {
      const bindingId = bindingsA[moduleKey];
      const eventId = await insertEvent(client, {
        moduleKey,
        action: "promote",
        actorId: IDS.actor,
        nextBindingId: bindingId
      });
      await insertItem(client, partialOperation, moduleKey, null, bindingId, eventId);
    }
    await assert.rejects(
      client.query("COMMIT"),
      (error: unknown) => (error as { code?: string }).code === "23514"
    );
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    const validOperation = await insertOperation(client, "promote", IDS.bundleA, IDS.actor);
    for (const moduleKey of MODULES) {
      const bindingId = bindingsA[moduleKey];
      const eventId = await insertEvent(client, {
        moduleKey,
        action: "promote",
        actorId: IDS.actor,
        nextBindingId: bindingId
      });
      await insertItem(client, validOperation, moduleKey, null, bindingId, eventId);
    }
    await client.query("COMMIT");

    assert.deepEqual(await row(client, `
      SELECT count(*)::int AS operations,
        (SELECT count(*)::int FROM signal_governed_brand_binding_set_operation_items)
          AS items
      FROM signal_governed_brand_binding_set_operations
    `), { operations: 1, items: 3 });

    const protectedHistory = await protectedState(client);

    await assertHistoryMutationRejected(client, `
      UPDATE signal_governed_brand_binding_set_operation_items
      SET created_at = created_at + interval '1 second'
      WHERE operation_id = $1::uuid AND module_key = 'mentions'
    `, [validOperation]);
    await assertHistoryMutationRejected(client, `
      DELETE FROM signal_governed_brand_binding_set_operation_items
      WHERE operation_id = $1::uuid AND module_key = 'mentions'
    `, [validOperation]);
    await assertHistoryMutationRejected(client, `
      UPDATE signal_governed_view_binding_events
      SET created_at = created_at + interval '1 second'
      WHERE id = (
        SELECT binding_event_id
        FROM signal_governed_brand_binding_set_operation_items
        WHERE operation_id = $1::uuid AND module_key = 'mentions'
      )
    `, [validOperation]);
    await assertHistoryMutationRejected(client, `
      DELETE FROM signal_governed_view_binding_events
      WHERE id = (
        SELECT binding_event_id
        FROM signal_governed_brand_binding_set_operation_items
        WHERE operation_id = $1::uuid AND module_key = 'mentions'
      )
    `, [validOperation]);
    await assertHistoryMutationRejected(client, `
      UPDATE signal_governed_view_bindings
      SET promoted_by_user_id = $2::uuid
      WHERE id = $1::uuid
    `, [bindingsA.mentions, IDS.otherActor]);
    await assertHistoryMutationRejected(client, `
      DELETE FROM signal_governed_view_bindings WHERE id = $1::uuid
    `, [bindingsA.mentions]);

    // The lifecycle mutation used by promote/withdraw remains legal, but no other
    // field can hitchhike on it. Roll back so the fixture itself stays byte-identical.
    await client.query("BEGIN");
    await client.query(`
      UPDATE signal_governed_view_bindings
      SET binding_status = 'retired', effective_to = clock_timestamp()
      WHERE id = $1::uuid
    `, [bindingsA.mentions]);
    await client.query("ROLLBACK");
    assert.deepEqual(await protectedState(client), protectedHistory);

    await assertHistoryMutationRejected(client, `
      UPDATE signal_governed_view_bindings
      SET binding_status = 'retired', effective_to = clock_timestamp(),
          promoted_by_user_id = $2::uuid
      WHERE id = $1::uuid
    `, [bindingsA.mentions, IDS.otherActor]);
    assert.deepEqual(await protectedState(client), protectedHistory);

    await applyMigration(client, "0072_signal_governed_brand_binding_set_integrity.sql");
    assert.deepEqual(await protectedState(client), protectedHistory);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int
      FROM pg_trigger
      WHERE tgname IN (
        'trg_signal_governed_brand_binding_set_item',
        'trg_signal_governed_brand_binding_set_cardinality',
        'trg_signal_governed_brand_binding_set_operations_append_only',
        'trg_signal_governed_brand_binding_set_items_append_only',
        'trg_signal_governed_view_binding_events_append_only',
        'trg_signal_governed_brand_referenced_binding_history'
      ) AND NOT tgisinternal
    `), 6);
  } finally {
    await client.end();
  }
});

async function seedWorkspace(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id,slug,legal_name,status)
    VALUES ($1::uuid,'binding-set-integrity','Binding Set Integrity','active')
  `, [IDS.organization]);
  await client.query(`
    INSERT INTO users (id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES
      ($1::uuid,'binding-set-a@example.test','Binding Set A','noisia_internal','admin',$3::uuid,'active'),
      ($2::uuid,'binding-set-b@example.test','Binding Set B','noisia_internal','admin',$3::uuid,'active')
  `, [IDS.actor, IDS.otherActor, IDS.organization]);
  await client.query(`
    INSERT INTO brands (id,organization_id,slug,name,status)
    VALUES ($1::uuid,$2::uuid,'binding-set-integrity','Binding Set Integrity','active')
  `, [IDS.brand, IDS.organization]);
  await client.query(`
    INSERT INTO signal_workspaces (id,organization_id,brand_id,slug,timezone,status)
    VALUES ($1::uuid,$2::uuid,$3::uuid,'binding-set-integrity','UTC','active')
  `, [IDS.workspace, IDS.organization, IDS.brand]);
}

async function seedBundles(client: pg.Client) {
  for (const [index, bundleId] of [IDS.bundleA, IDS.bundleB].entries()) {
    await client.query(`
      INSERT INTO signal_population_policy_bundles (
        id,workspace_id,policy_key,policy_version,status,
        authorized_modules,allowed_scopes,acceptance_status,
        quality_contract_status,eligibility_policy,deduplication_policy,
        visibility_class,denominator_key,definition_hash,created_by_user_id,
        activated_by_user_id,activated_at
      ) VALUES (
        $1::uuid,$2::uuid,'binding-set-policy',$3,'active',
        ARRAY['brand-monitoring','mentions','topics-narratives']::text[],
        ARRAY[]::text[],'any','not_available','workspace-reservoir',
        'canonical-root','operator-only','workspace-canonical-roots',$4,
        $5::uuid,$5::uuid,now()
      )
    `, [bundleId, IDS.workspace, index + 1, hash(`bundle-${index}`), IDS.actor]);
  }
}

async function seedBindings(
  client: pg.Client,
  bundleId: string,
  status: "current" | "retired",
  version: number
) {
  const result = {} as Record<(typeof MODULES)[number], string>;
  for (const moduleKey of MODULES) {
    result[moduleKey] = await scalar<string>(client, `
      INSERT INTO signal_governed_view_bindings (
        workspace_id,module_key,view_key,binding_version,
        policy_bundle_id,policy_definition_hash,binding_status,effective_to,
        promoted_by_user_id
      ) SELECT
        $1::uuid,$2,'brand',$3,$4::uuid,bundle.definition_hash,$5,
        CASE WHEN $5='retired' THEN now() ELSE NULL END,$6::uuid
      FROM signal_population_policy_bundles bundle WHERE bundle.id=$4::uuid
      RETURNING id::text
    `, [IDS.workspace, moduleKey, version, bundleId, status, IDS.actor]);
  }
  return result;
}

async function insertOperation(
  client: pg.Client,
  action: "promote" | "withdraw-to-bridge",
  bundleId: string,
  actorId: string
) {
  const nonce = randomUUID();
  return scalar<string>(client, `
    INSERT INTO signal_governed_brand_binding_set_operations (
      workspace_id,action,policy_bundle_id,actor_user_id,
      request_digest,result_digest,idempotency_key
    ) VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7)
    RETURNING id::text
  `, [IDS.workspace, action, bundleId, actorId,
    hash(`request-${nonce}`), hash(`result-${nonce}`), hash(`key-${nonce}`)]);
}

async function insertEvent(client: pg.Client, args: {
  moduleKey: (typeof MODULES)[number];
  action: "promote" | "withdraw-to-bridge";
  actorId: string;
  previousBindingId?: string;
  nextBindingId?: string;
}) {
  const nonce = randomUUID();
  return scalar<string>(client, `
    INSERT INTO signal_governed_view_binding_events (
      workspace_id,module_key,view_key,action,previous_binding_id,next_binding_id,
      actor_user_id,idempotency_key,request_digest
    ) VALUES ($1::uuid,$2,'brand',$3,$4::uuid,$5::uuid,$6::uuid,$7,$8)
    RETURNING id::text
  `, [IDS.workspace, args.moduleKey, args.action,
    args.previousBindingId ?? null, args.nextBindingId ?? null, args.actorId,
    hash(`event-${nonce}`), args.action === "withdraw-to-bridge" ? hash(`withdraw-${nonce}`) : null]);
}

async function insertItem(
  client: pg.Client,
  operationId: string,
  moduleKey: (typeof MODULES)[number],
  previousBindingId: string | null,
  nextBindingId: string | null,
  eventId: string
) {
  await client.query(`
    INSERT INTO signal_governed_brand_binding_set_operation_items (
      operation_id,workspace_id,module_key,view_key,
      previous_binding_id,next_binding_id,binding_event_id
    ) VALUES ($1::uuid,$2::uuid,$3,'brand',$4::uuid,$5::uuid,$6::uuid)
  `, [operationId, IDS.workspace, moduleKey, previousBindingId, nextBindingId, eventId]);
}

async function assertInvalidSet(
  client: pg.Client,
  insertInvalidItem: (operationId: string) => Promise<void>,
  action: "promote" | "withdraw-to-bridge",
  bundleId: string,
  actorId: string
) {
  await client.query("BEGIN");
  const operationId = await insertOperation(client, action, bundleId, actorId);
  await assert.rejects(
    insertInvalidItem(operationId),
    (error: unknown) => (error as { code?: string }).code === "23514"
  );
  await client.query("ROLLBACK");
}

async function assertHistoryMutationRejected(
  client: pg.Client,
  sql: string,
  params: unknown[] = []
) {
  await client.query("BEGIN");
  await assert.rejects(
    client.query(sql, params),
    (error: unknown) => (error as { code?: string }).code === "55000"
  );
  await client.query("ROLLBACK");
}

async function protectedState(client: pg.Client) {
  return row(client, `
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.id)
        FROM signal_workspace_population_pointers pointer), '[]'::jsonb) AS pointers,
      COALESCE((SELECT jsonb_agg(to_jsonb(definition) ORDER BY definition.id)
        FROM signal_population_definitions definition), '[]'::jsonb) AS definitions,
      COALESCE((SELECT jsonb_agg(to_jsonb(membership)
        ORDER BY membership.population_id,membership.mention_id)
        FROM signal_population_memberships membership), '[]'::jsonb) AS memberships,
      COALESCE((SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.id)
        FROM signal_governed_view_bindings binding), '[]'::jsonb) AS bindings,
      COALESCE((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id)
        FROM signal_governed_view_binding_events event), '[]'::jsonb) AS binding_events,
      COALESCE((SELECT jsonb_agg(to_jsonb(operation) ORDER BY operation.id)
        FROM signal_governed_brand_binding_set_operations operation), '[]'::jsonb)
        AS binding_set_operations,
      COALESCE((SELECT jsonb_agg(to_jsonb(item)
        ORDER BY item.operation_id,item.module_key,item.view_key)
        FROM signal_governed_brand_binding_set_operation_items item), '[]'::jsonb)
        AS binding_set_items
  `);
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

async function readMigration(file: string) {
  return readFile(join(migrationDir, file), "utf8");
}

async function applyMigration(client: pg.Client, file: string) {
  await applySql(client, await readMigration(file));
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

async function row<T extends Record<string, unknown>>(
  client: pg.Client,
  sql: string,
  params: unknown[] = []
) {
  const result = await client.query<T>(sql, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

function hash(seed: string) {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}
