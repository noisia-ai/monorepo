import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_MIGRATION_INTEGRATION_URL;
const APPROVED =
  process.env.NOISIA_SIGNAL_SEMANTIC_RESOLUTION_MIGRATION_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organization: "65000000-0000-4000-8000-000000000001",
  user: "65000000-0000-4000-8000-000000000002",
  brand: "65000000-0000-4000-8000-000000000003",
  source: "65000000-0000-4000-8000-000000000004",
  batch: "65000000-0000-4000-8000-000000000005",
  mention: "65000000-0000-4000-8000-000000000006"
} as const;

test("0065 is forward-only, row-inert and idempotent", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 180_000
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 63);
    const workspaceId = await seedBaseFixture(client);
    await client.query(await readFile(
      join(migrationDir, "0064_signal_semantic_scope_hardening.sql"),
      "utf8"
    ));
    await seedReviewedSemanticFixture(client, workspaceId);
    const before = await protectedState(client, workspaceId);

    const migrationSql = await readFile(
      join(migrationDir, "0065_signal_semantic_resolution.sql"),
      "utf8"
    );
    await client.query(migrationSql);
    const afterFirst = await protectedState(client, workspaceId);
    assert.deepEqual(afterFirst, before);
    await assertResolutionContract(client);

    const functionHashFirst = await reviewFunctionHash(client);
    await client.query(migrationSql);
    const afterSecond = await protectedState(client, workspaceId);
    assert.deepEqual(afterSecond, before);
    assert.equal(await reviewFunctionHash(client), functionHashFirst);
    await assertResolutionContract(client);

    assert.deepEqual(await row(client, `
      SELECT
        (SELECT count(*)::int FROM signal_semantic_resolution_runs) AS runs,
        (SELECT count(*)::int FROM signal_semantic_resolution_run_items) AS items
    `), { runs: 0, items: 0 });
  } finally {
    await client.end();
  }
});

async function applyMigrationsThrough(client: pg.Client, maxOrdinal: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maxOrdinal)
    .sort();
  for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
}

