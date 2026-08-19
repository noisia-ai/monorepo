import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  validateSignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GOVERNED_VIEWS_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GOVERNED_VIEWS_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organizationA: "68000000-0000-4000-8000-000000000001",
  organizationB: "68000000-0000-4000-8000-000000000002",
  userA: "68000000-0000-4000-8000-000000000101",
  userB: "68000000-0000-4000-8000-000000000102",
  brandA: "68000000-0000-4000-8000-000000000201",
  brandB: "68000000-0000-4000-8000-000000000202",
  brandAfter0068: "68000000-0000-4000-8000-000000000203",
  workspaceA: "68000000-0000-4000-8000-000000000211",
  workspaceB: "68000000-0000-4000-8000-000000000212",
  bundleA1: "68000000-0000-4000-8000-000000000301",
  bundleA2: "68000000-0000-4000-8000-000000000302",
  bundleA3: "68000000-0000-4000-8000-000000000304",
  bundleB: "68000000-0000-4000-8000-000000000303"
} as const;

test("0068 adds versioned governed view policies without moving legacy population pointers", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 58);
    const { workspaceA, workspaceB } = await seedWorkspaces(client);
    await applyMigrationsRange(client, 59, 67);

    const populationBefore = await populationState(client, workspaceA);
    assert.ok(populationBefore.pointer);
    const allPopulationsBefore = await allPopulationState(client);
    const totalPopulationRowsBefore = await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_definitions
    `);

    await applyMigration(client, "0068_signal_governed_views_population_policies.sql");
    await applyMigration(client, "0068_signal_governed_views_population_policies.sql");

    assert.deepEqual(await populationState(client, workspaceA), populationBefore);
    assert.deepEqual(await allPopulationState(client), allPopulationsBefore);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int FROM signal_population_definitions`), totalPopulationRowsBefore);
    assert.deepEqual(await row(client, `
      SELECT
        (SELECT count(*)::int FROM signal_population_policy_bundles) AS bundles,
        (SELECT count(*)::int FROM signal_population_policy_compilations) AS compilations,
        (SELECT count(*)::int FROM signal_governed_view_bindings) AS bindings,
        (SELECT count(*)::int FROM signal_governed_view_binding_events) AS events
    `), { bundles: 0, compilations: 0, bindings: 0, events: 0 });

    await insertBrandPolicy(client, {
      id: IDS.bundleA1,
      workspaceId: workspaceA,
      actorId: IDS.userA,
      version: 1,
      hash: brandPolicyHash(workspaceA, IDS.brandA, 1)
    });
    await insertBrandPolicy(client, {
      id: IDS.bundleA2,
      workspaceId: workspaceA,
      actorId: IDS.userA,
      version: 2,
      hash: brandPolicyHash(workspaceA, IDS.brandA, 2)
    });
    await insertBrandPolicy(client, {
      id: IDS.bundleA3,
      workspaceId: workspaceA,
      actorId: IDS.userA,
      version: 3,
      hash: brandPolicyHash(workspaceA, IDS.brandA, 3)
    });
    await insertBrandPolicy(client, {
      id: IDS.bundleB,
      workspaceId: workspaceB,
      actorId: IDS.userB,
      version: 1,
      hash: brandPolicyHash(workspaceB, IDS.brandB, 1)
    });
    await insertPolicyEntity(client, workspaceA, IDS.bundleA1, IDS.brandA);
    await insertPolicyEntity(client, workspaceA, IDS.bundleA2, IDS.brandA);
    await insertPolicyEntity(client, workspaceA, IDS.bundleA3, IDS.brandA);
    await insertPolicyEntity(client, workspaceB, IDS.bundleB, IDS.brandB);
    assert.equal(await scalar<string>(client, `
      SELECT signal_population_policy_bundle_definition_hash($1::uuid)
    `, [IDS.bundleA1]), brandPolicyHash(workspaceA, IDS.brandA, 1));

    await expectSqlState(client, "23514", `
      INSERT INTO signal_population_policy_entities (
        workspace_id, policy_bundle_id, scope, entity_type, entity_id
      ) VALUES ($1::uuid, $2::uuid, 'primary_brand', 'brand', $3::uuid)
    `, [workspaceB, IDS.bundleA1, IDS.brandB]);

    const firstKey = hash("1");
    const firstBinding = await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA1,
      actorId: IDS.userA,
      action: "promote",
      idempotencyKey: firstKey
    });
    assert.equal(await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA1,
      actorId: IDS.userA,
      action: "promote",
      idempotencyKey: firstKey
    }), firstBinding);
    assert.deepEqual(await bindingState(client, workspaceA), {
      current_count: 1,
      binding_versions: [1],
      event_actions: ["promote"]
    });

    const lateRetryKey = hash("a");
    assert.equal(await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA1,
      actorId: IDS.userA,
      action: "promote",
      idempotencyKey: lateRetryKey
    }), firstBinding);
    assert.deepEqual(await bindingState(client, workspaceA), {
      current_count: 1,
      binding_versions: [1],
      event_actions: ["promote", "promote"]
    });

    await expectSqlState(client, "23514", `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'mentions', 'brand', $2::uuid, NULL,
        $3::uuid, 'rollback', $4
      )
    `, [workspaceA, IDS.bundleA3, IDS.userA, hash("4")]);

    await expectSqlState(client, "23505", `
      INSERT INTO signal_governed_view_bindings (
        workspace_id, module_key, view_key, binding_version,
        policy_bundle_id, policy_definition_hash, binding_status,
        promoted_by_user_id
      ) VALUES (
        $1::uuid, 'mentions', 'brand', 99,
        $2::uuid, $3, 'current', $4::uuid
      )
    `, [workspaceA, IDS.bundleA1, brandPolicyHash(workspaceA, IDS.brandA, 1), IDS.userA]);

    const secondBinding = await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA2,
      actorId: IDS.userA,
      action: "promote",
      idempotencyKey: hash("2")
    });
    assert.notEqual(secondBinding, firstBinding);
    assert.equal(await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA1,
      actorId: IDS.userA,
      action: "promote",
      idempotencyKey: lateRetryKey
    }), firstBinding);
    assert.equal(await scalar<string>(client, `
      SELECT policy_bundle_id::text
      FROM signal_governed_view_bindings
      WHERE workspace_id = $1::uuid AND module_key = 'mentions'
        AND view_key = 'brand' AND binding_status = 'current'
    `, [workspaceA]), IDS.bundleA2);
    await expectSqlState(client, "23514", `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'mentions', 'brand', $2::uuid, NULL,
        $3::uuid, 'promote', $4
      )
    `, [workspaceA, IDS.bundleA2, IDS.userA, lateRetryKey]);
    const rollbackBinding = await promote(client, {
      workspaceId: workspaceA,
      bundleId: IDS.bundleA1,
      actorId: IDS.userA,
      action: "rollback",
      idempotencyKey: hash("3")
    });
    assert.notEqual(rollbackBinding, firstBinding);
    assert.deepEqual(await bindingState(client, workspaceA), {
      current_count: 1,
      binding_versions: [1, 2, 3],
      event_actions: ["promote", "promote", "promote", "rollback"]
    });
    assert.deepEqual(await row(client, `
      SELECT
        event.previous_binding_id IS NOT NULL AS has_previous,
        event.next_binding_id = binding.id AS targets_current,
        binding.policy_bundle_id = $2::uuid AS targets_original_policy
      FROM signal_governed_view_binding_events event
      JOIN signal_governed_view_bindings binding ON binding.id = event.next_binding_id
      WHERE event.workspace_id = $1::uuid AND event.action = 'rollback'
    `, [workspaceA, IDS.bundleA1]), {
      has_previous: true,
      targets_current: true,
      targets_original_policy: true
    });

    const semanticCandidate = await row<{
      id: string;
      version: number;
      definition_hash: string;
      membership_digest: string;
    }>(client, `
      SELECT id::text, version, definition_hash, membership_digest
      FROM signal_population_definitions
      WHERE workspace_id = $1::uuid
        AND population_key = 'primary-brand-operational'
        AND status = 'draft'
        AND definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
      LIMIT 1
    `, [workspaceA]);
    await expectSqlState(client, "23514", `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'topics-narratives', 'brand', $2::uuid, $3::uuid,
        $4::uuid, 'promote', $5
      )
    `, [workspaceA, IDS.bundleA3, semanticCandidate.id, IDS.userA, hash("6")]);
    const compiledPlanHash = hash("c");
    const compilationId = await scalar<string>(client, `
      INSERT INTO signal_population_policy_compilations (
        workspace_id, policy_bundle_id, population_id, compilation_version,
        compiled_plan_hash, policy_definition_hash, population_version,
        population_definition_hash, membership_digest, source_watermark_hash,
        compilation_status, compiled_by_user_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 1, $4, $5, $6, $7, $8, $9,
        'ready', $10::uuid
      ) RETURNING id::text
    `, [
      workspaceA, IDS.bundleA3, semanticCandidate.id, compiledPlanHash,
      brandPolicyHash(workspaceA, IDS.brandA, 3), semanticCandidate.version,
      semanticCandidate.definition_hash, semanticCandidate.membership_digest,
      hash("0"), IDS.userA
    ]);
    const populationBinding = await scalar<string>(client, `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'topics-narratives', 'brand', $2::uuid, $3::uuid,
        $4::uuid, 'promote', $5
      )::text
    `, [workspaceA, IDS.bundleA3, semanticCandidate.id, IDS.userA, hash("7")]);
    assert.deepEqual(await row(client, `
      SELECT policy_compilation_id::text AS policy_compilation_id,
        population_id::text AS population_id
      FROM signal_governed_view_bindings WHERE id = $1::uuid
    `, [populationBinding]), {
      policy_compilation_id: compilationId,
      population_id: semanticCandidate.id
    });

    await expectSqlState(client, "23514", `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'mentions', 'market-context', $2::uuid, NULL,
        $3::uuid, 'promote', $4
      )
    `, [workspaceA, IDS.bundleA1, IDS.userA, hash("4")]);
    await expectSqlState(client, "23514", `
      SELECT promote_signal_governed_view_binding(
        $1::uuid, 'mentions', 'brand', $2::uuid, NULL,
        $3::uuid, 'promote', $4
      )
    `, [workspaceA, IDS.bundleB, IDS.userA, hash("5")]);

    await client.query(`
      UPDATE signal_population_policy_bundles
      SET status = 'retired', effective_to = now(), updated_at = now()
      WHERE id = $1::uuid
    `, [IDS.bundleA2]);
    assert.equal(await scalar<string>(client, `
      SELECT status FROM signal_population_policy_bundles WHERE id = $1::uuid
    `, [IDS.bundleA2]), "retired");
    await expectSqlState(client, "55000", `
      UPDATE signal_population_policy_bundles
      SET status = 'retired', effective_to = now(), updated_at = now()
      WHERE id = $1::uuid
    `, [IDS.bundleA1]);

    assert.deepEqual(await populationState(client, workspaceA), populationBefore);
    assert.deepEqual(await allPopulationState(client), allPopulationsBefore);

    await client.query(`
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, countries, status
      ) VALUES (
        $1::uuid, $2::uuid, 'governed-after-0068',
        'Governed after 0068', 'Governed after 0068', ARRAY['MX']::char(2)[], 'active'
      )
    `, [IDS.brandAfter0068, IDS.organizationA]);
    assert.deepEqual(await row(client, `
      SELECT
        count(*) FILTER (WHERE definition.status = 'active')::int AS active_v1,
        count(*) FILTER (WHERE definition.status = 'draft'
          AND definition.definition->>'contract_version'
            = 'signal-operational-primary-brand-semantic-v2')::int AS draft_v2,
        count(DISTINCT pointer.id)::int AS current_pointers
      FROM signal_workspaces workspace
      JOIN signal_population_definitions definition
        ON definition.workspace_id = workspace.id
      LEFT JOIN signal_workspace_population_pointers pointer
        ON pointer.workspace_id = workspace.id AND pointer.purpose = 'operational'
      WHERE workspace.brand_id = $1::uuid
    `, [IDS.brandAfter0068]), {
      active_v1: 1,
      draft_v2: 1,
      current_pointers: 1
    });
  } finally {
    await client.end();
  }
});

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  await applyMigrationsRange(client, 0, maximum);
}

