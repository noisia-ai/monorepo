import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishedOutputs, tbAnalyses } from "@noisia/db";
import { parseSynthesisResponse, type SynthesisResponse } from "@noisia/query-engine";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";

const ALLOW_REMOTE_ENV = "NOISIA_DATA_OS_SIGNAL_BACKFILL_ALLOW_REMOTE";

type RelationalCounts = {
  mentions: number;
  findings: number;
  opportunities: number;
  actions: number;
};

type CodingBridgeSummary = {
  contract: string;
  stage: string;
  counts: Record<string, number>;
  quality: {
    ready: boolean;
    status: string;
    warnings: string[];
  };
};

type ServingEntitiesBackfill = {
  sourceAvailable: boolean;
  required: boolean;
  sourceCounts: { strategicOpportunities: number; actionStudio: number };
  existingCounts: { strategicOpportunities: number; actionStudio: number };
  synthesis: SynthesisResponse;
  findingUuidByHumanId: Map<string, string>;
};

const REMEDIABLE_PREFLIGHT_BLOCK = "governed_dimensions_missing";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    const key = match?.[1];
    const rawValue = match?.[2];
    if (!key || rawValue === undefined || process.env[key] !== undefined) continue;

    const value = rawValue.trim();
    const unquoted = (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    )
      ? value.slice(1, -1)
      : value;
    process.env[key] = unquoted;
  }
}

function loadLocalEnvironment() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const appDir = resolve(scriptDir, "..");
  const repoDir = resolve(appDir, "../..");

  for (const path of [
    resolve(appDir, ".env.local"),
    resolve(repoDir, ".env.local"),
    resolve(appDir, ".env"),
    resolve(repoDir, ".env")
  ]) {
    loadEnvFile(path);
  }
}

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let outputId: string | null = null;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--output-id=")) {
      outputId = arg.slice("--output-id=".length);
      continue;
    }
    if (arg === "--output-id") {
      outputId = args[index + 1] ?? null;
      index += 1;
    }
  }

  if (!outputId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(outputId)) {
    throw new Error("Pass a valid published output UUID with --output-id=<uuid>.");
  }

  return { outputId, apply };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadDigest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex");
}

