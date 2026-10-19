import { createHash } from "node:crypto";

import pg from "pg";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_ADMIN_EMAIL = "phase6-admin@noisia.local";
const FIXTURE_TIMESTAMP = "2026-08-04T15:00:00.000Z";

const IDS = {
  organization: "66000000-0000-4000-8000-000000000001",
  adminUser: "66000000-0000-4000-8000-000000000101",
  brand: "66000000-0000-4000-8000-000000000201",
  methodology: "66000000-0000-4000-8000-000000000301",
  executionCorpus: "66000000-0000-4000-8000-000000000401",
  sourceListening: "66000000-0000-4000-8000-000000000501",
  sourceReviews: "66000000-0000-4000-8000-000000000502",
  syncListening: "66000000-0000-4000-8000-000000000511",
  syncReviews: "66000000-0000-4000-8000-000000000512",
  refreshListening: "66000000-0000-4000-8000-000000000521",
  refreshReviews: "66000000-0000-4000-8000-000000000522",
  importListeningJuly: "66000000-0000-4000-8000-000000000601",
  importListeningAugust: "66000000-0000-4000-8000-000000000602",
  importReviews: "66000000-0000-4000-8000-000000000603",
  topicTaxonomy: "66000000-0000-4000-8000-000000000801",
  narrativeTaxonomy: "66000000-0000-4000-8000-000000000802",
  topicTerm: "66000000-0000-4000-8000-000000000811",
  narrativeTerm: "66000000-0000-4000-8000-000000000812",
  topicRuleSet: "66000000-0000-4000-8000-000000000821",
  narrativeRuleSet: "66000000-0000-4000-8000-000000000822",
  topicModel: "66000000-0000-4000-8000-000000000831",
  narrativeModel: "66000000-0000-4000-8000-000000000832",
  topicProfile: "66000000-0000-4000-8000-000000000841",
  narrativeProfile: "66000000-0000-4000-8000-000000000842",
  reportArtifact: "66000000-0000-4000-8000-000000000901",
  reportRelease: "66000000-0000-4000-8000-000000000902"
} as const;

const MENTIONS = [
  ["66000000-0000-4000-8000-000000000701", IDS.importListeningJuly, IDS.sourceListening, "instagram", "2026-07-01T14:00:00.000Z", "Mi perro disfruta mucho las croquetas Laika y la entrega siempre llega puntual.", 0.82, "included"],
  ["66000000-0000-4000-8000-000000000702", IDS.importListeningJuly, IDS.sourceListening, "facebook", "2026-07-05T18:30:00.000Z", "Encontré opciones de alimento y cuidado para mi gato en Laika Mascotas.", 0.55, "included"],
  ["66000000-0000-4000-8000-000000000703", IDS.importListeningJuly, IDS.sourceListening, "tiktok", "2026-07-09T20:15:00.000Z", "El pedido de arena para gato llegó completo y con buena comunicación.", 0.71, "included"],
  ["66000000-0000-4000-8000-000000000704", IDS.importListeningJuly, IDS.sourceListening, "instagram", "2026-07-12T11:20:00.000Z", "La variedad de premios ayuda a encontrar algo adecuado para cada mascota.", 0.34, "included"],
  ["66000000-0000-4000-8000-000000000705", IDS.importListeningJuly, IDS.sourceListening, "x", "2026-07-16T16:45:00.000Z", "Necesitaba soporte con mi compra y recibí una respuesta clara de Laika.", 0.42, "included"],
  ["66000000-0000-4000-8000-000000000706", IDS.importListeningJuly, IDS.sourceListening, "instagram", "2026-07-20T10:05:00.000Z", "Comprar alimento recurrente para mi perro fue sencillo desde la tienda.", 0.63, "included"],
  ["66000000-0000-4000-8000-000000000707", IDS.importListeningJuly, IDS.sourceListening, "facebook", "2026-07-24T19:10:00.000Z", "La entrega de productos para mi mascota llegó dentro del periodo indicado.", 0.58, "included"],
  ["66000000-0000-4000-8000-000000000708", IDS.importListeningJuly, IDS.sourceListening, "tiktok", "2026-07-29T21:00:00.000Z", "Probé un nuevo snack de Laika y a mi perro le gustó desde el primer día.", 0.76, "included"],
  ["66000000-0000-4000-8000-000000000709", IDS.importListeningAugust, IDS.sourceListening, "instagram", "2026-08-01T13:00:00.000Z", "La compra mensual para mis mascotas quedó organizada en una sola orden.", 0.67, "included"],
  ["66000000-0000-4000-8000-000000000710", IDS.importListeningAugust, IDS.sourceListening, "facebook", "2026-08-02T15:40:00.000Z", "Encontré una promoción útil para alimento y accesorios de mi gato.", 0.61, "included"],
  ["66000000-0000-4000-8000-000000000711", IDS.importListeningAugust, IDS.sourceListening, "x", "2026-08-03T09:25:00.000Z", "El seguimiento del pedido me permitió saber cuándo llegaría la compra.", 0.46, "included"],
  ["66000000-0000-4000-8000-000000000712", IDS.importListeningAugust, IDS.sourceListening, "instagram", "2026-08-03T22:10:00.000Z", "La selección de productos de cuidado tiene alternativas para distintas edades.", 0.52, "included"],
  ["66000000-0000-4000-8000-000000000713", IDS.importReviews, IDS.sourceReviews, "reviews", "2026-07-11T12:00:00.000Z", "Buena experiencia con la entrega y el empaque de los productos para mi mascota.", 0.74, "included"],
  ["66000000-0000-4000-8000-000000000714", IDS.importReviews, IDS.sourceReviews, "reviews", "2026-07-21T12:00:00.000Z", "El catálogo facilita comparar presentaciones de alimento para perro.", 0.49, "included"],
  ["66000000-0000-4000-8000-000000000715", IDS.importReviews, IDS.sourceReviews, "reviews", "2026-08-02T12:00:00.000Z", "La atención resolvió una duda sobre el cambio de un producto.", 0.39, "included"],
  ["66000000-0000-4000-8000-000000000716", IDS.importReviews, IDS.sourceReviews, "reviews", "2026-08-03T12:00:00.000Z", "Registro excluido de QA que no debe entrar al denominador de Laika.", -0.1, "excluded"]
] as const;

