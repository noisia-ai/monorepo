import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));
const MODULES = ["brand-monitoring", "mentions", "topics-narratives"] as const;
const VIEWS = ["brand", "competition", "category", "all-governed"] as const;

const IDS = {
  organizationA: "73000000-0000-4000-8000-000000000001",
  organizationB: "73000000-0000-4000-8000-000000000002",
  actorA: "73000000-0000-4000-8000-000000000101",
  actorB: "73000000-0000-4000-8000-000000000102",
  brandA: "73000000-0000-4000-8000-000000000201",
  brandB: "73000000-0000-4000-8000-000000000202",
  workspaceA: "73000000-0000-4000-8000-000000000301",
  workspaceB: "73000000-0000-4000-8000-000000000302",
  sourceA: "73000000-0000-4000-8000-000000000401",
  batchA: "73000000-0000-4000-8000-000000000402",
  mentionRoot: "73000000-0000-4000-8000-000000000501",
  mentionAlias: "73000000-0000-4000-8000-000000000502",
  mentionUnattributed: "73000000-0000-4000-8000-000000000503",
  mentionCompetitorOnly: "73000000-0000-4000-8000-000000000504",
  competitorSeed: "73000000-0000-4000-8000-000000000601",
  competitor: "73000000-0000-4000-8000-000000000602",
  category: "73000000-0000-4000-8000-000000000603",
  reference: "73000000-0000-4000-8000-000000000604"
} as const;

