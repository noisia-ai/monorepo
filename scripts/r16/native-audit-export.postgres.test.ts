import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { withSignalStudyFixtureV1 } from "../../infrastructure/db/migrations/signal-study.synthetic.fixture.js";
import { withStudyNativeRuntimeV1 } from "../../infrastructure/db/migrations/signal-study-runtime.synthetic.fixture.js";
import { buildBlindPackageV1 } from "./blind-package.js";
import { exportNativeAuditSnapshotV1 } from "./native-audit-export.js";

const enabled = process.env.NOISIA_R16_NATIVE_AUDIT_EXPORT_PG === "true";

test("native audit export binds the exact synthetic Listening pair and completed Study proof without real providers", {
  skip: !enabled, timeout: 1_200_000,
}, async () => {
  const privateDir = join(".data/piloto-masivo/r16/native-audit-export-integration", randomUUID());
  try {
    await withSignalStudyFixtureV1(async f => withStudyNativeRuntimeV1(f.database, async runtime => {
  const execution = await f.request();
  assert.equal((await runtime.run(execution.id)).status, "completed");
  const afterRow = (await f.database.query<{ generation_id: string }>(`SELECT generation_id FROM signal_listening_serving_snapshots
    WHERE workspace_id=$1 AND id=$2`, [f.workspace_id, f.listeningSnapshot.id])).rows[0];
  assert.ok(afterRow?.generation_id);
    const outputPath = join(privateDir, "snapshot.json"), sourceManifestPath = join(privateDir, "source-manifest.json");
    const exported = await exportNativeAuditSnapshotV1({ database: f.database, workspace_id: f.workspace_id, actor_user_id: f.actor_user_id,
      listening_before_generation_id: f.confirmed.id, listening_after_generation_id: afterRow.generation_id,
      study_execution_id: execution.id, output_path: outputPath, source_manifest_path: sourceManifestPath });
    const source = JSON.parse(await readFile(exported.source_manifest_path, "utf8")) as Record<string, any>;
    assert.equal(source.listening_before_generation_id, f.confirmed.id);
    assert.equal(source.listening_after_generation_id, afterRow.generation_id);
    assert.equal(source.study_execution_id, execution.id);
    assert.equal(source.source_digests.before, source.source_digests.before_verified_digest);
    assert.equal(source.source_digests.after, source.source_digests.after_verified_digest);
    assert.equal(source.source_digests.study_output, source.source_digests.study_output_verified_digest);
    assert.equal(source.measurements.listening_parent.generation_path_complete, true);
    assert.equal(source.measurements.listening_parent.before_generation_index, 0);
    assert.equal(exported.snapshot.study_provenance.listening_before_digest, source.source_digests.before.slice(7));
    assert.equal(exported.snapshot.study_provenance.listening_after_digest, source.source_digests.after.slice(7));
    assert.equal(source.source_row_counts.before_roots, 240);
    assert.equal(source.source_row_counts.after_roots, 240);
    assert.equal(source.source_row_counts.study_roots, 240);

    assert.ok(exported.snapshot.layer_agreement);
    assert.equal(exported.snapshot.layer_agreement?.estimation_status, "complete");
    assert.equal(exported.snapshot.layer_agreement?.kappa, 1);
    assert.equal(source.native_layer_proof.output_digest, source.source_digests.study_output);
    assert.equal(exported.snapshot.receipts.status, "complete", JSON.stringify({ limitations: exported.limitations,
      stages: exported.snapshot.receipts.stages.map(({ stage, cost_usd, reserved_usd, elapsed_ms }) => ({ stage, cost_usd, reserved_usd, elapsed_ms })) }));
    assert.ok((exported.snapshot.receipts.total_cost_usd ?? 0) > 0);
    assert.equal(exported.snapshot.receipts.total_reserved_usd, 0);
    const measured = source.measurements as { unique_call_count: number; call_receipts: Array<{ ledger: string; call_id: string;
      settled_micro_usd: string | null }>; cost_micro_usd: string };
    assert.equal(measured.call_receipts.length, measured.unique_call_count);
    assert.equal(new Set(measured.call_receipts.map(row => `${row.ledger}\0${row.call_id}`)).size, measured.unique_call_count);
    const measuredMicroUsd = measured.call_receipts.reduce((total, row) => total + BigInt(row.settled_micro_usd ?? "0"), 0n);
    assert.equal(measured.cost_micro_usd, measuredMicroUsd.toString());
    assert.equal(exported.snapshot.receipts.total_cost_usd, Number(measuredMicroUsd) / 1_000_000);

    assert.ok(source.author_privacy_rosters.length > 0);
    assert.equal((await stat(exported.snapshot_path)).mode & 0o077, 0);
    assert.equal((await stat(exported.source_manifest_path)).mode & 0o077, 0);
    const blind = buildBlindPackageV1(exported.snapshot, `synthetic-native-audit-seed-${randomUUID()}-not-client-data`);
    const packetText = JSON.stringify(blind.packets);
    assert.doesNotMatch(packetText, new RegExp(f.workspace_id, "u"));
    assert.doesNotMatch(packetText, new RegExp(f.actor_user_id, "u"));
    assert.doesNotMatch(packetText, new RegExp(execution.id, "u"));
    assert.ok(blind.manifest.strata.every(row => Number.isInteger(row.shortfall) && row.shortfall >= 0),
      "fixture shortfalls remain explicit; this acceptance test does not claim sample-quality completion");

    await assert.rejects(exportNativeAuditSnapshotV1({ database: f.database, workspace_id: f.workspace_id, actor_user_id: f.actor_user_id,
      listening_before_generation_id: f.confirmed.id, listening_after_generation_id: afterRow.generation_id,
      study_execution_id: randomUUID(), output_path: join(privateDir, "wrong-study.json"),
      source_manifest_path: join(privateDir, "wrong-study-manifest.json") }), /native_audit_study_execution_invalid/u);
    await assert.rejects(exportNativeAuditSnapshotV1({ database: f.database, workspace_id: f.workspace_id, actor_user_id: f.actor_user_id,
      listening_before_generation_id: randomUUID(), listening_after_generation_id: afterRow.generation_id,
      study_execution_id: execution.id, output_path: join(privateDir, "wrong-before.json"),
      source_manifest_path: join(privateDir, "wrong-before-manifest.json") }), /native_audit_listening_source_stale/u);
    }), { population_count: 240, initial_approved: 240, complete_listening: true });
  } finally {
    // Test export contains native private source rows; remove only this unique fixture directory.
    await rm(privateDir, { recursive: true, force: true });
  }
});
