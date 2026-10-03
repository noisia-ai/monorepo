import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import pg from "pg";

import {
  finalizeSignalTopicDiscoveryReviewV1,
  listSignalTopicDiscoveryProposalsV1,
  loadSignalTopicDiscoveryProposalDetailV1,
  loadSignalTopicDiscoveryReviewExportV1,
  loadSignalTopicDiscoveryReviewHistoryV1,
  loadSignalTopicDiscoveryReviewSummaryV1,
  registerSignalTopicDiscoveryReviewPacketV1,
  resolveSignalTopicDiscoveryEvidenceRootsV1,
  saveSignalTopicDiscoveryOutlierDraftV1,
  saveSignalTopicDiscoveryReviewDraftV1,
  supersedeSignalTopicDiscoveryReviewV1
} from "@/lib/data-os/signal-topic-discovery-review";
import { pool } from "@/lib/db";

const DB_URL = process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_INTEGRATION_URL;
const APPROVED = process.env.NOISIA_SIGNAL_TOPIC_DISCOVERY_REVIEW_INTEGRATION_APPROVED === "true";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};

test("0090 review workbench is append-only, idempotent, workspace-safe, and grants no modeling authority", {
  skip: !DB_URL || !APPROVED,
  timeout: 180_000
}, async () => {
  assert.ok(DB_URL);
  requireLocal(DB_URL);
  const admin = new pg.Client({ connectionString: DB_URL, ssl: false });
  await admin.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    const directory = resolve(process.cwd(), "../../infrastructure/db/migrations");
    const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/u.test(file)).sort();
    for (const file of files) await admin.query(await readFile(join(directory, file), "utf8"));
  } finally {
    await admin.end();
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedFixture(suffix);
  const protectedPointerCountBefore = (await pool.query<{ count: number }>(`
    SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`,
  [fixture.workspace.id])).rows[0]?.count ?? 0;
  const key = randomBytes(32);
  const evidenceRef = `sha256:${createHmac("sha256", key).update(`root:${fixture.mentionId}`).digest("hex")}` as `sha256:${string}`;
  const packet = fixturePacket(evidenceRef, fixture.rootAuthorityHash, "main");
  const expectedAuthority = new Map([[evidenceRef, {
    authorityDigest: fixture.rootAuthorityHash,
    memberships: [{ partitionKey: "primary_brand",scope: "primary_brand",planVersion: 1,
      planDigest: fixture.planDigest,slotDigest: fixture.slotDigest,
      authorityDigest: fixture.membershipAuthorityHash,
      authorityValidUntil: "2030-01-01T00:00:00.000Z" }]
  }]]);
  const resolved = await resolveSignalTopicDiscoveryEvidenceRootsV1({
    queryable: pool,
    workspaceId: fixture.workspace.id,
    evidenceRefs: new Set([evidenceRef]),
    pseudonymKey: key,
    expectedAuthority
  });
  assert.equal(resolved.get(evidenceRef)?.mentionId, fixture.mentionId);

  const client = await pool.connect();
  let registered: { artifact_key: string; review_key: string };
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    registered = await registerSignalTopicDiscoveryReviewPacketV1({
      queryable: client, workspace: fixture.workspace, actor: fixture.actor,
      idempotencyKey: `register-${suffix}`, packet,
      packetFileDigest: digest("packet-file-main"), sourceManifestDigest: digest("source-manifest"),
      discoveryRunDigest: digest("discovery-run"), candidateArtifactDigest: digest("candidate"),
      rightsDigest: digest("rights-authority"), evidenceAuthority: resolved
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  assert.match(registered.artifact_key, /^topic-discovery-packet-/u);

  const summary = await loadSignalTopicDiscoveryReviewSummaryV1({ workspace: fixture.workspace });
  assert.deepEqual({ proposals: summary.run.proposal_count, evidence: summary.run.evidence_count,
    outliers: summary.run.outlier_evidence_count, reviewed: summary.review.reviewed },
  { proposals: 3, evidence: 3, outliers: 1, reviewed: 0 });
  assert.equal(summary.diagnostic.holdout_opened, false);
  assert.equal(summary.diagnostic.ten_c3b_authorized, false);
  assert.equal(summary.diagnostic.ten_d_ready, false);

  const firstPage = await listSignalTopicDiscoveryProposalsV1({ workspace: fixture.workspace, limit: 2 });
  assert.equal(firstPage.records.length, 2);
  assert.ok(firstPage.next_cursor);
  const secondPage = await listSignalTopicDiscoveryProposalsV1({ workspace: fixture.workspace,
    limit: 2, cursor: firstPage.next_cursor });
  assert.deepEqual(secondPage.records.map((record) => record.key), ["proposal-003"]);
  await assert.rejects(listSignalTopicDiscoveryProposalsV1({ workspace: fixture.workspace, limit: 2,
    cursor: firstPage.next_cursor, filters: { scope: "category" } }), /cursor/u);

  const detail = await loadSignalTopicDiscoveryProposalDetailV1({
    workspace: fixture.workspace, proposalKey: "proposal-001"
  });
  assert.equal(detail.evidence.length, 1);
  assert.equal(detail.proposal.technical.holdout_opened, false);
  assert.equal(JSON.stringify(detail).includes(fixture.mentionId), false);
  assert.equal(JSON.stringify({ summary, detail }).includes("blind-review-key"), false);
  assert.equal(JSON.stringify({ summary, detail }).includes(".data/"), false);
  assert.equal(JSON.stringify({ summary, detail }).includes("Private fixture mention"), false);

  const complete = {
    internal_coherence: 4, neighbor_distinction: 4, human_nameability: 4, strategic_utility: 4,
    merge_needed: false, split_needed: false, convert_to_topic_contract_candidate: false,
    none_acceptable: false, notes: "Synthetic operator fixture"
  };
  for (const proposalKey of ["proposal-001", "proposal-002", "proposal-003"]) {
    const input = { proposal_key: proposalKey, ...complete,
      convert_to_topic_contract_candidate: proposalKey === "proposal-001" };
    const saved = await saveSignalTopicDiscoveryReviewDraftV1({ workspace: fixture.workspace,
      actor: fixture.actor, idempotencyKey: `draft-${suffix}-${proposalKey}`, input });
    assert.deepEqual(await saveSignalTopicDiscoveryReviewDraftV1({ workspace: fixture.workspace,
      actor: fixture.actor, idempotencyKey: `draft-${suffix}-${proposalKey}`, input }), saved);
  }
  await assert.rejects(saveSignalTopicDiscoveryReviewDraftV1({ workspace: fixture.workspace,
    actor: fixture.actor, idempotencyKey: `draft-${suffix}-proposal-001`,
    input: { proposal_key: "proposal-001", ...complete, notes: "Incompatible replay" } }), /incompatible/u);
  await saveSignalTopicDiscoveryOutlierDraftV1({ workspace: fixture.workspace, actor: fixture.actor,
    idempotencyKey: `outlier-${suffix}`, input: { study_boundary_thresholds: true,
      study_missing_topic_families: true, study_later_recovery: true, notes: "Synthetic fixture" } });

  const finalized = await finalizeSignalTopicDiscoveryReviewV1({ workspace: fixture.workspace,
    actor: fixture.actor, idempotencyKey: `finalize-${suffix}`, outcome: "candidate_preferred" });
  assert.equal(finalized.modeling_adopted, false);
  assert.equal(finalized.ten_c3b_authorized, false);
  assert.equal(finalized.ten_d_ready, false);
  assert.deepEqual(await finalizeSignalTopicDiscoveryReviewV1({ workspace: fixture.workspace,
    actor: fixture.actor, idempotencyKey: `finalize-${suffix}`, outcome: "candidate_preferred" }), finalized);
  const exported = await loadSignalTopicDiscoveryReviewExportV1({ workspace: fixture.workspace,
    kind: "decision-sheet" });
  assert.match(exported.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(exported.body.includes("Private fixture excerpt"), false);
  assert.equal(exported.body.includes(fixture.mentionId), false);

  await assert.rejects(pool.query("UPDATE signal_topic_discovery_review_decisions SET notes='mutated'"),
    (error: unknown) => (error as { code?: string }).code === "55000");
  const correction = await supersedeSignalTopicDiscoveryReviewV1({ workspace: fixture.workspace,
    actor: fixture.actor, idempotencyKey: `supersede-${suffix}` });
  assert.equal(correction.revision, 2);
  assert.deepEqual(await supersedeSignalTopicDiscoveryReviewV1({ workspace: fixture.workspace,
    actor: fixture.actor, idempotencyKey: `supersede-${suffix}` }), correction);
  const history = await loadSignalTopicDiscoveryReviewHistoryV1({ workspace: fixture.workspace });
  assert.ok(history.events.some((event) => event.event_kind === "review_superseded"));

  await assert.rejects(loadSignalTopicDiscoveryReviewSummaryV1({ workspace: fixture.otherWorkspace }), /not_found/u);
  const artifactTypes = await pool.query<{ artifact_type: string }>(`
    SELECT artifact_type FROM analysis_artifacts WHERE workspace_id=$1::uuid ORDER BY artifact_type`,
  [fixture.workspace.id]);
  assert.deepEqual(new Set(artifactTypes.rows.map((row) => row.artifact_type)),
    new Set(["topic_discovery_review_packet", "topic_discovery_proposal"]));
  assert.equal((await pool.query<{ count: number }>(`
    SELECT count(*)::int count FROM signal_classification_assignments WHERE workspace_id=$1::uuid`,
  [fixture.workspace.id])).rows[0]?.count, 0);
  assert.equal((await pool.query<{ count: number }>(`
    SELECT count(*)::int count FROM signal_workspace_population_pointers WHERE workspace_id=$1::uuid`,
  [fixture.workspace.id])).rows[0]?.count, protectedPointerCountBefore);

  const expiredPacket = fixturePacket(evidenceRef, fixture.rootAuthorityHash, "expired");
  const expiredAuthority = new Map(resolved);
  expiredAuthority.set(evidenceRef, { ...resolved.get(evidenceRef)!, authorityValidUntil: "2020-01-01T00:00:00.000Z" });
  const expiredClient = await pool.connect();
  try {
    await expiredClient.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await registerSignalTopicDiscoveryReviewPacketV1({ queryable: expiredClient,
      workspace: fixture.workspace, actor: fixture.actor, idempotencyKey: `register-expired-${suffix}`,
      packet: expiredPacket, packetFileDigest: digest("packet-file-expired"),
      sourceManifestDigest: digest("source-manifest"), discoveryRunDigest: digest("discovery-run-expired"),
      candidateArtifactDigest: digest("candidate-expired"), rightsDigest: digest("rights-authority-expired"),
      evidenceAuthority: expiredAuthority });
    await expiredClient.query("COMMIT");
  } catch (error) {
    await expiredClient.query("ROLLBACK");
    throw error;
  } finally {
    expiredClient.release();
  }
  await assert.rejects(loadSignalTopicDiscoveryReviewSummaryV1({ workspace: fixture.workspace,
    runKey: `review-${expiredPacket.packet_digest.slice(7, 23)}` }), /rights_expired/u);
  await pool.end();
});

function fixturePacket(evidenceRef: `sha256:${string}`, rightsDigest: `sha256:${string}`, variant: string) {
  const topics = ["primary_brand", "category", "competitor"].map((scope, index) => {
    const body = { contract_version: "signal-semantic-benchmark-packet-v1",
      run_key: `fixture-${variant}`, cluster_key: `${variant}-cluster-${index}`,
      cluster_content_digest: digest(`${variant}-content-${index}`), packet_policy_version: "fixture-policy-v1",
      packet_policy_digest: digest("packet-policy"), cluster_member_count: 10 + index,
      population_denominator: 100, coverage: { breadth_state: "bounded",
        cluster_share_of_reviewed_scope: (10 + index) / 100, distinct_slice_count: 1,
        maximum_representatives: 8, observed_slice_count: 1, representative_count: 1,
        reviewed_scope: "full_population", reviewed_scope_denominator: 100 },
      count_scope: "full_population", representatives: [{ evidence_ref: evidenceRef, role: "medoid",
        selection_reason: "synthetic-medoid", excerpt: "Private fixture excerpt", language: "es",
        scope, source_slice: "social", time_slice: "2026-08", rights_digest: rightsDigest }],
      local_terms: [`term-${index}`], local_phrases: [`phrase-${index}`],
      distributions: { scope: { [scope]: 10 + index }, language: { es: 10 + index } },
      distribution_contracts: {}, neighboring_clusters: [], stability: { matched_assignment_consistency: 0.7 },
      outlier_information: {}, limitations: [], estimated_tokens: 100, excerpt_character_count: 24 };
    return { topic_label: `Topic ${index + 1}`, scores: {},
      sealed_packet: { ...body, packet_digest: digest(stableJson(body)) } };
  });
  return { contract_version: "signal-topic-discovery-diagnostic-review-v1",
    review_status: "operator_diagnostic_review_required", modeling_scope: "full_population",
    modeling_record_count: 100, review_scope: "complete_cluster_census", population_denominator: 100,
    modeling_decision_allowed: false, adoption_allowed: false, holdout_opened: false,
    count_scope: "full_population_diagnostic", decision_sheet_contract: "signal-topic-discovery-blind-decision-sheet-v2",
    packet_policy_version: "fixture-policy-v1", packet_policy_digest: digest("packet-policy"),
    packet_token_count: 300, packet_token_limit: 1000, technical_limitations: [], seed: 17,
    quality_floor: {}, instructions: [], none_acceptable: null,
    candidates: [{ candidate_label: "Candidate A", topic_count: 3, reviewed_topic_count: 3,
      unreviewed_topic_count: 0, cluster_selection_state: "complete",
      cluster_selection_contract: "complete_cluster_census", reviewed_cluster_population_count: 33,
      reviewed_cluster_population_share: 0.33, outlier_count: 67,
      outlier_examples: [{ evidence_ref: evidenceRef, excerpt: "Private outlier fixture", language: "es",
        platform: "social", rights_digest: rightsDigest, scope: "category",
        selection_reason: "seeded_bounded_outlier_diagnostic_sample", time_slice: "2026-08" }],
      packet_token_count: 300, packet_token_limit: 1000, multiscope_summary: {}, topics }],
    candidate_role: "discovery_proposal_only", reference_seed: 17,
    reference_seed_selection_basis: "first_preregistered_final_seed", stability_context: {},
    operator_decision_fields: { internal_coherence: null, neighbor_distinction: null,
      human_nameability: null, strategic_utility: null, merge_needed: null, split_needed: null,
      convert_to_topic_contract_candidate: null, none_acceptable: null },
    packet_digest: digest(`opaque-${variant}`) };
}

async function seedFixture(suffix: string) {
  const orgId = randomUUID(); const brandId = randomUUID();
  const userId = randomUUID(); const sourceId = randomUUID(); const importId = randomUUID();
  const mentionId = randomUUID(); const qualityId = randomUUID(); const retentionId = randomUUID();
  const licensingId = randomUUID(); const bindingId = randomUUID();
  const profileId = randomUUID(); const planId = randomUUID(); const slotId = randomUUID();
  const otherOrgId = randomUUID(); const otherBrandId = randomUUID();
  await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status) VALUES
    ($1::uuid,$2,$3,$3,'active'),($4::uuid,$5,$6,$6,'active')`,
  [orgId, `review-${suffix}`, `Review ${suffix}`, otherOrgId, `other-${suffix}`, `Other ${suffix}`]);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES($1::uuid,$2,$3,'noisia_internal','noisia_admin',NULL,'active')`,
  [userId, `review-${suffix}@example.test`, `Reviewer ${suffix}`]);
  await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,countries,status) VALUES
    ($1::uuid,$2::uuid,$3,$4,$4,ARRAY['MX']::char(2)[],'active'),
    ($5::uuid,$6::uuid,$7,$8,$8,ARRAY['US']::char(2)[],'active')`,
  [brandId, orgId, `review-brand-${suffix}`, `Review brand ${suffix}`,
    otherBrandId, otherOrgId, `other-brand-${suffix}`, `Other brand ${suffix}`]);
  const workspaceRows = await pool.query<{ id: string; brand_id: string }>(`
    SELECT id::text,brand_id::text FROM signal_workspaces WHERE brand_id=ANY($1::uuid[])
    ORDER BY brand_id`, [[brandId, otherBrandId]]);
  const workspaceId = workspaceRows.rows.find((row) => row.brand_id === brandId)!.id;
  const otherWorkspaceId = workspaceRows.rows.find((row) => row.brand_id === otherBrandId)!.id;
  const brandOsDigest = digest(`brand-os-${suffix}`);
  const identityDigest = digest(`identity-${suffix}`);
  const planDigest = digest(`plan-${suffix}`);
  const slotDigest = digest(`slot-${suffix}`);
  const headerHash = digest("header");
  const planOperationKey = digest(`signal-product-operation-v1\x1freview-plan-${suffix}`);
  await pool.query(`INSERT INTO brand_os_profiles(id,organization_id,brand_id,name,status,version,metadata)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4,'active',1,jsonb_build_object('snapshot_hash',$5::text))`,
  [profileId, orgId, brandId, `Profile ${suffix}`, brandOsDigest]);
  await pool.query(`INSERT INTO signal_governance_control_operations(workspace_id,actor_user_id,
    action,request_digest,idempotency_key,status) VALUES($1::uuid,$2::uuid,
      'reconcile-acquisition-plan',$3,$4,'in_progress')`,
  [workspaceId, userId, digest(`plan-operation-request-${suffix}`), planOperationKey]);
  await pool.query(`INSERT INTO signal_acquisition_plans(id,workspace_id,plan_version,status,
    brand_os_profile_id,brand_os_profile_version,brand_os_digest,identity_catalog_digest,
    draft_revision,draft_digest,definition_hash,created_by_user_id,
    creation_idempotency_key,request_digest)
    VALUES($1::uuid,$2::uuid,1,'draft',$3::uuid,1,$4,$5,1,$6,NULL,
      $7::uuid,$8,$9)`,
  [planId, workspaceId, profileId, brandOsDigest, identityDigest, planDigest, userId,
    planOperationKey, digest(`plan-request-${suffix}`)]);
  await pool.query(`INSERT INTO signal_acquisition_slots(id,workspace_id,plan_id,slot_key,
    slot_version,scope,entity_type,entity_id,entity_revision_digest,label,desired_state,position,
    definition_hash,created_by_user_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,'primary-brand',1,'primary_brand','brand',$4::uuid,$5,$6,
      'active',0,$7,$8::uuid)`,
  [slotId, workspaceId, planId, brandId, brandOsDigest, `Primary ${suffix}`, slotDigest, userId]);
  await pool.query(`UPDATE signal_acquisition_plans SET status='current',definition_hash=draft_digest,
    effective_from=clock_timestamp(),promoted_by_user_id=$2::uuid,promoted_at=clock_timestamp()
    WHERE id=$1::uuid`, [planId, userId]);
  await pool.query(`INSERT INTO data_sources(id,workspace_id,organization_id,brand_id,source_type,provider,
    connection_method,name,status,source_contract_version,source_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'social-listening','sentione','manual-csv',$5,
      'active','signal-data-source-connector-v1',$6)`,
  [sourceId, workspaceId, orgId, brandId, `Source ${suffix}`, `source-${digest(suffix).replace("sha256:", "sha256-")}`]);
  await pool.query(`INSERT INTO import_batches(id,workspace_id,data_source_id,source_system,
    source_file_name,source_file_hash,imported_by_user_id,record_count,included_count,excluded_count,
    duplicate_count,status,ingestion_phase,storage_content_hash,processed_bytes,progress_record_count,
    expected_file_size_bytes,storage_part_count,storage_part_size_bytes,upload_protocol,
    acquisition_contract_version,acquisition_plan_id,acquisition_slot_id,capture_period_start,
    capture_period_end,capture_timezone,acquisition_plan_digest,acquisition_slot_digest,
    acquisition_brand_os_digest,acquisition_identity_catalog_digest,provider_schema_version,
    provider_observation_projection_state,provider_observation_header_hash,
    provider_observation_count,acquisition_sealed_at,
    acquisition_query_evidence_class,acquisition_query_evidence_reason,
    acquisition_query_evidence_actor_user_id,acquisition_query_evidence_attested_at,
    acquisition_import_seal_digest)
    VALUES($1::uuid,$2::uuid,$3::uuid,'sentione','fixture.csv',$4,$5::uuid,0,0,0,0,
      'processing','processing',$6,0,0,100,1,100,'server-stream',
      'signal-acquisition-import-v2',$7::uuid,$8::uuid,
      '2026-08-01','2026-08-31','America/Mexico_City',$9,$10,$11,$12,
      'sentione-csv-47-v1','pending',$13,1,clock_timestamp(),'unavailable','historical_export',
      $5::uuid,clock_timestamp(),$14)`,
  [importId, workspaceId, sourceId, digest("file").slice(7), userId, digest("storage").slice(7),
    planId, slotId, planDigest, slotDigest, brandOsDigest, identityDigest, headerHash,
    digest(`seal-${suffix}`)]);
  const separator = "\x1f";
  const retentionEvidence = digest("retention-evidence");
  const licensingEvidence = digest("licensing-evidence");
  const qualityHash = digest(["quality-policy-v1", workspaceId, "review-quality", "1", "1", "", "", "evaluate"].join(separator));
  const retentionHash = digest(["retention-policy-v1", workspaceId, "review-retention", "1", "allowed", "until",
    "2030-01-01T00:00:00Z", "block_use", retentionEvidence].join(separator));
  const licensingHash = digest(["licensing-policy-v1", workspaceId, "review-licensing", "1", licensingEvidence,
    "client-derived-metrics:prohibited,client-mention-list:prohibited,client-text-or-excerpt:prohibited,internal-qa:prohibited,llm-processing:prohibited,strategic-analysis:allowed"].join(separator));
  const bindingHash = digest(["signal-provenance-policy-binding-v1", workspaceId, sourceId, importId, "1",
    qualityId, retentionId, licensingId].join(separator));
  await pool.query(`INSERT INTO signal_quality_policies(id,organization_id,workspace_id,policy_key,
    policy_version,status,min_quality_score,canonical_root_disposition,definition_hash,created_by_user_id,
    activated_by_user_id,activated_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,'review-quality',1,'active',1,'evaluate',$4,$5::uuid,$5::uuid,
      clock_timestamp(),$6)`, [qualityId, orgId, workspaceId, qualityHash, userId, digest(`quality-${suffix}`)]);
  await pool.query(`INSERT INTO signal_retention_policies(id,organization_id,workspace_id,policy_key,
    policy_version,status,retention_state,retention_mode,retain_until,expiry_action,approval_evidence_hash,definition_hash,
    created_by_user_id,approved_by_user_id,approved_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,'review-retention',1,'active','allowed','until',
      '2030-01-01T00:00:00Z','block_use',$4,$5,$6::uuid,$6::uuid,clock_timestamp(),$7)`,
  [retentionId, orgId, workspaceId, retentionEvidence, retentionHash, userId, digest(`retention-${suffix}`)]);
  await pool.query(`INSERT INTO signal_licensing_policies(id,organization_id,workspace_id,policy_key,
    policy_version,status,approval_evidence_hash,definition_hash,created_by_user_id,approved_by_user_id,approved_at,
    creation_idempotency_key) VALUES($1::uuid,$2::uuid,$3::uuid,'review-licensing',1,'draft',$4,$5,
      $6::uuid,NULL,NULL,$7)`,
  [licensingId, orgId, workspaceId, licensingEvidence, licensingHash, userId, digest(`licensing-${suffix}`)]);
  await pool.query(`INSERT INTO signal_licensing_policy_usages(workspace_id,licensing_policy_id,
    usage_purpose,decision) VALUES
      ($1::uuid,$2::uuid,'client-derived-metrics','prohibited'),
      ($1::uuid,$2::uuid,'client-mention-list','prohibited'),
      ($1::uuid,$2::uuid,'client-text-or-excerpt','prohibited'),
      ($1::uuid,$2::uuid,'internal-qa','prohibited'),
      ($1::uuid,$2::uuid,'llm-processing','prohibited'),
      ($1::uuid,$2::uuid,'strategic-analysis','allowed')`, [workspaceId, licensingId]);
  await pool.query(`UPDATE signal_licensing_policies SET status='active',approved_by_user_id=$2::uuid,
    approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`, [licensingId, userId]);
  await pool.query(`INSERT INTO signal_provenance_policy_bindings(id,workspace_id,data_source_id,
    import_batch_id,binding_version,status,quality_policy_id,retention_policy_id,licensing_policy_id,
    definition_hash,created_by_user_id,activated_by_user_id,activated_at,creation_idempotency_key)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,'active',$5::uuid,$6::uuid,$7::uuid,$8,
      $9::uuid,$9::uuid,clock_timestamp(),$10)`,
  [bindingId, workspaceId, sourceId, importId, qualityId, retentionId, licensingId, bindingHash,
    userId, digest(`binding-${suffix}`)]);
  await pool.query(`INSERT INTO mentions(id,workspace_id,data_source_id,canonical_mention_id,
    provider_record_id,external_id,source_system,source_file_id,text_hash,text_clean,text_length,
    published_at,platform,inclusion_status) VALUES($1::uuid,$2::uuid,$3::uuid,$1::uuid,$4,$4,
      'sentione',$5::uuid,$6,'Private fixture mention',23,'2026-08-01T12:00:00Z','social','included')`,
  [mentionId, workspaceId, sourceId, `record-${suffix}`, importId, digest("text").slice(7)]);
  await pool.query(`INSERT INTO signal_provider_mention_observations(workspace_id,data_source_id,
    import_batch_id,mention_id,provider_key,provider_record_key_hash,provider_schema_version,
    provider_header_hash,observation_version,observation_hash,platform,published_at,
    provenance_binding_id,rights_definition_hash,retention_until,acquisition_plan_id,
    acquisition_slot_id,acquisition_plan_digest,acquisition_slot_digest)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'sentione',$5,'sentione-csv-47-v1',$6,1,$7,
      'social','2026-08-01T12:00:00Z',$8::uuid,$9,'2030-01-01T00:00:00Z',
      $10::uuid,$11::uuid,$12,$13)`,
  [workspaceId, sourceId, importId, mentionId, digest("record"), digest("header"), digest("observation"),
    bindingId, bindingHash, planId, slotId, planDigest, slotDigest]);
  await pool.query(`INSERT INTO signal_mention_import_memberships(workspace_id,mention_id,
    import_batch_id,data_source_id,ingestion_disposition)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'included')`,
  [workspaceId, mentionId, importId, sourceId]);
  await pool.query(`UPDATE import_batches SET status='completed',ingestion_phase='completed',
    record_count=1,included_count=1,excluded_count=0,duplicate_count=0,
    processed_bytes=100,progress_record_count=1,completed_at=clock_timestamp(),
    provider_observation_projection_state='ready',
    provider_observation_header_hash=$2 WHERE id=$1::uuid`, [importId, headerHash]);
  const pathAuthorityHash = digest([bindingId, qualityHash, retentionHash, licensingHash,
    bindingHash].join("|"));
  const membershipAuthorityHash = digest(pathAuthorityHash);
  const rootAuthorityHash = digest(stableJson([{
    partition_key: "primary_brand",authority_digest: membershipAuthorityHash
  }]));
  return {
    mentionId, bindingHash,planDigest,slotDigest,membershipAuthorityHash,rootAuthorityHash,
    workspace: { contractVersion: "signal-backend-v1" as const, id: workspaceId, organizationId: orgId,
      slug: `review-workspace-${suffix}`, name: `Review brand ${suffix}`,
      subject: { type: "brand" as const, id: brandId }, timezone: "America/Mexico_City",
      status: "active", corpora: [] },
    otherWorkspace: { contractVersion: "signal-backend-v1" as const, id: otherWorkspaceId,
      organizationId: otherOrgId, slug: `other-workspace-${suffix}`, name: `Other brand ${suffix}`,
      subject: { type: "brand" as const, id: otherBrandId }, timezone: "America/New_York",
      status: "active", corpora: [] },
    actor: { id: userId, userType: "noisia_internal", organizationId: orgId }
  };
}

function requireLocal(value: string) {
  const parsed = new URL(value);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}
