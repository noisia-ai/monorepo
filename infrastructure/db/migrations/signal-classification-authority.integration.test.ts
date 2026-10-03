import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

const DATABASE_URL = process.env.NOISIA_SIGNAL_CLASSIFICATION_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_CLASSIFICATION_INTEGRATION_APPROVED === "true";
const H = (value: string) => `sha256:${value.repeat(64)}`;

const I = {
  orgA: "87000000-0000-4000-8000-000000000001",
  orgB: "87000000-0000-4000-8000-000000000002",
  userA: "87000000-0000-4000-8000-000000000003",
  userB: "87000000-0000-4000-8000-000000000004",
  brandA: "87000000-0000-4000-8000-000000000005",
  brandB: "87000000-0000-4000-8000-000000000006",
  workspaceA: "87000000-0000-4000-8000-000000000007",
  workspaceB: "87000000-0000-4000-8000-000000000008",
  method: "87000000-0000-4000-8000-000000000009",
  corpus: "87000000-0000-4000-8000-000000000010",
  sourceA: "87000000-0000-4000-8000-000000000011",
  sourceB: "87000000-0000-4000-8000-000000000012",
  taxonomy: "87000000-0000-4000-8000-000000000013",
  term: "87000000-0000-4000-8000-000000000014",
  rules: "87000000-0000-4000-8000-000000000015",
  profileModel: "87000000-0000-4000-8000-000000000016",
  registryModel: "87000000-0000-4000-8000-000000000017",
  profile: "87000000-0000-4000-8000-000000000018",
  labelingFunction: "87000000-0000-4000-8000-000000000019",
  exactPolicy: "87000000-0000-4000-8000-000000000020",
  functionPolicy: "87000000-0000-4000-8000-000000000021",
  alias: "87000000-0000-4000-8000-000000000099"
} as const;

const roots = Array.from({ length: 8 }, (_, index) =>
  `87000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`
);

