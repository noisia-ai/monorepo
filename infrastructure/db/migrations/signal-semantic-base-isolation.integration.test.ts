import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organization: "70000000-0000-4000-8000-000000007001",
  actor: "70000000-0000-4000-8000-000000007002",
  brand: "70000000-0000-4000-8000-000000007003",
  workspace: "70000000-0000-4000-8000-000000007004",
  source: "70000000-0000-4000-8000-000000007005",
  mention: "70000000-0000-4000-8000-000000007006",
  bundleA: "70000000-0000-4000-8000-000000007011",
  bundleB: "70000000-0000-4000-8000-000000007012"
} as const;

test("0070 keeps the semantic base neutral across independent policy compilations", {
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
    await applyMigrationsRange(client, 59, 69);

    const base = await row<{ id: string; version: number }>(client, `
      SELECT id::text,version FROM signal_population_definitions
      WHERE workspace_id=$1::uuid AND status='draft'
        AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
    `, [IDS.workspace]);
    await seedSemanticMembership(client, base.id);
    const v1Before = await operationalV1State(client);
    const membershipBefore = await membershipState(client, base.id);

    // Reproduce the Backend 04B contamination which 0070 must repair without
    // changing the shared membership or its digest.
    await client.query(`
      UPDATE signal_population_definitions SET
        policy_key='operational-brand-governed', policy_version='1',
        definition_hash=$2,
        definition=jsonb_build_object(
          'contract_version','signal-operational-primary-brand-semantic-v2',
          'policy_bundle_id',$3::text,
          'policy_definition_hash',$4::text,
          'compiled_plan_hash',$5::text,
          'quality_policy_id',$6::text,
          'retention_policy_ref','fixture-retention',
          'licensing_policy_ref','fixture-license',
          'required_usage_purposes',jsonb_build_array('client-derived-metrics')
        )
      WHERE id=$1::uuid
    `, [base.id, hash("contaminated-definition"), IDS.bundleA,
      hash("policy"), hash("plan"), IDS.bundleA]);

    await applyMigration(client, "0070_signal_semantic_base_isolation.sql");
    const normalized = await semanticBaseState(client, base.id);
    assert.equal(normalized.policy_key, "primary-brand-semantic");
    assert.equal(normalized.policy_version, "1");
    assert.deepEqual(normalized.definition, {
      contract_version: "signal-operational-primary-brand-semantic-v2",
      canonical_only: true,
      attribution_basis: "mention_semantic",
      attribution_review_status: "approved",
      eligibility_status: "eligible",
      allowed_scopes: ["primary_brand"],
      promotion_state: "candidate_not_promoted"
    });
    assert.equal(normalized.definition_hash, await scalar<string>(client, `
      SELECT signal_operational_semantic_base_definition_hash_v2($1::uuid,$2)
    `, [IDS.workspace, base.version]));
    assert.deepEqual(await membershipState(client, base.id), membershipBefore);
    assert.deepEqual(await operationalV1State(client), v1Before);

    await applyMigration(client, "0070_signal_semantic_base_isolation.sql");
    assert.deepEqual(await semanticBaseState(client, base.id), normalized);
    assert.deepEqual(await membershipState(client, base.id), membershipBefore);

    await insertBundle(client, IDS.bundleA, "semantic-brand-a", 1);
    await insertBundle(client, IDS.bundleB, "semantic-brand-b", 1);
    const derivedA = await ensureDerivation(client, IDS.bundleA, base.id, hash("plan-a"));
    await insertBlockedCompilation(client, IDS.bundleA, derivedA, hash("plan-a"));
    const aBeforeB = await derivedState(client, IDS.bundleA);
    const baseBeforeB = await semanticBaseState(client, base.id);

    const derivedB = await ensureDerivation(client, IDS.bundleB, base.id, hash("plan-b"));
    await insertBlockedCompilation(client, IDS.bundleB, derivedB, hash("plan-b"));
    assert.notEqual(derivedA.population_id, derivedB.population_id);
    assert.deepEqual(await derivedState(client, IDS.bundleA), aBeforeB);
    assert.deepEqual(await semanticBaseState(client, base.id), baseBeforeB);
    assert.deepEqual(await membershipState(client, base.id), membershipBefore);

    const retryA = await ensureDerivation(client, IDS.bundleA, base.id, hash("plan-a"));
    const retryB = await ensureDerivation(client, IDS.bundleB, base.id, hash("plan-b"));
    assert.deepEqual(retryA, derivedA);
    assert.deepEqual(retryB, derivedB);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_population_derivations
      WHERE workspace_id=$1::uuid
    `, [IDS.workspace]), 2);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_policy_compilations
      WHERE workspace_id=$1::uuid AND is_current
    `, [IDS.workspace]), 2);

    await expectSqlState(client, "23514", `
      UPDATE signal_population_definitions
      SET definition=definition || jsonb_build_object('policy_bundle_id',$2::text)
      WHERE id=$1::uuid
    `, [base.id, IDS.bundleA]);
    await expectSqlState(client, "23514", `
      UPDATE signal_population_definitions SET policy_key='fixture-policy'
      WHERE id=$1::uuid
    `, [base.id]);
    assert.deepEqual(await semanticBaseState(client, base.id), baseBeforeB);
    assert.deepEqual(await operationalV1State(client), v1Before);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_governed_view_bindings
    `), 0);
  } finally {
    await client.end();
  }
});

async function seedWorkspace(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id,slug,legal_name,status)
    VALUES ($1::uuid,'semantic-base-isolation','Semantic Base Isolation','active')
  `, [IDS.organization]);
  await client.query(`
    INSERT INTO users (id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES ($1::uuid,'semantic-base@example.test','Semantic Base','noisia_internal','admin',$2::uuid,'active')
  `, [IDS.actor, IDS.organization]);
  await client.query(`
    INSERT INTO brands (id,organization_id,slug,name,status)
    VALUES ($1::uuid,$2::uuid,'semantic-base-brand','Semantic Base Brand','active')
  `, [IDS.brand, IDS.organization]);
  await client.query(`
    INSERT INTO signal_workspaces (id,organization_id,brand_id,slug,timezone,status)
    VALUES ($1::uuid,$2::uuid,$3::uuid,'semantic-base-brand','UTC','active')
  `, [IDS.workspace, IDS.organization, IDS.brand]);
}

