import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
  SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  signalSemanticContextProposalCostMicroUsdV1,
  signalSemanticContextProposalDigestV1
} from "@noisia/query-engine";
import { resolveSignalBrandContextAuthorityV1 } from "../signal-brand-context-authority";
import { readSignalBrandOsCanonicalSnapshotV1,
  signalBrandOsCanonicalSnapshotHashV1 } from "../signal-brand-os-snapshot";
import { loadSignalBrandContextProcessingQuoteV1 } from "../signal-brand-context-processing-quote";
import { buildSignalSemanticContextProposalRuntimeLineageV1,
  planSignalSemanticContextProposalCapacityForAuthorityV1,
  startSignalBrandContextComposedSemanticRunV1,
  type SignalSemanticContextProposalRuntimeConfigurationV1 } from "../signal-semantic-context-proposal";

const enabled = process.env.NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_PG_APPROVED === "true";
const databaseUrl = process.env.NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL;
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const semanticConfiguration: SignalSemanticContextProposalRuntimeConfigurationV1 = {
  available: true, provider: "anthropic", model: "claude-sonnet-4-6",
  model_version: "claude-sonnet-4-6", pricing_version: "synthetic-sonnet-pricing-v1",
  max_input_tokens: 20_000, max_output_tokens: 64_000, model_max_output_tokens: 64_000,
  input_usd_per_million_tokens: "3", output_usd_per_million_tokens: "15",
  platform_hard_cap_micro_usd: 1_000_000n
};
export const composedRuntime = { queue_configured: true, worker_alive: true, recovery_alive: true,
  prototype_available: true };

type Scope = { organizationId: string; semanticWorkspaceId: string; voyageWorkspaceId: string;
  semanticRunId: string; voyageRunId: string; actorId: string };

export type ComposedFixture = { organizationId: string; brandId: string; workspaceId: string;
  internalActorId: string; clientActorId: string; generationId: string; generationKey: string };

