import { createHash } from "node:crypto";

import {
  SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,
  assertSignalGovernedPolicyViewContractV1,
  compileSignalPopulationPolicyBundleV1,
  signalGovernedViewCompilationPlanHashV1,
  signalPopulationPolicyDefinitionHashV1,
  validateSignalPopulationPolicyBundleDefinitionV1,
  type SignalPolicyEntityReferenceV1,
  type SignalPopulationPolicyBundleDefinitionV1
} from "@noisia/query-engine";

import { evaluateSignalViewDataGovernanceV1 } from "@/lib/data-os/signal-data-governance";
import type { SignalBrandPolicyQueryable } from "@/lib/data-os/signal-governed-brand-policy";
import type { ResolvedSignalWorkspace, SignalWorkspaceUser } from "@/lib/data-os/signal-workspace";

const EMPTY_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const POLICY_KEY = "triggers-barriers-strategic-governed";
const POLICY_VERSION = 1;

export type StrategicAuthorityResultV1 = {
  policy_bundle_id: string;
  policy_definition_hash: string;
  compiled_plan_hash: string;
  base_population_id: string;
  population_id: string;
  population_version: number;
  population_definition_hash: string;
  membership_count: number;
  membership_digest: string;
  governance_evaluation_id: string;
  governance_digest: string;
  governance_unknown_count: 0;
  policy_compilation_id: string;
  binding_id: string | null;
  next_policy_transition_at: string;
  created: {
    bundle: boolean;
    derivation: boolean;
    compilation: boolean;
    binding: boolean;
    watermarks: number;
  };
};

