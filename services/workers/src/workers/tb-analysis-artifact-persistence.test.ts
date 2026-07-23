import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import { replaceTbAnalysisArtifactGraph } from "./tb-analysis-artifact-persistence";

type RecordedQuery = { text: string; params: unknown[] };

function recordingClient(
  queries: RecordedQuery[],
  options: { reviewedArtifacts?: number } = {}
) {
  return {
    async query(text: string, params: unknown[] = []) {
      const normalized = text.replace(/\s+/g, " ").trim();
      queries.push({ text: normalized, params });
      if (normalized.includes("COUNT(*) AS reviewed_artifacts")) {
        return { rows: [{ reviewed_artifacts: options.reviewedArtifacts ?? 0 }] };
      }
      if (normalized.includes("COUNT(DISTINCT artifact.id) AS artifacts")) {
        return {
          rows: [{
            artifacts: "14",
            evidence_groups: "14",
            evidence_links: "31",
            artifact_relations: "18",
            lineage_edges: "63"
          }]
        };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
}

test("rebuilds a T&B artifact graph and projects governed lineage", async () => {
  const queries: RecordedQuery[] = [];
  const result = await replaceTbAnalysisArtifactGraph(recordingClient(queries), "analysis-1");

  assert.deepEqual(result, {
    artifacts: 14,
    evidenceGroups: 14,
    evidenceLinks: 31,
    artifactRelations: 18,
    lineageEdges: 63
  });
  assert.ok(queries.some((query) => query.text.includes("DELETE FROM analysis_artifacts")));
  assert.ok(queries.some((query) => query.text.includes("'finding:' || finding.finding_id")));
  assert.ok(queries.some((query) => query.text.includes("'knowledge_impact'")));
  assert.ok(queries.some((query) => query.text.includes("'future_signal:'")));
  assert.ok(queries.some((query) => query.text.includes("'market_analysis'")));
  assert.ok(queries.some((query) => query.text.includes("'evidence_deep_dive:'")));
  assert.ok(queries.some((query) => query.text.includes("JOIN tb_finding_citations citation")));
  assert.ok(queries.some((query) => query.text.includes("'mention', citation.mention_id")));
  assert.ok(queries.some((query) => query.text.includes("FROM tb_finding_structured_evidence_refs ref")));
  assert.ok(queries.some((query) => query.text.includes("governed_ref.evidence_role = 'claim_specific'")));
  assert.ok(queries.some((query) => query.text.includes("'data_asset', asset.id")));
  assert.ok(queries.some((query) => query.text.includes("'claim_specific', false")));
  assert.ok(queries.some((query) => query.text.includes("'import_batch'")));
  assert.ok(queries.some((query) => query.text.includes("'source_sync_run'")));
  assert.ok(queries.some((query) => query.text.includes("'storage_ref', storage_ref")));
  assert.ok(queries.some((query) => query.text.includes("ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation")));
  assert.ok(queries.every((query) => query.params[0] === "analysis-1"));
});

test("fails closed instead of overwriting reviewed artifacts", async () => {
  const queries: RecordedQuery[] = [];
  await assert.rejects(
    replaceTbAnalysisArtifactGraph(recordingClient(queries, { reviewedArtifacts: 2 }), "analysis-2"),
    /Reviewed analysis artifacts are immutable/
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.text ?? "", /review_status <> 'draft'/);
});
