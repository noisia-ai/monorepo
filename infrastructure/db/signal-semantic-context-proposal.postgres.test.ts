import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
  signalSemanticContextProposalDigestV1
} from "@noisia/query-engine";
import {
  SignalSemanticContextProviderCallError,
  loadSignalSemanticContextProposalPreflightRuntimeV1,
  loadSignalSemanticContextProposalRunV1,
  prepareSignalSemanticContextProposalInputV1,
  processSignalSemanticContextProposalRunV1,
  retrySignalSemanticContextProposalRunV1,
  startSignalSemanticContextProposalRunV1,
  type SignalSemanticContextProposalRuntimeConfigurationV1
} from "./signal-semantic-context-proposal";

const DB_URL = process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INTEGRATION_APPROVED === "true";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const runtime = { queue_configured: true, worker_alive: true, recovery_alive: true };
const configuration: SignalSemanticContextProposalRuntimeConfigurationV1 = {
  available: true, provider: "anthropic", model: "fixture-model", model_version: "immutable-fixture-v1",
  pricing_version: "fixture-pricing-v1", max_input_tokens: 20_000, max_output_tokens: 64_000,
  model_max_output_tokens: 64_000,
  input_usd_per_million_tokens: "3", output_usd_per_million_tokens: "15",
  platform_hard_cap_micro_usd: 1_000_000n
};