async function seedSemanticMembership(client: pg.Client, populationId: string) {
  await client.query(`
    INSERT INTO data_sources (
      id,workspace_id,organization_id,brand_id,source_type,provider,
      connection_method,name,status,visibility
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'social_listening','fixture',
      'fixture','Semantic base fixture','active','internal'
    )
  `, [IDS.source, IDS.workspace, IDS.organization, IDS.brand]);
  await client.query(`
    INSERT INTO mentions (
      id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,
      external_id,source_system,text_hash,text_clean,text_length,published_at,
      platform,inclusion_status
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,$1::uuid,'semantic-base-record',
      'semantic-base-record','fixture',$4,'Semantic base fixture',21,
      '2026-07-01T00:00:00Z','fixture','included'
    )
  `, [IDS.mention, IDS.workspace, IDS.source, "7".repeat(64)]);
  await client.query(`
    INSERT INTO signal_population_memberships (
      population_id,workspace_id,mention_id,membership_status,membership_reason
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,'included','semantic_primary_brand_approved_eligible_v2'
    ) ON CONFLICT (population_id,mention_id) DO UPDATE SET
      membership_status='included',removed_at=NULL
  `, [populationId, IDS.workspace, IDS.mention]);
  await client.query("SELECT refresh_signal_semantic_candidate_membership_digest($1::uuid)", [populationId]);
}

async function insertBundle(
  client: pg.Client,
  id: string,
  policyKey: string,
  version: number
) {
  await client.query(`
    INSERT INTO signal_population_policy_bundles (
      id,workspace_id,policy_key,policy_version,status,authorized_modules,
      allowed_scopes,acceptance_status,quality_contract_status,
      eligibility_policy,deduplication_policy,visibility_class,denominator_key,
      definition_hash,created_by_user_id
    ) VALUES (
      $1::uuid,$2::uuid,$3,$4,'draft',ARRAY['brand-monitoring']::text[],
      ARRAY['primary_brand']::text[],'included','not_available',
      'semantic-approved-eligible','canonical-root','client-safe',
      'eligible-canonical-roots',$5,$6::uuid
    )
  `, [id, IDS.workspace, policyKey, version, hash(`placeholder-${id}`), IDS.actor]);
  await client.query(`
    INSERT INTO signal_population_policy_entities (
      workspace_id,policy_bundle_id,scope,entity_type,entity_id
    ) VALUES ($1::uuid,$2::uuid,'primary_brand','brand',$3::uuid)
  `, [IDS.workspace, id, IDS.brand]);
  await client.query(`
    UPDATE signal_population_policy_bundles
    SET definition_hash=signal_population_policy_bundle_definition_hash(id)
    WHERE id=$1::uuid
  `, [id]);
}

