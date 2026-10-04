import assert from "node:assert/strict";
import test from "node:test";
import { signalTopicDefinitionDigestV1 } from "@noisia/query-engine";
import { loadSignalWorkspaceClassificationInputV1 } from "./signal-workspace-classification";
import { loadSignalWorkspaceTopicDetailV1, loadSignalWorkspaceTopicEvidenceV1, loadSignalWorkspaceTopicsOverviewV1,
  prepareSignalWorkspaceDefinedInterestOverlayV1 } from "./signal-workspace-topics-serving";

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
const interestContent = { ...topicAContent, term_key: "activation_consent", label: "Consentimiento de activación",
  definition: "Decisiones de activar Alexa+ tras entender permisos y capacidades." };
const interestTopic = { ...interestContent, definition_revision: 1,
  definition_digest: signalTopicDefinitionDigestV1(interestContent),
  created_at: topicA.created_at, updated_at: topicA.updated_at };
const consolidatedKey = `consolidated_${"c".repeat(64)}`, consolidatedSnapshotId = id("30");
const consolidatedSnapshot = { id: consolidatedSnapshotId, revision_id: id("31"), revision_digest: sha("a"),
  snapshot_digest: sha("b"), source_engine_execution_id: id("32"), preparation_run_id: id("33"),
  input_revision: "7", current_revision: "7", source_valid: true, expected_group_count: 1,
  catalog: [{ concept_key: "consolidated_service", concept_id: id("34"), kind: "topic" as const,
    locale: "es-MX", semantic_identity_digest: sha("c"), term_key: consolidatedKey,
    label: "Servicio", definition: "Conversaciones sobre servicio.", definition_digest: sha("c"), definition_revision: 1,
    created_at: topicA.created_at, updated_at: topicA.updated_at }] };
const consolidatedBinding = { snapshot_id: consolidatedSnapshotId, legacy_generation_id: null,
  binding_revision: 1, selection_revision: 2, operation_id: id("35"), selection: {
    [consolidatedKey]: { selected: true, definition_digest: sha("c"), definition_revision: 1,
      generation_id: consolidatedSnapshotId, semantic_identity_digest: sha("c") }
  } };
test("defined interest overlay requires a distinct durable selection and retains common rights and source fences", () => {
  const selection = { workspace_id: workspaceId, snapshot_id: id("20"), generation_id: id("21"), taxonomy_term_id: id("22"),
    term_key: "activation-consent", definition_digest: sha("a"), definition_revision: 2,
    selected: true as const, selection_revision: 3, selection_digest: sha("b") };
  const args = { selection, workspace_id: workspaceId, snapshot_id: id("20"), existing_term_keys: ["service"] };
  const prepared = prepareSignalWorkspaceDefinedInterestOverlayV1(args);
  assert.deepEqual(prepared.visible_term, { term_key: "activation-consent", definition_digest: sha("a"), definition_revision: 2,
    visible: true, interest_generation_id: id("21"), interest_taxonomy_term_id: id("22") });
  assert.match(prepared.population_sql, /received_imports AS MATERIALIZED/u);
  assert.match(prepared.population_sql, /root_rights AS MATERIALIZED/u);
  assert.match(prepared.population_sql, /period_roots root ON root.root_id=assignment.canonical_root_id AND root.metrics/u);
  assert.match(prepared.population_sql, /interest.status='ready' AND interest.finalized_digest IS NOT NULL/u);
  assert.match(prepared.population_sql, /signal_topic_consolidation_snapshot_current_v1\(snapshot.id\)/u);
  assert.match(prepared.population_sql, /snapshot.input_revision=interest.input_revision/u);
  assert.doesNotMatch(prepared.population_sql, /snapshot.preparation_run_id=interest.preparation_run_id/u);
  assert.match(prepared.population_sql, /assignment.disposition='approved'/u);
  assert.match(prepared.population_sql, /signal_workspace_classification_assignment_current_v1\(assignment,interest\)/u);
  assert.match(prepared.population_sql, /correction.disposition='rejected'/u);
  assert.match(prepared.population_sql, /SELECT DISTINCT ON\(assignment.canonical_root_id,visible.term_key\)/u);
  assert.match(prepared.population_sql, /UNION ALL SELECT root_id,term_key,visible,evidence_fragment FROM defined_interest_memberships/u);
  assert.throws(() => prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args, selection: { ...selection, selected: false as never } }),
    /workspace_defined_interest_selection_invalid/u);
  assert.throws(() => prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args, existing_term_keys: ["activation-consent"] }),
    /workspace_defined_interest_selection_invalid/u);
  assert.throws(() => prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args, snapshot_id: id("23") }),
    /workspace_defined_interest_selection_invalid/u);
  const imported = prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args, snapshot_id: null,
    selection: { ...selection, snapshot_id: null }, existing_term_keys: [] });
  assert.match(imported.population_sql, /FROM received_roots received JOIN mentions mention/u,
    "without a consolidated snapshot the selected interest uses the imported full-corpus root set");
  assert.match(imported.population_sql, /defined_interest_memberships AS MATERIALIZED/u);
  assert.doesNotMatch(imported.population_sql, /JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=\$2::uuid/u);
  const transitioned = prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args,
    selection: { ...selection, snapshot_id: null } });
  assert.match(transitioned.population_sql, /JOIN signal_topic_consolidation_snapshots snapshot ON snapshot.id=\$2::uuid/u,
    "an import-only interest remains composable after discovery activates a snapshot");
  assert.throws(() => prepareSignalWorkspaceDefinedInterestOverlayV1({ ...args, snapshot_id: null }),
    /workspace_defined_interest_selection_invalid/u);
});
const workingTopicA = { ...topicA, label: "Servicio al cliente", definition_revision: 2,
  updated_at: "2026-09-11T11:00:00.000Z" };