test("0092 runs one bounded call, appends pending proposals atomically, and recovers fail-closed", {
  skip: !DB_URL || !APPROVED, timeout: 240_000
}, async () => {
  assert.ok(DB_URL); requireLocal(DB_URL);
  const admin = new pg.Client({ connectionString: DB_URL, ssl: false }); await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory = resolve(process.cwd(), "migrations");
    for (const file of (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
      await admin.query(await readFile(join(directory, file), "utf8"));
    }
  } finally { await admin.end(); }
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: false, max: 12 });
  try {
    const missingLineage = await seedFixture(pool, "missing-lineage", { providerLineage: false });
    const missingLineagePreflight = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: missingLineage.workspace, actor: missingLineage.actor,
      generation_key: missingLineage.generation_key, configuration, runtime
    });
    assert.ok(missingLineagePreflight.blockers.includes("provider_lineage_required"));
    assert.ok(!missingLineagePreflight.blockers.includes("provider_lineage_drift"));
    const fixture = await seedFixture(pool, "happy");
    const before = await protectedCounts(pool, fixture.workspace.id);
    const preflight = await loadSignalSemanticContextProposalPreflightRuntimeV1({ queryable: pool,
      workspace: fixture.workspace, actor: fixture.actor, generation_key: fixture.generation_key,
      configuration, runtime });
    assert.equal(preflight.readiness, "ready"); assert.deepEqual(preflight.blockers, []);
    assert.equal(preflight.provider_calls, 0); assert.equal(preflight.writes_performed, false);
    const starts = await Promise.all([1, 2].map(() => startSignalSemanticContextProposalRunV1({ pool,
      workspace: fixture.workspace, actor: fixture.actor, idempotency_key: "happy-start-idempotency",
      generation_key: fixture.generation_key, preflight_digest: preflight.preflight_digest,
      confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION, hard_cap_micro_usd: 1_000_000n,
      configuration, runtime })));
    assert.deepEqual(starts[0], starts[1], "concurrent same-key replay returns one run");
    const started = starts[0]!;
    const prepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: fixture.workspace, generation_key: fixture.generation_key });
    const sourceAlias = prepared.input.knowledge_blocks[0]!.source_alias;
    let calls = 0;
    const result = await processSignalSemanticContextProposalRunV1({ pool, run_id: await runId(pool, started.run_key),
      provider: { async generate() { calls += 1; return { text: validResponse(sourceAlias,
        prepared.input.identity.primary.entity_ref), provider_request_id: "fixture-request",
        usage: { input_tokens: 1_000, output_tokens: 500 } }; } } });
    assert.equal(result.status, "completed"); assert.equal(calls, 1);
    const state = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: fixture.workspace, actor: fixture.actor, run_key: started.run_key });
    assert.equal(state.status, "completed"); assert.equal(state.provider_call_count, 1);
    assert.equal(state.proposal_count, 1); assert.equal(state.budget.settled_micro_usd, "10500");
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [await runId(pool, started.run_key)])).status, "completed");
    assert.deepEqual(await elementCounts(pool, fixture.workspace.id), { pending: 1, approved: 0, rejected: 0 });
    assert.deepEqual(await protectedCounts(pool, fixture.workspace.id), before);
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool,
      run_id: await runId(pool, started.run_key), provider: { async generate() {
        calls += 1; throw new Error("must not run"); } } })).status, "already_claimed_or_terminal");
    assert.equal(calls, 1);
    const runEvents = await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_run_events
      WHERE run_id=$1::uuid`, [await runId(pool, started.run_key)]);
    assert.ok(runEvents >= 6);

    const capacityFixture = await seedFixture(pool, "capacity");
    const capacityPreflight = await preflightFor(pool, capacityFixture);
    assert.ok(capacityPreflight.capacity);
    assert.ok(capacityPreflight.capacity.target_proposals >= 40);
    assert.ok(capacityPreflight.capacity.maximum_proposals >= 50);
    assert.equal(capacityPreflight.max_output_tokens,
      capacityPreflight.capacity.output_token_budget);
    const capacityRun = await startFor(pool, capacityFixture, "capacity-start");
    const capacityPrepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: pool, workspace: capacityFixture.workspace,
      generation_key: capacityFixture.generation_key
    });
    await processSignalSemanticContextProposalRunV1({ pool, run_id: capacityRun.id,
      provider: { async generate() { return {
        text: validResponseCount(capacityPrepared.input.knowledge_blocks[0]!.source_alias,
          capacityPrepared.input.identity.primary.entity_ref, 50),
        provider_request_id: "fixture-capacity-request",
        usage: { input_tokens: 1_000, output_tokens: 8_000 }
      }; } } });
    assert.deepEqual(await elementCounts(pool, capacityFixture.workspace.id),
      { pending: 50, approved: 0, rejected: 0 });

    const invalid = await seedFixture(pool, "invalid");
    const invalidRun = await startFor(pool, invalid, "invalid-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: invalidRun.id,
      provider: { async generate() { return { text: JSON.stringify({ contract_version:
        SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION, proposals: [{ bad: true }] }),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } }));
    assert.deepEqual(await elementCounts(pool, invalid.workspace.id), { pending: 0, approved: 0, rejected: 0 });
    assert.deepEqual(await row(pool, `SELECT status,actual_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [invalidRun.id]),
    { status: "settled", actual_micro_usd: "180" });
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [invalidRun.id])).status, "dead_letter");
    const invalidState = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: invalid.workspace, actor: invalid.actor, run_key: invalidRun.run_key });
    assert.equal(invalidState.error?.code, "semantic_context_provider_required_field_invalid");
    assert.doesNotMatch(invalidState.error?.message ?? "", /logical_path|provider_response_private|bad/u);
    const invalidPrivate = JSON.parse(String((await row(pool, `SELECT error_summary FROM
      signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [invalidRun.id])).error_summary));
    assert.equal(invalidPrivate.code, "semantic_context_provider_required_field_invalid");
    assert.ok(invalidPrivate.issue_count > 0);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_run_events
      WHERE run_id=$1::uuid AND event_kind='failed'`, [invalidRun.id]), 1);

    const truncated = await seedFixture(pool, "truncated");
    const truncatedRun = await startFor(pool, truncated, "truncated-start");
    const truncatedPrepared = await prepareSignalSemanticContextProposalInputV1({
      queryable: pool, workspace: truncated.workspace,
      generation_key: truncated.generation_key
    });
    let truncatedCalls = 0;
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: truncatedRun.id,
      provider: { async generate() { truncatedCalls += 1; return {
        text: "```json\n{\"contract_version\":\"signal-semantic-context-proposal-output-v1\",",
        provider_request_id: null,
        usage: { input_tokens: 10, output_tokens: truncatedPrepared.capacity.output_token_budget }
      }; } } }), /semantic_context_provider_response_truncated/u);
    const truncatedState = await loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: truncated.workspace, actor: truncated.actor, run_key: truncatedRun.run_key });
    assert.equal(truncatedState.error?.code, "semantic_context_provider_response_truncated");
    assert.equal(truncatedState.provider_call_count, 1);
    assert.equal((await elementCounts(pool, truncated.workspace.id)).pending, 0);
    await assert.rejects(retrySignalSemanticContextProposalRunV1({ pool,
      workspace: truncated.workspace, actor: truncated.actor,
      idempotency_key: "truncated-retry-blocked", run_key: truncatedRun.run_key
    }), /not_retryable/u);
    assert.equal(truncatedCalls, 1);

    const alias = await seedFixture(pool, "alias"); const aliasRun = await startFor(pool, alias, "alias-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: aliasRun.id,
      provider: { async generate() { return { text: validResponse("src.9999", "entity.primary"),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } }),
    /evidence_alias_unknown/u);
    assert.equal((await elementCounts(pool, alias.workspace.id)).pending, 0);

    const retry = await seedFixture(pool, "retry"); const retryRun = await startFor(pool, retry, "retry-start");
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: retryRun.id,
      provider: { async generate() { throw new SignalSemanticContextProviderCallError("not sent", true); } } }));
    const retryState = await row(pool, `SELECT status,provider_call_state,provider_call_count
      FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [retryRun.id]);
    assert.deepEqual(retryState, { status: "failed", provider_call_state: "not_started", provider_call_count: 0 });
    await retrySignalSemanticContextProposalRunV1({ pool, workspace: retry.workspace, actor: retry.actor,
      idempotency_key: "retry-operation-idempotency", run_key: retryRun.run_key });
    const retryPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: retry.workspace, generation_key: retry.generation_key });
    await processSignalSemanticContextProposalRunV1({ pool, run_id: retryRun.id,
      provider: { async generate() { return { text: validResponse(
        retryPrepared.input.knowledge_blocks[0]!.source_alias, retryPrepared.input.identity.primary.entity_ref),
        provider_request_id: null, usage: { input_tokens: 10, output_tokens: 10 } }; } } });
    assert.equal((await elementCounts(pool, retry.workspace.id)).pending, 1);

    const crash = await seedFixture(pool, "crash"); const crashRun = await startFor(pool, crash, "crash-start");
    let crashCalls = 0;
    await assert.rejects(processSignalSemanticContextProposalRunV1({ pool, run_id: crashRun.id,
      crash_after_provider_response_for_test: true, provider: { async generate() { crashCalls += 1;
        return { text: validResponse("src.0001", "entity.primary"), provider_request_id: null,
          usage: { input_tokens: 10, output_tokens: 10 } }; } } }));
    await pool.query(`UPDATE signal_semantic_context_proposal_runs SET lease_expires_at=now()-interval '1 second'
      WHERE id=$1::uuid`, [crashRun.id]);
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: crashRun.id,
      provider: { async generate() { crashCalls += 1; throw new Error("duplicate"); } } })).status,
    "already_claimed_or_terminal");
    assert.equal(crashCalls, 1); assert.equal((await row(pool,
      `SELECT status FROM signal_semantic_context_proposal_runs WHERE id=$1::uuid`, [crashRun.id])).status,
    "dead_letter");
    const crashBudget = await row(pool, `SELECT status,actual_micro_usd::text,
      reservation_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [crashRun.id]);
    assert.equal(crashBudget.status, "settled");
    assert.equal(crashBudget.actual_micro_usd, crashBudget.reservation_micro_usd);
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [crashRun.id])).status, "dead_letter");

    const driftBefore = await seedFixture(pool, "drift-before");
    const beforeRun = await startFor(pool, driftBefore, "drift-before-start");
    await pool.query(`UPDATE brand_os_profiles SET metadata=jsonb_set(metadata,'{snapshot_hash}',to_jsonb($2::text))
      WHERE id=$1::uuid`, [driftBefore.profile_id, digest("changed")]);
    let beforeCalls = 0;
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: beforeRun.id,
      provider: { async generate() { beforeCalls += 1; throw new Error("blocked"); } } })).status, "stale");
    assert.equal(beforeCalls, 0);
    assert.equal((await row(pool, `SELECT status FROM signal_semantic_context_proposal_outbox
      WHERE run_id=$1::uuid`, [beforeRun.id])).status, "completed");

    const driftDuring = await seedFixture(pool, "drift-during");
    const duringRun = await startFor(pool, driftDuring, "drift-during-start");
    const duringPrepared = await prepareSignalSemanticContextProposalInputV1({ queryable: pool,
      workspace: driftDuring.workspace, generation_key: driftDuring.generation_key });
    assert.equal((await processSignalSemanticContextProposalRunV1({ pool, run_id: duringRun.id,
      provider: { async generate() { await pool.query(`UPDATE brand_os_profiles SET metadata=metadata||
          '{"features":["changed during execution"]}'::jsonb WHERE id=$1::uuid`, [driftDuring.profile_id]);
        return { text: validResponse(duringPrepared.input.knowledge_blocks[0]!.source_alias,
          duringPrepared.input.identity.primary.entity_ref), provider_request_id: null,
          usage: { input_tokens: 10, output_tokens: 10 } }; } } })).status, "stale");
    assert.equal((await elementCounts(pool, driftDuring.workspace.id)).pending, 0);
    assert.deepEqual(await row(pool, `SELECT status,actual_micro_usd::text FROM
      signal_semantic_context_budget_reservations WHERE run_id=$1::uuid`, [duringRun.id]),
    { status: "settled", actual_micro_usd: "180" });

    await assert.rejects(loadSignalSemanticContextProposalRunV1({ queryable: pool,
      workspace: invalid.workspace, actor: invalid.actor, run_key: started.run_key }), /not_found/u);
    const future = await seedFixture(pool, "cap");
    const configuredCapacity = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: future.workspace, actor: future.actor,
      generation_key: future.generation_key,
      configuration: { ...configuration, max_output_tokens: 5_000 }, runtime
    });
    assert.ok(configuredCapacity.blockers.includes(
      "semantic_context_configured_output_capacity_insufficient"
    ));
    const unsupportedModelCapacity = await loadSignalSemanticContextProposalPreflightRuntimeV1({
      queryable: pool, workspace: future.workspace, actor: future.actor,
      generation_key: future.generation_key,
      configuration: { ...configuration, model_max_output_tokens: 5_000 }, runtime
    });
    assert.ok(unsupportedModelCapacity.blockers.includes(
      "semantic_context_model_output_capacity_unsupported"
    ));
    const capPreflight = await preflightFor(pool, future);
    const operationsBefore = await scalar(pool, `SELECT count(*)::int count FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid`, [future.workspace.id]);
    await assert.rejects(startSignalSemanticContextProposalRunV1({ pool, workspace: future.workspace,
      actor: future.actor, idempotency_key: "cap-start-idempotency", generation_key: future.generation_key,
      preflight_digest: capPreflight.preflight_digest, confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
      hard_cap_micro_usd: 1n, configuration, runtime }), /hard_cap_insufficient/u);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_governance_control_operations
      WHERE workspace_id=$1::uuid`, [future.workspace.id]), operationsBefore);
    assert.equal(await scalar(pool, `SELECT count(*)::int count FROM signal_semantic_context_proposal_outbox
      WHERE workspace_id=$1::uuid`, [future.workspace.id]), 0);
  } finally { await pool.end(); }
});

async function seedFixture(pool: pg.Pool, label: string,
  options: { providerLineage?: boolean } = {}) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`; const org = randomUUID();
  const brand = randomUUID(); const user = randomUUID(); const profile = randomUUID();
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
    VALUES($1::uuid,$2,$2,$2,'active')`, [org, suffix]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin','active')`, [user, `${suffix}@example.test`, suffix]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,industry,industry_sub,countries,status)
    VALUES($1::uuid,$2::uuid,$3,$3,$3,'Technology','Assistants',ARRAY['MX']::char(2)[],'active')`,
  [brand, org, suffix]);
  const workspace = (await pool.query<{ id: string }>(`SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid`, [brand])).rows[0]!;
  await pool.query(`UPDATE signal_workspaces SET timezone='America/Mexico_City' WHERE id=$1::uuid`, [workspace.id]);
  const brandDigest = digest(`${suffix}-brand`);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,'Profile','active',1,jsonb_build_object(
      'snapshot_hash',$4::text,'aliases',jsonb_build_array('Fixture alias'),'features',jsonb_build_array('Voice')))`,
  [profile, org, brand, brandDigest]);
  await pool.query(`INSERT INTO brand_os_products(brand_os_profile_id,name,product_type,description,status)
    VALUES($1::uuid,'Fixture product','device','Fixture governed product','active')`, [profile]);
  await pool.query(`INSERT INTO brand_os_competitors(brand_os_profile_id,competitor_name,role,priority)
    VALUES($1::uuid,'Fixture competitor','direct',1)`, [profile]);
  const source = randomUUID();
  await pool.query(`INSERT INTO brand_knowledge_sources(id,organization_id,brand_id,source_kind,title,
    raw_text,extracted_payload,status) VALUES($1::uuid,$2::uuid,$3::uuid,'operator-note','Strategy',
      'Governed private strategy', '{}'::jsonb,'active')`, [source, org, brand]);
  await pool.query(`INSERT INTO knowledge_chunks(knowledge_source_id,chunk_index,chunk_text)
    VALUES($1::uuid,0,'Governed benefit and limitation')`, [source]);
  await pool.query(`INSERT INTO knowledge_assertions(knowledge_source_id,assertion_text,assertion_type,status)
    VALUES($1::uuid,'A governed assertion','positioning','approved')`, [source]);
  const knowledgeDigest = await currentKnowledgeDigest(pool, org, brand);
  const localeDigest = signalSemanticContextProposalDigestV1({ primary_locale: "es-MX",
    locale_variants: ["es-MX", "en-US"], markets: ["MX", "US"], timezone: "America/Mexico_City" });
  const operation = randomUUID();
  await pool.query(`INSERT INTO signal_governance_control_operations(id,workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,$3::uuid,
      'create-semantic-context-draft',$4,$5,'in_progress')`, [operation, workspace.id, user,
    digest(`${suffix}-request`), digest(`${suffix}-key`)]);
  const authorityDigest = signalSemanticContextProposalDigestV1({ brand_os_digest: brandDigest,
    knowledge_digest: knowledgeDigest, locale_context_digest: localeDigest });
  const artifact = (await pool.query<{ id: string }>(`INSERT INTO analysis_artifacts(
    workspace_id,workspace_artifact_kind,workspace_authority_digest,artifact_key,artifact_type,
    content,review_status,revision,metadata) VALUES($1::uuid,'semantic_context',$2,$3,
      'semantic_context_pack_generation','{}'::jsonb,'needs_review',1,'{}'::jsonb) RETURNING id::text`,
  [workspace.id, authorityDigest, `context-${suffix}`])).rows[0]!;
  const generationKey = `context-${suffix}`;
  await pool.query(`INSERT INTO signal_semantic_context_generations(workspace_id,artifact_id,generation_key,
    generation_version,status,brand_os_profile_id,brand_os_profile_version,brand_os_digest,
    knowledge_generation_key,knowledge_digest,locale_context_digest,primary_locale,locale_variants,
    markets,timezone,proposal_model,proposal_model_version,proposal_prompt_digest,proposal_pricing_version,
    draft_digest,created_operation_id,created_by_user_id) VALUES($1::uuid,$2::uuid,$3,1,'draft',
      $4::uuid,1,$5,$6,$7,$8,'es-MX',ARRAY['es-MX','en-US']::text[],ARRAY['MX','US']::text[],
      'America/Mexico_City',$9,$10,$11,$12,$13,$14::uuid,$15::uuid)`, [workspace.id, artifact.id,
    generationKey, profile, brandDigest, `knowledge-${knowledgeDigest.slice(7, 23)}`, knowledgeDigest,
    localeDigest, options.providerLineage === false ? null : configuration.model,
    options.providerLineage === false ? null : configuration.model_version,
    options.providerLineage === false ? null : SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
    options.providerLineage === false ? null : configuration.pricing_version,
    digest(`${suffix}-draft`), operation, user]);
  return { workspace: { id: workspace.id, organization_id: org, brand_id: brand },
    actor: { id: user, user_type: "noisia_internal" as const }, generation_key: generationKey,
    profile_id: profile };
}

