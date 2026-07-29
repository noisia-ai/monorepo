import { randomUUID } from "node:crypto";

import {
  buildSignalMentionDrillDownPlanV1,
  buildSignalMetricMaterializationPlanV1,
  normalizeSignalFilterV1,
  type SignalMaterializationRowV1,
  type SignalTaxonomyKindV1
} from "@noisia/query-engine";
import pg from "pg";

import {
  getDatabaseSslConfig,
  requireSafeDatabaseWriteTarget
} from "../seeds/connection";

const FIXTURE_SIZE = 10_050;

type Fixture = {
  organizationId: string;
  brandId: string;
  corpusId: string;
  workspaceId: string;
  reviewerId: string;
  profiles: Record<SignalTaxonomyKindV1, {
    id: string;
    modelVersionId: string;
    terms: Record<string, string>;
  }>;
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "Signal Topics & Narratives disposable runtime smoke",
    allowRemoteEnv: "NOISIA_SIGNAL_TAXONOMY_RUNTIME_ALLOW_REMOTE"
  });
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig()
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL jit = off");
    const fixture = await seedFixture(client);
    await client.query(`
      ANALYZE mentions;
      ANALYZE record_tags;
      ANALYZE record_feature_values;
      ANALYZE signal_taxonomy_profiles;
      ANALYZE taxonomy_terms
    `);
    const filter = normalizeSignalFilterV1({
      date_range: { start: "2026-01-01", end: "2026-03-31" },
      timezone: "UTC",
      granularity: "month",
      dimensions: {}
    });
    const results = [];
    for (const kind of ["topic", "narrative"] as const) {
      results.push(await reconcileKind(client, fixture, filter, kind));
    }
    const activation = await verifyActivationLifecycle(client, fixture);
    console.log(JSON.stringify({
      ok: true,
      contract_version: "signal-topics-narratives-v1",
      fixture_mentions: FIXTURE_SIZE,
      postgres_runtime: true,
      paid_provider_invoked: false,
      activation,
      results
    }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function seedFixture(client: pg.Client): Promise<Fixture> {
  const organizationId = randomUUID();
  const brandId = randomUUID();
  const reviewerId = randomUUID();
  const methodologyId = randomUUID();
  const corpusId = randomUUID();
  const workspaceId = randomUUID();
  await client.query(`
    INSERT INTO organizations (id, slug, legal_name, display_name, status)
    VALUES ($1::uuid, $2, 'TN Runtime Fixture', 'TN Runtime Fixture', 'active')
  `, [organizationId, `tn-runtime-${organizationId}`]);
  await client.query(`
    INSERT INTO users (
      id, email, full_name, user_type, primary_role, organization_id, status
    ) VALUES (
      $1::uuid, $2, 'TN Reviewer', 'internal', 'admin', $3::uuid, 'active'
    )
  `, [
    reviewerId,
    `tn-runtime-${reviewerId}@example.invalid`,
    organizationId
  ]);
  await client.query(`
    INSERT INTO brands (
      id, organization_id, slug, name, display_name, status
    ) VALUES ($1::uuid, $2::uuid, $3, 'TN Fixture', 'TN Fixture', 'active')
  `, [brandId, organizationId, `tn-runtime-${brandId}`]);
  await client.query(`
    INSERT INTO methodologies (
      id, slug, name, version, status, manifest_yaml
    ) VALUES (
      $1::uuid, $2, 'Signal Pulse Fixture', '1', 'active', '{}'::jsonb
    )
  `, [methodologyId, `signal-pulse-runtime-${methodologyId}`]);
  await client.query(`
    INSERT INTO study_corpora (
      id, brand_id, methodology_id, methodology_version_at_creation,
      status, name, corpus_revision
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, '1', 'ready', 'TN Runtime', 1
    )
  `, [corpusId, brandId, methodologyId]);
  await client.query(`
    INSERT INTO signal_workspaces (
      id, organization_id, brand_id, slug, timezone, status, metadata
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4, 'UTC', 'active',
      '{"fixture":"signal-topics-narratives-runtime"}'::jsonb
    )
  `, [workspaceId, organizationId, brandId, `tn-runtime-${workspaceId}`]);
  await client.query(`
    INSERT INTO signal_workspace_corpora (
      workspace_id, study_corpus_id, role, metadata
    ) VALUES (
      $1::uuid, $2::uuid, 'operational',
      '{"fixture":"signal-topics-narratives-runtime"}'::jsonb
    )
  `, [workspaceId, corpusId]);

  const profiles = {
    topic: await seedProfile(client, {
      workspaceId,
      reviewerId,
      kind: "topic",
      terms: [
        ["battery", "Battery"],
        ["design", "Design"],
        ["shipping", "Shipping"]
      ]
    }),
    narrative: await seedProfile(client, {
      workspaceId,
      reviewerId,
      kind: "narrative",
      terms: [
        ["value_story", "Value story"],
        ["trust_story", "Trust story"]
      ]
    })
  };

  await client.query(`
    INSERT INTO mentions (
      study_corpus_id, external_id, source_system, text_hash,
      text_clean, text_snippet, text_length, language,
      published_at, platform, country, inclusion_status
    )
    SELECT $1::uuid,
      'tn-runtime-' || item::text,
      'runtime_fixture',
      md5('tn-runtime-' || item::text),
      'Runtime fixture conversation ' || item::text,
      'Runtime fixture conversation ' || item::text,
      length('Runtime fixture conversation ' || item::text),
      'en',
      '2026-01-01T12:00:00Z'::timestamptz
        + ((item - 1) % 90) * interval '1 day',
      CASE WHEN item % 2 = 0 THEN 'instagram' ELSE 'tiktok' END,
      'MX',
      'included'
    FROM generate_series(1, $2::int) item
  `, [corpusId, FIXTURE_SIZE]);

  for (const kind of ["topic", "narrative"] as const) {
    const profile = profiles[kind];
    await client.query(`
      INSERT INTO record_feature_values (
        organization_id, brand_id, study_corpus_id,
        subject_type, subject_id, feature_key, feature_value,
        value_type, confidence, source, model_version_id
      )
      SELECT $1::uuid, $2::uuid, $3::uuid,
        'mention', mention.id,
        'signal_taxonomy_classification:' || $4::uuid::text,
        '{"processed":true}'::jsonb,
        'object', 'high',
        'signal_taxonomy_profile:' || $4::uuid::text,
        $5::uuid
      FROM mentions mention
      WHERE mention.study_corpus_id = $3::uuid
    `, [
      organizationId,
      brandId,
      corpusId,
      profile.id,
      profile.modelVersionId
    ]);
  }

  await insertTags(client, {
    fixture: {
      organizationId,
      brandId,
      corpusId,
      workspaceId,
      reviewerId,
      profiles
    },
    kind: "topic",
    termKey: "battery",
    predicate: "true",
    reviewStatus: "approved"
  });
  await insertTags(client, {
    fixture: {
      organizationId,
      brandId,
      corpusId,
      workspaceId,
      reviewerId,
      profiles
    },
    kind: "topic",
    termKey: "design",
    predicate: "(substring(mention.external_id from '[0-9]+$'))::int % 5 = 0",
    reviewStatus: "approved"
  });
  await insertTags(client, {
    fixture: {
      organizationId,
      brandId,
      corpusId,
      workspaceId,
      reviewerId,
      profiles
    },
    kind: "topic",
    termKey: "shipping",
    predicate: "(substring(mention.external_id from '[0-9]+$'))::int % 97 = 0",
    reviewStatus: "pending"
  });
  await insertTags(client, {
    fixture: {
      organizationId,
      brandId,
      corpusId,
      workspaceId,
      reviewerId,
      profiles
    },
    kind: "narrative",
    termKey: "value_story",
    predicate: "(substring(mention.external_id from '[0-9]+$'))::int % 2 = 0",
    reviewStatus: "approved"
  });
  await insertTags(client, {
    fixture: {
      organizationId,
      brandId,
      corpusId,
      workspaceId,
      reviewerId,
      profiles
    },
    kind: "narrative",
    termKey: "trust_story",
    predicate: "(substring(mention.external_id from '[0-9]+$'))::int % 3 = 0",
    reviewStatus: "approved"
  });
  return {
    organizationId,
    brandId,
    corpusId,
    workspaceId,
    reviewerId,
    profiles
  };
}

async function seedProfile(client: pg.Client, args: {
  workspaceId: string;
  reviewerId: string;
  kind: SignalTaxonomyKindV1;
  terms: Array<[string, string]>;
  version?: number;
  status?: "active" | "draft";
}) {
  const taxonomyId = randomUUID();
  const ruleSetId = randomUUID();
  const modelVersionId = randomUUID();
  const profileId = randomUUID();
  await client.query(`
    INSERT INTO taxonomies (
      id, taxonomy_key, name, scope, methodology_slug, status
    ) VALUES (
      $1::uuid, $2, $3, 'workspace', 'signal-topics-narratives', 'active'
    )
  `, [
    taxonomyId,
    `tn-runtime-${args.kind}-${taxonomyId}`,
    `TN Runtime ${args.kind}`
  ]);
  await client.query(`
    INSERT INTO tagging_rule_sets (
      id, rule_set_key, version, methodology_slug,
      subject_type, scope, taxonomy_id, rules, status, metadata
    ) VALUES (
      $1::uuid, $2, 1, 'signal-topics-narratives',
      'mention', 'workspace', $3::uuid, '{}'::jsonb, 'active',
      '{"fixture":true}'::jsonb
    )
  `, [
    ruleSetId,
    `tn-runtime-${args.kind}-${ruleSetId}`,
    taxonomyId
  ]);
  await client.query(`
    INSERT INTO tagging_model_versions (
      id, model_key, provider, version, methodology_slug,
      tagging_rule_set_id, prompt_hash, metadata
    ) VALUES (
      $1::uuid, $2, 'fixture', '1', 'signal-topics-narratives',
      $3::uuid, $4, '{"fixture":true}'::jsonb
    )
  `, [
    modelVersionId,
    `tn-runtime-${args.kind}-${modelVersionId}`,
    ruleSetId,
    `sha256:${"1".repeat(64)}`
  ]);
  await client.query(`
    INSERT INTO signal_taxonomy_profiles (
      id, workspace_id, taxonomy_id, kind, version, status,
      context_hash, rule_set_id, model_version_id,
      approved_by_user_id, approved_at, metadata
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
      $7, $8::uuid, $9::uuid, $10::uuid,
      CASE WHEN $10::uuid IS NULL THEN NULL ELSE now() END,
      '{"fixture":true}'::jsonb
    )
  `, [
    profileId,
    args.workspaceId,
    taxonomyId,
    args.kind,
    args.version ?? 1,
    args.status ?? "active",
    `sha256:${"2".repeat(64)}`,
    ruleSetId,
    modelVersionId,
    (args.status ?? "active") === "active" ? args.reviewerId : null
  ]);
  const terms: Record<string, string> = {};
  for (const [termKey, label] of args.terms) {
    const termId = randomUUID();
    await client.query(`
      INSERT INTO taxonomy_terms (
        id, taxonomy_id, term_key, label, description, metadata, status
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5,
        '{"examples":["runtime fixture"],"exclusions":[]}'::jsonb,
        $6
      )
    `, [
      termId,
      taxonomyId,
      termKey,
      label,
      `${args.kind} runtime definition`,
      (args.status ?? "active") === "active" ? "active" : "candidate"
    ]);
    terms[termKey] = termId;
  }
  return { id: profileId, modelVersionId, terms };
}

async function verifyActivationLifecycle(client: pg.Client, fixture: Fixture) {
  const previousProfileId = fixture.profiles.topic.id;
  const next = await seedProfile(client, {
    workspaceId: fixture.workspaceId,
    reviewerId: fixture.reviewerId,
    kind: "topic",
    version: 2,
    status: "draft",
    terms: [["runtime_v2", "Runtime V2"]]
  });
  await client.query(
    `SELECT activate_signal_taxonomy_profile($1::uuid, $2::uuid)`,
    [next.id, fixture.reviewerId]
  );
  const during = await client.query<{
    active: number;
    activating: number;
    old_active: boolean;
  }>(`
    SELECT
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE status = 'activating')::int AS activating,
      bool_or(id = $2::uuid AND status = 'active') AS old_active
    FROM signal_taxonomy_profiles
    WHERE workspace_id = $1::uuid AND kind = 'topic'
  `, [fixture.workspaceId, previousProfileId]);

  await client.query("SAVEPOINT activation_incomplete");
  let incompleteFailedClosed = false;
  try {
    await client.query(
      `SELECT complete_signal_taxonomy_profile_activation($1::uuid)`,
      [next.id]
    );
  } catch {
    incompleteFailedClosed = true;
    await client.query("ROLLBACK TO SAVEPOINT activation_incomplete");
  }
  await client.query("RELEASE SAVEPOINT activation_incomplete");

  await client.query(`
    INSERT INTO record_feature_values (
      organization_id, brand_id, study_corpus_id,
      subject_type, subject_id, feature_key, feature_value,
      value_type, confidence, source, model_version_id
    )
    SELECT $1::uuid, $2::uuid, $3::uuid,
      'mention', mention.id,
      'signal_taxonomy_classification:' || $4::uuid::text,
      '{"processed":true}'::jsonb,
      'object', 'high',
      'signal_taxonomy_profile:' || $4::uuid::text,
      $5::uuid
    FROM mentions mention
    WHERE mention.study_corpus_id = $3::uuid
  `, [
    fixture.organizationId,
    fixture.brandId,
    fixture.corpusId,
    next.id,
    next.modelVersionId
  ]);
  await client.query(
    `SELECT complete_signal_taxonomy_profile_activation($1::uuid)`,
    [next.id]
  );
  const after = await client.query<{
    active: number;
    activating: number;
    old_retired: boolean;
    new_active: boolean;
  }>(`
    SELECT
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE status = 'activating')::int AS activating,
      bool_or(id = $2::uuid AND status = 'retired') AS old_retired,
      bool_or(id = $3::uuid AND status = 'active') AS new_active
    FROM signal_taxonomy_profiles
    WHERE workspace_id = $1::uuid AND kind = 'topic'
  `, [fixture.workspaceId, previousProfileId, next.id]);
  return {
    during_backfill: during.rows[0],
    incomplete_failed_closed: incompleteFailedClosed,
    after_cutover: after.rows[0],
    no_empty_window:
      during.rows[0]?.old_active === true
      && during.rows[0]?.active === 1
      && during.rows[0]?.activating === 1,
    single_client_safe_profile:
      after.rows[0]?.active === 1
      && after.rows[0]?.activating === 0
      && after.rows[0]?.old_retired === true
      && after.rows[0]?.new_active === true
  };
}

async function insertTags(client: pg.Client, args: {
  fixture: Fixture;
  kind: SignalTaxonomyKindV1;
  termKey: string;
  predicate: string;
  reviewStatus: "approved" | "pending";
}) {
  const profile = args.fixture.profiles[args.kind];
  await client.query(`
    INSERT INTO record_tags (
      organization_id, brand_id, study_corpus_id,
      subject_type, subject_id, taxonomy_term_id,
      value, score, confidence, evidence, source,
      model_version_id, review_status, signal_taxonomy_profile_id,
      approval_source, approved_at
    )
    SELECT $1::uuid, $2::uuid, $3::uuid,
      'mention', mention.id, $4::uuid,
      $5, 0.9, 'high',
      jsonb_build_object(
        'quotes',
        jsonb_build_array(jsonb_build_object(
          'quote', mention.text_snippet,
          'start', 0,
          'end', length(mention.text_snippet)
        ))
      ),
      'signal_taxonomy_profile:' || $6::uuid::text,
      $7::uuid, $8, $6::uuid,
      CASE WHEN $8 = 'approved' THEN 'human' END,
      CASE WHEN $8 = 'approved' THEN now() END
    FROM mentions mention
    WHERE mention.study_corpus_id = $3::uuid
      AND ${args.predicate}
  `, [
    args.fixture.organizationId,
    args.fixture.brandId,
    args.fixture.corpusId,
    profile.terms[args.termKey],
    args.termKey,
    profile.id,
    profile.modelVersionId,
    args.reviewStatus
  ]);
}

async function reconcileKind(
  client: pg.Client,
  fixture: Fixture,
  filter: ReturnType<typeof normalizeSignalFilterV1>,
  kind: SignalTaxonomyKindV1
) {
  const metricKey = kind === "topic" ? "topic.volume" : "narrative.volume";
  const plan = buildSignalMetricMaterializationPlanV1({
    metric_key: metricKey,
    filter,
    study_corpus_ids: [fixture.corpusId],
    workspace_id: fixture.workspaceId
  });
  const materialized = await client.query<SignalMaterializationRowV1>(
    plan.sql,
    plan.params
  );
  const bucketCounts = new Map<string, number>();
  for (const row of materialized.rows) {
    for (const bucket of objectArray(row.typed_payload.buckets)) {
      const key = String(bucket.key);
      bucketCounts.set(
        key,
        (bucketCounts.get(key) ?? 0) + Number(bucket.value)
      );
    }
  }
  const reconciliations = [];
  for (const [termKey, materializedCount] of bucketCounts) {
    const termFilter = normalizeSignalFilterV1({
      ...filter,
      dimensions: { [kind]: [termKey] }
    });
    const drillDown = buildSignalMentionDrillDownPlanV1({
      filter: termFilter,
      study_corpus_ids: [fixture.corpusId],
      workspace_id: fixture.workspaceId,
      metric_key: metricKey,
      limit: 100
    });
    const direct = await client.query<{ subject_id: string }>(`
      SELECT mention.id::text AS subject_id
      FROM mentions mention
      JOIN record_tags tag
        ON tag.subject_type = 'mention'
       AND tag.subject_id = mention.id
       AND tag.review_status = 'approved'
      JOIN signal_taxonomy_profiles profile
        ON profile.id = tag.signal_taxonomy_profile_id
       AND profile.workspace_id = $1::uuid
       AND profile.kind = $2
       AND profile.status = 'active'
      JOIN taxonomy_terms term
        ON term.id = tag.taxonomy_term_id
       AND term.taxonomy_id = profile.taxonomy_id
       AND term.term_key = $3
       AND term.status = 'active'
      WHERE mention.study_corpus_id = $4::uuid
        AND mention.inclusion_status = 'included'
        AND mention.published_at >= $5::date
        AND mention.published_at < ($6::date + interval '1 day')
      ORDER BY mention.id
    `, [
      fixture.workspaceId,
      kind,
      termKey,
      fixture.corpusId,
      filter.date_range.start,
      filter.date_range.end
    ]);
    const pagedIds: string[] = [];
    let cursor: { occurred_at: string; subject_id: string } | undefined;
    while (true) {
      const pagePlan = buildSignalMentionDrillDownPlanV1({
        filter: termFilter,
        study_corpus_ids: [fixture.corpusId],
        workspace_id: fixture.workspaceId,
        metric_key: metricKey,
        limit: 100,
        cursor
      });
      const page = await client.query<{
        subject_id: string;
        occurred_at: Date;
      }>(pagePlan.sql, pagePlan.params);
      const visible = page.rows.slice(0, 100);
      pagedIds.push(...visible.map((row) => row.subject_id));
      if (page.rows.length <= 100) break;
      const last = visible.at(-1);
      if (!last) break;
      cursor = {
        occurred_at: last.occurred_at.toISOString(),
        subject_id: last.subject_id
      };
    }
    const directIds = direct.rows.map((row) => row.subject_id).sort();
    const drillDownIds = pagedIds.sort();
    if (
      materializedCount !== directIds.length
      || JSON.stringify(directIds) !== JSON.stringify(drillDownIds)
    ) {
      throw new Error(
        `${metricKey}/${termKey} failed aggregate/base/drill-down reconciliation.`
      );
    }
    reconciliations.push({
      term_key: termKey,
      materialized_count: materializedCount,
      base_sql_count: directIds.length,
      drill_down_count: drillDownIds.length,
      exact_ids: true
    });
  }
  const explain = await client.query<{
    "QUERY PLAN": Array<{
      Plan: { "Actual Rows"?: number };
      "Planning Time": number;
      "Execution Time": number;
    }>;
  }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.sql}`,
    plan.params
  );
  const document = explain.rows[0]?.["QUERY PLAN"]?.[0];
  if (!document) throw new Error(`EXPLAIN ANALYZE did not return ${metricKey}.`);
  return {
    kind,
    metric_key: metricKey,
    materialized_periods: materialized.rows.length,
    state: materialized.rows.some(
      (row) => row.materialization_state === "partial"
    ) ? "partial" : "fresh",
    pending_excluded: kind === "topic",
    reconciliations,
    explain_analyze: {
      planning_ms: document["Planning Time"],
      execution_ms: document["Execution Time"],
      actual_rows: document.Plan["Actual Rows"] ?? null,
      indexes: collectIndexes(document.Plan)
    }
  };
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function collectIndexes(plan: Record<string, unknown>) {
  const indexes = new Set<string>();
  const visit = (node: Record<string, unknown>) => {
    if (typeof node["Index Name"] === "string") {
      indexes.add(node["Index Name"]);
    }
    for (const child of objectArray(node.Plans)) visit(child);
  };
  visit(plan);
  return Array.from(indexes).sort();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
