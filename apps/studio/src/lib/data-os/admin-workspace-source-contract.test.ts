import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

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
