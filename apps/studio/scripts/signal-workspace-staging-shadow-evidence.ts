import assert from "node:assert/strict";

import type { ResolvedSignalWorkspace } from "../src/lib/data-os/signal-workspace";
import { loadWorkspacePopulationShadowComparison } from "../src/lib/data-os/signal-workspace-population";
import { pool } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const parsed = new URL(databaseUrl);
const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
if (!local && target !== "preview" && target !== "staging") {
  throw new Error("Remote shadow evidence requires a real preview or staging target.");
}
if (!local && process.env.NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_ALLOW_REMOTE !== "true") {
  throw new Error("NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_ALLOW_REMOTE=true is required.");
}
if (process.env.NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_APPROVED !== "true") {
  throw new Error("NOISIA_SIGNAL_STAGING_SHADOW_EVIDENCE_APPROVED=true is required.");
}
const workspaceId = process.env.NOISIA_SIGNAL_WORKSPACE_ID?.trim();
if (!workspaceId || !/^[0-9a-f-]{36}$/iu.test(workspaceId)) {
  throw new Error("NOISIA_SIGNAL_WORKSPACE_ID must be a UUID resolved server-side for the clone.");
}

async function loadWorkspace(): Promise<ResolvedSignalWorkspace> {
  const identity = await pool.query<{
    id: string;
    organization_id: string;
    slug: string;
    timezone: string;
    status: string;
    brand_id: string | null;
    theme_id: string | null;
    name: string;
  }>(`
    SELECT
      workspace.id::text,
      workspace.organization_id::text,
      workspace.slug,
      workspace.timezone,
      workspace.status,
      workspace.brand_id::text,
      workspace.theme_id::text,
      COALESCE(brand.display_name, brand.name, theme.name, workspace.slug) AS name
    FROM signal_workspaces workspace
    LEFT JOIN brands brand ON brand.id = workspace.brand_id
    LEFT JOIN themes theme ON theme.id = workspace.theme_id
    WHERE workspace.id = $1::uuid
  `, [workspaceId]);
  const row = identity.rows[0];
  assert.ok(row, "Workspace does not exist in the rehearsal target.");
  assert.equal(row.status, "active", "Workspace must be active for shadow evidence.");
  assert.equal(Boolean(row.brand_id) !== Boolean(row.theme_id), true);

  const corpora = await pool.query<{
    id: string;
    name: string | null;
    role: "operational" | "strategic" | "legacy";
    status: string;
    valid_from: string;
    methodology_slug: string | null;
    output_id: string | null;
  }>(`
    SELECT
      corpus.id::text,
      corpus.name,
      membership.role,
      corpus.status,
      membership.valid_from::text,
      methodology.slug AS methodology_slug,
      output.id::text AS output_id
    FROM signal_workspace_corpora membership
    JOIN study_corpora corpus ON corpus.id = membership.study_corpus_id
    LEFT JOIN methodologies methodology ON methodology.id = corpus.methodology_id
    LEFT JOIN LATERAL (
      SELECT published.id
      FROM published_outputs published
      WHERE published.study_corpus_id = corpus.id
        AND published.status = 'published'
      ORDER BY published.published_at DESC NULLS LAST, published.created_at DESC
      LIMIT 1
    ) output ON true
    WHERE membership.workspace_id = $1::uuid
      AND membership.valid_to IS NULL
    ORDER BY membership.role, corpus.id
  `, [workspaceId]);

  return {
    contractVersion: "signal-backend-v1",
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    subject: row.brand_id
      ? { type: "brand", id: row.brand_id }
      : { type: "theme", id: row.theme_id! },
    timezone: row.timezone,
    status: row.status,
    corpora: corpora.rows.map((corpus) => ({
      id: corpus.id,
      name: corpus.name,
      role: corpus.role,
      status: corpus.status,
      validFrom: corpus.valid_from,
      methodologySlug: corpus.methodology_slug,
      outputId: corpus.output_id
    }))
  };
}