function dateValue(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function relationalCounts(overview: {
  corpus: { total_mentions: number };
  metrics: { findings_total: number; opportunities_total: number };
  action_studio: unknown[];
}): RelationalCounts {
  return {
    mentions: overview.corpus.total_mentions,
    findings: overview.metrics.findings_total,
    opportunities: overview.metrics.opportunities_total,
    actions: overview.action_studio.length
  };
}

function assertCountsMatch(
  actual: RelationalCounts,
  expected: RelationalCounts,
  stage: string
) {
  const mismatches = (Object.keys(expected) as Array<keyof RelationalCounts>)
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}: expected ${expected[key]}, received ${actual[key]}`);

  if (mismatches.length > 0) {
    throw new Error(`${stage} relational reconciliation failed: ${mismatches.join("; ")}`);
  }
}

function assertCoreCountsStable(
  actual: RelationalCounts,
  expected: RelationalCounts,
  stage: string
) {
  assertCountsMatch(
    {
      ...actual,
      opportunities: expected.opportunities,
      actions: expected.actions
    },
    expected,
    stage
  );
}

function requiresHistoricalCodingBridge(
  hardBlocks: Array<{ code: string }>
) {
  return hardBlocks.some((issue) => issue.code === REMEDIABLE_PREFLIGHT_BLOCK);
}

function hasOnlyRemediablePreflightBlocks(
  hardBlocks: Array<{ code: string }>,
  servingEntitiesSourceAvailable: boolean
) {
  const remediable = new Set([
    REMEDIABLE_PREFLIGHT_BLOCK,
    "analysis_artifacts_missing",
    "analysis_artifact_groups_incomplete",
    "finding_artifact_mismatch",
    "finding_artifact_evidence_incomplete",
    ...(servingEntitiesSourceAvailable
      ? [
          "opportunity_evidence_incomplete",
          "action_evidence_incomplete",
          "opportunity_persistence_mismatch",
          "action_persistence_mismatch"
        ]
      : [])
  ]);
  return hardBlocks.length > 0
    && hardBlocks.every((issue) => remediable.has(issue.code));
}

async function materializeHistoricalArtifactGraph(
  pool: Pool,
  analysisId: string
) {
  const { replaceTbAnalysisArtifactGraph } = await import(
    "../../../services/workers/src/workers/tb-analysis-artifact-persistence"
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    const existing = await client.query<{
      artifacts: number | string;
      unresolved: number | string;
      reviewed: number | string;
    }>(
      `SELECT
         COUNT(*) AS artifacts,
         COUNT(*) FILTER (WHERE review_status IN ('draft', 'needs_review')) AS unresolved,
         COUNT(*) FILTER (WHERE review_status NOT IN ('draft', 'needs_review')) AS reviewed
       FROM analysis_artifacts
       WHERE tb_analysis_id = $1::uuid`,
      [analysisId]
    );
    const existingArtifacts = Number(existing.rows[0]?.artifacts ?? 0);
    const unresolved = Number(existing.rows[0]?.unresolved ?? 0);
    const reviewed = Number(existing.rows[0]?.reviewed ?? 0);
    if (existingArtifacts > 0 && reviewed > 0 && unresolved > 0) {
      throw new Error("Historical artifact graph mixes reviewed and unresolved artifacts.");
    }

    const graph = existingArtifacts > 0 && reviewed === existingArtifacts
      ? null
      : await replaceTbAnalysisArtifactGraph(client, analysisId);
    await client.query(
      `INSERT INTO analysis_artifact_review_events (
         artifact_id, reviewer_user_id, action, previous_status, next_status, patch, notes
       )
       SELECT
         artifact.id,
         NULL,
         'accept_analysis',
         artifact.review_status,
         'accepted',
         '{}'::jsonb,
         'Inherited the existing approved T&B analysis state during guarded backfill.'
       FROM analysis_artifacts artifact
       WHERE artifact.tb_analysis_id = $1::uuid
         AND artifact.review_status IN ('draft', 'needs_review')`,
      [analysisId]
    );
    await client.query(
      `UPDATE analysis_artifacts
       SET review_status = 'accepted',
           updated_at = NOW()
       WHERE tb_analysis_id = $1::uuid
         AND review_status IN ('draft', 'needs_review')`,
      [analysisId]
    );
    const counts = await client.query<{
      artifacts: number | string;
      evidence_groups: number | string;
      evidence_links: number | string;
      artifact_relations: number | string;
    }>(
      `SELECT
         COUNT(DISTINCT artifact.id) AS artifacts,
         COUNT(DISTINCT evidence_group.id) AS evidence_groups,
         COUNT(DISTINCT evidence_link.id) AS evidence_links,
         COUNT(DISTINCT relation.id) AS artifact_relations
       FROM analysis_artifacts artifact
       LEFT JOIN analysis_evidence_groups evidence_group ON evidence_group.artifact_id = artifact.id
       LEFT JOIN analysis_evidence_links evidence_link ON evidence_link.evidence_group_id = evidence_group.id
       LEFT JOIN analysis_artifact_relations relation ON relation.source_artifact_id = artifact.id
       WHERE artifact.tb_analysis_id = $1::uuid`,
      [analysisId]
    );
    await client.query("COMMIT");
    const row = counts.rows[0];
    return {
      status: graph ? "materialized" : "preserved",
      artifacts: Number(row?.artifacts ?? 0),
      evidenceGroups: Number(row?.evidence_groups ?? 0),
      evidenceLinks: Number(row?.evidence_links ?? 0),
      artifactRelations: Number(row?.artifact_relations ?? 0)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function materializeHistoricalCodingBridge(
  analysisId: string
): Promise<CodingBridgeSummary> {
  const [bridgeModule, workerDbModule] = await Promise.all([
    import("../../../services/workers/src/workers/tb-data-os-bridge"),
    import("../../../services/workers/src/db/client")
  ]);

  try {
    const result = await bridgeModule.materializeTbCodingDataOs({
      tbAnalysisId: analysisId,
      stage: "reconcile"
    });
    const summary: CodingBridgeSummary = {
      contract: result.contract,
      stage: result.stage,
      counts: result.counts,
      quality: {
        ready: result.quality.ready,
        status: result.quality.status,
        warnings: result.quality.warnings
      }
    };

    if (!summary.quality.ready) {
      throw new Error(
        `Historical coding bridge failed quality checks: ${summary.quality.warnings.join(", ") || summary.quality.status}`
      );
    }
    return summary;
  } finally {
    await workerDbModule.pool.end();
  }
}

async function loadServingEntitiesBackfill(
  pool: Pool,
  analysisId: string
): Promise<ServingEntitiesBackfill> {
  const [analysisResult, findingsResult, countsResult] = await Promise.all([
    pool.query<{
      activation_playbook: unknown;
      friction_removal_plan: unknown;
      meta_json: unknown;
    }>(
      `SELECT activation_playbook, friction_removal_plan, meta_json
       FROM tb_analyses
       WHERE id = $1::uuid`,
      [analysisId]
    ),
    pool.query<{ id: string; finding_id: string }>(
      `SELECT id::text, finding_id
       FROM tb_findings
       WHERE tb_analysis_id = $1::uuid`,
      [analysisId]
    ),
    pool.query<{ strategic_opportunities: number; action_studio: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM tb_strategic_opportunities WHERE tb_analysis_id = $1::uuid) AS strategic_opportunities,
         (SELECT COUNT(*)::int FROM tb_action_studio WHERE tb_analysis_id = $1::uuid) AS action_studio`,
      [analysisId]
    )
  ]);
  const analysis = analysisResult.rows[0];
  if (!analysis) throw new Error("Linked T&B analysis disappeared while preparing serving backfill.");
  const meta = asRecord(analysis.meta_json);
  const sourceAvailable = Array.isArray(meta.strategic_opportunities)
    && Array.isArray(meta.action_studio);
  const synthesis = parseSynthesisResponse(JSON.stringify({
    activation_playbook: analysis.activation_playbook,
    friction_removal_plan: analysis.friction_removal_plan,
    action_studio: meta.action_studio,
    emerging_patterns: meta.emerging_patterns,
    knowledge_impact: meta.knowledge_impact,
    strategic_opportunities: meta.strategic_opportunities,
    future_signals: meta.future_signals,
    market_analysis: meta.market_analysis,
    evidence_deep_dives: meta.evidence_deep_dives
  }));
  const existing = countsResult.rows[0] ?? { strategic_opportunities: 0, action_studio: 0 };
  const sourceCounts = {
    strategicOpportunities: synthesis.strategic_opportunities.length,
    actionStudio: synthesis.action_studio.length
  };
  const existingCounts = {
    strategicOpportunities: Number(existing.strategic_opportunities ?? 0),
    actionStudio: Number(existing.action_studio ?? 0)
  };

  return {
    sourceAvailable,
    required: sourceAvailable && (
      sourceCounts.strategicOpportunities !== existingCounts.strategicOpportunities
      || sourceCounts.actionStudio !== existingCounts.actionStudio
    ),
    sourceCounts,
    existingCounts,
    synthesis,
    findingUuidByHumanId: new Map(findingsResult.rows.map((finding) => [finding.finding_id, finding.id]))
  };
}