test("10B classification authority is append-only, abstention-aware, projectable and provider-drain closed", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 120_000
}, async () => {
  assert.ok(DATABASE_URL);
  requireDisposableLocalDatabase(DATABASE_URL);
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await applyAllMigrations(client);
    await client.query(await readFile(join(dirname(fileURLToPath(import.meta.url)), "0087_signal_classification_authority.sql"), "utf8"));
    await seedFixture(client);
    const authority = await seedClassificationControlPlane(client);
    const watermark = await client.query<{ digest: string }>(`
      SELECT signal_classification_watermark_digest_v1($1::uuid,$2::uuid) AS digest
    `, [I.workspaceA,I.corpus]);
    const watermarkDigest = watermark.rows[0]!.digest;

    const generation = await client.query<{ generation_id: string; created: boolean }>(`
      SELECT * FROM begin_signal_classification_generation_v1(
        $1::uuid,$2::uuid,'topics-greenfield',1,$3::uuid,$4,$5,$6,7,$7,
        $8::uuid,$9,$10,NULL)
    `, [I.workspaceA, I.profile, I.corpus, H("1"), watermarkDigest, H("3"), H("4"), I.userA, H("5"), H("6")]);
    const generationId = generation.rows[0]!.generation_id;
    assert.equal(generation.rows[0]!.created, true);
    const generationReplay = await client.query<{ generation_id: string; created: boolean }>(`
      SELECT * FROM begin_signal_classification_generation_v1(
        $1::uuid,$2::uuid,'topics-greenfield',1,$3::uuid,$4,$5,$6,7,$7,
        $8::uuid,$9,$10,NULL)
    `, [I.workspaceA, I.profile, I.corpus, H("1"), watermarkDigest, H("3"), H("4"), I.userA, H("5"), H("6")]);
    assert.deepEqual(generationReplay.rows[0], { generation_id: generationId, created: false });
    await assert.rejects(client.query(`SELECT * FROM begin_signal_classification_generation_v1(
      $1::uuid,$2::uuid,'topics-greenfield',1,$3::uuid,$4,$5,$6,7,$7,$8::uuid,$9,$10,NULL)`,
      [I.workspaceA,I.profile,I.corpus,H("1"),watermarkDigest,H("3"),H("4"),I.userA,H("5"),H("f")]), /incompatible input/);
    await assert.rejects(client.query(`SELECT * FROM begin_signal_classification_generation_v1(
      $1::uuid,$2::uuid,'cross',1,NULL,$3,$4,$5,0,$6,$7::uuid,$8,$9,NULL)`,
      [I.workspaceB,I.profile,H("1"),watermarkDigest,H("3"),H("4"),I.userB,H("7"),H("8")]), /authority is invalid/);
    await assert.rejects(client.query(`SELECT * FROM begin_signal_classification_generation_v1(
      $1::uuid,$2::uuid,'wrong-watermark',1,$3::uuid,$4,$5,$6,1,$7,$8::uuid,$9,$10,NULL)`,
      [I.workspaceA,I.profile,I.corpus,H("1"),H("f"),H("3"),H("4"),I.userA,
        K("wrong-watermark"),K("wrong-watermark-request")]), /authority is invalid/);

    const exact = await appendResult(client, generationId, I.alias, "approved", "exact", I.term,
      null, null, authority.exactPolicyId, I.userA, K("exact"), K("exact-request"));
    assert.equal(exact.canonical_root_id, roots[0], "alias resolves to its canonical root");
    const exactReplay = await appendResult(client, generationId, I.alias, "approved", "exact", I.term,
      null, null, authority.exactPolicyId, I.userA, K("exact"), K("exact-request"));
    assert.equal(exactReplay.created, false);
    await appendResult(client, generationId, roots[1]!, "approved", "labeling_function", I.term,
      authority.labelingFunctionId, null, authority.functionPolicyId, I.userA, K("lf"), K("lf-request"));

    await assert.rejects(appendResult(client, generationId, roots[2]!, "approved", "model", I.term,
      null, authority.registryModelId, null, I.userA, K("model-invalid"), K("model-invalid-request")), /requires matching human or approved policy/);
    await appendResult(client, generationId, roots[2]!, "pending", "model", I.term,
      null, authority.registryModelId, null, I.userA, K("model-pending"), K("model-pending-request"));
    const humanApproved = await appendResult(client, generationId, roots[3]!, "approved", "human", I.term,
      null, null, null, I.userA, K("human-approved"), K("human-approved-request"));
    await appendResult(client, generationId, roots[4]!, "rejected", "human", I.term,
      null, null, null, I.userA, K("human-rejected"), K("human-rejected-request"));
    await appendResult(client, generationId, roots[5]!, "abstained", "exact", null,
      null, null, null, I.userA, K("exact-abstained"), K("exact-abstained-request"));
    await appendResult(client, generationId, roots[6]!, "error", null, null,
      null, null, null, I.userA, K("technical-error"), K("technical-error-request"), "fixture_technical_error");

    const finalized = await client.query<{ finalized_digest: string; created: boolean }>(`
      SELECT finalized_digest,created FROM finalize_signal_classification_generation_v1(
        $1::uuid,$2::uuid,$3::uuid,$4,$5)
    `, [I.workspaceA,generationId,I.userA,K("finalize"),K("finalize-request")]);
    assert.match(finalized.rows[0]!.finalized_digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(finalized.rows[0]!.created, true);

    const coverage = await client.query(`SELECT * FROM signal_classification_coverage_v1($1::uuid)`, [generationId]);
    assert.deepEqual(pick(coverage.rows[0], ["denominator","resolved","approved","pending","rejected","abstained","error"]), {
      denominator: 7, resolved: 6, approved: 3, pending: 1, rejected: 1, abstained: 1, error: 1
    });
    assert.equal(Number(coverage.rows[0]!.coverage), 6 / 7);

    const unapprovedLfGeneration = await client.query<{ generation_id: string }>(`
      SELECT generation_id FROM begin_signal_classification_generation_v1(
        $1::uuid,$2::uuid,'unapproved-lf',1,$3::uuid,$4,$5,$6,1,$7,
        $8::uuid,$9,$10,NULL)
    `, [I.workspaceA,I.profile,I.corpus,H("1"),watermarkDigest,H("3"),H("4"),I.userA,K("lf-generation"),K("lf-generation-request")]);
    const unapprovedLfGenerationId = unapprovedLfGeneration.rows[0]!.generation_id;
    await assert.rejects(appendResult(client,unapprovedLfGenerationId,roots[7]!,"approved",
      "labeling_function",I.term,authority.labelingFunctionId,null,null,I.userA,
      K("lf-without-policy"),K("lf-without-policy-request")), /requires matching human or approved policy/);
    await appendResult(client,unapprovedLfGenerationId,roots[7]!,"pending","labeling_function",
      I.term,authority.labelingFunctionId,null,null,I.userA,K("lf-pending"),K("lf-pending-request"));
    await client.query(`SELECT * FROM finalize_signal_classification_generation_v1(
      $1::uuid,$2::uuid,$3::uuid,$4,$5)`,
      [I.workspaceA,unapprovedLfGenerationId,I.userA,K("lf-finalize"),K("lf-finalize-request")]);

    await seedGoldAndEvaluation(client, generationId, authority.registryModelId);
    assert.equal(await scalar(client, `SELECT count(*) FROM signal_tagging_model_version_events
      WHERE model_version_id=$1::uuid AND status='evaluated'`, [authority.registryModelId]), 1);
    assert.equal(await scalar(client, `SELECT count(*) FROM signal_tagging_model_version_events
      WHERE model_version_id=$1::uuid AND status='approved'`, [authority.registryModelId]), 0,
      "evaluated does not imply approved");
    assert.equal((await client.query<{ current: boolean }>(`
      SELECT signal_classification_generation_is_current_v1($1::uuid,now()) AS current
    `,[generationId])).rows[0]!.current,true);
    assert.equal((await client.query<{ current: boolean }>(`
      SELECT signal_classification_generation_is_current_v1($1::uuid,now()+interval '2 hours') AS current
    `,[generationId])).rows[0]!.current,false,"expired approval policy fails closed temporally");

    const peer = new pg.Client({ connectionString: DATABASE_URL, ssl: false });
    await peer.connect();
    const projectionSql = `SELECT * FROM project_signal_classification_generation_v1(
      $1::uuid,$2::uuid,$3::uuid,$4,$5)`;
    const projectionArgs = [I.workspaceA,generationId,I.userA,K("project"),K("project-request")];
    const [projected, projectedConcurrent] = await Promise.all([
      client.query<{ projected_count: number; projection_digest: string }>(
        projectionSql,projectionArgs),
      peer.query<{ projected_count: number; projection_digest: string }>(
        projectionSql,projectionArgs)
    ]);
    await peer.end();
    assert.equal(projected.rows[0]!.projected_count, 3);
    assert.deepEqual(projectedConcurrent.rows[0], projected.rows[0],
      "concurrent replay converges on the same projection");
    const projectedReplay = await client.query<{ projected_count: number; projection_digest: string }>(
      projectionSql,projectionArgs
    );
    assert.deepEqual(projectedReplay.rows[0], projected.rows[0]);
    const rebuilt = await client.query<{ projected_count: number; projection_digest: string }>(
      projectionSql,[I.workspaceA,generationId,I.userA,K("project-rebuild"),K("project-rebuild-request")]
    );
    assert.equal(rebuilt.rows[0]!.projected_count, 3);
    assert.equal(rebuilt.rows[0]!.projection_digest, projected.rows[0]!.projection_digest,
      "a from-scratch projector rebuild is deterministic");
    assert.equal(await scalar(client, `SELECT count(*) FROM record_tags
      WHERE classification_generation_id=$1::uuid`, [generationId]), 3);
    assert.equal(await scalar(client, `SELECT count(*) FROM signal_data_invalidations
      WHERE reason='classification_projection_rebuilt'`), 1,
      "rebuild retries preserve one contractual invalidation");

    await client.query(`UPDATE signal_data_watermarks SET corpus_revision=corpus_revision+1
      WHERE workspace_id=$1::uuid AND study_corpus_id=$2::uuid`,[I.workspaceA,I.corpus]);
    const staleCoverage = await client.query(`SELECT * FROM signal_classification_coverage_v1($1::uuid)`,[generationId]);
    assert.equal(staleCoverage.rows[0]!.availability,"not_available");
    assert.equal(staleCoverage.rows[0]!.denominator,null);
    await assert.rejects(client.query(projectionSql,[I.workspaceA,generationId,I.userA,
      K("project-stale-watermark"),K("project-stale-watermark-request")]),/invalid or stale/);
    await client.query(`UPDATE signal_data_watermarks SET corpus_revision=corpus_revision-1
      WHERE workspace_id=$1::uuid AND study_corpus_id=$2::uuid`,[I.workspaceA,I.corpus]);

    await client.query(`UPDATE taxonomy_terms SET status='retired' WHERE id=$1::uuid`,[I.term]);
    await assert.rejects(client.query(projectionSql,[I.workspaceA,generationId,I.userA,
      K("project-retired-term"),K("project-retired-term-request")]),/invalid or stale/);
    await client.query(`UPDATE taxonomy_terms SET status='active' WHERE id=$1::uuid`,[I.term]);
    await client.query(`UPDATE signal_taxonomy_profiles SET status='retired' WHERE id=$1::uuid`,[I.profile]);
    await assert.rejects(client.query(projectionSql,[I.workspaceA,generationId,I.userA,
      K("project-retired-profile"),K("project-retired-profile-request")]),/invalid or stale/);
    await client.query(`UPDATE signal_taxonomy_profiles SET status='active' WHERE id=$1::uuid`,[I.profile]);

    await assert.rejects(client.query(`SELECT * FROM begin_signal_classification_generation_v1(
      $1::uuid,$2::uuid,'wrong-key',2,$3::uuid,$4,$5,$6,1,$7,$8::uuid,$9,$10,$11::uuid)`,
      [I.workspaceA,I.profile,I.corpus,H("a"),watermarkDigest,H("3"),H("b"),I.userA,
        K("bad-supersession"),K("bad-supersession-request"),generationId]),/authority is invalid/);
    const correctedGeneration = await client.query<{ generation_id: string }>(`
      SELECT generation_id FROM begin_signal_classification_generation_v1(
        $1::uuid,$2::uuid,'topics-greenfield',2,$3::uuid,$4,$5,$6,1,$7,
        $8::uuid,$9,$10,$11::uuid)
    `,[I.workspaceA,I.profile,I.corpus,H("a"),watermarkDigest,H("3"),H("b"),I.userA,
      K("corrected-generation"),K("corrected-generation-request"),generationId]);
    const correctedGenerationId = correctedGeneration.rows[0]!.generation_id;
    const corrected = await appendResult(client,correctedGenerationId,roots[3]!,"approved",
      "human",I.term,null,null,null,I.userA,K("human-corrected"),K("human-corrected-request"),
      null,humanApproved.assignment_id);
    await client.query(`SELECT * FROM finalize_signal_classification_generation_v1(
      $1::uuid,$2::uuid,$3::uuid,$4,$5)`,[I.workspaceA,correctedGenerationId,I.userA,
      K("corrected-finalize"),K("corrected-finalize-request")]);
    assert.equal(await scalar(client,`SELECT count(*) FROM signal_classification_assignments
      WHERE id IN ($1::uuid,$2::uuid)`,[humanApproved.assignment_id,corrected.assignment_id]),2,
      "human correction appends and preserves the previous decision");
    assert.equal((await client.query<{ current: boolean }>(`
      SELECT signal_classification_generation_is_current_v1($1::uuid,now()) AS current
    `,[generationId])).rows[0]!.current,false,"superseded generation is no longer current");
    assert.equal((await client.query<{ current: boolean }>(`
      SELECT signal_classification_generation_is_current_v1($1::uuid,now()) AS current
    `,[correctedGenerationId])).rows[0]!.current,true);
    const correctedProjection = await client.query<{ projected_count: number }>(projectionSql,
      [I.workspaceA,correctedGenerationId,I.userA,K("project-corrected"),K("project-corrected-request")]);
    assert.equal(correctedProjection.rows[0]!.projected_count,1);
    assert.equal(await scalar(client,`SELECT count(*) FROM record_tags
      WHERE classification_generation_id=$1::uuid`,[generationId]),0);
    assert.equal(await scalar(client,`SELECT count(*) FROM record_tags
      WHERE classification_generation_id=$1::uuid`,[correctedGenerationId]),1);

    await assert.rejects(client.query(`DELETE FROM record_tags
      WHERE classification_generation_id=$1::uuid`, [correctedGenerationId]), /Direct classification projection delete is forbidden/);
    await assert.rejects(client.query(`UPDATE record_tags SET review_status='rejected'
      WHERE classification_generation_id=$1::uuid`,[correctedGenerationId]),
      /Classification projection owner operation is missing|forbidden/);

    await assert.rejects(client.query(`INSERT INTO record_tags(
      organization_id,brand_id,study_corpus_id,subject_type,subject_id,taxonomy_term_id,
      source,model_version_id,signal_taxonomy_profile_id,review_status,approval_source,approved_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,'mention',$4::uuid,$5::uuid,'direct-classifier',
        $6::uuid,$7::uuid,'approved','human',now())`,
      [I.orgA,I.brandA,I.corpus,roots[7],I.term,I.profileModel,I.profile]), /require the classification projector/);
    await assert.rejects(client.query(`UPDATE signal_classification_assignments SET score=1 WHERE id=$1::uuid`,
      [exact.assignment_id]), /append-only/);
    await assert.rejects(client.query(`INSERT INTO signal_mention_attributions(
      workspace_id,mention_id,data_source_id,scope,entity_type,entity_id,entity_label,confidence,
      review_status,attribution_source,policy_version,model_version,attribution_basis,
      eligibility_status,evidence_kind,evidence_hash,semantic_policy_key,assertion_version,
      is_current,idempotency_key,approved_by_user_id,approval_source,approved_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,'primary_brand','brand',$4::uuid,'Classification A',1,
        'approved','mention_semantic','1','fixture','mention_semantic','eligible',
        'model_reviewed_context',$5,'signal-semantic-claude-resolution',1,true,$6,
        $7::uuid,'claude_semantic_resolution',now())`,
      [I.workspaceA,roots[7],I.sourceA,I.brandA,H("d"),K("provider-autoapproval"),I.userA]),
      /no_provider_autoapproval/);

    await assert.rejects(client.query(`INSERT INTO signal_refresh_runs(
      workspace_id,study_corpus_id,source_key,idempotency_key,trigger,status,attempt,run_type,
      taxonomy_profile_id,model_version_id,input_corpus_revision,budget_cap_usd)
      VALUES($1::uuid,$2::uuid,'taxonomy','kill-switch-fixture','manual','queued',1,
        'taxonomy_enrichment',$3::uuid,$4::uuid,1,1)`,
      [I.workspaceA,I.corpus,I.profile,I.profileModel]), /signal_taxonomy_enrichment_retired_10b/);
    await client.query(`INSERT INTO signal_refresh_runs(
      workspace_id,study_corpus_id,source_key,idempotency_key,trigger,status,attempt,run_type,
      taxonomy_profile_id,model_version_id,input_corpus_revision,budget_cap_usd,error_code)
      VALUES($1::uuid,$2::uuid,'taxonomy','kill-switch-history','manual','blocked',1,
        'taxonomy_enrichment',$3::uuid,$4::uuid,1,1,'signal_taxonomy_enrichment_retired_10b')`,
      [I.workspaceA,I.corpus,I.profile,I.profileModel]);
    await assert.rejects(client.query(`UPDATE signal_refresh_runs SET status='queued'
      WHERE idempotency_key='kill-switch-history'`), /signal_taxonomy_enrichment_retired_10b/);

    const protectedCounts = await client.query(`SELECT
      (SELECT count(*)::int FROM signal_acquisition_plans) acquisition_plans,
      (SELECT count(*)::int FROM signal_acquisition_slots) acquisition_slots,
      (SELECT count(*)::int FROM signal_governed_view_bindings) governed_bindings,
      (SELECT count(*)::int FROM signal_workspace_population_pointers) pointers`);
    assert.deepEqual(protectedCounts.rows[0], { acquisition_plans: 0, acquisition_slots: 0, governed_bindings: 0, pointers: 0 });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      fixture: { exact_approved: 1, labeling_function_approved: 1, model_pending: 1,
        human_approved: 1, human_corrected: 1, rejected: 1, abstained: 1, technical_error: 1 },
      denominator: 7,
      resolved: 6,
      projected: 3,
      projection_digest: projected.rows[0]!.projection_digest,
      provider_calls: 0,
      paid_jobs: 0,
      protected: protectedCounts.rows[0]
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
});

