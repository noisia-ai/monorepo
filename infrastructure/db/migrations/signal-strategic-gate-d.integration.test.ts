import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_GATE_D_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_GATE_D_INTEGRATION_APPROVED === "true";
const migrationDir = dirname(fileURLToPath(import.meta.url));

test("0074 is data-neutral, idempotent and closes strategic authority contracts", {
  skip: !DATABASE_URL || !APPROVED
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && file <= "0074_signal_strategic_gate_d_preflight.sql")
      .sort();
    for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query(await readFile(join(migrationDir, "0074_signal_strategic_gate_d_preflight.sql"), "utf8"));

    assert.deepEqual((await client.query(`SELECT
      signal_governed_view_required_usage_purposes_v1('triggers-barriers','strategic') AS usages,
      (SELECT count(*)::int FROM signal_strategic_run_controls) AS controls,
      (SELECT count(*)::int FROM signal_strategic_sealed_sample_items) AS samples,
      (SELECT count(*)::int FROM signal_strategic_budget_reservations) AS reservations,
      (SELECT count(*)::int FROM signal_strategic_step_outbox) AS steps,
      (SELECT count(*)::int FROM signal_governed_view_bindings
        WHERE module_key='triggers-barriers' AND view_key='strategic') AS bindings
    `)).rows[0], {
      usages: ["llm-processing", "strategic-analysis"],
      controls: 0,
      samples: 0,
      reservations: 0,
      steps: 0,
      bindings: 0
    });

    const sentinelNames = (await client.query<{ name: string }>(`
      SELECT proname AS name FROM pg_proc WHERE proname IN (
        'ensure_signal_strategic_population_derivation_v1',
        'enforce_signal_strategic_compilation_authority_v1',
        'enforce_signal_governance_unknown_availability_v1',
        'invalidate_signal_governed_workspace_brand_registry_v1',
        'reserve_signal_strategic_budget_v1',
        'request_signal_strategic_run_cancel_v1'
      ) ORDER BY proname
    `)).rows.map((row) => row.name);
    assert.deepEqual(sentinelNames, [
      "enforce_signal_governance_unknown_availability_v1",
      "enforce_signal_strategic_compilation_authority_v1",
      "ensure_signal_strategic_population_derivation_v1",
      "invalidate_signal_governed_workspace_brand_registry_v1",
      "request_signal_strategic_run_cancel_v1",
      "reserve_signal_strategic_budget_v1"
    ]);

    const availability = (await client.query<{
      evaluation_nullable: boolean;
      compilation_nullable: boolean;
      workspace_trigger: boolean;
    }>(`SELECT
      (SELECT is_nullable='YES' FROM information_schema.columns
        WHERE table_schema='public' AND table_name='signal_data_governance_evaluations'
          AND column_name='governance_unknown_count') AS evaluation_nullable,
      (SELECT is_nullable='YES' FROM information_schema.columns
        WHERE table_schema='public' AND table_name='signal_population_policy_compilations'
          AND column_name='governance_unknown_count') AS compilation_nullable,
      EXISTS (SELECT 1 FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid=trigger.tgrelid
        WHERE relation.relname='signal_workspaces'
          AND trigger.tgname='trg_signal_governed_workspace_brand_registry_invalidation'
          AND NOT trigger.tgisinternal) AS workspace_trigger
    `)).rows[0];
    assert.deepEqual(availability, {
      evaluation_nullable: true,
      compilation_nullable: true,
      workspace_trigger: true
    });
    const v2FunctionContracts = (await client.query<{ review: string; release: string }>(`SELECT
      pg_get_functiondef('review_signal_tb_reusable_assertion(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure)
        AS review,
      pg_get_functiondef('enforce_signal_strategic_release_scope()'::regprocedure) AS release`)).rows[0]!;
    assert.match(v2FunctionContracts.review, /signal-tb-strategic-v2/u);
    assert.match(v2FunctionContracts.release, /signal-tb-strategic-v2/u);

    await assert.rejects(
      client.query(`INSERT INTO signal_data_governance_evaluations (
        workspace_id,policy_bundle_id,population_id,quality_policy_id,usage_purposes,
        retention_policy_digest,licensing_policy_digest,policy_evaluation_watermark,
        governance_digest,definition_hash,evaluated_by_user_id,idempotency_key,module_key,view_key
      ) VALUES (
        gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
        ARRAY['strategic-analysis']::text[],
        'sha256:'||repeat('a',64),'sha256:'||repeat('a',64),now(),
        'sha256:'||repeat('a',64),'sha256:'||repeat('a',64),gen_random_uuid(),
        'sha256:'||repeat('a',64),'triggers-barriers','strategic'
      )`),
      (error: unknown) => ["23503", "23514"].includes((error as { code?: string }).code ?? "")
    );

    const fixture = await seedStrategicFixture(client);
    await exerciseAtomicLaunchAndRuntime(client, fixture);
    await exerciseBudgetAndStepFsm(client, fixture);
  } finally {
    await client.end();
  }
});

function requireDisposableLocalDatabase(url: string) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      || !/(test|qa|fixture|tmp|local|smoke)/iu.test(parsed.pathname)) {
    throw new Error("Gate D integration requires an explicitly disposable local database.");
  }
}

const IDS = {
  organization: "74000000-0000-4000-8000-000000000001",
  actor: "74000000-0000-4000-8000-000000000002",
  otherOrganization: "74000000-0000-4000-8000-000000000003",
  otherActor: "74000000-0000-4000-8000-000000000004",
  brand: "74000000-0000-4000-8000-000000000005",
  workspace: "74000000-0000-4000-8000-000000000006",
  otherWorkspace: "74000000-0000-4000-8000-000000000007",
  otherBrand: "74000000-0000-4000-8000-000000000022",
  methodology: "74000000-0000-4000-8000-000000000008",
  corpus: "74000000-0000-4000-8000-000000000009",
  source: "74000000-0000-4000-8000-000000000010",
  quality: "74000000-0000-4000-8000-000000000011",
  bundle: "74000000-0000-4000-8000-000000000012",
  basePopulation: "74000000-0000-4000-8000-000000000013",
  population: "74000000-0000-4000-8000-000000000014",
  evaluation: "74000000-0000-4000-8000-000000000015",
  compilation: "74000000-0000-4000-8000-000000000016",
  binding: "74000000-0000-4000-8000-000000000017",
  mentionA: "74000000-0000-4000-8000-000000000018",
  mentionB: "74000000-0000-4000-8000-000000000019",
  taxonomy: "74000000-0000-4000-8000-000000000025",
  taxonomyTerm: "74000000-0000-4000-8000-000000000026",
  recordTag: "74000000-0000-4000-8000-000000000027"
} as const;

