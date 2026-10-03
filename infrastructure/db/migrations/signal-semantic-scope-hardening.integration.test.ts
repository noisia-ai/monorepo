import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_SEMANTIC_SCOPE_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_SCOPE_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

const IDS = {
  organization: "64000000-0000-4000-8000-000000000001",
  user: "64000000-0000-4000-8000-000000000101",
  brand: "64000000-0000-4000-8000-000000000201",
  methodology: "64000000-0000-4000-8000-000000000301",
  corpus: "64000000-0000-4000-8000-000000000401",
  competitorSeed: "64000000-0000-4000-8000-000000000501",
  competitor: "64000000-0000-4000-8000-000000000502",
  category: "64000000-0000-4000-8000-000000000503",
  sourcePrimary: "64000000-0000-4000-8000-000000000601",
  sourceCompetitor: "64000000-0000-4000-8000-000000000602",
  batchPrimary: "64000000-0000-4000-8000-000000000701",
  batchCompetitor: "64000000-0000-4000-8000-000000000702",
  batchPrimaryAfter: "64000000-0000-4000-8000-000000000703",
  mentionSourceOnly: "64000000-0000-4000-8000-000000000801",
  mentionSemantic: "64000000-0000-4000-8000-000000000802",
  mentionSourceOnlyAfter: "64000000-0000-4000-8000-000000000803"
} as const;