export async function seedComposedFixture(pool: pg.Pool, label: string, options: {
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
  const lineage = buildSignalSemanticContextProposalRuntimeLineageV1(semanticConfiguration, capacity);
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
    VALUES($1::uuid,$2::uuid,1,clock_timestamp()-interval '1 hour',clock_timestamp()+make_interval(secs=>$4::int),
      'America/Mexico_City',2000000,$3::uuid)`, [policyId, organizationId, internalActorId, policyValidForSeconds]);
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
    [policyId, action, provider, model, JSON.stringify(configuration), cap, automaticAllowed]);
  }
  await pool.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1::uuid", [policyId]);
  return { organizationId, brandId, workspaceId, internalActorId, clientActorId, generationId, generationKey };
}

async function seedScope(client: pg.PoolClient, label: string): Promise<Scope> {
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const semanticBrandId = randomUUID();
  const voyageBrandId = randomUUID();
  const semanticWorkspaceId = randomUUID();
  const voyageWorkspaceId = randomUUID();
  const semanticRunId = randomUUID();
  const voyageRunId = randomUUID();
  const profileDigest = digest(`${label}:voyage-profile`);
  const profile = { config_digest: profileDigest, provider: "voyage", model: "voyage-4-large", dimensions: 1024,
    input_type: "document", truncation: false, chunk_policy_version: "corpus-text-chunks-v1",
    rate_micro_usd_per_million_tokens: "120000" };

  // Owner history is scaffolding only. It is inserted with triggers disabled so
  // this focal test can exercise the real ledger guards without fabricating a
  // Brand Context or prototype admission. Checks still run; all referenced scope
  // rows are present. The two monetary writer transactions below run normally.
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1,$2,$3,'active')",
      [organizationId, `bc-composed-${label}-${organizationId}`, `Synthetic ${label}`]);
    await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES($1,$2,$3,'noisia_internal','founder',$4,'active')`,
    [actorId, `${actorId}@example.test`, `Synthetic ${label} actor`, organizationId]);
    for (const [brandId, workspaceId, suffix] of [[semanticBrandId, semanticWorkspaceId, "semantic"],
      [voyageBrandId, voyageWorkspaceId, "voyage"]] as const) {
      await client.query("INSERT INTO brands(id,organization_id,slug,name,status) VALUES($1,$2,$3,$4,'active')",
        [brandId, organizationId, `bc-${label}-${suffix}-${brandId}`, `Synthetic ${suffix}`]);
      await client.query("INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,timezone,status) VALUES($1,$2,$3,$4,'UTC','active')",
        [workspaceId, organizationId, brandId, `bc-${label}-${suffix}-${workspaceId}`]);
    }
    const hashes = Array.from({ length: 7 }, (_, index) => digest(`${label}:semantic:${index}`));
    await client.query(`INSERT INTO signal_semantic_context_proposal_runs(id,workspace_id,generation_id,operation_id,run_key,
      preflight_digest,brand_os_digest,knowledge_digest,locale_context_digest,prompt_digest,context_input_digest,
      provider,model,model_version,pricing_version,max_input_tokens,max_output_tokens,input_usd_per_million_tokens,
      output_usd_per_million_tokens,hard_cap_micro_usd,reservation_micro_usd,provider_request_identity,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'anthropic','claude-sonnet-4-6','synthetic-v1','synthetic-v1',
      1000,100,1,1,100,70,$12,$13)`, [semanticRunId, semanticWorkspaceId, randomUUID(), randomUUID(),
      `bc-${label}-semantic-run`, ...hashes, actorId]);
    await client.query(`INSERT INTO signal_workspace_embedding_runs(id,workspace_id,preparation_run_id,actor_user_id,
      input_revision,policy_valid_until,profile,config_digest,quote_digest,request_keys,hard_cap_micro_usd,
      estimated_upper_micro_usd,status,counts,worker_job_id,input_contract)
      VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '1 day',$5::jsonb,$6,$7,'{}',100,40,'running','{}',$8,'corpus')`,
    [voyageRunId, voyageWorkspaceId, randomUUID(), actorId, JSON.stringify(profile), profileDigest,
      digest(`${label}:voyage-quote`), `bc-${label}-voyage-job-${voyageRunId}`]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const policyId = randomUUID();
  const semanticConfiguration = { provider: "anthropic", model: "claude-sonnet-4-6", model_version: "synthetic-v1",
    pricing_version: "synthetic-v1", max_input_tokens: "1000", max_output_tokens: "100",
    input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 1 };
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await client.query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,
      budget_timezone,daily_cap_micro_usd,created_by_user_id) VALUES($1,$2,1,clock_timestamp()-interval '1 hour',
      clock_timestamp()+interval '1 day','UTC',100,$3)`, [policyId, organizationId, actorId]);
    for (const [action, provider, model, configuration] of [["brand_context_proposal", "anthropic", "claude-sonnet-4-6", semanticConfiguration],
      ["corpus_embeddings", "voyage", "voyage-4-large", profile]] as const) {
      await client.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,
        configuration,configuration_digest,max_execution_micro_usd) VALUES($1,$2,'provider',$3,$4,$5::jsonb,
        signal_semantic_context_digest_json_v2($5::jsonb),100)`, [policyId, action, provider, model, JSON.stringify(configuration)]);
    }
    await client.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1", [policyId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { organizationId, semanticWorkspaceId, voyageWorkspaceId, semanticRunId, voyageRunId, actorId };
}