type FixtureSummary = {
  organization_id: string;
  admin_email: string;
  brand_id: string;
  brand_slug: string;
  workspace_id: string;
  workspace_slug: string;
  population_id: string;
  governed_mentions: number;
  sources: number;
  imports: number;
  fresh_sources: number;
  stale_sources: number;
  taxonomy_profiles: number;
  report_revision: number;
  report_status: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function prefixedHash(value: string) {
  return `sha256:${sha256(value)}`;
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error(`Admin QA fixture only accepts a local Postgres host. Received: ${parsed.hostname}`);
  }
  if (!/(migration[_-]smoke|admin[_-]qa)/u.test(parsed.pathname)) {
    throw new Error(
      `Admin QA fixture requires a disposable database name containing migration_smoke or admin_qa. Received: ${parsed.pathname}`
    );
  }
}

async function assertRequiredSchema(client: pg.Client) {
  const result = await client.query<{ present: boolean }>(`
    SELECT to_regclass('public.signal_workspace_population_pointers') IS NOT NULL
      AND to_regclass('public.signal_workspace_report_current_releases') IS NOT NULL
      AND to_regclass('public.signal_strategic_run_outbox') IS NOT NULL AS present
  `);
  if (!result.rows[0]?.present) {
    throw new Error("Admin QA fixture requires migrations 0000-0063 before seeding.");
  }
}