export async function ensureSignalStrategicGovernedAuthorityV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
  promoteBinding?: boolean;
}): Promise<StrategicAuthorityResultV1> {
  assertServerAuthority(args.workspace, args.actor);
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${args.workspace.id}:triggers-barriers:strategic:authority`
  ]);
  await assertPersistedAuthority(args);

  const quality = await loadExactQualityAuthority(args.queryable, args.workspace.id);
  const entities = await loadStrategicEntities(args.queryable, args.workspace);
  const definition = buildStrategicDefinition(args.workspace, quality, entities);
  const definitionHash = signalPopulationPolicyDefinitionHashV1(definition);
  const bundle = await ensureStrategicBundle({ ...args, definition, definitionHash });

  const base = await args.queryable.query<{
    population_id: string;
    membership_count: number;
    membership_digest: string;
  }>(`
    SELECT population_id::text,membership_count,membership_digest
    FROM reconcile_signal_operational_attributable_semantic_base_v1($1::uuid,$2::uuid)
  `, [args.workspace.id, args.actor.id]);
  const neutralBase = base.rows[0];
  if (!neutralBase || neutralBase.membership_count < 1) {
    throw new Error("Strategic neutral semantic base is unavailable.");
  }

  const compiled = compileSignalPopulationPolicyBundleV1({
    policy_bundle_id: bundle.id,
    definition_hash: definitionHash,
    definition
  });
  if (compiled.readiness.status !== "ready") {
    throw new Error(`Strategic bundle is blocked: ${compiled.readiness.blocking_reasons.join(",")}`);
  }
  const compiledPlanHash = signalGovernedViewCompilationPlanHashV1({
    base_plan_hash: compiled.plan_hash,
    module_key: "triggers-barriers",
    view_key: "strategic",
    authorized_modules: definition.authorized_modules,
    capability_usage_purposes: definition.required_usage_purposes
  });
  const derived = await args.queryable.query<{
    resolved_population_id: string;
    population_definition_hash: string;
    created: boolean;
  }>(`
    SELECT resolved_population_id::text,population_definition_hash,created
    FROM ensure_signal_strategic_population_derivation_v1(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid
    )
  `, [args.workspace.id,bundle.id,neutralBase.population_id,definitionHash,compiledPlanHash,args.actor.id]);
  const derivation = derived.rows[0];
  if (!derivation) throw new Error("Strategic population derivation is unavailable.");

  let governance = await evaluateSignalViewDataGovernanceV1({
    queryable: args.queryable,workspaceId: args.workspace.id,policyBundleId: bundle.id,
    populationId: derivation.resolved_population_id,actor: args.actor,
    moduleKey: "triggers-barriers",viewKey: "strategic",reconcileMemberships: true
  });
  const watermarksCreated = await ensureStrategicWatermarks({
    queryable: args.queryable,workspaceId: args.workspace.id,
    populationId: derivation.resolved_population_id,evaluationId: governance.evaluation_id
  });
  governance = await evaluateSignalViewDataGovernanceV1({
    queryable: args.queryable,workspaceId: args.workspace.id,policyBundleId: bundle.id,
    populationId: derivation.resolved_population_id,actor: args.actor,
    moduleKey: "triggers-barriers",viewKey: "strategic",reconcileMemberships: true
  });
  if (governance.governance_unknown_count !== 0 || governance.authorized_root_count < 1
    || !governance.governance_data_watermark_id || !governance.next_policy_transition_at) {
    throw new Error("Strategic governance is incomplete or has no bounded validity.");
  }

  await args.queryable.query(`
    UPDATE signal_population_policy_bundles SET
      status='active',activated_by_user_id=COALESCE(activated_by_user_id,$2::uuid),
      activated_at=COALESCE(activated_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE id=$1::uuid AND workspace_id=$3::uuid AND status='draft'
  `, [bundle.id,args.actor.id,args.workspace.id]);

  const state = await loadStrategicPopulationState(
    args.queryable,args.workspace.id,derivation.resolved_population_id
  );
  if (state.membership_count !== governance.authorized_root_count
    || state.alias_membership_count !== 0 || state.membership_digest !== state.actual_digest) {
    throw new Error("Strategic population does not exactly match its governance evaluation.");
  }
  const compilation = await ensureStrategicCompilation({
    queryable: args.queryable,workspaceId: args.workspace.id,actorId: args.actor.id,
    bundleId: bundle.id,populationId: derivation.resolved_population_id,
    populationVersion: state.population_version,populationDefinitionHash: state.definition_hash,
    policyDefinitionHash: definitionHash,compiledPlanHash,membershipDigest: state.membership_digest,
    sourceWatermarkHash: state.source_watermark_hash,sourceWatermarkAt: state.source_watermark_at,
    governance
  });
  const priorBinding = await args.queryable.query<{ id: string }>(`
    SELECT id::text FROM signal_governed_view_bindings
    WHERE workspace_id=$1::uuid AND module_key='triggers-barriers' AND view_key='strategic'
      AND binding_status='current'
  `, [args.workspace.id]);
  let bindingId = priorBinding.rows[0]?.id ?? null;
  if (args.promoteBinding !== false) {
    const bindingKey = sha256([
      "signal-strategic-binding-v1",args.workspace.id,bundle.id,
      derivation.resolved_population_id,args.idempotencyKey
    ].join("\u001f"));
    const promoted = await args.queryable.query<{ binding_id: string }>(`
      SELECT promote_signal_governed_view_binding(
        $1::uuid,'triggers-barriers','strategic',$2::uuid,$3::uuid,$4::uuid,'promote',$5
      )::text AS binding_id
    `, [args.workspace.id,bundle.id,derivation.resolved_population_id,args.actor.id,bindingKey]);
    bindingId = promoted.rows[0]?.binding_id ?? null;
    if (!bindingId) throw new Error("Strategic binding promotion did not return an identity.");
  }

  return {
    policy_bundle_id: bundle.id,policy_definition_hash: definitionHash,
    compiled_plan_hash: compiledPlanHash,base_population_id: neutralBase.population_id,
    population_id: derivation.resolved_population_id,population_version: state.population_version,
    population_definition_hash: state.definition_hash,membership_count: state.membership_count,
    membership_digest: state.membership_digest,governance_evaluation_id: governance.evaluation_id,
    governance_digest: governance.governance_digest,governance_unknown_count: 0,
    policy_compilation_id: compilation.id,binding_id: bindingId,
    next_policy_transition_at: governance.next_policy_transition_at,
    created: { bundle: bundle.created,derivation: derivation.created,
      compilation: compilation.created,binding: args.promoteBinding !== false && priorBinding.rowCount === 0,
      watermarks: watermarksCreated }
  };
}

export async function ensureSignalStrategicExecutionCorpusV1(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
  idempotencyKey: string;
}) {
  assertServerAuthority(args.workspace, args.actor);
  await assertPersistedAuthority(args);
  await args.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${args.workspace.id}:triggers-barriers:strategic:execution-corpus`
  ]);
  const existing = await args.queryable.query<{ id: string }>(`
    SELECT corpus.id::text
    FROM signal_workspace_corpora membership
    JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
    JOIN methodologies methodology ON methodology.id=corpus.methodology_id
    WHERE membership.workspace_id=$1::uuid AND membership.role='strategic'
      AND membership.valid_to IS NULL AND methodology.slug='triggers-barriers'
      AND corpus.analysis_plan->>'contract_version'='signal-tb-execution-corpus-v1'
      AND corpus.analysis_plan->>'server_owned_identity'='triggers-barriers/strategic'
    FOR UPDATE OF corpus,membership
  `, [args.workspace.id]);
  if (existing.rows.length > 1) throw new Error("Strategic execution corpus identity is ambiguous.");
  if (existing.rows[0]) return { created: false, execution_corpus_id: existing.rows[0].id };
  const authority = await args.queryable.query<{
    brand_name: string; methodology_id: string; methodology_version: string;
  }>(`
    SELECT brand.name AS brand_name,methodology.id::text AS methodology_id,
      methodology.version AS methodology_version
    FROM signal_workspaces workspace
    JOIN brands brand ON brand.id=workspace.brand_id
    CROSS JOIN LATERAL (
      SELECT id,version FROM methodologies
      WHERE slug='triggers-barriers' AND status='active'
      ORDER BY created_at DESC,id LIMIT 1
    ) methodology
    WHERE workspace.id=$1::uuid AND workspace.brand_id=$2::uuid
  `, [args.workspace.id,args.workspace.subject.id]);
  if (authority.rows.length !== 1) throw new Error("Active Triggers & Barriers methodology is unavailable.");
  const row = authority.rows[0]!;
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO study_corpora (
      name,brand_id,methodology_id,methodology_version_at_creation,status,
      current_pipeline_version,corpus_revision,analysis_plan
    ) VALUES (
      $1,$2::uuid,$3::uuid,$4,'corpus_approved','tb-engine-2026.05.25',1,
      jsonb_build_object('version',1,'contract_version','signal-tb-execution-corpus-v1',
        'server_owned_identity','triggers-barriers/strategic',
        'primary_methodology_slug','triggers-barriers',
        'selected_lenses',jsonb_build_array('triggers-barriers'),
        'lens_configs','{}'::jsonb,'composer_modules','[]'::jsonb,
        'created_by_user_id',$5::text,'idempotency_key_hash',$6::text)
    ) RETURNING id::text
  `, [`${row.brand_name} strategic execution corpus`,args.workspace.subject.id,
    row.methodology_id,row.methodology_version,args.actor.id,sha256(args.idempotencyKey)]);
  const corpusId = inserted.rows[0]!.id;
  const membership = await args.queryable.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM signal_workspace_corpora
    WHERE workspace_id=$1::uuid AND study_corpus_id=$2::uuid
      AND role='strategic' AND valid_to IS NULL
  `, [args.workspace.id,corpusId]);
  if (membership.rows[0]?.count !== 1) throw new Error("Strategic execution corpus membership was not created.");
  return { created: true, execution_corpus_id: corpusId };
}