async function waitForAdvisoryBlock(observer: pg.PoolClient, pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = (await observer.query<{ wait_event_type: string | null; wait_event: string | null }>(
      "SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
    if (row?.wait_event_type === "Lock" && row.wait_event === "advisory") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("second monetary writer did not block on the organization/day advisory lock");
}

async function reserveSemantic(client: pg.PoolClient, scope: Scope) {
  await client.query(`INSERT INTO signal_semantic_context_budget_reservations(workspace_id,run_id,reservation_micro_usd,
    reserved_input_tokens,reserved_output_tokens,reservation_digest) VALUES($1,$2,70,1,1,$3)`,
  [scope.semanticWorkspaceId, scope.semanticRunId, digest(`${scope.semanticRunId}:reservation`)]);
}

async function reserveVoyage(client: pg.PoolClient, scope: Scope) {
  const profile = (await client.query<{ config_digest: string }>(
    "SELECT config_digest FROM signal_workspace_embedding_runs WHERE id=$1", [scope.voyageRunId])).rows[0]!;
  const input = digest(`${scope.voyageRunId}:input`);
  await client.query(`INSERT INTO signal_workspace_embedding_calls(workspace_id,run_id,config_digest,batch_digest,
    request_digest,input_keys,batch,tokens_upper,reserved_micro_usd) VALUES($1,$2,$3,$4,$5,ARRAY[$6]::text[],'{}',333,40)`,
  [scope.voyageWorkspaceId, scope.voyageRunId, profile.config_digest, digest(`${scope.voyageRunId}:batch`),
    digest(`${scope.voyageRunId}:request`), input]);
}

async function assertWriterOrder(pool: pg.Pool, scope: Scope, first: "semantic" | "voyage") {
  const winner = await pool.connect();
  const loser = await pool.connect();
  const observer = await pool.connect();
  try {
    await winner.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await loser.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const loserPid = (await loser.query<{ pid: number }>("SELECT pg_backend_pid() pid")).rows[0]!.pid;
    const firstWrite = first === "semantic" ? reserveSemantic : reserveVoyage;
    const secondWrite = first === "semantic" ? reserveVoyage : reserveSemantic;
    await firstWrite(winner, scope);
    const pending = secondWrite(loser, scope).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    await waitForAdvisoryBlock(observer, loserPid);
    await winner.query("COMMIT");
    const outcome = await pending;
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.error?.code, "23514");
      assert.equal(outcome.error?.message, "processing_daily_cap_exhausted");
    }
    await loser.query("ROLLBACK");
    const exposure = (await observer.query<{ total: string }>(`SELECT total_micro_usd::text total
      FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,'UTC')`,
    [scope.organizationId])).rows[0]!.total;
    assert.equal(exposure, first === "semantic" ? "70" : "40");
    const counts = (await observer.query<{ semantic: number; voyage: number; semantic_runs: number; voyage_runs: number }>(`
      SELECT (SELECT count(*)::int FROM signal_semantic_context_budget_reservations WHERE workspace_id=$1) semantic,
       (SELECT count(*)::int FROM signal_workspace_embedding_calls WHERE workspace_id=$2) voyage,
       (SELECT count(*)::int FROM signal_semantic_context_proposal_runs WHERE workspace_id=$1) semantic_runs,
       (SELECT count(*)::int FROM signal_workspace_embedding_runs WHERE workspace_id=$2) voyage_runs`,
    [scope.semanticWorkspaceId, scope.voyageWorkspaceId])).rows[0]!;
    assert.deepEqual(counts, { semantic: first === "semantic" ? 1 : 0, voyage: first === "voyage" ? 1 : 0,
      semantic_runs: 1, voyage_runs: 1 });
  } finally {
    await winner.query("ROLLBACK").catch(() => undefined);
    await loser.query("ROLLBACK").catch(() => undefined);
    winner.release(); loser.release(); observer.release();
  }
}

test("0156 real PostgreSQL uses IANA/DST midnights and serializes Claude/Voyage money in both orders",
  { skip: !enabled, timeout: 30_000 }, async () => {
    assert.ok(databaseUrl, "NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL is required");
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "focal runner only accepts disposable local PostgreSQL");
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
    try {
      const clock = (await pool.query<{ spring: number; fall: number; mexico: number }>(`SELECT
        extract(epoch FROM ((timestamp '2026-03-09' AT TIME ZONE 'America/New_York')-
          (timestamp '2026-03-08' AT TIME ZONE 'America/New_York')))::int spring,
        extract(epoch FROM ((timestamp '2026-11-02' AT TIME ZONE 'America/New_York')-
          (timestamp '2026-11-01' AT TIME ZONE 'America/New_York')))::int fall,
        extract(epoch FROM ((timestamp '2026-03-09' AT TIME ZONE 'America/Mexico_City')-
          (timestamp '2026-03-08' AT TIME ZONE 'America/Mexico_City')))::int mexico`)).rows[0]!;
      assert.deepEqual(clock, { spring: 82_800, fall: 90_000, mexico: 86_400 });
      const seed = await pool.connect();
      try {
        await assertWriterOrder(pool, await seedScope(seed, "semantic-first"), "semantic");
        await assertWriterOrder(pool, await seedScope(seed, "voyage-first"), "voyage");
      } finally { seed.release(); }
    } finally { await pool.end(); }
  });

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