async function appendResult(
  client: pg.Client, generationId: string, rootId: string, state: string, method: string | null,
  termId: string | null, lfId: string | null, modelId: string | null, policyId: string | null,
  actorId: string, idempotency: string, request: string, technicalError: string | null = null,
  supersedesAssignmentId: string | null = null
) {
  const result = await client.query<{ generation_item_id: string; assignment_id: string | null; created: boolean }>(`
    SELECT * FROM append_signal_classification_result_v1(
      $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8::uuid,$9::uuid,
      1,'high',$10,$11,$12,$13,$14::uuid,$15,$16,$17::uuid)
  `, [I.workspaceA,generationId,rootId,state,method,termId,lfId,modelId,policyId,H("e"),H("f"),H("a"),technicalError,actorId,idempotency,request,supersedesAssignmentId]);
  const row = result.rows[0]!;
  const canonical = await client.query<{ canonical_root_id: string }>(`
    SELECT canonical_root_id::text FROM signal_classification_generation_items WHERE id=$1::uuid
  `, [row.generation_item_id]);
  return { ...row, canonical_root_id: canonical.rows[0]!.canonical_root_id };
}

async function seedClassificationControlPlane(client: pg.Client) {
  const labelingFunction = await client.query<{ labeling_function_version_id: string; created: boolean }>(`
    SELECT * FROM register_signal_labeling_function_v1(
      $1::uuid,'workspace','exact-service-quality',1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,
      $6,'approved',now()-interval '1 day',NULL,NULL,$7::uuid,$8,$9)
  `,[I.workspaceA,I.profile,I.term,JSON.stringify({ fields: ["normalized_platform"] }),
    JSON.stringify({ outcomes: ["vote","abstain"] }),H("6"),I.userA,K("lf-register"),K("lf-register-request")]);
  assert.equal(labelingFunction.rows[0]!.created,true);
  const labelingFunctionReplay = await client.query<{ labeling_function_version_id: string; created: boolean }>(`
    SELECT * FROM register_signal_labeling_function_v1(
      $1::uuid,'workspace','exact-service-quality',1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,
      $6,'approved',now()-interval '1 day',NULL,NULL,$7::uuid,$8,$9)
  `,[I.workspaceA,I.profile,I.term,JSON.stringify({ fields: ["normalized_platform"] }),
    JSON.stringify({ outcomes: ["vote","abstain"] }),H("6"),I.userA,K("lf-register"),K("lf-register-request")]);
  assert.equal(labelingFunctionReplay.rows[0]!.created,false);
  assert.equal(labelingFunctionReplay.rows[0]!.labeling_function_version_id,
    labelingFunction.rows[0]!.labeling_function_version_id);
  await assert.rejects(client.query(`SELECT * FROM register_signal_labeling_function_v1(
    $1::uuid,'workspace','exact-service-quality',1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,
    $6,'approved',now()-interval '1 day',NULL,NULL,$7::uuid,$8,$9)`,
    [I.workspaceA,I.profile,I.term,JSON.stringify({ fields: ["normalized_platform"] }),
      JSON.stringify({ outcomes: ["vote","abstain"] }),H("6"),I.userA,
      K("lf-register"),K("lf-register-different-request")]), /incompatible input/);
  await assert.rejects(client.query(`SELECT * FROM register_signal_labeling_function_v1(
    $1::uuid,'workspace','unsafe',1,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,$6,
    'draft',now(),NULL,NULL,$7::uuid,$8,$9)`,[I.workspaceA,I.profile,I.term,
    JSON.stringify({ sql: "select 1" }),JSON.stringify({ outcomes: ["vote","abstain"] }),
    H("d"),I.userA,K("lf-unsafe"),K("lf-unsafe-request")]), /check constraint/);

  const model = await client.query<{ model_version_id: string; created: boolean }>(`
    SELECT * FROM register_signal_tagging_model_v1(
      $1::uuid,$2::uuid,'classification-model','1','fixture',$3::uuid,$4,'fixture',
      'fixture-json','{}'::jsonb,$5,$6,NULL,'fixture-license',$7,NULL,$8::uuid,$9,$10)
  `,[I.workspaceA,I.profile,I.rules,H("2"),H("3"),H("4"),H("5"),I.userA,
    K("model-register"),K("model-register-request")]);
  assert.equal(model.rows[0]!.created,true);

  const exactPolicy = await client.query<{ approval_policy_id: string }>(`
    SELECT * FROM register_signal_classification_approval_policy_v1(
      $1::uuid,$2::uuid,'approved-exact',1,'exact',NULL,NULL,$3,$4,'approved',
      now()-interval '1 day',now()+interval '1 hour',NULL,$5::uuid,$6,$7)
  `,[I.workspaceA,I.profile,H("7"),H("8"),I.userA,K("policy-exact"),K("policy-exact-request")]);
  const functionPolicy = await client.query<{ approval_policy_id: string }>(`
    SELECT * FROM register_signal_classification_approval_policy_v1(
      $1::uuid,$2::uuid,'approved-lf',1,'labeling_function',$3::uuid,NULL,NULL,$4,
      'approved',now()-interval '1 day',NULL,NULL,$5::uuid,$6,$7)
  `,[I.workspaceA,I.profile,labelingFunction.rows[0]!.labeling_function_version_id,H("9"),I.userA,
    K("policy-lf"),K("policy-lf-request")]);
  return {
    labelingFunctionId: labelingFunction.rows[0]!.labeling_function_version_id,
    registryModelId: model.rows[0]!.model_version_id,
    exactPolicyId: exactPolicy.rows[0]!.approval_policy_id,
    functionPolicyId: functionPolicy.rows[0]!.approval_policy_id
  };
}