test("Signal keeps served semantics while applying a safe working label", async () => {
  const statements: string[] = [];
  const detailQueries: Array<{ sql: string; params: unknown[] }> = [];
  let access = true;
  let selectedInterest = false;
  let interestCurrent = true;
  let semanticDrift = false;
  let importedMode = false;
  let consolidatedMode = false;
  let noOverlap = false;
  let membershipMode = false;
  let facetOptIn = false;
  let membershipCollision = false;
  const topicQueries: Array<{ sql: string; params: unknown[] }> = [];
  let identity: Awaited<ReturnType<typeof loadSignalWorkspaceClassificationInputV1>> | null = null;
  let interestIdentity: Awaited<ReturnType<typeof loadSignalWorkspaceClassificationInputV1>> | null = null;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push(sql);
      if (sql.includes("FROM signal_workspace_features")) return {rows:[{enabled:params[1]==="mention_facets"?facetOptIn:membershipMode}]};
      if (membershipMode && sql.includes("FROM signal_membership_concepts_v1 c LEFT JOIN")) return {rows: [
        {topic:topicA,selected:true,selection_revision:1,selection_digest:sha("a")},
        ...(membershipCollision ? [{topic:interestTopic,selected:false,selection_revision:2,selection_digest:sha("c")}] : [])
      ]};
      if (membershipMode && sql.includes("SELECT context,digest,version_no")) return {rows: []};
      if (membershipMode && sql.includes("WITH labeled_entities AS (")) return {rows: []};
      if (membershipMode && sql.includes("string_agg(jsonb_build_array(root_id,concept_key")) return {rows:[{digest:sha("b")}]};
      if (membershipMode && sql.includes("SELECT s.input_revision::text")) return {rows:[{input_revision:"7",run_id:id("70"),processing:false}]};
      if (sql.includes("SELECT input_snapshot->'discovery_population'->'root_ids' root_ids")) return { rows: [] };
      if (sql.includes("jsonb_typeof(input_snapshot->'discovery_population')='object') discovery")) return { rows: [{ discovery: false }] };
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/u.test(sql)) return { rows: [] };
      if (sql.includes("signal_topic_consolidation_binding_v1")) return { rows: consolidatedMode
        ? [{ binding: consolidatedBinding, snapshot: consolidatedSnapshot }] : [] };
      if (sql.includes("FROM signal_defined_interest_selections selected")) return { rows: selectedInterest ? [{
        workspace_id: workspaceId, snapshot_id: null, generation_id: id("21"), taxonomy_term_id: id("22"),
        term_key: interestTopic.term_key, definition_digest: interestTopic.definition_digest,
        definition_revision: 1, selected: true, selection_revision: 1, selection_digest: sha("2"),
        current: interestCurrent, topic_definition: interestTopic, preparation_run_id: id("23"), finalized_digest: sha("3"),
        taxonomy_profile_id: interestIdentity!.taxonomy_profile_id, correction_digest: interestIdentity!.correction_digest,
        identity: { catalog_digest: semanticDrift ? sha("d") : interestIdentity!.catalog_digest,
          context_digest: interestIdentity!.context_digest,
          compiler_digest: interestIdentity!.compiler_digest,
          embedding_config_digest: interestIdentity!.embedding_config_digest }
      }] : [] };
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
      if (sql.includes("SELECT id,metadata,status FROM taxonomy_terms")) return { rows: [
        { id: id("10"), metadata: { topic: topicA }, status: "active" },
        { id: id("22"), metadata: { topic: interestTopic }, status: "active" }
      ] };
      if (sql.includes("SELECT signal_topic_membership_override_digest_v1")) return { rows: [{ digest: sha("8") }] };
      if (sql.includes("FROM signal_topic_membership_overrides")) return { rows: [{ digest: sha("8") }] };
      if (sql.includes("topic_signal_selection selection")) return { rows: [{ native: true, is_processing: false,
        selection: { revision: 1, items: { service: { selected: true, definition_digest: topicA.definition_digest,
          definition_revision: 1, generation_id: generationId } } } }] };
      if (sql.includes("SELECT generation.id,generation.taxonomy_profile_id")) return { rows: importedMode ? [] : [{
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
      if (sql.includes("FROM import_batches batch JOIN data_sources source") && sql.includes("receipt_digest")) {
        assert.match(sql, /prior.input_snapshot->'source_projection' IS NOT NULL/u,
          "an interest-only ready generation does not suppress the imported corpus fallback");
        return { rows: [{ receipt_digest: sha("4"), input_revision: "7" }] };
      }
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
      if (sql.includes("JOIN signal_interest_decision_root_evidence_v1 decision")) {
        assert.match(sql, /decision\.asset_sha256=mention\.text_clean_sha256/u);
        assert.match(sql, /receipt\.status='settled' AND receipt\.validation_status='accepted'/u);
        assert.match(sql, /assignment\.resolution_method='human' OR \(receipt\.id IS NOT NULL AND cited\.citation IS NOT NULL\)/u,
          "a human correction is shown as such; a model row requires a settled cited receipt");
        assert.match(sql, /ORDER BY \(assignment\.resolution_method='human'\) DESC/u,
          "human overrides take precedence over model decisions");
        assert.match(sql, /root\.evidence/u);
        assert.equal(params[6], interestTopic.term_key);
        assert.equal(params[7], id("21"));
        return { rows: [{ mention_id: id("41"), text: "I did not consent", evidence_fragment: null,
          platform: "reddit", occurred_at: "2026-09-01T12:00:00.000000Z", url: "https://example.com/mention",
          evidence_origin: "model_decision", decision_citation: { role: "supports", output_digest: sha("a"), decision_digest: sha("b"),
            chunk_index: 0, quote_start: 0, quote_end: 17, chunk_sha256: sha("c") } },
          { mention_id: id("42"), text: "Original text after human correction", evidence_fragment: null,
            platform: "reddit", occurred_at: "2026-09-01T13:00:00.000000Z", url: "https://example.com/corrected",
            evidence_origin: "human_correction", decision_citation: null }] };
      }
      if (sql.includes("WITH source_generation AS MATERIALIZED")) return { rows: [{
        ...(membershipMode ? {membership_population:{relevant:6,unrelated:3,spam:1,unknown:2,without_concept:4}} : {}),
        denominator: 12, processed: 12, assigned_unique: noOverlap ? 9 : importedMode ? 3 : 12,
        interest_processed: importedMode ? 10 : undefined, evidence_visible_total: 10,
        abstained: 0, noise: 0, unresolved: 0, unresolved_exclusive: 0, withheld: 0,
        rights_digest: sha("7"), date_from: "2026-09-01", date_to: "2026-09-11",
        counts: [...(importedMode ? [] : [{ term_key: consolidatedMode ? consolidatedKey : "service", mention_count: 12 }]),
          ...(selectedInterest && !noOverlap ? [{ term_key: interestTopic.term_key, mention_count: 3 }] : [])], series: [],
        observed_at: "2026-09-11T12:00:00.000001Z"
      }] };
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
    release() {}
  };
  identity = await loadSignalWorkspaceClassificationInputV1({ queryable: client as never, workspace_id: workspaceId,
    actor_user_id: actorId, taxonomy_profile_id: profileA });
  interestIdentity = await loadSignalWorkspaceClassificationInputV1({ queryable: client as never, workspace_id: workspaceId,
    actor_user_id: actorId, interest_term_key: interestTopic.term_key });
  statements.length = 0;
  const overview = await loadSignalWorkspaceTopicsOverviewV1({
    database: { async connect() { return client as never; } }, workspace_id: workspaceId,
    actor_user_id: actorId, timezone: "America/Mexico_City"
  });
  assert.match(statements[0]!, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\s+SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,extensions,pg_temp;\s+SET LOCAL enable_nestloop=off; SET LOCAL jit=off$/);
  assert.equal(statements.some(statement => statement.startsWith("SET LOCAL")), false);
  assert.match(statements[1]!, /brand_access_level/);
  assert.equal(topicQueries.length, 2);
  assert.equal(topicQueries[0]!.params[1], profileA);
  assert.match(topicQueries[0]!.sql, /id=\$2::uuid/u);
  assert.deepEqual(topicQueries[1]!.params, [workspaceId, workingProfile]);
  assert.equal(overview?.is_current, true);
  assert.equal(statements.some(statement => statement.includes("defined_interest_memberships")), false,
    "without durable selection the ordinary Signal path cannot expose interests");
  assert.equal(overview?.filters.timezone, "America/Mexico_City");
  assert.deepEqual(overview?.terms.map(term => [term.label, term.definition_revision, term.mention_count]),
    [["Servicio al cliente", 1, 12]]);
  assert.equal(overview?.terms[0]?.kind, "topic"); assert.equal(overview?.coverage.noise, null);
  const args = { database: { async connect() { return client as never; } }, workspace_id: workspaceId,
    actor_user_id: actorId, timezone: "America/Mexico_City", term_key: "service", expected_scope_digest: overview!.scope_digest };
  const detail = await loadSignalWorkspaceTopicDetailV1(args);
  assert.equal(detail.kind, "topic");
  assert.equal(detail.mention_count, 12);
  assert.equal(detail.undated_mentions, 2);
  assert.deepEqual(detail.sentiment, { positive: 3, neutral: 2, negative: 3, unclassified: 4,
    meaning: "evidence_sentiment_not_topic_polarity" });
  assert.deepEqual(detail.series, [{ date: "2026-09-01", mention_count: 10 }]);
  assert.deepEqual(detail.related_topics, []);
  assert.equal(detailQueries.length, 1);
  assert.equal(detailQueries[0]!.params[4], "America/Mexico_City");
  assert.equal(detailQueries[0]!.params[6], "service");
  assert.match(detailQueries[0]!.sql, /count\(DISTINCT root.root_id\)/);
  assert.match(detailQueries[0]!.sql, /mention.workspace_id=\$1::uuid/);
  assert.match(detailQueries[0]!.sql, /WHERE root.metrics/);
  assert.match(detailQueries[0]!.sql, /published_at>=\(\$3::date::timestamp AT TIME ZONE \$5::text\)/u);
  assert.match(detailQueries[0]!.sql, /published_at<\(\(\$4::date\+1\)::timestamp AT TIME ZONE \$5::text\)/u);
  selectedInterest = true;
  const withInterest = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
  const defined = withInterest?.terms.find(term => term.term_key === interestTopic.term_key);
  assert.equal(defined?.basis, "defined_interest"); assert.equal(defined?.mention_count, 3);
  assert.equal(defined?.evidence_available, true); assert.equal(defined?.interest_generation_id, id("21"));
  assert.equal(withInterest?.terms.find(term => term.term_key === "service")?.mention_count, 12);
  assert.ok(statements.some(statement => statement.includes("defined_interest_memberships AS MATERIALIZED")));
  const interestDetail = await loadSignalWorkspaceTopicDetailV1({ ...args, term_key: interestTopic.term_key,
    expected_scope_digest: withInterest!.scope_digest });
  assert.equal(interestDetail.generation_id, id("21"));
  const cited = await loadSignalWorkspaceTopicEvidenceV1({ ...args, term_key: interestTopic.term_key,
    expected_scope_digest: withInterest!.scope_digest });
  assert.equal(cited.generation_id, id("21"));
  assert.deepEqual(cited.items.map(item => [item.text, item.evidence_origin, item.decision_citation?.role]),
    [["I did not consent", "model_decision", "supports"],
      ["Original text after human correction", "human_correction", undefined]]);
  interestCurrent = false;
  const revoked = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId });
  assert.equal(revoked?.terms.some(term => term.term_key === interestTopic.term_key), false,
    "revoked approval or rights makes the stored selection unservable");
  interestCurrent = true; semanticDrift = true;
  const changed = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId });
  assert.equal(changed?.terms.some(term => term.term_key === interestTopic.term_key), false,
    "a changed model, definition, or Brand OS input invalidates the old selection");
  semanticDrift = false;
  importedMode = true;
  const interestOnly = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City", imported_fallback: true });
  assert.equal(interestOnly?.source, "workspace_defined_interest");
  if (interestOnly?.source !== "workspace_defined_interest") throw new Error("interest-only source missing");
  assert.deepEqual(interestOnly.interest_generation_ids, [id("21")]);
  assert.equal(interestOnly.generation_id, null);
  assert.equal(interestOnly.coverage.processed, 10); assert.equal(interestOnly.coverage.assigned_unique, 3);
  assert.equal(interestOnly.coverage.abstained, null);
  assert.equal(interestOnly.terms[0]?.basis, "defined_interest");
  assert.equal(interestOnly.terms[0]?.mention_count, 3);
  const importedDetail = await loadSignalWorkspaceTopicDetailV1({ ...args, imported_fallback: true,
    term_key: interestTopic.term_key, expected_scope_digest: interestOnly.scope_digest });
  assert.equal(importedDetail.generation_id, id("21"));
  const importedCitation = await loadSignalWorkspaceTopicEvidenceV1({ ...args, imported_fallback: true,
    term_key: interestTopic.term_key, expected_scope_digest: interestOnly.scope_digest });
  assert.equal(importedCitation.items[0]?.decision_citation?.output_digest, sha("a"));
  importedMode = false;
  consolidatedMode = true;
  const afterDiscovery = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
  const previousFacetsFlag = process.env.NOISIA_MENTION_FACETS_ENABLED;
  const previousMembershipFlag = process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
  try {
    process.env.NOISIA_MENTION_FACETS_ENABLED = "true";
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = "true";
    const withoutOptIn = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
      workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
    assert.deepEqual(withoutOptIn, afterDiscovery, "workspace without MFP keeps the exact Signal response with both flags enabled");
    facetOptIn = true;
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = "false";
    process.env.NOISIA_MENTION_FACETS_ENABLED = "false";
    const offStart = statements.length;
    const killed = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
      workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
    assert.deepEqual(killed, afterDiscovery, "kill switch preserves legacy Signal even with durable opt-in");
    const offSql = statements.slice(offStart).find(statement => statement.includes("WITH source_generation AS MATERIALIZED"))!;
    assert.match(offSql,/FROM \(SELECT s\.id snapshot_id/su);
    assert.doesNotMatch(offSql,/FROM signal_topic_consolidation_snapshot_roots_v1 item/u);
    assert.doesNotMatch(offSql,/LEFT JOIN signal_mention_facets_current_v1 f/u);
    const offDetail = await loadSignalWorkspaceTopicDetailV1({ ...args, term_key: interestTopic.term_key,
      expected_scope_digest: killed!.scope_digest });
    assert.equal(offDetail.generation_id,id("21"));
    const offEvidence = await loadSignalWorkspaceTopicEvidenceV1({ ...args, term_key: interestTopic.term_key,
      expected_scope_digest: killed!.scope_digest });
    assert.ok(offEvidence.items.length>0);
    for(const statement of statements.slice(offStart).filter(statement=>statement.includes("WITH source_generation AS MATERIALIZED"))) {
      assert.doesNotMatch(statement,/FROM signal_topic_consolidation_snapshot_roots_v1 item/u);
      assert.doesNotMatch(statement,/LEFT JOIN signal_mention_facets_current_v1 f/u);
    }
    process.env.NOISIA_MENTION_FACETS_ENABLED = "true";
    const onStart = statements.length;
    await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
      workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
    const onSql = statements.slice(onStart).find(statement => statement.includes("WITH source_generation AS MATERIALIZED"))!;
    assert.match(onSql,/FROM signal_topic_consolidation_snapshot_roots_v1 item/u);
    facetOptIn = false;
  } finally {
    if (previousFacetsFlag === undefined) delete process.env.NOISIA_MENTION_FACETS_ENABLED;
    else process.env.NOISIA_MENTION_FACETS_ENABLED = previousFacetsFlag;
    if (previousMembershipFlag === undefined) delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
    else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = previousMembershipFlag;
  }
  assert.equal(afterDiscovery?.generation_id, consolidatedSnapshotId);
  assert.equal(afterDiscovery?.terms.find(term => term.term_key === interestTopic.term_key)?.basis, "defined_interest");
  assert.equal(afterDiscovery?.terms.find(term => term.term_key === consolidatedKey)?.basis, "computed_cluster");
  assert.equal(afterDiscovery?.terms.find(term => term.term_key === interestTopic.term_key)?.mention_count, 3);
  assert.equal(afterDiscovery?.denominator, 12);
  assert.ok(statements.some(statement => statement.includes("defined_interest_memberships AS MATERIALIZED")
    && statement.includes("snapshot.input_revision=interest.input_revision")));
  const consolidatedDetail = await loadSignalWorkspaceTopicDetailV1({ ...args, term_key: interestTopic.term_key,
    expected_scope_digest: afterDiscovery!.scope_digest });
  assert.equal(consolidatedDetail.generation_id, id("21"));
  const consolidatedCitation = await loadSignalWorkspaceTopicEvidenceV1({ ...args, term_key: interestTopic.term_key,
    expected_scope_digest: afterDiscovery!.scope_digest });
  assert.equal(consolidatedCitation.items[0]?.decision_citation?.role, "supports");
  noOverlap = true;
  const zeroOverlap = await loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId, timezone: "America/Mexico_City" });
  assert.equal(zeroOverlap?.terms.find(term => term.term_key === interestTopic.term_key)?.selected, true);
  assert.equal(zeroOverlap?.terms.find(term => term.term_key === interestTopic.term_key)?.mention_count, 0,
    "an interest remains selected after consolidation even when no roots intersect its snapshot");
  noOverlap = false;
  consolidatedMode = false;
  selectedInterest = false;
  await assert.rejects(loadSignalWorkspaceTopicDetailV1({ ...args, expected_scope_digest: "stale" }), /workspace_topics_scope_changed/);
  await assert.rejects(loadSignalWorkspaceTopicDetailV1({ ...args, term_key: "unselected" }), /workspace_topics_topic_unavailable/);
  await assert.rejects(loadSignalWorkspaceTopicDetailV1({ ...args, kind: "narrative" }), /workspace_topics_topic_unavailable/,
    "a topic key cannot be served through the narrative endpoint");
  await assert.rejects(loadSignalWorkspaceTopicEvidenceV1({ ...args, kind: "narrative" }), /workspace_topics_topic_unavailable/,
    "evidence kind must match the selected catalogue term");
  const previousFlag = process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
  try {
    process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = "true";
    membershipMode = true; consolidatedMode = true;
    const mfp = await loadSignalWorkspaceTopicsOverviewV1({database: args.database,workspace_id:workspaceId,actor_user_id:actorId});
    assert.equal(mfp?.terms.find(t => t.term_key === "service")?.basis, "concept_membership");
    assert.equal(mfp?.terms.find(t => t.term_key === consolidatedKey)?.basis, "computed_cluster");
    assert.deepEqual(mfp?.membership_population, {relevant:6,unrelated:3,spam:1,unknown:2,without_concept:4});
    assert.equal(mfp?.coverage.noise, 0, "editorial Noise remains visible independently of unrelated facets");
    selectedInterest = true; membershipCollision = true;
    const additiveStart = statements.length;
    const additive = await loadSignalWorkspaceTopicsOverviewV1({database:args.database,workspace_id:workspaceId,actor_user_id:actorId});
    assert.equal(additive?.terms.find(t=>t.term_key===interestTopic.term_key)?.basis,"defined_interest");
    assert.equal(additive?.terms.find(t=>t.term_key===interestTopic.term_key)?.mention_count,3);
    assert.equal(additive?.terms.find(t=>t.term_key===interestTopic.term_key)?.selected,true,
      "an MFP selection cannot displace an existing defined-interest selection");
    const additiveSql = statements.slice(additiveStart).find(statement=>statement.includes("WITH source_generation AS MATERIALIZED"))!;
    assert.match(additiveSql,/UNION ALL SELECT root_id,term_key,visible,evidence_fragment FROM defined_interest_memberships/u);
    assert.match(additiveSql,/UNION ALL SELECT current.root_id,current.concept_key/u);
    assert.match(additiveSql,/AND visible.membership_concept/u);
    assert.doesNotMatch(additiveSql,/signal_membership_concepts_v1 adopted/u,
      "adoption must not remove the published consolidated memberships");
    membershipCollision = false;
    selectedInterest = false;
    consolidatedMode = false;
    const noDiscovery = await loadSignalWorkspaceTopicsOverviewV1({database:args.database,workspace_id:workspaceId,actor_user_id:actorId});
    assert.equal(noDiscovery?.generation_id, generationId, "MFP preserves the existing generation without consolidation");
    assert.equal(noDiscovery?.terms.find(t=>t.term_key==="service")?.basis, "computed_cluster");
    assert.equal(noDiscovery?.terms.find(t=>t.term_key==="service")?.selected, true);
    importedMode = true; selectedInterest = true;
    const importOnly = await loadSignalWorkspaceTopicsOverviewV1({database:args.database,workspace_id:workspaceId,actor_user_id:actorId});
    assert.equal(importOnly?.generation_id, null);
    assert.equal(importOnly?.terms.find(t=>t.term_key==="service")?.basis, "concept_membership");
    assert.equal(importOnly?.terms.find(t=>t.term_key===interestTopic.term_key)?.basis, "defined_interest");
    assert.equal(importOnly?.coverage.noise, null);
    importedMode = false; selectedInterest = false;
  } finally {
    membershipMode = false; consolidatedMode = false;
    if (previousFlag === undefined) delete process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED;
    else process.env.NOISIA_CONCEPT_MEMBERSHIP_ENABLED = previousFlag;
  }
  access = false;
  const authorizedDetailQueries=detailQueries.length;
  await assert.rejects(loadSignalWorkspaceTopicDetailV1(args), /workspace_topics_forbidden/);
  assert.equal(detailQueries.length, authorizedDetailQueries, "scope rejection must precede another aggregate query");

});

test("batched read-only setup failure rolls back and releases before reading capabilities or data", async () => {
  const statements: string[] = []; let released = 0;
  const client = { async query(sql: string) { statements.push(sql); if (sql.startsWith("BEGIN")) throw new Error("setup_failure"); return { rows: [] }; },
    release() { released++; } };
  await assert.rejects(loadSignalWorkspaceTopicsOverviewV1({ database: { async connect() { return client as never; } },
    workspace_id: workspaceId, actor_user_id: actorId }), /setup_failure/);
  assert.equal(statements.length, 2); assert.equal(statements[1], "ROLLBACK"); assert.equal(released, 1);
});
