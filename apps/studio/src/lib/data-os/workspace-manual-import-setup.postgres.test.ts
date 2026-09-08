import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const enabled = process.env.NOISIA_MANUAL_IMPORT_SETUP_TEST_APPROVED === "true";

test("new brand manual setup is atomic, scoped, repeatable and accepts a real upload contract without a query", {
  skip: !enabled, timeout: 120_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_manual_import_test_"));
  const { pool } = await import("@/lib/db");
  const { prepareWorkspaceManualImportInTransactionV1, loadWorkspaceManualImportSetupV1 } = await import("./workspace-manual-import-setup");
  const { validateWorkspaceManualImportSetupInputV1, WORKSPACE_MANUAL_IMPORT_SETUP_VERSION } = await import("./workspace-manual-import-contract");
  const { createWorkspaceImportUploadV1 } = await import("./workspace-async-import");
  const { resolveSignalWorkspaceForUser } = await import("./signal-workspace");
  const operatorId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
    VALUES($1::uuid,$2,'Isolated import test','noisia_internal','noisia_admin','active')`,
  [operatorId, `manual-${suffix}@example.test`]);
  process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE = "true";
  process.env.NOISIA_LOCAL_AUTH_EMAIL = `manual-${suffix}@example.test`;
  const { POST: createBrand } = await import("@/app/api/brands/route");
  const brandResponse = await createBrand(new Request("http://localhost/api/brands", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      organization_name: `Import test ${suffix}`, slug: `import-test-${suffix}`,
      name: `Import test ${suffix}`, display_name: `Import test ${suffix}`,
      industry: "Retail", countries: ["MX"], description: "Isolated test of new brand manual imports.",
      brand_seed_handles: [], competitors: ["Other test retailer"], timezone: "America/Mexico_City", status: "active"
    })
  }));
  assert.equal(brandResponse.status, 201);
  const brand = await brandResponse.json() as { data: { id: string }; signal_workspace: { id: string } };
  const actor = { id: operatorId, userType: "noisia_internal", organizationId: null };
  const workspace = await resolveSignalWorkspaceForUser(actor, { workspaceId: brand.signal_workspace.id });
  assert.ok(workspace);
  const context = { workspace, actor, access: "manual-import" as const };
  const initial = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
  assert.equal(initial.ready_for_import, false);
  assert.equal(initial.category_name_suggested, "Retail");
  const input = validateWorkspaceManualImportSetupInputV1({
    contract_version: WORKSPACE_MANUAL_IMPORT_SETUP_VERSION, provider: "sentione", source_name: "My exported conversations", category_name: "Retail",
    rights: { storage_and_analysis: true, external_ai_processing: false, retention_until: null }
  });
  const idempotencyKey = randomUUID();
  const prepared = await prepareWorkspaceManualImportInTransactionV1({ ...context, input, idempotencyKey });
  assert.equal(prepared.ready_for_import, true);
  assert.deepEqual(prepared.slots.map(slot => slot.scope).sort(), ["category", "competitor", "primary_brand"]);
  assert.equal(prepared.external_ai_processing, false);
  const replay = await prepareWorkspaceManualImportInTransactionV1({ ...context, input, idempotencyKey });
  assert.deepEqual(replay, prepared);
  await assert.rejects(prepareWorkspaceManualImportInTransactionV1({ ...context,
    input: { ...input, source_name: "Different request" }, idempotencyKey }), /Idempotency-Key/u);
  const queryCount = await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM signal_acquisition_query_versions WHERE workspace_id=$1::uuid", [workspace.id]);
  assert.equal(queryCount.rows[0]!.count, 0);
  const source = (await pool.query<{ id: string; governed_scope: string | null }>(
    "SELECT id::text,governed_scope FROM data_sources WHERE workspace_id=$1::uuid AND source_key=$2",
    [workspace.id, prepared.source_key])).rows[0]!;
  assert.equal(source.governed_scope, null);
  const sourceCountBefore = (await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM data_sources WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count;
  await assert.rejects(prepareWorkspaceManualImportInTransactionV1({ ...context,
    input: { ...input, category_name: "Different category" }, idempotencyKey: randomUUID() }), /category_identity_conflict/u);
  assert.equal((await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM data_sources WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count, sourceCountBefore);
  const viewerId = randomUUID();
  const adminId = randomUUID();
  const noGrantId = randomUUID();
  await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status) VALUES
    ($1::uuid,$2,'Client viewer','client','client_viewer',$3::uuid,'active'),
    ($4::uuid,$5,'Client admin','client','client_admin',$3::uuid,'active'),
    ($6::uuid,$7,'Client admin no grant','client','client_admin',$3::uuid,'active')`,
  [viewerId, `viewer-${suffix}@example.test`, workspace.organizationId, adminId, `admin-${suffix}@example.test`, noGrantId, `nogrant-${suffix}@example.test`]);
  await pool.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id) VALUES
    ($1::uuid,$2::uuid,'read',$3::uuid),($4::uuid,$2::uuid,'admin',$3::uuid)`, [viewerId, brand.data.id, operatorId, adminId]);
  for (const id of [viewerId, noGrantId]) {
    await assert.rejects(prepareWorkspaceManualImportInTransactionV1({ ...context,
      actor: { id, userType: "client", organizationId: workspace.organizationId }, input, idempotencyKey: randomUUID() }), /unauthorized/u);
  }
  const clientPrepared = await prepareWorkspaceManualImportInTransactionV1({ ...context,
    actor: { id: adminId, userType: "client", organizationId: workspace.organizationId },
    input: { ...input, source_name: "Second source", rights: { ...input.rights, external_ai_processing: true } }, idempotencyKey: randomUUID() });
  assert.notEqual(clientPrepared.source_key, prepared.source_key);
  const readAgain = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
  assert.deepEqual(readAgain.sources.map(item => item.external_ai_processing), [false, true]);
  const upload = await createWorkspaceImportUploadV1({ ...context, sourceId: source.id,
    fileName: "operator-file.csv", fileSizeBytes: 250, contentType: "text/csv", idempotencyKey: randomUUID(),
    contributedByStudyCorpusId: null, supersedesImportBatchId: null,
    acquisition: { sourceKey: prepared.source_key, slotKey: "primary-brand",
      queryEvidence: { class: "unavailable", queryVersion: null, reason: "provider_did_not_embed_query" },
      period: { start: "2026-08-01", end: "2026-08-31", timezone: workspace.timezone } },
    storage: { resolve: () => ({ bucket: "isolated-test" }), createSignedUploads: async () => ({
      bucket: "isolated-test", objectPrefix: "test", partSizeBytes: 250, expiresInSeconds: 60,
      parts: [{ partNumber: 1, expectedSizeBytes: 250, objectKey: "test.part-00001", uploadUrl: "http://localhost/isolated-test" }]
    }) }
  });
  assert.equal(upload.batch.phase, "uploading");
  const sealed = (await pool.query<{ acquisition_query_evidence_class: string; acquisition_query_version_id: string | null; mention_type: string | null }>(
    "SELECT acquisition_query_evidence_class,acquisition_query_version_id,mention_type FROM import_batches WHERE id=$1::uuid", [upload.batch.id])).rows[0]!;
  assert.equal(sealed.acquisition_query_evidence_class, "unavailable");
  assert.equal(sealed.acquisition_query_version_id, null);
  assert.equal(sealed.mention_type, null);
  assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int count FROM mentions WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count, 0);

  const priorStorageKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const withoutStorage = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
  assert.equal(withoutStorage.configured, true);
  assert.equal(withoutStorage.storage_ready, false);
  assert.equal(withoutStorage.ready_for_import, false);
  process.env.SUPABASE_SERVICE_ROLE_KEY = priorStorageKey;

  const { withSignalAcquisitionTransactionV1, reconcileSignalAcquisitionPlanDraftV1 } = await import("./signal-acquisition-plan");
  await withSignalAcquisitionTransactionV1(queryable => reconcileSignalAcquisitionPlanDraftV1({ ...context,
    queryable, expectedCurrentVersion: null, expectedBrandOsRevision: null, idempotencyKey: randomUUID() }));
  const beforeRejectedSetup = (await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM data_sources WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count;
  await assert.rejects(prepareWorkspaceManualImportInTransactionV1({ ...context, input: { ...input, source_name: "Not persisted" },
    idempotencyKey: randomUUID() }), /existing_acquisition_draft_requires_resolution/u);
  assert.equal((await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM data_sources WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count, beforeRejectedSetup);
  const withDraft = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
  assert.equal(withDraft.ready_for_import, true);
  assert.equal(withDraft.needs_plan_update, false);
  assert.deepEqual(withDraft.slots, prepared.slots);
  await pool.end();
});
