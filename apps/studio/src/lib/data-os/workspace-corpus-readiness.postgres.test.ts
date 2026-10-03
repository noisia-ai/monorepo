import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

test("corpus readiness counts accepted canonical evidence once and partitions rights and semantic eligibility", {
  skip: process.env.NOISIA_NATIONAL_IMPORT_TEST_APPROVED !== "true", timeout: 120_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const { pool } = await import("@/lib/db");
  const { createSignalSentioneCsvIngester, SENTIONE_CSV_47_HEADERS_V1, loadSignalWorkspaceCorpusReadinessStoreV1: read } = await import("@noisia/db");
  const { prepareWorkspaceManualImportInTransactionV1 } = await import("./workspace-manual-import-setup");
  const { createWorkspaceImportUploadV1 } = await import("./workspace-async-import");
  const { resolveSignalWorkspaceForUser } = await import("./signal-workspace");
  const { ensureSignalRetentionPolicyDraftV1, ensureSignalProvenancePolicyBindingDraftV1,
    activateSignalDataGovernanceObjectV1 } = await import("./signal-data-governance");
  const suffix = randomUUID().slice(0, 8), actorId = randomUUID();
  const hash = () => `sha256:${createHash("sha256").update(randomUUID()).digest("hex")}`;
  try {
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
      VALUES($1::uuid,$2,'Corpus readiness fixture','noisia_internal','noisia_admin','active')`, [actorId, `readiness-${suffix}@example.test`]);
    process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE = "true";
    process.env.NOISIA_LOCAL_AUTH_EMAIL = `readiness-${suffix}@example.test`;
    const { POST: createBrand } = await import("@/app/api/brands/route");
    const actor = { id: actorId, userType: "noisia_internal", organizationId: null };
    const createFixture = async (label: string) => {
      const response = await createBrand(new Request("http://localhost/api/brands", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          organization_name: `Corpus readiness ${suffix} ${label}`, slug: `readiness-${suffix}-${label}`,
          name: `Corpus readiness ${suffix} ${label}`, display_name: `Corpus readiness ${suffix} ${label}`,
          industry: "Retail", countries: ["MX"], description: "Isolated corpus readiness fixture.",
          brand_seed_handles: [], competitors: [], timezone: "UTC", status: "active"
        })
      }));
      assert.equal(response.status, 201);
      const created = await response.json() as { signal_workspace: { id: string } };
      const workspace = await resolveSignalWorkspaceForUser(actor, { workspaceId: created.signal_workspace.id });
      assert.ok(workspace);
      return { workspace, actor, access: "manual-import" as const };
    };
    const fixture = await createFixture("main"), other = await createFixture("other");
    const source = async (context: typeof fixture, name: string) => {
      const setup = await prepareWorkspaceManualImportInTransactionV1({ ...context, idempotencyKey: randomUUID(), input: {
        contract_version: "signal-workspace-manual-import-setup-v1", provider: "sentione", source_name: name,
        category_name: "Retail", rights: { storage_and_analysis: true, external_ai_processing: true, retention_until: null }
      } });
      const id = (await pool.query<{ id: string }>("SELECT id::text FROM data_sources WHERE workspace_id=$1::uuid AND source_key=$2",
        [context.workspace.id, setup.source_key])).rows[0]!.id;
      return { id, key: setup.source_key };
    };
    const first = await source(fixture, "First source"), second = await source(fixture, "Second source"), foreign = await source(other, "Foreign source");
    const readMain = (queryable = pool) => read({ queryable, workspace_id: fixture.workspace.id });
    const empty = await readMain();
    assert.equal(empty.state, "awaiting_import");
    assert.equal(empty.accepted_files, 0);
    const row = (id: string, content: string): Record<string, string> => ({ id: `${suffix}-${id}`,
      Created: "2026-08-01T12:00:00Z", "Added to system": "2026-08-01T12:01:00Z",
      "Content of posts": content, Language: "en", Country: "MX" });
    const shared = row("shared", "This shared canonical fixture has enough source text for inclusion."),
      excluded = row("excluded", "Tiny");
    const ingest = async (context: typeof fixture, connector: typeof first, rows: Record<string, string>[], complete = true) => {
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const bytes = new TextEncoder().encode(`${SENTIONE_CSV_47_HEADERS_V1.join(";")}\n${rows.map(item =>
        SENTIONE_CSV_47_HEADERS_V1.map(key => quote(item[key] ?? "")).join(";")).join("\n")}\n`);
      const upload = await createWorkspaceImportUploadV1({ ...context, sourceId: connector.id, fileName: "readiness.csv",
        fileSizeBytes: bytes.length, contentType: "text/csv", contributedByStudyCorpusId: null, supersedesImportBatchId: null,
        idempotencyKey: randomUUID(), acquisition: { sourceKey: connector.key, slotKey: "primary-brand",
          queryEvidence: { class: "unavailable", queryVersion: null, reason: "provider_did_not_embed_query" },
          period: { start: "2026-08-01", end: "2026-08-31", timezone: "UTC" } },
        storage: { resolve: () => ({ bucket: "isolated-test" }), createSignedUploads: async () => ({
          bucket: "isolated-test", objectPrefix: "test", partSizeBytes: bytes.length, expiresInSeconds: 60,
          parts: [{ partNumber: 1, expectedSizeBytes: bytes.length, objectKey: "test.part-00001", uploadUrl: "http://localhost/fixture" }]
        }) }
      });
      const id = upload.batch.id;
      const job = (await pool.query<{ worker_job_id: string }>("SELECT worker_job_id FROM enqueue_signal_workspace_import_v1($1::uuid,$2::uuid)", [id, actorId])).rows[0]!.worker_job_id;
      await pool.query("SELECT begin_signal_workspace_import_processing_v1($1::uuid,$2)", [id, job]);
      const result = await createSignalSentioneCsvIngester(pool).ingestSentioneCsvStream({ workspaceId: context.workspace.id,
        dataSourceId: connector.id, importBatchId: id, sourceFileName: "readiness.csv", sourceTimezone: "UTC",
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });
      if (complete) await pool.query("SELECT complete_signal_workspace_import_v1($1::uuid,$2,$3,$4,$5,$6,$7,$8)",
        [id, job, result.fileHash, result.stats.record_count, result.stats.included_count, result.stats.excluded_count, result.stats.duplicate_count, bytes.length]);
      else await pool.query("SELECT fail_signal_workspace_import_v1($1::uuid,$2,'processing_failed','{}'::jsonb,$3,$4)",
        [id, job, result.stats.record_count, bytes.length]);
      return { id, ...result };
    };
    const accepted = await ingest(fixture, first, [shared, excluded, shared]);
    assert.deepEqual(accepted.stats, { record_count: 3, included_count: 1, excluded_count: 1, duplicate_count: 1 });
    const overlap = await ingest(fixture, second, [shared]);
    assert.equal(overlap.stats.duplicate_count, 1);
    const partial = await ingest(fixture, first, [row("partial", "This failed fixture persisted a partial root before its import was rejected.")], false);
    await ingest(other, foreign, [row("foreign", "This accepted foreign workspace record must never enter the main summary.")]);
    assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int count FROM mentions WHERE source_file_id=$1::uuid", [partial.id])).rows[0]!.count, 1);
    const current = await readMain();
    assert.match(current.observed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u,
      "the SQL snapshot timestamp is UTC ISO with exactly six fractional digits");
    assert.deepEqual(current, {
      contract_version: "signal-workspace-corpus-readiness-v1", workspace_id: fixture.workspace.id, state: "received",
      observed_at: current.observed_at,
      accepted_files: 2, records_read: 4, dispositions: { included: 1, excluded: 1, duplicates: 2 },
      projection: { observations: 3, linked_roots: 2, included_roots: 1, excluded_roots: 1, roots_with_text: 2 },
      eligibility: { rights_eligible_roots: 1, rights_blocked_roots: 0, semantic_eligible_roots: 0, semantic_pending_roots: 1 },
      reconciliation_errors: []
    });
    assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int count FROM study_corpora WHERE brand_id=$1::uuid", [fixture.workspace.subject.id])).rows[0]!.count, 0);
    assert.ok((await pool.query<{ count: number }>("SELECT count(*)::int count FROM signal_mention_attributions WHERE workspace_id=$1::uuid AND attribution_basis='source_intent'", [fixture.workspace.id])).rows[0]!.count > 0);
    assert.equal((await read({ queryable: pool, workspace_id: other.workspace.id })).records_read, 1);
    assert.equal((await read({ queryable: pool, workspace_id: randomUUID() })).records_read, 0);

    const rootId = (await pool.query<{ id: string }>("SELECT id::text FROM mentions WHERE source_file_id=$1::uuid AND inclusion_status='included'", [accepted.id])).rows[0]!.id;
    const assertion = (await pool.query<{ id: string }>(`SELECT create_signal_mention_semantic_assertion(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'primary_brand','brand',$5::uuid,'Fixture brand',0.95,
      'human_reviewed_context',$6,'readiness-fixture','1',NULL,$7)::text id`,
    [fixture.workspace.id, rootId, first.id, accepted.id, fixture.workspace.subject.id, hash(), hash()])).rows[0]!.id;
    assert.equal((await readMain()).eligibility.semantic_eligible_roots, 0, "pending assertion is not approved semantics");
    await pool.query("SELECT review_signal_mention_semantic_assertion($1::uuid,$2::uuid,'approve','fixture','readiness-fixture','1',$3,$4)",
      [assertion, actorId, hash(), hash()]);
    assert.deepEqual((await readMain()).eligibility, { rights_eligible_roots: 1, rights_blocked_roots: 0,
      semantic_eligible_roots: 1, semantic_pending_roots: 0 });

    const client = await pool.connect();
    const reader = () => read({ queryable: client, workspace_id: fixture.workspace.id });
    try {
      await client.query("BEGIN");
      await client.query("UPDATE signal_licensing_policies SET status='retired',effective_to=clock_timestamp() WHERE id IN (SELECT licensing_policy_id FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid)", [fixture.workspace.id, first.id]);
      assert.deepEqual((await reader()).eligibility, { rights_eligible_roots: 1, rights_blocked_roots: 0,
        semantic_eligible_roots: 0, semantic_pending_roots: 1 }, "rights on the second source cannot authorize an assertion linked to the revoked first source");
      await client.query("UPDATE signal_licensing_policies SET status='retired',effective_to=clock_timestamp() WHERE id IN (SELECT licensing_policy_id FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid)", [fixture.workspace.id, second.id]);
      const revoked = await reader();
      assert.equal(revoked.state, "received");
      assert.deepEqual(revoked.eligibility, { rights_eligible_roots: 0, rights_blocked_roots: 1, semantic_eligible_roots: 0, semantic_pending_roots: 0 });
      assert.equal(revoked.records_read, current.records_read, "rights revocation does not erase import accounting");
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      const basePolicy = (await client.query<{ quality_policy_id: string; licensing_policy_id: string }>(
        "SELECT quality_policy_id::text,licensing_policy_id::text FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid AND data_source_id=$2::uuid AND status='active'", [fixture.workspace.id, first.id])).rows[0]!;
      const policyContext = { queryable: client, organizationId: fixture.workspace.organizationId, actor, access: "manual-import" as const };
      // The reader uses transaction time. Keep fixture effective_from before this
      // rollback-only transaction so the new binding is effective during the read.
      const expired = await ensureSignalRetentionPolicyDraftV1({ ...policyContext, idempotencyKey: hash(), effectiveFrom: "2019-01-01T00:00:00Z", definition: {
        workspace_id: fixture.workspace.id, policy_key: "readiness-expired", policy_version: 1,
        retention_state: "allowed", retention_mode: "until", retain_until: "2020-01-01T00:00:00Z",
        expiry_action: "block_use", approval_evidence_hash: hash()
      } });
      await activateSignalDataGovernanceObjectV1({ ...policyContext, workspaceId: fixture.workspace.id,
        objectKind: "retention-policy", objectId: expired.policy_id, idempotencyKey: hash() });
      const binding = await ensureSignalProvenancePolicyBindingDraftV1({ ...policyContext, idempotencyKey: hash(), effectiveFrom: "2019-01-01T00:00:00Z", definition: {
        workspace_id: fixture.workspace.id, data_source_id: first.id, import_batch_id: accepted.id, binding_version: 2,
        quality_policy_id: basePolicy.quality_policy_id, retention_policy_id: expired.policy_id, licensing_policy_id: basePolicy.licensing_policy_id
      } });
      await activateSignalDataGovernanceObjectV1({ ...policyContext, workspaceId: fixture.workspace.id,
        objectKind: "provenance-binding", objectId: binding.binding_id, idempotencyKey: hash() });
      await client.query("UPDATE data_sources SET status='inactive' WHERE id=$1::uuid", [second.id]);
      const expiredRead = await reader();
      assert.equal(expiredRead.eligibility.rights_eligible_roots, 0, "expired import-specific retention overrides source-wide permission");
      assert.equal(expiredRead.eligibility.rights_blocked_roots, 1);
      assert.equal(expiredRead.state, "received");
      await client.query("ROLLBACK");
      await client.query("BEGIN READ ONLY");
      assert.equal((await reader()).eligibility.semantic_eligible_roots, 1, "the reader executes inside a read-only transaction");
    } finally { await client.query("ROLLBACK"); client.release(); }
    assert.deepEqual((await readMain()).eligibility, { rights_eligible_roots: 1, rights_blocked_roots: 0,
      semantic_eligible_roots: 1, semantic_pending_roots: 0 }, "fixture-only lifecycle mutations were rolled back");
  } finally { await pool.end(); }
});