test("0073 isolates four governed views and preserves atomic binding history", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 58);
    await seedWorkspaces(client);
    await applyMigrationsRange(client, 59, 72);
    const protectedBefore = await protectedState(client);

    await applyMigration(client, "0073_signal_governed_multi_view_binding_sets.sql");
    await applyMigration(client, "0073_signal_governed_multi_view_binding_sets.sql");
    assert.deepEqual(await protectedState(client), protectedBefore);
    assert.deepEqual(await row(client, `
      SELECT
        (SELECT count(*)::int FROM signal_population_definitions
          WHERE definition->>'contract_version'='signal-operational-attributable-semantic-v1') AS neutral_bases,
        (SELECT count(*)::int FROM signal_governed_view_population_derivations) AS derivations,
        (SELECT count(*)::int FROM signal_data_governance_evaluations) AS evaluations,
        (SELECT count(*)::int FROM signal_population_policy_compilations) AS compilations,
        (SELECT count(*)::int FROM signal_governed_view_bindings) AS bindings,
        (SELECT count(*)::int FROM signal_governed_brand_binding_set_operations) AS operations
    `), { neutral_bases: 0, derivations: 0, evaluations: 0, compilations: 0, bindings: 0, operations: 0 });

    const firstBase = await row(client, `
      SELECT population_id::text, created
      FROM ensure_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
    `, [IDS.workspaceA, IDS.actorA]);
    const retryBase = await row(client, `
      SELECT population_id::text, created
      FROM ensure_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
    `, [IDS.workspaceA, IDS.actorA]);
    assert.equal(firstBase.population_id, retryBase.population_id);
    assert.equal(firstBase.created, true);
    assert.equal(retryBase.created, false);
    await expectSqlState(client, "42501", `
      SELECT * FROM ensure_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
    `, [IDS.workspaceB, IDS.actorA]);

    await seedSemanticFixture(client);
    const reconciledA = await row(client, `
      SELECT population_id::text,membership_count::int,membership_digest
      FROM reconcile_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
    `, [IDS.workspaceA, IDS.actorA]);
    const reconciledB = await row(client, `
      SELECT population_id::text,membership_count::int,membership_digest
      FROM reconcile_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
    `, [IDS.workspaceA, IDS.actorA]);
    assert.deepEqual(reconciledB, reconciledA);
    assert.equal(reconciledA.membership_count, 2);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_memberships
      WHERE population_id=$1::uuid AND mention_id=$2::uuid
        AND membership_status='included' AND removed_at IS NULL
    `, [firstBase.population_id, IDS.mentionAlias]), 0);
    await client.query(`UPDATE mentions SET canonical_mention_id=id
      WHERE id=$1::uuid`, [IDS.mentionAlias]);
    await createAndApproveAssertion(client, {
      mention: IDS.mentionAlias, scope: "primary_brand", type: "brand",
      entity: IDS.brandA, evidence: "explicit_primary_brand"
    });
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_population_memberships WHERE population_id=$1::uuid
        AND membership_status='included' AND removed_at IS NULL`, [firstBase.population_id]), 3);
    await client.query(`UPDATE mentions SET canonical_mention_id=$2::uuid
      WHERE id=$1::uuid`, [IDS.mentionAlias, IDS.mentionRoot]);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_population_memberships WHERE population_id=$1::uuid
        AND membership_status='included' AND removed_at IS NULL`, [firstBase.population_id]), 2);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_population_memberships WHERE population_id=$1::uuid
        AND mention_id=$2::uuid AND membership_status='excluded'
        AND removed_at IS NOT NULL`, [firstBase.population_id, IDS.mentionAlias]), 1);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int FROM signal_population_memberships
      WHERE population_id=$1::uuid AND mention_id=$2::uuid
        AND membership_status='included' AND removed_at IS NULL
    `, [firstBase.population_id, IDS.mentionUnattributed]), 0);
    await expectSqlState(client, "23514", `
      UPDATE signal_population_definitions
      SET definition=definition || '{"policy_bundle_id":"forbidden"}'::jsonb
      WHERE id=$1::uuid
    `, [firstBase.population_id]);
    const protectedStable = await protectedState(client);

    const bundleByView = new Map<string, string>();
    for (const viewKey of VIEWS) {
      const bundleId = await seedBundle(client, viewKey);
      bundleByView.set(viewKey, bundleId);
      const basePopulationId = viewKey === "brand"
        ? await scalar<string>(client, `
          SELECT id::text FROM signal_population_definitions
          WHERE workspace_id=$1::uuid
            AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
        `, [IDS.workspaceA])
        : firstBase.population_id;
      const observedPopulationIds = new Set<string>();
      for (const moduleKey of MODULES) {
        const planHash = hash(`${viewKey}:${moduleKey}:plan`);
        const created = await row(client, `
          SELECT derivation_id::text,resolved_population_id::text,created
          FROM ensure_signal_governed_view_population_derivation(
            $1::uuid,$2::uuid,$3::uuid,$4,$5,
            (SELECT definition_hash FROM signal_population_policy_bundles WHERE id=$2::uuid),
            $6,$7::uuid
          )
        `, [IDS.workspaceA, bundleId, basePopulationId, moduleKey, viewKey, planHash, IDS.actorA]);
        const retry = await row(client, `
          SELECT derivation_id::text,resolved_population_id::text,created
          FROM ensure_signal_governed_view_population_derivation(
            $1::uuid,$2::uuid,$3::uuid,$4,$5,
            (SELECT definition_hash FROM signal_population_policy_bundles WHERE id=$2::uuid),
            $6,$7::uuid
          )
        `, [IDS.workspaceA, bundleId, basePopulationId, moduleKey, viewKey, planHash, IDS.actorA]);
        assert.equal(created.created, true);
        assert.equal(retry.created, false);
        assert.equal(retry.derivation_id, created.derivation_id);
        observedPopulationIds.add(String(created.resolved_population_id));
      }
      assert.equal(observedPopulationIds.size, 3);
    }
    assert.equal(await scalar<number>(client, `
      SELECT count(DISTINCT resolved_population_id)::int
      FROM signal_governed_view_population_derivations
      WHERE workspace_id=$1::uuid
    `, [IDS.workspaceA]), 12);
    await expectSqlState(client, "23514", `INSERT INTO signal_population_policy_entities(
      workspace_id,policy_bundle_id,scope,entity_type,entity_id
    ) VALUES ($1::uuid,$2::uuid,'primary_brand','brand',$3::uuid)`,
    [IDS.workspaceB, bundleByView.get("brand"), IDS.brandB]);
    await expectSqlState(client, "23514", `
      SELECT * FROM ensure_signal_governed_view_population_derivation(
        $1::uuid,$2::uuid,$3::uuid,'mentions','competition',
        (SELECT definition_hash FROM signal_population_policy_bundles WHERE id=$2::uuid),
        $4,$5::uuid
      )
    `, [IDS.workspaceA, bundleByView.get("competition"),
      await scalar<string>(client, `SELECT id::text FROM signal_population_definitions
        WHERE workspace_id=$1::uuid AND definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'`, [IDS.workspaceA]),
      hash("cross-base"), IDS.actorA]);

    for (const bundleId of bundleByView.values()) {
      await client.query(`UPDATE signal_population_policy_bundles
        SET status='active',activated_by_user_id=$2::uuid,activated_at=now()
        WHERE id=$1::uuid`, [bundleId, IDS.actorA]);
    }
    for (const viewKey of VIEWS) {
      await seedStaleCompilation(client, viewKey, bundleByView.get(viewKey)!);
    }

    // A failed three-module set is fully rolled back by the deferred cardinality gate.
    await assertPartialSetRollback(DATABASE_URL, bundleByView.get("competition")!);
    assert.equal(await currentBindingCount(client, "competition"), 0);

    await performPromotionSet(client, "competition", bundleByView.get("competition")!);
    assert.equal(await currentBindingCount(client, "competition"), 3);
    const competitionBefore = await currentBindings(client, "competition");
    await performWithdrawalSet(client, "competition", bundleByView.get("competition")!);
    assert.equal(await currentBindingCount(client, "competition"), 0);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_governed_view_binding_events
      WHERE workspace_id=$1::uuid AND view_key='competition'
        AND action='withdraw-to-absence'`, [IDS.workspaceA]), 3);

    // Late retries return the original withdrawal and cannot retire a newer binding.
    const retried = await Promise.all(MODULES.map(async (moduleKey) => {
      const separate = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
      await separate.connect();
      try {
        const expected = competitionBefore.find((item) => item.module_key === moduleKey)!;
        return await scalar<string>(separate, `SELECT withdraw_signal_governed_view_binding(
          $1::uuid,$2,'competition',$3::uuid,$4::uuid,$5,$6)::text`,
        [IDS.workspaceA, moduleKey, IDS.actorA, expected.id, expected.digest,
          hash(`competition:withdraw:${moduleKey}`)]);
      } finally { await separate.end(); }
    }));
    assert.equal(new Set(retried).size, 3);

    await performPromotionSet(client, "brand", bundleByView.get("brand")!);
    await performWithdrawalSet(client, "brand", bundleByView.get("brand")!);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_governed_view_binding_events
      WHERE workspace_id=$1::uuid AND view_key='brand'
        AND action='withdraw-to-bridge'`, [IDS.workspaceA]), 3);
    await assert.rejects(client.query(`INSERT INTO signal_governed_brand_binding_set_operations(
      workspace_id,view_key,action,policy_bundle_id,actor_user_id,
      request_digest,result_digest,idempotency_key
    ) VALUES ($1::uuid,'category','withdraw-to-bridge',$2::uuid,$3::uuid,$4,$5,$6)`,
    [IDS.workspaceA, bundleByView.get("category"), IDS.actorA,
      hash("bad-request"), hash("bad-result"), hash("bad-key")]), hasSqlState("23514"));

    await client.query(`UPDATE brand_seeds SET active=false WHERE id=$1::uuid`, [IDS.competitorSeed]);
    assert.deepEqual(await row(client, `SELECT
      count(*) FILTER (WHERE compilation.view_key='competition')::int AS competition,
      count(*) FILTER (WHERE compilation.view_key='all-governed')::int AS all_governed,
      count(*) FILTER (WHERE compilation.view_key='category')::int AS category,
      count(*) FILTER (WHERE compilation.view_key='brand')::int AS brand
      FROM signal_data_governance_invalidations invalidation
      JOIN signal_population_policy_compilations compilation
        ON compilation.id=invalidation.policy_compilation_id
      WHERE invalidation.reason_code='governed-entity-changed'
    `), { competition: 1, all_governed: 1, category: 0, brand: 0 });
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_data_invalidations invalidation
      WHERE invalidation.reason='governed-entity-changed'`), 2);
    assert.equal(await scalar<number>(client, `SELECT count(*)::int
      FROM signal_population_memberships
      WHERE population_id=$1::uuid AND membership_status='included'
        AND removed_at IS NULL`, [firstBase.population_id]), 1);
    await expectSqlState(client, "23514", `INSERT INTO signal_governed_brand_binding_set_operations(
      workspace_id,view_key,action,policy_bundle_id,actor_user_id,
      request_digest,result_digest,idempotency_key
    ) VALUES ($1::uuid,'competition','promote',$2::uuid,$3::uuid,$4,$5,$6)`,
    [IDS.workspaceA, bundleByView.get("competition"), IDS.actorA,
      hash("inactive-request"), hash("inactive-result"), hash("inactive-key")]);

    assert.deepEqual(await protectedState(client), protectedStable);
  } finally {
    await client.end();
  }
});

async function seedWorkspaces(client: pg.Client) {
  await client.query(`INSERT INTO organizations(id,slug,legal_name,status) VALUES
    ($1::uuid,'multi-view-a','Multi View A','active'),
    ($2::uuid,'multi-view-b','Multi View B','active')`, [IDS.organizationA, IDS.organizationB]);
  await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
    ($1::uuid,'multi-a@example.test','Multi A','client','brand_manager',$3::uuid,'active'),
    ($2::uuid,'multi-b@example.test','Multi B','client','brand_manager',$4::uuid,'active')`,
  [IDS.actorA, IDS.actorB, IDS.organizationA, IDS.organizationB]);
  await client.query(`INSERT INTO brands(id,organization_id,slug,name,status) VALUES
    ($1::uuid,$3::uuid,'multi-view-a','Multi View A','active'),
    ($2::uuid,$4::uuid,'multi-view-b','Multi View B','active')`,
  [IDS.brandA, IDS.brandB, IDS.organizationA, IDS.organizationB]);
  await client.query(`INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,timezone,status) VALUES
    ($1::uuid,$3::uuid,$5::uuid,'multi-view-a','UTC','active'),
    ($2::uuid,$4::uuid,$6::uuid,'multi-view-b','UTC','active')`,
  [IDS.workspaceA, IDS.workspaceB, IDS.organizationA, IDS.organizationB, IDS.brandA, IDS.brandB]);
}