async function quoteComposedFixtureForActor(pool: pg.Pool, fixture: ComposedFixture, actorId: string) {
  return loadSignalBrandContextProcessingQuoteV1({ database: pool, workspace_id: fixture.workspaceId,
    actor_user_id: actorId,
    action_availability: { brand_context_proposal: true, topic_prototype_embeddings: true } });
}

export async function startComposedFixture(pool: pg.Pool, fixture: ComposedFixture, quoteDigest: string,
  idempotencyKey: string, configuration = semanticConfiguration,
  runtime = composedRuntime) {
  return startSignalBrandContextComposedSemanticRunV1({ pool,
    workspace: { id: fixture.workspaceId, organization_id: fixture.organizationId, brand_id: fixture.brandId },
    actor: { id: fixture.clientActorId }, idempotency_key: idempotencyKey,
    quote_digest: quoteDigest, confirmation: "prepare_brand_context_within_shown_cap",
    configuration, runtime });
}

async function authorizeComposedFixture(pool: pg.Pool, fixture: ComposedFixture, actorId: string,
  quoteDigest: string, idempotencyKey: string) {
  return pool.query("SELECT authorize_signal_brand_context_processing_v1($1::uuid,$2::uuid,$3,$4,$5)",
    [fixture.workspaceId, actorId, idempotencyKey, quoteDigest,
      "prepare_brand_context_within_shown_cap"]);
}

test("0162 admits active financial internal operators and rejects other internal identities atomically",
  { skip: !enabled, timeout: 60_000 }, async () => {
    assert.ok(databaseUrl, "NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL is required");
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
      "focal runner only accepts disposable local PostgreSQL");
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
    try {
      const allowed = await seedComposedFixture(pool, "internal-financial");
      const allowedQuote = await quoteComposedFixtureForActor(pool, allowed, allowed.internalActorId);
      assert.equal(allowedQuote.quote_status, "quoted");
      assert.ok(allowedQuote.quote_digest);
      const started = await startSignalBrandContextComposedSemanticRunV1({ pool,
        workspace: { id: allowed.workspaceId, organization_id: allowed.organizationId,
          brand_id: allowed.brandId }, actor: { id: allowed.internalActorId },
        idempotency_key: "internal-financial-request", quote_digest: allowedQuote.quote_digest,
        confirmation: "prepare_brand_context_within_shown_cap", configuration: semanticConfiguration,
        runtime: composedRuntime });
      assert.equal(started.replayed, false);
      assert.deepEqual(await composedBundleCounts(pool, allowed.workspaceId), {
        admissions: 1, receipts: 1, runs: 1, reservations: 1, outboxes: 1, operations: 1
      });

      for (const [label, mutation] of [
        ["analyst", "UPDATE users SET primary_role='analyst' WHERE id=$1::uuid"],
        ["inactive", "UPDATE users SET status='suspended' WHERE id=$1::uuid"],
        ["inactive-org", "UPDATE organizations SET status='suspended' WHERE id=$1::uuid"]
      ] as const) {
        const denied = await seedComposedFixture(pool, `internal-${label}`);
        await pool.query(mutation, [label === "inactive-org" ? denied.organizationId : denied.internalActorId]);
        await assert.rejects(authorizeComposedFixture(pool, denied, denied.internalActorId,
          digest(`${label}:unusable-quote`), `internal-${label}-request`),
        (error: unknown) => (error as { message?: string }).message === "processing_forbidden");
        assert.deepEqual(await composedBundleCounts(pool, denied.workspaceId), {
          admissions: 0, receipts: 0, runs: 0, reservations: 0, outboxes: 0, operations: 0
        });
      }
    } finally { await pool.end(); }
  });

