import assert from "node:assert/strict";
import test from "node:test";
import { signalTopicDefinitionDigestV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceClassificationInputV1 } from "./signal-workspace-classification";
import { loadSignalWorkspaceTopicDetailV1, loadSignalWorkspaceTopicsOverviewV1 } from "./signal-workspace-topics-serving";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const workspaceId = id("1"), actorId = id("2"), profileA = id("3"), generationId = id("4"), workingProfile = id("11");
const topicAContent = {
  term_key: "service",
  label: "Service A",
  definition: "The calculated definition",
  scope: "primary_brand" as const,
  inclusion: [], exclusion: [], positive_examples: [], negative_examples: [],
  lifecycle: "draft" as const,
  origin: "manual" as const,
  source: null
};
const topicA = {
  ...topicAContent,
  definition_revision: 1,
  definition_digest: signalTopicDefinitionDigestV1(topicAContent),
  created_at: "2026-09-11T10:00:00.000Z",
  updated_at: "2026-09-11T10:00:00.000Z"
};
const workingTopicA = { ...topicA, label: "Servicio al cliente", definition_revision: 2,
  updated_at: "2026-09-11T11:00:00.000Z" };
test("Signal keeps served semantics while applying a safe working label", async () => {
  const statements: string[] = [];
  const detailQueries: Array<{ sql: string; params: unknown[] }> = [];
  let access = true;
  const topicQueries: Array<{ sql: string; params: unknown[] }> = [];
  let identity: Awaited<ReturnType<typeof loadSignalWorkspaceClassificationInputV1>> | null = null;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/u.test(sql)) return { rows: [] };
      if (sql.includes("brand_access_level")) return { rows: [{ workspace_status: "active", brand_status: "active",
        organization_status: "active", brand_same_organization: true,
        actor_status: access ? "active" : "suspended", user_type: "client", primary_role: "client_admin", same_organization: true,
        brand_access_level: "admin" }] };
      if (sql.includes("SELECT id,taxonomy_id FROM signal_taxonomy_profiles")) return { rows: [{ id: profileA, taxonomy_id: id("7") }] };
      if (sql.includes("COALESCE(brand.display_name, brand.name) AS brand_name")) return { rows: [{
        workspace_id: workspaceId, brand_id: id("8"), brand_name: "Example", brand_slug: "example",
        brand_handles: [], description: "Example brand", industry: "Retail", industry_sub: null, countries: ["MX"]
      }] };
      if (sql.includes("SELECT 'primary_brand'::text AS scope")) return { rows: [{
        scope: "primary_brand", entity_id: id("8"), entity_label: "Example", aliases: ["Example", "example"]
      }] };
      if (sql.includes("SELECT 'brand_objective' AS kind")) return { rows: [] };
      if (sql.includes("SELECT plan.acquisition_brief")) return { rows: [{ acquisition_brief: {
        languages: ["en"], countries: ["MX"], primary_locale: "en"
      }, timezone: "America/Mexico_City", organization_id: id("9"), brand_id: id("8") }] };
      if (sql.includes("WITH active_profile AS(")) return { rows: [] };
      if (sql.includes("WITH generation AS(")) return { rows: [] };
      if (sql.includes("SELECT id,metadata,status FROM taxonomy_terms")) return { rows: [{
        id: id("10"), metadata: { topic: topicA }, status: "active"
      }] };
      if (sql.includes("SELECT signal_topic_membership_override_digest_v1")) return { rows: [{ digest: sha("8") }] };
      if (sql.includes("FROM signal_topic_membership_overrides")) return { rows: [{ digest: sha("8") }] };
      if (sql.includes("topic_signal_selection selection")) return { rows: [{ native: true, is_processing: false,
        selection: { revision: 1, items: { service: { selected: true, definition_digest: topicA.definition_digest,
          definition_revision: 1, generation_id: generationId } } } }] };
      if (sql.includes("SELECT generation.id,generation.taxonomy_profile_id")) return { rows: [{
        id: generationId, taxonomy_profile_id: profileA, preparation_run_id: id("5"), input_revision: "7",
        current_revision: "7", finalized_digest: sha("f"), policy_live: true,
        source_engine_execution_id: id("6"), interpretation_coverage: null,
        identity: { contract_version: "workspace-topic-classification-v1", workspace_id: workspaceId,
          engine_key: "engine", engine_version: 1, engine_artifact_digest: sha("e"),
          embedding_config_digest: identity!.embedding_config_digest, catalog_digest: identity!.catalog_digest,
          compiler_digest: identity!.compiler_digest, context_digest: identity!.context_digest,
          decision_policy_digest: sha("9") },
        correction_digest: identity!.correction_digest, source_valid: true
      }] };
      if (sql.includes("SELECT id::text,taxonomy_id::text,version,status,context_hash")) return { rows: [
        { id: profileA, taxonomy_id: id("7"), version: 3, status: "active", context_hash: sha("3"),
          created_at: "2026-09-11", updated_at: "2026-09-11", catalog_role: "analysis_materialized", source_catalog_profile_id: null },
        { id: workingProfile, taxonomy_id: id("12"), version: 2, status: "draft", context_hash: sha("2"),
          created_at: "2026-09-11", updated_at: "2026-09-11", catalog_role: "working", source_catalog_profile_id: null }
      ] };
      if (sql.includes("term.metadata->'topic' definition")) {
        topicQueries.push({ sql, params });
        return { rows: [{ definition: params[1] === profileA ? topicA : workingTopicA }] };
      }
      if (sql.includes("topic_roots AS MATERIALIZED")) {
        detailQueries.push({ sql, params });
        return { rows: [{ mention_count: 12, undated_mentions: 2, positive: 3, neutral: 2, negative: 3, unclassified: 4,
          series: [{ date: "2026-09-01", mention_count: 10 }], related: [{ term_key: "not_selected", shared_mentions: 3 }] }] };
      }
      if (sql.includes("WITH source_generation AS MATERIALIZED")) return { rows: [{
        denominator: 12, processed: 12, assigned_unique: 12, abstained: 0, unresolved: 0, withheld: 0,
        rights_digest: sha("7"), date_from: "2026-09-01", date_to: "2026-09-11",
        counts: [{ term_key: "service", mention_count: 12 }], series: [],
        observed_at: "2026-09-11T12:00:00.000001Z"
      }] };
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
    release() {}
  };
  identity = await loadSignalWorkspaceClassificationInputV1({ queryable: client as never, workspace_id: workspaceId,
    actor_user_id: actorId, taxonomy_profile_id: profileA });
  statements.length = 0;
  const overview = await loadSignalWorkspaceTopicsOverviewV1({
    database: { async connect() { return client as never; } }, workspace_id: workspaceId,
    actor_user_id: actorId
  });
  assert.match(statements[0]!, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\s+SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp$/);
  assert.equal(statements.some(statement => statement.startsWith("SET LOCAL")), false);
  assert.match(statements[1]!, /brand_access_level/);
  assert.equal(topicQueries.length, 2);
  assert.equal(topicQueries[0]!.params[1], profileA);
  assert.match(topicQueries[0]!.sql, /id=\$2::uuid/u);
  assert.deepEqual(topicQueries[1]!.params, [workspaceId, workingProfile]);
  assert.equal(overview?.is_current, true);
  assert.deepEqual(overview?.terms.map(term => [term.label, term.definition_revision, term.mention_count]),
    [["Servicio al cliente", 1, 12]]);
  const args = { database: { async connect() { return client as never; } }, workspace_id: workspaceId,
    actor_user_id: actorId, term_key: "service", expected_scope_digest: overview!.scope_digest };
  const detail = await loadSignalWorkspaceTopicDetailV1(args);
  assert.equal(detail.mention_count, 12);
  assert.equal(detail.undated_mentions, 2);
  assert.deepEqual(detail.sentiment, { positive: 3, neutral: 2, negative: 3, unclassified: 4,
    meaning: "evidence_sentiment_not_topic_polarity" });
  assert.deepEqual(detail.series, [{ date: "2026-09-01", mention_count: 10 }]);
  assert.deepEqual(detail.related_topics, []);
  assert.equal(detailQueries.length, 1);
  assert.equal(detailQueries[0]!.params[5], "service");
  assert.match(detailQueries[0]!.sql, /count\(DISTINCT root.root_id\)/);
  assert.match(detailQueries[0]!.sql, /mention.workspace_id=\$1::uuid/);
  assert.match(detailQueries[0]!.sql, /WHERE root.metrics/);
  await assert.rejects(loadSignalWorkspaceTopicDetailV1({ ...args, expected_scope_digest: "stale" }), /workspace_topics_scope_changed/);
  await assert.rejects(loadSignalWorkspaceTopicDetailV1({ ...args, term_key: "unselected" }), /workspace_topics_topic_unavailable/);
  access = false;
  await assert.rejects(loadSignalWorkspaceTopicDetailV1(args), /workspace_topics_forbidden/);
  assert.equal(detailQueries.length, 1, "scope rejection must precede aggregate query");

});

test("batched read-only setup failure rolls back and releases before reading capabilities or data", async () => {
  const statements: string[] = []; let released = 0;
  const client = { async query(sql: string) { statements.push(sql); if (sql.startsWith("BEGIN")) throw new Error("setup_failure"); return { rows: [] }; },
    release() { released++; } };
  await assert.rejects(loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId }), /setup_failure/);
  assert.equal(statements.length, 2); assert.equal(statements[1], "ROLLBACK"); assert.equal(released, 1);
});