async function seedSemanticFixture(client: pg.Client) {
  await client.query(`INSERT INTO brand_seeds(id,canonical_name,aliases,detection_patterns,country,active)
    VALUES ($1::uuid,'Fixture competitor',ARRAY[]::text[],ARRAY['Fixture competitor']::text[],'MX',true)`, [IDS.competitorSeed]);
  await client.query(`INSERT INTO competitors(id,brand_id,competitor_brand_seed_id,priority)
    VALUES ($1::uuid,$2::uuid,$3::uuid,1)`, [IDS.competitor, IDS.brandA, IDS.competitorSeed]);
  await client.query(`INSERT INTO intelligence_entities(id,organization_id,brand_id,entity_type,canonical_name,status) VALUES
    ($1::uuid,$3::uuid,$4::uuid,'category','Fixture category','active'),
    ($2::uuid,$3::uuid,$4::uuid,'reference','Fixture reference','active')`,
  [IDS.category, IDS.reference, IDS.organizationA, IDS.brandA]);
  await client.query(`INSERT INTO data_sources(
    id,workspace_id,organization_id,brand_id,source_type,provider,connection_method,
    name,governed_scope,governed_entity_type,governed_entity_id,scope_policy_version,
    scope_review_status,scope_approved_by_user_id,scope_approval_source,scope_approved_at,role,status
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','fixture','csv',
    'Neutral semantic fixture','primary_brand','brand',$4::uuid,
    'workspace-source-scope-v1','approved',$5::uuid,'fixture',now(),'{}'::jsonb,'active')`,
  [IDS.sourceA, IDS.workspaceA, IDS.organizationA, IDS.brandA, IDS.actorA]);
  await client.query(`INSERT INTO import_batches(
    id,workspace_id,data_source_id,mention_type,entity_kind,entity_label,source_system,
    imported_by_user_id,status,source_file_name
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,'brand','primary_brand','Fixture','fixture',$4::uuid,'completed','fixture.csv')`,
  [IDS.batchA, IDS.workspaceA, IDS.sourceA, IDS.actorA]);
  await insertMention(client, IDS.mentionRoot, IDS.mentionRoot, "root");
  await insertMention(client, IDS.mentionAlias, IDS.mentionRoot, "alias");
  await insertMention(client, IDS.mentionUnattributed, IDS.mentionUnattributed, "unattributed");
  await insertMention(client, IDS.mentionCompetitorOnly, IDS.mentionCompetitorOnly, "competitor-only");
  for (const assertion of [
    { mention: IDS.mentionRoot, scope: "primary_brand", type: "brand", entity: IDS.brandA, evidence: "explicit_primary_brand" },
    { mention: IDS.mentionRoot, scope: "competitor", type: "competitor", entity: IDS.competitor, evidence: "explicit_competitor_with_resolved_identity" },
    { mention: IDS.mentionRoot, scope: "category", type: "category", entity: IDS.category, evidence: "explicit_category" }
  ]) await createAndApproveAssertion(client, assertion);
  await createAndApproveAssertion(client, {
    mention: IDS.mentionCompetitorOnly, scope: "competitor", type: "competitor",
    entity: IDS.competitor, evidence: "explicit_competitor_with_resolved_identity"
  });
  const unattributedId = await scalar<string>(client, `SELECT create_signal_mention_semantic_assertion(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,'unattributed','unattributed',NULL,'Unattributed',0.5,
    'human_reviewed_context',$5,'fixture-semantic','1',NULL,$6,NULL)::text`,
  [IDS.workspaceA, IDS.mentionUnattributed, IDS.sourceA, IDS.batchA,
    hash("unattributed-evidence"), hash("unattributed-create")]);
  await client.query(`SELECT review_signal_mention_semantic_assertion(
    $1::uuid,$2::uuid,'reject','fixture','fixture-review','1',$3,$4)`,
  [unattributedId, IDS.actorA, hash("unattributed-review"), hash("unattributed-review-key")]);
}