async function seedAdminQaFixture(client: pg.Client, adminEmail: string) {
  await client.query("BEGIN");
  try {
    await client.query(`
      INSERT INTO organizations (
        id, slug, legal_name, display_name, hq_country,
        industry_primary, status, notes, created_at, updated_at
      ) VALUES (
        $1::uuid, 'laika-mascotas-qa', 'Laika Mascotas QA, S.A.S.',
        'Laika Mascotas', 'MX', 'Pet care', 'active',
        'Fixture relacional local para QA del Noisia Admin.', $2::timestamptz, $2::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        display_name = EXCLUDED.display_name,
        industry_primary = EXCLUDED.industry_primary,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = EXCLUDED.updated_at
    `, [IDS.organization, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO users (
        id, email, full_name, user_type, primary_role,
        organization_id, status, preferences, created_at, last_login_at
      ) VALUES (
        $1::uuid, $2, 'Admin QA Local', 'noisia_internal', 'noisia_admin',
        NULL, 'active', jsonb_build_object('fixture', 'admin-qa-v1'),
        $3::timestamptz, $3::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        user_type = EXCLUDED.user_type,
        primary_role = EXCLUDED.primary_role,
        organization_id = NULL,
        status = 'active',
        preferences = users.preferences || EXCLUDED.preferences
    `, [IDS.adminUser, adminEmail, FIXTURE_TIMESTAMP]);

    await client.query(`
      UPDATE organizations
      SET account_owner_kam_id = $2::uuid, updated_at = $3::timestamptz
      WHERE id = $1::uuid
    `, [IDS.organization, IDS.adminUser, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, industry, industry_sub,
        countries, description, brand_seed_handles, status,
        primary_brand_manager_user_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, 'laika-mascotas', 'Laika Mascotas', 'Laika Mascotas',
        'Pet care', 'Retail para mascotas', ARRAY['MX']::char(2)[],
        'Marca fixture para QA local del workspace canónico de Signal.',
        ARRAY['Laika Mascotas', 'Laika', '@laikamascotas']::text[], 'active',
        $3::uuid, $4::timestamptz, $4::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        industry = EXCLUDED.industry,
        industry_sub = EXCLUDED.industry_sub,
        countries = EXCLUDED.countries,
        description = EXCLUDED.description,
        brand_seed_handles = EXCLUDED.brand_seed_handles,
        status = EXCLUDED.status,
        primary_brand_manager_user_id = EXCLUDED.primary_brand_manager_user_id,
        updated_at = EXCLUDED.updated_at
    `, [IDS.brand, IDS.organization, IDS.adminUser, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO user_brand_access (
        user_id, brand_id, access_level, granted_by_user_id, granted_at, revoked_at
      ) VALUES (
        $1::uuid, $2::uuid, 'manage', $1::uuid, $3::timestamptz, NULL
      ) ON CONFLICT (user_id, brand_id) DO UPDATE SET
        access_level = EXCLUDED.access_level,
        granted_by_user_id = EXCLUDED.granted_by_user_id,
        granted_at = EXCLUDED.granted_at,
        revoked_at = NULL
    `, [IDS.adminUser, IDS.brand, FIXTURE_TIMESTAMP]);

    const workspace = await client.query<{ workspace_id: string }>(`
      SELECT ensure_signal_workspace_for_brand($1::uuid, $2::uuid)::text AS workspace_id
    `, [IDS.brand, IDS.adminUser]);
    const workspaceId = workspace.rows[0]?.workspace_id;
    if (!workspaceId) throw new Error("Laika workspace could not be provisioned.");

    await client.query(`
      UPDATE signal_workspaces
      SET timezone = 'America/Mexico_City', status = 'active',
          metadata = metadata || jsonb_build_object('fixture', 'admin-qa-v1'),
          updated_at = $2::timestamptz
      WHERE id = $1::uuid
    `, [workspaceId, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO methodologies (
        id, slug, name, version, status, manifest_yaml, created_at, updated_at
      ) VALUES (
        $1::uuid, 'triggers-barriers', 'Triggers & Barriers', '1.0.0',
        'active', jsonb_build_object('fixture', 'admin-qa-v1'),
        $2::timestamptz, $2::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, version = EXCLUDED.version, status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `, [IDS.methodology, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO study_corpora (
        id, name, brand_id, methodology_id, methodology_version_at_creation,
        business_question, decision_to_inform, geo_focus, status,
        current_pipeline_version, insights_manager_user_id, kam_user_id,
        corpus_revision, created_at, updated_at
      ) VALUES (
        $1::uuid, 'Laika Mascotas · ejecución T&B de compatibilidad', $2::uuid,
        $3::uuid, '1.0.0',
        '¿Qué impulsa o frena la elección de Laika Mascotas?',
        'Priorizar decisiones de experiencia y comunicación.',
        ARRAY['MX']::char(2)[], 'corpus_approved', 'tb-v1',
        $4::uuid, $4::uuid, 1, $5::timestamptz, $5::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        business_question = EXCLUDED.business_question,
        decision_to_inform = EXCLUDED.decision_to_inform,
        status = EXCLUDED.status,
        insights_manager_user_id = EXCLUDED.insights_manager_user_id,
        kam_user_id = EXCLUDED.kam_user_id,
        updated_at = EXCLUDED.updated_at
    `, [IDS.executionCorpus, IDS.brand, IDS.methodology, IDS.adminUser, FIXTURE_TIMESTAMP]);

    await client.query(`
      INSERT INTO data_sources (
        id, workspace_id, organization_id, brand_id, source_type, provider,
        connection_method, name, mapping, mapping_version, role, status, visibility,
        governed_scope, governed_entity_type, governed_entity_id,
        scope_policy_version, scope_review_status, scope_approved_by_user_id,
        scope_approval_source, scope_approved_at, created_at, updated_at
      ) VALUES
        ($1::uuid, $3::uuid, $4::uuid, $5::uuid, 'social-listening', 'sentione',
          'manual-csv', 'Laika Social Listening', '{}'::jsonb, 1,
          jsonb_build_object('ownership', 'workspace', 'fixture', 'admin-qa-v1'),
          'active', 'internal', 'primary_brand', 'brand', $5::uuid,
          'workspace-source-scope-v1', 'approved', $6::uuid,
          'fixture_review', $7::timestamptz, $7::timestamptz, $7::timestamptz),
        ($2::uuid, $3::uuid, $4::uuid, $5::uuid, 'social-listening', 'reviews-export',
          'manual-csv', 'Laika Reviews Monitor', '{}'::jsonb, 1,
          jsonb_build_object('ownership', 'workspace', 'fixture', 'admin-qa-v1'),
          'active', 'internal', 'primary_brand', 'brand', $5::uuid,
          'workspace-source-scope-v1', 'approved', $6::uuid,
          'fixture_review', $7::timestamptz, $7::timestamptz, $7::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        organization_id = EXCLUDED.organization_id,
        brand_id = EXCLUDED.brand_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        governed_scope = EXCLUDED.governed_scope,
        governed_entity_type = EXCLUDED.governed_entity_type,
        governed_entity_id = EXCLUDED.governed_entity_id,
        scope_policy_version = EXCLUDED.scope_policy_version,
        scope_review_status = EXCLUDED.scope_review_status,
        scope_approved_by_user_id = EXCLUDED.scope_approved_by_user_id,
        scope_approval_source = EXCLUDED.scope_approval_source,
        scope_approved_at = EXCLUDED.scope_approved_at,
        updated_at = EXCLUDED.updated_at
    `, [
      IDS.sourceListening, IDS.sourceReviews, workspaceId, IDS.organization,
      IDS.brand, IDS.adminUser, FIXTURE_TIMESTAMP
    ]);

    await client.query(`
      INSERT INTO signal_refresh_policies (
        id, workspace_id, data_source_id, source_key, adapter_key, cadence,
        timezone, enabled, expected_next_run, owner_user_id, metadata,
        created_at, updated_at
      ) VALUES
        ($1::uuid, $3::uuid, $4::uuid, 'admin-qa:sentione', 'manual_import',
          'weekly', 'America/Mexico_City', true, '2026-08-10T12:00:00Z',
          $6::uuid, jsonb_build_object('fixture', 'admin-qa-v1'), $7::timestamptz, $7::timestamptz),
        ($2::uuid, $3::uuid, $5::uuid, 'admin-qa:reviews', 'manual_import',
          'daily', 'America/Mexico_City', true, '2026-08-05T12:00:00Z',
          $6::uuid, jsonb_build_object('fixture', 'admin-qa-v1'), $7::timestamptz, $7::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        data_source_id = EXCLUDED.data_source_id,
        cadence = EXCLUDED.cadence,
        timezone = EXCLUDED.timezone,
        enabled = EXCLUDED.enabled,
        expected_next_run = EXCLUDED.expected_next_run,
        owner_user_id = EXCLUDED.owner_user_id,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `, [
      IDS.refreshListening, IDS.refreshReviews, workspaceId,
      IDS.sourceListening, IDS.sourceReviews, IDS.adminUser, FIXTURE_TIMESTAMP
    ]);

    await client.query(`
      INSERT INTO import_batches (
        id, workspace_id, data_source_id, study_corpus_id,
        contributed_by_study_corpus_id, source_system, source_file_name,
        source_file_hash, imported_by_user_id, record_count, included_count,
        excluded_count, duplicate_count, status, created_at
      ) VALUES
        ($1::uuid, $4::uuid, $5::uuid, NULL, NULL, 'sentione',
          'laika-listening-2026-07.csv', $8, $7::uuid, 8, 8, 0, 0,
          'completed', '2026-08-01T09:00:00Z'),
        ($2::uuid, $4::uuid, $5::uuid, NULL, NULL, 'sentione',
          'laika-listening-2026-08.csv', $9, $7::uuid, 4, 4, 0, 0,
          'completed', '2026-08-04T09:00:00Z'),
        ($3::uuid, $4::uuid, $6::uuid, NULL, $10::uuid, 'reviews-export',
          'laika-reviews-2026-08.csv', $11, $7::uuid, 4, 3, 1, 0,
          'completed', '2026-08-04T10:00:00Z')
      ON CONFLICT (id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        data_source_id = EXCLUDED.data_source_id,
        contributed_by_study_corpus_id = EXCLUDED.contributed_by_study_corpus_id,
        source_file_name = EXCLUDED.source_file_name,
        record_count = EXCLUDED.record_count,
        included_count = EXCLUDED.included_count,
        excluded_count = EXCLUDED.excluded_count,
        duplicate_count = EXCLUDED.duplicate_count,
        status = EXCLUDED.status
    `, [
      IDS.importListeningJuly, IDS.importListeningAugust, IDS.importReviews,
      workspaceId, IDS.sourceListening, IDS.sourceReviews, IDS.adminUser,
      sha256("laika-listening-2026-07"), sha256("laika-listening-2026-08"),
      IDS.executionCorpus, sha256("laika-reviews-2026-08")
    ]);

    for (const [id, batchId, sourceId, platform, publishedAt, text, sentiment, inclusion] of MENTIONS) {
      await client.query(`
        INSERT INTO mentions (
          id, workspace_id, data_source_id, canonical_mention_id,
          provider_record_id, external_id, source_system, source_file_id,
          text_hash, text_raw, text_clean, text_snippet, text_length,
          language, published_at, platform, resolved_platform, url, country,
          engagement, sentiment_source, sentiment_score, quality_score,
          inclusion_status, quality_flags, raw_metadata, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $1::uuid,
          $4, $2::text || ':' || $4, 'admin-qa-fixture', $5::uuid,
          $6, $7, $7, left($7, 180), length($7), 'es', $8::timestamptz,
          $9, $9, 'https://example.test/laika/' || $4, 'MX',
          jsonb_build_object('likes', 10, 'comments', 2), 'fixture', $10,
          90, $11, '[]'::jsonb, jsonb_build_object('fixture', 'admin-qa-v1'),
          $8::timestamptz, $12::timestamptz
        ) ON CONFLICT (id) DO NOTHING
      `, [
        id, workspaceId, sourceId, `laika-admin-qa-${id.slice(-3)}`, batchId,
        sha256(text), text, publishedAt, platform, sentiment, inclusion,
        FIXTURE_TIMESTAMP
      ]);
    }

    await client.query(`SELECT reconcile_signal_operational_population($1::uuid)`, [workspaceId]);

    await client.query(`
      INSERT INTO source_sync_runs (
        id, workspace_id, data_source_id, started_at, finished_at, status,
        records_total, records_valid, records_duplicate, records_failed,
        coverage_start, coverage_end, error_summary, created_at
      ) VALUES
        ($1::uuid, $3::uuid, $4::uuid, '2026-08-04T08:55:00Z',
          '2026-08-04T09:05:00Z', 'completed', 12, 12, 0, 0,
          '2026-07-01T14:00:00Z', '2026-08-03T22:10:00Z', '{}'::jsonb,
          '2026-08-04T08:55:00Z'),
        ($2::uuid, $3::uuid, $5::uuid, '2026-08-04T09:55:00Z',
          '2026-08-04T10:05:00Z', 'completed', 4, 3, 0, 1,
          '2026-07-11T12:00:00Z', '2026-08-03T12:00:00Z', '{}'::jsonb,
          '2026-08-04T09:55:00Z')
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        records_total = EXCLUDED.records_total,
        records_valid = EXCLUDED.records_valid,
        records_duplicate = EXCLUDED.records_duplicate,
        records_failed = EXCLUDED.records_failed,
        coverage_start = EXCLUDED.coverage_start,
        coverage_end = EXCLUDED.coverage_end,
        finished_at = EXCLUDED.finished_at
    `, [
      IDS.syncListening, IDS.syncReviews, workspaceId,
      IDS.sourceListening, IDS.sourceReviews
    ]);

    await client.query(`
      SELECT * FROM record_signal_workspace_data_acceptance_v2(
        $1::uuid, 'admin-qa:sentione', $2::uuid, $3::uuid,
        $4::timestamptz, $4::timestamptz
      )
    `, [workspaceId, IDS.sourceListening, IDS.importListeningAugust, FIXTURE_TIMESTAMP]);
    await client.query(`
      SELECT * FROM record_signal_workspace_data_acceptance_v2(
        $1::uuid, 'admin-qa:reviews', $2::uuid, $3::uuid,
        $4::timestamptz, $4::timestamptz
      )
    `, [workspaceId, IDS.sourceReviews, IDS.importReviews, FIXTURE_TIMESTAMP]);
    await client.query(`
      UPDATE signal_data_watermarks
      SET last_source_sync_run_id = CASE data_source_id
            WHEN $2::uuid THEN $4::uuid
            WHEN $3::uuid THEN $5::uuid
          END,
          source_freshness_state = CASE WHEN data_source_id = $3::uuid THEN 'stale' ELSE 'fresh' END,
          data_freshness_state = CASE WHEN data_source_id = $3::uuid THEN 'partial' ELSE 'fresh' END,
          stale_after = CASE WHEN data_source_id = $3::uuid THEN '2026-08-04T12:00:00Z'::timestamptz END,
          updated_at = $6::timestamptz
      WHERE workspace_id = $1::uuid
        AND study_corpus_id IS NULL
        AND data_source_id IN ($2::uuid, $3::uuid)
    `, [
      workspaceId, IDS.sourceListening, IDS.sourceReviews,
      IDS.syncListening, IDS.syncReviews, FIXTURE_TIMESTAMP
    ]);

    await seedTaxonomyProfiles(client, workspaceId);
    await seedPublishedReport(client, workspaceId);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedTaxonomyProfiles(client: pg.Client, workspaceId: string) {
  const kinds = [
    {
      kind: "topic",
      taxonomyId: IDS.topicTaxonomy,
      taxonomyKey: "laika-admin-qa-topics",
      taxonomyName: "Laika Admin QA Topics",
      termId: IDS.topicTerm,
      termKey: "pet_wellbeing",
      termLabel: "Bienestar de mascotas",
      ruleSetId: IDS.topicRuleSet,
      ruleSetKey: "laika-admin-qa-topic-rules",
      modelId: IDS.topicModel,
      modelKey: "laika-admin-qa-topic-model",
      profileId: IDS.topicProfile
    },
    {
      kind: "narrative",
      taxonomyId: IDS.narrativeTaxonomy,
      taxonomyKey: "laika-admin-qa-narratives",
      taxonomyName: "Laika Admin QA Narratives",
      termId: IDS.narrativeTerm,
      termKey: "care_is_simple",
      termLabel: "Cuidar puede ser simple",
      ruleSetId: IDS.narrativeRuleSet,
      ruleSetKey: "laika-admin-qa-narrative-rules",
      modelId: IDS.narrativeModel,
      modelKey: "laika-admin-qa-narrative-model",
      profileId: IDS.narrativeProfile
    }
  ] as const;

  for (const item of kinds) {
    await client.query(`
      INSERT INTO taxonomies (
        id, taxonomy_key, name, scope, methodology_slug, status, created_at
      ) VALUES (
        $1::uuid, $2, $3, 'workspace', 'triggers-barriers', 'active', $4::timestamptz
      ) ON CONFLICT (id) DO NOTHING
    `, [item.taxonomyId, item.taxonomyKey, item.taxonomyName, FIXTURE_TIMESTAMP]);
    await client.query(`
      INSERT INTO taxonomy_terms (
        id, taxonomy_id, term_key, label, description, status, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4,
        'Término determinista para disponibilidad del perfil en QA.',
        'active', $5::timestamptz
      ) ON CONFLICT (id) DO NOTHING
    `, [item.termId, item.taxonomyId, item.termKey, item.termLabel, FIXTURE_TIMESTAMP]);
    await client.query(`
      INSERT INTO tagging_rule_sets (
        id, rule_set_key, version, methodology_slug, subject_type,
        scope, taxonomy_id, rules, status, metadata, created_at, updated_at
      ) VALUES (
        $1::uuid, $2, 1, 'triggers-barriers', 'mention', 'workspace',
        $3::uuid, '{}'::jsonb, 'active',
        jsonb_build_object('fixture', 'admin-qa-v1'), $4::timestamptz, $4::timestamptz
      ) ON CONFLICT (id) DO NOTHING
    `, [item.ruleSetId, item.ruleSetKey, item.taxonomyId, FIXTURE_TIMESTAMP]);
    await client.query(`
      INSERT INTO tagging_model_versions (
        id, model_key, provider, version, methodology_slug,
        tagging_rule_set_id, prompt_hash, metadata, created_at
      ) VALUES (
        $1::uuid, $2, 'fixture', '1', 'triggers-barriers', $3::uuid,
        $4, jsonb_build_object('fixture', 'admin-qa-v1'), $5::timestamptz
      ) ON CONFLICT (id) DO NOTHING
    `, [item.modelId, item.modelKey, item.ruleSetId, prefixedHash(item.modelKey), FIXTURE_TIMESTAMP]);
    await client.query(`
      INSERT INTO signal_taxonomy_profiles (
        id, workspace_id, taxonomy_id, kind, version, status, context_hash,
        rule_set_id, model_version_id, approved_by_user_id, approved_at,
        metadata, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 'active', $5,
        $6::uuid, $7::uuid, $8::uuid, $9::timestamptz,
        jsonb_build_object('fixture', 'admin-qa-v1'), $9::timestamptz, $9::timestamptz
      ) ON CONFLICT (id) DO NOTHING
    `, [
      item.profileId, workspaceId, item.taxonomyId, item.kind,
      prefixedHash(`${item.kind}:laika-admin-qa-v1`), item.ruleSetId,
      item.modelId, IDS.adminUser, FIXTURE_TIMESTAMP
    ]);
  }
}

async function seedPublishedReport(client: pg.Client, workspaceId: string) {
  const populationKey = prefixedHash("laika-admin-qa:analysis-population:v1");
  const runKey = prefixedHash("laika-admin-qa:tb-run:v1");
  const population = await client.query<{ population_id: string }>(`
    SELECT population_id::text
    FROM create_signal_tb_analysis_population(
      $1::uuid, 'triggers-barriers', '2026-07-01'::date, '2026-08-04'::date,
      'America/Mexico_City', 'primary-brand-analysis', '1',
      $2::uuid, $3
    )
  `, [workspaceId, IDS.adminUser, populationKey]);
  const populationId = population.rows[0]?.population_id;
  if (!populationId) throw new Error("Strategic analysis population could not be created.");

  const run = await client.query<{ tb_analysis_id: string; snapshot_id: string; outbox_id: string }>(`
    SELECT tb_analysis_id::text, snapshot_id::text, outbox_id::text
    FROM create_signal_tb_strategic_run(
      $1::uuid, 'triggers-barriers', $2::uuid, $3::uuid, $4::uuid,
      $5, 'Laika Mascotas · T&B QA local', 'tb-pipeline-fixture-v1', '1.0.0',
      'fixture-no-llm', 'fixture-no-llm',
      '¿Qué impulsa o frena la elección de Laika Mascotas?',
      'Priorizar decisiones de experiencia y comunicación.', 1,
      jsonb_build_object('fixture', 'admin-qa-v1', 'paid_execution', false)
    )
  `, [workspaceId, populationId, IDS.executionCorpus, IDS.adminUser, runKey]);
  const analysisId = run.rows[0]?.tb_analysis_id;
  const snapshotId = run.rows[0]?.snapshot_id;
  const outboxId = run.rows[0]?.outbox_id;
  if (!analysisId || !snapshotId || !outboxId) {
    throw new Error("Strategic report fixture run could not be created.");
  }

  await client.query(`
    INSERT INTO analysis_artifacts (
      id, study_corpus_id, tb_analysis_id, artifact_key, artifact_type,
      title, summary, content, confidence, review_status, revision,
      position, metadata, created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'laika-admin-qa-report-summary', 'summary',
      'Laika Mascotas · Triggers & Barriers',
      'Release determinista para validar el registry relacional del Admin.',
      jsonb_build_object('fixture', true, 'paid_execution', false),
      'high', 'accepted', 1, 0,
      jsonb_build_object('fixture', 'admin-qa-v1'), $4::timestamptz, $4::timestamptz
    ) ON CONFLICT (id) DO NOTHING
  `, [IDS.reportArtifact, IDS.executionCorpus, analysisId, FIXTURE_TIMESTAMP]);

  await client.query(`
    INSERT INTO tb_quality_gates (tb_analysis_id, gate_name, passed, notes, checked_at)
    VALUES (
      $1::uuid, 'snapshot_containment', true,
      'Fixture determinista; no ejecutó modelos ni análisis pagado.', $2::timestamptz
    ) ON CONFLICT (tb_analysis_id, gate_name) DO UPDATE SET
      passed = EXCLUDED.passed, notes = EXCLUDED.notes, checked_at = EXCLUDED.checked_at
  `, [analysisId, FIXTURE_TIMESTAMP]);

  await client.query(`
    UPDATE tb_analyses
    SET status = 'approved_by_kam', current_step = 'done',
        approved_by_im_user_id = $2::uuid, approved_by_kam_user_id = $2::uuid,
        im_approved_at = $3::timestamptz, kam_approved_at = $3::timestamptz,
        updated_at = $3::timestamptz
    WHERE id = $1::uuid
  `, [analysisId, IDS.adminUser, FIXTURE_TIMESTAMP]);
  await client.query(`
    UPDATE study_corpora
    SET locked_by_analysis_id = NULL, updated_at = $2::timestamptz
    WHERE id = $1::uuid AND locked_by_analysis_id = $3::uuid
  `, [IDS.executionCorpus, FIXTURE_TIMESTAMP, analysisId]);
  await client.query(`
    UPDATE signal_strategic_run_outbox
    SET status = 'completed', attempt = GREATEST(attempt, 1),
        bullmq_job_id = 'signal-tb-' || tb_analysis_id::text,
        dispatched_at = COALESCE(dispatched_at, $2::timestamptz),
        completed_at = $2::timestamptz,
        locked_at = NULL, lease_expires_at = NULL, lease_token = NULL,
        last_error = '{}'::jsonb, updated_at = $2::timestamptz
    WHERE id = $1::uuid
  `, [outboxId, FIXTURE_TIMESTAMP]);

  await client.query(`
    INSERT INTO signal_workspace_releases (
      id, workspace_id, tb_analysis_id, report_key, report_revision,
      release_key, release_type, title, status, visibility,
      period_start, period_end, corpus_revision, snapshot_id,
      quality_gates, metadata, created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 'triggers-barriers', 1,
      'laika-admin-qa-tb-r1', 'strategic', 'Laika Mascotas · T&B revisión 1',
      'draft', 'internal', '2026-07-01', '2026-08-04', 1, $4::uuid,
      jsonb_build_array(jsonb_build_object('gate', 'snapshot_containment', 'passed', true)),
      jsonb_build_object('fixture', 'admin-qa-v1', 'paid_execution', false),
      $5::timestamptz, $5::timestamptz
    ) ON CONFLICT (id) DO NOTHING
  `, [IDS.reportRelease, workspaceId, analysisId, snapshotId, FIXTURE_TIMESTAMP]);
  await client.query(`
    INSERT INTO signal_workspace_release_artifacts (
      release_id, artifact_id, artifact_revision, position, visibility
    )
    SELECT $1::uuid, $2::uuid, 1, 0, 'client'
    WHERE NOT EXISTS (
      SELECT 1 FROM signal_workspace_release_artifacts
      WHERE release_id = $1::uuid AND artifact_id = $2::uuid
    )
  `, [IDS.reportRelease, IDS.reportArtifact]);
  await client.query(`
    SELECT promote_signal_workspace_report_release($1::uuid, $2::uuid)
  `, [IDS.reportRelease, IDS.adminUser]);
}

async function verifyAdminQaFixture(client: pg.Client, adminEmail: string) {
  const result = await client.query<FixtureSummary>(`
    SELECT
      organization.id::text AS organization_id,
      admin.email AS admin_email,
      brand.id::text AS brand_id,
      brand.slug AS brand_slug,
      workspace.id::text AS workspace_id,
      workspace.slug AS workspace_slug,
      pointer.population_id::text AS population_id,
      count(DISTINCT membership.mention_id) FILTER (
        WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
      )::integer AS governed_mentions,
      count(DISTINCT source.id)::integer AS sources,
      count(DISTINCT batch.id)::integer AS imports,
      count(DISTINCT watermark.data_source_id) FILTER (
        WHERE watermark.source_freshness_state = 'fresh'
      )::integer AS fresh_sources,
      count(DISTINCT watermark.data_source_id) FILTER (
        WHERE watermark.source_freshness_state = 'stale'
      )::integer AS stale_sources,
      count(DISTINCT profile.id)::integer AS taxonomy_profiles,
      release.report_revision::integer AS report_revision,
      release.status AS report_status
    FROM organizations organization
    JOIN users admin ON admin.id = $1::uuid
      AND admin.user_type = 'noisia_internal'
      AND admin.primary_role = 'noisia_admin'
      AND admin.status = 'active'
    JOIN brands brand ON brand.organization_id = organization.id
    JOIN user_brand_access access ON access.user_id = admin.id
      AND access.brand_id = brand.id AND access.revoked_at IS NULL
    JOIN signal_workspaces workspace ON workspace.brand_id = brand.id
      AND workspace.organization_id = organization.id AND workspace.status = 'active'
    JOIN signal_workspace_population_pointers pointer ON pointer.workspace_id = workspace.id
      AND pointer.purpose = 'operational'
    JOIN signal_population_definitions population ON population.id = pointer.population_id
      AND population.workspace_id = workspace.id AND population.status = 'active'
      AND population.allowed_scopes = ARRAY['primary_brand']::text[]
    LEFT JOIN signal_population_memberships membership ON membership.population_id = population.id
    LEFT JOIN data_sources source ON source.workspace_id = workspace.id
    LEFT JOIN import_batches batch ON batch.workspace_id = workspace.id
    LEFT JOIN signal_data_watermarks watermark ON watermark.workspace_id = workspace.id
      AND watermark.study_corpus_id IS NULL
    LEFT JOIN signal_taxonomy_profiles profile ON profile.workspace_id = workspace.id
      AND profile.status = 'active'
    JOIN signal_workspace_report_current_releases current_release
      ON current_release.workspace_id = workspace.id
      AND current_release.report_key = 'triggers-barriers'
    JOIN signal_workspace_releases release ON release.id = current_release.release_id
      AND release.workspace_id = workspace.id
      AND release.report_key = current_release.report_key
      AND release.status = 'published'
    WHERE organization.id = $2::uuid AND brand.id = $3::uuid
    GROUP BY organization.id, admin.email, brand.id, workspace.id,
      pointer.population_id, release.report_revision, release.status
  `, [IDS.adminUser, IDS.organization, IDS.brand]);
  const summary = result.rows[0];
  if (!summary) throw new Error("Admin QA fixture verification did not resolve Laika.");
  const expected = {
    adminEmail,
    governedMentions: 15,
    sources: 2,
    imports: 3,
    freshSources: 1,
    staleSources: 1,
    taxonomyProfiles: 2,
    reportRevision: 1,
    reportStatus: "published"
  };
  const observed = {
    adminEmail: summary.admin_email,
    governedMentions: Number(summary.governed_mentions),
    sources: Number(summary.sources),
    imports: Number(summary.imports),
    freshSources: Number(summary.fresh_sources),
    staleSources: Number(summary.stale_sources),
    taxonomyProfiles: Number(summary.taxonomy_profiles),
    reportRevision: Number(summary.report_revision),
    reportStatus: summary.report_status
  };
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`Admin QA fixture verification mismatch: ${JSON.stringify({ expected, observed })}`);
  }
  return summary;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the Admin QA fixture.");
  requireDisposableLocalDatabase(databaseUrl);
  const adminEmail = (process.env.NOISIA_ADMIN_QA_EMAIL ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  if (!adminEmail) throw new Error("NOISIA_ADMIN_QA_EMAIL cannot be empty.");

  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await assertRequiredSchema(client);
    await seedAdminQaFixture(client, adminEmail);
    const summary = await verifyAdminQaFixture(client, adminEmail);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      fixture: "admin-qa-v1",
      local_auth_email: adminEmail,
      ...summary
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
