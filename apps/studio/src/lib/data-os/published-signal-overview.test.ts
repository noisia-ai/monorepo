import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/noisia_test";

const {
  mapPublishedSignalActions,
  mapPublishedSignalOpportunities
} = await import("./published-signal-overview");

test("maps canonical strategic opportunities without recommendation fallbacks", () => {
  const [opportunity] = mapPublishedSignalOpportunities([{
    id: "opportunity-uuid",
    opportunity_id: "OP-01",
    title: "Own the decision moment",
    decision: "Prioritize a bounded activation",
    why_now: "The approved snapshot shows repeated demand.",
    level: "brand",
    source_mix: ["findings"],
    related_finding_ids: ["F-01", "F-02"],
    evidence_summary: "Two governed findings support the decision.",
    what_to_do: "Run the test.",
    success_signal: "Qualified response increases.",
    confidence: "alta",
    citation_count: 12,
    position: 0
  }]);

  assert.equal(opportunity?.opportunity_id, "OP-01");
  assert.deepEqual(opportunity?.related_finding_ids, ["F-01", "F-02"]);
  assert.deepEqual(opportunity?.source_mix, [
    "findings",
    "published_snapshot",
    "tb_strategic_opportunities",
    "finding_citations"
  ]);
});

test("fails closed when a persisted opportunity enum is outside the contract", () => {
  assert.throws(() => mapPublishedSignalOpportunities([{
    id: "opportunity-uuid",
    opportunity_id: "OP-02",
    title: "Invalid",
    decision: "Invalid",
    why_now: "Invalid",
    level: "campaign",
    source_mix: [],
    related_finding_ids: [],
    evidence_summary: "Invalid",
    what_to_do: "Invalid",
    success_signal: "Invalid",
    confidence: "alta",
    citation_count: 0,
    position: 0
  }]), /Strategic opportunity level has an invalid canonical value/);
});

test("maps Action Studio rows and fails closed on invalid target teams", () => {
  const row = {
    action_id: "AS-01",
    target_team: "creative_content",
    kind: "experiment",
    title: "Prototype the message",
    finding_ids: ["F-01"],
    primary_finding_id: "F-01",
    rationale: "The evidence supports a bounded test.",
    action_text: "Create two executions.",
    suggested_channel: "paid social",
    suggested_format: "short video",
    success_signal: "Qualified completion improves.",
    estimated_effort: "media",
    estimated_impact: "alto",
    confidence: "alta",
    priority_rank: 1,
    citation_count: 6
  };
  const [action] = mapPublishedSignalActions([row]);

  assert.equal(action?.target_team, "creative_content");
  assert.equal(action?.primary_finding_id, "F-01");
  assert.throws(
    () => mapPublishedSignalActions([{ ...row, target_team: "growth_hacking" }]),
    /Action Studio target_team has an invalid canonical value/
  );
  assert.throws(
    () => mapPublishedSignalActions([{ ...row, confidence: "certain" }]),
    /Action Studio confidence has an invalid canonical value/
  );
});