async function applyMigrationsRange(client: pg.Client, minimum: number, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file)
      && Number(file.slice(0, 4)) >= minimum
      && Number(file.slice(0, 4)) <= maximum)
    .sort();
  for (const file of files) await applyMigration(client, file);
}

async function applyMigration(client: pg.Client, file: string) {
  await client.query("BEGIN");
  try {
    await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedWorkspaces(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, status) VALUES
      ($1::uuid, 'governed-policy-a', 'Governed policy A', 'active'),
      ($2::uuid, 'governed-policy-b', 'Governed policy B', 'active')
  `, [IDS.organizationA, IDS.organizationB]);
  await client.query(`
    INSERT INTO users (
      id, email, full_name, user_type, primary_role, organization_id, status
    ) VALUES
      ($1::uuid, 'governed-a@example.test', 'Governed A', 'client', 'brand_manager', $2::uuid, 'active'),
      ($3::uuid, 'governed-b@example.test', 'Governed B', 'client', 'brand_manager', $4::uuid, 'active')
  `, [IDS.userA, IDS.organizationA, IDS.userB, IDS.organizationB]);
  await client.query(`
    INSERT INTO brands (id, organization_id, slug, name, status) VALUES
      ($1::uuid, $2::uuid, 'governed-brand-a', 'Governed brand A', 'active'),
      ($3::uuid, $4::uuid, 'governed-brand-b', 'Governed brand B', 'active')
  `, [IDS.brandA, IDS.organizationA, IDS.brandB, IDS.organizationB]);
  await client.query(`
    INSERT INTO signal_workspaces (
      id, organization_id, brand_id, slug, timezone, status
    ) VALUES
      ($1::uuid, $2::uuid, $3::uuid, 'governed-brand-a', 'UTC', 'active'),
      ($4::uuid, $5::uuid, $6::uuid, 'governed-brand-b', 'UTC', 'active')
  `, [
    IDS.workspaceA, IDS.organizationA, IDS.brandA,
    IDS.workspaceB, IDS.organizationB, IDS.brandB
  ]);
  return {
    workspaceA: IDS.workspaceA,
    workspaceB: IDS.workspaceB
  };
}

async function insertBrandPolicy(client: pg.Client, args: {
  id: string;
  workspaceId: string;
  actorId: string;
  version: number;
  hash: string;
}) {
  await client.query(`
    INSERT INTO signal_population_policy_bundles (
      id, workspace_id, policy_key, policy_version, status,
      authorized_modules, allowed_scopes, acceptance_status,
      quality_contract_status, quality_policy_key, quality_policy_version, min_quality_score,
      required_quality_flags, forbidden_quality_flags,
      eligibility_policy, deduplication_policy, visibility_class,
      denominator_key, retention_policy_ref, licensing_policy_ref,
      definition_hash, created_by_user_id
    ) VALUES (
      $1::uuid, $2::uuid, 'operational-brand-governed', $3, 'draft',
      ARRAY['brand-monitoring','mentions','topics-narratives']::text[],
      ARRAY['primary_brand']::text[], 'included',
      'resolved', 'signal-default-quality', 1, NULL,
      ARRAY[]::text[], ARRAY[]::text[],
      'semantic-approved-eligible', 'canonical-root', 'client-safe',
      'eligible-canonical-roots', 'workspace-default-retention',
      'listening-default-license', $4, $5::uuid
    )
  `, [args.id, args.workspaceId, args.version, args.hash, args.actorId]);
}

async function insertPolicyEntity(
  client: pg.Client,
  workspaceId: string,
  bundleId: string,
  brandId: string
) {
  await client.query(`
    INSERT INTO signal_population_policy_entities (
      workspace_id, policy_bundle_id, scope, entity_type, entity_id
    ) VALUES ($1::uuid, $2::uuid, 'primary_brand', 'brand', $3::uuid)
  `, [workspaceId, bundleId, brandId]);
}

async function promote(client: pg.Client, args: {
  workspaceId: string;
  bundleId: string;
  actorId: string;
  action: "promote" | "rollback";
  idempotencyKey: string;
}) {
  return scalar<string>(client, `
    SELECT promote_signal_governed_view_binding(
      $1::uuid, 'mentions', 'brand', $2::uuid, NULL,
      $3::uuid, $4, $5
    )::text
  `, [args.workspaceId, args.bundleId, args.actorId, args.action, args.idempotencyKey]);
}

async function populationState(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT
      to_jsonb(pointer.*) AS pointer,
      to_jsonb(definition.*) AS definition,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(membership.*) ORDER BY membership.mention_id)
        FROM signal_population_memberships membership
        WHERE membership.population_id = pointer.population_id
      ), '[]'::jsonb) AS memberships
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id = pointer.population_id
    WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
  `, [workspaceId]);
}