async function currentKnowledgeDigest(pool: pg.Pool, org: string, brand: string) {
  const sources = await pool.query<{ id: string; kind: string; digest: string }>(`SELECT id::text,
    source_kind kind,'sha256:'||encode(digest(COALESCE(raw_text,'')||extracted_payload::text,'sha256'),'hex') digest
    FROM brand_knowledge_sources WHERE organization_id=$1::uuid AND brand_id=$2::uuid ORDER BY id`, [org, brand]);
  const chunks = await pool.query<{ id: string; source_id: string; content_digest: string }>(`SELECT chunk.id::text,
    chunk.knowledge_source_id::text source_id,'sha256:'||encode(digest(chunk.chunk_text,'sha256'),'hex') content_digest
    FROM knowledge_chunks chunk JOIN brand_knowledge_sources source ON source.id=chunk.knowledge_source_id
    WHERE source.organization_id=$1::uuid AND source.brand_id=$2::uuid ORDER BY chunk.id`, [org, brand]);
  return signalSemanticContextProposalDigestV1({ sources: sources.rows, chunks: chunks.rows });
}

async function preflightFor(pool: pg.Pool, fixture: Awaited<ReturnType<typeof seedFixture>>) {
  return loadSignalSemanticContextProposalPreflightRuntimeV1({ queryable: pool, workspace: fixture.workspace,
    actor: fixture.actor, generation_key: fixture.generation_key, configuration, runtime });
}
async function startFor(pool: pg.Pool, fixture: Awaited<ReturnType<typeof seedFixture>>, key: string) {
  const preflight = await preflightFor(pool, fixture); assert.equal(preflight.readiness, "ready");
  const run = await startSignalSemanticContextProposalRunV1({ pool, workspace: fixture.workspace,
    actor: fixture.actor, idempotency_key: `${key}-idempotency`, generation_key: fixture.generation_key,
    preflight_digest: preflight.preflight_digest, confirmation: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION,
    hard_cap_micro_usd: 1_000_000n, configuration, runtime });
  return { ...run, id: await runId(pool, run.run_key) };
}
function validResponse(sourceAlias: string, entityRef: string) { return JSON.stringify({
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  proposals: [{ element_key: "identity.fixture", element_kind: "identity_term",
    canonical_key: "fixture", display_text: "Fixture identity", scope: "primary_brand",
    entity_type: "brand", entity_ref: entityRef, locale: "es-MX", relation_kind: null,
    relation_target_key: null, confidence: 1,
    evidence: [{ source_alias: sourceAlias, relation_type: "supports" }] }]
}); }
function validResponseCount(sourceAlias: string, entityRef: string, count: number) {
  return JSON.stringify({
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
    proposals: Array.from({ length: count }, (_, index) => ({
      element_key: `feature.fixture-${index + 1}`,
      element_kind: "feature",
      canonical_key: `fixture-${index + 1}`,
      display_text: `Fixture feature ${index + 1}`,
      scope: "primary_brand",
      entity_type: "brand",
      entity_ref: entityRef,
      locale: "es-MX",
      relation_kind: null,
      relation_target_key: null,
      confidence: 1,
      evidence: [{ source_alias: sourceAlias, relation_type: "supports" }]
    }))
  });
}
async function runId(pool: pg.Pool, runKey: string) { return (await pool.query<{ id: string }>(
  `SELECT id::text FROM signal_semantic_context_proposal_runs WHERE run_key=$1`, [runKey])).rows[0]!.id; }
