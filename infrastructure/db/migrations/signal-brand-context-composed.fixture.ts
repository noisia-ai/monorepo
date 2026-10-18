import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3, SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 } from "@noisia/query-engine";
import { resolveSignalBrandContextAuthorityV1 } from "../signal-brand-context-authority";
import { readSignalBrandOsCanonicalSnapshotV1, signalBrandOsCanonicalSnapshotHashV1 } from "../signal-brand-os-snapshot";
import { loadSignalBrandContextProcessingQuoteV1 } from "../signal-brand-context-processing-quote";
import { buildSignalSemanticContextProposalRuntimeLineageV1, planSignalSemanticContextProposalCapacityForAuthorityV1,
 startSignalBrandContextComposedSemanticRunV1, type SignalSemanticContextProposalRuntimeConfigurationV1 } from "../signal-semantic-context-proposal";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const semanticConfiguration = {
  available: true, provider: "anthropic", model: "claude-sonnet-4-6",
  model_version: "claude-sonnet-4-6", pricing_version: "synthetic-sonnet-pricing-v1",
  max_input_tokens: 20_000, max_output_tokens: 64_000, model_max_output_tokens: 64_000,
  input_usd_per_million_tokens: "3", output_usd_per_million_tokens: "15",
  platform_hard_cap_micro_usd: 1_000_000n
} satisfies SignalSemanticContextProposalRuntimeConfigurationV1;
export const composedRuntime = { queue_configured: true, worker_alive: true, recovery_alive: true,
  prototype_available: true };

type Scope = { organizationId: string; semanticWorkspaceId: string; voyageWorkspaceId: string;
  semanticRunId: string; voyageRunId: string; actorId: string };

export type ComposedFixture = { organizationId: string; brandId: string; workspaceId: string;
  internalActorId: string; clientActorId: string; generationId: string; generationKey: string };