function assertServerAuthority(workspace: ResolvedSignalWorkspace, actor: SignalWorkspaceUser) {
  if (workspace.status !== "active" || workspace.subject.type !== "brand"
    || actor.userType !== "noisia_internal") {
    throw new Error("Strategic authority requires an active brand workspace and internal actor.");
  }
}

async function assertPersistedAuthority(args: {
  queryable: SignalBrandPolicyQueryable;
  workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;
}) {
  const result = await args.queryable.query<{ allowed: boolean }>(`
    SELECT workspace.organization_id=$2::uuid AND workspace.brand_id=$3::uuid
      AND workspace.status='active'
      AND signal_data_governance_actor_is_valid(workspace.id,$4::uuid) AS allowed
    FROM signal_workspaces workspace WHERE workspace.id=$1::uuid
  `, [args.workspace.id,args.workspace.organizationId,args.workspace.subject.id,args.actor.id]);
  if (result.rows[0]?.allowed !== true) throw new Error("Strategic authority is cross-workspace or unauthorized.");
}

async function loadExactQualityAuthority(queryable: SignalBrandPolicyQueryable, workspaceId: string) {
  const result = await queryable.query<{
    id: string;policy_key: string;policy_version: number;min_quality_score: number | null;
    required_quality_flags: string[];forbidden_quality_flags: string[];
  }>(`
    WITH contributing AS (
      SELECT DISTINCT binding.quality_policy_id
      FROM signal_provenance_policy_bindings binding
      WHERE binding.workspace_id=$1::uuid AND binding.status='active'
        AND binding.effective_from<=clock_timestamp()
        AND (binding.effective_to IS NULL OR binding.effective_to>clock_timestamp())
    ) SELECT quality.id::text,quality.policy_key,quality.policy_version,
      quality.min_quality_score,quality.required_quality_flags,quality.forbidden_quality_flags
    FROM contributing JOIN signal_quality_policies quality ON quality.id=contributing.quality_policy_id
    WHERE quality.workspace_id=$1::uuid AND quality.status='active'
      AND quality.canonical_root_disposition='evaluate'
      AND quality.effective_from<=clock_timestamp()
      AND (quality.effective_to IS NULL OR quality.effective_to>clock_timestamp())
  `, [workspaceId]);
  if (result.rows.length !== 1) throw new Error("Strategic quality authority is unavailable or ambiguous.");
  return result.rows[0]!;
}