test("0156 denies cross-tenant and insufficient client authority without leaving a partial bundle",
  { skip: !enabled, timeout: 60_000 }, async () => {
    assert.ok(databaseUrl, "NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL is required");
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
      "focal runner only accepts disposable local PostgreSQL");
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
    try {
      const crossTenant = await seedComposedFixture(pool, "cross-tenant");
      const crossTenantQuote = await quoteComposedFixture(pool, crossTenant);
      assert.ok(crossTenantQuote.quote_digest);
      const foreignOrganizationId = randomUUID(), foreignActorId = randomUUID();
      await pool.query(`INSERT INTO organizations(id,slug,legal_name,status)
        VALUES($1::uuid,$2,$2,'active')`, [foreignOrganizationId, `foreign-${foreignOrganizationId}`]);
      await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
        VALUES($1::uuid,$2,$3,'client','client_admin',$4::uuid,'active')`, [foreignActorId,
        `${foreignActorId}@example.test`, "Foreign client admin", foreignOrganizationId]);
      await pool.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level)
        VALUES($1::uuid,$2::uuid,'admin')`, [foreignActorId, crossTenant.brandId]);
      await assert.rejects(authorizeComposedFixture(pool, crossTenant, foreignActorId,
        crossTenantQuote.quote_digest!, "cross-tenant-request"),
      (error: unknown) => (error as { message?: string }).message === "processing_forbidden");
      assert.deepEqual(await composedBundleCounts(pool, crossTenant.workspaceId), {
        admissions: 0, receipts: 0, runs: 0, reservations: 0, outboxes: 0, operations: 0
      });

      const insufficientRole = await seedComposedFixture(pool, "insufficient-role");
      const insufficientRoleQuote = await quoteComposedFixture(pool, insufficientRole);
      assert.ok(insufficientRoleQuote.quote_digest);
      await pool.query("UPDATE users SET primary_role='brand_manager' WHERE id=$1::uuid",
        [insufficientRole.clientActorId]);
      await assert.rejects(authorizeComposedFixture(pool, insufficientRole,
        insufficientRole.clientActorId, insufficientRoleQuote.quote_digest!, "insufficient-role-request"),
      (error: unknown) => (error as { message?: string }).message === "processing_forbidden");
      assert.deepEqual(await composedBundleCounts(pool, insufficientRole.workspaceId), {
        admissions: 0, receipts: 0, runs: 0, reservations: 0, outboxes: 0, operations: 0
      });

      const insufficientGrant = await seedComposedFixture(pool, "insufficient-grant");
      const insufficientGrantQuote = await quoteComposedFixture(pool, insufficientGrant);
      assert.ok(insufficientGrantQuote.quote_digest);
      await pool.query("UPDATE user_brand_access SET access_level='comment' WHERE user_id=$1::uuid AND brand_id=$2::uuid",
        [insufficientGrant.clientActorId, insufficientGrant.brandId]);
      await assert.rejects(authorizeComposedFixture(pool, insufficientGrant,
        insufficientGrant.clientActorId, insufficientGrantQuote.quote_digest!, "insufficient-grant-request"),
      (error: unknown) => (error as { message?: string }).message === "processing_forbidden");
      assert.deepEqual(await composedBundleCounts(pool, insufficientGrant.workspaceId), {
        admissions: 0, receipts: 0, runs: 0, reservations: 0, outboxes: 0, operations: 0
      });
    } finally { await pool.end(); }
  });