async function insertMention(client: pg.Client, id: string, canonicalId: string, externalId: string) {
  await client.query(`INSERT INTO mentions(
    id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,external_id,
    source_system,source_file_id,text_hash,text_clean,text_snippet,text_length,language,
    published_at,platform,resolved_platform,quality_score,inclusion_status
  ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$2::text||':'||$5,'fixture',$6::uuid,
    $7,'Fixture mention','Fixture',15,'es','2026-08-01T00:00:00Z','x','x',8,'included')`,
  [id, IDS.workspaceA, IDS.sourceA, canonicalId, externalId, IDS.batchA, hash(externalId).slice(7)]);
}

async function createAndApproveAssertion(client: pg.Client, assertion: {
  mention: string; scope: string; type: string; entity: string; evidence: string;
}) {
  const key = hash(`create:${assertion.mention}:${assertion.scope}`);
  const assertionId = await scalar<string>(client, `SELECT create_signal_mention_semantic_assertion(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,'Fixture',0.99,$8,$9,
    'fixture-semantic','1',NULL,$10,NULL)::text`,
  [IDS.workspaceA, assertion.mention, IDS.sourceA, IDS.batchA, assertion.scope,
    assertion.type, assertion.entity, assertion.evidence,
    hash(`evidence:${assertion.mention}:${assertion.scope}`), key]);
  await client.query(`SELECT review_signal_mention_semantic_assertion(
    $1::uuid,$2::uuid,'approve','fixture','fixture-review','1',$3,$4)`,
  [assertionId, IDS.actorA, hash(`review:${assertion.mention}:${assertion.scope}`),
    hash(`review-key:${assertion.mention}:${assertion.scope}`)]);
}