type StrategicFixture = {
  request: Record<string, unknown>;
  launch: { run_control_id: string; tb_analysis_id: string; snapshot_id: string;
    run_outbox_id: string; step_outbox_id: string; created: boolean };
  fullProvenanceDigest: string;
  nonSampleMention: string;
  sampleOnlyProvenanceDigest: string;
};

async function seedStrategicFixture(client: pg.Client): Promise<StrategicFixture> {
  const membershipDigest = digest("membership");
  const populationDefinitionHash = digest("population-definition");
  const policyDefinitionHash = digest("policy-definition");
  const compiledPlanHash = digest("compiled-plan");
  const governanceDigest = digest("governance");
  const watermarkHash = digest("watermark");
  const retentionDigest = digest("retention");
  const licensingDigest = digest("licensing");
  const qualityHash = digest("quality");
  const pathA = digest("path-a");
  const pathB = digest("path-b");
  await client.query("SET session_replication_role=replica");
  try {
    const seedSql = `
      INSERT INTO organizations(id,slug,legal_name,status) VALUES
        ($1::uuid,'gate-d','Gate D','active'),
        ($2::uuid,'gate-d-other','Gate D Other','active');
      INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
        ($3::uuid,'gate-d@example.test','Gate D','noisia_internal','admin',$1::uuid,'active'),
        ($4::uuid,'gate-d-other@example.test','Gate D Other','client','brand_manager',$2::uuid,'active');
      INSERT INTO brands(id,organization_id,slug,name,status) VALUES
        ($5::uuid,$1::uuid,'gate-d','Gate D','active'),
        ($37::uuid,$2::uuid,'gate-d-other','Gate D Other','active');
      INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,timezone,status) VALUES
        ($6::uuid,$1::uuid,$5::uuid,'gate-d','UTC','active'),
        ($7::uuid,$2::uuid,$37::uuid,'gate-d-other','UTC','active');
      INSERT INTO methodologies(id,slug,name,version,status,manifest_yaml)
        VALUES ($8::uuid,'triggers-barriers','Triggers & Barriers','1','active','{}');
      INSERT INTO study_corpora(id,brand_id,methodology_id,methodology_version_at_creation,
        status,current_pipeline_version,corpus_revision)
        VALUES ($9::uuid,$5::uuid,$8::uuid,'1','approved','v2',1);
      INSERT INTO signal_workspace_corpora(workspace_id,study_corpus_id,role)
        VALUES ($6::uuid,$9::uuid,'strategic');
      INSERT INTO signal_workspace_reports(workspace_id,report_key,title,report_type,status)
        VALUES ($6::uuid,'triggers-barriers','Triggers & Barriers','strategic','active');
      INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,
        connection_method,name,status)
        VALUES ($10::uuid,$6::uuid,$1::uuid,$5::uuid,'social-listening','fixture','csv','Fixture','active');
      INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,policy_version,
        status,canonical_root_disposition,definition_hash,created_by_user_id,activated_by_user_id,
        activated_at,creation_idempotency_key)
        VALUES ($11::uuid,$1::uuid,$6::uuid,'gate-d-quality',1,'active','evaluate',$20,$3::uuid,
          $3::uuid,now(),$21);
      INSERT INTO signal_population_policy_bundles(id,workspace_id,policy_key,policy_version,status,
        authorized_modules,allowed_scopes,acceptance_status,quality_contract_status,
        quality_policy_key,quality_policy_version,eligibility_policy,deduplication_policy,
        visibility_class,denominator_key,definition_hash,created_by_user_id,activated_by_user_id,
        activated_at,data_governance_contract_status,quality_policy_id,required_usage_purposes)
        VALUES ($12::uuid,$6::uuid,'gate-d-strategic',1,'active',ARRAY['triggers-barriers'],
          ARRAY['primary_brand'],'included','resolved','gate-d-quality',1,
          'semantic-approved-eligible','canonical-root','strategic-internal','snapshot-canonical-roots',
          $22,$3::uuid,$3::uuid,now(),'resolved',$11::uuid,
          ARRAY['llm-processing','strategic-analysis']);
      INSERT INTO signal_population_definitions(id,workspace_id,population_key,version,purpose,status,
        acceptance_status,allowed_scopes,definition_hash,created_by_user_id,membership_digest,definition)
        VALUES
        ($13::uuid,$6::uuid,'gate-d-base',1,'analysis','draft','included',ARRAY['primary_brand'],$23,$3::uuid,$24,'{}'),
        ($14::uuid,$6::uuid,'gate-d-strategic',1,'analysis','draft','included',ARRAY['primary_brand'],$25,$3::uuid,$24,'{}');
      INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,provider_record_id,
        external_id,source_system,text_hash,text_clean,text_snippet,text_length,language,published_at,
        platform,resolved_platform,quality_score,inclusion_status) VALUES
        ($18::uuid,$6::uuid,$10::uuid,$18::uuid,'a','gate-d-a','fixture',$26,'Fixture A','Fixture',9,'es',
          '2026-08-10T00:00:00Z','x','x',8,'included'),
        ($19::uuid,$6::uuid,$10::uuid,$19::uuid,'b','gate-d-b','fixture',$27,'Fixture B','Fixture',9,'es',
          '2026-08-11T00:00:00Z','x','x',8,'included');
      INSERT INTO signal_population_memberships(population_id,workspace_id,mention_id,
        membership_status,membership_reason) VALUES
        ($14::uuid,$6::uuid,$18::uuid,'included','fixture'),
        ($14::uuid,$6::uuid,$19::uuid,'included','fixture');
      INSERT INTO signal_governed_view_population_derivations(workspace_id,module_key,view_key,
        policy_bundle_id,base_population_id,resolved_population_id,policy_definition_hash,
        compiled_plan_hash,created_by_user_id)
        VALUES ($6::uuid,'triggers-barriers','strategic',$12::uuid,$13::uuid,$14::uuid,$22,$28,$3::uuid);
      INSERT INTO signal_data_governance_evaluations(id,workspace_id,policy_bundle_id,population_id,
        quality_policy_id,usage_purposes,evaluation_status,candidate_root_count,authorized_root_count,
        governance_unknown_count,retention_policy_digest,licensing_policy_digest,
        policy_evaluation_watermark,governance_digest,definition_hash,evaluated_by_user_id,
        idempotency_key,finalized_at,module_key,view_key)
        VALUES ($15::uuid,$6::uuid,$12::uuid,$14::uuid,$11::uuid,
          ARRAY['llm-processing','strategic-analysis'],'complete',2,2,0,$29,$30,now(),$31,$32,
          $3::uuid,$33,now(),'triggers-barriers','strategic');
      INSERT INTO signal_data_governance_evaluation_items(evaluation_id,workspace_id,mention_id,
        decision,reason_code,import_membership_id,provenance_binding_id,quality_policy_id,
        retention_policy_id,licensing_policy_id,governance_path_hash) VALUES
        ($15::uuid,$6::uuid,$18::uuid,'included','policy_eligible',$10::uuid,$10::uuid,$11::uuid,
          $10::uuid,$10::uuid,$34),
        ($15::uuid,$6::uuid,$19::uuid,'included','policy_eligible',$10::uuid,$10::uuid,$11::uuid,
          $10::uuid,$10::uuid,$35);
      INSERT INTO signal_population_policy_compilations(id,workspace_id,policy_bundle_id,population_id,
        module_key,view_key,compilation_version,compiled_plan_hash,policy_definition_hash,
        population_version,population_definition_hash,membership_digest,source_watermark_hash,
        source_watermark_at,compilation_status,governance_evaluation_id,quality_policy_id,
        quality_policy_version,quality_policy_hash,retention_policy_digest,licensing_policy_digest,
        usage_purposes,authorized_root_count,governance_unknown_count,policy_evaluation_watermark,
        governance_digest,is_current,compiled_by_user_id)
        VALUES ($16::uuid,$6::uuid,$12::uuid,$14::uuid,'triggers-barriers','strategic',1,$28,$22,
          1,$25,$24,$36,now(),'ready',$15::uuid,$11::uuid,1,$20,$29,$30,
          ARRAY['llm-processing','strategic-analysis'],2,0,now(),$31,true,$3::uuid);
      INSERT INTO signal_governed_view_bindings(id,workspace_id,module_key,view_key,binding_version,
        policy_bundle_id,policy_definition_hash,population_id,policy_compilation_id,binding_status,
        promoted_by_user_id)
        VALUES ($17::uuid,$6::uuid,'triggers-barriers','strategic',1,$12::uuid,$22,$14::uuid,$16::uuid,
          'current',$3::uuid);
      INSERT INTO taxonomies(id,taxonomy_key,name,scope,methodology_slug,status)
        VALUES ($38::uuid,'gate-d-strategic-taxonomy','Gate D Strategic','methodology',
          'triggers-barriers','active');
      INSERT INTO taxonomy_terms(id,taxonomy_id,term_key,label,status)
        VALUES ($39::uuid,$38::uuid,'gate-d-assertion','Gate D assertion','active');
    `;
    const seedValues = [IDS.organization, IDS.otherOrganization, IDS.actor, IDS.otherActor, IDS.brand,
      IDS.workspace, IDS.otherWorkspace, IDS.methodology, IDS.corpus, IDS.source, IDS.quality,
      IDS.bundle, IDS.basePopulation, IDS.population, IDS.evaluation, IDS.compilation, IDS.binding,
      IDS.mentionA, IDS.mentionB, qualityHash, digest("quality-create"), policyDefinitionHash,
      digest("base-definition"), membershipDigest, populationDefinitionHash, digest("text-a"),
      digest("text-b"), compiledPlanHash, retentionDigest, licensingDigest, governanceDigest,
      digest("evaluation-definition"), digest("evaluation-key"), pathA, pathB, watermarkHash,
      IDS.otherBrand, IDS.taxonomy, IDS.taxonomyTerm];
    await client.query(interpolateFixtureSql(seedSql, seedValues));
  } finally {
    await client.query("SET session_replication_role=origin");
  }

  const roots = [IDS.mentionA, IDS.mentionB].sort();
  const snapshotDigest = sha(roots.join(","));
  const sampleSeed = digest("sample-seed");
  const ranked = roots.map((id) => ({ id, rank: shaRaw([
    "canonical-root-sha256-rank-v1", sampleSeed, id.toLowerCase()
  ].join(String.fromCharCode(31))) })).sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id));
  const sampleDigest = sha(ranked[0]!.id);
  const fullProvenanceDigest = sha(roots.map((id) => `${id}:${id === IDS.mentionA ? pathA : pathB}`).join(","));
  const sampleOnlyProvenanceDigest = sha(`${ranked[0]!.id}:${ranked[0]!.id === IDS.mentionA ? pathA : pathB}`);
  const executionPlan: Record<string, unknown> = {
    contract_version: "signal-strategic-provider-budget-plan-v1",
    calls: [
      { operation: "preflight", count: 1, max_output_tokens: 8000 },
      { operation: "step1-open-pass", count: 1, max_output_tokens: 4000 },
      { operation: "step2-coding", count: 1, max_output_tokens: 8000 },
      { operation: "step3-hierarchy", count: 1, max_output_tokens: 8000 },
      { operation: "step4-mobility", count: 1, max_output_tokens: 8000 },
      { operation: "step6-synthesis", count: 2, max_output_tokens: 20000 },
      { operation: "step6-humanizer", count: 1, max_output_tokens: 26000 }
    ],
    planned_provider_calls: 8,max_input_tokens_per_call: 62500,
    reserved_input_tokens: 500000,reserved_output_tokens: 102000,
    // Deliberately lands below half a micro-dollar before rounding. The
    // reservation contract must round upward, exactly like Query Engine.
    reservation_upper_bound_usd: 0.602001
  };
  executionPlan.digest = (await client.query<{ digest: string }>(
    `SELECT signal_strategic_execution_plan_digest_v1($1::jsonb,'v2','gate-d-prompt-v1') AS digest`,
    [JSON.stringify(executionPlan)]
  )).rows[0]!.digest;
  const request: Record<string, unknown> = {
    authority: {
      binding_id: IDS.binding, policy_bundle_id: IDS.bundle,
      policy_compilation_id: IDS.compilation, governance_evaluation_id: IDS.evaluation,
      population_id: IDS.population, population_version: 1,
      population_definition_hash: populationDefinitionHash, membership_digest: membershipDigest,
      policy_definition_hash: policyDefinitionHash, compiled_plan_hash: compiledPlanHash,
      governance_digest: governanceDigest, provenance_digest: fullProvenanceDigest,
      watermark_hash: watermarkHash, next_policy_transition_at: null,
      usage_purposes: ["llm-processing", "strategic-analysis"]
    },
    execution: {
      study_corpus_id: IDS.corpus, period_start: "2026-08-01", period_end: "2026-08-31",
      timezone: "UTC", label: "Gate D fixture", pipeline_version: "v2",
      methodology_version: "1", prompt_version: "gate-d-prompt-v1",
      model_version: "fixture-model", corpus_revision: 1, provider: "anthropic",
      provider_config_digest: digest("fixture-provider-config"),
      pricing_version: "fixture-pricing-v1", input_usd_per_million_tokens: 1.0000002,
      output_usd_per_million_tokens: 1, estimated_cost_usd: 0.602001, hard_cap_usd: 1,
      business_question: "Fixture?", decision_to_inform: "Fixture."
    },
    execution_plan: executionPlan,
    sample: { algorithm: "canonical-root-sha256-rank-v1", seed: sampleSeed, count: 1, digest: sampleDigest }
  };
  const requestDigest = (await client.query<{ digest: string }>(
    "SELECT signal_strategic_launch_request_digest_v1($1::jsonb) AS digest", [JSON.stringify(request)]
  )).rows[0]!.digest;
  request.request_digest = requestDigest;
  return { request, fullProvenanceDigest, sampleOnlyProvenanceDigest,
    nonSampleMention: ranked[1]!.id,
    launch: {} as StrategicFixture["launch"] };
}