async function seedBaseFixture(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status)
    VALUES ($1::uuid, 'resolution-migration-org', 'Resolution migration org',
      'Resolution migration org', 'active');
  `, [IDS.organization]);
  await client.query(`
    INSERT INTO users (
      id, email, full_name, user_type, primary_role, organization_id, status
    ) VALUES ($2::uuid, 'resolution-migration@example.test', 'Resolution migration',
      'internal', 'admin', $1::uuid, 'active');
  `, [IDS.organization, IDS.user]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries, status
    ) VALUES ($2::uuid, $1::uuid, 'resolution-migration-brand',
      'Resolution migration brand', 'Resolution migration brand', ARRAY['MX']::char(2)[], 'active');
  `, [IDS.organization, IDS.brand]);
  const workspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brand]);
  await client.query(`
    INSERT INTO data_sources (
      id, workspace_id, organization_id, brand_id, source_type, provider,
      connection_method, name, governed_scope, governed_entity_type,
      governed_entity_id, scope_policy_version, scope_review_status,
      scope_approved_by_user_id, scope_approval_source, scope_approved_at,
      role, status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture', 'csv',
      'Resolution migration source', 'primary_brand', 'brand', $4::uuid,
      'workspace-source-scope-v1', 'approved', $5::uuid, 'fixture', now(),
      '{"ownership":"workspace"}'::jsonb, 'active'
    );
  `, [IDS.source, workspaceId, IDS.organization, IDS.brand, IDS.user]);
  await client.query(`
    INSERT INTO import_batches (
      id, workspace_id, data_source_id, mention_type, entity_kind, entity_label,
      source_system, imported_by_user_id, status, source_file_name
    ) VALUES (
      $4::uuid, $2::uuid, $1::uuid, 'brand', 'primary_brand',
      'Resolution migration brand', 'fixture', $3::uuid, 'completed', 'fixture.csv'
    );
  `, [IDS.source, workspaceId, IDS.user, IDS.batch]);
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id,
      provider_record_id, external_id, source_system, source_file_id,
      text_hash, text_clean, text_snippet, text_length, language,
      published_at, platform, resolved_platform, quality_score, inclusion_status
    ) VALUES (
      $4::uuid, $2::uuid, $1::uuid, $4::uuid,
      'resolution-migration-record', 'resolution-migration-record', 'fixture', $3::uuid,
      repeat('6', 64), 'Resolution migration fixture', 'Resolution fixture', 28, 'es',
      '2026-08-01T12:00:00Z', 'x', 'x', 9, 'included'
    );
  `, [IDS.source, workspaceId, IDS.batch, IDS.mention]);
  await client.query(`
    SELECT record_signal_mention_import_provenance($1::uuid, $2::uuid);
  `, [IDS.mention, IDS.batch]);
  return workspaceId;
}

async function seedReviewedSemanticFixture(client: pg.Client, workspaceId: string) {
  const assertionId = await scalar<string>(client, `
    SELECT create_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      'primary_brand', 'brand', $5::uuid, 'Resolution migration brand', 0.99,
      'explicit_primary_brand', $6, 'mention-semantic-human-review', '1', NULL, $7
    )::text
  `, [workspaceId, IDS.mention, IDS.source, IDS.batch, IDS.brand, hash("evidence"), hash("assertion")]);
  await client.query(`
    SELECT review_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, 'approve', 'fixture',
      'signal-semantic-human-review', '1', $3, $4
    )
  `, [assertionId, IDS.user, hash("rationale"), hash("review")]);
}

async function protectedState(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT
      (SELECT count(*)::int FROM signal_mention_attributions
        WHERE workspace_id = $1::uuid) AS attributions,
      (SELECT count(*)::int FROM signal_mention_attributions
        WHERE workspace_id = $1::uuid AND attribution_basis = 'mention_semantic') AS assertions,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events
        WHERE workspace_id = $1::uuid) AS review_events,
      (SELECT count(*)::int FROM signal_workspace_population_pointers
        WHERE workspace_id = $1::uuid) AS pointers,
      (SELECT count(*)::int FROM signal_population_memberships
        WHERE workspace_id = $1::uuid) AS memberships,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(attribution.*)::text, E'\n' ORDER BY attribution.id), ''), 'UTF8')), 'hex')
        FROM signal_mention_attributions attribution WHERE workspace_id = $1::uuid) AS attribution_digest,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(event.*)::text, E'\n' ORDER BY event.id), ''), 'UTF8')), 'hex')
        FROM signal_mention_attribution_review_events event WHERE workspace_id = $1::uuid)
        AS review_digest,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(membership.*)::text, E'\n' ORDER BY membership.id), ''), 'UTF8')), 'hex')
        FROM signal_population_memberships membership WHERE workspace_id = $1::uuid)
        AS membership_digest
  `, [workspaceId]);
}

async function assertResolutionContract(client: pg.Client) {
  const state = await row(client, `
    SELECT
      to_regclass('public.signal_semantic_resolution_runs') IS NOT NULL AS runs_table,
      to_regclass('public.signal_semantic_resolution_run_items') IS NOT NULL AS items_table,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
        AND indexname = 'uq_signal_semantic_resolution_active_workspace') AS active_unique,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_signal_semantic_resolution_run_item')
        AS item_unique,
      position('model_reviewed_context' in pg_get_constraintdef((
        SELECT constraint_row.oid FROM pg_constraint constraint_row
        JOIN pg_class relation ON relation.oid = constraint_row.conrelid
        WHERE relation.relname = 'signal_mention_attributions'
          AND constraint_row.conname = 'signal_mention_attribution_basis_contract'
      ))) > 0 AS model_context_allowed
  `);
  assert.deepEqual(state, {
    runs_table: true,
    items_table: true,
    active_unique: true,
    item_unique: true,
    model_context_allowed: true
  });
}

async function reviewFunctionHash(client: pg.Client) {
  const body = await scalar<string>(client, `
    SELECT procedure.prosrc FROM pg_proc procedure WHERE procedure.oid = to_regprocedure(
      'public.review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)'
    )
  `);
  return hash(body.trim());
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function row<T extends Record<string, unknown>>(
  client: pg.Client,
  sql: string,
  params: unknown[] = []
) {
  return (await client.query<T>(sql, params)).rows[0]!;
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as T;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname));
  assert.match(parsed.pathname, /(resolution|runner|smoke|throwaway)/u);
}