async function seedBundle(client: pg.Client, viewKey: (typeof VIEWS)[number]) {
  const bundleId = randomUUID();
  const scopes = viewKey === "brand" ? ["primary_brand"]
    : viewKey === "competition" ? ["competitor"]
    : viewKey === "category" ? ["category"]
    : ["primary_brand", "competitor", "category"];
  await client.query(`INSERT INTO signal_population_policy_bundles(
    id,workspace_id,policy_key,policy_version,status,authorized_modules,allowed_scopes,
    acceptance_status,quality_contract_status,eligibility_policy,deduplication_policy,
    visibility_class,denominator_key,definition_hash,created_by_user_id
  ) VALUES ($1::uuid,$2::uuid,$3,1,'draft',$4::text[],$5::text[],'included',
    'not_available','semantic-approved-eligible','canonical-root','operator-only',
    'eligible-canonical-roots',$6,$7::uuid)`,
  [bundleId, IDS.workspaceA, `fixture-${viewKey}`, [...MODULES], scopes, hash(`placeholder:${viewKey}`), IDS.actorA]);
  const entities = viewKey === "brand" ? [["primary_brand", "brand", IDS.brandA]]
    : viewKey === "competition" ? [["competitor", "competitor", IDS.competitor]]
    : viewKey === "category" ? [["category", "category", IDS.category]]
    : [["primary_brand", "brand", IDS.brandA], ["competitor", "competitor", IDS.competitor],
      ["category", "category", IDS.category]];
  for (const [scope, type, entity] of entities) await client.query(`
    INSERT INTO signal_population_policy_entities(workspace_id,policy_bundle_id,scope,entity_type,entity_id)
    VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)`, [IDS.workspaceA, bundleId, scope, type, entity]);
  await client.query(`UPDATE signal_population_policy_bundles
    SET definition_hash=signal_population_policy_bundle_definition_hash(id)
    WHERE id=$1::uuid`, [bundleId]);
  return bundleId;
}