async function ensureDerivation(
  client: pg.Client,
  bundleId: string,
  basePopulationId: string,
  planHash: string
) {
  return row<{
    population_id: string;
    population_definition_hash: string;
    population_version: number;
  }>(client, `
    SELECT resolved_population_id::text AS population_id,
      population_definition_hash,population_version
    FROM ensure_signal_governed_view_population_derivation(
      $1::uuid,$2::uuid,$3::uuid,'brand-monitoring','brand',
      (SELECT definition_hash FROM signal_population_policy_bundles WHERE id=$2::uuid),
      $4,$5::uuid
    )
  `, [IDS.workspace, bundleId, basePopulationId, planHash, IDS.actor]);
}

async function insertBlockedCompilation(
  client: pg.Client,
  bundleId: string,
  derived: { population_id: string; population_definition_hash: string; population_version: number },
  planHash: string
) {
  await client.query(`
    INSERT INTO signal_population_policy_compilations (
      workspace_id,policy_bundle_id,population_id,compilation_version,
      compiled_plan_hash,policy_definition_hash,population_version,
      population_definition_hash,membership_digest,source_watermark_hash,
      compilation_status,blocking_reasons,compiled_by_user_id,module_key,view_key
    ) VALUES (
      $1::uuid,$2::uuid,$3::uuid,1,$4,
      (SELECT definition_hash FROM signal_population_policy_bundles WHERE id=$2::uuid),
      $5,$6,(SELECT membership_digest FROM signal_population_definitions WHERE id=$3::uuid),
      $7,'blocked',ARRAY['governance-not-available']::text[],$8::uuid,
      'brand-monitoring','brand'
    )
  `, [IDS.workspace, bundleId, derived.population_id, planHash,
    derived.population_version, derived.population_definition_hash,
    hash(`watermark-${bundleId}`), IDS.actor]);
}

async function semanticBaseState(client: pg.Client, populationId: string) {
  return row<{
    population_key: string;
    purpose: string;
    status: string;
    definition_hash: string;
    policy_key: string;
    policy_version: string;
    membership_digest: string;
    definition: Record<string, unknown>;
  }>(client, `
    SELECT population_key,purpose,status,definition_hash,policy_key,policy_version,
      membership_digest,definition
    FROM signal_population_definitions WHERE id=$1::uuid
  `, [populationId]);
}

async function membershipState(client: pg.Client, populationId: string) {
  return row<{ count: number; digest: string; rows_digest: string }>(client, `
    SELECT count(*)::int AS count,
      (SELECT membership_digest FROM signal_population_definitions WHERE id=$1::uuid) AS digest,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        mention_id::text,membership_status,membership_reason,COALESCE(removed_at::text,'∅')
      ),E'\\n' ORDER BY mention_id),''),'UTF8')),'hex') AS rows_digest
    FROM signal_population_memberships WHERE population_id=$1::uuid
  `, [populationId]);
}

async function operationalV1State(client: pg.Client) {
  return row<{ pointer_count: number; membership_count: number; digest: string }>(client, `
    WITH v1 AS (
      SELECT definition.id,pointer.id AS pointer_id
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition ON definition.id=pointer.population_id
      WHERE pointer.workspace_id=$1::uuid AND pointer.purpose='operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), rows AS (
      SELECT concat_ws('|',v1.pointer_id::text,v1.id::text,membership.mention_id::text,
        membership.membership_status,COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    )
    SELECT (SELECT count(*)::int FROM v1) AS pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership JOIN v1 ON v1.id=membership.population_id) AS membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value) FROM rows),''),'UTF8')),'hex') AS digest
  `, [IDS.workspace]);
}

async function derivedState(client: pg.Client, bundleId: string) {
  return row(client, `
    SELECT to_jsonb(derivation.*) AS derivation,to_jsonb(population.*) AS population,
      COALESCE(jsonb_agg(to_jsonb(compilation.*) ORDER BY compilation.compilation_version)
        FILTER (WHERE compilation.id IS NOT NULL),'[]'::jsonb) AS compilations
    FROM signal_governed_view_population_derivations derivation
    JOIN signal_population_definitions population ON population.id=derivation.resolved_population_id
    LEFT JOIN signal_population_policy_compilations compilation
      ON compilation.population_id=population.id AND compilation.policy_bundle_id=derivation.policy_bundle_id
    WHERE derivation.policy_bundle_id=$1::uuid
    GROUP BY derivation.id,population.id
  `, [bundleId]);
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

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function expectSqlState(client: pg.Client, expected: string, sql: string, params: unknown[] = []) {
  await assert.rejects(client.query(sql, params), (error: unknown) =>
    (error as { code?: string }).code === expected);
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
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}
