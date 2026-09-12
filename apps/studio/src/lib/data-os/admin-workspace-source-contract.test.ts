import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { Pool } from "pg";

import { validateSignalWorkspaceSourceInputV1 } from "@noisia/query-engine";

import {
  buildAdminWorkspaceConnectorInput,
  buildAdminWorkspacePrimarySourceInput
} from "./admin-workspace-source-contract";

test("Admin source creation uses the canonical workspace ingestion contract", () => {
  const input = buildAdminWorkspacePrimarySourceInput({
    name: "  Listening CSV  ",
    provider: "sentione"
  });

  assert.deepEqual(validateSignalWorkspaceSourceInputV1(input), {
    name: "Listening CSV",
    provider: "sentione",
    source_type: "social-listening",
    connection_method: "manual-csv",
    scope: "primary_brand",
    entity_id: null
  });
});

test("Admin connector creation separates transport from acquisition scope", () => {
  assert.deepEqual(buildAdminWorkspaceConnectorInput({
    name: "  Listening project  ",
    provider: " SentiOne "
  }), {
    contract_version: "signal-data-source-connector-v1",
    name: "Listening project",
    provider: "sentione",
    source_type: "social-listening",
    connection_method: "manual-csv"
  });
});

test("single-brand loaders preserve access and lookup without querying workspace details", async (t) => {
  const brandId = "10000000-0000-4000-8000-000000000001";
  const workspaceId = "10000000-0000-4000-8000-000000000002";
  const actor = { id: "10000000-0000-4000-8000-000000000003", userType: "noisia_internal" };
  const row = { brand_id: brandId, brand_slug: "summary-fixture", brand_name: "Summary fixture",
    brand_status: "active", workspace_id: workspaceId as string | null, timezone: "Asia/Tokyo" };
  const queries: string[] = [];
  let actorActive = true;
  const originalPool = globalThis.noisiaStudioPgPool;
  globalThis.noisiaStudioPgPool = { async query(sql: string, values: unknown[]) {
    queries.push(sql);
    if (sql.includes("FROM brands brand") && sql.includes("JOIN users actor")) {
      assert.equal(values.length, 2);
      assert.equal(values[1], actor.id);
      assert.match(sql, /SELECT COALESCE\(brand\.display_name, brand\.name\) AS brand_name, workspace\.id::text AS workspace_id\s+FROM/u);
      assert.match(sql, /actor\.id = \$2::uuid\s+AND actor\.user_type = 'noisia_internal' AND actor\.status = 'active'/u);
      assert.match(sql, /workspace\.brand_id = brand\.id\s+AND workspace\.organization_id = brand\.organization_id AND workspace\.status <> 'archived'/u);
      assert.match(sql, /WHERE brand\.id::text = \$1::text OR brand\.slug = \$1::text/u);
      assert.doesNotMatch(sql, /corpus|mentions|data_sources|import_batches|reports|profiles|count\(|LATERAL/iu);
      return { rows: actorActive && (values[0] === brandId || values[0] === row.brand_slug)
        ? [{ brand_name: row.brand_name, workspace_id: row.workspace_id }] : [] };
    }
    if (sql.includes("FROM brands brand")) {
      assert.equal(values.length, 1);
      return { rows: values[0] === brandId || values[0] === row.brand_slug ? [row] : [] };
    }
    if (sql.includes("FROM signal_workspaces workspace JOIN users actor")) {
      assert.deepEqual(values, [[workspaceId], actor.id]);
      return { rows: [] };
    }
    throw new Error("Summary must not query sources, imports, reports, profiles or detail counts");
  } } as unknown as Pool;
  try {
    const { getAdminBrandWorkspaceSummary, getAdminBrandWorkspaceIdentity } = await import("../data/admin-workspace");
    assert.equal(await getAdminBrandWorkspaceSummary({ ...actor, userType: "client" }, brandId), null);
    assert.equal(queries.length, 0, "non-internal access must not read the database");
    const byId = await getAdminBrandWorkspaceSummary(actor, brandId);
    assert.equal(queries.length, 2, "only summary and corpus authority are read");
    assert.equal(byId?.brandId, brandId);
    assert.equal(byId?.workspaceId, workspaceId);
    assert.equal(byId?.timezone, "Asia/Tokyo");
    assert.equal(byId?.corpus, null);
    assert.deepEqual(await getAdminBrandWorkspaceSummary(actor, row.brand_slug), byId);
    assert.equal(queries.length, 4);
    assert.equal(await getAdminBrandWorkspaceSummary(actor, "missing"), null);
    assert.equal(queries.length, 5);
    row.workspace_id = null;
    assert.equal((await getAdminBrandWorkspaceSummary(actor, brandId))?.workspaceId, null);
    assert.equal(queries.length, 6, "brands without a workspace remain visible without detail queries");
    await t.test("Topics identity uses one lightweight query and no corpus or detail reads", async () => {
      queries.length = 0;
      row.workspace_id = workspaceId;
      assert.equal(await getAdminBrandWorkspaceIdentity({ ...actor, userType: "client" }, brandId), null);
      assert.equal(queries.length, 0);
      const expected = { brandName: row.brand_name, workspaceId };
      assert.deepEqual(await getAdminBrandWorkspaceIdentity(actor, brandId), expected);
      assert.equal(queries.length, 1);
      assert.deepEqual(await getAdminBrandWorkspaceIdentity(actor, row.brand_slug), expected);
      assert.equal(queries.length, 2);
      assert.equal(await getAdminBrandWorkspaceIdentity(actor, "missing"), null);
      assert.equal(queries.length, 3);
      row.workspace_id = null;
      assert.deepEqual(await getAdminBrandWorkspaceIdentity(actor, brandId), { ...expected, workspaceId: null });
      assert.equal(queries.length, 4);
      actorActive = false;
      assert.equal(await getAdminBrandWorkspaceIdentity(actor, brandId), null);
      assert.equal(queries.length, 5, "a revoked internal actor cannot receive identity data");
    });
  } finally {
    globalThis.noisiaStudioPgPool = originalPool;
  }
});

test("Admin Data keeps corpus summary while Topics reads identity and both retain page guards", async () => {
  for (const page of ["data", "topics"]) {
    const source = await readFile(new URL(`../../app/studio/brands/[id]/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, page === "topics"
      ? /getAdminBrandWorkspaceIdentity\(session\.appUser, id\)/u
      : /getAdminBrandWorkspaceSummary\(session\.appUser, id\)/u);
    if (page === "topics") assert.doesNotMatch(source, /getAdminBrandWorkspaceSummary|loadAdminWorkspaceCorpus/u);
    assert.doesNotMatch(source, /getAdminBrandWorkspace\(/u);
    assert.ok(source.includes('requireStudioUser(`/studio/brands/${id}/' + page + '`)'));
    assert.match(source, /resolveSignalWorkspaceForUser\(session\.appUser/u);
    assert.match(source, page === "topics"
      ? /if \(!identity\?\.workspaceId\) notFound\(\);/u
      : /if \(!summary\) notFound\(\);/u);
    if (page === "topics") assert.match(source, /if \(!workspace\) notFound\(\);/u);
  }
});

test("workspace CSV imports return before parsing and expose durable progress and retry", async () => {
  const root = resolve(process.cwd(), "../..");
  const [collectionRoute,itemRoute,service,manager,worker,studioAdapter,canonicalIngest] = await Promise.all([
    readFile(resolve(root,
      "apps/studio/src/app/api/data-os/signal/[workspaceId]/sources/[sourceId]/imports/route.ts"),
    "utf8"),
    readFile(resolve(root,
      "apps/studio/src/app/api/data-os/signal/[workspaceId]/sources/[sourceId]/imports/[importBatchId]/route.ts"),
    "utf8"),
    readFile(resolve(root,"apps/studio/src/lib/data-os/workspace-async-import.ts"),"utf8"),
    readFile(resolve(root,"apps/studio/src/components/admin/WorkspaceSourcesManager.tsx"),"utf8"),
    readFile(resolve(root,"services/workers/src/workers/mentions-csv-ingest.ts"),"utf8"),
    readFile(resolve(root,"apps/studio/src/lib/csv/sentione.ts"),"utf8"),
    readFile(resolve(root,"infrastructure/db/sentione-csv-ingest.ts"),"utf8")
  ]);

  assert.match(collectionRoute,/status: 202/u);
  assert.match(collectionRoute,/supabase-multipart-signed/u);
  assert.match(collectionRoute,/polling_url/u);
  assert.doesNotMatch(collectionRoute,/ingestWorkspaceDataSourceCsvProductV1/u);
  assert.match(itemRoute,/complete-upload/u);
  assert.match(itemRoute,/fail-upload/u);
  assert.match(itemRoute,/retry-from-storage/u);
  assert.match(service,/signal_workspace_import_outbox/u);
  assert.match(service,/supersedesImportBatchId/u);
  assert.match(manager,/XMLHttpRequest/u);
  assert.match(manager,/upload_url/u);
  assert.match(manager,/data\.import\.retry/u);
  assert.match(manager,/finalValidationFailed/u);
  assert.match(manager,/Math\.min\(99/u);
  assert.match(worker,/storagePartCount/u);
  assert.match(worker,/createSignalSentioneCsvIngester/u);
  assert.doesNotMatch(worker,/function ingestSentioneCsvStream/u);
  assert.match(studioAdapter,/createSignalSentioneCsvIngester/u);
  assert.doesNotMatch(studioAdapter,/function ingestSentioneCsvStream/u);
  assert.equal((canonicalIngest.match(/function ingestSentioneCsvStream/gu) ?? []).length,1);
  assert.equal((canonicalIngest.match(/function normalizeMention/gu) ?? []).length,1);
  assert.match(canonicalIngest,/record_signal_workspace_import_provenance_set_v1/u);
  assert.doesNotMatch(canonicalIngest,/retrying .* rows individually/u);
  assert.match(worker,/seal_signal_workspace_import_storage_hash_v1/u);
});