test("0064 separates source intent from semantic eligibility without changing operational v1", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  const observed: Record<string, unknown> = {};
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await applyMigrationsThrough(client, 63);
    const workspaceId = await seedPost0063Fixture(client);

    const v1Before = await operationalV1State(client, workspaceId);
    assert.equal(v1Before.reader_count, 1);
    observed.v1_before_0064 = v1Before;

    await applyMigration(client, "0064_signal_semantic_scope_hardening.sql");

    const v1After = await operationalV1State(client, workspaceId);
    assert.deepEqual(v1After, v1Before);
    observed.v1_after_0064 = v1After;

    const transition = await row(client, `
      SELECT
        count(*) FILTER (
          WHERE definition.status = 'active' AND pointer.population_id = definition.id
        )::int AS pointed_v1,
        count(*) FILTER (
          WHERE definition.status = 'draft'
            AND definition.definition->>'contract_version'
              = 'signal-operational-primary-brand-semantic-v2'
        )::int AS draft_v2,
        count(*) FILTER (
          WHERE definition.status = 'draft' AND pointer.population_id = definition.id
        )::int AS pointed_draft,
        (SELECT count(*)::int
         FROM signal_population_memberships membership
         JOIN signal_population_definitions candidate ON candidate.id = membership.population_id
         WHERE candidate.workspace_id = $1::uuid
           AND candidate.definition->>'contract_version'
             = 'signal-operational-primary-brand-semantic-v2') AS v2_membership_rows,
        (SELECT count(*)::int FROM signal_mention_attributions attribution
         WHERE attribution.workspace_id = $1::uuid
           AND attribution.attribution_basis = 'source_intent'
           AND attribution.eligibility_status = 'not_eligible') AS source_intents,
        (SELECT count(*)::int FROM signal_mention_attributions attribution
         WHERE attribution.workspace_id = $1::uuid
           AND attribution.attribution_basis = 'mention_semantic') AS semantic_assertions
      FROM signal_population_definitions definition
      LEFT JOIN signal_workspace_population_pointers pointer
        ON pointer.workspace_id = definition.workspace_id
       AND pointer.purpose = 'operational'
      WHERE definition.workspace_id = $1::uuid
        AND definition.population_key = 'primary-brand-operational'
    `, [workspaceId]);
    assert.deepEqual(transition, {
      pointed_v1: 1,
      draft_v2: 1,
      pointed_draft: 0,
      v2_membership_rows: 0,
      source_intents: 2,
      semantic_assertions: 0
    });
    observed.transition = transition;

    await expectSqlState(client, "23514", `
      UPDATE signal_mention_attributions
      SET eligibility_status = 'eligible'
      WHERE mention_id = $1::uuid AND attribution_basis = 'source_intent'
    `, [IDS.mentionSourceOnly]);

    await expectSqlState(client, "23514", `
      SELECT create_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'competitor', 'competitor', NULL, 'Missing competitor', 0.9,
        'explicit_competitor_with_resolved_identity', $5,
        'mention-semantic-human-review', '1', NULL, $6
      )
    `, [
      workspaceId, IDS.mentionSemantic, IDS.sourceCompetitor, IDS.batchCompetitor,
      hash("a"), hash("b")
    ]);
    await expectSqlState(client, "23514", `
      SELECT create_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'category', 'category', NULL, 'Missing category', 0.9,
        'explicit_category', $5,
        'mention-semantic-human-review', '1', NULL, $6
      )
    `, [
      workspaceId, IDS.mentionSemantic, IDS.sourceCompetitor, IDS.batchCompetitor,
      hash("c"), hash("d")
    ]);

    const assertionKey = hash("e");
    const primaryAssertionId = await scalar<string>(client, `
      SELECT create_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'primary_brand', 'brand', $5::uuid, 'Fixture brand', 0.99,
        'explicit_primary_brand', $6,
        'mention-semantic-human-review', '1', NULL, $7
      )::text
    `, [
      workspaceId, IDS.mentionSemantic, IDS.sourceCompetitor, IDS.batchCompetitor,
      IDS.brand, hash("f"), assertionKey
    ]);
    const retriedAssertionId = await scalar<string>(client, `
      SELECT create_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'primary_brand', 'brand', $5::uuid, 'Fixture brand', 0.99,
        'explicit_primary_brand', $6,
        'mention-semantic-human-review', '1', NULL, $7
      )::text
    `, [
      workspaceId, IDS.mentionSemantic, IDS.sourceCompetitor, IDS.batchCompetitor,
      IDS.brand, hash("f"), assertionKey
    ]);
    assert.equal(retriedAssertionId, primaryAssertionId);
    assert.equal(await activeV2Count(client, workspaceId), 0);

    const approveKey = hash("1");
    await reviewAssertion(client, primaryAssertionId, "approve", approveKey);
    await reviewAssertion(client, primaryAssertionId, "approve", approveKey);
    assert.equal(await activeV2Count(client, workspaceId), 1);
    assert.equal(await reviewEventCount(client, workspaceId), 1);

    await reviewAssertion(client, primaryAssertionId, "reject", hash("2"));
    assert.equal(await activeV2Count(client, workspaceId), 0);
    await reviewAssertion(client, primaryAssertionId, "approve", hash("3"));
    assert.equal(await activeV2Count(client, workspaceId), 1);

    const supersedingAssertionId = await scalar<string>(client, `
      SELECT supersede_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid,
        'primary_brand', 'brand', $3::uuid, 'Fixture brand corrected', 0.995,
        'human_reviewed_context', $4, '2', NULL,
        $5, 'mention-semantic-review', '1', $6, $7
      )::text
    `, [
      primaryAssertionId, IDS.user, IDS.brand, hash("4"), hash("5"), hash("6"), hash("7")
    ]);
    assert.equal(await activeV2Count(client, workspaceId), 0);
    await reviewAssertion(client, supersedingAssertionId, "approve", hash("8"));
    assert.equal(await activeV2Count(client, workspaceId), 1);

    const competitorAssertionId = await scalar<string>(client, `
      SELECT create_signal_mention_semantic_assertion(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'competitor', 'competitor', $5::uuid, 'Fixture competitor', 0.98,
        'explicit_competitor_with_resolved_identity', $6,
        'mention-semantic-human-review', '1', NULL, $7
      )::text
    `, [
      workspaceId, IDS.mentionSemantic, IDS.sourceCompetitor, IDS.batchCompetitor,
      IDS.competitor, hash("9"), hash("0")
    ]);
    await reviewAssertion(client, competitorAssertionId, "approve", hash("a"));
    assert.equal(await activeV2Count(client, workspaceId), 1);
    const multiEntity = await row(client, `
      SELECT
        count(*) FILTER (
          WHERE attribution.attribution_basis = 'mention_semantic'
            AND attribution.is_current
            AND attribution.review_status = 'approved'
            AND attribution.eligibility_status = 'eligible'
        )::int AS eligible_assertions,
        (SELECT count(*)::int
         FROM signal_population_memberships membership
         JOIN signal_population_definitions definition ON definition.id = membership.population_id
         WHERE definition.workspace_id = $1::uuid
           AND definition.definition->>'contract_version'
             = 'signal-operational-primary-brand-semantic-v2'
           AND membership.mention_id = $2::uuid
           AND membership.membership_status = 'included'
           AND membership.removed_at IS NULL) AS primary_memberships
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id = $1::uuid
        AND attribution.mention_id = $2::uuid
    `, [workspaceId, IDS.mentionSemantic]);
    assert.deepEqual(multiEntity, { eligible_assertions: 2, primary_memberships: 1 });
    observed.multi_entity = multiEntity;

    assert.deepEqual(await operationalV1State(client, workspaceId), v1After);
    await client.query(`
      UPDATE mentions SET quality_score = 9, updated_at = now()
      WHERE id = $1::uuid
    `, [IDS.mentionSemantic]);
    const v1AfterLifecycleReconcile = await operationalV1State(client, workspaceId);
    assert.equal(v1AfterLifecycleReconcile.reader_count, v1After.reader_count);
    assert.equal(v1AfterLifecycleReconcile.reader_id_hash, v1After.reader_id_hash);
    assert.equal(await scalar<number>(client, `
      SELECT count(*)::int
      FROM signal_population_memberships membership
      JOIN signal_workspace_population_pointers pointer
        ON pointer.population_id = membership.population_id
      WHERE pointer.workspace_id = $1::uuid
        AND pointer.purpose = 'operational'
        AND membership.mention_id = $2::uuid
        AND membership.membership_status = 'included'
        AND membership.removed_at IS NULL
    `, [workspaceId, IDS.mentionSemantic]), 0);
    observed.v1_after_lifecycle_reconcile = {
      reader_count: v1AfterLifecycleReconcile.reader_count,
      reader_id_hash: v1AfterLifecycleReconcile.reader_id_hash,
      semantic_only_mention_count: 0
    };

    await client.query(`
      INSERT INTO import_batches (
        id, workspace_id, data_source_id, contributed_by_study_corpus_id,
        mention_type, entity_kind, entity_label, source_system,
        imported_by_user_id, status, source_file_name
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'brand', 'primary_brand', 'Fixture brand', 'fixture',
        $5::uuid, 'completed', 'post-0064.csv'
      )
    `, [IDS.batchPrimaryAfter, workspaceId, IDS.sourcePrimary, IDS.corpus, IDS.user]);
    await insertMention(client, {
      id: IDS.mentionSourceOnlyAfter,
      workspaceId,
      sourceId: IDS.sourcePrimary,
      batchId: IDS.batchPrimaryAfter,
      externalId: "source-only-after-0064",
      textHash: "3".repeat(64)
    });
    const newWriter = await row(client, `
      SELECT
        count(*) FILTER (
          WHERE attribution.attribution_basis = 'source_intent'
            AND attribution.eligibility_status = 'not_eligible'
        )::int AS source_intents,
        count(*) FILTER (
          WHERE attribution.attribution_basis = 'mention_semantic'
        )::int AS semantic_assertions,
        (SELECT count(*)::int
         FROM signal_population_memberships membership
         JOIN signal_population_definitions definition ON definition.id = membership.population_id
         WHERE definition.workspace_id = $1::uuid
           AND definition.definition->>'contract_version'
             = 'signal-operational-primary-brand-semantic-v2'
           AND membership.mention_id = $2::uuid
           AND membership.membership_status = 'included'
           AND membership.removed_at IS NULL) AS v2_memberships
      FROM signal_mention_attributions attribution
      WHERE attribution.mention_id = $2::uuid
    `, [workspaceId, IDS.mentionSourceOnlyAfter]);
    assert.deepEqual(newWriter, {
      source_intents: 1,
      semantic_assertions: 0,
      v2_memberships: 0
    });
    observed.new_writer = newWriter;

    const populationKey = hash("b");
    const strategicPopulation = await row(client, `
      SELECT population_id::text, population_version, definition_hash,
        membership_digest, mention_count
      FROM create_signal_tb_analysis_population(
        $1::uuid, 'triggers-barriers', '2026-01-01'::date, '2026-12-31'::date,
        'UTC', 'primary-brand-analysis', '1', $2::uuid, $3
      )
    `, [workspaceId, IDS.user, populationKey]);
    assert.equal(strategicPopulation.mention_count, 1);
    const strategicRetry = await row(client, `
      SELECT population_id::text, population_version, definition_hash,
        membership_digest, mention_count
      FROM create_signal_tb_analysis_population(
        $1::uuid, 'triggers-barriers', '2026-01-01'::date, '2026-12-31'::date,
        'UTC', 'primary-brand-analysis', '1', $2::uuid, $3
      )
    `, [workspaceId, IDS.user, populationKey]);
    assert.deepEqual(strategicRetry, strategicPopulation);

    const runKey = hash("c");
    const run = await row(client, strategicRunSql, [
      workspaceId, strategicPopulation.population_id, IDS.corpus, IDS.user, runKey
    ]);
    assert.equal(run.created, true);
    assert.equal(run.snapshot_mention_count, 1);
    const runRetry = await row(client, strategicRunSql, [
      workspaceId, strategicPopulation.population_id, IDS.corpus, IDS.user, runKey
    ]);
    assert.equal(runRetry.created, false);
    assert.equal(runRetry.tb_analysis_id, run.tb_analysis_id);
    assert.equal(runRetry.snapshot_id, run.snapshot_id);
    const snapshot = await row(client, `
      SELECT
        count(*)::int AS snapshot_mentions,
        count(*) FILTER (WHERE membership.mention_id = $2::uuid)::int AS semantic_mentions,
        count(*) FILTER (WHERE membership.mention_id IN ($3::uuid, $4::uuid))::int
          AS source_intent_only_mentions
      FROM corpus_snapshot_mentions membership
      WHERE membership.snapshot_id = $1::uuid
    `, [
      run.snapshot_id, IDS.mentionSemantic, IDS.mentionSourceOnly, IDS.mentionSourceOnlyAfter
    ]);
    assert.deepEqual(snapshot, {
      snapshot_mentions: 1,
      semantic_mentions: 1,
      source_intent_only_mentions: 0
    });
    observed.strategic = {
      population: strategicPopulation,
      run: {
        created_first: run.created,
        created_retry: runRetry.created,
        snapshot_mention_count: run.snapshot_mention_count
      },
      snapshot
    };

    await expectSqlState(client, "55000", `
      UPDATE signal_mention_attribution_review_events
      SET review_policy_version = 'mutated'
      WHERE workspace_id = $1::uuid
    `, [workspaceId]);

    const idempotencyBefore = await semanticState(client, workspaceId);
    await applyMigration(client, "0064_signal_semantic_scope_hardening.sql");
    const idempotencyAfter = await semanticState(client, workspaceId);
    assert.deepEqual(idempotencyAfter, idempotencyBefore);
    observed.second_0064_execution = idempotencyAfter;

    process.stdout.write(`${JSON.stringify({ ok: true, observed }, null, 2)}\n`);
  } finally {
    await client.end();
  }
});