async function seedStaleCompilation(client: pg.Client, viewKey: string, bundleId: string) {
  const populationId = await scalar<string>(client, `SELECT resolved_population_id::text
    FROM signal_governed_view_population_derivations
    WHERE workspace_id=$1::uuid AND policy_bundle_id=$2::uuid
      AND module_key='brand-monitoring' AND view_key=$3`, [IDS.workspaceA, bundleId, viewKey]);
  const watermarkId = await scalar<string>(client, `INSERT INTO signal_data_watermarks(
    workspace_id,study_corpus_id,population_id,data_source_id,source_key,
    corpus_revision,last_import_batch_id,accepted_at,materialized_at,
    source_freshness_state,data_freshness_state
  ) VALUES ($1::uuid,NULL,$2::uuid,$3::uuid,$4,1,$5::uuid,now(),now(),'fresh','fresh')
  RETURNING id::text`, [IDS.workspaceA, populationId, IDS.sourceA,
    `fixture-${viewKey}-brand-monitoring`, IDS.batchA]);
  await client.query(`INSERT INTO signal_population_policy_compilations(
    workspace_id,policy_bundle_id,population_id,module_key,view_key,
    compilation_version,compiled_plan_hash,policy_definition_hash,
    population_version,population_definition_hash,membership_digest,
    source_watermark_hash,compilation_status,blocking_reasons,
    governance_data_watermark_id,is_current,compiled_by_user_id
  ) SELECT derivation.workspace_id,derivation.policy_bundle_id,
    derivation.resolved_population_id,derivation.module_key,derivation.view_key,
    1,derivation.compiled_plan_hash,derivation.policy_definition_hash,
    population.version,population.definition_hash,population.membership_digest,
    $4,'stale',ARRAY['fixture-stale']::text[],$6::uuid,true,$3::uuid
  FROM signal_governed_view_population_derivations derivation
  JOIN signal_population_definitions population
    ON population.id=derivation.resolved_population_id
  WHERE derivation.workspace_id=$1::uuid AND derivation.policy_bundle_id=$2::uuid
    AND derivation.module_key='brand-monitoring' AND derivation.view_key=$5`,
  [IDS.workspaceA, bundleId, IDS.actorA, hash(`watermark:${viewKey}`), viewKey, watermarkId]);
}