async function seedGoldAndEvaluation(client: pg.Client, generationId: string, registryModelId: string) {
  const goldItems = [{
    canonical_root_id: roots[0], split: "test", expected_disposition: "approved",
    expected_taxonomy_term_id: I.term, slice_keys: ["language:es"],
    evidence_digest: H("2"), item_digest: H("3")
  }];
  const gold = await client.query<{ gold_set_version_id: string; finalized_digest: string; created: boolean }>(`
    SELECT * FROM register_signal_classification_gold_set_v1(
      $1::uuid,$2::uuid,'topics-gold',1,$3,now(),NULL,NULL,$4::jsonb,
      $5::uuid,$6,$7)
  `,[I.workspaceA,I.profile,H("1"),JSON.stringify(goldItems),I.userA,K("gold"),K("gold-request")]);
  const goldId = gold.rows[0]!.gold_set_version_id;
  assert.equal(gold.rows[0]!.created,true);
  assert.match(gold.rows[0]!.finalized_digest,/^sha256:[0-9a-f]{64}$/);
  const leakedSplitItems = [{ ...goldItems[0], split: "validation" }];
  await assert.rejects(client.query(`SELECT * FROM register_signal_classification_gold_set_v1(
    $1::uuid,$2::uuid,'topics-gold',2,$3,now(),NULL,$4::uuid,$5::jsonb,
    $6::uuid,$7,$8)`,[I.workspaceA,I.profile,H("b"),goldId,JSON.stringify(leakedSplitItems),
    I.userA,K("gold-split-leak"),K("gold-split-leak-request")]), /split leakage/);
  await assert.rejects(client.query(`INSERT INTO signal_classification_gold_items(
    workspace_id,gold_set_version_id,canonical_root_id,split,expected_disposition,
    expected_taxonomy_term_id,evidence_digest,labeled_by_user_id,item_digest)
    VALUES($1::uuid,$2::uuid,$3::uuid,'train','approved',$4::uuid,$5,$6::uuid,$7)`,
    [I.workspaceA,goldId,roots[0],I.term,H("4"),I.userA,H("5")]), /authority is invalid|split leakage/);

  await assert.rejects(client.query(`SELECT * FROM record_signal_classification_evaluation_v1(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,'test',7,6,3,1,1,1,1,
    6::numeric/7,0.5,1,2::numeric/3,$6,$7,$8,$9::uuid,$10,$11)
  `,[I.workspaceA,I.profile,generationId,goldId,registryModelId,H("6"),H("7"),H("8"),I.userA,
    K("evaluation-invalid"),K("evaluation-invalid-request")]), /gold metrics are not reproducible/);
  const evaluation = await client.query<{ evaluation_id: string }>(`
    SELECT * FROM record_signal_classification_evaluation_v1(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,NULL,'test',7,6,3,1,1,1,1,
      6::numeric/7,1,1,1,$6,$7,$8,$9::uuid,$10,$11)
  `,[I.workspaceA,I.profile,generationId,goldId,registryModelId,H("6"),H("7"),H("8"),I.userA,
    K("evaluation"),K("evaluation-request")]);
  const evaluationId = evaluation.rows[0]!.evaluation_id;
  const slice = await client.query<{ denominator: number; resolved: number; precision_score: string;
    recall_score: string; f1_score: string; created: boolean }>(`
    SELECT * FROM record_signal_classification_evaluation_slice_v1(
      $1::uuid,$2::uuid,'language:es',$3::uuid,$4,$5)
  `,[I.workspaceA,evaluationId,I.userA,K("evaluation-slice"),K("evaluation-slice-request")]);
  assert.deepEqual({ denominator: slice.rows[0]!.denominator, resolved: slice.rows[0]!.resolved,
    precision: Number(slice.rows[0]!.precision_score), recall: Number(slice.rows[0]!.recall_score),
    f1: Number(slice.rows[0]!.f1_score), created: slice.rows[0]!.created },
  { denominator: 1, resolved: 1, precision: 1, recall: 1, f1: 1, created: true });
  await assert.rejects(client.query(`INSERT INTO signal_classification_evaluation_slices(
    evaluation_id,slice_key,split,denominator,resolved,precision_score,recall_score,f1_score,
    slice_digest,operation_id)
    SELECT $1::uuid,'language:es','test',1,1,0,0,0,$2,operation_id
    FROM signal_classification_evaluations WHERE id=$1::uuid`,[evaluationId,H("a")]),
  /not reproducible/);
  await assert.rejects(client.query(`SELECT * FROM record_signal_classification_evaluation_slice_v1(
    $1::uuid,$2::uuid,'language:en',$3::uuid,$4,$5)`,
    [I.workspaceA,evaluationId,I.userA,K("empty-slice"),K("empty-slice-request")]), /slice is empty/);

  await client.query(`SELECT * FROM transition_signal_tagging_model_v1(
    $1::uuid,$2::uuid,'evaluated',$3::uuid,now(),$4,$5::uuid,$6,$7)`,
    [I.workspaceA,registryModelId,evaluationId,H("e"),I.userA,
      K("model-evaluated"),K("model-evaluated-request")]);
}