async function loadStrategicEntities(
  queryable: SignalBrandPolicyQueryable,workspace: ResolvedSignalWorkspace
): Promise<SignalPolicyEntityReferenceV1[]> {
  const result = await queryable.query<SignalPolicyEntityReferenceV1>(`
    SELECT governed.scope,governed.entity_type,governed.entity_id::text FROM (
      SELECT 'primary_brand'::text AS scope,'brand'::text AS entity_type,workspace.brand_id AS entity_id
      FROM signal_workspaces workspace WHERE workspace.id=$1::uuid AND workspace.brand_id=$2::uuid
      UNION ALL
      SELECT 'competitor','competitor',competitor.id FROM competitors competitor
      JOIN brand_seeds seed ON seed.id=competitor.competitor_brand_seed_id AND seed.active=true
      WHERE competitor.brand_id=$2::uuid AND competitor.status='current'
      UNION ALL
      SELECT 'category','category',entity.id FROM intelligence_entities entity
      WHERE entity.organization_id=$3::uuid AND entity.brand_id=$2::uuid
        AND entity.entity_type='category' AND entity.status='active'
    ) governed ORDER BY governed.scope,governed.entity_type,governed.entity_id
  `, [workspace.id,workspace.subject.id,workspace.organizationId]);
  const scopes = new Set(result.rows.map((entity) => entity.scope));
  if (!["primary_brand","competitor","category"].every((scope) => scopes.has(scope as never))) {
    throw new Error("Strategic entity registry is incomplete.");
  }
  return result.rows;
}