const strategicRunSql = `
  SELECT tb_analysis_id::text, snapshot_id::text, population_id::text,
    snapshot_mention_count, created
  FROM create_signal_tb_strategic_run(
    $1::uuid, 'triggers-barriers', $2::uuid, $3::uuid, $4::uuid, $5,
    'Semantic fixture run', 'fixture-pipeline', '1.0.0', 'fixture-prompt',
    'fixture-model', 'Deterministic question', 'Deterministic decision',
    1, '{"fixture":true,"paid_execution":false}'::jsonb
  )
`;

function hash(character: string) {
  return `sha256:${character.repeat(64)}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

async function applyMigrationsThrough(client: pg.Client, maximum: number) {
  const files = (await readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= maximum)
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

async function seedPost0063Fixture(client: pg.Client) {
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status)
    VALUES ($1::uuid, 'semantic-fixture-org', 'Semantic fixture org', 'Semantic fixture org', 'active')
  `, [IDS.organization]);
  await client.query(`
    INSERT INTO users (
      id, email, full_name, user_type, primary_role, organization_id, status
    ) VALUES (
      $1::uuid, 'semantic-reviewer@example.test', 'Semantic reviewer',
      'client', 'brand_manager', $2::uuid, 'active'
    )
  `, [IDS.user, IDS.organization]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, countries, status
    ) VALUES (
      $1::uuid, $2::uuid, 'semantic-fixture-brand', 'Semantic fixture brand',
      'Semantic fixture brand', ARRAY['MX']::char(2)[], 'active'
    )
  `, [IDS.brand, IDS.organization]);
  await client.query(`
    INSERT INTO user_brand_access (user_id, brand_id, access_level)
    VALUES ($1::uuid, $2::uuid, 'manage')
  `, [IDS.user, IDS.brand]);
  await client.query(`
    INSERT INTO methodologies (id, slug, name, version, status, manifest_yaml)
    VALUES ($1::uuid, 'triggers-barriers', 'Triggers & Barriers', '1.0.0', 'active', '{}'::jsonb)
  `, [IDS.methodology]);
  await client.query(`
    INSERT INTO study_corpora (
      id, name, brand_id, methodology_id, methodology_version_at_creation,
      business_question, decision_to_inform, status, corpus_revision
    ) VALUES (
      $1::uuid, 'Semantic compatibility corpus', $2::uuid, $3::uuid, '1.0.0',
      'Deterministic question', 'Deterministic decision', 'corpus_approved', 1
    )
  `, [IDS.corpus, IDS.brand, IDS.methodology]);
  await client.query(`
    INSERT INTO brand_seeds (
      id, canonical_name, aliases, detection_patterns, country, active
    ) VALUES (
      $1::uuid, 'Semantic fixture competitor', ARRAY[]::text[],
      ARRAY['Semantic fixture competitor']::text[], 'MX', true
    )
  `, [IDS.competitorSeed]);
  await client.query(`
    INSERT INTO competitors (id, brand_id, competitor_brand_seed_id, priority)
    VALUES ($1::uuid, $2::uuid, $3::uuid, 1)
  `, [IDS.competitor, IDS.brand, IDS.competitorSeed]);
  await client.query(`
    INSERT INTO intelligence_entities (
      id, organization_id, brand_id, entity_type, canonical_name, status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'category', 'Semantic fixture category', 'active'
    )
  `, [IDS.category, IDS.organization, IDS.brand]);
  const workspaceId = await scalar<string>(client, `
    SELECT id::text FROM signal_workspaces WHERE brand_id = $1::uuid
  `, [IDS.brand]);
  await client.query(`
    UPDATE signal_workspaces SET timezone = 'UTC' WHERE id = $1::uuid
  `, [workspaceId]);
  await client.query(`
    UPDATE signal_workspace_corpora
    SET role = 'strategic'
    WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
  `, [workspaceId, IDS.corpus]);
  await client.query(`
    INSERT INTO data_sources (
      id, workspace_id, organization_id, brand_id, source_type, provider,
      connection_method, name, governed_scope, governed_entity_type,
      governed_entity_id, scope_policy_version, scope_review_status,
      scope_approved_by_user_id, scope_approval_source, scope_approved_at,
      role, status
    ) VALUES
      ($2::uuid, $1::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture',
       'csv', 'Primary source intent', 'primary_brand', 'brand', $4::uuid,
       'workspace-source-scope-v1', 'approved', $5::uuid, 'fixture', now(),
       jsonb_build_object('ownership', 'workspace'), 'active'),
      ($6::uuid, $1::uuid, $3::uuid, $4::uuid, 'social-listening', 'fixture',
       'csv', 'Competitor source intent', 'competitor', 'competitor', $7::uuid,
       'workspace-source-scope-v1', 'approved', $5::uuid, 'fixture', now(),
       jsonb_build_object('ownership', 'workspace'), 'active')
  `, [
    workspaceId, IDS.sourcePrimary, IDS.organization, IDS.brand,
    IDS.user, IDS.sourceCompetitor, IDS.competitor
  ]);
  await client.query(`
    INSERT INTO import_batches (
      id, workspace_id, data_source_id, contributed_by_study_corpus_id,
      mention_type, entity_kind, competitor_id, entity_label, source_system,
      imported_by_user_id, status, source_file_name
    ) VALUES
      ($7::uuid, $1::uuid, $3::uuid, $2::uuid,
       'brand', 'primary_brand', NULL, 'Semantic fixture brand', 'fixture',
       $4::uuid, 'completed', 'primary.csv'),
      ($8::uuid, $1::uuid, $5::uuid, $2::uuid,
       'competitor', 'competitor', $6::uuid, 'Semantic fixture competitor', 'fixture',
       $4::uuid, 'completed', 'competitor.csv')
  `, [
    workspaceId, IDS.corpus, IDS.sourcePrimary, IDS.user,
    IDS.sourceCompetitor, IDS.competitor, IDS.batchPrimary, IDS.batchCompetitor
  ]);
  await insertMention(client, {
    id: IDS.mentionSourceOnly,
    workspaceId,
    sourceId: IDS.sourcePrimary,
    batchId: IDS.batchPrimary,
    externalId: "source-only-primary",
    textHash: "1".repeat(64)
  });
  await insertMention(client, {
    id: IDS.mentionSemantic,
    workspaceId,
    sourceId: IDS.sourceCompetitor,
    batchId: IDS.batchCompetitor,
    externalId: "competitor-intent-primary-semantics",
    textHash: "2".repeat(64)
  });
  return workspaceId;
}

async function insertMention(client: pg.Client, args: {
  id: string;
  workspaceId: string;
  sourceId: string;
  batchId: string;
  externalId: string;
  textHash: string;
}) {
  await client.query(`
    INSERT INTO mentions (
      id, workspace_id, data_source_id, canonical_mention_id, provider_record_id,
      external_id, source_system, source_file_id, text_hash, text_clean,
      text_snippet, text_length, language, published_at, platform,
      resolved_platform, quality_score, inclusion_status
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $1::uuid, $4,
      $2::text || ':' || $4, 'fixture', $5::uuid, $6,
      'Deterministic semantic fixture mention', 'Semantic fixture', 38,
      'es', '2026-06-15T12:00:00Z', 'x', 'x', 8, 'included'
    )
  `, [args.id, args.workspaceId, args.sourceId, args.externalId, args.batchId, args.textHash]);
}

async function operationalV1State(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT
      jsonb_build_object(
        'pointer_id', pointer.id,
        'population_id', pointer.population_id,
        'promoted_by_user_id', pointer.promoted_by_user_id,
        'promoted_at', pointer.promoted_at
      ) AS pointer,
      to_jsonb(definition.*) AS definition,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(membership.*) ORDER BY membership.mention_id)
        FROM signal_population_memberships membership
        WHERE membership.population_id = pointer.population_id
      ), '[]'::jsonb) AS memberships,
      (SELECT count(*)::int
       FROM signal_population_memberships membership
       JOIN mentions mention ON mention.id = membership.mention_id
       WHERE membership.population_id = pointer.population_id
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND mention.canonical_mention_id = mention.id) AS reader_count,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(membership.mention_id::text, ',' ORDER BY membership.mention_id), ''),
         'UTF8')), 'hex')
       FROM signal_population_memberships membership
       WHERE membership.population_id = pointer.population_id
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL) AS reader_id_hash
    FROM signal_workspace_population_pointers pointer
    JOIN signal_population_definitions definition ON definition.id = pointer.population_id
    WHERE pointer.workspace_id = $1::uuid AND pointer.purpose = 'operational'
  `, [workspaceId]);
}