test("0156 serializes same-key starts into one bundle and deferred commit rejects an incomplete bundle",
  { skip: !enabled, timeout: 60_000 }, async () => {
    assert.ok(databaseUrl, "NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL is required");
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
      "focal runner only accepts disposable local PostgreSQL");
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
    try {
      const concurrent = await seedComposedFixture(pool, "concurrent-replay");
      const concurrentQuote = await quoteComposedFixture(pool, concurrent);
      assert.ok(concurrentQuote.quote_digest);
      const attempts = await Promise.allSettled([
        startComposedFixture(pool, concurrent, concurrentQuote.quote_digest!, "concurrent-request"),
        startComposedFixture(pool, concurrent, concurrentQuote.quote_digest!, "concurrent-request")
      ]);
      assert.ok(attempts.every(result => result.status === "fulfilled"),
        `same-key concurrency leaked an error: ${JSON.stringify(attempts)}`);
      const results = attempts.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
      assert.equal(results[0]!.run_id, results[1]!.run_id);
      assert.equal(results[0]!.receipt_id, results[1]!.receipt_id);
      assert.deepEqual(await composedBundleCounts(pool, concurrent.workspaceId), {
        admissions: 1, receipts: 1, runs: 1, reservations: 1, outboxes: 1, operations: 1
      });

      const incomplete = await seedComposedFixture(pool, "incomplete-bundle");
      const incompleteQuote = await quoteComposedFixture(pool, incomplete);
      assert.ok(incompleteQuote.quote_digest);
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query(
          "SELECT authorize_signal_brand_context_processing_v1($1::uuid,$2::uuid,$3,$4,$5)",
          [incomplete.workspaceId, incomplete.clientActorId, "incomplete-bundle-request",
            incompleteQuote.quote_digest, "prepare_brand_context_within_shown_cap"]
        );
        await assert.rejects(client.query("COMMIT"),
          (error: unknown) => ["23503", "23514"].includes((error as { code?: string }).code ?? ""));
        await client.query("ROLLBACK").catch(() => undefined);
      } finally { client.release(); }
      assert.deepEqual(await composedBundleCounts(pool, incomplete.workspaceId), {
        admissions: 0, receipts: 0, runs: 0, reservations: 0, outboxes: 0, operations: 0
      });
    } finally { await pool.end(); }
  });