function buildStrategicDefinition(
  workspace: ResolvedSignalWorkspace,
  quality: Awaited<ReturnType<typeof loadExactQualityAuthority>>,
  entities: SignalPolicyEntityReferenceV1[]
): SignalPopulationPolicyBundleDefinitionV1 {
  const definition = validateSignalPopulationPolicyBundleDefinitionV1({
    contract_version: SIGNAL_GOVERNED_VIEWS_CONTRACT_VERSION,workspace_id: workspace.id,
    policy_key: POLICY_KEY,policy_version: POLICY_VERSION,authorized_modules: ["triggers-barriers"],
    allowed_scopes: ["primary_brand","competitor","category"],allowed_entities: entities,
    acceptance_status: "included",quality_contract_status: "resolved",
    quality_policy_key: quality.policy_key,quality_policy_version: quality.policy_version,
    min_quality_score: quality.min_quality_score,required_quality_flags: quality.required_quality_flags,
    forbidden_quality_flags: quality.forbidden_quality_flags,
    eligibility_policy: "semantic-approved-eligible",deduplication_policy: "canonical-root",
    visibility_class: "strategic-internal",denominator_key: "eligible-canonical-roots",
    period_start: null,period_end: null,timezone: null,
    retention_policy_ref: "provenance-bound-retention",
    licensing_policy_ref: "provenance-bound-licensing",data_governance_contract_status: "resolved",
    quality_policy_id: quality.id,required_usage_purposes: ["llm-processing","strategic-analysis"]
  });
  assertSignalGovernedPolicyViewContractV1("triggers-barriers","strategic",definition);
  return definition;
}

