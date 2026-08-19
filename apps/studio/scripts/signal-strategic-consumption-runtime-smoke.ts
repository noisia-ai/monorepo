import assert from "node:assert/strict";

import { pool } from "../src/lib/db";
import { loadSignalStrategicReleasesV1 } from "../src/lib/data-os/signal-strategic-releases";
import {
  loadSignalTriggersBarriersOverviewV2,
  resolveSignalTriggersBarriersCutV2
} from "../src/lib/data-os/signal-triggers-barriers-serving";
import { resolveSignalWorkspaceForUser } from "../src/lib/data-os/signal-workspace";

const APPROVED = process.env.NOISIA_SIGNAL_STRATEGIC_RUNTIME_SMOKE_APPROVED === "true";
const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  assert.equal(APPROVED, true, "Set NOISIA_SIGNAL_STRATEGIC_RUNTIME_SMOKE_APPROVED=true.");
  assert.ok(DATABASE_URL, "DATABASE_URL is required.");
  requireDisposableLocalDatabase(DATABASE_URL);

  const fixture = await pool.query<{
    workspace_id: string;
    organization_id: string;
    workspace_slug: string;
    current_release_id: string;
    report_revision: number;
    snapshot_id: string;
    analysis_id: string;
    execution_corpus_id: string;
    expected_mention_id: string;
    user_id: string;
  }>(`
    SELECT workspace.id::text AS workspace_id,
      workspace.organization_id::text,
      workspace.slug AS workspace_slug,
      release.id::text AS current_release_id,
      release.report_revision,
      release.snapshot_id::text,
      release.tb_analysis_id::text AS analysis_id,
      analysis.study_corpus_id::text AS execution_corpus_id,
      citation.mention_id::text AS expected_mention_id,
      $1::uuid::text AS user_id
    FROM signal_workspace_report_current_releases pointer
    JOIN signal_workspace_releases release ON release.id = pointer.release_id
    JOIN signal_workspaces workspace ON workspace.id = pointer.workspace_id
    JOIN tb_analyses analysis ON analysis.id = release.tb_analysis_id
    JOIN tb_findings finding ON finding.tb_analysis_id = analysis.id
    JOIN tb_finding_citations citation ON citation.finding_id = finding.id
    WHERE pointer.report_key = 'triggers-barriers'
      AND release.release_key = 'phase5-fixture-release-2'
    ORDER BY citation.position, citation.id
    LIMIT 1
  `, ["10000000-0000-4000-8000-000000000101"]);
  const row = fixture.rows[0];
  assert.ok(row, "Run the Signal workspace PostgreSQL integration first.");

  const workspace = await resolveSignalWorkspaceForUser({
    id: row.user_id,
    userType: "noisia_internal",
    organizationId: row.organization_id
  }, { workspaceId: row.workspace_id });
  assert.ok(workspace);

  const releases = await loadSignalStrategicReleasesV1(workspace, true);
  assert.equal(releases.current?.release_id, row.current_release_id);
  assert.equal(releases.current?.report_key, "triggers-barriers");
  assert.equal(releases.current?.report_revision, 2);
  assert.deepEqual(
    releases.history.map((release) => release.report_revision).sort(),
    [1, 2]
  );

  const overview = await loadSignalTriggersBarriersOverviewV2({ workspace });
  assert.ok(overview);
  assert.equal(overview.study.id, "triggers-barriers");
  assert.equal(overview.cut.analysis_id, row.analysis_id);
  assert.equal(overview.cut.snapshot_id, row.snapshot_id);
  assert.equal(overview.cut.output_id, null);
  assert.equal(overview.findings.length, 1);
  assert.equal(overview.initial_evidence?.records.length, 1);
  assert.equal(overview.initial_evidence?.records[0]?.mention_id, row.expected_mention_id);

  const legacyAdapterCut = await resolveSignalTriggersBarriersCutV2({
    workspace,
    studyCorpusId: row.execution_corpus_id
  });
  assert.equal(legacyAdapterCut?.analysis_id, row.analysis_id);
  assert.equal(legacyAdapterCut?.snapshot_id, row.snapshot_id);

  const stablePath = `/signal/${row.workspace_slug}/reports/triggers-barriers`;
  assert.equal(new URL(stablePath, "http://localhost:3001").searchParams.has("study"), false);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contract_version: overview.contract_version,
    stable_path: stablePath,
    report_key: releases.current.report_key,
    revisions: releases.history.map((release) => release.report_revision).sort(),
    current_revision: releases.current.report_revision,
    current_snapshot_id: row.snapshot_id,
    finding_count: overview.findings.length,
    evidence_count: overview.initial_evidence?.records.length ?? 0,
    canonical_evidence_mention_id: overview.initial_evidence?.records[0]?.mention_id ?? null,
    legacy_adapter_resolves_current: legacyAdapterCut?.analysis_id === row.analysis_id
  }, null, 2)}\n`);
}

function requireDisposableLocalDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /migration[_-]smoke/u);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