async function seedFixture(client: pg.Client) {
  await client.query("SET session_replication_role=replica");
  try {
    await client.query(`
      INSERT INTO organizations(id,slug,legal_name,status) VALUES
        ('${I.orgA}','classification-a','Classification A','active'),
        ('${I.orgB}','classification-b','Classification B','active');
      INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
        ('${I.userA}','classification-a@example.test','Operator A','noisia_internal','admin','${I.orgA}','active'),
        ('${I.userB}','classification-b@example.test','Operator B','noisia_internal','admin','${I.orgB}','active');
      INSERT INTO brands(id,organization_id,slug,name,display_name,status) VALUES
        ('${I.brandA}','${I.orgA}','classification-a','Classification A','Classification A','active'),
        ('${I.brandB}','${I.orgB}','classification-b','Classification B','Classification B','active');
      INSERT INTO signal_workspaces(id,organization_id,brand_id,slug,timezone,status) VALUES
        ('${I.workspaceA}','${I.orgA}','${I.brandA}','classification-a','America/Mexico_City','active'),
        ('${I.workspaceB}','${I.orgB}','${I.brandB}','classification-b','America/Mexico_City','active');
      INSERT INTO methodologies(id,slug,name,version,status,manifest_yaml)
        VALUES('${I.method}','classification-fixture','Classification fixture','1.0.0','active','{}'::jsonb);
      INSERT INTO study_corpora(id,name,brand_id,methodology_id,methodology_version_at_creation,
        business_question,decision_to_inform,status)
        VALUES('${I.corpus}','Classification corpus','${I.brandA}','${I.method}','1.0.0','Q','D','corpus_approved');
      INSERT INTO signal_workspace_corpora(workspace_id,study_corpus_id,role)
        VALUES('${I.workspaceA}','${I.corpus}','operational');
      INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,
        connection_method,name,status,source_contract_version,source_key)
        VALUES
        ('${I.sourceA}','${I.workspaceA}','${I.orgA}','${I.brandA}','social-listening','fixture','csv','Source A','active',
          'signal-data-source-connector-v1','source-sha256-${"a".repeat(64)}'),
        ('${I.sourceB}','${I.workspaceB}','${I.orgB}','${I.brandB}','social-listening','fixture','csv','Source B','active',
          'signal-data-source-connector-v1','source-sha256-${"b".repeat(64)}');
      INSERT INTO signal_data_watermarks(workspace_id,study_corpus_id,data_source_id,source_key,
        corpus_revision,accepted_at,materialized_at)
        VALUES('${I.workspaceA}','${I.corpus}','${I.sourceA}','classification-fixture',1,now(),now());
      INSERT INTO taxonomies(id,taxonomy_key,name,scope,status)
        VALUES('${I.taxonomy}','classification-topics','Classification topics','workspace','active');
      INSERT INTO taxonomy_terms(id,taxonomy_id,term_key,label,status)
        VALUES('${I.term}','${I.taxonomy}','service_quality','Service quality','active');
      INSERT INTO tagging_rule_sets(id,rule_set_key,version,subject_type,scope,taxonomy_id,rules,status)
        VALUES('${I.rules}','classification-rules',1,'mention','workspace','${I.taxonomy}','{}'::jsonb,'active');
      INSERT INTO tagging_model_versions(id,model_key,provider,version,tagging_rule_set_id)
        VALUES('${I.profileModel}','classification-profile-model','fixture','1','${I.rules}');
      INSERT INTO signal_taxonomy_profiles(id,workspace_id,taxonomy_id,kind,version,status,context_hash,
        rule_set_id,model_version_id,approved_by_user_id,approved_at)
        VALUES('${I.profile}','${I.workspaceA}','${I.taxonomy}','topic',1,'active','${H("1")}',
          '${I.rules}','${I.profileModel}','${I.userA}',now());
    `);
    for (const [index, root] of roots.entries()) {
      await client.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
        provider_record_id,external_id,source_system,text_hash,text_clean,text_length,published_at,
        platform,inclusion_status,study_corpus_id)
        VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,'fixture',$5,'Synthetic classification record',31,
          now(),'web','included',$6::uuid)`, [root,I.workspaceA,I.sourceA,`root-${index}`,H(String((index + 1) % 10)),I.corpus]);
    }
    await client.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
      provider_record_id,external_id,source_system,text_hash,text_clean,text_length,published_at,
      platform,inclusion_status,study_corpus_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'alias','alias','fixture',$5,'Alias record',12,now(),
        'web','included',$6::uuid)`, [I.alias,I.workspaceA,I.sourceA,roots[0],H("f"),I.corpus]);
    await client.query(`INSERT INTO signal_mention_study_memberships(
      workspace_id,mention_id,study_corpus_id,membership_role)
      SELECT $1::uuid,id,$2::uuid,'contributed' FROM mentions
      WHERE workspace_id=$1::uuid AND canonical_mention_id=id`, [I.workspaceA,I.corpus]);
  } finally {
    await client.query("SET session_replication_role=origin");
  }
}

async function applyAllMigrations(client: pg.Client) {
  const directory = dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/u.test(file)).sort();
  for (const file of files) await client.query(await readFile(join(directory, file), "utf8"));
}

function requireDisposableLocalDatabase(value: string) {
  const url = new URL(value);
  assert.ok(["127.0.0.1","localhost","::1"].includes(url.hostname));
  assert.match(url.pathname, /10b|classification/i);
}

async function scalar(client: pg.Client, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, Number(row[key])]));
}

function K(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