async function performPromotionSet(client: pg.Client, view: string, bundleId: string) {
  await client.query("BEGIN");
  const operationId = await createSetOperation(client, view, "promote", bundleId);
  for (const moduleKey of MODULES) await attachPromotion(client, operationId, view, moduleKey, bundleId);
  await client.query("COMMIT");
}

async function assertPartialSetRollback(databaseUrl: string, bundleId: string) {
  const separate = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await separate.connect();
  try {
    await separate.query("BEGIN");
    const partial = await createSetOperation(separate, "competition", "promote", bundleId);
    await attachPromotion(separate, partial, "competition", "brand-monitoring", bundleId);
    await attachPromotion(separate, partial, "competition", "mentions", bundleId);
    await assert.rejects(separate.query("COMMIT"), hasSqlState("23514"));
  } finally {
    await separate.end().catch(() => undefined);
  }
}

async function attachPromotion(client: pg.Client, operationId: string, view: string, moduleKey: string, bundleId: string) {
  const key = hash(`${operationId}:promote:${moduleKey}:${view}`);
  const bindingId = await scalar<string>(client, `SELECT promote_signal_governed_view_binding(
    $1::uuid,$2,$3,$4::uuid,NULL,$5::uuid,'promote',$6)::text`,
  [IDS.workspaceA, moduleKey, view, bundleId, IDS.actorA, key]);
  const eventId = await scalar<string>(client, `SELECT id::text FROM signal_governed_view_binding_events
    WHERE workspace_id=$1::uuid AND idempotency_key=$2`, [IDS.workspaceA, key]);
  await client.query(`INSERT INTO signal_governed_brand_binding_set_operation_items(
    operation_id,workspace_id,module_key,view_key,previous_binding_id,next_binding_id,binding_event_id
  ) VALUES ($1::uuid,$2::uuid,$3,$4,NULL,$5::uuid,$6::uuid)`,
  [operationId, IDS.workspaceA, moduleKey, view, bindingId, eventId]);
}