async function exerciseAtomicLaunchAndRuntime(client: pg.Client, fixture: StrategicFixture) {
  const key = digest("launch-key");
  const preflight = digest("preflight");
  await assert.rejects(client.query(`SELECT * FROM launch_signal_tb_strategic_run_v2(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.otherActor, key, preflight,
      JSON.stringify(fixture.request)]), hasState("42501"));
  assert.equal(await scalar(client, "SELECT count(*)::int FROM signal_strategic_run_controls"), 0);

  const sampleOnlyRequest = structuredClone(fixture.request) as Record<string, any>;
  sampleOnlyRequest.authority.provenance_digest = fixture.sampleOnlyProvenanceDigest;
  sampleOnlyRequest.request_digest = (await client.query<{ digest: string }>(
    "SELECT signal_strategic_launch_request_digest_v1($1::jsonb) AS digest",
    [JSON.stringify(sampleOnlyRequest)]
  )).rows[0]!.digest;
  await assert.rejects(client.query(`SELECT * FROM launch_signal_tb_strategic_run_v2(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor,
    digest("sample-only-provenance-launch"), preflight, JSON.stringify(sampleOnlyRequest)]),
  hasState("23514"));

  const tamperedPlanRequest = structuredClone(fixture.request) as Record<string, any>;
  tamperedPlanRequest.execution_plan.planned_provider_calls = 9;
  tamperedPlanRequest.request_digest = (await client.query<{ digest: string }>(
    "SELECT signal_strategic_launch_request_digest_v1($1::jsonb) AS digest",
    [JSON.stringify(tamperedPlanRequest)]
  )).rows[0]!.digest;
  await assert.rejects(client.query(`SELECT * FROM launch_signal_tb_strategic_run_v2(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor,
    digest("tampered-plan-launch"), preflight, JSON.stringify(tamperedPlanRequest)]),
  hasState("23514"));

  await client.query(`CREATE FUNCTION fail_fixture_strategic_step_insert() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-mid-launch-failure'; END $$`);
  await client.query(`CREATE TRIGGER trg_fail_fixture_strategic_step_insert
    BEFORE INSERT ON signal_strategic_step_outbox FOR EACH ROW
    EXECUTE FUNCTION fail_fixture_strategic_step_insert()`);
  await assert.rejects(client.query(`SELECT * FROM launch_signal_tb_strategic_run_v2(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor,
    digest("mid-launch-failure"), preflight, JSON.stringify(fixture.request)]), hasState("P0001"));
  await client.query("DROP TRIGGER trg_fail_fixture_strategic_step_insert ON signal_strategic_step_outbox");
  await client.query("DROP FUNCTION fail_fixture_strategic_step_insert()");
  assert.deepEqual((await client.query(`SELECT
    (SELECT count(*)::int FROM signal_strategic_run_controls) AS controls,
    (SELECT count(*)::int FROM tb_analyses) AS analyses,
    (SELECT count(*)::int FROM corpus_snapshots) AS snapshots`)).rows[0],
  { controls: 0, analyses: 0, snapshots: 0 });

  const peer = new pg.Client({ connectionString: DATABASE_URL!, ssl: false });
  await peer.connect();
  try {
    const launches = await Promise.all([
      client.query<StrategicFixture["launch"]>(`SELECT * FROM launch_signal_tb_strategic_run_v2(
        $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor, key, preflight,
        JSON.stringify(fixture.request)]),
      peer.query<StrategicFixture["launch"]>(`SELECT * FROM launch_signal_tb_strategic_run_v2(
        $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor, key, preflight,
        JSON.stringify(fixture.request)])
    ]);
    const rows = launches.map((result) => result.rows[0]!);
    assert.equal(rows.filter((row) => row.created).length, 1);
    assert.equal(new Set(rows.map((row) => row.run_control_id)).size, 1);
    fixture.launch = rows.find((row) => row.created)!;
  } finally { await peer.end(); }
  const retry = (await client.query<StrategicFixture["launch"]>(`SELECT * FROM
    launch_signal_tb_strategic_run_v2($1::uuid,$2::uuid,$3,$4,$5::jsonb)`,
  [IDS.workspace, IDS.actor, key, preflight, JSON.stringify(fixture.request)])).rows[0]!;
  assert.equal(retry.created, false);
  assert.equal(retry.run_control_id, fixture.launch.run_control_id);
  await assert.rejects(client.query(`SELECT * FROM launch_signal_tb_strategic_run_v2(
    $1::uuid,$2::uuid,$3,$4,$5::jsonb)`, [IDS.workspace, IDS.actor, key, digest("other-preflight"),
      JSON.stringify(fixture.request)]), hasState("23514"));
  assert.equal(await scalar(client, "SELECT count(*)::int FROM corpus_snapshots"), 1);
  assert.equal(await scalar(client, "SELECT count(*)::int FROM corpus_snapshot_mentions"), 2);
  assert.equal(await scalar(client, "SELECT count(*)::int FROM signal_strategic_sealed_sample_items"), 1);
  const containment = await client.query(`SELECT assert_signal_tb_snapshot_containment($1::uuid,'review')`,
    [fixture.launch.tb_analysis_id]);
  assert.equal(containment.rowCount, 1);
  await assert.rejects(client.query(`UPDATE signal_strategic_run_controls
    SET membership_digest=$2 WHERE id=$1::uuid`, [fixture.launch.run_control_id, digest("tamper")]),
  hasState("23514"));
  await assert.rejects(client.query(`UPDATE signal_strategic_run_controls
    SET provider_config_digest=$2 WHERE id=$1::uuid`,
  [fixture.launch.run_control_id, digest("tampered-provider-config")]), hasState("23514"));
  await assert.rejects(client.query(`UPDATE signal_strategic_sealed_sample_items SET ordinal=2
    WHERE run_control_id=$1::uuid`, [fixture.launch.run_control_id]), hasState("23514"));
  await client.query("BEGIN");
  try {
    await client.query(`UPDATE signal_governed_view_bindings SET binding_status='retired',
      effective_to=clock_timestamp() WHERE id=$1::uuid`, [IDS.binding]);
    await assert.rejects(client.query(`SELECT assert_signal_strategic_runtime_authority_v1($1::uuid)`,
      [fixture.launch.run_control_id]), hasState("23514"));
  } finally { await client.query("ROLLBACK"); }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(`UPDATE signal_strategic_run_controls
      SET authority_valid_until=clock_timestamp()+interval '50 milliseconds'
      WHERE id=$1::uuid`, [fixture.launch.run_control_id]);
    await client.query("SET LOCAL session_replication_role=origin");
    await client.query("SELECT pg_sleep(0.08)");
    await assert.rejects(client.query(`SELECT assert_signal_strategic_runtime_authority_v1($1::uuid)`,
      [fixture.launch.run_control_id]), hasState("23514"));
  } finally { await client.query("ROLLBACK"); }
}

async function exerciseBudgetAndStepFsm(client: pg.Client, fixture: StrategicFixture) {
  const budgetA = digest("budget-a");
  const first = (await client.query<{ reservation_id: string; created: boolean; status: string }>(`
    SELECT * FROM reserve_signal_strategic_budget_tokens_v1($1::uuid,'step1-open-pass',800000,0,$2)`,
  [fixture.launch.run_control_id, budgetA])).rows[0]!;
  assert.deepEqual({ created: first.created, status: first.status }, { created: true, status: "reserved" });
  const firstRetry = (await client.query<{ reservation_id: string; created: boolean; status: string }>(`
    SELECT * FROM reserve_signal_strategic_budget_tokens_v1($1::uuid,'step1-open-pass',800000,0,$2)`,
  [fixture.launch.run_control_id, budgetA])).rows[0]!;
  assert.deepEqual(firstRetry, { reservation_id: first.reservation_id, created: false, status: "reserved" });
  assert.equal(Number(await scalar(client, `SELECT settle_signal_strategic_budget_v1($1::uuid,$2,200000,0)`,
    [fixture.launch.run_control_id, budgetA])), 0.2);
  await assert.rejects(client.query(`SELECT * FROM reserve_signal_strategic_budget_tokens_v1(
    $1::uuid,'step1-open-pass',800000,0,$2)`, [fixture.launch.run_control_id,
    digest("same-operation-different-key")]), hasState("23514"));
  const budgetB = digest("budget-b");
  const second = (await client.query(`SELECT * FROM reserve_signal_strategic_budget_tokens_v1(
    $1::uuid,'step2-coding',700000,0,$2)`, [fixture.launch.run_control_id, budgetB])).rows[0];
  assert.equal(second.created, true);
  await assert.rejects(client.query(`SELECT settle_signal_strategic_budget_v1($1::uuid,$2,800000,0)`,
    [fixture.launch.run_control_id, budgetB]), hasState("P0001"));
  assert.equal(await scalar(client, `SELECT release_signal_strategic_budget_v1($1::uuid,$2,'not-called')`,
    [fixture.launch.run_control_id, budgetB]), true);
  const budgetPeers = [new pg.Client({ connectionString: DATABASE_URL!, ssl: false }),
    new pg.Client({ connectionString: DATABASE_URL!, ssl: false })];
  await Promise.all(budgetPeers.map((peer) => peer.connect()));
  try {
    const concurrent = await Promise.allSettled(budgetPeers.map((peer, index) => peer.query(
      `SELECT * FROM reserve_signal_strategic_budget_tokens_v1(
        $1::uuid,$2,500000,0,$3)`, [fixture.launch.run_control_id,
        `concurrent-${index + 1}`, digest(`budget-concurrent-${index + 1}`)]
    )));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected"
      && (result.reason as { code?: string }).code === "P0001").length, 1);
    const concurrentKey = concurrent[0]!.status === "fulfilled"
      ? digest("budget-concurrent-1") : digest("budget-concurrent-2");
    assert.equal(await scalar(client, `SELECT release_signal_strategic_budget_v1(
      $1::uuid,$2,'concurrency-test')`, [fixture.launch.run_control_id, concurrentKey]), true);
  } finally { await Promise.all(budgetPeers.map((peer) => peer.end())); }

  const dispatch = (await client.query(`SELECT * FROM claim_signal_strategic_step_dispatch_v1(1,30,3)`)).rows[0];
  assert.equal(dispatch.dispatch_attempt, 1);
  assert.equal(await scalar(client, `SELECT complete_signal_strategic_step_dispatch_v1($1::uuid,$2::uuid,$3)`,
    [dispatch.outbox_id, dispatch.lease_token, dispatch.bullmq_job_id]), true);
  const executionLease = "74000000-0000-4000-8000-000000000020";
  assert.equal(await scalar(client, `SELECT claim_signal_strategic_step_v1($1::uuid,$2::uuid,30)`,
    [dispatch.pipeline_step_id, executionLease]), true);
  assert.equal(await scalar(client, `SELECT heartbeat_signal_strategic_step_v1($1::uuid,$2::uuid,30)`,
    [dispatch.pipeline_step_id, executionLease]), true);
  assert.equal(await scalar(client, `SELECT complete_signal_strategic_step_v1($1::uuid,$2::uuid,$3::jsonb)`,
    [dispatch.pipeline_step_id, executionLease, JSON.stringify({ ok: true })]), true);
  assert.deepEqual((await client.query(`SELECT outbox.status,pipeline.status AS pipeline_status,
    control.status AS control_status,run_outbox.status AS run_outbox_status
    FROM signal_strategic_step_outbox outbox
    JOIN tb_pipeline_steps pipeline ON pipeline.id=outbox.pipeline_step_id
    JOIN signal_strategic_run_controls control ON control.id=outbox.run_control_id
    JOIN signal_strategic_run_outbox run_outbox ON run_outbox.tb_analysis_id=outbox.tb_analysis_id
    WHERE outbox.id=$1::uuid`, [dispatch.outbox_id])).rows[0],
  { status: "completed", pipeline_status: "completed", control_status: "running",
    run_outbox_status: "running" });

  await client.query("BEGIN");
  try {
    const step = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(tb_analysis_id,step,status,attempt)
      VALUES ($1::uuid,'step2_coding','queued',1) RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
    await client.query(`INSERT INTO signal_strategic_step_outbox(run_control_id,workspace_id,tb_analysis_id,
      pipeline_step_id,pipeline_step,attempt,dispatch_attempt,status,idempotency_key,lease_expires_at,lease_token)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'step2_coding',1,2,'dispatching',$5,
        clock_timestamp()-interval '1 second',gen_random_uuid())`, [fixture.launch.run_control_id,
      IDS.workspace, fixture.launch.tb_analysis_id, step, digest("exhausted-step")]);
    await client.query(`SELECT * FROM claim_signal_strategic_step_dispatch_v1(1,30,2)`);
    assert.deepEqual((await client.query(`SELECT step_outbox.status,control.status AS control_status,
      run_outbox.status AS run_status FROM signal_strategic_step_outbox step_outbox
      JOIN signal_strategic_run_controls control ON control.id=step_outbox.run_control_id
      JOIN signal_strategic_run_outbox run_outbox ON run_outbox.tb_analysis_id=step_outbox.tb_analysis_id
      WHERE step_outbox.pipeline_step_id=$1::uuid`, [step])).rows[0],
    { status: "dead_letter", control_status: "failed", run_status: "failed" });
  } finally { await client.query("ROLLBACK"); }

  await client.query("BEGIN");
  try {
    const step = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(tb_analysis_id,step,status,attempt)
      VALUES ($1::uuid,'step4_mobility','queued',1) RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
    const outbox = (await client.query<{ id: string; lease_token: string }>(`INSERT INTO
      signal_strategic_step_outbox(run_control_id,workspace_id,tb_analysis_id,pipeline_step_id,
      pipeline_step,attempt,dispatch_attempt,status,idempotency_key,lease_expires_at,lease_token)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'step4_mobility',1,2,'dispatching',$5,
        clock_timestamp()+interval '30 seconds',gen_random_uuid()) RETURNING id::text,lease_token::text`,
    [fixture.launch.run_control_id, IDS.workspace, fixture.launch.tb_analysis_id, step,
      digest("immediate-terminal-dispatch")])).rows[0]!;
    assert.equal(await scalar(client, `SELECT fail_signal_strategic_step_dispatch_v1(
      $1::uuid,$2::uuid,now(),'{"message":"fixture"}'::jsonb,2)`, [outbox.id, outbox.lease_token]),
    "dead_letter");
    assert.deepEqual((await client.query(`SELECT control.status,run_outbox.status AS run_status
      FROM signal_strategic_run_controls control JOIN signal_strategic_run_outbox run_outbox
        ON run_outbox.tb_analysis_id=control.tb_analysis_id WHERE control.id=$1::uuid`,
    [fixture.launch.run_control_id])).rows[0], { status: "failed", run_status: "failed" });
  } finally { await client.query("ROLLBACK"); }

  await client.query("BEGIN");
  try {
    const step = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(tb_analysis_id,step,status,attempt)
      VALUES ($1::uuid,'quality_gates','queued',1) RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
    await client.query(`INSERT INTO signal_strategic_step_outbox(run_control_id,workspace_id,tb_analysis_id,
      pipeline_step_id,pipeline_step,attempt,status,idempotency_key)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'quality_gates',1,'dispatched',$5)`,
    [fixture.launch.run_control_id, IDS.workspace, fixture.launch.tb_analysis_id, step, digest("quality-step")]);
    const lease = "74000000-0000-4000-8000-000000000023";
    assert.equal(await scalar(client, `SELECT claim_signal_strategic_step_v1($1::uuid,$2::uuid,30)`, [step, lease]), true);
    assert.equal(await scalar(client, `SELECT complete_signal_strategic_step_v1($1::uuid,$2::uuid,'{}'::jsonb)`,
      [step, lease]), true);
    assert.deepEqual((await client.query(`SELECT control.status,run_outbox.status AS outbox_status,
      analysis.status AS analysis_status FROM signal_strategic_run_controls control
      JOIN signal_strategic_run_outbox run_outbox ON run_outbox.tb_analysis_id=control.tb_analysis_id
      JOIN tb_analyses analysis ON analysis.id=control.tb_analysis_id WHERE control.id=$1::uuid`,
    [fixture.launch.run_control_id])).rows[0],
    { status: "needs_review", outbox_status: "needs_review", analysis_status: "needs_review" });

    const artifactId = "74000000-0000-4000-8000-000000000024";
    await client.query(`INSERT INTO analysis_artifacts(id,study_corpus_id,tb_analysis_id,
      artifact_key,artifact_type,content,review_status,revision)
      VALUES ($1::uuid,$2::uuid,$3::uuid,'fixture-artifact','finding','{}','draft',1)`,
    [artifactId, IDS.corpus, fixture.launch.tb_analysis_id]);
    await client.query(`INSERT INTO tb_quality_gates(tb_analysis_id,gate_name,passed)
      VALUES ($1::uuid,'fixture-gate',true)`, [fixture.launch.tb_analysis_id]);
    await client.query(`INSERT INTO record_tags(id,organization_id,brand_id,study_corpus_id,
      subject_type,subject_id,taxonomy_term_id,value,confidence,evidence,source,tb_analysis_id,
      review_status)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'mention',$5::uuid,$6::uuid,
        'fixture-assertion','high','[]'::jsonb,'claude',$7::uuid,'unreviewed')`,
    [IDS.recordTag, IDS.organization, IDS.brand, IDS.corpus, IDS.mentionA, IDS.taxonomyTerm,
      fixture.launch.tb_analysis_id]);
    const reviewRequest: Record<string, unknown> = {
      reusable_assertions: [{ record_tag_id: IDS.recordTag, decision: "approve",
        notes: "Fixture approval" }],
      limitations: { fixture: true }, release_title: "Fixture release"
    };
    const reviewDigest = (await client.query<{ digest: string }>(
      `SELECT signal_strategic_review_release_request_digest_v1($1::jsonb) AS digest`,
      [JSON.stringify(reviewRequest)])).rows[0]!.digest;
    reviewRequest.request_digest = reviewDigest;
    const reviewKey = digest("review-release-key");
    await client.query("SAVEPOINT review_cross_workspace");
    await assert.rejects(client.query(`SELECT * FROM review_and_prepare_signal_tb_strategic_v2(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`, [IDS.workspace,
      fixture.launch.tb_analysis_id, IDS.otherActor, reviewKey, reviewDigest,
      JSON.stringify(reviewRequest)]), hasState("42501"));
    await client.query("ROLLBACK TO SAVEPOINT review_cross_workspace");
    await client.query("RELEASE SAVEPOINT review_cross_workspace");
    await client.query(`CREATE FUNCTION fail_fixture_release_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture-review-release-failure'; END $$`);
    await client.query(`CREATE TRIGGER trg_fail_fixture_release_insert BEFORE INSERT
      ON signal_workspace_releases FOR EACH ROW EXECUTE FUNCTION fail_fixture_release_insert()`);
    await client.query("SAVEPOINT review_injected_failure");
    await assert.rejects(client.query(`SELECT * FROM review_and_prepare_signal_tb_strategic_v2(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`, [IDS.workspace,
      fixture.launch.tb_analysis_id, IDS.actor, digest("review-release-failure"), reviewDigest,
      JSON.stringify(reviewRequest)]), hasState("P0001"));
    await client.query("ROLLBACK TO SAVEPOINT review_injected_failure");
    await client.query("RELEASE SAVEPOINT review_injected_failure");
    await client.query("DROP TRIGGER trg_fail_fixture_release_insert ON signal_workspace_releases");
    await client.query("DROP FUNCTION fail_fixture_release_insert()");
    assert.deepEqual((await client.query(`SELECT analysis.status,artifact.review_status,
      (SELECT count(*)::int FROM signal_workspace_releases) AS releases
      FROM tb_analyses analysis JOIN analysis_artifacts artifact
        ON artifact.tb_analysis_id=analysis.id WHERE analysis.id=$1::uuid`,
    [fixture.launch.tb_analysis_id])).rows[0],
    { status: "needs_review", review_status: "draft", releases: 0 });
    const reviewed = (await client.query<{ operation_id: string; release_id: string; created: boolean }>(`
      SELECT * FROM review_and_prepare_signal_tb_strategic_v2(
        $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`,
    [IDS.workspace, fixture.launch.tb_analysis_id, IDS.actor, reviewKey, reviewDigest,
      JSON.stringify(reviewRequest)])).rows[0]!;
    assert.equal(reviewed.created, true);
    const reviewRetry = (await client.query<{ operation_id: string; release_id: string; created: boolean }>(`
      SELECT * FROM review_and_prepare_signal_tb_strategic_v2(
        $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`,
    [IDS.workspace, fixture.launch.tb_analysis_id, IDS.actor, reviewKey, reviewDigest,
      JSON.stringify(reviewRequest)])).rows[0]!;
    assert.deepEqual(reviewRetry, { operation_id: reviewed.operation_id,
      release_id: reviewed.release_id, created: false });
    assert.deepEqual((await client.query(`SELECT analysis.status AS analysis_status,
      control.status AS control_status,
      release.status AS release_status,artifact.review_status AS artifact_status,
      tag.review_status AS assertion_status,event.decision AS assertion_decision
      FROM tb_analyses analysis JOIN signal_strategic_run_controls control
        ON control.tb_analysis_id=analysis.id
      JOIN signal_workspace_releases release ON release.tb_analysis_id=analysis.id
      JOIN analysis_artifacts artifact ON artifact.tb_analysis_id=analysis.id
      JOIN record_tags tag ON tag.tb_analysis_id=analysis.id
      JOIN tb_reusable_assertion_review_events event ON event.tb_analysis_id=analysis.id
      WHERE analysis.id=$1::uuid`, [fixture.launch.tb_analysis_id])).rows[0],
    { analysis_status: "approved_by_im", control_status: "completed",
      release_status: "draft", artifact_status: "accepted", assertion_status: "approved",
      assertion_decision: "approve" });
    await client.query("SAVEPOINT review_incompatible_retry");
    await assert.rejects(client.query(`SELECT * FROM review_and_prepare_signal_tb_strategic_v2(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`, [IDS.workspace,
      fixture.launch.tb_analysis_id, IDS.actor, reviewKey, digest("incompatible-review"),
      JSON.stringify(reviewRequest)]), hasState("42501"));
    await client.query("ROLLBACK TO SAVEPOINT review_incompatible_retry");
    await client.query("RELEASE SAVEPOINT review_incompatible_retry");
  } finally { await client.query("ROLLBACK"); }

  await client.query("BEGIN");
  try {
    const step = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(tb_analysis_id,step,status,attempt)
      VALUES ($1::uuid,'step2_coding','queued',1) RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
    await client.query(`INSERT INTO signal_strategic_step_outbox(run_control_id,workspace_id,tb_analysis_id,
      pipeline_step_id,pipeline_step,attempt,status,idempotency_key,bullmq_job_id,dispatched_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'step2_coding',1,'dispatched',$5,
        'fixture-dispatched-before-cancel',clock_timestamp())`,
    [fixture.launch.run_control_id, IDS.workspace, fixture.launch.tb_analysis_id, step,
      digest("cancel-dispatched-step")]);
    assert.equal(await scalar(client, `SELECT request_signal_strategic_run_cancel_v1(
      $1::uuid,$2::uuid,$3::uuid)`, [IDS.workspace, fixture.launch.tb_analysis_id, IDS.actor]),
    "cancel_requested");
    assert.deepEqual((await client.query(`SELECT step_outbox.status,pipeline.status AS pipeline_status,
      control.status AS control_status,run_outbox.status AS run_status
      FROM signal_strategic_step_outbox step_outbox
      JOIN tb_pipeline_steps pipeline ON pipeline.id=step_outbox.pipeline_step_id
      JOIN signal_strategic_run_controls control ON control.id=step_outbox.run_control_id
      JOIN signal_strategic_run_outbox run_outbox ON run_outbox.tb_analysis_id=step_outbox.tb_analysis_id
      WHERE step_outbox.pipeline_step_id=$1::uuid`, [step])).rows[0],
    { status: "cancelled", pipeline_status: "failed", control_status: "cancel_requested",
      run_status: "cancel_requested" });
  } finally { await client.query("ROLLBACK"); }

  await client.query("BEGIN");
  try {
    const step = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(tb_analysis_id,step,status,attempt)
      VALUES ($1::uuid,'step3_hierarchy','queued',1) RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
    await client.query(`INSERT INTO signal_strategic_step_outbox(run_control_id,workspace_id,tb_analysis_id,
      pipeline_step_id,pipeline_step,attempt,status,idempotency_key)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'step3_hierarchy',1,'dispatched',$5)`,
    [fixture.launch.run_control_id, IDS.workspace, fixture.launch.tb_analysis_id, step, digest("cancel-step")]);
    const lease = "74000000-0000-4000-8000-000000000021";
    assert.equal(await scalar(client, `SELECT claim_signal_strategic_step_v1($1::uuid,$2::uuid,30)`, [step, lease]), true);
    assert.equal(await scalar(client, `SELECT request_signal_strategic_run_cancel_v1($1::uuid,$2::uuid,$3::uuid)`,
      [IDS.workspace, fixture.launch.tb_analysis_id, IDS.actor]), "cancel_requested");
    assert.equal(await scalar(client, `SELECT fail_signal_strategic_step_v1($1::uuid,$2::uuid,now(),$3::jsonb,true)`,
      [step, lease, JSON.stringify({ message: "cancelled" })]), "cancelled");
    assert.equal(await scalar(client, `SELECT status FROM signal_strategic_run_controls WHERE id=$1::uuid`,
      [fixture.launch.run_control_id]), "cancelled");
  } finally { await client.query("ROLLBACK"); }

  const releaseId = await prepareStrategicReleaseForPromotion(client, fixture);
  const promotionKey = digest("strategic-release-promotion");
  const promotionDigest = await strategicPromotionDigest(
    client, IDS.workspace, "triggers-barriers", releaseId, IDS.actor
  );
  const crossWorkspaceDigest = await strategicPromotionDigest(
    client, IDS.otherWorkspace, "triggers-barriers", releaseId, IDS.otherActor
  );
  await assert.rejects(client.query(`SELECT * FROM promote_signal_workspace_report_release_v2(
    $1::uuid,$2,$3::uuid,$4::uuid,$5,$6)`, [IDS.otherWorkspace, "triggers-barriers",
    releaseId, IDS.otherActor, digest("cross-workspace-promotion"), crossWorkspaceDigest]),
  hasState("42501"));

  const promotionPeers = [new pg.Client({ connectionString: DATABASE_URL!, ssl: false }),
    new pg.Client({ connectionString: DATABASE_URL!, ssl: false })];
  await Promise.all(promotionPeers.map((peer) => peer.connect()));
  try {
    const promoted = await Promise.all(promotionPeers.map((peer) => peer.query<{
      operation_id: string; release_id: string; created: boolean;
    }>(`SELECT * FROM promote_signal_workspace_report_release_v2(
      $1::uuid,$2,$3::uuid,$4::uuid,$5,$6)`, [IDS.workspace, "triggers-barriers",
      releaseId, IDS.actor, promotionKey, promotionDigest])));
    assert.equal(promoted.filter((result) => result.rows[0]!.created).length, 1);
    assert.equal(new Set(promoted.map((result) => result.rows[0]!.operation_id)).size, 1);
  } finally { await Promise.all(promotionPeers.map((peer) => peer.end())); }
  const promotionRetry = (await client.query<{ operation_id: string; release_id: string; created: boolean }>(
    `SELECT * FROM promote_signal_workspace_report_release_v2(
      $1::uuid,$2,$3::uuid,$4::uuid,$5,$6)`, [IDS.workspace, "triggers-barriers",
      releaseId, IDS.actor, promotionKey, promotionDigest])).rows[0]!;
  assert.equal(promotionRetry.created, false);
  assert.equal(promotionRetry.release_id, releaseId);
  const incompatibleDigest = await strategicPromotionDigest(
    client, IDS.workspace, "other-report", releaseId, IDS.actor
  );
  await assert.rejects(client.query(`SELECT * FROM promote_signal_workspace_report_release_v2(
    $1::uuid,$2,$3::uuid,$4::uuid,$5,$6)`, [IDS.workspace, "other-report",
    releaseId, IDS.actor, promotionKey, incompatibleDigest]), hasState("23514"));

  assert.equal(await scalar(client, `SELECT count(*)::int FROM signal_workspace_population_pointers`), 0);
  assert.equal(await scalar(client, `SELECT count(*)::int FROM signal_workspace_releases`), 1);
  assert.equal(await scalar(client, `SELECT count(*)::int FROM signal_workspace_report_current_releases`), 1);
  assert.equal(await scalar(client, `SELECT count(*)::int FROM signal_strategic_release_promotion_operations`), 1);
  assert.ok(Number(await scalar(client, `SELECT count(*)::int FROM signal_strategic_step_outbox_events`)) >= 4);
}