async function materializeHistoricalServingEntities(
  pool: Pool,
  analysisId: string,
  plan: ServingEntitiesBackfill
) {
  const {
    assertTbServingFindingLinksResolved,
    replaceTbSignalServingEntities
  } = await import(
    "../../../services/workers/src/workers/tb-signal-serving-persistence"
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    const result = await replaceTbSignalServingEntities(client, {
      tbAnalysisId: analysisId,
      strategicOpportunities: plan.synthesis.strategic_opportunities,
      actionStudio: plan.synthesis.action_studio,
      findingUuidByHumanId: plan.findingUuidByHumanId
    });
    assertTbServingFindingLinksResolved(result.unmatchedFindingIds);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadLocalEnvironment();
  const { outputId, apply } = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const [
    { db, pool },
    { persistDataOsOutputRefs },
    { loadPublishedSignalOverview },
    { persistPublishedAnalysisArtifacts },
    { assessSignalServingReadiness, getSignalServingReadiness },
    { attachSignalServingContract },
    { requireSafeDatabaseReadTarget, requireSafeDatabaseWriteTarget }
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/data-os/output-refs"),
    import("../src/lib/data-os/published-signal-overview"),
    import("../src/lib/data-os/analysis-artifact-graph"),
    import("../src/lib/data-os/signal-serving"),
    import("../src/lib/signal/semantics"),
    import("../../../infrastructure/db/seeds/connection")
  ]);

  const closePool = async () => {
    await pool.end();
  };

  try {
    const guardOptions = {
      operation: apply ? "Signal relational serving backfill" : "Signal relational serving backfill dry-run",
      allowRemoteEnv: ALLOW_REMOTE_ENV
    };
    if (apply) {
      requireSafeDatabaseWriteTarget(databaseUrl, guardOptions);
    } else {
      requireSafeDatabaseReadTarget(databaseUrl, guardOptions);
    }

    const [output] = await db
      .select({
        id: publishedOutputs.id,
        tbAnalysisId: publishedOutputs.tbAnalysisId,
        studyCorpusId: publishedOutputs.studyCorpusId,
        status: publishedOutputs.status,
        manifest: publishedOutputs.manifest,
        payload: publishedOutputs.payload,
        version: publishedOutputs.version,
        publishedAt: publishedOutputs.publishedAt,
        updatedAt: publishedOutputs.updatedAt
      })
      .from(publishedOutputs)
      .where(eq(publishedOutputs.id, outputId))
      .limit(1);

    if (!output) throw new Error("Published output not found.");
    if (output.status !== "published") {
      throw new Error(`Output must be published before serving backfill; received ${output.status}.`);
    }
    if (!output.tbAnalysisId) throw new Error("Output is not linked to a T&B analysis.");

    const [analysis] = await db
      .select({
        id: tbAnalyses.id,
        snapshotId: tbAnalyses.snapshotId,
        studyCorpusId: tbAnalyses.studyCorpusId,
        status: tbAnalyses.status
      })
      .from(tbAnalyses)
      .where(eq(tbAnalyses.id, output.tbAnalysisId))
      .limit(1);

    if (!analysis) throw new Error("Linked T&B analysis not found.");
    if (!analysis.snapshotId) throw new Error("Analysis is not linked to an immutable corpus snapshot.");
    if (analysis.studyCorpusId !== output.studyCorpusId) {
      throw new Error("Output and analysis do not belong to the same corpus.");
    }
    if (!analysis.status.startsWith("approved_by_")) {
      throw new Error(`Analysis must be approved before serving backfill; received ${analysis.status}.`);
    }

    const servingEntitiesPlan = await loadServingEntitiesBackfill(pool, analysis.id);
    const readinessBeforeRefs = await getSignalServingReadiness({
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId,
      outputId: output.id,
      requireDataRefs: false
    });
    const assessmentBeforeRefs = assessSignalServingReadiness(readinessBeforeRefs);
    const codingBridgeRequired = requiresHistoricalCodingBridge(
      assessmentBeforeRefs.hardBlocks
    );
    const artifactGraphRequired = assessmentBeforeRefs.hardBlocks.some((issue) =>
      [
        "analysis_artifacts_missing",
        "analysis_artifact_groups_incomplete",
        "finding_artifact_mismatch",
        "finding_artifact_evidence_incomplete"
      ].includes(issue.code)
    );
    if (
      !assessmentBeforeRefs.ready
      && !hasOnlyRemediablePreflightBlocks(
        assessmentBeforeRefs.hardBlocks,
        servingEntitiesPlan.sourceAvailable
      )
    ) {
      throw new Error(
        `Relational serving is not ready: ${assessmentBeforeRefs.hardBlocks.map((issue) => issue.code).join(", ")}`
      );
    }

    const expectedCounts: RelationalCounts = {
      mentions: readinessBeforeRefs.counts.mentions,
      findings: readinessBeforeRefs.counts.findings,
      opportunities: readinessBeforeRefs.counts.opportunities,
      actions: readinessBeforeRefs.counts.actions
    };
    let preflightServingReadError: string | null = null;
    try {
      const overviewBeforeRefs = await loadPublishedSignalOverview({
        outputId: output.id,
        corpusId: output.studyCorpusId,
        snapshotId: analysis.snapshotId,
        analysisId: analysis.id,
        requireGovernedRef: false
      });
      assertCountsMatch(relationalCounts(overviewBeforeRefs), expectedCounts, "Preflight");
    } catch (error) {
      if (!servingEntitiesPlan.sourceAvailable) throw error;
      preflightServingReadError = error instanceof Error ? error.message : String(error);
    }

    const preflight = {
      mode: apply ? "apply" : "dry-run",
      status: codingBridgeRequired || servingEntitiesPlan.required || artifactGraphRequired || preflightServingReadError
        ? "reconciliation_required"
        : servingEntitiesPlan.sourceAvailable
          ? "reconciliation_planned"
          : "verified",
      contract_version: readinessBeforeRefs.contractVersion,
      counts: expectedCounts,
      warnings: assessmentBeforeRefs.warnings.map((warning) => warning.code),
      coding_bridge_required: codingBridgeRequired,
      artifact_graph_required: artifactGraphRequired,
      serving_entities: {
        source_available: servingEntitiesPlan.sourceAvailable,
        reconciliation_required: servingEntitiesPlan.required,
        preflight_read_error: preflightServingReadError,
        source_counts: servingEntitiesPlan.sourceCounts,
        existing_counts: servingEntitiesPlan.existingCounts
      },
      data_refs_complete: readinessBeforeRefs.dataRefs.complete,
      payload_role: "manifest_only"
    };

    if (!apply) {
      console.log(JSON.stringify(preflight, null, 2));
      console.log(`Dry-run only. Re-run with --apply and ${ALLOW_REMOTE_ENV}=true after confirming staging/preview.`);
      return;
    }

    let codingBridge: CodingBridgeSummary | null = null;
    if (codingBridgeRequired) {
      codingBridge = await materializeHistoricalCodingBridge(analysis.id);
    }

    const servingEntities = servingEntitiesPlan.required
      ? await materializeHistoricalServingEntities(pool, analysis.id, servingEntitiesPlan)
      : null;
    const artifactGraph = await materializeHistoricalArtifactGraph(pool, analysis.id);

    const readinessAfterBridge = await getSignalServingReadiness({
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId,
      outputId: output.id,
      requireDataRefs: false
    });
    const assessmentAfterBridge = assessSignalServingReadiness(readinessAfterBridge);
    if (!assessmentAfterBridge.ready) {
      throw new Error(
        `Relational serving is not ready after historical reconciliation: ${assessmentAfterBridge.hardBlocks.map((issue) => issue.code).join(", ")}`
      );
    }
    assertCoreCountsStable({
      mentions: readinessAfterBridge.counts.mentions,
      findings: readinessAfterBridge.counts.findings,
      opportunities: readinessAfterBridge.counts.opportunities,
      actions: readinessAfterBridge.counts.actions
    }, expectedCounts, "Post-bridge");

    const original = {
      payloadDigest: payloadDigest(output.payload),
      status: output.status,
      version: output.version,
      publishedAt: dateValue(output.publishedAt)
    };
    const refs = await persistDataOsOutputRefs({
      outputId: output.id,
      corpusId: output.studyCorpusId,
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId,
      required: true
    });
    if (refs.status !== "ok") {
      throw new Error(`Could not persist required Signal data refs: ${refs.reason ?? refs.status}.`);
    }

    const readiness = await getSignalServingReadiness({
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId,
      outputId: output.id,
      requireDataRefs: true
    });
    const assessment = assessSignalServingReadiness(readiness);
    if (!assessment.ready) {
      throw new Error(`Serving contract failed after refs: ${assessment.hardBlocks.map((issue) => issue.code).join(", ")}`);
    }

    const overview = await loadPublishedSignalOverview({
      outputId: output.id,
      corpusId: output.studyCorpusId,
      snapshotId: analysis.snapshotId,
      analysisId: analysis.id,
      requireGovernedRef: true
    });
    const verifiedCounts = relationalCounts(overview);
    assertCountsMatch(verifiedCounts, {
      mentions: readiness.counts.mentions,
      findings: readiness.counts.findings,
      opportunities: readiness.counts.opportunities,
      actions: readiness.counts.actions
    }, "Post-reference");
    const artifactSnapshot = await persistPublishedAnalysisArtifacts({
      outputId: output.id,
      corpusId: output.studyCorpusId,
      analysisId: analysis.id
    });

    const verifiedAt = new Date();
    const manifest = attachSignalServingContract({
      ...asRecord(output.manifest),
      data_os_readiness: {
        contract_version: readiness.contractVersion,
        counts: readiness.counts,
        warnings: assessment.warnings.map((warning) => warning.code)
      },
      ...(codingBridge ? {
        data_os_coding_bridge: {
          contract: codingBridge.contract,
          stage: codingBridge.stage,
          counts: codingBridge.counts,
          quality: codingBridge.quality
        }
      } : {}),
      ...(servingEntities ? {
        data_os_serving_entities: {
          strategic_opportunities: servingEntities.strategicOpportunitiesInserted,
          opportunity_finding_links: servingEntities.opportunityFindingLinksInserted,
          action_studio: servingEntities.actionStudioInserted,
          action_finding_links: servingEntities.actionFindingLinksInserted,
          unmatched_finding_ids: servingEntities.unmatchedFindingIds
        }
      } : {}),
      analysis_artifacts: {
        contract_version: artifactSnapshot.contractVersion,
        linked_artifacts: artifactSnapshot.linkedArtifacts,
        rejected_artifacts: artifactSnapshot.rejectedArtifacts,
        snapshot_role: "approved_revision"
      },
      relational_verification: {
        status: "verified",
        contract_version: readiness.contractVersion,
        verified_at: verifiedAt.toISOString(),
        mentions: verifiedCounts.mentions,
        findings: verifiedCounts.findings,
        opportunities: verifiedCounts.opportunities,
        actions: verifiedCounts.actions,
        payload_role: "manifest_only",
        payload_preserved: true
      }
    }, {
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId
    });

    await db
      .update(publishedOutputs)
      .set({ manifest, updatedAt: verifiedAt })
      .where(eq(publishedOutputs.id, output.id));

    const [verifiedOutput] = await db
      .select({
        status: publishedOutputs.status,
        payload: publishedOutputs.payload,
        version: publishedOutputs.version,
        publishedAt: publishedOutputs.publishedAt,
        manifest: publishedOutputs.manifest
      })
      .from(publishedOutputs)
      .where(eq(publishedOutputs.id, output.id))
      .limit(1);

    if (!verifiedOutput) throw new Error("Output disappeared after backfill.");
    const preservationChecks = {
      payload: payloadDigest(verifiedOutput.payload) === original.payloadDigest,
      status: verifiedOutput.status === original.status,
      version: verifiedOutput.version === original.version,
      published_at: dateValue(verifiedOutput.publishedAt) === original.publishedAt
    };
    if (Object.values(preservationChecks).some((preserved) => !preserved)) {
      throw new Error("Backfill changed a protected legacy output field.");
    }

    console.log(JSON.stringify({
      mode: "apply",
      status: "verified",
      contract_version: readiness.contractVersion,
      counts: verifiedCounts,
      data_refs: {
        persisted: refs.refs,
        complete: readiness.dataRefs.complete
      },
      coding_bridge: codingBridge,
      serving_entities: servingEntities,
      artifact_graph: artifactGraph,
      artifact_snapshot: artifactSnapshot,
      preserved: preservationChecks,
      payload_role: "manifest_only"
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