async function activeV2Count(client: pg.Client, workspaceId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int
    FROM signal_population_memberships membership
    JOIN signal_population_definitions definition ON definition.id = membership.population_id
    WHERE definition.workspace_id = $1::uuid
      AND definition.status = 'draft'
      AND definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
      AND membership.membership_status = 'included'
      AND membership.removed_at IS NULL
  `, [workspaceId]);
}

async function reviewAssertion(
  client: pg.Client,
  attributionId: string,
  decision: "approve" | "reject",
  idempotencyKey: string
) {
  return scalar<string>(client, `
    SELECT review_signal_mention_semantic_assertion(
      $1::uuid, $2::uuid, $3, 'deterministic_fixture_review',
      'mention-semantic-review', '1', $4, $5
    )::text
  `, [attributionId, IDS.user, decision, hash(decision === "approve" ? "d" : "e"), idempotencyKey]);
}

async function reviewEventCount(client: pg.Client, workspaceId: string) {
  return scalar<number>(client, `
    SELECT count(*)::int FROM signal_mention_attribution_review_events
    WHERE workspace_id = $1::uuid
  `, [workspaceId]);
}

async function semanticState(client: pg.Client, workspaceId: string) {
  return row(client, `
    SELECT
      count(*) FILTER (WHERE attribution_basis = 'source_intent')::int AS source_intents,
      count(*) FILTER (WHERE attribution_basis = 'mention_semantic')::int AS semantic_assertions,
      count(*) FILTER (
        WHERE attribution_basis = 'mention_semantic' AND is_current
          AND review_status = 'approved' AND eligibility_status = 'eligible'
      )::int AS current_eligible_assertions,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events event
       WHERE event.workspace_id = $1::uuid) AS review_events,
      (SELECT count(*)::int FROM signal_population_definitions definition
       WHERE definition.workspace_id = $1::uuid
         AND definition.definition->>'contract_version'
           = 'signal-operational-primary-brand-semantic-v2') AS v2_definitions,
      (SELECT count(*)::int
       FROM signal_population_memberships membership
       JOIN signal_population_definitions definition ON definition.id = membership.population_id
       WHERE definition.workspace_id = $1::uuid
         AND definition.definition->>'contract_version'
           = 'signal-operational-primary-brand-semantic-v2'
         AND membership.membership_status = 'included'
         AND membership.removed_at IS NULL) AS active_v2_memberships,
      (SELECT count(*)::int FROM signal_population_definitions definition
       WHERE definition.workspace_id = $1::uuid
         AND definition.purpose = 'analysis'
         AND definition.definition->>'contract_version'
           = 'signal-tb-analysis-population-semantic-v2') AS strategic_populations,
      (SELECT count(*)::int FROM tb_analyses analysis
       WHERE analysis.workspace_id = $1::uuid
         AND analysis.strategic_contract_version = 'signal-tb-strategic-v1') AS strategic_runs,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(content.row_value, E'\n' ORDER BY content.row_value), ''),
         'UTF8')), 'hex')
       FROM (
         SELECT concat_ws('|',
           'attribution', attribution.id::text, attribution.mention_id::text,
           attribution.attribution_basis, attribution.scope, attribution.entity_type,
           attribution.entity_id::text, attribution.review_status,
           attribution.eligibility_status, attribution.semantic_policy_key,
           attribution.policy_version, attribution.assertion_version::text,
           attribution.supersedes_attribution_id::text,
           attribution.is_current::text, attribution.idempotency_key
         ) AS row_value
         FROM signal_mention_attributions attribution
         WHERE attribution.workspace_id = $1::uuid
         UNION ALL
         SELECT concat_ws('|',
           'review', event.id::text, event.attribution_id::text, event.action,
           event.previous_review_status, event.next_review_status,
           event.previous_eligibility_status, event.next_eligibility_status,
           event.reviewer_user_id::text, event.review_policy_key,
           event.review_policy_version, event.rationale_hash, event.idempotency_key
         )
         FROM signal_mention_attribution_review_events event
         WHERE event.workspace_id = $1::uuid
         UNION ALL
         SELECT concat_ws('|',
           'population', definition.id::text, definition.population_key,
           definition.version::text, definition.purpose, definition.status,
           definition.definition_hash, definition.membership_digest,
           definition.idempotency_key, definition.definition::text
         )
         FROM signal_population_definitions definition
         WHERE definition.workspace_id = $1::uuid
           AND (
             definition.definition->>'contract_version'
               = 'signal-operational-primary-brand-semantic-v2'
             OR definition.definition->>'contract_version'
               = 'signal-tb-analysis-population-semantic-v2'
           )
         UNION ALL
         SELECT concat_ws('|',
           'membership', membership.id::text, membership.population_id::text,
           membership.mention_id::text, membership.membership_status,
           membership.membership_reason, membership.removed_at::text
         )
         FROM signal_population_memberships membership
         JOIN signal_population_definitions definition
           ON definition.id = membership.population_id
         WHERE definition.workspace_id = $1::uuid
           AND (
             definition.definition->>'contract_version'
               = 'signal-operational-primary-brand-semantic-v2'
             OR definition.definition->>'contract_version'
               = 'signal-tb-analysis-population-semantic-v2'
           )
         UNION ALL
         SELECT concat_ws('|',
           'run', analysis.id::text, analysis.snapshot_id::text,
           analysis.population_id::text, analysis.run_idempotency_key,
           analysis.snapshot_digest, analysis.snapshot_mention_count::text
         )
         FROM tb_analyses analysis
         WHERE analysis.workspace_id = $1::uuid
           AND analysis.strategic_contract_version = 'signal-tb-strategic-v1'
       ) content) AS content_digest
    FROM signal_mention_attributions
    WHERE workspace_id = $1::uuid
  `, [workspaceId]);
}

async function expectSqlState(
  client: pg.Client,
  expected: string,
  query: string,
  params: unknown[] = []
) {
  await assert.rejects(
    client.query(query, params),
    (error: unknown) => error instanceof Error && "code" in error
      && String((error as Error & { code: string }).code) === expected
  );
}

async function row(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, any>>(query, params);
  assert.equal(result.rowCount, 1);
  return result.rows[0]!;
}

async function scalar<T>(client: pg.Client, query: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(query, params);
  assert.equal(result.rowCount, 1);
  const values = Object.values(result.rows[0] ?? {});
  assert.equal(values.length, 1);
  return values[0] as T;
}
