import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exact-file replay closes without losing accepted rows; workspace history pages all sources and counts acceptance once", {
  skip: process.env.NOISIA_NATIONAL_IMPORT_TEST_APPROVED !== "true", timeout: 120_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const { pool } = await import("@/lib/db");
  const { prepareWorkspaceManualImportInTransactionV1, loadWorkspaceManualImportSetupV1 } = await import("./workspace-manual-import-setup");
  const { createWorkspaceImportUploadV1, loadWorkspaceImportV1, retryWorkspaceImportFromStorageV1 } = await import("./workspace-async-import");
  const { loadWorkspaceAcquisitionImportHistoryV1, parseWorkspaceImportHistoryPageV1 } = await import("./workspace-import-history");
  const { resolveSignalWorkspaceForUser } = await import("./signal-workspace");
  const { createSignalSentioneCsvIngester, loadSignalTopicCatalogStoreV1 } = await import("@noisia/db");
  const actorId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  try {
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
      VALUES($1::uuid,$2,'Import regression','noisia_internal','noisia_admin','active')`, [actorId, `replay-${suffix}@example.test`]);
    process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE = "true";
    process.env.NOISIA_LOCAL_AUTH_EMAIL = `replay-${suffix}@example.test`;
    const { POST: createBrand } = await import("@/app/api/brands/route");
    const response = await createBrand(new Request("http://localhost/api/brands", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        organization_name: `Replay fixture ${suffix}`, slug: `replay-fixture-${suffix}`,
        name: `Replay fixture ${suffix}`, display_name: `Replay fixture ${suffix}`, industry: "Retail",
        countries: ["MX"], description: "Isolated regression fixture.", brand_seed_handles: [],
        competitors: ["Fixture competitor"], timezone: "America/Mexico_City", status: "active"
      })
    }));
    assert.equal(response.status, 201);
    const created = await response.json() as { signal_workspace: { id: string } };
    const actor = { id: actorId, userType: "noisia_internal", organizationId: null };
    const workspace = await resolveSignalWorkspaceForUser(actor, { workspaceId: created.signal_workspace.id });
    assert.ok(workspace);
    const context = { workspace, actor, access: "manual-import" as const };
    const input = { contract_version: "signal-workspace-manual-import-setup-v1" as const, provider: "sentione" as const,
      source_name: "First fixture source", category_name: "Retail",
      rights: { storage_and_analysis: true as const, external_ai_processing: false, retention_until: null } };
    const setup = await prepareWorkspaceManualImportInTransactionV1({ ...context, input, idempotencyKey: randomUUID() });
    const other = await prepareWorkspaceManualImportInTransactionV1({ ...context,
      input: { ...input, source_name: "Second fixture source" }, idempotencyKey: randomUUID() });
    const sourceId = async (key: string) => (await pool.query<{ id: string }>(
      "SELECT id::text FROM data_sources WHERE workspace_id=$1::uuid AND source_key=$2", [workspace.id, key])).rows[0]!.id;
    const firstSource = await sourceId(setup.source_key);
    const secondSource = await sourceId(other.source_key);
    const csv = `id,text,date,platform,language,country\nfixture-${suffix},This isolated fixture contains enough text to be included.,2026-08-01,web,es,MX\nfixture-${suffix},This isolated fixture contains enough text to be included.,2026-08-01,web,es,MX\n`;
    const bytes = new TextEncoder().encode(csv);
    const upload = (key: string, id: string,
      uploadActor: Parameters<typeof createWorkspaceImportUploadV1>[0]["actor"] = actor
    ) => createWorkspaceImportUploadV1({ ...context, actor: uploadActor, sourceId: id,
      fileName: "repeated-fixture.csv", fileSizeBytes: bytes.length, contentType: "text/csv", idempotencyKey: randomUUID(),
      contributedByStudyCorpusId: null, supersedesImportBatchId: null,
      acquisition: { sourceKey: key, slotKey: "primary-brand",
        queryEvidence: { class: "unavailable", queryVersion: null, reason: "provider_did_not_embed_query" },
        period: { start: "2026-08-01", end: "2026-08-31", timezone: workspace.timezone } },
      storage: { resolve: () => ({ bucket: "isolated-test" }), createSignedUploads: async () => ({
        bucket: "isolated-test", objectPrefix: "test", partSizeBytes: bytes.length, expiresInSeconds: 60,
        parts: [{ partNumber: 1, expectedSizeBytes: bytes.length, objectKey: "test.part-00001", uploadUrl: "http://localhost/fixture" }]
      }) }
    });
    const ingest = async (batchId: string) => {
      const job = (await pool.query<{ worker_job_id: string }>(
        "SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)", [batchId, actorId])).rows[0]!.worker_job_id;
      const replay = (await pool.query<{ worker_job_id: string; created: boolean }>(
        "SELECT * FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)", [batchId, actorId])).rows[0]!;
      assert.equal(replay.worker_job_id, job);
      assert.equal(replay.created, false);
      assert.equal((await pool.query<{ count: number }>(
        "SELECT count(*)::int count FROM signal_workspace_import_outbox WHERE import_batch_id=$1::uuid", [batchId])).rows[0]!.count, 1);
      await pool.query("SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)", [batchId, job]);
      const result = await createSignalSentioneCsvIngester(pool).ingestSentioneCsvStream({
        workspaceId: workspace.id, dataSourceId: firstSource, importBatchId: batchId, sourceFileName: "repeated-fixture.csv",
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } })
      });
      return { job, ...result };
    };
    const complete = (id: string, result: Awaited<ReturnType<typeof ingest>>) => pool.query(
      "SELECT * FROM complete_signal_workspace_import_v1($1::uuid,$2,$3,$4,$5,$6,$7,$8)",
      [id, result.job, result.fileHash, result.stats.record_count, result.stats.included_count,
        result.stats.excluded_count, result.stats.duplicate_count, bytes.length]);
    const first = await upload(setup.source_key, firstSource);
    const firstResult = await ingest(first.batch.id);
    assert.deepEqual(firstResult.stats, { record_count: 2, included_count: 1, excluded_count: 0, duplicate_count: 1 });
    assert.equal((await complete(first.batch.id, firstResult)).rows[0].accepted, true);
    const catalog = await loadSignalTopicCatalogStoreV1({ queryable: pool, workspace_id: workspace.id });
    assert.equal(catalog.readiness.state, "needs_preparation");
    assert.equal(catalog.readiness.canonical_mentions, 0);
    const second = await upload(setup.source_key, firstSource);
    const secondResult = await ingest(second.batch.id);
    assert.equal(secondResult.stats.duplicate_count, 2);
    const oldSql = await readFile(new URL("../../../../../infrastructure/db/migrations/0081_signal_workspace_import_recovery_integrity.sql", import.meta.url), "utf8");
    const oldFunction = oldSql.slice(oldSql.indexOf("CREATE OR REPLACE FUNCTION complete_signal_workspace_import_v1("));
    await pool.query(oldFunction.slice(0, oldFunction.indexOf("END; $$;") + "END; $$;".length));
    await assert.rejects(complete(second.batch.id, secondResult), (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "42702"));
    await pool.query(await readFile(new URL("../../../../../infrastructure/db/migrations/0131_signal_workspace_import_duplicate_completion.sql", import.meta.url), "utf8"));
    const duplicate = (await complete(second.batch.id, secondResult)).rows[0];
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.accepted_batch_id, first.batch.id);
    assert.equal((await complete(first.batch.id, firstResult)).rows[0].accepted, true);
    const duplicatePublic = await loadWorkspaceImportV1({ workspaceId: workspace.id, sourceId: firstSource, importBatchId: second.batch.id });
    assert.equal(duplicatePublic?.failure?.code, "content_already_accepted");
    assert.equal(duplicatePublic?.duplicate_of_import_id, first.batch.id);
    assert.equal(duplicatePublic?.recovery.recoverable_from_storage, false);
    await assert.rejects(retryWorkspaceImportFromStorageV1({ ...context, sourceId: firstSource,
      importBatchId: second.batch.id, idempotencyKey: randomUUID() }), /storage_recovery_unavailable/u);
    assert.equal((await pool.query<{ count: number }>(
      "SELECT count(*)::int count FROM mentions WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count, 1);
    const pending = await upload(other.source_key, secondSource);
    const historyArgs = { workspaceId: workspace.id, sourceId: null, slotKey: null, limit: 1, cursor: null as string | null };
    const page = await loadWorkspaceAcquisitionImportHistoryV1(historyArgs);
    assert.equal(page.imports.length, 1);
    assert.equal(page.imports[0]!.id, pending.batch.id);
    assert.equal(page.imports[0]!.source_key, other.source_key);
    assert.deepEqual({ ...page.summary.totals, last_import_at: null }, {
      attempt_count: 3, completed_count: 1, failed_count: 0, already_imported_count: 1,
      uploading_count: 1, processing_count: 0, records: 2, included: 1, excluded: 0, duplicates: 1, last_import_at: null
    });
    const ids: string[] = [page.imports[0]!.id];
    let cursor = page.next_cursor;
    while (cursor) {
      const next = await loadWorkspaceAcquisitionImportHistoryV1({ ...historyArgs, cursor });
      ids.push(...next.imports.map(row => row.id)); cursor = next.next_cursor;
    }
    assert.deepEqual(ids, [pending.batch.id, second.batch.id, first.batch.id]);
    assert.equal((await loadWorkspaceAcquisitionImportHistoryV1({ ...historyArgs, sourceId: firstSource, limit: 50 })).imports.length, 2);
    assert.equal((await loadWorkspaceAcquisitionImportHistoryV1({ ...historyArgs, slotKey: "missing" })).summary.totals.attempt_count, 0);
    await assert.rejects(loadWorkspaceAcquisitionImportHistoryV1({ ...historyArgs, workspaceId: randomUUID(), cursor: first.batch.id }), /invalid_history_page/u);
    await assert.rejects(loadWorkspaceAcquisitionImportHistoryV1({ ...historyArgs, sourceId: secondSource, cursor: first.batch.id }), /invalid_history_page/u);
    for (const query of ["limit=0", "limit=101", "limit=NaN", "cursor=bad"]) {
      assert.throws(() => parseWorkspaceImportHistoryPageV1(new URLSearchParams(query)), /invalid_history_page/u);
    }
    // Merely opening an unmodified draft must not hide current capture slots or revoke source rights.
    const { withSignalAcquisitionTransactionV1, reconcileSignalAcquisitionPlanDraftV1 } = await import("./signal-acquisition-plan");
    await withSignalAcquisitionTransactionV1(queryable => reconcileSignalAcquisitionPlanDraftV1({ ...context,
      queryable, expectedCurrentVersion: null, expectedBrandOsRevision: null, idempotencyKey: randomUUID() }));
    process.env.NOISIA_DATA_OS_SERVING_ENABLED = "true";
    process.env.NOISIA_SIGNAL_WORKSPACE_API_ENABLED = "true";
    const { GET: historyRoute } = await import("@/app/api/data-os/signal/[workspaceId]/acquisition-plan/imports/route");
    const routeContext = { params: Promise.resolve({ workspaceId: workspace.id }) };
    const readHistory = async (query: string) => {
      const response = await historyRoute(new Request(`http://localhost/api/imports?${query}`), routeContext);
      assert.ok(response);
      return response;
    };
    assert.equal((await readHistory("limit=1")).status, 200);
    assert.equal((await readHistory("source_key=missing")).status, 404);
    const viewerId = randomUUID();
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
      VALUES($1::uuid,$2,'Fixture viewer','client','client_viewer',$3::uuid,'active')`,
      [viewerId, `viewer-${suffix}@example.test`, workspace.organizationId]);
    await pool.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id)
      VALUES($1::uuid,$2::uuid,'read',$3::uuid)`, [viewerId, workspace.subject.id, actorId]);
    process.env.NOISIA_LOCAL_AUTH_EMAIL = `viewer-${suffix}@example.test`;
    assert.equal((await readHistory("limit=1")).status, 403);
    process.env.NOISIA_LOCAL_AUTH_EMAIL = `replay-${suffix}@example.test`;
    const withDraft = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
    assert.equal(withDraft.configured, true);
    assert.equal(withDraft.needs_plan_update, false);
    assert.deepEqual(withDraft.slots, setup.slots);
    assert.equal(withDraft.sources.length, 2);
    const draftUpload = await upload(setup.source_key, firstSource);
    assert.equal(draftUpload.batch.phase, "uploading");
    await assert.rejects(upload(setup.source_key, firstSource, {
      id: viewerId, userType: "client", organizationId: workspace.organizationId
    }), /unauthorized/u);
    const { POST: addCompetitor } = await import("@/app/api/brands/[id]/competitors/route");
    const addedCompetitor = await addCompetitor(new Request("http://localhost/api/competitors", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ competitors: ["New fixture competitor"] })
    }), { params: Promise.resolve({ id: workspace.subject.id }) });
    assert.equal(addedCompetitor.status, 201);
    const stale = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
    assert.equal(stale.configured, false);
    assert.equal(stale.needs_plan_update, true);
    assert.deepEqual(stale.sources, withDraft.sources);
    assert.deepEqual(stale.slots, withDraft.slots);
    await assert.rejects(upload(setup.source_key, firstSource), /acquisition_plan_stale/u);
    assert.equal((await readHistory("limit=50")).status, 200);
    const { GET: getPlan, POST: reconcilePlan } = await import("@/app/api/data-os/signal/[workspaceId]/acquisition-plan/route");
    const planResponse = await getPlan(new Request("http://localhost/api/acquisition-plan"), routeContext);
    assert.ok(planResponse);
    assert.equal(planResponse.status, 200);
    type PlanSnapshot = Awaited<ReturnType<typeof reconcileSignalAcquisitionPlanDraftV1>> & { live_brand_os_revision: number };
    const stalePlan = await planResponse.json() as PlanSnapshot;
    assert.equal(stalePlan.state, "draft");
    assert.equal(stalePlan.current_slots.length, setup.slots.length);
    assert.ok(stalePlan.current_slots.every(slot => slot.plan_status === "current"));
    assert.ok(stalePlan.slots.every(slot => slot.plan_status === "draft"));
    const reconcileRequest = async (revision: number) => {
      const response = await reconcilePlan(new Request("http://localhost/api/acquisition-plan", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ expected_current_version: stalePlan.current_plan!.version, expected_brand_os_revision: revision })
      }), routeContext);
      assert.ok(response);
      return response;
    };
    // The previous UI sent the draft snapshot version while state was draft, so the CAS guard correctly rejected it.
    const obsoleteRevision = stalePlan.draft_plan!.brand_os_revision;
    assert.equal((await reconcileRequest(obsoleteRevision)).status, 409);
    // The current UI uses the live Brand OS version returned alongside the historical plan snapshots.
    const reconciledResponse = await reconcileRequest(stalePlan.live_brand_os_revision);
    assert.equal(reconciledResponse.status, 200);
    assert.ok(stalePlan.live_brand_os_revision > obsoleteRevision);
    const updatedDraft = await reconciledResponse.json() as PlanSnapshot;
    assert.equal(updatedDraft.readiness.ready_to_promote, true);
    const draft = updatedDraft.draft_plan!;
    const { promoteSignalAcquisitionPlanV1 } = await import("./signal-acquisition-plan");
    await withSignalAcquisitionTransactionV1(queryable => promoteSignalAcquisitionPlanV1({ ...context, queryable,
      idempotencyKey: randomUUID(), expectedDraftVersion: draft.version, expectedDraftRevision: draft.draft_revision,
      expectedDraftDigest: draft.draft_digest, effectiveFrom: new Date().toISOString(),
      evidence: "Explicit local fixture review of the new competitor capture slot." }));
    const refreshed = await loadWorkspaceManualImportSetupV1({ ...context, queryable: pool });
    assert.equal(refreshed.configured, true);
    assert.equal(refreshed.slots.length, setup.slots.length + 1);
    assert.deepEqual(refreshed.sources, withDraft.sources);
  } finally { await pool.end(); }
});