export async function seedComposedFixture(pool: pg.Pool, label: string, options: {
  optionalStrictCaps?: boolean;
  prototypeConfiguration?: Record<string, unknown>;
  prototypeCap?: number;
  prototypeAutomaticAllowed?: boolean;
  semanticInputRate?: string;
  policyValidForSeconds?: number;
} = {}): Promise<ComposedFixture> {
  const organizationId = randomUUID(), brandId = randomUUID(), internalActorId = randomUUID();
  const clientActorId = randomUUID(), profileId = randomUUID(), sourceId = randomUUID();
  const suffix = `bc-composed-positive-${label}-${randomUUID().slice(0, 8)}`;
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
    VALUES($1::uuid,$2,$2,$2,'active')`, [organizationId, suffix]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin','active')`,
  [internalActorId, `${internalActorId}@example.test`, `${suffix} internal`]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1::uuid,$2,$3,'client','client_admin',$4::uuid,'active')`,
  [clientActorId, `${clientActorId}@example.test`, `${suffix} client`, organizationId]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,description,
    industry,industry_sub,countries,brand_seed_handles,status)
    VALUES($1::uuid,$2::uuid,$3,$3,$3,'Invented fixture brand','Technology','Bicycles',
      ARRAY['MX']::char(2)[],ARRAY['fixture']::text[],'active')`, [brandId, organizationId, suffix]);
  const workspaceId = (await pool.query<{ id: string }>(
    "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid", [brandId])).rows[0]!.id;
  await pool.query("UPDATE signal_workspaces SET timezone='America/Mexico_City' WHERE id=$1::uuid", [workspaceId]);
  await pool.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,
    raw_text,extracted_payload,status) VALUES($1::uuid,$2::uuid,$3::uuid,'operator-note','Fixture knowledge',
      'Synthetic governed bicycle service and scheduled repair evidence.','{}'::jsonb,'active')`,
  [sourceId, organizationId, brandId]);
  await pool.query(`INSERT INTO knowledge_chunks(knowledge_source_id,chunk_index,chunk_text)
    VALUES($1::uuid,0,'Synthetic scheduled bicycle repair evidence.')`, [sourceId]);
  await pool.query(`INSERT INTO knowledge_assertions(knowledge_source_id,assertion_text,assertion_type,status)
    VALUES($1::uuid,'Scheduled repairs are offered.','positioning','approved')`, [sourceId]);
  const snapshot = await readSignalBrandOsCanonicalSnapshotV1({ queryable: pool,
    brand_id: brandId, organization_id: organizationId });
  assert.ok(snapshot);
  const brandOsDigest = signalBrandOsCanonicalSnapshotHashV1(snapshot);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Fixture Brand OS','active',1,jsonb_build_object(
      'snapshot_hash',$4::text,'countries',to_jsonb(ARRAY['MX']::text[]),'display_name',$5::text,
      'aliases',jsonb_build_array('fixture'),'industry','Technology','industry_sub','Bicycles',
      'description','Invented fixture brand'))`, [profileId, organizationId, brandId, brandOsDigest, suffix]);
  await pool.query(`INSERT INTO brand_os_products(brand_os_profile_id,name,product_type,description,status)
    VALUES($1::uuid,'Fixture bicycle','service','Synthetic governed product','active')`, [profileId]);
  await pool.query(`INSERT INTO brand_os_competitors(brand_os_profile_id,competitor_name,role,priority)
    VALUES($1::uuid,'Fixture competitor','direct',1)`, [profileId]);
  const workspace = { id: workspaceId, organization_id: organizationId, brand_id: brandId };
  const authority = await resolveSignalBrandContextAuthorityV1({ queryable: pool,
    workspace: { id: workspaceId, organizationId, subject: { type: "brand", id: brandId },
      timezone: "America/Mexico_City" } });
  const capacity = await planSignalSemanticContextProposalCapacityForAuthorityV1({ queryable: pool,
    workspace, authority: { generation_key: `context-${suffix}`,
      brand_os_profile_id: authority.brandOsProfileId, brand_os_digest: authority.brandOsDigest,
      knowledge_digest: authority.knowledgeDigest, locale_context_digest: authority.localeContextDigest,
      primary_locale: authority.primaryLocale, locale_variants: authority.localeVariants,
      markets: authority.markets, timezone: authority.timezone } });
  const lineage = buildSignalSemanticContextProposalRuntimeLineageV1(options.optionalStrictCaps ? { ...semanticConfiguration, platform_hard_cap_micro_usd: null } : semanticConfiguration, capacity);
  const createOperationId = randomUUID(), generationKey = `context-${suffix}`;
  await pool.query(`INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,$3::uuid,
      'create-semantic-context-draft',$4,$5,'in_progress')`, [createOperationId, workspaceId,
    internalActorId, digest(`${suffix}:create-request`), digest(`${suffix}:create-key`)]);
  const artifactId = (await pool.query<{ id: string }>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,
      'semantic_context_pack_generation','{}'::jsonb,'needs_review',1,'{}'::jsonb) RETURNING id::text`,
  [workspaceId, authority.sourceAuthorityDigest, generationKey])).rows[0]!.id;
  const generationId = (await pool.query<{ id: string }>(`INSERT INTO signal_semantic_context_generations(
    workspace_id,artifact_id,generation_key,generation_version,status,brand_os_profile_id,
    brand_os_profile_version,brand_os_digest,knowledge_generation_key,knowledge_digest,
    locale_context_digest,primary_locale,locale_variants,markets,timezone,proposal_model,
    proposal_model_version,proposal_prompt_digest,proposal_pricing_version,proposal_provider_lineage,
    proposal_provider_lineage_digest,draft_digest,created_operation_id,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3,1,'draft',$4::uuid,1,$5,$6,$7,$8,$9,$10::text[],$11::text[],$12,
      $13,$14,$15,$16,$17::jsonb,$18,$19,$20::uuid,$21::uuid) RETURNING id::text`, [workspaceId,
    artifactId, generationKey, profileId, authority.brandOsDigest, authority.knowledgeGenerationKey,
    authority.knowledgeDigest, authority.localeContextDigest, authority.primaryLocale,
    authority.localeVariants, authority.markets, authority.timezone, semanticConfiguration.model,
    semanticConfiguration.model_version, SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
    semanticConfiguration.pricing_version, JSON.stringify(lineage), lineage.lineage_digest,
    digest(`${suffix}:draft`), createOperationId, internalActorId])).rows[0]!.id;
  const preparationOperationId = randomUUID();
  const preparationInput = { contract_version: "brand-context-preparation-input-v1",
    primary_locale: authority.primaryLocale, source_authority_digest: authority.sourceAuthorityDigest,
    generation_id: generationId, generation_key: generationKey, admission: null };
  await pool.query(`INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status,brand_context_preparation)
    VALUES($1::uuid,$2::uuid,$3::uuid,'prepare-brand-context',$4,$5,'in_progress',$6::jsonb)`,
  [preparationOperationId, workspaceId, internalActorId, digest(`${suffix}:prepare-request`),
    digest(`${suffix}:prepare-key`), JSON.stringify(preparationInput)]);
  const preparationResult = { contract_version: "brand-context-preparation-v1",
    operation_id: preparationOperationId, workspace_id: workspaceId, generation_id: generationId,
    generation_key: generationKey, state: "awaiting_authorization", semantic_run_id: null,
    prototype_run_id: null, active_elements: 0, exceptions: 0, error_code: null, replayed: false };
  await pool.query(`UPDATE signal_governance_control_operations SET status='completed',result=$2::jsonb,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,
  [preparationOperationId, JSON.stringify(preparationResult)]);
  await pool.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level)
    VALUES($1::uuid,$2::uuid,'admin')`, [clientActorId, brandId]);
  const policyId = randomUUID();
  const policyValidForSeconds = options.policyValidForSeconds ?? 86400;
  assert.ok(Number.isSafeInteger(policyValidForSeconds) && policyValidForSeconds >= 10 && policyValidForSeconds <= 86400);
  await pool.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,
    valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
    VALUES($1::uuid,$2::uuid,1,clock_timestamp()-interval '1 hour',CASE WHEN $5::boolean THEN 'infinity'::timestamptz ELSE clock_timestamp()+make_interval(secs=>$4::int) END,
      'America/Mexico_City',CASE WHEN $5::boolean THEN NULL ELSE 2000000 END,$3::uuid)`, [policyId, organizationId, internalActorId, policyValidForSeconds, options.optionalStrictCaps === true]);
  const semanticPolicyConfiguration = {
    provider: semanticConfiguration.provider, model: semanticConfiguration.model,
    model_version: semanticConfiguration.model_version, pricing_version: semanticConfiguration.pricing_version,
    max_input_tokens: semanticConfiguration.max_input_tokens,
    max_output_tokens: semanticConfiguration.max_output_tokens,
    input_usd_per_million_tokens: options.semanticInputRate ?? semanticConfiguration.input_usd_per_million_tokens,
    output_usd_per_million_tokens: semanticConfiguration.output_usd_per_million_tokens
  };
  for (const [action, provider, model, configuration, cap, automaticAllowed] of [
    ["brand_context_proposal", "anthropic", "claude-sonnet-4-6", semanticPolicyConfiguration, 1_000_000, false],
    ["topic_prototype_embeddings", "voyage", "voyage-4-large",
      options.prototypeConfiguration ?? SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, options.prototypeCap ?? 100_000,
      options.prototypeAutomaticAllowed ?? true]
  ] as const) {
    await pool.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,
      provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
      VALUES($1::uuid,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6,$7)`,
    [policyId, action, provider, model, JSON.stringify(configuration), options.optionalStrictCaps ? null : cap, automaticAllowed]);
  }
  await pool.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1::uuid", [policyId]);
  return { organizationId, brandId, workspaceId, internalActorId, clientActorId, generationId, generationKey };
}

export async function composedBundleCounts(pool: pg.Pool, workspaceId: string) {
  return (await pool.query<{ admissions: number; receipts: number; runs: number; reservations: number;
    outboxes: number; operations: number }>(`SELECT
      (SELECT count(*)::int FROM signal_processing_admissions WHERE workspace_id=$1::uuid) admissions,
      (SELECT count(*)::int FROM signal_brand_context_processing_receipts WHERE workspace_id=$1::uuid) receipts,
      (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE workspace_id=$1::uuid) runs,
      (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id=$1::uuid) reservations,
      (SELECT count(*)::int FROM signal_semantic_context_proposal_outbox WHERE workspace_id=$1::uuid) outboxes,
      (SELECT count(*)::int FROM signal_governance_control_operations
        WHERE workspace_id=$1::uuid AND action='start-semantic-context-proposal-run') operations`,
  [workspaceId])).rows[0]!;
}

export async function quoteComposedFixture(pool: pg.Pool, fixture: ComposedFixture) {
  return loadSignalBrandContextProcessingQuoteV1({ database: pool, workspace_id: fixture.workspaceId,
    actor_user_id: fixture.clientActorId,
    action_availability: { brand_context_proposal: true, topic_prototype_embeddings: true } });
}

export async function startComposedFixture(pool: pg.Pool, fixture: ComposedFixture, quoteDigest: string,
  idempotencyKey: string, configuration: SignalSemanticContextProposalRuntimeConfigurationV1 = semanticConfiguration,
  runtime = composedRuntime) {
  return startSignalBrandContextComposedSemanticRunV1({ pool,
    workspace: { id: fixture.workspaceId, organization_id: fixture.organizationId, brand_id: fixture.brandId },
    actor: { id: fixture.clientActorId }, idempotency_key: idempotencyKey,
    quote_digest: quoteDigest, confirmation: "prepare_brand_context_within_shown_cap",
    configuration, runtime });
}