test("0156 composes the client Claude bundle, rolls back drift and preserves paid recovery after revocation",
  { skip: !enabled, timeout: 120_000 }, async () => {
    assert.ok(databaseUrl, "NOISIA_BRAND_CONTEXT_COMPOSED_ADMISSION_DATABASE_URL is required");
    const parsed = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
      "focal runner only accepts disposable local PostgreSQL");
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
    try {
      const invalidPrototype = await seedComposedFixture(pool, "prototype-config", {
        prototypeConfiguration: { ...SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1, dimensions: 768 }
      });
      const invalidPrototypeQuote = await quoteComposedFixture(pool, invalidPrototype);
      assert.equal(invalidPrototypeQuote.quote_status, "action_incompatible");
      assert.equal(invalidPrototypeQuote.quote_digest, null);

      const zeroPrototype = await seedComposedFixture(pool, "prototype-zero", { prototypeCap: 0 });
      const zeroPrototypeQuote = await quoteComposedFixture(pool, zeroPrototype);
      assert.equal(zeroPrototypeQuote.quote_status, "cache_coverage_required");
      await assert.rejects(pool.query(
        "SELECT signal_brand_context_processing_quote_v1($1::uuid,$2::uuid)",
        [zeroPrototype.workspaceId, zeroPrototype.clientActorId]
      ), (error: unknown) => (error as { message?: string }).message === "processing_action_incompatible");

      const manualPrototype = await seedComposedFixture(pool, "prototype-manual", {
        prototypeAutomaticAllowed: false
      });
      const manualPrototypeQuote = await quoteComposedFixture(pool, manualPrototype);
      assert.equal(manualPrototypeQuote.quote_status, "action_incompatible");
      assert.equal(manualPrototypeQuote.quote_digest, null);

      const rateDrift = await seedComposedFixture(pool, "rate-drift", { semanticInputRate: "4" });
      const rateDriftQuote = await quoteComposedFixture(pool, rateDrift);
      assert.equal(rateDriftQuote.quote_status, "quoted");
      assert.ok(rateDriftQuote.quote_digest);
      const rateCounts = await composedBundleCounts(pool, rateDrift.workspaceId);
      await assert.rejects(startComposedFixture(pool, rateDrift, rateDriftQuote.quote_digest!,
        "rate-drift-request", semanticConfiguration),
      (error: unknown) => (error as { code?: string }).code === "brand_context_processing_runtime_drift");
      assert.deepEqual(await composedBundleCounts(pool, rateDrift.workspaceId), rateCounts,
        "a numeric rate mismatch rolls admission and receipt back");

      const fixture = await seedComposedFixture(pool, "positive");
      const quote = await quoteComposedFixture(pool, fixture);
      assert.equal(quote.quote_status, "quoted");
      assert.ok(quote.quote_digest);
      const empty = await composedBundleCounts(pool, fixture.workspaceId);
      assert.deepEqual(empty, { admissions: 0, receipts: 0, runs: 0, reservations: 0,
        outboxes: 0, operations: 0 });
      await assert.rejects(startComposedFixture(pool, fixture, digest("stale-quote"), "stale-quote-request"),
        (error: unknown) => (error as { code?: string }).code === "brand_context_quote_changed");
      assert.deepEqual(await composedBundleCounts(pool, fixture.workspaceId), empty);
      await assert.rejects(startComposedFixture(pool, fixture, quote.quote_digest!, "runtime-down-request",
        semanticConfiguration, { ...composedRuntime, worker_alive: false }),
      (error: unknown) => (error as { code?: string }).code === "brand_context_processing_runtime_unavailable");
      assert.deepEqual(await composedBundleCounts(pool, fixture.workspaceId), empty);
      await assert.rejects(startComposedFixture(pool, fixture, quote.quote_digest!, "lineage-drift-request",
        { ...semanticConfiguration, model_version: "different-version" }),
      (error: unknown) => (error as { code?: string }).code === "brand_context_processing_runtime_drift");
      assert.deepEqual(await composedBundleCounts(pool, fixture.workspaceId), empty,
        "authorization inserts are rolled back when the server runtime drifts");

      const started = await startComposedFixture(pool, fixture, quote.quote_digest!, "positive-request");
      assert.equal(started.replayed, false);
      const complete = await composedBundleCounts(pool, fixture.workspaceId);
      assert.deepEqual(complete, { admissions: 1, receipts: 1, runs: 1, reservations: 1,
        outboxes: 1, operations: 1 });
      const bundle = (await pool.query<{ run_id: string; admission_id: string; receipt_run_id: string;
        receipt_admission_id: string; hard_cap_micro_usd: string; reservation_micro_usd: string;
        reserved_input_tokens: string; reserved_output_tokens: string; max_input_tokens: number;
        max_output_tokens: number; input_rate: string; output_rate: string; reservation_digest: string;
        worker_job_id: string; provider_call_count: number; provider_call_state: string }>(`SELECT
          run.id::text run_id,run.processing_admission_id::text admission_id,
          receipt.semantic_run_id::text receipt_run_id,receipt.semantic_admission_id::text receipt_admission_id,
          run.hard_cap_micro_usd::text,run.reservation_micro_usd::text,
          reservation.reserved_input_tokens::text,reservation.reserved_output_tokens::text,
          run.max_input_tokens,run.max_output_tokens,run.input_usd_per_million_tokens::text input_rate,
          run.output_usd_per_million_tokens::text output_rate,reservation.reservation_digest,
          outbox.worker_job_id,run.provider_call_count,run.provider_call_state
        FROM signal_semantic_context_proposal_runs run
        JOIN signal_brand_context_processing_receipts receipt ON receipt.semantic_run_id=run.id
        JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
        JOIN signal_semantic_context_proposal_outbox outbox ON outbox.run_id=run.id
        WHERE run.id=$1::uuid`, [started.run_id])).rows[0]!;
      assert.equal(bundle.run_id, bundle.receipt_run_id);
      assert.equal(bundle.admission_id, bundle.receipt_admission_id);
      assert.equal(bundle.hard_cap_micro_usd, "1000000");
      assert.equal(bundle.max_output_tokens, Number(bundle.reserved_output_tokens));
      assert.ok(Number(bundle.reserved_input_tokens) > 0
        && Number(bundle.reserved_input_tokens) < bundle.max_input_tokens,
      "the real prompt estimate is positive and narrower than the sealed provider ceiling");
      const expectedReservation = signalSemanticContextProposalCostMicroUsdV1({
        input_tokens: Number(bundle.reserved_input_tokens), output_tokens: Number(bundle.reserved_output_tokens),
        input_usd_per_million_tokens: bundle.input_rate,
        output_usd_per_million_tokens: bundle.output_rate
      });
      assert.equal(bundle.reservation_micro_usd, expectedReservation.toString());
      assert.equal(bundle.reservation_digest, signalSemanticContextProposalDigestV1({
        run_id: bundle.run_id, reservation_micro_usd: bundle.reservation_micro_usd,
        max_input_tokens: Number(bundle.reserved_input_tokens),
        max_output_tokens: Number(bundle.reserved_output_tokens) }));
      assert.equal(bundle.worker_job_id, `semantic-context-proposal-${bundle.run_id}`);
      assert.deepEqual(await startComposedFixture(pool, fixture, quote.quote_digest!, "positive-request"),
        { ...started, replayed: true });
      assert.deepEqual(await composedBundleCounts(pool, fixture.workspaceId), complete,
        "exact replay creates no second operation, run, reservation or outbox");
      await assert.rejects(startComposedFixture(pool, fixture, digest("other-quote"), "positive-request"),
        (error: unknown) => (error as { code?: string }).code === "processing_idempotency_conflict");
      assert.deepEqual(await composedBundleCounts(pool, fixture.workspaceId), complete);

      await pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='processing',
        started_at=clock_timestamp(),provider_call_state='in_flight',provider_call_count=1
        WHERE id=$1::uuid`, [bundle.run_id]);
      await pool.query(`UPDATE user_brand_access SET revoked_at=clock_timestamp()
        WHERE user_id=$1::uuid AND brand_id=$2::uuid`, [fixture.clientActorId, fixture.brandId]);
      const response = "{\"synthetic\":true}";
      await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='response_persisted',
        provider_response_private=$2,provider_response_digest=$3 WHERE id=$1::uuid`,
      [bundle.run_id, response, digest(response)]);
      const actual = signalSemanticContextProposalCostMicroUsdV1({ input_tokens: 1, output_tokens: 1,
        input_usd_per_million_tokens: bundle.input_rate,
        output_usd_per_million_tokens: bundle.output_rate });
      await pool.query(`UPDATE signal_semantic_context_budget_reservations SET status='settled',
        input_tokens=1,output_tokens=1,actual_micro_usd=$2,settled_at=clock_timestamp()
        WHERE run_id=$1::uuid`, [bundle.run_id, actual.toString()]);
      await pool.query(`UPDATE signal_semantic_context_proposal_runs SET provider_call_state='settled',
        input_tokens=1,output_tokens=1,settled_micro_usd=$2 WHERE id=$1::uuid`,
      [bundle.run_id, actual.toString()]);
      const recovered = (await pool.query<{ provider_call_state: string; provider_call_count: number;
        status: string; actual_micro_usd: string }>(`SELECT run.provider_call_state,run.provider_call_count,
          reservation.status,reservation.actual_micro_usd::text FROM signal_semantic_context_proposal_runs run
          JOIN signal_semantic_context_budget_reservations reservation ON reservation.run_id=run.id
          WHERE run.id=$1::uuid`, [bundle.run_id])).rows[0]!;
      assert.deepEqual(recovered, { provider_call_state: "settled", provider_call_count: 1,
        status: "settled", actual_micro_usd: actual.toString() });

      const blocked = await seedComposedFixture(pool, "revoked-before-send");
      const blockedQuote = await quoteComposedFixture(pool, blocked);
      const blockedRun = await startComposedFixture(pool, blocked, blockedQuote.quote_digest!, "blocked-send-request");
      await pool.query(`UPDATE user_brand_access SET revoked_at=clock_timestamp()
        WHERE user_id=$1::uuid AND brand_id=$2::uuid`, [blocked.clientActorId, blocked.brandId]);
      await assert.rejects(pool.query(`UPDATE signal_semantic_context_proposal_runs SET status='processing',
        started_at=clock_timestamp(),provider_call_state='in_flight',provider_call_count=1
        WHERE id=$1::uuid`, [blockedRun.run_id]),
      (error: unknown) => (error as { message?: string }).message === "processing_forbidden");
      assert.deepEqual((await pool.query(`SELECT provider_call_state,provider_call_count
        FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [blockedRun.run_id])).rows[0],
      { provider_call_state: "not_started", provider_call_count: 0 });
    } finally { await pool.end(); }
  });