async function performWithdrawalSet(client: pg.Client, view: string, bundleId: string) {
  const current = await currentBindings(client, view);
  await client.query("BEGIN");
  const operationId = await createSetOperation(client, view,
    view === "brand" ? "withdraw-to-bridge" : "withdraw-to-absence", bundleId);
  for (const binding of current) {
    const key = hash(`${view}:withdraw:${binding.module_key}`);
    await client.query(`SELECT withdraw_signal_governed_view_binding(
      $1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7)`,
    [IDS.workspaceA, binding.module_key, view, IDS.actorA, binding.id, binding.digest, key]);
    const eventId = await scalar<string>(client, `SELECT id::text FROM signal_governed_view_binding_events
      WHERE workspace_id=$1::uuid AND idempotency_key=$2`, [IDS.workspaceA, key]);
    await client.query(`INSERT INTO signal_governed_brand_binding_set_operation_items(
      operation_id,workspace_id,module_key,view_key,previous_binding_id,next_binding_id,binding_event_id
    ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,NULL,$6::uuid)`,
    [operationId, IDS.workspaceA, binding.module_key, view, binding.id, eventId]);
  }
  await client.query("COMMIT");
}

async function createSetOperation(client: pg.Client, view: string, action: string, bundleId: string) {
  const nonce = randomUUID();
  return scalar<string>(client, `INSERT INTO signal_governed_brand_binding_set_operations(
    workspace_id,view_key,action,policy_bundle_id,actor_user_id,
    request_digest,result_digest,idempotency_key
  ) VALUES ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7,$8) RETURNING id::text`,
  [IDS.workspaceA, view, action, bundleId, IDS.actorA,
    hash(`request:${nonce}`), hash(`result:${nonce}`), hash(`key:${nonce}`)]);
}

async function currentBindings(client: pg.Client, view: string) {
  const result = await client.query<{ id: string; module_key: string; digest: string }>(`
    SELECT id::text,module_key,signal_governed_view_binding_digest_v1(id) AS digest
    FROM signal_governed_view_bindings
    WHERE workspace_id=$1::uuid AND view_key=$2 AND binding_status='current'
    ORDER BY module_key`, [IDS.workspaceA, view]);
  return result.rows;
}

async function currentBindingCount(client: pg.Client, view: string) {
  return scalar<number>(client, `SELECT count(*)::int FROM signal_governed_view_bindings
    WHERE workspace_id=$1::uuid AND view_key=$2 AND binding_status='current'`, [IDS.workspaceA, view]);
}

async function protectedState(client: pg.Client) {
  return row(client, `SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(pointer) ORDER BY id)
      FROM signal_workspace_population_pointers pointer),'[]'::jsonb) AS pointers,
    COALESCE((SELECT jsonb_agg(to_jsonb(definition) ORDER BY id)
      FROM signal_population_definitions definition
      WHERE definition.definition->>'contract_version' IN (
        'signal-operational-primary-brand-v1','signal-operational-primary-brand-semantic-v2'
      )),'[]'::jsonb) AS protected_definitions,
    COALESCE((SELECT jsonb_agg(to_jsonb(membership) ORDER BY population_id,mention_id)
      FROM signal_population_memberships membership
      JOIN signal_population_definitions definition ON definition.id=membership.population_id
      WHERE definition.definition->>'contract_version' IN (
        'signal-operational-primary-brand-v1','signal-operational-primary-brand-semantic-v2'
      )),'[]'::jsonb) AS protected_memberships`);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir)).filter((file) => /^\d{4}_.+\.sql$/u.test(file)
    && Number(file.slice(0, 4)) <= maximum).sort();
  for (const file of files) await applyMigration(client, file);
}

async function applyMigrationsRange(client: pg.Client, minimum: number, maximum: number) {
  const files = (await readdir(migrationDir)).filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .filter((file) => Number(file.slice(0, 4)) >= minimum && Number(file.slice(0, 4)) <= maximum).sort();
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

async function row(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, unknown>>(sql, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  assert.equal(result.rowCount, 1);
  return Object.values(result.rows[0]!)[0]!;
}

async function expectSqlState(client: pg.Client, state: string, sql: string, params: unknown[] = []) {
  await client.query("BEGIN");
  await assert.rejects(client.query(sql, params), hasSqlState(state));
  await client.query("ROLLBACK");
}

function hasSqlState(state: string) {
  return (error: unknown) => (error as { code?: string }).code === state;
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}
