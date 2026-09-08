import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("legacy timestamp context and errors are durable; valid rows still meet the existing legacy provenance blocker", {
  skip: process.env.NOISIA_NATIONAL_IMPORT_TEST_APPROVED !== "true", timeout: 60_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const { pool } = await import("@/lib/db");
  const { createWorkspaceDataSource, ingestWorkspaceDataSourceCsv, ingestWorkspaceDataSourceCsvProductV1 } = await import("./workspace-ingestion");
  const { resolveSignalWorkspaceForUser } = await import("./signal-workspace");
  const suffix = randomUUID().slice(0, 8);
  const actorId = randomUUID(), orgId = randomUUID(), brandId = randomUUID(), corpusId = randomUUID(), methodologyId = randomUUID();
  const previousUploadDir = process.env.NOISIA_CSV_UPLOAD_DIR;
  delete process.env.NOISIA_CSV_UPLOAD_DIR;
  try {
    await pool.query(`INSERT INTO organizations(id,slug,legal_name,display_name,status)
      VALUES($1::uuid,$2,'Timezone fixture','Timezone fixture','active')`, [orgId, `timezone-${suffix}`]);
    await pool.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status)
      VALUES($1::uuid,$2,'Timezone fixture','noisia_internal','noisia_admin','active')`, [actorId, `timezone-${suffix}@example.test`]);
    await pool.query(`INSERT INTO brands(id,organization_id,slug,name,display_name,status)
      VALUES($1::uuid,$2::uuid,$3,'Timezone fixture','Timezone fixture','active')`, [brandId, orgId, `timezone-${suffix}`]);
    await pool.query(`INSERT INTO methodologies(id,slug,name,version,status,manifest_yaml)
      VALUES($1::uuid,$2,'Isolated fixture','1','active','{}'::jsonb)`, [methodologyId, `timezone-${suffix}`]);
    await pool.query(`INSERT INTO study_corpora(id,name,brand_id,methodology_id,methodology_version_at_creation,status)
      VALUES($1::uuid,'Timezone fixture',$2::uuid,$3::uuid,'1','draft')`, [corpusId, brandId, methodologyId]);
    const workspaceId = (await pool.query<{ id: string }>("SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid", [brandId])).rows[0]!.id;
    const workspace = await resolveSignalWorkspaceForUser({ id: actorId, userType: "noisia_internal", organizationId: null }, { workspaceId });
    assert.ok(workspace);
    const source = await createWorkspaceDataSource({ workspace, userId: actorId,
      input: { name: "Legacy source", provider: "listening_csv", source_type: "social-listening", connection_method: "csv",
        scope: "primary_brand", entity_id: brandId } });
    const csv = (id: string, date = "2026-08-01 23:30:00") =>
      `id,text,date,platform,language,country\n${suffix}-${id},This isolated timezone fixture ${id} contains enough text for inclusion.,${date},web,en,MX\n`;
    const stream = (text: string) => new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(text)); controller.close();
    } });
    const base = { workspace, sourceId: source.id, userId: actorId, contributedByStudyCorpusId: null };
    const count = async () => (await pool.query<{ count: number }>(
      "SELECT count(*)::int count FROM import_batches WHERE workspace_id=$1::uuid", [workspace.id])).rows[0]!.count;
    const batch = async (id: string) => (await pool.query<{
      status: string; capture_timezone: string | null; processing_metrics: Record<string, unknown>;
      failure_code: string | null; failure_detail: Record<string, unknown> | null;
    }>("SELECT status,capture_timezone,processing_metrics,failure_code,failure_detail FROM import_batches WHERE id=$1::uuid", [id])).rows[0]!;
    const batchForFile = async (fileName: string) => (await pool.query<{ id: string }>(
      "SELECT id::text FROM import_batches WHERE workspace_id=$1::uuid AND source_file_name=$2", [workspace.id, fileName])).rows[0]!.id;
    // This pre-existing 0081 constraint rejects ingestion_phase='legacy'. Keep the
    // observed boundary explicit: these tests do not claim successful legacy imports.
    const provenanceBlocker = (error: unknown) => error instanceof Error &&
      error.message === "Workspace import provenance target is unavailable." && "code" in error && error.code === "23514";
    const declared = { source_timestamp_context: {
      contract_version: "source-timestamp-context-v1", origin: "operator_declared", timezone: "America/Mexico_City"
    } };
    const text = csv("workspace");
    const key = randomUUID();
    await assert.rejects(ingestWorkspaceDataSourceCsvProductV1({ ...base, fileName: "workspace.csv", stream: stream(text),
      sourceTimezone: " America/Mexico_City ", idempotencyKey: key }), provenanceBlocker);
    const parsedBatchId = await batchForFile("workspace.csv");
    assert.equal((await batch(parsedBatchId)).capture_timezone, null);
    assert.deepEqual((await batch(parsedBatchId)).processing_metrics, declared);
    assert.equal((await batch(parsedBatchId)).status, "failed");
    const instant = (await pool.query<{ published_at: Date }>(
      "SELECT published_at FROM mentions WHERE source_file_id=$1::uuid", [parsedBatchId])).rows[0]!.published_at;
    assert.equal(instant.toISOString(), "2026-08-02T05:30:00.000Z");
    await assert.rejects(ingestWorkspaceDataSourceCsvProductV1({ ...base, fileName: "workspace.csv", stream: stream(text),
      sourceTimezone: "America/Mexico_City", idempotencyKey: key }), /Previous import attempt is incomplete/u);
    await assert.rejects(ingestWorkspaceDataSourceCsvProductV1({ ...base, fileName: "workspace.csv", stream: stream(text),
      sourceTimezone: "UTC", idempotencyKey: key }), /incompatible import input/u);
    const beforeInvalid = await count();
    await assert.rejects(ingestWorkspaceDataSourceCsv({ ...base, fileName: "invalid.csv", stream: stream(csv("invalid")),
      sourceTimezone: "invalid/not-a-zone" }), /source_timezone_invalid/u);
    assert.equal(await count(), beforeInvalid, "invalid timezone must reject before creating an import");
    await assert.rejects(ingestWorkspaceDataSourceCsv({ ...base, fileName: "naive.csv", stream: stream(csv("naive")) }), /source_timezone_required/u);
    const missing = (await pool.query<{ id: string }>(
      "SELECT id::text FROM import_batches WHERE workspace_id=$1::uuid AND source_file_name='naive.csv'", [workspace.id])).rows[0]!.id;
    assert.equal((await batch(missing)).failure_code, "source_timezone_required");
    assert.equal((await batch(missing)).failure_detail?.parameter, "source_timezone");
    await assert.rejects(ingestWorkspaceDataSourceCsv({ ...base, fileName: "offset.csv", stream: stream(csv("offset", "2026-08-01T23:30:00Z")) }), provenanceBlocker);
    assert.deepEqual((await batch(await batchForFile("offset.csv"))).processing_metrics, {});

    process.env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE = "true";
    process.env.NOISIA_LOCAL_AUTH_EMAIL = `timezone-${suffix}@example.test`;
    const { POST } = await import("@/app/api/corpora/[id]/mentions/csv-upload/route");
    const upload = (id: string, sourceTimezone?: string, date?: string) => {
      const requestUrl = new URL(`http://localhost/api/corpora/${corpusId}/mentions/csv-upload`);
      requestUrl.searchParams.set("file_name", `${id}.csv`);
      if (sourceTimezone !== undefined) requestUrl.searchParams.set("source_timezone", sourceTimezone);
      return POST(new Request(requestUrl, { method: "POST", body: csv(id, date), headers: { "Content-Type": "text/csv" } }),
        { params: Promise.resolve({ id: corpusId }) });
    };
    const beforeRouteInvalid = await count();
    const invalid = await upload("route-invalid", "invalid/not-a-zone");
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).error, "source_timezone_invalid");
    assert.equal(await count(), beforeRouteInvalid);
    const naive = await upload("route-naive");
    assert.equal(naive.status, 422);
    const error = await naive.json() as { error: string; import_batch_id: string; details: { parameter: string } };
    assert.equal(error.error, "source_timezone_required");
    assert.equal(error.details.parameter, "source_timezone");
    assert.equal((await batch(error.import_batch_id)).failure_code, "source_timezone_required");
    const valid = await upload("route-valid", "America/Mexico_City");
    assert.equal(valid.status, 500);
    assert.equal((await valid.json()).message, "Workspace import provenance target is unavailable.");
    const routeBatchId = await batchForFile("route-valid.csv");
    assert.deepEqual((await batch(routeBatchId)).processing_metrics, declared);
    assert.equal((await batch(routeBatchId)).capture_timezone, null);
    assert.equal((await pool.query<{ published_at: Date }>(
      "SELECT published_at FROM mentions WHERE source_file_id=$1::uuid", [routeBatchId])).rows[0]!.published_at.toISOString(), "2026-08-02T05:30:00.000Z");
    const missingDate = await upload("route-no-date", "America/Mexico_City", "");
    assert.equal(missingDate.status, 422);
    assert.equal((await missingDate.json()).error, "source_timestamp_required");
    const offset = await upload("route-offset", undefined, "2026-08-01T23:30:00-06:00");
    assert.equal(offset.status, 500);
    assert.equal((await offset.json()).message, "Workspace import provenance target is unavailable.", "offset timestamps reach provenance without needing a source timezone");
  } finally {
    if (previousUploadDir === undefined) delete process.env.NOISIA_CSV_UPLOAD_DIR;
    else process.env.NOISIA_CSV_UPLOAD_DIR = previousUploadDir;
    await pool.end();
  }
});