async function allPopulationState(client: pg.Client) {
  return row(client, `
    SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(definition.*) ORDER BY definition.id)
        FROM signal_population_definitions definition), '[]'::jsonb) AS definitions,
      COALESCE((SELECT jsonb_agg(to_jsonb(pointer.*) ORDER BY pointer.id)
        FROM signal_workspace_population_pointers pointer), '[]'::jsonb) AS pointers,
      COALESCE((SELECT jsonb_agg(to_jsonb(membership.*) ORDER BY membership.id)
        FROM signal_population_memberships membership), '[]'::jsonb) AS memberships
  `);
}

async function bindingState(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT
      count(*) FILTER (WHERE binding.binding_status = 'current')::int AS current_count,
      array_agg(binding.binding_version ORDER BY binding.binding_version) AS binding_versions,
      (SELECT array_agg(event.action ORDER BY event.created_at, event.id)
       FROM signal_governed_view_binding_events event
       WHERE event.workspace_id = $1::uuid
         AND event.module_key = 'mentions' AND event.view_key = 'brand') AS event_actions
    FROM signal_governed_view_bindings binding
    WHERE binding.workspace_id = $1::uuid
      AND binding.module_key = 'mentions' AND binding.view_key = 'brand'
  `, [workspaceId]);
}

async function expectSqlState(
  client: pg.Client,
  expected: string,
  sql: string,
  params: unknown[] = []
) {
  await assert.rejects(
    client.query(sql, params),
    (error: unknown) => (error as { code?: string }).code === expected
  );
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  const value = Object.values(result.rows[0] ?? {})[0];
  assert.notEqual(value, undefined);
  return value as T;
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
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function brandPolicyHash(workspaceId: string, brandId: string, version: number) {
  const definition = brandPolicyDefinition(workspaceId, brandId, version);
  const canonical = [
    definition.contract_version,
    definition.workspace_id,
    definition.policy_key,
    String(definition.policy_version),
    definition.authorized_modules.join(","),
    definition.allowed_scopes.join(","),
    definition.allowed_entities.map((entity) =>
      `${entity.scope}:${entity.entity_type}:${entity.entity_id}`).join(","),
    definition.acceptance_status,
    definition.quality_contract_status,
    definition.quality_policy_key ?? "∅",
    String(definition.quality_policy_version ?? "∅"),
    String(definition.min_quality_score ?? "∅"),
    definition.required_quality_flags.join(","),
    definition.forbidden_quality_flags.join(","),
    definition.eligibility_policy,
    definition.deduplication_policy,
    definition.visibility_class,
    definition.denominator_key,
    definition.period_start ?? "∅",
    definition.period_end ?? "∅",
    definition.timezone ?? "∅",
    definition.retention_policy_ref ?? "∅",
    definition.licensing_policy_ref ?? "∅"
  ].join("\u001f");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function brandPolicyDefinition(workspaceId: string, brandId: string, version: number) {
  return validateSignalPopulationPolicyBundleDefinitionV1({
      contract_version: "signal-governed-views-v1",
      workspace_id: workspaceId,
      policy_key: "operational-brand-governed",
      policy_version: version,
      authorized_modules: ["brand-monitoring", "mentions", "topics-narratives"],
      allowed_scopes: ["primary_brand"],
      allowed_entities: [{ scope: "primary_brand", entity_type: "brand", entity_id: brandId }],
      acceptance_status: "included",
      quality_contract_status: "resolved",
      quality_policy_key: "signal-default-quality",
      quality_policy_version: 1,
      min_quality_score: null,
      required_quality_flags: [],
      forbidden_quality_flags: [],
      eligibility_policy: "semantic-approved-eligible",
      deduplication_policy: "canonical-root",
      visibility_class: "client-safe",
      denominator_key: "eligible-canonical-roots",
      period_start: null,
      period_end: null,
      timezone: null,
      retention_policy_ref: "workspace-default-retention",
      licensing_policy_ref: "listening-default-license",
      data_governance_contract_status: "not_available",
      quality_policy_id: null,
      required_usage_purposes: []
  });
}
