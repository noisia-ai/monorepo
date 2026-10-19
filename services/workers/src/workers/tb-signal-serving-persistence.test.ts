import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import {
  assertTbAnalysisAcceptsSynthesisWrite,
  assertTbServingFindingLinksResolved,
  replaceTbSignalServingEntities
} from "./tb-signal-serving-persistence";

type RecordedQuery = { text: string; params: unknown[] };

function recordingClient(queries: RecordedQuery[]) {
  return {
    async query(text: string, params: unknown[] = []) {
      const normalized = text.replace(/\s+/g, " ").trim();
      queries.push({ text: normalized, params });
      if (normalized.includes("INSERT INTO tb_strategic_opportunities")) {
        return { rows: [{ id: "opportunity-uuid" }] };
      }
      if (normalized.includes("INSERT INTO tb_action_studio")) {
        return { rows: [{ id: "action-uuid" }] };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
}

test("replaces strategic opportunities and Action Studio with finding lineage", async () => {
  const queries: RecordedQuery[] = [];
  const result = await replaceTbSignalServingEntities(recordingClient(queries), {
    tbAnalysisId: "analysis-1",
    findingUuidByHumanId: new Map([
      ["F-01", "finding-uuid-1"],
      ["F-02", "finding-uuid-2"]
    ]),
    strategicOpportunities: [{
      opportunity_id: "OP-01",
      title: "Own the high-confidence moment",
      decision: "Prioritize the moment",
      why_now: "The approved snapshot shows repeat demand.",
      level: "brand",
      source_mix: ["findings", "snapshot"],
      related_finding_ids: ["F-01", "F-MISSING", "F-01"],
      evidence_summary: "Two governed findings support the decision.",
      what_to_do: "Launch a bounded test.",
      success_signal: "Qualified response increases.",
      confidence: "alta"
    }],
    actionStudio: [{
      action_id: "AS-01",
      target_team: "creative_content",
      kind: "experiment",
      title: "Prototype the message",
      finding_ids: ["F-01", "F-02", "F-01"],
      primary_finding_id: "F-01",
      rationale: "The evidence is specific enough for a bounded test.",
      action_text: "Create and test two executions.",
      suggested_channel: "paid social",
      suggested_format: "short video",
      success_signal: "Higher qualified completion rate.",
      estimated_effort: "media",
      estimated_impact: "alto",
      confidence: "alta",
      priority_rank: 1
    }]
  });

  assert.deepEqual(result, {
    strategicOpportunitiesInserted: 1,
    opportunityFindingLinksInserted: 1,
    actionStudioInserted: 1,
    actionFindingLinksInserted: 2,
    unmatchedFindingIds: ["F-MISSING"]
  });
  assert.match(queries[0]?.text ?? "", /DELETE FROM tb_action_studio/);
  assert.match(queries[1]?.text ?? "", /DELETE FROM tb_strategic_opportunities/);
  assert.equal(queries.filter((query) => query.text.includes("INSERT INTO tb_opportunity_findings")).length, 1);
  assert.equal(queries.filter((query) => query.text.includes("INSERT INTO tb_action_findings")).length, 2);

  const opportunityInsert = queries.find((query) => query.text.includes("INSERT INTO tb_strategic_opportunities"));
  const actionInsert = queries.find((query) => query.text.includes("INSERT INTO tb_action_studio"));
  assert.equal(opportunityInsert?.params[1], "OP-01");
  assert.equal(actionInsert?.params[5], "finding-uuid-1");
});

test("reports unresolved lineage so the transaction owner can fail closed", async () => {
  const queries: RecordedQuery[] = [];
  const result = await replaceTbSignalServingEntities(recordingClient(queries), {
    tbAnalysisId: "analysis-2",
    findingUuidByHumanId: new Map(),
    strategicOpportunities: [{
      opportunity_id: "OP-02",
      title: "Directional opportunity",
      decision: "Hold for review",
      why_now: "The source synthesis referenced a missing finding.",
      level: "measurement",
      source_mix: ["synthesis"],
      related_finding_ids: ["F-UNKNOWN"],
      evidence_summary: "Pending lineage repair.",
      what_to_do: "Repair the link before publication.",
      success_signal: "The opportunity has governed evidence.",
      confidence: "baja_direccional"
    }],
    actionStudio: []
  });

  assert.equal(result.strategicOpportunitiesInserted, 1);
  assert.equal(result.opportunityFindingLinksInserted, 0);
  assert.deepEqual(result.unmatchedFindingIds, ["F-UNKNOWN"]);
});

test("approved analyses require a new revision before Step 6 can write", () => {
  assert.doesNotThrow(() => assertTbAnalysisAcceptsSynthesisWrite("needs_review"));
  assert.throws(
    () => assertTbAnalysisAcceptsSynthesisWrite("approved_by_im"),
    /Approved T&B analyses are immutable/
  );
  assert.throws(
    () => assertTbAnalysisAcceptsSynthesisWrite("approved_by_kam"),
    /Approved T&B analyses are immutable/
  );
});

test("canonical serving callers fail closed on unresolved finding lineage", () => {
  assert.doesNotThrow(() => assertTbServingFindingLinksResolved([]));
  assert.throws(
    () => assertTbServingFindingLinksResolved(["F-UNKNOWN", "F-OTHER"]),
    /reference unknown findings: F-UNKNOWN, F-OTHER/
  );
});