async function prepareStrategicReleaseForPromotion(client: pg.Client, fixture: StrategicFixture) {
  const qualityStep = (await client.query<{ id: string }>(`INSERT INTO tb_pipeline_steps(
    tb_analysis_id,step,status,attempt) VALUES ($1::uuid,'quality_gates','queued',1)
    RETURNING id::text`, [fixture.launch.tb_analysis_id])).rows[0]!.id;
  await client.query(`INSERT INTO signal_strategic_step_outbox(run_control_id,workspace_id,
    tb_analysis_id,pipeline_step_id,pipeline_step,attempt,status,idempotency_key)
    VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'quality_gates',1,'dispatched',$5)`,
  [fixture.launch.run_control_id, IDS.workspace, fixture.launch.tb_analysis_id, qualityStep,
    digest("promotion-quality-step")]);
  const lease = "74000000-0000-4000-8000-000000000028";
  assert.equal(await scalar(client, `SELECT claim_signal_strategic_step_v1($1::uuid,$2::uuid,30)`,
    [qualityStep, lease]), true);
  assert.equal(await scalar(client, `SELECT complete_signal_strategic_step_v1(
    $1::uuid,$2::uuid,'{}'::jsonb)`, [qualityStep, lease]), true);
  const artifactId = "74000000-0000-4000-8000-000000000024";
  await client.query(`INSERT INTO analysis_artifacts(id,study_corpus_id,tb_analysis_id,
    artifact_key,artifact_type,content,review_status,revision)
    VALUES ($1::uuid,$2::uuid,$3::uuid,'fixture-artifact','finding','{}','draft',1)`,
  [artifactId, IDS.corpus, fixture.launch.tb_analysis_id]);
  await client.query(`INSERT INTO tb_quality_gates(tb_analysis_id,gate_name,passed)
    VALUES ($1::uuid,'fixture-gate',true)`, [fixture.launch.tb_analysis_id]);
  await client.query(`INSERT INTO record_tags(id,organization_id,brand_id,study_corpus_id,
    subject_type,subject_id,taxonomy_term_id,value,confidence,evidence,source,tb_analysis_id,
    review_status) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'mention',$5::uuid,$6::uuid,
      'fixture-assertion','high','[]'::jsonb,'claude',$7::uuid,'unreviewed')`,
  [IDS.recordTag, IDS.organization, IDS.brand, IDS.corpus, IDS.mentionA, IDS.taxonomyTerm,
    fixture.launch.tb_analysis_id]);
  const reviewRequest: Record<string, unknown> = {
    reusable_assertions: [{ record_tag_id: IDS.recordTag, decision: "approve",
      notes: "Fixture approval" }],
    limitations: { fixture: true }, release_title: "Fixture release"
  };
  const reviewDigest = (await client.query<{ digest: string }>(
    `SELECT signal_strategic_review_release_request_digest_v1($1::jsonb) AS digest`,
    [JSON.stringify(reviewRequest)])).rows[0]!.digest;
  reviewRequest.request_digest = reviewDigest;
  return (await client.query<{ release_id: string }>(`SELECT * FROM
    review_and_prepare_signal_tb_strategic_v2($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`,
  [IDS.workspace, fixture.launch.tb_analysis_id, IDS.actor, digest("durable-review-release"),
    reviewDigest, JSON.stringify(reviewRequest)])).rows[0]!.release_id;
}

async function strategicPromotionDigest(client: pg.Client, workspaceId: string, reportKey: string,
  releaseId: string, actorId: string) {
  return (await client.query<{ digest: string }>(`SELECT
    signal_strategic_release_promotion_request_digest_v1(
      $1::uuid,$2,$3::uuid,$4::uuid,'publish') AS digest`,
  [workspaceId, reportKey, releaseId, actorId])).rows[0]!.digest;
}

async function scalar(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query(sql, params);
  const row = result.rows[0]!;
  return row[Object.keys(row)[0]!];
}

function digest(value: string) { return `sha256:${shaRaw(value)}`; }
function sha(value: string) { return `sha256:${shaRaw(value)}`; }
function shaRaw(value: string) { return createHash("sha256").update(value).digest("hex"); }
function hasState(state: string) {
  return (error: unknown) => (error as { code?: string }).code === state;
}

function interpolateFixtureSql(sql: string, values: readonly string[]) {
  return sql.replace(/\$(\d+)/gu, (_match, position: string) => {
    const value = values[Number(position) - 1];
    assert.notEqual(value, undefined);
    return `'${value!.replaceAll("'", "''")}'`;
  });
}