async function main() {
  const workspace = await loadWorkspace();
  const startedAt = performance.now();
  const shadow = await loadWorkspacePopulationShadowComparison(workspace);
  const durationMs = Math.round(performance.now() - startedAt);
  const modules = shadow.module_serving_shadow;
  const monitoring = modules.brand_monitoring;
  const mentions = modules.mentions;
  const taxonomy = modules.topics_narratives;
  assert.ok(monitoring && mentions && taxonomy, "All three module readers are required.");

  console.log(JSON.stringify({
    ok: modules.gate_passed,
    target: local ? "local" : target,
    read_only: true,
    duration_ms: durationMs,
    shadow_state: modules.state,
    reconciliation_basis: modules.reconciliation_basis,
    governed_correct: modules.governed_correct,
    zero_unexplained_differences: modules.zero_unexplained_differences,
    parity_with_legacy: modules.parity_with_legacy,
    governed_module_checks: modules.governed_module_checks,
    governed_contract: modules.governed_contract ? {
      primary_brand_contract: modules.governed_contract.primary_brand_contract,
      active_memberships: modules.governed_contract.active_memberships,
      contract_violation_count: modules.governed_contract.contract_violation_count,
      filtered_count: modules.governed_contract.filtered_count,
      canonical_ids_hash: modules.governed_contract.canonical_ids_hash,
      period_start: modules.governed_contract.period_start,
      period_end: modules.governed_contract.period_end,
      series_hash: modules.governed_contract.series_hash,
      topic_result_count: modules.governed_contract.topic_result_count,
      topic_results_hash: modules.governed_contract.topic_results_hash,
      narrative_result_count: modules.governed_contract.narrative_result_count,
      narrative_results_hash: modules.governed_contract.narrative_results_hash,
      resolved_alias_assignment_count:
        modules.governed_contract.resolved_alias_assignment_count
    } : null,
    legacy_differences: modules.legacy_differences,
    brand_monitoring: {
      legacy_denominator: monitoring.legacy.row_denominator,
      governed_denominator: monitoring.governed.row_denominator,
      governed_ids_hash: monitoring.governed.canonical_ids_hash,
      governed_series_hash: monitoring.governed.series_hash,
      governed_period_start: monitoring.governed.period_start,
      governed_period_end: monitoring.governed.period_end,
      reconciled_with_legacy: monitoring.reconciled
    },
    mentions: {
      comparison: mentions.set_comparison,
      legacy_total: mentions.legacy.total_count,
      governed_total: mentions.governed.total_count,
      governed_ids_hash: mentions.governed.canonical_ids_hash,
      governed_period_start: mentions.governed.period_start,
      governed_period_end: mentions.governed.period_end,
      first_page_count: mentions.governed.first_page_count,
      second_page_count: mentions.governed.second_page_count,
      next_cursor_present: mentions.governed.next_cursor_present,
      cursor_valid: mentions.governed.cursor_valid,
      next_cursor_hash: mentions.governed.next_cursor_hash,
      reconciled_with_legacy: mentions.reconciled
    },
    topics_narratives: {
      legacy_denominator: taxonomy.legacy.row_denominator,
      governed_denominator: taxonomy.governed.row_denominator,
      governed_ids_hash: taxonomy.governed.canonical_ids_hash,
      governed_period_start: taxonomy.governed.period_start,
      governed_period_end: taxonomy.governed.period_end,
      topic_result_count: taxonomy.governed.topic_result_count,
      topic_results_hash: taxonomy.governed.topic_results_hash,
      narrative_result_count: taxonomy.governed.narrative_result_count,
      narrative_results_hash: taxonomy.governed.narrative_results_hash,
      resolved_alias_assignment_count: taxonomy.governed.resolved_alias_assignment_count,
      reconciled_with_legacy: taxonomy.reconciled
    }
  }, null, 2));

  if (!modules.gate_passed) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