async function elementCounts(pool: pg.Pool, workspaceId: string) { return row(pool, `SELECT
  count(*) FILTER(WHERE disposition='pending')::int pending,
  count(*) FILTER(WHERE disposition='approved')::int approved,
  count(*) FILTER(WHERE disposition='rejected')::int rejected
  FROM signal_semantic_context_element_versions WHERE workspace_id=$1::uuid`, [workspaceId]); }
async function protectedCounts(pool: pg.Pool, workspaceId: string) { return {
  assignments: await scalar(pool, `SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`, [workspaceId]),
  tags: await scalar(pool, `SELECT count(*)::int count FROM record_tags`, []),
  pointers: await scalar(pool, `SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`, [workspaceId]),
  bindings: await scalar(pool, `SELECT count(*)::int count FROM signal_governed_view_bindings WHERE workspace_id=$1::uuid`, [workspaceId])
}; }
async function scalar(pool: pg.Pool, sql: string, values: unknown[]) { return (await pool.query<{ count: number }>(sql, values)).rows[0]!.count; }
async function row(pool: pg.Pool, sql: string, values: unknown[]) { return (await pool.query(sql, values)).rows[0] as Record<string, unknown>; }
function requireLocal(url: string) { if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname))
  throw new Error("Refusing non-local PostgreSQL target."); }
