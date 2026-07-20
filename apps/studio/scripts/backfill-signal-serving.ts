import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishedOutputs, tbAnalyses } from "@noisia/db";
import { eq } from "drizzle-orm";

const ALLOW_REMOTE_ENV = "NOISIA_DATA_OS_SIGNAL_BACKFILL_ALLOW_REMOTE";

type RelationalCounts = {
  mentions: number;
  findings: number;
  opportunities: number;
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
}): RelationalCounts {
  return {
    mentions: overview.corpus.total_mentions,
    findings: overview.metrics.findings_total,
    opportunities: overview.metrics.opportunities_total
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

function requiresHistoricalCodingBridge(
  hardBlocks: Array<{ code: string }>
) {
  return hardBlocks.some((issue) => issue.code === REMEDIABLE_PREFLIGHT_BLOCK);
}

function hasOnlyRemediablePreflightBlocks(
  hardBlocks: Array<{ code: string }>
) {
  return hardBlocks.length > 0
    && hardBlocks.every((issue) => issue.code === REMEDIABLE_PREFLIGHT_BLOCK);
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

async function main() {
  loadLocalEnvironment();
  const { outputId, apply } = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const [
    { db, pool },
    { persistDataOsOutputRefs },
    { loadPublishedSignalOverview },
    { assessSignalServingReadiness, getSignalServingReadiness },
    { attachSignalServingContract },
    { requireSafeDatabaseReadTarget, requireSafeDatabaseWriteTarget }
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/data-os/output-refs"),
    import("../src/lib/data-os/published-signal-overview"),
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
    if (
      !assessmentBeforeRefs.ready
      && !hasOnlyRemediablePreflightBlocks(assessmentBeforeRefs.hardBlocks)
    ) {
      throw new Error(
        `Relational serving is not ready: ${assessmentBeforeRefs.hardBlocks.map((issue) => issue.code).join(", ")}`
      );
    }

    const overviewBeforeRefs = await loadPublishedSignalOverview({
      outputId: output.id,
      corpusId: output.studyCorpusId,
      snapshotId: analysis.snapshotId,
      analysisId: analysis.id,
      requireGovernedRef: false
    });
    const expectedCounts: RelationalCounts = {
      mentions: readinessBeforeRefs.counts.mentions,
      findings: readinessBeforeRefs.counts.findings,
      opportunities: readinessBeforeRefs.counts.opportunities
    };
    assertCountsMatch(relationalCounts(overviewBeforeRefs), expectedCounts, "Preflight");

    const preflight = {
      mode: apply ? "apply" : "dry-run",
      status: codingBridgeRequired ? "coding_bridge_required" : "verified",
      contract_version: readinessBeforeRefs.contractVersion,
      counts: expectedCounts,
      warnings: assessmentBeforeRefs.warnings.map((warning) => warning.code),
      coding_bridge_required: codingBridgeRequired,
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

    const readinessAfterBridge = await getSignalServingReadiness({
      analysisId: analysis.id,
      snapshotId: analysis.snapshotId,
      outputId: output.id,
      requireDataRefs: false
    });
    const assessmentAfterBridge = assessSignalServingReadiness(readinessAfterBridge);
    if (!assessmentAfterBridge.ready) {
      throw new Error(
        `Relational serving is not ready after coding reconciliation: ${assessmentAfterBridge.hardBlocks.map((issue) => issue.code).join(", ")}`
      );
    }
    assertCountsMatch({
      mentions: readinessAfterBridge.counts.mentions,
      findings: readinessAfterBridge.counts.findings,
      opportunities: readinessAfterBridge.counts.opportunities
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
      opportunities: readiness.counts.opportunities
    }, "Post-reference");

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
      relational_verification: {
        status: "verified",
        contract_version: readiness.contractVersion,
        verified_at: verifiedAt.toISOString(),
        mentions: verifiedCounts.mentions,
        findings: verifiedCounts.findings,
        opportunities: verifiedCounts.opportunities,
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