async function ensureStrategicBundle(args: {
  queryable: SignalBrandPolicyQueryable;workspace: ResolvedSignalWorkspace;
  actor: SignalWorkspaceUser;definition: SignalPopulationPolicyBundleDefinitionV1;
  definitionHash: string;idempotencyKey: string;
}) {
  const existing = await args.queryable.query<{ id: string;status: string;definition_hash: string;entities: unknown }>(`
    SELECT bundle.id::text,bundle.status,bundle.definition_hash,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',entity.scope,'entity_type',entity.entity_type,
        'entity_id',entity.entity_id::text) ORDER BY entity.scope,entity.entity_type,entity.entity_id)
        FROM signal_population_policy_entities entity WHERE entity.policy_bundle_id=bundle.id),'[]'::jsonb) AS entities
    FROM signal_population_policy_bundles bundle
    WHERE bundle.workspace_id=$1::uuid AND bundle.policy_key=$2 AND bundle.policy_version=$3
    FOR UPDATE
  `, [args.workspace.id,POLICY_KEY,POLICY_VERSION]);
  if (existing.rows.length > 1) throw new Error("Strategic bundle identity is ambiguous.");
  const persisted = existing.rows[0];
  if (persisted) {
    if (!['draft','active'].includes(persisted.status) || persisted.definition_hash !== args.definitionHash
      || stableJson(persisted.entities) !== stableJson(args.definition.allowed_entities)) {
      throw new Error("Existing strategic bundle is incompatible with the server-owned registry.");
    }
    return { id: persisted.id,created: false };
  }
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO signal_population_policy_bundles (
      workspace_id,policy_key,policy_version,status,authorized_modules,allowed_scopes,
      acceptance_status,quality_contract_status,quality_policy_key,quality_policy_version,
      min_quality_score,required_quality_flags,forbidden_quality_flags,eligibility_policy,
      deduplication_policy,visibility_class,denominator_key,period_start,period_end,timezone,
      retention_policy_ref,licensing_policy_ref,data_governance_contract_status,
      quality_policy_id,required_usage_purposes,definition_hash,created_by_user_id
    ) VALUES ($1::uuid,$2,$3,'draft',$4::text[],$5::text[],$6,$7,$8,$9,$10,$11::text[],
      $12::text[],$13,$14,$15,$16,$17::date,$18::date,$19,$20,$21,$22,$23::uuid,$24::text[],$25,$26::uuid)
    RETURNING id::text
  `, [args.workspace.id,args.definition.policy_key,args.definition.policy_version,
    args.definition.authorized_modules,args.definition.allowed_scopes,args.definition.acceptance_status,
    args.definition.quality_contract_status,args.definition.quality_policy_key,
    args.definition.quality_policy_version,args.definition.min_quality_score,
    args.definition.required_quality_flags,args.definition.forbidden_quality_flags,
    args.definition.eligibility_policy,args.definition.deduplication_policy,
    args.definition.visibility_class,args.definition.denominator_key,args.definition.period_start,
    args.definition.period_end,args.definition.timezone,args.definition.retention_policy_ref,
    args.definition.licensing_policy_ref,args.definition.data_governance_contract_status,
    args.definition.quality_policy_id,args.definition.required_usage_purposes,
    args.definitionHash,args.actor.id]);
  const id = inserted.rows[0]!.id;
  for (const entity of args.definition.allowed_entities) {
    await args.queryable.query(`INSERT INTO signal_population_policy_entities (
      workspace_id,policy_bundle_id,scope,entity_type,entity_id
    ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)`, [
      args.workspace.id,id,entity.scope,entity.entity_type,entity.entity_id
    ]);
  }
  await args.queryable.query("SELECT assert_signal_population_policy_bundle_contract($1::uuid)", [id]);
  return { id,created: true };
}

async function ensureStrategicWatermarks(args: {
  queryable: SignalBrandPolicyQueryable;workspaceId: string;populationId: string;evaluationId: string;
}) {
  const sources = await args.queryable.query<{
    source_id: string;study_corpus_id: string | null;import_batch_id: string;accepted_at: string;
    max_observed_at: string;corpus_revision: number;lineage_digest: string;
  }>(`
    WITH selected AS (
      SELECT item.mention_id,membership.id AS import_membership_id,
        membership.data_source_id,membership.import_batch_id
      FROM signal_data_governance_evaluation_items item
      JOIN signal_mention_import_memberships membership ON membership.id=item.import_membership_id
      WHERE item.workspace_id=$1::uuid AND item.evaluation_id=$2::uuid AND item.decision='included'
    ), lineage AS (
      SELECT selected.data_source_id,selected.import_batch_id,
        COALESCE(batch.contributed_by_study_corpus_id,batch.study_corpus_id) AS study_corpus_id,
        batch.created_at AS accepted_at,max(mention.published_at) AS max_observed_at,
        'sha256:'||encode(sha256(convert_to(string_agg(concat_ws('|',selected.import_membership_id::text,
          selected.mention_id::text,selected.import_batch_id::text,selected.data_source_id::text),E'\n'
          ORDER BY selected.import_membership_id),'UTF8')),'hex') AS lineage_digest
      FROM selected JOIN import_batches batch ON batch.id=selected.import_batch_id
      JOIN mentions mention ON mention.id=selected.mention_id
      GROUP BY selected.data_source_id,selected.import_batch_id,
        COALESCE(batch.contributed_by_study_corpus_id,batch.study_corpus_id),batch.created_at
    ) SELECT lineage.data_source_id::text AS source_id,lineage.study_corpus_id::text,
      lineage.import_batch_id::text,lineage.accepted_at::text,lineage.max_observed_at::text,
      COALESCE(corpus.corpus_revision,workspace_watermark.corpus_revision)::int AS corpus_revision,
      lineage.lineage_digest
    FROM lineage
    LEFT JOIN study_corpora corpus ON corpus.id=lineage.study_corpus_id
    LEFT JOIN signal_workspace_corpora relation ON relation.study_corpus_id=corpus.id
      AND relation.workspace_id=$1::uuid AND relation.valid_to IS NULL
    LEFT JOIN signal_data_watermarks workspace_watermark
      ON lineage.study_corpus_id IS NULL
     AND workspace_watermark.workspace_id=$1::uuid
     AND workspace_watermark.study_corpus_id IS NULL
     AND workspace_watermark.data_source_id=lineage.data_source_id
     AND workspace_watermark.last_import_batch_id=lineage.import_batch_id
    WHERE (lineage.study_corpus_id IS NOT NULL AND relation.id IS NOT NULL)
       OR (lineage.study_corpus_id IS NULL AND workspace_watermark.id IS NOT NULL)
    ORDER BY lineage.data_source_id,lineage.import_batch_id
  `, [args.workspaceId,args.evaluationId]);
  if (sources.rows.length === 0 || sources.rows.some((row) => !row.max_observed_at)) {
    throw new Error("Strategic population has no exact observed import lineage.");
  }
  let created = 0;
  for (const source of sources.rows) {
    const sourceKey = `strategic-${sha256(`${source.source_id}:${source.import_batch_id}:${source.lineage_digest}`).slice(7,39)}`;
    const existing = await args.queryable.query<{ id: string;lineage_digest: string | null }>(`
      SELECT id::text,metadata->>'lineage_digest' AS lineage_digest FROM signal_data_watermarks
      WHERE workspace_id=$1::uuid AND population_id=$2::uuid AND data_source_id=$3::uuid AND source_key=$4
    `, [args.workspaceId,args.populationId,source.source_id,sourceKey]);
    if (existing.rows.length > 1 || (existing.rows[0] && existing.rows[0].lineage_digest !== source.lineage_digest)) {
      throw new Error("Strategic watermark identity is ambiguous or drifted.");
    }
    if (existing.rows[0]) continue;
    await args.queryable.query(`INSERT INTO signal_data_watermarks (
      workspace_id,study_corpus_id,population_id,data_source_id,source_key,corpus_revision,
      last_import_batch_id,max_observed_at,accepted_at,materialized_at,
      source_freshness_state,data_freshness_state,stale_after,metadata
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::int,$7::uuid,$8::timestamptz,
      $9::timestamptz,clock_timestamp(),'not_available','not_available',NULL,
      jsonb_build_object('contract_version','signal-strategic-population-watermark-v1',
        'module_key','triggers-barriers','view_key','strategic','lineage_digest',$10::text,
        'freshness_measurement','not_available'))`, [args.workspaceId,source.study_corpus_id,
      args.populationId,source.source_id,sourceKey,source.corpus_revision,source.import_batch_id,
      source.max_observed_at,source.accepted_at,source.lineage_digest]);
    created += 1;
  }
  return created;
}

async function loadStrategicPopulationState(
  queryable: SignalBrandPolicyQueryable,workspaceId: string,populationId: string
) {
  const result = await queryable.query<{
    population_version: number;definition_hash: string;membership_digest: string;
    membership_count: number;alias_membership_count: number;actual_digest: string;
    source_watermark_hash: string;source_watermark_at: string | null;
  }>(`
    WITH members AS (
      SELECT membership.mention_id FROM signal_population_memberships membership
      WHERE membership.workspace_id=$1::uuid AND membership.population_id=$2::uuid
        AND membership.membership_status='included' AND membership.removed_at IS NULL
    ), watermarks AS (
      SELECT COALESCE(string_agg(concat_ws(':',watermark.id::text,watermark.source_key,
        watermark.corpus_revision::text,COALESCE(watermark.max_observed_at::text,'∅'),
        watermark.accepted_at::text,watermark.data_freshness_state),',' ORDER BY watermark.id),'') AS content,
        max(COALESCE(watermark.max_observed_at,watermark.accepted_at)) AS observed_at
      FROM signal_data_watermarks watermark
      WHERE watermark.workspace_id=$1::uuid AND watermark.population_id=$2::uuid
    ) SELECT population.version AS population_version,population.definition_hash,
      population.membership_digest,(SELECT count(*)::int FROM members) AS membership_count,
      (SELECT count(*)::int FROM members JOIN mentions mention ON mention.id=members.mention_id
        WHERE mention.canonical_mention_id<>mention.id) AS alias_membership_count,
      'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(mention_id::text,',' ORDER BY mention_id)
        FROM members),''),'UTF8')),'hex') AS actual_digest,
      'sha256:'||encode(sha256(convert_to((SELECT content FROM watermarks),'UTF8')),'hex') AS source_watermark_hash,
      (SELECT observed_at::text FROM watermarks) AS source_watermark_at
    FROM signal_population_definitions population
    WHERE population.id=$2::uuid AND population.workspace_id=$1::uuid
  `, [workspaceId,populationId]);
  const row = result.rows[0];
  if (!row || row.source_watermark_hash === EMPTY_HASH || !row.source_watermark_at) {
    throw new Error("Strategic population state or watermark is unavailable.");
  }
  return row;
}

async function ensureStrategicCompilation(args: {
  queryable: SignalBrandPolicyQueryable;workspaceId: string;actorId: string;bundleId: string;
  populationId: string;populationVersion: number;populationDefinitionHash: string;
  policyDefinitionHash: string;compiledPlanHash: string;membershipDigest: string;
  sourceWatermarkHash: string;sourceWatermarkAt: string | null;
  governance: Awaited<ReturnType<typeof evaluateSignalViewDataGovernanceV1>>;
}) {
  const existing = await args.queryable.query<{ id: string;matches: boolean }>(`
    SELECT compilation.id::text,
      compilation.compiled_plan_hash=$4 AND compilation.policy_definition_hash=$5
      AND compilation.population_definition_hash=$6 AND compilation.membership_digest=$7
      AND compilation.source_watermark_hash=$8 AND compilation.governance_evaluation_id=$9::uuid
      AND compilation.governance_digest=$10 AND compilation.next_policy_transition_at=$11::timestamptz
      AND compilation.compilation_status='ready' AND compilation.governance_unknown_count=0
      AND NOT EXISTS (SELECT 1 FROM signal_data_governance_invalidations invalidation
        WHERE invalidation.policy_compilation_id=compilation.id) AS matches
    FROM signal_population_policy_compilations compilation
    WHERE compilation.workspace_id=$1::uuid AND compilation.policy_bundle_id=$2::uuid
      AND compilation.population_id=$3::uuid AND compilation.module_key='triggers-barriers'
      AND compilation.view_key='strategic' AND compilation.is_current FOR UPDATE
  `, [args.workspaceId,args.bundleId,args.populationId,args.compiledPlanHash,
    args.policyDefinitionHash,args.populationDefinitionHash,args.membershipDigest,
    args.sourceWatermarkHash,args.governance.evaluation_id,args.governance.governance_digest,
    args.governance.next_policy_transition_at]);
  if (existing.rows.length > 1) throw new Error("Strategic current compilation is ambiguous.");
  if (existing.rows[0]?.matches) return { id: existing.rows[0].id,created: false };
  if (existing.rows[0]) {
    throw new Error("Strategic authority changed after binding; create a versioned policy transition.");
  }
  const inserted = await args.queryable.query<{ id: string }>(`
    INSERT INTO signal_population_policy_compilations (
      workspace_id,policy_bundle_id,population_id,compilation_version,compiled_plan_hash,
      policy_definition_hash,population_version,population_definition_hash,membership_digest,
      source_watermark_hash,source_watermark_at,compilation_status,blocking_reasons,
      compiled_by_user_id,governance_evaluation_id,quality_policy_id,quality_policy_version,
      quality_policy_hash,retention_policy_digest,licensing_policy_digest,usage_purposes,
      authorized_root_count,quality_blocked_count,retention_blocked_count,licensing_blocked_count,
      governance_unknown_count,policy_evaluation_watermark,governance_digest,module_key,view_key,
      next_policy_transition_at,governance_data_watermark_id
    ) VALUES ($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6,$7,$8,$9,$10::timestamptz,'ready',ARRAY[]::text[],
      $11::uuid,$12::uuid,$13::uuid,$14,$15,$16,$17,$18::text[],$19,$20,$21,$22,$23,$24::timestamptz,
      $25,'triggers-barriers','strategic',$26::timestamptz,$27::uuid) RETURNING id::text
  `, [args.workspaceId,args.bundleId,args.populationId,args.compiledPlanHash,args.policyDefinitionHash,
    args.populationVersion,args.populationDefinitionHash,args.membershipDigest,args.sourceWatermarkHash,
    args.sourceWatermarkAt,args.actorId,args.governance.evaluation_id,args.governance.quality_policy_id,
    args.governance.quality_policy_version,args.governance.quality_policy_hash,
    args.governance.retention_policy_digest,args.governance.licensing_policy_digest,
    args.governance.usage_purposes,args.governance.authorized_root_count,
    args.governance.quality_blocked_count,args.governance.retention_blocked_count,
    args.governance.licensing_blocked_count,args.governance.governance_unknown_count,
    args.governance.policy_evaluation_watermark,args.governance.governance_digest,
    args.governance.next_policy_transition_at,args.governance.governance_data_watermark_id]);
  return { id: inserted.rows[0]!.id,created: true };
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string,unknown>)
      .sort(([left],[right]) => left.localeCompare(right))
      .map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
